/**
 * Compute bounds per request and per store (review findings N3-01, N4-01).
 *
 * The schema limits count and size (`trades` ≤ 5000, body ≤ 5 MB) but not the
 * *work* a request implies: a swap with `frequency: "1D"` over 100 years has
 * 36 525 coupon periods per leg and every route prices synchronously in the
 * event loop. The pricers cost roughly linear in the number of periods, so the
 * API estimates the periods of every trade it is about to price and rejects
 *
 * - a single leg (or cap/floor schedule) above `maxPeriodsPerLeg`
 *   → 400 `TOO_MANY_PERIODS` (a client error: the trade itself is out of scope),
 * - a request whose trades sum to more than `maxPeriodsPerRequest` periods, or
 *   whose periods × valuations (route weight: scenarios, grid cells, bucketed
 *   risk, hedge regressions) exceed `maxWeightedPeriodsPerRequest`
 *   → 413 `PERIOD_BUDGET_EXCEEDED` (split the request),
 * - a write that would grow the trade store beyond `maxStorePeriods` estimated
 *   periods → 413 `STORE_BUDGET_EXCEEDED`. Routes that price the whole store
 *   (`GET /api/trades?price=1`, `/api/emir/valuations`, store fallbacks) count
 *   the store against the request budget, so the store cap keeps a book that
 *   grew over many imports priceable and bounds the memory the store holds.
 *
 * The estimate is `ceil(years × periods per year)` per leg and is computed on
 * the validated body *before* any pricing – a 1D × 100Y trade is rejected in
 * well under 50 ms. Routes that fan out one valuation into many (scenarios,
 * grids, hedge tests) declare a `computeWeight` in their route config; routes
 * that price the trade store declare `storeFallback` (a flag or a predicate on
 * the request); routes that write trades declare `storeWrite`. The trades a
 * request prices are read from `body.trade`, `body.trades`, a trade body,
 * `body.hedgingInstrument` (or the stored instrument named by
 * `body.relationship.hedgingInstrumentId`) plus the hedged item's own schedule
 * (`hedgedItem.effectiveDate` → `maturityDate` at the amortisation frequency –
 * the hypothetical derivative and the notional path are built from it, N5-04)
 * or the store. A hard wall-clock
 * timeout is deliberately not implemented: the pricing core is synchronous and
 * cannot be aborted mid-way, so the budget is enforced on the input size
 * instead (ADR-026).
 */
import { type FastifyInstance, type FastifyRequest } from "fastify";
import { MAX_PERIODS, type Trade, frequencyPerYear, parseISO } from "@deriva/pricing-core";
import { type AppContext } from "../app.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Number of valuations per trade this route performs (scenarios, grid cells); default 1. */
    computeWeight?: (body: unknown) => number;
    /** The route prices the trade store when the body carries no trades: `true`, or a predicate on the request (e.g. `?price=1`). */
    storeFallback?: boolean | ((req: FastifyRequest) => boolean);
    /** The route writes its body trades into the store – the cumulative store budget applies (413 `STORE_BUDGET_EXCEEDED`). */
    storeWrite?: boolean;
  }
}

export interface ComputeLimits {
  /**
   * Maximum estimated coupon periods of one leg / cap schedule (default: the
   * core's `MAX_PERIODS` = 1200 ≈ 100 years monthly, 23 years weekly). The core
   * enforces the same bound when it builds the schedule (`PricingError`
   * `TOO_MANY_PERIODS` → 422) as a backstop; the API check runs first and
   * answers 400 without pricing.
   */
  maxPeriodsPerLeg: number;
  /** Maximum estimated periods summed over the trades of one request (default 20 000). */
  maxPeriodsPerRequest: number;
  /**
   * Maximum periods × valuations per request (default 500 000 ≈ a few seconds of
   * synchronous pricing): scenarios, grid cells and bucketed risk multiply the
   * periods by their `computeWeight`.
   */
  maxWeightedPeriodsPerRequest: number;
  /**
   * Maximum estimated periods of all trades in the store (default 200 000 ≈
   * 10 × the request budget; a book of 5000 plain 10Y semi-annual swaps has
   * ≈ 200 000 periods). `POST /api/trades`, `PUT /api/trades/:id` and
   * `/import` are rejected with 413 `STORE_BUDGET_EXCEEDED` when the write
   * would exceed it.
   */
  maxStorePeriods: number;
}

