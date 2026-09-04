import { describe, expect, it } from "vitest";
import { SAMPLE_CURVE_IDS, SAMPLE_QUOTES, buildSampleMarket } from "../market/sample-market.js";
import { advance, getCalendar, isBusinessDay } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { quoteDates } from "../curves/bootstrap.js";
import { InterpolatedCurve } from "../curves/curve.js";
import { makeBasisSwap, makeCapFloor, makeFxForward, makeFxOption, makeImmSwap, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type CrossCurrencySwap, type FloatLeg, type ForwardRateAgreement, type InterestRateSwap } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { fxPairCalendar, fxSpotDate, pipFactor } from "../market/fx-spot.js";
import { normCdf } from "../math/normal.js";
import { priceTrade } from "./price.js";
import { priceInterestRateSwap } from "./swap-pricer.js";
import { computeRisk, computeTheta } from "../risk/sensitivities.js";
import { applyScenario, irVolShiftFor } from "../risk/scenarios.js";
import { computeXva, cvaGeneric, cvaSwap } from "../xva/cva.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const TARGET = getCalendar("TARGET");
const spot = advance(VAL, "2D", TARGET); // 2026-09-07
const credit = { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 };

describe("K1 – cap/floor model selection", () => {
  const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.025, effectiveDate: spot, maturity: "5Y" });
  it("an explicit model is respected and the default for a normal surface is Bachelier", () => {
    expect(priceTrade(ctx, cap, "EUR").analytics.model).toBe("Bachelier");
    expect(priceTrade(ctx, { ...cap, model: "Bachelier" }, "EUR").analytics.model).toBe("Bachelier");
    expect(priceTrade(ctx, { ...cap, model: "Black", volOverride: 0.3 }, "EUR").analytics.model).toBe("Black");
    expect(priceTrade(ctx, { ...cap, model: "ShiftedBlack", shift: 0.03, volOverride: 0.15 }, "EUR").analytics.model).toBe("ShiftedBlack");
    expect(priceTrade(ctx, { ...cap, model: "Bachelier" }, "EUR").pv).toBeCloseTo(priceTrade(ctx, cap, "EUR").pv, 6);
  });
  it("ShiftedBlack with a 3% shift prices differently from Black at the same vol", () => {
    const black = priceTrade(ctx, { ...cap, model: "Black", volOverride: 0.2 }, "EUR").pv;
    const shifted = priceTrade(ctx, { ...cap, model: "ShiftedBlack", shift: 0.03, volOverride: 0.2 }, "EUR").pv;
    expect(shifted).not.toBeCloseTo(black, 0);
    expect(shifted).toBeGreaterThan(black); // larger effective normal vol with the shift
  });
  it("N11: a lognormal model with a non-positive shifted strike warns instead of silently dropping time value", () => {
    const r = priceTrade(ctx, { ...cap, strike: -0.005, model: "Black", volOverride: 0.2 }, "EUR");
    expect(r.warnings.some((w) => w.startsWith("NEGATIVE_RATE_LOGNORMAL"))).toBe(true);
  });
  it("N12: analytics expose delta / gamma in explicit units", () => {
    const a = priceTrade(ctx, cap, "EUR").analytics;
    expect(a.deltaPerBp).toBeCloseTo((a.delta as number) * 1e-4, 10);
    expect(a.gammaPerBp2).toBeCloseTo((a.gamma as number) * 1e-8, 12);
    const sw = priceTrade(
      ctx,
      makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "2Y", tenor: "5Y", valuationDate: VAL }),
      "EUR",
    ).analytics;
    expect(sw.deltaPerBp).toBeCloseTo((sw.delta as number) * 1e-4, 10);
  });
});

