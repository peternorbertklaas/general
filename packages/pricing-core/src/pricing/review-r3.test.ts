import { describe, expect, it } from "vitest";
import { bootstrapCurve, turnOfYearWindow } from "../curves/bootstrap.js";
import { InterpolatedCurve, curveSource, flatCurve } from "../curves/curve.js";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO } from "../dates/date.js";
import { type DayCountConvention, normalizeDayCount } from "../dates/daycount.js";
import { MAX_PERIODS, buildSchedule, frequencyPerYear } from "../dates/schedule.js";
import { PricingError } from "../errors.js";
import { makeCapFloor, makeCrossCurrencySwap, makeFra, makeFxOption, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type CapFloor, type FloatLeg, type FxOption, type InterestRateSwap, type Swaption, type Trade } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, SAMPLE_QUOTES, buildSampleMarket } from "../market/sample-market.js";
import { deserializeMarket, isIsoDateTime, serializeMarket, validateMarket } from "../market/snapshot.js";
import { bachelier, black76, convertIrVol, normalToLognormalVol } from "../models/black.js";
import { type FxOptionInputs, fxBarrier, garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { emirValuationRecord, emirValuationTimestamp } from "../reporting/emir.js";
import { buildValuationReport, ifrs13Level, marketSnapshotId, methodologyFor } from "../reporting/valuation-report.js";
import { applyScenario } from "../risk/scenarios.js";
import { computeRisk, computeTheta } from "../risk/sensitivities.js";
import { bootstrapHazardCurve, computeXva, survivalProbability } from "../xva/cva.js";
import { priceTrade, validateTrade } from "./price.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const TARGET = getCalendar("TARGET");
const spot = advance(VAL, "2D", TARGET);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

describe("R3-1 – model / vol-surface mismatch converts the vol instead of misreading it", () => {
  const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
  const swaption = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "5Y", tenor: "10Y", valuationDate: VAL });

  it("normalToLognormalVol / convertIrVol are price-equivalent and reduce to the identity for equal quotations", () => {
    const f = 0.025;
    const k = 0.03;
    const t = 2;
    const sN = 0.0068;
    const sLN = normalToLognormalVol(f, k, t, sN);
    expect(black76("Call", f, k, sLN, t)).toBeCloseTo(bachelier("Call", f, k, sN, t), 14);
    expect(sLN).toBeGreaterThan(0.2);
    expect(sLN).toBeLessThan(0.4);
    const shifted = convertIrVol(sN, { kind: "normal" }, { kind: "lognormal", shift: 0.03 }, f, k, t);
    expect(black76("Call", f + 0.03, k + 0.03, shifted, t)).toBeCloseTo(bachelier("Call", f, k, sN, t), 14);
    // back and forth
    expect(convertIrVol(shifted, { kind: "lognormal", shift: 0.03 }, { kind: "normal" }, f, k, t)).toBeCloseTo(sN, 10);
    expect(convertIrVol(sN, { kind: "normal" }, { kind: "normal" }, f, k, t)).toBe(sN);
    expect(() => normalToLognormalVol(-0.01, 0.0, 1, 0.006)).toThrow(/positive/);
  });

  it("cap: model Black / ShiftedBlack on the normal sample surface equals the Bachelier PV (not 0.80) and warns VOL_TYPE_CONVERTED", () => {
    const bach = priceTrade(ctx, cap, "EUR");
    const black = priceTrade(ctx, { ...cap, model: "Black" }, "EUR");
    const shifted = priceTrade(ctx, { ...cap, model: "ShiftedBlack", shift: 0.03 }, "EUR");
    expect(bach.pv).toBeGreaterThan(100_000);
    expect(Math.abs(black.pv / bach.pv - 1)).toBeLessThan(0.03);
    expect(Math.abs(shifted.pv / bach.pv - 1)).toBeLessThan(0.03);
    expect(black.warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED") && w.includes("Black"))).toBe(true);
    expect(black.analytics.model).toBe("Black");
    expect(black.analytics.volConverted).toBe("yes");
    expect(bach.analytics.volConverted).toBe("no");
    expect(bach.warnings).toEqual([]);
    // an explicit override is read in the model's own quotation and never converted
    expect(priceTrade(ctx, { ...cap, model: "Black", volOverride: 0.3 }, "EUR").warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED"))).toBe(false);
    // the surface-bump vega of the Black-on-normal cap equals the Bachelier vega (same market input bumped)
    const vBlack = computeRisk(ctx, { ...cap, model: "Black" }, "EUR", { bucketed: false, theta: false }).vega["caplet:EUR-EURIBOR-6M"]!;
    const vBach = computeRisk(ctx, cap, "EUR", { bucketed: false, theta: false }).vega["caplet:EUR-EURIBOR-6M"]!;
    expect(Math.abs(vBlack / vBach - 1)).toBeLessThan(1e-6);
  });

  it("swaption: Black on the normal cube equals the Bachelier PV (not the intrinsic value), reports both vols and stays Level 2 with a hint", () => {
    const bach = priceTrade(ctx, swaption, "EUR");
    const black = priceTrade(ctx, { ...swaption, model: "Black" }, "EUR");
    expect(bach.pv).toBeGreaterThan(500_000);
    expect(Math.abs(black.pv / bach.pv - 1)).toBeLessThan(0.03);
    expect(black.warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED"))).toBe(true);
    expect(black.analytics.surfaceVolatility as number).toBeCloseTo(bach.analytics.volatility as number, 12);
    expect(black.analytics.volatility as number).toBeGreaterThan(0.1); // lognormal ≈ 23 %
    const lvl = ifrs13Level(ctx, { ...swaption, model: "Black" }, black);
    expect(lvl.level).toBe(2);
    expect(lvl.rationale).toContain("Hinweis");
    expect(lvl.rationale).toContain("konvertiert");
    const report = buildValuationReport(ctx, { ...swaption, model: "Black" }, black);
    expect(report.fairValue.ifrs13Level).toBe(2);
    expect(report.methodology.some((l) => l.includes("Black-76") && l.includes("konvertiert"))).toBe(true);
    // the reported vol unit follows the model, not the surface: lognormal vols are shown in %
    expect(report.methodology.some((l) => l.includes("verwendete Vol") && l.includes("%") && !l.includes("bp Normal-Vol –"))).toBe(true);
  });

  it("a lognormal model on a non-positive shifted forward/strike raises VOL_MODEL_INCOMPATIBLE instead of a silent zero", () => {
    expect(codeOf(() => priceTrade(ctx, { ...cap, model: "Black", strike: -0.01 }, "EUR"))).toBe("VOL_MODEL_INCOMPATIBLE");
    // with a sufficient shift the same strike is fine
    expect(priceTrade(ctx, { ...cap, model: "ShiftedBlack", shift: 0.03, strike: -0.01 }, "EUR").pv).toBeGreaterThan(0);
    // fallback vol without a surface is a normal vol too and gets converted
    const noVols = { ...ctx, swaptionVols: undefined };
    const r = priceTrade(noVols, { ...swaption, model: "Black" }, "EUR");
    expect(r.warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED"))).toBe(true);
    expect(Math.abs(r.pv / priceTrade(noVols, swaption, "EUR").pv - 1)).toBeLessThan(1e-9);
  });
});

describe("R3-2 – marketSnapshotId covers every market input and is order independent", () => {
  const id0 = marketSnapshotId(ctx);
  it("reordering curves / FX spots / fixings keeps the id; a JSON round trip keeps the id", () => {
    const reordered: MarketContext = {
      ...ctx,
      curves: Object.fromEntries(Object.entries(ctx.curves).reverse()),
      fxSpots: Object.fromEntries(Object.entries(ctx.fxSpots).reverse()),
      fixings: [
        { index: "EURIBOR-6M", date: VAL - 3, value: 0.021 },
        { index: "ESTR", date: VAL - 1, value: 0.02 },
      ],
    };
    const swapped = { ...reordered, fixings: [...reordered.fixings!].reverse() };
    expect(marketSnapshotId(reordered)).toBe(marketSnapshotId(swapped));
    expect(marketSnapshotId(reordered)).not.toBe(id0); // fixings added
    expect(marketSnapshotId({ ...ctx, curves: Object.fromEntries(Object.entries(ctx.curves).reverse()) })).toBe(id0);
    expect(marketSnapshotId(deserializeMarket(JSON.parse(JSON.stringify(serializeMarket(ctx)))))).toBe(id0);
    expect(id0).toMatch(/^[0-9a-f]{16}$/);
  });
  it("+20 bp swaption vols, a fixing, a hazard rate, the CSA mapping, an explicit spot date, a turn-of-year jump and the label all change the id", () => {
    const ids = [
      marketSnapshotId(applyScenario(ctx, { id: "v", name: "v", irVolShiftBp: 20 })),
      marketSnapshotId({ ...ctx, fixings: [{ index: "EURIBOR-6M", date: VAL - 1, value: 0.02 }] }),
      marketSnapshotId({ ...ctx, credit: { ...ctx.credit, "CPTY-A": { hazardRate: 0.02, recovery: 0.4 } } }),
      marketSnapshotId({ ...ctx, collateralDiscountCurveId: undefined }),
      marketSnapshotId({ ...ctx, fxSpotDates: { EURUSD: spot + 1 } }),
      marketSnapshotId({ ...ctx, fxVols: { ...ctx.fxVols, EURUSD: { ...ctx.fxVols!.EURUSD!, deltaConvention: "Forward" } } }),
      marketSnapshotId({ ...ctx, meta: { ...ctx.meta, label: "other" } }),
    ];
    const toy = bootstrapCurve(VAL, {
      id: SAMPLE_CURVE_IDS.eurOis,
      currency: "EUR",
      index: "ESTR",
      quotes: SAMPLE_QUOTES.eurOis,
      turnOfYear: [{ date: parseISO("2026-12-31"), bp: 15 }],
    });
    ids.push(marketSnapshotId({ ...ctx, curves: { ...ctx.curves, [SAMPLE_CURVE_IDS.eurOis]: toy.curve } }));
    for (const id of ids) expect(id).not.toBe(id0);
    expect(new Set(ids).size).toBe(ids.length);
    // the report anchors follow: a vol shift changes snapshotId and inputsHash of an option report
    const sw = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "5Y", tenor: "10Y", valuationDate: VAL });
    const shifted = applyScenario(ctx, { id: "v", name: "v", irVolShiftBp: 20 });
    const r0 = buildValuationReport(ctx, sw, priceTrade(ctx, sw, "EUR"));
    const r1 = buildValuationReport(shifted, sw, priceTrade(shifted, sw, "EUR"));
    expect(r1.audit.snapshotId).not.toBe(r0.audit.snapshotId);
    expect(r1.audit.inputsHash).not.toBe(r0.audit.inputsHash);
    // legacy curve-only scope ignores vols
    expect(marketSnapshotId(shifted, { scope: "curves" })).toBe(marketSnapshotId(ctx, { scope: "curves" }));
    expect(marketSnapshotId(applyScenario(ctx, { id: "r", name: "r", curveShifts: [{ target: "*", parallelBp: 1 }] }), { scope: "curves" })).not.toBe(
      marketSnapshotId(ctx, { scope: "curves" }),
    );
  });
});

describe("R3-3 – hazard bootstrap rejects (or floors) negative hazards", () => {
  const inverted = [
    { tenor: "1Y", spread: 0.05 },
    { tenor: "3Y", spread: 0.01 },
  ];
  it("inverted CDS quotes raise INVALID_CREDIT_CURVE naming the pillar", () => {
    let err: PricingError | undefined;
    try {
      bootstrapHazardCurve(inverted, 0.4, VAL);
    } catch (e) {
      err = e as PricingError;
    }
    expect(err).toBeInstanceOf(PricingError);
    expect(err!.code).toBe("INVALID_CREDIT_CURVE");
    expect(err!.details?.pillar).toBe("3Y");
    expect(err!.details?.hazard as number).toBeLessThan(0);
    expect(codeOf(() => bootstrapHazardCurve([], 0.4, VAL))).toBe("INVALID_CREDIT_CURVE");
    expect(codeOf(() => bootstrapHazardCurve([{ tenor: "1Y", spread: -0.01 }], 0.4, VAL))).toBe("INVALID_CREDIT_CURVE");
    expect(codeOf(() => bootstrapHazardCurve([{ tenor: "1Y", spread: 0.01 }], 1.2, VAL))).toBe("INVALID_CREDIT_CURVE");
  });
  it("with floorHazard the interval is floored at 0, survival is monotone and a HAZARD_FLOORED warning is set", () => {
    const curve = bootstrapHazardCurve(inverted, 0.4, VAL, undefined, { floorHazard: true });
    expect(curve.hazards[0]!).toBeGreaterThan(0.08);
    expect(curve.hazards[1]).toBe(0);
    expect(curve.warnings).toHaveLength(1);
    expect(curve.warnings![0]).toMatch(/^HAZARD_FLOORED: pillar 3Y/);
    expect(survivalProbability(curve, 3)).toBeLessThanOrEqual(survivalProbability(curve, 1));
    // a regular term structure is untouched
    const ok = bootstrapHazardCurve(
      [
        { tenor: "1Y", spread: 0.005 },
        { tenor: "5Y", spread: 0.01 },
      ],
      0.4,
      VAL,
    );
    expect(ok.warnings).toBeUndefined();
    expect(ok.hazards.every((h) => h > 0)).toBe(true);
  });
});

describe("R3-4 – validation gaps close with coded errors", () => {
  const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
  const swaption = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "2Y", tenor: "5Y", valuationDate: VAL });
  const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
  const fx = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") });
  const legs = (patch: Record<string, unknown>): InterestRateSwap => ({
    ...swap,
    legs: swap.legs.map((l) => ({ ...l, ...patch }) as InterestRateSwap["legs"][number]),
  });

  it("volOverride ≤ 0, collar floor > cap, embedded cap < floor, notional ≤ 0, paymentLag < 0 → INVALID_TRADE", () => {
    const cases: [Trade, RegExp][] = [
      [{ ...cap, volOverride: -0.01 }, /volOverride must be a positive/],
      [{ ...cap, volOverride: 0 }, /volOverride must be a positive/],
      [{ ...swaption, volOverride: 0 }, /volOverride must be a positive/],
      [{ ...fx, volOverride: -0.5 }, /volOverride must be a positive/],
      [{ ...cap, capFloor: "Collar", floorStrike: 0.04 } as CapFloor, /floorStrike \(0\.04\) must not exceed the cap strike/],
      [
        { ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? ({ ...l, capRate: 0.01, floorRate: 0.03 } as FloatLeg) : l)) },
        /capRate .* must not be below floorRate/,
      ],
      [{ ...cap, notional: -1e7 }, /notional must be positive/],
      [{ ...cap, notional: 0 }, /notional must be positive/],
      [legs({ notional: -5e6 }), /notional must be positive/],
      [{ ...fx, notional: -1e6 }, /notional must be positive/],
      [legs({ paymentLag: -3 }), /paymentLag must be a non-negative integer/],
      [{ ...cap, shift: -0.01 }, /shift must be a non-negative/],
    ];
    for (const [t, re] of cases) {
      const problems = validateTrade(t);
      expect(problems.join("; "), t.id).toMatch(re);
      expect(codeOf(() => priceTrade(ctx, t, "EUR"))).toBe("INVALID_TRADE");
    }
    // the valid originals still pass
    for (const t of [cap, swaption, swap, fx]) expect(validateTrade(t)).toEqual([]);
    expect(validateTrade({ ...cap, capFloor: "Collar", floorStrike: 0.02 } as CapFloor)).toEqual([]);
  });

  it("invalid frequency / unknown day count / swaption underlying without a fixed leg are PricingErrors with codes, and INVALID_TRADE via priceTrade", () => {
    expect(codeOf(() => frequencyPerYear("7Q"))).toBe("INVALID_FREQUENCY");
    expect(codeOf(() => frequencyPerYear("0M"))).toBe("INVALID_FREQUENCY");
    expect(codeOf(() => buildSchedule({ effectiveDate: spot, terminationDate: spot + 365, frequency: "7Q", calendar: "TARGET" }))).toBe("INVALID_FREQUENCY");
    expect(codeOf(() => normalizeDayCount("ACT/999"))).toBe("UNKNOWN_DAYCOUNT");
    expect(codeOf(() => buildSchedule({ effectiveDate: spot, terminationDate: spot, frequency: "6M", calendar: "TARGET" }))).toBe("INVALID_TRADE");
    const badDc = "ACT/999" as DayCountConvention;
    for (const t of [
      legs({ frequency: "7Q" }),
      legs({ frequency: "0M" }),
      legs({ dayCount: badDc }),
      { ...cap, frequency: "7Q" },
      { ...cap, dayCount: badDc },
    ]) {
      const problems = validateTrade(t as Trade);
      expect(problems.join("; ")).toMatch(/INVALID_FREQUENCY|UNKNOWN_DAYCOUNT/);
      expect(codeOf(() => priceTrade(ctx, t as Trade, "EUR"))).toBe("INVALID_TRADE");
    }
    const noFixed: Swaption = { ...swaption, underlying: { ...swaption.underlying, legs: swaption.underlying.legs.filter((l) => l.type === "Float") } };
    expect(validateTrade(noFixed).join("; ")).toMatch(/exactly one Fixed leg/);
    expect(codeOf(() => priceTrade(ctx, noFixed, "EUR"))).toBe("INVALID_TRADE");
    const twoFixed: Swaption = { ...swaption, underlying: { ...swaption.underlying, legs: [swaption.underlying.legs[0]!, swaption.underlying.legs[0]!] } };
    expect(validateTrade(twoFixed).join("; ")).toMatch(/exactly one Fixed leg|must have a Float leg/);
  });

  it("N3-01: a leg with more than MAX_PERIODS periods is rejected with TOO_MANY_PERIODS before any schedule work", () => {
    expect(MAX_PERIODS).toBe(1200);
    const daily = legs({ frequency: "1D", terminationDate: spot + 36525 });
    const t0 = performance.now();
    let err: PricingError | undefined;
    try {
      priceTrade(ctx, daily, "EUR");
    } catch (e) {
      err = e as PricingError;
    }
    expect(performance.now() - t0).toBeLessThan(50);
    expect(err?.code).toBe("TOO_MANY_PERIODS");
    expect(err?.details?.maxPeriods).toBe(1200);
    expect(err?.details?.periods as number).toBeGreaterThan(30_000);
    // exactly at the limit with an explicit override the schedule builds
    const s = buildSchedule({ effectiveDate: spot, terminationDate: spot + 14, frequency: "1D", calendar: "NONE", maxPeriods: 14 });
    expect(s.periods).toHaveLength(14);
    expect(codeOf(() => buildSchedule({ effectiveDate: spot, terminationDate: spot + 15, frequency: "1D", calendar: "NONE", maxPeriods: 14 }))).toBe(
      "TOO_MANY_PERIODS",
    );
    // a 50Y monthly swap (600 periods) is still fine
    expect(priceTrade(ctx, legs({ frequency: "1M", terminationDate: spot + 365 * 50 }), "EUR").legs[0]!.cashflows.length).toBe(600);
  });
});

