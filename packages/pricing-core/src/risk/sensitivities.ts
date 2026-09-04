import { type CurveBuildSpec, type CurveQuote, bootstrapCurves, bumpQuote, curveDependencies, orderCurveSpecs, quoteLabel } from "../curves/bootstrap.js";
import { type Curve } from "../curves/curve.js";
import { getIndex } from "../curves/index-definitions.js";
import { toISO } from "../dates/date.js";
import { embeddedOptionLegs, tradeIndexNames } from "../instruments/trade-dates.js";
import { type Cashflow, type PricingResult, type Trade } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, withCurves } from "../market/market-context.js";
import { type FxSmileComponent, shiftFxSurface, shiftFxSurfaceRow } from "../models/fx-vol-surface.js";
import { type CapletVolSurface, type SwaptionVolSurface, shiftCapletSurface, shiftSwaptionSurface } from "../models/vol-surfaces.js";
import { splitPair } from "../pricing/fx-pricer.js";
import { fxToReporting } from "../pricing/leg-pricer.js";
import { priceTrade, tradeCurrencies } from "../pricing/price.js";

export interface BucketedDelta {
  curveId: string;
  buckets: { date: string; label: string; delta: number }[];
  total: number;
}

/** Decomposition of the 1-day theta (all in reporting currency). */
export interface ThetaDetail {
  /** Carry-consistent theta: PV(t+1, constant-curve roll) + cashflows paid in (t, t+1] − PV(t). */
  total: number;
  /** Pure carry: PV(t+1, forward-roll of the curves) + cashflows paid − PV(t). */
  carry: number;
  /** Roll-down: total − carry (effect of the curve not realising its forwards). */
  rollDown: number;
  /**
   * Cashflows that are part of PV(t) and leave the valuation by t+1 (coupons
   * paid in (t, t+1], value-today exchanges settled on t), added back so a
   * cashflow dropping out of the PV is not counted as a loss. Cashflows
   * settling exactly on the rolled valuation date that the pricer still values
   * as a value-today exchange (FX legs, `SETTLES_TODAY`) are **not** in this
   * figure – they are counted once, inside the rolled PV (N5-1); their
   * reporting-currency amount is `valueTodayOnRollDate`.
   */
  cashflows: number;
  /**
   * Undiscounted amount (reporting currency) of the FX exchanges (`kind:
   * "Notional"` legs of FX forwards / FX swaps / CCS) settling on the rolled
   * valuation date t+1 that remain part of PV(t+1) as a value-today exchange
   * and are therefore excluded from `cashflows` (N5-1). Option payoff
   * placeholders (swaption expiry, FX option delivery) that the rolled pricer
   * keeps at DF 1 are *not* reported here (N6-4) – they are option values, not
   * amounts settling on the roll date. 0 for trades whose pricer drops
   * cashflows on the valuation date (swaps, caps, FRAs).
   */
  valueTodayOnRollDate: number;
}

export interface RiskReport {
  tradeId: string;
  currency: string;
  pv: number;
  /** PV change for +1bp parallel shift of all rate curves. */
  dv01: number;
  /** Per-curve parallel DV01 */
  dv01ByCurve: Record<string, number>;
  bucketed: BucketedDelta[];
  /**
   * PV change per +1% appreciation of the key's first currency against the
   * reporting currency (key `${ccy}${reporting}`), i.e. positive = we gain when
   * that currency strengthens.
   */
  fxDelta: Record<string, number>;
  /** PV change for +1bp normal vol (IR, +1 vol point for lognormal surfaces) / +1 vol point (FX). */
  vega: Record<string, number>;
  /**
   * 1-day theta, carry-consistent: PV(t+1) with curves rolled (constant zero
   * rates per tenor) plus the cashflows paid in (t, t+1] minus PV(t). Vol
   * surfaces are kept in expiry-years (sticky expiry).
   */
  theta: number;
  /** Carry / roll-down decomposition of `theta`. */
  thetaDetail?: ThetaDetail;
  /** Second-order: PV(+1bp) + PV(-1bp) - 2PV. */
  gamma: number;
}

/** One basis point as a decimal rate / normal-vol shift (the `Curve.shifted*` methods take decimal shifts). */
const BP = 1e-4;

