import { useMemo, useState } from "react";
import { STANDARD_SCENARIOS, runScenarios, scenarioGrid } from "@deriva/pricing-core";
import { EChart, negColor, posColor } from "../components/EChart.js";
import { fmtCompact, fmtMoney, signClass } from "../lib/format.js";
import { useStore } from "../state/store.js";

const RATES = [-200, -100, -50, -25, 0, 25, 50, 100, 200];
const FX = [-10, -5, -2.5, 0, 2.5, 5, 10];

export function ScenariosView() {
  const s = useStore();
  const [scope, setScope] = useState<"portfolio" | "selected">("portfolio");
  const [fxCcy, setFxCcy] = useState("USD");
  const trades = scope === "portfolio" ? s.trades : s.trades.filter((t) => t.id === s.selectedId);

  const out = useMemo(() => runScenarios(s.market, trades, STANDARD_SCENARIOS, s.reportingCurrency), [s.market, trades, s.reportingCurrency]);
  const grid = useMemo(() => scenarioGrid(s.market, trades, s.reportingCurrency, RATES, FX, fxCcy), [s.market, trades, s.reportingCurrency, fxCcy]);
  const maxAbs = Math.max(1, ...grid.pv.flat().map((v) => Math.abs(v - grid.base)));

  return (
    <div className="stack">
      <div className="row">
        <div className="seg">
          <button className={scope === "portfolio" ? "active" : ""} onClick={() => setScope("portfolio")}>
            Portfolio
          </button>
          <button className={scope === "selected" ? "active" : ""} onClick={() => setScope("selected")}>
            Ausgewählter Trade
          </button>
        </div>
        <span className="muted small">FX-Schock-Währung:</span>
        <div className="seg">
          {["USD", "GBP", "CHF", "EUR"].map((c) => (
            <button key={c} className={fxCcy === c ? "active" : ""} onClick={() => setFxCcy(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grow" />
        <span className="muted xs">Basis-PV {fmtMoney(out.base, s.reportingCurrency)}</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h3>Standard-Szenarien · P&L vs. Basis</h3>
          <EChart
            className="chart tall"
            option={{
              grid: { left: 70, right: 20, top: 10, bottom: 60 },
              xAxis: { type: "category", data: out.results.filter((r) => r.scenario.id !== "base").map((r) => r.scenario.name), axisLabel: { rotate: 35, interval: 0 } },
              yAxis: { type: "value", axisLabel: { formatter: (v: number) => fmtCompact(v) } },
              tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number) },
              series: [{ type: "bar", data: out.results.filter((r) => r.scenario.id !== "base").map((r) => ({ value: Math.round(r.pnl), itemStyle: { color: r.pnl >= 0 ? posColor() : negColor() } })) }],
            }}
          />
        </div>
        <div className="card">
          <h3>Szenario-Tabelle</h3>
          <div className="table-scroll" style={{ maxHeight: 400 }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Szenario</th>
                  <th className="num">PV</th>
                  <th className="num">P&L</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {out.results.map((r) => (
                  <tr key={r.scenario.id} style={{ cursor: "default" }}>
                    <td>{r.scenario.name}</td>
                    <td className={`num ${signClass(r.total)}`}>{fmtMoney(r.total)}</td>
                    <td className={`num ${signClass(r.pnl)}`}>{fmtMoney(r.pnl)}</td>
                    <td className="num muted">{out.base !== 0 ? `${((r.pnl / Math.abs(out.base)) * 100).toFixed(1)} %` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          What-if-Matrix: Zinsen (parallel) × {fxCcy}-Kurs <span className="right muted xs">Zelle = P&L vs. Basis in {s.reportingCurrency}</span>
        </h3>
        <div className="heat" style={{ gridTemplateColumns: `80px repeat(${FX.length}, 1fr)` }}>
          <div className="head" />
          {FX.map((f) => (
            <div key={f} className="head mono">
              {fxCcy} {f > 0 ? "+" : ""}
              {f}%
            </div>
          ))}
          {RATES.map((r, i) => (
            <div key={r} style={{ display: "contents" }}>
              <div className="head mono" style={{ textAlign: "right" }}>
                {r > 0 ? "+" : ""}
                {r} bp
              </div>
              {FX.map((f, j) => {
                const pnl = grid.pv[i]![j]! - grid.base;
                const a = Math.min(1, Math.abs(pnl) / maxAbs);
                const bg = pnl >= 0 ? `rgba(34,197,94,${0.08 + 0.55 * a})` : `rgba(239,68,68,${0.08 + 0.55 * a})`;
                return (
                  <div key={f} className="cell" style={{ background: bg, outline: r === 0 && f === 0 ? "1px solid var(--accent)" : "none" }} title={`PV ${fmtMoney(grid.pv[i]![j]!)}`}>
                    {fmtCompact(pnl)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>P&L je Trade (Standard-Szenarien)</h3>
        <div className="table-scroll" style={{ maxHeight: 360 }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Trade</th>
                {out.results.filter((r) => r.scenario.id !== "base").map((r) => (
                  <th key={r.scenario.id} className="num">
                    {r.scenario.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, ti) => (
                <tr key={t.id} onClick={() => s.select(t.id)} className={t.id === s.selectedId ? "selected" : ""}>
                  <td className="mono">{t.id}</td>
                  {out.results.filter((r) => r.scenario.id !== "base").map((r) => {
                    const v = r.byTrade[ti]?.pnl ?? 0;
                    return (
                      <td key={r.scenario.id} className={`num ${signClass(v)}`}>
                        {fmtCompact(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
