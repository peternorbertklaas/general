import { describe, expect, it } from "vitest";
import { PricingError } from "@deriva/pricing-core";
import {
  CASHFLOW_KIND_DE,
  INTERPOLATION_DE,
  LEG_TYPE_DE,
  PRICING_ERROR_CODES_DE,
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
    // R7-F1 / R7-F2: missing market data name the in-app repair path
    expect(translateCoreMessage("Curve not found in market context: EUR-XYZ")).toBe(
      "Kurve EUR-XYZ nicht im Markt-Snapshot – in der Kurvenansicht mit „+ Kurve“ anlegen",
    );
    expect(translateCoreMessage("FX spot not available for DKKEUR")).toBe(
      "Kein FX-Spot für DKKEUR verfügbar – in der Marktansicht unter FX-Spots mit „+ Paar“ ergänzen",
    );
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
      "Keine Diskontkurve konfiguriert: Keine Diskontkurve für JPY konfiguriert – in der Kurvenansicht mit „+ Kurve“ eine JPY-Kurve anlegen",
    );
    expect(translatePricingError(new PricingError("INVALID_TRADE", "terminationDate must be after effectiveDate"))).toBe(
      "Ungültige Trade-Daten: Enddatum muss nach dem Startdatum liegen",
    );
    expect(translatePricingError(new PricingError("NON_FINITE_PV", "PV not finite"))).toBe("Barwert nicht berechenbar");
    expect(translatePricingError(new Error("FRA already settled"))).toBe("FRA bereits abgerechnet");
    expect(translatePricingError("plain")).toBe("plain");
    // core round 4: typed date / tenor parse errors
    // the headline is not repeated when the translated detail already starts with it (R5-06)
    expect(translatePricingError(new PricingError("INVALID_DATE", "Invalid ISO date: 2026-13-45"))).toBe("Ungültiges Datum: 2026-13-45");
    expect(translatePricingError(new PricingError("INVALID_DATE", "Invalid date: foo"))).toBe("Ungültiges Datum: foo");
    expect(translatePricingError(new PricingError("INVALID_TENOR", "Invalid tenor: 7X"))).toBe("Ungültiger Tenor: 7X");
    expect(PRICING_ERROR_CODES_DE.INVALID_DATE).toBe("Ungültiges Datum");
    expect(PRICING_ERROR_CODES_DE.INVALID_TENOR).toBe("Ungültiger Tenor");
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
    expect(germanTradeName("FRA EUR 3x6 Pay @ 2.200%")).toBe("FRA EUR 3x6 Zahler @ 2,200 %");
    expect(germanTradeName("CCS EURUSD 5Y ESTR -20.0bp vs SOFR")).toBe("CCS EUR/USD 5Y ESTR −20,0 bp vs SOFR");
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
  it("methodology prose: code identifiers, conventions and interpolation ids become German labels (R3-06)", () => {
    expect(germanizeParagraph("Perspektive Kunde: Barwert (fairValue) und Transaktionspreis; marginBp/marginPct beziehen die Marge auf das Nominal.")).toBe(
      "Perspektive Kunde: Barwert (Fair Value) und Transaktionspreis; Marge in bp / % des Nominals beziehen die Marge auf das Nominal.",
    );
    expect(germanizeParagraph("Geldbetrag wie analytics.deltaAmount, nicht die Delta-Quote deltaPct")).toBe(
      "Geldbetrag wie Delta-Betrag (Analytics), nicht die Delta-Quote Delta-Quote",
    );
    expect(germanizeParagraph("Leg 2 (Empfang, Float EURIBOR-6M): 6M, ACT/360, ModifiedFollowing, Kalender TARGET, Stub ShortFront")).toBe(
      "Leg 2 (Empfang, variabel EURIBOR-6M): 6M, ACT/360, Modified Following, Kalender TARGET, Stub: kurzer Stub vorne",
    );
    expect(germanizeParagraph("als MISSING_FIXING gemeldet (Policy „curve“)")).toBe("als „Fixing fehlt“ gemeldet (Regel „curve“)");
    expect(germanizeParagraph("Interpolation logLinear, Kurve monotoneConvex")).toBe("Interpolation log-linear (DF), Kurve monoton-konvex (Hagan–West)");
    // defensive fallback: unknown camelCase identifiers never survive raw
    expect(germanizeParagraph("siehe spotDate und greeksMethod")).toBe("siehe Spot Date und Greeks Method");
    expect(germanizeParagraph("siehe Spot Date")).not.toMatch(/\b[a-z]+[A-Z]\w+\b/);
    expect(INTERPOLATION_DE.logLinear).toBe("log-linear (DF)");
    expect(INTERPOLATION_DE.linearZero).toBe("linear (Zero)");
    expect(INTERPOLATION_DE.cubicSplineZero).toBe("kubischer Spline (Zero)");
    expect(INTERPOLATION_DE.flatForward).toBe("flat forward");
    expect(INTERPOLATION_DE.monotoneConvex).toMatch(/^monoton-konvex/);
  });
  it("translates the round-3 core codes (vol conversion, frequency, day count, periods, credit curve, timestamp, hazard floor)", () => {
    expect(
      translateCoreMessage(
        "VOL_TYPE_CONVERTED: caplet surface EUR-EURIBOR-6M quotes normal vols but model Black was requested – vols converted to lognormal by price equivalence at each forward/strike/expiry",
      ),
    ).toBe(
      "Volatilität der Caplet-Fläche EUR-EURIBOR-6M von Normal- in Lognormal-Quotierung umgerechnet (Modell Black, preisäquivalent je Forward/Strike/Verfall)",
    );
    expect(
      translateCoreMessage(
        "VOL_TYPE_CONVERTED: swaption surface EUR quotes lognormal, shift 3.00% vols but model Bachelier was requested – vols converted to normal by price equivalence at each forward/strike/expiry",
      ),
    ).toMatch(/Swaption-Fläche EUR von Lognormal \(Shift 3,00%\)- in Normal-Quotierung umgerechnet/);
    expect(
      translatePricingError(
        new PricingError(
          "VOL_MODEL_INCOMPATIBLE",
          "A lognormal model cannot be fed from the normal surface: shifted forward -0.250% / strike 1.000% is not positive – use Bachelier or a larger shift",
        ),
      ),
    ).toBe(
      "Volatilitätsquotierung mit dem Modell unvereinbar: Lognormal-Modell nicht mit der Normal-Fläche vereinbar: verschobener Forward -0,250% / Strike 1,000% nicht positiv – Bachelier oder größeren Shift verwenden",
    );
    expect(translatePricingError(new PricingError("INVALID_FREQUENCY", 'Invalid frequency: 7X (expected a tenor like "3M", "6M", "1Y" or "ZC")'))).toBe(
      "Ungültige Kuponfrequenz: Ungültige Frequenz: 7X (erwartet ein Tenor wie 3M, 6M, 1Y oder ZC)",
    );
    expect(translatePricingError(new PricingError("UNKNOWN_DAYCOUNT", "Unknown day count convention: ACT/999"))).toBe("Unbekannte Tageszählung: ACT/999");
    expect(
      translatePricingError(
        new PricingError(
          "TOO_MANY_PERIODS",
          "Schedule with frequency 1M would have 1200 periods (limit 1000) – shorten the leg or use a longer coupon frequency",
        ),
      ),
    ).toBe("Zu viele Zahlungsperioden: Zahlungsplan mit Frequenz 1M hätte 1200 Perioden (Grenze 1000) – Laufzeit verkürzen oder längere Kuponfrequenz wählen");
    expect(
      translatePricingError(new PricingError("INVALID_CREDIT_CURVE", "bootstrapHazardCurve: CDS spread of 5Y must be a finite, non-negative number")),
    ).toBe("Ungültige CDS-Termstruktur: CDS-Termstruktur: Spread 5Y muss eine endliche, nicht negative Zahl sein");
    expect(
      translatePricingError(
        new PricingError(
          "INVALID_CREDIT_CURVE",
          "bootstrapHazardCurve: pillar 2Y (t = 2.014y) implies a hazard rate of -12.3bp: the survival probability would increase over the interval (inverted CDS quotes)",
        ),
      ),
    ).toMatch(/Pillar 2Y \(t = 2,014 J\) impliziert eine Hazard-Rate von -12,3 bp/);
    expect(
      translateCoreMessage(
        "HAZARD_FLOORED: pillar 2Y (t = 2.014y) implies a hazard rate of -12.3bp: the survival probability would increase over the interval (inverted CDS quotes) – floored at 0, the 2Y quote does not reprice",
      ),
    ).toBe("Hazard-Rate am Pillar 2Y (t = 2,014 J) wäre -12,3 bp (inverse CDS-Quotes) – auf 0 begrenzt, die 2Y-Quote wird nicht exakt reproduziert");
    expect(
      translatePricingError(new PricingError("INVALID_TIMESTAMP", 'asOf "gestern" is not an ISO-8601 date-time – EMIR field 23 needs YYYY-MM-DDThh:mm:ssZ')),
    ).toBe('Ungültiger Zeitstempel: asOf "gestern" ist kein ISO-8601-Zeitstempel – EMIR-Feld 23 erwartet JJJJ-MM-TTThh:mm:ssZ');
    for (const code of [
      "VOL_MODEL_INCOMPATIBLE",
      "INVALID_FREQUENCY",
      "UNKNOWN_DAYCOUNT",
      "TOO_MANY_PERIODS",
      "INVALID_CREDIT_CURVE",
      "INVALID_TIMESTAMP",
      "HAZARD_FLOORED",
    ])
      expect(PRICING_ERROR_CODES_DE[code], code).toBeTruthy();
  });
});
