import { type Curve } from "../curves/curve.js";
import { type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { shiftFxSurface } from "../models/fx-vol-surface.js";
import { shiftCapletSurface, shiftSwaptionSurface } from "../models/vol-surfaces.js";
import { pricePortfolio } from "../pricing/price.js";
import { rollMarket, shiftFxSpots } from "./sensitivities.js";

export interface CurveShift {
  /** Curve id or "*" for all curves, or a currency code for all curves of that currency. */
  target: string;
  /** Parallel shift in bp. */
  parallelBp?: number;
  /** Per-tenor shifts (years → bp), linearly interpolated across pillars (steepener/flattener/twist). */
  tenorBp?: { years: number; bp: number }[];
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description?: string;
  curveShifts?: CurveShift[];
  /** FX shifts as currency → % appreciation vs everything else. */
  fxShiftsPct?: Record<string, number>;
  /** Absolute vol shifts: IR normal vol in bp, FX in vol points. */
  irVolShiftBp?: number;
  fxVolShiftPts?: number;
  /** Time shift in days (roll forward). */
  daysForward?: number;
}

export function applyScenario(ctx: MarketContext, s: ScenarioDefinition): MarketContext {
  let out: MarketContext = { ...ctx, curves: { ...ctx.curves } };
  for (const cs of s.curveShifts ?? []) {
    for (const [id, c] of Object.entries(ctx.curves)) {
      if (!(cs.target === "*" || cs.target === id || cs.target === c.currency)) continue;
      let shifted: Curve = c;
      if (cs.parallelBp) shifted = shifted.shiftedParallel(cs.parallelBp * 1e-4);
      if (cs.tenorBp && cs.tenorBp.length) {
        const pts = [...cs.tenorBp].sort((a, b) => a.years - b.years);
        const shifts = shifted.nodeDates.map((d) => {
          const y = (d - ctx.valuationDate) / 365.25;
          return interp(pts, y) * 1e-4;
        });
        shifted = shifted.shiftedNodes(shifts);
      }
      out.curves[id] = shifted;
    }
  }
  for (const [ccy, pct] of Object.entries(s.fxShiftsPct ?? {})) {
    out = shiftFxSpots(out, ccy, pct / 100);
  }
  if (s.irVolShiftBp) {
    if (out.swaptionVols)
      out.swaptionVols = Object.fromEntries(
        Object.entries(out.swaptionVols).map(([k, v]) => [k, shiftSwaptionSurface(v, v.volType === "Normal" ? s.irVolShiftBp! * 1e-4 : s.irVolShiftBp! * 1e-2)]),
      );
    if (out.capletVols)
      out.capletVols = Object.fromEntries(
        Object.entries(out.capletVols).map(([k, v]) => [k, shiftCapletSurface(v, v.volType === "Normal" ? s.irVolShiftBp! * 1e-4 : s.irVolShiftBp! * 1e-2)]),
      );
  }
  if (s.fxVolShiftPts && out.fxVols) {
    out.fxVols = Object.fromEntries(Object.entries(out.fxVols).map(([k, v]) => [k, shiftFxSurface(v, s.fxVolShiftPts! / 100)]));
  }
  if (s.daysForward) out = rollMarket(out, s.daysForward);
  return out;
}

function interp(pts: { years: number; bp: number }[], y: number): number {
  if (y <= pts[0]!.years) return pts[0]!.bp;
  if (y >= pts[pts.length - 1]!.years) return pts[pts.length - 1]!.bp;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (y >= a.years && y <= b.years) {
      const t = (y - a.years) / (b.years - a.years);
      return a.bp + t * (b.bp - a.bp);
    }
  }
  return 0;
}

export interface ScenarioResult {
  scenario: ScenarioDefinition;
  total: number;
  pnl: number;
  byTrade: { tradeId: string; pv: number; pnl: number }[];
}

export function runScenarios(
  ctx: MarketContext,
  trades: Trade[],
  scenarios: ScenarioDefinition[],
  reportingCurrency: string,
): { base: number; results: ScenarioResult[] } {
  const base = pricePortfolio(ctx, trades, reportingCurrency);
  const results = scenarios.map((s) => {
    const shifted = applyScenario(ctx, s);
    const p = pricePortfolio(shifted, trades, reportingCurrency);
    return {
      scenario: s,
      total: p.total,
      pnl: p.total - base.total,
      byTrade: p.results.map((r, i) => ({ tradeId: r.tradeId, pv: r.pv, pnl: r.pv - base.results[i]!.pv })),
    };
  });
  return { base: base.total, results };
}

/** Standard scenario set used by the UI (regulatory-style and market-standard shocks). */
export const STANDARD_SCENARIOS: ScenarioDefinition[] = [
  { id: "base", name: "Basis", curveShifts: [] },
  { id: "par+100", name: "Zinsen +100bp", curveShifts: [{ target: "*", parallelBp: 100 }] },
  { id: "par-100", name: "Zinsen -100bp", curveShifts: [{ target: "*", parallelBp: -100 }] },
  { id: "par+200", name: "Zinsen +200bp (BaFin)", curveShifts: [{ target: "*", parallelBp: 200 }] },
  { id: "par-200", name: "Zinsen -200bp (BaFin)", curveShifts: [{ target: "*", parallelBp: -200 }] },
  {
    id: "steep",
    name: "Steepener",
    curveShifts: [{ target: "*", tenorBp: [{ years: 0, bp: -50 }, { years: 2, bp: -25 }, { years: 10, bp: 50 }, { years: 30, bp: 75 }] }],
  },
  {
    id: "flat",
    name: "Flattener",
    curveShifts: [{ target: "*", tenorBp: [{ years: 0, bp: 50 }, { years: 2, bp: 25 }, { years: 10, bp: -50 }, { years: 30, bp: -75 }] }],
  },
  { id: "eur+10", name: "EUR +10%", fxShiftsPct: { EUR: 10 } },
  { id: "eur-10", name: "EUR -10%", fxShiftsPct: { EUR: -10 } },
  { id: "vol+20", name: "IR-Vol +20bp", irVolShiftBp: 20 },
  { id: "fxvol+5", name: "FX-Vol +5 Pkt", fxVolShiftPts: 5 },
  { id: "roll1m", name: "Roll +1M", daysForward: 30 },
];

/** Two-dimensional grid (rates × FX) for the what-if matrix. */
export function scenarioGrid(
  ctx: MarketContext,
  trades: Trade[],
  reportingCurrency: string,
  ratesBp: number[],
  fxPct: number[],
  fxCurrency: string,
): { ratesBp: number[]; fxPct: number[]; pv: number[][]; base: number } {
  const base = pricePortfolio(ctx, trades, reportingCurrency).total;
  const pv = ratesBp.map((r) =>
    fxPct.map((f) => {
      const sc: ScenarioDefinition = {
        id: `grid-${r}-${f}`,
        name: "grid",
        curveShifts: [{ target: "*", parallelBp: r }],
        fxShiftsPct: f !== 0 ? { [fxCurrency]: f } : undefined,
      };
      return pricePortfolio(applyScenario(ctx, sc), trades, reportingCurrency).total;
    }),
  );
  return { ratesBp, fxPct, pv, base };
}