describe("H1 / N-A – missing fixings", () => {
  it("a seasoned swap without fixings uses the same-tenor forward from today (within 10bp of the 6M forward) and warns with a MISSING_FIXING code", () => {
    const seasoned = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.03,
      effectiveDate: parseISO("2021-03-16"),
      maturity: "10Y",
    });
    // The sample market carries EURIBOR history since Markt R6-6 – strip it to exercise the missing-fixing path.
    const noFixings: MarketContext = { ...ctx, fixings: [] };
    const res = priceInterestRateSwap(noFixings, seasoned, "EUR");
    const current = res.legs[1]!.cashflows.find((c) => c.accrualStart! <= VAL && c.accrualEnd! > VAL)!;
    const fwd6m = ctx.curves[SAMPLE_CURVE_IDS.eur6m]!.forwardRate(spot, advance(spot, "6M", TARGET), "ACT/360");
    expect(Math.abs(current.rate! - fwd6m)).toBeLessThan(0.001);
    expect(current.rate!).toBeGreaterThan(0.015); // the old fallback produced 0.14%
    expect(current.isFixed).toBe(false);
    expect(res.warnings.some((w) => w.startsWith("MISSING_FIXING:"))).toBe(true);
    // the coupon paying next is of the right order of magnitude (≈ −N·2.2%·0.5)
    expect(Math.abs(current.amount)).toBeGreaterThan(90_000);
    // policy "throw" fails loudly
    expect(() => priceInterestRateSwap({ ...noFixings, missingFixingPolicy: "throw" }, seasoned, "EUR")).toThrow(/MISSING_FIXING/);
  });
  it("a spot-starting OIS with a 5-day lookback has no spurious warning and its first coupon stays within 0.5bp of the plain OIS", () => {
    const ois = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.021,
      effectiveDate: spot,
      maturity: "2Y",
      index: "ESTR",
    });
    const lb: InterestRateSwap = { ...ois, legs: ois.legs.map((l) => (l.type === "Float" ? ({ ...l, lookbackDays: 5 } as FloatLeg) : l)) };
    const plain = priceTrade(ctx, ois, "EUR");
    const withLb = priceTrade(ctx, lb, "EUR");
    expect(withLb.warnings).toEqual([]);
    expect(Math.abs(withLb.legs[1]!.cashflows[0]!.rate! - plain.legs[1]!.cashflows[0]!.rate!)).toBeLessThan(0.5e-4);
    expect(withLb.legs[1]!.cashflows[0]!.isFixed).toBe(false);
  });
  it("a running OIS without fixings does not realise days at 0% (rate stays near the curve) and warns once", () => {
    const running = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.021,
      effectiveDate: parseISO("2026-03-16"),
      maturity: "3Y",
      index: "ESTR",
    });
    const res = priceTrade({ ...ctx, fixings: [] }, running, "EUR");
    const current = res.legs[1]!.cashflows.find((c) => c.accrualStart! <= VAL && c.accrualEnd! > VAL)!;
    expect(current.rate!).toBeGreaterThan(0.018);
    expect(current.rate!).toBeLessThan(0.023);
    expect(res.warnings.filter((w) => w.startsWith("MISSING_FIXING:"))).toHaveLength(1);
  });
  it("curve forwards for periods starting before the reference date use the first forward, not df = 1", () => {
    const c = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    const fwdPast = c.forwardRate(VAL - 30, VAL - 1, "ACT/360");
    const fwdFirst = c.forwardRate(VAL, VAL + 7, "ACT/360");
    expect(fwdPast).toBeCloseTo(fwdFirst, 4);
    expect(c.df(VAL - 30)).toBe(1); // the discount-factor contract is unchanged
  });
  it("M14: accrued interest of a running OIS is the realised compounding to date", () => {
    const start = parseISO("2026-06-15");
    const fixings: { index: string; date: number; value: number }[] = [];
    let compounded = 1;
    for (let d = start; d < VAL; d++) {
      if (!isBusinessDay(d, TARGET)) continue;
      let next = d + 1;
      while (!isBusinessDay(next, TARGET)) next++;
      const r = 0.02 + 0.00001 * (d - start);
      fixings.push({ index: "ESTR", date: d, value: r });
      compounded *= 1 + (r * (Math.min(next, VAL) - d)) / 360;
    }
    const ois = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.02,
      effectiveDate: start,
      maturity: "2Y",
      index: "ESTR",
    });
    const res = priceInterestRateSwap({ ...ctx, fixings }, ois, "EUR");
    const floatCf = res.legs[1]!.cashflows.find((c) => c.accrualStart! <= VAL && c.accrualEnd! > VAL)!;
    expect(floatCf.accrued).toBeCloseTo(-1e7 * (compounded - 1), 6); // we pay the float leg
    expect(res.warnings).toEqual([]);
  });
});

