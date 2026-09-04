/**
 * Round-8 library findings (docs/quality/review-ui-r8.md, review-markt-r8.md):
 * the register envelope of a snapshot (Markt R8-1 / R8-2), register-aware
 * currency options, the swaption branch of the quick entry (R8-F1),
 * context-aware repair hints (R8-06) and the CSV vocabulary of the API
 * (Markt R8-4).
 */
import { describe, expect, it } from "vitest";
import {
  type RateIndex,
  type Trade,
  SWAP_CONVENTIONS,
  getCalendar,
  isBusinessDay,
  knownCurrencies,
  knownIndices,
  parseISO,
  makeSwaption,
} from "@deriva/pricing-core";
import { CZK_ENVELOPE } from "../test/fixtures-r8.js";
import { buildCurrencyEnvelope, parseHolidayLines } from "../views/AddCurrencyForm.js";
import { translateCoreMessage, translateCoreMessageIn, translatePricingError } from "./i18n.js";
import { CSV_IMPORT_TEMPLATES, csvTemplateText, spreadOf, tradesFromCsv } from "./portfolio-io.js";
import { parseQuickEntry } from "./quick-parser.js";
import { currencyOptions } from "./register.js";
import {
  envelopeOf,
  envelopeSummary,
  envelopeWithout,
  exportEnvelope,
  isBuiltInCalendar,
  listCustomCalendars,
  mergeEnvelopes,
  plausibleEnvelope,
  registerEnvelope,
  unregisterEnvelope,
  validateEnvelope,
} from "./register-envelope.js";
import { readSnapshotJson } from "./snapshot-import.js";
import { swaptionUnderlyingIndex, swaptionWithUnderlyingIndex } from "./swaption.js";

