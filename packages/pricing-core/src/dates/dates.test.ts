import { describe, expect, it } from "vitest";
import { addMonths, dayOfWeek, fromYMD, immDate, parseISO, parseTenor, toISO } from "./date.js";
import { adjust, advance, easterSunday, getCalendar } from "./calendar.js";
import { dayCount, yearFraction } from "./daycount.js";
import { buildSchedule } from "./schedule.js";

describe("date arithmetic", () => {
  it("round-trips ISO", () => {
    expect(toISO(parseISO("2026-09-03"))).toBe("2026-09-03");
    expect(toISO(fromYMD(2024, 2, 29))).toBe("2024-02-29");
  });
  it("knows weekdays", () => {
    expect(dayOfWeek(parseISO("1970-01-01"))).toBe(4); // Thursday
    expect(dayOfWeek(parseISO("2026-09-03"))).toBe(4); // Thursday
    expect(dayOfWeek(parseISO("2026-09-06"))).toBe(0); // Sunday
  });
  it("adds months with end-of-month handling", () => {
    expect(toISO(addMonths(parseISO("2026-01-31"), 1))).toBe("2026-02-28");
    expect(toISO(addMonths(parseISO("2026-02-28"), 1, true))).toBe("2026-03-31");
    expect(toISO(addMonths(parseISO("2026-02-28"), 1, false))).toBe("2026-03-28");
  });
  it("computes IMM dates", () => {
    expect(toISO(immDate(2026, 3))).toBe("2026-03-18");
    expect(toISO(immDate(2026, 12))).toBe("2026-12-16");
  });
});

describe("calendars", () => {
  it("computes Easter", () => {
    expect(toISO(easterSunday(2024))).toBe("2024-03-31");
    expect(toISO(easterSunday(2025))).toBe("2025-04-20");
    expect(toISO(easterSunday(2026))).toBe("2026-04-05");
  });
  it("TARGET holidays", () => {
    const t = getCalendar("TARGET");
    expect(t.isHoliday(parseISO("2026-04-03"))).toBe(true); // Good Friday
    expect(t.isHoliday(parseISO("2026-04-06"))).toBe(true); // Easter Monday
    expect(t.isHoliday(parseISO("2026-05-01"))).toBe(true);
    expect(t.isHoliday(parseISO("2026-12-25"))).toBe(true);
    expect(t.isHoliday(parseISO("2025-10-03"))).toBe(false); // German unity day (Fri) is not TARGET
    expect(getCalendar("DE").isHoliday(parseISO("2025-10-03"))).toBe(true);
    expect(t.isHoliday(parseISO("2026-09-03"))).toBe(false);
  });
  it("US holidays incl. observed rules", () => {
    const us = getCalendar("US");
    expect(us.isHoliday(parseISO("2026-07-03"))).toBe(true); // July 4 2026 is Saturday → observed Friday
    expect(us.isHoliday(parseISO("2026-11-26"))).toBe(true); // Thanksgiving
    expect(us.isHoliday(parseISO("2026-01-19"))).toBe(true); // MLK
    expect(us.isHoliday(parseISO("2026-06-19"))).toBe(true); // Juneteenth
  });
  it("UK substitute days", () => {
    const uk = getCalendar("UK");
    expect(uk.isHoliday(parseISO("2026-12-28"))).toBe(true); // Boxing Day 2026 (Sat) → Mon 28th
    expect(uk.isHoliday(parseISO("2026-05-04"))).toBe(true); // Early May
    expect(uk.isHoliday(parseISO("2026-08-31"))).toBe(true); // Summer bank holiday
  });
  it("adjusts with ModifiedFollowing", () => {
    const t = getCalendar("TARGET");
    // 2026-05-31 is a Sunday; following would be June 1 → MF rolls back to May 29 (Fri)
    expect(toISO(adjust(parseISO("2026-05-31"), "ModifiedFollowing", t))).toBe("2026-05-29");
    expect(toISO(adjust(parseISO("2026-05-31"), "Following", t))).toBe("2026-06-01");
    expect(toISO(adjust(parseISO("2026-05-31"), "Preceding", t))).toBe("2026-05-29");
  });
  it("advances by business days and tenors", () => {
    const t = getCalendar("TARGET");
    expect(toISO(advance(parseISO("2026-09-03"), "2D", t))).toBe("2026-09-07"); // Thu + 2bd = Mon
    expect(toISO(advance(parseISO("2026-09-07"), "6M", t))).toBe("2027-03-08"); // Mar 7 2027 is Sunday → Mon 8
    expect(toISO(advance(parseISO("2026-02-27"), "1M", t, "ModifiedFollowing", true))).toBe("2026-03-27");
  });
  it("joint calendars combine", () => {
    const j = getCalendar("TARGET+US");
    expect(j.isHoliday(parseISO("2026-11-26"))).toBe(true);
    expect(j.isHoliday(parseISO("2026-05-01"))).toBe(true);
  });
});

