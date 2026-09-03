import { toISO } from "@deriva/pricing-core";

/**
 * The single number formatter set of the UI: every number is rendered with
 * `Intl.NumberFormat("de-DE")` (decimal comma, thousands point). Views must
 * not call `toFixed` directly.
 */
const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}|${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

function clean(v: number, digits: number): number {
  // Avoid "-0" artefacts from tiny negative values and from Object.is(v, -0).
  const threshold = 0.5 * Math.pow(10, -digits);
  return Math.abs(v) < threshold || Object.is(v, -0) ? 0 : v;
}

/** Fixed number of decimals, de-DE. */
export function fmtNum(v: number | undefined | null, digits = 4): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return nf(digits, digits).format(clean(v, digits));
}

export function fmtMoney(v: number | undefined | null, ccy?: string, digits: 0 | 2 = 0): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  const s = fmtNum(v, digits);
  return ccy ? `${s} ${ccy}` : s;
}

/** Decimal rate → "2,6975 %". */
export function fmtPct(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return `${fmtNum(v * 100, digits)} %`;
}

/** Decimal rate → "10,3 bp". */
export function fmtBp(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return `${fmtNum(v * 1e4, digits)} bp`;
}

/** Signed value with explicit "+" for positives (e.g. what-if shifts). */
export function fmtSigned(v: number, digits = 0, unit = ""): string {
  const s = fmtNum(v, digits);
  const out = v > 0 ? `+${s}` : s;
  return unit ? `${out} ${unit}` : out;
}

export function fmtDate(d: number | undefined): string {
  if (d === undefined || !Number.isFinite(d)) return "–";
  const iso = toISO(d);
  const [y, m, day] = iso.split("-");
  return `${day}.${m}.${y}`;
}

/** Compact money: 1,25 Mio · 850,0 Tsd · 1,20 Mrd. */
export function fmtCompact(v: number, ccy?: string): string {
  if (!Number.isFinite(v)) return "–";
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1e9) s = `${fmtNum(v / 1e9, 2)} Mrd`;
  else if (abs >= 1e6) s = `${fmtNum(v / 1e6, 2)} Mio`;
  else if (abs >= 1e3) s = `${fmtNum(v / 1e3, 1)} Tsd`;
  else s = fmtNum(v, 0);
  return ccy ? `${s} ${ccy}` : s;
}

/** Years → "7,79 J". */
export function fmtYears(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return `${fmtNum(v, 2)} J`;
}

/** Milliseconds → "3,0 ms". */
export function fmtMs(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "–";
  return `${fmtNum(v, digits)} ms`;
}

/**
 * CSS class for the sign of a value. The default threshold (0.5) matches
 * `fmtMoney` with 0 decimals so a grey "0" never sits next to a green "0".
 * Pass a smaller `eps` for rates/percentages (e.g. `1e-9`).
 */
export function signClass(v: number | undefined | null, eps = 0.5): string {
  if (v === undefined || v === null || !Number.isFinite(v) || Math.abs(v) < eps) return "";
  return v > 0 ? "pos" : "neg";
}
