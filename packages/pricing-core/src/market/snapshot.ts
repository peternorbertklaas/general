import { type CurveExtrapolation, InterpolatedCurve, type Curve } from "../curves/curve.js";
import { type SerialDate, parseISO, toISO } from "../dates/date.js";
import { type DayCountConvention } from "../dates/daycount.js";
import { PricingError } from "../errors.js";
import { type InterpolationMethod } from "../math/interpolation.js";
import { type FxFixing, type MarketContext, normalizeFxPair } from "./market-context.js";

/** ISO-8601 date-time with mandatory time part and zone designator (`2026-09-03T16:30:00Z`, `…+02:00`, optional fraction). */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * True when `s` is an ISO-8601 date-time that JavaScript parses to a valid
 * instant (N3-03: `meta.snapshotTime` feeds the EMIR valuation timestamp and
 * must never be free text).
 */
export function isIsoDateTime(s: unknown): s is string {
  return typeof s === "string" && ISO_DATETIME.test(s) && Number.isFinite(Date.parse(s));
}

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
  /** Historical FX fixings for MtM-reset notionals (R4-1); optional, `deriva.market/1` compatible. */
  fxFixings?: { pair: string; date: string; rate: number }[];
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
    ...(ctx.fxFixings?.length ? { fxFixings: ctx.fxFixings.map((f) => ({ pair: normalizeFxPair(f.pair), date: toISO(f.date), rate: f.rate })) } : {}),
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

/**
 * Rebuild a market context from its JSON form. Curves without a `meta.source`
 * are tagged `"import"` (pillars taken from the snapshot, R3-7); a
 * `meta.snapshotTime` that is not an ISO-8601 date-time raises
 * `PricingError("INVALID_TIMESTAMP")` (N3-03).
 */
export function deserializeMarket(json: MarketSnapshotJson): MarketContext {
  if (json.schema !== "deriva.market/1") throw new Error(`Unsupported market snapshot schema: ${String(json.schema)}`);
  if (json.meta?.snapshotTime !== undefined && !isIsoDateTime(json.meta.snapshotTime)) {
    throw new PricingError("INVALID_TIMESTAMP", `meta.snapshotTime must be an ISO-8601 date-time (got ${JSON.stringify(json.meta.snapshotTime)})`, {
      snapshotTime: json.meta.snapshotTime,
    });
  }
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
      meta: { ...c.meta, source: c.meta?.source ?? "import" },
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
    ...(json.fxFixings !== undefined ? { fxFixings: deserializeFxFixings(json.fxFixings) } : {}),
    swaptionVols: json.swaptionVols,
    capletVols: json.capletVols,
    fxVols: json.fxVols,
    credit: json.credit,
  };
}

/**
 * FX fixings of a snapshot (R4-1): every entry needs a 6-letter pair, an ISO
 * date and a positive finite rate – anything else raises
 * `PricingError("INVALID_TRADE")`-style structural errors as a plain `Error`
 * with the offending index, like a malformed curve node would.
 */
function deserializeFxFixings(raw: NonNullable<MarketSnapshotJson["fxFixings"]>): FxFixing[] {
  if (!Array.isArray(raw)) throw new Error("Market snapshot: fxFixings must be an array of { pair, date, rate }");
  return raw.map((f, i) => {
    const pair = typeof f?.pair === "string" ? normalizeFxPair(f.pair) : "";
    if (!/^[A-Z]{6}$/.test(pair)) throw new Error(`Market snapshot: fxFixings[${i}].pair must be a 6-letter currency pair (got ${JSON.stringify(f?.pair)})`);
    if (typeof f.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.date))
      throw new Error(`Market snapshot: fxFixings[${i}].date must be an ISO date (got ${JSON.stringify(f.date)})`);
    if (typeof f.rate !== "number" || !Number.isFinite(f.rate) || f.rate <= 0)
      throw new Error(`Market snapshot: fxFixings[${i}].rate must be a positive finite number (got ${String(f.rate)})`);
    return { pair, date: parseISO(f.date), rate: f.rate };
  });
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
  const seenFxFixings = new Set<string>();
  (ctx.fxFixings ?? []).forEach((f, i) => {
    const pair = typeof f.pair === "string" ? normalizeFxPair(f.pair) : "";
    if (!/^[A-Z]{6}$/.test(pair)) problems.push(`FX fixing [${i}]: pair ${String(f.pair)} malformed`);
    if (!Number.isFinite(f.date)) problems.push(`FX fixing [${i}] (${pair}): date must be a serial date`);
    if (!(typeof f.rate === "number" && Number.isFinite(f.rate) && f.rate > 0))
      problems.push(`FX fixing ${pair} on ${Number.isFinite(f.date) ? toISO(f.date) : "?"} must be positive`);
    const key = `${pair}|${f.date}`;
    if (seenFxFixings.has(key)) problems.push(`FX fixing ${pair} on ${toISO(f.date)} given twice`);
    seenFxFixings.add(key);
  });
  if (ctx.meta?.snapshotTime !== undefined && !isIsoDateTime(ctx.meta.snapshotTime)) {
    problems.push(`meta.snapshotTime ${JSON.stringify(ctx.meta.snapshotTime)} is not an ISO-8601 date-time`);
  }
  return problems;
}