describe("day counts", () => {
  const s = parseISO("2026-01-31");
  const e = parseISO("2026-07-31");
  it("ACT/360 and ACT/365F", () => {
    expect(yearFraction(s, e, "ACT/360")).toBeCloseTo(181 / 360, 12);
    expect(yearFraction(s, e, "ACT/365F")).toBeCloseTo(181 / 365, 12);
  });
  it("30/360 US and 30E/360", () => {
    expect(yearFraction(s, e, "30/360")).toBeCloseTo(0.5, 12);
    expect(yearFraction(s, e, "30E/360")).toBeCloseTo(0.5, 12);
    expect(yearFraction(parseISO("2026-01-30"), parseISO("2026-03-31"), "30/360")).toBeCloseTo(60 / 360, 12);
    expect(yearFraction(parseISO("2026-01-15"), parseISO("2026-03-31"), "30/360")).toBeCloseTo(76 / 360, 12);
    expect(yearFraction(parseISO("2026-01-15"), parseISO("2026-03-31"), "30E/360")).toBeCloseTo(75 / 360, 12);
  });
  it("ACT/ACT ISDA across a leap year", () => {
    const yf = yearFraction(parseISO("2023-11-01"), parseISO("2024-05-01"), "ACT/ACT ISDA");
    expect(yf).toBeCloseTo(61 / 365 + 121 / 366, 12);
  });
  it("normalises aliases", () => {
    expect(yearFraction(s, e, "Actual/360")).toBeCloseTo(181 / 360, 12);
  });
});

describe("schedules", () => {
  it("builds a regular semi-annual schedule", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2031-09-07"),
      frequency: "6M",
      calendar: "TARGET",
    });
    expect(sch.periods).toHaveLength(10);
    expect(toISO(sch.periods[0]!.accrualStart)).toBe("2026-09-07");
    expect(toISO(sch.periods[9]!.accrualEnd)).toBe("2031-09-08"); // 7 Sep 2031 is Sunday
    expect(sch.periods.every((p) => !p.isStub)).toBe(true);
  });
  it("creates a short front stub", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2028-11-15"),
      frequency: "1Y",
      calendar: "TARGET",
      stub: "ShortFront",
    });
    expect(sch.periods).toHaveLength(3);
    expect(sch.periods[0]!.isStub).toBe(true);
    expect(toISO(sch.periods[0]!.unadjustedEnd)).toBe("2026-11-15");
  });
  it("creates a long back stub", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2028-11-15"),
      frequency: "1Y",
      calendar: "TARGET",
      stub: "LongBack",
    });
    expect(sch.periods).toHaveLength(2);
    expect(toISO(sch.periods[1]!.unadjustedStart)).toBe("2027-09-07");
    expect(sch.periods[1]!.isStub).toBe(true);
  });
  it("applies fixing and payment lags", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2027-09-07"),
      frequency: "6M",
      calendar: "TARGET",
      fixingLag: 2,
      paymentLag: 1,
    });
    expect(toISO(sch.periods[0]!.fixingDate)).toBe("2026-09-03");
    expect(toISO(sch.periods[0]!.paymentDate)).toBe("2027-03-09"); // accrual end Mar 8 → +1bd
  });
  it("zero coupon", () => {
    const sch = buildSchedule({ effectiveDate: parseISO("2026-09-07"), terminationDate: parseISO("2027-03-08"), frequency: "ZC", calendar: "TARGET" });
    expect(sch.periods).toHaveLength(1);
  });
});

