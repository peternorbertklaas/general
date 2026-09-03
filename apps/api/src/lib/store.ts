import {
  type MarketContext,
  type Trade,
  advance,
  buildSampleMarket,
  getCalendar,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
} from "@deriva/pricing-core";

/**
 * In-memory repositories. The API is stateless by design; persistence is an
 * adapter concern (see ADR-006) – swap this module for a database-backed
 * implementation without touching routes.
 */
export class MarketStore {
  private ctx: MarketContext;
  constructor(valuationDate = parseISO("2026-09-03")) {
    this.ctx = buildSampleMarket(valuationDate);
  }
  get(): MarketContext {
    return this.ctx;
  }
  set(ctx: MarketContext): void {
    this.ctx = ctx;
  }
  rebuild(valuationDate: number): MarketContext {
    this.ctx = buildSampleMarket(valuationDate);
    return this.ctx;
  }
}

export interface StoredTrade {
  trade: Trade;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class TradeStore {
  private trades = new Map<string, StoredTrade>();

  list(): StoredTrade[] {
    return [...this.trades.values()];
  }
  get(id: string): StoredTrade | undefined {
    return this.trades.get(id);
  }
  upsert(trade: Trade): StoredTrade {
    const now = new Date().toISOString();
    const prev = this.trades.get(trade.id);
    const stored: StoredTrade = {
      trade,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      version: (prev?.version ?? 0) + 1,
    };
    this.trades.set(trade.id, stored);
    return stored;
  }
  delete(id: string): boolean {
    return this.trades.delete(id);
  }
  clear(): void {
    this.trades.clear();
  }
}

/** Demo portfolio representative of a Mittelstand treasury / Sparkasse customer book. */
export function samplePortfolio(valuationDate: number): Trade[] {
  const cal = getCalendar("TARGET");
  const spot = advance(valuationDate, "2D", cal);
  return [
    makeVanillaSwap({ id: "IRS-0001", name: "Payer-Swap Kredit Halle A", currency: "EUR", notional: 10_000_000, payReceiveFixed: "Pay", fixedRate: 0.0315, effectiveDate: parseISO("2024-06-17"), maturity: "10Y", counterparty: "CPTY-A" }),
    makeVanillaSwap({ id: "IRS-0002", name: "Receiver-Swap Anleihe", currency: "EUR", notional: 5_000_000, payReceiveFixed: "Receive", fixedRate: 0.0245, effectiveDate: spot, maturity: "5Y", counterparty: "CPTY-B" }),
    makeVanillaSwap({ id: "OIS-0001", name: "€STR OIS 2Y", currency: "EUR", notional: 25_000_000, payReceiveFixed: "Pay", fixedRate: 0.0218, effectiveDate: spot, maturity: "2Y", index: "ESTR", counterparty: "CPTY-A" }),
    makeCapFloor({ id: "CAP-0001", currency: "EUR", notional: 8_000_000, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y", counterparty: "CPTY-A" }),
    makeCapFloor({ id: "COL-0001", currency: "EUR", notional: 6_000_000, capFloor: "Collar", strike: 0.035, floorStrike: 0.015, effectiveDate: spot, maturity: "7Y", counterparty: "CPTY-B" }),
    makeSwaption({ id: "SWPT-0001", currency: "EUR", notional: 10_000_000, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate, counterparty: "CPTY-A" }),
    makeFxForward({ id: "FXF-0001", pair: "EURUSD", baseAmount: -2_000_000, rate: 1.1725, deliveryDate: parseISO("2027-03-15"), counterparty: "CPTY-B" }),
    makeFxForward({ id: "FXF-0002", pair: "EURGBP", baseAmount: 1_500_000, rate: 0.8590, deliveryDate: parseISO("2026-12-15"), counterparty: "CPTY-B" }),
    makeFxOption({ id: "FXO-0001", pair: "EURUSD", optionType: "Put", notional: 3_000_000, strike: 1.15, expiryDate: parseISO("2027-06-15"), counterparty: "CPTY-A" }),
    makeFxOption({ id: "FXO-0002", pair: "EURCHF", optionType: "Call", notional: 2_000_000, strike: 0.95, expiryDate: parseISO("2027-03-15"), counterparty: "CPTY-B" }),
  ];
}
