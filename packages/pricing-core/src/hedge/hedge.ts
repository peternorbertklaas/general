import { getIndex, getSwapConventions } from "../curves/index-definitions.js";
import { type SerialDate, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule } from "../dates/schedule.js";
import { formatDateDe, formatDe } from "../format.js";
import { annuityAmortisationSchedule, linearAmortisation, makeCapFloor, makeVanillaSwap } from "../instruments/builders.js";
import { tradeTypeLabelDe } from "../instruments/labels.js";
import {
  type CapFloor,
  type FixedLeg,
  type FloatLeg,
  type FxForward,
  type FxOption,
  type PayReceive,
  type PricingResult,
  type SwapLeg,
  type Trade,
  type TradeType,
} from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { solveBracketed } from "../math/rootfind.js";
import { capletVol } from "../models/vol-surfaces.js";
import { fxForwardRate, splitPair } from "../pricing/fx-pricer.js";
import { fxToReporting } from "../pricing/leg-pricer.js";
import { priceTrade, tradeCurrencies } from "../pricing/price.js";
import { STANDARD_SCENARIOS, type ScenarioDefinition, applyScenario } from "../risk/scenarios.js";
import { capletSurfaceKeysFor } from "../risk/sensitivities.js";
import { PricingError } from "../errors.js";

/**
 * Hedge accounting (Bilanzierung von Sicherungsbeziehungen) for IFRS 9 and
 * HGB § 254 (BilMoG) / IDW RS HFA 35.
 *
 * The module documents a hedge relationship (Grundgeschäft ↔ Sicherungs-
 * instrument), constructs the hypothetical derivative that perfectly hedges
 * the hedged item, and runs the standard effectiveness tests:
 *
 * - Critical-Terms-Match (qualitative, IFRS 9 B6.4.14 / IDW RS HFA 35 Tz. 51)
 * - Dollar-Offset (prospective and retrospective/cumulative, 80–125 % band)
 * - Regression (OLS over a set of market scenarios; slope in band, R² ≥ 0.8)
 *
 * From the cumulative fair value changes it derives the IFRS 9 cash flow
 * hedge split (effective portion → OCI, ineffectiveness → P&L) and the HGB
 * amounts under the Einfrierungs- and Durchbuchungsmethode (Drohverlust-
 * rückstellung for a negative ineffective excess).
 *
 * Conventions: all PVs are from the reporting entity's perspective (positive
 * = asset). The hypothetical derivative is built as the *perfect hedge* of the
 * hedged item, i.e. with the hedged item's terms and the hedging instrument's
 * direction; the hedged item's own fair value change attributable to the
 * hedged risk is therefore −ΔPV(hypothetical).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** IFRS 9 hedge type (HGB § 254 does not distinguish, but the same split applies). */
export type HedgeType = "CashFlowHedge" | "FairValueHedge";

/** Kind of hedged item (Grundgeschäft). */
export type HedgedItemKind = "FloatingRateLoan" | "FixedRateLoan" | "ForecastFxCashflow" | "FxReceivable";

/** Effectiveness measurement method designated in the hedge documentation. */
export type EffectivenessMethod = "DollarOffset" | "Regression" | "CriticalTerms";

/** Accounting framework the relationship is documented under. */
export type AccountingFramework = "IFRS9" | "HGB";

/**
 * Designation of an option as hedging instrument (IFRS 9 6.5.15 / B6.5.29,
 * IDW RS HFA 35 Tz. 60): "FullFairValue" measures the whole fair value
 * change; "IntrinsicValue" designates only the intrinsic value – the
 * effectiveness tests compare Δ intrinsic value of instrument and hypothetical
 * option, and the time-value change is reported separately as cost of hedging
 * (OCI). Default: FullFairValue. Has no effect on linear instruments.
 */
export type HedgeDesignation = "FullFairValue" | "IntrinsicValue";

/** Amortisation (Tilgungsplan) of the hedged item. */
export interface HedgedItemAmortisation {
  /** "Linear": equal principal instalments; "Annuity": constant instalment at `loanRate`; "Custom": explicit `schedule`. */
  type: "Linear" | "Annuity" | "Custom";
  /** Outstanding balance after the last instalment (default 0). */
  finalNotional?: number;
  /** Loan rate for the annuity plan (default: `HedgedItem.fixedRate`). */
  loanRate?: number;
  /** Explicit outstanding notional per period start (type "Custom"). */
  schedule?: { date: SerialDate; notional: number }[];
  /** Instalment frequency (default: fixed-leg frequency of the currency's swap conventions, e.g. "1Y" for EUR). */
  frequency?: string;
}

/** The hedged item (Grundgeschäft). */
export interface HedgedItem {
  description: string;
  /** Currency of the hedged cash flows / exposure (for FX hedges: the foreign currency). */
  currency: string;
  /** Nominal of the hedged item in `currency` (whole item; the hedged portion is `notional × hedgeRatio`). */
  notional: number;
  kind: HedgedItemKind;
  /** Floating index of a floating-rate loan (e.g. "EURIBOR-6M"). */
  index?: string;
  /** Coupon of a fixed-rate loan (decimal). */
  fixedRate?: number;
  /** Start of the hedged period (loan start / designation of forecast). */
  effectiveDate: SerialDate;
  /** Maturity of the loan or date of the forecast FX cash flow. */
  maturityDate: SerialDate;
  /** FX pair (e.g. "EURUSD") for FX hedges; the counter currency is the functional currency. */
  fxPair?: string;
  /** FX cash flow amount in `currency` (positive = inflow / receivable, negative = outflow). Defaults to `notional`. */
  amount?: number;
  /**
   * Outstanding notional per period start (Tilgungsplan; last entry with
   * `date` ≤ period start applies, like `LegBase.notionalSchedule`). Takes
   * precedence over `amortisation`.
   */
  notionalSchedule?: { date: SerialDate; notional: number }[];
  /** Amortisation plan generated from the loan terms (see `HedgedItemAmortisation`). */
  amortisation?: HedgedItemAmortisation;
}

/** Documented hedge relationship (Sicherungsbeziehung / Bewertungseinheit). */
export interface HedgeRelationship {
  id: string;
  name: string;
  type: HedgeType;
  hedgedItem: HedgedItem;
  /** Trade id of the hedging instrument. */
  hedgingInstrumentId: string;
  designationDate: SerialDate;
  /**
   * Hedge ratio = hedged portion / hedged item, i.e. the proportion of the
   * hedged item covered by the hedging instrument (IFRS 9 6.3.7, B6.4.9).
   * The hypothetical derivative is scaled to `notional × hedgeRatio`. Default 1.
   */
  hedgeRatio?: number;
  method: EffectivenessMethod;
  accountingFramework: AccountingFramework;
  /** Option designation (see `HedgeDesignation`); default "FullFairValue". */
  designation?: HedgeDesignation;
}

/** Single critical-terms comparison. */
export interface CriticalTermCheck {
  /** `notionalSchedule` compares the notional path period-wise (amortising items / instruments). */
  term: "notional" | "currency" | "effectiveDate" | "maturityDate" | "index" | "notionalSchedule";
  hedgedItem: string;
  hedgingInstrument: string;
  /** False when the term is not defined for the instrument type (e.g. index of an FX forward). */
  applicable: boolean;
  match: boolean;
}

export interface CriticalTermsResult {
  /** All applicable checks match. */
  matches: boolean;
  checks: CriticalTermCheck[];
  toleranceDays: number;
  notionalTolerance: number;
}

export interface DollarOffsetResult {
  currency: string;
  pvHedge0: number;
  pvHedge1: number;
  pvHypothetical0: number;
  pvHypothetical1: number;
  deltaHedge: number;
  deltaHypothetical: number;
  /** ΔPV(hedge) / ΔPV(hypothetical), signed. Undefined when ΔPV(hypothetical) ≈ 0. */
  ratio?: number;
  band: [number, number];
  /** False when the ratio is undefined (no measurable change in the hedged item). */
  assessable: boolean;
  /** Ratio inside the band; always false when not assessable. */
  effective: boolean;
}

export interface RegressionPoint {
  scenarioId: string;
  deltaHedge: number;
  deltaHypothetical: number;
}

export interface RegressionResult {
  currency: string;
  n: number;
  /** OLS slope of ΔPV(hedge) on ΔPV(hypothetical). */
  slope?: number;
  intercept?: number;
  r2?: number;
  slopeBand: [number, number];
  minR2: number;
  assessable: boolean;
  effective: boolean;
  points: RegressionPoint[];
}

/** IFRS 9 accounting split based on cumulative fair value changes since designation. */
export interface Ifrs9Result {
  hedgeType: HedgeType;
  /** False when no designation-date market was supplied (cumulative changes unknown). */
  assessable: boolean;
  /** Cumulative ΔPV of the hedging instrument since designation. */
  hedgingInstrumentChange: number;
  /** Cumulative ΔPV of the hypothetical derivative since designation. */
  hypotheticalChange: number;
  /** Cumulative change of the hedged item attributable to the hedged risk (= −hypotheticalChange). */
  hedgedItemChange: number;
  /** Offsetting (effective) portion: sign of the hedging instrument, magnitude min(|ΔH|, |ΔI|); 0 when no offset. */
  effectivePortion: number;
  /** Cash flow hedge reserve movement (OCI). 0 for fair value hedges. */
  oci: number;
  /** Net P&L effect (ineffectiveness; for fair value hedges the net of both gross bookings). */
  pnl: number;
  pnlComponents: { hedgingInstrument: number; hedgedItemAdjustment: number };
}

/** HGB § 254 Bewertungseinheit amounts (IDW RS HFA 35). */
export interface HgbResult {
  assessable: boolean;
  hedgingInstrumentChange: number;
  hedgedItemChange: number;
  /** Kompensierter (effektiver) Teil – not recognised under either method (nets to zero). */
  effectiveNetted: number;
  /** Ineffective excess (Überhang) = hedging instrument change + hedged item change. Negative = unrealised loss excess. */
  ineffectiveExcess: number;
  /** Provision for onerous contracts (§ 249 HGB) = max(0, −ineffectiveExcess). */
  drohverlustrueckstellung: number;
  /** Positive excess is not recognised (Realisationsprinzip). */
  unrecognisedGain: number;
  einfrierungsmethode: { frozenHedgingInstrument: number; frozenHedgedItem: number; recognisedPnl: number };
  durchbuchungsmethode: { hedgingInstrumentBooked: number; hedgedItemBooked: number; ineffectiveBooked: number; netPnl: number };
}

/**
 * Cost of hedging (IFRS 9 6.5.15): time value of an option designated at
 * intrinsic value, whose change is recognised in OCI (separate component of
 * equity) instead of entering the effectiveness measurement.
 */
