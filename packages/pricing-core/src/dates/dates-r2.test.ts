import { afterEach, describe, expect, it } from "vitest";
import { addBusinessDays, clearCalendarHolidays, getCalendar, hasCalendarHolidayFeed, isBusinessDay, registerCalendarHolidays } from "./calendar.js";
import { parseISO } from "./date.js";
import { yearFraction } from "./daycount.js";
import { fxSpotDateFrom } from "../market/fx-spot.js";

describe("R2-5 – ACT/ACT ICMA long back stub with EOM notional periods (ISDA 2006 example)", () => {
  it("30.11.1999 → 30.04.2000 quarterly, reference period 30.11.1999 → 29.02.2000: 0.415761 (notional period ends 31.05.2000)", () => {
    const start = parseISO("1999-11-30");
    const end = parseISO("2000-04-30");
    const refEnd = parseISO("2000-02-29");
    // inferred: both reference dates are month ends → EOM rule
    const inferred = yearFraction(start, end, "ACT/ACT ICMA", { frequency: 4, refStart: start, refEnd });
    expect(inferred).toBeCloseTo(0.415761, 6);
    expect(inferred).toBeCloseTo(91 / 364 + 61 / 368, 12);
    // explicit flags
    expect(yearFraction(start, end, "ACT/ACT ICMA", { frequency: 4, refStart: start, refEnd, endOfMonth: true })).toBeCloseTo(0.415761, 6);
    expect(yearFraction(start, end, "ACT/ACT ICMA", { frequency: 4, refStart: start, refEnd, endOfMonth: false })).toBeCloseTo(0.419444, 6);
    // the other ISDA examples are unchanged (no month-end reference dates)
    expect(
      yearFraction(parseISO("1999-02-01"), parseISO("1999-07-01"), "ACT/ACT ICMA", {
        frequency: 1,
        refStart: parseISO("1998-07-01"),
        refEnd: parseISO("1999-07-01"),
      }),
    ).toBeCloseTo(150 / 365, 12);
    expect(
      yearFraction(parseISO("2002-08-15"), parseISO("2003-07-15"), "ACT/ACT ICMA", {
        frequency: 2,
        refStart: parseISO("2003-01-15"),
        refEnd: parseISO("2003-07-15"),
      }),
    ).toBeCloseTo(153 / 368 + 0.5, 12);
  });
});

describe("N14 – holiday feed override for rule-based calendars", () => {
  afterEach(() => {
    clearCalendarHolidays("US");
    clearCalendarHolidays("JP");
  });

  it("a feed replaces the rule-based holidays for the years it covers and leaves other years alone; joint calendars pick it up", () => {
    const columbus2027 = parseISO("2027-10-11"); // 2nd Monday of October 2027 (rule-based holiday)
    const columbus2028 = parseISO("2028-10-09");
    const adHoc = parseISO("2027-06-04"); // Friday, not a rule-based US holiday (Christmas Eve 2027 would be: observed Christmas)
    expect(isBusinessDay(columbus2027, getCalendar("US"))).toBe(false);
    expect(isBusinessDay(adHoc, getCalendar("US"))).toBe(true);
    expect(hasCalendarHolidayFeed("US")).toBe(false);
    registerCalendarHolidays("US", [parseISO("2027-01-01"), adHoc, parseISO("2027-12-25")]);
    expect(hasCalendarHolidayFeed("US")).toBe(true);
    const us = getCalendar("US");
    expect(isBusinessDay(columbus2027, us)).toBe(true); // 2027 is feed-driven: no Columbus Day
    expect(isBusinessDay(adHoc, us)).toBe(false); // feed holiday
    expect(isBusinessDay(columbus2028, us)).toBe(false); // 2028 still rule-based
    expect(isBusinessDay(parseISO("2027-12-25"), us)).toBe(false); // weekend anyway
    // aliases and joint calendars resolve to the overlay
    expect(isBusinessDay(adHoc, getCalendar("USNY"))).toBe(false);
    expect(isBusinessDay(adHoc, getCalendar("TARGET+US"))).toBe(false);
    expect(fxSpotDateFrom(parseISO("2027-06-02"), "EUR", "USD")).toBe(parseISO("2027-06-07")); // 03.06. + 04.06. (feed holiday) skipped → Monday 07.06.
    expect(addBusinessDays(parseISO("2027-10-08"), 1, us)).toBe(columbus2027);
    // a second feed for another year merges; re-feeding the same year replaces it
    registerCalendarHolidays("US", [parseISO("2028-11-24")]);
    expect(isBusinessDay(adHoc, getCalendar("US"))).toBe(false); // 2027 kept
    expect(isBusinessDay(parseISO("2028-11-24"), getCalendar("US"))).toBe(false);
    expect(isBusinessDay(columbus2028, getCalendar("US"))).toBe(true); // 2028 now feed-driven
    registerCalendarHolidays("US", [parseISO("2027-07-05")]);
    expect(isBusinessDay(adHoc, getCalendar("US"))).toBe(true); // 2027 replaced
    expect(isBusinessDay(parseISO("2027-07-05"), getCalendar("US"))).toBe(false);
    clearCalendarHolidays("US");
    expect(hasCalendarHolidayFeed("US")).toBe(false);
    expect(isBusinessDay(columbus2027, getCalendar("US"))).toBe(false);
    expect(() => registerCalendarHolidays("MARS", [])).toThrow(/Unknown calendar/);
  });

  it("JP: feed can add the observed equinox that the rule set approximates", () => {
    registerCalendarHolidays("JP", [parseISO("2027-03-22"), parseISO("2027-09-23")]);
    expect(isBusinessDay(parseISO("2027-03-22"), getCalendar("JPY"))).toBe(false);
    expect(isBusinessDay(parseISO("2027-05-03"), getCalendar("JP"))).toBe(true); // 2027 feed-driven, Golden Week not in the feed
    expect(isBusinessDay(parseISO("2028-05-03"), getCalendar("JP"))).toBe(false); // 2028 rule-based
  });
});
