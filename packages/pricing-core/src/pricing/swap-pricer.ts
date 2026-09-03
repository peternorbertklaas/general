import { type SerialDate } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { type MarketContext, getFxSpot } from "../market/market-context.js";
import {
  type CrossCurrencySwap,
  type FixedLeg,
  type FloatLeg,
  type InterestRateSwap,
  type PricingResult,
  type SwapLeg,
} from "../instruments/types.js";
import { legAccrued, priceLeg, scheduleDates } from "./leg-pricer.js";
import { getDiscountCurve } from "../market/market-context.js";

export interface SwapAnalytics {
  parRate?: number;
  fairSpread?: number;
  fixedRate?: number;
  annuity?: number;
  pvFixed?: number;
  pvFloat?: number;
  maturity?: SerialDate;
  remainingYears?: number;
}

function fixedLegs(legs: SwapLeg[]): FixedLeg[] {
  return legs.filter((l): l is FixedLeg => l.type === "Fixed");
}
function floatLegs(legs: SwapLeg[]): FloatLeg[] {
  return legs.filter((l): l is FloatLeg => l.type === "Float");
}

export function priceInterestRateSwap(
  ctx: MarketContext,
  trade: InterestRateSwap,
  reportingCurrency?: string,
): PricingResult {
  const t0 = performance.now();
  const reporting = reportingCurrency ?? trade.legs[0]!.currency;
  const warnings: string[] = [];
  const legResults = trade.legs.map((leg, i) => {
    const r = priceLeg(ctx, leg, i, { reportingCurrency: reporting, collateralCurrency: trade.collateralCurrency });
    warnings.push(...r.warnings);
    return r.result;
  });
  let pv = legResults.reduce((s, l) => s + l.pvReporting, 0);
  // Upfront payment
  if (trade.upfront && trade.upfront.date > ctx.valuationDate) {
    const disc = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    const fx = trade.upfront.currency === reporting ? 1 : getFxSpot(ctx, trade.upfront.currency, reporting);
    pv -= trade.upfront.amount * disc.df(trade.upfront.date) * fx;
  }
  const analytics: Record<string, number | string | undefined> = {};
  const fixed = fixedLegs(trade.legs);
  const floats = floatLegs(trade.legs);
  const maturity = Math.max(...trade.legs.map((l) => l.terminationDate));
  analytics.maturity = maturity;
  analytics.remainingYears = yearFraction(ctx.valuationDate, maturity, "ACT/365F");

  if (fixed.length === 1 && floats.length >= 1) {
    const fixedIdx = trade.legs.indexOf(fixed[0]!);
    const fixedRes = legResults[fixedIdx]!;
    const annuity = fixedRes.annuity ?? 0;
    const sFixed = fixed[0]!.payReceive === "Receive" ? 1 : -1;
    const pvOthers = legResults.filter((_, i) => i !== fixedIdx).reduce((s, l) => s + l.pvReporting, 0);
    const fxFixed = fixed[0]!.currency === reporting ? 1 : getFxSpot(ctx, fixed[0]!.currency, reporting);
    if (annuity > 0) {
      analytics.parRate = -pvOthers / (sFixed * annuity * fxFixed);
    }
    analytics.fixedRate = fixed[0]!.rate;
    analytics.annuity = annuity;
    analytics.pvFixed = fixedRes.pvReporting;
    analytics.pvFloat = pvOthers;
    // Fair spread on the (first) float leg that would zero the PV.
    const fl = floats[0]!;
    const flIdx = trade.legs.indexOf(fl);
    const flRes = legResults[flIdx]!;
    const flAnnuity = flRes.annuity ?? 0;
    const sFloat = fl.payReceive === "Receive" ? 1 : -1;
    const fxFl = fl.currency === reporting ? 1 : getFxSpot(ctx, fl.currency, reporting);
    if (flAnnuity > 0) {
      analytics.fairSpread = (fl.spread ?? 0) - pv / (sFloat * flAnnuity * fxFl);
    }
  } else if (floats.length === 2 && fixed.length === 0) {
    // Basis swap: fair spread on leg 0
    const fl = floats[0]!;
    const flRes = legResults[0]!;
    const sFloat = fl.payReceive === "Receive" ? 1 : -1;
    const fxFl = fl.currency === reporting ? 1 : getFxSpot(ctx, fl.currency, reporting);
    if ((flRes.annuity ?? 0) > 0) analytics.fairSpread = (fl.spread ?? 0) - pv / (sFloat * flRes.annuity! * fxFl);
  }

  const accrued = trade.legs.reduce((s, leg, i) => {
    const fx = leg.currency === reporting ? 1 : getFxSpot(ctx, leg.currency, reporting);
    return s + legAccrued(ctx, leg, legResults[i]!) * fx;
  }, 0);

  return {
    tradeId: trade.id,
    tradeType: trade.type,
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv,
    legs: legResults,
    analytics,
    accrued,
    warnings: Array.from(new Set(warnings)),
    timingMs: performance.now() - t0,
  };
}

/**
 * Cross-currency swap. Constant-notional CCS is priced leg-by-leg with
 * notional exchanges; MtM-resetting CCS recomputes the resetting leg's
 * notional at each period start from forward FX rates.
 */
export function priceCrossCurrencySwap(
  ctx: MarketContext,
  trade: CrossCurrencySwap,
  reportingCurrency?: string,
): PricingResult {
  const reporting = reportingCurrency ?? trade.legs[0]!.currency;
  let legs = trade.legs.map((l) => ({
    ...l,
    notionalExchange: l.notionalExchange ?? { initial: true, final: true },
  }));
  if (trade.mtmReset) {
    const ri = trade.mtmReset.resettingLegIndex;
    const reset = legs[ri]!;
    const other = legs.find((_, i) => i !== ri)!;
    const dates = scheduleDates(reset);
    const discReset = getDiscountCurve(ctx, reset.currency, trade.collateralCurrency);
    const discOther = getDiscountCurve(ctx, other.currency, trade.collateralCurrency);
    const spot = getFxSpot(ctx, other.currency, reset.currency); // 1 other = x reset
    // Notional at each accrual start = other notional × forward FX(start)
    const starts = [reset.effectiveDate, ...dates.slice(0, -1)];
    const schedule = starts.map((d) => {
      const fwd = spot * (discOther.df(d) / discReset.df(d));
      return { date: d, notional: other.notional * fwd };
    });
    legs = legs.map((l, i) =>
      i === ri ? { ...l, notionalSchedule: schedule, notionalExchange: { initial: true, final: true, interim: true } } : l,
    );
  }
  const irs: InterestRateSwap = { ...trade, type: "InterestRateSwap", legs };
  const res = priceInterestRateSwap(ctx, irs, reporting);
  return { ...res, tradeType: "CrossCurrencySwap", analytics: { ...res.analytics, mtmReset: trade.mtmReset ? "yes" : "no" } };
}