export interface CostOfHedging {
  currency: string;
  /** Time value of the hedging instrument at the valuation date (fair value − intrinsic value). */
  timeValue: number;
  /** Time value at designation (requires `designationCtx`). */
  timeValueAtDesignation?: number;
  /** Cumulative change of the time value since designation → OCI (cost of hedging reserve). */
  change?: number;
  /** Intrinsic value of the hedging instrument at the valuation date. */
  intrinsicValue: number;
}

export interface HedgeEffectivenessReport {
  relationshipId: string;
  relationshipName: string;
  hedgeType: HedgeType;
  accountingFramework: AccountingFramework;
  method: EffectivenessMethod;
  /** Option designation applied to the measurement. */
  designation: HedgeDesignation;
  /** Time-value component of an option designated at intrinsic value (undefined otherwise). */
  costOfHedging?: CostOfHedging;
  valuationDate: string;
  designationDate: string;
  reportingCurrency: string;
  hedgeRatio: number;
  hedgingInstrument: { id: string; name?: string; type: TradeType; pv: number };
  /**
   * The hypothetical derivative and its PV at the valuation date. `frozenVol`
   * is set when `HedgeReportOptions.freezeDesignationVol` applied a
   * `volOverride` taken from the designation market (decimal vol).
   */
  hypotheticalDerivative: { trade: Trade; pv: number; frozenVol?: number };
  criticalTerms: CriticalTermsResult;
  /** Prospective test: current market vs. shocked market (+100bp, or +10 % spot for FX hedges). */
  dollarOffsetProspective: DollarOffsetResult;
  /**
   * Prospective basis test (only when the hedged item's index differs from the
   * hedging instrument's): current market vs. the hedged item's projection
   * curve shocked alone by +25bp. Informational – it exposes the tenor-basis
   * ineffectiveness that a parallel shock hides; the verdict stays with the
   * designated method.
   */
  dollarOffsetBasis?: DollarOffsetResult;
  /** Basis scenarios that were part of the regression set (ids), empty when none. */
  basisScenarioIds: string[];
  /** Retrospective test: designation market vs. current market (requires `designationCtx`). */
  dollarOffsetCumulative?: DollarOffsetResult;
  /** Period test: previous period vs. current market (requires `previousCtx`; falls back to cumulative). */
  dollarOffsetPeriod?: DollarOffsetResult;
  regression: RegressionResult;
  effectiveByMethod: Record<EffectivenessMethod, boolean>;
  /** Effectiveness per the designated `method`. */
  effective: boolean;
  /** False when the designated method could not produce a verdict (e.g. zero fair value changes). */
  assessable: boolean;
  ifrs9: Ifrs9Result;
  hgb: HgbResult;
  /** Human-readable German summary for the hedge documentation. */
  summary: string[];
  /** German warnings for the reviewer. */
  warnings: string[];
  /** Raw pricer warnings (English) collected while valuing hedge and hypothetical. */
  pricingWarnings: string[];
}

export interface HedgeReportOptions {
  /** Market at the designation date; enables the retrospective (cumulative) test and the accounting split. */
  designationCtx?: MarketContext;
  /** Market at the previous reporting date for the period dollar-offset. */
  previousCtx?: MarketContext;
  /** Override the hypothetical derivative (e.g. the documented one). */
  hypothetical?: Trade;
  /** Currency for all PVs; default: hedged item currency (IR) / functional (counter) currency (FX). */
  reportingCurrency?: string;
  /** Dollar-offset / regression slope band; default [0.8, 1.25]. */
  band?: [number, number];
  /** Minimum R² for the regression test; default 0.8. */
  minR2?: number;
  /** Date tolerance for critical terms in calendar days; default 5. */
  toleranceDays?: number;
  /** Relative notional tolerance for critical terms; default 0.01. */
  notionalTolerance?: number;
  /** Override the prospective shock scenario. */
  prospectiveScenario?: ScenarioDefinition;
  /** Override the regression scenario set. */
  regressionScenarios?: ScenarioDefinition[];
  /**
   * Add single-curve basis shocks (tenor basis of the hedged item's / instrument's
   * projection curves, OIS basis of the discount curve) to the default regression
   * set when the hedged item's index differs from the hedging instrument's.
   * Default true. Ignored when `regressionScenarios` is supplied (a warning is
   * issued if that set contains parallel shocks only).
   */
  basisScenarios?: boolean;
  /**
   * Freeze the volatility of a hypothetical option (cap/floor, swaption, FX
   * option) at designation: when true and `designationCtx` is given, the
   * hypothetical gets a `volOverride` taken from the designation market's
   * surface (FX option / swaption: smile vol at strike and expiry; cap/floor:
   * the flat vol that reproduces the strip's designation-date PV, i.e. the
   * implied flat cap vol at the strike). Subsequent PV changes of the
   * hypothetical then stem from rates (and spot) only – the hedged item has no
   * volatility exposure, so vol moves of the surface should not create
   * ineffectiveness (IFRS 9 B6.5.5). Default false (the hypothetical is
   * revalued on the current surface). Ignored when the hypothetical already
   * carries a `volOverride`.
   */
  freezeDesignationVol?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard 80–125 % effectiveness corridor (IAS 39 heritage, still used by IDW RS HFA 35 and as IFRS 9 policy). */
export const DEFAULT_EFFECTIVENESS_BAND: [number, number] = [0.8, 1.25];
/** Minimum coefficient of determination for the regression method. */
export const DEFAULT_MIN_R2 = 0.8;
/** Below this absolute ΔPV (in reporting currency) the hedged item is treated as unchanged. */
export const MIN_ABS_DELTA = 1e-6;

const DEFAULT_TOLERANCE_DAYS = 5;
const DEFAULT_NOTIONAL_TOLERANCE = 0.01;
const FX_REGRESSION_SHOCKS_PCT = [1, 2, 3, 5, 7.5, 10];

// ---------------------------------------------------------------------------
// Instrument introspection helpers
// ---------------------------------------------------------------------------

interface InstrumentTerms {
  /** Notional in the hedged currency (FX: amount of the hedged currency exchanged). */
  notional?: number;
  currencies: string[];
  effectiveDate?: SerialDate;
  maturityDate?: SerialDate;
  index?: string;
  /** Direction of the fixed leg (IR instruments). */
  fixedDirection?: PayReceive;
  /** Whether the instrument sells the hedged currency (FX instruments). */
  sellsHedgedCurrency?: boolean;
}

function isFxKind(kind: HedgedItemKind): boolean {
  return kind === "ForecastFxCashflow" || kind === "FxReceivable";
}

function isFxTrade(trade: Trade): boolean {
  return trade.type === "FxForward" || trade.type === "FxSwap" || trade.type === "FxOption";
}

function fxLegTerms(leg: Omit<FxForward, "type" | "id">, hedgedCcy: string): Pick<InstrumentTerms, "notional" | "sellsHedgedCurrency"> {
  if (leg.sellCurrency === hedgedCcy) return { notional: leg.sellAmount, sellsHedgedCurrency: true };
  if (leg.buyCurrency === hedgedCcy) return { notional: leg.buyAmount, sellsHedgedCurrency: false };
  return {};
}

/** Extract the terms of a hedging instrument relevant for critical-terms and hypothetical construction. */
function instrumentTerms(trade: Trade, hedgedCcy: string): InstrumentTerms {
  const currencies = tradeCurrencies(trade);
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      const leg = trade.legs.find((l) => l.currency === hedgedCcy) ?? trade.legs[0];
      const fl = trade.legs.find((l): l is FloatLeg => l.type === "Float");
      const fx = trade.legs.find((l): l is FixedLeg => l.type === "Fixed");
      return {
        notional: leg?.notional,
        currencies,
        effectiveDate: leg?.effectiveDate,
        maturityDate: leg?.terminationDate,
        index: fl?.index,
        fixedDirection: fx?.payReceive,
      };
    }
    case "FRA":
      return {
        notional: trade.notional,
        currencies,
        effectiveDate: trade.startDate,
        maturityDate: trade.endDate,
        index: trade.index,
        fixedDirection: trade.payReceive,
      };
    case "CapFloor":
      return { notional: trade.notional, currencies, effectiveDate: trade.effectiveDate, maturityDate: trade.terminationDate, index: trade.index };
    case "Swaption":
      return { ...instrumentTerms(trade.underlying, hedgedCcy), currencies };
    case "FxForward":
      return { ...fxLegTerms(trade, hedgedCcy), currencies, maturityDate: trade.deliveryDate };
    case "FxSwap":
      return { ...fxLegTerms(trade.farLeg, hedgedCcy), currencies, maturityDate: trade.farLeg.deliveryDate };
    case "FxOption": {
      const { base, quote } = splitPair(trade.pair);
      const notional = base === hedgedCcy ? trade.notional : quote === hedgedCcy ? trade.notional * trade.strike : undefined;
      // Long put on base (or long call when hedged ccy is the quote) sells the hedged currency at exercise.
      const long = trade.payReceive === "Receive";
      let sells: boolean | undefined;
      if (base === hedgedCcy) sells = long ? trade.optionType === "Put" : trade.optionType === "Call";
      else if (quote === hedgedCcy) sells = long ? trade.optionType === "Call" : trade.optionType === "Put";
      return { notional, currencies, maturityDate: trade.deliveryDate, sellsHedgedCurrency: sells };
    }
    default: {
      const never: never = trade;
      throw new PricingError("UNSUPPORTED_TRADE_TYPE", `Unsupported trade type: ${(never as Trade).type}`);
    }
  }
}

/** Counter (functional) currency of an FX hedge: from `fxPair`, else from the hedging instrument. */
function counterCurrency(rel: HedgeRelationship, instrument: Trade): string {
  const hedged = rel.hedgedItem.currency.toUpperCase();
  if (rel.hedgedItem.fxPair) {
    const { base, quote } = splitPair(rel.hedgedItem.fxPair);
    if (base === hedged) return quote;
    if (quote === hedged) return base;
    throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `fxPair ${rel.hedgedItem.fxPair} does not contain hedged currency ${hedged}`);
  }
  const other = tradeCurrencies(instrument).find((c) => c.toUpperCase() !== hedged);
  if (!other) throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `Cannot determine counter currency for FX hedge ${rel.id}`);
  return other;
}

/** Reporting currency for PV comparisons: functional currency for FX hedges, hedged currency otherwise. */
function reportingCurrencyFor(rel: HedgeRelationship, instrument: Trade, override?: string): string {
  if (override) return override;
  return isFxKind(rel.hedgedItem.kind) ? counterCurrency(rel, instrument) : rel.hedgedItem.currency;
}

/** Notional of the hedged portion (hedged item × hedge ratio). */
function hedgedPortionNotional(rel: HedgeRelationship): number {
  const item = rel.hedgedItem;
  const base = isFxKind(item.kind) ? Math.abs(item.amount ?? item.notional) : Math.abs(item.notional);
  return base * hedgeRatioOf(rel);
}

