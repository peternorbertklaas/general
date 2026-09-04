import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type CurveBuildSpec,
  type ParRiskReport,
  type Trade,
  type VegaBucketReport,
  parRisk,
  parseISO,
  sampleBootstrapSpecs,
  toCsv,
  toISO,
  tradeCurrencies,
  vegaBuckets,
} from "@deriva/pricing-core";
import { EChart, negColor, posColor } from "../components/EChart.js";
import { Term } from "../components/InfoTip.js";
import { AnalyticsTable } from "../components/Inspector.js";
import { NumInput } from "../components/NumInput.js";
import { TradeEditor } from "../components/TradeEditor.js";
import { useTableNav } from "../hooks/useTableNav.js";
import { useRisk } from "../hooks/useRisk.js";
import { keysText, HOTKEYS } from "../hotkeys/keymap.js";
import { fmtDate, fmtMoney, fmtMs, fmtNum, fmtPct, signClass } from "../lib/format.js";
import { CASHFLOW_KIND_DE, legTypeLabel, t, translateCoreMessage, translatePricingError } from "../lib/i18n.js";
import { copyText, indicationText } from "../lib/indication.js";
import { analyticsRows, bucketLabel, detailRows } from "../lib/metrics.js";
import { downloadText } from "../lib/portfolio-io.js";
import {
  applyParSolve,
  flipTrade,
  isBasisSwap,
  isOption,
  keyMetric,
  keyMetricLabel,
  parSolveLabel,
  parSolveTitle,
  parSolveUnavailable,
  tradeTypeBadge,
} from "../lib/trade-ops.js";
import { LS_KEYS, deleteWithUndo, extraCurveSpec, readLocal, selectedTrade, useStore, writeLocal } from "../state/store.js";
import { StatusBadge } from "./Blotter.js";

const hk = (id: string) => keysText(HOTKEYS.find((h) => h.id === id) ?? { keys: "" });

/** Risk keys of the pricer analytics that are superseded by the bump-based risk table. */
const MODEL_GREEKS = new Set([
  "delta",
  "deltaPerBp",
  "gamma",
  "gammaPerBp2",
  "vega",
  "vegaCaplet",
  "thetaPerDay",
  "fxDelta",
  "fxDeltaSellCurrency",
  "deltaBase",
  "deltaPct",
  "rhoDomestic",
  "rhoForeign",
]);

type VegaDim = "expiry" | "expiry-tenor";

