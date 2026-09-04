import { useState } from "react";
import { useRisk } from "../hooks/useRisk.js";
import { fmtDate, fmtMoney, signClass } from "../lib/format.js";
import { translateCoreMessage } from "../lib/i18n.js";
import { analyticsRows, bucketLabel, detailRows, type AnalyticsRow } from "../lib/metrics.js";
import { tradeMaturity, tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { STATUS_LABELS, selectedTrade, useStore } from "../state/store.js";
import { Term } from "./InfoTip.js";

export { analyticsRows };

/**
 * Two-column analytics table; whitelisted rows first, unknown keys behind a
 * collapsible "Weitere (technisch)" (N-01). Key-value tables have no header
 * row, so they carry an `aria-label` (R5-04); value cells repeat their text as
 * `title` so a truncated cell in a narrow sidebar is still readable (R5-01).
 */
export function AnalyticsTable({ rows, testId, label = "Kennzahlen" }: { rows: AnalyticsRow[]; testId?: string; label?: string }) {
  const [techOpen, setTechOpen] = useState(false);
  const main = rows.filter((r) => !r.technical);
  const tech = rows.filter((r) => r.technical);
  return (
    <>
      <table className="grid-table kv" data-testid={testId} aria-label={label}>
        <tbody>
          {main.map((row) => (
            <tr key={row.k} style={{ cursor: "default" }}>
              <td className="muted">
                {row.label}
                {row.unit && <span className="xs"> ({row.unit})</span>}
              </td>
              <td className="num" title={row.v}>
                {row.v}
              </td>
            </tr>
          ))}
          {main.length === 0 && (
            <tr>
              <td className="muted" colSpan={2}>
                Keine Analytics (Bewertung fehlgeschlagen)
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {tech.length > 0 && (
        <div className="collapsible tech" style={{ marginTop: 6 }}>
          <button type="button" onClick={() => setTechOpen((o) => !o)} aria-expanded={techOpen} className="xs">
            <span>{techOpen ? "▾" : "▸"}</span> Weitere (technisch) · {tech.length}
          </button>
          {techOpen && (
            <table className="grid-table compact kv" style={{ marginTop: 4 }} aria-label={`${label} – technische Kennzahlen`}>
              <tbody>
                {tech.map((row) => (
                  <tr key={row.k} style={{ cursor: "default" }}>
                    <td className="muted xs" title={row.k}>
                      {row.label}
                    </td>
                    <td className="num xs">{row.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

export function Inspector() {
  const trade = useStore(selectedTrade);
  const r = useStore((s) => (trade ? s.results[trade.id] : undefined));
  const ccy = useStore((s) => s.reportingCurrency);
  const customer = useStore((s) => s.customerMode);
  const view = useStore((s) => s.view);
  const inCompare = useStore((s) => (trade ? s.compareIds.includes(trade.id) : false));
  const rk = useRisk(trade?.id);
  if (!trade)
    return (
      <div className="empty">
        Kein Trade ausgewählt.
        <div className="xs" style={{ marginTop: 6 }}>
          <kbd>j</kbd>/<kbd>k</kbd> im Blotter · <kbd>Ctrl</kbd>+<kbd>K</kbd> Suche
        </div>
      </div>
    );
  const badge = tradeTypeBadge(trade.type);
  const n = tradeNotional(trade);
  const status = trade.status ?? "Indication";
  const rows = r?.result ? analyticsRows(r.result.analytics, { tradeType: trade.type, reportingCurrency: ccy }) : [];
  const price = rows.filter((x) => x.section === "price");
  const details = detailRows(r?.result?.details);
  const vegaEntries = Object.entries(rk?.vega ?? {});
  const fxEntries = Object.entries(rk?.fxDelta ?? {});
  return (
    <div className="stack" data-testid="inspector">
      <div>
        <div className="row">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          <span className={`badge st-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>
          <span className="mono small ellipsis" title={trade.id} style={{ maxWidth: 150 }}>
            {trade.id}
          </span>
        </div>
        <div className="ellipsis" style={{ fontWeight: 600, marginTop: 6 }} title={trade.name ?? trade.id}>
          {trade.name ?? trade.id}
        </div>
        <div className="muted small">
          {fmtMoney(n.amount, n.currency)} · bis {fmtDate(tradeMaturity(trade))}{" "}
          {!customer && (trade.counterparty ? `· ${trade.counterparty}` : "· ohne Kontrahent")}
          {trade.book && ` · Buch ${trade.book}`}
        </div>
        {details.length > 0 && (
          <div className="muted xs" data-testid="inspector-details">
            {details.map((d) => `${d.label} ${d.v}`).join(" · ")}
          </div>
        )}
      </div>
      <div className="kpi big">
        <span className="label">
          <Term id="pv">Barwert ({ccy})</Term>
        </span>
        <span className={`value ${signClass(r?.result?.pv)}`}>{fmtMoney(r?.result?.pv, undefined, 0)}</span>
        {r?.result?.accrued !== undefined && Math.abs(r.result.accrued) > 0.005 && <span className="sub">Stückzinsen {fmtMoney(r.result.accrued)}</span>}
      </div>
      {r?.error && <div className="warning error">Fehler: {translateCoreMessage(r.error)}</div>}
      {!customer &&
        r?.result?.warnings.map((w) => (
          <div key={w} className="warning">
            {translateCoreMessage(w)}
          </div>
        ))}
      {rk && (
        <div className="grid cols-2">
          {!customer && (
            <div className="kpi">
              <span className="label">
                <Term id="dv01">DV01</Term>
              </span>
              <span className={`value ${signClass(rk.dv01)}`} style={{ fontSize: 16 }}>
                {fmtMoney(rk.dv01)}
              </span>
            </div>
          )}
          <div className="kpi">
            <span className="label">
              <Term id="theta">Theta 1D</Term>
            </span>
            <span className={`value ${signClass(rk.theta)}`} style={{ fontSize: 16 }}>
              {fmtMoney(rk.theta)}
            </span>
          </div>
        </div>
      )}
      {rk && (vegaEntries.length > 0 || fxEntries.length > 0) && (
        <table className="grid-table kv" aria-label="Sensitivitäten (Vega, FX-Delta)">
          <tbody>
            {vegaEntries.map(([k, v]) => (
              <tr key={`v-${k}`} style={{ cursor: "default" }}>
                <td className="muted">
                  <Term id="vega">Vega {bucketLabel(k)}</Term>
                </td>
                <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
              </tr>
            ))}
            {fxEntries.map(([k, v]) => (
              <tr key={`fx-${k}`} style={{ cursor: "default" }}>
                <td className="muted">
                  <Term id="fxDelta">FX-Delta 1 % {bucketLabel(k)}</Term>
                </td>
                <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {price.length > 0 && <AnalyticsTable rows={price} testId="inspector-analytics" label="Kennzahlen" />}
      <label className="check muted xs">
        <input type="checkbox" checked={inCompare} onChange={() => useStore.getState().toggleCompare(trade.id)} /> im Vergleich (<kbd>Space</kbd>)
      </label>
      <div className="muted xs">
        {view === "blotter" ? (
          <>
            <kbd>↵</kbd> öffnen · <kbd>d</kbd> duplizieren · <kbd>⇧D</kbd> löschen · <kbd>j</kbd>/<kbd>k</kbd> wechseln
          </>
        ) : (
          <>
            <kbd>g</kbd> <kbd>p</kbd> Pricing · <kbd>g</kbd> <kbd>r</kbd> Report · <kbd>i</kbd> Inspector aus
          </>
        )}
      </div>
    </div>
  );
}
