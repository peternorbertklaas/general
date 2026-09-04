import { type BusinessDayConvention, type Calendar, type CalendarId, addBusinessDays, adjust, advance, getCalendar } from "../dates/calendar.js";
import { type SerialDate, addTenor, immDate, nextImmDate, parseISO } from "../dates/date.js";
import { type DayCountConvention, yearFraction } from "../dates/daycount.js";
import { type CrossCurrencySwap, type FloatLeg, type InterestRateSwap } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { fxPairCalendar, fxSpotDateFrom, pipFactor as pairPipFactor } from "../market/fx-spot.js";
import { brent } from "../math/rootfind.js";
import { type InterpolationMethod, isNonLocalInterpolation } from "../math/interpolation.js";
import { priceCrossCurrencySwap, priceInterestRateSwap } from "../pricing/swap-pricer.js";
import { type Curve, type CurveNode, type ForwardJump, InterpolatedCurve } from "./curve.js";
import { getIndex, getSwapConventions, indexScheduleCalendar, type RateIndex } from "./index-definitions.js";
import { PricingError } from "../errors.js";

/**
 * Market quote used as a bootstrap instrument. Each quote adds exactly one
 * pillar to the curve (at the instrument's maturity).
 *
 * - `Deposit` / `FRA` / `Future`: the curve forward over the instrument's
 *   accrual period must equal the quoted (implied) rate.
 * - `Swap` / `OIS`: the par swap must have zero NPV (dual-curve when
 *   `spec.discountCurve` is given, single-curve otherwise).
 * - `BasisSwap`: tenor basis swap "this index + spread vs `otherIndex`";
 *   the other index is projected from `spec.referenceCurves[otherCurveId]`.
 * - `XccyBasis`: cross-currency basis swap used to build a collateral-adjusted
 *   discount curve (the curve being built acts as domestic discount curve).
 * - `FxSwapPoints`: FX forward points (short end of an implied / collateral
 *   discount curve): covered interest parity with the other currency's discount
 *   curve gives the discount factor of the curve being built at the FX
 *   delivery date.
 */
export type CurveQuote =
  | { type: "Deposit"; tenor: string; rate: number }
  | { type: "FRA"; start: string; end: string; rate: number }
  | { type: "Swap"; tenor: string; rate: number }
  | { type: "OIS"; tenor: string; rate: number }
  | {
      type: "Future";
      /**
       * Start of the underlying 3M deposit: an IMM month ("2026-12" → third
       * Wednesday of December 2026), an ISO date, or a tenor ("3M" → first
       * quarterly IMM date on/after spot + 3M).
       */
      start: string;
      /** Futures price, e.g. 97.85 → implied forward 2.15%. */
      price: number;
      /** Convexity adjustment in bp subtracted from the futures-implied rate to get the forward. */
      convexityBp?: number;
    }
  | {
      type: "BasisSwap";
      tenor: string;
      /** Spread (decimal) paid on top of this curve's index. */
      spread: number;
      /** Index of the other leg, e.g. "EURIBOR-6M" or "ESTR". */
      otherIndex: string;
      /** Id (key in `spec.referenceCurves`) of the curve projecting `otherIndex`. */
      otherCurveId: string;
    }
  | {
      type: "XccyBasis";
      tenor: string;
      /** Basis spread (decimal) on the domestic floating leg, e.g. -0.0020 for -20bp. */
      spread: number;
      foreignCurrency: string;
      /** Discount curve for the foreign leg (e.g. "USD-SOFR"). */
      foreignDiscountCurveId: string;
      /** Projection curve of the foreign floating index (e.g. "USD-SOFR"). */
      foreignProjectionCurveId: string;
      /** Projection curve of the domestic floating index (e.g. "EUR-ESTR"). */
      domesticProjectionCurveId: string;
      /** FX spot quoted as 1 domestic = `fxSpot` foreign (e.g. EURUSD 1.16). */
      fxSpot: number;
      /** Optional overrides; default: index stored in the projection curve meta, else RFR of the currency. */
      domesticIndex?: string;
      foreignIndex?: string;
    }
  | {
      type: "FxSwapPoints";
      /** Tenor from the FX spot date, e.g. "1M", "3M", "1Y" (pillar = delivery date on the pair calendar). */
      tenor: string;
      /** Forward points in pips (outright forward = spot + points / pipFactor). */
      points: number;
      /** Pair "EURUSD" – the curve currency must be the base or the quote currency. */
      pair: string;
      /** Pip denominator; default 10,000 (100 for JPY-style quotes). */
      pipFactor?: number;
      /** FX spot of `pair` for value on the spot date. */
      fxSpot: number;
      /** Id (key in `spec.referenceCurves`) of the discount curve of the *other* currency of the pair. */
      otherDiscountCurveId: string;
    };

export type FutureQuote = Extract<CurveQuote, { type: "Future" }>;
export type BasisSwapQuote = Extract<CurveQuote, { type: "BasisSwap" }>;
export type XccyBasisQuote = Extract<CurveQuote, { type: "XccyBasis" }>;
export type FxSwapPointsQuote = Extract<CurveQuote, { type: "FxSwapPoints" }>;