function hedgeRatioOf(rel: HedgeRelationship): number {
  const r = rel.hedgeRatio ?? 1;
  if (!(r > 0) || !Number.isFinite(r)) throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `Invalid hedge ratio for ${rel.id}: ${r}`);
  return r;
}

/** Projection curve id of an index name, undefined for unknown indices. */
function safeCurveId(indexName: string): string | undefined {
  try {
    return getIndex(indexName).curveId;
  } catch {
    return undefined;
  }
}

function pv(ctx: MarketContext, trade: Trade, ccy: string, warnings?: string[]): number {
  const r = priceTrade(ctx, trade, ccy);
  warnings?.push(...r.warnings);
  return r.pv;
}

function isOptionTrade(trade: Trade): trade is CapFloor | FxOption | Extract<Trade, { type: "Swaption" }> {
  return trade.type === "CapFloor" || trade.type === "FxOption" || trade.type === "Swaption";
}

/**
 * Fair value split of an option into intrinsic and time value (reporting
 * currency `ccy`), used for the intrinsic-value designation (IFRS 9 6.5.15):
 * - Cap/floor/collar: Σ over unpaid periods of ±N·τ·DF·max(±(F − K), 0)
 *   (per caplet/floorlet on the current forward; fixed periods are intrinsic already).
 * - Swaption: ±N·annuity·max(±(F − K), 0).
 * - FX vanilla option: ±N·max(±(F − K), 0)·DF_quote (forward to delivery);
 *   barrier / digital options have no meaningful intrinsic split → time value 0.
 * Linear instruments: intrinsic = fair value, time value 0.
 */
export function intrinsicValue(ctx: MarketContext, trade: Trade, ccy: string, priced?: PricingResult): { pv: number; intrinsic: number; timeValue: number } {
  const r = priced ?? priceTrade(ctx, trade, ccy);
  const full = { pv: r.pv, intrinsic: r.pv, timeValue: 0 };
  const a = r.analytics;
  const num = (k: string): number | undefined => (typeof a[k] === "number" && Number.isFinite(a[k] as number) ? (a[k] as number) : undefined);
  const longShort = "payReceive" in trade && trade.payReceive === "Pay" ? -1 : 1;
  let intrinsic: number;
  switch (trade.type) {
    case "CapFloor": {
      const fx = fxToReporting(ctx, trade.currency, ccy, trade.collateralCurrency);
      intrinsic = 0;
      for (const cf of r.legs[0]?.cashflows ?? []) {
        if (cf.rate === undefined || cf.accrualFactor === undefined) continue;
        const capPart = Math.max(cf.rate - trade.strike, 0);
        const floorPart = Math.max((trade.capFloor === "Collar" ? (trade.floorStrike ?? trade.strike) : trade.strike) - cf.rate, 0);
        const payoff = trade.capFloor === "Cap" ? capPart : trade.capFloor === "Floor" ? floorPart : capPart - floorPart;
        intrinsic += longShort * cf.notional * cf.accrualFactor * cf.discountFactor * payoff;
      }
      intrinsic *= fx;
      break;
    }
    case "Swaption": {
      const fwd = num("forwardSwapRate");
      const strike = num("strike");
      const annuity = num("annuity");
      if (fwd === undefined || strike === undefined || annuity === undefined) return full;
      const fixed = trade.underlying.legs.find((l) => l.type === "Fixed")!;
      const fx = fxToReporting(ctx, fixed.currency, ccy, trade.collateralCurrency);
      const payoff = trade.payerReceiver === "Payer" ? Math.max(fwd - strike, 0) : Math.max(strike - fwd, 0);
      intrinsic = longShort * annuity * payoff * fx;
      break;
    }
    case "FxOption": {
      if (trade.barrier || trade.digital) return full;
      const fwd = num("forward");
      const df = r.legs[0]?.cashflows[0]?.discountFactor;
      if (fwd === undefined || df === undefined) return full;
      const { quote } = splitPair(trade.pair);
      const fx = fxToReporting(ctx, quote, ccy, trade.collateralCurrency);
      const payoff = trade.optionType === "Call" ? Math.max(fwd - trade.strike, 0) : Math.max(trade.strike - fwd, 0);
      intrinsic = longShort * trade.notional * payoff * df * fx;
      break;
    }
    default:
      return full;
  }
  // Upfront premiums are part of the fair value, not of the intrinsic value.
  return { pv: r.pv, intrinsic, timeValue: r.pv - intrinsic };
}

/** Value used by the effectiveness tests: full fair value, or intrinsic value under the intrinsic designation. */
function hedgeValue(ctx: MarketContext, trade: Trade, ccy: string, designation: HedgeDesignation | undefined, warnings?: string[]): number {
  if ((designation ?? "FullFairValue") === "IntrinsicValue" && isOptionTrade(trade)) {
    const r = priceTrade(ctx, trade, ccy);
    warnings?.push(...r.warnings);
    return intrinsicValue(ctx, trade, ccy, r).intrinsic;
  }
  return pv(ctx, trade, ccy, warnings);
}

// ---------------------------------------------------------------------------
// Notional path of the hedged item (Tilgungsplan)
// ---------------------------------------------------------------------------

/** Value of a `{date, value}` schedule applicable at `date` (last entry ≤ date), `fallback` before the first entry. */
function scheduleValueAt<T extends { date: SerialDate }>(
  schedule: readonly T[] | undefined,
  date: SerialDate,
  pick: (e: T) => number,
  fallback: number,
): number {
  if (!schedule || schedule.length === 0) return fallback;
  let v = fallback;
  for (const e of schedule) if (e.date <= date) v = pick(e);
  return v;
}

function itemScheduleLeg(
  item: HedgedItem,
  frequency?: string,
): { effectiveDate: SerialDate; terminationDate: SerialDate; frequency: string; calendar: ReturnType<typeof getSwapConventions>["calendar"] } {
  const conv = getSwapConventions(item.currency);
  return { effectiveDate: item.effectiveDate, terminationDate: item.maturityDate, frequency: frequency ?? conv.fixedFrequency, calendar: conv.calendar };
}

/**
 * Notional path of the hedged portion (hedged item × hedge ratio) per period
 * start, from `notionalSchedule` or the `amortisation` plan; undefined for a
 * bullet item. Linear and annuity plans step at the instalment frequency
 * (default: fixed-leg frequency of the currency, i.e. the frequency of the
 * hypothetical swap's fixed leg).
 */
export function hedgedItemNotionalSchedule(rel: HedgeRelationship): { date: SerialDate; notional: number }[] | undefined {
  const item = rel.hedgedItem;
  const ratio = hedgeRatioOf(rel);
  const scale = (s: { date: SerialDate; notional: number }[]) =>
    [...s].sort((a, b) => a.date - b.date).map((e) => ({ date: e.date, notional: Math.abs(e.notional) * ratio }));
  if (item.notionalSchedule?.length) return scale(item.notionalSchedule);
  const am = item.amortisation;
  if (!am) return undefined;
  const notional = Math.abs(item.amount ?? item.notional);
  switch (am.type) {
    case "Custom":
      if (!am.schedule?.length) throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `Hedged item of ${rel.id}: amortisation "Custom" needs a schedule`);
      return scale(am.schedule);
    case "Linear":
      return scale(linearAmortisation(itemScheduleLeg(item, am.frequency), notional, am.finalNotional ?? 0));
    case "Annuity": {
      const loanRate = am.loanRate ?? item.fixedRate;
      if (loanRate === undefined)
        throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `Hedged item of ${rel.id}: amortisation "Annuity" needs loanRate (or fixedRate)`);
      return scale(annuityAmortisationSchedule(itemScheduleLeg(item, am.frequency), notional, loanRate, am.finalNotional ?? 0));
    }
  }
}

/** Legs of an IR hedging instrument (swap, CCS, swaption underlying), empty otherwise. */
function instrumentLegs(trade: Trade): SwapLeg[] {
  if (trade.type === "InterestRateSwap" || trade.type === "CrossCurrencySwap") return trade.legs;
  if (trade.type === "Swaption") return trade.underlying.legs;
  return [];
}

/** Schedule parameters of the leg / strip whose period starts define the notional path comparison. */
interface PeriodSource {
  effectiveDate: SerialDate;
  terminationDate: SerialDate;
  frequency: string;
  calendar: SwapLeg["calendar"];
  businessDayConvention?: SwapLeg["businessDayConvention"];
  stub?: SwapLeg["stub"];
  endOfMonth?: boolean;
  roll?: SwapLeg["roll"];
}

/**
 * Notional path of an IR hedging instrument in the hedged currency: the leg in
 * that currency (swaps, swaption underlying) or the cap/floor strip itself,
 * with its `notionalSchedule` when it amortises.
 */
function instrumentNotionalPath(trade: Trade, hedgedCcy: string): { periods?: PeriodSource; schedule?: { date: SerialDate; notional: number }[] } {
  if (trade.type === "CapFloor") {
    return {
      periods: {
        effectiveDate: trade.effectiveDate,
        terminationDate: trade.terminationDate,
        frequency: trade.frequency,
        calendar: trade.calendar,
        businessDayConvention: trade.businessDayConvention,
        stub: trade.stub,
      },
      schedule: trade.notionalSchedule,
    };
  }
  const legs = instrumentLegs(trade);
  const leg = legs.find((l) => l.currency.toUpperCase() === hedgedCcy) ?? legs[0];
  return leg ? { periods: leg, schedule: leg.notionalSchedule } : {};
}

// ---------------------------------------------------------------------------
// Hypothetical derivative
// ---------------------------------------------------------------------------

/**
 * Build the hypothetical derivative (IFRS 9 B6.5.5) that perfectly hedges the
 * hedged item, valued with the market `ctx` of the designation date.
 *
 * - Floating-rate loan: a swap with the loan's notional × hedge ratio, dates
 *   and index, fixed rate = par rate at designation (PV ≈ 0), fixed leg in the
 *   direction of the hedging instrument (payer swap for a borrower).
 * - Fixed-rate loan (fair value hedge): same, but carrying the loan coupon
 *   when `hedgedItem.fixedRate` is given so the fixed leg replicates the
 *   hedged cash flows; falls back to the par rate.
 * - Forecast FX cash flow / FX receivable: an outright forward for the hedged
 *   amount × hedge ratio at the fair forward rate at designation, delivering on
 *   `maturityDate`, in the direction of the hedging instrument (default: sell
 *   the foreign currency for an inflow, buy for an outflow).
 * - Amortising items (`notionalSchedule` / `amortisation`): the notional path
 *   is transferred to both legs of the hypothetical swap (or to the
 *   hypothetical cap's `notionalSchedule`).
 * - Cap/floor as hedging instrument (IFRS 9 B6.5.29, IDW RS HFA 35 Tz. 60):
 *   a hypothetical cap/floor with the hedged item's currency, notional (path),
 *   dates and index, the instrument's strike(s), direction and model;
 *   volatility from the market the hypothetical is valued in (the designation
 *   market when given; frozen with `freezeDesignationVol`). FX option as
 *   hedging instrument: a hypothetical option with the same strike, expiry,
 *   delivery and type on the hedged amount.
 *
 * @throws when terms are insufficient (unknown counter currency, matured item, no par rate).
 */
