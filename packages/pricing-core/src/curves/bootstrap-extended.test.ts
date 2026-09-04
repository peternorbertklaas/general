import { describe, expect, it } from "vitest";
import {
  type CurveBuildSpec,
  type CurveQuote,
  bootstrapCurve,
  bootstrapCurves,
  bumpQuote,
  futureImpliedForward,
  orderCurveSpecs,
  quoteDates,
  quoteLabel,
} from "./bootstrap.js";
import { addBusinessDays, advance, getCalendar } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { makeBasisSwap } from "../instruments/builders.js";
import { type CrossCurrencySwap } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, SAMPLE_QUOTES, buildSampleMarket, sampleBootstrapSpecs } from "../market/sample-market.js";
import { validateMarket } from "../market/snapshot.js";
import { priceTrade } from "../pricing/price.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const TARGET = getCalendar("TARGET");
const SPOT = advance(VAL, "2D", TARGET); // 2026-09-07
const EUR3M = { currency: "EUR", index: "EURIBOR-3M" };

describe("money-market futures", () => {
  it("IMM-month and tenor starts resolve to third Wednesdays; period is the index tenor", () => {
    const imm = quoteDates(VAL, EUR3M, { type: "Future", start: "2026-12", price: 97.85 });
    expect(toISO(imm.start)).toBe("2026-12-16");
    expect(toISO(imm.end)).toBe("2027-03-16");
    // spot + 3M = 2026-12-07 → first quarterly IMM date on/after is the same December contract
    const byTenor = quoteDates(VAL, EUR3M, { type: "Future", start: "3M", price: 97.85 });
    expect(byTenor.start).toBe(imm.start);
    expect(toISO(quoteDates(VAL, EUR3M, { type: "Future", start: "6M", price: 97.85 }).start)).toBe("2027-03-17");
    expect(toISO(quoteDates(VAL, EUR3M, { type: "Future", start: "2027-03-17", price: 97.85 }).start)).toBe("2027-03-17");
  });

  it("implied forward = (100 − price)/100 − convexity", () => {
    expect(futureImpliedForward({ type: "Future", start: "3M", price: 97.84, convexityBp: 0.5 })).toBeCloseTo(0.02155, 12);
    expect(futureImpliedForward({ type: "Future", start: "3M", price: 97.84 })).toBeCloseTo(0.0216, 12);
  });

  it("sample EURIBOR-3M curve reproduces the futures-implied forwards and all residuals vanish", () => {
    const c = ctx.curves[SAMPLE_CURVE_IDS.eur3m]!;
    const futures = SAMPLE_QUOTES.eur3m.filter((q) => q.type === "Future");
    expect(futures).toHaveLength(2);
    for (const q of futures) {
      if (q.type !== "Future") continue;
      const { start, end } = quoteDates(VAL, EUR3M, q);
      expect(c.forwardRate(start, end, "ACT/360")).toBeCloseTo(futureImpliedForward(q), 10);
    }
    const spec = sampleBootstrapSpecs(VAL)[SAMPLE_CURVE_IDS.eur3m]!;
    const res = bootstrapCurve(VAL, { ...spec, discountCurve: ctx.curves[SAMPLE_CURVE_IDS.eurOis] });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    // N-C: the sample spec merges the FRA 3x6 / 6x9 pillars into the Dec/Mar futures (8 and 10 days apart) →
    // one pillar per remaining quote plus the spot anchor, strictly increasing
    expect(spec.pillarMergeToleranceDays).toBe(10);
    expect(res.mergedQuotes).toHaveLength(2);
    expect(res.mergedQuotes.map((m) => m.quote.type)).toEqual(["FRA", "FRA"]);
    expect(res.mergedQuotes.map((m) => toISO(m.maturity))).toEqual(["2027-03-08", "2027-06-07"]);
    expect(res.mergedQuotes.map((m) => toISO(m.mergedInto))).toEqual(["2027-03-16", "2027-06-17"]);
    expect(res.curve.nodeDates).toHaveLength(SAMPLE_QUOTES.eur3m.length + 1 - 2);
    for (let i = 1; i < res.curve.nodeDates.length; i++) expect(res.curve.nodeDates[i]!).toBeGreaterThan(res.curve.nodeDates[i - 1]!);
    // the dropped FRAs still reprice within a few 0.1bp on the futures-driven curve
    for (const m of res.mergedQuotes) expect(Math.abs(m.residual)).toBeLessThan(5e-4);
    // without the tolerance every quote gets its own pillar and the FRA levels are honoured exactly
    const full = bootstrapCurve(VAL, { ...spec, pillarMergeToleranceDays: 0, discountCurve: ctx.curves[SAMPLE_CURVE_IDS.eurOis] });
    expect(full.mergedQuotes).toEqual([]);
    expect(full.curve.nodeDates).toHaveLength(SAMPLE_QUOTES.eur3m.length + 1);
    const s3 = advance(SPOT, "3M", TARGET, "ModifiedFollowing", true);
    const e6 = advance(SPOT, "6M", TARGET, "ModifiedFollowing", true);
    expect(full.curve.forwardRate(s3, e6, "ACT/360")).toBeCloseTo(0.0215, 10);
    // 3M forwards on the merged curve stay monotone over the first 15 months (no kink between FRA and future pillar)
    let prev = -1;
    for (let m = 0; m <= 12; m += 3) {
      const s = advance(SPOT, `${m}M`, TARGET);
      const f = c.forwardRate(s, advance(s, "3M", TARGET), "ACT/360");
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it("convexity adjustment lowers the stripped forward by exactly the adjustment", () => {
    const base: CurveQuote[] = [
      { type: "Deposit", tenor: "3M", rate: 0.0212 },
      { type: "Future", start: "2026-12", price: 97.8 },
    ];
    const withCvx: CurveQuote[] = [base[0]!, { type: "Future", start: "2026-12", price: 97.8, convexityBp: 2 }];
    const a = bootstrapCurve(VAL, { id: "X", ...EUR3M, quotes: base }).curve;
    const b = bootstrapCurve(VAL, { id: "X", ...EUR3M, quotes: withCvx }).curve;
    const { start, end } = quoteDates(VAL, EUR3M, base[1]!);
    expect(a.forwardRate(start, end, "ACT/360") - b.forwardRate(start, end, "ACT/360")).toBeCloseTo(2e-4, 10);
  });
});

describe("tenor basis swaps", () => {
  const ois = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
  const eur6m = ctx.curves[SAMPLE_CURVE_IDS.eur6m]!;

  it("3M curve stripped from 3s6s basis swaps makes the basis swaps reprice to zero", () => {
    const spreads: Record<string, number> = { "2Y": 0.0008, "5Y": 0.0009, "10Y": 0.001 };
    const quotes: CurveQuote[] = [
      { type: "Deposit", tenor: "3M", rate: 0.0212 },
      { type: "FRA", start: "3M", end: "6M", rate: 0.0215 },
      { type: "FRA", start: "6M", end: "9M", rate: 0.0218 },
      { type: "FRA", start: "9M", end: "12M", rate: 0.0222 },
      ...Object.entries(spreads).map(([tenor, spread]): CurveQuote => ({ type: "BasisSwap", tenor, spread, otherIndex: "EURIBOR-6M", otherCurveId: eur6m.id })),
    ];
    const res = bootstrapCurve(VAL, { id: SAMPLE_CURVE_IDS.eur3m, ...EUR3M, quotes, discountCurve: ois, referenceCurves: { [eur6m.id]: eur6m } });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    const m: MarketContext = { ...ctx, curves: { ...ctx.curves, [res.curve.id]: res.curve } };
    for (const [tenor, spread] of Object.entries(spreads)) {
      const bs = makeBasisSwap({
        currency: "EUR",
        notional: 1e7,
        effectiveDate: SPOT,
        maturity: tenor,
        receiveIndex: "EURIBOR-3M",
        payIndex: "EURIBOR-6M",
        spread,
      });
      expect(Math.abs(priceTrade(m, bs, "EUR").pv)).toBeLessThan(1); // < 1 EUR on 10m
      // and a different spread is clearly off-market
      const off = makeBasisSwap({
        currency: "EUR",
        notional: 1e7,
        effectiveDate: SPOT,
        maturity: tenor,
        receiveIndex: "EURIBOR-3M",
        payIndex: "EURIBOR-6M",
        spread: spread + 0.001,
      });
      expect(priceTrade(m, off, "EUR").pv).toBeGreaterThan(1000);
    }
  });

  it("IBOR vs €STR basis: pillar sits on the last payment date (OIS payment lag) and residuals vanish", () => {
    // Convention: this curve's index + spread vs the other index. EURIBOR trades above €STR,
    // so "EURIBOR-3M − 12bp = €STR" is quoted with a negative spread on the EURIBOR leg.
    const q: CurveQuote = { type: "BasisSwap", tenor: "5Y", spread: -0.0012, otherIndex: "ESTR", otherCurveId: ois.id };
    const d = quoteDates(VAL, EUR3M, q);
    expect(d.end).toBe(addBusinessDays(advance(SPOT, "5Y", TARGET, "ModifiedFollowing", true), 1, TARGET));
    const res = bootstrapCurve(VAL, {
      id: SAMPLE_CURVE_IDS.eur3m,
      ...EUR3M,
      discountCurve: ois,
      referenceCurves: { [ois.id]: ois },
      quotes: [{ type: "Deposit", tenor: "3M", rate: 0.0212 }, { type: "BasisSwap", tenor: "2Y", spread: -0.001, otherIndex: "ESTR", otherCurveId: ois.id }, q],
    });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    expect(res.curve.nodeDates).toContain(d.end);
    // 3M EURIBOR above €STR by roughly the (negated) spread
    const y3 = VAL + 3 * 365;
    const gap = res.curve.zeroRate(y3) - ois.zeroRate(y3);
    expect(gap).toBeGreaterThan(0.0005);
    expect(gap).toBeLessThan(0.002);
    // and the sign flips with the quote convention (same instruments, positive spreads)
    const flipped = bootstrapCurve(VAL, {
      id: SAMPLE_CURVE_IDS.eur3m,
      ...EUR3M,
      discountCurve: ois,
      referenceCurves: { [ois.id]: ois },
      quotes: [
        { type: "Deposit", tenor: "3M", rate: 0.0212 },
        { type: "BasisSwap", tenor: "2Y", spread: 0.001, otherIndex: "ESTR", otherCurveId: ois.id },
        { type: "BasisSwap", tenor: "5Y", spread: 0.0012, otherIndex: "ESTR", otherCurveId: ois.id },
      ],
    });
    expect(flipped.curve.zeroRate(y3) - ois.zeroRate(y3)).toBeLessThan(-0.0005);
  });

  it("missing reference curve is reported clearly", () => {
    expect(() =>
      bootstrapCurve(VAL, {
        id: "X",
        ...EUR3M,
        discountCurve: ois,
        quotes: [{ type: "BasisSwap", tenor: "2Y", spread: 0, otherIndex: "EURIBOR-6M", otherCurveId: "NOPE" }],
      }),
    ).toThrow(/reference curve "NOPE"/);
  });
});

describe("cross-currency basis (collateral-adjusted discounting)", () => {
  const xccyId = SAMPLE_CURVE_IDS.eurUsdXccy;

  function sampleXccySwap(q: Extract<CurveQuote, { type: "XccyBasis" }>, collateralCurrency?: string): CrossCurrencySwap {
    const { start, endUnadjusted } = quoteDates(VAL, { currency: "EUR", index: "ESTR" }, q);
    const fx = ctx.fxSpots.EURUSD!;
    return {
      id: `xccy-${q.tenor}`,
      type: "CrossCurrencySwap",
      collateralCurrency,
      legs: [
        {
          type: "Float",
          payReceive: "Receive",
          notional: 1e7,
          currency: "EUR",
          effectiveDate: start,
          terminationDate: endUnadjusted,
          frequency: "3M",
          dayCount: "ACT/360",
          calendar: "TARGET+US",
          index: "ESTR",
          spread: q.spread,
          paymentLag: 2,
          stub: "ShortFront",
        },
        {
          type: "Float",
          payReceive: "Pay",
          notional: 1e7 * fx,
          currency: "USD",
          effectiveDate: start,
          terminationDate: endUnadjusted,
          frequency: "3M",
          dayCount: "ACT/360",
          calendar: "TARGET+US",
          index: "SOFR",
          paymentLag: 2,
          stub: "ShortFront",
        },
      ],
    };
  }

  it("sample market builds EUR-ESTR-USDCSA and registers it for EUR under USD CSA", () => {
    expect(ctx.curves[xccyId]).toBeDefined();
    expect(ctx.collateralDiscountCurveId?.["EUR|USD"]).toBe(xccyId);
    const { results } = bootstrapCurves(VAL, Object.values(sampleBootstrapSpecs(VAL)));
    for (const r of results[xccyId]!.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    expect(results[xccyId]!.curve.nodeDates).toHaveLength(SAMPLE_QUOTES.eurUsdXccy!.length + 1);
  });

  it("xccy basis swaps reprice to ~0 under USD CSA and are materially off under €STR discounting", () => {
    for (const q of SAMPLE_QUOTES.eurUsdXccy!) {
      if (q.type !== "XccyBasis") throw new Error("unexpected quote type");
      const collateralised = priceTrade(ctx, sampleXccySwap(q, "USD"), "EUR").pv;
      expect(Math.abs(collateralised)).toBeLessThan(1); // < 1 EUR on 10m notional
      const uncollateralised = priceTrade(ctx, sampleXccySwap(q), "EUR").pv;
      expect(Math.abs(uncollateralised)).toBeGreaterThan(5_000);
    }
  });

  it("differs from EUR-ESTR by roughly the quoted basis at each pillar", () => {
    const x = ctx.curves[xccyId]!;
    const estr = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    for (const q of SAMPLE_QUOTES.eurUsdXccy!) {
      if (q.type !== "XccyBasis") continue;
      const { end } = quoteDates(VAL, { currency: "EUR", index: "ESTR" }, q);
      const diff = x.zeroRate(end) - estr.zeroRate(end);
      expect(diff).toBeLessThan(0);
      expect(Math.abs(diff - q.spread)).toBeLessThan(2e-4); // within 2bp of the basis
    }
  });

  it("buildSampleMarket stays fast and is valid for other valuation dates", () => {
    // N7-03: best of two runs (the first one warms the JIT / date caches); the tight 300 ms bound is a local
    // performance guard, on a shared CI runner only a gross regression (> 3 s) fails the suite.
    const timeOnce = () => {
      const t0 = performance.now();
      buildSampleMarket(VAL);
      return performance.now() - t0;
    };
    const elapsed = Math.min(timeOnce(), timeOnce());
    expect(elapsed).toBeLessThan(process.env.CI ? 3_000 : 300);
    for (const iso of ["2026-12-15", "2027-03-15", "2028-12-29", "2030-06-30"]) {
      const m = buildSampleMarket(parseISO(iso));
      expect(Object.keys(m.curves)).toHaveLength(8); // 6 OIS/IBOR curves + EUR/USD CSA + JPY-TONA (N18)
      expect(validateMarket(m)).toEqual([]);
    }
  });

  it("omitting the xccy quotes drops the curve and the collateral mapping", () => {
    const { eurUsdXccy: _x, ...rest } = SAMPLE_QUOTES;
    const m = buildSampleMarket(VAL, rest);
    expect(m.curves[xccyId]).toBeUndefined();
    expect(m.collateralDiscountCurveId).toBeUndefined();
  });
});

describe("curve build helpers", () => {
  it("orderCurveSpecs builds dependencies first and detects cycles", () => {
    const specs = Object.values(sampleBootstrapSpecs(VAL)).reverse();
    const order = orderCurveSpecs(specs).map((s) => s.id);
    expect(order.indexOf(SAMPLE_CURVE_IDS.eurOis)).toBeLessThan(order.indexOf(SAMPLE_CURVE_IDS.eur6m));
    expect(order.indexOf(SAMPLE_CURVE_IDS.usdSofr)).toBeLessThan(order.indexOf(SAMPLE_CURVE_IDS.eurUsdXccy));
    expect(order.indexOf(SAMPLE_CURVE_IDS.eurOis)).toBeLessThan(order.indexOf(SAMPLE_CURVE_IDS.eurUsdXccy));
    const a: CurveBuildSpec = { id: "A", currency: "EUR", index: "ESTR", quotes: [], discountCurveId: "B" };
    const b: CurveBuildSpec = { id: "B", currency: "EUR", index: "ESTR", quotes: [], discountCurveId: "A" };
    expect(() => orderCurveSpecs([a, b])).toThrow(/Circular/);
  });

  it("bootstrapCurves reproduces buildSampleMarket curves and can reuse existing curves", () => {
    const specs = sampleBootstrapSpecs(VAL);
    const only6m = [specs[SAMPLE_CURVE_IDS.eur6m]!];
    const { curves, order } = bootstrapCurves(VAL, only6m, ctx.curves);
    expect(order).toEqual([SAMPLE_CURVE_IDS.eur6m]);
    const d = VAL + 3650;
    expect(curves[SAMPLE_CURVE_IDS.eur6m]!.df(d)).toBeCloseTo(ctx.curves[SAMPLE_CURVE_IDS.eur6m]!.df(d), 14);
    expect(() => bootstrapCurves(VAL, only6m)).toThrow(/neither in the specs nor in the existing curves/);
  });

  it("bumpQuote and quoteLabel cover every quote type", () => {
    expect(bumpQuote({ type: "OIS", tenor: "5Y", rate: 0.02 }, 1)).toEqual({ type: "OIS", tenor: "5Y", rate: 0.0201 });
    const fut = bumpQuote({ type: "Future", start: "3M", price: 97.8 }, 1);
    expect(fut.type).toBe("Future");
    expect((fut as { price: number }).price).toBeCloseTo(97.79, 10); // +1bp rate = −0.01 price
    expect(
      (bumpQuote({ type: "BasisSwap", tenor: "5Y", spread: 0.001, otherIndex: "ESTR", otherCurveId: "EUR-ESTR" }, 1) as { spread: number }).spread,
    ).toBeCloseTo(0.0011, 12);
    const x = SAMPLE_QUOTES.eurUsdXccy![0]!;
    expect((bumpQuote(x, 2) as { spread: number }).spread).toBeCloseTo((x as { spread: number }).spread + 2e-4, 12);
    expect(quoteLabel({ type: "FRA", start: "6M", end: "12M", rate: 0.02 })).toBe("FRA 6x12");
    expect(quoteLabel({ type: "OIS", tenor: "5Y", rate: 0.02 })).toBe("OIS 5Y");
    expect(quoteLabel({ type: "Swap", tenor: "10Y", rate: 0.02 })).toBe("Swap 10Y");
    expect(quoteLabel({ type: "Deposit", tenor: "3M", rate: 0.02 })).toBe("Depo 3M");
    expect(quoteLabel({ type: "Future", start: "2026-12", price: 97.8 })).toBe("Future 2026-12");
    expect(quoteLabel({ type: "BasisSwap", tenor: "5Y", spread: 0, otherIndex: "EURIBOR-6M", otherCurveId: "x" })).toBe("Basis 5Y vs EURIBOR-6M");
    expect(quoteLabel(x)).toBe("Xccy 1Y vs USD");
  });
});
