import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { QUICK_ENTRY_EXAMPLES, extractCounterparty, isGrammarToken, parseQuickEntry, parseValuationDateCommand } from "./quick-parser.js";

const VAL = parseISO("2026-09-03");

describe("quick entry parser", () => {
  it("parses a payer swap", () => {
    const r = parseQuickEntry("irs 10y pay 3.1% 10m", VAL);
    expect(r.ok).toBe(true);
    expect(r.trade?.type).toBe("InterestRateSwap");
    const t = r.trade!;
    if (t.type === "InterestRateSwap") {
      const fixed = t.legs.find((l) => l.type === "Fixed")!;
      expect(fixed.payReceive).toBe("Pay");
      expect(fixed.notional).toBe(10_000_000);
      expect((fixed as { rate: number }).rate).toBeCloseTo(0.031, 10);
    }
  });
  it("parses OIS with currency and receiver", () => {
    const r = parseQuickEntry("ois usd 2y rec 3.3 25m", VAL);
    expect(r.ok).toBe(true);
    const t = r.trade!;
    if (t.type === "InterestRateSwap") {
      expect(t.legs[0]!.currency).toBe("USD");
      expect((t.legs[1] as { index: string }).index).toBe("SOFR");
      expect(t.legs[0]!.payReceive).toBe("Receive");
    }
  });
  it("parses collar with two strikes", () => {
    const r = parseQuickEntry("collar 7y 3.5/1.5 6m", VAL);
    expect(r.ok).toBe(true);
    const t = r.trade!;
    if (t.type === "CapFloor") {
      expect(t.capFloor).toBe("Collar");
      expect(t.strike).toBeCloseTo(0.035, 10);
      expect(t.floorStrike).toBeCloseTo(0.015, 10);
      expect(t.notional).toBe(6_000_000);
    }
  });
  it("parses swaption", () => {
    const r = parseQuickEntry("swpt 1y5y receiver 2.8% 5m", VAL);
    expect(r.ok).toBe(true);
    const t = r.trade!;
    if (t.type === "Swaption") {
      expect(t.payerReceiver).toBe("Receiver");
      expect(t.underlying.legs[0]!.notional).toBe(5_000_000);
    }
  });
  it("parses fx forward with sell direction and date", () => {
    const r = parseQuickEntry("fxf eurusd -2m 1.1725 2027-03-15", VAL);
    expect(r.ok).toBe(true);
    const t = r.trade!;
    if (t.type === "FxForward") {
      expect(t.sellCurrency).toBe("EUR");
      expect(t.buyCurrency).toBe("USD");
      expect(t.sellAmount).toBe(2_000_000);
      expect(t.buyAmount).toBeCloseTo(2_345_000, 6);
      expect(t.deliveryDate).toBe(parseISO("2027-03-15"));
    }
  });
  it("parses fx option with tenor expiry", () => {
    const r = parseQuickEntry("fxo eurusd put 1.15 3m 9m", VAL);
    expect(r.ok).toBe(true);
    const t = r.trade!;
    if (t.type === "FxOption") {
      expect(t.optionType).toBe("Put");
      expect(t.strike).toBe(1.15);
      expect(t.notional).toBe(3_000_000);
      expect(t.expiryDate).toBeGreaterThan(VAL + 250);
    }
  });
  it("parses basis swap, amortising swap and fx swap", () => {
    const b = parseQuickEntry("basis 5y 3m/6m 5bp 10m", VAL);
    expect(b.ok).toBe(true);
    if (b.trade?.type === "InterestRateSwap") {
      expect((b.trade.legs[0] as { index: string; spread: number }).index).toBe("EURIBOR-3M");
      expect((b.trade.legs[0] as { spread: number }).spread).toBeCloseTo(0.0005, 10);
      expect((b.trade.legs[1] as { index: string }).index).toBe("EURIBOR-6M");
    }
    const a = parseQuickEntry("amort 10y pay 3.1% 10m", VAL);
    expect(a.ok).toBe(true);
    if (a.trade?.type === "InterestRateSwap") {
      expect(a.trade.legs[0]!.notionalSchedule?.length).toBeGreaterThan(5);
    }
    const f = parseQuickEntry("fxs eurusd 1m 1.1625 1.18 1y", VAL);
    expect(f.ok).toBe(true);
    expect(f.trade?.type).toBe("FxSwap");
  });
  it("parses cross-currency swaps (spread, notional, MtM reset) and FRAs (period, direction, rate)", () => {
    const SPOTS = { fxSpots: { EURUSD: 1.17 } };
    const c = parseQuickEntry("ccs eurusd 5y -20bp 10m mtm", VAL, SPOTS);
    expect(c.ok).toBe(true);
    expect(c.trade?.type).toBe("CrossCurrencySwap");
    if (c.trade?.type === "CrossCurrencySwap") {
      expect(c.trade.legs[0]!.currency).toBe("EUR");
      expect(c.trade.legs[0]!.notional).toBe(10_000_000);
      expect((c.trade.legs[0] as { spread: number }).spread).toBeCloseTo(-0.002, 10);
      expect(c.trade.legs[1]!.currency).toBe("USD");
      expect(c.trade.legs[1]!.notional).toBeCloseTo(11_700_000, 3);
      expect(c.trade.mtmReset).toBeDefined();
      expect(c.trade.legs[0]!.notionalExchange?.initial).toBe(true);
    }
    expect(c.description).toMatch(/Cross-Currency-Swap EUR\/USD 5Y/);
    expect(c.description).toMatch(/MtM-Reset/);
    const c2 = parseQuickEntry("ccs eurusd 5y -20bp 10m 1.20", VAL); // explicit spot instead of market spot
    expect(c2.ok).toBe(true);
    expect(c2.trade?.type === "CrossCurrencySwap" && c2.trade.mtmReset).toBeUndefined();
    expect(c2.trade?.type === "CrossCurrencySwap" && c2.trade.legs[1]!.notional).toBeCloseTo(12_000_000, 3);
    expect(parseQuickEntry("ccs eurusd 5y -20bp 10m", VAL).error).toMatch(/FX-Spot für EUR\/USD fehlt/);
    expect(parseQuickEntry("ccs 5y -20bp", VAL, SPOTS).ok).toBe(false);

    const f = parseQuickEntry("fra 3x6 pay 2.2% 10m", VAL);
    expect(f.ok).toBe(true);
    expect(f.trade?.type).toBe("FRA");
    if (f.trade?.type === "FRA") {
      expect(f.trade.payReceive).toBe("Pay");
      expect(f.trade.fixedRate).toBeCloseTo(0.022, 10);
      expect(f.trade.notional).toBe(10_000_000);
      expect(f.trade.index).toBe("EURIBOR-3M");
      expect(f.trade.startDate).toBeGreaterThan(VAL + 80);
      expect(f.trade.endDate).toBeGreaterThan(f.trade.startDate + 80);
    }
    const f2 = parseQuickEntry("fra 6x12 rec 2.5 5m @DZ BANK", VAL);
    expect(f2.trade?.type === "FRA" && f2.trade.payReceive).toBe("Receive");
    expect(f2.trade?.type === "FRA" && f2.trade.index).toBe("EURIBOR-6M");
    expect(f2.trade?.counterparty).toBe("DZ BANK");
    expect(parseQuickEntry("fra pay 2.2%", VAL).ok).toBe(false);
    expect(parseQuickEntry("fra 6x3 pay 2.2%", VAL).ok).toBe(false);
    for (const tok of ["3x6", "mtm", "step", "2.5/3.0/3.5"]) expect(isGrammarToken(tok), tok).toBe(true);
  });
  it("step token builds a step-up coupon schedule (one rate per year, first rate = base coupon)", () => {
    const r = parseQuickEntry("irs 5y pay 2.5% 10m step 2.5/3.0/3.5", VAL);
    expect(r.ok).toBe(true);
    if (r.trade?.type === "InterestRateSwap") {
      const fixed = r.trade.legs.find((l): l is Extract<typeof l, { type: "Fixed" }> => l.type === "Fixed")!;
      expect(fixed.rate).toBeCloseTo(0.025, 10);
      const sched = fixed.rateSchedule!;
      expect(sched.length).toBe(3);
      expect(sched[sched.length - 1]!.rate).toBeCloseTo(0.035, 10);
      expect(sched[1]!.date - sched[0]!.date).toBeGreaterThan(360);
    }
    expect(r.description).toMatch(/Staffel/);
    expect(parseQuickEntry("irs 5y pay 10m step 2,0/2,5", VAL).trade?.type === "InterestRateSwap").toBe(true);
  });
  it("names FX trades with German dates, honours `fixed` for CCS and accepts JPY strikes without decimals (R3-11, Markt R3-5)", () => {
    const SPOTS = { fxSpots: { EURUSD: 1.17, EURJPY: 171.4 } };
    expect(parseQuickEntry("fxf eurusd -2m 1.1725 2027-03-15", VAL).trade?.name).toBe("Verkauf EUR/USD 15.03.2027");
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 2027-06-15", VAL).trade?.name).toBe("EUR-Put/USD-Call 15.06.2027");
    expect(parseQuickEntry("fxo eurusd put 1.15 3m 9m", VAL).trade?.name).toBe("EUR-Put/USD-Call 9M");
    expect(parseQuickEntry("fxs eurusd 1m 1.1625 1.18 2027-09-06", VAL).trade?.name).toBe("FX-Swap EUR/USD 06.09.2027");
    for (const ex of QUICK_ENTRY_EXAMPLES) expect(parseQuickEntry(ex, VAL, SPOTS).trade?.name ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // fixed-vs-float CCS
    const fixed = parseQuickEntry("ccs eurusd 5y fixed 3% 10m", VAL, SPOTS);
    expect(fixed.ok).toBe(true);
    if (fixed.trade?.type === "CrossCurrencySwap") {
      const fixedLeg = fixed.trade.legs.find((l) => l.type === "Fixed");
      expect(fixedLeg && (fixedLeg as { rate: number }).rate).toBeCloseTo(0.03, 10);
      expect(fixedLeg?.currency).toBe("EUR");
      expect(fixed.trade.collateralCurrency).toBe("USD");
    }
    expect(fixed.description).toMatch(/Fest 3,00 %/);
    const basis = parseQuickEntry("ccs eurusd 5y -20bp 10m", VAL, SPOTS);
    expect(basis.trade?.type === "CrossCurrencySwap" && basis.trade.legs.every((l) => l.type === "Float")).toBe(true);
    expect(basis.trade?.collateralCurrency).toBe("USD");
    // JPY strike without decimals, plausibility against the spot
    const jpy = parseQuickEntry("fxo eurjpy call 175 1m 6m", VAL, SPOTS);
    expect(jpy.ok).toBe(true);
    expect(jpy.trade?.type === "FxOption" && jpy.trade.strike).toBe(175);
    expect(jpy.trade?.type === "FxOption" && jpy.trade.notional).toBe(1_000_000);
    expect(parseQuickEntry("fxo eurusd call 175 1m 6m", VAL, SPOTS).error).toMatch(/Strike 175,00 passt nicht zum Spot EUR\/USD 1,1700/);
    expect(parseQuickEntry("fxf eurusd 2m 117 6m", VAL, SPOTS).error).toMatch(/passt nicht zum Spot/);
    expect(parseQuickEntry("fxo eurusd call 175 1m 6m", VAL).ok).toBe(true); // no spot known → accepted
  });
  it("FRA index follows the period length via the core builder (Markt R3-2)", () => {
    const indexOf = (input: string) => {
      const t = parseQuickEntry(input, VAL).trade;
      return t?.type === "FRA" ? t.index : undefined;
    };
    expect(indexOf("fra 3x6 pay 2.2% 10m")).toBe("EURIBOR-3M");
    expect(indexOf("fra 6x12 rec 2.5 5m")).toBe("EURIBOR-6M");
    expect(parseQuickEntry("fra 3x6 pay 2.2% 10m", VAL).description).toMatch(/EURIBOR-3M/);
  });
  it("reports errors for incomplete input", () => {
    expect(parseQuickEntry("irs pay 3%", VAL).ok).toBe(false);
    expect(parseQuickEntry("cap 5y", VAL).ok).toBe(false);
    expect(parseQuickEntry("hello world", VAL).ok).toBe(false);
    // "step" without a list is an error, not a silent plain swap (R3-10)
    expect(parseQuickEntry("irs 5y pay 2.5% 10m step", VAL).error).toMatch(/step ohne Stufen/);
    expect(parseQuickEntry("irs 5y pay 2.5% 10m step 2.5/3.0", VAL).ok).toBe(true);
    // impossible calendar dates are not offered as a valuation-date command (R3-13)
    expect(parseValuationDateCommand("stichtag 31.12.2026")).toBe("2026-12-31");
    expect(parseValuationDateCommand("stichtag 2026-12-31")).toBe("2026-12-31");
    expect(parseValuationDateCommand("stichtag 31.02.2026")).toBeUndefined();
    expect(parseValuationDateCommand("stichtag 2026-02-30")).toBeUndefined();
  });
  it("@Kontrahent takes the rest of the phrase until the next grammar token (N-15)", () => {
    expect(parseQuickEntry("collar 7y 3,5/1,5 6m @Kunde GmbH", VAL).trade?.counterparty).toBe("Kunde GmbH");
    expect(parseQuickEntry("irs 10y pay 3.1% 10m @Landesbank Hessen", VAL).trade?.counterparty).toBe("Landesbank Hessen");
    expect(parseQuickEntry("irs 10y pay 3.1% 10m @Deutsche Bank AG", VAL).trade?.counterparty).toBe("Deutsche Bank AG");
    expect(parseQuickEntry("irs @Sparkasse Musterstadt 10y pay 3.1% 10m", VAL).trade?.counterparty).toBe("Sparkasse Musterstadt");
    const r = parseQuickEntry("irs @Sparkasse Musterstadt 10y pay 3.1% 10m", VAL);
    expect(r.ok).toBe(true);
    expect(parseQuickEntry('irs 5y rec 2.4% 5m @"Bank für Handel und Industrie"', VAL).trade?.counterparty).toBe("Bank für Handel und Industrie");
    expect(extractCounterparty(["@Kunde", "GmbH", "eur", "5y"])).toEqual({ toks: ["eur", "5y"], counterparty: "Kunde GmbH" });
    for (const tok of ["eur", "usd", "pay", "rec", "10y", "3.1%", "25bp", "eurusd", "2027-03-15", "estr", "3m/6m"]) expect(isGrammarToken(tok), tok).toBe(true);
    for (const tok of ["GmbH", "Bank", "AG", "Hessen", "Musterstadt"]) expect(isGrammarToken(tok), tok).toBe(false);
  });
});
