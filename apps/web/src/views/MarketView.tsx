import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type Fixing, type MarketSnapshotJson, deserializeMarket, serializeMarket, survivalProbability, toISO, validateMarket } from "@deriva/pricing-core";
import { DateInput } from "../components/DateInput.js";
import { NumInput } from "../components/NumInput.js";
import { CDS_TENORS, hazardCurveFor, normaliseCdsQuotes, tenorYears } from "../lib/credit.js";
import { fmtBp, fmtDate, fmtNum, fmtPct } from "../lib/format.js";
import { translateCoreMessage, translatePricingError } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { type CdsQuote, DEFAULT_REPORT_INPUTS, marketModified, useStore } from "../state/store.js";

const FIXING_INDICES = ["EURIBOR-1M", "EURIBOR-3M", "EURIBOR-6M", "EURIBOR-12M", "ESTR", "SOFR", "SONIA", "SARON", "TONA"];

/**
 * Credit card: CDS par-spread term structure per counterparty → piecewise
 * constant hazard curve (core `bootstrapHazardCurve`). The market context only
 * carries flat hazards, so the term structure lives in the store and the XVA
 * panel of the report passes it as `cptyHazardCurve`.
 */
function CreditCard() {
  const m = useStore((s) => s.baseMarket);
  const trades = useStore((s) => s.trades);
  const cdsCurves = useStore((s) => s.cdsCurves);
  const customer = useStore((s) => s.customerMode);
  const act = useStore.getState;
  const counterparties = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) if (t.counterparty?.trim()) set.add(t.counterparty.trim());
    for (const k of Object.keys(cdsCurves)) set.add(k);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [trades, cdsCurves]);
  const [selCpty, setSelCpty] = useState<string>("");
  const cpty = counterparties.includes(selCpty) ? selCpty : (counterparties[0] ?? "");
  const [recovery, setRecovery] = useState(DEFAULT_REPORT_INPUTS.recovery / 100);
  const quotes = cdsCurves[cpty] ?? [];
  const setQuotes = (next: CdsQuote[]) => act().setCdsCurve(cpty, next);
  const addRow = () => {
    const used = new Set(quotes.map((q) => q.tenor));
    const tenor = CDS_TENORS.find((t) => !used.has(t)) ?? "5Y";
    setQuotes([...quotes, { tenor, spread: quotes[quotes.length - 1]?.spread ?? 0.01 }]);
  };
  const discount = m.curves[m.discountCurveId.EUR ?? ""];
  const hazard = useMemo(() => hazardCurveFor(cdsCurves, cpty, recovery, m.valuationDate, discount), [cdsCurves, cpty, recovery, m.valuationDate, discount]);
  const sorted = normaliseCdsQuotes(quotes);
  return (
    <div className="card" data-testid="credit-card">
      <h3>
        Kreditdaten (CVA)
        <span className="right row wrap" style={{ gap: 6 }}>
          {!customer && counterparties.length > 0 && (
            <select
              className="inline"
              value={cpty}
              aria-label="Kontrahent für CDS-Termstruktur"
              data-testid="cds-cpty"
              onChange={(e) => setSelCpty(e.target.value)}
            >
              {counterparties.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {cdsCurves[c]?.length ? ` (${cdsCurves[c]!.length})` : ""}
                </option>
              ))}
            </select>
          )}
          {!customer && cpty && (
            <button className="btn xs" onClick={addRow} data-testid="cds-add" title="CDS-Quote (Tenor, Par-Spread) hinzufügen">
              + CDS-Quote
            </button>
          )}
        </span>
      </h3>
      {!customer && cpty && (
        <>
          <div className="row wrap" style={{ gap: 10, marginBottom: 6 }}>
            <span className="muted xs">CDS-Termstruktur {cpty}</span>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted xs">Recovery</span>
              <span style={{ display: "inline-block", width: 86 }}>
                <NumInput inline value={recovery} scale={100} step={5} min={0} max={0.99} digits={0} unit="%" ariaLabel="Recovery CDS" onChange={setRecovery} />
              </span>
            </label>
            {quotes.length > 0 && (
              <button className="btn ghost xs" onClick={() => setQuotes([])} title="Termstruktur entfernen – zurück zum flachen Spread des Reports">
                Entfernen
              </button>
            )}
          </div>
          {quotes.length === 0 ? (
            <div className="muted small" style={{ marginBottom: 8 }}>
              Keine CDS-Quotes – der Report verwendet den flachen Kontrahenten-Spread. Mit „+ CDS-Quote“ eine Termstruktur (1Y … 10Y) anlegen; sie wird zur
              Hazard-Kurve gebootstrappt und ersetzt im XVA den flachen Spread.
            </div>
          ) : (
            <div className="table-scroll" style={{ maxHeight: 220 }}>
              <table className="grid-table compact" data-testid="cds-table">
                <thead>
                  <tr>
                    <th>Tenor</th>
                    <th className="num">CDS-Spread</th>
                    <th className="num" title="Stückweise konstante Hazard-Rate des Intervalls bis zum Pillar">
                      Hazard
                    </th>
                    <th className="num" title="Überlebenswahrscheinlichkeit Q(T) = exp(−∫λ)">
                      Q(T)
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q, i) => {
                    const idx = sorted.findIndex((x) => x === q);
                    const years = tenorYears(q.tenor);
                    return (
                      <tr key={i} style={{ cursor: "default" }}>
                        <td>
                          <select
                            className="inline"
                            value={q.tenor}
                            aria-label={`Tenor CDS ${i + 1}`}
                            onChange={(e) => setQuotes(quotes.map((x, j) => (j === i ? { ...x, tenor: e.target.value } : x)))}
                          >
                            {[...new Set([...CDS_TENORS, q.tenor])].map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <span style={{ display: "inline-block", width: 110 }}>
                            <NumInput
                              inline
                              value={q.spread}
                              scale={1e4}
                              step={5}
                              min={0}
                              digits={1}
                              unit="bp"
                              ariaLabel={`Spread CDS ${i + 1}`}
                              onChange={(v) => setQuotes(quotes.map((x, j) => (j === i ? { ...x, spread: v } : x)))}
                            />
                          </span>
                        </td>
                        <td className="num muted">{hazard && idx >= 0 ? fmtBp(hazard.hazards[idx], 0) : "–"}</td>
                        <td className="num muted">{hazard && years !== undefined ? fmtPct(survivalProbability(hazard, years), 2) : "–"}</td>
                        <td className="num">
                          <button
                            className="btn ghost danger"
                            aria-label={`CDS-Quote ${i + 1} entfernen`}
                            title="Quote entfernen"
                            onClick={() => setQuotes(quotes.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {hazard && (
            <div className="muted xs" style={{ margin: "6px 0 8px" }} data-testid="hazard-pillars">
              Hazard-Kurve: {hazard.times.map((t, i) => `${fmtNum(t, 1)} J → ${fmtBp(hazard.hazards[i], 0)}`).join(" · ")} · Recovery{" "}
              {fmtPct(hazard.recovery, 0)} · diskontiert mit {discount?.id ?? "DF = 1"}
            </div>
          )}
        </>
      )}
      <div className="muted xs" style={{ marginBottom: 4 }}>
        Flache Hazard-Raten des Snapshots (Referenz):
      </div>
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
  );
}

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
        <CreditCard />
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
