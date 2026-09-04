/** App-level regression tests for the round-5 UI review (docs/quality/review-ui-r5.md). */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App.js";
import { useStore } from "./state/store.js";
import { preloadViews } from "./views/lazy-views.js";
import { lazyComponent } from "./lib/lazy.js";

describe("App – round 5", () => {
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
    });
  });

  it("R5-02: the per-row compare checkboxes are no tab stops – the row is, and Space toggles the mark", () => {
    render(<App />);
    const boxes = document.querySelectorAll<HTMLInputElement>("table.blotter input.compare-check");
    expect(boxes.length).toBeGreaterThan(5);
    for (const b of boxes) expect(b.tabIndex).toBe(-1);
    expect(document.querySelectorAll('table.blotter tbody [tabindex="0"]').length).toBe(1);
    const row = document.querySelector<HTMLElement>('table.blotter tbody tr[tabindex="0"]')!;
    act(() => row.focus());
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(useStore.getState().compareIds).toContain(useStore.getState().selectedId);
    // the mouse still hits the box
    fireEvent.click(boxes[0]!);
    expect(useStore.getState().compareIds.length).toBeGreaterThanOrEqual(1);
    // sortable headers: one tab stop, arrow keys move along the columns
    const headerBtns = document.querySelectorAll<HTMLButtonElement>("table.blotter thead .th-btn");
    expect(headerBtns.length).toBeGreaterThan(5);
    expect(Array.from(headerBtns).filter((b) => b.tabIndex !== -1)).toHaveLength(1);
    const first = Array.from(headerBtns).find((b) => b.tabIndex === 0)!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(headerBtns[Array.from(headerBtns).indexOf(first) + 1]);
    expect(Array.from(headerBtns).filter((b) => b.tabIndex !== -1)).toHaveLength(1);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(headerBtns[headerBtns.length - 1]);
  });

  it("R5-04: vega buckets are labelled German in the pricing risk table and key-value tables carry names", () => {
    useStore.setState({ view: "pricing", selectedId: "SWPT-0001" });
    render(<App />);
    act(() => {
      useStore.getState().ensureRisk("SWPT-0001");
    });
    const risk = screen.getByTestId("risk-table");
    expect(risk).toHaveAttribute("aria-label", "Risiko (Bump)");
    expect(within(risk).getByText(/Vega Swaption EUR/)).toBeInTheDocument();
    expect(within(risk).queryByText(/Vega swaption EUR/)).toBeNull();
    expect(screen.getByTestId("analytics-table")).toHaveAttribute("aria-label", "Preis-Analytics");
    act(() => useStore.setState({ view: "blotter" }));
    expect(screen.getByTestId("inspector-analytics")).toHaveAttribute("aria-label", "Kennzahlen");
    for (const t of document.querySelectorAll("table.grid-table.kv")) expect(t.getAttribute("aria-label")).toBeTruthy();
  });

  it("R5-07: customer mode hides the internal formulas of the report (fair-value decomposition, bank margin, XVA method)", () => {
    useStore.setState({ view: "report", selectedId: "IRS-0001" });
    useStore.getState().generateReport();
    const { unmount } = render(<App />);
    expect(screen.getByTestId("audit-hashes")).toBeInTheDocument();
    expect(screen.getByText("= risikofrei − CVA + DVA")).toBeInTheDocument();
    expect(screen.getByTestId("sign-rule").textContent).toMatch(/Marge der Bank/);
    expect(screen.getByTestId("xva-method")).toBeInTheDocument();
    unmount();
    act(() => useStore.getState().toggleCustomerMode());
    render(<App />);
    const report = screen.getByTestId("report");
    expect(within(report).queryByText("= risikofrei − CVA + DVA")).toBeNull();
    expect(within(report).getByText("inkl. Kontrahentenrisiko")).toBeInTheDocument();
    expect(report.textContent).not.toMatch(/Marge der Bank/);
    expect(report.textContent).not.toMatch(/\bCVA\b|\bDVA\b/);
    expect(screen.queryByTestId("xva-method")).toBeNull();
    expect(screen.getByTestId("sign-rule").textContent).toMatch(/Anfänglicher Marktwert aus Kundensicht/);
    // the methodology list keeps the non-internal lines
    expect(within(screen.getByTestId("methodology")).getAllByRole("listitem").length).toBeGreaterThan(2);
  });

  it("R5-F2: the report's snapshot id equals the market's core id – no UI label is hashed in", () => {
    useStore.setState({ view: "report", selectedId: "IRS-0001" });
    const s = useStore.getState();
    const q = JSON.parse(JSON.stringify(s.quotes)) as typeof s.quotes;
    (q.eurOis[0] as { rate: number }).rate += 0.0005;
    s.setQuotes(q, "Quote +5 bp");
    s.generateReport();
    render(<App />);
    const audit = screen.getByTestId("audit-hashes").textContent ?? "";
    const id = /Snapshot (\w+)/.exec(audit)![1];
    const header = screen.getByTestId("report-header").textContent ?? "";
    expect(header).toMatch(/· modifiziert/);
    // the id shown is the id of the market as priced (label untouched)
    return import("@deriva/pricing-core").then(({ marketSnapshotId }) => {
      expect(id).toBe(marketSnapshotId(useStore.getState().market));
    });
  });

  it("R5-2: the FX option editor warns when the pair has no vol surface", () => {
    useStore.setState({ view: "pricing", selectedId: "FXO-0001" });
    render(<App />);
    const pair = screen.getByRole("combobox", { name: "Paar" }) as HTMLSelectElement;
    expect(screen.queryByText(/Keine FX-Vol-Fläche/)).toBeNull();
    const withoutSurface = Array.from(pair.options)
      .map((o) => o.value)
      .find(
        (p) =>
          !Object.keys(useStore.getState().baseMarket.fxVols ?? {}).includes(p) &&
          !Object.keys(useStore.getState().baseMarket.fxVols ?? {}).includes(`${p.slice(3)}${p.slice(0, 3)}`),
      );
    if (withoutSurface) {
      fireEvent.change(pair, { target: { value: withoutSurface } });
      expect(screen.getByText(/Keine FX-Vol-Fläche/)).toBeInTheDocument();
    } else {
      // the sample market covers every pair of the editor – the hint has nothing to warn about
      expect(Object.keys(useStore.getState().baseMarket.fxVols ?? {}).length).toBeGreaterThanOrEqual(6);
    }
  });

  it("help overlay names the FX-fixings card and the snapshot semantics", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "?" });
    const dialog = screen.getByRole("dialog", { name: "Tastenkürzel" });
    expect(dialog.textContent).toMatch(/FX-Fixings \(MtM-Reset\)/);
    expect(dialog.textContent).toMatch(/Snapshot exportieren \/ importieren/);
  });

  it("lazyComponent renders synchronously once preloaded and shows the fallback before", async () => {
    let resolve!: (v: { default: () => React.JSX.Element }) => void;
    const Lazy = lazyComponent<object>(() => new Promise((r) => (resolve = r)), { fallback: () => <div data-testid="fb">…</div> });
    expect(Lazy.loaded).toBe(false);
    const { unmount } = render(<Lazy />);
    expect(screen.getByTestId("fb")).toBeInTheDocument();
    const p = Lazy.preload();
    resolve({ default: () => <div data-testid="real">real</div> });
    await act(async () => {
      await p;
    });
    expect(Lazy.loaded).toBe(true);
    unmount();
    render(<Lazy />);
    expect(screen.getByTestId("real")).toBeInTheDocument();
    expect(screen.queryByTestId("fb")).toBeNull();
  });

  it("g-chord navigation renders the lazily loaded views synchronously once preloaded", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "m" });
    expect(useStore.getState().view).toBe("market");
    expect(screen.getByTestId("snapshot-id").textContent).toMatch(/^[0-9a-f]{8,}$/);
    expect(screen.queryByTestId("view-skeleton")).toBeNull();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "s" });
    expect(useStore.getState().view).toBe("scenarios");
    expect(screen.queryByTestId("view-skeleton")).toBeNull();
  });

  it("valuation-date popover asks before discarding an imported snapshot", async () => {
    const { serializeMarket } = await import("@deriva/pricing-core");
    const file = JSON.parse(JSON.stringify(serializeMarket(useStore.getState().baseMarket)));
    expect(useStore.getState().importSnapshot(file).ok).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    fireEvent.keyDown(window, { key: "T", shiftKey: true });
    const input = screen.getByLabelText("Bewertungstag", { selector: "input" });
    fireEvent.change(input, { target: { value: "04.09.2026" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(useStore.getState().marketSource).toBe("import");
    expect(screen.getByTestId("market-chip").textContent).toMatch(/importiert/);
    confirm.mockRestore();
  });
});
