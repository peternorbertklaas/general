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
 * Historical FX fixing (R4-1): the rate of `pair` ("EURUSD" = 1 EUR in USD)
 * observed on `date`. Used for the notional resets of mark-to-market
 * cross-currency swaps whose reset date lies on or before the valuation date;
 * `getFxFixing` also serves the inverse quotation (1 / rate).
 */
export interface FxFixing {
  pair: string;
  date: SerialDate;
  rate: number;
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
  /** Historical FX fixings for MtM-reset notionals (pair, date, rate); see `getFxFixing`. */
  fxFixings?: FxFixing[];
  /** How to treat missing historical fixings (default "curve"); also governs missing FX reset fixings. */
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

/** Per-array lookup index for FX fixings (cached on the array identity, like `getFixing`). */
const fxFixingIndexCache = new WeakMap<FxFixing[], Map<string, number>>();

/** Normalise "eur/usd", "EURUSD" → "EURUSD". */
export function normalizeFxPair(pair: string): string {
  return pair.replace("/", "").toUpperCase();
}

/**
 * Historical FX fixing of `pair` on `date` (R4-1). The direct quotation wins;
 * when only the inverse pair is loaded its reciprocal is returned. Undefined
 * when no fixing is loaded for that date.
 */
export function getFxFixing(ctx: MarketContext, pair: string, date: SerialDate): number | undefined {
  const fixings = ctx.fxFixings;
  if (!fixings || fixings.length === 0) return undefined;
  let map = fxFixingIndexCache.get(fixings);
  if (!map) {
    map = new Map<string, number>();
    for (const f of fixings) map.set(`${normalizeFxPair(f.pair)}|${f.date}`, f.rate);
    fxFixingIndexCache.set(fixings, map);
  }
  const p = normalizeFxPair(pair);
  if (p.length !== 6) return undefined;
  const direct = map.get(`${p}|${date}`);
  if (direct !== undefined) return direct;
  const inverse = map.get(`${p.slice(3)}${p.slice(0, 3)}|${date}`);
  return inverse !== undefined && inverse !== 0 ? 1 / inverse : undefined;
}

/**
 * True when discounting `currency` under a CSA in `collateralCcy` uses a
 * dedicated collateral curve: either the two currencies coincide (cash
 * collateral in the leg currency – the currency's own OIS curve is the CSA
 * curve) or a `${currency}|${collateralCcy}` mapping exists (Markt R4-1).
 */
export function hasCollateralCurve(ctx: MarketContext, currency: string, collateralCcy: string): boolean {
  if (currency.toUpperCase() === collateralCcy.toUpperCase()) return true;
  return ctx.collateralDiscountCurveId?.[`${currency}|${collateralCcy}`] !== undefined;
}

/**
 * `COLLATERAL_CURVE_MISSING:` warnings for every currency of a collateralised
 * trade that has no collateral-specific discount curve in the market and is
 * therefore discounted on its own standard curve (Markt R4-1). Empty when the
 * trade is uncollateralised or every currency has a CSA curve.
 */
export function collateralCurveWarnings(ctx: MarketContext, currencies: Iterable<string>, collateralCcy: string | undefined): string[] {
  if (!collateralCcy) return [];
  const out: string[] = [];
  for (const ccy of currencies) {
    if (hasCollateralCurve(ctx, ccy, collateralCcy)) continue;
    const fallback = ctx.discountCurveId[ccy];
    out.push(
      `COLLATERAL_CURVE_MISSING: no ${ccy} discount curve for collateral in ${collateralCcy} (collateralDiscountCurveId "${ccy}|${collateralCcy}"); ` +
        `${fallback ? `discounted on ${fallback}` : "no discount curve"} – cross-currency basis not priced`,
    );
  }
  return out;
}

export function withCurves(ctx: MarketContext, curves: Record<string, Curve>): MarketContext {
  return { ...ctx, curves: { ...ctx.curves, ...curves } };
}