export function shiftCurvesParallel(ctx: MarketContext, curveIds: string[], shift: number): MarketContext {
  const curves: Record<string, Curve> = { ...ctx.curves };
  for (const id of curveIds) {
    const c = ctx.curves[id];
    if (c) curves[id] = c.shiftedParallel(shift);
  }
  return { ...ctx, curves };
}

/** Curves relevant to a trade: discount + projection curves of its currencies. */
export function relevantCurveIds(ctx: MarketContext, trade: Trade): string[] {
  const ccys = tradeCurrencies(trade);
  return Object.entries(ctx.curves)
    .filter(([, c]) => ccys.includes(c.currency))
    .map(([id]) => id);
}

/**
 * Curves a trade actually uses for its valuation: the discount curve of every
 * trade currency under the trade's collateral currency (CSA curve when
 * configured) plus the projection curve of every referenced index. Unlike
 * `relevantCurveIds` (all curves of the currencies, used for risk scoping)
 * this excludes e.g. a USD-CSA discount curve for an EUR-collateralised swap.
 */
export function tradeCurveIds(ctx: MarketContext, trade: Trade): string[] {
  const ids = new Set<string>();
  for (const ccy of tradeCurrencies(trade)) {
    try {
      ids.add(getDiscountCurve(ctx, ccy, trade.collateralCurrency).id);
    } catch {
      // no discount curve configured – nothing to report
    }
  }
  for (const name of tradeIndexNames(trade)) {
    try {
      const id = getIndex(name).curveId;
      if (ctx.curves[id]) ids.add(id);
    } catch {
      // unknown index – pricing would have failed already
    }
  }
  return [...ids];
}

/**
 * Keys of the caplet surfaces a trade's valuation reads: for caps/floors and
 * for swap legs with embedded caps/floors the leg pricer looks up
 * `${ccy}-${index}` first and falls back to `${ccy}`.
 */
export function capletSurfaceKeysFor(ctx: MarketContext, trade: Trade): string[] {
  const vols = ctx.capletVols;
  if (!vols) return [];
  const pick = (ccy: string, indexName: string): string | undefined => {
    const exact = `${ccy}-${getIndex(indexName).name}`;
    if (vols[exact]) return exact;
    return vols[ccy] ? ccy : undefined;
  };
  const keys = new Set<string>();
  if (trade.type === "CapFloor") {
    const k = pick(trade.currency, trade.index);
    if (k) keys.add(k);
  }
  for (const leg of embeddedOptionLegs(trade)) {
    const k = pick(leg.currency, leg.index);
    if (k) keys.add(k);
  }
  return [...keys];
}

/**
 * True when the rolled valuation still contains cashflow `c` of the base
 * valuation as a valued (DF > 0) cashflow – i.e. the pricer treats a cashflow
 * settling on its valuation date as a value-today exchange (FX forward / FX
 * swap legs and option deliveries, R4-2 `SETTLES_TODAY`) instead of dropping it.
 */
function stillValuedInRolled(rolled: PricingResult, c: Cashflow): boolean {
  for (const leg of rolled.legs) {
    if (leg.legIndex !== c.legIndex) continue;
    for (const r of leg.cashflows) {
      if (r.paymentDate === c.paymentDate && r.kind === c.kind && r.currency === c.currency && r.discountFactor > 0) return true;
    }
  }
  return false;
}

/**
 * Cashflows of a priced trade that are paid in (valuationDate, valuationDate + days],
 * converted to the reporting currency (undiscounted amounts). Option payoff
 * placeholders of swaptions / FX options are excluded (their value change is
 * captured by repricing).
 *
 * Single-count rule (N5-1): with the rolled valuation `rolled` a cashflow is
 * counted **iff** it is part of PV(t) (valued at DF > 0 and due no later than
 * t + days) and no longer part of PV(t + days). Swap, cap and FRA pricers drop
 * cashflows with `paymentDate ≤ valuationDate`, so their coupons due tomorrow
 * are counted as cash; FX forward / FX swap legs (and settled FX option
 * payoffs) delivering on the rolled valuation date stay in PV(t + days) as a
 * value-today exchange at DF 1 (R4-2) and are therefore *not* added again –
 * before this rule the theta of an FX forward the day before delivery was ≈
 * its full PV (+122 k on a PV of 123 k instead of −485); an FX exchange
 * settling on t itself (carried in PV(t) as value-today, gone from PV(t + days))
 * is counted as cash received, so its theta is 0 rather than −PV. The upfront
 * premium of swaptions, caps/floors, FX options and swap fees is a `Premium`
 * cashflow (N6-1) and follows the same rule: due on t + days it leaves the PV
 * (DF 0 once settled) and is counted as paid, so the theta on the day before
 * the premium payment is the carry, not ≈ +premium. Without `rolled` (legacy
 * call) every cashflow in (t, t + days] except option payoff placeholders is
 * counted.
 */
