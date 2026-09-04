import { PricingError } from "../errors.js";
import { type FxVolSurface } from "../models/fx-vol-surface.js";
import { type CapletVolSurface, type SwaptionVolSurface } from "../models/vol-surfaces.js";

/**
 * Structural validation of volatility surfaces (Markt R5-1). Imported cubes
 * and smiles used to be accepted with any shape – a 1×1 `atm` grid on an
 * 11×9 cube surfaced as a `TypeError` ("Invalid trade") on the next swaption
 * valuation, an FX `atm` row of the wrong length as `NON_FINITE_PV`. The
 * checks here are the ones a vendor loader (VCUB, ORE) applies on load:
 * dimension consistency of every grid against its axes, finite non-negative
 * vols, strictly increasing (sorted, unique) axes, `volType` from the enum,
 * key ↔ `currency` / `pair` consistency.
 */

/** Shape accepted by `validateVolSurfaces` – the (untrusted) JSON of a snapshot or a `PUT /api/market` body. */
export interface VolSurfacesInput {
  swaptionVols?: Record<string, unknown>;
  capletVols?: Record<string, unknown>;
  fxVols?: Record<string, unknown>;
}

const VOL_TYPES = ["Normal", "Lognormal", "ShiftedLognormal"];
const FX_DELTA_CONVENTIONS = ["Spot", "Forward", "PremiumAdjustedSpot", "PremiumAdjustedForward"];

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Axis: non-empty array of finite numbers, strictly increasing (sorted, unique); `positive` additionally requires > 0. */
function checkAxis(axis: unknown, path: string, out: string[], positive: boolean): axis is number[] {
  if (!Array.isArray(axis) || axis.length === 0) {
    out.push(`${path} must be a non-empty array of numbers`);
    return false;
  }
  let ok = true;
  let prev: number | undefined;
  axis.forEach((v: unknown, i) => {
    if (!isNum(v) || (positive && v <= 0)) {
      out.push(`${path}[${i}] must be a finite${positive ? ", positive" : ""} number (got ${String(v)})`);
      ok = false;
      return;
    }
    if (prev !== undefined && v <= prev) {
      out.push(`${path}[${i}] (${v}) must be greater than ${path}[${i - 1}] (${prev}) – axis strictly increasing, no duplicates`);
      ok = false;
    }
    prev = v;
  });
  return ok;
}

/** Vol vector: same length as the axis, finite and ≥ 0 (RR quotes may be negative, see `allowNegative`). */
function checkVolRow(row: unknown, len: number, path: string, out: string[], allowNegative = false): void {
  if (!Array.isArray(row)) {
    out.push(`${path} must be an array of ${len} vols`);
    return;
  }
  if (row.length !== len) out.push(`${path} has ${row.length} entries, expected ${len} (one per expiry)`);
  row.forEach((v: unknown, i) => {
    if (!isNum(v)) out.push(`${path}[${i}] must be a finite number (got ${String(v)})`);
    else if (!allowNegative && v < 0) out.push(`${path}[${i}] must be non-negative (got ${v})`);
  });
}

/** Vol grid: `rows` rows of `cols` finite non-negative vols. */
function checkVolGrid(grid: unknown, rows: number, cols: number, path: string, rowAxis: string, colAxis: string, out: string[]): void {
  if (!Array.isArray(grid)) {
    out.push(`${path} must be a ${rows}×${cols} array (${rowAxis} × ${colAxis})`);
    return;
  }
  if (grid.length !== rows) out.push(`${path} has ${grid.length} rows, expected ${rows} (one per ${rowAxis})`);
  grid.forEach((row: unknown, i) => {
    if (!Array.isArray(row)) {
      out.push(`${path}[${i}] must be an array of ${cols} vols`);
      return;
    }
    if (row.length !== cols) out.push(`${path}[${i}] has ${row.length} entries, expected ${cols} (one per ${colAxis})`);
    row.forEach((v: unknown, j) => {
      if (!isNum(v) || v < 0) out.push(`${path}[${i}][${j}] must be a finite, non-negative vol (got ${String(v)})`);
    });
  });
}

