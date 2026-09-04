import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  SAMPLE_QUOTES,
  type BootstrapResult,
  type CurveBuildSpec,
  type CurveQuote,
  type InterpolatedCurve,
  type InterpolationMethod,
  type RateIndex,
  type SampleMarketQuotes,
  bootstrapCurves,
  bumpQuote,
  knownCurrencies,
  knownIndices,
  parseISO,
  quoteDates,
  quoteLabel,
  sampleBootstrapSpecs,
  toISO,
} from "@deriva/pricing-core";
import { DateInput } from "../components/DateInput.js";
import { EChart, cssVar } from "../components/EChart.js";
import { NumInput } from "../components/NumInput.js";
import { useTableNav } from "../hooks/useTableNav.js";
import { focusWhenPresent } from "../lib/focus.js";
import { fmtDate, fmtNum, fmtPct } from "../lib/format.js";
import { INTERPOLATION_DE, translatePricingError } from "../lib/i18n.js";
import { rateOf } from "../lib/portfolio-io.js";
import { type ExtraCurve, extraCurveSpec, marketModified, useStore, validateExtraCurve } from "../state/store.js";

export { bumpQuote };

/** Months of a tenor token ("3M" → 3, "18M" → 18, "2Y" → 24, "1W" → 0.25) – for sorting quotes by pillar. */
export function tenorMonths(tenor: string): number {
  const m = /^(\d+)([DWMY])$/i.exec(tenor.trim());
  if (!m) return Number.POSITIVE_INFINITY;
  const n = Number(m[1]);
  switch (m[2]!.toUpperCase()) {
    case "D":
      return n / 30;
    case "W":
      return n / 4;
    case "M":
      return n;
    default:
      return n * 12;
  }
}

/** Pillar tenor of a quote ("5Y"); FRA quotes are keyed by their end tenor. */
export function quoteTenor(q: CurveQuote): string {
  if ("tenor" in q) return q.tenor;
  return "end" in q ? q.end : "";
}

/** Identity of a quote inside a quote set (type + tenor + pair) – used to find the shipped original of an edited row. */
export function quoteKey(q: CurveQuote): string {
  const pair = "pair" in q ? q.pair : "";
  return `${q.type}|${quoteTenor(q)}|${pair}`;
}

/**
 * New FX-swap-points quote for a curve (R3-6): the first tenor of 1M/3M/6M/9M
 * not yet used, the first market pair that contains the curve currency whose
 * other currency has a discount curve, points 0 (= forward at spot).
 */
export function newFxPointsQuote(
  currency: string,
  existing: CurveQuote[],
  fxSpots: Record<string, number>,
  discountCurveId: Record<string, string>,
): Extract<CurveQuote, { type: "FxSwapPoints" }> | undefined {
  const pairs = Object.keys(fxSpots).filter((p) => p.slice(0, 3) === currency || p.slice(3) === currency);
  const pair = pairs.find((p) => discountCurveId[p.slice(0, 3) === currency ? p.slice(3) : p.slice(0, 3)] !== undefined);
  if (!pair) return undefined;
  const other = pair.slice(0, 3) === currency ? pair.slice(3) : pair.slice(0, 3);
  const used = new Set(existing.filter((q) => q.type === "FxSwapPoints").map((q) => q.tenor));
  const tenor = ["1M", "3M", "6M", "9M", "2W", "1W"].find((t) => !used.has(t));
  if (!tenor) return undefined;
  return {
    type: "FxSwapPoints",
    tenor,
    points: 0,
    pair,
    fxSpot: fxSpots[pair]!,
    otherDiscountCurveId: discountCurveId[other]!,
    ...(other === "JPY" || currency === "JPY" ? { pipFactor: 100 } : {}),
  };
}

interface QuoteSet {
  /** Key into the quote set (sample curves) or `extra:<curveId>` for an added curve. */
  key: string;
  curveId: string;
  label: string;
  title: string;
  /** Curve added by the user from quotes (Markt R6-5) – quotes live in `extraCurves`, not in the sample quote set. */
  extra?: ExtraCurve;
}

const QUOTE_SETS: QuoteSet[] = [
  { key: "eurOis", curveId: "EUR-ESTR", label: "€STR", title: "EUR €STR OIS" },
  { key: "eur6m", curveId: "EUR-EURIBOR-6M", label: "EUR 6M", title: "EUR EURIBOR 6M" },
  { key: "eur3m", curveId: "EUR-EURIBOR-3M", label: "EUR 3M", title: "EUR EURIBOR 3M" },
  { key: "usdSofr", curveId: "USD-SOFR", label: "SOFR", title: "USD SOFR OIS" },
  { key: "gbpSonia", curveId: "GBP-SONIA", label: "SONIA", title: "GBP SONIA OIS" },
  { key: "chfSaron", curveId: "CHF-SARON", label: "SARON", title: "CHF SARON OIS" },
  { key: "jpyTona", curveId: "JPY-TONA", label: "TONA", title: "JPY TONA OIS" },
  { key: "eurUsdXccy", curveId: "EUR-ESTR-USDCSA", label: "EUR/USD CSA", title: "EUR Diskont unter USD-CSA (Xccy-Basis)" },
];

