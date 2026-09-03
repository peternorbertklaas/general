import { useCallback, useEffect } from "react";
import { cashflowTable, toCsv, toISO } from "@deriva/pricing-core";
import { CommandPalette } from "./components/CommandPalette.js";
import { HotkeyOverlay } from "./components/HotkeyOverlay.js";
import { Inspector } from "./components/Inspector.js";
import { HOTKEYS, keyTokens, type HotkeyDef, type ViewId } from "./hotkeys/keymap.js";
import { useHotkeys } from "./hotkeys/useHotkeys.js";
import { fmtDate } from "./lib/format.js";
import { selectedTrade, useStore } from "./state/store.js";
import { Blotter } from "./views/Blotter.js";
import { CurvesView } from "./views/CurvesView.js";
import { MarketView } from "./views/MarketView.js";
import { PricingWorkspace } from "./views/PricingWorkspace.js";
import { ReportView } from "./views/ReportView.js";
import { ScenariosView } from "./views/ScenariosView.js";
import { newTradeTemplate } from "./lib/templates.js";
import { applyParSolve, flipTrade } from "./lib/trade-ops.js";

const VIEWS: { id: ViewId; label: string; icon: string; hint: string }[] = [
  { id: "blotter", label: "Blotter", icon: "▤", hint: "1" },
  { id: "pricing", label: "Pricing", icon: "ƒ", hint: "2" },
  { id: "curves", label: "Kurven", icon: "∿", hint: "3" },
  { id: "scenarios", label: "Szenarien", icon: "⊞", hint: "4" },
  { id: "market", label: "Markt", icon: "◔", hint: "5" },
  { id: "report", label: "Report", icon: "▣", hint: "6" },
];

