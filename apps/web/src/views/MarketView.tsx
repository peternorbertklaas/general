import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type CapletVolSurface,
  type Fixing,
  type FxFixing,
  type FxVolSurface,
  type SwaptionVolSurface,
  knownIndices,
  marketSnapshotId,
  serializeMarket,
  survivalProbability,
  toISO,
  validateVolSurfaces,
  volSurfaceWarnings,
} from "@deriva/pricing-core";
import { DateInput } from "../components/DateInput.js";
import { NumInput } from "../components/NumInput.js";
import { useGridNav } from "../hooks/useGridNav.js";
import { useTableNav } from "../hooks/useTableNav.js";
import { CDS_TENORS, hazardCurveResult, normaliseCdsQuotes, tenorYears } from "../lib/credit.js";
import { focusWhenPresent } from "../lib/focus.js";
import { fmtBp, fmtDate, fmtNum, fmtPct } from "../lib/format.js";
import { translateCoreMessage } from "../lib/i18n.js";
import { downloadText } from "../lib/portfolio-io.js";
import { defaultIndexFor } from "../lib/register.js";
import { exportEnvelope } from "../lib/register-envelope.js";
import { readSnapshotJson, snapshotErrorText } from "../lib/snapshot-import.js";
import { type CdsQuote, type VolKind, DEFAULT_REPORT_INPUTS, marketModified, sampleVolSurfaces, useStore } from "../state/store.js";

/**
 * Apply an edited vol surface: structural problems (dimensions, finite vols,
 * sorted expiries – core `validateVolSurfaces`, R5-1) are reported in German
 * before the market is touched; a failed valuation is reported as well.
 * A surface added with "+ Fläche" in sample mode is a structural extra (R8-F2):
 * its edits update the extra itself (`structural`), everything else is a vol
 * override. Returns whether the surface was applied.
 */
function applyVolSurface(
  kind: VolKind,
  id: string,
  surface: SwaptionVolSurface | CapletVolSurface | FxVolSurface,
  label: string,
  opts: { structural?: boolean } = {},
): boolean {
  const act = useStore.getState;
  const problems = validateVolSurfaces({ [kind]: { [id]: surface } });
  if (problems.length) {
    act().showToast(`Vol nicht übernommen – ${translateCoreMessage(problems[0])}`);
    return false;
  }
  const st = act();
  const structural = opts.structural ?? (st.marketSource === "sample" && st.extraVolSurfaces[kind]?.[id] !== undefined);
  const ok = structural ? st.setExtraVolSurface(kind, id, surface, label) : st.setVolSurface(kind, id, surface, label);
  if (!ok) {
    act().showToast("Vol nicht übernommen (Bewertung fehlgeschlagen)");
    return false;
  }
  // Plausibility (Markt R6-4): the edit is applied, but a surface that no longer fits its quotation type is flagged.
  const hints = volSurfaceWarnings({ [kind]: { [id]: surface } });
  if (hints.length) act().showToast(`Hinweis: ${translateCoreMessage(hints[0])}`, { ms: 8000 });
  return true;
}

/** Enabled controls of a table row in DOM order (select, date, value, remove …). */
function rowControls(tr: HTMLElement): HTMLElement[] {
  return Array.from(tr.querySelectorAll<HTMLElement>("input, select, textarea, button")).filter((c) => !c.hasAttribute("disabled"));
}

/**
 * Roving-tabindex helpers shared by the editable row tables of this view
 * (fixings, FX fixings, CDS quotes – R7-01 / R8-01): the row is the tab stop,
 * `↵`/`F2` focus the first control of the row, `Tab`/`Shift+Tab` inside a
 * control cycle through *all* controls of the same row (index, date, value,
 * remove – nothing is mouse-only any more), `Esc` returns to the row and `↵`
 * in a control commits the value and returns to the row as well (R8-03).
 * Exported for the hook test.
 */
export function useRowNav() {
  const nav = useTableNav({ onEnter: (_i, tr) => rowControls(tr)[0]?.focus() });
  const onKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "F2" && target.tagName === "TR") {
      e.preventDefault();
      rowControls(target)[0]?.focus();
      return;
    }
    // Tab / Shift+Tab inside a control: next / previous control of the same row, cyclic (R8-01) – Esc leaves to the row.
    if (e.key === "Tab" && target.tagName !== "TR" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const tr = target.closest("tr");
      const controls = tr ? rowControls(tr) : [];
      const i = controls.indexOf(target);
      if (tr && i >= 0 && controls.length > 1) {
        e.preventDefault();
        const next = controls[(i + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]!;
        next.focus();
        if (next instanceof HTMLInputElement) next.select();
        return;
      }
    }
    nav.onKeyDown(e);
  };
  /**
   * Capture phase: the control's own Esc / Enter handler (NumInput / DateInput restore or commit the value and blur)
   * runs afterwards; the row takes the focus back in the next macrotask (R7-01 / R8-03).
   */
  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    if ((e.key !== "Escape" && e.key !== "Enter") || target.tagName === "TR") return;
    const tr = target.closest("tr");
    window.setTimeout(() => {
      if (tr && document.contains(tr)) tr.focus();
    }, 0);
  };
  return { tbodyProps: { onKeyDown, onKeyDownCapture, onFocus: nav.onFocus }, rowProps: nav.rowProps };
}

