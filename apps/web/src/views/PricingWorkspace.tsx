import { useMemo } from "react";
import { type Trade, toISO } from "@deriva/pricing-core";
import { EChart, negColor, posColor } from "../components/EChart.js";
import { LABELS, analyticsRows } from "../components/Inspector.js";
import { TradeEditor } from "../components/TradeEditor.js";
import { fmtDate, fmtMoney, fmtPct, signClass } from "../lib/format.js";
import { applyParSolve, flipTrade, tradeTypeBadge } from "../lib/trade-ops.js";
import { selectedTrade, useStore } from "../state/store.js";

export function PricingWorkspace() {
  const s = useStore();
  const trade = useStore(selectedTrade);
  const r = trade ? s.results[trade.id] : undefined;
  const risk = useMemo(() => (trade ? s.risk(trade.id) : undefined), [trade, s.results, s.risk]);

  if (!trade) {
    return (
      <div className="card empty">
        Kein Trade ausgewählt. <kbd>n</kbd> <kbd>s</kbd> für einen neuen Swap oder <kbd>Ctrl</kbd>+<kbd>K</kbd> für die Schnelleingabe.
      </div>
    );
  }
  const badge = tradeTypeBadge(trade.type);
  const res = r?.result;
  const bucket = risk?.bucketed.find((b) => b.buckets.some((x) => Math.abs(x.delta) > 1e-6)) ?? risk?.bucketed[0];

  return (
    <div className="stack">
      <div className="card">
        <h3>
          What-if (live)
          <span className="right muted xs">
            <kbd>[</kbd>/<kbd>]</kbd> ±10bp · <kbd>\</kbd> reset
          </span>
        </h3>
        <div className="grid cols-3">
          <WhatIfSlider label="Zinsen" unit="bp" min={-300} max={300} step={5} value={s.whatIf.ratesBp} onChange={(v) => s.setWhatIf({ ratesBp: v })} />
          <WhatIfSlider label="EUR FX" unit="%" min={-20} max={20} step={0.5} value={s.whatIf.fxPct} onChange={(v) => s.setWhatIf({ fxPct: v })} />
          <WhatIfSlider label="IR-Vol" unit="bp" min={-50} max={50} step={1} value={s.whatIf.volBp} onChange={(v) => s.setWhatIf({ volBp: v })} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(380px, 1fr) minmax(420px, 1.2fr)" }}>
        <div className="stack">
          <div className="card">
            <h3>
              <span className={`badge ${badge.cls}`}>{badge.label}</span> {trade.id}
              <span className="right row">
                <button className="btn ghost" title="Pay/Receive tauschen (f)" onClick={() => s.updateTrade(flipTrade(trade))}>
                  ⇄ Richtung
                </button>
                <button className="btn ghost" title="Par übernehmen (Shift+P)" onClick={() => { const t2 = applyParSolve(trade, res); if (t2) s.updateTrade(t2); }}>
                  ≈ Par
                </button>
                <button className="btn ghost" onClick={() => s.duplicateSelected()}>
                  ⧉
                </button>
                <button className="btn ghost danger" onClick={() => s.removeTrade(trade.id)}>
                  ✕
                </button>
              </span>
            </h3>
            <TradeEditor trade={trade} onChange={(t: Trade) => s.updateTrade(t)} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="grid cols-3">
              <div className="kpi big">
                <span className="label">Barwert ({s.reportingCurrency})</span>
                <span className={`value ${signClass(res?.pv)}`}>{fmtMoney(res?.pv)}</span>
                {res?.accrued !== undefined && Math.abs(res.accrued) > 0.005 && <span className="sub">inkl. Stückzinsen {fmtMoney(res.accrued)}</span>}
              </div>
              <div className="kpi">
                <span className="label">{keyMetricLabel(trade)}</span>
                <span className="value">{keyMetric(trade, res?.analytics)}</span>
              </div>
              <div className="kpi">
                <span className="label">DV01</span>
                <span className={`value ${signClass(risk?.dv01)}`}>{fmtMoney(risk?.dv01)}</span>
                <span className="sub">Theta 1D {fmtMoney(risk?.theta)}</span>
              </div>
            </div>
            {r?.error && <div className="warning" style={{ marginTop: 10 }}>{r.error}</div>}
            {res?.warnings.map((w) => (
              <div key={w} className="warning" style={{ marginTop: 8 }}>
                {w}
              </div>
            ))}
          </div>

          <div className="grid cols-2">
            <div className="card">
              <h3>Analytics</h3>
              <table className="grid-table">
                <tbody>
                  {res && analyticsRows(res.analytics, trade.type).map((row) => (
                    <tr key={row.k}>
                      <td className="muted">{LABELS[row.k] ?? row.k}</td>
                      <td className="num">{row.v}</td>
                    </tr>
                  ))}
                  {risk && Object.entries(risk.fxDelta).map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted">FX-Delta 1% {k}</td>
                      <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                    </tr>
                  ))}
                  {risk && Object.entries(risk.vega).map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted">Vega {k.split(":")[0]} (+1bp/+1pt)</td>
                      <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                    </tr>
                  ))}
                  {risk && (
                    <tr>
                      <td className="muted">Gamma (1bp²)</td>
                      <td className="num">{fmtMoney(risk.gamma, undefined, 2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>
                Key-Rate-Delta <span className="right muted xs">{bucket?.curveId}</span>
              </h3>
              {bucket ? (
                <EChart
                  option={{
                    grid: { left: 60, right: 10, top: 10, bottom: 30 },
                    xAxis: { type: "category", data: bucket.buckets.map((b) => b.label), axisLabel: { interval: 0, rotate: 45 } },
                    yAxis: { type: "value", axisLabel: { formatter: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)) } },
                    tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number) },
                    series: [{ type: "bar", data: bucket.buckets.map((b) => ({ value: b.delta, itemStyle: { color: b.delta >= 0 ? posColor() : negColor() } })) }],
                  }}
                />
              ) : (
                <div className="empty">Keine Zinssensitivität</div>
              )}
              {risk && risk.bucketed.length > 1 && (
                <div className="row wrap xs muted" style={{ marginTop: 6 }}>
                  {risk.bucketed.map((b) => (
                    <span key={b.curveId}>
                      {b.curveId}: <b className={signClass(b.total)}>{fmtMoney(b.total)}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {res && (
        <div className="card">
          <h3>
            Cashflows <span className="right muted xs">{res.legs.reduce((x, l) => x + l.cashflows.length, 0)} Zahlungen · <kbd>Ctrl</kbd>+<kbd>E</kbd> CSV</span>
          </h3>
          <div className="table-scroll" style={{ maxHeight: 360 }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Leg</th>
                  <th>Fixing</th>
                  <th>Start</th>
                  <th>Ende</th>
                  <th>Zahlung</th>
                  <th className="num">Nominal</th>
                  <th className="num">Satz</th>
                  <th className="num">Tagefaktor</th>
                  <th className="num">Betrag</th>
                  <th className="num">DF</th>
                  <th className="num">Barwert</th>
                  <th>Art</th>
                </tr>
              </thead>
              <tbody>
                {res.legs.flatMap((leg) =>
                  leg.cashflows.map((cf, i) => (
                    <tr key={`${leg.legIndex}-${i}`} style={{ cursor: "default" }}>
                      <td>
                        <span className="badge">{leg.legType}</span>
                      </td>
                      <td className="mono muted">{cf.fixingDate ? fmtDate(cf.fixingDate) : ""}</td>
                      <td className="mono">{cf.accrualStart ? fmtDate(cf.accrualStart) : ""}</td>
                      <td className="mono">{cf.accrualEnd ? fmtDate(cf.accrualEnd) : ""}</td>
                      <td className="mono">{fmtDate(cf.paymentDate)}</td>
                      <td className="num">{fmtMoney(cf.notional)}</td>
                      <td className="num">
                        {cf.rate !== undefined ? fmtPct(cf.rate, 4) : ""} {cf.isFixed && cf.kind === "Interest" && <span className="muted xs">fix</span>}
                      </td>
                      <td className="num">{cf.accrualFactor?.toFixed(6) ?? ""}</td>
                      <td className={`num ${signClass(cf.amount)}`}>{fmtMoney(cf.amount, undefined, 2)}</td>
                      <td className="num">{cf.discountFactor.toFixed(6)}</td>
                      <td className={`num ${signClass(cf.presentValue)}`}>{fmtMoney(cf.presentValue, undefined, 2)}</td>
                      <td className="muted">{cf.kind}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="muted xs">Bewertungstag {toISO(s.valuationDate)} · Berechnung {res?.timingMs?.toFixed(2)} ms · Snapshot {s.baseMarket.meta?.label}</div>
    </div>
  );
}

function WhatIfSlider({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="slider">
      <span className="muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className={`num ${value === 0 ? "muted" : "pos"}`}>
        {value > 0 ? "+" : ""}
        {value} {unit}
      </span>
    </div>
  );
}

function keyMetricLabel(t: Trade): string {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return "Par-Satz";
    case "Swaption":
      return "Forward-Swapsatz";
    case "CapFloor":
      return "Prämie % Nominal";
    case "FxForward":
      return "Fairer Forward";
    case "FxSwap":
      return "Swap-Punkte";
    case "FxOption":
      return "Prämie % Basis";
    case "FRA":
      return "Forward-Satz";
  }
}
function keyMetric(t: Trade, a?: Record<string, number | string | undefined>): string {
  if (!a) return "–";
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return fmtPct(a.parRate as number, 4);
    case "Swaption":
      return fmtPct(a.forwardSwapRate as number, 4);
    case "CapFloor":
      return `${((a.premiumPct as number) ?? 0).toFixed(3)} %`;
    case "FxForward":
      return ((a.fairForward as number) ?? 0).toFixed(5);
    case "FxSwap":
      return ((a.swapPoints as number) ?? 0).toFixed(1);
    case "FxOption":
      return `${((a.premiumPctBase as number) ?? 0).toFixed(3)} %`;
    case "FRA":
      return fmtPct(a.forwardRate as number, 4);
  }
}
