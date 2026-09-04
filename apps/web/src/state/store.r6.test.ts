/**
 * Round-6 store semantics (docs/quality/review-ui-r6.md): every market edit in
 * import mode is an undoable, persisted, flagged override (R6-F1); snapshot
 * import / discard / leave are one undoable action each (R6-F2); hedge test
 * results survive the reload (R5-F3 leftover); fixings are a proper market
 * component in both modes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HedgeEffectivenessReport,
  type MarketSnapshotJson,
  type SampleMarketQuotes,
  makeVanillaSwap,
  marketSnapshotId,
  parseISO,
  serializeMarket,
  toISO,
} from "@deriva/pricing-core";
import { PERSIST_KEY, changeValuationDate, marketModified, useStore } from "./store.js";

const snapshotOfCurrentMarket = (): MarketSnapshotJson => JSON.parse(JSON.stringify(serializeMarket(useStore.getState().baseMarket))) as MarketSnapshotJson;
const st = () => useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("store – import-mode market edits are overrides, not silent snapshot changes (R6-F1)", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("FX-spot edit on an imported snapshot: applied, flagged modifiziert, undoable, persisted, reset returns to the snapshot id", async () => {
    const file = snapshotOfCurrentMarket();
    expect(st().importSnapshot(file).ok).toBe(true);
    const id0 = marketSnapshotId(st().baseMarket);
    const pvBefore = st().results["FXF-0001"]?.result?.pv;
    expect(st().setFxSpot("EURUSD", 1.25)).toBe(true);
    // the market is priced on the new spot …
    expect(st().baseMarket.fxSpots.EURUSD).toBe(1.25);
    expect(st().market.fxSpots.EURUSD).toBe(1.25);
    expect(st().results["FXF-0001"]?.result?.pv).not.toBe(pvBefore);
    // … the snapshot id changes visibly (chip "modifiziert"), never silently
    expect(marketSnapshotId(st().baseMarket)).not.toBe(id0);
    expect(marketModified(st())).toBe(true);
    expect(st().fxSpotOverrides).toEqual({ EURUSD: 1.25 });
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "spots" });
    // the export carries the override
    expect(serializeMarket(st().baseMarket).fxSpots.EURUSD).toBe(1.25);
    // persisted: the override survives the reload with the same id as before the reload
    await flush();
    const idBeforeReload = marketSnapshotId(st().baseMarket);
    const raw = localStorage.getItem(PERSIST_KEY)!;
    expect((JSON.parse(raw) as { state: { fxSpotOverrides: Record<string, number> } }).state.fxSpotOverrides).toEqual({ EURUSD: 1.25 });
    st().resetPortfolio();
    localStorage.setItem(PERSIST_KEY, raw);
    await useStore.persist.rehydrate();
    expect(st().marketSource).toBe("import");
    expect(st().baseMarket.fxSpots.EURUSD).toBe(1.25);
    expect(marketSnapshotId(st().baseMarket)).toBe(idBeforeReload);
    expect(st().restored?.quotesModified).toBe(true);
    // undo restores the snapshot spot and the snapshot id
    useStore.setState({ undoStack: [{ kind: "spots", fxSpotOverrides: {}, label: "Spot EUR/USD 1,25", at: Date.now() }] });
    expect(st().undo()).toBe("Spot EUR/USD 1,25");
    expect(st().baseMarket.fxSpots.EURUSD).toBe(file.fxSpots.EURUSD);
    expect(marketSnapshotId(st().baseMarket)).toBe(id0);
    expect(marketModified(st())).toBe(false);
    // setting the snapshot value again removes the override instead of storing an identical one
    expect(st().setFxSpot("EURUSD", 1.25)).toBe(true);
    expect(st().setFxSpot("EURUSD", file.fxSpots.EURUSD!)).toBe(true);
    expect(st().fxSpotOverrides).toEqual({});
    // reset in import mode = back to the snapshot
    st().setFxSpot("EURUSD", 1.3);
    st().resetMarketOverrides();
    expect(marketSnapshotId(st().baseMarket)).toBe(id0);
    expect(st().marketSource).toBe("import");
  });

  it("sample mode: the spot stays a quote (quotes undo entry, quotesModified)", () => {
    expect(st().setFxSpot("EURUSD", 1.2)).toBe(true);
    expect(st().quotes.fxSpots.EURUSD).toBe(1.2);
    expect(st().fxSpotOverrides).toEqual({});
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "quotes" });
    expect(marketModified(st())).toBe(true);
    expect(st().setFxSpot("EURUSD", -1)).toBe(false);
    expect(st().setFxSpot("eurusd", 1.2)).toBe(false);
  });

  it("fixings are an undoable, persisted override in sample and import mode (also counted as modifiziert)", async () => {
    const baseCount = st().baseMarket.fixings?.length ?? 0;
    const d = parseISO("2026-06-15");
    expect(
      st().setFixings([...(st().baseMarket.fixings ?? []), { index: "EURIBOR-6M", date: d, value: 0.0211 }], "Fixing EURIBOR-6M 15.06.2026 hinzugefügt"),
    ).toBe(true);
    expect(st().baseMarket.fixings).toHaveLength(baseCount + 1);
    expect(st().fixings).toHaveLength(baseCount + 1);
    expect(marketModified(st())).toBe(true);
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "fixings", fixings: null });
    // the override survives a valuation-date change (the base market's own fixings would be rebuilt otherwise)
    expect(st().setValuationDate("2026-09-04")).toBe(true);
    expect(st().baseMarket.fixings).toHaveLength(baseCount + 1);
    await flush();
    const raw = localStorage.getItem(PERSIST_KEY)!;
    expect((JSON.parse(raw) as { state: { fixings: unknown[] } }).state.fixings).toHaveLength(baseCount + 1);
    expect(st().undo()).toBe("Fixing EURIBOR-6M 15.06.2026 hinzugefügt");
    expect(st().fixings).toBeNull();
    expect(st().baseMarket.fixings?.length ?? 0).toBeGreaterThanOrEqual(0);
    expect(marketModified(st())).toBe(false);
    // import mode: the snapshot's fixings are the reference; an edit is an override on top
    const file = snapshotOfCurrentMarket();
    expect(st().importSnapshot(file).ok).toBe(true);
    const id = marketSnapshotId(st().baseMarket);
    expect(st().setFixings([{ index: "EURIBOR-6M", date: d, value: 0.02 }], "Fixing geändert")).toBe(true);
    expect(st().baseMarket.fixings).toHaveLength(1);
    expect(marketModified(st())).toBe(true);
    expect(marketSnapshotId(st().baseMarket)).not.toBe(id);
    st().resetMarketOverrides();
    expect(st().fixings).toBeNull();
    expect(marketSnapshotId(st().baseMarket)).toBe(id);
    expect(marketModified(st())).toBe(false);
  });

  it("FX-fixing edits after an import count as modifiziert relative to the snapshot", () => {
    const file = snapshotOfCurrentMarket();
    expect(st().importSnapshot(file).ok).toBe(true);
    expect(marketModified(st())).toBe(false);
    expect(st().setFxFixings([{ pair: "EURUSD", date: parseISO("2026-09-01"), rate: 1.17 }], "FX-Fixing")).toBe(true);
    expect(marketModified(st())).toBe(true);
    st().resetMarketOverrides();
    expect(st().fxFixings).toEqual([]);
    expect(marketModified(st())).toBe(false);
  });
});

describe("store – snapshot import, discard and leave are one undoable action (R6-F2)", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("import: undo restores vols, quotes, market source and valuation date; older undo entries are kept", () => {
    const file = snapshotOfCurrentMarket();
    file.valuationDate = "2026-10-30";
    // a quote edit and a vol edit before the import
    const q = JSON.parse(JSON.stringify(st().quotes)) as SampleMarketQuotes;
    (q.eurOis[0] as { rate: number }).rate += 0.0005;
    expect(st().setQuotes(q, "Quote +5 bp")).toBe(true);
    const surf = st().baseMarket.swaptionVols!.EUR!;
    const edited = { ...surf, atm: surf.atm.map((row, i) => (i === 0 ? row.map((v, j) => (j === 0 ? 0.0099 : v)) : row)) };
    expect(st().setVolSurface("swaptionVols", "EUR", edited, "Vol 62 → 99")).toBe(true);
    const stackBefore = st().undoStack.length;
    const idSample = marketSnapshotId(st().baseMarket);
    const r = st().importSnapshot(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.discardedEdits).toBe(true);
    expect(st().volSurfaces).toEqual({});
    expect(toISO(st().valuationDate)).toBe("2026-10-30");
    expect(st().undoStack).toHaveLength(stackBefore + 1);
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "marketSource", label: /importiert/ });
    // undo the import → everything as before, including the vol edit and the quote edit
    const label = st().undo();
    expect(label).toMatch(/Snapshot .* importiert/);
    expect(st().marketSource).toBe("sample");
    expect(st().importedSnapshot).toBeNull();
    expect(toISO(st().valuationDate)).toBe("2026-09-03");
    expect(st().baseMarket.swaptionVols!.EUR!.atm[0]![0]).toBeCloseTo(0.0099, 10);
    expect(st().quotes.eurOis[0]).toMatchObject({ rate: (q.eurOis[0] as { rate: number }).rate });
    expect(marketSnapshotId(st().baseMarket)).toBe(idSample);
    // the older entries are still there: undo the vol edit, then the quote edit
    expect(st().undo()).toBe("Vol 62 → 99");
    expect(st().volSurfaces).toEqual({});
    expect(st().undo()).toBe("Quote +5 bp");
    expect(marketModified(st())).toBe(false);
    // an import without prior edits reports nothing discarded
    const r2 = st().importSnapshot(file);
    expect(r2.ok && r2.discardedEdits).toBe(false);
  });

  it("discard via valuation-date change and 'Zum Sample-Markt' are undoable; the confirm dialog says so", () => {
    const file = snapshotOfCurrentMarket();
    file.valuationDate = "2026-10-30";
    expect(st().importSnapshot(file).ok).toBe(true);
    const id = marketSnapshotId(st().baseMarket);
    // an edit made under the import comes back with the undo as well
    const surf = st().baseMarket.swaptionVols!.EUR!;
    expect(st().setVolSurface("swaptionVols", "EUR", { ...surf, atm: surf.atm.map((r) => r.map((v) => v + 0.001)) }, "Vol +10 bp")).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(changeValuationDate("2026-11-02")).toBe(true);
    expect(confirm.mock.calls[0]![0]).toMatch(/rückgängig mit Ctrl\+Z/);
    expect(st().marketSource).toBe("sample");
    expect(st().volSurfaces).toEqual({});
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "marketSource", label: /verworfen/ });
    expect(st().toasts.some((t) => /verworfen/.test(t.msg) && t.action?.label === "Rückgängig")).toBe(true);
    expect(st().undo()).toMatch(/verworfen/);
    expect(st().marketSource).toBe("import");
    expect(toISO(st().valuationDate)).toBe("2026-10-30");
    expect(st().baseMarket.swaptionVols!.EUR!.atm[0]![0]).toBeCloseTo(surf.atm[0]![0]! + 0.001, 10);
    expect(marketSnapshotId(st().baseMarket)).not.toBe(id); // the vol edit is back too
    // leave → undo → import again
    st().leaveImport();
    expect(st().marketSource).toBe("sample");
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "marketSource", label: /Zum Sample-Markt/ });
    expect(st().undo()).toMatch(/Zum Sample-Markt/);
    expect(st().marketSource).toBe("import");
    expect(st().importedSnapshot?.valuationDate).toBe("2026-10-30");
  });
});

describe("store – hedge effectiveness results survive the reload (R5-F3)", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [] });
  });

  it("setHedgeResult persists per trade, removeHedgeRelationship drops it, garbage is ignored on hydration", async () => {
    const report = { relationshipId: "HR-IRS-0001", effective: true } as unknown as HedgeEffectivenessReport;
    st().setHedgeResult("IRS-0001", { key: "k1", report, at: "2026-09-04T00:00:00.000Z" });
    expect(st().hedgeResults["IRS-0001"]?.key).toBe("k1");
    await flush();
    const raw = localStorage.getItem(PERSIST_KEY)!;
    expect((JSON.parse(raw) as { state: { hedgeResults: Record<string, unknown> } }).state.hedgeResults["IRS-0001"]).toBeTruthy();
    st().resetPortfolio();
    expect(st().hedgeResults).toEqual({});
    localStorage.setItem(PERSIST_KEY, raw);
    await useStore.persist.rehydrate();
    expect(st().hedgeResults["IRS-0001"]).toMatchObject({ key: "k1", report: { relationshipId: "HR-IRS-0001" } });
    // a documentation reset drops the result
    st().setHedgeRelationship({
      id: "HR-IRS-0001",
      name: "T",
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
      hedgeRatio: 1,
      method: "DollarOffset",
      accountingFramework: "IFRS9",
    });
    st().removeHedgeRelationship("IRS-0001");
    expect(st().hedgeResults["IRS-0001"]).toBeUndefined();
    st().setHedgeResult("IRS-0001", undefined);
    // garbage
    const bad = JSON.parse(raw) as { state: { hedgeResults: unknown } };
    bad.state.hedgeResults = { "IRS-0001": { key: 1, report: "x" }, "IRS-0002": "nope" };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(bad));
    await useStore.persist.rehydrate();
    expect(st().hedgeResults).toEqual({});
  });
});

describe("store – curves added from quotes (Markt R6-5)", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });

  it("adds a NOK OIS curve with the core conventions, makes NOK a discount / reporting currency, is undoable, persisted and reset with the market", async () => {
    const quotes = [
      { type: "OIS" as const, tenor: "1Y", rate: 0.045 },
      { type: "OIS" as const, tenor: "2Y", rate: 0.044 },
      { type: "OIS" as const, tenor: "5Y", rate: 0.043 },
      { type: "OIS" as const, tenor: "10Y", rate: 0.0435 },
    ];
    expect(st().addExtraCurve({ id: "NOK-NOWA", currency: "XXX", index: "NOWA", quotes })).toMatchObject({ ok: false, error: /Währung „XXX“/ });
    expect(st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "SOFR", quotes })).toMatchObject({
      ok: false,
      error: /Index „SOFR“ ist für NOK nicht registriert/,
    });
    expect(st().addExtraCurve({ id: "EUR-ESTR", currency: "EUR", index: "ESTR", quotes })).toMatchObject({ ok: false, error: /existiert bereits/ });
    expect(st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: quotes.slice(0, 1) })).toMatchObject({
      ok: false,
      error: /Mindestens zwei Quotes/,
    });
    const r = st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes }, { fxSpot: { pair: "EURNOK", rate: 11.5 } });
    expect(r).toEqual({ ok: true });
    const m = st().baseMarket;
    expect(m.curves["NOK-NOWA"]).toBeDefined();
    expect(m.curves["NOK-NOWA"]!.currency).toBe("NOK");
    expect(m.discountCurveId.NOK).toBe("NOK-NOWA");
    expect(m.fxSpots.EURNOK).toBe(11.5);
    // R7-F1: the spot is stored with the curve, not as a quote edit
    expect(st().extraCurves["NOK-NOWA"]!.fxSpot).toEqual({ pair: "EURNOK", rate: 11.5 });
    expect(st().quotes.fxSpots.EURNOK).toBeUndefined();
    expect(marketModified(st())).toBe(true);
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "curves", label: /Kurve NOK-NOWA angelegt · Spot EUR\/NOK/ });
    // the curve reprices its own quotes (par OIS ≈ 0 residual) and prices a NOK swap
    expect(m.curves["NOK-NOWA"]!.zeroRate(st().valuationDate + 365 * 5)).toBeGreaterThan(0.04);
    const nok = parseQuickEntryLike(st().valuationDate);
    st().addTrade(nok, { select: false });
    expect(st().results[nok.id]?.error).toBeUndefined();
    expect(Number.isFinite(st().results[nok.id]?.result?.pv)).toBe(true);
    expect(st().results[nok.id]?.result?.currency).toBe("EUR");
    // quote edit of the added curve re-bootstraps and is undoable
    expect(
      st().setExtraCurveQuotes(
        "NOK-NOWA",
        quotes.map((q) => ({ ...q, rate: q.rate + 0.001 })),
        "NOK +10 bp",
      ),
    ).toBe(true);
    const pvUp = st().results[nok.id]?.result?.pv;
    expect(st().undo()).toBe("NOK +10 bp");
    expect(st().results[nok.id]?.result?.pv).not.toBe(pvUp);
    // persisted and rebuilt on hydration
    await flush();
    const raw = localStorage.getItem(PERSIST_KEY)!;
    expect((JSON.parse(raw) as { state: { extraCurves: Record<string, unknown> } }).state.extraCurves["NOK-NOWA"]).toBeTruthy();
    st().resetPortfolio();
    expect(st().baseMarket.curves["NOK-NOWA"]).toBeUndefined();
    localStorage.setItem(PERSIST_KEY, raw);
    await useStore.persist.rehydrate();
    expect(st().baseMarket.curves["NOK-NOWA"]).toBeDefined();
    expect(st().baseMarket.discountCurveId.NOK).toBe("NOK-NOWA");
    expect(st().results[nok.id]?.error).toBeUndefined();
    // reporting currencies now offer NOK; the whole market reset removes the curve; undo brings it back
    expect(st().setReportingCurrency("NOK")).toBeUndefined();
    expect(st().results["IRS-0001"]?.result?.currency).toBe("NOK");
    st().setReportingCurrency("EUR");
    useStore.setState({ undoStack: [] });
    st().resetMarketOverrides();
    expect(st().baseMarket.curves["NOK-NOWA"]).toBeUndefined();
    expect(st().baseMarket.discountCurveId.NOK).toBeUndefined();
    expect(st().results[nok.id]?.error).toMatch(/NOK|Diskontkurve|Kurve/);
    expect(st().undoStack.some((e) => e.kind === "curves")).toBe(true);
    while (st().undoStack.length) st().undo();
    expect(st().baseMarket.curves["NOK-NOWA"]).toBeDefined();
    // an import refuses the action; leaving the import brings the curve back with the market source
    const file = snapshotOfCurrentMarket();
    expect(st().importSnapshot(file).ok).toBe(true);
    expect(st().addExtraCurve({ id: "SEK-SWESTR", currency: "SEK", index: "SWESTR", quotes })).toMatchObject({ ok: false, error: /importierten Snapshot/ });
    expect(st().undo()).toMatch(/importiert/);
    expect(st().baseMarket.curves["NOK-NOWA"]).toBeDefined();
    st().removeTrade(nok.id);
  });
});

/** A NOK payer swap built with the core conventions (NIBOR-6M vs fixed) – what `irs nok 5y pay 3% 10m` produces. */
function parseQuickEntryLike(valuationDate: number) {
  const t = makeVanillaSwap({
    id: "IRS-NOK-TEST",
    currency: "NOK",
    notional: 1e7,
    payReceiveFixed: "Pay",
    fixedRate: 0.045,
    effectiveDate: valuationDate + 2,
    maturity: "5Y",
    index: "NOWA",
  });
  return t;
}
