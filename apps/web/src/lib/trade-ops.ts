import { type PricingResult, type Trade } from "@deriva/pricing-core";

/** Flip direction of a trade (pay↔receive / long↔short / buy↔sell). */
export function flipTrade(t: Trade): Trade {
  const flipPR = (p: "Pay" | "Receive") => (p === "Pay" ? "Receive" : "Pay");
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return { ...t, legs: t.legs.map((l) => ({ ...l, payReceive: flipPR(l.payReceive) })) };
    case "FRA":
    case "CapFloor":
    case "Swaption":
    case "FxOption":
      return { ...t, payReceive: flipPR(t.payReceive) };
    case "FxForward":
      return { ...t, buyCurrency: t.sellCurrency, buyAmount: t.sellAmount, sellCurrency: t.buyCurrency, sellAmount: t.buyAmount };
    case "FxSwap":
      return t;
  }
}

/** Set the fixed rate / strike / contract rate to the fair (par) level from the latest pricing. */
export function applyParSolve(t: Trade, r: PricingResult | undefined): Trade | undefined {
  if (!r) return undefined;
  switch (t.type) {
    case "InterestRateSwap": {
      const par = r.analytics.parRate as number | undefined;
      if (par === undefined) return undefined;
      return { ...t, legs: t.legs.map((l) => (l.type === "Fixed" ? { ...l, rate: par } : l)) };
    }
    case "Swaption": {
      const fwd = r.analytics.forwardSwapRate as number | undefined;
      if (fwd === undefined) return undefined;
      return { ...t, underlying: { ...t.underlying, legs: t.underlying.legs.map((l) => (l.type === "Fixed" ? { ...l, rate: fwd } : l)) } };
    }
    case "FxForward": {
      const fair = r.analytics.fairForward as number | undefined;
      if (fair === undefined) return undefined;
      return { ...t, sellAmount: t.buyAmount * fair };
    }
    case "FxOption": {
      const fwd = r.analytics.forward as number | undefined;
      if (fwd === undefined) return undefined;
      return { ...t, strike: Math.round(fwd * 10000) / 10000 };
    }
    case "FRA": {
      const fwd = r.analytics.forwardRate as number | undefined;
      return fwd === undefined ? undefined : { ...t, fixedRate: fwd };
    }
    default:
      return undefined;
  }
}

export function tradeTypeBadge(type: Trade["type"]): { label: string; cls: string } {
  switch (type) {
    case "InterestRateSwap":
      return { label: "IRS", cls: "irs" };
    case "CrossCurrencySwap":
      return { label: "CCS", cls: "irs" };
    case "FRA":
      return { label: "FRA", cls: "irs" };
    case "CapFloor":
      return { label: "CAP", cls: "opt" };
    case "Swaption":
      return { label: "SWPT", cls: "opt" };
    case "FxForward":
      return { label: "FXF", cls: "fx" };
    case "FxSwap":
      return { label: "FXS", cls: "fx" };
    case "FxOption":
      return { label: "FXO", cls: "fx" };
  }
}

export function tradeNotional(t: Trade): { amount: number; currency: string } {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return { amount: t.legs[0]!.notional, currency: t.legs[0]!.currency };
    case "Swaption":
      return { amount: t.underlying.legs[0]!.notional, currency: t.underlying.legs[0]!.currency };
    case "FRA":
    case "CapFloor":
      return { amount: t.notional, currency: t.currency };
    case "FxOption":
      return { amount: t.notional, currency: t.pair.slice(0, 3) };
    case "FxForward":
      return { amount: t.buyAmount, currency: t.buyCurrency };
    case "FxSwap":
      return { amount: t.nearLeg.buyAmount, currency: t.nearLeg.buyCurrency };
  }
}

export function tradeMaturity(t: Trade): number {
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return Math.max(...t.legs.map((l) => l.terminationDate));
    case "Swaption":
      return t.expiryDate;
    case "FRA":
      return t.endDate;
    case "CapFloor":
      return t.terminationDate;
    case "FxOption":
      return t.expiryDate;
    case "FxForward":
      return t.deliveryDate;
    case "FxSwap":
      return t.farLeg.deliveryDate;
  }
}
