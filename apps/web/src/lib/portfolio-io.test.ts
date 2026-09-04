import { describe, expect, it } from "vitest";
import { type Trade, parseISO, toISO } from "@deriva/pricing-core";
import { newTradeTemplate } from "./templates.js";
import { samplePortfolio } from "../state/sample-portfolio.js";
import {
  CSV_IMPORT_TEMPLATES,
  csvErrorsText,
  csvTemplateText,
  datesToIso,
  portfolioCsv,
  splitCsvLine,
  tradesFromCsv,
  tradesFromJson,
  tradesToJson,
} from "./portfolio-io.js";

const VAL = parseISO("2026-09-03");

describe("portfolio JSON round trip", () => {
  it("serialises serial dates as ISO strings on *Date/date keys and parses them back", () => {
    const trades: Trade[] = [...samplePortfolio(VAL), newTradeTemplate("amort", VAL), newTradeTemplate("fxs", VAL)];
    const json = tradesToJson(trades);
    const plain = JSON.parse(json) as Record<string, unknown>[];
    const irs = plain[0] as { legs: { effectiveDate: unknown; terminationDate: unknown }[] };
    expect(irs.legs[0]!.effectiveDate).toBe("2024-06-17");
    expect(typeof irs.legs[0]!.terminationDate).toBe("string");
    const amort = plain.find((t) => (t as { legs?: { notionalSchedule?: unknown[] }[] }).legs?.[0]?.notionalSchedule) as {
      legs: { notionalSchedule: { date: unknown }[] }[];
    };
    expect(typeof amort.legs[0]!.notionalSchedule[0]!.date).toBe("string");
    const back = tradesFromJson(json);
    expect(back).toEqual(trades);
  });
  it("accepts an object with a trades array and rejects other shapes", () => {
    const t = newTradeTemplate("irs", VAL);
    const wrapped = JSON.stringify({ trades: datesToIso([t]) });
    expect(tradesFromJson(wrapped)).toEqual([t]);
    expect(() => tradesFromJson(JSON.stringify({ foo: 1 }))).toThrow(/Array/);
  });
  it("does not touch non-date keys or non-ISO strings", () => {
    const out = datesToIso({ name: "2026-01-01", rate: 3, tradeDate: VAL, nested: { date: VAL, other: 5 } }) as Record<string, unknown>;
    expect(out.name).toBe("2026-01-01");
    expect(out.rate).toBe(3);
    expect(out.tradeDate).toBe(toISO(VAL));
    expect((out.nested as { date: string }).date).toBe(toISO(VAL));
  });
});

