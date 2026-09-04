import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, HeatmapChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ComposeOption } from "echarts/core";
import type { BarSeriesOption, HeatmapSeriesOption, LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption, VisualMapComponentOption } from "echarts/components";
import { useStore } from "../state/store.js";
import { baseTheme } from "./chart-theme.js";

// Tree-shaken ECharts: only the chart types / components the workstation uses (arch N-10).
echarts.use([BarChart, LineChart, ScatterChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | ScatterSeriesOption
  | HeatmapSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
>;

/**
 * The actual ECharts wrapper. Only imported through the lazy `EChart` in
 * `EChart.tsx`, so the chart library lives in its own chunk and the start
 * route never loads it (ADR-026 / N4-07).
 */
export default function EChartImpl({ option, className, ariaLabel }: { option: EChartsOption; className?: string; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  // Re-read the CSS tokens whenever the option or the theme changes (L-14).
  useEffect(() => {
    chart.current?.setOption({ ...(baseTheme() as EChartsOption), ...option }, { notMerge: true });
  }, [option, theme]);
  return <div ref={ref} className={className ?? "chart"} role="img" aria-label={ariaLabel ?? "Diagramm"} />;
}
