import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { parseQuickEntry } from "./lib/quick-parser.js";
import { newTradeTemplate } from "./lib/templates.js";
import { useStore } from "./state/store.js";
import { preloadViews } from "./views/lazy-views.js";

describe("App", () => {
  // Views are lazy chunks (ADR-026); preloading once keeps the assertions below synchronous.
  beforeAll(() => preloadViews());
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
    act(() => {
      useStore.getState().setValuationDate("2026-09-03");
    });
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
  it("chord o t generates the report implicitly and opens the termsheet (N-22 / R3-01)", async () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    // the former Ctrl+Shift+T is browser-reserved and must do nothing
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(useStore.getState().docKind).toBeNull();
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "t" });
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
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("audit-hashes")).toBeInTheDocument();
    // methodology and market table carry German labels only – no raw identifiers / interpolation ids (R3-06)
    const meth = screen.getByTestId("methodology").textContent ?? "";
    expect(meth).not.toMatch(/\b[a-z]+[A-Z]\w+\b/);
    expect(meth).not.toMatch(/ModifiedFollowing|ShortFront|MISSING_FIXING|smile vol at strike|Float EURIBOR/);
    expect(screen.getByTestId("market-table").textContent).toMatch(/log-linear \(DF\)/);
    expect(screen.getByTestId("market-table").textContent).not.toMatch(/logLinear/);
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
    act(() => {
      useStore.getState().undo();
    });
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
  it("palette lists CCS / FRA templates from the keymap; n r creates an FRA, n z a CCS with the basis-spread key metric", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Cross-Currency" } });
    expect(screen.getByText("Neuer Cross-Currency-Swap")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Neues FRA" } });
    expect(screen.getByText("Neues FRA")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "ccs eurusd 5y -20bp 10m mtm" } });
    expect(screen.getByText(/Trade anlegen: Cross-Currency-Swap EUR\/USD 5Y/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    const n = useStore.getState().trades.length;
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "r" });
    expect(useStore.getState().trades.length).toBe(n + 1);
    const fra = useStore.getState().trades[n]!;
    expect(fra.type).toBe("FRA");
    expect(fra.id).toMatch(/^FRA-\d{4}$/);
    expect(useStore.getState().view).toBe("pricing");
    await waitFor(() => expect(screen.getByLabelText("Index")).toBeInTheDocument());
    expect(screen.getByTestId("pricing-details").textContent).toMatch(/Fixing-Datum \d{2}\.\d{2}\.\d{4}/);
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "z" });
    const ccs = useStore.getState().trades[n + 1]!;
    expect(ccs.type).toBe("CrossCurrencySwap");
    await waitFor(() => expect(screen.getAllByText("Fairer Basis-Spread").length).toBeGreaterThan(0));
    expect(screen.getByText("Interim (bei Nominaländerung)")).toBeInTheDocument();
    expect(screen.getByLabelText("MtM-Reset")).toBeInTheDocument();
    act(() => useStore.getState().removeTrade(ccs.id));
    act(() => useStore.getState().removeTrade(fra.id));
  });
  it("step-up table: adding a coupon step writes rateSchedule and the analytics show both par rates; a schedule entry at the start date is the base, not 'Stufe 1' (R3-10)", async () => {
    render(<App />);
    // quick-entry step-up: the core writes {start, 2.5 %} + steps – the editor shows 2 Stufen, not 3
    const stepped = parseQuickEntry("irs 5y pay 2.5% 10m step 2.5/3.0/3.5", useStore.getState().valuationDate).trade!;
    act(() => {
      useStore.getState().addTrade({ ...stepped, id: "STEP-T1" }, { select: true, goToPricing: true });
    });
    expect(screen.getByTestId("coupon-schedule-0").textContent).toMatch(/2 Stufen/);
    expect(screen.getByTestId("coupon-schedule-0").textContent).toMatch(/2,500 % \(Basis\)/);
    act(() => useStore.getState().removeTrade("STEP-T1"));
    act(() => useStore.getState().select("IRS-0002"));
    act(() => useStore.getState().setView("pricing"));
    const before = useStore.getState().trades.find((t) => t.id === "IRS-0002")!;
    fireEvent.click(screen.getByTestId("coupon-add-0"));
    const after = useStore.getState().trades.find((t) => t.id === "IRS-0002")!;
    expect(after.type === "InterestRateSwap" && (after.legs[0] as { rateSchedule?: unknown[] }).rateSchedule?.length).toBe(1);
    await waitFor(() => expect(screen.getByTestId("analytics-table").textContent).toMatch(/Par-Satz \(Basis, Staffel konstant\)/));
    expect(screen.getByTestId("analytics-table").textContent).toMatch(/Par-Satz \(flach\)/);
    expect(screen.getByLabelText("Stufe 1 Kupon Leg 1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Stufe 1 entfernen"));
    expect(useStore.getState().trades.find((t) => t.id === "IRS-0002")).toEqual({
      ...before,
      legs: before.type === "InterestRateSwap" ? before.legs.map((l) => ({ ...l, ...(l.type === "Fixed" ? { rateSchedule: undefined } : {}) })) : [],
    });
    act(() => useStore.getState().updateTrade(before));
  });
  it("regulatory fields: an expired quote shows 'abgelaufen', the 'ohne UTI' chip filters, the KID / Confirmation dialogs open", async () => {
    render(<App />);
    const fra = useStore.getState().trades.find((t) => t.id === "FRA-0001")!;
    act(() => useStore.getState().updateTrade({ ...fra, status: "Quoted", quoteValidUntil: useStore.getState().valuationDate - 3 }));
    expect(screen.getAllByTestId("quote-expired").length).toBeGreaterThan(0);
    const withoutUti = useStore.getState().trades.filter((t) => !t.uti).length;
    const chip = screen.getByTestId("filter-no-uti");
    expect(chip.textContent).toContain(`(${withoutUti})`);
    fireEvent.click(chip);
    expect(document.querySelectorAll('tr[data-nav="trade"]').length).toBe(withoutUti);
    fireEvent.click(chip);
    act(() => useStore.getState().updateTrade(fra));
    // KID via chord o k (report generated implicitly), Confirmation via button
    act(() => useStore.getState().select("IRS-0001"));
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "k" });
    expect(useStore.getState().docKind).toBe("KID");
    expect(useStore.getState().view).toBe("report");
    const modal = await screen.findByTestId("documents-modal");
    expect(modal).toBeInTheDocument();
    expect(screen.getByTestId("kid-form")).toBeInTheDocument();
    expect(screen.getByTestId("document-body").textContent).toMatch(/Basisinformationsblatt/);
    expect(screen.getByTestId("document-body").textContent).toMatch(/Gesamtrisikoindikator|Risiko/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useStore.getState().docKind).toBeNull());
    fireEvent.click(screen.getByTestId("open-confirmation"));
    await screen.findByTestId("confirmation-form");
    expect(screen.getByTestId("document-body").textContent).toMatch(/Rahmenvertrag/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useStore.getState().modalDepth).toBe(0));
    expect(screen.getByTestId("open-kid")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
  });
  it("scenarios: the historical toggle adds the core stress episodes with an expandable description", () => {
    render(<App />);
    act(() => useStore.getState().setView("scenarios"));
    const table = () => screen.getByTestId("scenario-table").textContent ?? "";
    expect(table()).not.toMatch(/Lehman/);
    fireEvent.click(screen.getByTestId("historical-toggle"));
    expect(table()).toMatch(/Lehman Okt 2008/);
    expect(screen.getAllByText("historisch").length).toBeGreaterThan(3);
    fireEvent.click(screen.getByRole("button", { name: /Beschreibung Lehman Okt 2008 anzeigen/ }));
    expect(screen.getByTestId("scenario-description").textContent).toMatch(/Lehman/);
    fireEvent.click(screen.getByTestId("historical-toggle"));
    expect(table()).not.toMatch(/Lehman/);
  });
  it("curves: JPY-TONA is selectable, turn-of-year applies a forward jump; market: CDS term structure feeds the report's CVA", async () => {
    render(<App />);
    act(() => useStore.getState().setView("curves"));
    fireEvent.click(screen.getByRole("button", { name: "TONA" }));
    expect(screen.getAllByText(/JPY-TONA/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "€STR" }));
    const bp = screen.getByTestId("toy-bp") as HTMLInputElement;
    fireEvent.change(bp, { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toy-apply"));
    expect(useStore.getState().turnOfYear["EUR-ESTR"]?.bp).toBe(20);
    expect(screen.getByTestId("toy-badge")).toBeInTheDocument();
    act(() => {
      useStore.getState().setTurnOfYear("EUR-ESTR", undefined);
    });
    // CDS term structure for the counterparty of IRS-0001 → report uses the bootstrapped hazard curve
    act(() => useStore.getState().setView("market"));
    fireEvent.change(screen.getByTestId("cds-cpty"), { target: { value: "Landesbank A" } });
    fireEvent.click(screen.getByTestId("cds-add"));
    fireEvent.click(screen.getByTestId("cds-add"));
    expect(useStore.getState().cdsCurves["Landesbank A"]?.length).toBe(2);
    expect(screen.getByTestId("hazard-pillars").textContent).toMatch(/Hazard-Kurve/);
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("report"));
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => expect(screen.getByTestId("cva-sub").textContent).toMatch(/CDS-Termstruktur Landesbank A \(2 Pillars\)/));
    act(() => useStore.getState().setCdsCurve("Landesbank A", undefined));
    await waitFor(() => expect(screen.getByTestId("cva-sub").textContent).toMatch(/Kontrahent \d+ bp/));
  });
  it("hedge: the hedged item takes the amortisation plan of the instrument; option instruments offer the designation", async () => {
    render(<App />);
    const amort = { ...newTradeTemplate("amort", useStore.getState().valuationDate), id: "AMORT-T1" };
    act(() => {
      useStore.getState().addTrade(amort, { select: true });
    });
    act(() => useStore.getState().setView("hedge"));
    expect(screen.queryByTestId("hedge-designation")).toBeNull();
    fireEvent.click(screen.getByTestId("hedge-take-schedule"));
    const rel = useStore.getState().hedgeRelationships["AMORT-T1"]!;
    expect(rel.hedgedItem.notionalSchedule?.length).toBeGreaterThan(5);
    expect(rel.hedgedItem.amortisation?.type).toBe("Custom");
    fireEvent.change(screen.getByTestId("hedge-amortisation"), { target: { value: "Annuity" } });
    expect(useStore.getState().hedgeRelationships["AMORT-T1"]!.hedgedItem.amortisation?.type).toBe("Annuity");
    expect(screen.getByLabelText("Kreditzins Grundgeschäft")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("hedge-test"));
    await screen.findByTestId("hedge-verdict-badge");
    expect(screen.getAllByText("Nominalverlauf").length).toBeGreaterThan(1); // form label + critical-terms row
    act(() => useStore.getState().select("CAP-0001"));
    expect(screen.getByTestId("hedge-designation")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("hedge-designation"), { target: { value: "IntrinsicValue" } });
    expect(useStore.getState().hedgeRelationships["CAP-0001"]!.designation).toBe("IntrinsicValue");
    fireEvent.click(screen.getByTestId("hedge-test"));
    await screen.findByTestId("hedge-coh");
    act(() => useStore.getState().removeHedgeRelationship("CAP-0001"));
    act(() => useStore.getState().removeHedgeRelationship("AMORT-T1"));
    act(() => useStore.getState().removeTrade("AMORT-T1"));
  }, 20000);
  it("portfolio report: the export menu offers JSON and Markdown and the hotkey downloads the JSON", () => {
    render(<App />);
    const spy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("export-menu-btn"));
    expect(screen.getByTestId("export-portfolio-json")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("export-portfolio-md"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(useStore.getState().toasts.some((t) => t.msg.includes("Portfolio-Report als Markdown"))).toBe(true);
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "p" });
    expect(click).toHaveBeenCalledTimes(2);
    // under an active what-if the download asks first (R3-F6) …
    act(() => useStore.getState().setWhatIf({ ratesBp: 10 }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "p" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(2);
    confirm.mockReturnValue(true);
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "p" });
    expect(click).toHaveBeenCalledTimes(3);
    act(() => useStore.getState().resetWhatIf());
    // … and an empty book yields a hint instead of a file
    const trades = useStore.getState().trades;
    act(() => {
      useStore.setState({ trades: [], results: {} });
    });
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "p" });
    expect(click).toHaveBeenCalledTimes(3);
    expect(useStore.getState().toasts.some((t) => t.msg.includes("Kein Trade im Bestand"))).toBe(true);
    act(() => {
      useStore.setState({ trades });
    });
    act(() => useStore.getState().repriceAll());
    confirm.mockRestore();
    spy.mockRestore();
    click.mockRestore();
  });
  it("popovers are dialog layers: Esc closes the export menu wherever the focus is, background hotkeys are suspended, focus returns (R3-02)", async () => {
    render(<App />);
    const btn = screen.getByTestId("export-menu-btn");
    act(() => btn.focus());
    fireEvent.click(btn);
    expect(screen.getByRole("menu", { name: "Export und Import" })).toBeInTheDocument();
    expect(useStore.getState().popoverDepth).toBe(1);
    // `t` must not toggle the theme while the menu is open
    const theme = useStore.getState().theme;
    fireEvent.keyDown(window, { key: "t" });
    expect(useStore.getState().theme).toBe(theme);
    // roving focus inside the menu
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("menuitem"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    // Esc with the focus anywhere closes and returns focus to the toggle
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Export und Import" })).toBeNull();
    expect(useStore.getState().popoverDepth).toBe(0);
    await waitFor(() => expect(document.activeElement).toBe(btn));
    // click outside closes the column chooser
    fireEvent.click(screen.getByTestId("cols-btn"));
    expect(screen.getByTestId("cols-popover")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("cols-popover")).toBeNull();
    // date presets popover of a date field behaves the same
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("pricing"));
    fireEvent.click(document.querySelector(".date-input .date-presets-btn")!);
    expect(screen.getByRole("listbox", { name: "Datums-Vorlagen" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "t" });
    expect(useStore.getState().theme).toBe(theme);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Datums-Vorlagen" })).toBeNull();
    expect(useStore.getState().popoverDepth).toBe(0);
  });
  it("context menu returns the focus to the row it was opened on (R3-08); the live region exists before the first toast", async () => {
    render(<App />);
    expect(screen.getByTestId("toast-stack")).toHaveAttribute("aria-live", "polite");
    expect(useStore.getState().toasts.length).toBe(0);
    const row = document.querySelector<HTMLElement>('tr[data-id="IRS-0002"]')!;
    act(() => row.focus());
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu", { name: "Kontextmenü" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("menuitem"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Kontextmenü" })).toBeNull();
    await waitFor(() => expect(document.activeElement?.getAttribute("data-id")).toBe("IRS-0002"));
  });
  it("palette: an id-like query never jumps to another trade – exact match first, otherwise 'kein Trade' (R3-F5)", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "FRA-0002" } });
    expect(screen.getByTestId("palette-no-trade")).toHaveTextContent(/Kein Trade FRA-0002/);
    expect(document.querySelectorAll("#palette-results .item").length).toBe(0); // no fuzzy FXF-0002
    const view = useStore.getState().view;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().view).toBe(view); // nothing opened
    expect(useStore.getState().selectedId).toBe("IRS-0001");
    fireEvent.change(input, { target: { value: "IRS-0002" } });
    expect(input.getAttribute("aria-activedescendant")).toBe("pal-opt-0");
    expect(document.getElementById("pal-opt-0")?.textContent).toMatch(/^▸?IRS-0002 · /);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().selectedId).toBe("IRS-0002");
    expect(useStore.getState().paletteOpen).toBe(false);
  });
  it("documents under an active what-if carry a stress banner and ask before print/download; KID long texts wrap as text cells (R3-F1 / R3-05)", async () => {
    render(<App />);
    act(() => useStore.getState().select("COL-0001"));
    act(() => useStore.getState().setWhatIf({ ratesBp: 10 }));
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "k" });
    await screen.findByTestId("documents-modal");
    expect(screen.getByTestId("doc-whatif-banner").textContent).toMatch(/What-if.*Zinsen \+10 bp/i);
    expect(screen.getByTestId("document-body").textContent).toMatch(/WHAT-IF Zinsen \+10 bp/);
    const textCells = document.querySelectorAll('[data-testid="document-body"] td.text');
    expect(textCells.length).toBeGreaterThan(0);
    expect(Array.from(textCells).some((td) => (td.textContent ?? "").length > 100)).toBe(true); // Zielmarkt / SRI-Herleitung
    for (const td of document.querySelectorAll('[data-testid="document-body"] td.num')) expect((td.textContent ?? "").length).toBeLessThanOrEqual(60);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("doc-markdown"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("doc-print"));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
    click.mockRestore();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useStore.getState().docKind).toBeNull());
    act(() => useStore.getState().resetWhatIf());
    // without what-if: no banner
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "t" });
    await screen.findByTestId("documents-modal");
    expect(screen.queryByTestId("doc-whatif-banner")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useStore.getState().modalDepth).toBe(0));
    await new Promise((r) => setTimeout(r, 20));
  });
  it("hedge 'Zurücksetzen' asks first, offers undo and the export carries the stale marker (R3-F4)", async () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("hedge"));
    fireEvent.change(screen.getByLabelText("Hedge Ratio"), { target: { value: "50" } });
    expect(useStore.getState().hedgeRelationships["IRS-0001"]?.hedgeRatio).toBeCloseTo(0.5, 10);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByTestId("hedge-reset"));
    expect(useStore.getState().hedgeRelationships["IRS-0001"]).toBeDefined();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId("hedge-reset"));
    expect(useStore.getState().hedgeRelationships["IRS-0001"]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Rückgängig" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(useStore.getState().hedgeRelationships["IRS-0001"]?.hedgeRatio).toBeCloseTo(0.5, 10);
    confirm.mockRestore();
    act(() => useStore.getState().removeHedgeRelationship("IRS-0001"));
    act(() => {
      useStore.setState({ undoStack: [] });
    });
  });
  it("curves: a turn-of-year date on/before the valuation date shows a validation message and disables 'Anwenden' (R3-F2); '+ FX-Punkte' adds a removable quote (Markt R3-6)", () => {
    render(<App />);
    act(() => useStore.getState().setView("curves"));
    fireEvent.click(screen.getByRole("button", { name: "€STR" }));
    fireEvent.change(screen.getByTestId("toy-bp"), { target: { value: "20" } });
    const date = screen.getByLabelText("Turn-of-Year Datum") as HTMLInputElement;
    act(() => date.focus());
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: "01.01.2020" } });
    fireEvent.keyDown(date, { key: "Enter" });
    expect(screen.getByTestId("toy-past")).toBeInTheDocument();
    expect(screen.getByTestId("toy-apply")).toBeDisabled();
    expect(useStore.getState().turnOfYear["EUR-ESTR"]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "EUR/USD CSA" }));
    const rows = document.querySelectorAll('[data-testid="quotes-table"] tbody tr').length;
    fireEvent.click(screen.getByTestId("add-fx-points"));
    expect(document.querySelectorAll('[data-testid="quotes-table"] tbody tr').length).toBe(rows + 1);
    expect(screen.getByTestId("added-quote")).toBeInTheDocument();
    expect(useStore.getState().quotes.eurUsdXccy?.some((q) => q.type === "FxSwapPoints")).toBe(true);
    expect(screen.getByTestId("market-modified-chip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Quote .* entfernen$/ }));
    expect(document.querySelectorAll('[data-testid="quotes-table"] tbody tr').length).toBe(rows);
    act(() => useStore.getState().resetQuotes());
    act(() => {
      useStore.setState({ undoStack: [] });
    });
  });
  it("market: editing a swaption vol cell marks the market as modified, is undoable and resettable (Markt R3-4)", () => {
    render(<App />);
    act(() => useStore.getState().setView("market"));
    const cell = screen.getByTestId("swaption-vol-cell") as HTMLInputElement;
    const before = cell.value;
    act(() => cell.focus());
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "99" } });
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByTestId("swaption-vol-edited")).toBeInTheDocument();
    expect(useStore.getState().baseMarket.swaptionVols?.EUR?.atm[0]![0]).toBeCloseTo(0.0099, 10);
    expect(screen.getAllByText(/modifiziert/).length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useStore.getState().volSurfaces.swaptionVols).toBeUndefined();
    expect((screen.getByTestId("swaption-vol-cell") as HTMLInputElement).value).toBe(before);
    fireEvent.change(screen.getByTestId("fx-vol-cell"), { target: { value: "12" } });
    expect(screen.getByTestId("fx-vol-edited")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fx-vol-reset"));
    expect(screen.queryByTestId("fx-vol-edited")).toBeNull();
    act(() => {
      useStore.setState({ undoStack: [] });
    });
  });
  it("editor: UTI is upper-cased and validated, Esc in a date field restores the old value (R3-10 / R3-12)", () => {
    render(<App />);
    act(() => useStore.getState().select("IRS-0001"));
    act(() => useStore.getState().setView("pricing"));
    const uti = screen.getByLabelText("UTI") as HTMLInputElement;
    fireEvent.change(uti, { target: { value: "abc!" } });
    expect(useStore.getState().trades.find((t) => t.id === "IRS-0001")?.uti).toBe("ABC!");
    expect(screen.getByText(/ISO 23897/)).toBeInTheDocument();
    fireEvent.change(uti, { target: { value: "" } });
    const end = screen.getByLabelText("Enddatum") as HTMLInputElement;
    const before = end.value;
    act(() => end.focus());
    fireEvent.focus(end);
    fireEvent.change(end, { target: { value: "31.12.2040" } });
    fireEvent.keyDown(end, { key: "Escape" });
    fireEvent.blur(end);
    expect(end.value).toBe(before);
    expect(document.activeElement).not.toBe(end);
    act(() => {
      useStore.getState().undo();
    });
    act(() => {
      useStore.setState({ undoStack: [] });
    });
  });
  it("no store writes during render: risk is filled by effects and views render without React warnings (N-26)", async () => {
    render(<App />);
    act(() => {
      useStore.setState({ compareIds: ["IRS-0001", "CAP-0001"] });
    });
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
    act(() => {
      useStore.setState({ compareIds: [] });
    });
  });
});
