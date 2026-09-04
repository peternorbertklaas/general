import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import {
  DEFAULT_AVAILABLE_INDICES,
  fraIndexForPeriod,
  makeCapFloor,
  makeCrossCurrencySwap,
  makeFra,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
} from "../instruments/builders.js";
import { type CapFloor, type CrossCurrencySwap, type FloatLeg, type FxForward, type FxSwap, type Swaption } from "../instruments/types.js";
import { type MarketContext, getFxFixing } from "../market/market-context.js";
import { fxRateAtValuationDate, fxSpotDate } from "../market/fx-spot.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { deserializeMarket, serializeMarket, validateMarket } from "../market/snapshot.js";
import { emirCsv, emirValuationRecord } from "../reporting/emir.js";
import { buildValuationReport, ifrs13Level, marketSnapshotId } from "../reporting/valuation-report.js";
import { fxForwardRate } from "./fx-pricer.js";
import { priceTrade, validateTrade } from "./price.js";
import { mtmResetNotionalSchedule } from "./swap-pricer.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const TARGET = getCalendar("TARGET");
const spot = advance(VAL, "2D", TARGET);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// R4-1 – seasoned MtM-reset CCS uses the FX fixing of the reset date
// ---------------------------------------------------------------------------
describe("R4-1 – MtM-reset CCS: notional of a past reset from the FX fixing, not from today's forward", () => {
  // EUR/USD 3Y traded 2025-09-08 at 1.08, quarterly resets; current period 2026-06-08 → 2026-09-08, spot today 1.1625.
  const seasoned = makeCrossCurrencySwap({
    pair: "EURUSD",
    domesticNotional: 1e7,
    fxSpot: 1.08,
    spread: 0,
    effectiveDate: parseISO("2025-09-08"),
    tenor: "3Y",
    mtmReset: true,
  });
  const ri = seasoned.mtmReset!.resettingLegIndex;
  const resetDate = parseISO("2026-06-08");
  const withFixing: MarketContext = { ...ctx, fxFixings: [{ pair: "EURUSD", date: resetDate, rate: 1.1 }] };
  const currentNotional = (res: ReturnType<typeof priceTrade>) =>
    res.legs[ri]!.cashflows.find((c) => c.kind === "Interest" && c.accrualStart === resetDate)!.notional;

  it("with the fixing 1.10 the current period's USD notional is 11.0m and the PV is ≈ +0.5m EUR (reviewer: +470 k with IR fixings loaded)", () => {
    const res = priceTrade(withFixing, seasoned, "EUR");
    expect(currentNotional(res)).toBeCloseTo(1e7 * 1.1, 6);
    expect(res.warnings.some((w) => w.startsWith("MISSING_FX_FIXING"))).toBe(false);
    expect(res.pv).toBeGreaterThan(400_000);
    expect(res.pv).toBeLessThan(600_000);
    // Identical to the reviewer's rebuild via an explicit notional schedule (constant-notional pricer path).
    const schedule = mtmResetNotionalSchedule(withFixing, seasoned, ri, []);
    const rebuilt: CrossCurrencySwap = {
      ...seasoned,
      mtmReset: undefined,
      legs: seasoned.legs.map((l, i) => (i === ri ? { ...l, notionalSchedule: schedule, notionalExchange: { initial: true, final: true, interim: true } } : l)),
    };
    expect(priceTrade(withFixing, rebuilt, "EUR").pv).toBeCloseTo(res.pv, 6);
  });

  it("without the fixing the engine falls back to today's rate, warns MISSING_FX_FIXING and the error is ≈ 5 % of the notional", () => {
    const res = priceTrade(ctx, seasoned, "EUR");
    const todayRate = fxForwardRate(ctx, "EUR", "USD", VAL, "USD");
    expect(currentNotional(res)).toBeCloseTo(1e7 * todayRate, 4);
    const w = res.warnings.filter((x) => x.startsWith("MISSING_FX_FIXING:"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("EURUSD");
    expect(w[0]).toContain("2026-06-08");
    const fixed = priceTrade(withFixing, seasoned, "EUR").pv;
    expect(fixed - res.pv).toBeGreaterThan(400_000); // reviewer: −541 k = 5.4 % of the notional
    // the report explains the proxy
    const rep = buildValuationReport(ctx, seasoned, res, { generatedAt: "2026-09-03T17:00:00Z" });
    expect(rep.methodology.join("\n")).toContain("1 fehlende(s) FX-Fixing(s)");
    expect(ifrs13Level(ctx, seasoned, res).rationale).toContain("MtM-Reset ohne FX-Fixing");
  });

  it("missingFixingPolicy 'throw' rejects the valuation with PricingError MISSING_FIXING (FX reset fixing first)", () => {
    const messageOf = (c: MarketContext) => {
      try {
        priceTrade(c, seasoned, "EUR");
        return "";
      } catch (e) {
        expect(e).toBeInstanceOf(PricingError);
        expect((e as PricingError).code).toBe("MISSING_FIXING");
        return (e as PricingError).message;
      }
    };
    expect(messageOf({ ...ctx, missingFixingPolicy: "throw" })).toMatch(/^MISSING_FX_FIXING: Missing FX fixing for EURUSD on 2026-06-08/);
    // with the FX fixing loaded only the (unloaded) ESTR/SOFR fixings of the current period remain
    expect(messageOf({ ...withFixing, missingFixingPolicy: "throw" })).toMatch(/^MISSING_FIXING: Missing fixing for (ESTR|SOFR)/);
  });

  it("a fixing loaded on the inverse pair (USDEUR = 1/1.10) is used as 1.10", () => {
    const inverse: MarketContext = { ...ctx, fxFixings: [{ pair: "USD/EUR", date: resetDate, rate: 1 / 1.1 }] };
    expect(getFxFixing(inverse, "EURUSD", resetDate)).toBeCloseTo(1.1, 12);
    expect(getFxFixing(inverse, "eurusd", resetDate + 1)).toBeUndefined();
    expect(priceTrade(inverse, seasoned, "EUR").pv).toBeCloseTo(priceTrade(withFixing, seasoned, "EUR").pv, 4);
  });

  it("fixings of fully paid periods are not required: only the current period's reset needs a fixing", () => {
    const old = makeCrossCurrencySwap({
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: 1.1,
      spread: 0,
      effectiveDate: parseISO("2024-09-08"),
      tenor: "3Y",
      mtmReset: true,
    });
    const res = priceTrade(withFixing, old, "EUR");
    expect(res.warnings.filter((w) => w.startsWith("MISSING_FX_FIXING"))).toEqual([]);
    const cur = res.legs[old.mtmReset!.resettingLegIndex]!.cashflows.find((c) => c.kind === "Interest" && c.accrualStart === resetDate)!;
    expect(cur.notional).toBeCloseTo(1.1e7, 6);
  });

  it("first period: contractual notional when seasoned without fixing; forward at the *adjusted* effective date when forward-starting", () => {
    // Seasoned, no fixing for the effective date → the leg's contractual notional (fixed at inception), no warning.
    const fresh: MarketContext = { ...ctx, fxFixings: [] };
    const seasonedShort = makeCrossCurrencySwap({
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: 1.08,
      spread: 0,
      effectiveDate: parseISO("2026-08-10"),
      tenor: "2Y",
      mtmReset: true,
    });
    const r1 = priceTrade(fresh, seasonedShort, "EUR");
    const first = r1.legs[seasonedShort.mtmReset!.resettingLegIndex]!.cashflows.find((c) => c.kind === "Interest")!;
    expect(first.notional).toBeCloseTo(1.08e7, 6);
    expect(r1.warnings.filter((w) => w.startsWith("MISSING_FX_FIXING"))).toEqual([]);
    // Effective date on a US holiday (Labor Day 2026-09-07) → adjusted to 2026-09-08 = the FX spot date → notional = domestic × spot exactly.
    const holiday = makeCrossCurrencySwap({
      pair: "EURUSD",
      domesticNotional: 1e7,
      fxSpot: 1.1625,
      spread: 0,
      effectiveDate: parseISO("2026-09-07"),
      tenor: "3Y",
      mtmReset: true,
    });
    const r2 = priceTrade(ctx, holiday, "EUR");
    const n0 = r2.legs[holiday.mtmReset!.resettingLegIndex]!.cashflows.find((c) => c.kind === "Notional")!;
    expect(toISO(n0.paymentDate)).toBe("2026-09-08");
    expect(n0.notional).toBeCloseTo(1e7 * 1.1625, 4); // reviewer: 11 624 478.98 from the unadjusted date
    expect(n0.notional).toBeCloseTo(1e7 * fxForwardRate(ctx, "EUR", "USD", parseISO("2026-09-08"), "USD"), 6);
  });

  it("snapshot: fxFixings survive the JSON round trip, are validated and enter the marketSnapshotId", () => {
    const json = serializeMarket(withFixing);
    expect(json.fxFixings).toEqual([{ pair: "EURUSD", date: "2026-06-08", rate: 1.1 }]);
    const back = deserializeMarket(JSON.parse(JSON.stringify(json)));
    expect(back.fxFixings).toEqual(withFixing.fxFixings);
    expect(marketSnapshotId(back)).toBe(marketSnapshotId(withFixing));
    expect(marketSnapshotId(withFixing)).not.toBe(marketSnapshotId(ctx));
    // absent and empty are the same snapshot; order of fixings does not matter
    expect(marketSnapshotId({ ...ctx, fxFixings: [] })).toBe(marketSnapshotId(ctx));
    const two = [
      { pair: "EURUSD", date: resetDate, rate: 1.1 },
      { pair: "EURUSD", date: resetDate - 91, rate: 1.09 },
    ];
    expect(marketSnapshotId({ ...ctx, fxFixings: two })).toBe(marketSnapshotId({ ...ctx, fxFixings: [...two].reverse() }));
    // older snapshots without the field deserialize to no fixings
    expect(deserializeMarket(serializeMarket(ctx)).fxFixings).toBeUndefined();
    // validation
    expect(validateMarket(withFixing)).toEqual([]);
    expect(validateMarket({ ...ctx, fxFixings: [{ pair: "EURUSD", date: resetDate, rate: -1 }] }).join(" ")).toContain("must be positive");
    expect(validateMarket({ ...ctx, fxFixings: [{ pair: "EUR", date: resetDate, rate: 1.1 }] }).join(" ")).toContain("malformed");
    expect(validateMarket({ ...ctx, fxFixings: [...two, two[0]!] }).join(" ")).toContain("given twice");
    expect(() => deserializeMarket({ ...json, fxFixings: [{ pair: "EURUSD", date: "2026-06-08", rate: 0 }] })).toThrow(/rate must be a positive/);
    expect(() => deserializeMarket({ ...json, fxFixings: [{ pair: "EURUSD", date: "08.06.2026", rate: 1.1 }] })).toThrow(/ISO date/);
  });
});

// ---------------------------------------------------------------------------
// R4-2 – FX swap / forward legs settling on the valuation date
// ---------------------------------------------------------------------------
describe("R4-2 – FX legs settling today are value-today exchanges, not silently dropped", () => {
  const todayRate = fxRateAtValuationDate(ctx, "EUR", "USD");
  const far = advance(spot, "3M", TARGET);
  const fairFar = fxForwardRate(ctx, "EUR", "USD", far);
  const swap: FxSwap = {
    id: "FXS-TODAY",
    type: "FxSwap",
    nearLeg: { buyCurrency: "EUR", buyAmount: 1e7, sellCurrency: "USD", sellAmount: 1.15e7, deliveryDate: VAL },
    farLeg: { buyCurrency: "USD", buyAmount: 1e7 * fairFar, sellCurrency: "EUR", sellAmount: 1e7, deliveryDate: far },
  };

  it("near leg today at 1.15: nearFairForward = value-today rate, PV includes the off-market amount, SETTLES_TODAY warning", () => {
    const res = priceTrade(ctx, swap, "USD");
    expect(res.analytics.nearFairForward).toBeCloseTo(todayRate, 12);
    expect(res.analytics.nearFairForward).not.toBeCloseTo(ctx.fxSpots.EURUSD!, 5);
    expect(res.analytics.nearPv).toBeCloseTo(1e7 * (todayRate - 1.15), 6); // ≈ +122 515 USD
    expect(res.analytics.farPv).toBeCloseTo(0, 6);
    expect(res.pv).toBeCloseTo(res.analytics.nearPv as number, 6);
    expect(res.warnings.filter((w) => w.startsWith("SETTLES_TODAY:"))).toHaveLength(1);
    expect(res.warnings[0]).toContain("near leg");
    // swap points relative to the value-today rate
    expect(res.analytics.swapPoints).toBeCloseTo((fairFar - todayRate) * 1e4, 8);
    // reporting in EUR: the same amount at the today rate
    expect(priceTrade(ctx, swap, "EUR").pv).toBeCloseTo((1e7 * (todayRate - 1.15)) / todayRate, 6);
  });

  it("an FX forward delivering today gets the same treatment; one delivered yesterday is excluded with a warning", () => {
    const fwd: FxForward = {
      id: "FXF-TODAY",
      type: "FxForward",
      buyCurrency: "EUR",
      buyAmount: 1e7,
      sellCurrency: "USD",
      sellAmount: 1.15e7,
      deliveryDate: VAL,
    };
    const res = priceTrade(ctx, fwd, "USD");
    expect(res.pv).toBeCloseTo(1e7 * (todayRate - 1.15), 6);
    expect(res.analytics.fairForward).toBeCloseTo(todayRate, 12);
    expect(res.warnings.some((w) => w.startsWith("SETTLES_TODAY:"))).toBe(true);
    const old = priceTrade(ctx, { ...fwd, deliveryDate: VAL - 1 }, "USD");
    expect(old.pv).toBe(0);
    expect(old.warnings.join(" ")).toMatch(/already delivered/);
    // regular spot / forward legs are unchanged: fair at fair → PV 0, no warnings (pair spot date 2026-09-08, Labor Day skipped)
    const fxSpot = fxSpotDate(ctx, "EUR", "USD");
    const fair = priceTrade(ctx, { ...swap, nearLeg: { ...swap.nearLeg, deliveryDate: fxSpot, sellAmount: 1e7 * ctx.fxSpots.EURUSD! } }, "USD");
    expect(Math.abs(fair.pv)).toBeLessThan(1e-6);
    expect(fair.warnings).toEqual([]);
    expect(buildValuationReport(ctx, swap, res, { generatedAt: "2026-09-03T17:00:00Z" }).methodology.join("\n")).toContain("SETTLES_TODAY");
  });
});

// ---------------------------------------------------------------------------
// R4-3 – remaining validation gaps
// ---------------------------------------------------------------------------
describe("R4-3 – validateTrade: swaption expiry vs swap dates, rebate, notional schedule, business-day counts", () => {
  const swaption = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "5Y", tenor: "10Y", valuationDate: VAL });
  const start = swaption.underlying.legs[0]!.effectiveDate;
  const end = swaption.underlying.legs[0]!.terminationDate;
  const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
  const floatLeg = swap.legs.find((l): l is FloatLeg => l.type === "Float")!;
  const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
  const barrier = makeFxOption({ pair: "EURUSD", optionType: "Call", strike: 1.15, notional: 1e7, expiryDate: advance(VAL, "6M", TARGET), longShort: "Long" });

  it("swaption expiry after the swap start (+400 d) or after its end (+30 d) → INVALID_TRADE; expiry = start stays valid", () => {
    expect(validateTrade(swaption)).toEqual([]);
    expect(validateTrade({ ...swaption, expiryDate: start })).toEqual([]);
    const late: Swaption = { ...swaption, expiryDate: start + 400 };
    expect(validateTrade(late).join(" ")).toContain("expiryDate must not be after");
    expect(codeOf(() => priceTrade(ctx, late, "EUR"))).toBe("INVALID_TRADE");
    const afterEnd: Swaption = { ...swaption, expiryDate: end + 30 };
    expect(validateTrade(afterEnd).join(" ")).toContain("terminationDate");
    expect(codeOf(() => priceTrade(ctx, afterEnd, "EUR"))).toBe("INVALID_TRADE"); // reviewer: PV 796 035.37 without warning
  });

  it("negative barrier rebate → INVALID_TRADE (a bought option must not have a negative value)", () => {
    const t = { ...barrier, barrier: { type: "UpOut" as const, level: 1.25, rebate: -0.5 } };
    expect(validateTrade(t).join(" ")).toContain("barrier.rebate must be a non-negative");
    expect(codeOf(() => priceTrade(ctx, t, "USD"))).toBe("INVALID_TRADE");
    expect(validateTrade({ ...barrier, barrier: { type: "UpOut", level: 1.25, rebate: 0.005 } })).toEqual([]);
    expect(validateTrade({ ...barrier, barrier: { type: "UpOut", level: 1.25 } })).toEqual([]);
  });

  it("notionalSchedule entries must be positive with strictly increasing dates – on legs and on caps/floors", () => {
    const step = advance(spot, "2Y", TARGET);
    const badCap: CapFloor = { ...cap, notionalSchedule: [{ date: step, notional: -5e6 }] };
    expect(validateTrade(badCap).join(" ")).toContain("notionalSchedule[0].notional must be positive");
    expect(codeOf(() => priceTrade(ctx, badCap, "EUR"))).toBe("INVALID_TRADE"); // reviewer: PV −55 831 without hint
    expect(validateTrade({ ...cap, notionalSchedule: [{ date: step, notional: 5e6 }] })).toEqual([]);
    const badLeg = {
      ...swap,
      legs: swap.legs.map((l) => ({
        ...l,
        notionalSchedule: [
          { date: step, notional: 8e6 },
          { date: step, notional: 6e6 },
        ],
      })),
    };
    expect(validateTrade(badLeg).join(" ")).toContain("strictly increasing");
    const nan = { ...swap, legs: swap.legs.map((l) => ({ ...l, notionalSchedule: [{ date: Number.NaN, notional: 8e6 }] })) };
    expect(validateTrade(nan).join(" ")).toContain("date must be a serial date");
    expect(
      validateTrade({
        ...swap,
        legs: swap.legs.map((l) => ({
          ...l,
          notionalSchedule: [
            { date: step, notional: 8e6 },
            { date: step + 365, notional: 6e6 },
          ],
        })),
      }),
    ).toEqual([]);
  });

  it("fixingLag / lookbackDays / paymentLag must be non-negative integers", () => {
    const withLeg = (patch: Partial<FloatLeg>) => ({ ...swap, legs: swap.legs.map((l) => (l === floatLeg ? { ...l, ...patch } : l)) });
    expect(validateTrade(withLeg({ fixingLag: -5 })).join(" ")).toContain("fixingLag must be a non-negative integer");
    expect(codeOf(() => priceTrade(ctx, withLeg({ fixingLag: -5 }), "EUR"))).toBe("INVALID_TRADE"); // reviewer: PV −177 k
    expect(validateTrade(withLeg({ lookbackDays: -2 })).join(" ")).toContain("lookbackDays must be a non-negative integer");
    expect(validateTrade(withLeg({ lookbackDays: 2.5 })).join(" ")).toContain("lookbackDays");
    expect(validateTrade(withLeg({ paymentLag: -1 })).join(" ")).toContain("paymentLag");
    expect(validateTrade(withLeg({ fixingLag: 0, lookbackDays: 5, paymentLag: 2 }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Markt R4-1 – CSA without a collateral curve
// ---------------------------------------------------------------------------
describe("Markt R4-1 – a CSA currency without a collateral curve is flagged, not silently discounted on the standard curve", () => {
  it("EURGBP CCS (default CSA GBP): COLLATERAL_CURVE_MISSING for EUR, methodology says so, Level 2 with hint", () => {
    const ccs = makeCrossCurrencySwap({ pair: "EURGBP", domesticNotional: 1e7, fxSpot: ctx.fxSpots.EURGBP!, spread: 0, effectiveDate: spot, tenor: "5Y" });
    expect(ccs.collateralCurrency).toBe("GBP");
    const res = priceTrade(ctx, ccs, "EUR");
    const w = res.warnings.filter((x) => x.startsWith("COLLATERAL_CURVE_MISSING:"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('"EUR|GBP"');
    expect(w[0]).toContain("EUR-ESTR");
    const rep = buildValuationReport(ctx, ccs, res, { generatedAt: "2026-09-03T17:00:00Z" });
    const text = rep.methodology.join("\n");
    expect(text).not.toContain("CSA-Kurve (Besicherung in GBP)");
    expect(text).toContain("keine Collateral-Kurve im Marktkontext");
    const lvl = ifrs13Level(ctx, ccs, res);
    expect(lvl.level).toBe(2);
    expect(lvl.rationale).toContain("ohne Collateral-Kurve");
  });

  it("EURUSD CCS under the USD CSA (EUR|USD curve present) and uncollateralised trades carry no such warning", () => {
    const usd = makeCrossCurrencySwap({ pair: "EURUSD", domesticNotional: 1e7, fxSpot: ctx.fxSpots.EURUSD!, spread: -0.002, effectiveDate: spot, tenor: "5Y" });
    expect(priceTrade(ctx, usd, "EUR").warnings.some((x) => x.startsWith("COLLATERAL_CURVE_MISSING"))).toBe(false);
    const none = makeCrossCurrencySwap({
      pair: "EURGBP",
      domesticNotional: 1e7,
      fxSpot: ctx.fxSpots.EURGBP!,
      spread: 0,
      effectiveDate: spot,
      tenor: "5Y",
      collateralCurrency: null,
    });
    expect(priceTrade(ctx, none, "EUR").warnings.some((x) => x.startsWith("COLLATERAL_CURVE_MISSING"))).toBe(false);
    // a single-currency swap with a foreign CSA but no collateral curve is flagged as well
    const swap = makeVanillaSwap({ currency: "GBP", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.04, effectiveDate: spot, maturity: "5Y" });
    expect(priceTrade(ctx, { ...swap, collateralCurrency: "USD" }, "GBP").warnings.join(" ")).toContain("COLLATERAL_CURVE_MISSING");
    expect(priceTrade(ctx, { ...swap, collateralCurrency: "GBP" }, "GBP").warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Markt R4-6 – FRA index only on indices with a curve
// ---------------------------------------------------------------------------
describe("Markt R4-6 – fraIndexForPeriod never returns an index without a curve", () => {
  it("1x2 → EURIBOR-3M and 12x24 → EURIBOR-6M (nearest available tenor); exact tenors unchanged; RFR currencies → RFR", () => {
    expect(fraIndexForPeriod("EUR", 1)).toBe("EURIBOR-3M");
    expect(fraIndexForPeriod("EUR", 2)).toBe("EURIBOR-3M");
    expect(fraIndexForPeriod("EUR", 3)).toBe("EURIBOR-3M");
    expect(fraIndexForPeriod("EUR", 5)).toBe("EURIBOR-6M");
    expect(fraIndexForPeriod("EUR", 6)).toBe("EURIBOR-6M");
    expect(fraIndexForPeriod("EUR", 9)).toBe("EURIBOR-6M");
    expect(fraIndexForPeriod("EUR", 12)).toBe("EURIBOR-6M");
    for (const ccy of ["USD", "GBP", "CHF", "JPY"]) expect(fraIndexForPeriod(ccy, 12)).toBe(ctx.discountCurveId[ccy]!.split("-")[1]);
    // a market with a 12M curve gets the exact tenor; a 6M-only market always 6M
    expect(fraIndexForPeriod("EUR", 12, [...DEFAULT_AVAILABLE_INDICES, "EURIBOR-12M"])).toBe("EURIBOR-12M");
    expect(fraIndexForPeriod("EUR", 3, ["EURIBOR-6M"])).toBe("EURIBOR-6M");
    expect(fraIndexForPeriod("EUR", 3, [])).toBe("ESTR"); // nothing available → the currency's RFR
  });

  it("1x2 and 12x24 FRAs build and price on the sample market (R4: CURVE_NOT_FOUND EUR-EURIBOR-1M/-12M)", () => {
    for (const period of ["1x2", "2x3", "12x24", "1x13"]) {
      const fra = makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: period, rate: 0.02, valuationDate: VAL });
      expect(["EURIBOR-3M", "EURIBOR-6M"]).toContain(fra.index);
      expect(Number.isFinite(priceTrade(ctx, fra, "EUR").pv)).toBe(true);
    }
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "1x2", rate: 0.02, valuationDate: VAL }).index).toBe("EURIBOR-3M");
    expect(makeFra({ currency: "EUR", notional: 1e7, payReceive: "Pay", start: "12x24", rate: 0.02, valuationDate: VAL }).index).toBe("EURIBOR-6M");
  });
});

// ---------------------------------------------------------------------------
// Markt R4-4 – CHF / JPY IR vol surfaces in the sample market
// ---------------------------------------------------------------------------
describe("Markt R4-4 – every currency with a discount curve has a swaption cube and a caplet surface", () => {
  it("CHF and JPY swaptions / caps price at Level 2 without a fallback-vol warning", () => {
    for (const ccy of Object.keys(ctx.discountCurveId)) {
      const swpt = makeSwaption({ currency: ccy, notional: 1e7, payerReceiver: "Payer", strike: 0.02, expiry: "1Y", tenor: "5Y", valuationDate: VAL });
      const rs = priceTrade(ctx, swpt, ccy);
      expect(
        rs.warnings.filter((w) => /No .*vol surface/i.test(w)),
        `${ccy} swaption`,
      ).toEqual([]);
      expect(ifrs13Level(ctx, swpt, rs).level, `${ccy} swaption level`).toBe(2);
      expect(rs.analytics.volatility as number).toBeGreaterThan(0.002);
      const cap = makeCapFloor({ currency: ccy, notional: 1e7, capFloor: "Cap", strike: 0.02, effectiveDate: spot, maturity: "5Y" });
      const rc = priceTrade(ctx, cap, ccy);
      expect(
        rc.warnings.filter((w) => /No .*vol surface/i.test(w)),
        `${ccy} cap`,
      ).toEqual([]);
      expect(ifrs13Level(ctx, cap, rc).level, `${ccy} cap level`).toBe(2);
      expect(rc.pv).toBeGreaterThan(0);
    }
    // ordering of the indicative levels: CHF and JPY below GBP
    const gbp = ctx.swaptionVols!.GBP!.atm[3]![3]!;
    expect(ctx.swaptionVols!.CHF!.atm[3]![3]!).toBeLessThan(gbp);
    expect(ctx.swaptionVols!.JPY!.atm[3]![3]!).toBeLessThan(ctx.swaptionVols!.CHF!.atm[3]![3]!);
    expect(Object.keys(ctx.capletVols!)).toEqual(expect.arrayContaining(["CHF-SARON", "JPY-TONA"]));
    // the snapshot round trip carries the new surfaces
    expect(Object.keys(deserializeMarket(serializeMarket(ctx)).swaptionVols!).sort()).toEqual(["CHF", "EUR", "GBP", "JPY", "USD"]);
  });
});

// ---------------------------------------------------------------------------
// N4-08 – EMIR value formats (ITS (EU) 2022/1860 Table 2)
// ---------------------------------------------------------------------------
describe("N4-08 – EMIR record uses the ITS value formats: cleared Y/N/I, clearing obligation TRUE/FLSE/UKWN, booleans TRUE/FLSE", () => {
  const swap = makeVanillaSwap({ id: "EMIR-1", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
  const priced = priceTrade(ctx, swap, "EUR");

  it("maps the boolean trade inputs to the exact literals", () => {
    const base = emirValuationRecord(ctx, swap, priced);
    expect(base.cleared).toBe("N");
    expect(base.clearingObligation).toBe("UKWN");
    expect(base.collateralPortfolioIndicator).toBe("FLSE");
    const full = emirValuationRecord(ctx, { ...swap, cleared: true, clearingObligation: true, collateralCurrency: "EUR" }, priced);
    expect(full.cleared).toBe("Y");
    expect(full.clearingObligation).toBe("TRUE");
    expect(full.collateralPortfolioIndicator).toBe("TRUE");
    expect(emirValuationRecord(ctx, { ...swap, cleared: false, clearingObligation: false }, priced).clearingObligation).toBe("FLSE");
    expect(emirValuationRecord(ctx, { ...swap, cleared: false }, priced, { intentToClear: true }).cleared).toBe("I");
    expect(emirValuationRecord(ctx, { ...swap, cleared: true }, priced, { intentToClear: true }).cleared).toBe("Y");
  });

  it("the CSV carries the same literals and never FALSE / N/A", () => {
    const csv = emirCsv([
      emirValuationRecord(ctx, swap, priced),
      emirValuationRecord(ctx, { ...swap, cleared: true, clearingObligation: true, collateralCurrency: "EUR" }, priced),
    ]);
    const rows = csv.split("\n").slice(1);
    expect(rows[0]!.split(";").slice(-4, -1)).toEqual(["FLSE", "N", "UKWN"]);
    expect(rows[1]!.split(";").slice(-4, -1)).toEqual(["TRUE", "Y", "TRUE"]);
    expect(csv).not.toMatch(/FALSE|N\/A/);
  });
});
