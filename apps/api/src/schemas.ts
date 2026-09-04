/**
 * JSON Schemas for request validation (Fastify/Ajv) and OpenAPI response
 * contracts.
 *
 * Trades are validated as a discriminated union (`oneOf` per `type`, Ajv
 * `discriminator`), legs as Fixed (requires `rate`) / Float (requires
 * `index`). Every enum-typed field of `packages/pricing-core/src/instruments/
 * types.ts` is mirrored here; `additionalProperties: false` rejects typos and
 * unknown fields (Ajv runs with `removeAdditional: false`, see app.ts). The
 * pricing core still performs the deep semantic validation (curves, fixings,
 * dates) – a trade that cannot be priced is rejected with 422.
 *
 * Response schemas: fast-json-stringify coerces declared `number` properties
 * (`null` → 0, `NaN` → throws), so financial figures are deliberately left
 * untyped (`{ description }`) and objects keep `additionalProperties: true`.
 * The contract value lies in the documented property names, the error
 * envelope and the status codes.
 */
const isoDate = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO-8601 date (YYYY-MM-DD)" } as const;
export const isoDateTime = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$",
  description: "ISO-8601 UTC timestamp",
} as const;
const currency = { type: "string", pattern: "^[A-Z]{3}$", description: "ISO-4217 currency code" } as const;
const currencyPair = { type: "string", pattern: "^[A-Z]{6}$", description: 'Currency pair "EURUSD" (1 EUR = x USD)' } as const;
const payReceive = { type: "string", enum: ["Pay", "Receive"] } as const;
const positiveNumber = { type: "number", exclusiveMinimum: 0 } as const;
/**
 * Upper bound for notionals and cash amounts (10 trillion in units of the currency). Amounts like
 * `1e300` are not trades but numeric-overflow probes; they are rejected at the schema (400
 * VALIDATION_ERROR) instead of producing a PV of ±1e298 (review R5, cosmetic).
 */
export const MAX_AMOUNT = 1e13;
const amount = {
  type: "number",
  exclusiveMinimum: 0,
  maximum: MAX_AMOUNT,
  description: `Amount in currency units (0 < x ≤ ${MAX_AMOUNT.toExponential(0)})`,
} as const;
const signedAmount = {
  type: "number",
  minimum: -MAX_AMOUNT,
  maximum: MAX_AMOUNT,
  description: `Signed amount in currency units (|x| ≤ ${MAX_AMOUNT.toExponential(0)})`,
} as const;
const shortText = { type: "string", maxLength: 200 } as const;

export const TRADE_ID_PATTERN = "^[A-Za-z0-9._-]{1,64}$";
export const tradeId = { type: "string", pattern: TRADE_ID_PATTERN, description: "Trade id: letters, digits, `.`, `_`, `-` (max. 64)" } as const;

export const TRADE_TYPES = ["InterestRateSwap", "FRA", "CapFloor", "Swaption", "FxForward", "FxSwap", "FxOption", "CrossCurrencySwap"] as const;

// ---------------------------------------------------------------------------
// Enum fields mirrored from the core's TypeScript types
// ---------------------------------------------------------------------------
export const DAY_COUNTS = [
  "ACT/360",
  "ACT/365F",
  "ACT/365",
  "ACT/ACT",
  "ACT/ACT ISDA",
  "ACT/ACT ICMA",
  "30/360",
  "30U/360",
  "30E/360",
  "30E/360 ISDA",
  "1/1",
  "BUS/252",
] as const;
export const BUSINESS_DAY_CONVENTIONS = ["Following", "ModifiedFollowing", "Preceding", "ModifiedPreceding", "Unadjusted"] as const;
export const STUB_TYPES = ["ShortFront", "LongFront", "ShortBack", "LongBack", "None"] as const;
export const ROLL_CONVENTIONS = ["Default", "IMM"] as const;
export const TRADE_STATUS = ["Indication", "Quoted", "Live", "Matured", "Cancelled"] as const;
export const IR_MODELS = ["Bachelier", "Black", "ShiftedBlack"] as const;
export const BARRIER_TYPES = ["UpIn", "UpOut", "DownIn", "DownOut"] as const;
/** `InterpolationMethod` of the core (curves/bootstrap and snapshot import). */
export const INTERPOLATIONS = ["linear", "logLinear", "linearZero", "cubicSplineZero", "flatForward", "monotoneConvex"] as const;
export const CURVE_EXTRAPOLATIONS = ["flatForward", "flatZero"] as const;
export const CURVE_QUOTE_TYPES = ["Deposit", "FRA", "Swap", "OIS", "Future", "BasisSwap", "XccyBasis", "FxSwapPoints"] as const;

const dayCount = { type: "string", enum: [...DAY_COUNTS] } as const;
const calendar = { type: "string", minLength: 1, maxLength: 40, description: 'Calendar id, e.g. "TARGET", "US", "UK", "TARGET+US"' } as const;
/**
 * Coupon frequency. Upper-case tenor with a non-zero count or `ZC` (single
 * zero-coupon period – the core's token for "term"). The number of periods a
 * leg implies is bounded separately (`lib/limits.ts`: ≤ 1200 per leg →
 * otherwise 400 `TOO_MANY_PERIODS`), so `1D` stays valid for short OIS legs
 * but not for a 100-year swap.
 */
export const FREQUENCY_PATTERN = "^([1-9]\\d{0,2}[DWMY]|ZC)$";
const frequency = {
  type: "string",
  pattern: FREQUENCY_PATTERN,
  description:
    'Coupon frequency as tenor ("1M", "3M", "6M", "1Y", "1W", "1D") or "ZC" (zero coupon); estimated periods per leg ≤ 1200, else 400 TOO_MANY_PERIODS',
} as const;
const rateIndex = { type: "string", minLength: 1, maxLength: 32, description: 'Floating-rate index, e.g. "EURIBOR-6M", "ESTR", "SOFR"' } as const;
const rate = { type: "number", minimum: -1, maximum: 1, description: "Rate as decimal (0.03 = 3 %)" } as const;

// ---------------------------------------------------------------------------
// Trade base + legs
// ---------------------------------------------------------------------------
const tradeBaseProperties = {
  id: tradeId,
  name: shortText,
  counterparty: shortText,
  book: shortText,
  tradeDate: isoDate,
  collateralCurrency: { ...currency, description: "Collateral currency (CSA) – selects the discount curve; omit for uncollateralised" },
  upfront: {
    type: "object",
    required: ["amount", "currency", "date"],
    properties: { amount: signedAmount, currency, date: isoDate },
    additionalProperties: false,
  },
  tags: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 20 },
  status: { type: "string", enum: [...TRADE_STATUS], description: 'Lifecycle status; "Quoted" = firm quote valid until `quoteValidUntil`' },
  quoteValidUntil: { ...isoDate, description: 'Validity of a firm quote (status "Quoted"); informational' },
  uti: { type: "string", pattern: "^[A-Za-z0-9]{1,52}$", description: "Unique Transaction Identifier (EMIR Refit, ISO 23897) – reported in the EMIR export" },
  cleared: { type: "boolean", description: "Centrally cleared (EMIR Art. 4/4a) – EMIR Refit ITS Table 2 field 31 (Cleared)" },
  clearingObligation: {
    type: "boolean",
    description:
      "Subject to the clearing obligation (Art. 4 EMIR: counterparty classification, product class, thresholds) – EMIR Refit ITS Table 2 field 30. Independent of `cleared` (voluntary clearing ⇒ false, mandatory but uncleared ⇒ true); omitted ⇒ reported as N/A, never derived from `cleared`",
  },
  clearingMember: { ...shortText, description: "Clearing member when `cleared` (EMIR Refit ITS Table 1, counterparty data)" },
} as const;

/** Step schedule `{ date, value }[]`: the last entry with `date` ≤ the period's accrual start applies. */
const stepSchedule = (valueKey: "rate" | "spread", value: unknown, description: string) =>
  ({
    type: "array",
    maxItems: 1000,
    description,
    items: { type: "object", required: ["date", valueKey], properties: { date: isoDate, [valueKey]: value }, additionalProperties: false },
  }) as const;

const legBaseProperties = {
  payReceive,
  notional: amount,
  currency,
  effectiveDate: isoDate,
  terminationDate: isoDate,
  frequency,
  dayCount,
  calendar,
  businessDayConvention: { type: "string", enum: [...BUSINESS_DAY_CONVENTIONS] },
  stub: { type: "string", enum: [...STUB_TYPES] },
  endOfMonth: { type: "boolean" },
  roll: { type: "string", enum: [...ROLL_CONVENTIONS] },
  paymentLag: { type: "integer", minimum: 0, maximum: 30 },
  notionalSchedule: {
    type: "array",
    maxItems: 1000,
    items: {
      type: "object",
      required: ["date", "notional"],
      properties: { date: isoDate, notional: { type: "number", minimum: 0, maximum: MAX_AMOUNT } },
      additionalProperties: false,
    },
  },
  notionalExchange: {
    type: "object",
    required: ["initial", "final"],
    properties: { initial: { type: "boolean" }, final: { type: "boolean" }, interim: { type: "boolean" } },
    additionalProperties: false,
  },
} as const;

const legRequired = ["type", "payReceive", "notional", "currency", "effectiveDate", "terminationDate", "frequency", "dayCount", "calendar"] as const;

const fixedLegSchemaBase = {
  type: "object",
  required: [...legRequired, "rate"],
  properties: {
    type: { type: "string", enum: ["Fixed"] },
    ...legBaseProperties,
    rate,
    rateSchedule: stepSchedule("rate", rate, "Step-up / step-down coupon; periods before the first entry use `rate`"),
  },
  additionalProperties: false,
} as const;

const floatLegSchemaBase = {
  type: "object",
  required: [...legRequired, "index"],
  properties: {
    type: { type: "string", enum: ["Float"] },
    ...legBaseProperties,
    index: rateIndex,
    spread: { type: "number", minimum: -1, maximum: 1 },
    spreadSchedule: stepSchedule(
      "spread",
      { type: "number", minimum: -1, maximum: 1 },
      "Spread schedule (decimal); periods before the first entry use `spread`",
    ),
    fixingLag: { type: "integer", minimum: 0, maximum: 10 },
    capRate: rate,
    floorRate: rate,
    gearing: { type: "number", minimum: -10, maximum: 10 },
    compounding: { type: "string", enum: ["Compound", "Average"] },
    lookbackDays: { type: "integer", minimum: 0, maximum: 10 },
    observationShift: { type: "boolean" },
    lockoutDays: {
      type: "integer",
      minimum: 0,
      maximum: 10,
      description:
        "RFR compounding lockout (R8, N8-7): the fixing of the business day `end − lockoutDays` (fixing calendar of the index) applies to the remaining `lockoutDays` business days of the period (2–5 days in SOFR/€STR loan documentation); default 0",
    },
  },
  additionalProperties: false,
} as const;

/**
 * Shared (named) schemas: every variant of the trade union and of the leg
 * union is registered with `app.addSchema` under its `$id`, the unions
 * reference them by `$ref`. Ajv resolves the `$ref`s for the `discriminator`
 * check; in the OpenAPI document they become `components.schemas.<Name>` and
 * `discriminator.mapping` (see `openApiTransform` in app.ts) instead of
 * anonymous `def-N` entries with inline `oneOf` branches (N3-02).
 */