const envInt = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
};

/**
 * Defaults; overridable per process via `MAX_PERIODS_PER_LEG` / `MAX_PERIODS_PER_REQUEST` /
 * `MAX_WEIGHTED_PERIODS_PER_REQUEST` / `MAX_STORE_PERIODS` or `buildApp({ limits })`.
 */
export function defaultLimits(): ComputeLimits {
  return {
    maxPeriodsPerLeg: envInt("MAX_PERIODS_PER_LEG", MAX_PERIODS),
    maxPeriodsPerRequest: envInt("MAX_PERIODS_PER_REQUEST", 20_000),
    maxWeightedPeriodsPerRequest: envInt("MAX_WEIGHTED_PERIODS_PER_REQUEST", 500_000),
    maxStorePeriods: envInt("MAX_STORE_PERIODS", 200_000),
  };
}

type DateLike = number | string | undefined;
const toSerial = (d: DateLike): number | undefined => {
  if (typeof d === "number") return d;
  if (typeof d !== "string") return undefined;
  try {
    return parseISO(d);
  } catch {
    return undefined;
  }
};

/** Estimated coupon periods of a schedule; 0 when the inputs are not usable (the core reports those as 422). */
export function estimateLegPeriods(leg: { effectiveDate?: DateLike; terminationDate?: DateLike; frequency?: string }): number {
  const start = toSerial(leg.effectiveDate);
  const end = toSerial(leg.terminationDate);
  if (start === undefined || end === undefined || !(end > start)) return 0;
  let perYear: number;
  try {
    perYear = typeof leg.frequency === "string" ? frequencyPerYear(leg.frequency) : 1;
  } catch {
    return 0;
  }
  if (!Number.isFinite(perYear) || perYear <= 0) return 0;
  // Rounded estimate (a leap day must not turn 20 semi-annual periods into 21); at least one period.
  return Math.max(1, Math.round(((end - start) / 365.25) * perYear));
}

type AnyTrade = { type?: Trade["type"] | "HedgedItem"; legs?: unknown[]; underlying?: unknown };

/**
 * Pseudo-trade for the hedged item of a hedge relationship: its schedule (loan start → maturity at the
 * amortisation frequency) drives the hypothetical derivative and the notional path the core builds, so
 * it is bounded like a leg. Without an explicit `amortisation.frequency` the core steps at the fixed-leg
 * frequency of the currency; `6M` is a conservative stand-in for the estimate.
 */
export interface HedgedItemEstimate {
  type: "HedgedItem";
  id: string;
  effectiveDate?: DateLike;
  terminationDate?: DateLike;
  frequency: string;
}
export function hedgedItemEstimate(relationship: unknown): HedgedItemEstimate | undefined {
  const rel = relationship as
    { id?: unknown; hedgedItem?: { effectiveDate?: DateLike; maturityDate?: DateLike; amortisation?: { frequency?: unknown } } } | undefined;
  const item = rel?.hedgedItem;
  if (!item || typeof item !== "object") return undefined;
  const frequency = typeof item.amortisation?.frequency === "string" ? item.amortisation.frequency : "6M";
  return {
    type: "HedgedItem",
    id: typeof rel?.id === "string" ? rel.id : "",
    effectiveDate: item.effectiveDate,
    terminationDate: item.maturityDate,
    frequency,
  };
}

/** Periods per leg of a trade (single-entry array for one-period instruments). */
export function tradeLegPeriods(trade: unknown): number[] {
  const t = trade as AnyTrade;
  if (!t || typeof t !== "object") return [];
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return Array.isArray(t.legs) ? t.legs.map((l) => estimateLegPeriods(l as never)) : [];
    case "CapFloor":
    case "HedgedItem":
      return [estimateLegPeriods(t as never)];
    case "Swaption":
      return tradeLegPeriods(t.underlying);
    case "FxSwap":
      return [1, 1];
    default:
      return [1];
  }
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
/** Estimated periods of a whole trade. */
export const tradePeriods = (trade: unknown): number => sum(tradeLegPeriods(trade));