describe("review regressions – day counts (H4, N1, N2)", () => {
  it("ACT/ACT ICMA: semi-annual 2026-09-07 → 2027-03-08 = 0.5 with frequency 2, also when inferred from the period", () => {
    const s = parseISO("2026-09-07");
    const e = parseISO("2027-03-08");
    expect(yearFraction(s, e, "ACT/ACT ICMA", { frequency: 2, refStart: s, refEnd: e })).toBe(0.5);
    expect(yearFraction(s, e, "ACT/ACT ICMA")).toBe(0.5);
    // annual period: 1.0; quarterly: 0.25
    expect(yearFraction(s, parseISO("2027-09-07"), "ACT/ACT ICMA", { frequency: 1 })).toBe(1);
    expect(yearFraction(s, parseISO("2026-12-07"), "ACT/ACT ICMA", { frequency: 4 })).toBe(0.25);
  });
  it("ACT/ACT ICMA stubs use notional periods: 3M front stub on a semi-annual bond ≈ 0.25, 9M long stub ≈ 0.75", () => {
    // Reference (regular) period 2026-09-07 → 2027-03-07; stub accrues 2026-12-07 → 2027-03-07.
    const refStart = parseISO("2026-09-07");
    const refEnd = parseISO("2027-03-07");
    const short = yearFraction(parseISO("2026-12-07"), refEnd, "ACT/ACT ICMA", { frequency: 2, refStart, refEnd });
    expect(short).toBeCloseTo(0.5 * (90 / 181), 12);
    // Long front stub 2026-06-07 → 2027-03-07: previous notional period 2026-03-07 → 2026-09-07 (184 days) + full period.
    const long = yearFraction(parseISO("2026-06-07"), refEnd, "ACT/ACT ICMA", { frequency: 2, refStart, refEnd });
    expect(long).toBeCloseTo(0.5 * (92 / 184) + 0.5, 12);
  });
  it("30E/360 ISDA: 31.01 → 28.02 (not maturity) counts 30 days; 28.02.2026 → 28.02.2027 at maturity = 358/360; dayCount agrees", () => {
    expect(yearFraction(parseISO("2026-01-31"), parseISO("2026-02-28"), "30E/360 ISDA")).toBeCloseTo(30 / 360, 12);
    expect(dayCount(parseISO("2026-01-31"), parseISO("2026-02-28"), "30E/360 ISDA")).toBe(30);
    expect(yearFraction(parseISO("2026-02-28"), parseISO("2027-02-28"), "30E/360 ISDA", { isMaturity: true })).toBeCloseTo(358 / 360, 12);
    expect(dayCount(parseISO("2026-02-28"), parseISO("2027-02-28"), "30E/360 ISDA", { isMaturity: true })).toBe(358);
    expect(yearFraction(parseISO("2026-02-28"), parseISO("2027-02-28"), "30E/360 ISDA")).toBeCloseTo(1, 12);
  });
  it("30U/360 applies the end-of-February rule, 30/360 (Bond Basis) does not", () => {
    expect(dayCount(parseISO("2026-02-28"), parseISO("2026-03-31"), "30U/360")).toBe(30);
    expect(dayCount(parseISO("2026-02-28"), parseISO("2026-03-31"), "30/360")).toBe(33);
    expect(dayCount(parseISO("2026-02-28"), parseISO("2027-02-28"), "30U/360")).toBe(360);
    expect(yearFraction(parseISO("2026-01-31"), parseISO("2026-07-31"), "30U/360")).toBeCloseTo(0.5, 12);
    expect(yearFraction(parseISO("2026-01-31"), parseISO("2026-07-31"), "30/360 US")).toBeCloseTo(0.5, 12);
  });
  it("N4: TN and SN tenors are 2 and 3 business days, not overnight", () => {
    expect(parseTenor("ON")).toEqual({ n: 1, unit: "D" });
    expect(parseTenor("TN")).toEqual({ n: 2, unit: "D" });
    expect(parseTenor("S/N")).toEqual({ n: 3, unit: "D" });
  });
});

