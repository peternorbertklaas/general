import { describe, expect, it } from "vitest";
import { bootstrapCurves, bumpQuote } from "../curves/bootstrap.js";
import { addBusinessDays, adjust, advance, businessDaysBetween, getCalendar, isBusinessDay } from "../dates/calendar.js";
import { addDays, addMonths, addTenor as addTenorCal, assertSerialDate, isSerialDate, parseISO, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule } from "../dates/schedule.js";
import { PricingError } from "../errors.js";
import { makeBasisSwap, makeFra, makeFxSwap, makeVanillaSwap } from "../instruments/builders.js";
import { xvaMethodLabelDe } from "../instruments/labels.js";
import { type FloatLeg, type InterestRateSwap } from "../instruments/types.js";
import { type Fixing, type MarketContext, getCurve, getDiscountCurve, withCurves } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, buildSampleMarket, sampleBootstrapSpecs } from "../market/sample-market.js";
import { bachelier } from "../models/black.js";
import { swaptionVol } from "../models/vol-surfaces.js";
import { methodologyFor } from "../reporting/valuation-report.js";
import { PAR_RISK_SPEC_TOLERANCE, checkParRiskSpecs, computeRisk, parRisk, parRiskPortfolio } from "../risk/sensitivities.js";
import { CVA_SWAP_GRID_MAX_STEPS, computeXva, swapExposureGrid } from "../xva/cva.js";
import { legAccrued, priceLeg, projectFloatingRate } from "./leg-pricer.js";
import { priceTrade } from "./price.js";
import { priceInterestRateSwap } from "./swap-pricer.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const credit = { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 };
const LGD = 1 - credit.cptyRecovery;
const sifma = getCalendar("US-SIFMA");
const usdCurve = getCurve(ctx, SAMPLE_CURVE_IDS.usdSofr);

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `other:${String(e)}`;
  }
};

/** Reviewer's synthetic SOFR fixings: 4.00 % + 0.02 %·((d − start) mod 7) on the SIFMA publication days around a period. */
const fixingsFor = (start: number, end: number): Fixing[] => {
  const out: Fixing[] = [];
  for (let d = start - 15; d <= end; d++)
    if (isBusinessDay(d, sifma)) out.push({ index: "SOFR", date: d, value: 0.04 + 0.0002 * ((((d - start) % 7) + 7) % 7) });
  return out;
};
const sofrLeg = (start: number, end: number, extra: Partial<FloatLeg> = {}): FloatLeg => ({
  type: "Float",
  payReceive: "Receive",
  notional: 1e7,
  currency: "USD",
  effectiveDate: start,
  terminationDate: end,
  frequency: "3M",
  dayCount: "ACT/360",
  calendar: "US",
  index: "SOFR",
  ...extra,
});
const singlePeriod = (l: FloatLeg) => buildSchedule({ ...l, businessDayConvention: "Unadjusted", stub: "ShortFront", paymentLag: 0 }).periods[0]!;
const realisedRate = (start: number, end: number, extra: Partial<FloatLeg>): number => {
  const market: MarketContext = { ...ctx, fixings: fixingsFor(start, end) };
  const l = sofrLeg(start, end, extra);
  const proj = projectFloatingRate(market, l, singlePeriod(l), usdCurve);
  expect(proj.isFixed).toBe(true);
  return proj.rate;
};
/** ISDA 2021 manual compounding with lookback n (fixing of d = obs(inEffect(d))) and optional observation shift. */
const isdaRate = (start: number, end: number, lookback: number, shift: boolean, fix: (d: number) => number): number => {
  const inEffect = (x: number) => (isBusinessDay(x, sifma) ? x : addBusinessDays(x, -1, sifma));
  const obs = (x: number) => (lookback > 0 ? addBusinessDays(x, -lookback, sifma) : x);
  let acc = 1;
  for (let d = start; d < end;) {
    const stop = Math.min(addBusinessDays(d, 1, sifma), end);
    const od = obs(inEffect(d));
    const tau = shift ? yearFraction(od, obs(stop), "ACT/360") : yearFraction(d, stop, "ACT/360");
    acc *= 1 + fix(od) * tau;
    d = stop;
  }
  const divisor = shift ? yearFraction(obs(inEffect(start)), obs(end), "ACT/360") : yearFraction(start, end, "ACT/360");
  return (acc - 1) / divisor;
};

