import { PricingError } from "../errors.js";
import { type BusinessDayConvention, type Calendar, addBusinessDays, adjust, getCalendar, type CalendarId } from "./calendar.js";
import { type SerialDate, addTenor, immDate, isEndOfMonth, parseTenor, tenorInMonths, toYMD, type Tenor } from "./date.js";

/**
 * Upper bound on the number of accrual periods of one schedule (N3-01). A
 * 100Y leg with daily coupons would otherwise produce 36 525 cashflows per
 * leg and block the event loop of an API for seconds; `buildSchedule` raises
 * `PricingError("TOO_MANY_PERIODS")` beyond the bound. Override per schedule
 * with `ScheduleParams.maxPeriods` when a caller really needs more.
 */
export const MAX_PERIODS = 1200;

export type StubType = "ShortFront" | "LongFront" | "ShortBack" | "LongBack" | "None";

export type Frequency = "1M" | "3M" | "6M" | "12M" | "1Y" | "ZC" | string;

/** Roll convention for the unadjusted dates: default (from effective/termination date) or IMM dates (third Wednesday). */
export type RollConvention = "Default" | "IMM";

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
  /**
   * "IMM": unadjusted period dates are the IMM dates (third Wednesday) of the
   * months `effectiveDate + i × frequency`, rolled forward from the effective
   * date (IMM swaps / futures-matched schedules). Default: roll from the dates.
   */
  roll?: RollConvention;
  /** Payment lag in business days after accrual end (0 for most swaps, 2 for €STR OIS market standard is 1-2). */
  paymentLag?: number;
  /** Fixing lag in business days before accrual start (2 for EURIBOR). */
  fixingLag?: number;
  /** Calendar for fixing dates (defaults to `calendar`). */
  fixingCalendar?: CalendarId | Calendar;
  /** Calendar for payment dates (defaults to `calendar`). */
  paymentCalendar?: CalendarId | Calendar;
  /** Maximum number of periods before `TOO_MANY_PERIODS` is raised (default `MAX_PERIODS`). */
  maxPeriods?: number;
}

export interface SchedulePeriod {
  index: number;
  unadjustedStart: SerialDate;
  unadjustedEnd: SerialDate;
  accrualStart: SerialDate;
  accrualEnd: SerialDate;
  paymentDate: SerialDate;
  fixingDate: SerialDate;
  /** True for a front or back stub period (a period that is not a regular tenor period). */
  isStub: boolean;
}

export interface Schedule {
  periods: SchedulePeriod[];
  params: ScheduleParams;
}

/** Tenor of a coupon frequency; "ZC"/"ONCE" → null. Invalid strings raise `PricingError("INVALID_FREQUENCY")` (R3-4). */
function frequencyTenor(freq: Frequency): Tenor | null {
  if (typeof freq !== "string") throw new PricingError("INVALID_FREQUENCY", `Invalid frequency: ${String(freq)}`, { frequency: freq });
  if (freq.toUpperCase() === "ZC" || freq.toUpperCase() === "ONCE") return null;
  let t: Tenor;
  try {
    t = parseTenor(freq);
  } catch {
    throw new PricingError("INVALID_FREQUENCY", `Invalid frequency: ${freq} (expected a tenor like "3M", "6M", "1Y" or "ZC")`, { frequency: freq });
  }
  if (t.n <= 0) throw new PricingError("INVALID_FREQUENCY", `Invalid frequency: ${freq} (tenor must be positive)`, { frequency: freq });
  return t;
}

/**
 * Upper estimate of the number of periods a schedule will have (calendar
 * length / tenor length, rounded up) – used to reject oversized schedules
 * before any date is generated.
 */
export function estimatePeriodCount(effectiveDate: SerialDate, terminationDate: SerialDate, frequency: Frequency): number {
  const t = frequencyTenor(frequency);
  if (!t) return 1;
  const months = tenorInMonths(t);
  return Math.max(1, Math.ceil((terminationDate - effectiveDate) / 30.4375 / months + 1));
}

/** IMM date (third Wednesday) of the month containing `d`. */
function immDateOfMonth(d: SerialDate): SerialDate {
  const { year, month } = toYMD(d);
  return immDate(year, month);
}

