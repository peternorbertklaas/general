import { getIndex } from "../curves/index-definitions.js";
import { toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule } from "../dates/schedule.js";
import { type CapFloor, type Cashflow, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getCurve, getDiscountCurve, getFixing } from "../market/market-context.js";
import { type IrVolQuotation, bachelierGreeks, black76Greeks, convertIrVol, type OptionType } from "../models/black.js";
import { type VolType, capletVol } from "../models/vol-surfaces.js";
import { estimateMissingIborRate, fxToReporting, missingFixingMessage } from "./leg-pricer.js";

export type CapFloorModel = "Bachelier" | "Black" | "ShiftedBlack";

/** Model implied by a surface's vol type (Normal → Bachelier, Lognormal → Black, ShiftedLognormal → ShiftedBlack). */
export function modelForVolType(volType: VolType | undefined): CapFloorModel {
  return volType === "Lognormal" ? "Black" : volType === "ShiftedLognormal" ? "ShiftedBlack" : "Bachelier";
}

/** Vol quotation a model expects (`shift` only matters for ShiftedBlack). */
export function modelQuotation(model: CapFloorModel, shift: number): IrVolQuotation {
  return model === "Bachelier" ? { kind: "normal" } : { kind: "lognormal", shift: model === "ShiftedBlack" ? shift : 0 };
}

/** Vol quotation of a surface (a missing surface's fallback vol is quoted as a normal vol). */
export function surfaceQuotation(s: { volType: VolType; shift?: number } | undefined): IrVolQuotation {
  return !s || s.volType === "Normal" ? { kind: "normal" } : { kind: "lognormal", shift: s.shift ?? 0 };
}

export function sameQuotation(a: IrVolQuotation, b: IrVolQuotation): boolean {
  return a.kind === b.kind && (a.kind === "normal" || (b.kind === "lognormal" && a.shift === b.shift));
}

/** Human-readable quotation label for warnings / methodology. */
export function quotationLabel(q: IrVolQuotation): string {
  return q.kind === "normal" ? "normal" : q.shift ? `lognormal, shift ${(q.shift * 100).toFixed(2)}%` : "lognormal";
}

/**
 * Warning text emitted when a surface vol is converted into the model's
 * quotation (R3-1). Prefix `VOL_TYPE_CONVERTED:` is stable for consumers.
 */
export function volTypeConvertedWarning(
  kind: "caplet" | "swaption",
  surfaceId: string,
  from: IrVolQuotation,
  model: CapFloorModel,
  to: IrVolQuotation,
): string {
  return `VOL_TYPE_CONVERTED: ${kind} surface ${surfaceId} quotes ${quotationLabel(from)} vols but model ${model} was requested – vols converted to ${quotationLabel(to)} by price equivalence at each forward/strike/expiry`;
}

/**
 * Convert a surface vol into the model's quotation; throws
 * `PricingError("VOL_MODEL_INCOMPATIBLE")` when the requested lognormal model
 * cannot be fed (non-positive shifted forward or strike).
 */
export function convertSurfaceVol(
  vol: number,
  from: IrVolQuotation,
  to: IrVolQuotation,
  forward: number,
  strike: number,
  tExp: number,
  context: Record<string, unknown>,
): number {
  if (sameQuotation(from, to)) return vol;
  if (to.kind === "lognormal" && (!(forward + to.shift > 0) || !(strike + to.shift > 0))) {
    throw new PricingError(
      "VOL_MODEL_INCOMPATIBLE",
      `A ${to.shift ? "shifted " : ""}lognormal model cannot be fed from the ${quotationLabel(from)} surface: shifted forward ${((forward + to.shift) * 100).toFixed(3)}% / strike ${((strike + to.shift) * 100).toFixed(3)}% is not positive – use Bachelier or a larger shift`,
      { ...context, forward, strike, shift: to.shift },
    );
  }
  return convertIrVol(vol, from, to, forward, strike, tExp);
}

function optionValue(model: CapFloorModel, type: OptionType, fwd: number, strike: number, vol: number, t: number, shift: number) {
  if (model === "Bachelier") return bachelierGreeks(type, fwd, strike, vol, t);
  if (model === "ShiftedBlack") return black76Greeks(type, fwd + shift, strike + shift, vol, t);
  return black76Greeks(type, fwd, strike, vol, t);
}

