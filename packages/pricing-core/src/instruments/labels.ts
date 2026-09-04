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

// ---------------------------------------------------------------------------
// Convention / model labels for human-facing prose (R3-06 of the UI review:
// no code identifiers such as "ModifiedFollowing" or "ShiftedBlack" in reports)
// ---------------------------------------------------------------------------

const BDC_LABELS_DE: Record<string, string> = {
  Following: "Following",
  ModifiedFollowing: "Modified Following",
  Preceding: "Preceding",
  ModifiedPreceding: "Modified Preceding",
  Unadjusted: "unadjustiert",
};

/** Business-day convention as market prose ("Modified Following"). */
export function bdcLabelDe(bdc: string | undefined): string {
  return BDC_LABELS_DE[bdc ?? "ModifiedFollowing"] ?? String(bdc);
}

const STUB_LABELS_DE: Record<string, string> = {
  ShortFront: "kurzer Stub am Anfang",
  LongFront: "langer Stub am Anfang",
  ShortBack: "kurzer Stub am Ende",
  LongBack: "langer Stub am Ende",
  None: "kein Stub",
};

/** Stub convention as German prose. */
export function stubLabelDe(stub: string | undefined): string {
  return STUB_LABELS_DE[stub ?? "ShortFront"] ?? String(stub);
}

const MODEL_LABELS_DE: Record<string, string> = {
  Bachelier: "Bachelier (Normal-Vol)",
  Black: "Black-76 (Lognormal-Vol)",
  ShiftedBlack: "Shifted Black-76 (verschobene Lognormal-Vol)",
};

/** Interest-rate option model as prose ("Shifted Black-76 …"). */
export function irModelLabelDe(model: string | undefined): string {
  return MODEL_LABELS_DE[model ?? "Bachelier"] ?? String(model);
}

const BARRIER_LABELS_DE: Record<string, string> = {
  UpIn: "Up-and-In",
  UpOut: "Up-and-Out",
  DownIn: "Down-and-In",
  DownOut: "Down-and-Out",
};

/** Barrier type as market prose ("Up-and-Out"). */
export function barrierTypeLabelDe(type: string): string {
  return BARRIER_LABELS_DE[type] ?? type;
}

/** Cash-settlement convention of a swaption as prose. */
export function cashSettlementLabelDe(convention: string | undefined): string {
  return (convention ?? "CollateralisedCashPrice") === "IRR" ? "IRR (Yield-Formel)" : "Collateralised Cash Price";
}

const DELTA_CONVENTION_LABELS_DE: Record<string, string> = {
  Spot: "Spot",
  Forward: "Forward",
  PremiumAdjustedSpot: "Premium-adjusted Spot",
  PremiumAdjustedForward: "Premium-adjusted Forward",
};

/** FX delta convention as prose. */
export function fxDeltaConventionLabelDe(conv: string | undefined): string {
  return DELTA_CONVENTION_LABELS_DE[conv ?? "Forward"] ?? String(conv);
}

/** FX ATM convention as prose. */
export function fxAtmConventionLabelDe(conv: string | undefined): string {
  return (conv ?? "DeltaNeutral") === "Forward" ? "ATM-Forward (K = F)" : "Delta-neutral";
}

/** Interest-rate vol type of a surface as prose. */
export function volTypeLabelDe(volType: string | undefined): string {
  return volType === "Lognormal" ? "Lognormal-Vol" : volType === "ShiftedLognormal" ? "verschobene Lognormal-Vol" : "Normal-Vol";
}

/**
 * German prose for the machine-readable `XvaResult.method` strings (the field
 * itself stays English for API consumers).
 */
export function xvaMethodLabelDe(method: string): string {
  const hazard = /hazard term structure/i.test(method) ? "Hazard-Termstruktur aus CDS-Bootstrap" : "flache Hazard-Rate";
  // N10-2: the swap grids name their resolution ("monthly exposure grid plus coupon dates" / "3-monthly …").
  const gridMatch = /(\d+)-monthly exposure grid|monthly exposure grid/i.exec(method);
  const grid = gridMatch ? `, Exposure-Gitter ${gridMatch[1] ? `${gridMatch[1]}-monatlich` : "monatlich"} plus Kupontermine` : "";
  const premium = /open premium netted/i.test(method) ? ", offene Prämie bis zum Zahltermin genettet" : "";
  if (/^Swaption-replication/i.test(method)) return `Swaption-Replikation (Sorensen–Bollier) mit der Smile-Vol am Strike${grid}${premium}, ${hazard}`;
  if (/^Basis-swaption replication/i.test(method)) return `Basis-Swaption-Replikation (Bachelier auf den Tenor-Basis-Spread)${grid}${premium}, ${hazard}`;
  if (/^GK forward-exposure/i.test(method)) return `Garman-Kohlhagen-Exposure auf dem Forward, ${hazard}`;
  if (/^Delta-normal exposure/i.test(method)) return `Delta-Normal-Exposure (gerollte Sensitivitäten × ATM-Vols je Restlaufzeit), ${hazard}`;
  if (/^Delta-normal \(expired\)/i.test(method)) return "Delta-Normal-Exposure (Geschäft abgelaufen, kein Exposure)";
  return method;
}
