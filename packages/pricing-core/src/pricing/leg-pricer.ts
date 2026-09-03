import { type Curve } from "../curves/curve.js";
import { getIndex } from "../curves/index-definitions.js";
import { addBusinessDays, getCalendar } from "../dates/calendar.js";
import { type SerialDate, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule, type SchedulePeriod } from "../dates/schedule.js";
import { type MarketContext, getCurve, getDiscountCurve, getFixing, getFxSpot } from "../market/market-context.js";
import { type Cashflow, type FixedLeg, type FloatLeg, type LegResult, type SwapLeg } from "../instruments/types.js";

export interface LegPricingOptions {
  reportingCurrency: string;
  collateralCurrency?: string;
  /** When set, the leg's floating coupons get an embedded cap/floor priced later (handled in swap pricer). */
  includeNotionalExchange?: boolean;
}

function legSign(leg: SwapLeg): number {
  return leg.payReceive === "Receive" ? 1 : -1;
}

function notionalAt(leg: SwapLeg, period: SchedulePeriod): number {
  if (!leg.notionalSchedule || leg.notionalSchedule.length === 0) return leg.notional;
  // Notional applicable to a period = last schedule entry with date <= accrual start.
  let n = leg.notionalSchedule[0]!.notional;
  for (const e of leg.notionalSchedule) {
    if (e.date <= period.accrualStart) n = e.notional;
  }
  return n;
}

function fxToReporting(ctx: MarketContext, ccy: string, reporting: string): number {
  return ccy === reporting ? 1 : getFxSpot(ctx, ccy, reporting);
}

/**
 * Project the floating rate for a period. Handles historical fixings for
 * IBOR, and compounded/averaged overnight rates (with realised fixings up to
 * the valuation date and projection thereafter).
 */
export function projectFloatingRate(
  ctx: MarketContext,
  leg: FloatLeg,
  period: SchedulePeriod,
  projCurve: Curve,
): { rate: number; isFixed: boolean; warning?: string } {
  const idx = getIndex(leg.index);
  const gearing = leg.gearing ?? 1;
  const spread = leg.spread ?? 0;
  if (idx.type === "IBOR") {
    const fixing = getFixing(ctx, idx.name, period.fixingDate);
    if (fixing !== undefined) return { rate: gearing * fixing + spread, isFixed: true };
    if (period.fixingDate < ctx.valuationDate) {
      // Missing historical fixing – fall back to curve, flag warning.
      const est = projCurve.forwardRate(period.accrualStart, period.accrualEnd, idx.dayCount);
      return {
        rate: gearing * est + spread,
        isFixed: false,
        warning: `Missing fixing for ${idx.name} on ${toISO(period.fixingDate)}; used curve forward`,
      };
    }
    const fwd = projCurve.forwardRate(period.accrualStart, period.accrualEnd, idx.dayCount);
    return { rate: gearing * fwd + spread, isFixed: false };
  }
  // Overnight compounding in arrears.
  const cal = getCalendar(idx.fixingCalendar);
  const start = period.accrualStart;
  const end = period.accrualEnd;
  const val = ctx.valuationDate;
  const tauTotal = yearFraction(start, end, idx.dayCount);
  if (tauTotal <= 0) return { rate: spread, isFixed: true };
  let compounded = 1;
  let sumAvg = 0;
  let warning: string | undefined;
  let d = start;
  let realisedTo = start;
  // Realised part: daily fixings from start up to (excluding) valuation date.
  while (d < end && d < val) {
    const next = addBusinessDays(d, 1, cal);
    const stop = Math.min(next, end);
    const tau = yearFraction(d, stop, idx.dayCount);
    const fixing = getFixing(ctx, idx.name, d);
    let r: number;
    if (fixing === undefined) {
      r = projCurve.forwardRate(d, stop, idx.dayCount);
      warning = `Missing ${idx.name} fixings in accrual period starting ${toISO(start)}; used curve forward`;
    } else {
      r = fixing;
    }
    compounded *= 1 + r * tau;
    sumAvg += r * tau;
    realisedTo = stop;
    d = stop;
  }
  const isFixed = realisedTo >= end;
  if (realisedTo < end) {
    const tauFwd = yearFraction(realisedTo, end, idx.dayCount);
    const fwd = projCurve.forwardRate(realisedTo, end, idx.dayCount);
    compounded *= 1 + fwd * tauFwd;
    sumAvg += fwd * tauFwd;
  }
  const rate =
    (leg.compounding ?? "Compound") === "Compound" ? (compounded - 1) / tauTotal : sumAvg / tauTotal;
  return { rate: gearing * rate + spread, isFixed, warning };
}

