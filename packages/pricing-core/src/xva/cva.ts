import { yearFraction } from "../dates/daycount.js";
import { type FixedLeg, type FxForward, type InterestRateSwap, type Trade } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { bachelier, black76 } from "../models/black.js";
import { fxAtmVol } from "../models/fx-vol-surface.js";
import { swaptionAtmVol } from "../models/vol-surfaces.js";
import { fxForwardRate, splitPair } from "../pricing/fx-pricer.js";
import { scheduleDates } from "../pricing/leg-pricer.js";
import { priceInterestRateSwap } from "../pricing/swap-pricer.js";

export interface ExposurePoint {
  date: number;
  years: number;
  /** Expected positive exposure (discounted to today, reporting ccy). */
  epe: number;
  /** Expected negative exposure (discounted). */
  ene: number;
  /** Marginal default probability of counterparty in (t_{i-1}, t_i]. */
  pdCpty: number;
  pdOwn: number;
}

export interface XvaResult {
  tradeId: string;
  currency: string;
  cva: number;
  dva: number;
  /** Bilateral adjustment: -CVA + DVA (added to risk-free PV). */
  bcva: number;
  profile: ExposurePoint[];
  method: string;
  warnings: string[];
}

export interface CreditInputs {
  /** Counterparty flat hazard rate (e.g. 0.02 for ~200bp spread at 40% recovery LGD 60%). */
  cptyHazard: number;
  cptyRecovery: number;
  ownHazard?: number;
  ownRecovery?: number;
}

/** Marginal default probability under a flat hazard rate. */
function marginalPd(h: number, t0: number, t1: number): number {
  return Math.exp(-h * t0) - Math.exp(-h * t1);
}

/**
 * Semi-analytic CVA for interest rate swaps: the expected positive exposure
 * at each coupon date equals the price of a European swaption on the
 * remaining swap (Sorensen–Bollier). Uses the ATM normal vol from the
 * swaption surface (or 70bp fallback).
 */
export function cvaSwap(ctx: MarketContext, swap: InterestRateSwap, credit: CreditInputs, reporting: string): XvaResult {
  const warnings: string[] = [];
  const fixed = swap.legs.find((l): l is FixedLeg => l.type === "Fixed");
  if (!fixed) throw new Error("CVA (swaption approach) needs a fixed/float swap");
  const ccy = fixed.currency;
  const fx = ccy === reporting ? 1 : getFxSpot(ctx, ccy, reporting);
  const dates = scheduleDates(fixed).filter((d) => d > ctx.valuationDate);
  const surface = ctx.swaptionVols?.[ccy];
  if (!surface) warnings.push("No swaption vol surface – 70bp normal vol assumed for exposure");
  const disc = getDiscountCurve(ctx, ccy, swap.collateralCurrency);
  const profile: ExposurePoint[] = [];
  const weReceiveFixed = fixed.payReceive === "Receive";
  let prevT = 0;
  // Exposure at t=0 (current PV)
  const pv0 = priceInterestRateSwap(ctx, swap, ccy).pv;
  profile.push({ date: ctx.valuationDate, years: 0, epe: Math.max(pv0, 0) * fx, ene: Math.max(-pv0, 0) * fx, pdCpty: 0, pdOwn: 0 });
  for (let i = 0; i < dates.length - 1; i++) {
    const t = dates[i]!;
    const T = yearFraction(ctx.valuationDate, t, "ACT/365F");
    const remaining: InterestRateSwap = {
      ...swap,
      legs: swap.legs.map((l) => ({ ...l, effectiveDate: t })),
    };
    let fwd: number;
    let annuity: number;
    try {
      const res = priceInterestRateSwap(ctx, remaining, ccy);
      fwd = res.analytics.parRate as number;
      annuity = (res.analytics.annuity as number) ?? 0;
    } catch {
      continue;
    }
    if (!Number.isFinite(fwd) || annuity <= 0) continue;
    const tenorLeft = yearFraction(t, fixed.terminationDate, "ACT/365F");
    const vol = surface ? swaptionAtmVol(surface, T, tenorLeft) : 0.007;
    const isNormal = !surface || surface.volType === "Normal";
    // Our exposure is positive when swap value to us > 0. If we receive fixed, value rises when rates fall → "receiver" optionality = put on rate.
    const epeUndisc = isNormal
      ? bachelier(weReceiveFixed ? "Put" : "Call", fwd, fixed.rate, vol, T)
      : black76(weReceiveFixed ? "Put" : "Call", fwd, fixed.rate, vol, T);
    const eneUndisc = isNormal
      ? bachelier(weReceiveFixed ? "Call" : "Put", fwd, fixed.rate, vol, T)
      : black76(weReceiveFixed ? "Call" : "Put", fwd, fixed.rate, vol, T);
    // annuity already includes discounting to today.
    const epe = annuity * epeUndisc * fx;
    const ene = annuity * eneUndisc * fx;
    profile.push({
      date: t,
      years: T,
      epe,
      ene,
      pdCpty: marginalPd(credit.cptyHazard, prevT, T),
      pdOwn: marginalPd(credit.ownHazard ?? 0, prevT, T),
    });
    prevT = T;
  }
  void disc;
  return aggregate(swap.id, reporting, profile, credit, "Swaption-replication (Sorensen–Bollier), flat hazard", warnings);
}

