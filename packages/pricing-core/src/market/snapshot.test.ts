import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO } from "../dates/date.js";
import { makeAmortisingSwap, makeBasisSwap, makeFxSwap, makeImmSwap, makeVanillaSwap } from "../instruments/builders.js";
import { priceTrade } from "../pricing/price.js";
import { emirCsv, emirValuationRecord } from "../reporting/emir.js";
import { buildSampleMarket } from "./sample-market.js";
import { deserializeMarket, serializeMarket, validateMarket } from "./snapshot.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));

describe("market snapshot", () => {
  it("round-trips through JSON without changing prices", () => {
    const json = JSON.parse(JSON.stringify(serializeMarket(ctx)));
    const back = deserializeMarket(json);
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "10Y" });
    expect(priceTrade(back, swap, "EUR").pv).toBeCloseTo(priceTrade(ctx, swap, "EUR").pv, 6);
    expect(validateMarket(back)).toEqual([]);
    expect(json.schema).toBe("deriva.market/1");
    expect(json.valuationDate).toBe("2026-09-03");
  });
  it("validation flags broken snapshots", () => {
    const broken = { ...ctx, discountCurveId: { ...ctx.discountCurveId, SEK: "SEK-STIBOR" }, fxSpots: { ...ctx.fxSpots, EURXXX: -1 } };
    const problems = validateMarket(broken);
    expect(problems.some((p) => p.includes("SEK-STIBOR"))).toBe(true);
    expect(problems.some((p) => p.includes("EURXXX"))).toBe(true);
  });
});

describe("EMIR valuation export", () => {
  it("produces a record and CSV", () => {
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
    const rec = emirValuationRecord(ctx, swap, priceTrade(ctx, swap, "EUR"));
    expect(rec.valuationMethod).toBe("MTMO");
    expect(rec.valuationCurrency).toBe("EUR");
    expect(rec.notional).toBe(1e7);
    expect(rec.valuationTimestamp.startsWith("2026-09-03")).toBe(true);
    const csv = emirCsv([rec]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("SRCCSP");
  });
});

describe("additional builders", () => {
  it("basis swap 3M vs 6M has a positive fair spread on the 3M leg", () => {
    const b = makeBasisSwap({
      currency: "EUR",
      notional: 1e7,
      effectiveDate: spot,
      maturity: "5Y",
      receiveIndex: "EURIBOR-3M",
      payIndex: "EURIBOR-6M",
      spread: 0,
    });
    const r = priceTrade(ctx, b, "EUR");
    expect(r.pv).toBeLessThan(0); // receiving lower 3M without spread loses
    expect(r.analytics.fairSpread as number).toBeGreaterThan(0);
    expect(r.analytics.fairSpread as number).toBeLessThan(0.003);
  });
  it("amortising swap has declining notionals and smaller DV01-like PV", () => {
    const a = makeAmortisingSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.02, effectiveDate: spot, maturity: "5Y" });
    const v = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.02, effectiveDate: spot, maturity: "5Y" });
    const ra = priceTrade(ctx, a, "EUR");
    const rv = priceTrade(ctx, v, "EUR");
    const notionals = ra.legs[0]!.cashflows.map((c) => c.notional);
    expect(notionals[0]).toBe(1e7);
    expect(notionals[notionals.length - 1]!).toBeLessThan(notionals[0]!);
    expect(Math.abs(ra.pv)).toBeLessThan(Math.abs(rv.pv));
    expect(ra.pv).toBeGreaterThan(0); // paying 2% below par is a gain
  });
  it("IMM swap starts and ends on third Wednesdays", () => {
    const s = makeImmSwap({ currency: "EUR", notional: 1e6, payReceiveFixed: "Pay", fixedRate: 0.025, from: VAL, tenor: "2Y" });
    const leg = s.legs[0]!;
    expect(leg.effectiveDate).toBe(parseISO("2026-09-16"));
    expect(leg.terminationDate).toBe(parseISO("2028-09-20"));
    expect(Number.isFinite(priceTrade(ctx, s, "EUR").pv)).toBe(true);
  });
  it("FX swap builder prices consistently with two forwards", () => {
    const sw = makeFxSwap({ pair: "EURUSD", baseAmount: 1e6, nearRate: 1.1625, farRate: 1.18, nearDate: spot, farDate: parseISO("2027-09-07") });
    const r = priceTrade(ctx, sw, "USD");
    expect(r.legs).toHaveLength(4);
    expect(r.analytics.swapPoints as number).toBeGreaterThan(0);
  });
});
