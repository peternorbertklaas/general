import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InterpolatedCurve, flatCurve } from "../curves/curve.js";
import { advance, getCalendar } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { PricingError, isPricingError } from "../errors.js";
import { formatDateTimeDe, formatDe, formatPctDe } from "../format.js";
import { makeFxForward, makeFxOption, makeVanillaSwap } from "../instruments/builders.js";
import { type FixedLeg, type FloatLeg, type InterestRateSwap, type Trade } from "../instruments/types.js";
import { buildSampleMarket } from "../market/sample-market.js";
import { pricePortfolio, priceTrade, validateTrade } from "../pricing/price.js";
import { PACKAGE_VERSION } from "../version.js";
import { generateSuitabilityStatement } from "./documents.js";
import { ENGINE_VERSION, buildValuationReport, csvCell, toCsv } from "./valuation-report.js";

const VAL = parseISO("2026-09-03");
const ctx = buildSampleMarket(VAL);
const spot = advance(VAL, "2D", getCalendar("TARGET"));
const swap = makeVanillaSwap({ id: "IRS-G", currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.03, effectiveDate: spot, maturity: "5Y" });

describe("N-01 – deterministic report hash", () => {
  it("two independent valuations of the same inputs give the same reportHash although timingMs differs", () => {
    const p1 = priceTrade(ctx, swap, "EUR");
    const p2 = { ...priceTrade(ctx, swap, "EUR"), timingMs: (p1.timingMs ?? 0) + 12.345 };
    const r1 = buildValuationReport(ctx, swap, p1, { generatedAt: "2026-09-03T18:00:00Z" });
    const r2 = buildValuationReport(ctx, swap, p2, { generatedAt: "2026-09-03T19:00:00Z" });
    expect(r1.audit.reportHash).toBe(r2.audit.reportHash);
    expect(r1.audit.inputsHash).toBe(r2.audit.inputsHash);
    expect(r1.audit.snapshotId).toBe(r2.audit.snapshotId);
    // a different transaction price changes the content → different hash is not expected (cost block is outside the hash), but a different trade is
    const other = { ...swap, id: "IRS-G2" };
    expect(buildValuationReport(ctx, other, priceTrade(ctx, other, "EUR")).audit.reportHash).not.toBe(r1.audit.reportHash);
  });
});

describe("F-01 / N-06 – PricingError with codes", () => {
  it("a fixed leg without rate / a float leg without index → INVALID_TRADE listing the problems", () => {
    const noRate: InterestRateSwap = { ...swap, legs: swap.legs.map((l) => (l.type === "Fixed" ? ({ ...l, rate: undefined } as unknown as FixedLeg) : l)) };
    expect(validateTrade(noRate)).toEqual([expect.stringContaining("legs[0].rate")]);
    let err: unknown;
    try {
      priceTrade(ctx, noRate, "EUR");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PricingError);
    expect((err as PricingError).code).toBe("INVALID_TRADE");
    expect(isPricingError(err)).toBe(true);
    expect((err as PricingError).details?.problems).toEqual([expect.stringContaining("rate")]);
    const noIndex: InterestRateSwap = { ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? ({ ...l, index: undefined } as unknown as FloatLeg) : l)) };
    expect(() => priceTrade(ctx, noIndex, "EUR")).toThrow(/INVALID_TRADE|index/);
    expect(validateTrade({ ...swap, legs: [] })).toEqual([expect.stringContaining("non-empty")]);
    expect(validateTrade({ type: "Bond" } as unknown as Trade)).toEqual([expect.stringContaining("id"), expect.stringContaining("not supported")]);
    expect(validateTrade(swap)).toEqual([]);
    // portfolio pricing reports the code instead of crashing
    const pf = pricePortfolio(ctx, [swap, noRate], "EUR");
    expect(Number.isFinite(pf.results[0]!.pv)).toBe(true);
    expect(pf.results[1]!.warnings[0]).toMatch(/^Pricing failed: INVALID_TRADE:/);
  });

  it("market lookups raise coded errors and a non-finite PV is rejected", () => {
    const fwd = makeFxForward({ pair: "EURUSD", baseAmount: 1e6, rate: 1.17, deliveryDate: parseISO("2027-09-07") });
    const noUsd = { ...ctx, discountCurveId: { EUR: "EUR-ESTR" } };
    let err: unknown;
    try {
      priceTrade(noUsd, fwd, "USD");
    } catch (e) {
      err = e;
    }
    expect((err as PricingError).code).toBe("NO_DISCOUNT_CURVE");
    const badSpot = { ...ctx, fxSpots: { ...ctx.fxSpots, EURUSD: Number.NaN } };
    try {
      priceTrade(badSpot, fwd, "USD");
    } catch (e) {
      err = e;
    }
    expect((err as PricingError).code).toBe("NON_FINITE_PV");
    const noSpot = { ...ctx, fxSpots: {} };
    try {
      priceTrade(noSpot, fwd, "USD");
    } catch (e) {
      err = e;
    }
    expect((err as PricingError).code).toBe("NO_FX_SPOT");
    // unknown index / calendar / curve
    const badIdx: InterestRateSwap = { ...swap, legs: swap.legs.map((l) => (l.type === "Float" ? ({ ...l, index: "LIBOR-6M" } as FloatLeg) : l)) };
    try {
      priceTrade(ctx, badIdx, "EUR");
    } catch (e) {
      err = e;
    }
    expect((err as PricingError).code).toBe("UNKNOWN_INDEX");
    expect(() => getCalendar("MARS")).toThrow(PricingError);
    // missing fixing under policy "throw" keeps its code
    const seasoned = makeVanillaSwap({
      currency: "EUR",
      notional: 1e7,
      payReceiveFixed: "Receive",
      fixedRate: 0.03,
      effectiveDate: parseISO("2021-03-16"),
      maturity: "10Y",
    });
    try {
      priceTrade({ ...ctx, missingFixingPolicy: "throw" }, seasoned, "EUR");
    } catch (e) {
      err = e;
    }
    expect((err as PricingError).code).toBe("MISSING_FIXING");
  });
});

