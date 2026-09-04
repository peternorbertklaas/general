/**
 * The tree-shaken ECharts library as one dynamically imported module (arch
 * N-10 / R7-05). `EChart.tsx` imports this file with `import()`, so the whole
 * library lives in the `echarts-*.js` chunk (see `manualChunks` in
 * `vite.config.ts`) and – unlike a static import inside the chart component –
 * a failed load names this chunk's URL, which the lazy wrapper's second attempt
 * re-imports with a cache-busting query ("Erneut versuchen" works for the
 * library chunk, not only for view chunks).
 */
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, HeatmapChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Only the chart types / components the workstation uses.
echarts.use([BarChart, LineChart, ScatterChart, HeatmapChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export type EChartsLib = typeof echarts;

export default echarts;
