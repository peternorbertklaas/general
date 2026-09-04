/** App-level regression tests for the round-10 reviews (docs/quality/review-ui-r10.md, review-markt-r10.md). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type CurveQuote, SAMPLE_QUOTES, knownCurrencies, sampleBootstrapSpecs } from "@deriva/pricing-core";
import { App } from "./App.js";
import { LS_KEYS, useStore } from "./state/store.js";
import { CZK_ENVELOPE, czkSnapshot, jsonClone, sampleSnapshot, withCurve } from "./test/fixtures-r8.js";
import { unregisterEnvelope } from "./lib/register-envelope.js";
import { preloadViews } from "./views/lazy-views.js";

const st = () => useStore.getState();
const active = () => document.activeElement as HTMLElement;
const activeTestId = () => active()?.getAttribute("data-testid") ?? active()?.tagName ?? "";
const OIS: CurveQuote[] = [
  { type: "OIS", tenor: "1Y", rate: 0.041 },
  { type: "OIS", tenor: "2Y", rate: 0.0415 },
  { type: "OIS", tenor: "5Y", rate: 0.042 },
  { type: "OIS", tenor: "10Y", rate: 0.043 },
];

function registerHuf() {
  fireEvent.click(screen.getByTestId("add-currency"));
  fireEvent.change(screen.getByTestId("add-currency-code"), { target: { value: "HUF" } });
  fireEvent.change(screen.getByTestId("add-currency-ois"), { target: { value: "HUFONIA" } });
  fireEvent.change(screen.getByTestId("add-currency-ibor"), { target: { value: "BUBOR-6M" } });
  fireEvent.click(screen.getByTestId("add-currency-submit"));
  expect(knownCurrencies()).toContain("HUF");
}
const tbodyRows = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .filter((r) => r.closest("tbody"));

describe("App – round 10", () => {
  beforeAll(() => preloadViews());
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    unregisterEnvelope(CZK_ENVELOPE);
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

  it("R10-01: Esc in an inline number field of „+ Kurve“ / „+ Währung“ restores the value and keeps the focus; the next Esc closes the form", async () => {
    render(<App />);
    act(() => st().setView("curves"));
    fireEvent.click(screen.getByTestId("add-curve"));
    const spot = (await screen.findByTestId("add-curve-spot")) as HTMLInputElement;
    act(() => spot.focus());
    const before = spot.value;
    fireEvent.change(spot, { target: { value: "7,99" } });
    fireEvent.keyDown(spot, { key: "Escape" });
    // first Esc: value back, focus stays in the field, form open
    expect(spot.value).toBe(before);
    expect(document.activeElement).toBe(spot);
    expect(screen.getByTestId("add-curve-form")).toBeInTheDocument();
    fireEvent.keyDown(spot, { key: "Escape" });
    expect(screen.queryByTestId("add-curve-form")).toBeNull();
    await waitFor(() => expect(activeTestId()).toBe("add-curve"));
    expect(document.activeElement).not.toBe(document.body);
    // „+ Währung“: the spot-lag field, untouched → a single Esc closes the form
    fireEvent.click(screen.getByTestId("add-currency"));
    const lag = (await screen.findByLabelText(/^Spot-Lag/)) as HTMLInputElement;
    act(() => lag.focus());
    fireEvent.keyDown(lag, { key: "Escape" });
    expect(screen.queryByTestId("add-currency-form")).toBeNull();
    await waitFor(() => expect(activeTestId()).toBe("add-currency"));
  });

  it("R10-02: removing the first of two FX fixings / the first of three CDS quotes by keyboard focuses the row at that position", async () => {
    render(<App />);
    act(() => st().setView("market"));
    // FX fixings with two rows → the survivor keeps the focus inside the table
    fireEvent.click(screen.getByTestId("fx-fixing-add"));
    fireEvent.click(screen.getByTestId("fx-fixing-add"));
    const fxTable = await screen.findByTestId("fx-fixings-table");
    expect(tbodyRows(fxTable).length).toBe(2);
    const fxFirst = tbodyRows(fxTable)[0]!;
    act(() => fxFirst.focus());
    fireEvent.click(within(fxFirst).getByLabelText("FX-Fixing 1 entfernen"));
    await waitFor(() => expect(active().tagName).toBe("TR"));
    expect(screen.getByTestId("fx-fixings-table").contains(active())).toBe(true);
    expect(tbodyRows(screen.getByTestId("fx-fixings-table")).length).toBe(1);
    expect(st().fxFixings.length).toBe(1);
    // CDS with three quotes: after removing the first, the focused row shows the former *second* tenor
    fireEvent.click(screen.getByTestId("cds-add"));
    fireEvent.click(screen.getByTestId("cds-add"));
    fireEvent.click(screen.getByTestId("cds-add"));
    const cds = await screen.findByTestId("cds-table");
    const rows = tbodyRows(cds);
    expect(rows.length).toBe(3);
    const tenorOf = (row: HTMLElement) => (within(row).getByLabelText(/^Tenor CDS/) as HTMLSelectElement).value;
    const selects = rows.map((r) => within(r).getByLabelText(/^Tenor CDS/) as HTMLSelectElement);
    const options = Array.from(selects[0]!.options).map((o) => o.value);
    expect(options.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(selects[0]!, { target: { value: options[0] } });
    fireEvent.change(selects[1]!, { target: { value: options[1] } });
    fireEvent.change(selects[2]!, { target: { value: options[2] } });
    const second = options[1]!;
    const first = tbodyRows(screen.getByTestId("cds-table"))[0]!;
    act(() => first.focus());
    fireEvent.click(within(first).getByLabelText("CDS-Quote 1 entfernen"));
    await waitFor(() => expect(active().tagName).toBe("TR"));
    expect(screen.getByTestId("cds-table").contains(active())).toBe(true);
    expect(tbodyRows(screen.getByTestId("cds-table")).length).toBe(2);
    expect(tenorOf(active())).toBe(second);
  });

  it("R10-03: a toast action / ✕ activated by keyboard returns the focus to where it came from, else to main", async () => {
    render(<App />);
    const row = screen.getByRole("grid", { name: "Blotter" }).querySelector<HTMLElement>('tr[data-id="IRS-0002"]')!;
    act(() => row.focus());
    const run = vi.fn();
    act(() => void st().showToast("Test-Aktion", { action: { label: "Rückgängig", run } }));
    const undoBtn = await screen.findByRole("button", { name: /^Rückgängig/ });
    act(() => undoBtn.focus()); // jsdom reports the row as relatedTarget
    fireEvent.click(undoBtn); // detail 0 = keyboard activation
    expect(run).toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(row));
    // origin gone (a deleted row) → main
    act(() => void st().showToast("Zweite Meldung"));
    const close = (await screen.findAllByRole("button", { name: "Meldung schließen" })).at(-1)!;
    act(() => row.focus());
    act(() => close.focus());
    act(() => st().removeTrade("IRS-0002"));
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement?.id).toBe("main"));
    expect(document.activeElement).not.toBe(document.body);
    // a mouse click (detail 1) leaves the focus alone
    act(() => void st().showToast("Dritte Meldung"));
    const close3 = (await screen.findAllByRole("button", { name: "Meldung schließen" })).at(-1)!;
    fireEvent.click(close3, { detail: 1 });
    expect(st().toasts.some((t) => t.msg === "Dritte Meldung")).toBe(false);
  });

  it("R10-04: the empty blotter loads the sample book without a question and focuses the first row", async () => {
    useStore.setState({ trades: [], results: {}, selectedId: null });
    render(<App />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByTestId("blotter-load-sample"));
    expect(confirm).not.toHaveBeenCalled();
    expect(st().trades.length).toBe(13);
    await waitFor(() => expect(active().tagName).toBe("TR"));
    expect(active().closest("table")?.classList.contains("blotter")).toBe(true);
    expect(active().getAttribute("tabindex")).toBe("0");
    expect((await screen.findByRole("button", { name: /^Rückgängig/ })).closest(".toast")!.textContent).toMatch(/Beispielportfolio geladen/);
  });

  it("R10-05: „+ Währung“ HUF under a snapshot that holds HUF-HUFONIA – toast names the usable snapshot curve, focus on its tab", async () => {
    act(() => {
      expect(st().importSnapshot(withCurve(sampleSnapshot(st().valuationDate), "HUF-HUFONIA", "HUF", 395)).ok).toBe(true);
      st().setView("curves");
    });
    render(<App />);
    expect(screen.getByTestId("curve-tab-HUF-HUFONIA")).toBeInTheDocument();
    registerHuf();
    const toast = st().toasts.at(-1)!.msg;
    expect(toast).toMatch(/^Registriert: 2 Indizes HUFONIA, BUBOR-6M · Konventionen HUF – die Snapshot-Kurve HUF-HUFONIA ist sofort nutzbar/);
    expect(toast).not.toMatch(/„\+ Kurve“|Zum Sample-Markt/);
    await waitFor(() => expect(activeTestId()).toBe("curve-tab-HUF-HUFONIA"));
    expect((screen.getByTestId("add-curve") as HTMLButtonElement).disabled).toBe(true); // still locked – nothing to add
  });

  it("Markt R10-2: the snapshot tab shows the imported quotes read-only; market view counts the Bootstrap-Quotes", async () => {
    const snap = czkSnapshot(st().valuationDate);
    act(() => {
      const r = st().importSnapshot({
        ...snap,
        quotes: [{ curveId: "CZK-CZEONIA", spec: { id: "CZK-CZEONIA", currency: "CZK", index: "CZEONIA", quotes: OIS } }],
      });
      expect(r.ok).toBe(true);
      st().setView("curves");
    });
    render(<App />);
    fireEvent.click(screen.getByTestId("curve-tab-CZK-CZEONIA"));
    const table = await screen.findByTestId("snapshot-quotes-table");
    expect(tbodyRows(table).length).toBe(4);
    expect(table.textContent).toMatch(/OIS 1Y/);
    expect(table.textContent).toMatch(/4,1000 %|4,10 %/);
    expect(screen.getByTestId("snapshot-quotes-badge").textContent).toBe("aus Snapshot");
    const note = screen.getByTestId("quotes-snapshot-note").textContent!;
    expect(note).toMatch(/mit Bootstrap-Quotes für das Par-Risiko \(4 Quotes, Index CZEONIA\)/);
    expect(note).toMatch(/Bearbeiten nach „Zum Sample-Markt“/);
    expect(note).not.toMatch(/ohne Bootstrap-Quotes/);
    expect(screen.getByTestId("curve-tab-CZK-CZEONIA").getAttribute("title")).toMatch(/Bootstrap-Quotes für das Par-Risiko/);
    // the editable sample-quote table stays hidden on a snapshot tab
    expect((screen.getByTestId("quotes-table").parentElement as HTMLElement).hidden).toBe(true);
    // market view
    act(() => st().setView("market"));
    const marketNote = await screen.findByTestId("snapshot-import-note");
    expect(marketNote.textContent).toMatch(/Bootstrap-Quotes: 1 Kurve \(CZK-CZEONIA\)/);
    expect(screen.getByTestId("snapshot-quote-curves").textContent).toMatch(/Bootstrap-Quotes: 1 Kurve/);
  });

  it("R10-F1 / Markt R10-1: the par-risk card names an inconsistent snapshot spec and excludes it from the bump", async () => {
    localStorage.setItem(LS_KEYS.parRiskOpen, "1");
    const specs = sampleBootstrapSpecs(st().valuationDate, jsonClone(SAMPLE_QUOTES));
    const estr = specs["EUR-ESTR"]!;
    act(() => {
      const r = st().importSnapshot({
        ...sampleSnapshot(st().valuationDate),
        quotes: [
          { curveId: "EUR-ESTR", spec: { ...estr, quotes: estr.quotes.map((q) => ("rate" in q ? { ...q, rate: q.rate + 0.005 } : q)) } },
          { curveId: "EUR-EURIBOR-6M", spec: specs["EUR-EURIBOR-6M"]! },
        ],
      });
      expect(r.ok).toBe(true);
      st().setView("pricing");
    });
    render(<App />);
    const coverage = await screen.findByTestId("par-risk-coverage");
    // the EURIBOR-6M spec reproduces its curve against the market's ESTR – only the bumped ESTR spec is excluded
    expect(coverage.textContent).toMatch(/Par-Risiko nur für Kurven mit Quotes \(1 von 4\)/);
    const inconsistent = screen.getByTestId("par-risk-inconsistent");
    expect(inconsistent.textContent).toMatch(/^Par-Risiko: Spec passt nicht zur Kurve \(1\) – EUR-ESTR:/);
    // the inconsistent curve is not listed among the curves *without* quotes (the collateral curve EUR-ESTR-USDCSA is)
    expect(coverage.textContent).toMatch(/ohne Quotes: EUR-EURIBOR-3M, EUR-ESTR-USDCSA\./);
    // the two other EUR curves really carry no spec – that sentence stays, but only for „die übrigen“
    expect(coverage.textContent).toMatch(/Die übrigen Kurven des importierten Snapshots tragen keine Bootstrap-Quotes/);
    // a consistent block: no warning at all
    act(() => {
      st().leaveImport();
      const r = st().importSnapshot({
        ...sampleSnapshot(st().valuationDate),
        quotes: Object.values(specs)
          .filter((sp) => sp.currency === "EUR")
          .map((sp) => ({ curveId: sp.id, spec: sp })),
      });
      expect(r.ok).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId("par-risk-coverage")).toBeNull());
  });

  it("R10-F3: IRS rows in „kredit-cap-2026.csv“ import as IRS; a template name that misleads offers „Anderen Produkttyp wählen …“", async () => {
    render(<App />);
    const irs = "id;currency;notional;direction;rate;start;maturity;index\nIRS-KREDIT-1;EUR;10000000;Pay;3 %;2026-09-07;10Y;EURIBOR-6M\n";
    fireEvent.click(screen.getByTestId("export-menu-btn"));
    let input = (await screen.findByTestId("import-csv")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([irs], "kredit-cap-2026.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(st().trades.some((t) => t.id === "IRS-KREDIT-1")).toBe(true));
    expect(st().toasts.at(-1)!.msg).toMatch(/CSV \(Typ IRS aus dem Spaltensatz\)/);
    expect(screen.queryByTestId("csv-errors")).toBeNull();
    // the workstation template name is authoritative – wrong rows land in the error dialog, which offers the type dialog
    fireEvent.click(screen.getByTestId("export-menu-btn"));
    input = (await screen.findByTestId("import-csv")) as HTMLInputElement;
    const irs2 = irs.replace("IRS-KREDIT-1", "IRS-KREDIT-2");
    fireEvent.change(input, { target: { files: [new File([irs2], "deriva-import-vorlage-cap.csv", { type: "text/csv" })] } });
    const errors = await screen.findByTestId("csv-errors");
    expect(errors.textContent).toMatch(/Strike fehlt/);
    expect(errors.textContent).toMatch(/als CAP aus dem Dateinamen gelesen/);
    fireEvent.click(within(errors).getByTestId("csv-errors-retype"));
    const dialog = await screen.findByTestId("csv-type-dialog");
    expect(dialog.textContent).toMatch(/wurde als CAP aus dem Dateinamen gelesen/);
    fireEvent.change(within(dialog).getByTestId("csv-type-select"), { target: { value: "IRS" } });
    fireEvent.click(within(dialog).getByTestId("csv-type-continue"));
    await waitFor(() => expect(st().trades.some((t) => t.id === "IRS-KREDIT-2")).toBe(true));
    expect(screen.queryByTestId("csv-errors")).toBeNull();
    expect(screen.queryByTestId("csv-type-dialog")).toBeNull();
  });
});