export interface BootstrapSpec {
  id: string;
  currency: string;
  /** Index projected by this curve, e.g. "ESTR" or "EURIBOR-6M". */
  index: string;
  quotes: CurveQuote[];
  interpolation?: InterpolationMethod;
  dayCount?: DayCountConvention;
  /** Discount curve to use for dual-curve stripping (defaults to the curve itself). */
  discountCurve?: Curve;
  /** Override spot lag (business days). */
  spotLag?: number;
  /**
   * Curves referenced by `BasisSwap` / `XccyBasis` quotes, keyed by the id used
   * in the quote (`otherCurveId`, `foreignDiscountCurveId`, ...).
   */
  referenceCurves?: Record<string, Curve>;
  /**
   * Pillar-merge tolerance in calendar days (default 0 = off). Quotes whose
   * pillar dates lie within the tolerance of each other (e.g. the FRA 3x6
   * ending 2027-03-08 and the Dec-26 future ending 2027-03-16) would otherwise
   * create two pillars eight days apart with a spurious forward kink between
   * them. With a tolerance the cluster keeps one instrument – priority
   * Future > FRA > Deposit > Swap/OIS/basis, ties resolved to the later
   * maturity – and the dropped quotes are reported in `mergedQuotes` with
   * their residual on the final curve.
   */
  pillarMergeToleranceDays?: number;
  /**
   * Turn-of-year jumps: the instantaneous forward over the window starting at
   * `date` is raised by `bp` on top of the interpolated curve; the pillars are
   * re-solved so every quote still reprices (see `ForwardJump`). Without
   * `days` the window is the business-day span over the turn on the index
   * calendar – from the last business day on/before `date` to the next
   * business day (Thu 31 Dec 2026 → Mon 4 Jan 2027 = 4 calendar days), which
   * is the period the market's turn premium on the overnight rate refers to
   * (R3-6, `turnOfYearWindow`). `date` itself is moved to that last business
   * day when it falls on a holiday.
   */
  turnOfYear?: { date: SerialDate; bp: number; days?: number }[];
  /**
   * Global re-solve sweeps after the sequential pass (Gauss–Seidel over the
   * pillars). Default: 6 for non-local interpolations (cubic spline, monotone
   * convex – a later pillar changes the interpolation of earlier intervals),
   * 0 otherwise. Stops early once every residual is below 1e-12.
   */
  globalSweeps?: number;
}

export interface BootstrapResult {
  curve: InterpolatedCurve;
  /** Residual per instrument (rate difference for Deposit/FRA/Future, NPV per unit notional otherwise; should be ~0). */
  residuals: { quote: CurveQuote; maturity: SerialDate; residual: number }[];
  /** Quotes dropped by `pillarMergeToleranceDays` (residual measured on the final curve, typically a few 0.1bp). */
  mergedQuotes: { quote: CurveQuote; maturity: SerialDate; mergedInto: SerialDate; residual: number }[];
}

/** Merge priority of quote types when pillars are within the tolerance (higher wins). */
function mergePriority(q: CurveQuote): number {
  switch (q.type) {
    case "Future":
      return 3;
    case "FRA":
      return 2;
    case "Deposit":
      return 1;
    default:
      return 0;
  }
}

/**
 * Split sorted quote items into the ones kept and the ones merged away under
 * the pillar tolerance (see `BootstrapSpec.pillarMergeToleranceDays`).
 */
function mergePillars<T extends { q: CurveQuote; end: SerialDate }>(items: T[], toleranceDays: number): { kept: T[]; merged: { item: T; into: T }[] } {
  if (toleranceDays <= 0 || items.length < 2) return { kept: items, merged: [] };
  const kept: T[] = [];
  const merged: { item: T; into: T }[] = [];
  let cluster: T[] = [];
  const flush = () => {
    if (cluster.length === 0) return;
    const winner = cluster.reduce((a, b) => {
      const pa = mergePriority(a.q);
      const pb = mergePriority(b.q);
      if (pb !== pa) return pb > pa ? b : a;
      return b.end >= a.end ? b : a;
    });
    kept.push(winner);
    for (const it of cluster) if (it !== winner) merged.push({ item: it, into: winner });
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.end - cluster[cluster.length - 1]!.end > toleranceDays) flush();
    cluster.push(it);
  }
  flush();
  return { kept, merged };
}

/** Notional used for the par instruments inside the solver (residuals are normalised by it). */
const SOLVER_NOTIONAL = 1e6;

/** Futures-implied forward rate: (100 − price)/100 minus the convexity adjustment. */
export function futureImpliedForward(q: FutureQuote): number {
  return (100 - q.price) / 100 - (q.convexityBp ?? 0) * 1e-4;
}

/**
 * Resolve the start date of a money-market future. Accepts an IMM month
 * ("2026-12"), an ISO date, or a tenor ("3M" = first quarterly IMM date on or
 * after spot + tenor). Holidays are rolled forward.
 */
export function resolveFutureStart(start: string, spot: SerialDate, cal: Calendar): SerialDate {
  const s = start.trim();
  let d: SerialDate;
  const ym = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (ym) d = immDate(Number(ym[1]), Number(ym[2]));
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = parseISO(s);
  else d = nextImmDate(addTenor(spot, s) - 1);
  return adjust(d, "Following", cal);
}