const VAL = parseISO("2026-09-03");
const G5 = ["EUR", "USD", "GBP", "CHF", "JPY"];
const G5_CURVES = ["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "USD-SOFR", "GBP-SONIA", "CHF-SARON", "JPY-TONA"];

describe("Markt R8-1 / R8-2 – register envelope: validate, register, export, unregister", () => {
  it("rejects built-in indices and calendars, unknown calendars and dangling index references with German messages", () => {
    expect(validateEnvelope({ indices: [{ ...CZK_ENVELOPE.indices[0]!, name: "EURIBOR-6M" }] })).toMatch(/Index „EURIBOR-6M“ ist im Kern eingebaut/);
    expect(validateEnvelope({ calendars: [{ id: "TARGET", holidays: [] }] })).toMatch(/Kalender „TARGET“ ist im Kern eingebaut/);
    expect(validateEnvelope({ indices: [{ ...CZK_ENVELOPE.indices[0]!, fixingCalendar: "XX" }] })).toMatch(
      /Kalender „XX“ ist nicht registriert – im Envelope unter „calendars“/,
    );
    expect(validateEnvelope({ conventions: [{ ...CZK_ENVELOPE.conventions[0]!, calendar: "TARGET", oisIndex: "NOPE" }] })).toMatch(
      /oisIndex "NOPE" ist kein registrierter Index/,
    );
    expect(validateEnvelope({ conventions: [{ ...CZK_ENVELOPE.conventions[0]!, oisIndex: "NOPE" }] })).toMatch(/Kalender „CZ“ ist nicht registriert/);
    expect(validateEnvelope({ calendars: [{ id: "CZ", holidays: ["2027-13-01"] }] })).toMatch(
      /Kalender „CZ“: Feiertag Nr. 1 \("2027-13-01"\) ist kein gültiges Datum/,
    );
    expect(validateEnvelope({ calendars: [{ id: "CZ", holidays: ["Ostern"] }] })).toMatch(/Feiertag Nr. 1 \("Ostern"\) ist kein Datum JJJJ-MM-TT/);
    expect(validateEnvelope({ indices: "x" as unknown as RateIndex[] })).toMatch(/„indices“ muss eine Liste sein/);
    expect(validateEnvelope({ conventions: [{ ...CZK_ENVELOPE.conventions[0]!, calendar: "TARGET", floatIndex: "SOFR" }] })).toMatch(
      /floatIndex SOFR gehört zu USD, nicht zu CZK/,
    );
    // the full CZK envelope is fine – the CZ calendar is resolved from the envelope itself
    expect(validateEnvelope(CZK_ENVELOPE)).toBeUndefined();
    expect(isBuiltInCalendar("TARGET")).toBe(true);
    expect(isBuiltInCalendar("us-sifma")).toBe(true);
    expect(isBuiltInCalendar("CZ")).toBe(false);
    expect(envelopeSummary(CZK_ENVELOPE)).toBe("2 Indizes CZEONIA, PRIBOR-6M · Konventionen CZK · Kalender CZ");
  });

  it("readSnapshotJson checks the envelope shape and keeps it on the result", () => {
    const base = { schema: "deriva.market/1", valuationDate: "2026-09-03", discountCurveId: {}, curves: [], fxSpots: {} };
    expect(() => readSnapshotJson(JSON.stringify({ ...base, indices: {} }))).toThrow(/„indices“ muss eine Liste sein/);
    expect(() => readSnapshotJson(JSON.stringify({ ...base, indices: [{ ...CZK_ENVELOPE.indices[0], name: "SOFR" }] }))).toThrow(
      /„SOFR“ ist im Kern eingebaut/,
    );
    const ok = readSnapshotJson(JSON.stringify({ ...base, ...CZK_ENVELOPE }));
    expect(envelopeOf(ok).indices?.map((i) => i.name)).toEqual(["CZEONIA", "PRIBOR-6M"]);
    expect(ok.calendars?.[0]?.id).toBe("CZ");
  });

  it("registers calendars → indices → conventions, exports the same envelope and unregisters again", () => {
    expect(knownCurrencies()).not.toContain("CZK");
    const r = registerEnvelope(CZK_ENVELOPE);
    expect(r).toEqual({ ok: true, registered: { calendars: ["CZ"], indices: ["CZEONIA", "PRIBOR-6M"], conventions: ["CZK"] } });
    expect(knownCurrencies()).toContain("CZK");
    expect(knownIndices("CZK").map((i) => i.name)).toEqual(["CZEONIA", "PRIBOR-6M"]);
    expect(SWAP_CONVENTIONS.CZK?.calendar).toBe("CZ");
    // the Prague calendar works: 6 July 2027 (Jan Hus) is a holiday, 7 July a business day
    expect(isBusinessDay(parseISO("2027-07-06"), getCalendar("CZ"))).toBe(false);
    expect(isBusinessDay(parseISO("2027-07-07"), getCalendar("CZ"))).toBe(true);
    expect(listCustomCalendars().map((c) => c.id)).toContain("CZ");
    const out = exportEnvelope();
    expect(out.indices?.map((i) => i.name)).toEqual(expect.arrayContaining(["CZEONIA", "PRIBOR-6M"]));
    expect(out.indices?.some((i) => i.name === "EURIBOR-6M")).toBe(false); // built-ins never travel
    expect(out.conventions?.map((c) => c.currency)).toEqual(["CZK"]);
    expect(out.calendars?.[0]).toMatchObject({ id: "CZ", name: "Prag", holidays: ["2027-07-05", "2027-07-06", "2027-09-28", "2027-10-28", "2027-11-17"] });
    // registering the same envelope again is idempotent (reload / undo paths)
    expect(registerEnvelope(CZK_ENVELOPE).ok).toBe(true);
    // a built-in index name inside an otherwise valid envelope is refused before anything is registered
    expect(registerEnvelope({ indices: [{ ...CZK_ENVELOPE.indices[0]!, name: "SONIA" }] })).toMatchObject({ ok: false, error: /SONIA/ });
    unregisterEnvelope(CZK_ENVELOPE);
    expect(knownCurrencies()).not.toContain("CZK");
    expect(knownIndices("CZK")).toEqual([]);
    expect(exportEnvelope().conventions).toBeUndefined();
    // built-ins survive an unregister attempt
    unregisterEnvelope({ indices: [{ ...CZK_ENVELOPE.indices[0]!, name: "ESTR" }], conventions: [{ ...CZK_ENVELOPE.conventions[0]!, currency: "EUR" }] });
    expect(knownCurrencies()).toContain("EUR");
    expect(knownIndices("EUR").some((i) => i.name === "ESTR")).toBe(true);
  });

  it("envelope helpers: merge, without, plausible", () => {
    const merged = mergeEnvelopes(
      { indices: [CZK_ENVELOPE.indices[0]!] },
      { indices: [{ ...CZK_ENVELOPE.indices[0]!, fixingLag: 1 }, CZK_ENVELOPE.indices[1]!] },
    );
    expect(merged.indices?.map((i) => `${i.name}:${i.fixingLag}`)).toEqual(["CZEONIA:1", "PRIBOR-6M:2"]);
    expect(envelopeWithout(CZK_ENVELOPE, { indices: [CZK_ENVELOPE.indices[1]!], calendars: CZK_ENVELOPE.calendars }).indices?.map((i) => i.name)).toEqual([
      "CZEONIA",
    ]);
    expect(envelopeWithout(CZK_ENVELOPE, { indices: [CZK_ENVELOPE.indices[1]!], calendars: CZK_ENVELOPE.calendars }).calendars).toBeUndefined();
    expect(plausibleEnvelope({ indices: [{ name: "X" }, { nope: 1 }], conventions: "bad", calendars: [{ id: "CZ", holidays: [] }] })).toEqual({
      calendars: [{ id: "CZ", holidays: [] }],
    });
    expect(plausibleEnvelope(null)).toEqual({});
  });

  it("the '+ Währung' form builds the same envelope shape the API accepts; holiday lines accept ISO and German dates", () => {
    expect(parseHolidayLines("2027-07-06\n28.09.2027\n\n2027-07-06")).toEqual({ holidays: ["2027-07-06", "2027-09-28"] });
    expect(parseHolidayLines("Ostern").error).toMatch(/Feiertag „Ostern“ nicht lesbar/);
    const env = buildCurrencyEnvelope({
      currency: "huf",
      calendar: "TARGET",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      spotLag: 2,
      ois: { name: "hufonia", dayCount: "ACT/360", fixingLag: 0, paymentLag: 1 },
      ibor: { name: "bubor-6m", tenor: "6M", dayCount: "ACT/360", fixingLag: 2 },
    });
    expect(env.indices?.map((i) => [i.name, i.type, i.tenor, i.curveId])).toEqual([
      ["HUFONIA", "OIS", "1D", "HUF-HUFONIA"],
      ["BUBOR-6M", "IBOR", "6M", "HUF-BUBOR-6M"],
    ]);
    expect(env.conventions?.[0]).toMatchObject({
      currency: "HUF",
      floatIndex: "BUBOR-6M",
      floatFrequency: "6M",
      oisIndex: "HUFONIA",
      oisPaymentLag: 1,
      calendar: "TARGET",
    });
    expect(validateEnvelope(env)).toBeUndefined();
    // OIS only: the OIS index is the float benchmark
    const oisOnly = buildCurrencyEnvelope({
      currency: "HUF",
      calendar: "TARGET",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      spotLag: 2,
      ois: { name: "HUFONIA", dayCount: "ACT/360", fixingLag: 0, paymentLag: 1 },
    });
    expect(oisOnly.conventions?.[0]).toMatchObject({ floatIndex: "HUFONIA", floatFrequency: "1Y" });
    // with a new calendar the envelope carries it and every index refers to it
    const withCal = buildCurrencyEnvelope({
      currency: "HUF",
      calendar: "TARGET",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      spotLag: 2,
      ois: { name: "HUFONIA", dayCount: "ACT/360", fixingLag: 0, paymentLag: 1 },
      customCalendar: { id: "hu", name: "Budapest", holidays: ["2027-03-15"] },
    });
    expect(withCal.calendars?.[0]?.id).toBe("hu");
    expect(withCal.indices?.[0]?.fixingCalendar).toBe("HU");
    expect(validateEnvelope(withCal)).toBeUndefined();
  });
});

describe("Markt R8-1 – currency options know the register", () => {
  it("a currency with a discount curve but without conventions is '(nicht registriert)' and disabled", () => {
    const opts = currencyOptions({ EUR: "EUR-ESTR", CZK: "CZK-CZEONIA" }, "EUR");
    expect(opts.find((o) => o.v === "CZK")).toEqual({ v: "CZK", l: "CZK (nicht registriert)", disabled: true });
    expect(opts.find((o) => o.v === "EUR")).toEqual({ v: "EUR", l: "EUR" });
    // the current value stays selectable even when unregistered
    expect(currencyOptions({ CZK: "CZK-CZEONIA" }, "CZK").find((o) => o.v === "CZK")).toEqual({ v: "CZK", l: "CZK (nicht registriert)", disabled: false });
    expect(currencyOptions({}, "HUF").find((o) => o.v === "HUF")?.l).toBe("HUF (nicht registriert)");
  });
});

describe("R8-F1 – the swaption branch follows the curve-backed index", () => {
  const dkkOisOnly = { curveCurrencies: [...G5, "DKK"], curveIds: [...G5_CURVES, "DKK-DESTR"], swaptionVolCurrencies: [...G5, "DKK"] };
  const underlying = (t: Trade | undefined) => (t?.type === "Swaption" ? swaptionUnderlyingIndex(t) : undefined);

  it("'swpt dkk …' after '+ Kurve' DKK-DESTR projects DESTR and says so in the preview", () => {
    const r = parseQuickEntry("swpt dkk 1y5y payer 3% 10m", VAL, dkkOisOnly);
    expect(r.ok).toBe(true);
    expect(underlying(r.trade)).toBe("DESTR");
    expect(r.description).toMatch(/· Underlying DESTR \(Kurve vorhanden; CIBOR-6M ohne Kurve\)/);
    expect(r.description).not.toMatch(/⚠/);
    // the conventions win as soon as their curve exists – no note
    const both = parseQuickEntry("swpt dkk 1y5y payer 3% 10m", VAL, { ...dkkOisOnly, curveIds: [...dkkOisOnly.curveIds, "DKK-CIBOR-6M"] });
    expect(underlying(both.trade)).toBe("CIBOR-6M");
    expect(both.description).not.toMatch(/Underlying/);
    // no curve for any DKK index → refused with the remedy
    const none = parseQuickEntry("swpt dkk 1y5y payer 3% 10m", VAL, { ...dkkOisOnly, curveIds: G5_CURVES });
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/„\+ Kurve“/);
    // EUR unchanged: EURIBOR-6M without note
    const eur = parseQuickEntry("swpt 1y5y payer 3% 10m", VAL, dkkOisOnly);
    expect(underlying(eur.trade)).toBe("EURIBOR-6M");
    expect(eur.description).toBe("Payer-Swaption EUR 1Yx5Y @ 3,000 % · Nominal 10.000.000");
  });

  it("swaptionWithUnderlyingIndex rebuilds the float leg with the index conventions and keeps everything else", () => {
    const base = makeSwaption({
      id: "S1",
      currency: "DKK",
      notional: 5e6,
      payerReceiver: "Receiver",
      strike: 0.025,
      expiry: "2Y",
      tenor: "5Y",
      valuationDate: VAL,
      settlement: "Cash",
    });
    expect(swaptionUnderlyingIndex(base)).toBe("CIBOR-6M");
    const destr = swaptionWithUnderlyingIndex(base, "DESTR");
    expect(swaptionUnderlyingIndex(destr)).toBe("DESTR");
    const fixedBefore = base.underlying.legs.find((l) => l.type === "Fixed")!;
    const fixedAfter = destr.underlying.legs.find((l) => l.type === "Fixed")!;
    expect([fixedAfter.effectiveDate, fixedAfter.terminationDate, fixedAfter.notional, fixedAfter.payReceive]).toEqual([
      fixedBefore.effectiveDate,
      fixedBefore.terminationDate,
      fixedBefore.notional,
      fixedBefore.payReceive,
    ]);
    expect(destr.underlying.id).toBe(base.underlying.id);
    expect(destr.settlement).toBe("Cash");
    expect(swaptionWithUnderlyingIndex(base, undefined)).toBe(base);
    expect(swaptionWithUnderlyingIndex(base, "CIBOR-6M")).toBe(base);
  });
});

