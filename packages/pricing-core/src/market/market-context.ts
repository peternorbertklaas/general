import { type Curve } from "../curves/curve.js";
import { type SerialDate } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { type SwaptionVolSurface, type CapletVolSurface } from "../models/vol-surfaces.js";
import { type FxVolSurface } from "../models/fx-vol-surface.js";

export interface FxSpot {
  /** Pair as "EURUSD" meaning 1 EUR = rate USD. */
  pair: string;
  rate: number;
  /** Spot date (settlement) */
  spotDate?: SerialDate;
}

export interface Fixing {
  index: string;
  date: SerialDate;
  value: number;
}

/**
 * Policy for historical fixings that are required but not loaded.
 * - "curve" (default): estimate with the first available curve forward and
 *   emit a `MISSING_FIXING:` warning.
 * - "throw": fail the valuation.
 */
export type MissingFixingPolicy = "curve" | "throw";

/**
 * The full set of market data needed to price a portfolio on a valuation date.
 * Curves are keyed by id; discount curves per currency (and collateral) are
 * looked up via `discountCurveId`. Everything is immutable by convention –
 * scenario engines create shifted copies.
 */
export interface MarketContext {
  valuationDate: SerialDate;
  curves: Record<string, Curve>;
  /** Discount curve id per currency, e.g. { EUR: "EUR-ESTR" } */
  discountCurveId: Record<string, string>;
  /** Optional collateral-specific overrides: key `${ccy}|${collateralCcy}` */
  collateralDiscountCurveId?: Record<string, string>;
  /** Spot rates keyed by pair ("EURUSD"), quoted for value on the pair's spot date (T+2 by convention). */
  fxSpots: Record<string, number>;
  /** Optional explicit spot dates per pair (default: T+2 / T+1 on the pair calendar). */
  fxSpotDates?: Record<string, SerialDate>;
  fixings?: Fixing[];
  /** How to treat missing historical fixings (default "curve"). */
  missingFixingPolicy?: MissingFixingPolicy;
  swaptionVols?: Record<string, SwaptionVolSurface>;
  capletVols?: Record<string, CapletVolSurface>;
  fxVols?: Record<string, FxVolSurface>;
  /** Credit data for CVA (hazard rates per counterparty id). */
  credit?: Record<string, { hazardRate: number; recovery: number }>;
  meta?: { source?: string; snapshotTime?: string; label?: string };
}

export function getCurve(ctx: MarketContext, id: string): Curve {
  const c = ctx.curves[id];
  if (!c) throw new PricingError("CURVE_NOT_FOUND", `Curve not found in market context: ${id}`, { curveId: id });
  return c;
}

export function getDiscountCurve(ctx: MarketContext, currency: string, collateralCcy?: string): Curve {
  if (collateralCcy && ctx.collateralDiscountCurveId) {
    const key = `${currency}|${collateralCcy}`;
    const id = ctx.collateralDiscountCurveId[key];
    if (id) return getCurve(ctx, id);
  }
  const id = ctx.discountCurveId[currency];
  if (!id) throw new PricingError("NO_DISCOUNT_CURVE", `No discount curve configured for ${currency}`, { currency, collateralCurrency: collateralCcy });
  return getCurve(ctx, id);
}

/** Spot for `pair`, deriving inverse and crosses via USD/EUR when necessary. */
export function getFxSpot(ctx: MarketContext, base: string, quote: string): number {
  if (base === quote) return 1;
  const direct = ctx.fxSpots[`${base}${quote}`];
  if (direct !== undefined) return direct;
  const inverse = ctx.fxSpots[`${quote}${base}`];
  if (inverse !== undefined) return 1 / inverse;
  // Try triangulation through a pivot.
  for (const pivot of ["USD", "EUR"]) {
    if (pivot === base || pivot === quote) continue;
    const a = ctx.fxSpots[`${base}${pivot}`] ?? (ctx.fxSpots[`${pivot}${base}`] ? 1 / ctx.fxSpots[`${pivot}${base}`]! : undefined);
    const b = ctx.fxSpots[`${pivot}${quote}`] ?? (ctx.fxSpots[`${quote}${pivot}`] ? 1 / ctx.fxSpots[`${quote}${pivot}`]! : undefined);
    if (a !== undefined && b !== undefined) return a * b;
  }
  throw new PricingError("NO_FX_SPOT", `FX spot not available for ${base}${quote}`, { pair: `${base}${quote}` });
}

/** Per-fixing-array lookup index (built once, cached on the array identity). */
const fixingIndexCache = new WeakMap<Fixing[], Map<string, number>>();

function fixingKey(index: string, date: SerialDate): string {
  return `${index.toUpperCase()}|${date}`;
}

export function getFixing(ctx: MarketContext, index: string, date: SerialDate): number | undefined {
  const fixings = ctx.fixings;
  if (!fixings || fixings.length === 0) return undefined;
  let map = fixingIndexCache.get(fixings);
  if (!map) {
    map = new Map<string, number>();
    for (const f of fixings) map.set(fixingKey(f.index, f.date), f.value);
    fixingIndexCache.set(fixings, map);
  }
  return map.get(fixingKey(index, date));
}

export function withCurves(ctx: MarketContext, curves: Record<string, Curve>): MarketContext {
  return { ...ctx, curves: { ...ctx.curves, ...curves } };
}
