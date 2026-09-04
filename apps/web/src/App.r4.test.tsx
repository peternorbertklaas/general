/** App-level regression tests for the round-4 UI review (docs/quality/review-ui-r4.md) and the market-review web items. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { newTradeTemplate } from "./lib/templates.js";
import { useStore } from "./state/store.js";
import { preloadViews } from "./views/lazy-views.js";

const tabStops = (sel: string) => document.querySelectorAll(`${sel} tbody tr[tabindex="0"]`).length;

describe("App – round 4", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeAll(() => preloadViews());
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetPortfolio();
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
    useStore.getState().resetWhatIf();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("R4-02: `y i` on a focused blotter row copies the indication and leaves the inspector alone; `y y` copies the row", async () => {
    render(<App />);
    const row = document.querySelector<HTMLTableRowElement>('tr[data-nav="trade"].selected')!;
    act(() => row.focus());
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: "y" });
    expect(useStore.getState().chordPrefix).toBe("y");
    fireEvent.keyDown(row, { key: "i" });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]![0])).toMatch(/PV/);
    expect(String(writeText.mock.calls[0]![0])).not.toMatch(/\t/);
    expect(useStore.getState().inspectorOpen).toBe(true);
    expect(useStore.getState().chordPrefix).toBeNull();
    expect(screen.getByText(/Indikation in die Zwischenablage kopiert/)).toBeInTheDocument();
    fireEvent.keyDown(row, { key: "y" });
    fireEvent.keyDown(row, { key: "y" });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(String(writeText.mock.calls[1]![0])).toMatch(/IRS-0001/);
    expect(String(writeText.mock.calls[1]![0])).toMatch(/\t/);
    expect(useStore.getState().chordPrefix).toBeNull();
    await waitFor(() => expect(screen.getByText("Zeile kopiert")).toBeInTheDocument());
  });

  it("R4-03: every table has exactly one row tab stop (roving tabindex)", async () => {
    render(<App />);
    expect(tabStops("table.blotter")).toBe(1);
    expect(document.querySelectorAll('table.blotter tbody tr[tabindex="-1"]').length).toBeGreaterThan(5);
    expect(document.querySelector('table.blotter tbody tr[tabindex="0"]')?.classList.contains("selected")).toBe(true);
    act(() => useStore.getState().setView("pricing"));
    await waitFor(() => expect(screen.getByTestId("cashflow-table")).toBeInTheDocument());
    expect(tabStops('[data-testid="cashflow-table"]')).toBe(1);
    expect(document.querySelectorAll('[data-testid="cashflow-table"] tbody tr[tabindex="-1"]').length).toBeGreaterThan(3);
    act(() => useStore.getState().setView("curves"));
    expect(tabStops('[data-testid="pillar-table"]')).toBe(1);
    act(() => useStore.getState().setView("scenarios"));
    expect(tabStops('[data-testid="scenario-table"]')).toBe(1);
    expect(tabStops('table[aria-label="P&L je Trade"]')).toBe(1);
    // keyboard navigation moves the single tab stop
    const first = document.querySelector<HTMLTableRowElement>('[data-testid="scenario-table"] tbody tr')!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(document.querySelectorAll('[data-testid="scenario-table"] tbody tr')[1]);
    expect(tabStops('[data-testid="scenario-table"]')).toBe(1);
    expect(document.querySelector<HTMLTableRowElement>('[data-testid="scenario-table"] tbody tr[tabindex="0"]')).toBe(document.activeElement);
  });

  it("R4-F2: the toast stack follows the skip link and precedes the app shell; undo buttons carry the shortcut hint", () => {
    render(<App />);
    const skip = screen.getByText("Zum Inhalt");
    const stack = screen.getByTestId("toast-stack");
    const app = document.querySelector(".app")!;
    expect(skip.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stack.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => {
      useStore.getState().showToast("Gelöscht", { action: { label: "Rückgängig", run: () => undefined } });
    });
    const btn = screen.getByRole("button", { name: "Rückgängig" });
    expect(btn.getAttribute("title")).toMatch(/Rückgängig \((Ctrl|⌘)\+Z\)/);
    expect(btn.textContent).toMatch(/\((Ctrl|⌘)\+Z\)/);
  });

  it("R4-07: the report header names the what-if once; the print header uses the German label", () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("report"));
    act(() => {
      useStore.getState().generateReport();
    });
    act(() => useStore.getState().setWhatIf({ ratesBp: 10 }));
    const header = screen.getByTestId("report-header").textContent ?? "";
    expect((header.match(/What-if/g) ?? []).length).toBe(1);
    expect(header).not.toMatch(/What-if What-if/);
    expect(document.querySelector(".report-print-header")?.textContent).toMatch(/WHAT-IF Zinsen \+10 bp – NICHT PRÜFUNGSFÄHIG/);
    expect(document.querySelector(".report-print-header")?.textContent).not.toMatch(/WHAT-IF What-if/);
    expect(screen.getByRole("table", { name: "Sensitivitäten" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Kostentransparenz" })).toBeInTheDocument();
    act(() => useStore.getState().resetWhatIf());
  });

  it("R4-09: a stored turn-of-year overtaken by the valuation date shows the 'inaktiv' badge, not a validation error", () => {
    render(<App />);
    act(() => useStore.getState().setView("curves"));
    fireEvent.click(screen.getByRole("button", { name: "€STR" }));
    fireEvent.change(screen.getByTestId("toy-bp"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toy-apply"));
    expect(useStore.getState().turnOfYear["EUR-ESTR"]?.bp).toBe(20);
    expect(screen.queryByTestId("toy-inactive")).toBeNull();
    act(() => {
      useStore.getState().setValuationDate("2027-01-15");
    });
    expect(screen.getByTestId("toy-inactive")).toBeInTheDocument();
    expect(screen.queryByTestId("toy-past")).toBeNull();
    expect(screen.getByTestId("toy-apply")).toBeDisabled();
    expect(useStore.getState().toasts.some((t) => /liegt jetzt vor dem Bewertungstag – inaktiv/.test(t.msg))).toBe(true);
    expect(screen.getByTestId("market-modified-chip").textContent).toMatch(/1 inaktiv/);
    // a changed draft on/before the valuation date is still validated
    fireEvent.change(screen.getByTestId("toy-bp"), { target: { value: "30" } });
    expect(screen.getByTestId("toy-past")).toBeInTheDocument();
    expect(screen.queryByTestId("toy-inactive")).toBeNull();
    act(() => {
      useStore.getState().setTurnOfYear("EUR-ESTR", undefined);
      useStore.getState().setValuationDate("2026-09-03");
    });
  });

  it("R4-10: one h1, the view title is the h2, market key-value tables carry names; offline chip reacts to the network state", () => {
    render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("/ Blotter");
    act(() => useStore.getState().setView("market"));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("/ Markt");
    expect(screen.getByRole("table", { name: "FX-Spots" })).toBeInTheDocument();
    // caplet grid: the input is bound to its cell (R4-01)
    const caplet = screen.getByTestId("caplet-vol-cell") as HTMLInputElement;
    expect(caplet.style.width).toBe("100%");
    expect(caplet.closest("table")?.classList.contains("vol-grid")).toBe(true);
    expect(caplet.closest("td")?.firstElementChild).toBe(caplet);
    expect(screen.queryByTestId("offline-chip")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-chip")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-chip")).toBeNull();
  });

  it("Markt R4-2: the swaption editor offers the currencies with a vol cube and rebuilds the underlying on change", () => {
    render(<App />);
    act(() => useStore.getState().select("SWPT-0001"));
    act(() => useStore.getState().setView("pricing"));
    const sel = screen.getByLabelText("Währung") as HTMLSelectElement;
    const labels = Array.from(sel.options).map((o) => o.textContent);
    expect(labels).toContain("EUR (Vol-Cube)");
    expect(labels).toContain("USD (Vol-Cube)");
    expect(labels).toContain("CHF (Vol-Cube)");
    fireEvent.change(sel, { target: { value: "USD" } });
    const t = useStore.getState().trades.find((x) => x.id === "SWPT-0001");
    if (t?.type !== "Swaption") throw new Error("swaption expected");
    expect(t.underlying.legs.every((l) => l.currency === "USD")).toBe(true);
    expect(t.underlying.legs.some((l) => l.type === "Float" && (l as { index: string }).index === "SOFR")).toBe(true);
    expect(useStore.getState().results["SWPT-0001"]?.result).toBeDefined();
    // regulatory: clearing obligation as EMIR field 30 (TRUE / FLSE / UKWN)
    const obligation = screen.getByLabelText("Clearingpflicht") as HTMLSelectElement;
    expect(obligation.value).toBe("UKWN");
    fireEvent.change(obligation, { target: { value: "TRUE" } });
    expect(useStore.getState().trades.find((x) => x.id === "SWPT-0001")?.clearingObligation).toBe(true);
    fireEvent.change(obligation, { target: { value: "UKWN" } });
    expect(useStore.getState().trades.find((x) => x.id === "SWPT-0001")?.clearingObligation).toBeUndefined();
  });

  it("R4-05: an invalid hedging instrument shows the German validator message in the hedge view and never reaches the core", () => {
    render(<App />);
    const irs = useStore.getState().trades.find((t) => t.id === "IRS-0001");
    if (irs?.type !== "InterestRateSwap") throw new Error("IRS expected");
    act(() =>
      useStore
        .getState()
        .updateTrade({ ...irs, legs: irs.legs.map((l) => ({ ...l, effectiveDate: l.terminationDate, terminationDate: l.effectiveDate })) as typeof irs.legs }),
    );
    act(() => useStore.getState().setView("hedge"));
    const msg = screen.getByTestId("hedge-invalid-trade").textContent ?? "";
    expect(msg).toMatch(/Enddatum muss nach dem Startdatum liegen/);
    expect(msg).not.toMatch(/terminationDate|Invalid trade/);
    expect(screen.getByTestId("hedge-test")).toBeDisabled();
    fireEvent.click(screen.getByTestId("hedge-test"));
    expect(screen.queryByTestId("hedge-error")).toBeNull();
    act(() => {
      useStore.getState().undo();
    });
  });

  it("Markt R4-1: FX fixings editor adds a fixing from the spot (undoable) and a CSA without collateral curve warns in the CCS editor", async () => {
    render(<App />);
    act(() => useStore.getState().setView("market"));
    expect(screen.getByTestId("fx-fixings-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fx-fixing-add-spot"));
    expect(useStore.getState().fxFixings).toHaveLength(1);
    expect(useStore.getState().baseMarket.fxFixings).toHaveLength(1);
    expect(screen.getByTestId("fx-fixings-table")).toBeInTheDocument();
    expect(screen.getAllByText(/modifiziert/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("fx-fixing-add-spot"));
    expect(useStore.getState().fxFixings).toHaveLength(1); // duplicate (same pair + date) refused with a toast
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useStore.getState().fxFixings).toHaveLength(0);
    expect(screen.queryByTestId("fx-fixings-table")).toBeNull();
    // CCS with a GBP CSA: no EUR|GBP / USD|GBP collateral curve → warning in the editor
    const ccs = { ...newTradeTemplate("ccs", useStore.getState().valuationDate), collateralCurrency: "GBP" };
    act(() => {
      useStore.getState().addTrade(ccs, { goToPricing: true, autoId: true });
    });
    await waitFor(() => expect(screen.getByText(/existiert keine Collateral-Kurve/)).toBeInTheDocument());
    expect(screen.getByText(/existiert keine Collateral-Kurve/).textContent).toMatch(/Cross-Currency-Basis nicht gepreist/);
    expect(screen.getByText(/existiert keine Collateral-Kurve/).textContent).not.toMatch(/COLLATERAL_CURVE_MISSING/);
    act(() => {
      useStore.getState().undo();
    });
  });
});
