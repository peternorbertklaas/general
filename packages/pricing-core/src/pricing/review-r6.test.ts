import { describe, expect, it } from "vitest";
import { parseISO, toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { makeCapFloor, makeCrossCurrencySwap, makeFxOption, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type FxOption, type Trade } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, getFxSpot } from "../market/market-context.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { buildPortfolioReport } from "../reporting/portfolio-report.js";
import { cashflowTable, ifrs13Level, methodologyFor } from "../reporting/valuation-report.js";
import { computeTheta, rollMarket } from "../risk/sensitivities.js";
import { CDS_PREMIUM_ACCRUAL_PER_YEAR, bootstrapHazardCurve, computeXva, hazardFromSpread } from "../xva/cva.js";
import { BARRIER_STATE_UNKNOWN_PREFIX, MISSING_FX_FIXING_PREFIX } from "./fx-pricer.js";
import { priceTrade, validateTrade } from "./price.js";
import { UPFRONT_LEG_TYPE } from "./upfront.js";

const VAL = parseISO("2026-09-03");
const TOM = VAL + 1; // 2026-09-04
const ctx = buildSampleMarket(VAL);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

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
const cap = makeCapFloor({ id: "CAP", currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: VAL + 2, maturity: "5Y" });
const irs = makeVanillaSwap({ id: "IRS", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.025, effectiveDate: VAL + 2, maturity: "5Y" });
const fxCall: FxOption = {
  ...makeFxOption({ id: "O", pair: "EURUSD", optionType: "Call", strike: 1.16, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
  payReceive: "Receive",
};
const withUpfront = <T extends Trade>(t: T, amount: number, currency: string, date: number): T => ({ ...t, upfront: { amount, currency, date } });
const premiumCashflows = (t: Trade) =>
  priceTrade(ctx, t, "EUR")
    .legs.flatMap((l) => l.cashflows)
    .filter((c) => c.kind === "Premium");

// ---------------------------------------------------------------------------
// N6-1 – upfront premium as a Premium cashflow (theta single count)
// ---------------------------------------------------------------------------
describe("N6-1 – the upfront premium is a `Premium` cashflow in its own leg and is counted once by theta", () => {
  it("swaption + 100k premium tomorrow: theta ≈ carry (−192.80), not ≈ +premium (+99 807 before); PV unchanged", () => {
    const t = withUpfront(swaption, 1e5, "EUR", TOM);
    const base = priceTrade(ctx, t, "EUR");
    const plain = priceTrade(ctx, swaption, "EUR");
    // PV exactly as before: option value − premium · DF(premium date).
    expect(base.pv).toBeCloseTo(plain.pv - 1e5 * getDiscountCurve(ctx, "EUR").df(TOM), 6);
    // The premium is listed as its own last leg with a single Premium cashflow.
    const legs = base.legs;
    expect(legs).toHaveLength(2);
    expect(legs[1]!.legType).toBe(UPFRONT_LEG_TYPE);
    expect(legs[1]!.legIndex).toBe(1);
    expect(legs[1]!.cashflows).toEqual([
      expect.objectContaining({ kind: "Premium", paymentDate: TOM, amount: -1e5, notional: 1e5, currency: "EUR", legIndex: 1, legType: UPFRONT_LEG_TYPE }),
    ]);
    expect(legs[1]!.cashflows[0]!.presentValue).toBeCloseTo(-1e5 * getDiscountCurve(ctx, "EUR").df(TOM), 6);
    // Theta: PV(t+1) − premium paid − PV(t) = carry of the option ± discounting of the premium.
    const th = computeTheta(ctx, t, "EUR", base);
    expect(th.cashflows).toBeCloseTo(-1e5, 6);
    expect(th.total).toBeCloseTo(-192.8, 1);
    expect(th.total).toBeCloseTo(priceTrade(rollMarket(ctx, 1), t, "EUR").pv - 1e5 - base.pv, 6);
    // …and equals the theta of the same trade with the premium paid at spot (unaffected case).
    const atSpot = computeTheta(ctx, withUpfront(swaption, 1e5, "EUR", VAL + 4), "EUR");
    expect(atSpot.cashflows).toBe(0);
    expect(th.total).toBeCloseTo(atSpot.total, 1);
    expect(Math.abs(th.total - computeTheta(ctx, swaption, "EUR", plain).total)).toBeLessThan(10);
    expect(th.valueTodayOnRollDate).toBe(0);
  });

  it("premium due today or in the past is settled: DF 0, PV as without premium, theta unaffected", () => {
    for (const date of [VAL, VAL - 10]) {
      const t = withUpfront(swaption, 1e5, "EUR", date);
      const r = priceTrade(ctx, t, "EUR");
      expect(r.pv).toBeCloseTo(priceTrade(ctx, swaption, "EUR").pv, 8);
      const cf = r.legs[1]!.cashflows[0]!;
      expect(cf.kind).toBe("Premium");
      expect(cf.discountFactor).toBe(0);
      expect(cf.presentValue).toBe(0);
      expect(computeTheta(ctx, t, "EUR", r).cashflows).toBe(0);
    }
  });

  it("cap + 50k, FX call + 200k USD, IRS fee + 100k with the premium tomorrow: theta within a few units of the no-premium theta", () => {
    const cases: [Trade, Trade, string, number][] = [
      [cap, withUpfront(cap, 5e4, "EUR", TOM), "EUR", 5e4],
      [fxCall, withUpfront(fxCall, 2e5, "USD", TOM), "USD", 2e5],
      [irs, withUpfront(irs, 1e5, "EUR", TOM), "EUR", 1e5],
    ];
    for (const [plain, t, ccy, premium] of cases) {
      const thPlain = computeTheta(ctx, plain, ccy);
      const th = computeTheta(ctx, t, ccy);
      expect(th.cashflows, t.id).toBeCloseTo(-premium, 6);
      // Before N6-1 the theta was ≈ +premium (+49 853 / +199 078 / +99 776).
      expect(Math.abs(th.total - thPlain.total), t.id).toBeLessThan(0.0005 * premium + 5);
      expect(th.total, t.id).toBeCloseTo(priceTrade(rollMarket(ctx, 1), t, ccy).pv - premium - priceTrade(ctx, t, ccy).pv, 6);
      const prem = priceTrade(ctx, t, ccy)
        .legs.flatMap((l) => l.cashflows)
        .filter((c) => c.kind === "Premium");
      expect(prem, t.id).toHaveLength(1);
      expect(prem[0]!.amount).toBe(-premium);
    }
  });

  it("the premium leg is appended after the economic legs (IRS: legIndex 2, CCS via the swap pricer) and shows in the cashflow table / portfolio theta", () => {
    const fee = withUpfront(irs, 1e5, "EUR", TOM);
    const r = priceTrade(ctx, fee, "EUR");
    expect(r.legs.map((l) => l.legIndex)).toEqual([0, 1, 2]);
    expect(r.legs[2]!.legType).toBe(UPFRONT_LEG_TYPE);
    const ccs = withUpfront(
      makeCrossCurrencySwap({ id: "CCS", pair: "EURUSD", domesticNotional: 1e7, fxSpot: 1.1625, spread: -0.002, tenor: "5Y", effectiveDate: VAL + 2 }),
      5e4,
      "USD",
      TOM,
    );
    const rc = priceTrade(ctx, ccs, "EUR");
    expect(rc.legs.at(-1)!.legType).toBe(UPFRONT_LEG_TYPE);
    expect(rc.legs.at(-1)!.currency).toBe("USD");
    expect(premiumCashflows(ccs)).toHaveLength(1);
    const rows = cashflowTable(r);
    expect(rows.some((row) => row.at(-1) === "Premium" && row[6] === toISO(TOM) && row[10] === "-100000.00")).toBe(true);
    // Portfolio report: theta of a single swaption with premium tomorrow is the carry, not +99 807.
    const rep = buildPortfolioReport(ctx, [withUpfront(swaption, 1e5, "EUR", TOM)], "EUR");
    expect(rep.totals.theta).toBeCloseTo(-192.8, 0);
    // Received premium (sold option) has the opposite sign.
    const sold = premiumCashflows(withUpfront(swaption, -1e5, "EUR", TOM));
    expect(sold[0]!.amount).toBe(1e5);
  });
});

// ---------------------------------------------------------------------------
// N6-2 – hazardFromSpread with the bootstrap convention (365/360)
// ---------------------------------------------------------------------------
describe("N6-2 – hazardFromSpread uses the ACT/360 accrual factor of the CDS bootstrap", () => {
  it("λ = s·(365/360)/(1 − R) and agrees with a one-pillar bootstrap of the same quote to 1e-3", () => {
    expect(hazardFromSpread(0.01, 0.4)).toBeCloseTo((0.01 * CDS_PREMIUM_ACCRUAL_PER_YEAR) / 0.6, 15);
    expect(hazardFromSpread(0.01, 0.4) * 1e4).toBeCloseTo(168.98, 2); // was 166.67
    for (const s of [0.005, 0.01, 0.03]) {
      const curve = bootstrapHazardCurve([{ tenor: "5Y", spread: s }], 0.4, VAL);
      expect(Math.abs(hazardFromSpread(s, 0.4) / curve.hazards[0]! - 1)).toBeLessThan(1e-3);
      const disc = bootstrapHazardCurve([{ tenor: "5Y", spread: s }], 0.4, VAL, getDiscountCurve(ctx, "EUR"));
      expect(Math.abs(hazardFromSpread(s, 0.4) / disc.hazards[0]! - 1)).toBeLessThan(5e-3);
    }
  });

  it("flat-spread CVA equals the CVA from a flat CDS curve of the same quote (was −1.3 %)", () => {
    const swap = makeVanillaSwap({
      id: "S10",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.027,
      effectiveDate: VAL + 2,
      maturity: "10Y",
    });
    const flat = computeXva(ctx, swap, { cptyHazard: hazardFromSpread(0.01, 0.4), cptyRecovery: 0.4 }, "EUR");
    const curve = bootstrapHazardCurve(
      ["1Y", "3Y", "5Y", "10Y"].map((tenor) => ({ tenor, spread: 0.01 })),
      0.4,
      VAL,
    );
    const viaCurve = computeXva(ctx, swap, { cptyHazard: 0, cptyRecovery: 0.4, cptyHazardCurve: curve }, "EUR");
    expect(Math.abs(flat.cva / viaCurve.cva - 1)).toBeLessThan(1e-3);
    expect(flat.cva).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// N6-3 – IFRS 13 hint for MISSING_FX_FIXING distinguishes FX option and MtM reset
// ---------------------------------------------------------------------------
describe("N6-3 – IFRS-13 rationale hint for MISSING_FX_FIXING", () => {
  const expired: FxOption = {
    ...makeFxOption({ id: "X", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL - 2, deliveryDate: TOM }),
    payReceive: "Receive",
  };

  it("expired FX option without expiry fixing: hint names the exercise decision on today's spot, not an MtM reset", () => {
    const r = priceTrade(ctx, expired, "USD");
    expect(r.warnings.some((w) => w.startsWith(MISSING_FX_FIXING_PREFIX))).toBe(true);
    const { level, rationale } = ifrs13Level(ctx, expired, r);
    expect(level).toBe(2);
    expect(rationale).toContain("Verfallene FX-Option ohne FX-Fixing des Verfalltags 01.09.2026");
    expect(rationale).toContain("Ausübungs-Entscheid auf dem heutigen Spot");
    expect(rationale).not.toContain("MtM-Reset");
    // a barrier option names the barrier decision as well
    const barrier = { ...expired, barrier: { type: "UpOut" as const, level: 1.3, hit: false } };
    expect(ifrs13Level(ctx, barrier, priceTrade(ctx, barrier, "USD")).rationale).toContain("Ausübungs- und Barrier-Entscheid");
  });

  it("MtM-reset CCS keeps the reset wording", () => {
    const ccs = makeCrossCurrencySwap({
      id: "CCS",
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: 1.1625,
      spread: -0.002,
      tenor: "5Y",
      effectiveDate: VAL + 2,
    });
    const r = priceTrade(ctx, ccs, "EUR");
    const { rationale } = ifrs13Level(ctx, ccs, {
      ...r,
      warnings: [...r.warnings, `${MISSING_FX_FIXING_PREFIX} Missing FX fixing for USDEUR on 2026-03-05; MtM reset of leg 1 valued with today's rate as proxy`],
    });
    expect(rationale).toContain("MtM-Reset ohne FX-Fixing für einen vergangenen Reset-Termin");
    expect(rationale).not.toContain("Verfallene FX-Option");
  });
});

// ---------------------------------------------------------------------------
// N6-4 – valueTodayOnRollDate only for genuine exchanges
// ---------------------------------------------------------------------------
describe("N6-4 – ThetaDetail.valueTodayOnRollDate excludes option payoff placeholders", () => {
  it("swaption expiring tomorrow and expired FX option delivering tomorrow: valueTodayOnRollDate 0, theta unchanged", () => {
    const swpt = makeSwaption({
      id: "SWT",
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      expiry: TOM,
      tenor: "5Y",
      strike: 0.02,
      valuationDate: VAL,
    });
    const th = computeTheta(ctx, swpt, "EUR");
    expect(th.valueTodayOnRollDate).toBe(0);
    expect(th.cashflows).toBe(0);
    expect(th.total).toBeCloseTo(priceTrade(rollMarket(ctx, 1), swpt, "EUR").pv - priceTrade(ctx, swpt, "EUR").pv, 6);
    const expired: FxOption = {
      ...makeFxOption({ id: "X", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL - 2, deliveryDate: TOM }),
      payReceive: "Receive",
    };
    const tho = computeTheta(ctx, expired, "USD");
    expect(tho.valueTodayOnRollDate).toBe(0);
    expect(tho.total).toBeCloseTo(-435.57, 1); // N5-2 value unchanged
  });

  it("FX forward delivering tomorrow still reports its value-today exchange (122 514.80, N5-1)", () => {
    const fwd: Trade = { id: "F", type: "FxForward", buyCurrency: "EUR", buyAmount: 1e7, sellCurrency: "USD", sellAmount: 1.15e7, deliveryDate: TOM };
    const th = computeTheta(ctx, fwd, "USD");
    expect(th.valueTodayOnRollDate).toBeCloseTo(122514.8, 1);
    expect(th.total).toBeCloseTo(-484.86, 1);
  });
});

// ---------------------------------------------------------------------------
// N6-5 – barrier knock state: barrier.hit flag and BARRIER_STATE_UNKNOWN warning
// ---------------------------------------------------------------------------
describe("N6-5 – barrier.hit flag and BARRIER_STATE_UNKNOWN warning", () => {
  const spot = getFxSpot(ctx, "EUR", "USD"); // 1.1625
  const barrierCall = (barrier: FxOption["barrier"], extra: Partial<FxOption> = {}): FxOption => ({
    ...makeFxOption({ id: "B", pair: "EURUSD", optionType: "Call", strike: 1.1, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
    payReceive: "Receive",
    barrier,
    ...extra,
  });
  const vanilla = priceTrade(ctx, barrierCall(undefined), "USD");

  it("alive option with the spot beyond the barrier and no flag: model result (knocked) plus BARRIER_STATE_UNKNOWN warning", () => {
    expect(spot).toBeGreaterThan(1.15);
    const out = priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.15, rebate: 0.01 }), "USD");
    expect(out.warnings.filter((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toHaveLength(1);
    expect(out.warnings[0]).toContain("at or above the UpOut barrier 1.15");
    expect(out.analytics.barrierState).toBe("knocked-out");
    // N7-5 (R9 default "hit"): a spot beyond the barrier is a touch today – the rebate settles value-today (100 000.00);
    // "expiry" pays it on the delivery date (98 283.05).
    expect(out.pv).toBeCloseTo(1e7 * 0.01, 6);
    expect(priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.15, rebate: 0.01, rebateAt: "expiry" }), "USD").pv).toBeCloseTo(
      1e7 * 0.01 * getDiscountCurve(ctx, "USD").df(VAL + 182),
      6,
    );
    expect(out.analytics.greeksMethod).toBe("settled-payoff");
    const inn = priceTrade(ctx, barrierCall({ type: "UpIn", level: 1.15 }), "USD");
    expect(inn.pv).toBeCloseTo(vanilla.pv, 6);
    expect(inn.analytics.barrierState).toBe("knocked-in");
    expect(inn.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX) && w.includes("valued as the vanilla Call"))).toBe(true);
    // spot inside the barrier: no warning, state alive
    const far = priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.25 }), "USD");
    expect(far.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(false);
    expect(far.analytics.barrierState).toBe("alive");
    expect(far.pv).toBeGreaterThan(0);
    expect(far.pv).toBeLessThan(vanilla.pv);
    // hit: false with the spot beyond the level is contradictory – warned, valued as knocked
    const contradicting = priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.15, hit: false }), "USD");
    expect(contradicting.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX) && w.includes("barrier.hit is false"))).toBe(true);
  });

  it("alive option with barrier.hit = true: knock-out → rebate on the delivery date (rebateAt expiry) / already paid (default hit) with zero Greeks, knock-in → vanilla with analytic Greeks", () => {
    const out = priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.25, rebate: 0.01, hit: true, rebateAt: "expiry" }), "USD");
    const dfQ = getDiscountCurve(ctx, "USD").df(VAL + 182);
    expect(out.pv).toBeCloseTo(1e7 * 0.01 * dfQ, 6);
    expect(priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.25, rebate: 0.01, hit: true }), "USD").pv).toBe(0); // R9 default "hit": paid at the touch
    expect(out.analytics.barrierState).toBe("knocked-out");
    expect(out.analytics.greeksMethod).toBe("settled-payoff");
    expect(out.analytics.vega).toBe(0);
    expect(out.analytics.deltaAmount).toBe(0);
    expect(out.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(false);
    expect(out.warnings.some((w) => w.includes("knocked out (barrier.hit)"))).toBe(true);
    const noRebate = priceTrade(ctx, barrierCall({ type: "DownOut", level: 1.05, hit: true }), "USD");
    expect(noRebate.pv).toBe(0);
    const inn = priceTrade(ctx, barrierCall({ type: "UpIn", level: 1.25, hit: true }), "USD");
    expect(inn.pv).toBeCloseTo(vanilla.pv, 6);
    expect(inn.analytics.greeksMethod).toBe("analytic");
    expect(inn.analytics.barrierState).toBe("knocked-in");
    expect(inn.analytics.vega).toBeCloseTo(vanilla.analytics.vega as number, 6);
    expect(inn.warnings.some((w) => w.includes("knocked in (barrier.hit)"))).toBe(true);
  });

  it("expired option: the flag overrides the fixing-based knock decision; without the flag the derivation is warned", () => {
    const fixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 2, rate: 1.12 }] }; // ITM vs 1.10, below the 1.15 barrier
    const expiredUpIn = (hit?: boolean) => barrierCall({ type: "UpIn", level: 1.15, hit }, { expiryDate: VAL - 2, deliveryDate: TOM });
    const unknown = priceTrade(fixing, expiredUpIn(), "USD");
    expect(unknown.pv).toBe(0); // never knocked in according to the fixing alone
    expect(unknown.analytics.barrierState).toBe("alive");
    expect(unknown.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX) && w.includes("derived from the expiry fixing 1.12 only"))).toBe(true);
    const touched = priceTrade(fixing, expiredUpIn(true), "USD");
    expect(touched.pv).toBeGreaterThan(0);
    expect(touched.analytics.barrierState).toBe("knocked-in");
    // = the exercised vanilla forward position
    const plainExpired = priceTrade(fixing, barrierCall(undefined, { expiryDate: VAL - 2, deliveryDate: TOM }), "USD");
    expect(touched.pv).toBeCloseTo(plainExpired.pv, 6);
    expect(touched.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(false);
    const untouched = priceTrade(fixing, expiredUpIn(false), "USD");
    expect(untouched.pv).toBe(0);
    expect(untouched.warnings.some((w) => w.startsWith(BARRIER_STATE_UNKNOWN_PREFIX))).toBe(false);
    // knocked-out with rebate (rebateAt expiry): rebate · DF, regardless of an OTM fixing; default "hit": already paid (R9)
    const outHit = priceTrade(
      fixing,
      barrierCall({ type: "UpOut", level: 1.3, rebate: 0.02, hit: true, rebateAt: "expiry" }, { expiryDate: VAL - 2, deliveryDate: TOM }),
      "USD",
    );
    expect(outHit.pv).toBeCloseTo(1e7 * 0.02 * getDiscountCurve(ctx, "USD").df(TOM), 6);
    expect(outHit.analytics.barrierState).toBe("knocked-out");
    expect(priceTrade(fixing, barrierCall({ type: "UpOut", level: 1.3, rebate: 0.02, hit: true }, { expiryDate: VAL - 2, deliveryDate: TOM }), "USD").pv).toBe(
      0,
    );
    // report methodology names the flag / the derivation
    expect(methodologyFor(expiredUpIn(true), fixing, touched).some((l) => l.includes("barrier.hit = berührt"))).toBe(true);
    expect(methodologyFor(expiredUpIn(), fixing, unknown).some((l) => l.includes("BARRIER_STATE_UNKNOWN"))).toBe(true);
    expect(ifrs13Level(fixing, expiredUpIn(), unknown).rationale).toContain("BARRIER_STATE_UNKNOWN");
  });

  it("validation: barrier.hit must be a boolean", () => {
    expect(codeOf(() => priceTrade(ctx, barrierCall({ type: "UpOut", level: 1.25, hit: "yes" as unknown as boolean }), "USD"))).toBe("INVALID_TRADE");
    expect(validateTrade(barrierCall({ type: "UpOut", level: 1.25, hit: 1 as unknown as boolean }))).toEqual([
      expect.stringContaining("trade.barrier.hit must be a boolean"),
    ]);
    expect(validateTrade(barrierCall({ type: "UpOut", level: 1.25, hit: true }))).toEqual([]);
    expect(validateTrade(barrierCall({ type: "UpOut", level: 1.25, hit: false }))).toEqual([]);
  });
});
