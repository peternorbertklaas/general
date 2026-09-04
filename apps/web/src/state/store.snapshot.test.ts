/**
 * Snapshot import semantics of the store (review R5-F2): an import replaces the
 * whole market and the valuation date, resets the "modifiziert" flag, keeps the
 * core snapshot id, blocks the quote-rebuild paths and never drops the import
 * silently on a valuation-date change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_QUOTES, marketSnapshotId, parseISO, serializeMarket, toISO, type MarketSnapshotJson } from "@deriva/pricing-core";
import { changeValuationDate, loadSnapshot, marketModified, useStore } from "./store.js";

const snapshotOfCurrentMarket = (): MarketSnapshotJson => JSON.parse(JSON.stringify(serializeMarket(useStore.getState().baseMarket))) as MarketSnapshotJson;
/** Quote set with the first €STR OIS quote moved by `bp` (JSON clone, so the store's set is untouched). */
const bumpedQuotes = (bp: number): typeof SAMPLE_QUOTES => {
  const q = JSON.parse(JSON.stringify(useStore.getState().quotes)) as typeof SAMPLE_QUOTES;
  (q.eurOis[0] as { rate: number }).rate += bp * 1e-4;
  return q;
};

describe("store – snapshot import (R5-F2)", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetPortfolio();
    useStore.setState({ toasts: [], undoStack: [], whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("export → change a quote → import the same file: identical snapshot id, quotes flag reset, quote table back to the sample", () => {
    const s = useStore.getState();
    const file = snapshotOfCurrentMarket();
    const idBefore = marketSnapshotId(s.baseMarket);
    // a quote edit changes the market (and its id)
    expect(s.setQuotes(bumpedQuotes(5), "Quote +5 bp")).toBe(true);
    expect(marketModified(useStore.getState())).toBe(true);
    expect(marketSnapshotId(useStore.getState().baseMarket)).not.toBe(idBefore);
    // importing the exported snapshot restores exactly that market
    const r = useStore.getState().importSnapshot(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe(idBefore);
    expect(marketSnapshotId(useStore.getState().baseMarket)).toBe(idBefore);
    expect(useStore.getState().marketSource).toBe("import");
    expect(marketModified(useStore.getState())).toBe(false);
    expect(JSON.stringify(useStore.getState().quotes)).toBe(JSON.stringify(SAMPLE_QUOTES));
    // the import id is stable across a second import of the same file and equals the report's snapshot id
    expect(useStore.getState().importSnapshot(file)).toMatchObject({ ok: true, id: idBefore });
    // re-export is byte-identical to the imported file
    expect(JSON.stringify(serializeMarket(useStore.getState().baseMarket))).toBe(JSON.stringify(file));
  });

  it("a snapshot with another valuation date sets the app's valuation date to it", () => {
    const file = snapshotOfCurrentMarket();
    file.valuationDate = "2026-10-30";
    const r = useStore.getState().importSnapshot(file);
    expect(r).toMatchObject({ ok: true, dateChanged: true, valuationDate: parseISO("2026-10-30") });
    expect(toISO(useStore.getState().valuationDate)).toBe("2026-10-30");
    expect(useStore.getState().baseMarket.valuationDate).toBe(useStore.getState().valuationDate);
    expect(useStore.getState().market.valuationDate).toBe(useStore.getState().valuationDate);
  });

  it("quote, interpolation and turn-of-year edits are refused while the imported market is active (no silent replacement)", () => {
    const file = snapshotOfCurrentMarket();
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    const id = marketSnapshotId(useStore.getState().baseMarket);
    expect(useStore.getState().setQuotes(bumpedQuotes(300), "x")).toBe(false);
    expect(useStore.getState().setInterpolation("EUR-ESTR", "linearZero")).toBe(false);
    expect(useStore.getState().setTurnOfYear("EUR-ESTR", { date: parseISO("2026-12-31"), bp: 20 })).toBe(false);
    expect(marketSnapshotId(useStore.getState().baseMarket)).toBe(id);
    // vol edits do work on top of the import and flag it as modified; undo restores the imported surface
    const surf = useStore.getState().baseMarket.swaptionVols!.EUR!;
    const edited = { ...surf, atm: surf.atm.map((row, i) => (i === 0 ? row.map((v, j) => (j === 0 ? v + 0.001 : v)) : row)) };
    expect(useStore.getState().setVolSurface("swaptionVols", "EUR", edited, "Vol-Test")).toBe(true);
    expect(marketModified(useStore.getState())).toBe(true);
    expect(marketSnapshotId(useStore.getState().baseMarket)).not.toBe(id);
    expect(useStore.getState().undo()).toBe("Vol-Test");
    expect(marketSnapshotId(useStore.getState().baseMarket)).toBe(id);
    expect(useStore.getState().marketSource).toBe("import");
  });

  it("a valuation-date change never drops the import silently: refused without confirmation, applied with it", () => {
    const file = snapshotOfCurrentMarket();
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    const id = marketSnapshotId(useStore.getState().baseMarket);
    expect(useStore.getState().setValuationDate("2026-09-04")).toBe(false);
    expect(useStore.getState().marketSource).toBe("import");
    expect(marketSnapshotId(useStore.getState().baseMarket)).toBe(id);
    // UI helper: the user declines → nothing changes, a toast says the snapshot stays
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(changeValuationDate("2026-09-04")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(useStore.getState().marketSource).toBe("import");
    expect(useStore.getState().toasts.some((t) => /bleibt geladen/.test(t.msg))).toBe(true);
    // the user confirms → the sample market is rebuilt from the quotes at the new date, with a toast
    confirm.mockReturnValue(true);
    expect(changeValuationDate("2026-09-04")).toBe(true);
    expect(useStore.getState().marketSource).toBe("sample");
    expect(useStore.getState().importedSnapshot).toBeNull();
    expect(toISO(useStore.getState().valuationDate)).toBe("2026-09-04");
    expect(useStore.getState().toasts.some((t) => /verworfen/.test(t.msg))).toBe(true);
    // same date again is a no-op in import mode
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    expect(useStore.getState().setValuationDate(toISO(useStore.getState().valuationDate))).toBe(true);
    expect(useStore.getState().marketSource).toBe("import");
  });

  it("leaveImport returns to the quotes market; resetPortfolio clears the import too", () => {
    const file = snapshotOfCurrentMarket();
    file.valuationDate = "2026-10-30";
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    useStore.getState().leaveImport();
    expect(useStore.getState().marketSource).toBe("sample");
    expect(useStore.getState().baseMarket.meta?.source).not.toBe("import");
    // the valuation date stays at the snapshot's date – only the market source changes
    expect(toISO(useStore.getState().valuationDate)).toBe("2026-10-30");
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    useStore.getState().resetPortfolio();
    expect(useStore.getState().marketSource).toBe("sample");
    expect(useStore.getState().importedSnapshot).toBeNull();
  });

  it("rejects invalid snapshots with a German cause (schema, dates, vol surfaces) and leaves the market untouched", () => {
    const id = marketSnapshotId(useStore.getState().baseMarket);
    const file = snapshotOfCurrentMarket();
    const bad = useStore.getState().importSnapshot({ ...file, valuationDate: "2026-13-45" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toMatch(/Ungültiges Datum: 2026-13-45/);
      expect(bad.error).not.toMatch(/Ungültiges Datum: Ungültiges Datum/);
    }
    const malformedCube = { ...file, swaptionVols: { ...file.swaptionVols, USD: { ...file.swaptionVols!.USD!, atm: [[0.01]] } } };
    const r2 = useStore.getState().importSnapshot(malformedCube);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toMatch(/Vol-Fläche strukturell ungültig – Swaption-Cube USD.*Zeilen.*Verfall/);
      expect(r2.error).not.toMatch(/malformed|expected|rows/);
    }
    const r3 = loadSnapshot({ ...file, discountCurveId: { EUR: "NOPE" } });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toMatch(/Diskontkurve NOPE für EUR fehlt/);
    expect(useStore.getState().marketSource).toBe("sample");
    expect(marketSnapshotId(useStore.getState().baseMarket)).toBe(id);
  });

  it("an imported snapshot survives hydration as the base market (persisted slice)", async () => {
    const file = snapshotOfCurrentMarket();
    file.valuationDate = "2026-10-30";
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    const id = marketSnapshotId(useStore.getState().baseMarket);
    await new Promise((r) => setTimeout(r, 0));
    const raw = localStorage.getItem("deriva.v1")!;
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw) as { state: { marketSource: string; importedSnapshot: MarketSnapshotJson | null } };
    expect(persisted.state.marketSource).toBe("import");
    expect(persisted.state.importedSnapshot?.valuationDate).toBe("2026-10-30");
    // rehydrate into a fresh store state
    useStore.getState().resetPortfolio();
    expect(useStore.getState().marketSource).toBe("sample");
    localStorage.setItem("deriva.v1", raw);
    await useStore.persist.rehydrate();
    expect(useStore.getState().marketSource).toBe("import");
    expect(toISO(useStore.getState().valuationDate)).toBe("2026-10-30");
    expect(marketSnapshotId(useStore.getState().baseMarket)).toBe(id);
    expect(useStore.getState().restored?.quotesModified).toBe(false);
  });
});
