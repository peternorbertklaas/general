import { useMemo, useState } from "react";
import { SAMPLE_QUOTES, type CurveQuote, type InterpolatedCurve, type SampleMarketQuotes, buildSampleMarket, toISO } from "@deriva/pricing-core";
import { EChart, cssVar } from "../components/EChart.js";
import { fmtDate, fmtPct } from "../lib/format.js";
import { useStore } from "../state/store.js";

const QUOTE_SETS: { key: keyof Omit<SampleMarketQuotes, "fxSpots">; curveId: string; label: string }[] = [
  { key: "eurOis", curveId: "EUR-ESTR", label: "EUR €STR OIS" },
  { key: "eur6m", curveId: "EUR-EURIBOR-6M", label: "EUR EURIBOR 6M" },
  { key: "eur3m", curveId: "EUR-EURIBOR-3M", label: "EUR EURIBOR 3M" },
  { key: "usdSofr", curveId: "USD-SOFR", label: "USD SOFR OIS" },
  { key: "gbpSonia", curveId: "GBP-SONIA", label: "GBP SONIA OIS" },
  { key: "chfSaron", curveId: "CHF-SARON", label: "CHF SARON OIS" },
];

function quoteLabel(q: CurveQuote): string {
  switch (q.type) {
    case "Deposit":
      return `Depo ${q.tenor}`;
    case "FRA":
      return `FRA ${q.start}×${q.end}`;
    case "Swap":
      return `Swap ${q.tenor}`;
    case "OIS":
      return `OIS ${q.tenor}`;
  }
}

export function CurvesView() {
  const s = useStore();
  const [sel, setSel] = useState(0);
  const [quotes, setQuotes] = useState<SampleMarketQuotes>(() => JSON.parse(JSON.stringify(SAMPLE_QUOTES)));
  const [compare, setCompare] = useState<string | null>("EUR-EURIBOR-6M");
  const set = QUOTE_SETS[sel]!;
  const curve = s.baseMarket.curves[set.curveId] as InterpolatedCurve | undefined;
  const cmp = compare ? (s.baseMarket.curves[compare] as InterpolatedCurve | undefined) : undefined;

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

  const applyQuotes = (next: SampleMarketQuotes) => {
    setQuotes(next);
    try {
      s.setMarket(buildSampleMarket(s.valuationDate, next));
    } catch (e) {
      s.showToast(`Bootstrap fehlgeschlagen: ${(e as Error).message}`);
    }
  };
  const updateQuote = (i: number, rate: number) => {
    const next = JSON.parse(JSON.stringify(quotes)) as SampleMarketQuotes;
    (next[set.key][i] as { rate: number }).rate = rate;
    applyQuotes(next);
  };
  const bumpAll = (bp: number) => {
    const next = JSON.parse(JSON.stringify(quotes)) as SampleMarketQuotes;
    next[set.key] = next[set.key].map((q) => ({ ...q, rate: q.rate + bp * 1e-4 }));
    applyQuotes(next);
  };

  return (
    <div className="stack">
      <div className="row">
        <div className="seg">
          {QUOTE_SETS.map((q, i) => (
            <button key={q.key} className={i === sel ? "active" : ""} onClick={() => setSel(i)}>
              {q.label}
            </button>
          ))}
        </div>
        <span className="muted small">Vergleich:</span>
        <select value={compare ?? ""} onChange={(e) => setCompare(e.target.value || null)} style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}>
          <option value="">–</option>
          {Object.keys(s.baseMarket.curves).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <div className="grow" />
        <button className="btn" onClick={() => bumpAll(10)}>
          Quotes +10bp
        </button>
        <button className="btn" onClick={() => bumpAll(-10)}>
          Quotes -10bp
        </button>
        <button className="btn ghost" onClick={() => applyQuotes(JSON.parse(JSON.stringify(SAMPLE_QUOTES)))}>
          Zurücksetzen
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div className="card">
          <h3>
            {set.curveId} <span className="right muted xs">{curve?.interpolation} · {curve?.dayCount} · Referenz {curve && fmtDate(curve.referenceDate)}</span>
          </h3>
          {series && (
            <EChart
              className="chart tall"
              option={{
                legend: { top: 0, textStyle: { color: cssVar("--fg-2") } },
                tooltip: { trigger: "axis", valueFormatter: (v) => `${(v as number).toFixed(3)} %` },
                xAxis: { type: "value", name: "Jahre", min: 0, max: 30 },
                yAxis: { type: "value", scale: true, axisLabel: { formatter: (v: number) => `${v.toFixed(2)}%` } },
                series: [
                  { name: "Zero (stetig)", type: "line", data: series.zero, showSymbol: false, smooth: false, lineStyle: { width: 2 } },
                  { name: "6M-Forward", type: "line", data: series.fwd, showSymbol: false, lineStyle: { width: 1.5, type: "dashed" } },
                  ...(cmp ? [{ name: `${cmp.id} Zero`, type: "line" as const, data: series.cmpZero, showSymbol: false, lineStyle: { width: 1.5 } }] : []),
                ],
              }}
            />
          )}
          <div className="muted xs" style={{ marginTop: 6 }}>
            Multi-Curve: Diskontierung über OIS ({s.baseMarket.discountCurveId.EUR}), Projektion der EURIBOR-Forwards über die Tenor-Kurve (Dual-Curve-Bootstrapping). Interpolation log-linear in Diskontfaktoren, flat-forward-Extrapolation.
          </div>
        </div>
        <div className="card">
          <h3>Marktquotes (editierbar)</h3>
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th className="num">Quote %</th>
                  <th className="num">Zero %</th>
                  <th className="num">DF</th>
                </tr>
              </thead>
              <tbody>
                {quotes[set.key].map((q, i) => {
                  const node = curve?.zeroRates()[i + 0];
                  return (
                    <tr key={i} style={{ cursor: "default" }}>
                      <td>{quoteLabel(q)}</td>
                      <td className="num">
                        <input type="number" step={0.005} value={Number((q.rate * 100).toFixed(4))} onChange={(e) => updateQuote(i, Number(e.target.value) / 100)} style={{ width: 90, textAlign: "right", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", fontFamily: "var(--font-mono)" }} />
                      </td>
                      <td className="num muted">{node ? fmtPct(node.zero, 4) : ""}</td>
                      <td className="num muted">{node ? node.df.toFixed(6) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Pillars {set.curveId}</h3>
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th className="num">Jahre</th>
                <th className="num">Zero (stetig)</th>
                <th className="num">Diskontfaktor</th>
                <th className="num">Fwd 6M ab Pillar</th>
              </tr>
            </thead>
            <tbody>
              {curve?.zeroRates().map((n) => (
                <tr key={n.date} style={{ cursor: "default" }}>
                  <td className="mono">{toISO(n.date)}</td>
                  <td className="num">{n.time.toFixed(3)}</td>
                  <td className="num">{fmtPct(n.zero, 4)}</td>
                  <td className="num">{n.df.toFixed(8)}</td>
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
