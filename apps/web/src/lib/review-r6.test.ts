/** Regression tests for the round-6 review findings (docs/quality/review-*-r6.md) – parser, CSV, i18n, lazy helpers. */
import { describe, expect, it } from "vitest";
import { type Trade, knownCurrencies as coreKnownCurrencies, parseISO, toISO } from "@deriva/pricing-core";
import { CASHFLOW_KIND_DE, PRICING_ERROR_CODES_DE, WARNING_PREFIXES_DE, legTypeLabel, translateCoreMessage } from "./i18n.js";
import { CHUNK_ERROR_TEXT, chunkUrlOf, isChunkLoadError } from "./lazy.js";
import { CSV_IMPORT_TEMPLATES, CSV_TRADE_TYPES, csvTemplateText, stepUpOf, tradesFromCsv } from "./portfolio-io.js";
import { QUICK_ENTRY_EXAMPLES, isGrammarToken, knownCurrencies, parseQuickEntry, unknownTokenError } from "./quick-parser.js";

const VAL = parseISO("2026-09-03");
const G5 = ["EUR", "USD", "GBP", "CHF", "JPY"];
const opts = { fxSpots: { EURUSD: 1.1625, EURNOK: 11.5 }, curveCurrencies: G5 };

describe("Markt R6-1 – the quick entry never swallows a token", () => {
  it("an unknown currency is an error in every rate branch instead of a silent EUR trade", () => {
    for (const cmd of [
      "irs xyz 5y pay 3% 10m",
      "ois xyz 2y pay 2% 10m",
      "amort xyz 5y pay 3% 10m",
      "imm xyz 2y pay 3% 10m",
      "cap xyz 5y 3% 10m",
      "collar xyz 7y 3.5/1.5 6m",
      "swpt xyz 1y5y payer 3% 10m",
      "fra xyz 3x6 pay 2% 10m",
      "basis xyz 5y 3m/6m 5bp 10m",
    ]) {
      const r = parseQuickEntry(cmd, VAL, opts);
      expect(r.ok, cmd).toBe(false);
      expect(r.error, cmd).toMatch(/Unbekannte Währung „XYZ“ – Währungen: /);
      expect(r.error, cmd).toMatch(/erwartet: /);
    }
  });
  it("a known currency without a curve in the market names the '+ Kurve' remedy; with a curve the trade is built in that currency", () => {
    expect(coreKnownCurrencies()).toEqual(expect.arrayContaining(["NOK", "SEK", "DKK", "PLN", ...G5]));
    expect(knownCurrencies()).toEqual(expect.arrayContaining(["NOK", "SEK", "DKK", "PLN"]));
    const noCurve = parseQuickEntry("irs sek 5y pay 3% 10m", VAL, opts);
    expect(noCurve.ok).toBe(false);
    expect(noCurve.error).toMatch(/Keine Kurve für SEK im Markt – .*„\+ Kurve“/);
    const withCurve = parseQuickEntry("irs nok 5y pay 3% 10m", VAL, { ...opts, curveCurrencies: [...G5, "NOK"] });
    expect(withCurve.ok).toBe(true);
    expect(withCurve.trade?.type).toBe("InterestRateSwap");
    if (withCurve.trade?.type === "InterestRateSwap") {
      expect(withCurve.trade.legs[0]!.currency).toBe("NOK");
      expect((withCurve.trade.legs[1] as { index: string }).index).toBe("NIBOR-6M");
    }
    expect(withCurve.description).toMatch(/Payer-Swap NOK 5Y/);
    // without the market option (unit-level callers) known currencies parse
    expect(parseQuickEntry("cap nok 5y 3% 10m", VAL).ok).toBe(true);
  });
  it("unknown modifiers are errors: mtm on a swap, ndf on an option, foo on a CCS, a lone 'barrier'", () => {
    expect(parseQuickEntry("irs 10y pay 3.1% 10m mtm", VAL, opts).error).toMatch(/Unbekanntes Token „mtm“/);
    expect(parseQuickEntry("ccs eurusd 5y -20bp 10m foo", VAL, opts).error).toMatch(/Unbekanntes Token „foo“/);
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m ndf", VAL, opts).error).toMatch(/Unbekanntes Token „ndf“/);
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m barrier 1.05", VAL, opts).error).toMatch(/Barriere unvollständig/);
    expect(parseQuickEntry("fxf eurusd 2m 1.1725 6m mtm", VAL, opts).error).toMatch(/Unbekanntes Token „mtm“/);
    expect(parseQuickEntry("fxs eurusd 1m 1.1625 1.18 1y bla", VAL, opts).error).toMatch(/Unbekanntes Token „bla“/);
    // a 3-letter word in a branch that takes a currency is reported as an unknown currency
    expect(parseQuickEntry("basis 5y 3m/6m 5bp 10m foo", VAL, opts).error).toMatch(/Unbekannte Währung „FOO“/);
    expect(parseQuickEntry("basis 5y 3m/6m 5bp 10m hallo", VAL, opts).error).toMatch(/Unbekanntes Token „hallo“/);
    expect(unknownTokenError("xyz", "irs [ccy] …")).toMatch(/^Unbekannte Währung „XYZ“/);
    expect(unknownTokenError("xyz", "ccs <pair> …")).toMatch(/^Unbekanntes Token „xyz“/);
    expect(unknownTokenError("hello", "irs [ccy] …")).toMatch(/^Unbekanntes Token „hello“/);
  });
  it("a second amount, rate or date is reported instead of overriding the first", () => {
    expect(parseQuickEntry("irs 10y pay 3.1% 10m 6m", VAL, opts).error).toMatch(/Betrag doppelt angegeben \(„10m“ und „6m“\)/);
    expect(parseQuickEntry("irs 10y pay 3.1% 2.9% 10m", VAL, opts).error).toMatch(/Satz doppelt angegeben/);
    expect(parseQuickEntry("cap 5y 3% 2% 8m", VAL, opts).error).toMatch(/Satz doppelt angegeben/);
    expect(parseQuickEntry("fxf eurusd 2m 1m 1.1725 6m", VAL, opts).error).toMatch(/doppelt angegeben/);
    expect(parseQuickEntry("fxf eurusd 2m 500k 1.1725 15.03.2027", VAL, opts).error).toMatch(/Betrag doppelt angegeben \(„2m“ und „500k“\)/);
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m 6m", VAL, opts).error).toMatch(/Betrag oder Laufzeit doppelt angegeben/);
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m 15.03.2027", VAL, opts).error).toMatch(/Datum doppelt angegeben/);
    // the legitimate example still parses to a 10m notional
    const r = parseQuickEntry("irs 10y pay 3.1% 10m", VAL, opts);
    expect(r.ok).toBe(true);
    if (r.trade?.type === "InterestRateSwap") expect(r.trade.legs[0]!.notional).toBe(10_000_000);
  });
  it("new grammar: imm command, swaption cash/physical, fxf ndf, fxo barrier", () => {
    const imm = parseQuickEntry("imm 2y pay 3% 10m", VAL, opts);
    expect(imm.ok).toBe(true);
    expect(imm.trade?.type).toBe("InterestRateSwap");
    if (imm.trade?.type === "InterestRateSwap") {
      expect(imm.trade.legs[0]!.roll).toBe("IMM");
      expect(toISO(imm.trade.legs[0]!.effectiveDate)).toBe("2026-09-16");
    }
    expect(imm.description).toMatch(/IMM-Payer-Swap EUR 2Y .* IMM ab 16\.09\.2026/);
    const cash = parseQuickEntry("swpt usd 1y5y payer 3.5% 10m cash", VAL, opts);
    expect(cash.ok).toBe(true);
    expect((cash.trade as { settlement?: string }).settlement).toBe("Cash");
    expect(cash.description).toMatch(/Barausgleich/);
    expect((parseQuickEntry("swpt 1y5y rec 3% 10m physical", VAL, opts).trade as { settlement?: string }).settlement).toBe("Physical");
    const ndf = parseQuickEntry("fxf eurusd 2m 1.1725 6m ndf", VAL, opts);
    expect(ndf.ok).toBe(true);
    expect((ndf.trade as { ndf?: { settlementCurrency: string } }).ndf?.settlementCurrency).toBe("USD");
    expect(ndf.description).toMatch(/NDF/);
    const bar = parseQuickEntry("fxo eurusd put 1.15 3m 9m barrier do 1.05", VAL, opts);
    expect(bar.ok).toBe(true);
    expect((bar.trade as { barrier?: { type: string; level: number } }).barrier).toEqual({ type: "DownOut", level: 1.05 });
    expect(bar.description).toMatch(/Barriere Down-and-Out 1,0500/);
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m barrier up-in 1.25", VAL, opts).ok).toBe(true);
    // a barrier far off the spot is rejected like an implausible strike
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m barrier do 9.5", VAL, opts).error).toMatch(/^Barriere 9,5000 passt nicht zum Spot/);
    // grammar tokens end a counterparty phrase
    expect(isGrammarToken("cash")).toBe(true);
    expect(isGrammarToken("nok")).toBe(true);
    expect(isGrammarToken("barrier")).toBe(true);
    for (const ex of QUICK_ENTRY_EXAMPLES) expect(parseQuickEntry(ex, VAL, opts).ok, ex).toBe(true);
    expect(QUICK_ENTRY_EXAMPLES).toContain("imm 2y pay 3% 10m");
  });
});

