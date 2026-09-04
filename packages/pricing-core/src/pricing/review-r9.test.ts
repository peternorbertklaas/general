import { describe, expect, it } from "vitest";
import { addBusinessDays, getCalendar, isBusinessDay } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule } from "../dates/schedule.js";
import { makeAmortisingSwap, makeBasisSwap, makeFxForward, makeFxOption, makeImmSwap, makeVanillaSwap } from "../instruments/builders.js";
import { type FloatLeg, type FxOption, type InterestRateSwap, type Trade } from "../instruments/types.js";
import { type Fixing, type MarketContext, getCurve, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, buildSampleMarket } from "../market/sample-market.js";
import { validateMarket } from "../market/snapshot.js";
import { emirValuationTimestamp } from "../reporting/emir.js";
import { methodologyFor } from "../reporting/valuation-report.js";
import { rollMarket, rolledMeta } from "../risk/sensitivities.js";
import { computeXva } from "../xva/cva.js";
import { DEFAULT_REBATE_AT, rebateConvention } from "./fx-pricer.js";
import { projectFloatingRate } from "./leg-pricer.js";
import { priceTrade } from "./price.js";

const VAL = parseISO("2026-09-03");
const TOM = VAL + 1;
const ctx = buildSampleMarket(VAL);
const credit = { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 };
const LGD = 1 - credit.cptyRecovery;

const withUpfront = <T extends Trade>(t: T, amount: number, currency: string, date: number): T => ({ ...t, upfront: { amount, currency, date } });
const flip = (s: InterestRateSwap, id: string): InterestRateSwap => ({
  ...s,
  id,
  legs: s.legs.map((l) => ({ ...l, payReceive: l.payReceive === "Pay" ? "Receive" : "Pay" })),
});