function checkVolType(s: { volType?: unknown; shift?: unknown }, path: string, out: string[]): void {
  if (!VOL_TYPES.includes(String(s.volType)))
    out.push(`${path}.volType must be one of ${VOL_TYPES.join(", ")} (got ${JSON.stringify(s.volType) ?? String(s.volType)})`);
  if (s.shift !== undefined && (!isNum(s.shift) || s.shift < 0)) out.push(`${path}.shift must be a finite, non-negative number (got ${String(s.shift)})`);
}

/** Problems of one swaption cube keyed `key` (currency). */
export function swaptionSurfaceProblems(surface: unknown, key: string, path = `swaptionVols.${key}`): string[] {
  const out: string[] = [];
  const s = surface as Partial<SwaptionVolSurface> | null;
  if (!s || typeof s !== "object") return [`${path} must be a swaption vol surface object`];
  if (typeof s.id !== "string" || !s.id) out.push(`${path}.id missing`);
  if (typeof s.currency !== "string" || !s.currency) out.push(`${path}.currency missing`);
  else if (/^[A-Z]{3}$/.test(key) && s.currency.toUpperCase() !== key.toUpperCase())
    out.push(`${path}.currency "${s.currency}" does not match the key "${key}"`);
  checkVolType(s, path, out);
  const expiries = s.expiries;
  const tenors = s.tenors;
  const expiriesOk = checkAxis(expiries, `${path}.expiries`, out, true);
  const tenorsOk = checkAxis(tenors, `${path}.tenors`, out, true);
  if (expiriesOk && tenorsOk) checkVolGrid(s.atm, expiries.length, tenors.length, `${path}.atm`, "expiry", "tenor", out);
  else if (!Array.isArray(s.atm)) out.push(`${path}.atm must be an expiries × tenors array`);
  if (s.sabr !== undefined) {
    if (!s.sabr || typeof s.sabr !== "object" || Array.isArray(s.sabr)) out.push(`${path}.sabr must be an object keyed "<expiry>x<tenor>"`);
    else {
      for (const [k, p] of Object.entries(s.sabr as Record<string, unknown>)) {
        if (!/^[\d.]+x[\d.]+$/.test(k)) out.push(`${path}.sabr key "${k}" must be "<expiry>x<tenor>"`);
        const sp = p as { beta?: unknown; rho?: unknown; nu?: unknown; shift?: unknown } | null;
        if (!sp || typeof sp !== "object") {
          out.push(`${path}.sabr["${k}"] must be { beta, rho, nu, shift? }`);
          continue;
        }
        if (!isNum(sp.beta) || sp.beta < 0 || sp.beta > 1) out.push(`${path}.sabr["${k}"].beta must be in [0, 1] (got ${String(sp.beta)})`);
        if (!isNum(sp.rho) || sp.rho <= -1 || sp.rho >= 1) out.push(`${path}.sabr["${k}"].rho must be in (−1, 1) (got ${String(sp.rho)})`);
        if (!isNum(sp.nu) || sp.nu < 0) out.push(`${path}.sabr["${k}"].nu must be finite and ≥ 0 (got ${String(sp.nu)})`);
        if (sp.shift !== undefined && (!isNum(sp.shift) || sp.shift < 0))
          out.push(`${path}.sabr["${k}"].shift must be finite and ≥ 0 (got ${String(sp.shift)})`);
      }
    }
  }
  return out;
}