describe("R8-06 – repair hints follow the market source and the product", () => {
  it("sample mode names '+ Kurve', import mode the snapshot and 'Zum Sample-Markt', swaptions the Underlying-Index field", () => {
    expect(translateCoreMessage("No discount curve configured for DKK")).toBe(
      "Keine Diskontkurve für DKK konfiguriert – in der Kurvenansicht mit „+ Kurve“ eine DKK-Kurve anlegen",
    );
    expect(translateCoreMessageIn("No discount curve configured for DKK", { marketSource: "import" })).toBe(
      "Keine Diskontkurve für DKK konfiguriert – der importierte Snapshot enthält keine DKK-Kurve – Snapshot mit Kurve importieren oder „Zum Sample-Markt“ wechseln",
    );
    expect(translateCoreMessageIn("Curve not found in market context: DKK-CIBOR-6M", { marketSource: "import" })).toBe(
      "Kurve DKK-CIBOR-6M nicht im Markt-Snapshot – der importierte Snapshot enthält keine DKK-Kurve – Snapshot mit Kurve importieren oder „Zum Sample-Markt“ wechseln",
    );
    expect(translateCoreMessageIn("Curve not found in market context: DKK-CIBOR-6M", { marketSource: "sample", tradeType: "Swaption" })).toBe(
      "Kurve DKK-CIBOR-6M nicht im Markt-Snapshot – in der Kurvenansicht mit „+ Kurve“ anlegen oder im Editor den Underlying-Index wechseln",
    );
    expect(translateCoreMessageIn("Curve not found in market context: DKK-CIBOR-6M", { marketSource: "sample", tradeType: "InterestRateSwap" })).not.toMatch(
      /Underlying/,
    );
    // other messages are untouched by the context
    expect(translateCoreMessageIn("FX spot not available for DKKEUR", { marketSource: "import" })).toMatch(/„\+ Paar“/);
    // register errors of the core are German
    expect(translatePricingError(new Error('registerRateIndex(CZEONIA): unknown calendar "CZ" (register it with registerCalendar first)'))).toBe(
      'CZEONIA: unbekannter Kalender "CZ" – im Envelope unter „calendars“ mitliefern oder mit „+ Kalender“ anlegen',
    );
    expect(translateCoreMessage('registerSwapConventions(CZK): oisIndex "CZEONIA" is not a registered index (registerRateIndex first)')).toBe(
      'CZK: oisIndex "CZEONIA" ist kein registrierter Index – zuerst registrieren („indices“ / „+ Währung“)',
    );
  });
});

