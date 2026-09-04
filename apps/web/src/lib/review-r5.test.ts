/** Regression tests for the round-5 UI / market / architecture review findings (docs/quality/review-*-r5.md). */
import { describe, expect, it } from "vitest";
import {
  PricingError,
  SAMPLE_QUOTES,
  buildSampleMarket,
  makeCapFloor,
  parseISO,
  priceTrade,
  validateVolSurfaces,
  vegaBuckets,
  type Trade,
} from "@deriva/pricing-core";
import { PRICING_ERROR_CODES_DE, translateCoreMessage, translatePricingError } from "./i18n.js";
import { CSV_IMPORT_TEMPLATES, collateralOf, csvTemplateText, invalidDateMessage, tradesFromCsv } from "./portfolio-io.js";
import { QUICK_ENTRY_EXAMPLES, fxVolWarning, hasFxVolSurface, parseQuickEntry } from "./quick-parser.js";
import { readSnapshotJson, snapshotErrorText } from "./snapshot-import.js";
import { applyParSolve, parSolveLabel, parSolveTitle, parSolveUnavailable, solveCapFloorStrike } from "./trade-ops.js";
import { ONBOARDING_EXAMPLES } from "../views/Blotter.js";

const VAL = parseISO("2026-09-03");
const SPOT = parseISO("2026-09-07");
const market = buildSampleMarket(VAL, SAMPLE_QUOTES);
const ctx = { market, reportingCurrency: "EUR" };

describe("R5-03 – Shift+P for cap / floor / collar solves the fair strike on the pricer", () => {
  it("cap: the ATM strike makes cap and floor worth the same", () => {
    const cap = makeCapFloor({ currency: "EUR", notional: 8_000_000, capFloor: "Cap", strike: 0.03, effectiveDate: SPOT, maturity: "5Y" });
    const r = priceTrade(market, cap, "EUR");
    const solved = applyParSolve(cap, r, ctx)!;
    expect(solved.type).toBe("CapFloor");
    const k = (solved as typeof cap).strike;
    expect(k).not.toBe(0.03);
    expect(k).toBeGreaterThan(0.01);
    expect(k).toBeLessThan(0.05);
    const capPv = priceTrade(market, { ...cap, strike: k }, "EUR").pv;
    const floorPv = priceTrade(market, { ...cap, capFloor: "Floor", strike: k }, "EUR").pv;
    // the strike is rounded to 1e-6 (0,0001 %); on 8 Mio. × annuity that is < 20 EUR of residual PV
    expect(Math.abs(capPv - floorPv)).toBeLessThan(50);
    expect(Math.abs(capPv - floorPv)).toBeLessThan(Math.abs(r.pv - priceTrade(market, { ...cap, capFloor: "Floor" }, "EUR").pv) / 100);
    // without the market context (legacy call) the cap still yields no par value instead of a wrong one
    expect(applyParSolve(cap, r)).toBeUndefined();
    expect(parSolveLabel(cap)).toMatch(/ATM-Strike/);
    expect(parSolveTitle(cap)).toMatch(/ATM-Strike/);
  });
  it("collar: the floor strike is solved so the collar is zero-cost; the cap strike stays", () => {
    const collar = makeCapFloor({
      currency: "EUR",
      notional: 6_000_000,
      capFloor: "Collar",
      strike: 0.035,
      floorStrike: 0.015,
      effectiveDate: SPOT,
      maturity: "7Y",
    });
    const r = priceTrade(market, collar, "EUR");
    expect(Math.abs(r.pv)).toBeGreaterThan(1000);
    const solved = applyParSolve(collar, r, ctx) as typeof collar;
    expect(solved.strike).toBe(0.035);
    expect(solved.floorStrike).not.toBe(0.015);
    // zero-cost up to the 1e-6 strike rounding (≈ 18 EUR on 6 Mio.), i.e. < 0,1 % of the initial premium
    expect(Math.abs(priceTrade(market, solved, "EUR").pv)).toBeLessThan(50);
    expect(Math.abs(priceTrade(market, solved, "EUR").pv)).toBeLessThan(Math.abs(r.pv) / 500);
    expect(parSolveLabel(collar)).toMatch(/Zero-Cost/);
    // no root when the cap strike is below every attainable floor → undefined and a helpful toast text
    const impossible = { ...collar, strike: -0.05 };
    expect(solveCapFloorStrike(impossible, ctx)).toBeUndefined();
    expect(parSolveUnavailable(impossible)).toMatch(/Zero-Cost-Floor-Strike/);
  });
  it("the pricer is injectable and an upfront premium is ignored for the solve", () => {
    const cap = makeCapFloor({ currency: "EUR", notional: 1_000_000, capFloor: "Cap", strike: 0.03, effectiveDate: SPOT, maturity: "3Y" });
    const withUpfront: Trade = { ...cap, upfront: { amount: 50_000, currency: "EUR", date: SPOT } };
    const seen: Trade[] = [];
    const price = (m: typeof market, t: Trade, ccy: string) => {
      seen.push(t);
      return priceTrade(m, t, ccy);
    };
    const a = solveCapFloorStrike(cap, { ...ctx, price });
    const b = solveCapFloorStrike(withUpfront as typeof cap, { ...ctx, price });
    expect(a?.strike).toBeCloseTo(b!.strike!, 6);
    expect(seen.every((t) => t.upfront === undefined)).toBe(true);
  });
});

