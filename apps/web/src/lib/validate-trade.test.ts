import { describe, expect, it } from "vitest";
import { type Trade, parseISO } from "@deriva/pricing-core";
import { newTradeTemplate } from "./templates.js";
import { hasErrors, issueFor, validateTrade } from "./validate-trade.js";

const VAL = parseISO("2026-09-03");

describe("validate-trade (F-04)", () => {
  it("warns on implausible fixed rates and errors on non-positive notionals", () => {
    const t = newTradeTemplate("irs", VAL);
    if (t.type !== "InterestRateSwap") throw new Error("type");
    const legs = t.legs.map((l) => (l.type === "Fixed" ? { ...l, rate: 3.25 } : l));
    const issues = validateTrade({ ...t, legs, counterparty: "X" });
    expect(issueFor(issues, "rate:0")?.level).toBe("warn");
    expect(issueFor(issues, "rate:0")?.msg).toMatch(/−5 % … 25 %/);
    const neg = validateTrade({ ...t, legs: t.legs.map((l) => ({ ...l, notional: -5_000_000 })) });
    expect(hasErrors(neg)).toBe(true);
    expect(issueFor(neg, "notional:0")?.msg).toMatch(/größer als 0/);
  });
  it("errors when end <= start (German message)", () => {
    const t = newTradeTemplate("irs", VAL);
    if (t.type !== "InterestRateSwap") throw new Error("type");
    const bad = { ...t, legs: t.legs.map((l) => ({ ...l, terminationDate: l.effectiveDate - 10 })) };
    const issues = validateTrade(bad);
    expect(issueFor(issues, "terminationDate:0")?.msg).toBe("Enddatum muss nach dem Startdatum liegen");
  });
  it("FX forward: buy and sell currency must differ", () => {
    const t = newTradeTemplate("fxf", VAL);
    if (t.type !== "FxForward") throw new Error("type");
    const issues = validateTrade({ ...t, sellCurrency: t.buyCurrency });
    expect(issueFor(issues, "sellCurrency")?.level).toBe("error");
  });
  it("FX option: delivery before expiry is an error", () => {
    const t = newTradeTemplate("fxo", VAL);
    if (t.type !== "FxOption") throw new Error("type");
    const issues = validateTrade({ ...t, deliveryDate: t.expiryDate - 5 });
    expect(issueFor(issues, "deliveryDate")?.msg).toMatch(/Lieferung/);
    expect(validateTrade({ ...t, deliveryDate: t.expiryDate }).some((i) => i.field === "deliveryDate")).toBe(false);
  });
  it("collar floor above cap is an error, missing counterparty a warning", () => {
    const t = newTradeTemplate("cap", VAL);
    if (t.type !== "CapFloor") throw new Error("type");
    const issues = validateTrade({ ...t, capFloor: "Collar", floorStrike: 0.04 } as Trade);
    expect(issueFor(issues, "floorStrike")?.level).toBe("error");
    expect(issueFor(issues, "counterparty")?.level).toBe("warn");
    expect(validateTrade({ ...t, counterparty: "Bank" }).some((i) => i.field === "counterparty")).toBe(false);
  });
});
