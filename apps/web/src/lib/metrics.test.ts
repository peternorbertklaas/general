import { describe, expect, it } from "vitest";
import { SAMPLE_QUOTES, buildSampleMarket, parseISO, priceTrade } from "@deriva/pricing-core";
import { samplePortfolio } from "../state/sample-portfolio.js";
import { TEMPLATE_IDS, newTradeTemplate } from "./templates.js";
import { METRICS, analyticsRows, isKnownMetric } from "./metrics.js";

const VAL = parseISO("2026-09-03");
const market = buildSampleMarket(VAL, SAMPLE_QUOTES);
const RAW_KEY = /^[a-z]+[A-Z]/; // camelCase such as "spotAtValuationDate"

describe("analytics whitelist (N-01, F-14)", () => {
  const trades = [...samplePortfolio(VAL), ...TEMPLATE_IDS.map((k) => ({ ...newTradeTemplate(k, VAL), id: `T-${k}` }))];

  it("every analytics key the core emits for the sample book and templates is whitelisted", () => {
    const unknown = new Set<string>();
    for (const t of trades) {
      const r = priceTrade(market, t, "EUR");
      for (const k of Object.keys(r.analytics)) if (!isKnownMetric(k)) unknown.add(`${t.type}.${k}`);
    }
    expect([...unknown]).toEqual([]);
  });

  it("never renders a raw camelCase key as a label and flags unknown keys as technical", () => {
    for (const t of trades) {
      const r = priceTrade(market, t, "EUR");
      for (const row of analyticsRows(r.analytics, { tradeType: t.type, reportingCurrency: "EUR" })) {
        expect(row.label, `${t.type}.${row.k}`).not.toMatch(RAW_KEY);
        expect(row.technical, `${t.type}.${row.k}`).toBeFalsy();
      }
    }
    const rows = analyticsRows({ someNewThing: 1.5, anotherFlag: "yes" }, { tradeType: "InterestRateSwap", reportingCurrency: "EUR" });
    expect(rows.every((r) => r.technical)).toBe(true);
    expect(rows.map((r) => r.label)).toEqual(["Some new thing", "Another flag"]);
  });

  it("FX option: FX-Delta is a money amount per +1 % spot, spot date (when emitted) is a date, strike is a price", () => {
    const fxo = samplePortfolio(VAL).find((t) => t.type === "FxOption")!;
    const r = priceTrade(market, fxo, "EUR");
    const rows = analyticsRows(r.analytics, { tradeType: "FxOption", reportingCurrency: "EUR" });
    const by = Object.fromEntries(rows.map((x) => [x.k, x]));
    const delta = by.deltaAmount ?? by.deltaPct!;
    expect(delta.label).toBe("FX-Delta");
    expect(delta.unit).toBe("je +1 % Spot");
    expect(delta.v).not.toContain("%");
    expect(Math.abs(Number(delta.v.replace(/\./g, "").replace(",", ".")))).toBeLessThan(1e6); // ≈ −10.818, not −1.079.785,95 %
    // the legacy key is still mapped as money should an older core emit it
    const legacy = analyticsRows({ deltaPct: -10818.15, spotDate: 20704 }, { tradeType: "FxOption", reportingCurrency: "EUR" });
    expect(legacy.find((x) => x.k === "deltaPct")!.v).toBe("-10.818");
    expect(legacy.find((x) => x.k === "spotDate")!.label).toBe("Spot-Datum");
    expect(legacy.find((x) => x.k === "spotDate")!.v).toBe("08.09.2026");
    expect(by.strike!.v).toBe("1,1500");
    expect(by.greeksMethod!.label).toBe("Greeks");
    expect(by.greeksMethod!.v).toBe("analytisch");
    expect(by.spotAtValuationDate!.label).toBe("Spot (Bewertungstag)");
    expect(rows.some((x) => x.k === "d1" || x.k === "d2")).toBe(false);
  });

  it("FX forward: fxDeltaCurrency / fxDeltaSellCurrency / ndf are labelled; swaption / cap greeks per bp are money", () => {
    const fxf = samplePortfolio(VAL).find((t) => t.id === "FXF-0001")!;
    const rows = analyticsRows(priceTrade(market, fxf, "EUR").analytics, { tradeType: "FxForward", reportingCurrency: "EUR" });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("FX-Delta-Währung");
    expect(labels).toContain("NDF");
    expect(rows.find((r) => r.k === "ndf")!.v).toBe("nein");
    const swpt = samplePortfolio(VAL).find((t) => t.type === "Swaption")!;
    const sw = analyticsRows(priceTrade(market, swpt, "EUR").analytics, { tradeType: "Swaption", reportingCurrency: "EUR" });
    expect(sw.find((r) => r.k === "deltaPerBp")!.unit).toBe("je 1 bp");
    expect(sw.find((r) => r.k === "gammaPerBp2")!.unit).toBe("je 1 bp²");
    expect(sw.find((r) => r.k === "settlement")!.v).toMatch(/Physisch|Barausgleich/);
    expect(sw.find((r) => r.k === "annuity")!.unit).not.toBe("je 1");
  });

  it("every whitelisted metric has a non-empty German label without a raw key", () => {
    for (const [k, def] of Object.entries(METRICS)) {
      expect(def.label.length, k).toBeGreaterThan(0);
      expect(def.label, k).not.toMatch(RAW_KEY);
    }
  });
});
