/**
 * Round-7 library findings (docs/quality/review-ui-r7.md, review-markt-r7.md):
 * curve-backed index defaulting and index normalisation in the quick entry
 * (R7-F2 / Markt R7-1), register-derived option lists (R7-02), the CCS CSV
 * template aligned to the API column names (Markt R7-5) and the chart
 * library retry (R7-05).
 */
import { describe, expect, it, vi } from "vitest";
import { type Trade, parseISO } from "@deriva/pricing-core";
import { loadChart, retryChart } from "../components/EChart.js";
import { CSV_IMPORT_TEMPLATES, csvHeaderName, csvTemplateText, tradesFromCsv } from "./portfolio-io.js";
import { parseQuickEntry } from "./quick-parser.js";
import { currencyOptions, defaultIndexFor, fxCurrencies, indexHasCurve, indexOptions, knownPairs, normaliseIndexToken } from "./register.js";

const VAL = parseISO("2026-09-03");
const G5 = ["EUR", "USD", "GBP", "CHF", "JPY"];
const G5_CURVES = ["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "USD-SOFR", "GBP-SONIA", "CHF-SARON", "JPY-TONA"];
const floatIndex = (t: Trade | undefined): string | undefined =>
  t?.type === "InterestRateSwap" ? (t.legs.find((l) => l.type === "Float") as { index: string } | undefined)?.index : undefined;

describe("R7-F2 – quick entry: swap / cap index follows the curves in the market", () => {
  const dkkOisOnly = { curveCurrencies: [...G5, "DKK"], curveIds: [...G5_CURVES, "DKK-DESTR"] };

  it("'irs dkk …' after '+ Kurve' DKK-DESTR is a DESTR swap and says so in the preview", () => {
    const r = parseQuickEntry("irs dkk 5y pay 3% 10m", VAL, dkkOisOnly);
    expect(r.ok).toBe(true);
    expect(floatIndex(r.trade)).toBe("DESTR");
    expect(r.description).toMatch(/· DESTR \(Kurve vorhanden; CIBOR-6M ohne Kurve\)/);
    // the conventions win as soon as their curve exists
    const both = parseQuickEntry("irs dkk 5y pay 3% 10m", VAL, { ...dkkOisOnly, curveIds: [...dkkOisOnly.curveIds, "DKK-CIBOR-6M"] });
    expect(floatIndex(both.trade)).toBe("CIBOR-6M");
    expect(both.description).not.toMatch(/ohne Kurve|⚠/);
    // without market information the conventions decide (unchanged behaviour)
    expect(floatIndex(parseQuickEntry("irs dkk 5y pay 3% 10m", VAL).trade)).toBe("CIBOR-6M");
    // EUR stays EURIBOR-6M, the description carries no index note
    const eur = parseQuickEntry("irs 10y pay 3.1% 10m", VAL, dkkOisOnly);
    expect(floatIndex(eur.trade)).toBe("EURIBOR-6M");
    expect(eur.description).toBe("Payer-Swap EUR 10Y @ 3,100 % · Nominal 10.000.000");
  });

  it("a typed index without a curve is flagged in the preview, not silently accepted", () => {
    const r = parseQuickEntry("irs dkk 5y pay 3% 10m cibor6m", VAL, dkkOisOnly);
    expect(r.ok).toBe(true);
    expect(floatIndex(r.trade)).toBe("CIBOR-6M");
    expect(r.description).toMatch(/⚠ Kurve DKK-CIBOR-6M fehlt – in der Kurvenansicht mit „\+ Kurve“ anlegen/);
    // FRA branch: same note
    const fra = parseQuickEntry("fra dkk 3x9 pay 3% 10m cibor6m", VAL, dkkOisOnly);
    expect(fra.description).toMatch(/⚠ Kurve DKK-CIBOR-6M fehlt/);
  });

  it("a currency whose indices all lack a curve is refused with the '+ Kurve' remedy", () => {
    const r = parseQuickEntry("irs dkk 5y pay 3% 10m", VAL, { curveCurrencies: [...G5, "DKK"], curveIds: [...G5_CURVES, "DKK-XCCY"] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Für DKK fehlt die Kurve zu CIBOR-3M \/ CIBOR-6M \/ DESTR – in der Kurvenansicht mit „\+ Kurve“ anlegen/);
  });

  it("caps follow the same rule ('cap nok …' after '+ Kurve' NOK-NOWA)", () => {
    const r = parseQuickEntry("cap nok 5y 4.5% 10m", VAL, { curveCurrencies: [...G5, "NOK"], curveIds: [...G5_CURVES, "NOK-NOWA"] });
    expect(r.ok).toBe(true);
    expect(r.trade?.type === "CapFloor" ? r.trade.index : undefined).toBe("NOWA");
    expect(r.description).toMatch(/NOWA \(Kurve vorhanden; NIBOR-6M ohne Kurve\)/);
  });

  it("index tokens of the new currencies are normalised; unknown ones are a German error naming the currency's indices (Markt R7-1)", () => {
    expect(floatIndex(parseQuickEntry("irs nok 5y pay 4% 10m nibor6m", VAL).trade)).toBe("NIBOR-6M");
    expect(floatIndex(parseQuickEntry("irs nok 5y pay 4% 10m Nibor-3M", VAL).trade)).toBe("NIBOR-3M");
    expect(floatIndex(parseQuickEntry("irs 5y pay 3% 10m euribor3m", VAL).trade)).toBe("EURIBOR-3M");
    const bad = parseQuickEntry("irs nok 5y pay 4% 10m nibor9m", VAL);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("Unbekannter Index „nibor9m“ – für NOK registriert: NIBOR-3M, NIBOR-6M, NOWA");
    expect(bad.error).not.toMatch(/Unknown rate index/);
  });

  it("swaption / FX-option previews name '+ Fläche' as the remedy for a missing surface (R7-2)", () => {
    expect(parseQuickEntry("swpt nok 1y5y payer 4% 10m", VAL, { swaptionVolCurrencies: G5 }).description).toMatch(
      /⚠ kein Swaption-Vol-Cube für NOK \(Fallback-Vol, Level 3 – in der Marktansicht mit „\+ Fläche“ anlegen\)/,
    );
    expect(parseQuickEntry("fxo eurnok call 11.7 1m 6m", VAL, { fxVolPairs: ["EURUSD"] }).description).toMatch(/„\+ Fläche“/);
  });
});

describe("R7-02 – register-derived option lists", () => {
  it("defaultIndexFor prefers the conventions' index, then OIS, then any index with a curve", () => {
    expect(defaultIndexFor("DKK")).toBe("CIBOR-6M");
    expect(defaultIndexFor("DKK", ["DKK-DESTR"])).toBe("DESTR");
    expect(defaultIndexFor("DKK", ["DKK-DESTR", "DKK-CIBOR-6M"])).toBe("CIBOR-6M");
    expect(defaultIndexFor("DKK", ["DKK-CIBOR-3M"])).toBe("CIBOR-3M");
    expect(defaultIndexFor("DKK", [])).toBeUndefined();
    expect(defaultIndexFor("EUR", G5_CURVES)).toBe("EURIBOR-6M");
    expect(indexHasCurve("DESTR", ["DKK-DESTR"])).toBe(true);
    expect(indexHasCurve("CIBOR-6M", ["DKK-DESTR"])).toBe(false);
  });

  it("normaliseIndexToken maps typed tokens to registered names", () => {
    expect(normaliseIndexToken("nibor6m")).toBe("NIBOR-6M");
    expect(normaliseIndexToken("EURIBOR-3M")).toBe("EURIBOR-3M");
    expect(normaliseIndexToken("estr")).toBe("ESTR");
    expect(normaliseIndexToken("€str")).toBe("ESTR");
    expect(normaliseIndexToken("nibor9m")).toBeUndefined();
  });

  it("currency / index / pair options come from the market and the register, never from a G5 constant", () => {
    const disc = { EUR: "EUR-ESTR", USD: "USD-SOFR", DKK: "DKK-DESTR" };
    const ccys = currencyOptions(disc, "SEK");
    expect(ccys.slice(0, 3).map((o) => o.v)).toEqual(["EUR", "DKK", "USD"]);
    expect(ccys.find((o) => o.v === "NOK")?.l).toBe("NOK (ohne Kurve)");
    expect(ccys.find((o) => o.v === "SEK")?.l).toBe("SEK (ohne Kurve)");
    expect(ccys.find((o) => o.v === "GBP")?.l).toBe("GBP (ohne Kurve)");
    const idx = indexOptions("DKK", ["DKK-DESTR"], "CIBOR-6M");
    expect(idx[0]).toEqual({ v: "DESTR", l: "DESTR" });
    expect(idx.find((o) => o.v === "CIBOR-6M")?.l).toBe("CIBOR-6M (ohne Kurve)");
    expect(indexOptions("EUR", G5_CURVES, "FOO-1M").at(-1)).toEqual({ v: "FOO-1M", l: "FOO-1M (nicht registriert)" });
    expect(fxCurrencies({ EURUSD: 1.1, EURDKK: 7.46 }, { GBP: "GBP-SONIA" }, ["JPY"])).toEqual(["EUR", "DKK", "GBP", "JPY", "USD"]);
    expect(knownPairs({ EURDKK: 7.46, USDJPY: 150 }, { EURUSD: {} }, "EURNOK")).toEqual(["EURDKK", "EURNOK", "EURUSD", "USDJPY"]);
  });
});

describe("Markt R7-5 – CCS CSV template uses the API column names and accepts the old ones", () => {
  it("template header: domesticNotional / fixedRate / domesticPayReceive / effectiveDate / collateralCurrency", () => {
    const head = csvTemplateText("CCS")
      .split("\r\n")[0]!
      .replace(/^\uFEFF/, "");
    expect(head).toBe(
      "type;id;name;counterparty;book;pair;domesticNotional;spread;fixedRate;fxSpot;domesticPayReceive;effectiveDate;maturity;collateralCurrency;status",
    );
    expect(csvHeaderName(CSV_IMPORT_TEMPLATES.CCS, "notional")).toBe("domesticNotional");
    expect(csvHeaderName(CSV_IMPORT_TEMPLATES.IRS, "notional")).toBe("notional");
    // every other template keeps its canonical header
    for (const t of Object.values(CSV_IMPORT_TEMPLATES)) if (t.type !== "CCS") expect(t.headers).toBeUndefined();
  });

  it("the template's own example row imports, and so does a row with the previous web column names", () => {
    const own = tradesFromCsv(csvTemplateText("CCS"), { valuationDate: VAL });
    expect(own.errors).toEqual([]);
    expect(own.trades).toHaveLength(1);
    expect(own.trades[0]!.type).toBe("CrossCurrencySwap");
    const api = tradesFromCsv(
      "type;id;pair;domesticNotional;spread;fixedRate;fxSpot;domesticPayReceive;effectiveDate;maturity;collateralCurrency\nCCS;C-API;EURUSD;10000000;-20;;1,17;Pay;2026-09-07;5Y;USD\n",
      { valuationDate: VAL },
    );
    expect(api.errors).toEqual([]);
    const t = api.trades[0] as Extract<Trade, { type: "CrossCurrencySwap" }>;
    expect(t.legs[0]!.notional).toBe(10_000_000);
    expect(t.legs.find((l) => l.currency === "EUR")!.payReceive).toBe("Pay");
    expect(t.collateralCurrency).toBe("USD");
    const old = tradesFromCsv(
      "type;id;pair;notional;spread;fxSpot;direction;start;maturity;collateral\nCCS;C-OLD;EURUSD;10000000;-20;1,17;Pay;2026-09-07;5Y;none\n",
      {
        valuationDate: VAL,
      },
    );
    expect(old.errors).toEqual([]);
    expect((old.trades[0] as Extract<Trade, { type: "CrossCurrencySwap" }>).collateralCurrency).toBeUndefined();
  });
});

describe("R7-05 – 'Erneut versuchen' re-imports the chart library chunk", () => {
  const fakeLib = { init: () => ({}), use: () => undefined } as unknown as Parameters<typeof loadChart>[0] extends { lib: () => Promise<{ default: infer L }> }
    ? L
    : never;
  const marker = (lib: unknown) => Object.assign(() => null, { boundTo: lib });
  const impl = { makeEChartImpl: (lib: unknown) => marker(lib) as unknown as React.ComponentType<never> };

  it("loadChart binds library and component", async () => {
    const m = await loadChart({ lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url: async () => ({}) });
    expect((m.default as unknown as { boundTo: unknown }).boundTo).toBe(fakeLib);
  });

  it("a failed echarts chunk is re-imported with a cache-busting query and bound to the component module", async () => {
    const url = vi.fn(async (u: string) => (u.includes("echarts-") ? { default: fakeLib } : {}));
    const e = new TypeError("Failed to fetch dynamically imported module: http://localhost:5021/assets/echarts-DfTdNZQj.js");
    const p = retryChart(e, { lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url });
    expect(p).toBeDefined();
    const m = await p!;
    expect(url).toHaveBeenCalledTimes(1);
    expect(url.mock.calls[0]![0]).toMatch(/^http:\/\/localhost:5021\/assets\/echarts-DfTdNZQj\.js\?retry=\d+$/);
    expect((m.default as unknown as { boundTo: unknown }).boundTo).toBe(fakeLib);
  });

  it("the bundler may rename the chunk exports (`default` → `t`) – the retry recognises the library structurally", async () => {
    // the built chunk exposes the facade as `{ t: { default: echarts } }`
    const url = vi.fn(async () => ({ t: { default: fakeLib } }));
    const e = new TypeError("Failed to fetch dynamically imported module: http://localhost:5021/assets/echarts-BDKLMkZV.js");
    const m = await retryChart(e, { lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url })!;
    expect((m.default as unknown as { boundTo: unknown }).boundTo).toBe(fakeLib);
    const url2 = vi.fn(async () => ({ n: impl.makeEChartImpl }));
    const e2 = new TypeError("Failed to fetch dynamically imported module: http://localhost:5021/assets/EChartImpl-Dbnu1Wbj.js");
    const m2 = await retryChart(e2, { lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url: url2 })!;
    expect((m2.default as unknown as { boundTo: unknown }).boundTo).toBe(fakeLib);
  });

  it("a failed component chunk is re-imported and bound to the library; unknown shapes rethrow, no URL → undefined", async () => {
    const url = vi.fn(async (u: string) => (u.includes("EChartImpl-") ? impl : { something: 1 }));
    const e = new TypeError("Failed to fetch dynamically imported module: http://localhost:5021/assets/EChartImpl-abc.js");
    const m = await retryChart(e, { lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url })!;
    expect((m.default as unknown as { boundTo: unknown }).boundTo).toBe(fakeLib);
    const odd = new TypeError("Failed to fetch dynamically imported module: http://localhost:5021/assets/other-abc.js");
    await expect(retryChart(odd, { lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url })!).rejects.toBe(odd);
    expect(retryChart(new Error("no url here"), { lib: async () => ({ default: fakeLib }), impl: async () => impl as never, url })).toBeUndefined();
  });
});
