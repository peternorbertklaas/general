import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { addDays, addTenor, parseISO } from "../dates/date.js";
import { formatDateDe } from "../format.js";
import {
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
} from "../instruments/builders.js";
import { TRADE_TYPE_LABELS_DE, tradeTypeLabelDe } from "../instruments/labels.js";
import { type Trade } from "../instruments/types.js";
import { type HedgeRelationship, hedgeEffectivenessReport } from "../hedge/hedge.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { priceTrade } from "../pricing/price.js";
import { STANDARD_SCENARIOS, applyScenario, runScenarios } from "../risk/scenarios.js";
import { generateConfirmation, generateKid, generateSuitabilityStatement, generateTermsheet } from "./documents.js";
import { buildValuationReport } from "./valuation-report.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));

/** ISO dates (2026-09-03), English trade-type identifiers and decimal-point numbers (1.18, 3.10 %, 1.1725). */
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const ENGLISH_TYPES = /\b(InterestRateSwap|ForwardRateAgreement|CapFloor|FxForward|FxSwap|FxOption|CrossCurrencySwap)\b/;
// A standalone number with one dot and 1–2 or ≥ 4 decimals can never be a German thousands group ("1.000.000"), a
// dotted date ("03.09.2026"), a version ("0.2.0") or a paragraph citation ("B6.5.5"); a dot before " %" never is.
const DOT_DECIMAL = /(?<![\d.])\d+\.(\d{1,2}|\d{4,})(?![\d.])|\d\.\d+\s?%/;

function expectGerman(text: string, what: string): void {
  expect(text, `${what}: ISO date`).not.toMatch(ISO_DATE);
  expect(text, `${what}: English trade type`).not.toMatch(ENGLISH_TYPES);
  expect(text, `${what}: decimal point`).not.toMatch(DOT_DECIMAL);
}

const trades: Trade[] = [
  makeVanillaSwap({
    id: "IRS-DE",
    currency: "EUR",
    notional: 1e7,
    payReceiveFixed: "Pay",
    fixedRate: 0.031,
    effectiveDate: spot,
    maturity: "10Y",
    counterparty: "Sparkasse",
  }),
  makeCapFloor({ id: "CAP-DE", currency: "EUR", notional: 5e6, capFloor: "Collar", strike: 0.035, floorStrike: 0.015, effectiveDate: spot, maturity: "5Y" }),
  makeSwaption({
    id: "SWPT-DE",
    currency: "EUR",
    notional: 1e7,
    payerReceiver: "Payer",
    strike: 0.03,
    expiry: "1Y",
    tenor: "5Y",
    valuationDate: VAL,
    settlement: "Cash",
  }),
  makeFra({ id: "FRA-DE", currency: "EUR", notional: 1e7, payReceive: "Pay", start: "3x9", rate: 0.0225, valuationDate: VAL }),
  makeFxForward({ id: "FXF-DE", pair: "EURUSD", baseAmount: -2e6, rate: 1.1725, deliveryDate: addDays(VAL, 180) }),
  makeFxSwap({ id: "FXS-DE", pair: "EURUSD", baseAmount: 1e6, nearRate: 1.17, farRate: 1.1745, nearDate: spot, farDate: addDays(VAL, 92) }),
  makeFxOption({ id: "FXO-DE", pair: "EURUSD", optionType: "Put", notional: 1e6, strike: 1.15, expiryDate: addDays(VAL, 270) }),
  makeCrossCurrencySwap({
    id: "CCS-DE",
    pair: "EURUSD",
    domesticNotional: 1e7,
    fxSpot: 1.17,
    spread: -0.002,
    effectiveDate: spot,
    tenor: "5Y",
    mtmReset: true,
  }),
];