export function cashflowsPaidWithin(
  ctx: MarketContext,
  trade: Trade,
  base: PricingResult,
  days: number,
  reportingCurrency: string,
  rolled?: PricingResult,
): number {
  return splitCashflowsWithin(ctx, trade, base, days, reportingCurrency, rolled).paid;
}

/** `cashflowsPaidWithin` plus the value-today amount left inside the rolled PV (see `ThetaDetail`). */
function splitCashflowsWithin(
  ctx: MarketContext,
  trade: Trade,
  base: PricingResult,
  days: number,
  reportingCurrency: string,
  rolled?: PricingResult,
): { paid: number; valueToday: number } {
  const val = ctx.valuationDate;
  let paid = 0;
  let valueToday = 0;
  for (const leg of base.legs) {
    for (const c of leg.cashflows) {
      if (rolled) {
        // Single-count rule: a cashflow is added back iff it is part of PV(t) (valued, DF > 0, due no later
        // than t + days) and no longer part of PV(t + days). Cashflows the rolled pricer still values as a
        // value-today exchange on t + days stay inside PV(t + days); an exchange settled on t itself that
        // PV(t) carries as value-today (R4-2) and PV(t + days) has dropped is cash received – theta 0, not −PV.
        if (!(c.paymentDate <= val + days && c.discountFactor > 0)) continue;
        const amount = c.amount * fxToReporting(ctx, c.currency, reportingCurrency, trade.collateralCurrency);
        if (stillValuedInRolled(rolled, c)) {
          // N6-4: only genuine exchanges settling on t + days are reported as value-today; option payoff
          // placeholders (swaption at expiry, FX option delivery) stay option values inside PV(t + days).
          if (c.kind !== "OptionPayoff") valueToday += amount;
        } else paid += amount;
        continue;
      }
      if (!(c.paymentDate > val && c.paymentDate <= val + days)) continue;
      if (c.kind === "OptionPayoff" && (trade.type === "Swaption" || trade.type === "FxOption")) continue;
      paid += c.amount * fxToReporting(ctx, c.currency, reportingCurrency, trade.collateralCurrency);
    }
  }
  return { paid, valueToday };
}

/**
 * Carry-consistent 1-day theta with carry / roll-down decomposition:
 * theta = PV(t+1) + cashflows paid in (t, t+1] − PV(t), every cashflow counted
 * exactly once (cashflows settling on t+1 that the pricer keeps as value-today
 * exchanges are in PV(t+1), not in `cashflows` – N5-1).
 */
export function computeTheta(ctx: MarketContext, trade: Trade, reportingCurrency: string, base?: PricingResult, days = 1): ThetaDetail {
  const b = base ?? priceTrade(ctx, trade, reportingCurrency);
  const rolledResult = priceTrade(rollMarket(ctx, days), trade, reportingCurrency);
  const { paid, valueToday } = splitCashflowsWithin(ctx, trade, b, days, reportingCurrency, rolledResult);
  const pvRolled = rolledResult.pv;
  const pvForward = priceTrade(rollMarketForward(ctx, days), trade, reportingCurrency).pv;
  const total = pvRolled + paid - b.pv;
  const carry = pvForward + paid - b.pv;
  return { total, carry, rollDown: total - carry, cashflows: paid, valueTodayOnRollDate: valueToday };
}

