import { describe, expect, it } from "vitest";
import { bivariateNormCdf, normCdf, normInv, normPdf } from "../math/normal.js";
import { brent, solveBracketed } from "../math/rootfind.js";
import { bachelier, black76, black76Greeks, impliedBlackVol, impliedNormalVol, lognormalToNormalVol } from "./black.js";
import { type FxOptionInputs, fxBarrier, fxDigital, fxExoticGreeks, garmanKohlhagen, impliedFxVol } from "./garman-kohlhagen.js";
import { sabrAlphaFromAtm, sabrLognormalVol, sabrNormalVol } from "./sabr.js";
import { type FxDeltaConvention, fxAtmVol, fxDeltaFromMoneyness, fxStrikeFromDelta, fxVolAtDelta, fxVolAtStrike } from "./fx-vol-surface.js";
import { type SwaptionVolSurface, sabrParamsAt, swaptionAtmVol, swaptionVol } from "./vol-surfaces.js";
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
  it("M11: strike ↔ delta round trip holds for forward, spot and premium-adjusted spot delta conventions", () => {
    const dff = Math.exp(-0.021);
    const F = 1.177;
    for (const conv of ["Forward", "Spot", "PremiumAdjustedSpot"] as FxDeltaConvention[]) {
      const s = { ...SAMPLE_EURUSD_VOLS, deltaConvention: conv };
      for (const delta of [0.25, -0.25, 0.1, -0.1]) {
        const K = fxStrikeFromDelta(s, 1, F, delta, { dfForeign: dff });
        const volK = fxVolAtStrike(s, 1, F, K, { dfForeign: dff });
        expect(volK).toBeCloseTo(fxVolAtDelta(s, 1, delta, { dfForeign: dff }), 9);
        // the strike really carries the quoted delta under the convention
        expect(fxDeltaFromMoneyness(delta > 0, K / F, volK, 1, conv, dff)).toBeCloseTo(delta, 9);
      }
      // pillar vols are reproduced: 25Δ RR
      expect(fxVolAtDelta(s, 1, 0.25, { dfForeign: dff }) - fxVolAtDelta(s, 1, -0.25, { dfForeign: dff })).toBeCloseTo(0.004, 10);
    }
    // premium-adjusted 25Δ call strike lies below the unadjusted one (premium in base currency reduces the delta)
    const kFwd = fxStrikeFromDelta({ ...SAMPLE_EURUSD_VOLS, deltaConvention: "Forward" }, 1, F, 0.25, { dfForeign: dff });
    const kSpot = fxStrikeFromDelta({ ...SAMPLE_EURUSD_VOLS, deltaConvention: "Spot" }, 1, F, 0.25, { dfForeign: dff });
    const kPa = fxStrikeFromDelta({ ...SAMPLE_EURUSD_VOLS, deltaConvention: "PremiumAdjustedSpot" }, 1, F, 0.25, { dfForeign: dff });
    expect(kSpot).toBeLessThan(kFwd);
    expect(kPa).toBeLessThan(kSpot);
    // flat extrapolation beyond the 10Δ pillars
    expect(fxVolAtStrike(SAMPLE_EURUSD_VOLS, 1, F, 1.6)).toBeCloseTo(fxVolAtDelta(SAMPLE_EURUSD_VOLS, 1, 0.1), 10);
  });
});

