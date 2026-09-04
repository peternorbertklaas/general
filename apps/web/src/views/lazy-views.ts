/**
 * Route-level code splitting (ADR-026 / N4-07): every view except the blotter
 * (the start route) is its own chunk. The chart views pull the ECharts chunk in
 * with them, so the initial load carries shell + blotter + palette + store +
 * pricing core only. `preloadViews()` fetches everything (tests, idle prefetch).
 */
import type { ComponentType } from "react";
import type { ViewId } from "../hotkeys/keymap.js";
import { lazyComponent } from "../lib/lazy.js";
import { preloadECharts } from "../components/EChart.js";
import { ViewSkeleton } from "../components/ViewSkeleton.js";

type View = ComponentType<object>;
const lazyView = (loader: () => Promise<View>) => lazyComponent<object>(() => loader().then((c) => ({ default: c })), { fallback: ViewSkeleton });

export const PricingWorkspace = lazyView(() => import("./PricingWorkspace.js").then((m) => m.PricingWorkspace));
export const CurvesView = lazyView(() => import("./CurvesView.js").then((m) => m.CurvesView));
export const ScenariosView = lazyView(() => import("./ScenariosView.js").then((m) => m.ScenariosView));
export const MarketView = lazyView(() => import("./MarketView.js").then((m) => m.MarketView));
export const ReportView = lazyView(() => import("./ReportView.js").then((m) => m.ReportView));
export const CompareView = lazyView(() => import("./CompareView.js").then((m) => m.CompareView));
export const HedgeView = lazyView(() => import("./HedgeView.js").then((m) => m.HedgeView));

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