describe("review regressions – schedules (M1, M2, N3)", () => {
  it("EOM: effective 30.04.2026, 5Y, 6M rolls on month ends (31.10 / 30.04)", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-04-30"),
      terminationDate: parseISO("2031-04-30"),
      frequency: "6M",
      calendar: "TARGET",
      endOfMonth: true,
    });
    expect(sch.periods).toHaveLength(10);
    expect(sch.periods.map((p) => toISO(p.unadjustedEnd).slice(5))).toEqual([
      "10-31",
      "04-30",
      "10-31",
      "04-30",
      "10-31",
      "04-30",
      "10-31",
      "04-30",
      "10-31",
      "04-30",
    ]);
    expect(sch.periods.every((p) => !p.isStub)).toBe(true);
  });
  it("LongFront on an evenly dividing 5Y/1Y schedule keeps 5 regular periods (no merge)", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2031-09-07"),
      frequency: "1Y",
      calendar: "TARGET",
      stub: "LongFront",
    });
    expect(sch.periods).toHaveLength(5);
    expect(sch.periods.every((p) => !p.isStub)).toBe(true);
    const back = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2031-09-07"),
      frequency: "1Y",
      calendar: "TARGET",
      stub: "LongBack",
    });
    expect(back.periods).toHaveLength(5);
    expect(back.periods.every((p) => !p.isStub)).toBe(true);
  });
  it("LongFront 27M/1Y gives 2 periods (15M stub + 12M) and marks only the stub", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2028-12-07"),
      frequency: "1Y",
      calendar: "TARGET",
      stub: "LongFront",
    });
    expect(sch.periods).toHaveLength(2);
    expect(toISO(sch.periods[0]!.unadjustedEnd)).toBe("2027-12-07");
    expect(sch.periods.map((p) => p.isStub)).toEqual([true, false]);
    const shortFront = buildSchedule({
      effectiveDate: parseISO("2026-09-07"),
      terminationDate: parseISO("2028-12-07"),
      frequency: "1Y",
      calendar: "TARGET",
      stub: "ShortFront",
    });
    expect(shortFront.periods).toHaveLength(3);
    expect(shortFront.periods.map((p) => p.isStub)).toEqual([true, false, false]);
  });
  it("N3: rolling from the 31st without EOM does not flag regular periods as stubs", () => {
    const sch = buildSchedule({ effectiveDate: parseISO("2026-03-31"), terminationDate: parseISO("2028-03-31"), frequency: "6M", calendar: "TARGET" });
    expect(sch.periods).toHaveLength(4);
    expect(sch.periods.every((p) => !p.isStub)).toBe(true);
  });
  it("IMM roll: 2Y quarterly from 2026-09-16 rolls on third Wednesdays (16.12.26, 17.03.27, 16.06.27, …)", () => {
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-09-16"),
      terminationDate: parseISO("2028-09-20"),
      frequency: "3M",
      calendar: "TARGET",
      roll: "IMM",
    });
    expect(sch.periods.map((p) => toISO(p.unadjustedEnd))).toEqual([
      "2026-12-16",
      "2027-03-17",
      "2027-06-16",
      "2027-09-15",
      "2027-12-15",
      "2028-03-15",
      "2028-06-21",
      "2028-09-20",
    ]);
    expect(sch.periods.every((p) => !p.isStub)).toBe(true);
  });
  it("fixing dates skip TARGET holidays (Good Friday / Easter Monday 2026)", () => {
    // Accrual start Wed 2026-04-08, 2 business days back: Tue 07.04, then (Mon 06.04 Easter Monday, Fri 03.04 Good Friday skipped) Thu 02.04
    const sch = buildSchedule({
      effectiveDate: parseISO("2026-04-08"),
      terminationDate: parseISO("2027-04-08"),
      frequency: "6M",
      calendar: "TARGET",
      fixingLag: 2,
    });
    expect(toISO(sch.periods[0]!.fixingDate)).toBe("2026-04-02");
  });
});
