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
const frequency = { type: "string", pattern: "^(\\d{1,3}[DWMYdwmy]|ZC)$", description: 'Coupon frequency as tenor ("1M", "3M", "6M", "1Y") or "ZC"' } as const;
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
    properties: { amount: { type: "number" }, currency, date: isoDate },
    additionalProperties: false,
  },
  tags: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 20 },
  status: { type: "string", enum: [...TRADE_STATUS], description: 'Lifecycle status; "Quoted" = firm quote valid until `quoteValidUntil`' },
  quoteValidUntil: { ...isoDate, description: 'Validity of a firm quote (status "Quoted"); informational' },
  uti: { type: "string", pattern: "^[A-Za-z0-9]{1,52}$", description: "Unique Transaction Identifier (EMIR Refit, ISO 23897) – reported in the EMIR export" },
  cleared: { type: "boolean", description: "Centrally cleared (EMIR Art. 4/4a) – EMIR fields 31/32 (cleared, clearing obligation)" },
  clearingMember: { ...shortText, description: "Clearing member when `cleared` (EMIR field 33)" },
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
  notional: positiveNumber,
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
      properties: { date: isoDate, notional: { type: "number", minimum: 0 } },
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

export const fixedLegSchema = {
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

export const floatLegSchema = {
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
  },
  additionalProperties: false,
} as const;

export const swapLegSchema = {
  type: "object",
  required: ["type"],
  discriminator: { propertyName: "type" },
  oneOf: [fixedLegSchema, floatLegSchema],
} as const;

const legs = { type: "array", items: swapLegSchema, minItems: 1, maxItems: 4 } as const;

// ---------------------------------------------------------------------------
// Trade variants
// ---------------------------------------------------------------------------
export const interestRateSwapSchema = {
  type: "object",
  required: ["id", "type", "legs"],
  properties: { type: { type: "string", enum: ["InterestRateSwap"] }, ...tradeBaseProperties, legs },
  additionalProperties: false,
} as const;

export const fraSchema = {
  type: "object",
  required: ["id", "type", "payReceive", "notional", "currency", "index", "startDate", "endDate", "fixedRate"],
  properties: {
    type: { type: "string", enum: ["FRA"] },
    ...tradeBaseProperties,
    payReceive: { ...payReceive, description: "Pay = pay fixed" },
    notional: positiveNumber,
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
    notional: positiveNumber,
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
    underlying: interestRateSwapSchema,
    model: { type: "string", enum: [...IR_MODELS] },
    volOverride: { type: "number", minimum: 0, maximum: 5 },
    shift: { type: "number", minimum: 0, maximum: 1 },
  },
  additionalProperties: false,
} as const;

const fxForwardLegProperties = {
  buyCurrency: currency,
  buyAmount: positiveNumber,
  sellCurrency: currency,
  sellAmount: positiveNumber,
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
  type: "object",
  required: ["id", "type", ...fxForwardRequired],
  properties: { type: { type: "string", enum: ["FxForward"] }, ...tradeBaseProperties, ...fxForwardLegProperties },
  additionalProperties: false,
} as const;

const { id: _omitId, ...fxSwapLegBase } = tradeBaseProperties;
void _omitId;
const fxSwapLegSchema = {
  type: "object",
  required: [...fxForwardRequired],
  properties: { ...fxSwapLegBase, ...fxForwardLegProperties },
  additionalProperties: false,
} as const;

export const fxSwapSchema = {
  type: "object",
  required: ["id", "type", "nearLeg", "farLeg"],
  properties: { type: { type: "string", enum: ["FxSwap"] }, ...tradeBaseProperties, nearLeg: fxSwapLegSchema, farLeg: fxSwapLegSchema },
  additionalProperties: false,
} as const;

export const fxOptionSchema = {
  type: "object",
  required: ["id", "type", "payReceive", "optionType", "pair", "strike", "notional", "expiryDate", "deliveryDate"],
  properties: {
    type: { type: "string", enum: ["FxOption"] },
    ...tradeBaseProperties,
    payReceive: { ...payReceive, description: "Receive = long" },
    optionType: { type: "string", enum: ["Call", "Put"], description: "Call = right to buy the base currency" },
    pair: currencyPair,
    strike: positiveNumber,
    notional: { ...positiveNumber, description: "Notional in base currency" },
    expiryDate: isoDate,
    deliveryDate: isoDate,
    exercise: { type: "string", enum: ["European"] },
    premiumCurrency: currency,
    barrier: {
      type: "object",
      required: ["type", "level"],
      properties: { type: { type: "string", enum: [...BARRIER_TYPES] }, level: positiveNumber, rebate: { type: "number", minimum: 0 } },
      additionalProperties: false,
    },
    digital: {
      type: "object",
      required: ["payoutCurrency", "payout"],
      properties: { payoutCurrency: currency, payout: positiveNumber },
      additionalProperties: false,
    },
    volOverride: { type: "number", minimum: 0, maximum: 5 },
  },
  additionalProperties: false,
} as const;

