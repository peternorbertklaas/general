/**
 * Route-level code splitting (ADR-026 / N4-07): every view except the blotter
 * (the start route) is its own chunk. The chart views pull the ECharts chunk in
 * with them, so the initial load carries shell + blotter + palette + store +
 * pricing core only. `preloadViews()` fetches everything (tests, idle prefetch).
 * A failed chunk load is retried once with a cache-busting URL and otherwise
 * rendered as a German error card with "Neu laden" (R6-01, `lib/lazy.ts`).
 */
import type { ComponentType } from "react";
import type { ViewId } from "../hotkeys/keymap.js";
import { lazyComponent, retryImport } from "../lib/lazy.js";
import { preloadECharts } from "../components/EChart.js";
import { ViewSkeleton } from "../components/ViewSkeleton.js";

type View = ComponentType<object>;
type Namespace = Record<string, unknown>;
/**
 * `loader` imports the view module, `pick` selects the component from its
 * namespace – the retry re-imports the chunk URL named in the error (a fresh
 * namespace object) and applies the same `pick`.
 */
const lazyView = (loader: () => Promise<Namespace>, pick: (m: Namespace) => View) =>
  lazyComponent<object>(() => loader().then((m) => ({ default: pick(m) })), {
    fallback: ViewSkeleton,
    label: "Ansicht",
    retry: (e) => retryImport<Namespace>(e)?.then((m) => ({ default: pick(m) })),
  });

export const PricingWorkspace = lazyView(
  () => import("./PricingWorkspace.js"),
  (m) => m.PricingWorkspace as View,
);
export const CurvesView = lazyView(
  () => import("./CurvesView.js"),
  (m) => m.CurvesView as View,
);
export const ScenariosView = lazyView(
  () => import("./ScenariosView.js"),
  (m) => m.ScenariosView as View,
);
export const MarketView = lazyView(
  () => import("./MarketView.js"),
  (m) => m.MarketView as View,
);
export const ReportView = lazyView(
  () => import("./ReportView.js"),
  (m) => m.ReportView as View,
);
export const CompareView = lazyView(
  () => import("./CompareView.js"),
  (m) => m.CompareView as View,
);
export const HedgeView = lazyView(
  () => import("./HedgeView.js"),
  (m) => m.HedgeView as View,
);

const LAZY: Partial<Record<ViewId, { preload(): Promise<void> }>> = {
  pricing: PricingWorkspace,
  curves: CurvesView,
  scenarios: ScenariosView,
  market: MarketView,
  report: ReportView,
  compare: CompareView,
  hedge: HedgeView,
};

/** Prefetch one view's chunk (and the chart library for the chart views); errors are swallowed – the render path retries. */
export function preloadView(view: ViewId): Promise<void> {
  const v = LAZY[view];
  const charts = view === "blotter" || view === "market" ? Promise.resolve() : preloadECharts().catch(() => undefined);
  return Promise.all([v ? v.preload().catch(() => undefined) : Promise.resolve(), charts]).then(() => undefined);
}

/** Prefetch every view chunk – used by the tests (synchronous rendering afterwards) and as an idle prefetch. */
export function preloadViews(): Promise<void> {
  return Promise.all((Object.keys(LAZY) as ViewId[]).map((v) => preloadView(v))).then(() => undefined);
}