// ---------------------------------------------------------------------------
// N10-1 – observation shift: weights AND divisor from the observation period
// ---------------------------------------------------------------------------
describe("N10-1 – observationShift divides the observation-period factor by the observation days (ISDA 2021 / QuantLib applyObservationShift)", () => {
  const start = parseISO("2026-05-01");
  const end = parseISO("2026-06-01");
  const fix = (d: number) => 0.04 + 0.0002 * ((((d - start) % 7) + 7) % 7);

  it("SOFR 01.05.–01.06.2026, lookback 5 + shift: 4.057399 % = ISDA manual = QuantLib (engine gave 3.664747 % = 28/31 of it); without shift 4.060788 %", () => {
    const shifted = realisedRate(start, end, { lookbackDays: 5, observationShift: true });
    expect(shifted).toBeCloseTo(0.040573988, 9); // QuantLib 4.05739880 %
    expect(shifted).toBeCloseTo(isdaRate(start, end, 5, true, fix), 14);
    // the round-9 engine divided by the 31 accrual days instead of the 28 observation days
    expect(toISO(addBusinessDays(start, -5, sifma))).toBe("2026-04-24");
    expect(toISO(addBusinessDays(end, -5, sifma))).toBe("2026-05-22");
    expect((shifted * 28) / 31).toBeCloseTo(0.03664747, 8); // reviewer: engine 3.664747 %
    const plain = realisedRate(start, end, { lookbackDays: 5 });
    expect(plain).toBeCloseTo(0.04060788, 9); // QuantLib lookback 5 without shift
    expect(plain).toBeCloseTo(isdaRate(start, end, 5, false, fix), 14);
    // equal-length periods are unchanged (reviewer: 02.03.–02.06.2026 bit-identical before and after)
    const qs = parseISO("2026-03-02");
    const qe = parseISO("2026-06-02");
    const fixQ = (d: number) => 0.04 + 0.0002 * ((((d - qs) % 7) + 7) % 7);
    expect(realisedRate(qs, qe, { lookbackDays: 5, observationShift: true })).toBeCloseTo(isdaRate(qs, qe, 5, true, fixQ), 14);
    expect(realisedRate(qs, qe, { lookbackDays: 5, observationShift: true })).toBeCloseTo(0.0407167105, 10); // QuantLib
  });

  it("projected 2Y SOFR swap 100 Mio. quarterly, lookback 5 + shift: every coupon = N·τ_acc·(DF(obs(start))/DF(obs(end)) − 1)/τ_obs; periods with 91/92 days move by up to ≈ 10 000 USD against the round-9 divisor", () => {
    const swap = makeVanillaSwap({
      id: "S2",
      currency: "USD",
      notional: 1e8,
      payReceiveFixed: "Pay",
      fixedRate: 0.04,
      effectiveDate: VAL + 2,
      maturity: "2Y",
      index: "SOFR",
    });
    const float = swap.legs.find((l): l is FloatLeg => l.type === "Float")!;
    expect(float.frequency).toBe("1Y"); // USD OIS convention – the reviewer's swap pays quarterly
    const shifted: FloatLeg = { ...float, frequency: "3M", lookbackDays: 5, observationShift: true };
    const res = priceLeg(ctx, shifted, 1, { reportingCurrency: "USD" }).result;
    const obs = (x: number) => addBusinessDays(x, -5, sifma);
    let unequal = 0;
    let maxDelta = 0;
    for (const cf of res.cashflows) {
      const s = cf.accrualStart!;
      const e = cf.accrualEnd!;
      const oS = obs(isBusinessDay(s, sifma) ? s : addBusinessDays(s, -1, sifma));
      const oE = obs(e);
      const tauObs = yearFraction(oS, oE, "ACT/360");
      const tauAcc = yearFraction(s, e, "ACT/360");
      if (oS < VAL) {
        // first period: the observation window starts before the valuation date (Labor Day 07.09. inside the lookback) –
        // those days are projected with the curve's first forward without a fixing warning (documented behaviour)
        expect(Number.isFinite(cf.rate!)).toBe(true);
        expect(cf.isFixed).toBe(false);
        continue;
      }
      const manual = (usdCurve.df(oS) / usdCurve.df(oE) - 1) / tauObs;
      expect(cf.rate, toISO(s)).toBeCloseTo(manual, 12);
      expect(cf.amount).toBeCloseTo(1e8 * manual * tauAcc, 4);
      if (Math.abs(tauObs - tauAcc) > 1e-12) {
        unequal++;
        const old = (usdCurve.df(oS) / usdCurve.df(oE) - 1) / tauAcc; // round-9 divisor
        maxDelta = Math.max(maxDelta, Math.abs((manual - old) * tauAcc * 1e8));
        expect(manual / old).toBeCloseTo(tauAcc / tauObs, 12); // reviewer: ratio exactly τ_acc/τ_obs (92/91, 91/92)
      }
    }
    expect(res.cashflows.length).toBe(8);
    expect(unequal).toBeGreaterThanOrEqual(2);
    expect(maxDelta).toBeGreaterThan(5_000); // reviewer: coupon Δ up to 9 677.92 USD on his schedule (≈ N·r·τ·(τ_acc/τ_obs − 1))
    expect(maxDelta).toBeLessThan(40_000);
    // swap level: a plausible PV on the sample market, and the report names the convention
    const pv = priceTrade(ctx, { ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? shifted : l)) }, "USD");
    expect(Number.isFinite(pv.pv)).toBe(true);
    expect(methodologyFor(swap, ctx, pv).some((x) => x.includes("Observation Shift"))).toBe(false);
    const withShift: InterestRateSwap = { ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? shifted : l)) };
    expect(methodologyFor(withShift, ctx, pv).some((x) => x.includes("mit Observation Shift (Gewichte aus der Beobachtungsperiode)"))).toBe(true);
  });

  it("accrued interest of a running period with shift: realised observation factor to date scaled to the accrual days elapsed", () => {
    // period 01.05.–01.06.2026 valued on 15.05.2026 (fixings up to 14.05.)
    const val = parseISO("2026-05-15");
    const market: MarketContext = { ...buildSampleMarket(val), fixings: fixingsFor(start, end).filter((f) => f.date < val) };
    const l = sofrLeg(start, end, { lookbackDays: 5, observationShift: true });
    const proj = projectFloatingRate(market, l, singlePeriod(l), getCurve(market, SAMPLE_CURVE_IDS.usdSofr));
    expect(proj.isFixed).toBe(false);
    const inEffect = (x: number) => (isBusinessDay(x, sifma) ? x : addBusinessDays(x, -1, sifma));
    const obs = (x: number) => addBusinessDays(x, -5, sifma);
    let acc = 1;
    let tauObs = 0;
    for (let d = start; d < val;) {
      const stop = Math.min(addBusinessDays(d, 1, sifma), end);
      if (stop > val) break;
      const od = obs(inEffect(d));
      const tau = yearFraction(od, obs(stop), "ACT/360");
      acc *= 1 + fix(od) * tau;
      tauObs += tau;
      d = stop;
    }
    const expected = ((acc - 1) * yearFraction(start, val, "ACT/360")) / tauObs;
    expect(proj.accruedRateTau).toBeCloseTo(expected, 14);
    // leg level: legAccrued uses the same figure
    const res = priceLeg(market, l, 0, { reportingCurrency: "USD" }).result;
    expect(legAccrued(market, l, res)).toBeCloseTo(1e7 * expected, 6);
    // without shift the realised part is rate × accrual τ as before (weights are accrual days)
    const plain = sofrLeg(start, end, { lookbackDays: 5 });
    const pp = projectFloatingRate(market, plain, singlePeriod(plain), getCurve(market, SAMPLE_CURVE_IDS.usdSofr));
    let accP = 1;
    for (let d = start; d < val;) {
      const stop = Math.min(addBusinessDays(d, 1, sifma), end);
      if (stop > val) break;
      accP *= 1 + fix(obs(inEffect(d))) * yearFraction(d, stop, "ACT/360");
      d = stop;
    }
    expect(pp.accruedRateTau).toBeCloseTo(accP - 1, 14);
  });
});

