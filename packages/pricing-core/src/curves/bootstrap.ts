import { type BusinessDayConvention, addBusinessDays, adjust, advance, getCalendar } from "../dates/calendar.js";
import { type SerialDate, addTenor } from "../dates/date.js";
import { type DayCountConvention, yearFraction } from "../dates/daycount.js";
import { type InterestRateSwap } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { brent } from "../math/rootfind.js";
import { type InterpolationMethod } from "../math/interpolation.js";
import { priceInterestRateSwap } from "../pricing/swap-pricer.js";
import { type CurveNode, InterpolatedCurve } from "./curve.js";
import { getIndex, getSwapConventions, type RateIndex } from "./index-definitions.js";

export type CurveQuote =
  | { type: "Deposit"; tenor: string; rate: number }
  | { type: "FRA"; start: string; end: string; rate: number }
  | { type: "Swap"; tenor: string; rate: number }
  | { type: "OIS"; tenor: string; rate: number };

export interface BootstrapSpec {
  id: string;
  currency: string;
  /** Index projected by this curve, e.g. "ESTR" or "EURIBOR-6M". */
  index: string;
  quotes: CurveQuote[];
  interpolation?: InterpolationMethod;
  dayCount?: DayCountConvention;
  /** Discount curve to use for dual-curve stripping (defaults to the curve itself). */
  discountCurve?: InterpolatedCurve;
  /** Override spot lag (business days). */
  spotLag?: number;
}

export interface BootstrapResult {
  curve: InterpolatedCurve;
  /** Residual NPVs per instrument (should be ~0). */
  residuals: { quote: CurveQuote; maturity: SerialDate; residual: number }[];
}

function quoteMaturity(
  q: CurveQuote,
  spot: SerialDate,
  idx: RateIndex,
  bdc: BusinessDayConvention,
): { start: SerialDate; end: SerialDate; endUnadjusted: SerialDate } {
  const cal = getCalendar(idx.fixingCalendar);
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
    case "Swap":
    case "OIS":
      // Swaps roll their schedule from the unadjusted maturity; the pillar sits on the adjusted date.
      return { start: spot, end: advance(spot, q.tenor, cal, bdc, idx.endOfMonth), endUnadjusted: addTenor(spot, q.tenor) };
  }
}

/**
 * Sequential bootstrap: each quote adds one pillar at its maturity and the
 * pillar's discount factor is solved so the instrument reprices to zero.
 */
export function bootstrapCurve(valuationDate: SerialDate, spec: BootstrapSpec): BootstrapResult {
  const idx = getIndex(spec.index);
  const conv = getSwapConventions(spec.currency);
  const cal = getCalendar(idx.fixingCalendar);
  const bdc: BusinessDayConvention = "ModifiedFollowing";
  const spotLag = spec.spotLag ?? conv.spotLag;
  const spot = spotLag === 0 ? valuationDate : addBusinessDays(valuationDate, spotLag, cal);
  const interpolation = spec.interpolation ?? "logLinear";
  const dayCount = spec.dayCount ?? "ACT/365F";
  const isSingleCurve = !spec.discountCurve;

  const items = spec.quotes
    .map((q) => ({ q, ...quoteMaturity(q, spot, idx, bdc) }))
    .sort((a, b) => a.end - b.end);

  const nodes: CurveNode[] = [];
  // Anchor at spot: single-curve → df(spot) from first deposit extrapolated (≈1 with short rate);
  // dual-curve → pseudo-df equal to discount curve at spot so the short end is consistent.
  if (spot > valuationDate) {
    const shortRate = items[0]?.q.type === "Deposit" || items[0]?.q.type === "OIS" ? (items[0]!.q as { rate: number }).rate : 0.02;
    const tauSpot = yearFraction(valuationDate, spot, idx.dayCount);
    const dfSpot = isSingleCurve ? 1 / (1 + shortRate * tauSpot) : spec.discountCurve!.df(spot);
    nodes.push({ date: spot, df: dfSpot });
  }

  const residuals: BootstrapResult["residuals"] = [];
  const buildCurve = (ns: CurveNode[]) =>
    new InterpolatedCurve({ id: spec.id, currency: spec.currency, referenceDate: valuationDate, nodes: ns, interpolation, dayCount, meta: { index: idx.name } });

  for (const it of items) {
    const { q, start, end, endUnadjusted } = it;
    if (nodes.some((n) => n.date === end)) continue; // duplicate pillar
    const trial = (df: number): number => {
      const testNodes = [...nodes, { date: end, df }];
      const curve = buildCurve(testNodes);
      const ctx: MarketContext = {
        valuationDate,
        curves: { [spec.id]: curve, ...(spec.discountCurve ? { [spec.discountCurve.id]: spec.discountCurve } : {}) },
        discountCurveId: { [spec.currency]: spec.discountCurve ? spec.discountCurve.id : spec.id },
        fxSpots: {},
      };
      switch (q.type) {
        case "Deposit":
        case "FRA": {
          const fwd = curve.forwardRate(start, end, idx.dayCount);
          return fwd - q.rate;
        }
        case "Swap":
        case "OIS": {
          const isOis = q.type === "OIS";
          const swap = makeParSwap(spec, idx, conv, start, endUnadjusted, q.rate, isOis, ctx, bdc);
          const res = priceInterestRateSwap(ctx, swap, spec.currency);
          return res.pv / 1e6; // notional 1e6 → normalise
        }
      }
    };
    const prevDf = nodes.length ? nodes[nodes.length - 1]!.df : 1;
    const guessLo = prevDf * 0.2;
    const guessHi = Math.min(1.5, prevDf * 1.2);
    let df: number;
    try {
      df = brent(trial, guessLo, guessHi, { tolerance: 1e-14, maxIterations: 200 });
    } catch {
      // Widen bracket
      df = brent(trial, 1e-6, 2, { tolerance: 1e-14, maxIterations: 300 });
    }
    nodes.push({ date: end, df });
    residuals.push({ quote: q, maturity: end, residual: trial(df) });
  }
  return { curve: buildCurve(nodes), residuals };
}

function makeParSwap(
  spec: BootstrapSpec,
  idx: RateIndex,
  conv: ReturnType<typeof getSwapConventions>,
  start: SerialDate,
  end: SerialDate,
  rate: number,
  isOis: boolean,
  _ctx: MarketContext,
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
        type: "Fixed", payReceive: "Receive", notional: 1e6, currency: spec.currency, effectiveDate: start, terminationDate: end,
        frequency: fixedFreq, dayCount: fixedDc, calendar: idx.fixingCalendar, businessDayConvention: bdc, rate, paymentLag: payLag,
        stub: "ShortFront",
      },
      {
        type: "Float", payReceive: "Pay", notional: 1e6, currency: spec.currency, effectiveDate: start, terminationDate: end,
        frequency: floatFreq, dayCount: idx.dayCount, calendar: idx.fixingCalendar, businessDayConvention: bdc, index: idx.name,
        paymentLag: payLag, stub: "ShortFront",
      },
    ],
  };
}

/** Unadjusted helper for callers that need the spot date of a currency. */
export function spotDate(valuationDate: SerialDate, currency: string): SerialDate {
  const conv = getSwapConventions(currency);
  const cal = getCalendar(conv.calendar);
  return conv.spotLag === 0 ? adjust(valuationDate, "Following", cal) : addBusinessDays(valuationDate, conv.spotLag, cal);
}
