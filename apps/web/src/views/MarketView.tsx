import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type CapletVolSurface,
  type Fixing,
  type FxFixing,
  type FxVolSurface,
  type SwaptionVolSurface,
  marketSnapshotId,
  serializeMarket,
  survivalProbability,
  toISO,
  validateVolSurfaces,
  volSurfaceWarnings,
} from "@deriva/pricing-core";
import { DateInput } from "../components/DateInput.js";
import { NumInput } from "../components/NumInput.js";
import { CDS_TENORS, hazardCurveResult, normaliseCdsQuotes, tenorYears } from "../lib/credit.js";
import { fmtBp, fmtDate, fmtNum, fmtPct } from "../lib/format.js";
import { translateCoreMessage } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { readSnapshotJson, snapshotErrorText } from "../lib/snapshot-import.js";
import { type CdsQuote, type VolKind, DEFAULT_REPORT_INPUTS, marketModified, sampleVolSurfaces, useStore } from "../state/store.js";

/**
 * Apply an edited vol surface: structural problems (dimensions, finite vols,
 * sorted expiries – core `validateVolSurfaces`, R5-1) are reported in German
 * before the market is touched; a failed valuation is reported as well.
 */
function applyVolSurface(kind: VolKind, id: string, surface: SwaptionVolSurface | CapletVolSurface | FxVolSurface, label: string): void {
  const act = useStore.getState;
  const problems = validateVolSurfaces({ [kind]: { [id]: surface } });
  if (problems.length) {
    act().showToast(`Vol nicht übernommen – ${translateCoreMessage(problems[0])}`);
    return;
  }
  if (!act().setVolSurface(kind, id, surface, label)) {
    act().showToast("Vol nicht übernommen (Bewertung fehlgeschlagen)");
    return;
  }
  // Plausibility (Markt R6-4): the edit is applied, but a surface that no longer fits its quotation type is flagged.
  const hints = volSurfaceWarnings({ [kind]: { [id]: surface } });
  if (hints.length) act().showToast(`Hinweis: ${translateCoreMessage(hints[0])}`, { ms: 8000 });
}

