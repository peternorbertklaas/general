/**
 * Error classification for the API boundary (review findings N-06, N4-03, N4-05).
 *
 * - Validation errors (Ajv)            → 400 with `validation[]`
 * - Errors carrying a `statusCode`     → that status (404/409/412/413/429 …);
 *   application codes (`NOT_FOUND`, `PERIOD_BUDGET_EXCEEDED`, …) and `details`
 *   are kept, library codes (`FST_*`, `ERR_*`) stay internal
 * - `PricingError` of the core         → 422 `{ error, code, details? }`.
 *   Detected by duck-typing (`name === "PricingError"` or a non-system `code`)
 *   so the API does not depend on the core's class identity across builds
 * - Date / tenor parse errors           → 400 `INVALID_DATE` / `INVALID_TENOR`.
 *   The core raises `PricingError("INVALID_DATE" | "INVALID_TENOR")` from
 *   `parseISO` / `parseTenor`; a non-existent date such as `2027-02-30` is a
 *   client input error, not a pricing problem, so these two codes are the only
 *   `PricingError`s answered with 400 instead of 422. Plain
 *   `Error("Invalid date: …")` messages (older core builds) are mapped the same way
 * - TypeError/RangeError/… from a pricer → 400 "Invalid trade" (logged as warn,
 *   internals never leave the process)
 * - Any other plain `Error` (exact prototype, not a subclass) → 422
 *   `DOMAIN_ERROR` until every core throw site uses `PricingError`
 * - Everything else                    → 500 generic, `code: INTERNAL_ERROR`.
 *
 * Inline route errors (404 not found, 409 conflict, 400 id mismatch …) go through
 * `sendError` so that every envelope carries a catalogued `code`
 * (`API_ERROR_CODES` in schemas.ts, listed in the OpenAPI `ErrorResponse`).
 */
import { type FastifyReply } from "fastify";
import { isPricingError } from "@deriva/pricing-core";
import { type API_ERROR_CODES } from "../schemas.js";

export type ApiErrorCode = (typeof API_ERROR_CODES.core)[number] | (typeof API_ERROR_CODES.api)[number];

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
const DATE_ERROR = /^Invalid (ISO )?date\b/;
const TENOR_ERROR = /^Invalid tenor\b/;
/** Core codes that describe malformed client input rather than a pricing problem → 400. */
const CLIENT_INPUT_CODES = new Set(["INVALID_DATE", "INVALID_TENOR"]);

export function isProgrammingError(e: unknown): boolean {
  return e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError;
}

/** Error of the core's date/tenor parsers (`parseISO`, `parseTenor`) – a client input error, answered with 400. */
export function isDateInputError(e: unknown): e is Error {
  if (!(e instanceof Error) || isProgrammingError(e)) return false;
  if (isPricingError(e)) return CLIENT_INPUT_CODES.has(e.code);
  if ((e as { statusCode?: unknown }).statusCode !== undefined) return false;
  return DATE_ERROR.test(e.message) || TENOR_ERROR.test(e.message);
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
    // The rate-limit plugin throws a library-coded 429; the envelope still gets a catalogued code.
    const code = typeof e.code === "string" && !SYSTEM_CODE.test(e.code) ? e.code : status === 429 ? "RATE_LIMITED" : undefined;
    const details = (e as { details?: unknown }).details;
    if (status >= 500) return { status, message: "Internal server error", code: "INTERNAL_ERROR", level: "error" };
    return {
      status,
      message: String(e.message ?? "Request failed"),
      ...(code ? { code } : {}),
      ...(code && details && typeof details === "object" ? { details: details as Record<string, unknown> } : {}),
      level: "none",
    };
  }
  if (isProgrammingError(err)) return { status: 400, message: "Invalid trade", code: "INVALID_TRADE", level: "warn" };
  if (isDateInputError(err)) {
    const code = isPricingError(err) ? err.code : DATE_ERROR.test(err.message) ? "INVALID_DATE" : "INVALID_TENOR";
    return { status: 400, message: err.message, code, level: "none" };
  }
  if (isPricingError(err)) return { status: 422, message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}), level: "none" };
  if (isDomainError(err)) return { status: 422, message: err.message, code: typeof err.code === "string" ? err.code : "DOMAIN_ERROR", level: "none" };
  return { status: 500, message: "Internal server error", code: "INTERNAL_ERROR", level: "error" };
}

/** Per-item error description for batch results (import, list pricing) – never leaks internals. */
export function describeError(err: unknown): { message: string; code: string } {
  const c = classifyError(err);
  if (c.status === 422) return { message: c.message, code: c.code ?? "DOMAIN_ERROR" };
  if (c.status === 400) return { message: c.code === "INVALID_TRADE" ? "Invalid trade" : c.message, code: c.code ?? "INVALID_TRADE" };
  return { message: "Pricing failed", code: "INTERNAL_ERROR" };
}

/**
 * Row-level reason for a CSV import (`rejected[].reason`): builder and parser
 * messages are meant for the user (`not a number: "abc"`, `payReceive must be
 * Pay | Receive`), a programming error inside a builder is not.
 */
export function describeRowError(err: unknown): string {
  if (isProgrammingError(err)) return "Invalid row";
  if (err instanceof Error) return err.message;
  return "Invalid row";
}

/** Send the unified error envelope `{ error, statusCode, code, …extra, requestId }` with a catalogued code. */
export function sendError(
  reply: FastifyReply,
  req: { id: string },
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  return reply.status(status).send({ error: message, statusCode: status, code, ...extra, requestId: req.id });
}