describe("Markt R6-2 – CSV templates for FX swap, basis swap, amortising swap and IMM swap; step-up column", () => {
  it("every template parses its own example row into a trade of the right type", () => {
    expect(CSV_TRADE_TYPES).toEqual(expect.arrayContaining(["FXS", "BASIS", "AMORT", "IMM"]));
    const expected: Record<string, Trade["type"]> = {
      FXS: "FxSwap",
      BASIS: "InterestRateSwap",
      AMORT: "InterestRateSwap",
      IMM: "InterestRateSwap",
      IRS: "InterestRateSwap",
    };
    for (const type of ["FXS", "BASIS", "AMORT", "IMM", "IRS"] as const) {
      const res = tradesFromCsv(csvTemplateText(type), { valuationDate: VAL, fxSpots: { EURUSD: 1.1625 } });
      expect(res.errors, type).toEqual([]);
      expect(res.trades, type).toHaveLength(1);
      expect(res.trades[0]!.type, type).toBe(expected[type]);
      expect(res.trades[0]!.id).toBe(CSV_IMPORT_TEMPLATES[type].example[1]);
    }
  });
  it("FXS: near/far legs and dates; BASIS: indices and spread in bp; AMORT: linear and annuity schedules; IMM: IMM roll", () => {
    const fxs = tradesFromCsv("type;id;pair;baseAmount;nearRate;farRate;nearDate;farDate\nFXS;X1;EURUSD;1000000;1,1625;1,18;2026-09-07;1Y", {
      valuationDate: VAL,
    }).trades[0]!;
    expect(fxs.type).toBe("FxSwap");
    if (fxs.type === "FxSwap") {
      expect(fxs.nearLeg.buyCurrency).toBe("EUR");
      expect(fxs.farLeg.sellCurrency).toBe("EUR");
      expect(fxs.farLeg.deliveryDate).toBeGreaterThan(fxs.nearLeg.deliveryDate);
    }
    expect(
      tradesFromCsv("type;id;pair;baseAmount;nearRate;farRate;farDate\nFXS;X2;EURUSD;1000000;1,16;1,17;2026-01-01", { valuationDate: VAL }).errors[0]!.msg,
    ).toMatch(/Far-Valuta muss nach der Near-Valuta liegen/);
    const basis = tradesFromCsv("Typ;ID;Währung;Nominal;Index erhalten;Index zahlen;Spread;Laufzeit\nBASIS;B1;EUR;10000000;EURIBOR-3M;EURIBOR-6M;5;5Y", {
      valuationDate: VAL,
    }).trades[0]!;
    expect(basis.type).toBe("InterestRateSwap");
    if (basis.type === "InterestRateSwap") {
      const rec = basis.legs.find((l) => l.payReceive === "Receive") as { index: string; spread?: number };
      expect(rec.index).toBe("EURIBOR-3M");
      expect(rec.spread).toBeCloseTo(0.0005, 12);
    }
    expect(
      tradesFromCsv("type;id;notional;receiveIndex;payIndex;maturity\nBASIS;B2;1m;EURIBOR-6M;EURIBOR-6M;5Y", { valuationDate: VAL }).errors[0]!.msg,
    ).toMatch(/müssen sich unterscheiden/);
    const lin = tradesFromCsv("type;id;currency;notional;finalNotional;amortisation;direction;rate;maturity\nAMORT;A1;EUR;10000000;2000000;Linear;Pay;3 %;5Y", {
      valuationDate: VAL,
    }).trades[0]!;
    const ann = tradesFromCsv("type;id;currency;notional;restschuld;tilgung;direction;rate;maturity\nAMORT;A2;EUR;10000000;0;Annuität;Pay;3 %;5Y", {
      valuationDate: VAL,
    }).trades[0]!;
    if (lin.type === "InterestRateSwap" && ann.type === "InterestRateSwap") {
      const linSched = lin.legs[0]!.notionalSchedule!;
      const annSched = ann.legs[0]!.notionalSchedule!;
      expect(linSched[0]!.notional).toBe(10_000_000);
      expect(linSched.at(-1)!.notional).toBeGreaterThan(2_000_000 - 1);
      expect(linSched.at(-1)!.notional).toBeLessThan(10_000_000);
      // annuity: the balance falls slower at the start than linear
      expect(annSched[1]!.notional).toBeGreaterThan(linSched[1]!.notional - 2_000_000 / linSched.length);
      expect(annSched.length).toBe(linSched.length);
    }
    expect(tradesFromCsv("type;id;notional;finalNotional;rate;maturity\nAMORT;A3;1m;2m;3 %;5Y", { valuationDate: VAL }).errors[0]!.msg).toMatch(/Restschuld/);
    expect(tradesFromCsv("type;id;notional;amortisation;rate;maturity\nAMORT;A4;1m;Ballon;3 %;5Y", { valuationDate: VAL }).errors[0]!.msg).toMatch(
      /Tilgungsprofil „Ballon“ unbekannt/,
    );
    const imm = tradesFromCsv("type;id;currency;notional;direction;rate;from;tenor\nIMM;I1;EUR;10000000;Pay;3 %;2026-09-07;2Y", { valuationDate: VAL })
      .trades[0]!;
    if (imm.type === "InterestRateSwap") {
      expect(imm.legs[0]!.roll).toBe("IMM");
      expect(toISO(imm.legs[0]!.effectiveDate)).toBe("2026-09-16");
    }
    expect(tradesFromCsv("type;id;notional;rate;tenor\nIMM;I2;1m;3 %;18D", { valuationDate: VAL }).errors[0]!.msg).toMatch(/Tenor in Monaten oder Jahren/);
  });
  it("IRS step-up column becomes a rate schedule on the fixed leg; malformed steps are row errors", () => {
    const res = tradesFromCsv("type;id;notional;rate;start;maturity;stepUp\nIRS;S1;10m;3 %;2026-09-07;5Y;2027-09-07:3,3 %|2028-09-07:3,5 %", {
      valuationDate: VAL,
    });
    expect(res.errors).toEqual([]);
    const t = res.trades[0]!;
    if (t.type === "InterestRateSwap") {
      const fixed = t.legs[0] as { rateSchedule?: { date: number; rate: number }[] };
      // the core keeps the initial coupon as the first schedule entry, the two steps follow
      const steps = fixed.rateSchedule!.filter((x) => x.rate > 0.031);
      expect(steps).toHaveLength(2);
      expect(steps[0]!.rate).toBeCloseTo(0.033, 12);
      expect(toISO(steps[1]!.date)).toBe("2028-09-07");
    }
    expect(stepUpOf("", VAL)).toBeUndefined();
    expect(() => stepUpOf("2027-09-07", VAL)).toThrow(/Zinsstaffel .* nicht lesbar/);
    expect(() => stepUpOf("31.02.2027:3 %", VAL)).toThrow(/Ungültiges Datum „31\.02\.2027“ in Spalte „stepUp“/);
  });
});