/** Hint line under the row tables: one tab stop, `↵`/`F2` open, `Tab` cycles the row's controls, `↵` commits and returns (R8-01 / R8-03). */
function RowKeysHint({ pageSize }: { pageSize?: number }) {
  return (
    <>
      <kbd>↑</kbd>/<kbd>↓</kbd> Zeile{pageSize ? ` · ` : " · "}
      {pageSize && (
        <>
          <kbd>PgUp</kbd>/<kbd>PgDn</kbd> {pageSize} Zeilen ·{" "}
        </>
      )}
      <kbd>↵</kbd> oder <kbd>F2</kbd> bearbeiten · <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> nächstes/vorheriges Feld der Zeile · <kbd>↵</kbd> übernimmt und kehrt zur
      Zeile zurück · <kbd>Esc</kbd> zurück zur Zeile · von der Zeile aus verlässt <kbd>Tab</kbd> die Tabelle.
    </>
  );
}

/**
 * Removal / reset button of a vol-surface card: a surface the sample market does not carry is *removed* (R7-2) – a
 * structural "+ Fläche" surface via `setExtraVolSurface` (R8-F2), an override via `setVolSurface` –, a sample surface reset.
 */
function VolCardReset({ kind, id, isNew, testId }: { kind: VolKind; id: string; isNew: boolean; testId: string }) {
  const act = useStore.getState;
  const what = kind === "swaptionVols" ? "Swaption-Vols" : kind === "capletVols" ? "Caplet-Vols" : "FX-Vols";
  const remove = () => {
    const st = act();
    const label = isNew ? `${what} ${id} entfernt` : `${what} ${id} zurückgesetzt`;
    if (isNew && st.marketSource === "sample" && st.extraVolSurfaces[kind]?.[id] !== undefined) st.setExtraVolSurface(kind, id, undefined, label);
    else st.setVolSurface(kind, id, undefined, label);
  };
  return (
    <button
      className="btn ghost xs"
      onClick={remove}
      data-testid={testId}
      title={isNew ? "Angelegte Fläche entfernen (rückgängig über Ctrl+Z)" : "Fläche auf den Sample-Markt zurücksetzen (rückgängig über Ctrl+Z)"}
    >
      {isNew ? "Entfernen" : "Zurücksetzen"}
    </button>
  );
}

/** Expiry in years → "1M" / "3M" / "2Y" (also weeks for FX). */
export function expiryLabel(e: number): string {
  if (e < 1 / 4) return `${Math.round(e * 52)}W`;
  if (e < 1) return `${Math.round(e * 12)}M`;
  return `${e}Y`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Hint line under every vol grid: one tab stop, arrow keys between cells, Enter / F2 edit, Enter commits and returns (R7-01 / R8-03). */
function GridKeysHint() {
  return (
    <div className="muted xs" style={{ marginTop: 4 }}>
      <kbd>←</kbd>/<kbd>→</kbd>/<kbd>↑</kbd>/<kbd>↓</kbd> Zelle · <kbd>↵</kbd> oder <kbd>F2</kbd> Wert bearbeiten · <kbd>↵</kbd> übernimmt und kehrt zur Zelle
      zurück · <kbd>Esc</kbd> verwirft und kehrt zur Zelle zurück · <kbd>Tab</kbd> verlässt das Gitter.
    </div>
  );
}

/** Editable swaption ATM cube (Normal vol in bp) – cell edits are undoable and mark the market as modified (R3-4); one tab stop (R7-01). */
function SwaptionVolCard({ id, surface }: { id: string; surface: SwaptionVolSurface }) {
  const sample = sampleVolSurfaces().swaptionVols[id];
  const edited = !same(surface, sample);
  const volMin = Math.min(...surface.atm.flat());
  const volMax = Math.max(...surface.atm.flat());
  const grid = useGridNav({ rows: surface.expiries.length, cols: surface.tenors.length });
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
                {sample ? "geändert" : "angelegt"}
              </span>
              <VolCardReset kind="swaptionVols" id={id} isNew={!sample} testId="swaption-vol-reset" />
            </>
          )}
        </span>
      </h3>
      <div
        className="heat editable"
        style={{ gridTemplateColumns: `70px repeat(${surface.tenors.length}, 1fr)` }}
        {...grid.gridProps}
        aria-label={`Swaption-ATM-Vols ${id}`}
        aria-rowcount={surface.expiries.length + 1}
        aria-colcount={surface.tenors.length + 1}
        data-testid="swaption-vol-grid"
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
                <div
                  key={j}
                  className={`cell ${cellEdited ? "edited" : ""}`}
                  {...grid.cellProps(i, j)}
                  aria-label={`${expiryLabel(e)} × ${surface.tenors[j]}Y`}
                  style={{ background: heatBg("--accent", a) }}
                >
                  <NumInput
                    inline
                    value={v}
                    scale={1e4}
                    step={1}
                    digits={1}
                    min={0.0001}
                    tabIndex={-1}
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
      <GridKeysHint />
    </div>
  );
}