/** Calendar and payment lag of a basis / xccy instrument (its pillar sits on the last payment date). */
type LagInfo = (q: BasisSwapQuote | XccyBasisQuote) => { cal: Calendar; payLag: number };

function quoteMaturity(
  q: CurveQuote,
  spot: SerialDate,
  idx: RateIndex,
  cal: Calendar,
  bdc: BusinessDayConvention,
  lag?: LagInfo,
  valuationDate: SerialDate = spot,
): { start: SerialDate; end: SerialDate; endUnadjusted: SerialDate } {
  switch (q.type) {
    case "Deposit": {
      const end = advance(spot, q.tenor, cal, bdc, idx.endOfMonth);
      return { start: spot, end, endUnadjusted: end };
    }
    case "FRA": {
      const start = advance(spot, q.start, cal, bdc, idx.endOfMonth);
      const end = advance(spot, q.end, cal, bdc, idx.endOfMonth);
      return { start, end, endUnadjusted: end };
    }
    case "Future": {
      const start = resolveFutureStart(q.start, spot, cal);
      const end = advance(start, idx.tenor, cal, bdc, idx.endOfMonth);
      return { start, end, endUnadjusted: end };
    }
    case "Swap":
    case "OIS": {
      // Swaps roll their schedule from the unadjusted maturity; the pillar sits on the
      // last payment date (adjusted maturity + OIS payment lag, QuantLib "latestRelevantDate")
      // so no cashflow of the par instrument is extrapolated beyond its own pillar.
      const accrualEnd = advance(spot, q.tenor, cal, bdc, idx.endOfMonth);
      const payLag = legPaymentLag(idx);
      const end = payLag > 0 ? addBusinessDays(accrualEnd, payLag, cal) : accrualEnd;
      return { start: spot, end, endUnadjusted: addTenor(spot, q.tenor) };
    }
    case "BasisSwap":
    case "XccyBasis": {
      // Pillar on the last payment date (accrual end + payment lag on the legs' joint calendar) so the
      // instrument reprices exactly once later pillars change the interpolation beyond the maturity.
      const info = lag?.(q) ?? { cal, payLag: 0 };
      const accrualEnd = advance(spot, q.tenor, info.cal, bdc, idx.endOfMonth);
      const end = info.payLag > 0 ? addBusinessDays(accrualEnd, info.payLag, info.cal) : accrualEnd;
      return { start: spot, end, endUnadjusted: addTenor(spot, q.tenor) };
    }
    case "FxSwapPoints": {
      // FX conventions: spot T+2 (T+1 for some USD pairs) on the pair calendar, delivery = spot + tenor.
      const { base, quote } = fxPairOf(q.pair);
      const fxSpot = fxSpotDateFrom(valuationDate, base, quote);
      const end = advance(fxSpot, q.tenor, fxPairCalendar(base, quote), bdc, true);
      return { start: fxSpot, end, endUnadjusted: addTenor(fxSpot, q.tenor) };
    }
  }
}

function fxPairOf(pair: string): { base: string; quote: string } {
  const p = pair.replace("/", "").toUpperCase();
  if (p.length !== 6) throw new PricingError("INVALID_CURVE_SPEC", `Invalid FX pair in FxSwapPoints quote: ${pair}`);
  return { base: p.slice(0, 3), quote: p.slice(3) };
}

function curveIndexName(c: Curve | undefined): string | undefined {
  return (c as InterpolatedCurve | undefined)?.meta?.index;
}

/** Domestic / foreign floating indices of an xccy basis quote (explicit → curve meta → currency RFR). */
function resolveXccyIndices(q: XccyBasisQuote, spec: Pick<BootstrapSpec, "index">, refs: Record<string, Curve>): { domIdx: RateIndex; forIdx: RateIndex } {
  const domIdx = getIndex(q.domesticIndex ?? curveIndexName(refs[q.domesticProjectionCurveId]) ?? spec.index);
  const forIdx = getIndex(q.foreignIndex ?? curveIndexName(refs[q.foreignProjectionCurveId]) ?? getSwapConventions(q.foreignCurrency).oisIndex);
  return { domIdx, forIdx };
}

/** Joint schedule calendar of two indices (payment calendars, N8-4 – SOFR pays on `US`, fixes on `US-SIFMA`). */
function jointCalendarId(a: RateIndex, b: RateIndex): string {
  const ca = indexScheduleCalendar(a);
  const cb = indexScheduleCalendar(b);
  return ca === cb ? ca : `${ca}+${cb}`;
}

function legPaymentLag(index: RateIndex): number {
  return index.type === "OIS" ? getSwapConventions(index.currency).oisPaymentLag : 0;
}

/** Calendar / payment lag resolver for basis and xccy quotes of `spec`. */
function makeLagInfo(spec: Pick<BootstrapSpec, "index">, idx: RateIndex, refs: Record<string, Curve>): LagInfo {
  return (q) => {
    if (q.type === "BasisSwap") {
      const other = getIndex(q.otherIndex);
      return { cal: getCalendar(jointCalendarId(idx, other)), payLag: Math.max(legPaymentLag(idx), legPaymentLag(other)) };
    }
    const { domIdx, forIdx } = resolveXccyIndices(q, spec, refs);
    return { cal: getCalendar(jointCalendarId(domIdx, forIdx)), payLag: Math.max(legPaymentLag(domIdx), legPaymentLag(forIdx)) };
  };
}

