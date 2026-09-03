import { describe, expect, it } from "vitest";
import { parseISO, toISO } from "@deriva/pricing-core";
import { DATE_PRESETS, formatDateInput, parseDateInput } from "./date-parse.js";

const base = parseISO("2026-09-03");
const iso = (v: number | undefined) => (v === undefined ? undefined : toISO(v));

describe("date input parser (F-39)", () => {
  it("accepts ISO and German dates", () => {
    expect(iso(parseDateInput("2027-12-31", { base }))).toBe("2027-12-31");
    expect(iso(parseDateInput("31.12.2027", { base }))).toBe("2027-12-31");
    expect(iso(parseDateInput("31.12.27", { base }))).toBe("2027-12-31");
    expect(iso(parseDateInput("1.3.", { base }))).toBe("2026-03-01");
    expect(parseDateInput("31.02.2027", { base })).toBeUndefined();
  });
  it("accepts tenors relative to the base and signed tenors relative to the current value", () => {
    expect(iso(parseDateInput("10y", { base }))).toBe("2036-09-03");
    expect(iso(parseDateInput("6m", { base }))).toBe("2027-03-03");
    expect(iso(parseDateInput("2w", { base }))).toBe("2026-09-17");
    expect(iso(parseDateInput("1y6m", { base }))).toBe("2028-03-03");
    const current = parseISO("2030-01-15");
    expect(iso(parseDateInput("+6m", { base, current }))).toBe("2030-07-15");
    expect(iso(parseDateInput("-1y", { base, current }))).toBe("2029-01-15");
    expect(iso(parseDateInput("+6m", { base }))).toBe("2027-03-03");
  });
  it("knows keywords and rejects garbage", () => {
    expect(iso(parseDateInput("heute", { base }))).toBe("2026-09-03");
    expect(iso(parseDateInput("me", { base }))).toBe("2026-09-30");
    expect(iso(parseDateInput("je", { base }))).toBe("2026-12-31");
    expect(parseDateInput("spot", { base })).toBeGreaterThan(base);
    expect(parseDateInput("morgen", { base })).toBeUndefined();
    expect(parseDateInput("", { base })).toBeUndefined();
  });
  it("formats dd.mm.yyyy and every preset parses", () => {
    expect(formatDateInput(base)).toBe("03.09.2026");
    for (const p of DATE_PRESETS) expect(parseDateInput(p.input, { base, current: base }), p.label).toBeDefined();
  });
});