export function hypotheticalDerivative(ctx: MarketContext, rel: HedgeRelationship, hedgingInstrument: Trade): Trade {
  const item = rel.hedgedItem;
  const hedgedCcy = item.currency.toUpperCase();
  const terms = instrumentTerms(hedgingInstrument, hedgedCcy);
  const id = `HYPO-${rel.id}`;
  const name = `Hypothetisches Derivat ${rel.name}`;

  if (isFxKind(item.kind)) {
    if (item.maturityDate <= ctx.valuationDate)
      throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `Hedged FX cash flow of ${rel.id} is not in the future of the market date`);
    const other = counterCurrency(rel, hedgingInstrument);
    const amount = hedgedPortionNotional(rel);
    if (hedgingInstrument.type === "FxOption" && !hedgingInstrument.barrier && !hedgingInstrument.digital) {
      // Hypothetical option: same strike / expiry / delivery / type on the hedged amount.
      const { base, quote } = splitPair(hedgingInstrument.pair);
      const notional = base === hedgedCcy ? amount : quote === hedgedCcy ? amount / hedgingInstrument.strike : undefined;
      if (notional === undefined)
        throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `FX option ${hedgingInstrument.id} does not reference hedged currency ${hedgedCcy}`);
      const hypo: FxOption = {
        id,
        name,
        type: "FxOption",
        payReceive: hedgingInstrument.payReceive,
        optionType: hedgingInstrument.optionType,
        pair: hedgingInstrument.pair,
        strike: hedgingInstrument.strike,
        notional,
        expiryDate: hedgingInstrument.expiryDate,
        deliveryDate: hedgingInstrument.deliveryDate,
        premiumCurrency: hedgingInstrument.premiumCurrency,
        volOverride: hedgingInstrument.volOverride,
      };
      return hypo;
    }
    const sells = terms.sellsHedgedCurrency ?? (item.amount ?? item.notional) >= 0;
    const fwd = fxForwardRate(ctx, hedgedCcy, other, item.maturityDate); // units of `other` per 1 hedged
    const trade: FxForward = sells
      ? {
          id,
          name,
          type: "FxForward",
          buyCurrency: other,
          buyAmount: amount * fwd,
          sellCurrency: hedgedCcy,
          sellAmount: amount,
          deliveryDate: item.maturityDate,
        }
      : {
          id,
          name,
          type: "FxForward",
          buyCurrency: hedgedCcy,
          buyAmount: amount,
          sellCurrency: other,
          sellAmount: amount * fwd,
          deliveryDate: item.maturityDate,
        };
    return trade;
  }

  const index = item.index ?? terms.index;
  const notional = hedgedPortionNotional(rel);
  const schedule = hedgedItemNotionalSchedule(rel);

  if (hedgingInstrument.type === "CapFloor") {
    // Hypothetical cap/floor with the hedged item's terms and the instrument's strike(s).
    const cap = makeCapFloor({
      id,
      currency: hedgedCcy,
      notional,
      capFloor: hedgingInstrument.capFloor,
      strike: hedgingInstrument.strike,
      floorStrike: hedgingInstrument.floorStrike,
      effectiveDate: item.effectiveDate,
      maturity: item.maturityDate,
      index,
      longShort: hedgingInstrument.payReceive === "Receive" ? "Long" : "Short",
    });
    return {
      ...cap,
      name,
      model: hedgingInstrument.model,
      shift: hedgingInstrument.shift,
      volOverride: hedgingInstrument.volOverride,
      frequency: hedgingInstrument.frequency,
      ...(schedule ? { notionalSchedule: schedule } : {}),
    };
  }

  const direction: PayReceive = terms.fixedDirection ?? (item.kind === "FloatingRateLoan" ? "Pay" : "Receive");
  const common = { currency: hedgedCcy, notional, payReceiveFixed: direction, effectiveDate: item.effectiveDate, maturity: item.maturityDate, index };
  const withSchedule = (swap: ReturnType<typeof makeVanillaSwap>) =>
    schedule ? { ...swap, legs: swap.legs.map((l) => ({ ...l, notionalSchedule: schedule })) } : swap;
  let fixedRate = item.kind === "FixedRateLoan" ? item.fixedRate : undefined;
  if (fixedRate === undefined) {
    const probe = withSchedule(makeVanillaSwap({ ...common, id: `${id}-PROBE`, fixedRate: 0 }));
    const par = priceTrade(ctx, probe, hedgedCcy).analytics.parRate;
    if (typeof par !== "number" || !Number.isFinite(par))
      throw new PricingError("INVALID_HEDGE_RELATIONSHIP", `Par rate for hypothetical derivative of ${rel.id} not available`);
    fixedRate = par;
  }
  return withSchedule(makeVanillaSwap({ ...common, id, name, fixedRate }));
}

// ---------------------------------------------------------------------------
// Critical terms
// ---------------------------------------------------------------------------

/**
 * Compare the critical terms of hedged item (scaled by the hedge ratio) and
 * hedging instrument: notional, currency, effective/maturity dates (within
 * `toleranceDays`) and floating index. Terms not defined for the instrument
 * type are reported as not applicable and do not affect `matches`.
 */
export function criticalTermsMatch(
  rel: HedgeRelationship,
  hedgingInstrument: Trade,
  opts: { toleranceDays?: number; notionalTolerance?: number } = {},
): CriticalTermsResult {
  const toleranceDays = opts.toleranceDays ?? DEFAULT_TOLERANCE_DAYS;
  const notionalTolerance = opts.notionalTolerance ?? DEFAULT_NOTIONAL_TOLERANCE;
  const item = rel.hedgedItem;
  const hedgedCcy = item.currency.toUpperCase();
  const terms = instrumentTerms(hedgingInstrument, hedgedCcy);
  const fx = isFxKind(item.kind);
  const checks: CriticalTermCheck[] = [];

  const hedgedNotional = hedgedPortionNotional(rel);
  const instNotional = terms.notional !== undefined ? Math.abs(terms.notional) : undefined;
  checks.push({
    term: "notional",
    hedgedItem: formatDe(hedgedNotional, 2),
    hedgingInstrument: instNotional !== undefined ? formatDe(instNotional, 2) : "n/a",
    applicable: instNotional !== undefined,
    match:
      instNotional !== undefined && Math.abs(instNotional - hedgedNotional) <= notionalTolerance * Math.max(Math.abs(instNotional), Math.abs(hedgedNotional)),
  });

  const instCcys = terms.currencies.map((c) => c.toUpperCase());
  checks.push({
    term: "currency",
    hedgedItem: hedgedCcy,
    hedgingInstrument: instCcys.join("/"),
    applicable: true,
    match: instCcys.includes(hedgedCcy),
  });

  const effApplicable = !fx && terms.effectiveDate !== undefined;
  checks.push({
    term: "effectiveDate",
    hedgedItem: formatDateDe(item.effectiveDate),
    hedgingInstrument: terms.effectiveDate !== undefined ? formatDateDe(terms.effectiveDate) : "n/a",
    applicable: effApplicable,
    match: effApplicable && Math.abs(terms.effectiveDate! - item.effectiveDate) <= toleranceDays,
  });

  const matApplicable = terms.maturityDate !== undefined;
  checks.push({
    term: "maturityDate",
    hedgedItem: formatDateDe(item.maturityDate),
    hedgingInstrument: terms.maturityDate !== undefined ? formatDateDe(terms.maturityDate) : "n/a",
    applicable: matApplicable,
    match: matApplicable && Math.abs(terms.maturityDate! - item.maturityDate) <= toleranceDays,
  });

  const idxApplicable = !fx && item.index !== undefined && terms.index !== undefined;
  checks.push({
    term: "index",
    hedgedItem: item.index ?? "n/a",
    hedgingInstrument: terms.index ?? "n/a",
    applicable: idxApplicable,
    match: idxApplicable && item.index!.toUpperCase() === terms.index!.toUpperCase(),
  });

  // Notional path (Tilgungsplan): compare the outstanding notional period-wise when either side amortises
  // (swap legs, swaption underlying or an amortising cap/floor strip).
  if (!fx) {
    const itemSchedule = hedgedItemNotionalSchedule(rel);
    const { periods: instPeriods, schedule: instSchedule } = instrumentNotionalPath(hedgingInstrument, hedgedCcy);
    const applicable = (itemSchedule !== undefined && itemSchedule.length > 0) || (instSchedule !== undefined && instSchedule.length > 0);
    if (applicable) {
      const periodStarts = instPeriods
        ? buildSchedule({
            effectiveDate: instPeriods.effectiveDate,
            terminationDate: instPeriods.terminationDate,
            frequency: instPeriods.frequency,
            calendar: instPeriods.calendar,
            businessDayConvention: instPeriods.businessDayConvention ?? "ModifiedFollowing",
            stub: instPeriods.stub ?? "ShortFront",
            endOfMonth: instPeriods.endOfMonth ?? false,
            roll: instPeriods.roll,
          }).periods.map((p) => p.accrualStart)
        : buildSchedule({ ...itemScheduleLeg(item) }).periods.map((p) => p.accrualStart);
      const instBase = instNotional ?? hedgedNotional;
      const itemPath = periodStarts.map((d) => scheduleValueAt(itemSchedule, d, (e) => e.notional, hedgedNotional));
      const instPath = periodStarts.map((d) => scheduleValueAt(instSchedule, d, (e) => Math.abs(e.notional), instBase));
      const mismatches = periodStarts.filter((_, i) => Math.abs(instPath[i]! - itemPath[i]!) > notionalTolerance * Math.max(itemPath[i]!, instPath[i]!, 1e-12));
      const describe = (path: number[]) =>
        `${formatDe(path[0]!, 0)} → ${formatDe(path[path.length - 1]!, 0)} (${path.length} Perioden${path.some((n) => Math.abs(n - path[0]!) > 1e-9) ? ", amortisierend" : ", konstant"})`;
      checks.push({
        term: "notionalSchedule",
        hedgedItem: describe(itemPath),
        hedgingInstrument: `${describe(instPath)}${mismatches.length ? `; Abweichung in ${mismatches.length} Periode(n), erste ${formatDateDe(mismatches[0]!)}` : ""}`,
        applicable: true,
        match: mismatches.length === 0,
      });
    } else {
      checks.push({ term: "notionalSchedule", hedgedItem: "konstant", hedgingInstrument: "konstant", applicable: false, match: true });
    }
  }

  return { matches: checks.filter((c) => c.applicable).every((c) => c.match), checks, toleranceDays, notionalTolerance };
}