export function computeRisk(
  ctx: MarketContext,
  trade: Trade,
  reportingCurrency: string,
  opts: { bucketed?: boolean; vega?: boolean; theta?: boolean } = {},
): RiskReport {
  const base = priceTrade(ctx, trade, reportingCurrency);
  const curveIds = relevantCurveIds(ctx, trade);
  const up = priceTrade(shiftCurvesParallel(ctx, curveIds, BP), trade, reportingCurrency).pv;
  const down = priceTrade(shiftCurvesParallel(ctx, curveIds, -BP), trade, reportingCurrency).pv;
  const dv01 = (up - down) / 2;
  const gamma = up + down - 2 * base.pv;

  const dv01ByCurve: Record<string, number> = {};
  for (const id of curveIds) {
    const u = priceTrade(shiftCurvesParallel(ctx, [id], BP), trade, reportingCurrency).pv;
    const d = priceTrade(shiftCurvesParallel(ctx, [id], -BP), trade, reportingCurrency).pv;
    dv01ByCurve[id] = (u - d) / 2;
  }

  const bucketed: BucketedDelta[] = [];
  if (opts.bucketed ?? true) {
    for (const id of curveIds) {
      const c = ctx.curves[id]!;
      const buckets = c.nodeDates.map((d, i) => {
        const u = priceTrade({ ...ctx, curves: { ...ctx.curves, [id]: c.shiftedNode(i, BP) } }, trade, reportingCurrency).pv;
        const dn = priceTrade({ ...ctx, curves: { ...ctx.curves, [id]: c.shiftedNode(i, -BP) } }, trade, reportingCurrency).pv;
        return { date: toISO(d), label: tenorLabel(ctx.valuationDate, d), delta: (u - dn) / 2 };
      });
      bucketed.push({ curveId: id, buckets, total: buckets.reduce((s, b) => s + b.delta, 0) });
    }
  }

  const fxDelta: Record<string, number> = {};
  for (const ccy of tradeCurrencies(trade)) {
    if (ccy === reportingCurrency) continue;
    const shifted = shiftFxSpots(ctx, ccy, 0.01);
    const shiftedDown = shiftFxSpots(ctx, ccy, -0.01);
    fxDelta[`${ccy}${reportingCurrency}`] = (priceTrade(shifted, trade, reportingCurrency).pv - priceTrade(shiftedDown, trade, reportingCurrency).pv) / 2;
  }

  const vega: Record<string, number> = {};
  if (opts.vega ?? true) {
    if (trade.type === "Swaption" && ctx.swaptionVols) {
      for (const [k, s] of Object.entries(ctx.swaptionVols)) {
        // Economic currencies only: a foreign-currency premium carries no vol exposure (N7-3).
        if (!tradeCurrencies(trade, { upfront: false }).includes(s.currency)) continue;
        const shift = s.volType === "Normal" ? BP : 0.01;
        const u = priceTrade({ ...ctx, swaptionVols: { ...ctx.swaptionVols, [k]: shiftSwaptionSurface(s, shift) } }, trade, reportingCurrency).pv;
        vega[`swaption:${k}`] = u - base.pv;
      }
    }
    // Caps/floors and swaps with embedded caps/floors (feature detection, R2-2):
    // bump the caplet surface(s) the valuation actually reads.
    if (ctx.capletVols) {
      for (const k of capletSurfaceKeysFor(ctx, trade)) {
        const s = ctx.capletVols[k]!;
        const shift = s.volType === "Normal" ? BP : 0.01;
        const u = priceTrade({ ...ctx, capletVols: { ...ctx.capletVols, [k]: shiftCapletSurface(s, shift) } }, trade, reportingCurrency).pv;
        vega[`caplet:${k}`] = u - base.pv;
      }
    }
    if (trade.type === "FxOption" && ctx.fxVols) {
      const { base: b, quote: q } = splitPair(trade.pair);
      for (const [k, s] of Object.entries(ctx.fxVols)) {
        const key = k.toUpperCase();
        // Exact pair match, including the inverted quotation of the same pair.
        if (key !== `${b}${q}` && key !== `${q}${b}`) continue;
        const u = priceTrade({ ...ctx, fxVols: { ...ctx.fxVols, [k]: shiftFxSurface(s, 0.01) } }, trade, reportingCurrency).pv;
        vega[`fx:${k}`] = u - base.pv;
      }
    }
  }

  let theta = 0;
  let thetaDetail: ThetaDetail | undefined;
  if (opts.theta ?? true) {
    try {
      thetaDetail = computeTheta(ctx, trade, reportingCurrency, base, 1);
      theta = thetaDetail.total;
    } catch {
      theta = Number.NaN;
    }
  }

  return { tradeId: trade.id, currency: reportingCurrency, pv: base.pv, dv01, dv01ByCurve, bucketed, fxDelta, vega, theta, thetaDetail, gamma };
}

