/**
 * Round-9 store semantics (docs/quality/review-ui-r9.md R9-F4, review-markt-r9.md
 * R9-1): „Beispielportfolio laden“ is one undoable action that asks first, and
 * the snapshot's `quotes` block carries the bootstrap specs of the curves
 * outside the sample set, so par risk works after a re-import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Trade, advance, getCalendar, knownCurrencies, makeVanillaSwap, parRisk, serializeMarket } from "@deriva/pricing-core";
import { exportEnvelope, quotesOf, unregisterEnvelope } from "../lib/register-envelope.js";
import { CZK_ENVELOPE, czkSnapshot, jsonClone, sampleSnapshot } from "../test/fixtures-r8.js";
import { PERSIST_KEY, parRiskSpecs, resetPortfolioWithConfirm, snapshotQuoteSpecs, useStore } from "./store.js";

const st = () => useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));
const OIS = [
  { type: "OIS" as const, tenor: "1Y", rate: 0.041 },
  { type: "OIS" as const, tenor: "2Y", rate: 0.0415 },
  { type: "OIS" as const, tenor: "5Y", rate: 0.042 },
  { type: "OIS" as const, tenor: "10Y", rate: 0.043 },
];
const swap = (ccy: string, index: string, id: string): Trade =>
  makeVanillaSwap({
    id,
    currency: ccy,
    notional: 10_000_000,
    payReceiveFixed: "Pay",
    fixedRate: 0.03,
    effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
    maturity: "5Y",
    index,
  });
/** Reload simulation: persist → reset → rehydrate from the persisted slice. */
const reload = async () => {
  await flush();
  const raw = localStorage.getItem(PERSIST_KEY)!;
  st().resetPortfolio();
  localStorage.setItem(PERSIST_KEY, raw);
  await useStore.persist.rehydrate();
};
const hedge = (tradeId: string) => ({
  id: `HR-${tradeId}`,
  name: "Hedge",
  type: "CashFlowHedge" as const,
  hedgedItem: {
    description: "",
    currency: "EUR",
    notional: 1e7,
    kind: "FloatingRateLoan" as const,
    effectiveDate: st().valuationDate,
    maturityDate: st().valuationDate + 3650,
  },
  hedgingInstrumentId: tradeId,
  designationDate: st().valuationDate,
  hedgeRatio: 0.99,
  method: "DollarOffset" as const,
  accountingFramework: "IFRS9" as const,
});

