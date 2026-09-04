import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as internal from "./internal.js";
import * as pub from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// N6-01 – two entry points: curated public surface (SemVer) and `./internal`
// ---------------------------------------------------------------------------
describe("N6-01 – entry points of @deriva/pricing-core (ADR-024)", () => {
  it("tools/gen-index.mjs --check: every module export is reachable through exactly one entry point and every app import is public", () => {
    const out = execFileSync(process.execPath, [resolve(root, "tools/gen-index.mjs"), "--check"], { cwd: root, encoding: "utf8" });
    expect(out).toMatch(/^OK: public \d+ names, internal \d+ names/);
  });

  it("implementation helpers are no longer on the public surface but available from ./internal", () => {
    const moved = [
      "brent",
      "newton",
      "solveBracketed",
      "locate",
      "cubicSplineCoefficients",
      "monotoneConvexCoefficients",
      "bilinear",
      "pipFactor",
      "nextTradeId",
      "legPeriods",
      "scheduleDates",
      "priceLeg",
      "cvaGeneric",
      "olsRegression",
      "csvCell",
      "SAMPLE_EURUSD_VOLS",
      "upfrontPremiumLeg",
    ];
    for (const name of moved) {
      expect(name in pub, `${name} must not be public`).toBe(false);
      expect(name in internal, `${name} must be in ./internal`).toBe(true);
    }
    expect(typeof internal.nextTradeId("T")).toBe("string");
  });

  it("the documented public surface (ADR-024) stays public", () => {
    for (const name of [
      "priceTrade",
      "pricePortfolio",
      "computeRisk",
      "computeTheta",
      "parRisk",
      "vegaBuckets",
      "runScenarios",
      "computeXva",
      "hazardFromSpread",
      "buildValuationReport",
      "cashflowTable",
      "emirValuationRecord",
      "hedgeEffectivenessReport",
      "PricingError",
      "parseISO",
      "toISO",
      "advance",
      "getCalendar",
      "addTenor",
      "stableStringify",
      "hashString",
      "validateVolSurfaces",
      "buildSampleMarket",
      "SAMPLE_QUOTES",
      "makeVanillaSwap",
      "BARRIER_STATE_UNKNOWN_PREFIX",
      "UPFRONT_LEG_TYPE",
    ]) {
      expect(name in pub, `${name} must be public`).toBe(true);
    }
  });

  it("package.json declares both entry points with types and the build emits them", () => {
    const pkg = JSON.parse(
      execFileSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync('package.json','utf8'))"], { cwd: root, encoding: "utf8" }),
    ) as {
      exports: Record<string, { types: string; import: string }>;
    };
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
    expect(pkg.exports["./internal"]).toEqual({ types: "./dist/internal.d.ts", import: "./dist/internal.js" });
  });
});
