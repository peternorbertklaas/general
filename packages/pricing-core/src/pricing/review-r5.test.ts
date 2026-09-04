import { describe, expect, it } from "vitest";
import { flatCurve } from "../curves/curve.js";
import { nextImmDate, parseISO, toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { makeCrossCurrencySwap, makeFxOption, makeFxSwap, makeVanillaSwap } from "../instruments/builders.js";
import { type CrossCurrencySwap, type FloatLeg, type FxForward, type FxOption, type FxSwap, type InterestRateSwap } from "../instruments/types.js";
import { type MarketContext, getFxSpot } from "../market/market-context.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { type MarketSnapshotJson, deserializeMarket, serializeMarket, validateMarket } from "../market/snapshot.js";
import { validateVolSurfaces } from "../market/vol-validation.js";
import { fxAtmVol, fxVolAtStrike } from "../models/fx-vol-surface.js";
import { type SwaptionVolSurface, capletVol, swaptionAtmVol } from "../models/vol-surfaces.js";
import { emirValuationRecord } from "../reporting/emir.js";
import { buildPortfolioReport } from "../reporting/portfolio-report.js";
import { methodologyFor } from "../reporting/valuation-report.js";
import { computeRisk, computeTheta, rollMarket } from "../risk/sensitivities.js";
import { CDS_PREMIUM_ACCRUAL_PER_YEAR, bootstrapHazardCurve, computeXva, validateCreditInputs } from "../xva/cva.js";
import { fxForwardRate, fxOptionLifecycle } from "./fx-pricer.js";
import { priceTrade, validateTrade } from "./price.js";

const VAL = parseISO("2026-09-03");
const TOM = VAL + 1; // Friday 2026-09-04
const ctx = buildSampleMarket(VAL);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

function fwd(rate: number, deliveryDate: number): FxForward {
  return { id: "F", type: "FxForward", buyCurrency: "EUR", buyAmount: 1e7, sellCurrency: "USD", sellAmount: 1e7 * rate, deliveryDate };
}

function fxo(extra: Partial<FxOption> & { expiryDate: number; deliveryDate: number }): FxOption {
  return {
    ...makeFxOption({
      id: "O",
      pair: "EURUSD",
      optionType: "Call",
      strike: 1.1,
      notional: 1e7,
      expiryDate: extra.expiryDate,
      deliveryDate: extra.deliveryDate,
    }),
    payReceive: "Receive",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// N5-1 – theta single-count rule for FX legs delivering on the roll date
// ---------------------------------------------------------------------------
describe("N5-1 – theta counts an FX exchange settling on the rolled valuation date once", () => {
  it("FX forward delivering tomorrow: theta = PV(t+1) − PV(t) ≈ −485 (reviewer: engine showed +122 030 ≈ 99 % of the PV)", () => {
    for (const [rate, expected] of [
      [1.15, -484.86],
      [1.17, -504.58],
      [1.1623, -496.98],
    ] as const) {
      const t = fwd(rate, TOM);
      const pv0 = priceTrade(ctx, t, "USD");
      const pv1 = priceTrade(rollMarket(ctx, 1), t, "USD");
      expect(pv1.warnings.some((w) => w.startsWith("SETTLES_TODAY:"))).toBe(true);
      const th = computeTheta(ctx, t, "USD");
      expect(th.total).toBeCloseTo(pv1.pv - pv0.pv, 6);
      expect(th.total).toBeCloseTo(expected, 1);
      expect(th.cashflows).toBe(0);
      // the exchange is reported once, as value-today inside PV(t+1)
      expect(th.valueTodayOnRollDate).toBeCloseTo(pv1.pv, 6);
      expect(Math.abs(th.total)).toBeLessThan(0.01 * Math.abs(pv0.pv) + 600);
    }
  });

  it("FX forward delivering in two business days is unaffected (−484.61) and an FX forward settling today has theta 0 (cash received today)", () => {
    expect(computeTheta(ctx, fwd(1.15, VAL + 5), "USD").total).toBeCloseTo(-484.61, 1);
    const today = fwd(1.15, VAL);
    const th = computeTheta(ctx, today, "USD");
    const pv = priceTrade(ctx, today, "USD");
    expect(pv.warnings.some((w) => w.startsWith("SETTLES_TODAY:"))).toBe(true);
    expect(th.cashflows).toBeCloseTo(pv.pv, 6);
    expect(th.total).toBeCloseTo(0, 6);
  });

  it("FX swap with the near leg tomorrow: theta ≈ carry of both legs, not the near-leg exchange (+122 485 before)", () => {
    const swp: FxSwap = makeFxSwap({ id: "S", pair: "EURUSD", baseAmount: 1e7, nearRate: 1.15, farRate: 1.1625, nearDate: TOM, farDate: VAL + 95 });
    const th = computeTheta(ctx, swp, "USD");
    const pv0 = priceTrade(ctx, swp, "USD").pv;
    const pv1 = priceTrade(rollMarket(ctx, 1), swp, "USD").pv;
    expect(th.total).toBeCloseTo(pv1 - pv0, 6);
    expect(Math.abs(th.total)).toBeLessThan(1000);
    expect(th.valueTodayOnRollDate).toBeCloseTo(1e7 * (fxForwardRate(rollMarket(ctx, 1), "EUR", "USD", TOM) - 1.15), 2);
  });

  it("swap coupon due tomorrow is still counted as cash (regression), expired FX option delivering tomorrow keeps its accretion theta", () => {
    const swap: InterestRateSwap = makeVanillaSwap({
      id: "IRS",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.025,
      effectiveDate: TOM - 365,
      maturity: "5Y",
    });
    const base = priceTrade(ctx, swap, "EUR");
    const due = base.legs.flatMap((l) => l.cashflows).filter((c) => c.paymentDate === TOM);
    expect(due.length).toBeGreaterThan(0);
    const th = computeTheta(ctx, swap, "EUR", base);
    expect(th.cashflows).toBeCloseTo(
      due.reduce((s, c) => s + c.amount, 0),
      4,
    );
    expect(th.valueTodayOnRollDate).toBe(0);
    const opt = fxo({ expiryDate: VAL - 2, deliveryDate: TOM });
    const tho = computeTheta(ctx, opt, "USD");
    expect(tho.cashflows).toBe(0);
    expect(Math.abs(tho.total)).toBeLessThan(1000);
  });

  it("portfolio report: the theta line of two forwards delivering tomorrow has no phantom jump (reviewer: 121 545 with 122 030 phantom)", () => {
    const rep = buildPortfolioReport(ctx, [fwd(1.15, TOM), { ...fwd(1.17, TOM), id: "F2" }], "USD");
    expect(rep.totals.theta).toBeCloseTo(-484.86 - 504.58, 0);
    for (const l of rep.lines) expect(Math.abs(l.theta)).toBeLessThan(600);
    const md = methodologyFor(fwd(1.15, TOM), ctx, priceTrade(ctx, fwd(1.15, TOM), "USD"), {
      risk: computeRisk(ctx, fwd(1.15, TOM), "USD", { bucketed: false }),
    });
    expect(md.some((l) => l.includes("Roll-Datum") && l.includes("Value Today"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N5-2 – FX option lifecycle: expired / settles today / delivered
// ---------------------------------------------------------------------------
describe("N5-2 – expired and delivered FX options (vanilla, barrier, digital)", () => {
  const spot = getFxSpot(ctx, "EUR", "USD");

  it("fxOptionLifecycle classifies the five states", () => {
    expect(fxOptionLifecycle({ expiryDate: VAL + 10, deliveryDate: VAL + 12 }, VAL)).toBe("alive");
    expect(fxOptionLifecycle({ expiryDate: VAL, deliveryDate: VAL + 2 }, VAL)).toBe("expires-today");
    expect(fxOptionLifecycle({ expiryDate: VAL - 1, deliveryDate: VAL + 1 }, VAL)).toBe("expired");
    expect(fxOptionLifecycle({ expiryDate: VAL - 2, deliveryDate: VAL }, VAL)).toBe("settles-today");
    expect(fxOptionLifecycle({ expiryDate: VAL - 5, deliveryDate: VAL - 3 }, VAL)).toBe("delivered");
  });

  it("delivered options (vanilla, barrier, digital) have PV 0, DF 0, no Greeks, EMIR value 0 / delta 0 and an 'already settled' warning (reviewer: 625 000 USD, delta 1, no warning)", () => {
    const trades: FxOption[] = [
      fxo({ expiryDate: VAL - 5, deliveryDate: VAL - 3 }),
      fxo({ expiryDate: VAL - 365, deliveryDate: VAL - 363 }),
      fxo({ expiryDate: VAL - 5, deliveryDate: VAL - 3, barrier: { type: "UpOut", level: 1.2 } }),
      fxo({ expiryDate: VAL - 5, deliveryDate: VAL - 3, digital: { payoutCurrency: "USD", payout: 1e6 } }),
    ];
    for (const t of trades) {
      const r = priceTrade(ctx, t, "USD");
      expect(r.pv).toBe(0);
      expect(r.analytics.lifecycle).toBe("delivered");
      expect(r.legs[0]!.cashflows[0]!.discountFactor).toBe(0);
      expect(r.analytics.deltaAmount).toBe(0);
      expect(r.analytics.vega).toBe(0);
      expect(r.analytics.gamma).toBe(0);
      expect(r.warnings).toEqual([`FX option already settled (delivered ${toISO(t.deliveryDate)}) – excluded from the PV`]);
      const risk = computeRisk(ctx, t, "USD", { bucketed: false });
      expect(risk.fxDelta.EURUSD).toBe(0);
      expect(risk.theta).toBe(0);
      const emir = emirValuationRecord(ctx, t, r);
      expect(emir.valuationAmount).toBe(0);
      expect(emir.delta).toBe(0);
    }
  });

  it("expired, settlement pending: settled payoff = forward position at the strike, delta of a forward, no vega / gamma, EXPIRED + MISSING_FX_FIXING warnings", () => {
    const t = fxo({ expiryDate: VAL - 1, deliveryDate: TOM });
    const r = priceTrade(ctx, t, "USD");
    const dfQ = r.legs[0]!.cashflows[0]!.discountFactor;
    const fwdDel = fxForwardRate(ctx, "EUR", "USD", TOM);
    expect(r.analytics.lifecycle).toBe("expired");
    expect(r.pv).toBeCloseTo(1e7 * (fwdDel - 1.1) * dfQ, 4);
    expect(r.analytics.vega).toBe(0);
    expect(r.analytics.gamma).toBe(0);
    expect(r.analytics.thetaPerDay).toBe(0);
    expect(r.analytics.greeksMethod).toBe("settled-payoff");
    // delta of the resulting forward: DF_f per unit base → deltaAmount ≈ 1 % of the base leg
    expect(r.analytics.deltaPct as number).toBeGreaterThan(0.999);
    expect(r.analytics.deltaPct as number).toBeLessThanOrEqual(1);
    expect(r.warnings.some((w) => w.startsWith("EXPIRED:"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("MISSING_FX_FIXING:") && w.includes("2026-09-02"))).toBe(true);
    const risk = computeRisk(ctx, t, "USD", { bucketed: false });
    expect(risk.vega["fx:EURUSD"]).toBe(0);
    // the methodology text names the lifecycle state
    const md = methodologyFor(t, ctx, r);
    expect(md.some((l) => l.startsWith("Lebenszyklus:") && l.includes("verfallen") && l.includes("MISSING_FX_FIXING"))).toBe(true);
  });

  it("the exercise decision uses the expiry fixing when loaded: OTM fixing → 0 without MISSING_FX_FIXING, ITM fixing → forward position", () => {
    const t = fxo({ expiryDate: VAL - 1, deliveryDate: TOM });
    const otm: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: 1.05 }] };
    const r0 = priceTrade(otm, t, "USD");
    expect(r0.pv).toBe(0);
    expect(r0.analytics.deltaAmount).toBe(0);
    expect(r0.warnings.some((w) => w.startsWith("MISSING_FX_FIXING:"))).toBe(false);
    expect(r0.warnings.some((w) => w.startsWith("EXPIRED:") && w.includes("1.05"))).toBe(true);
    const itm: MarketContext = { ...ctx, fxFixings: [{ pair: "USDEUR", date: VAL - 1, rate: 1 / 1.2 }] };
    const r1 = priceTrade(itm, t, "USD");
    expect(r1.pv).toBeCloseTo(priceTrade(ctx, t, "USD").pv, 6); // value from today's forward, not from the fixing level
    expect(r1.warnings.some((w) => w.startsWith("MISSING_FX_FIXING:"))).toBe(false);
  });

  it("delivery on the valuation date: value-today payoff at DF 1 with SETTLES_TODAY, theta 0; expiry today: EXPIRES_TODAY, intrinsic on today's rate", () => {
    const st = priceTrade(ctx, fxo({ expiryDate: VAL - 2, deliveryDate: VAL }), "USD");
    expect(st.analytics.lifecycle).toBe("settles-today");
    expect(st.legs[0]!.cashflows[0]!.discountFactor).toBe(1);
    expect(st.pv).toBeCloseTo(1e7 * (fxForwardRate(ctx, "EUR", "USD", VAL) - 1.1), 4);
    expect(st.warnings.some((w) => w.startsWith("SETTLES_TODAY:"))).toBe(true);
    expect(computeTheta(ctx, fxo({ expiryDate: VAL - 2, deliveryDate: VAL }), "USD").total).toBeCloseTo(0, 6);
    const et = priceTrade(ctx, fxo({ expiryDate: VAL, deliveryDate: VAL + 5 }), "USD");
    expect(et.analytics.lifecycle).toBe("expires-today");
    expect(et.warnings.some((w) => w.startsWith("EXPIRES_TODAY:"))).toBe(true);
    expect(et.warnings.some((w) => w.startsWith("MISSING_FX_FIXING:"))).toBe(false);
    expect(et.analytics.vega).toBe(0);
    expect(et.pv).toBeGreaterThan(0);
  });

  it("barrier: knock state decided on the fixing – alive UpOut = forward position, knocked-out UpOut = discounted rebate, never-touched UpIn = 0", () => {
    const alive = priceTrade(ctx, fxo({ expiryDate: VAL - 1, deliveryDate: TOM, barrier: { type: "UpOut", level: 1.2 } }), "USD");
    expect(alive.pv).toBeCloseTo(priceTrade(ctx, fxo({ expiryDate: VAL - 1, deliveryDate: TOM }), "USD").pv, 6);
    const knocked = priceTrade(ctx, fxo({ expiryDate: VAL - 1, deliveryDate: TOM, barrier: { type: "UpOut", level: 1.15, rebate: 0.01 } }), "USD");
    expect(spot).toBeGreaterThan(1.15);
    expect(knocked.pv).toBeCloseTo(1e7 * 0.01 * knocked.legs[0]!.cashflows[0]!.discountFactor, 4);
    expect(knocked.analytics.deltaAmount).toBe(0);
    const untouched = priceTrade(ctx, fxo({ expiryDate: VAL - 1, deliveryDate: TOM, barrier: { type: "UpIn", level: 1.3 } }), "USD");
    expect(untouched.pv).toBe(0);
  });

  it("digital: cash-or-nothing pays the fixed amount without spot delta, asset-or-nothing pays base units with the forward delta", () => {
    const cash = priceTrade(ctx, fxo({ expiryDate: VAL - 1, deliveryDate: TOM, digital: { payoutCurrency: "USD", payout: 1e6 } }), "USD");
    const dfQ = cash.legs[0]!.cashflows[0]!.discountFactor;
    expect(cash.pv).toBeCloseTo(1e6 * dfQ, 4);
    expect(cash.analytics.deltaAmount).toBe(0);
    const asset = priceTrade(ctx, fxo({ expiryDate: VAL - 1, deliveryDate: TOM, digital: { payoutCurrency: "EUR", payout: 1e6 } }), "USD");
    expect(asset.pv).toBeCloseTo(1e6 * fxForwardRate(ctx, "EUR", "USD", TOM) * dfQ, 2);
    expect(asset.analytics.deltaAmount as number).toBeCloseTo(asset.pv * 0.01, 2);
    const otm = priceTrade(
      { ...ctx, fxFixings: [{ pair: "EURUSD", date: VAL - 1, rate: 1.0 }] },
      fxo({ expiryDate: VAL - 1, deliveryDate: TOM, digital: { payoutCurrency: "USD", payout: 1e6 } }),
      "USD",
    );
    expect(otm.pv).toBe(0);
  });

  it("alive options are unchanged: no lifecycle warning, analytic Greeks, vol from the surface", () => {
    const r = priceTrade(ctx, fxo({ expiryDate: VAL + 365, deliveryDate: VAL + 367 }), "USD");
    expect(r.analytics.lifecycle).toBe("alive");
    expect(r.analytics.greeksMethod).toBe("analytic");
    expect(r.warnings).toEqual([]);
    expect(r.analytics.vega as number).toBeGreaterThan(0);
  });

  it("swaption wording (N5-4g): expiry on the valuation date says 'expires today', an earlier expiry 'expired'", () => {
    const mk = (expiryDate: number) => {
      const s = makeVanillaSwap({ id: "U", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.025, effectiveDate: VAL + 2, maturity: "5Y" });
      return {
        id: "SW",
        type: "Swaption" as const,
        payReceive: "Receive" as const,
        payerReceiver: "Payer" as const,
        settlement: "Physical" as const,
        expiryDate,
        underlying: s,
      };
    };
    expect(priceTrade(ctx, mk(VAL), "EUR").warnings).toContain("Swaption expires today – intrinsic value shown");
    expect(priceTrade(ctx, mk(VAL - 1), "EUR").warnings).toContain("Swaption expired – intrinsic value shown");
  });
});

// ---------------------------------------------------------------------------
// N5-3 / N5-4 – validation
// ---------------------------------------------------------------------------
describe("N5-3 / N5-4 – remaining trade validation gaps", () => {
  const ccs: CrossCurrencySwap = makeCrossCurrencySwap({
    pair: "EURUSD",
    domesticNotional: 1e7,
    fxSpot: 1.16,
    spread: 0,
    effectiveDate: VAL + 5,
    tenor: "3Y",
    mtmReset: true,
  });

  it("N5-3: mtmReset.resettingLegIndex out of range or non-integer → INVALID_TRADE naming the path (was a TypeError)", () => {
    for (const idx of [5, -1, 1.5, "1", null, undefined]) {
      const t = { ...ccs, mtmReset: { resettingLegIndex: idx as number } };
      const problems = validateTrade(t);
      expect(problems.some((p) => p.includes("trade.mtmReset.resettingLegIndex"))).toBe(true);
      expect(codeOf(() => priceTrade(ctx, t, "EUR"))).toBe("INVALID_TRADE");
    }
    expect(validateTrade({ ...ccs, mtmReset: { resettingLegIndex: 0 } })).toEqual([]);
    expect(validateTrade({ ...ccs, mtmReset: { resettingLegIndex: 1 } })).toEqual([]);
  });

  it("N5-4a: digital payout ≤ 0 / NaN and a malformed payout currency → INVALID_TRADE (−100 gave PV −60.88)", () => {
    for (const payout of [-100, 0, Number.NaN, "1e6"]) {
      const t = fxo({ expiryDate: VAL + 90, deliveryDate: VAL + 92, digital: { payoutCurrency: "USD", payout: payout as number } });
      expect(codeOf(() => priceTrade(ctx, t, "USD"))).toBe("INVALID_TRADE");
    }
    expect(codeOf(() => priceTrade(ctx, fxo({ expiryDate: VAL + 90, deliveryDate: VAL + 92, digital: { payoutCurrency: "US", payout: 1e6 } }), "USD"))).toBe(
      "INVALID_TRADE",
    );
    expect(priceTrade(ctx, fxo({ expiryDate: VAL + 90, deliveryDate: VAL + 92, digital: { payoutCurrency: "USD", payout: 1e6 } }), "USD").pv).toBeGreaterThan(
      0,
    );
  });

  it("N5-4b: unknown barrier type and non-numeric level → INVALID_TRADE (was NON_FINITE_PV)", () => {
    const bad = fxo({ expiryDate: VAL + 90, deliveryDate: VAL + 92, barrier: { type: "Sideways" as "UpIn", level: 1.2 } });
    expect(codeOf(() => priceTrade(ctx, bad, "USD"))).toBe("INVALID_TRADE");
    expect(validateTrade(bad).some((p) => p.includes("barrier.type"))).toBe(true);
    const badLevel = fxo({ expiryDate: VAL + 90, deliveryDate: VAL + 92, barrier: { type: "UpOut", level: "1.2" as unknown as number } });
    expect(codeOf(() => priceTrade(ctx, badLevel, "USD"))).toBe("INVALID_TRADE");
    const both = fxo({ expiryDate: VAL + 90, deliveryDate: VAL + 92, barrier: { type: "UpOut", level: 1.2 }, digital: { payoutCurrency: "USD", payout: 1e6 } });
    expect(codeOf(() => priceTrade(ctx, both, "USD"))).toBe("INVALID_TRADE");
  });

  it("N5-4c/f: float spread null / string, gearing, step schedules and a non-boolean observationShift → INVALID_TRADE (was NON_FINITE_PV or silent)", () => {
    const swap = makeVanillaSwap({ id: "S", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.025, effectiveDate: VAL + 2, maturity: "5Y" });
    const withFloat = (patch: Partial<FloatLeg>): InterestRateSwap => ({ ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? { ...l, ...patch } : l)) });
    for (const patch of [
      { spread: null as unknown as number },
      { spread: "0.001" as unknown as number },
      { spread: Number.NaN },
      { gearing: "2" as unknown as number },
      { observationShift: "yes" as unknown as boolean },
      { compounding: "Daily" as unknown as "Compound" },
      { spreadSchedule: [{ date: VAL + 400, spread: "x" as unknown as number }] },
      {
        spreadSchedule: [
          { date: VAL + 400, spread: 0.001 },
          { date: VAL + 300, spread: 0.002 },
        ],
      },
    ]) {
      const t = withFloat(patch);
      expect(validateTrade(t).length, JSON.stringify(patch)).toBeGreaterThan(0);
      expect(
        codeOf(() => priceTrade(ctx, t, "EUR")),
        JSON.stringify(patch),
      ).toBe("INVALID_TRADE");
    }
    const fixedBad: InterestRateSwap = {
      ...swap,
      legs: swap.legs.map((l) => (l.type === "Fixed" ? { ...l, rateSchedule: [{ date: VAL + 400, rate: Number.NaN }] } : l)),
    };
    expect(codeOf(() => priceTrade(ctx, fixedBad, "EUR"))).toBe("INVALID_TRADE");
    // valid variants still price
    expect(
      Number.isFinite(priceTrade(ctx, withFloat({ spread: 0.001, observationShift: true, spreadSchedule: [{ date: VAL + 400, spread: 0.002 }] }), "EUR").pv),
    ).toBe(true);
    expect(codeOf(() => priceTrade(ctx, { ...swap, upfront: { amount: Number.NaN, currency: "EUR", date: VAL + 2 } }, "EUR"))).toBe("INVALID_TRADE");
  });

  it("N5-4d: FX swap with the far leg on or before the near leg → INVALID_TRADE (was priced: PV 41 801.84)", () => {
    const ok = makeFxSwap({ id: "S", pair: "EURUSD", baseAmount: 1e7, nearRate: 1.16, farRate: 1.1625, nearDate: VAL + 5, farDate: VAL + 95 });
    expect(validateTrade(ok)).toEqual([]);
    const inverted: FxSwap = { ...ok, nearLeg: { ...ok.nearLeg, deliveryDate: VAL + 95 }, farLeg: { ...ok.farLeg, deliveryDate: VAL + 5 } };
    expect(codeOf(() => priceTrade(ctx, inverted, "USD"))).toBe("INVALID_TRADE");
    const same: FxSwap = { ...ok, farLeg: { ...ok.farLeg, deliveryDate: ok.nearLeg.deliveryDate } };
    expect(codeOf(() => priceTrade(ctx, same, "USD"))).toBe("INVALID_TRADE");
  });

  it("N5-4e: CreditInputs are validated – missing / out-of-range recovery, negative or NaN hazard, malformed hazard curve → INVALID_CREDIT_CURVE, never a NaN or negative CVA", () => {
    const swap = makeVanillaSwap({
      id: "S",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.025,
      effectiveDate: VAL + 2,
      maturity: "10Y",
    });
    const bad = [
      { cptyHazard: 0.02 },
      { cptyHazard: 0.02, cptyRecovery: 1.5 },
      { cptyHazard: 0.02, cptyRecovery: 1 },
      { cptyHazard: -0.02, cptyRecovery: 0.4 },
      { cptyHazard: Number.NaN, cptyRecovery: 0.4 },
      { cptyHazard: 0.02, cptyRecovery: 0.4, ownRecovery: -0.1 },
      { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: -0.01 },
      { cptyHazard: 0.02, cptyRecovery: 0.4, basisSpreadVol: -0.001 },
      { cptyHazard: 0.02, cptyRecovery: 0.4, cptyHazardCurve: { times: [1, 0.5], hazards: [0.01, 0.01], recovery: 0.4 } },
      { cptyHazard: 0.02, cptyRecovery: 0.4, cptyHazardCurve: { times: [1, 2], hazards: [0.01, -0.01], recovery: 0.4 } },
      { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazardCurve: { times: [1], hazards: [0.01], recovery: 1.2 } },
    ];
    for (const credit of bad) {
      expect(validateCreditInputs(credit as never).length, JSON.stringify(credit)).toBeGreaterThan(0);
      expect(
        codeOf(() => computeXva(ctx, swap, credit as never, "EUR")),
        JSON.stringify(credit),
      ).toBe("INVALID_CREDIT_CURVE");
    }
    expect(validateCreditInputs({ cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 })).toEqual([]);
    const x = computeXva(ctx, swap, { cptyHazard: 0.02, cptyRecovery: 0.4 }, "EUR");
    expect(Number.isFinite(x.cva) && x.cva > 0).toBe(true);
    // a curve makes the flat hazard optional
    expect(validateCreditInputs({ cptyRecovery: 0.4, cptyHazardCurve: { times: [1, 5], hazards: [0.01, 0.02], recovery: 0.4 } } as never)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// N5-5 – CDS bootstrap premium accrual ACT/360
// ---------------------------------------------------------------------------
describe("N5-5 – CDS bootstrap: ACT/360 premium accrual (ISDA), midpoint accrual / protection", () => {
  const disc = flatCurve("D", "EUR", VAL, 0.02);
  const flat100 = [
    { tenor: "1Y", spread: 0.01 },
    { tenor: "3Y", spread: 0.01 },
    { tenor: "5Y", spread: 0.01 },
    { tenor: "10Y", spread: 0.01 },
  ];

  it("flat 100 bp / R 40 % / 2 % discount: λ ≈ 168.56 bp (QuantLib 1.43: 168.10 bp at 1Y, 168.57 bp beyond; round 4 gave 166.67 bp)", () => {
    const c = bootstrapHazardCurve(flat100, 0.4, VAL, disc);
    for (const h of c.hazards) {
      expect(h * 1e4).toBeGreaterThan(168.4);
      expect(h * 1e4).toBeLessThan(168.7);
      expect(Math.abs(h / 0.01681 - 1)).toBeLessThan(3e-3);
    }
    expect(CDS_PREMIUM_ACCRUAL_PER_YEAR).toBeCloseTo(365 / 360, 15);
  });

  it("term structure 100/150/200/250 bp: survival within 3e-4 of QuantLib (1Y 0.983331, 3Y 0.926399, 5Y 0.841136, 10Y 0.642163)", () => {
    const c = bootstrapHazardCurve(
      [
        { tenor: "1Y", spread: 0.01 },
        { tenor: "3Y", spread: 0.015 },
        { tenor: "5Y", spread: 0.02 },
        { tenor: "10Y", spread: 0.025 },
      ],
      0.4,
      VAL,
      disc,
    );
    const ql = [0.98333051, 0.9263989, 0.84113639, 0.64216341];
    c.times.forEach((t, i) => {
      const q = 1 - (1 - Math.exp(-c.hazards.slice(0, i + 1).reduce((s, h, j) => s + h * (c.times[j]! - (j ? c.times[j - 1]! : 0)), 0)));
      expect(Math.abs(q - ql[i]!)).toBeLessThan(3e-4);
      expect(t).toBeGreaterThan(0);
    });
  });

  it("CVA of a 10Y payer swap from a CDS-bootstrapped curve is ≈ 1 % higher than with the round-4 ACT/365F accrual", () => {
    const swap = makeVanillaSwap({
      id: "S10",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.03,
      effectiveDate: VAL + 5,
      maturity: "10Y",
    });
    const c = bootstrapHazardCurve(flat100, 0.4, VAL, disc);
    const cva = computeXva(ctx, swap, { cptyHazard: 0, cptyRecovery: 0.4, cptyHazardCurve: c }, "EUR").cva;
    const old = computeXva(
      ctx,
      swap,
      { cptyHazard: 0, cptyRecovery: 0.4, cptyHazardCurve: { ...c, hazards: c.hazards.map((h) => h / CDS_PREMIUM_ACCRUAL_PER_YEAR) } },
      "EUR",
    ).cva;
    expect(cva / old - 1).toBeGreaterThan(0.008);
    expect(cva / old - 1).toBeLessThan(0.016);
  });
});

// ---------------------------------------------------------------------------
// Markt R5-1 – vol surface validation
// ---------------------------------------------------------------------------
describe("Markt R5-1 – validateVolSurfaces / INVALID_VOL_SURFACE", () => {
  const usd = ctx.swaptionVols!.USD!;
  const json = serializeMarket(ctx);

  it("the sample market is clean; a 1×1 atm grid on an 11×9 cube, wrong FX row lengths and bad axes are reported with paths", () => {
    expect(validateVolSurfaces(json)).toEqual([]);
    expect(validateMarket(ctx)).toEqual([]);
    const problems = validateVolSurfaces({ swaptionVols: { USD: { ...usd, atm: [[0.01]] } } });
    expect(problems.some((p) => p.startsWith("swaptionVols.USD.atm has 1 rows, expected"))).toBe(true);
    const fx = validateVolSurfaces({ fxVols: { EURUSD: { ...ctx.fxVols!.EURUSD!, atm: [0.5] } } });
    expect(fx.some((p) => p.startsWith("fxVols.EURUSD.atm has 1 entries, expected 8"))).toBe(true);
    expect(validateVolSurfaces({ swaptionVols: { USD: { ...usd, expiries: [1, 1, 2] } } }).some((p) => p.includes("strictly increasing"))).toBe(true);
    expect(validateVolSurfaces({ swaptionVols: { USD: { ...usd, volType: "Gaussian" } } }).some((p) => p.includes("volType"))).toBe(true);
    expect(validateVolSurfaces({ swaptionVols: { USD: { ...usd, currency: "EUR" } } }).some((p) => p.includes('does not match the key "USD"'))).toBe(true);
    expect(
      validateVolSurfaces({ swaptionVols: { USD: { ...usd, atm: usd.atm.map((r) => r.map((v, j) => (j === 3 ? Number.NaN : v))) } } }).length,
    ).toBeGreaterThan(0);
    expect(validateVolSurfaces({ swaptionVols: { USD: { ...usd, atm: usd.atm.map((r) => r.map((v, j) => (j === 3 ? -v : v))) } } }).length).toBeGreaterThan(0);
    const cap = ctx.capletVols!["EUR-EURIBOR-6M"]!;
    expect(
      validateVolSurfaces({ capletVols: { "EUR-EURIBOR-6M": { ...cap, vols: cap.vols.slice(1) } } }).some((p) =>
        p.includes("capletVols.EUR-EURIBOR-6M.vols has"),
      ),
    ).toBe(true);
    expect(validateVolSurfaces({ swaptionVols: "nope" as unknown as Record<string, unknown> })).toEqual(["swaptionVols must be an object keyed by currency"]);
    expect(validateVolSurfaces({})).toEqual([]);
  });

  it("deserializeMarket rejects a malformed surface with INVALID_VOL_SURFACE (key + problems), validateMarket lists it", () => {
    const bad: MarketSnapshotJson = { ...json, swaptionVols: { ...json.swaptionVols, USD: { ...usd, atm: [[0.01]] } } };
    let err: PricingError | undefined;
    try {
      deserializeMarket(bad);
    } catch (e) {
      err = e as PricingError;
    }
    expect(err).toBeInstanceOf(PricingError);
    expect(err!.code).toBe("INVALID_VOL_SURFACE");
    expect(err!.details?.key).toBe("USD");
    expect((err!.details?.problems as string[]).length).toBeGreaterThan(0);
    const badCtx: MarketContext = { ...ctx, swaptionVols: { ...ctx.swaptionVols, USD: { ...usd, atm: [[0.01]] } } };
    expect(validateMarket(badCtx).some((p) => p.startsWith("swaptionVols.USD.atm"))).toBe(true);
    expect(codeOf(() => deserializeMarket({ ...json, schema: "deriva.market/9" as "deriva.market/1" }))).toBe("INVALID_SNAPSHOT");
  });

  it("pricing on a malformed surface raises INVALID_VOL_SURFACE, never a TypeError (swaption cube, caplet surface, FX smile)", () => {
    const badCube: SwaptionVolSurface = { ...usd, atm: [[0.01]] };
    expect(codeOf(() => swaptionAtmVol(badCube, 1, 5))).toBe("INVALID_VOL_SURFACE");
    const badCtx: MarketContext = { ...ctx, swaptionVols: { ...ctx.swaptionVols, USD: badCube } };
    const usdSwap = makeVanillaSwap({
      id: "U",
      currency: "USD",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.035,
      effectiveDate: VAL + 365,
      maturity: "5Y",
    });
    const swpt = {
      id: "SW",
      type: "Swaption" as const,
      payReceive: "Receive" as const,
      payerReceiver: "Payer" as const,
      settlement: "Physical" as const,
      expiryDate: VAL + 363,
      underlying: usdSwap,
    };
    expect(codeOf(() => priceTrade(badCtx, swpt, "USD"))).toBe("INVALID_VOL_SURFACE");
    expect(priceTrade(ctx, swpt, "USD").pv).toBeGreaterThan(0);
    const cap = ctx.capletVols!["EUR-EURIBOR-6M"]!;
    expect(codeOf(() => capletVol({ ...cap, vols: cap.vols.slice(1) }, 1, 0.02))).toBe("INVALID_VOL_SURFACE");
    const fx = ctx.fxVols!.EURUSD!;
    expect(codeOf(() => fxAtmVol({ ...fx, atm: [0.5] }, 1))).toBe("INVALID_VOL_SURFACE");
    expect(codeOf(() => fxVolAtStrike({ ...fx, rr25: [0.01] }, 1, 1.16, 1.2))).toBe("INVALID_VOL_SURFACE");
    const badFxCtx: MarketContext = { ...ctx, fxVols: { ...ctx.fxVols, EURUSD: { ...fx, atm: [0.5] } } };
    expect(codeOf(() => priceTrade(badFxCtx, fxo({ expiryDate: VAL + 180, deliveryDate: VAL + 182 }), "USD"))).toBe("INVALID_VOL_SURFACE");
  });
});

// ---------------------------------------------------------------------------
// Markt R5-2 – FX vol surfaces for every sample pair
// ---------------------------------------------------------------------------
describe("Markt R5-2 – every pair of the sample currencies has an FX vol surface (no 8 % fallback / Level 3)", () => {
  it("all ten pairs of EUR/USD/GBP/CHF/JPY price an ATM option from a surface without the fallback warning", () => {
    const ccys = ["EUR", "USD", "GBP", "CHF", "JPY"];
    let pairs = 0;
    for (let i = 0; i < ccys.length; i++) {
      for (let j = i + 1; j < ccys.length; j++) {
        const pair = `${ccys[i]}${ccys[j]}`;
        const spot = getFxSpot(ctx, ccys[i]!, ccys[j]!);
        const t: FxOption = {
          ...makeFxOption({ id: pair, pair, optionType: "Call", strike: spot, notional: 1e6, expiryDate: VAL + 182, deliveryDate: VAL + 184 }),
          payReceive: "Receive",
        };
        const r = priceTrade(ctx, t, ccys[j]!);
        expect(
          r.warnings.filter((w) => /No FX vol surface/i.test(w)),
          pair,
        ).toEqual([]);
        expect(r.analytics.volatility as number, pair).not.toBeCloseTo(0.08, 6);
        expect(r.analytics.volatility as number, pair).toBeGreaterThan(0.04);
        expect(r.analytics.volatility as number, pair).toBeLessThan(0.13);
        pairs++;
      }
    }
    expect(pairs).toBe(10);
    expect(Object.keys(ctx.fxVols!).sort()).toEqual(["CHFJPY", "EURCHF", "EURGBP", "EURJPY", "EURUSD", "GBPCHF", "GBPJPY", "GBPUSD", "USDCHF", "USDJPY"]);
    for (const s of Object.values(ctx.fxVols!)) expect(s.id).toMatch(/-VOL$/);
  });
});

// ---------------------------------------------------------------------------
// N5-07 – no plain Error from the core
// ---------------------------------------------------------------------------
describe("N5-07 – the core raises PricingError codes instead of plain Errors", () => {
  it("nextImmDate beyond its search window, unknown snapshot schema, builder misuse and numerical failures carry codes", () => {
    expect(codeOf(() => nextImmDate(Number.MAX_SAFE_INTEGER - 10))).toBe("INVALID_DATE");
    expect(codeOf(() => makeCrossCurrencySwap({ pair: "EURUS", domesticNotional: 1e7, fxSpot: 1.1, spread: 0, effectiveDate: VAL, tenor: "1Y" }))).toBe(
      "INVALID_TRADE",
    );
    expect(
      codeOf(
        () =>
          flatCurve("X", "EUR", VAL, 0.02) &&
          new (Object.getPrototypeOf(flatCurve("X", "EUR", VAL, 0.02)).constructor)({
            id: "E",
            currency: "EUR",
            referenceDate: VAL,
            dayCount: "ACT/365F",
            interpolation: "logLinear",
            nodes: [],
          }),
      ),
    ).toBe("INVALID_CURVE_SPEC");
  });
});
