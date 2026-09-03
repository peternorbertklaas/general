import {
  type SerialDate,
  addDays,
  addTenor,
  dayOfWeek,
  endOfMonth,
  fromYMD,
  isEndOfMonth,
  isWeekend,
  parseTenor,
  toYMD,
} from "./date.js";

export type BusinessDayConvention =
  | "Following"
  | "ModifiedFollowing"
  | "Preceding"
  | "ModifiedPreceding"
  | "Unadjusted";

export interface Calendar {
  readonly name: string;
  isHoliday(d: SerialDate): boolean;
}

export type CalendarId =
  | "TARGET"
  | "NONE"
  | "WEEKEND"
  | "US"
  | "USNY"
  | "UK"
  | "GB"
  | "CH"
  | "DE"
  | "JP"
  | string;

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday. */
export function easterSunday(year: number): SerialDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromYMD(year, month, day);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): SerialDate {
  const first = fromYMD(year, month, 1);
  const offset = (weekday - dayOfWeek(first) + 7) % 7;
  return first + offset + 7 * (n - 1);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): SerialDate {
  const last = endOfMonth(fromYMD(year, month, 1));
  const offset = (dayOfWeek(last) - weekday + 7) % 7;
  return last - offset;
}

/** Observed date for fixed holidays (Sat → Fri, Sun → Mon), US style. */
function observedUS(d: SerialDate): SerialDate {
  const w = dayOfWeek(d);
  if (w === 6) return d - 1;
  if (w === 0) return d + 1;
  return d;
}

/** UK style substitute day: if on weekend, move to next Monday (or Tuesday if Monday is taken). */
function substituteUK(d: SerialDate, taken: Set<number>): SerialDate {
  let x = d;
  while (isWeekend(x) || taken.has(x)) x++;
  return x;
}

class WeekendCalendar implements Calendar {
  readonly name = "WEEKEND";
  isHoliday(d: SerialDate): boolean {
    return isWeekend(d);
  }
}

abstract class RuleCalendar implements Calendar {
  abstract readonly name: string;
  private cache = new Map<number, Set<number>>();
  protected abstract holidaysInYear(year: number): SerialDate[];
  isHoliday(d: SerialDate): boolean {
    if (isWeekend(d)) return true;
    const { year } = toYMD(d);
    let set = this.cache.get(year);
    if (!set) {
      set = new Set(this.holidaysInYear(year));
      this.cache.set(year, set);
    }
    return set.has(d);
  }
}

/** TARGET2 (Eurosystem) calendar. */
class TargetCalendar extends RuleCalendar {
  readonly name = "TARGET";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      easter - 2, // Good Friday
      easter + 1, // Easter Monday
      fromYMD(y, 5, 1),
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
    ];
  }
}

/** Germany (Frankfurt) – TARGET plus Ascension, Whit Monday, Unity Day, Corpus Christi, Christmas Eve/NYE. */
class GermanyCalendar extends RuleCalendar {
  readonly name = "DE";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      easter - 2,
      easter + 1,
      fromYMD(y, 5, 1),
      easter + 39, // Ascension
      easter + 50, // Whit Monday
      easter + 60, // Corpus Christi (Hessen)
      fromYMD(y, 10, 3),
      fromYMD(y, 12, 24),
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
      fromYMD(y, 12, 31),
    ];
  }
}

/** United States (SIFMA / Federal Reserve style, New York). */
class UnitedStatesCalendar extends RuleCalendar {
  readonly name = "US";
  protected holidaysInYear(y: number): SerialDate[] {
    const list = [
      observedUS(fromYMD(y, 1, 1)),
      nthWeekdayOfMonth(y, 1, 1, 3), // MLK
      nthWeekdayOfMonth(y, 2, 1, 3), // Presidents' Day
      lastWeekdayOfMonth(y, 5, 1), // Memorial Day
      observedUS(fromYMD(y, 7, 4)),
      nthWeekdayOfMonth(y, 9, 1, 1), // Labor Day
      nthWeekdayOfMonth(y, 10, 1, 2), // Columbus Day
      observedUS(fromYMD(y, 11, 11)), // Veterans Day
      nthWeekdayOfMonth(y, 11, 4, 4), // Thanksgiving
      observedUS(fromYMD(y, 12, 25)),
    ];
    if (y >= 2022) list.push(observedUS(fromYMD(y, 6, 19))); // Juneteenth
    // New Year's Day observed on Dec 31 of previous year when Jan 1 is Saturday.
    if (dayOfWeek(fromYMD(y + 1, 1, 1)) === 6) list.push(fromYMD(y, 12, 31));
    return list;
  }
}

