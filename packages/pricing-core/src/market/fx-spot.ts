import { type Calendar, JointCalendar, addBusinessDays, getCalendar } from "../dates/calendar.js";
import { type SerialDate } from "../dates/date.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "./market-context.js";

/**
 * FX spot conventions: spot settles T+2 business days on the joint calendar
 * of both currencies (plus USD for crosses); a few USD pairs settle T+1.
 */
const T_PLUS_ONE_PAIRS = new Set(["USDCAD", "USDTRY", "USDRUB", "USDPHP"]);

/** Currencies whose quotes are conventionally in pips of 1/100 (JPY-style) rather than 1/10,000. */
const HUNDREDTH_PIP_CURRENCIES = new Set(["JPY", "HUF", "KRW", "IDR", "CLP", "ISK", "PYG", "UGX", "VND"]);

/** Spot lag in business days for a currency pair. */
export function fxSpotLag(base: string, quote: string): number {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  return T_PLUS_ONE_PAIRS.has(`${b}${q}`) || T_PLUS_ONE_PAIRS.has(`${q}${b}`) ? 1 : 2;
}

/** Settlement calendar of a currency (falls back to weekends only when no calendar is registered). */
export function currencyCalendar(ccy: string): Calendar {
  try {
    return getCalendar(ccy.toUpperCase());
  } catch {
    return getCalendar("WEEKEND");
  }
}

/** Joint settlement calendar of a pair: both currencies, plus USD for crosses. */
export function fxPairCalendar(base: string, quote: string): Calendar {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  const cals = [currencyCalendar(b), currencyCalendar(q)];
  if (b !== "USD" && q !== "USD") cals.push(currencyCalendar("USD"));
  return new JointCalendar(cals);
}

/** Spot (or delivery) date `fxSpotLag` business days after `date` on the pair calendar. */
export function fxSpotDateFrom(date: SerialDate, base: string, quote: string): SerialDate {
  return addBusinessDays(date, fxSpotLag(base, quote), fxPairCalendar(base, quote));
}

/**
 * Spot date of a pair for the market's valuation date: an explicit
 * `ctx.fxSpotDates` entry (either quotation order) wins, otherwise the
 * conventional T+2 / T+1 date on the pair calendar.
 */
export function fxSpotDate(ctx: MarketContext, base: string, quote: string): SerialDate {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return ctx.valuationDate;
  const explicit = ctx.fxSpotDates?.[`${b}${q}`] ?? ctx.fxSpotDates?.[`${q}${b}`];
  return explicit ?? fxSpotDateFrom(ctx.valuationDate, b, q);
}

/**
 * FX rate for value on the valuation date ("today" rate) implied by the spot
 * rate and the discount factors to the spot date:
 * S₀ = S · DF_quote(t_spot) / DF_base(t_spot). This is the rate that converts
 * present values (discounted to today) between currencies consistently with
 * the forward curve; converting at the quoted spot instead mis-states PVs by
 * the two-day rate differential. Falls back to the spot rate when a discount
 * curve is missing.
 */
export function fxRateAtValuationDate(ctx: MarketContext, base: string, quote: string, collateral?: string): number {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;
  const spot = getFxSpot(ctx, b, q);
  const ts = fxSpotDate(ctx, b, q);
  if (ts <= ctx.valuationDate) return spot;
  try {
    const dfB = getDiscountCurve(ctx, b, collateral).df(ts);
    const dfQ = getDiscountCurve(ctx, q, collateral).df(ts);
    return (spot * dfQ) / dfB;
  } catch {
    return spot;
  }
}

/** Pip size denominator for a pair: 100 for JPY-style quotes, 10,000 otherwise. */
export function pipFactor(_base: string, quote: string): number {
  return HUNDREDTH_PIP_CURRENCIES.has(quote.toUpperCase()) ? 100 : 10_000;
}
