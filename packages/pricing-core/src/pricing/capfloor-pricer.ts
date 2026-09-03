import { getIndex } from "../curves/index-definitions.js";
import { toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule } from "../dates/schedule.js";
import { type CapFloor, type Cashflow, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getCurve, getDiscountCurve, getFixing, getFxSpot } from "../market/market-context.js";
import { bachelierGreeks, black76Greeks, type OptionType } from "../models/black.js";
import { capletVol } from "../models/vol-surfaces.js";

function optionValue(
  model: "Bachelier" | "Black" | "ShiftedBlack",
  type: OptionType,
  fwd: number,
  strike: number,
  vol: number,
  t: number,
  shift: number,
) {
  if (model === "Bachelier") return bachelierGreeks(type, fwd, strike, vol, t);
  if (model === "ShiftedBlack") return black76Greeks(type, fwd + shift, strike + shift, vol, t);
  return black76Greeks(type, fwd, strike, vol, t);
}

export function priceCapFloor(ctx: MarketContext, trade: CapFloor, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.currency;
  const idx = getIndex(trade.index);
  const proj = getCurve(ctx, idx.curveId);
  const disc = getDiscountCurve(ctx, trade.currency, trade.collateralCurrency);
  const fx = trade.currency === reporting ? 1 : getFxSpot(ctx, trade.currency, reporting);
  const surface = ctx.capletVols?.[`${trade.currency}-${idx.name}`] ?? ctx.capletVols?.[trade.currency];
  const model = trade.model ?? surface?.volType === "Lognormal" ? "Black" : trade.model ?? "Bachelier";
  const shift = trade.shift ?? surface?.shift ?? 0;
  const warnings: string[] = [];
  if (!surface && trade.volOverride === undefined) warnings.push("No caplet vol surface – using 60bp normal vol");
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
  for (const p of schedule.periods) {
    if (p.paymentDate <= ctx.valuationDate) continue;
    const tau = yearFraction(p.accrualStart, p.accrualEnd, trade.dayCount);
    const df = disc.df(p.paymentDate);
    const tExp = Math.max(0, yearFraction(ctx.valuationDate, p.fixingDate, "ACT/365F"));
    let fwd: number;
    let isFixed = false;
    const fixing = p.fixingDate <= ctx.valuationDate ? getFixing(ctx, idx.name, p.fixingDate) : undefined;
    if (fixing !== undefined) {
      fwd = fixing;
      isFixed = true;
    } else {
      fwd = proj.forwardRate(p.accrualStart, p.accrualEnd, idx.dayCount);
      if (p.fixingDate <= ctx.valuationDate) warnings.push(`Missing fixing ${idx.name} ${toISO(p.fixingDate)}`);
    }
    let amount = 0;
    for (const c of components) {
      const vol =
        trade.volOverride ?? (surface ? capletVol(surface, tExp, c.strike) : 0.006);
      const g = isFixed
        ? { price: Math.max((c.type === "Call" ? 1 : -1) * (fwd - c.strike), 0), delta: 0, gamma: 0, vega: 0, theta: 0 }
        : optionValue(model, c.type, fwd, c.strike, vol, tExp, shift);
      const scale = longShort * c.sign * trade.notional * tau;
      amount += scale * g.price;
      delta += scale * g.delta * df;
      gamma += scale * g.gamma * df;
      vega += scale * g.vega * df;
    }
    cashflows.push({
      legIndex: 0, legType: trade.capFloor, currency: trade.currency, accrualStart: p.accrualStart, accrualEnd: p.accrualEnd,
      paymentDate: p.paymentDate, fixingDate: p.fixingDate, notional: trade.notional, rate: fwd, accrualFactor: tau,
      amount, discountFactor: df, presentValue: amount * df, isFixed, kind: "OptionPayoff",
    });
    pv += amount * df;
  }
  let pvRep = pv * fx;
  if (trade.upfront && trade.upfront.date > ctx.valuationDate) {
    const d2 = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    const fxu = trade.upfront.currency === reporting ? 1 : getFxSpot(ctx, trade.upfront.currency, reporting);
    pvRep -= trade.upfront.amount * d2.df(trade.upfront.date) * fxu;
  }
  return {
    tradeId: trade.id,
    tradeType: "CapFloor",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv: pvRep,
    legs: [{ legIndex: 0, legType: `${trade.capFloor} ${trade.index}`, currency: trade.currency, pv, pvReporting: pv * fx, cashflows }],
    analytics: {
      model,
      strike: trade.strike,
      floorStrike: trade.floorStrike,
      premiumPct: trade.notional ? (pv / trade.notional) * 100 : 0,
      delta: delta * fx,
      gamma: gamma * fx,
      /** Vega per 1bp normal vol (or 1% lognormal) */
      vega: vega * fx * (model === "Bachelier" ? 1e-4 : 0.01),
    },
    warnings: Array.from(new Set(warnings)),
  };
}
