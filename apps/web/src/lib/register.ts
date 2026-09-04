import { type RateIndex, SWAP_CONVENTIONS, knownCurrencies, knownIndices } from "@deriva/pricing-core";

/**
 * Currency / index choices derived from the core register and the *current*
 * market (round 7, R7-F2 / R7-02 / Markt R7-1): the quick entry, the trade
 * editor and the market view never hard-code the G5 lists any more – a
 * currency the user introduced with "+ Kurve" (DKK-DESTR, NOK-NOWA, …) shows up
 * everywhere with the same rule: prefer what has a curve in the market.
 */

/** Option of a select: value + German label. */
export interface RegisterOption {
  v: string;
  l: string;
}

/**
 * Default float index of a swap / cap in `ccy` for the given market: the
 * conventions' benchmark index when its curve exists, otherwise the OIS index
 * when *its* curve exists, otherwise any registered index of the currency with
 * a curve; `undefined` when no index of the currency has a curve. Without
 * `curveIds` (market unknown) the conventions decide, as before.
 */
export function defaultIndexFor(ccy: string, curveIds?: readonly string[]): string | undefined {
  const conv = SWAP_CONVENTIONS[ccy.toUpperCase()];
  if (!curveIds) return conv?.floatIndex;
  const has = (name: string | undefined): boolean => {
    if (!name) return false;
    const idx = knownIndices(ccy.toUpperCase()).find((i) => i.name === name);
    return !!idx && curveIds.includes(idx.curveId);
  };
  if (has(conv?.floatIndex)) return conv!.floatIndex;
  if (has(conv?.oisIndex)) return conv!.oisIndex;
  return knownIndices(ccy.toUpperCase()).find((i) => curveIds.includes(i.curveId))?.name;
}

/** Whether `index` (registered) has its projection curve in the market. */
export function indexHasCurve(index: string, curveIds: readonly string[]): boolean {
  const idx = knownIndices().find((i) => i.name === index.toUpperCase());
  return !!idx && curveIds.includes(idx.curveId);
}

/** Registered index definition by name (any case), `undefined` when unknown. */
export function findIndex(name: string): RateIndex | undefined {
  const up = name.toUpperCase();
  return knownIndices().find((i) => i.name === up);
}

/**
 * Normalise a typed index token to its registered name: `euribor3m` / `Euribor-3M` →
 * `EURIBOR-3M`, `nibor6m` → `NIBOR-6M`, `estr` → `ESTR`. Returns `undefined` when no
 * registered index matches (the caller reports the token with the currency's indices).
 */
export function normaliseIndexToken(tok: string): string | undefined {
  const up = tok.toUpperCase().replace(/\s+/g, "");
  if (findIndex(up)) return up;
  const m = /^([A-Z€]+?)-?(\d+[DWMY])$/.exec(up);
  if (m) {
    const cand = `${m[1]}-${m[2]}`;
    if (findIndex(cand)) return cand;
  }
  // "€STR" typed with the euro sign
  if (up === "€STR" && findIndex("ESTR")) return "ESTR";
  return undefined;
}

/** Names of the registered indices of a currency ("NIBOR-3M, NIBOR-6M, NOWA"). */
export function indexNamesOf(ccy: string): string[] {
  return knownIndices(ccy.toUpperCase()).map((i) => i.name);
}

/**
 * Currency options for an editor select: every currency with a discount curve
 * in the market first, then the remaining registered currencies flagged
 * "(ohne Kurve)", plus `current` (always selectable, even when unknown).
 */
export function currencyOptions(discountCurveId: Record<string, string>, current?: string, extra: readonly string[] = []): RegisterOption[] {
  const withCurve = Object.keys(discountCurveId).sort((a, b) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b)));
  const rest = [...new Set([...knownCurrencies(), ...extra])].filter((c) => !withCurve.includes(c)).sort();
  const out: RegisterOption[] = [...withCurve.map((c) => ({ v: c, l: c })), ...rest.map((c) => ({ v: c, l: `${c} (ohne Kurve)` }))];
  if (current && !out.some((o) => o.v === current)) out.push({ v: current, l: `${current} (ohne Kurve)` });
  return out;
}

/**
 * Index options for a float leg / cap / FRA in `ccy`: the registered indices of
 * the currency, those with a curve first, the others flagged "(ohne Kurve)";
 * `current` stays selectable. Without a currency every registered index is listed.
 */
export function indexOptions(ccy: string | undefined, curveIds: readonly string[], current?: string): RegisterOption[] {
  const list = ccy ? knownIndices(ccy.toUpperCase()) : knownIndices();
  const withCurve = list.filter((i) => curveIds.includes(i.curveId));
  const without = list.filter((i) => !curveIds.includes(i.curveId));
  const out: RegisterOption[] = [...withCurve.map((i) => ({ v: i.name, l: i.name })), ...without.map((i) => ({ v: i.name, l: `${i.name} (ohne Kurve)` }))];
  if (current && !out.some((o) => o.v === current)) {
    const known = findIndex(current);
    out.push({ v: current, l: known ? `${current} (ohne Kurve)` : `${current} (nicht registriert)` });
  }
  return out;
}

/** Currencies that occur in the market's FX-spot pairs (for FX products), sorted, EUR first. */
export function fxCurrencies(fxSpots: Record<string, number>, discountCurveId: Record<string, string>, current: readonly string[] = []): string[] {
  const set = new Set<string>(current.filter(Boolean));
  for (const p of Object.keys(fxSpots)) {
    if (/^[A-Z]{6}$/.test(p)) {
      set.add(p.slice(0, 3));
      set.add(p.slice(3));
    }
  }
  for (const c of Object.keys(discountCurveId)) set.add(c);
  return [...set].sort((a, b) => (a === "EUR" ? -1 : b === "EUR" ? 1 : a.localeCompare(b)));
}

/** Currency pairs known to the market (spots and FX-vol surfaces), plus `current`. */
export function knownPairs(fxSpots: Record<string, number>, fxVols: Record<string, unknown> | undefined, current?: string): string[] {
  const set = new Set<string>([...Object.keys(fxSpots), ...Object.keys(fxVols ?? {})].filter((p) => /^[A-Z]{6}$/.test(p)));
  if (current) set.add(current);
  return [...set].sort((a, b) => (a.startsWith("EUR") === b.startsWith("EUR") ? a.localeCompare(b) : a.startsWith("EUR") ? -1 : 1));
}
