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
  /** Domestic (quote currency) continuously compounded rate to delivery (payoff discount, delivery forward). */
  rd: number;
  /** Foreign (base currency) continuously compounded rate to delivery. */
  rf: number;
  /**
   * Expiry-horizon rates driving the spot dynamics on [0, T] – the barrier
   * drift b = rdExpiry − rfExpiry and the discounting of a rebate paid at the
   * hit (R3-9). They are the rates to the *standard* delivery of the expiry
   * (spot date of T), so `S·e^{(rdExpiry − rfExpiry)·T}` is the forward for
   * that date. Default: the delivery-horizon rates rescaled by T_del/T, which
   * equals the expiry-horizon rates exactly when the delivery is the standard
   * one; for a non-standard (longer) lag the pricer supplies them from the
   * curves so the extra carry only enters the payoff discount and forward.
   */
  rdExpiry?: number;
  rfExpiry?: number;
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
 * discounted to the delivery date (DF_d(T_del)) and struck against the
 * delivery-date forward F(T_del), while the barrier diffusion (σ√T) and the
 * spot drift run on the expiry horizon. The drift b = rdExpiry − rfExpiry and
 * the rate discounting a rebate paid at the hit are the expiry-horizon rates
 * (`FxOptionInputs.rdExpiry`/`rfExpiry`; default: delivery rates rescaled by
 * T_del/T, exact for the standard delivery). The payoff is written on
 * F_T(T_del) = c·S_T with the deterministic carry c = F(T_del)/(S·e^{bT})
 * between the spot at expiry and the delivery forward, which the formulas
 * absorb by pricing on the scaled spot S' = c·S and barrier H' = c·H (R3-9).
 * In + Out = Vanilla holds exactly for every delivery lag.
 */
export function fxBarrier(i: FxBarrierInputs): number {
  const { type, strike: X, vol, timeToExpiry: T, barrierType } = i;
  const tDel = i.timeToDelivery ?? T;
  const K = i.rebate ?? 0;
  const breachedNow = (barrierType.startsWith("Up") && i.spot >= i.barrier) || (barrierType.startsWith("Down") && i.spot <= i.barrier);
  if (T <= 0 || vol <= 0) {
    // Expired: intrinsic on the delivery forward, discounted to delivery (as `garmanKohlhagen`),
    // subject to whether the barrier is currently breached.
    const alive = barrierType.endsWith("Out") ? !breachedNow : breachedNow;
    const fwd = i.spot * Math.exp((i.rd - i.rf) * tDel);
    if (alive) return Math.max((type === "Call" ? 1 : -1) * (fwd - X), 0) * Math.exp(-i.rd * tDel);
    return barrierType.endsWith("Out") ? K : 0;
  }
  // Expiry-horizon rates: drift of the spot on [0, T] and discounting of rebates paid at the hit.
  const scale = tDel / T;
  const r = i.rdExpiry ?? i.rd * scale;
  const q = i.rfExpiry ?? i.rf * scale;
  const b = r - q;
  // Payoff discount and forward on the delivery horizon; the carry between S_T and F_T(T_del) scales spot and barrier.
  const dfPay = Math.exp(-i.rd * tDel);
  const fwdDel = i.spot * Math.exp((i.rd - i.rf) * tDel);
  const c = fwdDel / (i.spot * Math.exp(b * T));
  const S = i.spot * c;
  const H = i.barrier * c;
  const sd = vol * Math.sqrt(T);
  const mu = (b - 0.5 * vol * vol) / (vol * vol);
  const lambda = Math.sqrt(mu * mu + (2 * r) / (vol * vol));
  const z = Math.log(H / S) / sd + lambda * sd;
  const x1 = Math.log(S / X) / sd + (1 + mu) * sd;
  const x2 = Math.log(S / H) / sd + (1 + mu) * sd;
  const y1 = Math.log((H * H) / (S * X)) / sd + (1 + mu) * sd;
  const y2 = Math.log(H / S) / sd + (1 + mu) * sd;
  // e^{−qT} = e^{−rT}·e^{bT} in the classical formulas; here the payoff discount is dfPay and S·e^{bT} = F(T_del).
  const eqT = dfPay * Math.exp(b * T);
  const erT = dfPay;
  const A = (phi: number) => phi * S * eqT * normCdf(phi * x1) - phi * X * erT * normCdf(phi * x1 - phi * sd);
  const B = (phi: number) => phi * S * eqT * normCdf(phi * x2) - phi * X * erT * normCdf(phi * x2 - phi * sd);
  const C = (phi: number, eta: number) =>
    phi * S * eqT * Math.pow(H / S, 2 * (mu + 1)) * normCdf(eta * y1) - phi * X * erT * Math.pow(H / S, 2 * mu) * normCdf(eta * y1 - eta * sd);
  const D = (phi: number, eta: number) =>
    phi * S * eqT * Math.pow(H / S, 2 * (mu + 1)) * normCdf(eta * y2) - phi * X * erT * Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd);
  // Knock-in rebate paid at expiry (settled at delivery) when the barrier was never touched.
  const E = (eta: number) => K * erT * (normCdf(eta * x2 - eta * sd) - Math.pow(H / S, 2 * mu) * normCdf(eta * y2 - eta * sd));
  // Knock-out rebate paid at the hit: discounted with the expiry-horizon rate r through λ.
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
  // Explicit expiry-horizon rates move with the delivery rates (parallel shift of the curve).
  const bumpRd = (h: number): FxOptionInputs => ({ ...i, rd: i.rd + h, ...(i.rdExpiry !== undefined ? { rdExpiry: i.rdExpiry + h } : {}) });
  const bumpRf = (h: number): FxOptionInputs => ({ ...i, rf: i.rf + h, ...(i.rfExpiry !== undefined ? { rfExpiry: i.rfExpiry + h } : {}) });
  const rhoDomestic = (price(bumpRd(hR)) - price(bumpRd(-hR))) / (2 * hR);
  const rhoForeign = (price(bumpRf(hR)) - price(bumpRf(-hR))) / (2 * hR);
  return { spotDelta, gamma, vega, theta, rhoDomestic, rhoForeign };
}