describe("R3-5 – monotone-convex extrapolation continues the instantaneous forward", () => {
  it("the forward is continuous across the last pillar (< 0.1 bp) for the bootstrapped sample curve and a hand-made curve", () => {
    const mc = bootstrapCurve(VAL, { id: "MC", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis, interpolation: "monotoneConvex" }).curve;
    const last = mc.nodeDates[mc.nodeDates.length - 1]!;
    const before = mc.forwardAtTimes(mc.time(last - 1), mc.time(last));
    const after = mc.forwardAtTimes(mc.time(last + 1), mc.time(last + 2));
    expect(Math.abs(after - before) * 1e4).toBeLessThan(0.1);
    // pillars still exact, extrapolated DFs decreasing
    for (const n of mc.nodes()) expect(mc.df(n.date)).toBeCloseTo(n.df, 12);
    expect(mc.df(last + 3650)).toBeLessThan(mc.df(last));
    // log-linear (piecewise constant forward) is unchanged: its last interval forward is the extrapolation rate
    const ll = bootstrapCurve(VAL, { id: "LL", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis }).curve;
    expect(ll.forwardAtTimes(ll.time(last + 1), ll.time(last + 2))).toBeCloseTo(ll.forwardAtTimes(ll.time(last - 1), ll.time(last)), 12);
    const times = [0.5, 1, 2, 5, 10];
    const zeros = [0.02, 0.022, 0.025, 0.03, 0.032];
    const nodes = times.map((t, i) => ({ date: VAL + Math.round(t * 365), df: Math.exp(-zeros[i]! * t) }));
    const c = new InterpolatedCurve({ id: "X", currency: "EUR", referenceDate: VAL, nodes, interpolation: "monotoneConvex" });
    const d = nodes[nodes.length - 1]!.date;
    expect(Math.abs(c.forwardAtTimes(c.time(d + 1), c.time(d + 2)) - c.forwardAtTimes(c.time(d - 1), c.time(d))) * 1e4).toBeLessThan(0.1);
  });
});

