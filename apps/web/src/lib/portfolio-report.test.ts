import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, SAMPLE_QUOTES, buildSampleMarket, marketSnapshotId, parseISO } from "@deriva/pricing-core";
import { samplePortfolio } from "../state/sample-portfolio.js";
import { buildPortfolioReport, portfolioReportMarkdown } from "./portfolio-report.js";

const VAL = parseISO("2026-09-03");
const market = buildSampleMarket(VAL, SAMPLE_QUOTES);
const trades = samplePortfolio(VAL);

describe("portfolio report (F-29, core `buildPortfolioReport`)", () => {
  it("aggregates the sample book by counterparty, book and type and carries the market audit hashes", () => {
    const rep = buildPortfolioReport(market, trades, "EUR", { generatedAt: "2026-09-03T17:00:00.000Z" });
    expect(rep.valuationDate).toBe("2026-09-03");
    expect(rep.totals.trades).toBe(13);
    expect(rep.failed).toBe(0);
    const sum = (xs: { pv: number }[]) => xs.reduce((x, a) => x + a.pv, 0);
    expect(sum(rep.byCounterparty)).toBeCloseTo(rep.totals.pv, 6);
    expect(sum(rep.byBook)).toBeCloseTo(rep.totals.pv, 6);
    expect(sum(rep.byType)).toBeCloseTo(rep.totals.pv, 6);
    expect(rep.byCounterparty.map((a) => a.key)).toContain("Landesbank A");
    expect(rep.byType.map((a) => a.key)).toEqual(expect.arrayContaining(["CrossCurrencySwap", "FRA"]));
    expect(rep.audit.snapshotId).toBe(marketSnapshotId(market));
    expect(rep.audit.engineVersion).toBe(ENGINE_VERSION);
    const again = buildPortfolioReport(market, trades, "EUR", { generatedAt: "2026-09-04T17:00:00.000Z" });
    expect(again.audit.reportHash).toBe(rep.audit.reportHash); // timestamps are excluded from the hash
    expect(rep.whatIf).toBeUndefined();
    expect(rep.customerView).toBeUndefined();
    const md = portfolioReportMarkdown(rep);
    expect(md).toContain("## Nach Kontrahent");
    expect(md).toContain("## Nach Buch");
    expect(md).toContain("| CCS-0001 |");
    expect(md).toContain(rep.audit.snapshotId);
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/); // German dates only
  });
  it("marks what-if numbers and the customer view drops counterparties, books and DV01 from data and Markdown", () => {
    const rep = buildPortfolioReport(market, trades, "EUR", { whatIf: { ratesBp: 10, fxPct: 0, volBp: 0, label: "Zinsen +10 bp" }, customer: true });
    expect(rep.customerView).toBe(true);
    expect(rep.byCounterparty).toEqual([]);
    expect(rep.byBook).toEqual([]);
    expect(rep.byType.length).toBeGreaterThan(3);
    expect(rep.lines.every((l) => l.counterparty === undefined && l.book === undefined && Number.isNaN(l.dv01))).toBe(true);
    expect(Number.isNaN(rep.totals.dv01)).toBe(true);
    const md = portfolioReportMarkdown(rep);
    expect(md).toContain("WHAT-IF Zinsen +10 bp");
    expect(md).not.toContain("## Nach Kontrahent");
    expect(md).not.toContain("## Nach Buch");
    expect(md).not.toMatch(/DV01/);
    expect(md).not.toMatch(/Landesbank A/);
    expect(md).toMatch(/Sensitivitäten per Bump-and-Reprice \(FX-Delta/); // footer keeps the remaining method notes
    expect(md).toContain("## Nach Produktart");
    expect(md).toContain("| IRS-0001 |");
    // every remaining table row keeps a consistent column count
    const tables = md.split("\n").filter((l) => l.startsWith("|"));
    const counts = new Set(tables.filter((l) => l.includes("Referenz") || l.startsWith("| IRS-0001")).map((l) => l.split("|").length));
    expect(counts.size).toBe(1);
  });
});