describe("R9-F4 – „Beispielportfolio laden“ is undoable and asks first", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
    unregisterEnvelope(CZK_ENVELOPE);
  });
  afterEach(() => vi.restoreAllMocks());

  it("resetPortfolio pushes one `portfolio` entry; undo brings back trades, registration, curve, hedge documentation and inputs", () => {
    expect(st().addCurrencyRegistration(CZK_ENVELOPE).ok).toBe(true);
    expect(st().addExtraCurve({ id: "CZK-CZEONIA", currency: "CZK", index: "CZEONIA", quotes: OIS }, { fxSpot: { pair: "EURCZK", rate: 24.6 } })).toEqual({
      ok: true,
    });
    const t = st().addTrade(swap("CZK", "CZEONIA", "IRS-CZK"), { select: true });
    expect(st().results[t.id]?.error).toBeUndefined();
    st().setHedgeRelationship(hedge("IRS-0001"));
    st().setReportInputs("IRS-0001", { offerPv: 1234 });
    st().setQuotes({ ...st().quotes, fxSpots: { ...st().quotes.fxSpots, EURUSD: 1.25 } }, "Spot");
    const tradesBefore = st().trades.length;
    const depth = st().undoStack.length;
    st().resetPortfolio();
    expect(st().trades.length).toBe(13);
    expect(st().trades.some((x) => x.id === "IRS-CZK")).toBe(false);
    expect(knownCurrencies()).not.toContain("CZK");
    expect(st().extraCurves).toEqual({});
    expect(st().hedgeRelationships).toEqual({});
    expect(st().quotes.fxSpots.EURUSD).not.toBe(1.25);
    // the reset is one undo entry on top of the older ones – older entries are kept
    expect(st().undoStack.length).toBe(depth + 1);
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "portfolio", label: `Beispielportfolio geladen (${tradesBefore} Trades ersetzt)` });
    expect(st().undo()).toBe(`Beispielportfolio geladen (${tradesBefore} Trades ersetzt)`);
    expect(st().trades.length).toBe(tradesBefore);
    expect(knownCurrencies()).toContain("CZK");
    expect(st().extraCurves["CZK-CZEONIA"]).toBeDefined();
    expect(st().baseMarket.discountCurveId.CZK).toBe("CZK-CZEONIA");
    expect(st().results["IRS-CZK"]?.error).toBeUndefined();
    expect(st().hedgeRelationships["IRS-0001"]?.hedgeRatio).toBe(0.99);
    expect(st().reportInputs["IRS-0001"]?.offerPv).toBe(1234);
    expect(st().quotes.fxSpots.EURUSD).toBe(1.25);
    expect(st().baseMarket.fxSpots.EURUSD).toBe(1.25);
    expect(st().selectedId).toBe("IRS-CZK");
    expect(st().undoStack.length).toBe(depth);
  });

  it("undo of a reset under an imported snapshot restores the import mode and its curves", () => {
    const r = st().importSnapshot(czkSnapshot(st().valuationDate));
    expect(r.ok).toBe(true);
    st().addTrade(swap("CZK", "CZEONIA", "IRS-CZK-IMP"), { select: false });
    expect(st().results["IRS-CZK-IMP"]?.error).toBeUndefined();
    st().resetPortfolio();
    expect(st().marketSource).toBe("sample");
    expect(st().baseMarket.curves["CZK-CZEONIA"]).toBeUndefined();
    expect(st().undo()).toMatch(/^Beispielportfolio geladen/);
    expect(st().marketSource).toBe("import");
    expect(st().baseMarket.curves["CZK-CZEONIA"]).toBeDefined();
    expect(knownCurrencies()).toContain("CZK");
    expect(st().results["IRS-CZK-IMP"]?.error).toBeUndefined();
  });

  it("resetPortfolioWithConfirm asks with the concrete losses, does nothing when declined, resets with a Rückgängig toast when confirmed", () => {
    st().setHedgeRelationship(hedge("IRS-0001"));
    st().setQuotes({ ...st().quotes, fxSpots: { ...st().quotes.fxSpots, EURUSD: 1.25 } }, "Spot");
    const n = st().trades.length;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(resetPortfolioWithConfirm()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      `Bestand (${n} Trades, Marktänderungen, Hedge-Dokumentation) durch das Beispielportfolio ersetzen? (rückgängig mit Ctrl+Z)`,
    );
    expect(st().hedgeRelationships["IRS-0001"]).toBeDefined();
    expect(st().toasts).toEqual([]);
    confirm.mockReturnValue(true);
    expect(resetPortfolioWithConfirm()).toBe(true);
    expect(st().hedgeRelationships).toEqual({});
    const toast = st().toasts.at(-1)!;
    expect(toast.msg).toBe("Beispielportfolio geladen");
    expect(toast.action?.label).toBe("Rückgängig");
    toast.action!.run();
    expect(st().hedgeRelationships["IRS-0001"]).toBeDefined();
    // an untouched sample book asks with the trade count only
    st().resetPortfolio();
    useStore.setState({ undoStack: [] });
    confirm.mockReturnValue(false);
    resetPortfolioWithConfirm();
    expect(confirm).toHaveBeenLastCalledWith("Bestand (13 Trades) durch das Beispielportfolio ersetzen? (rückgängig mit Ctrl+Z)");
  });
});

