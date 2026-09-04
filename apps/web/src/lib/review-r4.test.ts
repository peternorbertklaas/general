/** Regression tests for the round-4 UI / market review findings (docs/quality/review-ui-r4.md, review-markt-r4.md). */
import { describe, expect, it } from "vitest";
import { PricingError, parseISO, toISO } from "@deriva/pricing-core";
import type { GeneratedDocument } from "@deriva/pricing-core";
import { filterForCustomer } from "../components/DocumentsModal.js";
import { legTypeLabel, translateCoreMessage, translatePricingError, translateTradeIssues } from "./i18n.js";
import { bucketLabel } from "./metrics.js";
import { jsonImportError } from "./portfolio-io.js";
import { QUICK_ENTRY_EXAMPLES, dateLabel, parseQuickEntry, parseValuationDateCommand } from "./quick-parser.js";

const VAL = parseISO("2026-09-03");
const SPOTS = { fxSpots: { EURUSD: 1.1625, EURJPY: 170 } };

describe("R4-05 – core validator messages in German", () => {
  it("translates 'Invalid trade …' with per-leg issues", () => {
    const msg =
      "Invalid trade HYPO-HR-IRS-0001: trade.legs[0]: terminationDate must be after effectiveDate; trade.legs[1]: terminationDate must be after effectiveDate";
    expect(translateCoreMessage(msg)).toBe(
      "Trade HYPO-HR-IRS-0001: Leg 1: Enddatum muss nach dem Startdatum liegen; Leg 2: Enddatum muss nach dem Startdatum liegen",
    );
    expect(translatePricingError(new PricingError("INVALID_TRADE", msg))).toMatch(/^Ungültige Trade-Daten: Trade HYPO-HR-IRS-0001: Leg 1: Enddatum/);
    expect(translateTradeIssues("trade.notional: must be positive")).toBe("Nominal: muss positiv sein");
  });
  it("translates the new structured core warnings (FX fixing, value today, collateral curve)", () => {
    expect(
      translateCoreMessage(
        "MISSING_FX_FIXING: Missing FX fixing for EURUSD on 2026-03-01; MtM reset of leg 1 valued with today's rate as proxy (load ctx.fxFixings)",
      ),
    ).toBe("FX-Fixing EUR/USD vom 01.03.2026 fehlt – MtM-Reset von Leg 2 mit dem heutigen Kurs genähert (FX-Fixings im Markt hinterlegen)");
    expect(
      translateCoreMessage(
        "SETTLES_TODAY: near leg settles on the valuation date 2026-09-03 – valued as a value-today exchange at the today rate (not discounted)",
      ),
    ).toBe("Near-Leg wird am Bewertungstag (03.09.2026) geliefert – als Value-Today-Geschäft zum Heute-Kurs bewertet (nicht diskontiert)");
    expect(
      translateCoreMessage(
        'COLLATERAL_CURVE_MISSING: no EUR discount curve for collateral in GBP (collateralDiscountCurveId "EUR|GBP"); discounted on EUR-ESTR – cross-currency basis not priced',
      ),
    ).toBe(
      "Keine EUR-Diskontkurve für Besicherung in GBP (Collateral-Kurve „EUR|GBP“ fehlt) – Diskontierung auf EUR-ESTR, Cross-Currency-Basis nicht gepreist",
    );
    for (const raw of ["MISSING_FX_FIXING: whatever", "SETTLES_TODAY: whatever", "COLLATERAL_CURVE_MISSING: whatever"])
      expect(translateCoreMessage(raw)).not.toMatch(/^[A-Z_]+:/);
  });
});

describe("R4-10 – language leftovers", () => {
  it("leg badges: Float/Fixed with index become German", () => {
    expect(legTypeLabel("Float EURIBOR-6M")).toBe("Variabel EURIBOR-6M");
    expect(legTypeLabel("Float USD-SOFR")).toBe("Variabel USD-SOFR");
    expect(legTypeLabel("Float")).toBe("Variabel");
    expect(legTypeLabel("Fixed 3.10%")).toBe("Fest 3,10 %");
  });
  it("vega bucket kinds are German nouns", () => {
    expect(bucketLabel("swaption:EUR")).toBe("Swaption EUR");
    expect(bucketLabel("caplet:EUR-EURIBOR-6M")).toBe("Caplet EUR-EURIBOR-6M");
    expect(bucketLabel("EUR:1Y")).toBe("EUR 1Y");
    expect(bucketLabel("EURUSD")).toBe("EURUSD");
  });
  it("customer documents drop CVA/DVA and bilateral rows but keep the legally required initial market value", () => {
    const doc: GeneratedDocument = {
      kind: "Termsheet",
      title: "T",
      subtitle: "S",
      generatedAt: "2026-09-03T00:00:00Z",
      disclaimer: "",
      markdown: "",
      sections: [
        {
          heading: "Bewertung",
          rows: [
            ["Fair Value (risikofrei)", "1"],
            ["Fair Value bilateral (inkl. CVA/DVA)", "2"],
            ["CVA", "3"],
            ["Anfänglicher negativer Marktwert", "4"],
            ["Marge der Bank", "5"],
          ],
        },
      ],
    };
    const rows = filterForCustomer(doc, true).sections[0]!.rows!.map(([k]) => k);
    expect(rows).toEqual(["Fair Value (risikofrei)", "Anfänglicher negativer Marktwert"]);
    expect(filterForCustomer(doc, false).sections[0]!.rows!.length).toBe(5);
  });
});