describe("R3-2 – German / deterministic text in core outputs", () => {
  it("formatDateDe and the trade-type labels", () => {
    expect(formatDateDe(VAL)).toBe("03.09.2026");
    expect(formatDateDe(parseISO("2031-01-09"))).toBe("09.01.2031");
    expect(formatDateDe(Number.NaN)).toBe("n/a");
    expect(tradeTypeLabelDe("InterestRateSwap")).toBe("Zinsswap");
    expect(tradeTypeLabelDe("FxForward")).toBe("FX-Termingeschäft");
    expect(tradeTypeLabelDe("CrossCurrencySwap")).toBe("Cross-Currency-Swap");
    expect(tradeTypeLabelDe("Unknown")).toBe("Unknown");
    for (const label of Object.values(TRADE_TYPE_LABELS_DE)) expectGerman(label, "label");
  });

  it("builders' default names are German display strings with a decimal comma", () => {
    for (const t of trades) expectGerman(t.name!, `name of ${t.id}`);
    expect(trades[0]!.name).toBe("Payer-Swap EUR 10Y @ 3,100 %");
    expect(trades[1]!.name).toBe("Collar EUR 5Y @ 3,50 %");
    expect(trades[2]!.name).toBe("Payer-Swaption 1Y×5Y @ 3,000 %");
    expect(trades[3]!.name).toBe("FRA EUR 3x9 Zahler @ 2,250 %");
    expect(trades[4]!.name).toBe("Verkauf EUR/USD 2.000.000 @ 1,1725");
    expect(trades[5]!.name).toBe("FX-Swap EUR/USD 1.000.000 +45,0 Pkt");
    expect(trades[6]!.name).toBe("Put EUR/USD 1.000.000 @ 1,1500");
    expect(trades[7]!.name).toBe("Cross-Currency-Swap EUR/USD 5Y ESTR -20,0 bp vs SOFR (MtM-Reset)");
    const basis = makeBasisSwap({
      id: "B",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: spot,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0.0012,
    });
    expect(basis.name).toBe("Basis-Swap EURIBOR-3M +12,0 bp vs EURIBOR-6M 5Y");
    expect(makeImmSwap({ id: "I", currency: "EUR", notional: 1e7, payReceiveFixed: "Receive", fixedRate: 0.0275, from: VAL, tenor: "2Y" }).name).toBe(
      "IMM-Swap EUR 2Y @ 2,750 %",
    );
    const amort = makeAmortisingSwap({ id: "A", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
    expect(amort.name).toBe("Payer-Swap EUR 5Y @ 3,000 % (amortisierend)");
    expect(
      makeVanillaSwap({ currency: "EUR", notional: 1e6, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: addTenor(spot, "3Y") }).name,
    ).toBe("Payer-Swap EUR @ 3,000 %");
    // explicit names are kept verbatim
    expect(
      makeVanillaSwap({ name: "Mein Swap", currency: "EUR", notional: 1e6, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "3Y" }).name,
    ).toBe("Mein Swap");
  });

  it("termsheet, suitability statement, confirmation and KID contain no ISO dates, English type identifiers or decimal points", () => {
    for (const trade of trades) {
      const pricing = priceTrade(ctx, trade, "EUR");
      const report = buildValuationReport(ctx, trade, pricing, { transactionPrice: 12_500, generatedAt: "2026-09-03T17:00:00Z" });
      const scenarios = runScenarios(ctx, [trade], STANDARD_SCENARIOS.slice(1, 5), "EUR").results;
      const docs = [
        generateTermsheet(ctx, trade, pricing, report),
        generateSuitabilityStatement(
          ctx,
          trade,
          pricing,
          report,
          {
            clientName: "Muster GmbH",
            clientClassification: "Professioneller Kunde",
            hedgingPurpose: "Absicherung Investitionskredit",
            knowledgeExperience: "Erfahrung mit Derivaten",
            financialSituation: "solide",
            riskTolerance: "mittel",
            investmentHorizonYears: 10,
            advisorName: "A. Berater",
            transactionPrice: 12_500,
          },
          scenarios,
        ),
        generateConfirmation(
          trade,
          { bank: { name: "Bank AG", lei: "5299001234567890ABCD" }, client: { name: "Muster GmbH" } },
          { type: "DRV", date: parseISO("2020-01-15"), reference: "RV-2020-001" },
          ctx,
          pricing,
          { tradeDate: VAL, confirmationDate: VAL },
        ),
        generateKid(ctx, trade, pricing, undefined, { manufacturer: "Bank AG", report, transactionPrice: 12_500 }),
      ];
      for (const doc of docs) {
        expectGerman(doc.markdown, `${doc.kind} of ${trade.id}`);
        expect(doc.markdown).toContain("03.09.2026");
      }
      // the report's own German text (methodology, IFRS 13 rationale) is embedded in the termsheet
      expectGerman(report.methodology.join("\n"), `methodology of ${trade.id}`);
      expectGerman(report.fairValue.rationale, `rationale of ${trade.id}`);
    }
  });

  it("KID names the SRI heuristic and the Annex II roadmap", () => {
    const trade = trades[1]!;
    const pricing = priceTrade(ctx, trade, "EUR");
    const kid = generateKid(ctx, trade, pricing, undefined, { manufacturer: "Bank AG", perspective: "Kunde", transactionPrice: pricing.pv * 1.1 });
    const risk = kid.sections.find((s) => s.heading.startsWith("Welche Risiken"))!;
    const derivation = risk.rows!.find(([k]) => k === "Herleitung")![1];
    expect(derivation).toContain("Heuristik");
    expect(derivation).toContain("Anhang II DelVO (EU) 2017/653");
    expect(derivation).toContain("0,5–5 % Klasse 2");
    expect(derivation).toContain("Monte-Carlo");
    expect(derivation).toContain("Weiterentwicklung");
    expect(risk.rows!.find(([k]) => k.startsWith("Gesamtrisikoindikator"))![1]).toMatch(/^[2-7] von 7/);
  });

  it("hedge summaries, warnings and critical-term strings are German (swap, cap, FX forward hedges)", () => {
    const maturity = addTenor(spot, "5Y");
    const swap = makeVanillaSwap({ id: "IRS-H", currency: "EUR", notional: 9e6, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity });
    const cap = makeCapFloor({
      id: "CAP-H",
      currency: "EUR",
      notional: 1e7,
      capFloor: "Cap",
      strike: 0.03,
      effectiveDate: spot,
      maturity: addTenor(spot, "4Y"),
    });
    const fwd = makeFxForward({ id: "FXF-H", pair: "EURUSD", baseAmount: -1e6, rate: 1.17, deliveryDate: addDays(VAL, 180) });
    const loan = (id: string, index = "EURIBOR-6M"): HedgeRelationship => ({
      id: `HR-${id}`,
      name: "Zinssicherung Darlehen",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Roll-over-Kredit",
        currency: "EUR",
        notional: 1e7,
        kind: "FloatingRateLoan",
        index,
        effectiveDate: spot,
        maturityDate: maturity,
      },
      hedgingInstrumentId: id,
      designationDate: VAL,
      method: "DollarOffset",
      accountingFramework: "IFRS9",
    });
    const fxRel: HedgeRelationship = {
      id: "HR-FX",
      name: "Absicherung USD-Erlös",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "USD-Exporterlös",
        currency: "USD",
        notional: 1.2e6,
        kind: "ForecastFxCashflow",
        fxPair: "EURUSD",
        effectiveDate: VAL,
        maturityDate: addDays(VAL, 180),
      },
      hedgingInstrumentId: "FXF-H",
      designationDate: VAL,
      method: "DollarOffset",
      accountingFramework: "HGB",
    };
    const later = applyScenario(
      { ...ctx, valuationDate: VAL },
      { id: "p", name: "p", curveShifts: [{ target: "*", parallelBp: 40 }], fxShiftsPct: { USD: 3 } },
    );
    const staleDesignation = { ...ctx, valuationDate: VAL - 3 };
    const reports = [
      // notional / index / maturity mismatches and a stale designation date produce the full set of warnings
      hedgeEffectivenessReport(later, { ...loan("IRS-H", "EURIBOR-3M"), hedgeRatio: 0.9 }, swap, { designationCtx: staleDesignation }),
      hedgeEffectivenessReport(later, loan("CAP-H"), cap, { designationCtx: ctx, freezeDesignationVol: true }),
      hedgeEffectivenessReport(later, { ...fxRel, hedgingInstrumentId: "OTHER" }, fwd),
    ];
    for (const rep of reports) {
      expect(rep.summary.length).toBeGreaterThan(5);
      expect(rep.warnings.length).toBeGreaterThan(0);
      expectGerman(rep.summary.join("\n"), `summary of ${rep.relationshipId}`);
      expectGerman(rep.warnings.join("\n"), `warnings of ${rep.relationshipId}`);
      for (const c of rep.criticalTerms.checks) expectGerman(`${c.hedgedItem} ${c.hedgingInstrument}`, `check ${c.term} of ${rep.relationshipId}`);
      expect(rep.summary[0]).toContain("designiert am 03.09.2026");
    }
    expect(reports[0]!.summary.some((s) => s.includes("(Zinsswap)"))).toBe(true);
    expect(reports[1]!.summary.some((s) => s.includes("(Cap/Floor)"))).toBe(true);
    expect(reports[2]!.summary.some((s) => s.includes("(FX-Termingeschäft)"))).toBe(true);
    expect(reports[0]!.warnings.some((w) => w.includes("31.08.2026"))).toBe(true);
    expect(reports[0]!.criticalTerms.checks.find((c) => c.term === "notional")!.hedgedItem).toBe("9.000.000,00");
    expect(reports[0]!.criticalTerms.checks.find((c) => c.term === "maturityDate")!.hedgedItem).toBe(formatDateDe(maturity));
  });
});