export function PricingWorkspace() {
  const s = useStore(
    useShallow((st) => ({
      results: st.results,
      market: st.market,
      baseMarket: st.baseMarket,
      reportingCurrency: st.reportingCurrency,
      customerMode: st.customerMode,
      valuationDate: st.valuationDate,
      whatIf: st.whatIf,
      quotes: st.quotes,
      undoStack: st.undoStack,
      marketSource: st.marketSource,
      extraCurves: st.extraCurves,
    })),
  );
  const act = useStore.getState;
  const trade = useStore(selectedTrade);
  const r = trade ? s.results[trade.id] : undefined;
  // Risk is filled into the store cache by an effect – no store write during render (N-26).
  const risk = useRisk(trade?.id);
  const customer = s.customerMode;
  const [parOpen, setParOpen] = useState(() => readLocal(LS_KEYS.parRiskOpen) === "1");
  const [par, setPar] = useState<{ tradeId: string; key: string; report: ParRiskReport; ms: number } | null>(null);
  const [curveSel, setCurveSel] = useState<string | null>(null);
  const [vegaDim, setVegaDim] = useState<VegaDim>(() => (readLocal(LS_KEYS.vegaDimension) === "expiry-tenor" ? "expiry-tenor" : "expiry"));
  /** FX options: also bump the 25Δ risk reversal / butterfly of every expiry row (smile buckets). */
  const [fxSmile, setFxSmile] = useState(false);
  const cfNav = useTableNav({ onCopied: () => act().showToast("Cashflow-Zeile kopiert") });
  const krNav = useTableNav({ onCopied: () => act().showToast("Zeile kopiert") });

  const vegaB = useMemo<VegaBucketReport[]>(() => {
    if (!trade || !isOption(trade) || customer || r?.error) return [];
    try {
      return vegaBuckets(s.market, trade, s.reportingCurrency, {
        dimension: trade.type === "Swaption" ? vegaDim : "expiry",
        smile: trade.type === "FxOption" && fxSmile,
      });
    } catch {
      return [];
    }
  }, [trade, s.market, s.reportingCurrency, customer, vegaDim, fxSmile, r?.error]);
  /**
   * Bootstrap specs with quotes (Markt R8-3): the sample curves plus every "+ Kurve" curve in sample mode – the curves of
   * an imported snapshot carry no quotes, so nothing can be bumped there. `parCoverage` names the trade's curves without a spec.
   */
  const parSpecs = useMemo(() => {
    if (s.marketSource === "import") return {} as Record<string, CurveBuildSpec>;
    const specs: Record<string, CurveBuildSpec> = { ...sampleBootstrapSpecs(s.valuationDate, s.quotes) };
    for (const c of Object.values(s.extraCurves)) specs[c.id] = extraCurveSpec(c, s.market.discountCurveId);
    return specs;
  }, [s.marketSource, s.valuationDate, s.quotes, s.extraCurves, s.market.discountCurveId]);
  const parCoverage = useMemo(() => {
    const ccys = trade ? tradeCurrencies(trade) : [];
    const relevant = Object.values(s.market.curves)
      .filter((c) => ccys.includes(c.currency))
      .map((c) => c.id);
    return { relevant, missing: relevant.filter((id) => !parSpecs[id]) };
  }, [trade, s.market.curves, parSpecs]);

  if (!trade) {
    return (
      <div className="card empty-state" data-testid="pricing-empty">
        <div className="icon">ƒ</div>
        <div className="title">Kein Trade ausgewählt</div>
        <div className="muted small">
          <kbd>n</kbd> <kbd>s</kbd> neuer Swap · <kbd>Ctrl</kbd>+<kbd>K</kbd> Schnelleingabe · <kbd>g</kbd> <kbd>b</kbd> Blotter
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="btn primary" onClick={() => act().setPalette(true)}>
            Schnelleingabe öffnen
          </button>
          <button className="btn" onClick={() => act().setView("blotter")}>
            Zum Blotter
          </button>
        </div>
      </div>
    );
  }
  const badge = tradeTypeBadge(trade.type);
  const res = r?.result;
  // Key-rate chart: the curve with the largest |Σ delta| by default, switchable via chips (N-11).
  const bucketed = risk?.bucketed ?? [];
  const dominant = bucketed.reduce<(typeof bucketed)[number] | undefined>(
    (best, b) => (best === undefined || Math.abs(b.total) > Math.abs(best.total) ? b : best),
    undefined,
  );
  const bucket = (curveSel && bucketed.find((b) => b.curveId === curveSel)) || dominant;
  const ctx = { tradeType: trade.type, reportingCurrency: s.reportingCurrency };
  const rows = res ? analyticsRows(res.analytics, ctx) : [];
  const priceRows = rows.filter((x) => !(risk && MODEL_GREEKS.has(x.k)));
  const parKey = `${trade.id}|${s.valuationDate}|${s.reportingCurrency}|${JSON.stringify(s.whatIf)}|${JSON.stringify(trade)}`;
  const parStale = par !== null && par.key !== parKey;
  const isFx = trade.type.startsWith("Fx");
  const details = detailRows(res?.details);
  const keyTermId = isBasisSwap(trade)
    ? trade.type === "CrossCurrencySwap"
      ? "fairBasisSpread"
      : "fairSpread"
    : trade.type === "InterestRateSwap"
      ? "parRate"
      : undefined;

  const computePar = () => {
    const t0 = performance.now();
    try {
      const report = parRisk(s.market, trade, s.reportingCurrency, parSpecs);
      setPar({ tradeId: trade.id, key: parKey, report, ms: performance.now() - t0 });
    } catch (e) {
      act().showToast(`Par-Risiko nicht berechenbar: ${translatePricingError(e)}`);
    }
  };
  const toggleParOpen = () => {
    const next = !parOpen;
    setParOpen(next);
    writeLocal(LS_KEYS.parRiskOpen, next ? "1" : "0");
  };
  const setVegaDimension = (d: VegaDim) => {
    setVegaDim(d);
    writeLocal(LS_KEYS.vegaDimension, d);
  };
  const copyIndication = async () => {
    const ok = await copyText(indicationText(trade, res, risk, s.reportingCurrency, s.valuationDate, { customer }));
    act().showToast(ok ? "Indikation in die Zwischenablage kopiert" : "Kopieren nicht möglich");
  };
  const exportKeyRate = () => {
    if (!bucket) return;
    let cum = 0;
    const lines = bucket.buckets.map((b) => {
      cum += b.delta;
      return [b.label, b.date, String(b.delta), String(cum)];
    });
    downloadText(
      `${trade.id}-keyrate-${bucket.curveId}-${toISO(s.valuationDate)}.csv`,
      toCsv([["Bucket", "Datum", `Delta ${s.reportingCurrency}`, "kumuliert"], ...lines], { sep: ";", decimalComma: true, bom: true }),
      "text/csv;charset=utf-8",
    );
    act().showToast("Key-Rate-Tabelle exportiert");
  };
  const openDoc = (kind: "Termsheet" | "Geeignetheitserklaerung") => {
    act().setDoc(kind);
    act().setView("report");
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>
          What-if (live)
          <span className="right muted xs">
            <kbd>[</kbd>/<kbd>]</kbd> oder <kbd>-</kbd>/<kbd>+</kbd> ±10 bp · <kbd>\</kbd> oder <kbd>0</kbd> zurücksetzen
          </span>
        </h3>
        <div className="grid cols-3 sliders">
          <WhatIfSlider label="Zinsen" unit="bp" min={-300} max={300} step={5} value={s.whatIf.ratesBp} onChange={(v) => act().setWhatIf({ ratesBp: v })} />
          <WhatIfSlider label="EUR FX" unit="%" min={-20} max={20} step={0.5} value={s.whatIf.fxPct} onChange={(v) => act().setWhatIf({ fxPct: v })} />
          <WhatIfSlider label="IR-Vol" unit="bp" min={-50} max={50} step={1} value={s.whatIf.volBp} onChange={(v) => act().setWhatIf({ volBp: v })} />
        </div>
      </div>

      <div className="grid pricing-grid">
        <div className="stack">
          <div className="card">
            <h3>
              <span className={`badge ${badge.cls}`}>{badge.label}</span>
              <span className="mono ellipsis" title={trade.id} style={{ maxWidth: 160 }}>
                {trade.id}
              </span>
              <StatusBadge status={trade.status} />
              <span className="right row">
                <button
                  className="btn ghost"
                  title={`Richtung tauschen (${hk("flip")})`}
                  onClick={() => {
                    act().updateTrade(flipTrade(trade));
                    act().showToast("Richtung getauscht", { action: { label: "Rückgängig", run: () => act().undo() } });
                  }}
                >
                  ⇄ Richtung
                </button>
                <button
                  className="btn ghost"
                  title={`${parSolveTitle(trade)} (${hk("solve.par")})`}
                  disabled={!res}
                  onClick={() => {
                    const t2 = applyParSolve(trade, res, { market: s.market, reportingCurrency: s.reportingCurrency });
                    if (t2) {
                      act().updateTrade(t2);
                      act().showToast(parSolveLabel(trade), { action: { label: "Rückgängig", run: () => act().undo() } });
                    } else act().showToast(parSolveUnavailable(trade));
                  }}
                >
                  ≈ Par
                </button>
                <button
                  className="btn ghost"
                  title={`Termsheet öffnen (${hk("doc.termsheet")})`}
                  onClick={() => openDoc("Termsheet")}
                  data-testid="pricing-termsheet"
                >
                  ▣ Termsheet
                </button>
                <button
                  className="btn ghost"
                  title={`Indikation als Text kopieren (${hk("copy.indication")})`}
                  aria-label="Indikation kopieren"
                  onClick={copyIndication}
                >
                  ⎘
                </button>
                <button
                  className="btn ghost"
                  title={`Duplizieren (${hk("duplicate")})`}
                  aria-label="Trade duplizieren"
                  onClick={() => {
                    const c = act().duplicateSelected();
                    if (c) act().showToast(`Dupliziert: ${c.id}`);
                  }}
                >
                  ⧉
                </button>
                <button className="btn ghost danger" title={`Löschen (${hk("delete")})`} aria-label="Trade löschen" onClick={() => deleteWithUndo(trade.id)}>
                  ✕
                </button>
              </span>
            </h3>
            <TradeEditor trade={trade} onChange={(t2: Trade) => act().updateTrade(t2)} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="grid cols-3 kpis">
              <div className="kpi big">
                <span className="label">
                  <Term id="pv">Barwert ({s.reportingCurrency})</Term>
                </span>
                <span className={`value ${signClass(res?.pv)}`} data-testid="pv-value">
                  {r?.error ? "–" : fmtMoney(res?.pv)}
                </span>
                {res?.accrued !== undefined && Math.abs(res.accrued) > 0.005 && <span className="sub">inkl. Stückzinsen {fmtMoney(res.accrued)}</span>}
                {r?.error && <span className="sub neg">nicht bewertet – Eingaben prüfen</span>}
              </div>
              <div className="kpi">
                <span className="label">
                  <Term id={keyTermId}>{keyMetricLabel(trade)}</Term>
                </span>
                <span className="value">{keyMetric(trade, res?.analytics)}</span>
              </div>
              {customer ? (
                <div className="kpi">
                  <span className="label">
                    <Term id="theta">Theta 1D</Term>
                  </span>
                  <span className={`value ${signClass(risk?.theta)}`}>{fmtMoney(risk?.theta)}</span>
                  <span className="sub">Zeitwertverlust pro Tag</span>
                </div>
              ) : (
                <div className="kpi">
                  <span className="label">
                    <Term id="dv01">DV01</Term>
                  </span>
                  <span className={`value ${signClass(risk?.dv01)}`}>{fmtMoney(risk?.dv01)}</span>
                  <span className="sub">Theta 1D {fmtMoney(risk?.theta)}</span>
                </div>
              )}
            </div>
            {details.length > 0 && (
              <div className="muted xs row wrap" style={{ marginTop: 8, gap: 10 }} data-testid="pricing-details">
                <span>Termine:</span>
                {details.map((d) => (
                  <span key={d.k}>
                    {d.label} <b className="mono">{d.v}</b>
                  </span>
                ))}
              </div>
            )}
            {r?.error && (
              <div className="warning error" style={{ marginTop: 10 }} role="alert" data-testid="pricing-error">
                {translateCoreMessage(r.error)}
              </div>
            )}
            {!customer &&
              res?.warnings.map((w) => (
                <div key={w} className="warning" style={{ marginTop: 8 }}>
                  {translateCoreMessage(w)}
                </div>
              ))}
          </div>

          <div className="grid cols-2 analytics-grid">
            <div className="card">
              <h3>Preis-Analytics</h3>
              <AnalyticsTable rows={priceRows} testId="analytics-table" label="Preis-Analytics" />
              {risk && !customer && (
                <>
                  <h3 style={{ marginTop: 12 }}>Risiko (Bump)</h3>
                  <table className="grid-table kv" data-testid="risk-table" aria-label="Risiko (Bump)">
                    <tbody>
                      <tr style={{ cursor: "default" }}>
                        <td className="muted">
                          <Term id="dv01">DV01 (parallel)</Term>
                        </td>
                        <td className={`num ${signClass(risk.dv01)}`}>{fmtMoney(risk.dv01)}</td>
                      </tr>
                      {Object.entries(risk.dv01ByCurve).length > 1 &&
                        Object.entries(risk.dv01ByCurve).map(([k, v]) => (
                          <tr key={`c-${k}`} style={{ cursor: "default" }}>
                            <td className="muted">DV01 {k}</td>
                            <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                          </tr>
                        ))}
                      {Object.entries(risk.fxDelta).map(([k, v]) => (
                        <tr key={`fx-${k}`} style={{ cursor: "default" }}>
                          <td className="muted">
                            <Term id="fxDelta">FX-Delta 1 % {bucketLabel(k)}</Term>
                          </td>
                          <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                        </tr>
                      ))}
                      {Object.entries(risk.vega).map(([k, v]) => (
                        <tr key={`v-${k}`} style={{ cursor: "default" }}>
                          <td className="muted">
                            {/* German bucket label ("Vega Swaption EUR"), same source as the inspector (R5-04) */}
                            <Term id="vega">Vega {bucketLabel(k)}</Term> <span className="xs">(+1 bp / +1 Pkt)</span>
                          </td>
                          <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                        </tr>
                      ))}
                      <tr style={{ cursor: "default" }}>
                        <td className="muted">
                          <Term id="theta">Theta 1D</Term>
                        </td>
                        <td className={`num ${signClass(risk.theta)}`}>{fmtMoney(risk.theta)}</td>
                      </tr>
                      <tr style={{ cursor: "default" }}>
                        <td className="muted">
                          <Term id="gamma">Gamma</Term> <span className="xs">(1 bp²)</span>
                        </td>
                        <td className={`num ${signClass(risk.gamma, 0.005)}`}>{fmtMoney(risk.gamma, undefined, 2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <div className="card">
              <h3>
                <Term id="keyRate">Key-Rate-Delta</Term>
                <span className="right row muted xs">
                  {bucket && (
                    <button className="btn ghost xs" onClick={exportKeyRate} title="Key-Rate-Tabelle als CSV">
                      ⤓ CSV
                    </button>
                  )}
                </span>
              </h3>
              {bucketed.length > 1 && (
                // `wrap`: five curve chips of an FX product stay inside the 358-px card of the two-column grid at 1440 px (R7-04)
                <div className="seg wrap" role="group" aria-label="Kurve für Key-Rate-Delta" style={{ marginBottom: 6 }} data-testid="keyrate-curves">
                  {bucketed.map((b) => (
                    <button
                      key={b.curveId}
                      className={bucket?.curveId === b.curveId ? "active" : ""}
                      aria-pressed={bucket?.curveId === b.curveId}
                      onClick={() => setCurveSel(b.curveId)}
                      title={`Σ ${fmtMoney(b.total, s.reportingCurrency)}`}
                    >
                      {b.curveId
                        .replace("EUR-EURIBOR-", "EUR ")
                        .replace("EUR-ESTR", "€STR")
                        .replace("USD-SOFR", "SOFR")
                        .replace("GBP-SONIA", "SONIA")
                        .replace("CHF-SARON", "SARON")}
                      {b === dominant && <span className="dot" aria-label="dominante Kurve" />}
                    </button>
                  ))}
                </div>
              )}
              {bucket ? (
                <>
                  <div className="muted xs" style={{ marginBottom: 4 }}>
                    {bucket.curveId} · Σ <b className={signClass(bucket.total)}>{fmtMoney(bucket.total, s.reportingCurrency)}</b>
                  </div>
                  <EChart
                    ariaLabel={`Key-Rate-Delta je Pillar ${bucket.curveId}`}
                    option={{
                      grid: { left: 56, right: 24, top: 10, bottom: 34 },
                      xAxis: {
                        type: "category",
                        data: bucket.buckets.map((b) => b.label),
                        axisLabel: { interval: bucket.buckets.length > 9 ? 1 : 0, rotate: bucket.buckets.length > 9 ? 40 : 0, hideOverlap: true },
                      },
                      yAxis: { type: "value", axisLabel: { formatter: (v: number) => (Math.abs(v) >= 1000 ? `${fmtNum(v / 1000, 0)}k` : fmtNum(v, 0)) } },
                      tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number, s.reportingCurrency) },
                      series: [
                        { type: "bar", data: bucket.buckets.map((b) => ({ value: b.delta, itemStyle: { color: b.delta >= 0 ? posColor() : negColor() } })) },
                      ],
                    }}
                  />
                  <div className="table-scroll" style={{ maxHeight: 200, marginTop: 6 }}>
                    <table className="grid-table compact">
                      <thead>
                        <tr>
                          <th>Bucket</th>
                          <th>Datum</th>
                          <th className="num">Δ {s.reportingCurrency}</th>
                          <th className="num">kumuliert</th>
                        </tr>
                      </thead>
                      <tbody onKeyDown={krNav.onKeyDown} onFocus={krNav.onFocus}>
                        {(() => {
                          let cum = 0;
                          return bucket.buckets.map((b, bi) => {
                            cum += b.delta;
                            return (
                              <tr key={b.label} {...krNav.rowProps(bi, bucket.buckets.length)} style={{ cursor: "default" }}>
                                <td className="mono">{b.label}</td>
                                <td className="mono muted">{fmtDate(parseISO(b.date))}</td>
                                <td className={`num ${signClass(b.delta)}`}>{fmtMoney(b.delta)}</td>
                                <td className={`num ${signClass(cum)}`}>{fmtMoney(cum)}</td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Summe</td>
                          <td className={`num ${signClass(bucket.total)}`}>{fmtMoney(bucket.total)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty">Keine Zinssensitivität</div>
              )}
            </div>
          </div>

          {!customer && (
            <div className="card" data-testid="par-risk-card">
              <h3>
                <button className="collapse-btn" onClick={toggleParOpen} aria-expanded={parOpen}>
                  {parOpen ? "▾" : "▸"} <Term id="parRisk">Par-Sensitivitäten (Quote-Bumps)</Term>
                </button>
                <span className="right row muted xs">
                  {par && par.tradeId === trade.id && !parStale && <span>{fmtMs(par.ms, 0)}</span>}
                  {parOpen && (
                    <button className="btn xs" onClick={computePar} title="Alle Marktquotes um +1 bp bumpen und neu bootstrappen (≈ 1 s)">
                      {par && par.tradeId === trade.id ? (parStale ? "Neu berechnen" : "Aktualisieren") : "Berechnen"}
                    </button>
                  )}
                </span>
              </h3>
              {parOpen && parCoverage.missing.length > 0 && (
                <div className="warning" data-testid="par-risk-coverage">
                  Par-Risiko nur für Kurven mit Quotes ({parCoverage.relevant.length - parCoverage.missing.length} von {parCoverage.relevant.length})
                  {parCoverage.relevant.length > parCoverage.missing.length ? ` – ohne Quotes: ${parCoverage.missing.join(", ")}` : ""}.{" "}
                  {s.marketSource === "import"
                    ? "Die Kurven des importierten Snapshots tragen keine Bootstrap-Quotes – „Zum Sample-Markt“ wechseln oder die Kurve mit „+ Kurve“ aus Quotes anlegen."
                    : "Kurven ohne Quotes (Snapshot-Kurven) werden nicht gebumpt; eine Summe wäre eine stille Null."}
                </div>
              )}
              {parOpen &&
                (par && par.tradeId === trade.id ? (
                  <ParRiskPanel
                    report={par.report}
                    zeroDv01={risk?.dv01}
                    ccy={s.reportingCurrency}
                    stale={parStale}
                    complete={parCoverage.missing.length === 0}
                  />
                ) : parCoverage.relevant.length > 0 && parCoverage.missing.length === parCoverage.relevant.length ? null : (
                  <div className="muted small">
                    Berechnung auf Abruf: jede Bootstrap-Quote wird um +1 bp verschoben und alle abhängigen Kurven neu aufgebaut. Dauert etwa eine Sekunde.
                  </div>
                ))}
            </div>
          )}

          {vegaB.length > 0 && (
            <div className="card" data-testid="vega-buckets">
              <h3>
                <Term id="vega">Vega-Buckets</Term>
                <span className="right row muted xs">
                  {trade.type === "Swaption" && (
                    <div className="seg" role="group" aria-label="Vega-Dimension" data-testid="vega-dimension">
                      <button className={vegaDim === "expiry" ? "active" : ""} aria-pressed={vegaDim === "expiry"} onClick={() => setVegaDimension("expiry")}>
                        je Verfall
                      </button>
                      <button
                        className={vegaDim === "expiry-tenor" ? "active" : ""}
                        aria-pressed={vegaDim === "expiry-tenor"}
                        onClick={() => setVegaDimension("expiry-tenor")}
                      >
                        Verfall × Tenor
                      </button>
                    </div>
                  )}
                  {trade.type === "FxOption" && (
                    <label
                      className="check"
                      title="Zusätzlich 25Δ Risk Reversal und Butterfly je Verfall um +1 Vol-Punkt bumpen (Smile-Buckets, nicht Teil der Summe)"
                    >
                      <input type="checkbox" checked={fxSmile} data-testid="vega-smile" onChange={(e) => setFxSmile(e.target.checked)} /> Smile (RR/BF)
                    </label>
                  )}
                  <span>{trade.type === "FxOption" ? "+1 Vol-Punkt je Verfall" : "+1 bp Normal-Vol je Bucket"}</span>
                </span>
              </h3>
              <div className="grid cols-2">
                {vegaB.map((vb) => {
                  const atm = vb.kind === "fx" ? vb.buckets.filter((b) => !b.component || b.component === "atm") : vb.buckets;
                  const smile = vb.kind === "fx" ? vb.buckets.filter((b) => b.component === "rr25" || b.component === "bf25") : [];
                  return (
                    <div key={vb.key} style={vb.dimension === "expiry-tenor" ? { gridColumn: "1 / -1" } : undefined}>
                      <div className="muted xs" style={{ marginBottom: 4 }}>
                        {vb.kind === "swaption" ? "Swaption-Cube" : vb.kind === "fx" ? "FX-Fläche" : "Caplet-Fläche"} {vb.key} · Σ{" "}
                        {fmtMoney(vb.total, s.reportingCurrency)}
                      </div>
                      {vb.dimension === "expiry-tenor" ? (
                        <VegaHeatmap report={vb} ccy={s.reportingCurrency} />
                      ) : (
                        <EChart
                          className="chart mini"
                          ariaLabel={`Vega je Verfall ${vb.key}`}
                          option={{
                            grid: { left: 52, right: 8, top: 6, bottom: 22 },
                            xAxis: { type: "category", data: atm.map((b) => b.label), axisLabel: { hideOverlap: true } },
                            yAxis: { type: "value", axisLabel: { formatter: (v: number) => fmtNum(v, 0) } },
                            tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number, s.reportingCurrency) },
                            series: [{ type: "bar", data: atm.map((b) => ({ value: b.vega, itemStyle: { color: b.vega >= 0 ? posColor() : negColor() } })) }],
                          }}
                        />
                      )}
                      {smile.length > 0 && (
                        <div className="table-scroll" style={{ maxHeight: 180, marginTop: 6 }} data-testid="vega-smile-table">
                          <table className="grid-table compact">
                            <thead>
                              <tr>
                                <th>Verfall</th>
                                <th className="num">RR 25Δ (+1 Pkt)</th>
                                <th className="num">BF 25Δ (+1 Pkt)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...new Set(smile.map((b) => b.expiry))].map((e) => {
                                const rr = smile.find((b) => b.expiry === e && b.component === "rr25");
                                const bf = smile.find((b) => b.expiry === e && b.component === "bf25");
                                return (
                                  <tr key={e} style={{ cursor: "default" }}>
                                    <td className="mono">{(rr ?? bf)?.label.replace(/ (RR|BF)25$/, "") ?? ""}</td>
                                    <td className={`num ${signClass(rr?.vega)}`}>{fmtMoney(rr?.vega)}</td>
                                    <td className={`num ${signClass(bf?.vega)}`}>{fmtMoney(bf?.vega)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {res && (
        <div className="card">
          <h3>
            Cashflows{" "}
            <span className="right muted xs">
              {res.legs.reduce((x, l) => x + l.cashflows.length, 0)} Zahlungen · <kbd>Ctrl</kbd>+<kbd>E</kbd> CSV · <kbd>↑</kbd>/<kbd>↓</kbd> Zeile ·{" "}
              <kbd>y</kbd> <kbd>y</kbd> kopieren
            </span>
          </h3>
          <div className="table-scroll" style={{ maxHeight: 360 }}>
            <table className="grid-table" data-testid="cashflow-table">
              <thead>
                <tr>
                  <th>Leg</th>
                  <th>Fixing</th>
                  <th>Start</th>
                  <th>Ende</th>
                  <th>Zahlung</th>
                  <th className="num">Nominal</th>
                  <th className="num">{isFx ? "Satz / Kurs" : "Satz"}</th>
                  <th className="num">Tagefaktor</th>
                  <th className="num">Betrag</th>
                  <th className="num">DF</th>
                  <th className="num">Barwert</th>
                  <th>Art</th>
                </tr>
              </thead>
              <tbody onKeyDown={cfNav.onKeyDown} onFocus={cfNav.onFocus}>
                {res.legs.flatMap((leg, li) =>
                  leg.cashflows.map((cf, i) => (
                    <tr
                      key={`${leg.legIndex}-${i}`}
                      {...cfNav.rowProps(
                        res.legs.slice(0, li).reduce((x, l) => x + l.cashflows.length, 0) + i,
                        res.legs.reduce((x, l) => x + l.cashflows.length, 0),
                      )}
                      style={{ cursor: "default" }}
                    >
                      <td>
                        <span className="badge">{legTypeLabel(leg.legType)}</span>
                      </td>
                      <td className="mono muted">{cf.fixingDate ? fmtDate(cf.fixingDate) : ""}</td>
                      <td className="mono">{cf.accrualStart ? fmtDate(cf.accrualStart) : ""}</td>
                      <td className="mono">{cf.accrualEnd ? fmtDate(cf.accrualEnd) : ""}</td>
                      <td className="mono">{fmtDate(cf.paymentDate)}</td>
                      <td className="num">{fmtMoney(cf.notional)}</td>
                      <td className="num">
                        {/* FX strikes / rates are prices, not percentages (N-01) */}
                        {cf.rate !== undefined ? (isFx || (cf.kind === "OptionPayoff" && isFx) ? fmtNum(cf.rate, 4) : fmtPct(cf.rate, 4)) : ""}{" "}
                        {cf.isFixed && cf.kind === "Interest" && <span className="muted xs">fix</span>}
                      </td>
                      <td className="num">{cf.accrualFactor !== undefined ? fmtNum(cf.accrualFactor, 6) : ""}</td>
                      <td className={`num ${signClass(cf.amount, 0.005)}`}>{fmtMoney(cf.amount, undefined, 2)}</td>
                      <td className="num">{fmtNum(cf.discountFactor, 6)}</td>
                      <td className={`num ${signClass(cf.presentValue, 0.005)}`}>{fmtMoney(cf.presentValue, undefined, 2)}</td>
                      <td className="muted">{t(CASHFLOW_KIND_DE, cf.kind)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="muted xs">
        Bewertungstag {fmtDate(s.valuationDate)} · Berechnung {fmtMs(res?.timingMs, 2)} · Snapshot {s.baseMarket.meta?.label}
        {s.undoStack.length > 0 && ` · ${hk("undo")} macht „${s.undoStack[s.undoStack.length - 1]!.label}“ rückgängig`}
      </div>
    </div>
  );
}

/** Expiry × tenor vega grid of a swaption cube as a CSS heatmap (coordinator item 2). */
function VegaHeatmap({ report, ccy }: { report: VegaBucketReport; ccy: string }) {
  const expiries = [...new Set(report.buckets.map((b) => b.expiry))].sort((a, b) => a - b);
  const tenors = [...new Set(report.buckets.map((b) => b.tenor ?? 0))].sort((a, b) => a - b);
  const maxAbs = Math.max(1e-9, ...report.buckets.map((b) => Math.abs(b.vega)));
  const label = (y: number) => (y < 1 ? `${Math.round(y * 12)}M` : `${y}Y`);
  const cell = (e: number, tn: number) => report.buckets.find((b) => b.expiry === e && (b.tenor ?? 0) === tn);
  return (
    <div
      className="heat"
      style={{ gridTemplateColumns: `60px repeat(${tenors.length}, 1fr)` }}
      role="table"
      aria-label={`Vega Verfall × Tenor ${report.key}`}
      data-testid="vega-heatmap"
    >
      <div role="row" style={{ display: "contents" }}>
        <div className="head" role="columnheader" aria-label="Verfall ↓ / Tenor →" />
        {tenors.map((tn) => (
          <div key={tn} className="head mono" role="columnheader">
            {label(tn)}
          </div>
        ))}
      </div>
      {expiries.map((e) => (
        <div key={e} role="row" style={{ display: "contents" }}>
          <div className="head mono" role="rowheader" style={{ textAlign: "right" }}>
            {label(e)}
          </div>
          {tenors.map((tn) => {
            const b = cell(e, tn);
            const v = b?.vega ?? 0;
            const a = Math.abs(v) / maxAbs;
            return (
              <div
                key={tn}
                className="cell"
                role="cell"
                title={b ? `${b.label}: ${fmtMoney(v, ccy)}` : ""}
                style={{
                  background: `color-mix(in srgb, var(${v >= 0 ? "--pos" : "--neg"}) ${Math.round((0.05 + 0.45 * a) * 100)}%, var(--bg-1))`,
                  opacity: Math.abs(v) < 0.5 ? 0.55 : 1,
                }}
              >
                {Math.abs(v) < 0.5 ? "·" : fmtNum(v, 0)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ParRiskPanel({
  report,
  zeroDv01,
  ccy,
  stale,
  complete,
}: {
  report: ParRiskReport;
  zeroDv01: number | undefined;
  ccy: string;
  stale: boolean;
  /** Every curve of the trade has quotes – only then is the difference to the zero DV01 a convexity / coupling effect (Markt R8-3). */
  complete: boolean;
}) {
  return (
    <div className="stack" data-testid="par-risk">
      {stale && <div className="warning">Eingaben haben sich geändert – Par-Sensitivitäten sind veraltet. Bitte neu berechnen.</div>}
      <div className="grid cols-3 kpis">
        <div className="kpi">
          <span className="label">Par-DV01 gesamt (+{report.bumpBp} bp je Quote)</span>
          <span className={`value ${signClass(report.total)}`} style={{ fontSize: 16 }}>
            {fmtMoney(report.total, ccy)}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Zero-DV01 (paralleler Shift)</span>
          <span className={`value ${signClass(zeroDv01)}`} style={{ fontSize: 16 }}>
            {fmtMoney(zeroDv01, ccy)}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Differenz</span>
          <span className="value" style={{ fontSize: 16 }}>
            {zeroDv01 !== undefined ? fmtMoney(report.total - zeroDv01, ccy) : "–"}
          </span>
          <span className="sub" data-testid="par-risk-diff-note">
            {complete ? "Konvexität der Quotes / Kurvenkopplung" : "Kurven ohne Quotes fehlen im Par-Risiko – Differenz nicht als Konvexität deutbar"}
          </span>
        </div>
      </div>
      <div className="grid cols-2">
        {report.curves.map((c) => (
          <div key={c.curveId}>
            <div className="muted xs" style={{ marginBottom: 4 }}>
              {c.curveId} · Σ {fmtMoney(c.total, ccy)}
            </div>
            <EChart
              className="chart mini"
              ariaLabel={`Par-Sensitivität je Quote ${c.curveId}`}
              option={{
                grid: { left: 52, right: 8, top: 6, bottom: 30 },
                xAxis: {
                  type: "category",
                  data: c.buckets.map((b) => b.label),
                  axisLabel: { rotate: c.buckets.length > 8 ? 40 : 0, interval: 0, hideOverlap: true, fontSize: 10 },
                },
                yAxis: { type: "value", axisLabel: { formatter: (v: number) => fmtNum(v, 0) } },
                tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number, ccy) },
                series: [{ type: "bar", data: c.buckets.map((b) => ({ value: b.delta, itemStyle: { color: b.delta >= 0 ? posColor() : negColor() } })) }],
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatIfSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <span className="muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} What-if (${unit})`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={`num ${signClass(value, 1e-9)}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <NumInput
          inline
          value={value}
          step={step}
          min={min}
          max={max}
          unit={unit}
          digits={unit === "%" ? 1 : 0}
          ariaLabel={`${label} What-if Wert`}
          onChange={onChange}
          width={92}
        />
      </span>
    </div>
  );
}
