import { describe, expect, it } from "vitest";
import { SAMPLE_QUOTES, addTenor, buildSampleMarket, makeVanillaSwap, parseISO, priceTrade } from "@deriva/pricing-core";
import { samplePortfolio } from "../state/sample-portfolio.js";
import { TEMPLATE_IDS, newTradeTemplate } from "./templates.js";
import { METRICS, analyticsRows, detailRows, isKnownMetric } from "./metrics.js";

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

  it("FX option: deltaPct is the signed spot delta in %, deltaAmount the money amount per +1 % spot, details carry ISO dates", () => {
    const fxo = samplePortfolio(VAL).find((t) => t.type === "FxOption")!;
    const r = priceTrade(market, fxo, "EUR");
    const rows = analyticsRows(r.analytics, { tradeType: "FxOption", reportingCurrency: "EUR" });
    const by = Object.fromEntries(rows.map((x) => [x.k, x]));
    // signed fraction of the base notional → percentage with two decimals (put: negative, |Δ| < 100 %)
    expect(by.deltaPct!.label).toBe("Delta (Spot)");
    expect(by.deltaPct!.v).toMatch(/^-\d{1,2},\d{2} %$/);
    expect(Math.abs(r.analytics.deltaPct as number)).toBeLessThan(1);
    // money amount per +1 % spot, no percent sign, plausible magnitude (≈ −10.818 EUR on 3 Mio)
    expect(by.deltaAmount!.label).toBe("Delta-Betrag je +1 % Spot");
    expect(by.deltaAmount!.v).not.toContain("%");
    expect(Math.abs(Number(by.deltaAmount!.v.replace(/\./g, "").replace(",", ".")))).toBeLessThan(1e6);
    // dates live in `details` as ISO strings and are rendered dd.mm.yyyy
    const det = detailRows(r.details);
    expect(det.find((d) => d.k === "spotDate")).toEqual({ k: "spotDate", label: "Spot-Datum", v: "08.09.2026" });
    expect(detailRows(undefined)).toEqual([]);
    expect(detailRows({ fixingDate: "2026-12-03", settlementDate: "2026-12-07", maturity: undefined }).map((d) => d.label)).toEqual([
      "Fixing-Datum",
      "Settlement-Datum",
    ]);
    expect(by.strike!.v).toBe("1,1500");
    expect(by.greeksMethod!.label).toBe("Greeks");
    expect(by.greeksMethod!.v).toBe("analytisch");
    expect(by.spotAtValuationDate!.label).toBe("Spot (Bewertungstag)");
    expect(rows.some((x) => x.k === "d1" || x.k === "d2")).toBe(false);
  });

  it("step-up swap: parRateBase and parRateFlat carry the agreed German labels; CCS and FRA keys are whitelisted", () => {
    const spot = parseISO("2026-09-07");
    const swap = makeVanillaSwap({
      currency: "EUR",
      notional: 10_000_000,
      payReceiveFixed: "Pay",
      fixedRate: 0.025,
      effectiveDate: spot,
      maturity: "5Y",
      stepUp: [
        { date: addTenor(spot, "1Y"), rate: 0.03 },
        { date: addTenor(spot, "2Y"), rate: 0.035 },
      ],
    });
    const rows = analyticsRows(priceTrade(market, swap, "EUR").analytics, { tradeType: "InterestRateSwap", reportingCurrency: "EUR" });
    const by = Object.fromEntries(rows.map((x) => [x.k, x]));
    expect(by.parRateBase!.label).toBe("Par-Satz (Basis, Staffel konstant)");
    expect(by.parRateFlat!.label).toBe("Par-Satz (flach)");
    expect(by.parRateBase!.v).toMatch(/%$/);
    const ccs = samplePortfolio(VAL).find((t) => t.type === "CrossCurrencySwap")!;
    const ccsRows = analyticsRows(priceTrade(market, ccs, "EUR").analytics, { tradeType: "CrossCurrencySwap", reportingCurrency: "EUR" });
    expect(ccsRows.find((x) => x.k === "fairSpread")!.v).toMatch(/bp$/);
    expect(ccsRows.find((x) => x.k === "mtmReset")!.v).toBe("nein");
    const fra = samplePortfolio(VAL).find((t) => t.type === "FRA")!;
    const fraRes = priceTrade(market, fra, "EUR");
    const fraRows = analyticsRows(fraRes.analytics, { tradeType: "FRA", reportingCurrency: "EUR" });
    expect(fraRows.find((x) => x.k === "forwardRate")!.label).toBe("Forward-Satz");
    expect(detailRows(fraRes.details).map((d) => d.label)).toEqual(["Fixing-Datum", "Settlement-Datum"]);
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
