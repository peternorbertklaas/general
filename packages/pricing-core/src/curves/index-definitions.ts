import { type BusinessDayConvention, type CalendarId } from "../dates/calendar.js";
import { type DayCountConvention } from "../dates/daycount.js";
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
  fixingCalendar: CalendarId;
  /** Fixing lag in business days (2 for EURIBOR, 0 for €STR/SOFR). */
  fixingLag: number;
  businessDayConvention: BusinessDayConvention;
  endOfMonth: boolean;
  /** Curve id used to project this index (in a MarketContext). */
  curveId: string;
}

export const RATE_INDICES: Record<string, RateIndex> = {
  "EURIBOR-1M": {
    name: "EURIBOR-1M",
    currency: "EUR",
    type: "IBOR",
    tenor: "1M",
    dayCount: "ACT/360",
    fixingCalendar: "TARGET",
    fixingLag: 2,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "EUR-EURIBOR-1M",
  },
  "EURIBOR-3M": {
    name: "EURIBOR-3M",
    currency: "EUR",
    type: "IBOR",
    tenor: "3M",
    dayCount: "ACT/360",
    fixingCalendar: "TARGET",
    fixingLag: 2,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "EUR-EURIBOR-3M",
  },
  "EURIBOR-6M": {
    name: "EURIBOR-6M",
    currency: "EUR",
    type: "IBOR",
    tenor: "6M",
    dayCount: "ACT/360",
    fixingCalendar: "TARGET",
    fixingLag: 2,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "EUR-EURIBOR-6M",
  },
  "EURIBOR-12M": {
    name: "EURIBOR-12M",
    currency: "EUR",
    type: "IBOR",
    tenor: "12M",
    dayCount: "ACT/360",
    fixingCalendar: "TARGET",
    fixingLag: 2,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "EUR-EURIBOR-12M",
  },
  ESTR: {
    name: "ESTR",
    currency: "EUR",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/360",
    fixingCalendar: "TARGET",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "EUR-ESTR",
  },
  SOFR: {
    name: "SOFR",
    currency: "USD",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/360",
    fixingCalendar: "US",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "USD-SOFR",
  },
  SONIA: {
    name: "SONIA",
    currency: "GBP",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/365F",
    fixingCalendar: "UK",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "GBP-SONIA",
  },
  SARON: {
    name: "SARON",
    currency: "CHF",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/360",
    fixingCalendar: "CH",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "CHF-SARON",
  },
  TONA: {
    name: "TONA",
    currency: "JPY",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/365F",
    fixingCalendar: "JP",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "JPY-TONA",
  },
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
};

export function getSwapConventions(ccy: string): SwapConventions {
  const c = typeof ccy === "string" ? SWAP_CONVENTIONS[ccy.toUpperCase()] : undefined;
  if (!c) throw new PricingError("INVALID_TRADE", `No swap conventions for currency ${String(ccy)}`, { currency: ccy });
  return c;
}
