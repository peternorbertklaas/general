import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  SAMPLE_QUOTES,
  type BootstrapResult,
  type CurveQuote,
  type InterpolatedCurve,
  type InterpolationMethod,
  type SampleMarketQuotes,
  bootstrapCurves,
  quoteDates,
  quoteLabel,
  sampleBootstrapSpecs,
} from "@deriva/pricing-core";
import { EChart, cssVar } from "../components/EChart.js";
import { NumInput } from "../components/NumInput.js";
import { navRowProps, useTableNav } from "../hooks/useTableNav.js";
import { fmtDate, fmtNum, fmtPct } from "../lib/format.js";
import { translatePricingError } from "../lib/i18n.js";
import { marketModified, useStore } from "../state/store.js";

const QUOTE_SETS: { key: keyof Omit<SampleMarketQuotes, "fxSpots">; curveId: string; label: string; title: string }[] = [
  { key: "eurOis", curveId: "EUR-ESTR", label: "€STR", title: "EUR €STR OIS" },
  { key: "eur6m", curveId: "EUR-EURIBOR-6M", label: "EUR 6M", title: "EUR EURIBOR 6M" },
  { key: "eur3m", curveId: "EUR-EURIBOR-3M", label: "EUR 3M", title: "EUR EURIBOR 3M" },
  { key: "usdSofr", curveId: "USD-SOFR", label: "SOFR", title: "USD SOFR OIS" },
  { key: "gbpSonia", curveId: "GBP-SONIA", label: "SONIA", title: "GBP SONIA OIS" },
  { key: "chfSaron", curveId: "CHF-SARON", label: "SARON", title: "CHF SARON OIS" },
  { key: "eurUsdXccy", curveId: "EUR-ESTR-USDCSA", label: "EUR/USD CSA", title: "EUR Diskont unter USD-CSA (Xccy-Basis)" },
];

const INTERPOLATIONS: { v: InterpolationMethod; l: string }[] = [
  { v: "logLinear", l: "log-linear (DF)" },
  { v: "linearZero", l: "linear (Zero)" },
  { v: "cubicSplineZero", l: "kubischer Spline (Zero)" },
  { v: "flatForward", l: "flat forward" },
  { v: "monotoneConvex" as InterpolationMethod, l: "Monotone Convex (Hagan–West)" },
];

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

/** Bump one quote by `bp` basis points in its own unit (futures price moves inversely; swap points are left untouched). */
export function bumpQuote(q: CurveQuote, bp: number): CurveQuote {
  switch (q.type) {
    case "Future":
      return { ...q, price: q.price - bp / 100 };
    case "BasisSwap":
    case "XccyBasis":
      return { ...q, spread: q.spread + bp * 1e-4 };
    case "FxSwapPoints":
      return q;
    default:
      return { ...q, rate: q.rate + bp * 1e-4 };
  }
}

const INTERP_ALLOWED = new Set<string>(INTERPOLATIONS.map((i) => i.v));

