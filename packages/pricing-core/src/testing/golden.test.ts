import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CurveQuote, bootstrapCurve } from "../curves/bootstrap.js";
import { flatCurve } from "../curves/curve.js";
import { parseISO, toISO } from "../dates/date.js";
import { makeFxForward } from "../instruments/builders.js";
import { type CapFloor, type InterestRateSwap, type Swaption } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { SAMPLE_CURVE_IDS, SAMPLE_QUOTES, buildSampleMarket } from "../market/sample-market.js";
import { bachelierGreeks, black76 } from "../models/black.js";
import { garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { priceTrade } from "../pricing/price.js";

/**
 * Golden master: reference values derived independently of the engine (closed
 * forms, see test-data/golden/README.md and tools/quantlib-golden.py) must be
 * reproduced to 1e-6 relative tolerance.
 */
const REL_TOL = 1e-6;

function golden<T>(name: string): T {
  const path = fileURLToPath(new URL(`../../test-data/golden/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function expectRel(actual: number, expected: number, what: string, tol = REL_TOL): void {
  const scale = Math.max(1e-9, Math.abs(expected));
  const rel = Math.abs(actual - expected) / scale;
  if (!(rel <= tol)) throw new Error(`${what}: got ${actual}, expected ${expected} (rel. diff ${rel.toExponential(2)} > ${tol})`);
  expect(rel).toBeLessThanOrEqual(tol);
}

function flatCtx(valuationDate: number, curves: { id: string; ccy: string; rate: number }[], fxSpots: Record<string, number> = {}): MarketContext {
  const ctx: MarketContext = { valuationDate, curves: {}, discountCurveId: {}, fxSpots };
  for (const c of curves) {
    ctx.curves[c.id] = flatCurve(c.id, c.ccy, valuationDate, c.rate);
    ctx.discountCurveId[c.ccy] = c.id;
  }
  return ctx;
}

interface Cf {
  paymentDate: string;
  rate?: number;
  accrualFactor: number;
  amount: number;
  discountFactor: number;
  presentValue: number;
}

describe("golden master – flat-curve vanilla swap", () => {
  interface G {
    inputs: {
      valuationDate: string;
      curveId: string;
      flatZeroRate: number;
      notional: number;
      fixedRate: number;
      effectiveDate: string;
      terminationDate: string;
    };
    expected: {
      discountFactors: { date: string; df: number }[];
      parRate: number;
      annuity: number;
      pvFixed: number;
      pvFloat: number;
      pv: number;
      fixedCashflows: Cf[];
      floatCashflows: Cf[];
    };
    quantlib: { npv: number; fairRate: number; fixedLegNPV: number; floatingLegNPV: number };
  }
  const g = golden<G>("swap-flat-curve");
  const val = parseISO(g.inputs.valuationDate);
  const ctx = flatCtx(val, [{ id: g.inputs.curveId, ccy: "EUR", rate: g.inputs.flatZeroRate }]);
  const swap: InterestRateSwap = {
    id: "golden-swap",
    type: "InterestRateSwap",
    legs: [
      {
        type: "Fixed",
        payReceive: "Pay",
        notional: g.inputs.notional,
        currency: "EUR",
        effectiveDate: parseISO(g.inputs.effectiveDate),
        terminationDate: parseISO(g.inputs.terminationDate),
        frequency: "12M",
        dayCount: "30E/360",
        calendar: "NONE",
        businessDayConvention: "Unadjusted",
        rate: g.inputs.fixedRate,
      },
      {
        type: "Float",
        payReceive: "Receive",
        notional: g.inputs.notional,
        currency: "EUR",
        effectiveDate: parseISO(g.inputs.effectiveDate),
        terminationDate: parseISO(g.inputs.terminationDate),
        frequency: "12M",
        dayCount: "ACT/360",
        calendar: "NONE",
        businessDayConvention: "Unadjusted",
        index: "EURIBOR-12M",
        fixingLag: 0,
      },
    ],
  };
  it("discount factors, par rate, annuity and leg PVs", () => {
    const c = ctx.curves[g.inputs.curveId]!;
    for (const n of g.expected.discountFactors) expectRel(c.df(parseISO(n.date)), n.df, `DF ${n.date}`);
    const res = priceTrade(ctx, swap, "EUR");
    expect(res.warnings).toEqual([]);
    expectRel(res.analytics.parRate as number, g.expected.parRate, "par rate");
    expectRel(res.analytics.annuity as number, g.expected.annuity, "annuity");
    expectRel(res.legs[0]!.pv, g.expected.pvFixed, "fixed leg PV");
    expectRel(res.legs[1]!.pv, g.expected.pvFloat, "float leg PV");
    expectRel(res.pv, g.expected.pv, "PV");
  });
  it("cashflow table matches the closed form line by line", () => {
    const res = priceTrade(ctx, swap, "EUR");
    const check = (legIdx: number, expected: Cf[]) => {
      const cfs = res.legs[legIdx]!.cashflows;
      expect(cfs).toHaveLength(expected.length);
      cfs.forEach((cf, i) => {
        const e = expected[i]!;
        expect(toISO(cf.paymentDate)).toBe(e.paymentDate);
        expectRel(cf.accrualFactor!, e.accrualFactor, `leg ${legIdx} τ ${i}`);
        if (e.rate !== undefined) expectRel(cf.rate!, e.rate, `leg ${legIdx} rate ${i}`);
        expectRel(cf.amount, e.amount, `leg ${legIdx} amount ${i}`);
        expectRel(cf.discountFactor, e.discountFactor, `leg ${legIdx} DF ${i}`);
        expectRel(cf.presentValue, e.presentValue, `leg ${legIdx} PV ${i}`);
      });
    };
    check(0, g.expected.fixedCashflows);
    check(1, g.expected.floatCashflows);
  });
  it("QuantLib VanillaSwap cross-check (R4-4) agrees with the closed form and the engine to 1e-9", () => {
    const q = g.quantlib;
    expectRel(q.npv, g.expected.pv, "QuantLib NPV vs closed form", 1e-9);
    expectRel(q.fairRate, g.expected.parRate, "QuantLib fair rate vs closed form", 1e-12);
    expectRel(q.fixedLegNPV, g.expected.pvFixed, "QuantLib fixed leg", 1e-12);
    expectRel(q.floatingLegNPV, g.expected.pvFloat, "QuantLib float leg", 1e-12);
    const res = priceTrade(ctx, swap, "EUR");
    expectRel(res.pv, q.npv, "engine PV vs QuantLib", 1e-9);
    expectRel(res.analytics.parRate as number, q.fairRate, "engine par rate vs QuantLib", 1e-9);
  });
});

describe("golden master – €STR OIS compounding", () => {
  interface G {
    inputs: {
      valuationDate: string;
      curveId: string;
      flatZeroRate: number;
      notional: number;
      fixedRate: number;
      effectiveDate: string;
      terminationDate: string;
    };
    expected: { parRate: number; annuity: number; compoundedRates: number[]; floatAmounts: number[]; pvFloat: number; pvFixed: number; pv: number };
  }
  const g = golden<G>("ois-flat-curve");
  it("compounded coupons telescope to DF ratios; par rate and PV match", () => {
    const val = parseISO(g.inputs.valuationDate);
    const ctx = flatCtx(val, [{ id: g.inputs.curveId, ccy: "EUR", rate: g.inputs.flatZeroRate }]);
    const common = {
      notional: g.inputs.notional,
      currency: "EUR",
      effectiveDate: parseISO(g.inputs.effectiveDate),
      terminationDate: parseISO(g.inputs.terminationDate),
      frequency: "12M",
      dayCount: "ACT/360" as const,
      calendar: "NONE",
      businessDayConvention: "Unadjusted" as const,
      paymentLag: 0,
    };
    const ois: InterestRateSwap = {
      id: "golden-ois",
      type: "InterestRateSwap",
      legs: [
        { type: "Fixed", payReceive: "Pay", ...common, rate: g.inputs.fixedRate },
        { type: "Float", payReceive: "Receive", ...common, index: "ESTR" },
      ],
    };
    const res = priceTrade(ctx, ois, "EUR");
    expect(res.warnings).toEqual([]);
    expectRel(res.analytics.parRate as number, g.expected.parRate, "par rate");
    expectRel(res.analytics.annuity as number, g.expected.annuity, "annuity");
    const flt = res.legs[1]!.cashflows;
    expect(flt).toHaveLength(g.expected.compoundedRates.length);
    flt.forEach((cf, i) => {
      expectRel(cf.rate!, g.expected.compoundedRates[i]!, `compounded rate ${i}`);
      expectRel(cf.amount, g.expected.floatAmounts[i]!, `float amount ${i}`);
    });
    expectRel(res.legs[1]!.pv, g.expected.pvFloat, "float PV");
    expectRel(res.legs[0]!.pv, g.expected.pvFixed, "fixed PV");
    expectRel(res.pv, g.expected.pv, "PV");
  });
});

describe("golden master – Black-76 / Bachelier closed forms", () => {
  interface G {
    inputs: {
      black76: { forward: number; strike: number; vol: number; timeToExpiry: number; notional: number; accrualFactor: number; zeroRate15M: number };
      bachelier: { forward: number; strike: number; normalVol: number; timeToExpiry: number; annuity: number };
    };
    expected: {
      black76: { undiscountedCall: number; capletValue: number; put: number };
      bachelier: { atmPayer: number; atmClosedForm: number; delta: number; vega: number };
    };
    quantlib: { black76Call: number; bachelierAtm: number };
  }
  const g = golden<G>("black76-bachelier");
  it("QuantLib blackFormula / bachelierBlackFormula cross-check (R4-4) agrees to 1e-13", () => {
    expectRel(g.quantlib.black76Call, g.expected.black76.undiscountedCall, "QuantLib Black-76", 1e-13);
    expectRel(g.quantlib.bachelierAtm, g.expected.bachelier.atmPayer, "QuantLib Bachelier", 1e-13);
    const b = g.inputs.black76;
    expectRel(black76("Call", b.forward, b.strike, b.vol, b.timeToExpiry), g.quantlib.black76Call, "engine vs QuantLib Black-76", 1e-13);
  });
  it("Hull caplet and ATM Bachelier swaption", () => {
    const b = g.inputs.black76;
    const call = black76("Call", b.forward, b.strike, b.vol, b.timeToExpiry);
    expectRel(call, g.expected.black76.undiscountedCall, "Black-76 call");
    expectRel(black76("Put", b.forward, b.strike, b.vol, b.timeToExpiry), g.expected.black76.put, "Black-76 put");
    expectRel(b.notional * b.accrualFactor * Math.exp(-b.zeroRate15M * 1.25) * call, g.expected.black76.capletValue, "Hull caplet");
    const n = g.inputs.bachelier;
    const gr = bachelierGreeks("Call", n.forward, n.strike, n.normalVol, n.timeToExpiry);
    expectRel(n.annuity * gr.price, g.expected.bachelier.atmPayer, "Bachelier ATM payer");
    expectRel(n.annuity * gr.price, g.expected.bachelier.atmClosedForm, "Bachelier ATM closed form");
    expectRel(gr.delta, g.expected.bachelier.delta, "Bachelier ATM delta");
    expectRel(n.annuity * gr.vega, g.expected.bachelier.vega, "Bachelier vega");
  });
});

describe("golden master – Garman-Kohlhagen", () => {
  interface G {
    inputs: { spot: number; strike: number; timeToExpiry: number; rd: number; rf: number; vol: number; timeToDeliveryLag: number };
    expected: { forward: number; call: number; put: number; parity: number; withDeliveryLag: { forward: number; call: number; put: number } };
  }
  const g = golden<G>("garman-kohlhagen");
  it("vanilla call/put with and without delivery lag", () => {
    const i = g.inputs;
    const base = { spot: i.spot, strike: i.strike, vol: i.vol, timeToExpiry: i.timeToExpiry, rd: i.rd, rf: i.rf };
    const c = garmanKohlhagen({ ...base, type: "Call" });
    const p = garmanKohlhagen({ ...base, type: "Put" });
    expectRel(c.forward, g.expected.forward, "forward");
    expectRel(c.premiumDomestic, g.expected.call, "call");
    expectRel(p.premiumDomestic, g.expected.put, "put");
    expectRel(c.premiumDomestic - p.premiumDomestic, g.expected.parity, "parity");
    const cl = garmanKohlhagen({ ...base, type: "Call", timeToDelivery: i.timeToDeliveryLag });
    const pl = garmanKohlhagen({ ...base, type: "Put", timeToDelivery: i.timeToDeliveryLag });
    expectRel(cl.forward, g.expected.withDeliveryLag.forward, "forward (lag)");
    expectRel(cl.premiumDomestic, g.expected.withDeliveryLag.call, "call (lag)");
    expectRel(pl.premiumDomestic, g.expected.withDeliveryLag.put, "put (lag)");
  });
});

describe("golden master – FX forward with spot-date anchor", () => {
  interface G {
    inputs: { valuationDate: string; spot: number; rEur: number; rUsd: number; eurAmount: number; contractRate: number; deliveryDate: string };
    expected: { spotDate: string; fairForward: number; spotAtValuationDate: number; pvUsd: number; pvEur: number };
  }
  const g = golden<G>("fx-forward-spot-date");
  it("fair forward, today rate and PVs in both currencies", () => {
    const val = parseISO(g.inputs.valuationDate);
    const ctx = flatCtx(
      val,
      [
        { id: "EUR-ESTR", ccy: "EUR", rate: g.inputs.rEur },
        { id: "USD-SOFR", ccy: "USD", rate: g.inputs.rUsd },
      ],
      { EURUSD: g.inputs.spot },
    );
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: g.inputs.eurAmount, rate: g.inputs.contractRate, deliveryDate: parseISO(g.inputs.deliveryDate) });
    const usd = priceTrade(ctx, fwd, "USD");
    expect(usd.details?.spotDate).toBe(g.expected.spotDate);
    expectRel(usd.analytics.fairForward as number, g.expected.fairForward, "fair forward");
    expectRel(usd.analytics.spotAtValuationDate as number, g.expected.spotAtValuationDate, "today rate");
    expectRel(usd.pv, g.expected.pvUsd, "PV USD");
    expectRel(priceTrade(ctx, fwd, "EUR").pv, g.expected.pvEur, "PV EUR");
  });
});

describe("golden master – ATM payer swaption on the flat curve", () => {
  interface G {
    inputs: {
      valuationDate: string;
      curveId: string;
      flatZeroRate: number;
      notional: number;
      expiryDate: string;
      swapStart: string;
      swapEnd: string;
      strike: number;
      normalVol: number;
    };
    expected: { forwardSwapRate: number; annuity: number; physical: number; cashCollateralisedCashPrice: number; cashIrr: number; expiryYears: number };
  }
  const g = golden<G>("swaption-flat-curve");
  it("physical, cash CCP and cash IRR values", () => {
    const val = parseISO(g.inputs.valuationDate);
    const ctx = flatCtx(val, [{ id: g.inputs.curveId, ccy: "EUR", rate: g.inputs.flatZeroRate }]);
    const legBase = {
      notional: g.inputs.notional,
      currency: "EUR",
      effectiveDate: parseISO(g.inputs.swapStart),
      terminationDate: parseISO(g.inputs.swapEnd),
      frequency: "12M",
      calendar: "NONE",
      businessDayConvention: "Unadjusted" as const,
    };
    const underlying: InterestRateSwap = {
      id: "golden-swpt-ul",
      type: "InterestRateSwap",
      legs: [
        { type: "Fixed", payReceive: "Pay", ...legBase, dayCount: "30E/360", rate: g.inputs.strike },
        { type: "Float", payReceive: "Receive", ...legBase, dayCount: "ACT/360", index: "EURIBOR-12M", fixingLag: 0 },
      ],
    };
    const swpt: Swaption = {
      id: "golden-swpt",
      type: "Swaption",
      payReceive: "Receive",
      payerReceiver: "Payer",
      expiryDate: parseISO(g.inputs.expiryDate),
      settlement: "Physical",
      underlying,
      volOverride: g.inputs.normalVol,
    };
    const phys = priceTrade(ctx, swpt, "EUR");
    expect(phys.warnings).toEqual([]);
    expectRel(phys.analytics.forwardSwapRate as number, g.expected.forwardSwapRate, "forward swap rate");
    expectRel(phys.analytics.annuity as number, g.expected.annuity, "annuity");
    expectRel(phys.analytics.expiryYears as number, g.expected.expiryYears, "expiry years");
    expectRel(phys.pv, g.expected.physical, "physical");
    expectRel(priceTrade(ctx, { ...swpt, settlement: "Cash" }, "EUR").pv, g.expected.cashCollateralisedCashPrice, "cash CCP");
    expectRel(priceTrade(ctx, { ...swpt, settlement: "Cash", cashSettlementConvention: "IRR" }, "EUR").pv, g.expected.cashIrr, "cash IRR");
  });
});

describe("golden master – cap on the flat curve", () => {
  interface G {
    inputs: {
      valuationDate: string;
      curveId: string;
      flatZeroRate: number;
      notional: number;
      strike: number;
      normalVol: number;
      effectiveDate: string;
      terminationDate: string;
    };
    expected: {
      caplets: { fixingDate: string; paymentDate: string; forward: number; accrualFactor: number; expiryYears: number; presentValue: number }[];
      pv: number;
    };
  }
  const g = golden<G>("cap-flat-curve");
  it("caplet strip (Bachelier) matches per caplet and in total", () => {
    const val = parseISO(g.inputs.valuationDate);
    const ctx = flatCtx(val, [{ id: g.inputs.curveId, ccy: "EUR", rate: g.inputs.flatZeroRate }]);
    const cap: CapFloor = {
      id: "golden-cap",
      type: "CapFloor",
      capFloor: "Cap",
      payReceive: "Receive",
      notional: g.inputs.notional,
      currency: "EUR",
      index: "EURIBOR-12M",
      effectiveDate: parseISO(g.inputs.effectiveDate),
      terminationDate: parseISO(g.inputs.terminationDate),
      frequency: "12M",
      dayCount: "ACT/360",
      calendar: "NONE",
      businessDayConvention: "Unadjusted",
      strike: g.inputs.strike,
      volOverride: g.inputs.normalVol,
    };
    const res = priceTrade(ctx, cap, "EUR");
    expect(res.warnings).toEqual([]);
    const cfs = res.legs[0]!.cashflows;
    expect(cfs).toHaveLength(g.expected.caplets.length);
    cfs.forEach((cf, i) => {
      const e = g.expected.caplets[i]!;
      expect(toISO(cf.fixingDate!)).toBe(e.fixingDate);
      expect(toISO(cf.paymentDate)).toBe(e.paymentDate);
      expectRel(cf.rate!, e.forward, `caplet ${i} forward`);
      expectRel(cf.accrualFactor!, e.accrualFactor, `caplet ${i} τ`);
      expectRel(cf.presentValue, e.presentValue, `caplet ${i} PV`);
    });
    expectRel(res.pv, g.expected.pv, "cap PV");
  });
});

describe("golden master – sample-market €STR OIS bootstrap (calendar, payment lag, log-linear interpolation)", () => {
  interface G {
    inputs: { valuationDate: string; curveId: string; index: string; quotes: CurveQuote[] };
    expected: {
      spotDate: string;
      spotDf: number;
      pillars: { tenor: string; rate: number; accrualEnd: string; date: string; time: number; df: number; zero: number; method: "closed-form" | "bisection" }[];
      closedFormPillars: string[];
    };
    quantlib: { status: string; version?: string; engine: string; pillars: { date: string; df: number }[] };
  }
  const g = golden<G>("sample-market-bootstrap");
  const val = parseISO(g.inputs.valuationDate);

  it("the JSON quotes are the sample-market quotes (no silent drift between reference and engine inputs)", () => {
    expect(g.inputs.quotes).toEqual(SAMPLE_QUOTES.eurOis);
    expect(g.expected.closedFormPillars).toEqual(["1W", "1M", "3M", "6M", "9M", "1Y"]);
  });

  it("QuantLib cross-check (R4-4): PiecewiseLogLinearDiscount / OISRateHelper reproduces every pillar DF within 5e-8 – a uniform factor from the 0→spot stub convention – and every DF ratio between pillars within 1e-12", () => {
    // The block is checked in (tools/quantlib-golden.py run with QuantLib 1.43, see test-data/golden/README.md).
    expect(g.quantlib.status).toBe("done");
    expect(g.quantlib.version ?? "1.43").toMatch(/^1\.\d+/);
    expect(g.quantlib.engine).toContain("PiecewiseLogLinearDiscount");
    const ql = new Map(g.quantlib.pillars.map((p) => [p.date, p.df]));
    // QuantLib's curve has a t = 0 node and no spot node: 1 + 18 pillars on the same dates as the engine.
    expect(ql.get(g.inputs.valuationDate)).toBe(1);
    expect(g.quantlib.pillars).toHaveLength(g.expected.pillars.length + 1);
    const rel = g.expected.pillars.map((p) => {
      const q = ql.get(p.date);
      expect(q, `QuantLib pillar ${p.date}`).toBeDefined();
      return q! / p.df - 1;
    });
    for (const r of rel) expect(Math.abs(r)).toBeLessThan(5e-8);
    // Uniform: the spread of the relative differences is at machine precision …
    expect(Math.max(...rel) - Math.min(...rel)).toBeLessThan(1e-12);
    // … and equals the stub effect exactly: the engine's spot node DF = 1/(1 + r_1W·τ_s) (simple interest over
    // the 4 days to spot) versus QuantLib's log-linear segment 0 → 1W pillar (no spot node, i.e. continuous
    // compounding at the 1W zero), ln DF_QL − ln DF_engine = ln(1 + r_1W·τ_s) − (τ_s/τ_1W)·ln(1 + r_1W·τ_1W)
    // ≈ (r²/2)·τ_s·(τ_1W − τ_s) = 1.87e-8 (τ_s = 4/360, τ_1W = 7/360, r_1W = 2.01 %).
    const r1w = (g.inputs.quotes[0] as { rate: number }).rate;
    const tauS = 4 / 360;
    const tau1w = 7 / 360;
    const stub = Math.log(1 + r1w * tauS) - (tauS / tau1w) * Math.log(1 + r1w * tau1w);
    expect(Math.abs(rel[0]! - stub)).toBeLessThan(1e-10);
    expect(Math.abs(stub - ((r1w * r1w) / 2) * tauS * (tau1w - tauS))).toBeLessThan(1e-11);
    // Forward structure identical: DF ratios between neighbouring pillars agree to 1e-12.
    for (let i = 1; i < g.expected.pillars.length; i++) {
      const a = g.expected.pillars[i - 1]!;
      const b = g.expected.pillars[i]!;
      const ratioQl = ql.get(b.date)! / ql.get(a.date)!;
      const ratioExp = b.df / a.df;
      expect(Math.abs(ratioQl / ratioExp - 1), `DF ratio ${a.tenor}→${b.tenor}`).toBeLessThan(1e-12);
    }
  });

  it("standalone bootstrap reproduces the spot node and every pillar DF (closed form ≤ 1Y, bisection > 1Y) and reprices all quotes", () => {
    const res = bootstrapCurve(val, { id: g.inputs.curveId, currency: "EUR", index: g.inputs.index, quotes: g.inputs.quotes });
    const curve = res.curve;
    const nodes = curve.nodes();
    expect(toISO(nodes[0]!.date)).toBe(g.expected.spotDate);
    expectRel(nodes[0]!.df, g.expected.spotDf, "spot DF", 1e-12);
    expect(nodes).toHaveLength(g.expected.pillars.length + 1);
    g.expected.pillars.forEach((p, i) => {
      const n = nodes[i + 1]!;
      expect(toISO(n.date)).toBe(p.date);
      // ≤ 1Y pillars are exact closed forms – demand near machine precision; the bisection pillars 1e-9.
      expectRel(n.df, p.df, `DF ${p.tenor}`, p.method === "closed-form" ? 1e-12 : 1e-9);
      expectRel(curve.zeroRate(n.date), p.zero, `zero ${p.tenor}`, 1e-8);
      expectRel(curve.time(n.date), p.time, `time ${p.tenor}`, 1e-12);
    });
    for (const r of res.residuals) expect(Math.abs(r.residual)).toBeLessThan(1e-9);
    expect(res.residuals).toHaveLength(g.inputs.quotes.length);
  });

  it("the sample market's EUR-ESTR curve is that curve (same pillars, same DFs)", () => {
    const ctx = buildSampleMarket(val);
    const c = ctx.curves[SAMPLE_CURVE_IDS.eurOis]!;
    for (const p of g.expected.pillars) expectRel(c.df(parseISO(p.date)), p.df, `sample DF ${p.tenor}`, 1e-9);
  });
});
