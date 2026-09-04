import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { addDays, parseISO } from "../dates/date.js";
import { makeCapFloor, makeFxForward, makeFxOption, makeVanillaSwap } from "../instruments/builders.js";
import { type Trade } from "../instruments/types.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { computeRisk } from "../risk/sensitivities.js";
import { buildPortfolioReport, portfolioReportToMarkdown } from "./portfolio-report.js";
import { ENGINE_VERSION, marketSnapshotId } from "./valuation-report.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));

const book: Trade[] = [
  makeVanillaSwap({
    id: "IRS-A",
    currency: "EUR",
    notional: 1e7,
    payReceiveFixed: "Pay",
    fixedRate: 0.03,
    effectiveDate: spot,
    maturity: "5Y",
    counterparty: "Alpha GmbH",
  }),
  {
    ...makeVanillaSwap({
      id: "IRS-B",
      currency: "USD",
      notional: 5e6,
      payReceiveFixed: "Receive",
      fixedRate: 0.04,
      effectiveDate: spot,
      maturity: "3Y",
      counterparty: "Beta AG",
    }),
    book: "Treasury",
  },
  { ...makeFxForward({ id: "FXF-A", pair: "EURUSD", baseAmount: -2e6, rate: 1.17, deliveryDate: addDays(VAL, 120), counterparty: "Alpha GmbH" }), book: "FX" },
  {
    ...makeCapFloor({
      id: "CAP-B",
      currency: "EUR",
      notional: 4e6,
      capFloor: "Cap",
      strike: 0.03,
      effectiveDate: spot,
      maturity: "4Y",
      counterparty: "Beta AG",
    }),
    book: "Treasury",
  },
];

