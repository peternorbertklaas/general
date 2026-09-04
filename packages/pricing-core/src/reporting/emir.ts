import { toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { type PricingResult, type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { isIsoDateTime } from "../market/snapshot.js";
import { csvCell } from "./valuation-report.js";

/**
 * EMIR Refit valuation fields (ITS (EU) 2022/1860, Table 2 – transaction data):
 * field 21 valuation amount, 22 valuation currency, 23 valuation timestamp,
 * 24 valuation method, 25 delta, 26 collateral portfolio indicator; clearing
 * data: field 30 clearing obligation, 31 cleared, 32 clearing timestamp (not
 * produced here), 33 central counterparty. The clearing member is a Table 1
 * (counterparty data) field and is carried for convenience. DERIVA marks
 * everything to model (MTMO) unless the caller provides an observable market
 * price (`opts.transactionPrice` → MTMA) or a CCP valuation (CCPV).
 *
 * Delta (field 25): for options the option delta ratio ∂V/∂underlying per unit
 * of notional (FX option: signed spot delta; swaption / cap: annuity-weighted
 * ∂PV/∂F divided by the annuity, i.e. the Bachelier/Black delta) taken from
 * the pricing analytics; for linear instruments ±1 by direction (pay fixed /
 * long the underlying rate or bought currency → +1, receive fixed → −1).
 *
 * Clearing obligation (field 30, N3-09): taken from the trade's explicit
 * `clearingObligation` flag (or `opts.clearingObligation`); it is **not**
 * derived from `cleared` – the Art. 4 obligation depends on counterparty
 * classification, product class and thresholds, not on whether the trade was
 * (voluntarily) cleared. Unknown → "UKWN".
 *
 * Value formats (N4-08) follow the ITS Table 2 validation rules verbatim so an
 * export passes trade-repository validation: booleans are `TRUE` / `FLSE`
 * (field 26 collateral portfolio indicator, field 30 clearing obligation with
 * `UKWN` for "not determined"), field 31 cleared is `Y` / `N` / `I` (intent to
 * clear). The trade input stays boolean (`cleared`, `clearingObligation`);
 * `opts.intentToClear` selects `I`.
 */
export interface EmirValuationRecord {
  uti?: string;
  tradeId: string;
  counterparty?: string;
  productClassification: string;
  notional: number;
  notionalCurrency: string;
  /** Field 21. */
  valuationAmount: number;
  /** Field 22. */
  valuationCurrency: string;
  /** Field 23, ISO-8601 UTC (`YYYY-MM-DDThh:mm:ssZ`). */
  valuationTimestamp: string;
  /** Field 24. */
  valuationMethod: "MTMA" | "MTMO" | "CCPV";
  /** Field 25. */
  delta?: number;
  /** Field 26 – ITS boolean format `TRUE` / `FLSE` (N4-08). */
  collateralPortfolioIndicator: EmirBoolean;
  /**
   * Field 31 – cleared: `Y` (centrally cleared), `N` (not cleared), `I`
   * (intent to clear, `opts.intentToClear` on a not-yet-cleared trade).
   * `N` when the trade does not say otherwise.
   */
  cleared: EmirCleared;
  /**
   * Field 30 – clearing obligation: `TRUE` / `FLSE` from the trade's
   * `clearingObligation` (or `opts.clearingObligation`), `UKWN` when not
   * determined (never derived from `cleared`, N3-09).
   */
  clearingObligation: EmirClearingObligation;
  /** Table 1 field – clearing member, informational. */
  clearingMember?: string;
}

/** ITS (EU) 2022/1860 boolean value format (`FLSE`, not `FALSE`). */
export type EmirBoolean = "TRUE" | "FLSE";
/** Field 31 value set: cleared / not cleared / intent to clear. */
export type EmirCleared = "Y" | "N" | "I";
/** Field 30 value set: obligation applies / does not apply / unknown. */
export type EmirClearingObligation = "TRUE" | "FLSE" | "UKWN";

/** Boolean → ITS format (`TRUE` / `FLSE`). */
export function emirBoolean(v: boolean): EmirBoolean {
  return v ? "TRUE" : "FLSE";
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
  /** Clearing obligation (field 30) when the trade does not carry `clearingObligation`. */
  clearingObligation?: boolean;
  /** Field 31 `I` (intent to clear) for a trade that is not (yet) cleared but will be submitted for clearing. */
  intentToClear?: boolean;
}

/** Normalise an ISO-8601 date-time to `YYYY-MM-DDThh:mm:ssZ` (UTC); a bare date is completed to the EoD convention. */
function normaliseTimestamp(raw: string, source: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T17:00:00Z`;
  if (!isIsoDateTime(raw)) {
    throw new PricingError("INVALID_TIMESTAMP", `${source} ${JSON.stringify(raw)} is not an ISO-8601 date-time – EMIR field 23 needs YYYY-MM-DDThh:mm:ssZ`, {
      source,
      value: raw,
    });
  }
  return new Date(raw).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Valuation timestamp (field 23): explicit → snapshot time → reporter's asOf
 * → EoD 17:00 UTC of the valuation date. Every candidate must be ISO-8601
 * (N3-03): an unparsable explicit `timestamp` / `asOf` raises
 * `PricingError("INVALID_TIMESTAMP")`; an unparsable `meta.snapshotTime` is
 * ignored (the snapshot validator flags it) and the next candidate is used.
 */
export function emirValuationTimestamp(ctx: MarketContext, opts: Pick<EmirRecordOptions, "timestamp" | "asOf"> = {}): string {
  const eod = `${toISO(ctx.valuationDate)}T17:00:00Z`;
  if (opts.timestamp !== undefined) return normaliseTimestamp(opts.timestamp, "timestamp");
  const snap = ctx.meta?.snapshotTime;
  if (snap !== undefined && (isIsoDateTime(snap) || /^\d{4}-\d{2}-\d{2}$/.test(snap))) {
    // N9-02: a snapshot time from before the valuation date (a rolled snapshot) is stale for field 23 – ignored.
    const ts = normaliseTimestamp(snap, "meta.snapshotTime");
    if (ts.slice(0, 10) >= toISO(ctx.valuationDate)) return ts;
  }
  if (opts.asOf !== undefined) return normaliseTimestamp(opts.asOf, "asOf");
  return eod;
}

export function emirValuationRecord(ctx: MarketContext, trade: Trade, pricing: PricingResult, opts: EmirRecordOptions = {}): EmirValuationRecord {
  const { notional, currency } = notionalOf(trade);
  const cleared = trade.cleared === true;
  const obligation = trade.clearingObligation ?? opts.clearingObligation;
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
    collateralPortfolioIndicator: emirBoolean(Boolean(trade.collateralCurrency)),
    cleared: cleared ? "Y" : opts.intentToClear ? "I" : "N",
    clearingObligation: obligation === undefined ? "UKWN" : emirBoolean(obligation),
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
 * Delta of the position (EMIR field 25) as a ratio, see module doc. Returns
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
    r.cleared ?? "N",
    r.clearingObligation ?? "UKWN",
    r.clearingMember ?? "",
  ]);
  return (opts.bom ? "﻿" : "") + [[...EMIR_CSV_HEADER], ...rows].map((r) => r.map((c) => csvCell(c, sep, opts.decimalComma ?? false)).join(sep)).join("\n");
}
