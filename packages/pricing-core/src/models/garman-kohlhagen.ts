import { normCdf, normInv, normPdf } from "../math/normal.js";
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
  const theta = (-spot * dff * normPdf(d1) * vol) / (2 * sqrtT) + sign * (rf * spot * dff * normCdf(sign * d1) - rd * strike * dfd * normCdf(sign * d2));
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
  return solveBracketed((v) => garmanKohlhagen({ ...i, vol: v }).premiumDomestic - premiumDomestic, guess, 0.05, { minX: 1e-6, maxX: 5, tolerance: 1e-12 });
}

/** Strike for a given forward delta (unadjusted) – used to convert delta-quoted smiles to strikes. */
export function strikeFromForwardDelta(type: OptionType, forward: number, vol: number, timeToExpiry: number, delta: number): number {
  const sign = type === "Call" ? 1 : -1;
  const sd = vol * Math.sqrt(timeToExpiry);
  // N⁻¹ of |delta| for calls; puts use delta negative.
  const d1 = sign * normInv(sign * delta);
  return forward * Math.exp(0.5 * sd * sd - d1 * sd);
}

/**
 * European digital.
 *
 * - `payoutInForeign = false` (default): cash-or-nothing paying 1 unit of
 *   domestic (quote) currency if in the money: e^{−r_d T}·N(±d₂).
 * - `payoutInForeign = true`: asset-or-nothing paying 1 unit of foreign
 *   (base) currency if in the money, valued in domestic currency:
 *   S·e^{−r_f T}·N(±d₁).
 *
 * Both are per unit payout and returned in domestic currency.
 */
export function fxDigital(i: FxOptionInputs, payoutInForeign = false): number {
  const { type, spot, strike, vol, timeToExpiry: t, rd, rf } = i;
  const tDel = i.timeToDelivery ?? t;
  const sign = type === "Call" ? 1 : -1;
  const forward = spot * Math.exp((rd - rf) * tDel);
  const dfd = Math.exp(-rd * tDel);
  const dff = Math.exp(-rf * tDel);
  if (t <= 0 || vol <= 0) {
    const itm = sign * (forward - strike) > 0 ? 1 : 0;
    return payoutInForeign ? dff * spot * itm : dfd * itm;
  }
  const sd = vol * Math.sqrt(t);
  const d2 = (Math.log(forward / strike) - 0.5 * sd * sd) / sd;
  if (payoutInForeign) {
    const d1 = d2 + sd;
    return dff * spot * normCdf(sign * d1);
  }
  return dfd * normCdf(sign * d2);
}

export type BarrierType = "UpIn" | "UpOut" | "DownIn" | "DownOut";

export interface FxBarrierInputs extends FxOptionInputs {
  barrier: number;
  barrierType: BarrierType;
  /** Cash rebate (domestic currency per unit foreign notional). */
  rebate?: number;
  /**
   * Knock-out rebate timing: paid at the barrier hit (market standard, Haug
   * Tab. 4-13; default) or at expiry. Knock-in rebates are always paid at
   * expiry when the barrier was never touched.
   */
  rebateAtExpiry?: boolean;
}

/**
 * Reiner–Rubinstein (1991) single continuous barrier options with optional rebate.
 * Standard closed forms as in Haug, "The Complete Guide to Option Pricing Formulas".
 * A barrier that is already breached at valuation makes a knock-in a vanilla
 * and a knock-out worth its rebate (paid immediately unless `rebateAtExpiry`).
 *
 * Settlement lag: like `garmanKohlhagen` and `fxDigital` the payoff is
 * discounted to the delivery date and the forward is the delivery-date
 * forward. Internally the rates are rescaled to the expiry horizon,
 * r = −ln DF_d(T_del)/T and q = −ln DF_f(T_del)/T, so that e^{−rT} = DF_d(T_del)
 * and S·e^{(r−q)T} = F(T_del) while the barrier diffusion (σ√T) stays on the
 * expiry horizon. This keeps In + Out = Vanilla exactly when a delivery lag
 * is present.
 */