/**
 * Roll the market forward by `days` keeping zero rates per tenor constant
 * (constant-curve roll). Used for theta and time-shift scenarios. Fixings are
 * not extended: periods that start to accrue inside the roll window are
 * projected with the curve's first forward.
 */
export function rollMarket(ctx: MarketContext, days: number): MarketContext {
  const newDate = ctx.valuationDate + days;
  const curves: Record<string, Curve> = {};
  for (const [id, c] of Object.entries(ctx.curves)) curves[id] = c.rolledTo(newDate);
  return { ...ctx, valuationDate: newDate, curves };
}

/**
 * Roll the market forward by `days` along the forward curves (the curve at
 * t + days is today's implied forward curve). Used for the carry component of
 * theta; falls back to the constant-curve roll for curve implementations
 * without `forwardRolledTo`.
 */
export function rollMarketForward(ctx: MarketContext, days: number): MarketContext {
  const newDate = ctx.valuationDate + days;
  const curves: Record<string, Curve> = {};
  for (const [id, c] of Object.entries(ctx.curves)) curves[id] = c.forwardRolledTo ? c.forwardRolledTo(newDate) : c.rolledTo(newDate);
  return { ...ctx, valuationDate: newDate, curves };
}

/** Shift all spots involving `ccy` so that ccy appreciates by `pct` versus everything else. */
export function shiftFxSpots(ctx: MarketContext, ccy: string, pct: number): MarketContext {
  const spots: Record<string, number> = {};
  for (const [pair, rate] of Object.entries(ctx.fxSpots)) {
    const base = pair.slice(0, 3);
    const quote = pair.slice(3, 6);
    if (base === ccy) spots[pair] = rate * (1 + pct);
    else if (quote === ccy) spots[pair] = rate / (1 + pct);
    else spots[pair] = rate;
  }
  return { ...ctx, fxSpots: spots };
}

export function tenorLabel(valuationDate: number, date: number): string {
  const days = date - valuationDate;
  if (days < 20) return `${days}D`;
  if (days < 360) return `${Math.round(days / 30.4375)}M`;
  const years = Math.round((days / 365.25) * 2) / 2;
  return `${years}Y`;
}

// ---------------------------------------------------------------------------
// Par-rate (market-quote) risk
// ---------------------------------------------------------------------------

/**
 * Curve build definitions for `parRisk`, keyed by curve id. `id` may be
 * omitted (the key is used). Same shape as `CurveBuildSpec`, i.e. quotes +
 * index + currency + optional `discountCurveId` / `referenceCurveIds`.
 */
export type ParRiskSpecs = Record<string, Omit<CurveBuildSpec, "id"> & { id?: string }>;

export interface ParRiskBucket {
  /** Instrument label, e.g. "OIS 5Y", "Swap 10Y", "FRA 6x12". */
  label: string;
  quote: CurveQuote;
  /** PV change (reporting currency) for +`bumpBp` on this quote, all dependent curves re-bootstrapped. */
  delta: number;
}

export interface ParRiskCurve {
  curveId: string;
  buckets: ParRiskBucket[];
  total: number;
}

export interface ParRiskReport {
  tradeId: string;
  currency: string;
  pv: number;
  curves: ParRiskCurve[];
  /** Sum over all curves and quotes (≈ parallel DV01 in par-rate terms). */
  total: number;
  /** Bump size used (bp). */
  bumpBp: number;
}

export interface ParRiskOptions {
  /** Curves to bump (default: all specs whose currency the trade references and that exist in `ctx`). */
  curveIds?: string[];
  /** Bump size in bp (default 1). */
  bumpBp?: number;
}

/**
 * Market-quote ("par") risk: for every curve and every bootstrap quote, bump
 * the quote by +1bp, re-bootstrap the curve and – in dependency order – every
 * curve built on top of it (OIS → dual-curve projection curves → basis /
 * collateral curves), reprice and report the PV change. Curves not affected
 * by the bump are taken unchanged from `ctx`. Thin wrapper around
 * `parRiskPortfolio` for a single trade.
 */
