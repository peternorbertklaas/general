/**
 * Domain error codes of the pricing core. API layers map `PricingError` to a
 * 4xx response with `{ code, message }`; programming errors (TypeError,
 * RangeError) are deliberately not wrapped so they surface as 500s.
 */
export type PricingErrorCode =
  | "INVALID_TRADE"
  | "NON_FINITE_PV"
  | "MISSING_RATE"
  | "MISSING_FIXING"
  | "NO_DISCOUNT_CURVE"
  | "CURVE_NOT_FOUND"
  | "NO_FX_SPOT"
  | "UNKNOWN_INDEX"
  | "UNKNOWN_CALENDAR"
  | "UNSUPPORTED_TRADE_TYPE";

/** Domain error of the pricing core with a stable machine-readable `code`. */
export class PricingError extends Error {
  readonly code: PricingErrorCode;
  /** Optional structured context (trade id, curve id, …) for logging. */
  readonly details?: Record<string, unknown>;
  constructor(code: PricingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PricingError";
    this.code = code;
    this.details = details;
  }
}

export function isPricingError(e: unknown): e is PricingError {
  return (
    e instanceof PricingError ||
    (typeof e === "object" && e !== null && (e as { name?: string }).name === "PricingError" && typeof (e as { code?: unknown }).code === "string")
  );
}
