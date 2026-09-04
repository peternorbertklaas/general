import { describe, expect, it } from "vitest";
import { SAMPLE_QUOTES, buildSampleMarket, hazardFromSpread, parseISO, survivalProbability } from "@deriva/pricing-core";
import { hazardCurveFor, normaliseCdsQuotes, tenorYears } from "./credit.js";

const VAL = parseISO("2026-09-03");
const market = buildSampleMarket(VAL, SAMPLE_QUOTES);

describe("CDS term structure → hazard curve", () => {
  it("normalises quotes (sorted, unique, positive) and bootstraps a piecewise-constant hazard curve", () => {
    expect(tenorYears("6M")).toBe(0.5);
    expect(tenorYears("5Y")).toBe(5);
    expect(tenorYears("quatsch")).toBeUndefined();
    const q = normaliseCdsQuotes([
      { tenor: "5Y", spread: 0.012 },
      { tenor: "1Y", spread: 0.008 },
      { tenor: "1Y", spread: 0.009 },
      { tenor: "x", spread: 0.01 },
      { tenor: "3Y", spread: 0 },
    ]);
    expect(q.map((x) => x.tenor)).toEqual(["1Y", "5Y"]);
    const curve = hazardCurveFor({ "Landesbank A": q }, "Landesbank A", 0.4, VAL, market.curves["EUR-ESTR"])!;
    expect(curve.times.length).toBe(2);
    expect(curve.hazards[0]).toBeCloseTo(hazardFromSpread(0.008, 0.4), 3);
    expect(curve.hazards[1]).toBeGreaterThan(curve.hazards[0]!); // upward-sloping CDS curve → rising hazard
    expect(survivalProbability(curve, 1)).toBeLessThan(1);
    expect(survivalProbability(curve, 5)).toBeLessThan(survivalProbability(curve, 1));
    expect(hazardCurveFor({}, "Landesbank A", 0.4, VAL)).toBeUndefined();
    expect(hazardCurveFor({ X: [{ tenor: "bad", spread: 0.01 }] }, "X", 0.4, VAL)).toBeUndefined();
    expect(hazardCurveFor({ X: q }, undefined, 0.4, VAL)).toBeUndefined();
  });
});