describe("H4 – ACT/ACT ICMA on a leg", () => {
  it("semi-annual fixed leg with ACT/ACT ICMA accrues exactly 0.5 per regular period", () => {
    const swap = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.03,
      effectiveDate: spot,
      maturity: "5Y",
      fixedFrequency: "6M",
    });
    swap.legs[0]!.dayCount = "ACT/ACT ICMA";
    const res = priceInterestRateSwap(ctx, swap, "EUR");
    const fixedCfs = res.legs[0]!.cashflows;
    expect(fixedCfs).toHaveLength(10);
    for (const cf of fixedCfs) expect(cf.accrualFactor).toBe(0.5);
    // a 3M front stub on the same leg accrues ≈ 0.25
    const stubbed = { ...swap, legs: swap.legs.map((l) => ({ ...l, effectiveDate: advance(spot, "3M", TARGET) })) };
    const stubCf = priceInterestRateSwap(ctx, stubbed, "EUR").legs[0]!.cashflows[0]!;
    expect(stubCf.accrualFactor!).toBeGreaterThan(0.23);
    expect(stubCf.accrualFactor!).toBeLessThan(0.27);
  });
});

describe("H5 / M5 / M10 / N9 – FX spot date, forward anchoring, delta sign, delivery dates, pips", () => {
  it("the EURUSD spot date is T+2 on the joint TARGET+US calendar (Labor Day 2026-09-07 → 2026-09-08)", () => {
    const sd = fxSpotDate(ctx, "EUR", "USD");
    expect(toISO(sd)).toBe("2026-09-08");
    expect(isBusinessDay(sd, fxPairCalendar("EUR", "USD"))).toBe(true);
  });
  it("a forward delivering on the spot date at the spot rate has PV 0 (± 1e-6) and exposes spotDate", () => {
    const sd = fxSpotDate(ctx, "EUR", "USD");
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: 1e7, rate: ctx.fxSpots.EURUSD!, deliveryDate: sd });
    const res = priceTrade(ctx, fwd, "USD");
    expect(Math.abs(res.pv)).toBeLessThan(1e-6);
    expect(res.details?.spotDate).toBe(toISO(sd));
    expect(res.analytics.spotDate).toBeUndefined(); // dates live in `details` (ISO), never as serials in analytics
    expect(res.analytics.fairForward).toBeCloseTo(ctx.fxSpots.EURUSD!, 12);
    expect(Math.abs(priceTrade(ctx, fwd, "EUR").pv)).toBeLessThan(1e-6);
    // delivering on the IR spot (7th) is not the FX spot date → non-zero PV of the order of the 1-day carry
    const wrong = makeFxForward({ pair: "EURUSD", baseAmount: 1e7, rate: ctx.fxSpots.EURUSD!, deliveryDate: spot });
    expect(Math.abs(priceTrade(ctx, wrong, "USD").pv)).toBeGreaterThan(100);
  });
  it("the 1Y fair forward is spot-anchored (≈ 1.17700 rather than the unanchored 1.17725)", () => {
    const res = priceTrade(ctx, makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.2, deliveryDate: parseISO("2027-09-07") }), "USD");
    const fair = res.analytics.fairForward as number;
    expect(fair).toBeCloseTo(1.177, 4);
    const dB = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    const dQ = ctx.curves[SAMPLE_CURVE_IDS.usdSofr]!;
    const unanchored = (1.1625 * dB.df(parseISO("2027-09-07"))) / dQ.df(parseISO("2027-09-07"));
    expect(Math.abs(unanchored - fair) * 1e4).toBeGreaterThan(1); // more than a pip apart
    // option and forward use the same forward
    const opt = priceTrade(
      ctx,
      makeFxOption({
        pair: "EURUSD",
        optionType: "Call",
        notional: 1e6,
        strike: 1.18,
        expiryDate: parseISO("2027-09-03"),
        deliveryDate: parseISO("2027-09-07"),
      }),
      "USD",
    );
    expect(opt.analytics.forward).toBeCloseTo(fair, 10);
    expect(opt.details?.spotDate).toBe(toISO(fxSpotDate(ctx, "EUR", "USD")));
  });
  it("M5: fxDelta is positive when we are long the foreign currency and negative when short, whichever leg it is", () => {
    const buy = priceTrade(ctx, makeFxForward({ pair: "EURUSD", baseAmount: 1e7, rate: 1.1625, deliveryDate: parseISO("2027-09-07") }), "USD");
    const sell = priceTrade(ctx, makeFxForward({ pair: "EURUSD", baseAmount: -1e7, rate: 1.1625, deliveryDate: parseISO("2027-09-07") }), "USD");
    expect(buy.analytics.fxDelta as number).toBeGreaterThan(100_000);
    expect(sell.analytics.fxDelta as number).toBeLessThan(-100_000);
    expect(buy.analytics.fxDeltaCurrency).toBe("EUR");
    expect(sell.analytics.fxDeltaCurrency).toBe("EUR");
    // consistent with the bump-and-reprice FX delta of the risk engine
    const risk = computeRisk(ctx, makeFxForward({ pair: "EURUSD", baseAmount: -1e7, rate: 1.1625, deliveryDate: parseISO("2027-09-07") }), "USD", {
      bucketed: false,
      vega: false,
      theta: false,
    });
    expect(risk.fxDelta.EURUSD).toBeCloseTo(sell.analytics.fxDelta as number, -1);
    // third reporting currency: both deltas reported
    const inGbp = priceTrade(ctx, makeFxForward({ pair: "EURUSD", baseAmount: 1e7, rate: 1.1625, deliveryDate: parseISO("2027-09-07") }), "GBP");
    expect(inGbp.analytics.fxDeltaSellCurrency).toBeDefined();
    expect(inGbp.analytics.fxDeltaSellCurrency as number).toBeLessThan(0);
  });
  it("M10: the default option delivery date is the spot date of the expiry on the pair calendar (never a weekend)", () => {
    const opt = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") }); // Friday
    expect(isBusinessDay(opt.deliveryDate, fxPairCalendar("EUR", "USD"))).toBe(true);
    expect(opt.deliveryDate).toBeGreaterThanOrEqual(parseISO("2027-09-07"));
    expect(toISO(opt.deliveryDate)).toBe("2027-09-08"); // Labor Day 2027-09-06 skipped
  });
  it("N9: pip factor is 100 for JPY-style quotes and 10,000 otherwise", () => {
    expect(pipFactor("EUR", "USD")).toBe(10_000);
    expect(pipFactor("USD", "JPY")).toBe(100);
    expect(pipFactor("EUR", "HUF")).toBe(100);
  });
});

