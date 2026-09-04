import { describe, expect, it } from "vitest";
import {
  RATE_INDICES,
  type RateIndex,
  type SwapConventions,
  getIndex,
  indexScheduleCalendar,
  registerRateIndex,
  validateRateIndex,
  validateSwapConventions,
} from "../curves/index-definitions.js";
import {
  QUANTLIB_CROSS_CHECKED_CALENDARS,
  adjust,
  addBusinessDays,
  getCalendar,
  isBuiltInCalendar,
  isBusinessDay,
  listCustomCalendars,
  registerCalendar,
  validateCustomCalendar,
} from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { buildSchedule } from "../dates/schedule.js";
import { PricingError } from "../errors.js";
import { makeBasisSwap, makeCrossCurrencySwap, makeFxForward, makeFxOption, makeVanillaSwap } from "../instruments/builders.js";
import { type FloatLeg, type ForwardRateAgreement, type FxOption, type InterestRateSwap, type Trade } from "../instruments/types.js";
import { fxSpotDateFrom } from "../market/fx-spot.js";
import { type Fixing, type MarketContext, getCurve, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, SAMPLE_EURUSD_VOLS, buildSampleMarket } from "../market/sample-market.js";
import { VOL_IMPLAUSIBLE_PREFIX, VOL_PLAUSIBILITY, surfaceVolWarnings, validateVolSurfaces, volSurfaceWarnings } from "../market/vol-validation.js";
import { type FxVolSurface, fxVolAtStrike } from "../models/fx-vol-surface.js";
import { garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { methodologyFor } from "../reporting/valuation-report.js";
import { computeXva } from "../xva/cva.js";
import { BARRIER_STATE_UNKNOWN_PREFIX } from "./fx-pricer.js";
import { projectFloatingRate } from "./leg-pricer.js";
import { discountedCurrencies, priceTrade, validateTrade } from "./price.js";

const VAL = parseISO("2026-09-03");
const TOM = VAL + 1;
const ctx = buildSampleMarket(VAL);
const credit = { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

const withUpfront = <T extends Trade>(t: T, amount: number, currency: string, date: number): T => ({ ...t, upfront: { amount, currency, date } });
const payer = makeVanillaSwap({ id: "P", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: VAL + 2, maturity: "10Y" });
const receiver: InterestRateSwap = { ...payer, id: "R", legs: payer.legs.map((l) => ({ ...l, payReceive: l.payReceive === "Pay" ? "Receive" : "Pay" })) };

// ---------------------------------------------------------------------------
// N8-1 – par rate / fair spread from the economic legs; the fee does not shift the CVA forwards
// ---------------------------------------------------------------------------
describe("N8-1 – upfront fee: parRate / fairSpread are analytics of the economic legs, parRateAllIn carries the fee, CVA replication forwards unchanged", () => {
  const plain = priceTrade(ctx, payer, "EUR");

  it("IRS 10Y payer 3 % ± fee → identical parRate (2.88 %), parRateAllIn = coupon zeroing the total PV (100 k at spot: −11.5 bp)", () => {
    expect(plain.analytics.parRate).toBeCloseTo(0.0288, 4); // reviewer: 2.8800 %
    expect(plain.analytics.parRateAllIn).toBeUndefined();
    expect(plain.analytics.fairSpreadAllIn).toBeUndefined();
    for (const [amount, date] of [
      [1e5, VAL + 2],
      [1e5, VAL + 365],
      [5e5, VAL + 365],
      [-2e5, VAL + 2],
    ] as const) {
      const r = priceTrade(ctx, withUpfront(payer, amount, "EUR", date), "EUR");
      expect(r.analytics.parRate, `fee ${amount}`).toBeCloseTo(plain.analytics.parRate as number, 12);
      expect(r.analytics.parRateBase).toBeCloseTo(plain.analytics.parRateBase as number, 12);
      expect(r.analytics.parRateFlat).toBeCloseTo(plain.analytics.parRateFlat as number, 12);
      expect(r.analytics.fairSpread).toBeCloseTo(plain.analytics.fairSpread as number, 12);
      // all-in coupon: the fee we pay lowers the coupon that zeroes the total PV
      const allIn = r.analytics.parRateAllIn as number;
      expect(allIn).not.toBeCloseTo(r.analytics.parRate as number, 6);
      expect(Math.sign(allIn - (r.analytics.parRate as number))).toBe(-Math.sign(amount));
      expect(typeof r.analytics.fairSpreadAllIn).toBe("number");
    }
    const feeAtSpot = priceTrade(ctx, withUpfront(payer, 1e5, "EUR", VAL + 2), "EUR");
    expect((feeAtSpot.analytics.parRateAllIn as number) - (plain.analytics.parRate as number)).toBeCloseTo(-0.001149, 5); // reviewer: 2.7651 %
    // a settled fee changes nothing
    const settled = priceTrade(ctx, withUpfront(payer, 1e5, "EUR", VAL - 30), "EUR");
    expect(settled.analytics.parRateAllIn).toBeCloseTo(plain.analytics.parRate as number, 12);
    // the all-in coupon really zeroes the total PV
    const allInSwap: InterestRateSwap = {
      ...withUpfront(payer, 1e5, "EUR", VAL + 2),
      legs: payer.legs.map((l) => (l.type === "Fixed" ? { ...l, rate: feeAtSpot.analytics.parRateAllIn as number } : l)),
    };
    expect(Math.abs(priceTrade(ctx, allInSwap, "EUR").pv)).toBeLessThan(1e-4);
  });

  it("CVA with a fee paid at spot equals the CVA without fee (±0.1 %), the exposure profile from t > 0 is identical for paid and received fees", () => {
    const base = computeXva(ctx, payer, credit, "EUR");
    expect(base.cva).toBeGreaterThan(20_000); // reviewer: 24 666
    for (const [amount, date] of [
      [1e5, VAL + 2],
      [1e5, VAL + 365],
      [5e5, VAL + 365],
    ] as const) {
      const fee = computeXva(ctx, withUpfront(payer, amount, "EUR", date), credit, "EUR");
      expect(Math.abs(fee.cva / base.cva - 1), `fee ${amount} in ${date - VAL} d`).toBeLessThan(0.001); // R8: −19.6 % / −19.2 % / −65.6 %
      expect(fee.profile.length).toBe(base.profile.length);
      fee.profile.slice(1).forEach((p, i) => {
        expect(p.epe).toBeCloseTo(base.profile[i + 1]!.epe, 6);
        expect(p.ene).toBeCloseTo(base.profile[i + 1]!.ene, 6);
      });
    }
    // the payer's PV is negative with and without the paid fee: t = 0 exposure 0 in both cases
    expect(base.profile[0]!.epe).toBe(0);
  });

  it("receiver symmetry: a received fee only nets the t = 0 exposure – every later point equals the plain receiver's, the plain receiver CVA is unchanged", () => {
    const base = computeXva(ctx, receiver, credit, "EUR");
    const fee = computeXva(ctx, withUpfront(receiver, -2e5, "EUR", VAL + 2), credit, "EUR");
    expect(base.cva).toBeGreaterThan(15_000); // reviewer: 21 363
    fee.profile.slice(1).forEach((p, i) => {
      expect(p.epe).toBeCloseTo(base.profile[i + 1]!.epe, 6);
      expect(p.ene).toBeCloseTo(base.profile[i + 1]!.ene, 6);
    });
    // t = 0: the open premium we receive adds to the current PV (allowed: it is exposure until it is paid)
    const pvFee = priceTrade(ctx, withUpfront(receiver, -2e5, "EUR", VAL + 2), "EUR").pv;
    expect(fee.profile[0]!.epe).toBeCloseTo(Math.max(pvFee, 0), 6);
    // only the first trapezoid differs
    const lgd = 1 - credit.cptyRecovery;
    const firstTerm = lgd * fee.profile[1]!.pdCpty * 0.5 * (fee.profile[0]!.epe - base.profile[0]!.epe);
    expect(fee.cva - base.cva).toBeCloseTo(firstTerm, 6);
    expect(Math.abs(fee.cva / base.cva - 1)).toBeLessThan(0.1); // R8: +56.6 %
  });

  it("basis swap: fairSpread invariant to the fee (fairSpreadAllIn separate), CVA profile from t > 0 unchanged", () => {
    const basis = makeBasisSwap({
      id: "BS",
      currency: "EUR",
      notional: 1e7,
      effectiveDate: VAL + 2,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0,
    });
    const plainBs = priceTrade(ctx, basis, "EUR");
    const feeBs = priceTrade(ctx, withUpfront(basis, 1e5, "EUR", VAL + 2), "EUR");
    expect(feeBs.analytics.fairSpread).toBeCloseTo(plainBs.analytics.fairSpread as number, 12); // R8: −0.0784 % → +0.1317 %
    expect(feeBs.analytics.fairSpreadAllIn).toBeGreaterThan(plainBs.analytics.fairSpread as number);
    expect(plainBs.analytics.fairSpreadAllIn).toBeUndefined();
    const base = computeXva(ctx, basis, credit, "EUR");
    const fee = computeXva(ctx, withUpfront(basis, 1e5, "EUR", VAL + 2), credit, "EUR");
    expect(base.method).toMatch(/Basis-swaption/);
    fee.profile.slice(1).forEach((p, i) => expect(p.epe).toBeCloseTo(base.profile[i + 1]!.epe, 6));
    expect(Math.abs(fee.cva / base.cva - 1)).toBeLessThan(0.05); // R8: 2 809 → 294 (−89.5 %)
  });
});

// ---------------------------------------------------------------------------
// N8-2 – FX forward CVA nets the open premium
// ---------------------------------------------------------------------------
describe("N8-2 – cvaFxForward nets an open premium (profile[0].epe = max(PV, 0), strike shift until the premium date)", () => {
  const fwd = makeFxForward({ id: "F", pair: "EURUSD", baseAmount: 1e7, rate: 1.15, deliveryDate: VAL + 365 });

  it("FX forward + 50 k USD fee in 30 days: EPE(0) = max(PV, 0) incl. fee, CVA below the no-fee CVA, points after the fee date unchanged", () => {
    const base = computeXva(ctx, fwd, credit, "EUR");
    const fee = withUpfront(fwd, 5e4, "USD", VAL + 30);
    const res = computeXva(ctx, fee, credit, "EUR");
    const pv = priceTrade(ctx, fee, "EUR").pv;
    expect(res.profile[0]!.epe).toBe(Math.max(pv, 0));
    expect(res.profile[0]!.ene).toBe(Math.max(-pv, 0));
    expect(base.profile[0]!.epe).toBe(Math.max(priceTrade(ctx, fwd, "EUR").pv, 0)); // R8: 141 132 = PV without fee
    expect(pv).toBeLessThan(base.profile[0]!.epe);
    expect(res.cva).toBeLessThan(base.cva); // R8: 547.09 = unchanged
    expect(res.cva).toBeGreaterThan(0.9 * base.cva);
    expect(res.method).toContain("open premium netted");
    // grid points after the premium date: the plain forward exposure
    res.profile.forEach((p, i) => {
      if (i === 0) return;
      const b = base.profile[i]!;
      if (p.date >= VAL + 30) {
        // premium paid on or before the grid date: plain forward exposure
        expect(p.epe).toBeCloseTo(b.epe, 6);
        expect(p.ene).toBeCloseTo(b.ene, 6);
      } else expect(p.epe).toBeLessThan(b.epe);
    });
    // a received fee raises the exposure, a settled fee changes nothing
    expect(computeXva(ctx, withUpfront(fwd, -5e4, "USD", VAL + 30), credit, "EUR").cva).toBeGreaterThan(base.cva);
    const settled = computeXva(ctx, withUpfront(fwd, 5e4, "USD", VAL - 5), credit, "EUR");
    expect(settled.cva).toBeCloseTo(base.cva, 8);
    expect(settled.method).toBe(base.method);
  });
});

// ---------------------------------------------------------------------------
// N8-3 – COLLATERAL_CURVE_MISSING only for currencies with a discounting need
// ---------------------------------------------------------------------------
describe("N8-3 – collateral-curve warning only for discounted currencies (economic legs + unpaid premium)", () => {
  const csa: InterestRateSwap = { ...payer, id: "CSA", collateralCurrency: "EUR" };

  it("EUR IRS under EUR CSA: a USD / GBP / NOK premium paid 30 days ago raises no warning, an unpaid USD premium still does", () => {
    expect(priceTrade(ctx, csa, "EUR").warnings).toEqual([]);
    for (const ccy of ["USD", "GBP", "NOK"]) {
      const paid = withUpfront(csa, 1e5, ccy, VAL - 30);
      expect(priceTrade(ctx, paid, "EUR").warnings, ccy).toEqual([]); // R8: COLLATERAL_CURVE_MISSING for the paid premium currency
      expect(discountedCurrencies(ctx, paid)).toEqual(["EUR"]);
    }
    const unpaid = withUpfront(csa, 1e5, "USD", VAL + 365);
    expect(discountedCurrencies(ctx, unpaid)).toEqual(["EUR", "USD"]);
    const w = priceTrade(ctx, unpaid, "EUR").warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^COLLATERAL_CURVE_MISSING: no USD discount curve for collateral in EUR/);
    // EUR premium under EUR CSA: never
    expect(priceTrade(ctx, withUpfront(csa, 1e5, "EUR", VAL + 365), "EUR").warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// N8-4 – SOFR fixing calendar US-SIFMA (Good Friday), payment calendar US
// ---------------------------------------------------------------------------
describe("N8-4 – SOFR fixes on the SIFMA calendar (Good Friday closed), USD schedules stay on the US settlement calendar", () => {
  const sifma = getCalendar("US-SIFMA");
  const us = getCalendar("US");
  const goodFriday = parseISO("2026-04-03");

  it("calendar facts: Good Friday is a SIFMA holiday and a US settlement business day; 31.12.2027 / 10.11.2028 / 31.12.2032 the other way round", () => {
    expect(isBusinessDay(goodFriday, us)).toBe(true);
    expect(isBusinessDay(goodFriday, sifma)).toBe(false);
    for (const iso of ["2027-12-31", "2028-11-10", "2032-12-31"]) {
      expect(isBusinessDay(parseISO(iso), us), iso).toBe(false);
      expect(isBusinessDay(parseISO(iso), sifma), iso).toBe(true);
    }
    expect(getCalendar("SOFR")).toBe(sifma);
    expect(getIndex("SOFR").fixingCalendar).toBe("US-SIFMA");
    expect(getIndex("SOFR").paymentCalendar).toBe("US");
    expect(indexScheduleCalendar(getIndex("SOFR"))).toBe("US");
    expect(indexScheduleCalendar(getIndex("ESTR"))).toBe("TARGET");
    expect(QUANTLIB_CROSS_CHECKED_CALENDARS).toContain("US-SIFMA");
    expect(isBuiltInCalendar("US-SIFMA")).toBe(true);
    expect(isBuiltInCalendar("sofr")).toBe(true);
  });

  it("USD OIS 2Y from 15.01.2026 with a SOFR history on SIFMA days only (no 03.04.2026): no MISSING_FIXING, Thursday's rate accrues over four days", () => {
    const start = parseISO("2026-01-15");
    const rate = 0.043;
    const fixings: Fixing[] = [];
    for (let d = start - 10; d < VAL; d++) if (isBusinessDay(d, sifma)) fixings.push({ index: "SOFR", date: d, value: rate });
    expect(fixings.some((f) => f.date === goodFriday)).toBe(false);
    const market: MarketContext = { ...ctx, fixings };
    const ois = makeVanillaSwap({
      id: "OIS",
      currency: "USD",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.04,
      effectiveDate: start,
      maturity: "2Y",
      index: "SOFR",
    });
    const res = priceTrade(market, ois, "USD");
    expect(res.warnings.filter((w) => w.startsWith("MISSING_FIXING"))).toEqual([]); // R8: MISSING_FIXING SOFR 2026-04-03, PV −642
    // realised compounding to date = Π(1 + r·τ_i) over SIFMA business days (Thursday 02.04. → Monday 06.04. weighs 4/360)
    const float = ois.legs.find((l): l is FloatLeg => l.type === "Float")!;
    const period = buildSchedule({ ...float, businessDayConvention: "ModifiedFollowing", stub: "ShortFront", paymentLag: float.paymentLag ?? 0 }).periods[0]!;
    const proj = projectFloatingRate(market, float, period, getCurve(market, SAMPLE_CURVE_IDS.usdSofr));
    let manual = 1;
    for (let d = period.accrualStart; d < VAL;) {
      const next = Math.min(addBusinessDays(d, 1, sifma), VAL);
      manual *= 1 + rate * yearFraction(d, next, "ACT/360");
      d = next;
    }
    expect(proj.accruedRateTau).toBeCloseTo(manual - 1, 12);
    expect(toISO(addBusinessDays(parseISO("2026-04-02"), 1, sifma))).toBe("2026-04-06");
    // the payment schedule is unchanged (US calendar): the leg calendar is the conventions' calendar
    expect(float.calendar).toBe("US");
    // a history on US settlement days that lacks the Good Friday would have warned under the old fixing calendar
    const usFixings: Fixing[] = [];
    for (let d = start - 10; d < VAL; d++) if (isBusinessDay(d, us) && d !== goodFriday) usFixings.push({ index: "SOFR", date: d, value: rate });
    expect(priceTrade({ ...ctx, fixings: usFixings }, ois, "USD").warnings.filter((w) => w.startsWith("MISSING_FIXING"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// N8-5 – Japan calendar (set equality with QuantLib: golden.test.ts)
// ---------------------------------------------------------------------------
describe("N8-5 – JP substitute / citizens' holidays and equinoxes; report names only cross-checked calendars", () => {
  it("USDJPY spot from 01.05.2026 → 08.05., from 18.09.2026 → 25.09.; JPY 6M schedule from 06.11.2025 ends 07.05.2026 (QuantLib / JPX)", () => {
    const jp = getCalendar("JP");
    for (const iso of ["2026-05-06", "2026-09-22", "2027-03-22", "2028-09-22", "2031-03-21", "2032-09-22", "2024-05-06", "2025-05-06"]) {
      expect(isBusinessDay(parseISO(iso), jp), iso).toBe(false); // R8: business days in the engine
    }
    expect(isBusinessDay(parseISO("2031-03-20"), jp)).toBe(true);
    expect(isBusinessDay(parseISO("2032-09-23"), jp)).toBe(true);
    expect(toISO(fxSpotDateFrom(parseISO("2026-05-01"), "USD", "JPY"))).toBe("2026-05-08"); // R8: 07.05.
    expect(toISO(fxSpotDateFrom(parseISO("2026-09-18"), "USD", "JPY"))).toBe("2026-09-25"); // R8: 24.09.
    expect(toISO(adjust(parseISO("2026-05-06"), "ModifiedFollowing", jp))).toBe("2026-05-07");
    // 2028: New Year's Day on a Saturday – only the bank holiday 03.01. remains, Golden Week without substitute
    expect(isBusinessDay(parseISO("2028-01-03"), jp)).toBe(false);
    expect(isBusinessDay(parseISO("2028-01-04"), jp)).toBe(true);
    expect(isBusinessDay(parseISO("2028-05-08"), jp)).toBe(true);
  });

  it("the convention sentence lists TARGET2/US/UK/CH/JP/NO/SE/DK/PL plus the SOFR fixing calendar – exactly the golden-tested calendars", () => {
    const lines = methodologyFor(payer, ctx, priceTrade(ctx, payer, "EUR"));
    const line = lines.find((l) => l.includes("TARGET2/US/UK/CH/JP/NO/SE/DK/PL"))!;
    expect(line).toBeDefined();
    expect(line).toContain("US-SIFMA");
    expect(line).not.toMatch(/\bDE\b/);
    expect(QUANTLIB_CROSS_CHECKED_CALENDARS).toEqual(["TARGET", "US", "UK", "CH", "JP", "NO", "SE", "DK", "PL", "US-SIFMA"]);
  });
});

// ---------------------------------------------------------------------------
// N8-6 – smile pillar plausibility
// ---------------------------------------------------------------------------
describe("N8-6 – FX smile pillars: ATM + BF ± RR/2 must be positive, |RR| / |BF| bounded; the pricer warns and refuses negative pillars", () => {
  const rr30: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, id: "EURUSD-RR30", rr25: SAMPLE_EURUSD_VOLS.rr25.map(() => 0.3) };
  const bf500: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, id: "EURUSD-BF500", bf25: SAMPLE_EURUSD_VOLS.bf25.map(() => 5) };
  const option = makeFxOption({ id: "O", pair: "EURUSD", optionType: "Put", strike: 1.2, notional: 1e7, expiryDate: VAL + 365, deliveryDate: VAL + 367 });

  it("rr25 = 0.30 → VOL_IMPLAUSIBLE per expiry (25Δ put pillar −7 %), structurally still valid; the sample smiles stay clean", () => {
    expect(validateVolSurfaces({ fxVols: { EURUSD: rr30 } })).toEqual([]);
    const w = volSurfaceWarnings({ fxVols: { EURUSD: rr30 } });
    expect(w.length).toBe(rr30.expiries.length);
    expect(w[0]).toMatch(/^VOL_IMPLAUSIBLE: fxVols\.EURUSD: 25Δ put pillar vol at 1W is -\d+\.\d\d % \(ATM \d+\.\d\d % \+ BF \d+\.\d\d % − RR 30\.00 %\/2\)/);
    expect(w[1]).toContain("at 1M is");
    expect(w[4]).toContain("at 1Y is"); // R8 probe: 25Δ put −7.23 % at 1Y
    expect(w[0]).toContain("|RR| ≤ 2·(ATM + BF)");
    expect(volSurfaceWarnings({ fxVols: ctx.fxVols! })).toEqual([]);
    expect(VOL_PLAUSIBILITY.fxSmileMax).toBe(0.5);
    // bf25 = 500 %: pillars positive but the quote is not a vol difference
    const wb = volSurfaceWarnings({ fxVols: { EURUSD: bf500 } });
    expect(wb.length).toBe(bf500.expiries.length);
    expect(wb[0]).toMatch(/25Δ butterfly 500\.00 % at 1W exceeds 50\.00 %/);
    // 10Δ quotes are checked too
    const rr10: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, id: "EURUSD-RR10", rr10: SAMPLE_EURUSD_VOLS.rr25.map(() => 0.5), bf10: SAMPLE_EURUSD_VOLS.bf25 };
    expect(volSurfaceWarnings({ fxVols: { EURUSD: rr10 } }).every((m) => m.includes("10Δ put pillar vol"))).toBe(true);
  });

  it("the pricer repeats the warning and raises INVALID_VOL_SURFACE instead of valuing a 1.20 put at 10.81 % with a negative pillar", () => {
    const market: MarketContext = { ...ctx, fxVols: { ...ctx.fxVols, EURUSD: rr30 } };
    expect(surfaceVolWarnings(rr30).some((m) => m.startsWith(`${VOL_IMPLAUSIBLE_PREFIX} FX vol surface EURUSD-RR30: 25Δ put pillar vol`))).toBe(true);
    expect(codeOf(() => priceTrade(market, option, "USD"))).toBe("INVALID_VOL_SURFACE");
    expect(() => fxVolAtStrike(rr30, 1, 1.17, 1.2)).toThrow(/25Δ put pillar vol at expiry 1 is -\d+\.\d\d %/);
    // the sample smile prices the put at ≈ 7.9 % (R8 probe: 7.852 %)
    const sane = priceTrade(ctx, option, "USD");
    expect(sane.analytics.volatility).toBeGreaterThan(0.07);
    expect(sane.analytics.volatility).toBeLessThan(0.09);
    expect(sane.warnings).toEqual([]);
    // a huge butterfly prices (positive pillars) but carries the warning
    const wide = priceTrade({ ...ctx, fxVols: { ...ctx.fxVols, EURUSD: bf500 } }, option, "USD");
    expect(wide.warnings.some((m) => m.includes("butterfly 500.00 %"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N7-5 rest – barrier.rebateAt: one convention for the live model, the hit path and the expired path
// ---------------------------------------------------------------------------
describe("N7-5 (R8) – barrier.rebateAt drives the model (rebateAtExpiry) and every decided path; PV continuous across the barrier", () => {
  const spot = getFxSpot(ctx, "EUR", "USD"); // 1.1625
  const dfUsd = (d: number) => getDiscountCurve(ctx, "USD").df(d);
  const atSpot = (s: number): MarketContext => ({ ...ctx, fxSpots: { ...ctx.fxSpots, EURUSD: s } });
  const upOut = (extra: Partial<FxOption["barrier"]> = {}, more: Partial<FxOption> = {}): FxOption => ({
    ...makeFxOption({ id: "B", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
    payReceive: "Receive",
    barrier: { type: "UpOut", level: 1.15, rebate: 0.01, ...extra },
    ...more,
  });
  const rebateAmount = 1e7 * 0.01; // 100 000 USD

  it('"expiry": live value at 1.149999 ≈ knocked value rebate·DF(delivery) (jump < 0.1 % of the rebate), hit: true and expired paths identical', () => {
    const alive = priceTrade(atSpot(1.149999), upOut({ rebateAt: "expiry" }), "USD");
    const knocked = priceTrade(atSpot(1.15), upOut({ rebateAt: "expiry" }), "USD");
    expect(alive.analytics.barrierState).toBe("alive");
    expect(knocked.analytics.barrierState).toBe("knocked-out");
    expect(knocked.pv).toBeCloseTo(rebateAmount * dfUsd(VAL + 182), 6);
    expect(Math.abs(alive.pv - knocked.pv)).toBeLessThan(0.001 * rebateAmount); // R8 default: 99 999.45 vs 98 283.05 (1.7 %)
    expect(priceTrade(ctx, upOut({ rebateAt: "expiry", hit: true }), "USD").pv).toBeCloseTo(knocked.pv, 6);
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: spot }] };
    const expired = priceTrade(fixing, upOut({ rebateAt: "expiry" }, { expiryDate: VAL - 1, deliveryDate: TOM }), "USD");
    expect(expired.pv).toBeCloseTo(rebateAmount * dfUsd(TOM), 6);
    expect(knocked.analytics.rebateAt).toBe("expiry");
    // a rebate-only structure (strike far OTM) tends to rebate·DF as the spot approaches the barrier
    const rebateOnly = priceTrade(atSpot(1.1499), upOut({ rebateAt: "expiry" }, { strike: 1.2 }), "USD");
    expect(Math.abs(rebateOnly.pv - rebateAmount * dfUsd(VAL + 182)) / rebateAmount).toBeLessThan(0.01);
  });

  it('"hit": live value at 1.149999 ≈ rebate paid today (DF 1), hit: true / expired knock-out = already paid (0)', () => {
    const alive = priceTrade(atSpot(1.149999), upOut({ rebateAt: "hit" }), "USD");
    const touchedToday = priceTrade(atSpot(1.15), upOut({ rebateAt: "hit" }), "USD");
    expect(touchedToday.pv).toBeCloseTo(rebateAmount, 6);
    expect(Math.abs(alive.pv - touchedToday.pv)).toBeLessThan(0.001 * rebateAmount);
    expect(touchedToday.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX) && w.includes("paid at the touch today"))).toBe(true);
    const recorded = priceTrade(ctx, upOut({ rebateAt: "hit", hit: true }), "USD");
    expect(recorded.pv).toBe(0);
    expect(recorded.analytics.barrierState).toBe("knocked-out");
    expect(recorded.warnings.some((w) => w.includes("already paid at the touch"))).toBe(true);
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: spot }] };
    const expired = priceTrade(fixing, upOut({ rebateAt: "hit" }, { expiryDate: VAL - 1, deliveryDate: TOM }), "USD");
    expect(expired.pv).toBe(0);
    expect(expired.warnings.some((w) => w.includes("already paid at the touch (rebateAt: hit)"))).toBe(true);
    // the knock-in rebate is paid at expiry under every convention
    const upIn = (rebateAt?: "hit" | "expiry") => upOut({ type: "UpIn", level: 1.3, rebateAt }, { expiryDate: VAL - 1, deliveryDate: TOM, barrier: undefined });
    for (const conv of ["hit", "expiry", undefined] as const) {
      const t: FxOption = { ...upIn(conv), barrier: { type: "UpIn", level: 1.3, rebate: 0.01, rebateAt: conv } };
      expect(priceTrade(fixing, t, "USD").pv, String(conv)).toBeCloseTo(rebateAmount * dfUsd(TOM), 6);
    }
  });

  it("default (rebateAt undefined) keeps the round-7 behaviour: live at the hit, decided paths rebate·DF(delivery)", () => {
    const alive = priceTrade(atSpot(1.149999), upOut(), "USD");
    const knocked = priceTrade(atSpot(1.15), upOut(), "USD");
    expect(knocked.pv).toBeCloseTo(rebateAmount * dfUsd(VAL + 182), 6); // 98 283.05
    expect(alive.pv).toBeGreaterThan(0.999 * rebateAmount); // 99 999.45
    expect(knocked.analytics.rebateAt).toBe("default");
    expect(priceTrade(ctx, upOut({ hit: true }), "USD").pv).toBeCloseTo(knocked.pv, 6);
    // validation
    expect(validateTrade(upOut({ rebateAt: "later" as unknown as "hit" }))).toEqual([
      expect.stringContaining('trade.barrier.rebateAt must be "hit" or "expiry"'),
    ]);
    // the report names the convention
    expect(methodologyFor(upOut({ rebateAt: "expiry" }), ctx, knocked).some((l) => l.includes("Konvention „expiry“"))).toBe(true);
    expect(methodologyFor(upOut(), ctx, knocked).some((l) => l.includes("ohne festgelegte Konvention"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N8-7 – lockout compounding
// ---------------------------------------------------------------------------
describe("N8-7 – lockoutDays: the fixing of business day end − k is frozen for the last k business days (realised and projected)", () => {
  const sifma = getCalendar("US-SIFMA");
  const usdCurve = getCurve(ctx, SAMPLE_CURVE_IDS.usdSofr);
  const leg = (effectiveDate: number, terminationDate: number, lockoutDays: number): FloatLeg => ({
    type: "Float",
    payReceive: "Receive",
    notional: 1e7,
    currency: "USD",
    effectiveDate,
    terminationDate,
    frequency: "3M",
    dayCount: "ACT/360",
    calendar: "US",
    index: "SOFR",
    paymentLag: 2,
    lockoutDays,
  });
  const periodOf = (l: FloatLeg) =>
    buildSchedule({ ...l, businessDayConvention: "ModifiedFollowing", stub: "ShortFront", paymentLag: l.paymentLag ?? 0 }).periods[0]!;

  it("fully realised period 01.06.–03.08.2026 with a 2-day lockout: rate = manual compounding with the 30.07. fixing frozen from 30.07.", () => {
    const start = parseISO("2026-06-01");
    const end = parseISO("2026-08-03");
    const fixings: Fixing[] = [];
    for (let d = start - 5; d < VAL; d++) if (isBusinessDay(d, sifma)) fixings.push({ index: "SOFR", date: d, value: 0.04 + 0.0002 * ((d - start) % 7) });
    const market: MarketContext = { ...ctx, fixings };
    const l = leg(start, end, 2);
    const lockoutDate = addBusinessDays(end, -2, sifma);
    expect(toISO(lockoutDate)).toBe("2026-07-30");
    const fix = (d: number) => fixings.find((f) => f.date === d)!.value;
    let manual = 1;
    for (let d = start; d < end;) {
      const next = Math.min(addBusinessDays(d, 1, sifma), end);
      manual *= 1 + fix(d >= lockoutDate ? lockoutDate : d) * yearFraction(d, next, "ACT/360");
      d = next;
    }
    const proj = projectFloatingRate(market, l, periodOf(l), usdCurve);
    expect(proj.isFixed).toBe(true);
    expect(proj.rate).toBeCloseTo((manual - 1) / yearFraction(start, end, "ACT/360"), 14);
    // without lockout the last two business days use their own fixings – a different rate
    const plain = projectFloatingRate(market, leg(start, end, 0), periodOf(leg(start, end, 0)), usdCurve);
    expect(plain.rate).not.toBeCloseTo(proj.rate, 8);
    // lockout longer than the period: the whole period is frozen at the first day's fixing
    const all = projectFloatingRate(market, leg(start, end, 60), periodOf(leg(start, end, 60)), usdCurve);
    expect(all.rate).toBeCloseTo(compoundFlat(fix(start), start, end) / yearFraction(start, end, "ACT/360"), 12);
  });

  it("projected period 15.09.–15.12.2026 with a 3-day lockout: telescoping forward to 10.12., then the 10.12. overnight forward day by day", () => {
    const start = parseISO("2026-09-15");
    const end = parseISO("2026-12-15");
    const l = leg(start, end, 3);
    const lockoutDate = addBusinessDays(end, -3, sifma);
    expect(toISO(lockoutDate)).toBe("2026-12-10");
    const fwd = usdCurve.forwardRate(start, lockoutDate, "ACT/360");
    const rLock = usdCurve.forwardRate(lockoutDate, addBusinessDays(lockoutDate, 1, sifma), "ACT/360");
    let manual = 1 + fwd * yearFraction(start, lockoutDate, "ACT/360");
    for (let d = lockoutDate; d < end;) {
      const next = Math.min(addBusinessDays(d, 1, sifma), end);
      manual *= 1 + rLock * yearFraction(d, next, "ACT/360");
      d = next;
    }
    const proj = projectFloatingRate(ctx, l, periodOf(l), usdCurve);
    expect(proj.isFixed).toBe(false);
    expect(proj.rate).toBeCloseTo((manual - 1) / yearFraction(start, end, "ACT/360"), 14);
    // the plain projection telescopes over the whole period
    const plain = projectFloatingRate(ctx, leg(start, end, 0), periodOf(leg(start, end, 0)), usdCurve);
    expect(plain.rate).toBeCloseTo(usdCurve.forwardRate(start, end, "ACT/360"), 12);
    expect(Math.abs(proj.rate - plain.rate)).toBeLessThan(2e-4);
    // priced leg: the swap builder's OIS leg with a lockout prices without warnings, the report names it
    const ois = makeVanillaSwap({
      id: "L",
      currency: "USD",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.04,
      effectiveDate: VAL + 2,
      maturity: "2Y",
      index: "SOFR",
    });
    const locked: InterestRateSwap = { ...ois, legs: ois.legs.map((x) => (x.type === "Float" ? { ...x, lockoutDays: 2 } : x)) };
    expect(validateTrade(locked)).toEqual([]);
    const res = priceTrade(ctx, locked, "USD");
    expect(res.warnings).toEqual([]);
    expect(Math.abs(res.pv - priceTrade(ctx, ois, "USD").pv)).toBeLessThan(2_000);
    expect(methodologyFor(locked, ctx, res).some((x) => x.includes("Lockout 2 Geschäftstage"))).toBe(true);
  });

  it("validation: lockout is a non-negative integer and not combinable with lookback / observation shift", () => {
    const base = leg(VAL + 2, VAL + 92, 2);
    const swap = (fl: Partial<FloatLeg>): InterestRateSwap => ({ id: "V", type: "InterestRateSwap", legs: [{ ...base, ...fl }] });
    expect(validateTrade(swap({}))).toEqual([]);
    expect(validateTrade(swap({ lockoutDays: -1 }))).toEqual([expect.stringContaining("legs[0].lockoutDays must be a non-negative integer")]);
    expect(validateTrade(swap({ lockoutDays: 1.5 }))).toEqual([expect.stringContaining("legs[0].lockoutDays must be a non-negative integer")]);
    expect(validateTrade(swap({ lookbackDays: 5 }))).toEqual([expect.stringContaining("lockoutDays cannot be combined with lookbackDays / observationShift")]);
    expect(validateTrade(swap({ observationShift: true }))).toEqual([expect.stringContaining("lockoutDays cannot be combined")]);
    expect(validateTrade(swap({ lockoutDays: 0, lookbackDays: 5 }))).toEqual([]);
    expect(codeOf(() => priceTrade(ctx, swap({ lookbackDays: 5 }), "USD"))).toBe("INVALID_TRADE");
  });
});

/** Π(1 + r·τ_i) − 1 over the SIFMA business days of [start, end) at a flat rate r. */
function compoundFlat(r: number, start: number, end: number): number {
  const sifma = getCalendar("US-SIFMA");
  let c = 1;
  for (let d = start; d < end;) {
    const next = Math.min(addBusinessDays(d, 1, sifma), end);
    c *= 1 + r * yearFraction(d, next, "ACT/360");
    d = next;
  }
  return c - 1;
}

// ---------------------------------------------------------------------------
// Markt R8-1 (core) – leg currency must match the index currency
// ---------------------------------------------------------------------------
describe("Markt R8-1 – a floating leg / FRA / cap whose currency differs from its index currency is INVALID_TRADE", () => {
  const czk: InterestRateSwap = { ...payer, id: "CZK", legs: payer.legs.map((l) => ({ ...l, currency: "CZK" })) };

  it("CZK legs with EURIBOR-6M → problem naming both currencies; priceTrade → INVALID_TRADE (was PV −6.1 Mio. without warning)", () => {
    const problems = validateTrade(czk);
    expect(problems).toEqual([expect.stringMatching(/^trade\.legs\[1\]: currency CZK does not match the currency EUR of index EURIBOR-6M/)]);
    expect(problems[0]).toContain("registerRateIndex / POST /api/market/indices");
    expect(codeOf(() => priceTrade(ctx, czk, "EUR"))).toBe("INVALID_TRADE");
    // FRA and cap
    const fra: ForwardRateAgreement = {
      id: "F",
      type: "FRA",
      currency: "USD",
      index: "EURIBOR-6M",
      notional: 1e7,
      payReceive: "Pay",
      fixedRate: 0.02,
      startDate: VAL + 92,
      endDate: VAL + 275,
    };
    expect(validateTrade(fra)).toEqual([expect.stringContaining("trade: currency USD does not match the currency EUR of index EURIBOR-6M")]);
    const cap = {
      ...fra,
      type: "CapFloor" as const,
      capFloor: "Cap" as const,
      effectiveDate: VAL + 2,
      terminationDate: VAL + 730,
      frequency: "6M",
      dayCount: "ACT/360" as const,
      calendar: "TARGET",
      strike: 0.03,
      payReceive: "Receive" as const,
    };
    expect(validateTrade(cap as Trade).some((p) => p.includes("does not match the currency EUR of index EURIBOR-6M"))).toBe(true);
    // consistent trades pass: EUR/USD CCS (each leg in its own currency), lower-case currency
    const ccs = makeCrossCurrencySwap({
      id: "X",
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: 1.1625,
      effectiveDate: VAL + 2,
      tenor: "5Y",
      fixedRate: 0.03,
      spread: 0,
    });
    expect(validateTrade(ccs)).toEqual([]);
    expect(validateTrade({ ...payer, legs: payer.legs.map((l) => ({ ...l, currency: "eur" })) })).toEqual([]);
    // an unknown index is not a validation problem – the pricer raises UNKNOWN_INDEX with its registration hint
    const unknown: InterestRateSwap = { ...payer, legs: payer.legs.map((l) => (l.type === "Float" ? { ...l, index: "PRIBOR-6M-X" } : l)) };
    expect(validateTrade(unknown)).toEqual([]);
    expect(codeOf(() => priceTrade(ctx, unknown, "EUR"))).toBe("UNKNOWN_INDEX");
  });
});

// ---------------------------------------------------------------------------
// Register helpers for an atomic API envelope import (Architektur N8-04, Markt R8-2)
// ---------------------------------------------------------------------------
describe("Register – validateRateIndex / validateSwapConventions without side effects, calendars as JSON", () => {
  const czeonia: RateIndex = {
    name: "CZEONIA-R8",
    currency: "CZK",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/360",
    fixingCalendar: "CZ-R8",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: true,
    curveId: "CZK-CZEONIA-R8",
  };
  const czkConv: SwapConventions = {
    currency: "CZK",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/360",
    floatIndex: "CZEONIA-R8",
    floatFrequency: "1Y",
    calendar: "CZ-R8",
    spotLag: 2,
    oisIndex: "CZEONIA-R8",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 2,
  };

  it("validateRateIndex lists every problem (built-in name, unknown calendar, bad tenor) and registers nothing", () => {
    expect(validateRateIndex({ ...getIndex("EURIBOR-6M"), dayCount: "ACT/365F" })).toEqual([
      expect.stringContaining("EURIBOR-6M is a built-in index and cannot be replaced"),
    ]);
    const problems = validateRateIndex({ ...czeonia, tenor: "3M", fixingLag: -1 });
    expect(problems).toEqual([
      expect.stringContaining('overnight indices use tenor "1D"'),
      'unknown calendar "CZ-R8" (register it with registerCalendar first)',
      "fixingLag must be a non-negative integer",
    ]);
    expect(validateRateIndex(null)).toEqual(["definition must be an object"]);
    expect(RATE_INDICES["CZEONIA-R8"]).toBeUndefined();
    expect(validateRateIndex({ ...czeonia, fixingCalendar: "TARGET", paymentCalendar: "NOPE" })).toEqual([
      'unknown paymentCalendar "NOPE" (register it with registerCalendar first)',
    ]);
    // registerRateIndex reports the same list
    expect(() => registerRateIndex({ ...czeonia, tenor: "3M", fixingLag: -1 })).toThrow(/overnight indices use tenor "1D"; unknown calendar "CZ-R8"/);
  });

  it("validateSwapConventions (conv) and (ccy, conv) forms, pendingIndices for an envelope whose indices are not registered yet", () => {
    expect(validateSwapConventions(czkConv)).toEqual([
      'unknown calendar "CZ-R8" (register it with registerCalendar first)',
      'floatIndex "CZEONIA-R8" is not a registered index (registerRateIndex first)',
      'oisIndex "CZEONIA-R8" is not a registered index (registerRateIndex first)',
    ]);
    expect(validateSwapConventions("HUF", { ...czkConv, calendar: "TARGET" }, { pendingIndices: [czeonia] })).toEqual(["currency CZK does not match HUF"]);
    expect(validateSwapConventions("czk", { ...czkConv, calendar: "TARGET" }, { pendingIndices: [czeonia] })).toEqual([]);
    expect(validateSwapConventions({ ...czkConv, calendar: "TARGET", oisIndex: "EURIBOR-6M" }, { pendingIndices: [czeonia] })).toEqual([
      "oisIndex EURIBOR-6M belongs to EUR, not CZK",
      "oisIndex EURIBOR-6M must be an OIS index",
    ]);
    expect(validateSwapConventions(undefined)).toEqual(["conventions must be an object"]);
  });

  it("calendars: JSON form registers via registerCalendar, built-in ids are protected, listCustomCalendars exports the envelope", () => {
    const json = { id: "CZ-R8", name: "Prague", holidays: ["2027-07-05", "2027-07-06", "2027-09-28", "2027-10-28", "2027-11-17"] };
    expect(validateCustomCalendar(json)).toEqual([]);
    expect(validateCustomCalendar({ id: "US", holidays: [] })).toEqual([expect.stringContaining('"US" is a built-in calendar and cannot be replaced')]);
    expect(validateCustomCalendar({ id: "X Y", holidays: ["2027-02-30", "nope"], weekendsAreHolidays: "no" })).toEqual([
      "calendar.id must be a non-empty string without whitespace",
      'calendar.holidays[0] "2027-02-30" is not a valid calendar date',
      'calendar.holidays[1] must be an ISO date (YYYY-MM-DD), got "nope"',
      "calendar.weekendsAreHolidays must be a boolean",
    ]);
    expect(isBuiltInCalendar("US")).toBe(true);
    expect(isBuiltInCalendar("usny")).toBe(true);
    expect(isBuiltInCalendar("TARGET2")).toBe(true);
    expect(isBuiltInCalendar("CZ-R8")).toBe(false);
    expect(codeOf(() => registerCalendar({ id: "US", holidays: [] }))).toBe("INVALID_CALENDAR");
    expect(codeOf(() => registerCalendar({ id: "CZ-R8", holidays: ["2027-13-01"] }))).toBe("INVALID_CALENDAR");
    expect(codeOf(() => getCalendar("CZ-R8"))).toBe("UNKNOWN_CALENDAR");
    const cal = registerCalendar(json, "PRAGUE");
    expect(cal.name).toBe("CZ-R8");
    expect(isBusinessDay(parseISO("2027-07-06"), getCalendar("CZ-R8"))).toBe(false);
    expect(isBusinessDay(parseISO("2027-07-07"), getCalendar("prague"))).toBe(true);
    expect(listCustomCalendars()).toEqual([{ ...json, weekendsAreHolidays: true }]);
    // now the CZK index / conventions validate and register
    expect(validateRateIndex(czeonia)).toEqual([]);
    registerRateIndex(czeonia);
    expect(validateSwapConventions("CZK", czkConv)).toEqual([]);
    // re-registering a custom id replaces it; an alias may not shadow a built-in id
    registerCalendar({ ...json, holidays: ["2027-07-05"] });
    expect(isBusinessDay(parseISO("2027-07-06"), getCalendar("CZ-R8"))).toBe(true);
    expect(listCustomCalendars()[0]!.holidays).toEqual(["2027-07-05"]);
    expect(codeOf(() => registerCalendar({ id: "CZ-R8", holidays: [] }, "EUR"))).toBe("INVALID_CALENDAR");
    delete RATE_INDICES["CZEONIA-R8"];
  });
});

// ---------------------------------------------------------------------------
// Ohne Abzug – premium-adjusted delta in the FX option analytics
// ---------------------------------------------------------------------------
describe("R8 – analytics.deltaPremiumAdjusted (Δ − P/S) next to the unadjusted deltaPct", () => {
  it("vanilla EURUSD call: deltaPremiumAdjusted = deltaPct − premiumQuotePerUnit / spot = Garman–Kohlhagen premiumAdjustedSpotDelta; 0 once delivered", () => {
    const call = makeFxOption({ id: "C", pair: "EURUSD", optionType: "Call", strike: 1.16, notional: 1e7, expiryDate: VAL + 365, deliveryDate: VAL + 367 });
    const r = priceTrade(ctx, call, "USD");
    const a = r.analytics;
    expect(a.deltaPremiumAdjusted).toBeCloseTo((a.deltaPct as number) - (a.premiumQuotePerUnit as number) / (a.spot as number), 12);
    expect(a.deltaPremiumAdjusted).toBeLessThan(a.deltaPct as number);
    const gk = garmanKohlhagen({
      type: "Call",
      spot: a.spot as number,
      strike: 1.16,
      vol: a.volatility as number,
      timeToExpiry: a.expiryYears as number,
      timeToDelivery: yearFraction(VAL, VAL + 367, "ACT/365F"),
      rd: a.rd as number,
      rf: a.rf as number,
    });
    expect(a.deltaPremiumAdjusted).toBeCloseTo(gk.premiumAdjustedSpotDelta, 10);
    // short position flips the sign
    expect(priceTrade(ctx, { ...call, payReceive: "Pay" }, "USD").analytics.deltaPremiumAdjusted).toBeCloseTo(-(a.deltaPremiumAdjusted as number), 12);
    expect(priceTrade(ctx, { ...call, expiryDate: VAL - 10, deliveryDate: VAL - 8 }, "USD").analytics.deltaPremiumAdjusted).toBe(0);
  });
});
