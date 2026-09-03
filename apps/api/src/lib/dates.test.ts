import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { datesToIso, datesToSerial } from "./dates.js";

describe("ISO ↔ serial date mapping", () => {
  it("converts known date keys recursively and leaves other strings alone", () => {
    const input = {
      id: "x",
      effectiveDate: "2026-09-07",
      legs: [{ terminationDate: "2036-09-07", frequency: "6M", index: "EURIBOR-6M" }],
      hedgedItem: { maturityDate: "2034-06-17", description: "2034-06-17 is text but key is not a date key" },
      quotes: [{ type: "FRA", start: "6M", end: "12M", rate: 0.02 }],
      designationDate: "2024-06-17",
    };
    const out = datesToSerial(input);
    expect(out.effectiveDate).toBe(parseISO("2026-09-07"));
    expect(out.legs[0]!.terminationDate).toBe(parseISO("2036-09-07"));
    expect(out.legs[0]!.frequency).toBe("6M");
    expect(out.hedgedItem.maturityDate).toBe(parseISO("2034-06-17"));
    expect(out.hedgedItem.description).toContain("2034-06-17");
    expect(out.quotes[0]!.start).toBe("6M");
    expect(out.designationDate).toBe(parseISO("2024-06-17"));
  });
  it("round-trips serial dates back to ISO without touching notionals", () => {
    const serial = { paymentDate: parseISO("2027-03-15"), notional: 25000, amount: 20000, nested: [{ fixingDate: parseISO("2026-01-02") }] };
    const iso = datesToIso(serial);
    expect(iso.paymentDate).toBe("2027-03-15");
    expect(iso.nested[0]!.fixingDate).toBe("2026-01-02");
    expect(iso.notional).toBe(25000);
    expect(iso.amount).toBe(20000);
    expect(datesToSerial(iso)).toEqual(serial);
  });
  it("ignores malformed date strings", () => {
    const out = datesToSerial({ effectiveDate: "07.09.2026" });
    expect(out.effectiveDate).toBe("07.09.2026");
  });
});