/** Notional of a period: last `notionalSchedule` entry with date ≤ accrual start, else `notional` (same rule as swap legs). */
function capNotionalAt(trade: CapFloor, accrualStart: number): number {
  const s = trade.notionalSchedule;
  if (!s || s.length === 0) return trade.notional;
  let n = trade.notional;
  for (const e of s) if (e.date <= accrualStart) n = e.notional;
  return n;
}

/**
 * Cap / floor / collar as a strip of caplets / floorlets on the index
 * forward. Model: explicit `trade.model`, else derived from the caplet
 * surface's vol type (Normal → Bachelier, Lognormal → Black,
 * ShiftedLognormal → ShiftedBlack), default Bachelier.
 *
 * Model / surface mismatch (R3-1): when the requested model's vol quotation
 * differs from the surface's (e.g. `model: "Black"` on a normal surface) every
 * caplet vol is converted by price equivalence at its forward/strike/expiry
 * (`convertIrVol`) and a `VOL_TYPE_CONVERTED` warning is emitted; a
 * lognormal model on a non-positive shifted forward/strike raises
 * `PricingError("VOL_MODEL_INCOMPATIBLE")`. A `volOverride` is always read in
 * the model's own quotation and never converted.
 *
 * Conventions: caplet expiry = fixing date, payment in arrears at the period
 * end; the first caplet of a spot-starting cap is included (its fixing is
 * usually known – load it as a fixing to value it intrinsically). For RFR
 * indices the default 3M frequency values a compounded-RFR caplet with the
 * model on the 3M forward (market-standard approximation). An optional
 * `notionalSchedule` (amortising cap) is applied per period like on swap legs;
 * `analytics.premiumPct` then refers to the initial notional.
 */