describe("R3-6 – turn-of-year window and calendar-anchored jumps", () => {
  it("default window is the business-day span over the turn; explicit days win; holiday dates are moved to the last business day", () => {
    expect(turnOfYearWindow(parseISO("2026-12-31"), "TARGET")).toEqual({ date: parseISO("2026-12-31"), days: 4 }); // Thu → Mon 4 Jan
    expect(turnOfYearWindow(parseISO("2028-12-31"), "TARGET")).toEqual({ date: parseISO("2028-12-29"), days: 4 }); // Sun → Fri 29 Dec → Tue 2 Jan
    expect(turnOfYearWindow(parseISO("2027-12-31"), "TARGET")).toEqual({ date: parseISO("2027-12-31"), days: 3 }); // Fri → Mon 3 Jan
    const toy = parseISO("2026-12-31");
    const res = bootstrapCurve(VAL, { id: "TOY", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis, turnOfYear: [{ date: toy, bp: 15 }] });
    expect(res.curve.forwardJumps).toEqual([{ date: toy, bp: 15, days: 4 }]);
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    const explicit = bootstrapCurve(VAL, {
      id: "TOY1",
      currency: "EUR",
      index: "ESTR",
      quotes: SAMPLE_QUOTES.eurOis,
      turnOfYear: [{ date: toy, bp: 15, days: 1 }],
    });
    expect(explicit.curve.forwardJumps).toEqual([{ date: toy, bp: 15, days: 1 }]);
    // the whole window carries the premium, the day after it does not
    const c = res.curve;
    const base = c.forwardRate(toy - 1, toy, "ACT/360");
    expect((c.forwardRate(toy, toy + 4, "ACT/360") - base) * 1e4).toBeCloseTo(15 * (360 / 365), 1);
    expect(Math.abs(c.forwardRate(toy + 4, toy + 5, "ACT/360") - base) * 1e4).toBeLessThan(0.5);
    // on identical base nodes the accumulated DF effect of the 4-day window is 4× the one-day window (the
    // bootstrapped curves above re-solve their pillars, so the comparison is made on a fixed node set)
    const plain = ctx.curves[SAMPLE_CURVE_IDS.eurOis]! as InterpolatedCurve;
    const withDays = (days: number) =>
      new InterpolatedCurve({ id: "J", currency: "EUR", referenceDate: VAL, nodes: plain.nodes(), forwardJumps: [{ date: toy, bp: 15, days }] });
    const df1 = withDays(1).df(toy + 30) / withDays(1).df(toy - 1);
    const df4 = withDays(4).df(toy + 30) / withDays(4).df(toy - 1);
    expect(Math.log(df1 / df4)).toBeCloseTo((3 * 15e-4) / 365, 9);
  });
  it("rolledTo keeps the jump on its calendar date (theta of a swap over the turn sees the turn on the same dates)", () => {
    const toy = parseISO("2026-12-31");
    const c = bootstrapCurve(VAL, {
      id: SAMPLE_CURVE_IDS.eurOis,
      currency: "EUR",
      index: "ESTR",
      quotes: SAMPLE_QUOTES.eurOis,
      turnOfYear: [{ date: toy, bp: 15 }],
    }).curve;
    const rolled = c.rolledTo(VAL + 10);
    expect(rolled.forwardJumps[0]!.date).toBe(toy);
    expect(rolled.forwardRate(toy, toy + 1, "ACT/360") - rolled.forwardRate(toy - 1, toy, "ACT/360")).toBeGreaterThan(10e-4);
    // rolled past the window: the jump no longer affects the curve
    const past = c.rolledTo(toy + 10);
    expect(Math.abs(past.forwardRate(toy + 20, toy + 21, "ACT/360") - past.forwardRate(toy + 19, toy + 20, "ACT/360")) * 1e4).toBeLessThan(0.5);
    // JSON round trip keeps date and days
    expect(InterpolatedCurve.fromJSON(c.toJSON()).forwardJumps).toEqual(c.forwardJumps);
    // theta of a 1M OIS over the turn is finite and differs from the plain curve's
    const tctx = { ...ctx, curves: { ...ctx.curves, [SAMPLE_CURVE_IDS.eurOis]: c } };
    const ois = makeVanillaSwap({
      currency: "EUR",
      notional: 1e8,
      payReceiveFixed: "Pay",
      fixedRate: 0.02,
      effectiveDate: parseISO("2026-12-15"),
      maturity: "1M",
      index: "ESTR",
    });
    const theta = computeTheta(tctx, ois, "EUR").total;
    expect(Number.isFinite(theta)).toBe(true);
    expect(theta).not.toBeCloseTo(computeTheta(ctx, ois, "EUR").total, 3);
  });
});

