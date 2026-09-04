/**
 * Round-9 library findings (docs/quality/review-ui-r9.md, review-markt-r9.md):
 * index tokens of runtime-registered indices in the quick entry (R9-F1 / Markt
 * R9-5), `basis [ccy]` over the register (Markt R9-3), the „+ Währung“ hint for
 * unregistered currencies with a curve (R9-F3), CSV type detection without a
 * `type` column (Markt R9-4), the snapshot `quotes` block (Markt R9-1), the
 * import-aware registration toast (R9-03), the disabled-aware focus helper,
 * and the German texts of the round-9 core changes (collateral curves, rolled
 * labels, rebate convention).
 */
import { afterEach, describe, expect, it } from "vitest";
import { type CurveBuildSpec, type Trade, knownCurrencies, knownIndices, parseISO } from "@deriva/pricing-core";
import { CZK_ENVELOPE, sampleSnapshot, withCurve } from "../test/fixtures-r8.js";
import { buildCurrencyEnvelope, registrationToast } from "../views/AddCurrencyForm.js";
import { escapeCloses, focusFirstEnabled, focusNeighbourAfterRemoval, focusWhenPresent } from "./focus.js";
import { marketLabelDe, translateCoreMessage } from "./i18n.js";
import { analyticsRows } from "./metrics.js";
import {
  CSV_IMPORT_TEMPLATES,
  CSV_TRADE_TYPES,
  type CsvTradeType,
  CsvTypeMissingError,
  csvTemplateText,
  csvTypeFromColumns,
  csvTypeFromFileName,
  detectCsvType,
  tradesFromCsv,
} from "./portfolio-io.js";
import { isGrammarToken, isIndexToken, parseQuickEntry, unknownTokenError } from "./quick-parser.js";
import { quotesOf, quotesProblems, registerEnvelope, unregisterEnvelope, validateQuotesBlock } from "./register-envelope.js";
import { readSnapshotJson } from "./snapshot-import.js";

