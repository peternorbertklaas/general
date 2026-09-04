import { type BusinessDayConvention, type CalendarId, getCalendar } from "../dates/calendar.js";
import { type DayCountConvention, normalizeDayCount } from "../dates/daycount.js";
import { PricingError } from "../errors.js";

/** Floating-rate index definition (IBOR term rate or overnight RFR). */
export interface RateIndex {
  name: string;
  currency: string;
  /** "IBOR" (forward-looking term rate) or "OIS" (compounded overnight). */
  type: "IBOR" | "OIS";
  /** Tenor for IBOR indices, e.g. "6M". Overnight indices use "1D". */
  tenor: string;
  dayCount: DayCountConvention;
  /** Calendar of the fixings / publication days (drives the daily RFR compounding grid and IBOR fixing dates). */
  fixingCalendar: CalendarId;
  /**
   * Calendar of the index's accrual / payment schedule when it differs from
   * the fixing calendar (N8-4): SOFR is published on SIFMA business days
   * (`US-SIFMA`, Good Friday closed) while USD payments follow the US
   * settlement calendar (`US`). Default: `fixingCalendar` – read it through
   * `indexScheduleCalendar`.
   */
  paymentCalendar?: CalendarId;
  /** Fixing lag in business days (2 for EURIBOR, 0 for €STR/SOFR). */
  fixingLag: number;
  businessDayConvention: BusinessDayConvention;
  endOfMonth: boolean;
  /** Curve id used to project this index (in a MarketContext). */
  curveId: string;
}

/** Calendar the bootstrap / builders use for an index's accrual and payment schedule (`paymentCalendar`, else `fixingCalendar`). */
export function indexScheduleCalendar(idx: RateIndex): CalendarId {
  return idx.paymentCalendar ?? idx.fixingCalendar;
}

/**
 * Compact constructor for the built-in table below (ModifiedFollowing, EOM).
 * IBOR: fixing lag 2 business days; OIS: overnight, lag 0.
 */
function ibor(name: string, currency: string, tenor: string, dayCount: DayCountConvention, fixingCalendar: CalendarId, curveId: string): RateIndex {
  return { name, currency, type: "IBOR", tenor, dayCount, fixingCalendar, fixingLag: 2, businessDayConvention: "ModifiedFollowing", endOfMonth: true, curveId };
}
function ois(
  name: string,
  currency: string,
  dayCount: DayCountConvention,
  fixingCalendar: CalendarId,
  curveId: string,
  paymentCalendar?: CalendarId,
): RateIndex {
  return {
    name,
    currency,
    type: "OIS",
    tenor: "1D",
    dayCount,
    fixingCalendar,
    ...(paymentCalendar ? { paymentCalendar } : {}),
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId,
  };
}

/**
 * Register of floating-rate indices. Built-in (G5 plus the Nordic and Polish
 * markets, Markt R6-5); extensible at runtime with `registerRateIndex`.
 *
 * | Index          | Ccy | Type | Tenor | Day count | Fixing cal. | Curve id        |
 * |----------------|-----|------|-------|-----------|-------------|-----------------|
 * | EURIBOR-1M…12M | EUR | IBOR | 1M…12M| ACT/360   | TARGET (T-2)| EUR-EURIBOR-<t> |
 * | ESTR           | EUR | OIS  | 1D    | ACT/360   | TARGET      | EUR-ESTR        |
 * | SOFR           | USD | OIS  | 1D    | ACT/360   | US-SIFMA ¹  | USD-SOFR        |
 * | SONIA          | GBP | OIS  | 1D    | ACT/365F  | UK          | GBP-SONIA       |
 * | SARON          | CHF | OIS  | 1D    | ACT/360   | CH          | CHF-SARON       |
 * | TONA           | JPY | OIS  | 1D    | ACT/365F  | JP          | JPY-TONA        |
 * | NIBOR-3M/6M    | NOK | IBOR | 3M/6M | ACT/360   | NO (T-2)    | NOK-NIBOR-<t>   |
 * | NOWA           | NOK | OIS  | 1D    | ACT/365F  | NO          | NOK-NOWA        |
 * | STIBOR-3M/6M   | SEK | IBOR | 3M/6M | ACT/360   | SE (T-2)    | SEK-STIBOR-<t>  |
 * | SWESTR         | SEK | OIS  | 1D    | ACT/360   | SE          | SEK-SWESTR      |
 * | CIBOR-3M/6M    | DKK | IBOR | 3M/6M | ACT/360   | DK (T-2)    | DKK-CIBOR-<t>   |
 * | DESTR          | DKK | OIS  | 1D    | ACT/360   | DK          | DKK-DESTR       |
 * | WIBOR-3M/6M    | PLN | IBOR | 3M/6M | ACT/365F  | PL (T-2)    | PLN-WIBOR-<t>   |
 * | POLONIA        | PLN | OIS  | 1D    | ACT/365F  | PL          | PLN-POLONIA     |
 *
 * The NOK/SEK/DKK/PLN entries follow the published index conventions (Norske
 * Finansielle Referanser, Swedish Bankers' Association / Riksbank, Danish
 * Financial Benchmark Facility / Nationalbanken, GPW Benchmark / NBP; QuantLib
 * `Nowa`/`Swestr`/`Destr`/`Wibor` use the same day counts); the national
 * calendars are rule-based approximations (see `dates/calendar.ts`).
 *
 * ¹ SOFR (N8-4): fixings on the SIFMA / Treasury-market calendar `US-SIFMA`
 * (Good Friday is not a publication day, QuantLib `UnitedStates(SOFR)`), the
 * accrual / payment schedule on the US settlement calendar
 * (`paymentCalendar: "US"`, `indexScheduleCalendar`).
 */
