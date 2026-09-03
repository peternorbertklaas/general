import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
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
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Stable vendor chunks: charts, the pricing engine and the React runtime are cached independently of app code.
        manualChunks(id) {
          if (id.includes("node_modules/echarts") || id.includes("node_modules/zrender")) return "echarts";
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
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/test/**"],
      thresholds: { lines: 45, functions: 40, branches: 35, statements: 45 },
    },
  },
}));