export function parRisk(ctx: MarketContext, trade: Trade, reportingCurrency: string, specs: ParRiskSpecs, opts: ParRiskOptions = {}): ParRiskReport {
  return parRiskPortfolio(ctx, [trade], reportingCurrency, specs, opts)[0]!;
}

/**
 * Par-rate risk for a portfolio: every bumped curve set (one per quote of
 * every targeted curve, including the re-bootstrap of all dependent curves)
 * is built exactly once and all trades are repriced on it, so the cost of the
 * expensive re-bootstrapping is shared across the book instead of paid per
 * trade. Each trade's report only contains the curves that would be targeted
 * for it alone (`opts.curveIds` overrides this for all trades), so the result
 * is identical to calling `parRisk` trade by trade.
 */
export function parRiskPortfolio(
  ctx: MarketContext,
  trades: Trade[],
  reportingCurrency: string,
  specs: ParRiskSpecs,
  opts: ParRiskOptions = {},
): ParRiskReport[] {
  const bumpBp = opts.bumpBp ?? 1;
  const all: CurveBuildSpec[] = Object.entries(specs).map(([key, s]) => ({ ...s, id: s.id ?? key }));
  const ordered = orderCurveSpecs(all);
  const bases = trades.map((t) => priceTrade(ctx, t, reportingCurrency).pv);
  // Curves targeted per trade (default: specs of the trade's currencies that exist in ctx).
  const targetsPerTrade = trades.map((t) => {
    if (opts.curveIds) return opts.curveIds;
    const ccys = tradeCurrencies(t);
    return ordered.filter((s) => ccys.includes(s.currency) && ctx.curves[s.id] !== undefined).map((s) => s.id);
  });
  const union: string[] = [];
  for (const ts of targetsPerTrade) for (const id of ts) if (!union.includes(id)) union.push(id);

  // Transitive dependency closure (ordered is topological, so deps are already resolved).
  const closure = new Map<string, Set<string>>();
  for (const s of ordered) {
    const set = new Set<string>();
    for (const d of curveDependencies(s)) {
      set.add(d);
      for (const dd of closure.get(d) ?? []) set.add(dd);
    }
    closure.set(s.id, set);
  }

  // curveId → per-trade bucket lists (only for trades targeting the curve).
  const bucketsByCurve = new Map<string, Map<number, ParRiskBucket[]>>();
  for (const id of ordered.map((s) => s.id)) {
    if (!union.includes(id)) continue;
    const spec = ordered.find((s) => s.id === id)!;
    const tradeIdx = trades.map((_, i) => i).filter((i) => targetsPerTrade[i]!.includes(id));
    const perTrade = new Map<number, ParRiskBucket[]>(tradeIdx.map((i) => [i, []]));
    const rebuild = ordered.filter((s) => s.id === id || closure.get(s.id)!.has(id));
    spec.quotes.forEach((q, qi) => {
      const bumped = rebuild.map((s) => (s.id === id ? { ...s, quotes: s.quotes.map((qq, j) => (j === qi ? bumpQuote(qq, bumpBp) : qq)) } : s));
      const { curves: rebuilt } = bootstrapCurves(ctx.valuationDate, bumped, ctx.curves);
      const shifted = withCurves(ctx, rebuilt);
      for (const i of tradeIdx) {
        const pv = priceTrade(shifted, trades[i]!, reportingCurrency).pv;
        perTrade.get(i)!.push({ label: quoteLabel(q), quote: q, delta: pv - bases[i]! });
      }
    });
    bucketsByCurve.set(id, perTrade);
  }

  return trades.map((trade, i): ParRiskReport => {
    const curves: ParRiskCurve[] = [];
    for (const id of targetsPerTrade[i]!) {
      const buckets = bucketsByCurve.get(id)?.get(i);
      if (!buckets) continue;
      curves.push({ curveId: id, buckets, total: buckets.reduce((s, b) => s + b.delta, 0) });
    }
    return {
      tradeId: trade.id,
      currency: reportingCurrency,
      pv: bases[i]!,
      curves,
      total: curves.reduce((s, c) => s + c.total, 0),
      bumpBp,
    };
  });
}

