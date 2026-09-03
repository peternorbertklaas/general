import { yearFraction } from "../dates/daycount.js";
import { type Cashflow, type FxForward, type FxOption, type FxSwap, type LegResult, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { fxBarrier, fxDigital, garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { fxVolAtStrike } from "../models/fx-vol-surface.js";

export function splitPair(pair: string): { base: string; quote: string } {
  const p = pair.replace("/", "").toUpperCase();
  if (p.length !== 6) throw new Error(`Invalid FX pair: ${pair}`);
  return { base: p.slice(0, 3), quote: p.slice(3) };
}

/** Theoretical forward rate (base/quote) implied by discount curves. */
export function fxForwardRate(ctx: MarketContext, base: string, quote: string, date: number, collateral?: string): number {
  const spot = getFxSpot(ctx, base, quote);
  const dfB = getDiscountCurve(ctx, base, collateral).df(date);
  const dfQ = getDiscountCurve(ctx, quote, collateral).df(date);
  return (spot * dfB) / dfQ;
}

function forwardLeg(
  ctx: MarketContext,
  leg: Omit<FxForward, "type" | "id">,
  legIndex: number,
  reporting: string,
  collateral?: string,
): { legs: LegResult[]; pv: number; fair: number; points: number } {
  const val = ctx.valuationDate;
  const dfBuy = leg.deliveryDate > val ? getDiscountCurve(ctx, leg.buyCurrency, collateral).df(leg.deliveryDate) : 0;
  const dfSell = leg.deliveryDate > val ? getDiscountCurve(ctx, leg.sellCurrency, collateral).df(leg.deliveryDate) : 0;
  const fxBuy = leg.buyCurrency === reporting ? 1 : getFxSpot(ctx, leg.buyCurrency, reporting);
  const fxSell = leg.sellCurrency === reporting ? 1 : getFxSpot(ctx, leg.sellCurrency, reporting);
  const cfBuy: Cashflow = {
    legIndex, legType: "FX Buy", currency: leg.buyCurrency, paymentDate: leg.deliveryDate, notional: leg.buyAmount,
    amount: leg.buyAmount, discountFactor: dfBuy, presentValue: leg.buyAmount * dfBuy, kind: "Notional",
  };
  const cfSell: Cashflow = {
    legIndex: legIndex + 1, legType: "FX Sell", currency: leg.sellCurrency, paymentDate: leg.deliveryDate, notional: leg.sellAmount,
    amount: -leg.sellAmount, discountFactor: dfSell, presentValue: -leg.sellAmount * dfSell, kind: "Notional",
  };
  const pv = cfBuy.presentValue * fxBuy + cfSell.presentValue * fxSell;
  const fair = leg.deliveryDate > val ? fxForwardRate(ctx, leg.buyCurrency, leg.sellCurrency, leg.deliveryDate, collateral) : getFxSpot(ctx, leg.buyCurrency, leg.sellCurrency);
  const spot = getFxSpot(ctx, leg.buyCurrency, leg.sellCurrency);
  return {
    legs: [
      { legIndex, legType: "FX Buy", currency: leg.buyCurrency, pv: cfBuy.presentValue, pvReporting: cfBuy.presentValue * fxBuy, cashflows: [cfBuy] },
      { legIndex: legIndex + 1, legType: "FX Sell", currency: leg.sellCurrency, pv: cfSell.presentValue, pvReporting: cfSell.presentValue * fxSell, cashflows: [cfSell] },
    ],
    pv,
    fair,
    points: (fair - spot) * 10000,
  };
}

export function priceFxForward(ctx: MarketContext, trade: FxForward, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.sellCurrency;
  const r = forwardLeg(ctx, trade, 0, reporting, trade.collateralCurrency);
  const contractRate = trade.sellAmount / trade.buyAmount;
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
      spot: getFxSpot(ctx, trade.buyCurrency, trade.sellCurrency),
      /** PV per 1% move in spot (reporting ccy) */
      fxDelta: r.legs[0]!.pvReporting * 0.01,
      ndf: trade.ndf ? "yes" : "no",
    },
    warnings: trade.deliveryDate <= ctx.valuationDate ? ["FX forward already delivered"] : [],
  };
}

export function priceFxSwap(ctx: MarketContext, trade: FxSwap, reportingCurrency?: string): PricingResult {
  const reporting = reportingCurrency ?? trade.nearLeg.sellCurrency;
  const near = forwardLeg(ctx, trade.nearLeg, 0, reporting, trade.collateralCurrency);
  const far = forwardLeg(ctx, trade.farLeg, 2, reporting, trade.collateralCurrency);
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
      swapPoints: (farFair - near.fair) * 10000,
      nearPv: near.pv,
      farPv: far.pv,
    },
    warnings: [],
  };
}