export const fixedLegSchema = { $id: "FixedLeg", title: "FixedLeg", ...fixedLegSchemaBase } as const;
export const floatLegSchema = { $id: "FloatLeg", title: "FloatLeg", ...floatLegSchemaBase } as const;

export const swapLegSchema = {
  $id: "SwapLeg",
  title: "SwapLeg",
  description: "Swap leg, discriminated over `type`: Fixed (requires `rate`) or Float (requires `index`).",
  type: "object",
  required: ["type"],
  discriminator: { propertyName: "type" },
  oneOf: [{ $ref: "FixedLeg#" }, { $ref: "FloatLeg#" }],
} as const;

const legs = { type: "array", items: { $ref: "SwapLeg#" }, minItems: 1, maxItems: 4 } as const;

// ---------------------------------------------------------------------------
// Trade variants
// ---------------------------------------------------------------------------
export const interestRateSwapSchema = {
  $id: "InterestRateSwap",
  title: "InterestRateSwap",
  type: "object",
  required: ["id", "type", "legs"],
  properties: { type: { type: "string", enum: ["InterestRateSwap"] }, ...tradeBaseProperties, legs },
  additionalProperties: false,
} as const;

export const fraSchema = {
  $id: "FRA",
  title: "FRA",
  type: "object",
  required: ["id", "type", "payReceive", "notional", "currency", "index", "startDate", "endDate", "fixedRate"],
  properties: {
    type: { type: "string", enum: ["FRA"] },
    ...tradeBaseProperties,
    payReceive: { ...payReceive, description: "Pay = pay fixed" },
    notional: amount,
    currency,
    index: rateIndex,
    startDate: isoDate,
    endDate: isoDate,
    fixedRate: rate,
    dayCount,
  },
  additionalProperties: false,
} as const;

export const capFloorSchema = {
  $id: "CapFloor",
  title: "CapFloor",
  type: "object",
  required: [
    "id",
    "type",
    "capFloor",
    "payReceive",
    "notional",
    "currency",
    "index",
    "effectiveDate",
    "terminationDate",
    "frequency",
    "dayCount",
    "calendar",
    "strike",
  ],
  properties: {
    type: { type: "string", enum: ["CapFloor"] },
    ...tradeBaseProperties,
    capFloor: { type: "string", enum: ["Cap", "Floor", "Collar"] },
    payReceive: { ...payReceive, description: "Receive = long the option(s)" },
    notional: amount,
    currency,
    index: rateIndex,
    effectiveDate: isoDate,
    terminationDate: isoDate,
    frequency,
    dayCount,
    calendar,
    strike: rate,
    floorStrike: rate,
    notionalSchedule: {
      ...legBaseProperties.notionalSchedule,
      description:
        "Amortisation: outstanding notional per period – the last entry with `date` ≤ the period's accrual start applies, earlier periods use `notional` (same rule as a swap leg's `notionalSchedule`)",
    },
    businessDayConvention: { type: "string", enum: [...BUSINESS_DAY_CONVENTIONS] },
    stub: { type: "string", enum: [...STUB_TYPES] },
    model: { type: "string", enum: [...IR_MODELS] },
    volOverride: { type: "number", minimum: 0, maximum: 5 },
    shift: { type: "number", minimum: 0, maximum: 1 },
  },
  additionalProperties: false,
} as const;

export const swaptionSchema = {
  $id: "Swaption",
  title: "Swaption",
  type: "object",
  required: ["id", "type", "payReceive", "payerReceiver", "expiryDate", "settlement", "underlying"],
  properties: {
    type: { type: "string", enum: ["Swaption"] },
    ...tradeBaseProperties,
    payReceive: { ...payReceive, description: "Receive = long the option" },
    payerReceiver: { type: "string", enum: ["Payer", "Receiver"] },
    expiryDate: isoDate,
    settlement: { type: "string", enum: ["Physical", "Cash"] },
    cashSettlementConvention: { type: "string", enum: ["CollateralisedCashPrice", "IRR"] },
    underlying: { $ref: "InterestRateSwap#" },
    model: { type: "string", enum: [...IR_MODELS] },
    volOverride: { type: "number", minimum: 0, maximum: 5 },
    shift: { type: "number", minimum: 0, maximum: 1 },
  },
  additionalProperties: false,
} as const;

const fxForwardLegProperties = {
  buyCurrency: currency,
  buyAmount: amount,
  sellCurrency: currency,
  sellAmount: amount,
  deliveryDate: isoDate,
  ndf: {
    type: "object",
    required: ["fixingDate", "settlementCurrency"],
    properties: { fixingDate: isoDate, settlementCurrency: currency },
    additionalProperties: false,
    description: "Non-deliverable: cash settled in `settlementCurrency` at fixing",
  },
} as const;
const fxForwardRequired = ["buyCurrency", "buyAmount", "sellCurrency", "sellAmount", "deliveryDate"] as const;

export const fxForwardSchema = {
  $id: "FxForward",
  title: "FxForward",
  type: "object",
  required: ["id", "type", ...fxForwardRequired],
  properties: { type: { type: "string", enum: ["FxForward"] }, ...tradeBaseProperties, ...fxForwardLegProperties },
  additionalProperties: false,
} as const;

// eslint's `varsIgnorePattern: "^_"` covers the destructured-away `id`.
const { id: _omitId, ...fxSwapLegBase } = tradeBaseProperties;
const fxSwapLegSchema = {
  type: "object",
  required: [...fxForwardRequired],
  properties: { ...fxSwapLegBase, ...fxForwardLegProperties },
  additionalProperties: false,
} as const;

export const fxSwapSchema = {
  $id: "FxSwap",
  title: "FxSwap",
  type: "object",
  required: ["id", "type", "nearLeg", "farLeg"],
  properties: { type: { type: "string", enum: ["FxSwap"] }, ...tradeBaseProperties, nearLeg: fxSwapLegSchema, farLeg: fxSwapLegSchema },
  additionalProperties: false,
} as const;

export const fxOptionSchema = {
  $id: "FxOption",
  title: "FxOption",
  type: "object",
  required: ["id", "type", "payReceive", "optionType", "pair", "strike", "notional", "expiryDate", "deliveryDate"],
  properties: {
    type: { type: "string", enum: ["FxOption"] },
    ...tradeBaseProperties,
    payReceive: { ...payReceive, description: "Receive = long" },
    optionType: { type: "string", enum: ["Call", "Put"], description: "Call = right to buy the base currency" },
    pair: currencyPair,
    strike: positiveNumber,
    notional: { ...amount, description: `Notional in base currency (0 < x ≤ ${MAX_AMOUNT.toExponential(0)})` },
    expiryDate: isoDate,
    deliveryDate: isoDate,
    exercise: { type: "string", enum: ["European"] },
    premiumCurrency: currency,
    barrier: {
      type: "object",
      required: ["type", "level"],
      properties: {
        type: { type: "string", enum: [...BARRIER_TYPES] },
        level: positiveNumber,
        rebate: { type: "number", minimum: 0 },
        hit: {
          type: "boolean",
          description:
            "Observed knock state (N6-5): `true` = the barrier has been touched (knock-out → rebate only, knock-in → vanilla), `false` = not touched so far. Without the flag the state is derived from today's spot (live option) or the expiry fixing (expired option) and, when that derivation decides the value, the valuation warns `BARRIER_STATE_UNKNOWN:`; `analytics.barrierState` reports alive | knocked-in | knocked-out",
        },
        rebateAt: {
          type: "string",
          enum: ["hit", "expiry"],
          description:
            'Knock-out rebate convention (R8, N7-5): `hit` = the rebate is paid when the barrier is touched (a decided knock-out is then worth 0, the rebate having been paid), `expiry` = paid at the delivery date (rebate·DF). Default: the model\'s convention (rebate at expiry for the live option, rebate·DF for decided knocks) with `analytics.rebateAt: "default"`',
        },
      },
      additionalProperties: false,
    },
    digital: {
      type: "object",
      required: ["payoutCurrency", "payout"],
      properties: { payoutCurrency: currency, payout: amount },
      additionalProperties: false,
    },
    volOverride: { type: "number", minimum: 0, maximum: 5 },
  },
  additionalProperties: false,
} as const;

export const crossCurrencySwapSchema = {
  $id: "CrossCurrencySwap",
  title: "CrossCurrencySwap",
  type: "object",
  required: ["id", "type", "legs"],
  properties: {
    type: { type: "string", enum: ["CrossCurrencySwap"] },
    ...tradeBaseProperties,
    legs,
    mtmReset: {
      type: "object",
      required: ["resettingLegIndex"],
      properties: { resettingLegIndex: { type: "integer", minimum: 0, maximum: 3 } },
      additionalProperties: false,
      description: "Mark-to-market resetting of the notional on one leg",
    },
  },
  additionalProperties: false,
} as const;

export const tradeSchema = {
  $id: "Trade",
  title: "Trade",
  description: "Discriminated union over `type`. Dates as ISO-8601 (YYYY-MM-DD), rates as decimals, notionals positive.",
  type: "object",
  required: ["type"],
  discriminator: { propertyName: "type" },
  oneOf: TRADE_TYPES.map((t) => ({ $ref: `${t}#` })),
  examples: [
    {
      id: "IRS-DEMO",
      type: "InterestRateSwap",
      legs: [
        {
          type: "Fixed",
          payReceive: "Pay",
          notional: 10000000,
          currency: "EUR",
          effectiveDate: "2026-09-07",
          terminationDate: "2036-09-07",
          frequency: "1Y",
          dayCount: "30E/360",
          calendar: "TARGET",
          rate: 0.031,
        },
        {
          type: "Float",
          payReceive: "Receive",
          notional: 10000000,
          currency: "EUR",
          effectiveDate: "2026-09-07",
          terminationDate: "2036-09-07",
          frequency: "6M",
          dayCount: "ACT/360",
          calendar: "TARGET",
          index: "EURIBOR-6M",
        },
      ],
    },
  ],
} as const;

/** Reference to the shared `Trade` schema (registered via `app.addSchema`). */
export const tradeRef = { $ref: "Trade#" } as const;

/** Every trade variant and leg schema, registered as named components (order: referenced before referencing is not required). */
export const tradeVariantSchemas = [
  fixedLegSchema,
  floatLegSchema,
  swapLegSchema,
  interestRateSwapSchema,
  fraSchema,
  capFloorSchema,
  swaptionSchema,
  fxForwardSchema,
  fxSwapSchema,
  fxOptionSchema,
  crossCurrencySwapSchema,
] as const;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------
export const priceBodySchema = {
  type: "object",
  required: ["trade"],
  properties: { trade: tradeRef, reportingCurrency: currency },
  additionalProperties: false,
} as const;

export const riskBodySchema = {
  type: "object",
  required: ["trade"],
  properties: {
    trade: tradeRef,
    reportingCurrency: currency,
    bucketed: { type: "boolean" },
    vega: { type: "boolean" },
    theta: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

/** Piecewise-constant hazard term structure (`HazardCurve`), e.g. from `POST /api/xva/hazard-curve`. */
export const hazardCurveSchema = {
  type: "object",
  required: ["times", "hazards", "recovery"],
  properties: {
    times: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "number", exclusiveMinimum: 0 },
      description: "Pillar times in years, strictly increasing",
    },
    hazards: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "number", minimum: 0, maximum: 5 },
      description: "Hazard rate per interval ending at times[i]",
    },
    recovery: { type: "number", minimum: 0, maximum: 1 },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Bootstrap warnings (`HAZARD_FLOORED: …` for every pillar floored at 0 under `floorHazard`); informational on input",
    },
  },
  additionalProperties: false,
} as const;