/** United Kingdom (England & Wales bank holidays). */
class UnitedKingdomCalendar extends RuleCalendar {
  readonly name = "UK";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    const taken = new Set<number>();
    const add = (d: SerialDate) => {
      const s = substituteUK(d, taken);
      taken.add(s);
      return s;
    };
    const list = [
      add(fromYMD(y, 1, 1)),
      easter - 2,
      easter + 1,
      y === 2020 ? fromYMD(2020, 5, 8) : nthWeekdayOfMonth(y, 5, 1, 1), // Early May (VE Day 2020)
      y === 2022 ? fromYMD(2022, 6, 2) : y === 2012 ? fromYMD(2012, 6, 4) : lastWeekdayOfMonth(y, 5, 1),
      lastWeekdayOfMonth(y, 8, 1),
    ];
    if (y === 2022) list.push(fromYMD(2022, 6, 3), fromYMD(2022, 9, 19)); // Platinum Jubilee, Queen's funeral
    if (y === 2023) list.push(fromYMD(2023, 5, 8)); // Coronation
    if (y === 2011) list.push(fromYMD(2011, 4, 29)); // Royal wedding
    const xmas = add(fromYMD(y, 12, 25));
    const boxing = add(fromYMD(y, 12, 26));
    list.push(xmas, boxing);
    return list;
  }
}

/** Switzerland (Zurich). */
class SwitzerlandCalendar extends RuleCalendar {
  readonly name = "CH";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      fromYMD(y, 1, 2), // Berchtoldstag
      easter - 2,
      easter + 1,
      fromYMD(y, 5, 1),
      easter + 39, // Ascension
      easter + 50, // Whit Monday
      fromYMD(y, 8, 1), // National Day
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
    ];
  }
}

/** Japan (Tokyo) – simplified rule set for the major national holidays. */
class JapanCalendar extends RuleCalendar {
  readonly name = "JP";
  protected holidaysInYear(y: number): SerialDate[] {
    const obs = (d: SerialDate) => (dayOfWeek(d) === 0 ? d + 1 : d);
    const list = [
      fromYMD(y, 1, 1),
      fromYMD(y, 1, 2),
      fromYMD(y, 1, 3),
      nthWeekdayOfMonth(y, 1, 1, 2), // Coming of Age
      obs(fromYMD(y, 2, 11)), // National Foundation
      obs(fromYMD(y, 2, 23)), // Emperor's Birthday (from 2020)
      obs(fromYMD(y, 3, 20)), // Vernal Equinox (approx)
      obs(fromYMD(y, 4, 29)), // Showa Day
      fromYMD(y, 5, 3),
      fromYMD(y, 5, 4),
      fromYMD(y, 5, 5),
      nthWeekdayOfMonth(y, 7, 1, 3), // Marine Day
      obs(fromYMD(y, 8, 11)), // Mountain Day
      nthWeekdayOfMonth(y, 9, 1, 3), // Respect for the Aged
      obs(fromYMD(y, 9, 23)), // Autumnal Equinox (approx)
      nthWeekdayOfMonth(y, 10, 1, 2), // Sports Day
      obs(fromYMD(y, 11, 3)), // Culture Day
      obs(fromYMD(y, 11, 23)), // Labour Thanksgiving
      fromYMD(y, 12, 31),
    ];
    return list;
  }
}

export class JointCalendar implements Calendar {
  readonly name: string;
  constructor(private readonly calendars: Calendar[]) {
    this.name = calendars.map((c) => c.name).join("+");
  }
  isHoliday(d: SerialDate): boolean {
    return this.calendars.some((c) => c.isHoliday(d));
  }
}

