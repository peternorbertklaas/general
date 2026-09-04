import { type Curve } from "../curves/curve.js";
import { getIndex } from "../curves/index-definitions.js";
import { PricingError } from "../errors.js";
import { addBusinessDays, adjust, getCalendar } from "../dates/calendar.js";
import { type SerialDate, type Tenor, addTenor, toISO } from "../dates/date.js";
import { type DayCountConvention, type YearFractionContext, normalizeDayCount, yearFraction } from "../dates/daycount.js";
import { buildSchedule, frequencyPerYear, frequencyTenorOf, type SchedulePeriod } from "../dates/schedule.js";
import { type MarketContext, getCurve, getDiscountCurve, getFixing } from "../market/market-context.js";
import { fxRateAtValuationDate } from "../market/fx-spot.js";
import { type Cashflow, type FixedLeg, type FloatLeg, type LegResult, type SwapLeg } from "../instruments/types.js";
import { bachelier, black76 } from "../models/black.js";
import { capletVol } from "../models/vol-surfaces.js";

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

/**
 * Schedule lookup shared by coupon, spread and notional schedules: the value
 * of the last entry with `date` ≤ `accrualStart`; `fallback` when no entry
 * applies yet (periods before the first schedule date).
 */
function scheduleValueAt<T extends { date: SerialDate }>(
  schedule: T[] | undefined,
  accrualStart: SerialDate,
  pick: (e: T) => number,
  fallback: number,
): number {
  if (!schedule || schedule.length === 0) return fallback;
  let v = fallback;
  let found = false;
  for (const e of schedule) {
    if (e.date <= accrualStart) {
      v = pick(e);
      found = true;
    }
  }
  return found ? v : fallback;
}

/** Fixed coupon of the period starting at `accrualStart` (step-up schedule aware, see `FixedLeg.rateSchedule`). */
export function fixedRateAt(leg: FixedLeg, accrualStart: SerialDate): number {
  return scheduleValueAt(leg.rateSchedule, accrualStart, (e) => e.rate, leg.rate);
}

/** Spread of the floating period starting at `accrualStart` (see `FloatLeg.spreadSchedule`). */
export function floatSpreadAt(leg: FloatLeg, accrualStart: SerialDate): number {
  return scheduleValueAt(leg.spreadSchedule, accrualStart, (e) => e.spread, leg.spread ?? 0);
}

/**
 * Conversion factor from `ccy` to the reporting currency for present values
 * (discounted to the valuation date): the spot rate adjusted from the spot
 * date back to today with the discount factors of both currencies.
 */
export function fxToReporting(ctx: MarketContext, ccy: string, reporting: string, collateral?: string): number {
  return ccy === reporting ? 1 : fxRateAtValuationDate(ctx, ccy, reporting, collateral);
}

/**
 * Estimate for a missing historical IBOR fixing: the first available curve
 * forward of the same length, i.e. the period shifted forward so that it
 * starts on the valuation date (a fixing that is 5 months old is replaced by
 * today's fixing of the same tenor, not by the forward over the remaining
 * days of the period).
 */
export function estimateMissingIborRate(
  projCurve: Curve,
  accrualStart: SerialDate,
  accrualEnd: SerialDate,
  valuationDate: SerialDate,
  dayCount: DayCountConvention,
): number {
  const shift = Math.max(0, valuationDate - accrualStart);
  return projCurve.forwardRate(accrualStart + shift, accrualEnd + shift, dayCount);
}

/** Structured warning for a required but unavailable historical fixing (prefix `MISSING_FIXING:`). */
export function missingFixingMessage(indexName: string, fixingDate: SerialDate, detail: string): string {
  return `MISSING_FIXING: Missing fixing for ${indexName} on ${toISO(fixingDate)}; ${detail}`;
}

export interface FloatingRateProjection {
  rate: number;
  isFixed: boolean;
  warning?: string;
  /**
   * Realised "rate × year fraction" accrued from the accrual start to the
   * valuation date (gearing and spread included) – for RFR legs the realised
   * compounding to date. Undefined when the period has not started.
   */
  accruedRateTau?: number;
}