describe("R3-7 – curve provenance drives the methodology text", () => {
  const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
  it("bootstrap → 'sequentielles Bootstrapping', flat → 'flache Kurve', import → 'importierte Kurve (Pillars aus Snapshot)'", () => {
    expect(curveSource(ctx.curves[SAMPLE_CURVE_IDS.eurOis]!)).toBe("bootstrap");
    const line = (c: MarketContext) => methodologyFor(swap, c, priceTrade(c, swap, "EUR")).find((l) => l.startsWith("Kurve EUR-ESTR"))!;
    expect(line(ctx)).toContain("sequentielles Bootstrapping");
    const flat = flatCurve("EUR-ESTR", "EUR", VAL, 0.02);
    expect(curveSource(flat)).toBe("flat");
    const fctx = { ...ctx, curves: { ...ctx.curves, "EUR-ESTR": flat } };
    expect(line(fctx)).toContain("flache Kurve");
    expect(line(fctx)).not.toContain("Bootstrapping");
    // a snapshot without provenance is an import; a snapshot of a bootstrapped curve keeps its provenance
    const json = serializeMarket(ctx);
    const stripped = deserializeMarket(
      JSON.parse(JSON.stringify({ ...json, curves: json.curves.map((c) => ({ ...c, meta: { index: c.meta?.index ?? "" } })) })),
    );
    expect(curveSource(stripped.curves["EUR-ESTR"]!)).toBe("import");
    expect(line(stripped)).toContain("importierte Kurve (Pillars aus Snapshot");
    expect(line(stripped)).not.toContain("sequentielles Bootstrapping");
    expect(curveSource(deserializeMarket(JSON.parse(JSON.stringify(json))).curves["EUR-ESTR"]!)).toBe("bootstrap");
    // a non-local interpolation adds the bucket non-additivity note (R3-5)
    const mc = bootstrapCurve(VAL, { id: "EUR-ESTR", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis, interpolation: "monotoneConvex" }).curve;
    expect(line({ ...ctx, curves: { ...ctx.curves, "EUR-ESTR": mc } })).toContain("nicht exakt additiv");
    expect(line(ctx)).not.toContain("nicht exakt additiv");
  });
});

