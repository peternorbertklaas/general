import { describe, expect, it } from "vitest";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { makeCapFloor, makeFxForward, makeFxOption, makeSwaption, makeVanillaSwap } from "../instruments/builders.js";
import { embeddedOptionLegs, hasOptionality, tradeIndexNames, tradeMaturityDate } from "../instruments/trade-dates.js";
import { type FloatLeg, type FxOption, type InterestRateSwap } from "../instruments/types.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { type FxOptionInputs, fxBarrier, garmanKohlhagen } from "../models/garman-kohlhagen.js";
import { buildValuationReport, ifrs13Level, methodologyFor } from "../reporting/valuation-report.js";
import { applyScenario } from "../risk/scenarios.js";
import { capletSurfaceKeysFor, computeRisk, tradeCurveIds, vegaBuckets } from "../risk/sensitivities.js";
import { priceTrade } from "./price.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const TARGET = getCalendar("TARGET");
const spot = advance(VAL, "2D", TARGET);

describe("R2-1 – barrier options honour the delivery lag", () => {
  it("model: In + Out = vanilla to 1e-10 with timeToDelivery ≠ timeToExpiry (1Y EURUSD and 1W USDJPY-like)", () => {
    const cases: FxOptionInputs[] = [
      { type: "Call", spot: 1.1625, strike: 1.18, vol: 0.077, timeToExpiry: 1, timeToDelivery: 1 + 5 / 365, rd: 0.035, rf: 0.021 },
      { type: "Put", spot: 1.1625, strike: 1.15, vol: 0.077, timeToExpiry: 1, timeToDelivery: 1 + 5 / 365, rd: 0.035, rf: 0.021 },
      { type: "Call", spot: 147.45, strike: 147.45, vol: 0.08, timeToExpiry: 7 / 365, timeToDelivery: 12 / 365, rd: 0.001, rf: 0.045 },
      { type: "Put", spot: 147.45, strike: 148, vol: 0.08, timeToExpiry: 7 / 365, timeToDelivery: 12 / 365, rd: 0.001, rf: 0.045 },
    ];
    for (const i of cases) {
      const vanilla = garmanKohlhagen(i).premiumDomestic;
      const up = i.spot * 1.06;
      const down = i.spot * 0.95;
      expect(fxBarrier({ ...i, barrier: up, barrierType: "UpIn" }) + fxBarrier({ ...i, barrier: up, barrierType: "UpOut" })).toBeCloseTo(vanilla, 10);
      expect(fxBarrier({ ...i, barrier: down, barrierType: "DownIn" }) + fxBarrier({ ...i, barrier: down, barrierType: "DownOut" })).toBeCloseTo(vanilla, 10);
      // without the lag the identity holds against the no-lag vanilla, i.e. the lag really changes the value
      const noLag = { ...i, timeToDelivery: i.timeToExpiry };
      expect(fxBarrier({ ...noLag, barrier: up, barrierType: "UpIn" }) + fxBarrier({ ...noLag, barrier: up, barrierType: "UpOut" })).toBeCloseTo(
        garmanKohlhagen(noLag).premiumDomestic,
        10,
      );
      expect(Math.abs(garmanKohlhagen(noLag).premiumDomestic - vanilla)).toBeGreaterThan(1e-6);
    }
    // the short-dated large-differential case differs materially without the lag (review: +6.6 %)
    const jpy = cases[2]!;
    const noLagIn = fxBarrier({ ...jpy, timeToDelivery: jpy.timeToExpiry, barrier: jpy.spot * 1.02, barrierType: "UpIn" });
    const noLagOut = fxBarrier({ ...jpy, timeToDelivery: jpy.timeToExpiry, barrier: jpy.spot * 1.02, barrierType: "UpOut" });
    expect(Math.abs((noLagIn + noLagOut) / garmanKohlhagen(jpy).premiumDomestic - 1)).toBeGreaterThan(0.01);
    // knock-out already breached: rebate at expiry is discounted to delivery
    expect(fxBarrier({ ...jpy, barrier: jpy.spot * 0.99, barrierType: "UpOut", rebate: 1, rebateAtExpiry: true })).toBeCloseTo(
      Math.exp(-jpy.rd * jpy.timeToDelivery!),
      12,
    );
  });

  it("pricer: UpIn + UpOut = vanilla for a 1Y EURUSD call (default T+2 delivery) and a 1W option with a 7-day delivery lag", () => {
    const check = (opt: FxOption, level: number) => {
      const vanilla = priceTrade(ctx, opt, "USD").pv;
      const upIn = priceTrade(ctx, { ...opt, barrier: { type: "UpIn", level } }, "USD").pv;
      const upOut = priceTrade(ctx, { ...opt, barrier: { type: "UpOut", level } }, "USD").pv;
      expect(Math.abs((upIn + upOut) / vanilla - 1)).toBeLessThan(1e-9);
      const dIn = priceTrade(ctx, { ...opt, barrier: { type: "DownIn", level: level - 0.15 } }, "USD").pv;
      const dOut = priceTrade(ctx, { ...opt, barrier: { type: "DownOut", level: level - 0.15 } }, "USD").pv;
      expect(Math.abs((dIn + dOut) / vanilla - 1)).toBeLessThan(1e-9);
      expect(vanilla).toBeGreaterThan(0);
    };
    check(makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") }), 1.25);
    const shortDated = makeFxOption({
      pair: "EURUSD",
      optionType: "Call",
      notional: 1e6,
      strike: 1.1625,
      expiryDate: parseISO("2026-09-10"),
      deliveryDate: parseISO("2026-09-17"),
    });
    expect(shortDated.deliveryDate - shortDated.expiryDate).toBe(7);
    check(shortDated, 1.19);
  });
});

describe("R2-2 – vega for embedded caps/floors (feature detection)", () => {
  const payer = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
  const floored: InterestRateSwap = {
    ...payer,
    id: "floored",
    legs: payer.legs.map((l) => (l.type === "Float" ? ({ ...l, floorRate: 0.02 } as FloatLeg) : l)),
  };
  const floor = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Floor", strike: 0.02, effectiveDate: spot, maturity: "5Y" });

  it("feature detection: swaps with capRate/floorRate count as optionality and use the leg's caplet surface", () => {
    expect(hasOptionality(payer)).toBe(false);
    expect(hasOptionality(floored)).toBe(true);
    expect(embeddedOptionLegs(floored)).toHaveLength(1);
    expect(capletSurfaceKeysFor(ctx, floored)).toEqual(["EUR-EURIBOR-6M"]);
    expect(capletSurfaceKeysFor(ctx, payer)).toEqual([]);
    expect(capletSurfaceKeysFor(ctx, floor)).toEqual(["EUR-EURIBOR-6M"]);
  });

  it("computeRisk vega ≠ 0, equals the standalone floor's vega within 1 % and matches a finite difference", () => {
    const riskSwap = computeRisk(ctx, floored, "EUR", { bucketed: false, theta: false });
    const riskFloor = computeRisk(ctx, floor, "EUR", { bucketed: false, theta: false });
    const v = riskSwap.vega["caplet:EUR-EURIBOR-6M"]!;
    expect(v).toBeGreaterThan(100);
    expect(Math.abs(v / riskFloor.vega["caplet:EUR-EURIBOR-6M"]! - 1)).toBeLessThan(0.01);
    // finite difference: ±0.5bp normal vol on the caplet surface
    const base = priceTrade(ctx, floored, "EUR").pv;
    const up = priceTrade(applyScenario(ctx, { id: "v", name: "v", irVolShiftBp: 0.5 }), floored, "EUR").pv;
    const dn = priceTrade(applyScenario(ctx, { id: "v", name: "v", irVolShiftBp: -0.5 }), floored, "EUR").pv;
    expect(Math.abs((up - dn) / v - 1)).toBeLessThan(0.005);
    expect(up).toBeGreaterThan(base);
    // plain swap: no vega
    expect(computeRisk(ctx, payer, "EUR", { bucketed: false, theta: false }).vega).toEqual({});
  });

  it("vegaBuckets report caplet-expiry buckets for the floored swap that sum to the parallel vega", () => {
    const reps = vegaBuckets(ctx, floored, "EUR");
    expect(reps).toHaveLength(1);
    expect(reps[0]!.kind).toBe("caplet");
    expect(reps[0]!.dimension).toBe("expiry");
    const parallel = computeRisk(ctx, floored, "EUR", { bucketed: false, theta: false }).vega["caplet:EUR-EURIBOR-6M"]!;
    expect(Math.abs(reps[0]!.total / parallel - 1)).toBeLessThan(0.005);
    expect(vegaBuckets(ctx, payer, "EUR")).toEqual([]);
  });
});

describe("R2-3 – IFRS 13 heuristic scoped to the curves and surfaces the trade uses", () => {
  it("tradeMaturityDate / tradeIndexNames / tradeCurveIds are type independent", () => {
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "12Y" });
    expect(tradeMaturityDate(swap)).toBe(swap.legs[0]!.terminationDate);
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "35Y" });
    expect(tradeMaturityDate(cap)).toBe(cap.terminationDate);
    const sw = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "10Y", tenor: "30Y", valuationDate: VAL });
    expect(tradeMaturityDate(sw)).toBe(sw.underlying.legs[0]!.terminationDate);
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.17, deliveryDate: parseISO("2027-09-07") });
    expect(tradeMaturityDate(fwd)).toBe(fwd.deliveryDate);
    expect(tradeIndexNames(swap)).toEqual(["EURIBOR-6M"]);
    expect(tradeIndexNames(fwd)).toEqual([]);
    // an EUR-collateralised EUR swap uses €STR + 6M projection, never the USD-CSA curve
    expect(tradeCurveIds(ctx, swap).sort()).toEqual(["EUR-ESTR", "EUR-EURIBOR-6M"]);
    expect(tradeCurveIds(ctx, { ...swap, collateralCurrency: "USD" }).sort()).toEqual(["EUR-ESTR-USDCSA", "EUR-EURIBOR-6M"]);
    expect(tradeCurveIds(ctx, fwd).sort()).toEqual(["EUR-ESTR", "USD-SOFR"]);
  });

  it("12Y and 25Y EUR swaps stay Level 2 despite the 10Y USD-CSA curve in the context; under USD CSA the 12Y swap extrapolates → Level 3", () => {
    for (const tenor of ["12Y", "25Y"]) {
      const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: tenor });
      const lvl = ifrs13Level(ctx, swap, priceTrade(ctx, swap, "EUR"));
      expect(lvl.level).toBe(2);
      expect(lvl.rationale).not.toContain("USDCSA");
    }
    const usdCsa = {
      ...makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "12Y" }),
      collateralCurrency: "USD",
    };
    const lvl = ifrs13Level(ctx, usdCsa, priceTrade(ctx, usdCsa, "EUR"));
    expect(lvl.level).toBe(3);
    expect(lvl.rationale).toContain("EUR-ESTR-USDCSA");
    // 35Y swap really extrapolates beyond the 30Y pillars → Level 3
    const long = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "35Y" });
    expect(ifrs13Level(ctx, long, priceTrade(ctx, long, "EUR")).level).toBe(3);
  });

  it("35Y cap and 10y30y swaption are Level 3 (curve and vol-surface extrapolation), a 5Y cap and 1y5y swaption Level 2, a 7Y FX option beyond the 5Y smile Level 3", () => {
    const cap35 = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "35Y" });
    const l35 = ifrs13Level(ctx, cap35, priceTrade(ctx, cap35, "EUR"));
    expect(l35.level).toBe(3);
    expect(l35.rationale).toMatch(/Caplet-Expiry|Kurve/);
    const cap5 = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
    expect(ifrs13Level(ctx, cap5, priceTrade(ctx, cap5, "EUR")).level).toBe(2);
    const sw = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "10Y", tenor: "30Y", valuationDate: VAL });
    const lsw = ifrs13Level(ctx, sw, priceTrade(ctx, sw, "EUR"));
    expect(lsw.level).toBe(3);
    expect(lsw.rationale).toContain("Fälligkeit");
    const sw15 = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "1Y", tenor: "5Y", valuationDate: VAL });
    expect(ifrs13Level(ctx, sw15, priceTrade(ctx, sw15, "EUR")).level).toBe(2);
    // swaption expiry beyond the last cube expiry (20Y) → Level 3 via the vol check, even though the curve reaches 30Y
    const sw25 = makeSwaption({ currency: "EUR", notional: 1e7, payerReceiver: "Payer", strike: 0.03, expiry: "25Y", tenor: "2Y", valuationDate: VAL });
    const l25 = ifrs13Level(ctx, sw25, priceTrade(ctx, sw25, "EUR"));
    expect(l25.level).toBe(3);
    expect(l25.rationale).toContain("Optionslaufzeit");
    const fx7 = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.2, expiryDate: parseISO("2033-09-03") });
    const lfx = ifrs13Level(ctx, fx7, priceTrade(ctx, fx7, "USD"));
    expect(lfx.level).toBe(3);
    expect(lfx.rationale).toContain("EURUSD-VOL");
    const fx1 = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.2, expiryDate: parseISO("2027-09-03") });
    expect(ifrs13Level(ctx, fx1, priceTrade(ctx, fx1, "USD")).level).toBe(2);
  });
});

