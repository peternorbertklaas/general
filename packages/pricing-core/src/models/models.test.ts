import { describe, expect, it } from "vitest";
import { normCdf, normInv, normPdf } from "../math/normal.js";
import { brent, solveBracketed } from "../math/rootfind.js";
import { bachelier, black76, black76Greeks, impliedBlackVol, impliedNormalVol, lognormalToNormalVol } from "./black.js";
import { fxBarrier, fxDigital, garmanKohlhagen, impliedFxVol } from "./garman-kohlhagen.js";
import { sabrAlphaFromAtm, sabrLognormalVol, sabrNormalVol } from "./sabr.js";
import { fxAtmVol, fxVolAtDelta, fxVolAtStrike } from "./fx-vol-surface.js";
import { swaptionAtmVol, swaptionVol } from "./vol-surfaces.js";
import { SAMPLE_EURUSD_VOLS, SAMPLE_EUR_SWAPTION_VOLS } from "../market/sample-market.js";

describe("normal distribution", () => {
  it("cdf reference values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 15);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021048517795, 12);
    expect(normCdf(-1)).toBeCloseTo(0.15865525393145707, 12);
    expect(normCdf(8)).toBeCloseTo(1, 12);
    expect(normCdf(-40)).toBe(0);
  });
  it("inverse is consistent", () => {
    for (const p of [0.001, 0.025, 0.2, 0.5, 0.7, 0.975, 0.9999]) {
      expect(normCdf(normInv(p))).toBeCloseTo(p, 12);
    }
    expect(normInv(0.975)).toBeCloseTo(1.959963984540054, 10);
  });
  it("pdf", () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804014327, 15);
  });
});

describe("root finding", () => {
  it("brent finds sqrt(2)", () => {
    expect(brent((x) => x * x - 2, 0, 2)).toBeCloseTo(Math.SQRT2, 12);
  });
  it("bracketing expands", () => {
    expect(solveBracketed((x) => Math.exp(x) - 10, 0, 0.5)).toBeCloseTo(Math.log(10), 10);
  });
});

describe("Black-76 / Bachelier", () => {
  it("Hull caplet example: F=7%, K=8%, σ=20%, T=1 → forward premium 0.0025 (approx)", () => {
    // Hull (Options, Futures & Other Derivatives), caplet on 3M LIBOR: forward 7%, cap rate 8%, vol 20%, 1Y.
    const p = black76("Call", 0.07, 0.08, 0.2, 1);
    expect(p).toBeCloseTo(0.0022, 3); // Hull: caplet value ≈ 0.0022 × τ × N before discounting details
  });
  it("put-call parity", () => {
    const c = black76("Call", 0.03, 0.025, 0.25, 2);
    const p = black76("Put", 0.03, 0.025, 0.25, 2);
    expect(c - p).toBeCloseTo(0.03 - 0.025, 14);
    const cb = bachelier("Call", 0.03, 0.025, 0.007, 2);
    const pb = bachelier("Put", 0.03, 0.025, 0.007, 2);
    expect(cb - pb).toBeCloseTo(0.005, 14);
  });
  it("Bachelier ATM closed form σ√T/√(2π)", () => {
    const v = bachelier("Call", 0.02, 0.02, 0.0065, 4);
    expect(v).toBeCloseTo((0.0065 * 2) / Math.sqrt(2 * Math.PI), 14);
  });
  it("Bachelier handles negative rates", () => {
    const v = bachelier("Call", -0.005, -0.003, 0.005, 1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.005);
  });
  it("implied vols invert", () => {
    const p = black76("Call", 0.03, 0.028, 0.32, 1.5);
    expect(impliedBlackVol("Call", 0.03, 0.028, 1.5, p)).toBeCloseTo(0.32, 9);
    const pn = bachelier("Put", 0.02, 0.025, 0.0071, 3);
    expect(impliedNormalVol("Put", 0.02, 0.025, 3, pn)).toBeCloseTo(0.0071, 10);
  });
  it("lognormal → normal vol ≈ σ_LN × F at the money", () => {
    const nv = lognormalToNormalVol(0.03, 0.03, 1, 0.25);
    expect(nv).toBeCloseTo(0.25 * 0.03, 3);
  });
  it("greeks: delta between 0 and 1, vega positive", () => {
    const g = black76Greeks("Call", 100, 100, 0.2, 1, 0.95);
    expect(g.delta).toBeGreaterThan(0.5 * 0.95 - 0.05);
    expect(g.delta).toBeLessThan(0.95);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });
});

