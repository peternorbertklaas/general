import { toISO } from "../dates/date.js";
import { type PricingResult, type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { type RiskReport } from "../risk/sensitivities.js";
import { type XvaResult } from "../xva/cva.js";

/**
 * Audit-ready valuation report: everything a reviewer (Wirtschaftsprüfer,
 * Marktfolge, Kunde) needs to reproduce a number – market snapshot,
 * conventions, cashflow table, sensitivities, credit adjustments and the
 * fair-value hierarchy classification.
 */
export interface ValuationReport {
  generatedAt: string;
  valuationDate: string;
  reportingCurrency: string;
  trade: Trade;
  pricing: PricingResult;
  risk?: RiskReport;
  xva?: XvaResult;
  market: {
    label?: string;
    source?: string;
    curves: { id: string; currency: string; interpolation?: string; nodes: { date: string; zero: number; df: number }[] }[];
    fxSpots: Record<string, number>;
  };
  fairValue: {
    riskFree: number;
    cva: number;
    dva: number;
    adjusted: number;
    /** IFRS 13 hierarchy level (Level 2 for observable-input OTC vanillas). */
    ifrs13Level: 1 | 2 | 3;
    rationale: string;
  };
  /** MiFID II ex-ante cost breakdown when a transaction price is provided. */
  costTransparency?: {
    transactionPrice: number;
    fairValue: number;
    /** Initial (negative) market value from the client's perspective. */
    initialMarketValue: number;
    marginBp: number;
    marginPct: number;
  };
  methodology: string[];
}

export function buildValuationReport(
  ctx: MarketContext,
  trade: Trade,
  pricing: PricingResult,
  opts: { risk?: RiskReport; xva?: XvaResult; transactionPrice?: number; notional?: number } = {},
): ValuationReport {
  const cva = opts.xva?.cva ?? 0;
  const dva = opts.xva?.dva ?? 0;
  const adjusted = pricing.pv - (Number.isFinite(cva) ? cva : 0) + (Number.isFinite(dva) ? dva : 0);
  const notional = opts.notional ?? inferNotional(trade);
  const curves = Object.values(ctx.curves).map((c) => ({
    id: c.id,
    currency: c.currency,
    interpolation: (c as { interpolation?: string }).interpolation,
    nodes: c.nodeDates.map((d) => ({ date: toISO(d), zero: c.zeroRate(d), df: c.df(d) })),
  }));
  const level: 1 | 2 | 3 = trade.type === "FxOption" && trade.barrier ? 2 : 2;
  const methodology = methodologyFor(trade);
  const report: ValuationReport = {
    generatedAt: new Date().toISOString(),
    valuationDate: toISO(ctx.valuationDate),
    reportingCurrency: pricing.currency,
    trade,
    pricing,
    risk: opts.risk,
    xva: opts.xva,
    market: { label: ctx.meta?.label, source: ctx.meta?.source, curves, fxSpots: ctx.fxSpots },
    fairValue: {
      riskFree: pricing.pv,
      cva: Number.isFinite(cva) ? cva : 0,
      dva: Number.isFinite(dva) ? dva : 0,
      adjusted,
      ifrs13Level: level,
      rationale:
        "Bewertung mit beobachtbaren Marktdaten (OIS-/Swapkurven, Volatilitäten, FX-Spots) und marktüblichen Modellen; keine wesentlichen nicht beobachtbaren Inputs → Level 2.",
    },
    methodology,
  };
  if (opts.transactionPrice !== undefined) {
    const initialMv = opts.transactionPrice - adjusted;
    report.costTransparency = {
      transactionPrice: opts.transactionPrice,
      fairValue: adjusted,
      initialMarketValue: -initialMv,
      marginBp: notional ? (initialMv / notional) * 1e4 : 0,
      marginPct: notional ? (initialMv / notional) * 100 : 0,
    };
  }
  return report;
}

function inferNotional(trade: Trade): number {
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return trade.legs[0]?.notional ?? 0;
    case "Swaption":
      return trade.underlying.legs[0]?.notional ?? 0;
    case "FRA":
    case "CapFloor":
    case "FxOption":
      return trade.notional;
    case "FxForward":
      return trade.buyAmount;
    case "FxSwap":
      return trade.nearLeg.buyAmount;
  }
}