// ---------------------------------------------------------------------------
// Bucketed vega (per expiry, or expiry × tenor for swaptions)
// ---------------------------------------------------------------------------

export interface VegaBucket {
  /** Expiry in years (surface grid point). */
  expiry: number;
  /** Underlying swap tenor in years – only set for `dimension: "expiry-tenor"` swaption buckets. */
  tenor?: number;
  /** "2Y" (expiry rows), "2Yx5Y" (expiry × tenor cells) or "1Y RR25" / "1Y BF25" (FX smile buckets). */
  label: string;
  /**
   * PV change for +1bp normal vol (+1 vol point for lognormal surfaces) on this
   * expiry row / cell; FX: +1 vol point on the row's ATM (or RR/BF for smile buckets).
   */
  vega: number;
  /** FX surfaces only: the bumped quote of the row ("atm" for the ATM row buckets, "rr25" / "bf25" for smile buckets). */
  component?: FxSmileComponent;
}

export interface VegaBucketReport {
  /** Key of the surface in the market context (e.g. "EUR", "EUR-EURIBOR-6M" or the FX pair "EURUSD"). */
  key: string;
  surfaceId: string;
  kind: "swaption" | "caplet" | "fx";
  /** Bucket layout: expiry rows (default) or expiry × tenor cells (swaption cubes only). */
  dimension: "expiry" | "expiry-tenor";
  buckets: VegaBucket[];
  /**
   * Sum of the buckets. For FX surfaces only the ATM buckets are summed
   * (≈ parallel vega `computeRisk().vega["fx:<pair>"]`); smile buckets are
   * reported separately and excluded from the total.
   */
  total: number;
}

export interface VegaBucketOptions {
  /**
   * "expiry" (default): one bucket per expiry row of the surface. "expiry-tenor":
   * one bucket per (expiry, tenor) cell of the swaption cube (Bloomberg / ORE
   * layout, needed to read off the tenor hedge of a swaption book); caplet
   * surfaces have no tenor dimension and always report expiry rows.
   */
  dimension?: "expiry" | "expiry-tenor";
  /**
   * FX surfaces: also report smile buckets – the 25Δ risk reversal and
   * butterfly of every expiry row bumped by +1 vol point (`component`
   * "rr25" / "bf25"). Default false (ATM rows only).
   */
  smile?: boolean;
}

function expiryLabel(years: number): string {
  if (years < 1 / 12 - 1e-9) return `${Math.max(1, Math.round(years * 52))}W`;
  if (years < 1) return `${Math.round(years * 12)}M`;
  return Number.isInteger(years) ? `${years}Y` : `${years.toFixed(2)}Y`;
}

function shiftSwaptionRow(s: SwaptionVolSurface, row: number, shift: number): SwaptionVolSurface {
  return { ...s, atm: s.atm.map((r, i) => (i === row ? r.map((v) => Math.max(1e-6, v + shift)) : r)) };
}

function shiftSwaptionCell(s: SwaptionVolSurface, row: number, col: number, shift: number): SwaptionVolSurface {
  return { ...s, atm: s.atm.map((r, i) => (i === row ? r.map((v, j) => (j === col ? Math.max(1e-6, v + shift) : v)) : r)) };
}

function shiftCapletRow(s: CapletVolSurface, row: number, shift: number): CapletVolSurface {
  return { ...s, vols: s.vols.map((r, i) => (i === row ? r.map((v) => Math.max(1e-6, v + shift)) : r)) };
}

/** Keys of the FX vol surfaces an FX option's valuation reads (the pair, in either quotation). */
export function fxSurfaceKeysFor(ctx: MarketContext, trade: Trade): string[] {
  if (trade.type !== "FxOption" || !ctx.fxVols || trade.volOverride !== undefined) return [];
  const { base, quote } = splitPair(trade.pair);
  return Object.keys(ctx.fxVols).filter((k) => {
    const key = k.toUpperCase();
    return key === `${base}${quote}` || key === `${quote}${base}`;
  });
}

