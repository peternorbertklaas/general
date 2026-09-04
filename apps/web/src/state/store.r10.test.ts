/**
 * Round-10 store semantics (docs/quality/review-ui-r10.md R10-F1 / R10-04,
 * review-markt-r10.md R10-1): the workstation export carries the bootstrap
 * specs of the *sample* curves too, the import mode bumps only the snapshot's
 * own specs after a spec ↔ curve check, and an empty book loads the sample
 * portfolio without a question.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CurveBuildSpec,
  type CurveQuote,
  type Trade,
  SAMPLE_QUOTES,
  advance,
  buildSampleMarket,
  checkParRiskSpecs,
  getCalendar,
  makeVanillaSwap,
  parRisk,
  sampleBootstrapSpecs,
  serializeMarket,
} from "@deriva/pricing-core";
import { exportEnvelope, quotesOf } from "../lib/register-envelope.js";
import { jsonClone, sampleSnapshot } from "../test/fixtures-r8.js";
import { exportQuoteSpecs, parRiskSpecs, parRiskSpecsChecked, resetPortfolioWithConfirm, sampleExportSpecs, snapshotQuoteSpecs, useStore } from "./store.js";

const st = () => useStore.getState();
const OIS: CurveQuote[] = [
  { type: "OIS", tenor: "1Y", rate: 0.041 },
  { type: "OIS", tenor: "2Y", rate: 0.0415 },
  { type: "OIS", tenor: "5Y", rate: 0.042 },
  { type: "OIS", tenor: "10Y", rate: 0.043 },
];
const EUR_CURVES = ["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M"];
/** The reviewer's fixture: a spec whose quotes are shifted by `bp` against the curve the snapshot carries. */
const bumped = (spec: CurveBuildSpec, bp: number): CurveBuildSpec => ({
  ...spec,
  quotes: spec.quotes.map((q) => ("rate" in q ? { ...q, rate: q.rate + bp / 1e4 } : q)),
});
const checkedState = () => ({ ...st(), market: st().market, baseMarket: st().baseMarket });
const irs0001 = () => st().trades.find((t) => t.id === "IRS-0001")!;
const parTotal = (t: Trade, specs: Record<string, CurveBuildSpec>) => parRisk(st().market, t, "EUR", specs).total;