/**
 * Project the floating rate for a period. Handles historical fixings for
 * IBOR, and compounded/averaged overnight rates (with realised fixings up to
 * the valuation date and projection thereafter).
 *
 * Missing fixings: a fixing is only "missing" when it was published before
 * the valuation date **and** the accrual period has started; then the first
 * available curve forward is used and a `MISSING_FIXING:` warning is
 * returned (or an error thrown under `missingFixingPolicy: "throw"`).
 * Observation days before the valuation date of a period that has not yet
 * started (RFR lookback on a spot-starting swap) are projected with the
 * curve's first forward without a warning.
 *
 * RFR conventions: lookback (`lookbackDays`, optionally with observation
 * shift) and lockout (`lockoutDays`, N8-7 – the fixing of business day
 * `end − k` on the fixing calendar applies to the last k business days of the
 * period, in the realised part from the fixing history, in the projection as
 * the curve forward of that day's overnight period compounded day by day).
 */
export function projectFloatingRate(ctx: MarketContext, leg: FloatLeg, period: SchedulePeriod, projCurve: Curve): FloatingRateProjection {
  const idx = getIndex(leg.index);
  const gearing = leg.gearing ?? 1;
  const spread = floatSpreadAt(leg, period.accrualStart);
  const val = ctx.valuationDate;
  const policy = ctx.missingFixingPolicy ?? "curve";
  const accruedTauOf = (rate: number): number | undefined =>
    period.accrualStart <= val && period.accrualEnd > val ? rate * yearFraction(period.accrualStart, val, leg.dayCount) : undefined;
  if (idx.type === "IBOR") {
    const fixing = getFixing(ctx, idx.name, period.fixingDate);
    if (fixing !== undefined) {
      const rate = gearing * fixing + spread;
      return { rate, isFixed: true, accruedRateTau: accruedTauOf(rate) };
    }
    if (period.fixingDate < val) {
      // Missing historical fixing – fall back to the first available forward, flag warning.
      const message = missingFixingMessage(idx.name, period.fixingDate, `used ${idx.tenor} forward from ${toISO(val)} (same-length period starting today)`);
      if (policy === "throw") throw new PricingError("MISSING_FIXING", message, { index: idx.name, fixingDate: period.fixingDate });
      const est = estimateMissingIborRate(projCurve, period.accrualStart, period.accrualEnd, val, idx.dayCount);
      const rate = gearing * est + spread;
      return { rate, isFixed: false, warning: message, accruedRateTau: accruedTauOf(rate) };
    }
    const fwd = projCurve.forwardRate(period.accrualStart, period.accrualEnd, idx.dayCount);
    return { rate: gearing * fwd + spread, isFixed: false };
  }
  // Overnight compounding in arrears on the index's fixing calendar (N8-4: SOFR on `US-SIFMA` – a Good Friday is
  // no publication day, Thursday's fixing accrues over four days).
  const cal = getCalendar(idx.fixingCalendar);
  const start = period.accrualStart;
  const end = period.accrualEnd;
  const tauTotal = yearFraction(start, end, idx.dayCount);
  if (tauTotal <= 0) return { rate: spread, isFixed: true };
  let compounded = 1;
  let sumAvg = 0;
  let compoundedToDate = 1;
  let sumAvgToDate = 0;
  let missingFixing: SerialDate | undefined;
  const lookback = leg.lookbackDays ?? 0;
  const obsShift = leg.observationShift ?? false;
  const lockout = leg.lockoutDays ?? 0;
  // N8-7 lockout: the fixing of the business day `end − lockoutDays` (floored at the accrual start) applies from that
  // day to the end of the period.
  const lockoutDate = lockout > 0 ? Math.max(start, addBusinessDays(end, -lockout, cal)) : undefined;
  const periodStarted = start <= val;
  // Fixing-calendar business day whose rate is in effect on `x` (an accrual day on a fixing holiday, e.g. a SOFR
  // period starting on Good Friday, uses the last published fixing).
  const inEffect = (x: SerialDate) => (cal.isHoliday(x) ? addBusinessDays(x, -1, cal) : x);
  // Observation date for an accrual day d: d shifted back by `lookback` business days.
  const obs = (d: SerialDate) => (lookback > 0 ? addBusinessDays(d, -lookback, cal) : d);
  // Fixing date whose rate applies to accrual day d (lockout freezes it at the lockout date).
  const fixingDayOf = (d: SerialDate) => (lockoutDate !== undefined && d >= lockoutDate ? lockoutDate : inEffect(obs(d)));
  let d = start;
  let realisedTo = start;
  // Realised part: daily fixings whose observation date is before the valuation date.
  while (d < end && fixingDayOf(d) < val) {
    const next = addBusinessDays(d, 1, cal);
    const stop = Math.min(next, end);
    const od = fixingDayOf(d);
    const oStop = lockoutDate !== undefined && d >= lockoutDate ? addBusinessDays(od, 1, cal) : obs(stop);
    // Weight: accrual-day count of the accrual period (lookback) or of the observation period (observation shift).
    const tau = obsShift ? yearFraction(od, oStop, idx.dayCount) : yearFraction(d, stop, idx.dayCount);
    const fixing = getFixing(ctx, idx.name, od);
    let r: number;
    if (fixing === undefined) {
      // First available forward (short-end extrapolation of the curve when od < valuation date).
      r = projCurve.forwardRate(od, oStop, idx.dayCount);
      if (periodStarted && missingFixing === undefined) missingFixing = od;
    } else {
      r = fixing;
    }
    compounded *= 1 + r * tau;
    sumAvg += r * tau;
    if (stop <= val) {
      compoundedToDate *= 1 + r * tau;
      sumAvgToDate += r * tau;
    }
    realisedTo = stop;
    d = stop;
  }
  if (missingFixing !== undefined) {
    const message = missingFixingMessage(idx.name, missingFixing, `accrual period starting ${toISO(start)} projected with the curve's first forward`);
    if (policy === "throw") throw new PricingError("MISSING_FIXING", message, { index: idx.name, fixingDate: missingFixing });
  }
  const isFixed = realisedTo >= end;
  if (realisedTo < end && lockoutDate !== undefined && lockoutDate < end) {
    // Projection with lockout: telescoping forward up to the lockout date, then the lockout date's overnight
    // forward compounded day by day over the frozen tail (the realised loop already covered a lockout date < today).
    if (realisedTo < lockoutDate) {
      const tauFwd = yearFraction(realisedTo, lockoutDate, idx.dayCount);
      const fwd = projCurve.forwardRate(inEffect(realisedTo), lockoutDate, idx.dayCount);
      compounded *= 1 + fwd * tauFwd;
      sumAvg += fwd * tauFwd;
    }
    const rLock = projCurve.forwardRate(lockoutDate, addBusinessDays(lockoutDate, 1, cal), idx.dayCount);
    let x = Math.max(realisedTo, lockoutDate);
    while (x < end) {
      const nx = Math.min(addBusinessDays(x, 1, cal), end);
      const tau = yearFraction(x, nx, idx.dayCount);
      compounded *= 1 + rLock * tau;
      sumAvg += rLock * tau;
      x = nx;
    }
  } else if (realisedTo < end) {
    const oFrom = inEffect(obs(realisedTo));
    const oTo = obs(end);
    const tauFwd = obsShift ? yearFraction(oFrom, oTo, idx.dayCount) : yearFraction(realisedTo, end, idx.dayCount);
    const fwd = projCurve.forwardRate(oFrom, oTo, idx.dayCount);
    compounded *= 1 + fwd * tauFwd;
    sumAvg += fwd * tauFwd;
  }
  const isCompound = (leg.compounding ?? "Compound") === "Compound";
  const rate = isCompound ? (compounded - 1) / tauTotal : sumAvg / tauTotal;
  let accruedRateTau: number | undefined;
  if (periodStarted && end > val) {
    const realisedPart = isCompound ? compoundedToDate - 1 : sumAvgToDate;
    accruedRateTau = gearing * realisedPart + spread * yearFraction(start, val, leg.dayCount);
  }
  return {
    rate: gearing * rate + spread,
    isFixed,
    warning:
      missingFixing !== undefined
        ? missingFixingMessage(idx.name, missingFixing, `accrual period starting ${toISO(start)} projected with the curve's first forward`)
        : undefined,
    accruedRateTau,
  };
}

