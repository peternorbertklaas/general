import { describe, expect, it } from "vitest";
import { fmtBp, fmtCompact, fmtMoney, fmtMs, fmtNum, fmtPct, fmtSigned, fmtYears, signClass } from "./format.js";

describe("formatters (de-DE only)", () => {
  it("fmtNum uses decimal comma and thousands point for every digit count", () => {
    expect(fmtNum(10.261, 1)).toBe("10,3");
    expect(fmtNum(0.983738, 6)).toBe("0,983738");
    expect(fmtNum(1234567.891, 2)).toBe("1.234.567,89");
    expect(fmtNum(1.15, 4)).toBe("1,1500");
    expect(fmtNum(undefined)).toBe("–");
    expect(fmtNum(NaN)).toBe("–");
  });
  it("never renders -0", () => {
    expect(fmtNum(-0, 2)).toBe("0,00");
    expect(fmtMoney(-0.2)).toBe("0");
    expect(fmtMoney(-0.004, undefined, 2)).toBe("0,00");
    expect(fmtMoney(-0.6)).toBe("-1");
  });
  it("percent / bp / years / ms / compact", () => {
    expect(fmtPct(0.026975, 4)).toBe("2,6975 %");
    expect(fmtBp(0.00103, 1)).toBe("10,3 bp");
    expect(fmtYears(7.789)).toBe("7,79 J");
    expect(fmtMs(3.04)).toBe("3,0 ms");
    expect(fmtCompact(1_250_000)).toBe("1,25 Mio");
    expect(fmtCompact(-850_000, "EUR")).toBe("-850,0 Tsd EUR");
    expect(fmtCompact(2_400_000_000)).toBe("2,40 Mrd");
    expect(fmtSigned(20, 0, "bp")).toBe("+20 bp");
    expect(fmtSigned(-2.5, 1, "%")).toBe("-2,5 %");
  });
  it("signClass threshold matches fmtMoney rounding", () => {
    expect(signClass(0.2)).toBe("");
    expect(signClass(-0.4)).toBe("");
    expect(signClass(0.6)).toBe("pos");
    expect(signClass(-0.2, 1e-9)).toBe("neg");
    expect(signClass(undefined)).toBe("");
  });
});