describe("R10-F1 / Markt R10-1 – the export carries the sample bootstrap specs; the import mode bumps only checked snapshot specs", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });

  it("sample mode exports every curve with quotes – the sample curves (with the active overrides) plus the „+ Kurve“ curves", () => {
    expect(st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS }, { fxSpot: { pair: "EURNOK", rate: 11.62 } })).toEqual({
      ok: true,
    });
    expect(st().setInterpolation("EUR-ESTR", "monotoneConvex")).toBe(true);
    const quotes = exportQuoteSpecs(st());
    const ids = quotes.map((q) => q.curveId);
    for (const id of [...EUR_CURVES, "USD-SOFR", "NOK-NOWA"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    // every exported spec names a curve of the market and reproduces it (the override travels with the spec)
    for (const q of quotes) expect(st().baseMarket.curves[q.curveId]).toBeDefined();
    expect(quotes.find((q) => q.curveId === "EUR-ESTR")!.spec.interpolation).toBe("monotoneConvex");
    expect(quotes.find((q) => q.curveId === "NOK-NOWA")!.spec).toEqual({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS });
    expect(checkParRiskSpecs(st().baseMarket, Object.fromEntries(quotes.map((q) => [q.curveId, q.spec])))).toMatchObject({ inconsistent: [], missing: [] });
    // the old three-argument form still exports only the extra curves (R9 tests, API round trips)
    expect(snapshotQuoteSpecs(st().baseMarket, st().extraCurves).map((q) => q.curveId)).toEqual(["NOK-NOWA"]);
    expect(sampleExportSpecs(st(), { curves: {} })).toEqual([]);
  });

  it("export → fresh import → IRS-0001 keeps its par risk (Par-DV01 ≈ the sample-mode number, all 4 EUR curves covered)", () => {
    const before = parTotal(irs0001(), parRiskSpecs(st()));
    expect(Math.abs(before)).toBeGreaterThan(1000);
    // the reviewer's number for the shipped valuation date (6 815 EUR) – any date lands in the same order of magnitude
    expect(Math.abs(before)).toBeGreaterThan(4000);
    expect(Math.abs(before)).toBeLessThan(10000);
    const file = jsonClone({ ...serializeMarket(st().baseMarket), ...exportEnvelope(), quotes: exportQuoteSpecs(st()) });
    expect(file.quotes.length).toBeGreaterThanOrEqual(7);
    // fresh workstation
    st().resetPortfolio();
    useStore.setState({ undoStack: [] });
    const r = st().importSnapshot(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quoteCurves).toContain("EUR-ESTR");
    const checked = parRiskSpecsChecked(checkedState());
    expect(checked.inconsistent).toEqual([]);
    const eurCurves = Object.values(st().market.curves)
      .filter((c) => c.currency === "EUR")
      .map((c) => c.id);
    expect(eurCurves.length).toBe(4);
    for (const id of eurCurves) expect(checked.specs[id], id).toBeDefined(); // coverage „4 von 4“
    const after = parTotal(irs0001(), checked.specs);
    expect(Math.abs(after - before)).toBeLessThan(1);
    const dv01 = st().risk("IRS-0001")!.dv01;
    expect(Math.sign(after)).toBe(Math.sign(dv01));
    expect(Math.abs(after - dv01) / Math.abs(dv01)).toBeLessThan(0.15);
    // in import mode the local sample quotes never serve as specs: a snapshot without the block has nothing to bump
    expect(parRiskSpecs({ ...st(), importedSnapshot: { ...file, quotes: undefined } })).toEqual({});
    expect(parRiskSpecsChecked({ ...checkedState(), importedSnapshot: { ...file, quotes: undefined } })).toEqual({ specs: {}, inconsistent: [] });
  });

  it("an API snapshot with a bumped spec next to the unbumped curve is imported, but the spec is excluded as inconsistent", () => {
    const base = sampleSnapshot(st().valuationDate);
    const specs = sampleBootstrapSpecs(st().valuationDate, jsonClone(SAMPLE_QUOTES));
    const r = st().importSnapshot({
      ...base,
      quotes: [
        { curveId: "EUR-ESTR", spec: bumped(specs["EUR-ESTR"]!, 50) },
        { curveId: "EUR-EURIBOR-6M", spec: specs["EUR-EURIBOR-6M"]! },
        { curveId: "USD-SOFR", spec: specs["USD-SOFR"]! },
      ],
    });
    expect(r.ok).toBe(true);
    const checked = parRiskSpecsChecked(checkedState());
    // the raw specs still list the bumped one – the checked ones do not; the dual-curve EURIBOR-6M spec is checked against
    // the *market's* ESTR curve (core `checkParRiskSpecs`) and stays usable, USD-SOFR is fine
    expect(Object.keys(parRiskSpecs(st())).sort()).toEqual(["EUR-ESTR", "EUR-EURIBOR-6M", "USD-SOFR"]);
    expect(checked.inconsistent).toEqual(["EUR-ESTR"]);
    expect(Object.keys(checked.specs).sort()).toEqual(["EUR-EURIBOR-6M", "USD-SOFR"]);
    // the bump never runs on the inconsistent curve – no −97.521 EUR out of a 6.8k DV01
    const report = parRisk(st().market, irs0001(), "EUR", checked.specs);
    expect(report.curves.map((c) => c.curveId)).toEqual(["EUR-EURIBOR-6M"]);
    const wrong = parRisk(st().market, irs0001(), "EUR", parRiskSpecs(st()));
    expect(Math.abs(wrong.total)).toBeGreaterThan(Math.abs(st().risk("IRS-0001")!.dv01) * 3); // what the check prevents
  });

  it("checkParRiskSpecs: reproducing specs are consistent, a 1 bp bump is not, unknown curves are missing", () => {
    const val = st().valuationDate;
    const quotes = jsonClone(SAMPLE_QUOTES);
    const ctx = buildSampleMarket(val, quotes);
    const specs = sampleBootstrapSpecs(val, quotes);
    const ok = checkParRiskSpecs(ctx, specs);
    expect(ok.inconsistent).toEqual([]);
    expect(ok.missing).toEqual([]);
    expect(ok.consistent.sort()).toEqual(Object.keys(specs).sort());
    const bad = checkParRiskSpecs(ctx, { ...specs, "EUR-ESTR": bumped(specs["EUR-ESTR"]!, 1), "XXX-FOO": { ...specs["USD-SOFR"]!, id: "XXX-FOO" } });
    expect(bad.missing).toEqual(["XXX-FOO"]);
    const estr = bad.inconsistent.find((c) => c.curveId === "EUR-ESTR");
    expect(estr).toBeDefined();
    expect(estr!.maxAbsDfDiff).toBeGreaterThan(1e-6);
    // every spec is checked against the *market's* curves: the dependents of the bumped spec stay consistent (their own
    // quotes describe their curve), so their buckets remain usable
    expect(bad.inconsistent.map((c) => c.curveId)).toEqual(["EUR-ESTR"]);
    expect(bad.consistent).toContain("USD-SOFR");
    expect(bad.consistent).toContain("EUR-EURIBOR-6M");
    // a spec that cannot be bootstrapped against the market is inconsistent with an infinite difference, not an exception
    const broken = checkParRiskSpecs(ctx, { "EUR-ESTR": { ...specs["EUR-ESTR"]!, discountCurveId: "NOT-THERE" } });
    expect(broken.inconsistent).toMatchObject([{ curveId: "EUR-ESTR", maxAbsDfDiff: Number.POSITIVE_INFINITY }]);
    // tolerance is a parameter
    expect(checkParRiskSpecs(ctx, { "EUR-ESTR": bumped(specs["EUR-ESTR"]!, 1) }, { tolerance: 1 }).consistent).toEqual(["EUR-ESTR"]);
    expect(checkParRiskSpecs(ctx, { "EUR-ESTR": specs["EUR-ESTR"]! }, { tolerance: 1e-12 }).consistent).toEqual(["EUR-ESTR"]);
  });

  it("sample mode is never re-checked (its specs built the market); import mode without specs reports nothing inconsistent", () => {
    expect(parRiskSpecsChecked(checkedState()).inconsistent).toEqual([]);
    expect(Object.keys(parRiskSpecsChecked(checkedState()).specs)).toContain("EUR-ESTR");
    expect(st().importSnapshot(sampleSnapshot(st().valuationDate)).ok).toBe(true);
    expect(parRiskSpecsChecked(checkedState())).toEqual({ specs: {}, inconsistent: [] });
    // the re-export of an import re-emits the file's block only
    expect(exportQuoteSpecs(st())).toEqual([]);
    expect(quotesOf(st().importedSnapshot)).toEqual([]);
  });

  it("a NOK swap on an imported „+ Kurve“ curve keeps its par risk after the round trip (R9-1 unchanged)", () => {
    expect(st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS }, { fxSpot: { pair: "EURNOK", rate: 11.62 } })).toEqual({
      ok: true,
    });
    const file = jsonClone({ ...serializeMarket(st().baseMarket), ...exportEnvelope(), quotes: exportQuoteSpecs(st()) });
    st().resetPortfolio();
    useStore.setState({ undoStack: [] });
    expect(st().importSnapshot(file).ok).toBe(true);
    const t = st().addTrade(
      makeVanillaSwap({
        id: "IRS-NOK",
        currency: "NOK",
        notional: 1e7,
        payReceiveFixed: "Pay",
        fixedRate: 0.03,
        effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
        maturity: "5Y",
        index: "NOWA",
      }),
      { select: false },
    );
    const checked = parRiskSpecsChecked(checkedState());
    expect(checked.inconsistent).toEqual([]);
    expect(checked.specs["NOK-NOWA"]).toBeDefined();
    expect(Math.abs(parRisk(st().market, t, "EUR", checked.specs).total)).toBeGreaterThan(1);
  });
});