/** Accrual start / pillar date of a quote for the given spec (useful for UI and tests). */
export function quoteDates(
  valuationDate: SerialDate,
  spec: Pick<BootstrapSpec, "currency" | "index" | "spotLag">,
  q: CurveQuote,
): { spot: SerialDate; start: SerialDate; end: SerialDate; endUnadjusted: SerialDate } {
  const idx = getIndex(spec.index);
  const conv = getSwapConventions(spec.currency);
  const cal = getCalendar(indexScheduleCalendar(idx));
  const spotLag = spec.spotLag ?? conv.spotLag;
  const spot = spotLag === 0 ? valuationDate : addBusinessDays(valuationDate, spotLag, cal);
  return { spot, ...quoteMaturity(q, spot, idx, cal, "ModifiedFollowing", makeLagInfo(spec, idx, {}), valuationDate) };
}

/** Short human-readable label, e.g. "OIS 5Y", "Swap 10Y", "FRA 6x12", "Future 3M". */
export function quoteLabel(q: CurveQuote): string {
  const months = (t: string) => t.trim().replace(/M$/i, "");
  switch (q.type) {
    case "Deposit":
      return `Depo ${q.tenor}`;
    case "FRA":
      return `FRA ${months(q.start)}x${months(q.end)}`;
    case "Swap":
      return `Swap ${q.tenor}`;
    case "OIS":
      return `OIS ${q.tenor}`;
    case "Future":
      return `Future ${q.start}`;
    case "BasisSwap":
      return `Basis ${q.tenor} vs ${q.otherIndex}`;
    case "XccyBasis":
      return `Xccy ${q.tenor} vs ${q.foreignCurrency}`;
    case "FxSwapPoints":
      return `FX-Pkt ${q.tenor} ${q.pair.toUpperCase()}`;
  }
}

/**
 * Copy of `q` with its market rate moved by `bp` basis points (futures: price
 * moves by −bp/100; FX swap points: the points move by the pip-equivalent of a
 * `bp` rate differential over the tenor, i.e. points += bp·1e-4·τ·spot·pipFactor).
 */
export function bumpQuote(q: CurveQuote, bp: number): CurveQuote {
  const d = bp * 1e-4;
  switch (q.type) {
    case "Deposit":
    case "FRA":
    case "Swap":
    case "OIS":
      return { ...q, rate: q.rate + d };
    case "Future":
      return { ...q, price: q.price - bp / 100 };
    case "BasisSwap":
    case "XccyBasis":
      return { ...q, spread: q.spread + d };
    case "FxSwapPoints": {
      const { base, quote } = fxPairOf(q.pair);
      const pf = q.pipFactor ?? pairPipFactor(base, quote);
      const tau = Math.max(1 / 365, addTenor(0, q.tenor) / 365);
      return { ...q, points: q.points + d * tau * q.fxSpot * pf };
    }
  }
}

/**
 * Sequential bootstrap: each quote adds one pillar at its maturity and the
 * pillar's discount factor is solved so the instrument reprices to zero.
 *
 * Approximations (documented on purpose, all standard for a desk-level curve):
 * - Futures: the underlying deposit runs from the (holiday-adjusted) IMM date
 *   for the index tenor; the convexity adjustment is an input, not modelled.
 * - Basis swaps: each leg pays at its own index tenor (no compounding of the
 *   short leg); an OIS leg pays at the IBOR leg's tenor.
 * - Xccy basis: constant-notional RFR-vs-RFR (or IBOR) swap, quarterly payments
 *   on the joint calendar, notional exchange at start and maturity, foreign
 *   leg discounted on `foreignDiscountCurveId`, domestic leg on the curve being
 *   built. The spot anchor uses the domestic projection curve's df(spot).
 */
