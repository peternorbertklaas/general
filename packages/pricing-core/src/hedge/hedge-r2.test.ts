import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { addTenor, parseISO } from "../dates/date.js";
import { makeVanillaSwap } from "../instruments/builders.js";
import { type InterestRateSwap } from "../instruments/types.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { type HedgeRelationship, basisCurvesFor, basisScenarios, hasOnlyParallelCurveShocks, hedgeEffectivenessReport, regressionScenarios } from "./hedge.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));
const maturity = addTenor(spot, "5Y");

function relationship(index: string): { swap: InterestRateSwap; rel: HedgeRelationship } {
  const swap = makeVanillaSwap({ id: "IRS-6M", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity });
  const rel: HedgeRelationship = {
    id: "HR-BASIS",
    name: "Zinssicherung 3M-Kredit mit 6M-Swap",
    type: "CashFlowHedge",
    hedgedItem: {
      description: "Roll-over-Kredit 3M",
      currency: "EUR",
      notional: 1e7,
      kind: "FloatingRateLoan",
      index,
      effectiveDate: spot,
      maturityDate: maturity,
    },
    hedgingInstrumentId: "IRS-6M",
    designationDate: VAL,
    method: "Regression",
    accountingFramework: "IFRS9",
  };
  return { swap, rel };
}

describe("R2-4 – basis scenarios in the hedge effectiveness tests", () => {
  it("scenario helpers: basis / discount shocks, parallel-only detection, basis curves of an index mismatch", () => {
    const b = basisScenarios(["EUR-EURIBOR-3M"], ["EUR-ESTR"]);
    expect(b.map((s) => s.id)).toEqual([
      "basis-EUR-EURIBOR-3M+10",
      "basis-EUR-EURIBOR-3M-10",
      "basis-EUR-EURIBOR-3M+25",
      "basis-EUR-EURIBOR-3M-25",
      "ois-EUR-ESTR+25",
      "ois-EUR-ESTR-25",
    ]);
    expect(b.every((s) => s.curveShifts!.length === 1 && s.curveShifts![0]!.target !== "*")).toBe(true);
    expect(hasOnlyParallelCurveShocks(regressionScenarios())).toBe(true);
    expect(hasOnlyParallelCurveShocks(regressionScenarios({ basisCurveIds: ["EUR-EURIBOR-3M"] }))).toBe(false);
    expect(regressionScenarios({ basisCurveIds: ["EUR-EURIBOR-3M"], discountCurveIds: ["EUR-ESTR"] })).toHaveLength(18 + 6);
    expect(basisCurvesFor(ctx, "EUR", "EURIBOR-3M", "EURIBOR-6M")).toEqual({
      basisCurveIds: ["EUR-EURIBOR-3M", "EUR-EURIBOR-6M"],
      discountCurveIds: ["EUR-ESTR"],
    });
    // an OIS-indexed loan: its projection curve is the discount curve → reported once, as discount basis
    expect(basisCurvesFor(ctx, "EUR", "ESTR", "EURIBOR-6M")).toEqual({ basisCurveIds: ["EUR-EURIBOR-6M"], discountCurveIds: ["EUR-ESTR"] });
  });

  it("3M loan vs 6M payer swap: basis scenarios are added, R² < 1 and slope ≠ 1, basis dollar-offset exposes the mismatch", () => {
    const { swap, rel } = relationship("EURIBOR-3M");
    const rep = hedgeEffectivenessReport(ctx, rel, swap, { designationCtx: ctx });
    expect(rep.criticalTerms.checks.find((c) => c.term === "index")!.match).toBe(false);
    expect(rep.basisScenarioIds).toHaveLength(10);
    expect(rep.regression.n).toBe(28);
    expect(rep.regression.assessable).toBe(true);
    expect(rep.regression.r2!).toBeLessThan(0.999);
    expect(Math.abs(rep.regression.slope! - 1)).toBeGreaterThan(0.005);
    // the prospective parallel test still looks perfect – the basis test does not
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(1, 1);
    expect(rep.dollarOffsetBasis).toBeDefined();
    expect(rep.dollarOffsetBasis!.assessable).toBe(true);
    expect(Math.abs(rep.dollarOffsetBasis!.ratio!)).toBeLessThan(0.2); // the 6M swap does not react to a 3M-curve shock
    expect(rep.dollarOffsetBasis!.effective).toBe(false);
    expect(rep.warnings.some((w) => w.startsWith("Basis-Szenario"))).toBe(true);
    expect(rep.warnings.some((w) => w.startsWith("Regression ohne Basis-Szenarien"))).toBe(false);
    expect(rep.summary.some((s) => s.includes("Basis-Szenarien"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("Basis-Szenario"))).toBe(true);
    // the same relationship with the old parallel-only set is flagged
    const parallelOnly = hedgeEffectivenessReport(ctx, rel, swap, { designationCtx: ctx, regressionScenarios: regressionScenarios() });
    expect(parallelOnly.regression.n).toBe(18);
    expect(parallelOnly.regression.r2!).toBeGreaterThan(0.9999);
    expect(parallelOnly.basisScenarioIds).toEqual([]);
    expect(parallelOnly.warnings.some((w) => w.startsWith("Regression ohne Basis-Szenarien"))).toBe(true);
    // opting out of the automatic basis scenarios also warns
    const optOut = hedgeEffectivenessReport(ctx, rel, swap, { designationCtx: ctx, basisScenarios: false });
    expect(optOut.regression.n).toBe(18);
    expect(optOut.warnings.some((w) => w.startsWith("Regression ohne Basis-Szenarien"))).toBe(true);
  });

  it("matching indices keep the default 18-scenario set without basis shocks or basis warnings", () => {
    const { swap, rel } = relationship("EURIBOR-6M");
    const rep = hedgeEffectivenessReport(ctx, rel, swap, { designationCtx: ctx });
    expect(rep.basisScenarioIds).toEqual([]);
    expect(rep.regression.n).toBe(18);
    expect(rep.dollarOffsetBasis).toBeUndefined();
    expect(rep.warnings.some((w) => w.includes("Basis"))).toBe(false);
    expect(rep.regression.r2!).toBeGreaterThan(0.999);
  });

  it("€STR loan vs EURIBOR swap: discount-curve shock is the basis scenario", () => {
    const { swap, rel } = relationship("ESTR");
    const rep = hedgeEffectivenessReport(ctx, rel, swap, { designationCtx: ctx });
    expect(rep.basisScenarioIds.some((id) => id.startsWith("ois-EUR-ESTR"))).toBe(true);
    expect(rep.basisScenarioIds.some((id) => id.startsWith("basis-EUR-EURIBOR-6M"))).toBe(true);
    expect(rep.regression.r2!).toBeLessThan(0.999);
    expect(rep.dollarOffsetBasis).toBeDefined();
  });
});
