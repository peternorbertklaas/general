import { describe, expect, it } from "vitest";
import { RATE_INDICES, getIndex, isBuiltInIndex, registerRateIndex } from "../curves/index-definitions.js";
import { adjust, getCalendar, isBusinessDay } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { makeFxForward, makeFxOption, makeFxSwap, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type ForwardRateAgreement, type FxOption, type PricingResult, type Trade } from "../instruments/types.js";
import { fxSpotDateFrom } from "../market/fx-spot.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, SAMPLE_EURUSD_VOLS, buildSampleMarket } from "../market/sample-market.js";
import { VOL_IMPLAUSIBLE_PREFIX, VOL_PLAUSIBILITY, surfaceVolWarnings, volSurfaceWarnings } from "../market/vol-validation.js";
import { type FxVolSurface } from "../models/fx-vol-surface.js";
import { buildPortfolioReport } from "../reporting/portfolio-report.js";
import { methodologyFor } from "../reporting/valuation-report.js";
import { computeRisk, computeTheta, relevantCurveIds } from "../risk/sensitivities.js";
import { BARRIER_STATE_UNKNOWN_PREFIX, EXPIRED_PREFIX } from "./fx-pricer.js";
import { priceTrade, tradeCurrencies, validateTrade } from "./price.js";
import { UPFRONT_LEG_TYPE } from "./upfront.js";

const VAL = parseISO("2026-09-03");
const TOM = VAL + 1;
const ctx = buildSampleMarket(VAL);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

const withUpfront = <T extends Trade>(t: T, amount: number, currency: string, date: number): T => ({ ...t, upfront: { amount, currency, date } });
const premiumLeg = (r: PricingResult) => r.legs.find((l) => l.legType === UPFRONT_LEG_TYPE)!;

const swaption = makeSwaption({
  id: "SW",
  currency: "EUR",
  notional: 1e7,
  payerReceiver: "Payer",
  expiry: "2Y",
  tenor: "5Y",
  strike: 0.025,
  valuationDate: VAL,
});
const irs = makeVanillaSwap({ id: "IRS", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.025, effectiveDate: VAL + 2, maturity: "5Y" });

