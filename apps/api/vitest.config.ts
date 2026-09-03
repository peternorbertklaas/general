import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // buildApp() bootstraps the sample market (~2 s); several integration tests build two instances.
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/server.ts"],
      thresholds: { lines: 75, functions: 70, branches: 60, statements: 75 },
    },
  },
});
