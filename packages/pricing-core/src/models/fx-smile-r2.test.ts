import { describe, expect, it } from "vitest";
import { SAMPLE_EURUSD_VOLS } from "../market/sample-market.js";
import { monotoneCubicInterp } from "../math/interpolation.js";
import { black76 } from "./black.js";
import {
  type FxDeltaConvention,
  type FxVolSurface,
  brokerStrangleFromSmile,
  fxDeltaFromMoneyness,
  fxMoneynessFromDelta,
  fxStrikeFromDelta,
  fxVolAtDelta,
  fxVolAtStrike,
  smileStrangleFromBroker,
} from "./fx-vol-surface.js";

const F = 1.177;
const dff = Math.exp(-0.021);

describe("M11 – premium-adjusted forward delta", () => {
  it("strike ↔ delta round trip under all four conventions; PA-forward strikes lie between PA-spot and unadjusted forward", () => {
    for (const conv of ["Forward", "Spot", "PremiumAdjustedSpot", "PremiumAdjustedForward"] as FxDeltaConvention[]) {
      const s: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, deltaConvention: conv };
      for (const delta of [0.25, -0.25, 0.1, -0.1]) {
        const K = fxStrikeFromDelta(s, 1, F, delta, { dfForeign: dff });
        const volK = fxVolAtStrike(s, 1, F, K, { dfForeign: dff });
        expect(volK).toBeCloseTo(fxVolAtDelta(s, 1, delta, { dfForeign: dff }), 9);
        expect(fxDeltaFromMoneyness(delta > 0, K / F, volK, 1, conv, dff)).toBeCloseTo(delta, 9);
      }
      expect(fxVolAtDelta(s, 1, 0.25, { dfForeign: dff }) - fxVolAtDelta(s, 1, -0.25, { dfForeign: dff })).toBeCloseTo(0.004, 10);
    }
    const kFwd = fxMoneynessFromDelta(0.25, 0.08, 1, "Forward");
    const kPaFwd = fxMoneynessFromDelta(0.25, 0.08, 1, "PremiumAdjustedForward");
    const kPaSpot = fxMoneynessFromDelta(0.25, 0.08, 1, "PremiumAdjustedSpot", dff);
    expect(kPaFwd).toBeLessThan(kFwd);
    // PA forward delta = PA spot delta / dfForeign → same strike for delta·dff, i.e. PA-spot 25Δ sits at a lower strike than PA-forward 25Δ
    expect(kPaSpot).toBeLessThan(kPaFwd);
    expect(fxDeltaFromMoneyness(true, kPaFwd, 0.08, 1, "PremiumAdjustedForward")).toBeCloseTo(0.25, 10);
    expect(fxDeltaFromMoneyness(true, kPaFwd, 0.08, 1, "PremiumAdjustedSpot", dff)).toBeCloseTo(0.25 * dff, 10);
  });
});

describe("M11 – smile interpolation", () => {
  const linear: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, smileInterpolation: "linear" };
  const cubic: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, smileInterpolation: "cubic" };
  it("monotone cubic reproduces the pillars, stays within neighbouring pillar vols and is smoother than linear", () => {
    for (const delta of [-0.1, -0.25, 0.5, 0.25, 0.1]) {
      expect(fxVolAtDelta(cubic, 1, delta)).toBeCloseTo(fxVolAtDelta(linear, 1, delta), 10);
    }
    // between the 25Δ put and the ATM pillar the cubic differs from linear but stays between the pillar vols
    const kP25 = fxStrikeFromDelta(linear, 1, F, -0.25);
    const kAtm = fxStrikeFromDelta(linear, 1, F, 0.5);
    const kMid = 0.5 * (kP25 + kAtm);
    const vLin = fxVolAtStrike(linear, 1, F, kMid);
    const vCub = fxVolAtStrike(cubic, 1, F, kMid);
    expect(Math.abs(vCub - vLin)).toBeGreaterThan(1e-6);
    const lo = Math.min(fxVolAtDelta(linear, 1, -0.25), fxVolAtDelta(linear, 1, 0.5));
    const hi = Math.max(fxVolAtDelta(linear, 1, -0.25), fxVolAtDelta(linear, 1, 0.5));
    expect(vCub).toBeGreaterThanOrEqual(lo - 1e-12);
    expect(vCub).toBeLessThanOrEqual(hi + 1e-12);
    // smoothness: the slope of the linear smile jumps at the ATM pillar, the cubic slope is continuous
    const h = 1e-4;
    const slope = (s: FxVolSurface, k: number) => (fxVolAtStrike(s, 1, F, k + h) - fxVolAtStrike(s, 1, F, k - h)) / (2 * h);
    const jumpLin = Math.abs(slope(linear, kAtm + 3 * h) - slope(linear, kAtm - 3 * h));
    const jumpCub = Math.abs(slope(cubic, kAtm + 3 * h) - slope(cubic, kAtm - 3 * h));
    expect(jumpCub).toBeLessThan(0.1 * jumpLin);
    // flat extrapolation beyond the 10Δ pillars in both modes
    expect(fxVolAtStrike(cubic, 1, F, 1.6)).toBeCloseTo(fxVolAtDelta(cubic, 1, 0.1), 10);
    expect(fxVolAtStrike(cubic, 1, F, 0.8)).toBeCloseTo(fxVolAtDelta(cubic, 1, -0.1), 10);
    // default (undefined) is linear – backward compatible
    expect(fxVolAtStrike(SAMPLE_EURUSD_VOLS, 1, F, kMid)).toBeCloseTo(vLin, 12);
  });
  it("monotoneCubicInterp: interpolates the knots, is monotone on monotone data and flat outside", () => {
    const xs = [0, 1, 2, 3];
    const ys = [0, 1, 1.5, 3];
    for (let i = 0; i < xs.length; i++) expect(monotoneCubicInterp(xs, ys, xs[i]!)).toBeCloseTo(ys[i]!, 12);
    let prev = -Infinity;
    for (let x = 0; x <= 3; x += 0.01) {
      const y = monotoneCubicInterp(xs, ys, x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
    expect(monotoneCubicInterp(xs, ys, -1)).toBe(0);
    expect(monotoneCubicInterp(xs, ys, 9)).toBe(3);
  });
});

