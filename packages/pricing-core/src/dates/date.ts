/**
 * Date arithmetic on a compact serial representation.
 *
 * A `SerialDate` is the integer number of days since 1970-01-01 (UTC). This
 * avoids all timezone/DST pitfalls of JS `Date` and makes comparisons and
 * differences trivial integer arithmetic.
 */
import { PricingError } from "../errors.js";

export type SerialDate = number;

export type TenorUnit = "D" | "W" | "M" | "Y";

export interface Tenor {
  n: number;
  unit: TenorUnit;
}

const MS_PER_DAY = 86_400_000;

/** True for a usable serial date: a finite integer number of days (N10-4). */
export function isSerialDate(d: unknown): d is SerialDate {
  return typeof d === "number" && Number.isInteger(d);
}

/**
 * Guard of every exported date / calendar function (Quant R10 N10-4): a
 * `NaN`, `undefined`, `Infinity` or fractional "date" throws
 * `PricingError("INVALID_DATE")` naming the argument instead of looping
 * forever in a business-day search (`addBusinessDays(NaN, …)`,
 * `adjust(NaN, …)`, `advance(NaN, "6M")`, `makeFra({ start: undefined })`
 * hung the process until round 10) or returning `NaN` arithmetic silently.
 * `what` names the argument in the message (`details.input` carries the value).
 */
export function assertSerialDate(d: unknown, what = "date"): asserts d is SerialDate {
  if (!isSerialDate(d)) {
    throw new PricingError("INVALID_DATE", `${what} must be a serial date (integer days since 1970-01-01), got ${String(d)}`, { what, input: d });
  }
}

export function fromYMD(year: number, month: number, day: number): SerialDate {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function toYMD(d: SerialDate): { year: number; month: number; day: number } {
  assertSerialDate(d);
  const dt = new Date(d * MS_PER_DAY);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/**
 * Parse `YYYY-MM-DD` (a trailing time part is ignored). Throws
 * `PricingError("INVALID_DATE")` for a malformed string or a day that does not
 * exist in the calendar (`2027-02-30`) – a client-input error (N4-03).
 */
export function parseISO(iso: string): SerialDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) throw new PricingError("INVALID_DATE", `Invalid ISO date: ${iso}`, { input: iso });
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw new PricingError("INVALID_DATE", `Invalid date: ${iso}`, { input: iso });
  return fromYMD(y, mo, d);
}

export function toISO(d: SerialDate): string {
  assertSerialDate(d);
  const { year, month, day } = toYMD(d);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(d: SerialDate): number {
  assertSerialDate(d);
  return ((d % 7) + 11) % 7; // 1970-01-01 was a Thursday (4)
}

export function isWeekend(d: SerialDate): boolean {
  const w = dayOfWeek(d);
  return w === 0 || w === 6;
}

export function addDays(d: SerialDate, n: number): SerialDate {
  assertSerialDate(d);
  if (!Number.isInteger(n)) throw new PricingError("INVALID_DATE", `addDays: n must be an integer number of days, got ${String(n)}`, { input: n });
  return d + n;
}

export function addMonths(d: SerialDate, n: number, endOfMonth = false): SerialDate {
  assertSerialDate(d);
  if (!Number.isInteger(n)) throw new PricingError("INVALID_DATE", `addMonths: n must be an integer number of months, got ${String(n)}`, { input: n });
  const { year, month, day } = toYMD(d);
  const total = year * 12 + (month - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = daysInMonth(ny, nm);
  const nd = endOfMonth && day === daysInMonth(year, month) ? dim : Math.min(day, dim);
  return fromYMD(ny, nm, nd);
}

export function addYears(d: SerialDate, n: number, endOfMonth = false): SerialDate {
  return addMonths(d, 12 * n, endOfMonth);
}

export function endOfMonth(d: SerialDate): SerialDate {
  const { year, month } = toYMD(d);
  return fromYMD(year, month, daysInMonth(year, month));
}

export function isEndOfMonth(d: SerialDate): boolean {
  return endOfMonth(d) === d;
}

/**
 * Parse a tenor string. Money-market aliases are mapped to business-day
 * tenors from today: ON = 1D, TN = 2D (tomorrow → next), SN = 3D (spot →
 * next, assuming a T+2 spot lag; for T+0/T+1 currencies pass the explicit
 * day count instead). Throws `PricingError("INVALID_TENOR")` otherwise (N4-03).
 */
export function parseTenor(t: string | Tenor): Tenor {
  if (typeof t !== "string") return t;
  const m = /^\s*(-?\d+)\s*([DdWwMmYy])\s*$/.exec(t);
  if (!m) {
    if (/^\s*(ON|O\/N)\s*$/i.test(t)) return { n: 1, unit: "D" };
    if (/^\s*(TN|T\/N)\s*$/i.test(t)) return { n: 2, unit: "D" };
    if (/^\s*(SN|S\/N)\s*$/i.test(t)) return { n: 3, unit: "D" };
    throw new PricingError("INVALID_TENOR", `Invalid tenor: ${t}`, { input: t });
  }
  return { n: Number(m[1]), unit: m[2]!.toUpperCase() as TenorUnit };
}

export function tenorToString(t: Tenor): string {
  return `${t.n}${t.unit}`;
}

/** Approximate tenor length in months (weeks/days mapped fractional). */
export function tenorInMonths(t: Tenor): number {
  switch (t.unit) {
    case "D":
      return t.n / 30.4375;
    case "W":
      return (t.n * 7) / 30.4375;
    case "M":
      return t.n;
    case "Y":
      return t.n * 12;
  }
}

export function addTenor(d: SerialDate, tenor: string | Tenor, endOfMonth = false): SerialDate {
  assertSerialDate(d);
  const t = parseTenor(tenor);
  switch (t.unit) {
    case "D":
      return addDays(d, t.n);
    case "W":
      return addDays(d, 7 * t.n);
    case "M":
      return addMonths(d, t.n, endOfMonth);
    case "Y":
      return addYears(d, t.n, endOfMonth);
  }
}

/** Compare helper (a < b → negative). */
export function compareDates(a: SerialDate, b: SerialDate): number {
  return a - b;
}

export function today(): SerialDate {
  return Math.floor(Date.now() / MS_PER_DAY);
}

/** Third Wednesday of the given month (IMM date). */
export function immDate(year: number, month: number): SerialDate {
  const first = fromYMD(year, month, 1);
  const w = dayOfWeek(first);
  const offset = (3 - w + 7) % 7;
  return first + offset + 14;
}

/** Next IMM date strictly after `d` on the Mar/Jun/Sep/Dec cycle. */
export function nextImmDate(d: SerialDate): SerialDate {
  assertSerialDate(d);
  let { year, month } = toYMD(d);
  for (let i = 0; i < 15; i++) {
    if (month % 3 === 0) {
      const imm = immDate(year, month);
      if (imm > d) return imm;
    }
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  throw new PricingError("INVALID_DATE", "nextImmDate: not found");
}