// ---------------------------------------------------------------------------
// Dollar offset
// ---------------------------------------------------------------------------

/**
 * Dollar-offset ratio ΔPV(hedging instrument) / ΔPV(hypothetical derivative)
 * between two market states (signed). Use designation → today for the
 * cumulative test, previous period → today for the period test, or today →
 * shocked market for a prospective test. A vanishing ΔPV of the hypothetical
 * makes the ratio undefined (`assessable: false`).
 */
export function dollarOffset(
  ctx0: MarketContext,
  ctx1: MarketContext,
  hedgingInstrument: Trade,
  hypothetical: Trade,
  opts: { band?: [number, number]; reportingCurrency?: string; minAbsDelta?: number; designation?: HedgeDesignation } = {},
): DollarOffsetResult {
  const band = opts.band ?? DEFAULT_EFFECTIVENESS_BAND;
  const ccy = opts.reportingCurrency ?? defaultReportingCurrency(hedgingInstrument);
  const minAbs = opts.minAbsDelta ?? MIN_ABS_DELTA;
  const d = opts.designation;
  const pvHedge0 = hedgeValue(ctx0, hedgingInstrument, ccy, d);
  const pvHedge1 = hedgeValue(ctx1, hedgingInstrument, ccy, d);
  const pvHypothetical0 = hedgeValue(ctx0, hypothetical, ccy, d);
  const pvHypothetical1 = hedgeValue(ctx1, hypothetical, ccy, d);
  const deltaHedge = pvHedge1 - pvHedge0;
  const deltaHypothetical = pvHypothetical1 - pvHypothetical0;
  const assessable = Math.abs(deltaHypothetical) > minAbs && Number.isFinite(deltaHedge);
  const ratio = assessable ? deltaHedge / deltaHypothetical : undefined;
  const effective = ratio !== undefined && ratio >= band[0] && ratio <= band[1];
  return { currency: ccy, pvHedge0, pvHedge1, pvHypothetical0, pvHypothetical1, deltaHedge, deltaHypothetical, ratio, band, assessable, effective };
}

function defaultReportingCurrency(trade: Trade): string {
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return trade.legs[0]!.currency;
    case "Swaption":
      return trade.underlying.legs[0]!.currency;
    case "FRA":
    case "CapFloor":
      return trade.currency;
    case "FxForward":
      return trade.sellCurrency;
    case "FxSwap":
      return trade.nearLeg.sellCurrency;
    case "FxOption":
      return splitPair(trade.pair).quote;
  }
}

// ---------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------

/** Basis shocks (bp) applied to a single projection curve when the hedged item's index differs from the instrument's. */
const BASIS_REGRESSION_SHOCKS_BP = [10, 25];
/** Discount (OIS) basis shocks (bp) applied to the discount curve alone. */
const DISCOUNT_BASIS_SHOCKS_BP = [25];

export interface RegressionScenarioOptions {
  /** Foreign currency of an FX hedge: adds spot shocks ±1…±10 %. */
  fxCurrency?: string;
  /**
   * Projection curves shocked one at a time (±10 / ±25bp) to expose tenor
   * basis ineffectiveness (hedged item on 3M EURIBOR vs. swap on 6M, €STR loan
   * vs. EURIBOR swap). Parallel shocks of all curves cannot reveal it.
   */
  basisCurveIds?: string[];
  /** Discount curves shocked alone (±25bp) to expose OIS-basis ineffectiveness. */
  discountCurveIds?: string[];
}

/**
 * Basis scenarios: every curve in `basisCurveIds` shocked alone by
 * ±10 / ±25bp (tenor basis) and every curve in `discountCurveIds` alone by
 * ±25bp (OIS / discount basis).
 */
export function basisScenarios(basisCurveIds: string[] = [], discountCurveIds: string[] = []): ScenarioDefinition[] {
  const out: ScenarioDefinition[] = [];
  for (const id of basisCurveIds) {
    for (const bp of BASIS_REGRESSION_SHOCKS_BP) {
      for (const sign of [1, -1]) {
        const s = sign * bp;
        out.push({ id: `basis-${id}${s > 0 ? "+" : ""}${s}`, name: `Basis ${id} ${s > 0 ? "+" : ""}${s}bp`, curveShifts: [{ target: id, parallelBp: s }] });
      }
    }
  }
  for (const id of discountCurveIds) {
    for (const bp of DISCOUNT_BASIS_SHOCKS_BP) {
      for (const sign of [1, -1]) {
        const s = sign * bp;
        out.push({
          id: `ois-${id}${s > 0 ? "+" : ""}${s}`,
          name: `Diskont-Basis ${id} ${s > 0 ? "+" : ""}${s}bp`,
          curveShifts: [{ target: id, parallelBp: s }],
        });
      }
    }
  }
  return out;
}

/** True when every curve shift of the scenario set hits all curves at once ("*" or a whole currency) – no single-curve basis shock. */
export function hasOnlyParallelCurveShocks(scenarios: ScenarioDefinition[]): boolean {
  return scenarios.every((s) => (s.curveShifts ?? []).every((cs) => cs.target === "*" || /^[A-Z]{3}$/.test(cs.target)));
}

/**
 * Default scenario set for the regression test: parallel shifts −200…+200bp in
 * 25bp steps (excluding 0), steepener and flattener from `STANDARD_SCENARIOS`,
 * when `fxCurrency` is given spot shocks ±1…±10 % of that currency, and when
 * `basisCurveIds` / `discountCurveIds` are given the single-curve basis
 * shocks of `basisScenarios`.
 */
export function regressionScenarios(opts: RegressionScenarioOptions = {}): ScenarioDefinition[] {
  const out: ScenarioDefinition[] = [];
  for (let bp = -200; bp <= 200; bp += 25) {
    if (bp === 0) continue;
    out.push({ id: `par${bp > 0 ? "+" : ""}${bp}`, name: `Zinsen ${bp > 0 ? "+" : ""}${bp}bp`, curveShifts: [{ target: "*", parallelBp: bp }] });
  }
  for (const id of ["steep", "flat"]) {
    const s = STANDARD_SCENARIOS.find((x) => x.id === id);
    if (s) out.push(s);
  }
  if (opts.fxCurrency) {
    const ccy = opts.fxCurrency.toUpperCase();
    for (const pct of FX_REGRESSION_SHOCKS_PCT) {
      for (const sign of [1, -1]) {
        const p = sign * pct;
        out.push({ id: `fx-${ccy}${p > 0 ? "+" : ""}${p}`, name: `${ccy} ${p > 0 ? "+" : ""}${p} %`, fxShiftsPct: { [ccy]: p } });
      }
    }
  }
  out.push(...basisScenarios(opts.basisCurveIds, opts.discountCurveIds));
  return out;
}

/**
 * Curves for the basis scenarios of an IR hedge with an index mismatch: the
 * projection curves of the hedged item's and the instrument's indices (those
 * present in `ctx`) and the discount curve of the hedged currency.
 */
export function basisCurvesFor(
  ctx: MarketContext,
  hedgedCcy: string,
  itemIndex: string,
  instrumentIndex: string,
): { basisCurveIds: string[]; discountCurveIds: string[] } {
  const basis = new Set<string>();
  for (const name of [itemIndex, instrumentIndex]) {
    try {
      const id = getIndex(name).curveId;
      if (ctx.curves[id]) basis.add(id);
    } catch {
      // unknown index → no curve to shock
    }
  }
  const disc = ctx.discountCurveId[hedgedCcy.toUpperCase()];
  const discountCurveIds = disc && ctx.curves[disc] ? [disc] : [];
  // A discount curve that also projects one of the indices (OIS-indexed leg) is already covered as basis curve.
  return { basisCurveIds: [...basis].filter((id) => !discountCurveIds.includes(id)), discountCurveIds };
}

/** Ordinary least squares y = a + b·x. Undefined for n < 3 or degenerate x. */
export function olsRegression(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } | undefined {
  const n = points.length;
  if (n < 3) return undefined;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (!(sxx > 0) || !Number.isFinite(sxx) || !Number.isFinite(sxy)) return undefined;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, r2 };
}

/**
 * Regression-based effectiveness test: OLS of ΔPV(hedging instrument) on
 * ΔPV(hypothetical derivative) across `scenarios` (default: see
 * `regressionScenarios`; FX shocks are added automatically for FX hedging
 * instruments). Effective if the slope lies in `slopeBand` and R² ≥ `minR2`.
 */
export function regressionTest(
  ctx: MarketContext,
  hedgingInstrument: Trade,
  hypothetical: Trade,
  scenarios?: ScenarioDefinition[],
  opts: {
    slopeBand?: [number, number];
    minR2?: number;
    reportingCurrency?: string;
    fxCurrency?: string;
    minAbsDelta?: number;
    /** Single-curve basis shocks added to the default scenario set (see `basisScenarios`). */
    basisCurveIds?: string[];
    discountCurveIds?: string[];
    /** Option designation: under "IntrinsicValue" both sides are measured on intrinsic value. */
    designation?: HedgeDesignation;
  } = {},
): RegressionResult {
  const slopeBand = opts.slopeBand ?? DEFAULT_EFFECTIVENESS_BAND;
  const minR2 = opts.minR2 ?? DEFAULT_MIN_R2;
  const ccy = opts.reportingCurrency ?? defaultReportingCurrency(hedgingInstrument);
  const minAbs = opts.minAbsDelta ?? MIN_ABS_DELTA;
  let fxCurrency = opts.fxCurrency;
  if (fxCurrency === undefined && isFxTrade(hedgingInstrument)) {
    fxCurrency = tradeCurrencies(hedgingInstrument).find((c) => c !== ccy);
  }
  const set = scenarios ?? regressionScenarios({ fxCurrency, basisCurveIds: opts.basisCurveIds, discountCurveIds: opts.discountCurveIds });
  const d = opts.designation;
  const base0 = hedgeValue(ctx, hedgingInstrument, ccy, d);
  const base1 = hedgeValue(ctx, hypothetical, ccy, d);
  const points: RegressionPoint[] = set.map((s) => {
    const shifted = applyScenario(ctx, s);
    return {
      scenarioId: s.id,
      deltaHedge: hedgeValue(shifted, hedgingInstrument, ccy, d) - base0,
      deltaHypothetical: hedgeValue(shifted, hypothetical, ccy, d) - base1,
    };
  });
  const maxHypo = points.reduce((m, p) => Math.max(m, Math.abs(p.deltaHypothetical)), 0);
  const fit = maxHypo > minAbs ? olsRegression(points.map((p) => ({ x: p.deltaHypothetical, y: p.deltaHedge }))) : undefined;
  const assessable = fit !== undefined;
  const effective = fit !== undefined && fit.slope >= slopeBand[0] && fit.slope <= slopeBand[1] && fit.r2 >= minR2;
  return { currency: ccy, n: points.length, slope: fit?.slope, intercept: fit?.intercept, r2: fit?.r2, slopeBand, minR2, assessable, effective, points };
}

