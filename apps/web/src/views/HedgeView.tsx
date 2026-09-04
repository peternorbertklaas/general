import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type AccountingFramework,
  type DollarOffsetResult,
  type EffectivenessMethod,
  type HedgeDesignation,
  type HedgeEffectivenessReport,
  type HedgeRelationship,
  type HedgeType,
  type HedgedItemAmortisation,
  type HedgedItemKind,
  type Trade,
  addTenor,
  hedgeEffectivenessReport,
  hypotheticalDerivative,
} from "@deriva/pricing-core";
import { DateInput } from "../components/DateInput.js";
import { EChart, cssVar, negColor, posColor } from "../components/EChart.js";
import { Term } from "../components/InfoTip.js";
import { NumInput } from "../components/NumInput.js";
import { fmtDate, fmtMoney, fmtNum, fmtPct, signClass } from "../lib/format.js";
import { hedgeDocMarkdown } from "../lib/hedge-doc.js";
import { TRADE_TYPE_DE, germanizeText, translatePricingError } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { isOption, tradeMaturity, tradeNotional, tradeTypeBadge } from "../lib/trade-ops.js";
import { hasErrors, validateTrade } from "../lib/validate-trade.js";
import { buildMarket, selectedTrade, useStore } from "../state/store.js";

const KINDS: { v: HedgedItemKind; l: string }[] = [
  { v: "FloatingRateLoan", l: "Variabel verzinster Kredit" },
  { v: "FixedRateLoan", l: "Festzinskredit" },
  { v: "ForecastFxCashflow", l: "Erwarteter FX-Cashflow" },
  { v: "FxReceivable", l: "FX-Forderung / -Verbindlichkeit" },
];
const TYPES: { v: HedgeType; l: string }[] = [
  { v: "CashFlowHedge", l: "Cash Flow Hedge" },
  { v: "FairValueHedge", l: "Fair Value Hedge" },
];
const METHODS: { v: EffectivenessMethod; l: string }[] = [
  { v: "DollarOffset", l: "Dollar-Offset" },
  { v: "Regression", l: "Regression" },
  { v: "CriticalTerms", l: "Critical-Terms-Match" },
];
const FRAMEWORKS: { v: AccountingFramework; l: string }[] = [
  { v: "IFRS9", l: "IFRS 9" },
  { v: "HGB", l: "HGB § 254" },
];
const DESIGNATIONS: { v: HedgeDesignation; l: string }[] = [
  { v: "FullFairValue", l: "Voller Fair Value" },
  { v: "IntrinsicValue", l: "Innerer Wert (Zeitwert → OCI, Cost of Hedging)" },
];
type AmortSel = "none" | HedgedItemAmortisation["type"];
const AMORTISATIONS: { v: AmortSel; l: string }[] = [
  { v: "none", l: "endfällig (kein Tilgungsplan)" },
  { v: "Linear", l: "Linear" },
  { v: "Annuity", l: "Annuität" },
  { v: "Custom", l: "Custom (Nominalverlauf)" },
];
const CCYS = ["EUR", "USD", "GBP", "CHF", "JPY"];
const INDICES = ["EURIBOR-3M", "EURIBOR-6M", "ESTR", "SOFR", "SONIA", "SARON", "TONA"];
const TERM_DE: Record<string, string> = {
  notional: "Nominal",
  currency: "Währung",
  effectiveDate: "Startdatum",
  maturityDate: "Fälligkeit",
  index: "Index",
  notionalSchedule: "Nominalverlauf",
};

/** Notional schedule of the hedging instrument's first leg (amortising swaps / CCS), undefined for bullet instruments. */
export function instrumentNotionalSchedule(t: Trade): { date: number; notional: number }[] | undefined {
  if (t.type !== "InterestRateSwap" && t.type !== "CrossCurrencySwap") return undefined;
  const s = t.legs[0]?.notionalSchedule;
  return s && s.length > 0 ? s : undefined;
}

/**
 * Default designation date: the instrument's effective date when it lies in
 * the past (the hedge was designated at inception), otherwise one period
 * (3 months) before the valuation date – never the valuation date itself,
 * which would make the cumulative test trivially "nicht beurteilbar" (N-20).
 */
export function defaultDesignationDate(t: Trade, valuationDate: number): number {
  let eff: number | undefined;
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      eff = t.legs[0]?.effectiveDate;
      break;
    case "CapFloor":
      eff = t.effectiveDate;
      break;
    case "Swaption":
      eff = t.tradeDate;
      break;
    case "FRA":
      eff = t.tradeDate ?? t.startDate;
      break;
    default:
      eff = t.tradeDate;
  }
  if (eff !== undefined && eff < valuationDate) return eff;
  return addTenor(valuationDate, "-3M");
}

