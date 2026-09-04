import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cashflowTable, toCsv, toISO } from "@deriva/pricing-core";
import { CommandPalette } from "./components/CommandPalette.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { HotkeyOverlay } from "./components/HotkeyOverlay.js";
import { Inspector } from "./components/Inspector.js";
import { restoreFocus } from "./components/Modal.js";
import { ValuationDatePopover } from "./components/ValuationDatePopover.js";
import { HOTKEYS, VIEW_HOTKEYS, keyList, keyTokens, keysText, primaryKeys, type HotkeyDef, type ViewId } from "./hotkeys/keymap.js";
import { isTextEntry, useHotkeys } from "./hotkeys/useHotkeys.js";
import { blotterCsv, buildBlotterRows, readBlotterColumns } from "./lib/blotter-export.js";
import { focusEditorField, focusWhenPresent } from "./lib/focus.js";
import { fmtDate, fmtMs } from "./lib/format.js";
import { marketLabelDe } from "./lib/i18n.js";
import { copyText, indicationText } from "./lib/indication.js";
import { downloadPortfolioReport } from "./lib/portfolio-export.js";
import { downloadText } from "./lib/portfolio-io.js";
import { deleteWithUndo, marketModified, selectedTrade, setToastHover, useStore, whatIfActive, whatIfLabel } from "./state/store.js";
import { Blotter } from "./views/Blotter.js";
// Every view except the blotter is a lazily loaded chunk (ADR-026 / N4-07); `g` chords prefetch the target view.
import { CompareView, CurvesView, HedgeView, MarketView, PricingWorkspace, ReportView, ScenariosView, preloadView, preloadViews } from "./views/lazy-views.js";
import { isTemplateId, newTradeTemplate } from "./lib/templates.js";
import { applyParSolve, flipTrade, parSolveLabel, parSolveUnavailable } from "./lib/trade-ops.js";

export const VIEWS: { id: ViewId; label: string; icon: string; hint: string }[] = [
  { id: "blotter", label: "Blotter", icon: "▤", hint: "1" },
  { id: "pricing", label: "Pricing", icon: "ƒ", hint: "2" },
  { id: "curves", label: "Kurven", icon: "∿", hint: "3" },
  { id: "scenarios", label: "Szenarien", icon: "⊞", hint: "4" },
  { id: "market", label: "Markt", icon: "◔", hint: "5" },
  { id: "report", label: "Report", icon: "▣", hint: "6" },
  { id: "compare", label: "Vergleich", icon: "⇆", hint: "7" },
  { id: "hedge", label: "Hedge Accounting", icon: "⛨", hint: "8" },
];

/** Chord keys ("g b") of a view, taken from the hotkey registry. */
function chordOf(view: ViewId): string {
  const def = VIEW_HOTKEYS.find((v) => v.view === view)?.def;
  return def ? primaryKeys(def) : "";
}

const hk = (id: string) => HOTKEYS.find((h) => h.id === id)!;

/** Context hints for the status bar, per view (F-43). */
function statusHintIds(view: ViewId): string[] {
  switch (view) {
    case "blotter":
      return ["palette", "open", "duplicate", "delete", "compare.toggle"];
    case "pricing":
      return ["palette", "bump.up", "solve.par", "flip", "doc.termsheet"];
    case "curves":
      return ["palette", "valdate", "bump.up", "undo"];
    case "report":
      return ["palette", "report.generate", "doc.termsheet", "doc.kid", "customer"];
    case "hedge":
      return ["palette", "go.pricing", "go.blotter", "help"];
    default:
      return ["palette", "help", "go.pricing", "new.irs", "bump.up"];
  }
}

