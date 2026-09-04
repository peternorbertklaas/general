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
import { type BootstrapSpec, type InterpolatedCurve, type MarketContext, type ParRiskSpecs, parseISO, toISO } from "@deriva/pricing-core";

/** The core's `CurveBuildSpec` (one entry of `ParRiskSpecs` with its id) – derived here so the API stays on the ADR-024 surface. */
export type CurveBuildSpec = ParRiskSpecs[string] & { id: string };

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
 * One entry of the snapshot envelope's `quotes` (Markt R9-1, ADR-027 R9): the bootstrap spec of a runtime curve in
 * the shape `POST /api/market/curves` accepts (`spec`), keyed by the curve it belongs to. The workstation exports
 * the same shape for its "+ Kurve" curves. The curve itself travels in `curves` as before – the spec only serves
 * par risk (`parRiskSpecs`) and a later rebuild.
 */
export type RuntimeCurveQuotes = { curveId: string; spec: BootstrapBodySpec };

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
export function toCurveBuildSpec(spec: BootstrapBodySpec): CurveBuildSpec {
  const { turnOfYear, ...rest } = spec;
  return { ...rest, ...(turnOfYear ? { turnOfYear: turnOfYear.map((j) => ({ ...j, date: parseISO(j.date) })) } : {}) };
}

/**
 * The inverse of `toCurveBuildSpec`: a core `CurveBuildSpec` (the sample market's `sampleBootstrapSpecs`, serial
 * turn-of-year dates) in the API body shape, so the snapshot envelope's `quotes` can carry the sample curves' specs
 * too (Markt R10-1: until round 10 the sample specs were implicit – not exported, assumed on import).
 */
export function fromCurveBuildSpec(spec: CurveBuildSpec): BootstrapBodySpec {
  const { turnOfYear, ...rest } = spec;
  return { ...rest, ...(turnOfYear ? { turnOfYear: turnOfYear.map((j) => ({ ...j, date: toISO(j.date) })) } : {}) };
}

/**
 * Ids of the curves a spec is built on (same rule as the core's `curveDependencies`): the dual-curve discount curve,
 * explicit `referenceCurveIds` and the curve ids inside BasisSwap / XccyBasis / FxSwapPoints quotes. Used to find the
 * curves that must be re-bootstrapped when one of their inputs is replaced (`POST /api/market/curves`, rebuilds).
 */
export function specDependencies(spec: BootstrapBodySpec): string[] {
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

/**
 * Bodies in dependency order (a body after everything it is built on that is itself in `bodies`; stable for
 * independent bodies). Dependencies outside `bodies` – an imported curve without quotes – are fixed inputs and do
 * not order anything. Throws on a cycle.
 */
export function orderBodies(bodies: Iterable<BootstrapBody>): BootstrapBody[] {
  const byId = new Map<string, BootstrapBody>();
  for (const b of bodies) byId.set(b.spec.id, b);
  const out: BootstrapBody[] = [];
  const done = new Set<string>();
  const visit = (body: BootstrapBody, path: string[]) => {
    const id = body.spec.id;
    if (done.has(id)) return;
    if (path.includes(id)) throw new Error(`Circular curve dependency: ${[...path, id].join(" -> ")}`);
    for (const d of specDependencies(body.spec)) {
      const dep = byId.get(d);
      if (dep) visit(dep, [...path, id]);
    }
    done.add(id);
    out.push(body);
  };
  for (const body of byId.values()) visit(body, []);
  return out;
}

/**
 * The bodies that must be (re-)bootstrapped when the curves `changed` are replaced: every body that transitively
 * depends on one of them (and, with `includeChanged`, the changed bodies themselves), in dependency order.
 * Only ids present in `bodies` count – a dependency outside the known specs is a fixed input.
 */
export function affectedBodies(changed: Iterable<string>, bodies: Map<string, BootstrapBody>, includeChanged = false): BootstrapBody[] {
  const seed = new Set(changed);
  const affected = new Set(seed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, body] of bodies) {
      if (!affected.has(id) && specDependencies(body.spec).some((d) => affected.has(d))) {
        affected.add(id);
        grew = true;
      }
    }
  }
  const selected = [...bodies.values()].filter((b) => affected.has(b.spec.id) && (includeChanged || !seed.has(b.spec.id)));
  return orderBodies(selected);
}
