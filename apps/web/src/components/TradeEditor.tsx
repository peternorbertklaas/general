import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type BusinessDayConvention,
  type CrossCurrencySwap,
  type FixedLeg,
  type FloatLeg,
  type StubType,
  type SwapLeg,
  type Trade,
  addTenor,
  buildSchedule,
  getIndex,
  linearAmortisation,
  makeVanillaSwap,
} from "@deriva/pricing-core";
import { parseDateInput } from "../lib/date-parse.js";
import { fmtBp, fmtDate, fmtMoney, fmtPct } from "../lib/format.js";
import {
  BARRIER_DE,
  CAPFLOOR_DE,
  CASH_CONVENTION_DE,
  MODEL_DE,
  OPTION_TYPE_DE,
  PAYER_RECEIVER_DE,
  SETTLEMENT_DE,
  optionsFrom,
  translateCoreMessage,
} from "../lib/i18n.js";
import { parseNumberInput } from "../lib/num-parse.js";
import { hasFxVolSurface } from "../lib/quick-parser.js";
import { annuityAmortisation, frequencyMonths, parseSchedulePaste, scheduleValueAt } from "../lib/trade-ops.js";
import { useTableNav } from "../hooks/useTableNav.js";
import { issueFor, validateTrade, type TradeIssue } from "../lib/validate-trade.js";
import { LS_KEYS, STATUS_LABELS, TRADE_STATUSES, readLocal, useStore, writeLocal } from "../state/store.js";
import { DateInput } from "./DateInput.js";
import { FieldLabelContext, useFieldLabel } from "./FieldLabel.js";
import { NumInput, OptNumInput } from "./NumInput.js";

export { NumInput, OptNumInput };

interface Props {
  trade: Trade;
  onChange: (t: Trade) => void;
}

/**
 * Form field with label; `issue` renders aria-invalid styling + message under
 * the field. The label is published via `FieldLabelContext`, so every
 * `Select` / `NumInput` / `DateInput` inside gets it as accessible name unless
 * it carries an explicit `ariaLabel` (R3-03).
 */
function Field({ label, children, span2, issue, hint }: { label: string; children: React.ReactNode; span2?: boolean; issue?: TradeIssue; hint?: string }) {
  return (
    <div className={`field ${span2 ? "span-2" : ""} ${issue ? (issue.level === "error" ? "invalid" : "warn") : ""}`}>
      <label>{label}</label>
      <FieldLabelContext.Provider value={label}>{children}</FieldLabelContext.Provider>
      {issue && (
        <span className={`field-msg ${issue.level}`} role={issue.level === "error" ? "alert" : undefined}>
          {issue.msg}
        </span>
      )}
      {!issue && hint && <span className="field-msg muted">{hint}</span>}
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  invalid,
  ariaLabel,
}: {
  value: T;
  options: readonly T[] | readonly { v: T; l: string }[];
  onChange: (v: T) => void;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const label = useFieldLabel(ariaLabel);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-invalid={invalid || undefined} aria-label={label}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.v;
        const l = typeof o === "string" ? o : o.l;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/** Collapsible section; the open state is shared for all legs and remembered in localStorage. */
function Collapsible({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="collapsible">
      <button type="button" onClick={onToggle} aria-expanded={open}>
        <span>{open ? "▾" : "▸"}</span> {title}
      </button>
      {open && <div className="body form">{children}</div>}
    </div>
  );
}

function useConventionsOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => readLocal(LS_KEYS.conventionsOpen) === "1");
  return [
    open,
    () => {
      const next = !open;
      setOpen(next);
      writeLocal(LS_KEYS.conventionsOpen, next ? "1" : "0");
    },
  ];
}

const CCY_PRIORITY = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];
/** Market quotation: the currency with higher priority is the base (e.g. EUR/USD, USD/JPY). */
function marketRate(
  buyCcy: string,
  buyAmt: number,
  sellCcy: string,
  sellAmt: number,
): { label: string; rate: number; setFromRate: (r: number) => { buyAmount?: number; sellAmount?: number } } {
  const buyIsBase = CCY_PRIORITY.indexOf(buyCcy) <= CCY_PRIORITY.indexOf(sellCcy) && CCY_PRIORITY.indexOf(buyCcy) !== -1;
  if (buyIsBase) {
    return { label: `Kurs ${buyCcy}/${sellCcy}`, rate: buyAmt ? sellAmt / buyAmt : 0, setFromRate: (r) => ({ sellAmount: buyAmt * r }) };
  }
  return { label: `Kurs ${sellCcy}/${buyCcy}`, rate: sellAmt ? buyAmt / sellAmt : 0, setFromRate: (r) => ({ buyAmount: sellAmt * r }) };
}

const DAYCOUNTS = ["ACT/360", "ACT/365F", "30E/360", "30/360", "ACT/ACT ISDA"] as const;
const FREQS = ["1M", "3M", "6M", "1Y", "ZC"] as const;
const INDICES = ["EURIBOR-3M", "EURIBOR-6M", "ESTR", "SOFR", "SONIA", "SARON", "TONA"] as const;
const CCYS = ["EUR", "USD", "GBP", "CHF", "JPY"] as const;
const PAIRS = ["EURUSD", "EURGBP", "EURCHF", "EURJPY", "USDJPY"] as const;
const STUBS: { v: StubType; l: string }[] = [
  { v: "ShortFront", l: "Short Front" },
  { v: "LongFront", l: "Long Front" },
  { v: "ShortBack", l: "Short Back" },
  { v: "LongBack", l: "Long Back" },
];
const BDCS: { v: BusinessDayConvention; l: string }[] = [
  { v: "Following", l: "Following" },
  { v: "ModifiedFollowing", l: "Modified Following" },
  { v: "Preceding", l: "Preceding" },
  { v: "ModifiedPreceding", l: "Modified Preceding" },
];
type Payout = "Vanilla" | "DigitalCash" | "DigitalAsset";
const PAYOUTS: { v: Payout; l: string }[] = [
  { v: "Vanilla", l: "Vanilla" },
  { v: "DigitalCash", l: "Digital (Cash – Quote-Ccy)" },
  { v: "DigitalAsset", l: "Digital (Asset – Basis-Ccy)" },
];

/** Whether an index is an overnight (RFR) index – enables lookback / observation shift. */
export function isOisIndex(index: string): boolean {
  try {
    return getIndex(index).type === "OIS";
  } catch {
    return false;
  }
}

type LegPatch = Partial<Omit<FloatLeg, "type">> & Partial<Pick<FixedLeg, "rate" | "rateSchedule">>;

/** Period starts of a leg schedule (empty when the schedule cannot be built). */
function legPeriodStarts(leg: SwapLeg): number[] {
  try {
    return buildSchedule({
      effectiveDate: leg.effectiveDate,
      terminationDate: leg.terminationDate,
      frequency: leg.frequency,
      calendar: leg.calendar,
      businessDayConvention: leg.businessDayConvention,
      stub: leg.stub,
      endOfMonth: leg.endOfMonth,
      paymentLag: leg.paymentLag,
    }).periods.map((p) => p.accrualStart);
  } catch {
    return [];
  }
}

/**
 * Step-up / step-down coupon editor ("Kuponverlauf"): `FixedLeg.rateSchedule`
 * or `FloatLeg.spreadSchedule` as rows of date + rate/spread. The last entry
 * dated on/before a period start applies (core rule); periods before the first
 * entry use the leg's base rate / spread.
 */