/** Problems of one caplet surface keyed `key` (`${ccy}-${index}` or `${ccy}`). */
export function capletSurfaceProblems(surface: unknown, key: string, path = `capletVols.${key}`): string[] {
  const out: string[] = [];
  const s = surface as Partial<CapletVolSurface> | null;
  if (!s || typeof s !== "object") return [`${path} must be a caplet vol surface object`];
  if (typeof s.id !== "string" || !s.id) out.push(`${path}.id missing`);
  if (typeof s.currency !== "string" || !s.currency) out.push(`${path}.currency missing`);
  else {
    const keyCcy = key.slice(0, 3).toUpperCase();
    if (/^[A-Z]{3}(-|$)/.test(key.toUpperCase()) && s.currency.toUpperCase() !== keyCcy)
      out.push(`${path}.currency "${s.currency}" does not match the key "${key}"`);
  }
  if (typeof s.index !== "string" || !s.index) out.push(`${path}.index missing`);
  checkVolType(s, path, out);
  const expiries = s.expiries;
  const strikes = s.strikes;
  const expiriesOk = checkAxis(expiries, `${path}.expiries`, out, true);
  const strikesOk = checkAxis(strikes, `${path}.strikes`, out, false);
  if (expiriesOk && strikesOk) checkVolGrid(s.vols, expiries.length, strikes.length, `${path}.vols`, "expiry", "strike", out);
  else if (!Array.isArray(s.vols)) out.push(`${path}.vols must be an expiries × strikes array`);
  return out;
}

/** Problems of one FX vol surface keyed `key` (pair, either quotation). */
export function fxSurfaceProblems(surface: unknown, key: string, path = `fxVols.${key}`): string[] {
  const out: string[] = [];
  const s = surface as Partial<FxVolSurface> | null;
  if (!s || typeof s !== "object") return [`${path} must be an FX vol surface object`];
  if (typeof s.id !== "string" || !s.id) out.push(`${path}.id missing`);
  const keyPair = key.replace("/", "").toUpperCase();
  if (typeof s.pair !== "string" || !s.pair) out.push(`${path}.pair missing`);
  else {
    const p = s.pair.replace("/", "").toUpperCase();
    if (!/^[A-Z]{6}$/.test(p)) out.push(`${path}.pair "${s.pair}" must be a 6-letter currency pair`);
    else if (/^[A-Z]{6}$/.test(keyPair) && p !== keyPair && p !== keyPair.slice(3) + keyPair.slice(0, 3)) {
      out.push(`${path}.pair "${s.pair}" does not match the key "${key}"`);
    }
  }
  if (checkAxis(s.expiries, `${path}.expiries`, out, true)) {
    const n = s.expiries.length;
    checkVolRow(s.atm, n, `${path}.atm`, out);
    checkVolRow(s.rr25, n, `${path}.rr25`, out, true);
    checkVolRow(s.bf25, n, `${path}.bf25`, out, true);
    if (s.rr10 !== undefined) checkVolRow(s.rr10, n, `${path}.rr10`, out, true);
    if (s.bf10 !== undefined) checkVolRow(s.bf10, n, `${path}.bf10`, out, true);
    if ((s.rr10 === undefined) !== (s.bf10 === undefined)) out.push(`${path}: rr10 and bf10 must be given together`);
  } else {
    for (const k of ["atm", "rr25", "bf25"] as const) if (!Array.isArray(s[k])) out.push(`${path}.${k} must be an array of vols (one per expiry)`);
  }
  if (s.atmConvention !== undefined && s.atmConvention !== "DeltaNeutral" && s.atmConvention !== "Forward") {
    out.push(`${path}.atmConvention must be "DeltaNeutral" or "Forward" (got ${JSON.stringify(s.atmConvention)})`);
  }
  if (s.deltaConvention !== undefined && !FX_DELTA_CONVENTIONS.includes(String(s.deltaConvention))) {
    out.push(`${path}.deltaConvention must be one of ${FX_DELTA_CONVENTIONS.join(", ")} (got ${JSON.stringify(s.deltaConvention)})`);
  }
  if (s.smileInterpolation !== undefined && s.smileInterpolation !== "linear" && s.smileInterpolation !== "cubic") {
    out.push(`${path}.smileInterpolation must be "linear" or "cubic" (got ${JSON.stringify(s.smileInterpolation)})`);
  }
  if (s.strangleType !== undefined && s.strangleType !== "Smile" && s.strangleType !== "Broker") {
    out.push(`${path}.strangleType must be "Smile" or "Broker" (got ${JSON.stringify(s.strangleType)})`);
  }
  return out;
}

