import { type SerialDate, addMonths, fromYMD, isEndOfMonth, isLeapYear, toYMD, daysInMonth } from "./date.js";

export type DayCountConvention =
  "ACT/360" | "ACT/365F" | "ACT/365" | "ACT/ACT" | "ACT/ACT ISDA" | "ACT/ACT ICMA" | "30/360" | "30U/360" | "30E/360" | "30E/360 ISDA" | "1/1" | "BUS/252";

export interface YearFractionContext {
  /** Reference (regular coupon) period start for ACT/ACT ICMA. Defaults to `start`. */
  refStart?: SerialDate;
  /** Reference (regular coupon) period end for ACT/ACT ICMA. Defaults to `end`. */
  refEnd?: SerialDate;
  /**
   * Coupons per year for ACT/ACT ICMA. When omitted it is inferred from the
   * length of the reference period (rounded to whole months).
   */
  frequency?: number;
  /**
   * End-of-month roll of the coupon schedule (ACT/ACT ICMA): notional periods
   * for stubs are rolled with the EOM rule (ISDA 2006 4.16(c) example: reference
   * period 30.11.1999–29.02.2000 → next notional period ends 31.05.2000). When
   * omitted it is inferred from the reference period (both ends on a month end).
   */
  endOfMonth?: boolean;
  /** True when `end` is the final maturity date (30E/360 ISDA: February end is then not set to 30). */
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
    case "BOND BASIS":
      return "30/360";
    case "30U/360":
    case "30/360 US":
      return "30U/360";
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

function isLastDayOfFebruary(d: { year: number; month: number; day: number }): boolean {
  return d.month === 2 && d.day === daysInMonth(d.year, 2);
}

function thirty360(s: { year: number; month: number; day: number }, e: { year: number; month: number; day: number }, d1: number, d2: number): number {
  return 360 * (e.year - s.year) + 30 * (e.month - s.month) + (d2 - d1);
}

/**
 * Day count (numerator) between two dates. `ctx.isMaturity` is honoured for
 * 30E/360 ISDA (consistent with `yearFraction`).
 */
export function dayCount(start: SerialDate, end: SerialDate, dc: DayCountConvention, ctx: YearFractionContext = {}): number {
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
      // ISDA 2006 4.16(f) "30/360" (Bond Basis): no February rule.
      const s = toYMD(start);
      const e = toYMD(end);
      let d1 = s.day;
      let d2 = e.day;
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 === 30) d2 = 30;
      return thirty360(s, e, d1, d2);
    }
    case "30U/360": {
      // 30/360 US (SIA / QuantLib Thirty360::USA) with the end-of-February rule.
      const s = toYMD(start);
      const e = toYMD(end);
      let d1 = s.day;
      let d2 = e.day;
      if (isLastDayOfFebruary(s) && isLastDayOfFebruary(e)) d2 = 30;
      if (isLastDayOfFebruary(s)) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
      if (d1 === 31) d1 = 30;
      return thirty360(s, e, d1, d2);
    }
    case "30E/360": {
      const s = toYMD(start);
      const e = toYMD(end);
      return thirty360(s, e, Math.min(s.day, 30), Math.min(e.day, 30));
    }
    case "30E/360 ISDA": {
      const s = toYMD(start);
      const e = toYMD(end);
      const d1 = s.day === daysInMonth(s.year, s.month) ? 30 : s.day;
      const d2 = e.day === daysInMonth(e.year, e.month) && !(e.month === 2 && ctx.isMaturity) ? 30 : e.day;
      return thirty360(s, e, d1, d2);
    }
    default:
      return end - start;
  }
}

/**
 * ACT/ACT (ICMA / ISMA, ISDA 2006 4.16(c)): days in the calculation period
 * divided by (coupons per year × days in the regular coupon period). For
 * stubs the ISMA "notional period" rule is applied (QuantLib algorithm):
 * the stub is split across the actual reference period and notional periods
 * of the same length before/after it.
 */
function actActIcma(start: SerialDate, end: SerialDate, ctx: YearFractionContext): number {
  if (end <= start) return 0;
  let refStart = ctx.refStart ?? start;
  let refEnd = ctx.refEnd ?? end;
  if (refEnd <= refStart) {
    refStart = start;
    refEnd = end;
  }
  // Length of a regular period in whole months: from the frequency when given, else inferred.
  const months = ctx.frequency && ctx.frequency > 0 ? Math.max(1, Math.round(12 / ctx.frequency)) : Math.max(1, Math.round((12 * (refEnd - refStart)) / 365));
  const period = months / 12;
  const freq = 12 / months;
  // EOM rule for the notional periods: explicit from the schedule, else inferred
  // when the reference period itself rolls on month ends.
  const eom = ctx.endOfMonth ?? (isEndOfMonth(refStart) && isEndOfMonth(refEnd));
  if (end <= refEnd) {
    if (start >= refStart) return (period * (end - start)) / (refEnd - refStart);
    // Start before the reference period (long front stub): notional period before refStart.
    const previousRef = addMonths(refStart, -months, eom);
    if (end > refStart) {
      return (
        actActIcma(start, refStart, { refStart: previousRef, refEnd: refStart, frequency: freq, endOfMonth: eom }) +
        actActIcma(refStart, end, { refStart, refEnd, frequency: freq, endOfMonth: eom })
      );
    }
    return actActIcma(start, end, { refStart: previousRef, refEnd: refStart, frequency: freq, endOfMonth: eom });
  }
  // End beyond the reference period (long back stub): notional periods after refEnd.
  let sum = actActIcma(start, refEnd, { refStart, refEnd, frequency: freq, endOfMonth: eom });
  for (let i = 0; i < 1200; i++) {
    const newRefStart = addMonths(refEnd, months * i, eom);
    const newRefEnd = addMonths(refEnd, months * (i + 1), eom);
    if (end < newRefEnd) {
      sum += (period * (end - newRefStart)) / (newRefEnd - newRefStart);
      break;
    }
    sum += period;
  }
  return sum;
}

export function yearFraction(start: SerialDate, end: SerialDate, dc: DayCountConvention | string, ctx: YearFractionContext = {}): number {
  if (end < start) return -yearFraction(end, start, dc, ctx);
  const c = normalizeDayCount(dc);
  switch (c) {
    case "ACT/360":
      return (end - start) / 360;
    case "ACT/365F":
      return (end - start) / 365;
    case "30/360":
    case "30U/360":
    case "30E/360":
    case "30E/360 ISDA":
      return dayCount(start, end, c, ctx) / 360;
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
    case "ACT/ACT ICMA":
      return actActIcma(start, end, ctx);
    case "BUS/252": {
      if (!ctx.businessDays) throw new Error("BUS/252 requires a business-day counter");
      return ctx.businessDays(start, end) / 252;
    }
    default:
      return (end - start) / 365;
  }
}