export const crossCurrencySwapSchema = {
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
  oneOf: [interestRateSwapSchema, fraSchema, capFloorSchema, swaptionSchema, fxForwardSchema, fxSwapSchema, fxOptionSchema, crossCurrencySwapSchema],
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
    "Bewertungs-Governance (IDW RS HFA 35 / MaRisk): Freigabestatus des Snapshots, Input-Quellen, Modellversion, Validierer. Alle Felder optional (Defaults: indicative, ctx.meta.source, Engine-Version).",
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

export const marketPutSchema = {
  type: "object",
  properties: {
    valuationDate: isoDate,
    fxSpots: { type: "object", additionalProperties: { type: "number", exclusiveMinimum: 0 }, propertyNames: currencyPair },
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
  },
  additionalProperties: false,
} as const;

export const bootstrapBodySchema = {
  type: "object",
  required: ["spec"],
  properties: {
    valuationDate: isoDate,
    spec: {
      type: "object",
      required: ["id", "currency", "index", "quotes"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64 },
        currency,
        index: rateIndex,
        interpolation: { type: "string", enum: [...INTERPOLATIONS] },
        dayCount,
        discountCurveId: { type: "string", maxLength: 64 },
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
    domesticNotional: positiveNumber,
    fxSpot: { ...positiveNumber, description: "1 domestic = fxSpot foreign; fixes the foreign notional (alternatively `foreignNotional`)" },
    foreignNotional: positiveNumber,
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
    collateralCurrency: currency,
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
    notional: positiveNumber,
    payReceive: { ...payReceive, description: "Pay = pay the fixed rate" },
    index: { ...rateIndex, description: "Default: the currency's IBOR index" },
    start: {
      type: "string",
      pattern: "^(\\d{1,3}x\\d{1,3}|\\d{4}-\\d{2}-\\d{2})$",
      description: 'Period "3x6" (months from the spot date of `valuationDate`) or ISO accrual start (then `end` applies, default start + index tenor)',
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

const templateBranch = (template: string, params: unknown) =>
  ({
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

export const fromTemplateBodySchema = {
  type: "object",
  required: ["template", "params"],
  description: "Discriminated over `template`; `params` mirrors the core builder's parameters.",
  discriminator: { propertyName: "template" },
  oneOf: [templateBranch("CrossCurrencySwap", crossCurrencySwapParamsSchema), templateBranch("FRA", fraParamsSchema)],
} as const;

// ---------------------------------------------------------------------------
// Market snapshot (`deriva.market/1`)
// ---------------------------------------------------------------------------
const volType = { type: "string", enum: ["Normal", "Lognormal", "ShiftedLognormal"] } as const;
const numberVector = { type: "array", items: { type: "number" }, maxItems: 200 } as const;
const numberGrid = { type: "array", items: numberVector, maxItems: 200 } as const;
const idMap = { type: "object", additionalProperties: { type: "string", maxLength: 64 }, maxProperties: 100 } as const;

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
      properties: { source: shortText, snapshotTime: { type: "string", maxLength: 40 }, label: shortText },
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
    swaptionVols: {
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
          expiries: numberVector,
          tenors: numberVector,
          atm: numberGrid,
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
    },
    capletVols: {
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
          expiries: numberVector,
          strikes: numberVector,
          vols: numberGrid,
        },
        additionalProperties: false,
      },
    },
    fxVols: {
      type: "object",
      maxProperties: 100,
      additionalProperties: {
        type: "object",
        required: ["id", "pair", "expiries", "atm", "rr25", "bf25"],
        properties: {
          id: { type: "string", maxLength: 64 },
          pair: currencyPair,
          expiries: numberVector,
          atm: numberVector,
          rr25: numberVector,
          bf25: numberVector,
          rr10: numberVector,
          bf10: numberVector,
          atmConvention: { type: "string", enum: ["DeltaNeutral", "Forward"] },
          deltaConvention: { type: "string", enum: ["Spot", "Forward", "PremiumAdjustedSpot", "PremiumAdjustedForward"] },
          smileInterpolation: { type: "string", enum: ["linear", "cubic"] },
          strangleType: { type: "string", enum: ["Smile", "Broker"] },
        },
        additionalProperties: false,
      },
    },
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
  },
  additionalProperties: false,
} as const;

export const marketSnapshotRef = { $ref: "MarketSnapshot#" } as const;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
export const errorResponseSchema = {
  $id: "ErrorResponse",
  title: "ErrorResponse",
  description: "Einheitliches Fehlerobjekt aller Routen.",
  type: "object",
  required: ["error", "statusCode", "requestId"],
  properties: {
    error: { type: "string", description: "Human-readable message (never a stack trace)" },
    statusCode: { type: "integer" },
    code: { type: "string", description: "Machine-readable domain code (422), e.g. MISSING_FIXING, NON_FINITE_PV, INVALID_TRADE" },
    details: { type: "object", additionalProperties: true, description: "Structured context of a PricingError (trade id, curve id, …)" },
    requestId: { type: "string" },
    validation: { type: "array", items: { type: "object", additionalProperties: true }, description: "Ajv validation errors (400)" },
    currentEtag: { type: "string", description: "Current ETag on 412" },
    problems: { type: "array", items: { type: "string" }, description: "Snapshot validation problems (422)" },
  },
  additionalProperties: true,
} as const;

export const errorRef = { $ref: "ErrorResponse#" } as const;

/** Common error responses shared by every route (rate limit, internal error). */
const commonErrors = {
  429: { ...errorRef, description: "Rate limit exceeded (600/min per client)" },
  500: { ...errorRef, description: "Internal server error (generic message, details logged server-side)" },
} as const;

type ErrorStatus = 400 | 404 | 409 | 412 | 413 | 422;
const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: "Schema validation failed (`validation[]`), malformed JSON or invalid trade shape",
  404: "Resource not found",
  409: "Conflict (resource already exists)",
  412: "Precondition failed (ETag mismatch)",
  413: "Payload too large (body limit 5 MB)",
  422: "Domain error – trade cannot be priced (`code`)",
};

/** Build `response` map: given success responses + selected error statuses + common errors. */
export function responses(success: Record<number, unknown>, ...errors: ErrorStatus[]): Record<number, unknown> {
  const out: Record<number, unknown> = { ...success };
  for (const s of errors) out[s] = { ...errorRef, description: ERROR_DESCRIPTIONS[s] };
  return { ...out, ...commonErrors };
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
    legs: anyArray("LegResult[] (pv, pvReporting, annuity, cashflows[] with paymentDate/discountFactor/presentValue)"),
    analytics: anyObject(
      "Instrument analytics – numbers plus short enumerated strings (parRate, forward, impliedVol, Greeks). FX forwards and FX swaps: `deltaAmount` = PV change in reporting currency for +1 % of the (near-leg) buy currency; FX options: `deltaAmount` (base currency +1 %) plus `deltaPct` = signed spot delta as a fraction of the notional (−1 … 1). Dates live in `details`.",
    ),
    details: anyObject(
      "Non-numeric details complementing `analytics`: ISO dates such as `spotDate` (FX), `fixingDate`/`settlementDate` (FRA), `maturity` (swaps)",
    ),
    accrued: num("Accrued interest in reporting currency"),
    warnings: { type: "array", items: { type: "string" } },
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
    theta: num("1-day theta"),
    gamma: num("Gamma"),
  },
  additionalProperties: true,
} as const;

export const storedTradeSchema = {
  type: "object",
  description: "Stored trade with version and weak ETag.",
  required: ["trade", "createdAt", "updatedAt", "version", "etag"],
  properties: {
    trade: tradeRef,
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    version: { type: "integer" },
    etag: { type: "string", description: 'Weak ETag `W/"<version>-<hash>"`' },
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

export const emirRecordSchema = {
  type: "object",
  description: "EMIR-Refit valuation record (Table 2, fields 21–26 valuation, 31–33 clearing).",
  properties: {
    uti: { type: "string", description: "From `?uti=` map, else the trade's `uti`" },
    tradeId: { type: "string" },
    counterparty: { type: "string" },
    productClassification: { type: "string" },
    notional: num("Notional"),
    notionalCurrency: currency,
    valuationAmount: num("Valuation amount"),
    valuationCurrency: currency,
    valuationTimestamp: { type: "string" },
    valuationMethod: { type: "string", enum: ["MTMA", "MTMO", "CCPV"] },
    delta: num("Delta of the position (options / collateralised trades)"),
    collateralPortfolioIndicator: { type: "string", enum: ["TRUE", "FALSE"] },
    cleared: { type: "string", enum: ["TRUE", "FALSE"], description: "Field 31 – from the trade's `cleared`" },
    clearingObligation: { type: "string", enum: ["Y", "N"], description: "Field 32 – derived: cleared → Y" },
    clearingMember: { type: "string", description: "Field 33 – the trade's `clearingMember`" },
  },
  additionalProperties: true,
} as const;

export const csvResponse = { type: "string", description: "CSV (Semikolon, Dezimalkomma, UTF-8-BOM) als Download" } as const;
export const markdownResponse = { type: "string", description: "Markdown-Dokument als Download" } as const;

/** `content`-style response for routes that return JSON or a text download depending on `?format`. */
export function jsonOrText(jsonSchema: unknown, mediaType: string, textSchema: unknown, description: string) {
  return { description, content: { "application/json": { schema: jsonSchema }, [mediaType]: { schema: textSchema } } };
}

export const objectResponse = anyObject;
export const arrayResponse = anyArray;
