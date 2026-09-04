/**
 * Domain error codes of the pricing core. The API maps a `PricingError` to its
 * error envelope `{ error, code, statusCode, requestId, details? }` – 422 for
 * domain errors raised while pricing, 400 for client-input codes
 * (`INVALID_DATE`, `INVALID_TENOR`, `INVALID_TIMESTAMP` and `INVALID_VOL_SURFACE` on
 * import, `TOO_MANY_PERIODS`).
 * Programming errors (TypeError, RangeError) are deliberately not wrapped so
 * they are reported as an invalid request without leaking internals. Every
 * error the core raises on purpose is a `PricingError` (no plain `Error`
 * outside tests since round 5, N5-07), so the API's generic domain-error
 * fallback is unreachable from the core.
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
  /**
   * A custom calendar definition is unusable (missing id, built-in id, holiday
   * that is not an ISO date) – raised by `registerCalendar` for JSON
   * definitions (`validateCustomCalendar` lists the problems, R8).
   */
  | "INVALID_CALENDAR"
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
  | "INVALID_TIMESTAMP"
  /** A date string is not `YYYY-MM-DD` or names a day that does not exist (`2027-02-30`); raised by `parseISO` (N4-03). */
  | "INVALID_DATE"
  /** A tenor string is not `<n><D|W|M|Y>` (or ON/TN/SN); raised by `parseTenor` (N4-03). */
  | "INVALID_TENOR"
  /**
   * A volatility surface is structurally unusable (grid dimensions do not match
   * the axes, non-finite / negative vols, unsorted or duplicate expiries,
   * unknown `volType`) – raised by `deserializeMarket` on import (with
   * `details.key` and `details.problems` from `validateVolSurfaces`) and by the
   * surface lookups at pricing time instead of a `TypeError` (Markt R5-1).
   */
  | "INVALID_VOL_SURFACE"
  /**
   * A curve build specification is unusable (malformed FX pair in an
   * `FxSwapPoints` quote, missing reference curve, circular dependency, curve
   * without nodes); raised by the bootstrapper / `InterpolatedCurve` (N5-07).
   */
  | "INVALID_CURVE_SPEC"
  /**
   * A numerical routine did not converge or could not bracket its root
   * (`brent`, `solveBracketed`, implied vol below intrinsic); raised instead of
   * a plain `Error` so the API can classify it (N5-07).
   */
  | "NUMERICAL_FAILURE"
  /**
   * A hedge relationship is structurally inconsistent (FX pair without the
   * hedged currency, non-positive hedge ratio, amortisation without schedule /
   * loan rate, hedged cash flow in the past); raised by the hedge module (N5-07).
   */
  | "INVALID_HEDGE_RELATIONSHIP"
  /**
   * A market snapshot is structurally unusable (unsupported `schema`, malformed
   * `fxFixings` entry); raised by `deserializeMarket` (N5-07).
   */
  | "INVALID_SNAPSHOT";

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