describe("Garman-Kohlhagen", () => {
  it("Haug reference: S=1.56, K=1.60, T=0.5, rd=6%, rf=8%, σ=12% → call 0.0291", () => {
    const r = garmanKohlhagen({ type: "Call", spot: 1.56, strike: 1.6, vol: 0.12, timeToExpiry: 0.5, rd: 0.06, rf: 0.08 });
    expect(r.premiumDomestic).toBeCloseTo(0.0291, 4);
  });
  it("put-call parity in domestic terms", () => {
    const i = { spot: 1.1625, strike: 1.15, vol: 0.075, timeToExpiry: 1, rd: 0.033, rf: 0.021 };
    const c = garmanKohlhagen({ ...i, type: "Call" });
    const p = garmanKohlhagen({ ...i, type: "Put" });
    const dfd = Math.exp(-i.rd);
    expect(c.premiumDomestic - p.premiumDomestic).toBeCloseTo(dfd * (c.forward - i.strike), 12);
    expect(c.spotDelta - p.spotDelta).toBeCloseTo(Math.exp(-i.rf), 12);
  });
  it("implied vol inverts", () => {
    const i = { type: "Put" as const, spot: 1.1625, strike: 1.2, timeToExpiry: 0.75, rd: 0.033, rf: 0.021 };
    const p = garmanKohlhagen({ ...i, vol: 0.083 }).premiumDomestic;
    expect(impliedFxVol(i, p)).toBeCloseTo(0.083, 9);
  });
  it("digital ≈ dfd × N(d2)", () => {
    const d = fxDigital({ type: "Call", spot: 1.16, strike: 1.16, vol: 0.08, timeToExpiry: 1, rd: 0.03, rf: 0.02 });
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(0.55);
  });
  it("barrier in + out = vanilla", () => {
    const i = { type: "Call" as const, spot: 1.16, strike: 1.17, vol: 0.08, timeToExpiry: 1, rd: 0.03, rf: 0.02 };
    const vanilla = garmanKohlhagen(i).premiumDomestic;
    const upIn = fxBarrier({ ...i, barrier: 1.25, barrierType: "UpIn" });
    const upOut = fxBarrier({ ...i, barrier: 1.25, barrierType: "UpOut" });
    expect(upIn + upOut).toBeCloseTo(vanilla, 10);
    const dIn = fxBarrier({ ...i, barrier: 1.1, barrierType: "DownIn" });
    const dOut = fxBarrier({ ...i, barrier: 1.1, barrierType: "DownOut" });
    expect(dIn + dOut).toBeCloseTo(vanilla, 10);
    const pIn = fxBarrier({ ...i, type: "Put", barrier: 1.1, barrierType: "DownIn" });
    const pOut = fxBarrier({ ...i, type: "Put", barrier: 1.1, barrierType: "DownOut" });
    expect(pIn + pOut).toBeCloseTo(garmanKohlhagen({ ...i, type: "Put" }).premiumDomestic, 10);
  });
});

describe("SABR", () => {
  it("ATM lognormal vol ≈ alpha / F^(1-beta)", () => {
    const v = sabrLognormalVol(0.03, 0.03, 0.0001, { alpha: 0.04, beta: 0.5, rho: -0.2, nu: 0.3 });
    expect(v).toBeCloseTo(0.04 / Math.pow(0.03, 0.5), 3);
  });
  it("normal vol smile is convex-ish and positive", () => {
    const p = { alpha: 0.02, beta: 0.5, rho: -0.2, nu: 0.35, shift: 0.03 };
    const f = 0.025;
    const lo = sabrNormalVol(f, 0.005, 2, p);
    const atm = sabrNormalVol(f, f, 2, p);
    const hi = sabrNormalVol(f, 0.05, 2, p);
    expect(atm).toBeGreaterThan(0);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(atm);
  });
});

describe("swaption vol cube with SABR smile", () => {
  it("returns a sensible smile vol at a grid point carrying SABR parameters (1Yx5Y)", () => {
    const atm = swaptionAtmVol(SAMPLE_EUR_SWAPTION_VOLS, 1, 5);
    const vAtm = swaptionVol(SAMPLE_EUR_SWAPTION_VOLS, 1, 5, 0.0277, 0.0277);
    const vOtm = swaptionVol(SAMPLE_EUR_SWAPTION_VOLS, 1, 5, 0.0277, 0.04);
    const vItm = swaptionVol(SAMPLE_EUR_SWAPTION_VOLS, 1, 5, 0.0277, 0.01);
    expect(vAtm).toBeCloseTo(atm, 6);
    for (const v of [vOtm, vItm]) {
      expect(v).toBeGreaterThan(0.004);
      expect(v).toBeLessThan(0.02);
    }
    expect(vItm).toBeGreaterThan(vAtm); // negative rho → higher vol for low strikes
  });
  it("alpha calibration reproduces the ATM vol", () => {
    const p = { beta: 0.5, rho: -0.2, nu: 0.35, shift: 0.03 };
    const alpha = sabrAlphaFromAtm(0.0277, 1, 0.008, p, "normal");
    expect(sabrNormalVol(0.0277, 0.0277, 1, { ...p, alpha })).toBeCloseTo(0.008, 9);
  });
});

describe("FX vol surface", () => {
  it("reconstructs 25Δ RR from smile", () => {
    const t = 1;
    const c25 = fxVolAtDelta(SAMPLE_EURUSD_VOLS, t, 0.25);
    const p25 = fxVolAtDelta(SAMPLE_EURUSD_VOLS, t, -0.25);
    expect(c25 - p25).toBeCloseTo(0.004, 10);
    expect(fxAtmVol(SAMPLE_EURUSD_VOLS, 1)).toBeCloseTo(0.077, 10);
  });
  it("strike-based vol converges", () => {
    const v = fxVolAtStrike(SAMPLE_EURUSD_VOLS, 1, 1.17, 1.25);
    expect(v).toBeGreaterThan(0.077);
    const vAtm = fxVolAtStrike(SAMPLE_EURUSD_VOLS, 1, 1.17, 1.17);
    expect(vAtm).toBeCloseTo(0.077, 3);
  });
});