describe("R3-8 – sample FX surfaces declare their conventions", () => {
  it("all sample surfaces are quoted in spot delta with a delta-neutral ATM, and the methodology says so", () => {
    for (const s of Object.values(ctx.fxVols!)) {
      expect(s.deltaConvention).toBe("Spot");
      expect(s.atmConvention).toBe("DeltaNeutral");
    }
    const call = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.25, expiryDate: parseISO("2027-09-03") });
    const r = priceTrade(ctx, call, "USD");
    // review probe: 1Y K 1.25 – 8.1803 % under a forward delta, 8.2023 % under the spot delta
    expect(r.analytics.volatility as number).toBeCloseTo(0.08202, 4);
    expect(methodologyFor(call, ctx, r).some((l) => l.includes("Delta-Konvention Spot") && l.includes("Delta-neutral"))).toBe(true);
    const fwdCtx = { ...ctx, fxVols: { ...ctx.fxVols, EURUSD: { ...ctx.fxVols!.EURUSD!, deltaConvention: "Forward" as const } } };
    expect(priceTrade(fwdCtx, call, "USD").analytics.volatility as number).toBeCloseTo(0.0818, 3);
  });
});

describe("R3-9 – barrier drift and rebate discounting under a non-standard delivery lag", () => {
  const base: FxOptionInputs = { type: "Call", spot: 1.1625, strike: 1.16, vol: 0.077, timeToExpiry: 7 / 365, rd: 0.05, rf: 0.02 };
  it("explicit expiry-horizon rates: In + Out = Vanilla for every lag, and the rebate-at-hit value does not depend on the delivery lag", () => {
    const rdE = 0.05 * (9 / 7); // rates to the standard delivery (T + 2 days) rescaled to the expiry horizon
    const rfE = 0.02 * (9 / 7);
    const rebates: number[] = [];
    const kiShares: number[] = [];
    for (const lag of [2, 5, 10]) {
      const i: FxOptionInputs = { ...base, timeToDelivery: (7 + lag) / 365, rdExpiry: rdE, rfExpiry: rfE };
      const vanilla = garmanKohlhagen(i).premiumDomestic;
      const out = fxBarrier({ ...i, barrier: 1.175, barrierType: "UpOut" });
      const inn = fxBarrier({ ...i, barrier: 1.175, barrierType: "UpIn" });
      expect(out + inn).toBeCloseTo(vanilla, 14);
      const dOut = fxBarrier({ ...i, barrier: 1.15, barrierType: "DownOut" });
      const dIn = fxBarrier({ ...i, barrier: 1.15, barrierType: "DownIn" });
      expect(dOut + dIn).toBeCloseTo(vanilla, 14);
      rebates.push(fxBarrier({ ...i, barrier: 1.175, barrierType: "UpOut", rebate: 0.01 }) - out);
      kiShares.push(inn / vanilla);
    }
    expect(rebates[1]).toBeCloseTo(rebates[0]!, 12);
    expect(rebates[2]).toBeCloseTo(rebates[0]!, 12);
    expect(rebates[0]!).toBeGreaterThan(0);
    expect(rebates[0]!).toBeLessThan(0.01);
    // the old scaling (default rates) let the extra carry leak into the drift: the knock-in share moved up with the lag
    const scaled5 = { ...base, timeToDelivery: 12 / 365 };
    const shareScaled = fxBarrier({ ...scaled5, barrier: 1.175, barrierType: "UpIn" }) / garmanKohlhagen(scaled5).premiumDomestic;
    expect(shareScaled).toBeGreaterThan(kiShares[0]!);
    expect(kiShares[1]!).toBeLessThan(shareScaled);
    // standard delivery: the defaults equal the explicit expiry-horizon rates (bit-identical to the R2 implementation)
    const std = { ...base, timeToDelivery: 9 / 365 };
    expect(fxBarrier({ ...std, barrier: 1.175, barrierType: "UpOut", rebate: 0.01 })).toBeCloseTo(
      fxBarrier({ ...std, rdExpiry: rdE, rfExpiry: rfE, barrier: 1.175, barrierType: "UpOut", rebate: 0.01 }),
      14,
    );
    // Haug (2007) Table 4-13 is untouched: down-and-out calls S 100, H 95, K 3, T 0.5, r 8 %, b 4 %, σ 25 % → X 90: 9.0246, X 100: 6.7924
    const haug = {
      type: "Call" as const,
      spot: 100,
      barrier: 95,
      rebate: 3,
      timeToExpiry: 0.5,
      rd: 0.08,
      rf: 0.04,
      vol: 0.25,
      barrierType: "DownOut" as const,
    };
    expect(fxBarrier({ ...haug, strike: 90 })).toBeCloseTo(9.0246, 3);
    expect(fxBarrier({ ...haug, strike: 100 })).toBeCloseTo(6.7924, 3);
  });
  it("pricer: a non-standard delivery date flags the convention, supplies the expiry-horizon rates and keeps In + Out = Vanilla", () => {
    const shortDated: FxOption = makeFxOption({
      pair: "EURUSD",
      optionType: "Call",
      notional: 1e6,
      strike: 1.1625,
      expiryDate: parseISO("2026-09-10"),
      deliveryDate: parseISO("2026-09-17"),
    });
    const out = priceTrade(ctx, { ...shortDated, barrier: { type: "UpOut", level: 1.19 } }, "USD");
    expect(out.analytics.deliveryConvention).toBe("non-standard");
    expect(out.details?.standardDelivery).toBe("2026-09-14");
    const inn = priceTrade(ctx, { ...shortDated, barrier: { type: "UpIn", level: 1.19 } }, "USD");
    expect(Math.abs((out.pv + inn.pv) / priceTrade(ctx, shortDated, "USD").pv - 1)).toBeLessThan(1e-9);
    const standard = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") });
    const rs = priceTrade(ctx, { ...standard, barrier: { type: "UpOut", level: 1.25 } }, "USD");
    expect(rs.analytics.deliveryConvention).toBe("standard");
    expect(methodologyFor({ ...shortDated, barrier: { type: "UpOut", level: 1.19 } }, ctx, out).some((l) => l.includes("Standard-Lieferdatum"))).toBe(true);
    // rho of the barrier with explicit expiry rates is finite and of the same sign as the vanilla's
    expect(Number.isFinite(out.analytics.rhoDomestic as number)).toBe(true);
  });
});