export function CurvesView() {
  const s = useStore(
    useShallow((st) => ({
      quotes: st.quotes,
      interpolation: st.interpolation,
      baseMarket: st.baseMarket,
      valuationDate: st.valuationDate,
    })),
  );
  const [sel, setSel] = useState(0);
  const [compare, setCompare] = useState<string | null>("EUR-EURIBOR-6M");
  const set = QUOTE_SETS[sel]!;
  const quotes = s.quotes;
  const curve = s.baseMarket.curves[set.curveId] as InterpolatedCurve | undefined;
  const sameCcy = Object.values(s.baseMarket.curves).filter((c) => c.currency === curve?.currency && c.id !== set.curveId);
  const cmpId = compare && sameCcy.some((c) => c.id === compare) ? compare : null;
  const cmp = cmpId ? (s.baseMarket.curves[cmpId] as InterpolatedCurve | undefined) : undefined;
  const modified = marketModified(s);
  const override = s.interpolation[set.curveId];
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
      const spec = specs[set.curveId];
      if (!spec) return null;
      const result = bootstrapCurves(s.valuationDate, [{ ...spec, interpolation: override ?? spec.interpolation }], s.baseMarket.curves).results[set.curveId];
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
  }, [specs, s.valuationDate, set.curveId, s.baseMarket.curves, override]);

  const applyQuotes = (next: SampleMarketQuotes, label: string) => {
    if (!useStore.getState().setQuotes(next, label)) useStore.getState().showToast("Bootstrap fehlgeschlagen – Quote nicht übernommen");
  };
  const updateQuote = (i: number, v: number) => {
    const next = JSON.parse(JSON.stringify(quotes)) as SampleMarketQuotes;
    const list = next[set.key] ?? [];
    const before = list[i]!;
    list[i] = withQuoteValue(before, v);
    const qv = quoteValue(before);
    applyQuotes(next, `Quote ${quoteLabel(before)} ${fmtNum(qv.value, qv.digits)} → ${fmtNum(v, qv.digits)} ${qv.unit}`);
  };
  const bumpAll = (bp: number) => {
    const next = JSON.parse(JSON.stringify(quotes)) as SampleMarketQuotes;
    next[set.key] = (next[set.key] ?? []).map((q) => bumpQuote(q, bp));
    applyQuotes(next, `Quotes ${set.label} ${bp > 0 ? "+" : ""}${bp} bp`);
  };
  const setInterp = (m: InterpolationMethod) => {
    const st = useStore.getState();
    const spec = specs?.[set.curveId];
    const isDefault = spec?.interpolation ? spec.interpolation === m : m === "logLinear";
    try {
      if (!st.setInterpolation(set.curveId, isDefault ? undefined : m)) st.showToast("Bootstrap mit dieser Interpolation fehlgeschlagen");
    } catch (e) {
      st.showToast(`Bootstrap fehlgeschlagen: ${translatePricingError(e)}`);
    }
  };
  const original = (i: number): CurveQuote | undefined => SAMPLE_QUOTES[set.key]?.[i];
  const isEdited = (i: number, q: CurveQuote) => JSON.stringify(original(i)) !== JSON.stringify(q);
  const interpValue = override ?? curve?.interpolation ?? "logLinear";
  const interpOptions = INTERP_ALLOWED.has(interpValue) ? INTERPOLATIONS : [...INTERPOLATIONS, { v: interpValue as InterpolationMethod, l: interpValue }];
  const overrideCount = Object.keys(s.interpolation).length;

  return (
    <div className="stack">
      <div className="row wrap toolbar">
        <div className="seg" role="group" aria-label="Kurve">
          {QUOTE_SETS.map((q, i) => (
            <button
              key={q.key}
              className={i === sel ? "active" : ""}
              aria-pressed={i === sel}
              title={q.title}
              onClick={() => setSel(i)}
              disabled={!s.baseMarket.curves[q.curveId]}
            >
              {q.label}
              {s.interpolation[q.curveId] && <span className="dot warn" aria-label="Interpolation überschrieben" />}
            </button>
          ))}
        </div>
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
        <div className="grow" />
        {modified && (
          <span className="chip warn" title="Quotes, Spots oder Interpolation weichen vom Sample-Markt ab" data-testid="market-modified-chip">
            <span className="dot" /> Markt modifiziert{overrideCount > 0 ? ` · ${overrideCount} Interpolation` : ""}
          </span>
        )}
        <button className="btn" onClick={() => bumpAll(10)}>
          Quotes +10 bp
        </button>
        <button className="btn" onClick={() => bumpAll(-10)}>
          Quotes −10 bp
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            const st = useStore.getState();
            st.resetQuotes();
            for (const id of Object.keys(st.interpolation)) st.setInterpolation(id, undefined);
          }}
          disabled={!modified}
        >
          Zurücksetzen
        </button>
      </div>

      <div className="grid curves-grid">
        <div className="card">
          <h3>
            {set.curveId}{" "}
            <span className="right muted xs">
              {INTERPOLATIONS.find((x) => x.v === curve?.interpolation)?.l ?? curve?.interpolation} · {curve?.dayCount} · Referenz{" "}
              {curve && fmtDate(curve.referenceDate)}
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
            Multi-Curve: Diskontierung über OIS ({s.baseMarket.discountCurveId.EUR}), Projektion der EURIBOR-Forwards über die Tenor-Kurve
            (Dual-Curve-Bootstrapping); Xccy-Basis liefert die USD-CSA-Diskontkurve. Interpolation je Kurve wählbar (Standard log-linear in Diskontfaktoren) –
            ein Override wird gespeichert, überlebt den Stichtagswechsel und bootstrappt abhängige Kurven neu.
          </div>
        </div>
        <div className="card">
          <h3>
            Marktquotes (editierbar){" "}
            <span className="right muted xs">
              geänderte Zellen orange · Original im Tooltip · <kbd>Ctrl</kbd>+<kbd>Z</kbd> macht Quote-Änderungen rückgängig
            </span>
          </h3>
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table className="grid-table quotes">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Pillar</th>
                  <th className="num">Quote</th>
                  <th className="num">Zero</th>
                  <th className="num">DF</th>
                  <th className="num" title="Bootstrap-Residuum: Satzdifferenz (bp) bzw. NPV je Nominaleinheit (×10⁻⁶)">
                    Residuum
                  </th>
                </tr>
              </thead>
              <tbody>
                {(quotes[set.key] ?? []).map((q, i) => {
                  const node = curve?.zeroRates()[i];
                  const qv = quoteValue(q);
                  const edited = isEdited(i, q);
                  const orig = original(i);
                  const origText = orig ? `Original ${fmtNum(quoteValue(orig).value, qv.digits)} ${qv.unit}` : "";
                  return (
                    <tr key={i} style={{ cursor: "default" }} className={edited ? "edited" : ""}>
                      <td>{quoteLabel(q)}</td>
                      <td className="mono muted xs">{boot?.dates[i] ? fmtDate(boot.dates[i]!.end) : ""}</td>
                      <td className={`num quote-cell ${edited ? "edited" : ""}`} title={edited ? origText : undefined}>
                        <span style={{ display: "inline-block", width: 112 }}>
                          <NumInput
                            inline
                            value={qv.value}
                            step={qv.step}
                            digits={qv.digits}
                            unit={qv.unit}
                            ariaLabel={`${quoteLabel(q)} Quote`}
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
            <kbd>↑</kbd>/<kbd>↓</kbd> Zeile · <kbd>y</kbd> kopieren
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
            <tbody onKeyDown={pillarNav.onKeyDown}>
              {curve?.zeroRates().map((n) => (
                <tr key={n.date} {...navRowProps()} style={{ cursor: "default" }}>
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
