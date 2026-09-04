import { toYMD } from "./dates/date.js";

/**
 * Deterministic German number / date formatting without `Intl` (no ICU
 * dependency, identical output in browsers, Node and workers): thousands
 * separator ".", decimal comma, hyphen-minus for negatives.
 */
export function formatDe(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : value < 0 ? "-∞" : "n/a";
  const fixed = Math.abs(value).toFixed(digits);
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return frac !== undefined ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

/** Percentage with a German decimal comma, e.g. formatPctDe(0.0312, 2) → "3,12 %". */
export function formatPctDe(fraction: number, digits = 2): string {
  return `${formatDe(fraction * 100, digits)} %`;
}

/** Serial date → "TT.MM.JJJJ" (deterministic, no Intl). */
export function formatDateDe(serial: number): string {
  if (!Number.isFinite(serial)) return "n/a";
  const { year, month, day } = toYMD(serial);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(day)}.${p(month)}.${year}`;
}

/** ISO timestamp → "dd.mm.yyyy, HH:MM" (UTC, deterministic). */
export function formatDateTimeDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
