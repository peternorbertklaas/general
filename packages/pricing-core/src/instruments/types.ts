import { type BusinessDayConvention, type CalendarId } from "../dates/calendar.js";
import { type SerialDate } from "../dates/date.js";
import { type DayCountConvention } from "../dates/daycount.js";
import { type RollConvention, type StubType } from "../dates/schedule.js";
import { type OptionType } from "../models/black.js";
import { type BarrierType } from "../models/garman-kohlhagen.js";

export type PayReceive = "Pay" | "Receive";

export interface TradeBase {
  id: string;
  /** Human readable name / external reference. */
  name?: string;
  counterparty?: string;
  book?: string;
  /** Trade date (informational). */
  tradeDate?: SerialDate;
  /** Collateral currency (CSA) – selects discount curve. Undefined = uncollateralised. */
  collateralCurrency?: string;
  /** Premium/upfront paid (positive = we pay) on `upfrontDate`. */
  upfront?: { amount: number; currency: string; date: SerialDate };
  tags?: string[];
  /**
   * Lifecycle status (informational): indicative quote, firm quote ("Quoted",
   * valid until `quoteValidUntil`), live trade, matured or cancelled.
   */
  status?: "Indication" | "Quoted" | "Live" | "Matured" | "Cancelled";
  /** Validity of a firm quote (status "Quoted"); informational. */
  quoteValidUntil?: SerialDate;
  /** Unique Transaction Identifier (EMIR Refit / UTI, ISO 23897) – reported in the EMIR valuation export. */
  uti?: string;
  /** Centrally cleared (EMIR Art. 4 / 4a clearing obligation). Undefined = bilateral / unknown. */
  cleared?: boolean;
  /** Clearing member (when `cleared`), informational. */
  clearingMember?: string;
}

export interface LegBase {
  payReceive: PayReceive;
  notional: number;
  currency: string;
  effectiveDate: SerialDate;
  terminationDate: SerialDate;
  frequency: string;
  dayCount: DayCountConvention;
  calendar: CalendarId;
  businessDayConvention?: BusinessDayConvention;
  stub?: StubType;
  endOfMonth?: boolean;
  /** Roll convention of the unadjusted dates ("IMM" = third Wednesdays, e.g. IMM swaps). */
  roll?: RollConvention;
  paymentLag?: number;
  /** Amortisation: explicit notional per period index (overrides `notional`). */
  notionalSchedule?: { date: SerialDate; notional: number }[];
  /** Exchange notional at start/end (cross-currency swaps). */
  notionalExchange?: { initial: boolean; final: boolean; interim?: boolean };
}

export interface FixedLeg extends LegBase {
  type: "Fixed";
  rate: number;
  /**
   * Coupon schedule (step-up / step-down): the last entry with `date` ≤ the
   * period's accrual start applies; periods before the first entry use `rate`
   * (same rule as `notionalSchedule`).
   */
  rateSchedule?: { date: SerialDate; rate: number }[];
}

export interface FloatLeg extends LegBase {
  type: "Float";
  index: string;
  spread?: number;
  /**
   * Spread schedule (decimal): the last entry with `date` ≤ the period's
   * accrual start applies; periods before the first entry use `spread`.
   */
  spreadSchedule?: { date: SerialDate; spread: number }[];
  /** Fixing lag override in business days. */
  fixingLag?: number;
  /** Optional embedded cap/floor on the coupon. */
  capRate?: number;
  floorRate?: number;
  /** Gearing (multiplier) on the index. */
  gearing?: number;
  /** For OIS legs: compounding ("Compound" default) or averaging. */
  compounding?: "Compound" | "Average";
  /** RFR conventions: lookback (business days the observation period is shifted back per fixing). */
  lookbackDays?: number;
  /** Observation shift: weights taken from the shifted observation period (true) vs. lookback without shift (false). */
  observationShift?: boolean;
}

export type SwapLeg = FixedLeg | FloatLeg;

export interface InterestRateSwap extends TradeBase {
  type: "InterestRateSwap";
  legs: SwapLeg[];
}

export interface ForwardRateAgreement extends TradeBase {
  type: "FRA";
  payReceive: PayReceive; // Pay = pay fixed
  notional: number;
  currency: string;
  index: string;
  startDate: SerialDate;
  endDate: SerialDate;
  fixedRate: number;
  dayCount?: DayCountConvention;
}

export interface CapFloor extends TradeBase {
  type: "CapFloor";
  capFloor: "Cap" | "Floor" | "Collar";
  payReceive: PayReceive; // Receive = long the option(s)
  notional: number;
  currency: string;
  index: string;
  effectiveDate: SerialDate;
  terminationDate: SerialDate;
  frequency: string;
  dayCount: DayCountConvention;
  calendar: CalendarId;
  strike: number;
  /** Floor strike for collars (long cap, short floor when payReceive=Receive). */
  floorStrike?: number;
  /**
   * Amortisation: outstanding notional per period (the last entry with `date`
   * ≤ the period's accrual start applies, periods before the first entry use
   * `notional`) – same rule as `LegBase.notionalSchedule`, so the hypothetical
   * cap of an amortising hedged item carries the loan's notional path.
   */
  notionalSchedule?: { date: SerialDate; notional: number }[];
  businessDayConvention?: BusinessDayConvention;
  stub?: StubType;
  /** Model override: "Bachelier" (default) or "Black" / "ShiftedBlack". */
  model?: "Bachelier" | "Black" | "ShiftedBlack";
  /** Flat vol override (decimal). */
  volOverride?: number;
  shift?: number;
}

