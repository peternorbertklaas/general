import { normalizeDayCount } from "../dates/daycount.js";
import { frequencyPerYear } from "../dates/schedule.js";
import { PricingError } from "../errors.js";
import { type MarketContext, collateralCurveWarnings } from "../market/market-context.js";
import { type FixedLeg, type FloatLeg, type FxForward, type PricingResult, type SwapLeg, type Trade } from "../instruments/types.js";
import { priceCapFloor } from "./capfloor-pricer.js";
import { priceFra } from "./fra-pricer.js";
import { priceFxForward, priceFxOption, priceFxSwap } from "./fx-pricer.js";
import { priceCrossCurrencySwap, priceInterestRateSwap } from "./swap-pricer.js";
import { priceSwaption } from "./swaption-pricer.js";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** Message of a `PricingError` (with its code) or a plain error, for the problem list. */
function describe(e: unknown): string {
  if (e instanceof PricingError) return `${e.code} – ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Positive finite notional / amount (R3-4: negative or zero notionals were silently accepted). */
function checkPositive(value: unknown, what: string, out: string[]): void {
  if (!isNum(value)) out.push(`${what} must be a finite number`);
  else if (value <= 0) out.push(`${what} must be positive (got ${value})`);
}

/** Frequency string accepted by the schedule builder (R3-4: "7Q" / "0M" used to surface as plain errors). */
function checkFrequency(freq: unknown, what: string, out: string[]): void {
  if (!isStr(freq)) {
    out.push(`${what} missing`);
    return;
  }
  try {
    frequencyPerYear(freq);
  } catch (e) {
    out.push(`${what} "${freq}" invalid (${describe(e)})`);
  }
}

/** Day-count string known to `normalizeDayCount`. */
function checkDayCount(dc: unknown, what: string, out: string[], optional = false): void {
  if (dc === undefined && optional) return;
  if (!isStr(dc)) {
    out.push(`${what} missing`);
    return;
  }
  try {
    normalizeDayCount(dc);
  } catch (e) {
    out.push(`${what} "${dc}" unknown (${describe(e)})`);
  }
}

/** Optional vol override: must be a positive finite number when given (R3-4a). */
function checkVolOverride(v: unknown, what: string, out: string[]): void {
  if (v === undefined) return;
  if (!isNum(v) || v <= 0) out.push(`${what} must be a positive finite number (got ${String(v)})`);
}

/** Optional lognormal shift: non-negative finite number when given. */
function checkShift(v: unknown, what: string, out: string[]): void {
  if (v === undefined) return;
  if (!isNum(v) || v < 0) out.push(`${what} must be a non-negative finite number (got ${String(v)})`);
}

/** Optional business-day count (payment lag, fixing lag, lookback): non-negative integer when given (R3-4 / R4-3). */
function checkBusinessDayCount(v: unknown, what: string, out: string[]): void {
  if (v === undefined) return;
  if (!Number.isInteger(v) || (v as number) < 0) out.push(`${what} must be a non-negative integer number of business days (got ${String(v)})`);
}

/**
 * Optional amortisation schedule (R4-3c): every entry needs a finite serial
 * `date` and a positive finite `notional`; dates strictly increasing.
 */
function checkNotionalSchedule(schedule: unknown, path: string, out: string[]): void {
  if (schedule === undefined) return;
  if (!Array.isArray(schedule)) {
    out.push(`${path} must be an array of { date, notional }`);
    return;
  }
  let prev: number | undefined;
  schedule.forEach((e: unknown, i) => {
    const entry = e as { date?: unknown; notional?: unknown } | null;
    if (!entry || typeof entry !== "object") {
      out.push(`${path}[${i}] must be an object { date, notional }`);
      return;
    }
    if (!isNum(entry.date)) out.push(`${path}[${i}].date must be a serial date`);
    else {
      if (prev !== undefined && entry.date <= prev) out.push(`${path}[${i}].date must be after the previous entry (dates strictly increasing)`);
      prev = entry.date;
    }
    checkPositive(entry.notional, `${path}[${i}].notional`, out);
  });
}

/** Optional numeric field: finite number when given (N5-4c: `spread: null` / `"0.001"` used to surface as `NON_FINITE_PV`). */
function checkOptionalNumber(v: unknown, what: string, out: string[]): void {
  if (v === undefined) return;
  if (!isNum(v)) out.push(`${what} must be a finite number (got ${JSON.stringify(v) ?? String(v)})`);
}

/** Optional boolean flag (N5-4f: `observationShift: "yes"` was read as true). */
function checkOptionalBoolean(v: unknown, what: string, out: string[]): void {
  if (v === undefined) return;
  if (typeof v !== "boolean") out.push(`${what} must be a boolean (got ${JSON.stringify(v) ?? String(v)})`);
}

/** Optional step schedule (`rateSchedule` / `spreadSchedule`): serial dates strictly increasing, finite values (N5-4c). */
function checkStepSchedule(schedule: unknown, valueKey: "rate" | "spread", path: string, out: string[]): void {
  if (schedule === undefined) return;
  if (!Array.isArray(schedule)) {
    out.push(`${path} must be an array of { date, ${valueKey} }`);
    return;
  }
  let prev: number | undefined;
  schedule.forEach((e: unknown, i) => {
    const entry = e as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") {
      out.push(`${path}[${i}] must be an object { date, ${valueKey} }`);
      return;
    }
    if (!isNum(entry.date)) out.push(`${path}[${i}].date must be a serial date`);
    else {
      if (prev !== undefined && entry.date <= prev) out.push(`${path}[${i}].date must be after the previous entry (dates strictly increasing)`);
      prev = entry.date;
    }
    if (!isNum(entry[valueKey])) out.push(`${path}[${i}].${valueKey} must be a finite number`);
  });
}

function checkLeg(l: SwapLeg | undefined, path: string, out: string[]): void {
  if (!l || typeof l !== "object") {
    out.push(`${path}: leg missing`);
    return;
  }
  if (l.type !== "Fixed" && l.type !== "Float") out.push(`${path}.type must be "Fixed" or "Float"`);
  if (l.payReceive !== "Pay" && l.payReceive !== "Receive") out.push(`${path}.payReceive must be "Pay" or "Receive"`);
  checkPositive(l.notional, `${path}.notional`, out);
  if (!isStr(l.currency)) out.push(`${path}.currency missing`);
  if (!isNum(l.effectiveDate) || !isNum(l.terminationDate)) out.push(`${path}: effectiveDate / terminationDate must be serial dates`);
  else if (l.terminationDate <= l.effectiveDate) out.push(`${path}: terminationDate must be after effectiveDate`);
  checkFrequency(l.frequency, `${path}.frequency`, out);
  checkDayCount(l.dayCount, `${path}.dayCount`, out);
  if (!isStr(l.calendar)) out.push(`${path}.calendar missing`);
  checkBusinessDayCount(l.paymentLag, `${path}.paymentLag`, out);
  checkNotionalSchedule(l.notionalSchedule, `${path}.notionalSchedule`, out);
  if (l.type === "Fixed") {
    const fl = l as FixedLeg;
    if (!isNum(fl.rate)) out.push(`${path}.rate (fixed rate) missing or not a finite number`);
    checkStepSchedule(fl.rateSchedule, "rate", `${path}.rateSchedule`, out);
  }
  if (l.type === "Float") {
    const fl = l as FloatLeg;
    if (!isStr(fl.index)) out.push(`${path}.index (floating index) missing`);
    checkBusinessDayCount(fl.fixingLag, `${path}.fixingLag`, out);
    checkBusinessDayCount(fl.lookbackDays, `${path}.lookbackDays`, out);
    checkOptionalNumber(fl.spread, `${path}.spread`, out);
    checkOptionalNumber(fl.gearing, `${path}.gearing`, out);
    checkStepSchedule(fl.spreadSchedule, "spread", `${path}.spreadSchedule`, out);
    checkOptionalBoolean(fl.observationShift, `${path}.observationShift`, out);
    if (fl.compounding !== undefined && fl.compounding !== "Compound" && fl.compounding !== "Average") {
      out.push(`${path}.compounding must be "Compound" or "Average"`);
    }
    if (fl.capRate !== undefined && !isNum(fl.capRate)) out.push(`${path}.capRate must be a finite number`);
    if (fl.floorRate !== undefined && !isNum(fl.floorRate)) out.push(`${path}.floorRate must be a finite number`);
    if (isNum(fl.capRate) && isNum(fl.floorRate) && fl.capRate < fl.floorRate) {
      out.push(`${path}: embedded capRate (${fl.capRate}) must not be below floorRate (${fl.floorRate})`);
    }
  }
}

/** Optional upfront premium: finite amount, 3-letter currency, serial date. */
function checkUpfront(u: unknown, path: string, out: string[]): void {
  if (u === undefined) return;
  const up = u as { amount?: unknown; currency?: unknown; date?: unknown } | null;
  if (!up || typeof up !== "object") {
    out.push(`${path} must be an object { amount, currency, date }`);
    return;
  }
  if (!isNum(up.amount)) out.push(`${path}.amount must be a finite number`);
  if (!isStr(up.currency)) out.push(`${path}.currency missing`);
  if (!isNum(up.date)) out.push(`${path}.date must be a serial date`);
}

const BARRIER_TYPES = ["UpIn", "UpOut", "DownIn", "DownOut"];

function checkFxLeg(l: Omit<FxForward, "type" | "id"> | undefined, path: string, out: string[]): void {
  if (!l || typeof l !== "object") {
    out.push(`${path}: leg missing`);
    return;
  }
  if (!isStr(l.buyCurrency) || !isStr(l.sellCurrency)) out.push(`${path}: buyCurrency / sellCurrency missing`);
  checkPositive(l.buyAmount, `${path}.buyAmount`, out);
  checkPositive(l.sellAmount, `${path}.sellAmount`, out);
  if (!isNum(l.deliveryDate)) out.push(`${path}.deliveryDate must be a serial date`);
}

/**
 * Structural validation of a trade (required fields, finite numbers, date
 * order, R3-4: positive notionals, non-negative payment lags, valid frequency
 * and day-count strings, positive vol overrides, strike order of collars and
 * embedded caps/floors, exactly one fixed leg under a swaption; R4-3: swaption
 * expiry ≤ swap start and < swap end, non-negative barrier rebate, positive
 * strictly dated `notionalSchedule` entries, non-negative integer
 * `fixingLag` / `lookbackDays`; N5-3: `mtmReset.resettingLegIndex` an integer
 * in [0, legs.length); N5-4: positive digital payout, barrier type from the
 * enum, numeric `spread` / `gearing` / step schedules, boolean
 * `observationShift`, FX swap far leg after near leg; N6-5: boolean
 * `barrier.hit`). Returns a
 * list of problems (empty = valid); `priceTrade` throws a
 * `PricingError("INVALID_TRADE")` with this list instead of producing a null
 * or NaN PV.
 */
export function validateTrade(trade: Trade, path = "trade"): string[] {
  const out: string[] = [];
  if (!trade || typeof trade !== "object") return [`${path}: not an object`];
  if (!isStr(trade.id)) out.push(`${path}.id missing`);
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      if (!Array.isArray(trade.legs) || trade.legs.length === 0) out.push(`${path}.legs must be a non-empty array`);
      else trade.legs.forEach((l, i) => checkLeg(l, `${path}.legs[${i}]`, out));
      // N5-3: the resetting leg of an MtM-reset CCS must exist (used to surface as a TypeError).
      if (trade.type === "CrossCurrencySwap" && trade.mtmReset !== undefined) {
        const legCount = Array.isArray(trade.legs) ? trade.legs.length : 0;
        const idx: unknown = trade.mtmReset?.resettingLegIndex;
        if (!trade.mtmReset || typeof trade.mtmReset !== "object") out.push(`${path}.mtmReset must be an object { resettingLegIndex }`);
        else if (!Number.isInteger(idx) || (idx as number) < 0 || (idx as number) >= legCount) {
          out.push(`${path}.mtmReset.resettingLegIndex must be an integer in [0, ${legCount}) (got ${JSON.stringify(idx) ?? String(idx)})`);
        } else if (legCount < 2) out.push(`${path}.mtmReset requires two legs (resetting leg and the leg it resets against)`);
      }
      break;
    case "FRA":
      checkPositive(trade.notional, `${path}.notional`, out);
      if (!isStr(trade.currency)) out.push(`${path}.currency missing`);
      if (!isStr(trade.index)) out.push(`${path}.index missing`);
      if (!isNum(trade.startDate) || !isNum(trade.endDate)) out.push(`${path}: startDate / endDate must be serial dates`);
      else if (trade.endDate <= trade.startDate) out.push(`${path}: endDate must be after startDate`);
      if (!isNum(trade.fixedRate)) out.push(`${path}.fixedRate must be a finite number`);
      checkDayCount(trade.dayCount, `${path}.dayCount`, out, true);
      break;
    case "CapFloor":
      if (!["Cap", "Floor", "Collar"].includes(trade.capFloor)) out.push(`${path}.capFloor must be Cap, Floor or Collar`);
      checkPositive(trade.notional, `${path}.notional`, out);
      if (!isStr(trade.currency)) out.push(`${path}.currency missing`);
      if (!isStr(trade.index)) out.push(`${path}.index missing`);
      if (!isNum(trade.effectiveDate) || !isNum(trade.terminationDate)) out.push(`${path}: effectiveDate / terminationDate must be serial dates`);
      else if (trade.terminationDate <= trade.effectiveDate) out.push(`${path}: terminationDate must be after effectiveDate`);
      checkFrequency(trade.frequency, `${path}.frequency`, out);
      checkDayCount(trade.dayCount, `${path}.dayCount`, out);
      if (!isStr(trade.calendar)) out.push(`${path}.calendar missing`);
      if (!isNum(trade.strike)) out.push(`${path}.strike must be a finite number`);
      if (trade.capFloor === "Collar" && trade.floorStrike !== undefined) {
        if (!isNum(trade.floorStrike)) out.push(`${path}.floorStrike must be a finite number`);
        else if (isNum(trade.strike) && trade.floorStrike > trade.strike) {
          out.push(`${path}: collar floorStrike (${trade.floorStrike}) must not exceed the cap strike (${trade.strike})`);
        }
      }
      checkNotionalSchedule(trade.notionalSchedule, `${path}.notionalSchedule`, out);
      checkVolOverride(trade.volOverride, `${path}.volOverride`, out);
      checkShift(trade.shift, `${path}.shift`, out);
      break;
    case "Swaption":
      if (trade.payerReceiver !== "Payer" && trade.payerReceiver !== "Receiver") out.push(`${path}.payerReceiver must be Payer or Receiver`);
      if (trade.settlement !== "Physical" && trade.settlement !== "Cash") out.push(`${path}.settlement must be Physical or Cash`);
      if (!isNum(trade.expiryDate)) out.push(`${path}.expiryDate must be a serial date`);
      if (!trade.underlying || trade.underlying.type !== "InterestRateSwap") out.push(`${path}.underlying must be an InterestRateSwap`);
      else {
        out.push(...validateTrade(trade.underlying, `${path}.underlying`));
        const legs = Array.isArray(trade.underlying.legs) ? trade.underlying.legs : [];
        const fixed = legs.filter((l) => l?.type === "Fixed").length;
        if (fixed !== 1) out.push(`${path}.underlying must have exactly one Fixed leg (found ${fixed})`);
        if (!legs.some((l) => l?.type === "Float")) out.push(`${path}.underlying must have a Float leg`);
        // R4-3a: the option must expire before (or when) the underlying swap starts – and before it ends.
        if (isNum(trade.expiryDate)) {
          const starts = legs.map((l) => l?.effectiveDate).filter(isNum);
          const ends = legs.map((l) => l?.terminationDate).filter(isNum);
          const firstStart = starts.length ? Math.min(...starts) : undefined;
          const lastEnd = ends.length ? Math.max(...ends) : undefined;
          if (firstStart !== undefined && trade.expiryDate > firstStart) {
            out.push(`${path}.expiryDate must not be after the underlying swap's effectiveDate (expiry ${trade.expiryDate} > start ${firstStart})`);
          }
          if (lastEnd !== undefined && trade.expiryDate >= lastEnd) {
            out.push(`${path}.expiryDate must be before the underlying swap's terminationDate (expiry ${trade.expiryDate} ≥ end ${lastEnd})`);
          }
        }
      }
      checkVolOverride(trade.volOverride, `${path}.volOverride`, out);
      checkShift(trade.shift, `${path}.shift`, out);
      break;
    case "FxForward":
      checkFxLeg(trade, path, out);
      break;
    case "FxSwap":
      checkFxLeg(trade.nearLeg, `${path}.nearLeg`, out);
      checkFxLeg(trade.farLeg, `${path}.farLeg`, out);
      // N5-4d: the far leg must deliver after the near leg (far ≤ near was priced silently).
      if (isNum(trade.nearLeg?.deliveryDate) && isNum(trade.farLeg?.deliveryDate) && trade.farLeg.deliveryDate <= trade.nearLeg.deliveryDate) {
        out.push(`${path}: farLeg.deliveryDate (${trade.farLeg.deliveryDate}) must be after nearLeg.deliveryDate (${trade.nearLeg.deliveryDate})`);
      }
      break;
    case "FxOption":
      if (!isStr(trade.pair) || trade.pair.replace("/", "").length !== 6) out.push(`${path}.pair must be a 6-letter currency pair`);
      if (trade.optionType !== "Call" && trade.optionType !== "Put") out.push(`${path}.optionType must be Call or Put`);
      if (!isNum(trade.strike) || trade.strike <= 0) out.push(`${path}.strike must be a positive finite number`);
      checkPositive(trade.notional, `${path}.notional`, out);
      if (!isNum(trade.expiryDate) || !isNum(trade.deliveryDate)) out.push(`${path}: expiryDate / deliveryDate must be serial dates`);
      else if (trade.deliveryDate < trade.expiryDate) out.push(`${path}: deliveryDate must not be before expiryDate`);
      if (trade.barrier !== undefined) {
        if (!trade.barrier || typeof trade.barrier !== "object") out.push(`${path}.barrier must be an object { type, level, rebate? }`);
        else {
          // N5-4b: an unknown barrier type used to surface as NON_FINITE_PV.
          if (!BARRIER_TYPES.includes(String(trade.barrier.type))) {
            out.push(
              `${path}.barrier.type must be one of ${BARRIER_TYPES.join(", ")} (got ${JSON.stringify(trade.barrier.type) ?? String(trade.barrier.type)})`,
            );
          }
          if (!isNum(trade.barrier.level) || trade.barrier.level <= 0) out.push(`${path}.barrier.level must be a positive finite number`);
          // R4-3b: a negative rebate would give a bought option a negative value.
          if (trade.barrier.rebate !== undefined && (!isNum(trade.barrier.rebate) || trade.barrier.rebate < 0)) {
            out.push(`${path}.barrier.rebate must be a non-negative finite number (got ${String(trade.barrier.rebate)})`);
          }
          // N6-5: the observed knock state is a boolean flag ("yes" would be read as touched).
          checkOptionalBoolean(trade.barrier.hit, `${path}.barrier.hit`, out);
        }
      }
      // N5-4a: digital payout must be a positive finite amount in a 3-letter currency (−100 gave a bought digital a negative PV).
      if (trade.digital !== undefined) {
        if (!trade.digital || typeof trade.digital !== "object") out.push(`${path}.digital must be an object { payoutCurrency, payout }`);
        else {
          if (!isNum(trade.digital.payout) || trade.digital.payout <= 0) {
            out.push(`${path}.digital.payout must be a positive finite number (got ${String(trade.digital.payout)})`);
          }
          if (!isStr(trade.digital.payoutCurrency) || !/^[A-Za-z]{3}$/.test(trade.digital.payoutCurrency)) {
            out.push(`${path}.digital.payoutCurrency must be a 3-letter currency code`);
          }
        }
      }
      if (trade.barrier && trade.digital) out.push(`${path}: barrier and digital features cannot be combined`);
      checkVolOverride(trade.volOverride, `${path}.volOverride`, out);
      break;
    default:
      out.push(`${path}.type "${String((trade as { type?: unknown }).type)}" is not supported`);
  }
  if ("payReceive" in trade && trade.payReceive !== "Pay" && trade.payReceive !== "Receive") {
    out.push(`${path}.payReceive must be "Pay" or "Receive"`);
  }
  checkUpfront(trade.upfront, `${path}.upfront`, out);
  return out;
}

