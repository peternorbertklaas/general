/**
 * Error classification for the API boundary (review findings N-06, N4-03, N4-05).
 *
 * - Validation errors (Ajv)            → 400 `VALIDATION_ERROR` with `validation[]`
 * - Body parse errors of Fastify       → 400 `INVALID_JSON` (`FST_ERR_CTP_INVALID_JSON_BODY`,
 *   `FST_ERR_CTP_EMPTY_JSON_BODY`), 415 `UNSUPPORTED_MEDIA_TYPE`, 413 `PAYLOAD_TOO_LARGE`
 * - Errors carrying a `statusCode`     → that status (404/409/412/413/429 …);
 *   application codes (`NOT_FOUND`, `PERIOD_BUDGET_EXCEEDED`, …) and `details`
 *   are kept, library codes (`FST_*`, `ERR_*`) stay internal and are replaced by
 *   the catalogued code of the status (N5-01: every envelope carries a code)
 * - `PricingError` of the core         → 422 `{ error, code, details? }`.
 *   Detected by duck-typing (`name === "PricingError"` or a non-system `code`)
 *   so the API does not depend on the core's class identity across builds
 * - Date / tenor parse errors           → 400 `INVALID_DATE` / `INVALID_TENOR` with
 *   the core's `details` (`input`). The core raises
 *   `PricingError("INVALID_DATE" | "INVALID_TENOR")` from `parseISO` / `parseTenor`;
 *   a non-existent date such as `2027-02-30` is a client input error, not a
 *   pricing problem, so these two codes are the only `PricingError`s answered
 *   with 400 instead of 422. Plain `Error("Invalid date: …")` messages (older
 *   core builds) are mapped the same way
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
  /** Catalogued code (`API_ERROR_CODES`) – always present, so every envelope is machine-readable. */
  code: string;
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

/**
 * Catalogued code for a status-coded error that carries no application code of its own
 * (Fastify/plugin errors such as `FST_ERR_CTP_*`, `FST_ERR_RATE_LIMIT`, plain `{ statusCode }` throws).
 */
export function fallbackCodeFor(status: number, libraryCode?: string): string {
  if (libraryCode === "FST_ERR_CTP_INVALID_JSON_BODY" || libraryCode === "FST_ERR_CTP_EMPTY_JSON_BODY") return "INVALID_JSON";
  switch (status) {
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 412:
      return "PRECONDITION_FAILED";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 415:
      return "UNSUPPORTED_MEDIA_TYPE";
    case 428:
      return "PRECONDITION_REQUIRED";
    case 429:
      return "RATE_LIMITED";
    default:
      return "INVALID_REQUEST";
  }
}

export function classifyError(err: unknown): ClassifiedError {
  const e = err as { statusCode?: unknown; message?: unknown; validation?: unknown[]; code?: unknown };
  if (Array.isArray(e.validation)) {
    return {
      status: 400,
      message: typeof e.message === "string" ? e.message : "Validation failed",
      code: "VALIDATION_ERROR",
      validation: e.validation,
      level: "none",
    };
  }
  if (typeof e.statusCode === "number" && e.statusCode >= 400) {
    const status = e.statusCode;
    if (status >= 500) return { status, message: "Internal server error", code: "INTERNAL_ERROR", level: "error" };
    // Application errors thrown with a status keep their domain `code`/`details` (TOO_MANY_PERIODS, PERIOD_BUDGET_EXCEEDED …);
    // library codes (FST_*, ERR_*) stay internal and are mapped to the catalogued code of the status
    // (JSON parse errors → INVALID_JSON, body limit → PAYLOAD_TOO_LARGE, media type → UNSUPPORTED_MEDIA_TYPE, rate limit → RATE_LIMITED).
    const libraryCode = typeof e.code === "string" ? e.code : undefined;
    const own = libraryCode && !SYSTEM_CODE.test(libraryCode) ? libraryCode : undefined;
    const code = own ?? fallbackCodeFor(status, libraryCode);
    const details = (e as { details?: unknown }).details;
    const message = code === "INVALID_JSON" ? "Body is not valid JSON" : String(e.message ?? "Request failed");
    return {
      status,
      message,
      code,
      ...(own && details && typeof details === "object" ? { details: details as Record<string, unknown> } : {}),
      level: "none",
    };
  }
  if (isProgrammingError(err)) return { status: 400, message: "Invalid trade", code: "INVALID_TRADE", level: "warn" };
  if (isDateInputError(err)) {
    const code = isPricingError(err) ? err.code : DATE_ERROR.test(err.message) ? "INVALID_DATE" : "INVALID_TENOR";
    // `details.input` of the core's PricingError names the offending string – kept on the 400 path too (N5-01).
    const details = isPricingError(err) && err.details && typeof err.details === "object" ? { details: err.details as Record<string, unknown> } : {};
    return { status: 400, message: err.message, code, ...details, level: "none" };
  }
  if (isPricingError(err)) return { status: 422, message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}), level: "none" };
  if (isDomainError(err)) return { status: 422, message: err.message, code: typeof err.code === "string" ? err.code : "DOMAIN_ERROR", level: "none" };
  return { status: 500, message: "Internal server error", code: "INTERNAL_ERROR", level: "error" };
}

/** Per-item error description for batch results (import, list pricing) – never leaks internals. */
export function describeError(err: unknown): { message: string; code: string } {
  const c = classifyError(err);
  if (c.status === 422) return { message: c.message, code: c.code };
  if (c.status === 400) return { message: c.code === "INVALID_TRADE" ? "Invalid trade" : c.message, code: c.code };
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