/** Expiry in years → "1M" / "3M" / "2Y" (also weeks for FX). */
export function expiryLabel(e: number): string {
  if (e < 1 / 4) return `${Math.round(e * 52)}W`;
  if (e < 1) return `${Math.round(e * 12)}M`;
  return `${e}Y`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Editable swaption ATM cube (Normal vol in bp) – cell edits are undoable and mark the market as modified (R3-4). */
function SwaptionVolCard({ id, surface }: { id: string; surface: SwaptionVolSurface }) {
  const act = useStore.getState;
  const sample = sampleVolSurfaces().swaptionVols[id];
  const edited = !same(surface, sample);
  const volMin = Math.min(...surface.atm.flat());
  const volMax = Math.max(...surface.atm.flat());
  const setCell = (i: number, j: number, v: number) => {
    const next: SwaptionVolSurface = { ...surface, atm: surface.atm.map((row, r) => (r === i ? row.map((x, c) => (c === j ? v : x)) : row)) };
    const label = `Swaption-Vol ${id} ${expiryLabel(surface.expiries[i]!)}×${surface.tenors[j]}Y ${fmtNum(surface.atm[i]![j]! * 1e4, 1)} → ${fmtNum(v * 1e4, 1)} bp`;
    applyVolSurface("swaptionVols", id, next, label);
  };
  return (
    <div className="card" data-testid="swaption-vol-card">
      <h3>
        Swaption-ATM-Vols {id} (Normal, bp){" "}
        <span className="right row wrap" style={{ gap: 6 }}>
          <span className="muted xs">Expiry × Tenor · editierbar · SABR-Smile für {Object.keys(surface.sabr ?? {}).length} Punkte</span>
          {edited && (
            <>
              <span className="badge warn" data-testid="swaption-vol-edited">
                geändert
              </span>
              <button
                className="btn ghost xs"
                onClick={() => act().setVolSurface("swaptionVols", id, undefined, `Swaption-Vols ${id} zurückgesetzt`)}
                data-testid="swaption-vol-reset"
                title="Fläche auf den Sample-Markt zurücksetzen (rückgängig über Ctrl+Z)"
              >
                Zurücksetzen
              </button>
            </>
          )}
        </span>
      </h3>
      <div
        className="heat editable"
        style={{ gridTemplateColumns: `70px repeat(${surface.tenors.length}, 1fr)` }}
        role="table"
        aria-label={`Swaption-ATM-Vols ${id}`}
        aria-rowcount={surface.expiries.length + 1}
        aria-colcount={surface.tenors.length + 1}
      >
        <div role="row" style={{ display: "contents" }}>
          <div className="head" role="columnheader" aria-label="Expiry ↓ / Tenor →" />
          {surface.tenors.map((t) => (
            <div key={t} className="head mono" role="columnheader">
              {t}Y
            </div>
          ))}
        </div>
        {surface.expiries.map((e, i) => (
          <div key={e} role="row" style={{ display: "contents" }}>
            <div className="head mono" role="rowheader" style={{ textAlign: "right" }}>
              {expiryLabel(e)}
            </div>
            {surface.atm[i]!.map((v, j) => {
              const a = (v - volMin) / (volMax - volMin || 1);
              const cellEdited = sample ? sample.atm[i]?.[j] !== v : true;
              return (
                <div key={j} className={`cell ${cellEdited ? "edited" : ""}`} role="cell" style={{ background: heatBg("--accent", a) }}>
                  <NumInput
                    inline
                    value={v}
                    scale={1e4}
                    step={1}
                    digits={1}
                    min={0.0001}
                    ariaLabel={`Swaption-Vol ${expiryLabel(e)} × ${surface.tenors[j]}Y`}
                    testId={i === 0 && j === 0 ? "swaption-vol-cell" : undefined}
                    onChange={(x) => setCell(i, j, x)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Editable FX smile (ATM / RR / BF per expiry, in %). */
function FxVolCard({ id, surface, keys, onSelect }: { id: string; surface: FxVolSurface; keys: string[]; onSelect: (k: string) => void }) {
  const act = useStore.getState;
  const sample = sampleVolSurfaces().fxVols[id];
  const edited = !same(surface, sample);
  type Row = "atm" | "rr25" | "bf25" | "rr10" | "bf10";
  const ROWS: { k: Row; label: string }[] = [
    { k: "atm", label: "ATM" },
    { k: "rr25", label: "25Δ RR" },
    { k: "bf25", label: "25Δ BF" },
    { k: "rr10", label: "10Δ RR" },
    { k: "bf10", label: "10Δ BF" },
  ];
  const setCell = (k: Row, i: number, v: number) => {
    const arr = surface[k];
    if (!arr) return;
    const next: FxVolSurface = { ...surface, [k]: arr.map((x, idx) => (idx === i ? v : x)) };
    const label = `FX-Vol ${id} ${expiryLabel(surface.expiries[i]!)} ${ROWS.find((r) => r.k === k)!.label} ${fmtNum(arr[i]! * 100, 2)} → ${fmtNum(v * 100, 2)} %`;
    applyVolSurface("fxVols", id, next, label);
  };
  return (
    <div className="card" data-testid="fx-vol-card">
      <h3>
        FX-Vol-Fläche {id.slice(0, 3)}/{id.slice(3)} (%, editierbar)
        <span className="right row wrap" style={{ gap: 6 }}>
          {edited && (
            <>
              <span className="badge warn" data-testid="fx-vol-edited">
                geändert
              </span>
              <button
                className="btn ghost xs"
                onClick={() => act().setVolSurface("fxVols", id, undefined, `FX-Vols ${id} zurückgesetzt`)}
                data-testid="fx-vol-reset"
                title="Fläche auf den Sample-Markt zurücksetzen (rückgängig über Ctrl+Z)"
              >
                Zurücksetzen
              </button>
            </>
          )}
        </span>
      </h3>
      {/* Pair tabs in their own wrapping row below the title: at 1024 px six pairs no longer run out of the card (R5-05). */}
      <div className="seg wrap" role="group" aria-label="Währungspaar" data-testid="fx-vol-pairs" style={{ marginBottom: 8 }}>
        {keys.map((k) => (
          <button key={k} className={k === id ? "active" : ""} aria-pressed={k === id} onClick={() => onSelect(k)}>
            {k.slice(0, 3)}/{k.slice(3)}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="grid-table compact">
          <thead>
            <tr>
              <th>Expiry</th>
              {ROWS.filter((r) => surface[r.k]).map((r) => (
                <th key={r.k} className="num">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {surface.expiries.map((e, i) => (
              <tr key={e} style={{ cursor: "default" }}>
                <td className="mono">{expiryLabel(e)}</td>
                {ROWS.filter((r) => surface[r.k]).map((r) => {
                  const v = surface[r.k]![i]!;
                  const cellEdited = sample ? sample[r.k]?.[i] !== v : true;
                  return (
                    <td key={r.k} className={`num vol-cell ${cellEdited ? "edited" : ""}`}>
                      <span style={{ display: "inline-block", width: 84 }}>
                        <NumInput
                          inline
                          value={v}
                          scale={100}
                          step={0.1}
                          digits={2}
                          unit="%"
                          ariaLabel={`FX-Vol ${expiryLabel(e)} ${r.label}`}
                          testId={i === 0 && r.k === "atm" ? "fx-vol-cell" : undefined}
                          onChange={(x) => setCell(r.k, i, x)}
                        />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Editable caplet surface (Normal vol in bp, expiry × strike). */
function CapletVolCard({ id, surface }: { id: string; surface: CapletVolSurface }) {
  const act = useStore.getState;
  const sample = sampleVolSurfaces().capletVols[id];
  const edited = !same(surface, sample);
  const setCell = (i: number, j: number, v: number) => {
    const next: CapletVolSurface = { ...surface, vols: surface.vols.map((row, r) => (r === i ? row.map((x, c) => (c === j ? v : x)) : row)) };
    const label = `Caplet-Vol ${id} ${expiryLabel(surface.expiries[i]!)} @ ${fmtNum(surface.strikes[j]! * 100, 2)} % ${fmtNum(surface.vols[i]![j]! * 1e4, 0)} → ${fmtNum(v * 1e4, 0)} bp`;
    applyVolSurface("capletVols", id, next, label);
  };
  return (
    <div className="card" data-testid="caplet-vol-card">
      <h3>
        Caplet-Vols {surface.index} (Normal, bp, editierbar)
        <span className="right row wrap" style={{ gap: 6 }}>
          <span className="muted xs">Expiry × Strike</span>
          {edited && (
            <>
              <span className="badge warn" data-testid="caplet-vol-edited">
                geändert
              </span>
              <button
                className="btn ghost xs"
                onClick={() => act().setVolSurface("capletVols", id, undefined, `Caplet-Vols ${id} zurückgesetzt`)}
                data-testid="caplet-vol-reset"
                title="Fläche auf den Sample-Markt zurücksetzen (rückgängig über Ctrl+Z)"
              >
                Zurücksetzen
              </button>
            </>
          )}
        </span>
      </h3>
      <div className="table-scroll" style={{ maxHeight: 320 }}>
        {/* Fixed layout: every strike column gets the same width and the input is bound to its cell (R4-01). */}
        <table className="grid-table compact vol-grid" data-testid="caplet-vol-table" style={{ minWidth: 70 + surface.strikes.length * 62 }}>
          <colgroup>
            <col style={{ width: 70 }} />
            {surface.strikes.map((k) => (
              <col key={k} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th>Expiry</th>
              {surface.strikes.map((k) => (
                <th key={k} className="num">
                  {fmtNum(k * 100, 2)} %
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {surface.expiries.map((e, i) => (
              <tr key={e} style={{ cursor: "default" }}>
                <td className="mono">{expiryLabel(e)}</td>
                {surface.vols[i]!.map((v, j) => {
                  const cellEdited = sample ? sample.vols[i]?.[j] !== v : true;
                  return (
                    <td key={j} className={`num vol-cell ${cellEdited ? "edited" : ""}`}>
                      <NumInput
                        inline
                        width="100%"
                        value={v}
                        scale={1e4}
                        step={1}
                        digits={0}
                        min={0.0001}
                        ariaLabel={`Caplet-Vol ${expiryLabel(e)} Strike ${fmtNum(surface.strikes[j]! * 100, 2)} %`}
                        testId={i === 0 && j === 0 ? "caplet-vol-cell" : undefined}
                        onChange={(x) => setCell(i, j, x)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FIXING_INDICES = ["EURIBOR-1M", "EURIBOR-3M", "EURIBOR-6M", "EURIBOR-12M", "ESTR", "SOFR", "SONIA", "SARON", "TONA"];

const pairLabel = (p: string) => (/^[A-Z]{6}$/.test(p) ? `${p.slice(0, 3)}/${p.slice(3)}` : p);

/**
 * Editable table of historical FX fixings (pair, date, rate) for the notional
 * resets of mark-to-market cross-currency swaps (core R4-1). The list is part of
 * the market: persisted, exported/imported with the snapshot, undoable and
 * counted as "Markt modifiziert".
 */
function FxFixingsEditor() {
  const m = useStore((s) => s.baseMarket);
  const fxFixings = useStore((s) => s.fxFixings);
  const act = useStore.getState;
  const pairs = [...new Set([...Object.keys(m.fxSpots), ...fxFixings.map((f) => f.pair)])];
  const firstPair = pairs[0] ?? "EURUSD";
  const [pairSel, setPairSel] = useState(firstPair);
  const addPair = pairs.includes(pairSel) ? pairSel : firstPair;
  const apply = (next: FxFixing[], label: string) => {
    if (!act().setFxFixings(next, label)) act().showToast("FX-Fixing nicht übernommen (Bewertung fehlgeschlagen)");
  };
  const setRow = (i: number, patch: Partial<FxFixing>) => {
    const f = { ...fxFixings[i]!, ...patch };
    apply(
      fxFixings.map((x, j) => (j === i ? f : x)),
      `FX-Fixing ${pairLabel(f.pair)} ${fmtDate(f.date)} = ${fmtNum(f.rate, 4)}`,
    );
  };
  const remove = (i: number) => {
    const f = fxFixings[i]!;
    apply(
      fxFixings.filter((_, j) => j !== i),
      `FX-Fixing ${pairLabel(f.pair)} ${fmtDate(f.date)} entfernt`,
    );
  };
  const add = (f: FxFixing, label: string) => apply([...fxFixings, f], label);
  /** Today's fixing of the selected pair from the market spot. */
  const addTodayFromSpot = () => {
    const spot = m.fxSpots[addPair];
    const inverse = m.fxSpots[`${addPair.slice(3)}${addPair.slice(0, 3)}`];
    const rate = spot ?? (inverse ? 1 / inverse : undefined);
    if (rate === undefined) {
      act().showToast(`Kein Spot für ${pairLabel(addPair)} im Markt`);
      return;
    }
    if (fxFixings.some((f) => f.pair === addPair && f.date === m.valuationDate)) {
      act().showToast(`FX-Fixing ${pairLabel(addPair)} ${fmtDate(m.valuationDate)} ist bereits hinterlegt`);
      return;
    }
    add(
      { pair: addPair, date: m.valuationDate, rate: Math.round(rate * 1e6) / 1e6 },
      `FX-Fixing ${pairLabel(addPair)} ${fmtDate(m.valuationDate)} = ${fmtNum(rate, 4)} (Spot)`,
    );
  };
  return (
    <div className="card" data-testid="fx-fixings-editor">
      <h3>
        FX-Fixings (MtM-Reset, editierbar)
        <span className="right row wrap" style={{ gap: 6 }}>
          <select
            className="inline"
            value={addPair}
            aria-label="Währungspaar für neues FX-Fixing"
            data-testid="fx-fixing-pair"
            onChange={(e) => setPairSel(e.target.value)}
          >
            {pairs.map((p) => (
              <option key={p} value={p}>
                {pairLabel(p)}
              </option>
            ))}
          </select>
          <button
            className="btn ghost"
            onClick={addTodayFromSpot}
            data-testid="fx-fixing-add-spot"
            title="Fixing des gewählten Paars am Bewertungstag aus dem Markt-Spot anlegen"
          >
            + heute aus Spot
          </button>
          <button
            className="btn"
            data-testid="fx-fixing-add"
            onClick={() =>
              add(
                { pair: addPair, date: m.valuationDate, rate: m.fxSpots[addPair] ?? 1 },
                `FX-Fixing ${pairLabel(addPair)} ${fmtDate(m.valuationDate)} hinzugefügt`,
              )
            }
          >
            + Zeile
          </button>
        </span>
      </h3>
      {fxFixings.length === 0 ? (
        <div className="muted small">
          Keine historischen FX-Fixings hinterlegt – vergangene MtM-Reset-Termine eines Cross-Currency-Swaps werden mit dem heutigen Kurs genähert (Hinweis
          „FX-Fixing fehlt“ im Pricing).
        </div>
      ) : (
        <div className="table-scroll" style={{ maxHeight: 260 }}>
          <table className="grid-table" data-testid="fx-fixings-table">
            <thead>
              <tr>
                <th>Paar</th>
                <th>Datum</th>
                <th className="num">Kurs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fxFixings.map((f, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td>
                    <select className="inline" value={f.pair} aria-label={`Paar FX-Fixing ${i + 1}`} onChange={(e) => setRow(i, { pair: e.target.value })}>
                      {[...new Set([...pairs, f.pair])].map((p) => (
                        <option key={p} value={p}>
                          {pairLabel(p)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <DateInput inline value={f.date} ariaLabel={`Datum FX-Fixing ${i + 1}`} onChange={(v) => setRow(i, { date: v })} />
                  </td>
                  <td className="num">
                    <span style={{ display: "inline-block", width: 110 }}>
                      <NumInput
                        inline
                        value={f.rate}
                        step={0.0005}
                        digits={4}
                        min={0.000001}
                        ariaLabel={`Kurs FX-Fixing ${i + 1}`}
                        testId={i === 0 ? "fx-fixing-rate" : undefined}
                        onChange={(v) => setRow(i, { rate: v })}
                      />
                    </span>
                  </td>
                  <td className="num">
                    <button className="btn ghost danger" title="FX-Fixing entfernen" aria-label={`FX-Fixing ${i + 1} entfernen`} onClick={() => remove(i)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted xs" style={{ marginTop: 6 }}>
        Kurs als Preis der Basiswährung ({pairLabel(addPair)} = 1 {addPair.slice(0, 3)} in {addPair.slice(3)}); die Gegenquotierung wird automatisch bedient.
        Teil des Snapshots (Export/Import), rückgängig mit <kbd>Ctrl</kbd>+<kbd>Z</kbd>.
      </div>
    </div>
  );
}

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
  const hazardRes = useMemo(
    () => hazardCurveResult(cdsCurves, cpty, recovery, m.valuationDate, discount),
    [cdsCurves, cpty, recovery, m.valuationDate, discount],
  );
  const hazard = hazardRes.curve;
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
          {hazardRes.warnings.length > 0 && (
            <div className="warning" style={{ margin: "6px 0 8px" }} data-testid="hazard-warnings">
              <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
                {hazardRes.warnings.map((w) => (
                  <li key={w}>{translateCoreMessage(w)}</li>
                ))}
              </ul>
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

/**
 * Editable table of historical fixings (index, date, value in %). Edits go
 * through `setFixings` – an undoable, persisted override that flags the market
 * as "modifiziert" in sample and import mode alike (R6-F1); "Zurücksetzen"
 * returns to the base market's own fixings.
 */
const FIXINGS_PAGE = 60;

function FixingsEditor() {
  const m = useStore((s) => s.baseMarket);
  const override = useStore((s) => s.fixings);
  const act = useStore.getState;
  const fixings = useMemo(() => m.fixings ?? [], [m.fixings]);
  // The sample market carries ≈1 300 historical fixings (core R6-6): filter by index / year and page the table, newest first.
  const indices = useMemo(() => [...new Set(fixings.map((f) => f.index))].sort(), [fixings]);
  const years = useMemo(() => [...new Set(fixings.map((f) => toISO(f.date).slice(0, 4)))].sort().reverse(), [fixings]);
  const [filterIndex, setFilterIndex] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [limit, setLimit] = useState(FIXINGS_PAGE);
  const visible = useMemo(() => {
    const rows = fixings
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => (!filterIndex || f.index === filterIndex) && (!filterYear || toISO(f.date).startsWith(filterYear)));
    rows.sort((a, b) => b.f.date - a.f.date || a.f.index.localeCompare(b.f.index));
    return rows;
  }, [fixings, filterIndex, filterYear]);
  const apply = (next: Fixing[], label: string) => {
    if (!act().setFixings(next, label)) act().showToast("Fixing nicht übernommen (Bewertung fehlgeschlagen)");
  };
  const setRow = (i: number, patch: Partial<Fixing>) =>
    apply(
      fixings.map((f, j) => (j === i ? { ...f, ...patch } : f)),
      `Fixing ${fixings[i]?.index ?? ""} ${fmtDate(patch.date ?? fixings[i]?.date ?? m.valuationDate)} geändert`,
    );
  const remove = (i: number) =>
    apply(
      fixings.filter((_, j) => j !== i),
      `Fixing ${fixings[i]?.index ?? ""} ${fixings[i] ? fmtDate(fixings[i]!.date) : ""} entfernt`,
    );
  const add = (f: Fixing) => apply([...fixings, f], `Fixing ${f.index} ${fmtDate(f.date)} hinzugefügt`);
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
        {override && (
          <span className="badge warn" style={{ marginLeft: 6 }} title="Fixings weichen vom Basismarkt ab (Undo mit Ctrl+Z)" data-testid="fixings-modified">
            geändert
          </span>
        )}
        <span className="right row">
          {override && (
            <button className="btn ghost xs" onClick={() => act().setFixings(null, "Fixings zurückgesetzt")} title="Zurück zu den Fixings des Basismarkts">
              Zurücksetzen
            </button>
          )}
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
        <>
          <div className="row wrap" style={{ gap: 8, marginBottom: 6 }} data-testid="fixings-filter">
            <select className="inline" value={filterIndex} aria-label="Fixings nach Index filtern" onChange={(e) => setFilterIndex(e.target.value)}>
              <option value="">alle Indizes ({indices.length})</option>
              {indices.map((ix) => (
                <option key={ix} value={ix}>
                  {ix}
                </option>
              ))}
            </select>
            <select className="inline" value={filterYear} aria-label="Fixings nach Jahr filtern" onChange={(e) => setFilterYear(e.target.value)}>
              <option value="">alle Jahre</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <span className="muted xs" data-testid="fixings-count">
              {visible.length === fixings.length ? `${fixings.length} Fixings` : `${visible.length} von ${fixings.length} Fixings`} · neueste zuerst
            </span>
          </div>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table className="grid-table" data-testid="fixings-table">
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Datum</th>
                  <th className="num">Fixing</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map(({ f, i }) => (
                  <tr key={`${f.index}-${f.date}-${i}`} style={{ cursor: "default" }}>
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
          {visible.length > limit && (
            <button className="btn ghost xs" style={{ marginTop: 6 }} onClick={() => setLimit((n) => n + FIXINGS_PAGE)} data-testid="fixings-more">
              weitere {Math.min(FIXINGS_PAGE, visible.length - limit)} anzeigen ({visible.length - limit} ausgeblendet)
            </button>
          )}
        </>
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
  const s = useStore(
    useShallow((st) => ({
      baseMarket: st.baseMarket,
      valuationDate: st.valuationDate,
      quotes: st.quotes,
      interpolation: st.interpolation,
      turnOfYear: st.turnOfYear,
      volSurfaces: st.volSurfaces,
      fxFixings: st.fxFixings,
      fxSpotOverrides: st.fxSpotOverrides,
      fixings: st.fixings,
      importedBase: st.importedBase,
      marketSource: st.marketSource,
    })),
  );
  const act = useStore.getState;
  const m = s.baseMarket;
  const imported = s.marketSource === "import";
  // Deterministic id of exactly this base market – the same value the report shows as "Snapshot" (R5-F2).
  const snapshotId = useMemo(() => marketSnapshotId(m), [m]);
  const swptKeys = Object.keys(m.swaptionVols ?? {});
  const [swptSel, setSwptSel] = useState(swptKeys[0] ?? "EUR");
  const swptId = swptKeys.includes(swptSel) ? swptSel : swptKeys[0];
  const swpt = swptId ? m.swaptionVols?.[swptId] : undefined;
  const fxKeys = Object.keys(m.fxVols ?? {});
  const [fxSel, setFxSel] = useState(fxKeys[0] ?? "EURUSD");
  const fxId = fxKeys.includes(fxSel) ? fxSel : fxKeys[0];
  const fxv = fxId ? m.fxVols?.[fxId] : undefined;
  const capKeys = Object.keys(m.capletVols ?? {});
  const [capSel, setCapSel] = useState(capKeys[0] ?? "");
  const capId = capKeys.includes(capSel) ? capSel : capKeys[0];
  const capv = capId ? m.capletVols?.[capId] : undefined;
  const modified = marketModified(s);

  const setSpot = (pair: string, v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    // Sample market: the spot is a quote (survives date changes, "modifiziert", Ctrl+Z). Imported snapshot: an undoable,
    // persisted override on top of the file – the chip shows "modifiziert", "Markt zurücksetzen" returns to the snapshot (R6-F1).
    if (!act().setFxSpot(pair, v, `Spot ${pair.slice(0, 3)}/${pair.slice(3)} ${fmtNum(v, 4)}`))
      act().showToast("Spot nicht übernommen (Bewertung fehlgeschlagen)");
  };
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
            {imported && (
              <span
                className="badge ok"
                style={{ marginLeft: 6 }}
                data-testid="snapshot-imported"
                title="Kurven, Spots, Fixings und Vol-Flächen stammen aus der importierten Datei"
              >
                importiert
              </span>
            )}
            <br />
            Label: {m.meta?.label}
            {modified && (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                modifiziert
              </span>
            )}
            <br />
            Snapshot-ID:{" "}
            <span className="mono" data-testid="snapshot-id" title="Deterministische ID aller Marktdaten (FNV-1a) – identisch mit der Snapshot-ID im Report">
              {snapshotId}
            </span>
            <br />
            Kurven: {Object.keys(m.curves).length} · Fixings: {m.fixings?.length ?? 0} · FX-Fixings: {m.fxFixings?.length ?? 0} · Vol-Flächen:{" "}
            {Object.keys(m.swaptionVols ?? {}).length + Object.keys(m.capletVols ?? {}).length + Object.keys(m.fxVols ?? {}).length}
            {Object.keys(s.interpolation).length > 0 && ` · Interpolations-Overrides: ${Object.keys(s.interpolation).join(", ")}`}
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button
              className="btn"
              data-testid="snapshot-export"
              onClick={() => {
                downloadText(`deriva-market-${toISO(m.valuationDate)}.json`, JSON.stringify(serializeMarket(m), null, 2), "application/json");
                act().showToast(`Markt-Snapshot exportiert · ID ${snapshotId}`);
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
                data-testid="snapshot-import"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    // German causes for every failure: JSON, schema, missing fields, core validation (R5-06)
                    const json = readSnapshotJson(await file.text());
                    const r = act().importSnapshot(json);
                    if (!r.ok) {
                      act().showToast(`Import fehlgeschlagen: ${r.error}`, { ms: 8000 });
                      return;
                    }
                    act().showToast(
                      `Snapshot „${r.label}“ importiert · ID ${r.id}${r.dateChanged ? ` · Bewertungstag auf ${fmtDate(r.valuationDate)} gesetzt` : ""}${
                        r.discardedEdits ? " · vorherige Marktänderungen verworfen (Rückgängig stellt sie wieder her)" : ""
                      }`,
                      { ms: 8000, action: { label: "Rückgängig", run: () => useStore.getState().undo() } },
                    );
                    // Plausibility hints of the imported surfaces (Markt R6-4): the import stands, the user sees why values may look off.
                    if (r.warnings.length)
                      act().showToast(`Snapshot importiert – Hinweis: ${r.warnings[0]}${r.warnings.length > 1 ? ` (+${r.warnings.length - 1} weitere)` : ""}`, {
                        ms: 10000,
                      });
                  } catch (err) {
                    act().showToast(`Import fehlgeschlagen: ${snapshotErrorText(err, (x) => (x instanceof Error ? x.message : String(x)))}`, { ms: 8000 });
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {imported && (
              <button
                className="btn ghost"
                onClick={() => {
                  act().leaveImport();
                  act().showToast(`Sample-Markt aus den Quotes zum ${fmtDate(useStore.getState().valuationDate)} aufgebaut`, {
                    action: { label: "Rückgängig", run: () => useStore.getState().undo() },
                  });
                }}
                data-testid="snapshot-leave"
                title="Importierten Snapshot verwerfen und den Sample-Markt aus den Quotes am aktuellen Bewertungstag aufbauen"
              >
                Zum Sample-Markt
              </button>
            )}
            {modified && (
              <button
                className="btn ghost"
                onClick={() => act().resetMarketOverrides()}
                data-testid="market-reset"
                title={
                  imported
                    ? "Vol-, Spot-, Fixing- und FX-Fixing-Änderungen verwerfen – zurück zum importierten Snapshot"
                    : "Quotes, Interpolation, Turn-of-Year, Vol-Flächen, Fixings und FX-Fixings auf den Sample-Markt zurücksetzen"
                }
              >
                {imported ? "Auf Snapshot zurücksetzen" : "Markt zurücksetzen"}
              </button>
            )}
          </div>
          {imported ? (
            <div className="warning" style={{ marginTop: 10 }} data-testid="snapshot-import-note">
              Markt aus importiertem Snapshot: Kurven, Spots, Fixings und Vol-Flächen kommen aus der Datei, der Bewertungstag ist der des Snapshots (
              {fmtDate(m.valuationDate)}). Quotes, Interpolation und Turn-of-Year sind nicht verfügbar; Spots, Fixings, FX-Fixings und Vol-Flächen sind als
              Änderung am Snapshot editierbar („modifiziert“, Ctrl+Z, „Auf Snapshot zurücksetzen“). Ein anderer Bewertungstag verwirft den Snapshot nach
              Rückfrage – auch das ist rückgängig.
            </div>
          ) : (
            <div className="warning" style={{ marginTop: 10 }}>
              Indikative Beispieldaten. Für den Produktivbetrieb Marktdaten-Adapter (Refinitiv/Bloomberg/ICE/EZB) gemäß ADR-005 anbinden.
            </div>
          )}
        </div>
        <div className="card">
          <h3>FX-Spots (editierbar)</h3>
          <div className="table-scroll">
            <table className="grid-table" aria-label="FX-Spots">
              <tbody>
                {Object.entries(m.fxSpots).map(([pair, v]) => {
                  const orig = imported
                    ? (s.importedBase?.fxSpots[pair] ?? v)
                    : ((Object.entries(s.quotes.fxSpots).find(([p]) => p === pair)?.[1] ?? v) as number);
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
                          <span className="muted xs" title={`${imported ? "Snapshot" : "Quote"} ${fmtNum(orig, 4)}`} data-testid="spot-edited">
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

      <div className="grid cols-2">
        <FixingsEditor />
        <FxFixingsEditor />
      </div>

      {swpt && swptId && (
        <>
          {swptKeys.length > 1 && (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="muted xs">Swaption-Cube</span>
              <div className="seg" role="group" aria-label="Swaption-Cube Währung">
                {swptKeys.map((k) => (
                  <button key={k} className={k === swptId ? "active" : ""} aria-pressed={k === swptId} onClick={() => setSwptSel(k)}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}
          <SwaptionVolCard id={swptId} surface={swpt} />
        </>
      )}

      <div className="grid cols-2">
        {fxv && fxId && <FxVolCard id={fxId} surface={fxv} keys={fxKeys} onSelect={setFxSel} />}
        {capv && capId && (
          <div className="stack">
            {capKeys.length > 1 && (
              <div className="seg" role="group" aria-label="Caplet-Fläche">
                {capKeys.map((k) => (
                  <button key={k} className={k === capId ? "active" : ""} aria-pressed={k === capId} onClick={() => setCapSel(k)}>
                    {k}
                  </button>
                ))}
              </div>
            )}
            <CapletVolCard id={capId} surface={capv} />
          </div>
        )}
      </div>
      <div className="muted xs">
        Vol-Flächen sind Teil des Marktes: Änderungen zählen als „Markt modifiziert“, werden lokal gespeichert, überleben den Stichtagswechsel und sind mit{" "}
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> rückgängig; „Zurücksetzen“ an der Karte oder „Markt zurücksetzen“ stellt den Sample-Markt wieder her.
      </div>
    </div>
  );
}
