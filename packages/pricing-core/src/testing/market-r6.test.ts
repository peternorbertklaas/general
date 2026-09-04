import { describe, expect, it } from "vitest";
import { type CurveBuildSpec, bootstrapCurves } from "../curves/bootstrap.js";
import {
  RATE_INDICES,
  SWAP_CONVENTIONS,
  getIndex,
  getSwapConventions,
  knownCurrencies,
  knownIndices,
  registerRateIndex,
  registerSwapConventions,
} from "../curves/index-definitions.js";
import { getCalendar, isBusinessDay } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { PricingError } from "../errors.js";
import { makeCapFloor, makeFxForward, makeFxOption, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { type MarketContext, getFixing } from "../market/market-context.js";
import { SAMPLE_FIXINGS, buildSampleMarket, sampleFixings } from "../market/sample-market.js";
import { deserializeMarket, serializeMarket, validateMarket } from "../market/snapshot.js";
import { VOL_IMPLAUSIBLE_PREFIX, validateVolSurfaces, volSurfaceWarnings } from "../market/vol-validation.js";
import { priceTrade } from "../pricing/price.js";
import { marketSnapshotId } from "../reporting/valuation-report.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof PricingError ? e.code : `plain:${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// R6-5 – open currency / index register: NOK, SEK, DKK, PLN and runtime registration
// ---------------------------------------------------------------------------
describe("Markt R6-5 – NOK/SEK/DKK/PLN conventions and runtime registration", () => {
  it("the register knows the Nordic and Polish indices and swap conventions", () => {
    expect(knownCurrencies()).toEqual(["CHF", "DKK", "EUR", "GBP", "JPY", "NOK", "PLN", "SEK", "USD"]);
    expect(getIndex("nibor-6m")).toMatchObject({
      currency: "NOK",
      type: "IBOR",
      tenor: "6M",
      dayCount: "ACT/360",
      fixingCalendar: "NO",
      fixingLag: 2,
      curveId: "NOK-NIBOR-6M",
    });
    expect(getIndex("NOWA")).toMatchObject({ currency: "NOK", type: "OIS", tenor: "1D", dayCount: "ACT/365F", fixingLag: 0 });
    expect(getIndex("STIBOR-3M").currency).toBe("SEK");
    expect(getIndex("SWESTR")).toMatchObject({ type: "OIS", dayCount: "ACT/360" });
    expect(getIndex("CIBOR-6M").currency).toBe("DKK");
    expect(getIndex("DESTR").type).toBe("OIS");
    expect(getIndex("WIBOR-6M")).toMatchObject({ currency: "PLN", dayCount: "ACT/365F" });
    expect(getIndex("POLONIA")).toMatchObject({ currency: "PLN", type: "OIS" });
    expect(getSwapConventions("NOK")).toMatchObject({
      fixedDayCount: "30/360",
      floatIndex: "NIBOR-6M",
      floatFrequency: "6M",
      calendar: "NO",
      oisIndex: "NOWA",
    });
    expect(getSwapConventions("SEK")).toMatchObject({ floatIndex: "STIBOR-3M", floatFrequency: "3M", oisIndex: "SWESTR" });
    expect(getSwapConventions("DKK")).toMatchObject({ floatIndex: "CIBOR-6M", oisIndex: "DESTR" });
    expect(getSwapConventions("PLN")).toMatchObject({ fixedDayCount: "ACT/ACT ISDA", floatIndex: "WIBOR-6M", oisIndex: "POLONIA" });
    expect(knownIndices("NOK").map((i) => i.name)).toEqual(["NIBOR-3M", "NIBOR-6M", "NOWA"]);
    expect(knownIndices().length).toBe(Object.keys(RATE_INDICES).length);
    // every convention references indices of its own currency, every index a registered calendar
    for (const c of Object.values(SWAP_CONVENTIONS)) {
      expect(getIndex(c.floatIndex).currency).toBe(c.currency);
      expect(getIndex(c.oisIndex)).toMatchObject({ currency: c.currency, type: "OIS" });
      expect(() => getCalendar(c.calendar)).not.toThrow();
    }
    for (const i of Object.values(RATE_INDICES)) expect(() => getCalendar(i.fixingCalendar)).not.toThrow();
    // national calendars: currency code doubles as calendar id; a few known holidays
    expect(isBusinessDay(parseISO("2026-05-17"), getCalendar("NOK"))).toBe(false); // Sunday anyway
    expect(isBusinessDay(parseISO("2027-05-17"), getCalendar("NO"))).toBe(false); // Constitution Day (Monday)
    expect(isBusinessDay(parseISO("2026-06-19"), getCalendar("SE"))).toBe(false); // Midsummer Eve (Friday)
    expect(isBusinessDay(parseISO("2026-06-05"), getCalendar("DK"))).toBe(false); // Constitution Day (Friday)
    expect(isBusinessDay(parseISO("2026-06-04"), getCalendar("PL"))).toBe(false); // Corpus Christi
    expect(isBusinessDay(parseISO("2026-06-04"), getCalendar("TARGET"))).toBe(true);
  });

  it("a NOK curve set is bootstrapped from a few quotes and a NOK par swap / EURNOK forward are priced", () => {
    const specs: CurveBuildSpec[] = [
      {
        id: "NOK-NOWA",
        currency: "NOK",
        index: "NOWA",
        quotes: [
          { type: "OIS", tenor: "1M", rate: 0.0445 },
          { type: "OIS", tenor: "6M", rate: 0.0435 },
          { type: "OIS", tenor: "1Y", rate: 0.042 },
          { type: "OIS", tenor: "2Y", rate: 0.0405 },
          { type: "OIS", tenor: "5Y", rate: 0.0395 },
          { type: "OIS", tenor: "10Y", rate: 0.0398 },
        ],
      },
      {
        id: "NOK-NIBOR-6M",
        currency: "NOK",
        index: "NIBOR-6M",
        discountCurveId: "NOK-NOWA",
        quotes: [
          { type: "Deposit", tenor: "6M", rate: 0.0455 },
          { type: "FRA", start: "6M", end: "12M", rate: 0.0445 },
          { type: "Swap", tenor: "2Y", rate: 0.0432 },
          { type: "Swap", tenor: "5Y", rate: 0.042 },
          { type: "Swap", tenor: "10Y", rate: 0.0421 },
        ],
      },
    ];
    const built = bootstrapCurves(VAL, specs);
    expect(Object.keys(built.curves).sort()).toEqual(["NOK-NIBOR-6M", "NOK-NOWA"]);
    const nok: MarketContext = {
      ...ctx,
      curves: { ...ctx.curves, ...built.curves },
      discountCurveId: { ...ctx.discountCurveId, NOK: "NOK-NOWA" },
      fxSpots: { ...ctx.fxSpots, EURNOK: 11.62 },
    };
    // A vanilla NOK swap built with the register's conventions and struck at the 5Y quote is at par.
    const spot = getSwapConventions("NOK").spotLag;
    const start = parseISO("2026-09-07");
    expect(spot).toBe(2);
    const swap = makeVanillaSwap({
      id: "NOK-IRS",
      currency: "NOK",
      notional: 1e8,
      payReceiveFixed: "Pay",
      fixedRate: 0.042,
      effectiveDate: start,
      maturity: "5Y",
    });
    expect(swap.legs.map((l) => (l.type === "Float" ? l.index : l.dayCount))).toEqual(["30/360", "NIBOR-6M"]);
    const r = priceTrade(nok, swap, "NOK");
    expect(Number.isFinite(r.pv)).toBe(true);
    expect(Math.abs(r.pv)).toBeLessThan(1e8 * 1e-4); // par to within 1 bp of notional
    expect(r.analytics.parRate as number).toBeCloseTo(0.042, 4);
    expect(r.warnings).toEqual([]);
    // reporting in EUR converts at EURNOK; an EURNOK forward is priced on the joint TARGET+NO(+US) calendar
    expect(Number.isFinite(priceTrade(nok, swap, "EUR").pv)).toBe(true);
    const fwd = makeFxForward({ id: "F", pair: "EURNOK", baseAmount: 1e6, rate: 11.9, deliveryDate: parseISO("2027-09-06") });
    const rf = priceTrade(nok, fwd, "EUR");
    expect(Number.isFinite(rf.pv)).toBe(true);
    expect(rf.analytics.fairForward as number).toBeGreaterThan(11.62); // NOK rates above EUR rates → forward above spot
    expect(rf.details?.spotDate).toBe("2026-09-08"); // T+2 on TARGET+NO+US: Labor Day 2026-09-07 is skipped (cross via USD)
    // without a NOK discount curve in the market the swap still fails with a coded error
    expect(codeOf(() => priceTrade(ctx, swap, "NOK"))).toBe("NO_DISCOUNT_CURVE");
  });

  it("registerRateIndex / registerSwapConventions add a currency at runtime and validate the definitions", () => {
    expect(codeOf(() => getIndex("PRIBOR-3M"))).toBe("UNKNOWN_INDEX");
    expect(codeOf(() => getSwapConventions("CZK"))).toBe("INVALID_TRADE");
    const pribor = registerRateIndex({
      name: "PRIBOR-3M",
      currency: "CZK",
      type: "IBOR",
      tenor: "3M",
      dayCount: "ACT/360",
      fixingCalendar: "WEEKEND",
      fixingLag: 2,
      businessDayConvention: "ModifiedFollowing",
      endOfMonth: true,
      curveId: "CZK-PRIBOR-3M",
    });
    registerRateIndex({ ...pribor, name: "CZEONIA", type: "OIS", tenor: "1D", fixingLag: 0, curveId: "CZK-CZEONIA" });
    expect(getIndex("pribor-3m")).toBe(pribor);
    expect(knownIndices("CZK").map((i) => i.name)).toEqual(["CZEONIA", "PRIBOR-3M"]);
    // conventions must reference registered indices of the same currency
    expect(
      codeOf(() =>
        registerSwapConventions({
          currency: "CZK",
          fixedFrequency: "1Y",
          fixedDayCount: "ACT/360",
          floatIndex: "EURIBOR-6M",
          floatFrequency: "6M",
          calendar: "WEEKEND",
          spotLag: 2,
          oisIndex: "CZEONIA",
          oisFixedFrequency: "1Y",
          oisFixedDayCount: "ACT/360",
          oisPaymentLag: 2,
        }),
      ),
    ).toBe("INVALID_CURVE_SPEC");
    registerSwapConventions({
      currency: "czk",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      floatIndex: "PRIBOR-3M",
      floatFrequency: "3M",
      calendar: "WEEKEND",
      spotLag: 2,
      oisIndex: "CZEONIA",
      oisFixedFrequency: "1Y",
      oisFixedDayCount: "ACT/360",
      oisPaymentLag: 2,
    });
    expect(knownCurrencies()).toContain("CZK");
    const swap = makeVanillaSwap({
      id: "CZK-IRS",
      currency: "CZK",
      notional: 1e8,
      payReceiveFixed: "Pay",
      fixedRate: 0.04,
      effectiveDate: VAL + 2,
      maturity: "2Y",
    });
    expect(swap.legs[1]).toMatchObject({ type: "Float", index: "PRIBOR-3M", frequency: "3M" });
    // invalid definitions are rejected with INVALID_CURVE_SPEC, never a plain Error
    const bad = (patch: Partial<Parameters<typeof registerRateIndex>[0]>) => codeOf(() => registerRateIndex({ ...pribor, name: "X-TEST", ...patch }));
    expect(bad({ currency: "CZ" })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ type: "Term" as "IBOR" })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ tenor: "3X" })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ dayCount: "ACT/999" as "ACT/360" })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ fixingCalendar: "MARS" })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ fixingLag: -1 })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ fixingLag: 1.5 })).toBe("INVALID_CURVE_SPEC");
    expect(bad({ curveId: "" })).toBe("INVALID_CURVE_SPEC");
    expect(codeOf(() => getIndex("X-TEST"))).toBe("UNKNOWN_INDEX");
    // clean up the test registration
    delete RATE_INDICES["PRIBOR-3M"];
    delete RATE_INDICES.CZEONIA;
    delete SWAP_CONVENTIONS.CZK;
  });
});