describe("N3-03 / N3-08 / N3-09 – snapshot time validation, framework citation, EMIR clearing field", () => {
  const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
  it("meta.snapshotTime must be ISO-8601: validateMarket flags it, deserializeMarket rejects it, EMIR never exports it", () => {
    expect(isIsoDateTime("2026-09-03T16:30:00Z")).toBe(true);
    expect(isIsoDateTime("2026-09-03T16:30:00.123+02:00")).toBe(true);
    expect(isIsoDateTime("gestern irgendwann")).toBe(false);
    expect(isIsoDateTime("2026-09-03")).toBe(false);
    expect(isIsoDateTime("2026-13-03T16:30:00Z")).toBe(false);
    const bad = { ...ctx, meta: { ...ctx.meta, snapshotTime: "gestern irgendwann" } };
    expect(validateMarket(bad).some((p) => p.includes("snapshotTime"))).toBe(true);
    expect(validateMarket(ctx)).toEqual([]);
    expect(codeOf(() => deserializeMarket(serializeMarket(bad)))).toBe("INVALID_TIMESTAMP");
    expect(() => deserializeMarket(serializeMarket({ ...ctx, meta: { ...ctx.meta, snapshotTime: "2026-09-03T16:30:00Z" } }))).not.toThrow();
    // the EMIR timestamp ignores an unparsable snapshot time and falls back; explicit garbage is rejected
    expect(emirValuationTimestamp(bad)).toBe("2026-09-03T17:00:00Z");
    expect(emirValuationTimestamp(bad, { asOf: "2026-09-03T18:00:00Z" })).toBe("2026-09-03T18:00:00Z");
    expect(emirValuationTimestamp(ctx, { timestamp: "2026-09-03T16:30:00.500+02:00" })).toBe("2026-09-03T14:30:00Z");
    expect(codeOf(() => emirValuationTimestamp(ctx, { timestamp: "irgendwann" }))).toBe("INVALID_TIMESTAMP");
    expect(codeOf(() => emirValuationTimestamp(ctx, { asOf: "irgendwann" }))).toBe("INVALID_TIMESTAMP");
  });
  it("the framework line cites IDW RS HFA 47 for the fair value and HFA 35 only for hedge accounting; MaRisk AT 4.3.5", () => {
    const rep = buildValuationReport(ctx, swap, priceTrade(ctx, swap, "EUR"));
    const line = rep.methodology[0]!;
    expect(line).toMatch(/^Bewertungsrahmen: IFRS 13 \/ IDW RS HFA 47/);
    expect(line).toContain("§ 254 HGB i. V. m. IDW RS HFA 35 (Hedge-Accounting-Modul)");
    expect(line).toContain("AT 4.3.5");
    expect(line).not.toMatch(/AT 4\.3\.[x4]/);
    expect(rep.methodology.join("\n")).not.toMatch(/HFA 35(?! \(Hedge)/);
  });
  it("clearingObligation is an explicit trade flag, never derived from cleared; N/A when unknown", () => {
    const priced = priceTrade(ctx, swap, "EUR");
    expect(emirValuationRecord(ctx, { ...swap, cleared: true }, priced).clearingObligation).toBe("N/A");
    expect(emirValuationRecord(ctx, { ...swap, cleared: true, clearingObligation: false }, priced).clearingObligation).toBe("N");
    expect(emirValuationRecord(ctx, { ...swap, cleared: false, clearingObligation: true }, priced).clearingObligation).toBe("Y");
    expect(emirValuationRecord(ctx, swap, priced, { clearingObligation: true }).clearingObligation).toBe("Y");
    expect(emirValuationRecord(ctx, { ...swap, clearingObligation: false }, priced, { clearingObligation: true }).clearingObligation).toBe("N");
    expect(validateTrade({ ...swap, clearingObligation: true })).toEqual([]);
  });
});

describe("Markt R3-1 / R3-2 / R3-3 – CCS CSA default, FRA index from the period, non-EUR vol surfaces", () => {
  it("makeCrossCurrencySwap defaults to the USD CSA so the fair spread reflects the quoted basis (≈ −22 bp); null = uncollateralised", () => {
    const ccs = makeCrossCurrencySwap({ pair: "EURUSD", domesticNotional: 1e7, fxSpot: ctx.fxSpots.EURUSD!, spread: -0.002, effectiveDate: spot, tenor: "5Y" });
    expect(ccs.collateralCurrency).toBe("USD");
    const fair = (priceTrade(ctx, ccs, "EUR").analytics.fairSpread as number) * 1e4;
    expect(fair).toBeLessThan(-20);
    expect(fair).toBeGreaterThan(-25);
    const noCsa = makeCrossCurrencySwap({
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: ctx.fxSpots.EURUSD!,
      spread: -0.002,
      effectiveDate: spot,
      tenor: "5Y",
      collateralCurrency: null,
    });
    expect(noCsa.collateralCurrency).toBeUndefined();
    expect(Math.abs((priceTrade(ctx, noCsa, "EUR").analytics.fairSpread as number) * 1e4)).toBeLessThan(1);
    expect(
      makeCrossCurrencySwap({ pair: "EURUSD", domesticNotional: 1e7, fxSpot: 1.16, spread: 0, effectiveDate: spot, tenor: "5Y", collateralCurrency: "EUR" })
        .collateralCurrency,
    ).toBe("EUR");
    // non-USD pair: the quote currency
    expect(
      makeCrossCurrencySwap({ pair: "EURJPY", domesticNotional: 1e7, fxSpot: 171.4, spread: 0, effectiveDate: spot, tenor: "5Y" }).collateralCurrency,
    ).toBe("JPY");
    expect(makeCrossCurrencySwap({ pair: "GBPUSD", domesticNotional: 1e7, fxSpot: 1.35, spread: 0, effectiveDate: spot, tenor: "5Y" }).collateralCurrency).toBe(
      "USD",
    );
  });
  it("makeFra derives the index tenor from the period (3x6 → EURIBOR-3M, 6x12 → EURIBOR-6M, 3x9 → 6M); explicit index wins", () => {
    const f36 = makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "3x6", rate: 0.02, valuationDate: VAL });
    expect(f36.index).toBe("EURIBOR-3M");
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "6x12", rate: 0.02, valuationDate: VAL }).index).toBe("EURIBOR-6M");
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "3x9", rate: 0.02, valuationDate: VAL }).index).toBe("EURIBOR-6M");
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "1x2", rate: 0.02, valuationDate: VAL }).index).toBe("EURIBOR-1M");
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "1x4", rate: 0.02, valuationDate: VAL, index: "EURIBOR-6M" }).index).toBe(
      "EURIBOR-6M",
    );
    // explicit dates: the period length decides as well; unknown tenor → currency default
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: f36.startDate, end: f36.endDate, rate: 0.02 }).index).toBe("EURIBOR-3M");
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "2x7", rate: 0.02, valuationDate: VAL }).index).toBe("EURIBOR-6M");
    expect(makeFra({ currency: "USD", notional: 1e7, payReceive: "Pay", start: "3x6", rate: 0.04, valuationDate: VAL }).index).toBe("SOFR");
    // the 3M FRA now projects a 3M forward: PV ≈ 0 at the 3M curve forward
    const fwd = priceTrade(ctx, f36, "EUR").analytics.forwardRate as number;
    expect(Math.abs(priceTrade(ctx, { ...f36, fixedRate: fwd }, "EUR").pv)).toBeLessThan(1e-6);
    expect(fwd).toBeGreaterThan(0.02);
    expect(fwd).toBeLessThan(0.023);
  });
  it("USD swaption / SOFR cap, GBP swaption and EURJPY / USDJPY / GBPUSD options price without fallback warnings and are Level 2", () => {
    const usdSpot = advance(VAL, "2D", getCalendar("US"));
    const trades: [Trade, string][] = [
      [makeSwaption({ currency: "USD", notional: 1e7, payerReceiver: "Payer", strike: 0.035, expiry: "2Y", tenor: "5Y", valuationDate: VAL }), "USD"],
      [makeCapFloor({ currency: "USD", notional: 1e7, capFloor: "Cap", strike: 0.04, effectiveDate: usdSpot, maturity: "5Y" }), "USD"],
      [makeSwaption({ currency: "GBP", notional: 1e7, payerReceiver: "Receiver", strike: 0.035, expiry: "1Y", tenor: "5Y", valuationDate: VAL }), "GBP"],
      [makeCapFloor({ currency: "GBP", notional: 1e7, capFloor: "Floor", strike: 0.03, effectiveDate: VAL, maturity: "3Y" }), "GBP"],
      [makeFxOption({ pair: "EURJPY", optionType: "Call", notional: 1e6, strike: 175, expiryDate: parseISO("2027-09-03") }), "JPY"],
      [makeFxOption({ pair: "USDJPY", optionType: "Put", notional: 1e6, strike: 145, expiryDate: parseISO("2027-03-03") }), "JPY"],
      [makeFxOption({ pair: "GBPUSD", optionType: "Call", notional: 1e6, strike: 1.35, expiryDate: parseISO("2027-03-03") }), "USD"],
    ];
    for (const [t, ccy] of trades) {
      const p = priceTrade(ctx, t, ccy);
      expect(p.warnings, t.id).toEqual([]);
      expect(p.pv, t.id).toBeGreaterThan(0);
      expect(ifrs13Level(ctx, t, p).level, t.id).toBe(2);
      const risk = computeRisk(ctx, t, ccy, { bucketed: false, theta: false });
      expect(Object.keys(risk.vega).length, t.id).toBeGreaterThan(0);
    }
    // the USD cap reads the USD-SOFR caplet surface, the USD swaption the USD cube
    expect(ctx.capletVols!["USD-SOFR"]!.index).toBe("SOFR");
    expect(ctx.swaptionVols!.USD!.currency).toBe("USD");
    expect(computeRisk(ctx, trades[1]![0], "USD", { bucketed: false, theta: false }).vega["caplet:USD-SOFR"]).toBeGreaterThan(0);
    expect(computeRisk(ctx, trades[0]![0], "USD", { bucketed: false, theta: false }).vega["swaption:USD"]).toBeGreaterThan(0);
    // CVA of a USD swap uses the USD cube (no fallback warning)
    const usdSwap = makeVanillaSwap({ currency: "USD", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.035, effectiveDate: usdSpot, maturity: "5Y" });
    expect(computeXva(ctx, usdSwap, { cptyHazard: 0.01, cptyRecovery: 0.4 }, "USD").warnings).toEqual([]);
  });
});

