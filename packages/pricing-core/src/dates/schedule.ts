import {
  type BusinessDayConvention,
  type Calendar,
  addBusinessDays,
  adjust,
  getCalendar,
  type CalendarId,
} from "./calendar.js";
import { type SerialDate, addTenor, isEndOfMonth, parseTenor, tenorInMonths, type Tenor } from "./date.js";

export type StubType = "ShortFront" | "LongFront" | "ShortBack" | "LongBack" | "None";

export type Frequency = "1M" | "3M" | "6M" | "12M" | "1Y" | "ZC" | string;

export interface ScheduleParams {
  effectiveDate: SerialDate;
  terminationDate: SerialDate;
  /** Coupon frequency as tenor, e.g. "6M"; "ZC" for a single zero-coupon period. */
  frequency: Frequency;
  calendar: CalendarId | Calendar;
  businessDayConvention?: BusinessDayConvention;
  /** Convention applied to the termination date (defaults to `businessDayConvention`). */
  terminationDateConvention?: BusinessDayConvention;
  stub?: StubType;
  /** Explicit first regular period start (overrides stub logic). */
  firstRegularDate?: SerialDate;
  /** Explicit last regular period end. */
  lastRegularDate?: SerialDate;
  endOfMonth?: boolean;
  /** Payment lag in business days after accrual end (0 for most swaps, 2 for €STR OIS market standard is 1-2). */
  paymentLag?: number;
  /** Fixing lag in business days before accrual start (2 for EURIBOR). */
  fixingLag?: number;
  /** Calendar for fixing dates (defaults to `calendar`). */
  fixingCalendar?: CalendarId | Calendar;
  /** Calendar for payment dates (defaults to `calendar`). */
  paymentCalendar?: CalendarId | Calendar;
}

export interface SchedulePeriod {
  index: number;
  unadjustedStart: SerialDate;
  unadjustedEnd: SerialDate;
  accrualStart: SerialDate;
  accrualEnd: SerialDate;
  paymentDate: SerialDate;
  fixingDate: SerialDate;
  isStub: boolean;
}

export interface Schedule {
  periods: SchedulePeriod[];
  params: ScheduleParams;
}

function frequencyTenor(freq: Frequency): Tenor | null {
  if (freq.toUpperCase() === "ZC" || freq.toUpperCase() === "ONCE") return null;
  const t = parseTenor(freq);
  if (t.n <= 0) throw new Error(`Invalid frequency: ${freq}`);
  return t;
}

/** Generate a schedule of accrual periods with stub handling, following ISDA conventions. */
export function buildSchedule(params: ScheduleParams): Schedule {
  const cal = getCalendar(params.calendar);
  const fixCal = params.fixingCalendar ? getCalendar(params.fixingCalendar) : cal;
  const payCal = params.paymentCalendar ? getCalendar(params.paymentCalendar) : cal;
  const bdc = params.businessDayConvention ?? "ModifiedFollowing";
  const termBdc = params.terminationDateConvention ?? bdc;
  const stub = params.stub ?? "ShortFront";
  const eom = params.endOfMonth ?? false;
  const payLag = params.paymentLag ?? 0;
  const fixLag = params.fixingLag ?? 0;
  const { effectiveDate: start, terminationDate: end } = params;
  if (end <= start) throw new Error("terminationDate must be after effectiveDate");

  const tenor = frequencyTenor(params.frequency);
  let unadjusted: SerialDate[] = [];
  if (tenor === null) {
    unadjusted = [start, end];
  } else if (params.firstRegularDate || params.lastRegularDate) {
    // Explicit stub anchors.
    const first = params.firstRegularDate ?? start;
    const last = params.lastRegularDate ?? end;
    unadjusted.push(start);
    if (first !== start) unadjusted.push(first);
    let d = first;
    let i = 1;
    for (;;) {
      const next = addTenor(first, { n: tenor.n * i, unit: tenor.unit }, eom && isEndOfMonth(first));
      if (next >= last) break;
      unadjusted.push(next);
      d = next;
      i++;
    }
    void d;
    if (last !== unadjusted[unadjusted.length - 1]) unadjusted.push(last);
    if (last !== end) unadjusted.push(end);
  } else if (stub === "ShortFront" || stub === "LongFront") {
    // Roll backwards from termination date.
    const useEom = eom && isEndOfMonth(end);
    const dates: SerialDate[] = [end];
    let i = 1;
    for (;;) {
      const d = addTenor(end, { n: -tenor.n * i, unit: tenor.unit }, useEom);
      if (d <= start) break;
      dates.push(d);
      i++;
    }
    dates.push(start);
    dates.reverse();
    if (stub === "LongFront" && dates.length > 2) {
      // merge first two periods
      dates.splice(1, 1);
    }
    unadjusted = dates;
  } else {
    // ShortBack / LongBack / None: roll forward from effective date.
    const useEom = eom && isEndOfMonth(start);
    const dates: SerialDate[] = [start];
    let i = 1;
    for (;;) {
      const d = addTenor(start, { n: tenor.n * i, unit: tenor.unit }, useEom);
      if (d >= end) break;
      dates.push(d);
      i++;
    }
    dates.push(end);
    if (stub === "LongBack" && dates.length > 2) {
      dates.splice(dates.length - 2, 1);
    }
    if (stub === "None" && dates.length > 1) {
      const lastRegular = addTenor(start, { n: tenor.n * (dates.length - 2), unit: tenor.unit }, useEom);
      const expectedEnd = addTenor(lastRegular, tenor, useEom);
      if (expectedEnd !== end) {
        throw new Error(
          "Schedule with stub=None does not divide evenly; choose a stub type or adjust dates",
        );
      }
    }
    unadjusted = dates;
  }

  // Remove accidental duplicates (e.g. EOM collisions).
  unadjusted = unadjusted.filter((d, i, arr) => i === 0 || d !== arr[i - 1]);

  const periods: SchedulePeriod[] = [];
  const regularMonths = tenor ? tenorInMonths(tenor) : null;
  for (let i = 0; i < unadjusted.length - 1; i++) {
    const uStart = unadjusted[i]!;
    const uEnd = unadjusted[i + 1]!;
    const isLast = i === unadjusted.length - 2;
    const aStart = adjust(uStart, bdc, cal);
    const aEnd = adjust(uEnd, isLast ? termBdc : bdc, cal);
    const payment = payLag === 0 ? adjust(aEnd, bdc, payCal) : addBusinessDays(aEnd, payLag, payCal);
    const fixing = fixLag === 0 ? aStart : addBusinessDays(aStart, -fixLag, fixCal);
    let isStub = false;
    if (regularMonths !== null && tenor) {
      const regularEnd = addTenor(uStart, tenor, eom && isEndOfMonth(uStart));
      isStub = regularEnd !== uEnd;
    }
    periods.push({
      index: i,
      unadjustedStart: uStart,
      unadjustedEnd: uEnd,
      accrualStart: aStart,
      accrualEnd: aEnd,
      paymentDate: payment,
      fixingDate: fixing,
      isStub,
    });
  }
  return { periods, params };
}

export function frequencyPerYear(freq: Frequency): number {
  const t = frequencyTenor(freq);
  if (!t) return 1;
  return 12 / tenorInMonths(t);
}