// ---------------------------------------------------------------------------
// Accounting split
// ---------------------------------------------------------------------------

/** Offsetting portion: sign of ΔH, magnitude min(|ΔH|, |ΔI|); zero when the changes do not offset. */
function effectivePortion(deltaHedge: number, deltaHypothetical: number): number {
  if (deltaHedge * deltaHypothetical <= 0) return 0;
  return Math.sign(deltaHedge) * Math.min(Math.abs(deltaHedge), Math.abs(deltaHypothetical));
}

/**
 * IFRS 9 split of cumulative fair value changes. Cash flow hedge (6.5.11):
 * the cash flow hedge reserve is the lower of |ΔH| and |ΔI| (with the sign of
 * ΔH), any excess of the hedging instrument goes to P&L. Fair value hedge
 * (6.5.8): both ΔH and the hedged item adjustment −ΔI are booked to P&L.
 */
export function ifrs9Split(hedgeType: HedgeType, deltaHedge: number, deltaHypothetical: number, assessable = true): Ifrs9Result {
  const dH = assessable ? deltaHedge : 0;
  const dI = assessable ? deltaHypothetical : 0;
  const eff = effectivePortion(dH, dI);
  if (hedgeType === "CashFlowHedge") {
    return {
      hedgeType,
      assessable,
      hedgingInstrumentChange: dH,
      hypotheticalChange: dI,
      hedgedItemChange: -dI,
      effectivePortion: eff,
      oci: eff,
      pnl: dH - eff,
      pnlComponents: { hedgingInstrument: dH - eff, hedgedItemAdjustment: 0 },
    };
  }
  return {
    hedgeType,
    assessable,
    hedgingInstrumentChange: dH,
    hypotheticalChange: dI,
    hedgedItemChange: -dI,
    effectivePortion: eff,
    oci: 0,
    pnl: dH - dI,
    pnlComponents: { hedgingInstrument: dH, hedgedItemAdjustment: -dI },
  };
}

/**
 * HGB § 254 Bewertungseinheit (IDW RS HFA 35): the offsetting portion is not
 * recognised (Einfrierung) or booked gross and nets to zero (Durchbuchung);
 * a negative ineffective excess requires a Drohverlustrückstellung (§ 249
 * HGB), a positive excess is not recognised (Realisationsprinzip).
 */
export function hgbSplit(deltaHedge: number, deltaHypothetical: number, assessable = true): HgbResult {
  const dH = assessable ? deltaHedge : 0;
  const dI = assessable ? deltaHypothetical : 0;
  const eff = effectivePortion(dH, dI);
  const excess = dH - dI;
  const provision = Math.max(0, -excess);
  return {
    assessable,
    hedgingInstrumentChange: dH,
    hedgedItemChange: -dI,
    effectiveNetted: eff,
    ineffectiveExcess: excess,
    drohverlustrueckstellung: provision,
    unrecognisedGain: Math.max(0, excess),
    einfrierungsmethode: { frozenHedgingInstrument: eff, frozenHedgedItem: -eff, recognisedPnl: -provision },
    durchbuchungsmethode: { hedgingInstrumentBooked: eff, hedgedItemBooked: -eff, ineffectiveBooked: -provision, netPnl: -provision },
  };
}

// ---------------------------------------------------------------------------
// Volatility at designation (frozen hypothetical option vol)
// ---------------------------------------------------------------------------

/**
 * Volatility (decimal, in the hypothetical's model units) the designation
 * market implies for a hypothetical option, to be frozen as `volOverride`:
 * - FX option / swaption: the surface vol at the option's strike and expiry
 *   (`analytics.volatility` of the designation-date valuation).
 * - Cap/floor/collar: the flat vol that reproduces the strip's PV on the
 *   designation market (implied flat cap vol); falls back to the caplet
 *   surface vol at the strike and the last caplet expiry when no root exists
 *   (e.g. zero PV of a deep out-of-the-money strip).
 * Returns undefined when the option already carries a `volOverride` or no
 * volatility can be determined.
 */
