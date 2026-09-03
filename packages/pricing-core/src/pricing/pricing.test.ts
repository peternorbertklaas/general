import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapCurve } from "../curves/bootstrap.js";
import { flatCurve } from "../curves/curve.js";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { makeCapFloor, makeFxForward, makeFxOption, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type MarketContext } from "../market/market-context.js";
import { SAMPLE_QUOTES, buildSampleMarket } from "../market/sample-market.js";
import { priceTrade } from "./price.js";
import { priceInterestRateSwap } from "./swap-pricer.js";
import { computeRisk } from "../risk/sensitivities.js";
import { STANDARD_SCENARIOS, applyScenario, runScenarios, scenarioGrid } from "../risk/scenarios.js";
import { computeXva } from "../xva/cva.js";
import { buildValuationReport, cashflowTable } from "../reporting/valuation-report.js";
import { type CrossCurrencySwap, type FxSwap, type ForwardRateAgreement } from "../instruments/types.js";

const VAL = parseISO("2026-09-03");
let ctx: MarketContext;

beforeAll(() => {
  ctx = buildSampleMarket(VAL);
});

describe("bootstrap", () => {
  it("reprices all OIS quotes to zero", () => {
    const res = bootstrapCurve(VAL, { id: "EUR-ESTR", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    // Discount factors decreasing
    const dfs = res.curve.nodeDates.map((d) => res.curve.df(d));
    for (let i = 1; i < dfs.length; i++) expect(dfs[i]!).toBeLessThan(dfs[i - 1]!);
  });
  it("dual-curve EURIBOR-6M reprices par swaps", () => {
    const ois = ctx.curves["EUR-ESTR"]!;
    const cal = getCalendar("TARGET");
    const spot = advance(VAL, "2D", cal);
    for (const q of SAMPLE_QUOTES.eur6m) {
      if (q.type !== "Swap") continue;
      const swap = makeVanillaSwap({
        currency: "EUR",
        notional: 10_000_000,
        payReceiveFixed: "Receive",
        fixedRate: q.rate,
        effectiveDate: spot,
        maturity: q.tenor,
      });
      const res = priceInterestRateSwap(ctx, swap, "EUR");
      expect(Math.abs(res.pv)).toBeLessThan(1); // < 1 EUR on 10m notional
      expect(res.analytics.parRate).toBeCloseTo(q.rate, 9);
    }
    void ois;
  });
  it("deposit and FRA forwards are reproduced", () => {
    const c = ctx.curves["EUR-EURIBOR-6M"]!;
    const cal = getCalendar("TARGET");
    const spot = advance(VAL, "2D", cal);
    const d6 = advance(spot, "6M", cal, "ModifiedFollowing", true);
    expect(c.forwardRate(spot, d6, "ACT/360")).toBeCloseTo(0.0221, 10);
    const s6 = advance(spot, "6M", cal, "ModifiedFollowing", true);
    const e12 = advance(spot, "12M", cal, "ModifiedFollowing", true);
    expect(c.forwardRate(s6, e12, "ACT/360")).toBeCloseTo(0.0226, 10);
  });
});

describe("interest rate swap", () => {
  it("par swap has ~zero PV and correct par rate; DV01 sign for payer", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const s0 = makeVanillaSwap({ currency: "EUR", notional: 10_000_000, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "10Y" });
    const r0 = priceInterestRateSwap(ctx, s0, "EUR");
    const par = r0.analytics.parRate as number;
    expect(par).toBeCloseTo(0.0288, 3);
    const s1 = makeVanillaSwap({ currency: "EUR", notional: 10_000_000, payReceiveFixed: "Pay", fixedRate: par, effectiveDate: spot, maturity: "10Y" });
    const r1 = priceInterestRateSwap(ctx, s1, "EUR");
    expect(Math.abs(r1.pv)).toBeLessThan(0.01);
    // payer swap gains when rates rise
    const risk = computeRisk(ctx, s1, "EUR", { bucketed: true, vega: false, theta: false });
    expect(risk.dv01).toBeGreaterThan(0);
    // 10y DV01 on 10m roughly 8-9k per bp
    expect(risk.dv01).toBeGreaterThan(7000);
    expect(risk.dv01).toBeLessThan(10000);
    // bucketed sums ≈ parallel
    const sum = risk.bucketed.reduce((s, b) => s + b.total, 0);
    expect(sum).toBeCloseTo(risk.dv01, -1);
  });
  it("builder uses unadjusted maturity (no artificial 1-day stub) and theta reflects carry", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET")); // 2026-09-07 (Mon)
    const s = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.031, effectiveDate: spot, maturity: "10Y" });
    const r = priceInterestRateSwap(ctx, s, "EUR");
    const fixedCfs = r.legs[0]!.cashflows;
    expect(fixedCfs).toHaveLength(10);
    expect(fixedCfs[0]!.accrualFactor!).toBeGreaterThan(0.99); // full first year, no stub
    const risk = computeRisk(ctx, s, "EUR", { bucketed: false, vega: false, theta: true });
    // Paying 3.10% vs receiving ~2.9% plus roll-down on an upward-sloping curve → negative daily theta,
    // of the order of a few hundred EUR on 10m notional.
    expect(risk.theta).toBeLessThan(0);
    expect(Math.abs(risk.theta)).toBeLessThan(1000);
  });
  it("pay vs receive are mirror images", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const a = makeVanillaSwap({ currency: "EUR", notional: 5_000_000, payReceiveFixed: "Pay", fixedRate: 0.02, effectiveDate: spot, maturity: "5Y" });
    const b = makeVanillaSwap({ currency: "EUR", notional: 5_000_000, payReceiveFixed: "Receive", fixedRate: 0.02, effectiveDate: spot, maturity: "5Y" });
    expect(priceInterestRateSwap(ctx, a, "EUR").pv).toBeCloseTo(-priceInterestRateSwap(ctx, b, "EUR").pv, 8);
  });
  it("seasoned swap uses fixings and reports accrued", () => {
    const start = parseISO("2024-03-15");
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1_000_000, payReceiveFixed: "Receive", fixedRate: 0.03, effectiveDate: start, maturity: "5Y" });
    const withFix: MarketContext = {
      ...ctx,
      fixings: [{ index: "EURIBOR-6M", date: parseISO("2026-03-12"), value: 0.0215 }],
    };
    const res = priceInterestRateSwap(withFix, swap, "EUR");
    const currentFloat = res.legs[1]!.cashflows.find((c) => c.accrualStart! <= VAL && c.accrualEnd! > VAL);
    expect(currentFloat?.isFixed).toBe(true);
    expect(currentFloat?.rate).toBeCloseTo(0.0215, 12);
    expect(res.accrued).not.toBe(0);
    // Without fixing → warning
    const res2 = priceInterestRateSwap(ctx, swap, "EUR");
    expect(res2.warnings.some((w) => w.includes("Missing fixing"))).toBe(true);
  });
  it("OIS swap on flat curve has par ≈ compounded rate", () => {
    const flat = flatCurve("EUR-ESTR", "EUR", VAL, 0.02);
    const c2: MarketContext = { ...ctx, curves: { ...ctx.curves, "EUR-ESTR": flat } };
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const ois = makeVanillaSwap({
      currency: "EUR",
      notional: 1e6,
      payReceiveFixed: "Pay",
      fixedRate: 0.02,
      effectiveDate: spot,
      maturity: "3Y",
      index: "ESTR",
    });
    const res = priceInterestRateSwap(c2, ois, "EUR");
    // Annual compounded ACT/360 rate equivalent to 2% continuous (ACT/365F): (e^0.02 - 1) / (365/360)
    expect(res.analytics.parRate as number).toBeCloseTo(((Math.exp(0.02) - 1) * 360) / 365, 4);
  });
});

