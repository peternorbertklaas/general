import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type Fixing, type MarketSnapshotJson, deserializeMarket, serializeMarket, toISO, validateMarket } from "@deriva/pricing-core";
import { DateInput } from "../components/DateInput.js";
import { NumInput } from "../components/NumInput.js";
import { fmtBp, fmtDate, fmtNum, fmtPct } from "../lib/format.js";
import { translateCoreMessage, translatePricingError } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { marketModified, useStore } from "../state/store.js";

const FIXING_INDICES = ["EURIBOR-1M", "EURIBOR-3M", "EURIBOR-6M", "EURIBOR-12M", "ESTR", "SOFR", "SONIA", "SARON"];

/** Editable table of historical fixings (index, date, value in %). */
function FixingsEditor() {
  const m = useStore((s) => s.baseMarket);
  const act = useStore.getState;
  const fixings = m.fixings ?? [];
  const apply = (next: Fixing[]) => act().setMarket({ ...m, fixings: next });
  const setRow = (i: number, patch: Partial<Fixing>) => apply(fixings.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const remove = (i: number) => apply(fixings.filter((_, j) => j !== i));
  const add = (f: Fixing) => apply([...fixings, f]);
  /** Today's EURIBOR-6M from the projection curve (fallback 2 %). */
  const addEuribor6mToday = () => {
    const curve = m.curves["EUR-EURIBOR-6M"];
    let value = 0.02;
    try {
      if (curve) value = curve.forwardRate(m.valuationDate, m.valuationDate + 182, "ACT/360");
    } catch {
      value = 0.02;
    }
    add({ index: "EURIBOR-6M", date: m.valuationDate, value: Math.round(value * 1e6) / 1e6 });
    act().showToast(`EURIBOR-6M ${fmtDate(m.valuationDate)} = ${fmtPct(value, 3)} hinzugefügt`);
  };
  return (
    <div className="card" data-testid="fixings-editor">
      <h3>
        Fixings (editierbar)
        <span className="right row">
          <button className="btn ghost" onClick={addEuribor6mToday} title="EURIBOR-6M mit dem Kurven-Forward am Bewertungstag anlegen">
            + EURIBOR-6M heute
          </button>
          <button className="btn" onClick={() => add({ index: "EURIBOR-6M", date: m.valuationDate, value: 0.02 })}>
            + Zeile
          </button>
        </span>
      </h3>
      {fixings.length === 0 ? (
        <div className="muted small">
          Keine historischen Fixings hinterlegt – laufende Perioden werden mit dem Kurven-Forward projiziert (Hinweis im Pricing).
        </div>
      ) : (
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Index</th>
                <th>Datum</th>
                <th className="num">Fixing</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fixings.map((f, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td>
                    <select className="inline" value={f.index} aria-label={`Index Fixing ${i + 1}`} onChange={(e) => setRow(i, { index: e.target.value })}>
                      {[...new Set([...FIXING_INDICES, f.index])].map((ix) => (
                        <option key={ix} value={ix}>
                          {ix}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <DateInput inline value={f.date} ariaLabel={`Datum Fixing ${i + 1}`} onChange={(v) => setRow(i, { date: v })} />
                  </td>
                  <td className="num">
                    <span style={{ display: "inline-block", width: 130 }}>
                      <NumInput
                        inline
                        value={f.value}
                        scale={100}
                        step={0.001}
                        digits={4}
                        unit="%"
                        ariaLabel={`Wert Fixing ${i + 1}`}
                        onChange={(v) => setRow(i, { value: v })}
                      />
                    </span>
                  </td>
                  <td className="num">
                    <button className="btn ghost danger" title="Fixing entfernen" aria-label={`Fixing ${i + 1} entfernen`} onClick={() => remove(i)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Heatmap cell background from a 0…1 intensity using the theme token (works in
 * light and dark). The alpha is capped at 50 % so `--fg-0` text keeps ≥ 4.5:1
 * on the strongest cells in both themes (N-08, checked in contrast.test.ts).
 */
export const HEAT_ALPHA_MIN = 0.1;
export const HEAT_ALPHA_RANGE = 0.4;
export function heatBg(token: "--accent" | "--pos" | "--neg", a: number): string {
  const pct = Math.round((HEAT_ALPHA_MIN + HEAT_ALPHA_RANGE * Math.min(1, Math.max(0, a))) * 100);
  return `color-mix(in srgb, var(${token}) ${pct}%, var(--bg-1))`;
}

/** Arrow-key navigation between the focusable cells of a CSS-grid heatmap (`role="grid"`, N-13). */
export function heatGridKeyNav(e: React.KeyboardEvent<HTMLDivElement>): void {
  const grid = e.currentTarget;
  const target = e.target as HTMLElement;
  if (!target.matches?.('[role="gridcell"]')) return;
  const rows = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'))
    .map((r) => Array.from(r.querySelectorAll<HTMLElement>('[role="gridcell"]')))
    .filter((r) => r.length > 0);
  let ri = -1;
  let ci = -1;
  rows.forEach((r, i) => {
    const j = r.indexOf(target);
    if (j >= 0) {
      ri = i;
      ci = j;
    }
  });
  if (ri < 0) return;
  let nr = ri;
  let nc = ci;
  switch (e.key) {
    case "ArrowRight":
      nc = Math.min(rows[ri]!.length - 1, ci + 1);
      break;
    case "ArrowLeft":
      nc = Math.max(0, ci - 1);
      break;
    case "ArrowDown":
      nr = Math.min(rows.length - 1, ri + 1);
      break;
    case "ArrowUp":
      nr = Math.max(0, ri - 1);
      break;
    case "Home":
      nc = 0;
      break;
    case "End":
      nc = rows[ri]!.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  const next = rows[nr]?.[Math.min(nc, (rows[nr]?.length ?? 1) - 1)];
  if (next) {
    target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }
}

export function MarketView() {
  const s = useStore(useShallow((st) => ({ baseMarket: st.baseMarket, valuationDate: st.valuationDate, quotes: st.quotes, interpolation: st.interpolation })));
  const act = useStore.getState;
  const m = s.baseMarket;
  const swpt = m.swaptionVols?.EUR;
  const fxKeys = Object.keys(m.fxVols ?? {});
  const [fxSel, setFxSel] = useState(fxKeys[0] ?? "EURUSD");
  const fxv = m.fxVols?.[fxSel];
  const capv = Object.values(m.capletVols ?? {})[0];
  const modified = marketModified(s);

  const setSpot = (pair: string, v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    // Spots live in the quote set so they survive valuation-date changes and are flagged as "modifiziert".
    if (!act().setQuotes({ ...s.quotes, fxSpots: { ...s.quotes.fxSpots, [pair]: v } }, `Spot ${pair} ${fmtNum(v, 4)}`))
      act().setMarket({ ...m, fxSpots: { ...m.fxSpots, [pair]: v } });
  };
  const volMin = swpt ? Math.min(...swpt.atm.flat()) : 0;
  const volMax = swpt ? Math.max(...swpt.atm.flat()) : 1;

  return (
    <div className="stack">
      <div className="grid cols-3 market-grid">
        <div className="card">
          <h3>Snapshot</h3>
          <div className="field">
            <label>Bewertungstag</label>
            <div className="row">
              <span className="mono">{fmtDate(s.valuationDate)}</span>
              <button className="btn primary" onClick={() => act().setValDateOpen(true)} title="Bewertungstag mit Presets setzen (⇧T)">
                Ändern …
              </button>
            </div>
          </div>
          <div className="muted small" style={{ marginTop: 10 }}>
            Quelle: {m.meta?.source}
            <br />
            Label: {m.meta?.label}
            {modified && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                modifiziert
              </span>
            )}
            <br />
            Kurven: {Object.keys(m.curves).length} · Fixings: {m.fixings?.length ?? 0}
            {Object.keys(s.interpolation).length > 0 && ` · Interpolations-Overrides: ${Object.keys(s.interpolation).join(", ")}`}
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={() => {
                downloadText(`deriva-market-${toISO(m.valuationDate)}.json`, JSON.stringify(serializeMarket(m), null, 2), "application/json");
                act().showToast("Markt-Snapshot exportiert");
              }}
            >
              ⤓ Snapshot exportieren
            </button>
            <label className="btn" style={{ cursor: "pointer" }}>
              ⤒ Snapshot importieren
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const parsed = JSON.parse(await file.text()) as MarketSnapshotJson;
                    const imported = deserializeMarket(parsed);
                    const problems = validateMarket(imported);
                    if (problems.length) {
                      act().showToast(`Snapshot ungültig: ${translateCoreMessage(problems[0])}`);
                      return;
                    }
                    act().setMarket(imported);
                    act().showToast(`Snapshot ${parsed.valuationDate} importiert`);
                  } catch (err) {
                    act().showToast(`Import fehlgeschlagen: ${translatePricingError(err)}`);
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {modified && (
              <button
                className="btn ghost"
                onClick={() => {
                  act().resetQuotes();
                  for (const id of Object.keys(act().interpolation)) act().setInterpolation(id, undefined);
                }}
              >
                Markt zurücksetzen
              </button>
            )}
          </div>
          <div className="warning" style={{ marginTop: 10 }}>
            Indikative Beispieldaten. Für den Produktivbetrieb Marktdaten-Adapter (Refinitiv/Bloomberg/ICE/EZB) gemäß ADR-005 anbinden.
          </div>
        </div>
        <div className="card">
          <h3>FX-Spots (editierbar)</h3>
          <div className="table-scroll">
            <table className="grid-table">
              <tbody>
                {Object.entries(m.fxSpots).map(([pair, v]) => {
                  const orig = (Object.entries(s.quotes.fxSpots).find(([p]) => p === pair)?.[1] ?? v) as number;
                  return (
                    <tr key={pair} style={{ cursor: "default" }}>
                      <td className="mono">
                        {pair.slice(0, 3)}/{pair.slice(3)}
                      </td>
                      <td className="num">
                        <span style={{ display: "inline-block", width: 104 }}>
                          <NumInput inline value={v} step={0.0005} digits={4} min={0.0001} ariaLabel={`Spot ${pair}`} onChange={(x) => setSpot(pair, x)} />
                        </span>
                        {Math.abs(orig - v) > 1e-9 && (
                          <span className="muted xs" title={`Quote ${fmtNum(orig, 4)}`}>
                            {" "}
                            ●
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>Kreditdaten (CVA)</h3>
          <div className="table-scroll">
            <table className="grid-table compact">
              <thead>
                <tr>
                  <th>Kontrahent</th>
                  <th className="num">Hazard</th>
                  <th className="num">Recovery</th>
                  <th className="num">≈ CDS</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(m.credit ?? {}).map(([k, c]) => (
                  <tr key={k} style={{ cursor: "default" }}>
                    <td>{k}</td>
                    <td className="num">{fmtPct(c.hazardRate, 2)}</td>
                    <td className="num">{fmtPct(c.recovery, 0)}</td>
                    <td className="num">{fmtBp(c.hazardRate * (1 - c.recovery), 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <FixingsEditor />

      {swpt && (
        <div className="card">
          <h3>
            Swaption-ATM-Vols EUR (Normal, bp){" "}
            <span className="right muted xs">Expiry × Tenor · SABR-Smile-Parameter für {Object.keys(swpt.sabr ?? {}).join(", ")}</span>
          </h3>
          <div
            className="heat"
            style={{ gridTemplateColumns: `70px repeat(${swpt.tenors.length}, 1fr)` }}
            role="table"
            aria-label="Swaption-ATM-Vols"
            aria-rowcount={swpt.expiries.length + 1}
            aria-colcount={swpt.tenors.length + 1}
          >
            <div role="row" style={{ display: "contents" }}>
              <div className="head" role="columnheader" aria-label="Expiry ↓ / Tenor →" />
              {swpt.tenors.map((t) => (
                <div key={t} className="head mono" role="columnheader">
                  {t}Y
                </div>
              ))}
            </div>
            {swpt.expiries.map((e, i) => (
              <div key={e} role="row" style={{ display: "contents" }}>
                <div className="head mono" role="rowheader" style={{ textAlign: "right" }}>
                  {e < 1 ? `${Math.round(e * 12)}M` : `${e}Y`}
                </div>
                {swpt.atm[i]!.map((v, j) => {
                  const a = (v - volMin) / (volMax - volMin || 1);
                  return (
                    <div key={j} className="cell" role="cell" style={{ background: heatBg("--accent", a) }}>
                      {fmtNum(v * 1e4, 1)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {fxv && (
          <div className="card">
            <h3>
              FX-Vol-Fläche
              <span className="right">
                <div className="seg" role="group" aria-label="Währungspaar">
                  {fxKeys.map((k) => (
                    <button key={k} className={k === fxSel ? "active" : ""} aria-pressed={k === fxSel} onClick={() => setFxSel(k)}>
                      {k.slice(0, 3)}/{k.slice(3)}
                    </button>
                  ))}
                </div>
              </span>
            </h3>
            <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Expiry</th>
                    <th className="num">ATM %</th>
                    <th className="num">25Δ RR</th>
                    <th className="num">25Δ BF</th>
                    <th className="num">10Δ RR</th>
                    <th className="num">10Δ BF</th>
                  </tr>
                </thead>
                <tbody>
                  {fxv.expiries.map((e, i) => (
                    <tr key={e} style={{ cursor: "default" }}>
                      <td className="mono">{e < 1 / 4 ? `${Math.round(e * 52)}W` : e < 1 ? `${Math.round(e * 12)}M` : `${e}Y`}</td>
                      <td className="num">{fmtNum(fxv.atm[i]! * 100, 2)}</td>
                      <td className="num">{fmtNum(fxv.rr25[i]! * 100, 2)}</td>
                      <td className="num">{fmtNum(fxv.bf25[i]! * 100, 2)}</td>
                      <td className="num muted">{fxv.rr10 ? fmtNum(fxv.rr10[i]! * 100, 2) : "–"}</td>
                      <td className="num muted">{fxv.bf10 ? fmtNum(fxv.bf10[i]! * 100, 2) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {capv && (
          <div className="card">
            <h3>
              Caplet-Vols {capv.index} (Normal, bp) <span className="right muted xs">Expiry × Strike</span>
            </h3>
            <div className="table-scroll" style={{ maxHeight: 320 }}>
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Expiry</th>
                    {capv.strikes.map((k) => (
                      <th key={k} className="num">
                        {fmtNum(k * 100, 2)} %
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {capv.expiries.map((e, i) => (
                    <tr key={e} style={{ cursor: "default" }}>
                      <td className="mono">{e < 1 ? `${Math.round(e * 12)}M` : `${e}Y`}</td>
                      {capv.vols[i]!.map((v, j) => (
                        <td key={j} className="num">
                          {fmtNum(v * 1e4, 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
