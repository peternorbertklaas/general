import { type Curve } from "../curves/curve.js";
import { type SerialDate, addTenor } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { PricingError } from "../errors.js";
import { brent } from "../math/rootfind.js";
import { type FixedLeg, type FloatLeg, type FxForward, type InterestRateSwap, type Trade } from "../instruments/types.js";
import { tradeMaturityDate } from "../instruments/trade-dates.js";
import { type MarketContext, getDiscountCurve } from "../market/market-context.js";
import { bachelier, black76 } from "../models/black.js";
import { normCdf, normPdf } from "../math/normal.js";
import { computeRisk, rollMarket } from "../risk/sensitivities.js";
import { priceTrade, tradeCurrencies } from "../pricing/price.js";
import { fxAtmVol } from "../models/fx-vol-surface.js";
import { swaptionAtmVol, swaptionVol } from "../models/vol-surfaces.js";
import { fxForwardRate } from "../pricing/fx-pricer.js";
import { fxToReporting, scheduleDates } from "../pricing/leg-pricer.js";
import { priceInterestRateSwap } from "../pricing/swap-pricer.js";
import { upfrontPremiumLeg } from "../pricing/upfront.js";

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
  /** Counterparty hazard term structure (from `bootstrapHazardCurve`); overrides `cptyHazard` when present. */
  cptyHazardCurve?: HazardCurve;
  /** Own hazard term structure; overrides `ownHazard` when present. */
  ownHazardCurve?: HazardCurve;
  /**
   * Normal volatility of the tenor-basis spread (decimal, e.g. 0.0010 = 10bp)
   * used for basis-swap exposure. Default: `BASIS_SPREAD_VOL_FRACTION` × ATM
   * swaption normal vol – a deliberately conservative proxy.
   */
  basisSpreadVol?: number;
}

/**
 * Default basis-spread vol as a fraction of the outright ATM normal swaption
 * vol. Tenor-basis spreads historically move at roughly 10–20% of outright
 * rate vol; 20% is used so the resulting CVA errs on the conservative side.
 */
export const BASIS_SPREAD_VOL_FRACTION = 0.2;

// ---------------------------------------------------------------------------
// Hazard term structure (CDS bootstrap)
// ---------------------------------------------------------------------------

/**
 * Piecewise-constant hazard rate term structure: `hazards[i]` applies on
 * (times[i-1], times[i]] (times[-1] = 0) and the last hazard is extended flat
 * beyond the final pillar.
 */
export interface HazardCurve {
  /** Pillar times in years (ACT/365F from the valuation date), strictly increasing. */
  times: number[];
  /** Hazard rate (continuous, per year) of each interval ending at `times[i]`. */
  hazards: number[];
  recovery: number;
  /** Set by `bootstrapHazardCurve` when a pillar was floored at 0 (`HAZARD_FLOORED: …`, R3-3). */
  warnings?: string[];
}

export interface HazardBootstrapOptions {
  /**
   * A CDS term structure whose spreads fall too steeply (s_i·T_i decreasing)
   * implies a negative forward hazard rate, i.e. a survival probability that
   * increases with time (arbitrage / data error). Default (false): raise
   * `PricingError("INVALID_CREDIT_CURVE")` naming the pillar. `true`: floor the
   * hazard at 0 for that interval and record a `HAZARD_FLOORED` warning on the
   * curve – later pillars are then solved on the floored curve, so their quotes
   * still reprice while the floored quote does not.
   */
  floorHazard?: boolean;
}

/** Survival probability Q(t) = exp(−∫₀ᵗ λ) of a piecewise-constant hazard curve (flat extension beyond the last pillar). */
export function survivalProbability(curve: HazardCurve, t: number): number {
  if (t <= 0 || curve.times.length === 0) return 1;
  let integral = 0;
  let prev = 0;
  for (let i = 0; i < curve.times.length; i++) {
    const end = curve.times[i]!;
    if (t <= end) {
      integral += curve.hazards[i]! * (t - prev);
      return Math.exp(-integral);
    }
    integral += curve.hazards[i]! * (end - prev);
    prev = end;
  }
  integral += curve.hazards[curve.hazards.length - 1]! * (t - prev);
  return Math.exp(-integral);
}

/** Marginal default probability Q(t0) − Q(t1) in (t0, t1] from a hazard curve. */
export function marginalPd(curve: HazardCurve, t0: number, t1: number): number {
  return survivalProbability(curve, t0) - survivalProbability(curve, t1);
}

/** Flat hazard curve (single pillar), for callers that only know a flat rate. */
export function flatHazardCurve(hazard: number, recovery: number): HazardCurve {
  return { times: [100], hazards: [hazard], recovery };
}