describe("Markt R9-1 – the snapshot carries the bootstrap specs of its extra curves (`quotes`)", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });

  it("export → fresh import → par DV01 on the imported NOK curve ≠ 0; the block survives the reload and is re-exported", async () => {
    expect(st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS }, { fxSpot: { pair: "EURNOK", rate: 11.62 } })).toEqual({
      ok: true,
    });
    const quotes = snapshotQuoteSpecs(st().baseMarket, st().extraCurves);
    expect(quotes).toEqual([{ curveId: "NOK-NOWA", spec: { id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS } }]);
    // a curve the market does not hold is never exported
    expect(snapshotQuoteSpecs({ curves: {}, discountCurveId: {} }, st().extraCurves)).toEqual([]);
    const file = jsonClone({ ...serializeMarket(st().baseMarket), ...exportEnvelope(), quotes });
    expect(file.curves.some((c) => c.id === "NOK-NOWA")).toBe(true);
    // fresh workstation
    st().resetPortfolio();
    useStore.setState({ undoStack: [] });
    expect(st().extraCurves).toEqual({});
    const r = st().importSnapshot(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quoteCurves).toEqual(["NOK-NOWA"]);
    expect(st().baseMarket.curves["NOK-NOWA"]).toBeDefined();
    expect(st().extraCurves).toEqual({}); // the curve stays the snapshot's – no extra curve was created
    const t = st().addTrade(swap("NOK", "NOWA", "IRS-NOK"), { select: false });
    expect(st().results[t.id]?.error).toBeUndefined();
    const specs = parRiskSpecs(st());
    expect(Object.keys(specs)).toEqual(["NOK-NOWA"]);
    const pr = parRisk(st().market, t, "EUR", specs);
    expect(pr.curves.map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    expect(Math.abs(pr.total)).toBeGreaterThan(1);
    const dv01 = st().risk(t.id)!.dv01;
    expect(Math.sign(pr.total)).toBe(Math.sign(dv01));
    expect(Math.abs(pr.total - dv01) / Math.abs(dv01)).toBeLessThan(0.15);
    // without the block the import mode has nothing to bump (R8-3 hint instead of a silent zero)
    expect(parRiskSpecs({ ...st(), importedSnapshot: { ...file, quotes: undefined } })).toEqual({});
    // reload keeps the block with the persisted snapshot
    await reload();
    expect(st().marketSource).toBe("import");
    expect(quotesOf(st().importedSnapshot).map((q) => q.curveId)).toEqual(["NOK-NOWA"]);
    expect(Object.keys(parRiskSpecs(st()))).toEqual(["NOK-NOWA"]);
    // the export in import mode re-emits the imported block (the "+ Kurve" curves are not applied there)
    expect(snapshotQuoteSpecs(st().baseMarket, {}, quotesOf(st().importedSnapshot)).map((q) => q.curveId)).toEqual(["NOK-NOWA"]);
    // sample mode: the sample specs plus the extra curves
    st().leaveImport();
    expect(Object.keys(parRiskSpecs(st()))).toContain("EUR-ESTR");
  });

  it("a `quotes` entry for a curve the snapshot does not hold, with the wrong currency or an unregistered index is refused", () => {
    const base = sampleSnapshot(st().valuationDate);
    const spec = { id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS };
    expect(st().importSnapshot({ ...base, quotes: [{ curveId: "NOK-NOWA", spec }] })).toMatchObject({
      ok: false,
      error: /Snapshot ungültig: Quotes für Kurve „NOK-NOWA“: Kurve nicht im Snapshot/,
    });
    expect(st().marketSource).toBe("sample");
    const withNok = { ...base, curves: [...base.curves, { ...base.curves.find((c) => c.id === "EUR-ESTR")!, id: "NOK-NOWA", currency: "NOK" }] };
    expect(st().importSnapshot({ ...withNok, quotes: [{ curveId: "NOK-NOWA", spec: { ...spec, currency: "SEK" } }] })).toMatchObject({
      ok: false,
      error: /Währung SEK passt nicht zur Kurve \(NOK\)/,
    });
    expect(st().importSnapshot({ ...withNok, quotes: [{ curveId: "NOK-NOWA", spec: { ...spec, index: "ROBOR-ON" } }] })).toMatchObject({
      ok: false,
      error: /Index „ROBOR-ON“ ist nicht registriert/,
    });
    const ok = st().importSnapshot({
      ...withNok,
      fxSpots: { ...withNok.fxSpots, EURNOK: 11.62 },
      discountCurveId: { ...withNok.discountCurveId, NOK: "NOK-NOWA" },
      quotes: [{ curveId: "NOK-NOWA", spec }],
    });
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.quoteCurves).toEqual(["NOK-NOWA"]);
  });
});
