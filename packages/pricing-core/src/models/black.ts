import { normCdf, normPdf } from "../math/normal.js";
import { solveBracketed } from "../math/rootfind.js";
import { PricingError } from "../errors.js";

export type OptionType = "Call" | "Put";

export interface OptionGreeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

/**
 * Black-76 undiscounted option value on a forward with lognormal vol.
 * Returns the forward premium; multiply by the discount factor for PV.
 */
export function black76(type: OptionType, forward: number, strike: number, vol: number, timeToExpiry: number): number {
  const sign = type === "Call" ? 1 : -1;
  if (timeToExpiry <= 0 || vol <= 0) return Math.max(sign * (forward - strike), 0);
  if (forward <= 0 || strike <= 0) {
    // Lognormal model undefined; degrade gracefully to intrinsic.
    return Math.max(sign * (forward - strike), 0);
  }
  const sd = vol * Math.sqrt(timeToExpiry);
  const d1 = (Math.log(forward / strike) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  return sign * (forward * normCdf(sign * d1) - strike * normCdf(sign * d2));
}

export function black76Greeks(type: OptionType, forward: number, strike: number, vol: number, timeToExpiry: number, discount = 1): OptionGreeks {
  const sign = type === "Call" ? 1 : -1;
  if (timeToExpiry <= 0 || vol <= 0 || forward <= 0 || strike <= 0) {
    const intrinsic = Math.max(sign * (forward - strike), 0);
    return { price: discount * intrinsic, delta: intrinsic > 0 ? sign * discount : 0, gamma: 0, vega: 0, theta: 0 };
  }
  const sqrtT = Math.sqrt(timeToExpiry);
  const sd = vol * sqrtT;
  const d1 = (Math.log(forward / strike) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  const price = discount * sign * (forward * normCdf(sign * d1) - strike * normCdf(sign * d2));
  const delta = discount * sign * normCdf(sign * d1);
  const gamma = (discount * normPdf(d1)) / (forward * sd);
  const vega = discount * forward * normPdf(d1) * sqrtT;
  const theta = (-discount * forward * normPdf(d1) * vol) / (2 * sqrtT);
  return { price, delta, gamma, vega, theta };
}

/**
 * Bachelier (normal) model – the market standard for interest rate options
 * since rates went negative. `vol` is an absolute (normal) volatility in the
 * same unit as forward/strike (e.g. 0.0065 for 65 bp).
 */
export function bachelier(type: OptionType, forward: number, strike: number, normalVol: number, timeToExpiry: number): number {
  const sign = type === "Call" ? 1 : -1;
  if (timeToExpiry <= 0 || normalVol <= 0) return Math.max(sign * (forward - strike), 0);
  const sd = normalVol * Math.sqrt(timeToExpiry);
  const d = (forward - strike) / sd;
  return sign * (forward - strike) * normCdf(sign * d) + sd * normPdf(d);
}

export function bachelierGreeks(type: OptionType, forward: number, strike: number, normalVol: number, timeToExpiry: number, discount = 1): OptionGreeks {
  const sign = type === "Call" ? 1 : -1;
  if (timeToExpiry <= 0 || normalVol <= 0) {
    const intrinsic = Math.max(sign * (forward - strike), 0);
    return { price: discount * intrinsic, delta: intrinsic > 0 ? sign * discount : 0, gamma: 0, vega: 0, theta: 0 };
  }
  const sqrtT = Math.sqrt(timeToExpiry);
  const sd = normalVol * sqrtT;
  const d = (forward - strike) / sd;
  const price = discount * (sign * (forward - strike) * normCdf(sign * d) + sd * normPdf(d));
  const delta = discount * sign * normCdf(sign * d);
  const gamma = (discount * normPdf(d)) / sd;
  const vega = discount * sqrtT * normPdf(d);
  const theta = (-discount * normalVol * normPdf(d)) / (2 * sqrtT);
  return { price, delta, gamma, vega, theta };
}

/** Implied lognormal vol from an undiscounted Black-76 premium. */
export function impliedBlackVol(type: OptionType, forward: number, strike: number, timeToExpiry: number, premium: number, guess = 0.2): number {
  const sign = type === "Call" ? 1 : -1;
  const intrinsic = Math.max(sign * (forward - strike), 0);
  if (premium < intrinsic - 1e-14) throw new PricingError("NUMERICAL_FAILURE", "impliedBlackVol: premium below intrinsic value");
  return solveBracketed((v) => black76(type, forward, strike, v, timeToExpiry) - premium, guess, 0.1, {
    minX: 1e-8,
    maxX: 20,
    tolerance: 1e-12,
  });
}

/** Implied normal vol from an undiscounted Bachelier premium. */
export function impliedNormalVol(type: OptionType, forward: number, strike: number, timeToExpiry: number, premium: number, guess = 0.006): number {
  const sign = type === "Call" ? 1 : -1;
  const intrinsic = Math.max(sign * (forward - strike), 0);
  if (premium < intrinsic - 1e-14) throw new PricingError("NUMERICAL_FAILURE", "impliedNormalVol: premium below intrinsic value");
  return solveBracketed((v) => bachelier(type, forward, strike, v, timeToExpiry) - premium, guess, 0.005, { minX: 1e-10, maxX: 5, tolerance: 1e-14 });
}

/**
 * Convert a lognormal (Black) vol to an equivalent normal vol for the given
 * forward/strike/expiry by matching prices (exact via root search).
 */
export function lognormalToNormalVol(forward: number, strike: number, timeToExpiry: number, blackVol: number, shift = 0): number {
  const f = forward + shift;
  const k = strike + shift;
  const p = black76("Call", f, k, blackVol, timeToExpiry);
  return impliedNormalVol("Call", forward, strike, timeToExpiry, p, blackVol * Math.max(Math.abs(f), 1e-4));
}

/**
 * Convert a normal (Bachelier) vol to the equivalent (shifted) lognormal Black
 * vol at the given forward/strike/expiry by matching the undiscounted call
 * price (exact via root search). Requires `forward + shift > 0` and
 * `strike + shift > 0`; the caller decides how to treat the incompatible case.
 */
export function normalToLognormalVol(forward: number, strike: number, timeToExpiry: number, normalVol: number, shift = 0): number {
  const f = forward + shift;
  const k = strike + shift;
  if (!(f > 0) || !(k > 0)) throw new PricingError("VOL_MODEL_INCOMPATIBLE", `normalToLognormalVol: shifted forward/strike must be positive (F ${f}, K ${k})`);
  const p = bachelier("Call", forward, strike, normalVol, timeToExpiry);
  const guess = normalVol / f;
  return impliedBlackVol("Call", f, k, timeToExpiry, p, Math.min(Math.max(guess, 1e-4), 5));
}

/** Vol quotation of a surface / model: normal (absolute) or (shifted) lognormal. */
export type IrVolQuotation = { kind: "normal" } | { kind: "lognormal"; shift: number };

/**
 * Convert an interest-rate vol between quotations (normal ↔ lognormal with any
 * shift) by price equivalence at (forward, strike, expiry): the undiscounted
 * call value under `from` is re-implied under `to`. Identity when both
 * quotations agree. When the exact root search fails (premium numerically at
 * intrinsic for deep out-of-the-money strikes) the first-order approximation
 * σ_LN ≈ σ_N / (F + shift) (and its inverse) is used. Throws when a lognormal
 * quotation is requested for a non-positive shifted forward or strike.
 */
export function convertIrVol(vol: number, from: IrVolQuotation, to: IrVolQuotation, forward: number, strike: number, timeToExpiry: number): number {
  if (from.kind === to.kind && (from.kind === "normal" || (to.kind === "lognormal" && from.shift === to.shift))) return vol;
  if (to.kind === "lognormal" && (!(forward + to.shift > 0) || !(strike + to.shift > 0))) {
    throw new PricingError(
      "VOL_MODEL_INCOMPATIBLE",
      `convertIrVol: lognormal quotation needs positive shifted forward/strike (F ${forward + to.shift}, K ${strike + to.shift})`,
    );
  }
  if (!(timeToExpiry > 0) || !(vol > 0)) {
    // No time value → any vol reproduces the intrinsic value; return the first-order equivalent.
    return approxConvert(vol, from, to, forward);
  }
  try {
    const price =
      from.kind === "normal"
        ? bachelier("Call", forward, strike, vol, timeToExpiry)
        : black76("Call", forward + from.shift, strike + from.shift, vol, timeToExpiry);
    if (to.kind === "normal") return impliedNormalVol("Call", forward, strike, timeToExpiry, price, Math.max(approxConvert(vol, from, to, forward), 1e-6));
    const f = forward + to.shift;
    const k = strike + to.shift;
    return impliedBlackVol("Call", f, k, timeToExpiry, price, Math.min(Math.max(approxConvert(vol, from, to, forward), 1e-4), 5));
  } catch {
    return approxConvert(vol, from, to, forward);
  }
}

/** First-order vol conversion σ_N ≈ σ_LN · (F + shift). */
function approxConvert(vol: number, from: IrVolQuotation, to: IrVolQuotation, forward: number): number {
  const normal = from.kind === "normal" ? vol : vol * Math.max(Math.abs(forward + from.shift), 1e-4);
  return to.kind === "normal" ? normal : normal / Math.max(Math.abs(forward + to.shift), 1e-4);
}

/** Shifted-lognormal Black (displaced diffusion), common for EUR caps/swaptions with e.g. 3% shift. */
export function shiftedBlack76(type: OptionType, forward: number, strike: number, vol: number, timeToExpiry: number, shift: number): number {
  return black76(type, forward + shift, strike + shift, vol, timeToExpiry);
}