describe("R2-6 – methodology text is generated from the valuation switches", () => {
  it("swap: curves actually used, interpolation/extrapolation, fixing policy, conventions; OIS leg: RFR conventions; embedded floor line", () => {
    const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });
    const m = methodologyFor(swap, ctx, priceTrade(ctx, swap, "EUR"));
    expect(m.some((l) => l.includes("EUR: EUR-ESTR") && l.includes("EURIBOR-6M: EUR-EURIBOR-6M"))).toBe(true);
    expect(m.some((l) => l.startsWith("Kurve EUR-ESTR") && l.includes("log-linear") && l.includes("flat-forward"))).toBe(true);
    expect(m.some((l) => l.startsWith("Fixings") && l.includes("Policy „curve“") && l.includes("kein fehlendes Fixing"))).toBe(true);
    expect(m.some((l) => l.includes("30E/360") && l.includes("TARGET"))).toBe(true);
    expect(m.some((l) => l.startsWith("IFRS-13-Einstufung"))).toBe(true);
    expect(m.some((l) => l.startsWith("Bewertungsrahmen: IFRS 13 / IDW RS HFA 35"))).toBe(true);
    // policy "throw" and a seasoned swap with missing fixings are reflected
    const seasoned = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.03,
      effectiveDate: parseISO("2021-03-16"),
      maturity: "10Y",
    });
    const ms = methodologyFor(seasoned, ctx, priceTrade(ctx, seasoned, "EUR"));
    expect(ms.some((l) => l.includes("1 fehlende(s) Fixing(s)"))).toBe(true);
    expect(methodologyFor(swap, { ...ctx, missingFixingPolicy: "throw" }, priceTrade(ctx, swap, "EUR")).some((l) => l.includes("Policy „throw“"))).toBe(true);
    // RFR leg
    const ois = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Pay",
      fixedRate: 0.021,
      effectiveDate: spot,
      maturity: "2Y",
      index: "ESTR",
    });
    const lb: InterestRateSwap = {
      ...ois,
      legs: ois.legs.map((l) => (l.type === "Float" ? ({ ...l, lookbackDays: 5, observationShift: true } as FloatLeg) : l)),
    };
    const mo = methodologyFor(lb, ctx, priceTrade(ctx, lb, "EUR"));
    expect(mo.some((l) => l.startsWith("RFR-Leg ESTR") && l.includes("Lookback 5") && l.includes("Observation Shift"))).toBe(true);
    // embedded floor
    const floored: InterestRateSwap = { ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? ({ ...l, floorRate: 0.02 } as FloatLeg) : l)) };
    const mf = methodologyFor(floored, ctx, priceTrade(ctx, floored, "EUR"));
    expect(mf.some((l) => l.startsWith("Eingebettete Option") && l.includes("Floor 2,00 %") && l.includes("Bachelier"))).toBe(true);
  });

  it("options: model, vol source, Greeks method and spot lag come from the pricing analytics", () => {
    const sw = makeSwaption({
      currency: "EUR",
      notional: 1e7,
      payerReceiver: "Payer",
      strike: 0.03,
      expiry: "2Y",
      tenor: "5Y",
      valuationDate: VAL,
      settlement: "Cash",
    });
    const ms = methodologyFor(sw, ctx, priceTrade(ctx, sw, "EUR"));
    expect(ms.some((l) => l.includes("Modell Bachelier") && l.includes("SABR") && l.includes("CollateralisedCashPrice") && l.includes("verwendete Vol"))).toBe(
      true,
    );
    const cap = makeCapFloor({ currency: "EUR", notional: 1e7, capFloor: "Cap", strike: 0.03, effectiveDate: spot, maturity: "5Y" });
    expect(
      methodologyFor({ ...cap, model: "Black", volOverride: 0.3 }, ctx, priceTrade(ctx, { ...cap, model: "Black", volOverride: 0.3 }, "EUR")).some(
        (l) => l.includes("Modell Black") && l.includes("Override-Vol"),
      ),
    ).toBe(true);
    const vanilla = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") });
    const mv = methodologyFor(vanilla, ctx, priceTrade(ctx, vanilla, "USD"));
    expect(mv.some((l) => l.includes("T+2") && l.includes("Delta-Konvention Forward") && l.includes("Greeks analytisch"))).toBe(true);
    const barrier = { ...vanilla, barrier: { type: "UpOut" as const, level: 1.25 } };
    const mb = methodologyFor(barrier, ctx, priceTrade(ctx, barrier, "USD"));
    expect(mb.some((l) => l.includes("Reiner-Rubinstein") && l.includes("finiten Differenzen") && l.includes("Lieferdatum"))).toBe(true);
    const cad = makeFxForward({ pair: "USDCAD", baseAmount: 1e6, rate: 1.35, deliveryDate: parseISO("2027-09-07") });
    const cadCtx = {
      ...ctx,
      curves: { ...ctx.curves, "CAD-CORRA": ctx.curves["USD-SOFR"]! },
      discountCurveId: { ...ctx.discountCurveId, CAD: "CAD-CORRA" },
      fxSpots: { ...ctx.fxSpots, USDCAD: 1.36 },
    };
    expect(methodologyFor(cad, cadCtx, priceTrade(cadCtx, cad, "CAD")).some((l) => l.includes("USDCAD: T+1"))).toBe(true);
    // static fallback still works without market/pricing
    expect(methodologyFor(vanilla).length).toBeGreaterThan(3);
    // risk / xva lines
    const risk = computeRisk(ctx, vanilla, "USD", { bucketed: false });
    expect(methodologyFor(vanilla, ctx, priceTrade(ctx, vanilla, "USD"), { risk }).some((l) => l.includes("Constant-Curve-Roll") && l.includes("Carry"))).toBe(
      true,
    );
  });
});

