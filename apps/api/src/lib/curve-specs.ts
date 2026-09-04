/**
 * Bootstrap bodies of `POST /api/market/bootstrap|curves` and their two uses beyond the
 * request itself (Architektur N8-01, Markt R8-3):
 *
 * - `resolveBootstrap` turns the API body (curve ids, ISO turn-of-year dates) into the core's
 *   `BootstrapSpec` against a given market – the route uses it once per request, the
 *   `MarketStore` again for every remembered runtime curve when the valuation date changes
 *   (`rebuild`: the curve is re-bootstrapped from its quotes, like the workstation's
 *   `rebuildMarket` with `extraCurves`).
 * - `toCurveBuildSpec` turns the same body into the `CurveBuildSpec` shape `parRisk` expects,
 *   so par sensitivities bump the quotes of every curve the store knows – sample and runtime.
 */
import { type BootstrapSpec, type InterpolatedCurve, type MarketContext, parseISO } from "@deriva/pricing-core";

/** `spec` of a bootstrap body: the core spec with ids instead of curve objects and ISO dates. */
export type BootstrapBodySpec = Omit<BootstrapSpec, "discountCurve" | "referenceCurves" | "turnOfYear"> & {
  discountCurveId?: string;
  referenceCurveIds?: string[];
  turnOfYear?: { date: string; bp: number; days?: number }[];
};

export type BootstrapBody = {
  valuationDate?: string;
  /** `POST /api/market/curves`: set `discountCurveId[currency]` to the new curve (default: only when the currency has none yet, R7-3). */
  isDiscountCurve?: boolean;
  spec: BootstrapBodySpec;
};

/**
 * Resolve an API bootstrap body against the market: curve ids → curve objects (all market
 * curves are offered as references unless `referenceCurveIds` narrows them, so
 * BasisSwap/XccyBasis/FxSwapPoints quotes find their curves) and ISO turn-of-year dates →
 * serial dates. Quotes are passed through untouched: a Future `start` may be an ISO date
 * string the core resolves itself.
 */
export function resolveBootstrap(m: MarketContext, body: BootstrapBody): { valuationDate: number; spec: BootstrapSpec } {
  const valuationDate = body.valuationDate ? parseISO(body.valuationDate) : m.valuationDate;
  const { discountCurveId, referenceCurveIds, turnOfYear, ...rest } = body.spec;
  const discountCurve = discountCurveId ? (m.curves[discountCurveId] as InterpolatedCurve | undefined) : undefined;
  const referenceCurves = Object.fromEntries((referenceCurveIds ?? Object.keys(m.curves)).filter((id) => m.curves[id]).map((id) => [id, m.curves[id]!]));
  return {
    valuationDate,
    spec: {
      ...rest,
      discountCurve,
      referenceCurves,
      ...(turnOfYear ? { turnOfYear: turnOfYear.map((j) => ({ ...j, date: parseISO(j.date) })) } : {}),
    },
  };
}

/**
 * The `CurveBuildSpec` shape of `parRisk`'s `specs` for a remembered runtime curve: the API body
 * with serial turn-of-year dates. `discountCurveId` / `referenceCurveIds` keep their meaning (the
 * core resolves them against the bumped curve set in dependency order).
 */
export function toCurveBuildSpec(spec: BootstrapBodySpec) {
  const { turnOfYear, ...rest } = spec;
  return { ...rest, ...(turnOfYear ? { turnOfYear: turnOfYear.map((j) => ({ ...j, date: parseISO(j.date) })) } : {}) };
}