export function priceFxOption(ctx: MarketContext, trade: FxOption, reportingCurrency?: string): PricingResult {
  const { base, quote } = splitPair(trade.pair);
  const reporting = reportingCurrency ?? quote;
  const val = ctx.valuationDate;
  const spot = getFxSpot(ctx, base, quote);
  const tExp = Math.max(0, yearFraction(val, trade.expiryDate, "ACT/365F"));
  const tDel = Math.max(tExp, yearFraction(val, trade.deliveryDate, "ACT/365F"));
  const dfQ = getDiscountCurve(ctx, quote, trade.collateralCurrency).df(trade.deliveryDate);
  const dfB = getDiscountCurve(ctx, base, trade.collateralCurrency).df(trade.deliveryDate);
  const rd = tDel > 0 ? -Math.log(dfQ) / tDel : 0;
  const rf = tDel > 0 ? -Math.log(dfB) / tDel : 0;
  const forward = (spot * dfB) / dfQ;
  const warnings: string[] = [];
  const surface = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
  let vol = trade.volOverride;
  if (vol === undefined) {
    if (surface) {
      const inverted = !ctx.fxVols?.[`${base}${quote}`];
      vol = inverted ? fxVolAtStrike(surface, tExp, 1 / forward, 1 / trade.strike) : fxVolAtStrike(surface, tExp, forward, trade.strike);
    } else {
      vol = 0.08;
      warnings.push("No FX vol surface – using 8% vol");
    }
  }
  const inputs = { type: trade.optionType, spot, strike: trade.strike, vol, timeToExpiry: tExp, timeToDelivery: tDel, rd, rf };
  const gk = garmanKohlhagen(inputs);
  let premiumPerUnit = gk.premiumDomestic;
  let kind = "Vanilla";
  if (trade.barrier) {
    premiumPerUnit = fxBarrier({ ...inputs, barrier: trade.barrier.level, barrierType: trade.barrier.type, rebate: trade.barrier.rebate });
    kind = `Barrier ${trade.barrier.type}`;
  } else if (trade.digital) {
    // Cash-or-nothing paying `payout` units of payout currency.
    const dig = fxDigital(inputs);
    const payoutFx = trade.digital.payoutCurrency === quote ? 1 : getFxSpot(ctx, trade.digital.payoutCurrency, quote);
    premiumPerUnit = (dig * trade.digital.payout * payoutFx) / (trade.notional || 1);
    kind = "Digital";
  }
  const longShort = trade.payReceive === "Receive" ? 1 : -1;
  const fxQ = quote === reporting ? 1 : getFxSpot(ctx, quote, reporting);
  const pvQuote = longShort * trade.notional * premiumPerUnit;
  let pv = pvQuote * fxQ;
  if (trade.upfront && trade.upfront.date > val) {
    const d2 = getDiscountCurve(ctx, trade.upfront.currency, trade.collateralCurrency);
    const fxu = trade.upfront.currency === reporting ? 1 : getFxSpot(ctx, trade.upfront.currency, reporting);
    pv -= trade.upfront.amount * d2.df(trade.upfront.date) * fxu;
  }
  const scale = longShort * trade.notional * fxQ;
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
            legIndex: 0, legType: kind, currency: quote, paymentDate: trade.deliveryDate, notional: trade.notional,
            rate: trade.strike, amount: pvQuote / dfQ, discountFactor: dfQ, presentValue: pvQuote, kind: "OptionPayoff",
          },
        ],
      },
    ],
    analytics: {
      kind,
      spot,
      forward,
      strike: trade.strike,
      volatility: vol,
      expiryYears: tExp,
      rd,
      rf,
      premiumQuotePerUnit: premiumPerUnit,
      premiumPctBase: (premiumPerUnit / spot) * 100,
      premiumPipsQuote: premiumPerUnit * 10000,
      /** Spot delta in base currency units */
      deltaBase: longShort * trade.notional * gk.spotDelta,
      /** Delta in reporting currency per 1% spot move */
      deltaPct: scale * gk.spotDelta * spot * 0.01,
      gamma: scale * gk.gamma * spot * spot * 0.0001,
      /** Vega per 1 vol point */
      vega: scale * gk.vega * 0.01,
      thetaPerDay: (scale * gk.theta) / 365,
      rhoDomestic: scale * gk.rhoDomestic * 0.0001,
      rhoForeign: scale * gk.rhoForeign * 0.0001,
      d1: gk.d1,
      d2: gk.d2,
    },
    warnings,
  };
}
