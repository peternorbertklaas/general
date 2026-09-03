import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// echarts needs canvas – stub it in jsdom.
vi.mock("echarts", () => ({
  init: () => ({ setOption: () => {}, resize: () => {}, dispose: () => {} }),
}));

class RO {
  observe() {}
  disconnect() {}
  unobserve() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
