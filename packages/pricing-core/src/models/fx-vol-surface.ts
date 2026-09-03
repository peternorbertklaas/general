import { linearInterp, monotoneCubicInterp } from "../math/interpolation.js";
import { normCdf, normInv, normPdf } from "../math/normal.js";
import { solveBracketed } from "../math/rootfind.js";
import { black76 } from "./black.js";

/**
 * Delta convention of the smile quotes:
 * - "Forward": unadjusted forward delta (default),
 * - "Spot": unadjusted spot delta (e.g. EURUSD ≤ 1Y),
 * - "PremiumAdjustedSpot": premium-adjusted spot delta (USDJPY, EM pairs ≤ 1Y),
 * - "PremiumAdjustedForward": premium-adjusted forward delta (JPY crosses and
 *   most pairs > 1Y, Reiswich–Wystup convention table).
 */
export type FxDeltaConvention = "Spot" | "Forward" | "PremiumAdjustedSpot" | "PremiumAdjustedForward";

/** Smile interpolation in the (unadjusted forward put-delta) coordinate. */
export type FxSmileInterpolation = "linear" | "cubic";

/**
 * Meaning of the butterfly quotes: "Smile" (default) – the quoted BF is the
 * smile strangle margin, i.e. σ(25Δ call) = ATM + BF + RR/2 and σ(25Δ put) =
 * ATM + BF − RR/2 hold exactly at the pillars; "Broker" – the quoted BF is the
 * one-vol broker strangle (market convention for interbank quotes): the 25Δ
 * strikes are the strikes that carry 25Δ under the single vol ATM + BF, and
 * the smile must reprice this strangle. The smile-consistent margin is then
 * found by the Reiswich–Wystup iteration (`smileStrangleFromBroker`).
 */
export type FxStrangleType = "Smile" | "Broker";

/**
 * FX volatility surface in market quoting convention: per expiry ATM vol,
 * 25Δ / 10Δ risk reversals and butterflies. The smile is interpolated in
 * delta space (internally: unadjusted forward put delta of the strike, so the
 * coordinate is monotone in the strike under every delta convention) –
 * linearly by default or with a monotone cubic – with flat extrapolation
 * beyond the outermost pillars, and converted to strike via the surface's
 * delta convention.
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
  /** ATM convention: "DeltaNeutral" (market standard for most pairs) or "Forward" (K = F). */
  atmConvention?: "DeltaNeutral" | "Forward";
  /** Delta convention of the RR/BF pillars (default "Forward"). */
  deltaConvention?: FxDeltaConvention;
  /** Interpolation between the smile pillars (default "linear", backward compatible). */
  smileInterpolation?: FxSmileInterpolation;
  /** Interpretation of `bf25` (default "Smile"). 10Δ butterflies are always read as smile strangles. */
  strangleType?: FxStrangleType;
}

/** Market inputs needed for spot-delta conventions (ignored for forward deltas). */
export interface FxSmileContext {
  /** Foreign (base currency) discount factor to delivery, e^{−r_f T}. Default 1. */
  dfForeign?: number;
}

export interface SmilePoint {
  delta: number; // put deltas negative
  vol: number;
  strike: number;
}