describe("H2 / M6 – digitals and exotic Greeks in the pricer", () => {
  const exp = parseISO("2027-09-03");
  const vanilla = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: exp });
  it("a digital paying 1m EUR is valued as S·e^{-rf T}·N(d1)·payout, not as a USD digital converted at spot", () => {
    const quoteDig = { ...vanilla, digital: { payoutCurrency: "USD", payout: 1e6 } };
    const baseDig = { ...vanilla, digital: { payoutCurrency: "EUR", payout: 1e6 } };
    const rq = priceTrade(ctx, quoteDig, "USD");
    const rb = priceTrade(ctx, baseDig, "USD");
    const rd = rq.analytics.rd as number;
    const rf = rq.analytics.rf as number;
    const spotRate = rq.analytics.spot as number;
    const tDel = yearFraction(VAL, vanilla.deliveryDate, "ACT/365F");
    expect(rb.pv).toBeCloseTo(spotRate * Math.exp(-rf * tDel) * normCdf(rq.analytics.d1 as number) * 1e6, 4);
    expect(rq.pv).toBeCloseTo(Math.exp(-rd * tDel) * normCdf(rq.analytics.d2 as number) * 1e6, 4);
    expect(Math.abs(rq.pv * spotRate - rb.pv) / rb.pv).toBeGreaterThan(0.05);
    // decomposition: vanilla = asset-or-nothing − K × cash-or-nothing
    expect(rb.pv - 1.18 * rq.pv).toBeCloseTo(priceTrade(ctx, vanilla, "USD").pv, 4);
    expect(rb.analytics.kind).toContain("base payout");
  });
  it("Greeks of digital and barrier are finite differences of their own formulas, not the vanilla's", () => {
    const v = priceTrade(ctx, vanilla, "USD").analytics;
    const dig = priceTrade(ctx, { ...vanilla, digital: { payoutCurrency: "USD", payout: 1e6 } }, "USD").analytics;
    const bar = priceTrade(ctx, { ...vanilla, barrier: { type: "UpOut", level: 1.25 } }, "USD").analytics;
    expect(dig.greeksMethod).toBe("finite-difference");
    expect(bar.greeksMethod).toBe("finite-difference");
    expect(v.greeksMethod).toBe("analytic");
    expect(dig.vega).not.toBeCloseTo(v.vega as number, 0);
    expect(dig.deltaBase).not.toBeCloseTo(v.deltaBase as number, 0);
    expect(bar.vega as number).toBeLessThan(v.vega as number);
    expect(Number.isFinite(dig.gamma as number)).toBe(true);
    expect(Number.isFinite(bar.thetaPerDay as number)).toBe(true);
  });
  it("N10: FX vega is only reported for the option's own pair (including the inverted quotation)", () => {
    const eurgbp = makeFxOption({ pair: "EURGBP", optionType: "Call", notional: 1e6, strike: 0.87, expiryDate: exp });
    const risk = computeRisk(ctx, eurgbp, "GBP", { bucketed: false, theta: false });
    expect(Object.keys(risk.vega)).toEqual(["fx:EURGBP"]);
    expect(risk.vega["fx:EURGBP"]).toBeGreaterThan(0);
    const gbpeur = { ...eurgbp, pair: "GBPEUR", strike: 1 / 0.87 };
    expect(Object.keys(computeRisk(ctx, gbpeur, "EUR", { bucketed: false, theta: false }).vega)).toEqual(["fx:EURGBP"]);
  });
});