/** Editable FX smile (ATM / RR / BF per expiry, in %). */
function FxVolCard({ id, surface, keys, onSelect }: { id: string; surface: FxVolSurface; keys: string[]; onSelect: (k: string) => void }) {
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
  // The active cell is clamped to the current surface: EUR/USD 8×5 → EUR/GBP 6×3 keeps exactly one tab stop (R8-02).
  const grid = useGridNav({ rows: surface.expiries.length, cols: ROWS.filter((r) => surface[r.k]).length });
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
                {sample ? "geändert" : "angelegt"}
              </span>
              <VolCardReset kind="fxVols" id={id} isNew={!sample} testId="fx-vol-reset" />
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
        <table className="grid-table compact" {...grid.gridProps} aria-label={`FX-Vol-Fläche ${id.slice(0, 3)}/${id.slice(3)}`} data-testid="fx-vol-grid">
          <thead>
            <tr role="row">
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
              <tr key={e} role="row" style={{ cursor: "default" }}>
                <td className="mono">{expiryLabel(e)}</td>
                {ROWS.filter((r) => surface[r.k]).map((r, c) => {
                  const v = surface[r.k]![i]!;
                  const cellEdited = sample ? sample[r.k]?.[i] !== v : true;
                  return (
                    <td
                      key={r.k}
                      className={`num vol-cell ${cellEdited ? "edited" : ""}`}
                      {...grid.cellProps(i, c)}
                      aria-label={`${expiryLabel(e)} ${r.label}`}
                    >
                      <span style={{ display: "inline-block", width: 84 }}>
                        <NumInput
                          inline
                          value={v}
                          scale={100}
                          step={0.1}
                          digits={2}
                          unit="%"
                          tabIndex={-1}
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
      <GridKeysHint />
    </div>
  );
}

/** Editable caplet surface (Normal vol in bp, expiry × strike). */
function CapletVolCard({ id, surface }: { id: string; surface: CapletVolSurface }) {
  const sample = sampleVolSurfaces().capletVols[id];
  const edited = !same(surface, sample);
  const grid = useGridNav({ rows: surface.expiries.length, cols: surface.strikes.length });
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
                {sample ? "geändert" : "angelegt"}
              </span>
              <VolCardReset kind="capletVols" id={id} isNew={!sample} testId="caplet-vol-reset" />
            </>
          )}
        </span>
      </h3>
      <div className="table-scroll" style={{ maxHeight: 320 }}>
        {/* Fixed layout: every strike column gets the same width and the input is bound to its cell (R4-01). */}
        <table
          className="grid-table compact vol-grid"
          data-testid="caplet-vol-table"
          style={{ minWidth: 70 + surface.strikes.length * 62 }}
          {...grid.gridProps}
          aria-label={`Caplet-Vols ${surface.index}`}
        >
          <colgroup>
            <col style={{ width: 70 }} />
            {surface.strikes.map((k) => (
              <col key={k} />
            ))}
          </colgroup>
          <thead>
            <tr role="row">
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
              <tr key={e} role="row" style={{ cursor: "default" }}>
                <td className="mono">{expiryLabel(e)}</td>
                {surface.vols[i]!.map((v, j) => {
                  const cellEdited = sample ? sample.vols[i]?.[j] !== v : true;
                  return (
                    <td
                      key={j}
                      className={`num vol-cell ${cellEdited ? "edited" : ""}`}
                      {...grid.cellProps(i, j)}
                      aria-label={`${expiryLabel(e)} Strike ${fmtNum(surface.strikes[j]! * 100, 2)} %`}
                    >
                      <NumInput
                        inline
                        width="100%"
                        value={v}
                        scale={1e4}
                        step={1}
                        digits={0}
                        min={0.0001}
                        tabIndex={-1}
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
      <GridKeysHint />
    </div>
  );
}

type SurfaceKind = "swaption" | "caplet" | "fx";

/** Flat grid `rows × cols` of `v`. */
const flatGrid = (rows: number, cols: number, v: number): number[][] => Array.from({ length: rows }, () => Array.from({ length: cols }, () => v));

/**
 * Build a new vol surface for a currency / pair the market has none for (R7-2 /
 * Markt R7-2): axes from a template surface of the market, values either flat
 * (ATM vol, smile 0) or copied from the template. Pure – used by the form and
 * by tests.
 */
export function buildVolSurface(
  kind: SurfaceKind,
  target: { currency?: string; index?: string; pair?: string },
  template: SwaptionVolSurface | CapletVolSurface | FxVolSurface,
  flatVol: number,
  copyValues: boolean,
): { kind: VolKind; id: string; surface: SwaptionVolSurface | CapletVolSurface | FxVolSurface } {
  if (kind === "swaption") {
    const tpl = template as SwaptionVolSurface;
    const ccy = target.currency!;
    return {
      kind: "swaptionVols",
      id: ccy,
      surface: {
        id: `${ccy}-SWAPTION-${tpl.volType.toUpperCase()}`,
        currency: ccy,
        volType: tpl.volType,
        ...(tpl.shift !== undefined ? { shift: tpl.shift } : {}),
        expiries: [...tpl.expiries],
        tenors: [...tpl.tenors],
        atm: copyValues ? tpl.atm.map((r) => [...r]) : flatGrid(tpl.expiries.length, tpl.tenors.length, flatVol),
      },
    };
  }
  if (kind === "caplet") {
    const tpl = template as CapletVolSurface;
    const ccy = target.currency!;
    const index = target.index!;
    const id = `${ccy}-${index}`;
    return {
      kind: "capletVols",
      id,
      surface: {
        id,
        currency: ccy,
        index,
        volType: tpl.volType,
        ...(tpl.shift !== undefined ? { shift: tpl.shift } : {}),
        expiries: [...tpl.expiries],
        strikes: [...tpl.strikes],
        vols: copyValues ? tpl.vols.map((r) => [...r]) : flatGrid(tpl.expiries.length, tpl.strikes.length, flatVol),
      },
    };
  }
  const tpl = template as FxVolSurface;
  const pair = target.pair!;
  const n = tpl.expiries.length;
  const zeros = () => Array.from({ length: n }, () => 0);
  return {
    kind: "fxVols",
    id: pair,
    surface: {
      id: pair,
      pair,
      expiries: [...tpl.expiries],
      atm: copyValues ? [...tpl.atm] : Array.from({ length: n }, () => flatVol),
      rr25: copyValues ? [...tpl.rr25] : zeros(),
      bf25: copyValues ? [...tpl.bf25] : zeros(),
      ...(tpl.rr10 && tpl.bf10 ? { rr10: copyValues ? [...tpl.rr10] : zeros(), bf10: copyValues ? [...tpl.bf10] : zeros() } : {}),
      ...(tpl.atmConvention ? { atmConvention: tpl.atmConvention } : {}),
      ...(tpl.deltaConvention ? { deltaConvention: tpl.deltaConvention } : {}),
      ...(tpl.smileInterpolation ? { smileInterpolation: tpl.smileInterpolation } : {}),
      ...(tpl.strangleType ? { strangleType: tpl.strangleType } : {}),
    },
  };
}

/**
 * "+ Fläche" (R7-2 / Markt R7-2): a vol surface for a currency with a curve but
 * no swaption cube / caplet surface, or for a spot pair without an FX smile.
 * Axes come from an existing surface, values flat or copied; the result goes
 * through `validateVolSurfaces` / `volSurfaceWarnings` like every vol edit and
 * is an undoable, persisted override – so a NOK cap or an EUR/NOK option no
 * longer falls back to the core's Level-3 vol.
 */
function AddVolSurfaceForm({ onDone }: { onDone: (kind?: VolKind, id?: string) => void }) {
  const m = useStore((s) => s.baseMarket);
  const swaptionKeys = Object.keys(m.swaptionVols ?? {});
  const capletKeys = Object.keys(m.capletVols ?? {});
  const fxKeys = Object.keys(m.fxVols ?? {});
  const hasFx = (pair: string) => fxKeys.includes(pair) || fxKeys.includes(`${pair.slice(3)}${pair.slice(0, 3)}`);
  const curveCcys = Object.keys(m.discountCurveId);
  const swaptionCcys = curveCcys.filter((c) => !swaptionKeys.includes(c));
  // Caplet: currencies with an index (with curve) that has no surface yet – those without any caplet surface first (the new-currency case).
  const capletCcys = curveCcys
    .filter((c) => knownIndices(c).some((i) => i.curveId in m.curves && !capletKeys.includes(`${c}-${i.name}`)))
    .sort((a, b) => Number(capletKeys.some((k) => k.startsWith(`${a}-`))) - Number(capletKeys.some((k) => k.startsWith(`${b}-`))));
  const fxPairs = Object.keys(m.fxSpots).filter((p) => /^[A-Z]{6}$/.test(p) && !hasFx(p));
  const [kind, setKind] = useState<SurfaceKind>(swaptionCcys.length ? "swaption" : fxPairs.length ? "fx" : "caplet");
  const [ccyState, setCcy] = useState("");
  const [indexState, setIndex] = useState("");
  const [pairState, setPair] = useState("");
  const [templateState, setTemplate] = useState("");
  const [copyValues, setCopyValues] = useState(false);
  const [flatBp, setFlatBp] = useState(0.006); // 60 bp normal vol (the core's fallback for caps / 70 bp for swaptions)
  const [flatPct, setFlatPct] = useState(0.08); // 8 % (the core's FX fallback)
  const ccys = kind === "swaption" ? swaptionCcys : capletCcys;
  const ccy = ccys.includes(ccyState) ? ccyState : (ccys[0] ?? "");
  const indices = kind === "caplet" && ccy ? knownIndices(ccy).filter((i) => i.curveId in m.curves && !capletKeys.includes(`${ccy}-${i.name}`)) : [];
  const index = indices.some((i) => i.name === indexState)
    ? indexState
    : (indices.find((i) => i.name === defaultIndexFor(ccy, Object.keys(m.curves)))?.name ?? indices[0]?.name ?? "");
  const pair = fxPairs.includes(pairState) ? pairState : (fxPairs[0] ?? "");
  const templateKeys = kind === "swaption" ? swaptionKeys : kind === "caplet" ? capletKeys : fxKeys;
  const templateKey = templateKeys.includes(templateState) ? templateState : (templateKeys.find((k) => k.startsWith("EUR")) ?? templateKeys[0] ?? "");
  const template = kind === "swaption" ? m.swaptionVols?.[templateKey] : kind === "caplet" ? m.capletVols?.[templateKey] : m.fxVols?.[templateKey];
  const targetOk = kind === "swaption" ? !!ccy : kind === "caplet" ? !!ccy && !!index : !!pair;
  const built = useMemo(() => {
    if (!template || !targetOk) return undefined;
    try {
      return buildVolSurface(kind, { currency: ccy, index, pair }, template, kind === "fx" ? flatPct : flatBp, copyValues);
    } catch {
      return undefined;
    }
  }, [kind, ccy, index, pair, template, flatBp, flatPct, copyValues, targetOk]);
  const problem = !template
    ? "Keine Vorlagenfläche im Markt – zuerst einen Snapshot mit Vol-Flächen importieren"
    : !targetOk
      ? kind === "fx"
        ? "Alle Spot-Paare haben eine FX-Vol-Fläche – ein neues Paar zuerst unter FX-Spots mit „+ Paar“ anlegen"
        : "Alle Währungen mit Kurve haben bereits eine Fläche – eine weitere Währung zuerst mit „+ Kurve“ anlegen"
      : built
        ? (() => {
            const problems = validateVolSurfaces({ [built.kind]: { [built.id]: built.surface } });
            return problems.length ? translateCoreMessage(problems[0]) : undefined;
          })()
        : "Fläche konnte nicht gebaut werden";
  const hints = useMemo(
    () => (built && !problem ? volSurfaceWarnings({ [built.kind]: { [built.id]: built.surface } }).map(translateCoreMessage) : []),
    [built, problem],
  );
  const submit = () => {
    if (!built || problem) return;
    const what =
      built.kind === "swaptionVols"
        ? `Swaption-Cube ${built.id}`
        : built.kind === "capletVols"
          ? `Caplet-Fläche ${built.id}`
          : `FX-Vol-Fläche ${pairLabel(built.id)}`;
    // Sample mode: a structural extra that survives snapshot import → "Zum Sample-Markt" → reload (R8-F2); import mode: an override.
    if (!applyVolSurface(built.kind, built.id, built.surface, `${what} angelegt`, { structural: useStore.getState().marketSource === "sample" })) return;
    useStore
      .getState()
      .showToast(`${what} angelegt (${copyValues ? `Werte aus ${templateKey}` : `flach ${kind === "fx" ? fmtPct(flatPct, 1) : fmtBp(flatBp, 0)}`})`, {
        action: { label: "Rückgängig", run: () => useStore.getState().undo() },
      });
    onDone(built.kind, built.id);
  };
  return (
    <div className="card" data-testid="add-vol-form">
      <h3>
        + Vol-Fläche anlegen
        <span className="right muted xs">Achsen aus einer vorhandenen Fläche · Werte flach oder kopiert · danach in der Karte editierbar</span>
      </h3>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-start" }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Art</span>
          <select
            className="inline"
            value={kind}
            aria-label="Art der neuen Vol-Fläche"
            data-testid="add-vol-kind"
            onChange={(e) => setKind(e.target.value as SurfaceKind)}
          >
            <option value="swaption">Swaption-Cube (Währung)</option>
            <option value="caplet">Caplet-Fläche (Index)</option>
            <option value="fx">FX-Fläche (Paar)</option>
          </select>
        </label>
        {kind !== "fx" && (
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">Währung</span>
            <select className="inline" value={ccy} aria-label="Währung der neuen Vol-Fläche" data-testid="add-vol-ccy" onChange={(e) => setCcy(e.target.value)}>
              {ccys.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {ccys.length === 0 && <option value="">– alle Währungen mit Kurve haben eine Fläche –</option>}
            </select>
          </label>
        )}
        {kind === "caplet" && (
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">Index</span>
            <select
              className="inline"
              value={index}
              aria-label="Index der neuen Caplet-Fläche"
              data-testid="add-vol-index"
              onChange={(e) => setIndex(e.target.value)}
            >
              {indices.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name}
                </option>
              ))}
              {indices.length === 0 && <option value="">–</option>}
            </select>
          </label>
        )}
        {kind === "fx" && (
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">Paar</span>
            <select
              className="inline"
              value={pair}
              aria-label="Währungspaar der neuen FX-Vol-Fläche"
              data-testid="add-vol-pair"
              onChange={(e) => setPair(e.target.value)}
            >
              {fxPairs.map((p) => (
                <option key={p} value={p}>
                  {pairLabel(p)}
                </option>
              ))}
              {fxPairs.length === 0 && <option value="">– alle Spot-Paare haben eine Fläche –</option>}
            </select>
          </label>
        )}
        <label className="row" style={{ gap: 6 }}>
          <span className="muted small">Vorlage (Achsen)</span>
          <select
            className="inline"
            value={templateKey}
            aria-label="Vorlagenfläche"
            data-testid="add-vol-template"
            onChange={(e) => setTemplate(e.target.value)}
          >
            {templateKeys.map((k) => (
              <option key={k} value={k}>
                {kind === "fx" ? pairLabel(k) : k}
              </option>
            ))}
          </select>
        </label>
        <label className="check" style={{ gap: 6 }}>
          <input type="checkbox" checked={copyValues} data-testid="add-vol-copy" onChange={(e) => setCopyValues(e.target.checked)} /> Werte der Vorlage
          übernehmen
        </label>
        {!copyValues && (
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">{kind === "fx" ? "ATM-Vol (RR/BF = 0)" : "flache Vol"}</span>
            <span style={{ display: "inline-block", width: 110 }}>
              {kind === "fx" ? (
                <NumInput
                  inline
                  value={flatPct}
                  scale={100}
                  step={0.5}
                  digits={2}
                  min={0.0001}
                  unit="%"
                  ariaLabel="ATM-Vol der neuen FX-Fläche"
                  testId="add-vol-flat"
                  onChange={setFlatPct}
                />
              ) : (
                <NumInput
                  inline
                  value={flatBp}
                  scale={1e4}
                  step={5}
                  digits={0}
                  min={0.0001}
                  unit="bp"
                  ariaLabel="Flache Vol der neuen Fläche"
                  testId="add-vol-flat"
                  onChange={setFlatBp}
                />
              )}
            </span>
          </label>
        )}
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={submit} disabled={!!problem} data-testid="add-vol-submit">
          Fläche anlegen
        </button>
        <button className="btn ghost" onClick={() => onDone()} data-testid="add-vol-cancel">
          Abbrechen
        </button>
        {built && !problem && (
          <span className="muted xs" data-testid="add-vol-preview">
            {built.kind === "swaptionVols"
              ? `${built.id}: ${(built.surface as SwaptionVolSurface).expiries.length} × ${(built.surface as SwaptionVolSurface).tenors.length} (Expiry × Tenor)`
              : built.kind === "capletVols"
                ? `${built.id}: ${(built.surface as CapletVolSurface).expiries.length} × ${(built.surface as CapletVolSurface).strikes.length} (Expiry × Strike)`
                : `${pairLabel(built.id)}: ${(built.surface as FxVolSurface).expiries.length} Verfälle · ATM / 25Δ RR / 25Δ BF${(built.surface as FxVolSurface).rr10 ? " / 10Δ" : ""}`}
          </span>
        )}
        {problem && (
          <span className="field-msg error" role="alert" data-testid="add-vol-problem">
            {problem}
          </span>
        )}
        {hints.map((h) => (
          <span key={h} className="field-msg warn" data-testid="add-vol-hint">
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * "+ Paar" in the FX-spot table (R7-F1): add a spot for a pair the market does
 * not quote – e.g. EUR/DKK after a DKK curve arrived without one. Sample mode
 * stores it in the quote set, import mode as an override (`setFxSpot`).
 */
function AddFxSpotForm({ onDone }: { onDone: (pair?: string) => void }) {
  const m = useStore((s) => s.baseMarket);
  const has = (p: string) => m.fxSpots[p] !== undefined || m.fxSpots[`${p.slice(3)}${p.slice(0, 3)}`] !== undefined;
  // Currencies with a discount curve but no EUR spot come first – that is the gap "+ Kurve" without a spot leaves.
  const suggestions = Object.keys(m.discountCurveId)
    .filter((c) => c !== "EUR" && !has(`EUR${c}`))
    .map((c) => `EUR${c}`);
  const [pairText, setPairText] = useState(suggestions[0] ?? "");
  const [rate, setRate] = useState(1);
  const pair = pairText.toUpperCase().replace(/[^A-Z]/g, "");
  const problem = !/^[A-Z]{6}$/.test(pair)
    ? "Paar als sechs Buchstaben angeben (z. B. EURDKK)"
    : pair.slice(0, 3) === pair.slice(3)
      ? "Basis- und Quotierungswährung müssen verschieden sein"
      : has(pair)
        ? `${pairLabel(pair)} ist bereits im Markt (Zeile in der Tabelle bearbeiten)`
        : !(rate > 0)
          ? "Kurs muss positiv sein"
          : undefined;
  const submit = () => {
    if (problem) return;
    const st = useStore.getState();
    const label = `Spot ${pairLabel(pair)} ${fmtNum(rate, 4)} angelegt`;
    // Sample mode: a structural extra like an added curve (R8-F2) – survives import → leave → reload; import mode: an override (R6-F1).
    const ok = st.marketSource === "sample" ? st.addExtraSpot(pair, rate, label) : st.setFxSpot(pair, rate, label);
    if (!ok) {
      st.showToast("Spot nicht übernommen (Bewertung fehlgeschlagen)");
      return;
    }
    st.showToast(label, { action: { label: "Rückgängig", run: () => useStore.getState().undo() } });
    onDone(pair);
  };
  return (
    <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }} data-testid="add-spot-form">
      <input
        className="mono"
        style={{ width: 90 }}
        value={pairText}
        placeholder="EURDKK"
        maxLength={7}
        aria-label="Neues Währungspaar"
        data-testid="add-spot-pair"
        list="add-spot-suggestions"
        onChange={(e) => setPairText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <datalist id="add-spot-suggestions">
        {suggestions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {/* ↵ in the rate field submits like ↵ in the pair field (R8-04); the NumInput commits first, the bubbling key submits. */}
      <span
        style={{ display: "inline-block", width: 110 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      >
        <NumInput
          inline
          value={rate}
          step={0.01}
          digits={4}
          min={0.000001}
          ariaLabel={`Spot ${pairLabel(pair || "……")}`}
          testId="add-spot-rate"
          onChange={setRate}
        />
      </span>
      <button className="btn primary xs" onClick={submit} disabled={!!problem} data-testid="add-spot-submit">
        Spot anlegen
      </button>
      <button className="btn ghost xs" onClick={() => onDone()} data-testid="add-spot-cancel">
        Abbrechen
      </button>
      {problem ? (
        <span className="field-msg error" role="alert" data-testid="add-spot-problem">
          {problem}
        </span>
      ) : (
        <span className="muted xs">
          Kurs = 1 {pair.slice(0, 3)} in {pair.slice(3)}; die Gegenquotierung wird automatisch bedient.
        </span>
      )}
    </div>
  );
}

/** Indices offered in the fixings editor: every registered index whose curve is in the market (R7-02 – no hard-coded G5 list). */
function fixingIndices(curveIds: readonly string[]): string[] {
  return knownIndices()
    .filter((i) => curveIds.includes(i.curveId))
    .map((i) => i.name);
}

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
  const rowNav = useRowNav();
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
            <tbody {...rowNav.tbodyProps}>
              {fxFixings.map((f, i) => (
                <tr key={i} style={{ cursor: "default" }} {...rowNav.rowProps(i, fxFixings.length)}>
                  <td>
                    <select
                      className="inline"
                      value={f.pair}
                      tabIndex={-1}
                      aria-label={`Paar FX-Fixing ${i + 1}`}
                      onChange={(e) => setRow(i, { pair: e.target.value })}
                    >
                      {[...new Set([...pairs, f.pair])].map((p) => (
                        <option key={p} value={p}>
                          {pairLabel(p)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <DateInput inline value={f.date} tabIndex={-1} ariaLabel={`Datum FX-Fixing ${i + 1}`} onChange={(v) => setRow(i, { date: v })} />
                  </td>
                  <td className="num">
                    <span style={{ display: "inline-block", width: 110 }}>
                      <NumInput
                        inline
                        value={f.rate}
                        step={0.0005}
                        digits={4}
                        min={0.000001}
                        tabIndex={-1}
                        ariaLabel={`Kurs FX-Fixing ${i + 1}`}
                        testId={i === 0 ? "fx-fixing-rate" : undefined}
                        onChange={(v) => setRow(i, { rate: v })}
                      />
                    </span>
                  </td>
                  <td className="num">
                    <button
                      className="btn ghost danger"
                      tabIndex={-1}
                      title="FX-Fixing entfernen"
                      aria-label={`FX-Fixing ${i + 1} entfernen`}
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
      <div className="muted xs" style={{ marginTop: 6 }}>
        Kurs als Preis der Basiswährung ({pairLabel(addPair)} = 1 {addPair.slice(0, 3)} in {addPair.slice(3)}); die Gegenquotierung wird automatisch bedient.
        Teil des Snapshots (Export/Import), rückgängig mit <kbd>Ctrl</kbd>+<kbd>Z</kbd>.
        {fxFixings.length > 0 && (
          <>
            {" "}
            <RowKeysHint />
          </>
        )}
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
  const rowNav = useRowNav();
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
                <tbody {...rowNav.tbodyProps}>
                  {quotes.map((q, i) => {
                    const idx = sorted.findIndex((x) => x === q);
                    const years = tenorYears(q.tenor);
                    return (
                      <tr key={i} style={{ cursor: "default" }} {...rowNav.rowProps(i, quotes.length)}>
                        <td>
                          <select
                            className="inline"
                            value={q.tenor}
                            tabIndex={-1}
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
                              tabIndex={-1}
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
                            tabIndex={-1}
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
  // Roving tabindex (R7-01): 60 rows × 4 controls used to be 240 tab stops – now the table is one stop.
  const rowNav = useRowNav();
  const indexChoices = useMemo(() => fixingIndices(Object.keys(m.curves)), [m.curves]);
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
              <tbody {...rowNav.tbodyProps}>
                {visible.slice(0, limit).map(({ f, i }, k, arr) => (
                  // stable key = position in the fixings list: changing the index / date of a row must not remount it (R8-01)
                  <tr key={i} style={{ cursor: "default" }} data-testid={k === 0 ? "fixings-row-first" : undefined} {...rowNav.rowProps(k, arr.length)}>
                    <td>
                      <select
                        className="inline"
                        value={f.index}
                        tabIndex={-1}
                        aria-label={`Index Fixing ${i + 1}`}
                        onChange={(e) => setRow(i, { index: e.target.value })}
                      >
                        {[...new Set([...indexChoices, f.index])].map((ix) => (
                          <option key={ix} value={ix}>
                            {ix}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <DateInput inline value={f.date} tabIndex={-1} ariaLabel={`Datum Fixing ${i + 1}`} onChange={(v) => setRow(i, { date: v })} />
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
                          tabIndex={-1}
                          ariaLabel={`Wert Fixing ${i + 1}`}
                          testId={k === 0 ? "fixing-value-first" : undefined}
                          onChange={(v) => setRow(i, { value: v })}
                        />
                      </span>
                    </td>
                    <td className="num">
                      <button
                        className="btn ghost danger"
                        tabIndex={-1}
                        title="Fixing entfernen"
                        aria-label={`Fixing ${i + 1} entfernen`}
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
          {visible.length > limit && (
            <button className="btn ghost xs" style={{ marginTop: 6 }} onClick={() => setLimit((n) => n + FIXINGS_PAGE)} data-testid="fixings-more">
              weitere {Math.min(FIXINGS_PAGE, visible.length - limit)} anzeigen ({visible.length - limit} ausgeblendet)
            </button>
          )}
          <div className="muted xs" style={{ marginTop: 6 }} data-testid="fixings-keys-hint">
            Ein Tabstopp: <RowKeysHint pageSize={10} />
          </div>
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
      extraCurves: st.extraCurves,
      extraSpots: st.extraSpots,
      extraVolSurfaces: st.extraVolSurfaces,
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
  // "+ Paar" (R7-F1) and "+ Fläche" (R7-2) forms
  const [addingSpot, setAddingSpot] = useState(false);
  const [addingVol, setAddingVol] = useState(false);
  const volCount = swptKeys.length + capKeys.length + fxKeys.length;

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
                // The register envelope travels with the file (Markt R8-1): runtime-registered indices, conventions, calendars.
                const envelope = exportEnvelope();
                downloadText(
                  `deriva-market-${toISO(m.valuationDate)}.json`,
                  JSON.stringify({ ...serializeMarket(m), ...envelope }, null, 2),
                  "application/json",
                );
                const n = (envelope.indices?.length ?? 0) + (envelope.conventions?.length ?? 0) + (envelope.calendars?.length ?? 0);
                act().showToast(`Markt-Snapshot exportiert · ID ${snapshotId}${n ? ` · Register-Envelope (${n} Einträge)` : ""}`);
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
                    // The toast names what was discarded and what stays remembered (R8-F2) and what the envelope registered (Markt R8-1).
                    act().showToast(
                      `Snapshot „${r.label}“ importiert · ID ${r.id}${r.dateChanged ? ` · Bewertungstag auf ${fmtDate(r.valuationDate)} gesetzt` : ""}${
                        r.registered ? ` · registriert: ${r.registered}` : ""
                      }${r.discarded.length ? ` · verworfen: ${r.discarded.join(", ")} (Rückgängig stellt sie wieder her)` : ""}${
                        r.kept.length ? ` · gemerkt, nach „Zum Sample-Markt“ wieder aktiv: ${r.kept.join(", ")}` : ""
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
        <div className="card" data-testid="fx-spots-card">
          <h3>
            FX-Spots (editierbar)
            <span className="right row">
              <button
                className="btn xs"
                onClick={() => setAddingSpot((v) => !v)}
                aria-pressed={addingSpot}
                data-testid="add-spot"
                title="Spot für ein weiteres Währungspaar anlegen (z. B. EUR/DKK nach „+ Kurve“ ohne Spot) – im Sample-Markt struktureller Zusatz wie eine Kurve (überlebt Snapshot-Import und Reload), im Import-Modus Override am Snapshot; rückgängig mit Ctrl+Z"
              >
                + Paar
              </button>
            </span>
          </h3>
          {addingSpot && (
            <AddFxSpotForm
              onDone={() => {
                setAddingSpot(false);
                // R7-03-style focus return: the keyboard user lands on the button again
                void focusWhenPresent('[data-testid="add-spot"]');
              }}
            />
          )}
          <div className="table-scroll">
            <table className="grid-table" aria-label="FX-Spots" data-testid="fx-spots-table">
              <tbody>
                {Object.entries(m.fxSpots).map(([pair, v]) => {
                  // A "+ Paar" spot of the sample market (R8-F2): removable, its original is the structural value.
                  const extra = !imported && s.quotes.fxSpots[pair] === undefined && s.extraSpots[pair] !== undefined;
                  const orig = imported
                    ? (s.importedBase?.fxSpots[pair] ?? v)
                    : ((Object.entries(s.quotes.fxSpots).find(([p]) => p === pair)?.[1] ?? (extra ? s.extraSpots[pair] : undefined) ?? v) as number);
                  return (
                    <tr key={pair} style={{ cursor: "default" }} data-testid={`fx-spot-row-${pair}`}>
                      <td className="mono">
                        {pair.slice(0, 3)}/{pair.slice(3)}
                        {extra && (
                          <span
                            className="badge info xs"
                            style={{ marginLeft: 6 }}
                            title="Mit „+ Paar“ angelegt – bleibt über Snapshot-Import und Reload erhalten"
                          >
                            angelegt
                          </span>
                        )}
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
                        {extra && (
                          <button
                            className="btn ghost danger xs"
                            style={{ marginLeft: 4 }}
                            aria-label={`Spot ${pair.slice(0, 3)}/${pair.slice(3)} entfernen`}
                            title="Angelegten Spot entfernen (rückgängig mit Ctrl+Z)"
                            data-testid={`fx-spot-remove-${pair}`}
                            onClick={() => {
                              if (act().removeExtraSpot(pair))
                                act().showToast(`Spot ${pair.slice(0, 3)}/${pair.slice(3)} entfernt`, {
                                  action: { label: "Rückgängig", run: () => useStore.getState().undo() },
                                });
                            }}
                          >
                            ✕
                          </button>
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

      <div className="row wrap" style={{ gap: 8 }} data-testid="vol-toolbar">
        <span className="muted xs">
          Vol-Flächen ({volCount}): {swptKeys.length} Swaption-Cubes · {capKeys.length} Caplet-Flächen · {fxKeys.length} FX-Paare
        </span>
        <button
          className="btn xs"
          onClick={() => setAddingVol((v) => !v)}
          aria-pressed={addingVol}
          data-testid="add-vol"
          title="Vol-Fläche für eine Währung / ein Paar ohne Fläche anlegen (Swaption-Cube, Caplet-Fläche, FX-Smile) – sonst bewertet der Kern mit der Fallback-Vol (Level 3); im Sample-Markt struktureller Zusatz (überlebt Snapshot-Import und Reload)"
        >
          + Fläche
        </button>
      </div>
      {addingVol && (
        <AddVolSurfaceForm
          onDone={(kind, id) => {
            setAddingVol(false);
            if (kind === "swaptionVols" && id) setSwptSel(id);
            if (kind === "capletVols" && id) setCapSel(id);
            if (kind === "fxVols" && id) setFxSel(id);
            void focusWhenPresent('[data-testid="add-vol"]');
          }}
        />
      )}
      {swpt && swptId && (
        <>
          {swptKeys.length > 1 && (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="muted xs">Swaption-Cube</span>
              <div className="seg wrap" role="group" aria-label="Swaption-Cube Währung">
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
              <div className="seg wrap" role="group" aria-label="Caplet-Fläche">
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
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> rückgängig; „Zurücksetzen“ an der Karte oder „Markt zurücksetzen“ stellt den Sample-Markt wieder her. Mit „+ Fläche“
        angelegte Flächen (neue Währungen / Paare) tragen den Badge „angelegt“, lassen sich an der Karte entfernen und bleiben – wie „+ Kurve“ und „+ Paar“ –
        über einen Snapshot-Import, „Zum Sample-Markt“ und den Reload erhalten.
      </div>
    </div>
  );
}