// ---------------------------------------------------------------------------
// R6-4 – vol plausibility: VOL_IMPLAUSIBLE warnings from validation and pricing
// ---------------------------------------------------------------------------
describe("Markt R6-4 – vol plausibility warnings", () => {
  const eurCube = ctx.swaptionVols!.EUR!;
  const eurCaplets = ctx.capletVols!["EUR-EURIBOR-6M"]!;
  const eurusd = ctx.fxVols!.EURUSD!;
  const zeros = (grid: number[][]) => grid.map((row) => row.map(() => 0));

  it("the sample market is plausible; lognormal-with-normal-numbers, all-zero and huge vols are reported as VOL_IMPLAUSIBLE warnings, not problems", () => {
    expect(volSurfaceWarnings(ctx)).toEqual([]);
    const lognormalWithNormalNumbers = { ...eurCube, volType: "Lognormal" as const };
    expect(validateVolSurfaces({ swaptionVols: { EUR: lognormalWithNormalNumbers } })).toEqual([]);
    // the reviewer's probe: normal numbers (≈ 0.97 %) declared Lognormal → median check
    const w1 = volSurfaceWarnings({ swaptionVols: { EUR: lognormalWithNormalNumbers } });
    expect(w1).toHaveLength(1);
    expect(w1[0]).toMatch(/^VOL_IMPLAUSIBLE: swaptionVols\.EUR: median lognormal vol 0\.\d\d % is below 1 % – the numbers look like normal \(bp\) vols/);
    const w2 = volSurfaceWarnings({ swaptionVols: { EUR: { ...eurCube, atm: zeros(eurCube.atm) } } });
    expect(w2).toEqual([expect.stringMatching(/^VOL_IMPLAUSIBLE: swaptionVols\.EUR is degenerate – every vol is 0/)]);
    const w3 = volSurfaceWarnings({ capletVols: { "EUR-EURIBOR-6M": { ...eurCaplets, vols: eurCaplets.vols.map((r) => r.map(() => 0.5)) } } });
    expect(w3).toContainEqual(expect.stringMatching(/^VOL_IMPLAUSIBLE: capletVols\.EUR-EURIBOR-6M has \d+ of \d+ normal vols above 1000 bp \(max 5000 bp\)/));
    expect(w3).toContainEqual(expect.stringMatching(/^VOL_IMPLAUSIBLE: capletVols\.EUR-EURIBOR-6M: median normal vol 5000 bp is above 500 bp/));
    const w4 = volSurfaceWarnings({ fxVols: { EURUSD: { ...eurusd, atm: eurusd.atm.map(() => 4) } } });
    expect(w4).toEqual([expect.stringMatching(/^VOL_IMPLAUSIBLE: fxVols\.EURUSD has \d+ of \d+ lognormal vols above 300 %/)]);
    // per-value bounds alone: a single 0.05 % point on an otherwise normal-looking lognormal smile
    const w5 = volSurfaceWarnings({ fxVols: { EURUSD: { ...eurusd, atm: eurusd.atm.map((v, i) => (i === 0 ? 0.0005 : v)) } } });
    expect(w5).toEqual([expect.stringMatching(/^VOL_IMPLAUSIBLE: fxVols\.EURUSD has 1 of \d+ lognormal vols below 0\.10 % \(min 0\.05 %\)/)]);
    // a single legitimate zero (R5 boundary case) is not a warning; a structurally broken surface is skipped here
    expect(volSurfaceWarnings({ fxVols: { EURUSD: { ...eurusd, atm: eurusd.atm.map((v, i) => (i === 0 ? 0 : v)) } } })).toEqual([]);
    expect(volSurfaceWarnings({ swaptionVols: { EUR: { ...eurCube, atm: [[0.005]] } } })).toEqual([]);
    expect(validateVolSurfaces({ swaptionVols: { EUR: { ...eurCube, atm: [[0.005]] } } }).length).toBeGreaterThan(0);
  });

  it("pricing on an implausible surface carries the warning on the trade (swaption, cap, FX option); PVs are unchanged", () => {
    const swpt = makeSwaption({
      id: "S",
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      expiry: "2Y",
      tenor: "5Y",
      strike: 0.025,
      valuationDate: VAL,
    });
    const base = priceTrade(ctx, swpt, "EUR");
    expect(base.warnings.some((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX))).toBe(false);
    const zeroCube: MarketContext = { ...ctx, swaptionVols: { ...ctx.swaptionVols, EUR: { ...eurCube, atm: zeros(eurCube.atm) } } };
    const r = priceTrade(zeroCube, swpt, "EUR");
    expect(r.warnings.filter((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX))).toEqual([expect.stringContaining(`swaption surface ${eurCube.id} is degenerate`)]);
    expect(r.analytics.volatility).toBe(0);
    // same object → cached, same message once even with two valuations
    expect(priceTrade(zeroCube, swpt, "EUR").warnings.filter((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX))).toHaveLength(1);
    const cap = makeCapFloor({ id: "C", currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: VAL + 2, maturity: "5Y" });
    const bigCaplets: MarketContext = {
      ...ctx,
      capletVols: { ...ctx.capletVols, "EUR-EURIBOR-6M": { ...eurCaplets, vols: eurCaplets.vols.map((row) => row.map(() => 0.2)) } },
    };
    expect(priceTrade(bigCaplets, cap, "EUR").warnings.some((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX) && w.includes("normal vols above 1000 bp"))).toBe(true);
    expect(priceTrade(bigCaplets, { ...cap, volOverride: 0.006 }, "EUR").warnings.some((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX))).toBe(false);
    const fxo = {
      ...makeFxOption({ id: "O", pair: "EURUSD", optionType: "Call", strike: 1.16, notional: 1e7, expiryDate: VAL + 180, deliveryDate: VAL + 182 }),
      payReceive: "Receive" as const,
    };
    const tinyFx: MarketContext = { ...ctx, fxVols: { ...ctx.fxVols, EURUSD: { ...eurusd, atm: eurusd.atm.map(() => 0.0007) } } };
    expect(priceTrade(tinyFx, fxo, "USD").warnings.some((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX) && w.includes("lognormal vols below 0.10 %"))).toBe(true);
    // the plausible sample market prices without the warning and the snapshot validation is unaffected
    expect(priceTrade(ctx, fxo, "USD").warnings.some((w) => w.startsWith(VOL_IMPLAUSIBLE_PREFIX))).toBe(false);
    expect(validateMarket(zeroCube)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R6-6 – sample market carries the fixings the sample book needs
// ---------------------------------------------------------------------------
describe("Markt R6-6 – historical fixings in the sample market", () => {
  it("EURIBOR-6M/3M and €STR fixings on every TARGET business day up to the valuation date", () => {
    const fixings = ctx.fixings!;
    expect(fixings.length).toBeGreaterThan(1000);
    expect(SAMPLE_FIXINGS.length).toBe(fixings.length);
    const cal = getCalendar("TARGET");
    for (const f of fixings) {
      expect(f.date).toBeLessThan(VAL); // strictly before the valuation date – today's fixing is in the deposit quotes
      expect(isBusinessDay(f.date, cal)).toBe(true);
      expect(f.value).toBeGreaterThan(0.015);
      expect(f.value).toBeLessThan(0.04);
    }
    expect(new Set(fixings.map((f) => f.index))).toEqual(new Set(["EURIBOR-6M", "EURIBOR-3M", "ESTR"]));
    expect(getFixing(ctx, "EURIBOR-6M", parseISO("2026-06-15"))).toBeCloseTo(0.0218, 3); // IRS-0001's running period
    expect(getFixing(ctx, "EURIBOR-6M", parseISO("2024-06-13"))).toBeCloseTo(0.0365, 3);
    expect(getFixing(ctx, "ESTR", parseISO("2026-09-02"))).toBeCloseTo(0.0203, 4);
    expect(getFixing(ctx, "EURIBOR-6M", parseISO("2026-09-05"))).toBeUndefined(); // Saturday
    expect(getFixing(ctx, "EURIBOR-6M", VAL)).toBeUndefined(); // the valuation date itself: spot-starting trades project off the curve
    expect(getFixing(ctx, "EURIBOR-6M", VAL + 1)).toBeUndefined(); // after the valuation date
    // a later valuation date extends the history, an earlier one shortens it
    const later = sampleFixings(parseISO("2026-12-15"));
    expect(later.length).toBeGreaterThan(fixings.length);
    expect(later.at(-1)!.date).toBeLessThanOrEqual(parseISO("2026-12-15"));
    expect(sampleFixings(parseISO("2024-01-02"))).toEqual([]);
  });

  it("the sample book's IRS-0001 (EURIBOR-6M from 2024-06-17) values without MISSING_FIXING, also on a shifted valuation date", () => {
    const irs = makeVanillaSwap({
      id: "IRS-0001",
      currency: "EUR",
      notional: 10_000_000,
      payReceiveFixed: "Pay",
      fixedRate: 0.0315,
      effectiveDate: parseISO("2024-06-17"),
      maturity: "10Y",
    });
    const r = priceTrade(ctx, irs, "EUR");
    expect(r.warnings.filter((w) => w.startsWith("MISSING_FIXING"))).toEqual([]);
    const running = r.legs[1]!.cashflows.find((c) => c.accrualStart! <= VAL && c.accrualEnd! > VAL)!;
    expect(running.isFixed).toBe(true);
    expect(toISO(running.fixingDate!)).toBe("2026-06-15");
    expect(running.rate).toBeCloseTo(0.0218, 3);
    // the same book on a later valuation date (after the next reset) still has its fixing
    const dec = buildSampleMarket(parseISO("2026-12-30"));
    expect(priceTrade(dec, irs, "EUR").warnings.filter((w) => w.startsWith("MISSING_FIXING"))).toEqual([]);
    // an empty-fixings market shows the warning the reviewer saw (regression guard for the test itself)
    expect(priceTrade({ ...ctx, fixings: [] }, irs, "EUR").warnings.some((w) => w.startsWith("MISSING_FIXING"))).toBe(true);
  });

  it("fixings travel through the unchanged snapshot format and are part of the snapshot id", () => {
    expect(validateMarket(ctx)).toEqual([]);
    const json = serializeMarket(ctx);
    const back = deserializeMarket(json);
    expect(back.fixings!.length).toBe(ctx.fixings!.length);
    expect(getFixing(back, "EURIBOR-6M", parseISO("2026-06-15"))).toBe(getFixing(ctx, "EURIBOR-6M", parseISO("2026-06-15")));
    expect(marketSnapshotId(back)).toBe(marketSnapshotId(ctx));
    expect(marketSnapshotId({ ...ctx, fixings: [] })).not.toBe(marketSnapshotId(ctx));
  });
});