describe("M11 – broker strangle (Reiswich–Wystup)", () => {
  const smile: FxVolSurface = { id: "S", pair: "EURUSD", expiries: [1], atm: [0.077], rr25: [0.004], bf25: [0.0025], rr10: [0.0075], bf10: [0.008] };
  it("the smile-consistent strangle margin of a broker surface reproduces the broker strangle value, and Smile → Broker → Smile round-trips", () => {
    const bfBroker = brokerStrangleFromSmile(smile, 1);
    expect(bfBroker).toBeGreaterThan(0);
    const broker: FxVolSurface = { ...smile, id: "B", strangleType: "Broker", bf25: [bfBroker] };
    // round trip: the smile strangle implied by the broker quote is the original smile BF
    expect(smileStrangleFromBroker(broker, 1)).toBeCloseTo(0.0025, 8);
    expect(smileStrangleFromBroker(smile, 1)).toBe(0.0025);
    // the two surfaces are the same smile
    for (const K of [1.02, 1.08, 1.15, 1.177, 1.2, 1.25, 1.32]) {
      expect(fxVolAtStrike(broker, 1, F, K)).toBeCloseTo(fxVolAtStrike(smile, 1, F, K), 8);
    }
    expect(brokerStrangleFromSmile(broker, 1)).toBeCloseTo(bfBroker, 8);
    // repricing identity: strikes at 25Δ under σ_S = ATM + BF_broker, valued at σ_S, equal the smile-valued strangle
    const sigmaS = 0.077 + bfBroker;
    const mc = fxMoneynessFromDelta(0.25, sigmaS, 1, "Forward");
    const mp = fxMoneynessFromDelta(-0.25, sigmaS, 1, "Forward");
    const oneVol = black76("Call", 1, mc, sigmaS, 1) + black76("Put", 1, mp, sigmaS, 1);
    const withSmile = black76("Call", 1, mc, fxVolAtStrike(broker, 1, 1, mc), 1) + black76("Put", 1, mp, fxVolAtStrike(broker, 1, 1, mp), 1);
    expect(withSmile).toBeCloseTo(oneVol, 10);
    // reading the same number as a smile strangle would give a different smile
    const naive: FxVolSurface = { ...smile, bf25: [bfBroker] };
    expect(Math.abs(fxVolAtStrike(naive, 1, F, 1.25) - fxVolAtStrike(broker, 1, F, 1.25))).toBeGreaterThan(1e-7);
  });
  it("works with spot / premium-adjusted conventions and cubic interpolation", () => {
    for (const conv of ["Spot", "PremiumAdjustedSpot", "PremiumAdjustedForward"] as FxDeltaConvention[]) {
      const s: FxVolSurface = { ...smile, deltaConvention: conv, smileInterpolation: "cubic" };
      const bfB = brokerStrangleFromSmile(s, 1, { dfForeign: dff });
      const b: FxVolSurface = { ...s, strangleType: "Broker", bf25: [bfB] };
      expect(smileStrangleFromBroker(b, 1, { dfForeign: dff })).toBeCloseTo(0.0025, 8);
      expect(fxVolAtStrike(b, 1, F, 1.22, { dfForeign: dff })).toBeCloseTo(fxVolAtStrike(s, 1, F, 1.22, { dfForeign: dff }), 8);
    }
  });
});
