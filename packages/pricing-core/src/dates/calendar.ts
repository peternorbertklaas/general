import { type SerialDate, addDays, addTenor, dayOfWeek, endOfMonth, fromYMD, isEndOfMonth, isWeekend, parseISO, parseTenor, toISO, toYMD } from "./date.js";

import { PricingError } from "../errors.js";

export type BusinessDayConvention = "Following" | "ModifiedFollowing" | "Preceding" | "ModifiedPreceding" | "Unadjusted";

export interface Calendar {
  readonly name: string;
  isHoliday(d: SerialDate): boolean;
}

export type CalendarId = "TARGET" | "NONE" | "WEEKEND" | "US" | "USNY" | "US-SIFMA" | "UK" | "GB" | "CH" | "DE" | "JP" | string;

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

/**
 * United States settlement calendar (New York; QuantLib `UnitedStates(Settlement)`,
 * set-equal 2024–2032) – rule-based approximation; override with the SIFMA
 * holiday schedule via `registerCalendarHolidays("US", dates)` in production
 * (early closes and ad-hoc closures such as national days of mourning are not
 * rule-based). Payment calendar of USD legs and of the SOFR index; SOFR
 * *fixings* follow `US-SIFMA` (N8-4).
 */
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

/**
 * United States – SIFMA government-bond market / SOFR fixing calendar (N8-4;
 * QuantLib `UnitedStates(SOFR)`, set-equal 2024–2032). SOFR is published by
 * the New York Fed only on SIFMA business days of the Treasury market: Good
 * Friday is a holiday (so far SOFR never fixed on a Good Friday), while SIFMA
 * does not recommend a full close for New Year's Day and Veterans Day when
 * they fall on a Saturday (no Friday observance: 31.12.2027, 10.11.2028,
 * 31.12.2032 are fixing days). Independence Day, Juneteenth and Christmas keep
 * the Friday observance. Used as `fixingCalendar` of SOFR; the payment
 * calendar of USD legs stays `US`.
 */
