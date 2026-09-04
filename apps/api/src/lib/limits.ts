/**
 * Compute bounds per request (review finding N3-01).
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
 *   risk) exceed `maxWeightedPeriodsPerRequest`
 *   → 413 `PERIOD_BUDGET_EXCEEDED` (split the request).
 *
 * The estimate is `ceil(years × periods per year)` per leg and is computed on
 * the validated body *before* any pricing – a 1D × 100Y trade is rejected in
 * well under 50 ms. Routes that fan out one valuation into many (scenarios,
 * grids) declare a `computeWeight` in their route config; routes that fall
 * back to the trade store declare `storeFallback` so the stored book counts
 * against the budget as well. A hard wall-clock timeout is deliberately not
 * implemented: the pricing core is synchronous and cannot be aborted mid-way,
 * so the budget is enforced on the input size instead (ADR-026).
 */
import { type FastifyInstance, type FastifyRequest } from "fastify";
import { MAX_PERIODS, type Trade, frequencyPerYear, parseISO } from "@deriva/pricing-core";
import { type AppContext } from "../app.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Number of valuations per trade this route performs (scenarios, grid cells); default 1. */
    computeWeight?: (body: unknown) => number;
    /** The route prices the trade store when the body carries no `trades`. */
    storeFallback?: boolean;
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
}

const envInt = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
};

/** Defaults; overridable per process via `MAX_PERIODS_PER_LEG` / `MAX_PERIODS_PER_REQUEST` / `MAX_WEIGHTED_PERIODS_PER_REQUEST` or `buildApp({ limits })`. */
export function defaultLimits(): ComputeLimits {
  return {
    maxPeriodsPerLeg: envInt("MAX_PERIODS_PER_LEG", MAX_PERIODS),
    maxPeriodsPerRequest: envInt("MAX_PERIODS_PER_REQUEST", 20_000),
    maxWeightedPeriodsPerRequest: envInt("MAX_WEIGHTED_PERIODS_PER_REQUEST", 500_000),
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

type AnyTrade = Partial<Trade> & { type?: string; legs?: unknown[]; underlying?: unknown };

/** Periods per leg of a trade (single-entry array for one-period instruments). */
export function tradeLegPeriods(trade: unknown): number[] {
  const t = trade as AnyTrade;
  if (!t || typeof t !== "object") return [];
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return Array.isArray(t.legs) ? t.legs.map((l) => estimateLegPeriods(l as never)) : [];
    case "CapFloor":
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

function httpError(status: number, code: string, message: string, details: Record<string, unknown>) {
  return Object.assign(new Error(message), { statusCode: status, code, details });
}

/** Throw 400 `TOO_MANY_PERIODS` when any leg of the trade exceeds the per-leg bound; returns the trade's total periods. */
export function assertTradeWithinLimits(trade: unknown, limits: ComputeLimits): number {
  const legs = tradeLegPeriods(trade);
  const id = (trade as { id?: unknown })?.id;
  legs.forEach((periods, legIndex) => {
    if (periods > limits.maxPeriodsPerLeg) {
      throw httpError(
        400,
        "TOO_MANY_PERIODS",
        `Trade ${String(id ?? "")} leg ${legIndex}: ~${periods} coupon periods exceed the limit of ${limits.maxPeriodsPerLeg} (use a coarser frequency or a shorter tenor)`,
        { tradeId: id, legIndex, periods, maxPeriodsPerLeg: limits.maxPeriodsPerLeg },
      );
    }
  });
  return sum(legs);
}

/** Throw 413 `PERIOD_BUDGET_EXCEEDED` when the trades' periods, or `periods × weight`, exceed the request budgets. */
export function assertBudget(periods: number, weight: number, trades: number, limits: ComputeLimits): void {
  const w = Math.max(1, weight);
  const cost = periods * w;
  if (periods > limits.maxPeriodsPerRequest || cost > limits.maxWeightedPeriodsPerRequest) {
    throw httpError(
      413,
      "PERIOD_BUDGET_EXCEEDED",
      `Request would price ~${periods} coupon periods over ${trades} trades in ${w} valuation(s) each (${cost} period valuations); the budget is ${limits.maxPeriodsPerRequest} periods and ${limits.maxWeightedPeriodsPerRequest} period valuations per request – split the request`,
      {
        trades,
        periods,
        weight: w,
        cost,
        maxPeriodsPerRequest: limits.maxPeriodsPerRequest,
        maxWeightedPeriodsPerRequest: limits.maxWeightedPeriodsPerRequest,
      },
    );
  }
}

const TRADE_TYPES = new Set(["InterestRateSwap", "FRA", "CapFloor", "Swaption", "FxForward", "FxSwap", "FxOption", "CrossCurrencySwap"]);

/** Trades a request is about to price: `body.trade`, `body.trades`, the body itself (trade routes) or the store (fallback routes). */
function tradesOf(req: FastifyRequest, ctx: AppContext): { fromBody: unknown[]; fromStore: unknown[] } {
  const body = req.body as { trade?: unknown; trades?: unknown; type?: unknown; id?: unknown } | undefined;
  if (!body || typeof body !== "object") return { fromBody: [], fromStore: [] };
  if (body.trade) return { fromBody: [body.trade], fromStore: [] };
  if (Array.isArray(body.trades)) return { fromBody: body.trades, fromStore: [] };
  if (typeof body.type === "string" && TRADE_TYPES.has(body.type) && body.id !== undefined) return { fromBody: [body], fromStore: [] };
  if (req.routeOptions.config.storeFallback) return { fromBody: [], fromStore: ctx.trades.list().map((s) => s.trade) };
  return { fromBody: [], fromStore: [] };
}

/**
 * `preHandler` hook: runs after schema validation and before the route
 * handler, so the estimate works on well-formed trades and no pricing has
 * started when a request is rejected. Store trades were bounded per leg when
 * they were written; they only count against the request budget here.
 */
export function registerComputeLimits(app: FastifyInstance, ctx: AppContext, limits: ComputeLimits): void {
  app.addHook("preHandler", async (req) => {
    const { fromBody, fromStore } = tradesOf(req, ctx);
    if (fromBody.length === 0 && fromStore.length === 0) return;
    let periods = 0;
    for (const t of fromBody) periods += assertTradeWithinLimits(t, limits);
    for (const t of fromStore) periods += sum(tradeLegPeriods(t));
    const weight = req.routeOptions.config.computeWeight?.(req.body) ?? 1;
    assertBudget(periods, weight, fromBody.length + fromStore.length, limits);
  });
}
