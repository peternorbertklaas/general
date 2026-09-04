/** App-level regression tests for the round-6 reviews (docs/quality/review-ui-r6.md, review-markt-r6.md). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type MarketSnapshotJson, marketSnapshotId, serializeMarket } from "@deriva/pricing-core";
import { App } from "./App.js";
import { useStore } from "./state/store.js";
import { preloadViews } from "./views/lazy-views.js";

const st = () => useStore.getState();
const snapshotOfCurrentMarket = (): MarketSnapshotJson => JSON.parse(JSON.stringify(serializeMarket(st().baseMarket))) as MarketSnapshotJson;

describe("App – round 6", () => {
  beforeAll(() => preloadViews());
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    useStore.setState({
      view: "blotter",
      selectedId: "IRS-0001",
      compareIds: [],
      customerMode: false,
      inspectorOpen: true,
      paletteOpen: false,
      helpOpen: false,
      valDateOpen: false,
      toasts: [],
      modalDepth: 0,
      popoverDepth: 0,
      chordPrefix: null,
      whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 },
      docKind: null,
      reportStamp: null,
      reportKey: null,
      riskCache: {},
      undoStack: [],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("Markt R6-5: '+ Kurve' adds a DKK OIS curve from quotes, its quotes are editable in its own tab, the curve can be removed", async () => {
    render(<App />);
    act(() => st().setView("curves"));
    fireEvent.click(screen.getByTestId("add-curve"));
    const form = screen.getByTestId("add-curve-form");
    expect(form).toBeInTheDocument();
    const ccy = screen.getByTestId("add-curve-ccy") as HTMLSelectElement;
    // default: a currency without a curve; the index select offers the registered indices of that currency
    expect(st().baseMarket.discountCurveId[ccy.value]).toBeUndefined();
    fireEvent.change(ccy, { target: { value: "DKK" } });
    const index = screen.getByTestId("add-curve-index") as HTMLSelectElement;
    expect(index.value).toBe("DESTR");
    expect(Array.from(index.options).map((o) => o.value)).toEqual(expect.arrayContaining(["CIBOR-3M", "CIBOR-6M", "DESTR"]));
    expect(form.textContent).toMatch(/DKK-DESTR/);
    // a bad quote line blocks the submit with a German problem
    const quotes = screen.getByTestId("add-curve-quotes") as HTMLTextAreaElement;
    fireEvent.change(quotes, { target: { value: "1Y;3,0\nfoo" } });
    expect(screen.getByTestId("add-curve-problem").textContent).toMatch(/Zeile „foo“ nicht lesbar/);
    expect((screen.getByTestId("add-curve-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(quotes, { target: { value: "1Y;3,0\n2Y;3,1\n5Y;3,2\n10Y;3,3" } });
    expect(screen.queryByTestId("add-curve-problem")).toBeNull();
    const spot = screen.getByTestId("add-curve-spot") as HTMLInputElement;
    fireEvent.focus(spot);
    fireEvent.change(spot, { target: { value: "7,46" } });
    fireEvent.keyDown(spot, { key: "Enter" });
    fireEvent.click(screen.getByTestId("add-curve-submit"));
    expect(st().extraCurves["DKK-DESTR"]).toBeDefined();
    expect(st().baseMarket.discountCurveId.DKK).toBe("DKK-DESTR");
    // R7-F1: the spot travels with the curve (not the quote set) and reaches the market
    expect(st().extraCurves["DKK-DESTR"]!.fxSpot).toEqual({ pair: "EURDKK", rate: 7.46 });
    expect(st().baseMarket.fxSpots.EURDKK).toBeCloseTo(7.46, 6);
    expect(st().quotes.fxSpots.EURDKK).toBeUndefined();
    expect(st().toasts.some((t) => /Kurve DKK-DESTR aus 4 Quotes angelegt/.test(t.msg) && t.action?.label === "Rückgängig")).toBe(true);
    expect(screen.queryByTestId("add-curve-form")).toBeNull();
    // the new tab is selected and its quotes are editable (undo entry "curves")
    const tab = screen.getByTestId("curve-tab-DKK-DESTR");
    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("curve-extra-badge")).toBeInTheDocument();
    const cells = within(screen.getByTestId("quotes-table")).getAllByRole("textbox");
    expect(cells).toHaveLength(4);
    fireEvent.focus(cells[0]!);
    fireEvent.change(cells[0]!, { target: { value: "3,5" } });
    fireEvent.keyDown(cells[0]!, { key: "Enter" });
    expect((st().extraCurves["DKK-DESTR"]!.quotes[0] as { rate: number }).rate).toBeCloseTo(0.035, 10);
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "curves" });
    // Quotes ±10 bp on the added curve, then the whole tab set stays consistent after a bump
    fireEvent.click(screen.getByText("Quotes +10 bp"));
    expect((st().extraCurves["DKK-DESTR"]!.quotes[0] as { rate: number }).rate).toBeCloseTo(0.036, 10);
    expect(screen.getAllByText(/modifiziert/).length).toBeGreaterThan(0);
    // reporting currency rotation now offers DKK
    expect(screen.getByRole("button", { name: /Reporting-Währung/ })).toBeInTheDocument();
    // remove the curve (asks first)
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("remove-curve"));
    expect(st().extraCurves["DKK-DESTR"]).toBeUndefined();
    expect(screen.queryByTestId("curve-tab-DKK-DESTR")).toBeNull();
    act(() => {
      st().undo();
    });
    expect(st().extraCurves["DKK-DESTR"]).toBeDefined();
    // the palette prices a DKK swap now
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "irs dkk 5y pay 3% 10m" } });
    expect(screen.getByRole("listbox").textContent).toMatch(/Payer-Swap DKK 5Y/);
    fireEvent.change(input, { target: { value: "irs sek 5y pay 3% 10m" } });
    expect(document.querySelector(".palette")!.textContent).toMatch(/Keine Kurve für SEK im Markt/);
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("R6-04 / R6-F1 / R6-F2: import mode disables the quote controls, a spot edit is a flagged override with reset, leaving is undoable", async () => {
    const file = snapshotOfCurrentMarket();
    render(<App />);
    act(() => {
      st().importSnapshot(file);
      st().setView("curves");
    });
    const id0 = marketSnapshotId(st().baseMarket);
    expect((screen.getByTestId("interp-select") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId("interp-select")).toHaveAttribute("title", expect.stringMatching(/importierten Snapshot/));
    expect((screen.getByTestId("toy-apply") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("add-curve") as HTMLButtonElement).disabled).toBe(true);
    const quoteCells = within(screen.getByTestId("quotes-table")).getAllByRole("textbox") as HTMLInputElement[];
    expect(quoteCells.every((c) => c.disabled)).toBe(true);
    expect(screen.getByText(/Sample-Quotes \(nur Information/)).toBeInTheDocument();
    // market view: spot edit → override
    act(() => st().setView("market"));
    const spot = screen.getByLabelText("Spot EURUSD") as HTMLInputElement;
    fireEvent.focus(spot);
    fireEvent.change(spot, { target: { value: "1,25" } });
    fireEvent.keyDown(spot, { key: "Enter" });
    expect(st().fxSpotOverrides).toEqual({ EURUSD: 1.25 });
    expect(marketSnapshotId(st().baseMarket)).not.toBe(id0);
    expect(screen.getByTestId("spot-edited")).toBeInTheDocument();
    expect(screen.getAllByText(/modifiziert/).length).toBeGreaterThan(0);
    const reset = screen.getByTestId("market-reset");
    expect(reset.textContent).toBe("Auf Snapshot zurücksetzen");
    fireEvent.click(reset);
    expect(st().fxSpotOverrides).toEqual({});
    expect(marketSnapshotId(st().baseMarket)).toBe(id0);
    // fixings editor: filter by index / year, paging, edit → override badge → reset
    const idxFilter = screen.getByLabelText("Fixings nach Index filtern") as HTMLSelectElement;
    expect(idxFilter.options.length).toBeGreaterThan(1);
    const firstIndex = idxFilter.options[1]!.value;
    fireEvent.change(idxFilter, { target: { value: firstIndex } });
    expect(screen.getByTestId("fixings-count").textContent).toMatch(/von .* Fixings/);
    const yearFilter = screen.getByLabelText("Fixings nach Jahr filtern") as HTMLSelectElement;
    fireEvent.change(yearFilter, { target: { value: yearFilter.options[1]!.value } });
    const rows = within(screen.getByTestId("fixings-table")).getAllByRole("row");
    expect(rows.length).toBeLessThanOrEqual(61);
    if (screen.queryByTestId("fixings-more")) fireEvent.click(screen.getByTestId("fixings-more"));
    fireEvent.click(screen.getAllByLabelText(/^Fixing \d+ entfernen$/)[0]!);
    expect(st().fixings).not.toBeNull();
    expect(screen.getByTestId("fixings-modified")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Zurücksetzen", { selector: "button.btn.ghost.xs" }));
    expect(st().fixings).toBeNull();
    // leave the import → toast with Rückgängig → Ctrl+Z restores the snapshot
    fireEvent.click(screen.getByTestId("snapshot-leave"));
    expect(st().marketSource).toBe("sample");
    expect(st().toasts.some((t) => /Sample-Markt aus den Quotes/.test(t.msg) && t.action?.label === "Rückgängig")).toBe(true);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(st().marketSource).toBe("import");
    expect(screen.getByTestId("snapshot-imported")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Rückgängig: Zum Sample-Markt/).length).toBeGreaterThan(0));
  });

  it("help sheet lists the round-6 grammar and market hints; the sample fixings render paged in the market view", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "?" });
    const sheet = screen.getByTestId("hotkey-overlay");
    expect(sheet.textContent).toMatch(/imm 2y pay 3% 10m/);
    expect(sheet.textContent).toMatch(/barrier do 1.05/);
    expect(sheet.textContent).toMatch(/\+ Kurve/);
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => st().setView("market"));
    expect((st().baseMarket.fixings?.length ?? 0) > 100).toBe(true);
    expect(within(screen.getByTestId("fixings-table")).getAllByRole("row").length).toBeLessThanOrEqual(61);
    expect(screen.getByTestId("fixings-more")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fixings-more"));
    expect(within(screen.getByTestId("fixings-table")).getAllByRole("row").length).toBeGreaterThan(61);
  });
});
