import { type MarketContext } from "../market/market-context.js";
import { type PricingResult, type Trade } from "../instruments/types.js";
import { priceCapFloor } from "./capfloor-pricer.js";
import { priceFra } from "./fra-pricer.js";
import { priceFxForward, priceFxOption, priceFxSwap } from "./fx-pricer.js";
import { priceCrossCurrencySwap, priceInterestRateSwap } from "./swap-pricer.js";
import { priceSwaption } from "./swaption-pricer.js";

/** Dispatch a trade to its pricer. */
export function priceTrade(ctx: MarketContext, trade: Trade, reportingCurrency?: string): PricingResult {
  const t0 = performance.now();
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
      throw new Error(`Unsupported trade type: ${(never as Trade).type}`);
    }
  }
  return { ...res, timingMs: performance.now() - t0 };
}

export function pricePortfolio(ctx: MarketContext, trades: Trade[], reportingCurrency: string) {
  const results = trades.map((t) => {
    try {
      return priceTrade(ctx, t, reportingCurrency);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return {
        tradeId: t.id,
        tradeType: t.type,
        valuationDate: ctx.valuationDate,
        currency: reportingCurrency,
        pv: Number.NaN,
        legs: [],
        analytics: {},
        warnings: [`Pricing failed: ${err}`],
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