/**
 * Structural problems of the vol surfaces in `input` (swaption cubes, caplet
 * surfaces, FX smiles), empty = valid. Every problem names the surface key and
 * the offending path (`swaptionVols.USD.atm[0] has 1 entries, expected 9 (one
 * per tenor)`). Used by `validateMarket` / `deserializeMarket` and by
 * `PUT /api/market` (Markt R5-1); `undefined` collections are fine.
 */
export function validateVolSurfaces(input: VolSurfacesInput): string[] {
  const out: string[] = [];
  const each = (coll: Record<string, unknown> | undefined, name: string, fn: (s: unknown, key: string) => string[]) => {
    if (coll === undefined) return;
    if (!coll || typeof coll !== "object" || Array.isArray(coll)) {
      out.push(`${name} must be an object keyed by ${name === "fxVols" ? "currency pair" : name === "capletVols" ? "currency[-index]" : "currency"}`);
      return;
    }
    for (const [key, s] of Object.entries(coll)) out.push(...fn(s, key));
  };
  each(input.swaptionVols, "swaptionVols", swaptionSurfaceProblems);
  each(input.capletVols, "capletVols", capletSurfaceProblems);
  each(input.fxVols, "fxVols", fxSurfaceProblems);
  return out;
}

// ---------------------------------------------------------------------------
// Plausibility (Markt R6-4): structurally valid surfaces whose numbers cannot be
// vols in the declared quotation – a lognormal cube filled with normal numbers
// (0.0097 = 0.97 %) prices a swaption at ≈ 0, an all-zero cube at intrinsic –
// are reported as warnings, not problems: the market stays loadable, the
// warning travels with every valuation that reads the surface.
// ---------------------------------------------------------------------------

/** Warning prefix for a vol surface whose values are implausible in the declared quotation or degenerate (Markt R6-4). */
export const VOL_IMPLAUSIBLE_PREFIX = "VOL_IMPLAUSIBLE:";

/**
 * Plausibility thresholds (decimal vols). Per value: lognormal /
 * shifted-lognormal IR vols must lie in [0.1 %, 300 %], normal (basis-point)
 * vols in [0.1 bp, 1000 bp], FX vols in [0.05 %, 300 %]; exact zeros are
 * tolerated individually (a legitimate boundary value, R5) but a surface
 * consisting only of zeros is degenerate. Per surface: the median decides
 * whether the numbers fit the declared quotation – a Lognormal IR surface with
 * median < 1 % looks like normal (bp) numbers, a Normal surface with median
 * > 500 bp like lognormal numbers (the reviewer's probe: `volType: "Lognormal"`
 * on a cube of 0.0097 valued a swaption at ≈ 0 without a signal).
 *
 * FX surfaces (N7-6) have no `volType` – they are always lognormal decimals –
 * and pegged / managed pairs quote genuinely small vols (EURDKK in ERM II
 * ±2.25 %: ATM 0.3–1 %; USDHKD band: 0.3–1.6 %), so the 1 % median rule
 * produced false alarms. The FX median floor is 0.2 %: a pegged surface passes,
 * a surface imported at 1/100 scale (EURUSD 7 % → 0.07 %, USDJPY 10 % → 0.1 %)
 * is still caught, and the message speaks of scaling, not of a `volType`.
 */
export const VOL_PLAUSIBILITY = {
  lognormalMin: 0.001,
  lognormalMax: 3,
  normalMin: 0.00001,
  normalMax: 0.1,
  /** Median below this on a Lognormal IR surface → quotation suspicious. */
  lognormalMedianMin: 0.01,
  /** Median above this on a Normal surface → quotation suspicious. */
  normalMedianMax: 0.05,
  /** FX surfaces (N7-6): per-value floor – short-dated vols of pegged pairs sit around 0.1–0.3 %. */
  fxMin: 0.0005,
  /** FX surfaces (N7-6): median below this → import scaled by 1/100 (pegged pairs stay above it). */
  fxMedianMin: 0.002,
  /** FX smiles (N8-6): |risk reversal| / |butterfly| above this (50 vol points) → quotes look scaled / are not vol differences. */
  fxSmileMax: 0.5,
} as const;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : 0.5 * (s[mid - 1]! + s[mid]!);
}