/** The API's `CSV_TEMPLATES` example rows (apps/api/src/lib/csv-import.ts) with the `type` column the workstation needs. */
const API_ROWS: Record<string, [string, string]> = {
  IRS: [
    "type;currency;notional;payReceive;fixedRate;effectiveDate;maturity;id;name;counterparty;book;uti;index;spread;fixedFrequency;floatFrequency;collateralCurrency;stepUp",
    "IRS;EUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS-CSV-1;Payer-Swap Kredit A;CPTY-A;Treasury;;EURIBOR-6M;;1Y;6M;;",
  ],
  FXF: ["type;pair;baseAmount;rate;deliveryDate;id;name;counterparty;book;uti", "FXF;EURUSD;-2.000.000;1,1725;2027-03-15;FXF-CSV-1;;CPTY-B;;"],
  CAP: [
    "type;currency;notional;capFloor;strike;effectiveDate;maturity;id;name;counterparty;book;uti;floorStrike;index;longShort",
    "CAP;EUR;8.000.000;Cap;3,00 %;2026-09-07;5Y;CAP-CSV-1;;CPTY-A;;;;EURIBOR-6M;Long",
  ],
  SWPT: [
    "type;currency;notional;payerReceiver;strike;expiry;tenor;id;name;counterparty;book;uti;settlement;longShort",
    "SWPT;EUR;10.000.000;Payer;3,00 %;1Y;5Y;SWPT-CSV-1;;CPTY-A;;;Physical;Long",
  ],
  FXO: [
    "type;pair;optionType;notional;strike;expiryDate;id;name;counterparty;book;uti;deliveryDate;longShort;barrierType;barrierLevel;barrierRebate;barrierHit",
    "FXO;EURUSD;Put;3.000.000;1,15;2027-06-15;FXO-CSV-1;;CPTY-A;;;;Long;;;;",
  ],
  CCS: [
    "type;pair;domesticNotional;effectiveDate;tenor;id;name;counterparty;book;uti;fxSpot;foreignNotional;spread;fixedRate;domesticPayReceive;frequency;collateralCurrency",
    "CCS;EURUSD;10.000.000;2026-09-07;5Y;CCS-CSV-1;;CPTY-A;;;1,17;;-20 bp;;Receive;3M;",
  ],
  FRA: [
    "type;currency;notional;payReceive;start;rate;id;name;counterparty;book;uti;index;end;collateralCurrency",
    "FRA;EUR;5.000.000;Pay;3x9;2,20 %;FRA-CSV-1;;CPTY-B;;;EURIBOR-6M;;",
  ],
  FXS: [
    "type;pair;baseAmount;nearRate;farRate;nearDate;farDate;id;name;counterparty;book;uti",
    "FXS;EURUSD;5.000.000;1,1625;1,1690;2026-09-07;2027-03-08;FXS-CSV-1;;CPTY-B;;",
  ],
  BASIS: [
    "type;currency;notional;receiveIndex;payIndex;spread;effectiveDate;maturity;id;name;counterparty;book;uti",
    "BASIS;EUR;10.000.000;EURIBOR-6M;EURIBOR-3M;12 bp;2026-09-07;5Y;BASIS-CSV-1;;CPTY-A;;",
  ],
  AMORT: [
    "type;currency;notional;payReceive;fixedRate;effectiveDate;maturity;id;name;counterparty;book;uti;finalNotional;index;spread;fixedFrequency;floatFrequency;collateralCurrency;stepUp",
    "AMORT;EUR;10.000.000;Pay;3,00 %;2026-09-07;10Y;AMORT-CSV-1;;CPTY-A;;;2.000.000;EURIBOR-6M;;1Y;6M;;",
  ],
  IMM: [
    "type;currency;notional;payReceive;fixedRate;tenor;id;name;counterparty;book;uti;from;index;spread;fixedFrequency;floatFrequency;collateralCurrency;stepUp",
    "IMM;EUR;10.000.000;Pay;3,00 %;2Y;IMM-CSV-1;;CPTY-A;;;;EURIBOR-6M;;;;;",
  ],
};