export const creditSchema = {
  type: "object",
  required: ["cptyHazard", "cptyRecovery"],
  properties: {
    cptyHazard: { type: "number", minimum: 0, maximum: 5 },
    cptyRecovery: { type: "number", minimum: 0, maximum: 1 },
    ownHazard: { type: "number", minimum: 0, maximum: 5 },
    ownRecovery: { type: "number", minimum: 0, maximum: 1 },
    cptyHazardCurve: { ...hazardCurveSchema, description: "Counterparty hazard term structure; overrides `cptyHazard` when present" },
    ownHazardCurve: { ...hazardCurveSchema, description: "Own hazard term structure; overrides `ownHazard` when present" },
    basisSpreadVol: { type: "number", minimum: 0, maximum: 1, description: "Normal vol of the tenor-basis spread (decimal) for basis-swap exposure" },
  },
  additionalProperties: false,
} as const;

export const hazardCurveBodySchema = {
  type: "object",
  required: ["quotes", "recovery"],
  properties: {
    quotes: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        required: ["tenor", "spread"],
        properties: {
          tenor: { type: "string", pattern: "^\\d{1,3}[DWMYdwmy]$", description: 'CDS tenor, e.g. "1Y", "5Y"' },
          spread: { type: "number", minimum: 0, maximum: 1, description: "Par CDS spread (decimal, 0.01 = 100bp)" },
        },
        additionalProperties: false,
      },
    },
    recovery: { type: "number", minimum: 0, exclusiveMaximum: 1 },
    valuationDate: { ...isoDate, description: "Default: market valuation date" },
    discountCurveId: { type: "string", maxLength: 64, description: "Discount curve for the premium/protection legs (default: DF ≡ 1)" },
    floorHazard: {
      type: "boolean",
      description:
        "Inverted CDS quotes (spread × maturity decreasing) imply a negative forward hazard rate. Default false: 422 `INVALID_CREDIT_CURVE` naming the pillar (`details.pillar`). true: floor that interval's hazard at 0 and report it in `warnings` (`HAZARD_FLOORED: …`); later pillars are solved on the floored curve, the floored quote itself does not reprice.",
    },
  },
  additionalProperties: false,
} as const;

export const xvaBodySchema = {
  type: "object",
  required: ["trade", "credit"],
  properties: { trade: tradeRef, reportingCurrency: currency, credit: creditSchema },
  additionalProperties: false,
} as const;

export const governanceSchema = {
  type: "object",
  description:
    "Bewertungs-Governance (IFRS 13 / IDW RS HFA 47, MaRisk AT 4.3.5 und BTO 2.2.1): Freigabestatus des Snapshots, Input-Quellen, Modellversion, Validierer. Alle Felder optional (Defaults: indicative, ctx.meta.source, Engine-Version).",
  properties: {
    snapshotStatus: { type: "string", enum: ["indicative", "approved"] },
    inputSources: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 20 },
    modelVersion: { type: "string", maxLength: 100 },
    validatedBy: { type: "string", maxLength: 200 },
  },
  additionalProperties: false,
} as const;

export const reportBodySchema = {
  type: "object",
  required: ["trade"],
  properties: {
    trade: tradeRef,
    reportingCurrency: currency,
    credit: creditSchema,
    transactionPrice: { type: "number" },
    includeRisk: { type: "boolean" },
    perspective: {
      type: "string",
      enum: ["Bank", "Kunde"],
      description:
        "Point of view of `pricing.pv` and `transactionPrice` in the cost block (default \"Bank\"). Sign rule: `pv` is positive when the trade is an asset to the `perspective` party; `transactionPrice` is positive when that party pays at inception. Regardless of the perspective, `costTransparency.bankMargin` is always the bank's day-1 gain and `initialMarketValue` the client's (typically negative) initial market value = −bankMargin (MiFID II ex-ante costs, BGH XI ZR 33/10); `signRule` spells the convention out in German.",
    },
    governance: governanceSchema,
  },
  additionalProperties: false,
} as const;

export const parRiskPortfolioBodySchema = {
  type: "object",
  properties: {
    trades: { type: "array", items: tradeRef, minItems: 1, maxItems: 200 },
    useStore: { type: "boolean", description: "Use the trade store instead of `trades`" },
    reportingCurrency: currency,
    curveIds: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 10 },
    bumpBp: { type: "number", minimum: 0.01, maximum: 100 },
  },
  additionalProperties: false,
} as const;

