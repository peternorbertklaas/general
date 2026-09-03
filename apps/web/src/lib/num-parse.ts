/**
 * Parsing/formatting for numeric inputs (German locale + trader shorthand).
 *
 *  - decimal comma or point ("3,1", "3.1"), thousands points ("10.000.000")
 *  - shorthand multipliers: 10m / 10mio = 10 Mio, 250k, 1mrd / 1bn
 *  - unit suffixes: "25bp" → 0.0025 (decimal), "3,1%" → 0.031 (decimal)
 */
export interface ParsedNumber {
  /** Value in the stored (unscaled) unit. */
  value: number;
  /** Which suffix was used, if any. */
  unit?: "bp" | "%" | "k" | "m" | "mrd";
}

const NUMBER_RE = /^\s*([+-]?)\s*([0-9][0-9.,]*|[.,][0-9]+)\s*(k|m|mio|mrd|bn|b|bp|%)?\s*$/i;

/** Normalise "1.234,5" / "1,234.5" / "1234.5" / "1234,5" into a JS float string. */
export function normaliseDecimal(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // The last separator is the decimal separator; the other one groups thousands.
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    return lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  }
  if (hasComma) {
    // several commas → thousands grouping (rare) else decimal comma
    return s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  if (hasDot) {
    // "10.000.000" or "1.000" (exactly three digits after each dot) → thousands grouping
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return s.replace(/\./g, "");
    return s.split(".").length > 2 ? s.replace(/\./g, "") : s;
  }
  return s;
}

/**
 * Parse user text into the stored value. `scale` is the display scale of the
 * field (100 for percent fields, 1e4 for bp fields, 1 for amounts): plain
 * numbers are divided by it, explicit unit suffixes override it.
 */
export function parseNumberInput(text: string, scale = 1): ParsedNumber | undefined {
  const m = NUMBER_RE.exec(text);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  const norm = normaliseDecimal(m[2]!);
  if (norm === undefined) return undefined;
  const n = Number(norm);
  if (!Number.isFinite(n)) return undefined;
  const suffix = (m[3] ?? "").toLowerCase();
  switch (suffix) {
    case "k":
      return { value: (sign * n * 1e3) / scale, unit: "k" };
    case "m":
    case "mio":
      return { value: (sign * n * 1e6) / scale, unit: "m" };
    case "mrd":
    case "bn":
    case "b":
      return { value: (sign * n * 1e9) / scale, unit: "mrd" };
    case "bp":
      return { value: (sign * n) / 1e4, unit: "bp" };
    case "%":
      return { value: (sign * n) / 100, unit: "%" };
    default:
      return { value: (sign * n) / scale };
  }
}

/** Whether the text is an incomplete but valid prefix ("-", "3,", "1.") that must not be rejected while typing. */
export function isNumberPrefix(text: string): boolean {
  return /^\s*[+-]?[0-9.,]*\s*(k|m|mio|mrd|bn|b|bp|%)?\s*$/i.test(text);
}

/** Display formatting of a stored value in the field's display scale (de-DE, up to `maxDigits`, no trailing zeros beyond `minDigits`). */
export function formatNumberInput(value: number | undefined, scale = 1, minDigits = 0, maxDigits = 6): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  const shown = value * scale;
  const rounded = Number(shown.toFixed(maxDigits));
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits, useGrouping: true }).format(
    Object.is(rounded, -0) ? 0 : rounded,
  );
}

/** Number of decimals implied by a step (0.005 → 3). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = step.toString();
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}