const VAL = parseISO("2026-09-03");
const G5 = ["EUR", "USD", "GBP", "CHF", "JPY"];
const G5_CURVES = ["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "USD-SOFR", "GBP-SONIA", "CHF-SARON", "JPY-TONA"];
const HUF_ENVELOPE = buildCurrencyEnvelope({
  currency: "HUF",
  calendar: "TARGET",
  fixedFrequency: "1Y",
  fixedDayCount: "ACT/360",
  spotLag: 2,
  ois: { name: "HUFONIA", dayCount: "ACT/360", fixingLag: 0, paymentLag: 1 },
  ibor: { name: "BUBOR-6M", tenor: "6M", dayCount: "ACT/360", fixingLag: 2 },
});
const floatIndices = (t: Trade | undefined): string[] =>
  t?.type === "InterestRateSwap" ? t.legs.map((l) => (l.type === "Float" ? l.index : "")).filter(Boolean) : [];

describe("R9-F1 / Markt R9-5 – the quick entry knows every registered index token", () => {
  afterEach(() => {
    unregisterEnvelope(HUF_ENVELOPE);
    unregisterEnvelope(CZK_ENVELOPE);
  });

  it("a token of a runtime-registered index is an index token – before the registration it is unknown", () => {
    expect(isIndexToken("bubor6m")).toBe(false);
    expect(isGrammarToken("bubor6m")).toBe(false);
    expect(registerEnvelope(HUF_ENVELOPE).ok).toBe(true);
    for (const tok of ["bubor6m", "bubor-6m", "BUBOR-6M", "hufonia", "HUFONIA"]) {
      expect(isIndexToken(tok), tok).toBe(true);
      expect(isGrammarToken(tok), tok).toBe(true);
    }
    // family prefix of a registered index → index token (so the branch can name the currency's indices)
    expect(isIndexToken("bubor9m")).toBe(true);
    // built-ins as before; plain words, currencies and tenors are no index tokens
    for (const tok of ["euribor6m", "estr", "€STR", "nibor9m", "sofr"]) expect(isIndexToken(tok), tok).toBe(true);
    for (const tok of ["huf", "6m", "pay", "step", "GmbH", "cash", "10m"]) expect(isIndexToken(tok), tok).toBe(false);
  });

  it("'irs huf … bubor6m' after „+ Währung“ HUF names the missing curve instead of „Unbekanntes Token“; 'irs czk … pribor6m' likewise", () => {
    expect(registerEnvelope(HUF_ENVELOPE).ok).toBe(true);
    const opts = { curveCurrencies: [...G5, "HUF"], curveIds: [...G5_CURVES, "HUF-HUFONIA"] };
    for (const tok of ["bubor6m", "bubor-6m", "BUBOR-6M"]) {
      const r = parseQuickEntry(`irs huf 5y pay 6% 100m ${tok}`, VAL, opts);
      expect(r.ok, tok).toBe(true);
      expect(floatIndices(r.trade), tok).toEqual(["BUBOR-6M"]);
      expect(r.description, tok).toMatch(/⚠ Kurve HUF-BUBOR-6M fehlt – in der Kurvenansicht mit „\+ Kurve“ anlegen/);
      expect(r.error).toBeUndefined();
    }
    const ois = parseQuickEntry("irs huf 5y pay 6% 100m hufonia", VAL, opts);
    expect(ois.ok).toBe(true);
    expect(floatIndices(ois.trade)).toEqual(["HUFONIA"]);
    expect(ois.description).toMatch(/· HUFONIA$/);
    expect(ois.description).not.toMatch(/⚠/);
    // a token of the family without a registered tenor names the currency's indices
    expect(parseQuickEntry("irs huf 5y pay 6% 100m bubor3m", VAL, opts).error).toBe("Unbekannter Index „bubor3m“ – für HUF registriert: BUBOR-6M, HUFONIA");
    // CZK from the API envelope
    expect(registerEnvelope(CZK_ENVELOPE).ok).toBe(true);
    const czk = parseQuickEntry("irs czk 5y pay 4% 100m pribor6m", VAL, { curveCurrencies: [...G5, "CZK"], curveIds: [...G5_CURVES, "CZK-CZEONIA"] });
    expect(czk.ok).toBe(true);
    expect(floatIndices(czk.trade)).toEqual(["PRIBOR-6M"]);
    expect(czk.description).toMatch(/Kurve CZK-PRIBOR-6M fehlt/);
    const fra = parseQuickEntry("fra czk 3x9 pay 4% 10m pribor6m", VAL, { curveCurrencies: [...G5, "CZK"], curveIds: [...G5_CURVES, "CZK-CZEONIA"] });
    expect(fra.ok).toBe(true);
    expect(fra.description).toMatch(/PRIBOR-6M/);
    // the counterparty phrase still ends at the index token
    const cp = parseQuickEntry("irs czk 5y pay 4% 100m @Kunde GmbH pribor6m", VAL, {
      curveCurrencies: [...G5, "CZK"],
      curveIds: [...G5_CURVES, "CZK-CZEONIA"],
    });
    expect(cp.trade?.counterparty).toBe("Kunde GmbH");
    expect(floatIndices(cp.trade)).toEqual(["PRIBOR-6M"]);
  });
});

describe("Markt R9-3 – 'basis [ccy]' resolves the leg tenors to the currency's indices", () => {
  const nokOpts = {
    curveCurrencies: [...G5, "NOK"],
    curveIds: [...G5_CURVES, "NOK-NOWA", "NOK-NIBOR-3M", "NOK-NIBOR-6M"],
  };
  afterEach(() => unregisterEnvelope(CZK_ENVELOPE));

  it("'basis nok 5y 3m/6m' builds NIBOR-3M vs NIBOR-6M, '6m/1d' takes the OIS index, EUR is unchanged", () => {
    const nok = parseQuickEntry("basis nok 5y 3m/6m 5bp 10m", VAL, nokOpts);
    expect(nok.ok).toBe(true);
    expect(floatIndices(nok.trade).sort()).toEqual(["NIBOR-3M", "NIBOR-6M"]);
    expect(nok.trade?.type === "InterestRateSwap" && nok.trade.legs.map((l) => l.currency)).toEqual(["NOK", "NOK"]);
    expect(nok.trade?.name).toBe("Basis-Swap NOK 3M/6M 5Y");
    // index names work as legs too
    expect(floatIndices(parseQuickEntry("basis nok 5y nibor3m/nowa 10m", VAL, nokOpts).trade).sort()).toEqual(["NIBOR-3M", "NOWA"]);
    expect(nok.description).toBe("Basis-Swap NIBOR-3M +5,0 bp vs NIBOR-6M 5Y · Nominal 10.000.000");
    const ois = parseQuickEntry("basis nok 5y 6m/1d 10m", VAL, nokOpts);
    expect(ois.ok).toBe(true);
    expect(floatIndices(ois.trade).sort()).toEqual(["NIBOR-6M", "NOWA"]);
    // a leg whose curve is missing is flagged per leg, the trade is still built
    const missing = parseQuickEntry("basis nok 5y 3m/6m 10m", VAL, { ...nokOpts, curveIds: [...G5_CURVES, "NOK-NOWA", "NOK-NIBOR-6M"] });
    expect(missing.ok).toBe(true);
    expect(missing.description).toMatch(/⚠ Kurve NOK-NIBOR-3M fehlt/);
    expect(missing.description).not.toMatch(/NIBOR-6M fehlt/);
    // EUR default unchanged
    const eur = parseQuickEntry("basis 5y 3m/6m 5bp 10m", VAL, { curveCurrencies: G5, curveIds: G5_CURVES });
    expect(eur.ok).toBe(true);
    expect(floatIndices(eur.trade).sort()).toEqual(["EURIBOR-3M", "EURIBOR-6M"]);
    expect(eur.description).toBe("Basis-Swap EURIBOR-3M +5,0 bp vs EURIBOR-6M 5Y · Nominal 10.000.000");
    // identical legs are refused
    expect(parseQuickEntry("basis 5y 3m/3m 10m", VAL, { curveCurrencies: G5, curveIds: G5_CURVES }).error).toMatch(/Beide Legs zeigen auf EURIBOR-3M/);
  });

  it("'basis czk 5y 3m/6m' with only CZEONIA / PRIBOR-6M registered fails with a German error naming the indices", () => {
    expect(registerEnvelope(CZK_ENVELOPE).ok).toBe(true);
    const opts = { curveCurrencies: [...G5, "CZK"], curveIds: [...G5_CURVES, "CZK-CZEONIA"] };
    const r = parseQuickEntry("basis czk 5y 3m/6m 5bp 10m", VAL, opts);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Für CZK ist kein 3M-Index registriert – registriert: CZEONIA, PRIBOR-6M");
    // the registered tenor works and flags the missing PRIBOR-6M curve
    const ok = parseQuickEntry("basis czk 5y 6m/1d 10m", VAL, opts);
    expect(ok.ok).toBe(true);
    expect(floatIndices(ok.trade).sort()).toEqual(["CZEONIA", "PRIBOR-6M"]);
    expect(ok.description).toMatch(/⚠ Kurve CZK-PRIBOR-6M fehlt/);
    // a foreign index name is refused with the currency's list
    expect(parseQuickEntry("basis czk 5y euribor3m/1d 10m", VAL, opts).error).toMatch(
      /Index EURIBOR-3M gehört nicht zu CZK – für CZK registriert: CZEONIA, PRIBOR-6M/,
    );
    // a currency without any curve still gets the "+ Kurve" hint first
    expect(parseQuickEntry("basis czk 5y 6m/1d 10m", VAL, { curveCurrencies: G5, curveIds: G5_CURVES }).error).toMatch(/Keine Kurve für CZK im Markt/);
  });
});

describe("R9-F3 – a currency with a curve in the market but without conventions gets the „+ Währung“ hint", () => {
  it("unknownTokenError and the swap / cap / swaption branches name the register, not „Unbekannte Währung“", () => {
    expect(knownCurrencies()).not.toContain("HUF");
    const grammar = "irs [ccy] …";
    expect(unknownTokenError("huf", grammar, { curveCurrencies: [...G5, "HUF"] })).toBe(
      "Währung „HUF“ hat eine Kurve im Markt, ist aber nicht registriert – Für HUF sind keine Swap-Konventionen registriert – in der Kurvenansicht mit „+ Währung“ registrieren (oder Snapshot mit „conventions“/„indices“ importieren); ein Swap in HUF wird sonst nicht gebaut",
    );
    expect(unknownTokenError("huf", grammar, { curveCurrencies: G5 })).toMatch(/^Unbekannte Währung „HUF“ – Währungen:/);
    expect(unknownTokenError("huf", grammar)).toMatch(/^Unbekannte Währung „HUF“/);
    const opts = { curveCurrencies: [...G5, "HUF"], curveIds: [...G5_CURVES, "HUF-HUFONIA"] };
    for (const cmd of ["irs huf 5y pay 6% 100m", "cap huf 5y 3% 8m", "swpt huf 1y5y payer 3% 10m", "fra huf 3x6 pay 2% 10m", "basis huf 5y 3m/6m"]) {
      const r = parseQuickEntry(cmd, VAL, opts);
      expect(r.ok, cmd).toBe(false);
      expect(r.error, cmd).toMatch(/hat eine Kurve im Markt, ist aber nicht registriert – .*„\+ Währung“/);
    }
    // without a curve the old message stays
    expect(parseQuickEntry("irs huf 5y pay 6% 100m", VAL, { curveCurrencies: G5, curveIds: G5_CURVES }).error).toMatch(/^Unbekannte Währung „HUF“/);
  });
});

/** The API's template rows (apps/api/src/lib/csv-import.ts) – header and example *without* the `type` column, as documented before R9-4. */
const API_ROWS_NO_TYPE: Record<CsvTradeType, [string, string]> = {
  IRS: [
    "currency;notional;payReceive;fixedRate;effectiveDate;maturity;id;name;counterparty;book;uti;index;spread;fixedFrequency;floatFrequency;collateralCurrency;stepUp",
    "EUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS-CSV-1;Payer-Swap Kredit A;CPTY-A;Treasury;;EURIBOR-6M;;1Y;6M;;",
  ],
  FXF: ["pair;baseAmount;rate;deliveryDate;id;name;counterparty;book;uti", "EURUSD;-2.000.000;1,1725;2027-03-15;FXF-CSV-1;;CPTY-B;;"],
  CAP: [
    "currency;notional;capFloor;strike;effectiveDate;maturity;id;name;counterparty;book;uti;floorStrike;index;longShort",
    "EUR;8.000.000;Cap;3,00 %;2026-09-07;5Y;CAP-CSV-1;;CPTY-A;;;;EURIBOR-6M;Long",
  ],
  SWPT: [
    "currency;notional;payerReceiver;strike;expiry;tenor;id;name;counterparty;book;uti;settlement;longShort",
    "EUR;10.000.000;Payer;3,00 %;1Y;5Y;SWPT-CSV-1;;CPTY-A;;;Physical;Long",
  ],
  FXO: [
    "pair;optionType;notional;strike;expiryDate;id;name;counterparty;book;uti;deliveryDate;longShort;barrierType;barrierLevel;barrierRebate;barrierHit",
    "EURUSD;Put;3.000.000;1,15;2027-06-15;FXO-CSV-1;;CPTY-A;;;;Long;;;;",
  ],
  CCS: [
    "pair;domesticNotional;effectiveDate;tenor;id;name;counterparty;book;uti;fxSpot;foreignNotional;spread;fixedRate;domesticPayReceive;frequency;collateralCurrency",
    "EURUSD;10.000.000;2026-09-07;5Y;CCS-CSV-1;;CPTY-A;;;1,17;;-20 bp;;Receive;3M;",
  ],
  FRA: [
    "currency;notional;payReceive;start;rate;id;name;counterparty;book;uti;index;end;collateralCurrency",
    "EUR;5.000.000;Pay;3x9;2,20 %;FRA-CSV-1;;CPTY-B;;;EURIBOR-6M;;",
  ],
  FXS: [
    "pair;baseAmount;nearRate;farRate;nearDate;farDate;id;name;counterparty;book;uti",
    "EURUSD;5.000.000;1,1625;1,1690;2026-09-07;2027-03-08;FXS-CSV-1;;CPTY-B;;",
  ],
  BASIS: [
    "currency;notional;receiveIndex;payIndex;spread;effectiveDate;maturity;id;name;counterparty;book;uti",
    "EUR;10.000.000;EURIBOR-6M;EURIBOR-3M;12 bp;2026-09-07;5Y;BASIS-CSV-1;;CPTY-A;;",
  ],
  AMORT: [
    "currency;notional;payReceive;fixedRate;effectiveDate;maturity;id;name;counterparty;book;uti;finalNotional;index;spread;fixedFrequency;floatFrequency;collateralCurrency;stepUp",
    "EUR;10.000.000;Pay;3,00 %;2026-09-07;10Y;AMORT-CSV-1;;CPTY-A;;;2.000.000;EURIBOR-6M;;1Y;6M;;",
  ],
  IMM: [
    "currency;notional;payReceive;fixedRate;tenor;id;name;counterparty;book;uti;from;index;spread;fixedFrequency;floatFrequency;collateralCurrency;stepUp",
    "EUR;10.000.000;Pay;3,00 %;2Y;IMM-CSV-1;;CPTY-A;;;;EURIBOR-6M;;;;;",
  ],
};
const API_FILE_NAMES: Record<CsvTradeType, string> = {
  IRS: "InterestRateSwap.csv",
  FXF: "FxForward.csv",
  CAP: "CapFloor.csv",
  SWPT: "Swaption.csv",
  FXO: "FxOption.csv",
  CCS: "CrossCurrencySwap.csv",
  FRA: "FRA.csv",
  FXS: "FxSwap.csv",
  BASIS: "BasisSwap.csv",
  AMORT: "AmortisingSwap.csv",
  IMM: "ImmSwap.csv",
};

describe("Markt R9-4 – CSV without a `type` column: type from the file name or the column set, otherwise a dialog", () => {
  it("the file name names the type: workstation templates, API template files, bare tokens", () => {
    expect(csvTypeFromFileName("deriva-import-vorlage-ccs.csv")).toBe("CCS");
    expect(csvTypeFromFileName("C:\\Downloads\\deriva-import-vorlage-fxo.csv")).toBe("FXO");
    for (const [type, name] of Object.entries(API_FILE_NAMES) as [CsvTradeType, string][]) expect(csvTypeFromFileName(name), name).toBe(type);
    expect(csvTypeFromFileName("crosscurrencyswap-2026-09.csv")).toBe("CCS");
    expect(csvTypeFromFileName("IRS.csv")).toBe("IRS");
    expect(csvTypeFromFileName("trades_fxf_q3.csv")).toBe("FXF");
    // no false positives on ordinary words
    expect(csvTypeFromFileName("capital-trades.csv")).toBeUndefined();
    expect(csvTypeFromFileName("bestand.csv")).toBeUndefined();
    expect(csvTypeFromFileName(undefined)).toBeUndefined();
  });

  it("the API example rows of all eleven templates import without a `type` column – type from the column signature", () => {
    for (const [type, [head, row]] of Object.entries(API_ROWS_NO_TYPE) as [CsvTradeType, [string, string]][]) {
      expect(csvTypeFromColumns(head.split(";"), row.split(";")), type).toBe(type);
      const r = tradesFromCsv(`${head}\n${row}\n`, { valuationDate: VAL });
      expect(r.errors, type).toEqual([]);
      expect(r.trades, type).toHaveLength(1);
      expect(r.trades[0]!.id, type).toBe(`${type}-CSV-1`);
      expect(r.typeSource, type).toEqual({ type, from: "columns" });
    }
    // the eleven workstation templates without their leading `type` column as well
    for (const type of CSV_TRADE_TYPES) {
      const [head, row] = csvTemplateText(type)
        .replace(/^\uFEFF/, "")
        .trim()
        .split(/\r?\n/) as [string, string];
      const strip = (line: string) => line.split(";").slice(1).join(";");
      const r = tradesFromCsv(`${strip(head)}\n${strip(row)}\n`, { valuationDate: VAL });
      expect(r.typeSource?.type, type).toBe(type);
      expect(r.errors, type).toEqual([]);
      expect(r.trades, type).toHaveLength(1);
    }
    // the file name wins over the columns and is reported as the source
    const byName = tradesFromCsv(`${API_ROWS_NO_TYPE.FXF[0]}\n${API_ROWS_NO_TYPE.FXF[1]}\n`, { valuationDate: VAL, fileName: "FxForward.csv" });
    expect(byName.typeSource).toEqual({ type: "FXF", from: "file" });
    expect(byName.trades[0]!.type).toBe("FxForward");
    expect(detectCsvType(["id", "name"], ["a", "b"], "deriva-import-vorlage-imm.csv")).toEqual({ type: "IMM", from: "file" });
    // a `type` column still rules: no derivation, no source
    const typed = tradesFromCsv(`type;${API_ROWS_NO_TYPE.IRS[0]}\nIRS;${API_ROWS_NO_TYPE.IRS[1]}\n`, { valuationDate: VAL, fileName: "FxForward.csv" });
    expect(typed.typeSource).toBeUndefined();
    expect(typed.trades[0]!.type).toBe("InterestRateSwap");
  });

  it("a legacy CCS file (pair + fxSpot), a German IRS file and an FRA with a 3x9 start are recognised", () => {
    expect(csvTypeFromColumns(["id", "pair", "notional", "start", "maturity", "spread", "fxSpot", "collateral"])).toBe("CCS");
    expect(csvTypeFromColumns(["Referenz", "Währung", "Nominal", "Richtung", "Satz", "Start", "Laufzeit"])).toBe("IRS");
    expect(csvTypeFromColumns(["currency", "notional", "payReceive", "start", "rate"], ["EUR", "1000000", "Pay", "3x9", "2,2 %"])).toBe("FRA");
    expect(csvTypeFromColumns(["currency", "notional", "direction", "strike", "start", "maturity"])).toBe("CAP");
    expect(csvTypeFromColumns(["buyCurrency", "buyAmount", "sellCurrency", "sellAmount", "deliveryDate"])).toBe("FXF");
    expect(csvTypeFromColumns(["id", "name", "counterparty"])).toBeUndefined();
  });

  it("without any hint the reader throws `CsvTypeMissingError`; `defaultType` (the dialog) resolves it", () => {
    const text = "id;name\nX-1;Irgendwas\n";
    expect(() => tradesFromCsv(text, { valuationDate: VAL })).toThrow(CsvTypeMissingError);
    expect(() => tradesFromCsv(text, { valuationDate: VAL, fileName: "bestand.csv" })).toThrow(
      /Spalte „Typ“ fehlt \(IRS \/ FXF .*\) und der Produkttyp lässt sich weder aus dem Dateinamen noch aus den Spalten ableiten/,
    );
    const r = tradesFromCsv(text, { valuationDate: VAL, defaultType: "IRS" });
    expect(r.typeSource).toEqual({ type: "IRS", from: "dialog" });
    expect(r.trades).toEqual([]);
    expect(r.errors).toHaveLength(1); // the row lacks the currency – a row error, not a crash
    expect(Object.keys(CSV_IMPORT_TEMPLATES)).toEqual(CSV_TRADE_TYPES);
  });
});

describe("Markt R9-1 – the snapshot `quotes` block is validated structurally and against the market", () => {
  const spec: CurveBuildSpec = { id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: [{ type: "OIS", tenor: "1Y", rate: 0.04 }] };

  it("readSnapshotJson checks the block and keeps it; German messages name the entry", () => {
    const base = { ...sampleSnapshot(VAL) };
    expect(() => readSnapshotJson(JSON.stringify({ ...base, quotes: {} }))).toThrow(/Feld „quotes“ muss eine Liste sein/);
    expect(() => readSnapshotJson(JSON.stringify({ ...base, quotes: [{ curveId: "NOK-NOWA" }] }))).toThrow(/Quotes für Kurve „NOK-NOWA“: „spec“ fehlt/);
    expect(() => readSnapshotJson(JSON.stringify({ ...base, quotes: [{ curveId: "NOK-NOWA", spec: { ...spec, id: "X" } }] }))).toThrow(
      /„spec.id“ \(X\) passt nicht/,
    );
    expect(() => readSnapshotJson(JSON.stringify({ ...base, quotes: [{ curveId: "NOK-NOWA", spec: { ...spec, quotes: [] } }] }))).toThrow(/nicht-leere Liste/);
    expect(() => readSnapshotJson(JSON.stringify({ ...base, quotes: [{ spec }] }))).toThrow(/Quotes-Eintrag Nr. 1 ohne „curveId“/);
    expect(validateQuotesBlock(undefined)).toBeUndefined();
    const ok = readSnapshotJson(JSON.stringify({ ...base, quotes: [{ curveId: "NOK-NOWA", spec }] }));
    expect(quotesOf(ok)).toEqual([{ curveId: "NOK-NOWA", spec }]);
    expect(quotesOf(base)).toEqual([]);
  });

  it("quotesProblems: curve must exist, currency must match, index must be registered, no duplicates", () => {
    const snap = withCurve(sampleSnapshot(VAL), "NOK-NOWA", "NOK", 11.62);
    const curves = Object.fromEntries(snap.curves.map((c) => [c.id, { id: c.id, currency: c.currency }]));
    expect(quotesProblems([{ curveId: "NOK-NOWA", spec }], curves)).toEqual([]);
    expect(quotesProblems([{ curveId: "NOK-X", spec: { ...spec, id: "NOK-X" } }], curves)).toEqual([
      expect.stringMatching(/^Quotes für Kurve „NOK-X“: Kurve nicht im Snapshot/),
    ]);
    expect(quotesProblems([{ curveId: "NOK-NOWA", spec: { ...spec, currency: "SEK" } }], curves)).toEqual([
      "Quotes für Kurve „NOK-NOWA“: Währung SEK passt nicht zur Kurve (NOK)",
    ]);
    expect(quotesProblems([{ curveId: "NOK-NOWA", spec: { ...spec, index: "PRIBOR-6M" } }], curves)[0]).toMatch(/Index „PRIBOR-6M“ ist nicht registriert/);
    expect(
      quotesProblems(
        [
          { curveId: "NOK-NOWA", spec },
          { curveId: "NOK-NOWA", spec },
        ],
        curves,
      ),
    ).toEqual(["Quotes für Kurve „NOK-NOWA“: doppelt"]);
    expect(knownIndices("NOK").some((i) => i.name === "NOWA")).toBe(true);
  });
});

describe("R9-03 / R9-02 / R9-04 – toast, focus and keyboard helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("the registration toast names „+ Kurve“ in sample mode and the two ways to a curve under an import", () => {
    expect(registrationToast("Index ROBOR-ON · Konventionen RON", "RON", "sample")).toBe(
      "Registriert: Index ROBOR-ON · Konventionen RON – jetzt mit „+ Kurve“ eine RON-Kurve anlegen",
    );
    expect(registrationToast("Index ROBOR-ON · Konventionen RON", "RON", "import")).toBe(
      "Registriert: Index ROBOR-ON · Konventionen RON – im Import-Modus ist „+ Kurve“ gesperrt: nach „Zum Sample-Markt“ mit „+ Kurve“ eine RON-Kurve anlegen oder einen Snapshot mit RON-Kurve importieren",
    );
  });

  it("focusWhenPresent never focuses a disabled control; focusFirstEnabled takes the first enabled candidate", async () => {
    document.body.innerHTML =
      '<button data-testid="a" disabled>a</button><button data-testid="a" id="a2">a2</button><button data-testid="b" disabled>b</button><button data-testid="c" id="c">c</button>';
    const el = await focusWhenPresent('[data-testid="a"]', 3);
    expect(el?.id).toBe("a2");
    expect(document.activeElement?.id).toBe("a2");
    expect(await focusWhenPresent('[data-testid="b"]', 2)).toBeNull();
    const first = await focusFirstEnabled(['[data-testid="b"]', '[data-testid="c"]'], 2);
    expect(first?.id).toBe("c");
    expect(document.activeElement?.id).toBe("c");
  });

  it("focusNeighbourAfterRemoval focuses the row at the removed position, the last row, or the fallback control", async () => {
    document.body.innerHTML =
      '<table><tbody id="tb"><tr id="r0" tabindex="-1"></tr><tr id="r1" tabindex="-1"></tr><tr id="r2" tabindex="-1"></tr></tbody></table><button data-testid="add">+</button>';
    const tbody = document.getElementById("tb")!;
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const r1 = document.getElementById("r1") as HTMLTableRowElement;
    focusNeighbourAfterRemoval(r1, '[data-testid="add"]');
    r1.remove();
    await tick();
    expect(document.activeElement?.id).toBe("r2"); // the row that now sits at the removed position
    const r2 = document.getElementById("r2") as HTMLTableRowElement;
    focusNeighbourAfterRemoval(r2, '[data-testid="add"]');
    r2.remove();
    await tick();
    expect(document.activeElement?.id).toBe("r0"); // last row removed → the new last row
    const r0 = document.getElementById("r0") as HTMLTableRowElement;
    focusNeighbourAfterRemoval(r0, '[data-testid="add"]');
    r0.remove();
    await tick();
    expect(tbody.children.length).toBe(0);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("add"); // empty table → „+ Zeile“
    focusNeighbourAfterRemoval(null, '[data-testid="add"]'); // no-op
  });

  it("escapeCloses reacts to Esc only and stops the event", () => {
    let closed = 0;
    const handler = escapeCloses(() => closed++);
    const ev = (key: string, defaultPrevented = false) => {
      let prevented = defaultPrevented;
      let stopped = false;
      handler({
        key,
        defaultPrevented,
        preventDefault: () => (prevented = true),
        stopPropagation: () => (stopped = true),
      });
      return { prevented, stopped };
    };
    expect(ev("Enter")).toEqual({ prevented: false, stopped: false });
    expect(ev("Escape")).toEqual({ prevented: true, stopped: true });
    expect(closed).toBe(1);
    ev("Escape", true); // a NumInput already handled it (restore value) – not closed a second time
    expect(closed).toBe(1);
  });
});