/** Throw a `PricingError("INVALID_TRADE")` listing all structural problems of the trade. */
export function assertValidTrade(trade: Trade): void {
  const problems = validateTrade(trade);
  if (problems.length) {
    throw new PricingError("INVALID_TRADE", `Invalid trade ${String((trade as { id?: unknown })?.id ?? "")}: ${problems.join("; ")}`, {
      tradeId: (trade as { id?: unknown })?.id,
      problems,
    });
  }
}

/**
 * Dispatch a trade to its pricer. Structurally invalid trades raise
 * `PricingError("INVALID_TRADE")`, a non-finite PV raises
 * `PricingError("NON_FINITE_PV")` – a valuation never returns null/NaN silently.
 */
export function priceTrade(ctx: MarketContext, trade: Trade, reportingCurrency?: string): PricingResult {
  const t0 = performance.now();
  assertValidTrade(trade);
  let res: PricingResult;
  switch (trade.type) {
    case "InterestRateSwap":
      res = priceInterestRateSwap(ctx, trade, reportingCurrency);
      break;
    case "FRA":
      res = priceFra(ctx, trade, reportingCurrency);
      break;
    case "CapFloor":
      res = priceCapFloor(ctx, trade, reportingCurrency);
      break;
    case "Swaption":
      res = priceSwaption(ctx, trade, reportingCurrency);
      break;
    case "FxForward":
      res = priceFxForward(ctx, trade, reportingCurrency);
      break;
    case "FxSwap":
      res = priceFxSwap(ctx, trade, reportingCurrency);
      break;
    case "FxOption":
      res = priceFxOption(ctx, trade, reportingCurrency);
      break;
    case "CrossCurrencySwap":
      res = priceCrossCurrencySwap(ctx, trade, reportingCurrency);
      break;
    default: {
      const never: never = trade;
      throw new PricingError("UNSUPPORTED_TRADE_TYPE", `Unsupported trade type: ${(never as Trade).type}`);
    }
  }
  if (!Number.isFinite(res.pv)) {
    throw new PricingError(
      "NON_FINITE_PV",
      `Valuation of ${trade.id} produced a non-finite PV (${String(res.pv)}) – check market data (curves, FX spots, vols) and trade terms`,
      {
        tradeId: trade.id,
        pv: res.pv,
        warnings: res.warnings,
      },
    );
  }
  // Markt R4-1: a CSA without a collateral-specific discount curve is discounted on the standard curve – say so.
  const csaWarnings = collateralCurveWarnings(ctx, tradeCurrencies(trade), trade.collateralCurrency);
  const warnings = csaWarnings.length ? Array.from(new Set([...res.warnings, ...csaWarnings])) : res.warnings;
  return { ...res, warnings, timingMs: performance.now() - t0 };
}