describe("Markt R6 / API alignment – FX-option barrier columns and swap column aliases", () => {
  it("barrierType / barrierLevel / barrierRebate / barrierHit build the barrier (hit ja/nein, empty = unknown); payReceive / fixedRate aliases", () => {
    const res = tradesFromCsv(
      "type;id;pair;optionType;notional;strike;expiry;barrierType;barrierLevel;barrierRebate;barrierHit\nFXO;O1;EURUSD;Put;1000000;1,15;2027-06-15;DownOut;1,05;5000;nein\nFXO;O2;EURUSD;Call;1000000;1,20;2027-06-15;up-and-in;1,25;;ja\nFXO;O3;EURUSD;Call;1000000;1,20;2027-06-15;;;;\nFXO;O4;EURUSD;Call;1000000;1,20;2027-06-15;Ballon;1,25;;\nFXO;O5;EURUSD;Call;1000000;1,20;2027-06-15;UpOut;1,25;;vielleicht",
      { valuationDate: VAL },
    );
    expect(res.trades.map((t) => t.id)).toEqual(["O1", "O2", "O3"]);
    const b = (i: number) => (res.trades[i] as { barrier?: unknown }).barrier;
    expect(b(0)).toEqual({ type: "DownOut", level: 1.05, rebate: 5000, hit: false });
    expect(b(1)).toEqual({ type: "UpIn", level: 1.25, hit: true });
    expect(b(2)).toBeUndefined();
    expect(res.errors.map((e) => e.msg)).toEqual([
      expect.stringMatching(/Barriere-Typ „Ballon“ unbekannt/),
      expect.stringMatching(/Barriere-Status „vielleicht“ nicht lesbar/),
    ]);
    expect(CSV_IMPORT_TEMPLATES.FXO.columns).toEqual(expect.arrayContaining(["barrierType", "barrierLevel", "barrierRebate", "barrierHit"]));
    const imm = tradesFromCsv("type;id;currency;notional;payReceive;fixedRate;tenor\nIMM;I9;EUR;10000000;Receive;3 %;1Y", { valuationDate: VAL }).trades[0]!;
    expect(imm.type).toBe("InterestRateSwap");
    if (imm.type === "InterestRateSwap") expect(imm.legs[0]!.payReceive).toBe("Receive");
    const basis = tradesFromCsv(
      "type;id;currency;notional;receiveIndex;payIndex;spread;effectiveDate;maturity\nBASIS;B9;EUR;10000000;EURIBOR-3M;EURIBOR-6M;5;2026-09-07;5Y",
      {
        valuationDate: VAL,
      },
    );
    expect(basis.errors).toEqual([]);
  });
});

