import { linearInterp, locate } from "../math/interpolation.js";
import { type SabrParams, sabrAlphaFromAtm, sabrLognormalVol, sabrNormalVol } from "./sabr.js";

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
  /**
   * Optional smile parameters keyed `${expiry}x${tenor}`; alpha is recalibrated
   * to ATM at query time. Between grid points the parameters (beta, rho, nu,
   * shift) are blended by inverse squared distance in (log expiry, log tenor).
   */
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
  if (ys.length === 1)
    return linearInterp(
      xs,
      grid.map((r) => r[0]!),
      x,
    );
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
 * SABR parameters for (expiry, tenor): exact grid point when present, else an
 * inverse-distance-squared blend of all parameter points in (log expiry, log
 * tenor) space – continuous across the cube instead of a hard nearest switch.
 */
export function sabrParamsAt(s: SwaptionVolSurface, expiry: number, tenor: number): Omit<SabrParams, "alpha"> | undefined {
  if (!s.sabr) return undefined;
  const entries = Object.entries(s.sabr);
  if (entries.length === 0) return undefined;
  const pts = entries
    .map(([key, p]) => {
      const m = /^([\d.]+)x([\d.]+)$/.exec(key);
      return m ? { e: Number(m[1]), t: Number(m[2]), p } : undefined;
    })
    .filter((x): x is { e: number; t: number; p: Omit<SabrParams, "alpha"> } => x !== undefined);
  if (pts.length === 0) return undefined;
  const le = Math.log(Math.max(expiry, 1e-6));
  const lt = Math.log(Math.max(tenor, 1e-6));
  let wSum = 0;
  let beta = 0;
  let rho = 0;
  let nu = 0;
  let shift = 0;
  let hasShift = false;
  for (const pt of pts) {
    const d2 = Math.pow(le - Math.log(pt.e), 2) + Math.pow(lt - Math.log(pt.t), 2);
    if (d2 < 1e-12) return pt.p;
    const w = 1 / d2;
    wSum += w;
    beta += w * pt.p.beta;
    rho += w * pt.p.rho;
    nu += w * pt.p.nu;
    if (pt.p.shift !== undefined) {
      shift += w * pt.p.shift;
      hasShift = true;
    }
  }
  return { beta: beta / wSum, rho: rho / wSum, nu: nu / wSum, ...(hasShift ? { shift: shift / wSum } : {}) };
}

/**
 * Vol for a given strike. If SABR parameters are present the smile is
 * recovered by recalibrating alpha to the ATM vol – in normal-vol terms for
 * "Normal" surfaces and in (shifted) lognormal terms for "Lognormal" /
 * "ShiftedLognormal" surfaces; otherwise the ATM vol is returned (flat smile).
 * The default SABR shift is 3% for normal/shifted surfaces (EUR market
 * practice, keeps the CEV backbone defined for negative rates) and 0 for
 * plain lognormal surfaces.
 */
export function swaptionVol(s: SwaptionVolSurface, expiry: number, tenor: number, forward: number, strike: number): number {
  const atm = swaptionAtmVol(s, expiry, tenor);
  const p = sabrParamsAt(s, expiry, tenor);
  if (!p) return atm;
  const shift = p.shift ?? s.shift ?? (s.volType === "Lognormal" ? 0 : 0.03);
  const f = forward + shift;
  const k = strike + shift;
  if (f <= 0 || k <= 0) return atm;
  const params = { ...p, shift };
  const lognormal = s.volType !== "Normal";
  try {
    const alpha = sabrAlphaFromAtm(forward, expiry, atm, params, lognormal ? "lognormal" : "normal");
    const smileVol = lognormal ? sabrLognormalVol(forward, strike, expiry, { ...params, alpha }) : sabrNormalVol(forward, strike, expiry, { ...params, alpha });
    return Number.isFinite(smileVol) && smileVol > 0 ? smileVol : atm;
  } catch {
    return atm;
  }
}

export function capletVol(s: CapletVolSurface, expiry: number, strike: number): number {
  return bilinear(s.expiries, s.strikes, s.vols, expiry, strike);
}

export function shiftSwaptionSurface(s: SwaptionVolSurface, absShift: number): SwaptionVolSurface {
  return { ...s, atm: s.atm.map((row) => row.map((v) => Math.max(1e-6, v + absShift))) };
}

export function shiftCapletSurface(s: CapletVolSurface, absShift: number): CapletVolSurface {
  return { ...s, vols: s.vols.map((row) => row.map((v) => Math.max(1e-6, v + absShift))) };
}
