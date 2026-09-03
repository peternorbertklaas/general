import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export function EChart({ option, className }: { option: echarts.EChartsOption; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
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
  useEffect(() => {
    chart.current?.setOption({ ...baseTheme(), ...option }, { notMerge: true });
  }, [option]);
  return <div ref={ref} className={className ?? "chart"} />;
}

/** Resolve a CSS custom property to a concrete color (canvas cannot interpret `var(--x)`). */
export function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export const posColor = () => cssVar("--pos");
export const negColor = () => cssVar("--neg");

export function baseTheme(): echarts.EChartsOption {
  const fg2 = cssVar("--fg-2");
  const border = cssVar("--border");
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: fg2, fontSize: 11 },
    color: [cssVar("--accent"), cssVar("--accent-2"), cssVar("--info"), cssVar("--pos"), cssVar("--warn"), cssVar("--neg")],
    grid: { left: 48, right: 16, top: 28, bottom: 28, containLabel: false },
    tooltip: {
      backgroundColor: cssVar("--bg-3"),
      borderColor: cssVar("--border-strong"),
      textStyle: { color: cssVar("--fg-0"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
    },
    xAxis: { axisLine: { lineStyle: { color: border } }, axisLabel: { color: fg2 }, splitLine: { show: false } },
    yAxis: { axisLine: { show: false }, axisLabel: { color: fg2 }, splitLine: { lineStyle: { color: border } } },
  };
}
