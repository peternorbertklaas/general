import { type BusinessDayConvention, type CalendarId } from "../dates/calendar.js";
import { type SerialDate } from "../dates/date.js";
import { type DayCountConvention } from "../dates/daycount.js";
import { type StubType } from "../dates/schedule.js";
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
  paymentLag?: number;
  /** Amortisation: explicit notional per period index (overrides `notional`). */
  notionalSchedule?: { date: SerialDate; notional: number }[];
  /** Exchange notional at start/end (cross-currency swaps). */
  notionalExchange?: { initial: boolean; final: boolean; interim?: boolean };
}

export interface FixedLeg extends LegBase {
  type: "Fixed";
  rate: number;
}

export interface FloatLeg extends LegBase {
  type: "Float";
  index: string;
  spread?: number;
  /** Fixing lag override in business days. */
  fixingLag?: number;
  /** Optional embedded cap/floor on the coupon. */
  capRate?: number;
  floorRate?: number;
  /** Gearing (multiplier) on the index. */
  gearing?: number;
  /** For OIS legs: compounding ("Compound" default) or averaging. */
  compounding?: "Compound" | "Average";
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

export type Trade =
  | InterestRateSwap
  | ForwardRateAgreement
  | CapFloor
  | Swaption
  | FxForward
  | FxSwap
  | FxOption
  | CrossCurrencySwap;

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
  /** Instrument-specific analytics (par rate, forward, implied vol, Greeks, ...). */
  analytics: Record<string, number | string | undefined>;
  /** Accrued interest in reporting currency (dirty vs clean split). */
  accrued?: number;
  warnings: string[];
  timingMs?: number;
}
