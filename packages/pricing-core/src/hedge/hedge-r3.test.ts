import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { addDays, addTenor, parseISO } from "../dates/date.js";
import { linearAmortisation, makeCapFloor, makeFxOption } from "../instruments/builders.js";
import { type CapFloor, type FxOption } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { shiftFxSurface } from "../models/fx-vol-surface.js";
import { shiftCapletSurface } from "../models/vol-surfaces.js";
import { priceTrade } from "../pricing/price.js";
import { applyScenario } from "../risk/scenarios.js";
import { type HedgeRelationship, criticalTermsMatch, designationVol, hedgeEffectivenessReport, hypotheticalDerivative } from "./hedge.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));
const maturity = addTenor(spot, "5Y");

const parallel = (bp: number) => ({ id: `par${bp}`, name: `${bp}bp`, curveShifts: [{ target: "*", parallelBp: bp }] });

/** Amortising 10m EURIBOR-6M loan (linear, annual instalments) hedged with `cap`. */
function loanRel(cap: CapFloor, amortising: boolean): HedgeRelationship {
  return {
    id: "HR-AMCAP",
    name: "Zinsobergrenze Tilgungsdarlehen",
    type: "CashFlowHedge",
    hedgedItem: {
      description: "Tilgungsdarlehen 10 Mio.",
      currency: "EUR",
      notional: 1e7,
      kind: "FloatingRateLoan",
      index: "EURIBOR-6M",
      effectiveDate: spot,
      maturityDate: maturity,
      ...(amortising ? { amortisation: { type: "Linear" as const } } : {}),
    },
    hedgingInstrumentId: cap.id,
    designationDate: VAL,
    method: "CriticalTerms",
    accountingFramework: "IFRS9",
  };
}

const bulletCap = makeCapFloor({
  id: "CAP-B",
  currency: "EUR",
  notional: 1e7,
  capFloor: "Cap",
  strike: 0.03,
  effectiveDate: spot,
  maturity,
  index: "EURIBOR-6M",
});
// Amortising cap: the loan's annual linear plan (the cap strip is semi-annual; the plan steps at the loan's period starts).
const plan = linearAmortisation({ effectiveDate: spot, terminationDate: maturity, frequency: "1Y", calendar: "TARGET" }, 1e7);
const amortCap: CapFloor = { ...bulletCap, id: "CAP-AM", notionalSchedule: plan };

