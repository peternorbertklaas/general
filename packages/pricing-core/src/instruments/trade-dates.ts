import { type SerialDate } from "../dates/date.js";
import { type FloatLeg, type Trade } from "./types.js";

/**
 * Final maturity of a trade, type-independent: last leg termination (swaps,
 * swaption underlying), FRA settlement (start), cap/floor termination, FX
 * delivery (far leg for FX swaps). Used for IFRS 13 extrapolation checks,
 * exposure grids and reporting.
 */
export function tradeMaturityDate(t: Trade): SerialDate {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return Math.max(...t.legs.map((l) => l.terminationDate));
    case "Swaption":
      return Math.max(...t.underlying.legs.map((l) => l.terminationDate));
    case "FRA":
      return t.startDate;
    case "CapFloor":
      return t.terminationDate;
    case "FxForward":
      return t.deliveryDate;
    case "FxSwap":
      return t.farLeg.deliveryDate;
    case "FxOption":
      return t.deliveryDate;
  }
}

/** Floating-rate indices a trade references (upper-cased index names, unique). */
export function tradeIndexNames(t: Trade): string[] {
  const set = new Set<string>();
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      for (const l of t.legs) if (l.type === "Float") set.add(l.index.toUpperCase());
      break;
    case "Swaption":
      for (const l of t.underlying.legs) if (l.type === "Float") set.add(l.index.toUpperCase());
      break;
    case "FRA":
    case "CapFloor":
      set.add(t.index.toUpperCase());
      break;
    default:
      break;
  }
  return [...set];
}

/** Floating legs carrying an embedded cap and/or floor (swaps and cross-currency swaps). */
export function embeddedOptionLegs(t: Trade): FloatLeg[] {
  if (t.type !== "InterestRateSwap" && t.type !== "CrossCurrencySwap") return [];
  return t.legs.filter((l): l is FloatLeg => l.type === "Float" && (l.capRate !== undefined || l.floorRate !== undefined));
}

/**
 * True when the trade carries optionality that needs a vol surface: an
 * explicit option type or a swap leg with an embedded cap/floor (feature
 * detection instead of a trade-type check, review finding R2-2).
 */
export function hasOptionality(t: Trade): boolean {
  return t.type === "Swaption" || t.type === "CapFloor" || t.type === "FxOption" || embeddedOptionLegs(t).length > 0;
}
