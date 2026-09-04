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
  | "UNSUPPORTED_TRADE_TYPE"
  /** Frequency string that is not a positive tenor ("7Q", "0M"); raised by the schedule builder (R3-4). */
  | "INVALID_FREQUENCY"
  /** Day-count string outside the supported conventions ("ACT/999"); raised by `normalizeDayCount` (R3-4). */
  | "UNKNOWN_DAYCOUNT"
  /** A leg schedule would exceed `MAX_PERIODS` periods (resource guard, N3-01). */
  | "TOO_MANY_PERIODS"
  /** Requested option model cannot be fed from the available vol surface (e.g. Black on a negative forward without shift, R3-1). */
  | "VOL_MODEL_INCOMPATIBLE"
  /** CDS quotes imply a negative hazard rate or are otherwise unusable for the hazard bootstrap (R3-3). */
  | "INVALID_CREDIT_CURVE"
  /** A timestamp string (e.g. `meta.snapshotTime`) is not ISO-8601 (N3-03). */
  | "INVALID_TIMESTAMP";

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
