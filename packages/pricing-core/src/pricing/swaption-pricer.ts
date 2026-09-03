import { yearFraction } from "../dates/daycount.js";
import { frequencyPerYear } from "../dates/schedule.js";
import { type FixedLeg, type PricingResult, type Swaption } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { bachelierGreeks, black76Greeks } from "../models/black.js";
import { swaptionVol } from "../models/vol-surfaces.js";
import { priceInterestRateSwap } from "./swap-pricer.js";

/**
 * European swaption priced with Bachelier (default), Black or shifted Black
 * on the forward swap rate. Physical settlement uses the discount annuity;
 * cash settlement (EUR legacy convention) uses the yield-based cash annuity.
 */
export function priceSwaption(ctx: MarketContext, trade: Swaption, reportingCurrency?: string): PricingResult {
  const swap = trade.underlying;
  const fixed = swap.legs.find((l): l is FixedLeg => l.type === "Fixed");
  if (!fixed) throw new Error("Swaption underlying must have a fixed leg");
  const ccy = fixed.currency;
  const reporting = reportingCurrency ?? ccy;
  const fx = ccy === reporting ? 1 : getFxSpot(ctx, ccy, reporting);
  const warnings: string[] = [];
  // Forward swap analytics: price the underlying with valuation context.
  const swapRes = priceInterestRateSwap(ctx, swap, ccy);
  const forward = swapRes.analytics.parRate as number | undefined;
  const annuityDisc = (swapRes.analytics.annuity as number | undefined) ?? 0;
  if (forward === undefined) throw new Error("Cannot derive forward swap rate");
  const strike = fixed.rate;
  const tExp = Math.max(0, yearFraction(ctx.valuationDate, trade.expiryDate, "ACT/365F"));
  const tenorYears = yearFraction(fixed.effectiveDate, fixed.terminationDate, "ACT/365F");
  const surface = ctx.swaptionVols?.[ccy];
  const model = trade.model ?? (surface?.volType === "Lognormal" ? "Black" : surface?.volType === "ShiftedLognormal" ? "ShiftedBlack" : "Bachelier");
  const shift = trade.shift ?? surface?.shift ?? 0;
  let vol = trade.volOverride;
  if (vol === undefined) {
    if (surface) vol = swaptionVol(surface, tExp, tenorYears, forward, strike);
    else {
      vol = 0.007;
      warnings.push("No swaption vol surface – using 70bp normal vol");
    }
  }
  // Payer swaption = call on the swap rate.
  const optType = trade.payerReceiver === "Payer" ? "Call" : "Put";
  let annuity = annuityDisc / (fixed.notional || 1);
  if (trade.settlement === "Cash") {
    const m = frequencyPerYear(fixed.frequency);
    const n = Math.round(tenorYears * m);
    const disc = getDiscountCurve(ctx, ccy, trade.collateralCurrency);
    let cashAnnuity = 0;
    for (let i = 1; i <= n; i++) cashAnnuity += 1 / m / Math.pow(1 + forward / m, i);
    annuity = cashAnnuity * disc.df(trade.expiryDate);
  }
  const g =
    model === "Bachelier"
      ? bachelierGreeks(optType, forward, strike, vol, tExp)
      : model === "ShiftedBlack"
        ? black76Greeks(optType, forward + shift, strike + shift, vol, tExp)
        : black76Greeks(optType, forward, strike, vol, tExp);
  const longShort = trade.payReceive === "Receive" ? 1 : -1;
  const notional = fixed.notional;
  const pvCcy = longShort * notional * annuity * g.price;
  let pv = pvCcy * fx;
  if (trade.upfront && trade.upfront.date > ctx.valuationDate) {
    const d2 = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    const fxu = trade.upfront.currency === reporting ? 1 : getFxSpot(ctx, trade.upfront.currency, reporting);
    pv -= trade.upfront.amount * d2.df(trade.upfront.date) * fxu;
  }
  const expired = trade.expiryDate <= ctx.valuationDate;
  if (expired) warnings.push("Swaption expired – intrinsic value shown");
  return {
    tradeId: trade.id,
    tradeType: "Swaption",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv,
    legs: [
      {
        legIndex: 0,
        legType: `${trade.payerReceiver} swaption`,
        currency: ccy,
        pv: pvCcy,
        pvReporting: pvCcy * fx,
        annuity: annuity * notional,
        cashflows: [
          {
            legIndex: 0, legType: "Swaption", currency: ccy, paymentDate: trade.expiryDate, notional,
            rate: forward, amount: longShort * notional * annuity * g.price, discountFactor: 1,
            presentValue: pvCcy, kind: "OptionPayoff",
          },
        ],
      },
    ],
    analytics: {
      model,
      forwardSwapRate: forward,
      strike,
      volatility: vol,
      expiryYears: tExp,
      tenorYears,
      annuity: annuity * notional,
      /** Forward premium in bp of notional */
      premiumBp: (annuity * g.price) * 1e4,
      delta: longShort * notional * annuity * g.delta * fx,
      gamma: longShort * notional * annuity * g.gamma * fx,
      /** Vega per 1bp normal vol / 1% lognormal */
      vega: longShort * notional * annuity * g.vega * fx * (model === "Bachelier" ? 1e-4 : 0.01),
      thetaPerDay: (longShort * notional * annuity * g.theta * fx) / 365,
      underlyingPv: swapRes.pv * fx,
    },
    warnings,
  };
}