function httpError(status: number, code: string, message: string, details: Record<string, unknown>) {
  return Object.assign(new Error(message), { statusCode: status, code, details });
}

/** Throw 400 `TOO_MANY_PERIODS` when any leg of the trade exceeds the per-leg bound; returns the trade's total periods. */
export function assertTradeWithinLimits(trade: unknown, limits: ComputeLimits): number {
  const legs = tradeLegPeriods(trade);
  const { id, type } = (trade as { id?: unknown; type?: unknown }) ?? {};
  legs.forEach((periods, legIndex) => {
    if (periods > limits.maxPeriodsPerLeg) {
      const subject =
        type === "HedgedItem"
          ? `Hedged item of relationship ${String(id ?? "")} (schedule at ${(trade as HedgedItemEstimate).frequency})`
          : `Trade ${String(id ?? "")} leg ${legIndex}`;
      throw httpError(
        400,
        "TOO_MANY_PERIODS",
        `${subject}: ~${periods} coupon periods exceed the limit of ${limits.maxPeriodsPerLeg} (use a coarser frequency or a shorter tenor)`,
        {
          ...(type === "HedgedItem" ? { relationshipId: id, hedgedItem: true } : { tradeId: id }),
          legIndex,
          periods,
          maxPeriodsPerLeg: limits.maxPeriodsPerLeg,
        },
      );
    }
  });
  return sum(legs);
}

/**
 * Throw 413 `PERIOD_BUDGET_EXCEEDED` when the trades' periods, or `periods × weight`, exceed the request budgets.
 * `source: "store"` marks a request that prices the trade store (the hint then points at the store, not the body).
 */
export function assertBudget(periods: number, weight: number, trades: number, limits: ComputeLimits, source: "body" | "store" = "body"): void {
  const w = Math.max(1, weight);
  const cost = periods * w;
  if (periods > limits.maxPeriodsPerRequest || cost > limits.maxWeightedPeriodsPerRequest) {
    const hint =
      source === "store"
        ? "the trade store is too large for one valuation run – price a subset via `POST /api/price/portfolio` with `trades`, delete trades, or raise MAX_PERIODS_PER_REQUEST"
        : "split the request";
    throw httpError(
      413,
      "PERIOD_BUDGET_EXCEEDED",
      `Request would price ~${periods} coupon periods over ${trades} trades in ${w} valuation(s) each (${cost} period valuations); the budget is ${limits.maxPeriodsPerRequest} periods and ${limits.maxWeightedPeriodsPerRequest} period valuations per request – ${hint}`,
      {
        trades,
        periods,
        weight: w,
        cost,
        source,
        maxPeriodsPerRequest: limits.maxPeriodsPerRequest,
        maxWeightedPeriodsPerRequest: limits.maxWeightedPeriodsPerRequest,
      },
    );
  }
}

/** Estimated periods of every trade currently in the store. */
export function storePeriods(ctx: AppContext): number {
  return sum(ctx.trades.list().map((s) => tradePeriods(s.trade)));
}

/**
 * Throw 413 `STORE_BUDGET_EXCEEDED` when writing `incoming` would push the store above `maxStorePeriods`.
 * Trades replacing a stored id are netted against the stored version; an import in `create` mode that skips
 * existing ids is therefore bounded conservatively (the check assumes every row is written).
 */
export function assertStoreBudget(ctx: AppContext, incoming: unknown[], limits: ComputeLimits): void {
  const stored = new Map(ctx.trades.list().map((s) => [s.trade.id, tradePeriods(s.trade)] as const));
  const before = sum([...stored.values()]);
  let after = before;
  const replaced = new Set<string>();
  for (const t of incoming) {
    const id = (t as { id?: unknown })?.id;
    if (typeof id === "string" && !replaced.has(id) && stored.has(id)) {
      after -= stored.get(id)!;
      replaced.add(id);
    }
    after += tradePeriods(t);
  }
  if (after > limits.maxStorePeriods) {
    throw httpError(
      413,
      "STORE_BUDGET_EXCEEDED",
      `The trade store would hold ~${after} estimated coupon periods after this write (${incoming.length} trade(s), currently ${before}); the store budget is ${limits.maxStorePeriods} periods (MAX_STORE_PERIODS) – delete trades or split the book across instances`,
      { trades: incoming.length, storePeriods: before, storePeriodsAfter: after, maxStorePeriods: limits.maxStorePeriods },
    );
  }
}