/**
 * Expected coupon rate of a floating leg with embedded cap/floor. Uses the
 * caplet vol surface of the leg's index (Bachelier for normal surfaces,
 * (shifted) Black otherwise). Falls back to the intrinsic clamp when no
 * surface is available or the rate is already fixed.
 */
export function expectedCollaredRate(ctx: MarketContext, leg: FloatLeg, period: SchedulePeriod, rate: number, isFixed: boolean, warnings: string[]): number {
  const gearing = leg.gearing ?? 1;
  const spread = floatSpreadAt(leg, period.accrualStart);
  // Optionality applies to the index level; convert spread/gearing.
  const index = gearing !== 0 ? (rate - spread) / gearing : rate;
  const clamp = (x: number) => Math.min(leg.capRate ?? Infinity, Math.max(leg.floorRate ?? -Infinity, x));
  if (isFixed) return gearing * clamp(index) + spread;
  const idx = getIndex(leg.index);
  const surface = ctx.capletVols?.[`${leg.currency}-${idx.name}`] ?? ctx.capletVols?.[leg.currency];
  const tExp = Math.max(0, yearFraction(ctx.valuationDate, period.fixingDate, "ACT/365F"));
  if (!surface || tExp <= 0) {
    if (!surface) warnings.push(`No caplet vol surface for ${idx.name} – embedded cap/floor valued intrinsically`);
    return gearing * clamp(index) + spread;
  }
  let expected = index;
  if (leg.capRate !== undefined) {
    const vol = capletVol(surface, tExp, leg.capRate);
    expected -=
      surface.volType === "Normal"
        ? bachelier("Call", index, leg.capRate, vol, tExp)
        : black76("Call", index + (surface.shift ?? 0), leg.capRate + (surface.shift ?? 0), vol, tExp);
  }
  if (leg.floorRate !== undefined) {
    const vol = capletVol(surface, tExp, leg.floorRate);
    expected +=
      surface.volType === "Normal"
        ? bachelier("Put", index, leg.floorRate, vol, tExp)
        : black76("Put", index + (surface.shift ?? 0), leg.floorRate + (surface.shift ?? 0), vol, tExp);
  }
  return gearing * expected + spread;
}