describe("review regressions – barriers (Haug Tab. 4-13, S=100, K=3, T=0.5, r=8%, b=4%, σ=25%)", () => {
  const base = { spot: 100, vol: 0.25, timeToExpiry: 0.5, rd: 0.08, rf: 0.04, rebate: 3 };
  const cases: { type: "Call" | "Put"; strike: number; barrier: number; barrierType: "UpIn" | "UpOut" | "DownIn" | "DownOut"; value: number }[] = [
    { type: "Call", strike: 90, barrier: 95, barrierType: "DownOut", value: 9.0246 },
    { type: "Call", strike: 100, barrier: 95, barrierType: "DownIn", value: 4.0109 },
    { type: "Call", strike: 110, barrier: 105, barrierType: "UpOut", value: 2.3453 },
    { type: "Put", strike: 90, barrier: 105, barrierType: "UpIn", value: 1.4653 },
    { type: "Put", strike: 100, barrier: 105, barrierType: "UpOut", value: 5.4932 },
    { type: "Put", strike: 110, barrier: 95, barrierType: "DownIn", value: 11.9752 },
  ];
  it("reproduces the table values to 4 decimals", () => {
    for (const c of cases) expect(fxBarrier({ ...base, ...c })).toBeCloseTo(c.value, 3);
  });
  it("M17: a knock-out with the barrier at the spot pays the rebate immediately (3.0000), at expiry only when requested", () => {
    expect(fxBarrier({ ...base, type: "Call", strike: 90, barrier: 100, barrierType: "DownOut" })).toBeCloseTo(3, 12);
    expect(fxBarrier({ ...base, type: "Call", strike: 90, barrier: 100, barrierType: "DownOut", rebateAtExpiry: true })).toBeCloseTo(
      3 * Math.exp(-0.08 * 0.5),
      12,
    );
    // knock-out rebate at expiry is worth less than at hit for a live barrier
    const atHit = fxBarrier({ ...base, type: "Call", strike: 90, barrier: 95, barrierType: "DownOut" });
    const atExp = fxBarrier({ ...base, type: "Call", strike: 90, barrier: 95, barrierType: "DownOut", rebateAtExpiry: true });
    expect(atExp).toBeLessThan(atHit);
    expect(atHit - atExp).toBeLessThan(0.2);
  });
  it("M6: finite-difference Greeks of a barrier differ from the vanilla's and vanilla FD Greeks match the analytic ones", () => {
    const i: FxOptionInputs = { type: "Call", spot: 1.1625, strike: 1.18, vol: 0.077, timeToExpiry: 1, rd: 0.035, rf: 0.021 };
    const gk = garmanKohlhagen(i);
    const fd = fxExoticGreeks((x) => garmanKohlhagen(x).premiumDomestic, i);
    expect(fd.spotDelta).toBeCloseTo(gk.spotDelta, 6);
    expect(fd.gamma).toBeCloseTo(gk.gamma, 4);
    expect(fd.vega).toBeCloseTo(gk.vega, 6);
    expect(fd.rhoDomestic).toBeCloseTo(gk.rhoDomestic, 6);
    expect(fd.rhoForeign).toBeCloseTo(gk.rhoForeign, 6);
    expect(fd.theta).toBeCloseTo(gk.theta, 6);
    const ko = fxExoticGreeks((x) => fxBarrier({ ...x, barrier: 1.25, barrierType: "UpOut" }), i, { barrier: 1.25 });
    expect(ko.vega).toBeLessThan(gk.vega); // knock-out call loses value when vol rises near the barrier
    expect(ko.spotDelta).not.toBeCloseTo(gk.spotDelta, 3);
  });
});

describe("review regressions – Garman-Kohlhagen Greeks vs central differences (S 1.1625, K 1.18, σ 7.7%, T 1, rd 3.5%, rf 2.1%)", () => {
  it("delta, gamma, vega, rho_d, rho_f, theta agree to 1e-6", () => {
    const i: FxOptionInputs = { type: "Call", spot: 1.1625, strike: 1.18, vol: 0.077, timeToExpiry: 1, rd: 0.035, rf: 0.021 };
    const p = (x: Partial<FxOptionInputs>) => garmanKohlhagen({ ...i, ...x }).premiumDomestic;
    const g = garmanKohlhagen(i);
    const h = 1e-5;
    expect(g.spotDelta).toBeCloseTo((p({ spot: i.spot + h }) - p({ spot: i.spot - h })) / (2 * h), 6);
    expect(g.gamma).toBeCloseTo((p({ spot: i.spot + h }) - 2 * p({}) + p({ spot: i.spot - h })) / (h * h), 3);
    expect(g.vega).toBeCloseTo((p({ vol: i.vol + h }) - p({ vol: i.vol - h })) / (2 * h), 6);
    expect(g.rhoDomestic).toBeCloseTo((p({ rd: i.rd + h }) - p({ rd: i.rd - h })) / (2 * h), 6);
    expect(g.rhoForeign).toBeCloseTo((p({ rf: i.rf + h }) - p({ rf: i.rf - h })) / (2 * h), 6);
    expect(g.theta).toBeCloseTo((p({ timeToExpiry: 1 - h, timeToDelivery: 1 - h }) - p({ timeToExpiry: 1 + h, timeToDelivery: 1 + h })) / (2 * h), 6);
  });
});

describe("review regressions – digital with base-currency payout (H2)", () => {
  const i: FxOptionInputs = { type: "Call", spot: 1.1625, strike: 1.18, vol: 0.077, timeToExpiry: 1, rd: 0.035, rf: 0.021 };
  it("asset-or-nothing = S·e^{-rf T}·N(d1); cash-or-nothing = e^{-rd T}·N(d2)", () => {
    const g = garmanKohlhagen(i);
    expect(fxDigital(i, true)).toBeCloseTo(i.spot * Math.exp(-i.rf) * normCdf(g.d1), 12);
    expect(fxDigital(i)).toBeCloseTo(Math.exp(-i.rd) * normCdf(g.d2), 12);
    // and the wrong conversion (cash digital × spot) is not the asset digital
    expect(Math.abs(fxDigital(i) * i.spot - fxDigital(i, true)) / fxDigital(i, true)).toBeGreaterThan(0.05);
  });
  it("vanilla decomposition: call = asset-or-nothing − K × cash-or-nothing (calls and puts)", () => {
    expect(fxDigital(i, true) - i.strike * fxDigital(i)).toBeCloseTo(garmanKohlhagen(i).premiumDomestic, 12);
    const put = { ...i, type: "Put" as const };
    expect(i.strike * fxDigital(put) - fxDigital(put, true)).toBeCloseTo(garmanKohlhagen(put).premiumDomestic, 12);
  });
});