describe("N8 – cost transparency perspective (review example: bank long FX call worth 33.572 pays 20.000)", () => {
  it("Bank perspective: bank margin +13.572 / client initial market value −13.572; Kunde perspective flips the signs", () => {
    const call = makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") });
    const pr = priceTrade(ctx, call, "USD");
    expect(pr.pv).toBeGreaterThan(30_000);
    const bank = buildValuationReport(ctx, call, pr, { transactionPrice: 20_000 });
    const c = bank.costTransparency!;
    expect(c.perspective).toBe("Bank");
    expect(c.bankMargin).toBeCloseTo(pr.pv - 20_000, 6);
    expect(c.initialMarketValue).toBeCloseTo(-(pr.pv - 20_000), 6);
    expect(c.marginBp).toBeCloseTo(((pr.pv - 20_000) / 1e6) * 1e4, 6);
    expect(c.marginPct).toBeCloseTo(((pr.pv - 20_000) / 1e6) * 100, 6);
    expect(c.signRule).toContain("Perspektive Bank");
    const client = buildValuationReport(ctx, call, pr, { transactionPrice: 20_000, perspective: "Kunde" });
    expect(client.costTransparency!.bankMargin).toBeCloseTo(-(pr.pv - 20_000), 6);
    expect(client.costTransparency!.initialMarketValue).toBeCloseTo(pr.pv - 20_000, 6);
    expect(client.costTransparency!.signRule).toContain("Perspektive Kunde");
    expect(client.methodology.some((m) => m.includes("Perspektive Kunde"))).toBe(true);
    // without a transaction price there is no cost block and no cost line in the methodology
    const none = buildValuationReport(ctx, call, pr);
    expect(none.costTransparency).toBeUndefined();
    expect(none.methodology.some((m) => m.startsWith("Kostentransparenz"))).toBe(false);
  });
});

describe("R2-5 – ACT/ACT ICMA on a leg with EOM roll", () => {
  it("a long back stub on an EOM schedule rolls the notional periods with the EOM rule (leg.endOfMonth)", () => {
    // Quarterly EOM schedule 2026-11-30 → 2027-04-30 with a long back stub: reference period 2026-11-30 → 2027-02-28,
    // notional period 2027-02-28 → 2027-05-31 (EOM) instead of → 2027-05-28.
    const s = parseISO("2026-11-30");
    const e = parseISO("2027-04-30");
    const withEom = yearFraction(parseISO("2026-11-30"), e, "ACT/ACT ICMA", { frequency: 4, refStart: s, refEnd: parseISO("2027-02-28"), endOfMonth: true });
    const withoutEom = yearFraction(parseISO("2026-11-30"), e, "ACT/ACT ICMA", {
      frequency: 4,
      refStart: s,
      refEnd: parseISO("2027-02-28"),
      endOfMonth: false,
    });
    expect(withEom).toBeCloseTo(0.25 + (0.25 * 61) / 92, 12);
    expect(withoutEom).toBeCloseTo(0.25 + (0.25 * 61) / 89, 12);
    expect(withEom).toBeLessThan(withoutEom);
  });
});
