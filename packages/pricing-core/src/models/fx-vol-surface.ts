import { linearInterp } from "../math/interpolation.js";
import { normInv } from "../math/normal.js";

/**
 * FX volatility surface in market quoting convention: per expiry ATM vol,
 * 25Δ / 10Δ risk reversals and butterflies (strangle margins). Smile
 * interpolation in delta space (parabolic in 5 points via linear-in-delta
 * with the classic RR/BF reconstruction), then converted to strike via
 * forward delta.
 */
export interface FxVolSurface {
  id: string;
  pair: string;
  /** Expiries in years. */
  expiries: number[];
  atm: number[];
  rr25: number[];
  bf25: number[];
  rr10?: number[];
  bf10?: number[];
  /** ATM convention: "DeltaNeutral" (market standard for most pairs) or "Forward". */
  atmConvention?: "DeltaNeutral" | "Forward";
}

export interface SmilePoint {
  delta: number; // put deltas negative
  vol: number;
  strike: number;
}

function smileVols(s: FxVolSurface, expiryIdx: number) {
  const atm = s.atm[expiryIdx]!;
  const rr25 = s.rr25[expiryIdx]!;
  const bf25 = s.bf25[expiryIdx]!;
  const c25 = atm + bf25 + rr25 / 2;
  const p25 = atm + bf25 - rr25 / 2;
  const out: { delta: number; vol: number }[] = [];
  if (s.rr10 && s.bf10) {
    const rr10 = s.rr10[expiryIdx]!;
    const bf10 = s.bf10[expiryIdx]!;
    out.push({ delta: -0.1, vol: atm + bf10 - rr10 / 2 });
  }
  out.push({ delta: -0.25, vol: p25 }, { delta: 0.5, vol: atm }, { delta: 0.25, vol: c25 });
  if (s.rr10 && s.bf10) {
    const rr10 = s.rr10[expiryIdx]!;
    const bf10 = s.bf10[expiryIdx]!;
    out.push({ delta: 0.1, vol: atm + bf10 + rr10 / 2 });
  }
  return out;
}

/** Map a signed delta to a monotone "moneyness coordinate": put -0.1 → 0.1, ATM → 0.5, call 0.1 → 0.9 */
function deltaCoordinate(delta: number): number {
  return delta < 0 ? -delta : delta === 0.5 ? 0.5 : 1 - delta;
}

function interpolateExpiry(expiries: number[], values: number[], t: number): number {
  if (expiries.length === 1) return values[0]!;
  // Interpolate in total variance for ATM vols; linear otherwise is fine for RR/BF.
  return linearInterp(expiries, values, t);
}

export function fxAtmVol(s: FxVolSurface, t: number): number {
  if (s.expiries.length === 1) return s.atm[0]!;
  const vars = s.atm.map((v, i) => v * v * s.expiries[i]!);
  const tv = linearInterp(s.expiries, vars, t);
  const tt = Math.max(t, 1e-8);
  const tClamped = Math.min(Math.max(t, s.expiries[0]!), s.expiries[s.expiries.length - 1]!);
  if (t !== tClamped) return s.atm[t < tClamped ? 0 : s.atm.length - 1]!;
  return Math.sqrt(Math.max(tv, 0) / tt);
}

/** Smile vol in delta space for the given expiry (t years) and signed forward delta. */
export function fxVolAtDelta(s: FxVolSurface, t: number, delta: number): number {
  const atm = fxAtmVol(s, t);
  const rr25 = interpolateExpiry(s.expiries, s.rr25, t);
  const bf25 = interpolateExpiry(s.expiries, s.bf25, t);
  const pts: { x: number; v: number }[] = [
    { x: 0.25, v: atm + bf25 - rr25 / 2 },
    { x: 0.5, v: atm },
    { x: 0.75, v: atm + bf25 + rr25 / 2 },
  ];
  if (s.rr10 && s.bf10) {
    const rr10 = interpolateExpiry(s.expiries, s.rr10, t);
    const bf10 = interpolateExpiry(s.expiries, s.bf10, t);
    pts.unshift({ x: 0.1, v: atm + bf10 - rr10 / 2 });
    pts.push({ x: 0.9, v: atm + bf10 + rr10 / 2 });
  }
  const x = Math.min(0.99, Math.max(0.01, deltaCoordinate(delta)));
  return linearInterp(pts.map((p) => p.x), pts.map((p) => p.v), x);
}

/**
 * Smile vol for a strike: iterate delta ↔ strike to a fixed point using
 * forward (unadjusted) delta convention.
 */
export function fxVolAtStrike(s: FxVolSurface, t: number, forward: number, strike: number): number {
  let vol = fxAtmVol(s, t);
  for (let i = 0; i < 50; i++) {
    const sd = vol * Math.sqrt(Math.max(t, 1e-8));
    const d1 = (Math.log(forward / strike) + 0.5 * sd * sd) / sd;
    // Use call delta when strike above forward, put delta when below.
    const callDelta = normCdfSafe(d1);
    const delta = strike >= forward ? callDelta : -(1 - callDelta);
    const nv = fxVolAtDelta(s, t, delta);
    if (Math.abs(nv - vol) < 1e-10) return nv;
    vol = nv;
  }
  return vol;
}

function normCdfSafe(x: number): number {
  // local import to avoid cycles
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26 (sufficient for delta bucketing; pricing uses normCdf elsewhere)
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Strike for a signed forward delta under the smile (used to build strike ladders). */
export function fxStrikeFromDelta(s: FxVolSurface, t: number, forward: number, delta: number): number {
  const vol = fxVolAtDelta(s, t, delta);
  const sd = vol * Math.sqrt(Math.max(t, 1e-8));
  const isCall = delta > 0;
  const d1 = isCall ? normInv(delta) : -normInv(-delta);
  return forward * Math.exp(0.5 * sd * sd - d1 * sd);
}

export function shiftFxSurface(s: FxVolSurface, absShift: number): FxVolSurface {
  return { ...s, atm: s.atm.map((v) => Math.max(1e-4, v + absShift)) };
}