class UnitedStatesSifmaCalendar extends RuleCalendar {
  readonly name = "US-SIFMA";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    const sundayToMonday = (d: SerialDate): SerialDate[] => (dayOfWeek(d) === 0 ? [d + 1] : dayOfWeek(d) === 6 ? [] : [d]);
    return [
      ...sundayToMonday(fromYMD(y, 1, 1)),
      nthWeekdayOfMonth(y, 1, 1, 3), // MLK
      nthWeekdayOfMonth(y, 2, 1, 3), // Presidents' Day
      easter - 2, // Good Friday (SOFR is not published)
      lastWeekdayOfMonth(y, 5, 1), // Memorial Day
      ...(y >= 2022 ? [observedUS(fromYMD(y, 6, 19))] : []), // Juneteenth
      observedUS(fromYMD(y, 7, 4)),
      nthWeekdayOfMonth(y, 9, 1, 1), // Labor Day
      nthWeekdayOfMonth(y, 10, 1, 2), // Columbus Day
      ...sundayToMonday(fromYMD(y, 11, 11)), // Veterans Day (no Friday observance)
      nthWeekdayOfMonth(y, 11, 4, 4), // Thanksgiving
      observedUS(fromYMD(y, 12, 25)),
    ];
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

/**
 * Day of month of the vernal / autumnal equinox in Japan (JST), standard
 * approximation valid 1980–2099 (National Astronomical Observatory of Japan
 * formula, as used by QuantLib `Japan`): ⌊20.8431 + 0.242194·(y − 1980) −
 * ⌊(y − 1980)/4⌋⌋ for March, 23.2488 analogously for September (N8-5).
 */
function equinoxDay(y: number, base: number): number {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

/**
 * Japan (Tokyo) – national holidays under the Act on National Holidays with
 * its two general rules (N8-5): a national holiday falling on a Sunday is
 * substituted by the next day that is not a national holiday (振替休日 – Golden
 * Week 03.05. Sunday → 06.05.), and a weekday between two national holidays is a
 * citizens' holiday (国民の休日 – e.g. 22.09.2026 between Respect-for-the-Aged
 * Day and the Autumnal Equinox). Equinoxes from the standard formula
 * (`equinoxDay`), plus the BoJ / JPX bank holidays 2–3 January and 31
 * December. Rule set for 2020 onwards (Emperor's Birthday 23.02., Olympic
 * shifts 2020/2021); set-equal to QuantLib `Japan` 2024–2032
 * (`test-data/golden/calendars-quantlib.json`). Override with the JPX / BoJ
 * published schedule via `registerCalendarHolidays("JP", dates)` for ad-hoc
 * holidays.
 */
class JapanCalendar extends RuleCalendar {
  readonly name = "JP";
  protected holidaysInYear(y: number): SerialDate[] {
    const national = new Set<SerialDate>([
      fromYMD(y, 1, 1), // New Year's Day
      nthWeekdayOfMonth(y, 1, 1, 2), // Coming of Age Day
      fromYMD(y, 2, 11), // National Foundation Day
      ...(y >= 2020 ? [fromYMD(y, 2, 23)] : []), // Emperor's Birthday
      fromYMD(y, 3, equinoxDay(y, 20.8431)), // Vernal Equinox Day
      fromYMD(y, 4, 29), // Showa Day
      fromYMD(y, 5, 3), // Constitution Memorial Day
      fromYMD(y, 5, 4), // Greenery Day
      fromYMD(y, 5, 5), // Children's Day
      y === 2020 ? fromYMD(2020, 7, 23) : y === 2021 ? fromYMD(2021, 7, 22) : nthWeekdayOfMonth(y, 7, 1, 3), // Marine Day
      ...(y >= 2016 ? [y === 2020 ? fromYMD(2020, 8, 10) : y === 2021 ? fromYMD(2021, 8, 8) : fromYMD(y, 8, 11)] : []), // Mountain Day
      nthWeekdayOfMonth(y, 9, 1, 3), // Respect for the Aged Day
      fromYMD(y, 9, equinoxDay(y, 23.2488)), // Autumnal Equinox Day
      y === 2020 ? fromYMD(2020, 7, 24) : y === 2021 ? fromYMD(2021, 7, 23) : nthWeekdayOfMonth(y, 10, 1, 2), // Sports Day
      fromYMD(y, 11, 3), // Culture Day
      fromYMD(y, 11, 23), // Labour Thanksgiving Day
    ]);
    const out = new Set<SerialDate>(national);
    // Substitute holiday: Sunday → the next day that is not a national holiday.
    for (const d of national) {
      if (dayOfWeek(d) !== 0) continue;
      let s = d + 1;
      while (national.has(s)) s++;
      out.add(s);
    }
    // Citizens' holiday: a single day between two national holidays (not a Sunday).
    for (const d of national) {
      const mid = d + 1;
      if (national.has(mid + 1) && !out.has(mid) && dayOfWeek(mid) !== 0) out.add(mid);
    }
    // Bank holidays (BoJ / JPX)
    out.add(fromYMD(y, 1, 2));
    out.add(fromYMD(y, 1, 3));
    out.add(fromYMD(y, 12, 31));
    return [...out];
  }
}

/** Friday in Jun 19–25 (Swedish Midsummer Eve). */
function midsummerEve(y: number): SerialDate {
  let d = fromYMD(y, 6, 19);
  while (dayOfWeek(d) !== 5) d++;
  return d;
}

/**
 * Norway (Oslo) – Markt R6-5; rule-based approximation, override with a feed via
 * `registerCalendarHolidays("NO", …)`. Christmas Eve is a bank holiday (Oslo
 * Børs / NIBOR fixing calendar, QuantLib `Norway`) since round 7 (N7-4); New
 * Year's Eve is a business day in both (QuantLib 1.43 has no 31.12.).
 */
class NorwayCalendar extends RuleCalendar {
  readonly name = "NO";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      easter - 3, // Maundy Thursday
      easter - 2, // Good Friday
      easter + 1, // Easter Monday
      fromYMD(y, 5, 1),
      fromYMD(y, 5, 17), // Constitution Day
      easter + 39, // Ascension
      easter + 50, // Whit Monday
      fromYMD(y, 12, 24), // Christmas Eve (N7-4)
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
    ];
  }
}

