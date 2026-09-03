import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO } from "../dates/date.js";
import { makeCapFloor, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { SAMPLE_CURVE_IDS, buildSampleMarket, sampleBootstrapSpecs } from "../market/sample-market.js";
import { priceInterestRateSwap } from "../pricing/swap-pricer.js";
import { computeRisk, parRisk, vegaBuckets } from "./sensitivities.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const SPECS = sampleBootstrapSpecs(VAL);
const SPOT = advance(VAL, "2D", getCalendar("TARGET"));

describe("parRisk", () => {
  const probe = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: SPOT, maturity: "10Y" });
  const par = priceInterestRateSwap(ctx, probe, "EUR").analytics.parRate as number;
  const parSwap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: par, effectiveDate: SPOT, maturity: "10Y" });

  it("par 10Y swap: total ≈ zero-rate DV01 (within 3%) and the Swap 10Y bucket dominates", () => {
    const zero = computeRisk(ctx, parSwap, "EUR", { bucketed: false, vega: false, theta: false });
    const rep = parRisk(ctx, parSwap, "EUR", SPECS);
    expect(rep.bumpBp).toBe(1);
    expect(Math.abs(rep.pv)).toBeLessThan(0.01);
    expect(Math.abs(rep.total / zero.dv01 - 1)).toBeLessThan(0.03);
    // all EUR curves of the sample market are reported, in dependency order
    expect(rep.curves.map((c) => c.curveId)).toEqual([SAMPLE_CURVE_IDS.eurOis, SAMPLE_CURVE_IDS.eur6m, SAMPLE_CURVE_IDS.eur3m, SAMPLE_CURVE_IDS.eurUsdXccy]);
    const eur6m = rep.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eur6m)!;
    const top = eur6m.buckets.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
    expect(top.label).toBe("Swap 10Y");
    expect(top.delta).toBeGreaterThan(0.95 * rep.total);
    expect(top.delta).toBeGreaterThan(7_000);
    // Bumping a quote and re-stripping leaves the other 6M instruments (and the trade) at par
    for (const b of eur6m.buckets) if (b !== top) expect(Math.abs(b.delta)).toBeLessThan(1);
    // A par instrument has no discount-curve risk: bumping €STR re-strips the 6M curve so the swap stays at par
    const ois = rep.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eurOis)!;
    expect(ois.buckets).toHaveLength(18);
    expect(ois.buckets.map((b) => b.label)).toContain("OIS 5Y");
    for (const b of ois.buckets) expect(Math.abs(b.delta)).toBeLessThan(1);
    // Unrelated EUR curves carry no risk for a 6M swap
    for (const id of [SAMPLE_CURVE_IDS.eur3m, SAMPLE_CURVE_IDS.eurUsdXccy]) {
      const c = rep.curves.find((x) => x.curveId === id)!;
      expect(c.buckets.some((b) => b.label.startsWith("Future") || b.label.startsWith("Xccy"))).toBe(true);
      expect(Math.abs(c.total)).toBeLessThan(1e-6);
    }
  });

  it("off-market swap carries €STR (discounting) risk because dependent curves are re-bootstrapped", () => {
    const receiver = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Receive", fixedRate: 0.04, effectiveDate: SPOT, maturity: "10Y" });
    const rep = parRisk(ctx, receiver, "EUR", SPECS);
    expect(rep.pv).toBeGreaterThan(500_000);
    const ois = rep.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eurOis)!;
    // receiving an above-market coupon: higher discount rates reduce the (positive) PV
    expect(ois.total).toBeLessThan(-100);
    const eur6m = rep.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eur6m)!;
    expect(eur6m.total).toBeLessThan(-7_000);
    const zero = computeRisk(ctx, receiver, "EUR", { bucketed: false, vega: false, theta: false });
    expect(Math.abs(rep.total / zero.dv01 - 1)).toBeLessThan(0.05);
  });

  it("curveIds restricts the report and bumpBp scales linearly", () => {
    const one = parRisk(ctx, parSwap, "EUR", SPECS, { curveIds: [SAMPLE_CURVE_IDS.eur6m] });
    expect(one.curves.map((c) => c.curveId)).toEqual([SAMPLE_CURVE_IDS.eur6m]);
    const two = parRisk(ctx, parSwap, "EUR", SPECS, { curveIds: [SAMPLE_CURVE_IDS.eur6m], bumpBp: 2 });
    expect(two.bumpBp).toBe(2);
    expect(Math.abs(two.total / (2 * one.total) - 1)).toBeLessThan(0.01);
  });

  it("accepts specs without explicit ids (key = curve id)", () => {
    const { id: _id, ...noId } = SPECS[SAMPLE_CURVE_IDS.eur6m]!;
    const rep = parRisk(ctx, parSwap, "EUR", { [SAMPLE_CURVE_IDS.eur6m]: noId, [SAMPLE_CURVE_IDS.eurOis]: SPECS[SAMPLE_CURVE_IDS.eurOis]! });
    expect(rep.curves.map((c) => c.curveId).sort()).toEqual([SAMPLE_CURVE_IDS.eur6m, SAMPLE_CURVE_IDS.eurOis].sort());
  });
});

describe("vegaBuckets", () => {
  it("swaption: buckets sum to the parallel vega and sit on the expiry row", () => {
    const sw = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "2Y", tenor: "5Y", valuationDate: VAL });
    const parallel = computeRisk(ctx, sw, "EUR", { bucketed: false, theta: false }).vega["swaption:EUR"]!;
    const reps = vegaBuckets(ctx, sw, "EUR");
    expect(reps).toHaveLength(1);
    const rep = reps[0]!;
    expect(rep.kind).toBe("swaption");
    expect(rep.key).toBe("EUR");
    expect(rep.buckets.map((b) => b.label)).toEqual(["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "15Y", "20Y"]);
    expect(Math.abs(rep.total / parallel - 1)).toBeLessThan(0.005);
    const at2y = rep.buckets.find((b) => b.label === "2Y")!;
    expect(at2y.vega).toBeGreaterThan(0.95 * rep.total);
    for (const b of rep.buckets) if (b.expiry < 2 || b.expiry > 3) expect(Math.abs(b.vega)).toBeLessThan(1e-6);
  });

  it("cap: buckets sum to the parallel vega; expiries beyond the last caplet carry none", () => {
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.025, effectiveDate: SPOT, maturity: "5Y" });
    const parallel = computeRisk(ctx, cap, "EUR", { bucketed: false, theta: false }).vega["caplet:EUR-EURIBOR-6M"]!;
    const reps = vegaBuckets(ctx, cap, "EUR");
    expect(reps).toHaveLength(1);
    const rep = reps[0]!;
    expect(rep.kind).toBe("caplet");
    expect(Math.abs(rep.total / parallel - 1)).toBeLessThan(0.005);
    for (const b of rep.buckets) {
      if (b.expiry >= 7) expect(b.vega).toBe(0);
      else expect(b.vega).toBeGreaterThan(0);
    }
  });

  it("linear trades have no vega buckets", () => {
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: SPOT, maturity: "5Y" });
    expect(vegaBuckets(ctx, swap, "EUR")).toEqual([]);
  });
});