// ---------------------------------------------------------------------------
// N7-1 – settled foreign-currency premium needs no FX spot (regression of N6-1)
// ---------------------------------------------------------------------------
describe("N7-1 – a settled premium in a currency without FX spot / curve prices like before round 6", () => {
  const eurOnly: MarketContext = { ...ctx, fxSpots: {} };

  it("swaption / IRS with a USD premium paid 30 days ago on an EUR-only snapshot: PV as without premium, premium leg DF 0", () => {
    for (const plain of [swaption, irs]) {
      const t = withUpfront(plain, 1e5, "USD", VAL - 30);
      const r = priceTrade(eurOnly, t, "EUR");
      expect(r.pv).toBeCloseTo(priceTrade(eurOnly, plain, "EUR").pv, 8);
      const leg = premiumLeg(r);
      expect(leg.currency).toBe("USD");
      expect(leg.pv).toBe(0);
      expect(leg.pvReporting).toBe(0);
      expect(leg.cashflows[0]).toMatchObject({ kind: "Premium", discountFactor: 0, presentValue: 0, amount: -1e5 });
      // …and the premium paid today is settled as well.
      expect(priceTrade(eurOnly, withUpfront(plain, 1e5, "USD", VAL), "EUR").pv).toBeCloseTo(priceTrade(eurOnly, plain, "EUR").pv, 8);
    }
  });

  it("a premium in a currency the sample market does not know (NOK) is fine once settled; unpaid it needs the spot → NO_FX_SPOT", () => {
    expect(priceTrade(ctx, withUpfront(swaption, 1e5, "NOK", VAL - 30), "EUR").pv).toBeCloseTo(priceTrade(ctx, swaption, "EUR").pv, 8);
    expect(codeOf(() => priceTrade(eurOnly, withUpfront(swaption, 1e5, "USD", TOM), "EUR"))).toBe("NO_FX_SPOT");
    // conversion is only needed for a foreign reporting currency: the same unpaid USD premium reported in USD prices
    // (the swaption PV itself needs the EUR→USD spot, so use an IRS fee in the reporting currency instead)
    const usdFee = withUpfront(
      makeVanillaSwap({ id: "U", currency: "USD", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: VAL + 2, maturity: "5Y" }),
      1e5,
      "USD",
      TOM,
    );
    expect(Number.isFinite(priceTrade(eurOnly, usdFee, "USD").pv)).toBe(true);
    expect(codeOf(() => priceTrade(eurOnly, usdFee, "EUR"))).toBe("NO_FX_SPOT");
    // the portfolio report no longer lists such trades as failed
    const rep = buildPortfolioReport(eurOnly, [withUpfront(swaption, 1e5, "USD", VAL - 30)], "EUR", { theta: false });
    expect(rep.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// N7-2 / N7-5 – barrier rebates: one convention for the live-beyond, hit and expired paths
// ---------------------------------------------------------------------------
describe("N7-2 / N7-5 – barrier rebate conventions", () => {
  const spot = getFxSpot(ctx, "EUR", "USD"); // 1.1625
  const dfUsd = (d: number) => getDiscountCurve(ctx, "USD").df(d);
  const option = (barrier: FxOption["barrier"], extra: Partial<FxOption> = {}): FxOption => ({
    ...makeFxOption({ id: "B", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
    payReceive: "Receive",
    barrier,
    ...extra,
  });

  it("N7-2: the rebate of a never-touched knock-in survives the expiry – PV continuous up to one day of discounting", () => {
    const upIn = (extra: Partial<FxOption>) => option({ type: "UpIn", level: 1.3, rebate: 0.01 }, extra);
    const twoDays = priceTrade(ctx, upIn({ expiryDate: VAL + 2, deliveryDate: VAL + 4 }), "USD");
    const oneDay = priceTrade(ctx, upIn({ expiryDate: VAL + 1, deliveryDate: VAL + 3 }), "USD");
    // alive: option part ≈ 0 (strike 1.10 far below the 1.30 barrier is irrelevant – the barrier is far away), rebate·DF
    expect(oneDay.pv).toBeCloseTo(1e7 * 0.01 * dfUsd(VAL + 3), 0);
    expect(twoDays.pv).toBeCloseTo(1e7 * 0.01 * dfUsd(VAL + 4), 0);
    // expires today (state confirmed never touched): rebate paid on the delivery date
    const today = priceTrade(ctx, upIn({ expiryDate: VAL, deliveryDate: VAL + 2, barrier: { type: "UpIn", level: 1.3, rebate: 0.01, hit: false } }), "USD");
    expect(today.pv).toBeCloseTo(1e7 * 0.01 * dfUsd(VAL + 2), 6);
    expect(today.analytics.barrierState).toBe("alive");
    // expired yesterday, fixing below the barrier, no flag: rebate·DF plus the BARRIER_STATE_UNKNOWN warning
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: spot }] };
    const expired = priceTrade(fixing, upIn({ expiryDate: VAL - 1, deliveryDate: TOM }), "USD");
    expect(expired.pv).toBeCloseTo(1e7 * 0.01 * dfUsd(TOM), 6);
    expect(expired.analytics.greeksMethod).toBe("settled-payoff");
    expect(expired.analytics.deltaAmount).toBe(0);
    expect(expired.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(true);
    expect(expired.warnings.find((w) => w.startsWith(EXPIRED_PREFIX))).toMatch(/barrier never touched, rebate 0\.01 per unit base paid on 2026-09-04/);
    // hit: false → same value without the warning; hit: true → vanilla forward position, no rebate
    const confirmed = priceTrade(
      fixing,
      upIn({ expiryDate: VAL - 1, deliveryDate: TOM, barrier: { type: "UpIn", level: 1.3, rebate: 0.01, hit: false } }),
      "USD",
    );
    expect(confirmed.pv).toBeCloseTo(expired.pv, 8);
    expect(confirmed.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(false);
    const knockedIn = priceTrade(
      fixing,
      upIn({ expiryDate: VAL - 1, deliveryDate: TOM, barrier: { type: "UpIn", level: 1.3, rebate: 0.01, hit: true } }),
      "USD",
    );
    expect(knockedIn.pv).toBeCloseTo(priceTrade(fixing, option(undefined, { expiryDate: VAL - 1, deliveryDate: TOM }), "USD").pv, 6);
    // 1-day theta the day before expiry is the discount carry of the rebate, not −rebate
    const th = computeTheta(ctx, upIn({ expiryDate: TOM, deliveryDate: VAL + 3 }), "USD");
    expect(Math.abs(th.total)).toBeLessThan(50);
    // no rebate → 0 as before
    expect(priceTrade(fixing, option({ type: "UpIn", level: 1.3 }, { expiryDate: VAL - 1, deliveryDate: TOM }), "USD").pv).toBe(0);
    // report methodology names the convention
    expect(
      methodologyFor(upIn({ expiryDate: VAL - 1, deliveryDate: TOM }), fixing, expired).some((l) => l.includes("nie berührte Knock-in-Barrier = Rebate")),
    ).toBe(true);
  });

  it("N7-5: a knocked-out option (rebateAt expiry) is worth rebate·DF(delivery) on all three paths (spot beyond without flag, hit: true, expired)", () => {
    expect(spot).toBeGreaterThan(1.15);
    // R9 (N7-5 rest): the default convention became "hit" – this test pins the "expiry" convention explicitly
    const beyond = priceTrade(ctx, option({ type: "UpOut", level: 1.15, rebate: 0.01, rebateAt: "expiry" }), "USD");
    const flagged = priceTrade(ctx, option({ type: "UpOut", level: 1.15, rebate: 0.01, hit: true, rebateAt: "expiry" }), "USD");
    const contradicting = priceTrade(ctx, option({ type: "UpOut", level: 1.15, rebate: 0.01, hit: false, rebateAt: "expiry" }), "USD");
    const expected = 1e7 * 0.01 * dfUsd(VAL + 182);
    for (const r of [beyond, flagged, contradicting]) {
      expect(r.pv).toBeCloseTo(expected, 6); // R6: 100 000.00 undiscounted on the no-flag path vs 98 283.05 with the flag
      expect(r.analytics.barrierState).toBe("knocked-out");
      expect(r.analytics.greeksMethod).toBe("settled-payoff");
      expect(r.analytics.vega).toBe(0);
      expect(r.analytics.deltaAmount).toBe(0);
    }
    expect(beyond.warnings.filter((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toHaveLength(1);
    expect(beyond.warnings[0]).toMatch(/valued as knocked out on today's spot \(rebate 0\.01 per unit base valued as a payment on 2027-03-04/);
    expect(contradicting.warnings[0]).toContain("although barrier.hit is false");
    expect(flagged.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(false);
    // down-and-out put with a 0.02 rebate: identical treatment
    const put = (hit?: boolean) => option({ type: "DownOut", level: 1.2, rebate: 0.02, hit, rebateAt: "expiry" }, { optionType: "Put", strike: 1.25 });
    expect(priceTrade(ctx, put(), "USD").pv).toBeCloseTo(1e7 * 0.02 * dfUsd(VAL + 182), 6);
    expect(priceTrade(ctx, put(), "USD").pv).toBeCloseTo(priceTrade(ctx, put(true), "USD").pv, 8);
    // expired with the fixing beyond the barrier: same convention on the delivery date of that trade
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: spot }] };
    const expired = priceTrade(
      fixing,
      option({ type: "UpOut", level: 1.15, rebate: 0.01, rebateAt: "expiry" }, { expiryDate: VAL - 1, deliveryDate: TOM }),
      "USD",
    );
    expect(expired.pv).toBeCloseTo(1e7 * 0.01 * dfUsd(TOM), 6);
    expect(expired.warnings.find((w) => w.startsWith(EXPIRED_PREFIX))).toMatch(/knocked out, rebate 0\.01 per unit base paid on 2026-09-04/);
    // knocked in beyond the barrier without flag = the vanilla with analytic Greeks, like hit: true
    const vanilla = priceTrade(ctx, option(undefined), "USD");
    const inBeyond = priceTrade(ctx, option({ type: "UpIn", level: 1.15, rebate: 0.01 }), "USD");
    expect(inBeyond.pv).toBeCloseTo(vanilla.pv, 6);
    expect(inBeyond.analytics.greeksMethod).toBe("analytic");
    expect(inBeyond.analytics.vega).toBeCloseTo(vanilla.analytics.vega as number, 6);
    // a live option inside the barrier keeps the Reiner–Rubinstein value (at-hit rebate) and finite-difference Greeks
    const alive = priceTrade(ctx, option({ type: "UpOut", level: 1.25, rebate: 0.01 }), "USD");
    expect(alive.analytics.barrierState).toBe("alive");
    expect(alive.analytics.greeksMethod).toBe("finite-difference");
    expect(alive.pv).toBeGreaterThan(0);
    expect(alive.pv).toBeLessThan(vanilla.pv);
  });
});

// ---------------------------------------------------------------------------
// N7-3 – FX delta / DV01 of the premium currency
// ---------------------------------------------------------------------------
describe("N7-3 – the premium currency is a trade currency for FX delta, DV01 and par risk", () => {
  const fee = withUpfront(irs, 1e5, "USD", VAL + 365);

  it("IRS EUR + 100k USD fee in 1Y: fxDelta.USDEUR ≈ 1 % of the premium leg's EUR PV, USD-SOFR in dv01ByCurve", () => {
    expect(tradeCurrencies(fee)).toEqual(["EUR", "USD"]);
    expect(tradeCurrencies(fee, { upfront: false })).toEqual(["EUR"]);
    expect(tradeCurrencies(irs)).toEqual(["EUR"]);
    const leg = premiumLeg(priceTrade(ctx, fee, "EUR"));
    expect(leg.pvReporting).toBeLessThan(-80_000);
    const risk = computeRisk(ctx, fee, "EUR", { bucketed: false, vega: false, theta: false });
    expect(Object.keys(risk.fxDelta)).toEqual(["USDEUR"]);
    // central difference of A/S at ±1 %: (1.01 − 1/1.01)/2 = 0.99505 % of the leg PV
    expect(Math.abs(risk.fxDelta.USDEUR! / (leg.pvReporting * 0.01) - 1)).toBeLessThan(0.01);
    expect(risk.fxDelta.USDEUR).toBeLessThan(0); // we owe USD: a stronger USD costs EUR
    expect(Object.keys(risk.dv01ByCurve)).toContain(SAMPLE_CURVE_IDS.usdSofr);
    expect(relevantCurveIds(ctx, fee)).toContain(SAMPLE_CURVE_IDS.usdSofr);
    // the USD DV01 is the discounting of the fee: +1 bp lowers the (negative) EUR value by ≈ PV·1e-4·T
    const usdDv01 = risk.dv01ByCurve[SAMPLE_CURVE_IDS.usdSofr]!;
    expect(usdDv01).toBeGreaterThan(0);
    expect(usdDv01).toBeCloseTo(-leg.pvReporting * 1e-4, -1);
    // the plain IRS is untouched
    const plain = computeRisk(ctx, irs, "EUR", { bucketed: false, vega: false, theta: false });
    expect(plain.fxDelta).toEqual({});
    expect(Object.keys(plain.dv01ByCurve)).not.toContain(SAMPLE_CURVE_IDS.usdSofr);
  });

  it("swaption + USD premium tomorrow: fxDelta.USDEUR present; vol surfaces are still scoped to the economic currencies", () => {
    const t = withUpfront(swaption, 1e5, "USD", TOM);
    const risk = computeRisk(ctx, t, "EUR", { bucketed: false, theta: false });
    expect(risk.fxDelta.USDEUR).toBeCloseTo(premiumLeg(priceTrade(ctx, t, "EUR")).pvReporting * 0.01, -1);
    expect(Object.keys(risk.vega).filter((k) => k.startsWith("swaption:"))).toEqual(["swaption:EUR"]);
    // portfolio report totals carry the FX delta
    const rep = buildPortfolioReport(ctx, [t], "EUR", { theta: false });
    expect(rep.totals.fxDelta.USDEUR).toBeCloseTo(risk.fxDelta.USDEUR!, 6);
  });
});

// ---------------------------------------------------------------------------
// N7-4 – calendars vs QuantLib (the holiday lists themselves: golden.test.ts)
// ---------------------------------------------------------------------------
describe("N7-4 – DK Friday after Ascension and NO Christmas Eve", () => {
  it("DK: 15.05.2026 is a holiday → 6M schedule end / EURDKK spot dates roll to 18.05. / 19.05. like QuantLib", () => {
    const dk = getCalendar("DK");
    for (const iso of ["2024-05-10", "2025-05-30", "2026-05-15", "2027-05-07"]) expect(isBusinessDay(parseISO(iso), dk), iso).toBe(false);
    expect(toISO(adjust(parseISO("2026-05-15"), "ModifiedFollowing", dk))).toBe("2026-05-18");
    expect(toISO(fxSpotDateFrom(parseISO("2026-05-13"), "EUR", "DKK"))).toBe("2026-05-19"); // QL 19.05. (R6: 18.05.)
    expect(toISO(fxSpotDateFrom(parseISO("2026-06-04"), "EUR", "DKK"))).toBe("2026-06-09"); // Constitution Day unchanged
    expect(isBusinessDay(parseISO("2024-04-26"), dk)).toBe(true); // Store Bededag abolished from 2024
  });

  it("NO: 24.12. is a holiday, 31.12. a business day → 12M schedule end 28.12.2026 and EURNOK spot from 22.12. = 28.12. like QuantLib", () => {
    const no = getCalendar("NO");
    expect(isBusinessDay(parseISO("2026-12-24"), no)).toBe(false);
    expect(isBusinessDay(parseISO("2026-12-31"), no)).toBe(true);
    expect(toISO(adjust(parseISO("2026-12-24"), "ModifiedFollowing", no))).toBe("2026-12-28");
    expect(toISO(fxSpotDateFrom(parseISO("2026-12-22"), "EUR", "NOK"))).toBe("2026-12-28"); // R6: 24.12.
    // SE unchanged (72/72 with QuantLib), PL keeps 24.12. from 2025
    expect(isBusinessDay(parseISO("2026-06-19"), getCalendar("SE"))).toBe(false);
    expect(isBusinessDay(parseISO("2025-12-24"), getCalendar("PL"))).toBe(false);
    expect(isBusinessDay(parseISO("2024-12-24"), getCalendar("PL"))).toBe(true);
  });

  it("the report's convention line names the Nordic / Polish calendars", () => {
    expect(methodologyFor(irs, ctx, priceTrade(ctx, irs, "EUR")).some((l) => l.includes("TARGET2/US/UK/CH/JP/NO/SE/DK/PL"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N7-6 – vol plausibility for pegged FX pairs
// ---------------------------------------------------------------------------
describe("N7-6 – VOL_IMPLAUSIBLE for FX surfaces: pegged pairs pass, 1/100-scaled imports are caught, no `volType` in the text", () => {
  const eurdkk: FxVolSurface = {
    id: "EURDKK-VOL",
    pair: "EURDKK",
    expiries: [1 / 12, 0.25, 0.5, 1, 2],
    atm: [0.003, 0.0045, 0.006, 0.0075, 0.009], // ERM II band: 0.3–0.9 %
    rr25: [0.0002, 0.0003, 0.0004, 0.0005, 0.0005],
    bf25: [0.0001, 0.00015, 0.0002, 0.0002, 0.00025],
  };
  const usdhkd: FxVolSurface = { ...eurdkk, id: "USDHKD-VOL", pair: "USDHKD", atm: [0.003, 0.006, 0.009, 0.013, 0.016] };
  const scaled: FxVolSurface = { ...SAMPLE_EURUSD_VOLS, id: "EURUSD-SCALED", atm: SAMPLE_EURUSD_VOLS.atm.map((v) => v / 100) };

  it("EURDKK (ATM 0.3–0.9 %) and USDHKD (0.3–1.6 %) raise no warning", () => {
    expect(volSurfaceWarnings({ fxVols: { EURDKK: eurdkk, USDHKD: usdhkd } })).toEqual([]);
    expect(surfaceVolWarnings(eurdkk)).toEqual([]);
    expect(VOL_PLAUSIBILITY.fxMedianMin).toBe(0.002);
    expect(VOL_PLAUSIBILITY.fxMin).toBe(0.0005);
  });

  it("EURUSD imported at 1/100 scale (0.071 % …) is flagged with a scaling message that does not mention a volType", () => {
    const w = volSurfaceWarnings({ fxVols: { EURUSD: scaled } });
    // the median rule fires (0.08 % < 0.2 %); the individual values (0.071–0.082 %) stay above the 0.05 % per-value floor
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^VOL_IMPLAUSIBLE: fxVols\.EURUSD: median FX vol 0\.08 % is below 0\.20 % – FX vols are lognormal decimals \(0\.08 = 8 %\)/);
    expect(w[0]).toContain("check the scaling of the import");
    for (const m of w) expect(m).not.toMatch(/volType|normal \(bp\)/);
    // a JPY cross scaled by 1/100 (10 % → 0.1 %) trips both rules
    const jpy = volSurfaceWarnings({
      fxVols: { USDJPY: { ...scaled, id: "USDJPY-SCALED", pair: "USDJPY", atm: [0.0004, 0.0009, 0.001, 0.0011, 0.0012, 0.0012, 0.0013, 0.0013] } },
    });
    expect(jpy).toHaveLength(2);
    expect(jpy[1]).toMatch(/has 1 of 8 FX vols below 0\.05 % \(min 0\.04 %\) – FX vols are lognormal decimals/);
    // the pricer repeats the (cached) warning
    expect(surfaceVolWarnings(scaled)).toEqual(w.map((m) => m.replace("fxVols.EURUSD", "FX vol surface EURUSD-SCALED")));
    // a single sub-floor value (0.03 %) on an otherwise sane pegged surface is reported per value only
    const oneLow = volSurfaceWarnings({ fxVols: { EURDKK: { ...eurdkk, atm: [0.0003, 0.0045, 0.006, 0.0075, 0.009] } } });
    expect(oneLow).toHaveLength(1);
    expect(oneLow[0]).toMatch(/has 1 of 5 FX vols below 0\.05 % \(min 0\.03 %\)/);
  });

  it("IR surfaces keep the volType-based median rule and wording", () => {
    const w = volSurfaceWarnings({ swaptionVols: { EUR: { ...ctx.swaptionVols!.EUR!, volType: "Lognormal" } } });
    expect(
      w.some((m) => m.startsWith(`${VOL_IMPLAUSIBLE_PREFIX} swaptionVols.EUR: median lognormal vol`) && m.includes("check the volType of the import")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N7-7 – built-in indices cannot be replaced
// ---------------------------------------------------------------------------
describe("N7-7 – registerRateIndex refuses to replace a built-in index (valuations would change without a trace in the snapshot id)", () => {
  it("EURIBOR-6M with ACT/365F → INVALID_CURVE_SPEC, register unchanged; custom names may be re-registered", () => {
    const before = { ...getIndex("EURIBOR-6M") };
    const pv = priceTrade(ctx, irs, "EUR").pv;
    const attempt = () => registerRateIndex({ ...before, dayCount: "ACT/365F" });
    expect(codeOf(attempt)).toBe("INVALID_CURVE_SPEC");
    expect(() => attempt()).toThrow(/EURIBOR-6M is a built-in index and cannot be replaced/);
    expect(codeOf(() => registerRateIndex({ ...before, name: "euribor-6m", dayCount: "ACT/365F" }))).toBe("INVALID_CURVE_SPEC");
    expect(getIndex("EURIBOR-6M")).toEqual(before);
    expect(priceTrade(ctx, irs, "EUR").pv).toBe(pv);
    expect(isBuiltInIndex("EURIBOR-6M")).toBe(true);
    expect(isBuiltInIndex("sofr")).toBe(true);
    expect(isBuiltInIndex("NIBOR-6M")).toBe(true);
    expect(isBuiltInIndex("EURIBOR-6M-ACT365")).toBe(false);
    // a desk variant lives under its own name and may be replaced again
    const variant = registerRateIndex({ ...before, name: "EURIBOR-6M-ACT365", dayCount: "ACT/365F" });
    expect(getIndex("EURIBOR-6M-ACT365")).toBe(variant);
    expect(registerRateIndex({ ...variant, fixingLag: 1 }).fixingLag).toBe(1);
    expect(isBuiltInIndex("EURIBOR-6M-ACT365")).toBe(false);
    delete RATE_INDICES["EURIBOR-6M-ACT365"];
  });
});

// ---------------------------------------------------------------------------
// N7-8 – upfront on FRA / FX forward / FX swap is honoured
// ---------------------------------------------------------------------------
describe("N7-8 – `upfront` on FxForward, FxSwap and FRA is a Premium leg (was validated but silently ignored)", () => {
  const fwd = makeFxForward({ id: "F", pair: "EURUSD", baseAmount: 1e7, rate: 1.15, deliveryDate: VAL + 90 });
  const swap = makeFxSwap({ id: "S", pair: "EURUSD", baseAmount: 1e7, nearRate: 1.1625, farRate: 1.17, nearDate: VAL + 2, farDate: VAL + 92 });
  const fra: ForwardRateAgreement = {
    id: "FRA",
    type: "FRA",
    currency: "EUR",
    index: "EURIBOR-6M",
    notional: 1e7,
    payReceive: "Pay",
    fixedRate: 0.02,
    startDate: VAL + 92,
    endDate: VAL + 275,
  };

  it("PV = plain PV − premium·DF, the premium leg is appended after the economic legs", () => {
    const cases: [Trade, number][] = [
      [fwd, 2],
      [swap, 4],
      [fra, 1],
    ];
    for (const [plain, legIndex] of cases) {
      const t = withUpfront(plain, 5e4, "EUR", VAL + 2);
      expect(validateTrade(t)).toEqual([]);
      const r = priceTrade(ctx, t, "EUR");
      const base = priceTrade(ctx, plain, "EUR");
      expect(r.pv, plain.type).toBeCloseTo(base.pv - 5e4 * getDiscountCurve(ctx, "EUR").df(VAL + 2), 6);
      expect(r.legs, plain.type).toHaveLength(legIndex + 1);
      expect(r.legs.slice(0, legIndex)).toEqual(base.legs);
      const leg = r.legs[legIndex]!;
      expect(leg.legType).toBe(UPFRONT_LEG_TYPE);
      expect(leg.legIndex).toBe(legIndex);
      expect(leg.cashflows).toEqual([expect.objectContaining({ kind: "Premium", amount: -5e4, currency: "EUR", paymentDate: VAL + 2, legIndex })]);
      // analytics untouched (fair forward, points, FRA forward)
      expect(r.analytics).toEqual(base.analytics);
      // theta counts the premium once: premium tomorrow → cashflows −50k, theta ≈ plain theta
      const tomorrow = withUpfront(plain, 5e4, "EUR", TOM);
      const th = computeTheta(ctx, tomorrow, "EUR");
      expect(th.cashflows, plain.type).toBeCloseTo(-5e4, 6);
      expect(Math.abs(th.total - computeTheta(ctx, plain, "EUR").total), plain.type).toBeLessThan(30);
      // settled premium: no PV effect
      expect(priceTrade(ctx, withUpfront(plain, 5e4, "EUR", VAL - 5), "EUR").pv).toBeCloseTo(base.pv, 8);
    }
  });

  it("a fee in a third currency shows up in the FX delta of computeRisk", () => {
    const t = withUpfront(fwd, 5e4, "GBP", VAL + 30);
    expect(tradeCurrencies(t)).toEqual(["EUR", "USD", "GBP"]);
    const risk = computeRisk(ctx, t, "EUR", { bucketed: false, vega: false, theta: false });
    expect(Object.keys(risk.fxDelta).sort()).toEqual(["GBPEUR", "USDEUR"]);
    expect(risk.fxDelta.GBPEUR).toBeCloseTo(premiumLeg(priceTrade(ctx, t, "EUR")).pvReporting * 0.01, -1);
  });
});
