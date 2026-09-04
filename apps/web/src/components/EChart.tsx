/**
 * Lazy chart wrapper (ADR-026 / N4-07): the ECharts library is loaded on first
 * use through `lazyComponent`, so the start chunk (blotter, palette, editor)
 * ships without it. Until the chunk has arrived a same-sized placeholder keeps
 * the layout stable. The theme helpers are re-exported from `chart-theme.ts`
 * (no ECharts import) for the views that colour bars themselves.
 *
 * R7-05: the library is its own dynamic import (`echarts-lib.ts` → chunk
 * `echarts-*.js`), separate from the small component module. A failed library
 * load therefore names the library URL, and "Erneut versuchen" re-imports the
 * chunk that failed – with a cache-busting query – instead of re-running a
 * component import whose static dependency the browser remembers as failed.
 */
import type { ComponentType } from "react";
import type { EChartsOption } from "./EChartImpl.js";
import type { EChartsLib } from "./echarts-lib.js";
import { type LazyModule, chunkUrlOf, lazyComponent } from "../lib/lazy.js";

export type { EChartsOption };
export { baseTheme, cssVar, negColor, posColor } from "./chart-theme.js";

export interface EChartProps {
  option: EChartsOption;
  className?: string;
  ariaLabel?: string;
}

type LibModule = { default: EChartsLib };
type ImplModule = { makeEChartImpl: (lib: EChartsLib) => ComponentType<EChartProps> };

/** The two imports the chart needs – injectable for tests. */
export interface ChartImports {
  lib: () => Promise<LibModule>;
  impl: () => Promise<ImplModule>;
  /** Raw import of a chunk URL (cache-busting retry). */
  url: (u: string) => Promise<unknown>;
}

const DEFAULT_IMPORTS: ChartImports = {
  lib: () => import("./echarts-lib.js"),
  impl: () => import("./EChartImpl.js"),
  url: (u) => import(/* @vite-ignore */ u),
};

/** Load library + component and bind them (first attempt of the lazy wrapper). */
export async function loadChart(imp: ChartImports = DEFAULT_IMPORTS): Promise<LazyModule<EChartProps>> {
  const [lib, impl] = await Promise.all([imp.lib(), imp.impl()]);
  return { default: impl.makeEChartImpl(lib.default) };
}

/**
 * Second attempt after a failed load (R7-05): re-import the chunk the error
 * names with a cache-busting query – whichever of the two it was – and bind it
 * to the other half, which is either loaded already or loads normally.
 * `undefined` when the error names no chunk URL (the wrapper then shows the card).
 */
export function retryChart(e: unknown, imp: ChartImports = DEFAULT_IMPORTS): Promise<LazyModule<EChartProps>> | undefined {
  const url = chunkUrlOf(e);
  if (!url) return undefined;
  const sep = url.includes("?") ? "&" : "?";
  return imp.url(`${url}${sep}retry=${Date.now()}`).then(async (raw) => {
    // The bundler renames / wraps the chunk's exports (the library chunk exposes `{ t: { default: echarts } }`), so the two
    // module shapes are recognised structurally – one wrapper level deep: the library exposes `init`/`use`, the component
    // module exposes a single factory function.
    const top = raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>) : [];
    const values = [raw, ...top, ...top.map((v) => (v && typeof v === "object" ? (v as { default?: unknown }).default : undefined))];
    const lib = values.find(
      (v): v is EChartsLib => !!v && typeof (v as Partial<EChartsLib>).init === "function" && typeof (v as Partial<EChartsLib>).use === "function",
    );
    if (lib) {
      const impl = await imp.impl();
      return { default: impl.makeEChartImpl(lib) };
    }
    const factory = values.find((v): v is ImplModule["makeEChartImpl"] => typeof v === "function");
    if (factory) {
      const libModule = await imp.lib();
      return { default: factory(libModule.default) };
    }
    throw e;
  });
}

const Chart = lazyComponent<EChartProps>(() => loadChart(), {
  fallback: (p: EChartProps) => (
    <div className={`${p.className ?? "chart"} chart-loading`} role="img" aria-label={p.ariaLabel ?? "Diagramm"} aria-busy="true" />
  ),
  retry: (e) => retryChart(e),
  label: "Diagramm",
});

export function EChart(props: EChartProps) {
  return <Chart {...props} />;
}

/** Load the chart library ahead of time (e.g. when a chord that leads to a chart view starts). */
export const preloadECharts = (): Promise<void> => Chart.preload();