export function pricePortfolio(ctx: MarketContext, trades: Trade[], reportingCurrency: string) {
  const results = trades.map((t) => {
    try {
      return priceTrade(ctx, t, reportingCurrency);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const code = e instanceof PricingError ? `${e.code}: ` : "";
      return {
        tradeId: t.id,
        tradeType: t.type,
        valuationDate: ctx.valuationDate,
        currency: reportingCurrency,
        pv: Number.NaN,
        legs: [],
        analytics: {},
        warnings: [`Pricing failed: ${code}${err}`],
      } satisfies PricingResult;
    }
  });
  const total = results.reduce((s, r) => s + (Number.isFinite(r.pv) ? r.pv : 0), 0);
  return { results, total, currency: reportingCurrency };
}

/** Currencies a trade references (for risk / scenario scoping). */
export function tradeCurrencies(trade: Trade): string[] {
  const set = new Set<string>();
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      trade.legs.forEach((l) => set.add(l.currency));
      break;
    case "FRA":
    case "CapFloor":
      set.add(trade.currency);
      break;
    case "Swaption":
      trade.underlying.legs.forEach((l) => set.add(l.currency));
      break;
    case "FxForward":
      set.add(trade.buyCurrency);
      set.add(trade.sellCurrency);
      break;
    case "FxSwap":
      set.add(trade.nearLeg.buyCurrency);
      set.add(trade.nearLeg.sellCurrency);
      break;
    case "FxOption":
      set.add(trade.pair.slice(0, 3).toUpperCase());
      set.add(trade.pair.slice(3, 6).toUpperCase());
      break;
  }
  return [...set];
}
