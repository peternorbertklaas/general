import { linearInterp, locate } from "../math/interpolation.js";
import { type SabrParams, sabrNormalVol } from "./sabr.js";

export type VolType = "Normal" | "Lognormal" | "ShiftedLognormal";

/**
 * Swaption volatility cube: expiry x tenor grid of ATM vols plus optional
 * per-(expiry,tenor) SABR smile parameters. Vols in decimal (normal vols in
 * rate units, e.g. 0.0070 = 70 bp).
 */
export interface SwaptionVolSurface {
  id: string;
  currency: string;
  volType: VolType;
  shift?: number;
  /** Expiries in years (sorted ascending). */
  expiries: number[];
  /** Underlying swap tenors in years (sorted ascending). */
  tenors: number[];
  /** atm[expiryIdx][tenorIdx] */
  atm: number[][];
  /** Optional smile parameters keyed `${expiry}x${tenor}`; alpha is recalibrated to ATM at query time. */
  sabr?: Record<string, Omit<SabrParams, "alpha">>;
}

/**
 * Caplet/floorlet volatility surface: expiry (years) x strike grid.
 */
export interface CapletVolSurface {
  id: string;
  currency: string;
  index: string;
  volType: VolType;
  shift?: number;
  expiries: number[];
  strikes: number[];
  /** vols[expiryIdx][strikeIdx] */
  vols: number[][];
}

export function bilinear(xs: number[], ys: number[], grid: number[][], x: number, y: number): number {
  if (xs.length === 1 && ys.length === 1) return grid[0]![0]!;
  if (xs.length === 1) return linearInterp(ys, grid[0]!, y);
  if (ys.length === 1) return linearInterp(xs, grid.map((r) => r[0]!), x);
  const i = locate(xs, x);
  const j = locate(ys, y);
  const x0 = xs[i]!;
  const x1 = xs[i + 1]!;
  const y0 = ys[j]!;
  const y1 = ys[j + 1]!;
  const tx = x1 === x0 ? 0 : Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  const ty = y1 === y0 ? 0 : Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  const g00 = grid[i]![j]!;
  const g01 = grid[i]![j + 1]!;
  const g10 = grid[i + 1]![j]!;
  const g11 = grid[i + 1]![j + 1]!;
  return (1 - tx) * ((1 - ty) * g00 + ty * g01) + tx * ((1 - ty) * g10 + ty * g11);
}

export function swaptionAtmVol(s: SwaptionVolSurface, expiry: number, tenor: number): number {
  return bilinear(s.expiries, s.tenors, s.atm, expiry, tenor);
}

/**
 * Vol for a given strike. If SABR parameters are present the smile is
 * recovered by recalibrating alpha to the ATM vol; otherwise the ATM vol is
 * returned (flat smile).
 */
export function swaptionVol(
  s: SwaptionVolSurface,
  expiry: number,
  tenor: number,
  forward: number,
  strike: number,
): number {
  const atm = swaptionAtmVol(s, expiry, tenor);
  if (!s.sabr) return atm;
  // Pick nearest smile params.
  const e = nearest(s.expiries, expiry);
  const t = nearest(s.tenors, tenor);
  const p = s.sabr[`${e}x${t}`];
  if (!p) return atm;
  const shift = p.shift ?? s.shift ?? 0.03;
  const f = forward + shift;
  const k = strike + shift;
  if (f <= 0 || k <= 0) return atm;
  // Calibrate alpha to ATM (normal vol mode – our surfaces are normal by default).
  // The Hagan expansion is only monotone in alpha for moderate values, so bracket
  // around the leading-order solution alpha ≈ atm / f^beta.
  const alpha0 = atm / Math.pow(f, p.beta);
  let lo = alpha0 * 0.05;
  let hi = alpha0 * 3;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const v = sabrNormalVol(forward, forward, expiry, { ...p, alpha: mid, shift });
    if (v > atm) hi = mid;
    else lo = mid;
  }
  const alpha = (lo + hi) / 2;
  const smileVol = sabrNormalVol(forward, strike, expiry, { ...p, alpha, shift });
  return Number.isFinite(smileVol) && smileVol > 0 ? smileVol : atm;
}

export function capletVol(s: CapletVolSurface, expiry: number, strike: number): number {
  return bilinear(s.expiries, s.strikes, s.vols, expiry, strike);
}

function nearest(xs: number[], x: number): number {
  let best = xs[0]!;
  let bestD = Math.abs(x - best);
  for (const v of xs) {
    const d = Math.abs(x - v);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

export function shiftSwaptionSurface(s: SwaptionVolSurface, absShift: number): SwaptionVolSurface {
  return { ...s, atm: s.atm.map((row) => row.map((v) => Math.max(1e-6, v + absShift))) };
}

export function shiftCapletSurface(s: CapletVolSurface, absShift: number): CapletVolSurface {
  return { ...s, vols: s.vols.map((row) => row.map((v) => Math.max(1e-6, v + absShift))) };
}