function CouponScheduleEditor({ leg, legIndex, onChange }: { leg: SwapLeg; legIndex: number; onChange: (patch: LegPatch) => void }) {
  const isFixed = leg.type === "Fixed";
  const all: { date: number; value: number }[] = isFixed
    ? (leg.rateSchedule ?? []).map((e) => ({ date: e.date, value: e.rate }))
    : (leg.spreadSchedule ?? []).map((e) => ({ date: e.date, value: e.spread }));
  // A schedule entry on/before the start date is the base coupon itself (core builders write it that way) –
  // it is shown as "Basis", not as "Stufe 1" (R3-10); it is kept on commit so the core semantics stay unchanged.
  const baseEntries = all.filter((e) => e.date <= leg.effectiveDate);
  const entries = all.filter((e) => e.date > leg.effectiveDate);
  const base = baseEntries.length ? baseEntries[baseEntries.length - 1]!.value : isFixed ? leg.rate : (leg.spread ?? 0);
  const on = entries.length > 0;
  const commit = (list: { date: number; value: number }[]) => {
    const sorted = [...(list.length ? baseEntries : []), ...list].sort((a, b) => a.date - b.date);
    if (isFixed) onChange({ rateSchedule: sorted.length ? sorted.map((e) => ({ date: e.date, rate: e.value })) : undefined });
    else onChange({ spreadSchedule: sorted.length ? sorted.map((e) => ({ date: e.date, spread: e.value })) : undefined });
  };
  const valueAt = (d: number) => scheduleValueAt(entries, "value", d, base);
  const addRow = () => {
    const last = entries[entries.length - 1];
    const date = last ? addTenor(last.date, "1Y") : addTenor(leg.effectiveDate, "1Y");
    commit([...entries, { date, value: last ? last.value : base }]);
  };
  const fromAmortisation = () => {
    const dates = (leg.notionalSchedule?.length ? leg.notionalSchedule.map((e) => e.date) : legPeriodStarts(leg)).filter((d) => d > leg.effectiveDate);
    if (dates.length === 0) return;
    commit(dates.map((d) => ({ date: d, value: valueAt(d) })));
  };
  const setRow = (i: number, patch: Partial<{ date: number; value: number }>) => commit(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => commit(entries.filter((_, j) => j !== i));
  const fmt = (v: number) => (isFixed ? fmtPct(v, 3) : fmtBp(v, 1));
  return (
    <div className="collapsible coupon-schedule" data-testid={`coupon-schedule-${legIndex}`}>
      <div className="row wrap" style={{ gap: 8, padding: "6px 0" }}>
        <b className="small">Kuponverlauf {isFixed ? "(Zinsstaffel)" : "(Spread-Staffel)"}</b>
        {on ? (
          <span className="badge" title="Stufen der Staffel">
            {entries.length} {entries.length === 1 ? "Stufe" : "Stufen"}
          </span>
        ) : (
          <span className="muted xs">konstant {fmt(base)}</span>
        )}
        <span className="grow" />
        <button type="button" className="btn ghost xs" onClick={addRow} data-testid={`coupon-add-${legIndex}`} title="Stufe ein Jahr nach der letzten anfügen">
          + Stufe
        </button>
        <button
          type="button"
          className="btn ghost xs"
          onClick={fromAmortisation}
          title={
            leg.notionalSchedule?.length
              ? "Eine Stufe je Datum des Tilgungsplans anlegen (Werte aus der bestehenden Staffel bzw. Basiskupon)"
              : "Eine Stufe je Periodenstart anlegen (kein Tilgungsplan vorhanden)"
          }
        >
          vom Amortisationsplan übernehmen
        </button>
        {on && (
          <button type="button" className="btn ghost xs" onClick={() => commit([])} title="Staffel entfernen – konstanter Kupon">
            Entfernen
          </button>
        )}
      </div>
      {on && (
        <div className="table-scroll" style={{ maxHeight: 220 }}>
          <table className="grid-table compact">
            <thead>
              <tr>
                <th>#</th>
                <th>ab Datum</th>
                <th className="num">{isFixed ? "Kupon" : "Spread"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr style={{ cursor: "default" }}>
                <td className="muted">0</td>
                <td className="mono muted xs">bis {fmtDate(entries[0]!.date)}</td>
                <td className="num muted xs">{fmt(base)} (Basis)</td>
                <td />
              </tr>
              {entries.map((e, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <DateInput
                      inline
                      value={e.date}
                      base={leg.effectiveDate}
                      ariaLabel={`Stufe ${i + 1} Datum Leg ${legIndex + 1}`}
                      onChange={(v) => setRow(i, { date: v })}
                    />
                  </td>
                  <td className="num">
                    <span style={{ display: "inline-block", width: 130 }}>
                      <NumInput
                        inline
                        value={e.value}
                        scale={isFixed ? 100 : 1e4}
                        step={isFixed ? 0.05 : 1}
                        unit={isFixed ? "%" : "bp"}
                        ariaLabel={`Stufe ${i + 1} ${isFixed ? "Kupon" : "Spread"} Leg ${legIndex + 1}`}
                        onChange={(v) => setRow(i, { value: v })}
                      />
                    </span>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn ghost danger xs"
                      aria-label={`Stufe ${i + 1} entfernen`}
                      title="Stufe entfernen"
                      onClick={() => remove(i)}
                    >
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

/** Schedule conventions of a swap leg (stub, BDC, EOM, lags, RFR conventions, embedded cap/floor). */
function LegConventions({ leg, onChange, open, onToggle }: { leg: SwapLeg; onChange: (patch: LegPatch) => void; open: boolean; onToggle: () => void }) {
  const fl = leg.type === "Float" ? leg : undefined;
  const ois = fl ? isOisIndex(fl.index) : false;
  let defaultFixingLag = "";
  if (fl) {
    try {
      defaultFixingLag = String(getIndex(fl.index).fixingLag);
    } catch {
      defaultFixingLag = "";
    }
  }
  return (
    <Collapsible title="Konventionen" open={open} onToggle={onToggle}>
      <Field label="Stub">
        <Select value={leg.stub ?? "ShortFront"} options={STUBS} onChange={(v) => onChange({ stub: v })} />
      </Field>
      <Field label="Business-Day-Convention">
        <Select value={leg.businessDayConvention ?? "ModifiedFollowing"} options={BDCS} onChange={(v) => onChange({ businessDayConvention: v })} />
      </Field>
      <Field label="End-of-Month">
        <Checkbox checked={leg.endOfMonth ?? false} onChange={(v) => onChange({ endOfMonth: v })} label="Monatsultimo-Regel" />
      </Field>
      <Field label="Payment-Lag">
        <NumInput value={leg.paymentLag ?? 0} step={1} min={0} unit="Tage" onChange={(v) => onChange({ paymentLag: Math.max(0, Math.round(v)) })} />
      </Field>
      {fl && (
        <>
          <Field label="Fixing-Lag">
            <OptNumInput
              value={fl.fixingLag}
              step={1}
              unit="Tage"
              placeholder={defaultFixingLag}
              onChange={(v) => onChange({ fixingLag: v === undefined ? undefined : Math.max(0, Math.round(v)) })}
            />
          </Field>
          {ois && (
            <>
              <Field label="Lookback">
                <NumInput value={fl.lookbackDays ?? 0} step={1} min={0} unit="Tage" onChange={(v) => onChange({ lookbackDays: Math.max(0, Math.round(v)) })} />
              </Field>
              <Field label="Observation-Shift">
                <Checkbox checked={fl.observationShift ?? false} onChange={(v) => onChange({ observationShift: v })} label="Gewichte aus Beobachtungsperiode" />
              </Field>
            </>
          )}
          <Field label="Cap (eingebettet)">
            <OptNumInput value={fl.capRate} scale={100} step={0.05} unit="%" placeholder="–" onChange={(v) => onChange({ capRate: v })} />
          </Field>
          <Field label="Floor (eingebettet)">
            <OptNumInput value={fl.floorRate} scale={100} step={0.05} unit="%" placeholder="–" onChange={(v) => onChange({ floorRate: v })} />
          </Field>
        </>
      )}
    </Collapsible>
  );
}

type AmortKind = "linear" | "annuity" | "custom";

/**
 * Amortisation editor (Markt N17): notional per period start (dates from the
 * leg schedule). Profiles: "Linear" to a target residual, "Annuität" (constant
 * instalment from the loan rate), "Custom" (edit / paste a Datum;Nominal table).
 */
/** Schedule owner of the amortisation editor: a swap leg or a cap/floor (same `notionalSchedule` rule in the core). */
interface AmortLeg {
  label: string;
  notional: number;
  currency: string;
  effectiveDate: number;
  terminationDate: number;
  frequency: string;
  calendar: SwapLeg["calendar"];
  businessDayConvention?: BusinessDayConvention;
  stub?: StubType;
  endOfMonth?: boolean;
  paymentLag?: number;
  notionalSchedule?: { date: number; notional: number }[];
}

function AmortisationEditor({
  legs,
  onSchedule,
}: {
  legs: AmortLeg[];
  /** Write `schedule` (undefined = constant notional) to the legs at `targets`. */
  onSchedule: (targets: number[], schedule: { date: number; notional: number }[] | undefined) => void;
}) {
  const valuationDate = useStore((s) => s.valuationDate);
  const showToast = useStore((s) => s.showToast);
  /** Roving tabindex (R6-02): the table is one tab stop, ↑/↓ move between periods, ↵ / F2 focus the notional input of the row. */
  const rowNav = useTableNav({ onEnter: (_i, tr) => tr.querySelector<HTMLInputElement>("input")?.focus() });
  const onRowKey = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "F2" && target.tagName === "TR") {
      e.preventDefault();
      target.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    rowNav.onKeyDown(e);
  };
  /** Esc inside a notional input returns the focus to its row (capture phase: the input's own Esc handler restores the value and blurs). */
  const onRowKeyCapture = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    if (e.key !== "Escape" || target.tagName !== "INPUT") return;
    const tr = target.closest("tr");
    window.setTimeout(() => tr?.focus(), 0);
  };
  const [applyAll, setApplyAll] = useState(legs.every((l) => l.currency === legs[0]!.currency));
  const [legIdx, setLegIdx] = useState(0);
  const [kind, setKind] = useState<AmortKind>("linear");
  const [residual, setResidual] = useState(0);
  const [loanRate, setLoanRate] = useState(0.04);
  const sameDates = legs.every((l) => l.effectiveDate === legs[0]!.effectiveDate && l.terminationDate === legs[0]!.terminationDate);
  const all = applyAll && sameDates;
  const ref = legs[all ? 0 : Math.min(legIdx, legs.length - 1)]!;
  const on = (ref.notionalSchedule?.length ?? 0) > 0;

  const periodStarts = useMemo(() => {
    try {
      return buildSchedule({
        effectiveDate: ref.effectiveDate,
        terminationDate: ref.terminationDate,
        frequency: ref.frequency,
        calendar: ref.calendar,
        businessDayConvention: ref.businessDayConvention,
        stub: ref.stub,
        endOfMonth: ref.endOfMonth,
        paymentLag: ref.paymentLag,
      }).periods.map((p) => p.accrualStart);
    } catch {
      return [] as number[];
    }
  }, [ref.effectiveDate, ref.terminationDate, ref.frequency, ref.calendar, ref.businessDayConvention, ref.stub, ref.endOfMonth, ref.paymentLag]);

  /** Notional in force at a period start = last schedule entry dated on/before it (same rule as the pricer). */
  const notionalAt = (date: number): number => {
    let n = ref.notionalSchedule?.[0]?.notional ?? ref.notional;
    for (const e of ref.notionalSchedule ?? []) if (e.date <= date) n = e.notional;
    return n;
  };

  const setSchedule = (schedule: { date: number; notional: number }[] | undefined) => {
    const targets = all ? legs.map((_, i) => i) : [legs.indexOf(ref)];
    onSchedule(targets, schedule);
  };
  const toggle = (enabled: boolean) => setSchedule(enabled ? periodStarts.map((d) => ({ date: d, notional: ref.notional })) : undefined);
  const setRow = (i: number, notional: number) => {
    setKind("custom");
    setSchedule(periodStarts.map((d, j) => ({ date: d, notional: j === i ? notional : notionalAt(d) })));
  };
  const startNotional = ref.notionalSchedule?.[0]?.notional ?? ref.notional;
  const applyLinear = () => {
    setKind("linear");
    setSchedule(linearAmortisation(ref, startNotional, residual));
  };
  const applyAnnuity = () => {
    setKind("annuity");
    setSchedule(annuityAmortisation(periodStarts, startNotional, residual, loanRate, frequencyMonths(ref.frequency)));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || !/[\n;\t]/.test(text)) return;
    const parsed = parseSchedulePaste(
      text,
      (s) => parseDateInput(s, { base: valuationDate }),
      (s) => parseNumberInput(s)?.value,
    );
    if (parsed.length === 0) return;
    e.preventDefault();
    setKind("custom");
    setSchedule(parsed);
    showToast(`Tilgungsplan übernommen (${parsed.length} Zeilen)`);
  };

  return (
    <div className="card" style={{ padding: 10 }} data-testid="amortisation-editor">
      <h3>
        Amortisation
        <span className="right row" style={{ gap: 12 }}>
          {legs.length > 1 && (
            <Checkbox checked={all} onChange={setApplyAll} label={sameDates ? "auf alle Legs anwenden" : "auf alle Legs anwenden (Laufzeiten abweichend)"} />
          )}
          {!all && legs.length > 1 && (
            <select className="inline" value={legIdx} onChange={(e) => setLegIdx(Number(e.target.value))} aria-label="Leg für Amortisation">
              {legs.map((l, i) => (
                <option key={i} value={i}>
                  Leg {i + 1} ({l.label})
                </option>
              ))}
            </select>
          )}
          <Checkbox checked={on} onChange={toggle} label="Amortisierend" />
        </span>
      </h3>
      {on && (
        <>
          <div className="row wrap" style={{ marginBottom: 8, gap: 10 }}>
            <div className="seg" role="group" aria-label="Tilgungsprofil">
              <button
                type="button"
                className={kind === "linear" ? "active" : ""}
                aria-pressed={kind === "linear"}
                onClick={applyLinear}
                title="Linear auf die Restschuld abschmelzend"
              >
                Linear
              </button>
              <button
                type="button"
                className={kind === "annuity" ? "active" : ""}
                aria-pressed={kind === "annuity"}
                onClick={applyAnnuity}
                title="Annuität: konstante Rate aus Kreditzins, Tilgung steigt über die Laufzeit"
              >
                Annuität
              </button>
              <button
                type="button"
                className={kind === "custom" ? "active" : ""}
                aria-pressed={kind === "custom"}
                onClick={() => setKind("custom")}
                title="Nominal je Periode frei eingeben oder Tabelle (Datum;Nominal) einfügen"
              >
                Custom
              </button>
            </div>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted small">Restschuld</span>
              <span style={{ display: "inline-block", width: 170 }}>
                <NumInput
                  inline
                  value={residual}
                  step={100000}
                  min={0}
                  unit={ref.currency}
                  ariaLabel="Restschuld"
                  onChange={setResidual}
                  onCommit={() => (kind === "annuity" ? applyAnnuity() : applyLinear())}
                />
              </span>
            </label>
            {kind === "annuity" && (
              <label className="row" style={{ gap: 6 }}>
                <span className="muted small">Kreditzins</span>
                <span style={{ display: "inline-block", width: 110 }}>
                  <NumInput inline value={loanRate} scale={100} step={0.05} unit="%" ariaLabel="Kreditzins" onChange={setLoanRate} onCommit={applyAnnuity} />
                </span>
              </label>
            )}
            <button type="button" className="btn ghost" onClick={() => toggle(false)} title="Nominalplan entfernen – konstantes Nominal">
              Konstant
            </button>
            <span className="muted xs">
              {periodStarts.length} Perioden · Start {fmtMoney(notionalAt(periodStarts[0] ?? ref.effectiveDate), ref.currency)} · Ende{" "}
              {fmtMoney(notionalAt(periodStarts[periodStarts.length - 1] ?? ref.effectiveDate), ref.currency)}
            </span>
          </div>
          <div className="table-scroll" style={{ maxHeight: 240 }} onPaste={onPaste} data-testid="amortisation-table">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Periodenstart</th>
                  <th className="num">Nominal</th>
                </tr>
              </thead>
              <tbody onKeyDown={onRowKey} onKeyDownCapture={onRowKeyCapture} onFocus={rowNav.onFocus}>
                {periodStarts.map((d, i) => (
                  <tr key={d} style={{ cursor: "default" }} {...rowNav.rowProps(i, periodStarts.length)}>
                    <td className="muted">{i + 1}</td>
                    <td className="mono">{fmtDate(d)}</td>
                    <td className="num">
                      <span style={{ display: "inline-block", width: 190 }}>
                        <NumInput
                          inline
                          value={notionalAt(d)}
                          step={100000}
                          min={0}
                          unit={ref.currency}
                          ariaLabel={`Nominal Periode ${i + 1}`}
                          tabIndex={-1}
                          onChange={(v) => setRow(i, v)}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted xs" style={{ marginTop: 4 }}>
            Zweispaltige Tabelle (Datum;Nominal, z. B. aus Excel) mit <kbd>Ctrl</kbd>+<kbd>V</kbd> in die Tabelle einfügen – Datum als tt.mm.jjjj oder ISO.{" "}
            <kbd>↑</kbd>/<kbd>↓</kbd> Periode · <kbd>↵</kbd> oder <kbd>F2</kbd> Nominal bearbeiten · <kbd>Tab</kbd> verlässt die Tabelle.
          </div>
        </>
      )}
    </div>
  );
}

export function TradeEditor({ trade, onChange }: Props) {
  const customerMode = useStore((s) => s.customerMode);
  const valuationDate = useStore((s) => s.valuationDate);
  /** Currencies with a swaption vol cube in the market (currency choice of the swaption editor, Markt R4-2). */
  const swaptionVolCurrencies = useStore(useShallow((s) => Object.keys(s.baseMarket.swaptionVols ?? {})));
  const fxVolPairs = useStore(useShallow((s) => Object.keys(s.baseMarket.fxVols ?? {})));
  /** Core warnings of the current valuation – e.g. `COLLATERAL_CURVE_MISSING:` for a CSA without a collateral curve (Markt R4-1). */
  const pricingWarnings = useStore(useShallow((s) => s.results[trade.id]?.result?.warnings ?? []));
  const collateralCurveMissing = pricingWarnings.find((w) => w.startsWith("COLLATERAL_CURVE_MISSING"));
  const [convOpen, toggleConv] = useConventionsOpen();
  const issues = useMemo(() => validateTrade(trade), [trade]);
  const iss = (field: string) => issueFor(issues, field);
  const upd = (patch: Partial<Trade>) => onChange({ ...trade, ...patch } as Trade);
  const baseCcy =
    trade.type === "FxOption"
      ? trade.pair.slice(0, 3)
      : trade.type === "FxForward"
        ? trade.buyCurrency
        : trade.type === "FxSwap"
          ? trade.nearLeg.buyCurrency
          : "currency" in trade
            ? trade.currency
            : trade.type === "Swaption"
              ? trade.underlying.legs[0]!.currency
              : trade.legs[0]!.currency;
  const upfrontOn = trade.upfront !== undefined;
  const regulatory = !customerMode && (
    <>
      <div className="form-section" role="heading" aria-level={4}>
        Regulatorik (EMIR Refit)
      </div>
      <Field label="UTI" span2 issue={iss("uti")} hint="Unique Transaction Identifier (ISO 23897, 1–52 Zeichen A–Z/0–9) – Pflichtfeld im EMIR-Bewertungsexport">
        <input
          className="mono"
          value={trade.uti ?? ""}
          placeholder="z. B. 529900T8BM49AURSDO55…"
          onChange={(e) => upd({ uti: e.target.value.trim().toUpperCase() || undefined })}
          aria-label="UTI"
          aria-invalid={iss("uti") ? true : undefined}
          maxLength={60}
          spellCheck={false}
        />
      </Field>
      <Field label="Clearing">
        <Checkbox
          checked={trade.cleared ?? false}
          onChange={(v) => upd({ cleared: v, clearingMember: v ? trade.clearingMember : undefined })}
          label="zentral gecleart (Art. 4 EMIR)"
        />
      </Field>
      <Field label="Clearingpflicht" hint="EMIR-Feld 30 (TRUE / FLSE / UKWN) – unabhängig vom tatsächlichen Clearing (Feld 31: Y / N)">
        <Select
          value={trade.clearingObligation === undefined ? "UKWN" : trade.clearingObligation ? "TRUE" : "FLSE"}
          options={[
            { v: "UKWN" as const, l: "nicht bestimmt (UKWN)" },
            { v: "TRUE" as const, l: "ja – clearingpflichtig (TRUE)" },
            { v: "FLSE" as const, l: "nein (FLSE)" },
          ]}
          ariaLabel="Clearingpflicht"
          onChange={(v) => upd({ clearingObligation: v === "UKWN" ? undefined : v === "TRUE" })}
        />
      </Field>
      {trade.cleared && (
        <Field label="Clearing-Member">
          <input
            value={trade.clearingMember ?? ""}
            placeholder="z. B. Eurex Clearing AG"
            onChange={(e) => upd({ clearingMember: e.target.value || undefined })}
            aria-label="Clearing-Member"
          />
        </Field>
      )}
      {trade.status === "Quoted" && (
        <Field
          label="Angebot gültig bis"
          issue={
            trade.quoteValidUntil !== undefined && trade.quoteValidUntil < valuationDate
              ? { field: "quoteValidUntil", level: "warn", msg: "Angebot ist abgelaufen (vor dem Bewertungstag)" }
              : undefined
          }
        >
          <DateInput
            value={trade.quoteValidUntil ?? addTenor(valuationDate, "1W")}
            ariaLabel="Angebot gültig bis"
            onChange={(v) => upd({ quoteValidUntil: v })}
          />
        </Field>
      )}
    </>
  );
  const common = (
    <>
      <Field label="Bezeichnung" span2>
        <input value={trade.name ?? ""} onChange={(e) => upd({ name: e.target.value })} aria-label="Bezeichnung" />
      </Field>
      {!customerMode && (
        <Field label="Kontrahent" issue={iss("counterparty")}>
          <input value={trade.counterparty ?? ""} placeholder="(offen)" onChange={(e) => upd({ counterparty: e.target.value })} aria-label="Kontrahent" />
        </Field>
      )}
      {!customerMode && (
        <Field label="Buch">
          <input
            value={trade.book ?? ""}
            placeholder="z. B. Treasury"
            onChange={(e) => upd({ book: e.target.value || undefined })}
            aria-label="Buch"
            list="book-suggestions"
          />
        </Field>
      )}
      <Field label="Status">
        <Select
          value={trade.status ?? "Indication"}
          options={TRADE_STATUSES.map((v) => ({ v, l: STATUS_LABELS[v] }))}
          ariaLabel="Status"
          onChange={(v) =>
            upd({ status: v, quoteValidUntil: v === "Quoted" ? (trade.quoteValidUntil ?? addTenor(valuationDate, "1W")) : trade.quoteValidUntil })
          }
        />
      </Field>
      <Field
        label="Collateral (CSA)"
        hint={
          trade.type === "CrossCurrencySwap" && !trade.collateralCurrency
            ? "ohne CSA keine Xccy-Basis – jedes Leg wird auf seiner eigenen OIS-Kurve diskontiert"
            : "Diskontkurve nach Besicherung"
        }
        issue={
          collateralCurveMissing && trade.collateralCurrency
            ? {
                field: "collateralCurrency",
                level: "warn",
                msg: `Für die gewählte CSA-Währung ${trade.collateralCurrency} existiert keine Collateral-Kurve – Diskontierung auf der eigenen OIS-Kurve, Cross-Currency-Basis nicht gepreist (${translateCoreMessage(collateralCurveMissing)})`,
              }
            : undefined
        }
      >
        <Select
          value={(trade.collateralCurrency ?? "") as string}
          options={[{ v: "", l: "unbesichert" }, ...CCYS.map((c) => ({ v: c, l: `${c}-CSA` }))]}
          ariaLabel="Collateral-Währung"
          onChange={(v) => upd({ collateralCurrency: v || undefined })}
        />
      </Field>
      <Field label="Upfront / Prämie" hint="+ = wir zahlen">
        <OptNumInput
          value={trade.upfront?.amount}
          step={1000}
          unit={trade.upfront?.currency ?? baseCcy}
          placeholder="keine"
          ariaLabel="Upfront-Betrag"
          onChange={(v) =>
            upd({
              upfront: v === undefined ? undefined : { amount: v, currency: trade.upfront?.currency ?? baseCcy, date: trade.upfront?.date ?? valuationDate },
            })
          }
        />
      </Field>
      {upfrontOn && (
        <>
          <Field label="Upfront-Währung">
            <Select
              value={trade.upfront!.currency}
              options={[...new Set([...CCYS, trade.upfront!.currency])]}
              ariaLabel="Upfront-Währung"
              onChange={(v) => upd({ upfront: { ...trade.upfront!, currency: v } })}
            />
          </Field>
          <Field label="Upfront-Datum">
            <DateInput value={trade.upfront!.date} ariaLabel="Upfront-Datum" onChange={(v) => upd({ upfront: { ...trade.upfront!, date: v } })} />
          </Field>
        </>
      )}
      {regulatory}
    </>
  );

  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      const setLeg = (i: number, patch: LegPatch) =>
        onChange({ ...trade, legs: trade.legs.map((l, j) => (j === i ? ({ ...l, ...patch } as SwapLeg) : l)) } as Trade);
      const setBoth = (patch: LegPatch) => onChange({ ...trade, legs: trade.legs.map((l) => ({ ...l, ...patch }) as SwapLeg) } as Trade);
      const leg0 = trade.legs[0]!;
      return (
        <div className="stack">
          <div className="form">
            {common}
            {trade.type === "InterestRateSwap" && (
              <>
                <Field label="Währung">
                  <Select value={leg0.currency} options={CCYS} onChange={(v) => setBoth({ currency: v })} />
                </Field>
                <Field label="Nominal">
                  <NumInput
                    value={leg0.notional}
                    step={100000}
                    unit={leg0.currency}
                    error={iss("notional:0")?.msg}
                    level={iss("notional:0")?.level}
                    ariaLabel="Nominal"
                    onChange={(v) => setBoth({ notional: v })}
                  />
                </Field>
              </>
            )}
            <Field label="Startdatum">
              <DateInput value={leg0.effectiveDate} ariaLabel="Startdatum" onChange={(v) => setBoth({ effectiveDate: v })} />
            </Field>
            <Field label="Enddatum" issue={iss("terminationDate:0")}>
              <DateInput
                value={leg0.terminationDate}
                ariaLabel="Enddatum"
                invalid={!!iss("terminationDate:0")}
                base={leg0.effectiveDate}
                onChange={(v) => setBoth({ terminationDate: v })}
              />
            </Field>
            {trade.type === "CrossCurrencySwap" && (
              <>
                <Field label="Nominalaustausch">
                  <span className="row wrap" style={{ gap: 10 }}>
                    <Checkbox
                      checked={leg0.notionalExchange?.initial ?? false}
                      onChange={(v) =>
                        setBoth({ notionalExchange: { initial: v, final: leg0.notionalExchange?.final ?? false, interim: leg0.notionalExchange?.interim } })
                      }
                      label="Start"
                    />
                    <Checkbox
                      checked={leg0.notionalExchange?.final ?? false}
                      onChange={(v) =>
                        setBoth({ notionalExchange: { initial: leg0.notionalExchange?.initial ?? false, final: v, interim: leg0.notionalExchange?.interim } })
                      }
                      label="Ende"
                    />
                    <Checkbox
                      checked={leg0.notionalExchange?.interim ?? false}
                      onChange={(v) =>
                        setBoth({
                          notionalExchange: { initial: leg0.notionalExchange?.initial ?? false, final: leg0.notionalExchange?.final ?? false, interim: v },
                        })
                      }
                      label="Interim (bei Nominaländerung)"
                    />
                  </span>
                </Field>
                <Field label="MtM-Reset" hint="Nominal des Reset-Legs wird je Periode am Forward-Kurs neu fixiert">
                  <Select
                    value={trade.mtmReset ? String(trade.mtmReset.resettingLegIndex) : ""}
                    options={[
                      { v: "", l: "kein Reset (konstantes Nominal)" },
                      ...trade.legs.map((l, i) => ({ v: String(i), l: `Leg ${i + 1} (${l.currency})` })),
                    ]}
                    ariaLabel="MtM-Reset"
                    onChange={(v) => upd({ mtmReset: v === "" ? undefined : { resettingLegIndex: Number(v) } } as Partial<CrossCurrencySwap>)}
                  />
                </Field>
              </>
            )}
          </div>
          <AmortisationEditor
            legs={trade.legs.map((l) => ({ ...l, label: l.type === "Fixed" ? "Fest" : l.index }))}
            onSchedule={(targets, schedule) =>
              onChange({ ...trade, legs: trade.legs.map((l, i) => (targets.includes(i) ? { ...l, notionalSchedule: schedule } : l)) } as Trade)
            }
          />
          {trade.legs.map((leg, i) => (
            <div key={i} className="card" style={{ padding: 10 }}>
              <h3>
                Leg {i + 1} · {leg.type === "Fixed" ? "Festzins" : `Variabel ${(leg as FloatLeg).index}`}
                <span className="right">
                  <div className="seg" role="group" aria-label={`Richtung Leg ${i + 1}`}>
                    {(["Pay", "Receive"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={leg.payReceive === p ? "active" : ""}
                        aria-pressed={leg.payReceive === p}
                        onClick={() => setLeg(i, { payReceive: p })}
                      >
                        {p === "Pay" ? "Zahlen" : "Erhalten"}
                      </button>
                    ))}
                  </div>
                </span>
              </h3>
              <div className="form">
                {trade.type === "CrossCurrencySwap" && (
                  <>
                    <Field label="Währung">
                      <Select value={leg.currency} options={CCYS} onChange={(v) => setLeg(i, { currency: v })} />
                    </Field>
                    <Field label="Nominal">
                      <NumInput
                        value={leg.notional}
                        step={100000}
                        unit={leg.currency}
                        error={iss(`notional:${i}`)?.msg}
                        level={iss(`notional:${i}`)?.level}
                        ariaLabel={`Nominal Leg ${i + 1}`}
                        onChange={(v) => setLeg(i, { notional: v })}
                      />
                    </Field>
                  </>
                )}
                {leg.type === "Fixed" ? (
                  <Field label="Festsatz">
                    <NumInput
                      value={(leg as FixedLeg).rate}
                      scale={100}
                      step={0.005}
                      unit="%"
                      error={iss(`rate:${i}`)?.msg}
                      level={iss(`rate:${i}`)?.level}
                      ariaLabel={`Festsatz Leg ${i + 1}`}
                      onChange={(v) => setLeg(i, { rate: v })}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Index">
                      <Select value={(leg as FloatLeg).index} options={INDICES} onChange={(v) => setLeg(i, { index: v })} />
                    </Field>
                    <Field label="Spread">
                      <NumInput
                        value={(leg as FloatLeg).spread ?? 0}
                        scale={1e4}
                        step={1}
                        unit="bp"
                        error={iss(`spread:${i}`)?.msg}
                        level={iss(`spread:${i}`)?.level}
                        ariaLabel={`Spread Leg ${i + 1}`}
                        onChange={(v) => setLeg(i, { spread: v })}
                      />
                    </Field>
                  </>
                )}
                <Field label="Frequenz">
                  <Select value={leg.frequency} options={FREQS} onChange={(v) => setLeg(i, { frequency: v })} />
                </Field>
                <Field label="Tageszählung">
                  <Select value={leg.dayCount} options={DAYCOUNTS} onChange={(v) => setLeg(i, { dayCount: v })} />
                </Field>
              </div>
              <CouponScheduleEditor leg={leg} legIndex={i} onChange={(patch) => setLeg(i, patch)} />
              <LegConventions leg={leg} onChange={(patch) => setLeg(i, patch)} open={convOpen} onToggle={toggleConv} />
            </div>
          ))}
        </div>
      );
    }
    case "CapFloor":
      return (
        <div className="stack">
          <div className="form">
            {common}
            <Field label="Art">
              <Select value={trade.capFloor} options={optionsFrom(["Cap", "Floor", "Collar"] as const, CAPFLOOR_DE)} onChange={(v) => upd({ capFloor: v })} />
            </Field>
            <Field label="Position">
              <Select
                value={trade.payReceive}
                options={[
                  { v: "Receive" as const, l: "Long (Käufer)" },
                  { v: "Pay" as const, l: "Short (Verkäufer)" },
                ]}
                onChange={(v) => upd({ payReceive: v })}
              />
            </Field>
            <Field label="Währung">
              <Select value={trade.currency} options={CCYS} onChange={(v) => upd({ currency: v })} />
            </Field>
            <Field label="Index">
              <Select value={trade.index} options={INDICES} onChange={(v) => upd({ index: v })} />
            </Field>
            <Field label="Nominal">
              <NumInput
                value={trade.notional}
                step={100000}
                unit={trade.currency}
                error={iss("notional")?.msg}
                level={iss("notional")?.level}
                ariaLabel="Nominal"
                onChange={(v) => upd({ notional: v })}
              />
            </Field>
            <Field label={trade.capFloor === "Floor" ? "Floor-Strike" : "Cap-Strike"}>
              <NumInput
                value={trade.strike}
                scale={100}
                step={0.05}
                unit="%"
                error={iss("strike")?.msg}
                level={iss("strike")?.level}
                ariaLabel="Strike"
                onChange={(v) => upd({ strike: v })}
              />
            </Field>
            {trade.capFloor === "Collar" && (
              <Field label="Floor-Strike">
                <NumInput
                  value={trade.floorStrike ?? 0}
                  scale={100}
                  step={0.05}
                  unit="%"
                  error={iss("floorStrike")?.msg}
                  level={iss("floorStrike")?.level}
                  ariaLabel="Floor-Strike"
                  onChange={(v) => upd({ floorStrike: v })}
                />
              </Field>
            )}
            <Field label="Start">
              <DateInput value={trade.effectiveDate} ariaLabel="Start" onChange={(v) => upd({ effectiveDate: v })} />
            </Field>
            <Field label="Ende" issue={iss("terminationDate")}>
              <DateInput
                value={trade.terminationDate}
                ariaLabel="Ende"
                invalid={!!iss("terminationDate")}
                base={trade.effectiveDate}
                onChange={(v) => upd({ terminationDate: v })}
              />
            </Field>
            <Field label="Frequenz">
              <Select value={trade.frequency} options={FREQS} onChange={(v) => upd({ frequency: v })} />
            </Field>
            <Field label="Modell">
              <Select
                value={trade.model ?? "Bachelier"}
                options={optionsFrom(["Bachelier", "Black", "ShiftedBlack"] as const, MODEL_DE)}
                onChange={(v) => upd({ model: v })}
              />
            </Field>
            <Field label="Vol-Override (leer = Fläche)">
              <OptNumInput
                value={trade.volOverride}
                scale={1e4}
                step={1}
                unit="bp"
                placeholder="Fläche"
                error={iss("volOverride")?.msg}
                level={iss("volOverride")?.level}
                ariaLabel="Vol-Override"
                onChange={(v) => upd({ volOverride: v })}
              />
            </Field>
          </div>
          <AmortisationEditor legs={[{ ...trade, label: trade.index }]} onSchedule={(_targets, schedule) => upd({ notionalSchedule: schedule })} />
          <Collapsible title="Konventionen" open={convOpen} onToggle={toggleConv}>
            <Field label="Stub">
              <Select value={trade.stub ?? "ShortFront"} options={STUBS} onChange={(v) => upd({ stub: v })} />
            </Field>
            <Field label="Business-Day-Convention">
              <Select value={trade.businessDayConvention ?? "ModifiedFollowing"} options={BDCS} onChange={(v) => upd({ businessDayConvention: v })} />
            </Field>
          </Collapsible>
        </div>
      );
    case "Swaption": {
      const fixed = trade.underlying.legs.find((l): l is FixedLeg => l.type === "Fixed")!;
      const setUnderlying = (patch: LegPatch) =>
        onChange({ ...trade, underlying: { ...trade.underlying, legs: trade.underlying.legs.map((l) => ({ ...l, ...patch }) as SwapLeg) } });
      /** Currency change rebuilds the underlying swap with the market conventions of the new currency (index, frequencies, day counts) – Markt R4-2. */
      const setCurrency = (ccy: string) => {
        const rebuilt = makeVanillaSwap({
          id: trade.underlying.id,
          currency: ccy,
          notional: fixed.notional,
          payReceiveFixed: fixed.payReceive,
          fixedRate: fixed.rate,
          effectiveDate: fixed.effectiveDate,
          maturity: fixed.terminationDate,
        });
        onChange({ ...trade, underlying: { ...trade.underlying, legs: rebuilt.legs } });
      };
      const ccyOptions = [...new Set([...swaptionVolCurrencies, fixed.currency])].map((c) => ({
        v: c,
        l: swaptionVolCurrencies.includes(c) ? `${c} (Vol-Cube)` : `${c} (ohne Vol-Cube – Fallback-Vol)`,
      }));
      return (
        <div className="form">
          {common}
          <Field label="Währung" hint="Währungen mit Swaption-Vol-Cube im Markt; der Underlying-Swap folgt den Marktkonventionen der Währung">
            <Select value={fixed.currency} options={ccyOptions} ariaLabel="Währung" onChange={setCurrency} />
          </Field>
          <Field label="Typ">
            <Select
              value={trade.payerReceiver}
              options={optionsFrom(["Payer", "Receiver"] as const, PAYER_RECEIVER_DE)}
              onChange={(v) =>
                onChange({
                  ...trade,
                  payerReceiver: v,
                  underlying: {
                    ...trade.underlying,
                    legs: trade.underlying.legs.map(
                      (l) => ({ ...l, payReceive: l.type === "Fixed" ? (v === "Payer" ? "Pay" : "Receive") : v === "Payer" ? "Receive" : "Pay" }) as SwapLeg,
                    ),
                  },
                })
              }
            />
          </Field>
          <Field label="Position">
            <Select
              value={trade.payReceive}
              options={[
                { v: "Receive" as const, l: "Long" },
                { v: "Pay" as const, l: "Short" },
              ]}
              onChange={(v) => upd({ payReceive: v })}
            />
          </Field>
          <Field label="Verfall" issue={iss("expiryDate")}>
            <DateInput value={trade.expiryDate} ariaLabel="Verfall" invalid={iss("expiryDate")?.level === "error"} onChange={(v) => upd({ expiryDate: v })} />
          </Field>
          <Field label="Settlement">
            <Select value={trade.settlement} options={optionsFrom(["Physical", "Cash"] as const, SETTLEMENT_DE)} onChange={(v) => upd({ settlement: v })} />
          </Field>
          {trade.settlement === "Cash" && (
            <Field label="Cash-Konvention" hint="EUR-Standard seit 2018: Collateralised Cash Price">
              <Select
                value={trade.cashSettlementConvention ?? "CollateralisedCashPrice"}
                options={optionsFrom(["CollateralisedCashPrice", "IRR"] as const, CASH_CONVENTION_DE)}
                ariaLabel="Cash-Settlement-Konvention"
                onChange={(v) => upd({ cashSettlementConvention: v })}
              />
            </Field>
          )}
          <Field label="Strike">
            <NumInput
              value={fixed.rate}
              scale={100}
              step={0.005}
              unit="%"
              error={iss("strike")?.msg}
              level={iss("strike")?.level}
              ariaLabel="Strike"
              onChange={(v) => setUnderlying({ rate: v })}
            />
          </Field>
          <Field label="Nominal">
            <NumInput
              value={fixed.notional}
              step={100000}
              unit={fixed.currency}
              error={iss("notional")?.msg}
              level={iss("notional")?.level}
              ariaLabel="Nominal"
              onChange={(v) => setUnderlying({ notional: v })}
            />
          </Field>
          <Field label="Swap-Start">
            <DateInput value={fixed.effectiveDate} ariaLabel="Swap-Start" onChange={(v) => setUnderlying({ effectiveDate: v })} />
          </Field>
          <Field label="Swap-Ende" issue={iss("swapEnd")}>
            <DateInput
              value={fixed.terminationDate}
              ariaLabel="Swap-Ende"
              invalid={!!iss("swapEnd")}
              base={fixed.effectiveDate}
              onChange={(v) => setUnderlying({ terminationDate: v })}
            />
          </Field>
          <Field label="Modell">
            <Select
              value={trade.model ?? "Bachelier"}
              options={optionsFrom(["Bachelier", "Black", "ShiftedBlack"] as const, MODEL_DE)}
              onChange={(v) => upd({ model: v })}
            />
          </Field>
          <Field label="Vol-Override">
            <OptNumInput
              value={trade.volOverride}
              scale={1e4}
              step={1}
              unit="bp"
              placeholder="Fläche"
              error={iss("volOverride")?.msg}
              level={iss("volOverride")?.level}
              ariaLabel="Vol-Override"
              onChange={(v) => upd({ volOverride: v })}
            />
          </Field>
        </div>
      );
    }
    case "FxForward":
      return (
        <div className="form">
          {common}
          <Field label="Kaufen">
            <Select value={trade.buyCurrency} options={CCYS} ariaLabel="Kaufwährung" onChange={(v) => upd({ buyCurrency: v })} />
          </Field>
          <Field label="Betrag kaufen">
            <NumInput
              value={trade.buyAmount}
              step={10000}
              unit={trade.buyCurrency}
              error={iss("buyAmount")?.msg}
              level={iss("buyAmount")?.level}
              ariaLabel="Betrag kaufen"
              onChange={(v) => upd({ buyAmount: v })}
            />
          </Field>
          <Field label="Verkaufen" issue={iss("sellCurrency")}>
            <Select
              value={trade.sellCurrency}
              options={CCYS}
              invalid={!!iss("sellCurrency")}
              ariaLabel="Verkaufswährung"
              onChange={(v) => upd({ sellCurrency: v })}
            />
          </Field>
          <Field label="Betrag verkaufen">
            <NumInput
              value={trade.sellAmount}
              step={10000}
              unit={trade.sellCurrency}
              error={iss("sellAmount")?.msg}
              level={iss("sellAmount")?.level}
              ariaLabel="Betrag verkaufen"
              onChange={(v) => upd({ sellAmount: v })}
            />
          </Field>
          {(() => {
            const mr = marketRate(trade.buyCurrency, trade.buyAmount, trade.sellCurrency, trade.sellAmount);
            return (
              <Field label={mr.label}>
                <NumInput value={Math.round(mr.rate * 1e6) / 1e6} step={0.0001} digits={4} ariaLabel={mr.label} onChange={(v) => upd(mr.setFromRate(v))} />
              </Field>
            );
          })()}
          <Field label="Lieferung">
            <DateInput
              value={trade.deliveryDate}
              ariaLabel="Lieferung"
              onChange={(v) => upd({ deliveryDate: v, ...(trade.ndf ? { ndf: { ...trade.ndf, fixingDate: Math.min(trade.ndf.fixingDate, v) } } : {}) })}
            />
          </Field>
          <Field label="NDF" hint="Barausgleich in der Settlement-Währung am Fixing">
            <Checkbox
              checked={!!trade.ndf}
              onChange={(v) =>
                upd({
                  ndf: v
                    ? {
                        fixingDate: trade.deliveryDate - 2,
                        settlementCurrency:
                          CCY_PRIORITY.indexOf(trade.buyCurrency) <= CCY_PRIORITY.indexOf(trade.sellCurrency) ? trade.sellCurrency : trade.buyCurrency,
                      }
                    : undefined,
                })
              }
              label="Non-Deliverable Forward"
            />
          </Field>
          {trade.ndf && (
            <>
              <Field label="NDF-Fixing">
                <DateInput value={trade.ndf.fixingDate} ariaLabel="NDF-Fixing" onChange={(v) => upd({ ndf: { ...trade.ndf!, fixingDate: v } })} />
              </Field>
              <Field label="Settlement-Währung">
                <Select
                  value={trade.ndf.settlementCurrency}
                  options={[...new Set([trade.buyCurrency, trade.sellCurrency, ...CCYS])]}
                  ariaLabel="NDF-Settlement-Währung"
                  onChange={(v) => upd({ ndf: { ...trade.ndf!, settlementCurrency: v } })}
                />
              </Field>
            </>
          )}
        </div>
      );
    case "FxOption": {
      const payout: Payout = trade.digital ? (trade.digital.payoutCurrency === trade.pair.slice(0, 3) ? "DigitalAsset" : "DigitalCash") : "Vanilla";
      return (
        <div className="form">
          {common}
          <Field
            label="Paar"
            hint={
              hasFxVolSurface(trade.pair, fxVolPairs)
                ? undefined
                : `Keine FX-Vol-Fläche für ${trade.pair.slice(0, 3)}/${trade.pair.slice(3)} im Markt – Bewertung mit Fallback-Vol 8 % (IFRS-13 Level 3)`
            }
          >
            <Select value={trade.pair} options={PAIRS} onChange={(v) => upd({ pair: v })} />
          </Field>
          <Field label="Typ (auf Basis-Ccy)">
            <Select value={trade.optionType} options={optionsFrom(["Call", "Put"] as const, OPTION_TYPE_DE)} onChange={(v) => upd({ optionType: v })} />
          </Field>
          <Field label="Position">
            <Select
              value={trade.payReceive}
              options={[
                { v: "Receive" as const, l: "Long" },
                { v: "Pay" as const, l: "Short" },
              ]}
              onChange={(v) => upd({ payReceive: v })}
            />
          </Field>
          <Field label="Nominal (Basis)">
            <NumInput
              value={trade.notional}
              step={10000}
              unit={trade.pair.slice(0, 3)}
              error={iss("notional")?.msg}
              level={iss("notional")?.level}
              ariaLabel="Nominal"
              onChange={(v) => upd({ notional: v })}
            />
          </Field>
          <Field label="Strike">
            <NumInput
              value={trade.strike}
              step={0.0025}
              digits={4}
              error={iss("strike")?.msg}
              level={iss("strike")?.level}
              ariaLabel="Strike"
              onChange={(v) => upd({ strike: v })}
            />
          </Field>
          <Field label="Verfall">
            <DateInput
              value={trade.expiryDate}
              ariaLabel="Verfall"
              onChange={(v) => upd({ expiryDate: v, deliveryDate: Math.max(trade.deliveryDate, v + 2) })}
            />
          </Field>
          <Field label="Lieferung" issue={iss("deliveryDate")}>
            <DateInput
              value={trade.deliveryDate}
              ariaLabel="Lieferung"
              invalid={!!iss("deliveryDate")}
              base={trade.expiryDate}
              onChange={(v) => upd({ deliveryDate: v })}
            />
          </Field>
          <Field label="Auszahlung">
            <Select
              value={payout}
              options={PAYOUTS}
              ariaLabel="Auszahlungsprofil"
              onChange={(v) =>
                upd({
                  digital:
                    v === "Vanilla"
                      ? undefined
                      : {
                          payoutCurrency: v === "DigitalAsset" ? trade.pair.slice(0, 3) : trade.pair.slice(3),
                          payout: trade.digital?.payout ?? (v === "DigitalAsset" ? trade.notional : Math.round(trade.notional * trade.strike)),
                        },
                })
              }
            />
          </Field>
          {trade.digital && (
            <Field label={`Auszahlungsbetrag (${trade.digital.payoutCurrency})`}>
              <NumInput
                value={trade.digital.payout}
                step={10000}
                min={0}
                unit={trade.digital.payoutCurrency}
                ariaLabel="Digital-Auszahlung"
                onChange={(v) => upd({ digital: { ...trade.digital!, payout: v } })}
              />
            </Field>
          )}
          <Field label="Barriere">
            <Select
              value={trade.barrier?.type ?? "None"}
              options={optionsFrom(["None", "UpOut", "UpIn", "DownOut", "DownIn"] as const, BARRIER_DE)}
              onChange={(v) =>
                upd({
                  barrier:
                    v === "None"
                      ? undefined
                      : {
                          type: v,
                          level: trade.barrier?.level ?? Math.round(trade.strike * (v.startsWith("Up") ? 1.06 : 0.94) * 10000) / 10000,
                          rebate: trade.barrier?.rebate,
                        },
                })
              }
            />
          </Field>
          {trade.barrier && (
            <>
              <Field label="Barriere-Level">
                <NumInput
                  value={trade.barrier.level}
                  step={0.0025}
                  digits={4}
                  error={iss("barrierLevel")?.msg}
                  ariaLabel="Barriere-Level"
                  onChange={(v) => upd({ barrier: { ...trade.barrier!, level: v } })}
                />
              </Field>
              <Field label={`Rebate (${trade.pair.slice(3)})`} hint="Zahlung bei Knock-out / ohne Knock-in">
                <OptNumInput
                  value={trade.barrier.rebate}
                  step={1000}
                  unit={trade.pair.slice(3)}
                  placeholder="kein"
                  ariaLabel="Barriere-Rebate"
                  onChange={(v) => upd({ barrier: { ...trade.barrier!, rebate: v } })}
                />
              </Field>
              <Field
                label="Barriere-Status"
                issue={iss("barrierHit")}
                hint={
                  trade.barrier.hit === undefined
                    ? "Unbekannt: der Kern leitet den Knock-Status aus dem heutigen Spot bzw. dem Verfallsfixing ab und warnt („Barriere-Status unbekannt“)"
                    : trade.barrier.hit
                      ? "Berührt: Knock-out → Rebate / 0, Knock-in → Vanilla"
                      : "Nicht berührt: bislang keine Berührung beobachtet (Berührungen vor dem Verfall werden nicht aus Fixings rekonstruiert)"
                }
              >
                <span className="row wrap" style={{ gap: 12 }} data-testid="barrier-hit">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={trade.barrier.hit === true}
                      aria-label="Barriere bereits berührt"
                      onChange={(e) => upd({ barrier: { ...trade.barrier!, hit: e.target.checked ? true : false } })}
                    />{" "}
                    Barriere bereits berührt
                  </label>
                  {trade.barrier.hit !== undefined && (
                    <button
                      type="button"
                      className="btn ghost xs"
                      onClick={() => {
                        const { hit: _hit, ...rest } = trade.barrier!;
                        upd({ barrier: rest });
                      }}
                      title="Knock-Status nicht festhalten – der Kern leitet ihn ab und warnt"
                    >
                      Status unbekannt
                    </button>
                  )}
                </span>
              </Field>
            </>
          )}
          <Field label="Vol-Override (leer = Smile)">
            <OptNumInput
              value={trade.volOverride}
              scale={100}
              step={0.1}
              unit="%"
              placeholder="Smile"
              error={iss("volOverride")?.msg}
              level={iss("volOverride")?.level}
              ariaLabel="Vol-Override"
              onChange={(v) => upd({ volOverride: v })}
            />
          </Field>
        </div>
      );
    }
    case "FRA":
      return (
        <div className="form">
          {common}
          <Field label="Richtung">
            <Select
              value={trade.payReceive}
              options={[
                { v: "Pay" as const, l: "Fest zahlen" },
                { v: "Receive" as const, l: "Fest erhalten" },
              ]}
              onChange={(v) => upd({ payReceive: v })}
            />
          </Field>
          <Field label="Währung">
            <Select value={trade.currency} options={CCYS} ariaLabel="Währung" onChange={(v) => upd({ currency: v })} />
          </Field>
          <Field label="Index" hint="Referenzzins der FRA-Periode">
            <Select value={trade.index} options={[...new Set([...INDICES, trade.index])]} ariaLabel="Index" onChange={(v) => upd({ index: v })} />
          </Field>
          <Field label="Nominal">
            <NumInput
              value={trade.notional}
              step={100000}
              unit={trade.currency}
              error={iss("notional")?.msg}
              level={iss("notional")?.level}
              ariaLabel="Nominal"
              onChange={(v) => upd({ notional: v })}
            />
          </Field>
          <Field label="Festsatz">
            <NumInput
              value={trade.fixedRate}
              scale={100}
              step={0.005}
              unit="%"
              error={iss("fixedRate")?.msg}
              level={iss("fixedRate")?.level}
              ariaLabel="Festsatz"
              onChange={(v) => upd({ fixedRate: v })}
            />
          </Field>
          <Field label="Start (Fixing-Periode)">
            <DateInput value={trade.startDate} ariaLabel="Start" onChange={(v) => upd({ startDate: v })} />
          </Field>
          <Field label="Ende" issue={iss("endDate")}>
            <DateInput value={trade.endDate} ariaLabel="Ende" invalid={!!iss("endDate")} base={trade.startDate} onChange={(v) => upd({ endDate: v })} />
          </Field>
          <Field label="Tageszählung">
            <Select value={trade.dayCount ?? "ACT/360"} options={DAYCOUNTS} ariaLabel="Tageszählung" onChange={(v) => upd({ dayCount: v })} />
          </Field>
        </div>
      );
    case "FxSwap": {
      const legEditor = (which: "nearLeg" | "farLeg", title: string) => {
        const leg = trade[which];
        const setLeg = (patch: Partial<typeof leg>) => onChange({ ...trade, [which]: { ...leg, ...patch } });
        return (
          <div className="card" style={{ padding: 10 }}>
            <h3>{title}</h3>
            <div className="form">
              <Field label="Kaufen">
                <Select value={leg.buyCurrency} options={CCYS} ariaLabel={`${title} Kaufwährung`} onChange={(v) => setLeg({ buyCurrency: v })} />
              </Field>
              <Field label="Betrag kaufen">
                <NumInput
                  value={leg.buyAmount}
                  step={10000}
                  unit={leg.buyCurrency}
                  error={iss(`${which}.buyAmount`)?.msg}
                  ariaLabel={`${title} Betrag kaufen`}
                  onChange={(v) => setLeg({ buyAmount: v })}
                />
              </Field>
              <Field label="Verkaufen" issue={iss(`${which}.sellCurrency`)}>
                <Select
                  value={leg.sellCurrency}
                  options={CCYS}
                  invalid={!!iss(`${which}.sellCurrency`)}
                  ariaLabel={`${title} Verkaufswährung`}
                  onChange={(v) => setLeg({ sellCurrency: v })}
                />
              </Field>
              <Field label="Betrag verkaufen">
                <NumInput
                  value={leg.sellAmount}
                  step={10000}
                  unit={leg.sellCurrency}
                  error={iss(`${which}.sellAmount`)?.msg}
                  ariaLabel={`${title} Betrag verkaufen`}
                  onChange={(v) => setLeg({ sellAmount: v })}
                />
              </Field>
              {(() => {
                const mr = marketRate(leg.buyCurrency, leg.buyAmount, leg.sellCurrency, leg.sellAmount);
                return (
                  <Field label={mr.label}>
                    <NumInput
                      value={Math.round(mr.rate * 1e6) / 1e6}
                      step={0.0001}
                      digits={4}
                      ariaLabel={`${title} ${mr.label}`}
                      onChange={(v) => setLeg(mr.setFromRate(v))}
                    />
                  </Field>
                );
              })()}
              <Field label="Valuta" issue={which === "farLeg" ? iss("farLeg.deliveryDate") : undefined}>
                <DateInput
                  value={leg.deliveryDate}
                  ariaLabel={`${title} Valuta`}
                  invalid={which === "farLeg" && !!iss("farLeg.deliveryDate")}
                  onChange={(v) => setLeg({ deliveryDate: v })}
                />
              </Field>
            </div>
          </div>
        );
      };
      return (
        <div className="stack">
          <div className="form">{common}</div>
          {legEditor("nearLeg", "Near Leg (Kassa)")}
          {legEditor("farLeg", "Far Leg (Termin)")}
        </div>
      );
    }
  }
}
