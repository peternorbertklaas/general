/** App-level regression tests for the round-7 reviews (docs/quality/review-ui-r7.md, review-markt-r7.md). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";
import { useStore } from "./state/store.js";
import { preloadViews } from "./views/lazy-views.js";

const st = () => useStore.getState();
const OIS = [
  { type: "OIS" as const, tenor: "1Y", rate: 0.041 },
  { type: "OIS" as const, tenor: "2Y", rate: 0.0415 },
  { type: "OIS" as const, tenor: "5Y", rate: 0.042 },
  { type: "OIS" as const, tenor: "10Y", rate: 0.043 },
];
const activeLabel = () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? "";
const tabStops = (root: HTMLElement) => root.querySelectorAll('[tabindex="0"]').length;

describe("App – round 7", () => {
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

  it("R7-01: fixings editor and FX-fixings table are one tab stop each – arrows move rows, ↵/F2 edit, Esc returns to the row", async () => {
    render(<App />);
    act(() => st().setView("market"));
    const table = screen.getByTestId("fixings-table");
    const rows = within(table)
      .getAllByRole("row")
      .filter((r) => r.closest("tbody"));
    expect(rows.length).toBeGreaterThan(10);
    expect(tabStops(table)).toBe(1);
    expect(table.querySelectorAll('tbody input:not([tabindex="-1"]), tbody select:not([tabindex="-1"]), tbody button:not([tabindex="-1"])').length).toBe(0);
    const first = rows[0]!;
    expect(first.getAttribute("tabindex")).toBe("0");
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: "PageDown" });
    expect(document.activeElement).toBe(rows[11]);
    fireEvent.keyDown(rows[11]!, { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
    // ↵ opens the first control of the row (the index select), Esc goes back to the row
    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    expect(activeLabel()).toMatch(/^Index Fixing \d+$/);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(rows[0]!, { key: "F2" });
    expect(activeLabel()).toMatch(/^Index Fixing \d+$/);
    // the index choices come from the market's curves (registered indices with a curve), not from a fixed EUR list
    const indexSelect = document.activeElement as HTMLSelectElement;
    expect(Array.from(indexSelect.options).map((o) => o.value)).toEqual(expect.arrayContaining(["EURIBOR-6M", "ESTR", "SOFR", "SONIA", "SARON", "TONA"]));
    // FX fixings: a row appears via "+ heute aus Spot" and is one tab stop as well
    fireEvent.click(screen.getByTestId("fx-fixing-add-spot"));
    const fxTable = screen.getByTestId("fx-fixings-table");
    expect(tabStops(fxTable)).toBe(1);
    expect(fxTable.querySelectorAll('tbody [tabindex="-1"]').length).toBeGreaterThanOrEqual(4);
  });

  it("R7-01: vol grids are one tab stop each – arrow keys move between cells, ↵ edits, the whole view has few stops", () => {
    render(<App />);
    act(() => st().setView("market"));
    const grid = screen.getByTestId("swaption-vol-grid");
    expect(grid.getAttribute("role")).toBe("grid");
    const cells = grid.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBeGreaterThan(20);
    expect(tabStops(grid)).toBe(1);
    expect(grid.querySelectorAll('input:not([tabindex="-1"])').length).toBe(0);
    const c00 = cells[0] as HTMLElement;
    act(() => c00.focus());
    fireEvent.keyDown(c00, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[1]);
    fireEvent.keyDown(cells[1]!, { key: "ArrowDown" });
    const c11 = document.activeElement as HTMLElement;
    expect(c11.getAttribute("data-r")).toBe("1");
    expect(c11.getAttribute("data-c")).toBe("1");
    expect(c11.getAttribute("tabindex")).toBe("0"); // the roving stop followed the focus
    expect(c00.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(c11, { key: "Enter" });
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(activeLabel()).toMatch(/^Swaption-Vol /);
    fireEvent.keyDown(c11, { key: "Home" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" }); // inside the input: not ours
    // caplet table and FX table follow the same pattern
    const caplet = screen.getByTestId("caplet-vol-table");
    expect(caplet.getAttribute("role")).toBe("grid");
    expect(tabStops(caplet)).toBe(1);
    const fx = screen.getByTestId("fx-vol-grid");
    expect(tabStops(fx)).toBe(1);
    const fxCells = fx.querySelectorAll('[role="gridcell"]');
    act(() => (fxCells[0] as HTMLElement).focus());
    fireEvent.keyDown(fxCells[0]!, { key: "End" });
    expect((document.activeElement as HTMLElement).getAttribute("data-r")).toBe("0");
    expect(Number((document.activeElement as HTMLElement).getAttribute("data-c"))).toBeGreaterThan(0);
    // the whole market view: far fewer than the 489 stops of round 6
    const main = document.querySelector("main")!;
    expect(main.querySelectorAll('input:not([tabindex="-1"]), select:not([tabindex="-1"]), button:not([tabindex="-1"]), [tabindex="0"]').length).toBeLessThan(
      60,
    );
  });

  it("R7-2 / R7-F1: '+ Paar' adds an FX spot, '+ Fläche' adds a swaption cube and an FX surface for the new currency – no Level-3 fallback any more", async () => {
    // a NOK curve without a spot – the gap "+ Kurve" leaves when the spot field stays empty
    act(() => {
      st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS });
    });
    render(<App />);
    act(() => st().setView("market"));
    // + Paar: the form suggests EUR/NOK (currency with a curve, no spot)
    fireEvent.click(screen.getByTestId("add-spot"));
    const pairInput = screen.getByTestId("add-spot-pair") as HTMLInputElement;
    expect(pairInput.value).toBe("EURNOK");
    const rate = screen.getByTestId("add-spot-rate") as HTMLInputElement;
    fireEvent.focus(rate);
    fireEvent.change(rate, { target: { value: "11,62" } });
    fireEvent.blur(rate); // (↵ in the rate field submits since R8-04 – see App.r8.test.tsx)
    fireEvent.change(pairInput, { target: { value: "EURUSD" } });
    expect(screen.getByTestId("add-spot-problem").textContent).toMatch(/bereits im Markt/);
    fireEvent.change(pairInput, { target: { value: "eurnok" } });
    expect(screen.queryByTestId("add-spot-problem")).toBeNull();
    fireEvent.click(screen.getByTestId("add-spot-submit"));
    expect(st().baseMarket.fxSpots.EURNOK).toBeCloseTo(11.62, 6);
    // since R8-F2 a "+ Paar" spot is a structural extra (survives import → leave → reload), not a quote edit
    expect(st().extraSpots.EURNOK).toBeCloseTo(11.62, 6);
    expect(st().quotes.fxSpots.EURNOK).toBeUndefined();
    expect(screen.getByTestId("fx-spot-row-EURNOK")).toBeInTheDocument();
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "extras", label: "Spot EUR/NOK 11,6200 angelegt" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("add-spot")));
    // + Fläche (swaption cube for NOK): flat 70 bp from the EUR axes
    fireEvent.click(screen.getByTestId("add-vol"));
    const kind = screen.getByTestId("add-vol-kind") as HTMLSelectElement;
    expect(kind.value).toBe("swaption");
    expect((screen.getByTestId("add-vol-ccy") as HTMLSelectElement).value).toBe("NOK");
    expect((screen.getByTestId("add-vol-template") as HTMLSelectElement).value).toBe("EUR");
    const flat = screen.getByTestId("add-vol-flat") as HTMLInputElement;
    fireEvent.focus(flat);
    fireEvent.change(flat, { target: { value: "70" } });
    fireEvent.keyDown(flat, { key: "Enter" });
    expect(screen.getByTestId("add-vol-preview").textContent).toMatch(/^NOK: \d+ × \d+ \(Expiry × Tenor\)/);
    fireEvent.click(screen.getByTestId("add-vol-submit"));
    const cube = st().baseMarket.swaptionVols?.NOK;
    expect(cube).toBeDefined();
    expect(cube!.currency).toBe("NOK");
    expect(cube!.expiries).toEqual(st().baseMarket.swaptionVols!.EUR!.expiries);
    expect(cube!.atm.flat().every((v) => Math.abs(v - 0.007) < 1e-12)).toBe(true);
    // since R8-F2 a "+ Fläche" surface is a structural extra like an added curve
    expect(st().extraVolSurfaces.swaptionVols?.NOK).toBeDefined();
    expect(st().volSurfaces.swaptionVols?.NOK).toBeUndefined();
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "extras", label: "Swaption-Cube NOK angelegt" });
    // the new cube is selected, flagged "angelegt" and removable
    expect(screen.getByTestId("swaption-vol-card").textContent).toMatch(/Swaption-ATM-Vols NOK/);
    expect(screen.getByTestId("swaption-vol-edited").textContent).toBe("angelegt");
    expect(screen.getByTestId("swaption-vol-reset").textContent).toBe("Entfernen");
    // + Fläche (FX surface for EUR/NOK): values copied from the EUR/USD template
    fireEvent.click(screen.getByTestId("add-vol"));
    fireEvent.change(screen.getByTestId("add-vol-kind"), { target: { value: "fx" } });
    expect((screen.getByTestId("add-vol-pair") as HTMLSelectElement).value).toBe("EURNOK");
    fireEvent.click(screen.getByTestId("add-vol-copy"));
    fireEvent.click(screen.getByTestId("add-vol-submit"));
    const fxs = st().baseMarket.fxVols?.EURNOK;
    expect(fxs).toBeDefined();
    expect(fxs!.pair).toBe("EURNOK");
    expect(fxs!.atm).toEqual(st().baseMarket.fxVols!.EURUSD!.atm);
    expect(screen.getByTestId("fx-vol-card").textContent).toMatch(/FX-Vol-Fläche EUR\/NOK/);
    // caplet surface for NOK-NOWA from the EUR template
    fireEvent.click(screen.getByTestId("add-vol"));
    fireEvent.change(screen.getByTestId("add-vol-kind"), { target: { value: "caplet" } });
    expect((screen.getByTestId("add-vol-ccy") as HTMLSelectElement).value).toBe("NOK");
    expect((screen.getByTestId("add-vol-index") as HTMLSelectElement).value).toBe("NOWA");
    fireEvent.click(screen.getByTestId("add-vol-submit"));
    expect(st().baseMarket.capletVols?.["NOK-NOWA"]).toMatchObject({ currency: "NOK", index: "NOWA" });
    // the palette previews no longer warn – and the trades price on the new surfaces without a fallback warning
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "swpt nok 1y5y payer 4% 10m" } });
    expect(screen.getByText(/Trade anlegen: Payer-Swaption NOK 1Yx5Y/).textContent).not.toMatch(/⚠/);
    fireEvent.change(input, { target: { value: "fxo eurnok call 11.7 1m 6m" } });
    expect(screen.getByText(/Trade anlegen: FX-Option EURNOK/).textContent).not.toMatch(/⚠/);
    fireEvent.change(input, { target: { value: "cap nok 5y 4.5% 10m" } });
    const capItem = screen.getByText(/Trade anlegen: Cap NOK 5Y/);
    expect(capItem.textContent).toMatch(/NOWA \(Kurve vorhanden; NIBOR-6M ohne Kurve\)/);
    fireEvent.keyDown(input, { key: "Enter" });
    const cap = st().trades.at(-1)!;
    expect(cap.type).toBe("CapFloor");
    expect(st().results[cap.id]?.error).toBeUndefined();
    expect(st().results[cap.id]?.result?.warnings.some((w) => /No caplet vol surface/.test(w))).toBe(false);
    // the swaption cube is undoable like every vol edit; "Entfernen" drops it again (the view remounted → select NOK first)
    act(() => st().setView("market"));
    fireEvent.click(within(screen.getByRole("group", { name: "Swaption-Cube Währung" })).getByText("NOK"));
    fireEvent.click(screen.getByTestId("swaption-vol-reset"));
    expect(st().baseMarket.swaptionVols?.NOK).toBeUndefined();
    expect(st().extraVolSurfaces.swaptionVols?.NOK).toBeUndefined();
    expect(st().undoStack.at(-1)).toMatchObject({ kind: "extras", label: "Swaption-Vols NOK entfernt" });
  });

  it("R7-03: after `n s` and after a palette quick entry the focus is on the first editor field; '+ Kurve' returns the focus to tab / button", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "s" });
    expect(st().view).toBe("pricing");
    await waitFor(() => expect(activeLabel()).toBe("Bezeichnung"));
    // palette quick entry
    act(() => st().setView("blotter"));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "irs 5y pay 3% 10m" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(st().paletteOpen).toBe(false);
    expect(st().trades.at(-1)?.type).toBe("InterestRateSwap");
    await waitFor(() => expect(activeLabel()).toBe("Bezeichnung"));
    // "+ Kurve": Abbrechen → button, Kurve anlegen → the new tab
    act(() => st().setView("curves"));
    fireEvent.click(screen.getByTestId("add-curve"));
    fireEvent.click(screen.getByText("Abbrechen"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("add-curve")));
    fireEvent.click(screen.getByTestId("add-curve"));
    fireEvent.change(screen.getByTestId("add-curve-ccy"), { target: { value: "DKK" } });
    fireEvent.click(screen.getByTestId("add-curve-submit"));
    expect(st().extraCurves["DKK-DESTR"]).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("curve-tab-DKK-DESTR")));
  });

  it("R7-F2 / R7-02: '+ Kurve' DKK → 'irs dkk 5y pay 3% 10m' prices on DESTR and the editor shows DKK / DESTR; the error path names + Kurve", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    // before the curve: refused with the remedy
    fireEvent.change(input, { target: { value: "irs dkk 5y pay 3% 10m" } });
    expect(screen.getByText(/Keine Kurve für DKK im Markt – in der Kurvenansicht mit „\+ Kurve“/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    act(() => {
      st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
    });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input2 = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input2, { target: { value: "irs dkk 5y pay 3% 10m" } });
    expect(screen.getByText(/Trade anlegen: Payer-Swap DKK 5Y .* DESTR \(Kurve vorhanden; CIBOR-6M ohne Kurve\)/)).toBeInTheDocument();
    fireEvent.keyDown(input2, { key: "Enter" });
    const t = st().trades.at(-1)!;
    expect(st().results[t.id]?.error).toBeUndefined();
    expect(Number.isFinite(st().results[t.id]?.result?.pv)).toBe(true);
    expect(st().view).toBe("pricing");
    await waitFor(() => expect((screen.getByLabelText("Währung") as HTMLSelectElement).value).toBe("DKK"));
    expect((screen.getByLabelText("Index") as HTMLSelectElement).value).toBe("DESTR");
    // Key-rate curve chips of an FX product (several curves) wrap inside the card (R7-04)
    act(() => st().select("FXO-0001"));
    await waitFor(() => expect(screen.getByTestId("keyrate-curves").className).toMatch(/\bwrap\b/));
    // remove the curve → the blotter error names "+ Kurve"
    act(() => {
      st().removeExtraCurve("DKK-DESTR");
    });
    expect(st().results[t.id]?.error).toMatch(/„\+ Kurve“/);
  });
});