export const portfolioBodySchema = {
  type: "object",
  properties: {
    trades: { type: "array", items: tradeRef, maxItems: 5000 },
    reportingCurrency: currency,
    useStore: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

/** Aggregations of the portfolio report (`byCounterparty`, `byBook`, `byType`). */
export const PORTFOLIO_GROUPINGS = ["counterparty", "book", "type"] as const;
export type PortfolioGrouping = (typeof PORTFOLIO_GROUPINGS)[number];

export const portfolioReportBodySchema = {
  type: "object",
  properties: {
    trades: { type: "array", items: tradeRef, maxItems: 5000, description: "Trades to report on (default: the trade store)" },
    reportingCurrency: currency,
    groupBy: {
      type: "array",
      items: { type: "string", enum: [...PORTFOLIO_GROUPINGS] },
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      description:
        "Aggregations to include (default: all three – `byCounterparty`, `byBook`, `byType`); the others are returned as empty arrays and left out of the Markdown. `audit.reportHash` always covers the full report and is independent of `groupBy`.",
    },
    theta: { type: "boolean", description: "Compute the 1-day theta per trade (default true; two extra valuations per trade)" },
    fxDelta: { type: "boolean", description: "Compute the FX delta per foreign currency (default true)" },
    preparedBy: { ...shortText, description: "Recorded in `audit.preparedBy`" },
  },
  additionalProperties: false,
} as const;

export const scenarioSchema = {
  type: "object",
  required: ["id", "name"],
  properties: {
    id: { type: "string", maxLength: 64 },
    name: shortText,
    description: { type: "string", maxLength: 1000 },
    curveShifts: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        required: ["target"],
        properties: {
          target: { type: "string", maxLength: 64 },
          parallelBp: { type: "number" },
          tenorBp: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              required: ["years", "bp"],
              properties: { years: { type: "number" }, bp: { type: "number" } },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    fxShiftsPct: { type: "object", additionalProperties: { type: "number" } },
    irVolShiftBp: { type: "number" },
    irVolShift: {
      type: "object",
      description: "IR-Vol-Shift mit expliziten Einheiten (Normal-Vol in bp, Lognormal-Vol in Punkten, Referenzrate für die Umrechnung)",
      properties: { normalBp: { type: "number" }, lognormalPts: { type: "number" }, referenceRate: { type: "number", exclusiveMinimum: 0 } },
      additionalProperties: false,
    },
    fxVolShiftPts: { type: "number" },
    daysForward: { type: "integer", minimum: 0, maximum: 3660 },
  },
  additionalProperties: false,
} as const;

export const scenariosBodySchema = {
  type: "object",
  properties: {
    trades: { type: "array", items: tradeRef, maxItems: 5000 },
    scenarios: { type: "array", items: scenarioSchema, maxItems: 200 },
    includeHistorical: { type: "boolean", description: "Append the historical stress episodes (`GET /api/scenarios/historical`) to the scenario set" },
    reportingCurrency: currency,
  },
  additionalProperties: false,
} as const;

export const gridBodySchema = {
  type: "object",
  properties: {
    trades: { type: "array", items: tradeRef, maxItems: 5000 },
    reportingCurrency: currency,
    ratesBp: { type: "array", items: { type: "number" }, maxItems: 41 },
    fxPct: { type: "array", items: { type: "number" }, maxItems: 41 },
    fxCurrency: currency,
  },
  additionalProperties: false,
} as const;

// Vol surfaces (shared by the snapshot schema and `PUT /api/market`, R4-5): plain data of the core's
// `SwaptionVolSurface` / `CapletVolSurface` / `FxVolSurface`, keyed like `MarketContext.*Vols`.
// The schema pins what JSON Schema can express (non-empty axes, positive pillars, non-negative vols);
// the grid dimensions (rows = expiries, columns = tenors / strikes, FX vectors = expiries) and the
// ordering of the axes are checked by `lib/vol-surfaces.ts` → 400 `VOL_SURFACE_INVALID` (Markt R5-1).
const volType = { type: "string", enum: ["Normal", "Lognormal", "ShiftedLognormal"] } as const;
const numberVector = { type: "array", items: { type: "number" }, minItems: 1, maxItems: 200 } as const;
/** Axis pillars in years – strictly positive (ordering is checked structurally). */
const pillarVector = { type: "array", items: { type: "number", exclusiveMinimum: 0 }, minItems: 1, maxItems: 200 } as const;
/** Vol quotes (decimal, non-negative; JSON cannot carry NaN/Infinity). */
const volVector = { type: "array", items: { type: "number", minimum: 0 }, minItems: 1, maxItems: 200 } as const;
const volGrid = { type: "array", items: volVector, minItems: 1, maxItems: 200 } as const;
export const swaptionVolsSchema = {
  type: "object",
  maxProperties: 50,
  additionalProperties: {
    type: "object",
    required: ["id", "currency", "volType", "expiries", "tenors", "atm"],
    properties: {
      id: { type: "string", maxLength: 64 },
      currency,
      volType,
      shift: { type: "number", minimum: 0, maximum: 1 },
      expiries: { ...pillarVector, description: "Option expiries in years, strictly increasing" },
      tenors: { ...pillarVector, description: "Underlying swap tenors in years, strictly increasing" },
      atm: { ...volGrid, description: "atm[expiryIdx][tenorIdx] – one row per expiry, one column per tenor" },
      sabr: {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["beta", "rho", "nu"],
          properties: {
            beta: { type: "number", minimum: 0, maximum: 1 },
            rho: { type: "number", minimum: -1, maximum: 1 },
            nu: { type: "number", minimum: 0 },
            shift: { type: "number" },
          },
          additionalProperties: true,
        },
      },
    },
    additionalProperties: false,
  },
} as const;
export const capletVolsSchema = {
  type: "object",
  maxProperties: 50,
  additionalProperties: {
    type: "object",
    required: ["id", "currency", "index", "volType", "expiries", "strikes", "vols"],
    properties: {
      id: { type: "string", maxLength: 64 },
      currency,
      index: rateIndex,
      volType,
      shift: { type: "number", minimum: 0, maximum: 1 },
      expiries: { ...pillarVector, description: "Caplet expiries in years, strictly increasing" },
      strikes: { ...numberVector, description: "Strikes as decimals, strictly increasing (negative strikes allowed with a shift)" },
      vols: { ...volGrid, description: "vols[expiryIdx][strikeIdx] – one row per expiry, one column per strike" },
    },
    additionalProperties: false,
  },
} as const;
export const fxVolsSchema = {
  type: "object",
  maxProperties: 100,
  additionalProperties: {
    type: "object",
    required: ["id", "pair", "expiries", "atm", "rr25", "bf25"],
    properties: {
      id: { type: "string", maxLength: 64 },
      pair: currencyPair,
      expiries: { ...pillarVector, description: "Expiries in years, strictly increasing" },
      atm: { ...volVector, description: "ATM vols per expiry (same length as `expiries`)" },
      rr25: { ...numberVector, description: "25Δ risk reversals per expiry" },
      bf25: { ...volVector, description: "25Δ butterflies per expiry" },
      rr10: { ...numberVector, description: "10Δ risk reversals per expiry" },
      bf10: { ...volVector, description: "10Δ butterflies per expiry" },
      atmConvention: { type: "string", enum: ["DeltaNeutral", "Forward"] },
      deltaConvention: { type: "string", enum: ["Spot", "Forward", "PremiumAdjustedSpot", "PremiumAdjustedForward"] },
      smileInterpolation: { type: "string", enum: ["linear", "cubic"] },
      strangleType: { type: "string", enum: ["Smile", "Broker"] },
    },
    additionalProperties: false,
  },
} as const;

/** `MarketContext.fxFixings` in snapshot form (`{ pair, date, rate }`): FX fixing of a past MtM-reset date. */
export const fxFixingsSchema = {
  type: "array",
  maxItems: 100000,
  items: {
    type: "object",
    required: ["pair", "date", "rate"],
    properties: { pair: currencyPair, date: isoDate, rate: { type: "number", exclusiveMinimum: 0 } },
    additionalProperties: false,
  },
} as const;

export const marketPutSchema = {
  type: "object",
  description:
    "Partial market update: every field is optional and merged into the active snapshot (spots and vol surfaces per key, fixings appended, `valuationDate` rebuilds the sample market). Vol surfaces (`swaptionVols`/`capletVols`/`fxVols`) replace the surface under the same key – an IPV process can push one broker vol surface without round-tripping the whole snapshot.",
  properties: {
    valuationDate: isoDate,
    fxSpots: { type: "object", additionalProperties: { type: "number", exclusiveMinimum: 0 }, propertyNames: currencyPair },
    fxFixings: {
      ...fxFixingsSchema,
      description:
        "Historical FX fixings `{ pair, date, rate }` for the notional resets of MtM cross-currency swaps – appended to the market's fixings (a fixing for the same pair and date replaces the stored one); without a fixing for a past reset date the valuation warns `MISSING_FX_FIXING:`",
    },
    swaptionVols: { ...swaptionVolsSchema, description: "Swaption vol cubes keyed by currency (`EUR`) – replaces the cube under each given key" },
    capletVols: { ...capletVolsSchema, description: "Caplet vol surfaces keyed by index (`EUR-EURIBOR-6M`) – replaces the surface under each given key" },
    fxVols: { ...fxVolsSchema, description: "FX vol surfaces keyed by pair (`EURUSD`) – replaces the surface under each given key" },
    fixings: {
      type: "array",
      maxItems: 10000,
      items: {
        type: "object",
        required: ["index", "date", "value"],
        properties: { index: rateIndex, date: isoDate, value: { type: "number" } },
        additionalProperties: false,
      },
    },
    fxSpotDates: {
      type: "object",
      description: "Explizite Spot-Daten je Paar (Default: T+2/T+1 auf dem Paar-Kalender)",
      additionalProperties: isoDate,
      propertyNames: currencyPair,
    },
    missingFixingPolicy: { type: "string", enum: ["curve", "throw"], description: "Umgang mit fehlenden historischen Fixings" },
    discountCurveId: {
      type: "object",
      description:
        'Discount-curve mapping per currency (`{ NOK: "NOK-NOWA" }`, Markt R7-3) – merged into the snapshot\'s `discountCurveId`; the curve must exist in the market (422 `CURVE_NOT_FOUND`) and be denominated in that currency (400 `INVALID_REQUEST`). `POST /api/market/curves` sets the mapping automatically for the first curve of a currency.',
      propertyNames: currency,
      additionalProperties: { type: "string", minLength: 1, maxLength: 64 },
      maxProperties: 100,
    },
    collateralDiscountCurveId: {
      type: "object",
      description:
        'Collateral (CSA) discount-curve mapping keyed `${ccy}|${collateralCcy}` (`{ "EUR|USD": "EUR-ESTR-USDCSA" }`) – merged into the snapshot\'s `collateralDiscountCurveId`; the curve must exist (422 `CURVE_NOT_FOUND`) and be denominated in `ccy`, the first currency of the key (400 `INVALID_REQUEST`, N8-02 – EUR cash flows discounted on a CZK curve are a mis-valuation, not a CSA)',
      propertyNames: { type: "string", pattern: "^[A-Z]{3}\\|[A-Z]{3}$" },
      additionalProperties: { type: "string", minLength: 1, maxLength: 64 },
      maxProperties: 100,
    },
    discardImport: {
      type: "boolean",
      description:
        "Import mode only (the active market came from `PUT /api/market/snapshot`): `true` drops the imported snapshot and rebuilds the sample market (for `valuationDate` when given, else for the current date); the response names it in `warnings[]` (`MARKET_STATE_DROPPED:`). Default `false`: a `valuationDate` change rolls the imported market instead (`rollMarket`, constant zero curves). Ignored in sample mode.",
    },
  },
  additionalProperties: false,
} as const;

export const bootstrapBodySchema = {
  type: "object",
  required: ["spec"],
  properties: {
    valuationDate: isoDate,
    isDiscountCurve: {
      type: "boolean",
      description:
        '`POST /api/market/curves` only: make the bootstrapped curve the discount curve of its currency (`discountCurveId[currency]`). Default (omitted): the mapping is set when the currency has no discount curve yet – the first curve of a new currency becomes its discount curve, as in the workstation\'s "+ Kurve" (Markt R7-3); `false` never sets it, `true` also replaces an existing mapping. Ignored by `POST /api/market/bootstrap`.',
    },
    spec: {
      type: "object",
      required: ["id", "currency", "index", "quotes"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64 },
        currency,
        index: {
          ...rateIndex,
          description:
            'Floating-rate index the curve projects, e.g. "EURIBOR-6M", "ESTR", "SOFR", "NOWA" – any registered index (`GET /api/market` lists `currencies` and `indices`; further indices and currencies are registered with `POST /api/market/indices` / `POST /api/market/conventions`). An unregistered name answers 422 `UNKNOWN_INDEX`.',
        },
        interpolation: { type: "string", enum: [...INTERPOLATIONS] },
        dayCount,
        discountCurveId: {
          type: "string",
          maxLength: 64,
          description: "Curve id used for discounting during the bootstrap (dual-curve); not the snapshot mapping – see `isDiscountCurve`",
        },
        referenceCurveIds: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 50 },
        spotLag: { type: "integer", minimum: 0, maximum: 5 },
        turnOfYear: {
          type: "array",
          maxItems: 50,
          description: "Turn-of-year forward jumps: instantaneous forward over [date, date + days) raised by `bp`; pillars re-solved so every quote reprices",
          items: {
            type: "object",
            required: ["date", "bp"],
            properties: { date: isoDate, bp: { type: "number", minimum: -1000, maximum: 1000 }, days: { type: "integer", minimum: 1, maximum: 366 } },
            additionalProperties: false,
          },
        },
        globalSweeps: {
          type: "integer",
          minimum: 0,
          maximum: 50,
          description: "Global re-solve sweeps after the sequential pass (default 6 for cubicSplineZero/monotoneConvex, 0 otherwise)",
        },
        pillarMergeToleranceDays: {
          type: "integer",
          minimum: 0,
          maximum: 60,
          description: "Merge quotes whose pillars fall within this many days (default 0 = off); dropped quotes are reported in `mergedQuotes`",
        },
        quotes: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string", enum: [...CURVE_QUOTE_TYPES] },
              tenor: { type: "string", maxLength: 8 },
              start: { type: "string", maxLength: 12 },
              end: { type: "string", maxLength: 12 },
              rate: { type: "number", minimum: -0.1, maximum: 1 },
              price: { type: "number", minimum: 50, maximum: 110 },
              convexityBp: { type: "number" },
              spread: { type: "number", minimum: -0.1, maximum: 0.1 },
              otherIndex: rateIndex,
              otherCurveId: { type: "string", maxLength: 64 },
              foreignCurrency: currency,
              foreignDiscountCurveId: { type: "string", maxLength: 64 },
              foreignProjectionCurveId: { type: "string", maxLength: 64 },
              domesticProjectionCurveId: { type: "string", maxLength: 64 },
              fxSpot: { ...positiveNumber, description: "XccyBasis / FxSwapPoints: spot of the pair (1 domestic = fxSpot foreign)" },
              domesticIndex: rateIndex,
              foreignIndex: rateIndex,
              points: { type: "number", description: "FxSwapPoints: forward points in pips (outright = spot + points / pipFactor)" },
              pair: { ...currencyPair, description: "FxSwapPoints: pair whose base or quote currency is the curve currency" },
              pipFactor: { type: "number", exclusiveMinimum: 0, description: "FxSwapPoints: pip denominator (default 10 000; 100 for JPY quotes)" },
              otherDiscountCurveId: { type: "string", maxLength: 64, description: "FxSwapPoints: discount curve id of the other currency of the pair" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Trade builders (`POST /api/trades/from-template`) – one parameter schema per core builder
// ---------------------------------------------------------------------------
const tenorOrDate = { type: "string", pattern: "^(\\d{1,3}[DWMYdwmy]|\\d{4}-\\d{2}-\\d{2})$", description: 'Tenor ("5Y") or ISO date' } as const;

/** `CrossCurrencySwapParams` of `makeCrossCurrencySwap` (dates as ISO). */
export const crossCurrencySwapParamsSchema = {
  type: "object",
  required: ["pair", "domesticNotional", "spread", "effectiveDate", "tenor"],
  properties: {
    id: tradeId,
    pair: { ...currencyPair, description: 'Pair "EURUSD": first currency domestic, second foreign unless given explicitly' },
    domesticCurrency: currency,
    foreignCurrency: currency,
    domesticNotional: amount,
    fxSpot: { ...positiveNumber, description: "1 domestic = fxSpot foreign; fixes the foreign notional (alternatively `foreignNotional`)" },
    foreignNotional: amount,
    domesticIndex: { ...rateIndex, description: "Default: RFR of the currency" },
    foreignIndex: rateIndex,
    fixedRate: { ...rate, description: "Fixed-vs-float variant: the domestic leg pays/receives this fixed rate" },
    spread: { type: "number", minimum: -0.1, maximum: 0.1, description: "Basis spread (decimal, -0.002 = -20bp)" },
    spreadOn: { type: "string", enum: ["domestic", "foreign"] },
    domesticPayReceive: { ...payReceive, description: 'Direction of the domestic leg (default "Receive")' },
    effectiveDate: isoDate,
    tenor: tenorOrDate,
    mtmReset: { type: "boolean" },
    mtmResetLeg: { type: "string", enum: ["domestic", "foreign"] },
    notionalExchange: {
      type: "object",
      properties: { initial: { type: "boolean" }, final: { type: "boolean" }, interim: { type: "boolean" } },
      additionalProperties: false,
    },
    frequency,
    collateralCurrency: {
      type: ["string", "null"],
      pattern: currency.pattern,
      description:
        "CSA / collateral currency selecting the discount curves. Default (market practice, Bloomberg SWPM / LSEG IPA): USD when one leg is USD, otherwise the quote (second) currency of the pair – for EURUSD the USD-collateral EUR discount curve, so the fair basis spread reflects the quoted cross-currency basis. `null` = explicitly uncollateralised (both legs on their own OIS curves; the built trade carries no `collateralCurrency`).",
    },
    counterparty: shortText,
    name: shortText,
  },
  additionalProperties: false,
} as const;

/** Parameters of `makeFra` (dates as ISO). */
export const fraParamsSchema = {
  type: "object",
  required: ["currency", "notional", "payReceive", "start", "rate"],
  properties: {
    id: tradeId,
    currency,
    notional: amount,
    payReceive: { ...payReceive, description: "Pay = pay the fixed rate" },
    index: {
      ...rateIndex,
      description:
        'Default: the IBOR index of the currency whose tenor equals the period length ("3x6" → EURIBOR-3M, "6x12" → EURIBOR-6M; explicit `start`/`end`: rounded months between them), falling back to the currency\'s standard floating index when no such tenor is registered. An explicit `index` always wins.',
    },
    start: {
      type: "string",
      pattern: "^(\\d{1,3}x\\d{1,3}|\\d{4}-\\d{2}-\\d{2})$",
      description:
        'Period "3x6" (months from the spot date of `valuationDate`; the index tenor follows the period length unless `index` is given) or ISO accrual start (then `end` applies, default start + index tenor)',
    },
    end: isoDate,
    rate,
    valuationDate: { ...isoDate, description: 'Anchor of the "3x6" form (default: market valuation date)' },
    counterparty: shortText,
    collateralCurrency: currency,
    name: shortText,
  },
  additionalProperties: false,
} as const;

const templateBranch = (id: string, template: string, params: unknown) =>
  ({
    $id: id,
    title: id,
    type: "object",
    required: ["template", "params"],
    properties: {
      template: { type: "string", enum: [template] },
      params,
      price: { type: "boolean", description: "Include a valuation of the built trade (`pricing`)" },
      reportingCurrency: currency,
    },
    additionalProperties: false,
  }) as const;

/** Named branches of the `from-template` body (registered as components, referenced by the discriminated body). */
export const fromTemplateBranchSchemas = [
  templateBranch("FromTemplateCrossCurrencySwap", "CrossCurrencySwap", crossCurrencySwapParamsSchema),
  templateBranch("FromTemplateFra", "FRA", fraParamsSchema),
] as const;

export const fromTemplateBodySchema = {
  type: "object",
  required: ["template", "params"],
  description: "Discriminated over `template`; `params` mirrors the core builder's parameters.",
  discriminator: { propertyName: "template" },
  oneOf: fromTemplateBranchSchemas.map((s) => ({ $ref: `${s.$id}#` })),
} as const;

// ---------------------------------------------------------------------------
// Market snapshot (`deriva.market/1`)
// ---------------------------------------------------------------------------
const idMap = { type: "object", additionalProperties: { type: "string", maxLength: 64 }, maxProperties: 100 } as const;

// ---------------------------------------------------------------------------
// Index / convention register (Markt R6-5 rest, R7): `POST /api/market/indices|conventions`, snapshot `indices`/`conventions`
// ---------------------------------------------------------------------------
const indexName = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$",
  description: 'Index name without whitespace, e.g. "PRIBOR-6M", "CZEONIA" (stored upper-cased)',
} as const;

/** `RateIndex` of the core (`registerRateIndex`), ISO/JSON shape – the body of `POST /api/market/indices` and the items of a snapshot's `indices`. */
export const rateIndexSchema = {
  $id: "RateIndex",
  title: "RateIndex",
  type: "object",
  description:
    "Floating-rate index definition (core `RateIndex`): registered at runtime with `POST /api/market/indices`; the index can then be used in curve specs (`POST /api/market/bootstrap|curves`), swap legs, builders and CSV imports. Built-in indices (`EURIBOR-*`, `ESTR`, `SOFR`, `SONIA`, `SARON`, `TONA`, `NIBOR-*`, `NOWA`, `STIBOR-*`, `SWESTR`, `CIBOR-*`, `DESTR`, `WIBOR-*`, `POLONIA`) cannot be replaced (400 `INVALID_CURVE_SPEC`): their definition enters every valuation without appearing in the snapshot id – register a desk-specific variant under its own name instead.",
  required: ["name", "currency", "type", "tenor", "dayCount", "fixingCalendar", "fixingLag", "businessDayConvention", "endOfMonth", "curveId"],
  properties: {
    name: indexName,
    currency,
    type: { type: "string", enum: ["IBOR", "OIS"], description: "IBOR = forward-looking term rate, OIS = compounded overnight rate" },
    tenor: { type: "string", pattern: "^([1-9]\\d{0,2}[DWMY])$", description: 'Index tenor: "1M" … "12M" (IBOR), "1D" for overnight indices' },
    dayCount,
    fixingCalendar: {
      ...calendar,
      description:
        'Fixing calendar id (registered calendar, e.g. "TARGET", "US", "US-SIFMA", "UK", "NO", "TARGET+US", or one registered with `POST /api/market/calendars`)',
    },
    paymentCalendar: {
      ...calendar,
      description:
        "Optional accrual / payment calendar of the index schedule when it differs from the fixing calendar (R8: SOFR fixes on `US-SIFMA`, pays on `US`); default = `fixingCalendar`",
    },
    fixingLag: { type: "integer", minimum: 0, maximum: 10, description: "Fixing lag in business days (2 for EURIBOR, 0 for €STR/SOFR)" },
    businessDayConvention: { type: "string", enum: [...BUSINESS_DAY_CONVENTIONS] },
    endOfMonth: { type: "boolean" },
    curveId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: 'Projection curve id in the market, e.g. "CZK-PRIBOR-6M" – bootstrap it with `POST /api/market/curves`',
    },
  },
  additionalProperties: false,
} as const;
export const rateIndexRef = { $ref: "RateIndex#" } as const;

/** `SwapConventions` of the core (`registerSwapConventions`) – the body of `POST /api/market/conventions` and the items of a snapshot's `conventions`. */
export const swapConventionsSchema = {
  $id: "SwapConventions",
  title: "SwapConventions",
  type: "object",
  description:
    "Vanilla-swap and OIS conventions of a currency (core `SwapConventions`): fixed leg vs the currency's benchmark float index plus the OIS conventions for discount-curve bootstrapping. Registering makes the currency known (`GET /api/market` `currencies`): curves can be bootstrapped and swaps built in it. Both indices must be registered and belong to the currency (400 `INVALID_CURVE_SPEC` otherwise). Conventions of a built-in currency may be overridden (they only shape builder defaults and bootstrap schedules, both visible in the trade / the curve nodes).",
  required: [
    "currency",
    "fixedFrequency",
    "fixedDayCount",
    "floatIndex",
    "floatFrequency",
    "calendar",
    "spotLag",
    "oisIndex",
    "oisFixedFrequency",
    "oisFixedDayCount",
    "oisPaymentLag",
  ],
  properties: {
    currency,
    fixedFrequency: frequency,
    fixedDayCount: dayCount,
    floatIndex: { ...rateIndex, description: "Benchmark float index of the vanilla swap (registered, same currency)" },
    floatFrequency: frequency,
    calendar: { ...calendar, description: 'Payment / schedule calendar id, e.g. "TARGET", "NO", "TARGET+US"' },
    spotLag: { type: "integer", minimum: 0, maximum: 5, description: "Spot lag in business days" },
    oisIndex: { ...rateIndex, description: "Overnight index (registered, same currency, type OIS)" },
    oisFixedFrequency: frequency,
    oisFixedDayCount: dayCount,
    oisPaymentLag: { type: "integer", minimum: 0, maximum: 10, description: "Payment lag of the OIS legs in business days" },
  },
  additionalProperties: false,
} as const;
export const swapConventionsRef = { $ref: "SwapConventions#" } as const;

/** Serialisable custom calendar (Markt R8-2) – the body of `POST /api/market/calendars` and the items of a snapshot's `calendars`. */
export const customCalendarSchema = {
  $id: "CustomCalendar",
  title: "CustomCalendar",
  type: "object",
  description:
    "Holiday calendar defined by an explicit date list (core `CustomCalendar`), registered under `id` with `POST /api/market/calendars` so indices (`fixingCalendar`) and conventions (`calendar`) of a new currency can reference it – e.g. `CZ` with the Prague holidays instead of falling back to `TARGET`. Built-in calendars (`TARGET`, `DE`, `US`, `UK`, `CH`, `JP`, `NO`, `SE`, `DK`, `PL` and their aliases such as `EUR`, `USNY`, `GBLO`) cannot be replaced (400 `INVALID_CURVE_SPEC`). Weekends are holidays unless `weekendsAreHolidays: false`. Exported in the snapshot envelope (`calendars`, ADR-027) and re-registered on import before `indices` and `conventions`.",
  required: ["id", "holidays"],
  properties: {
    id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._-]{0,31}$", description: 'Calendar id (stored upper-cased), e.g. "CZ", "PRAGUE", "CZ-PSE"' },
    name: { type: "string", maxLength: 120, description: 'Display name, e.g. "Prague Stock Exchange" (documentation only)' },
    holidays: {
      type: "array",
      maxItems: 5000,
      items: isoDate,
      description: "Holidays as ISO dates (`YYYY-MM-DD`); duplicates are dropped, weekends need not be listed. May be empty for a weekend-only calendar.",
    },
    weekendsAreHolidays: { type: "boolean", description: "Saturdays and Sundays are holidays (default `true`)" },
  },
  additionalProperties: false,
} as const;
export const customCalendarRef = { $ref: "CustomCalendar#" } as const;

/** Response of `POST /api/market/indices` / `/conventions` / `/calendars`. */
export const registerResponseSchema = (kind: "index" | "conventions" | "calendar") =>
  ({
    type: "object",
    required: ["registered", "replaced", kind],
    properties: {
      registered: { type: "boolean", description: "Always `true` on 200/201" },
      replaced: {
        type: "boolean",
        description: "`true` (200) when a runtime-registered entry of the same name / currency / id was replaced, `false` (201) for a new entry",
      },
      [kind]: kind === "index" ? rateIndexRef : kind === "conventions" ? swapConventionsRef : customCalendarRef,
      currencies: { type: "array", items: { type: "string" }, description: "`knownCurrencies()` after the call" },
      snapshotId: {
        type: "string",
        description: "Active snapshot id – unchanged by a registration (the register is not part of the snapshot id; see ADR-027)",
      },
    },
    additionalProperties: true,
  }) as const;

export const marketSnapshotSchema = {
  $id: "MarketSnapshot",
  title: "MarketSnapshot",
  description: "Versionierter Markt-Snapshot `deriva.market/1` (ISO-Daten, Diskontfaktoren je Pillar).",
  type: "object",
  required: ["schema", "valuationDate", "discountCurveId", "curves", "fxSpots", "fixings"],
  properties: {
    schema: { type: "string", enum: ["deriva.market/1"] },
    valuationDate: isoDate,
    meta: {
      type: "object",
      properties: {
        source: shortText,
        snapshotTime: {
          ...isoDateTime,
          format: "date-time",
          description: "ISO-8601 UTC timestamp of the market data cut (becomes the EMIR valuation timestamp when no explicit `timestamp` is given)",
        },
        label: shortText,
      },
      additionalProperties: false,
    },
    discountCurveId: { ...idMap, description: "Discount curve id per currency" },
    collateralDiscountCurveId: { ...idMap, description: "Overrides keyed `${ccy}|${collateralCcy}`" },
    curves: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        required: ["id", "currency", "dayCount", "interpolation", "nodes"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 },
          currency,
          dayCount,
          interpolation: { type: "string", enum: [...INTERPOLATIONS] },
          extrapolation: { type: "string", enum: [...CURVE_EXTRAPOLATIONS] },
          meta: { type: "object", additionalProperties: { type: "string", maxLength: 200 }, maxProperties: 20 },
          forwardJumps: {
            type: "array",
            maxItems: 50,
            description: "Turn-of-year forward jumps layered on the interpolated base curve (`nodes` are the base nodes)",
            items: {
              type: "object",
              required: ["date", "bp"],
              properties: { date: isoDate, bp: { type: "number" }, days: { type: "integer", minimum: 1, maximum: 366 } },
              additionalProperties: false,
            },
          },
          nodes: {
            type: "array",
            minItems: 1,
            maxItems: 500,
            items: {
              type: "object",
              required: ["date", "df"],
              properties: {
                date: isoDate,
                df: {
                  type: "number",
                  exclusiveMinimum: 0,
                  maximum: 1.0001,
                  description: "Discount factor (0 < df ≤ 1.0001; slightly above 1 only for negative rates)",
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    fxSpots: { type: "object", additionalProperties: positiveNumber, propertyNames: currencyPair, maxProperties: 200 },
    fixings: {
      type: "array",
      maxItems: 100000,
      items: {
        type: "object",
        required: ["index", "date", "value"],
        properties: { index: rateIndex, date: isoDate, value: { type: "number", minimum: -1, maximum: 1 } },
        additionalProperties: false,
      },
    },
    fxFixings: {
      ...fxFixingsSchema,
      description:
        "Historical FX fixings `{ pair, date, rate }` for MtM-reset notionals of cross-currency swaps (core `MarketContext.fxFixings`, part of the snapshot id)",
    },
    swaptionVols: swaptionVolsSchema,
    capletVols: capletVolsSchema,
    fxVols: fxVolsSchema,
    credit: {
      type: "object",
      maxProperties: 1000,
      additionalProperties: {
        type: "object",
        required: ["hazardRate", "recovery"],
        properties: { hazardRate: { type: "number", minimum: 0, maximum: 5 }, recovery: { type: "number", minimum: 0, maximum: 1 } },
        additionalProperties: false,
      },
    },
    indices: {
      type: "array",
      maxItems: 200,
      items: rateIndexRef,
      description:
        "API envelope extension (ADR-027, not part of the core's `deriva.market/1` and not of the snapshot id): floating-rate indices registered at runtime via `POST /api/market/indices` – exported by `GET /api/market/snapshot` when present, re-registered on import before the market is replaced (built-in names → 400 `INVALID_CURVE_SPEC`). Omitted when nothing was registered, so an untouched export equals the core's `serializeMarket` output.",
    },
    conventions: {
      type: "array",
      maxItems: 100,
      items: swapConventionsRef,
      description:
        "API envelope extension (ADR-027): swap conventions registered at runtime via `POST /api/market/conventions` (new currencies such as CZK/HUF, or overrides of built-in currencies) – exported when present, re-registered on import after `indices`.",
    },
    calendars: {
      type: "array",
      maxItems: 100,
      items: customCalendarRef,
      description:
        "API envelope extension (ADR-027, Markt R8-2): custom holiday calendars registered at runtime via `POST /api/market/calendars` – exported when present, re-registered on import before `indices` (which may reference them). The whole envelope is validated before anything is registered (N8-04): an invalid entry answers 400 `INVALID_CURVE_SPEC` with `details.problems[]` and registers nothing.",
    },
  },
  additionalProperties: false,
} as const;

export const marketSnapshotRef = { $ref: "MarketSnapshot#" } as const;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
/**
 * Machine-readable error codes of the API (`ErrorResponse.code`), by origin.
 * `core` mirrors the pricing core's `PricingErrorCode` union (a `PricingError`
 * thrown while pricing → 422; `INVALID_DATE`/`INVALID_TENOR` always and
 * `INVALID_TIMESTAMP` on snapshot import → 400, being client-input errors),
 * `api` are raised by the API layer itself. `WARNING_PREFIXES` are not errors:
 * they prefix entries of `PricingResult.warnings[]` / `HazardCurve.warnings[]`
 * on a 200 response.
 */
export const API_ERROR_CODES = {
  core: [
    "INVALID_TRADE",
    "NON_FINITE_PV",
    "MISSING_RATE",
    "MISSING_FIXING",
    "NO_DISCOUNT_CURVE",
    "CURVE_NOT_FOUND",
    "NO_FX_SPOT",
    "UNKNOWN_INDEX",
    "UNKNOWN_CALENDAR",
    "INVALID_CALENDAR",
    "UNSUPPORTED_TRADE_TYPE",
    "INVALID_FREQUENCY",
    "UNKNOWN_DAYCOUNT",
    "TOO_MANY_PERIODS",
    "VOL_MODEL_INCOMPATIBLE",
    "INVALID_CREDIT_CURVE",
    "INVALID_TIMESTAMP",
    "INVALID_DATE",
    "INVALID_TENOR",
    "INVALID_VOL_SURFACE",
    "INVALID_SNAPSHOT",
    "INVALID_CURVE_SPEC",
    "INVALID_HEDGE_RELATIONSHIP",
    "NUMERICAL_FAILURE",
  ],
  api: [
    "DOMAIN_ERROR",
    "VALIDATION_ERROR",
    "INVALID_JSON",
    "UNSUPPORTED_MEDIA_TYPE",
    "PAYLOAD_TOO_LARGE",
    "INVALID_REQUEST",
    "ID_MISMATCH",
    "INVALID_QUERY_MAP",
    "NOT_FOUND",
    "CONFLICT",
    "CSV_INVALID",
    "CSV_ROW_INVALID",
    "SNAPSHOT_MALFORMED",
    "SNAPSHOT_INVALID",
    "VOL_SURFACE_INVALID",
    "PERIOD_BUDGET_EXCEEDED",
    "STORE_BUDGET_EXCEEDED",
    "PRECONDITION_FAILED",
    "PRECONDITION_REQUIRED",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
  ],
} as const;
export const WARNING_PREFIXES = [
  "MISSING_FIXING",
  "MISSING_FX_FIXING",
  "SETTLES_TODAY",
  "COLLATERAL_CURVE_MISSING",
  "VOL_TYPE_CONVERTED",
  "HAZARD_FLOORED",
  "EXPIRED",
  "EXPIRES_TODAY",
  "BARRIER_STATE_UNKNOWN",
  "VOL_IMPLAUSIBLE",
  "MARKET_STATE_DROPPED",
  "PAR_RISK_INCOMPLETE",
] as const;

export const errorResponseSchema = {
  $id: "ErrorResponse",
  title: "ErrorResponse",
  description: "Einheitliches Fehlerobjekt aller Routen.",
  type: "object",
  required: ["error", "statusCode", "requestId"],
  properties: {
    error: { type: "string", description: "Human-readable message (never a stack trace)" },
    statusCode: { type: "integer" },
    code: {
      type: "string",
      // `examples` (the full code list) is added to the OpenAPI document by `openApiTransform` – @fastify/swagger would collapse it to a single `example`.
      description:
        "Machine-readable code (stable; the complete list is in `examples`). " +
        "422 domain errors of the pricing core: INVALID_TRADE (semantically invalid trade), NON_FINITE_PV, MISSING_RATE, MISSING_FIXING (policy `throw`), NO_DISCOUNT_CURVE (currency without a discount-curve mapping – set it with `POST /api/market/curves` (first curve of a currency) or `PUT /api/market { discountCurveId }`), CURVE_NOT_FOUND (also 422 when `PUT /api/market { discountCurveId }` names a curve that is not in the market), NO_FX_SPOT, UNKNOWN_INDEX (a floating-rate index that is not registered – `GET /api/market` lists the registered `currencies` and `indices`; further indices are registered with `POST /api/market/indices`, further currencies with `POST /api/market/conventions`), UNKNOWN_CALENDAR (a calendar id nothing registered – built-in ids and aliases are listed in `GET /api/market` `calendars`, further calendars are registered with `POST /api/market/calendars`), INVALID_CALENDAR (400 on `POST /api/market/calendars`: a custom-calendar definition the core rejects – a holiday that is not a valid ISO date such as `2027-02-30`, `details.problems[]`; a built-in id answers INVALID_CURVE_SPEC with `details.builtIn`, the snapshot envelope reports the same problems under INVALID_CURVE_SPEC), UNSUPPORTED_TRADE_TYPE, " +
        'INVALID_FREQUENCY (frequency that is not a positive tenor, e.g. "7Q"), UNKNOWN_DAYCOUNT (day count outside the supported conventions), ' +
        "VOL_MODEL_INCOMPATIBLE (requested option model cannot be fed from the vol surface – e.g. Black on a non-positive forward or strike without shift), " +
        "INVALID_CREDIT_CURVE (CDS quotes imply a negative hazard rate; `details.pillar`; avoid with `floorHazard`), INVALID_TIMESTAMP (non-ISO-8601 timestamp: 400 on snapshot import, 422 from the EMIR export), " +
        "INVALID_VOL_SURFACE (a stored vol surface is structurally unusable at pricing time – `details.problems`; 400 when `deserializeMarket` rejects a snapshot / `designationSnapshot`; the API's own pre-check answers VOL_SURFACE_INVALID first), INVALID_SNAPSHOT (400: unsupported snapshot `schema` or malformed `fxFixings` entry), INVALID_CURVE_SPEC (bootstrap specification unusable: malformed FX pair, missing reference curve, circular dependency; 400 on `POST /api/market/indices` / `/conventions` and on snapshot `indices`/`conventions` when a definition is invalid – unknown day count / calendar, wrong tenor for the type, indices of another currency – or names a built-in index, which cannot be replaced), INVALID_HEDGE_RELATIONSHIP (hedge relationship structurally inconsistent: FX pair without the hedged currency, non-positive hedge ratio, amortisation without schedule / loan rate), NUMERICAL_FAILURE (root search or implied-vol solve did not converge), DOMAIN_ERROR (plain core error without code). " +
        "400: VALIDATION_ERROR (request body, query, params or headers violate the JSON schema – `validation[]` carries the Ajv errors), INVALID_JSON (body is not valid JSON or is empty with `content-type: application/json`), INVALID_TRADE (programming error while pricing, reported as invalid trade), INVALID_DATE (a date that does not exist, e.g. `2027-02-30`; `details.input`), INVALID_TENOR (unparsable tenor string; `details.input`), TOO_MANY_PERIODS (estimated coupon periods of one leg – or of a hedged item's schedule – above the bound), " +
        "INVALID_REQUEST (semantically invalid request outside the schema, e.g. no trades for a portfolio par-risk run), ID_MISMATCH (body `id` differs from the path id), INVALID_QUERY_MAP (`uti`/`transactionPrice` map malformed or above 4 kB – use the POST body), CSV_INVALID (CSV import: unparsable file / header / missing `?type=`), SNAPSHOT_MALFORMED, VOL_SURFACE_INVALID (a swaption / caplet / FX vol surface in `PUT /api/market`, a snapshot or a `designationSnapshot` is structurally inconsistent – grid rows ≠ expiries, row length ≠ tenors / strikes, FX vectors ≠ expiries, axes not strictly increasing, key ≠ currency / pair; `problems[]` names each path); " +
        "404 NOT_FOUND (trade, curve or route); 409 CONFLICT (trade id exists); 412 PRECONDITION_FAILED; 413 PERIOD_BUDGET_EXCEEDED (compute budget of one request), STORE_BUDGET_EXCEEDED (the trade store would exceed `MAX_STORE_PERIODS` estimated coupon periods) and PAYLOAD_TOO_LARGE (body above the 5 MB limit); 415 UNSUPPORTED_MEDIA_TYPE (request body with a content-type other than `application/json` – `text/plain`, `application/xml`, … – or `text/csv` on any route but the import route); 422 SNAPSHOT_INVALID (`problems[]`); 428 PRECONDITION_REQUIRED; 429 RATE_LIMITED (also on unknown routes); 500 INTERNAL_ERROR. " +
        "Per-item codes of batch results (`POST /api/trades/import`, `GET /api/trades?price=1`): the same plus CSV_ROW_INVALID (a CSV row that could not be mapped – parser / builder error – or whose built trade violates the `Trade` schema; the row is reported, the upload proceeds) and INTERNAL_ERROR (pricing failed for reasons that are not the trade's). " +
        "Not errors – prefixes of `warnings[]` entries on 200 responses: `MISSING_FIXING:` (fixing estimated from the curve), `MISSING_FX_FIXING:` (FX fixing of a past MtM reset – or of an expired FX option's exercise date – approximated by today's rate), `SETTLES_TODAY:` (FX leg delivering on the valuation date valued as a value-today exchange), `EXPIRED:` (FX option past its expiry with the delivery still pending – settled payoff, Greeks 0), `EXPIRES_TODAY:` (FX option expiring on the valuation date – intrinsic value on today's fixing / spot), `COLLATERAL_CURVE_MISSING:` (collateral currency without a collateral discount curve – standard curve used), `VOL_TYPE_CONVERTED:` (surface vol converted into the requested model's quotation, e.g. a Black cap on a normal caplet surface), `HAZARD_FLOORED:` (hazard pillar floored at 0), `BARRIER_STATE_UNKNOWN:` (barrier option without `barrier.hit` whose knock state was derived from today's spot or the expiry fixing – touch events in between are not observed), `VOL_IMPLAUSIBLE:` (a vol surface the valuation read – or a surface sent to `PUT /api/market` / the snapshot import, then in the 200 response's `warnings[]` – has numbers that do not fit its `volType`, e.g. a Lognormal cube with a median below 1 %, or is degenerate: all zeros / identical), `MARKET_STATE_DROPPED:` (`PUT /api/market`: state of the previous market a valuation-date change or `discardImport` could not carry over – a runtime curve that no longer bootstraps, a discount / collateral mapping whose curve is gone, a discarded imported snapshot; everything else – runtime curves, mappings, vol overrides, fixings, spots – survives the change, N8-01), `PAR_RISK_INCOMPLETE:` (`POST /api/risk/par` and `/par/portfolio`: a curve the trade depends on has no bootstrap quotes in the store – imported snapshot curves outside the sample set – and was not bumped; the curve is listed in `curvesWithoutQuotes[]`; load it through `POST /api/market/curves` to track its quotes, Markt R8-3).",
    },
    details: {
      type: "object",
      additionalProperties: true,
      description:
        "Structured context of a PricingError (trade id, curve id, `input` of INVALID_DATE / INVALID_TENOR, …) or of a budget error (periods, limits)",
    },
    requestId: { type: "string" },
    validation: { type: "array", items: { type: "object", additionalProperties: true }, description: "Ajv validation errors (400 VALIDATION_ERROR)" },
    currentEtag: { type: "string", description: 'Current (strong) ETag `"version-hash"` on 412 / 428' },
    problems: {
      type: "array",
      items: { type: "string" },
      description: "Snapshot validation problems (422 SNAPSHOT_INVALID) or vol-surface problems (400 VOL_SURFACE_INVALID)",
    },
  },
  additionalProperties: true,
} as const;

export const errorRef = { $ref: "ErrorResponse#" } as const;

/** Error responses shared by every rate-limited route (rate limit, internal error); 415 only where a request body exists (N6-03). */
const commonErrors = {
  415: {
    ...errorRef,
    description:
      "Unsupported media type – the request body arrived with a content-type other than `application/json` (`text/plain`, `application/xml`, …; `text/csv` only on `POST /api/trades/import`); `code: UNSUPPORTED_MEDIA_TYPE`",
  },
  429: {
    ...errorRef,
    description:
      "Rate limit exceeded (default 600/min per client IP, unknown routes included; the key is `request.ip`, which is the `X-Forwarded-For` client only when the server runs with `TRUST_PROXY` – see SECURITY.md)",
  },
  500: { ...errorRef, description: "Internal server error (generic message, `code: INTERNAL_ERROR`, details logged server-side)" },
} as const;
/** Response map for routes exempt from the rate limit (health probes): success + generic 500, no 415/429. */
export function responsesUnlimited(success: Record<number, unknown>): Record<number, unknown> {
  return { ...success, 500: commonErrors[500] };
}

type ErrorStatus = 400 | 404 | 409 | 412 | 413 | 422 | 428;
const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: "Schema validation failed (`code: VALIDATION_ERROR`, `validation[]`), malformed JSON (`code: INVALID_JSON`), invalid trade shape, or a leg with more than the allowed coupon periods (`code: TOO_MANY_PERIODS`) – every 400 carries a catalogued `code`",
  404: "Resource not found",
  409: "Conflict (resource already exists)",
  412: "Precondition failed (`If-Match` does not match the current strong ETag – RFC 9110 strong comparison, a `W/` tag never matches)",
  413: "Payload too large (body limit 5 MB, `code: PAYLOAD_TOO_LARGE`) or compute budget exceeded (`code: PERIOD_BUDGET_EXCEEDED` – estimated coupon periods × valuations per request)",
  422: "Domain error – trade cannot be priced (`code`)",
  428: "Precondition required – `If-Match` missing while the server runs with REQUIRE_IF_MATCH=1 (`code: PRECONDITION_REQUIRED`, `currentEtag`)",
};

/** Build `response` map of an operation **with** a request body: success responses + selected error statuses + 415/429/500. */
export function responses(success: Record<number, unknown>, ...errors: ErrorStatus[]): Record<number, unknown> {
  const out: Record<number, unknown> = { ...success };
  for (const s of errors) out[s] = { ...errorRef, description: ERROR_DESCRIPTIONS[s] };
  return { ...out, ...commonErrors };
}

/**
 * Response map of a body-less operation (GET, DELETE): like `responses`, but without 415 – a request without a
 * body cannot carry an unsupported media type, so documenting it there would be unreachable (N6-03).
 */
export function responsesWithoutBody(success: Record<number, unknown>, ...errors: ErrorStatus[]): Record<number, unknown> {
  const { 415: _unsupportedMediaType, ...rest } = responses(success, ...errors);
  return rest;
}

/** Untyped-but-documented value (see file header on fast-json-stringify coercion). */
const num = (description: string) => ({ description }) as const;
const anyObject = (description: string) => ({ type: "object", additionalProperties: true, description }) as const;
const anyArray = (description: string) => ({ type: "array", items: {}, description }) as const;

export const pricingResultSchema = {
  type: "object",
  description:
    "PricingResult: PV in Reporting-Währung, Legs mit Cashflows, Analytics, Warnungen. Header `X-Market-Snapshot-Id` trägt die Snapshot-ID des Marktes.",
  properties: {
    tradeId: { type: "string" },
    tradeType: { type: "string", enum: [...TRADE_TYPES] },
    valuationDate: isoDate,
    currency: currency,
    pv: num("PV in reporting currency, positive = asset to us"),
    legs: anyArray(
      'LegResult[] (legType, pv, pvReporting, annuity, cashflows[] with kind Interest | Notional | Premium | OptionPayoff | Settlement, paymentDate, discountFactor, presentValue). A trade with an `upfront` premium / fee carries it as the last leg (`legType: "Upfront premium"`) with one cashflow of `kind: "Premium"` (amount −upfront.amount, discounted from `upfront.date`), so the premium appears in the cashflow table, in theta as a cashflow and in the CVA grid; before round 6 it was subtracted from the PV without a cashflow.',
    ),
    analytics: anyObject(
      "Instrument analytics – numbers plus short enumerated strings (parRate, forward, impliedVol, Greeks). Swaps: `parRate` / `fairSpread` are computed from the economic legs only (R8, N8-1 – an `upfront` premium no longer distorts them); with an `upfront` the all-in figures `parRateAllIn` / `fairSpreadAllIn` (the rate / spread that sets the PV including the premium to zero) are reported next to them. FX forwards and FX swaps: `deltaAmount` = PV change in reporting currency for +1 % of the (near-leg) buy currency; FX options: `deltaAmount` (base currency +1 %) plus `deltaPct` = signed spot delta as a fraction of the notional (−1 … 1) and `deltaPremiumAdjusted` (premium-adjusted spot delta, R8); barrier options report `rebateAt` (hit | expiry | default – the rebate convention applied). " +
        "Caps/floors and swaptions: `model` (Bachelier | Black | ShiftedBlack), `volatility` in the model's own quotation, `volConverted` (\"yes\" when the surface vols were converted into that quotation because the requested model differs from the surface's vol type – then `warnings[]` carries `VOL_TYPE_CONVERTED:` and swaptions additionally report the unconverted `surfaceVolatility`). " +
        'FX options additionally: `lifecycle` (state on the valuation date: live | expires-today | expired-pending-delivery | delivered – expired / delivered options are a settled payoff with Greeks 0 and `warnings[]` `EXPIRED:` / `EXPIRES_TODAY:`) and `greeksMethod` ("analytic" for vanillas, "finite-difference" for barrier / digital, "settled-payoff" after expiry); barrier options report `barrierState` (alive | knocked-in | knocked-out – from `barrier.hit` when given, otherwise derived with a `BARRIER_STATE_UNKNOWN:` warning when the derivation decides the value). Dates live in `details`.',
    ),
    details: anyObject(
      "Non-numeric details complementing `analytics`: ISO dates such as `spotDate` (FX; FX options additionally `standardDelivery` = spot date of the expiry, the market-standard delivery the trade's `deliveryDate` may deviate from), `fixingDate`/`settlementDate` (FRA), `maturity` (swaps)",
    ),
    accrued: num("Accrued interest in reporting currency"),
    warnings: {
      type: "array",
      items: { type: "string" },
      description:
        "Pricer warnings (English); stable prefixes `MISSING_FIXING:`, `VOL_TYPE_CONVERTED:`, `BARRIER_STATE_UNKNOWN:`, `VOL_IMPLAUSIBLE:` … (see `ErrorResponse.code`)",
    },
    timingMs: num("Wall-clock pricing time (diagnostic, not part of any hash)"),
  },
  additionalProperties: true,
} as const;

export const riskReportSchema = {
  type: "object",
  description: "RiskReport: DV01, Bucket-Deltas, FX-Delta, Vega, Theta, Gamma in Reporting-Währung.",
  properties: {
    tradeId: { type: "string" },
    currency: currency,
    dv01: num("Parallel DV01 (1bp, central)"),
    bucketed: anyArray("Key-rate deltas per curve pillar"),
    fxDelta: anyObject("FX delta per currency (+1 % appreciation)"),
    vega: num("Vega (+1bp normal / +1 vol point)"),
    theta: num("1-day theta = PV(t+1) + cashflows paid in (t, t+1] − PV(t), every cashflow counted once"),
    thetaDetail: anyObject(
      "Theta decomposition { total, carry, rollDown, cashflows, valueTodayOnRollDate }: `cashflows` = coupons that leave the PV by t+1, `valueTodayOnRollDate` = undiscounted amount of FX legs delivering on t+1 that stay in PV(t+1) as a value-today exchange (`SETTLES_TODAY:`) and are therefore not in `cashflows`",
    ),
    gamma: num("Gamma"),
  },
  additionalProperties: true,
} as const;

/** Strong trade ETag as emitted by `tradeEtag` (`lib/store.ts`): `"<version>-<hash>"` including the quotes (N5-03, N7-02). */
export const TRADE_ETAG_PATTERN = '^"\\d+-[0-9a-f]+"$';

export const storedTradeSchema = {
  type: "object",
  description: "Stored trade with version and strong ETag (same value as the `ETag` header).",
  required: ["trade", "createdAt", "updatedAt", "version", "etag"],
  properties: {
    trade: tradeRef,
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    version: { type: "integer" },
    etag: {
      type: "string",
      pattern: TRADE_ETAG_PATTERN,
      description:
        'Strong ETag `"<version>-<hash>"` (quotes included; identical to the `ETag` header). Send it unchanged in `If-Match` – a weak validator (`W/"…"`) never matches under RFC 9110 §13.1.1 and answers 412.',
    },
    pricing: anyObject("Present with `?price=1`: { pv, currency, analytics, warnings } or { pv: null, error, code }"),
  },
  additionalProperties: true,
} as const;

export const valuationReportSchema = {
  type: "object",
  description: "ValuationReport (prüfungsfähig): Marktsnapshot, Cashflows, Sensitivitäten, XVA, IFRS-13-Level, Kostentransparenz, Methodik, Hashes.",
  properties: {
    generatedAt: { type: "string" },
    valuationDate: isoDate,
    reportingCurrency: currency,
    trade: tradeRef,
    pricing: pricingResultSchema,
    risk: anyObject("RiskReport (unless includeRisk=false)"),
    xva: anyObject("XvaResult when credit inputs are given"),
    market: anyObject("Curves with pillars, FX spots"),
    fairValue: anyObject("{ riskFree, cva, dva, adjusted, ifrs13Level (1|2|3), rationale }"),
    costTransparency: anyObject("MiFID II ex-ante costs when transactionPrice is given"),
    methodology: { type: "array", items: { type: "string" } },
    audit: anyObject("{ snapshotId, inputsHash, reportHash, engineVersion, preparedBy? }"),
    governance: anyObject("Valuation governance (snapshot status, input sources, model version, validatedBy)"),
    whatIf: anyObject("Set when produced under a what-if shift (stress valuation, not an audit valuation)"),
  },
  additionalProperties: true,
} as const;

const portfolioAggregateSchema = {
  type: "object",
  description: "PortfolioAggregate: sums over the trades of one group (failed valuations excluded).",
  properties: {
    key: { type: "string", description: 'Group key (counterparty, book or trade type; "–" when the trade has none)' },
    trades: { type: "integer" },
    pv: num("PV in reporting currency"),
    dv01: num("Parallel DV01 (+1bp all rate curves)"),
    theta: num("1-day theta"),
    fxDelta: anyObject(
      'FX delta keyed by pair "<ccy><reporting>" (e.g. "USDEUR"): PV change per +1 % appreciation of the first currency vs the reporting currency',
    ),
    warnings: { type: "integer", description: "Number of pricing warnings in the group" },
  },
  additionalProperties: true,
} as const;

export const portfolioReportSchema = {
  type: "object",
  description:
    "PortfolioReport (book level): PV, parallel DV01, 1-day theta and FX delta per trade, aggregated by counterparty, book and trade type, with totals, warning counts and the audit anchors of the single-trade report (snapshot id, inputs hash, report hash, engine version). Header `X-Market-Snapshot-Id` = `audit.snapshotId`.",
  properties: {
    generatedAt: isoDateTime,
    valuationDate: isoDate,
    reportingCurrency: currency,
    market: anyObject("{ label?, source? } of the market snapshot"),
    lines: {
      type: "array",
      description: "One line per trade, in input order; a failed valuation carries `error` and null measures and is excluded from the aggregates",
      items: {
        type: "object",
        properties: {
          tradeId: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: [...TRADE_TYPES] },
          counterparty: { type: "string" },
          book: { type: "string" },
          pv: num("PV in reporting currency (null when the valuation failed)"),
          dv01: num("Parallel DV01 (+1bp)"),
          theta: num("1-day theta (null when not computable or `theta: false`)"),
          fxDelta: anyObject('FX delta keyed by pair "<ccy><reporting>" (+1 % appreciation of the foreign currency); empty with `fxDelta: false`'),
          warnings: { type: "array", items: { type: "string" }, description: "Pricer warnings (English), e.g. MISSING_FIXING" },
          error: { type: "string", description: "Set when the valuation threw" },
        },
        additionalProperties: true,
      },
    },
    totals: portfolioAggregateSchema,
    byCounterparty: { type: "array", items: portfolioAggregateSchema },
    byBook: { type: "array", items: portfolioAggregateSchema },
    byType: { type: "array", items: portfolioAggregateSchema },
    failed: { type: "integer", description: "Number of trades whose valuation failed" },
    warningsCount: { type: "integer", description: "Total number of pricing warnings" },
    groupBy: {
      type: "array",
      items: { type: "string", enum: [...PORTFOLIO_GROUPINGS] },
      description: "Echo of the request's `groupBy` (absent when all aggregations are returned)",
    },
    audit: anyObject("{ snapshotId, inputsHash, reportHash, engineVersion, preparedBy? } – deterministic for the same trades on the same snapshot"),
  },
  additionalProperties: true,
} as const;

/** ITS (EU) 2022/1860 value formats (Table 2): boolean fields, field 31 Cleared, field 30 Clearing obligation. */
export const EMIR_BOOLEAN = ["TRUE", "FLSE"] as const;
export const EMIR_CLEARED = ["Y", "N", "I"] as const;
export const EMIR_CLEARING_OBLIGATION = ["TRUE", "FLSE", "UKWN"] as const;

export const emirRecordSchema = {
  type: "object",
  description:
    "EMIR-Refit valuation record (ITS (EU) 2022/1860 Table 2: 21 valuation amount, 22 valuation currency, 23 valuation timestamp, 24 valuation method, 25 delta, 26 collateral portfolio indicator; 30 clearing obligation, 31 cleared; clearing member from Table 1). Value formats follow the ITS: booleans `TRUE`/`FLSE`, cleared `Y`/`N`/`I`, clearing obligation `TRUE`/`FLSE`/`UKWN`.",
  properties: {
    uti: { type: "string", description: "From `?uti=` map, else the trade's `uti`" },
    tradeId: { type: "string" },
    counterparty: { type: "string" },
    productClassification: { type: "string" },
    notional: num("Notional"),
    notionalCurrency: currency,
    valuationAmount: num("Valuation amount"),
    valuationCurrency: currency,
    valuationTimestamp: {
      ...isoDateTime,
      description: "Field 23 – ISO-8601 UTC (`timestamp` → snapshot `meta.snapshotTime` → `asOf` → 17:00 UTC of the valuation date)",
    },
    valuationMethod: { type: "string", enum: ["MTMA", "MTMO", "CCPV"], description: "Field 24" },
    delta: num("Field 25 – delta of the position (options / collateralised trades)"),
    collateralPortfolioIndicator: { type: "string", enum: [...EMIR_BOOLEAN], description: "Field 26 – ITS boolean format `TRUE` / `FLSE`" },
    cleared: {
      type: "string",
      enum: [...EMIR_CLEARED],
      description:
        "Field 31 – ITS format `Y` (cleared) / `N` (not cleared) / `I` (intent to clear); from the trade's `cleared` (`I` is not produced: the trade model has no intent flag yet)",
    },
    clearingObligation: {
      type: "string",
      enum: [...EMIR_CLEARING_OBLIGATION],
      description:
        "Field 30 – ITS format `TRUE` / `FLSE` / `UKWN`; from the trade's `clearingObligation` (true → TRUE, false → FLSE), else the reporter default `clearingObligation`; UKWN when neither is given – never derived from `cleared`",
    },
    clearingMember: { type: "string", description: "Table 1 – the trade's `clearingMember`" },
  },
  additionalProperties: true,
} as const;

/**
 * Body of `POST /api/emir/valuations` (N4-06): the same options as the GET query, with the
 * trade-id maps as JSON objects instead of URL-encoded JSON strings. The GET variant stays for
 * small maps (≤ 4 kB per map – Node's 16 kB header limit would otherwise answer 431 before the
 * route runs); reporting data (UTIs, transaction prices) belongs in a body, which is also never
 * written to the request log.
 */
export const emirValuationsBodySchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["json", "csv"] },
    reportingCurrency: currency,
    asOf: { ...isoDateTime, description: "Reporter's valuation time (field 23) when the snapshot has no `meta.snapshotTime`; default EoD 17:00 UTC" },
    timestamp: { ...isoDateTime, description: "Explicit valuation timestamp (field 23), overrides snapshot time and `asOf`" },
    method: {
      type: "string",
      enum: ["MTMA", "MTMO", "CCPV"],
      description: "Valuation method (field 24) for all records, default MTMO (MTMA with `transactionPrice`)",
    },
    uti: {
      type: "object",
      maxProperties: 5000,
      propertyNames: tradeId,
      additionalProperties: { type: "string", pattern: "^[A-Za-z0-9]{1,52}$" },
      description: "Trade id → UTI (overrides the trade's own `uti`)",
    },
    transactionPrice: {
      type: "object",
      maxProperties: 5000,
      propertyNames: tradeId,
      additionalProperties: { type: "number" },
      description: "Trade id → observable transaction price; those trades report MTMA unless `method` is given",
    },
    clearingObligation: {
      type: "boolean",
      description: "Reporter default for field 30 (Art. 4 EMIR) applied to trades without their own `clearingObligation`; omitted → UKWN",
    },
    intentToClear: {
      type: "boolean",
      description: "Field 31 `I` (intent to clear) for trades that are not (yet) cleared but will be submitted for clearing; cleared trades stay `Y`",
    },
  },
  additionalProperties: false,
} as const;

/**
 * OpenAPI request body for the CSV variant of `POST /api/trades/import`. Validation runs on the
 * JSON shape (the CSV `preValidation` maps rows to `{ trades, mode }` first), so this entry is
 * added to the document by `openApiTransform`, not to the route's validation schema.
 */
export const csvRequestBody = {
  schema: {
    type: "string",
    description:
      "CSV document: header row plus one trade per row; `?type=` selects one of the eleven column templates (see the operation description; `BasisSwap`/`AmortisingSwap`/`ImmSwap` build `InterestRateSwap`s), `?mode=upsert` replaces existing ids. Separator `;`/`,`/tab, German or plain numbers, dates ISO or DD.MM.YYYY; `collateralCurrency` accepts `none` for an uncollateralised trade. Rows that cannot be mapped or violate the `Trade` schema are reported per row (`CSV_ROW_INVALID`).",
  },
} as const;

export const csvResponse = { type: "string", description: "CSV (Semikolon, Dezimalkomma, UTF-8-BOM) als Download" } as const;
export const markdownResponse = { type: "string", description: "Markdown-Dokument als Download" } as const;

/** `content`-style response for routes that return JSON or a text download depending on `?format`. */
export function jsonOrText(jsonSchema: unknown, mediaType: string, textSchema: unknown, description: string) {
  return { description, content: { "application/json": { schema: jsonSchema }, [mediaType]: { schema: textSchema } } };
}

export const objectResponse = anyObject;
export const arrayResponse = anyArray;