const TRADE_TYPES = new Set(["InterestRateSwap", "FRA", "CapFloor", "Swaption", "FxForward", "FxSwap", "FxOption", "CrossCurrencySwap"]);

/**
 * Trades a request is about to price: `body.trade`, `body.trades`, the body itself (trade routes),
 * `body.hedgingInstrument` / the stored instrument of `body.relationship` plus the hedged item's schedule
 * (hedge routes) or the store (fallback routes).
 */
function tradesOf(req: FastifyRequest, ctx: AppContext): { fromBody: unknown[]; fromStore: unknown[]; hedgedItems: HedgedItemEstimate[] } {
  const body = req.body as
    | { trade?: unknown; trades?: unknown; type?: unknown; id?: unknown; hedgingInstrument?: unknown; relationship?: { hedgingInstrumentId?: unknown } }
    | undefined;
  const none: HedgedItemEstimate[] = [];
  if (body && typeof body === "object") {
    if (body.trade) return { fromBody: [body.trade], fromStore: [], hedgedItems: none };
    if (Array.isArray(body.trades)) return { fromBody: body.trades, fromStore: [], hedgedItems: none };
    if (typeof body.type === "string" && TRADE_TYPES.has(body.type) && body.id !== undefined) return { fromBody: [body], fromStore: [], hedgedItems: none };
    if (body.hedgingInstrument || (body.relationship && typeof body.relationship === "object")) {
      const hedgedItem = hedgedItemEstimate(body.relationship);
      const id = body.relationship?.hedgingInstrumentId;
      const stored = !body.hedgingInstrument && typeof id === "string" ? ctx.trades.get(id)?.trade : undefined;
      return {
        fromBody: body.hedgingInstrument ? [body.hedgingInstrument] : [],
        fromStore: stored ? [stored] : [],
        hedgedItems: hedgedItem ? [hedgedItem] : [],
      };
    }
  }
  const fallback = req.routeOptions.config.storeFallback;
  if (fallback === true || (typeof fallback === "function" && fallback(req)))
    return { fromBody: [], fromStore: ctx.trades.list().map((s) => s.trade), hedgedItems: none };
  return { fromBody: [], fromStore: [], hedgedItems: none };
}

/**
 * `preHandler` hook: runs after schema validation and before the route
 * handler, so the estimate works on well-formed trades and no pricing has
 * started when a request is rejected. Store trades were bounded per leg when
 * they were written; they only count against the request budget here.
 */
export function registerComputeLimits(app: FastifyInstance, ctx: AppContext, limits: ComputeLimits): void {
  app.addHook("preHandler", async (req) => {
    const { fromBody, fromStore, hedgedItems } = tradesOf(req, ctx);
    if (fromBody.length === 0 && fromStore.length === 0 && hedgedItems.length === 0) return;
    let periods = 0;
    for (const t of fromBody) periods += assertTradeWithinLimits(t, limits);
    // The hedged item's schedule is bounded like a leg (400 TOO_MANY_PERIODS) and adds to the request's periods,
    // but is not a trade of the request (`details.trades` and `source` describe the instruments).
    for (const h of hedgedItems) periods += assertTradeWithinLimits(h, limits);
    for (const t of fromStore) periods += tradePeriods(t);
    const weight = req.routeOptions.config.computeWeight?.(req.body) ?? 1;
    assertBudget(periods, weight, fromBody.length + fromStore.length, limits, fromBody.length === 0 ? "store" : "body");
    if (req.routeOptions.config.storeWrite) assertStoreBudget(ctx, fromBody, limits);
  });
}
