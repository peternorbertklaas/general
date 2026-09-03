import { describe, expect, it } from "vitest";
import { PricingError } from "@deriva/pricing-core";
import {
  CASHFLOW_KIND_DE,
  LEG_TYPE_DE,
  germanTradeName,
  germanizeDocValue,
  germanizeParagraph,
  germanizeText,
  legTypeLabel,
  optionsFrom,
  t,
  translateCoreMessage,
  translatePricingError,
} from "./i18n.js";

describe("i18n core message mapping (F-25)", () => {
  it("translates fixing warnings with placeholders", () => {
    expect(translateCoreMessage("Missing fixing for EURIBOR-6M on 2026-06-15; used curve forward")).toBe(
      "Fixing EURIBOR-6M vom 15.06.2026 fehlt – Kurven-Forward verwendet",
    );
    expect(translateCoreMessage("Missing fixing ESTR 2026-09-01")).toBe("Fixing ESTR vom 01.09.2026 fehlt");
  });
  it("translates vol-surface fallbacks and XVA scope", () => {
    expect(translateCoreMessage("No swaption vol surface – using 70bp normal vol")).toBe("Keine Swaption-Vol-Fläche – 70 bp Normal-Vol verwendet");
    expect(translateCoreMessage("No FX vol surface – 8% vol assumed")).toBe("Keine FX-Vol-Fläche – 8 % Vol angenommen");
    expect(translateCoreMessage("XVA not implemented for CapFloor (v1 supports IRS and FX forwards)")).toMatch(/XVA für Cap\/Floor nicht verfügbar/);
  });
  it("translates structured (coded) warnings and strips unknown codes", () => {
    expect(
      translateCoreMessage("MISSING_FIXING: Missing fixing for EURIBOR-6M on 2026-09-03; used 6M forward from 2026-09-30 (same-length period starting today)"),
    ).toBe("Fixing EURIBOR-6M vom 03.09.2026 fehlt – 6M-Forward ab 30.09.2026 verwendet (gleich lange Periode ab heute)");
    expect(
      translateCoreMessage(
        "MISSING_FIXING: Missing fixing for ESTR on 2026-09-01; accrual period starting 2026-08-01 projected with the curve's first forward",
      ),
    ).toMatch(/Periode ab 01.08.2026/);
    expect(translateCoreMessage("MISSING_FIXING: Missing fixing for EURIBOR-3M on 2026-09-01; FRA settled on the curve forward")).toMatch(
      /FRA mit dem Kurven-Forward/,
    );
    expect(translateCoreMessage("NEGATIVE_RATE_LOGNORMAL: Black model with non-positive shifted forward/strike – intrinsic value used, no time value")).toBe(
      "Black-Modell: verschobener Forward/Strike nicht positiv – innerer Wert ohne Zeitwert",
    );
    expect(translateCoreMessage("FRA already settled")).toBe("FRA bereits abgerechnet");
    expect(translateCoreMessage("SOME_CODE: unknown text")).toBe("unknown text");
  });
  it("translates validation errors and passes unknown text through", () => {
    expect(translateCoreMessage("terminationDate must be after effectiveDate")).toBe("Enddatum muss nach dem Startdatum liegen");
    expect(translateCoreMessage("Curve not found in market context: EUR-XYZ")).toBe("Kurve EUR-XYZ nicht im Markt-Snapshot");
    expect(translateCoreMessage("Something unexpected")).toBe("Something unexpected");
    expect(translateCoreMessage(undefined)).toBe("");
  });
  it("translates the long XVA method strings (N-07)", () => {
    expect(translateCoreMessage("Swaption-replication (Sorensen–Bollier), smile vol at strike, flat hazard")).toBe(
      "Swaption-Replikation (Sorensen–Bollier), Smile-Vol am Strike, konstante Hazard-Rate",
    );
    expect(translateCoreMessage("Swaption-replication (Sorensen–Bollier), flat hazard")).toBe("Swaption-Replikation (Sorensen–Bollier), konstante Hazard-Rate");
    expect(translateCoreMessage("Delta-normal exposure (rolled sensitivities, ATM vols at (t, remaining tenor))")).toBe(
      "Delta-Normal-Exposure (gerollte Sensitivitäten, ATM-Vols bei (t, Restlaufzeit))",
    );
    expect(translateCoreMessage("Delta-normal (expired)")).toBe("Delta-Normal (verfallen)");
  });
  it("maps PricingError codes to German headlines", () => {
    expect(translatePricingError(new PricingError("NO_DISCOUNT_CURVE", "No discount curve configured for JPY"))).toBe(
      "Keine Diskontkurve konfiguriert: Keine Diskontkurve für JPY konfiguriert",
    );
    expect(translatePricingError(new PricingError("INVALID_TRADE", "terminationDate must be after effectiveDate"))).toBe(
      "Ungültige Trade-Daten: Enddatum muss nach dem Startdatum liegen",
    );
    expect(translatePricingError(new PricingError("NON_FINITE_PV", "PV not finite"))).toBe("Barwert nicht berechenbar");
    expect(translatePricingError(new Error("FRA already settled"))).toBe("FRA bereits abgerechnet");
    expect(translatePricingError("plain")).toBe("plain");
  });
  it("maps badges and select options", () => {
    expect(t(LEG_TYPE_DE, "Fixed")).toBe("Fest");
    expect(t(LEG_TYPE_DE, "FX Buy")).toBe("Kauf");
    expect(t(CASHFLOW_KIND_DE, "OptionPayoff")).toBe("Optionsauszahlung");
    expect(t(CASHFLOW_KIND_DE, "Unknown")).toBe("Unknown");
    expect(optionsFrom(["Cash", "Physical"] as const, { Cash: "Barausgleich", Physical: "Physisch" })).toEqual([
      { v: "Cash", l: "Barausgleich" },
      { v: "Physical", l: "Physisch" },
    ]);
  });
  it("germanises leg badges, builder names, hedge summaries and document numbers (N-07)", () => {
    expect(legTypeLabel("Vanilla Put EURUSD")).toBe("Put EUR/USD");
    expect(legTypeLabel("Digital Call EURCHF")).toBe("Digital-Call EUR/CHF");
    expect(legTypeLabel("Payer swaption")).toBe("Payer-Swaption");
    expect(legTypeLabel("Fixed")).toBe("Fest");
    expect(germanTradeName("Sell EURUSD 2.000.000 @ 1.1725")).toBe("Verkauf EUR/USD 2.000.000 @ 1,1725");
    expect(germanTradeName("Payer swaption 1Yx5Y @ 3.000%")).toBe("Payer-Swaption 1Y×5Y @ 3,000 %");
    expect(germanTradeName("Payer EUR 10Y @ 3.100%")).toBe("Payer-Swap EUR 10Y @ 3,100 %");
    expect(germanTradeName("Cap EUR 5Y @ 3.00%")).toBe("Cap EUR 5Y @ 3,00 %");
    expect(germanTradeName("Put EURUSD 3.000.000 @ 1.15")).toBe("Put EUR/USD 3.000.000 @ 1,15");
    expect(germanTradeName("Mein eigener Name")).toBe("Mein eigener Name");
    expect(germanizeText("designiert am 2026-09-30 (InterestRateSwap)")).toBe("designiert am 30.09.2026 (Zinsswap)");
    expect(germanizeDocValue("1.216 %")).toBe("1,216 %");
    expect(germanizeDocValue("1.1725", "Terminkurs")).toBe("1,1725");
    expect(germanizeDocValue("10.000.000 EUR")).toBe("10.000.000 EUR");
    expect(germanizeDocValue("5.000 EUR")).toBe("5.000 EUR");
    expect(germanizeDocValue("31.12.2027")).toBe("31.12.2027");
    expect(germanizeParagraph("Kontrahentenrisiko: Swaption-replication (Sorensen–Bollier), smile vol at strike, flat hazard; Pillar 2056-09-08")).toBe(
      "Kontrahentenrisiko: Swaption-Replikation (Sorensen–Bollier), Smile-Vol am Strike, konstante Hazard-Rate; Pillar 08.09.2056",
    );
  });
});