export function priceCapFloor(ctx: MarketContext, trade: CapFloor, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.currency;
  const idx = getIndex(trade.index);
  const proj = getCurve(ctx, idx.curveId);
  const disc = getDiscountCurve(ctx, trade.currency, trade.collateralCurrency);
  const fx = fxToReporting(ctx, trade.currency, reporting, trade.collateralCurrency);
  const surface = ctx.capletVols?.[`${trade.currency}-${idx.name}`] ?? ctx.capletVols?.[trade.currency];
  const model: CapFloorModel = trade.model ?? modelForVolType(surface?.volType);
  const shift = trade.shift ?? surface?.shift ?? 0;
  const warnings: string[] = [];
  if (!surface && trade.volOverride === undefined) warnings.push("No caplet vol surface – using 60bp normal vol");
  const from = surfaceQuotation(surface);
  const to = modelQuotation(model, shift);
  const convert = trade.volOverride === undefined && !sameQuotation(from, to);
  if (convert) warnings.push(volTypeConvertedWarning("caplet", surface?.id ?? "(fallback 60bp normal)", from, model, to));
  const schedule = buildSchedule({
    effectiveDate: trade.effectiveDate,
    terminationDate: trade.terminationDate,
    frequency: trade.frequency,
    calendar: trade.calendar,
    businessDayConvention: trade.businessDayConvention ?? "ModifiedFollowing",
    stub: trade.stub ?? "ShortFront",
    fixingLag: idx.fixingLag,
    fixingCalendar: idx.fixingCalendar,
  });
  const longShort = trade.payReceive === "Receive" ? 1 : -1;
  const components: { type: OptionType; strike: number; sign: number }[] = [];
  if (trade.capFloor === "Cap") components.push({ type: "Call", strike: trade.strike, sign: 1 });
  else if (trade.capFloor === "Floor") components.push({ type: "Put", strike: trade.strike, sign: 1 });
  else {
    components.push({ type: "Call", strike: trade.strike, sign: 1 });
    components.push({ type: "Put", strike: trade.floorStrike ?? trade.strike, sign: -1 });
  }
  const cashflows: Cashflow[] = [];
  let pv = 0;
  let vega = 0;
  let delta = 0;
  let gamma = 0;
  const val = ctx.valuationDate;
  for (const p of schedule.periods) {
    if (p.paymentDate <= val) continue;
    const tau = yearFraction(p.accrualStart, p.accrualEnd, trade.dayCount);
    const df = disc.df(p.paymentDate);
    const tExp = Math.max(0, yearFraction(val, p.fixingDate, "ACT/365F"));
    let fwd: number;
    let isFixed = false;
    const fixing = p.fixingDate <= val ? getFixing(ctx, idx.name, p.fixingDate) : undefined;
    if (fixing !== undefined) {
      fwd = fixing;
      isFixed = true;
    } else if (p.fixingDate < val) {
      const message = missingFixingMessage(idx.name, p.fixingDate, `caplet valued on the ${idx.tenor} forward from ${toISO(val)}`);
      if ((ctx.missingFixingPolicy ?? "curve") === "throw") throw new PricingError("MISSING_FIXING", message, { index: idx.name, fixingDate: p.fixingDate });
      warnings.push(message);
      fwd = estimateMissingIborRate(proj, p.accrualStart, p.accrualEnd, val, idx.dayCount);
    } else {
      fwd = proj.forwardRate(p.accrualStart, p.accrualEnd, idx.dayCount);
    }
    const notional = capNotionalAt(trade, p.accrualStart);
    let amount = 0;
    for (const c of components) {
      let vol = trade.volOverride ?? (surface ? capletVol(surface, tExp, c.strike) : 0.006);
      if (convert && !isFixed && tExp > 0) {
        vol = convertSurfaceVol(vol, from, to, fwd, c.strike, tExp, { tradeId: trade.id, model, surfaceId: surface?.id, fixingDate: toISO(p.fixingDate) });
      }
      if (!isFixed && model !== "Bachelier" && (fwd + shift <= 0 || c.strike + shift <= 0)) {
        warnings.push(
          `NEGATIVE_RATE_LOGNORMAL: ${model} model with non-positive shifted forward/strike (${(fwd * 100).toFixed(3)}% / ${(c.strike * 100).toFixed(3)}%, shift ${(shift * 100).toFixed(2)}%) – intrinsic value used, no time value`,
        );
      }
      const g = isFixed
        ? { price: Math.max((c.type === "Call" ? 1 : -1) * (fwd - c.strike), 0), delta: 0, gamma: 0, vega: 0, theta: 0 }
        : optionValue(model, c.type, fwd, c.strike, vol, tExp, shift);
      const scale = longShort * c.sign * notional * tau;
      amount += scale * g.price;
      delta += scale * g.delta * df;
      gamma += scale * g.gamma * df;
      vega += scale * g.vega * df;
    }
    cashflows.push({
      legIndex: 0,
      legType: trade.capFloor,
      currency: trade.currency,
      accrualStart: p.accrualStart,
      accrualEnd: p.accrualEnd,
      paymentDate: p.paymentDate,
      fixingDate: p.fixingDate,
      notional,
      rate: fwd,
      accrualFactor: tau,
      amount,
      discountFactor: df,
      presentValue: amount * df,
      isFixed,
      kind: "OptionPayoff",
    });
    pv += amount * df;
  }
  let pvRep = pv * fx;
  if (trade.upfront && trade.upfront.date > val) {
    const d2 = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    const fxu = fxToReporting(ctx, trade.upfront.currency, reporting, trade.collateralCurrency);
    pvRep -= trade.upfront.amount * d2.df(trade.upfront.date) * fxu;
  }
  return {
    tradeId: trade.id,
    tradeType: "CapFloor",
    valuationDate: val,
    currency: reporting,
    pv: pvRep,
    legs: [{ legIndex: 0, legType: `${trade.capFloor} ${trade.index}`, currency: trade.currency, pv, pvReporting: pv * fx, cashflows }],
    analytics: {
      model,
      strike: trade.strike,
      floorStrike: trade.floorStrike,
      premiumPct: trade.notional ? (pv / trade.notional) * 100 : 0,
      /** ∂PV/∂F per 1.00 (absolute) change of every forward, reporting currency. */
      delta: delta * fx,
      /** ∂PV/∂F per 1bp change of every forward, reporting currency. */
      deltaPerBp: delta * fx * 1e-4,
      /** ∂²PV/∂F² per 1.00². */
      gamma: gamma * fx,
      /** ∂²PV/∂F² per bp². */
      gammaPerBp2: gamma * fx * 1e-8,
      /** Vega per 1bp normal vol (Bachelier) or 1 vol point (Black / ShiftedBlack). */
      vega: vega * fx * (model === "Bachelier" ? 1e-4 : 0.01),
      /** "yes" when surface vols were converted into the model's quotation (R3-1). */
      volConverted: convert ? "yes" : "no",
    },
    warnings: Array.from(new Set(warnings)),
  };
}
