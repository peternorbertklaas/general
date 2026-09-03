import {
  type Trade,
  advance,
  getCalendar,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
} from "@deriva/pricing-core";

export type TemplateId = "irs" | "cap" | "swpt" | "fxf" | "fxo";

export function newTradeTemplate(kind: TemplateId, valuationDate: number): Trade {
  const cal = getCalendar("TARGET");
  const spot = advance(valuationDate, "2D", cal);
  switch (kind) {
    case "irs":
      return makeVanillaSwap({ currency: "EUR", notional: 10_000_000, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y", counterparty: "Neu" });
    case "cap":
      return makeCapFloor({ currency: "EUR", notional: 10_000_000, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
    case "swpt":
      return makeSwaption({ currency: "EUR", notional: 10_000_000, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate });
    case "fxf":
      return makeFxForward({ pair: "EURUSD", baseAmount: 1_000_000, rate: 1.17, deliveryDate: advance(spot, "6M", getCalendar("TARGET+US")) });
    case "fxo":
      return makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1_000_000, strike: 1.17, expiryDate: advance(valuationDate, "6M", cal) });
  }
}
