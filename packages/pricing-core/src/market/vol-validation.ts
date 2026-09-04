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
