import { describe, expect, it } from "vitest";
import { STANDARD_SCENARIOS, buildSampleMarket, parseISO, runScenarios } from "@deriva/pricing-core";
import { samplePortfolio } from "../state/sample-portfolio.js";
import { EMPTY_SCENARIO_FORM, buildCustomScenario, describeScenario } from "./scenarios.js";

describe("custom scenario builder", () => {
  it("maps the form to a ScenarioDefinition and omits zero shifts", () => {
    const sc = buildCustomScenario({ ...EMPTY_SCENARIO_FORM, name: " Krise ", parallelBp: 100, longBp: 50, fxPct: -5 }, "c1");
    expect(sc.id).toBe("c1");
    expect(sc.name).toBe("Krise");
    expect(sc.curveShifts).toEqual([
      { target: "*", parallelBp: 100 },
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: 0 },
          { years: 30, bp: 50 },
        ],
      },
    ]);
    expect(sc.fxShiftsPct).toEqual({ EUR: -5 });
    expect(sc.irVolShiftBp).toBeUndefined();
    expect(sc.daysForward).toBeUndefined();
    expect(describeScenario(EMPTY_SCENARIO_FORM)).toBe("keine Verschiebung");
    expect(buildCustomScenario(EMPTY_SCENARIO_FORM).name).toBe("Eigenes Szenario");
  });
  it("runs together with the standard scenarios", () => {
    const val = parseISO("2026-09-03");
    const market = buildSampleMarket(val);
    const trades = samplePortfolio(val).filter((t) => t.type === "InterestRateSwap");
    const custom = buildCustomScenario({ ...EMPTY_SCENARIO_FORM, name: "+50", parallelBp: 50 }, "c50");
    const out = runScenarios(market, trades, [...STANDARD_SCENARIOS, custom], "EUR");
    expect(out.results.length).toBe(STANDARD_SCENARIOS.length + 1);
    const r = out.results.find((x) => x.scenario.id === "c50")!;
    const p100 = out.results.find((x) => x.scenario.id === "par+100")!;
    expect(Math.abs(r.pnl)).toBeGreaterThan(0);
    expect(Math.abs(r.pnl)).toBeLessThan(Math.abs(p100.pnl));
  });
});