describe("H6 – carry-consistent theta", () => {
  it("a swap with a coupon paying tomorrow has |theta| below 1% of the coupon and the decomposition adds up", () => {
    const fixings = [{ index: "EURIBOR-6M", date: parseISO("2026-03-02"), value: 0.021 }];
    const c2: MarketContext = { ...ctx, fixings };
    const recv = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.03,
      effectiveDate: parseISO("2025-09-04"),
      maturity: "10Y",
    });
    const res = priceInterestRateSwap(c2, recv, "EUR");
    const tomorrow = res.legs.flatMap((l) => l.cashflows).filter((c) => c.paymentDate === VAL + 1);
    expect(tomorrow.map((c) => Math.round(c.amount))).toEqual([300_000, -107_333]);
    const risk = computeRisk(c2, recv, "EUR", { bucketed: false, vega: false });
    expect(Math.abs(risk.theta)).toBeLessThan(0.01 * 300_000);
    expect(risk.thetaDetail!.cashflows).toBeCloseTo(300_000 - 107_333.33333333333, 6);
    expect(risk.thetaDetail!.total).toBeCloseTo(risk.thetaDetail!.carry + risk.thetaDetail!.rollDown, 8);
    expect(risk.thetaDetail!.total).toBe(risk.theta);
    // computed directly
    const t = computeTheta(c2, recv, "EUR");
    expect(t.total).toBeCloseTo(risk.theta, 8);
  });
  it("without cashflows in the window the theta equals the plain PV roll", () => {
    const s = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.031, effectiveDate: spot, maturity: "10Y" });
    const risk = computeRisk(ctx, s, "EUR", { bucketed: false, vega: false });
    expect(risk.thetaDetail!.cashflows).toBe(0);
    expect(Math.abs(risk.theta)).toBeLessThan(1000);
    // forward roll of a curve reproduces today's forward discount factors
    const c = ctx.curves[SAMPLE_CURVE_IDS.eurOis]! as InterpolatedCurve;
    const rolled = c.forwardRolledTo(VAL + 30);
    const d = VAL + 3650;
    expect(rolled.df(d) * c.df(VAL + 30)).toBeCloseTo(c.df(d), 12);
  });
});

