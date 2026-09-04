import { RATE_INDICES, getIndex, getSwapConventions, indexScheduleCalendar } from "../curves/index-definitions.js";
import { type CalendarId, addBusinessDays, advance, getCalendar } from "../dates/calendar.js";
import { type SerialDate, addTenor, immDate, nextImmDate, today, toYMD } from "../dates/date.js";
import { buildSchedule, frequencyPerYear } from "../dates/schedule.js";
import { formatDe, formatPctDe } from "../format.js";
import { fxSpotDateFrom, pipFactor } from "../market/fx-spot.js";
import { PricingError } from "../errors.js";
import {
  type CapFloor,
  type CrossCurrencySwap,
  type FloatLeg,
  type ForwardRateAgreement,
  type FxForward,
  type FxOption,
  type FxSwap,
  type InterestRateSwap,
  type PayReceive,
  type SwapLeg,
  type Swaption,
} from "./types.js";

let counter = 0;
export function nextTradeId(prefix = "T"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/**
 * Default trade names are German display strings (decimal comma, "EUR/USD"
 * pair notation, German product words) – the same form the UI shows, so no
 * client-side translation of core names is needed.
 */
function pairDe(pair: string): string {
  const p = pair.replace("/", "").toUpperCase();
  return `${p.slice(0, 3)}/${p.slice(3, 6)}`;
}

/** Rate quote for names: decimal comma, `digits` decimals, e.g. rateDe(0.031, 3) → "3,100 %". */
function rateDe(rate: number, digits = 3): string {
  return formatPctDe(rate, digits);
}

/** FX rate / strike for names: decimal comma, trailing zeros trimmed to at least 4 decimals (1.18 → "1,1800"). */
function fxRateDe(rate: number): string {
  const s = String(rate);
  const decimals = s.includes(".") ? s.split(".")[1]!.length : 0;
  return formatDe(rate, Math.max(4, Math.min(decimals, 6)));
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
  /**
   * Step-up / step-down coupon: from each `date` on the fixed leg pays `rate`
   * instead of `fixedRate` (Zinstreppe). Stored as `FixedLeg.rateSchedule`
   * with `fixedRate` applying to the first period(s).
   */
  stepUp?: { date: SerialDate; rate: number }[];
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
  const rateSchedule = p.stepUp?.length ? [{ date: p.effectiveDate, rate: p.fixedRate }, ...[...p.stepUp].sort((a, b) => a.date - b.date)] : undefined;
  return {
    id: p.id ?? nextTradeId("IRS"),
    name:
      p.name ??
      `${p.payReceiveFixed === "Pay" ? "Payer" : "Receiver"}-Swap ${p.currency} ${typeof p.maturity === "string" ? p.maturity : ""} @ ${rateDe(p.fixedRate)}${rateSchedule ? " (Step-up)" : ""}`.replace(
        /\s+/g,
        " ",
      ),
    type: "InterestRateSwap",
    counterparty: p.counterparty,
    collateralCurrency: p.collateralCurrency,
    legs: [
      {
        type: "Fixed",
        payReceive: p.payReceiveFixed,
        notional: p.notional,
        currency: p.currency,
        effectiveDate: p.effectiveDate,
        terminationDate: maturity,
        frequency: fixedFreq,
        dayCount: isOis ? conv.oisFixedDayCount : conv.fixedDayCount,
        calendar: conv.calendar,
        businessDayConvention: "ModifiedFollowing",
        rate: p.fixedRate,
        paymentLag: payLag,
        stub: "ShortFront",
        ...(rateSchedule ? { rateSchedule } : {}),
      },
      {
        type: "Float",
        payReceive: floatPR,
        notional: p.notional,
        currency: p.currency,
        effectiveDate: p.effectiveDate,
        terminationDate: maturity,
        frequency: floatFreq,
        dayCount: idx.dayCount,
        calendar: conv.calendar,
        businessDayConvention: "ModifiedFollowing",
        index: idx.name,
        spread: p.spread ?? 0,
        paymentLag: payLag,
        stub: "ShortFront",
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
    name: `${p.capFloor} ${p.currency} ${typeof p.maturity === "string" ? p.maturity : ""} @ ${rateDe(p.strike, 2)}`.replace(/\s+/g, " "),
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
    name: `${p.payerReceiver}-Swaption ${typeof p.expiry === "string" ? p.expiry : ""}×${p.tenor} @ ${rateDe(p.strike)}`,
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
    name: `${buyBase ? "Kauf" : "Verkauf"} ${pairDe(p.pair)} ${formatDe(abs, 0)} @ ${fxRateDe(p.rate)}`,
    type: "FxForward",
    buyCurrency: buyBase ? base : quote,
    buyAmount: buyBase ? abs : abs * p.rate,
    sellCurrency: buyBase ? quote : base,
    sellAmount: buyBase ? abs * p.rate : abs,
    deliveryDate: p.deliveryDate,
    counterparty: p.counterparty,
  };
}

/**
 * FX option. The delivery date defaults to the spot date of the expiry
 * (T+2 / T+1 business days on the pair calendar), so it never falls on a
 * weekend or holiday. An optional `barrier` gets an explicit knock-out rebate
 * convention – `rebateAt: "hit"` (QuantLib) unless given (R9, N7-5 rest).
 */
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
  barrier?: NonNullable<FxOption["barrier"]>;
}): FxOption {
  const base = p.pair.slice(0, 3).toUpperCase();
  const quote = p.pair.slice(3, 6).toUpperCase();
  const barrier: FxOption["barrier"] = p.barrier ? { ...p.barrier, rebateAt: p.barrier.rebateAt ?? "hit" } : undefined;
  return {
    ...(barrier ? { barrier } : {}),
    id: p.id ?? nextTradeId("FXO"),
    name: `${p.optionType} ${pairDe(p.pair)} ${formatDe(p.notional, 0)} @ ${fxRateDe(p.strike)}`,
    type: "FxOption",
    payReceive: (p.longShort ?? "Long") === "Long" ? "Receive" : "Pay",
    optionType: p.optionType,
    pair: p.pair.toUpperCase(),
    strike: p.strike,
    notional: p.notional,
    expiryDate: p.expiryDate,
    deliveryDate: p.deliveryDate ?? fxSpotDateFrom(p.expiryDate, base, quote),
    premiumCurrency: quote,
    counterparty: p.counterparty,
  };
}

/** Tenor basis swap: receive index A + spread vs pay index B (same currency). */
export function makeBasisSwap(p: {
  id?: string;
  currency: string;
  notional: number;
  effectiveDate: SerialDate;
  maturity: string | SerialDate;
  receiveIndex: string;
  payIndex: string;
  /** Spread (decimal) on the receive leg. */
  spread: number;
  counterparty?: string;
  name?: string;
}): InterestRateSwap {
  const conv = getSwapConventions(p.currency);
  const maturity = typeof p.maturity === "string" ? addTenor(p.effectiveDate, p.maturity) : p.maturity;
  const mk = (index: string, payReceive: "Pay" | "Receive", spread: number) => {
    const idx = getIndex(index);
    const isOis = idx.type === "OIS";
    return {
      type: "Float" as const,
      payReceive,
      notional: p.notional,
      currency: p.currency,
      effectiveDate: p.effectiveDate,
      terminationDate: maturity,
      frequency: isOis ? "3M" : idx.tenor,
      dayCount: idx.dayCount,
      calendar: conv.calendar,
      businessDayConvention: "ModifiedFollowing" as const,
      index: idx.name,
      spread,
      paymentLag: isOis ? conv.oisPaymentLag : 0,
      stub: "ShortFront" as const,
    };
  };
  return {
    id: p.id ?? nextTradeId("BASIS"),
    name:
      p.name ??
      `Basis-Swap ${p.receiveIndex} ${p.spread >= 0 ? "+" : ""}${formatDe(p.spread * 1e4, 1)} bp vs ${p.payIndex} ${typeof p.maturity === "string" ? p.maturity : ""}`.trim(),
    type: "InterestRateSwap",
    counterparty: p.counterparty,
    legs: [mk(p.receiveIndex, "Receive", p.spread), mk(p.payIndex, "Pay", 0)],
  } as InterestRateSwap;
}

/**
 * Linear amortisation schedule: notional steps down evenly at each fixed-leg
 * period start from `notional` to `finalNotional` (default 0 → full amortisation).
 */
export function linearAmortisation(
  leg: { effectiveDate: SerialDate; terminationDate: SerialDate; frequency: string; calendar: CalendarId },
  notional: number,
  finalNotional = 0,
): { date: SerialDate; notional: number }[] {
  // Outstanding notional during period i; the last period still carries one
  // instalment (repaid at maturity), so the step is (N - N_final) / n.
  const dates = scheduleStartDates(leg);
  const n = dates.length;
  const step = (notional - finalNotional) / Math.max(1, n);
  return dates.map((d, i) => ({ date: d, notional: notional - step * i }));
}

function scheduleStartDates(leg: { effectiveDate: SerialDate; terminationDate: SerialDate; frequency: string; calendar: CalendarId }): SerialDate[] {
  const s = buildSchedule({ effectiveDate: leg.effectiveDate, terminationDate: leg.terminationDate, frequency: leg.frequency, calendar: leg.calendar });
  return s.periods.map((p) => p.accrualStart);
}

/**
 * Annuity (constant-instalment) amortisation: outstanding notional at the
 * start of each of `periods` periods for a loan of `notional` at the annual
 * loan `rate`, repaid in equal instalments (interest + principal) per period.
 * With `periodsPerYear` (default 1) the period rate is rate / periodsPerYear;
 * `finalNotional` (default 0) is the balloon outstanding after the last period.
 * The last entry still carries its instalment (repaid at maturity), so the
 * array has exactly `periods` entries starting with `notional`.
 */
export function annuityAmortisation(notional: number, rate: number, periods: number, opts: { periodsPerYear?: number; finalNotional?: number } = {}): number[] {
  const n = Math.max(1, Math.round(periods));
  const r = rate / (opts.periodsPerYear ?? 1);
  const final = opts.finalNotional ?? 0;
  const out: number[] = [];
  if (Math.abs(r) < 1e-12) {
    const step = (notional - final) / n;
    for (let i = 0; i < n; i++) out.push(notional - step * i);
    return out;
  }
  // Instalment A such that the balance after n periods equals `final`:
  // B_n = N (1+r)^n − A ((1+r)^n − 1)/r = final.
  const g = Math.pow(1 + r, n);
  const A = (notional * g - final) * (r / (g - 1));
  let balance = notional;
  for (let i = 0; i < n; i++) {
    out.push(balance);
    balance = balance * (1 + r) - A;
  }
  return out;
}

/**
 * Annuity amortisation schedule for a leg: outstanding notional per fixed-leg
 * period start, instalments from `annuityAmortisation` at the loan rate and
 * the leg's coupon frequency (see `linearAmortisation` for the linear variant).
 */
export function annuityAmortisationSchedule(
  leg: { effectiveDate: SerialDate; terminationDate: SerialDate; frequency: string; calendar: CalendarId },
  notional: number,
  loanRate: number,
  finalNotional = 0,
): { date: SerialDate; notional: number }[] {
  const dates = scheduleStartDates(leg);
  const balances = annuityAmortisation(notional, loanRate, dates.length, { periodsPerYear: frequencyPerYear(leg.frequency), finalNotional });
  return dates.map((d, i) => ({ date: d, notional: balances[i]! }));
}

/** Amortising vanilla swap (e.g. hedging an annuity loan): notional declines linearly on both legs. */
export function makeAmortisingSwap(p: VanillaSwapParams & { finalNotional?: number }): InterestRateSwap {
  const swap = makeVanillaSwap(p);
  const fixed = swap.legs[0]!;
  const schedule = linearAmortisation(fixed, p.notional, p.finalNotional ?? 0);
  return {
    ...swap,
    id: p.id ?? swap.id.replace("IRS", "AMORT"),
    name: p.name ?? `${swap.name} (amortisierend)`,
    legs: swap.legs.map((l) => ({ ...l, notionalSchedule: schedule })),
  };
}

/**
 * IMM-dated swap: effective on the next IMM date after `from`, maturity on the
 * IMM date of the month `start + tenor` (so "1Y" is twelve months, never
 * fifteen), and coupon periods rolling on IMM dates (`roll: "IMM"`).
 */
export function makeImmSwap(p: Omit<VanillaSwapParams, "effectiveDate" | "maturity"> & { from: SerialDate; tenor: string }): InterestRateSwap {
  const start = nextImmDate(p.from);
  const { year, month } = toYMD(addTenor(start, p.tenor));
  const end = immDate(year, month);
  const swap = makeVanillaSwap({
    ...p,
    effectiveDate: start,
    maturity: end,
    name: p.name ?? `IMM-Swap ${p.currency} ${p.tenor} @ ${rateDe(p.fixedRate)}`,
  });
  return { ...swap, legs: swap.legs.map((l) => ({ ...l, roll: "IMM" as const })) };
}

export interface CrossCurrencySwapParams {
  id?: string;
  /** Pair "EURUSD": the first currency is the domestic, the second the foreign currency unless given explicitly. */
  pair: string;
  domesticCurrency?: string;
  foreignCurrency?: string;
  domesticNotional: number;
  /** FX spot (1 domestic = fxSpot foreign) fixing the foreign notional; alternatively give `foreignNotional`. */
  fxSpot?: number;
  foreignNotional?: number;
  /** Floating indices; default: RFR of each currency (ESTR, SOFR, …). */
  domesticIndex?: string;
  foreignIndex?: string;
  /** Fixed-vs-float variant: the domestic leg pays/receives this fixed rate instead of floating. */
  fixedRate?: number;
  /** Basis spread (decimal, e.g. -0.0020 = -20bp). */
  spread: number;
  /** Leg carrying the spread; default "domestic" (foreign when the domestic leg is fixed). */
  spreadOn?: "domestic" | "foreign";
  /** Direction of the domestic leg (default "Receive": receive domestic, pay foreign). */
  domesticPayReceive?: PayReceive;
  effectiveDate: SerialDate;
  /** Maturity as tenor ("5Y") or explicit date. */
  tenor: string | SerialDate;
  /** Mark-to-market reset of the notional (default false); `mtmResetLeg` selects the resetting leg (default foreign). */
  mtmReset?: boolean;
  mtmResetLeg?: "domestic" | "foreign";
  /** Notional exchange (default initial + final, no interim). */
  notionalExchange?: { initial?: boolean; final?: boolean; interim?: boolean };
  /** Payment frequency of both legs (default "3M", market standard for RFR xccy swaps; IBOR legs default to their tenor). */
  frequency?: string;
  /**
   * CSA / collateral currency selecting the discount curves. Default (market
   * practice for cross-currency swaps, Bloomberg SWPM / LSEG IPA): USD when
   * one leg is USD, otherwise the quote (second) currency of the pair – for
   * EURUSD this activates the USD-collateral EUR discount curve
   * (`EUR-ESTR-USDCSA` in the sample market) so the fair basis spread reflects
   * the quoted cross-currency basis instead of ≈ 0. Pass `null` for an
   * explicitly uncollateralised swap (both legs on their own OIS curves).
   */
  collateralCurrency?: string | null;
  counterparty?: string;
  name?: string;
}

/**
 * Default CSA currency of a cross-currency swap: USD when involved, else the
 * quote currency of the pair (see `CrossCurrencySwapParams.collateralCurrency`).
 */
export function defaultCcsCollateralCurrency(domestic: string, foreign: string): string {
  return domestic === "USD" || foreign === "USD" ? "USD" : foreign;
}

/**
 * Cross-currency swap analogous to `makeBasisSwap`: domestic leg (float + spread
 * or fixed) vs foreign leg (float), notionals exchanged at start and maturity
 * (foreign notional = domestic × `fxSpot`), quarterly payments on the joint
 * calendar of both currencies. The leg carrying the spread is leg 0 so that
 * `analytics.fairSpread` refers to it. Collateralised by default (see
 * `defaultCcsCollateralCurrency`) so the cross-currency basis is priced.
 */
export function makeCrossCurrencySwap(p: CrossCurrencySwapParams): CrossCurrencySwap {
  const pair = p.pair.replace("/", "").toUpperCase();
  if (pair.length !== 6) throw new PricingError("INVALID_TRADE", `Invalid FX pair: ${p.pair}`);
  const dom = (p.domesticCurrency ?? pair.slice(0, 3)).toUpperCase();
  const frn = (p.foreignCurrency ?? pair.slice(3, 6)).toUpperCase();
  if (!pair.includes(dom) || !pair.includes(frn) || dom === frn) throw new PricingError("INVALID_TRADE", `Currencies ${dom}/${frn} do not match pair ${pair}`);
  let foreignNotional = p.foreignNotional;
  if (foreignNotional === undefined) {
    if (p.fxSpot === undefined) throw new PricingError("INVALID_TRADE", "makeCrossCurrencySwap: either fxSpot or foreignNotional is required");
    // fxSpot is quoted for the pair: 1 base = fxSpot quote.
    foreignNotional = pair.startsWith(dom) ? p.domesticNotional * p.fxSpot : p.domesticNotional / p.fxSpot;
  }
  const domConv = getSwapConventions(dom);
  const frnConv = getSwapConventions(frn);
  const domIdx = getIndex(p.domesticIndex ?? domConv.oisIndex);
  const frnIdx = getIndex(p.foreignIndex ?? frnConv.oisIndex);
  const domCal = indexScheduleCalendar(domIdx);
  const frnCal = indexScheduleCalendar(frnIdx);
  const calendar: CalendarId = domCal === frnCal ? domCal : `${domCal}+${frnCal}`;
  const maturity = typeof p.tenor === "string" ? addTenor(p.effectiveDate, p.tenor) : p.tenor;
  const domPR: PayReceive = p.domesticPayReceive ?? "Receive";
  const frnPR: PayReceive = domPR === "Receive" ? "Pay" : "Receive";
  const nx = { initial: p.notionalExchange?.initial ?? true, final: p.notionalExchange?.final ?? true, interim: p.notionalExchange?.interim ?? false };
  const payLag = Math.max(domIdx.type === "OIS" ? domConv.oisPaymentLag : 0, frnIdx.type === "OIS" ? frnConv.oisPaymentLag : 0);
  const freqOf = (idx: ReturnType<typeof getIndex>) => p.frequency ?? (idx.type === "IBOR" ? idx.tenor : "3M");
  const spreadOn = p.spreadOn ?? (p.fixedRate !== undefined ? "foreign" : "domestic");
  const floatLeg = (idx: ReturnType<typeof getIndex>, ccy: string, payReceive: PayReceive, notional: number, spread: number): FloatLeg => ({
    type: "Float",
    payReceive,
    notional,
    currency: ccy,
    effectiveDate: p.effectiveDate,
    terminationDate: maturity,
    frequency: freqOf(idx),
    dayCount: idx.dayCount,
    calendar,
    businessDayConvention: "ModifiedFollowing",
    index: idx.name,
    spread,
    paymentLag: payLag,
    stub: "ShortFront",
    notionalExchange: nx,
  });
  const domestic: SwapLeg =
    p.fixedRate !== undefined
      ? {
          type: "Fixed",
          payReceive: domPR,
          notional: p.domesticNotional,
          currency: dom,
          effectiveDate: p.effectiveDate,
          terminationDate: maturity,
          frequency: p.frequency ?? domConv.fixedFrequency,
          dayCount: domConv.fixedDayCount,
          calendar,
          businessDayConvention: "ModifiedFollowing",
          rate: p.fixedRate,
          paymentLag: payLag,
          stub: "ShortFront",
          notionalExchange: nx,
        }
      : floatLeg(domIdx, dom, domPR, p.domesticNotional, spreadOn === "domestic" ? p.spread : 0);
  const foreign = floatLeg(frnIdx, frn, frnPR, foreignNotional, spreadOn === "foreign" ? p.spread : 0);
  // Spread leg first so `analytics.fairSpread` (leg 0 for float/float) refers to it.
  const legs: SwapLeg[] = spreadOn === "domestic" && p.fixedRate === undefined ? [domestic, foreign] : [foreign, domestic];
  const resetLeg = p.mtmResetLeg ?? "foreign";
  const resettingLegIndex = legs.indexOf(resetLeg === "foreign" ? foreign : domestic);
  const bp = formatDe(p.spread * 1e4, 1);
  const tenorLabel = typeof p.tenor === "string" ? p.tenor : "";
  const desc =
    p.fixedRate !== undefined ? `${rateDe(p.fixedRate)} ${dom} vs ${frnIdx.name}` : `${domIdx.name} ${p.spread >= 0 ? "+" : ""}${bp} bp vs ${frnIdx.name}`;
  const collateralCurrency = p.collateralCurrency === null ? undefined : (p.collateralCurrency ?? defaultCcsCollateralCurrency(dom, frn));
  return {
    id: p.id ?? nextTradeId("CCS"),
    name: p.name ?? `Cross-Currency-Swap ${dom}/${frn} ${tenorLabel} ${desc}${p.mtmReset ? " (MtM-Reset)" : ""}`.replace(/\s+/g, " ").trim(),
    type: "CrossCurrencySwap",
    counterparty: p.counterparty,
    collateralCurrency,
    legs,
    ...(p.mtmReset ? { mtmReset: { resettingLegIndex } } : {}),
  };
}

/**
 * Indices whose projection curves the sample market (and every market built
 * from `SAMPLE_QUOTES`) provides – the default `availableIndices` of
 * `fraIndexForPeriod`. EURIBOR-1M / -12M are registered indices without a
 * sample curve (Markt R4-6), so they are not in this list.
 */
export const DEFAULT_AVAILABLE_INDICES: readonly string[] = ["EURIBOR-3M", "EURIBOR-6M", "ESTR", "SOFR", "SONIA", "SARON", "TONA"];

/** Months of an IBOR tenor string ("3M" → 3, "12M" → 12); undefined for non-monthly tenors. */
function tenorMonths(tenor: string): number | undefined {
  const m = /^(\d+)M$/i.exec(tenor);
  return m ? Number(m[1]) : undefined;
}

/**
 * Default index of an FRA from its period length (Markt R3-2 / R4-6): the
 * IBOR index of the currency whose tenor equals the period ("3x6" → EURIBOR-3M,
 * "6x12" → EURIBOR-6M) **provided its curve exists**. `availableIndices`
 * (default `DEFAULT_AVAILABLE_INDICES`, the sample-market curves; API/UI pass
 * the indices of the loaded market, e.g. `Object.keys` of the context's curve
 * indices) restricts the choice to indices with a projection curve. Without an
 * exact match the nearest available IBOR tenor of the currency is used –
 * shorter periods round to the next available tenor (1x2 → EURIBOR-3M), longer
 * periods to the longest available (12x24 → EURIBOR-6M); currencies without an
 * available IBOR index (USD, GBP, CHF, JPY) fall back to their RFR. The result
 * always has a curve in the given market – an FRA is never built on an index
 * that cannot be priced.
 */
export function fraIndexForPeriod(currency: string, months: number, availableIndices: readonly string[] = DEFAULT_AVAILABLE_INDICES): string {
  const ccy = currency.toUpperCase();
  const avail = new Set(availableIndices.map((n) => n.toUpperCase()));
  const candidates = Object.values(RATE_INDICES).filter(
    (i) => i.currency === ccy && i.type === "IBOR" && avail.has(i.name.toUpperCase()) && tenorMonths(i.tenor) !== undefined,
  );
  const exact = candidates.find((i) => tenorMonths(i.tenor) === months);
  if (exact) return exact.name;
  if (candidates.length) {
    // Nearest available tenor; ties (e.g. 4–5M between 3M and 6M) go to the longer tenor, the market's standard FRA index.
    const sorted = [...candidates].sort((a, b) => tenorMonths(a.tenor)! - tenorMonths(b.tenor)!);
    let best = sorted[0]!;
    for (const c of sorted) {
      const dc = Math.abs(tenorMonths(c.tenor)! - months);
      const db = Math.abs(tenorMonths(best.tenor)! - months);
      if (dc <= db) best = c;
    }
    return best.name;
  }
  const conv = getSwapConventions(ccy);
  return avail.has(conv.floatIndex.toUpperCase()) ? conv.floatIndex : conv.oisIndex;
}

/**
 * Forward rate agreement. `start` is either a period string "3x6" (months from
 * the spot date of `valuationDate`, default today) or the explicit accrual
 * start date (then `end` is required, default start + index tenor).
 * `payReceive: "Pay"` = pay the fixed rate. Without an explicit `index` the
 * index tenor follows the period length ("3x6" → EURIBOR-3M, "6x12" →
 * EURIBOR-6M, see `fraIndexForPeriod`); an explicit `index` always wins.
 */
export function makeFra(p: {
  id?: string;
  currency: string;
  notional: number;
  payReceive: PayReceive;
  index?: string;
  start: string | SerialDate;
  end?: SerialDate;
  rate: number;
  /** Anchor for the "3x6" form: valuation date whose spot date starts the count (default today). */
  valuationDate?: SerialDate;
  counterparty?: string;
  collateralCurrency?: string;
  name?: string;
}): ForwardRateAgreement {
  const conv = getSwapConventions(p.currency);
  // Period form "3x6": months from spot; the index tenor follows the period length unless given explicitly (R3-2).
  const period = typeof p.start === "string" ? /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(p.start) : null;
  if (typeof p.start === "string" && !period) throw new PricingError("INVALID_TRADE", `Invalid FRA period "${p.start}" – expected e.g. "3x6"`);
  let periodMonths: number | undefined;
  if (period) periodMonths = Number(period[2]) - Number(period[1]);
  else if (typeof p.start === "number" && p.end !== undefined) periodMonths = Math.round((p.end - p.start) / 30.4375);
  const idx = getIndex(p.index ?? (periodMonths !== undefined && periodMonths > 0 ? fraIndexForPeriod(p.currency, periodMonths) : conv.floatIndex));
  const cal = getCalendar(indexScheduleCalendar(idx));
  let startDate: SerialDate;
  let endDate: SerialDate;
  let label: string;
  if (period) {
    const val = p.valuationDate ?? today();
    const spot = conv.spotLag === 0 ? val : addBusinessDays(val, conv.spotLag, cal);
    startDate = advance(spot, `${period[1]}M`, cal, "ModifiedFollowing", idx.endOfMonth);
    endDate = p.end ?? advance(spot, `${period[2]}M`, cal, "ModifiedFollowing", idx.endOfMonth);
    label = `${period[1]}x${period[2]}`;
  } else {
    const start = p.start as SerialDate;
    startDate = start;
    endDate = p.end ?? advance(start, idx.tenor, cal, "ModifiedFollowing", idx.endOfMonth);
    label = "";
  }
  if (endDate <= startDate) throw new PricingError("INVALID_TRADE", "makeFra: end must be after start");
  return {
    id: p.id ?? nextTradeId("FRA"),
    name: p.name ?? `FRA ${p.currency} ${label} ${p.payReceive === "Pay" ? "Zahler" : "Empfänger"} @ ${rateDe(p.rate)}`.replace(/\s+/g, " "),
    type: "FRA",
    payReceive: p.payReceive,
    notional: p.notional,
    currency: p.currency,
    index: idx.name,
    startDate,
    endDate,
    fixedRate: p.rate,
    dayCount: idx.dayCount,
    counterparty: p.counterparty,
    collateralCurrency: p.collateralCurrency,
  };
}

/** FX swap from spot leg and forward leg (base amount sign: + = buy base at near leg). */
export function makeFxSwap(p: {
  id?: string;
  pair: string;
  baseAmount: number;
  nearRate: number;
  farRate: number;
  nearDate: SerialDate;
  farDate: SerialDate;
  counterparty?: string;
}): FxSwap {
  const near = makeFxForward({ pair: p.pair, baseAmount: p.baseAmount, rate: p.nearRate, deliveryDate: p.nearDate });
  const far = makeFxForward({ pair: p.pair, baseAmount: -p.baseAmount, rate: p.farRate, deliveryDate: p.farDate });
  const { id: _n, type: _tn, ...nearLeg } = near;
  const { id: _f, type: _tf, ...farLeg } = far;
  const pips = (p.farRate - p.nearRate) * pipFactor(p.pair.slice(0, 3), p.pair.slice(3, 6));
  return {
    id: p.id ?? nextTradeId("FXS"),
    name: `FX-Swap ${pairDe(p.pair)} ${formatDe(Math.abs(p.baseAmount), 0)} ${pips >= 0 ? "+" : ""}${formatDe(pips, 1)} Pkt`,
    type: "FxSwap",
    nearLeg,
    farLeg,
    counterparty: p.counterparty,
  };
}
