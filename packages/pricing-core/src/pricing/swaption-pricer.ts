import { yearFraction } from "../dates/daycount.js";
import { frequencyPerYear } from "../dates/schedule.js";
import { PricingError } from "../errors.js";
import { type FixedLeg, type PricingResult, type Swaption } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve } from "../market/market-context.js";
import { bachelierGreeks, black76Greeks } from "../models/black.js";
import { swaptionVol } from "../models/vol-surfaces.js";
import { convertSurfaceVol, modelForVolType, modelQuotation, sameQuotation, surfaceQuotation, volTypeConvertedWarning } from "./capfloor-pricer.js";
import { fxToReporting } from "./leg-pricer.js";
import { priceInterestRateSwap } from "./swap-pricer.js";

/**
 * European swaption priced with Bachelier (default), Black or shifted Black
 * on the forward swap rate. Physical settlement and cash settlement under the
 * "Collateralised Cash Price" convention use the discount annuity; the legacy
 * IRR cash-settlement convention uses the yield-based cash annuity discounted
 * to the settlement date (the underlying swap's start = expiry + spot lag).
 *
 * Model / surface mismatch (R3-1): a requested model whose vol quotation
 * differs from the cube's (e.g. `model: "Black"` on a normal cube) converts
 * the smile vol at (forward, strike, expiry) by price equivalence and emits a
 * `VOL_TYPE_CONVERTED` warning; a lognormal model on a non-positive shifted
 * forward/strike raises `PricingError("VOL_MODEL_INCOMPATIBLE")`. A
 * `volOverride` is read in the model's own quotation.
 */