describe("R4-06 / Markt R4-2 – quick entry", () => {
  it("accepts German dates (dd.mm.yyyy and dd.mm.yy) next to ISO and rejects impossible dates", () => {
    const de = parseQuickEntry("fxf eurusd -2m 1.1725 15.03.2027", VAL, SPOTS);
    expect(de.ok).toBe(true);
    if (de.trade?.type === "FxForward") expect(toISO(de.trade.deliveryDate)).toBe("2027-03-15");
    expect(de.trade?.name).toBe("Verkauf EUR/USD 15.03.2027");
    expect(de.description).toContain("15.03.2027");
    const short = parseQuickEntry("fxf eurusd 2m 1.1725 31.12.27", VAL, SPOTS);
    expect(short.ok).toBe(true);
    if (short.trade?.type === "FxForward") expect(toISO(short.trade.deliveryDate)).toBe("2027-12-31");
    const iso = parseQuickEntry("fxo eurusd put 1.15 3m 2027-06-15", VAL, SPOTS);
    expect(iso.ok).toBe(true);
    const fxo = parseQuickEntry("fxo eurusd put 1.15 3m 15.06.2027", VAL, SPOTS);
    expect(fxo.ok).toBe(true);
    if (fxo.trade?.type === "FxOption") expect(toISO(fxo.trade.expiryDate)).toBe("2027-06-15");
    expect(fxo.trade?.name).toBe("EUR-Put/USD-Call 15.06.2027");
    const bad = parseQuickEntry("fxf eurusd -2m 1.1725 31.02.2027", VAL, SPOTS);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Ungültiges Datum „31.02.2027“ – Datum als 15.03.2027 oder 2027-03-15/);
    const missing = parseQuickEntry("fxf eurusd -2m 1.1725", VAL, SPOTS);
    expect(missing.error).toMatch(/15\.03\.2027/);
    expect(dateLabel("15.03.2027")).toBe("15.03.2027");
    expect(dateLabel("2027-03-15")).toBe("15.03.2027");
    expect(dateLabel("9m")).toBe("9M");
    expect(parseValuationDateCommand("stichtag 31.12.26")).toBe("2026-12-31");
    expect(parseValuationDateCommand("stichtag 31.02.2026")).toBeUndefined();
  });
  it("swaptions take a currency token (Markt R4-2) and flag currencies without a vol cube", () => {
    const usd = parseQuickEntry("swpt usd 1y5y payer 3.5% 10m", VAL, { swaptionVolCurrencies: ["EUR", "USD", "GBP"] });
    expect(usd.ok).toBe(true);
    if (usd.trade?.type === "Swaption") {
      expect(usd.trade.underlying.legs.every((l) => l.currency === "USD")).toBe(true);
      expect(usd.trade.underlying.legs.some((l) => l.type === "Float" && (l as { index: string }).index === "SOFR")).toBe(true);
    }
    expect(usd.trade?.name).toBe("Payer-Swaption USD 1Y×5Y");
    expect(usd.description).toContain("Payer-Swaption USD 1Yx5Y");
    expect(usd.description).not.toContain("⚠");
    const eur = parseQuickEntry("swpt 1y5y payer 3% 10m", VAL);
    if (eur.trade?.type === "Swaption") expect(eur.trade.underlying.legs[0]!.currency).toBe("EUR");
    const chf = parseQuickEntry("swpt chf 2y10y rec 1% 5m", VAL, { swaptionVolCurrencies: ["EUR", "USD", "GBP"] });
    expect(chf.ok).toBe(true);
    expect(chf.description).toMatch(/kein Swaption-Vol-Cube für CHF/);
    const unknown = parseQuickEntry("swpt xyz 1y5y payer 3% 10m", VAL);
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/Unbekannte Währung „XYZ“/);
  });
  it("every example parses and mentions the fixed CCS and the USD swaption", () => {
    for (const ex of QUICK_ENTRY_EXAMPLES) expect(parseQuickEntry(ex, VAL, SPOTS).ok, ex).toBe(true);
    expect(QUICK_ENTRY_EXAMPLES).toContain("ccs eurusd 5y fixed 3% 10m");
    expect(QUICK_ENTRY_EXAMPLES).toContain("swpt usd 1y5y payer 3.5% 10m");
    expect(QUICK_ENTRY_EXAMPLES.some((e) => /\d{2}\.\d{2}\.\d{4}/.test(e))).toBe(true);
  });
});

describe("R4-F1 – JSON import errors", () => {
  it("turns a JSON.parse SyntaxError into a German message with the position", () => {
    let err: unknown;
    try {
      JSON.parse("{x");
    } catch (e) {
      err = e;
    }
    const msg = jsonImportError(err);
    expect(msg).toMatch(/^Datei ist kein gültiges DERIVA-JSON/);
    expect(msg).toMatch(/Portfolio als JSON/);
    expect(msg).not.toMatch(/Expected|JSON at position/);
    expect(jsonImportError(new SyntaxError("Unexpected token x in JSON at position 1 (line 1 column 2)"))).toContain("(Zeile 1, Spalte 2)");
    expect(jsonImportError(new Error("Datei enthält keine Trade-Liste"))).toBe("Datei enthält keine Trade-Liste");
  });
});