function fmtVol(v: number, normal: boolean): string {
  return normal ? `${(v * 1e4).toFixed(v * 1e4 < 1 ? 2 : 0)} bp` : `${(v * 100).toFixed(v * 100 < 1 ? 2 : 0)} %`;
}

/**
 * `VOL_IMPLAUSIBLE:` messages for a flat list of vols in the quotation `volType`
 * (Lognormal unless "Normal"); `fx` marks an FX surface (lognormal without a
 * `volType`, pegged-pair thresholds and scaling-oriented wording, N7-6).
 */
function implausibleVols(values: number[], volType: unknown, path: string, fx = false): string[] {
  const finite = values.filter(isNum);
  if (finite.length === 0) return [];
  if (finite.every((v) => v === 0)) return [`${VOL_IMPLAUSIBLE_PREFIX} ${path} is degenerate – every vol is 0 (options are valued at intrinsic value only)`];
  const normal = !fx && volType === "Normal";
  const min = fx ? VOL_PLAUSIBILITY.fxMin : normal ? VOL_PLAUSIBILITY.normalMin : VOL_PLAUSIBILITY.lognormalMin;
  const max = normal ? VOL_PLAUSIBILITY.normalMax : VOL_PLAUSIBILITY.lognormalMax;
  const medianMin = fx ? VOL_PLAUSIBILITY.fxMedianMin : VOL_PLAUSIBILITY.lognormalMedianMin;
  const out: string[] = [];
  const high = finite.filter((v) => v > max);
  const low = finite.filter((v) => v > 0 && v < min);
  const quotation = fx ? "FX" : normal ? "normal" : "lognormal";
  const med = median(finite.filter((v) => v > 0));
  if (normal && med > VOL_PLAUSIBILITY.normalMedianMax) {
    out.push(
      `${VOL_IMPLAUSIBLE_PREFIX} ${path}: median normal vol ${fmtVol(med, true)} is above ${fmtVol(VOL_PLAUSIBILITY.normalMedianMax, true)} – the numbers look like lognormal vols; check the volType of the import`,
    );
  } else if (fx && med > 0 && med < medianMin) {
    out.push(
      `${VOL_IMPLAUSIBLE_PREFIX} ${path}: median FX vol ${fmtVol(med, false)} is below ${fmtVol(medianMin, false)} – FX vols are lognormal decimals (0.08 = 8 %); the numbers look scaled by 1/100, check the scaling of the import (pegged pairs such as EURDKK quote 0.3–1 %)`,
    );
  } else if (!normal && !fx && med > 0 && med < medianMin) {
    out.push(
      `${VOL_IMPLAUSIBLE_PREFIX} ${path}: median lognormal vol ${fmtVol(med, false)} is below ${fmtVol(medianMin, false)} – the numbers look like normal (bp) vols; check the volType of the import`,
    );
  }
  if (high.length) {
    out.push(
      `${VOL_IMPLAUSIBLE_PREFIX} ${path} has ${high.length} of ${finite.length} ${quotation} vols above ${fmtVol(max, normal)} (max ${fmtVol(Math.max(...high), normal)}) – ${fx ? "FX vols are lognormal decimals (0.08 = 8 %); check the scaling of the import" : "check the volType / quotation of the import"}`,
    );
  }
  if (low.length) {
    out.push(
      `${VOL_IMPLAUSIBLE_PREFIX} ${path} has ${low.length} of ${finite.length} ${quotation} vols below ${fmtVol(min, normal)} (min ${fmtVol(Math.min(...low), normal)}) – ${
        fx
          ? "FX vols are lognormal decimals (0.08 = 8 %); check the scaling of the import"
          : normal
            ? "normal vols are decimals of the rate (0.0070 = 70 bp)"
            : "lognormal vols are decimals (0.20 = 20 %); normal numbers on a Lognormal surface collapse option values"
      }`,
    );
  }
  return out;
}