describe("FRA", () => {
  it("FRA at forward rate has zero PV", () => {
    const cal = getCalendar("TARGET");
    const spot = advance(VAL, "2D", cal);
    const start = advance(spot, "6M", cal, "ModifiedFollowing", true);
    const end = advance(spot, "12M", cal, "ModifiedFollowing", true);
    const fra: ForwardRateAgreement = {
      id: "fra",
      type: "FRA",
      payReceive: "Pay",
      notional: 1e7,
      currency: "EUR",
      index: "EURIBOR-6M",
      startDate: start,
      endDate: end,
      fixedRate: 0.0226,
    };
    const res = priceTrade(ctx, fra, "EUR");
    expect(Math.abs(res.pv)).toBeLessThan(0.01);
    const fra2 = { ...fra, fixedRate: 0.02 };
    expect(priceTrade(ctx, fra2, "EUR").pv).toBeGreaterThan(0); // pay 2% receive 2.26%
  });
});

describe("cap / floor / collar", () => {
  it("cap - floor = swap (put-call parity at strike)", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const K = 0.025;
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: K, effectiveDate: spot, maturity: "5Y" });
    const floor = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Floor", strike: K, effectiveDate: spot, maturity: "5Y" });
    const pvCap = priceTrade(ctx, cap, "EUR").pv;
    const pvFloor = priceTrade(ctx, floor, "EUR").pv;
    // Equivalent swap: receive float (6M) pay fixed K with the same schedule (semi-annual fixed, ACT/360)
    const swap = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: K,
      effectiveDate: spot,
      maturity: "5Y",
      fixedFrequency: "6M",
    });
    swap.legs[0]!.dayCount = "ACT/360";
    const pvSwap = priceInterestRateSwap(ctx, swap, "EUR").pv;
    expect(pvCap - pvFloor).toBeCloseTo(pvSwap, 0);
    expect(pvCap).toBeGreaterThan(0);
    expect(pvFloor).toBeGreaterThan(0);
  });
  it("collar = cap - floor", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const collar = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Collar", strike: 0.035, floorStrike: 0.015, effectiveDate: spot, maturity: "5Y" });
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.035, effectiveDate: spot, maturity: "5Y" });
    const floor = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Floor", strike: 0.015, effectiveDate: spot, maturity: "5Y" });
    expect(priceTrade(ctx, collar, "EUR").pv).toBeCloseTo(priceTrade(ctx, cap, "EUR").pv - priceTrade(ctx, floor, "EUR").pv, 6);
  });
  it("higher strike cap is cheaper; vega positive", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const a = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.02, effectiveDate: spot, maturity: "5Y" });
    const b = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.04, effectiveDate: spot, maturity: "5Y" });
    expect(priceTrade(ctx, a, "EUR").pv).toBeGreaterThan(priceTrade(ctx, b, "EUR").pv);
    const risk = computeRisk(ctx, a, "EUR", { bucketed: false });
    expect(Object.values(risk.vega)[0]!).toBeGreaterThan(0);
  });
});

