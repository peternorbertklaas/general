/**
 * Round-3 review findings (docs/quality/review-architektur-r3.md):
 * N3-01 compute bounds, N3-02 OpenAPI 3.1 with named components and
 * discriminator mappings, N3-03 typed snapshot time, N3-07 optional/required
 * If-Match (428), N3-09 clearing obligation as its own field, and the CSV
 * import of the market review (N16).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { buildApp, openApiTransform } from "./app.js";
import { CSV_TEMPLATES, CSV_TRADE_TYPES, csvTemplateText, csvToTrades, parseCsvDate, parseCsvNumber } from "./lib/csv-import.js";
import { classifyError } from "./lib/errors.js";
import { assertBudget, assertTradeWithinLimits, defaultLimits, estimateLegPeriods, tradeLegPeriods } from "./lib/limits.js";
import { FREQUENCY_PATTERN, TRADE_TYPES } from "./schemas.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const leg = (type: "Fixed" | "Float", frequency: string, years: number, extra: Record<string, unknown>) => ({
  type,
  payReceive: type === "Fixed" ? "Pay" : "Receive",
  notional: 1e7,
  currency: "EUR",
  effectiveDate: "2026-09-07",
  terminationDate: `${2026 + years}-09-07`,
  frequency,
  dayCount: type === "Fixed" ? "30E/360" : "ACT/360",
  calendar: "TARGET",
  ...extra,
});
const swap = (frequency: string, years: number, id = "big") => ({
  id,
  type: "InterestRateSwap",
  legs: [leg("Fixed", frequency, years, { rate: 0.026 }), leg("Float", frequency, years, { index: "EURIBOR-6M" })],
});
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, payload: payload as never, headers });

describe("N3-01 compute bounds", () => {
  it("estimates coupon periods per leg and per trade", () => {
    expect(estimateLegPeriods({ effectiveDate: "2026-09-07", terminationDate: "2036-09-07", frequency: "6M" })).toBe(20);
    expect(estimateLegPeriods({ effectiveDate: "2026-09-07", terminationDate: "2126-09-07", frequency: "1D" })).toBeGreaterThan(36_000);
    expect(estimateLegPeriods({ effectiveDate: "2026-09-07", terminationDate: "2036-09-07", frequency: "ZC" })).toBe(10);
    expect(estimateLegPeriods({ effectiveDate: "2026-09-07", terminationDate: "2026-09-08", frequency: "1Y" })).toBe(1);
    expect(estimateLegPeriods({ effectiveDate: "2036-09-07", terminationDate: "2026-09-07", frequency: "6M" })).toBe(0);
    expect(estimateLegPeriods({ effectiveDate: "2026-09-07", terminationDate: "2036-09-07", frequency: "0M" })).toBe(0);
    expect(estimateLegPeriods({ effectiveDate: "nope", terminationDate: "2036-09-07", frequency: "6M" })).toBe(0);
    expect(tradeLegPeriods(swap("1Y", 10))).toEqual([10, 10]);
    expect(tradeLegPeriods({ type: "Swaption", underlying: swap("6M", 5) })).toEqual([10, 10]);
    expect(tradeLegPeriods({ type: "CapFloor", effectiveDate: "2026-09-07", terminationDate: "2031-09-07", frequency: "3M" })).toEqual([20]);
    expect(tradeLegPeriods({ type: "FxSwap" })).toEqual([1, 1]);
    expect(tradeLegPeriods({ type: "FRA" })).toEqual([1]);
    expect(tradeLegPeriods(null)).toEqual([]);
    const limits = defaultLimits();
    expect(limits).toEqual({ maxPeriodsPerLeg: 1200, maxPeriodsPerRequest: 20_000, maxWeightedPeriodsPerRequest: 500_000, maxStorePeriods: 200_000 });
    expect(assertTradeWithinLimits(swap("1M", 50), limits)).toBe(1200);
    expect(() => assertTradeWithinLimits(swap("1D", 100), limits)).toThrow(/TOO_MANY_PERIODS|coupon periods exceed/);
    expect(() => assertBudget(20_001, 1, 100, limits)).toThrow(/budget/);
    expect(() => assertBudget(10_000, 51, 100, limits)).toThrow(/budget/);
    expect(() => assertBudget(20_000, 25, 100, limits)).not.toThrow();
    process.env.MAX_PERIODS_PER_LEG = "12";
    expect(defaultLimits().maxPeriodsPerLeg).toBe(12);
    process.env.MAX_PERIODS_PER_LEG = "-3";
    expect(defaultLimits().maxPeriodsPerLeg).toBe(1200);
    delete process.env.MAX_PERIODS_PER_LEG;
  });

  it("rejects a 1D × 100Y swap with 400 TOO_MANY_PERIODS before any schedule is built, on every pricing route", async () => {
    // Warm-up request so the timing below does not include route/JIT initialisation.
    await post("/api/price", { trade: swap("1D", 100) });
    const t0 = performance.now();
    const r = await post("/api/price", { trade: swap("1D", 100) });
    const ms = performance.now() - t0;
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ statusCode: 400, code: "TOO_MANY_PERIODS", details: { tradeId: "big", legIndex: 0, maxPeriodsPerLeg: 1200 } });
    expect(r.json().details.periods).toBeGreaterThan(36_000);
    // Pricing the same trade would take ≈ 500 ms and 23 MB; the guard must answer in a small fraction of that
    // (generous bound so parallel test workers do not make this flaky).
    expect(ms).toBeLessThan(250);
    for (const url of ["/api/risk", "/api/xva", "/api/report", "/api/risk/par", "/api/risk/vega", "/api/documents/termsheet"]) {
      const extra = url === "/api/xva" ? { credit: { cptyHazard: 0.02, cptyRecovery: 0.4 } } : url === "/api/risk" ? { bucketed: true } : {};
      const res = await post(url, { trade: swap("1D", 100), ...extra });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().code, url).toBe("TOO_MANY_PERIODS");
    }
    for (const url of [
      "/api/price/portfolio",
      "/api/scenarios",
      "/api/scenarios/grid",
      "/api/report/portfolio",
      "/api/risk/par/portfolio",
      "/api/trades/import",
    ]) {
      const res = await post(url, { trades: [swap("1D", 100)] });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().code, url).toBe("TOO_MANY_PERIODS");
    }
    expect((await post("/api/trades", swap("1D", 100))).json().code).toBe("TOO_MANY_PERIODS");
    expect((await app.inject({ method: "PUT", url: "/api/trades/IRS-0001", payload: swap("1D", 100, "IRS-0001") })).json().code).toBe("TOO_MANY_PERIODS");
    const tpl = await post("/api/trades/from-template", {
      template: "CrossCurrencySwap",
      params: { pair: "EURUSD", domesticNotional: 1e7, fxSpot: 1.17, spread: 0, effectiveDate: "2026-09-07", tenor: "999Y", frequency: "1W" },
    });
    expect(tpl.statusCode).toBe(400);
    expect(tpl.json().code).toBe("TOO_MANY_PERIODS");
    // Nothing was stored.
    expect((await app.inject({ method: "GET", url: "/api/trades/big" })).statusCode).toBe(404);
    // Within the bound (50 years monthly = 600 periods per leg) prices fine.
    expect((await post("/api/price", { trade: swap("1M", 50) })).statusCode).toBe(200);
  });

  it("enforces the request budget (413 PERIOD_BUDGET_EXCEEDED) on portfolios, scenarios, grids and store fallbacks", async () => {
    const many = Array.from({ length: 30 }, (_, i) => swap("1W", 20, `w${i}`)); // 30 × 2 × 1044 ≈ 62 640 periods
    const r = await post("/api/price/portfolio", { trades: many });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ statusCode: 413, code: "PERIOD_BUDGET_EXCEEDED", details: { trades: 30, maxPeriodsPerRequest: 20_000 } });
    // Fan-out routes weigh the periods by the number of valuations (grid cells).
    const ten = many.slice(0, 10); // ≈ 20 880 periods → 413 already on the plain budget
    expect((await post("/api/scenarios/grid", { trades: ten })).statusCode).toBe(413);
    const few = many.slice(0, 5); // ≈ 10 440 periods
    expect((await post("/api/price/portfolio", { trades: few })).statusCode).toBe(200);
    const grid = await post("/api/scenarios/grid", {
      trades: few,
      ratesBp: Array.from({ length: 41 }, (_, i) => i),
      fxPct: Array.from({ length: 41 }, (_, i) => i),
    });
    expect(grid.statusCode).toBe(413);
    expect(grid.json().details.weight).toBe(1681);
    expect((await post("/api/scenarios/grid", { trades: few, ratesBp: [0], fxPct: [0] })).statusCode).toBe(200);
    // A tiny budget makes the store fallback (no `trades` in the body) trip as well; the sample book itself passes the defaults.
    const tiny = await buildApp({ logger: false, limits: { maxPeriodsPerRequest: 10 } });
    expect((await tiny.inject({ method: "POST", url: "/api/scenarios", payload: {} })).statusCode).toBe(413);
    expect((await tiny.inject({ method: "POST", url: "/api/report/portfolio", payload: {} })).statusCode).toBe(413);
    // Since R4 (N4-01) the GET valuation routes price the store under the same budget.
    expect((await tiny.inject({ method: "GET", url: "/api/trades?price=1" })).statusCode).toBe(413);
    expect((await tiny.inject({ method: "GET", url: "/api/trades" })).statusCode).toBe(200);
    await tiny.close();
    expect((await post("/api/scenarios", {})).statusCode).toBe(200);
    // The document advertises the budget.
    const doc = app.swagger() as { info: { description: string } };
    expect(doc.info.description).toContain("TOO_MANY_PERIODS");
    expect(doc.info.description).toContain("PERIOD_BUDGET_EXCEEDED");
  });

  it("frequency pattern: upper-case tenor with non-zero count or ZC", async () => {
    const re = new RegExp(FREQUENCY_PATTERN);
    for (const ok of ["1D", "1W", "1M", "3M", "6M", "12M", "1Y", "ZC", "999Y"]) expect(re.test(ok), ok).toBe(true);
    for (const bad of ["0M", "1m", "6m", "1T", "M", "ONCE", "1000Y", " 1M"]) expect(re.test(bad), bad).toBe(false);
    expect((await post("/api/price", { trade: swap("0M", 5) })).statusCode).toBe(400);
    expect((await post("/api/price", { trade: swap("6m", 5) })).statusCode).toBe(400);
    const zc = swap("ZC", 2);
    expect((await post("/api/price", { trade: zc })).statusCode).toBe(200);
  });

  it("error classifier keeps application codes on status errors but hides library codes", () => {
    expect(classifyError(Object.assign(new Error("x"), { statusCode: 413, code: "PERIOD_BUDGET_EXCEEDED", details: { periods: 1 } }))).toMatchObject({
      status: 413,
      code: "PERIOD_BUDGET_EXCEEDED",
      details: { periods: 1 },
    });
    // Library codes never leave the process; since R5 (N5-01) the envelope carries the catalogued code of the status instead.
    const fst = classifyError(Object.assign(new Error("too large"), { statusCode: 413, code: "FST_ERR_CTP_BODY_TOO_LARGE" }));
    expect(fst.status).toBe(413);
    expect(fst.code).toBe("PAYLOAD_TOO_LARGE");
    expect(fst.details).toBeUndefined();
    // A 5xx never leaks its internal code; since R4 (N4-05) the envelope carries the catalogued INTERNAL_ERROR instead.
    expect(classifyError(Object.assign(new Error("boom"), { statusCode: 500, code: "SOMETHING" })).code).toBe("INTERNAL_ERROR");
  });
});

describe("N3-02 OpenAPI 3.1 contract with named components", () => {
  type Doc = {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, { discriminator?: { propertyName: string; mapping?: Record<string, string> }; oneOf?: { $ref?: string }[] }> };
  };
  const collectRefs = (node: unknown, out: Set<string>): void => {
    if (Array.isArray(node)) return node.forEach((n) => collectRefs(n, out));
    if (node && typeof node === "object") {
      const r = (node as { $ref?: unknown }).$ref;
      if (typeof r === "string") out.add(r);
      for (const v of Object.values(node as Record<string, unknown>)) collectRefs(v, out);
    }
  };

  it("declares 3.1.0, names every component after its $id and resolves every $ref locally", () => {
    const doc = app.swagger() as unknown as Doc;
    expect(doc.openapi).toBe("3.1.0");
    const names = Object.keys(doc.components.schemas);
    expect(names).toEqual(
      expect.arrayContaining([
        "Trade",
        "MarketSnapshot",
        "ErrorResponse",
        "SwapLeg",
        "FixedLeg",
        "FloatLeg",
        ...TRADE_TYPES,
        "FromTemplateCrossCurrencySwap",
        "FromTemplateFra",
      ]),
    );
    expect(names.some((n) => /^def-\d+$/.test(n))).toBe(false);
    const refs = new Set<string>();
    collectRefs(doc, refs);
    expect(refs.size).toBeGreaterThan(10);
    for (const ref of refs) {
      expect(ref, ref).toMatch(/^#\/components\/schemas\/[A-Za-z]+$/);
      expect(names, ref).toContain(ref.replace("#/components/schemas/", ""));
    }
    // No dangling Fastify-style refs ("Trade#") survive the resolution.
    expect(JSON.stringify(doc)).not.toMatch(/"\$ref":"[A-Za-z]+#"/);
  });

  it("carries discriminator.mapping on every discriminated union (trade, leg, template body)", () => {
    const doc = app.swagger() as unknown as Doc;
    const trade = doc.components.schemas.Trade!;
    expect(trade.discriminator?.propertyName).toBe("type");
    expect(trade.discriminator?.mapping).toEqual(Object.fromEntries(TRADE_TYPES.map((t) => [t, `#/components/schemas/${t}`])));
    expect(trade.oneOf?.map((b) => b.$ref)).toEqual(TRADE_TYPES.map((t) => `#/components/schemas/${t}`));
    expect(doc.components.schemas.SwapLeg!.discriminator?.mapping).toEqual({ Fixed: "#/components/schemas/FixedLeg", Float: "#/components/schemas/FloatLeg" });
    const body = (
      doc.paths["/api/trades/from-template"]!.post as { requestBody: { content: Record<string, { schema: Doc["components"]["schemas"][string] }> } }
    ).requestBody.content["application/json"]!.schema;
    expect(body.discriminator?.mapping).toEqual({
      CrossCurrencySwap: "#/components/schemas/FromTemplateCrossCurrencySwap",
      FRA: "#/components/schemas/FromTemplateFra",
    });
    // Nested references stay named: swaption underlying and legs.
    const json = JSON.stringify(doc.components.schemas);
    expect(json).toContain('"underlying":{"$ref":"#/components/schemas/InterestRateSwap"}');
    expect(json).toContain('"items":{"$ref":"#/components/schemas/SwapLeg"}');
    // The transform only maps unions whose branches all resolve to a single tag value.
    const partial = openApiTransform({
      components: { schemas: { A: { properties: { k: { enum: ["a"] } } }, B: { properties: { k: { enum: ["b", "c"] } } } } },
      x: { discriminator: { propertyName: "k" }, oneOf: [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }] },
    } as never) as { x: { discriminator: { mapping?: unknown } } };
    expect(partial.x.discriminator.mapping).toBeUndefined();
  });

  it("validation still works through the referenced variants (discriminator over $ref)", async () => {
    expect((await post("/api/price", { trade: { ...swap("1Y", 5), legs: [{ ...swap("1Y", 5).legs[0], type: "Weird" }] } })).statusCode).toBe(400);
    const noRate = swap("1Y", 5);
    delete (noRate.legs[0] as Record<string, unknown>).rate;
    const r = await post("/api/price", { trade: noRate });
    expect(r.statusCode).toBe(400);
    expect(String(r.json().error)).toMatch(/rate/);
    expect((await post("/api/price", { trade: { id: "x", type: "Nope" } })).statusCode).toBe(400);
    const sw = (await app.inject({ method: "GET", url: "/api/trades/SWPT-0001" })).json().trade;
    expect((await post("/api/price", { trade: { ...sw, underlying: { ...sw.underlying, legs: [{ type: "Fixed" }] } } })).statusCode).toBe(400);
    expect((await post("/api/price", { trade: sw })).statusCode).toBe(200);
  });
});

describe("N3-03 typed snapshot time and EMIR timestamps", () => {
  it("rejects a free-text meta.snapshotTime on import and accepts an ISO date-time", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    const bad = await app2.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: { ...snap, meta: { ...snap.meta, snapshotTime: "gestern irgendwann" } },
    });
    expect(bad.statusCode).toBe(400);
    expect(String(bad.json().error)).toMatch(/snapshotTime/);
    expect(
      (await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, meta: { ...snap.meta, snapshotTime: "2026-09-03" } } })).statusCode,
    ).toBe(400);
    const ok = await app2.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: { ...snap, meta: { ...snap.meta, snapshotTime: "2026-09-03T16:30:00Z" } },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const doc = app2.swagger() as unknown as {
      components: { schemas: { MarketSnapshot: { properties: { meta: { properties: { snapshotTime: { format?: string; pattern?: string } } } } } } };
    };
    expect(doc.components.schemas.MarketSnapshot.properties.meta.properties.snapshotTime).toMatchObject({
      format: "date-time",
      pattern: expect.stringContaining("T"),
    });
    await app2.close();
    // Query timestamps were already patterned; keep it that way.
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?asOf=heute" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?timestamp=2026-09-03T17:00" })).statusCode).toBe(400);
  });
});

describe("N3-07 If-Match: optional by default, 428 with REQUIRE_IF_MATCH", () => {
  it("returns 428 PRECONDITION_REQUIRED without If-Match when required, 412 on a mismatch, 200/204 with a matching or wildcard ETag", async () => {
    const strict = await buildApp({ logger: false, requireIfMatch: true });
    const got = await strict.inject({ method: "GET", url: "/api/trades/IRS-0001" });
    const etag = String(got.headers.etag);
    const trade = got.json().trade;
    const noHeader = await strict.inject({ method: "PUT", url: "/api/trades/IRS-0001", payload: trade });
    expect(noHeader.statusCode).toBe(428);
    expect(noHeader.json()).toMatchObject({ statusCode: 428, code: "PRECONDITION_REQUIRED", currentEtag: etag });
    expect(typeof noHeader.json().requestId).toBe("string");
    expect((await strict.inject({ method: "DELETE", url: "/api/trades/IRS-0002" })).statusCode).toBe(428);
    const stale = await strict.inject({ method: "PUT", url: "/api/trades/IRS-0001", headers: { "if-match": 'W/"0-nope"' }, payload: trade });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe("PRECONDITION_FAILED");
    expect((await strict.inject({ method: "PUT", url: "/api/trades/IRS-0001", headers: { "if-match": etag }, payload: trade })).statusCode).toBe(200);
    expect((await strict.inject({ method: "DELETE", url: "/api/trades/IRS-0002", headers: { "if-match": "*" } })).statusCode).toBe(204);
    // Reads and creates are unaffected.
    expect((await strict.inject({ method: "GET", url: "/api/trades/IRS-0001" })).statusCode).toBe(200);
    const doc = strict.swagger() as unknown as { info: { description: string }; paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    expect(doc.info.description).toContain("428");
    expect(Object.keys(doc.paths["/api/trades/{id}"]!.put!.responses)).toContain("428");
    expect(Object.keys(doc.paths["/api/trades/{id}"]!.delete!.responses)).toContain("428");
    await strict.close();
    // Default (env unset): the header stays optional.
    const lax = await buildApp({ logger: false });
    expect((await lax.inject({ method: "PUT", url: "/api/trades/IRS-0001", payload: trade })).statusCode).toBe(200);
    await lax.close();
    // The env switch feeds the default.
    process.env.REQUIRE_IF_MATCH = "1";
    const env = await buildApp({ logger: false });
    expect((await env.inject({ method: "DELETE", url: "/api/trades/IRS-0001" })).statusCode).toBe(428);
    await env.close();
    delete process.env.REQUIRE_IF_MATCH;
  });
});

describe("N3-09 clearing obligation is an explicit trade field", () => {
  it("reports Y/N from the trade or the reporter default and N/A otherwise – never derived from `cleared`", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    expect(
      (await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "VOL-CLR", cleared: true, clearingObligation: false } })).statusCode,
    ).toBe(201);
    expect(
      (await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "MUST-CLR", cleared: false, clearingObligation: true } })).statusCode,
    ).toBe(201);
    expect((await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "CLR-ONLY", cleared: true } })).statusCode).toBe(201);
    expect((await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "BAD", clearingObligation: "yes" } })).statusCode).toBe(400);
    const recs = (await app2.inject({ method: "GET", url: "/api/emir/valuations" })).json() as {
      tradeId: string;
      cleared: string;
      clearingObligation: string;
    }[];
    const by = (id: string) => recs.find((r) => r.tradeId === id)!;
    // Values in the ITS (EU) 2022/1860 formats since R4 (N4-08): cleared Y/N, clearing obligation TRUE/FLSE/UKWN.
    expect(by("VOL-CLR")).toMatchObject({ cleared: "Y", clearingObligation: "FLSE" });
    expect(by("MUST-CLR")).toMatchObject({ cleared: "N", clearingObligation: "TRUE" });
    expect(by("CLR-ONLY")).toMatchObject({ cleared: "Y", clearingObligation: "UKWN" });
    expect(by("IRS-0002")).toMatchObject({ cleared: "N", clearingObligation: "UKWN" });
    // Reporter default for trades without the flag; explicit trade flags win.
    const dflt = (await app2.inject({ method: "GET", url: "/api/emir/valuations?clearingObligation=true" })).json() as typeof recs;
    expect(dflt.find((r) => r.tradeId === "CLR-ONLY")!.clearingObligation).toBe("TRUE");
    expect(dflt.find((r) => r.tradeId === "VOL-CLR")!.clearingObligation).toBe("FLSE");
    expect((await app2.inject({ method: "GET", url: "/api/emir/valuations?clearingObligation=maybe" })).statusCode).toBe(400);
    const csv = (await app2.inject({ method: "GET", url: "/api/emir/valuations?format=csv" })).body;
    expect(csv.split("\n").some((l) => l.includes("CLR-ONLY") && l.includes(";Y;UKWN;"))).toBe(true);
    const doc = JSON.stringify(app2.swagger());
    expect(doc).toContain("field 30");
    expect(doc).not.toContain("derived: cleared");
    await app2.close();
  });
});

describe("N16 CSV import (text/csv, one column template per type)", () => {
  const csv = (url: string, text: string, app2: FastifyInstance = app) =>
    app2.inject({ method: "POST", url, headers: { "content-type": "text/csv" }, payload: text });

  it("parses German and plain numbers, dates and tenors", () => {
    expect(parseCsvNumber("10.000.000,50")).toBe(10_000_000.5);
    expect(parseCsvNumber("10000000.5")).toBe(10_000_000.5);
    expect(parseCsvNumber("1.000.000")).toBe(1_000_000);
    expect(parseCsvNumber("-2.000.000")).toBe(-2_000_000);
    expect(parseCsvNumber("3,10 %")).toBeCloseTo(0.031, 12);
    expect(parseCsvNumber("3.1%")).toBeCloseTo(0.031, 12);
    expect(parseCsvNumber("-20 bp")).toBeCloseTo(-0.002, 12);
    expect(parseCsvNumber("1,1725")).toBe(1.1725);
    expect(parseCsvNumber("0.031")).toBe(0.031);
    expect(parseCsvNumber("1.000")).toBe(1);
    expect(parseCsvNumber("1.000,00")).toBe(1000);
    expect(() => parseCsvNumber("abc")).toThrow(/not a number/);
    expect(() => parseCsvNumber("1e400")).toThrow(/finite/);
    expect(parseCsvDate("2026-09-07")).toBe(parseCsvDate("07.09.2026"));
    expect(parseCsvDate("7.9.2026")).toBe(parseCsvDate("2026-09-07"));
    expect(() => parseCsvDate("next week")).toThrow(/not a date/);
    for (const type of CSV_TRADE_TYPES) {
      const text = csvTemplateText(type);
      // Since R9-4 the template file leads with the workstation's `type` column (see review-r9.test.ts).
      expect(text.split("\n")[0]!.split(";")).toEqual(["type", ...CSV_TEMPLATES[type].required, ...CSV_TEMPLATES[type].optional]);
      expect(CSV_TEMPLATES[type].example).toHaveLength(CSV_TEMPLATES[type].required.length + CSV_TEMPLATES[type].optional.length);
      const built = csvToTrades(text, type, 20699);
      expect(built.rejected, `${type}: ${JSON.stringify(built.rejected)}`).toEqual([]);
      expect(built.trades).toHaveLength(1);
      // `?type=` names the template; basis / amortising / IMM templates build `InterestRateSwap`s (R6-2).
      expect(built.trades[0]!.type).toBe(CSV_TEMPLATES[type].tradeType);
      expect(built.rows).toEqual([1]);
    }
  });

  it("imports one valid CSV per type through the builders (semicolon or comma, German headers) and prices them", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const cases: Record<(typeof CSV_TRADE_TYPES)[number], string> = {
      InterestRateSwap:
        "Kontrahent;Währung;Nominal;Richtung;Festsatz;Startdatum;Laufzeit;id;book;uti\nCPTY-A;EUR;10.000.000;Pay;3,10 %;07.09.2026;10Y;IRS-CSV-1;Treasury;UTI0001\n",
      FxForward: "pair,baseAmount,rate,deliveryDate,id\nEURUSD,-2000000,1.1725,2027-03-15,FXF-CSV-1\n",
      CapFloor: "currency;notional;capFloor;strike;floorStrike;effectiveDate;maturity;id\nEUR;8.000.000;Collar;3,50 %;1,50 %;2026-09-07;7Y;COL-CSV-1\n",
      Swaption: "Währung;Nominal;payerReceiver;Strike;Verfall;Laufzeit;id;settlement\nEUR;10.000.000;Payer;3,00 %;1Y;5Y;SWPT-CSV-1;Cash\n",
      FxOption: 'pair;optionType;notional;strike;expiryDate;id;counterparty\nEURUSD;Put;3.000.000;1,15;2027-06-15;FXO-CSV-1;"Muster; GmbH"\n',
      CrossCurrencySwap: "pair;domesticNotional;effectiveDate;tenor;fxSpot;spread;id\nEURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;CCS-CSV-1\n",
      FRA: "currency;notional;payReceive;start;rate;id;index\nEUR;5.000.000;Pay;3x9;2,20 %;FRA-CSV-1;EURIBOR-6M\n",
      // R6-2: the four templates added in round 6, with German header aliases where the web template uses them.
      FxSwap: "Paar;Betrag;Nahkurs;Fernkurs;Valuta nah;Valuta fern;id\nEUR/USD;5.000.000;1,1625;1,1690;07.09.2026;08.03.2027;FXS-CSV-1\n",
      BasisSwap: "currency,notional,receiveIndex,payIndex,spread,start,maturity,id\nEUR,10000000,EURIBOR-6M,EURIBOR-3M,12 bp,2026-09-07,5Y,BASIS-CSV-1\n",
      AmortisingSwap:
        "Währung;Nominal;Richtung;Festsatz;Startdatum;Laufzeit;Restnominal;id;csa\nEUR;10.000.000;Pay;3,00 %;2026-09-07;10Y;2.000.000;AMORT-CSV-1;none\n",
      ImmSwap: "currency;notional;payReceive;fixedRate;tenor;von;id\nEUR;10.000.000;Pay;3,00 %;2Y;2026-09-03;IMM-CSV-1\n",
    };
    for (const type of CSV_TRADE_TYPES) {
      const r = await csv(`/api/trades/import?type=${type}`, cases[type], app2);
      expect(r.statusCode, `${type}: ${r.body}`).toBe(200);
      expect(r.json(), type).toMatchObject({ total: 1, imported: 1, skipped: 0, rejected: 0 });
      expect(r.json().results[0]).toMatchObject({ row: 1, status: "imported", version: 1 });
      expect(typeof r.json().results[0].pv, type).toBe("number");
      expect(r.headers["x-market-snapshot-id"]).toMatch(/^[0-9a-f]{16}$/);
    }
    const stored = (await app2.inject({ method: "GET", url: "/api/trades" })).json() as { trade: Record<string, unknown> }[];
    expect(stored.map((s) => s.trade.type).sort()).toEqual(CSV_TRADE_TYPES.map((t) => CSV_TEMPLATES[t].tradeType).sort());
    const irs = stored.find((s) => s.trade.id === "IRS-CSV-1")!.trade as {
      book?: string;
      uti?: string;
      counterparty?: string;
      legs: { rate?: number; frequency: string }[];
    };
    expect(irs).toMatchObject({ book: "Treasury", uti: "UTI0001", counterparty: "CPTY-A" });
    expect(irs.legs[0]!.rate).toBeCloseTo(0.031, 12);
    const fxo = stored.find((s) => s.trade.id === "FXO-CSV-1")!.trade;
    expect(fxo.counterparty).toBe("Muster; GmbH");
    const col = stored.find((s) => s.trade.id === "COL-CSV-1")!.trade as { capFloor: string; floorStrike: number };
    expect(col.capFloor).toBe("Collar");
    expect(col.floorStrike).toBeCloseTo(0.015, 12);
    const fra = stored.find((s) => s.trade.id === "FRA-CSV-1")!.trade as { startDate: string; endDate: string };
    expect(fra.startDate).toMatch(/^2026-12-/);
    expect(fra.endDate).toMatch(/^2027-06-/);
    const swpt = stored.find((s) => s.trade.id === "SWPT-CSV-1")!.trade as { settlement: string };
    expect(swpt.settlement).toBe("Cash");
    // Every imported trade passes the JSON contract when read back and re-priced.
    for (const s of stored)
      expect((await app2.inject({ method: "POST", url: "/api/price", payload: { trade: s.trade } })).statusCode, String(s.trade.id)).toBe(200);
    // Audit records the format and type.
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json();
    expect(audit.entries.filter((e: { action: string }) => e.action === "trade.import")).toHaveLength(CSV_TRADE_TYPES.length);
    expect(audit.entries.find((e: { action: string }) => e.action === "trade.import").details).toMatchObject({ format: "csv", type: "InterestRateSwap" });
    await app2.close();
  });

  it("reports invalid rows per row, skips/upserts existing ids, and rejects a header without the required columns", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const text =
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;id\n" +
      "EUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS-A\n" +
      "EUR;abc;Pay;3,10 %;2026-09-07;10Y;IRS-B\n" +
      "\n" +
      "EUR;5.000.000;Sideways;2 %;2026-09-07;5Y;IRS-C\n" +
      "EUR;5.000.000;Receive;2 %;07.09.2026;2Y;IRS-D\n" +
      "XYZ;5.000.000;Receive;2 %;2026-09-07;2Y;IRS-E\n";
    const r = await csv("/api/trades/import?type=InterestRateSwap", text, app2);
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ total: 5, imported: 2, skipped: 0, rejected: 3 });
    expect(body.results.map((x: { row: number }) => x.row)).toEqual([1, 2, 3, 4, 5]);
    expect(body.results[1]).toMatchObject({ row: 2, status: "rejected", code: "CSV_ROW_INVALID" });
    expect(body.results[1].reason).toMatch(/not a number/);
    expect(body.results[2].reason).toMatch(/Pay \| Receive/);
    expect(body.results[3]).toMatchObject({ id: "IRS-D", status: "imported" });
    // XYZ builds (unknown currency conventions fall back) but cannot be priced → rejected by the core with a code, not a 400.
    expect(body.results[4]).toMatchObject({ row: 5, status: "rejected" });
    expect(typeof body.results[4].code).toBe("string");
    // Re-import: existing ids are skipped in create mode and replaced with ?mode=upsert.
    const again = await csv("/api/trades/import?type=InterestRateSwap", text.split("\n").slice(0, 2).join("\n"), app2);
    expect(again.json().results[0]).toMatchObject({ id: "IRS-A", status: "skipped", reason: "exists" });
    const upsert = await csv("/api/trades/import?type=InterestRateSwap&mode=upsert", text.split("\n").slice(0, 2).join("\n"), app2);
    expect(upsert.json().results[0]).toMatchObject({ id: "IRS-A", status: "imported", version: 2 });
    // All rows invalid → 200 with every row rejected (not a schema 400).
    const allBad = await csv(
      "/api/trades/import?type=InterestRateSwap",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity\nEUR;x;Pay;1 %;2026-09-07;5Y\n",
      app2,
    );
    expect(allBad.statusCode).toBe(200);
    expect(allBad.json()).toMatchObject({ total: 1, imported: 0, rejected: 1 });
    // Header/type problems are 400s.
    const missing = await csv("/api/trades/import?type=FxForward", "pair;rate\nEURUSD;1.17\n", app2);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: "CSV_INVALID" });
    expect(missing.json().error).toMatch(/baseAmount/);
    expect((await csv("/api/trades/import", text, app2)).statusCode).toBe(400);
    expect((await csv("/api/trades/import?type=Bond", text, app2)).statusCode).toBe(400);
    expect((await csv("/api/trades/import?type=FRA", "only a header\n", app2)).statusCode).toBe(400);
    // Compute bounds apply to CSV rows too.
    const huge = await csv(
      "/api/trades/import?type=InterestRateSwap",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;fixedFrequency;floatFrequency\nEUR;1;Pay;1 %;2026-09-07;100Y;1D;1D\n",
      app2,
    );
    expect(huge.statusCode).toBe(400);
    expect(huge.json().code).toBe("TOO_MANY_PERIODS");
    // JSON import is unchanged.
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const json = await app2.inject({ method: "POST", url: "/api/trades/import", payload: { trades: [{ ...t, id: "JSON-1" }] } });
    expect(json.json()).toMatchObject({ total: 1, imported: 1 });
    expect(json.json().results[0].row).toBeUndefined();
    // The contract documents the templates.
    const doc = JSON.stringify(app.swagger());
    for (const type of CSV_TRADE_TYPES) expect(doc).toContain(`**${type}**`);
    expect(doc).toContain("text/csv");
    await app2.close();
  });
});
