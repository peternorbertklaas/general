import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // buildApp() bootstraps the sample market (~2 s cold); several integration tests build two or three instances and
    // `beforeAll` builds one per file. Under CI load (API and Web suites in parallel on a 2-core runner) both took
    // > 10 s (N10-03) – 30 s leaves the reserve without hiding a hang.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/server.ts"],
      thresholds: { lines: 75, functions: 70, branches: 60, statements: 75 },
    },
  },
});