export function bootstrapCurve(valuationDate: SerialDate, spec: BootstrapSpec): BootstrapResult {
  const idx = getIndex(spec.index);
  const conv = getSwapConventions(spec.currency);
  const cal = getCalendar(indexScheduleCalendar(idx));
  const bdc: BusinessDayConvention = "ModifiedFollowing";
  const spotLag = spec.spotLag ?? conv.spotLag;
  const spot = spotLag === 0 ? valuationDate : addBusinessDays(valuationDate, spotLag, cal);
  const interpolation = spec.interpolation ?? "logLinear";
  const dayCount = spec.dayCount ?? "ACT/365F";
  const refs = spec.referenceCurves ?? {};
  const requireRef = (id: string, purpose: string): Curve => {
    const c = refs[id] ?? (spec.discountCurve?.id === id ? spec.discountCurve : undefined);
    if (!c) throw new PricingError("INVALID_CURVE_SPEC", `bootstrapCurve(${spec.id}): reference curve "${id}" (${purpose}) missing in spec.referenceCurves`);
    return c;
  };

  const lagInfo = makeLagInfo(spec, idx, refs);
  const allItems = spec.quotes.map((q) => ({ q, ...quoteMaturity(q, spot, idx, cal, bdc, lagInfo, valuationDate) })).sort((a, b) => a.end - b.end);
  const { kept: items, merged } = mergePillars(allItems, spec.pillarMergeToleranceDays ?? 0);

  const nodes: CurveNode[] = [];
  // Anchor at spot: single-curve → df(spot) from the first short rate; dual-curve →
  // pseudo-df equal to discount curve at spot so the short end is consistent. A curve
  // built from FX swap points alone only pins forward dfs from the FX spot date – add
  // an ON/1W deposit or OIS quote when the 0 → spot stub matters.
  if (spot > valuationDate) {
    const tauSpot = yearFraction(valuationDate, spot, idx.dayCount);
    const first = items[0]?.q;
    let dfSpot: number;
    if (spec.discountCurve) dfSpot = spec.discountCurve.df(spot);
    else if (first?.type === "XccyBasis") dfSpot = requireRef(first.domesticProjectionCurveId, "domestic projection").df(spot);
    else {
      const shortRate = first?.type === "Deposit" || first?.type === "OIS" ? first.rate : first?.type === "Future" ? futureImpliedForward(first) : 0.02;
      dfSpot = 1 / (1 + shortRate * tauSpot);
    }
    nodes.push({ date: spot, df: dfSpot });
  }

  const residuals: BootstrapResult["residuals"] = [];
  const forwardJumps = resolveTurnOfYear(spec.turnOfYear, idx.fixingCalendar);
  const buildCurve = (ns: CurveNode[]) =>
    new InterpolatedCurve({
      id: spec.id,
      currency: spec.currency,
      referenceDate: valuationDate,
      nodes: ns,
      interpolation,
      dayCount,
      // `source: "bootstrap"` drives the methodology text (R3-7, see `CurveSource`).
      meta: { index: idx.name, source: "bootstrap" },
      forwardJumps,
    });

  /** Curves visible to the pricer: reference curves, discount curve, and the trial curve under its own id. */
  const baseCurves = (curve: Curve): Record<string, Curve> => ({
    ...refs,
    ...(spec.discountCurve ? { [spec.discountCurve.id]: spec.discountCurve } : {}),
    [spec.id]: curve,
  });
  /** Context in which the trial curve projects `spec.index` (Deposit/FRA/Future/Swap/OIS/BasisSwap). */
  const projectionCtx = (curve: Curve, extra: Record<string, Curve> = {}): MarketContext => {
    const curves = baseCurves(curve);
    if (idx.curveId !== spec.discountCurve?.id) curves[idx.curveId] = curve;
    Object.assign(curves, extra);
    return {
      valuationDate,
      curves,
      discountCurveId: { [spec.currency]: spec.discountCurve ? spec.discountCurve.id : spec.id },
      fxSpots: {},
    };
  };

  const solved: typeof items = [];
  /** Pricing error of quote `q` (with its dates) on `curve`. */
  const evaluate = (q: CurveQuote, start: SerialDate, end: SerialDate, endUnadjusted: SerialDate, curve: InterpolatedCurve): number => {
    switch (q.type) {
      case "Deposit":
      case "FRA":
        return curve.forwardRate(start, end, idx.dayCount) - q.rate;
      case "Future":
        return curve.forwardRate(start, end, idx.dayCount) - futureImpliedForward(q);
      case "Swap":
      case "OIS": {
        const swap = makeParSwap(spec, idx, conv, start, endUnadjusted, q.rate, q.type === "OIS", bdc);
        return priceInterestRateSwap(projectionCtx(curve), swap, spec.currency).pv / SOLVER_NOTIONAL;
      }
      case "BasisSwap": {
        const other = getIndex(q.otherIndex);
        const otherCurve = requireRef(q.otherCurveId, `projection of ${q.otherIndex}`);
        const ctx = projectionCtx(curve, { [other.curveId]: otherCurve, [q.otherCurveId]: otherCurve });
        const swap = makeBasisSwapInstrument(spec, idx, other, conv, start, endUnadjusted, q.spread, bdc);
        return priceInterestRateSwap(ctx, swap, spec.currency).pv / SOLVER_NOTIONAL;
      }
      case "XccyBasis": {
        const domProj = requireRef(q.domesticProjectionCurveId, "domestic projection");
        const forDisc = requireRef(q.foreignDiscountCurveId, "foreign discount");
        const forProj = requireRef(q.foreignProjectionCurveId, "foreign projection");
        const { domIdx, forIdx } = resolveXccyIndices(q, spec, refs);
        const curves = baseCurves(curve);
        curves[domIdx.curveId] = domProj;
        curves[q.domesticProjectionCurveId] = domProj;
        curves[forIdx.curveId] = forProj;
        curves[q.foreignProjectionCurveId] = forProj;
        curves[q.foreignDiscountCurveId] = forDisc;
        const ctx: MarketContext = {
          valuationDate,
          curves,
          // The curve being built is the (collateral-adjusted) domestic discount curve.
          discountCurveId: { [spec.currency]: spec.id, [q.foreignCurrency]: q.foreignDiscountCurveId },
          fxSpots: { [`${spec.currency}${q.foreignCurrency}`]: q.fxSpot },
        };
        const ccs = makeXccyBasisInstrument(spec, q, domIdx, forIdx, start, endUnadjusted, bdc);
        return priceCrossCurrencySwap(ctx, ccs, spec.currency).pv / SOLVER_NOTIONAL;
      }
      case "FxSwapPoints": {
        // Covered interest parity anchored at the FX spot date t_s:
        // F/S = [DF_base(T)/DF_base(t_s)] / [DF_quote(T)/DF_quote(t_s)].
        const { base, quote } = fxPairOf(q.pair);
        const ccy = spec.currency.toUpperCase();
        if (ccy !== base && ccy !== quote)
          throw new PricingError("INVALID_CURVE_SPEC", `bootstrapCurve(${spec.id}): FxSwapPoints pair ${q.pair} does not contain ${spec.currency}`);
        const other = requireRef(q.otherDiscountCurveId, `discount curve of ${ccy === base ? quote : base}`);
        const fwd = q.fxSpot + q.points / (q.pipFactor ?? pairPipFactor(base, quote));
        const ratio = fwd / q.fxSpot; // = [DF_b(T)/DF_b(ts)] / [DF_q(T)/DF_q(ts)]
        const otherRatio = other.df(end) / other.df(start);
        // Implied forward df of the curve being built over (t_s, T].
        const impliedFwdDf = ccy === base ? ratio * otherRatio : otherRatio / ratio;
        const curveFwdDf = curve.df(end) / curve.df(start);
        const tau = Math.max(yearFraction(start, end, dayCount), 1 / 365);
        // Residual as continuously compounded rate difference over the FX period.
        return -Math.log(curveFwdDf / impliedFwdDf) / tau;
      }
    }
  };

  const solvePillar = (
    q: CurveQuote,
    start: SerialDate,
    end: SerialDate,
    endUnadjusted: SerialDate,
    others: CurveNode[],
    guess: number,
    wide: boolean,
  ): number => {
    const trial = (df: number): number => evaluate(q, start, end, endUnadjusted, buildCurve([...others, { date: end, df }].sort((a, b) => a.date - b.date)));
    const guessLo = wide ? guess * 0.9 : guess * 0.2;
    const guessHi = wide ? Math.min(1.5, guess * 1.1) : Math.min(1.5, guess * 1.2);
    try {
      return brent(trial, guessLo, guessHi, { tolerance: 1e-14, maxIterations: 200 });
    } catch {
      // Widen bracket
      return brent(trial, 1e-6, 2, { tolerance: 1e-14, maxIterations: 300 });
    }
  };

  for (const it of items) {
    const { q, start, end, endUnadjusted } = it;
    if (nodes.some((n) => n.date === end)) continue; // duplicate pillar
    const prevDf = nodes.length ? nodes[nodes.length - 1]!.df : 1;
    const df = solvePillar(q, start, end, endUnadjusted, nodes, prevDf, false);
    nodes.push({ date: end, df });
    solved.push(it);
  }
  // Global sweeps: with non-local interpolation (spline, monotone convex) or forward jumps a later pillar
  // changes earlier intervals; re-solve each pillar on the full node set until every residual vanishes.
  const sweeps = spec.globalSweeps ?? (isNonLocalInterpolation(interpolation) ? 6 : 0);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const before = buildCurve(nodes);
    const maxRes = solved.reduce((m, it) => Math.max(m, Math.abs(evaluate(it.q, it.start, it.end, it.endUnadjusted, before))), 0);
    if (maxRes < 1e-12) break;
    for (const it of solved) {
      const i = nodes.findIndex((n) => n.date === it.end);
      if (i < 0) continue;
      const others = nodes.filter((_, j) => j !== i);
      const df = solvePillar(it.q, it.start, it.end, it.endUnadjusted, others, nodes[i]!.df, true);
      nodes[i] = { date: it.end, df };
    }
  }
  // Residuals are reported on the final curve (not at solve time), so any
  // influence of later pillars on earlier instruments becomes visible.
  const curve = buildCurve(nodes);
  for (const it of solved) residuals.push({ quote: it.q, maturity: it.end, residual: evaluate(it.q, it.start, it.end, it.endUnadjusted, curve) });
  const mergedQuotes = merged.map(({ item, into }) => ({
    quote: item.q,
    maturity: item.end,
    mergedInto: into.end,
    residual: evaluate(item.q, item.start, item.end, item.endUnadjusted, curve),
  }));
  return { curve, residuals, mergedQuotes };
}

