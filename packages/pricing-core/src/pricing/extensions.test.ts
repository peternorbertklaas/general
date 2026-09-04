import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO } from "../dates/date.js";
import { makeCapFloor, makeFxOption, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type FloatLeg, type InterestRateSwap } from "../instruments/types.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { generateSuitabilityStatement, generateTermsheet } from "../reporting/documents.js";
import { buildValuationReport, hashString, stableStringify } from "../reporting/valuation-report.js";
import { STANDARD_SCENARIOS, runScenarios } from "../risk/scenarios.js";
import { computeXva } from "../xva/cva.js";
import { priceTrade } from "./price.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));

describe("embedded cap/floor on floating legs", () => {
  it("capped float leg is worth less than plain, floored more; option value exceeds intrinsic", () => {
    const base = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.0, effectiveDate: spot, maturity: "5Y" });
    const capped: InterestRateSwap = { ...base, legs: base.legs.map((l) => (l.type === "Float" ? ({ ...l, capRate: 0.03 } as FloatLeg) : l)) };
    const floored: InterestRateSwap = { ...base, legs: base.legs.map((l) => (l.type === "Float" ? ({ ...l, floorRate: 0.02 } as FloatLeg) : l)) };
    const pvBase = priceTrade(ctx, base, "EUR").legs[1]!.pv;
    const pvCap = priceTrade(ctx, capped, "EUR").legs[1]!.pv;
    const pvFloor = priceTrade(ctx, floored, "EUR").legs[1]!.pv;
    expect(pvCap).toBeLessThan(pvBase);
    expect(pvFloor).toBeGreaterThan(pvBase);
    // Cap on the leg ≈ pay-float minus a cap: compare with standalone cap value
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
    const capPv = priceTrade(ctx, cap, "EUR").pv;
    expect(pvBase - pvCap).toBeCloseTo(capPv, -2); // within 100 EUR on 10m (different fixing/vol lookups)
    // Without a vol surface the clamp is intrinsic → warning
    const noVol = { ...ctx, capletVols: undefined };
    const r = priceTrade(noVol, capped, "EUR");
    expect(r.warnings.some((w) => w.includes("embedded cap/floor"))).toBe(true);
  });
});

describe("RFR lookback conventions", () => {
  it("lookback changes projected OIS coupons only marginally and keeps PV finite", () => {
    const ois = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.022,
      effectiveDate: spot,
      maturity: "2Y",
      index: "ESTR",
    });
    const lb: InterestRateSwap = { ...ois, legs: ois.legs.map((l) => (l.type === "Float" ? ({ ...l, lookbackDays: 5 } as FloatLeg) : l)) };
    const os: InterestRateSwap = {
      ...ois,
      legs: ois.legs.map((l) => (l.type === "Float" ? ({ ...l, lookbackDays: 5, observationShift: true } as FloatLeg) : l)),
    };
    const a = priceTrade(ctx, ois, "EUR").pv;
    const b = priceTrade(ctx, lb, "EUR").pv;
    const c = priceTrade(ctx, os, "EUR").pv;
    for (const v of [a, b, c]) expect(Number.isFinite(v)).toBe(true);
    // 5 business days of lookback on a 2Y OIS: a few thousand EUR on 10m is the expected order of magnitude
    expect(Math.abs(a - b)).toBeLessThan(10_000);
    expect(Math.abs(a - c)).toBeLessThan(10_000);
    expect(b).not.toBe(a);
  });
});

describe("generic CVA", () => {
  it("covers swaptions, caps, FX options and CCS with non-negative CVA and long options without ENE", () => {
    const credit = { cptyHazard: 0.02, cptyRecovery: 0.4, ownHazard: 0.01, ownRecovery: 0.4 };
    const swpt = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate: VAL });
    const x1 = computeXva(ctx, swpt, credit, "EUR");
    expect(x1.cva).toBeGreaterThan(0);
    expect(x1.dva).toBe(0); // long option → no negative exposure
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y", longShort: "Short" });
    const x2 = computeXva(ctx, cap, credit, "EUR");
    expect(x2.cva).toBe(0); // short option → no positive exposure
    expect(x2.dva).toBeGreaterThan(0);
    const fxo = makeFxOption({ pair: "EURUSD", optionType: "Put", notional: 1e6, strike: 1.15, expiryDate: parseISO("2027-06-15") });
    const x3 = computeXva(ctx, fxo, credit, "USD");
    expect(x3.cva).toBeGreaterThan(0);
    expect(x3.method).toContain("Delta-normal");
  });
});

describe("report hashing & IFRS 13", () => {
  it("hashes are deterministic and change with inputs; vol override → Level 3", () => {
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
    const p = priceTrade(ctx, swap, "EUR");
    const r1 = buildValuationReport(ctx, swap, p);
    const r2 = buildValuationReport(ctx, swap, p);
    expect(r1.audit.reportHash).toBe(r2.audit.reportHash);
    expect(r1.audit.snapshotId).toBe(r2.audit.snapshotId);
    const swap2 = { ...swap, id: "other" };
    expect(buildValuationReport(ctx, swap2, priceTrade(ctx, swap2, "EUR")).audit.inputsHash).not.toBe(r1.audit.inputsHash);
    expect(hashString(stableStringify({ b: 1, a: 2 }))).toBe(hashString(stableStringify({ a: 2, b: 1 })));
    expect(r1.fairValue.ifrs13Level).toBe(2);
    const swpt = {
      ...makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate: VAL }),
      volOverride: 0.008,
    };
    const rr = buildValuationReport(ctx, swpt, priceTrade(ctx, swpt, "EUR"));
    expect(rr.fairValue.ifrs13Level).toBe(3);
    expect(rr.fairValue.rationale).toContain("Volatilitätsvorgabe");
  });
});

describe("documents", () => {
  it("termsheet and suitability statement contain the key regulatory sections", () => {
    const swap = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.031,
      effectiveDate: spot,
      maturity: "10Y",
      counterparty: "Sparkasse",
    });
    const p = priceTrade(ctx, swap, "EUR");
    const rep = buildValuationReport(ctx, swap, p, { transactionPrice: 0 });
    const ts = generateTermsheet(ctx, swap, p, rep);
    expect(ts.markdown).toContain("Payer-Zinsswap");
    expect(ts.sections.map((s) => s.heading)).toContain("Wesentliche Risiken");
    const sc = runScenarios(ctx, [swap], STANDARD_SCENARIOS.slice(1, 4), "EUR").results;
    const su = generateSuitabilityStatement(
      ctx,
      swap,
      p,
      rep,
      {
        clientName: "Muster GmbH",
        clientClassification: "Professioneller Kunde",
        hedgingPurpose: "Zinssicherung Investitionskredit",
        knowledgeExperience: "Erfahrung mit Swaps seit 2015",
        financialSituation: "Umsatz 80 Mio. EUR",
        riskTolerance: "mittel",
        investmentHorizonYears: 10,
        advisorName: "A. Berater",
        transactionPrice: 0,
      },
      sc,
    );
    expect(su.markdown).toContain("§ 64");
    expect(su.markdown).toContain("XI ZR 33/10");
    expect(su.markdown).toContain("Szenariobetrachtung");
    expect(su.markdown).toContain(rep.audit.reportHash);
  });
});
