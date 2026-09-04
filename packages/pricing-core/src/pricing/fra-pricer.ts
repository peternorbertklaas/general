import { getIndex } from "../curves/index-definitions.js";
import { addBusinessDays, getCalendar } from "../dates/calendar.js";
import { toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { PricingError } from "../errors.js";
import { type ForwardRateAgreement, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getCurve, getDiscountCurve, getFixing } from "../market/market-context.js";
import { fxToReporting, missingFixingMessage } from "./leg-pricer.js";
import { upfrontPremiumLeg } from "./upfront.js";

/**
 * FRA with ISDA-style settlement at the start date: payoff discounted over the
 * FRA period at the realised/forward rate. `payReceive: "Pay"` = pay the fixed
 * rate (receive F − K). When the index fixing date (start − fixing lag on the
 * index calendar) has passed and a fixing is loaded, the fixing replaces the
 * curve forward; a missing published fixing produces a `MISSING_FIXING:`
 * warning and the curve forward is used. An `upfront` fee is honoured as a
 * `Premium` cashflow in its own last leg (`upfrontPremiumLeg`, N7-8).
 */
export function priceFra(ctx: MarketContext, trade: ForwardRateAgreement, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.currency;
  const idx = getIndex(trade.index);
  const proj = getCurve(ctx, idx.curveId);
  const disc = getDiscountCurve(ctx, trade.currency, trade.collateralCurrency);
  const dc = trade.dayCount ?? idx.dayCount;
  const tau = yearFraction(trade.startDate, trade.endDate, dc);
  const val = ctx.valuationDate;
  const cal = getCalendar(idx.fixingCalendar);
  const fixingDate = idx.fixingLag > 0 ? addBusinessDays(trade.startDate, -idx.fixingLag, cal) : trade.startDate;
  const warnings: string[] = [];
  const fixing = fixingDate <= val ? getFixing(ctx, idx.name, fixingDate) : undefined;
  let fwd: number;
  let isFixed = false;
  if (fixing !== undefined) {
    fwd = fixing;
    isFixed = true;
  } else {
    fwd = proj.forwardRate(trade.startDate, trade.endDate, idx.dayCount);
    if (fixingDate < val && trade.startDate > val) {
      const message = missingFixingMessage(idx.name, fixingDate, "FRA settled on the curve forward");
      if ((ctx.missingFixingPolicy ?? "curve") === "throw") throw new PricingError("MISSING_FIXING", message, { index: idx.name, fixingDate });
      warnings.push(message);
    }
  }
  const sign = trade.payReceive === "Pay" ? 1 : -1; // pay fixed → receive (F - K)
  const settle = trade.startDate;
  const df = settle > val ? disc.df(settle) : 0;
  const amount = (sign * trade.notional * (fwd - trade.fixedRate) * tau) / (1 + fwd * tau);
  const fx = fxToReporting(ctx, trade.currency, reporting, trade.collateralCurrency);
  // N7-8: an upfront fee on a FRA is a `Premium` cashflow in its own (last) leg, not silently ignored.
  const upfront = upfrontPremiumLeg(ctx, trade, reporting, 1);
  const pv = amount * df * fx + (upfront?.pvReporting ?? 0);
  if (settle <= val) warnings.push("FRA already settled");
  return {
    tradeId: trade.id,
    tradeType: "FRA",
    valuationDate: val,
    currency: reporting,
    pv,
    legs: [
      {
        legIndex: 0,
        legType: `FRA ${trade.index}`,
        currency: trade.currency,
        pv: amount * df,
        pvReporting: amount * df * fx,
        cashflows: [
          {
            legIndex: 0,
            legType: "FRA",
            currency: trade.currency,
            accrualStart: trade.startDate,
            accrualEnd: trade.endDate,
            paymentDate: settle,
            fixingDate,
            notional: trade.notional,
            rate: fwd,
            accrualFactor: tau,
            amount,
            discountFactor: df,
            presentValue: amount * df,
            isFixed,
            kind: "Settlement",
          },
        ],
      },
      ...(upfront ? [upfront.leg] : []),
    ],
    analytics: { forwardRate: fwd, fixedRate: trade.fixedRate, accrualFactor: tau, isFixed: isFixed ? "yes" : "no" },
    details: { fixingDate: toISO(fixingDate), settlementDate: toISO(settle) },
    warnings,
  };
}