/** Interpolation options – labels from the single German map in `lib/i18n.ts` (R3-06). */
const INTERPOLATIONS: { v: InterpolationMethod; l: string }[] = (Object.keys(INTERPOLATION_DE) as InterpolationMethod[]).map((v) => ({
  v,
  l: INTERPOLATION_DE[v]!,
}));

/** Next 31 December after the valuation date (default turn-of-year window start). */
export function nextYearEnd(valuationDate: number): number {
  const year = Number(toISO(valuationDate).slice(0, 4));
  const ye = parseISO(`${year}-12-31`);
  return ye > valuationDate ? ye : parseISO(`${year + 1}-12-31`);
}

/** Editable numeric value of a quote (rate, futures price, basis spread or swap points) with unit handling. */
export function quoteValue(q: CurveQuote): { value: number; unit: "%" | "Preis" | "bp" | "Pkt"; step: number; digits: number } {
  switch (q.type) {
    case "Future":
      return { value: q.price, unit: "Preis", step: 0.005, digits: 3 };
    case "BasisSwap":
    case "XccyBasis":
      return { value: q.spread * 1e4, unit: "bp", step: 0.5, digits: 2 };
    case "FxSwapPoints":
      return { value: q.points, unit: "Pkt", step: 0.5, digits: 2 };
    default:
      return { value: q.rate * 100, unit: "%", step: 0.005, digits: 4 };
  }
}

/**
 * Bootstrap residual of one quote, formatted: rate difference in bp for
 * Deposit/FRA/Future, NPV per unit notional (×1e-6) for par instruments.
 */
export function residualText(r: BootstrapResult["residuals"][number] | undefined): string {
  if (!r || !Number.isFinite(r.residual)) return "–";
  const abs = Math.abs(r.residual);
  if (r.quote.type === "Deposit" || r.quote.type === "FRA" || r.quote.type === "Future") return `${fmtNum(abs * 1e4, 4)} bp`;
  return `${fmtNum(abs * 1e6, 3)}·10⁻⁶`;
}

export function withQuoteValue(q: CurveQuote, v: number): CurveQuote {
  switch (q.type) {
    case "Future":
      return { ...q, price: v };
    case "BasisSwap":
    case "XccyBasis":
      return { ...q, spread: v / 1e4 };
    case "FxSwapPoints":
      return { ...q, points: v };
    default:
      return { ...q, rate: v / 100 };
  }
}

const INTERP_ALLOWED = new Set<string>(INTERPOLATIONS.map((i) => i.v));

/** Quote list of a set: the sample quote set for shipped curves, the added curve's own quotes otherwise. */
function quotesOf(set: QuoteSet, quotes: SampleMarketQuotes): CurveQuote[] {
  if (set.extra) return set.extra.quotes;
  return (quotes[set.key as keyof Omit<SampleMarketQuotes, "fxSpots">] as CurveQuote[] | undefined) ?? [];
}

/** Tab label of an added curve ("NOWA", "STIBOR 3M"). */
function extraLabel(c: ExtraCurve): string {
  return c.index.replace(/-(\d+[MWY])$/, " $1");
}

/** Default quote ladder offered in the "+ Kurve" form (tenor;rate %). */
export const DEFAULT_CURVE_QUOTES_TEXT = "1Y;3,00\n2Y;3,05\n3Y;3,10\n5Y;3,20\n7Y;3,30\n10Y;3,40";

/**
 * Parse the quote lines of the "+ Kurve" form (Markt R6-5): one `Tenor;Satz`
 * per line (";", ",", tab or spaces), rates as `3,10`, `3.1 %` or `310bp`. An
 * overnight index gets OIS quotes; an IBOR index deposits up to its own tenor
 * and par swaps beyond.
 */
