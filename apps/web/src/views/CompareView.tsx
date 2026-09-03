import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { STANDARD_SCENARIOS, runScenarios } from "@deriva/pricing-core";
import { EChart, cssVar } from "../components/EChart.js";
import { useRisks } from "../hooks/useRisk.js";
import { fmtCompact, fmtDate, fmtMoney, signClass } from "../lib/format.js";
import { bucketLabel } from "../lib/metrics.js";
import { keyMetric, keyMetricLabel, tradeMaturity, tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { COMPARE_MAX, compareTrades, useStore } from "../state/store.js";
import { StatusBadge } from "./Blotter.js";

/** Side-by-side comparison of 2–4 trades: PV, headline quote, risk and standard scenarios. */
export function CompareView() {
  const s = useStore(
    useShallow((st) => ({
      compareIds: st.compareIds,
      trades: st.trades,
      customerMode: st.customerMode,
      market: st.market,
      reportingCurrency: st.reportingCurrency,
      results: st.results,
    })),
  );
  // Derived array – memoised so the selector snapshot stays referentially stable.
  const trades = useMemo(() => compareTrades({ compareIds: s.compareIds, trades: s.trades } as Parameters<typeof compareTrades>[0]), [s.compareIds, s.trades]);
  const customer = s.customerMode;
  // Risk is computed in an effect and read from the store cache (N-26).
  const risks = useRisks(trades.map((t) => t.id));

  const scen = useMemo(() => {
    if (trades.length === 0) return null;
    try {
      return runScenarios(s.market, trades, STANDARD_SCENARIOS, s.reportingCurrency);
    } catch {
      return null;
    }
  }, [s.market, trades, s.reportingCurrency]);

  if (trades.length < 2) {
    return (
      <div className="stack">
        <div className="card empty" data-testid="compare-empty">
          <div style={{ fontSize: 28, marginBottom: 8 }}>⇆</div>
          <div style={{ fontWeight: 600, color: "var(--fg-0)" }}>
            Vergleich – {trades.length === 0 ? "keine Trades ausgewählt" : "ein weiterer Trade fehlt"}
          </div>
          <div style={{ marginTop: 8, lineHeight: 1.8 }}>
            Markieren Sie im Blotter (<kbd>g</kbd> <kbd>b</kbd>) 2–{COMPARE_MAX} Trades: mit <kbd>j</kbd>/<kbd>k</kbd> zum Trade navigieren und <kbd>Space</kbd>{" "}
            drücken, oder die Checkbox in der ersten Spalte anklicken.
            <br />
            Danach mit <kbd>g</kbd> <kbd>v</kbd> oder <kbd>Alt</kbd>+<kbd>7</kbd> hierher zurückkehren.
          </div>
          {trades.length === 1 && (
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <span className="badge">{trades[0]!.id}</span>
              <button className="btn ghost" onClick={() => useStore.getState().clearCompare()}>
                Auswahl leeren
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const results = trades.map((t) => s.results[t.id]?.result);
  const scenarios = scen?.results.filter((r) => r.scenario.id !== "base") ?? [];
  const palette = [cssVar("--accent"), cssVar("--accent-2"), cssVar("--info"), cssVar("--warn")];

  const row = (label: string, cells: (string | { text: string; cls?: string })[]) => (
    <tr key={label} style={{ cursor: "default" }}>
      <td className="metric">{label}</td>
      {cells.map((c, i) => {
        const text = typeof c === "string" ? c : c.text;
        const cls = typeof c === "string" ? "" : (c.cls ?? "");
        return (
          <td key={i} className={`num ${cls}`}>
            {text}
          </td>
        );
      })}
    </tr>
  );
  const money = (v: number | undefined) => ({ text: fmtMoney(v), cls: signClass(v) });
  const firstEntry = (o: Record<string, number> | undefined) => {
    const e = Object.entries(o ?? {})[0];
    return e ? { text: `${fmtMoney(e[1])} (${bucketLabel(e[0])})`, cls: signClass(e[1]) } : "–";
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>
          Vergleich · {trades.length} Trades
          <span className="right row">
            <span className="muted xs">
              <kbd>Space</kbd> im Blotter fügt hinzu/entfernt · max. {COMPARE_MAX}
            </span>
            <button className="btn ghost" onClick={() => useStore.getState().clearCompare()}>
              Auswahl leeren
            </button>
          </span>
        </h3>
        <div className="table-scroll">
          <table className="grid-table compare-table" data-testid="compare-table">
            <thead>
              <tr>
                <th style={{ cursor: "default" }} />
                {trades.map((t) => {
                  const b = tradeTypeBadge(t.type);
                  return (
                    <th key={t.id} className="num trade-col">
                      <button className="th-btn" onClick={() => useStore.getState().select(t.id)} title="Trade auswählen">
                        <span className={`badge ${b.cls}`}>{b.label}</span> <span className="mono">{t.id}</span>
                      </button>
                      <div className="muted xs" style={{ fontWeight: 400 }}>
                        {t.name ?? ""} <StatusBadge status={t.status} />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {row(
                `Barwert (${s.reportingCurrency})`,
                results.map((r) => money(r?.pv)),
              )}
              {row(
                "Kennzahl",
                trades.map((t, i) => ({ text: `${keyMetric(t, results[i]?.analytics)} · ${keyMetricLabel(t)}` })),
              )}
              {!customer &&
                row(
                  "DV01",
                  risks.map((r) => money(r?.dv01)),
                )}
              {row(
                "Theta 1D",
                risks.map((r) => money(r?.theta)),
              )}
              {row(
                "Vega",
                risks.map((r) => firstEntry(r?.vega)),
              )}
              {row(
                "FX-Delta 1%",
                risks.map((r) => firstEntry(r?.fxDelta)),
              )}
              {row(
                "Fälligkeit",
                trades.map((t) => fmtDate(tradeMaturity(t))),
              )}
              {row(
                "Nominal",
                trades.map((t) => {
                  const n = tradeNotional(t);
                  return fmtMoney(n.amount, n.currency);
                }),
              )}
              {!customer &&
                row(
                  "Kontrahent",
                  trades.map((t) => t.counterparty ?? "–"),
                )}
              {!customer &&
                row(
                  "Buch",
                  trades.map((t) => t.book ?? "–"),
                )}
              {scenarios.map((r) =>
                row(
                  `P&L ${r.scenario.name}`,
                  trades.map((t) => {
                    const v = r.byTrade.find((x) => x.tradeId === t.id)?.pnl;
                    return money(v);
                  }),
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>
          PV je Standard-Szenario <span className="right muted xs">absolute PV je Trade in {s.reportingCurrency}</span>
        </h3>
        {scen ? (
          <EChart
            className="chart tall"
            option={{
              legend: { top: 0, textStyle: { color: cssVar("--fg-2") } },
              tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number) },
              grid: { left: 70, right: 20, top: 30, bottom: 60 },
              xAxis: { type: "category", data: scenarios.map((r) => r.scenario.name), axisLabel: { rotate: 35, interval: 0 } },
              yAxis: { type: "value", axisLabel: { formatter: (v: number) => fmtCompact(v) } },
              series: trades.map((t, i) => ({
                name: t.id,
                type: "bar" as const,
                itemStyle: { color: palette[i % palette.length] },
                data: scenarios.map((r) => Math.round(r.byTrade.find((x) => x.tradeId === t.id)?.pv ?? 0)),
              })),
            }}
          />
        ) : (
          <div className="empty">Szenarien konnten nicht berechnet werden.</div>
        )}
      </div>
    </div>
  );
}
