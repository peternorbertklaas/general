import { type SerialDate, fromYMD, isLeapYear, toYMD, daysInMonth } from "./date.js";

export type DayCountConvention =
  | "ACT/360"
  | "ACT/365F"
  | "ACT/365"
  | "ACT/ACT"
  | "ACT/ACT ISDA"
  | "ACT/ACT ICMA"
  | "30/360"
  | "30U/360"
  | "30E/360"
  | "30E/360 ISDA"
  | "1/1"
  | "BUS/252";

export interface YearFractionContext {
  /** Reference period start (for ACT/ACT ICMA). */
  refStart?: SerialDate;
  /** Reference period end (for ACT/ACT ICMA). */
  refEnd?: SerialDate;
  /** Coupons per year (for ACT/ACT ICMA). */
  frequency?: number;
  /** True when `end` is the final maturity date (30E/360 ISDA). */
  isMaturity?: boolean;
  /** Business day counter for BUS/252. */
  businessDays?: (from: SerialDate, to: SerialDate) => number;
}

export function normalizeDayCount(dc: string): DayCountConvention {
  const u = dc.trim().toUpperCase().replace(/\s+/g, " ");
  switch (u) {
    case "ACT/360":
    case "A/360":
    case "ACTUAL/360":
      return "ACT/360";
    case "ACT/365":
    case "ACT/365F":
    case "ACT/365 FIXED":
    case "A/365F":
    case "ACTUAL/365":
      return "ACT/365F";
    case "ACT/ACT":
    case "ACT/ACT ISDA":
    case "ACTUAL/ACTUAL":
      return "ACT/ACT ISDA";
    case "ACT/ACT ICMA":
    case "ACT/ACT ISMA":
      return "ACT/ACT ICMA";
    case "30/360":
    case "30U/360":
    case "30/360 US":
    case "BOND BASIS":
      return "30/360";
    case "30E/360":
    case "EUROBOND":
      return "30E/360";
    case "30E/360 ISDA":
      return "30E/360 ISDA";
    case "1/1":
      return "1/1";
    case "BUS/252":
      return "BUS/252";
    default:
      throw new Error(`Unknown day count convention: ${dc}`);
  }
}

export function dayCount(start: SerialDate, end: SerialDate, dc: DayCountConvention): number {
  const c = normalizeDayCount(dc);
  switch (c) {
    case "ACT/360":
    case "ACT/365F":
    case "ACT/ACT ISDA":
    case "ACT/ACT ICMA":
    case "1/1":
    case "BUS/252":
      return end - start;
    case "30/360": {
      const s = toYMD(start);
      const e = toYMD(end);
      let d1 = s.day;
      let d2 = e.day;
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 === 30) d2 = 30;
      return 360 * (e.year - s.year) + 30 * (e.month - s.month) + (d2 - d1);
    }
    case "30E/360": {
      const s = toYMD(start);
      const e = toYMD(end);
      const d1 = Math.min(s.day, 30);
      const d2 = Math.min(e.day, 30);
      return 360 * (e.year - s.year) + 30 * (e.month - s.month) + (d2 - d1);
    }
    case "30E/360 ISDA": {
      const s = toYMD(start);
      const e = toYMD(end);
      const d1 = s.day === daysInMonth(s.year, s.month) ? 30 : s.day;
      const d2 = e.day === daysInMonth(e.year, e.month) && e.month !== 2 ? 30 : e.day;
      return 360 * (e.year - s.year) + 30 * (e.month - s.month) + (d2 - d1);
    }
    default:
      return end - start;
  }
}

export function yearFraction(
  start: SerialDate,
  end: SerialDate,
  dc: DayCountConvention | string,
  ctx: YearFractionContext = {},
): number {
  if (end < start) return -yearFraction(end, start, dc, ctx);
  const c = normalizeDayCount(dc);
  switch (c) {
    case "ACT/360":
      return (end - start) / 360;
    case "ACT/365F":
      return (end - start) / 365;
    case "30/360":
    case "30E/360":
      return dayCount(start, end, c) / 360;
    case "30E/360 ISDA": {
      const s = toYMD(start);
      const e = toYMD(end);
      const d1 = s.day === daysInMonth(s.year, s.month) ? 30 : s.day;
      const d2 =
        e.day === daysInMonth(e.year, e.month) && !(e.month === 2 && ctx.isMaturity) ? 30 : e.day;
      return (360 * (e.year - s.year) + 30 * (e.month - s.month) + (d2 - d1)) / 360;
    }
    case "1/1":
      return 1;
    case "ACT/ACT ISDA": {
      const s = toYMD(start);
      const e = toYMD(end);
      if (s.year === e.year) return (end - start) / (isLeapYear(s.year) ? 366 : 365);
      let sum = (fromYMD(s.year + 1, 1, 1) - start) / (isLeapYear(s.year) ? 366 : 365);
      sum += e.year - s.year - 1;
      sum += (end - fromYMD(e.year, 1, 1)) / (isLeapYear(e.year) ? 366 : 365);
      return sum;
    }
    case "ACT/ACT ICMA": {
      const refStart = ctx.refStart ?? start;
      const refEnd = ctx.refEnd ?? end;
      const freq = ctx.frequency ?? 1;
      const refLen = refEnd - refStart;
      if (refLen <= 0) return (end - start) / 365;
      return (end - start) / (freq * refLen);
    }
    case "BUS/252": {
      if (!ctx.businessDays) throw new Error("BUS/252 requires a business-day counter");
      return ctx.businessDays(start, end) / 252;
    }
    default:
      return (end - start) / 365;
  }
}