export function App() {
  const s = useStore();
  const trade = useStore(selectedTrade);

  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);

  const exportCsv = useCallback(() => {
    if (!trade) return;
    const r = s.results[trade.id]?.result;
    if (!r) return;
    const csv = toCsv(cashflowTable(r));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${trade.id}-cashflows.csv`;
    a.click();
    URL.revokeObjectURL(url);
    s.showToast("Cashflows als CSV exportiert");
  }, [trade, s]);

  const onHotkey = useCallback(
    (def: HotkeyDef) => {
      const go = (v: ViewId) => s.setView(v);
      switch (def.id) {
        case "palette":
        case "palette2":
          s.setPalette(true);
          break;
        case "help":
          s.setHelp(!s.helpOpen);
          break;
        case "escape":
          if (s.paletteOpen) s.setPalette(false);
          else if (s.helpOpen) s.setHelp(false);
          break;
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
        case "new.irs":
        case "new.cap":
        case "new.swpt":
        case "new.fxf":
        case "new.fxo": {
          const t = newTradeTemplate(def.id.replace("new.", "") as "irs" | "cap" | "swpt" | "fxf" | "fxo", s.valuationDate);
          s.addTrade(t, { goToPricing: true });
          s.showToast(`Neu: ${t.name ?? t.id}`);
          break;
        }
        case "duplicate":
          s.duplicateSelected();
          s.showToast("Trade dupliziert");
          break;
        case "delete":
          if (trade) {
            s.removeTrade(trade.id);
            s.showToast(`Gelöscht: ${trade.id}`);
          }
          break;
        case "down":
          s.selectNext(1);
          break;
        case "up":
          s.selectNext(-1);
          break;
        case "open":
          if (trade) go("pricing");
          break;
        case "reprice":
          s.repriceAll();
          s.showToast("Portfolio neu bewertet");
          break;
        case "solve.par":
          if (trade) {
            const r = s.results[trade.id]?.result;
            const t2 = applyParSolve(trade, r);
            if (t2) {
              s.updateTrade(t2);
              s.showToast("Par-Satz / fairer Preis übernommen");
            }
          }
          break;
        case "bump.up":
          s.setWhatIf({ ratesBp: s.whatIf.ratesBp + 10 });
          break;
        case "bump.down":
          s.setWhatIf({ ratesBp: s.whatIf.ratesBp - 10 });
          break;
        case "bump.reset":
          s.resetWhatIf();
          s.showToast("What-if zurückgesetzt");
          break;
        case "flip":
          if (trade) {
            s.updateTrade(flipTrade(trade));
            s.showToast("Pay/Receive getauscht");
          }
          break;
        case "ccy":
          s.cycleReportingCurrency();
          break;
        case "theme":
          s.toggleTheme();
          break;
        case "inspector":
          s.toggleInspector();
          break;
        case "export.csv":
          exportCsv();
          break;
      }
    },
    [s, trade, exportCsv],
  );

  useHotkeys(onHotkey, { onChord: s.setChord });

  const whatIfActive = s.whatIf.ratesBp !== 0 || s.whatIf.fxPct !== 0 || s.whatIf.volBp !== 0;
  const view = VIEWS.find((v) => v.id === s.view)!;

  return (
    <div className={`app ${s.inspectorOpen && s.view !== "pricing" ? "with-inspector" : ""}`}>
      <nav className="rail" aria-label="Hauptnavigation">
        <div className="logo" title="DERIVA">
          Δ
        </div>
        {VIEWS.map((v) => (
          <button key={v.id} className={s.view === v.id ? "active" : ""} title={`${v.label} (Alt+${v.hint} oder g ${v.id[0]})`} onClick={() => s.setView(v.id)}>
            <span style={{ fontSize: 18 }}>{v.icon}</span>
            <span className="hint">{v.hint}</span>
          </button>
        ))}
        <div className="spacer" />
        <button title="Tastenkürzel (?)" onClick={() => s.setHelp(true)}>
          <span style={{ fontSize: 16 }}>?</span>
        </button>
        <button title="Theme (t)" onClick={s.toggleTheme}>
          <span style={{ fontSize: 15 }}>{s.theme === "dark" ? "☾" : "☀"}</span>
        </button>
      </nav>

      <header className="topbar">
        <span className="title">DERIVA</span>
        <span className="crumb">/ {view.label}</span>
        <div className="grow" />
        <button className="cmd-button" onClick={() => s.setPalette(true)}>
          <span>Befehl oder Schnelleingabe … (z.B. „irs 10y pay 3.1% 10m")</span>
          <span className="row" style={{ gap: 4 }}>
            {keyTokens("mod+k")[0]!.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        </button>
        <span className={`chip ${whatIfActive ? "warn" : ""}`} title="Marktdaten-Snapshot">
          <span className="dot" /> {s.baseMarket.meta?.label ?? "Markt"} · {fmtDate(s.valuationDate)}
          {whatIfActive && ` · What-if ${s.whatIf.ratesBp >= 0 ? "+" : ""}${s.whatIf.ratesBp}bp / FX ${s.whatIf.fxPct}%`}
        </span>
        <button className="chip" onClick={s.cycleReportingCurrency} title="Reporting-Währung (c)">
          {s.reportingCurrency}
        </button>
      </header>

      <main className="main">
        {s.view === "blotter" && <Blotter />}
        {s.view === "pricing" && <PricingWorkspace />}
        {s.view === "curves" && <CurvesView />}
        {s.view === "scenarios" && <ScenariosView />}
        {s.view === "market" && <MarketView />}
        {s.view === "report" && <ReportView />}
      </main>

      {s.inspectorOpen && s.view !== "pricing" && (
        <aside className="inspector">
          <Inspector />
        </aside>
      )}

      <footer className="statusbar">
        <span>
          {s.trades.length} Trades · Bewertung {s.lastPricingMs.toFixed(1)} ms
        </span>
        <span>Bewertungstag {toISO(s.valuationDate)}</span>
        {s.chordPrefix && (
          <span className="chord-indicator">
            {s.chordPrefix} … <span className="muted">(zweite Taste)</span>
          </span>
        )}
        <div className="grow" />
        <span className="row" style={{ gap: 14 }}>
          {HOTKEYS.filter((h) => ["palette", "help", "go.pricing", "new.irs", "bump.up"].includes(h.id)).map((h) => (
            <span key={h.id} className="row" style={{ gap: 4 }}>
              {keyTokens(h.keys).map((combo, i) => (
                <span key={i} className="row" style={{ gap: 2 }}>
                  {combo.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              ))}
              <span>{h.label}</span>
            </span>
          ))}
        </span>
      </footer>

      {s.paletteOpen && <CommandPalette />}
      {s.helpOpen && <HotkeyOverlay />}
      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  );
}
