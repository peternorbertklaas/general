import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flatCurve } from "../curves/curve.js";
import { parseISO, toISO } from "../dates/date.js";
import { makeFxForward } from "../instruments/builders.js";
import { type CapFloor, type InterestRateSwap, type Swaption } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
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
  }
  const g = golden<G>("black76-bachelier");
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
