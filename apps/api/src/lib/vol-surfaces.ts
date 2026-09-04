/**
 * Structural validation of vol surfaces arriving through the API (`PUT /api/market`,
 * `PUT /api/market/snapshot`, `designationSnapshot` of the hedge routes) – Markt R5-1.
 *
 * The JSON schema pins types, non-empty axes and non-negative quotes; the core's
 * `validateVolSurfaces` (`market/vol-validation.ts`, also used by `validateMarket` /
 * `deserializeMarket` and by the pricing-time guards raising
 * `PricingError("INVALID_VOL_SURFACE")`) checks what the schema cannot express: grid
 * dimensions (rows = expiries, columns = tenors / strikes; FX vectors = expiries),
 * strictly increasing axes, finite numbers, `volType`/`shift`, SABR parameters and
 * the key ↔ `currency`/`pair` relation the pricers rely on. A malformed surface used
 * to be accepted and then surfaced as `TypeError` → 400 "Invalid trade" on the next
 * swaption valuation; the API now runs the same check *before* `deserializeMarket`
 * builds a context and answers 400 `VOL_SURFACE_INVALID` with one `problems[]`
 * entry per finding, leaving the market untouched.
 */
import { type VolSurfacesInput, validateVolSurfaces } from "@deriva/pricing-core";

export type VolSurfaceInputs = VolSurfacesInput;

/** Problems of the given vol surfaces (empty = structurally sound). Paths are `swaptionVols.USD.atm[3]`-style. */
export function volSurfaceProblems(vols: VolSurfaceInputs): string[] {
  return validateVolSurfaces({ swaptionVols: vols.swaptionVols, capletVols: vols.capletVols, fxVols: vols.fxVols });
}