describe("swaption", () => {
  it("payer - receiver = forward swap value", () => {
    const K = 0.03;
    const payer = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: K, expiry: "2Y", tenor: "5Y", valuationDate: VAL });
    const receiver = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Receiver", strike: K, expiry: "2Y", tenor: "5Y", valuationDate: VAL });
    const rp = priceTrade(ctx, payer, "EUR");
    const rr = priceTrade(ctx, receiver, "EUR");
    // Underlying forward swap (pay fixed) PV
    const fwdSwapPv = rp.analytics.underlyingPv as number;
    expect(rp.pv - rr.pv).toBeCloseTo(fwdSwapPv, 2);
    expect(rp.pv).toBeGreaterThan(0);
    expect(rp.analytics.volatility as number).toBeGreaterThan(0.005);
    expect(rp.analytics.volatility as number).toBeLessThan(0.01);
  });
  it("1Yx5Y payer swaption (SABR grid point) has positive value and sane vol", () => {
    const sw = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate: VAL });
    const r = priceTrade(ctx, sw, "EUR");
    expect(r.pv).toBeGreaterThan(20_000);
    expect(r.analytics.volatility as number).toBeGreaterThan(0.005);
    expect(r.analytics.volatility as number).toBeLessThan(0.012);
  });
  it("ATM straddle ≈ annuity × 2 × σ√T/√(2π)", () => {
    const probe = makeSwaption({
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      strike: 0.03,
      expiry: "1Y",
      tenor: "10Y",
      valuationDate: VAL,
      settlement: "Physical",
    });
    const fwd = priceTrade(ctx, probe, "EUR").analytics.forwardSwapRate as number;
    const atm = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: fwd, expiry: "1Y", tenor: "10Y", valuationDate: VAL });
    const r = priceTrade(ctx, atm, "EUR");
    const vol = r.analytics.volatility as number;
    const T = r.analytics.expiryYears as number;
    const annuity = r.analytics.annuity as number;
    expect(r.pv).toBeCloseTo((annuity * vol * Math.sqrt(T)) / Math.sqrt(2 * Math.PI), 0);
  });
  it("cash settlement: CCP convention equals physical, legacy IRR differs slightly", () => {
    const phys = makeSwaption({
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Receiver",
      strike: 0.03,
      expiry: "5Y",
      tenor: "10Y",
      valuationDate: VAL,
      settlement: "Physical",
    });
    const ccp = { ...phys, settlement: "Cash" as const };
    const irr = { ...phys, settlement: "Cash" as const, cashSettlementConvention: "IRR" as const };
    const a = priceTrade(ctx, phys, "EUR").pv;
    const b = priceTrade(ctx, ccp, "EUR").pv;
    const c = priceTrade(ctx, irr, "EUR").pv;
    expect(b).toBeCloseTo(a, 6);
    expect(Math.abs(a - c) / a).toBeLessThan(0.05);
    expect(a).not.toBeCloseTo(c, 6);
  });
});

