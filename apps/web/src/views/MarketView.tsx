import { useState } from "react";
import { toISO } from "@deriva/pricing-core";
import { fmtBp, fmtNum } from "../lib/format.js";
import { useStore } from "../state/store.js";

export function MarketView() {
  const s = useStore();
  const m = s.baseMarket;
  const [date, setDate] = useState(toISO(s.valuationDate));
  const swpt = m.swaptionVols?.EUR;
  const fxKeys = Object.keys(m.fxVols ?? {});
  const [fxSel, setFxSel] = useState(fxKeys[0] ?? "EURUSD");
  const fxv = m.fxVols?.[fxSel];
  const capv = Object.values(m.capletVols ?? {})[0];

  const setSpot = (pair: string, v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    s.setMarket({ ...m, fxSpots: { ...m.fxSpots, [pair]: v } });
  };
  const volMin = swpt ? Math.min(...swpt.atm.flat()) : 0;
  const volMax = swpt ? Math.max(...swpt.atm.flat()) : 1;

  return (
    <div className="stack">
      <div className="grid cols-3">
        <div className="card">
          <h3>Snapshot</h3>
          <div className="field">
            <label>Bewertungstag</label>
            <div className="row">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <button className="btn primary" onClick={() => { s.setValuationDate(date); s.showToast(`Bewertungstag ${date}`); }}>
                Übernehmen
              </button>
            </div>
          </div>
          <div className="muted small" style={{ marginTop: 10 }}>
            Quelle: {m.meta?.source}
            <br />
            Label: {m.meta?.label}
            <br />
            Kurven: {Object.keys(m.curves).length} · Fixings: {m.fixings?.length ?? 0}
          </div>
          <div className="warning" style={{ marginTop: 10 }}>
            Indikative Beispieldaten. Für den Produktivbetrieb Marktdaten-Adapter (Refinitiv/Bloomberg/ICE/EZB) gemäß ADR-005 anbinden.
          </div>
        </div>
        <div className="card">
          <h3>FX-Spots (editierbar)</h3>
          <table className="grid-table">
            <tbody>
              {Object.entries(m.fxSpots).map(([pair, v]) => (
                <tr key={pair} style={{ cursor: "default" }}>
                  <td className="mono">{pair}</td>
                  <td className="num">
                    <input type="number" step={0.0005} value={v} onChange={(e) => setSpot(pair, Number(e.target.value))} style={{ width: 110, textAlign: "right", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontFamily: "var(--font-mono)" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Kreditdaten (CVA)</h3>
          <table className="grid-table">
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
                  <td className="num">{(c.hazardRate * 100).toFixed(2)} %</td>
                  <td className="num">{(c.recovery * 100).toFixed(0)} %</td>
                  <td className="num">{fmtBp(c.hazardRate * (1 - c.recovery), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {swpt && (
        <div className="card">
          <h3>
            Swaption-ATM-Vols EUR (Normal, bp) <span className="right muted xs">Expiry × Tenor · SABR-Smile-Parameter für {Object.keys(swpt.sabr ?? {}).join(", ")}</span>
          </h3>
          <div className="heat" style={{ gridTemplateColumns: `70px repeat(${swpt.tenors.length}, 1fr)` }}>
            <div className="head" />
            {swpt.tenors.map((t) => (
              <div key={t} className="head mono">
                {t}Y
              </div>
            ))}
            {swpt.expiries.map((e, i) => (
              <div key={e} style={{ display: "contents" }}>
                <div className="head mono" style={{ textAlign: "right" }}>
                  {e < 1 ? `${Math.round(e * 12)}M` : `${e}Y`}
                </div>
                {swpt.atm[i]!.map((v, j) => {
                  const a = (v - volMin) / (volMax - volMin || 1);
                  return (
                    <div key={j} className="cell" style={{ background: `rgba(79,140,255,${0.08 + 0.6 * a})` }}>
                      {(v * 1e4).toFixed(1)}
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
                <div className="seg">
                  {fxKeys.map((k) => (
                    <button key={k} className={k === fxSel ? "active" : ""} onClick={() => setFxSel(k)}>
                      {k}
                    </button>
                  ))}
                </div>
              </span>
            </h3>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Expiry</th>
                  <th className="num">ATM</th>
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
                    <td className="num">{(fxv.atm[i]! * 100).toFixed(2)}</td>
                    <td className="num">{(fxv.rr25[i]! * 100).toFixed(2)}</td>
                    <td className="num">{(fxv.bf25[i]! * 100).toFixed(2)}</td>
                    <td className="num muted">{fxv.rr10 ? (fxv.rr10[i]! * 100).toFixed(2) : "–"}</td>
                    <td className="num muted">{fxv.bf10 ? (fxv.bf10[i]! * 100).toFixed(2) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                        {fmtNum(k * 100, 2)}%
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
                          {(v * 1e4).toFixed(0)}
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