function methodologyFor(trade: Trade): string[] {
  const common = [
    "Multi-Curve-Framework: Diskontierung mit OIS-Kurve (€STR/SOFR/SONIA/SARON), Projektion der Forwards mit indexspezifischer Kurve (EURIBOR-3M/-6M).",
    "Kurven per sequentiellem Bootstrapping aus Depos/FRAs/Swaps bzw. OIS-Swaps; Interpolation log-linear in Diskontfaktoren.",
    "Tageszählung, Geschäftstagekonvention und Kalender gemäß ISDA-Definitionen (TARGET2, US, UK, CH, JP).",
  ];
  switch (trade.type) {
    case "InterestRateSwap":
      return [...common, "Barwert = Summe diskontierter fixer und projizierter variabler Cashflows; Par-Satz und fairer Spread analytisch aus Annuität."];
    case "CrossCurrencySwap":
      return [...common, "Cross-Currency-Swap mit Nominalaustausch; MtM-Reset über Forward-FX aus Diskontkurven; Umrechnung in Reporting-Währung zum Spot."];
    case "FRA":
      return [...common, "FRA mit Settlement am Startdatum und Abdiskontierung über die FRA-Periode (ISDA)."];
    case "CapFloor":
      return [...common, "Caplets/Floorlets mit Bachelier-Modell (Normal-Vol) bzw. (shifted) Black-76 auf den Forward; Volatilität aus Caplet-Fläche per Expiry/Strike."];
    case "Swaption":
      return [...common, "Europäische Swaption mit Bachelier bzw. (shifted) Black-76 auf den Forward-Swapsatz; ATM-Vol-Cube mit SABR-Smile; physische Annuität bzw. Cash-Settlement-Annuität."];
    case "FxForward":
    case "FxSwap":
      return [...common, "FX-Forward über Zinsparität: F = S · DF_Basis / DF_Quote; Barwert = diskontierte Zahlungsströme beider Währungen zum Spot."];
    case "FxOption":
      return [...common, "Garman-Kohlhagen für europäische FX-Optionen; Smile aus ATM/RR/BF-Quotes in Delta-Raum; Barrieren nach Reiner-Rubinstein, Digitals analytisch."];
  }
}

/** Compact cashflow table suitable for CSV/Excel export. */
export function cashflowTable(pricing: PricingResult): string[][] {
  const rows: string[][] = [["Leg", "Typ", "Ccy", "Fixing", "Start", "Ende", "Zahlung", "Nominal", "Satz", "Tagefaktor", "Betrag", "DF", "Barwert", "Art"]];
  for (const leg of pricing.legs) {
    for (const cf of leg.cashflows) {
      rows.push([
        String(cf.legIndex),
        leg.legType,
        cf.currency,
        cf.fixingDate ? toISO(cf.fixingDate) : "",
        cf.accrualStart ? toISO(cf.accrualStart) : "",
        cf.accrualEnd ? toISO(cf.accrualEnd) : "",
        toISO(cf.paymentDate),
        cf.notional.toFixed(2),
        cf.rate !== undefined ? (cf.rate * 100).toFixed(5) + "%" : "",
        cf.accrualFactor !== undefined ? cf.accrualFactor.toFixed(6) : "",
        cf.amount.toFixed(2),
        cf.discountFactor.toFixed(8),
        cf.presentValue.toFixed(2),
        cf.kind,
      ]);
    }
  }
  return rows;
}

export function toCsv(rows: string[][], sep = ";"): string {
  return rows.map((r) => r.map((c) => (c.includes(sep) || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c)).join(sep)).join("\n");
}