/** Calendar defined by an explicit holiday list (e.g. loaded from a data provider). */
export class CustomCalendar implements Calendar {
  private readonly set: Set<number>;
  constructor(
    readonly name: string,
    holidays: SerialDate[],
    private readonly weekendsAreHolidays = true,
  ) {
    this.set = new Set(holidays);
  }
  isHoliday(d: SerialDate): boolean {
    return (this.weekendsAreHolidays && isWeekend(d)) || this.set.has(d);
  }
}

const registry = new Map<string, Calendar>();

export function registerCalendar(cal: Calendar, ...aliases: string[]): void {
  registry.set(cal.name.toUpperCase(), cal);
  for (const a of aliases) registry.set(a.toUpperCase(), cal);
}

registerCalendar(new WeekendCalendar(), "NONE", "NULL");
registerCalendar(new TargetCalendar(), "EUR", "TARGET2", "EUTA");
registerCalendar(new GermanyCalendar(), "DEFR", "FRANKFURT");
registerCalendar(new UnitedStatesCalendar(), "USNY", "USD", "NYC", "USGS");
registerCalendar(new UnitedKingdomCalendar(), "GB", "GBP", "GBLO", "LONDON");
registerCalendar(new SwitzerlandCalendar(), "CHF", "CHZU", "ZURICH");
registerCalendar(new JapanCalendar(), "JPY", "JPTO", "TOKYO");

/**
 * Resolve a calendar id. Composite ids like "TARGET+US" produce a joint calendar.
 */
export function getCalendar(id: CalendarId | Calendar): Calendar {
  if (typeof id !== "string") return id;
  const parts = id.split(/[+,]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return new JointCalendar(parts.map((p) => getCalendar(p)));
  const cal = registry.get(id.trim().toUpperCase());
  if (!cal) throw new Error(`Unknown calendar: ${id}`);
  return cal;
}

export function isBusinessDay(d: SerialDate, cal: Calendar): boolean {
  return !cal.isHoliday(d);
}

export function adjust(d: SerialDate, bdc: BusinessDayConvention, cal: Calendar): SerialDate {
  if (bdc === "Unadjusted" || isBusinessDay(d, cal)) return d;
  const { month } = toYMD(d);
  let x = d;
  switch (bdc) {
    case "Following":
      while (cal.isHoliday(x)) x++;
      return x;
    case "ModifiedFollowing":
      while (cal.isHoliday(x)) x++;
      if (toYMD(x).month !== month) return adjust(d, "Preceding", cal);
      return x;
    case "Preceding":
      while (cal.isHoliday(x)) x--;
      return x;
    case "ModifiedPreceding":
      while (cal.isHoliday(x)) x--;
      if (toYMD(x).month !== month) return adjust(d, "Following", cal);
      return x;
  }
}

export function addBusinessDays(d: SerialDate, n: number, cal: Calendar): SerialDate {
  let x = d;
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    x += step;
    if (isBusinessDay(x, cal)) remaining--;
  }
  return x;
}

/**
 * Advance a date by a tenor with business-day adjustment. For day/week tenors
 * business days are used when `businessDaysForShortTenors` is true (market
 * convention for e.g. spot lag "2D").
 */
export function advance(
  d: SerialDate,
  tenor: string,
  cal: Calendar,
  bdc: BusinessDayConvention = "ModifiedFollowing",
  endOfMonthRule = false,
  businessDaysForShortTenors = true,
): SerialDate {
  const t = parseTenor(tenor);
  if (t.unit === "D" && businessDaysForShortTenors) return addBusinessDays(d, t.n, cal);
  const eom = endOfMonthRule && isEndOfMonth(d) && (t.unit === "M" || t.unit === "Y");
  const raw = addTenor(d, t, eom);
  return adjust(raw, bdc, cal);
}

export function businessDaysBetween(from: SerialDate, to: SerialDate, cal: Calendar): number {
  let n = 0;
  for (let x = from; x < to; x++) if (isBusinessDay(x, cal)) n++;
  return n;
}

export { addDays };