export const RATE_INDICES: Record<string, RateIndex> = {
  "EURIBOR-1M": ibor("EURIBOR-1M", "EUR", "1M", "ACT/360", "TARGET", "EUR-EURIBOR-1M"),
  "EURIBOR-3M": ibor("EURIBOR-3M", "EUR", "3M", "ACT/360", "TARGET", "EUR-EURIBOR-3M"),
  "EURIBOR-6M": ibor("EURIBOR-6M", "EUR", "6M", "ACT/360", "TARGET", "EUR-EURIBOR-6M"),
  "EURIBOR-12M": ibor("EURIBOR-12M", "EUR", "12M", "ACT/360", "TARGET", "EUR-EURIBOR-12M"),
  ESTR: ois("ESTR", "EUR", "ACT/360", "TARGET", "EUR-ESTR"),
  SOFR: ois("SOFR", "USD", "ACT/360", "US-SIFMA", "USD-SOFR", "US"),
  SONIA: ois("SONIA", "GBP", "ACT/365F", "UK", "GBP-SONIA"),
  SARON: ois("SARON", "CHF", "ACT/360", "CH", "CHF-SARON"),
  TONA: ois("TONA", "JPY", "ACT/365F", "JP", "JPY-TONA"),
  // Nordics and Poland (Markt R6-5)
  "NIBOR-3M": ibor("NIBOR-3M", "NOK", "3M", "ACT/360", "NO", "NOK-NIBOR-3M"),
  "NIBOR-6M": ibor("NIBOR-6M", "NOK", "6M", "ACT/360", "NO", "NOK-NIBOR-6M"),
  NOWA: ois("NOWA", "NOK", "ACT/365F", "NO", "NOK-NOWA"),
  "STIBOR-3M": ibor("STIBOR-3M", "SEK", "3M", "ACT/360", "SE", "SEK-STIBOR-3M"),
  "STIBOR-6M": ibor("STIBOR-6M", "SEK", "6M", "ACT/360", "SE", "SEK-STIBOR-6M"),
  SWESTR: ois("SWESTR", "SEK", "ACT/360", "SE", "SEK-SWESTR"),
  "CIBOR-3M": ibor("CIBOR-3M", "DKK", "3M", "ACT/360", "DK", "DKK-CIBOR-3M"),
  "CIBOR-6M": ibor("CIBOR-6M", "DKK", "6M", "ACT/360", "DK", "DKK-CIBOR-6M"),
  DESTR: ois("DESTR", "DKK", "ACT/360", "DK", "DKK-DESTR"),
  "WIBOR-3M": ibor("WIBOR-3M", "PLN", "3M", "ACT/365F", "PL", "PLN-WIBOR-3M"),
  "WIBOR-6M": ibor("WIBOR-6M", "PLN", "6M", "ACT/365F", "PL", "PLN-WIBOR-6M"),
  POLONIA: ois("POLONIA", "PLN", "ACT/365F", "PL", "PLN-POLONIA"),
};

