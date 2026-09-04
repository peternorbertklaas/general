import { type TradeType } from "./types.js";

/**
 * German display labels of the trade types. Core documents, hedge summaries
 * and builder names use these instead of the English type identifiers
 * (`InterestRateSwap`, `FxForward`, …), which stay machine-readable in
 * `Trade.type` / `PricingResult.tradeType`.
 */
export const TRADE_TYPE_LABELS_DE: Record<TradeType, string> = {
  InterestRateSwap: "Zinsswap",
  FRA: "FRA",
  CapFloor: "Cap/Floor",
  Swaption: "Swaption",
  FxForward: "FX-Termingeschäft",
  FxSwap: "FX-Swap",
  FxOption: "FX-Option",
  CrossCurrencySwap: "Cross-Currency-Swap",
};

/** German label of a trade type (unknown identifiers are returned unchanged). */
export function tradeTypeLabelDe(type: TradeType | string): string {
  return TRADE_TYPE_LABELS_DE[type as TradeType] ?? type;
}
