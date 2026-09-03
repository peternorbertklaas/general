import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { parseDateInput } from "./date-parse.js";
import { parseNumberInput } from "./num-parse.js";
import { annuityAmortisation, frequencyMonths, parseSchedulePaste } from "./trade-ops.js";

const base = parseISO("2026-09-03");

describe("amortisation helpers (Markt N17)", () => {
  it("annuity schedule: constant instalment, declining notional, hits the residual", () => {
    const starts = Array.from({ length: 10 }, (_, i) => base + i * 365);
    const sched = annuityAmortisation(starts, 10_000_000, 0, 0.04, 12);
    expect(sched.length).toBe(10);
    expect(sched[0]!.notional).toBe(10_000_000);
    // constant payment P → N_{k+1} = N_k·1.04 − P: differences grow (Tilgung steigt)
    const tilgung = sched.slice(1).map((e, i) => sched[i]!.notional - e.notional);
    for (let i = 1; i < tilgung.length; i++) expect(tilgung[i]!).toBeGreaterThan(tilgung[i - 1]!);
    const r = 0.04;
    const P = (10_000_000 * r) / (1 - Math.pow(1 + r, -10));
    const last = sched[9]!.notional * (1 + r) - P;
    expect(Math.abs(last)).toBeLessThan(1); // fully repaid after the 10th instalment
    const withResidual = annuityAmortisation(starts, 10_000_000, 2_000_000, 0.04, 12);
    const lastR = withResidual[9]!.notional * (1 + r) - ((10_000_000 - 2_000_000 / Math.pow(1 + r, 10)) * r) / (1 - Math.pow(1 + r, -10));
    expect(lastR).toBeCloseTo(2_000_000, 0);
    // zero rate degenerates to linear
    const lin = annuityAmortisation(starts, 10_000_000, 0, 0, 12);
    expect(lin[5]!.notional).toBe(5_000_000);
    expect(frequencyMonths("6M")).toBe(6);
    expect(frequencyMonths("1Y")).toBe(12);
    expect(frequencyMonths("ZC")).toBe(0);
  });
  it("parses a pasted Datum;Nominal table (German dates and numbers, tabs or semicolons)", () => {
    const text = "Datum;Nominal\n15.03.2027;10.000.000\n15.09.2027\t9.500.000\n2028-03-15;9,0m\nquatsch;abc\n";
    const out = parseSchedulePaste(
      text,
      (s) => parseDateInput(s, { base }),
      (s) => parseNumberInput(s)?.value,
    );
    expect(out).toEqual([
      { date: parseISO("2027-03-15"), notional: 10_000_000 },
      { date: parseISO("2027-09-15"), notional: 9_500_000 },
      { date: parseISO("2028-03-15"), notional: 9_000_000 },
    ]);
  });
});