/**
 * Premium-leg accrual factor per year of hazard time: standard CDS accrue the
 * running spread ACT/360 (ISDA 2003/2014 definitions, ISDA standard model)
 * while the hazard curve is parameterised in ACT/365F years, so a coupon
 * period of Δ years (ACT/365F) accrues s·Δ·365/360 (N5-5).
 */
export const CDS_PREMIUM_ACCRUAL_PER_YEAR = 365 / 360;

/**
 * Bootstrap a piecewise-constant hazard curve from par CDS spreads (standard
 * premium-leg approximation): for each pillar T_i the hazard λ_i on
 * (T_{i-1}, T_i] solves
 *
 *   s · Σ_j Δ_j·(365/360) · [DF(t_j)·Q(t_j) + DF(t_j^m)·½·(Q(t_{j-1}) − Q(t_j))]
 *     =  (1 − R) · Σ_j DF(t_j^m) · (Q(t_{j-1}) − Q(t_j))
 *
 * with quarterly premium dates t_j up to T_i (Δ_j in ACT/365F years, t_j^m the
 * period midpoint): the premium accrues **ACT/360** (ISDA standard CDS
 * convention, N5-5: the factor 365/360 on the ACT/365F hazard time), the
 * accrual on default and the protection payment are discounted to the period
 * midpoint (ISDA standard model approximation of the continuous integral).
 * Earlier pillars are kept fixed (sequential bootstrap). `discount` defaults
 * to DF ≡ 1 – a flat term structure then reproduces λ = s·(365/360) / (1 − R)
 * up to the quarterly discretisation (relative error ≈ (λΔ)²/12). Quotes:
 * `tenor` like "1Y", "5Y"; `spread` in decimal (0.01 = 100bp). Negative
 * hazards (inverted quotes) are rejected with
 * `PricingError("INVALID_CREDIT_CURVE")` unless `opts.floorHazard` is set
 * (R3-3, see `HazardBootstrapOptions`).
 *
 * Cross-check (QuantLib 1.43 `PiecewiseFlatHazardRate` / `SpreadCdsHelper`,
 * ISDA engine, quarterly ACT/360 premium, flat 2 % discount, R 40 %): flat
 * 100 bp → λ(1Y) 168.10 bp in QuantLib; the engine reproduces the QuantLib
 * hazards to ≈ 2e-3 relative and the survival probabilities to ≈ 1e-4
 * (remaining difference: QuantLib integrates the default leg daily on the
 * exact IMM-free coupon schedule, the engine uses the quarterly midpoint) –
 * see `test-data/golden/cds-hazard-bootstrap.json`.
 */