describe("portfolio CSV", () => {
  it("uses BOM, semicolons and decimal comma", () => {
    const csv = portfolioCsv([
      { id: "IRS-1", type: "InterestRateSwap", name: "A;B", counterparty: "Bank", notional: 1e7, currency: "EUR", maturity: VAL, pv: -1234.5, dv01: 12.345 },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("id;type;name;counterparty;notional;currency;maturity;pv;dv01");
    expect(lines[1]).toBe('IRS-1;InterestRateSwap;"A;B";Bank;10000000,00;EUR;2026-09-03;-1234,50;12,35');
  });
  it("omits internal columns in customer mode", () => {
    const csv = portfolioCsv([{ id: "X", type: "FRA", notional: 1, currency: "EUR", maturity: VAL }], { includeInternal: false });
    expect(csv).not.toContain("counterparty");
    expect(csv).not.toContain("dv01");
  });
});

describe("CSV trade import with column mapping (Markt N16)", () => {
  it("parses every shipped template example into a trade", () => {
    for (const k of Object.keys(CSV_IMPORT_TEMPLATES) as (keyof typeof CSV_IMPORT_TEMPLATES)[]) {
      const res = tradesFromCsv(csvTemplateText(k), { valuationDate: VAL });
      expect(res.errors, k).toEqual([]);
      expect(res.trades.length, k).toBe(1);
    }
    const irs = tradesFromCsv(csvTemplateText("IRS"), { valuationDate: VAL }).trades[0]!;
    expect(irs.type).toBe("InterestRateSwap");
    expect(irs.id).toBe("IRS-1001");
    expect(irs.book).toBe("Treasury");
    expect(irs.status).toBe("Live");
    if (irs.type === "InterestRateSwap") {
      const fixed = irs.legs.find((l) => l.type === "Fixed")!;
      expect((fixed as { rate: number }).rate).toBeCloseTo(0.031, 10);
      expect(fixed.notional).toBe(10_000_000);
      expect(fixed.frequency).toBe("1Y");
    }
    const fxf = tradesFromCsv(csvTemplateText("FXF"), { valuationDate: VAL }).trades[0]!;
    if (fxf.type === "FxForward") {
      expect(fxf.buyCurrency).toBe("USD");
      expect(fxf.sellAmount).toBe(2_000_000);
      expect(fxf.deliveryDate).toBe(parseISO("2027-03-15"));
    }
    const cap = tradesFromCsv(csvTemplateText("CAP"), { valuationDate: VAL }).trades[0]!;
    if (cap.type === "CapFloor") expect(cap.strike).toBeCloseTo(0.03, 10);
    // round-3 templates: Swaption, FX-Option, CCS, FRA (Markt N16)
    const swpt = tradesFromCsv(csvTemplateText("SWPT"), { valuationDate: VAL }).trades[0]!;
    expect(swpt.type).toBe("Swaption");
    if (swpt.type === "Swaption") {
      expect(swpt.payerReceiver).toBe("Payer");
      expect(swpt.underlying.legs[0]!.notional).toBe(10_000_000);
    }
    const fxo = tradesFromCsv(csvTemplateText("FXO"), { valuationDate: VAL }).trades[0]!;
    expect(fxo.type).toBe("FxOption");
    if (fxo.type === "FxOption") {
      expect(fxo.optionType).toBe("Put");
      expect(fxo.strike).toBeCloseTo(1.15, 10);
      expect(fxo.expiryDate).toBe(parseISO("2027-06-15"));
    }
    const ccs = tradesFromCsv(csvTemplateText("CCS"), { valuationDate: VAL }).trades[0]!;
    expect(ccs.type).toBe("CrossCurrencySwap");
    if (ccs.type === "CrossCurrencySwap") {
      expect(ccs.legs[0]!.notional).toBe(10_000_000);
      expect((ccs.legs[0] as { spread: number }).spread).toBeCloseTo(-0.002, 10);
      expect(ccs.legs[1]!.notional).toBeCloseTo(11_700_000, 3);
      expect(ccs.collateralCurrency).toBe("USD");
    }
    const fra = tradesFromCsv(csvTemplateText("FRA"), { valuationDate: VAL }).trades[0]!;
    expect(fra.type).toBe("FRA");
    if (fra.type === "FRA") {
      expect(fra.index).toBe("EURIBOR-3M");
      expect(fra.fixedRate).toBeCloseTo(0.022, 10);
      expect(fra.payReceive).toBe("Pay");
    }
    // the market spot fills a missing fxSpot column for CCS rows
    const noSpot = tradesFromCsv("type;pair;notional;spread;maturity\nCCS;EURUSD;5000000;-15;3Y\n", { valuationDate: VAL, fxSpots: { EURUSD: 1.2 } });
    expect(noSpot.errors).toEqual([]);
    expect(noSpot.trades[0]?.type === "CrossCurrencySwap" && noSpot.trades[0].legs[1]!.notional).toBeCloseTo(6_000_000, 3);
    expect(tradesFromCsv("type;pair;notional;spread;maturity\nCCS;EURUSD;5000000;-15;3Y\n", { valuationDate: VAL }).errors[0]?.msg).toMatch(/FX-Spot fehlt/);
    // error list export
    const errCsv = csvErrorsText([{ row: 3, msg: "Nominal fehlt; oder ≤ 0" }]);
    expect(errCsv.startsWith("\uFEFFZeile;Meldung")).toBe(true);
    expect(errCsv).toContain('4;"Nominal fehlt; oder ≤ 0"');
  });
  it("accepts German headers, comma separator, German numbers / dates and an explicit mapping", () => {
    const text = [
      "Produkt,Referenz,Kontrahent,Waehrung,Nominal,Richtung,Kupon,Beginn,Laufzeit,Portfolio",
      'IRS,X-1,"Bank, AG",EUR,"5.000.000",Erhalten,"2,45 %",15.03.2027,5Y,Kredite',
      "IRS,X-2,Bank,EUR,1m,Pay,310bp,2027-03-15,31.12.2032,Kredite",
    ].join("\n");
    const res = tradesFromCsv(text, { valuationDate: VAL });
    expect(res.errors).toEqual([]);
    expect(res.trades.map((t) => t.id)).toEqual(["X-1", "X-2"]);
    const t1 = res.trades[0]!;
    expect(t1.counterparty).toBe("Bank, AG");
    expect(t1.book).toBe("Kredite");
    if (t1.type === "InterestRateSwap") {
      expect(t1.legs[0]!.notional).toBe(5_000_000);
      expect(t1.legs.find((l) => l.type === "Fixed")!.payReceive).toBe("Receive");
      expect(t1.legs[0]!.effectiveDate).toBe(parseISO("2027-03-15"));
    }
    const t2 = res.trades[1]!;
    if (t2.type === "InterestRateSwap") {
      expect((t2.legs.find((l) => l.type === "Fixed") as { rate: number }).rate).toBeCloseTo(0.031, 10);
      expect(t2.legs[0]!.terminationDate).toBe(parseISO("2032-12-31"));
    }
    const mapped = tradesFromCsv("Art;Nr;Betrag;Zins;Ende\nIRS;M-1;2m;3%;10y", {
      valuationDate: VAL,
      mapping: { type: "Art", id: "Nr", notional: "Betrag", rate: "Zins", maturity: "Ende" },
    });
    expect(mapped.errors).toEqual([]);
    expect(mapped.trades[0]!.id).toBe("M-1");
  });
  it("reports row errors in German and rejects files without a type column", () => {
    const res = tradesFromCsv("type;id;notional;rate;maturity\nIRS;A;;3%;5Y\nXYZ;B;1m;3%;5Y\nIRS;C;1m;3%;5Y", { valuationDate: VAL });
    expect(res.trades.map((t) => t.id)).toEqual(["C"]);
    expect(res.errors).toEqual([
      { row: 1, msg: "Nominal fehlt oder ≤ 0" },
      { row: 2, msg: "Unbekannter Typ „XYZ“ (erlaubt: IRS, FXF, CAP, SWPT, FXO, CCS, FRA)" },
    ]);
    expect(() => tradesFromCsv("id;notional\nA;1", { valuationDate: VAL })).toThrow(/Typ/);
    expect(splitCsvLine('a;"b;c";"d""e"', ";")).toEqual(["a", "b;c", 'd"e']);
  });
});