describe("FX", () => {
  it("forward at fair rate has zero PV; interest parity", () => {
    const del = parseISO("2027-09-07");
    const probe = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.2, deliveryDate: del });
    const fair = priceTrade(ctx, probe, "USD").analytics.fairForward as number;
    // USD rates > EUR rates → EURUSD forward above spot
    expect(fair).toBeGreaterThan(1.1625);
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: fair, deliveryDate: del });
    expect(Math.abs(priceTrade(ctx, fwd, "USD").pv)).toBeLessThan(1e-6);
    // Buying EUR below fair → positive value
    const cheap = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: fair - 0.01, deliveryDate: del });
    expect(priceTrade(ctx, cheap, "USD").pv).toBeGreaterThan(0);
    // Reporting in EUR consistent: PVs (discounted to today) convert at the spot rate adjusted to the
    // valuation date (spot settles T+2), not at the raw spot – review finding H5.
    const inUsd = priceTrade(ctx, cheap, "USD");
    const inEur = priceTrade(ctx, cheap, "EUR").pv;
    const todayRate = inUsd.analytics.spotAtValuationDate as number;
    expect(inEur * todayRate).toBeCloseTo(inUsd.pv, 6);
    // the difference to a spot conversion is the 2-day rate differential (~1e-4 relative), not zero
    expect(Math.abs(inEur * 1.1625 - inUsd.pv) / Math.abs(inUsd.pv)).toBeLessThan(5e-4);
    expect(todayRate).not.toBe(1.1625);
  });
  it("FX swap PV equals sum of legs", () => {
    const near = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.1625, deliveryDate: parseISO("2026-09-07") });
    const far = makeFxForward({ pair: "EURUSD", baseAmount: -1e6, rate: 1.175, deliveryDate: parseISO("2027-09-07") });
    const swap: FxSwap = { id: "fxs", type: "FxSwap", nearLeg: near, farLeg: far };
    const res = priceTrade(ctx, swap, "USD");
    expect(res.pv).toBeCloseTo(priceTrade(ctx, near, "USD").pv + priceTrade(ctx, far, "USD").pv, 8);
    expect(res.analytics.swapPoints as number).toBeGreaterThan(0);
  });
  it("FX option: put-call parity vs forward and positive vega", () => {
    const exp = parseISO("2027-09-03");
    const call = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: exp });
    const put = makeFxOption({ pair: "EURUSD", optionType: "Put", notional: 1e6, strike: 1.18, expiryDate: exp });
    const rc = priceTrade(ctx, call, "USD");
    const rp = priceTrade(ctx, put, "USD");
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.18, deliveryDate: call.deliveryDate });
    // Same vol by parity only if smile vol is the same for the strike – it is (same strike).
    expect(rc.pv - rp.pv).toBeCloseTo(priceTrade(ctx, fwd, "USD").pv, 1);
    expect(rc.analytics.vega as number).toBeGreaterThan(0);
    const risk = computeRisk(ctx, call, "USD", { bucketed: false });
    expect(risk.vega["fx:EURUSD"]).toBeGreaterThan(0);
    expect(risk.fxDelta["EURUSD"]).toBeGreaterThan(0);
  });
  it("barrier option is cheaper than vanilla", () => {
    const exp = parseISO("2027-03-03");
    const v = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.17, expiryDate: exp });
    const b = { ...v, barrier: { type: "UpOut" as const, level: 1.25 } };
    expect(priceTrade(ctx, b, "USD").pv).toBeLessThan(priceTrade(ctx, v, "USD").pv);
    expect(priceTrade(ctx, b, "USD").pv).toBeGreaterThan(0);
  });
});