export interface Swaption extends TradeBase {
  type: "Swaption";
  payReceive: PayReceive; // Receive = long the option
  payerReceiver: "Payer" | "Receiver";
  expiryDate: SerialDate;
  settlement: "Physical" | "Cash";
  /**
   * Cash-settlement convention. "CollateralisedCashPrice" (EUR market standard since 2018/ICE
   * Swap Rate) values the cash-settled option with the discount (physical) annuity;
   * "IRR" is the legacy yield-based cash annuity. Default: CollateralisedCashPrice.
   */
  cashSettlementConvention?: "CollateralisedCashPrice" | "IRR";
  underlying: InterestRateSwap;
  model?: "Bachelier" | "Black" | "ShiftedBlack";
  volOverride?: number;
  shift?: number;
}

export interface FxForward extends TradeBase {
  type: "FxForward";
  /** We buy `buyCurrency` amount and sell `sellCurrency` amount on `deliveryDate`. */
  buyCurrency: string;
  buyAmount: number;
  sellCurrency: string;
  sellAmount: number;
  deliveryDate: SerialDate;
  /** Non-deliverable: cash settled in `settlementCurrency` at fixing. */
  ndf?: { fixingDate: SerialDate; settlementCurrency: string };
}

export interface FxSwap extends TradeBase {
  type: "FxSwap";
  nearLeg: Omit<FxForward, "type" | "id">;
  farLeg: Omit<FxForward, "type" | "id">;
}

export interface FxOption extends TradeBase {
  type: "FxOption";
  payReceive: PayReceive; // Receive = long
  optionType: OptionType; // Call on base currency
  /** Pair "EURUSD": call = right to buy EUR (base) against USD (quote). */
  pair: string;
  strike: number;
  /** Notional in base currency. */
  notional: number;
  expiryDate: SerialDate;
  deliveryDate: SerialDate;
  exercise?: "European";
  /** Premium currency for display: base or quote. */
  premiumCurrency?: string;
  barrier?: { type: BarrierType; level: number; rebate?: number };
  digital?: { payoutCurrency: string; payout: number };
  volOverride?: number;
}

export interface CrossCurrencySwap extends TradeBase {
  type: "CrossCurrencySwap";
  legs: SwapLeg[];
  /** Mark-to-market resetting of the notional on one leg (constant-notional otherwise). */
  mtmReset?: { resettingLegIndex: number };
}

export type Trade = InterestRateSwap | ForwardRateAgreement | CapFloor | Swaption | FxForward | FxSwap | FxOption | CrossCurrencySwap;

export type TradeType = Trade["type"];

export interface Cashflow {
  legIndex: number;
  legType: string;
  currency: string;
  accrualStart?: SerialDate;
  accrualEnd?: SerialDate;
  paymentDate: SerialDate;
  fixingDate?: SerialDate;
  /** Notional for the period. */
  notional: number;
  /** Fixed rate or projected/fixed floating rate (decimal). */
  rate?: number;
  /** Year fraction. */
  accrualFactor?: number;
  /** Undiscounted amount, signed from our perspective (+ receive / - pay). */
  amount: number;
  discountFactor: number;
  presentValue: number;
  /** Whether the rate came from a historical fixing. */
  isFixed?: boolean;
  /**
   * Accrued interest of this period up to the valuation date (signed, leg
   * currency). Only set on the period containing the valuation date; for
   * compounded RFR legs this is the realised compounding to date.
   */
  accrued?: number;
  kind: "Interest" | "Notional" | "Premium" | "OptionPayoff" | "Settlement";
}

export interface LegResult {
  legIndex: number;
  legType: string;
  currency: string;
  pv: number;
  pvReporting: number;
  /** Annuity (sum of df * tau * notional) – for par rates. */
  annuity?: number;
  cashflows: Cashflow[];
}

export interface PricingResult {
  tradeId: string;
  tradeType: TradeType;
  valuationDate: SerialDate;
  /** Reporting currency for `pv`. */
  currency: string;
  /** PV in reporting currency, positive = asset to us. */
  pv: number;
  legs: LegResult[];
  /**
   * Instrument-specific analytics (par rate, forward, implied vol, Greeks, ...).
   * Contract: numeric measures (numbers) plus short enumerated strings (e.g.
   * `model`, `kind`, `mtmReset: "yes" | "no"`). Dates are **not** serial numbers
   * here – they live in `details` as ISO strings. The only legacy exception is
   * the swap `maturity` (serial date, kept for backward compatibility and
   * mirrored as `details.maturity`).
   *
   * FX delta contract (FxOption, FxForward, FxSwap):
   * - `deltaAmount` – money amount in the reporting currency: PV change for a
   *   +1 % spot move of the base currency (FX option: pair base; forward / FX
   *   swap: the (near-leg) buy currency) against the other currency. Linear
   *   instruments: ±(reporting-currency PV of the leg in the moving currency) × 1 %.
   * - `deltaPct` – FX options only: the signed spot delta as a fraction of
   *   the notional (long call ≈ +0,5 ATM, long put ≈ −0,5), i.e.
   *   deltaAmount / (1 % of the notional in reporting currency); in [−1, 1]
   *   for vanillas. Linear FX trades do not report it (their delta is ±1).
   */
  analytics: Record<string, number | string | undefined>;
  /**
   * Non-numeric details (ISO dates, identifiers) that complement `analytics`,
   * e.g. `spotDate` of FX trades, `fixingDate` of FRAs, `maturity` of swaps.
   */
  details?: Record<string, string | undefined>;
  /** Accrued interest in reporting currency (dirty vs clean split). */
  accrued?: number;
  warnings: string[];
  timingMs?: number;
}