/** Raw smile pillars (delta, vol) for one expiry row – used by charting/diagnostics (BF read as quoted). */
export function smileVols(s: FxVolSurface, expiryIdx: number) {
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

function interpolateExpiry(expiries: number[], values: number[], t: number): number {
  if (expiries.length === 1) return values[0]!;
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

// ---------------------------------------------------------------------------
// Delta ↔ strike (moneyness) under the four conventions
// ---------------------------------------------------------------------------

/** d1 for moneyness m = K/F. */
function d1Of(m: number, sd: number): number {
  return (-Math.log(m) + 0.5 * sd * sd) / sd;
}

function isPremiumAdjusted(conv: FxDeltaConvention): boolean {
  return conv === "PremiumAdjustedSpot" || conv === "PremiumAdjustedForward";
}

/** Internal smile coordinate of a strike: unadjusted forward put-delta magnitude N(−d1) ∈ (0, 1), increasing in K. */
function coordinateOfMoneyness(m: number, vol: number, t: number): number {
  const sd = vol * Math.sqrt(Math.max(t, 1e-8));
  return normCdf(-d1Of(m, sd));
}

/**
 * Moneyness K/F for a signed delta (calls positive, puts negative) under the
 * given convention. Premium-adjusted call deltas are not monotone in the
 * strike; the market solution on the right (high-strike) branch is returned.
 */
export function fxMoneynessFromDelta(delta: number, vol: number, t: number, conv: FxDeltaConvention, dfForeign = 1): number {
  const sd = vol * Math.sqrt(Math.max(t, 1e-8));
  const isCall = delta > 0;
  const sign = isCall ? 1 : -1;
  // Spot conventions carry the foreign discount factor, forward conventions do not.
  const dfScale = conv === "Spot" || conv === "PremiumAdjustedSpot" ? dfForeign : 1;
  if (!isPremiumAdjusted(conv)) {
    const p = (sign * delta) / dfScale;
    if (p <= 0 || p >= 1) throw new Error(`FX delta ${delta} out of range for ${conv} delta with dfForeign ${dfForeign}`);
    const d1 = sign * normInv(p);
    return Math.exp(0.5 * sd * sd - d1 * sd);
  }
  // Premium-adjusted delta: Δ = dfScale · sign · m · N(sign · d2(m)).
  const target = (sign * delta) / dfScale;
  const g = (m: number) => m * normCdf(sign * (d1Of(m, sd) - sd));
  if (!isCall) {
    // |Δ_put| = m·N(−d2) is increasing in m.
    let lo = 1e-8;
    let hi = Math.exp(10 * sd + 1);
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (g(mid) < target) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }
  // Calls: m·N(d2) has a maximum; the market solution is on the right (high-strike) branch.
  // At the maximum N(d2)·sd = φ(d2); solve for d2 (monotone for d2 > −sd).
  let dLo = -sd;
  let dHi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (dLo + dHi);
    if (normCdf(mid) * sd - normPdf(mid) < 0) dLo = mid;
    else dHi = mid;
  }
  const d2Max = 0.5 * (dLo + dHi);
  const mMax = Math.exp(-d2Max * sd - 0.5 * sd * sd);
  if (g(mMax) < target) throw new Error(`Premium-adjusted call delta ${delta} not attainable (max ${g(mMax) * dfScale})`);
  let lo = mMax;
  let hi = mMax * Math.exp(10 * sd + 1);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) > target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Signed delta of a strike (moneyness m = K/F) under the convention. */
export function fxDeltaFromMoneyness(isCall: boolean, m: number, vol: number, t: number, conv: FxDeltaConvention, dfForeign = 1): number {
  const sd = vol * Math.sqrt(Math.max(t, 1e-8));
  const sign = isCall ? 1 : -1;
  const d1 = d1Of(m, sd);
  const dfScale = conv === "Spot" || conv === "PremiumAdjustedSpot" ? dfForeign : 1;
  if (!isPremiumAdjusted(conv)) return sign * dfScale * normCdf(sign * d1);
  return sign * dfScale * m * normCdf(sign * (d1 - sd));
}

// ---------------------------------------------------------------------------
// Smile pillars and interpolation
// ---------------------------------------------------------------------------

interface Pillar {
  x: number;
  v: number;
}

/** Quotes of one expiry (interpolated in expiry) with the smile-consistent 25Δ strangle margin. */
interface RowQuotes {
  atm: number;
  rr25: number;
  /** Smile strangle margin at 25Δ (equal to the quote for "Smile", solved for "Broker"). */
  ss25: number;
  rr10?: number;
  bf10?: number;
}

function rawRowQuotes(s: FxVolSurface, t: number): RowQuotes {
  const row: RowQuotes = {
    atm: fxAtmVol(s, t),
    rr25: interpolateExpiry(s.expiries, s.rr25, t),
    ss25: interpolateExpiry(s.expiries, s.bf25, t),
  };
  if (s.rr10 && s.bf10) {
    row.rr10 = interpolateExpiry(s.expiries, s.rr10, t);
    row.bf10 = interpolateExpiry(s.expiries, s.bf10, t);
  }
  return row;
}

/** Smile pillars (internal coordinate, vol) from row quotes, sorted by coordinate. */
function pillarsFromRow(s: FxVolSurface, row: RowQuotes, t: number, dff: number): Pillar[] {
  const conv = s.deltaConvention ?? "Forward";
  const coord = (delta: number, vol: number) => coordinateOfMoneyness(fxMoneynessFromDelta(delta, vol, t, conv, dff), vol, t);
  const pts: Pillar[] = [];
  const p25 = row.atm + row.ss25 - row.rr25 / 2;
  const c25 = row.atm + row.ss25 + row.rr25 / 2;
  pts.push({ x: coord(-0.25, p25), v: p25 });
  pts.push({ x: coord(0.25, c25), v: c25 });
  if (row.rr10 !== undefined && row.bf10 !== undefined) {
    const p10 = row.atm + row.bf10 - row.rr10 / 2;
    const c10 = row.atm + row.bf10 + row.rr10 / 2;
    pts.push({ x: coord(-0.1, p10), v: p10 });
    pts.push({ x: coord(0.1, c10), v: c10 });
  }
  // ATM pillar.
  const sd = row.atm * Math.sqrt(Math.max(t, 1e-8));
  let xAtm: number;
  if ((s.atmConvention ?? "DeltaNeutral") === "Forward")
    xAtm = normCdf(-sd / 2); // K = F
  else if (isPremiumAdjusted(conv))
    xAtm = normCdf(-sd); // K = F·e^{−σ²T/2}
  else xAtm = 0.5; // K = F·e^{σ²T/2}
  pts.push({ x: xAtm, v: row.atm });
  pts.sort((a, b) => a.x - b.x);
  return pts;
}

function interpolatePillars(pts: Pillar[], x: number, method: FxSmileInterpolation): number {
  if (x <= pts[0]!.x) return pts[0]!.v; // flat extrapolation
  if (x >= pts[pts.length - 1]!.x) return pts[pts.length - 1]!.v;
  const xs = pts.map((p) => p.x);
  const vs = pts.map((p) => p.v);
  return method === "cubic" ? monotoneCubicInterp(xs, vs, x) : linearInterp(xs, vs, x);
}

/** Smile vol at moneyness m from pillars (fixed point vol ↔ coordinate). */
function volAtMoneyness(pts: Pillar[], m: number, t: number, method: FxSmileInterpolation, start: number): number {
  let vol = start;
  for (let i = 0; i < 50; i++) {
    const nv = interpolatePillars(pts, coordinateOfMoneyness(m, vol, t), method);
    if (Math.abs(nv - vol) < 1e-12) return nv;
    vol = nv;
  }
  return vol;
}

// ---------------------------------------------------------------------------
// Broker strangle (Reiswich–Wystup)
// ---------------------------------------------------------------------------

/**
 * Value (per unit of forward, undiscounted) of the 25Δ strangle whose strikes
 * are set with the single vol `sigmaS` under the surface's delta convention,
 * priced with `volAt(m)`.
 */
function strangleValue(conv: FxDeltaConvention, dff: number, t: number, sigmaS: number, volAt: (m: number) => number): number {
  const mc = fxMoneynessFromDelta(0.25, sigmaS, t, conv, dff);
  const mp = fxMoneynessFromDelta(-0.25, sigmaS, t, conv, dff);
  return black76("Call", 1, mc, volAt(mc), t) + black76("Put", 1, mp, volAt(mp), t);
}

/** Cache of solved smile strangle margins per surface: key `${t}|${dff}`. */
const brokerCache = new WeakMap<FxVolSurface, Map<string, number>>();

/**
 * Smile-consistent 25Δ strangle margin for a surface whose `bf25` is quoted as
 * a one-vol broker strangle (Reiswich–Wystup 2010, "FX Volatility Smile
 * Construction"): find σ_ss such that the smile built from
 * σ(25Δc) = ATM + σ_ss + RR/2, σ(25Δp) = ATM + σ_ss − RR/2 reprices the broker
 * strangle – the call/put struck at 25Δ under the single vol σ_S = ATM + BF
 * and valued at σ_S. For "Smile" surfaces the quote itself is returned.
 */
export function smileStrangleFromBroker(s: FxVolSurface, t: number, ctx: FxSmileContext = {}): number {
  const row = rawRowQuotes(s, t);
  if ((s.strangleType ?? "Smile") !== "Broker") return row.ss25;
  const dff = ctx.dfForeign ?? 1;
  const key = `${t}|${dff}`;
  let cache = brokerCache.get(s);
  if (!cache) {
    cache = new Map<string, number>();
    brokerCache.set(s, cache);
  }
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const conv = s.deltaConvention ?? "Forward";
  const method = s.smileInterpolation ?? "linear";
  const bfBroker = row.ss25;
  const sigmaS = row.atm + bfBroker;
  const target = strangleValue(conv, dff, t, sigmaS, () => sigmaS);
  const f = (ss: number): number => {
    const pts = pillarsFromRow(s, { ...row, ss25: ss }, t, dff);
    return strangleValue(conv, dff, t, sigmaS, (m) => volAtMoneyness(pts, m, t, method, row.atm)) - target;
  };
  const minSs = -row.atm + Math.abs(row.rr25) / 2 + 1e-4; // keep pillar vols positive
  const ss = solveBracketed(f, Math.max(bfBroker, minSs), 0.0005, { minX: minSs, maxX: row.atm, tolerance: 1e-12 });
  cache.set(key, ss);
  return ss;
}

/**
 * Inverse of `smileStrangleFromBroker`: the one-vol broker strangle quote a
 * dealer would show for the surface's smile at expiry `t` (the surface is
 * evaluated as it is – "Smile" quotes directly, "Broker" quotes through the
 * iteration – so for a "Broker" surface the quote itself is recovered).
 */
export function brokerStrangleFromSmile(s: FxVolSurface, t: number, ctx: FxSmileContext = {}): number {
  const row = rawRowQuotes(s, t);
  const dff = ctx.dfForeign ?? 1;
  const conv = s.deltaConvention ?? "Forward";
  const method = s.smileInterpolation ?? "linear";
  const pts = smilePillars(s, t, ctx);
  const smileValue = (sigmaS: number) => strangleValue(conv, dff, t, sigmaS, (m) => volAtMoneyness(pts, m, t, method, row.atm));
  const f = (bf: number): number => {
    const sigmaS = row.atm + bf;
    return strangleValue(conv, dff, t, sigmaS, () => sigmaS) - smileValue(sigmaS);
  };
  return solveBracketed(f, row.ss25, 0.0005, { minX: -row.atm + 1e-4, maxX: row.atm, tolerance: 1e-12 });
}

/** Smile pillars as (internal coordinate, vol) for one expiry, sorted by coordinate. */
function smilePillars(s: FxVolSurface, t: number, ctx: FxSmileContext): Pillar[] {
  const dff = ctx.dfForeign ?? 1;
  const row = rawRowQuotes(s, t);
  if ((s.strangleType ?? "Smile") === "Broker") row.ss25 = smileStrangleFromBroker(s, t, ctx);
  return pillarsFromRow(s, row, t, dff);
}

/**
 * Smile vol for a signed delta quoted in the surface's delta convention
 * (put deltas negative). Spot-delta conventions need `ctx.dfForeign`.
 */
export function fxVolAtDelta(s: FxVolSurface, t: number, delta: number, ctx: FxSmileContext = {}): number {
  const conv = s.deltaConvention ?? "Forward";
  const dff = ctx.dfForeign ?? 1;
  const method = s.smileInterpolation ?? "linear";
  const pts = smilePillars(s, t, ctx);
  if (delta === 0.5) return fxAtmVol(s, t);
  let vol = fxAtmVol(s, t);
  for (let i = 0; i < 50; i++) {
    const m = fxMoneynessFromDelta(delta, vol, t, conv, dff);
    const nv = interpolatePillars(pts, coordinateOfMoneyness(m, vol, t), method);
    if (Math.abs(nv - vol) < 1e-12) return nv;
    vol = nv;
    // For unadjusted conventions the coordinate does not depend on the vol → converged.
    if (!isPremiumAdjusted(conv)) return nv;
  }
  return vol;
}

/**
 * Smile vol for a strike: iterate vol ↔ smile coordinate to a fixed point.
 * `ctx.dfForeign` (e^{−r_f T}) is only needed for spot-delta conventions.
 */
export function fxVolAtStrike(s: FxVolSurface, t: number, forward: number, strike: number, ctx: FxSmileContext = {}): number {
  const pts = smilePillars(s, t, ctx);
  return volAtMoneyness(pts, strike / forward, t, s.smileInterpolation ?? "linear", fxAtmVol(s, t));
}

/** Strike for a signed delta (surface convention) under the smile (used to build strike ladders). */
export function fxStrikeFromDelta(s: FxVolSurface, t: number, forward: number, delta: number, ctx: FxSmileContext = {}): number {
  const conv = s.deltaConvention ?? "Forward";
  const vol = fxVolAtDelta(s, t, delta, ctx);
  return forward * fxMoneynessFromDelta(delta, vol, t, conv, ctx.dfForeign ?? 1);
}

export function shiftFxSurface(s: FxVolSurface, absShift: number): FxVolSurface {
  return { ...s, atm: s.atm.map((v) => Math.max(1e-4, v + absShift)) };
}
