/** App-level regression tests for the round-9 reviews (docs/quality/review-ui-r9.md, review-markt-r9.md). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { knownCurrencies, makeFxOption, parseISO } from "@deriva/pricing-core";
import { App } from "./App.js";
import { useStore } from "./state/store.js";
import { sampleSnapshot } from "./test/fixtures-r8.js";
import { preloadViews } from "./views/lazy-views.js";

const st = () => useStore.getState();
const active = () => document.activeElement as HTMLElement;
const activeTestId = () => active()?.getAttribute("data-testid") ?? active()?.tagName ?? "";

/** Fill and submit the „+ Währung“ form for HUF (HUFONIA / BUBOR-6M). */
function registerHuf() {
  fireEvent.click(screen.getByTestId("add-currency"));
  fireEvent.change(screen.getByTestId("add-currency-code"), { target: { value: "HUF" } });
  fireEvent.change(screen.getByTestId("add-currency-ois"), { target: { value: "HUFONIA" } });
  fireEvent.change(screen.getByTestId("add-currency-ibor"), { target: { value: "BUBOR-6M" } });
  fireEvent.click(screen.getByTestId("add-currency-submit"));
  expect(knownCurrencies()).toContain("HUF");
}

describe("App – round 9", () => {
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
      restored: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("R9-F4: the restore toast carries no destructive action; „Beispielportfolio laden“ asks first and is undoable", async () => {
    useStore.setState({ restored: { trades: 5, quotesModified: false }, trades: [], results: {}, selectedId: null });
    render(<App />);
    const toast = await screen.findByText(/Bestand aus lokalem Speicher geladen \(5 Trades\)/);
    expect(toast.textContent).toMatch(/Beispielportfolio über die Palette/);
    expect(within(toast.closest(".toast") as HTMLElement).queryByRole("button", { name: /Zurücksetzen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zurücksetzen" })).toBeNull();
    // the empty blotter offers the sample book – declined: nothing happens
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByTestId("blotter-load-sample"));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Bestand \(0 Trades\) durch das Beispielportfolio ersetzen\? \(rückgängig mit Ctrl\+Z\)$/));
    expect(st().trades).toEqual([]);
    // confirmed: sample book, toast with Rückgängig, undo brings the empty book back
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId("blotter-load-sample"));
    expect(st().trades.length).toBe(13);
    const undoBtn = await screen.findByRole("button", { name: /^Rückgängig/ });
    expect(undoBtn.closest(".toast")!.textContent).toMatch(/Beispielportfolio geladen/);
    fireEvent.click(undoBtn);
    expect(st().trades).toEqual([]);
    expect(st().undoStack.some((e) => e.kind === "portfolio")).toBe(false);
  });

  it("R9-02: „+ Kurve“ / „+ Währung“ hand the focus to their first field; Esc closes the form and returns to the button", async () => {
    render(<App />);
    act(() => st().setView("curves"));
    fireEvent.click(screen.getByTestId("add-curve"));
    await waitFor(() => expect(activeTestId()).toBe("add-curve-ccy"));
    fireEvent.keyDown(active(), { key: "Escape" });
    expect(screen.queryByTestId("add-curve-form")).toBeNull();
    await waitFor(() => expect(activeTestId()).toBe("add-curve"));
    fireEvent.click(screen.getByTestId("add-currency"));
    await waitFor(() => expect(activeTestId()).toBe("add-currency-code"));
    // a plain field: Esc closes directly
    fireEvent.keyDown(active(), { key: "Escape" });
    expect(screen.queryByTestId("add-currency-form")).toBeNull();
    await waitFor(() => expect(activeTestId()).toBe("add-currency"));
    // the toggle still closes without a focus move into a vanished form
    fireEvent.click(screen.getByTestId("add-currency"));
    await waitFor(() => expect(activeTestId()).toBe("add-currency-code"));
    fireEvent.click(screen.getByTestId("add-currency"));
    expect(screen.queryByTestId("add-currency-form")).toBeNull();
  });

  it("R9-F2 / R9-05: after „+ Währung“ HUF the „+ Kurve“ form preselects HUF; the form shows no literal backticks", async () => {
    render(<App />);
    act(() => st().setView("curves"));
    // DKK sits before HUF alphabetically – the old rule would have chosen it
    expect(knownCurrencies()).toContain("DKK");
    fireEvent.click(screen.getByTestId("add-currency"));
    const form = screen.getByTestId("add-currency-form");
    expect(form.textContent).not.toContain("`");
    for (const el of Array.from(form.querySelectorAll("[title]"))) expect(el.getAttribute("title")).not.toContain("`");
    expect(form.querySelector("code")?.textContent).toBe("POST /api/market/indices|conventions|calendars");
    fireEvent.change(screen.getByTestId("add-currency-code"), { target: { value: "HUF" } });
    fireEvent.change(screen.getByTestId("add-currency-ois"), { target: { value: "HUFONIA" } });
    fireEvent.change(screen.getByTestId("add-currency-ibor"), { target: { value: "BUBOR-6M" } });
    fireEvent.click(screen.getByTestId("add-currency-submit"));
    expect(st().toasts.at(-1)?.msg).toMatch(/jetzt mit „\+ Kurve“ eine HUF-Kurve anlegen/);
    await waitFor(() => expect(activeTestId()).toBe("add-curve"));
    fireEvent.click(screen.getByTestId("add-curve"));
    expect((screen.getByTestId("add-curve-ccy") as HTMLSelectElement).value).toBe("HUF");
    expect((screen.getByTestId("add-curve-index") as HTMLSelectElement).value).toBe("HUFONIA");
    await waitFor(() => expect(activeTestId()).toBe("add-curve-ccy"));
  });

  it("R9-03: under an imported snapshot the „+ Währung“ toast names „Zum Sample-Markt“ and the focus lands on that (enabled) button", async () => {
    act(() => {
      expect(st().importSnapshot(sampleSnapshot(st().valuationDate)).ok).toBe(true);
      st().setView("curves");
    });
    render(<App />);
    expect((screen.getByTestId("add-curve") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("add-currency").getAttribute("title")).toMatch(/erst nach „Zum Sample-Markt“/);
    registerHuf();
    const toast = st().toasts.at(-1)!.msg;
    expect(toast).toMatch(/Registriert: 2 Indizes HUFONIA, BUBOR-6M · Konventionen HUF – im Import-Modus ist „\+ Kurve“ gesperrt/);
    expect(toast).toMatch(/nach „Zum Sample-Markt“ mit „\+ Kurve“ eine HUF-Kurve anlegen oder einen Snapshot mit HUF-Kurve importieren/);
    expect(toast).not.toMatch(/jetzt mit „\+ Kurve“/);
    await waitFor(() => expect(activeTestId()).toBe("curves-leave-import"));
    expect(document.activeElement).not.toBe(document.body);
    fireEvent.click(screen.getByTestId("curves-leave-import"));
    expect(st().marketSource).toBe("sample");
    expect((screen.getByTestId("add-curve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("R9-04: removing a row by keyboard focuses the neighbour row; an emptied table focuses „+ Zeile“", async () => {
    render(<App />);
    act(() => st().setView("market"));
    const table = screen.getByTestId("fixings-table");
    const rows = () =>
      within(table)
        .getAllByRole("row")
        .filter((r) => r.closest("tbody"));
    const baseFixings = st().baseMarket.fixings!.length;
    const second = rows()[1]!;
    act(() => second.focus());
    fireEvent.keyDown(second, { key: "Enter" });
    const removeBtn = within(second).getByLabelText(/^Fixing \d+ entfernen$/);
    fireEvent.click(removeBtn);
    await waitFor(() => expect(active().tagName).toBe("TR"));
    expect(table.contains(active())).toBe(true);
    expect(st().fixings!.length).toBe(baseFixings - 1); // the table is paged, the store shrank by one
    expect(rows().indexOf(active() as HTMLTableRowElement)).toBe(1); // the row that now sits at the removed position
    expect(screen.getByTestId("fixings-modified")).toBeInTheDocument();
    // FX fixings: one row, removed → „+ Zeile“ of the FX-fixings card
    fireEvent.click(screen.getByTestId("fx-fixing-add"));
    const fxTable = await screen.findByTestId("fx-fixings-table");
    const fxRow = within(fxTable)
      .getAllByRole("row")
      .find((r) => r.closest("tbody"))!;
    act(() => fxRow.focus());
    fireEvent.click(within(fxRow).getByLabelText("FX-Fixing 1 entfernen"));
    await waitFor(() => expect(activeTestId()).toBe("fx-fixing-add"));
    expect(screen.queryByTestId("fx-fixings-table")).toBeNull();
  });

  it("Markt R9-4: a CSV without type, file-name hint or column signature opens the type dialog; the chosen type is applied", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("export-menu-btn"));
    const input = (await screen.findByTestId("import-csv")) as HTMLInputElement;
    const file = new File(["id;name\nX-1;Irgendwas\n"], "bestand.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByTestId("csv-type-dialog");
    expect(dialog.textContent).toMatch(/keine Spalte „Typ“/);
    fireEvent.change(within(dialog).getByTestId("csv-type-select"), { target: { value: "FXF" } });
    expect(within(dialog).getByTestId("csv-type-continue").textContent).toMatch(/^Als .+ importieren$/);
    fireEvent.click(within(dialog).getByTestId("csv-type-continue"));
    // the row cannot be built as an FX forward – it lands in the row-error dialog, nothing crashes
    const errors = await screen.findByTestId("csv-errors");
    expect(within(errors).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.queryByTestId("csv-type-dialog")).toBeNull();
  });

  it("core R9: the barrier editor's default rebate convention is „Standard (bei Berührung)“", async () => {
    act(() => {
      st().addTrade({
        ...makeFxOption({
          id: "FXO-B",
          pair: "EURUSD",
          optionType: "Put",
          notional: 1e6,
          strike: 1.15,
          expiryDate: parseISO("2027-06-15"),
          barrier: { type: "DownOut", level: 1.05, rebate: 1000 },
        }),
        name: "Barrier",
      });
      st().setView("pricing");
    });
    render(<App />);
    const sel = (await screen.findByLabelText("Rebate-Zahlung")) as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["Standard (bei Berührung)", "bei Berührung", "bei Verfall"]);
    // the core builder sets the convention explicitly since R9 – the editor shows it
    expect(sel.value).toBe("hit");
    expect(st().results["FXO-B"]?.error).toBeUndefined();
    expect(st().results["FXO-B"]!.result!.analytics.rebateAt).toBe("hit");
    // a trade without the field (older files) is priced with the core default and shows the labelled default option
    fireEvent.change(sel, { target: { value: "default" } });
    const t = st().trades.find((x) => x.id === "FXO-B")!;
    expect(t.type === "FxOption" && t.barrier?.rebateAt).toBeUndefined();
    await waitFor(() => expect((screen.getByLabelText("Rebate-Zahlung") as HTMLSelectElement).value).toBe("default"));
    expect(st().results["FXO-B"]!.result!.analytics.rebateAt).toBe("hit");
    expect(screen.getByLabelText("Rebate-Zahlung").closest(".field")?.textContent).not.toMatch(/gemischt/);
  });
});