export function fxBarrier(i: FxBarrierInputs): number {
  const { type, spot: S, strike: X, vol, timeToExpiry: T, barrier: H, barrierType } = i;
  const tDel = i.timeToDelivery ?? T;
  // Rates scaled to the expiry horizon (see doc comment); for T <= 0 the expired branch below is used.
  const scale = T > 0 ? tDel / T : 1;
  const r = i.rd * scale;
  const q = i.rf * scale;
  const K = i.rebate ?? 0;
  const breachedNow = (barrierType.startsWith("Up") && S >= H) || (barrierType.startsWith("Down") && S <= H);
  if (T <= 0 || vol <= 0) {
    // Expired: intrinsic on the delivery forward, discounted to delivery (as `garmanKohlhagen`),
    // subject to whether the barrier is currently breached.
    const alive = barrierType.endsWith("Out") ? !breachedNow : breachedNow;
    const fwd = S * Math.exp((i.rd - i.rf) * tDel);
    if (alive) return Math.max((type === "Call" ? 1 : -1) * (fwd - X), 0) * Math.exp(-i.rd * tDel);
    return barrierType.endsWith("Out") ? K : 0;
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
  const A = (phi: number) => phi * S * eqT * normCdf(phi * x1) - phi * X * erT * normCdf(phi * x1 - phi * sd);
  const B = (phi: number) => phi * S * eqT * normCdf(phi * x2) - phi * X * erT * normCdf(phi * x2 - phi * sd);
  const C = (phi: number, eta: number) =>
    phi * S * eqT * Math.pow(H / S, 2 * (mu + 1)) * normCdf(eta * y1) - phi * X * erT * Math.pow(H / S, 2 * mu) * normCdf(eta * y1 - eta * sd);
  const D = (phi: number, eta: number) =>
    phi * S * eqT * Math.pow(H / S, 2 * (mu + 1)) * normCdf(eta * y2) - phi * X * erT * Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd);
  const E = (eta: number) => K * erT * (normCdf(eta * x2 - eta * sd) - Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd));
  const F = (eta: number) => K * (Math.pow(H / S, mu + lambda) * normCdf(eta * z) + Math.pow(H / S, mu - lambda) * normCdf(eta * z - 2 * eta * lambda * sd));

  const isCall = type === "Call";
  const phi = isCall ? 1 : -1;
  // Barrier already breached → knock-in becomes vanilla, knock-out is dead (rebate at hit = now).
  if (breachedNow) {
    if (barrierType.endsWith("In")) return A(phi);
    return i.rebateAtExpiry ? K * erT : K;
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
      const rebate = i.rebateAtExpiry ? rebateAtExpiryOut(eta) : F(eta);
      if (isCall) return X > H ? A(phi) - C(phi, eta) + rebate : B(phi) - D(phi, eta) + rebate;
      return X > H ? A(phi) - B(phi) + C(phi, eta) - D(phi, eta) + rebate : rebate;
    }
    case "UpOut": {
      const eta = -1;
      const rebate = i.rebateAtExpiry ? rebateAtExpiryOut(eta) : F(eta);
      if (isCall) return X > H ? rebate : A(phi) - B(phi) + C(phi, eta) - D(phi, eta) + rebate;
      return X > H ? B(phi) - D(phi, eta) + rebate : A(phi) - C(phi, eta) + rebate;
    }
  }

  /** Knock-out rebate paid at expiry: K·e^{−rT}·P(barrier hit) with P(hit) = 1 − P(no hit). */
  function rebateAtExpiryOut(eta: number): number {
    const noHit = normCdf(eta * x2 - eta * sd) - Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd);
    return K * erT * (1 - noHit);
  }
}

export interface FxExoticGreeks {
  /** ∂P/∂S (domestic per unit foreign). */
  spotDelta: number;
  gamma: number;
  /** ∂P/∂σ per 1.00 vol. */
  vega: number;
  /** ∂P/∂t per year (calendar time forward; negative for decaying long positions). */
  theta: number;
  rhoDomestic: number;
  rhoForeign: number;
}

/**
 * Greeks of an exotic (barrier / digital) by central finite differences of
 * its closed-form price. For barriers the spot step is limited to half the
 * distance to the barrier so the difference never crosses it.
 */
export function fxExoticGreeks(price: (inputs: FxOptionInputs) => number, i: FxOptionInputs, opts: { barrier?: number } = {}): FxExoticGreeks {
  const t = i.timeToExpiry;
  if (t <= 0 || i.vol <= 0) return { spotDelta: 0, gamma: 0, vega: 0, theta: 0, rhoDomestic: 0, rhoForeign: 0 };
  let hS = i.spot * 1e-4;
  if (opts.barrier !== undefined) {
    const dist = Math.abs(i.spot - opts.barrier);
    if (dist > 0) hS = Math.min(hS, dist * 0.5);
  }
  const p0 = price(i);
  const pUp = price({ ...i, spot: i.spot + hS });
  const pDn = price({ ...i, spot: i.spot - hS });
  const spotDelta = (pUp - pDn) / (2 * hS);
  const gamma = (pUp - 2 * p0 + pDn) / (hS * hS);
  const hV = 1e-4;
  const vega = (price({ ...i, vol: i.vol + hV }) - price({ ...i, vol: Math.max(1e-8, i.vol - hV) })) / (2 * hV);
  // Central difference in calendar time (both expiry and delivery move).
  const dt = Math.min(1 / 365, t / 2);
  const tDel = i.timeToDelivery ?? t;
  const theta =
    (price({ ...i, timeToExpiry: t - dt, timeToDelivery: Math.max(t - dt, tDel - dt) }) - price({ ...i, timeToExpiry: t + dt, timeToDelivery: tDel + dt })) /
    (2 * dt);
  const hR = 1e-4;
  const rhoDomestic = (price({ ...i, rd: i.rd + hR }) - price({ ...i, rd: i.rd - hR })) / (2 * hR);
  const rhoForeign = (price({ ...i, rf: i.rf + hR }) - price({ ...i, rf: i.rf - hR })) / (2 * hR);
  return { spotDelta, gamma, vega, theta, rhoDomestic, rhoForeign };
}