function makeParSwap(
  spec: BootstrapSpec,
  idx: RateIndex,
  conv: ReturnType<typeof getSwapConventions>,
  start: SerialDate,
  end: SerialDate,
  rate: number,
  isOis: boolean,
  bdc: BusinessDayConvention,
): InterestRateSwap {
  const years = yearFraction(start, end, "ACT/365F");
  const oneOrLess = years <= 1.01;
  const fixedFreq = isOis ? (oneOrLess ? "ZC" : conv.oisFixedFrequency) : conv.fixedFrequency;
  const floatFreq = isOis ? (oneOrLess ? "ZC" : conv.oisFixedFrequency) : idx.tenor;
  const fixedDc = isOis ? conv.oisFixedDayCount : conv.fixedDayCount;
  const payLag = isOis ? conv.oisPaymentLag : 0;
  return {
    id: `par-${spec.id}-${end}`,
    type: "InterestRateSwap",
    legs: [
      {
        type: "Fixed",
        payReceive: "Receive",
        notional: SOLVER_NOTIONAL,
        currency: spec.currency,
        effectiveDate: start,
        terminationDate: end,
        frequency: fixedFreq,
        dayCount: fixedDc,
        calendar: indexScheduleCalendar(idx),
        businessDayConvention: bdc,
        rate,
        paymentLag: payLag,
        stub: "ShortFront",
      },
      {
        type: "Float",
        payReceive: "Pay",
        notional: SOLVER_NOTIONAL,
        currency: spec.currency,
        effectiveDate: start,
        terminationDate: end,
        frequency: floatFreq,
        dayCount: idx.dayCount,
        calendar: indexScheduleCalendar(idx),
        businessDayConvention: bdc,
        index: idx.name,
        paymentLag: payLag,
        stub: "ShortFront",
      },
    ],
  };
}