/** Sweden (Stockholm) – Markt R6-5; rule-based approximation. */
class SwedenCalendar extends RuleCalendar {
  readonly name = "SE";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      fromYMD(y, 1, 6), // Epiphany
      easter - 2,
      easter + 1,
      fromYMD(y, 5, 1),
      easter + 39, // Ascension
      fromYMD(y, 6, 6), // National Day
      midsummerEve(y),
      fromYMD(y, 12, 24),
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
      fromYMD(y, 12, 31),
    ];
  }
}

/**
 * Denmark (Copenhagen) – Markt R6-5; rule-based approximation. Store Bededag
 * (General Prayer Day, 4th Friday after Easter) was abolished as a public
 * holiday from 2024 (Act of 28.02.2023) – both this calendar and QuantLib 1.43
 * (`Denmark`) drop it from 2024. The Friday after Ascension is a Danish bank
 * holiday (Danish Bankers' Association; QuantLib "Day after Ascension") and
 * is included since round 7 (N7-4).
 */
class DenmarkCalendar extends RuleCalendar {
  readonly name = "DK";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      easter - 3, // Maundy Thursday
      easter - 2,
      easter + 1,
      ...(y < 2024 ? [easter + 26] : []), // Store Bededag (abolished from 2024)
      easter + 39, // Ascension
      easter + 40, // Friday after Ascension (bank holiday, N7-4)
      easter + 50, // Whit Monday
      fromYMD(y, 6, 5), // Constitution Day
      fromYMD(y, 12, 24),
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
      fromYMD(y, 12, 31),
    ];
  }
}

/**
 * Poland (Warsaw, NBP settlement) – Markt R6-5; rule-based approximation.
 * Christmas Eve is a statutory public holiday from 2025 (Act of 06.12.2024,
 * Dz.U. 2024 poz. 1965); QuantLib 1.43 (`Poland`) does not yet include it – the
 * engine keeps it (documented difference in the calendar cross-check golden).
 */