/**
 * Generate a schedule of accrual periods with stub handling, following ISDA
 * conventions. Long stubs are only created when the schedule does not divide
 * evenly (otherwise a LongFront/LongBack request yields a regular schedule).
 * `isStub` is set by position: only the first (front stub) or last (back
 * stub) period can be a stub.
 */
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
  if (end <= start) throw new PricingError("INVALID_TRADE", "terminationDate must be after effectiveDate", { effectiveDate: start, terminationDate: end });

  const tenor = frequencyTenor(params.frequency);
  const maxPeriods = params.maxPeriods ?? MAX_PERIODS;
  // Cheap bound before any date arithmetic: a 1D × 100Y leg is rejected in microseconds (N3-01).
  const estimate = estimatePeriodCount(start, end, params.frequency);
  if (estimate > maxPeriods * 1.05 + 2) throw tooManyPeriods(estimate, maxPeriods, params.frequency);
  let unadjusted: SerialDate[] = [];
  let firstStub = false;
  let lastStub = false;
  if (tenor === null) {
    unadjusted = [start, end];
  } else if (params.roll === "IMM") {
    // IMM roll: dates are the third Wednesdays of the months start + i × tenor.
    const dates: SerialDate[] = [start];
    for (let i = 1; i < 10_000; i++) {
      const d = immDateOfMonth(addTenor(start, { n: tenor.n * i, unit: tenor.unit }));
      if (d >= end) break;
      dates.push(d);
    }
    dates.push(end);
    firstStub = start !== immDateOfMonth(start);
    lastStub = end !== immDateOfMonth(end);
    unadjusted = dates;
  } else if (params.firstRegularDate || params.lastRegularDate) {
    // Explicit stub anchors.
    const first = params.firstRegularDate ?? start;
    const last = params.lastRegularDate ?? end;
    unadjusted.push(start);
    if (first !== start) unadjusted.push(first);
    let i = 1;
    for (;;) {
      const next = addTenor(first, { n: tenor.n * i, unit: tenor.unit }, eom && isEndOfMonth(first));
      if (next >= last) break;
      unadjusted.push(next);
      i++;
    }
    if (last !== unadjusted[unadjusted.length - 1]) unadjusted.push(last);
    if (last !== end) unadjusted.push(end);
    firstStub = first !== start;
    lastStub = last !== end;
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
    // The first period is regular when rolling one more tenor back from the
    // first regular date lands exactly on the effective date.
    const firstIsRegular = addTenor(end, { n: -tenor.n * (dates.length - 1), unit: tenor.unit }, useEom) === start;
    if (stub === "LongFront" && !firstIsRegular && dates.length > 2) {
      // merge the short stub with the first regular period
      dates.splice(1, 1);
    }
    firstStub = !firstIsRegular;
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
    const lastIsRegular = addTenor(start, { n: tenor.n * (dates.length - 1), unit: tenor.unit }, useEom) === end;
    if (stub === "LongBack" && !lastIsRegular && dates.length > 2) {
      dates.splice(dates.length - 2, 1);
    }
    if (stub === "None" && !lastIsRegular) {
      throw new PricingError("INVALID_TRADE", "Schedule with stub=None does not divide evenly; choose a stub type or adjust dates", {
        effectiveDate: start,
        terminationDate: end,
        frequency: params.frequency,
      });
    }
    lastStub = !lastIsRegular;
    unadjusted = dates;
  }

  // Remove accidental duplicates (e.g. EOM collisions).
  unadjusted = unadjusted.filter((d, i, arr) => i === 0 || d !== arr[i - 1]);
  if (unadjusted.length - 1 > maxPeriods) throw tooManyPeriods(unadjusted.length - 1, maxPeriods, params.frequency);

  const periods: SchedulePeriod[] = [];
  for (let i = 0; i < unadjusted.length - 1; i++) {
    const uStart = unadjusted[i]!;
    const uEnd = unadjusted[i + 1]!;
    const isLast = i === unadjusted.length - 2;
    const aStart = adjust(uStart, bdc, cal);
    const aEnd = adjust(uEnd, isLast ? termBdc : bdc, cal);
    const payment = payLag === 0 ? adjust(aEnd, bdc, payCal) : addBusinessDays(aEnd, payLag, payCal);
    const fixing = fixLag === 0 ? aStart : addBusinessDays(aStart, -fixLag, fixCal);
    periods.push({
      index: i,
      unadjustedStart: uStart,
      unadjustedEnd: uEnd,
      accrualStart: aStart,
      accrualEnd: aEnd,
      paymentDate: payment,
      fixingDate: fixing,
      isStub: (i === 0 && firstStub) || (isLast && lastStub),
    });
  }
  return { periods, params };
}

function tooManyPeriods(count: number, max: number, frequency: Frequency): PricingError {
  return new PricingError(
    "TOO_MANY_PERIODS",
    `Schedule with frequency ${frequency} would have ${count} periods (limit ${max}) – shorten the leg or use a longer coupon frequency`,
    {
      periods: count,
      maxPeriods: max,
      frequency,
    },
  );
}

/** Coupons per year of a frequency string (1 for zero-coupon); invalid strings raise `PricingError("INVALID_FREQUENCY")`. */
export function frequencyPerYear(freq: Frequency): number {
  const t = frequencyTenor(freq);
  if (!t) return 1;
  return 12 / tenorInMonths(t);
}

/** Tenor of a frequency string (null for zero coupon). */
export function frequencyTenorOf(freq: Frequency): Tenor | null {
  return frequencyTenor(freq);
}
