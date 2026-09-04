/** Round-7 editor finding (R7-02 / Markt R7-1): currency, index, collateral and pair selects come from the register and the market, not from G5 constants. */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Trade, advance, getCalendar, makeCapFloor, makeFra, makeFxOption, makeVanillaSwap } from "@deriva/pricing-core";
import { useStore } from "../state/store.js";
import { TradeEditor } from "./TradeEditor.js";

const st = () => useStore.getState();
const OIS = [
  { type: "OIS" as const, tenor: "1Y", rate: 0.031 },
  { type: "OIS" as const, tenor: "2Y", rate: 0.0315 },
  { type: "OIS" as const, tenor: "5Y", rate: 0.032 },
  { type: "OIS" as const, tenor: "10Y", rate: 0.033 },
];
const options = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => ({ v: o.value, l: o.textContent }));

describe("R7-02 – trade editor lists from the register and the market", () => {
  beforeEach(() => {
    localStorage.clear();
    st().resetPortfolio();
    st().addExtraCurve({ id: "DKK-DESTR", currency: "DKK", index: "DESTR", quotes: OIS }, { fxSpot: { pair: "EURDKK", rate: 7.46 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("a DKK/DESTR swap shows DKK and DESTR (not EUR / EURIBOR-3M); currencies without a curve are flagged; collateral offers DKK-CSA", () => {
    const swap = makeVanillaSwap({
      id: "IRS-DKK",
      currency: "DKK",
      notional: 12_000_000,
      payReceiveFixed: "Pay",
      fixedRate: 0.03,
      effectiveDate: advance(st().valuationDate, "2D", getCalendar("TARGET")),
      maturity: "5Y",
      index: "DESTR",
    });
    const onChange = vi.fn();
    render(<TradeEditor trade={swap} onChange={onChange} />);
    const ccy = screen.getByLabelText("Währung") as HTMLSelectElement;
    expect(ccy.value).toBe("DKK");
    const ccyOpts = options("Währung");
    expect(ccyOpts.map((o) => o.v)).toEqual(expect.arrayContaining(["EUR", "USD", "GBP", "CHF", "JPY", "DKK", "NOK", "SEK", "PLN"]));
    expect(ccyOpts.find((o) => o.v === "DKK")?.l).toBe("DKK");
    expect(ccyOpts.find((o) => o.v === "NOK")?.l).toBe("NOK (ohne Kurve)");
    const index = screen.getByLabelText("Index") as HTMLSelectElement;
    expect(index.value).toBe("DESTR");
    expect(options("Index").map((o) => o.l)).toEqual(["DESTR", "CIBOR-3M (ohne Kurve)", "CIBOR-6M (ohne Kurve)"]);
    expect(options("Collateral-Währung").map((o) => o.v)).toEqual(expect.arrayContaining(["", "EUR", "USD", "DKK"]));
    expect(options("Collateral-Währung").find((o) => o.v === "DKK")?.l).toBe("DKK-CSA");
    // currency change moves the float leg to the new currency's curve-backed index
    fireEvent.change(ccy, { target: { value: "EUR" } });
    const next = onChange.mock.calls[0]![0] as Extract<Trade, { type: "InterestRateSwap" }>;
    expect(next.legs.every((l) => l.currency === "EUR")).toBe(true);
    expect((next.legs.find((l) => l.type === "Float") as { index: string }).index).toBe("EURIBOR-6M");
  });

  it("cap / FRA currency change picks the curve-backed index (DESTR for DKK); a NOK cap can be created although NOK has no curve yet", () => {
    const cap = makeCapFloor({
      id: "CAP-X",
      currency: "EUR",
      notional: 1e7,
      capFloor: "Cap",
      strike: 0.03,
      effectiveDate: st().valuationDate + 2,
      maturity: "5Y",
    });
    const onChange = vi.fn();
    const r = render(<TradeEditor trade={cap} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Währung"), { target: { value: "DKK" } });
    expect(onChange.mock.calls[0]![0]).toMatchObject({ currency: "DKK", index: "DESTR" });
    // a currency without any curve takes its conventional index (NIBOR-6M, priced as "Kurve fehlt") – never the EUR index:
    // since round 8 the core rejects a leg whose index belongs to another currency (Markt R8-1)
    fireEvent.change(screen.getByLabelText("Währung"), { target: { value: "NOK" } });
    expect(onChange.mock.calls[1]![0]).toMatchObject({ currency: "NOK", index: "NIBOR-6M" });
    r.unmount();
    const fra = makeFra({ id: "FRA-X", currency: "EUR", notional: 1e7, payReceive: "Pay", start: "3x6", rate: 0.03, valuationDate: st().valuationDate });
    const onChange2 = vi.fn();
    render(<TradeEditor trade={fra} onChange={onChange2} />);
    fireEvent.change(screen.getByLabelText("Währung"), { target: { value: "DKK" } });
    expect(onChange2.mock.calls[0]![0]).toMatchObject({ currency: "DKK", index: "DESTR" });
    expect(options("Index").map((o) => o.l)).toContain("EURIBOR-3M");
  });

  it("FX option pairs come from the market's spots and surfaces (EUR/DKK selectable), the hint names '+ Fläche'", () => {
    const fxo = makeFxOption({ id: "FXO-X", pair: "EURDKK", optionType: "Call", notional: 1e6, strike: 7.5, expiryDate: st().valuationDate + 90 });
    render(<TradeEditor trade={fxo} onChange={() => undefined} />);
    const pair = screen.getByLabelText("Paar") as HTMLSelectElement;
    expect(pair.value).toBe("EURDKK");
    expect(options("Paar").map((o) => o.v)).toEqual(expect.arrayContaining(["EURUSD", "EURDKK", "USDJPY"]));
    expect(screen.getByText(/Keine FX-Vol-Fläche für EUR\/DKK .* „\+ Fläche“ anlegen/)).toBeInTheDocument();
  });
});
