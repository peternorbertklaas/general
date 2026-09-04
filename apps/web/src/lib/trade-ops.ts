import { type PricingResult, type Trade } from "@deriva/pricing-core";
import { fmtBp, fmtNum, fmtPct } from "./format.js";

/** Whether a swap has no fixed leg (tenor basis swap). */
export function isBasisSwap(t: Trade): boolean {
  return (t.type === "InterestRateSwap" || t.type === "CrossCurrencySwap") && !t.legs.some((l) => l.type === "Fixed");
}

/** Label of the instrument's headline quote (par rate, forward, premium ...). */
export function keyMetricLabel(t: Trade): string {
  switch (t.type) {
    case "CrossCurrencySwap":
      return isBasisSwap(t) ? "Fairer Basis-Spread" : "Par-Satz";
    case "InterestRateSwap":
      return isBasisSwap(t) ? "Fairer Spread" : "Par-Satz";
    case "Swaption":
      return "Forward-Swapsatz";
    case "CapFloor":
      return "Prämie % Nominal";
    case "FxForward":
      return "Fairer Forward";
    case "FxSwap":
      return "Swap-Punkte";
    case "FxOption":
      return "Prämie % Basis";
    case "FRA":
      return "Forward-Satz";
  }
}

/** Formatted headline quote from the pricing analytics (all de-DE). */
export function keyMetric(t: Trade, a?: Record<string, number | string | undefined>): string {
  if (!a) return "–";
  const num = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : undefined);
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return isBasisSwap(t) ? fmtBp(num("fairSpread"), 1) : fmtPct(num("parRate"), 4);
    case "Swaption":
      return fmtPct(num("forwardSwapRate"), 4);
    case "CapFloor":
      return num("premiumPct") === undefined ? "–" : `${fmtNum(num("premiumPct"), 3)} %`;
    case "FxForward":
      return fmtNum(num("fairForward"), 5);
    case "FxSwap":
      return fmtNum(num("swapPoints"), 1);
    case "FxOption":
      return num("premiumPctBase") === undefined ? "–" : `${fmtNum(num("premiumPctBase"), 3)} %`;
    case "FRA":
      return fmtPct(num("forwardRate"), 4);
  }
}

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
    case "FxSwap": {
      const flipLeg = (l: typeof t.nearLeg) => ({
        ...l,
        buyCurrency: l.sellCurrency,
        buyAmount: l.sellAmount,
        sellCurrency: l.buyCurrency,
        sellAmount: l.buyAmount,
      });
      return { ...t, nearLeg: flipLeg(t.nearLeg), farLeg: flipLeg(t.farLeg) };
    }
  }
}

/**
 * Coupon / spread of the first outstanding period of a leg (the `r_0` of the
 * core's par solver): the rate of the first interest cashflow whose accrual end
 * lies after the valuation date, from the pricing result.
 */
function firstOutstandingRate(r: PricingResult, legIndex: number): number | undefined {
  const leg = r.legs.find((l) => l.legIndex === legIndex);
  const cf = leg?.cashflows.find((c) => c.kind === "Interest" && (c.accrualEnd ?? c.paymentDate) > r.valuationDate && c.rate !== undefined);
  return cf?.rate;
}

/** Accrual start of the first outstanding interest period of a leg. */
function firstOutstandingStart(r: PricingResult, legIndex: number): number | undefined {
  const leg = r.legs.find((l) => l.legIndex === legIndex);
  const cf = leg?.cashflows.find((c) => c.kind === "Interest" && (c.accrualEnd ?? c.paymentDate) > r.valuationDate);
  return cf?.accrualStart;
}

/** Schedule value in force at `date` (last entry dated on/before it), `base` before the first entry. */
export function scheduleValueAt<K extends string>(schedule: ({ date: number } & Record<K, number>)[] | undefined, key: K, date: number, base: number): number {
  let v = base;
  for (const e of schedule ?? []) if (e.date <= date) v = e[key];
  return v;
}

/**
 * Apply a coupon schedule shift: the base rate and every schedule entry move
 * by the same amount so the step differences stay constant (core semantics of
 * `parRateBase` / `fairSpread` with schedules).
 */
function shiftSchedule<T extends { date: number }>(schedule: T[] | undefined, key: "rate" | "spread", shift: number): T[] | undefined {
  return schedule?.map((e) => ({ ...e, [key]: (e as unknown as Record<string, number>)[key]! + shift }));
}