describe("N-13 – CSV formula injection guard", () => {
  it("non-numeric cells starting with = + - @ tab CR are prefixed with an apostrophe; numbers are untouched", () => {
    expect(csvCell('=HYPERLINK("x")', ";", false)).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+cmd", ";", false)).toBe("'+cmd");
    expect(csvCell("-abc", ";", false)).toBe("'-abc");
    expect(csvCell("@SUM", ";", false)).toBe("'@SUM");
    expect(csvCell("\tx", ";", false)).toBe("'\tx");
    expect(csvCell("-12.5", ";", true)).toBe("-12,5");
    expect(csvCell("-12.5%", ";", true)).toBe("-12,5%");
    expect(csvCell("3.25", ";", false)).toBe("3.25");
    expect(csvCell("Trade A", ";", false)).toBe("Trade A");
    expect(toCsv([["=1+1", "2"]], { sep: ";" })).toBe("'=1+1;2");
  });
});

describe("N-19 – engine version from package.json", () => {
  it("ENGINE_VERSION ends with the package version", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string; name: string };
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(ENGINE_VERSION.endsWith(pkg.version)).toBe(true);
    expect(ENGINE_VERSION).toBe(`deriva-pricing-core/${pkg.version}`);
    expect(buildValuationReport(ctx, swap, priceTrade(ctx, swap, "EUR")).audit.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("F-14 / F-15 – curve shift units and JSON round trip", () => {
  it("shiftedNode / shiftedParallel take decimal shifts (1e-4 = 1bp)", () => {
    const c = ctx.curves["EUR-ESTR"]!;
    const d = c.nodeDates[5]!;
    expect((c.shiftedNode(5, 1e-4).zeroRate(d) - c.zeroRate(d)) * 1e4).toBeCloseTo(1, 8);
    expect((c.shiftedParallel(1e-4).zeroRate(d) - c.zeroRate(d)) * 1e4).toBeCloseTo(1, 8);
    expect(c.shiftedNode(5, 1e-4).zeroRate(c.nodeDates[2]!)).toBeCloseTo(c.zeroRate(c.nodeDates[2]!), 12);
  });
  it("toJSON uses ISO dates and fromJSON rebuilds an identical curve", () => {
    const c = ctx.curves["EUR-EURIBOR-6M"]! as InterpolatedCurve;
    const json = JSON.parse(JSON.stringify(c)) as ReturnType<InterpolatedCurve["toJSON"]>;
    expect(json.referenceDate).toBe("2026-09-03");
    expect(typeof json.nodes[0]!.date).toBe("string");
    const back = InterpolatedCurve.fromJSON(json);
    expect(back.id).toBe(c.id);
    expect(back.interpolation).toBe(c.interpolation);
    expect(back.extrapolation).toBe(c.extrapolation);
    expect(back.meta).toEqual(c.meta);
    for (const d of [VAL + 100, VAL + 1000, VAL + 5000, VAL + 15000]) expect(back.df(d)).toBeCloseTo(c.df(d), 14);
    // legacy serial-date input is accepted too
    const legacy = InterpolatedCurve.fromJSON({ ...json, referenceDate: VAL, nodes: json.nodes.map((n) => ({ date: parseISO(n.date as string), df: n.df })) });
    expect(legacy.df(VAL + 3000)).toBeCloseTo(c.df(VAL + 3000), 14);
    const flat = flatCurve("F", "EUR", VAL, 0.02);
    expect(toISO(parseISO(flat.toJSON().referenceDate as string))).toBe("2026-09-03");
  });
});

describe("F-26 – deterministic German formatting without Intl", () => {
  it("formatDe / formatPctDe / formatDateTimeDe", () => {
    expect(formatDe(1234567.891, 2)).toBe("1.234.567,89");
    expect(formatDe(-1234.5, 1)).toBe("-1.234,5");
    expect(formatDe(999, 0)).toBe("999");
    expect(formatDe(1000, 0)).toBe("1.000");
    expect(formatDe(0.004, 2)).toBe("0,00");
    expect(formatDe(-0.004, 2)).toBe("0,00");
    expect(formatDe(Number.NaN, 2)).toBe("n/a");
    expect(formatPctDe(0.0312, 2)).toBe("3,12 %");
    expect(formatDateTimeDe("2026-09-03T18:05:00Z")).toBe("03.09.2026, 18:05 UTC");
    expect(formatDateTimeDe("nonsense")).toBe("nonsense");
    // builders use it for names (German display form, decimal comma)
    expect(makeFxOption({ pair: "EURUSD", optionType: "Call", notional: 1e6, strike: 1.18, expiryDate: parseISO("2027-09-03") }).name).toBe(
      "Call EUR/USD 1.000.000 @ 1,1800",
    );
  });
});

describe("N-18 / N-20 – governance block and structured suitability costs", () => {
  it("governance defaults to an indicative snapshot with the market source and the engine version; overrides are honoured and reflected in the methodology", () => {
    const p = priceTrade(ctx, swap, "EUR");
    const rep = buildValuationReport(ctx, swap, p);
    expect(rep.governance).toEqual({
      snapshotStatus: "indicative",
      inputSources: ["DERIVA sample market (indicative)"],
      modelVersion: ENGINE_VERSION,
      validatedBy: undefined,
    });
    expect(rep.methodology.some((m) => m.startsWith("Bewertungsrahmen: IFRS 13 / IDW RS HFA 35") && m.includes("Income Approach"))).toBe(true);
    expect(rep.methodology.some((m) => m.startsWith("Bewertungs-Governance") && m.includes("indikativ") && m.includes("keine prüfungsfähige Bewertung"))).toBe(
      true,
    );
    const approved = buildValuationReport(ctx, swap, p, {
      governance: { snapshotStatus: "approved", inputSources: ["ECB €STR", "EMMI EURIBOR", "Refinitiv"], validatedBy: "Marktfolge / Modellvalidierung" },
    });
    expect(approved.governance.snapshotStatus).toBe("approved");
    expect(approved.governance.validatedBy).toBe("Marktfolge / Modellvalidierung");
    expect(approved.governance.inputSources).toHaveLength(3);
    expect(approved.methodology.some((m) => m.includes("freigegeben") && m.includes("Refinitiv") && m.includes("Marktfolge"))).toBe(true);
    // governance is part of the hashed content
    expect(approved.audit.reportHash).not.toBe(rep.audit.reportHash);
  });
  it("suitability statement: structured costs, target market, margin in amount, bp and %", () => {
    const p = priceTrade(ctx, swap, "EUR");
    const rep = buildValuationReport(ctx, swap, p, { transactionPrice: 10_000, perspective: "Kunde" });
    const base = {
      clientName: "Muster GmbH",
      clientClassification: "Professioneller Kunde" as const,
      hedgingPurpose: "Zinssicherung",
      knowledgeExperience: "gut",
      financialSituation: "solide",
      riskTolerance: "mittel" as const,
      investmentHorizonYears: 5,
      advisorName: "A. B.",
      transactionPrice: 10_000,
    };
    const doc = generateSuitabilityStatement(ctx, swap, p, rep, base);
    const rows = doc.sections.find((s) => s.heading.startsWith("Kostenausweis"))!.rows!;
    const row = (k: string) => rows.find((r) => r[0] === k)![1];
    expect(row("Laufende Kosten")).toContain("keine");
    expect(row("Zielmarkt (MiFID II Product Governance)")).toContain("Professioneller Kunde");
    expect(row("Darin enthaltene Marge der Bank")).toMatch(/bp bzw\. .* % des Nominals/);
    expect(row("Darin enthaltene Marge der Bank")).toContain("des Transaktionspreises");
    expect(row("Anfänglicher Marktwert aus Kundensicht")).toContain("% des Nominals");
    const custom = generateSuitabilityStatement(ctx, swap, p, rep, {
      ...base,
      costs: { ongoing: "0,10 % p. a. Betreuung", exitPolicy: "Marktwert ohne Spanne" },
      targetMarket: "Nur Firmenkunden mit Kreditgrundgeschäft",
    });
    const rows2 = custom.sections.find((s) => s.heading.startsWith("Kostenausweis"))!.rows!;
    expect(rows2.find((r) => r[0] === "Laufende Kosten")![1]).toBe("0,10 % p. a. Betreuung");
    expect(rows2.find((r) => r[0] === "Kosten bei vorzeitiger Auflösung")![1]).toBe("Marktwert ohne Spanne");
    expect(rows2.find((r) => r[0].startsWith("Zielmarkt"))![1]).toBe("Nur Firmenkunden mit Kreditgrundgeschäft");
    expect(custom.markdown).toContain("Art. 50 Abs. 2 DelVO 2017/565");
    expect(custom.markdown).toMatch(/Erstellt: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} UTC/);
  });
});
