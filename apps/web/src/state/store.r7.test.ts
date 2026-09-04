/**
 * Round-7 store semantics (docs/quality/review-ui-r7.md): the spot entered with
 * an added curve survives snapshot import → "Zum Sample-Markt" → reload (R7-F1),
 * added curves are kept while a snapshot is the base market, blotter errors for
 * missing market data name the in-app repair path, and the hedge-reset undo
 * restores the persisted test result (R7-06).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HedgeEffectivenessReport,
  type MarketSnapshotJson,
  type Trade,
  SAMPLE_QUOTES,
  advance,
  buildSampleMarket,
  getCalendar,
  makeVanillaSwap,
  serializeMarket,
} from "@deriva/pricing-core";
import { PERSIST_KEY, extraCurveSpots, marketModified, useStore } from "./store.js";

const st = () => useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));
const OIS = [
  { type: "OIS" as const, tenor: "1Y", rate: 0.031 },
  { type: "OIS" as const, tenor: "2Y", rate: 0.0315 },
  { type: "OIS" as const, tenor: "5Y", rate: 0.032 },
  { type: "OIS" as const, tenor: "10Y", rate: 0.033 },
];
/** A snapshot of the *sample* market – the auditor's file without any DKK curve. */
const sampleSnapshot = (): MarketSnapshotJson =>
  JSON.parse(JSON.stringify(serializeMarket(buildSampleMarket(st().valuationDate, JSON.parse(JSON.stringify(SAMPLE_QUOTES)))))) as MarketSnapshotJson;
const dkkSwap = (): Trade =>
  makeVanillaSwap({
    id: "IRS-DKK",
    currency: "DKK",
    notional: 10_000_000,
    payReceiveFixed: "Pay",
    fixedRate: 0.03,
    effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
    maturity: "5Y",
    index: "DESTR",
  });
/** Reload simulation: persist → reset → rehydrate from the persisted slice. */
const reload = async () => {
  await flush();
  const raw = localStorage.getItem(PERSIST_KEY)!;
  st().resetPortfolio();
  localStorage.setItem(PERSIST_KEY, raw);
  await useStore.persist.rehydrate();
};

