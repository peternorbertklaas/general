import { type FixedLeg, type Swaption, makeVanillaSwap } from "@deriva/pricing-core";

/**
 * Swaption whose underlying swap projects `index` (R8-F1): the core builder
 * `makeSwaption` always takes the currency's conventional float index, so a DKK
 * swaption after "+ Kurve" DKK-DESTR would reference CIBOR-6M without a curve.
 * The underlying is rebuilt with `makeVanillaSwap({ index })` – the float leg's
 * frequency, day count and lags follow the chosen index – keeping id, dates,
 * notional, strike and direction. Without `index` the swaption is returned as is.
 */
export function swaptionWithUnderlyingIndex<T extends Swaption>(swaption: T, index: string | undefined): T {
  if (!index) return swaption;
  const fixed = swaption.underlying.legs.find((l): l is FixedLeg => l.type === "Fixed");
  if (!fixed) return swaption;
  const current = swaption.underlying.legs.find((l) => l.type === "Float");
  if (current && "index" in current && current.index === index) return swaption;
  const rebuilt = makeVanillaSwap({
    id: swaption.underlying.id,
    currency: fixed.currency,
    notional: fixed.notional,
    payReceiveFixed: fixed.payReceive,
    fixedRate: fixed.rate,
    effectiveDate: fixed.effectiveDate,
    maturity: fixed.terminationDate,
    index,
  });
  return { ...swaption, underlying: { ...swaption.underlying, legs: rebuilt.legs } };
}

/** Float index of a swaption's underlying swap (`undefined` for a fixed/fixed underlying). */
export function swaptionUnderlyingIndex(swaption: Swaption): string | undefined {
  const leg = swaption.underlying.legs.find((l) => l.type === "Float");
  return leg && "index" in leg ? (leg as { index: string }).index : undefined;
}
