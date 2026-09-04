import { toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { type Cashflow, type FxForward, type FxOption, type FxSwap, type LegResult, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { fxRateAtValuationDate, fxSpotDate, fxSpotDateFrom, pipFactor } from "../market/fx-spot.js";
import { type FxOptionInputs, fxBarrier, fxDigital, fxExoticGreeks, garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { fxVolAtStrike } from "../models/fx-vol-surface.js";

export function splitPair(pair: string): { base: string; quote: string } {
  const p = pair.replace("/", "").toUpperCase();
  if (p.length !== 6) throw new Error(`Invalid FX pair: ${pair}`);
  return { base: p.slice(0, 3), quote: p.slice(3) };
}

/**
 * Theoretical forward rate (base/quote) for delivery on `date`, anchored at
 * the pair's spot date t_s (spot settles T+2):
 * F(T) = S · [DF_base(T) / DF_base(t_s)] / [DF_quote(T) / DF_quote(t_s)].
 * For `date` before the spot date this yields the corresponding "today" rate.
 */
export function fxForwardRate(ctx: MarketContext, base: string, quote: string, date: number, collateral?: string): number {
  const spot = getFxSpot(ctx, base, quote);
  const ts = fxSpotDate(ctx, base, quote);
  const dB = getDiscountCurve(ctx, base, collateral);
  const dQ = getDiscountCurve(ctx, quote, collateral);
  return (spot * (dB.df(date) / dB.df(ts))) / (dQ.df(date) / dQ.df(ts));
}

/** Warning prefix for an FX leg that settles on the valuation date (valued as a value-today exchange, R4-2). */
export const SETTLES_TODAY_PREFIX = "SETTLES_TODAY:";

/**
 * One FX exchange (a forward or one leg of an FX swap). Settlement
 * convention (R4-2): a leg delivering *after* the valuation date is
 * discounted; a leg delivering *on* the valuation date is a value-today
 * exchange – both amounts count at the today rate (DF 1), the fair rate is
 * the value-today rate `fxRateAtValuationDate` and a `SETTLES_TODAY:` warning
 * is raised; a leg delivered *before* the valuation date is excluded (PV 0)
 * with the "already delivered" warning.
 */
function forwardLeg(
  ctx: MarketContext,
  leg: Omit<FxForward, "type" | "id">,
  legIndex: number,
  reporting: string,
  collateral: string | undefined,
  label: string,
): { legs: LegResult[]; pv: number; fair: number; points: number; spot: number; warnings: string[] } {
  const val = ctx.valuationDate;
  const settlesToday = leg.deliveryDate === val;
  const delivered = leg.deliveryDate < val;
  const dfOf = (ccy: string) => (delivered ? 0 : settlesToday ? 1 : getDiscountCurve(ctx, ccy, collateral).df(leg.deliveryDate));
  const dfBuy = dfOf(leg.buyCurrency);
  const dfSell = dfOf(leg.sellCurrency);
  const warnings: string[] = [];
  if (settlesToday) {
    warnings.push(
      `${SETTLES_TODAY_PREFIX} ${label} settles on the valuation date ${toISO(val)} – valued as a value-today exchange at the today rate (not discounted)`,
    );
  } else if (delivered) {
    warnings.push(`${label} already delivered (${toISO(leg.deliveryDate)}) – excluded from the PV`);
  }
  // PVs are discounted to today → convert with the today rate (spot adjusted to the valuation date).
  const fxBuy = fxRateAtValuationDate(ctx, leg.buyCurrency, reporting, collateral);
  const fxSell = fxRateAtValuationDate(ctx, leg.sellCurrency, reporting, collateral);
  const cfBuy: Cashflow = {
    legIndex,
    legType: "FX Buy",
    currency: leg.buyCurrency,
    paymentDate: leg.deliveryDate,
    notional: leg.buyAmount,
    amount: leg.buyAmount,
    discountFactor: dfBuy,
    presentValue: leg.buyAmount * dfBuy,
    kind: "Notional",
  };
  const cfSell: Cashflow = {
    legIndex: legIndex + 1,
    legType: "FX Sell",
    currency: leg.sellCurrency,
    paymentDate: leg.deliveryDate,
    notional: leg.sellAmount,
    amount: -leg.sellAmount,
    discountFactor: dfSell,
    presentValue: -leg.sellAmount * dfSell,
    kind: "Notional",
  };
  const pv = cfBuy.presentValue * fxBuy + cfSell.presentValue * fxSell;
  const spot = getFxSpot(ctx, leg.buyCurrency, leg.sellCurrency);
  // Fair rate: forward for future delivery, value-today rate for delivery on/before the valuation date.
  const fair =
    leg.deliveryDate > val
      ? fxForwardRate(ctx, leg.buyCurrency, leg.sellCurrency, leg.deliveryDate, collateral)
      : fxRateAtValuationDate(ctx, leg.buyCurrency, leg.sellCurrency, collateral);
  return {
    warnings,
    legs: [
      { legIndex, legType: "FX Buy", currency: leg.buyCurrency, pv: cfBuy.presentValue, pvReporting: cfBuy.presentValue * fxBuy, cashflows: [cfBuy] },
      {
        legIndex: legIndex + 1,
        legType: "FX Sell",
        currency: leg.sellCurrency,
        pv: cfSell.presentValue,
        pvReporting: cfSell.presentValue * fxSell,
        cashflows: [cfSell],
      },
    ],
    pv,
    fair,
    points: (fair - spot) * pipFactor(leg.buyCurrency, leg.sellCurrency),
    spot,
  };
}

/**
 * Linear FX delta amount of forward legs: PV change (reporting currency) when
 * `ccyUp` appreciates by 1 % against every other currency. A leg denominated
 * in `ccyUp` moves by +1 % of its reporting PV; when `ccyUp` is the reporting
 * currency itself every foreign leg moves by −1 % of its reporting PV (linear
 * approximation of 1/1.01). Same convention as `RiskReport.fxDelta` and the
 * FX option's `deltaAmount` (base currency +1 %).
 */
export function linearFxDeltaAmount(legs: LegResult[], ccyUp: string, reporting: string): number {
  let d = 0;
  for (const l of legs) {
    if (ccyUp !== reporting && l.currency === ccyUp) d += l.pvReporting * 0.01;
    else if (ccyUp === reporting && l.currency !== reporting) d -= l.pvReporting * 0.01;
  }
  return d;
}

/**
 * FX delta convention (analytics `fxDelta`, `fxDeltaSellCurrency`): PV change
 * in reporting currency when the named currency appreciates by 1% against the
 * reporting currency (positive = we gain when that currency strengthens).
 * For a forward the PV is linear in the spot, so the delta of currency c is
 * 1% of the reporting-currency PV of the leg denominated in c.
 */
export function priceFxForward(ctx: MarketContext, trade: FxForward, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.sellCurrency;
  const r = forwardLeg(ctx, trade, 0, reporting, trade.collateralCurrency, "FX forward");
  const contractRate = trade.sellAmount / trade.buyAmount;
  const buyIsForeign = trade.buyCurrency !== reporting;
  const sellIsForeign = trade.sellCurrency !== reporting;
  const deltaBuy = buyIsForeign ? r.legs[0]!.pvReporting * 0.01 : 0;
  const deltaSell = sellIsForeign ? r.legs[1]!.pvReporting * 0.01 : 0;
  const primaryCcy = buyIsForeign ? trade.buyCurrency : trade.sellCurrency;
  const spotDate = fxSpotDate(ctx, trade.buyCurrency, trade.sellCurrency);
  return {
    tradeId: trade.id,
    tradeType: "FxForward",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv: r.pv,
    legs: r.legs,
    analytics: {
      contractRate,
      fairForward: r.fair,
      forwardPoints: r.points,
      spot: r.spot,
      /** Spot rate adjusted for value on the valuation date (used for PV conversion). */
      spotAtValuationDate: fxRateAtValuationDate(ctx, trade.buyCurrency, trade.sellCurrency, trade.collateralCurrency),
      /** PV change (reporting ccy) for +1% appreciation of `fxDeltaCurrency` vs reporting. */
      fxDelta: buyIsForeign ? deltaBuy : deltaSell,
      fxDeltaCurrency: primaryCcy,
      /** Set when both currencies differ from the reporting currency: delta of the sold currency. */
      fxDeltaSellCurrency: buyIsForeign && sellIsForeign ? deltaSell : undefined,
      /**
       * PV change (reporting ccy) for +1 % spot of the buy currency against the
       * sell currency – linear: ±(reporting PV of the leg in the moving currency) × 1 %.
       * Same contract as the FX option's `deltaAmount` (see `PricingResult.analytics`).
       */
      deltaAmount: linearFxDeltaAmount(r.legs, trade.buyCurrency, reporting),
      ndf: trade.ndf ? "yes" : "no",
    },
    /** Spot settlement date (T+2 / T+1 on the pair calendar), ISO. */
    details: { spotDate: toISO(spotDate) },
    warnings: r.warnings,
  };
}

/**
 * FX swap = near leg + far leg, each priced like a forward (`forwardLeg`). A
 * near leg settling on the valuation date (value-today / O/N swap) is a
 * value-today exchange: `nearFairForward` is the value-today rate, the
 * off-market near amount enters the PV and a `SETTLES_TODAY:` warning is
 * raised (R4-2); legs delivered before the valuation date are excluded with a
 * warning. Leg warnings are passed through.
 */
export function priceFxSwap(ctx: MarketContext, trade: FxSwap, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.nearLeg.sellCurrency;
  const near = forwardLeg(ctx, trade.nearLeg, 0, reporting, trade.collateralCurrency, "FX swap near leg");
  const far = forwardLeg(ctx, trade.farLeg, 2, reporting, trade.collateralCurrency, "FX swap far leg");
  // Express the far leg's fair forward in the near leg's quotation (buy ccy per sell ccy).
  const farFair = trade.farLeg.buyCurrency === trade.nearLeg.buyCurrency ? far.fair : 1 / far.fair;
  return {
    tradeId: trade.id,
    tradeType: "FxSwap",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv: near.pv + far.pv,
    legs: [...near.legs, ...far.legs],
    analytics: {
      nearFairForward: near.fair,
      farFairForward: farFair,
      swapPoints: (farFair - near.fair) * pipFactor(trade.nearLeg.buyCurrency, trade.nearLeg.sellCurrency),
      nearPv: near.pv,
      farPv: far.pv,
      /** PV change (reporting ccy) for +1 % spot of the near-leg buy currency, both legs (linear, see `PricingResult.analytics`). */
      deltaAmount: linearFxDeltaAmount([...near.legs, ...far.legs], trade.nearLeg.buyCurrency, reporting),
    },
    details: { spotDate: toISO(fxSpotDate(ctx, trade.nearLeg.buyCurrency, trade.nearLeg.sellCurrency)) },
    warnings: [...near.warnings, ...far.warnings],
  };
}

/**
 * FX vanilla / barrier / digital option (Garman–Kohlhagen, Reiner–Rubinstein).
 *
 * Rates: r_d = −ln DF_quote(T)/T; the forward is anchored at the spot date
 * (see `fxForwardRate`) and r_f chosen so that S·e^{(r_d − r_f)T} reproduces
 * it, i.e. e^{−r_f T} = DF_base(T)·DF_quote(t_s)/DF_base(t_s). Premiums are
 * PVs in quote currency and converted to the reporting currency at the
 * today rate. Greeks of barriers and digitals are finite differences of the
 * closed forms (`analytics.greeksMethod`), vanilla Greeks are analytic.
 *
 * Non-standard delivery (R3-9): when `deliveryDate` is not the spot date of
 * the expiry, the barrier drift and the discounting of a rebate paid at the
 * hit are taken from the curves on the expiry horizon (`rdExpiry`/`rfExpiry`
 * = rates to the standard delivery of the expiry), so the extra carry of the
 * longer lag only enters the payoff discount and the delivery forward.
 */
export function priceFxOption(ctx: MarketContext, trade: FxOption, reportingCurrency?: string): PricingResult {
  const { base, quote } = splitPair(trade.pair);
  const reporting = reportingCurrency ?? quote;
  const val = ctx.valuationDate;
  const spot = getFxSpot(ctx, base, quote);
  const spotDate = fxSpotDate(ctx, base, quote);
  const tExp = Math.max(0, yearFraction(val, trade.expiryDate, "ACT/365F"));
  const tDel = Math.max(tExp, yearFraction(val, trade.deliveryDate, "ACT/365F"));
  const dfQ = trade.deliveryDate > val ? getDiscountCurve(ctx, quote, trade.collateralCurrency).df(trade.deliveryDate) : 1;
  const forward = fxForwardRate(ctx, base, quote, Math.max(trade.deliveryDate, val), trade.collateralCurrency);
  // Effective foreign discount factor consistent with the spot-anchored forward.
  const dfF = (dfQ * forward) / spot;
  const rd = tDel > 0 ? -Math.log(dfQ) / tDel : 0;
  const rf = tDel > 0 ? -Math.log(dfF) / tDel : 0;
  const warnings: string[] = [];
  const surface = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
  let vol = trade.volOverride;
  if (vol === undefined) {
    if (surface) {
      const inverted = !ctx.fxVols?.[`${base}${quote}`];
      vol = inverted
        ? fxVolAtStrike(surface, tExp, 1 / forward, 1 / trade.strike, { dfForeign: dfQ })
        : fxVolAtStrike(surface, tExp, forward, trade.strike, { dfForeign: dfF });
    } else {
      vol = 0.08;
      warnings.push("No FX vol surface – using 8% vol");
    }
  }
  const inputs: FxOptionInputs = { type: trade.optionType, spot, strike: trade.strike, vol, timeToExpiry: tExp, timeToDelivery: tDel, rd, rf };
  // Expiry-horizon rates for barriers with a non-standard delivery lag (see doc comment).
  const standardDelivery = fxSpotDateFrom(trade.expiryDate, base, quote);
  let deliveryConvention = "standard";
  if (trade.barrier && tExp > 0 && trade.deliveryDate !== standardDelivery && standardDelivery > val) {
    const dfQStd = getDiscountCurve(ctx, quote, trade.collateralCurrency).df(standardDelivery);
    const fwdStd = fxForwardRate(ctx, base, quote, standardDelivery, trade.collateralCurrency);
    inputs.rdExpiry = -Math.log(dfQStd) / tExp;
    inputs.rfExpiry = inputs.rdExpiry - Math.log(fwdStd / spot) / tExp;
    deliveryConvention = "non-standard";
  }
  const gk = garmanKohlhagen(inputs);
  let premiumPerUnit = gk.premiumDomestic;
  let kind = "Vanilla";
  let greeks = {
    spotDelta: gk.spotDelta,
    gamma: gk.gamma,
    vega: gk.vega,
    theta: gk.theta,
    rhoDomestic: gk.rhoDomestic,
    rhoForeign: gk.rhoForeign,
  };
  let greeksMethod = "analytic";
  if (trade.barrier) {
    const b = trade.barrier;
    const priceFn = (i: FxOptionInputs) => fxBarrier({ ...i, barrier: b.level, barrierType: b.type, rebate: b.rebate });
    premiumPerUnit = priceFn(inputs);
    greeks = fxExoticGreeks(priceFn, inputs, { barrier: b.level });
    greeksMethod = "finite-difference";
    kind = `Barrier ${b.type}`;
  } else if (trade.digital) {
    const payoutCcy = trade.digital.payoutCurrency.toUpperCase();
    const payoutInBase = payoutCcy === base;
    // Payout in a third currency: converted to quote at the forward for the delivery date.
    const payoutFx = payoutInBase || payoutCcy === quote ? 1 : fxForwardRate(ctx, payoutCcy, quote, trade.deliveryDate, trade.collateralCurrency);
    const scalePayout = (trade.digital.payout * payoutFx) / (trade.notional || 1);
    const priceFn = (i: FxOptionInputs) => fxDigital(i, payoutInBase) * scalePayout;
    premiumPerUnit = priceFn(inputs);
    greeks = fxExoticGreeks(priceFn, inputs);
    greeksMethod = "finite-difference";
    kind = payoutInBase ? "Digital (asset-or-nothing, base payout)" : "Digital (cash-or-nothing)";
  }
  const longShort = trade.payReceive === "Receive" ? 1 : -1;
  const fxQ = fxRateAtValuationDate(ctx, quote, reporting, trade.collateralCurrency);
  const pvQuote = longShort * trade.notional * premiumPerUnit;
  let pv = pvQuote * fxQ;
  if (trade.upfront && trade.upfront.date > val) {
    const d2 = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    const fxu = fxRateAtValuationDate(ctx, trade.upfront.currency, reporting, trade.collateralCurrency);
    pv -= trade.upfront.amount * d2.df(trade.upfront.date) * fxu;
  }
  const scale = longShort * trade.notional * fxQ;
  // PV change (reporting ccy) for a +1 % spot move of the base currency vs the quote currency.
  const deltaAmount = scale * greeks.spotDelta * spot * 0.01;
  return {
    tradeId: trade.id,
    tradeType: "FxOption",
    valuationDate: val,
    currency: reporting,
    pv,
    legs: [
      {
        legIndex: 0,
        legType: `${kind} ${trade.optionType} ${base}${quote}`,
        currency: quote,
        pv: pvQuote,
        pvReporting: pvQuote * fxQ,
        cashflows: [
          {
            legIndex: 0,
            legType: kind,
            currency: quote,
            paymentDate: trade.deliveryDate,
            notional: trade.notional,
            rate: trade.strike,
            amount: pvQuote / dfQ,
            discountFactor: dfQ,
            presentValue: pvQuote,
            kind: "OptionPayoff",
          },
        ],
      },
    ],
    analytics: {
      kind,
      spot,
      spotAtValuationDate: fxRateAtValuationDate(ctx, base, quote, trade.collateralCurrency),
      forward,
      strike: trade.strike,
      volatility: vol,
      expiryYears: tExp,
      rd,
      rf,
      premiumQuotePerUnit: premiumPerUnit,
      premiumPctBase: (premiumPerUnit / spot) * 100,
      premiumPipsQuote: premiumPerUnit * pipFactor(base, quote),
      /** Spot delta in base currency units (∂PV/∂S × notional). */
      deltaBase: longShort * trade.notional * greeks.spotDelta,
      /** PV change (reporting ccy) for a +1 % spot move, i.e. base currency appreciates 1 % vs quote – a money amount. */
      deltaAmount,
      /**
       * Delta as a fraction of the notional: deltaAmount / (1 % of the notional in
       * reporting currency) = signed spot delta (long call ≈ +0.5 ATM, short put ≈ +0.5,
       * long put ≈ −0.5); in [−1, 1] for vanillas. Formerly (pre 0.3) this key held
       * the money amount now reported as `deltaAmount`.
       */
      deltaPct: longShort * greeks.spotDelta,
      gamma: scale * greeks.gamma * spot * spot * 0.0001,
      /** Vega per 1 vol point */
      vega: scale * greeks.vega * 0.01,
      thetaPerDay: (scale * greeks.theta) / 365,
      rhoDomestic: scale * greeks.rhoDomestic * 0.0001,
      rhoForeign: scale * greeks.rhoForeign * 0.0001,
      greeksMethod,
      d1: gk.d1,
      d2: gk.d2,
      /** "standard" when delivery = spot date of the expiry; barriers with a "non-standard" lag use expiry-horizon drift/rebate rates (R3-9). */
      deliveryConvention,
    },
    /** Spot settlement date (T+2 / T+1 on the pair calendar), ISO; `standardDelivery` = spot date of the expiry. */
    details: { spotDate: toISO(spotDate), standardDelivery: toISO(standardDelivery) },
    warnings,
  };
}
