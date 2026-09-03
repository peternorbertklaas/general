import { getIndex } from "../curves/index-definitions.js";
import { yearFraction } from "../dates/daycount.js";
import { type ForwardRateAgreement, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getCurve, getDiscountCurve, getFxSpot } from "../market/market-context.js";

/**
 * FRA with ISDA-style settlement at the start date: payoff discounted over the
 * FRA period at the realised/forward rate.
 */
export function priceFra(ctx: MarketContext, trade: ForwardRateAgreement, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.currency;
  const idx = getIndex(trade.index);
  const proj = getCurve(ctx, idx.curveId);
  const disc = getDiscountCurve(ctx, trade.currency, trade.collateralCurrency);
  const dc = trade.dayCount ?? idx.dayCount;
  const tau = yearFraction(trade.startDate, trade.endDate, dc);
  const fwd = proj.forwardRate(trade.startDate, trade.endDate, idx.dayCount);
  const sign = trade.payReceive === "Pay" ? 1 : -1; // pay fixed → receive (F - K)
  const settle = trade.startDate;
  const df = settle > ctx.valuationDate ? disc.df(settle) : 0;
  const amount = (sign * trade.notional * (fwd - trade.fixedRate) * tau) / (1 + fwd * tau);
  const fx = trade.currency === reporting ? 1 : getFxSpot(ctx, trade.currency, reporting);
  const pv = amount * df * fx;
  return {
    tradeId: trade.id,
    tradeType: "FRA",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv,
    legs: [
      {
        legIndex: 0,
        legType: `FRA ${trade.index}`,
        currency: trade.currency,
        pv: amount * df,
        pvReporting: pv,
        cashflows: [
          {
            legIndex: 0, legType: "FRA", currency: trade.currency, accrualStart: trade.startDate, accrualEnd: trade.endDate,
            paymentDate: settle, fixingDate: trade.startDate, notional: trade.notional, rate: fwd, accrualFactor: tau,
            amount, discountFactor: df, presentValue: amount * df, kind: "Settlement",
          },
        ],
      },
    ],
    analytics: { forwardRate: fwd, fixedRate: trade.fixedRate, accrualFactor: tau },
    warnings: settle <= ctx.valuationDate ? ["FRA already settled"] : [],
  };
}
