import {
  type Trade,
  advance,
  getCalendar,
  makeAmortisingSwap,
  makeBasisSwap,
  makeCapFloor,
  makeCrossCurrencySwap,
  makeFra,
  makeFxForward,
  makeFxOption,
  makeFxSwap,
  makeImmSwap,
  makeSwaption,
  makeVanillaSwap,
} from "@deriva/pricing-core";
import { TEMPLATE_LABELS } from "../hotkeys/keymap.js";

export type TemplateId = keyof typeof TEMPLATE_LABELS;

export const TEMPLATE_IDS: TemplateId[] = ["irs", "cap", "swpt", "fxf", "fxo", "basis", "amort", "imm", "fxs", "ccs", "fra"];

export { TEMPLATE_LABELS };

export function isTemplateId(x: string): x is TemplateId {
  return (TEMPLATE_IDS as string[]).includes(x);
}

/**
 * Default CSA currency of a cross-currency swap: the foreign (USD) leg's
 * currency – the sample market carries the collateral curve "EUR|USD" →
 * EUR-ESTR-USDCSA, so the Xccy basis is priced (Markt R3-1).
 */
export const CCS_CSA_CURRENCY = "USD";
export function ccsCollateralCurrency(pair: string): string {
  return pair.slice(0, 3).toUpperCase() === "EUR" ? pair.slice(3, 6).toUpperCase() : CCS_CSA_CURRENCY;
}

/** New trade from a template. Ids are assigned by the store (`autoId`); the counterparty stays open. */
export function newTradeTemplate(kind: TemplateId, valuationDate: number): Trade {
  const cal = getCalendar("TARGET");
  const spot = advance(valuationDate, "2D", cal);
  switch (kind) {
    case "irs":
      return makeVanillaSwap({
        name: "Payer-Swap EUR 5Y",
        currency: "EUR",
        notional: 10_000_000,
        payReceiveFixed: "Pay",
        fixedRate: 0.03,
        effectiveDate: spot,
        maturity: "5Y",
      });
    case "cap":
      return {
        ...makeCapFloor({ currency: "EUR", notional: 10_000_000, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" }),
        name: "Cap EUR 5Y 3,00 %",
      };
    case "swpt":
      return {
        ...makeSwaption({ currency: "EUR", notional: 10_000_000, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate }),
        name: "Payer-Swaption 1Y×5Y",
      };
    case "fxf":
      return {
        ...makeFxForward({ pair: "EURUSD", baseAmount: 1_000_000, rate: 1.17, deliveryDate: advance(spot, "6M", getCalendar("TARGET+US")) }),
        name: "Kauf EUR/USD 6M",
      };
    case "fxo":
      return {
        ...makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1_000_000, strike: 1.17, expiryDate: advance(valuationDate, "6M", cal) }),
        name: "EUR-Call/USD-Put 6M",
      };
    case "basis":
      return makeBasisSwap({
        name: "Basis-Swap 3M/6M 5Y",
        currency: "EUR",
        notional: 10_000_000,
        effectiveDate: spot,
        maturity: "5Y",
        receiveIndex: "EURIBOR-3M",
        payIndex: "EURIBOR-6M",
        spread: 0.0005,
      });
    case "amort":
      return makeAmortisingSwap({
        name: "Amortisierender Payer-Swap 10Y",
        currency: "EUR",
        notional: 10_000_000,
        payReceiveFixed: "Pay",
        fixedRate: 0.03,
        effectiveDate: spot,
        maturity: "10Y",
        finalNotional: 0,
      });
    case "imm":
      return makeImmSwap({
        name: "IMM-Swap 2Y",
        currency: "EUR",
        notional: 10_000_000,
        payReceiveFixed: "Pay",
        fixedRate: 0.025,
        from: valuationDate,
        tenor: "2Y",
      });
    case "fxs":
      return {
        ...makeFxSwap({
          pair: "EURUSD",
          baseAmount: 1_000_000,
          nearRate: 1.1625,
          farRate: 1.18,
          nearDate: spot,
          farDate: advance(spot, "1Y", getCalendar("TARGET+US")),
        }),
        name: "FX-Swap EUR/USD 1Y",
      };
    case "ccs":
      // USD CSA: the EUR leg is discounted on EUR-ESTR-USDCSA (Xccy basis) – without it the fair basis spread is ≈ 0 (Markt R3-1).
      return makeCrossCurrencySwap({
        name: "CCS EUR/USD 5Y €STR −20 bp vs SOFR",
        pair: "EURUSD",
        domesticNotional: 10_000_000,
        fxSpot: 1.17,
        spread: -0.002,
        effectiveDate: spot,
        tenor: "5Y",
        collateralCurrency: CCS_CSA_CURRENCY,
      });
    case "fra":
      return makeFra({
        name: "FRA EUR 3x6 Zahler",
        currency: "EUR",
        notional: 10_000_000,
        payReceive: "Pay",
        start: "3x6",
        rate: 0.022,
        valuationDate,
      });
  }
}
