import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { samplePortfolio } from "../state/sample-portfolio.js";
import { defaultRelationship } from "../views/HedgeView.js";
import { hedgeDocMarkdown } from "./hedge-doc.js";

const VAL = parseISO("2026-09-03");

describe("hedge documentation markdown (R3-F4)", () => {
  const trade = samplePortfolio(VAL).find((t) => t.id === "IRS-0001")!;
  const rel = defaultRelationship(trade, VAL);
  it("carries the stale marker in header and effectiveness section when the inputs changed after the test", () => {
    const md = hedgeDocMarkdown(rel, trade, null, { valuationDate: VAL, ccy: "EUR", stale: true, generatedAt: "x" });
    expect(md).toContain("ERGEBNIS VERALTET");
    expect(md).toContain("**Ergebnis veraltet**");
    expect(md).toMatch(/erneut testen/);
  });
  it("has no stale marker for a fresh result and uses German dates", () => {
    const md = hedgeDocMarkdown(rel, trade, null, { valuationDate: VAL, ccy: "EUR", generatedAt: "x" });
    expect(md).not.toContain("VERALTET");
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(md).toContain("| Designationsdatum | 17.06.2024 |");
  });
});
