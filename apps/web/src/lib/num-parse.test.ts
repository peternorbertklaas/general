import { describe, expect, it } from "vitest";
import { decimalsOf, formatNumberInput, isNumberPrefix, normaliseDecimal, parseNumberInput } from "./num-parse.js";

describe("numeric input parsing", () => {
  it("accepts decimal comma and point", () => {
    expect(parseNumberInput("3,25", 100)?.value).toBeCloseTo(0.0325, 12);
    expect(parseNumberInput("3.25", 100)?.value).toBeCloseTo(0.0325, 12);
    expect(parseNumberInput("-0,5", 100)?.value).toBeCloseTo(-0.005, 12);
  });
  it("accepts German thousands grouping", () => {
    expect(parseNumberInput("10.000.000")?.value).toBe(10_000_000);
    expect(parseNumberInput("1.234,5")?.value).toBe(1234.5);
    expect(parseNumberInput("1,234.5")?.value).toBe(1234.5);
    expect(normaliseDecimal("1.000")).toBe("1000");
    expect(normaliseDecimal("1.5")).toBe("1.5");
  });
  it("understands trader shorthand", () => {
    expect(parseNumberInput("10m")?.value).toBe(10_000_000);
    expect(parseNumberInput("2,5 Mio")?.value).toBe(2_500_000);
    expect(parseNumberInput("250k")?.value).toBe(250_000);
    expect(parseNumberInput("1bn")?.value).toBe(1e9);
    expect(parseNumberInput("25bp", 100)?.value).toBeCloseTo(0.0025, 12);
    expect(parseNumberInput("3,1%", 1e4)?.value).toBeCloseTo(0.031, 12);
    expect(parseNumberInput("25bp", 100)?.unit).toBe("bp");
  });
  it("rejects garbage but tolerates prefixes while typing", () => {
    expect(parseNumberInput("abc")).toBeUndefined();
    expect(parseNumberInput("")).toBeUndefined();
    expect(isNumberPrefix("-")).toBe(true);
    expect(isNumberPrefix("3,")).toBe(true);
    expect(isNumberPrefix("1.")).toBe(true);
    expect(isNumberPrefix("x")).toBe(false);
  });
  it("formats with grouping and bounded decimals", () => {
    expect(formatNumberInput(10_000_000)).toBe("10.000.000");
    expect(formatNumberInput(0.0315, 100)).toBe("3,15");
    expect(formatNumberInput(0.031500000001, 100)).toBe("3,15");
    expect(formatNumberInput(-0, 100)).toBe("0");
    expect(formatNumberInput(undefined)).toBe("");
    expect(decimalsOf(0.005)).toBe(3);
    expect(decimalsOf(100000)).toBe(0);
  });
});
