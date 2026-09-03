import { toISO } from "../dates/date.js";
import { type PricingResult, type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { csvCell } from "./valuation-report.js";

/**
 * EMIR Refit valuation fields (Table 2, fields 21–26 of the ITS on reporting):
 * valuation amount, valuation currency, valuation timestamp, valuation method
 * and – for collateralised trades – the delta of the position (field 26), plus
 * the clearing fields (Table 2 fields 31–33: cleared, clearing obligation,
 * clearing member). DERIVA marks everything to model (MTMO) unless the caller
 * provides an observable market price (`opts.transactionPrice` → MTMA) or a
 * CCP valuation (CCPV).
 *
 * Delta (field 26): for options the option delta ratio ∂V/∂underlying per unit
 * of notional (FX option: signed spot delta; swaption / cap: annuity-weighted
 * ∂PV/∂F divided by the annuity, i.e. the Bachelier/Black delta) taken from
 * the pricing analytics; for linear instruments ±1 by direction (pay fixed /
 * long the underlying rate or bought currency → +1, receive fixed → −1).
 */
export interface EmirValuationRecord {
  uti?: string;
  tradeId: string;
  counterparty?: string;
  productClassification: string;
  notional: number;
  notionalCurrency: string;
  valuationAmount: number;
  valuationCurrency: string;
  valuationTimestamp: string;
  valuationMethod: "MTMA" | "MTMO" | "CCPV";
  delta?: number;
  collateralPortfolioIndicator: "TRUE" | "FALSE";
  /** Centrally cleared (field 31); "FALSE" when the trade does not say otherwise. */
  cleared: "TRUE" | "FALSE";
  /** Clearing obligation (field 32), derived: cleared → "Y", else "N". */
  clearingObligation: "Y" | "N";
  clearingMember?: string;
}

export interface EmirRecordOptions {
  method?: EmirValuationRecord["valuationMethod"];
  /** Override the derived delta. */
  delta?: number;
  /** Override the trade's `uti`. */
  uti?: string;
  /** Explicit valuation timestamp (highest priority). */
  timestamp?: string;
  /**
   * Reporting entity's default valuation time (ISO timestamp), used when the
   * market snapshot has no `meta.snapshotTime`; default: valuation date 17:00 UTC (EoD).
   */
  asOf?: string;
  /** Observable transaction price → valuation method MTMA (mark-to-market) when no explicit `method` is given. */
  transactionPrice?: number;
}

/** Valuation timestamp: explicit → snapshot time → reporter's asOf → EoD 17:00 UTC of the valuation date. */
export function emirValuationTimestamp(ctx: MarketContext, opts: Pick<EmirRecordOptions, "timestamp" | "asOf"> = {}): string {
  const eod = `${toISO(ctx.valuationDate)}T17:00:00Z`;
  const raw = opts.timestamp ?? ctx.meta?.snapshotTime ?? opts.asOf ?? eod;
  // A bare date is completed to the EoD convention.
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T17:00:00Z` : raw;
}

export function emirValuationRecord(ctx: MarketContext, trade: Trade, pricing: PricingResult, opts: EmirRecordOptions = {}): EmirValuationRecord {
  const { notional, currency } = notionalOf(trade);
  const cleared = trade.cleared === true;
  return {
    uti: opts.uti ?? trade.uti,
    tradeId: trade.id,
    counterparty: trade.counterparty,
    productClassification: cfiFor(trade),
    notional,
    notionalCurrency: currency,
    valuationAmount: Math.round(pricing.pv * 100) / 100,
    valuationCurrency: pricing.currency,
    valuationTimestamp: emirValuationTimestamp(ctx, opts),
    valuationMethod: opts.method ?? (opts.transactionPrice !== undefined ? "MTMA" : "MTMO"),
    delta: opts.delta ?? emirDelta(trade, pricing),
    collateralPortfolioIndicator: trade.collateralCurrency ? "TRUE" : "FALSE",
    cleared: cleared ? "TRUE" : "FALSE",
    clearingObligation: cleared ? "Y" : "N",
    clearingMember: trade.clearingMember,
  };
}

/** FX conversion factor of a pricing leg (reporting per leg currency), 1 when not derivable. */
function legFx(pricing: PricingResult): number {
  const leg = pricing.legs[0];
  if (!leg || !Number.isFinite(leg.pv) || Math.abs(leg.pv) < 1e-12) return 1;
  const fx = leg.pvReporting / leg.pv;
  return Number.isFinite(fx) && fx > 0 ? fx : 1;
}

/**
 * Delta of the position (EMIR field 26) as a ratio, see module doc. Returns
 * undefined when the analytics needed for an option are missing.
 */
export function emirDelta(trade: Trade, pricing: PricingResult): number | undefined {
  const a = pricing.analytics;
  const num = (k: string): number | undefined => (typeof a[k] === "number" && Number.isFinite(a[k] as number) ? (a[k] as number) : undefined);
  switch (trade.type) {
    case "FxOption": {
      const deltaBase = num("deltaBase");
      return deltaBase !== undefined && trade.notional ? deltaBase / trade.notional : undefined;
    }
    case "Swaption": {
      const delta = num("delta");
      const annuity = num("annuity");
      if (delta === undefined || annuity === undefined || annuity <= 0) return undefined;
      return delta / (annuity * legFx(pricing));
    }
    case "CapFloor": {
      const delta = num("delta");
      const annuity = pricing.legs[0]?.cashflows.reduce((s, c) => s + c.notional * (c.accrualFactor ?? 0) * c.discountFactor, 0) ?? 0;
      if (delta === undefined || annuity <= 0) return undefined;
      return delta / (annuity * legFx(pricing));
    }
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      const fixed = trade.legs.find((l) => l.type === "Fixed");
      if (fixed) return fixed.payReceive === "Pay" ? 1 : -1; // pay fixed = long the rate
      return trade.legs[0]!.payReceive === "Receive" ? 1 : -1; // basis / xccy: long leg 0's index
    }
    case "FRA":
      return trade.payReceive === "Pay" ? 1 : -1;
    case "FxForward":
    case "FxSwap":
      return 1; // long the bought (notional) currency of the (near) leg
  }
}

/** ISO 10962 CFI-style classification used by trade repositories. */
function cfiFor(trade: Trade): string {
  switch (trade.type) {
    case "InterestRateSwap":
      return "SRCCSP"; // Swap, rates, fixed-floating, single currency
    case "CrossCurrencySwap":
      return "SRDCSP"; // cross-currency
    case "FRA":
      return "JRTXFP"; // forward, rates
    case "CapFloor":
      return "HRWAVP"; // OTC option, rates, cap/floor style
    case "Swaption":
      return "HRSAVP";
    case "FxForward":
      return "JFTXFP";
    case "FxSwap":
      return "SFCXXP";
    case "FxOption":
      return "HFRAVP";
  }
}

function notionalOf(trade: Trade): { notional: number; currency: string } {
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return { notional: trade.legs[0]!.notional, currency: trade.legs[0]!.currency };
    case "Swaption":
      return { notional: trade.underlying.legs[0]!.notional, currency: trade.underlying.legs[0]!.currency };
    case "FRA":
    case "CapFloor":
      return { notional: trade.notional, currency: trade.currency };
    case "FxOption":
      return { notional: trade.notional, currency: trade.pair.slice(0, 3).toUpperCase() };
    case "FxForward":
      return { notional: trade.buyAmount, currency: trade.buyCurrency };
    case "FxSwap":
      return { notional: trade.nearLeg.buyAmount, currency: trade.nearLeg.buyCurrency };
  }
}

export const EMIR_CSV_HEADER = [
  "UTI",
  "Trade ID",
  "Counterparty",
  "Product classification",
  "Notional",
  "Notional currency",
  "Valuation amount",
  "Valuation currency",
  "Valuation timestamp",
  "Valuation method",
  "Delta",
  "Collateral portfolio indicator",
  "Cleared",
  "Clearing obligation",
  "Clearing member",
] as const;

export function emirCsv(records: EmirValuationRecord[], sep = ";", opts: { decimalComma?: boolean; bom?: boolean } = {}): string {
  const rows = records.map((r) => [
    r.uti ?? "",
    r.tradeId,
    r.counterparty ?? "",
    r.productClassification,
    r.notional.toFixed(2),
    r.notionalCurrency,
    r.valuationAmount.toFixed(2),
    r.valuationCurrency,
    r.valuationTimestamp,
    r.valuationMethod,
    r.delta !== undefined ? r.delta.toFixed(6) : "",
    r.collateralPortfolioIndicator,
    r.cleared ?? "FALSE",
    r.clearingObligation ?? "N",
    r.clearingMember ?? "",
  ]);
  return (opts.bom ? "﻿" : "") + [[...EMIR_CSV_HEADER], ...rows].map((r) => r.map((c) => csvCell(c, sep, opts.decimalComma ?? false)).join(sep)).join("\n");
}