export function getIndex(name: string): RateIndex {
  const idx = typeof name === "string" ? RATE_INDICES[name.toUpperCase()] : undefined;
  if (!idx) throw new PricingError("UNKNOWN_INDEX", `Unknown rate index: ${String(name)}`, { index: name });
  return idx;
}

/** Standard market conventions for fixed legs per currency (used for defaults and par swaps). */
export interface SwapConventions {
  currency: string;
  fixedFrequency: string;
  fixedDayCount: DayCountConvention;
  floatIndex: string;
  floatFrequency: string;
  calendar: CalendarId;
  spotLag: number;
  /** OIS index and conventions */
  oisIndex: string;
  oisFixedFrequency: string;
  oisFixedDayCount: DayCountConvention;
  oisPaymentLag: number;
}

/**
 * Register of vanilla-swap conventions per currency (fixed leg vs the
 * currency's benchmark float index, plus the OIS conventions used for
 * discount-curve bootstrapping). Built-in G5 + NOK/SEK/DKK/PLN (Markt R6-5);
 * extensible with `registerSwapConventions`.
 *
 * | Ccy | Fixed leg          | Float leg         | Calendar | Spot | OIS (fixed leg, pay lag)     |
 * |-----|--------------------|-------------------|----------|------|------------------------------|
 * | EUR | 1Y 30E/360         | EURIBOR-6M 6M     | TARGET   | T+2  | ESTR 1Y ACT/360, T+1         |
 * | USD | 1Y ACT/360         | SOFR 1Y           | US       | T+2  | SOFR 1Y ACT/360, T+2         |
 * | GBP | 1Y ACT/365F        | SONIA 1Y          | UK       | T+0  | SONIA 1Y ACT/365F, T+0       |
 * | CHF | 1Y ACT/360         | SARON 1Y          | CH       | T+2  | SARON 1Y ACT/360, T+2        |
 * | JPY | 1Y ACT/365F        | TONA 1Y           | JP       | T+2  | TONA 1Y ACT/365F, T+2        |
 * | NOK | 1Y 30/360          | NIBOR-6M 6M       | NO       | T+2  | NOWA 1Y ACT/365F, T+2        |
 * | SEK | 1Y 30/360          | STIBOR-3M 3M      | SE       | T+2  | SWESTR 1Y ACT/360, T+2       |
 * | DKK | 1Y 30/360          | CIBOR-6M 6M       | DK       | T+2  | DESTR 1Y ACT/360, T+2        |
 * | PLN | 1Y ACT/ACT ISDA    | WIBOR-6M 6M       | PL       | T+2  | POLONIA 1Y ACT/365F, T+2     |
 *
 * The Nordic/Polish rows are the interdealer standards (Bloomberg SWPM /
 * LSEG defaults); indicative where a market quotes several variants (SEK
 * STIBOR-3M is the liquid tenor, DKK CIBOR-6M). Override with
 * `registerSwapConventions` when a desk uses different terms.
 */