describe("R5-F1 – impossible CSV dates are row errors, never silent defaults", () => {
  const header = "type;id;name;currency;notional;direction;rate;start;maturity;index";
  const csv = (rows: string[]) => `\uFEFF${header}\r\n${rows.join("\r\n")}\r\n`;
  it("31.02.2026 and 2026-02-30 in `start` reject the row with a German message naming column and row", () => {
    const r = tradesFromCsv(
      csv([
        "IRS;IRS-D1;German impossible;EUR;10000000;Pay;3,1 %;31.02.2026;7Y;EURIBOR-6M",
        "IRS;IRS-D2;ISO impossible;EUR;10000000;Pay;3,1 %;2026-02-30;7Y;EURIBOR-6M",
        "IRS;IRS-D3;ok;EUR;10000000;Pay;3,1 %;15.03.2027;7Y;EURIBOR-6M",
        "IRS;IRS-D4;empty start = default;EUR;10000000;Pay;3,1 %;;7Y;EURIBOR-6M",
      ]),
      { valuationDate: VAL },
    );
    expect(r.trades.map((t) => t.id)).toEqual(["IRS-D3", "IRS-D4"]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toEqual({ row: 1, msg: invalidDateMessage("31.02.2026", "start") });
    expect(r.errors[0]!.msg).toMatch(/Ungültiges Datum „31.02.2026“ in Spalte „start“ \(Start\)/);
    expect(r.errors[1]!.msg).toMatch(/„2026-02-30“/);
    const d3 = r.trades[0] as Extract<Trade, { type: "InterestRateSwap" }>;
    expect(d3.legs[0]!.effectiveDate).toBe(parseISO("2027-03-15"));
  });
  it("impossible maturity, delivery and expiry dates are row errors as well", () => {
    const irs = tradesFromCsv(csv(["IRS;IRS-M1;bad maturity;EUR;10000000;Pay;3,1 %;15.03.2027;30.02.2030;EURIBOR-6M"]), { valuationDate: VAL });
    expect(irs.errors[0]!.msg).toMatch(/Spalte „maturity“/);
    const fxf = tradesFromCsv("type;id;buyCurrency;buyAmount;sellCurrency;sellAmount;deliveryDate\nFXF;F1;USD;1000;EUR;900;2027-02-30\n", {
      valuationDate: VAL,
    });
    expect(fxf.errors[0]!.msg).toMatch(/Spalte „deliveryDate“ \(Lieferdatum\)/);
    const fxo = tradesFromCsv("type;id;pair;optionType;notional;strike;expiry\nFXO;O1;EURUSD;Put;1000000;1,15;31.04.2027\n", { valuationDate: VAL });
    expect(fxo.errors[0]!.msg).toMatch(/Spalte „expiry“ \(Verfall\)/);
    const swpt = tradesFromCsv("type;id;currency;notional;direction;strike;expiry;tenor\nSWPT;S1;EUR;1000000;Payer;3 %;29.02.2027;5Y\n", {
      valuationDate: VAL,
    });
    expect(swpt.errors[0]!.msg).toMatch(/Spalte „expiry“/);
  });
});

describe("Markt R5-3 – CCS CSV template with a CSA column", () => {
  it("template, parser and aliases carry `collateral`; `none` = unsecured, empty = market default", () => {
    expect(CSV_IMPORT_TEMPLATES.CCS.columns).toContain("collateral");
    expect(csvTemplateText("CCS").split("\r\n")[0]).toMatch(/;collateral;status$/);
    const head = "type;id;pair;notional;spread;fxSpot;direction;maturity;csa";
    const r = tradesFromCsv(
      `${head}\nCCS;C1;EURGBP;10000000;-20;0,86;Receive;5Y;USD\nCCS;C2;EURGBP;10000000;-20;0,86;Receive;5Y;none\nCCS;C3;EURGBP;10000000;-20;0,86;Receive;5Y;\nCCS;C4;EURGBP;10000000;-20;0,86;Receive;5Y;Dollar\n`,
      {
        valuationDate: VAL,
      },
    );
    const ccs = (id: string) => r.trades.find((t) => t.id === id) as Extract<Trade, { type: "CrossCurrencySwap" }>;
    expect(ccs("C1").collateralCurrency).toBe("USD");
    expect(ccs("C2").collateralCurrency).toBeUndefined();
    expect(ccs("C3").collateralCurrency).toBe("GBP");
    expect(r.errors).toEqual([{ row: 4, msg: expect.stringMatching(/Collateral-Währung „Dollar“ nicht lesbar/) }]);
    expect(collateralOf("unbesichert", "EURUSD")).toBeNull();
    expect(collateralOf(" chf ", "EURUSD")).toBe("CHF");
  });
});

describe("Markt R5-2 – FX option on a pair without a vol surface is flagged", () => {
  it("palette preview warns like the swaption branch; pairs with a surface (direct or inverse) do not", () => {
    const pairs = ["EURUSD", "EURGBP", "USDJPY"];
    const warned = parseQuickEntry("fxo usdchf call 0.80 1m 6m", VAL, { fxSpots: { USDCHF: 0.79 }, fxVolPairs: pairs });
    expect(warned.ok).toBe(true);
    expect(warned.description).toMatch(/⚠ keine FX-Vol-Fläche für USD\/CHF \(Fallback 8 %, Level 3\)/);
    const fine = parseQuickEntry("fxo eurusd put 1.15 3m 9m", VAL, { fxSpots: { EURUSD: 1.1625 }, fxVolPairs: pairs });
    expect(fine.description).not.toMatch(/⚠/);
    expect(hasFxVolSurface("JPYUSD", pairs)).toBe(true);
    expect(hasFxVolSurface("USDCHF", undefined)).toBe(true);
    expect(fxVolWarning("GBPJPY", pairs)).toMatch(/GBP\/JPY/);
    // every spot pair of the sample market either has a surface or is flagged consistently with the core warning
    for (const pair of Object.keys(market.fxSpots)) {
      const t = parseQuickEntry(`fxo ${pair.toLowerCase()} call ${market.fxSpots[pair]} 1m 6m`, VAL, {
        fxSpots: market.fxSpots,
        fxVolPairs: Object.keys(market.fxVols ?? {}),
      });
      const coreWarns = priceTrade(market, t.trade!, "EUR").warnings.some((w) => /No FX vol surface/.test(w));
      expect(/⚠ keine FX-Vol-Fläche/.test(t.description ?? ""), pair).toBe(coreWarns);
    }
  });
});

describe("R5-09 – onboarding examples come from the palette examples (German dates)", () => {
  it("chips are a subset of QUICK_ENTRY_EXAMPLES and carry no ISO date", () => {
    expect(ONBOARDING_EXAMPLES).toHaveLength(3);
    for (const ex of ONBOARDING_EXAMPLES) {
      expect(QUICK_ENTRY_EXAMPLES).toContain(ex);
      expect(ex).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    expect(ONBOARDING_EXAMPLES.some((e) => e.includes("15.03.2027"))).toBe(true);
  });
});

describe("R5-06 – snapshot import errors are German with a clear cause", () => {
  it("readSnapshotJson: malformed JSON, missing / unknown schema, missing fields", () => {
    expect(() => readSnapshotJson("{bad json")).toThrow(/Datei ist kein gültiges JSON.*Snapshot exportieren/);
    expect(() => readSnapshotJson("[]")).toThrow(/kein Objekt mit „schema“/);
    expect(() => readSnapshotJson(JSON.stringify({ curves: [] }))).toThrow(/Schema „fehlt“ unbekannt, erwartet deriva.market\/1/);
    expect(() => readSnapshotJson(JSON.stringify({ schema: "deriva.market/2" }))).toThrow(/Schema „deriva.market\/2“ unbekannt/);
    expect(() => readSnapshotJson(JSON.stringify({ schema: "deriva.market/1", valuationDate: "2026-09-03" }))).toThrow(
      /Snapshot unvollständig – Feld „discountCurveId“, „curves“, „fxSpots“ fehlt/,
    );
    expect(() =>
      readSnapshotJson(JSON.stringify({ schema: "deriva.market/1", valuationDate: "gestern", discountCurveId: {}, curves: [], fxSpots: {} })),
    ).toThrow(/Feld „valuationDate“ \(Datum JJJJ-MM-TT erwartet\) hat den falschen Typ/);
    expect(() =>
      readSnapshotJson(JSON.stringify({ schema: "deriva.market/1", valuationDate: "2026-09-03", discountCurveId: {}, curves: [{ id: "X" }], fxSpots: {} })),
    ).toThrow(/Kurve „X“ ohne Stützpunkte/);
    // optional collections default to empty – no "Cannot convert undefined or null to object" downstream
    const ok = readSnapshotJson(JSON.stringify({ schema: "deriva.market/1", valuationDate: "2026-09-03", discountCurveId: {}, curves: [], fxSpots: {} }));
    expect(ok.fixings).toEqual([]);
  });
  it("core messages of the import path are translated and TypeErrors get a German cause", () => {
    expect(translateCoreMessage("Unsupported market snapshot schema: undefined")).toBe(
      "Datei ist kein DERIVA-Markt-Snapshot (Schema „fehlt“ unbekannt, erwartet deriva.market/1)",
    );
    expect(translatePricingError(new PricingError("INVALID_DATE", "Invalid ISO date: 2026-13-45"))).toBe("Ungültiges Datum: 2026-13-45");
    expect(snapshotErrorText(new TypeError("Cannot convert undefined or null to object"), translatePricingError)).toMatch(
      /Snapshot unvollständig oder fehlerhaft/,
    );
    expect(translateCoreMessage('Market snapshot: fxFixings[0].pair must be a 6-letter currency pair (got "EUR/USD")')).toBe(
      'Snapshot: FX-Fixing 1 – Währungspaar "EUR/USD" ungültig (erwartet 6 Buchstaben wie EURUSD)',
    );
    expect(translateCoreMessage("Discount curve EUR-X for EUR missing")).toBe("Diskontkurve EUR-X für EUR fehlt im Snapshot");
    expect(translateCoreMessage("FX fixing EURUSD on 2026-03-03 given twice")).toBe("FX-Fixing EUR/USD vom 03.03.2026 ist doppelt hinterlegt");
    expect(translateCoreMessage("swaptionVols.USD.atm has 1 rows, expected 11 (one per expiry)")).toBe(
      "Swaption-Cube USD, atm: 1 Zeilen, erwartet 11 (eine je Verfall)",
    );
    expect(translateCoreMessage("fxVols.EURUSD.atm has 1 entries, expected 7 (one per expiry)")).toBe(
      "FX-Vol-Fläche EURUSD, atm: 1 Einträge, erwartet 7 (einer je Verfall)",
    );
    expect(translateCoreMessage('capletVols.EUR-EURIBOR-6M.volType: unknown vol type "Foo"')).toMatch(/Caplet-Fläche EUR-EURIBOR-6M: Vol-Typ "Foo" unbekannt/);
    expect(PRICING_ERROR_CODES_DE.INVALID_VOL_SURFACE).toBe("Vol-Fläche strukturell ungültig");
  });
  it("core R5 warnings: EXPIRED FX options are German", () => {
    expect(
      translateCoreMessage(
        "EXPIRED: FX option expired 2026-08-01 – settlement pending until 2026-08-05: settled payoff on the fixing 1.1700 (exercised, valued as the forward position at the strike), no vega, gamma or theta",
      ),
    ).toBe(
      "FX-Option am 01.08.2026 verfallen – Lieferung am 05.08.2026 steht aus: abgerechnete Auszahlung auf the fixing 1.1700 (ausgeübt, als Terminposition zum Strike bewertet), kein Vega, Gamma oder Theta",
    );
    expect(translateCoreMessage("EXPIRED: something else 2026-08-01")).toBe("Verfallen: something else 01.08.2026");
  });
});

describe("Markt R5-1 / N6-02 – vol surfaces are validated by the core before they are applied (no web fallback validator)", () => {
  it("the core validator reports malformed grids and accepts the sample surfaces", () => {
    const usd = market.swaptionVols!.USD!;
    const bad = { swaptionVols: { USD: { ...usd, atm: [[0.01]] } } };
    const problems = validateVolSurfaces(bad);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/^swaptionVols\.USD\.atm has 1 rows, expected \d+ \(one per expiry\)$/);
    expect(translateCoreMessage(problems[0]!)).toMatch(/^Swaption-Cube USD, atm: 1 Zeilen, erwartet \d+ \(eine je Verfall\)$/);
    expect(validateVolSurfaces({ swaptionVols: market.swaptionVols, capletVols: market.capletVols, fxVols: market.fxVols })).toEqual([]);
    const fx = market.fxVols!.EURUSD!;
    expect(validateVolSurfaces({ fxVols: { EURUSD: { ...fx, atm: [0.5] } } })[0]).toMatch(/^fxVols\.EURUSD\.atm has 1 entries, expected \d+/);
  });
});

describe("Markt – vega buckets exist for CHF / JPY swaption cubes", () => {
  it("a CHF swaption yields a CHF cube bucket report", () => {
    const t = parseQuickEntry("swpt chf 1y5y payer 1% 10m", VAL, { swaptionVolCurrencies: Object.keys(market.swaptionVols ?? {}) });
    expect(t.ok).toBe(true);
    expect(t.description).not.toMatch(/⚠/);
    const reports = vegaBuckets(market, t.trade!, "EUR", { dimension: "expiry-tenor" });
    expect(reports.map((r) => r.key)).toContain("CHF");
    expect(reports[0]!.buckets.length).toBeGreaterThan(10);
  });
});
