import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO } from "../dates/date.js";
import { makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { SAMPLE_CURVE_IDS, buildSampleMarket, sampleBootstrapSpecs } from "../market/sample-market.js";
import { priceInterestRateSwap } from "../pricing/swap-pricer.js";
import { computeRisk, parRisk, parRiskPortfolio, vegaBuckets } from "./sensitivities.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const SPECS = sampleBootstrapSpecs(VAL);
const SPOT = advance(VAL, "2D", getCalendar("TARGET"));

describe("R2-7 – swaption vega buckets expiry × tenor", () => {
  it("2Yx5Y payer: 99 cells, the 2Yx5Y cell dominates, cells sum to the parallel vega, default layout unchanged", () => {
    const sw = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "2Y", tenor: "5Y", valuationDate: VAL });
    const parallel = computeRisk(ctx, sw, "EUR", { bucketed: false, theta: false }).vega["swaption:EUR"]!;
    const grid = vegaBuckets(ctx, sw, "EUR", { dimension: "expiry-tenor" })[0]!;
    expect(grid.dimension).toBe("expiry-tenor");
    expect(grid.buckets).toHaveLength(11 * 9);
    expect(grid.buckets.every((b) => b.tenor !== undefined)).toBe(true);
    expect(Math.abs(grid.total / parallel - 1)).toBeLessThan(0.005);
    const cell = grid.buckets.find((b) => b.label === "2Yx5Y")!;
    expect(cell.expiry).toBe(2);
    expect(cell.tenor).toBe(5);
    expect(cell.vega).toBeGreaterThan(0.9 * grid.total);
    // only the four cells around (2Y…3Y) × (5Y…7Y) carry vega
    for (const b of grid.buckets) {
      const near = b.expiry >= 2 && b.expiry <= 3 && b.tenor! >= 5 && b.tenor! <= 7;
      if (!near) expect(Math.abs(b.vega)).toBeLessThan(1e-6);
    }
    // row layout is the default and equals the sum of the row's cells
    const rows = vegaBuckets(ctx, sw, "EUR")[0]!;
    expect(rows.dimension).toBe("expiry");
    expect(rows.buckets).toHaveLength(11);
    expect(rows.buckets.every((b) => b.tenor === undefined)).toBe(true);
    const row2y = rows.buckets.find((b) => b.label === "2Y")!.vega;
    const cells2y = grid.buckets.filter((b) => b.expiry === 2).reduce((s, b) => s + b.vega, 0);
    expect(Math.abs(cells2y / row2y - 1)).toBeLessThan(0.005);
  });
  it("a 5y10y + 5y2y book: the tenor hedge is readable from the grid", () => {
    const a = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "5Y", tenor: "10Y", valuationDate: VAL });
    const b = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Receiver", strike: 0.03, expiry: "5Y", tenor: "2Y", valuationDate: VAL });
    const ga = vegaBuckets(ctx, a, "EUR", { dimension: "expiry-tenor" })[0]!;
    const gb = vegaBuckets(ctx, b, "EUR", { dimension: "expiry-tenor" })[0]!;
    const at = (g: typeof ga, label: string) => g.buckets.find((x) => x.label === label)!.vega;
    expect(at(ga, "5Yx10Y")).toBeGreaterThan(0.9 * ga.total);
    expect(at(gb, "5Yx2Y")).toBeGreaterThan(0.9 * gb.total);
    expect(Math.abs(at(ga, "5Yx2Y"))).toBeLessThan(1e-6);
    expect(Math.abs(at(gb, "5Yx10Y"))).toBeLessThan(1e-6);
  });
});

describe("N-D – parRiskPortfolio", () => {
  const trades = [
    ["2Y", 0.024],
    ["5Y", 0.026],
    ["7Y", 0.028],
    ["10Y", 0.029],
    ["15Y", 0.03],
  ].map(([tenor, rate], i) =>
    makeVanillaSwap({
      id: `S${i}`,
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: i % 2 ? "Receive" : "Pay",
      fixedRate: rate as number,
      effectiveDate: SPOT,
      maturity: tenor as string,
    }),
  );
  const opts = { curveIds: [SAMPLE_CURVE_IDS.eurOis, SAMPLE_CURVE_IDS.eur6m] };

  it("equals the per-trade parRisk exactly and prices a 5-trade book in < 3× the single-trade time", { timeout: 60_000 }, () => {
    const t1 = performance.now();
    const single = parRisk(ctx, trades[3]!, "EUR", SPECS, opts);
    const tSingle = performance.now() - t1;
    const t2 = performance.now();
    const book = parRiskPortfolio(ctx, trades, "EUR", SPECS, opts);
    const tBook = performance.now() - t2;
    expect(book).toHaveLength(5);
    expect(book[3]).toEqual(single);
    for (let i = 0; i < trades.length; i++) {
      if (i === 3) continue;
      expect(book[i]).toEqual(parRisk(ctx, trades[i]!, "EUR", SPECS, opts));
    }
    expect(tBook).toBeLessThan(3 * tSingle);
    // sanity: the 10Y payer's par risk sits in the 10Y swap bucket and the receivers carry negative risk
    const eur6m = book[3]!.curves.find((c) => c.curveId === SAMPLE_CURVE_IDS.eur6m)!;
    expect(eur6m.buckets.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a)).label).toBe("Swap 10Y");
    expect(book[1]!.total).toBeLessThan(0);
    expect(book[0]!.total).toBeGreaterThan(0);
  });

  it(
    "default targets are per trade (a USD trade in an EUR book only reports USD curves) and the totals match zero-rate DV01 within 5 %",
    { timeout: 60_000 },
    () => {
      const usd = makeVanillaSwap({ id: "U", currency: "USD", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.034, effectiveDate: SPOT, maturity: "5Y" });
      const book = parRiskPortfolio(ctx, [trades[1]!, usd], "EUR", SPECS);
      expect(book[0]!.curves.map((c) => c.curveId)).toEqual([
        SAMPLE_CURVE_IDS.eurOis,
        SAMPLE_CURVE_IDS.eur6m,
        SAMPLE_CURVE_IDS.eur3m,
        SAMPLE_CURVE_IDS.eurUsdXccy,
      ]);
      expect(book[1]!.curves.map((c) => c.curveId)).toEqual([SAMPLE_CURVE_IDS.usdSofr]);
      const dv01 = computeRisk(ctx, usd, "EUR", { bucketed: false, vega: false, theta: false }).dv01;
      expect(Math.abs(book[1]!.total / dv01 - 1)).toBeLessThan(0.05);
      expect(book[1]!.pv).toBeCloseTo(priceInterestRateSwap(ctx, usd, "EUR").pv, 6);
    },
  );
});
