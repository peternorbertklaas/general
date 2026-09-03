import { beforeAll, describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { addTenor, parseISO } from "../dates/date.js";
import { makeFxForward, makeVanillaSwap } from "../instruments/builders.js";
import { type FxForward, type InterestRateSwap } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { priceTrade } from "../pricing/price.js";
import { applyScenario } from "../risk/scenarios.js";
import {
  DEFAULT_EFFECTIVENESS_BAND,
  type HedgeRelationship,
  criticalTermsMatch,
  dollarOffset,
  hedgeEffectivenessReport,
  hgbSplit,
  hypotheticalDerivative,
  ifrs9Split,
  olsRegression,
  regressionScenarios,
  regressionTest,
} from "./hedge.js";

const VAL = parseISO("2026-09-03");
let ctx: MarketContext;
let spot: number;
let maturity: number;

const parallel = (bp: number) => ({ id: `par${bp}`, name: `${bp}bp`, curveShifts: [{ target: "*", parallelBp: bp }] });

/** 10m EUR floating-rate loan (EURIBOR-6M) hedged with a payer swap of `swapNotional`. */
function loanHedge(
  swapNotional: number,
  hedgeRatio = 1,
  method: HedgeRelationship["method"] = "DollarOffset",
  framework: HedgeRelationship["accountingFramework"] = "IFRS9",
) {
  const swap = makeVanillaSwap({
    id: "IRS-1",
    currency: "EUR",
    notional: swapNotional,
    payReceiveFixed: "Pay",
    fixedRate: 0.03,
    effectiveDate: spot,
    maturity,
  });
  const rel: HedgeRelationship = {
    id: "HR-1",
    name: "Zinssicherung Betriebsmittelkredit",
    type: "CashFlowHedge",
    hedgedItem: {
      description: "Roll-over-Kredit Sparkasse",
      currency: "EUR",
      notional: 10_000_000,
      kind: "FloatingRateLoan",
      index: "EURIBOR-6M",
      effectiveDate: spot,
      maturityDate: maturity,
    },
    hedgingInstrumentId: "IRS-1",
    designationDate: VAL,
    hedgeRatio,
    method,
    accountingFramework: framework,
  };
  return { swap, rel };
}

beforeAll(() => {
  ctx = buildSampleMarket(VAL);
  spot = advance(VAL, "2D", getCalendar("TARGET"));
  maturity = addTenor(spot, "5Y");
});

describe("hypothetical derivative", () => {
  it("floating-rate loan → par payer swap with the loan's terms (PV ≈ 0 at designation)", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const hypo = hypotheticalDerivative(ctx, rel, swap) as InterestRateSwap;
    expect(hypo.type).toBe("InterestRateSwap");
    expect(hypo.legs[0]!.notional).toBe(10_000_000);
    expect(hypo.legs[0]!.effectiveDate).toBe(spot);
    expect(hypo.legs[0]!.terminationDate).toBe(maturity);
    expect(hypo.legs[0]!.payReceive).toBe("Pay");
    expect(hypo.legs[1]!.type === "Float" && hypo.legs[1]!.index).toBe("EURIBOR-6M");
    const res = priceTrade(ctx, hypo, "EUR");
    expect(Math.abs(res.pv)).toBeLessThan(0.01);
    expect(hypo.legs[0]!.type === "Fixed" && hypo.legs[0]!.rate).toBeCloseTo(res.analytics.parRate as number, 12);
    expect(hypo.legs[0]!.type === "Fixed" && hypo.legs[0]!.rate).toBeCloseTo(0.0262, 3);
  });
  it("hedge ratio scales the hypothetical notional; direction follows the hedging instrument", () => {
    const { swap, rel } = loanHedge(5_000_000, 0.5);
    const hypo = hypotheticalDerivative(ctx, rel, swap) as InterestRateSwap;
    expect(hypo.legs[0]!.notional).toBe(5_000_000);
    const receiver = makeVanillaSwap({
      id: "IRS-R",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.03,
      effectiveDate: spot,
      maturity,
    });
    const fvRel: HedgeRelationship = {
      ...rel,
      type: "FairValueHedge",
      hedgingInstrumentId: "IRS-R",
      hedgeRatio: 1,
      hedgedItem: { ...rel.hedgedItem, kind: "FixedRateLoan", fixedRate: 0.031, index: undefined },
    };
    const h2 = hypotheticalDerivative(ctx, fvRel, receiver) as InterestRateSwap;
    expect(h2.legs[0]!.payReceive).toBe("Receive");
    expect(h2.legs[0]!.type === "Fixed" && h2.legs[0]!.rate).toBe(0.031);
    expect(() => hypotheticalDerivative(ctx, { ...rel, hedgeRatio: 0 }, swap)).toThrow(/hedge ratio/i);
  });
  it("forecast FX cash flow → forward at fair rate at designation (PV ≈ 0), mirroring the hedging forward", () => {
    const delivery = parseISO("2027-09-07");
    const fwd = makeFxForward({ id: "FXF-1", pair: "EURUSD", baseAmount: 1e6 / 1.17, rate: 1.17, deliveryDate: delivery }); // sells 1m USD
    const rel: HedgeRelationship = {
      id: "HR-FX",
      name: "Absicherung USD-Exporterlöse",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Erwarteter USD-Umsatz Q3/2027",
        currency: "USD",
        notional: 1e6,
        amount: 1e6,
        kind: "ForecastFxCashflow",
        fxPair: "EURUSD",
        effectiveDate: VAL,
        maturityDate: delivery,
      },
      hedgingInstrumentId: "FXF-1",
      designationDate: VAL,
      method: "DollarOffset",
      accountingFramework: "IFRS9",
    };
    const hypo = hypotheticalDerivative(ctx, rel, fwd) as FxForward;
    expect(hypo.type).toBe("FxForward");
    expect(hypo.sellCurrency).toBe("USD");
    expect(hypo.sellAmount).toBeCloseTo(1e6, 6);
    expect(hypo.buyCurrency).toBe("EUR");
    expect(hypo.deliveryDate).toBe(delivery);
    expect(Math.abs(priceTrade(ctx, hypo, "EUR").pv)).toBeLessThan(1e-6);
    // Implied rate equals the fair forward
    const fair = priceTrade(ctx, fwd, "USD").analytics.fairForward as number;
    expect(hypo.buyAmount / hypo.sellAmount).toBeCloseTo(1 / fair, 10);
    // Past cash flow → error
    expect(() => hypotheticalDerivative(ctx, { ...rel, hedgedItem: { ...rel.hedgedItem, maturityDate: VAL - 1 } }, fwd)).toThrow();
  });
});

