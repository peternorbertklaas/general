import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { useStore } from "./state/store.js";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      view: "blotter",
      selectedId: "IRS-0001",
      compareIds: [],
      customerMode: false,
      paletteOpen: false,
      helpOpen: false,
      valDateOpen: false,
      toasts: [],
      modalDepth: 0,
      whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 },
      docKind: null,
      reportStamp: null,
      reportKey: null,
      riskCache: {},
    });
    useStore.getState().resetWhatIf();
    if (!("createObjectURL" in URL)) Object.defineProperty(URL, "createObjectURL", { value: () => "blob:test", writable: true, configurable: true });
    if (!("revokeObjectURL" in URL)) Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true, configurable: true });
  });
  it("renders the blotter with the sample portfolio, an h1 and a skip link", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("DERIVA");
    expect(screen.getAllByText("IRS-0001").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Portfolio-Barwert/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("onboarding")).toBeInTheDocument();
    expect(screen.getByText("Zum Inhalt").closest("a")?.getAttribute("href")).toBe("#main");
    // sortable headers are buttons with aria-sort
    const idHeader = screen.getByRole("button", { name: /^ID/ });
    expect(idHeader.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    // blotter rows are the only rows the global Enter may open
    expect(document.querySelectorAll('tr[data-nav="trade"]').length).toBeGreaterThan(5);
    expect(screen.getByRole("grid", { name: "Blotter" })).toBeInTheDocument();
  });
  it("navigates with chord hotkeys and opens the palette; focus returns to the opener after the shell lost inert (N-03)", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "c" });
    expect(useStore.getState().view).toBe("curves");
    const opener = screen.getByTestId("cmd-button");
    act(() => opener.focus());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useStore.getState().paletteOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument();
    // palette items are generated from the keymap (parity)
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Blotter als CSV" } });
    expect(screen.getByText("Blotter als CSV exportieren")).toBeInTheDocument();
    // active option is announced via aria-activedescendant (N-06)
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toMatch(/^pal-opt-/);
    expect(document.getElementById(activeId!)?.getAttribute("aria-selected")).toBe("true");
    fireEvent.change(input, { target: { value: "Landesbank" } });
    expect(screen.getAllByText(/Landesbank A/).length).toBeGreaterThan(0); // counterparty is searchable
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useStore.getState().paletteOpen).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it("↑ rotates through the quick-entry examples repeatedly (N-05)", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const first = input.value;
    expect(first).not.toBe("");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).not.toBe(first);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const third = input.value;
    expect(third).not.toBe(first);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).not.toBe(third);
    fireEvent.keyDown(input, { key: "Escape" });
  });
  it("what-if bump reprices the portfolio – also via AltGr and the + / 0 aliases", () => {
    render(<App />);
    const before = useStore.getState().results["IRS-0001"]!.result!.pv;
    fireEvent.keyDown(window, { key: "]" });
    const after = useStore.getState().results["IRS-0001"]!.result!.pv;
    expect(useStore.getState().whatIf.ratesBp).toBe(10);
    expect(after).toBeGreaterThan(before); // payer swap gains when rates rise
    fireEvent.keyDown(window, { key: "\\" });
    expect(useStore.getState().whatIf.ratesBp).toBe(0);
    // German Windows: AltGr+9 → "]" with ctrl+alt set
    fireEvent.keyDown(window, { key: "]", code: "Digit9", ctrlKey: true, altKey: true });
    expect(useStore.getState().whatIf.ratesBp).toBe(10);
    // macOS German: Option+5 → "[" must not switch to view 5
    fireEvent.keyDown(window, { key: "[", code: "Digit5", altKey: true });
    expect(useStore.getState().whatIf.ratesBp).toBe(0);
    expect(useStore.getState().view).toBe("blotter");
    fireEvent.keyDown(window, { key: "+" });
    expect(useStore.getState().whatIf.ratesBp).toBe(10);
    fireEvent.keyDown(window, { key: "0" });
    expect(useStore.getState().whatIf.ratesBp).toBe(0);
    // Alt+3 via e.code even when the key is a special character
    fireEvent.keyDown(window, { key: "¶", code: "Digit3", altKey: true });
    expect(useStore.getState().view).toBe("curves");
  });
  it("Enter on a focused button or a pillar row does not open the trade; Enter on the body / a blotter row does (F-02, N-02)", async () => {
    render(<App />);
    const rail = screen.getByRole("button", { name: "Kurven" });
    rail.focus();
    fireEvent.keyDown(rail, { key: "Enter" });
    expect(useStore.getState().view).toBe("blotter");
    rail.blur();
    const row = document.querySelector<HTMLElement>('tr[data-nav="trade"]')!;
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "Enter" });
    expect(useStore.getState().view).toBe("pricing");
    act(() => useStore.getState().setView("curves"));
    const pillar = screen.getByTestId("pillar-table").querySelector<HTMLElement>("tbody tr")!;
    act(() => pillar.focus());
    fireEvent.keyDown(pillar, { key: "Enter" });
    expect(useStore.getState().view).toBe("curves");
    act(() => pillar.blur());
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(useStore.getState().view).toBe("pricing");
    await waitFor(() => expect(screen.queryByTestId("input-mode")).toBeNull());
  });
  it("Esc leaves an input field and the status bar shows the input mode (F-05)", async () => {
    render(<App />);
    const search = screen.getByLabelText("Blotter durchsuchen") as HTMLInputElement;
    act(() => search.focus());
    fireEvent.focusIn(search);
    expect(document.activeElement).toBe(search);
    expect(screen.getByTestId("input-mode")).toHaveTextContent(/Eingabemodus/);
    fireEvent.keyDown(search, { key: "j" }); // single keys are suspended while typing
    expect(useStore.getState().selectedId).toBe("IRS-0001");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(document.activeElement).not.toBe(search);
    await waitFor(() => expect(screen.queryByTestId("input-mode")).toBeNull());
  });
  it("space marks trades for comparison and g v opens the compare view", () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    fireEvent.keyDown(window, { key: " " });
    expect(useStore.getState().compareIds).toEqual(["IRS-0001"]);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "v" });
    expect(useStore.getState().view).toBe("compare");
    expect(screen.getByTestId("compare-empty")).toBeInTheDocument();
    act(() => useStore.getState().toggleCompare("IRS-0002"));
    expect(screen.getByTestId("compare-table")).toBeInTheDocument();
    expect(screen.getAllByText(/Barwert \(EUR\)/).length).toBeGreaterThan(0);
  });
  it("shift+k toggles the customer mode chip and hides internal columns", () => {
    render(<App />);
    expect(screen.getAllByText(/Kontrahent/).length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "K", shiftKey: true });
    expect(useStore.getState().customerMode).toBe(true);
    expect(screen.getByTestId("customer-chip")).toBeInTheDocument();
    expect(screen.queryByText("DV01 Portfolio")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Kontrahent/ })).toBeNull();
    fireEvent.keyDown(window, { key: "K", shiftKey: true });
    expect(useStore.getState().customerMode).toBe(false);
    expect(screen.queryByTestId("customer-chip")).toBeNull();
  });
  it("onboarding chips open the palette prefilled and Tab completes", () => {
    render(<App />);
    fireEvent.click(screen.getByText(/⚡ irs 10y pay 3.1% 10m/));
    expect(useStore.getState().paletteOpen).toBe(true);
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    expect(input.value).toBe("irs 10y pay 3.1% 10m");
    expect(screen.getByText(/Trade anlegen: Payer-Swap EUR 10Y @ 3,100 %/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("irs 10y pay 3.1% 10m");
    fireEvent.change(input, { target: { value: "stichtag 2026-12-31" } });
    expect(screen.getByText(/Bewertungstag setzen: 31.12.2026/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().valuationDate).toBe(useStore.getState().baseMarket.valuationDate);
    expect(screen.getAllByText(/Bewertungstag 31.12.2026/).length).toBeGreaterThan(0);
    act(() => useStore.getState().setValuationDate("2026-09-03"));
  });
  it("shift+t opens the valuation-date popover, g h the hedge view, delete offers undo", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "T", shiftKey: true });
    expect(screen.getByTestId("valdate-popover")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().valDateOpen).toBe(false);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "h" });
    expect(useStore.getState().view).toBe("hedge");
    expect(screen.getByTestId("hedge-view")).toBeInTheDocument();
    const n = useStore.getState().trades.length;
    fireEvent.keyDown(window, { key: "D", shiftKey: true });
    expect(useStore.getState().trades.length).toBe(n - 1);
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(useStore.getState().trades.length).toBe(n);
  });
  it("Ctrl+Shift+T generates the report implicitly and opens the termsheet (N-22)", async () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(useStore.getState().view).toBe("report");
    expect(useStore.getState().reportStamp).not.toBeNull();
    expect(useStore.getState().docKind).toBe("Termsheet");
    const modal = await screen.findByTestId("documents-modal");
    expect(modal).toBeInTheDocument();
    // decimal commas in the document, initial market value present (N-07 / N-22)
    const body = screen.getByTestId("document-body");
    expect(body.textContent).toMatch(/Anfänglicher Marktwert/);
    expect(body.textContent).not.toMatch(/\d\.\d{3} %/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useStore.getState().docKind).toBeNull());
    await waitFor(() => expect(useStore.getState().modalDepth).toBe(0));
    await new Promise((r) => setTimeout(r, 20));
  });
  it("report: perspective segment, governance line and a stale badge after a quote bump (N-18, coordinator 1/4)", () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("report"));
    fireEvent.keyDown(window, { key: "R", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("audit-hashes")).toBeInTheDocument();
    expect(screen.getByTestId("report-governance").textContent).toMatch(/Snapshot indikativ/);
    expect(screen.getByTestId("sign-rule").textContent).toMatch(/Perspektive Kunde/);
    expect(screen.queryByTestId("report-stale")).toBeNull();
    // quote bump → "Eingaben geändert" and "modifiziert" in the header
    const q = JSON.parse(JSON.stringify(useStore.getState().quotes)) as typeof useStore.getState extends () => infer S
      ? S extends { quotes: infer Q }
        ? Q
        : never
      : never;
    for (const k of q.eurOis) if ("rate" in k) k.rate += 0.001;
    act(() => {
      useStore.getState().setQuotes(q);
    });
    expect(screen.getByTestId("report-stale")).toBeInTheDocument();
    expect(screen.getByTestId("report-header").textContent).toMatch(/modifiziert/);
    // perspective switch is stored per trade and re-labels the sign rule
    fireEvent.click(screen.getByRole("button", { name: "Bank" }));
    expect(useStore.getState().reportInputs["IRS-0001"]?.perspective).toBe("Bank");
    expect(screen.getByTestId("sign-rule").textContent).toMatch(/Perspektive Bank/);
    act(() => useStore.getState().resetQuotes());
    act(() => useStore.getState().resetReportInputs("IRS-0001"));
  });
  it("blotter: grouping adds subtotal rows; invalid trades show 'Fehler' and are excluded from sums (N-19, N-21)", () => {
    render(<App />);
    fireEvent.change(screen.getByTestId("group-select"), { target: { value: "cpty" } });
    expect(screen.getAllByTestId("group-subtotal").length).toBeGreaterThan(1);
    expect(screen.getAllByTestId("group-subtotal")[0]!.textContent).toMatch(/^Σ /);
    fireEvent.change(screen.getByTestId("group-select"), { target: { value: "none" } });
    expect(screen.queryByTestId("group-subtotal")).toBeNull();
    const fxf = useStore.getState().trades.find((t) => t.id === "FXF-0001")!;
    act(() => useStore.getState().updateTrade({ ...fxf, sellCurrency: "USD", buyCurrency: "USD" } as typeof fxf));
    expect(screen.getByTestId("valuation-error")).toHaveTextContent("Fehler");
    act(() => useStore.getState().undo());
    expect(screen.queryByTestId("valuation-error")).toBeNull();
  });
  it("hedge: default designation lies before the valuation date and the verdict is flagged stale after a change (N-20)", async () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("hedge"));
    const date = screen.getByLabelText("Designationsdatum") as HTMLInputElement;
    expect(date.value).toBe("17.06.2024"); // effective date of IRS-0001
    fireEvent.click(screen.getByTestId("hedge-test"));
    await screen.findByTestId("hedge-verdict-badge");
    expect(screen.queryByTestId("hedge-stale")).toBeNull();
    const ratio = screen.getByLabelText("Hedge Ratio") as HTMLInputElement;
    fireEvent.change(ratio, { target: { value: "50" } });
    expect(screen.getByTestId("hedge-stale")).toBeInTheDocument();
    expect(screen.getByTestId("hedge-summary").textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(screen.getByTestId("hedge-summary").textContent).not.toMatch(/InterestRateSwap/);
    const spy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("hedge-export"));
    expect(spy).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    spy.mockRestore();
    click.mockRestore();
    act(() => useStore.getState().removeHedgeRelationship("IRS-0001"));
  }, 15000);
  it("no store writes during render: risk is filled by effects and views render without React warnings (N-26)", async () => {
    render(<App />);
    act(() => useStore.setState({ compareIds: ["IRS-0001", "CAP-0001"] }));
    act(() => useStore.getState().setView("compare"));
    await waitFor(() => expect(useStore.getState().riskCache["IRS-0001"]).toBeDefined());
    act(() => useStore.getState().setView("pricing"));
    await waitFor(() => expect(screen.getByTestId("risk-table")).toBeInTheDocument());
    // FX option analytics: no raw keys, FX delta as money (N-01)
    act(() => useStore.getState().select("FXO-0001"));
    await waitFor(() => expect(screen.getByTestId("analytics-table").textContent).toMatch(/Spot \(Bewertungstag\)/));
    await waitFor(() => expect(screen.getByTestId("risk-table")).toBeInTheDocument());
    const txt = screen.getByTestId("analytics-table").textContent ?? "";
    expect(txt).not.toMatch(/spotDate|greeksMethod|deltaPct|deltaAmount|spotAtValuationDate/);
    expect(txt).not.toMatch(/-?\d{1,3}(\.\d{3}){2,},\d{2} %/);
    expect(screen.getByTestId("cashflow-table").textContent).not.toMatch(/115,0000 %/);
    act(() => useStore.setState({ compareIds: [] }));
  });
});
