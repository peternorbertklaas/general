import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // N7-03: `surface.test.ts` spawns the TypeScript compiler API and the par-risk tests re-bootstrap
    // curves ~20×; under parallel load (lint / typecheck alongside) the 5 s default timed out.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/internal.ts"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
