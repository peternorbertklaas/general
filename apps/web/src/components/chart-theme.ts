/**
 * Theme tokens for charts – no ECharts import, so the start chunk can use the
 * colours (sign classes, bars) without loading the chart library (ADR-026).
 */

/** Resolve a CSS custom property to a concrete color (canvas cannot interpret `var(--x)`). */
export function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export const posColor = () => cssVar("--pos");
export const negColor = () => cssVar("--neg");

/** ECharts base option built from the CSS tokens (typed loosely here; `EChartImpl` narrows it). */
export function baseTheme(): Record<string, unknown> {
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