export function priceSwaption(ctx: MarketContext, trade: Swaption, reportingCurrency?: string): PricingResult {
  const swap = trade.underlying;
  const fixedLegs = swap.legs.filter((l): l is FixedLeg => l.type === "Fixed");
  const fixed = fixedLegs[0];
  if (!fixed || fixedLegs.length !== 1) {
    throw new PricingError("INVALID_TRADE", `Swaption ${trade.id}: underlying must have exactly one fixed leg (found ${fixedLegs.length})`, {
      tradeId: trade.id,
    });
  }
  const ccy = fixed.currency;
  const reporting = reportingCurrency ?? ccy;
  const fx = fxToReporting(ctx, ccy, reporting, trade.collateralCurrency);
  const warnings: string[] = [];
  // Forward swap analytics: price the underlying with valuation context.
  const swapRes = priceInterestRateSwap(ctx, swap, ccy);
  const forward = swapRes.analytics.parRate as number | undefined;
  const annuityDisc = (swapRes.analytics.annuity as number | undefined) ?? 0;
  if (forward === undefined || !Number.isFinite(forward)) {
    throw new PricingError("INVALID_TRADE", `Swaption ${trade.id}: cannot derive the forward swap rate of the underlying (no floating leg / zero annuity)`, {
      tradeId: trade.id,
    });
  }
  const strike = fixed.rate;
  const tExp = Math.max(0, yearFraction(ctx.valuationDate, trade.expiryDate, "ACT/365F"));
  const tenorYears = yearFraction(fixed.effectiveDate, fixed.terminationDate, "ACT/365F");
  const surface = ctx.swaptionVols?.[ccy];
  const model = trade.model ?? modelForVolType(surface?.volType);
  const shift = trade.shift ?? surface?.shift ?? 0;
  const from = surfaceQuotation(surface);
  const to = modelQuotation(model, shift);
  const convert = trade.volOverride === undefined && !sameQuotation(from, to);
  let vol = trade.volOverride;
  let surfaceVol: number | undefined;
  if (vol === undefined) {
    if (surface) vol = swaptionVol(surface, tExp, tenorYears, forward, strike);
    else {
      vol = 0.007;
      warnings.push("No swaption vol surface – using 70bp normal vol");
    }
    if (convert && tExp > 0) {
      surfaceVol = vol;
      warnings.push(volTypeConvertedWarning("swaption", surface?.id ?? "(fallback 70bp normal)", from, model, to));
      vol = convertSurfaceVol(vol, from, to, forward, strike, tExp, { tradeId: trade.id, model, surfaceId: surface?.id });
    }
  }
  // Payer swaption = call on the swap rate.
  const optType = trade.payerReceiver === "Payer" ? "Call" : "Put";
  let annuity = annuityDisc / (fixed.notional || 1);
  const convention = trade.cashSettlementConvention ?? "CollateralisedCashPrice";
  if (trade.settlement === "Cash" && convention === "IRR") {
    const m = frequencyPerYear(fixed.frequency);
    const n = Math.round(tenorYears * m);
    const disc = getDiscountCurve(ctx, ccy, trade.collateralCurrency);
    let cashAnnuity = 0;
    for (let i = 1; i <= n; i++) cashAnnuity += 1 / m / Math.pow(1 + forward / m, i);
    // ISDA: cash settlement amount paid on the settlement date (swap start = expiry + spot lag).
    const settlementDate = Math.max(trade.expiryDate, fixed.effectiveDate);
    annuity = cashAnnuity * disc.df(settlementDate);
  }
  if (model !== "Bachelier" && tExp > 0 && (forward + shift <= 0 || strike + shift <= 0)) {
    warnings.push(`NEGATIVE_RATE_LOGNORMAL: ${model} model with non-positive shifted forward/strike – intrinsic value used, no time value`);
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
    const fxu = fxToReporting(ctx, trade.upfront.currency, reporting, trade.collateralCurrency);
    pv -= trade.upfront.amount * d2.df(trade.upfront.date) * fxu;
  }
  // N5-4g: on the exercise date itself the option is not expired – say so.
  if (trade.expiryDate < ctx.valuationDate) warnings.push("Swaption expired – intrinsic value shown");
  else if (trade.expiryDate === ctx.valuationDate) warnings.push("Swaption expires today – intrinsic value shown");
  const deltaAbs = longShort * notional * annuity * g.delta * fx;
  const gammaAbs = longShort * notional * annuity * g.gamma * fx;
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
            legIndex: 0,
            legType: "Swaption",
            currency: ccy,
            paymentDate: trade.expiryDate,
            notional,
            rate: forward,
            amount: longShort * notional * annuity * g.price,
            discountFactor: 1,
            presentValue: pvCcy,
            kind: "OptionPayoff",
          },
        ],
      },
    ],
    analytics: {
      model,
      settlement: trade.settlement === "Cash" ? `Cash (${convention})` : "Physical",
      forwardSwapRate: forward,
      strike,
      /** Vol used by the model, in the model's quotation (normal for Bachelier, lognormal for Black / ShiftedBlack). */
      volatility: vol,
      /** Surface vol before conversion (only when the model's quotation differs from the surface's, R3-1). */
      surfaceVolatility: surfaceVol,
      volConverted: surfaceVol !== undefined ? "yes" : "no",
      expiryYears: tExp,
      tenorYears,
      annuity: annuity * notional,
      /** Forward premium in bp of notional */
      premiumBp: annuity * g.price * 1e4,
      /** ∂PV/∂F per 1.00 (absolute) change of the forward swap rate, reporting currency (annuity-weighted). */
      delta: deltaAbs,
      /** ∂PV/∂F per 1bp change of the forward swap rate, reporting currency. */
      deltaPerBp: deltaAbs * 1e-4,
      /** ∂²PV/∂F² per 1.00². */
      gamma: gammaAbs,
      /** ∂²PV/∂F² per bp². */
      gammaPerBp2: gammaAbs * 1e-8,
      /** Vega per 1bp normal vol / 1% lognormal */
      vega: longShort * notional * annuity * g.vega * fx * (model === "Bachelier" ? 1e-4 : 0.01),
      thetaPerDay: (longShort * notional * annuity * g.theta * fx) / 365,
      underlyingPv: swapRes.pv * fx,
    },
    warnings,
  };
}
