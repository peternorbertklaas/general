import { PricingError } from "../errors.js";
import { type MarketContext } from "../market/market-context.js";
import { type FixedLeg, type FloatLeg, type FxForward, type PricingResult, type SwapLeg, type Trade } from "../instruments/types.js";
import { priceCapFloor } from "./capfloor-pricer.js";
import { priceFra } from "./fra-pricer.js";
import { priceFxForward, priceFxOption, priceFxSwap } from "./fx-pricer.js";
import { priceCrossCurrencySwap, priceInterestRateSwap } from "./swap-pricer.js";
import { priceSwaption } from "./swaption-pricer.js";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;

function checkLeg(l: SwapLeg | undefined, path: string, out: string[]): void {
  if (!l || typeof l !== "object") {
    out.push(`${path}: leg missing`);
    return;
  }
  if (l.type !== "Fixed" && l.type !== "Float") out.push(`${path}.type must be "Fixed" or "Float"`);
  if (l.payReceive !== "Pay" && l.payReceive !== "Receive") out.push(`${path}.payReceive must be "Pay" or "Receive"`);
  if (!isNum(l.notional)) out.push(`${path}.notional must be a finite number`);
  if (!isStr(l.currency)) out.push(`${path}.currency missing`);
  if (!isNum(l.effectiveDate) || !isNum(l.terminationDate)) out.push(`${path}: effectiveDate / terminationDate must be serial dates`);
  else if (l.terminationDate <= l.effectiveDate) out.push(`${path}: terminationDate must be after effectiveDate`);
  if (!isStr(l.frequency)) out.push(`${path}.frequency missing`);
  if (!isStr(l.dayCount)) out.push(`${path}.dayCount missing`);
  if (!isStr(l.calendar)) out.push(`${path}.calendar missing`);
  if (l.type === "Fixed" && !isNum((l as FixedLeg).rate)) out.push(`${path}.rate (fixed rate) missing or not a finite number`);
  if (l.type === "Float" && !isStr((l as FloatLeg).index)) out.push(`${path}.index (floating index) missing`);
}

function checkFxLeg(l: Omit<FxForward, "type" | "id"> | undefined, path: string, out: string[]): void {
  if (!l || typeof l !== "object") {
    out.push(`${path}: leg missing`);
    return;
  }
  if (!isStr(l.buyCurrency) || !isStr(l.sellCurrency)) out.push(`${path}: buyCurrency / sellCurrency missing`);
  if (!isNum(l.buyAmount) || !isNum(l.sellAmount)) out.push(`${path}: buyAmount / sellAmount must be finite numbers`);
  if (!isNum(l.deliveryDate)) out.push(`${path}.deliveryDate must be a serial date`);
}

/**
 * Structural validation of a trade (required fields, finite numbers, date
 * order). Returns a list of problems (empty = valid); `priceTrade` throws a
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
      break;
    case "FRA":
      if (!isNum(trade.notional)) out.push(`${path}.notional must be a finite number`);
      if (!isStr(trade.currency)) out.push(`${path}.currency missing`);
      if (!isStr(trade.index)) out.push(`${path}.index missing`);
      if (!isNum(trade.startDate) || !isNum(trade.endDate)) out.push(`${path}: startDate / endDate must be serial dates`);
      else if (trade.endDate <= trade.startDate) out.push(`${path}: endDate must be after startDate`);
      if (!isNum(trade.fixedRate)) out.push(`${path}.fixedRate must be a finite number`);
      break;
    case "CapFloor":
      if (!["Cap", "Floor", "Collar"].includes(trade.capFloor)) out.push(`${path}.capFloor must be Cap, Floor or Collar`);
      if (!isNum(trade.notional)) out.push(`${path}.notional must be a finite number`);
      if (!isStr(trade.currency)) out.push(`${path}.currency missing`);
      if (!isStr(trade.index)) out.push(`${path}.index missing`);
      if (!isNum(trade.effectiveDate) || !isNum(trade.terminationDate)) out.push(`${path}: effectiveDate / terminationDate must be serial dates`);
      else if (trade.terminationDate <= trade.effectiveDate) out.push(`${path}: terminationDate must be after effectiveDate`);
      if (!isStr(trade.frequency)) out.push(`${path}.frequency missing`);
      if (!isStr(trade.dayCount)) out.push(`${path}.dayCount missing`);
      if (!isStr(trade.calendar)) out.push(`${path}.calendar missing`);
      if (!isNum(trade.strike)) out.push(`${path}.strike must be a finite number`);
      if (trade.capFloor === "Collar" && trade.floorStrike !== undefined && !isNum(trade.floorStrike)) out.push(`${path}.floorStrike must be a finite number`);
      break;
    case "Swaption":
      if (trade.payerReceiver !== "Payer" && trade.payerReceiver !== "Receiver") out.push(`${path}.payerReceiver must be Payer or Receiver`);
      if (trade.settlement !== "Physical" && trade.settlement !== "Cash") out.push(`${path}.settlement must be Physical or Cash`);
      if (!isNum(trade.expiryDate)) out.push(`${path}.expiryDate must be a serial date`);
      if (!trade.underlying || trade.underlying.type !== "InterestRateSwap") out.push(`${path}.underlying must be an InterestRateSwap`);
      else out.push(...validateTrade(trade.underlying, `${path}.underlying`));
      break;
    case "FxForward":
      checkFxLeg(trade, path, out);
      break;
    case "FxSwap":
      checkFxLeg(trade.nearLeg, `${path}.nearLeg`, out);
      checkFxLeg(trade.farLeg, `${path}.farLeg`, out);
      break;
    case "FxOption":
      if (!isStr(trade.pair) || trade.pair.replace("/", "").length !== 6) out.push(`${path}.pair must be a 6-letter currency pair`);
      if (trade.optionType !== "Call" && trade.optionType !== "Put") out.push(`${path}.optionType must be Call or Put`);
      if (!isNum(trade.strike) || trade.strike <= 0) out.push(`${path}.strike must be a positive finite number`);
      if (!isNum(trade.notional)) out.push(`${path}.notional must be a finite number`);
      if (!isNum(trade.expiryDate) || !isNum(trade.deliveryDate)) out.push(`${path}: expiryDate / deliveryDate must be serial dates`);
      else if (trade.deliveryDate < trade.expiryDate) out.push(`${path}: deliveryDate must not be before expiryDate`);
      if (trade.barrier && (!isNum(trade.barrier.level) || trade.barrier.level <= 0)) out.push(`${path}.barrier.level must be a positive finite number`);
      break;
    default:
      out.push(`${path}.type "${String((trade as { type?: unknown }).type)}" is not supported`);
  }
  if ("payReceive" in trade && trade.payReceive !== "Pay" && trade.payReceive !== "Receive") {
    out.push(`${path}.payReceive must be "Pay" or "Receive"`);
  }
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
  return { ...res, timingMs: performance.now() - t0 };
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
