import { type Curve } from "../curves/curve.js";
import { type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { shiftFxSurface } from "../models/fx-vol-surface.js";
import { type VolType, shiftCapletSurface, shiftSwaptionSurface } from "../models/vol-surfaces.js";
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

/**
 * Explicit IR vol shift with units per surface type. `normalBp` applies to
 * normal surfaces (bp of normal vol); `lognormalPts` to lognormal / shifted
 * lognormal surfaces (vol points). When only one is given the other is
 * derived via σ_N ≈ σ_LN × (F + shift) at `referenceRate` (default 3%).
 */
export interface IrVolShift {
  normalBp?: number;
  lognormalPts?: number;
  referenceRate?: number;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description?: string;
  /** Applied in order; shifts targeting the same curve accumulate (e.g. "*" +100bp then "EUR-ESTR" +50bp = +150bp). */
  curveShifts?: CurveShift[];
  /** FX shifts as currency → % appreciation vs everything else. */
  fxShiftsPct?: Record<string, number>;
  /**
   * Absolute IR vol shift in bp of normal vol. Lognormal surfaces are shifted
   * by the equivalent vol points (bp / reference rate 3%); use `irVolShift`
   * for explicit units.
   */
  irVolShiftBp?: number;
  irVolShift?: IrVolShift;
  /** FX vol shift in vol points. */
  fxVolShiftPts?: number;
  /** Time shift in days (roll forward). */
  daysForward?: number;
}

const DEFAULT_VOL_REFERENCE_RATE = 0.03;

/** Absolute shift (decimal) for a surface of `volType` under the scenario's IR vol definition. */
export function irVolShiftFor(s: ScenarioDefinition, volType: VolType): number {
  const def: IrVolShift = s.irVolShift ?? {};
  const refRate = def.referenceRate ?? DEFAULT_VOL_REFERENCE_RATE;
  const normalBp = def.normalBp ?? s.irVolShiftBp;
  if (volType === "Normal") {
    if (normalBp !== undefined) return normalBp * 1e-4;
    if (def.lognormalPts !== undefined) return def.lognormalPts * 1e-2 * refRate;
    return 0;
  }
  if (def.lognormalPts !== undefined) return def.lognormalPts * 1e-2;
  if (normalBp !== undefined) return (normalBp * 1e-4) / refRate;
  return 0;
}

export function applyScenario(ctx: MarketContext, s: ScenarioDefinition): MarketContext {
  let out: MarketContext = { ...ctx, curves: { ...ctx.curves } };
  for (const cs of s.curveShifts ?? []) {
    // Work on the already-shifted state so several shifts on one curve accumulate.
    for (const [id, c] of Object.entries(out.curves)) {
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
  if (s.irVolShiftBp || s.irVolShift) {
    if (out.swaptionVols)
      out.swaptionVols = Object.fromEntries(Object.entries(out.swaptionVols).map(([k, v]) => [k, shiftSwaptionSurface(v, irVolShiftFor(s, v.volType))]));
    if (out.capletVols)
      out.capletVols = Object.fromEntries(Object.entries(out.capletVols).map(([k, v]) => [k, shiftCapletSurface(v, irVolShiftFor(s, v.volType))]));
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
  { id: "par+200", name: "Zinsen +200bp (BaFin/IRRBB)", curveShifts: [{ target: "*", parallelBp: 200 }] },
  { id: "par-200", name: "Zinsen -200bp (BaFin/IRRBB)", curveShifts: [{ target: "*", parallelBp: -200 }] },
  {
    id: "steep",
    name: "Steepener",
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: -50 },
          { years: 2, bp: -25 },
          { years: 10, bp: 50 },
          { years: 30, bp: 75 },
        ],
      },
    ],
  },
  {
    id: "flat",
    name: "Flattener",
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: 50 },
          { years: 2, bp: 25 },
          { years: 10, bp: -50 },
          { years: 30, bp: -75 },
        ],
      },
    ],
  },
  // EBA/BCBS IRRBB standard shocks (EUR calibration: parallel 200bp, short 250bp, long 100bp)
  {
    id: "irrbb-short-up",
    name: "IRRBB Short-Up",
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: 250 },
          { years: 1, bp: 250 * Math.exp(-1 / 4) },
          { years: 5, bp: 250 * Math.exp(-5 / 4) },
          { years: 10, bp: 250 * Math.exp(-10 / 4) },
          { years: 30, bp: 0 },
        ],
      },
    ],
  },
  {
    id: "irrbb-short-down",
    name: "IRRBB Short-Down",
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: -250 },
          { years: 1, bp: -250 * Math.exp(-1 / 4) },
          { years: 5, bp: -250 * Math.exp(-5 / 4) },
          { years: 10, bp: -250 * Math.exp(-10 / 4) },
          { years: 30, bp: 0 },
        ],
      },
    ],
  },
  {
    id: "irrbb-steepener",
    name: "IRRBB Steepener",
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: -0.65 * 250 },
          { years: 2, bp: -0.65 * 250 * Math.exp(-2 / 4) + 0.9 * 100 * (1 - Math.exp(-2 / 4)) },
          { years: 5, bp: -0.65 * 250 * Math.exp(-5 / 4) + 0.9 * 100 * (1 - Math.exp(-5 / 4)) },
          { years: 10, bp: -0.65 * 250 * Math.exp(-10 / 4) + 0.9 * 100 * (1 - Math.exp(-10 / 4)) },
          { years: 30, bp: 90 },
        ],
      },
    ],
  },
  {
    id: "irrbb-flattener",
    name: "IRRBB Flattener",
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: 0.8 * 250 },
          { years: 2, bp: 0.8 * 250 * Math.exp(-2 / 4) - 0.6 * 100 * (1 - Math.exp(-2 / 4)) },
          { years: 5, bp: 0.8 * 250 * Math.exp(-5 / 4) - 0.6 * 100 * (1 - Math.exp(-5 / 4)) },
          { years: 10, bp: 0.8 * 250 * Math.exp(-10 / 4) - 0.6 * 100 * (1 - Math.exp(-10 / 4)) },
          { years: 30, bp: -60 },
        ],
      },
    ],
  },
  { id: "eur+10", name: "EUR +10%", fxShiftsPct: { EUR: 10 } },
  { id: "eur-10", name: "EUR -10%", fxShiftsPct: { EUR: -10 } },
  { id: "vol+20", name: "IR-Vol +20bp", irVolShiftBp: 20 },
  { id: "fxvol+5", name: "FX-Vol +5 Pkt", fxVolShiftPts: 5 },
  { id: "roll1m", name: "Roll +1M", daysForward: 30 },
];

