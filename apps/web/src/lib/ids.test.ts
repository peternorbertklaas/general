import { describe, expect, it } from "vitest";
import { parseISO } from "@deriva/pricing-core";
import { baseName, copyName, idPrefix, nextId } from "./ids.js";
import { newTradeTemplate } from "./templates.js";

const VAL = parseISO("2026-09-03");

describe("readable ids (F-16)", () => {
  it("nextId continues the per-prefix sequence", () => {
    expect(nextId("CAP", ["CAP-0001", "IRS-0003", "cap-0004"])).toBe("CAP-0005");
    expect(nextId("FXO", [])).toBe("FXO-0001");
    expect(nextId("IRS", ["IRS-0001", "IRS-mtlyu5c4-9"])).toBe("IRS-0002");
  });
  it("derives prefixes from the instrument", () => {
    expect(idPrefix(newTradeTemplate("irs", VAL))).toBe("IRS");
    expect(idPrefix(newTradeTemplate("basis", VAL))).toBe("BASIS");
    expect(idPrefix(newTradeTemplate("amort", VAL))).toBe("AMORT");
    expect(idPrefix(newTradeTemplate("cap", VAL))).toBe("CAP");
    expect(idPrefix(newTradeTemplate("fxs", VAL))).toBe("FXS");
  });
  it("copy names never chain", () => {
    expect(baseName("Swap (Kopie) (Kopie 2)")).toBe("Swap");
    expect(copyName("Swap", ["Swap"])).toBe("Swap (Kopie)");
    expect(copyName("Swap (Kopie)", ["Swap", "Swap (Kopie)"])).toBe("Swap (Kopie 2)");
    expect(copyName("Swap (Kopie 2)", ["Swap", "Swap (Kopie)", "Swap (Kopie 2)"])).toBe("Swap (Kopie 3)");
  });
});