describe("M2 – IMM swaps", () => {
  it("'1Y' from an IMM start is twelve months and coupons roll on IMM dates", () => {
    const oneYear = makeImmSwap({ currency: "EUR", notional: 1e6, payReceiveFixed: "Pay", fixedRate: 0.02, from: parseISO("2027-03-16"), tenor: "1Y" });
    expect(toISO(oneYear.legs[0]!.effectiveDate)).toBe("2027-03-17");
    expect(toISO(oneYear.legs[0]!.terminationDate)).toBe("2028-03-15");
    const imm = makeImmSwap({ currency: "EUR", notional: 1e6, payReceiveFixed: "Pay", fixedRate: 0.025, from: VAL, tenor: "2Y", floatFrequency: "3M" });
    const res = priceTrade(ctx, imm, "EUR");
    expect(res.legs[1]!.cashflows.map((c) => toISO(c.accrualEnd!))).toEqual([
      "2026-12-16",
      "2027-03-17",
      "2027-06-16",
      "2027-09-15",
      "2027-12-15",
      "2028-03-15",
      "2028-06-21",
      "2028-09-20",
    ]);
    expect(imm.legs.every((l) => l.roll === "IMM")).toBe(true);
  });
});

describe("M3 – curve extrapolation", () => {
  it("beyond the last pillar the instantaneous forward stays constant (no jump to the zero rate)", () => {
    const c = ctx.curves[SAMPLE_CURVE_IDS.eurOis]! as InterpolatedCurve;
    const last = c.nodeDates[c.nodeDates.length - 1]!;
    const tLast = c.time(last);
    const before = c.forwardAtTimes(tLast - 1, tLast);
    const after = c.forwardAtTimes(tLast, tLast + 1);
    const farther = c.forwardAtTimes(tLast + 5, tLast + 6);
    expect(after).toBeCloseTo(before, 6);
    expect(farther).toBeCloseTo(before, 6);
    expect(c.extrapolation).toBe("flatForward");
    // flat-zero extrapolation (previous behaviour) is available as an option and does jump
    const flatZero = new InterpolatedCurve({ id: "z", currency: "EUR", referenceDate: VAL, nodes: c.nodes(), extrapolation: "flatZero" });
    expect(Math.abs(flatZero.forwardAtTimes(tLast, tLast + 1) - before)).toBeGreaterThan(0.002);
    expect(flatZero.zeroRate(last + 3650)).toBeCloseTo(flatZero.zeroRate(last), 10);
  });
});

describe("M4 / M16 – scenarios", () => {
  it("two shifts on the same curve accumulate ('*' +100bp then EUR-ESTR +50bp = +150bp)", () => {
    const sc = applyScenario(ctx, {
      id: "x",
      name: "x",
      curveShifts: [
        { target: "*", parallelBp: 100 },
        { target: "EUR-ESTR", parallelBp: 50 },
      ],
    });
    const d = VAL + 365 * 5;
    expect((sc.curves["EUR-ESTR"]!.zeroRate(d) - ctx.curves["EUR-ESTR"]!.zeroRate(d)) * 1e4).toBeCloseTo(150, 8);
    expect((sc.curves["EUR-EURIBOR-6M"]!.zeroRate(d) - ctx.curves["EUR-EURIBOR-6M"]!.zeroRate(d)) * 1e4).toBeCloseTo(100, 8);
  });
  it("IR vol shifts carry explicit units per surface type", () => {
    expect(irVolShiftFor({ id: "a", name: "a", irVolShiftBp: 20 }, "Normal")).toBeCloseTo(0.002, 12);
    expect(irVolShiftFor({ id: "a", name: "a", irVolShiftBp: 20 }, "Lognormal")).toBeCloseTo(0.002 / 0.03, 12); // ≈ 6.7 vol points, not 20
    expect(irVolShiftFor({ id: "a", name: "a", irVolShift: { lognormalPts: 5 } }, "ShiftedLognormal")).toBeCloseTo(0.05, 12);
    expect(irVolShiftFor({ id: "a", name: "a", irVolShift: { lognormalPts: 5, referenceRate: 0.02 } }, "Normal")).toBeCloseTo(0.001, 12);
  });
});