describe("R6-06 – CSV rows that fail trade validation are row errors before the import button counts them", () => {
  it("maturity before start is listed with the German validator message and not offered for import", () => {
    const res = tradesFromCsv(
      "type;id;name;currency;notional;direction;rate;start;maturity;index\nIRS;IRS-D4;Ende vor Start;EUR;5000000;Pay;3,0 %;15.03.2027;2026-12-01;EURIBOR-6M\nIRS;IRS-D3;gültig;EUR;5000000;Pay;3,0 %;15.03.2027;7Y;EURIBOR-6M",
      { valuationDate: VAL },
    );
    expect(res.trades.map((t) => t.id)).toEqual(["IRS-D3"]);
    expect(res.errors).toEqual([{ row: 1, msg: "Enddatum muss nach dem Startdatum liegen" }]);
  });
});

describe("R6-05 / core R6 – i18n of the new core texts", () => {
  it("a missing volType reads 'Vol-Typ fehlt' – never a raw undefined", () => {
    const missing = translateCoreMessage(
      "Market snapshot: malformed vol surface EUR: swaptionVols.EUR.volType must be one of Normal, Lognormal, ShiftedLognormal (got undefined)",
    );
    expect(missing).toMatch(/Swaption-Cube EUR: Vol-Typ fehlt \(erlaubt Normal, Lognormal, ShiftedLognormal\)/);
    expect(missing).not.toMatch(/undefined/);
    expect(translateCoreMessage('swaptionVols.EUR.volType must be one of Normal, Lognormal, ShiftedLognormal (got "Foo")')).toMatch(/Vol-Typ "Foo" unbekannt/);
    expect(translateCoreMessage("capletVols.X.volType: unknown vol type undefined")).toMatch(/Caplet-Fläche X: Vol-Typ fehlt/);
  });
  it("BARRIER_STATE_UNKNOWN warnings are German and point to the editor checkbox", () => {
    const spot = translateCoreMessage(
      "BARRIER_STATE_UNKNOWN: spot 1.25 is at or above the UpOut barrier 1.2 – valued as knocked out (PV 0) on today's spot; set barrier.hit to record the knock state",
    );
    expect(spot).toBe(
      "Barriere-Status unbekannt: Spot 1,25 liegt auf oder über der Up-and-Out-Barriere 1,2 – als ausgeknockt bewertet (Barwert 0) auf Basis des heutigen Spots; „Barriere bereits berührt“ im Trade setzen, um den Status festzuhalten",
    );
    expect(
      translateCoreMessage(
        "BARRIER_STATE_UNKNOWN: spot 1.05 is at or below the DownIn barrier 1.1 – valued as knocked in (vanilla) on today's spot although barrier.hit is false (continuous barrier: a spot beyond the level is a touch)",
      ),
    ).toMatch(/als eingeknockt \(Vanilla\) bewertet .* obwohl „Barriere bereits berührt“ nicht gesetzt ist/);
    expect(
      translateCoreMessage(
        "BARRIER_STATE_UNKNOWN: knock state of the DownOut barrier 1.05 derived from the expiry fixing 1.12 only (alive) – touch events before the expiry are not observed; set barrier.hit to record the knock state",
      ),
    ).toBe(
      "Barriere-Status unbekannt: Knock-Status der Down-and-Out-Barriere 1,05 nur aus dem Verfallsfixing 1,12 abgeleitet (nicht berührt (Option lebt)) – Berührungen vor dem Verfall werden nicht beobachtet; „Barriere bereits berührt“ im Trade setzen, um den Status festzuhalten",
    );
    expect(translateCoreMessage("BARRIER_STATE_UNKNOWN: something new 2026-09-04")).toBe(
      "Barriere-Status unbekannt – something new 04.09.2026; „Barriere bereits berührt“ im Trade setzen",
    );
    expect(PRICING_ERROR_CODES_DE.BARRIER_STATE_UNKNOWN).toBe("Barriere-Status unbekannt");
    expect(WARNING_PREFIXES_DE.BARRIER_STATE_UNKNOWN).toBe("Barriere-Status unbekannt");
  });
  it("VOL_IMPLAUSIBLE warnings (core volSurfaceWarnings / surfaceVolWarnings) are German", () => {
    expect(translateCoreMessage("VOL_IMPLAUSIBLE: swaptionVols.USD is degenerate – every vol is 0 (options are valued at intrinsic value only)")).toBe(
      "Vol-Fläche unplausibel: Swaption-Cube USD ist degeneriert – alle Vols sind 0 (Optionen werden nur zum inneren Wert bewertet)",
    );
    expect(
      translateCoreMessage(
        "VOL_IMPLAUSIBLE: swaptionVols.USD: median lognormal vol 0.97 % is below 1.00 % – the numbers look like normal (bp) vols; check the volType of the import",
      ),
    ).toBe(
      "Vol-Fläche unplausibel: Swaption-Cube USD – Median der Lognormal-Vols 0,97 % liegt unter 1,00 %; die Zahlen sehen wie Normal-Vols (bp) aus – volType des Imports prüfen",
    );
    expect(
      translateCoreMessage(
        "VOL_IMPLAUSIBLE: capletVols.EUR-EURIBOR-6M: median normal vol 620 bp is above 500 bp – the numbers look like lognormal vols; check the volType of the import",
      ),
    ).toMatch(/^Vol-Fläche unplausibel: Caplet-Fläche EUR-EURIBOR-6M – Median der Normal-Vols 620 bp liegt über 500 bp/);
    expect(
      translateCoreMessage(
        "VOL_IMPLAUSIBLE: swaption surface EUR-SWAPTION-NORMAL has 3 of 99 normal vols above 1000 bp (max 1200 bp) – check the volType / quotation of the import",
      ),
    ).toBe(
      "Vol-Fläche unplausibel: Swaption-Fläche EUR-SWAPTION-NORMAL – 3 von 99 Normal-Vols über 1000 bp (max 1200 bp); volType/Quotierung des Imports prüfen",
    );
    expect(
      translateCoreMessage(
        "VOL_IMPLAUSIBLE: fxVols.EURUSD has 2 of 8 lognormal vols below 0.10 % (min 0.05 %) – lognormal vols are decimals (0.20 = 20 %); normal numbers on a Lognormal surface collapse option values",
      ),
    ).toBe(
      "Vol-Fläche unplausibel: FX-Vol-Fläche EURUSD – 2 von 8 Lognormal-Vols unter 0,10 % (min 0,05 %); Lognormal-Vols sind Dezimalzahlen (0,20 = 20 %); Normal-Zahlen auf einer Lognormal-Fläche lassen Optionswerte zusammenfallen",
    );
    expect(translateCoreMessage("VOL_IMPLAUSIBLE: anything else")).toBe("Vol-Fläche unplausibel – anything else");
    expect(PRICING_ERROR_CODES_DE.VOL_IMPLAUSIBLE).toBe("Vol-Fläche unplausibel");
  });
  it("the upfront premium leg and its Premium cashflow carry German labels (core N6-1)", () => {
    expect(legTypeLabel("Upfront premium")).toBe("Upfront-Prämie");
    expect(CASHFLOW_KIND_DE.Premium).toBe("Prämie");
  });
});

describe("R6-01 – chunk load failures are recognised and explained", () => {
  it("isChunkLoadError / chunkUrlOf / CHUNK_ERROR_TEXT", () => {
    const e = new TypeError("Failed to fetch dynamically imported module: http://localhost:4971/assets/ScenariosView-BVVvYVtY.js");
    expect(isChunkLoadError(e)).toBe(true);
    expect(chunkUrlOf(e)).toBe("http://localhost:4971/assets/ScenariosView-BVVvYVtY.js");
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(chunkUrlOf(new Error("nope"))).toBeUndefined();
    expect(CHUNK_ERROR_TEXT).toMatch(/neue Version .* Seite neu laden/);
  });
});