describe("Markt R8-4 – CSV vocabulary of the API imports in the workstation; templates write the bp unit", () => {
  it("the CCS and BASIS templates write an explicit `bp` suffix and still import", () => {
    expect(CSV_IMPORT_TEMPLATES.CCS.example[7]).toBe("-20 bp");
    expect(CSV_IMPORT_TEMPLATES.BASIS.example[9]).toBe("5 bp");
    const ccs = tradesFromCsv(csvTemplateText("CCS"), { valuationDate: VAL });
    expect(ccs.errors).toEqual([]);
    const t = ccs.trades[0] as Extract<Trade, { type: "CrossCurrencySwap" }>;
    expect(t.legs.find((l) => l.type === "Float" && l.currency === "EUR")).toMatchObject({ spread: -0.002 });
    const basis = tradesFromCsv(csvTemplateText("BASIS"), { valuationDate: VAL });
    expect(basis.errors).toEqual([]);
    expect((basis.trades[0] as Extract<Trade, { type: "InterestRateSwap" }>).legs[0]).toMatchObject({ spread: 0.0005 });
    // every template's own example row still imports
    for (const type of Object.keys(CSV_IMPORT_TEMPLATES) as (keyof typeof CSV_IMPORT_TEMPLATES)[]) {
      const r = tradesFromCsv(csvTemplateText(type), { valuationDate: VAL });
      expect(r.errors, type).toEqual([]);
      expect(r.trades, type).toHaveLength(1);
    }
  });

  it("spreadOf reads `bp`, `%`, decimals and the bare-number heuristic", () => {
    expect(spreadOf("-20 bp")).toBeCloseTo(-0.002, 12);
    expect(spreadOf("12bp")).toBeCloseTo(0.0012, 12);
    expect(spreadOf("0,05 %")).toBeCloseTo(0.0005, 12);
    expect(spreadOf("-0,002")).toBeCloseTo(-0.002, 12);
    expect(spreadOf("5")).toBeCloseTo(0.0005, 12);
    expect(spreadOf("")).toBeUndefined();
  });

  it("the API example rows of all eleven templates import in the web builder", () => {
    for (const [type, [head, row]] of Object.entries(API_ROWS)) {
      const r = tradesFromCsv(`${head}\n${row}\n`, { valuationDate: VAL });
      expect(r.errors, type).toEqual([]);
      expect(r.trades, type).toHaveLength(1);
      expect(r.trades[0]!.id, type).toBe(`${type}-CSV-1`);
    }
    // vocabulary details: FXF pair / baseAmount / rate → sell 2 m EUR against 2,345 m USD
    const fxf = tradesFromCsv(`${API_ROWS.FXF![0]}\n${API_ROWS.FXF![1]}\n`, { valuationDate: VAL }).trades[0] as Extract<Trade, { type: "FxForward" }>;
    expect(fxf.sellCurrency).toBe("EUR");
    expect(fxf.sellAmount).toBe(2_000_000);
    expect(fxf.buyCurrency).toBe("USD");
    expect(fxf.buyAmount).toBeCloseTo(2_345_000, 6);
    // CCS: `tenor` as maturity, `-20 bp`, `domesticPayReceive`
    const ccs = tradesFromCsv(`${API_ROWS.CCS![0]}\n${API_ROWS.CCS![1]}\n`, { valuationDate: VAL }).trades[0] as Extract<Trade, { type: "CrossCurrencySwap" }>;
    expect(ccs.legs.find((l) => l.currency === "EUR")).toMatchObject({ payReceive: "Receive", spread: -0.002 });
    // FRA: `start` carries the period, `end` is the maturity alias
    const fra = tradesFromCsv(`${API_ROWS.FRA![0]}\n${API_ROWS.FRA![1]}\n`, { valuationDate: VAL }).trades[0] as Extract<Trade, { type: "FRA" }>;
    expect(fra.index).toBe("EURIBOR-6M");
    expect(fra.endDate - fra.startDate).toBeGreaterThan(170);
    // SWPT: `payerReceiver`; FXO: `expiryDate`
    const swpt = tradesFromCsv(`${API_ROWS.SWPT![0]}\n${API_ROWS.SWPT![1]}\n`, { valuationDate: VAL }).trades[0] as Extract<Trade, { type: "Swaption" }>;
    expect(swpt.payerReceiver).toBe("Payer");
    const fxo = tradesFromCsv(`${API_ROWS.FXO![0]}\n${API_ROWS.FXO![1]}\n`, { valuationDate: VAL }).trades[0] as Extract<Trade, { type: "FxOption" }>;
    expect(fxo.expiryDate).toBe(parseISO("2027-06-15"));
    expect(fxo.optionType).toBe("Put");
    // a positive baseAmount buys the base currency
    const buy = tradesFromCsv("type;pair;baseAmount;rate;deliveryDate\nFXF;EURUSD;1000000;1,17;2027-03-15\n", { valuationDate: VAL }).trades[0] as Extract<
      Trade,
      { type: "FxForward" }
    >;
    expect([buy.buyCurrency, buy.buyAmount, buy.sellCurrency]).toEqual(["EUR", 1_000_000, "USD"]);
    expect(buy.sellAmount).toBeCloseTo(1_170_000, 6);
  });
});
