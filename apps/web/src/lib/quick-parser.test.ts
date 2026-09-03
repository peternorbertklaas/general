import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { parseQuickEntry } from "./quick-parser.js";

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
  it("reports errors for incomplete input", () => {
    expect(parseQuickEntry("irs pay 3%", VAL).ok).toBe(false);
    expect(parseQuickEntry("cap 5y", VAL).ok).toBe(false);
    expect(parseQuickEntry("hello world", VAL).ok).toBe(false);
  });
});