/** Expiry label for smile messages ("1W", "6M", "1Y", "18M", "2.5Y"). */
function expiryLabel(t: number): string {
  const months = t * 12;
  if (t < 1 / 12 - 1e-9) return `${Math.max(1, Math.round(t * 52))}W`;
  if (t < 1 || (months < 24 && Math.abs(months - Math.round(months)) < 1e-9 && Math.round(months) % 12 !== 0)) return `${Math.round(months)}M`;
  return `${Number(t.toFixed(2))}Y`;
}

/**
 * Pillar-vol plausibility of an FX smile (N8-6): per expiry the 25Δ (and 10Δ)
 * put / call pillar vols ATM + BF ∓ RR/2 must be positive – equivalently
 * |RR| ≤ 2·(ATM + BF) – and |RR|, |BF| must stay below `fxSmileMax`. A surface
 * with `rr25 = 0.30` (30 vol points on a 7.55 % ATM) implied a 25Δ put vol of
 * −7.23 % and priced a 1.20 put at 10.81 % instead of 7.85 % without a signal;
 * the pricer now repeats this warning and refuses non-positive pillars
 * (`INVALID_VOL_SURFACE`, `fxVolAtStrike`).
 */
function fxSmilePlausibility(s: FxVolSurface, path: string): string[] {
  const out: string[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(2)} %`;
  const check = (i: number, delta: string, rr: number, bf: number) => {
    const atm = s.atm[i]!;
    const t = expiryLabel(s.expiries[i]!);
    const put = atm + bf - rr / 2;
    const call = atm + bf + rr / 2;
    if (!(put > 0) || !(call > 0)) {
      const side = put <= 0 ? "put" : "call";
      out.push(
        `${VOL_IMPLAUSIBLE_PREFIX} ${path}: ${delta} ${side} pillar vol at ${t} is ${pct(side === "put" ? put : call)} (ATM ${pct(atm)} + BF ${pct(bf)} ${side === "put" ? "−" : "+"} RR ${pct(rr)}/2) – pillar vols must be positive, |RR| ≤ 2·(ATM + BF); smile quotes are vol differences in decimals (0.003 = 0.3 %), check the sign / scaling of the import`,
      );
    } else if (Math.abs(rr) > VOL_PLAUSIBILITY.fxSmileMax || Math.abs(bf) > VOL_PLAUSIBILITY.fxSmileMax) {
      const what = Math.abs(rr) > VOL_PLAUSIBILITY.fxSmileMax ? `risk reversal ${pct(rr)}` : `butterfly ${pct(bf)}`;
      out.push(
        `${VOL_IMPLAUSIBLE_PREFIX} ${path}: ${delta} ${what} at ${t} exceeds ${pct(VOL_PLAUSIBILITY.fxSmileMax)} – smile quotes are vol differences in decimals (0.003 = 0.3 %), check the scaling of the import`,
      );
    }
  };
  s.expiries.forEach((_, i) => {
    check(i, "25Δ", s.rr25[i]!, s.bf25[i]!);
    if (s.rr10 && s.bf10) check(i, "10Δ", s.rr10[i]!, s.bf10[i]!);
  });
  return out;
}

function surfaceVolValues(s: object): { values: number[]; volType: unknown; fx: boolean } {
  const x = s as { atm?: unknown; vols?: unknown; volType?: unknown; tenors?: unknown; strikes?: unknown; pair?: unknown };
  if ("pair" in x) return { values: Array.isArray(x.atm) ? (x.atm as number[]) : [], volType: undefined, fx: true };
  const grid = "strikes" in x ? x.vols : x.atm;
  return { values: Array.isArray(grid) ? ((grid as unknown[]).flat() as number[]) : [], volType: x.volType, fx: false };
}

/**
 * Plausibility warnings (`VOL_IMPLAUSIBLE:`) of the vol surfaces in `input`
 * (Markt R6-4), empty = plausible. Surfaces with structural problems are
 * skipped (report those via `validateVolSurfaces`). Thresholds:
 * `VOL_PLAUSIBILITY`. Meant for `PUT /api/market` / snapshot import to return
 * `warnings[]` next to a 200, and shown by the pricers on every valuation
 * that reads such a surface (`surfaceVolWarnings`).
 */
export function volSurfaceWarnings(input: VolSurfacesInput): string[] {
  const out: string[] = [];
  const each = (coll: Record<string, unknown> | undefined, name: string, problems: (s: unknown, key: string) => string[]) => {
    if (!coll || typeof coll !== "object" || Array.isArray(coll)) return;
    for (const [key, s] of Object.entries(coll)) {
      if (!s || typeof s !== "object" || problems(s, key).length) continue;
      const { values, volType, fx } = surfaceVolValues(s);
      out.push(...implausibleVols(values, volType, `${name}.${key}`, fx));
      if (fx) out.push(...fxSmilePlausibility(s as FxVolSurface, `${name}.${key}`));
    }
  };
  each(input.swaptionVols, "swaptionVols", swaptionSurfaceProblems);
  each(input.capletVols, "capletVols", capletSurfaceProblems);
  each(input.fxVols, "fxVols", fxSurfaceProblems);
  return out;
}

/** Per-surface cache of the plausibility warnings (object identity; surfaces are immutable by convention). */
const plausibility = new WeakMap<object, string[]>();

/**
 * `VOL_IMPLAUSIBLE:` warnings of one surface the pricer is about to read
 * (cached per surface object). The message names the surface by kind and id
 * (`swaption surface EUR-SWAPTION-NORMAL …`).
 */
export function surfaceVolWarnings(s: SwaptionVolSurface | CapletVolSurface | FxVolSurface): string[] {
  let w = plausibility.get(s);
  if (!w) {
    const kind = "pair" in s ? "FX vol surface" : "strikes" in s ? "caplet surface" : "swaption surface";
    const { values, volType, fx } = surfaceVolValues(s);
    w = implausibleVols(values, volType, `${kind} ${s.id}`, fx);
    if (fx && fxSurfaceProblems(s, "", `${kind} ${s.id}`).length === 0) w.push(...fxSmilePlausibility(s as FxVolSurface, `${kind} ${s.id}`));
    plausibility.set(s, w);
  }
  return w;
}

// ---------------------------------------------------------------------------
// Pricing-time guards: a malformed surface raises PricingError("INVALID_VOL_SURFACE"), never a TypeError
// ---------------------------------------------------------------------------

/** Surfaces that already passed their structural check (object identity; immutable by convention). */
const validated = new WeakSet<object>();

function guard(surface: object, problems: (s: unknown) => string[], what: string): void {
  if (validated.has(surface)) return;
  const p = problems(surface);
  if (p.length) {
    const id = (surface as { id?: unknown }).id;
    throw new PricingError("INVALID_VOL_SURFACE", `${what}${typeof id === "string" ? ` ${id}` : ""} is malformed: ${p.join("; ")}`, {
      surfaceId: id,
      problems: p,
    });
  }
  validated.add(surface);
}

/** Assert a swaption cube is structurally usable (cached per surface object). */
export function assertSwaptionSurface(s: SwaptionVolSurface): void {
  guard(s, (x) => swaptionSurfaceProblems(x, "", "swaption surface"), "Swaption vol surface");
}

/** Assert a caplet surface is structurally usable (cached per surface object). */
export function assertCapletSurface(s: CapletVolSurface): void {
  guard(s, (x) => capletSurfaceProblems(x, "", "caplet surface"), "Caplet vol surface");
}

/** Assert an FX vol surface is structurally usable (cached per surface object). */
export function assertFxSurface(s: FxVolSurface): void {
  guard(s, (x) => fxSurfaceProblems(x, "", "FX surface"), "FX vol surface");
}
