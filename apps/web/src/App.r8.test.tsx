/** App-level regression tests for the round-8 reviews (docs/quality/review-ui-r8.md, review-markt-r8.md). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { advance, getCalendar, knownCurrencies, makeSwaption, makeVanillaSwap } from "@deriva/pricing-core";
import { App } from "./App.js";
import { swaptionUnderlyingIndex } from "./lib/swaption.js";
import { LS_KEYS, useStore } from "./state/store.js";
import { sampleSnapshot, withCurve } from "./test/fixtures-r8.js";
import { preloadViews } from "./views/lazy-views.js";

const st = () => useStore.getState();
const OIS = [
  { type: "OIS" as const, tenor: "1Y", rate: 0.041 },
  { type: "OIS" as const, tenor: "2Y", rate: 0.0415 },
  { type: "OIS" as const, tenor: "5Y", rate: 0.042 },
  { type: "OIS" as const, tenor: "10Y", rate: 0.043 },
];
const active = () => document.activeElement as HTMLElement;
const activeLabel = () => active()?.getAttribute("aria-label") ?? active()?.tagName ?? "";
const tabStops = (root: HTMLElement) => root.querySelectorAll('[tabindex="0"]').length;
const flushTimers = () => new Promise((r) => setTimeout(r, 20));

describe("App – round 8", () => {
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

  it("R8-01 / R8-03: every control of a fixings row is keyboard-reachable (Tab cycles the row), ↵ commits and returns to the row, the row does not remount", async () => {
    render(<App />);
    act(() => st().setView("market"));
    const table = screen.getByTestId("fixings-table");
    const rows = () =>
      within(table)
        .getAllByRole("row")
        .filter((r) => r.closest("tbody"));
    const first = rows()[0]!;
    expect(tabStops(table)).toBe(1);
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "Enter" });
    expect(activeLabel()).toMatch(/^Index Fixing \d+$/);
    // Tab walks the row's controls: index → date → … → value → remove → back to the index
    const seen: string[] = [activeLabel()];
    for (let i = 0; i < 6 && !/^Wert Fixing/.test(activeLabel()); i++) {
      fireEvent.keyDown(active(), { key: "Tab" });
      seen.push(activeLabel());
    }
    expect(seen.some((l) => /^Datum Fixing/.test(l))).toBe(true);
    expect(activeLabel()).toMatch(/^Wert Fixing \d+$/);
    expect(first.contains(active())).toBe(true);
    fireEvent.keyDown(active(), { key: "Tab" });
    expect(activeLabel()).toMatch(/^Fixing \d+ entfernen$/);
    fireEvent.keyDown(active(), { key: "Tab" });
    expect(activeLabel()).toMatch(/^Index Fixing \d+$/); // cyclic
    fireEvent.keyDown(active(), { key: "Tab", shiftKey: true });
    expect(activeLabel()).toMatch(/^Fixing \d+ entfernen$/);
    // Esc → row
    fireEvent.keyDown(active(), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(first));
    // change the value by keyboard only: ↵/F2 → Tab → Tab to the value, type, ↵ → committed, focus back on the same row element
    fireEvent.keyDown(first, { key: "F2" });
    while (!/^Wert Fixing/.test(activeLabel())) fireEvent.keyDown(active(), { key: "Tab" });
    const valueInput = active() as HTMLInputElement;
    const fixingIndex = Number(/(\d+)$/.exec(valueInput.getAttribute("aria-label")!)![1]) - 1;
    fireEvent.focus(valueInput);
    fireEvent.change(valueInput, { target: { value: "2,5" } });
    fireEvent.keyDown(valueInput, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(st().fixings?.[fixingIndex]?.value).toBeCloseTo(0.025, 9);
    expect(screen.getByTestId("fixings-modified")).toBeInTheDocument();
    expect(document.contains(first)).toBe(true); // the row was updated in place, not remounted
    expect(screen.getByTestId("fixings-keys-hint").textContent).toMatch(/↵ übernimmt und kehrt zur Zeile zurück/);
    // changing the index select does not remount the row either
    fireEvent.keyDown(first, { key: "Enter" });
    const select = active() as HTMLSelectElement;
    const other = Array.from(select.options).find((o) => o.value !== select.value)!.value;
    fireEvent.change(select, { target: { value: other } });
    expect(document.contains(first)).toBe(true);
    expect(document.contains(select)).toBe(true);
  });

  it("R8-02 / R8-03: the FX grid keeps one tab stop after switching to a smaller surface; ↵ in a grid cell commits and returns to the cell", async () => {
    render(<App />);
    act(() => st().setView("market"));
    const grid = () => screen.getByTestId("fx-vol-grid");
    const cells = () => grid().querySelectorAll<HTMLElement>('[role="gridcell"]');
    act(() => cells()[0]!.focus());
    fireEvent.keyDown(cells()[0]!, { key: "End", ctrlKey: true });
    const last = active();
    expect(last.getAttribute("role")).toBe("gridcell");
    expect(Number(last.getAttribute("data-r"))).toBeGreaterThan(0);
    // pick a pair with fewer rows or columns than the current one
    const surfaces = Object.entries(st().baseMarket.fxVols!);
    const current = surfaces[0]!;
    const cols = (s: (typeof surfaces)[number][1]) =>
      ["atm", "rr25", "bf25", "rr10", "bf10"].filter((k) => (s as unknown as Record<string, unknown>)[k]).length;
    const smaller = surfaces.find(([, s]) => s.expiries.length < current[1].expiries.length || cols(s) < cols(current[1]))!;
    expect(smaller).toBeDefined();
    fireEvent.click(within(screen.getByTestId("fx-vol-pairs")).getByText(`${smaller[0].slice(0, 3)}/${smaller[0].slice(3)}`));
    expect(grid().querySelectorAll('[role="gridcell"][tabindex="0"]').length).toBe(1);
    expect(tabStops(grid())).toBe(1);
    const stop = grid().querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')!;
    expect(Number(stop.getAttribute("data-r"))).toBeLessThan(smaller[1].expiries.length);
    expect(Number(stop.getAttribute("data-c"))).toBeLessThan(cols(smaller[1]));
    // swaption grid: ↵ → input, edit, ↵ → committed and back on the cell
    const swpt = screen.getByTestId("swaption-vol-grid");
    const c00 = swpt.querySelector<HTMLElement>('[role="gridcell"]')!;
    act(() => c00.focus());
    fireEvent.keyDown(c00, { key: "Enter" });
    const input = active() as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(c00));
    expect(st().baseMarket.swaptionVols!.EUR!.atm[0]![0]).toBeCloseTo(0.007, 9);
    expect(swpt.closest(".card")!.textContent).toMatch(/↵ übernimmt und kehrt zur Zelle zurück/);
  });

  it("R8-04 / R8-F2: ↵ in the '+ Paar' rate field submits, the focus returns to '+ Paar', the spot is a structural extra with a remove button", async () => {
    render(<App />);
    act(() => st().setView("market"));
    fireEvent.click(screen.getByTestId("add-spot"));
    fireEvent.change(screen.getByTestId("add-spot-pair"), { target: { value: "EURSEK" } });
    const rate = screen.getByTestId("add-spot-rate") as HTMLInputElement;
    fireEvent.focus(rate);
    fireEvent.change(rate, { target: { value: "11,2" } });
    fireEvent.keyDown(rate, { key: "Enter" });
    expect(st().extraSpots.EURSEK).toBeCloseTo(11.2, 9);
    expect(screen.queryByTestId("add-spot-form")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("add-spot")));
    expect(screen.getByTestId("fx-spot-row-EURSEK").textContent).toMatch(/angelegt/);
    fireEvent.click(screen.getByTestId("fx-spot-remove-EURSEK"));
    expect(st().extraSpots.EURSEK).toBeUndefined();
    expect(screen.queryByTestId("fx-spot-row-EURSEK")).toBeNull();
  });

  it("R8-05: after `d` the focus is on „Bezeichnung“ in the pricing workspace; after a confirmed hedge reset on „Effektivität testen“", async () => {
    render(<App />);
    act(() => st().setView("pricing"));
    await waitFor(() => screen.getByLabelText("Bezeichnung"));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.keyDown(window, { key: "d" });
    expect(st().trades.length).toBe(14);
    await waitFor(() => expect(activeLabel()).toBe("Bezeichnung"));
    // hedge reset
    act(() => {
      st().select("IRS-0001");
      st().setHedgeRelationship({
        id: "HR-IRS-0001",
        name: "Hedge",
        type: "CashFlowHedge",
        hedgedItem: {
          description: "",
          currency: "EUR",
          notional: 1e7,
          kind: "FloatingRateLoan",
          effectiveDate: st().valuationDate,
          maturityDate: st().valuationDate + 3650,
        },
        hedgingInstrumentId: "IRS-0001",
        designationDate: st().valuationDate,
        hedgeRatio: 0.99,
        method: "DollarOffset",
        accountingFramework: "IFRS9",
      });
      st().setView("hedge");
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByTestId("hedge-reset"));
    expect(st().hedgeRelationships["IRS-0001"]).toBeUndefined();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("hedge-test")));
  });

  it("R8-06: under an imported snapshot the repair hint names the snapshot and „Zum Sample-Markt“; locked extra-curve tabs carry a tooltip", async () => {
    act(() => {
      st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
      st().addTrade(
        makeVanillaSwap({
          id: "IRS-DKK",
          currency: "DKK",
          notional: 1e7,
          payReceiveFixed: "Pay",
          fixedRate: 0.03,
          effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
          maturity: "5Y",
          index: "DESTR",
        }),
        {
          select: false,
        },
      );
      st().importSnapshot(sampleSnapshot(st().valuationDate));
    });
    render(<App />);
    const row = document.querySelector('tr[data-id="IRS-DKK"]')!;
    const badge = within(row as HTMLElement).getByTestId("valuation-error");
    expect(badge.getAttribute("title")).toMatch(
      /der importierte Snapshot enthält keine DKK-Kurve – Snapshot mit Kurve importieren oder „Zum Sample-Markt“ wechseln/,
    );
    expect(badge.getAttribute("title")).not.toMatch(/„\+ Kurve“/);
    act(() => st().setView("curves"));
    const tab = screen.getByTestId("curve-tab-DKK-DESTR") as HTMLButtonElement;
    expect(tab.disabled).toBe(true);
    expect(tab.title).toMatch(/nach „Zum Sample-Markt“ wieder aktiv/);
    act(() => st().leaveImport());
    expect((screen.getByTestId("curve-tab-DKK-DESTR") as HTMLButtonElement).disabled).toBe(false);
    expect(st().results["IRS-DKK"]?.error).toBeUndefined();
  });

  it("R8-F1: the swaption editor has an „Underlying-Index“ field; a currency change picks the curve-backed index; the quick entry says so", async () => {
    act(() => {
      st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
      st().addTrade({
        ...makeSwaption({
          id: "SWPT-T",
          currency: "EUR",
          notional: 1e7,
          payerReceiver: "Payer",
          strike: 0.03,
          expiry: "1Y",
          tenor: "5Y",
          valuationDate: st().valuationDate,
        }),
        name: "Swaption",
      });
      st().setView("pricing");
    });
    render(<App />);
    const idx = (await screen.findByLabelText("Underlying-Index")) as HTMLSelectElement;
    expect(idx.value).toBe("EURIBOR-6M");
    fireEvent.change(screen.getByLabelText("Währung"), { target: { value: "DKK" } });
    await waitFor(() => expect((screen.getByLabelText("Underlying-Index") as HTMLSelectElement).value).toBe("DESTR"));
    const t = st().trades.find((x) => x.id === "SWPT-T")!;
    expect(t.type === "Swaption" && swaptionUnderlyingIndex(t)).toBe("DESTR");
    expect(st().results["SWPT-T"]?.error).toBeUndefined();
    // switching to the conventional index without a curve: the error names the editor field
    fireEvent.change(screen.getByLabelText("Underlying-Index"), { target: { value: "CIBOR-6M" } });
    await waitFor(() =>
      expect(st().results["SWPT-T"]?.error).toMatch(/Kurve DKK-CIBOR-6M nicht im Markt-Snapshot – .*oder im Editor den Underlying-Index wechseln/),
    );
    // quick entry preview
    act(() => st().setView("blotter"));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Befehl oder Schnelleingabe" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "swpt dkk 1y5y payer 3% 10m" } });
    expect(screen.getByText(/Trade anlegen: Payer-Swaption DKK 1Yx5Y/).textContent).toMatch(/· Underlying DESTR \(Kurve vorhanden; CIBOR-6M ohne Kurve\)/);
    fireEvent.keyDown(input, { key: "Enter" });
    const created = st().trades.at(-1)!;
    expect(created.type).toBe("Swaption");
    expect(st().results[created.id]?.error).toBeUndefined();
  });

  it("Markt R8-5 / R8-1: snapshot curves outside the sample set are read-only tabs „(aus Snapshot)“; an unregistered currency is disabled in the editor", async () => {
    act(() => {
      const r = st().importSnapshot(withCurve(sampleSnapshot(st().valuationDate), "NOK-NOWA-2", "NOK", 11.62));
      expect(r.ok).toBe(true);
      st().setView("curves");
    });
    render(<App />);
    const tab = screen.getByTestId("curve-tab-NOK-NOWA-2") as HTMLButtonElement;
    expect(tab.disabled).toBe(false);
    expect(tab.textContent).toMatch(/NOWA-2.*\(aus Snapshot\)/);
    fireEvent.click(tab);
    expect(screen.getByTestId("curve-snapshot-badge")).toBeInTheDocument();
    expect(screen.getByTestId("quotes-snapshot-note").textContent).toMatch(/ohne Bootstrap-Quotes/);
    expect(screen.getByTestId("quotes-table").closest("[hidden]")).not.toBeNull();
    expect(within(screen.getByTestId("pillar-table")).getAllByRole("row").length).toBeGreaterThan(2);
    // the comparison offers the other curve of the currency – none here (only NOK-NOWA-2 is NOK), EUR tabs offer EUR curves
    fireEvent.click(screen.getByText("€STR"));
    const cmp = screen.getByLabelText("Vergleichskurve (gleiche Währung)") as HTMLSelectElement;
    expect(Array.from(cmp.options).map((o) => o.value)).toEqual(expect.arrayContaining(["EUR-EURIBOR-6M", "EUR-ESTR-USDCSA"]));
    // an unregistered currency with a curve (CZK from a snapshot without envelope) is listed disabled in the editor
    act(() => {
      st().leaveImport();
      st().importSnapshot(withCurve(sampleSnapshot(st().valuationDate), "CZK-CZEONIA", "CZK", 24.6));
      st().select("IRS-0001");
      st().setView("pricing");
    });
    const ccy = (await screen.findByLabelText("Währung")) as HTMLSelectElement;
    const czk = Array.from(ccy.options).find((o) => o.value === "CZK")!;
    expect(czk.disabled).toBe(true);
    expect(czk.textContent).toBe("CZK (nicht registriert)");
  });

  it("Markt R8-1: „+ Währung“ registers a currency (with a new calendar) that „+ Kurve“ and the palette accept; undo removes it", async () => {
    render(<App />);
    act(() => st().setView("curves"));
    fireEvent.click(screen.getByTestId("add-currency"));
    fireEvent.change(screen.getByTestId("add-currency-code"), { target: { value: "huf" } });
    expect(screen.getByTestId("add-currency-problem").textContent).toMatch(/OIS-Index angeben/);
    fireEvent.change(screen.getByTestId("add-currency-ois"), { target: { value: "HUFONIA" } });
    fireEvent.change(screen.getByTestId("add-currency-ibor"), { target: { value: "BUBOR-6M" } });
    fireEvent.click(screen.getByTestId("add-calendar"));
    fireEvent.change(screen.getByTestId("add-calendar-id"), { target: { value: "HU" } });
    fireEvent.change(screen.getByTestId("add-calendar-holidays"), { target: { value: "15.03.2027\n2027-08-20" } });
    expect(screen.getByTestId("add-currency-preview").textContent).toMatch(/2 Indizes HUFONIA, BUBOR-6M · Konventionen HUF · Kalender HU/);
    fireEvent.click(screen.getByTestId("add-currency-submit"));
    expect(knownCurrencies()).toContain("HUF");
    expect(st().extraRegister.calendars?.[0]?.id).toBe("HU");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("add-curve")));
    fireEvent.click(screen.getByTestId("add-curve"));
    const ccySelect = screen.getByTestId("add-curve-ccy") as HTMLSelectElement;
    expect(Array.from(ccySelect.options).map((o) => o.value)).toContain("HUF");
    fireEvent.change(ccySelect, { target: { value: "HUF" } });
    expect((screen.getByTestId("add-curve-index") as HTMLSelectElement).value).toBe("HUFONIA");
    fireEvent.click(screen.getByTestId("add-curve-submit"));
    expect(st().baseMarket.discountCurveId.HUF).toBe("HUF-HUFONIA");
    // registered list with removal (refused while the curve exists), then undo of curve + registration
    fireEvent.click(screen.getByTestId("add-currency"));
    expect(screen.getByTestId("add-currency-registered").textContent).toMatch(/HUF/);
    fireEvent.click(screen.getByLabelText("Registrierung HUF entfernen"));
    expect(knownCurrencies()).toContain("HUF");
    expect(st().toasts.some((t) => /wird von der Kurve HUF-HUFONIA verwendet/.test(t.msg))).toBe(true);
    act(() => {
      st().undo(); // curve
      st().undo(); // registration
    });
    expect(knownCurrencies()).not.toContain("HUF");
    expect(st().extraRegister).toEqual({});
  });

  it("Markt R8-3: the par-risk card names curves without quotes instead of a silent zero; help overlay names + Paar / + Fläche / + Währung", async () => {
    localStorage.setItem(LS_KEYS.parRiskOpen, "1");
    act(() => {
      st().addExtraCurve({ id: "NOK-NOWA", currency: "NOK", index: "NOWA", quotes: OIS }, { fxSpot: { pair: "EURNOK", rate: 11.62 } });
      st().addTrade(
        makeVanillaSwap({
          id: "IRS-NOK",
          currency: "NOK",
          notional: 1e7,
          payReceiveFixed: "Pay",
          fixedRate: 0.03,
          effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
          maturity: "5Y",
          index: "NOWA",
        }),
      );
      st().setView("pricing");
    });
    render(<App />);
    await screen.findByTestId("par-risk-card");
    expect(screen.queryByTestId("par-risk-coverage")).toBeNull(); // the added curve has quotes
    fireEvent.click(within(screen.getByTestId("par-risk-card")).getByText("Berechnen"));
    await waitFor(() => screen.getByTestId("par-risk"), { timeout: 8000 });
    expect(screen.getByTestId("par-risk-diff-note").textContent).toBe("Konvexität der Quotes / Kurvenkopplung");
    expect(screen.getByTestId("par-risk").textContent).toMatch(/NOK-NOWA · Σ/);
    // import mode: the snapshot's curves have no quotes → hint instead of a zero
    act(() => {
      st().importSnapshot(withCurve(sampleSnapshot(st().valuationDate), "NOK-NOWA", "NOK", 11.62));
    });
    await waitFor(() => expect(screen.getByTestId("par-risk-coverage").textContent).toMatch(/Par-Risiko nur für Kurven mit Quotes \(0 von 1\)/));
    // help overlay
    act(() => st().setView("blotter"));
    fireEvent.keyDown(window, { key: "?" });
    const help = await screen.findByTestId("hotkey-overlay");
    for (const s of ["+ Fläche", "+ Paar", "+ Währung", "+ Kalender"]) expect(help.textContent).toContain(s);
    await flushTimers();
  });
});
