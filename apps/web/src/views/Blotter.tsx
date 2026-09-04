import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { emirCsv, emirValuationRecord, toISO, type Trade } from "@deriva/pricing-core";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu.js";
import { EChart, negColor, posColor } from "../components/EChart.js";
import { Term } from "../components/InfoTip.js";
import { Modal } from "../components/Modal.js";
import { navRowProps, useTableNav } from "../hooks/useTableNav.js";
import { keysOf } from "../hotkeys/keymap.js";
import {
  BLOTTER_COLUMNS,
  GROUP_OPTIONS,
  type BlotterColKey,
  type BlotterRow,
  type GroupKey,
  blotterCsv,
  buildBlotterRows,
  groupBlotterRows,
  readBlotterColumns,
  writeBlotterColumns,
} from "../lib/blotter-export.js";
import { fmtCompact, fmtDate, fmtMoney, signClass } from "../lib/format.js";
import { translateCoreMessage, translatePricingError } from "../lib/i18n.js";
import { downloadPortfolioReport } from "../lib/portfolio-export.js";
import { CSV_IMPORT_TEMPLATES, type CsvTradeType, csvTemplateText, downloadText, tradesFromCsv, tradesFromJson, tradesToJson } from "../lib/portfolio-io.js";
import { quoteExpired, tradeTypeBadge } from "../lib/trade-ops.js";
import { type DuplicateStrategy, LS_KEYS, STATUS_LABELS, deleteWithUndo, readLocal, useStore, writeLocal, type TradeStatus } from "../state/store.js";

type SortKey = "id" | "type" | "notional" | "maturity" | "pv" | "dv01" | "cpty" | "book" | "status";
const SORT_KEYS: SortKey[] = ["id", "type", "notional", "maturity", "pv", "dv01", "cpty", "book", "status"];

export const ONBOARDING_EXAMPLES = ["irs 10y pay 3.1% 10m", "cap 5y 3% 8m", "fxf eurusd -2m 1.1725 2027-03-15"];

/** Status badge; a firm quote past its validity date carries an extra "abgelaufen" badge. */
export function StatusBadge({ status, expired }: { status: Trade["status"]; expired?: boolean }) {
  const st: TradeStatus = status ?? "Indication";
  return (
    <>
      <span className={`badge st-${st.toLowerCase()}`}>{STATUS_LABELS[st]}</span>
      {expired && (
        <span className="badge warn" title="Angebot vor dem Bewertungstag abgelaufen" data-testid="quote-expired">
          abgelaufen
        </span>
      )}
    </>
  );
}

