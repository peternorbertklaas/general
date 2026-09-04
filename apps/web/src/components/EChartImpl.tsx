import { useEffect, useRef } from "react";
import type { ComposeOption } from "echarts/core";
import type { BarSeriesOption, HeatmapSeriesOption, LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption, VisualMapComponentOption } from "echarts/components";
import { useStore } from "../state/store.js";
import { baseTheme } from "./chart-theme.js";
import type { EChartsLib } from "./echarts-lib.js";

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

export interface EChartImplProps {
  option: EChartsOption;
  className?: string;
  ariaLabel?: string;
}

/**
 * The actual ECharts wrapper. The library arrives as a parameter (loaded by the
 * lazy `EChart` in `EChart.tsx` through `import("./echarts-lib.js")`), so this
 * module holds no static import of ECharts: a failed library load names the
 * library chunk, and the lazy wrapper's retry re-imports exactly that chunk
 * with a cache-busting query (R7-05). The start route never loads either
 * chunk (ADR-026 / N4-07).
 */
export function makeEChartImpl(echarts: EChartsLib) {
  type Instance = ReturnType<EChartsLib["init"]>;
  return function EChartImpl({ option, className, ariaLabel }: EChartImplProps) {
    const ref = useRef<HTMLDivElement>(null);
    const chart = useRef<Instance | null>(null);
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
  };
}