export function parseCurveQuotes(text: string, index: RateIndex | undefined): { quotes: CurveQuote[]; error?: string } {
  const quotes: CurveQuote[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const indexMonths = index ? tenorMonths(index.tenor) : 0;
  for (const line of lines) {
    const m = /^(\d+[DWMY])\s*[;,\t ]\s*(.+)$/i.exec(line);
    if (!m) return { quotes, error: `Zeile „${line}“ nicht lesbar – erwartet Tenor;Satz, z. B. 5Y;3,20` };
    const tenor = m[1]!.toUpperCase();
    const rate = rateOf(m[2]);
    if (rate === undefined) return { quotes, error: `Satz „${m[2]}“ in Zeile „${line}“ nicht lesbar (z. B. 3,20 oder 320bp)` };
    if (quotes.some((q) => quoteTenor(q) === tenor)) return { quotes, error: `Tenor ${tenor} doppelt` };
    if (!index || index.type === "OIS") quotes.push({ type: "OIS", tenor, rate });
    else if (tenorMonths(tenor) <= indexMonths) quotes.push({ type: "Deposit", tenor, rate });
    else quotes.push({ type: "Swap", tenor, rate });
  }
  quotes.sort((a, b) => tenorMonths(quoteTenor(a)) - tenorMonths(quoteTenor(b)));
  return { quotes };
}

/**
 * "+ Kurve" (Markt R6-5): add a curve for a currency / index the market does not
 * carry, from quotes – conventions from the core registry (`knownCurrencies`,
 * `knownIndices`), optional EUR spot for a new currency, one undo entry.
 */
function AddCurveForm({ onDone }: { onDone: (id?: string) => void }) {
  const baseMarket = useStore((s) => s.baseMarket);
  const fxSpots = useStore((s) => s.quotes.fxSpots);
  const ccys = knownCurrencies();
  const withoutCurve = ccys.filter((c) => !baseMarket.discountCurveId[c]);
  const [ccyState, setCcy] = useState(withoutCurve[0] ?? ccys[0] ?? "EUR");
  const ccy = ccys.includes(ccyState) ? ccyState : (ccys[0] ?? "EUR");
  const candidates = knownIndices(ccy).filter((i) => !(i.curveId in baseMarket.curves));
  const [indexState, setIndex] = useState("");
  const idx = candidates.find((i) => i.name === indexState) ?? candidates.find((i) => i.type === "OIS") ?? candidates[0];
  const [text, setText] = useState(DEFAULT_CURVE_QUOTES_TEXT);
  const needsSpot = ccy !== "EUR" && fxSpots[`EUR${ccy}`] === undefined && fxSpots[`${ccy}EUR`] === undefined;
  const [spot, setSpot] = useState<number>(0);
  const parsed = useMemo(() => parseCurveQuotes(text, idx), [text, idx]);
  const curve: ExtraCurve | undefined = idx ? { id: idx.curveId, currency: ccy, index: idx.name, quotes: parsed.quotes } : undefined;
  const problem = parsed.error ?? (curve ? validateExtraCurve(curve, Object.keys(baseMarket.curves)) : "Für diese Währung ist kein weiterer Index registriert");
  const submit = () => {
    if (!curve || problem) return;
    const st = useStore.getState();
    const r = st.addExtraCurve(curve, needsSpot && spot > 0 ? { fxSpot: { pair: `EUR${ccy}`, rate: spot } } : undefined);
    if (!r.ok) {
      st.showToast(`Kurve nicht angelegt – ${r.error}`, { ms: 8000 });
      return;
    }
    st.showToast(`Kurve ${curve.id} aus ${curve.quotes.length} Quotes angelegt${needsSpot && spot > 0 ? ` · Spot EUR/${ccy} ${fmtNum(spot, 4)}` : ""}`, {
      action: { label: "Rückgängig", run: () => useStore.getState().undo() },
    });
    onDone(curve.id);
  };
  return (
    <div className="card" data-testid="add-curve-form">
      <h3>
        + Kurve aus Quotes anlegen
        <span className="right muted xs">
          Konventionen aus dem Kern-Register (Tageszählung, Kalender, Fixing-Lag) · erste Kurve einer Währung = Diskontkurve
        </span>
      </h3>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Währung</span>
          <select className="inline" value={ccy} aria-label="Währung der neuen Kurve" data-testid="add-curve-ccy" onChange={(e) => setCcy(e.target.value)}>
            {ccys.map((c) => (
              <option key={c} value={c}>
                {c}
                {baseMarket.discountCurveId[c] ? "" : " (ohne Kurve)"}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Index</span>
          <select
            className="inline"
            value={idx?.name ?? ""}
            aria-label="Index der neuen Kurve"
            data-testid="add-curve-index"
            onChange={(e) => setIndex(e.target.value)}
          >
            {candidates.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name} ({i.type === "OIS" ? "OIS" : `IBOR ${i.tenor}`}, {i.dayCount}, {i.fixingCalendar})
              </option>
            ))}
            {candidates.length === 0 && <option value="">– alle Indizes vorhanden –</option>}
          </select>
        </label>
        <span className="muted small">
          Kurven-ID <span className="mono">{idx?.curveId ?? "–"}</span>
        </span>
        {needsSpot && (
          <label
            className="row"
            style={{ gap: 6 }}
            title="Kassakurs EUR/Fremdwährung – nötig für FX-Geschäfte und die Umrechnung in die Reporting-Währung (Quote-Set, undo-fähig)"
          >
            <span className="muted small">Spot EUR/{ccy}</span>
            <span style={{ display: "inline-block", width: 120 }}>
              <NumInput inline value={spot} step={0.01} digits={4} min={0} ariaLabel={`Spot EUR/${ccy}`} testId="add-curve-spot" onChange={setSpot} />
            </span>
          </label>
        )}
      </div>
      <div className="row wrap" style={{ gap: 12, marginTop: 8, alignItems: "flex-start" }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Quotes (eine Zeile je Tenor: Tenor;Satz in %)</span>
          <textarea
            className="mono"
            rows={7}
            style={{ width: 220 }}
            value={text}
            aria-label="Quotes der neuen Kurve"
            data-testid="add-curve-quotes"
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted xs">
            {parsed.quotes.length} Quotes · {idx ? (idx.type === "OIS" ? "OIS-Quotes" : `Depots bis ${idx.tenor}, darüber Par-Swaps`) : ""}
            {baseMarket.discountCurveId[ccy] && idx && idx.type !== "OIS" ? ` · Dual-Curve gegen ${baseMarket.discountCurveId[ccy]}` : ""}
          </span>
          {problem && (
            <span className="field-msg error" role="alert" data-testid="add-curve-problem">
              {problem}
            </span>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={submit} disabled={!!problem} data-testid="add-curve-submit">
              Kurve anlegen
            </button>
            <button className="btn ghost" onClick={() => onDone()}>
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CurvesView() {
  const s = useStore(
    useShallow((st) => ({
      quotes: st.quotes,
      interpolation: st.interpolation,
      turnOfYear: st.turnOfYear,
      volSurfaces: st.volSurfaces,
      fxFixings: st.fxFixings,
      fxSpotOverrides: st.fxSpotOverrides,
      fixings: st.fixings,
      importedBase: st.importedBase,
      extraCurves: st.extraCurves,
      baseMarket: st.baseMarket,
      valuationDate: st.valuationDate,
      marketSource: st.marketSource,
    })),
  );
  const imported = s.marketSource === "import";
  const [sel, setSel] = useState(0);
  const [compare, setCompare] = useState<string | null>("EUR-EURIBOR-6M");
  const [adding, setAdding] = useState(false);
  // Shipped curves plus the curves the user added from quotes (Markt R6-5)
  const sets: QuoteSet[] = useMemo(
    () => [
      ...QUOTE_SETS,
      ...Object.values(s.extraCurves).map((c) => ({
        key: `extra:${c.id}`,
        curveId: c.id,
        label: extraLabel(c),
        title: `${c.currency} ${c.index} (aus Quotes angelegt)`,
        extra: c,
      })),
    ],
    [s.extraCurves],
  );
  const set = sets[Math.min(sel, sets.length - 1)]!;
  const quotes = s.quotes;
  const setQuotes = quotesOf(set, quotes);
  const curve = s.baseMarket.curves[set.curveId] as InterpolatedCurve | undefined;
  const sameCcy = Object.values(s.baseMarket.curves).filter((c) => c.currency === curve?.currency && c.id !== set.curveId);
  const cmpId = compare && sameCcy.some((c) => c.id === compare) ? compare : null;
  const cmp = cmpId ? (s.baseMarket.curves[cmpId] as InterpolatedCurve | undefined) : undefined;
  const modified = marketModified(s);
  const override = s.interpolation[set.curveId];
  const storedToy = s.turnOfYear[set.curveId];
  // Turn-of-year inputs: local draft per curve, seeded from the stored jump (or the next 31 Dec / 0 bp).
  const [toyDraft, setToyDraft] = useState<{ curveId: string; date: number; bp: number } | null>(null);
  const toy =
    toyDraft && toyDraft.curveId === set.curveId
      ? toyDraft
      : { curveId: set.curveId, date: storedToy?.date ?? nextYearEnd(s.valuationDate), bp: storedToy?.bp ?? 0 };
  const toyDirty = storedToy ? storedToy.date !== toy.date || storedToy.bp !== toy.bp : toy.bp !== 0;
  /**
   * A *changed* draft on or before the valuation date cannot be applied – shown as validation, never stored silently (R3-F2).
   * A stored jump the valuation date has overtaken is not an input error: it shows the "inaktiv" badge instead (R4-09).
   */
  const toyPast = toyDirty && toy.bp !== 0 && toy.date <= s.valuationDate;
  const storedToyInactive = !toyDirty && !!storedToy && storedToy.bp !== 0 && storedToy.date <= s.valuationDate;
  const inactiveToys = Object.values(s.turnOfYear).filter((t) => t.date <= s.valuationDate).length;
  const pillarNav = useTableNav({ onCopied: () => useStore.getState().showToast("Pillar kopiert") });

  const series = useMemo(() => {
    if (!curve) return null;
    const years: number[] = [];
    for (let y = 0.25; y <= 30; y += 0.25) years.push(y);
    const val = s.valuationDate;
    const zero = years.map((y) => [y, curve.zeroRate(val + Math.round(y * 365.25)) * 100]);
    const fwd = years.map((y) => {
      const d = val + Math.round(y * 365.25);
      return [y, curve.forwardRate(d, d + 182, "ACT/360") * 100];
    });
    const cmpZero = cmp ? years.map((y) => [y, cmp.zeroRate(val + Math.round(y * 365.25)) * 100]) : [];
    return { zero, fwd, cmpZero };
  }, [curve, cmp, s.valuationDate]);

  const specs = useMemo(() => {
    try {
      return sampleBootstrapSpecs(s.valuationDate, quotes);
    } catch {
      return null;
    }
  }, [quotes, s.valuationDate]);

  /** Residuals + pillar dates of the selected curve's bootstrap (same specs and overrides as the store market). */
  const boot = useMemo(() => {
    if (!specs) return null;
    try {
      const spec: CurveBuildSpec | undefined = set.extra ? extraCurveSpec(set.extra, s.baseMarket.discountCurveId) : specs[set.curveId];
      if (!spec) return null;
      const toyList = storedToy && storedToy.date > s.valuationDate && storedToy.bp !== 0 ? [{ date: storedToy.date, bp: storedToy.bp }] : undefined;
      const result = bootstrapCurves(s.valuationDate, [{ ...spec, interpolation: override ?? spec.interpolation, turnOfYear: toyList }], s.baseMarket.curves)
        .results[set.curveId];
      const dates = spec.quotes.map((q) => {
        try {
          return quoteDates(s.valuationDate, spec, q);
        } catch {
          return undefined;
        }
      });
      return { residuals: result?.residuals ?? null, dates };
    } catch {
      return null;
    }
  }, [specs, s.valuationDate, set.curveId, set.extra, s.baseMarket.curves, s.baseMarket.discountCurveId, override, storedToy]);

  const IMPORT_LOCK =
    "Kurven stammen aus dem importierten Snapshot – Quotes, Interpolation und Turn-of-Year sind nicht verfügbar („Zum Sample-Markt“ in der Marktansicht)";
  /** Apply a new quote list of the selected set: the sample quote set (undo "quotes") or the added curve (undo "curves"). */
  const applyList = (list: CurveQuote[], label: string) => {
    const st = useStore.getState();
    if (st.marketSource === "import") {
      st.showToast(IMPORT_LOCK);
      return;
    }
    if (set.extra) {
      if (!st.setExtraCurveQuotes(set.extra.id, list, label)) st.showToast("Bootstrap fehlgeschlagen – Quote nicht übernommen");
      return;
    }
    const next = JSON.parse(JSON.stringify(quotes)) as SampleMarketQuotes;
    (next as unknown as Record<string, CurveQuote[]>)[set.key] = list;
    if (!st.setQuotes(next, label)) st.showToast("Bootstrap fehlgeschlagen – Quote nicht übernommen");
  };
  const updateQuote = (i: number, v: number) => {
    const list = [...setQuotes];
    const before = list[i]!;
    list[i] = withQuoteValue(before, v);
    const qv = quoteValue(before);
    applyList(list, `Quote ${quoteLabel(before)} ${fmtNum(qv.value, qv.digits)} → ${fmtNum(v, qv.digits)} ${qv.unit}`);
  };
  /** "+ FX-Punkte": add an FX-swap-points quote (short end from FX forwards, R3-6), inserted in pillar order. */
  const fxPointsCandidate = curve ? newFxPointsQuote(curve.currency, setQuotes, quotes.fxSpots, s.baseMarket.discountCurveId) : undefined;
  const addFxPoints = () => {
    if (!fxPointsCandidate) return;
    const list = [...setQuotes];
    const months = tenorMonths(fxPointsCandidate.tenor);
    let at = list.findIndex((q) => tenorMonths(quoteTenor(q)) > months);
    if (at < 0) at = list.length;
    list.splice(at, 0, fxPointsCandidate);
    applyList(list, `FX-Punkte ${fxPointsCandidate.pair} ${fxPointsCandidate.tenor} hinzugefügt`);
  };
  const removeQuote = (i: number) => {
    const list = [...setQuotes];
    const [removed] = list.splice(i, 1);
    applyList(list, `Quote ${removed ? quoteLabel(removed) : ""} entfernt`);
  };
  const bumpAll = (bp: number) => {
    applyList(
      setQuotes.map((q) => bumpQuote(q, bp)),
      `Quotes ${set.label} ${bp > 0 ? "+" : ""}${bp} bp`,
    );
  };
  const removeCurve = () => {
    if (!set.extra) return;
    const st = useStore.getState();
    const id = set.extra.id;
    if (!window.confirm(`Kurve ${id} entfernen? Trades in ${set.extra.currency} verlieren ihre Diskont-/Projektionskurve (rückgängig mit Ctrl+Z).`)) return;
    if (st.removeExtraCurve(id)) {
      setSel(0);
      st.showToast(`Kurve ${id} entfernt`, { action: { label: "Rückgängig", run: () => useStore.getState().undo() } });
    }
  };
  const setInterp = (m: InterpolationMethod) => {
    const st = useStore.getState();
    const spec = set.extra ? undefined : specs?.[set.curveId];
    const isDefault = spec?.interpolation ? spec.interpolation === m : m === "logLinear";
    try {
      if (!st.setInterpolation(set.curveId, isDefault ? undefined : m))
        st.showToast(st.marketSource === "import" ? IMPORT_LOCK : "Bootstrap mit dieser Interpolation fehlgeschlagen");
    } catch (e) {
      st.showToast(`Bootstrap fehlgeschlagen: ${translatePricingError(e)}`);
    }
  };
  const applyToy = () => {
    const st = useStore.getState();
    if (toyPast) {
      st.showToast("Turn-of-Year muss nach dem Bewertungstag liegen");
      return;
    }
    const ok = st.setTurnOfYear(set.curveId, toy.bp === 0 ? undefined : { date: toy.date, bp: toy.bp });
    if (!ok) st.showToast(toy.date <= s.valuationDate ? "Turn-of-Year muss nach dem Bewertungstag liegen" : "Bootstrap mit Turn-of-Year fehlgeschlagen");
    else
      st.showToast(
        toy.bp === 0
          ? `Turn-of-Year ${set.curveId} entfernt`
          : `Turn-of-Year ${set.curveId}: ${fmtDate(toy.date)} ${toy.bp > 0 ? "+" : ""}${fmtNum(toy.bp, 1)} bp`,
      );
    setToyDraft(null);
  };
  const removeToy = () => {
    useStore.getState().setTurnOfYear(set.curveId, undefined);
    setToyDraft(null);
  };
  /** Shipped original of a quote (matched by type/tenor/pair, so added rows never shift the mapping); added curves have no original. */
  const original = (q: CurveQuote): CurveQuote | undefined =>
    set.extra
      ? undefined
      : (SAMPLE_QUOTES[set.key as keyof Omit<SampleMarketQuotes, "fxSpots">] as CurveQuote[] | undefined)?.find((x) => quoteKey(x) === quoteKey(q));
  const isEdited = (q: CurveQuote) => !set.extra && JSON.stringify(original(q)) !== JSON.stringify(q);
  const interpValue = override ?? curve?.interpolation ?? "logLinear";
  const interpOptions = INTERP_ALLOWED.has(interpValue) ? INTERPOLATIONS : [...INTERPOLATIONS, { v: interpValue as InterpolationMethod, l: interpValue }];
  const overrideCount = Object.keys(s.interpolation).length;

  return (
    <div className="stack">
      {adding && !imported && (
        <AddCurveForm
          onDone={(id) => {
            setAdding(false);
            if (id) {
              const i = sets.findIndex((q) => q.curveId === id);
              // the new set is appended on the next render – select it by position
              setSel(i >= 0 ? i : sets.length);
              // R7-03: the keyboard user lands on the new curve's tab, not on body
              void focusWhenPresent(`[data-testid="curve-tab-${id}"]`);
            } else void focusWhenPresent('[data-testid="add-curve"]');
          }}
        />
      )}
      {imported && (
        <div className="warning row wrap" style={{ gap: 10 }} data-testid="curves-import-note">
          <span>
            Kurven aus importiertem Snapshot „{s.baseMarket.meta?.label ?? "Snapshot"}“ (Bewertungstag {fmtDate(s.valuationDate)}) – die Quote-Tabelle zeigt die
            Sample-Quotes nur zur Information; Quotes, Interpolation und Turn-of-Year sind nicht editierbar.
          </span>
          <button
            className="btn xs"
            onClick={() => {
              useStore.getState().leaveImport();
              useStore.getState().showToast(`Sample-Markt aus den Quotes zum ${fmtDate(useStore.getState().valuationDate)} aufgebaut`);
            }}
          >
            Zum Sample-Markt
          </button>
        </div>
      )}
      <div className="row wrap toolbar">
        <div className="seg wrap" role="group" aria-label="Kurve">
          {sets.map((q, i) => (
            <button
              key={q.key}
              className={q === set ? "active" : ""}
              aria-pressed={q === set}
              title={q.title}
              onClick={() => setSel(i)}
              disabled={!s.baseMarket.curves[q.curveId]}
              data-testid={q.extra ? `curve-tab-${q.curveId}` : undefined}
            >
              {q.label}
              {q.extra && <span className="dot" aria-label="aus Quotes angelegt" style={{ background: "var(--info)" }} />}
              {s.interpolation[q.curveId] && <span className="dot warn" aria-label="Interpolation überschrieben" />}
              {s.turnOfYear[q.curveId] && <span className="dot warn" aria-label="Turn-of-Year gesetzt" />}
            </button>
          ))}
        </div>
        <button
          className="btn xs"
          onClick={() => setAdding((v) => !v)}
          disabled={imported}
          aria-pressed={adding}
          data-testid="add-curve"
          title={
            imported
              ? IMPORT_LOCK
              : "Kurve für eine weitere Währung / einen weiteren Index aus Quotes anlegen (NOK, SEK, DKK, PLN … – Konventionen aus dem Kern-Register)"
          }
        >
          + Kurve
        </button>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Vergleich</span>
          <select className="inline" value={cmpId ?? ""} onChange={(e) => setCompare(e.target.value || null)} aria-label="Vergleichskurve (gleiche Währung)">
            <option value="">–</option>
            {sameCcy.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Interpolation</span>
          <select
            className={`inline ${override ? "edited" : ""}`}
            value={interpValue}
            aria-label="Interpolationsmethode"
            data-testid="interp-select"
            disabled={imported}
            title={imported ? IMPORT_LOCK : undefined}
            onChange={(e) => setInterp(e.target.value as InterpolationMethod)}
          >
            {interpOptions.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </select>
          {override && (
            <span className="badge warn" title="Abweichend vom Sample-Markt – bleibt bei Stichtagswechsel erhalten">
              Override
            </span>
          )}
        </label>
        <label
          className="row"
          style={{ gap: 6 }}
          title="Turn-of-Year: Sprung des Instantan-Forwards über den Jahreswechsel (Fenster ab Datum, 1 Tag) in bp – Pillars werden neu gelöst"
        >
          <span className="muted small toy-label" style={{ whiteSpace: "nowrap" }}>
            Turn-of-Year
          </span>
          <DateInput
            inline
            value={toy.date}
            ariaLabel="Turn-of-Year Datum"
            invalid={toyPast}
            disabled={imported}
            onChange={(v) => setToyDraft({ curveId: set.curveId, date: v, bp: toy.bp })}
          />
          <span style={{ display: "inline-block", width: 96 }}>
            <NumInput
              inline
              value={toy.bp}
              step={5}
              digits={1}
              unit="bp"
              ariaLabel="Turn-of-Year bp"
              testId="toy-bp"
              disabled={imported}
              onChange={(v) => setToyDraft({ curveId: set.curveId, date: toy.date, bp: v })}
              onCommit={() => undefined}
            />
          </span>
          <button
            className="btn xs"
            onClick={applyToy}
            disabled={imported || !!set.extra || !toyDirty || toyPast}
            data-testid="toy-apply"
            title={
              imported
                ? IMPORT_LOCK
                : set.extra
                  ? "Turn-of-Year ist für hinzugefügte Kurven nicht verfügbar"
                  : toyPast
                    ? "Datum muss nach dem Bewertungstag liegen"
                    : "Turn-of-Year auf die Kurve anwenden (Bootstrap)"
            }
          >
            Anwenden
          </button>
          {storedToy && (
            <button className="btn ghost xs" onClick={removeToy} title={imported ? IMPORT_LOCK : "Turn-of-Year entfernen"} disabled={imported}>
              ✕
            </button>
          )}
          {toyPast && (
            <span className="field-msg error" role="alert" data-testid="toy-past">
              Turn-of-Year muss nach dem Bewertungstag ({fmtDate(s.valuationDate)}) liegen
            </span>
          )}
          {storedToyInactive && (
            <span
              className="badge warn"
              data-testid="toy-inactive"
              title={`Der gespeicherte Sprung (${fmtDate(storedToy!.date)}) liegt am oder vor dem Bewertungstag ${fmtDate(s.valuationDate)} und wirkt nicht auf die Kurve – Datum ändern oder mit ✕ entfernen`}
            >
              inaktiv (vor dem Bewertungstag)
            </span>
          )}
        </label>
        <div className="grow" />
        {modified && (
          <span
            className="chip warn"
            title={
              imported
                ? "Vol-Flächen, Spots, Fixings oder FX-Fixings weichen vom importierten Snapshot ab"
                : "Quotes, Spots, Interpolation, Turn-of-Year, Vol-Flächen, Fixings, FX-Fixings oder hinzugefügte Kurven weichen vom Sample-Markt ab"
            }
            data-testid="market-modified-chip"
          >
            <span className="dot" /> Markt modifiziert{overrideCount > 0 ? ` · ${overrideCount} Interpolation` : ""}
            {Object.keys(s.turnOfYear).length > 0
              ? ` · ${Object.keys(s.turnOfYear).length} Turn-of-Year${inactiveToys > 0 ? ` (${inactiveToys} inaktiv)` : ""}`
              : ""}
          </span>
        )}
        <button className="btn" onClick={() => bumpAll(10)} disabled={imported} title={imported ? IMPORT_LOCK : undefined}>
          Quotes +10 bp
        </button>
        <button className="btn" onClick={() => bumpAll(-10)} disabled={imported} title={imported ? IMPORT_LOCK : undefined}>
          Quotes −10 bp
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            useStore.getState().resetMarketOverrides();
            setToyDraft(null);
          }}
          disabled={!modified}
          title={
            imported
              ? "Vol-, Spot-, Fixing- und FX-Fixing-Änderungen verwerfen – zurück zum importierten Snapshot"
              : "Quotes, Interpolation, Turn-of-Year, Vol-Flächen, Fixings und FX-Fixings zurücksetzen"
          }
        >
          Zurücksetzen
        </button>
      </div>

      <div className="grid curves-grid">
        <div className="card">
          <h3>
            {set.curveId}{" "}
            {set.extra && (
              <>
                <span className="badge info" title={set.title} data-testid="curve-extra-badge">
                  aus Quotes angelegt
                </span>{" "}
                <button
                  className="btn ghost danger xs"
                  onClick={removeCurve}
                  data-testid="remove-curve"
                  title="Hinzugefügte Kurve entfernen (rückgängig mit Ctrl+Z)"
                >
                  ✕ Kurve entfernen
                </button>
              </>
            )}
            <span className="right muted xs">
              {INTERPOLATIONS.find((x) => x.v === curve?.interpolation)?.l ?? curve?.interpolation} · {curve?.dayCount} · Referenz{" "}
              {curve && fmtDate(curve.referenceDate)}
              {curve && curve.forwardJumps.length > 0 && (
                <span className="badge warn" style={{ marginLeft: 6 }} data-testid="toy-badge">
                  Turn-of-Year {curve.forwardJumps.map((j) => `${fmtDate(j.date)} ${j.bp > 0 ? "+" : ""}${fmtNum(j.bp, 1)} bp`).join(", ")}
                </span>
              )}
            </span>
          </h3>
          {series && (
            <EChart
              className="chart tall"
              ariaLabel={`Zero- und Forwardkurve ${set.curveId}`}
              option={{
                legend: { top: 0, textStyle: { color: cssVar("--fg-2") } },
                tooltip: { trigger: "axis", valueFormatter: (v) => `${fmtNum(v as number, 3)} %` },
                xAxis: { type: "value", name: "Jahre", min: 0, max: 30, axisLabel: { formatter: (v: number) => fmtNum(v, 0) } },
                yAxis: { type: "value", scale: true, axisLabel: { formatter: (v: number) => `${fmtNum(v, 2)} %` } },
                series: [
                  { name: "Zero (stetig)", type: "line", data: series.zero, showSymbol: false, smooth: false, lineStyle: { width: 2 } },
                  { name: "6M-Forward", type: "line", data: series.fwd, showSymbol: false, lineStyle: { width: 1.5, type: "dashed" } },
                  ...(cmp ? [{ name: `${cmp.id} Zero`, type: "line" as const, data: series.cmpZero, showSymbol: false, lineStyle: { width: 1.5 } }] : []),
                ],
              }}
            />
          )}
          <div className="muted xs" style={{ marginTop: 6 }}>
            Multi-Curve: Diskontierung über OIS ({s.baseMarket.discountCurveId.EUR}; JPY über {s.baseMarket.discountCurveId.JPY ?? "–"}), Projektion der
            EURIBOR-Forwards über die Tenor-Kurve (Dual-Curve-Bootstrapping); Xccy-Basis liefert die USD-CSA-Diskontkurve, FX-Swap-Punkte das kurze Ende
            impliziter Kurven. Interpolation je Kurve wählbar (Standard log-linear in Diskontfaktoren, monoton-konvex nach Hagan–West für glatte Forwards) –
            Override und Turn-of-Year werden gespeichert, überleben den Stichtagswechsel und bootstrappen abhängige Kurven neu.
          </div>
        </div>
        <div className="card">
          <h3>
            {imported ? "Sample-Quotes (nur Information – Kurven aus dem Snapshot)" : "Marktquotes (editierbar)"}{" "}
            <span className="right row wrap" style={{ gap: 8 }}>
              <span className="muted xs">
                {imported ? (
                  "gesperrt – „Zum Sample-Markt“ macht die Quotes wieder editierbar"
                ) : (
                  <>
                    geänderte Zellen orange · Original im Tooltip · <kbd>Ctrl</kbd>+<kbd>Z</kbd> rückgängig
                  </>
                )}
              </span>
              {fxPointsCandidate && (
                <button
                  className="btn ghost xs"
                  onClick={addFxPoints}
                  data-testid="add-fx-points"
                  disabled={imported}
                  title={
                    imported
                      ? IMPORT_LOCK
                      : `FX-Swap-Punkte ${fxPointsCandidate.pair.slice(0, 3)}/${fxPointsCandidate.pair.slice(3)} ${fxPointsCandidate.tenor} als Quote anlegen (kurzes Ende aus Devisentermingeschäften, Diskontkurve ${fxPointsCandidate.otherDiscountCurveId})`
                  }
                >
                  + FX-Punkte {fxPointsCandidate.pair.slice(0, 3)}/{fxPointsCandidate.pair.slice(3)}
                </button>
              )}
            </span>
          </h3>
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table className="grid-table quotes compact" data-testid="quotes-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Pillar</th>
                  <th className="num">Quote</th>
                  <th className="num">Zero</th>
                  <th className="num">DF</th>
                  <th className="num" title="Bootstrap-Residuum: Satzdifferenz (bp) bzw. NPV je Nominaleinheit (×10⁻⁶)">
                    Resid.
                  </th>
                </tr>
              </thead>
              <tbody>
                {setQuotes.map((q, i) => {
                  const node = curve?.zeroRates()[i];
                  const qv = quoteValue(q);
                  const edited = isEdited(q);
                  const orig = original(q);
                  const origText = orig ? `Original ${fmtNum(quoteValue(orig).value, qv.digits)} ${qv.unit}` : "Hinzugefügte Quote (nicht im Sample-Markt)";
                  return (
                    <tr
                      key={`${quoteKey(q)}-${i}`}
                      style={{ cursor: "default" }}
                      className={edited ? "edited" : ""}
                      data-testid={orig || set.extra ? undefined : "added-quote"}
                    >
                      <td>
                        {quoteLabel(q)}
                        {!orig && setQuotes.length > 2 && (
                          <button
                            className="btn ghost danger xs"
                            style={{ marginLeft: 4 }}
                            aria-label={`Quote ${quoteLabel(q)} entfernen`}
                            title={imported ? IMPORT_LOCK : "Hinzugefügte Quote entfernen"}
                            disabled={imported}
                            onClick={() => removeQuote(i)}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                      <td className="mono muted xs">{boot?.dates[i] ? fmtDate(boot.dates[i]!.end) : ""}</td>
                      <td className={`num quote-cell ${edited ? "edited" : ""}`} title={imported ? IMPORT_LOCK : edited ? origText : undefined}>
                        <span style={{ display: "inline-block", width: 104 }}>
                          <NumInput
                            inline
                            value={qv.value}
                            step={qv.step}
                            digits={qv.digits}
                            unit={qv.unit}
                            ariaLabel={`${quoteLabel(q)} Quote`}
                            disabled={imported}
                            onChange={(v) => updateQuote(i, v)}
                          />
                        </span>
                      </td>
                      <td className="num muted">{node ? fmtPct(node.zero, 4) : ""}</td>
                      <td className="num muted">{node ? fmtNum(node.df, 6) : ""}</td>
                      <td className="num muted xs" title={boot?.residuals?.[i] ? `Residuum ${residualText(boot.residuals[i])}` : undefined}>
                        {residualText(boot?.residuals?.[i])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          Pillars {set.curveId}{" "}
          <span className="right muted xs">
            <kbd>↑</kbd>/<kbd>↓</kbd> Zeile · <kbd>y</kbd> <kbd>y</kbd> kopieren
          </span>
        </h3>
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table className="grid-table pillars" data-testid="pillar-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th className="num">Jahre</th>
                <th className="num">Zero (stetig)</th>
                <th className="num">Diskontfaktor</th>
                <th className="num">Fwd 6M ab Pillar</th>
              </tr>
            </thead>
            <tbody onKeyDown={pillarNav.onKeyDown} onFocus={pillarNav.onFocus}>
              {curve?.zeroRates().map((n, ni, all) => (
                <tr key={n.date} {...pillarNav.rowProps(ni, all.length)} style={{ cursor: "default" }}>
                  <td className="mono">{fmtDate(n.date)}</td>
                  <td className="num">{fmtNum(n.time, 3)}</td>
                  <td className="num">{fmtPct(n.zero, 4)}</td>
                  <td className="num">{fmtNum(n.df, 8)}</td>
                  <td className="num">{fmtPct(curve.forwardRate(n.date, n.date + 182, "ACT/360"), 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