describe("critical terms", () => {
  it("matching payer swap: all applicable terms match", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const ct = criticalTermsMatch(rel, swap);
    expect(ct.matches).toBe(true);
    expect(ct.checks.filter((c) => c.applicable)).toHaveLength(5);
    expect(ct.checks.every((c) => c.match)).toBe(true);
  });
  it("mismatched notional / index / maturity are flagged", () => {
    const { swap, rel } = loanHedge(7_000_000);
    const ct = criticalTermsMatch(rel, swap);
    expect(ct.matches).toBe(false);
    expect(ct.checks.find((c) => c.term === "notional")!.match).toBe(false);
    expect(ct.checks.find((c) => c.term === "currency")!.match).toBe(true);
    const wrongIndex = criticalTermsMatch(
      { ...rel, hedgedItem: { ...rel.hedgedItem, index: "EURIBOR-3M" } },
      makeVanillaSwap({ id: "IRS-1", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity }),
    );
    expect(wrongIndex.checks.find((c) => c.term === "index")!.match).toBe(false);
    // Maturity 3 days off is inside the default tolerance, 30 days is not
    const near = criticalTermsMatch(
      { ...rel, hedgedItem: { ...rel.hedgedItem, maturityDate: maturity + 3 } },
      makeVanillaSwap({ id: "IRS-1", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity }),
    );
    expect(near.matches).toBe(true);
    const far = criticalTermsMatch(
      { ...rel, hedgedItem: { ...rel.hedgedItem, maturityDate: maturity + 30 } },
      makeVanillaSwap({ id: "IRS-1", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity }),
    );
    expect(far.checks.find((c) => c.term === "maturityDate")!.match).toBe(false);
  });
});

