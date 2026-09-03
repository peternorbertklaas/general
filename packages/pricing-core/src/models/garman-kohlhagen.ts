import { normCdf, normPdf } from "../math/normal.js";
import { solveBracketed } from "../math/rootfind.js";
import { type OptionType } from "./black.js";

export interface FxOptionInputs {
  type: OptionType;
  spot: number;
  strike: number;
  /** Lognormal vol (annualised, decimal). */
  vol: number;
  /** Time to expiry in years. */
  timeToExpiry: number;
  /** Time to delivery/settlement in years (>= expiry). Defaults to expiry. */
  timeToDelivery?: number;
  /** Domestic (quote currency) continuously compounded rate. */
  rd: number;
  /** Foreign (base currency) continuously compounded rate. */
  rf: number;
}

export interface FxOptionResult {
  /** Premium in domestic (quote) currency per 1 unit of foreign (base) notional. */
  premiumDomestic: number;
  /** Premium as % of foreign notional. */
  premiumForeignPct: number;
  forward: number;
  /** Spot delta (domestic currency per unit foreign, i.e. "pips delta"). */
  spotDelta: number;
  forwardDelta: number;
  /** Premium-adjusted spot delta (market convention for many EM / e.g. EURUSD uses unadjusted). */
  premiumAdjustedSpotDelta: number;
  gamma: number;
  /** Vega per 1.00 change in vol (divide by 100 for per vol-point). */
  vega: number;
  /** Theta per year (divide by 365 for daily). */
  theta: number;
  rhoDomestic: number;
  rhoForeign: number;
  d1: number;
  d2: number;
}