// ---------------------------------------------------------------------------
// N10-3 – lookback ordering obs(inEffect(d)) on a fixing-holiday start
// ---------------------------------------------------------------------------
describe("N10-3 – lookback on a period starting on a fixing holiday looks back from the business day in effect (obs(inEffect(d)), QuantLib)", () => {
  const start = parseISO("2026-04-03"); // Good Friday – SIFMA holiday, US settlement business day
  const end = parseISO("2026-05-04");
  const fix = (d: number) => 0.04 + 0.0002 * ((((d - start) % 7) + 7) % 7);

  it("SOFR 03.04.–04.05.2026: lookback 1 = 4.09772029 %, lookback 2 = 4.08995416 % (engine: +0.1942 bp); the fixing for Good Friday is 01.04. (lookback 1)", () => {
    expect(isBusinessDay(start, sifma)).toBe(false);
    expect(isBusinessDay(start, getCalendar("US"))).toBe(true);
    const lb1 = realisedRate(start, end, { lookbackDays: 1 });
    const lb2 = realisedRate(start, end, { lookbackDays: 2 });
    expect(lb1).toBeCloseTo(0.0409772029, 10);
    expect(lb2).toBeCloseTo(0.0408995416, 10);
    expect(lb1).toBeCloseTo(isdaRate(start, end, 1, false, fix), 14);
    expect(lb2).toBeCloseTo(isdaRate(start, end, 2, false, fix), 14);
    // the round-9 ordering inEffect(obs(d)) took Thursday's fixing (02.04.) for Good Friday: +0.1942 bp
    const oldOrder = (lookback: number) => {
      let acc = 1;
      for (let d = start; d < end;) {
        const stop = Math.min(addBusinessDays(d, 1, sifma), end);
        const o = addBusinessDays(d, -lookback, sifma);
        acc *= 1 + fix(isBusinessDay(o, sifma) ? o : addBusinessDays(o, -1, sifma)) * yearFraction(d, stop, "ACT/360");
        d = stop;
      }
      return (acc - 1) / yearFraction(start, end, "ACT/360");
    };
    expect(oldOrder(1)).toBeCloseTo(0.0409966194, 10); // reviewer: engine 4.09966194 %
    expect((oldOrder(1) - lb1) * 1e4).toBeCloseTo(0.1942, 3);
    expect(toISO(addBusinessDays(addBusinessDays(start, -1, sifma), -1, sifma))).toBe("2026-04-01");
    // with shift (after N10-1): QuantLib 4.07377523 % (lookback 1) / 4.07243753 % (lookback 2)
    expect(realisedRate(start, end, { lookbackDays: 1, observationShift: true })).toBeCloseTo(0.0407377523, 10);
    expect(realisedRate(start, end, { lookbackDays: 2, observationShift: true })).toBeCloseTo(0.0407243753, 10);
    // lockout on the same period is unchanged (reviewer: bit-identical to QuantLib for k = 0…3)
    expect(realisedRate(start, end, { lockoutDays: 0 })).toBeCloseTo(0.0406471521, 10);
    expect(realisedRate(start, end, { lockoutDays: 1 })).toBeCloseTo(0.0407636488, 10);
    expect(realisedRate(start, end, { lockoutDays: 2 })).toBeCloseTo(0.0407377592, 10);
    expect(realisedRate(start, end, { lockoutDays: 3 })).toBeCloseTo(0.0407053961, 10);
    // business-day start: unchanged ordering (reviewer: 19.03.–20.04.2026 bit-identical)
    const bs = parseISO("2026-03-19");
    const be = parseISO("2026-04-20");
    const fixB = (d: number) => 0.04 + 0.0002 * ((((d - bs) % 7) + 7) % 7);
    expect(realisedRate(bs, be, { lookbackDays: 1 })).toBeCloseTo(isdaRate(bs, be, 1, false, fixB), 14);
    expect(realisedRate(bs, be, { lookbackDays: 1 })).toBeCloseTo(0.0406120448, 10); // QuantLib
  });

  it("projected holiday start: Thursday's overnight forward accrues over the three days to Monday (lookback 0), the lookback projection is QuantLib's daily product", () => {
    const pStart = parseISO("2027-03-26"); // Good Friday 2027
    const pEnd = parseISO("2027-04-26");
    expect(isBusinessDay(pStart, sifma)).toBe(false);
    const l0 = sofrLeg(pStart, pEnd);
    const proj0 = projectFloatingRate(ctx, l0, singlePeriod(l0), usdCurve);
    const thu = addBusinessDays(pStart, -1, sifma);
    const mon = addBusinessDays(pStart, 1, sifma);
    expect(toISO(thu)).toBe("2027-03-25");
    expect(toISO(mon)).toBe("2027-03-29");
    const rThu = usdCurve.forwardRate(thu, mon, "ACT/360");
    const manual0 =
      (1 + rThu * yearFraction(pStart, mon, "ACT/360")) * (1 + usdCurve.forwardRate(mon, pEnd, "ACT/360") * yearFraction(mon, pEnd, "ACT/360")) - 1;
    expect(proj0.rate).toBeCloseTo(manual0 / yearFraction(pStart, pEnd, "ACT/360"), 14);
    // round 9 telescoped DF(Thu)/DF(end) over the 31 accrual days – one extra day of discounting (≈ +13 bp)
    const old0 = (usdCurve.df(thu) / usdCurve.df(pEnd) - 1) / yearFraction(pStart, pEnd, "ACT/360");
    expect(Math.abs(old0 - proj0.rate) * 1e4).toBeGreaterThan(5);
    // lookback 2 without shift: Π(1 + f(obs(d))·τ_acc(d)) day by day
    const l2 = sofrLeg(pStart, pEnd, { lookbackDays: 2 });
    const proj2 = projectFloatingRate(ctx, l2, singlePeriod(l2), usdCurve);
    let acc = 1;
    for (let d = pStart; d < pEnd;) {
      const stop = Math.min(addBusinessDays(d, 1, sifma), pEnd);
      const od = addBusinessDays(isBusinessDay(d, sifma) ? d : addBusinessDays(d, -1, sifma), -2, sifma);
      acc *= 1 + usdCurve.forwardRate(od, addBusinessDays(od, 1, sifma), "ACT/360") * yearFraction(d, stop, "ACT/360");
      d = stop;
    }
    expect(proj2.rate).toBeCloseTo((acc - 1) / yearFraction(pStart, pEnd, "ACT/360"), 14);
    // business-day start, lookback 0: unchanged single telescoping forward
    const bStart = parseISO("2027-06-08");
    const bEnd = parseISO("2027-09-08");
    const lb = sofrLeg(bStart, bEnd);
    expect(projectFloatingRate(ctx, lb, singlePeriod(lb), usdCurve).rate).toBeCloseTo(usdCurve.forwardRate(bStart, bEnd, "ACT/360"), 14);
  });
});

