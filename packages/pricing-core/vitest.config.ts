import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