/** Sensible defaults derived from the hedging instrument. */
export function defaultRelationship(t: Trade, valuationDate: number): HedgeRelationship {
  const n = tradeNotional(t);
  const designationDate = defaultDesignationDate(t, valuationDate);
  const base: HedgeRelationship = {
    id: `HR-${t.id}`,
    name: `Sicherungsbeziehung ${t.id}`,
    type: "CashFlowHedge",
    hedgedItem: {
      description: "",
      currency: n.currency,
      notional: Math.abs(n.amount),
      kind: "FloatingRateLoan",
      effectiveDate: designationDate,
      maturityDate: tradeMaturity(t),
    },
    hedgingInstrumentId: t.id,
    designationDate,
    hedgeRatio: 1,
    method: "DollarOffset",
    accountingFramework: "IFRS9",
  };
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      const fl = t.legs.find((l): l is Extract<typeof l, { type: "Float" }> => l.type === "Float");
      const fixed = t.legs.find((l) => l.type === "Fixed");
      base.hedgedItem = {
        ...base.hedgedItem,
        description: "Variabel verzinster Betriebsmittelkredit",
        index: fl?.index ?? "EURIBOR-6M",
        effectiveDate: t.legs[0]!.effectiveDate,
        maturityDate: t.legs[0]!.terminationDate,
      };
      if (fixed && fixed.payReceive === "Receive") {
        base.type = "FairValueHedge";
        base.hedgedItem.kind = "FixedRateLoan";
        base.hedgedItem.fixedRate = (fixed as { rate: number }).rate;
        base.hedgedItem.description = "Festzinsdarlehen (Fair-Value-Absicherung)";
      }
      return base;
    }
    case "FxForward": {
      const foreign = t.buyCurrency === "EUR" ? t.sellCurrency : t.buyCurrency;
      const pair = `EUR${foreign}`;
      const amount = t.sellCurrency === foreign ? t.sellAmount : -t.buyAmount;
      base.hedgedItem = {
        description: `Erwarteter ${foreign}-${amount >= 0 ? "Umsatz" : "Einkauf"}`,
        currency: foreign,
        notional: Math.abs(amount),
        amount,
        kind: "ForecastFxCashflow",
        fxPair: pair,
        effectiveDate: designationDate,
        maturityDate: t.deliveryDate,
      };
      return base;
    }
    case "FxOption": {
      const foreign = t.pair.slice(0, 3) === "EUR" ? t.pair.slice(3) : t.pair.slice(0, 3);
      base.hedgedItem = {
        description: `Erwarteter ${foreign}-Cashflow`,
        currency: foreign,
        notional: t.notional,
        amount: t.notional,
        kind: "ForecastFxCashflow",
        fxPair: `EUR${foreign}`,
        effectiveDate: designationDate,
        maturityDate: t.deliveryDate,
      };
      return base;
    }
    case "CapFloor":
      base.hedgedItem = {
        ...base.hedgedItem,
        description: "Variabel verzinster Kredit (Zinsobergrenze)",
        index: t.index,
        effectiveDate: t.effectiveDate,
        maturityDate: t.terminationDate,
      };
      return base;
    default:
      return base;
  }
}

function DateField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <DateInput value={value} ariaLabel={label} onChange={onChange} />
    </div>
  );
}

/** Band indicator: 80–125 % corridor with the ratio marker. */
function BandBar({ r }: { r: DollarOffsetResult }) {
  const lo = 0.5;
  const hi = 1.6;
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="band" aria-hidden="true">
      <div className="band-ok" style={{ left: pos(r.band[0]), width: `calc(${pos(r.band[1])} - ${pos(r.band[0])})` }} />
      {r.ratio !== undefined && <div className={`band-marker ${r.effective ? "ok" : "bad"}`} style={{ left: pos(r.ratio) }} />}
    </div>
  );
}

