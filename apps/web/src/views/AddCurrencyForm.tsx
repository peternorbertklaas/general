import { useMemo, useState } from "react";
import { type DayCountConvention, type RateIndex, type SwapConventions, knownCurrencies, parseISO, toISO } from "@deriva/pricing-core";
import { NumInput } from "../components/NumInput.js";
import { parseDateInput } from "../lib/date-parse.js";
import { escapeCloses } from "../lib/focus.js";
import {
  type CustomCalendarJson,
  type RegisterEnvelope,
  envelopeSummary,
  isBuiltInCurrency,
  listCustomCalendars,
  validateEnvelope,
} from "../lib/register-envelope.js";
import { useStore } from "../state/store.js";

const DAYCOUNTS: DayCountConvention[] = ["ACT/360", "ACT/365F", "30E/360", "30/360", "ACT/ACT ISDA"];
const FIXED_FREQS = ["1Y", "6M", "3M"];
const IBOR_TENORS = ["1M", "3M", "6M", "12M"];
/** Calendars shipped with the engine (ids as registered in `dates/calendar.ts`). */
const BUILT_IN_CALENDARS = ["TARGET", "US", "US-SIFMA", "UK", "CH", "JP", "DE", "NO", "SE", "DK", "PL", "NONE"];

/** Holiday lines of the "+ Kalender" textarea (ISO or German dates, one per line) → sorted ISO list or a German error. */
export function parseHolidayLines(text: string): { holidays: string[]; error?: string } {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const d = parseDateInput(line, { base: 0 });
    if (d === undefined) return { holidays: [], error: `Feiertag „${line}“ nicht lesbar – Datum als 06.07.2027 oder 2027-07-06` };
    out.add(toISO(d));
  }
  return { holidays: [...out].sort() };
}

/**
 * The register envelope of the "+ Währung" form (pure – used by the form and by tests): OIS index (required), optional
 * IBOR index (without it the OIS index is the float benchmark), swap conventions, optional custom calendar.
 */
export function buildCurrencyEnvelope(p: {
  currency: string;
  calendar: string;
  fixedFrequency: string;
  fixedDayCount: DayCountConvention;
  spotLag: number;
  ois: { name: string; dayCount: DayCountConvention; fixingLag: number; paymentLag: number };
  ibor?: { name: string; tenor: string; dayCount: DayCountConvention; fixingLag: number };
  customCalendar?: CustomCalendarJson;
}): RegisterEnvelope {
  const ccy = p.currency.trim().toUpperCase();
  const cal = (p.customCalendar?.id ?? p.calendar).trim().toUpperCase();
  const oisName = p.ois.name.trim().toUpperCase();
  const ois: RateIndex = {
    name: oisName,
    currency: ccy,
    type: "OIS",
    tenor: "1D",
    dayCount: p.ois.dayCount,
    fixingCalendar: cal,
    fixingLag: p.ois.fixingLag,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: false,
    curveId: `${ccy}-${oisName}`,
  };
  const indices: RateIndex[] = [ois];
  let floatIndex = oisName;
  let floatFrequency = "1Y";
  if (p.ibor?.name.trim()) {
    const iborName = p.ibor.name.trim().toUpperCase();
    indices.push({
      name: iborName,
      currency: ccy,
      type: "IBOR",
      tenor: p.ibor.tenor.toUpperCase(),
      dayCount: p.ibor.dayCount,
      fixingCalendar: cal,
      fixingLag: p.ibor.fixingLag,
      businessDayConvention: "ModifiedFollowing",
      endOfMonth: true,
      curveId: `${ccy}-${iborName}`,
    });
    floatIndex = iborName;
    floatFrequency = p.ibor.tenor.toUpperCase();
  }
  const conventions: SwapConventions = {
    currency: ccy,
    fixedFrequency: p.fixedFrequency,
    fixedDayCount: p.fixedDayCount,
    floatIndex,
    floatFrequency,
    calendar: cal,
    spotLag: p.spotLag,
    oisIndex: oisName,
    oisFixedFrequency: "1Y",
    oisFixedDayCount: p.ois.dayCount,
    oisPaymentLag: p.ois.paymentLag,
  };
  return { indices, conventions: [conventions], ...(p.customCalendar ? { calendars: [p.customCalendar] } : {}) };
}

/**
 * "+ Währung" (Markt R8-1 / R8-2): register a currency in the workstation the way the API does with
 * `POST /api/market/indices|conventions|calendars` – conventions (fixed / float frequency and day count), an OIS index
 * and an optional IBOR index (name, tenor, day count, fixing lag) and the calendar (built in, a custom one, or a new
 * one with a holiday list via "+ Kalender"). Persisted like `extraCurves`, re-registered on load, one undo entry,
 * exported in the snapshot envelope. Afterwards "+ Kurve", the quick entry and the editor accept the currency.
 */