describe("R3-4 – buildPortfolioReport", () => {
  const report = buildPortfolioReport(ctx, book, "EUR", { generatedAt: "2026-09-03T17:00:00Z", preparedBy: "Marktfolge" });

  it("lines carry PV, parallel DV01, theta and FX delta consistent with computeRisk; totals are the sums", () => {
    expect(report.lines.map((l) => l.tradeId)).toEqual(["IRS-A", "IRS-B", "FXF-A", "CAP-B"]);
    expect(report.reportingCurrency).toBe("EUR");
    expect(report.valuationDate).toBe("2026-09-03");
    for (const l of report.lines) {
      const trade = book.find((t) => t.id === l.tradeId)!;
      const risk = computeRisk(ctx, trade, "EUR", { bucketed: false, vega: false });
      expect(l.pv).toBeCloseTo(risk.pv, 6);
      expect(l.dv01).toBeCloseTo(risk.dv01, 6);
      expect(l.theta).toBeCloseTo(risk.theta, 6);
      expect(l.fxDelta).toEqual(risk.fxDelta);
      expect(l.error).toBeUndefined();
    }
    const sum = (f: (l: (typeof report.lines)[number]) => number) => report.lines.reduce((s, l) => s + f(l), 0);
    expect(report.totals.trades).toBe(4);
    expect(report.totals.pv).toBeCloseTo(
      sum((l) => l.pv),
      6,
    );
    expect(report.totals.dv01).toBeCloseTo(
      sum((l) => l.dv01),
      6,
    );
    expect(report.totals.theta).toBeCloseTo(
      sum((l) => l.theta),
      6,
    );
    expect(report.totals.fxDelta.USDEUR).toBeCloseTo(report.lines[1]!.fxDelta.USDEUR! + report.lines[2]!.fxDelta.USDEUR!, 6);
    expect(report.failed).toBe(0);
    expect(report.warningsCount).toBe(sum((l) => l.warnings.length));
  });

  it("aggregates by counterparty, book (– for unassigned) and trade type", () => {
    expect(report.byCounterparty.map((a) => a.key)).toEqual(["Alpha GmbH", "Beta AG"]);
    const alpha = report.byCounterparty[0]!;
    expect(alpha.trades).toBe(2);
    expect(alpha.pv).toBeCloseTo(report.lines[0]!.pv + report.lines[2]!.pv, 6);
    expect(alpha.dv01).toBeCloseTo(report.lines[0]!.dv01 + report.lines[2]!.dv01, 6);
    expect(report.byBook.map((a) => a.key)).toEqual(["FX", "Treasury", "–"]);
    expect(report.byBook.find((a) => a.key === "Treasury")!.trades).toBe(2);
    expect(report.byBook.find((a) => a.key === "–")!.trades).toBe(1);
    expect(report.byType.map((a) => a.key)).toEqual(["CapFloor", "FxForward", "InterestRateSwap"]);
    expect(report.byType.find((a) => a.key === "InterestRateSwap")!.trades).toBe(2);
    const typeSum = report.byType.reduce((s, a) => s + a.pv, 0);
    expect(typeSum).toBeCloseTo(report.totals.pv, 6);
  });

  it("audit block: snapshot id, deterministic inputs / report hashes, engine version", () => {
    expect(report.audit.snapshotId).toBe(marketSnapshotId(ctx));
    expect(report.audit.engineVersion).toBe(ENGINE_VERSION);
    expect(report.audit.preparedBy).toBe("Marktfolge");
    expect(report.audit.inputsHash).toMatch(/^[0-9a-f]{16}$/);
    expect(report.audit.reportHash).toMatch(/^[0-9a-f]{16}$/);
    const again = buildPortfolioReport(ctx, book, "EUR", { generatedAt: "2027-01-01T00:00:00Z" });
    expect(again.audit.inputsHash).toBe(report.audit.inputsHash);
    expect(again.audit.reportHash).toBe(report.audit.reportHash);
    // a changed trade (same id) changes the inputs hash via its content hash …
    const changed = book.map((t) =>
      t.id === "IRS-A" ? { ...t, legs: (t as { legs: { notional: number }[] }).legs.map((l) => ({ ...l, notional: 2e7 })) } : t,
    ) as Trade[];
    expect(buildPortfolioReport(ctx, changed, "EUR").audit.inputsHash).not.toBe(report.audit.inputsHash);
    // … an explicit version field is used instead of the content hash
    const v1 = book.map((t) => ({ ...t, version: 1 })) as Trade[];
    const v2 = book.map((t) => ({ ...t, version: 2 })) as Trade[];
    expect(buildPortfolioReport(ctx, v1, "EUR").audit.inputsHash).toBe(buildPortfolioReport(ctx, v1, "EUR").audit.inputsHash);
    expect(buildPortfolioReport(ctx, v1, "EUR").audit.inputsHash).not.toBe(buildPortfolioReport(ctx, v2, "EUR").audit.inputsHash);
    // a different reporting currency or market changes both hashes
    expect(buildPortfolioReport(ctx, book, "USD").audit.inputsHash).not.toBe(report.audit.inputsHash);
    const shifted = { ...ctx, fxSpots: { ...ctx.fxSpots, EURUSD: ctx.fxSpots.EURUSD! * 1.01 } };
    expect(buildPortfolioReport(shifted, book, "EUR").audit.snapshotId).not.toBe(report.audit.snapshotId);
  });

  it("a trade that cannot be valued is reported with an error and excluded from the totals", () => {
    const bad = makeFxOption({ id: "FXO-BAD", pair: "EURXXX", optionType: "Call", notional: 1e6, strike: 1.1, expiryDate: addDays(VAL, 90) });
    const rep = buildPortfolioReport(ctx, [...book, bad], "EUR", { theta: false });
    expect(rep.failed).toBe(1);
    const line = rep.lines.find((l) => l.tradeId === "FXO-BAD")!;
    expect(line.error).toBeTruthy();
    expect(Number.isNaN(line.pv)).toBe(true);
    expect(line.warnings[0]).toMatch(/Pricing failed/);
    expect(rep.totals.trades).toBe(5);
    expect(rep.totals.pv).toBeCloseTo(report.totals.pv, 6);
    expect(Number.isNaN(rep.lines[0]!.theta)).toBe(true);
    expect(rep.totals.theta).toBe(0);
  });

  it("Markdown rendering is German: TT.MM.JJJJ, decimal comma, German product labels, audit block", () => {
    const md = portfolioReportToMarkdown(report);
    expect(md).toContain("# Portfolio-Bewertungsreport");
    expect(md).toContain("Bewertungstag 03.09.2026");
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(md).not.toMatch(/\b(InterestRateSwap|FxForward|CapFloor)\b/);
    expect(md).toContain("| Zinsswap | 2 |");
    expect(md).toContain("| FX-Termingeschäft | 1 |");
    expect(md).toContain("| Cap/Floor | 1 |");
    expect(md).toContain("## Nach Kontrahent");
    expect(md).toContain("| Alpha GmbH | 2 |");
    expect(md).toContain(report.audit.snapshotId);
    expect(md).toContain(report.audit.reportHash);
    expect(md).toContain("Erstellt von** | Marktfolge");
    expect(md).not.toMatch(/(?<![\d.])\d+\.(\d{1,2}|\d{4,})(?![\d.])/);
    // failed trades are flagged in the line table
    const bad = makeFxOption({ id: "FXO-BAD", pair: "EURXXX", optionType: "Call", notional: 1e6, strike: 1.1, expiryDate: addDays(VAL, 90) });
    const mdBad = portfolioReportToMarkdown(buildPortfolioReport(ctx, [bad], "EUR", { theta: false }));
    expect(mdBad).toContain("Bewertung fehlgeschlagen");
    expect(mdBad).toContain("(davon 1 nicht bewertbar)");
  });
});