/** Garman–Kohlhagen closed form for European FX vanilla options. */
export function garmanKohlhagen(i: FxOptionInputs): FxOptionResult {
  const { type, spot, strike, vol, timeToExpiry: t, rd, rf } = i;
  const tDel = i.timeToDelivery ?? t;
  const sign = type === "Call" ? 1 : -1;
  const forward = spot * Math.exp((rd - rf) * tDel);
  const dfd = Math.exp(-rd * tDel);
  const dff = Math.exp(-rf * tDel);
  if (t <= 0 || vol <= 0) {
    const intrinsic = Math.max(sign * (forward - strike), 0) * dfd;
    return {
      premiumDomestic: intrinsic,
      premiumForeignPct: intrinsic / spot,
      forward,
      spotDelta: intrinsic > 0 ? sign * dff : 0,
      forwardDelta: intrinsic > 0 ? sign : 0,
      premiumAdjustedSpotDelta: intrinsic > 0 ? sign * dff - intrinsic / spot : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rhoDomestic: 0,
      rhoForeign: 0,
      d1: 0,
      d2: 0,
    };
  }
  const sqrtT = Math.sqrt(t);
  const sd = vol * sqrtT;
  const d1 = (Math.log(forward / strike) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  const premium = dfd * sign * (forward * normCdf(sign * d1) - strike * normCdf(sign * d2));
  const spotDelta = sign * dff * normCdf(sign * d1);
  const forwardDelta = sign * normCdf(sign * d1);
  const gamma = (dff * normPdf(d1)) / (spot * sd);
  const vega = spot * dff * normPdf(d1) * sqrtT;
  const theta =
    (-spot * dff * normPdf(d1) * vol) / (2 * sqrtT) +
    sign * (rf * spot * dff * normCdf(sign * d1) - rd * strike * dfd * normCdf(sign * d2));
  const rhoDomestic = sign * strike * tDel * dfd * normCdf(sign * d2);
  const rhoForeign = -sign * spot * tDel * dff * normCdf(sign * d1);
  return {
    premiumDomestic: premium,
    premiumForeignPct: premium / spot,
    forward,
    spotDelta,
    forwardDelta,
    premiumAdjustedSpotDelta: spotDelta - premium / spot,
    gamma,
    vega,
    theta,
    rhoDomestic,
    rhoForeign,
    d1,
    d2,
  };
}

export function impliedFxVol(i: Omit<FxOptionInputs, "vol">, premiumDomestic: number, guess = 0.1): number {
  return solveBracketed(
    (v) => garmanKohlhagen({ ...i, vol: v }).premiumDomestic - premiumDomestic,
    guess,
    0.05,
    { minX: 1e-6, maxX: 5, tolerance: 1e-12 },
  );
}

/** Strike for a given forward delta (unadjusted) – used to convert delta-quoted smiles to strikes. */
export function strikeFromForwardDelta(
  type: OptionType,
  forward: number,
  vol: number,
  timeToExpiry: number,
  delta: number,
): number {
  const sign = type === "Call" ? 1 : -1;
  const sd = vol * Math.sqrt(timeToExpiry);
  // Ninv of |delta| for calls; puts use delta negative.
  const { normInv } = require_normInv();
  const d1 = sign * normInv(sign * delta);
  return forward * Math.exp(-sign * 0 + (0.5 * sd * sd - d1 * sd));
}

// Lazy import to avoid circular import ordering issues in some bundlers.
function require_normInv(): { normInv: (p: number) => number } {
  return { normInv: normInvImpl };
}
import { normInv as normInvImpl } from "../math/normal.js";

/** Cash-or-nothing digital (pays 1 unit domestic if in the money). */
export function fxDigital(i: FxOptionInputs): number {
  const { type, spot, strike, vol, timeToExpiry: t, rd, rf } = i;
  const tDel = i.timeToDelivery ?? t;
  const sign = type === "Call" ? 1 : -1;
  const forward = spot * Math.exp((rd - rf) * tDel);
  const dfd = Math.exp(-rd * tDel);
  if (t <= 0 || vol <= 0) return dfd * (sign * (forward - strike) > 0 ? 1 : 0);
  const sd = vol * Math.sqrt(t);
  const d2 = (Math.log(forward / strike) - 0.5 * sd * sd) / sd;
  return dfd * normCdf(sign * d2);
}

export type BarrierType = "UpIn" | "UpOut" | "DownIn" | "DownOut";

/**
 * Reiner–Rubinstein (1991) single continuous barrier options with optional rebate.
 * Standard closed forms as in Haug, "The Complete Guide to Option Pricing Formulas".
 */
export function fxBarrier(
  i: FxOptionInputs & { barrier: number; barrierType: BarrierType; rebate?: number },
): number {
  const { type, spot: S, strike: X, vol, timeToExpiry: T, rd: r, rf: q, barrier: H, barrierType } = i;
  const K = i.rebate ?? 0;
  if (T <= 0 || vol <= 0) {
    // Expired: intrinsic subject to whether barrier is currently breached.
    const breached =
      (barrierType.startsWith("Up") && S >= H) || (barrierType.startsWith("Down") && S <= H);
    const alive = barrierType.endsWith("Out") ? !breached : breached;
    return alive ? Math.max((type === "Call" ? 1 : -1) * (S - X), 0) : 0;
  }
  const b = r - q;
  const sd = vol * Math.sqrt(T);
  const mu = (b - 0.5 * vol * vol) / (vol * vol);
  const lambda = Math.sqrt(mu * mu + (2 * r) / (vol * vol));
  const z = Math.log(H / S) / sd + lambda * sd;
  const x1 = Math.log(S / X) / sd + (1 + mu) * sd;
  const x2 = Math.log(S / H) / sd + (1 + mu) * sd;
  const y1 = Math.log((H * H) / (S * X)) / sd + (1 + mu) * sd;
  const y2 = Math.log(H / S) / sd + (1 + mu) * sd;
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const A = (phi: number) =>
    phi * S * eqT * normCdf(phi * x1) - phi * X * erT * normCdf(phi * x1 - phi * sd);
  const B = (phi: number) =>
    phi * S * eqT * normCdf(phi * x2) - phi * X * erT * normCdf(phi * x2 - phi * sd);
  const C = (phi: number, eta: number) =>
    phi * S * eqT * Math.pow(H / S, 2 * (mu + 1)) * normCdf(eta * y1) -
    phi * X * erT * Math.pow(H / S, 2 * mu) * normCdf(eta * y1 - eta * sd);
  const D = (phi: number, eta: number) =>
    phi * S * eqT * Math.pow(H / S, 2 * (mu + 1)) * normCdf(eta * y2) -
    phi * X * erT * Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd);
  const E = (eta: number) =>
    K * erT * (normCdf(eta * x2 - eta * sd) - Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd));
  const F = (eta: number) =>
    K * (Math.pow(H / S, mu + lambda) * normCdf(eta * z) + Math.pow(H / S, mu - lambda) * normCdf(eta * z - 2 * eta * lambda * sd));

  const isCall = type === "Call";
  const phi = isCall ? 1 : -1;
  // Barrier already breached → knock-in becomes vanilla, knock-out is dead.
  if ((barrierType.startsWith("Up") && S >= H) || (barrierType.startsWith("Down") && S <= H)) {
    const vanilla = A(phi);
    return barrierType.endsWith("In") ? vanilla : K * erT;
  }
  switch (barrierType) {
    case "DownIn": {
      const eta = 1;
      if (isCall) return X > H ? C(phi, eta) + E(eta) : A(phi) - B(phi) + D(phi, eta) + E(eta);
      return X > H ? B(phi) - C(phi, eta) + D(phi, eta) + E(eta) : A(phi) + E(eta);
    }
    case "UpIn": {
      const eta = -1;
      if (isCall) return X > H ? A(phi) + E(eta) : B(phi) - C(phi, eta) + D(phi, eta) + E(eta);
      return X > H ? A(phi) - B(phi) + D(phi, eta) + E(eta) : C(phi, eta) + E(eta);
    }
    case "DownOut": {
      const eta = 1;
      if (isCall) return X > H ? A(phi) - C(phi, eta) + F(eta) : B(phi) - D(phi, eta) + F(eta);
      return X > H ? A(phi) - B(phi) + C(phi, eta) - D(phi, eta) + F(eta) : F(eta);
    }
    case "UpOut": {
      const eta = -1;
      if (isCall) return X > H ? F(eta) : A(phi) - B(phi) + C(phi, eta) - D(phi, eta) + F(eta);
      return X > H ? B(phi) - D(phi, eta) + F(eta) : A(phi) - C(phi, eta) + F(eta);
    }
  }
}