// ---------------------------------------------------------------------------
// N10-2 – monthly exposure grid of the swap / basis-swap CVA
// ---------------------------------------------------------------------------
describe("N10-2 – cvaSwap / cvaBasisSwap integrate on a monthly grid plus coupon dates (reviewer: annual coupon grid −2.0 % / −3.7 % vs 7-day reference)", () => {
  const mk = (id: string, pr: "Pay" | "Receive", rate: number, mat: string): InterestRateSwap =>
    makeVanillaSwap({ id, currency: "EUR", notional: 1e7, payReceiveFixed: pr, fixedRate: rate, effectiveDate: VAL + 2, maturity: mat });
  const atm = priceTrade(ctx, mk("x", "Pay", 0.03, "10Y"), "EUR").analytics.parRate as number;
  /** Sorensen–Bollier on a `stepDays` grid with the engine's building blocks (reviewer's manual reference). */
  const reference = (swap: InterestRateSwap, stepDays: number): number => {
    const fixed = swap.legs.find((l) => l.type === "Fixed")!;
    const receive = fixed.payReceive === "Receive";
    const K = (fixed as { rate: number }).rate;
    const surface = ctx.swaptionVols!.EUR!;
    expect(surface.volType).toBe("Normal");
    const maturity = fixed.terminationDate;
    const points: { t: number; epe: number }[] = [{ t: 0, epe: Math.max(priceInterestRateSwap(ctx, swap, "EUR").pv, 0) }];
    for (let d = VAL + stepDays; d < maturity; d += stepDays) {
      const res = priceInterestRateSwap(ctx, { ...swap, legs: swap.legs.map((l) => ({ ...l, effectiveDate: d })) }, "EUR");
      const fwd = res.analytics.parRate as number;
      const annuity = res.analytics.annuity as number;
      const T = yearFraction(VAL, d, "ACT/365F");
      const vol = swaptionVol(surface, T, yearFraction(d, maturity, "ACT/365F"), fwd, K);
      points.push({ t: T, epe: annuity * bachelier(receive ? "Put" : "Call", fwd, K, vol, T) });
    }
    points.push({ t: yearFraction(VAL, maturity, "ACT/365F"), epe: 0 });
    let cva = 0;
    for (let i = 1; i < points.length; i++) {
      const pd = Math.exp(-credit.cptyHazard * points[i - 1]!.t) - Math.exp(-credit.cptyHazard * points[i]!.t);
      cva += LGD * pd * 0.5 * (points[i - 1]!.epe + points[i]!.epe);
    }
    return cva;
  };

  it("grid: monthly points from the valuation date plus coupon dates (and the premium date); the step widens beyond 10Y so at most 120 steps are used", () => {
    const g = swapExposureGrid(VAL, [VAL + 365, VAL + 730], VAL + 730);
    expect(g.stepMonths).toBe(1);
    expect(g.label).toBe("monthly exposure grid plus coupon dates");
    expect(g.dates.length).toBe(23); // 23 monthly points, the 12M point coincides with the coupon date
    expect(g.dates).toContain(VAL + 365);
    expect(g.dates).toContain(addMonths(VAL, 1));
    expect(g.dates.every((d) => d > VAL && d < VAL + 730)).toBe(true);
    expect(g.dates).toEqual([...g.dates].sort((a, b) => a - b));
    expect(swapExposureGrid(VAL, [], VAL + 400, VAL + 100).dates).toContain(VAL + 100);
    expect(swapExposureGrid(VAL, [], VAL + 400, VAL + 500).dates).not.toContain(VAL + 500); // premium after maturity: no point
    expect(swapExposureGrid(VAL, [VAL - 10], VAL + 400).dates).not.toContain(VAL - 10);
    expect(CVA_SWAP_GRID_MAX_STEPS).toBe(120);
    expect(swapExposureGrid(VAL, [], addTenorCal(VAL, "10Y")).stepMonths).toBe(1);
    expect(swapExposureGrid(VAL, [], addTenorCal(VAL, "20Y")).stepMonths).toBe(2);
    expect(swapExposureGrid(VAL, [], addTenorCal(VAL, "30Y")).stepMonths).toBe(3);
    expect(swapExposureGrid(VAL, [], addTenorCal(VAL, "30Y")).label).toBe("3-monthly exposure grid plus coupon dates");
    expect(swapExposureGrid(VAL, [], addTenorCal(VAL, "30Y")).dates.length).toBeLessThanOrEqual(CVA_SWAP_GRID_MAX_STEPS);
  });

  it("2Y / 5Y / 10Y payer and receiver and the ATM receiver: engine CVA within 0.15 % of a 7-day Sorensen–Bollier reference (reviewer: −2.00 % / −1.77 % / −3.66 %)", () => {
    for (const [name, swap] of [
      ["10Y receiver 3 %", mk("R10", "Receive", 0.03, "10Y")],
      ["10Y payer 3 %", mk("P10", "Pay", 0.03, "10Y")],
      ["10Y receiver ATM", mk("RA", "Receive", atm, "10Y")],
      ["5Y payer 2.5 %", mk("P5", "Pay", 0.025, "5Y")],
      ["2Y receiver 3 %", mk("R2", "Receive", 0.03, "2Y")],
    ] as const) {
      const x = computeXva(ctx, swap, credit, "EUR");
      const ref7 = reference(swap, 7);
      expect(Math.abs(x.cva / ref7 - 1), `${name}: engine ${x.cva.toFixed(2)} vs 7-day ${ref7.toFixed(2)}`).toBeLessThan(0.0015);
      expect(x.method).toContain("monthly exposure grid plus coupon dates");
      // the profile is dense: no gap longer than ~1 month plus a few days
      for (let i = 1; i < x.profile.length; i++) expect(x.profile[i]!.date - x.profile[i - 1]!.date, name).toBeLessThanOrEqual(35);
    }
    // the reviewer's 10Y receiver 3 %: 7-day reference 21 797.96 was 2.0 % above the coupon-grid engine value 21 362.70
    const r10 = computeXva(ctx, mk("R10", "Receive", 0.03, "10Y"), credit, "EUR");
    expect(r10.cva).toBeGreaterThan(21_600);
    expect(r10.cva).toBeLessThan(21_900);
    expect(r10.profile.length).toBeGreaterThan(110);
  });

  it("a paid fee never increases the CVA, a received fee never lowers it – on the swap and on the generic (FX swap) path (reviewer: +0.19 % and +5.95 %)", () => {
    const receiver = mk("R10", "Receive", 0.03, "10Y");
    const base = computeXva(ctx, receiver, credit, "EUR");
    for (const days of [30, 45, 100, 200, 400]) {
      const paid = computeXva(ctx, { ...receiver, upfront: { amount: 120_000, currency: "USD", date: VAL + days } }, credit, "EUR");
      const received = computeXva(ctx, { ...receiver, upfront: { amount: -120_000, currency: "USD", date: VAL + days } }, credit, "EUR");
      expect(paid.cva, `paid fee in ${days} d`).toBeLessThan(base.cva);
      expect(received.cva, `received fee in ${days} d`).toBeGreaterThan(base.cva);
      // the netting effect dominates the grid effect by far: |Δ| within ½·fee·PD(t)·LGD·(1 ± 50 %)
      const pdT = 1 - Math.exp(-credit.cptyHazard * yearFraction(VAL, VAL + days, "ACT/365F"));
      const bound = 0.5 * 120_000 * getDiscountCurve(ctx, "USD").df(VAL + days) * pdT * LGD;
      expect(base.cva - paid.cva, `paid ${days} d`).toBeLessThan(bound * 1.6);
      expect(base.cva - paid.cva, `paid ${days} d`).toBeGreaterThan(bound * 0.4);
    }
    // FX swap (cvaGeneric): the grid is filled monthly, so the premium date no longer refines a 4-point grid (reviewer: +5.95 %) –
    // the exposure before the premium date is negative for this trade with and without the fee, so the fee itself is neutral
    const fxs = makeFxSwap({ id: "S", pair: "EURUSD", baseAmount: 1e7, nearRate: 1.15, farRate: 1.152, nearDate: VAL + 2, farDate: VAL + 365 });
    const fxBase = computeXva(ctx, fxs, credit, "EUR");
    expect(fxBase.profile.length).toBeGreaterThanOrEqual(12);
    for (let i = 1; i < fxBase.profile.length; i++) expect(fxBase.profile[i]!.date - fxBase.profile[i - 1]!.date).toBeLessThanOrEqual(35);
    const fxPaid = computeXva(ctx, { ...fxs, upfront: { amount: 1e5, currency: "EUR", date: VAL + 45 } }, credit, "EUR");
    const fxReceived = computeXva(ctx, { ...fxs, upfront: { amount: -1e5, currency: "EUR", date: VAL + 45 } }, credit, "EUR");
    expect(fxPaid.profile.some((p) => p.date === VAL + 45)).toBe(true);
    expect(fxPaid.cva).toBeLessThanOrEqual(fxBase.cva * 1.003);
    expect(fxReceived.cva).toBeGreaterThanOrEqual(fxPaid.cva);
    expect(Math.abs(fxPaid.cva / fxBase.cva - 1)).toBeLessThan(0.01); // grid effect of the premium point on a monthly grid (reviewer: +5.95 % on 4 points)
    // a received fee on a trade with positive exposure before the premium date raises the CVA, a paid one lowers it
    const fwdLike = makeFxSwap({ id: "S2", pair: "EURUSD", baseAmount: -1e7, nearRate: 1.15, farRate: 1.152, nearDate: VAL + 2, farDate: VAL + 365 });
    const b2 = computeXva(ctx, fwdLike, credit, "EUR");
    expect(b2.profile[1]!.epe).toBeGreaterThan(0);
    expect(computeXva(ctx, { ...fwdLike, upfront: { amount: 1e5, currency: "EUR", date: VAL + 45 } }, credit, "EUR").cva).toBeLessThan(b2.cva);
    expect(computeXva(ctx, { ...fwdLike, upfront: { amount: -1e5, currency: "EUR", date: VAL + 45 } }, credit, "EUR").cva).toBeGreaterThan(b2.cva);
  });

  it("basis swap: quarterly coupons plus monthly points, method label and German report text name the grid; runtime stays small", () => {
    const basis = makeBasisSwap({
      id: "B",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0,
    });
    const x = computeXva(ctx, basis, credit, "EUR");
    expect(x.method).toMatch(/^Basis-swaption replication .*monthly exposure grid plus coupon dates, flat hazard$/);
    expect(x.profile.length).toBeGreaterThan(60);
    expect(xvaMethodLabelDe(x.method)).toBe(
      "Basis-Swaption-Replikation (Bachelier auf den Tenor-Basis-Spread), Exposure-Gitter monatlich plus Kupontermine, flache Hazard-Rate",
    );
    const swap = mk("P10", "Pay", 0.03, "10Y");
    const xs = computeXva(ctx, { ...swap, upfront: { amount: 1e5, currency: "EUR", date: VAL + 100 } }, credit, "EUR");
    expect(xvaMethodLabelDe(xs.method)).toBe(
      "Swaption-Replikation (Sorensen–Bollier) mit der Smile-Vol am Strike, Exposure-Gitter monatlich plus Kupontermine, offene Prämie bis zum Zahltermin genettet, flache Hazard-Rate",
    );
    const long = computeXva(ctx, mk("P30", "Pay", 0.03, "30Y"), credit, "EUR");
    expect(xvaMethodLabelDe(long.method)).toContain("Exposure-Gitter 3-monatlich plus Kupontermine");
    const lines = methodologyFor(swap, ctx, priceTrade(ctx, swap, "EUR"), { xva: computeXva(ctx, swap, credit, "EUR") });
    expect(lines.some((l) => l.startsWith("Kontrahentenrisiko:") && l.includes("Exposure-Gitter monatlich plus Kupontermine"))).toBe(true);
    // runtime (N7-03 style: best of two, CI tolerance): a 10Y CVA on ≈ 130 grid points stays far below a second
    const timed = () => {
      const t0 = performance.now();
      computeXva(ctx, swap, credit, "EUR");
      return performance.now() - t0;
    };
    expect(Math.min(timed(), timed())).toBeLessThan(process.env.CI ? 2_000 : 400);
  });
});