describe("R7-F1 – the '+ Kurve' spot and the curve survive import → leave → reload", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("the spot is stored with the curve, reaches the market and is not a quote edit", () => {
    expect(st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "eurdkk", rate: 7.46 } })).toEqual({
      ok: true,
    });
    expect(st().extraCurves["DKK-DESTR"]!.fxSpot).toEqual({ pair: "EURDKK", rate: 7.46 });
    expect(st().baseMarket.fxSpots.EURDKK).toBe(7.46);
    expect(st().quotes.fxSpots.EURDKK).toBeUndefined();
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "curves", label: "Kurve DKK-DESTR angelegt · Spot EUR/DKK" });
    expect(st().undoStack.at(-1)).not.toHaveProperty("quotes");
    // a spot edited later in the FX-spot table (quote set) wins over the curve's spot
    expect(st().setFxSpot("EURDKK", 7.5)).toBe(true);
    expect(st().baseMarket.fxSpots.EURDKK).toBe(7.5);
    expect(st().extraCurves["DKK-DESTR"]!.fxSpot!.rate).toBe(7.46);
    expect(extraCurveSpots(st().extraCurves, { EURDKK: 7.5 })).toEqual({});
    expect(extraCurveSpots(st().extraCurves, { DKKEUR: 0.134 })).toEqual({});
    expect(extraCurveSpots(st().extraCurves, {})).toEqual({ EURDKK: 7.46 });
    // undo of the curve removes curve and spot together
    expect(st().undo()).toMatch(/Spot EUR\/DKK 7,5/);
    expect(st().undo()).toBe("Kurve DKK-DESTR angelegt · Spot EUR/DKK");
    expect(st().baseMarket.fxSpots.EURDKK).toBeUndefined();
    expect(st().baseMarket.curves["DKK-DESTR"]).toBeUndefined();
    // a bad spot is refused, the curve is not added
    expect(st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS, fxSpot: { pair: "EURDKK", rate: -1 } })).toMatchObject({
      ok: false,
      error: /Spot EURDKK muss ein positiver Kurs/,
    });
  });

  it("a DKK trade stays priceable across snapshot import → Zum Sample-Markt → reload; the EUR/DKK spot is still there", async () => {
    st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
    const t = st().addTrade(dkkSwap(), { select: false });
    expect(st().results[t.id]?.error).toBeUndefined();
    const pv0 = st().results[t.id]!.result!.pv;
    // the auditor's snapshot has no DKK curve: while imported the trade cannot be priced – the repair path fits the import mode (R8-06)
    const r = st().importSnapshot(sampleSnapshot());
    expect(r.ok).toBe(true);
    expect(st().results[t.id]?.error).toMatch(
      /der importierte Snapshot enthält keine DKK-Kurve – Snapshot mit Kurve importieren oder „Zum Sample-Markt“ wechseln/,
    );
    expect(st().extraCurves["DKK-DESTR"]).toBeDefined(); // kept, not applied
    expect(st().baseMarket.curves["DKK-DESTR"]).toBeUndefined();
    // reload while imported: the added curve is still remembered
    await reload();
    expect(st().marketSource).toBe("import");
    expect(st().extraCurves["DKK-DESTR"]?.fxSpot).toEqual({ pair: "EURDKK", rate: 7.46 });
    // leave → sample market WITH the added curve and its spot
    st().leaveImport();
    expect(st().marketSource).toBe("sample");
    expect(st().baseMarket.discountCurveId.DKK).toBe("DKK-DESTR");
    expect(st().baseMarket.fxSpots.EURDKK).toBe(7.46);
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().results[t.id]!.result!.pv).toBeCloseTo(pv0, 6);
    expect(marketModified(st())).toBe(true);
    // reload in sample mode: curve, spot and valuation survive
    await reload();
    expect(st().baseMarket.curves["DKK-DESTR"]).toBeDefined();
    expect(st().baseMarket.fxSpots.EURDKK).toBe(7.46);
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().results[t.id]!.result!.pv).toBeCloseTo(pv0, 6);
  });

  it("discarding the import via a valuation-date change also rebuilds with the added curves; undo of the leave restores the import", () => {
    st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
    const t = st().addTrade(dkkSwap(), { select: false });
    st().importSnapshot(sampleSnapshot());
    expect(st().setValuationDate("2026-09-10", { discardImport: true })).toBe(true);
    expect(st().marketSource).toBe("sample");
    expect(st().baseMarket.curves["DKK-DESTR"]).toBeDefined();
    expect(st().baseMarket.fxSpots.EURDKK).toBe(7.46);
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().undo()).toMatch(/verworfen/);
    expect(st().marketSource).toBe("import");
    st().leaveImport();
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(st().undo()).toMatch(/Zum Sample-Markt/);
    expect(st().marketSource).toBe("import");
    expect(st().results[t.id]?.error).toMatch(/„Zum Sample-Markt“ wechseln/);
  });

  it("errors for missing market data name the repair path: + Kurve for curves / discount curves, + Paar for FX spots", () => {
    // no DKK curve at all → discount-curve error with the "+ Kurve" hint
    const t = st().addTrade(dkkSwap(), { select: false });
    expect(st().results[t.id]?.error).toMatch(/Keine Diskontkurve für DKK konfiguriert – in der Kurvenansicht mit „\+ Kurve“ eine DKK-Kurve anlegen/);
    // curve without a spot: the conversion into the reporting currency needs EUR/DKK → "+ Paar" hint
    st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS });
    expect(st().results[t.id]?.error).toMatch(/Kein FX-Spot für DKKEUR verfügbar – in der Marktansicht unter FX-Spots mit „\+ Paar“ ergänzen/);
    // "+ Paar" = addExtraSpot on a new pair (sample mode: structural extra, R8-F2) repairs it; the quote set is untouched
    expect(st().addExtraSpot("EURDKK", 7.46)).toBe(true);
    expect(st().extraSpots.EURDKK).toBe(7.46);
    expect(st().quotes.fxSpots.EURDKK).toBeUndefined();
    expect(st().results[t.id]?.error).toBeUndefined();
  });
});

describe("R7-06 – hedge-reset undo restores the persisted test result", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [] });
  });

  it("removeHedgeRelationship drops the result, undo brings documentation and result back", () => {
    st().setHedgeRelationship({
      id: "HR-IRS-0001",
      name: "Hedge",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "",
        currency: "EUR",
        notional: 1e7,
        kind: "FloatingRateLoan",
        effectiveDate: st().valuationDate,
        maturityDate: st().valuationDate + 3650,
      },
      hedgingInstrumentId: "IRS-0001",
      designationDate: st().valuationDate,
      hedgeRatio: 0.99,
      method: "DollarOffset",
      accountingFramework: "IFRS9",
    });
    const report = { relationshipId: "HR-IRS-0001", effective: true, assessable: true } as unknown as HedgeEffectivenessReport;
    st().setHedgeResult("IRS-0001", { key: "k1", report, at: "2026-09-04T00:00:00.000Z" });
    st().removeHedgeRelationship("IRS-0001");
    expect(st().hedgeRelationships["IRS-0001"]).toBeUndefined();
    expect(st().hedgeResults["IRS-0001"]).toBeUndefined();
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "hedge", tradeId: "IRS-0001", result: { key: "k1" } });
    expect(st().undo()).toBe("Sicherungsdokumentation IRS-0001 verworfen");
    expect(st().hedgeRelationships["IRS-0001"]?.hedgeRatio).toBe(0.99);
    expect(st().hedgeResults["IRS-0001"]).toMatchObject({ key: "k1", report: { relationshipId: "HR-IRS-0001", effective: true } });
    // a documentation without a test result undoes as before (no result entry)
    st().removeHedgeRelationship("IRS-0001");
    st().setHedgeResult("IRS-0001", undefined);
    st().undo();
    st().setHedgeResult("IRS-0001", undefined);
    st().removeHedgeRelationship("IRS-0001");
    expect(st().undoStack.at(-1)).not.toHaveProperty("result");
    st().undo();
    expect(st().hedgeResults["IRS-0001"]).toBeUndefined();
  });
});
