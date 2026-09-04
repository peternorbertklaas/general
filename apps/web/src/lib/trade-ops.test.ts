import { describe, expect, it } from "vitest";
import {
  SAMPLE_QUOTES,
  type FixedLeg,
  type FloatLeg,
  addTenor,
  buildSampleMarket,
  makeCrossCurrencySwap,
  makeVanillaSwap,
  parseISO,
  priceTrade,
} from "@deriva/pricing-core";
import { parseDateInput } from "./date-parse.js";
import { parseNumberInput } from "./num-parse.js";
import {
  annuityAmortisation,
  applyParSolve,
  frequencyMonths,
  hasCouponSchedule,
  keyMetricLabel,
  parseSchedulePaste,
  quoteExpired,
  scheduleValueAt,
} from "./trade-ops.js";

const base = parseISO("2026-09-03");
const market = buildSampleMarket(base, SAMPLE_QUOTES);
const spot = parseISO("2026-09-07");

describe("par solve with coupon schedules (step-up)", () => {
  it("applyParSolve moves the whole staircase so the first coupon equals parRateBase and the PV becomes zero", () => {
    const swap = makeVanillaSwap({
      currency: "EUR",
      notional: 10_000_000,
      payReceiveFixed: "Pay",
      fixedRate: 0.025,
      effectiveDate: spot,
      maturity: "5Y",
      stepUp: [
        { date: addTenor(spot, "1Y"), rate: 0.03 },
        { date: addTenor(spot, "2Y"), rate: 0.035 },
      ],
    });
    expect(hasCouponSchedule(swap)).toBe(true);
    const r = priceTrade(market, swap, "EUR");
    const parBase = r.analytics.parRateBase as number;
    expect(parBase).not.toBeCloseTo(r.analytics.parRateFlat as number, 6);
    const solved = applyParSolve(swap, r)!;
    const fixed = solved.type === "InterestRateSwap" ? (solved.legs.find((l) => l.type === "Fixed") as FixedLeg) : undefined;
    expect(fixed).toBeDefined();
    const before = (swap.legs.find((l) => l.type === "Fixed") as FixedLeg).rateSchedule!;
    const after = fixed!.rateSchedule!;
    // step differences are preserved, the first coupon is the base par rate
    expect(after[0]!.rate).toBeCloseTo(parBase, 10);
    for (let i = 1; i < after.length; i++) expect(after[i]!.rate - after[0]!.rate).toBeCloseTo(before[i]!.rate - before[0]!.rate, 10);
    expect(Math.abs(priceTrade(market, solved, "EUR").pv)).toBeLessThan(1); // exact: PV is linear in the base coupon
    // without a schedule the ordinary par rate is used
    const plain = makeVanillaSwap({ currency: "EUR", notional: 10_000_000, payReceiveFixed: "Pay", fixedRate: 0.025, effectiveDate: spot, maturity: "5Y" });
    const solvedPlain = applyParSolve(plain, priceTrade(market, plain, "EUR"))!;
    expect(Math.abs(priceTrade(market, solvedPlain, "EUR").pv)).toBeLessThan(1);
    expect(hasCouponSchedule(plain)).toBe(false);
  });
  it("CCS: key metric is the fair basis spread and applyParSolve sets the spread of the first leg", () => {
    const ccs = makeCrossCurrencySwap({ pair: "EURUSD", domesticNotional: 10_000_000, fxSpot: 1.17, spread: -0.002, effectiveDate: spot, tenor: "5Y" });
    expect(keyMetricLabel(ccs)).toBe("Fairer Basis-Spread");
    const solved = applyParSolve(ccs, priceTrade(market, ccs, "EUR"))!;
    expect(Math.abs(priceTrade(market, solved, "EUR").pv)).toBeLessThan(5);
    // spread schedule on the first leg: the staircase is shifted, steps preserved
    const leg0 = ccs.legs[0] as FloatLeg;
    const stepped = { ...ccs, legs: [{ ...leg0, spreadSchedule: [{ date: addTenor(spot, "2Y"), spread: -0.001 }] }, ccs.legs[1]!] };
    const solved2 = applyParSolve(stepped, priceTrade(market, stepped, "EUR"))!;
    const l0 = (solved2.type === "CrossCurrencySwap" ? solved2.legs[0] : undefined) as FloatLeg;
    expect(l0.spreadSchedule![0]!.spread - l0.spread!).toBeCloseTo(0.001, 10);
    expect(Math.abs(priceTrade(market, solved2, "EUR").pv)).toBeLessThan(5);
    expect(
      scheduleValueAt(
        [
          { date: 10, spread: 1 },
          { date: 20, spread: 2 },
        ],
        "spread",
        15,
        0,
      ),
    ).toBe(1);
    expect(scheduleValueAt([{ date: 10, spread: 1 }], "spread", 5, 0.5)).toBe(0.5);
  });
  it("quoteExpired flags firm quotes past their validity date only", () => {
    expect(quoteExpired({ status: "Quoted", quoteValidUntil: base - 1 }, base)).toBe(true);
    expect(quoteExpired({ status: "Quoted", quoteValidUntil: base }, base)).toBe(false);
    expect(quoteExpired({ status: "Quoted" }, base)).toBe(false);
    expect(quoteExpired({ status: "Live", quoteValidUntil: base - 10 }, base)).toBe(false);
  });
});

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