/**
 * Toast after a successful „+ Währung“ (R9-03 / Markt R9-2): in sample mode the next step is „+ Kurve“; under an
 * imported snapshot „+ Kurve“ is locked, so the toast names the two ways to a curve instead of a disabled button.
 */
export function registrationToast(summary: string, code: string, marketSource: "sample" | "import"): string {
  return marketSource === "import"
    ? `Registriert: ${summary} – im Import-Modus ist „+ Kurve“ gesperrt: nach „Zum Sample-Markt“ mit „+ Kurve“ eine ${code}-Kurve anlegen oder einen Snapshot mit ${code}-Kurve importieren`
    : `Registriert: ${summary} – jetzt mit „+ Kurve“ eine ${code}-Kurve anlegen`;
}

export function AddCurrencyForm({ onDone }: { onDone: (currency?: string) => void }) {
  const extraRegister = useStore((s) => s.extraRegister);
  const marketSource = useStore((s) => s.marketSource);
  const [ccy, setCcy] = useState("CZK");
  const [calendar, setCalendar] = useState("TARGET");
  const [fixedFrequency, setFixedFrequency] = useState("1Y");
  const [fixedDayCount, setFixedDayCount] = useState<DayCountConvention>("ACT/360");
  const [spotLag, setSpotLag] = useState(2);
  const [oisName, setOisName] = useState("");
  const [oisDayCount, setOisDayCount] = useState<DayCountConvention>("ACT/360");
  const [oisFixingLag, setOisFixingLag] = useState(0);
  const [oisPaymentLag, setOisPaymentLag] = useState(2);
  const [iborName, setIborName] = useState("");
  const [iborTenor, setIborTenor] = useState("6M");
  const [iborDayCount, setIborDayCount] = useState<DayCountConvention>("ACT/360");
  const [iborFixingLag, setIborFixingLag] = useState(2);
  const [addingCalendar, setAddingCalendar] = useState(false);
  const [calId, setCalId] = useState("");
  const [calName, setCalName] = useState("");
  const [calHolidays, setCalHolidays] = useState("");
  const [calWeekends, setCalWeekends] = useState(true);
  const code = ccy.trim().toUpperCase();
  const custom = listCustomCalendars();
  const registeredHere = (extraRegister.conventions ?? []).map((c) => c.currency.toUpperCase());
  const holidays = useMemo(() => parseHolidayLines(calHolidays), [calHolidays]);
  const customCalendar = useMemo<CustomCalendarJson | undefined>(
    () =>
      addingCalendar && calId.trim()
        ? {
            id: calId.trim().toUpperCase(),
            ...(calName.trim() ? { name: calName.trim() } : {}),
            holidays: holidays.holidays,
            ...(calWeekends ? {} : { weekendsAreHolidays: false }),
          }
        : undefined,
    [addingCalendar, calId, calName, holidays, calWeekends],
  );
  const envelope = useMemo(
    () =>
      buildCurrencyEnvelope({
        currency: code,
        calendar,
        fixedFrequency,
        fixedDayCount,
        spotLag,
        ois: { name: oisName, dayCount: oisDayCount, fixingLag: oisFixingLag, paymentLag: oisPaymentLag },
        ibor: iborName.trim() ? { name: iborName, tenor: iborTenor, dayCount: iborDayCount, fixingLag: iborFixingLag } : undefined,
        customCalendar,
      }),
    [
      code,
      calendar,
      fixedFrequency,
      fixedDayCount,
      spotLag,
      oisName,
      oisDayCount,
      oisFixingLag,
      oisPaymentLag,
      iborName,
      iborTenor,
      iborDayCount,
      iborFixingLag,
      customCalendar,
    ],
  );
  const problem = !/^[A-Z]{3}$/.test(code)
    ? "Währung als ISO-Code mit drei Buchstaben angeben (z. B. CZK)"
    : isBuiltInCurrency(code)
      ? `${code} ist im Kern eingebaut – Konventionen sind bereits registriert („+ Kurve“ genügt)`
      : knownCurrencies().includes(code) && !registeredHere.includes(code)
        ? `${code} ist bereits registriert (z. B. aus einem Snapshot-Envelope) – „+ Kurve“ genügt`
        : !oisName.trim()
          ? "OIS-Index angeben (z. B. CZEONIA)"
          : addingCalendar && !calId.trim()
            ? "Kalender-ID angeben (z. B. CZ) oder „+ Kalender“ schließen"
            : holidays.error
              ? holidays.error
              : validateEnvelope(envelope);
  const submit = () => {
    if (problem) return;
    const st = useStore.getState();
    const r = st.addCurrencyRegistration(envelope);
    if (!r.ok) {
      st.showToast(`Währung nicht registriert – ${r.error}`, { ms: 8000 });
      return;
    }
    st.showToast(registrationToast(r.summary, code, marketSource), {
      action: { label: "Rückgängig", run: () => useStore.getState().undo() },
      ...(marketSource === "import" ? { ms: 10000 } : {}),
    });
    onDone(code);
  };
  const remove = (currency: string) => {
    const st = useStore.getState();
    const r = st.removeCurrencyRegistration(currency);
    st.showToast(
      r.ok ? `Registrierung ${currency} entfernt` : `Registrierung nicht entfernt – ${r.error}`,
      r.ok ? { action: { label: "Rückgängig", run: () => useStore.getState().undo() } } : { ms: 8000 },
    );
  };
  const dcSelect = (value: DayCountConvention, onChange: (v: DayCountConvention) => void, label: string) => (
    <select className="inline" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as DayCountConvention)}>
      {DAYCOUNTS.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  );
  // Field groups wrap inside themselves and shrink (R9-01): at 1024 px with the inspector open the card is ~640 px wide.
  const group: React.CSSProperties = { gap: 6, flexWrap: "wrap", minWidth: 0 };
  return (
    <div className="card" data-testid="add-currency-form" style={{ maxWidth: "100%", overflowWrap: "anywhere" }} onKeyDown={escapeCloses(() => onDone())}>
      <h3>
        + Währung registrieren
        <span className="right muted xs" style={{ whiteSpace: "normal" }}>
          Konventionen, OIS-/IBOR-Index und Kalender wie <code className="mono">POST /api/market/indices|conventions|calendars</code> · im Snapshot-Envelope
          exportiert
        </span>
      </h3>
      {registeredHere.length > 0 && (
        <div className="row wrap muted xs" style={{ gap: 6, marginBottom: 6 }} data-testid="add-currency-registered">
          Registriert per „+ Währung“:
          {registeredHere.map((c) => (
            <span key={c} className="chip">
              {c}
              <button
                className="btn ghost danger xs"
                aria-label={`Registrierung ${c} entfernen`}
                title="Registrierung entfernen (rückgängig mit Ctrl+Z)"
                onClick={() => remove(c)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Währung</span>
          <input
            className="mono"
            style={{ width: 60 }}
            value={ccy}
            maxLength={3}
            aria-label="Währung (ISO-Code)"
            data-testid="add-currency-code"
            onChange={(e) => setCcy(e.target.value)}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Kalender</span>
          <select
            className="inline"
            value={calendar}
            aria-label="Kalender der Währung"
            data-testid="add-currency-calendar"
            disabled={addingCalendar}
            onChange={(e) => setCalendar(e.target.value)}
          >
            {BUILT_IN_CALENDARS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {custom.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
                {c.name ? ` (${c.name})` : ""} – eigener Kalender
              </option>
            ))}
          </select>
          <button
            className="btn xs"
            aria-pressed={addingCalendar}
            data-testid="add-calendar"
            onClick={() => setAddingCalendar((v) => !v)}
            title="Eigenen Kalender mit Feiertagsliste anlegen (Kern-Typ CustomCalendar)"
          >
            + Kalender
          </button>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Fest-Leg</span>
          <select className="inline" value={fixedFrequency} aria-label="Frequenz des Fest-Legs" onChange={(e) => setFixedFrequency(e.target.value)}>
            {FIXED_FREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {dcSelect(fixedDayCount, setFixedDayCount, "Tageszählung des Fest-Legs")}
        </label>
        <label className="row" style={{ gap: 6 }} title="Spot-Lag der Swaps in Geschäftstagen">
          <span className="muted small">Spot-Lag</span>
          <span style={{ display: "inline-block", width: 64 }}>
            <NumInput
              inline
              value={spotLag}
              step={1}
              digits={0}
              min={0}
              max={5}
              ariaLabel="Spot-Lag (Geschäftstage)"
              width="100%"
              onChange={(v) => setSpotLag(Math.round(v))}
            />
          </span>
        </label>
      </div>
      {addingCalendar && (
        <div className="row wrap" style={{ gap: 12, marginTop: 8, alignItems: "flex-start" }} data-testid="add-calendar-form">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">Kalender-ID</span>
            <input
              className="mono"
              style={{ width: 70 }}
              value={calId}
              maxLength={12}
              aria-label="Kalender-ID"
              data-testid="add-calendar-id"
              onChange={(e) => setCalId(e.target.value)}
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">Name</span>
            <input style={{ width: 140 }} value={calName} aria-label="Kalender-Name" placeholder="Prag" onChange={(e) => setCalName(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted small">Feiertage (ein Datum je Zeile)</span>
            <textarea
              className="mono"
              rows={4}
              style={{ width: 160 }}
              value={calHolidays}
              aria-label="Feiertage des Kalenders"
              data-testid="add-calendar-holidays"
              spellCheck={false}
              onChange={(e) => setCalHolidays(e.target.value)}
            />
          </label>
          <label className="check" style={{ gap: 6 }}>
            <input type="checkbox" checked={calWeekends} onChange={(e) => setCalWeekends(e.target.checked)} /> Wochenenden sind Feiertage
          </label>
          <span className="muted xs">
            {holidays.holidays.length} Feiertage · Ergänzung zu den gelisteten Daten gibt es nicht (ohne Feiertage = reiner Wochenendkalender)
          </span>
        </div>
      )}
      <div className="row wrap" style={{ gap: 12, marginTop: 8, alignItems: "flex-start" }}>
        <label className="row" style={group}>
          <span className="muted small">OIS-Index</span>
          <input
            className="mono"
            style={{ width: 110 }}
            value={oisName}
            placeholder="CZEONIA"
            aria-label="Name des OIS-Index"
            data-testid="add-currency-ois"
            onChange={(e) => setOisName(e.target.value)}
          />
          {dcSelect(oisDayCount, setOisDayCount, "Tageszählung des OIS-Index")}
        </label>
        <label className="row" style={group} title="Fixing-Lag des OIS-Index in Geschäftstagen">
          <span className="muted small">Fixing-Lag</span>
          <span style={{ display: "inline-block", width: 64 }}>
            <NumInput
              inline
              value={oisFixingLag}
              step={1}
              digits={0}
              min={0}
              max={5}
              ariaLabel="Fixing-Lag des OIS-Index"
              width="100%"
              onChange={(v) => setOisFixingLag(Math.round(v))}
            />
          </span>
        </label>
        <label className="row" style={group} title="Zahlungs-Lag der OIS-Swaps in Geschäftstagen">
          <span className="muted small">Zahlungs-Lag</span>
          <span style={{ display: "inline-block", width: 64 }}>
            <NumInput
              inline
              value={oisPaymentLag}
              step={1}
              digits={0}
              min={0}
              max={5}
              ariaLabel="Zahlungs-Lag der OIS-Swaps"
              width="100%"
              onChange={(v) => setOisPaymentLag(Math.round(v))}
            />
          </span>
        </label>
      </div>
      {/* IBOR group with its fixing lag in one wrapping group (R9-01) – like „Spot-Lag“ in the head row */}
      <div className="row wrap" style={{ gap: 12, marginTop: 8, alignItems: "flex-start" }} data-testid="add-currency-ibor-row">
        <label className="row" style={group}>
          <span className="muted small">IBOR-Index (optional)</span>
          <input
            className="mono"
            style={{ width: 110 }}
            value={iborName}
            placeholder="PRIBOR-6M"
            aria-label="Name des IBOR-Index"
            data-testid="add-currency-ibor"
            onChange={(e) => setIborName(e.target.value)}
          />
          <select className="inline" value={iborTenor} aria-label="Tenor des IBOR-Index" onChange={(e) => setIborTenor(e.target.value)}>
            {IBOR_TENORS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {dcSelect(iborDayCount, setIborDayCount, "Tageszählung des IBOR-Index")}
        </label>
        <label className="row" style={group} title="Fixing-Lag des IBOR-Index in Geschäftstagen">
          <span className="muted small">Fixing-Lag</span>
          <span style={{ display: "inline-block", width: 64 }}>
            <NumInput
              inline
              value={iborFixingLag}
              step={1}
              digits={0}
              min={0}
              max={5}
              ariaLabel="Fixing-Lag des IBOR-Index"
              width="100%"
              onChange={(v) => setIborFixingLag(Math.round(v))}
            />
          </span>
        </label>
        <span className="muted xs" style={{ flex: "1 1 220px", minWidth: 0 }}>
          Ohne IBOR-Index ist der OIS-Index die Float-Benchmark der Swaps (Frequenz 1Y).
        </span>
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={submit} disabled={!!problem} data-testid="add-currency-submit">
          Währung registrieren
        </button>
        <button className="btn ghost" onClick={() => onDone()} data-testid="add-currency-cancel">
          Abbrechen
        </button>
        {problem ? (
          <span className="field-msg error" role="alert" data-testid="add-currency-problem">
            {problem}
          </span>
        ) : (
          <span className="muted xs" data-testid="add-currency-preview" style={{ flex: "1 1 220px", minWidth: 0 }}>
            {envelopeSummary(envelope)} · Kurven-IDs {envelope.indices!.map((i) => i.curveId).join(", ")} · Kalender {envelope.conventions![0]!.calendar}
            {customCalendar
              ? ` (neu, ${customCalendar.holidays.length} Feiertage${customCalendar.holidays[0] ? `, ab ${toISO(parseISO(customCalendar.holidays[0])).split("-").reverse().join(".")}` : ""})`
              : ""}
          </span>
        )}
      </div>
    </div>
  );
}
