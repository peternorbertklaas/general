import { type Curve, type HazardCurve, bootstrapHazardCurve } from "@deriva/pricing-core";
import { type CdsQuote } from "../state/store.js";

/** Standard CDS pillars offered by the term-structure editor. */
export const CDS_TENORS = ["6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y"] as const;

const TENOR_RE = /^(\d+)([MY])$/i;

/** Tenor → years ("6M" → 0.5, "5Y" → 5); undefined for unreadable tenors. */
export function tenorYears(t: string): number | undefined {
  const m = TENOR_RE.exec(t.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2]!.toUpperCase() === "Y" ? n : n / 12;
}

/** Quotes sorted by tenor with duplicates / unreadable tenors removed (the bootstrap needs strictly increasing pillars). */
export function normaliseCdsQuotes(quotes: CdsQuote[]): CdsQuote[] {
  const seen = new Set<number>();
  return quotes
    .map((q) => ({ q, y: tenorYears(q.tenor) }))
    .filter((x): x is { q: CdsQuote; y: number } => x.y !== undefined && Number.isFinite(x.q.spread) && x.q.spread > 0)
    .sort((a, b) => a.y - b.y)
    .filter((x) => (seen.has(x.y) ? false : (seen.add(x.y), true)))
    .map((x) => x.q);
}

/**
 * Hazard term structure of a counterparty from its CDS quotes (core
 * `bootstrapHazardCurve`), or undefined when no usable quote exists or the
 * bootstrap fails.
 */
export function hazardCurveFor(
  cdsCurves: Record<string, CdsQuote[]>,
  counterparty: string | undefined,
  recovery: number,
  valuationDate: number,
  discount?: Curve,
): HazardCurve | undefined {
  if (!counterparty) return undefined;
  const quotes = normaliseCdsQuotes(cdsCurves[counterparty] ?? []);
  if (quotes.length === 0) return undefined;
  try {
    return bootstrapHazardCurve(quotes, recovery, valuationDate, discount);
  } catch {
    return undefined;
  }
}