describe("R10-04 – „Beispielportfolio laden“ on an empty book without anything to lose asks no question", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("0 trades, untouched sample market, no hedge documentation → loads directly, undoable, with the Rückgängig toast", () => {
    useStore.setState({ trades: [], results: {}, selectedId: null });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(resetPortfolioWithConfirm()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(st().trades.length).toBe(13);
    expect(st().toasts.at(-1)).toMatchObject({ msg: "Beispielportfolio geladen", action: { label: "Rückgängig" } });
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "portfolio" });
    expect(st().undo()).toMatch(/^Beispielportfolio geladen \(0 Trades ersetzt\)/);
    expect(st().trades).toEqual([]);
  });

  it("0 trades but market changes or a hedge documentation → the question names them", () => {
    useStore.setState({ trades: [], results: {}, selectedId: null });
    st().setQuotes({ ...st().quotes, fxSpots: { ...st().quotes.fxSpots, EURUSD: 1.25 } }, "Spot");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(resetPortfolioWithConfirm()).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Bestand (0 Trades, Marktänderungen) durch das Beispielportfolio ersetzen? (rückgängig mit Ctrl+Z)");
    // a book with trades always asks
    st().resetPortfolio();
    useStore.setState({ undoStack: [] });
    confirm.mockClear();
    expect(resetPortfolioWithConfirm()).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Bestand (13 Trades) durch das Beispielportfolio ersetzen? (rückgängig mit Ctrl+Z)");
  });
});
