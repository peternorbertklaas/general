/**
 * Thin access layer for core exports that land in the same release as this
 * web round (Markt R5-1): `validateVolSurfaces(input): string[]` reports
 * structural problems of swaption / caplet / FX vol surfaces (grid dimensions,
 * finite vols, sorted expiries, `volType`). Until the rebuilt core dist carries
 * the export, the web falls back to a local structural check with the same
 * message vocabulary, so the UI behaviour (and its German translation) does not
 * depend on the build order of the packages.
 */
import * as core from "@deriva/pricing-core";
import type { MarketContext } from "@deriva/pricing-core";

export type VolSurfaceInputs = Pick<MarketContext, "swaptionVols" | "capletVols" | "fxVols">;

type Validator = (input: VolSurfaceInputs) => string[];

const isVec = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === "number");

/** Local fallback with the core's message vocabulary (subset: dimensions, finiteness, sorted expiries, vol type). */
export function localVolSurfaceProblems(input: VolSurfaceInputs): string[] {
  const problems: string[] = [];
  const axis = (path: string, a: unknown): a is number[] => {
    if (!isVec(a) || a.length === 0) {
      problems.push(`${path}: must be a non-empty array of numbers`);
      return false;
    }
    a.forEach((x, i) => {
      if (!Number.isFinite(x)) problems.push(`${path}[${i}]: must be finite`);
      if (i > 0 && !(x > a[i - 1]!)) problems.push(`${path}: not strictly increasing at index ${i} (${a[i - 1]} → ${x})`);
    });
    return true;
  };
  const grid = (path: string, g: unknown, rows: number, cols: number, colName: string) => {
    if (!Array.isArray(g) || !g.every(isVec)) {
      problems.push(`${path}: must be a matrix of numbers`);
      return;
    }
    if (g.length !== rows) problems.push(`${path}: has ${g.length} rows but there are ${rows} expiries`);
    (g as number[][]).forEach((row, i) => {
      if (row.length !== cols) problems.push(`${path}[${i}]: has ${row.length} columns but there are ${cols} ${colName}`);
      row.forEach((x, j) => {
        if (!Number.isFinite(x)) problems.push(`${path}[${i}][${j}]: must be finite`);
        else if (x < 0) problems.push(`${path}[${i}][${j}]: must be ≥ 0`);
      });
    });
  };
  const vector = (path: string, v: unknown, n: number) => {
    if (!isVec(v)) {
      problems.push(`${path}: must be an array of numbers`);
      return;
    }
    if (v.length !== n) problems.push(`${path}: has ${v.length} entries but there are ${n} expiries`);
    v.forEach((x, i) => {
      if (!Number.isFinite(x)) problems.push(`${path}[${i}]: must be finite`);
    });
  };
  const volType = (path: string, t: unknown) => {
    if (t !== undefined && t !== "Normal" && t !== "Lognormal" && t !== "ShiftedLognormal")
      problems.push(`${path}.volType: unknown vol type ${JSON.stringify(t)}`);
  };
  for (const [key, s] of Object.entries(input.swaptionVols ?? {})) {
    const path = `swaptionVols.${key}`;
    if (!s || typeof s !== "object") {
      problems.push(`${path}: must be an object`);
      continue;
    }
    volType(path, s.volType);
    const okE = axis(`${path}.expiries`, s.expiries);
    const okT = axis(`${path}.tenors`, s.tenors);
    if (okE && okT) grid(`${path}.atm`, s.atm, s.expiries.length, s.tenors.length, "tenors");
  }
  for (const [key, c] of Object.entries(input.capletVols ?? {})) {
    const path = `capletVols.${key}`;
    if (!c || typeof c !== "object") {
      problems.push(`${path}: must be an object`);
      continue;
    }
    volType(path, c.volType);
    const okE = axis(`${path}.expiries`, c.expiries);
    const okK = isVec(c.strikes) && c.strikes.length > 0;
    if (!okK) problems.push(`${path}.strikes: must be a non-empty array of numbers`);
    if (okE && okK) grid(`${path}.vols`, c.vols, c.expiries.length, c.strikes.length, "strikes");
  }
  for (const [key, f] of Object.entries(input.fxVols ?? {})) {
    const path = `fxVols.${key}`;
    if (!f || typeof f !== "object") {
      problems.push(`${path}: must be an object`);
      continue;
    }
    if (!axis(`${path}.expiries`, f.expiries)) continue;
    const n = f.expiries.length;
    vector(`${path}.atm`, f.atm, n);
    if (f.rr25 !== undefined) vector(`${path}.rr25`, f.rr25, n);
    if (f.bf25 !== undefined) vector(`${path}.bf25`, f.bf25, n);
    if (f.rr10 !== undefined) vector(`${path}.rr10`, f.rr10, n);
    if (f.bf10 !== undefined) vector(`${path}.bf10`, f.bf10, n);
  }
  return problems;
}

const coreValidator = (core as unknown as { validateVolSurfaces?: Validator }).validateVolSurfaces;

/** Structural problems of the given vol surfaces – core validator when available, local fallback otherwise. */
export const validateVolSurfaces: Validator = (input) => {
  if (typeof coreValidator === "function") {
    try {
      return coreValidator(input);
    } catch {
      /* fall through to the local check */
    }
  }
  return localVolSurfaceProblems(input);
};

/** Whether the core itself ships `validateVolSurfaces` (informational, for tests). */
export const coreHasVolSurfaceValidator = typeof coreValidator === "function";
