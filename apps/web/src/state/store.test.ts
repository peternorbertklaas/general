import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_QUOTES, type Trade, parseISO } from "@deriva/pricing-core";
import { newTradeTemplate } from "../lib/templates.js";
import { buildCustomScenario } from "../lib/scenarios.js";
import {
  COMPARE_MAX,
  DEFAULT_REPORT_INPUTS,
  LS_KEYS,
  PERSIST_KEY,
  TOAST_MAX,
  TOAST_MS,
  UNDO_DEPTH,
  buildMarket,
  compareTrades,
  deleteWithUndo,
  marketModified,
  quotesHash,
  quotesModified,
  reportInputsFor,
  reportingCurrencies,
  sampleVolSurfaces,
  useStore,
  volSurfaceCount,
} from "./store.js";

const VAL = parseISO("2026-09-03");

describe("store", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ compareIds: [], customerMode: false, customScenarios: [], toasts: [], view: "blotter", visibleIds: [], undoStack: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("sample portfolio is Live, new trades default to Indication", () => {
    const s = useStore.getState();
    expect(s.trades.length).toBeGreaterThan(5);
    expect(s.trades.every((t) => t.status === "Live")).toBe(true);
    const t = newTradeTemplate("irs", VAL);
    expect(t.status).toBeUndefined();
    s.addTrade(t, { select: false });
    expect(useStore.getState().trades.find((x) => x.id === t.id)?.status).toBe("Indication");
    const live: Trade = { ...newTradeTemplate("cap", VAL), status: "Live" };
    s.addTrade(live, { select: false });
    expect(useStore.getState().trades.find((x) => x.id === live.id)?.status).toBe("Live");
    s.removeTrade(t.id);
    s.removeTrade(live.id);
  });

  it("assigns readable sequential ids and copy names without chains (F-16)", () => {
    const s = useStore.getState();
    const a = s.addTrade(newTradeTemplate("cap", VAL), { autoId: true, select: false });
    expect(a.id).toBe("CAP-0002"); // CAP-0001 exists in the sample book
    const b = useStore.getState().addTrade(newTradeTemplate("cap", VAL), { autoId: true, select: false });
    expect(b.id).toBe("CAP-0003");
    useStore.getState().select(a.id);
    const c1 = useStore.getState().duplicateSelected()!;
    expect(c1.id).toBe("CAP-0004");
    expect(c1.name).toBe(`${a.name} (Kopie)`);
    expect(c1.status).toBe("Indication");
    useStore.getState().select(c1.id);
    const c2 = useStore.getState().duplicateSelected()!;
    expect(c2.name).toBe(`${a.name} (Kopie 2)`);
    for (const id of [a.id, b.id, c1.id, c2.id]) useStore.getState().removeTrade(id);
  });

  it("toggles customer mode and persists it", () => {
    const s = useStore.getState();
    expect(s.customerMode).toBe(false);
    s.toggleCustomerMode();
    expect(useStore.getState().customerMode).toBe(true);
    expect(localStorage.getItem(LS_KEYS.customerMode)).toBe("1");
    useStore.getState().toggleCustomerMode();
    expect(useStore.getState().customerMode).toBe(false);
    expect(localStorage.getItem(LS_KEYS.customerMode)).toBe("0");
  });

  it("compare selection toggles, caps at COMPARE_MAX and drops removed trades", () => {
    const s = useStore.getState();
    const ids = s.trades.map((t) => t.id);
    s.toggleCompare(ids[0]!);
    s.toggleCompare(ids[1]!);
    expect(useStore.getState().compareIds).toEqual([ids[0], ids[1]]);
    expect(compareTrades(useStore.getState()).map((t) => t.id)).toEqual([ids[0], ids[1]]);
    s.toggleCompare(ids[0]!);
    expect(useStore.getState().compareIds).toEqual([ids[1]]);
    for (const id of ids.slice(2, 2 + COMPARE_MAX + 2)) useStore.getState().toggleCompare(id);
    expect(useStore.getState().compareIds.length).toBe(COMPARE_MAX);
    expect(useStore.getState().toasts.some((t) => t.msg.includes(`Maximal ${COMPARE_MAX}`))).toBe(true);
    const extra = newTradeTemplate("fxf", VAL);
    useStore.getState().addTrade(extra, { select: false });
    useStore.setState({ compareIds: [extra.id, ids[1]!] });
    useStore.getState().removeTrade(extra.id);
    expect(useStore.getState().compareIds).toEqual([ids[1]]);
    useStore.getState().clearCompare();
    expect(useStore.getState().compareIds).toEqual([]);
  });

  it("imports trades with validation and duplicate suffixes", () => {
    const s = useStore.getState();
    const before = s.trades.length;
    const dup = s.trades[0]!;
    const fresh = { ...newTradeTemplate("swpt", VAL), id: "SWPT-IMPORT-1" };
    const broken = { id: "BROKEN", type: "InterestRateSwap", legs: [] } as unknown as Trade;
    const garbage = { foo: 1 } as unknown as Trade;
    const r = s.importTrades([dup, fresh, broken, garbage]);
    expect(r).toEqual({ added: 2, invalid: 2, renamed: 1, skipped: 0, replaced: 0 });
    const st = useStore.getState();
    expect(st.trades.length).toBe(before + 2);
    expect(st.trades.find((t) => t.id === `${dup.id}-IMP`)).toBeDefined();
    expect(st.trades.find((t) => t.id === "SWPT-IMPORT-1")?.status).toBe("Indication");
    expect(st.results["SWPT-IMPORT-1"]?.result).toBeDefined();
    expect(useStore.getState().importTrades([dup]).renamed).toBe(1);
    expect(useStore.getState().trades.find((t) => t.id === `${dup.id}-IMP2`)).toBeDefined();
    for (const id of [`${dup.id}-IMP`, `${dup.id}-IMP2`, "SWPT-IMPORT-1"]) useStore.getState().removeTrade(id);
    expect(useStore.getState().trades.length).toBe(before);
  });

  it("adds and removes custom scenarios (persisted)", () => {
    const s = useStore.getState();
    const sc = buildCustomScenario({ name: "Test", parallelBp: 50, shortBp: 0, longBp: 25, fxPct: -2, irVolBp: 5, daysForward: 30 }, "custom-test");
    s.addScenario(sc);
    expect(useStore.getState().customScenarios.map((x) => x.id)).toEqual(["custom-test"]);
    expect(JSON.parse(localStorage.getItem(LS_KEYS.customScenarios)!)).toHaveLength(1);
    useStore.getState().removeScenario("custom-test");
    expect(useStore.getState().customScenarios).toEqual([]);
  });

  it("queues multiple toasts (with actions) and auto-dismisses them", () => {
    vi.useFakeTimers();
    const s = useStore.getState();
    s.showToast("eins");
    const run = vi.fn();
    s.showToast("zwei", { action: { label: "Rückgängig", run } });
    expect(useStore.getState().toasts.map((t) => t.msg)).toEqual(["eins", "zwei"]);
    expect(useStore.getState().toasts[1]!.action?.label).toBe("Rückgängig");
    vi.advanceTimersByTime(TOAST_MS + 10);
    expect(useStore.getState().toasts.map((t) => t.msg)).toEqual(["zwei"]);
    vi.advanceTimersByTime(10000);
    expect(useStore.getState().toasts).toEqual([]);
  });

  it("palette can be opened with an initial query", () => {
    useStore.getState().setPalette(true, "irs 10y pay 3.1% 10m");
    expect(useStore.getState().paletteInitialQuery).toBe("irs 10y pay 3.1% 10m");
    useStore.getState().setPalette(false);
    expect(useStore.getState().paletteOpen).toBe(false);
    expect(useStore.getState().paletteInitialQuery).toBeNull();
  });

  it("j/k follow the visible (sorted/filtered) order (F-09)", () => {
    const s = useStore.getState();
    const ids = s.trades.map((t) => t.id);
    s.setVisibleIds([ids[3]!, ids[0]!, ids[5]!]);
    s.select(ids[3]!);
    s.selectNext(1);
    expect(useStore.getState().selectedId).toBe(ids[0]);
    useStore.getState().selectNext(1);
    expect(useStore.getState().selectedId).toBe(ids[5]);
    useStore.getState().selectNext(1); // clamps at the end
    expect(useStore.getState().selectedId).toBe(ids[5]);
    useStore.getState().selectNext(-2);
    expect(useStore.getState().selectedId).toBe(ids[3]);
    // a selection outside the visible list jumps to the first visible row
    useStore.getState().select(ids[1]!);
    useStore.getState().selectNext(1);
    expect(useStore.getState().selectedId).toBe(ids[3]);
    useStore.getState().setVisibleIds([]);
    useStore.getState().select(ids[0]!);
    useStore.getState().selectNext(1);
    expect(useStore.getState().selectedId).toBe(ids[1]);
  });

  it("undo restores deleted / changed trades and is bounded (F-18)", () => {
    const s = useStore.getState();
    const before = s.trades.map((t) => t.id);
    const victim = s.trades[2]!;
    s.removeTrade(victim.id);
    expect(useStore.getState().trades.some((t) => t.id === victim.id)).toBe(false);
    expect(useStore.getState().undo()).toBe(`Löschen ${victim.id}`);
    expect(useStore.getState().trades.map((t) => t.id)).toEqual(before);
    expect(useStore.getState().results[victim.id]?.result).toBeDefined();
    // delete via toast action
    deleteWithUndo(victim.id);
    const toast = useStore.getState().toasts.find((t) => t.action?.label === "Rückgängig");
    expect(toast).toBeDefined();
    toast!.action!.run();
    expect(useStore.getState().trades.map((t) => t.id)).toEqual(before);
    // bounded depth; edits of the same trade within 1 s are coalesced
    const irs = useStore.getState().trades.find((t) => t.type === "InterestRateSwap")!;
    for (let i = 0; i < UNDO_DEPTH + 5; i++) useStore.getState().updateTrade({ ...irs, name: `n${i}` });
    expect(useStore.getState().undoStack.length).toBeLessThanOrEqual(UNDO_DEPTH);
    expect(useStore.getState().undo()).toBe(`Änderung ${irs.id}`);
    useStore.getState().updateTrade(irs);
    useStore.setState({ undoStack: [] });
    expect(useStore.getState().undo()).toBeNull();
  });

  it("quotes live in the store; the valuation date rebuilds with them (F-12)", () => {
    const s = useStore.getState();
    expect(quotesModified(s.quotes)).toBe(false);
    const q = JSON.parse(JSON.stringify(s.quotes)) as typeof s.quotes;
    const first = q.eurOis[0]!;
    if ("rate" in first) first.rate += 0.001;
    expect(s.setQuotes(q)).toBe(true);
    expect(quotesModified(useStore.getState().quotes)).toBe(true);
    const zeroBefore = useStore.getState().baseMarket.curves["EUR-ESTR"]!.zeroRate(VAL + 365);
    expect(useStore.getState().setValuationDate("2026-12-31")).toBe(true);
    const st = useStore.getState();
    expect(st.valuationDate).toBe(parseISO("2026-12-31"));
    expect(quotesModified(st.quotes)).toBe(true);
    const zeroAfter = st.baseMarket.curves["EUR-ESTR"]!.zeroRate(st.valuationDate + 365);
    expect(Math.abs(zeroAfter - zeroBefore)).toBeLessThan(0.002); // bumped quotes survived the date change
    expect(useStore.getState().setValuationDate("not-a-date")).toBe(false);
    useStore.getState().resetQuotes();
    expect(quotesModified(useStore.getState().quotes)).toBe(false);
    useStore.getState().setValuationDate("2026-09-03");
  });

  it("persists the book and restores it from localStorage (F-13)", async () => {
    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as { state: { trades: Trade[]; view: string; reportingCurrency: string } };
    expect(saved.state.trades.length).toBe(useStore.getState().trades.length);
    // simulate a reload with a different persisted book
    const two = useStore.getState().trades.slice(0, 2);
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        version: 1,
        state: {
          trades: two,
          quotes: SAMPLE_QUOTES,
          valuationDate: VAL,
          reportingCurrency: "USD",
          view: "curves",
          inspectorOpen: false,
          customerMode: false,
          hedgeRelationships: {},
          selectedId: two[1]!.id,
        },
      }),
    );
    await useStore.persist.rehydrate();
    const st = useStore.getState();
    expect(st.trades.map((t) => t.id)).toEqual(two.map((t) => t.id));
    expect(st.reportingCurrency).toBe("USD");
    expect(st.view).toBe("curves");
    expect(st.inspectorOpen).toBe(false);
    expect(st.selectedId).toBe(two[1]!.id);
    expect(st.results[two[0]!.id]?.result?.currency).toBe("USD");
    expect(st.restored).toEqual({ trades: 2, quotesModified: false });
    // garbage is ignored
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ version: 1, state: { trades: "nope" } }));
    await useStore.persist.rehydrate();
    expect(useStore.getState().trades.length).toBe(2);
    useStore.getState().resetPortfolio();
    useStore.getState().setReportingCurrency("EUR");
    useStore.getState().setView("blotter");
    expect(useStore.getState().trades.length).toBeGreaterThan(5);
  });
  it("import strategies: skip keeps the existing trade, replace swaps it (N-24)", () => {
    const s = useStore.getState();
    const before = s.trades.length;
    const dup = { ...s.trades[0]!, name: "Ersetzte Version" };
    expect(s.importTrades([dup], { onDuplicate: "skip" })).toEqual({ added: 0, invalid: 0, renamed: 0, skipped: 1, replaced: 0 });
    expect(useStore.getState().trades.length).toBe(before);
    expect(useStore.getState().trades[0]!.name).not.toBe("Ersetzte Version");
    expect(useStore.getState().importTrades([dup], { onDuplicate: "replace" })).toEqual({ added: 1, invalid: 0, renamed: 0, skipped: 0, replaced: 1 });
    expect(useStore.getState().trades.length).toBe(before);
    expect(useStore.getState().trades.find((t) => t.id === dup.id)?.name).toBe("Ersetzte Version");
    expect(useStore.getState().undo()).toBe("Import (1)");
    expect(useStore.getState().trades.find((t) => t.id === dup.id)?.name).not.toBe("Ersetzte Version");
  });

  it("caps the toast stack at TOAST_MAX and coalesces identical messages (N-09)", () => {
    vi.useFakeTimers();
    const s = useStore.getState();
    for (let i = 0; i < 7; i++) s.showToast(`Meldung ${i}`);
    expect(useStore.getState().toasts.length).toBe(TOAST_MAX);
    expect(useStore.getState().toasts.map((t) => t.msg)).toEqual(["Meldung 3", "Meldung 4", "Meldung 5", "Meldung 6"]);
    const run = vi.fn();
    useStore.setState({ toasts: [] });
    s.showToast("mit Aktion", { action: { label: "Rückgängig", run } });
    for (let i = 0; i < 5; i++) s.showToast(`ohne ${i}`);
    // the toast with an action survives, plain toasts are dropped first
    expect(useStore.getState().toasts.some((t) => t.msg === "mit Aktion")).toBe(true);
    expect(useStore.getState().toasts.length).toBe(TOAST_MAX);
    useStore.setState({ toasts: [] });
    s.showToast("Zeile kopiert");
    s.showToast("Zeile kopiert");
    s.showToast("Zeile kopiert");
    expect(useStore.getState().toasts.length).toBe(1);
    expect(useStore.getState().toasts[0]!.count).toBe(3);
    vi.advanceTimersByTime(TOAST_MS + 10);
    expect(useStore.getState().toasts.length).toBe(0);
  });

  it("undo covers quote changes and the label names the quote (N-14)", () => {
    const s = useStore.getState();
    useStore.setState({ undoStack: [] });
    const q = JSON.parse(JSON.stringify(s.quotes)) as typeof s.quotes;
    const first = q.eurOis[0]!;
    if ("rate" in first) first.rate += 0.001;
    expect(s.setQuotes(q, "Quote OIS 1M 2,02 → 2,12 %")).toBe(true);
    expect(quotesModified(useStore.getState().quotes)).toBe(true);
    const top = useStore.getState().undoStack.at(-1)!;
    expect(top.kind).toBe("quotes");
    expect(top.label).toBe("Quote OIS 1M 2,02 → 2,12 %");
    // a trade edit after the quote edit is undone first (LIFO), the quote edit second
    const irs = useStore.getState().trades.find((t) => t.type === "InterestRateSwap")!;
    useStore.getState().updateTrade({ ...irs, name: "geändert" });
    expect(useStore.getState().undo()).toBe(`Änderung ${irs.id}`);
    expect(useStore.getState().undo()).toBe("Quote OIS 1M 2,02 → 2,12 %");
    expect(quotesModified(useStore.getState().quotes)).toBe(false);
    expect(useStore.getState().undo()).toBeNull();
  });

  it("does not price trades with error-level validation issues (N-21)", () => {
    const s = useStore.getState();
    const fxf = { ...newTradeTemplate("fxf", VAL), id: "FXF-BAD", sellCurrency: "EUR" } as Trade;
    s.addTrade(fxf, { select: false });
    const r = useStore.getState().results["FXF-BAD"]!;
    expect(r.result).toBeUndefined();
    expect(r.error).toMatch(/Ungültige Eingaben: Kauf- und Verkaufswährung/);
    expect(useStore.getState().risk("FXF-BAD")).toBeUndefined();
    // fixing the input prices again
    useStore.getState().updateTrade({ ...fxf, sellCurrency: "USD" } as Trade);
    expect(useStore.getState().results["FXF-BAD"]!.result?.pv).toBeDefined();
    useStore.getState().removeTrade("FXF-BAD");
  });

  it("report inputs are stored per trade and persisted; customer mode forces the client perspective (N-17)", async () => {
    const s = useStore.getState();
    const id = s.trades[0]!.id;
    expect(reportInputsFor(s, id)).toEqual(DEFAULT_REPORT_INPUTS);
    s.setReportInputs(id, { offerPv: 25000, perspective: "Bank" });
    expect(reportInputsFor(useStore.getState(), id)).toEqual({ ...DEFAULT_REPORT_INPUTS, offerPv: 25000, perspective: "Bank" });
    expect(reportInputsFor({ ...useStore.getState(), customerMode: true }, id).perspective).toBe("Kunde");
    const saved = JSON.parse(localStorage.getItem(PERSIST_KEY)!) as { state: { reportInputs: Record<string, unknown> } };
    expect(saved.state.reportInputs[id]).toMatchObject({ offerPv: 25000 });
    useStore.getState().resetReportInputs(id);
    expect(useStore.getState().reportInputs[id]).toBeUndefined();
  });

  it("interpolation overrides live in the store, survive a valuation-date change and flag the market as modified (N-23)", () => {
    const s = useStore.getState();
    expect(marketModified(s)).toBe(false);
    expect(s.setInterpolation("EUR-ESTR", "linearZero")).toBe(true);
    let st = useStore.getState();
    expect(st.interpolation["EUR-ESTR"]).toBe("linearZero");
    expect(marketModified(st)).toBe(true);
    expect((st.baseMarket.curves["EUR-ESTR"] as { interpolation?: string }).interpolation).toBe("linearZero");
    expect(st.setValuationDate("2026-10-30")).toBe(true);
    st = useStore.getState();
    expect((st.baseMarket.curves["EUR-ESTR"] as { interpolation?: string }).interpolation).toBe("linearZero");
    expect(quotesHash(st.quotes)).toBe(quotesHash(SAMPLE_QUOTES));
    st.setInterpolation("EUR-ESTR", undefined);
    expect(marketModified(useStore.getState())).toBe(false);
    useStore.getState().setValuationDate("2026-09-03");
  });

  it("sample book carries CCS-0001 and FRA-0001 with regulatory fields; reporting currency cycles through JPY only with a JPY discount curve", () => {
    const s = useStore.getState();
    const ccs = s.trades.find((t) => t.id === "CCS-0001")!;
    const fra = s.trades.find((t) => t.id === "FRA-0001")!;
    expect(ccs.type).toBe("CrossCurrencySwap");
    expect(fra.type).toBe("FRA");
    expect(fra.cleared).toBe(true);
    expect(fra.clearingMember).toBe("Eurex Clearing AG");
    expect(ccs.uti).toMatch(/CCS0001$/);
    expect(s.results["CCS-0001"]?.result?.analytics.fairSpread).toBeDefined();
    expect(s.results["FRA-0001"]?.result?.analytics.forwardRate).toBeDefined();
    expect(reportingCurrencies(s.baseMarket)).toEqual(["EUR", "USD", "GBP", "CHF", "JPY"]);
    expect(reportingCurrencies({ discountCurveId: { EUR: "EUR-ESTR" } })).toEqual(["EUR", "USD", "GBP", "CHF"]);
    s.setReportingCurrency("CHF");
    useStore.getState().cycleReportingCurrency();
    expect(useStore.getState().reportingCurrency).toBe("JPY");
    expect(useStore.getState().results["IRS-0001"]?.result?.currency).toBe("JPY");
    useStore.getState().cycleReportingCurrency();
    expect(useStore.getState().reportingCurrency).toBe("EUR");
  });

  it("turn-of-year jumps live in the store, re-bootstrap the curve, count as modified and persist (Kurven)", () => {
    const s = useStore.getState();
    expect(marketModified(s)).toBe(false);
    const toy = { date: parseISO("2026-12-31"), bp: 15 };
    expect(s.setTurnOfYear("EUR-ESTR", toy)).toBe(true);
    let st = useStore.getState();
    expect(st.turnOfYear["EUR-ESTR"]).toEqual(toy);
    expect(marketModified(st)).toBe(true);
    const curve = st.baseMarket.curves["EUR-ESTR"] as { forwardJumps?: readonly { bp: number }[] };
    expect(curve.forwardJumps?.length).toBe(1);
    expect(curve.forwardJumps?.[0]?.bp).toBe(15);
    // the jump raises the forward over the year end against the unshifted curve
    const plain = buildMarket(st.valuationDate, st.quotes, {}).curves["EUR-ESTR"]!;
    const d = parseISO("2026-12-31");
    expect(st.baseMarket.curves["EUR-ESTR"]!.forwardRate(d, d + 1, "ACT/360")).toBeGreaterThan(plain.forwardRate(d, d + 1, "ACT/360") + 0.001);
    const saved = JSON.parse(localStorage.getItem(PERSIST_KEY)!) as { state: { turnOfYear: Record<string, unknown> } };
    expect(saved.state.turnOfYear["EUR-ESTR"]).toEqual(toy);
    // a jump in the past is ignored by the bootstrap but still stored
    expect(useStore.getState().setValuationDate("2027-01-15")).toBe(true);
    st = useStore.getState();
    expect((st.baseMarket.curves["EUR-ESTR"] as { forwardJumps?: readonly unknown[] }).forwardJumps?.length ?? 0).toBe(0);
    useStore.getState().setValuationDate("2026-09-03");
    useStore.getState().setTurnOfYear("EUR-ESTR", undefined);
    expect(marketModified(useStore.getState())).toBe(false);
  });

  it("interpolation and turn-of-year changes are undoable market entries; a jump on/before the valuation date is refused (R3-F2 / R3-F3)", () => {
    const s = useStore.getState();
    useStore.setState({ undoStack: [] });
    expect(s.setInterpolation("EUR-ESTR", "monotoneConvex")).toBe(true);
    let top = useStore.getState().undoStack.at(-1)!;
    expect(top.kind).toBe("market");
    expect(top.label).toBe("Interpolation EUR-ESTR log-linear (DF) → monoton-konvex (Hagan–West)");
    expect(useStore.getState().setTurnOfYear("EUR-ESTR", { date: parseISO("2026-12-31"), bp: 20 })).toBe(true);
    top = useStore.getState().undoStack.at(-1)!;
    expect(top.kind).toBe("market");
    expect(top.label).toBe("Turn-of-Year EUR-ESTR 31.12.2026 +20 bp");
    // LIFO: the jump goes first, then the interpolation – the override is gone, no trade is touched
    const tradesBefore = useStore.getState().trades;
    expect(useStore.getState().undo()).toBe("Turn-of-Year EUR-ESTR 31.12.2026 +20 bp");
    expect(useStore.getState().turnOfYear["EUR-ESTR"]).toBeUndefined();
    expect(useStore.getState().interpolation["EUR-ESTR"]).toBe("monotoneConvex");
    expect(useStore.getState().undo()).toMatch(/^Interpolation EUR-ESTR/);
    expect(useStore.getState().interpolation["EUR-ESTR"]).toBeUndefined();
    expect(useStore.getState().trades).toBe(tradesBefore);
    expect(marketModified(useStore.getState())).toBe(false);
    // past jump: refused, nothing stored, no undo entry
    expect(useStore.getState().setTurnOfYear("EUR-ESTR", { date: parseISO("2020-01-01"), bp: 25 })).toBe(false);
    expect(useStore.getState().setTurnOfYear("EUR-ESTR", { date: useStore.getState().valuationDate, bp: 25 })).toBe(false);
    expect(useStore.getState().turnOfYear["EUR-ESTR"]).toBeUndefined();
    expect(useStore.getState().undoStack.length).toBe(0);
  });

  it("vol surfaces are editable market data: override, modified flag, undo, reset, persistence (Markt R3-4)", () => {
    const s = useStore.getState();
    useStore.setState({ undoStack: [] });
    const sample = sampleVolSurfaces();
    const swpt = sample.swaptionVols.EUR!;
    const before = useStore.getState().results["SWPT-0001"]!.result!.pv;
    const bumped = { ...swpt, atm: swpt.atm.map((row) => row.map((v) => v + 0.001)) };
    expect(s.setVolSurface("swaptionVols", "EUR", bumped, "Swaption-Vol EUR 1M×1Y 60,0 → 70,0 bp")).toBe(true);
    let st = useStore.getState();
    expect(volSurfaceCount(st.volSurfaces)).toBe(1);
    expect(marketModified(st)).toBe(true);
    expect(st.baseMarket.swaptionVols?.EUR?.atm[0]![0]).toBeCloseTo(swpt.atm[0]![0]! + 0.001, 12);
    expect(st.results["SWPT-0001"]!.result!.pv).toBeGreaterThan(before); // long payer swaption gains with higher vol
    expect(st.undoStack.at(-1)!.kind).toBe("vols");
    // survives a valuation-date change and is persisted
    expect(st.setValuationDate("2026-09-30")).toBe(true);
    expect(useStore.getState().baseMarket.swaptionVols?.EUR?.atm[0]![0]).toBeCloseTo(swpt.atm[0]![0]! + 0.001, 12);
    const saved = JSON.parse(localStorage.getItem(PERSIST_KEY)!) as { state: { volSurfaces: { swaptionVols?: Record<string, unknown> } } };
    expect(saved.state.volSurfaces.swaptionVols?.EUR).toBeDefined();
    useStore.getState().setValuationDate("2026-09-03");
    // undo restores the sample surface
    expect(useStore.getState().undo()).toBe("Swaption-Vol EUR 1M×1Y 60,0 → 70,0 bp");
    st = useStore.getState();
    expect(volSurfaceCount(st.volSurfaces)).toBe(0);
    expect(st.baseMarket.swaptionVols?.EUR?.atm[0]![0]).toBeCloseTo(swpt.atm[0]![0]!, 12);
    expect(st.results["SWPT-0001"]!.result!.pv).toBeCloseTo(before, 6);
    // FX smile edit + reset
    const fx = sample.fxVols.EURUSD!;
    expect(st.setVolSurface("fxVols", "EURUSD", { ...fx, atm: fx.atm.map((v) => v + 0.01) }, "FX-Vol EURUSD 1M ATM 7,00 → 8,00 %")).toBe(true);
    expect(marketModified(useStore.getState())).toBe(true);
    useStore.getState().resetVolSurfaces();
    expect(marketModified(useStore.getState())).toBe(false);
    expect(useStore.getState().undoStack.at(-1)!.label).toBe("Vol-Flächen zurückgesetzt");
    useStore.setState({ undoStack: [] });
  });

  it("removing a hedge documentation is undoable (R3-F4); popovers count separately from modals (R3-02)", () => {
    const s = useStore.getState();
    useStore.setState({ undoStack: [], hedgeRelationships: {} });
    const rel = {
      id: "HR-IRS-0001",
      name: "Test",
      type: "CashFlowHedge" as const,
      hedgedItem: { description: "", currency: "EUR", notional: 1e7, kind: "FloatingRateLoan" as const, effectiveDate: VAL, maturityDate: VAL + 3650 },
      hedgingInstrumentId: "IRS-0001",
      designationDate: VAL,
      hedgeRatio: 0.5,
      method: "DollarOffset" as const,
      accountingFramework: "IFRS9" as const,
    };
    s.setHedgeRelationship(rel);
    s.removeHedgeRelationship("IRS-0001");
    expect(useStore.getState().hedgeRelationships["IRS-0001"]).toBeUndefined();
    expect(useStore.getState().undoStack.at(-1)).toMatchObject({ kind: "hedge", tradeId: "IRS-0001", label: "Sicherungsdokumentation IRS-0001 verworfen" });
    expect(useStore.getState().undo()).toBe("Sicherungsdokumentation IRS-0001 verworfen");
    expect(useStore.getState().hedgeRelationships["IRS-0001"]?.hedgeRatio).toBe(0.5);
    s.removeHedgeRelationship("IRS-0001");
    s.removeHedgeRelationship("IRS-0001"); // no-op, no extra undo entry
    expect(useStore.getState().undoStack.filter((e) => e.kind === "hedge").length).toBe(1);
    useStore.setState({ undoStack: [], hedgeRelationships: {} });
    expect(useStore.getState().popoverDepth).toBe(0);
    s.openPopover();
    expect(useStore.getState().popoverDepth).toBe(1);
    expect(useStore.getState().modalDepth).toBe(0);
    s.closePopover();
    s.closePopover();
    expect(useStore.getState().popoverDepth).toBe(0);
  });

  it("CDS term structures are stored per counterparty and persisted (Markt)", () => {
    const s = useStore.getState();
    s.setCdsCurve("Landesbank A", [
      { tenor: "1Y", spread: 0.008 },
      { tenor: "5Y", spread: 0.012 },
    ]);
    expect(useStore.getState().cdsCurves["Landesbank A"]?.length).toBe(2);
    const saved = JSON.parse(localStorage.getItem(PERSIST_KEY)!) as { state: { cdsCurves: Record<string, unknown[]> } };
    expect(saved.state.cdsCurves["Landesbank A"]?.length).toBe(2);
    useStore.getState().setCdsCurve("Landesbank A", []);
    expect(useStore.getState().cdsCurves["Landesbank A"]).toBeUndefined();
  });

  it("germanises English builder names on add (N-07)", () => {
    const s = useStore.getState();
    const t = s.addTrade({ ...newTradeTemplate("fxf", VAL), id: "FXF-NAME", name: "Sell EURUSD 2.000.000 @ 1.1725" }, { select: false });
    expect(t.name).toBe("Verkauf EUR/USD 2.000.000 @ 1,1725");
    useStore.getState().removeTrade("FXF-NAME");
  });
});
