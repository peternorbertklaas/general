import { getIndex, getSwapConventions } from "../curves/index-definitions.js";
import { addBusinessDays, advance, getCalendar } from "../dates/calendar.js";
import { type SerialDate, addTenor } from "../dates/date.js";
import { type CapFloor, type FxForward, type FxOption, type InterestRateSwap, type Swaption } from "./types.js";

let counter = 0;
export function nextTradeId(prefix = "T"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface VanillaSwapParams {
  id?: string;
  currency: string;
  notional: number;
  /** "Pay" = pay fixed (payer swap). */
  payReceiveFixed: "Pay" | "Receive";
  fixedRate: number;
  effectiveDate: SerialDate;
  /** Maturity as tenor string (e.g. "5Y") or explicit date. */
  maturity: string | SerialDate;
  index?: string;
  spread?: number;
  fixedFrequency?: string;
  floatFrequency?: string;
  counterparty?: string;
  collateralCurrency?: string;
  name?: string;
}

/** Build a market-standard fixed/float swap for the currency's conventions. */
export function makeVanillaSwap(p: VanillaSwapParams): InterestRateSwap {
  const conv = getSwapConventions(p.currency);
  const indexName = p.index ?? conv.floatIndex;
  const idx = getIndex(indexName);
  // Unadjusted termination date: the schedule rolls from it and applies the
  // business-day convention itself (avoids artificial 1-day stubs).
  const maturity = typeof p.maturity === "string" ? addTenor(p.effectiveDate, p.maturity) : p.maturity;
  const isOis = idx.type === "OIS";
  const fixedFreq = p.fixedFrequency ?? (isOis ? conv.oisFixedFrequency : conv.fixedFrequency);
  const floatFreq = p.floatFrequency ?? (isOis ? conv.oisFixedFrequency : idx.tenor);
  const payLag = isOis ? conv.oisPaymentLag : 0;
  const floatPR = p.payReceiveFixed === "Pay" ? "Receive" : "Pay";
  return {
    id: p.id ?? nextTradeId("IRS"),
    name: p.name ?? `${p.payReceiveFixed === "Pay" ? "Payer" : "Receiver"} ${p.currency} ${typeof p.maturity === "string" ? p.maturity : ""} @ ${(p.fixedRate * 100).toFixed(3)}%`,
    type: "InterestRateSwap",
    counterparty: p.counterparty,
    collateralCurrency: p.collateralCurrency,
    legs: [
      {
        type: "Fixed", payReceive: p.payReceiveFixed, notional: p.notional, currency: p.currency, effectiveDate: p.effectiveDate,
        terminationDate: maturity, frequency: fixedFreq, dayCount: isOis ? conv.oisFixedDayCount : conv.fixedDayCount,
        calendar: conv.calendar, businessDayConvention: "ModifiedFollowing", rate: p.fixedRate, paymentLag: payLag, stub: "ShortFront",
      },
      {
        type: "Float", payReceive: floatPR, notional: p.notional, currency: p.currency, effectiveDate: p.effectiveDate,
        terminationDate: maturity, frequency: floatFreq, dayCount: idx.dayCount, calendar: conv.calendar,
        businessDayConvention: "ModifiedFollowing", index: idx.name, spread: p.spread ?? 0, paymentLag: payLag, stub: "ShortFront",
      },
    ],
  };
}

export function makeCapFloor(p: {
  id?: string;
  currency: string;
  notional: number;
  capFloor: "Cap" | "Floor" | "Collar";
  strike: number;
  floorStrike?: number;
  effectiveDate: SerialDate;
  maturity: string | SerialDate;
  index?: string;
  longShort?: "Long" | "Short";
  counterparty?: string;
}): CapFloor {
  const conv = getSwapConventions(p.currency);
  const indexName = p.index ?? (p.currency === "EUR" ? "EURIBOR-6M" : conv.floatIndex);
  const idx = getIndex(indexName);
  const maturity = typeof p.maturity === "string" ? addTenor(p.effectiveDate, p.maturity) : p.maturity;
  return {
    id: p.id ?? nextTradeId("CAP"),
    name: `${p.capFloor} ${p.currency} ${typeof p.maturity === "string" ? p.maturity : ""} @ ${(p.strike * 100).toFixed(2)}%`,
    type: "CapFloor",
    capFloor: p.capFloor,
    payReceive: (p.longShort ?? "Long") === "Long" ? "Receive" : "Pay",
    notional: p.notional,
    currency: p.currency,
    index: idx.name,
    effectiveDate: p.effectiveDate,
    terminationDate: maturity,
    frequency: idx.tenor === "1D" ? "3M" : idx.tenor,
    dayCount: idx.dayCount,
    calendar: conv.calendar,
    strike: p.strike,
    floorStrike: p.floorStrike,
    counterparty: p.counterparty,
  };
}

export function makeSwaption(p: {
  id?: string;
  currency: string;
  notional: number;
  payerReceiver: "Payer" | "Receiver";
  strike: number;
  expiry: string | SerialDate;
  tenor: string;
  valuationDate: SerialDate;
  settlement?: "Physical" | "Cash";
  longShort?: "Long" | "Short";
  counterparty?: string;
}): Swaption {
  const conv = getSwapConventions(p.currency);
  const cal = getCalendar(conv.calendar);
  const expiry = typeof p.expiry === "string" ? advance(p.valuationDate, p.expiry, cal, "ModifiedFollowing") : p.expiry;
  const swapStart = addBusinessDays(expiry, conv.spotLag, cal);
  const underlying = makeVanillaSwap({
    currency: p.currency,
    notional: p.notional,
    payReceiveFixed: p.payerReceiver === "Payer" ? "Pay" : "Receive",
    fixedRate: p.strike,
    effectiveDate: swapStart,
    maturity: p.tenor,
    id: `${p.id ?? "SWPT"}-UL`,
  });
  return {
    id: p.id ?? nextTradeId("SWPT"),
    name: `${p.payerReceiver} swaption ${typeof p.expiry === "string" ? p.expiry : ""}x${p.tenor} @ ${(p.strike * 100).toFixed(3)}%`,
    type: "Swaption",
    payReceive: (p.longShort ?? "Long") === "Long" ? "Receive" : "Pay",
    payerReceiver: p.payerReceiver,
    expiryDate: expiry,
    settlement: p.settlement ?? "Physical",
    underlying,
    counterparty: p.counterparty,
  };
}

export function makeFxForward(p: {
  id?: string;
  pair: string; // "EURUSD"
  /** Positive = buy base / sell quote. */
  baseAmount: number;
  rate: number;
  deliveryDate: SerialDate;
  counterparty?: string;
}): FxForward {
  const base = p.pair.slice(0, 3).toUpperCase();
  const quote = p.pair.slice(3, 6).toUpperCase();
  const buyBase = p.baseAmount > 0;
  const abs = Math.abs(p.baseAmount);
  return {
    id: p.id ?? nextTradeId("FXF"),
    name: `${buyBase ? "Buy" : "Sell"} ${base}${quote} ${abs.toLocaleString("de-DE")} @ ${p.rate}`,
    type: "FxForward",
    buyCurrency: buyBase ? base : quote,
    buyAmount: buyBase ? abs : abs * p.rate,
    sellCurrency: buyBase ? quote : base,
    sellAmount: buyBase ? abs * p.rate : abs,
    deliveryDate: p.deliveryDate,
    counterparty: p.counterparty,
  };
}

export function makeFxOption(p: {
  id?: string;
  pair: string;
  optionType: "Call" | "Put";
  notional: number;
  strike: number;
  expiryDate: SerialDate;
  deliveryDate?: SerialDate;
  longShort?: "Long" | "Short";
  counterparty?: string;
}): FxOption {
  const quote = p.pair.slice(3, 6).toUpperCase();
  return {
    id: p.id ?? nextTradeId("FXO"),
    name: `${p.optionType} ${p.pair.toUpperCase()} ${p.notional.toLocaleString("de-DE")} @ ${p.strike}`,
    type: "FxOption",
    payReceive: (p.longShort ?? "Long") === "Long" ? "Receive" : "Pay",
    optionType: p.optionType,
    pair: p.pair.toUpperCase(),
    strike: p.strike,
    notional: p.notional,
    expiryDate: p.expiryDate,
    deliveryDate: p.deliveryDate ?? p.expiryDate + 2,
    premiumCurrency: quote,
    counterparty: p.counterparty,
  };
}
