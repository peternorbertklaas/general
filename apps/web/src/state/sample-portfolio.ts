import {
  type Trade,
  advance,
  getCalendar,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
} from "@deriva/pricing-core";

/** Demo book: a Mittelstand treasury hedging loans and FX exposures. */
export function samplePortfolio(valuationDate: number): Trade[] {
  const spot = advance(valuationDate, "2D", getCalendar("TARGET"));
  return [
    makeVanillaSwap({ id: "IRS-0001", name: "Payer-Swap Betriebsmittelkredit", currency: "EUR", notional: 10_000_000, payReceiveFixed: "Pay", fixedRate: 0.0315, effectiveDate: parseISO("2024-06-17"), maturity: "10Y", counterparty: "Landesbank A" }),
    makeVanillaSwap({ id: "IRS-0002", name: "Receiver-Swap Anleihe 2031", currency: "EUR", notional: 5_000_000, payReceiveFixed: "Receive", fixedRate: 0.0245, effectiveDate: spot, maturity: "5Y", counterparty: "DZ BANK" }),
    makeVanillaSwap({ id: "OIS-0001", name: "€STR OIS 2Y", currency: "EUR", notional: 25_000_000, payReceiveFixed: "Pay", fixedRate: 0.0218, effectiveDate: spot, maturity: "2Y", index: "ESTR", counterparty: "Landesbank A" }),
    makeVanillaSwap({ id: "IRS-USD-01", name: "USD SOFR Payer 7Y", currency: "USD", notional: 8_000_000, payReceiveFixed: "Pay", fixedRate: 0.0345, effectiveDate: spot, maturity: "7Y", counterparty: "Commerzbank" }),
    makeCapFloor({ id: "CAP-0001", currency: "EUR", notional: 8_000_000, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y", counterparty: "Landesbank A" }),
    makeCapFloor({ id: "COL-0001", currency: "EUR", notional: 6_000_000, capFloor: "Collar", strike: 0.035, floorStrike: 0.015, effectiveDate: spot, maturity: "7Y", counterparty: "DZ BANK" }),
    makeSwaption({ id: "SWPT-0001", currency: "EUR", notional: 10_000_000, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate, counterparty: "Landesbank A" }),
    makeFxForward({ id: "FXF-0001", pair: "EURUSD", baseAmount: -2_000_000, rate: 1.1725, deliveryDate: parseISO("2027-03-15"), counterparty: "Commerzbank" }),
    makeFxForward({ id: "FXF-0002", pair: "EURGBP", baseAmount: 1_500_000, rate: 0.859, deliveryDate: parseISO("2026-12-15"), counterparty: "DZ BANK" }),
    makeFxOption({ id: "FXO-0001", pair: "EURUSD", optionType: "Put", notional: 3_000_000, strike: 1.15, expiryDate: parseISO("2027-06-15"), counterparty: "Landesbank A" }),
    makeFxOption({ id: "FXO-0002", pair: "EURCHF", optionType: "Call", notional: 2_000_000, strike: 0.95, expiryDate: parseISO("2027-03-15"), counterparty: "Commerzbank" }),
  ];
}