describe("cross currency swap", () => {
  it("constant notional CCS prices and MtM-reset changes value modestly", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET+US"));
    const mat = advance(spot, "5Y", getCalendar("TARGET+US"));
    const ccs: CrossCurrencySwap = {
      id: "ccs",
      type: "CrossCurrencySwap",
      legs: [
        {
          type: "Float",
          payReceive: "Receive",
          notional: 1e7,
          currency: "EUR",
          effectiveDate: spot,
          terminationDate: mat,
          frequency: "3M",
          dayCount: "ACT/360",
          calendar: "TARGET+US",
          index: "EURIBOR-3M",
          spread: -0.0015,
        },
        {
          type: "Float",
          payReceive: "Pay",
          notional: 1e7 * 1.1625,
          currency: "USD",
          effectiveDate: spot,
          terminationDate: mat,
          frequency: "3M",
          dayCount: "ACT/360",
          calendar: "TARGET+US",
          index: "SOFR",
        },
      ],
    };
    const r = priceTrade(ctx, ccs, "EUR");
    expect(Number.isFinite(r.pv)).toBe(true);
    // notional exchanges present
    expect(r.legs[0]!.cashflows.filter((c) => c.kind === "Notional")).toHaveLength(2);
    const mtm = { ...ccs, mtmReset: { resettingLegIndex: 1 } };
    const r2 = priceTrade(ctx, mtm, "EUR");
    expect(Number.isFinite(r2.pv)).toBe(true);
    expect(Math.abs(r2.pv - r.pv)).toBeLessThan(0.02 * 1e7);
  });
});

describe("scenarios & XVA & report", () => {
  it("standard scenarios run and +100bp hurts a receiver swap", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const recv = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Receive", fixedRate: 0.03, effectiveDate: spot, maturity: "7Y" });
    const out = runScenarios(ctx, [recv], STANDARD_SCENARIOS, "EUR");
    const up = out.results.find((r) => r.scenario.id === "par+100")!;
    const dn = out.results.find((r) => r.scenario.id === "par-100")!;
    expect(up.pnl).toBeLessThan(0);
    expect(dn.pnl).toBeGreaterThan(0);
    const grid = scenarioGrid(ctx, [recv], "EUR", [-100, 0, 100], [-5, 0, 5], "USD");
    expect(grid.pv[1]![1]).toBeCloseTo(grid.base, 6);
    const steep = applyScenario(
      ctx,
      STANDARD_SCENARIOS.find((s) => s.id === "steep")!,
    );
    expect(steep.curves["EUR-ESTR"]!.zeroRate(VAL + 365 * 30)).toBeGreaterThan(ctx.curves["EUR-ESTR"]!.zeroRate(VAL + 365 * 30));
  });
  it("CVA is positive and bounded for a swap and an FX forward", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.0288, effectiveDate: spot, maturity: "10Y" });
    const x = computeXva(ctx, swap, { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 }, "EUR");
    expect(x.cva).toBeGreaterThan(0);
    expect(x.dva).toBeGreaterThan(0);
    expect(x.cva).toBeLessThan(1e7 * 0.02); // < 2% of notional
    expect(x.profile.length).toBeGreaterThan(5);
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.17, deliveryDate: parseISO("2027-09-07") });
    const xf = computeXva(ctx, fwd, { cptyHazard: 0.02, cptyRecovery: 0.4 }, "USD");
    expect(xf.cva).toBeGreaterThan(0);
  });
  it("valuation report includes cost transparency and cashflow table", () => {
    const spot = advance(VAL, "2D", getCalendar("TARGET"));
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.031, effectiveDate: spot, maturity: "10Y" });
    const pr = priceTrade(ctx, swap, "EUR");
    // The swap is booked from the client's side (client pays 3.1% while par is 2.88%) → negative initial market value for the client
    const rep = buildValuationReport(ctx, swap, pr, { transactionPrice: 0, perspective: "Kunde" });
    expect(rep.costTransparency).toBeDefined();
    expect(rep.costTransparency!.perspective).toBe("Kunde");
    expect(rep.costTransparency!.initialMarketValue).toBeLessThan(0);
    expect(rep.costTransparency!.bankMargin).toBeCloseTo(-rep.costTransparency!.initialMarketValue, 8);
    expect(rep.costTransparency!.marginBp).toBeGreaterThan(0);
    // Default perspective is the bank's: the same pv is then the bank's (negative) value → bank margin negative
    const bank = buildValuationReport(ctx, swap, pr, { transactionPrice: 0 });
    expect(bank.costTransparency!.perspective).toBe("Bank");
    expect(bank.costTransparency!.bankMargin).toBeCloseTo(pr.pv, 8);
    expect(bank.costTransparency!.initialMarketValue).toBeCloseTo(-pr.pv, 8);
    expect(bank.methodology.some((m) => m.startsWith("Kostentransparenz") && m.includes("Perspektive Bank"))).toBe(true);
    expect(rep.fairValue.ifrs13Level).toBe(2);
    const table = cashflowTable(pr);
    expect(table.length).toBeGreaterThan(20);
    expect(toISO(VAL)).toBe(rep.valuationDate);
  });
});