// ---------------------------------------------------------------------------
// N10-4 – INVALID_DATE instead of an endless loop
// ---------------------------------------------------------------------------
describe("N10-4 – date and calendar functions throw INVALID_DATE for NaN / undefined / non-integer dates instead of looping", () => {
  const cal = getCalendar("TARGET");
  const bad = [NaN, undefined, Infinity, 20_700.5, "2026-09-03"] as unknown as number[];

  it("addBusinessDays, adjust, advance, businessDaysBetween, isBusinessDay, addTenor, addMonths, addDays, toISO: INVALID_DATE within milliseconds", () => {
    const t0 = performance.now();
    for (const d of bad) {
      expect(
        codeOf(() => addBusinessDays(d, 2, cal)),
        `addBusinessDays(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => adjust(d, "ModifiedFollowing", cal)),
        `adjust(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => advance(d, "6M", cal)),
        `advance(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => advance(d, "2D", cal)),
        `advance(${String(d)}, 2D)`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => businessDaysBetween(d, VAL, cal)),
        `businessDaysBetween(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => businessDaysBetween(VAL, d, cal)),
        `businessDaysBetween(…, ${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => isBusinessDay(d, cal)),
        `isBusinessDay(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => addTenorCal(d, "6M")),
        `addTenor(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => addMonths(d, 1)),
        `addMonths(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => addDays(d, 1)),
        `addDays(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(
        codeOf(() => toISO(d)),
        `toISO(${String(d)})`,
      ).toBe("INVALID_DATE");
      expect(isSerialDate(d)).toBe(false);
      expect(codeOf(() => assertSerialDate(d, "effectiveDate"))).toBe("INVALID_DATE");
    }
    expect(performance.now() - t0).toBeLessThan(500); // reviewer: > 10 s timeout per call
    // the step counts are validated too
    expect(codeOf(() => addBusinessDays(VAL, NaN, cal))).toBe("INVALID_DATE");
    expect(codeOf(() => addBusinessDays(VAL, 1.5, cal))).toBe("INVALID_DATE");
    expect(codeOf(() => addMonths(VAL, NaN))).toBe("INVALID_DATE");
    // message and details name the argument
    try {
      assertSerialDate(NaN, "startDate");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PricingError);
      expect((e as PricingError).message).toContain("startDate must be a serial date");
      expect((e as PricingError).details).toEqual({ what: "startDate", input: NaN });
    }
    // valid input unchanged
    expect(isSerialDate(VAL)).toBe(true);
    expect(addBusinessDays(VAL, 2, cal)).toBe(VAL + 4); // Thu 03.09. + 2 → Mon 07.09.
    expect(advance(VAL, "6M", cal)).toBe(parseISO("2027-03-03"));
    expect(toISO(addBusinessDays(VAL, -1, cal))).toBe("2026-09-02");
    expect(businessDaysBetween(VAL, VAL + 7, cal)).toBe(5);
  });

  it("makeFra without start / with NaN dates → INVALID_TRADE (reviewer: hang > 10 s); the period form and explicit dates still work", () => {
    const t0 = performance.now();
    expect(codeOf(() => makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", rate: 0.03, start: undefined as unknown as number }))).toBe(
      "INVALID_TRADE",
    );
    expect(codeOf(() => makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", rate: 0.03, start: NaN }))).toBe("INVALID_TRADE");
    expect(codeOf(() => makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", rate: 0.03, start: VAL + 90, end: NaN }))).toBe("INVALID_TRADE");
    expect(codeOf(() => makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", rate: 0.03, start: "3x6", valuationDate: NaN }))).toBe("INVALID_TRADE");
    expect(performance.now() - t0).toBeLessThan(200);
    const fra = makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", rate: 0.03, start: "3x6", valuationDate: VAL });
    expect(fra.index).toBe("EURIBOR-3M");
    expect(fra.endDate).toBeGreaterThan(fra.startDate);
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", rate: 0.03, start: VAL + 90 }).endDate).toBeGreaterThan(VAL + 90);
    // other builders: a NaN effective date surfaces as INVALID_DATE from the tenor arithmetic instead of NaN legs
    expect(codeOf(() => makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: NaN, maturity: "5Y" }))).toBe(
      "INVALID_DATE",
    );
  });
});

// ---------------------------------------------------------------------------
// Markt R10-1 (core) – par-risk specs must reproduce the market curves
// ---------------------------------------------------------------------------
describe("R10-1 – checkParRiskSpecs re-bootstraps every spec against the market and flags specs that do not reproduce their curve; parRisk can skip them", () => {
  const specs = sampleBootstrapSpecs(VAL);
  const payer = makeVanillaSwap({ id: "P", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: VAL + 2, maturity: "10Y" });
  const bumpedEstrSpecs = () => {
    const estr = specs[SAMPLE_CURVE_IDS.eurOis]!;
    return { ...specs, [SAMPLE_CURVE_IDS.eurOis]: { ...estr, quotes: estr.quotes.map((q) => bumpQuote(q, 50)) } };
  };
  /** Reviewer's scenario (a)/(b): the EUR-ESTR curve rebuilt from +50 bp quotes, every other curve as before. */
  const marketWithNewEstr = (): MarketContext => {
    const spec = bumpedEstrSpecs()[SAMPLE_CURVE_IDS.eurOis]!;
    return withCurves(ctx, bootstrapCurves(VAL, [spec], ctx.curves).curves);
  };

  it("sample market: every sample spec is consistent (DF diff ≈ 0), none missing; sampleBootstrapSpecs covers all sample curves and is public", () => {
    const check = checkParRiskSpecs(ctx, specs);
    expect(check.inconsistent).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.consistent.sort()).toEqual(Object.keys(ctx.curves).sort());
    expect(check.consistent).toEqual(expect.arrayContaining(Object.values(SAMPLE_CURVE_IDS)));
    expect(PAR_RISK_SPEC_TOLERANCE).toBe(1e-9);
    // a spec without a market curve is "missing", not inconsistent
    const extra = { ...specs, "CZK-NOPE": { ...specs[SAMPLE_CURVE_IDS.usdSofr]!, id: "CZK-NOPE", currency: "CZK" } };
    expect(checkParRiskSpecs(ctx, extra).missing).toEqual(["CZK-NOPE"]);
    // the key is the id when the spec carries none
    const keyed = { [SAMPLE_CURVE_IDS.eurOis]: { ...specs[SAMPLE_CURVE_IDS.eurOis]!, id: undefined } };
    expect(checkParRiskSpecs(ctx, keyed as never).consistent).toEqual([SAMPLE_CURVE_IDS.eurOis]);
  });

  it("bumped ESTR spec vs the unbumped market curve → inconsistent (maxAbsDfDiff ≈ 50 bp·t); dependants checked against the market's ESTR stay consistent; a spec that does not bootstrap reports the reason", () => {
    const check = checkParRiskSpecs(ctx, bumpedEstrSpecs());
    expect(check.inconsistent.map((x) => x.curveId)).toEqual([SAMPLE_CURVE_IDS.eurOis]);
    const diff = check.inconsistent[0]!.maxAbsDfDiff;
    expect(diff).toBeGreaterThan(1e-3); // 50 bp on a 30Y pillar ≈ 0.005·30·DF ≈ 0.07
    expect(diff).toBeLessThan(0.2);
    expect(check.consistent).toContain(SAMPLE_CURVE_IDS.eur6m);
    expect(check.consistent).toContain(SAMPLE_CURVE_IDS.eur3m);
    // a 0.01 bp bump is already outside the default tolerance, but inside a loose one
    const tiny = {
      ...specs,
      [SAMPLE_CURVE_IDS.eurOis]: { ...specs[SAMPLE_CURVE_IDS.eurOis]!, quotes: specs[SAMPLE_CURVE_IDS.eurOis]!.quotes.map((q) => bumpQuote(q, 0.01)) },
    };
    expect(checkParRiskSpecs(ctx, tiny).inconsistent.map((x) => x.curveId)).toEqual([SAMPLE_CURVE_IDS.eurOis]);
    expect(checkParRiskSpecs(ctx, tiny, { tolerance: 1e-3 }).inconsistent).toEqual([]);
    // unusable spec: bootstrap error → inconsistent with Infinity and the message
    const broken = { ...specs, [SAMPLE_CURVE_IDS.eur6m]: { ...specs[SAMPLE_CURVE_IDS.eur6m]!, discountCurveId: "EUR-NOPE" } };
    const b = checkParRiskSpecs(ctx, broken).inconsistent.find((x) => x.curveId === SAMPLE_CURVE_IDS.eur6m)!;
    expect(b.maxAbsDfDiff).toBe(Infinity);
    expect(b.reason).toContain("EUR-NOPE");
  });

  it("reviewer's scenario (b): the discount curve replaced without rebuilding its dependants → EUR-EURIBOR-6M / -3M (and the EUR-under-USD-CSA curve) inconsistent, ESTR consistent", () => {
    const market = marketWithNewEstr();
    const check = checkParRiskSpecs(market, bumpedEstrSpecs());
    expect(check.consistent).toContain(SAMPLE_CURVE_IDS.eurOis);
    expect(check.inconsistent.map((x) => x.curveId).sort()).toEqual([SAMPLE_CURVE_IDS.eur3m, SAMPLE_CURVE_IDS.eur6m, SAMPLE_CURVE_IDS.eurUsdXccy].sort());
    expect(check.inconsistent.every((x) => x.maxAbsDfDiff > 1e-4 && x.maxAbsDfDiff < 0.1)).toBe(true); // 50 bp on the discount curve ≈ 1e-3 in the projection DFs
    // rebuilding the dependants restores consistency
    const rebuilt = withCurves(market, bootstrapCurves(VAL, Object.values(bumpedEstrSpecs()), market.curves).curves);
    expect(checkParRiskSpecs(rebuilt, bumpedEstrSpecs()).inconsistent).toEqual([]);
  });

  it(
    "parRisk: consistent specs → identical report (plus inconsistent: []); an inconsistent spec is skipped and listed instead of producing the level difference (reviewer: −97 521 for a 6 828 DV01)",
    { timeout: 120_000 },
    () => {
      // the EUR curves the payer actually uses (discount + projection) keep the ≈ 10 par-risk runs of this test affordable
      const eur = { curveIds: [SAMPLE_CURVE_IDS.eurOis, SAMPLE_CURVE_IDS.eur6m] };
      const plain = parRisk(ctx, payer, "EUR", specs, eur);
      const checked = parRisk(ctx, payer, "EUR", specs, { ...eur, checkSpecs: true });
      expect(plain.inconsistent).toBeUndefined();
      expect(checked.inconsistent).toEqual([]);
      expect({ ...checked, inconsistent: undefined }).toEqual({ ...plain, inconsistent: undefined });
      // reviewer's scenario (a): a self-consistent foreign EoD (every EUR curve built on the +50 bp ESTR) imported into a process
      // whose par-risk specs are the default sample quotes – every ESTR bucket then carries the level difference
      // PV(sample market) − PV(market) instead of the quote's sensitivity
      const market = withCurves(ctx, bootstrapCurves(VAL, Object.values(bumpedEstrSpecs()), ctx.curves).curves);
      const dv01 = computeRisk(market, payer, "EUR", { bucketed: false, vega: false, theta: false }).dv01;
      const wrong = parRisk(market, payer, "EUR", specs, eur);
      const level = priceTrade(ctx, payer, "EUR").pv - priceTrade(market, payer, "EUR").pv;
      expect(Math.abs(level)).toBeGreaterThan(1_000);
      const wrongEstr = wrong.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eurOis)!;
      for (const b of wrongEstr.buckets) expect(Math.abs(b.delta - level), b.label).toBeLessThan(0.25 * Math.abs(level));
      // the consistent reference (specs from the same +50 bp quotes) has a small ESTR discount risk and par ≈ DV01
      const right = parRisk(market, payer, "EUR", bumpedEstrSpecs(), { ...eur, checkSpecs: true });
      expect(right.inconsistent).toEqual([]);
      const rightEstr = right.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eurOis)!;
      expect(Math.abs(wrongEstr.total)).toBeGreaterThan(4 * Math.abs(rightEstr.total));
      expect(Math.abs(right.total / dv01 - 1)).toBeLessThan(0.15); // par ≈ DV01 up to quote convexity / curve coupling
      // with the check the default specs' ESTR is skipped, the EURIBOR-6M spec (same quotes, checked against the market's ESTR)
      // stays; the portfolio variant carries the same list on every trade and the remaining buckets equal an explicit run
      const book = parRiskPortfolio(market, [payer, { ...payer, id: "P2" }], "EUR", specs, { ...eur, checkSpecs: true });
      expect(book).toHaveLength(2);
      for (const safe of book) {
        expect(safe.inconsistent!.map((x) => x.curveId)).toEqual([SAMPLE_CURVE_IDS.eurOis]);
        expect(safe.curves.map((c) => c.curveId)).toEqual([SAMPLE_CURVE_IDS.eur6m]);
        expect(safe.curves).toEqual(wrong.curves.filter((c) => c.curveId === SAMPLE_CURVE_IDS.eur6m));
        expect(safe.total).toBeCloseTo(wrong.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eur6m)!.total, 8);
      }
      // a loose tolerance is passed through and accepts the level difference
      expect(checkParRiskSpecs(market, specs, { tolerance: 1 }).inconsistent).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// Ohne Abzug (Markt R10) – OIS leg of an IBOR/OIS basis swap pays with the IBOR frequency
// ---------------------------------------------------------------------------
describe("R10 – makeBasisSwap: the OIS leg of an IBOR/OIS basis swap follows the IBOR leg's frequency", () => {
  it("NIBOR-6M vs NOWA → both legs 6M (reviewer: NOWA leg 3M); EURIBOR-6M vs ESTR → 6M; EURIBOR-3M vs ESTR → 3M; IBOR/IBOR unchanged", () => {
    const nok = makeBasisSwap({
      id: "N",
      currency: "NOK",
      notional: 1e8,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "NIBOR-6M",
      payIndex: "NOWA",
      spread: 0.001,
    });
    expect(nok.legs.map((l) => l.frequency)).toEqual(["6M", "6M"]);
    expect(nok.legs.map((l) => (l as FloatLeg).index)).toEqual(["NIBOR-6M", "NOWA"]);
    expect((nok.legs[1] as FloatLeg).paymentLag).toBeGreaterThanOrEqual(0);
    const eur6 = makeBasisSwap({
      id: "E6",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "ESTR",
      payIndex: "EURIBOR-6M",
      spread: 0,
    });
    expect(eur6.legs.map((l) => l.frequency)).toEqual(["6M", "6M"]);
    const eur3 = makeBasisSwap({
      id: "E3",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "ESTR",
      spread: 0,
    });
    expect(eur3.legs.map((l) => l.frequency)).toEqual(["3M", "3M"]);
    const ibor = makeBasisSwap({
      id: "I",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0,
    });
    expect(ibor.legs.map((l) => l.frequency)).toEqual(["3M", "6M"]);
    // prices and validates
    const res = priceTrade(ctx, eur6, "EUR");
    expect(Number.isFinite(res.pv)).toBe(true);
    expect(res.legs[0]!.cashflows.filter((c) => c.kind === "Interest").length).toBe(res.legs[1]!.cashflows.filter((c) => c.kind === "Interest").length);
  });
});
