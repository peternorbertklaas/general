import { type Curve } from "../curves/curve.js";
import { toISO } from "../dates/date.js";
import { type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { shiftFxSurface } from "../models/fx-vol-surface.js";
import { shiftCapletSurface, shiftSwaptionSurface } from "../models/vol-surfaces.js";
import { priceTrade, tradeCurrencies } from "../pricing/price.js";

export interface BucketedDelta {
  curveId: string;
  buckets: { date: string; label: string; delta: number }[];
  total: number;
}

export interface RiskReport {
  tradeId: string;
  currency: string;
  pv: number;
  /** PV change for +1bp parallel shift of all rate curves. */
  dv01: number;
  /** Per-curve parallel DV01 */
  dv01ByCurve: Record<string, number>;
  bucketed: BucketedDelta[];
  /** PV change per +1% spot move, per FX pair (base→reporting). */
  fxDelta: Record<string, number>;
  /** PV change for +1bp normal vol (IR) / +1 vol point (FX). */
  vega: Record<string, number>;
  /** 1-day theta: PV(t+1) - PV(t) holding market data. */
  theta: number;
  /** Second-order: PV(+1bp) + PV(-1bp) - 2PV. */
  gamma: number;
}

const BP = 1e-4;

export function shiftCurvesParallel(ctx: MarketContext, curveIds: string[], shift: number): MarketContext {
  const curves: Record<string, Curve> = { ...ctx.curves };
  for (const id of curveIds) {
    const c = ctx.curves[id];
    if (c) curves[id] = c.shiftedParallel(shift);
  }
  return { ...ctx, curves };
}

/** Curves relevant to a trade: discount + projection curves of its currencies. */
export function relevantCurveIds(ctx: MarketContext, trade: Trade): string[] {
  const ccys = tradeCurrencies(trade);
  return Object.entries(ctx.curves)
    .filter(([, c]) => ccys.includes(c.currency))
    .map(([id]) => id);
}

export function computeRisk(
  ctx: MarketContext,
  trade: Trade,
  reportingCurrency: string,
  opts: { bucketed?: boolean; vega?: boolean; theta?: boolean } = {},
): RiskReport {
  const base = priceTrade(ctx, trade, reportingCurrency);
  const curveIds = relevantCurveIds(ctx, trade);
  const up = priceTrade(shiftCurvesParallel(ctx, curveIds, BP), trade, reportingCurrency).pv;
  const down = priceTrade(shiftCurvesParallel(ctx, curveIds, -BP), trade, reportingCurrency).pv;
  const dv01 = (up - down) / 2;
  const gamma = up + down - 2 * base.pv;

  const dv01ByCurve: Record<string, number> = {};
  for (const id of curveIds) {
    const u = priceTrade(shiftCurvesParallel(ctx, [id], BP), trade, reportingCurrency).pv;
    const d = priceTrade(shiftCurvesParallel(ctx, [id], -BP), trade, reportingCurrency).pv;
    dv01ByCurve[id] = (u - d) / 2;
  }

  const bucketed: BucketedDelta[] = [];
  if (opts.bucketed ?? true) {
    for (const id of curveIds) {
      const c = ctx.curves[id]!;
      const buckets = c.nodeDates.map((d, i) => {
        const u = priceTrade({ ...ctx, curves: { ...ctx.curves, [id]: c.shiftedNode(i, BP) } }, trade, reportingCurrency).pv;
        const dn = priceTrade({ ...ctx, curves: { ...ctx.curves, [id]: c.shiftedNode(i, -BP) } }, trade, reportingCurrency).pv;
        return { date: toISO(d), label: tenorLabel(ctx.valuationDate, d), delta: (u - dn) / 2 };
      });
      bucketed.push({ curveId: id, buckets, total: buckets.reduce((s, b) => s + b.delta, 0) });
    }
  }

  const fxDelta: Record<string, number> = {};
  for (const ccy of tradeCurrencies(trade)) {
    if (ccy === reportingCurrency) continue;
    const shifted = shiftFxSpots(ctx, ccy, 0.01);
    const shiftedDown = shiftFxSpots(ctx, ccy, -0.01);
    fxDelta[`${ccy}${reportingCurrency}`] =
      (priceTrade(shifted, trade, reportingCurrency).pv - priceTrade(shiftedDown, trade, reportingCurrency).pv) / 2;
  }

  const vega: Record<string, number> = {};
  if (opts.vega ?? true) {
    if (trade.type === "Swaption" && ctx.swaptionVols) {
      for (const [k, s] of Object.entries(ctx.swaptionVols)) {
        if (!tradeCurrencies(trade).includes(s.currency)) continue;
        const shift = s.volType === "Normal" ? BP : 0.01;
        const u = priceTrade({ ...ctx, swaptionVols: { ...ctx.swaptionVols, [k]: shiftSwaptionSurface(s, shift) } }, trade, reportingCurrency).pv;
        vega[`swaption:${k}`] = u - base.pv;
      }
    }
    if (trade.type === "CapFloor" && ctx.capletVols) {
      for (const [k, s] of Object.entries(ctx.capletVols)) {
        if (s.currency !== trade.currency) continue;
        const shift = s.volType === "Normal" ? BP : 0.01;
        const u = priceTrade({ ...ctx, capletVols: { ...ctx.capletVols, [k]: shiftCapletSurface(s, shift) } }, trade, reportingCurrency).pv;
        vega[`caplet:${k}`] = u - base.pv;
      }
    }
    if (trade.type === "FxOption" && ctx.fxVols) {
      for (const [k, s] of Object.entries(ctx.fxVols)) {
        if (!trade.pair.toUpperCase().includes(k.slice(0, 3))) continue;
        const u = priceTrade({ ...ctx, fxVols: { ...ctx.fxVols, [k]: shiftFxSurface(s, 0.01) } }, trade, reportingCurrency).pv;
        vega[`fx:${k}`] = u - base.pv;
      }
    }
  }

  let theta = 0;
  if (opts.theta ?? true) {
    try {
      theta = priceTrade(rollMarket(ctx, 1), trade, reportingCurrency).pv - base.pv;
    } catch {
      theta = Number.NaN;
    }
  }

  return { tradeId: trade.id, currency: reportingCurrency, pv: base.pv, dv01, dv01ByCurve, bucketed, fxDelta, vega, theta, gamma };
}

/**
 * Roll the market forward by `days` keeping zero rates per tenor constant
 * (constant-curve roll). Used for theta and time-shift scenarios.
 */
export function rollMarket(ctx: MarketContext, days: number): MarketContext {
  const newDate = ctx.valuationDate + days;
  const curves: Record<string, Curve> = {};
  for (const [id, c] of Object.entries(ctx.curves)) curves[id] = c.rolledTo(newDate);
  return { ...ctx, valuationDate: newDate, curves };
}

/** Shift all spots involving `ccy` so that ccy appreciates by `pct` versus everything else. */
export function shiftFxSpots(ctx: MarketContext, ccy: string, pct: number): MarketContext {
  const spots: Record<string, number> = {};
  for (const [pair, rate] of Object.entries(ctx.fxSpots)) {
    const base = pair.slice(0, 3);
    const quote = pair.slice(3, 6);
    if (base === ccy) spots[pair] = rate * (1 + pct);
    else if (quote === ccy) spots[pair] = rate / (1 + pct);
    else spots[pair] = rate;
  }
  return { ...ctx, fxSpots: spots };
}

export function tenorLabel(valuationDate: number, date: number): string {
  const days = date - valuationDate;
  if (days < 20) return `${days}D`;
  if (days < 360) return `${Math.round(days / 30.4375)}M`;
  const years = days / 365.25;
  return `${Math.round(years * 2) / 2}Y`.replace(".5Y", ".5Y");
}