export const SWAP_CONVENTIONS: Record<string, SwapConventions> = {
  EUR: {
    currency: "EUR",
    fixedFrequency: "1Y",
    fixedDayCount: "30E/360",
    floatIndex: "EURIBOR-6M",
    floatFrequency: "6M",
    calendar: "TARGET",
    spotLag: 2,
    oisIndex: "ESTR",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 1,
  },
  USD: {
    currency: "USD",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/360",
    floatIndex: "SOFR",
    floatFrequency: "1Y",
    calendar: "US",
    spotLag: 2,
    oisIndex: "SOFR",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 2,
  },
  GBP: {
    currency: "GBP",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/365F",
    floatIndex: "SONIA",
    floatFrequency: "1Y",
    calendar: "UK",
    spotLag: 0,
    oisIndex: "SONIA",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/365F",
    oisPaymentLag: 0,
  },
  CHF: {
    currency: "CHF",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/360",
    floatIndex: "SARON",
    floatFrequency: "1Y",
    calendar: "CH",
    spotLag: 2,
    oisIndex: "SARON",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 2,
  },
  JPY: {
    currency: "JPY",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/365F",
    floatIndex: "TONA",
    floatFrequency: "1Y",
    calendar: "JP",
    spotLag: 2,
    oisIndex: "TONA",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/365F",
    oisPaymentLag: 2,
  },
  // Nordics and Poland (Markt R6-5)
  NOK: {
    currency: "NOK",
    fixedFrequency: "1Y",
    fixedDayCount: "30/360",
    floatIndex: "NIBOR-6M",
    floatFrequency: "6M",
    calendar: "NO",
    spotLag: 2,
    oisIndex: "NOWA",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/365F",
    oisPaymentLag: 2,
  },
  SEK: {
    currency: "SEK",
    fixedFrequency: "1Y",
    fixedDayCount: "30/360",
    floatIndex: "STIBOR-3M",
    floatFrequency: "3M",
    calendar: "SE",
    spotLag: 2,
    oisIndex: "SWESTR",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 2,
  },
  DKK: {
    currency: "DKK",
    fixedFrequency: "1Y",
    fixedDayCount: "30/360",
    floatIndex: "CIBOR-6M",
    floatFrequency: "6M",
    calendar: "DK",
    spotLag: 2,
    oisIndex: "DESTR",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 2,
  },
  PLN: {
    currency: "PLN",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/ACT ISDA",
    floatIndex: "WIBOR-6M",
    floatFrequency: "6M",
    calendar: "PL",
    spotLag: 2,
    oisIndex: "POLONIA",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/365F",
    oisPaymentLag: 2,
  },
};

export function getSwapConventions(ccy: string): SwapConventions {
  const c = typeof ccy === "string" ? SWAP_CONVENTIONS[ccy.toUpperCase()] : undefined;
  if (!c) throw new PricingError("INVALID_TRADE", `No swap conventions for currency ${String(ccy)}`, { currency: ccy });
  return c;
}

// ---------------------------------------------------------------------------
// Runtime registration (Markt R6-5): open the currency / index register the way
// `registerCalendar` opens the calendar registry – a market-data adapter or the
// API can add a currency without a code change.
// ---------------------------------------------------------------------------

const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isNonNegInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
const FREQUENCY = /^([1-9]\d{0,2}[DWMY]|ZC)$/i;

function invalid(what: string, detail: string, def: unknown): never {
  throw new PricingError("INVALID_CURVE_SPEC", `${what}: ${detail}`, { definition: def });
}

function dayCountProblem(dc: unknown): string | undefined {
  try {
    normalizeDayCount(dc as DayCountConvention);
    return undefined;
  } catch {
    return `unknown day count ${JSON.stringify(dc)}`;
  }
}

function calendarProblem(id: unknown, what = "calendar"): string | undefined {
  if (!isStr(id)) return `${what} id missing`;
  try {
    getCalendar(id);
    return undefined;
  } catch {
    return `unknown ${what} ${JSON.stringify(id)} (register it with registerCalendar first)`;
  }
}

/** Names of the indices shipped with the engine (frozen at module load, N7-7). */
const BUILT_IN_INDEX_NAMES: ReadonlySet<string> = new Set(Object.keys(RATE_INDICES));

/** True when `name` (any case) is one of the indices shipped with the engine (`EURIBOR-6M`, `SOFR`, `NIBOR-6M`, …). */
export function isBuiltInIndex(name: string): boolean {
  return BUILT_IN_INDEX_NAMES.has(String(name).toUpperCase());
}

const BDCS = ["Following", "ModifiedFollowing", "Preceding", "ModifiedPreceding", "Unadjusted"];

/**
 * Problems of an index definition (empty = valid) – the checks of
 * `registerRateIndex` without registering anything (R8, Architektur N8-04: an
 * envelope importer validates every entry before it registers the first one).
 * Includes the built-in-name rule (N7-7) and, when given, the
 * `paymentCalendar`.
 */