/**
 * Year-fraction context of a period: ACT/ACT ICMA needs the coupon
 * frequency and the regular (notional) reference period – for stubs the
 * reference period is the regular period ending (front stub) or starting
 * (back stub) at the stub's regular end/start; 30E/360 ISDA needs the
 * maturity flag.
 */
function yearFractionContext(leg: SwapLeg, p: SchedulePeriod, isLast: boolean, tenor: Tenor | null): YearFractionContext {
  const ctx: YearFractionContext = { isMaturity: isLast };
  if (normalizeDayCount(leg.dayCount) !== "ACT/ACT ICMA") return ctx;
  ctx.frequency = frequencyPerYear(leg.frequency);
  let refStart = p.accrualStart;
  let refEnd = p.accrualEnd;
  if (p.isStub && tenor) {
    const cal = getCalendar(leg.calendar);
    const bdc = leg.businessDayConvention ?? "ModifiedFollowing";
    if (p.index === 0) refStart = adjust(addTenor(p.unadjustedEnd, { n: -tenor.n, unit: tenor.unit }, leg.endOfMonth ?? false), bdc, cal);
    else refEnd = adjust(addTenor(p.unadjustedStart, tenor, leg.endOfMonth ?? false), bdc, cal);
  }
  ctx.refStart = refStart;
  ctx.refEnd = refEnd;
  // EOM roll of the leg drives the notional periods (R2-5); undefined → inferred from the reference period.
  ctx.endOfMonth = leg.endOfMonth;
  return ctx;
}