describe("M8 – FRA fixings", () => {
  const cal = TARGET;
  const start6 = advance(spot, "6M", cal, "ModifiedFollowing", true);
  it("a published fixing replaces the curve forward; a missing published fixing warns", () => {
    const fra: ForwardRateAgreement = {
      id: "fra",
      type: "FRA",
      payReceive: "Pay",
      notional: 1e7,
      currency: "EUR",
      index: "EURIBOR-6M",
      startDate: spot,
      endDate: start6,
      fixedRate: 0.02,
    };
    const withFix = priceTrade({ ...ctx, fixings: [{ index: "EURIBOR-6M", date: VAL, value: 0.05 }] }, fra, "EUR");
    expect(withFix.analytics.forwardRate).toBe(0.05);
    expect(withFix.analytics.isFixed).toBe("yes");
    expect(withFix.legs[0]!.cashflows[0]!.fixingDate).toBe(VAL);
    expect(withFix.pv).toBeGreaterThan(100_000); // pay 2%, receive 5% on 10m for 6M
    // fixing date yesterday (start tomorrow), nothing loaded → warning, curve forward used
    const tomorrowStart: ForwardRateAgreement = { ...fra, startDate: VAL + 1, endDate: advance(VAL + 1, "6M", cal) };
    const missing = priceTrade({ ...ctx, fixings: [] }, tomorrowStart, "EUR");
    expect(missing.warnings.some((w) => w.startsWith("MISSING_FIXING:"))).toBe(true);
    // …and with the sample market's EURIBOR history (Markt R6-6) yesterday's fixing is found
    const found = priceTrade(ctx, tomorrowStart, "EUR");
    expect(found.warnings.some((w) => w.startsWith("MISSING_FIXING:"))).toBe(false);
    expect(found.analytics.isFixed).toBe("yes");
    expect(missing.analytics.isFixed).toBe("no");
  });
});

describe("M12 – bootstrap pillars", () => {
  it("OIS pillars sit on the last payment date and every OIS quote reprices on the final curve to < 1e-6 bp", () => {
    const q1y = quoteDates(VAL, { currency: "EUR", index: "ESTR" }, { type: "OIS", tenor: "1Y", rate: 0.021 });
    const sw1y = makeVanillaSwap({
      currency: "EUR",
      notional: 1e8,
      payReceiveFixed: "Receive",
      fixedRate: 0.021,
      effectiveDate: spot,
      maturity: "1Y",
      index: "ESTR",
      fixedFrequency: "ZC",
      floatFrequency: "ZC",
    });
    expect(priceInterestRateSwap(ctx, sw1y, "EUR").legs[0]!.cashflows.at(-1)!.paymentDate).toBe(q1y.end);
    expect(ctx.curves[SAMPLE_CURVE_IDS.eurOis]!.nodeDates).toContain(q1y.end);
    for (const q of SAMPLE_QUOTES.eurOis) {
      if (q.type !== "OIS") continue;
      const years = yearFraction(spot, advance(spot, q.tenor, TARGET), "ACT/365F");
      const zc = years <= 1.01 ? "ZC" : undefined;
      const sw = makeVanillaSwap({
        currency: "EUR",
        notional: 1e8,
        payReceiveFixed: "Receive",
        fixedRate: q.rate,
        effectiveDate: spot,
        maturity: q.tenor,
        index: "ESTR",
        fixedFrequency: zc,
        floatFrequency: zc,
      });
      const par = priceInterestRateSwap(ctx, sw, "EUR").analytics.parRate as number;
      expect(Math.abs(par - q.rate) * 1e4).toBeLessThan(1e-6);
    }
  });
});

