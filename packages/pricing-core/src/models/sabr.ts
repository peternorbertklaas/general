import { PricingError } from "../errors.js";

/**
 * SABR (Hagan et al. 2002) implied-volatility approximations.
 *
 * - `sabrLognormalVol`: classic Hagan formula (shifted-lognormal variant via `shift`).
 * - `sabrNormalVol`: Hagan normal-vol expansion, used for Bachelier quoting.
 */
export interface SabrParams {
  alpha: number;
  beta: number;
  rho: number;
  nu: number;
  /** Displacement for shifted SABR (e.g. 0.03 for EUR). */
  shift?: number;
}

export function sabrLognormalVol(forward: number, strike: number, t: number, p: SabrParams): number {
  const s = p.shift ?? 0;
  const f = forward + s;
  const k = strike + s;
  const { alpha, beta, rho, nu } = p;
  if (f <= 0 || k <= 0) throw new PricingError("VOL_MODEL_INCOMPATIBLE", "SABR lognormal vol requires positive shifted forward/strike");
  const oneMinusBeta = 1 - beta;
  const fk = f * k;
  const fkPow = Math.pow(fk, oneMinusBeta / 2);
  const logFK = Math.log(f / k);
  if (Math.abs(logFK) < 1e-10) {
    // ATM expansion
    const fPow = Math.pow(f, oneMinusBeta);
    const term1 = alpha / fPow;
    const term2 =
      1 +
      ((oneMinusBeta * oneMinusBeta * alpha * alpha) / (24 * fPow * fPow) + (rho * beta * nu * alpha) / (4 * fPow) + ((2 - 3 * rho * rho) * nu * nu) / 24) * t;
    return term1 * term2;
  }
  const z = (nu / alpha) * fkPow * logFK;
  const xz = Math.log((Math.sqrt(1 - 2 * rho * z + z * z) + z - rho) / (1 - rho));
  const denom = fkPow * (1 + (oneMinusBeta * oneMinusBeta * logFK * logFK) / 24 + (Math.pow(oneMinusBeta, 4) * Math.pow(logFK, 4)) / 1920);
  const term2 =
    1 +
    ((oneMinusBeta * oneMinusBeta * alpha * alpha) / (24 * Math.pow(fk, oneMinusBeta)) +
      (rho * beta * nu * alpha) / (4 * fkPow) +
      ((2 - 3 * rho * rho) * nu * nu) / 24) *
      t;
  return (alpha / denom) * (z / xz) * term2;
}

export function sabrNormalVol(forward: number, strike: number, t: number, p: SabrParams): number {
  const s = p.shift ?? 0;
  const f = forward + s;
  const k = strike + s;
  const { alpha, beta, rho, nu } = p;
  if (f <= 0 || k <= 0) throw new PricingError("VOL_MODEL_INCOMPATIBLE", "SABR normal vol requires positive shifted forward/strike");
  const oneMinusBeta = 1 - beta;
  const fk = f * k;
  const fMid = (f + k) / 2;
  const logFK = Math.abs(f - k) < 1e-12 ? 0 : Math.log(f / k);
  const cMid = Math.pow(fMid, beta);
  const gamma1 = beta / fMid;
  const gamma2 = (beta * (beta - 1)) / (fMid * fMid);
  let zeta: number;
  let xz: number;
  if (Math.abs(f - k) < 1e-12 || beta === 1) {
    zeta = (nu / alpha) * Math.pow(fk, oneMinusBeta / 2) * logFK;
  } else {
    zeta = (nu / (alpha * oneMinusBeta)) * (Math.pow(f, oneMinusBeta) - Math.pow(k, oneMinusBeta));
  }
  if (Math.abs(zeta) < 1e-10) {
    xz = 1;
  } else {
    xz = zeta / Math.log((Math.sqrt(1 - 2 * rho * zeta + zeta * zeta) + zeta - rho) / (1 - rho));
  }
  // ∫_k^f dx / C(x) with C(x) = x^β: (f^{1−β} − k^{1−β})/(1−β), or log(f/k) for β = 1.
  const prefactor =
    Math.abs(f - k) < 1e-12
      ? alpha * cMid
      : beta === 1
        ? (alpha * (f - k)) / logFK
        : (alpha * oneMinusBeta * (f - k)) / (Math.pow(f, oneMinusBeta) - Math.pow(k, oneMinusBeta));
  const term =
    1 +
    (((2 * gamma2 - gamma1 * gamma1) / 24) * alpha * alpha * cMid * cMid + (rho * nu * alpha * gamma1 * cMid) / 4 + ((2 - 3 * rho * rho) * nu * nu) / 24) * t;
  return prefactor * xz * term;
}

/**
 * Calibrate SABR alpha (given beta, rho, nu) to an ATM normal or lognormal vol.
 * Simple bisection – alpha enters monotonically for ATM.
 */
export function sabrAlphaFromAtm(
  forward: number,
  t: number,
  atmVol: number,
  params: Omit<SabrParams, "alpha">,
  mode: "normal" | "lognormal" = "normal",
): number {
  const f = forward + (params.shift ?? 0);
  const alpha0 = mode === "normal" ? atmVol / Math.pow(f, params.beta) : atmVol * Math.pow(f, 1 - params.beta);
  let lo = alpha0 * 0.05;
  let hi = alpha0 * 3;
  const fn = (a: number) =>
    (mode === "normal" ? sabrNormalVol(forward, forward, t, { ...params, alpha: a }) : sabrLognormalVol(forward, forward, t, { ...params, alpha: a })) - atmVol;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) > 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-14) break;
  }
  return (lo + hi) / 2;
}
