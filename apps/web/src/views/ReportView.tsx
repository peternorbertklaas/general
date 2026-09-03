import { useMemo, useState } from "react";
import { buildValuationReport, cashflowTable, computeRisk, computeXva, hazardFromSpread, toCsv } from "@deriva/pricing-core";
import { EChart, cssVar } from "../components/EChart.js";
import { fmtBp, fmtDate, fmtMoney, fmtPct, signClass } from "../lib/format.js";
import { tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { selectedTrade, useStore } from "../state/store.js";

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportView() {
  const s = useStore();
  const trade = useStore(selectedTrade);
  const [cptySpreadBp, setCptySpreadBp] = useState(120);
  const [ownSpreadBp, setOwnSpreadBp] = useState(60);
  const [recovery, setRecovery] = useState(40);
  const [offerPv, setOfferPv] = useState<string>("0");

  const report = useMemo(() => {
    if (!trade) return null;
    const pricing = s.results[trade.id]?.result;
    if (!pricing) return null;
    const risk = computeRisk(s.market, trade, s.reportingCurrency, { bucketed: true });
    const xva = computeXva(
      s.market,
      trade,
      { cptyHazard: hazardFromSpread(cptySpreadBp / 1e4, recovery / 100), cptyRecovery: recovery / 100, ownHazard: hazardFromSpread(ownSpreadBp / 1e4, recovery / 100), ownRecovery: recovery / 100 },
      s.reportingCurrency,
    );
    const tp = Number(offerPv.replace(",", "."));
    return buildValuationReport(s.market, trade, pricing, { risk, xva, transactionPrice: Number.isFinite(tp) ? tp : undefined });
  }, [trade, s.results, s.market, s.reportingCurrency, cptySpreadBp, ownSpreadBp, recovery, offerPv]);

  if (!trade || !report) return <div className="card empty">Kein Trade ausgewählt.</div>;
  const badge = tradeTypeBadge(trade.type);
  const n = tradeNotional(trade);
  const xvaOk = report.xva && Number.isFinite(report.xva.cva);

  return (
    <div className="stack">
      <div className="card">
        <h3>
          Bewertungsreport · <span className={`badge ${badge.cls}`}>{badge.label}</span> {trade.id}
          <span className="right row">
            <button className="btn" onClick={() => download(`${trade.id}-report.json`, JSON.stringify(report, null, 2), "application/json")}>
              ⤓ JSON
            </button>
            <button className="btn" onClick={() => download(`${trade.id}-cashflows.csv`, toCsv(cashflowTable(report.pricing)), "text/csv")}>
              ⤓ CSV
            </button>
            <button className="btn" onClick={() => window.print()}>
              ⎙ Drucken
            </button>
          </span>
        </h3>
        <div className="muted small">
          {trade.name} · Nominal {fmtMoney(n.amount, n.currency)} · Bewertungstag {report.valuationDate} · Reporting {report.reportingCurrency} · Snapshot {report.market.label} · erstellt {new Date(report.generatedAt).toLocaleString("de-DE")}
        </div>
      </div>

      <div className="grid cols-4">
        <div className="card kpi">
          <span className="label">Fair Value (risikofrei)</span>
          <span className={`value ${signClass(report.fairValue.riskFree)}`}>{fmtMoney(report.fairValue.riskFree)}</span>
          <span className="sub">OIS-diskontiert, ohne Kreditrisiko</span>
        </div>
        <div className="card kpi">
          <span className="label">CVA</span>
          <span className="value neg">{xvaOk ? `-${fmtMoney(report.fairValue.cva)}` : "n/a"}</span>
          <span className="sub">Kontrahent {cptySpreadBp} bp · LGD {100 - recovery}%</span>
        </div>
        <div className="card kpi">
          <span className="label">DVA</span>
          <span className="value pos">{xvaOk ? `+${fmtMoney(report.fairValue.dva)}` : "n/a"}</span>
          <span className="sub">eigenes Risiko {ownSpreadBp} bp</span>
        </div>
        <div className="card kpi">
          <span className="label">Fair Value (bilateral, IFRS 13 Level {report.fairValue.ifrs13Level})</span>
          <span className={`value ${signClass(report.fairValue.adjusted)}`}>{fmtMoney(report.fairValue.adjusted)}</span>
          <span className="sub">= risikofrei − CVA + DVA</span>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Kostentransparenz (MiFID II / BGH-Rechtsprechung)</h3>
          <div className="form">
            <div className="field">
              <label>Transaktionspreis / Upfront (Kunde zahlt +)</label>
              <input value={offerPv} onChange={(e) => setOfferPv(e.target.value)} />
            </div>
            <div className="field">
              <label>Kontrahenten-Spread (bp)</label>
              <input type="number" value={cptySpreadBp} onChange={(e) => setCptySpreadBp(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Eigener Spread (bp)</label>
              <input type="number" value={ownSpreadBp} onChange={(e) => setOwnSpreadBp(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Recovery %</label>
              <input type="number" value={recovery} onChange={(e) => setRecovery(Number(e.target.value))} />
            </div>
          </div>
          {report.costTransparency && (
            <table className="grid-table" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td className="muted">Fair Value (bilateral)</td>
                  <td className={`num ${signClass(report.costTransparency.fairValue)}`}>{fmtMoney(report.costTransparency.fairValue)}</td>
                </tr>
                <tr>
                  <td className="muted">Transaktionspreis</td>
                  <td className="num">{fmtMoney(report.costTransparency.transactionPrice)}</td>
                </tr>
                <tr>
                  <td className="muted">Anfänglicher Marktwert (Kundensicht)</td>
                  <td className={`num ${signClass(report.costTransparency.initialMarketValue)}`}>{fmtMoney(report.costTransparency.initialMarketValue)}</td>
                </tr>
                <tr>
                  <td className="muted">Marge in bp des Nominals</td>
                  <td className="num">{report.costTransparency.marginBp.toFixed(1)} bp</td>
                </tr>
                <tr>
                  <td className="muted">Marge in % des Nominals</td>
                  <td className="num">{report.costTransparency.marginPct.toFixed(3)} %</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="muted xs" style={{ marginTop: 8 }}>
            Nach BGH XI ZR 33/10 und XI ZR 378/13 ist der anfängliche negative Marktwert dem Kunden einschließlich seiner Höhe offenzulegen. Der Ausweis oben ergibt sich aus Fair Value abzüglich Transaktionspreis.
          </div>
        </div>

        <div className="card">
          <h3>Erwartetes Exposure (EPE / ENE, diskontiert)</h3>
          {xvaOk && report.xva!.profile.length > 1 ? (
            <EChart
              option={{
                legend: { top: 0, textStyle: { color: cssVar("--fg-2") } },
                tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number) },
                xAxis: { type: "category", data: report.xva!.profile.map((p) => `${p.years.toFixed(1)}J`) },
                yAxis: { type: "value", axisLabel: { formatter: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`) } },
                series: [
                  { name: "EPE", type: "line", areaStyle: { opacity: 0.25 }, data: report.xva!.profile.map((p) => Math.round(p.epe)), showSymbol: false },
                  { name: "ENE", type: "line", areaStyle: { opacity: 0.25 }, data: report.xva!.profile.map((p) => -Math.round(p.ene)), showSymbol: false },
                ],
              }}
            />
          ) : (
            <div className="empty">{report.xva?.warnings.join(" ") || "Kein Exposure-Profil"}</div>
          )}
          <div className="muted xs">Methode: {report.xva?.method}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Sensitivitäten</h3>
          <table className="grid-table">
            <tbody>
              <tr>
                <td className="muted">DV01 (parallel, alle Kurven)</td>
                <td className={`num ${signClass(report.risk?.dv01)}`}>{fmtMoney(report.risk?.dv01)}</td>
              </tr>
              {Object.entries(report.risk?.dv01ByCurve ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">DV01 {k}</td>
                  <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                </tr>
              ))}
              {Object.entries(report.risk?.fxDelta ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">FX-Delta 1% {k}</td>
                  <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                </tr>
              ))}
              {Object.entries(report.risk?.vega ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">Vega {k}</td>
                  <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                </tr>
              ))}
              <tr>
                <td className="muted">Theta (1 Tag)</td>
                <td className={`num ${signClass(report.risk?.theta)}`}>{fmtMoney(report.risk?.theta)}</td>
              </tr>
              <tr>
                <td className="muted">Gamma (1bp²)</td>
                <td className="num">{fmtMoney(report.risk?.gamma, undefined, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Methodik & Marktdaten</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {report.methodology.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div className="muted xs" style={{ marginTop: 10 }}>{report.fairValue.rationale}</div>
          <table className="grid-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Kurve</th>
                <th className="num">Pillars</th>
                <th className="num">Zero 2Y</th>
                <th className="num">Zero 10Y</th>
              </tr>
            </thead>
            <tbody>
              {report.market.curves.map((c) => {
                const z = (yrs: number) => {
                  const target = new Date(report.valuationDate).getTime() + yrs * 365.25 * 86400000;
                  let best = c.nodes[0]!;
                  for (const nd of c.nodes) if (Math.abs(new Date(nd.date).getTime() - target) < Math.abs(new Date(best.date).getTime() - target)) best = nd;
                  return best.zero;
                };
                return (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td className="mono">{c.id}</td>
                    <td className="num">{c.nodes.length}</td>
                    <td className="num">{fmtPct(z(2), 3)}</td>
                    <td className="num">{fmtPct(z(10), 3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted xs" style={{ marginTop: 6 }}>
            FX-Spots: {Object.entries(report.market.fxSpots).map(([k, v]) => `${k} ${v}`).join(" · ")} · Stückzinsen {fmtMoney(report.pricing.accrued)} · Restlaufzeit bis {fmtDate(report.pricing.analytics.maturity as number | undefined)} · Hazard ≈ {fmtBp(hazardFromSpread(cptySpreadBp / 1e4, recovery / 100), 0)}
          </div>
        </div>
      </div>
    </div>
  );
}