/**
 * Vega per bucket for swaptions (swaption cube rows, or expiry × tenor cells
 * with `dimension: "expiry-tenor"`), caps/floors and swaps with embedded
 * caps/floors (caplet surface rows): each row / cell is bumped by +1bp normal
 * vol (or +1 vol point for lognormal surfaces) and the trade repriced. FX
 * options: every expiry row of the pair's `FxVolSurface` has its ATM vol
 * bumped by +1 vol point (`kind: "fx"`, keyed by pair); with `opts.smile` the
 * 25Δ risk reversal and butterfly of each row are bumped as separate smile
 * buckets (`component` "rr25" / "bf25", not part of `total`). The buckets sum
 * to the parallel vega up to smile (SABR / delta-space) non-linearity and the
 * variance interpolation between FX expiries. Trades without optionality
 * return an empty list.
 */
export function vegaBuckets(ctx: MarketContext, trade: Trade, reportingCurrency: string, opts: VegaBucketOptions = {}): VegaBucketReport[] {
  const out: VegaBucketReport[] = [];
  const dimension = opts.dimension ?? "expiry";
  const capletKeys = capletSurfaceKeysFor(ctx, trade);
  const fxKeys = fxSurfaceKeysFor(ctx, trade);
  if (trade.type !== "Swaption" && capletKeys.length === 0 && fxKeys.length === 0) return out;
  const base = priceTrade(ctx, trade, reportingCurrency).pv;
  if (trade.type === "Swaption" && ctx.swaptionVols) {
    for (const [k, s] of Object.entries(ctx.swaptionVols)) {
      if (!tradeCurrencies(trade, { upfront: false }).includes(s.currency)) continue;
      const shift = s.volType === "Normal" ? BP : 0.01;
      const reprice = (shifted: SwaptionVolSurface) =>
        priceTrade({ ...ctx, swaptionVols: { ...ctx.swaptionVols, [k]: shifted } }, trade, reportingCurrency).pv - base;
      let buckets: VegaBucket[];
      if (dimension === "expiry-tenor") {
        buckets = s.expiries.flatMap((e, i) =>
          s.tenors.map((tn, j): VegaBucket => ({
            expiry: e,
            tenor: tn,
            label: `${expiryLabel(e)}x${expiryLabel(tn)}`,
            vega: reprice(shiftSwaptionCell(s, i, j, shift)),
          })),
        );
      } else {
        buckets = s.expiries.map((e, i): VegaBucket => ({ expiry: e, label: expiryLabel(e), vega: reprice(shiftSwaptionRow(s, i, shift)) }));
      }
      out.push({ key: k, surfaceId: s.id, kind: "swaption", dimension, buckets, total: buckets.reduce((a, b) => a + b.vega, 0) });
    }
  }
  if (ctx.capletVols) {
    for (const k of capletKeys) {
      const s = ctx.capletVols[k]!;
      const shift = s.volType === "Normal" ? BP : 0.01;
      const buckets = s.expiries.map((e, i): VegaBucket => {
        const shifted = shiftCapletRow(s, i, shift);
        const pv = priceTrade({ ...ctx, capletVols: { ...ctx.capletVols, [k]: shifted } }, trade, reportingCurrency).pv;
        return { expiry: e, label: expiryLabel(e), vega: pv - base };
      });
      out.push({ key: k, surfaceId: s.id, kind: "caplet", dimension: "expiry", buckets, total: buckets.reduce((a, b) => a + b.vega, 0) });
    }
  }
  if (ctx.fxVols) {
    for (const k of fxKeys) {
      const s = ctx.fxVols[k]!;
      const reprice = (row: number, component: FxSmileComponent) =>
        priceTrade({ ...ctx, fxVols: { ...ctx.fxVols, [k]: shiftFxSurfaceRow(s, row, 0.01, component) } }, trade, reportingCurrency).pv - base;
      const buckets: VegaBucket[] = s.expiries.map((e, i): VegaBucket => ({ expiry: e, label: expiryLabel(e), vega: reprice(i, "atm"), component: "atm" }));
      const total = buckets.reduce((a, b) => a + b.vega, 0);
      if (opts.smile) {
        for (const component of ["rr25", "bf25"] as const) {
          s.expiries.forEach((e, i) => {
            buckets.push({ expiry: e, label: `${expiryLabel(e)} ${component.toUpperCase()}`, vega: reprice(i, component), component });
          });
        }
      }
      out.push({ key: k, surfaceId: s.id, kind: "fx", dimension: "expiry", buckets, total });
    }
  }
  return out;
}