export function validateRateIndex(def: unknown): string[] {
  const out: string[] = [];
  const d = def as Partial<RateIndex> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["definition must be an object"];
  if (!isStr(d.name) || /\s/.test(d.name)) out.push("name must be a non-empty string without whitespace");
  else if (isBuiltInIndex(d.name)) {
    out.push(
      `${d.name.toUpperCase()} is a built-in index and cannot be replaced (valuations would change without a trace in the snapshot id); register the variant under a new name`,
    );
  }
  if (!isStr(d.currency) || !/^[A-Za-z]{3}$/.test(d.currency)) out.push("currency must be a 3-letter code");
  if (d.type !== "IBOR" && d.type !== "OIS") out.push('type must be "IBOR" or "OIS"');
  else if (d.type === "OIS" ? d.tenor !== "1D" : !/^[1-9]\d{0,2}[MWY]$/i.test(String(d.tenor))) {
    out.push(d.type === "OIS" ? 'overnight indices use tenor "1D"' : `IBOR tenor must be like "3M" (got ${JSON.stringify(d.tenor)})`);
  }
  const dc = dayCountProblem(d.dayCount);
  if (dc) out.push(dc);
  const cal = calendarProblem(d.fixingCalendar);
  if (cal) out.push(cal);
  if (d.paymentCalendar !== undefined) {
    const pc = calendarProblem(d.paymentCalendar, "paymentCalendar");
    if (pc) out.push(pc);
  }
  if (!isNonNegInt(d.fixingLag)) out.push("fixingLag must be a non-negative integer");
  if (!BDCS.includes(String(d.businessDayConvention))) out.push(`unknown businessDayConvention ${JSON.stringify(d.businessDayConvention)}`);
  if (typeof d.endOfMonth !== "boolean") out.push("endOfMonth must be a boolean");
  if (!isStr(d.curveId)) out.push("curveId missing");
  return out;
}

/**
 * Register a floating-rate index at runtime (or replace one registered at
 * runtime). Validates the definition (3-letter currency, type, tenor "<n>M|W|Y"
 * for IBOR / "1D" for OIS, known day count, registered calendar(s), non-negative
 * integer fixing lag, curve id – `validateRateIndex`) and raises
 * `PricingError("INVALID_CURVE_SPEC")` listing the problems otherwise. The
 * name is stored upper-cased, exactly as `getIndex` looks it up; after the call
 * the index can be used in curve specs (`bootstrapCurves`), swap legs and
 * builders. Returns the stored definition.
 *
 * Built-in indices cannot be replaced (N7-7, `INVALID_CURVE_SPEC`): an index
 * definition (day count, fixing calendar / lag, projection curve) enters the
 * valuation of every trade referencing the name without appearing in the trade
 * or in the market snapshot, so a redefined `EURIBOR-6M` would change PVs
 * (10Y payer −104 453.86 → −69 635.91 with ACT/365F) while `marketSnapshotId`,
 * `inputsHash` and `reportHash` stay identical. Register a desk-specific
 * variant under its own name instead (`EURIBOR-6M-ACT365`) and reference it
 * from the trade. `registerSwapConventions` may still override a built-in
 * currency's conventions: they only shape builder defaults and bootstrap
 * schedules, both of which are visible in the trade / the curve nodes.
 */
export function registerRateIndex(def: RateIndex): RateIndex {
  const what = `registerRateIndex(${isStr(def?.name) ? def.name : "?"})`;
  const problems = validateRateIndex(def);
  if (problems.length) invalid(what, problems.join("; "), def);
  const stored: RateIndex = { ...def, name: def.name.toUpperCase(), currency: def.currency.toUpperCase(), tenor: def.tenor.toUpperCase() };
  RATE_INDICES[stored.name] = stored;
  return stored;
}

/** Options of `validateSwapConventions`. */
export interface ValidateConventionsOptions {
  /**
   * Index definitions that are about to be registered together with the
   * conventions (envelope import): they count as registered for the
   * `floatIndex` / `oisIndex` checks.
   */
  pendingIndices?: RateIndex[];
}

/**
 * Problems of a swap-conventions definition (empty = valid) – the checks of
 * `registerSwapConventions` without registering anything (R8, Architektur
 * N8-04). Either `validateSwapConventions(conv)` or
 * `validateSwapConventions(ccy, conv)` (the currency the caller expects – a
 * mismatch with `conv.currency` is a problem). `opts.pendingIndices` lets an
 * atomic envelope import validate conventions whose indices are part of the
 * same envelope.
 */
