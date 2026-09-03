import { type SerialDate, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { type MarketContext, getDiscountCurve } from "../market/market-context.js";
import {
  type CrossCurrencySwap,
  type FixedLeg,
  type FloatLeg,
  type InterestRateSwap,
  type LegResult,
  type PricingResult,
  type SwapLeg,
} from "../instruments/types.js";
import { fxForwardRate } from "./fx-pricer.js";
import { fixedRateAt, floatSpreadAt, fxToReporting, legAccrued, priceLeg, scheduleDates } from "./leg-pricer.js";

/**
 * Swap analytics. Par solver with coupon schedules (step-up swaps):
 * - `parRate` / `parRateBase`: the coupon of the *first outstanding period*
 *   that zeroes the PV while every step difference of `rateSchedule` is kept
 *   constant (r_i − r_0 unchanged). Without a schedule this is the ordinary
 *   par rate. Formula: r_0 − PV / (s · A · fx), exact because PV is linear in
 *   the base coupon; notional exchanges of the fixed leg are included.
 * - `parRateFlat`: the single constant coupon replacing the whole schedule
 *   that zeroes the PV (equals `parRate` without a schedule).
 * - `fairSpread`: analogous for the (first) floating leg – the spread of its
 *   first outstanding period keeping the `spreadSchedule` steps constant.
 */
export interface SwapAnalytics {
  parRate?: number;
  parRateBase?: number;
  parRateFlat?: number;
  fairSpread?: number;
  fixedRate?: number;
  annuity?: number;
  pvFixed?: number;
  pvFloat?: number;
  maturity?: SerialDate;
  remainingYears?: number;
}

/** Accrual start of the first outstanding coupon of a leg result (undefined when all paid). */
function firstAccrualStart(res: LegResult): SerialDate | undefined {
  return res.cashflows.find((c) => c.kind === "Interest" && c.accrualStart !== undefined)?.accrualStart;
}

/** PV (leg currency) of the coupon cashflows of a leg result (excluding notional exchanges). */
function couponPv(res: LegResult): number {
  return res.cashflows.filter((c) => c.kind === "Interest").reduce((s, c) => s + c.presentValue, 0);
}

function fixedLegs(legs: SwapLeg[]): FixedLeg[] {
  return legs.filter((l): l is FixedLeg => l.type === "Fixed");
}
function floatLegs(legs: SwapLeg[]): FloatLeg[] {
  return legs.filter((l): l is FloatLeg => l.type === "Float");
}

/**
 * Interest rate swap (any number of fixed/float legs, also tenor basis swaps
 * and – via `priceCrossCurrencySwap` – cross-currency legs). Leg PVs are
 * converted to the reporting currency at the today rate (spot adjusted to the
 * valuation date), consistently with the FX pricers.
 */
export function priceInterestRateSwap(ctx: MarketContext, trade: InterestRateSwap, reportingCurrency?: string): PricingResult {
  const t0 = performance.now();
  const reporting = reportingCurrency ?? trade.legs[0]!.currency;
  const warnings: string[] = [];
  const legResults = trade.legs.map((leg, i) => {
    const r = priceLeg(ctx, leg, i, { reportingCurrency: reporting, collateralCurrency: trade.collateralCurrency });
    warnings.push(...r.warnings);
    return r.result;
  });
  let pv = legResults.reduce((s, l) => s + l.pvReporting, 0);
  const fxOf = (ccy: string) => fxToReporting(ctx, ccy, reporting, trade.collateralCurrency);
  // Upfront payment
  if (trade.upfront && trade.upfront.date > ctx.valuationDate) {
    const disc = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    pv -= trade.upfront.amount * disc.df(trade.upfront.date) * fxOf(trade.upfront.currency);
  }
  const analytics: Record<string, number | string | undefined> = {};
  const fixed = fixedLegs(trade.legs);
  const floats = floatLegs(trade.legs);
  const maturity = Math.max(...trade.legs.map((l) => l.terminationDate));
  analytics.maturity = maturity;
  analytics.remainingYears = yearFraction(ctx.valuationDate, maturity, "ACT/365F");

  if (fixed.length === 1 && floats.length >= 1) {
    const fixedLeg = fixed[0]!;
    const fixedIdx = trade.legs.indexOf(fixedLeg);
    const fixedRes = legResults[fixedIdx]!;
    const annuity = fixedRes.annuity ?? 0;
    const sFixed = fixedLeg.payReceive === "Receive" ? 1 : -1;
    const pvOthers = legResults.filter((_, i) => i !== fixedIdx).reduce((s, l) => s + l.pvReporting, 0);
    const fxFixed = fxOf(fixedLeg.currency);
    if (annuity > 0) {
      const start0 = firstAccrualStart(fixedRes);
      const r0 = start0 !== undefined ? fixedRateAt(fixedLeg, start0) : fixedLeg.rate;
      // Base coupon keeping the step differences constant (see `SwapAnalytics`).
      const parBase = r0 - pv / (sFixed * annuity * fxFixed);
      analytics.parRate = parBase;
      analytics.parRateBase = parBase;
      // Constant coupon replacing the whole schedule.
      analytics.parRateFlat = fixedLeg.rateSchedule?.length ? -(pv - couponPv(fixedRes) * fxFixed) / (sFixed * annuity * fxFixed) : parBase;
    }
    analytics.fixedRate = fixedLeg.rate;
    analytics.annuity = annuity;
    analytics.pvFixed = fixedRes.pvReporting;
    analytics.pvFloat = pvOthers;
    // Fair spread on the (first) float leg that would zero the PV.
    const fl = floats[0]!;
    const flIdx = trade.legs.indexOf(fl);
    const flRes = legResults[flIdx]!;
    const flAnnuity = flRes.annuity ?? 0;
    const sFloat = fl.payReceive === "Receive" ? 1 : -1;
    const fxFl = fxOf(fl.currency);
    if (flAnnuity > 0) {
      const s0 = firstAccrualStart(flRes);
      analytics.fairSpread = (s0 !== undefined ? floatSpreadAt(fl, s0) : (fl.spread ?? 0)) - pv / (sFloat * flAnnuity * fxFl);
    }
  } else if (floats.length === 2 && fixed.length === 0) {
    // Basis swap: fair spread on leg 0
    const fl = floats[0]!;
    const flRes = legResults[0]!;
    const sFloat = fl.payReceive === "Receive" ? 1 : -1;
    const fxFl = fxOf(fl.currency);
    if ((flRes.annuity ?? 0) > 0) {
      const s0 = firstAccrualStart(flRes);
      analytics.fairSpread = (s0 !== undefined ? floatSpreadAt(fl, s0) : (fl.spread ?? 0)) - pv / (sFloat * flRes.annuity! * fxFl);
    }
  }

  const accrued = trade.legs.reduce((s, leg, i) => s + legAccrued(ctx, leg, legResults[i]!) * fxOf(leg.currency), 0);

  return {
    tradeId: trade.id,
    tradeType: trade.type,
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv,
    legs: legResults,
    analytics,
    details: { maturity: toISO(maturity) },
    accrued,
    warnings: Array.from(new Set(warnings)),
    timingMs: performance.now() - t0,
  };
}

/**
 * Cross-currency swap. Constant-notional CCS is priced leg-by-leg with
 * notional exchanges; MtM-resetting CCS recomputes the resetting leg's
 * notional at each period start from spot-date-anchored forward FX rates.
 */
export function priceCrossCurrencySwap(ctx: MarketContext, trade: CrossCurrencySwap, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.legs[0]!.currency;
  let legs = trade.legs.map((l) => ({
    ...l,
    notionalExchange: l.notionalExchange ?? { initial: true, final: true },
  }));
  if (trade.mtmReset) {
    const ri = trade.mtmReset.resettingLegIndex;
    const reset = legs[ri]!;
    const other = legs.find((_, i) => i !== ri)!;
    const dates = scheduleDates(reset);
    // Notional at each accrual start = other notional × forward FX(start) (1 other = x reset)
    const starts = [reset.effectiveDate, ...dates.slice(0, -1)];
    const schedule = starts.map((d) => ({
      date: d,
      notional: other.notional * fxForwardRate(ctx, other.currency, reset.currency, Math.max(d, ctx.valuationDate), trade.collateralCurrency),
    }));
    legs = legs.map((l, i) => (i === ri ? { ...l, notionalSchedule: schedule, notionalExchange: { initial: true, final: true, interim: true } } : l));
  }
  const irs: InterestRateSwap = { ...trade, type: "InterestRateSwap", legs };
  const res = priceInterestRateSwap(ctx, irs, reporting);
  return { ...res, tradeType: "CrossCurrencySwap", analytics: { ...res.analytics, mtmReset: trade.mtmReset ? "yes" : "no" } };
}