export function App() {
  // Narrow selectors: the shell re-renders only when one of these slices changes (arch N-09).
  const s = useStore(
    useShallow((st) => ({
      theme: st.theme,
      view: st.view,
      inspectorOpen: st.inspectorOpen,
      customerMode: st.customerMode,
      paletteOpen: st.paletteOpen,
      helpOpen: st.helpOpen,
      valDateOpen: st.valDateOpen,
      modalDepth: st.modalDepth,
      toasts: st.toasts,
      chordPrefix: st.chordPrefix,
      restored: st.restored,
      whatIf: st.whatIf,
      quotes: st.quotes,
      interpolation: st.interpolation,
      turnOfYear: st.turnOfYear,
      volSurfaces: st.volSurfaces,
      fxFixings: st.fxFixings,
      fxSpotOverrides: st.fxSpotOverrides,
      fixings: st.fixings,
      importedBase: st.importedBase,
      marketSource: st.marketSource,
      valuationDate: st.valuationDate,
      reportingCurrency: st.reportingCurrency,
      tradesCount: st.trades.length,
      lastPricingMs: st.lastPricingMs,
      compareCount: st.compareIds.length,
      lastUndo: st.undoStack[st.undoStack.length - 1],
      marketLabel: marketLabelDe(st.baseMarket.meta?.label, ""),
    })),
  );
  const act = useStore.getState;
  const [inputMode, setInputMode] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const restoredShown = useRef(false);

  // Offline indicator (R4-F3): the valuation core runs in the browser, the app shell is served by the service worker.
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);

  // Idle prefetch of the remaining view chunks once the start route is interactive (ADR-026): a later hotkey
  // switch then renders synchronously; a chord start (`g`) prefetches eagerly in addition (see `setChord`).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasIdle = typeof window.requestIdleCallback === "function";
    const handle = hasIdle ? window.requestIdleCallback(() => void preloadViews(), { timeout: 4000 }) : window.setTimeout(() => void preloadViews(), 2500);
    return () => {
      if (hasIdle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  // "Eingabemodus" indicator (F-05): track whether a text field owns the focus (state is only written when it changes).
  useEffect(() => {
    let last: boolean | undefined;
    const update = () => {
      const next = isTextEntry(document.activeElement);
      if (next === last) return;
      last = next;
      setInputMode(next);
    };
    const onOut = () => window.setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  /**
   * Where the focus came from when it entered the toast stack (R10-03): a toast button activated by keyboard vanishes with
   * its toast, so the focus would fall to `body`. `relatedTarget` of the focus event is the element that lost the focus;
   * the skip link counts as "nowhere" (the user tabbed in from the page start) and maps to the `main` fallback.
   */
  const toastOrigin = useRef<HTMLElement | null>(null);
  const rememberToastOrigin = (e: React.FocusEvent<HTMLDivElement>) => {
    const from = e.relatedTarget as HTMLElement | null;
    if (from && !e.currentTarget.contains(from)) toastOrigin.current = from.matches("a.skip") ? null : from;
    else if (!from) toastOrigin.current = null;
  };
  /** After a toast action / ✕ by keyboard (`detail` 0): back to the origin, or to `main#main` when it is gone (R10-03). */
  const returnToastFocus = (e: React.MouseEvent) => {
    if (e.detail !== 0) return;
    restoreFocus(toastOrigin.current);
    toastOrigin.current = null;
  };

  // Restore toast (F-13) – once after hydration. It is an information toast without a destructive action (R9-F4): the
  // toast stack is the first tab stop after the skip link, so „Zurücksetzen“ there was one `Tab`, `↵` away after every
  // reload. The reset lives in the palette („Beispielportfolio laden“) and the empty blotter, asks first and is undoable.
  useEffect(() => {
    if (!s.restored || restoredShown.current) return;
    restoredShown.current = true;
    const info = s.restored;
    act().clearRestored();
    act().showToast(
      `Bestand aus lokalem Speicher geladen (${info.trades} Trades${info.quotesModified ? ", Markt modifiziert" : ""}) – Beispielportfolio über die Palette (Ctrl+K „Beispielportfolio“)`,
      { ms: 8000 },
    );
  }, [s.restored, act]);

  const exportCsv = useCallback(() => {
    const st = useStore.getState();
    const t = selectedTrade(st);
    if (!t) {
      st.showToast("Kein Trade ausgewählt");
      return;
    }
    const r = st.results[t.id]?.result;
    if (!r) {
      st.showToast("Keine Bewertung für diesen Trade");
      return;
    }
    downloadText(
      `${t.id}-cashflows-${toISO(st.valuationDate)}.csv`,
      toCsv(cashflowTable(r), { sep: ";", decimalComma: true, bom: true }),
      "text/csv;charset=utf-8",
    );
    st.showToast("Cashflows als CSV exportiert");
  }, []);

  const exportBlotter = useCallback(() => {
    const st = useStore.getState();
    const order = st.visibleIds.length ? st.visibleIds : st.trades.map((t) => t.id);
    const trades = order.map((id) => st.trades.find((t) => t.id === id)!).filter(Boolean);
    const rows = buildBlotterRows(trades, st.results, st.market, st.reportingCurrency);
    downloadText(
      `blotter-${toISO(st.valuationDate)}.csv`,
      blotterCsv(rows, readBlotterColumns(), st.reportingCurrency, { customer: st.customerMode }),
      "text/csv;charset=utf-8",
    );
    st.showToast(`Blotter als CSV exportiert (${rows.length} Trades)`);
  }, []);

  const onHotkey = useCallback(
    (def: HotkeyDef) => {
      const st = useStore.getState();
      const t = selectedTrade(st);
      const go = (v: ViewId) => st.setView(v);
      const needTrade = (): boolean => {
        if (t) return true;
        st.showToast("Kein Trade ausgewählt");
        return false;
      };
      switch (def.id) {
        case "palette":
        case "palette2":
          st.setPalette(true);
          break;
        case "help":
          st.setHelp(!st.helpOpen);
          break;
        case "escape": {
          const el = document.activeElement as HTMLElement | null;
          if (el && isTextEntry(el)) {
            el.blur();
            break;
          }
          if (st.paletteOpen) st.setPalette(false);
          else if (st.helpOpen) st.setHelp(false);
          else if (st.valDateOpen) st.setValDateOpen(false);
          break;
        }
        case "go.blotter":
        case "view.1":
          go("blotter");
          break;
        case "go.pricing":
        case "view.2":
          go("pricing");
          break;
        case "go.curves":
        case "view.3":
          go("curves");
          break;
        case "go.scenarios":
        case "view.4":
          go("scenarios");
          break;
        case "go.market":
        case "view.5":
          go("market");
          break;
        case "go.report":
        case "view.6":
          go("report");
          break;
        case "go.compare":
        case "view.7":
          go("compare");
          break;
        case "go.hedge":
        case "view.8":
          go("hedge");
          break;
        case "valdate":
          st.setValDateOpen(!st.valDateOpen);
          break;
        case "new.irs":
        case "new.cap":
        case "new.swpt":
        case "new.fxf":
        case "new.fxo":
        case "new.basis":
        case "new.amort":
        case "new.imm":
        case "new.fxs":
        case "new.ccs":
        case "new.fra": {
          const kind = def.id.replace("new.", "");
          if (!isTemplateId(kind)) break;
          const nt = st.addTrade(newTradeTemplate(kind, st.valuationDate), { goToPricing: true, autoId: true });
          st.showToast(`Neu: ${nt.id} · ${nt.name ?? ""}`);
          // R7-03: the focus lands on the first editor field ("Bezeichnung"), not on body
          void focusEditorField();
          break;
        }
        case "export.portfolio":
          downloadPortfolioReport("json");
          break;
        case "duplicate": {
          if (!needTrade()) break;
          const c = st.duplicateSelected();
          if (c) {
            st.showToast(`Dupliziert: ${c.id}`, { action: { label: "Rückgängig", run: () => useStore.getState().undo() } });
            // R8-05: the focus follows the copy – "Bezeichnung" in the pricing workspace, the new blotter row elsewhere
            void (useStore.getState().view === "pricing" ? focusEditorField() : focusWhenPresent(`tr[data-id="${c.id}"]`));
          }
          break;
        }
        case "delete":
          if (needTrade()) deleteWithUndo(t!.id);
          break;
        case "undo": {
          const label = st.undo();
          st.showToast(label ? `Rückgängig: ${label}` : "Nichts rückgängig zu machen");
          break;
        }
        case "down":
          st.selectNext(1);
          break;
        case "up":
          st.selectNext(-1);
          break;
        case "open":
          if (t) go("pricing");
          break;
        case "compare.toggle":
          if (t && (st.view === "blotter" || st.view === "compare")) st.toggleCompare(t.id);
          break;
        case "reprice":
          st.repriceAll();
          st.showToast("Portfolio neu bewertet");
          break;
        case "solve.par":
          if (needTrade()) {
            const r = st.results[t!.id]?.result;
            const t2 = applyParSolve(t!, r, { market: st.market, reportingCurrency: st.reportingCurrency });
            if (t2) {
              st.updateTrade(t2);
              st.showToast(parSolveLabel(t!), { action: { label: "Rückgängig", run: () => useStore.getState().undo() } });
            } else st.showToast(parSolveUnavailable(t!));
          }
          break;
        case "bump.up":
          st.setWhatIf({ ratesBp: st.whatIf.ratesBp + 10 });
          break;
        case "bump.down":
          st.setWhatIf({ ratesBp: st.whatIf.ratesBp - 10 });
          break;
        case "bump.reset":
          st.resetWhatIf();
          st.showToast("What-if zurückgesetzt");
          break;
        case "flip":
          if (needTrade()) {
            st.updateTrade(flipTrade(t!));
            st.showToast("Richtung getauscht", { action: { label: "Rückgängig", run: () => useStore.getState().undo() } });
          }
          break;
        case "ccy": {
          st.cycleReportingCurrency();
          st.showToast(`Reporting-Währung ${useStore.getState().reportingCurrency}`);
          break;
        }
        case "theme":
          st.toggleTheme();
          break;
        case "inspector":
          st.toggleInspector();
          st.showToast(st.inspectorOpen ? "Inspector ausgeblendet" : "Inspector eingeblendet");
          break;
        case "customer":
          st.toggleCustomerMode();
          st.showToast(st.customerMode ? "Kundenmodus aus – interne Daten sichtbar" : "Kundenmodus an – interne Daten ausgeblendet");
          break;
        case "export.csv":
          exportCsv();
          break;
        case "export.blotter":
          exportBlotter();
          break;
        case "copy.indication":
          if (needTrade()) {
            void copyText(
              indicationText(t!, st.results[t!.id]?.result, st.risk(t!.id), st.reportingCurrency, st.valuationDate, { customer: st.customerMode }),
            ).then((ok) => useStore.getState().showToast(ok ? "Indikation in die Zwischenablage kopiert" : "Kopieren nicht möglich"));
          }
          break;
        case "report.generate":
          if (!needTrade()) break;
          st.generateReport();
          if (st.view !== "report") go("report");
          st.showToast("Report erzeugt – Zeitstempel fixiert");
          break;
        case "doc.termsheet":
        case "doc.suitability":
        case "doc.kid":
        case "doc.confirmation": {
          // Documents need a generated report: generate implicitly, then open the dialog in the report view (N-22).
          if (!needTrade()) break;
          if (!st.reportStamp) st.generateReport();
          const kind =
            def.id === "doc.termsheet" ? "Termsheet" : def.id === "doc.suitability" ? "Geeignetheitserklaerung" : def.id === "doc.kid" ? "KID" : "Confirmation";
          st.setDoc(kind);
          if (st.view !== "report") go("report");
          break;
        }
      }
    },
    [exportCsv, exportBlotter],
  );

  const dialogOpen = s.paletteOpen || s.helpOpen || s.modalDepth > 0;
  const hotkeyFilter = useCallback((def: HotkeyDef) => {
    const st = useStore.getState();
    // Popovers (Export ▾, Spalten, Datums-Vorlagen) suspend background hotkeys like dialogs (R3-02).
    const anyDialog = st.paletteOpen || st.helpOpen || st.modalDepth > 0 || st.popoverDepth > 0 || st.valDateOpen;
    if (!anyDialog) return true;
    if (def.id === "escape") return true;
    if (st.helpOpen && def.id === "help") return true;
    return false;
  }, []);
  const setChord = useStore((st) => st.setChord);
  const onChord = useCallback(
    (prefix: string | null) => {
      setChord(prefix);
      // `g …` announces a view switch: fetch the view chunks now so the second key renders without a skeleton (ADR-026).
      if (prefix === "g") void preloadViews();
    },
    [setChord],
  );
  useHotkeys(onHotkey, { onChord, filter: hotkeyFilter });

  const wiActive = whatIfActive(s.whatIf);
  const modified = marketModified(s);
  const view = VIEWS.find((v) => v.id === s.view)!;
  const customerKeys = keysText(hk("customer"));
  const lastUndo = s.lastUndo;

  return (
    <>
      <a className="skip" href="#main">
        Zum Inhalt
      </a>
      {/* Toast stack right after the skip link: its action buttons ("Rückgängig") are the first tab stops after "Zum Inhalt" (R4-F2);
          the live region is mounted from the start so screen readers announce the very first toast (R3-08). It sits outside the
          `inert` app shell and is positioned fixed, so the DOM position does not change the layout. */}
      <div
        className="toast-stack"
        role="status"
        aria-live="polite"
        onMouseEnter={() => setToastHover(true)}
        onMouseLeave={() => setToastHover(false)}
        onFocus={rememberToastOrigin}
        data-testid="toast-stack"
      >
        {s.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.action ? "with-action" : ""}`}>
            <span className="msg" onClick={() => act().dismissToast(t.id)}>
              {t.msg}
              {t.count > 1 && (
                <span className="badge count" aria-label={`${t.count}-mal`}>
                  ×{t.count}
                </span>
              )}
            </span>
            {t.action && (
              <button
                className="btn xs"
                title={t.action.label === "Rückgängig" ? `Rückgängig (${keysText(hk("undo"))})` : t.action.label}
                onClick={(e) => {
                  t.action!.run();
                  act().dismissToast(t.id);
                  returnToastFocus(e);
                }}
              >
                {t.action.label}
                {/* visible shortcut hint; the accessible name stays "Rückgängig" (the title carries the keys) */}
                {t.action.label === "Rückgängig" && (
                  <span className="muted xs" aria-hidden="true">
                    {" "}
                    ({keysText(hk("undo"))})
                  </span>
                )}
              </button>
            )}
            <button
              className="close"
              onClick={(e) => {
                act().dismissToast(t.id);
                returnToastFocus(e);
              }}
              aria-label="Meldung schließen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div
        className={`app ${s.inspectorOpen && s.view !== "pricing" ? "with-inspector" : ""} ${s.customerMode ? "customer-mode" : ""}`}
        inert={dialogOpen || undefined}
      >
        <nav className="rail" aria-label="Hauptnavigation">
          <div className="logo" title="DERIVA" aria-hidden="true">
            Δ
          </div>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={s.view === v.id ? "active" : ""}
              aria-current={s.view === v.id ? "page" : undefined}
              aria-label={v.label}
              title={`${v.label} (Alt+${v.hint} oder ${chordOf(v.id)})`}
              onClick={() => act().setView(v.id)}
              onMouseEnter={() => void preloadView(v.id)}
              onFocus={() => void preloadView(v.id)}
            >
              <span style={{ fontSize: 18 }} aria-hidden="true">
                {v.icon}
              </span>
              <span className="hint" aria-hidden="true">
                {v.hint}
              </span>
            </button>
          ))}
          <div className="spacer" />
          <button title="Tastenkürzel (?)" aria-label="Tastenkürzel anzeigen" onClick={() => act().setHelp(true)}>
            <span style={{ fontSize: 16 }}>?</span>
          </button>
          <button title="Theme (t)" aria-label={s.theme === "dark" ? "Helles Theme" : "Dunkles Theme"} onClick={() => act().toggleTheme()}>
            <span style={{ fontSize: 15 }}>{s.theme === "dark" ? "☾" : "☀"}</span>
          </button>
        </nav>

        <header className="topbar">
          <h1 className="title">DERIVA</h1>
          {/* The view title is the h2 of the page (h1 DERIVA → h2 view → h3 cards, R4-10); styled like the former crumb. */}
          <h2 className="crumb">/ {view.label}</h2>
          {!online && (
            <span
              className="chip warn"
              data-testid="offline-chip"
              title="Keine Netzwerkverbindung – Bewertung läuft lokal im Browser, der Bestand ist lokal gespeichert"
            >
              ⚠ offline – lokaler Bestand
            </span>
          )}
          {s.customerMode && (
            <button
              className="chip customer"
              onClick={() => act().toggleCustomerMode()}
              title={`Kundenmodus beenden (${customerKeys})`}
              data-testid="customer-chip"
            >
              ◉ KUNDENANSICHT
            </button>
          )}
          <div className="grow" />
          <button className="cmd-button" onClick={() => act().setPalette(true)} aria-label="Command Palette öffnen" data-testid="cmd-button">
            <span className="cmd-text">Befehl oder Schnelleingabe … (z.B. „irs 10y pay 3.1% 10m“)</span>
            <span className="row" style={{ gap: 4 }}>
              {keyTokens("mod+k")[0]!.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </button>
          <span className="anchor">
            <button
              className={`chip market ${wiActive ? "warn" : modified ? "modified" : ""}`}
              onClick={() => act().setValDateOpen(!s.valDateOpen)}
              aria-expanded={s.valDateOpen}
              aria-haspopup="dialog"
              data-testid="market-chip"
              title={`Bewertungstag setzen (${keysText(hk("valdate"))})${modified ? " · Quotes/Interpolation weichen vom Sample ab" : ""}${
                s.marketSource === "import" ? " · Markt aus importiertem Snapshot" : ""
              }`}
            >
              <span className="dot" /> {s.marketLabel ?? "Markt"}
              {s.marketSource === "import" && " · importiert"}
              {modified && " · modifiziert"} · {fmtDate(s.valuationDate)}
              {wiActive && ` · What-if ${whatIfLabel(s.whatIf)}`}
            </button>
            {s.valDateOpen && <ValuationDatePopover />}
          </span>
          <button
            className="chip"
            onClick={() => {
              act().cycleReportingCurrency();
              act().showToast(`Reporting-Währung ${useStore.getState().reportingCurrency}`);
            }}
            title="Reporting-Währung (c)"
            aria-label={`Reporting-Währung ${s.reportingCurrency} – wechseln`}
          >
            {s.reportingCurrency}
          </button>
        </header>

        <main className="main" id="main" tabIndex={-1}>
          <ErrorBoundary key={s.view} scope={view.label}>
            {s.view === "blotter" && <Blotter />}
            {s.view === "pricing" && <PricingWorkspace />}
            {s.view === "curves" && <CurvesView />}
            {s.view === "scenarios" && <ScenariosView />}
            {s.view === "market" && <MarketView />}
            {s.view === "report" && <ReportView />}
            {s.view === "compare" && <CompareView />}
            {s.view === "hedge" && <HedgeView />}
          </ErrorBoundary>
        </main>

        {s.inspectorOpen && s.view !== "pricing" && (
          <aside className="inspector" aria-label="Inspector">
            <ErrorBoundary scope="Inspector">
              <Inspector />
            </ErrorBoundary>
          </aside>
        )}

        <footer className="statusbar" data-testid="statusbar">
          <span>
            {s.tradesCount} Trades · Bewertung {fmtMs(s.lastPricingMs, 1)}
          </span>
          <button className="link" onClick={() => act().setValDateOpen(true)} title="Bewertungstag ändern (⇧T)">
            Bewertungstag {fmtDate(s.valuationDate)}
          </button>
          {modified && (
            <span
              className="warn-text"
              title="Marktquotes, Spots, Interpolation, Turn-of-Year, Vol-Flächen, Fixings, FX-Fixings oder Kurven wurden geändert (Ctrl+Z macht jede Änderung rückgängig)"
            >
              ● Markt modifiziert
            </span>
          )}
          {!online && (
            <span className="warn-text" data-testid="offline-status">
              offline
            </span>
          )}
          {s.compareCount > 0 && (
            <span className="muted" title="Trades im Vergleich (g v)">
              ⇆ {s.compareCount} im Vergleich
            </span>
          )}
          {lastUndo && (
            <span className="muted" title={`Rückgängig: ${lastUndo.label}`}>
              {keysText(hk("undo"))} ↶ {lastUndo.label}
            </span>
          )}
          {s.chordPrefix && (
            <span className="chord-indicator">
              {s.chordPrefix} … <span className="muted">(zweite Taste)</span>
            </span>
          )}
          {inputMode && (
            <span className="input-mode" data-testid="input-mode">
              Eingabemodus – <kbd>Esc</kbd> beendet
            </span>
          )}
          <div className="grow" />
          <span className="row hints" style={{ gap: 14 }}>
            {statusHintIds(s.view).map((id) => {
              const h = hk(id);
              return (
                <span key={h.id} className="row" style={{ gap: 4 }}>
                  {keyTokens(keyList(h)[0]!).map((combo, i) => (
                    <span key={i} className="row" style={{ gap: 2 }}>
                      {combo.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  ))}
                  <span>{h.label.replace(/ \(.*\)$/, "")}</span>
                </span>
              );
            })}
          </span>
        </footer>
      </div>

      {s.paletteOpen && <CommandPalette onHotkey={onHotkey} />}
      {s.helpOpen && <HotkeyOverlay />}
    </>
  );
}
