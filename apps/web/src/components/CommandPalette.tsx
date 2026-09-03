import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { VISIBLE_HOTKEYS, keyList, keyTokens, type HotkeyDef } from "../hotkeys/keymap.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { QUICK_ENTRY_EXAMPLES, parseQuickEntry, parseValuationDateCommand } from "../lib/quick-parser.js";
import { tradeTypeBadge } from "../lib/trade-ops.js";
import { useStore } from "../state/store.js";
import { restoreFocus, useModalRegistration } from "./Modal.js";

interface Item {
  id: string;
  group: string;
  label: string;
  desc?: string;
  keys?: string[];
  icon?: string;
  /** Extra text that is searched but not shown (counterparty, type). */
  search?: string;
  run: (e?: { shiftKey?: boolean }) => void;
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

const ICONS: Record<string, string> = { Navigation: "→", Aktionen: "⚡", Bewertung: "ƒ", Ansicht: "◐", Blotter: "▤" };

/** Items excluded from the palette: it is open already / pure key aliases. */
const EXCLUDED = new Set(["palette", "palette2", "escape", "open", "down", "up"]);

interface Props {
  /** Dispatches a hotkey definition exactly like a key press (parity with the keymap). */
  onHotkey: (def: HotkeyDef) => void;
}

export function CommandPalette({ onHotkey }: Props) {
  const s = useStore(
    useShallow((st) => ({
      paletteInitialQuery: st.paletteInitialQuery,
      valuationDate: st.valuationDate,
      customerMode: st.customerMode,
      reportingCurrency: st.reportingCurrency,
      theme: st.theme,
      undoStack: st.undoStack,
      compareIds: st.compareIds,
      trades: st.trades,
      results: st.results,
    })),
  );
  const act = useStore.getState;
  const [q, setQ] = useState(() => s.paletteInitialQuery ?? "");
  const [idx, setIdx] = useState(0);
  const [exampleIdx, setExampleIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  useModalRegistration();
  useEffect(() => {
    prevFocus.current = document.activeElement;
    inputRef.current?.focus();
    inputRef.current?.select();
    // Focus goes back to the opener after the app shell lost `inert` (N-03).
    return () => restoreFocus(prevFocus.current);
  }, []);

  const parsed = useMemo(() => parseQuickEntry(q, s.valuationDate), [q, s.valuationDate]);
  const valDateCmd = useMemo(() => parseValuationDateCommand(q), [q]);

  const items = useMemo<Item[]>(() => {
    const close = () => act().setPalette(false);
    const hot: Item[] = VISIBLE_HOTKEYS.filter((h) => !EXCLUDED.has(h.id)).map((h) => {
      let label = h.label;
      let desc: string | undefined;
      if (h.id === "customer") {
        label = s.customerMode ? "Kundenmodus beenden" : "Kundenmodus (Kundenansicht)";
        desc = s.customerMode ? "aktiv" : "blendet Kontrahent, DV01, Margen, XVA aus";
      } else if (h.id === "ccy") desc = s.reportingCurrency;
      else if (h.id === "theme") desc = s.theme === "dark" ? "→ Light" : "→ Dark";
      else if (h.id === "undo") desc = s.undoStack.length ? s.undoStack[s.undoStack.length - 1]!.label : "nichts rückgängig zu machen";
      else if (h.id === "valdate") desc = fmtDate(s.valuationDate);
      else if (h.id === "doc.termsheet") desc = "Report wird bei Bedarf erzeugt";
      else if (h.id === "doc.suitability") desc = "§ 64 Abs. 4 WpHG";
      return {
        id: h.id,
        group: h.group,
        label,
        desc,
        keys: keyList(h),
        icon: ICONS[h.group] ?? "·",
        run: () => {
          close();
          onHotkey(h);
        },
      };
    });
    const extra: Item[] = [
      ...(s.compareIds.length > 0
        ? [
            {
              id: "compare.clear",
              group: "Aktionen",
              label: "Vergleichsauswahl leeren",
              desc: `${s.compareIds.length} Trades`,
              icon: "⇆",
              run: () => {
                act().clearCompare();
                close();
              },
            },
          ]
        : []),
      {
        id: "portfolio.reset",
        group: "Aktionen",
        label: "Beispielportfolio laden (Bestand zurücksetzen)",
        desc: "ersetzt alle Trades und Quotes",
        icon: "↺",
        run: () => {
          act().resetPortfolio();
          act().showToast("Beispielportfolio geladen");
          close();
        },
      },
    ];
    const trades: Item[] = s.trades.map((t) => {
      const pv = s.results[t.id]?.result?.pv;
      const badge = tradeTypeBadge(t.type).label;
      return {
        id: `trade.${t.id}`,
        group: "Trades",
        label: `${t.id} · ${t.name ?? ""}`,
        desc: `${badge} · ${s.customerMode ? "" : `${t.counterparty ?? "ohne Kontrahent"} · `}${fmtMoney(pv)} ${s.reportingCurrency}`,
        icon: "▸",
        search: `${t.counterparty ?? ""} ${t.book ?? ""} ${badge} ${t.type}`,
        run: (e) => {
          act().select(t.id);
          act().setView(e?.shiftKey ? "report" : "pricing");
          close();
        },
      };
    });
    const all = [...hot, ...extra, ...trades];
    const scored = all.map((it) => ({ it, sc: score(q, `${it.label} ${it.desc ?? ""} ${it.search ?? ""} ${it.id}`) })).filter((x) => x.sc > 0);
    scored.sort((a, b) => b.sc - a.sc);
    return scored.map((x) => x.it);
  }, [q, s, onHotkey, act]);

  const quickItem: Item | null =
    parsed.ok && parsed.trade
      ? {
          id: "quick",
          group: "Schnelleingabe",
          label: `Trade anlegen: ${parsed.description}`,
          icon: "⚡",
          run: () => {
            const t = act().addTrade(parsed.trade!, { goToPricing: true, autoId: true });
            const pv = useStore.getState().results[t.id]?.result?.pv;
            act().showToast(`Angelegt: ${t.id}${pv !== undefined ? ` · PV ${fmtMoney(pv, s.reportingCurrency)}` : ""}`);
            act().setPalette(false);
          },
        }
      : valDateCmd
        ? {
            id: "valdate.cmd",
            group: "Schnelleingabe",
            label: `Bewertungstag setzen: ${valDateCmd.split("-").reverse().join(".")}`,
            icon: "📅",
            run: () => {
              if (act().setValuationDate(valDateCmd)) act().showToast(`Bewertungstag ${valDateCmd.split("-").reverse().join(".")}`);
              else act().showToast("Ungültiges Datum");
              act().setPalette(false);
            },
          }
        : null;
  const list = quickItem ? [quickItem, ...items] : items;
  const active = Math.min(idx, Math.max(0, list.length - 1));
  /** ↑ keeps rotating through the examples as long as the field holds an untouched example (N-05). */
  const browsingExamples = q === "" || q === QUICK_ENTRY_EXAMPLES[exampleIdx];

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".item.active")?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (browsingExamples && q !== "" && active === 0 && exampleIdx > 0) {
        const prev = exampleIdx - 1;
        setExampleIdx(prev);
        setQ(QUICK_ENTRY_EXAMPLES[prev]!);
      } else setIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (browsingExamples && active === 0) {
        // rotate through the examples while the input holds an example (or is empty)
        const next = (exampleIdx + 1) % QUICK_ENTRY_EXAMPLES.length;
        setExampleIdx(next);
        setQ(QUICK_ENTRY_EXAMPLES[next]!);
      } else setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      list[active]?.run({ shiftKey: e.shiftKey });
    } else if (e.key === "Escape") {
      e.preventDefault();
      act().setPalette(false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Tab completes: empty → first example, otherwise the active item's text.
      if (!q) setQ(QUICK_ENTRY_EXAMPLES[exampleIdx]!);
      else if (list[active] && list[active].id !== "quick" && list[active].id !== "valdate.cmd") setQ(list[active].label.split(" · ")[0]!);
    }
  };