describe("core R9 texts – collateral curves, rolled labels, rebate convention", () => {
  it("validateMarket's collateral problems are German; rolled snapshot labels read „(gerollt auf …)“", () => {
    expect(translateCoreMessage("Collateral discount curve EUR-ESTR-CZKCSA for EUR|CZK is denominated in CZK, not EUR")).toBe(
      "Collateral-Diskontkurve EUR-ESTR-CZKCSA für EUR unter CZK-CSA (EUR|CZK) ist in CZK denominiert, nicht in EUR",
    );
    expect(translateCoreMessage("Collateral discount curve EUR-X for EUR|CZK missing")).toBe(
      "Collateral-Diskontkurve EUR-X für EUR unter CZK-CSA (EUR|CZK) fehlt im Snapshot",
    );
    expect(marketLabelDe("Sample EoD (rolled to 2026-10-01)")).toBe("Sample EoD (gerollt auf 01.10.2026)");
    expect(marketLabelDe("Sample EoD")).toBe("Sample EoD");
    expect(marketLabelDe(undefined)).toBe("Snapshot");
    expect(marketLabelDe(null, "–")).toBe("–");
  });

  it("analytics.rebateAt knows only hit and expiry", () => {
    const rows = (v: string) => analyticsRows({ rebateAt: v }, { tradeType: "FxOption", reportingCurrency: "EUR" });
    expect(rows("hit").find((r) => r.k === "rebateAt")?.v).toBe("bei Berührung (Haug / QuantLib)");
    expect(rows("expiry").find((r) => r.k === "rebateAt")?.v).toBe("bei Verfall (Reiner–Rubinstein)");
    expect(rows("hit").find((r) => r.k === "rebateAt")?.label).toBe("Rebate-Zahlung");
  });
});
