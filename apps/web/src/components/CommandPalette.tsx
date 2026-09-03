import { useEffect, useMemo, useRef, useState } from "react";
import { HOTKEYS, keyTokens, type ViewId } from "../hotkeys/keymap.js";
import { QUICK_ENTRY_EXAMPLES, parseQuickEntry } from "../lib/quick-parser.js";
import { newTradeTemplate, type TemplateId } from "../lib/templates.js";
import { tradeTypeBadge } from "../lib/trade-ops.js";
import { useStore } from "../state/store.js";

interface Item {
  id: string;
  group: string;
  label: string;
  desc?: string;
  keys?: string;
  icon?: string;
  run: () => void;
}

function score(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q);
  // subsequence
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
  return qi === q.length ? 10 : 0;
}

export function CommandPalette() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const parsed = useMemo(() => parseQuickEntry(q, s.valuationDate), [q, s.valuationDate]);

  const items = useMemo<Item[]>(() => {
    const close = () => s.setPalette(false);
    const nav: Item[] = (
      [
        ["blotter", "Blotter / Portfolio", "g b"],
        ["pricing", "Pricing-Workspace", "g p"],
        ["curves", "Kurven", "g c"],
        ["scenarios", "Szenarien", "g s"],
        ["market", "Marktdaten", "g m"],
        ["report", "Bewertungsreport", "g r"],
      ] as [ViewId, string, string][]
    ).map(([id, label, keys]) => ({ id: `go.${id}`, group: "Navigation", label, keys, icon: "→", run: () => { s.setView(id); close(); } }));
    const news: Item[] = (
      [
        ["irs", "Neuer Zinsswap", "n s"],
        ["cap", "Neuer Cap / Floor / Collar", "n c"],
        ["swpt", "Neue Swaption", "n w"],
        ["fxf", "Neuer FX-Forward", "n f"],
        ["fxo", "Neue FX-Option", "n o"],
      ] as [TemplateId, string, string][]
    ).map(([id, label, keys]) => ({ id: `new.${id}`, group: "Neu", label, keys, icon: "+", run: () => { s.addTrade(newTradeTemplate(id, s.valuationDate), { goToPricing: true }); close(); } }));
    const actions: Item[] = [
      { id: "theme", group: "Aktionen", label: "Theme umschalten", keys: "t", icon: "◐", run: () => { s.toggleTheme(); close(); } },
      { id: "ccy", group: "Aktionen", label: "Reporting-Währung wechseln", keys: "c", desc: s.reportingCurrency, icon: "¤", run: () => { s.cycleReportingCurrency(); close(); } },
      { id: "reset", group: "Aktionen", label: "What-if zurücksetzen", keys: "\\", icon: "↺", run: () => { s.resetWhatIf(); close(); } },
      { id: "reprice", group: "Aktionen", label: "Portfolio neu bewerten", keys: "r", icon: "ƒ", run: () => { s.repriceAll(); close(); } },
      { id: "help", group: "Aktionen", label: "Alle Tastenkürzel", keys: "?", icon: "?", run: () => { s.setHelp(true); close(); } },
      { id: "inspector", group: "Aktionen", label: "Inspector ein/aus", keys: "i", icon: "◧", run: () => { s.toggleInspector(); close(); } },
    ];
    const trades: Item[] = s.trades.map((t) => ({
      id: `trade.${t.id}`,
      group: "Trades",
      label: `${t.id} · ${t.name ?? ""}`,
      desc: tradeTypeBadge(t.type).label,
      icon: "▸",
      run: () => { s.select(t.id); s.setView("pricing"); close(); },
    }));
    const all = [...nav, ...news, ...actions, ...trades];
    const scored = all.map((it) => ({ it, sc: score(q, `${it.label} ${it.desc ?? ""} ${it.id}`) })).filter((x) => x.sc > 0);
    scored.sort((a, b) => b.sc - a.sc);
    return scored.map((x) => x.it);
  }, [q, s]);

  const quickItem: Item | null = parsed.ok && parsed.trade
    ? {
        id: "quick",
        group: "Schnelleingabe",
        label: `Trade anlegen: ${parsed.description}`,
        icon: "⚡",
        run: () => {
          s.addTrade(parsed.trade!, { goToPricing: true });
          s.showToast(`Angelegt: ${parsed.trade!.id}`);
          s.setPalette(false);
        },
      }
    : null;
  const list = quickItem ? [quickItem, ...items] : items;
  const active = Math.min(idx, Math.max(0, list.length - 1));

  useEffect(() => setIdx(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      list[active]?.run();
    } else if (e.key === "Escape") {
      s.setPalette(false);
    } else if (e.key === "Tab" && !q) {
      e.preventDefault();
      setQ(QUICK_ENTRY_EXAMPLES[Math.floor(Math.random() * QUICK_ENTRY_EXAMPLES.length)]!);
    }
  };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={() => s.setPalette(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command Palette">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Befehl, Trade oder Schnelleingabe (irs 10y pay 3.1% 10m) …" spellCheck={false} />
        {q && !parsed.ok && parsed.error && <div className="preview" style={{ color: "var(--warn)" }}>⚠ {parsed.error}</div>}
        {!q && (
          <div className="preview muted">
            Schnelleingabe-Beispiele: {QUICK_ENTRY_EXAMPLES.slice(0, 4).join("  ·  ")} <span className="xs">(Tab füllt ein Beispiel ein)</span>
          </div>
        )}
        <div className="results">
          {list.length === 0 && <div className="empty">Keine Treffer</div>}
          {list.map((it, i) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {showGroup && <div className="group">{it.group}</div>}
                <div className={`item ${i === active ? "active" : ""}`} onMouseEnter={() => setIdx(i)} onClick={it.run}>
                  <span className="icon">{it.icon}</span>
                  <span className="label">{it.label}</span>
                  {it.desc && <span className="desc">{it.desc}</span>}
                  {it.keys && (
                    <span className="keys">
                      {keyTokens(it.keys).map((combo, ci) => combo.map((k) => <kbd key={`${ci}-${k}`}>{k}</kbd>))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="footer">
          <span>↑↓ navigieren</span>
          <span>↵ ausführen</span>
          <span>Esc schließen</span>
          <span className="grow" />
          <span>{HOTKEYS.length} Tastenkürzel · ? für Übersicht</span>
        </div>
      </div>
    </div>
  );
}
