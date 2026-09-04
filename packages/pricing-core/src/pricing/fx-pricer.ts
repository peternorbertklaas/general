import { toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { type Cashflow, type FxForward, type FxOption, type FxSwap, type LegResult, type PricingResult } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, getFxFixing, getFxSpot } from "../market/market-context.js";
import { fxRateAtValuationDate, fxSpotDate, fxSpotDateFrom, pipFactor } from "../market/fx-spot.js";
import { type BarrierType, type FxOptionInputs, fxBarrier, fxDigital, fxExoticGreeks, garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { fxVolAtStrike } from "../models/fx-vol-surface.js";
import { surfaceVolWarnings } from "../market/vol-validation.js";
import { PricingError } from "../errors.js";
import { upfrontPremiumLeg } from "./upfront.js";

export function splitPair(pair: string): { base: string; quote: string } {
  const p = pair.replace("/", "").toUpperCase();
  if (p.length !== 6) throw new PricingError("INVALID_TRADE", `Invalid FX pair: ${pair}`);
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
 * with the "already delivered" warning. `priceFxForward` / `priceFxSwap`
 * honour an `upfront` fee as a `Premium` leg after the exchange legs (N7-8).
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
  // N7-8: an upfront fee on a forward is a `Premium` cashflow in its own (last) leg, not silently ignored.
  const upfront = upfrontPremiumLeg(ctx, trade, reporting, 2);
  return {
    tradeId: trade.id,
    tradeType: "FxForward",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv: r.pv + (upfront?.pvReporting ?? 0),
    legs: upfront ? [...r.legs, upfront.leg] : r.legs,
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
  // N7-8: an upfront fee on an FX swap is a `Premium` cashflow in its own (last) leg, not silently ignored.
  const upfront = upfrontPremiumLeg(ctx, trade, reporting, 4);
  return {
    tradeId: trade.id,
    tradeType: "FxSwap",
    valuationDate: ctx.valuationDate,
    currency: reporting,
    pv: near.pv + far.pv + (upfront?.pvReporting ?? 0),
    legs: [...near.legs, ...far.legs, ...(upfront ? [upfront.leg] : [])],
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

/** Warning prefix for an FX option past its expiry whose delivery is still pending (N5-2). */
export const EXPIRED_PREFIX = "EXPIRED:";
/** Warning prefix for an FX option expiring on the valuation date (intrinsic value on today's rate, N5-2). */
export const EXPIRES_TODAY_PREFIX = "EXPIRES_TODAY:";
/** Warning prefix for a required historical FX fixing that is not loaded (shared with the MtM-reset CCS, R4-1). */
export const MISSING_FX_FIXING_PREFIX = "MISSING_FX_FIXING:";
/**
 * Warning prefix for a barrier option whose knock state is not recorded on the
 * trade (`barrier.hit` undefined) although it decides the value (N6-5): an
 * alive option whose spot is at or beyond the barrier (valued as knocked on
 * today's spot – Reiner–Rubinstein gives the rebate / the vanilla), or an
 * expired option whose knock state is derived from the expiry fixing alone
 * (touch events before the expiry are not observed).
 */
export const BARRIER_STATE_UNKNOWN_PREFIX = "BARRIER_STATE_UNKNOWN:";

/** Knock state of a barrier option reported in `analytics.barrierState` (N6-5). */
export type BarrierState = "alive" | "knocked-in" | "knocked-out";

/** Is the spot / fixing `s` at or beyond the barrier (continuous monitoring)? */
function beyondBarrier(b: { type: BarrierType; level: number }, s: number): boolean {
  return b.type.startsWith("Up") ? s >= b.level : s <= b.level;
}

/**
 * Lifecycle state of an FX option on the valuation date (N5-2):
 * - "alive": expiry after the valuation date – Garman–Kohlhagen / Reiner–Rubinstein value;
 * - "expires-today": expiry on the valuation date – intrinsic value on today's fixing (or spot);
 * - "expired": expired before the valuation date, delivery still pending – settled payoff;
 * - "settles-today": delivery on the valuation date – settled payoff as a value-today exchange (DF 1);
 * - "delivered": delivered before the valuation date – excluded (PV 0).
 */
export type FxOptionLifecycle = "alive" | "expires-today" | "expired" | "settles-today" | "delivered";

export function fxOptionLifecycle(trade: Pick<FxOption, "expiryDate" | "deliveryDate">, valuationDate: number): FxOptionLifecycle {
  if (trade.deliveryDate < valuationDate) return "delivered";
  if (trade.deliveryDate === valuationDate) return "settles-today";
  if (trade.expiryDate < valuationDate) return "expired";
  if (trade.expiryDate === valuationDate) return "expires-today";
  return "alive";
}

/** Payoff-currency value per unit base notional and spot delta of an option whose exercise is already decided. */
interface SettledPayoff {
  premiumPerUnit: number;
  spotDelta: number;
  /** Knock state of a barrier option (undefined for vanillas / digitals). */
  barrierState?: BarrierState;
  /** How the value arose: exercised (forward position / digital payout), a barrier rebate (or one already paid at the touch), or nothing. */
  outcome: "exercised" | "rebate" | "rebate-paid" | "none";
}

/**
 * Value of an FX option after its expiry (N5-2): the exercise / knock state is
 * decided on the expiry fixing `sFix`; an exercised vanilla is the forward
 * position at the strike delivered on the delivery date (physical delivery),
 * i.e. sign·(F_del − K)·DF_q per unit base with the linear delta sign·DF_f of
 * that forward. Digitals pay their fixed amount (cash-or-nothing: no spot
 * delta; asset-or-nothing: one unit of base per payout, delta DF_f). Barriers
 * take the knock state from `barrier.hit` when recorded (N6-5) and otherwise
 * from the fixing (no path monitoring between the trade date and the fixing
 * is available): a knocked-out option is worth its rebate, and – N7-2 – so is
 * a knock-in option whose barrier was never touched (the knock-in rebate is
 * paid at expiry when the option did not knock in, Reiner–Rubinstein term E,
 * exactly as the live model values it); both rebates are paid on the delivery
 * date (rebate·DF_q). No vega, gamma, theta or rho remain.
 */
function settledPayoff(trade: FxOption, sFix: number, forward: number, spot: number, dfQ: number, scalePayout: number): SettledPayoff {
  const sign = trade.optionType === "Call" ? 1 : -1;
  const dfF = spot > 0 ? (dfQ * forward) / spot : dfQ;
  const itm = sign * (sFix - trade.strike) > 0;
  const nothing: SettledPayoff = { premiumPerUnit: 0, spotDelta: 0, outcome: "none" };
  const exercised: SettledPayoff = itm ? { premiumPerUnit: sign * (forward - trade.strike) * dfQ, spotDelta: sign * dfF, outcome: "exercised" } : nothing;
  if (trade.digital) {
    const payoutInBase = trade.digital.payoutCurrency.toUpperCase() === splitPair(trade.pair).base;
    if (!itm) return nothing;
    return payoutInBase
      ? { premiumPerUnit: scalePayout * dfF * spot, spotDelta: scalePayout * dfF, outcome: "exercised" }
      : { premiumPerUnit: scalePayout * dfQ, spotDelta: 0, outcome: "exercised" };
  }
  if (trade.barrier) {
    const b = trade.barrier;
    const touched = b.hit ?? beyondBarrier(b, sFix);
    const isOut = b.type.endsWith("Out");
    const barrierState: BarrierState = touched ? (isOut ? "knocked-out" : "knocked-in") : "alive";
    if (isOut ? !touched : touched) return { ...exercised, barrierState };
    // Knocked out under the at-hit convention (R8): the rebate was paid when the barrier was touched – nothing left.
    if (isOut && b.rebateAt === "hit") return { premiumPerUnit: 0, spotDelta: 0, barrierState, outcome: b.rebate ? "rebate-paid" : "none" };
    // Knocked out, or knock-in never triggered: the rebate (if any) is paid on the delivery date (N7-2 / N7-5).
    const rebate = (b.rebate ?? 0) * dfQ;
    return { premiumPerUnit: rebate, spotDelta: 0, barrierState, outcome: rebate !== 0 ? "rebate" : "none" };
  }
  return exercised;
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
 *
 * Lifecycle (N5-2, `analytics.lifecycle`, `fxOptionLifecycle`): an option
 * that expired before the valuation date is valued as its settled payoff
 * (`settledPayoff`) – exercise decided on the FX fixing of the expiry date
 * (`ctx.fxFixings`, either quotation), today's spot as proxy with a
 * `MISSING_FX_FIXING:` warning when no fixing is loaded – with an `EXPIRED:`
 * warning, zero vega / gamma and the delta of the resulting forward; an
 * option expiring today uses today's fixing or spot (`EXPIRES_TODAY:`); a
 * delivery on the valuation date is a value-today exchange at DF 1
 * (`SETTLES_TODAY:`, like FX forwards); an option delivered before the
 * valuation date is excluded (PV 0, all Greeks 0, "already settled" warning)
 * – consistent with FX forwards / FRAs and the EMIR delta (0).
 *
 * Barrier knock state (N6-5, `barrier.hit`, `analytics.barrierState`): a
 * recorded `hit: true` overrides the model – knock-out → rebate valued on the
 * delivery date (Greeks 0, `greeksMethod: "settled-payoff"`), knock-in → the
 * vanilla; `hit: false` = not touched so far. Without the flag the state is
 * derived from today's spot (alive) or the expiry fixing (expired) and, when
 * that derivation decides the value, a `BARRIER_STATE_UNKNOWN:` warning is
 * raised instead of a silent 0 / vanilla.
 *
 * Rebate convention (N7-2 / N7-5, `barrier.rebateAt`, R8): a knock-in that was
 * never touched pays its rebate at expiry on every path (settled on the
 * delivery date, rebate·DF_q). Knock-out rebates follow `rebateAt`:
 * - `"expiry"`: the live model uses the expiry-rebate term (K·DF·P(hit),
 *   `fxBarrier({ rebateAtExpiry: true })`) and every decided knock – `hit: true`,
 *   today's spot at or beyond the barrier, the expiry fixing – is worth
 *   rebate·DF_q(delivery) with Greeks 0 (`greeksMethod: "settled-payoff"`):
 *   one convention, continuous across the barrier;
 * - `"hit"`: the live model pays at the touch (Haug Tab. 4-13 term F, QuantLib
 *   `AnalyticBarrierEngine`); a spot at or beyond the barrier today is a touch
 *   today (rebate settles value-today, DF 1 – continuous with term F → K at the
 *   barrier), a recorded `hit: true` or an expiry fixing beyond the barrier
 *   means the rebate has already been paid (PV 0);
 * - `undefined` (default, unchanged since round 7): live model at the hit,
 *   decided paths rebate·DF_q(delivery) – identical on the three decided paths,
 *   but the value jumps by rebate·(1 − DF) at the barrier; set `rebateAt` for
 *   a single convention. Knocked in → the vanilla (analytic Greeks) in every
 *   case.
 *
 * Upfront premium (N6-1): reported as a `Premium` cashflow in its own last leg
 * (`upfrontPremiumLeg`), no longer a silent PV deduction.
 */
export function priceFxOption(ctx: MarketContext, trade: FxOption, reportingCurrency?: string): PricingResult {
  const { base, quote } = splitPair(trade.pair);
  const reporting = reportingCurrency ?? quote;
  const val = ctx.valuationDate;
  const spot = getFxSpot(ctx, base, quote);
  const spotDate = fxSpotDate(ctx, base, quote);
  const lifecycle = fxOptionLifecycle(trade, val);
  const alive = lifecycle === "alive";
  const delivered = lifecycle === "delivered";
  const tExp = Math.max(0, yearFraction(val, trade.expiryDate, "ACT/365F"));
  const tDel = Math.max(tExp, yearFraction(val, trade.deliveryDate, "ACT/365F"));
  const dfQ = delivered ? 0 : trade.deliveryDate > val ? getDiscountCurve(ctx, quote, trade.collateralCurrency).df(trade.deliveryDate) : 1;
  const forward = fxForwardRate(ctx, base, quote, Math.max(trade.deliveryDate, val), trade.collateralCurrency);
  // Effective foreign discount factor consistent with the spot-anchored forward.
  const dfF = (dfQ * forward) / spot;
  const rd = tDel > 0 && dfQ > 0 ? -Math.log(dfQ) / tDel : 0;
  const rf = tDel > 0 && dfF > 0 ? -Math.log(dfF) / tDel : 0;
  const warnings: string[] = [];
  const surface = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
  let vol = trade.volOverride;
  if (vol === undefined) {
    if (!alive) {
      vol = 0; // no optionality left – the smile is not read (N5-2)
    } else if (surface) {
      warnings.push(...surfaceVolWarnings(surface)); // Markt R6-4: implausible / degenerate smile
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
  // Digital payout scale (per unit base notional, in quote currency); a payout in a third currency is converted at the delivery forward.
  const payoutCcy = trade.digital?.payoutCurrency.toUpperCase();
  const payoutInBase = payoutCcy === base;
  const payoutFx =
    trade.digital && !payoutInBase && payoutCcy !== quote
      ? fxForwardRate(ctx, payoutCcy!, quote, Math.max(trade.deliveryDate, val), trade.collateralCurrency)
      : 1;
  const scalePayout = trade.digital ? (trade.digital.payout * payoutFx) / (trade.notional || 1) : 0;
  let kind = trade.barrier
    ? `Barrier ${trade.barrier.type}`
    : trade.digital
      ? payoutInBase
        ? "Digital (asset-or-nothing, base payout)"
        : "Digital (cash-or-nothing)"
      : "Vanilla";

  let premiumPerUnit: number;
  let greeks: { spotDelta: number; gamma: number; vega: number; theta: number; rhoDomestic: number; rhoForeign: number };
  let greeksMethod: string;
  let d1 = 0;
  let d2 = 0;
  let barrierState: BarrierState | undefined = trade.barrier ? "alive" : undefined;
  const noGreeks = { gamma: 0, vega: 0, theta: 0, rhoDomestic: 0, rhoForeign: 0 };
  if (!alive) {
    // N5-2: exercise decided on the expiry fixing; the remaining position is a settled payoff (or nothing).
    greeksMethod = "settled-payoff";
    if (delivered) {
      premiumPerUnit = 0;
      greeks = { spotDelta: 0, ...noGreeks };
      kind = `${kind} (delivered)`;
      warnings.push(`FX option already settled (delivered ${toISO(trade.deliveryDate)}) – excluded from the PV`);
    } else {
      const fixing = getFxFixing(ctx, `${base}${quote}`, trade.expiryDate);
      const sFix = fixing ?? spot;
      const settled = settledPayoff(trade, sFix, forward, spot, dfQ, scalePayout);
      premiumPerUnit = settled.premiumPerUnit;
      greeks = { spotDelta: settled.spotDelta, ...noGreeks };
      barrierState = settled.barrierState ?? barrierState;
      if (trade.barrier && trade.barrier.hit === undefined) {
        // N6-5: only the expiry fixing is observed – a touch before the expiry cannot be seen.
        warnings.push(
          `${BARRIER_STATE_UNKNOWN_PREFIX} knock state of the ${trade.barrier.type} barrier ${trade.barrier.level} derived from the expiry fixing ${sFix} only (${barrierState}) – touch events before the expiry are not observed; set barrier.hit to record the knock state`,
        );
      }
      const fixingNote = fixing !== undefined ? `expiry fixing ${sFix}` : "today's spot as proxy for the expiry fixing";
      const outcomeNote =
        settled.outcome === "exercised"
          ? "exercised, valued as the forward position at the strike"
          : settled.outcome === "rebate"
            ? `not exercised – ${barrierState === "knocked-out" ? "knocked out" : "barrier never touched"}, rebate ${trade.barrier?.rebate} per unit base paid on ${toISO(trade.deliveryDate)}`
            : settled.outcome === "rebate-paid"
              ? `knocked out, rebate ${trade.barrier?.rebate} per unit base already paid at the touch (rebateAt: hit) – nothing left`
              : "not exercised / knocked out";
      if (lifecycle === "expires-today") {
        warnings.push(`${EXPIRES_TODAY_PREFIX} FX option expires on the valuation date ${toISO(val)} – intrinsic value on ${fixingNote}, no time value`);
      } else {
        warnings.push(
          `${EXPIRED_PREFIX} FX option expired ${toISO(trade.expiryDate)} – settlement pending until ${toISO(trade.deliveryDate)}: settled payoff on ${fixingNote} (${outcomeNote}), no vega, gamma or theta`,
        );
        if (fixing === undefined) {
          warnings.push(
            `${MISSING_FX_FIXING_PREFIX} Missing FX fixing for ${base}${quote} on ${toISO(trade.expiryDate)}; exercise of the expired option decided on today's spot ${spot} (load ctx.fxFixings)`,
          );
        }
      }
      if (lifecycle === "settles-today") {
        warnings.push(
          `${SETTLES_TODAY_PREFIX} FX option settles on the valuation date ${toISO(val)} – payoff valued as a value-today exchange (not discounted)`,
        );
      }
    }
  } else {
    const gk = garmanKohlhagen(inputs);
    d1 = gk.d1;
    d2 = gk.d2;
    premiumPerUnit = gk.premiumDomestic;
    greeks = {
      spotDelta: gk.spotDelta,
      gamma: gk.gamma,
      vega: gk.vega,
      theta: gk.theta,
      rhoDomestic: gk.rhoDomestic,
      rhoForeign: gk.rhoForeign,
    };
    greeksMethod = "analytic";
    if (trade.barrier) {
      const b = trade.barrier;
      const isOut = b.type.endsWith("Out");
      const knockedState: BarrierState = isOut ? "knocked-out" : "knocked-in";
      // N6-5 / N7-5: the knock is decided when it was recorded (`hit: true`) or when today's spot is at / beyond the
      // barrier (continuous barrier: a touch) – both paths value the knocked option identically.
      const knocked = b.hit === true || beyondBarrier(b, spot);
      if (knocked) {
        barrierState = knockedState;
        let rebateNote = "no rebate, PV 0";
        if (isOut) {
          if (b.rebateAt === "hit") {
            // At-hit convention (R8): a recorded touch means the rebate has been paid; a spot beyond the barrier
            // today is a touch today – the rebate settles value-today (DF 1), continuous with term F → K.
            premiumPerUnit = b.hit === true ? 0 : (b.rebate ?? 0);
            if (b.rebate)
              rebateNote =
                b.hit === true
                  ? `rebate ${b.rebate} per unit base already paid at the touch (rebateAt: hit)`
                  : `rebate ${b.rebate} per unit base paid at the touch today (rebateAt: hit, value-today)`;
          } else {
            // Rebate valued as a payment on the delivery date (same convention as the expired path, `settledPayoff`).
            premiumPerUnit = (b.rebate ?? 0) * dfQ;
            if (b.rebate) rebateNote = `rebate ${b.rebate} per unit base valued as a payment on ${toISO(trade.deliveryDate)}`;
          }
          greeks = { spotDelta: 0, ...noGreeks };
          greeksMethod = "settled-payoff";
        }
        // Knocked in → the vanilla (Garman–Kohlhagen value and analytic Greeks already computed above).
        const valuedAs = isOut ? `${rebateNote}, no optionality left` : `valued as the vanilla ${trade.optionType}`;
        if (b.hit === true) {
          warnings.push(`Barrier ${b.type} ${b.level} ${isOut ? "knocked out" : "knocked in"} (barrier.hit) – ${valuedAs}`);
        } else {
          // N6-5: the state is derived from today's spot – say so instead of a silent 0 / vanilla.
          warnings.push(
            `${BARRIER_STATE_UNKNOWN_PREFIX} spot ${spot} is ${b.type.startsWith("Up") ? "at or above" : "at or below"} the ${b.type} barrier ${b.level} – valued as ${isOut ? "knocked out" : "knocked in"} on today's spot (${valuedAs})${b.hit === false ? " although barrier.hit is false (continuous barrier: a spot beyond the level is a touch)" : "; set barrier.hit to record the knock state"}`,
          );
        }
      } else {
        // N7-5 (R8): the trade's rebate convention drives the model – "expiry" → K·DF·P(hit), otherwise at the hit (term F).
        const priceFn = (i: FxOptionInputs) =>
          fxBarrier({ ...i, barrier: b.level, barrierType: b.type, rebate: b.rebate, rebateAtExpiry: b.rebateAt === "expiry" });
        premiumPerUnit = priceFn(inputs);
        greeks = fxExoticGreeks(priceFn, inputs, { barrier: b.level });
        greeksMethod = "finite-difference";
      }
    } else if (trade.digital) {
      const priceFn = (i: FxOptionInputs) => fxDigital(i, payoutInBase) * scalePayout;
      premiumPerUnit = priceFn(inputs);
      greeks = fxExoticGreeks(priceFn, inputs);
      greeksMethod = "finite-difference";
    }
  }
  const longShort = trade.payReceive === "Receive" ? 1 : -1;
  const fxQ = fxRateAtValuationDate(ctx, quote, reporting, trade.collateralCurrency);
  const pvQuote = longShort * trade.notional * premiumPerUnit;
  // N6-1: the upfront premium is a `Premium` cashflow in its own (last) leg, not a silent PV deduction.
  const upfront = upfrontPremiumLeg(ctx, trade, reporting, 1);
  const pv = pvQuote * fxQ + (upfront?.pvReporting ?? 0);
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
            amount: dfQ > 0 ? pvQuote / dfQ : 0,
            discountFactor: dfQ,
            presentValue: pvQuote,
            kind: "OptionPayoff",
          },
        ],
      },
      ...(upfront ? [upfront.leg] : []),
    ],
    analytics: {
      kind,
      /** Lifecycle state on the valuation date (N5-2), see `fxOptionLifecycle`. */
      lifecycle,
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
      /**
       * Premium-adjusted spot delta as a fraction of the notional (R8): the
       * unadjusted delta less the premium in base-currency units,
       * Δ − P/S (Reiswich–Wystup) – the hedge ratio for pairs whose premium is
       * paid in the base currency (USDJPY, EM pairs); `deltaPct` stays the
       * unadjusted spot delta. 0 without optionality (settled / delivered).
       */
      deltaPremiumAdjusted: spot > 0 ? longShort * (greeks.spotDelta - premiumPerUnit / spot) : longShort * greeks.spotDelta,
      gamma: scale * greeks.gamma * spot * spot * 0.0001,
      /** Vega per 1 vol point */
      vega: scale * greeks.vega * 0.01,
      thetaPerDay: (scale * greeks.theta) / 365,
      rhoDomestic: scale * greeks.rhoDomestic * 0.0001,
      rhoForeign: scale * greeks.rhoForeign * 0.0001,
      /** "analytic" (vanilla), "finite-difference" (barrier / digital) or "settled-payoff" (expired / delivered N5-2, knocked-out N6-5). */
      greeksMethod,
      /** Barrier options only (N6-5): "alive", "knocked-in" or "knocked-out" – from `barrier.hit`, today's spot or the expiry fixing. */
      barrierState,
      /** Barrier options with a rebate (R8): knock-out rebate timing – "hit", "expiry" or "default" (round-7 mixture, see `FxOption.barrier`). */
      rebateAt: trade.barrier?.rebate ? (trade.barrier.rebateAt ?? "default") : undefined,
      d1,
      d2,
      /** "standard" when delivery = spot date of the expiry; barriers with a "non-standard" lag use expiry-horizon drift/rebate rates (R3-9). */
      deliveryConvention,
    },
    /** Spot settlement date (T+2 / T+1 on the pair calendar), ISO; `standardDelivery` = spot date of the expiry. */
    details: { spotDate: toISO(spotDate), standardDelivery: toISO(standardDelivery) },
    warnings,
  };
}