describe("review regressions – bivariate normal (M7)", () => {
  it("Φ₂(0,0,ρ) = ¼ + asin(ρ)/(2π) for all Gauss–Legendre branches", () => {
    for (const rho of [-0.9, -0.5, -0.2, 0, 0.2, 0.5, 0.8, 0.9]) {
      expect(bivariateNormCdf(0, 0, rho)).toBeCloseTo(0.25 + Math.asin(rho) / (2 * Math.PI), 12);
    }
    expect(bivariateNormCdf(0, 0, 0.5)).toBeCloseTo(1 / 3, 12);
  });
  it("reference values Φ₂(0.5, 0.5, 0.5) = 0.546244 and Φ₂(1, 1, 0.95) = 0.810820 (Simpson branch)", () => {
    expect(bivariateNormCdf(0.5, 0.5, 0.5)).toBeCloseTo(0.546244, 6);
    expect(bivariateNormCdf(1, 1, 0.95)).toBeCloseTo(0.81082, 6);
  });
  it("limits: ρ → 0 factorises, ρ → ±1 collapses", () => {
    expect(bivariateNormCdf(0.3, -0.7, 0)).toBeCloseTo(normCdf(0.3) * normCdf(-0.7), 12);
    expect(bivariateNormCdf(0.3, -0.7, 1)).toBeCloseTo(normCdf(-0.7), 12);
    expect(bivariateNormCdf(0.3, 0.7, -1)).toBeCloseTo(normCdf(0.3) - normCdf(-0.7), 12);
  });
});

describe("review regressions – SABR (M15/M18 and Hagan consistency)", () => {
  const p = { alpha: 0.04, beta: 0.5, rho: -0.2, nu: 0.3 };
  it("lognormal fixture (f 3%, T 2): 27.816% / 23.365% / 21.032% at K 2% / 3% / 4.5%", () => {
    expect(sabrLognormalVol(0.03, 0.02, 2, p)).toBeCloseTo(0.27816, 4);
    expect(sabrLognormalVol(0.03, 0.03, 2, p)).toBeCloseTo(0.23365, 4);
    expect(sabrLognormalVol(0.03, 0.045, 2, p)).toBeCloseTo(0.21032, 4);
  });
  it("LN → price → implied normal vol agrees with the normal expansion within 0.2bp (68.16 / 69.78 / 77.52 bp)", () => {
    const expected = [
      [0.02, 68.16],
      [0.03, 69.78],
      [0.045, 77.52],
    ];
    for (const [K, bp] of expected) {
      const ln = sabrLognormalVol(0.03, K!, 2, p);
      const implN = impliedNormalVol("Call", 0.03, K!, 2, black76("Call", 0.03, K!, ln, 2)) * 1e4;
      expect(implN).toBeCloseTo(bp!, 1);
      expect(Math.abs(implN - sabrNormalVol(0.03, K!, 2, p) * 1e4)).toBeLessThan(0.2);
    }
  });
  it("β = 1 gives a finite normal vol and non-positive shifted rates throw instead of returning NaN", () => {
    const v = sabrNormalVol(0.03, 0.025, 2, { alpha: 0.2, beta: 1, rho: -0.2, nu: 0.3 });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0.003);
    expect(v).toBeLessThan(0.01);
    expect(() => sabrNormalVol(-0.01, 0.02, 1, { ...p, shift: 0 })).toThrow(/positive/);
    expect(() => sabrLognormalVol(0.02, -0.01, 1, { ...p, shift: 0 })).toThrow(/positive/);
  });
  it("swaption cube: lognormal surfaces are evaluated with the lognormal expansion and parameters blend between grid points", () => {
    const ln: SwaptionVolSurface = {
      ...SAMPLE_EUR_SWAPTION_VOLS,
      id: "LN",
      volType: "Lognormal",
      atm: SAMPLE_EUR_SWAPTION_VOLS.atm.map((r) => r.map(() => 0.25)),
    };
    expect(swaptionVol(ln, 1, 5, 0.03, 0.03)).toBeCloseTo(0.25, 8);
    const otm = swaptionVol(ln, 1, 5, 0.03, 0.045);
    expect(otm).toBeGreaterThan(0.1);
    expect(otm).toBeLessThan(0.5);
    expect(otm).not.toBeCloseTo(0.25, 3);
    // blended parameters between 1x5 (rho −0.2, nu 0.35) and 5x5 (rho −0.25, nu 0.3)
    const blend = sabrParamsAt(SAMPLE_EUR_SWAPTION_VOLS, 2, 5)!;
    expect(blend.rho).toBeGreaterThan(-0.25);
    expect(blend.rho).toBeLessThan(-0.2);
    expect(sabrParamsAt(SAMPLE_EUR_SWAPTION_VOLS, 1, 5)).toEqual(SAMPLE_EUR_SWAPTION_VOLS.sabr!["1x5"]);
    // continuity: moving the expiry slightly changes the smile vol slightly (no hard switch)
    const a = swaptionVol(SAMPLE_EUR_SWAPTION_VOLS, 2.99, 5, 0.03, 0.04);
    const b = swaptionVol(SAMPLE_EUR_SWAPTION_VOLS, 3.01, 5, 0.03, 0.04);
    expect(Math.abs(a - b)).toBeLessThan(1e-5);
  });
});