/** CVA for an FX forward using Garman–Kohlhagen on the forward at each grid date. */
export function cvaFxForward(ctx: MarketContext, fwdTrade: FxForward, credit: CreditInputs, reporting: string): XvaResult {
  const warnings: string[] = [];
  const base = fwdTrade.buyCurrency;
  const quote = fwdTrade.sellCurrency;
  const K = fwdTrade.sellAmount / fwdTrade.buyAmount;
  const T = yearFraction(ctx.valuationDate, fwdTrade.deliveryDate, "ACT/365F");
  const surface = ctx.fxVols?.[`${base}${quote}`];
  if (!surface) warnings.push("No FX vol surface – 8% vol assumed");
  const fxQ = quote === reporting ? 1 : getFxSpot(ctx, quote, reporting);
  const steps = Math.max(2, Math.min(24, Math.ceil(T * 12)));
  const profile: ExposurePoint[] = [];
  let prevT = 0;
  const F = fxForwardRate(ctx, base, quote, fwdTrade.deliveryDate, fwdTrade.collateralCurrency);
  const dfQ = getDiscountCurve(ctx, quote, fwdTrade.collateralCurrency).df(fwdTrade.deliveryDate);
  profile.push({ date: ctx.valuationDate, years: 0, epe: Math.max((F - K) * dfQ * fwdTrade.buyAmount * fxQ, 0), ene: Math.max(-(F - K) * dfQ * fwdTrade.buyAmount * fxQ, 0), pdCpty: 0, pdOwn: 0 });
  for (let i = 1; i <= steps; i++) {
    const t = (T * i) / steps;
    const vol = surface ? fxAtmVol(surface, t) : 0.08;
    const epe = black76("Call", F, K, vol, t) * dfQ * fwdTrade.buyAmount * fxQ;
    const ene = black76("Put", F, K, vol, t) * dfQ * fwdTrade.buyAmount * fxQ;
    profile.push({
      date: ctx.valuationDate + Math.round(t * 365.25),
      years: t,
      epe,
      ene,
      pdCpty: marginalPd(credit.cptyHazard, prevT, t),
      pdOwn: marginalPd(credit.ownHazard ?? 0, prevT, t),
    });
    prevT = t;
  }
  void splitPair;
  return aggregate(fwdTrade.id, reporting, profile, credit, "GK forward-exposure, flat hazard", warnings);
}

function aggregate(
  tradeId: string,
  currency: string,
  profile: ExposurePoint[],
  credit: CreditInputs,
  method: string,
  warnings: string[],
): XvaResult {
  const lgdC = 1 - credit.cptyRecovery;
  const lgdO = 1 - (credit.ownRecovery ?? 0.4);
  let cva = 0;
  let dva = 0;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    // Trapezoid on exposure over the interval × marginal PD.
    cva += lgdC * b.pdCpty * (0.5 * (a.epe + b.epe));
    dva += lgdO * b.pdOwn * (0.5 * (a.ene + b.ene));
  }
  return { tradeId, currency, cva, dva, bcva: -cva + dva, profile, method, warnings };
}

export function computeXva(ctx: MarketContext, trade: Trade, credit: CreditInputs, reporting: string): XvaResult {
  switch (trade.type) {
    case "InterestRateSwap":
      return cvaSwap(ctx, trade, credit, reporting);
    case "FxForward":
      return cvaFxForward(ctx, trade, credit, reporting);
    default:
      return {
        tradeId: trade.id,
        currency: reporting,
        cva: Number.NaN,
        dva: Number.NaN,
        bcva: Number.NaN,
        profile: [],
        method: "not supported",
        warnings: [`XVA not implemented for ${trade.type} (v1 supports IRS and FX forwards)`],
      };
  }
}

/** Convert a CDS spread (decimal) to a flat hazard rate: λ ≈ s / (1 - R). */
export function hazardFromSpread(spread: number, recovery: number): number {
  return spread / (1 - recovery);
}