class PolandCalendar extends RuleCalendar {
  readonly name = "PL";
  protected holidaysInYear(y: number): SerialDate[] {
    const easter = easterSunday(y);
    return [
      fromYMD(y, 1, 1),
      fromYMD(y, 1, 6), // Epiphany
      easter + 1,
      fromYMD(y, 5, 1),
      fromYMD(y, 5, 3), // Constitution Day
      easter + 60, // Corpus Christi
      fromYMD(y, 8, 15),
      fromYMD(y, 11, 1),
      fromYMD(y, 11, 11), // Independence Day
      ...(y >= 2025 ? [fromYMD(y, 12, 24)] : []),
      fromYMD(y, 12, 25),
      fromYMD(y, 12, 26),
    ];
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

/**
 * Serialisable form of a `CustomCalendar` (R8, Markt R8-2): the registry id,
 * an optional display name, the holidays as ISO dates and whether weekends are
 * holidays (default true). `registerCalendar` accepts it directly, so an API
 * (`POST /api/market/calendars`) or a snapshot envelope `calendars[]` can
 * register calendars without code; `listCustomCalendars()` exports them.
 */
export interface CustomCalendarJson {
  id: string;
  name?: string;
  holidays: string[];
  weekendsAreHolidays?: boolean;
}

/** Calendar defined by an explicit holiday list (e.g. loaded from a data provider). */
export class CustomCalendar implements Calendar {
  private readonly set: Set<number>;
  constructor(
    readonly name: string,
    holidays: SerialDate[],
    private readonly weekendsAreHolidays = true,
    /** Optional display name (`CustomCalendarJson.name`); defaults to the id. */
    readonly label?: string,
  ) {
    this.set = new Set(holidays);
  }
  isHoliday(d: SerialDate): boolean {
    return (this.weekendsAreHolidays && isWeekend(d)) || this.set.has(d);
  }
  /** JSON form (`CustomCalendarJson`): holidays sorted ascending as ISO dates. */
  toJSON(): CustomCalendarJson {
    return {
      id: this.name,
      name: this.label ?? this.name,
      holidays: [...this.set].sort((a, b) => a - b).map(toISO),
      weekendsAreHolidays: this.weekendsAreHolidays,
    };
  }
}

const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Problems of a custom-calendar definition (empty = valid): `id` a non-empty
 * string without whitespace that is not a built-in calendar id or alias,
 * `holidays` an array of valid ISO dates, `weekendsAreHolidays` a boolean when
 * given. Does not register anything – an importer validates every entry of an
 * envelope before registering the first (atomic import, Architektur N8-04).
 */
export function validateCustomCalendar(json: unknown, path = "calendar"): string[] {
  const out: string[] = [];
  const c = json as Partial<CustomCalendarJson> | null;
  if (!c || typeof c !== "object" || Array.isArray(c)) return [`${path} must be an object { id, holidays[] }`];
  if (typeof c.id !== "string" || !c.id.trim() || /\s/.test(c.id)) out.push(`${path}.id must be a non-empty string without whitespace`);
  else if (isBuiltInCalendar(c.id))
    out.push(`${path}.id "${c.id}" is a built-in calendar and cannot be replaced (use registerCalendarHolidays for a holiday feed)`);
  if (c.name !== undefined && typeof c.name !== "string") out.push(`${path}.name must be a string`);
  if (!Array.isArray(c.holidays)) out.push(`${path}.holidays must be an array of ISO dates`);
  else {
    c.holidays.forEach((h: unknown, i) => {
      if (!isIsoDate(h)) {
        out.push(`${path}.holidays[${i}] must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(h)}`);
        return;
      }
      try {
        parseISO(h);
      } catch {
        out.push(`${path}.holidays[${i}] "${h}" is not a valid calendar date`);
      }
    });
  }
  if (c.weekendsAreHolidays !== undefined && typeof c.weekendsAreHolidays !== "boolean") out.push(`${path}.weekendsAreHolidays must be a boolean`);
  return out;
}

/** Build a `CustomCalendar` from its JSON form (validated: `PricingError("INVALID_CALENDAR")` listing the problems). */
export function customCalendarFromJson(json: CustomCalendarJson): CustomCalendar {
  const problems = validateCustomCalendar(json);
  if (problems.length) {
    throw new PricingError("INVALID_CALENDAR", `Invalid calendar ${String((json as { id?: unknown })?.id ?? "")}: ${problems.join("; ")}`, { problems });
  }
  return new CustomCalendar(json.id.trim(), json.holidays.map(parseISO), json.weekendsAreHolidays ?? true, json.name);
}

function isCalendarJson(x: Calendar | CustomCalendarJson): x is CustomCalendarJson {
  return "holidays" in x && !("isHoliday" in x);
}

/**
 * Rule-based calendar overlaid with an explicit holiday feed. For every year
 * covered by the feed the feed is authoritative (rule-based holidays of that
 * year are ignored, so e.g. a one-off bridge day or a cancelled observance
 * from the SIFMA / JPX / TARGET publication wins); years outside the feed fall
 * back to the rules. Weekends are always holidays.
 */
class FeedOverlayCalendar implements Calendar {
  readonly name: string;
  private readonly byYear = new Map<number, Set<number>>();
  constructor(
    private readonly base: Calendar,
    feed: SerialDate[],
  ) {
    this.name = base.name;
    for (const d of feed) {
      const { year } = toYMD(d);
      let set = this.byYear.get(year);
      if (!set) {
        set = new Set<number>();
        this.byYear.set(year, set);
      }
      set.add(d);
    }
  }
  isHoliday(d: SerialDate): boolean {
    if (isWeekend(d)) return true;
    const set = this.byYear.get(toYMD(d).year);
    return set ? set.has(d) : this.base.isHoliday(d);
  }
  /** The calendar underneath the feed. */
  get underlying(): Calendar {
    return this.base;
  }
  /** New overlay where the years of `dates` replace the same years of this feed; other years are kept. */
  withFeed(dates: SerialDate[]): FeedOverlayCalendar {
    const newYears = new Set(dates.map((d) => toYMD(d).year));
    const kept: SerialDate[] = [];
    for (const [year, set] of this.byYear) if (!newYears.has(year)) kept.push(...set);
    return new FeedOverlayCalendar(this.base, [...kept, ...dates]);
  }
}

const registry = new Map<string, Calendar>();
/** Ids and aliases registered at module load (frozen after the built-in block below, R8). */
const BUILT_IN_CALENDAR_IDS = new Set<string>();

/** True when `id` (any case) is a built-in calendar id or alias (`TARGET`, `EUR`, `US`, `USNY`, `US-SIFMA`, `JP`, …). */
export function isBuiltInCalendar(id: string): boolean {
  return BUILT_IN_CALENDAR_IDS.has(String(id).trim().toUpperCase());
}

/**
 * Register a calendar under its name (and optional aliases), replacing a
 * calendar registered at runtime under the same id. Accepts a `Calendar`
 * instance or the JSON form `CustomCalendarJson` (validated,
 * `PricingError("INVALID_CALENDAR")`). Built-in ids and aliases cannot be
 * replaced (R8, like `isBuiltInIndex` for indices): a redefined `US` would
 * change every USD schedule without a trace in the snapshot id – overlay a
 * holiday feed with `registerCalendarHolidays` instead. Returns the registered
 * calendar.
 */
export function registerCalendar(cal: Calendar | CustomCalendarJson, ...aliases: string[]): Calendar {
  const calendar = isCalendarJson(cal) ? customCalendarFromJson(cal) : cal;
  const ids = [calendar.name, ...aliases].map((k) => k.trim().toUpperCase());
  for (const id of ids) {
    if (BUILT_IN_CALENDAR_IDS.has(id)) {
      throw new PricingError(
        "INVALID_CALENDAR",
        `Calendar id "${id}" is a built-in calendar and cannot be replaced (use registerCalendarHolidays for a holiday feed)`,
        {
          calendar: id,
          builtIn: true,
        },
      );
    }
  }
  for (const id of ids) registry.set(id, calendar);
  return calendar;
}

/**
 * Custom calendars registered at runtime (JSON form, sorted by id) – the
 * `calendars[]` envelope an API / the web app exports and re-imports via
 * `registerCalendar`. Built-in calendars and holiday-feed overlays
 * (`registerCalendarHolidays`) are not part of the list.
 */
export function listCustomCalendars(): CustomCalendarJson[] {
  const seen = new Set<CustomCalendar>();
  for (const cal of registry.values()) {
    const base = cal instanceof FeedOverlayCalendar ? cal.underlying : cal;
    if (base instanceof CustomCalendar) seen.add(base);
  }
  return [...seen].map((c) => c.toJSON()).sort((a, b) => a.id.localeCompare(b.id));
}

function replaceInRegistry(from: Calendar, to: Calendar): void {
  for (const [key, cal] of registry) if (cal === from) registry.set(key, to);
}

/**
 * Override a registered calendar (and all of its aliases) with an explicit
 * holiday list from a production feed (e.g. SIFMA for US, JPX/BoJ for JP,
 * ECB for TARGET). The built-in US / JP / UK / CH / TARGET calendars are
 * rule-based approximations of the major holidays and are meant to be
 * superseded by such a feed in production: for every calendar year that
 * appears in `dates` the feed replaces the rules entirely; other years keep
 * the rule-based holidays. Calling it again for the same id merges the years
 * (a year present in the new feed overrides the previous feed for that year).
 * Joint calendars ("TARGET+US") pick the override up automatically because
 * they are resolved from the registry on each `getCalendar` call.
 */
export function registerCalendarHolidays(id: CalendarId, dates: SerialDate[]): Calendar {
  const key = id.trim().toUpperCase();
  const current = registry.get(key);
  if (!current) throw new PricingError("UNKNOWN_CALENDAR", `Unknown calendar: ${id}`, { calendar: id });
  const overlay = current instanceof FeedOverlayCalendar ? current.withFeed(dates) : new FeedOverlayCalendar(current, dates);
  replaceInRegistry(current, overlay);
  return overlay;
}

/** Remove a holiday-feed override again (restores the rule-based calendar). */
export function clearCalendarHolidays(id: CalendarId): void {
  const current = registry.get(id.trim().toUpperCase());
  if (current instanceof FeedOverlayCalendar) replaceInRegistry(current, current.underlying);
}

/** True when the calendar registered under `id` carries a holiday-feed override. */
export function hasCalendarHolidayFeed(id: CalendarId): boolean {
  return registry.get(id.trim().toUpperCase()) instanceof FeedOverlayCalendar;
}

registerCalendar(new WeekendCalendar(), "NONE", "NULL");
registerCalendar(new TargetCalendar(), "EUR", "TARGET2", "EUTA");
registerCalendar(new GermanyCalendar(), "DEFR", "FRANKFURT");
registerCalendar(new UnitedStatesCalendar(), "USNY", "USD", "NYC", "USGS");
registerCalendar(new UnitedStatesSifmaCalendar(), "SOFR", "USSIFMA", "SIFMA");
registerCalendar(new UnitedKingdomCalendar(), "GB", "GBP", "GBLO", "LONDON");
registerCalendar(new SwitzerlandCalendar(), "CHF", "CHZU", "ZURICH");
registerCalendar(new JapanCalendar(), "JPY", "JPTO", "TOKYO");
// Nordics and Poland (Markt R6-5): currency codes double as calendar ids, like "EUR" / "USD" above.
registerCalendar(new NorwayCalendar(), "NOK", "NOOS", "OSLO");
registerCalendar(new SwedenCalendar(), "SEK", "SEST", "STOCKHOLM");
registerCalendar(new DenmarkCalendar(), "DKK", "DKCO", "COPENHAGEN");
registerCalendar(new PolandCalendar(), "PLN", "PLWA", "WARSAW");
for (const id of registry.keys()) BUILT_IN_CALENDAR_IDS.add(id);

/**
 * Built-in calendars whose weekday holidays 2024–2032 are set-equal to
 * QuantLib 1.43 (`test-data/golden/calendars-quantlib.json`, N7-4 / N8-5):
 * TARGET, US (`UnitedStates(Settlement)`), US-SIFMA (`UnitedStates(SOFR)`), UK,
 * CH, JP, NO, SE, DK, PL (PL up to the documented 24.12. from 2025). The
 * valuation report's convention sentence names exactly these; `DE` is not
 * cross-checked.
 */
export const QUANTLIB_CROSS_CHECKED_CALENDARS: readonly string[] = ["TARGET", "US", "UK", "CH", "JP", "NO", "SE", "DK", "PL", "US-SIFMA"];

/**
 * Resolve a calendar id. Composite ids like "TARGET+US" produce a joint calendar.
 */
export function getCalendar(id: CalendarId | Calendar): Calendar {
  if (typeof id !== "string") return id;
  const parts = id
    .split(/[+,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1) return new JointCalendar(parts.map((p) => getCalendar(p)));
  const cal = registry.get(id.trim().toUpperCase());
  if (!cal) throw new PricingError("UNKNOWN_CALENDAR", `Unknown calendar: ${id}`, { calendar: id });
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
