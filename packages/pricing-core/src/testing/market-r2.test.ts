import { describe, expect, it } from "vitest";
import { type CurveBuildSpec, type FxSwapPointsQuote, bootstrapCurve, bootstrapCurves, bumpQuote, quoteDates, quoteLabel } from "../curves/bootstrap.js";
import { InterpolatedCurve, flatCurve } from "../curves/curve.js";
import { advance, getCalendar } from "../dates/calendar.js";
import { addTenor, parseISO, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import {
  annuityAmortisation,
  annuityAmortisationSchedule,
  linearAmortisation,
  makeAmortisingSwap,
  makeCapFloor,
  makeCrossCurrencySwap,
  makeFra,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
} from "../instruments/builders.js";
import { type CapFloor, type InterestRateSwap } from "../instruments/types.js";
import { monotoneConvexCoefficients, monotoneConvexForward, monotoneConvexZero } from "../math/interpolation.js";
import { SAMPLE_CURVE_IDS, SAMPLE_QUOTES, buildSampleMarket } from "../market/sample-market.js";
import { deserializeMarket, serializeMarket } from "../market/snapshot.js";
import { fxForwardRate } from "../pricing/fx-pricer.js";
import { priceTrade } from "../pricing/price.js";
import { HISTORICAL_SCENARIOS, applyScenario, runScenarios } from "../risk/scenarios.js";
import { buildValuationReport, marketSnapshotId } from "../reporting/valuation-report.js";
import { EMIR_CSV_HEADER, emirCsv, emirDelta, emirValuationRecord } from "../reporting/emir.js";
import { generateConfirmation, generateKid, summaryRiskIndicator } from "../reporting/documents.js";
import { bootstrapHazardCurve, computeXva, flatHazardCurve, hazardFromSpread, marginalPd, survivalProbability } from "../xva/cva.js";
import { type HedgeRelationship, criticalTermsMatch, hedgeEffectivenessReport, hypotheticalDerivative, intrinsicValue } from "../hedge/hedge.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const TARGET = getCalendar("TARGET");
const spot = advance(VAL, "2D", TARGET);

// ---------------------------------------------------------------------------
// N1 – CCS and FRA builders
// ---------------------------------------------------------------------------
describe("N1 – makeCrossCurrencySwap / makeFra", () => {
  it("a CCS at the fair spread from analytics reprices to ≈ 0 and carries notional exchange on both legs", () => {
    const fx = ctx.fxSpots.EURUSD!;
    const base = makeCrossCurrencySwap({
      id: "CCS-1",
      pair: "EURUSD",
      domesticCurrency: "EUR",
      foreignCurrency: "USD",
      domesticNotional: 1e7,
      fxSpot: fx,
      spread: 0,
      effectiveDate: spot,
      tenor: "5Y",
      collateralCurrency: "USD",
    });
    expect(base.type).toBe("CrossCurrencySwap");
    expect(base.legs).toHaveLength(2);
    expect(base.legs[0]!.currency).toBe("EUR"); // spread leg first
    expect(base.legs[1]!.notional).toBeCloseTo(1e7 * fx, 6);
    expect(base.legs.every((l) => l.notionalExchange?.initial && l.notionalExchange?.final && !l.notionalExchange?.interim)).toBe(true);
    const res = priceTrade(ctx, base, "EUR");
    const fair = res.analytics.fairSpread as number;
    expect(Number.isFinite(fair)).toBe(true);
    expect(Math.abs(fair)).toBeLessThan(0.01); // a few tens of bp
    const atFair = makeCrossCurrencySwap({
      id: "CCS-2",
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: fx,
      spread: fair,
      effectiveDate: spot,
      tenor: "5Y",
      collateralCurrency: "USD",
    });
    expect(Math.abs(priceTrade(ctx, atFair, "EUR").pv)).toBeLessThan(1); // linear in the spread → exact
    // MtM reset on the foreign leg, fixed-vs-float variant, spread on the foreign leg
    const mtm = makeCrossCurrencySwap({ pair: "EURUSD", domesticNotional: 1e7, fxSpot: fx, spread: -0.002, effectiveDate: spot, tenor: "3Y", mtmReset: true });
    expect(mtm.mtmReset).toEqual({ resettingLegIndex: 1 });
    expect(priceTrade(ctx, mtm, "EUR").analytics.mtmReset).toBe("yes");
    const fixed = makeCrossCurrencySwap({
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: fx,
      fixedRate: 0.025,
      spread: -0.001,
      effectiveDate: spot,
      tenor: "3Y",
    });
    expect(fixed.legs.map((l) => l.type)).toEqual(["Float", "Fixed"]);
    expect((fixed.legs[0] as { spread?: number }).spread).toBe(-0.001);
    expect(Number.isFinite(priceTrade(ctx, fixed, "EUR").analytics.parRate as number)).toBe(true);
    expect(() => makeCrossCurrencySwap({ pair: "EURUSD", domesticNotional: 1e7, spread: 0, effectiveDate: spot, tenor: "1Y" })).toThrow(/fxSpot/);
  });

  it("an FRA struck at the curve forward has PV ≈ 0 (tenor form 3x6 and explicit dates)", () => {
    const fra = makeFra({ id: "FRA-1", currency: "EUR", notional: 1e7, payReceive: "Pay", index: "EURIBOR-3M", start: "3x6", rate: 0.02, valuationDate: VAL });
    expect(fra.type).toBe("FRA");
    expect(toISO(fra.startDate)).toBe(toISO(advance(spot, "3M", TARGET)));
    expect(toISO(fra.endDate)).toBe(toISO(advance(spot, "6M", TARGET)));
    const res = priceTrade(ctx, fra, "EUR");
    const fwd = res.analytics.forwardRate as number;
    const atFwd = makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", index: "EURIBOR-3M", start: fra.startDate, end: fra.endDate, rate: fwd });
    expect(Math.abs(priceTrade(ctx, atFwd, "EUR").pv)).toBeLessThan(1e-6);
    expect(priceTrade(ctx, atFwd, "EUR").details?.fixingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => makeFra({ currency: "EUR", notional: 1, payReceive: "Pay", start: "6M", rate: 0.02 })).toThrow(/3x6/);
  });
});

// ---------------------------------------------------------------------------
// N4 – step-up coupons / spread schedules
// ---------------------------------------------------------------------------
describe("N4 – rateSchedule / spreadSchedule and the par solver", () => {
  const maturity = addTenor(spot, "4Y");
  const step = addTenor(spot, "2Y");
  it("a step-up swap equals the sum of a flat swap and a forward-starting coupon difference (manual cashflows)", () => {
    const stepUp = makeVanillaSwap({
      id: "SU",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.02,
      effectiveDate: spot,
      maturity,
      stepUp: [{ date: step, rate: 0.03 }],
    });
    const fixedLeg = stepUp.legs[0] as Extract<InterestRateSwap["legs"][number], { type: "Fixed" }>;
    expect(fixedLeg.rateSchedule).toHaveLength(2);
    expect(stepUp.name).toContain("Step-up");
    const res = priceTrade(ctx, stepUp, "EUR");
    const flat = priceTrade(
      ctx,
      makeVanillaSwap({ id: "F", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.02, effectiveDate: spot, maturity }),
      "EUR",
    );
    // Manual: the extra 1 % coupon on the periods starting on/after the step date, paid by us.
    const extra = res.legs[0]!.cashflows.filter((c) => c.accrualStart! >= step).reduce(
      (s, c) => s + -1 * c.notional * 0.01 * c.accrualFactor! * c.discountFactor,
      0,
    );
    expect(res.pv).toBeCloseTo(flat.pv + extra, 6);
    const rates = res.legs[0]!.cashflows.map((c) => c.rate);
    expect(rates.slice(0, 2)).toEqual([0.02, 0.02]);
    expect(rates.slice(2)).toEqual([0.03, 0.03]);
    // Par solver: base rate keeping the step constant reprices to zero; the flat par rate differs.
    const a = res.analytics;
    expect(a.parRateBase).toBe(a.parRate);
    expect(a.parRateFlat).not.toBeCloseTo(a.parRate as number, 6);
    const shift = (a.parRate as number) - 0.02;
    const atPar = makeVanillaSwap({
      id: "SUP",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.02 + shift,
      effectiveDate: spot,
      maturity,
      stepUp: [{ date: step, rate: 0.03 + shift }],
    });
    expect(Math.abs(priceTrade(ctx, atPar, "EUR").pv)).toBeLessThan(1e-4);
    const atFlat = makeVanillaSwap({
      id: "SUF",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: a.parRateFlat as number,
      effectiveDate: spot,
      maturity,
    });
    expect(Math.abs(priceTrade(ctx, atFlat, "EUR").pv)).toBeLessThan(1e-4);
    // Without a schedule the three par rates coincide.
    expect(flat.analytics.parRateBase).toBeCloseTo(flat.analytics.parRate as number, 12);
    expect(flat.analytics.parRateFlat).toBeCloseTo(flat.analytics.parRate as number, 12);
  });

  it("a spread schedule on the float leg is priced per period and fairSpread keeps the steps", () => {
    const swap = makeVanillaSwap({ id: "SS", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.025, effectiveDate: spot, maturity });
    const withSteps: InterestRateSwap = {
      ...swap,
      legs: [
        swap.legs[0]!,
        {
          ...swap.legs[1]!,
          type: "Float",
          index: "EURIBOR-6M",
          spread: 0.001,
          spreadSchedule: [{ date: step, spread: 0.002 }],
        } as InterestRateSwap["legs"][number],
      ],
    };
    const res = priceTrade(ctx, withSteps, "EUR");
    const plain = priceTrade(ctx, swap, "EUR");
    const extra = res.legs[1]!.cashflows.reduce((s, c) => s + c.notional * (c.accrualStart! >= step ? 0.002 : 0.001) * c.accrualFactor! * c.discountFactor, 0);
    expect(res.pv).toBeCloseTo(plain.pv + extra, 4);
    const fair = res.analytics.fairSpread as number;
    const atFair: InterestRateSwap = {
      ...withSteps,
      legs: [
        withSteps.legs[0]!,
        {
          ...(withSteps.legs[1] as Extract<InterestRateSwap["legs"][number], { type: "Float" }>),
          spread: fair,
          spreadSchedule: [{ date: step, spread: fair + 0.001 }],
        },
      ],
    };
    expect(Math.abs(priceTrade(ctx, atFair, "EUR").pv)).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------
// N17 / N2 – amortisation helpers and amortising hedged items
// ---------------------------------------------------------------------------
describe("N17 – annuityAmortisation", () => {
  it("constant instalment: balances decline to the final notional, interest + principal constant", () => {
    const b = annuityAmortisation(1_000_000, 0.05, 10);
    expect(b).toHaveLength(10);
    expect(b[0]).toBe(1_000_000);
    const g = Math.pow(1.05, 10);
    const A = 1_000_000 * g * (0.05 / (g - 1));
    for (let i = 0; i < 9; i++) expect(b[i + 1]!).toBeCloseTo(b[i]! * 1.05 - A, 6);
    expect(b[9]! * 1.05 - A).toBeCloseTo(0, 6); // repaid at maturity
    // balloon and zero-rate fallbacks
    const balloon = annuityAmortisation(100, 0.04, 5, { finalNotional: 40 });
    expect(balloon[4]! * 1.04 - (balloon[0]! * 1.04 - balloon[1]!)).toBeCloseTo(40, 6);
    expect(annuityAmortisation(100, 0, 4)).toEqual([100, 75, 50, 25]);
    const sched = annuityAmortisationSchedule({ effectiveDate: spot, terminationDate: addTenor(spot, "3Y"), frequency: "6M", calendar: "TARGET" }, 6e6, 0.03);
    expect(sched).toHaveLength(6);
    expect(sched[0]!.notional).toBe(6e6);
    expect(sched[5]!.notional).toBeLessThan(sched[4]!.notional);
  });
});

describe("N2 – amortising hedged item (Tilgungsplan) in hedge accounting", () => {
  const maturity = addTenor(spot, "10Y");
  const swap = makeAmortisingSwap({ id: "AMORT-1", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.027, effectiveDate: spot, maturity });
  const rel = (item: Partial<HedgeRelationship["hedgedItem"]>): HedgeRelationship => ({
    id: "HR-AM",
    name: "Tilgungsdarlehen",
    type: "CashFlowHedge",
    hedgedItem: {
      description: "Tilgungsdarlehen 10 Mio.",
      currency: "EUR",
      notional: 1e7,
      kind: "FloatingRateLoan",
      index: "EURIBOR-6M",
      effectiveDate: spot,
      maturityDate: maturity,
      ...item,
    },
    hedgingInstrumentId: "AMORT-1",
    designationDate: VAL,
    method: "DollarOffset",
    accountingFramework: "IFRS9",
  });

  it("amortising swap vs linearly amortising loan: hypothetical carries the plan, dollar-offset ≈ 1.00, critical terms met", () => {
    const r = rel({ amortisation: { type: "Linear" } });
    const hypo = hypotheticalDerivative(ctx, r, swap);
    expect(hypo.type).toBe("InterestRateSwap");
    const legs = (hypo as InterestRateSwap).legs;
    expect(legs.every((l) => l.notionalSchedule?.length === 10)).toBe(true);
    expect(legs[0]!.notionalSchedule!.map((e) => e.notional)).toEqual(swap.legs[0]!.notionalSchedule!.map((e) => e.notional));
    const rep = hedgeEffectivenessReport(ctx, r, swap, { designationCtx: ctx });
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(1, 2);
    expect(rep.regression.slope!).toBeCloseTo(1, 2);
    expect(rep.effective).toBe(true);
    expect(rep.criticalTerms.matches).toBe(true);
    const path = rep.criticalTerms.checks.find((c) => c.term === "notionalSchedule")!;
    expect(path.applicable).toBe(true);
    expect(path.match).toBe(true);
    expect(path.hedgedItem).toContain("amortisierend");
    expect(rep.summary.some((s) => s.includes("linearer Tilgungsplan"))).toBe(true);
    // explicit schedule from the instrument ("Tilgungsplan vom Sicherungsinstrument übernehmen")
    const explicit = rel({ notionalSchedule: swap.legs[0]!.notionalSchedule });
    expect(criticalTermsMatch(explicit, swap).matches).toBe(true);
  });

  it("amortising swap vs bullet loan: critical terms fail on the notional path (start notional still matches)", () => {
    const r = rel({});
    const ct = criticalTermsMatch(r, swap);
    expect(ct.checks.find((c) => c.term === "notional")!.match).toBe(true);
    const path = ct.checks.find((c) => c.term === "notionalSchedule")!;
    expect(path.applicable).toBe(true);
    expect(path.match).toBe(false);
    expect(path.hedgingInstrument).toContain("Abweichung");
    expect(ct.matches).toBe(false);
    const rep = hedgeEffectivenessReport(ctx, r, swap, { designationCtx: ctx });
    expect(rep.dollarOffsetProspective.ratio!).toBeLessThan(0.8); // the review's 0.58
    expect(rep.summary.some((s) => s.includes("Nominalverlauf"))).toBe(true);
  });

  it("annuity and custom plans, bullet items keep the check not applicable", () => {
    const annuity = rel({ amortisation: { type: "Annuity", loanRate: 0.04 } });
    const legs = (hypotheticalDerivative(ctx, annuity, swap) as InterestRateSwap).legs;
    const ns = legs[0]!.notionalSchedule!;
    expect(ns[0]!.notional).toBe(1e7);
    expect(ns[1]!.notional).toBeGreaterThan(9e6); // annuity: slow principal repayment at first
    expect(ns[9]!.notional).toBeLessThan(ns[8]!.notional);
    expect(() => hypotheticalDerivative(ctx, rel({ amortisation: { type: "Annuity" } }), swap)).toThrow(/loanRate/);
    const custom = rel({ amortisation: { type: "Custom", schedule: linearAmortisation(swap.legs[0]!, 1e7, 2e6) } });
    expect(criticalTermsMatch(custom, swap).matches).toBe(false); // 2 Mio balloon vs full amortisation
    const bullet = makeVanillaSwap({ id: "B", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.027, effectiveDate: spot, maturity });
    const ct = criticalTermsMatch({ ...rel({}), hedgingInstrumentId: "B" }, bullet);
    expect(ct.checks.find((c) => c.term === "notionalSchedule")!.applicable).toBe(false);
    expect(ct.matches).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N3 – options as hedging instruments
// ---------------------------------------------------------------------------
describe("N3 – hypothetical cap / intrinsic-value designation / cost of hedging", () => {
  const maturity = addTenor(spot, "5Y");
  const cap = makeCapFloor({ id: "CAP-1", currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity, index: "EURIBOR-6M" });
  const rel = (designation?: HedgeRelationship["designation"]): HedgeRelationship => ({
    id: "HR-CAP",
    name: "Zinsobergrenze 6M-Kredit",
    type: "CashFlowHedge",
    hedgedItem: {
      description: "Roll-over-Kredit 6M",
      currency: "EUR",
      notional: 1e7,
      kind: "FloatingRateLoan",
      index: "EURIBOR-6M",
      effectiveDate: spot,
      maturityDate: maturity,
    },
    hedgingInstrumentId: "CAP-1",
    designationDate: VAL,
    method: "DollarOffset",
    accountingFramework: "IFRS9",
    designation,
  });

  it("the hypothetical derivative of a cap is a cap with the hedged item's terms and the instrument's strike → ratio 1.00", () => {
    const hypo = hypotheticalDerivative(ctx, rel(), cap) as CapFloor;
    expect(hypo.type).toBe("CapFloor");
    expect(hypo.strike).toBe(0.03);
    expect(hypo.capFloor).toBe("Cap");
    expect(hypo.index).toBe("EURIBOR-6M");
    expect(hypo.notional).toBe(1e7);
    expect(hypo.payReceive).toBe("Receive");
    const rep = hedgeEffectivenessReport(ctx, rel(), cap, { designationCtx: ctx });
    expect(rep.designation).toBe("FullFairValue");
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(1, 6);
    expect(rep.regression.slope!).toBeCloseTo(1, 6);
    expect(rep.effective).toBe(true);
    expect(rep.criticalTerms.matches).toBe(true);
    expect(rep.costOfHedging).toBeUndefined();
    // a swaption still gets a linear hypothetical, with the time-value warning
    const swpt = makeSwaption({
      id: "SW",
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      strike: 0.03,
      expiry: "1Y",
      tenor: "4Y",
      valuationDate: VAL,
    });
    const swRep = hedgeEffectivenessReport(
      ctx,
      {
        ...rel(),
        hedgingInstrumentId: "SW",
        hedgedItem: { ...rel().hedgedItem, effectiveDate: swpt.underlying.legs[0]!.effectiveDate, maturityDate: swpt.underlying.legs[0]!.terminationDate },
      },
      swpt,
      { designationCtx: ctx },
    );
    expect(swRep.hypotheticalDerivative.trade.type).toBe("InterestRateSwap");
    expect(swRep.warnings.some((w) => w.includes("Cost of Hedging"))).toBe(true);
  });

  it("intrinsic-value designation: effective under ±200bp scenarios, time value reported as cost of hedging", () => {
    const r = rel("IntrinsicValue");
    const iv = intrinsicValue(ctx, cap, "EUR");
    expect(iv.pv).toBeGreaterThan(0);
    expect(iv.intrinsic).toBeGreaterThanOrEqual(0);
    expect(iv.timeValue).toBeGreaterThan(0);
    expect(iv.intrinsic + iv.timeValue).toBeCloseTo(iv.pv, 8);
    // intrinsic value = Σ max(F − K, 0)·τ·N·DF on the caplet forwards
    const priced = priceTrade(ctx, cap, "EUR");
    const manual = priced.legs[0]!.cashflows.reduce((s, c) => s + c.notional * c.accrualFactor! * c.discountFactor * Math.max(c.rate! - 0.03, 0), 0);
    expect(iv.intrinsic).toBeCloseTo(manual, 6);
    const up = applyScenario(ctx, { id: "u", name: "+200", curveShifts: [{ target: "*", parallelBp: 200 }] });
    const ivUp = intrinsicValue(up, cap, "EUR");
    expect(ivUp.intrinsic).toBeGreaterThan(iv.intrinsic);
    // vol shock moves only the time value
    const volUp = intrinsicValue(applyScenario(ctx, { id: "v", name: "vol", irVolShiftBp: 20 }), cap, "EUR");
    expect(volUp.intrinsic).toBeCloseTo(iv.intrinsic, 8);
    expect(volUp.timeValue).toBeGreaterThan(iv.timeValue);
    const rep = hedgeEffectivenessReport(ctx, r, cap, {
      designationCtx: applyScenario(ctx, { id: "d", name: "designation", curveShifts: [{ target: "*", parallelBp: -50 }], irVolShiftBp: -5 }),
    });
    expect(rep.designation).toBe("IntrinsicValue");
    expect(rep.dollarOffsetProspective.effective).toBe(true);
    expect(rep.regression.effective).toBe(true);
    expect(rep.regression.points.every((p) => p.scenarioId.startsWith("par") || ["steep", "flat"].includes(p.scenarioId))).toBe(true);
    expect(rep.costOfHedging).toBeDefined();
    expect(rep.costOfHedging!.timeValue).toBeGreaterThan(0);
    expect(rep.costOfHedging!.timeValueAtDesignation).toBeDefined();
    expect(rep.costOfHedging!.change).toBeCloseTo(rep.costOfHedging!.timeValue - rep.costOfHedging!.timeValueAtDesignation!, 8);
    expect(rep.summary.some((s) => s.includes("Cost of Hedging"))).toBe(true);
    // an intrinsic designation on a linear instrument only warns
    const swap = makeVanillaSwap({ id: "S", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.027, effectiveDate: spot, maturity });
    const lin = hedgeEffectivenessReport(ctx, { ...r, hedgingInstrumentId: "S" }, swap);
    expect(lin.costOfHedging).toBeUndefined();
    expect(lin.warnings.some((w) => w.includes("innerer Wert"))).toBe(true);
  });

  it("FX option as hedging instrument: hypothetical option with the same strike / expiry on the hedged amount", () => {
    const expiry = parseISO("2027-09-03");
    const put = makeFxOption({ id: "FXO", pair: "EURUSD", optionType: "Put", notional: 5e6, strike: 1.15, expiryDate: expiry });
    const r: HedgeRelationship = {
      id: "HR-FXO",
      name: "USD-Zahlungseingang",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Erwarteter EUR-Verkauf",
        currency: "EUR",
        notional: 5e6,
        kind: "ForecastFxCashflow",
        fxPair: "EURUSD",
        effectiveDate: VAL,
        maturityDate: put.deliveryDate,
      },
      hedgingInstrumentId: "FXO",
      designationDate: VAL,
      method: "Regression",
      accountingFramework: "IFRS9",
      designation: "IntrinsicValue",
    };
    const hypo = hypotheticalDerivative(ctx, r, put);
    expect(hypo.type).toBe("FxOption");
    expect((hypo as typeof put).strike).toBe(1.15);
    expect((hypo as typeof put).expiryDate).toBe(expiry);
    const rep = hedgeEffectivenessReport(ctx, r, put, { designationCtx: ctx });
    expect(rep.regression.slope!).toBeCloseTo(1, 6);
    expect(rep.costOfHedging!.timeValue).toBeGreaterThan(0);
    const iv = intrinsicValue(ctx, put, "USD");
    expect(iv.intrinsic).toBeCloseTo(
      Math.max(1.15 - (priceTrade(ctx, put, "USD").analytics.forward as number), 0) * 5e6 * priceTrade(ctx, put, "USD").legs[0]!.cashflows[0]!.discountFactor,
      4,
    );
  });
});

// ---------------------------------------------------------------------------
// N5 – EMIR fields
// ---------------------------------------------------------------------------
describe("N5 – EMIR valuation record: UTI, delta, timestamp, clearing", () => {
  it("takes UTI / cleared from the trade, delta from analytics, timestamp from the snapshot and MTMA with a transaction price", () => {
    const swap = makeVanillaSwap({
      id: "S1",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.03,
      effectiveDate: spot,
      maturity: "5Y",
      counterparty: "CP",
    });
    swap.uti = "E02XYZ00000000000000000000000000000000001";
    swap.cleared = true;
    swap.clearingMember = "LCH-MEMBER-1";
    swap.status = "Quoted";
    swap.quoteValidUntil = VAL + 1;
    const rec = emirValuationRecord({ ...ctx, meta: { ...ctx.meta, snapshotTime: "2026-09-03T16:30:00Z" } }, swap, priceTrade(ctx, swap, "EUR"));
    expect(rec.uti).toBe(swap.uti);
    expect(rec.delta).toBe(1); // pay fixed = long rates
    expect(rec.valuationTimestamp).toBe("2026-09-03T16:30:00Z");
    expect(rec.cleared).toBe("TRUE");
    expect(rec.clearingObligation).toBe("Y");
    expect(rec.clearingMember).toBe("LCH-MEMBER-1");
    expect(rec.valuationMethod).toBe("MTMO");
    const rec2 = emirValuationRecord(
      ctx,
      {
        ...swap,
        cleared: undefined,
        legs: swap.legs.map((l) => ({ ...l, payReceive: l.payReceive === "Pay" ? "Receive" : "Pay" })) as InterestRateSwap["legs"],
      },
      priceTrade(ctx, swap, "EUR"),
      { transactionPrice: 25_000, asOf: "2026-09-03T18:00:00Z", uti: "OVERRIDE" },
    );
    expect(rec2.delta).toBe(-1);
    expect(rec2.cleared).toBe("FALSE");
    expect(rec2.clearingObligation).toBe("N");
    expect(rec2.valuationMethod).toBe("MTMA");
    expect(rec2.valuationTimestamp).toBe("2026-09-03T18:00:00Z");
    expect(rec2.uti).toBe("OVERRIDE");
    expect(emirValuationRecord(ctx, swap, priceTrade(ctx, swap, "EUR")).valuationTimestamp).toBe("2026-09-03T17:00:00Z");
    const csv = emirCsv([rec, rec2]);
    const lines = csv.split("\n");
    expect(lines[0]!.split(";")).toEqual([...EMIR_CSV_HEADER]);
    expect(lines[1]!).toContain(swap.uti);
    expect(lines[1]!).toContain(";TRUE;Y;LCH-MEMBER-1");
    expect(lines[2]!).toContain(";-1.000000;");
  });

  it("option deltas are ratios in [−1, 1] consistent with the model delta", () => {
    const swpt = makeSwaption({
      id: "SW",
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      strike: 0.03,
      expiry: "1Y",
      tenor: "5Y",
      valuationDate: VAL,
    });
    const swptRes = priceTrade(ctx, swpt, "EUR");
    const dSw = emirDelta(swpt, swptRes)!;
    expect(dSw).toBeGreaterThan(0);
    expect(dSw).toBeLessThan(1);
    // USD reporting: the ratio is currency-independent
    expect(emirDelta(swpt, priceTrade(ctx, swpt, "USD"))!).toBeCloseTo(dSw, 6);
    const cap = makeCapFloor({ id: "C", currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
    const dCap = emirDelta(cap, priceTrade(ctx, cap, "EUR"))!;
    expect(dCap).toBeGreaterThan(0);
    expect(dCap).toBeLessThan(1);
    const fxo = makeFxOption({ id: "O", pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.16, expiryDate: parseISO("2027-03-03") });
    const fxRes = priceTrade(ctx, fxo, "USD");
    expect(emirDelta(fxo, fxRes)!).toBeCloseTo(fxRes.analytics.deltaPct as number, 10);
    expect(emirDelta(makeFra({ currency: "EUR", notional: 1e6, payReceive: "Receive", start: "3x6", rate: 0.02, valuationDate: VAL }), swptRes)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// N10 – historical scenarios
// ---------------------------------------------------------------------------
describe("N10 – HISTORICAL_SCENARIOS", () => {
  it("six documented episodes with valid shifts that change the PV of a book", () => {
    expect(HISTORICAL_SCENARIOS.map((s) => s.id)).toEqual([
      "hist-lehman-2008",
      "hist-eurokrise-2011",
      "hist-covid-2020",
      "hist-zinswende-2022",
      "hist-snb-2015",
      "hist-brexit-2016",
    ]);
    for (const s of HISTORICAL_SCENARIOS) {
      expect(s.description).toMatch(/Indikative Näherung/);
      expect(s.description).toMatch(/Quelle/);
      for (const cs of s.curveShifts ?? []) {
        expect(cs.tenorBp ?? cs.parallelBp).toBeDefined();
        for (const t of cs.tenorBp ?? []) expect(Number.isFinite(t.bp) && t.years >= 0).toBe(true);
      }
      const shifted = applyScenario(ctx, s);
      expect(Object.keys(shifted.curves)).toEqual(Object.keys(ctx.curves));
    }
    const swap = makeVanillaSwap({ id: "S", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.027, effectiveDate: spot, maturity: "10Y" });
    const fxf = { ...makeFxOption({ id: "O", pair: "EURUSD", optionType: "Put", notional: 1e6, strike: 1.16, expiryDate: parseISO("2027-03-03") }) };
    const run = runScenarios(ctx, [swap, fxf], HISTORICAL_SCENARIOS, "EUR");
    expect(run.results).toHaveLength(6);
    const byId = Object.fromEntries(run.results.map((r) => [r.scenario.id, r]));
    expect(byId["hist-zinswende-2022"]!.byTrade[0]!.pnl).toBeGreaterThan(0); // payer gains when rates rise
    expect(byId["hist-lehman-2008"]!.byTrade[0]!.pnl).toBeLessThan(0);
    expect(byId["hist-snb-2015"]!.byTrade[0]!.pnl).toBeCloseTo(0, 0); // CHF-only shock leaves the EUR swap unchanged
    expect(Math.abs(byId["hist-lehman-2008"]!.byTrade[1]!.pnl)).toBeGreaterThan(0); // EUR −12 % hits the EUR put
  });
});

// ---------------------------------------------------------------------------
// N11 – hazard term structure
// ---------------------------------------------------------------------------
describe("N11 – bootstrapHazardCurve / survival / CVA with a term structure", () => {
  it("a flat CDS term structure reproduces λ = s / (1 − R)", () => {
    const curve = bootstrapHazardCurve(
      [
        { tenor: "1Y", spread: 0.01 },
        { tenor: "3Y", spread: 0.01 },
        { tenor: "5Y", spread: 0.01 },
        { tenor: "10Y", spread: 0.01 },
      ],
      0.4,
      VAL,
    );
    expect(curve.times).toHaveLength(4);
    const lambda = hazardFromSpread(0.01, 0.4);
    for (const h of curve.hazards) expect(Math.abs(h / lambda - 1)).toBeLessThan(2e-3);
    expect(survivalProbability(curve, 0)).toBe(1);
    expect(survivalProbability(curve, 5)).toBeCloseTo(Math.exp(-lambda * 5), 4);
    expect(survivalProbability(curve, 20)).toBeCloseTo(Math.exp(-lambda * 20), 3); // flat extension
    expect(marginalPd(curve, 0, 1) + marginalPd(curve, 1, 5)).toBeCloseTo(1 - survivalProbability(curve, 5), 12);
    // with discounting the bootstrap still returns finite, positive hazards close to the flat rate
    const disc = flatCurve("D", "EUR", VAL, 0.03);
    const withDisc = bootstrapHazardCurve([{ tenor: "5Y", spread: 0.01 }], 0.4, VAL, disc);
    expect(Math.abs(withDisc.hazards[0]! / lambda - 1)).toBeLessThan(5e-3);
  });

  it("a steep CDS curve changes the CVA of a 10Y swap versus the flat 5Y-spread hazard", () => {
    const swap = makeVanillaSwap({
      id: "S10",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.027,
      effectiveDate: spot,
      maturity: "10Y",
    });
    const steep = bootstrapHazardCurve(
      [
        { tenor: "1Y", spread: 0.003 },
        { tenor: "3Y", spread: 0.006 },
        { tenor: "5Y", spread: 0.01 },
        { tenor: "7Y", spread: 0.014 },
        { tenor: "10Y", spread: 0.018 },
      ],
      0.4,
      VAL,
    );
    expect(steep.hazards[4]!).toBeGreaterThan(steep.hazards[0]!);
    const flat = computeXva(ctx, swap, { cptyHazard: hazardFromSpread(0.01, 0.4), cptyRecovery: 0.4 }, "EUR");
    const term = computeXva(ctx, swap, { cptyHazard: hazardFromSpread(0.01, 0.4), cptyRecovery: 0.4, cptyHazardCurve: steep }, "EUR");
    expect(term.method).toContain("term structure");
    expect(flat.method).toContain("flat hazard");
    expect(Math.abs(term.cva / flat.cva - 1)).toBeGreaterThan(0.05);
    // the flat curve object reproduces the flat hazard exactly
    const viaCurve = computeXva(ctx, swap, { cptyHazard: 0, cptyRecovery: 0.4, cptyHazardCurve: flatHazardCurve(hazardFromSpread(0.01, 0.4), 0.4) }, "EUR");
    expect(viaCurve.cva).toBeCloseTo(flat.cva, 6);
    // a steep own curve changes DVA the same way
    const dva = computeXva(ctx, swap, { cptyHazard: 0.01, cptyRecovery: 0.4, ownHazard: hazardFromSpread(0.01, 0.4), ownRecovery: 0.4 }, "EUR");
    const dvaTerm = computeXva(
      ctx,
      swap,
      { cptyHazard: 0.01, cptyRecovery: 0.4, ownHazard: hazardFromSpread(0.01, 0.4), ownRecovery: 0.4, ownHazardCurve: steep },
      "EUR",
    );
    expect(dvaTerm.dva).not.toBeCloseTo(dva.dva, 0);
  });
});

// ---------------------------------------------------------------------------
// N12 – monotone convex, FX swap points, turn of year
// ---------------------------------------------------------------------------
describe("N12 – monotone convex interpolation", () => {
  it("reproduces the pillars, keeps forwards positive and continuous, and matches the discrete forwards on average", () => {
    const times = [0, 0.5, 1, 2, 3, 5, 7, 10];
    const zeros = [0.02, 0.02, 0.022, 0.025, 0.027, 0.03, 0.031, 0.032];
    const c = monotoneConvexCoefficients(times, zeros);
    for (let i = 1; i < times.length; i++) expect(monotoneConvexZero(times, zeros, c, times[i]!)).toBeCloseTo(zeros[i]!, 12);
    let prev = monotoneConvexForward(times, c, 0);
    for (let t = 0.01; t <= 10; t += 0.01) {
      const f = monotoneConvexForward(times, c, t);
      expect(f).toBeGreaterThan(0);
      expect(Math.abs(f - prev)).toBeLessThan(0.01); // no jumps of more than 100bp per 0.01y
      prev = f;
    }
    // average of the instantaneous forward over an interval = discrete forward
    const i = 4;
    let sum = 0;
    const n = 2000;
    for (let k = 0; k < n; k++) sum += monotoneConvexForward(times, c, times[i - 1]! + ((k + 0.5) / n) * (times[i]! - times[i - 1]!));
    expect(sum / n).toBeCloseTo(c.fd[i]!, 5);
    // the curve class: df at nodes reproduced, zero rates consistent with the coefficients, extrapolation flat forward
    const nodes = times.slice(1).map((t, j) => ({ date: VAL + Math.round(t * 365), df: Math.exp(-zeros[j + 1]! * t) }));
    const curve = new InterpolatedCurve({ id: "MC", currency: "EUR", referenceDate: VAL, nodes, interpolation: "monotoneConvex" });
    expect(curve.extrapolation).toBe("flatForward");
    for (const nd of nodes) expect(curve.df(nd.date)).toBeCloseTo(nd.df, 12);
    const between = VAL + Math.round(1.5 * 365);
    const lin = new InterpolatedCurve({ id: "LL", currency: "EUR", referenceDate: VAL, nodes, interpolation: "logLinear" });
    expect(Math.abs(curve.zeroRate(between) - lin.zeroRate(between))).toBeLessThan(0.002);
    expect(curve.zeroRate(between)).toBeGreaterThan(0.022);
    expect(curve.zeroRate(between)).toBeLessThan(0.025);
    // round trip through JSON keeps the method
    expect(InterpolatedCurve.fromJSON(curve.toJSON()).df(between)).toBeCloseTo(curve.df(between), 14);
  });

  it("bootstrapping with monotone convex reprices every quote on the final curve (global sweeps)", () => {
    const res = bootstrapCurve(VAL, { id: "EUR-ESTR-MC", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis, interpolation: "monotoneConvex" });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    const base = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    // Same pillars → (almost) the same zero rates (< 0.2bp); the small difference comes from coupon dates between pillars.
    for (const d of res.curve.nodeDates) expect(Math.abs(res.curve.zeroRate(d) - base.zeroRate(d))).toBeLessThan(2e-5);
    const d1 = addTenor(spot, "18M") + 40;
    expect(Math.abs(res.curve.zeroRate(d1) - base.zeroRate(d1))).toBeLessThan(5e-4); // differs between pillars only slightly
    // spline curves also benefit from the sweeps
    const spline = bootstrapCurve(VAL, { id: "EUR-ESTR-CS", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis, interpolation: "cubicSplineZero" });
    for (const r of spline.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
  });
});

describe("N12 – FxSwapPoints quotes and turn-of-year jumps", () => {
  it("a USD curve implied from EURUSD swap points and the EUR curve reprices the FX forwards", () => {
    const eur = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    const usd = ctx.curves[SAMPLE_CURVE_IDS.usdSofr]!;
    const S = ctx.fxSpots.EURUSD!;
    const spec: CurveBuildSpec = { id: "USD-IMPLIED-EUR", currency: "USD", index: "SOFR", quotes: [], referenceCurveIds: ["EUR-ESTR"] };
    // Fair points from the sample market for 1M … 2Y.
    const tenors = ["1M", "3M", "6M", "1Y", "2Y"];
    spec.quotes = tenors.map((tenor) => {
      const q = { type: "FxSwapPoints" as const, tenor, points: 0, pair: "EURUSD", fxSpot: S, otherDiscountCurveId: "EUR-ESTR" };
      const { end } = quoteDates(VAL, spec, q);
      const fwd = fxForwardRate(ctx, "EUR", "USD", end);
      return { ...q, points: (fwd - S) * 1e4 };
    });
    const { results, curves } = bootstrapCurves(VAL, [spec], { "EUR-ESTR": eur });
    const implied = curves["USD-IMPLIED-EUR"]!;
    for (const r of results["USD-IMPLIED-EUR"]!.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-10);
    // The points pin the forward discount factors from the FX spot date: they coincide with the SOFR curve at the
    // pillars (the 0 → spot stub is a convention of the built curve – pin it with an ON/1W deposit when it matters).
    const ts = quoteDates(VAL, spec, spec.quotes[0]!).start;
    for (const d of implied.nodeDates.slice(1)) expect(implied.df(d) / implied.df(ts) / (usd.df(d) / usd.df(ts))).toBeCloseTo(1, 8);
    // and the FX forward off the implied curve equals the market forward
    const impliedCtx = { ...ctx, curves: { ...ctx.curves, "USD-IMPLIED-EUR": implied }, discountCurveId: { ...ctx.discountCurveId, USD: "USD-IMPLIED-EUR" } };
    const end = quoteDates(VAL, spec, spec.quotes[3]!).end;
    expect(fxForwardRate(impliedCtx, "EUR", "USD", end)).toBeCloseTo(fxForwardRate(ctx, "EUR", "USD", end), 10);
    expect(results["USD-IMPLIED-EUR"]!.residuals.map((r) => r.quote.type)).toEqual(tenors.map(() => "FxSwapPoints"));
    // quote for a pair that does not contain the curve currency is rejected
    const wrongPair: FxSwapPointsQuote = { type: "FxSwapPoints", tenor: "1M", points: 10, pair: "EURGBP", fxSpot: 0.86, otherDiscountCurveId: "EUR-ESTR" };
    expect(() => bootstrapCurve(VAL, { ...spec, quotes: [wrongPair], referenceCurves: { "EUR-ESTR": eur } })).toThrow(/does not contain/);
    expect(quoteLabel(wrongPair)).toBe("FX-Pkt 1M EURGBP");
    expect((bumpQuote(wrongPair, 1) as FxSwapPointsQuote).points).toBeGreaterThan(10);
  });

  it("turn-of-year: the overnight forward over 31 Dec → 1 Jan jumps by the configured bp while all quotes still reprice", () => {
    const toy = parseISO("2026-12-31");
    const res = bootstrapCurve(VAL, { id: "EUR-ESTR-TOY", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis, turnOfYear: [{ date: toy, bp: 15 }] });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    const curve = res.curve;
    expect(curve.forwardJumps).toEqual([{ date: toy, bp: 15, days: undefined }]);
    const before = curve.forwardRate(toy - 1, toy, "ACT/360");
    const over = curve.forwardRate(toy, toy + 1, "ACT/360");
    const after = curve.forwardRate(toy + 1, toy + 2, "ACT/360");
    expect((over - before) * 1e4).toBeCloseTo(15 * (360 / 365), 1);
    expect(Math.abs(after - before) * 1e4).toBeLessThan(0.5);
    // the plain curve has no jump, and the year-end pillars agree (the quotes are unchanged)
    const plain = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    expect(Math.abs(plain.forwardRate(toy, toy + 1, "ACT/360") - plain.forwardRate(toy - 1, toy, "ACT/360")) * 1e4).toBeLessThan(0.5);
    // roll / JSON / snapshot keep the jump
    expect(curve.rolledTo(VAL + 10).forwardJumps[0]!.date).toBe(toy + 10);
    const back = InterpolatedCurve.fromJSON(curve.toJSON());
    expect(back.forwardRate(toy, toy + 1, "ACT/360")).toBeCloseTo(over, 12);
    const snap = deserializeMarket(serializeMarket({ ...ctx, curves: { [curve.id]: curve }, discountCurveId: { EUR: curve.id } }));
    expect(snap.curves[curve.id]!.forwardRate(toy, toy + 1, "ACT/360")).toBeCloseTo(over, 12);
    expect(snap.curves[curve.id]!.df(toy + 100)).toBeCloseTo(curve.df(toy + 100), 12);
  });
});

// ---------------------------------------------------------------------------
// N13 – Confirmation and PRIIPs KID
// ---------------------------------------------------------------------------
describe("N13 – generateConfirmation / generateKid", () => {
  const swap = makeVanillaSwap({
    id: "IRS-C",
    currency: "EUR",
    notional: 1e7,
    payReceiveFixed: "Pay",
    fixedRate: 0.03,
    effectiveDate: spot,
    maturity: "5Y",
    counterparty: "Mittelstand GmbH",
  });
  swap.uti = "E02UTI0001";
  const pricing = priceTrade(ctx, swap, "EUR");

  it("confirmation under DRV with payment schedule from the pricing, and under ISDA from the leg schedule", () => {
    const doc = generateConfirmation(
      swap,
      { bank: { name: "Sparkasse Musterstadt", lei: "5299001234567890ABCD" }, client: { name: "Mittelstand GmbH" } },
      { type: "DRV", date: parseISO("2020-01-15"), reference: "RV-2020-001", csaReference: "BSA-2020-001" },
      ctx,
      pricing,
    );
    expect(doc.kind).toBe("Confirmation");
    expect(doc.title).toContain("Payer-Zinsswap");
    expect(doc.sections.map((s) => s.heading)).toEqual([
      "Parteien",
      "Rahmenvertrag",
      "Wirtschaftliche Bedingungen",
      "Zahlungsplan (variable Beträge indikativ auf Basis der Forwards)",
      "Bestätigung",
    ]);
    const ma = doc.sections[1]!;
    expect(ma.rows!.some(([k, v]) => k === "Rahmenvertrag" && v.includes("DRV") && v.includes("15.01.2020"))).toBe(true);
    expect(ma.rows!.some(([k]) => k === "Besicherungsanhang")).toBe(true);
    expect(doc.sections[2]!.rows!.some(([k, v]) => k === "UTI" && v === "E02UTI0001")).toBe(true);
    const table = doc.sections[3]!.table!;
    expect(table.rows.length).toBe(pricing.legs.reduce((s, l) => s + l.cashflows.length, 0));
    expect(table.rows.some((r) => r[4]!.includes("indikativ"))).toBe(true);
    expect(doc.markdown).toContain("# Bestätigung (Confirmation)");
    expect(doc.markdown).toContain("| Leg | Richtung | Zahltag |");
    const isda = generateConfirmation(swap, { bank: { name: "Bank" }, client: { name: "Client" } }, { type: "ISDA" });
    expect(isda.sections[1]!.paragraphs![0]).toContain("ISDA Master Agreement");
    expect(isda.sections[3]!.heading).toBe("Zahlungsplan (Zahltage)");
    expect(isda.sections[3]!.table!.rows.length).toBe(5 + 10); // 1Y fixed + 6M float
  });

  it("KID: SRI heuristic, performance scenarios from runScenarios, costs from the transaction price, holding period", () => {
    const report = buildValuationReport(ctx, swap, pricing, { transactionPrice: 25_000, generatedAt: "2026-09-03T17:00:00Z" });
    const kid = generateKid(ctx, swap, pricing, undefined, { manufacturer: "Sparkasse Musterstadt", report, contact: "beschwerde@sparkasse-musterstadt.de" });
    expect(kid.kind).toBe("KID");
    expect(kid.title).toBe("Basisinformationsblatt");
    const headings = kid.sections.map((s) => s.heading);
    expect(headings[0]).toBe("Zweck");
    expect(headings).toContain("Welche Risiken bestehen und was könnte ich im Gegenzug dafür bekommen?");
    expect(headings).toContain("Welche Kosten entstehen?");
    const risk = kid.sections.find((s) => s.heading.startsWith("Welche Risiken"))!;
    const sriRow = risk.rows!.find(([k]) => k.startsWith("Gesamtrisikoindikator"))![1];
    expect(sriRow).toMatch(/^[2-7] von 7/);
    expect(risk.table!.rows.map((r) => r[0])).toEqual(["Stressszenario", "Pessimistisches Szenario", "Mittleres Szenario", "Optimistisches Szenario"]);
    const stress = risk.table!.rows[0]!;
    expect(stress[3]).toBeTruthy(); // names the worst standard scenario
    const costs = kid.sections.find((s) => s.heading === "Welche Kosten entstehen?")!;
    expect(costs.rows!.some(([k, v]) => k.startsWith("Einstiegskosten") && v.includes("bp"))).toBe(true);
    expect(costs.rows!.some(([k]) => k.startsWith("Auswirkung auf die Rendite"))).toBe(true);
    expect(kid.sections.find((s) => s.heading.startsWith("Um welche Art"))!.rows!.some(([k, v]) => k === "Laufzeit" && v.includes("5,0 Jahre"))).toBe(true);
    expect(kid.markdown).toContain(report.audit.snapshotId);
    // explicit scenarios and a bought option: loss capped at the premium → low SRI
    const cap = makeCapFloor({ id: "CAP", currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
    const capRes = priceTrade(ctx, cap, "EUR");
    const scen = runScenarios(ctx, [cap], HISTORICAL_SCENARIOS, "EUR").results;
    const capKid = generateKid(ctx, cap, capRes, scen, { manufacturer: "Bank", perspective: "Kunde", transactionPrice: capRes.pv * 1.1 });
    const capRisk = capKid.sections.find((s) => s.heading.startsWith("Welche Risiken"))!;
    expect(capRisk.rows!.find(([k]) => k === "Herleitung")![1]).toContain("begrenzt auf die gezahlte Prämie");
    expect(capRisk.rows!.find(([k]) => k === "Herleitung")![1]).toContain("6 Szenarien");
    expect(capKid.sections.find((s) => s.heading === "Welche Kosten entstehen?")!.rows![0]![1]).toContain("bp");
    // SRI classes
    expect(summaryRiskIndicator(0.001).sri).toBe(2);
    expect(summaryRiskIndicator(0.08).sri).toBe(3);
    expect(summaryRiskIndicator(0.15).sri).toBe(4);
    expect(summaryRiskIndicator(0.25).sri).toBe(5);
    expect(summaryRiskIndicator(0.5).sri).toBe(6);
    expect(summaryRiskIndicator(0.9).sri).toBe(7);
    expect(summaryRiskIndicator(0.9, { isBoughtOption: true }).sri).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// N18 – JPY sample curve
// ---------------------------------------------------------------------------
describe("N18 – JPY TONA sample curve", () => {
  it("builds JPY-TONA, registers it as JPY discount curve and prices a JPY OIS swap", () => {
    expect(ctx.curves[SAMPLE_CURVE_IDS.jpyTona]).toBeDefined();
    expect(ctx.discountCurveId.JPY).toBe("JPY-TONA");
    const jpSpot = advance(VAL, "2D", getCalendar("JP"));
    const swap = makeVanillaSwap({
      id: "IRS-JPY",
      currency: "JPY",
      notional: 1e9,
      payReceiveFixed: "Pay",
      fixedRate: 0.01,
      effectiveDate: jpSpot,
      maturity: "5Y",
    });
    expect(swap.legs[1]!.type === "Float" && swap.legs[1]!.index).toBe("TONA");
    const res = priceTrade(ctx, swap, "JPY");
    expect(Number.isFinite(res.pv)).toBe(true);
    expect(res.analytics.parRate as number).toBeCloseTo(0.0118, 3);
    // reporting in EUR via EURJPY spot
    expect(Number.isFinite(priceTrade(ctx, swap, "EUR").pv)).toBe(true);
    const quotes5y = SAMPLE_QUOTES.jpyTona!.find((q) => q.type === "OIS" && q.tenor === "5Y")!;
    expect(quotes5y.type === "OIS" && quotes5y.rate).toBe(0.0118);
    const { jpyTona: _j, ...withoutJpy } = SAMPLE_QUOTES;
    const noJpy = buildSampleMarket(VAL, withoutJpy);
    expect(noJpy.discountCurveId.JPY).toBeUndefined();
    expect(() => priceTrade(noJpy, swap, "JPY")).toThrow(/No discount curve configured for JPY/);
  });
});

// ---------------------------------------------------------------------------
// UI review – hashes and FX option analytics contract
// ---------------------------------------------------------------------------
describe("UI review – report hashes include cost inputs; FX analytics contract", () => {
  it("transactionPrice 0 vs 25 000 (and perspective) produce different inputs and report hashes; the snapshot id is exported", () => {
    const swap = makeVanillaSwap({ id: "S", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
    const pricing = priceTrade(ctx, swap, "EUR");
    const at = "2026-09-03T17:00:00Z";
    const r0 = buildValuationReport(ctx, swap, pricing, { transactionPrice: 0, generatedAt: at });
    const r1 = buildValuationReport(ctx, swap, pricing, { transactionPrice: 25_000, generatedAt: at });
    const r2 = buildValuationReport(ctx, swap, pricing, { transactionPrice: 25_000, perspective: "Kunde", generatedAt: at });
    const plain = buildValuationReport(ctx, swap, pricing, { generatedAt: at });
    expect(r0.audit.inputsHash).not.toBe(r1.audit.inputsHash);
    expect(r0.audit.reportHash).not.toBe(r1.audit.reportHash);
    expect(r1.audit.inputsHash).not.toBe(r2.audit.inputsHash);
    expect(r1.audit.reportHash).not.toBe(r2.audit.reportHash);
    expect(plain.audit.inputsHash).not.toBe(r0.audit.inputsHash);
    expect(r1.costTransparency!.bankMargin).toBeCloseTo(r1.fairValue.adjusted - 25_000, 6);
    // deterministic and snapshot id identical across reports and the exported helper
    expect(buildValuationReport(ctx, swap, pricing, { transactionPrice: 25_000, generatedAt: at }).audit.reportHash).toBe(r1.audit.reportHash);
    expect(r0.audit.snapshotId).toBe(r1.audit.snapshotId);
    expect(marketSnapshotId(ctx)).toBe(r1.audit.snapshotId);
    expect(marketSnapshotId(applyScenario(ctx, { id: "x", name: "x", curveShifts: [{ target: "*", parallelBp: 1 }] }))).not.toBe(marketSnapshotId(ctx));
  });

  it("FX option: deltaAmount is money per +1 % spot, deltaPct the signed spot-delta fraction; dates only in details", () => {
    const call = makeFxOption({ id: "O", pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.16, expiryDate: parseISO("2027-03-03") });
    const res = priceTrade(ctx, call, "USD");
    const a = res.analytics;
    expect(typeof a.deltaAmount).toBe("number");
    expect(a.deltaPct as number).toBeGreaterThan(0.3);
    expect(a.deltaPct as number).toBeLessThan(0.7);
    expect(a.deltaPct as number).toBeCloseTo((a.deltaBase as number) / 1e6, 12);
    // deltaAmount ≈ central-difference PV change scaled to +1 % spot at a fixed (sticky-strike) vol; the smile
    // re-read at the moved forward adds a small smile-delta term and a full 1 % move carries a visible gamma term.
    const fixedVol = { ...call, volOverride: a.volatility as number };
    const fixedRes = priceTrade(ctx, fixedVol, "USD");
    const bump = (f: number) => priceTrade({ ...ctx, fxSpots: { ...ctx.fxSpots, EURUSD: ctx.fxSpots.EURUSD! * (1 + f) } }, fixedVol, "USD").pv;
    const central = ((bump(1e-4) - bump(-1e-4)) / 2e-4) * 0.01;
    expect(Math.abs((fixedRes.analytics.deltaAmount as number) / central - 1)).toBeLessThan(1e-3);
    expect(Math.abs((fixedRes.analytics.deltaAmount as number) / (bump(0.01) - fixedRes.pv) - 1)).toBeLessThan(0.1);
    expect(Math.abs((a.deltaAmount as number) / (fixedRes.analytics.deltaAmount as number) - 1)).toBeLessThan(1e-9); // same vol → same delta
    // short put: deltaPct positive (short a negative delta), consistent sign with deltaAmount
    const shortPut = makeFxOption({
      id: "P",
      pair: "EURUSD",
      optionType: "Put",
      notional: 1e6,
      strike: 1.16,
      expiryDate: parseISO("2027-03-03"),
      longShort: "Short",
    });
    const sp = priceTrade(ctx, shortPut, "USD").analytics;
    expect(sp.deltaPct as number).toBeGreaterThan(0);
    expect(Math.sign(sp.deltaAmount as number)).toBe(Math.sign(sp.deltaPct as number));
    // no serial dates in analytics; spotDate in details as ISO
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "number") expect(k === "spotDate" || k === "fixingDate").toBe(false);
    }
    expect(res.details?.spotDate).toBe("2026-09-08");
    expect(a.spotDate).toBeUndefined();
    const fxs = priceTrade(
      ctx,
      { ...makeFxOption({ id: "X", pair: "EURUSD", optionType: "Call", notional: 1, strike: 1, expiryDate: parseISO("2027-03-03") }) },
      "USD",
    );
    expect(fxs.details?.spotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const swap = priceTrade(
      ctx,
      makeVanillaSwap({ id: "S", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" }),
      "EUR",
    );
    expect(swap.details?.maturity).toBe(toISO(swap.analytics.maturity as number));
    expect(yearFraction(VAL, swap.analytics.maturity as number, "ACT/365F")).toBeCloseTo(swap.analytics.remainingYears as number, 10);
  });
});
