import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { swPrecachePlugin } from "./scripts/sw-precache-plugin.js";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => ({
  // The service worker is emitted from `src/sw/sw.js` with the built asset list injected (US-8.13 / R5-F4).
  plugins: [react(), swPrecachePlugin({ templatePath: `${here}src/sw/sw.js` })],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    // Hidden source maps in production: generated for error tooling, not referenced from the bundle (arch N-10).
    sourcemap: mode === "production" ? "hidden" : true,
    // ADR-026: the size gate is `scripts/size-limit.mjs` (gzip budgets per chunk); this is only Rollup's advisory warning.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // Stable vendor chunks: charts, the pricing engine and the React runtime are cached independently of app code.
        // ECharts is only imported by lazily loaded views / the lazy chart wrapper, so the start chunk never pulls it in (N4-07).
        manualChunks(id) {
          // `components/echarts-lib.ts` is the dynamic entry of the chart library (R7-05): the library chunk itself is what the
          // lazy chart wrapper imports, so a failed load names *this* URL and "Erneut versuchen" can cache-bust it.
          if (id.includes("node_modules/echarts") || id.includes("node_modules/zrender") || id.includes("components/echarts-lib")) return "echarts";
          if (id.includes("packages/pricing-core") || id.includes("@deriva/pricing-core")) return "core";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler") || id.includes("node_modules/zustand")) return "react";
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // App-level tests render the whole workstation (≈1 300 sample fixings, lazy views); under parallel load (E2E, API
    // tests, probes on a 2–4 core runner) 10 s was still too tight (Architektur N10-03) – 20 s for tests and hooks.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/test/**", "src/sw/**"],
      // ADR-026 (N4-07): thresholds 2–3 points below the measured values (functions wider because lazy/SW glue is
      // excluded). Measured R7 on vitest 5 / v8 (statements are counted separately from lines since the toolchain
      // upgrade): lines 81.1 / statements 78.3 / branches 72.4 / functions 70.2.
      thresholds: { lines: 78, functions: 50, branches: 68, statements: 75 },
    },
  },
}));