const HIST_NOTE =
  "Indikative Näherung der historischen Marktbewegung (Tenor-Vektor der Swap-/OIS-Sätze, FX-Spot in %, Vol-Verschiebung), nicht die exakte Tagesdatenhistorie.";

/**
 * Historical stress episodes as static scenario definitions (tenor-vector
 * rate shifts in bp, FX spot moves in %, vol shifts). Each `description`
 * names the episode, window and public sources the approximation is taken
 * from; the numbers are indicative reconstructions, not tick data. Pass them
 * (or a subset) to `runScenarios` like any other scenario set.
 */
export const HISTORICAL_SCENARIOS: ScenarioDefinition[] = [
  {
    id: "hist-lehman-2008",
    name: "Lehman Okt 2008",
    description: `Lehman-Insolvenz 15.09.2008 bis Ende Oktober 2008: EUR-Swapsätze am kurzen Ende −150bp (EZB-Zinssenkungen, Flucht in Qualität), lange Laufzeiten −60bp; EUR −12 % gegen USD, GBP −10 %; Zinsvol +60bp Normal, FX-Vol +12 Punkte. Quellen: EZB/Bundesbank Zeitreihen, BIS Quarterly Review Dez 2008. ${HIST_NOTE}`,
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: -150 },
          { years: 1, bp: -130 },
          { years: 2, bp: -110 },
          { years: 5, bp: -80 },
          { years: 10, bp: -60 },
          { years: 30, bp: -40 },
        ],
      },
    ],
    fxShiftsPct: { EUR: -12, GBP: -10, CHF: 3, JPY: 15 },
    irVolShiftBp: 60,
    fxVolShiftPts: 12,
  },
  {
    id: "hist-eurokrise-2011",
    name: "Euro-Krise Nov 2011",
    description: `Eskalation der Staatsschuldenkrise Oktober–November 2011 (Italien-Rendite > 7 %, EZB-Senkung 03.11.2011): EUR-Swapsätze −70bp (2Y) bis −50bp (10Y), €STR/EONIA-Basis ausgeweitet; EUR −6 % gegen USD, CHF-Mindestkurs 1,20; Zinsvol +25bp, FX-Vol +4 Punkte. Quellen: EZB, Bloomberg-Marktkommentare Nov 2011. ${HIST_NOTE}`,
    curveShifts: [
      {
        target: "*",
        tenorBp: [
          { years: 0, bp: -40 },
          { years: 2, bp: -70 },
          { years: 5, bp: -60 },
          { years: 10, bp: -50 },
          { years: 30, bp: -35 },
        ],
      },
      { target: "EUR-ESTR", parallelBp: -15 },
    ],
    fxShiftsPct: { EUR: -6, USD: 4, CHF: 2 },
    irVolShiftBp: 25,
    fxVolShiftPts: 4,
  },
  {
    id: "hist-covid-2020",
    name: "Covid März 2020",
    description: `Covid-Marktschock 20.02.–23.03.2020: USD-Sätze −140bp (Fed-Notsenkungen auf 0–0,25 %), EUR-Swapsätze −30bp am langen Ende bei Versteilung, USD-Liquiditätsstress (Cross-Currency-Basis −50bp); EUR −5 % gegen USD, JPY +4 %; Zinsvol +35bp, FX-Vol +8 Punkte. Quellen: Fed/EZB, BIS Bulletin No. 2 (April 2020). ${HIST_NOTE}`,
    curveShifts: [
      {
        target: "USD",
        tenorBp: [
          { years: 0, bp: -140 },
          { years: 2, bp: -110 },
          { years: 5, bp: -90 },
          { years: 10, bp: -80 },
          { years: 30, bp: -60 },
        ],
      },
      {
        target: "EUR",
        tenorBp: [
          { years: 0, bp: -10 },
          { years: 2, bp: -15 },
          { years: 5, bp: -25 },
          { years: 10, bp: -30 },
          { years: 30, bp: -30 },
        ],
      },
      {
        target: "GBP",
        tenorBp: [
          { years: 0, bp: -65 },
          { years: 2, bp: -50 },
          { years: 10, bp: -40 },
          { years: 30, bp: -30 },
        ],
      },
    ],
    fxShiftsPct: { EUR: -5, GBP: -8, JPY: 4 },
    irVolShiftBp: 35,
    fxVolShiftPts: 8,
  },
  {
    id: "hist-zinswende-2022",
    name: "Zinswende 2022 (Jun–Okt)",
    description: `Zinswende Juni–Oktober 2022 (EZB-Leitzinserhöhungen Juli/September/Oktober 2022, Inflation > 10 %): EUR-Swapsätze +200bp am kurzen Ende, +120bp (10Y), Verflachung; USD +180bp (2Y); EUR −7 % gegen USD (Parität), GBP −10 % (Gilt-Krise Sept 2022); Zinsvol +50bp. Quellen: EZB, EMMI/€STR-Zeitreihen, BoE. ${HIST_NOTE}`,
    curveShifts: [
      {
        target: "EUR",
        tenorBp: [
          { years: 0, bp: 200 },
          { years: 2, bp: 190 },
          { years: 5, bp: 150 },
          { years: 10, bp: 120 },
          { years: 30, bp: 90 },
        ],
      },
      {
        target: "USD",
        tenorBp: [
          { years: 0, bp: 190 },
          { years: 2, bp: 180 },
          { years: 5, bp: 140 },
          { years: 10, bp: 110 },
          { years: 30, bp: 80 },
        ],
      },
      {
        target: "GBP",
        tenorBp: [
          { years: 0, bp: 230 },
          { years: 2, bp: 250 },
          { years: 5, bp: 220 },
          { years: 10, bp: 200 },
          { years: 30, bp: 180 },
        ],
      },
      {
        target: "CHF",
        tenorBp: [
          { years: 0, bp: 120 },
          { years: 2, bp: 110 },
          { years: 10, bp: 80 },
          { years: 30, bp: 60 },
        ],
      },
    ],
    fxShiftsPct: { EUR: -7, GBP: -10, USD: 5 },
    irVolShiftBp: 50,
    fxVolShiftPts: 3,
  },
  {
    id: "hist-snb-2015",
    name: "SNB Jan 2015 (EUR/CHF)",
    description: `Aufgabe des EUR/CHF-Mindestkurses durch die SNB am 15.01.2015: CHF +15 % gegen EUR (Tagesschluss ca. 1,03 nach 1,20, intraday tiefer), SNB-Leitzins −0,75 %; CHF-Sätze −50bp, FX-Vol EURCHF +15 Punkte. Quellen: SNB-Medienmitteilung 15.01.2015, BIS. ${HIST_NOTE}`,
    curveShifts: [
      {
        target: "CHF",
        tenorBp: [
          { years: 0, bp: -50 },
          { years: 2, bp: -45 },
          { years: 10, bp: -35 },
          { years: 30, bp: -25 },
        ],
      },
    ],
    fxShiftsPct: { CHF: 15 },
    fxVolShiftPts: 15,
  },
  {
    id: "hist-brexit-2016",
    name: "Brexit Jun 2016 (GBP)",
    description: `Brexit-Referendum 23./24.06.2016: GBP −8 % gegen USD (1,50 → 1,37) und −6 % gegen EUR am Folgetag, Gilts −30bp, BoE-Senkung im August 2016; JPY +4 % (sicherer Hafen); FX-Vol GBP-Paare +8 Punkte, Zinsvol +10bp. Quellen: BoE, BIS Quarterly Review Sept 2016. ${HIST_NOTE}`,
    curveShifts: [
      {
        target: "GBP",
        tenorBp: [
          { years: 0, bp: -25 },
          { years: 2, bp: -35 },
          { years: 10, bp: -30 },
          { years: 30, bp: -20 },
        ],
      },
      {
        target: "EUR",
        tenorBp: [
          { years: 0, bp: -5 },
          { years: 10, bp: -15 },
          { years: 30, bp: -10 },
        ],
      },
      {
        target: "USD",
        tenorBp: [
          { years: 0, bp: -10 },
          { years: 10, bp: -20 },
          { years: 30, bp: -15 },
        ],
      },
    ],
    fxShiftsPct: { GBP: -8, JPY: 4 },
    irVolShiftBp: 10,
    fxVolShiftPts: 8,
  },
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