export function designationVol(designationCtx: MarketContext, hypothetical: Trade, reportingCurrency: string): number | undefined {
  if (!isOptionTrade(hypothetical) || hypothetical.volOverride !== undefined) return undefined;
  const priced = priceTrade(designationCtx, hypothetical, reportingCurrency);
  if (hypothetical.type !== "CapFloor") {
    const v = priced.analytics.volatility;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  }
  // Cap/floor: implied flat vol of the strip on the designation market.
  const key = capletSurfaceKeysFor(designationCtx, hypothetical)[0];
  const surface = key ? designationCtx.capletVols?.[key] : undefined;
  const tLast = Math.max(1e-6, yearFraction(designationCtx.valuationDate, hypothetical.terminationDate, "ACT/365F"));
  const fallback = surface ? capletVol(surface, tLast, hypothetical.strike) : undefined;
  const target = priced.pv;
  const pvAt = (vol: number) => priceTrade(designationCtx, { ...hypothetical, volOverride: vol }, reportingCurrency).pv - target;
  const guess = fallback ?? (priced.analytics.model === "Bachelier" ? 0.006 : 0.2);
  try {
    const vol = solveBracketed(pvAt, guess, guess * 0.25, { minX: 1e-6, maxX: 10, tolerance: 1e-12 });
    return Number.isFinite(vol) && vol > 0 ? vol : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Full effectiveness assessment for a hedge relationship at the market `ctx`:
 * critical terms, prospective dollar-offset (current vs. +100bp / +10 % spot),
 * retrospective dollar-offset (when `designationCtx` is supplied), regression,
 * the verdict per the designated method, and the IFRS 9 / HGB accounting
 * amounts with a German summary for the hedge documentation.
 */
export function hedgeEffectivenessReport(
  ctx: MarketContext,
  rel: HedgeRelationship,
  hedgingInstrument: Trade,
  opts: HedgeReportOptions = {},
): HedgeEffectivenessReport {
  const warnings: string[] = [];
  const pricingWarnings: string[] = [];
  const item = rel.hedgedItem;
  const hedgedCcy = item.currency.toUpperCase();
  const ratio = hedgeRatioOf(rel);
  const fx = isFxKind(item.kind);
  const band = opts.band ?? DEFAULT_EFFECTIVENESS_BAND;
  const minR2 = opts.minR2 ?? DEFAULT_MIN_R2;
  const ccy = reportingCurrencyFor(rel, hedgingInstrument, opts.reportingCurrency);
  const designation: HedgeDesignation = rel.designation ?? "FullFairValue";
  const optionInstrument = isOptionTrade(hedgingInstrument);

  if (rel.hedgingInstrumentId !== hedgingInstrument.id) {
    warnings.push(`Übergebenes Sicherungsinstrument (${hedgingInstrument.id}) entspricht nicht der designierten Trade-ID (${rel.hedgingInstrumentId}).`);
  }
  const designationCtx = opts.designationCtx;
  if (designationCtx && designationCtx.valuationDate !== rel.designationDate) {
    warnings.push(
      `Stichtag der Designationsmarktdaten (${formatDateDe(designationCtx.valuationDate)}) weicht vom Designationsdatum (${formatDateDe(rel.designationDate)}) ab.`,
    );
  }
  if (!designationCtx) {
    warnings.push(
      "Keine Marktdaten zum Designationszeitpunkt übergeben – das hypothetische Derivat wird zu aktuellen Marktkonditionen konstruiert; retrospektive Messung und Aufteilung der kumulierten Wertänderungen sind nicht beurteilbar.",
    );
  }
  if (designationCtx && designationCtx.valuationDate > ctx.valuationDate) {
    warnings.push("Designationsstichtag liegt nach dem Bewertungsstichtag.");
  }

  const terms = instrumentTerms(hedgingInstrument, hedgedCcy);
  if (terms.maturityDate !== undefined && terms.maturityDate <= ctx.valuationDate) {
    warnings.push(`Sicherungsinstrument ist am Bewertungsstichtag bereits fällig (${formatDateDe(terms.maturityDate)}).`);
  }
  if (item.maturityDate <= ctx.valuationDate) {
    warnings.push(`Grundgeschäft ist am Bewertungsstichtag bereits fällig (${formatDateDe(item.maturityDate)}).`);
  }
  const portion = hedgedPortionNotional(rel);
  if (terms.notional !== undefined && portion > 0) {
    const actual = Math.abs(terms.notional) / (portion / ratio);
    if (Math.abs(actual - ratio) > 0.01 * ratio) {
      warnings.push(
        `Designierte Hedge Ratio ${fmtNum(ratio, 4)} entspricht nicht dem Verhältnis der tatsächlichen Volumina (${fmtNum(actual, 4)}) – Konsistenz nach IFRS 9 B6.4.9–B6.4.11 prüfen.`,
      );
    }
  }

  // Hypothetical derivative at designation (or current market as proxy).
  const hypoCtx = designationCtx ?? ctx;
  let hypothetical = opts.hypothetical ?? hypotheticalDerivative(hypoCtx, rel, hedgingInstrument);
  let frozenVol: number | undefined;
  if (opts.freezeDesignationVol) {
    if (!designationCtx) {
      warnings.push(
        "Volatilität zum Designationszeitpunkt kann ohne Designationsmarktdaten nicht eingefroren werden – hypothetisches Derivat wird auf der aktuellen Fläche bewertet.",
      );
    } else if (isOptionTrade(hypothetical) && hypothetical.volOverride === undefined) {
      frozenVol = designationVol(designationCtx, hypothetical, ccy);
      if (frozenVol !== undefined) hypothetical = { ...hypothetical, volOverride: frozenVol };
      else
        warnings.push(
          "Volatilität des hypothetischen Derivats konnte aus den Designationsmarktdaten nicht bestimmt werden – Bewertung auf der aktuellen Fläche.",
        );
    }
  }
  const pvHedge = pv(ctx, hedgingInstrument, ccy, pricingWarnings);
  const pvHypo = pv(ctx, hypothetical, ccy, pricingWarnings);

  // Option designation (IFRS 9 6.5.15): intrinsic-value measurement and cost of hedging.
  let costOfHedging: CostOfHedging | undefined;
  if (designation === "IntrinsicValue") {
    if (!optionInstrument) {
      warnings.push(
        "Designation „innerer Wert“ ist nur für Optionen als Sicherungsinstrument vorgesehen – lineares Instrument wird mit der vollen Fair-Value-Änderung gemessen.",
      );
    } else {
      const now = intrinsicValue(ctx, hedgingInstrument, ccy);
      const then = designationCtx ? intrinsicValue(designationCtx, hedgingInstrument, ccy) : undefined;
      costOfHedging = {
        currency: ccy,
        timeValue: now.timeValue,
        intrinsicValue: now.intrinsic,
        timeValueAtDesignation: then?.timeValue,
        change: then ? now.timeValue - then.timeValue : undefined,
      };
    }
  } else if (optionInstrument && !isOptionTrade(hypothetical)) {
    warnings.push(
      "Option als Sicherungsinstrument gegen ein lineares hypothetisches Derivat gemessen – der Zeitwert der Option erzeugt Ineffektivität; Designation des inneren Werts (IFRS 9 6.5.15, Zeitwert als Cost of Hedging im OCI) prüfen.",
    );
  }
  const measure = { band, reportingCurrency: ccy, designation };

  // Tests
  const criticalTerms = criticalTermsMatch(rel, hedgingInstrument, { toleranceDays: opts.toleranceDays, notionalTolerance: opts.notionalTolerance });
  const prospectiveScenario: ScenarioDefinition =
    opts.prospectiveScenario ??
    (fx
      ? { id: "hedge-prospective-fx", name: `${hedgedCcy} +10 %`, fxShiftsPct: { [hedgedCcy]: 10 } }
      : { id: "hedge-prospective-ir", name: "Zinsen +100bp", curveShifts: [{ target: "*", parallelBp: 100 }] });
  const dollarOffsetProspective = dollarOffset(ctx, applyScenario(ctx, prospectiveScenario), hedgingInstrument, hypothetical, measure);
  const dollarOffsetCumulative = designationCtx ? dollarOffset(designationCtx, ctx, hedgingInstrument, hypothetical, measure) : undefined;
  const dollarOffsetPeriod = opts.previousCtx ? dollarOffset(opts.previousCtx, ctx, hedgingInstrument, hypothetical, measure) : dollarOffsetCumulative;

  // Basis (index / discount) scenarios when the hedged item's index differs from the instrument's (IFRS 9 B6.4.14, IDW RS HFA 35 Tz. 51).
  const itemIndex = item.index;
  const instrumentIndex = terms.index;
  const indexMismatch = !fx && itemIndex !== undefined && instrumentIndex !== undefined && itemIndex.toUpperCase() !== instrumentIndex.toUpperCase();
  let basisCurveIds: string[] = [];
  let discountCurveIds: string[] = [];
  let dollarOffsetBasis: DollarOffsetResult | undefined;
  if (indexMismatch) {
    ({ basisCurveIds, discountCurveIds } = basisCurvesFor(ctx, hedgedCcy, itemIndex, instrumentIndex));
    const itemCurve = safeCurveId(itemIndex);
    const shockCurve = itemCurve && ctx.curves[itemCurve] ? itemCurve : basisCurveIds[0];
    if (shockCurve) {
      const basisScenario: ScenarioDefinition = {
        id: "hedge-prospective-basis",
        name: `Basis ${shockCurve} +25bp`,
        curveShifts: [{ target: shockCurve, parallelBp: 25 }],
      };
      dollarOffsetBasis = dollarOffset(ctx, applyScenario(ctx, basisScenario), hedgingInstrument, hypothetical, measure);
    }
    if (basisCurveIds.length === 0 && discountCurveIds.length === 0) {
      warnings.push(
        `Referenzzins des Grundgeschäfts (${itemIndex}) weicht vom Sicherungsinstrument (${instrumentIndex}) ab, aber keine Projektionskurve der Indizes im Marktkontext – Basis-Szenarien nicht möglich.`,
      );
    }
  }
  const useBasis = indexMismatch && (opts.basisScenarios ?? true) && opts.regressionScenarios === undefined;
  const regression = regressionTest(ctx, hedgingInstrument, hypothetical, opts.regressionScenarios, {
    slopeBand: band,
    minR2,
    reportingCurrency: ccy,
    fxCurrency: fx ? hedgedCcy : undefined,
    basisCurveIds: useBasis ? basisCurveIds : undefined,
    discountCurveIds: useBasis ? discountCurveIds : undefined,
    designation,
  });
  const basisScenarioIds = regression.points.map((p) => p.scenarioId).filter((id) => id.startsWith("basis-") || id.startsWith("ois-"));
  const parallelOnly = opts.regressionScenarios ? hasOnlyParallelCurveShocks(opts.regressionScenarios) : basisScenarioIds.length === 0;
  if (indexMismatch && parallelOnly) {
    warnings.push(
      `Regression ohne Basis-Szenarien: Referenzzins des Grundgeschäfts (${itemIndex}) ≠ Sicherungsinstrument (${instrumentIndex}); reine Parallelschocks erfassen die Tenor-/OIS-Basis als Quelle von Ineffektivität nicht (IFRS 9 B6.4.14, IDW RS HFA 35 Tz. 51).`,
    );
  }
  if (dollarOffsetBasis?.assessable && !dollarOffsetBasis.effective) {
    warnings.push(
      `Basis-Szenario (${dollarOffsetBasis.currency}): Dollar-Offset ${dollarOffsetBasis.ratio !== undefined ? fmtPct(dollarOffsetBasis.ratio) : "n/a"} außerhalb des Korridors – Tenor-/OIS-Basis ist eine Quelle von Ineffektivität (Index-Mismatch ${itemIndex} vs. ${instrumentIndex}).`,
    );
  }

  if (dollarOffsetCumulative && portion > 0 && Math.abs(dollarOffsetCumulative.pvHedge0) > 0.001 * portion) {
    warnings.push(
      `Sicherungsinstrument war bei Designation nicht marktgerecht (Barwert ${fmtAmount(dollarOffsetCumulative.pvHedge0, ccy)}) – Quelle von Ineffektivität (IFRS 9 B6.5.5, Off-Market-Derivat).`,
    );
  }
  if (!dollarOffsetProspective.assessable) {
    warnings.push("Prospektiver Dollar-Offset nicht beurteilbar: keine messbare Wertänderung des hypothetischen Derivats im Schockszenario.");
  }
  if (!regression.assessable) {
    warnings.push("Regression nicht beurteilbar: zu wenige Szenarien oder keine Wertänderung des hypothetischen Derivats.");
  }
  if (dollarOffsetCumulative && !dollarOffsetCumulative.assessable) {
    warnings.push("Kumulierter Dollar-Offset nicht beurteilbar: keine Wertänderung des hypothetischen Derivats seit Designation.");
  }

  // Verdict per method
  const effectiveByMethod: Record<EffectivenessMethod, boolean> = {
    CriticalTerms: criticalTerms.matches,
    DollarOffset:
      dollarOffsetProspective.effective && (dollarOffsetCumulative === undefined || !dollarOffsetCumulative.assessable || dollarOffsetCumulative.effective),
    Regression: regression.effective,
  };
  const assessableByMethod: Record<EffectivenessMethod, boolean> = {
    CriticalTerms: true,
    DollarOffset: dollarOffsetProspective.assessable,
    Regression: regression.assessable,
  };
  const effective = effectiveByMethod[rel.method];
  const assessable = assessableByMethod[rel.method];
  if (rel.method === "CriticalTerms" && criticalTerms.matches && !dollarOffsetProspective.effective && dollarOffsetProspective.assessable) {
    warnings.push("Critical-Terms-Match erfüllt, aber prospektiver Dollar-Offset außerhalb des Korridors – qualitative Beurteilung überprüfen.");
  }

  // Accounting amounts (cumulative since designation)
  const cumAssessable = dollarOffsetCumulative !== undefined;
  const dH = dollarOffsetCumulative?.deltaHedge ?? 0;
  const dI = dollarOffsetCumulative?.deltaHypothetical ?? 0;
  const ifrs9 = ifrs9Split(rel.type, dH, dI, cumAssessable);
  const hgb = hgbSplit(dH, dI, cumAssessable);

  const summary = buildSummary({
    rel,
    hedgingInstrument,
    ccy,
    ratio,
    portion,
    pvHedge,
    pvHypo,
    criticalTerms,
    dollarOffsetProspective,
    dollarOffsetBasis,
    dollarOffsetCumulative,
    dollarOffsetPeriod,
    regression,
    basisScenarioIds,
    effective,
    assessable,
    ifrs9,
    hgb,
    prospectiveName: prospectiveScenario.name,
    valuationDate: ctx.valuationDate,
    designation,
    costOfHedging,
    hypothetical,
    frozenVol,
  });

  return {
    relationshipId: rel.id,
    relationshipName: rel.name,
    hedgeType: rel.type,
    accountingFramework: rel.accountingFramework,
    method: rel.method,
    designation,
    costOfHedging,
    valuationDate: toISO(ctx.valuationDate),
    designationDate: toISO(rel.designationDate),
    reportingCurrency: ccy,
    hedgeRatio: ratio,
    hedgingInstrument: { id: hedgingInstrument.id, name: hedgingInstrument.name, type: hedgingInstrument.type, pv: pvHedge },
    hypotheticalDerivative: { trade: hypothetical, pv: pvHypo, ...(frozenVol !== undefined ? { frozenVol } : {}) },
    criticalTerms,
    dollarOffsetProspective,
    dollarOffsetBasis,
    dollarOffsetCumulative,
    dollarOffsetPeriod,
    regression,
    basisScenarioIds,
    effectiveByMethod,
    effective,
    assessable,
    ifrs9,
    hgb,
    summary,
    warnings,
    pricingWarnings: Array.from(new Set(pricingWarnings)),
  };
}

// ---------------------------------------------------------------------------
// German summary / formatting
// ---------------------------------------------------------------------------

const TERM_LABELS: Record<CriticalTermCheck["term"], string> = {
  notional: "Nominal",
  currency: "Währung",
  effectiveDate: "Laufzeitbeginn",
  maturityDate: "Fälligkeit",
  index: "Referenzzins",
  notionalSchedule: "Nominalverlauf",
};

const KIND_LABELS: Record<HedgedItemKind, string> = {
  FloatingRateLoan: "variabel verzinsliches Darlehen",
  FixedRateLoan: "festverzinsliches Darlehen",
  ForecastFxCashflow: "erwartete Fremdwährungszahlung",
  FxReceivable: "Fremdwährungsforderung",
};

const METHOD_LABELS: Record<EffectivenessMethod, string> = {
  DollarOffset: "Dollar-Offset-Methode",
  Regression: "Regressionsanalyse",
  CriticalTerms: "Critical-Terms-Match",
};

function fmtNum(x: number, digits = 2): string {
  return formatDe(x, digits);
}

function fmtAmount(x: number, ccy: string): string {
  return `${fmtNum(x, 2)} ${ccy}`;
}

function fmtPct(x: number, digits = 1): string {
  return `${fmtNum(x * 100, digits)} %`;
}

function verdict(r: { assessable: boolean; effective: boolean }): string {
  if (!r.assessable) return "nicht beurteilbar";
  return r.effective ? "effektiv" : "nicht effektiv";
}

function describeOffset(label: string, r: DollarOffsetResult): string {
  const ratio = r.ratio !== undefined ? fmtPct(r.ratio) : "n/a";
  return `Dollar-Offset ${label}: ΔBW Sicherungsinstrument ${fmtAmount(r.deltaHedge, r.currency)}, ΔBW hypothetisches Derivat ${fmtAmount(r.deltaHypothetical, r.currency)}, Quotient ${ratio} (Korridor ${fmtPct(r.band[0], 0)}–${fmtPct(r.band[1], 0)}) → ${verdict(r)}.`;
}

interface SummaryInput {
  rel: HedgeRelationship;
  hedgingInstrument: Trade;
  ccy: string;
  ratio: number;
  portion: number;
  pvHedge: number;
  pvHypo: number;
  criticalTerms: CriticalTermsResult;
  dollarOffsetProspective: DollarOffsetResult;
  dollarOffsetBasis?: DollarOffsetResult;
  dollarOffsetCumulative?: DollarOffsetResult;
  dollarOffsetPeriod?: DollarOffsetResult;
  regression: RegressionResult;
  basisScenarioIds: string[];
  effective: boolean;
  assessable: boolean;
  ifrs9: Ifrs9Result;
  hgb: HgbResult;
  prospectiveName: string;
  valuationDate: SerialDate;
  designation: HedgeDesignation;
  costOfHedging?: CostOfHedging;
  hypothetical: Trade;
  frozenVol?: number;
}

const AMORTISATION_LABELS: Record<HedgedItemAmortisation["type"], string> = {
  Linear: "linearer Tilgungsplan",
  Annuity: "Annuitätentilgung",
  Custom: "individueller Tilgungsplan",
};

function buildSummary(s: SummaryInput): string[] {
  const { rel, ccy } = s;
  const item = rel.hedgedItem;
  const typeLabel = rel.type === "CashFlowHedge" ? "Cashflow-Hedge" : "Fair-Value-Hedge";
  const frameworkLabel = rel.accountingFramework === "IFRS9" ? "IFRS 9" : "HGB § 254 (BilMoG, IDW RS HFA 35)";
  const out: string[] = [];
  out.push(
    `Sicherungsbeziehung „${rel.name}“ (${rel.id}): ${typeLabel} nach ${frameworkLabel}, designiert am ${formatDateDe(rel.designationDate)}, Bewertungsstichtag ${formatDateDe(s.valuationDate)}.`,
  );
  const amort = item.notionalSchedule?.length
    ? `, Tilgungsplan (${item.notionalSchedule.length} Stufen)`
    : item.amortisation
      ? `, ${AMORTISATION_LABELS[item.amortisation.type]}`
      : "";
  out.push(
    `Grundgeschäft: ${item.description} (${KIND_LABELS[item.kind]}, ${fmtAmount(Math.abs(item.amount ?? item.notional), item.currency)}${item.index ? `, ${item.index}` : ""}${item.fixedRate !== undefined ? `, Kupon ${fmtPct(item.fixedRate, 3)}` : ""}${amort}, ${formatDateDe(item.effectiveDate)} – ${formatDateDe(item.maturityDate)}); gesicherter Anteil ${fmtPct(s.ratio, 1)} = ${fmtAmount(s.portion, item.currency)}.`,
  );
  out.push(
    `Sicherungsinstrument: ${s.hedgingInstrument.name ?? s.hedgingInstrument.id} (${tradeTypeLabelDe(s.hedgingInstrument.type)}), Barwert ${fmtAmount(s.pvHedge, ccy)}; hypothetisches Derivat (${tradeTypeLabelDe(s.hypothetical.type)}) Barwert ${fmtAmount(s.pvHypo, ccy)}.`,
  );
  if (s.frozenVol !== undefined) {
    out.push(
      `Volatilität des hypothetischen Derivats zum Designationszeitpunkt eingefroren (${s.hypothetical.type === "CapFloor" && (s.hypothetical.model ?? "Bachelier") === "Bachelier" ? `${fmtNum(s.frozenVol * 1e4, 2)} bp Normal-Vol` : fmtPct(s.frozenVol, 3)}) – Wertänderungen des hypothetischen Derivats resultieren nur aus Zins-/Kursänderungen, nicht aus Volatilitätsbewegungen.`,
    );
  }
  if (isOptionTrade(s.hedgingInstrument)) {
    if (s.designation === "IntrinsicValue" && s.costOfHedging) {
      const c = s.costOfHedging;
      out.push(
        `Designation des inneren Werts (IFRS 9 6.5.15 / IDW RS HFA 35 Tz. 60): Effektivität auf Basis der Änderung des inneren Werts gemessen; innerer Wert ${fmtAmount(c.intrinsicValue, ccy)}, Zeitwert ${fmtAmount(c.timeValue, ccy)}${c.change !== undefined ? `, Zeitwertänderung seit Designation ${fmtAmount(c.change, ccy)} → Cost of Hedging (OCI, separate Eigenkapitalkomponente)` : " (Zeitwertänderung seit Designation ohne Designationsmarktdaten nicht ermittelbar)"}.`,
      );
    } else {
      out.push("Designation zum vollen Fair Value: Zeitwertänderungen der Option gehen in die Effektivitätsmessung ein.");
    }
  }
  const applicable = s.criticalTerms.checks.filter((c) => c.applicable);
  const matched = applicable.filter((c) => c.match);
  const mismatches = applicable.filter((c) => !c.match).map((c) => `${TERM_LABELS[c.term]} (${c.hedgedItem} vs. ${c.hedgingInstrument})`);
  out.push(
    `Critical-Terms-Match: ${s.criticalTerms.matches ? "erfüllt" : "nicht erfüllt"} (${matched.length} von ${applicable.length} wesentlichen Ausstattungsmerkmalen übereinstimmend${mismatches.length ? `; Abweichungen: ${mismatches.join(", ")}` : ""}).`,
  );
  out.push(describeOffset(`prospektiv (${s.prospectiveName})`, s.dollarOffsetProspective));
  if (s.dollarOffsetBasis) out.push(describeOffset("prospektiv Basis-Szenario (Projektionskurve des Grundgeschäfts +25bp, informativ)", s.dollarOffsetBasis));
  if (s.dollarOffsetCumulative) out.push(describeOffset("retrospektiv kumuliert seit Designation", s.dollarOffsetCumulative));
  else out.push("Dollar-Offset retrospektiv: nicht beurteilbar (keine Marktdaten zum Designationszeitpunkt).");
  if (s.dollarOffsetPeriod && s.dollarOffsetPeriod !== s.dollarOffsetCumulative) out.push(describeOffset("Periode", s.dollarOffsetPeriod));
  const reg = s.regression;
  const basisNote = s.basisScenarioIds.length ? `, davon ${s.basisScenarioIds.length} Basis-Szenarien (Tenor-/OIS-Basis einzelner Kurven)` : "";
  out.push(
    reg.assessable
      ? `Regressionsanalyse (n = ${reg.n} Szenarien${basisNote}): Steigung ${fmtNum(reg.slope ?? 0, 4)} (Korridor ${fmtNum(reg.slopeBand[0], 2)}–${fmtNum(reg.slopeBand[1], 2)}), Achsenabschnitt ${fmtAmount(reg.intercept ?? 0, ccy)}, R² ${fmtNum(reg.r2 ?? 0, 4)} (min. ${fmtNum(reg.minR2, 2)}) → ${verdict(reg)}.`
      : `Regressionsanalyse (n = ${reg.n} Szenarien${basisNote}): nicht beurteilbar.`,
  );
  out.push(
    `Ergebnis nach designierter Methode (${METHOD_LABELS[rel.method]}): Sicherungsbeziehung ${verdict({ assessable: s.assessable, effective: s.effective })}.`,
  );

  const i9 = s.ifrs9;
  if (i9.assessable) {
    if (rel.type === "CashFlowHedge") {
      out.push(
        `IFRS 9 Cashflow-Hedge (kumuliert seit Designation): Wertänderung Sicherungsinstrument ${fmtAmount(i9.hedgingInstrumentChange, ccy)}, Wertänderung Grundgeschäft (gesichertes Risiko) ${fmtAmount(i9.hedgedItemChange, ccy)}; effektiver Teil in die Cashflow-Hedge-Rücklage (OCI) ${fmtAmount(i9.oci, ccy)}, Ineffektivität in der GuV ${fmtAmount(i9.pnl, ccy)}.`,
      );
    } else {
      out.push(
        `IFRS 9 Fair-Value-Hedge (kumuliert seit Designation): Sicherungsinstrument ${fmtAmount(i9.pnlComponents.hedgingInstrument, ccy)} und Buchwertanpassung Grundgeschäft ${fmtAmount(i9.pnlComponents.hedgedItemAdjustment, ccy)} erfolgswirksam; Netto-Ineffektivität in der GuV ${fmtAmount(i9.pnl, ccy)}.`,
      );
    }
    const h = s.hgb;
    out.push(
      `HGB § 254 Bewertungseinheit: kompensierter (effektiver) Teil ${fmtAmount(h.effectiveNetted, ccy)} wird nicht bilanziert; ineffektiver Überhang ${fmtAmount(h.ineffectiveExcess, ccy)}${h.drohverlustrueckstellung > 0 ? ` → Drohverlustrückstellung ${fmtAmount(h.drohverlustrueckstellung, ccy)} (§ 249 HGB)` : h.unrecognisedGain > 0 ? " → unrealisierter Gewinn, nicht zu vereinnahmen (Realisationsprinzip)" : ""}.`,
    );
    out.push(
      `Einfrierungsmethode: Wertänderungen ${fmtAmount(h.einfrierungsmethode.frozenHedgingInstrument, ccy)} (Sicherungsinstrument) und ${fmtAmount(h.einfrierungsmethode.frozenHedgedItem, ccy)} (Grundgeschäft) bleiben unberücksichtigt; GuV-Effekt ${fmtAmount(h.einfrierungsmethode.recognisedPnl, ccy)}.`,
    );
    out.push(
      `Durchbuchungsmethode: Buchung ${fmtAmount(h.durchbuchungsmethode.hedgingInstrumentBooked, ccy)} (Sicherungsinstrument) gegen ${fmtAmount(h.durchbuchungsmethode.hedgedItemBooked, ccy)} (Grundgeschäft), ineffektiver Teil ${fmtAmount(h.durchbuchungsmethode.ineffectiveBooked, ccy)}; GuV-Effekt netto ${fmtAmount(h.durchbuchungsmethode.netPnl, ccy)}.`,
    );
  } else {
    out.push(
      "Bilanzielle Aufteilung (IFRS 9 OCI/GuV bzw. HGB Einfrierungs-/Durchbuchungsmethode): nicht ermittelbar ohne Marktdaten zum Designationszeitpunkt.",
    );
  }
  return out;
}
