import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

// echarts needs canvas – stub the tree-shaken core in jsdom.
vi.mock("echarts/core", () => ({
  init: () => ({ setOption: () => {}, resize: () => {}, dispose: () => {} }),
  use: () => {},
}));
vi.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {}, ScatterChart: {}, HeatmapChart: {} }));
vi.mock("echarts/components", () => ({ GridComponent: {}, LegendComponent: {}, TooltipComponent: {}, VisualMapComponent: {} }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

class RO {
  observe() {}
  disconnect() {}
  unobserve() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

// Zero tolerance for React warnings / errors during tests (arch N-09): any
// console.error / console.warn fails the test that produced it.
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  consoleSpies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
});
afterEach(() => {
  const calls = consoleSpies.flatMap((s) => s.mock.calls);
  consoleSpies.forEach((s) => s.mockRestore());
  if (calls.length > 0) throw new Error(`console output during test:\n${calls.map((c) => c.map(String).join(" ")).join("\n")}`);
});
