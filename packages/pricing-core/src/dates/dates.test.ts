import { describe, expect, it } from "vitest";
import { addMonths, dayOfWeek, fromYMD, immDate, parseISO, toISO } from "./date.js";
import { adjust, advance, easterSunday, getCalendar } from "./calendar.js";
import { yearFraction } from "./daycount.js";
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