describe("R3-5 – amortising cap / hypothetical cap with notional schedule", () => {
  it("the cap pricer honours notionalSchedule: period notionals follow the plan, PV below the bullet cap", () => {
    const bullet = priceTrade(ctx, bulletCap, "EUR");
    const amort = priceTrade(ctx, amortCap, "EUR");
    expect(amort.pv).toBeGreaterThan(0);
    expect(amort.pv).toBeLessThan(bullet.pv);
    const cfs = amort.legs[0]!.cashflows;
    expect(cfs[0]!.notional).toBe(1e7);
    expect(cfs[cfs.length - 1]!.notional).toBeCloseTo(2e6, 6);
    // semi-annual caplets: two periods per plan step
    expect(new Set(cfs.map((c) => c.notional)).size).toBe(5);
    for (const c of cfs) {
      const expected = plan.filter((p) => p.date <= c.accrualStart!).at(-1)!.notional;
      expect(c.notional).toBeCloseTo(expected, 6);
    }
    // Vega / delta scale with the outstanding notional
    expect(amort.analytics.vega as number).toBeLessThan(bullet.analytics.vega as number);
    expect(amort.analytics.vega as number).toBeGreaterThan(0.3 * (bullet.analytics.vega as number));
  });

  it("amortising loan vs amortising cap: the hypothetical cap carries the notional path, critical terms met, dollar-offset 1.00", () => {
    const rel = loanRel(amortCap, true);
    const hypo = hypotheticalDerivative(ctx, rel, amortCap) as CapFloor;
    expect(hypo.type).toBe("CapFloor");
    expect(hypo.notionalSchedule).toHaveLength(5);
    expect(hypo.notionalSchedule!.map((p) => p.notional)).toEqual(plan.map((p) => p.notional));
    expect(priceTrade(ctx, hypo, "EUR").pv).toBeCloseTo(priceTrade(ctx, amortCap, "EUR").pv, 6);
    const terms = criticalTermsMatch(rel, amortCap);
    const schedule = terms.checks.find((c) => c.term === "notionalSchedule")!;
    expect(schedule.applicable).toBe(true);
    expect(schedule.match).toBe(true);
    expect(schedule.hedgedItem).toContain("amortisierend");
    expect(schedule.hedgingInstrument).toContain("10.000.000 → 2.000.000");
    expect(terms.matches).toBe(true);
    const rep = hedgeEffectivenessReport(applyScenario(ctx, parallel(30)), rel, amortCap, { designationCtx: ctx });
    expect(rep.criticalTerms.matches).toBe(true);
    expect(rep.effective).toBe(true);
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(1, 6);
    expect(rep.dollarOffsetCumulative!.ratio!).toBeCloseTo(1, 6);
  });

  it("amortising loan vs bullet cap (and vice versa): the notional path check fails", () => {
    const bulletVsAmortLoan = criticalTermsMatch(loanRel(bulletCap, true), bulletCap);
    const check = bulletVsAmortLoan.checks.find((c) => c.term === "notionalSchedule")!;
    expect(check.applicable).toBe(true);
    expect(check.match).toBe(false);
    expect(check.hedgingInstrument).toContain("konstant");
    expect(check.hedgingInstrument).toMatch(/Abweichung in \d+ Periode/);
    expect(bulletVsAmortLoan.matches).toBe(false);
    const amortCapVsBulletLoan = criticalTermsMatch(loanRel(amortCap, false), amortCap);
    expect(amortCapVsBulletLoan.checks.find((c) => c.term === "notionalSchedule")!.match).toBe(false);
    // bullet vs bullet: not applicable
    expect(criticalTermsMatch(loanRel(bulletCap, false), bulletCap).checks.find((c) => c.term === "notionalSchedule")!.applicable).toBe(false);
  });
});

