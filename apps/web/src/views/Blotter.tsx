import { useMemo, useState } from "react";
import { computeRisk, type Trade } from "@deriva/pricing-core";
import { fmtCompact, fmtDate, fmtMoney, signClass } from "../lib/format.js";
import { tradeMaturity, tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { useStore } from "../state/store.js";
import { EChart, negColor, posColor } from "../components/EChart.js";

type SortKey = "id" | "type" | "notional" | "maturity" | "pv" | "dv01" | "cpty";

export function Blotter() {
  const s = useStore();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const [filter, setFilter] = useState<"all" | "ir" | "fx" | "opt">("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return s.trades.map((t) => {
      const r = s.results[t.id];
      let dv01: number | undefined;
      try {
        dv01 = computeRisk(s.market, t, s.reportingCurrency, { bucketed: false, vega: false, theta: false }).dv01;
      } catch {
        dv01 = undefined;
      }
      const n = tradeNotional(t);
      return { t, pv: r?.result?.pv, dv01, notional: n.amount, ccy: n.currency, maturity: tradeMaturity(t), error: r?.error, warnings: r?.result?.warnings ?? [] };
    });
  }, [s.trades, s.results, s.market, s.reportingCurrency]);

  const filtered = rows
    .filter((r) => {
      if (filter === "ir") return ["InterestRateSwap", "FRA", "CrossCurrencySwap"].includes(r.t.type);
      if (filter === "fx") return ["FxForward", "FxSwap", "FxOption"].includes(r.t.type);
      if (filter === "opt") return ["CapFloor", "Swaption", "FxOption"].includes(r.t.type);
      return true;
    })
    .filter((r) => !q || `${r.t.id} ${r.t.name ?? ""} ${r.t.counterparty ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const va = sortVal(a, sort.key);
      const vb = sortVal(b, sort.key);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });

  const totalPv = rows.reduce((x, r) => x + (r.pv ?? 0), 0);
  const totalDv01 = rows.reduce((x, r) => x + (r.dv01 ?? 0), 0);
  const byCpty = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.t.counterparty ?? "–", (m.get(r.t.counterparty ?? "–") ?? 0) + (r.pv ?? 0));
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

  const toggleSort = (key: SortKey) => setSort((s0) => (s0.key === key ? { key, dir: s0.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="card kpi big">
          <span className="label">Portfolio-Barwert ({s.reportingCurrency})</span>
          <span className={`value ${signClass(totalPv)}`}>{fmtMoney(totalPv)}</span>
          <span className="sub">{rows.length} Trades · {byCpty.length} Kontrahenten</span>
        </div>
        <div className="card kpi big">
          <span className="label">DV01 Portfolio</span>
          <span className={`value ${signClass(totalDv01)}`}>{fmtMoney(totalDv01)}</span>
          <span className="sub">PV-Änderung bei +1bp parallel</span>
        </div>
        <div className="card">
          <h3>PV je Kontrahent</h3>
          {byCpty.slice(0, 4).map(([c, v]) => (
            <div key={c} className="row small" style={{ justifyContent: "space-between" }}>
              <span>{c}</span>
              <span className={`num ${signClass(v)}`}>{fmtCompact(v)}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: 6 }}>
          <EChart
            className="chart"
            option={{
              grid: { left: 60, right: 10, top: 10, bottom: 20 },
              xAxis: { type: "value", splitNumber: 3, axisLabel: { formatter: (v: number) => fmtCompact(v) } },
              yAxis: { type: "category", data: byType.map((x) => x[0]) },
              series: [{ type: "bar", data: byType.map((x) => ({ value: Math.round(x[1]), itemStyle: { color: x[1] >= 0 ? posColor() : negColor() } })), barWidth: 12 }],
            }}
          />
        </div>
      </div>

      <div className="card">
        <h3>
          Blotter
          <span className="right row">
            <div className="seg">
              {(["all", "ir", "fx", "opt"] as const).map((f) => (
                <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? "Alle" : f === "ir" ? "Zins" : f === "fx" ? "FX" : "Optionen"}
                </button>
              ))}
            </div>
            <input className="mono" placeholder="Suche (ID, Name, Kontrahent)" value={q} onChange={(e) => setQ(e.target.value)} style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", width: 220 }} />
            <span className="muted xs">
              <kbd>j</kbd>/<kbd>k</kbd> navigieren · <kbd>↵</kbd> öffnen · <kbd>n</kbd>+… neu
            </span>
          </span>
        </h3>
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("id")}>ID{arrow("id")}</th>
                <th onClick={() => toggleSort("type")}>Typ{arrow("type")}</th>
                <th>Bezeichnung</th>
                <th onClick={() => toggleSort("cpty")}>Kontrahent{arrow("cpty")}</th>
                <th className="num" onClick={() => toggleSort("notional")}>Nominal{arrow("notional")}</th>
                <th onClick={() => toggleSort("maturity")}>Fälligkeit{arrow("maturity")}</th>
                <th className="num" onClick={() => toggleSort("pv")}>PV {s.reportingCurrency}{arrow("pv")}</th>
                <th className="num" onClick={() => toggleSort("dv01")}>DV01{arrow("dv01")}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const b = tradeTypeBadge(r.t.type);
                return (
                  <tr key={r.t.id} className={r.t.id === s.selectedId ? "selected" : ""} onClick={() => s.select(r.t.id)} onDoubleClick={() => { s.select(r.t.id); s.setView("pricing"); }}>
                    <td className="mono">{r.t.id}</td>
                    <td>
                      <span className={`badge ${b.cls}`}>{b.label}</span>
                    </td>
                    <td>{r.t.name ?? "–"}</td>
                    <td className="muted">{r.t.counterparty ?? "–"}</td>
                    <td className="num">
                      {fmtMoney(r.notional)} <span className="muted">{r.ccy}</span>
                    </td>
                    <td className="mono">{fmtDate(r.maturity)}</td>
                    <td className={`num ${signClass(r.pv)}`}>{fmtMoney(r.pv)}</td>
                    <td className={`num ${signClass(r.dv01)}`}>{fmtMoney(r.dv01)}</td>
                    <td>{r.error ? <span className="badge warn">Fehler</span> : r.warnings.length ? <span className="badge warn" title={r.warnings.join("\n")}>⚠ {r.warnings.length}</span> : <span className="badge">OK</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Summe ({filtered.length})</td>
                <td className={`num ${signClass(filtered.reduce((x, r) => x + (r.pv ?? 0), 0))}`}>{fmtMoney(filtered.reduce((x, r) => x + (r.pv ?? 0), 0))}</td>
                <td className="num">{fmtMoney(filtered.reduce((x, r) => x + (r.dv01 ?? 0), 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
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