describe("M9 / N-B – CVA", () => {
  const payer = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.0288, effectiveDate: spot, maturity: "10Y" });
  it("the exposure profile ends at maturity and the marginal PDs sum to 1 − e^{−λT}", () => {
    const x = cvaSwap(ctx, payer, credit, "EUR");
    const last = x.profile[x.profile.length - 1]!;
    expect(last.date).toBe(payer.legs[0]!.terminationDate);
    expect(last.epe).toBe(0);
    const T = yearFraction(VAL, last.date, "ACT/365F");
    expect(x.profile.reduce((s, p) => s + p.pdCpty, 0)).toBeCloseTo(1 - Math.exp(-0.02 * T), 10);
    expect(x.method).toContain("smile vol");
  });
  it("generic delta-normal CVA of a vanilla swap is within ±25% of the swaption replication", () => {
    const sb = cvaSwap(ctx, payer, credit, "EUR");
    const gen = cvaGeneric(ctx, payer, credit, "EUR");
    expect(Math.abs(gen.cva / sb.cva - 1)).toBeLessThan(0.25);
    expect(Math.abs(gen.dva / sb.dva - 1)).toBeLessThan(0.35);
  });
  it("basis swaps use the basis-swaption replication with a documented conservative spread vol", () => {
    const basis = makeBasisSwap({
      currency: "EUR",
      notional: 1e7,
      effectiveDate: spot,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0.0009,
    });
    const x = computeXva(ctx, basis, credit, "EUR");
    expect(x.method).toContain("Basis-swaption");
    expect(x.cva).toBeGreaterThan(0);
    expect(x.dva).toBeGreaterThan(0);
    expect(x.cva).toBeLessThan(5_000); // a few hundred bp of spread vol on 10m, not swap-sized
    expect(x.warnings.some((w) => w.startsWith("BASIS_SPREAD_VOL_ASSUMED"))).toBe(true);
    const explicit = computeXva(ctx, basis, { ...credit, basisSpreadVol: 0.0005 }, "EUR");
    expect(explicit.warnings.some((w) => w.startsWith("BASIS_SPREAD_VOL_ASSUMED"))).toBe(false);
    expect(explicit.cva).toBeLessThan(x.cva);
  });
});

describe("M13 / N-E / N13 – conventions", () => {
  it("cash-settled swaptions under the CCP convention carry no permanent convention warning", () => {
    const sw = makeSwaption({
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Receiver",
      strike: 0.03,
      expiry: "5Y",
      tenor: "10Y",
      valuationDate: VAL,
      settlement: "Cash",
    });
    const r = priceTrade(ctx, sw, "EUR");
    expect(r.warnings).toEqual([]);
    expect(r.analytics.settlement).toBe("Cash (CollateralisedCashPrice)");
  });
  it("N13: a notional exchange on the valuation date counts as settled, like coupons", () => {
    const mat = advance(VAL, "5Y", getCalendar("TARGET+US"));
    const ccs: CrossCurrencySwap = {
      id: "ccs0",
      type: "CrossCurrencySwap",
      legs: [
        {
          type: "Float",
          payReceive: "Receive",
          notional: 1e7,
          currency: "EUR",
          effectiveDate: VAL,
          terminationDate: mat,
          frequency: "3M",
          dayCount: "ACT/360",
          calendar: "TARGET+US",
          index: "EURIBOR-3M",
        },
        {
          type: "Float",
          payReceive: "Pay",
          notional: 1e7 * 1.1625,
          currency: "USD",
          effectiveDate: VAL,
          terminationDate: mat,
          frequency: "3M",
          dayCount: "ACT/360",
          calendar: "TARGET+US",
          index: "SOFR",
        },
      ],
    };
    const r = priceTrade(ctx, ccs, "EUR");
    expect(r.legs[0]!.cashflows.filter((c) => c.kind === "Notional")).toHaveLength(1);
  });
});