/** Leg frequency for a basis swap leg: IBOR legs pay at their tenor, an OIS leg at the other leg's tenor. */
function basisLegFrequency(own: RateIndex, other: RateIndex, conv: ReturnType<typeof getSwapConventions>): string {
  if (own.type === "IBOR") return own.tenor;
  return other.type === "IBOR" ? other.tenor : conv.oisFixedFrequency;
}

/** Receive `idx` + spread, pay `other` flat; both legs in the curve currency. */
function makeBasisSwapInstrument(
  spec: BootstrapSpec,
  idx: RateIndex,
  other: RateIndex,
  conv: ReturnType<typeof getSwapConventions>,
  start: SerialDate,
  end: SerialDate,
  spread: number,
  bdc: BusinessDayConvention,
): InterestRateSwap {
  const calendar = jointCalendarId(idx, other);
  const leg = (index: RateIndex, payReceive: "Pay" | "Receive", freq: string, sp: number): FloatLeg => ({
    type: "Float",
    payReceive,
    notional: SOLVER_NOTIONAL,
    currency: spec.currency,
    effectiveDate: start,
    terminationDate: end,
    frequency: freq,
    dayCount: index.dayCount,
    calendar,
    businessDayConvention: bdc,
    index: index.name,
    spread: sp,
    paymentLag: legPaymentLag(index),
    stub: "ShortFront",
  });
  return {
    id: `basis-${spec.id}-${end}`,
    type: "InterestRateSwap",
    legs: [leg(idx, "Receive", basisLegFrequency(idx, other, conv), spread), leg(other, "Pay", basisLegFrequency(other, idx, conv), 0)],
  };
}

/**
 * Constant-notional cross-currency basis swap: receive domestic float + spread,
 * pay foreign float flat, notionals exchanged at start and maturity
 * (foreign notional = domestic × fxSpot). Quarterly payments on the joint
 * calendar; payment lag = the larger OIS payment lag of the two currencies.
 */
function makeXccyBasisInstrument(
  spec: BootstrapSpec,
  q: XccyBasisQuote,
  domIdx: RateIndex,
  forIdx: RateIndex,
  start: SerialDate,
  end: SerialDate,
  bdc: BusinessDayConvention,
): CrossCurrencySwap {
  const calendar = jointCalendarId(domIdx, forIdx);
  const payLag = Math.max(legPaymentLag(domIdx), legPaymentLag(forIdx));
  const leg = (index: RateIndex, ccy: string, payReceive: "Pay" | "Receive", notional: number, spread: number): FloatLeg => ({
    type: "Float",
    payReceive,
    notional,
    currency: ccy,
    effectiveDate: start,
    terminationDate: end,
    frequency: "3M",
    dayCount: index.dayCount,
    calendar,
    businessDayConvention: bdc,
    index: index.name,
    spread,
    paymentLag: payLag,
    stub: "ShortFront",
    notionalExchange: { initial: true, final: true },
  });
  return {
    id: `xccy-${spec.id}-${end}`,
    type: "CrossCurrencySwap",
    legs: [leg(domIdx, spec.currency, "Receive", SOLVER_NOTIONAL, q.spread), leg(forIdx, q.foreignCurrency, "Pay", SOLVER_NOTIONAL * q.fxSpot, 0)],
  };
}

/**
 * Turn-of-year window on a calendar: the jump starts on the last business day
 * on or before `date` and lasts until the next business day, i.e. it covers
 * the overnight period the market's turn premium is quoted for (31 Dec → first
 * business day of January, including the weekend / 1 January holiday).
 */
export function turnOfYearWindow(date: SerialDate, calendar: CalendarId | Calendar): { date: SerialDate; days: number } {
  const cal = getCalendar(calendar);
  const start = adjust(date, "Preceding", cal);
  const end = addBusinessDays(start, 1, cal);
  return { date: start, days: end - start };
}