/** Set the fixed rate / strike / contract rate / spread to the fair (par) level from the latest pricing. */
export function applyParSolve(t: Trade, r: PricingResult | undefined): Trade | undefined {
  if (!r) return undefined;
  switch (t.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap": {
      if (isBasisSwap(t)) {
        const fair = r.analytics.fairSpread as number | undefined;
        if (fair === undefined) return undefined;
        let done = false;
        return {
          ...t,
          legs: t.legs.map((l, i) => {
            if (done || l.type !== "Float") return l;
            done = true;
            if (l.spreadSchedule && l.spreadSchedule.length > 0) {
              // fairSpread is the spread of the first outstanding period with the schedule steps kept constant.
              const start = firstOutstandingStart(r, i) ?? l.effectiveDate;
              const shift = fair - scheduleValueAt(l.spreadSchedule, "spread", start, l.spread ?? 0);
              return { ...l, spread: (l.spread ?? 0) + shift, spreadSchedule: shiftSchedule(l.spreadSchedule, "spread", shift) };
            }
            return { ...l, spread: fair };
          }),
        } as Trade;
      }
      const hasSchedule = t.legs.some((l) => l.type === "Fixed" && (l.rateSchedule?.length ?? 0) > 0);
      const par = (hasSchedule ? (r.analytics.parRateBase as number | undefined) : undefined) ?? (r.analytics.parRate as number | undefined);
      if (par === undefined) return undefined;
      return {
        ...t,
        legs: t.legs.map((l, i) => {
          if (l.type !== "Fixed") return l;
          if (!l.rateSchedule || l.rateSchedule.length === 0) return { ...l, rate: par };
          // Step-up: move the whole staircase so the first outstanding coupon equals parRateBase.
          const r0 = firstOutstandingRate(r, i) ?? l.rate;
          const shift = par - r0;
          return { ...l, rate: l.rate + shift, rateSchedule: shiftSchedule(l.rateSchedule, "rate", shift) };
        }),
      } as Trade;
    }
    case "Swaption": {
      const fwd = r.analytics.forwardSwapRate as number | undefined;
      if (fwd === undefined) return undefined;
      return { ...t, underlying: { ...t.underlying, legs: t.underlying.legs.map((l) => (l.type === "Fixed" ? { ...l, rate: fwd } : l)) } };
    }
    case "CapFloor": {
      // "Par" for a cap/floor: strike at the forward rate (ATM).
      const fwd = (r.analytics.forwardRate ?? r.analytics.atmRate ?? r.analytics.forward) as number | undefined;
      if (fwd === undefined) return undefined;
      return { ...t, strike: Math.round(fwd * 1e6) / 1e6 };
    }
    case "FxForward": {
      const fair = r.analytics.fairForward as number | undefined;
      if (fair === undefined) return undefined;
      return { ...t, sellAmount: t.buyAmount * fair };
    }
    case "FxSwap": {
      const near = r.analytics.nearFairForward as number | undefined;
      const far = r.analytics.farFairForward as number | undefined;
      if (near === undefined || far === undefined) return undefined;
      const setRate = (l: typeof t.nearLeg, rate: number) =>
        l.buyCurrency === t.nearLeg.buyCurrency ? { ...l, sellAmount: l.buyAmount * rate } : { ...l, buyAmount: l.sellAmount * rate };
      return { ...t, nearLeg: setRate(t.nearLeg, near), farLeg: setRate(t.farLeg, far) };
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

/** Option-like trades that carry vega. */
export function isOption(t: Trade): boolean {
  return t.type === "CapFloor" || t.type === "Swaption" || t.type === "FxOption";
}

/** A firm quote ("Quoted") whose validity date lies before the valuation date. */
export function quoteExpired(t: Pick<Trade, "status" | "quoteValidUntil">, valuationDate: number): boolean {
  return t.status === "Quoted" && t.quoteValidUntil !== undefined && t.quoteValidUntil < valuationDate;
}

/** Whether a swap / CCS carries a coupon or spread schedule (step-up). */
export function hasCouponSchedule(t: Trade): boolean {
  if (t.type !== "InterestRateSwap" && t.type !== "CrossCurrencySwap") return false;
  return t.legs.some((l) => (l.type === "Fixed" ? (l.rateSchedule?.length ?? 0) > 0 : (l.spreadSchedule?.length ?? 0) > 0));
}

/**
 * Annuity amortisation (Markt N17): constant instalment derived from the loan
 * rate; the notional in force at each period start follows
 * N_{k+1} = N_k·(1+r) − P with P chosen so that N_n = `finalNotional`.
 * `periodStarts` are the leg's accrual starts (n periods), `freqMonths` the
 * period length in months (period rate r = loanRate · months / 12).
 */
export function annuityAmortisation(
  periodStarts: number[],
  notional: number,
  finalNotional: number,
  loanRate: number,
  freqMonths: number,
): { date: number; notional: number }[] {
  const n = periodStarts.length;
  if (n === 0) return [];
  const r = loanRate * (freqMonths / 12);
  const q = 1 + r;
  const payment = Math.abs(r) < 1e-12 ? (notional - finalNotional) / n : ((notional - finalNotional / Math.pow(q, n)) * r) / (1 - Math.pow(q, -n));
  const out: { date: number; notional: number }[] = [];
  let cur = notional;
  for (let k = 0; k < n; k++) {
    out.push({ date: periodStarts[k]!, notional: Math.max(0, Math.round(cur * 100) / 100) });
    cur = cur * q - payment;
  }
  return out;
}

/** Months per schedule frequency ("6M" → 6, "1Y" → 12, "ZC" → 0). */
export function frequencyMonths(freq: string): number {
  const m = /^(\d+)([MY])$/i.exec(freq.trim());
  if (!m) return 0;
  return Number(m[1]) * (m[2]!.toUpperCase() === "Y" ? 12 : 1);
}

/**
 * Parse a pasted two-column table "Datum;Nominal" (tab, semicolon or comma
 * separated, German or ISO dates, German numbers) into schedule entries
 * sorted by date. Lines without a parsable date + number are skipped.
 */
export function parseSchedulePaste(
  text: string,
  parseDate: (s: string) => number | undefined,
  parseNum: (s: string) => number | undefined,
): { date: number; notional: number }[] {
  const out: { date: number; notional: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // tab / semicolon separated; a comma is only a separator when the line has neither (decimal commas stay intact)
    const sep = /[\t;]/.test(line) ? /[\t;]/ : /,(?=\s*\d{1,2}\.\d{1,2}\.|\s*\d{4}-|\s*[\d"'])/;
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) continue;
    const d = parseDate(cells[0]!);
    const nRaw = cells.slice(1).find((c) => c !== "");
    const nVal = nRaw === undefined ? undefined : parseNum(nRaw);
    if (d === undefined || nVal === undefined || !Number.isFinite(nVal)) continue;
    out.push({ date: d, notional: nVal });
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}