describe("dollar offset", () => {
  it("payer swap vs hypothetical: ratio ≈ 1 for a +100bp shift; zero change → not assessable", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const hypo = hypotheticalDerivative(ctx, rel, swap);
    const up = applyScenario(ctx, parallel(100));
    const d = dollarOffset(ctx, up, swap, hypo);
    expect(d.assessable).toBe(true);
    expect(d.deltaHedge).toBeGreaterThan(0); // payer gains when rates rise
    expect(d.ratio!).toBeCloseTo(1, 1);
    expect(d.ratio!).toBeGreaterThan(0.97);
    expect(d.ratio!).toBeLessThan(1.03);
    expect(d.effective).toBe(true);
    expect(d.band).toEqual(DEFAULT_EFFECTIVENESS_BAND);
    const flat = dollarOffset(ctx, ctx, swap, hypo);
    expect(flat.assessable).toBe(false);
    expect(flat.ratio).toBeUndefined();
    expect(flat.effective).toBe(false);
  });
  it("under-hedge (7m vs 10m) gives ratio ≈ 0.7 → outside the band; custom band accepted", () => {
    const { swap, rel } = loanHedge(7_000_000);
    const hypo = hypotheticalDerivative(ctx, rel, swap);
    const d = dollarOffset(ctx, applyScenario(ctx, parallel(-50)), swap, hypo);
    expect(d.ratio!).toBeCloseTo(0.7, 1);
    expect(d.effective).toBe(false);
    const wide = dollarOffset(ctx, applyScenario(ctx, parallel(-50)), swap, hypo, { band: [0.5, 1.5] });
    expect(wide.effective).toBe(true);
  });
});

describe("regression", () => {
  it("OLS helper: exact line, degenerate inputs", () => {
    const fit = olsRegression([1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 })))!;
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(
      olsRegression([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBeUndefined();
    expect(
      olsRegression([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ]),
    ).toBeUndefined();
  });
  it("payer swap vs hypothetical: slope ≈ 1, R² ≈ 1 over the default 18 IR scenarios", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const hypo = hypotheticalDerivative(ctx, rel, swap);
    const r = regressionTest(ctx, swap, hypo);
    expect(r.n).toBe(18);
    expect(regressionScenarios()).toHaveLength(18);
    expect(regressionScenarios({ fxCurrency: "USD" })).toHaveLength(30);
    expect(r.assessable).toBe(true);
    expect(r.slope!).toBeGreaterThan(0.97);
    expect(r.slope!).toBeLessThan(1.03);
    expect(r.r2!).toBeGreaterThan(0.999);
    expect(Math.abs(r.intercept!)).toBeLessThan(0.001 * 1e7);
    expect(r.effective).toBe(true);
    expect(r.points.map((p) => p.scenarioId)).toContain("steep");
    // A receiver swap against the payer hypothetical has slope ≈ −1 → not effective
    const receiver = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Receive", fixedRate: 0.03, effectiveDate: spot, maturity });
    const rr = regressionTest(ctx, receiver, hypo);
    expect(rr.slope!).toBeLessThan(-0.9);
    expect(rr.effective).toBe(false);
  });
});