  let lastGroup = "";
  const optId = (i: number) => `pal-opt-${i}`;
  return (
    <div className="palette-backdrop" onMouseDown={() => act().setPalette(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command Palette">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Befehl, Trade oder Schnelleingabe (irs 10y pay 3.1% 10m) …"
          spellCheck={false}
          aria-label="Befehl oder Schnelleingabe"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-autocomplete="list"
          aria-activedescendant={list.length > 0 ? optId(active) : undefined}
        />
        {q && !parsed.ok && parsed.error && (
          <div className="preview warn-text" role="alert">
            ⚠ {parsed.error}
          </div>
        )}
        {!q && (
          <div className="preview examples" aria-label="Schnelleingabe-Beispiele">
            <span className="muted">Beispiele</span>
            {QUICK_ENTRY_EXAMPLES.slice(0, 5).map((ex) => (
              <button key={ex} type="button" className="chip mono" onClick={() => setQ(ex)} title="Beispiel übernehmen">
                {ex}
              </button>
            ))}
            <span className="muted xs">
              <kbd>Tab</kbd> übernimmt · <kbd>↑</kbd> weitere · <kbd>@Name</kbd> setzt den Kontrahenten
            </span>
          </div>
        )}
        <div className="results" id="palette-results" role="listbox" ref={listRef} aria-label="Treffer">
          {list.length === 0 && (
            <div className="empty">
              Keine Treffer für „{q}“ – versuchen Sie eine Schnelleingabe wie <code className="mono">irs 10y pay 3.1% 10m</code>
            </div>
          )}
          {list.map((it, i) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <div key={it.id} role="presentation">
                {showGroup && (
                  <div className="group" role="presentation">
                    {it.group}
                  </div>
                )}
                <div
                  id={optId(i)}
                  className={`item ${i === active ? "active" : ""}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setIdx(i)}
                  onClick={(e) => it.run({ shiftKey: e.shiftKey })}
                >
                  <span className="icon" aria-hidden="true">
                    {it.icon}
                  </span>
                  <span className="label">{it.label}</span>
                  {it.desc && <span className="desc">{it.desc}</span>}
                  {it.keys && (
                    <span className="keys">
                      {it.keys.map((k, ki) => (
                        <span key={k} className="row" style={{ gap: 2 }}>
                          {ki > 0 && <span className="muted xs">/</span>}
                          {keyTokens(k).map((combo, ci) => combo.map((t) => <kbd key={`${ci}-${t}`}>{t}</kbd>))}
                        </span>
                      ))}
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
          <span>⇧↵ Trade im Report</span>
          <span>Tab vervollständigen</span>
          <span>Esc schließen</span>
          <span className="grow" />
          <span>
            {list.length} Treffer · {VISIBLE_HOTKEYS.length} Tastenkürzel · ? für Übersicht
          </span>
        </div>
      </div>
    </div>
  );
}
