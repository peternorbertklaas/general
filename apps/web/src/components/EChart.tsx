/**
 * Lazy chart wrapper (ADR-026 / N4-07): the ECharts library is loaded on first
 * use through `lazyComponent`, so the start chunk (blotter, palette, editor)
 * ships without it. Until the chunk has arrived a same-sized placeholder keeps
 * the layout stable. The theme helpers are re-exported from `chart-theme.ts`
 * (no ECharts import) for the views that colour bars themselves.
 */
import type { EChartsOption } from "./EChartImpl.js";
import { lazyComponent } from "../lib/lazy.js";

export type { EChartsOption };
export { baseTheme, cssVar, negColor, posColor } from "./chart-theme.js";

export interface EChartProps {
  option: EChartsOption;
  className?: string;
  ariaLabel?: string;
}

const Chart = lazyComponent(() => import("./EChartImpl.js"), {
  fallback: (p: EChartProps) => (
    <div className={`${p.className ?? "chart"} chart-loading`} role="img" aria-label={p.ariaLabel ?? "Diagramm"} aria-busy="true" />
  ),
  label: "Diagramm",
});

export function EChart(props: EChartProps) {
  return <Chart {...props} />;
}

/** Load the chart library ahead of time (e.g. when a chord that leads to a chart view starts). */
export const preloadECharts = Chart.preload;