export function priceLeg(ctx: MarketContext, leg: SwapLeg, legIndex: number, opts: LegPricingOptions): { result: LegResult; warnings: string[] } {
  const warnings: string[] = [];
  const disc = getDiscountCurve(ctx, leg.currency, opts.collateralCurrency);
  const fx = fxToReporting(ctx, leg.currency, opts.reportingCurrency, opts.collateralCurrency);
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
    roll: leg.roll,
    paymentLag: leg.paymentLag ?? 0,
    fixingLag: leg.type === "Float" ? (leg.fixingLag ?? idx!.fixingLag) : 0,
    fixingCalendar: idx?.fixingCalendar,
  });
  const tenor = frequencyTenorOf(leg.frequency);
  const projCurve = idx ? getCurve(ctx, idx.curveId) : undefined;
  const cashflows: Cashflow[] = [];
  let pv = 0;
  let annuity = 0;
  const val = ctx.valuationDate;
  const lastIndex = schedule.periods.length - 1;

  // Notional exchanges (cashflows on the valuation date count as settled, consistent with coupons).
  const nx = leg.notionalExchange;
  if (nx?.initial && schedule.periods[0]!.accrualStart > val) {
    const p0 = schedule.periods[0]!;
    const n0 = notionalAt(leg, p0);
    const df = disc.df(p0.accrualStart);
    const amount = -sign * n0; // receiving coupons means we pay the notional at start
    cashflows.push({
      legIndex,
      legType: leg.type,
      currency: leg.currency,
      paymentDate: p0.accrualStart,
      notional: n0,
      amount,
      discountFactor: df,
      presentValue: amount * df,
      kind: "Notional",
    });
    pv += amount * df;
  }

  for (const p of schedule.periods) {
    if (p.paymentDate <= val) continue; // already paid
    const n = notionalAt(leg, p);
    const tau = yearFraction(p.accrualStart, p.accrualEnd, leg.dayCount, yearFractionContext(leg, p, p.index === lastIndex, tenor));
    const df = disc.df(p.paymentDate);
    let rate: number;
    let isFixed = true;
    let accrued: number | undefined;
    if (leg.type === "Fixed") {
      rate = fixedRateAt(leg as FixedLeg, p.accrualStart);
      if (p.accrualStart <= val && p.accrualEnd > val) accrued = sign * n * rate * yearFraction(p.accrualStart, val, leg.dayCount);
    } else {
      const proj = projectFloatingRate(ctx, leg as FloatLeg, p, projCurve!);
      rate = proj.rate;
      isFixed = proj.isFixed;
      if (proj.warning) warnings.push(proj.warning);
      if (proj.accruedRateTau !== undefined) accrued = sign * n * proj.accruedRateTau;
      const fl = leg as FloatLeg;
      // Embedded cap/floor on the coupon: expected capped/floored rate
      // E[min(max(L, floor), cap)] = L + floorlet − caplet (Bachelier) for unfixed
      // periods; intrinsic once the rate is fixed.
      if (fl.capRate !== undefined || fl.floorRate !== undefined) {
        const collared = expectedCollaredRate(ctx, fl, p, rate, isFixed, warnings);
        if (accrued !== undefined && rate !== 0) accrued *= collared / rate;
        rate = collared;
      }
    }
    const amount = sign * n * rate * tau;
    cashflows.push({
      legIndex,
      legType: leg.type,
      currency: leg.currency,
      accrualStart: p.accrualStart,
      accrualEnd: p.accrualEnd,
      paymentDate: p.paymentDate,
      fixingDate: leg.type === "Float" ? p.fixingDate : undefined,
      notional: n,
      rate,
      accrualFactor: tau,
      amount,
      discountFactor: df,
      presentValue: amount * df,
      isFixed,
      accrued,
      kind: "Interest",
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
            legIndex,
            legType: leg.type,
            currency: leg.currency,
            paymentDate: p.paymentDate,
            notional: diff,
            amount: amt,
            discountFactor: df,
            presentValue: amt * df,
            kind: "Notional",
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
        legIndex,
        legType: leg.type,
        currency: leg.currency,
        paymentDate: last.paymentDate,
        notional: nLast,
        amount,
        discountFactor: df,
        presentValue: amount * df,
        kind: "Notional",
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

/**
 * Accrued interest of a leg at valuation date (signed, leg currency). Uses
 * the period's realised accrual (compounded to date for RFR legs) when the
 * pricer provided it, else rate × accrued year fraction.
 */
export function legAccrued(ctx: MarketContext, leg: SwapLeg, legResult: LegResult): number {
  const val = ctx.valuationDate;
  const cf = legResult.cashflows.find((c) => c.kind === "Interest" && c.accrualStart !== undefined && c.accrualStart <= val && c.accrualEnd! > val);
  if (!cf) return 0;
  if (cf.accrued !== undefined) return cf.accrued;
  if (cf.rate === undefined) return 0;
  const tauAccr = yearFraction(cf.accrualStart!, val, leg.dayCount);
  return legSign(leg) * cf.notional * cf.rate * tauAccr;
}

/**
 * Coupon periods of a leg with all of its conventions (business-day rule,
 * stub, EOM, roll, payment lag) – the same schedule `priceLeg` prices.
 */
export function legPeriods(leg: SwapLeg): SchedulePeriod[] {
  return buildSchedule({
    effectiveDate: leg.effectiveDate,
    terminationDate: leg.terminationDate,
    frequency: leg.frequency,
    calendar: leg.calendar,
    businessDayConvention: leg.businessDayConvention ?? "ModifiedFollowing",
    stub: leg.stub ?? "ShortFront",
    endOfMonth: leg.endOfMonth ?? false,
    roll: leg.roll,
    paymentLag: leg.paymentLag ?? 0,
  }).periods;
}

/** Adjusted accrual end dates of a leg (payment lag ignored – kept for backward compatibility). */
export function scheduleDates(leg: SwapLeg): SerialDate[] {
  return buildSchedule({
    effectiveDate: leg.effectiveDate,
    terminationDate: leg.terminationDate,
    frequency: leg.frequency,
    calendar: leg.calendar,
    businessDayConvention: leg.businessDayConvention ?? "ModifiedFollowing",
    stub: leg.stub ?? "ShortFront",
    endOfMonth: leg.endOfMonth ?? false,
    roll: leg.roll,
  }).periods.map((p) => p.paymentDate);
}
