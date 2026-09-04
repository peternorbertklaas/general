import { type Cashflow, type LegResult, type TradeBase } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve } from "../market/market-context.js";
import { fxToReporting } from "./leg-pricer.js";

/** `LegResult.legType` of the upfront premium leg (N6-1). */
export const UPFRONT_LEG_TYPE = "Upfront premium";

/**
 * Upfront premium / fee of a trade as a `Cashflow` of kind `"Premium"` in its
 * own leg (N6-1). Before round 6 the pricers subtracted the discounted premium
 * from the PV without listing it, so the theta single-count rule
 * (`splitCashflowsWithin`) did not know about it and the 1-day theta on the
 * day before the premium payment was ≈ +premium (the premium fell out of
 * PV(t + 1) without being counted as paid).
 *
 * Contract: `amount = −upfront.amount` (positive = we receive), discounted
 * with the premium currency's discount curve under the trade's CSA while the
 * payment date is after the valuation date; on or before the valuation date
 * the premium is settled – DF 0, PV 0 – exactly as the pricers treated it
 * before (`upfront.date > valuationDate`), so PVs are unchanged. The leg is
 * appended as the **last** leg with `legIndex` = number of economic legs, so
 * consumers reading `legs[0]` (hedge intrinsic value, EMIR annuity) are not
 * affected. Returns `undefined` when the trade has no upfront.
 */
export function upfrontPremiumLeg(
  ctx: MarketContext,
  trade: Pick<TradeBase, "upfront" | "collateralCurrency">,
  reporting: string,
  legIndex: number,
): { leg: LegResult; pvReporting: number } | undefined {
  const up = trade.upfront;
  if (!up) return undefined;
  const settled = up.date <= ctx.valuationDate;
  const df = settled ? 0 : getDiscountCurve(ctx, up.currency, trade.collateralCurrency).df(up.date);
  const fx = fxToReporting(ctx, up.currency, reporting, trade.collateralCurrency);
  const cf: Cashflow = {
    legIndex,
    legType: UPFRONT_LEG_TYPE,
    currency: up.currency,
    paymentDate: up.date,
    notional: Math.abs(up.amount),
    amount: -up.amount,
    discountFactor: df,
    presentValue: settled ? 0 : -up.amount * df,
    kind: "Premium",
  };
  const leg: LegResult = {
    legIndex,
    legType: UPFRONT_LEG_TYPE,
    currency: up.currency,
    pv: cf.presentValue,
    pvReporting: cf.presentValue * fx,
    cashflows: [cf],
  };
  return { leg, pvReporting: leg.pvReporting };
}
