import { describe, expect, it } from "vitest";
import { addDays, parseISO } from "../dates/date.js";
import { makeFxForward, makeFxOption, makeFxSwap } from "../instruments/builders.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { shiftFxSurfaceRow } from "../models/fx-vol-surface.js";
import { priceTrade } from "../pricing/price.js";
import { computeRisk, vegaBuckets } from "./sensitivities.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);

describe("R3-1 – FX vega buckets", () => {
  const option = makeFxOption({ id: "FXO-VEGA", pair: "EURUSD", optionType: "Call", notional: 5e6, strike: 1.18, expiryDate: addDays(VAL, 548) });

  it("one report per FX surface of the pair, kind fx, ATM row buckets summing to the parallel vega", () => {
    const reports = vegaBuckets(ctx, option, "EUR");
    expect(reports).toHaveLength(1);
    const r = reports[0]!;
    expect(r.kind).toBe("fx");
    expect(r.key).toBe("EURUSD");
    expect(r.surfaceId).toBe("EURUSD-VOL");
    expect(r.dimension).toBe("expiry");
    expect(r.buckets.map((b) => b.expiry)).toEqual(ctx.fxVols!.EURUSD!.expiries);
    expect(r.buckets.every((b) => b.component === "atm")).toBe(true);
    expect(r.buckets.map((b) => b.label)).toEqual(["1W", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y"]);
    // A 1.5Y option loads the 1Y and 2Y rows only.
    const loaded = r.buckets.filter((b) => Math.abs(b.vega) > 1e-6).map((b) => b.label);
    expect(loaded).toEqual(["1Y", "2Y"]);
    const parallel = computeRisk(ctx, option, "EUR", { bucketed: false, theta: false }).vega["fx:EURUSD"]!;
    expect(parallel).toBeGreaterThan(0);
    expect(r.total).toBeCloseTo(
      r.buckets.reduce((s, b) => s + b.vega, 0),
      10,
    );
    // Variance interpolation between the expiries makes the row bumps slightly non-additive.
    expect(Math.abs(r.total - parallel) / parallel).toBeLessThan(0.05);
  });

  it("an option expiring on a grid expiry has a single bucket equal to the parallel vega", () => {
    const onGrid = makeFxOption({ id: "FXO-1Y", pair: "EURUSD", optionType: "Put", notional: 5e6, strike: 1.15, expiryDate: addDays(VAL, 365) });
    const r = vegaBuckets(ctx, onGrid, "USD")[0]!;
    const parallel = computeRisk(ctx, onGrid, "USD", { bucketed: false, theta: false }).vega["fx:EURUSD"]!;
    const oneY = r.buckets.find((b) => b.label === "1Y")!;
    expect(oneY.vega).toBeCloseTo(parallel, 6);
    expect(r.buckets.filter((b) => b.label !== "1Y").every((b) => Math.abs(b.vega) < 1e-6)).toBe(true);
    expect(r.total).toBeCloseTo(parallel, 6);
  });

  it("smile buckets: RR25 / BF25 per row, labelled and excluded from the total", () => {
    // K 1.30 lies above the 1.5Y forward (≈ 1.20): a ~20Δ call on the call wing of the smile.
    const otmCall = { ...option, id: "FXO-OTM", strike: 1.3 };
    const plain = vegaBuckets(ctx, otmCall, "EUR")[0]!;
    const r = vegaBuckets(ctx, otmCall, "EUR", { smile: true })[0]!;
    const n = ctx.fxVols!.EURUSD!.expiries.length;
    expect(r.buckets).toHaveLength(3 * n);
    expect(r.buckets.filter((b) => b.component === "rr25")).toHaveLength(n);
    expect(r.buckets.filter((b) => b.component === "bf25")).toHaveLength(n);
    expect(r.buckets.some((b) => b.label === "1Y RR25")).toBe(true);
    expect(r.buckets.some((b) => b.label === "2Y BF25")).toBe(true);
    expect(r.total).toBeCloseTo(plain.total, 10);
    // Call wing: a steeper risk reversal and a fatter butterfly both raise its vol and PV.
    const rr1y = r.buckets.find((b) => b.label === "1Y RR25")!;
    const bf1y = r.buckets.find((b) => b.label === "1Y BF25")!;
    expect(rr1y.vega).toBeGreaterThan(0);
    expect(bf1y.vega).toBeGreaterThan(0);
    // The in-the-money-forward call (K 1.18 < F) sits on the put wing: RR up lowers its vol.
    const itm = vegaBuckets(ctx, option, "EUR", { smile: true })[0]!;
    expect(itm.buckets.find((b) => b.label === "1Y RR25")!.vega).toBeLessThan(0);
    expect(itm.buckets.find((b) => b.label === "1Y BF25")!.vega).toBeGreaterThan(0);
    // Smile buckets are not part of the ATM total.
    expect(r.total).toBeCloseTo(
      r.buckets.filter((b) => b.component === "atm").reduce((s, b) => s + b.vega, 0),
      10,
    );
  });

  it("shiftFxSurfaceRow bumps only the requested row / quote; a volOverride option has no FX buckets", () => {
    const s = ctx.fxVols!.EURUSD!;
    const atm = shiftFxSurfaceRow(s, 2, 0.01);
    expect(atm.atm[2]).toBeCloseTo(s.atm[2]! + 0.01, 12);
    expect(atm.atm.filter((_, i) => i !== 2)).toEqual(s.atm.filter((_, i) => i !== 2));
    expect(atm.rr25).toEqual(s.rr25);
    const rr = shiftFxSurfaceRow(s, 4, 0.005, "rr25");
    expect(rr.rr25[4]).toBeCloseTo(s.rr25[4]! + 0.005, 12);
    expect(rr.atm).toEqual(s.atm);
    const bf = shiftFxSurfaceRow(s, 0, -0.001, "bf25");
    expect(bf.bf25[0]).toBeCloseTo(s.bf25[0]! - 0.001, 12);
    expect(vegaBuckets(ctx, { ...option, volOverride: 0.08 }, "EUR")).toEqual([]);
    // linear FX trades have no optionality
    expect(vegaBuckets(ctx, makeFxForward({ id: "F", pair: "EURUSD", baseAmount: 1e6, rate: 1.17, deliveryDate: addDays(VAL, 90) }), "EUR")).toEqual([]);
  });
});

describe("R3-3 – linear FX deltaAmount of forwards and FX swaps", () => {
  const fwd = makeFxForward({ id: "FXF-D", pair: "EURUSD", baseAmount: 2e6, rate: 1.17, deliveryDate: addDays(VAL, 180) });

  it("FxForward: deltaAmount equals the bump-and-reprice FX delta (USD reporting: EUR appreciates 1 %)", () => {
    const res = priceTrade(ctx, fwd, "USD");
    const risk = computeRisk(ctx, fwd, "USD", { bucketed: false, theta: false, vega: false });
    expect(typeof res.analytics.deltaAmount).toBe("number");
    expect(res.analytics.deltaAmount as number).toBeCloseTo(risk.fxDelta.EURUSD!, 6);
    // ≈ 1 % of the discounted EUR leg in USD
    expect(res.analytics.deltaAmount as number).toBeCloseTo(res.legs[0]!.pvReporting * 0.01, 9);
    expect(res.analytics.deltaAmount as number).toBeGreaterThan(0);
    // no deltaPct for linear trades
    expect(res.analytics.deltaPct).toBeUndefined();
  });

  it("FxForward with the buy currency as reporting currency: −1 % of the sold leg (first order of 1/1.01)", () => {
    const res = priceTrade(ctx, fwd, "EUR");
    const risk = computeRisk(ctx, fwd, "EUR", { bucketed: false, theta: false, vega: false });
    const d = res.analytics.deltaAmount as number;
    expect(d).toBeCloseTo(-res.legs[1]!.pvReporting * 0.01, 9);
    // EUR up 1 % ≈ USD down 1 %: opposite sign of the USD-appreciation delta, equal to ~1e-4 relative
    expect(Math.abs(d + risk.fxDelta.USDEUR!) / Math.abs(d)).toBeLessThan(2e-4);
  });

  it("FxSwap: deltaAmount is the sum over both legs for +1 % of the near-leg buy currency", () => {
    const swap = makeFxSwap({
      id: "FXS-D",
      pair: "EURUSD",
      baseAmount: 3e6,
      nearRate: 1.17,
      farRate: 1.175,
      nearDate: addDays(VAL, 4),
      farDate: addDays(VAL, 184),
    });
    const res = priceTrade(ctx, swap, "USD");
    const risk = computeRisk(ctx, swap, "USD", { bucketed: false, theta: false, vega: false });
    expect(res.analytics.deltaAmount as number).toBeCloseTo(risk.fxDelta.EURUSD!, 6);
    // near buys EUR, far sells EUR – the exposure nets to the forward-point / discounting difference
    const eurLegs = res.legs.filter((l) => l.currency === "EUR");
    expect(res.analytics.deltaAmount as number).toBeCloseTo(eurLegs.reduce((s, l) => s + l.pvReporting, 0) * 0.01, 9);
    expect(Math.abs(res.analytics.deltaAmount as number)).toBeLessThan(Math.abs(eurLegs[0]!.pvReporting) * 0.01);
  });
});
