import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { extractCounterparty, isGrammarToken, parseQuickEntry } from "./quick-parser.js";

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
  it("reports errors for incomplete input", () => {
    expect(parseQuickEntry("irs pay 3%", VAL).ok).toBe(false);
    expect(parseQuickEntry("cap 5y", VAL).ok).toBe(false);
    expect(parseQuickEntry("hello world", VAL).ok).toBe(false);
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