// ---------------------------------------------------------------------------
// N9-1 – lockout counting like QuantLib / ISDA: the last k fixings are replaced by the fixing before the window
// ---------------------------------------------------------------------------
describe("N9-1 – lockoutDays k replaces the last k fixings by the fixing of the business day before the window (QuantLib OvernightIndexedCoupon)", () => {
  const sifma = getCalendar("US-SIFMA");
  const usdCurve = getCurve(ctx, SAMPLE_CURVE_IDS.usdSofr);
  const start = parseISO("2026-06-01");
  const end = parseISO("2026-08-03");
  const fixings: Fixing[] = [];
  // reviewer's fixings: 4.00 % + 0.02 %·((d − start) mod 7) on the SIFMA publication days
  for (let d = start - 10; d <= end; d++)
    if (isBusinessDay(d, sifma)) fixings.push({ index: "SOFR", date: d, value: 0.04 + 0.0002 * ((((d - start) % 7) + 7) % 7) });
  const market: MarketContext = { ...ctx, fixings };
  const leg = (lockoutDays: number): FloatLeg => ({
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
    lockoutDays,
  });
  const rate = (k: number) => {
    const l = leg(k);
    const period = buildSchedule({ ...l, businessDayConvention: "ModifiedFollowing", stub: "ShortFront", paymentLag: 0 }).periods[0]!;
    return projectFloatingRate(market, l, period, usdCurve).rate;
  };

  it("SOFR period 01.06.–03.08.2026: engine k = QuantLib k for k = 0…3 (reviewer: engine k was QuantLib k − 1, lockoutDays 1 had no effect)", () => {
    expect(rate(0)).toBeCloseTo(0.04063434219935682, 14); // QuantLib lockoutDays 0 = 4.06343422 %
    expect(rate(1)).toBeCloseTo(0.04062475392594221, 14); // QuantLib lockoutDays 1 = 4.06247539 % (R8 engine: k = 2)
    expect(rate(2)).toBeCloseTo(0.04061196884590121, 14); // QuantLib lockoutDays 2 = 4.06119688 % (R8 engine: k = 3)
    expect(rate(3)).toBeCloseTo(0.04059598697698849, 14); // QuantLib lockoutDays 3 = 4.05959870 % (R8 engine: k = 4)
    expect(rate(1)).not.toBeCloseTo(rate(0), 8); // R8: identical
    // manual: last k business days ← fixing of the business day before the window
    const fix = (d: number) => fixings.find((f) => f.date === d)!.value;
    for (const k of [1, 2, 3]) {
      const windowStart = addBusinessDays(end, -k, sifma);
      const frozen = addBusinessDays(windowStart, -1, sifma);
      let acc = 1;
      for (let d = start; d < end;) {
        const next = Math.min(addBusinessDays(d, 1, sifma), end);
        acc *= 1 + fix(d >= windowStart ? frozen : d) * yearFraction(d, next, "ACT/360");
        d = next;
      }
      expect(rate(k), `k = ${k}`).toBeCloseTo((acc - 1) / yearFraction(start, end, "ACT/360"), 14);
    }
    expect(toISO(addBusinessDays(end, -2, sifma))).toBe("2026-07-30");
    expect(toISO(addBusinessDays(end, -3, sifma))).toBe("2026-07-29"); // QuantLib k = 2 fixing dates: 28.07., 29.07., 29.07., 29.07.
  });

  it("projected period: the frozen tail compounds the overnight forward of the day before the window; a 1-day lockout changes a 2Y SOFR swap's PV", () => {
    const pStart = parseISO("2026-09-15");
    const pEnd = parseISO("2026-12-15");
    const l: FloatLeg = { ...leg(1), effectiveDate: pStart, terminationDate: pEnd };
    const period = buildSchedule({ ...l, businessDayConvention: "ModifiedFollowing", stub: "ShortFront", paymentLag: 0 }).periods[0]!;
    const windowStart = addBusinessDays(pEnd, -1, sifma); // 14.12.
    const frozen = addBusinessDays(pEnd, -2, sifma); // 11.12.
    expect(toISO(windowStart)).toBe("2026-12-14");
    expect(toISO(frozen)).toBe("2026-12-11");
    const fwd = usdCurve.forwardRate(pStart, windowStart, "ACT/360");
    const rLock = usdCurve.forwardRate(frozen, addBusinessDays(frozen, 1, sifma), "ACT/360");
    const manual = (1 + fwd * yearFraction(pStart, windowStart, "ACT/360")) * (1 + rLock * yearFraction(windowStart, pEnd, "ACT/360")) - 1;
    const proj = projectFloatingRate(ctx, l, period, usdCurve);
    expect(proj.isFixed).toBe(false);
    expect(proj.rate).toBeCloseTo(manual / yearFraction(pStart, pEnd, "ACT/360"), 14);
    // swap level (reviewer probe I: lockoutDays 0 PV = lockoutDays 1 PV in round 8)
    const ois = makeVanillaSwap({
      id: "L",
      currency: "USD",
      notional: 1e8,
      payReceiveFixed: "Pay",
      fixedRate: 0.04,
      effectiveDate: VAL + 2,
      maturity: "2Y",
      index: "SOFR",
    });
    const withLockout = (k: number): InterestRateSwap => ({ ...ois, legs: ois.legs.map((x) => (x.type === "Float" ? { ...x, lockoutDays: k } : x)) });
    const pv0 = priceTrade(ctx, withLockout(0), "USD").pv;
    const pv1 = priceTrade(ctx, withLockout(1), "USD").pv;
    const pv2 = priceTrade(ctx, withLockout(2), "USD").pv;
    expect(pv1).not.toBeCloseTo(pv0, 2);
    expect(Math.abs(pv1 - pv0)).toBeLessThan(50);
    expect(Math.abs(pv2 - pv1)).toBeLessThan(50);
    expect(
      methodologyFor(withLockout(2), ctx, priceTrade(ctx, withLockout(2), "USD")).some((x) =>
        x.includes("Lockout 2 Geschäftstage (die letzten 2 Geschäftstage tragen das Fixing des Geschäftstags vor dem Lockout-Fenster"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N9-2 – premium date as a grid point of the swap / basis-swap CVA
// ---------------------------------------------------------------------------
describe("N9-2 – cvaSwap / cvaBasisSwap: grid point at the premium date, exposure before it with the premium PV (shifted strike), after it without", () => {
  const swaps: { name: string; trade: InterestRateSwap; ccy: string }[] = [];
  const add = (name: string, trade: InterestRateSwap, ccy: string) => {
    swaps.push({ name: `${name} (as built)`, trade, ccy });
    swaps.push({ name: `${name} (flipped)`, trade: flip(trade, `${trade.id}-F`), ccy });
  };
  add(
    "vanilla 10Y",
    makeVanillaSwap({ id: "V", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: VAL + 2, maturity: "10Y" }),
    "EUR",
  );
  add(
    "step-up 5Y",
    makeVanillaSwap({
      id: "S",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.02,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      stepUp: [
        { date: VAL + 732, rate: 0.025 },
        { date: VAL + 1462, rate: 0.03 },
      ],
    }),
    "EUR",
  );
  add(
    "amortising 7Y",
    makeAmortisingSwap({ id: "A", currency: "EUR", notional: 1e7, payReceiveFixed: "Receive", fixedRate: 0.03, effectiveDate: VAL + 2, maturity: "7Y" }),
    "EUR",
  );
  add("IMM 5Y USD", makeImmSwap({ id: "I", currency: "USD", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, from: VAL, tenor: "5Y" }), "USD");
  add(
    "SOFR OIS 5Y",
    makeVanillaSwap({
      id: "O",
      currency: "USD",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.03,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      index: "SOFR",
    }),
    "USD",
  );
  add(
    "basis 5Y",
    makeBasisSwap({
      id: "B",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0,
    }),
    "EUR",
  );

  it("fee ±100 k at spot: CVA = CVA without fee ± 0.1 % on every swap type, payer and receiver (reviewer: amortising −8.9 %, basis −9.2 %, receiver +5.6 %)", () => {
    for (const { name, trade, ccy } of swaps) {
      const base = computeXva(ctx, trade, credit, ccy);
      expect(base.cva, name).toBeGreaterThan(0);
      // the grid point itself (fee 0 at spot) only refines the interpolation of the first two days (< 0.2 %)
      const zero = computeXva(ctx, withUpfront(trade, 0, ccy, VAL + 2), credit, ccy);
      expect(Math.abs(zero.cva / base.cva - 1), `${name} grid point`).toBeLessThan(0.002);
      for (const amount of [1e5, -1e5]) {
        const fee = computeXva(ctx, withUpfront(trade, amount, ccy, VAL + 2), credit, ccy);
        expect(fee.method, name).toContain("open premium netted until its payment date");
        expect(fee.profile.length).toBe(base.profile.length + 1);
        expect(fee.profile[1]!.date).toBe(VAL + 2);
        // from the premium date on the profile is the plain one
        fee.profile.slice(1).forEach((p, i) => {
          const b = base.profile[i]!;
          if (i === 0) return;
          expect(p.date, name).toBe(b.date);
          expect(p.epe, `${name} epe ${toISO(p.date)}`).toBeCloseTo(b.epe, 6);
          expect(p.ene, `${name} ene ${toISO(p.date)}`).toBeCloseTo(b.ene, 6);
        });
        // t = 0 nets the fee (current PV incl. fee), the premium-date point is the plain exposure
        const pv = priceTrade(ctx, withUpfront(trade, amount, ccy, VAL + 2), ccy).pv;
        expect(fee.profile[0]!.epe, name).toBeCloseTo(Math.max(pv, 0), 6);
        expect(fee.profile[1]!.epe, name).toBeCloseTo(zero.profile[1]!.epe, 6);
        // the whole fee effect is the two-day trapezoid on ΔEPE(0)
        const twoDay = LGD * fee.profile[1]!.pdCpty * 0.5 * (fee.profile[0]!.epe - zero.profile[0]!.epe);
        expect(fee.cva - zero.cva, `${name} fee ${amount}`).toBeCloseTo(twoDay, 6);
        // a paid fee (the reviewer's case) leaves the CVA within 0.1 % of the fee-less CVA on the same grid and within
        // 0.2 % of the plain CVA; a received fee is a real two-day receivable (bounded by its trapezoid)
        if (amount > 0) {
          expect(Math.abs(fee.cva / zero.cva - 1), `${name} fee ${amount}`).toBeLessThan(0.001);
          expect(Math.abs(fee.cva / base.cva - 1), `${name} fee ${amount}`).toBeLessThan(0.002);
        } else expect(Math.abs(fee.cva - base.cva), `${name} fee ${amount}`).toBeLessThan(0.002 * base.cva + Math.abs(twoDay));
      }
    }
  });

  it("fee 100 k on the first coupon date (1Y): CVA difference = ½·ΔEPE(0)·PD(1Y)·LGD ≈ ½·fee·DF·PD(1Y)·LGD (reviewer's formula); a settled fee changes nothing", () => {
    const receiver = flip(
      makeVanillaSwap({ id: "V", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: VAL + 2, maturity: "10Y" }),
      "R",
    );
    const base = computeXva(ctx, receiver, credit, "EUR");
    const t1 = base.profile[1]!.date; // first coupon date ≈ 1Y
    expect(t1 - VAL).toBeGreaterThan(360);
    expect(t1 - VAL).toBeLessThan(372);
    const fee = computeXva(ctx, withUpfront(receiver, 1e5, "EUR", t1), credit, "EUR");
    expect(fee.profile.length).toBe(base.profile.length); // the premium date is a coupon date already
    fee.profile.slice(1).forEach((p, i) => {
      expect(p.epe).toBeCloseTo(base.profile[i + 1]!.epe, 6);
      expect(p.ene).toBeCloseTo(base.profile[i + 1]!.ene, 6);
    });
    const dEpe0 = fee.profile[0]!.epe - base.profile[0]!.epe;
    const dfFee = getDiscountCurve(ctx, "EUR").df(t1);
    expect(dEpe0).toBeCloseTo(-1e5 * dfFee, 6); // receiver PV ≈ +104 k stays positive after the fee
    const pd1 = fee.profile[1]!.pdCpty;
    expect(fee.cva - base.cva).toBeCloseTo(0.5 * dEpe0 * pd1 * LGD, 6);
    expect(Math.abs((fee.cva - base.cva) / (-0.5 * 1e5 * pd1 * LGD) - 1)).toBeLessThan(0.04); // ≈ fee·PD(1Y)·LGD·½ up to the fee's discounting
    expect(fee.cva).toBeLessThan(base.cva);
    // a fee between two coupon dates: extra grid point, plain exposure from that date on
    const mid = computeXva(ctx, withUpfront(receiver, 1e5, "EUR", VAL + 200), credit, "EUR");
    expect(mid.profile.length).toBe(base.profile.length + 1);
    expect(mid.profile.some((p) => p.date === VAL + 200)).toBe(true);
    for (const p of mid.profile) {
      const b = base.profile.find((x) => x.date === p.date);
      if (b && p.date >= VAL + 200) expect(p.epe).toBeCloseTo(b.epe, 6);
      if (b && p.date > VAL && p.date < VAL + 200) expect(p.epe).toBeLessThan(b.epe); // netted: we pay the fee
    }
    // settled fee: identical
    const settled = computeXva(ctx, withUpfront(receiver, 1e5, "EUR", VAL - 30), credit, "EUR");
    expect(settled.cva).toBeCloseTo(base.cva, 8);
    expect(settled.method).toBe(base.method);
  });

  it("cvaFxForward: the premium date is a grid point as well (monthly grid + premium date, no duplicate on a grid date)", () => {
    const fwd = makeFxForward({ id: "F", pair: "EURUSD", baseAmount: 1e7, rate: 1.15, deliveryDate: VAL + 365 });
    const base = computeXva(ctx, fwd, credit, "EUR");
    const onGrid = computeXva(ctx, withUpfront(fwd, -2e6, "USD", base.profile[1]!.date), credit, "EUR");
    expect(onGrid.profile.length).toBe(base.profile.length);
    const off = computeXva(ctx, withUpfront(fwd, -2e6, "USD", VAL + 45), credit, "EUR");
    expect(off.profile.length).toBe(base.profile.length + 1);
    expect(off.profile.some((p) => p.date === VAL + 45)).toBe(true);
    for (const p of off.profile) {
      const b = base.profile.find((x) => x.date === p.date);
      if (b && p.date >= VAL + 45) {
        expect(p.epe).toBeCloseTo(b.epe, 6);
        expect(p.ene).toBeCloseTo(b.ene, 6);
      }
      if (b && p.date > VAL && p.date < VAL + 45) expect(p.epe).toBeGreaterThan(b.epe); // receivable netted in
    }
    expect(off.profile.map((p) => p.years)).toEqual([...off.profile.map((p) => p.years)].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// N9-3 – premium-adjusted delta is 0 without optionality
// ---------------------------------------------------------------------------
describe("N9-3 – deltaPremiumAdjusted = 0 for settled payoffs (knocked-out barrier with rebate, expired, delivered)", () => {
  const atSpot = (s: number): MarketContext => ({ ...ctx, fxSpots: { ...ctx.fxSpots, EURUSD: s } });
  const upOut = (extra: Partial<NonNullable<FxOption["barrier"]>> = {}, more: Partial<FxOption> = {}): FxOption => ({
    ...makeFxOption({ id: "B", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
    payReceive: "Receive",
    barrier: { type: "UpOut", level: 1.15, rebate: 0.01, ...extra },
    ...more,
  });

  it("UpOut 1.15 rebate 0.01 at spot 1.15: deltaPct 0 and deltaPremiumAdjusted 0 under every convention (reviewer: −0.008546 / −0.008696)", () => {
    for (const conv of [undefined, "hit", "expiry"] as const) {
      const r = priceTrade(atSpot(1.15), upOut({ rebateAt: conv }), "USD");
      expect(r.analytics.barrierState, String(conv)).toBe("knocked-out");
      expect(r.analytics.greeksMethod).toBe("settled-payoff");
      expect(r.analytics.deltaPct).toBe(0);
      expect(r.analytics.deltaPremiumAdjusted, String(conv)).toBe(0);
      expect(r.analytics.premiumQuotePerUnit).toBeGreaterThanOrEqual(0);
    }
    expect(priceTrade(ctx, upOut({ hit: true, rebateAt: "expiry" }), "USD").analytics.deltaPremiumAdjusted).toBe(0);
    // alive: Δ − P/S as before
    const alive = priceTrade(atSpot(1.149), upOut(), "USD");
    expect(alive.analytics.greeksMethod).toBe("finite-difference");
    expect(alive.analytics.deltaPremiumAdjusted).toBeCloseTo(
      (alive.analytics.deltaPct as number) - (alive.analytics.premiumQuotePerUnit as number) / 1.149,
      12,
    );
    expect(alive.analytics.deltaPremiumAdjusted).not.toBe(0);
    // expired, settlement pending (rebate claim) and delivered
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: 1.2 }] };
    const expired = priceTrade(fixing, upOut({ rebateAt: "expiry" }, { expiryDate: VAL - 1, deliveryDate: TOM }), "USD");
    expect(expired.pv).toBeGreaterThan(0);
    expect(expired.analytics.deltaPremiumAdjusted).toBe(0);
    expect(priceTrade(ctx, upOut({}, { expiryDate: VAL - 10, deliveryDate: VAL - 8 }), "USD").analytics.deltaPremiumAdjusted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// N7-5 rest – default rebate convention "hit"
// ---------------------------------------------------------------------------
describe('N7-5 rest – default knock-out rebate convention is "hit" (QuantLib): continuous at the barrier, builders set it explicitly', () => {
  const spot = getFxSpot(ctx, "EUR", "USD");
  const dfUsd = (d: number) => getDiscountCurve(ctx, "USD").df(d);
  const atSpot = (s: number): MarketContext => ({ ...ctx, fxSpots: { ...ctx.fxSpots, EURUSD: s } });
  const upOut = (extra: Partial<NonNullable<FxOption["barrier"]>> = {}, more: Partial<FxOption> = {}): FxOption => ({
    ...makeFxOption({ id: "B", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
    payReceive: "Receive",
    barrier: { type: "UpOut", level: 1.15, rebate: 0.01, ...extra },
    ...more,
  });
  const rebateAmount = 1e7 * 0.01;

  it("without rebateAt: live 99 999.45 → touched today 100 000.00 (jump 0.55, R8 default: 98 283.05 = jump −1 716.40), hit: true → 0, analytics.rebateAt = hit", () => {
    expect(DEFAULT_REBATE_AT).toBe("hit");
    expect(rebateConvention({})).toBe("hit");
    expect(rebateConvention({ rebateAt: "expiry" })).toBe("expiry");
    const alive = priceTrade(atSpot(1.149999), upOut(), "USD");
    const touched = priceTrade(atSpot(1.15), upOut(), "USD");
    expect(alive.pv).toBeCloseTo(99_999.45, 0);
    expect(touched.pv).toBeCloseTo(rebateAmount, 6);
    expect(Math.abs(alive.pv - touched.pv)).toBeLessThan(0.001 * rebateAmount);
    expect(touched.analytics.rebateAt).toBe("hit");
    expect(alive.analytics.rebateAt).toBe("hit");
    expect(priceTrade(ctx, upOut({ hit: true }), "USD").pv).toBe(0);
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: spot }] };
    const expired = priceTrade(fixing, upOut({}, { expiryDate: VAL - 1, deliveryDate: TOM }), "USD");
    expect(expired.pv).toBe(0);
    expect(expired.warnings.some((w) => w.includes("already paid at the touch (rebateAt: hit)"))).toBe(true);
    // default = explicit "hit" on every path, and equal to the R8 term-F live value
    for (const s of [1.1, 1.149999, 1.15, 1.17]) {
      expect(priceTrade(atSpot(s), upOut(), "USD").pv, String(s)).toBeCloseTo(priceTrade(atSpot(s), upOut({ rebateAt: "hit" }), "USD").pv, 8);
    }
    expect(priceTrade(atSpot(1.1), upOut(), "USD").pv).toBeCloseTo(69_031.08, 0); // reviewer: KO(hit) 69 031.08 = KO(default)
    // "expiry" is unchanged: decided knock rebate·DF(delivery)
    expect(priceTrade(atSpot(1.15), upOut({ rebateAt: "expiry" }), "USD").pv).toBeCloseTo(rebateAmount * dfUsd(VAL + 182), 6); // 98 283.05
    // DownOut put 1.12 rebate 0.02 (reviewer): default 199 999.18 → 200 000.00 instead of → 196 566.10
    const downOut = (s: number) =>
      priceTrade(atSpot(s), { ...upOut({ type: "DownOut", level: 1.12, rebate: 0.02 }), optionType: "Put", strike: 1.2 }, "USD").pv;
    expect(downOut(1.12)).toBeCloseTo(2e5, 6);
    expect(Math.abs(downOut(1.120001) - downOut(1.12))).toBeLessThan(0.001 * 2e5);
    // knock-in rebates stay at expiry under the default too
    const upIn: FxOption = { ...upOut({}, { expiryDate: VAL - 1, deliveryDate: TOM }), barrier: { type: "UpIn", level: 1.3, rebate: 0.01 } };
    expect(priceTrade(fixing, upIn, "USD").pv).toBeCloseTo(rebateAmount * dfUsd(TOM), 6);
  });

  it("makeFxOption({ barrier }) sets rebateAt: 'hit' explicitly (kept when given); the report names the default convention", () => {
    const built = makeFxOption({
      id: "K",
      pair: "EURUSD",
      optionType: "Call",
      strike: 1.1,
      notional: 1e7,
      expiryDate: VAL + 180,
      barrier: { type: "UpOut", level: 1.15, rebate: 0.01 },
    });
    expect(built.barrier).toEqual({ type: "UpOut", level: 1.15, rebate: 0.01, rebateAt: "hit" });
    const expiry = makeFxOption({
      id: "K",
      pair: "EURUSD",
      optionType: "Call",
      strike: 1.1,
      notional: 1e7,
      expiryDate: VAL + 180,
      barrier: { type: "UpOut", level: 1.15, rebateAt: "expiry" },
    });
    expect(expiry.barrier?.rebateAt).toBe("expiry");
    expect(makeFxOption({ id: "K", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL + 180 }).barrier).toBeUndefined();
    const res = priceTrade(atSpot(1.15), upOut(), "USD");
    const lines = methodologyFor(upOut(), ctx, res);
    expect(lines.some((l) => l.includes("Default-Konvention „hit“ = QuantLib"))).toBe(true);
    expect(lines.some((l) => l.includes("ohne festgelegte Konvention"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Architektur N8-02 rest – validateMarket checks the collateral mapping currency
// ---------------------------------------------------------------------------
describe("N8-02 rest – validateMarket reports a collateralDiscountCurveId mapping whose curve currency differs from the mapped currency", () => {
  it("EUR|CZK → USD curve is a problem (same text as the API), USD|EUR → USD curve is fine, a missing curve is named", () => {
    expect(validateMarket(ctx)).toEqual([]);
    const usd = SAMPLE_CURVE_IDS.usdSofr;
    expect(ctx.curves[usd]!.currency).toBe("USD");
    const wrong: MarketContext = { ...ctx, collateralDiscountCurveId: { "EUR|CZK": usd } };
    expect(validateMarket(wrong)).toEqual([`Collateral discount curve ${usd} for EUR|CZK is denominated in USD, not EUR`]);
    expect(validateMarket({ ...ctx, collateralDiscountCurveId: { "USD|EUR": usd } })).toEqual([]);
    expect(validateMarket({ ...ctx, collateralDiscountCurveId: { "CZK|EUR": "CZK-NOPE" } })).toEqual([
      "Collateral discount curve CZK-NOPE for CZK|EUR missing",
    ]);
    // the API's duplicate filter keys on the `ccy|csa` token – the core message carries it
    expect(validateMarket(wrong)[0]).toMatch(/[A-Z]{3}\|[A-Z]{3}/);
  });
});

// ---------------------------------------------------------------------------
// Architektur N9-02 (core) – rollMarket drops a stale snapshotTime, EMIR field 23 ignores one
// ---------------------------------------------------------------------------
describe("N9-02 – rollMarket keeps meta but drops snapshotTime on a date change and marks the label; emirValuationTimestamp ignores a stale snapshotTime", () => {
  const meta = { source: "import", snapshotTime: "2026-09-03T17:00:00Z", label: "EOD-0903" };
  const imported: MarketContext = { ...ctx, meta };
  const dec1 = parseISO("2026-12-01");

  it("roll to 2026-12-01: snapshotTime gone, label 'EOD-0903 (rolled to 2026-12-01)', source kept; a second roll replaces the mark; same-day roll keeps everything", () => {
    const rolled = rollMarket(imported, dec1 - VAL);
    expect(rolled.valuationDate).toBe(dec1);
    expect(rolled.meta).toEqual({ source: "import", label: "EOD-0903 (rolled to 2026-12-01)" });
    expect(imported.meta).toEqual(meta); // input untouched
    const again = rollMarket(rolled, 14);
    expect(again.meta).toEqual({ source: "import", label: "EOD-0903 (rolled to 2026-12-15)" });
    // the snapshot time's date equals the new valuation date: nothing to drop
    const sameDay: MarketContext = { ...ctx, valuationDate: VAL - 1, meta: { snapshotTime: "2026-09-03T08:00:00Z" } };
    expect(rollMarket(sameDay, 1).meta).toEqual({ snapshotTime: "2026-09-03T08:00:00Z" });
    expect(rollMarket(imported, 0).meta).toEqual(meta);
    // no label: only the time is dropped
    expect(rolledMeta({ source: "import", snapshotTime: "2026-09-03T17:00:00Z" }, dec1)).toEqual({ source: "import" });
    expect(rollMarket({ ...ctx, meta: undefined }, 30).meta).toBeUndefined();
    expect(rollMarket(ctx, 30).meta).toEqual({ ...ctx.meta, label: `${ctx.meta!.label} (rolled to ${toISO(VAL + 30)})` }); // the sample market has no snapshotTime
    // the roll still moves the curves (theta / scenario use unchanged)
    expect(rolled.curves[SAMPLE_CURVE_IDS.eurOis]!.df(dec1)).toBeCloseTo(1, 12);
  });

  it("EMIR field 23: a snapshotTime before the valuation date falls back to asOf / 17:00 UTC of the valuation date; on or after it is used", () => {
    const stale: MarketContext = { ...imported, valuationDate: dec1 };
    expect(emirValuationTimestamp(stale)).toBe("2026-12-01T17:00:00Z"); // reviewer: 2026-09-03T17:00:00Z for a valuation per 2026-12-01
    expect(emirValuationTimestamp(stale, { asOf: "2026-12-01T16:30:00Z" })).toBe("2026-12-01T16:30:00Z");
    expect(emirValuationTimestamp(stale, { timestamp: "2026-12-01T18:00:00Z" })).toBe("2026-12-01T18:00:00Z");
    expect(emirValuationTimestamp(imported)).toBe("2026-09-03T17:00:00Z");
    expect(emirValuationTimestamp({ ...imported, meta: { snapshotTime: "2026-09-04T01:00:00Z" } })).toBe("2026-09-04T01:00:00Z");
    expect(emirValuationTimestamp({ ...imported, meta: { snapshotTime: "2026-09-02" } })).toBe("2026-09-03T17:00:00Z");
    // the rolled market itself carries no snapshotTime any more
    expect(emirValuationTimestamp(rollMarket(imported, dec1 - VAL))).toBe("2026-12-01T17:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// Ohne Abzug – report sentence names the premium exclusion and the all-in view
// ---------------------------------------------------------------------------
describe("R9 – methodology sentence: par rate / fair spread from the economic legs, premium excluded, all-in view named", () => {
  it("swap without fee: generic hint; swap with fee: the all-in par rate is quoted", () => {
    const payer = makeVanillaSwap({
      id: "P",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.03,
      effectiveDate: VAL + 2,
      maturity: "10Y",
    });
    const plain = methodologyFor(payer, ctx, priceTrade(ctx, payer, "EUR")).find((l) => l.startsWith("Barwert = Summe"))!;
    expect(plain).toContain(
      "Annuität der ökonomischen Legs – eine Upfront-Prämie ist ausgenommen, die All-in-Sicht inkl. Prämie steht als „Par-Satz all-in“ bzw. „fairer Spread all-in“ in den Kennzahlen;",
    );
    const fee = withUpfront(payer, 1e5, "EUR", VAL + 2);
    const res = priceTrade(ctx, fee, "EUR");
    const line = methodologyFor(fee, ctx, res).find((l) => l.startsWith("Barwert = Summe"))!;
    expect(line).toContain("in den Kennzahlen (hier 2,7");
    expect(line).not.toMatch(/[a-z][A-Z]/); // German prose without code identifiers (UI R3-06)
    expect(res.analytics.parRateAllIn).toBeCloseTo(0.0277, 3); // reviewer: 2.7651 %
  });
});