/** First-launch hint card (dismissible, remembered in localStorage). */
function OnboardingCard() {
  const [dismissed, setDismissed] = useState(() => readLocal(LS_KEYS.onboarded) === "1");
  if (dismissed) return null;
  const dismiss = () => {
    writeLocal(LS_KEYS.onboarded, "1");
    setDismissed(true);
  };
  return (
    <div className="card onboarding" data-testid="onboarding">
      <h3>
        Willkommen bei DERIVA
        <span className="right">
          <button className="btn ghost" onClick={dismiss} title="Hinweis ausblenden" aria-label="Onboarding-Hinweis ausblenden">
            ✕ Ausblenden
          </button>
        </span>
      </h3>
      <div className="row wrap" style={{ gap: 14 }}>
        <div>
          <kbd>⌘/Ctrl</kbd>+<kbd>K</kbd> öffnet die Schnelleingabe (<code className="mono">irs 10y pay 3.1% 10m</code>), <kbd>g</kbd> <kbd>p</kbd> öffnet das
          Pricing, <kbd>?</kbd> zeigt alle Tastenkürzel.
        </div>
        <div className="row examples" style={{ gap: 6 }}>
          {ONBOARDING_EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => useStore.getState().setPalette(true, ex)} title="Palette mit diesem Beispiel öffnen">
              ⚡ {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Empty portfolio: call to action. */
function EmptyPortfolio() {
  const act = useStore.getState;
  return (
    <div className="card empty-state" data-testid="blotter-empty">
      <div className="icon">▤</div>
      <div className="title">Noch keine Trades</div>
      <div className="muted small">
        <kbd>n</kbd> <kbd>s</kbd> legt einen Swap an · <kbd>Ctrl</kbd>+<kbd>K</kbd> öffnet die Schnelleingabe · oder laden Sie das Beispielportfolio.
      </div>
      <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
        <button className="btn primary" onClick={() => act().setPalette(true)}>
          Schnelleingabe öffnen
        </button>
        <button
          className="btn"
          onClick={() => {
            act().resetPortfolio();
            act().showToast("Beispielportfolio geladen");
          }}
        >
          Beispielportfolio laden
        </button>
      </div>
    </div>
  );
}

const TYPE_FILTERS = [
  { id: "all", label: "Alle" },
  { id: "ir", label: "Zins" },
  { id: "fx", label: "FX" },
  { id: "opt", label: "Optionen" },
] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number]["id"];

interface BlotterPrefs {
  sort: { key: SortKey; dir: 1 | -1 };
  filter: TypeFilter;
  hideIndications: boolean;
  noCpty: boolean;
  /** Only trades without a UTI (EMIR reporting gap). */
  noUti: boolean;
  group: GroupKey;
}
const DEFAULT_PREFS: BlotterPrefs = { sort: { key: "id", dir: 1 }, filter: "all", hideIndications: false, noCpty: false, noUti: false, group: "none" };

/** Sort / filter / grouping are persisted (N-24). */
function readPrefs(): BlotterPrefs {
  try {
    const raw = readLocal(LS_KEYS.blotterSort);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<BlotterPrefs>;
    const sort = p.sort && SORT_KEYS.includes(p.sort.key) && (p.sort.dir === 1 || p.sort.dir === -1) ? p.sort : DEFAULT_PREFS.sort;
    const filter = TYPE_FILTERS.some((f) => f.id === p.filter) ? (p.filter as TypeFilter) : "all";
    const group = GROUP_OPTIONS.some((g) => g.key === p.group) ? (p.group as GroupKey) : "none";
    return { sort, filter, hideIndications: !!p.hideIndications, noCpty: !!p.noCpty, noUti: !!p.noUti, group };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Duplicate-id decision for imports (N-24). */
function ImportStrategyDialog({ count, onPick, onClose }: { count: number; onPick: (s: DuplicateStrategy) => void; onClose: () => void }) {
  return (
    <Modal title="Import: vorhandene Trade-IDs" onClose={onClose} width={520} testId="import-strategy">
      <p className="small" style={{ marginTop: 0 }}>
        {count} {count === 1 ? "Trade der Datei ist" : "Trades der Datei sind"} bereits im Bestand (gleiche ID). Wie soll importiert werden?
      </p>
      <div className="stack" style={{ gap: 8 }}>
        <button className="btn" onClick={() => onPick("skip")} data-testid="import-skip">
          <b>Überspringen</b> – vorhandene Trades unverändert lassen, nur neue IDs übernehmen
        </button>
        <button className="btn" onClick={() => onPick("replace")} data-testid="import-replace">
          <b>Ersetzen</b> – vorhandene Trades durch die Datei-Version ersetzen (Rückgängig möglich)
        </button>
        <button className="btn" onClick={() => onPick("rename")} data-testid="import-rename">
          <b>Umbenennen</b> – Datei-Trades als Kopie mit Suffix „-IMP“ anlegen
        </button>
      </div>
    </Modal>
  );
}

export function Blotter() {
  const s = useStore(
    useShallow((st) => ({
      trades: st.trades,
      results: st.results,
      market: st.market,
      reportingCurrency: st.reportingCurrency,
      customerMode: st.customerMode,
      selectedId: st.selectedId,
      compareIds: st.compareIds,
      valuationDate: st.valuationDate,
      reportInputs: st.reportInputs,
    })),
  );
  const act = useStore.getState;
  const customer = s.customerMode;
  const [prefs, setPrefs] = useState<BlotterPrefs>(() => readPrefs());
  const { sort, filter, hideIndications, noCpty, noUti, group } = prefs;
  const updPrefs = (patch: Partial<BlotterPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writeLocal(LS_KEYS.blotterSort, JSON.stringify(next));
      return next;
    });
  const [q, setQ] = useState("");
  const [cols, setCols] = useState<BlotterColKey[]>(() => readBlotterColumns());
  const [colsOpen, setColsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [pendingImport, setPendingImport] = useState<{ trades: Trade[]; duplicates: number; source: string } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const exportRef = useRef<HTMLSpanElement>(null);

  const rows = useMemo(() => buildBlotterRows(s.trades, s.results, s.market, s.reportingCurrency), [s.trades, s.results, s.market, s.reportingCurrency]);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => {
          if (filter === "ir") return ["InterestRateSwap", "FRA", "CrossCurrencySwap"].includes(r.t.type);
          if (filter === "fx") return ["FxForward", "FxSwap", "FxOption"].includes(r.t.type);
          if (filter === "opt") return ["CapFloor", "Swaption", "FxOption"].includes(r.t.type);
          return true;
        })
        .filter((r) => !hideIndications || (r.t.status ?? "Indication") !== "Indication")
        .filter((r) => !noCpty || !r.t.counterparty?.trim())
        .filter((r) => !noUti || !r.t.uti?.trim())
        .filter(
          (r) =>
            !q ||
            `${r.t.id} ${r.t.name ?? ""} ${customer ? "" : `${r.t.counterparty ?? ""} ${r.t.book ?? ""} ${r.t.uti ?? ""}`}`
              .toLowerCase()
              .includes(q.toLowerCase()),
        )
        .sort((a, b) => {
          const va = sortVal(a, sort.key);
          const vb = sortVal(b, sort.key);
          return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        }),
    [rows, filter, hideIndications, noCpty, noUti, q, sort, customer],
  );
  const groups = useMemo(() => groupBlotterRows(filtered, customer && group !== "type" ? "none" : group), [filtered, group, customer]);
  const orderedRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  // j/k follow the visible order (F-09)
  useEffect(() => {
    act().setVisibleIds(orderedRows.map((r) => r.t.id));
    return () => act().setVisibleIds([]);
  }, [orderedRows, act]);
  useEffect(() => {
    tableRef.current?.querySelector<HTMLElement>("tr.selected")?.scrollIntoView?.({ block: "nearest" });
  }, [s.selectedId]);
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  const totalPv = rows.reduce((x, r) => x + (r.pv ?? 0), 0);
  const totalDv01 = rows.reduce((x, r) => x + (r.dv01 ?? 0), 0);
  const byCpty = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.t.counterparty?.trim() || "ohne Kontrahent";
      m.set(k, (m.get(k) ?? 0) + (r.pv ?? 0));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const l = tradeTypeBadge(r.t.type).label;
      m.set(l, (m.get(l) ?? 0) + (r.pv ?? 0));
    }
    return [...m.entries()];
  }, [rows]);
  const byStatus = useMemo(() => {
    const m = new Map<TradeStatus, number>();
    for (const r of rows) {
      const st = r.t.status ?? "Indication";
      m.set(st, (m.get(st) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [rows]);
  const withoutCpty = rows.filter((r) => !r.t.counterparty?.trim()).length;
  const withoutUti = rows.filter((r) => !r.t.uti?.trim()).length;
  const expiredQuotes = rows.filter((r) => quoteExpired(r.t, s.valuationDate)).length;
  const warnCount = rows.filter((r) => r.warnings.length > 0 || r.error).length;
  const errorCount = rows.filter((r) => r.error).length;

  const toggleSort = (key: SortKey) => updPrefs({ sort: sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 } });
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const show = (k: BlotterColKey) => cols.includes(k) && !(customer && BLOTTER_COLUMNS.find((c) => c.key === k)?.internal);
  const toggleCol = (k: BlotterColKey) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : BLOTTER_COLUMNS.map((c) => c.key).filter((c) => c === k || cols.includes(c));
    if (!next.includes("id")) next.unshift("id");
    setCols(next);
    writeBlotterColumns(next);
  };
  const visibleColCount = 1 + BLOTTER_COLUMNS.filter((c) => show(c.key)).length;

  const exportBlotter = () => {
    downloadText(`blotter-${toISO(s.valuationDate)}.csv`, blotterCsv(orderedRows, cols, s.reportingCurrency, { customer }), "text/csv;charset=utf-8");
    act().showToast(`Blotter als CSV exportiert (${orderedRows.length} Trades, ${BLOTTER_COLUMNS.filter((c) => show(c.key)).length} Spalten)`);
  };
  const exportPortfolioJson = () => {
    downloadText(`portfolio-${toISO(s.valuationDate)}.json`, tradesToJson(s.trades), "application/json");
    act().showToast(`Portfolio als JSON exportiert (${s.trades.length} Trades)`);
  };
  /** EMIR Refit valuation export: UTI / clearing fields come from the trade, the transaction price (→ MTMA) from the report inputs when set. */
  const exportEmir = () => {
    const records = s.trades
      .map((t) => {
        const r = s.results[t.id]?.result;
        if (!r || s.results[t.id]?.error) return null;
        const ri = s.reportInputs[t.id];
        return emirValuationRecord(s.market, t, r, ri && Number.isFinite(ri.offerPv) ? { transactionPrice: ri.offerPv } : undefined);
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const missingUti = records.filter((r) => !r.uti).length;
    downloadText(`emir-valuations-${toISO(s.valuationDate)}.csv`, emirCsv(records), "text/csv;charset=utf-8");
    act().showToast(
      `EMIR-Bewertungen exportiert (${records.length}${errorCount ? `, ${errorCount} fehlerhafte Trades ausgelassen` : ""}${missingUti ? `, ${missingUti} ohne UTI` : ""})`,
    );
  };
  /** Import with duplicate handling: ask when ids collide, otherwise import directly. */
  const stageImport = (trades: Trade[], source: string) => {
    const ids = new Set(act().trades.map((t) => t.id));
    const duplicates = trades.filter((t) => ids.has(t.id)).length;
    if (duplicates > 0) setPendingImport({ trades, duplicates, source });
    else runImport(trades, "rename", source);
  };
  const runImport = (trades: Trade[], onDuplicate: DuplicateStrategy, source: string) => {
    const r = act().importTrades(trades, { onDuplicate });
    const extra = [
      r.renamed ? `${r.renamed} umbenannt` : "",
      r.replaced ? `${r.replaced} ersetzt` : "",
      r.skipped ? `${r.skipped} übersprungen` : "",
      r.invalid ? `${r.invalid} ungültig` : "",
    ]
      .filter(Boolean)
      .join(", ");
    act().showToast(`${r.added} Trades aus ${source} importiert${extra ? ` (${extra})` : ""}`, {
      action: r.added ? { label: "Rückgängig", run: () => act().undo() } : undefined,
    });
    setPendingImport(null);
  };
  const importJson = async (file: File) => {
    try {
      stageImport(tradesFromJson(await file.text()), "JSON");
    } catch (e) {
      act().showToast(`Import fehlgeschlagen: ${translatePricingError(e)}`);
    }
  };
  const importCsv = async (file: File) => {
    try {
      const res = tradesFromCsv(await file.text(), { valuationDate: s.valuationDate });
      if (res.errors.length)
        act().showToast(`CSV: ${res.errors.length} Zeile(n) übersprungen – z. B. Zeile ${res.errors[0]!.row}: ${res.errors[0]!.msg}`, { ms: 8000 });
      if (res.trades.length) stageImport(res.trades, "CSV");
      else if (!res.errors.length) act().showToast("CSV enthält keine Trades");
    } catch (e) {
      act().showToast(`CSV-Import fehlgeschlagen: ${translatePricingError(e)}`);
    }
  };
  const resetFilters = () => {
    updPrefs({ filter: "all", hideIndications: false, noCpty: false, noUti: false, group: "none" });
    setQ("");
  };
  const openTrade = (id: string) => {
    act().select(id);
    act().setView("pricing");
  };
  const nav = useTableNav({
    onEnter: (i) => {
      const id = orderedRows[i]?.t.id;
      if (id) openTrade(id);
    },
    onFocusRow: (i) => {
      const id = orderedRows[i]?.t.id;
      if (id) act().select(id);
    },
    onCopied: () => act().showToast("Zeile kopiert"),
  });
  const contextMenu = (e: React.MouseEvent, t: Trade) => {
    e.preventDefault();
    act().select(t.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Öffnen (Pricing)", keys: keysOf("open"), run: () => openTrade(t.id) },
        { label: "Report", keys: keysOf("go.report"), run: () => act().setView("report") },
        {
          label: "Termsheet",
          keys: keysOf("doc.termsheet"),
          run: () => {
            act().setDoc("Termsheet");
            act().setView("report");
          },
        },
        { label: "Szenarien (nur dieser Trade)", run: () => act().setView("scenarios") },
        { label: "Hedge Accounting", keys: keysOf("go.hedge"), run: () => act().setView("hedge") },
        {
          label: s.compareIds.includes(t.id) ? "Aus Vergleich entfernen" : "Für Vergleich markieren",
          keys: keysOf("compare.toggle"),
          run: () => act().toggleCompare(t.id),
        },
        {
          label: "Duplizieren",
          keys: keysOf("duplicate"),
          run: () => {
            const c = act().duplicateSelected();
            if (c) act().showToast(`Dupliziert: ${c.id}`);
          },
        },
        { label: "Löschen", keys: keysOf("delete"), danger: true, run: () => deleteWithUndo(t.id) },
      ],
    });
  };

  if (s.trades.length === 0) {
    return (
      <div className="stack">
        <OnboardingCard />
        <EmptyPortfolio />
      </div>
    );
  }

  const renderRow = (r: BlotterRow) => {
    const b = tradeTypeBadge(r.t.type);
    const inCompare = s.compareIds.includes(r.t.id);
    const selected = r.t.id === s.selectedId;
    return (
      <tr
        key={r.t.id}
        className={selected ? "selected" : ""}
        {...navRowProps(selected, { trade: true })}
        aria-current={selected ? "true" : undefined}
        onClick={() => act().select(r.t.id)}
        onDoubleClick={() => openTrade(r.t.id)}
        onContextMenu={(e) => contextMenu(e, r.t)}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="compare-check"
            aria-label={`${r.t.id} vergleichen`}
            checked={inCompare}
            onChange={() => act().toggleCompare(r.t.id)}
          />
        </td>
        {show("id") && (
          <td className="mono ellipsis id-cell" title={r.t.id}>
            {r.t.id}
          </td>
        )}
        {show("type") && (
          <td>
            <span className={`badge ${b.cls}`}>{b.label}</span>
          </td>
        )}
        {show("name") && (
          <td className="ellipsis name-cell" title={r.t.name ?? ""}>
            {r.t.name ?? "–"}
          </td>
        )}
        {show("cpty") && <td className={r.t.counterparty ? "muted" : "muted xs"}>{r.t.counterparty || "(offen)"}</td>}
        {show("book") && <td className="muted">{r.t.book || "–"}</td>}
        {show("notional") && (
          <td className="num">
            {fmtMoney(r.notional)} <span className="muted">{r.ccy}</span>
          </td>
        )}
        {show("maturity") && <td className="mono">{fmtDate(r.maturity)}</td>}
        {show("pv") && <td className={`num ${signClass(r.pv)}`}>{r.error ? <span className="muted">–</span> : fmtMoney(r.pv)}</td>}
        {show("dv01") && <td className={`num ${signClass(r.dv01)}`}>{fmtMoney(r.dv01)}</td>}
        {show("status") && (
          <td>
            <StatusBadge status={r.t.status} expired={quoteExpired(r.t, s.valuationDate)} />
          </td>
        )}
        {show("valuation") && (
          <td className="val-cell" onClick={(e) => e.stopPropagation()}>
            {r.error ? (
              <button
                className="badge neg as-btn"
                onClick={() => setWarnOpen(warnOpen === r.t.id ? null : r.t.id)}
                aria-expanded={warnOpen === r.t.id}
                title={translateCoreMessage(r.error)}
                data-testid="valuation-error"
              >
                Fehler
              </button>
            ) : r.warnings.length && !customer ? (
              <button
                className="badge warn as-btn"
                onClick={() => setWarnOpen(warnOpen === r.t.id ? null : r.t.id)}
                aria-expanded={warnOpen === r.t.id}
                title={r.warnings.map(translateCoreMessage).join("\n")}
              >
                ⚠ {r.warnings.length}
              </button>
            ) : (
              <span className="badge ok">OK</span>
            )}
            {warnOpen === r.t.id && (r.error || r.warnings.length > 0) && (
              <div className="popover warnings" role="dialog" aria-label="Bewertungshinweise" onKeyDown={(e) => e.key === "Escape" && setWarnOpen(null)}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b className="small">{r.t.id}</b>
                  <button className="btn ghost xs" onClick={() => setWarnOpen(null)} aria-label="Schließen">
                    ✕
                  </button>
                </div>
                <ul className="small">
                  {r.error && <li className="neg">{translateCoreMessage(r.error)}</li>}
                  {r.warnings.map((w) => (
                    <li key={w}>{translateCoreMessage(w)}</li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        )}
      </tr>
    );
  };
  const subtotalRow = (g: { key: string; label: string; rows: BlotterRow[]; pv: number; dv01: number }) => (
    <tr key={`sub-${g.key}`} className="subtotal" data-testid="group-subtotal">
      <td colSpan={Math.max(1, visibleColCount - (show("pv") ? 1 : 0) - (show("dv01") ? 1 : 0) - (show("status") ? 1 : 0) - (show("valuation") ? 1 : 0))}>
        Σ {g.label} ({g.rows.length})
      </td>
      {show("pv") && <td className={`num ${signClass(g.pv)}`}>{fmtMoney(g.pv)}</td>}
      {show("dv01") && <td className={`num ${signClass(g.dv01)}`}>{fmtMoney(g.dv01)}</td>}
      {(show("status") || show("valuation")) && <td colSpan={(show("status") ? 1 : 0) + (show("valuation") ? 1 : 0)} />}
    </tr>
  );

  return (
    <div className="stack">
      <OnboardingCard />
      <div className={`grid kpis ${customer ? "cols-3" : "cols-4"}`}>
        <div className="card kpi big">
          <span className="label">
            <Term id="pv">Portfolio-Barwert ({s.reportingCurrency})</Term>
          </span>
          <span className={`value ${signClass(totalPv)}`}>{fmtMoney(totalPv)}</span>
          <span className="sub">
            {rows.length} Trades{!customer && ` · ${byCpty.length} Kontrahenten`}
            {warnCount > 0 && !customer && ` · ${warnCount} mit Hinweisen`}
            {errorCount > 0 && ` · ${errorCount} nicht bewertet`}
            {expiredQuotes > 0 && ` · ${expiredQuotes} Angebot${expiredQuotes === 1 ? "" : "e"} abgelaufen`}
          </span>
        </div>
        {!customer && (
          <div className="card kpi big">
            <span className="label">
              <Term id="dv01">DV01 Portfolio</Term>
            </span>
            <span className={`value ${signClass(totalDv01)}`}>{fmtMoney(totalDv01)}</span>
            <span className="sub">PV-Änderung bei +1 bp parallel</span>
          </div>
        )}
        {customer ? (
          <div className="card">
            <h3>Status</h3>
            {byStatus.map(([st, n]) => (
              <div key={st} className="row small" style={{ justifyContent: "space-between" }}>
                <StatusBadge status={st} />
                <span className="num">{n}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <h3>PV je Kontrahent</h3>
            {byCpty.slice(0, 4).map(([c, v]) => (
              <div key={c} className="row small" style={{ justifyContent: "space-between" }}>
                <button className="link" onClick={() => (c === "ohne Kontrahent" ? updPrefs({ noCpty: true }) : setQ(c))} title="Im Blotter filtern">
                  {c}
                </button>
                <span className={`num ${signClass(v)}`}>{fmtCompact(v)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="card chart-card">
          <h3>PV je Typ</h3>
          <EChart
            className="chart mini"
            ariaLabel="Barwert je Instrumenttyp"
            option={{
              grid: { left: 48, right: 28, top: 6, bottom: 22 },
              xAxis: { type: "value", splitNumber: 2, axisLabel: { formatter: (v: number) => fmtCompact(v), hideOverlap: true } },
              yAxis: { type: "category", data: byType.map((x) => x[0]) },
              tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number, s.reportingCurrency) },
              series: [
                {
                  type: "bar",
                  data: byType.map((x) => ({ value: Math.round(x[1]), itemStyle: { color: x[1] >= 0 ? posColor() : negColor() } })),
                  barWidth: 10,
                },
              ],
            }}
          />
        </div>
      </div>

      <div className="card">
        <h3>
          Blotter
          <span className="right row wrap toolbar">
            <div className="seg" role="group" aria-label="Typfilter">
              {TYPE_FILTERS.map((f) => (
                <button key={f.id} className={filter === f.id ? "active" : ""} aria-pressed={filter === f.id} onClick={() => updPrefs({ filter: f.id })}>
                  {f.label}
                </button>
              ))}
            </div>
            <button
              className={`chip ${hideIndications ? "active" : ""}`}
              onClick={() => updPrefs({ hideIndications: !hideIndications })}
              aria-pressed={hideIndications}
              title="Nur gebuchte Trades anzeigen"
            >
              {hideIndications ? "✓ " : ""}Indikationen ausblenden
            </button>
            {!customer && withoutCpty > 0 && (
              <button
                className={`chip ${noCpty ? "active" : ""}`}
                onClick={() => updPrefs({ noCpty: !noCpty })}
                aria-pressed={noCpty}
                title="Trades ohne Kontrahent"
              >
                {noCpty ? "✓ " : ""}ohne Kontrahent ({withoutCpty})
              </button>
            )}
            {!customer && withoutUti > 0 && (
              <button
                className={`chip ${noUti ? "active" : ""}`}
                onClick={() => updPrefs({ noUti: !noUti })}
                aria-pressed={noUti}
                title="Trades ohne UTI (EMIR-Meldelücke)"
                data-testid="filter-no-uti"
              >
                {noUti ? "✓ " : ""}ohne UTI ({withoutUti})
              </button>
            )}
            <label className="row" style={{ gap: 4 }}>
              <span className="muted xs">Gruppieren</span>
              <select
                className="inline"
                value={group}
                aria-label="Gruppieren nach"
                data-testid="group-select"
                onChange={(e) => updPrefs({ group: e.target.value as GroupKey })}
              >
                {GROUP_OPTIONS.filter((g) => !(customer && (g.key === "cpty" || g.key === "book"))).map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="mono inline search"
              placeholder={customer ? "Suche (ID, Name)" : "Suche (ID, Name, Kontrahent, Buch)"}
              aria-label="Blotter durchsuchen"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="col-chooser">
              <button className="btn ghost" onClick={() => setColsOpen((v) => !v)} aria-expanded={colsOpen} aria-haspopup="true" title="Spalten wählen">
                ▦ Spalten
              </button>
              {colsOpen && (
                <div className="popover cols" role="group" aria-label="Spaltenauswahl" onKeyDown={(e) => e.key === "Escape" && setColsOpen(false)}>
                  {BLOTTER_COLUMNS.filter((c) => !(customer && c.internal)).map((c) => (
                    <label key={c.key} className="check">
                      <input type="checkbox" checked={cols.includes(c.key)} disabled={c.key === "id"} onChange={() => toggleCol(c.key)} /> {c.label}
                    </label>
                  ))}
                  <button className="btn ghost xs" onClick={() => setColsOpen(false)}>
                    Schließen
                  </button>
                </div>
              )}
            </span>
            <span className="anchor" ref={exportRef}>
              <button
                className="btn ghost"
                onClick={() => setExportOpen((v) => !v)}
                aria-expanded={exportOpen}
                aria-haspopup="menu"
                title="Export und Import"
                data-testid="export-menu-btn"
              >
                ⤓ Export ▾
              </button>
              {exportOpen && (
                <div className="popover export-menu" role="menu" aria-label="Export und Import" onKeyDown={(e) => e.key === "Escape" && setExportOpen(false)}>
                  <button
                    role="menuitem"
                    className="item"
                    onClick={() => {
                      exportBlotter();
                      setExportOpen(false);
                    }}
                    title={`Blotter mit sichtbaren Spalten als CSV (${keysOf("export.blotter")})`}
                  >
                    ⤓ Blotter als CSV
                  </button>
                  <button
                    role="menuitem"
                    className="item"
                    onClick={() => {
                      exportPortfolioJson();
                      setExportOpen(false);
                    }}
                    title="Alle Trades als JSON (ISO-Datumsformat) – wieder importierbar"
                  >
                    ⤓ Portfolio als JSON
                  </button>
                  {!customer && (
                    <button
                      role="menuitem"
                      className="item"
                      onClick={() => {
                        exportEmir();
                        setExportOpen(false);
                      }}
                      title="EMIR-Refit-Bewertungsfelder (UTI, Valuation amount/currency/timestamp/method, Clearing) als CSV – Transaktionspreis aus den Report-Eingaben"
                    >
                      ⤓ EMIR-Bewertungen (CSV)
                    </button>
                  )}
                  <div className="sep" role="separator" />
                  <button
                    role="menuitem"
                    className="item"
                    data-testid="export-portfolio-json"
                    onClick={() => {
                      downloadPortfolioReport("json");
                      setExportOpen(false);
                    }}
                    title={`Portfolio-Report: PV/DV01 je Kontrahent, Buch und Typ mit Snapshot-ID und Hashes (${keysOf("export.portfolio")})`}
                  >
                    ⤓ Portfolio-Report (JSON)
                  </button>
                  <button
                    role="menuitem"
                    className="item"
                    data-testid="export-portfolio-md"
                    onClick={() => {
                      downloadPortfolioReport("md");
                      setExportOpen(false);
                    }}
                    title="Portfolio-Report als Markdown (druckbar)"
                  >
                    ⤓ Portfolio-Report (Markdown)
                  </button>
                  <div className="sep" role="separator" />
                  <label
                    role="menuitem"
                    className="item"
                    style={{ cursor: "pointer" }}
                    title="Portfolio-JSON importieren (Trades werden validiert und bewertet)"
                  >
                    ⤒ JSON importieren
                    <input
                      type="file"
                      accept="application/json,.json"
                      style={{ display: "none" }}
                      data-testid="import-json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        setExportOpen(false);
                        if (file) await importJson(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <label
                    role="menuitem"
                    className="item"
                    style={{ cursor: "pointer" }}
                    title="CSV mit Spalte „Typ“ (IRS / FXF / CAP) importieren – Spaltennamen deutsch oder englisch"
                  >
                    ⤒ CSV importieren
                    <input
                      type="file"
                      accept="text/csv,.csv,.txt"
                      style={{ display: "none" }}
                      data-testid="import-csv"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        setExportOpen(false);
                        if (file) await importCsv(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <div className="sep" role="separator" />
                  <div className="muted xs" style={{ padding: "4px 10px" }}>
                    CSV-Vorlagen
                  </div>
                  {(Object.keys(CSV_IMPORT_TEMPLATES) as CsvTradeType[]).map((k) => (
                    <button
                      key={k}
                      role="menuitem"
                      className="item xs"
                      onClick={() => {
                        downloadText(`deriva-import-vorlage-${k.toLowerCase()}.csv`, csvTemplateText(k), "text/csv;charset=utf-8");
                        setExportOpen(false);
                      }}
                    >
                      ⤓ Vorlage {CSV_IMPORT_TEMPLATES[k].label}
                    </button>
                  ))}
                </div>
              )}
            </span>
          </span>
        </h3>
        <div className="muted xs hint-row">
          <kbd>j</kbd>/<kbd>k</kbd> navigieren · <kbd>↵</kbd>/Doppelklick öffnen · <kbd>Space</kbd> vergleichen · <kbd>d</kbd> duplizieren · <kbd>⇧D</kbd>{" "}
          löschen · Rechtsklick für Menü · <kbd>y</kbd> Zeile kopieren
        </div>
        <div className="table-scroll">
          <table className="grid-table blotter" ref={tableRef} role="grid" aria-label="Blotter" aria-rowcount={orderedRows.length}>
            <thead>
              <tr>
                <th title="Für Vergleich markieren (Space)" style={{ width: 28 }} aria-label="Vergleich">
                  ⇆
                </th>
                {BLOTTER_COLUMNS.filter((c) => show(c.key)).map((c) => {
                  const sk = c.key as SortKey;
                  const label = c.key === "pv" ? `PV ${s.reportingCurrency}` : c.label;
                  return c.sortable ? (
                    <th key={c.key} className={c.num ? "num" : ""} aria-sort={ariaSort(sk)}>
                      <button className="th-btn" onClick={() => toggleSort(sk)} title={`Nach ${label} sortieren`}>
                        {label}
                        {arrow(sk)}
                      </button>
                    </th>
                  ) : (
                    <th key={c.key} className={c.num ? "num" : ""}>
                      {label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody onKeyDown={nav.onKeyDown}>
              {orderedRows.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={visibleColCount} className="empty">
                    Keine Treffer{q ? ` für „${q}“` : ""} ·{" "}
                    <button className="btn ghost" onClick={resetFilters}>
                      Filter zurücksetzen
                    </button>
                  </td>
                </tr>
              )}
              {groups.flatMap((g) => [...g.rows.map(renderRow), ...(group !== "none" && groups.length > 0 && g.rows.length > 0 ? [subtotalRow(g)] : [])])}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={Math.max(
                    1,
                    visibleColCount - (show("pv") ? 1 : 0) - (show("dv01") ? 1 : 0) - (show("status") ? 1 : 0) - (show("valuation") ? 1 : 0),
                  )}
                >
                  Summe ({orderedRows.length}){errorCount > 0 && <span className="muted xs"> · ohne {errorCount} fehlerhafte</span>}
                </td>
                {show("pv") && (
                  <td className={`num ${signClass(orderedRows.reduce((x, r) => x + (r.pv ?? 0), 0))}`}>
                    {fmtMoney(orderedRows.reduce((x, r) => x + (r.pv ?? 0), 0))}
                  </td>
                )}
                {show("dv01") && <td className="num">{fmtMoney(orderedRows.reduce((x, r) => x + (r.dv01 ?? 0), 0))}</td>}
                {(show("status") || show("valuation")) && <td colSpan={(show("status") ? 1 : 0) + (show("valuation") ? 1 : 0)} />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {pendingImport && (
        <ImportStrategyDialog
          count={pendingImport.duplicates}
          onPick={(st) => runImport(pendingImport.trades, st, pendingImport.source)}
          onClose={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}

function sortVal(r: { t: Trade; pv?: number; dv01?: number; notional: number; maturity: number }, key: SortKey): string | number {
  switch (key) {
    case "id":
      return r.t.id;
    case "type":
      return r.t.type;
    case "cpty":
      return r.t.counterparty ?? "";
    case "book":
      return r.t.book ?? "";
    case "status":
      return r.t.status ?? "Indication";
    case "notional":
      return r.notional;
    case "maturity":
      return r.maturity;
    case "pv":
      return r.pv ?? -Infinity;
    case "dv01":
      return r.dv01 ?? -Infinity;
  }
}