export function bootstrapHazardCurve(
  quotes: { tenor: string; spread: number }[],
  recovery: number,
  valuationDate: SerialDate,
  discount?: Curve,
  opts: HazardBootstrapOptions = {},
): HazardCurve {
  if (quotes.length === 0) throw new PricingError("INVALID_CREDIT_CURVE", "bootstrapHazardCurve: at least one CDS quote is required");
  if (!(recovery >= 0 && recovery < 1)) {
    throw new PricingError("INVALID_CREDIT_CURVE", `bootstrapHazardCurve: recovery ${recovery} must be in [0, 1)`, { recovery });
  }
  for (const q of quotes) {
    if (!Number.isFinite(q.spread) || q.spread < 0) {
      throw new PricingError("INVALID_CREDIT_CURVE", `bootstrapHazardCurve: CDS spread of ${q.tenor} must be a finite, non-negative number`, {
        pillar: q.tenor,
        spread: q.spread,
      });
    }
  }
  const pillars = quotes
    .map((q) => ({ t: yearFraction(valuationDate, addTenor(valuationDate, q.tenor), "ACT/365F"), s: q.spread, tenor: q.tenor }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t);
  const df = (t: number) => (discount ? discount.df(valuationDate + Math.round(t * 365)) : 1);
  const times: number[] = [];
  const hazards: number[] = [];
  const warnings: string[] = [];
  const lgd = 1 - recovery;
  const dt = 0.25;
  for (const p of pillars) {
    const partial: HazardCurve = { times: [...times, p.t], hazards: [...hazards, 0], recovery };
    // Premium and protection legs as functions of the last hazard.
    const legs = (h: number): number => {
      partial.hazards[partial.hazards.length - 1] = h;
      let premium = 0;
      let protection = 0;
      let prev = 0;
      let qPrev = 1;
      // One coupon period (prev, tj]: ACT/360 premium accrual on survival at the period end, accrual on
      // default and protection at the period midpoint (N5-5).
      const period = (tj: number): void => {
        const q = survivalProbability(partial, tj);
        const dEnd = df(tj);
        const dMid = df(0.5 * (prev + tj));
        const accrual = (tj - prev) * CDS_PREMIUM_ACCRUAL_PER_YEAR;
        premium += accrual * (dEnd * q + dMid * 0.5 * (qPrev - q));
        protection += dMid * (qPrev - q);
        prev = tj;
        qPrev = q;
      };
      for (let t = dt; t < p.t + 1e-9; t += dt) period(Math.min(t, p.t));
      if (prev < p.t - 1e-9) period(p.t); // stub to the pillar
      return p.s * premium - lgd * protection;
    };
    const guess = p.s / lgd;
    let h: number;
    try {
      h = brent(legs, Math.min(1e-8, guess * 0.01), Math.max(guess * 5, 0.05), { tolerance: 1e-14, maxIterations: 200 });
    } catch {
      h = brent(legs, -0.5, 5, { tolerance: 1e-12, maxIterations: 300 });
    }
    if (h < 0) {
      const detail = `pillar ${p.tenor} (t = ${p.t.toFixed(3)}y) implies a hazard rate of ${(h * 1e4).toFixed(1)}bp: the survival probability would increase over the interval (inverted CDS quotes)`;
      if (!opts.floorHazard) {
        throw new PricingError("INVALID_CREDIT_CURVE", `bootstrapHazardCurve: ${detail}`, { pillar: p.tenor, time: p.t, hazard: h, spread: p.s });
      }
      warnings.push(`HAZARD_FLOORED: ${detail} – floored at 0, the ${p.tenor} quote does not reprice`);
      h = 0;
    }
    times.push(p.t);
    hazards.push(h);
  }
  return { times, hazards, recovery, ...(warnings.length ? { warnings } : {}) };
}

/** Marginal default probability under a flat hazard rate. */
function marginalPdFlat(h: number, t0: number, t1: number): number {
  return Math.exp(-h * t0) - Math.exp(-h * t1);
}

/** Counterparty marginal PD from the term structure when given, else the flat hazard. */
function cptyPd(credit: CreditInputs, t0: number, t1: number): number {
  return credit.cptyHazardCurve ? marginalPd(credit.cptyHazardCurve, t0, t1) : marginalPdFlat(credit.cptyHazard, t0, t1);
}

/** Own marginal PD from the term structure when given, else the flat hazard (0 when none). */
function ownPd(credit: CreditInputs, t0: number, t1: number): number {
  return credit.ownHazardCurve ? marginalPd(credit.ownHazardCurve, t0, t1) : marginalPdFlat(credit.ownHazard ?? 0, t0, t1);
}

/** Method suffix documenting the hazard assumption. */
function hazardLabel(credit: CreditInputs): string {
  return credit.cptyHazardCurve ? "hazard term structure (CDS bootstrap)" : "flat hazard";
}

/**
 * Semi-analytic CVA for interest rate swaps: the expected positive exposure
 * at each coupon date equals the price of a European swaption on the
 * remaining swap (Sorensen–Bollier), valued with the smile vol at the swap's
 * fixed rate (or 70bp normal vol fallback). The profile ends at maturity with
 * zero exposure so the last coupon period carries its default probability.
 * An upfront fee only nets the t = 0 exposure (current PV); the remaining
 * swaps are priced without it (N8-1 – the fee used to enter `parRate` and
 * shift every replication forward).
 */
export function cvaSwap(ctx: MarketContext, swap: InterestRateSwap, credit: CreditInputs, reporting: string): XvaResult {
  const warnings: string[] = [];
  const fixed = swap.legs.find((l): l is FixedLeg => l.type === "Fixed");
  if (!fixed) throw new PricingError("UNSUPPORTED_TRADE_TYPE", "CVA (swaption approach) needs a fixed/float swap");
  const ccy = fixed.currency;
  const fx = fxToReporting(ctx, ccy, reporting, swap.collateralCurrency);
  const dates = scheduleDates(fixed).filter((d) => d > ctx.valuationDate);
  const surface = ctx.swaptionVols?.[ccy];
  if (!surface) warnings.push("No swaption vol surface – 70bp normal vol assumed for exposure");
  const profile: ExposurePoint[] = [];
  const weReceiveFixed = fixed.payReceive === "Receive";
  let prevT = 0;
  // Exposure at t=0 (current PV)
  const pv0 = priceInterestRateSwap(ctx, swap, ccy).pv;
  profile.push({ date: ctx.valuationDate, years: 0, epe: Math.max(pv0, 0) * fx, ene: Math.max(-pv0, 0) * fx, pdCpty: 0, pdOwn: 0 });
  for (let i = 0; i < dates.length - 1; i++) {
    const t = dates[i]!;
    const T = yearFraction(ctx.valuationDate, t, "ACT/365F");
    // N8-1: the remaining swap carries no fee – the premium is paid on its date and does not shift the forward.
    const remaining: InterestRateSwap = {
      ...swap,
      upfront: undefined,
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
    const vol = surface ? swaptionVol(surface, T, tenorLeft, fwd, fixed.rate) : 0.007;
    const isNormal = !surface || surface.volType === "Normal";
    const shift = surface?.shift ?? 0;
    const opt = (type: "Call" | "Put") => (isNormal ? bachelier(type, fwd, fixed.rate, vol, T) : black76(type, fwd + shift, fixed.rate + shift, vol, T));
    // Our exposure is positive when swap value to us > 0. If we receive fixed, value rises when rates fall → "receiver" optionality = put on rate.
    const epeUndisc = opt(weReceiveFixed ? "Put" : "Call");
    const eneUndisc = opt(weReceiveFixed ? "Call" : "Put");
    // annuity already includes discounting to today.
    profile.push({
      date: t,
      years: T,
      epe: annuity * epeUndisc * fx,
      ene: annuity * eneUndisc * fx,
      pdCpty: cptyPd(credit, prevT, T),
      pdOwn: ownPd(credit, prevT, T),
    });
    prevT = T;
  }
  appendMaturityPoint(profile, ctx, fixed.terminationDate, prevT, credit);
  return aggregate(swap.id, reporting, profile, credit, `Swaption-replication (Sorensen–Bollier), smile vol at strike, ${hazardLabel(credit)}`, warnings);
}

/** Final profile point at maturity with zero exposure so the last period contributes its PD. */
function appendMaturityPoint(profile: ExposurePoint[], ctx: MarketContext, maturity: number, prevT: number, credit: CreditInputs): void {
  const T = yearFraction(ctx.valuationDate, maturity, "ACT/365F");
  if (T <= prevT) return;
  profile.push({ date: maturity, years: T, epe: 0, ene: 0, pdCpty: cptyPd(credit, prevT, T), pdOwn: ownPd(credit, prevT, T) });
}

/**
 * CVA for a tenor basis swap (two floating legs, one currency) with the
 * Sorensen–Bollier structure applied to the basis spread: at each coupon date
 * the exposure is a "basis swaption" – annuity(t) × Bachelier option on the
 * fair basis spread of the remaining swap struck at the contractual spread.
 *
 * Conservative bias (documented): no market for basis-spread vols is
 * assumed; unless `credit.basisSpreadVol` is given the spread vol is set to
 * `BASIS_SPREAD_VOL_FRACTION` (20%) of the ATM swaption normal vol, which is
 * at the upper end of realised tenor-basis volatility, and the spread is
 * modelled without mean reversion. The resulting CVA is therefore an upper
 * estimate.
 */
export function cvaBasisSwap(ctx: MarketContext, swap: InterestRateSwap, credit: CreditInputs, reporting: string): XvaResult {
  const warnings: string[] = [];
  const floats = swap.legs.filter((l): l is FloatLeg => l.type === "Float");
  if (floats.length !== 2 || swap.legs.length !== 2) throw new PricingError("UNSUPPORTED_TRADE_TYPE", "cvaBasisSwap needs exactly two floating legs");
  const leg0 = swap.legs[0] as FloatLeg;
  const ccy = leg0.currency;
  const fx = fxToReporting(ctx, ccy, reporting, swap.collateralCurrency);
  const dates = scheduleDates(leg0).filter((d) => d > ctx.valuationDate);
  const maturity = Math.max(...swap.legs.map((l) => l.terminationDate));
  const surface = ctx.swaptionVols?.[ccy];
  if (credit.basisSpreadVol === undefined) {
    warnings.push(
      `BASIS_SPREAD_VOL_ASSUMED: no basis-spread vol supplied – ${Math.round(BASIS_SPREAD_VOL_FRACTION * 100)}% of the ATM swaption normal vol used (conservative upper estimate)`,
    );
  }
  const sLeg0 = leg0.payReceive === "Receive" ? 1 : -1;
  const contractSpread = leg0.spread ?? 0;
  const profile: ExposurePoint[] = [];
  const pv0 = priceInterestRateSwap(ctx, swap, ccy).pv;
  profile.push({ date: ctx.valuationDate, years: 0, epe: Math.max(pv0, 0) * fx, ene: Math.max(-pv0, 0) * fx, pdCpty: 0, pdOwn: 0 });
  let prevT = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const t = dates[i]!;
    const T = yearFraction(ctx.valuationDate, t, "ACT/365F");
    const remaining: InterestRateSwap = { ...swap, upfront: undefined, legs: swap.legs.map((l) => ({ ...l, effectiveDate: t })) };
    let fairSpread: number;
    let annuity: number;
    try {
      const res = priceInterestRateSwap(ctx, remaining, ccy);
      fairSpread = res.analytics.fairSpread as number;
      annuity = res.legs[0]!.annuity ?? 0;
    } catch {
      continue;
    }
    if (!Number.isFinite(fairSpread) || annuity <= 0) continue;
    const tenorLeft = yearFraction(t, maturity, "ACT/365F");
    const spreadVol = credit.basisSpreadVol ?? BASIS_SPREAD_VOL_FRACTION * (surface ? swaptionAtmVol(surface, T, Math.max(tenorLeft, 1 / 12)) : 0.007);
    // Value of the remaining swap to us = sLeg0 · annuity · (K − fair spread):
    // receiving leg 0 → positive exposure when the fair spread falls below K (put on the spread), and vice versa.
    const epeUndisc = bachelier(sLeg0 > 0 ? "Put" : "Call", fairSpread, contractSpread, spreadVol, T);
    const eneUndisc = bachelier(sLeg0 > 0 ? "Call" : "Put", fairSpread, contractSpread, spreadVol, T);
    profile.push({
      date: t,
      years: T,
      epe: annuity * epeUndisc * fx,
      ene: annuity * eneUndisc * fx,
      pdCpty: cptyPd(credit, prevT, T),
      pdOwn: ownPd(credit, prevT, T),
    });
    prevT = T;
  }
  appendMaturityPoint(profile, ctx, maturity, prevT, credit);
  return aggregate(swap.id, reporting, profile, credit, `Basis-swaption replication (Bachelier on the tenor-basis spread), ${hazardLabel(credit)}`, warnings);
}

/**
 * CVA for an FX forward using Garman–Kohlhagen on the forward at each grid
 * date. The t = 0 point is the trade's PV (`priceTrade`, premium included). An
 * unpaid upfront premium (N8-2) is netted while it is outstanding: the value
 * at t is V = N·DF_q·(F_T − K) + c with the premium PV c (quote currency), so
 * EPE = N·DF_q·E[(F_T − K′)⁺] with the shifted strike K′ = K − c/(N·DF_q) –
 * the same μ-shift `cvaGeneric` applies; after the premium date the plain
 * forward exposure remains.
 */
export function cvaFxForward(ctx: MarketContext, fwdTrade: FxForward, credit: CreditInputs, reporting: string): XvaResult {
  const warnings: string[] = [];
  const base = fwdTrade.buyCurrency;
  const quote = fwdTrade.sellCurrency;
  const K = fwdTrade.sellAmount / fwdTrade.buyAmount;
  const T = yearFraction(ctx.valuationDate, fwdTrade.deliveryDate, "ACT/365F");
  const surface = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
  if (!surface) warnings.push("No FX vol surface – 8% vol assumed");
  const fxQ = fxToReporting(ctx, quote, reporting, fwdTrade.collateralCurrency);
  const steps = Math.max(2, Math.min(24, Math.ceil(T * 12)));
  const profile: ExposurePoint[] = [];
  let prevT = 0;
  const F = fxForwardRate(ctx, base, quote, fwdTrade.deliveryDate, fwdTrade.collateralCurrency);
  const dfQ = getDiscountCurve(ctx, quote, fwdTrade.collateralCurrency).df(fwdTrade.deliveryDate);
  const scale = dfQ * fwdTrade.buyAmount * fxQ;
  // N8-2: open premium (PV today, quote currency) shifts the strike while it is outstanding.
  const up = fwdTrade.upfront;
  const premium = up && up.date > ctx.valuationDate ? upfrontPremiumLeg(ctx, fwdTrade, reporting, 2) : undefined;
  const premiumQuote = premium ? premium.pvReporting / fxQ : 0;
  const pv0 = priceTrade(ctx, fwdTrade, reporting).pv;
  profile.push({ date: ctx.valuationDate, years: 0, epe: Math.max(pv0, 0), ene: Math.max(-pv0, 0), pdCpty: 0, pdOwn: 0 });
  for (let i = 1; i <= steps; i++) {
    const t = (T * i) / steps;
    const date = ctx.valuationDate + Math.round(t * 365.25);
    const vol = surface ? fxAtmVol(surface, t) : 0.08;
    const kEff = premium && up!.date > date ? K - premiumQuote / (dfQ * fwdTrade.buyAmount) : K;
    let epe: number;
    let ene: number;
    if (kEff <= 0) {
      // The premium we receive exceeds any possible loss: the value is positive for every spot.
      epe = (F - kEff) * scale;
      ene = 0;
    } else {
      epe = black76("Call", F, kEff, vol, t) * scale;
      ene = black76("Put", F, kEff, vol, t) * scale;
    }
    profile.push({ date, years: t, epe, ene, pdCpty: cptyPd(credit, prevT, t), pdOwn: ownPd(credit, prevT, t) });
    prevT = t;
  }
  return aggregate(fwdTrade.id, reporting, profile, credit, `GK forward-exposure${premium ? " (open premium netted)" : ""}, ${hazardLabel(credit)}`, warnings);
}

function aggregate(tradeId: string, currency: string, profile: ExposurePoint[], credit: CreditInputs, method: string, warnings: string[]): XvaResult {
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

/** Exposure grid: the trade's payment dates plus maturity (quarterly points when there are few cashflows), at most 60 points. */
function exposureGrid(ctx: MarketContext, base: ReturnType<typeof priceTrade>, maturity: number): number[] {
  const val = ctx.valuationDate;
  const set = new Set<number>();
  for (const leg of base.legs) for (const c of leg.cashflows) if (c.paymentDate > val && c.paymentDate <= maturity) set.add(c.paymentDate);
  set.add(maturity);
  if (set.size < 4) {
    const T = maturity - val;
    const steps = Math.max(2, Math.min(40, Math.ceil((T / 365.25) * 4)));
    for (let i = 1; i <= steps; i++) set.add(val + Math.round((T * i) / steps));
  }
  let grid = [...set].sort((a, b) => a - b);
  if (grid.length > 60) {
    const stride = grid.length / 60;
    const thinned = new Set<number>();
    for (let i = 0; i < 60; i++) thinned.add(grid[Math.floor(i * stride)]!);
    thinned.add(maturity);
    grid = [...thinned].sort((a, b) => a - b);
  }
  return grid;
}

/**
 * Generic delta-normal exposure for any instrument (options, CCS, FX swaps):
 * at each grid date t the expected value μ(t) is the PV today of the cashflows
 * paid after t (forward-consistent, discounted) and the dispersion σ(t) is
 * derived from the rate / FX sensitivities of the trade rolled to t
 * (`computeRisk` on the rolled market, so the risk amortises with the
 * remaining cashflows) times the ATM vols at (t, remaining tenor):
 * σ = DF(t)·√((DV01_t·10⁴·σ_N)² + Σ(Δ_FX,t·100·σ_FX)²)·√t. With V ~ N(μ, σ²):
 * EPE = σφ(μ/σ) + μΦ(μ/σ), ENE = EPE − μ. For a vanilla swap this reproduces
 * the swaption-replication method closely (same annuity and vol); for options
 * the normal approximation of the option value is a (conservative) proxy –
 * long options have no negative, short options no positive exposure.
 */
export function cvaGeneric(ctx: MarketContext, trade: Trade, credit: CreditInputs, reporting: string): XvaResult {
  const warnings: string[] = [];
  const base = priceTrade(ctx, trade, reporting);
  const maturity = tradeMaturityDate(trade);
  const T = Math.max(0, yearFraction(ctx.valuationDate, maturity, "ACT/365F"));
  if (T <= 0) return aggregate(trade.id, reporting, [], credit, "Delta-normal (expired)", warnings);
  const ccys = tradeCurrencies(trade);
  const surface = ctx.swaptionVols?.[ccys[0] ?? "EUR"];
  const disc = discountCurveFor(ctx, reporting, ccys[0] ?? reporting, trade.collateralCurrency);
  const cashflows = base.legs.flatMap((l) =>
    l.cashflows.map((c) => ({ date: c.paymentDate, pv: c.presentValue * fxToReporting(ctx, c.currency, reporting, trade.collateralCurrency) })),
  );
  const baseRisk = computeRisk(ctx, trade, reporting, { bucketed: false, vega: false, theta: false });
  const optionTenor = trade.type === "Swaption" ? yearFraction(trade.underlying.legs[0]!.effectiveDate, maturity, "ACT/365F") : undefined;
  const profile: ExposurePoint[] = [{ date: ctx.valuationDate, years: 0, epe: Math.max(base.pv, 0), ene: Math.max(-base.pv, 0), pdCpty: 0, pdOwn: 0 }];
  let prevT = 0;
  for (const date of exposureGrid(ctx, base, maturity)) {
    const t = yearFraction(ctx.valuationDate, date, "ACT/365F");
    if (t <= prevT) continue;
    const days = date - ctx.valuationDate;
    // Expected value: PV today of the cashflows still outstanding after t.
    const mu = cashflows.filter((c) => c.date > date).reduce((s, c) => s + c.pv, 0);
    // Sensitivities of the remaining trade (rolled to t), discounted back to today.
    let risk = baseRisk;
    try {
      risk = computeRisk(rollMarket(ctx, days), trade, reporting, { bucketed: false, vega: false, theta: false });
    } catch {
      // keep today's sensitivities
    }
    const dfT = disc.df(date);
    const tenorLeft = optionTenor ?? Math.max(yearFraction(date, maturity, "ACT/365F"), 1 / 12);
    const rateVol = surface ? swaptionAtmVol(surface, t, tenorLeft) : 0.007;
    const rateVolTerm = Math.pow(risk.dv01 * 1e4 * rateVol, 2);
    const fxVolTerm = Object.entries(risk.fxDelta).reduce((acc, [pair, d]) => {
      const surf = ctx.fxVols?.[pair] ?? ctx.fxVols?.[pair.slice(3) + pair.slice(0, 3)];
      const v = surf ? fxAtmVol(surf, t) : 0.08;
      return acc + Math.pow(d * 100 * v, 2);
    }, 0);
    const sigma = dfT * Math.sqrt((rateVolTerm + fxVolTerm) * t);
    let epe: number;
    let ene: number;
    if (sigma < 1e-9) {
      epe = Math.max(mu, 0);
      ene = Math.max(-mu, 0);
    } else {
      const d = mu / sigma;
      epe = sigma * normPdf(d) + mu * normCdf(d);
      ene = epe - mu;
    }
    // Long options can never have negative value; short options never positive.
    if (isOption(trade)) {
      if (trade.payReceive === "Receive") ene = 0;
      else epe = 0;
    }
    profile.push({ date, years: t, epe, ene, pdCpty: cptyPd(credit, prevT, t), pdOwn: ownPd(credit, prevT, t) });
    prevT = t;
  }
  warnings.push("Näherungsverfahren: Delta-Normal-Exposure (DV01(t)/FX-Delta(t) × ATM-Vol) – konservativ für Optionen und Portfolios ohne Netting");
  return aggregate(
    trade.id,
    reporting,
    profile,
    credit,
    `Delta-normal exposure (rolled sensitivities, ATM vols at (t, remaining tenor)), ${hazardLabel(credit)}`,
    warnings,
  );
}

function discountCurveFor(ctx: MarketContext, reporting: string, fallbackCcy: string, collateral?: string) {
  try {
    return getDiscountCurve(ctx, reporting, collateral);
  } catch {
    return getDiscountCurve(ctx, fallbackCcy, collateral);
  }
}

function isOption(t: Trade): t is Extract<Trade, { payReceive: "Pay" | "Receive"; type: "CapFloor" | "Swaption" | "FxOption" }> {
  return t.type === "CapFloor" || t.type === "Swaption" || t.type === "FxOption";
}

const isFiniteNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Structural problems of a hazard curve (times strictly increasing and positive, hazards finite ≥ 0, recovery in [0, 1)). */
function hazardCurveProblems(curve: unknown, path: string): string[] {
  const out: string[] = [];
  const c = curve as Partial<HazardCurve> | null;
  if (!c || typeof c !== "object" || !Array.isArray(c.times) || !Array.isArray(c.hazards))
    return [`${path} must be a HazardCurve { times, hazards, recovery }`];
  if (c.times.length !== c.hazards.length || c.times.length === 0)
    out.push(`${path}: times (${c.times.length}) and hazards (${c.hazards.length}) must be non-empty arrays of equal length`);
  let prev = 0;
  c.times.forEach((t, i) => {
    if (!isFiniteNum(t) || t <= prev) out.push(`${path}.times[${i}] must be a finite year fraction, strictly increasing and > 0 (got ${String(t)})`);
    else prev = t;
  });
  c.hazards.forEach((h, i) => {
    if (!isFiniteNum(h) || h < 0) out.push(`${path}.hazards[${i}] must be a finite, non-negative hazard rate (got ${String(h)})`);
  });
  if (!isFiniteNum(c.recovery) || c.recovery < 0 || c.recovery >= 1) out.push(`${path}.recovery must be in [0, 1) (got ${String(c.recovery)})`);
  return out;
}

/**
 * Structural validation of `CreditInputs` (N5-4e): recoveries in [0, 1),
 * hazard rates finite and ≥ 0, hazard curves well-formed, basis-spread vol
 * finite ≥ 0. Returns the list of problems (empty = valid); `computeXva`
 * throws `PricingError("INVALID_CREDIT_CURVE")` with it – a missing
 * `cptyRecovery` used to yield `cva: NaN`, `cptyRecovery: 1.5` or a negative
 * hazard a negative CVA, silently.
 */
export function validateCreditInputs(credit: CreditInputs, path = "credit"): string[] {
  const out: string[] = [];
  if (!credit || typeof credit !== "object") return [`${path} must be an object (CreditInputs)`];
  const c = credit as Partial<CreditInputs>;
  if (!isFiniteNum(c.cptyRecovery) || c.cptyRecovery < 0 || c.cptyRecovery >= 1) {
    out.push(`${path}.cptyRecovery must be a finite recovery rate in [0, 1) (got ${String(c.cptyRecovery)})`);
  }
  if (c.cptyHazardCurve === undefined) {
    if (!isFiniteNum(c.cptyHazard) || c.cptyHazard < 0) out.push(`${path}.cptyHazard must be a finite, non-negative hazard rate (got ${String(c.cptyHazard)})`);
  } else {
    out.push(...hazardCurveProblems(c.cptyHazardCurve, `${path}.cptyHazardCurve`));
    if (c.cptyHazard !== undefined && (!isFiniteNum(c.cptyHazard) || c.cptyHazard < 0)) {
      out.push(`${path}.cptyHazard must be a finite, non-negative hazard rate when given (got ${String(c.cptyHazard)})`);
    }
  }
  if (c.ownRecovery !== undefined && (!isFiniteNum(c.ownRecovery) || c.ownRecovery < 0 || c.ownRecovery >= 1)) {
    out.push(`${path}.ownRecovery must be a finite recovery rate in [0, 1) (got ${String(c.ownRecovery)})`);
  }
  if (c.ownHazard !== undefined && (!isFiniteNum(c.ownHazard) || c.ownHazard < 0)) {
    out.push(`${path}.ownHazard must be a finite, non-negative hazard rate (got ${String(c.ownHazard)})`);
  }
  if (c.ownHazardCurve !== undefined) out.push(...hazardCurveProblems(c.ownHazardCurve, `${path}.ownHazardCurve`));
  if (c.basisSpreadVol !== undefined && (!isFiniteNum(c.basisSpreadVol) || c.basisSpreadVol < 0)) {
    out.push(`${path}.basisSpreadVol must be a finite, non-negative normal vol (got ${String(c.basisSpreadVol)})`);
  }
  return out;
}

/** Throw `PricingError("INVALID_CREDIT_CURVE")` listing the problems of `credit` (see `validateCreditInputs`). */
export function assertValidCreditInputs(credit: CreditInputs): void {
  const problems = validateCreditInputs(credit);
  if (problems.length) throw new PricingError("INVALID_CREDIT_CURVE", `Invalid credit inputs: ${problems.join("; ")}`, { problems });
}

/**
 * Dispatch: fixed/float swaps → swaption replication; single-currency tenor
 * basis swaps → basis-swaption replication; FX forwards → GK forward
 * exposure; everything else → generic delta-normal exposure. Invalid
 * `CreditInputs` raise `PricingError("INVALID_CREDIT_CURVE")` (N5-4e) – the
 * CVA is never NaN or negative because of a missing / out-of-range recovery or
 * a negative hazard.
 */
export function computeXva(ctx: MarketContext, trade: Trade, credit: CreditInputs, reporting: string): XvaResult {
  assertValidCreditInputs(credit);
  switch (trade.type) {
    case "InterestRateSwap": {
      const hasFixed = trade.legs.some((l) => l.type === "Fixed");
      if (hasFixed) return cvaSwap(ctx, trade, credit, reporting);
      const singleCcy = new Set(trade.legs.map((l) => l.currency)).size === 1;
      if (trade.legs.length === 2 && singleCcy && trade.legs.every((l) => l.type === "Float")) return cvaBasisSwap(ctx, trade, credit, reporting);
      return cvaGeneric(ctx, trade, credit, reporting);
    }
    case "FxForward":
      return cvaFxForward(ctx, trade, credit, reporting);
    default:
      return cvaGeneric(ctx, trade, credit, reporting);
  }
}

/**
 * Convert a CDS spread (decimal) to a flat hazard rate with the same
 * convention as `bootstrapHazardCurve`: λ ≈ s · (365/360) / (1 − R) – the
 * running spread accrues ACT/360 while the hazard is quoted per ACT/365F year
 * (`CDS_PREMIUM_ACCRUAL_PER_YEAR`, N5-5). Until round 6 this shortcut was
 * s / (1 − R) and therefore 1.4 % below the bootstrap of the same flat quote
 * (N6-2: 100 bp / R 40 % → 166.67 bp vs 168.98 bp undiscounted); a flat-spread
 * CVA/DVA is now consistent with the CDS-curve path to the quarterly
 * discretisation of the bootstrap (≈ 3e-3 relative with discounting).
 */
export function hazardFromSpread(spread: number, recovery: number): number {
  return (spread * CDS_PREMIUM_ACCRUAL_PER_YEAR) / (1 - recovery);
}
