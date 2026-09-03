import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, HeatmapChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ComposeOption } from "echarts/core";
import type { BarSeriesOption, HeatmapSeriesOption, LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption, VisualMapComponentOption } from "echarts/components";
import { useStore } from "../state/store.js";

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

export function EChart({ option, className, ariaLabel }: { option: EChartsOption; className?: string; ariaLabel?: string }) {
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
    chart.current?.setOption({ ...baseTheme(), ...option }, { notMerge: true });
  }, [option, theme]);
  return <div ref={ref} className={className ?? "chart"} role="img" aria-label={ariaLabel ?? "Diagramm"} />;
}

/** Resolve a CSS custom property to a concrete color (canvas cannot interpret `var(--x)`). */
export function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export const posColor = () => cssVar("--pos");
export const negColor = () => cssVar("--neg");

export function baseTheme(): EChartsOption {
  const fg2 = cssVar("--fg-2");
  const border = cssVar("--border");
  const borderStrong = cssVar("--border-strong");
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: fg2, fontSize: 11 },
    color: [cssVar("--accent"), cssVar("--accent-2"), cssVar("--info"), cssVar("--pos"), cssVar("--warn"), cssVar("--neg")],
    grid: { left: 48, right: 24, top: 28, bottom: 28, containLabel: false },
    tooltip: {
      backgroundColor: cssVar("--bg-3"),
      borderColor: borderStrong,
      textStyle: { color: cssVar("--fg-0"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
    },
    xAxis: { axisLine: { lineStyle: { color: borderStrong } }, axisLabel: { color: fg2, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { axisLine: { show: false }, axisLabel: { color: fg2 }, splitLine: { lineStyle: { color: border } } },
  };
}