describe("R3-6 – freezeDesignationVol: hypothetical option vol frozen at designation", () => {
  const capRel = loanRel(bulletCap, false);
  /** Current market: rates +25bp, caplet vols +20bp normal, FX vols +2 vol points (vs. the designation market `ctx`). */
  const ratesUp = applyScenario(ctx, parallel(25));
  const ratesAndVolsUp: MarketContext = {
    ...ratesUp,
    capletVols: Object.fromEntries(Object.entries(ratesUp.capletVols!).map(([k, s]) => [k, shiftCapletSurface(s, 0.002)])),
    fxVols: Object.fromEntries(Object.entries(ratesUp.fxVols!).map(([k, s]) => [k, shiftFxSurface(s, 0.02)])),
  };

  it("cap: the frozen flat vol reproduces the designation PV; PV changes then stem from rates only", () => {
    const hypo = hypotheticalDerivative(ctx, capRel, bulletCap) as CapFloor;
    const vol = designationVol(ctx, hypo, "EUR")!;
    expect(vol).toBeGreaterThan(0.002);
    expect(vol).toBeLessThan(0.02);
    expect(priceTrade(ctx, { ...hypo, volOverride: vol }, "EUR").pv).toBeCloseTo(priceTrade(ctx, hypo, "EUR").pv, 6);
    const frozenA = hedgeEffectivenessReport(ratesUp, capRel, bulletCap, { designationCtx: ctx, freezeDesignationVol: true });
    const frozenB = hedgeEffectivenessReport(ratesAndVolsUp, capRel, bulletCap, { designationCtx: ctx, freezeDesignationVol: true });
    expect(frozenA.hypotheticalDerivative.frozenVol).toBeCloseTo(vol, 12);
    expect((frozenA.hypotheticalDerivative.trade as CapFloor).volOverride).toBeCloseTo(vol, 12);
    // same rates, different vols → identical hypothetical PV when frozen …
    expect(frozenB.hypotheticalDerivative.pv).toBeCloseTo(frozenA.hypotheticalDerivative.pv, 8);
    // … but a different PV without freezing (the hypothetical is revalued on the bumped surface)
    const liveA = hedgeEffectivenessReport(ratesUp, capRel, bulletCap, { designationCtx: ctx });
    const liveB = hedgeEffectivenessReport(ratesAndVolsUp, capRel, bulletCap, { designationCtx: ctx });
    expect(Math.abs(liveB.hypotheticalDerivative.pv - liveA.hypotheticalDerivative.pv)).toBeGreaterThan(1000);
    expect(liveA.hypotheticalDerivative.frozenVol).toBeUndefined();
    // the hedging instrument itself still carries the vol move: ineffectiveness shows up in the cumulative offset
    expect(frozenB.dollarOffsetCumulative!.deltaHedge).not.toBeCloseTo(frozenB.dollarOffsetCumulative!.deltaHypothetical, 0);
    expect(frozenA.summary.some((s) => s.includes("eingefroren") && s.includes("bp Normal-Vol"))).toBe(true);
    // rates-only move: frozen hypothetical PV change equals the pure rate effect on the flat-vol cap
    const pureRates = priceTrade(ratesUp, { ...hypo, volOverride: vol }, "EUR").pv - priceTrade(ctx, { ...hypo, volOverride: vol }, "EUR").pv;
    expect(frozenA.dollarOffsetCumulative!.deltaHypothetical).toBeCloseTo(pureRates, 6);
  });

  it("FX option: the frozen vol is the designation smile vol at strike / expiry", () => {
    const expiry = addDays(VAL, 365);
    const put = makeFxOption({ id: "FXO-H", pair: "EURUSD", optionType: "Put", notional: 1e6, strike: 1.15, expiryDate: expiry });
    const rel: HedgeRelationship = {
      id: "HR-FXO",
      name: "Absicherung EUR-Verkauf",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Erwarteter USD-Erlös",
        currency: "EUR",
        notional: 1e6,
        kind: "ForecastFxCashflow",
        fxPair: "EURUSD",
        effectiveDate: VAL,
        maturityDate: put.deliveryDate,
      },
      hedgingInstrumentId: "FXO-H",
      designationDate: VAL,
      method: "DollarOffset",
      accountingFramework: "IFRS9",
    };
    const hypo = hypotheticalDerivative(ctx, rel, put) as FxOption;
    const vol = designationVol(ctx, hypo, "USD")!;
    expect(vol).toBeCloseTo(priceTrade(ctx, hypo, "USD").analytics.volatility as number, 12);
    const frozenA = hedgeEffectivenessReport(ratesUp, rel, put, { designationCtx: ctx, freezeDesignationVol: true });
    const frozenB = hedgeEffectivenessReport(ratesAndVolsUp, rel, put, { designationCtx: ctx, freezeDesignationVol: true });
    expect(frozenA.hypotheticalDerivative.frozenVol).toBeCloseTo(vol, 12);
    expect(frozenB.hypotheticalDerivative.pv).toBeCloseTo(frozenA.hypotheticalDerivative.pv, 8);
    const liveB = hedgeEffectivenessReport(ratesAndVolsUp, rel, put, { designationCtx: ctx });
    expect(Math.abs(liveB.hypotheticalDerivative.pv - frozenB.hypotheticalDerivative.pv)).toBeGreaterThan(100);
    expect(frozenA.summary.some((s) => s.includes("eingefroren") && s.includes("%"))).toBe(true);
    expect(frozenA.warnings.some((w) => w.includes("eingefroren"))).toBe(false);
  });

  it("without designation market data or for a linear hypothetical nothing is frozen (warning / no-op)", () => {
    const noDesignation = hedgeEffectivenessReport(ratesUp, capRel, bulletCap, { freezeDesignationVol: true });
    expect(noDesignation.hypotheticalDerivative.frozenVol).toBeUndefined();
    expect(noDesignation.warnings.some((w) => w.includes("Designationsmarktdaten nicht eingefroren"))).toBe(true);
    // an explicit volOverride on the hedging instrument is inherited by the hypothetical and left alone
    const withOverride = { ...bulletCap, volOverride: 0.007 };
    const rep = hedgeEffectivenessReport(ratesUp, { ...capRel, hedgingInstrumentId: withOverride.id }, withOverride, {
      designationCtx: ctx,
      freezeDesignationVol: true,
    });
    expect(rep.hypotheticalDerivative.frozenVol).toBeUndefined();
    expect((rep.hypotheticalDerivative.trade as CapFloor).volOverride).toBe(0.007);
  });
});