/** Resolve the forward jumps of a spec: explicit `days` win, otherwise the business-day span on `calendar`. */
function resolveTurnOfYear(turnOfYear: BootstrapSpec["turnOfYear"], calendar: CalendarId): ForwardJump[] | undefined {
  return turnOfYear?.map((t) => {
    if (t.days !== undefined) return { date: t.date, bp: t.bp, days: t.days };
    const w = turnOfYearWindow(t.date, calendar);
    return { date: w.date, bp: t.bp, days: w.days };
  });
}

/** Unadjusted helper for callers that need the spot date of a currency. */
export function spotDate(valuationDate: SerialDate, currency: string): SerialDate {
  const conv = getSwapConventions(currency);
  const cal = getCalendar(conv.calendar);
  return conv.spotLag === 0 ? adjust(valuationDate, "Following", cal) : addBusinessDays(valuationDate, conv.spotLag, cal);
}

// ---------------------------------------------------------------------------
// Multi-curve build (dependency ordered)
// ---------------------------------------------------------------------------

/**
 * Serialisable curve definition: like `BootstrapSpec` but referencing other
 * curves by id, so a whole curve set can be described as data (UI / API /
 * par-rate risk) and built in dependency order with `bootstrapCurves`.
 */
export interface CurveBuildSpec {
  id: string;
  currency: string;
  index: string;
  quotes: CurveQuote[];
  interpolation?: InterpolationMethod;
  dayCount?: DayCountConvention;
  spotLag?: number;
  /** Discount curve id for dual-curve stripping. */
  discountCurveId?: string;
  /** Additional curve ids the quotes need (ids inside BasisSwap/XccyBasis quotes are picked up automatically). */
  referenceCurveIds?: string[];
  /** See `BootstrapSpec.pillarMergeToleranceDays` (default 0 = off). */
  pillarMergeToleranceDays?: number;
  /** See `BootstrapSpec.turnOfYear`. */
  turnOfYear?: { date: SerialDate; bp: number; days?: number }[];
  /** See `BootstrapSpec.globalSweeps`. */
  globalSweeps?: number;
}

/** Ids of the curves `spec` must be built after. */
export function curveDependencies(spec: CurveBuildSpec): string[] {
  const deps = new Set<string>();
  if (spec.discountCurveId) deps.add(spec.discountCurveId);
  for (const id of spec.referenceCurveIds ?? []) deps.add(id);
  for (const q of spec.quotes) {
    if (q.type === "BasisSwap") deps.add(q.otherCurveId);
    else if (q.type === "XccyBasis") {
      deps.add(q.foreignDiscountCurveId);
      deps.add(q.foreignProjectionCurveId);
      deps.add(q.domesticProjectionCurveId);
    } else if (q.type === "FxSwapPoints") deps.add(q.otherDiscountCurveId);
  }
  deps.delete(spec.id);
  return [...deps];
}

/** Topological order (dependencies first, stable for independent specs). Throws on cycles. */
export function orderCurveSpecs(specs: CurveBuildSpec[]): CurveBuildSpec[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const state = new Map<string, "visiting" | "done">();
  const out: CurveBuildSpec[] = [];
  const visit = (s: CurveBuildSpec, path: string[]) => {
    const st = state.get(s.id);
    if (st === "done") return;
    if (st === "visiting") throw new PricingError("INVALID_CURVE_SPEC", `Circular curve dependency: ${[...path, s.id].join(" -> ")}`);
    state.set(s.id, "visiting");
    for (const d of curveDependencies(s)) {
      const ds = byId.get(d);
      if (ds) visit(ds, [...path, s.id]);
    }
    state.set(s.id, "done");
    out.push(s);
  };
  for (const s of specs) visit(s, []);
  return out;
}

/**
 * Bootstrap a set of curves in dependency order (OIS first, then dual-curve
 * projection curves, then basis / collateral curves). Dependencies not
 * contained in `specs` are taken from `existing`.
 */
export function bootstrapCurves(
  valuationDate: SerialDate,
  specs: CurveBuildSpec[],
  existing: Record<string, Curve> = {},
): { curves: Record<string, InterpolatedCurve>; results: Record<string, BootstrapResult>; order: string[] } {
  const curves: Record<string, InterpolatedCurve> = {};
  const results: Record<string, BootstrapResult> = {};
  const order: string[] = [];
  for (const s of orderCurveSpecs(specs)) {
    const referenceCurves: Record<string, Curve> = {};
    for (const d of curveDependencies(s)) {
      const c = curves[d] ?? existing[d];
      if (!c)
        throw new PricingError("INVALID_CURVE_SPEC", `bootstrapCurves: curve "${d}" required by "${s.id}" is neither in the specs nor in the existing curves`);
      referenceCurves[d] = c;
    }
    const res = bootstrapCurve(valuationDate, {
      id: s.id,
      currency: s.currency,
      index: s.index,
      quotes: s.quotes,
      interpolation: s.interpolation,
      dayCount: s.dayCount,
      spotLag: s.spotLag,
      discountCurve: s.discountCurveId ? referenceCurves[s.discountCurveId] : undefined,
      referenceCurves,
      pillarMergeToleranceDays: s.pillarMergeToleranceDays,
      turnOfYear: s.turnOfYear,
      globalSweeps: s.globalSweeps,
    });
    curves[s.id] = res.curve;
    results[s.id] = res;
    order.push(s.id);
  }
  return { curves, results, order };
}