export function priceLeg(
  ctx: MarketContext,
  leg: SwapLeg,
  legIndex: number,
  opts: LegPricingOptions,
): { result: LegResult; warnings: string[] } {
  const warnings: string[] = [];
  const disc = getDiscountCurve(ctx, leg.currency, opts.collateralCurrency);
  const fx = fxToReporting(ctx, leg.currency, opts.reportingCurrency);
  const sign = legSign(leg);
  const idx = leg.type === "Float" ? getIndex(leg.index) : undefined;
  const schedule = buildSchedule({
    effectiveDate: leg.effectiveDate,
    terminationDate: leg.terminationDate,
    frequency: leg.frequency,
    calendar: leg.calendar,
    businessDayConvention: leg.businessDayConvention ?? "ModifiedFollowing",
    stub: leg.stub ?? "ShortFront",
    endOfMonth: leg.endOfMonth ?? false,
    paymentLag: leg.paymentLag ?? 0,
    fixingLag: leg.type === "Float" ? leg.fixingLag ?? idx!.fixingLag : 0,
    fixingCalendar: idx?.fixingCalendar,
  });
  const projCurve = idx ? getCurve(ctx, idx.curveId) : undefined;
  const cashflows: Cashflow[] = [];
  let pv = 0;
  let annuity = 0;
  const val = ctx.valuationDate;

  // Notional exchanges.
  const nx = leg.notionalExchange;
  if (nx?.initial && schedule.periods[0]!.accrualStart >= val) {
    const p0 = schedule.periods[0]!;
    const n0 = notionalAt(leg, p0);
    const df = disc.df(p0.accrualStart);
    const amount = -sign * n0; // receiving coupons means we pay the notional at start
    cashflows.push({
      legIndex, legType: leg.type, currency: leg.currency, paymentDate: p0.accrualStart, notional: n0,
      amount, discountFactor: df, presentValue: amount * df, kind: "Notional",
    });
    pv += amount * df;
  }

  for (const p of schedule.periods) {
    if (p.paymentDate <= val) continue; // already paid
    const n = notionalAt(leg, p);
    const tau = yearFraction(p.accrualStart, p.accrualEnd, leg.dayCount, {
      refStart: p.accrualStart,
      refEnd: p.accrualEnd,
    });
    const df = disc.df(p.paymentDate);
    let rate: number;
    let isFixed = true;
    if (leg.type === "Fixed") {
      rate = (leg as FixedLeg).rate;
    } else {
      const proj = projectFloatingRate(ctx, leg as FloatLeg, p, projCurve!);
      rate = proj.rate;
      isFixed = proj.isFixed;
      if (proj.warning) warnings.push(proj.warning);
      const fl = leg as FloatLeg;
      // Embedded cap/floor on coupon (intrinsic only – optionality priced in CapFloor instrument).
      if (fl.capRate !== undefined) rate = Math.min(rate, fl.capRate);
      if (fl.floorRate !== undefined) rate = Math.max(rate, fl.floorRate);
    }
    const amount = sign * n * rate * tau;
    cashflows.push({
      legIndex, legType: leg.type, currency: leg.currency,
      accrualStart: p.accrualStart, accrualEnd: p.accrualEnd, paymentDate: p.paymentDate,
      fixingDate: leg.type === "Float" ? p.fixingDate : undefined,
      notional: n, rate, accrualFactor: tau, amount, discountFactor: df, presentValue: amount * df,
      isFixed, kind: "Interest",
    });
    pv += amount * df;
    annuity += n * tau * df;

    // Interim notional exchange for amortising cross-currency legs.
    if (nx?.interim && leg.notionalSchedule) {
      const nextIdx = p.index + 1;
      const nextPeriod = schedule.periods[nextIdx];
      if (nextPeriod) {
        const nNext = notionalAt(leg, nextPeriod);
        const diff = n - nNext;
        if (Math.abs(diff) > 1e-9) {
          const amt = sign * diff;
          cashflows.push({
            legIndex, legType: leg.type, currency: leg.currency, paymentDate: p.paymentDate, notional: diff,
            amount: amt, discountFactor: df, presentValue: amt * df, kind: "Notional",
          });
          pv += amt * df;
        }
      }
    }
  }

  if (nx?.final) {
    const last = schedule.periods[schedule.periods.length - 1]!;
    if (last.paymentDate > val) {
      const nLast = notionalAt(leg, last);
      const df = disc.df(last.paymentDate);
      const amount = sign * nLast;
      cashflows.push({
        legIndex, legType: leg.type, currency: leg.currency, paymentDate: last.paymentDate, notional: nLast,
        amount, discountFactor: df, presentValue: amount * df, kind: "Notional",
      });
      pv += amount * df;
    }
  }

  return {
    result: {
      legIndex,
      legType: leg.type === "Float" ? `Float ${leg.index}` : "Fixed",
      currency: leg.currency,
      pv,
      pvReporting: pv * fx,
      annuity,
      cashflows,
    },
    warnings,
  };
}

/** Accrued interest of a leg at valuation date (signed, leg currency). */
export function legAccrued(ctx: MarketContext, leg: SwapLeg, legResult: LegResult): number {
  const val = ctx.valuationDate;
  const cf = legResult.cashflows.find(
    (c) => c.kind === "Interest" && c.accrualStart !== undefined && c.accrualStart <= val && c.accrualEnd! > val,
  );
  if (!cf || cf.rate === undefined) return 0;
  const tauAccr = yearFraction(cf.accrualStart!, val, leg.dayCount);
  return legSign(leg) * cf.notional * cf.rate * tauAccr;
}

export function scheduleDates(leg: SwapLeg): SerialDate[] {
  const s = buildSchedule({
    effectiveDate: leg.effectiveDate,
    terminationDate: leg.terminationDate,
    frequency: leg.frequency,
    calendar: leg.calendar,
    businessDayConvention: leg.businessDayConvention ?? "ModifiedFollowing",
    stub: leg.stub ?? "ShortFront",
    endOfMonth: leg.endOfMonth ?? false,
  });
  return s.periods.map((p) => p.paymentDate);
}
