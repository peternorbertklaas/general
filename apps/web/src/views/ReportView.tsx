import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type ReportPerspective,
  buildValuationReport,
  cashflowTable,
  computeRisk,
  computeXva,
  getDiscountCurve,
  hazardFromSpread,
  toCsv,
  toISO,
} from "@deriva/pricing-core";
import { DocumentsModal, INTERNAL_ROW, customerCostRule } from "../components/DocumentsModal.js";
import { EChart, cssVar } from "../components/EChart.js";
import { Term } from "../components/InfoTip.js";
import { NumInput } from "../components/NumInput.js";
import { keysText, HOTKEYS } from "../hotkeys/keymap.js";
import { hazardCurveFor } from "../lib/credit.js";
import { fmtBp, fmtDate, fmtMoney, fmtNum, fmtPct, signClass } from "../lib/format.js";
import { INTERPOLATION_DE, PERSPECTIVE_DE, SNAPSHOT_STATUS_DE, germanizeParagraph, t as tr, translateCoreMessage } from "../lib/i18n.js";
import { whatIfExportQuestion } from "../lib/portfolio-export.js";
import { bucketLabel, detailRows } from "../lib/metrics.js";
import { downloadText } from "../lib/portfolio-io.js";
import { tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { DEFAULT_REPORT_INPUTS, marketModified, quotesHash, reportInputsFor, selectedTrade, useStore, whatIfActive, whatIfLabel } from "../state/store.js";

const genKeys = keysText(HOTKEYS.find((h) => h.id === "report.generate")!);
const hk = (id: string) => keysText(HOTKEYS.find((h) => h.id === id) ?? { keys: "" });

export function ReportView() {
  const s = useStore(
    useShallow((st) => ({
      results: st.results,
      market: st.market,
      baseMarket: st.baseMarket,
      valuationDate: st.valuationDate,
      whatIf: st.whatIf,
      reportingCurrency: st.reportingCurrency,
      quotes: st.quotes,
      interpolation: st.interpolation,
      reportStamp: st.reportStamp,
      reportKey: st.reportKey,
      customerMode: st.customerMode,
      reportInputs: st.reportInputs,
      docKind: st.docKind,
      turnOfYear: st.turnOfYear,
      cdsCurves: st.cdsCurves,
      marketSource: st.marketSource,
      volSurfaces: st.volSurfaces,
      fxFixings: st.fxFixings,
      fxSpotOverrides: st.fxSpotOverrides,
      fixings: st.fixings,
      importedBase: st.importedBase,
    })),
  );
  const act = useStore.getState;
  const trade = useStore(selectedTrade);
  const customer = s.customerMode;
  const wiActive = whatIfActive(s.whatIf);
  const modified = marketModified(s);
  // Cost-transparency / XVA inputs live in the store per trade (N-17); customer mode forces the client perspective.
  const inputs = trade ? reportInputsFor(s, trade.id) : DEFAULT_REPORT_INPUTS;
  const setInputs = (patch: Partial<typeof inputs>) => trade && act().setReportInputs(trade.id, patch);
  const isDefault = trade ? s.reportInputs[trade.id] === undefined : true;
  /** CDS term structure of the counterparty (market view) → hazard curve for the XVA; flat hazard from the spread otherwise. */
  const cdsQuotes = trade?.counterparty ? s.cdsCurves[trade.counterparty] : undefined;
  const cptyHazardCurve = useMemo(() => {
    if (!trade || !cdsQuotes) return undefined;
    let discount;
    try {
      discount = getDiscountCurve(s.market, s.reportingCurrency);
    } catch {
      discount = undefined;
    }
    return hazardCurveFor(s.cdsCurves, trade.counterparty, inputs.recovery / 100, s.valuationDate, discount);
  }, [trade, cdsQuotes, s.cdsCurves, s.market, s.reportingCurrency, inputs.recovery, s.valuationDate]);

  /** Everything the report depends on – a stable hash of the quotes instead of a string length (N-18). */
  const inputsKey = trade
    ? `${trade.id}|${JSON.stringify(trade)}|${s.baseMarket.meta?.label}|${toISO(s.valuationDate)}|${JSON.stringify(s.whatIf)}|${s.reportingCurrency}|${JSON.stringify(inputs)}|${quotesHash(s.quotes)}|${JSON.stringify(s.interpolation)}|${JSON.stringify(s.turnOfYear)}|${JSON.stringify(cdsQuotes ?? null)}`
    : "";
  // The inputs key is captured once per stamp and kept in the store, so it survives view switches (N-18).
  const keyRef = useRef(inputsKey);
  keyRef.current = inputsKey;
  useEffect(() => {
    if (s.reportStamp && s.reportKey === null && keyRef.current) act().setReportKey(keyRef.current);
  }, [s.reportStamp, s.reportKey, act]);
  const stale = !!s.reportStamp && s.reportKey !== null && s.reportKey !== inputsKey;

  // The market goes into the report unchanged: the snapshot id is the core `marketSnapshotId` of exactly this market, no UI label is
  // hashed into it (R5-F2). "modifiziert" is shown next to the label instead; a modified market changes the id anyway (its curves differ).
  const reportMarket = s.market;
  const modifiedSuffix = modified ? " · modifiziert" : "";

  const report = useMemo(() => {
    if (!trade || !s.reportStamp) return null;
    const pricing = s.results[trade.id]?.result;
    if (!pricing || s.results[trade.id]?.error) return null;
    try {
      const risk = computeRisk(reportMarket, trade, s.reportingCurrency, { bucketed: true });
      const xva = computeXva(
        reportMarket,
        trade,
        {
          cptyHazard: hazardFromSpread(inputs.cptySpreadBp / 1e4, inputs.recovery / 100),
          cptyRecovery: inputs.recovery / 100,
          ownHazard: hazardFromSpread(inputs.ownSpreadBp / 1e4, inputs.recovery / 100),
          ownRecovery: inputs.recovery / 100,
          cptyHazardCurve,
        },
        s.reportingCurrency,
      );
      return buildValuationReport(reportMarket, trade, pricing, {
        risk,
        xva,
        transactionPrice: Number.isFinite(inputs.offerPv) ? inputs.offerPv : undefined,
        perspective: inputs.perspective,
        whatIf: wiActive ? s.whatIf : undefined,
        generatedAt: s.reportStamp,
      });
    } catch {
      return null;
    }
  }, [trade, s.results, reportMarket, s.reportingCurrency, inputs, s.reportStamp, s.whatIf, wiActive, cptyHazardCurve]);

  if (!trade) {
    return (
      <div className="card empty-state" data-testid="report-empty">
        <div className="icon">▣</div>
        <div className="title">Kein Trade ausgewählt</div>
        <div className="muted small">
          Wählen Sie im Blotter (<kbd>g</kbd> <kbd>b</kbd>) einen Trade oder legen Sie mit <kbd>Ctrl</kbd>+<kbd>K</kbd> einen neuen an.
        </div>
      </div>
    );
  }
  const badge = tradeTypeBadge(trade.type);
  const n = tradeNotional(trade);
  const pricing = s.results[trade.id]?.error ? undefined : s.results[trade.id]?.result;

  if (!s.reportStamp || !report) {
    return (
      <div className="card empty-state" data-testid="report-generate">
        <div className="icon">▣</div>
        <div className="title">
          Bewertungsreport für <span className="mono">{trade.id}</span>
        </div>
        <div className="muted small">
          Der Report erhält beim Erzeugen einen festen Zeitstempel, Snapshot-ID und Report-Hash – als Beleg reproduzierbar.
          {wiActive && (
            <>
              {" "}
              <span className="badge warn">What-if aktiv ({whatIfLabel(s.whatIf)}) – der Report wird als Stress-Bewertung gekennzeichnet</span>
            </>
          )}
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="btn primary" onClick={() => act().generateReport()} data-testid="report-generate-btn" disabled={!pricing}>
            Report erzeugen{" "}
            <span className="row" style={{ gap: 2 }}>
              {genKeys.split(" ").map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </button>
        </div>
        {!pricing && (
          <div className="warning error" style={{ marginTop: 10 }}>
            {translateCoreMessage(s.results[trade.id]?.error) || "Keine Bewertung vorhanden"}
          </div>
        )}
        {s.docKind && pricing && (
          <div className="muted xs" style={{ marginTop: 8 }}>
            Für das Dokument wird zunächst der Report erzeugt …
          </div>
        )}
        {s.docKind && !pricing && <AutoClearDoc />}
      </div>
    );
  }

  const xvaOk = report.xva && Number.isFinite(report.xva.cva);
  const ct = report.costTransparency;
  const gov = report.governance;
  const reportJson = () => {
    if (wiActive && !window.confirm(whatIfExportQuestion(whatIfLabel(s.whatIf)))) return;
    downloadText(`${trade.id}-report-${report.valuationDate}${wiActive ? "-whatif" : ""}.json`, JSON.stringify(report, null, 2), "application/json");
    act().showToast("Report als JSON exportiert");
  };

  return (
    <div className="stack report" data-testid="report">
      <div className="report-print-header print-only">
        <div>
          <b>DERIVA Bewertungsreport</b> · {trade.id} · {trade.name}
        </div>
        <div>
          Bewertungstag {fmtDate(s.valuationDate)} · erstellt {new Date(report.generatedAt).toLocaleString("de-DE")} · Snapshot {report.audit.snapshotId} (
          {report.market.label}
          {modifiedSuffix}) · Hash {report.audit.reportHash.slice(0, 16)} · {report.audit.engineVersion} · Perspektive {tr(PERSPECTIVE_DE, inputs.perspective)}
          {report.whatIf && ` · WHAT-IF ${whatIfLabel(s.whatIf)} – NICHT PRÜFUNGSFÄHIG`}
        </div>
      </div>
      <div className="card">
        <h3>
          Bewertungsreport · <span className={`badge ${badge.cls}`}>{badge.label}</span>{" "}
          <span className="mono ellipsis" title={trade.id} style={{ maxWidth: 160 }}>
            {trade.id}
          </span>
          {report.whatIf && (
            <span
              className="badge warn"
              data-testid="report-whatif-badge"
              title="Der Report wurde unter einem What-if-Shift der Marktdaten erstellt (Stress-Zahlen)"
            >
              ⚠ What-if {whatIfLabel(s.whatIf)} – nicht prüfungsfähig
            </span>
          )}
          {stale && (
            <span className="badge warn" data-testid="report-stale">
              Eingaben geändert – Report erneut erzeugen
            </span>
          )}
          <span className="right row wrap">
            <button className="btn" onClick={() => act().generateReport()} title={`Zeitstempel und Hash neu fixieren (${genKeys})`}>
              ↻ Report erzeugen
            </button>
            <button
              className="btn"
              onClick={() => act().setDoc("Termsheet")}
              data-testid="open-termsheet"
              title={`Termsheet (${keysText(HOTKEYS.find((h) => h.id === "doc.termsheet")!)})`}
            >
              Termsheet
            </button>
            <button
              className="btn"
              onClick={() => act().setDoc("Geeignetheitserklaerung")}
              data-testid="open-suitability"
              title={`Geeignetheitserklärung (${keysText(HOTKEYS.find((h) => h.id === "doc.suitability")!)})`}
            >
              Geeignetheitserklärung
            </button>
            <button
              className="btn"
              onClick={() => act().setDoc("Confirmation")}
              data-testid="open-confirmation"
              title={`Confirmation – Einzelabschluss unter DRV / ISDA (${hk("doc.confirmation")})`}
            >
              Confirmation
            </button>
            <button className="btn" onClick={() => act().setDoc("KID")} data-testid="open-kid" title={`Basisinformationsblatt PRIIPs-KID (${hk("doc.kid")})`}>
              Basisinformationsblatt (KID)
            </button>
            <button className="btn" onClick={reportJson}>
              ⤓ JSON
            </button>
            <button
              className="btn"
              onClick={() =>
                downloadText(
                  `${trade.id}-cashflows-${report.valuationDate}.csv`,
                  toCsv(cashflowTable(report.pricing), { sep: ";", decimalComma: true, bom: true }),
                  "text/csv;charset=utf-8",
                )
              }
            >
              ⤓ CSV
            </button>
            <button className="btn" onClick={() => window.print()}>
              ⎙ Drucken
            </button>
          </span>
        </h3>
        <div className="muted small" data-testid="report-header">
          {trade.name} · Nominal {fmtMoney(n.amount, n.currency)} · Bewertungstag {fmtDate(s.valuationDate)} · Reporting {report.reportingCurrency} · Snapshot{" "}
          {/* The market label of the core already carries the what-if suffix – no second "What-if" segment (R4-07). */}
          {report.market.label}
          {modifiedSuffix} · erstellt {new Date(report.generatedAt).toLocaleString("de-DE")}
          {detailRows(report.pricing.details).map((d) => ` · ${d.label} ${d.v}`)}
        </div>
        <div className="muted xs mono audit" style={{ marginTop: 6 }} data-testid="audit-hashes">
          Engine {report.audit.engineVersion} · Snapshot {report.audit.snapshotId} · Report-Hash {report.audit.reportHash.slice(0, 16)}…
          {!customer && ` · Inputs ${report.audit.inputsHash.slice(0, 16)}…`}
          {report.audit.preparedBy && ` · Bearbeiter ${report.audit.preparedBy}`}
        </div>
        <div className="row wrap xs governance" style={{ marginTop: 6, gap: 8 }} data-testid="report-governance">
          <Term id="governance">Governance</Term>
          <span className={`badge ${gov.snapshotStatus === "approved" ? "ok" : "warn"}`}>Snapshot {tr(SNAPSHOT_STATUS_DE, gov.snapshotStatus)}</span>
          <span className="muted">Quellen: {gov.inputSources.join(", ") || "–"}</span>
          <span className="muted">Modell {gov.modelVersion}</span>
          {gov.validatedBy && <span className="muted">validiert von {gov.validatedBy}</span>}
          {gov.snapshotStatus !== "approved" && (
            <span className="muted">· ohne unabhängige Validierung (MaRisk AT 4.3.5, IFRS 13 / IDW RS HFA 47) nur indikativ</span>
          )}
        </div>
      </div>

      <div className={`grid kpis ${customer ? "cols-2" : "cols-4"}`}>
        <div className="card kpi">
          <span className="label">Fair Value (risikofrei)</span>
          <span className={`value ${signClass(report.fairValue.riskFree)}`}>{fmtMoney(report.fairValue.riskFree)}</span>
          <span className="sub">OIS-diskontiert, ohne Kreditrisiko</span>
        </div>
        {!customer && (
          <div className="card kpi">
            <span className="label">
              <Term id="cva">CVA</Term>
            </span>
            <span className={`value ${signClass(-report.fairValue.cva)}`}>{xvaOk ? fmtMoney(-report.fairValue.cva) : "n/a"}</span>
            <span className="sub" data-testid="cva-sub">
              {cptyHazardCurve
                ? `CDS-Termstruktur ${trade.counterparty} (${cptyHazardCurve.times.length} Pillars)`
                : `Kontrahent ${fmtNum(inputs.cptySpreadBp, 0)} bp`}{" "}
              · LGD {fmtNum(100 - inputs.recovery, 0)} %
            </span>
          </div>
        )}
        {!customer && (
          <div className="card kpi">
            <span className="label">
              <Term id="dva">DVA</Term>
            </span>
            <span className={`value ${signClass(report.fairValue.dva)}`}>{xvaOk ? fmtMoney(report.fairValue.dva) : "n/a"}</span>
            <span className="sub">eigenes Risiko {fmtNum(inputs.ownSpreadBp, 0)} bp</span>
          </div>
        )}
        <div className="card kpi">
          <span className="label">
            <Term id="ifrs13">Fair Value (bilateral, IFRS 13 Level {report.fairValue.ifrs13Level})</Term>
          </span>
          <span className={`value ${signClass(report.fairValue.adjusted)}`}>{fmtMoney(report.fairValue.adjusted)}</span>
          {/* Customer mode hides the internal decomposition (R5-07) */}
          <span className="sub">{customer ? "inkl. Kontrahentenrisiko" : "= risikofrei − CVA + DVA"}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>
            Kostentransparenz (MiFID II / BGH-Rechtsprechung)
            <span className="right row">
              {!isDefault && (
                <button
                  className="btn ghost xs"
                  onClick={() => act().resetReportInputs(trade.id)}
                  title="Transaktionspreis, Spreads, Recovery und Perspektive auf Standardwerte"
                  data-testid="report-inputs-reset"
                >
                  Standardwerte
                </button>
              )}
            </span>
          </h3>
          <div className="form">
            <div className="field">
              <label>
                <Term id="perspective">Perspektive</Term>
              </label>
              <div className="seg" role="group" aria-label="Perspektive" data-testid="perspective-seg">
                {(["Kunde", "Bank"] as ReportPerspective[]).map((p) => (
                  <button
                    key={p}
                    className={inputs.perspective === p ? "active" : ""}
                    aria-pressed={inputs.perspective === p}
                    disabled={customer && p === "Bank"}
                    onClick={() => setInputs({ perspective: p })}
                    title={p === "Kunde" ? "Das Geschäft ist die Position des Kunden (Beispielportfolio)" : "Buchung aus Sicht der Bank"}
                  >
                    {tr(PERSPECTIVE_DE, p)}
                  </button>
                ))}
              </div>
              <span className="print-only">{tr(PERSPECTIVE_DE, inputs.perspective)}</span>
            </div>
            <div className="field">
              <label>Transaktionspreis / Upfront ({inputs.perspective === "Kunde" ? "Kunde zahlt +" : "Bank zahlt +"})</label>
              <NumInput
                value={inputs.offerPv}
                step={1000}
                unit={s.reportingCurrency}
                ariaLabel="Transaktionspreis"
                onChange={(v) => setInputs({ offerPv: v })}
                testId="offer-pv"
              />
            </div>
            {!customer && (
              <>
                <div className="field">
                  <label>Kontrahenten-Spread{cptyHazardCurve ? " (flach, überschrieben)" : ""}</label>
                  <NumInput
                    value={inputs.cptySpreadBp}
                    step={5}
                    min={0}
                    unit="bp"
                    ariaLabel="Kontrahenten-Spread"
                    disabled={!!cptyHazardCurve}
                    onChange={(v) => setInputs({ cptySpreadBp: v })}
                  />
                  {cptyHazardCurve && (
                    <span className="field-msg muted">
                      CDS-Termstruktur aus der Marktansicht ({cptyHazardCurve.times.length} Pillars) ersetzt den flachen Spread.
                    </span>
                  )}
                </div>
                <div className="field">
                  <label>Eigener Spread</label>
                  <NumInput value={inputs.ownSpreadBp} step={5} min={0} unit="bp" ariaLabel="Eigener Spread" onChange={(v) => setInputs({ ownSpreadBp: v })} />
                </div>
                <div className="field">
                  <label>Recovery</label>
                  <NumInput
                    value={inputs.recovery}
                    step={5}
                    min={0}
                    max={100}
                    unit="%"
                    digits={0}
                    ariaLabel="Recovery"
                    onChange={(v) => setInputs({ recovery: v })}
                  />
                </div>
              </>
            )}
          </div>
          {ct && (
            <table className="grid-table" style={{ marginTop: 10 }} data-testid="cost-table" aria-label="Kostentransparenz">
              <tbody>
                <tr>
                  <td className="muted">Fair Value (bilateral, Sicht {tr(PERSPECTIVE_DE, ct.perspective)})</td>
                  <td className={`num ${signClass(ct.fairValue)}`}>{fmtMoney(ct.fairValue)}</td>
                </tr>
                <tr>
                  <td className="muted">Transaktionspreis</td>
                  <td className="num">{fmtMoney(ct.transactionPrice)}</td>
                </tr>
                <tr>
                  <td className="muted">Anfänglicher Marktwert (Kundensicht)</td>
                  <td className={`num ${signClass(ct.initialMarketValue)}`}>{fmtMoney(ct.initialMarketValue)}</td>
                </tr>
                {!customer && (
                  <>
                    <tr>
                      <td className="muted">Marge der Bank</td>
                      <td className={`num ${signClass(ct.bankMargin)}`}>{fmtMoney(ct.bankMargin)}</td>
                    </tr>
                    <tr>
                      <td className="muted">Marge in bp des Nominals</td>
                      <td className="num">{fmtNum(ct.marginBp, 1)} bp</td>
                    </tr>
                    <tr>
                      <td className="muted">Marge in % des Nominals</td>
                      <td className="num">{fmtNum(ct.marginPct, 3)} %</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
          {ct && (
            <div className="muted xs" style={{ marginTop: 8 }} data-testid="sign-rule">
              {/* Customer mode: the bank-margin formula stays in the auditor report, the client reads the initial-market-value rule (R5-07) */}
              {customer ? customerCostRule(germanizeParagraph(ct.signRule)) : germanizeParagraph(ct.signRule)}
            </div>
          )}
          <div className="muted xs" style={{ marginTop: 8 }}>
            Nach BGH XI ZR 33/10 und XI ZR 378/13 ist der anfängliche negative Marktwert dem Kunden einschließlich seiner Höhe offenzulegen. Der Ausweis oben
            ergibt sich aus Fair Value abzüglich Transaktionspreis.
            {!customer &&
              " Hinweis: Der Report-Hash des Kerns deckt die Kostentransparenz derzeit nicht ab – Transaktionspreis und Perspektive sind im Inputs-Schlüssel dieser Ansicht enthalten."}
          </div>
        </div>

        <div className="card">
          <h3>
            <Term id="epe">Erwartetes Exposure (EPE / ENE, diskontiert)</Term>
          </h3>
          {xvaOk && report.xva!.profile.length > 1 ? (
            <EChart
              ariaLabel="Erwartetes positives und negatives Exposure über die Laufzeit"
              option={{
                legend: { top: 0, textStyle: { color: cssVar("--fg-2") } },
                tooltip: { trigger: "axis", valueFormatter: (v) => fmtMoney(v as number, s.reportingCurrency) },
                xAxis: { type: "category", data: report.xva!.profile.map((p) => `${fmtNum(p.years, 1)} J`), axisLabel: { hideOverlap: true } },
                yAxis: { type: "value", axisLabel: { formatter: (v: number) => (Math.abs(v) >= 1000 ? `${fmtNum(v / 1000, 0)}k` : fmtNum(v, 0)) } },
                series: [
                  { name: "EPE", type: "line", areaStyle: { opacity: 0.25 }, data: report.xva!.profile.map((p) => Math.round(p.epe)), showSymbol: false },
                  { name: "ENE", type: "line", areaStyle: { opacity: 0.25 }, data: report.xva!.profile.map((p) => -Math.round(p.ene)), showSymbol: false },
                ],
              }}
            />
          ) : (
            <div className="empty">{report.xva?.warnings.map(translateCoreMessage).join(" ") || "Kein Exposure-Profil"}</div>
          )}
          {!customer && (
            <div className="muted xs" data-testid="xva-method">
              Methode: {translateCoreMessage(report.xva?.method)}
            </div>
          )}
          {!customer && report.xva?.warnings.length ? <div className="muted xs">{report.xva.warnings.map(translateCoreMessage).join(" · ")}</div> : null}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Sensitivitäten</h3>
          <table className="grid-table" aria-label="Sensitivitäten">
            <tbody>
              <tr>
                <td className="muted">
                  <Term id="dv01">DV01 (parallel, alle Kurven)</Term>
                </td>
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
                  <td className="muted">FX-Delta 1 % {bucketLabel(k)}</td>
                  <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                </tr>
              ))}
              {Object.entries(report.risk?.vega ?? {}).map(([k, v]) => (
                <tr key={k}>
                  <td className="muted">Vega {bucketLabel(k)}</td>
                  <td className={`num ${signClass(v)}`}>{fmtMoney(v)}</td>
                </tr>
              ))}
              <tr>
                <td className="muted">
                  <Term id="theta">Theta (1 Tag)</Term>
                </td>
                <td className={`num ${signClass(report.risk?.theta)}`}>{fmtMoney(report.risk?.theta)}</td>
              </tr>
              <tr>
                <td className="muted">
                  <Term id="gamma">Gamma (1 bp²)</Term>
                </td>
                <td className="num">{fmtMoney(report.risk?.gamma, undefined, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Methodik & Marktdaten</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }} data-testid="methodology">
            {/* Customer mode: internal methodology lines (margin formula, CVA/DVA, bilateral view) are filtered like in the documents (R5-07) */}
            {report.methodology
              .map((m) => germanizeParagraph(translateCoreMessage(m)))
              .filter((m) => !customer || !INTERNAL_ROW.test(m))
              .map((m) => (
                <li key={m}>{m}</li>
              ))}
          </ul>
          {(!customer || !INTERNAL_ROW.test(report.fairValue.rationale)) && (
            <div className="muted xs" style={{ marginTop: 10 }}>
              {germanizeParagraph(report.fairValue.rationale)}
            </div>
          )}
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="grid-table" data-testid="market-table">
              <thead>
                <tr>
                  <th>Kurve</th>
                  <th className="num">Pillars</th>
                  <th>Interpolation</th>
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
                      <td className="muted xs">
                        {c.interpolation ? tr(INTERPOLATION_DE, c.interpolation) : "–"}
                        {s.interpolation[c.id] && (
                          <span className="badge warn" style={{ marginLeft: 4 }}>
                            Override
                          </span>
                        )}
                      </td>
                      <td className="num">{fmtPct(z(2), 3)}</td>
                      <td className="num">{fmtPct(z(10), 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted xs" style={{ marginTop: 6 }}>
            FX-Spots:{" "}
            {Object.entries(report.market.fxSpots)
              .map(([k, v]) => `${k} ${fmtNum(v, 4)}`)
              .join(" · ")}{" "}
            · Stückzinsen {fmtMoney(report.pricing.accrued)} · Restlaufzeit bis {fmtDate(report.pricing.analytics.maturity as number | undefined)}
            {!customer && ` · Hazard ≈ ${fmtBp(hazardFromSpread(inputs.cptySpreadBp / 1e4, inputs.recovery / 100), 0)}`}
          </div>
        </div>
      </div>
      {s.docKind && pricing && <DocumentsModal kind={s.docKind} trade={trade} pricing={pricing} report={report} onClose={() => act().setDoc(null)} />}
    </div>
  );
}

/** A document was requested for a trade that cannot be priced – clear the request and tell the user. */
function AutoClearDoc() {
  useEffect(() => {
    const st = useStore.getState();
    st.setDoc(null);
    st.showToast("Dokument nicht möglich – der Trade ist nicht bewertbar");
  }, []);
  return null;
}