describe("hedge effectiveness report", () => {
  it("payer swap vs floating loan (IFRS 9 cash flow hedge): effective, OCI = lower-of, German summary", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const now = applyScenario(ctx, parallel(-50)); // rates fell since designation
    const rep = hedgeEffectivenessReport(now, rel, swap, { designationCtx: ctx });
    expect(rep.effective).toBe(true);
    expect(rep.assessable).toBe(true);
    expect(rep.criticalTerms.matches).toBe(true);
    expect(rep.effectiveByMethod.CriticalTerms).toBe(true);
    expect(rep.effectiveByMethod.DollarOffset).toBe(true);
    expect(rep.effectiveByMethod.Regression).toBe(true);
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(1, 1);
    expect(rep.dollarOffsetCumulative!.ratio!).toBeCloseTo(1, 1);
    expect(rep.dollarOffsetPeriod).toBe(rep.dollarOffsetCumulative);
    expect(rep.regression.slope!).toBeCloseTo(1, 1);
    // Payer swap lost value as rates fell
    const i9 = rep.ifrs9;
    expect(i9.assessable).toBe(true);
    expect(i9.hedgingInstrumentChange).toBeLessThan(0);
    expect(i9.hypotheticalChange).toBeLessThan(0);
    expect(i9.hedgedItemChange).toBeCloseTo(-i9.hypotheticalChange, 10);
    expect(Math.abs(i9.oci)).toBeCloseTo(Math.min(Math.abs(i9.hedgingInstrumentChange), Math.abs(i9.hypotheticalChange)), 8);
    expect(Math.sign(i9.oci)).toBe(Math.sign(i9.hedgingInstrumentChange));
    expect(i9.oci + i9.pnl).toBeCloseTo(i9.hedgingInstrumentChange, 8);
    // Off-market hedging swap (3% vs par 2.62%) → warning about ineffectiveness source
    expect(rep.warnings.some((w) => w.includes("nicht marktgerecht"))).toBe(true);
    expect(rep.summary.length).toBeGreaterThanOrEqual(8);
    expect(rep.summary.some((s) => s.includes("Cashflow-Hedge") && s.includes("IFRS 9"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("Critical-Terms-Match: erfüllt"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("Sicherungsbeziehung effektiv"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("Cashflow-Hedge-Rücklage"))).toBe(true);
    expect(rep.valuationDate).toBe("2026-09-03");
    expect(rep.reportingCurrency).toBe("EUR");
    expect(rep.hypotheticalDerivative.trade.id).toBe("HYPO-HR-1");
  });
  it("mismatched notional → not effective under critical terms and dollar offset", () => {
    const { swap, rel } = loanHedge(7_000_000, 1, "CriticalTerms");
    const rep = hedgeEffectivenessReport(ctx, rel, swap, { designationCtx: ctx });
    expect(rep.criticalTerms.matches).toBe(false);
    expect(rep.effective).toBe(false);
    expect(rep.effectiveByMethod.DollarOffset).toBe(false);
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(0.7, 1);
    expect(rep.warnings.some((w) => w.includes("Hedge Ratio"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("Critical-Terms-Match: nicht erfüllt") && s.includes("Nominal"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("nicht effektiv"))).toBe(true);
    const asDollar = hedgeEffectivenessReport(ctx, { ...rel, method: "DollarOffset" }, swap);
    expect(asDollar.effective).toBe(false);
  });
  it("FX forward vs forecast USD cash flow → effective, FX shocks included in regression", () => {
    const delivery = parseISO("2027-09-07");
    const fwd = makeFxForward({ id: "FXF-1", pair: "EURUSD", baseAmount: 1e6 / 1.17, rate: 1.17, deliveryDate: delivery });
    const rel: HedgeRelationship = {
      id: "HR-FX",
      name: "Absicherung USD-Exporterlöse",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Erwarteter USD-Umsatz",
        currency: "USD",
        notional: 1e6,
        kind: "ForecastFxCashflow",
        fxPair: "EURUSD",
        effectiveDate: VAL,
        maturityDate: delivery,
      },
      hedgingInstrumentId: "FXF-1",
      designationDate: VAL,
      method: "Regression",
      accountingFramework: "IFRS9",
    };
    const now = applyScenario(ctx, { id: "usd+5", name: "USD +5%", fxShiftsPct: { USD: 5 } });
    const rep = hedgeEffectivenessReport(now, rel, fwd, { designationCtx: ctx });
    expect(rep.reportingCurrency).toBe("EUR");
    expect(rep.criticalTerms.matches).toBe(true);
    expect(rep.criticalTerms.checks.find((c) => c.term === "index")!.applicable).toBe(false);
    expect(rep.criticalTerms.checks.find((c) => c.term === "effectiveDate")!.applicable).toBe(false);
    expect(rep.dollarOffsetProspective.ratio!).toBeCloseTo(1, 2);
    expect(rep.dollarOffsetCumulative!.ratio!).toBeCloseTo(1, 2);
    expect(rep.regression.n).toBe(30);
    expect(rep.regression.points.some((p) => p.scenarioId.startsWith("fx-USD"))).toBe(true);
    expect(rep.regression.slope!).toBeCloseTo(1, 1);
    expect(rep.regression.r2!).toBeGreaterThan(0.99);
    expect(rep.effective).toBe(true);
    // Selling USD forward loses when USD appreciates
    expect(rep.ifrs9.hedgingInstrumentChange).toBeLessThan(0);
    expect(rep.ifrs9.oci).toBeLessThan(0);
    expect(rep.ifrs9.oci + rep.ifrs9.pnl).toBeCloseTo(rep.ifrs9.hedgingInstrumentChange, 8);
  });
  it("hedge ratio 0.5: 5m swap on a 10m loan is effective", () => {
    const { swap, rel } = loanHedge(5_000_000, 0.5);
    const rep = hedgeEffectivenessReport(applyScenario(ctx, parallel(25)), rel, swap, { designationCtx: ctx });
    expect(rep.hedgeRatio).toBe(0.5);
    expect((rep.hypotheticalDerivative.trade as InterestRateSwap).legs[0]!.notional).toBe(5_000_000);
    expect(rep.criticalTerms.matches).toBe(true);
    expect(rep.dollarOffsetCumulative!.ratio!).toBeCloseTo(1, 1);
    expect(rep.effective).toBe(true);
    expect(rep.warnings.some((w) => w.includes("Hedge Ratio"))).toBe(false);
    expect(rep.summary.some((s) => s.includes("gesicherter Anteil 50,0 %"))).toBe(true);
    // Same 5m swap designated against the full loan at ratio 1 is not effective
    const wrong = hedgeEffectivenessReport(applyScenario(ctx, parallel(25)), { ...rel, hedgeRatio: 1 }, swap, { designationCtx: ctx });
    expect(wrong.effective).toBe(false);
    expect(wrong.dollarOffsetCumulative!.ratio!).toBeCloseTo(0.5, 1);
  });
  it("HGB: amounts are internally consistent; under-hedge with rising rates → Drohverlustrückstellung", () => {
    const { swap, rel } = loanHedge(9_000_000, 1, "DollarOffset", "HGB");
    const rep = hedgeEffectivenessReport(applyScenario(ctx, parallel(50)), rel, swap, { designationCtx: ctx });
    const h = rep.hgb;
    expect(h.assessable).toBe(true);
    const dH = h.hedgingInstrumentChange;
    const dItem = h.hedgedItemChange;
    expect(dH).toBeGreaterThan(0); // payer swap gains
    expect(dItem).toBeLessThan(0); // hedged floating loan loses (higher interest)
    expect(h.ineffectiveExcess).toBeCloseTo(dH + dItem, 8);
    expect(h.ineffectiveExcess).toBeLessThan(0); // 9m hedge on 10m exposure
    expect(h.drohverlustrueckstellung).toBeCloseTo(-h.ineffectiveExcess, 8);
    expect(h.unrecognisedGain).toBe(0);
    expect(h.effectiveNetted).toBeCloseTo(dH, 8); // the whole hedge gain is offset
    expect(h.effectiveNetted + (dH - h.effectiveNetted)).toBeCloseTo(dH, 8);
    expect(h.einfrierungsmethode.frozenHedgingInstrument + h.einfrierungsmethode.frozenHedgedItem).toBeCloseTo(0, 8);
    expect(h.durchbuchungsmethode.hedgingInstrumentBooked + h.durchbuchungsmethode.hedgedItemBooked).toBeCloseTo(0, 8);
    expect(h.durchbuchungsmethode.netPnl).toBeCloseTo(h.einfrierungsmethode.recognisedPnl, 8);
    expect(h.einfrierungsmethode.recognisedPnl).toBeCloseTo(-h.drohverlustrueckstellung, 8);
    expect(rep.summary.some((s) => s.includes("HGB § 254") && s.includes("Drohverlustrückstellung"))).toBe(true);
    expect(rep.summary.some((s) => s.startsWith("Einfrierungsmethode"))).toBe(true);
    expect(rep.summary.some((s) => s.startsWith("Durchbuchungsmethode"))).toBe(true);
    // Dollar offset 0.9 is still inside 80–125 %
    expect(rep.dollarOffsetCumulative!.ratio!).toBeCloseTo(0.9, 1);
    expect(rep.effective).toBe(true);
    // Falling rates: the unhedged 10 % of the exposure gains → excess positive, no provision
    const down = hedgeEffectivenessReport(applyScenario(ctx, parallel(-50)), rel, swap, { designationCtx: ctx }).hgb;
    expect(down.ineffectiveExcess).toBeGreaterThan(0);
    expect(down.drohverlustrueckstellung).toBe(0);
    expect(down.unrecognisedGain).toBeCloseTo(down.ineffectiveExcess, 8);
  });
  it("pure split helpers: IFRS 9 lower-of asymmetry and HGB imparity", () => {
    // Over-hedge: instrument moved 120, hedged item 100
    const cfh = ifrs9Split("CashFlowHedge", 120, 100);
    expect(cfh.oci).toBe(100);
    expect(cfh.pnl).toBe(20);
    // Under-hedge: no ineffectiveness in P&L for a cash flow hedge
    const under = ifrs9Split("CashFlowHedge", 80, 100);
    expect(under.oci).toBe(80);
    expect(under.pnl).toBe(0);
    // Fair value hedge books both gross
    const fvh = ifrs9Split("FairValueHedge", 80, 100);
    expect(fvh.oci).toBe(0);
    expect(fvh.pnlComponents).toEqual({ hedgingInstrument: 80, hedgedItemAdjustment: -100 });
    expect(fvh.pnl).toBe(-20);
    // Opposite signs → nothing offsets
    expect(ifrs9Split("CashFlowHedge", 50, -40).oci).toBe(0);
    const hgb = hgbSplit(80, 100);
    expect(hgb.effectiveNetted).toBe(80);
    expect(hgb.ineffectiveExcess).toBe(-20);
    expect(hgb.drohverlustrueckstellung).toBe(20);
    const gain = hgbSplit(120, 100);
    expect(gain.drohverlustrueckstellung).toBe(0);
    expect(gain.unrecognisedGain).toBe(20);
    const na = hgbSplit(120, 100, false);
    expect(na.assessable).toBe(false);
    expect(na.ineffectiveExcess).toBe(0);
  });
  it("without designation market: prospective + regression only, accounting split not assessable, warning issued", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const rep = hedgeEffectivenessReport(ctx, rel, swap);
    expect(rep.dollarOffsetCumulative).toBeUndefined();
    expect(rep.dollarOffsetProspective.effective).toBe(true);
    expect(rep.regression.effective).toBe(true);
    expect(rep.effective).toBe(true);
    expect(rep.ifrs9.assessable).toBe(false);
    expect(rep.hgb.assessable).toBe(false);
    expect(rep.ifrs9.oci).toBe(0);
    expect(rep.warnings.some((w) => w.includes("Designationszeitpunkt"))).toBe(true);
    expect(rep.summary.some((s) => s.includes("nicht ermittelbar"))).toBe(true);
    // Hypothetical built at current par → PV ≈ 0
    expect(Math.abs(rep.hypotheticalDerivative.pv)).toBeLessThan(0.01);
  });
  it("fair value hedge of a fixed-rate loan with a receiver swap", () => {
    const receiver = makeVanillaSwap({
      id: "IRS-R",
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.031,
      effectiveDate: spot,
      maturity,
    });
    const rel: HedgeRelationship = {
      id: "HR-FV",
      name: "Fair-Value-Hedge Festzinsdarlehen",
      type: "FairValueHedge",
      hedgedItem: {
        description: "Festzinsdarlehen 3,1 %",
        currency: "EUR",
        notional: 1e7,
        kind: "FixedRateLoan",
        fixedRate: 0.031,
        effectiveDate: spot,
        maturityDate: maturity,
      },
      hedgingInstrumentId: "IRS-R",
      designationDate: VAL,
      method: "Regression",
      accountingFramework: "IFRS9",
    };
    const rep = hedgeEffectivenessReport(applyScenario(ctx, parallel(75)), rel, receiver, { designationCtx: ctx });
    expect(rep.effective).toBe(true);
    expect(rep.dollarOffsetCumulative!.ratio!).toBeCloseTo(1, 3);
    expect(rep.ifrs9.oci).toBe(0);
    expect(rep.ifrs9.hedgingInstrumentChange).toBeLessThan(0); // receiver loses when rates rise
    expect(rep.ifrs9.pnlComponents.hedgedItemAdjustment).toBeGreaterThan(0); // fixed liability worth less
    expect(rep.ifrs9.pnl).toBeCloseTo(rep.ifrs9.pnlComponents.hedgingInstrument + rep.ifrs9.pnlComponents.hedgedItemAdjustment, 8);
    expect(rep.summary.some((s) => s.includes("Fair-Value-Hedge") && s.includes("Buchwertanpassung"))).toBe(true);
  });
  it("id mismatch and designation-date inconsistency produce warnings; period offset uses previousCtx", () => {
    const { swap, rel } = loanHedge(10_000_000);
    const designation = buildSampleMarket(parseISO("2026-06-01"));
    const prev = applyScenario(ctx, parallel(-20));
    const rep = hedgeEffectivenessReport(ctx, { ...rel, hedgingInstrumentId: "OTHER" }, swap, { designationCtx: designation, previousCtx: prev });
    expect(rep.warnings.some((w) => w.includes("Trade-ID"))).toBe(true);
    expect(rep.warnings.some((w) => w.includes("Designationsdatum"))).toBe(true);
    expect(rep.dollarOffsetPeriod).not.toBe(rep.dollarOffsetCumulative);
    expect(rep.dollarOffsetPeriod!.ratio!).toBeCloseTo(1, 1);
    expect(rep.summary.some((s) => s.includes("Dollar-Offset Periode"))).toBe(true);
    expect(rep.pricingWarnings).toBeInstanceOf(Array);
  });
});
