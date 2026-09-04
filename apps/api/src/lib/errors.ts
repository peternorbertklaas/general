/**
 * Error classification for the API boundary (review finding N-06).
 *
 * - Validation errors (Ajv)            → 400 with `validation[]`
 * - Errors carrying a `statusCode`     → that status (404/409/412/413/429 …)
 * - TypeError/RangeError/… from a pricer → 400 "Invalid trade" (logged as warn,
 *   internals never leave the process)
 * - Domain errors of the pricing core  → 422 `{ error, code }`. Detected by
 *   duck-typing (`name === "PricingError"` or a non-system `code` string) so
 *   the API does not depend on the core's class identity across builds; a
 *   plain `Error` (exact prototype, not a subclass) is treated as a domain
 *   error with `code: "DOMAIN_ERROR"` until every core throw site uses
 *   `PricingError`.
 * - Everything else                    → 500 generic.
 */
import { isPricingError } from "@deriva/pricing-core";

export interface ClassifiedError {
  status: number;
  message: string;
  code?: string;
  /** Structured context of a `PricingError` (trade id, curve id, …). */
  details?: Record<string, unknown>;
  validation?: unknown[];
  level: "none" | "warn" | "error";
}

const SYSTEM_CODE = /^(FST_|ERR_|E[A-Z0-9]+$)/;

export function isProgrammingError(e: unknown): boolean {
  return e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError;
}

export function isDomainError(e: unknown): e is Error & { code?: string } {
  if (!(e instanceof Error) || isProgrammingError(e)) return false;
  const { name, code, statusCode } = e as { name?: string; code?: unknown; statusCode?: unknown };
  if (statusCode !== undefined) return false;
  if (name === "PricingError") return true;
  // System/library errors (Node ECONNRESET/ERR_*, Fastify FST_*) are never domain errors, even when thrown as plain Error.
  if (typeof code === "string") return !SYSTEM_CODE.test(code);
  return Object.getPrototypeOf(e) === Error.prototype;
}

export function classifyError(err: unknown): ClassifiedError {
  const e = err as { statusCode?: unknown; message?: unknown; validation?: unknown[]; code?: unknown };
  if (Array.isArray(e.validation)) {
    return { status: 400, message: typeof e.message === "string" ? e.message : "Validation failed", validation: e.validation, level: "none" };
  }
  if (typeof e.statusCode === "number" && e.statusCode >= 400) {
    const status = e.statusCode;
    // Application errors thrown with a status keep their domain `code`/`details` (TOO_MANY_PERIODS, PERIOD_BUDGET_EXCEEDED …);
    // library codes (FST_*, ERR_*) stay internal.
    const code = typeof e.code === "string" && !SYSTEM_CODE.test(e.code) ? e.code : undefined;
    const details = (e as { details?: unknown }).details;
    return {
      status,
      message: status >= 500 ? "Internal server error" : String(e.message ?? "Request failed"),
      ...(code && status < 500 ? { code } : {}),
      ...(code && status < 500 && details && typeof details === "object" ? { details: details as Record<string, unknown> } : {}),
      level: status >= 500 ? "error" : "none",
    };
  }
  if (isProgrammingError(err)) return { status: 400, message: "Invalid trade", code: "INVALID_TRADE", level: "warn" };
  if (isPricingError(err)) return { status: 422, message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}), level: "none" };
  if (isDomainError(err)) return { status: 422, message: err.message, code: typeof err.code === "string" ? err.code : "DOMAIN_ERROR", level: "none" };
  return { status: 500, message: "Internal server error", level: "error" };
}

/** Per-item error description for batch results (import, list pricing) – never leaks internals. */
export function describeError(err: unknown): { message: string; code: string } {
  const c = classifyError(err);
  if (c.status === 422) return { message: c.message, code: c.code ?? "DOMAIN_ERROR" };
  if (c.status === 400) return { message: "Invalid trade", code: "INVALID_TRADE" };
  return { message: "Pricing failed", code: "INTERNAL_ERROR" };
}