describe("UI R3-06 – human-facing report text is German prose without code identifiers", () => {
  // Proper nouns / abbreviations with internal capitals that are legitimate in German prose.
  const ALLOWED = /\b(MaRisk|MiFID|BaFin|DelVO|WpHG|BilMoG|EoD|PRIIPs|QuantLib|ModFol)\b/g;
  const CAMEL = /[a-z]+[A-Z][a-zA-Z]+/;
  const trades: Trade[] = [
    makeVanillaSwap({ id: "IRS", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" }),
    makeCapFloor({ id: "COLLAR", currency: "EUR", notional: 1e7, capFloor: "Collar", strike: 0.035, floorStrike: 0.015, effectiveDate: spot, maturity: "5Y" }),
    {
      ...makeCapFloor({ id: "CAPB", currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" }),
      model: "Black" as const,
    },
    makeSwaption({
      id: "SWPT",
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      strike: 0.03,
      expiry: "1Y",
      tenor: "5Y",
      valuationDate: VAL,
      settlement: "Cash",
    }),
    {
      ...makeSwaption({
        id: "SWPTI",
        currency: "EUR",
        notional: 1e7,
        payerReceiver: "Payer",
        strike: 0.03,
        expiry: "1Y",
        tenor: "5Y",
        valuationDate: VAL,
        settlement: "Cash",
      }),
      cashSettlementConvention: "IRR" as const,
    },
    makeFra({ id: "FRA", currency: "EUR", notional: 1e7, payReceive: "Pay", start: "3x6", rate: 0.02, valuationDate: VAL }),
    makeFxOption({ id: "FXO", pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") }),
    {
      ...makeFxOption({ id: "FXB", pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") }),
      barrier: { type: "UpOut" as const, level: 1.3, rebate: 0.01 },
    },
    {
      ...makeFxOption({ id: "FXD", pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") }),
      digital: { payoutCurrency: "USD", payout: 1e5 },
    },
    makeCrossCurrencySwap({
      id: "CCS",
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: ctx.fxSpots.EURUSD!,
      spread: -0.002,
      effectiveDate: spot,
      tenor: "5Y",
      mtmReset: true,
    }),
  ];
  it("methodology, IFRS-13 rationale and cost sign rule of every sample trade carry no camelCase tokens and no 'analytics.'", () => {
    for (const t of trades) {
      const pricing = priceTrade(ctx, t, "EUR");
      const risk = computeRisk(ctx, t, "EUR", { bucketed: false, theta: false });
      const xva = computeXva(ctx, t, { cptyHazard: 0.01, cptyRecovery: 0.4 }, "EUR");
      const rep = buildValuationReport(ctx, t, pricing, { transactionPrice: 10_000, risk, xva, generatedAt: "2026-09-03T17:00:00Z" });
      const text = [...rep.methodology, rep.fairValue.rationale, rep.costTransparency!.signRule].join("\n").replace(ALLOWED, "");
      const camel = text.match(new RegExp(CAMEL.source, "g")) ?? [];
      expect(camel, `${t.id}: ${camel.join(", ")}`).toEqual([]);
      expect(text).not.toContain("analytics.");
      for (const raw of [
        "fairValue",
        "marginBp",
        "marginPct",
        "deltaAmount",
        "deltaPct",
        "logLinear",
        "flatForward",
        "ShiftedBlack",
        "ModifiedFollowing",
        "ShortFront",
        "CollateralisedCashPrice",
        "DeltaNeutral",
        "UpOut",
        "Override-Vol",
      ]) {
        expect(text, `${t.id} contains ${raw}`).not.toContain(raw);
      }
    }
  });
});