export function validateSwapConventions(conv: unknown, opts?: ValidateConventionsOptions): string[];
export function validateSwapConventions(ccy: string, conv: unknown, opts?: ValidateConventionsOptions): string[];
export function validateSwapConventions(a: unknown, b?: unknown, c?: ValidateConventionsOptions): string[] {
  const expectedCcy = typeof a === "string" ? a : undefined;
  const conv = (typeof a === "string" ? b : a) as Partial<SwapConventions> | null;
  const opts = (typeof a === "string" ? c : (b as ValidateConventionsOptions | undefined)) ?? {};
  const out: string[] = [];
  if (!conv || typeof conv !== "object" || Array.isArray(conv)) return ["conventions must be an object"];
  if (!isStr(conv.currency) || !/^[A-Za-z]{3}$/.test(conv.currency)) out.push("currency must be a 3-letter code");
  else if (expectedCcy !== undefined && conv.currency.toUpperCase() !== expectedCcy.toUpperCase()) {
    out.push(`currency ${conv.currency} does not match ${expectedCcy}`);
  }
  const ccy = isStr(conv.currency) ? conv.currency.toUpperCase() : "?";
  for (const [key, f] of [
    ["fixedFrequency", conv.fixedFrequency],
    ["floatFrequency", conv.floatFrequency],
    ["oisFixedFrequency", conv.oisFixedFrequency],
  ] as const) {
    if (!isStr(f) || !FREQUENCY.test(f)) out.push(`${key} must match ${String(FREQUENCY)} (got ${JSON.stringify(f)})`);
  }
  for (const [key, dc] of [
    ["fixedDayCount", conv.fixedDayCount],
    ["oisFixedDayCount", conv.oisFixedDayCount],
  ] as const) {
    const p = dayCountProblem(dc);
    if (p) out.push(`${key}: ${p}`);
  }
  const cal = calendarProblem(conv.calendar);
  if (cal) out.push(cal);
  if (!isNonNegInt(conv.spotLag) || !isNonNegInt(conv.oisPaymentLag)) out.push("spotLag and oisPaymentLag must be non-negative integers");
  const pending = new Map((opts.pendingIndices ?? []).filter((i) => isStr(i?.name)).map((i) => [i.name.toUpperCase(), i] as const));
  for (const [key, name, type] of [
    ["floatIndex", conv.floatIndex, undefined],
    ["oisIndex", conv.oisIndex, "OIS"],
  ] as const) {
    const idx = isStr(name) ? (RATE_INDICES[name.toUpperCase()] ?? pending.get(name.toUpperCase())) : undefined;
    if (!idx) {
      out.push(`${key} ${JSON.stringify(name)} is not a registered index (registerRateIndex first)`);
      continue;
    }
    if (String(idx.currency).toUpperCase() !== ccy) out.push(`${key} ${idx.name} belongs to ${idx.currency}, not ${ccy}`);
    if (type && idx.type !== type) out.push(`${key} ${idx.name} must be an ${type} index`);
  }
  return out;
}

/**
 * Register (or replace) the vanilla-swap / OIS conventions of a currency at
 * runtime. Both referenced indices must already be registered and belong to
 * the currency; frequencies follow the leg pattern (`1Y`, `6M`, `ZC`), day
 * counts and calendar must be known, lags non-negative integers
 * (`validateSwapConventions`) – otherwise `PricingError("INVALID_CURVE_SPEC")`.
 * Afterwards `getSwapConventions`, the builders (`makeVanillaSwap`,
 * `makeFxForward`, …) and the bootstrap accept the currency. Returns the
 * stored conventions.
 */
export function registerSwapConventions(conv: SwapConventions): SwapConventions {
  const what = `registerSwapConventions(${isStr(conv?.currency) ? conv.currency : "?"})`;
  const problems = validateSwapConventions(conv);
  if (problems.length) invalid(what, problems.join("; "), conv);
  const ccy = conv.currency.toUpperCase();
  const stored: SwapConventions = { ...conv, currency: ccy, floatIndex: conv.floatIndex.toUpperCase(), oisIndex: conv.oisIndex.toUpperCase() };
  SWAP_CONVENTIONS[ccy] = stored;
  return stored;
}

/** Currencies with registered swap conventions (sorted), i.e. the currencies a curve can be bootstrapped and a swap built in. */
export function knownCurrencies(): string[] {
  return Object.keys(SWAP_CONVENTIONS).sort();
}

/** Registered indices (sorted by name), optionally of one currency. */
export function knownIndices(currency?: string): RateIndex[] {
  const ccy = currency?.toUpperCase();
  return Object.values(RATE_INDICES)
    .filter((i) => ccy === undefined || i.currency === ccy)
    .sort((a, b) => a.name.localeCompare(b.name));
}