function DollarOffsetCard({ title, r, ccy }: { title: string; r: DollarOffsetResult | undefined; ccy: string }) {
  if (!r) return null;
  return (
    <div className="card" data-testid={`do-${title}`}>
      <h3>
        {title}
        <span className="right">
          <span className={`badge ${!r.assessable ? "" : r.effective ? "ok" : "warn"}`}>
            {!r.assessable ? "nicht beurteilbar" : r.effective ? "im Korridor" : "außerhalb"}
          </span>
        </span>
      </h3>
      <div className="kpi">
        <span className="label">Dollar-Offset-Ratio</span>
        <span className="value" style={{ fontSize: 20 }}>
          {r.ratio !== undefined ? fmtPct(r.ratio, 1) : "–"}
        </span>
        <span className="sub">
          Korridor {fmtPct(r.band[0], 0)} – {fmtPct(r.band[1], 0)}
        </span>
      </div>
      <BandBar r={r} />
      <div className="table-scroll">
        <table className="grid-table compact" style={{ marginTop: 6 }} aria-label={`Dollar-Offset ${title}`}>
          <tbody>
            <tr style={{ cursor: "default" }}>
              <td className="muted">ΔPV Sicherungsinstrument</td>
              <td className={`num ${signClass(r.deltaHedge)}`}>{fmtMoney(r.deltaHedge, ccy)}</td>
            </tr>
            <tr style={{ cursor: "default" }}>
              <td className="muted">ΔPV hypothetisches Derivat</td>
              <td className={`num ${signClass(r.deltaHypothetical)}`}>{fmtMoney(r.deltaHypothetical, ccy)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hypoSummary(t: Trade): string[] {
  const out: string[] = [];
  switch (t.type) {
    case "InterestRateSwap":
      for (const l of t.legs)
        out.push(
          `${l.payReceive === "Pay" ? "Zahlen" : "Erhalten"} ${l.type === "Fixed" ? `fest ${fmtPct((l as { rate: number }).rate, 4)}` : `variabel ${(l as { index: string }).index}`} · ${fmtMoney(l.notional, l.currency)} · ${fmtDate(l.effectiveDate)} – ${fmtDate(l.terminationDate)} · ${l.frequency} ${l.dayCount}`,
        );
      break;
    case "FxForward":
      out.push(
        `Kauf ${fmtMoney(t.buyAmount, t.buyCurrency)} gegen Verkauf ${fmtMoney(t.sellAmount, t.sellCurrency)} · Lieferung ${fmtDate(t.deliveryDate)} · Kurs ${fmtNum(t.buyCurrency === "EUR" ? t.sellAmount / t.buyAmount : t.buyAmount / t.sellAmount, 4)}`,
      );
      break;
    default:
      out.push(`${TRADE_TYPE_DE[t.type] ?? t.type} ${t.id}`);
  }
  return out;
}

export function HedgeView() {
  const s = useStore(
    useShallow((st) => ({
      hedgeRelationships: st.hedgeRelationships,
      valuationDate: st.valuationDate,
      market: st.market,
      baseMarket: st.baseMarket,
      quotes: st.quotes,
      interpolation: st.interpolation,
      turnOfYear: st.turnOfYear,
      customerMode: st.customerMode,
    })),
  );
  const act = useStore.getState;
  const trade = useStore(selectedTrade);
  const stored = trade ? s.hedgeRelationships[trade.id] : undefined;
  const rel = useMemo(() => (trade ? (stored ?? defaultRelationship(trade, s.valuationDate)) : null), [trade, stored, s.valuationDate]);
  const [simulateDesignation, setSimulateDesignation] = useState(true);
  /** Freeze the option vol of the hypothetical at designation (IFRS 9 B6.5.5 – vol changes are not hedged-risk ineffectiveness). */
  const [freezeVol, setFreezeVol] = useState(false);
  const [hypo, setHypo] = useState<{ tradeId: string; trade: Trade } | null>(null);
  const [report, setReport] = useState<{ tradeId: string; key: string; r: HedgeEffectivenessReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Everything the effectiveness test depends on – shown as "veraltet" when it changes after the test (N-20). */
  const testKey =
    trade && rel
      ? `${trade.id}|${JSON.stringify(rel)}|${JSON.stringify(trade)}|${s.baseMarket.meta?.label}|${s.valuationDate}|${simulateDesignation}|${freezeVol}`
      : "";

  if (!trade || !rel) {
    return (
      <div className="card empty-state" data-testid="hedge-empty">
        <div className="icon">⛨</div>
        <div className="title">Kein Sicherungsinstrument ausgewählt</div>
        <div className="muted small">
          Wählen Sie im Blotter (<kbd>g</kbd> <kbd>b</kbd>) den Swap, Cap oder FX-Forward, der das Grundgeschäft absichert.
        </div>
      </div>
    );
  }
  const badge = tradeTypeBadge(trade.type);
  const upd = (patch: Partial<HedgeRelationship>) => act().setHedgeRelationship({ ...rel, ...patch });
  const updItem = (patch: Partial<HedgeRelationship["hedgedItem"]>) => upd({ hedgedItem: { ...rel.hedgedItem, ...patch } });
  const isFx = rel.hedgedItem.kind === "ForecastFxCashflow" || rel.hedgedItem.kind === "FxReceivable";
  const ccy = trade.type.startsWith("Fx") ? "EUR" : rel.hedgedItem.currency;
  const item = rel.hedgedItem;
  const amortSel: AmortSel = item.notionalSchedule?.length ? "Custom" : (item.amortisation?.type ?? "none");
  const instrSchedule = instrumentNotionalSchedule(trade);
  const setAmortisation = (v: AmortSel) => {
    const finalNotional = item.amortisation?.finalNotional ?? 0;
    if (v === "none") updItem({ amortisation: undefined, notionalSchedule: undefined });
    else if (v === "Linear") updItem({ amortisation: { type: "Linear", finalNotional }, notionalSchedule: undefined });
    else if (v === "Annuity")
      updItem({
        amortisation: { type: "Annuity", finalNotional, loanRate: item.amortisation?.loanRate ?? item.fixedRate ?? 0.03 },
        notionalSchedule: undefined,
      });
    else {
      const schedule = item.notionalSchedule ?? instrSchedule ?? [{ date: item.effectiveDate, notional: item.notional }];
      updItem({ amortisation: { type: "Custom", schedule }, notionalSchedule: schedule });
    }
  };
  const takeInstrumentSchedule = () => {
    if (!instrSchedule) return;
    updItem({ notionalSchedule: instrSchedule, amortisation: { type: "Custom", schedule: instrSchedule }, notional: instrSchedule[0]!.notional });
    act().showToast(`Tilgungsplan übernommen (${instrSchedule.length} Perioden)`);
  };

  /**
   * An instrument with validation errors is never sent to the core (R4-05): the German
   * validator messages are shown instead of the core's English "Invalid trade …" text.
   */
  const tradeIssues = validateTrade(trade);
  const tradeInvalid = hasErrors(tradeIssues);
  const invalidMessage = tradeInvalid
    ? `Sicherungsinstrument nicht bewertbar – ${tradeIssues
        .filter((i) => i.level === "error")
        .map((i) => i.msg)
        .join("; ")}. Bitte den Trade im Pricing korrigieren.`
    : null;
  const buildHypo = () => {
    if (invalidMessage) {
      setError(invalidMessage);
      return;
    }
    try {
      const h = hypotheticalDerivative(s.market, rel, trade);
      setHypo({ tradeId: trade.id, trade: h });
      setError(null);
    } catch (e) {
      setError(translatePricingError(e));
    }
  };
  const runTest = () => {
    if (invalidMessage) {
      setError(invalidMessage);
      return;
    }
    try {
      const designationCtx = simulateDesignation ? buildMarket(rel.designationDate, s.quotes, s.interpolation, s.turnOfYear) : undefined;
      const r = hedgeEffectivenessReport(s.market, rel, trade, {
        designationCtx,
        reportingCurrency: ccy,
        freezeDesignationVol: freezeVol && isOption(trade) && !!designationCtx,
      });
      setReport({ tradeId: trade.id, key: testKey, r });
      setHypo({ tradeId: trade.id, trade: r.hypotheticalDerivative.trade });
      setError(null);
    } catch (e) {
      setError(translatePricingError(e));
    }
  };
  const rep = report && report.tradeId === trade.id ? report.r : null;
  const stale = !!rep && report!.key !== testKey;
  const hy = hypo && hypo.tradeId === trade.id ? hypo.trade : null;
  const reg = rep?.regression;
  const regLine =
    reg && reg.slope !== undefined && reg.intercept !== undefined && reg.points.length > 0
      ? (() => {
          const xs = reg.points.map((p) => p.deltaHypothetical);
          const x0 = Math.min(...xs);
          const x1 = Math.max(...xs);
          return [
            [x0, reg.intercept + reg.slope * x0],
            [x1, reg.intercept + reg.slope * x1],
          ];
        })()
      : null;
  const exportDoc = () => {
    downloadText(
      `${trade.id}-hedge-dokumentation.md`,
      hedgeDocMarkdown(rel, trade, rep, { valuationDate: s.valuationDate, ccy, stale }),
      "text/markdown;charset=utf-8",
    );
    act().showToast(stale ? "Sicherungsdokumentation exportiert – mit Vermerk „Ergebnis veraltet“" : "Sicherungsdokumentation als Markdown exportiert");
  };
  const printDoc = () => window.print();
  /** "Zurücksetzen" asks first and can be undone (R3-F4). */
  const resetDoc = () => {
    if (
      !window.confirm(
        `Gespeicherte Sicherungsdokumentation für ${trade.id} verwerfen? Hedge Ratio, Grundgeschäft und Designation gehen auf die Standardwerte zurück.`,
      )
    )
      return;
    act().removeHedgeRelationship(trade.id);
    act().showToast(`Sicherungsdokumentation ${trade.id} verworfen`, { action: { label: "Rückgängig", run: () => act().undo() } });
  };

  return (
    <div className="stack hedge" data-testid="hedge-view">
      <div className="report-print-header print-only">
        <div>
          <b>DERIVA Sicherungsdokumentation</b> · {rel.name} · {trade.id}
        </div>
        <div>
          Bewertungstag {fmtDate(s.valuationDate)} · Designation {fmtDate(rel.designationDate)} · {TYPES.find((t) => t.v === rel.type)?.l} ·{" "}
          {FRAMEWORKS.find((f) => f.v === rel.accountingFramework)?.l} · {METHODS.find((m) => m.v === rel.method)?.l}
          {stale && " · ERGEBNIS VERALTET"}
        </div>
      </div>
      <div className="card">
        <h3>
          Sicherungsbeziehung · <span className={`badge ${badge.cls}`}>{badge.label}</span>{" "}
          <span className="mono ellipsis" title={trade.id} style={{ maxWidth: 160 }}>
            {trade.id}
          </span>
          <span className="right row wrap">
            {stored && (
              <button
                className="btn ghost"
                onClick={resetDoc}
                title="Gespeicherte Dokumentation verwerfen (mit Rückfrage, rückgängig über Ctrl+Z)"
                data-testid="hedge-reset"
              >
                Zurücksetzen
              </button>
            )}
            <button
              className="btn ghost"
              onClick={exportDoc}
              title="Sicherungsdokumentation als Markdown (IFRS 9 6.4.1 / IDW RS HFA 35)"
              data-testid="hedge-export"
            >
              ⤓ Dokumentation
            </button>
            <button className="btn ghost" onClick={printDoc} title="Sicherungsdokumentation drucken (A4)" data-testid="hedge-print">
              ⎙ Drucken
            </button>
            <button className="btn" onClick={buildHypo} data-testid="hedge-hypo" disabled={tradeInvalid} title={invalidMessage ?? undefined}>
              Hypothetisches Derivat erzeugen
            </button>
            <button className="btn primary" onClick={runTest} data-testid="hedge-test" disabled={tradeInvalid} title={invalidMessage ?? undefined}>
              {stale ? "Erneut testen" : "Effektivität testen"}
            </button>
          </span>
        </h3>
        <div className="form">
          <div className="field span-2">
            <label>Bezeichnung</label>
            <input value={rel.name} aria-label="Bezeichnung der Sicherungsbeziehung" onChange={(e) => upd({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>Art</label>
            <select value={rel.type} aria-label="Hedge-Typ" onChange={(e) => upd({ type: e.target.value as HedgeType })}>
              {TYPES.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Rechnungslegung</label>
            <select
              value={rel.accountingFramework}
              aria-label="Rechnungslegung"
              onChange={(e) => upd({ accountingFramework: e.target.value as AccountingFramework })}
            >
              {FRAMEWORKS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>
              <Term id="dollarOffset">Methode</Term>
            </label>
            <select value={rel.method} aria-label="Effektivitätsmethode" onChange={(e) => upd({ method: e.target.value as EffectivenessMethod })}>
              {METHODS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </div>
          {isOption(trade) && (
            <div className="field span-2">
              <label>Designation der Option (IFRS 9 6.5.15)</label>
              <select
                value={rel.designation ?? "FullFairValue"}
                aria-label="Designation"
                data-testid="hedge-designation"
                onChange={(e) => upd({ designation: e.target.value as HedgeDesignation })}
              >
                {DESIGNATIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DateField label="Designationsdatum" value={rel.designationDate} onChange={(v) => upd({ designationDate: v })} />
          <div className="field">
            <label>
              <Term id="hedgeRatio">Hedge Ratio</Term>
            </label>
            <NumInput
              value={rel.hedgeRatio ?? 1}
              scale={100}
              step={1}
              min={0.01}
              max={200}
              unit="%"
              digits={2}
              ariaLabel="Hedge Ratio"
              onChange={(v) => upd({ hedgeRatio: v })}
            />
          </div>
          <div className="field span-2">
            <label>Kumulativer Test</label>
            <label className="check">
              <input type="checkbox" checked={simulateDesignation} onChange={(e) => setSimulateDesignation(e.target.checked)} /> Designationsmarkt simulieren
              (Sample-Markt am Designationsdatum {fmtDate(rel.designationDate)})
            </label>
            {isOption(trade) && (
              <label
                className="check"
                title="Das hypothetische Derivat behält die Volatilität des Designationsmarkts (Vol-Override); Vol-Änderungen zählen dann nicht als Ineffektivität (IFRS 9 B6.5.5)"
              >
                <input
                  type="checkbox"
                  checked={freezeVol}
                  disabled={!simulateDesignation}
                  data-testid="hedge-freeze-vol"
                  onChange={(e) => setFreezeVol(e.target.checked)}
                />{" "}
                Vol bei Designation einfrieren
              </label>
            )}
          </div>
        </div>
        <h3 style={{ marginTop: 14 }}>Grundgeschäft</h3>
        <div className="form">
          <div className="field">
            <label>Art</label>
            <select value={rel.hedgedItem.kind} aria-label="Art des Grundgeschäfts" onChange={(e) => updItem({ kind: e.target.value as HedgedItemKind })}>
              {KINDS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </div>
          <div className="field span-2">
            <label>Beschreibung</label>
            <input value={rel.hedgedItem.description} aria-label="Beschreibung Grundgeschäft" onChange={(e) => updItem({ description: e.target.value })} />
          </div>
          <div className="field">
            <label>Währung</label>
            <select value={rel.hedgedItem.currency} aria-label="Währung Grundgeschäft" onChange={(e) => updItem({ currency: e.target.value })}>
              {[...new Set([...CCYS, rel.hedgedItem.currency])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nominal</label>
            <NumInput
              value={rel.hedgedItem.notional}
              step={100000}
              min={0}
              unit={rel.hedgedItem.currency}
              ariaLabel="Nominal Grundgeschäft"
              onChange={(v) => updItem({ notional: v })}
            />
          </div>
          {rel.hedgedItem.kind === "FloatingRateLoan" && (
            <div className="field">
              <label>Index</label>
              <select value={rel.hedgedItem.index ?? "EURIBOR-6M"} aria-label="Index Grundgeschäft" onChange={(e) => updItem({ index: e.target.value })}>
                {INDICES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
          {rel.hedgedItem.kind === "FixedRateLoan" && (
            <div className="field">
              <label>Kupon</label>
              <NumInput
                value={rel.hedgedItem.fixedRate ?? 0.03}
                scale={100}
                step={0.005}
                unit="%"
                ariaLabel="Kupon Grundgeschäft"
                onChange={(v) => updItem({ fixedRate: v })}
              />
            </div>
          )}
          {isFx && (
            <>
              <div className="field">
                <label>Währungspaar</label>
                <input
                  value={rel.hedgedItem.fxPair ?? ""}
                  placeholder="EURUSD"
                  aria-label="Währungspaar"
                  onChange={(e) => updItem({ fxPair: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="field">
                <label>Betrag (+ Zufluss / − Abfluss)</label>
                <NumInput
                  value={rel.hedgedItem.amount ?? rel.hedgedItem.notional}
                  step={100000}
                  unit={rel.hedgedItem.currency}
                  ariaLabel="FX-Betrag"
                  onChange={(v) => updItem({ amount: v })}
                />
              </div>
            </>
          )}
          <DateField label="Beginn" value={rel.hedgedItem.effectiveDate} onChange={(v) => updItem({ effectiveDate: v })} />
          <DateField label={isFx ? "Zahlungstermin" : "Fälligkeit"} value={rel.hedgedItem.maturityDate} onChange={(v) => updItem({ maturityDate: v })} />
          {!isFx && (
            <>
              <div className="field">
                <label>Tilgung</label>
                <select
                  value={amortSel}
                  aria-label="Tilgungsplan Grundgeschäft"
                  data-testid="hedge-amortisation"
                  onChange={(e) => setAmortisation(e.target.value as AmortSel)}
                >
                  {AMORTISATIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </div>
              {(amortSel === "Linear" || amortSel === "Annuity") && (
                <div className="field">
                  <label>Restschuld</label>
                  <NumInput
                    value={item.amortisation?.finalNotional ?? 0}
                    step={100000}
                    min={0}
                    unit={item.currency}
                    ariaLabel="Restschuld Grundgeschäft"
                    onChange={(v) => updItem({ amortisation: { ...(item.amortisation ?? { type: amortSel }), finalNotional: v } })}
                  />
                </div>
              )}
              {amortSel === "Annuity" && (
                <div className="field">
                  <label>Kreditzins (Annuität)</label>
                  <NumInput
                    value={item.amortisation?.loanRate ?? item.fixedRate ?? 0.03}
                    scale={100}
                    step={0.05}
                    unit="%"
                    ariaLabel="Kreditzins Grundgeschäft"
                    onChange={(v) => updItem({ amortisation: { ...(item.amortisation ?? { type: "Annuity" }), loanRate: v } })}
                  />
                </div>
              )}
              <div className="field span-2">
                <label>Nominalverlauf</label>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button
                    className="btn ghost"
                    onClick={takeInstrumentSchedule}
                    disabled={!instrSchedule}
                    data-testid="hedge-take-schedule"
                    title={
                      instrSchedule
                        ? `${instrSchedule.length} Perioden aus Leg 1 des Sicherungsinstruments`
                        : "Das Sicherungsinstrument hat keinen Tilgungsplan"
                    }
                  >
                    Tilgungsplan vom Sicherungsinstrument übernehmen
                  </button>
                  <span className="muted xs">
                    {item.notionalSchedule?.length
                      ? `${item.notionalSchedule.length} Perioden · ${fmtMoney(item.notionalSchedule[0]!.notional, item.currency)} → ${fmtMoney(item.notionalSchedule[item.notionalSchedule.length - 1]!.notional, item.currency)}`
                      : amortSel === "none"
                        ? "konstantes Nominal"
                        : "aus dem Tilgungsprofil erzeugt"}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="muted xs" style={{ marginTop: 8 }}>
          Sicherungsinstrument: {trade.name ?? trade.id} · Nominal {fmtMoney(tradeNotional(trade).amount, tradeNotional(trade).currency)} · bis{" "}
          {fmtDate(tradeMaturity(trade))}. Die Dokumentation wird je Trade lokal gespeichert.
        </div>
        {invalidMessage && !error && (
          <div className="warning error" style={{ marginTop: 8 }} role="alert" data-testid="hedge-invalid-trade">
            {invalidMessage}
          </div>
        )}
        {error && (
          <div className="warning error" style={{ marginTop: 8 }} role="alert" data-testid="hedge-error">
            {germanizeText(error)}
          </div>
        )}
      </div>

      {hy && (
        <div className="card" data-testid="hedge-hypo-card">
          <h3>
            Hypothetisches Derivat (IFRS 9 B6.5.5)
            <span className="right row">
              <span className="muted xs">
                perfekte Absicherung des Grundgeschäfts · PV am Bewertungstag {rep ? fmtMoney(rep.hypotheticalDerivative.pv, ccy) : "–"}
                {rep?.hypotheticalDerivative.frozenVol !== undefined && (
                  <span className="badge" style={{ marginLeft: 6 }} data-testid="hedge-frozen-vol">
                    Vol eingefroren {fmtPct(rep.hypotheticalDerivative.frozenVol, 2)}
                  </span>
                )}
              </span>
              <button
                className="btn ghost"
                onClick={() => {
                  const t = act().addTrade(
                    { ...hy, name: `Hypothetisches Derivat ${rel.name}`, counterparty: "(hypothetisch)" },
                    { autoId: true, select: false },
                  );
                  act().showToast(`Als Trade angelegt: ${t.id}`, { action: { label: "Rückgängig", run: () => act().undo() } });
                }}
              >
                Als Trade übernehmen
              </button>
            </span>
          </h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {hypoSummary(hy).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      {rep && (
        <>
          <div className={`card ${stale ? "stale" : ""}`} data-testid="hedge-verdict">
            <h3>
              Ergebnis ({METHODS.find((m) => m.v === rep.method)?.l} · {FRAMEWORKS.find((f) => f.v === rep.accountingFramework)?.l})
              <span className="right row">
                {stale && (
                  <span className="badge warn" data-testid="hedge-stale">
                    Eingaben geändert – erneut testen
                  </span>
                )}
                <span className={`badge verdict ${!rep.assessable ? "" : rep.effective ? "ok" : "neg"}`} data-testid="hedge-verdict-badge">
                  {!rep.assessable ? "nicht beurteilbar" : rep.effective ? "✓ effektiv" : "✗ nicht effektiv"}
                </span>
              </span>
            </h3>
            {stale && (
              <div className="warning" style={{ marginBottom: 8 }}>
                Das Ergebnis bezieht sich auf frühere Eingaben (Hedge Ratio, Grundgeschäft, Designation oder Marktdaten haben sich geändert). Bitte „Erneut
                testen“.
              </div>
            )}
            <div className="grid cols-4 kpis">
              <div className="kpi">
                <span className="label">PV Sicherungsinstrument</span>
                <span className={`value ${signClass(rep.hedgingInstrument.pv)}`} style={{ fontSize: 18 }}>
                  {fmtMoney(rep.hedgingInstrument.pv, ccy)}
                </span>
              </div>
              <div className="kpi">
                <span className="label">PV hypothetisches Derivat</span>
                <span className={`value ${signClass(rep.hypotheticalDerivative.pv)}`} style={{ fontSize: 18 }}>
                  {fmtMoney(rep.hypotheticalDerivative.pv, ccy)}
                </span>
              </div>
              <div className="kpi">
                <span className="label">Hedge Ratio</span>
                <span className="value" style={{ fontSize: 18 }}>
                  {fmtPct(rep.hedgeRatio, 0)}
                </span>
              </div>
              <div className="kpi">
                <span className="label">Ergebnis je Methode</span>
                <span className="value small" style={{ fontSize: 12, fontFamily: "var(--font-sans)" }}>
                  {METHODS.map((m) => (
                    <span key={m.v} className={`badge ${rep.effectiveByMethod[m.v] ? "ok" : "warn"}`} style={{ marginRight: 4 }}>
                      {m.l}: {rep.effectiveByMethod[m.v] ? "✓" : "✗"}
                    </span>
                  ))}
                </span>
              </div>
            </div>
            <ul className="small summary" style={{ marginTop: 10, paddingLeft: 18, lineHeight: 1.6 }} data-testid="hedge-summary">
              {rep.summary.map((l) => (
                <li key={l}>{germanizeText(l)}</li>
              ))}
            </ul>
            {rep.basisScenarioIds.length > 0 && (
              <div className="muted xs" style={{ marginTop: 6 }} data-testid="hedge-basis-info">
                Basis-Szenarien in der Regression ({rep.basisScenarioIds.length}): {rep.basisScenarioIds.join(", ")} – Einzelkurven-Schocks der Projektions- und
                Diskontkurven legen Tenor- und OIS-Basis-Ineffektivität offen.
              </div>
            )}
            {rep.warnings.length > 0 && (
              <div className="warning" style={{ marginTop: 8 }} data-testid="hedge-warnings">
                <b className="small">Hinweise ({rep.warnings.length})</b>
                <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {rep.warnings.map((w) => (
                    <li key={w}>{germanizeText(w)}</li>
                  ))}
                </ul>
              </div>
            )}
            {!s.customerMode &&
              rep.pricingWarnings.map((w) => (
                <div key={w} className="muted xs" style={{ marginTop: 4 }}>
                  {germanizeText(translatePricingError(new Error(w)))}
                </div>
              ))}
          </div>

          <div className="grid cols-3 hedge-grid">
            <div className="card">
              <h3>
                Critical Terms
                <span className="right">
                  <span className={`badge ${rep.criticalTerms.matches ? "ok" : "warn"}`}>
                    {rep.criticalTerms.matches ? "✓ übereinstimmend" : "✗ Abweichung"}
                  </span>
                </span>
              </h3>
              <div className="table-scroll">
                <table className="grid-table compact">
                  <thead>
                    <tr>
                      <th>Merkmal</th>
                      <th>Grundgeschäft</th>
                      <th>Instrument</th>
                      <th className="num">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rep.criticalTerms.checks.map((c) => (
                      <tr key={c.term} style={{ cursor: "default" }} className={!c.applicable ? "muted" : ""}>
                        <td>{TERM_DE[c.term] ?? c.term}</td>
                        <td className="mono xs">{germanizeText(c.hedgedItem)}</td>
                        <td className="mono xs">{germanizeText(c.hedgingInstrument)}</td>
                        <td className={`num ${!c.applicable ? "muted" : c.match ? "pos" : "neg"}`}>{!c.applicable ? "n/a" : c.match ? "✓" : "✗"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="muted xs" style={{ marginTop: 6 }}>
                Toleranz {rep.criticalTerms.toleranceDays} Tage · Nominal ±{fmtPct(rep.criticalTerms.notionalTolerance, 0)}
              </div>
            </div>
            <DollarOffsetCard title="Prospektiv (+100 bp / +10 % Spot)" r={rep.dollarOffsetProspective} ccy={ccy} />
            {rep.dollarOffsetBasis && <DollarOffsetCard title="Basis (+25 bp Projektionskurve Grundgeschäft)" r={rep.dollarOffsetBasis} ccy={ccy} />}
            {rep.costOfHedging && (
              <div className="card" data-testid="hedge-coh">
                <h3>
                  Cost of Hedging
                  <span className="right muted xs">IFRS 9 6.5.15 · Zeitwert der Option</span>
                </h3>
                <div className="table-scroll">
                  <table className="grid-table compact" aria-label="Cost of Hedging">
                    <tbody>
                      <tr style={{ cursor: "default" }}>
                        <td className="muted">Zeitwert am Bewertungstag</td>
                        <td className={`num ${signClass(rep.costOfHedging.timeValue)}`}>{fmtMoney(rep.costOfHedging.timeValue, rep.costOfHedging.currency)}</td>
                      </tr>
                      <tr style={{ cursor: "default" }}>
                        <td className="muted">Zeitwert bei Designation</td>
                        <td className="num">
                          {rep.costOfHedging.timeValueAtDesignation !== undefined
                            ? fmtMoney(rep.costOfHedging.timeValueAtDesignation, rep.costOfHedging.currency)
                            : "– (Designationsmarkt fehlt)"}
                        </td>
                      </tr>
                      <tr style={{ cursor: "default" }}>
                        <td>
                          <b>Δ Zeitwert → OCI (Cost-of-Hedging-Rücklage)</b>
                        </td>
                        <td className={`num ${signClass(rep.costOfHedging.change)}`}>
                          {rep.costOfHedging.change !== undefined ? fmtMoney(rep.costOfHedging.change, rep.costOfHedging.currency) : "–"}
                        </td>
                      </tr>
                      <tr style={{ cursor: "default" }}>
                        <td className="muted">Innerer Wert (Effektivitätsmessung)</td>
                        <td className={`num ${signClass(rep.costOfHedging.intrinsicValue)}`}>
                          {fmtMoney(rep.costOfHedging.intrinsicValue, rep.costOfHedging.currency)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {rep.dollarOffsetCumulative ? (
              <DollarOffsetCard title="Kumulativ (seit Designation)" r={rep.dollarOffsetCumulative} ccy={ccy} />
            ) : (
              <div className="card empty small">Kumulativer Test benötigt den Designationsmarkt („simulieren“ ankreuzen).</div>
            )}
            {rep.dollarOffsetPeriod && rep.dollarOffsetPeriod !== rep.dollarOffsetCumulative && (
              <DollarOffsetCard title="Periode" r={rep.dollarOffsetPeriod} ccy={ccy} />
            )}
          </div>

          <div className="grid cols-2">
            <div className="card" data-testid="hedge-regression">
              <h3>
                <Term id="regression">Regression</Term>
                <span className="right muted xs">
                  Steigung {reg?.slope !== undefined ? fmtNum(reg.slope, 3) : "–"} · R² {reg?.r2 !== undefined ? fmtNum(reg.r2, 3) : "–"} · n = {reg?.n ?? 0} ·{" "}
                  <span className={`badge ${!reg?.assessable ? "" : reg.effective ? "ok" : "warn"}`}>
                    {!reg?.assessable ? "nicht beurteilbar" : reg.effective ? "effektiv" : "nicht effektiv"}
                  </span>
                </span>
              </h3>
              {reg && reg.points.length > 0 ? (
                <EChart
                  className="chart tall"
                  ariaLabel="Regression ΔPV Sicherungsinstrument gegen ΔPV hypothetisches Derivat"
                  option={{
                    grid: { left: 70, right: 20, top: 20, bottom: 40 },
                    tooltip: {
                      trigger: "item",
                      formatter: (p: unknown) => {
                        const d = (p as { data: number[] }).data;
                        return `Δ hypo ${fmtMoney(d[0], ccy)}<br/>Δ Hedge ${fmtMoney(d[1], ccy)}`;
                      },
                    },
                    xAxis: {
                      type: "value",
                      name: "ΔPV hypothetisches Derivat",
                      nameLocation: "middle",
                      nameGap: 26,
                      axisLabel: { formatter: (v: number) => fmtNum(v / 1000, 0) + "k" },
                    },
                    yAxis: { type: "value", name: "ΔPV Sicherungsinstrument", axisLabel: { formatter: (v: number) => fmtNum(v / 1000, 0) + "k" } },
                    series: [
                      {
                        type: "scatter",
                        symbolSize: 7,
                        data: reg.points.map((p) => [p.deltaHypothetical, p.deltaHedge]),
                        itemStyle: { color: cssVar("--accent") },
                      },
                      ...(regLine
                        ? [
                            {
                              type: "line" as const,
                              data: regLine,
                              showSymbol: false,
                              lineStyle: { color: reg.effective ? posColor() : negColor(), width: 1.5 },
                            },
                          ]
                        : []),
                    ],
                  }}
                />
              ) : (
                <div className="empty">Keine Regressionspunkte</div>
              )}
              <div className="muted xs">
                Band Steigung {fmtNum(reg?.slopeBand[0] ?? 0.8, 2)} – {fmtNum(reg?.slopeBand[1] ?? 1.25, 2)} · min. R² {fmtNum(reg?.minR2 ?? 0.8, 2)}
              </div>
            </div>
            <div className="card">
              <h3>
                {rep.accountingFramework === "IFRS9" ? "IFRS 9 – Buchung" : "HGB § 254 – Bewertungseinheit"}
                <span className="right">
                  <span className={`badge ${rep.ifrs9.assessable ? "" : "warn"}`}>
                    {rep.ifrs9.assessable ? "kumuliert seit Designation" : "Designationsmarkt fehlt"}
                  </span>
                </span>
              </h3>
              <div className="table-scroll">
                <table className="grid-table compact" aria-label={rep.accountingFramework === "IFRS9" ? "IFRS 9 – Buchung" : "HGB § 254 – Bewertungseinheit"}>
                  <tbody>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Δ Sicherungsinstrument (kumuliert)</td>
                      <td className={`num ${signClass(rep.ifrs9.hedgingInstrumentChange)}`}>{fmtMoney(rep.ifrs9.hedgingInstrumentChange, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Δ Grundgeschäft (gesichertes Risiko)</td>
                      <td className={`num ${signClass(rep.ifrs9.hedgedItemChange)}`}>{fmtMoney(rep.ifrs9.hedgedItemChange, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Effektiver Teil</td>
                      <td className={`num ${signClass(rep.ifrs9.effectivePortion)}`}>{fmtMoney(rep.ifrs9.effectivePortion, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td>
                        <b>IFRS 9 · OCI (Cash-Flow-Hedge-Rücklage)</b>
                      </td>
                      <td className={`num ${signClass(rep.ifrs9.oci)}`}>{fmtMoney(rep.ifrs9.oci, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td>
                        <b>IFRS 9 · GuV (Ineffektivität)</b>
                      </td>
                      <td className={`num ${signClass(rep.ifrs9.pnl)}`}>{fmtMoney(rep.ifrs9.pnl, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted xs">davon Sicherungsinstrument / Grundgeschäfts-Anpassung</td>
                      <td className="num xs">
                        {fmtMoney(rep.ifrs9.pnlComponents.hedgingInstrument, ccy)} / {fmtMoney(rep.ifrs9.pnlComponents.hedgedItemAdjustment, ccy)}
                      </td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td>
                        <b>HGB · kompensierter Teil</b>
                      </td>
                      <td className="num">{fmtMoney(rep.hgb.effectiveNetted, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td>
                        <b>HGB · ineffektiver Überhang</b>
                      </td>
                      <td className={`num ${signClass(rep.hgb.ineffectiveExcess)}`}>{fmtMoney(rep.hgb.ineffectiveExcess, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Drohverlustrückstellung (§ 249 HGB)</td>
                      <td className="num neg">{fmtMoney(rep.hgb.drohverlustrueckstellung, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Nicht realisierter Gewinn (Realisationsprinzip)</td>
                      <td className="num">{fmtMoney(rep.hgb.unrecognisedGain, ccy)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Einfrierungsmethode · GuV</td>
                      <td className={`num ${signClass(rep.hgb.einfrierungsmethode.recognisedPnl)}`}>
                        {fmtMoney(rep.hgb.einfrierungsmethode.recognisedPnl, ccy)}
                      </td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td className="muted">Durchbuchungsmethode · GuV netto</td>
                      <td className={`num ${signClass(rep.hgb.durchbuchungsmethode.netPnl)}`}>{fmtMoney(rep.hgb.durchbuchungsmethode.netPnl, ccy)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
