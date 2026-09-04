import { beforeEach, describe, expect, it } from "vitest";
import { parseISO, serializeMarket } from "@deriva/pricing-core";
import { marketModified, useStore } from "./store.js";

describe("store – FX fixings for MtM resets (core R4-1)", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().resetPortfolio();
    useStore.setState({ undoStack: [], toasts: [] });
  });

  it("setFxFixings rebuilds the market, marks it as modified, is undoable and exported with the snapshot", () => {
    const st = useStore.getState();
    const d = parseISO("2026-03-01");
    expect(st.setFxFixings([{ pair: "EURUSD", date: d, rate: 1.1 }], "FX-Fixing EUR/USD 01.03.2026 = 1,1000")).toBe(true);
    let s = useStore.getState();
    expect(s.fxFixings).toEqual([{ pair: "EURUSD", date: d, rate: 1.1 }]);
    expect(s.baseMarket.fxFixings).toEqual([{ pair: "EURUSD", date: d, rate: 1.1 }]);
    expect(marketModified(s)).toBe(true);
    expect(serializeMarket(s.baseMarket).fxFixings).toEqual([{ pair: "EURUSD", date: "2026-03-01", rate: 1.1 }]);
    // survives a valuation-date change (rebuilt from quotes)
    expect(s.setValuationDate("2026-10-30")).toBe(true);
    s = useStore.getState();
    expect(s.baseMarket.fxFixings?.length).toBe(1);
    // undo restores the previous list
    expect(s.undoStack[s.undoStack.length - 1]?.kind).toBe("fxFixings");
    expect(s.undo()).toBe("FX-Fixing EUR/USD 01.03.2026 = 1,1000");
    s = useStore.getState();
    expect(s.fxFixings).toEqual([]);
    expect(s.baseMarket.fxFixings ?? []).toEqual([]);
    expect(marketModified(s)).toBe(false);
    s.setValuationDate("2026-09-03");
  });

  it("implausible fixings are dropped, the slice is persisted and a snapshot import carries them", () => {
    const st = useStore.getState();
    st.setFxFixings([{ pair: "EURUSD", date: parseISO("2026-03-01"), rate: 1.1 }, { pair: "xx", date: 1, rate: -1 } as never], "x");
    const persisted = useStore.persist.getOptions().partialize!(useStore.getState()) as { fxFixings?: unknown[] };
    expect(persisted.fxFixings).toHaveLength(1);
    // a market set from a snapshot syncs the slice
    st.setMarket({ ...useStore.getState().baseMarket, fxFixings: [{ pair: "USDJPY", date: parseISO("2026-01-02"), rate: 150 }] });
    expect(useStore.getState().fxFixings).toEqual([{ pair: "USDJPY", date: parseISO("2026-01-02"), rate: 150 }]);
    useStore.getState().setFxFixings([], "FX-Fixings zurückgesetzt");
    expect(useStore.getState().fxFixings).toEqual([]);
  });

  it("a turn-of-year jump overtaken by the valuation date raises an 'inaktiv' toast (R4-09)", () => {
    const st = useStore.getState();
    expect(st.setTurnOfYear("EUR-ESTR", { date: parseISO("2026-12-31"), bp: 20 })).toBe(true);
    expect(useStore.getState().setValuationDate("2027-01-15")).toBe(true);
    expect(useStore.getState().toasts.some((t) => /Turn-of-Year EUR-ESTR \(31\.12\.2026\) liegt jetzt vor dem Bewertungstag – inaktiv/.test(t.msg))).toBe(true);
    // no second toast when the date moves further
    const n = useStore.getState().toasts.length;
    useStore.getState().setValuationDate("2027-02-15");
    expect(useStore.getState().toasts.length).toBe(n);
    useStore.getState().setTurnOfYear("EUR-ESTR", undefined);
    useStore.getState().setValuationDate("2026-09-03");
  });
});
