import { type CurveExtrapolation, InterpolatedCurve, type Curve } from "../curves/curve.js";
import { type SerialDate, parseISO, toISO } from "../dates/date.js";
import { type DayCountConvention } from "../dates/daycount.js";
import { type InterpolationMethod } from "../math/interpolation.js";
import { type MarketContext } from "./market-context.js";

/**
 * Portable, versioned JSON representation of a market snapshot. Dates are ISO
 * strings so the file is human-readable and diff-able (audit trail, EoD
 * archives, exchange with IPV / auditors).
 */
export interface MarketSnapshotJson {
  schema: "deriva.market/1";
  valuationDate: string;
  meta?: MarketContext["meta"];
  discountCurveId: Record<string, string>;
  collateralDiscountCurveId?: Record<string, string>;
  curves: {
    id: string;
    currency: string;
    dayCount: DayCountConvention;
    interpolation: InterpolationMethod;
    extrapolation?: CurveExtrapolation;
    meta?: Record<string, string>;
    /** Base-curve nodes (before `forwardJumps`). */
    nodes: { date: string; df: number }[];
    /** Turn-of-year forward jumps layered on the interpolated curve (optional, `deriva.market/1` compatible). */
    forwardJumps?: { date: string; bp: number; days?: number }[];
  }[];
  fxSpots: Record<string, number>;
  fixings: { index: string; date: string; value: number }[];
  swaptionVols?: MarketContext["swaptionVols"];
  capletVols?: MarketContext["capletVols"];
  fxVols?: MarketContext["fxVols"];
  credit?: MarketContext["credit"];
}

export function serializeMarket(ctx: MarketContext): MarketSnapshotJson {
  return {
    schema: "deriva.market/1",
    valuationDate: toISO(ctx.valuationDate),
    meta: ctx.meta,
    discountCurveId: ctx.discountCurveId,
    collateralDiscountCurveId: ctx.collateralDiscountCurveId,
    curves: Object.values(ctx.curves).map((c) => serializeCurve(c)),
    fxSpots: ctx.fxSpots,
    fixings: (ctx.fixings ?? []).map((f) => ({ index: f.index, date: toISO(f.date), value: f.value })),
    swaptionVols: ctx.swaptionVols,
    capletVols: ctx.capletVols,
    fxVols: ctx.fxVols,
    credit: ctx.credit,
  };
}

export function serializeCurve(c: Curve): MarketSnapshotJson["curves"][number] {
  const ic = c as InterpolatedCurve;
  const jumps = ic.forwardJumps ?? [];
  // Base nodes (without jumps) when the curve exposes them, so jumps are not double counted on import.
  const baseNodes = typeof ic.nodes === "function" ? ic.nodes() : c.nodeDates.map((d) => ({ date: d, df: c.df(d) }));
  return {
    id: c.id,
    currency: c.currency,
    dayCount: c.dayCount,
    interpolation: ic.interpolation ?? "logLinear",
    ...(ic.extrapolation ? { extrapolation: ic.extrapolation } : {}),
    meta: ic.meta,
    nodes: baseNodes.map((n) => ({ date: toISO(n.date), df: n.df })),
    ...(jumps.length ? { forwardJumps: jumps.map((j) => ({ date: toISO(j.date), bp: j.bp, days: j.days })) } : {}),
  };
}

export function deserializeMarket(json: MarketSnapshotJson): MarketContext {
  if (json.schema !== "deriva.market/1") throw new Error(`Unsupported market snapshot schema: ${String(json.schema)}`);
  const valuationDate: SerialDate = parseISO(json.valuationDate);
  const curves: Record<string, Curve> = {};
  for (const c of json.curves) {
    curves[c.id] = new InterpolatedCurve({
      id: c.id,
      currency: c.currency,
      referenceDate: valuationDate,
      dayCount: c.dayCount,
      interpolation: c.interpolation,
      extrapolation: c.extrapolation,
      meta: c.meta,
      nodes: c.nodes.map((n) => ({ date: parseISO(n.date), df: n.df })),
      forwardJumps: c.forwardJumps?.map((j) => ({ date: parseISO(j.date), bp: j.bp, days: j.days })),
    });
  }
  return {
    valuationDate,
    meta: json.meta,
    discountCurveId: json.discountCurveId,
    collateralDiscountCurveId: json.collateralDiscountCurveId,
    curves,
    fxSpots: json.fxSpots,
    fixings: json.fixings.map((f) => ({ index: f.index, date: parseISO(f.date), value: f.value })),
    swaptionVols: json.swaptionVols,
    capletVols: json.capletVols,
    fxVols: json.fxVols,
    credit: json.credit,
  };
}

/** Validate a snapshot for internal consistency; returns a list of problems (empty = OK). */
export function validateMarket(ctx: MarketContext): string[] {
  const problems: string[] = [];
  for (const [ccy, id] of Object.entries(ctx.discountCurveId)) {
    if (!ctx.curves[id]) problems.push(`Discount curve ${id} for ${ccy} missing`);
  }
  for (const c of Object.values(ctx.curves)) {
    let prev = 1.0001;
    for (const d of c.nodeDates) {
      const df = c.df(d);
      if (!(df > 0 && df <= 1.0001)) problems.push(`Curve ${c.id}: discount factor ${df} at ${toISO(d)} out of range`);
      if (df > prev * 1.0005) problems.push(`Curve ${c.id}: discount factors not decreasing at ${toISO(d)} (negative forward rate)`);
      prev = df;
    }
  }
  for (const [pair, rate] of Object.entries(ctx.fxSpots)) {
    if (!/^[A-Z]{6}$/.test(pair)) problems.push(`FX pair ${pair} malformed`);
    if (!(rate > 0)) problems.push(`FX spot ${pair} must be positive`);
  }
  return problems;
}
