import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { buildApp, requestIdFrom } from "./app.js";
import { samplePortfolio } from "./lib/store.js";
import { datesToIso } from "./lib/dates.js";
import { classifyError, describeError } from "./lib/errors.js";
import { API_ERROR_CODES, TRADE_TYPES, WARNING_PREFIXES } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const swap = () => ({
  id: "irs-schema",
  type: "InterestRateSwap",
  legs: [
    {
      type: "Fixed",
      payReceive: "Pay",
      notional: 1e7,
      currency: "EUR",
      effectiveDate: "2026-09-07",
      terminationDate: "2031-09-07",
      frequency: "1Y",
      dayCount: "30E/360",
      calendar: "TARGET",
      rate: 0.026,
    },
    {
      type: "Float",
      payReceive: "Receive",
      notional: 1e7,
      currency: "EUR",
      effectiveDate: "2026-09-07",
      terminationDate: "2031-09-07",
      frequency: "6M",
      dayCount: "ACT/360",
      calendar: "TARGET",
      index: "EURIBOR-6M",
    },
  ],
});
const price = (trade: unknown) => app.inject({ method: "POST", url: "/api/price", payload: { trade } });

describe("N-03 discriminated trade schema", () => {
  it("accepts every seeded sample trade (schema stays in sync with the core builders)", async () => {
    const trades = datesToIso(samplePortfolio(20699));
    expect(trades.length).toBe(10);
    for (const t of trades) {
      const r = await price(t);
      expect(r.statusCode, `${t.id}: ${r.body}`).toBe(200);
      expect(typeof r.json().pv).toBe("number");
    }
  });
  it("rejects a Fixed leg without rate and a Float leg without index with 400", async () => {
    const noRate = swap();
    delete (noRate.legs[0] as Json).rate;
    const r1 = await price(noRate);
    expect(r1.statusCode).toBe(400);
    expect(String(r1.json().error)).toMatch(/rate/);
    const noIndex = swap();
    delete (noIndex.legs[1] as Json).index;
    expect((await price(noIndex)).statusCode).toBe(400);
  });
  it("types every enum field (status, lookbackDays, cashSettlementConvention, dayCount, stub, roll …)", async () => {
    expect((await price({ ...swap(), status: "Bogus" })).statusCode).toBe(400);
    expect((await price({ ...swap(), status: "Live" })).statusCode).toBe(200);
    const lb = swap();
    (lb.legs[1] as Json).lookbackDays = "five";
    expect((await price(lb)).statusCode).toBe(400);
    const dc = swap();
    (dc.legs[0] as Json).dayCount = "Actual/360";
    expect((await price(dc)).statusCode).toBe(400);
    const stub = swap();
    (stub.legs[0] as Json).stub = "Weird";
    expect((await price(stub)).statusCode).toBe(400);
    const roll = swap();
    (roll.legs[0] as Json).roll = "EOM";
    expect((await price(roll)).statusCode).toBe(400);
    const sw = (await app.inject({ method: "GET", url: "/api/trades/SWPT-0001" })).json().trade;
    expect((await price({ ...sw, cashSettlementConvention: "Bogus" })).statusCode).toBe(400);
    expect((await price({ ...sw, settlement: "Cash", cashSettlementConvention: "IRR" })).statusCode).toBe(200);
  });
  it("rejects unknown properties, non-ISO dates on nested date fields and malformed ids", async () => {
    expect((await price({ ...swap(), foo: 1 })).statusCode).toBe(400);
    expect((await price({ ...swap(), tradeDate: "07.09.2026" })).statusCode).toBe(400);
    expect((await price({ ...swap(), upfront: { amount: 1000, currency: "EUR", date: "next week" } })).statusCode).toBe(400);
    // Note: Ajv's coerceTypes (needed for query strings) turns numeric strings such as "1e7" into numbers; non-numeric text is rejected.
    const ns = swap();
    (ns.legs[0] as Json).notionalSchedule = [{ date: "2026-09-07", notional: "ten million" }];
    expect((await price(ns)).statusCode).toBe(400);
    const nsDate = swap();
    (nsDate.legs[0] as Json).notionalSchedule = [{ date: "next week", notional: 1e7 }];
    expect((await price(nsDate)).statusCode).toBe(400);
    expect((await price({ ...swap(), id: "../../etc/passwd" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/trades", payload: { ...swap(), id: "../../etc/passwd" } })).statusCode).toBe(400);
  });
  it("requires the instrument-specific mandatory fields per type", async () => {
    for (const type of TRADE_TYPES) {
      const r = await price({ id: "x", type });
      expect(r.statusCode, type).toBe(400);
    }
    // Complete FRA / FxForward / CCS shapes price fine.
    const fra = {
      id: "fra-1",
      type: "FRA",
      payReceive: "Pay",
      notional: 1e7,
      currency: "EUR",
      index: "EURIBOR-6M",
      startDate: "2027-03-08",
      endDate: "2027-09-08",
      fixedRate: 0.025,
    };
    expect((await price(fra)).statusCode).toBe(200);
    const fxf = { id: "fxf-1", type: "FxForward", buyCurrency: "USD", buyAmount: 1.17e6, sellCurrency: "EUR", sellAmount: 1e6, deliveryDate: "2027-03-15" };
    expect((await price(fxf)).statusCode).toBe(200);
    expect((await price({ ...fxf, ndf: { fixingDate: "2027-03-13", settlementCurrency: "USD" } })).statusCode).toBe(200);
  });
});

describe("N-04 market snapshot schema and ETag", () => {
  it("validates the snapshot body (schema literal, df range, ISO dates, positive spots) and exposes ETag / X-Market-Snapshot-Id", async () => {
    const get = await app.inject({ method: "GET", url: "/api/market/snapshot" });
    expect(get.statusCode).toBe(200);
    const etag = String(get.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(get.headers["x-market-snapshot-id"]).toBe(etag.slice(1, -1));
    const notModified = await app.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag } });
    expect(notModified.statusCode).toBe(304);
    const snap = get.json();
    expect((await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: { foo: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: [1, 2] })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, schema: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, fxSpots: { ...snap.fxSpots, EURUSD: -1 } } })).statusCode).toBe(
      400,
    );
    const badDf = structuredClone(snap);
    badDf.curves[0].nodes[0].df = 1.5;
    expect((await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: badDf })).statusCode).toBe(400);
    const badDate = structuredClone(snap);
    badDate.curves[0].nodes[0].date = "07.09.2026";
    expect((await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: badDate })).statusCode).toBe(400);
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const ok = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().snapshotId).toBe(etag.slice(1, -1));
    await app2.close();
  });
});

describe("F-05 snapshot id on valuation responses", () => {
  it("matches the report's audit.snapshotId and changes when the market changes", async () => {
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const priced = await price(t);
    const id = String(priced.headers["x-market-snapshot-id"]);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    const rep = await app.inject({ method: "POST", url: "/api/report", payload: { trade: t, includeRisk: false } });
    expect(rep.json().audit.snapshotId).toBe(id);
    expect(rep.headers["x-market-snapshot-id"]).toBe(id);
    for (const url of ["/api/risk", "/api/xva", "/api/scenarios", "/api/scenarios/grid", "/api/documents/termsheet"]) {
      const payload = url === "/api/xva" ? { trade: t, credit: { cptyHazard: 0.02, cptyRecovery: 0.4 } } : { trade: t, trades: undefined };
      const r = await app.inject({ method: "POST", url, payload: url.startsWith("/api/scenarios") ? {} : payload });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers["x-market-snapshot-id"], url).toBe(id);
    }
    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
    expect(ready.json().snapshotId).toBe(id);
    expect(ready.json().valuationDate).toBe("2026-09-03");
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { fxSpots: { EURUSD: 1.5 } } });
    expect(put.headers["x-market-snapshot-id"]).not.toBe(id);
    expect(put.json().snapshotId).toBe(put.headers["x-market-snapshot-id"]);
    await app2.close();
  });
});

describe("N-06 error envelope", () => {
  it("classifies validation, domain, programming and system errors", () => {
    expect(classifyError(Object.assign(new Error("bad"), { validation: [{}] })).status).toBe(400);
    expect(classifyError(Object.assign(new Error("gone"), { statusCode: 404 }))).toMatchObject({ status: 404, message: "gone" });
    expect(classifyError(new TypeError("Cannot read properties of undefined (reading 'toUpperCase')"))).toMatchObject({
      status: 400,
      message: "Invalid trade",
      code: "INVALID_TRADE",
      level: "warn",
    });
    expect(classifyError(new RangeError("x")).status).toBe(400);
    const pricingLike = Object.assign(new Error("Missing fixing"), { name: "PricingError", code: "MISSING_FIXING" });
    expect(classifyError(pricingLike)).toMatchObject({ status: 422, code: "MISSING_FIXING", message: "Missing fixing" });
    expect(classifyError(new Error("plain domain message"))).toMatchObject({ status: 422, code: "DOMAIN_ERROR" });
    // Node system errors carry `errno`/`syscall` (N6-03: recognised by those, not by the code's shape).
    expect(classifyError(Object.assign(new Error("socket"), { code: "ECONNRESET", errno: -104, syscall: "read" }))).toMatchObject({
      status: 500,
      message: "Internal server error",
      level: "error",
    });
    expect(classifyError("not an error")).toMatchObject({ status: 500 });
    expect(describeError(new TypeError("internal"))).toEqual({ message: "Invalid trade", code: "INVALID_TRADE" });
  });
  it("returns the unified object on every route, including curve 404 and 422 with code", async () => {
    const curve = await app.inject({ method: "GET", url: "/api/market/curves/NOPE" });
    expect(curve.statusCode).toBe(404);
    expect(curve.json()).toMatchObject({ error: "Curve NOPE not found", statusCode: 404 });
    expect(typeof curve.json().requestId).toBe("string");
    const unknownIndex = swap();
    (unknownIndex.legs[1] as Json).index = "NOPE-6M";
    const r = await price(unknownIndex);
    expect(r.statusCode).toBe(422);
    const body = r.json();
    expect(body.statusCode).toBe(422);
    expect(typeof body.code).toBe("string");
    expect(typeof body.requestId).toBe("string");
    expect(String(body.error)).not.toMatch(/Cannot read properties/);
    const bad = await price({ id: "x", type: "Nope" });
    expect(bad.json()).toMatchObject({ statusCode: 400 });
    expect(Array.isArray(bad.json().validation)).toBe(true);
  });
});

describe("N-07 trade ETag semantics", () => {
  it("GET honours If-None-Match (304), DELETE honours If-Match (412), PUT rejects id mismatch (400)", async () => {
    const app2 = await buildApp({ logger: false });
    const got = await app2.inject({ method: "GET", url: "/api/trades/IRS-0001" });
    const etag = String(got.headers.etag);
    const cached = await app2.inject({ method: "GET", url: "/api/trades/IRS-0001", headers: { "if-none-match": etag } });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe("");
    expect(cached.headers.etag).toBe(etag);
    const stale = await app2.inject({ method: "GET", url: "/api/trades/IRS-0001", headers: { "if-none-match": 'W/"0-nope"' } });
    expect(stale.statusCode).toBe(200);
    const mismatch = await app2.inject({ method: "PUT", url: "/api/trades/IRS-0001", payload: { ...got.json().trade, id: "OTHER" } });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error).toMatch(/does not match/);
    const delStale = await app2.inject({ method: "DELETE", url: "/api/trades/IRS-0001", headers: { "if-match": 'W/"0-nope"' } });
    expect(delStale.statusCode).toBe(412);
    expect(delStale.json().currentEtag).toBe(etag);
    const delOk = await app2.inject({ method: "DELETE", url: "/api/trades/IRS-0001", headers: { "if-match": etag } });
    expect(delOk.statusCode).toBe(204);
    expect((await app2.inject({ method: "DELETE", url: "/api/trades/IRS-0001" })).statusCode).toBe(404);
    expect((await app2.inject({ method: "GET", url: "/api/trades/..%2F..%2Fetc" })).statusCode).toBe(400);
    await app2.close();
  });
});

describe("N-08 OpenAPI contract", () => {
  it("has servers, operationId and a 2xx + error response on every operation; shared schemas in components", () => {
    const doc = app.swagger() as {
      servers?: { url: string }[];
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
      components?: { schemas?: Record<string, unknown> };
    };
    expect(doc.servers).toEqual([{ url: "/" }]);
    const ops: string[] = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(op.operationId, `${method.toUpperCase()} ${path}`).toMatch(/^[a-z][A-Za-z]+$/);
        ops.push(op.operationId!);
        const codes = Object.keys(op.responses ?? {});
        expect(
          codes.some((c) => c.startsWith("2")),
          `${method.toUpperCase()} ${path} has no 2xx response`,
        ).toBe(true);
        // Health probes are exempt from the rate limit (N4-02) and therefore document no 429.
        if (path.startsWith("/api/health")) expect(codes, `${path} must not document a 429`).not.toContain("429");
        else expect(codes, `${method.toUpperCase()} ${path} has no 429`).toContain("429");
        if (method === "post" || method === "put") expect(codes, `${method.toUpperCase()} ${path} has no 400`).toContain("400");
      }
    }
    expect(new Set(ops).size).toBe(ops.length);
    expect(ops.sort()).toEqual(
      [
        "bootstrapCurve",
        "bootstrapHazardCurve",
        "computeRisk",
        "computeXva",
        "confirmation",
        "createTrade",
        "createTradeFromTemplate",
        "deleteTrade",
        "emirValuations",
        "emirValuationsPost",
        "getAudit",
        "getCurve",
        "getHealth",
        "getMarket",
        "getMarketSnapshot",
        "getReadiness",
        "getTrade",
        "getVols",
        "hedgeEffectiveness",
        "hedgeHypothetical",
        "importMarketSnapshot",
        "importTrades",
        "keyInformationDocument",
        "listCurves",
        "listHistoricalScenarios",
        "listStandardScenarios",
        "listTrades",
        "parRisk",
        "parRiskPortfolio",
        "portfolioReport",
        "priceTrade",
        "pricePortfolio",
        "replaceCurve",
        "runScenarios",
        "scenarioGrid",
        "suitabilityStatement",
        "termsheet",
        "updateMarket",
        "updateTrade",
        "valuationReport",
        "vegaBuckets",
      ].sort(),
    );
    const components = JSON.stringify(doc.components?.schemas ?? {});
    expect(components).toContain('"discriminator"');
    expect(components).toContain("deriva.market/1");
    expect(components).toContain('"requestId"');
  });
  it("serves /docs/json without Swagger UI (production mode)", async () => {
    const prod = await buildApp({ logger: false, seedPortfolio: false, swaggerUi: false });
    const json = await prod.inject({ method: "GET", url: "/docs/json" });
    expect(json.statusCode).toBe(200);
    expect(json.json().openapi).toMatch(/^3\./);
    expect((await prod.inject({ method: "GET", url: "/docs" })).statusCode).toBe(404);
    expect((await prod.inject({ method: "GET", url: "/docs/static/index.html" })).statusCode).toBe(404);
    await prod.close();
    const ui = await app.inject({ method: "GET", url: "/docs/json" });
    expect(ui.statusCode).toBe(200);
  });
});

describe("N-12 request id and logging", () => {
  it("reuses a sanitised incoming x-request-id and generates one otherwise", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": "gw-123.abc" } });
    expect(r.headers["x-request-id"]).toBe("gw-123.abc");
    const bad = await app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": "evil\r\nSet-Cookie: x" } });
    expect(String(bad.headers["x-request-id"])).toMatch(/^req_/);
    expect(requestIdFrom(undefined)).toMatch(/^req_/);
    expect(requestIdFrom("a".repeat(129))).toMatch(/^req_/);
    expect(requestIdFrom(["first", "second"])).toBe("first");
  });
  it("builds a production-style logger with level and redaction", async () => {
    const prod = await buildApp({ logger: { level: "silent" }, seedPortfolio: false, disableRequestLogging: true });
    expect(prod.log.level).toBe("silent");
    await prod.close();
    process.env.LOG_LEVEL = "warn";
    const lvl = await buildApp({ logger: true, seedPortfolio: false, disableRequestLogging: true });
    expect(lvl.log.level).toBe("warn");
    await lvl.close();
    delete process.env.LOG_LEVEL;
  });
});

describe("N-15 EMIR options, F-24 probe currency, new core options", () => {
  it("passes asOf/method/uti to the EMIR records and validates the uti map", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/api/emir/valuations?asOf=2026-09-03T17:00:00Z&method=MTMA&uti=${encodeURIComponent(JSON.stringify({ "IRS-0002": "UTI0002ABC" }))}`,
    });
    expect(r.statusCode).toBe(200);
    const recs = r.json() as { tradeId: string; uti?: string; valuationMethod: string; valuationTimestamp: string }[];
    expect(recs.length).toBeGreaterThan(5);
    expect(recs.every((x) => x.valuationMethod === "MTMA")).toBe(true);
    expect(recs.every((x) => x.valuationTimestamp === "2026-09-03T17:00:00Z")).toBe(true);
    expect(recs.find((x) => x.tradeId === "IRS-0002")?.uti).toBe("UTI0002ABC");
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?uti=not-json" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?uti=%5B1%5D" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?method=XYZ" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?asOf=2026-09-03" })).statusCode).toBe(400);
    const csv = await app.inject({ method: "GET", url: "/api/emir/valuations?format=csv" });
    expect(csv.headers["content-type"]).toContain("text/csv");
  });
  it("probes new trades in the requested reporting currency", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const created = await app2.inject({ method: "POST", url: "/api/trades?reportingCurrency=USD", payload: swap() });
    expect(created.statusCode).toBe(201);
    const priced = await app2.inject({ method: "GET", url: "/api/trades?price=1&reportingCurrency=USD" });
    expect(priced.json()[0].pricing.currency).toBe("USD");
    expect((await app2.inject({ method: "POST", url: "/api/trades?reportingCurrency=usd", payload: { ...swap(), id: "x2" } })).statusCode).toBe(400);
    await app2.close();
  });
  it("report accepts perspective and governance; par risk portfolio and vega dimension work", async () => {
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const rep = await app.inject({
      method: "POST",
      url: "/api/report",
      payload: {
        trade: t,
        transactionPrice: 0,
        includeRisk: false,
        perspective: "Kunde",
        governance: { snapshotStatus: "approved", validatedBy: "Marktfolge", inputSources: ["EMMI EURIBOR", "ECB €STR"] },
      },
    });
    expect(rep.statusCode).toBe(200);
    expect(rep.json().governance).toMatchObject({ snapshotStatus: "approved", validatedBy: "Marktfolge" });
    expect(rep.json().costTransparency.perspective).toBe("Kunde");
    expect((await app.inject({ method: "POST", url: "/api/report", payload: { trade: t, perspective: "Bogus" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/report", payload: { trade: t, governance: { snapshotStatus: "maybe" } } })).statusCode).toBe(400);
    const sw = (await app.inject({ method: "GET", url: "/api/trades/SWPT-0001" })).json().trade;
    const vg = await app.inject({ method: "POST", url: "/api/risk/vega", payload: { trade: sw, dimension: "expiry-tenor" } });
    expect(vg.statusCode).toBe(200);
    expect(vg.json()[0].dimension).toBe("expiry-tenor");
    expect(vg.json()[0].buckets[0].label).toMatch(/x/);
    expect((await app.inject({ method: "POST", url: "/api/risk/vega", payload: { trade: sw, dimension: "strike" } })).statusCode).toBe(400);
    const pp = await app.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { trades: [t, { ...t, id: "P2" }], curveIds: ["EUR-EURIBOR-6M"] } });
    expect(pp.statusCode).toBe(200);
    expect(pp.json().length).toBe(2);
    expect(pp.json()[1].tradeId).toBe("P2");
    expect(pp.headers["x-market-snapshot-id"]).toMatch(/^[0-9a-f]{16}$/);
    expect((await app.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { trades: [] } })).statusCode).toBe(400);
  }, 60000);
  it("bootstrap accepts pillarMergeToleranceDays and reports mergedQuotes", async () => {
    const quotes = [
      { type: "Deposit", tenor: "6M", rate: 0.021 },
      { type: "FRA", start: "6M", end: "12M", rate: 0.0215 },
      { type: "Swap", tenor: "1Y", rate: 0.0216 },
      { type: "Swap", tenor: "2Y", rate: 0.0225 },
      { type: "Swap", tenor: "5Y", rate: 0.0245 },
    ];
    const r = await app.inject({
      method: "POST",
      url: "/api/market/bootstrap",
      payload: { spec: { id: "EUR-TEST", currency: "EUR", index: "EURIBOR-6M", quotes, discountCurveId: "EUR-ESTR", pillarMergeToleranceDays: 10 } },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(Array.isArray(r.json().mergedQuotes)).toBe(true);
    expect(r.json().mergedQuotes.length + r.json().residuals.length).toBe(quotes.length);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/market/bootstrap",
          payload: { spec: { id: "x", currency: "EUR", index: "EURIBOR-6M", quotes, pillarMergeToleranceDays: -1 } },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("R-03 core surface round 3", () => {
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });
  const fra = {
    id: "fra-d",
    type: "FRA",
    payReceive: "Pay",
    notional: 1e7,
    currency: "EUR",
    index: "EURIBOR-6M",
    startDate: "2027-03-08",
    endDate: "2027-09-08",
    fixedRate: 0.025,
  };

  it("trade schema: rate/spread schedules, Quoted status, quoteValidUntil, clearing fields; pricing exposes `details`", async () => {
    const stepUp = swap();
    (stepUp.legs[0] as Json).rateSchedule = [
      { date: "2028-09-07", rate: 0.03 },
      { date: "2030-09-07", rate: 0.034 },
    ];
    (stepUp.legs[1] as Json).spreadSchedule = [{ date: "2028-09-07", spread: 0.001 }];
    const r = await price({ ...stepUp, status: "Quoted", quoteValidUntil: "2026-09-10", uti: "UTI123", cleared: true, clearingMember: "Eurex Clearing AG" });
    expect(r.statusCode, r.body).toBe(200);
    // Paying a step-up coupon is worth less to the payer than the flat coupon.
    expect(r.json().pv).toBeLessThan((await price(swap())).json().pv);
    expect(r.json().details.maturity).toBe("2031-09-07");
    const noRate = swap();
    (noRate.legs[0] as Json).rateSchedule = [{ date: "2028-09-07" }];
    expect((await price(noRate)).statusCode).toBe(400);
    const badSpread = swap();
    (badSpread.legs[1] as Json).spreadSchedule = [{ date: "2028-09-07", spread: 5 }];
    expect((await price(badSpread)).statusCode).toBe(400);
    expect((await price({ ...swap(), quoteValidUntil: "10.09.2026" })).statusCode).toBe(400);
    // (coerceTypes turns a numeric clearingMember into a string, so the length bound is the schema check that bites.)
    expect((await price({ ...swap(), clearingMember: "x".repeat(201) })).statusCode).toBe(400);
    const fraRes = (await price(fra)).json();
    expect(fraRes.details.fixingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fraRes.details.settlementDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fxf = { id: "fxf-d", type: "FxForward", buyCurrency: "USD", buyAmount: 1.17e6, sellCurrency: "EUR", sellAmount: 1e6, deliveryDate: "2027-03-15" };
    const fxRes = (await price(fxf)).json();
    expect(fxRes.details.spotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fxo = (await app.inject({ method: "GET", url: "/api/trades/FXO-0001" })).json().trade;
    const fxoRes = (await price(fxo)).json();
    expect(typeof fxoRes.analytics.deltaAmount).toBe("number");
    expect(typeof fxoRes.analytics.deltaPct).toBe("number");
    expect(Math.abs(fxoRes.analytics.deltaPct)).toBeLessThanOrEqual(1);
  });

  it("builds trades from templates (CrossCurrencySwap, FRA), optionally priced; the result passes the trade schema", async () => {
    const url = "/api/trades/from-template";
    const ccs = await post(url, {
      template: "CrossCurrencySwap",
      params: {
        id: "CCS-T1",
        pair: "EURUSD",
        domesticNotional: 1e7,
        fxSpot: 1.17,
        spread: -0.002,
        effectiveDate: "2026-09-07",
        tenor: "5Y",
        counterparty: "CPTY-A",
      },
      price: true,
    });
    expect(ccs.statusCode, ccs.body).toBe(200);
    expect(ccs.json().trade).toMatchObject({ id: "CCS-T1", type: "CrossCurrencySwap", counterparty: "CPTY-A" });
    expect(ccs.json().trade.legs).toHaveLength(2);
    expect(ccs.json().trade.legs[0].effectiveDate).toBe("2026-09-07");
    expect(typeof ccs.json().pricing.pv).toBe("number");
    expect(ccs.headers["x-market-snapshot-id"]).toMatch(/^[0-9a-f]{16}$/);
    expect((await price(ccs.json().trade)).statusCode).toBe(200);
    const fixedCcs = await post(url, {
      template: "CrossCurrencySwap",
      params: {
        pair: "EURUSD",
        domesticNotional: 1e7,
        foreignNotional: 1.17e7,
        fixedRate: 0.025,
        spread: 0,
        effectiveDate: "2026-09-07",
        tenor: "2029-09-07",
        mtmReset: true,
      },
    });
    expect(fixedCcs.statusCode, fixedCcs.body).toBe(200);
    expect(fixedCcs.json().trade.id).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
    expect(fixedCcs.json().trade.mtmReset).toBeDefined();
    expect(fixedCcs.json().pricing).toBeUndefined();
    const fra3x9 = await post(url, { template: "FRA", params: { currency: "EUR", notional: 5e6, payReceive: "Pay", start: "3x9", rate: 0.022 } });
    expect(fra3x9.statusCode, fra3x9.body).toBe(200);
    expect(fra3x9.json().trade.type).toBe("FRA");
    expect(fra3x9.json().trade.startDate).toMatch(/^2026-12-/);
    expect(fra3x9.json().trade.endDate).toMatch(/^2027-06-/);
    expect((await price(fra3x9.json().trade)).statusCode).toBe(200);
    const explicit = await post(url, {
      template: "FRA",
      params: { currency: "EUR", notional: 5e6, payReceive: "Receive", start: "2027-03-08", end: "2027-09-08", rate: 0.022 },
    });
    expect(explicit.statusCode, explicit.body).toBe(200);
    expect(explicit.json().trade).toMatchObject({ startDate: "2027-03-08", endDate: "2027-09-08" });
    expect((await post(url, { template: "Swaption", params: {} })).statusCode).toBe(400);
    expect(
      (await post(url, { template: "CrossCurrencySwap", params: { pair: "EURUSD", domesticNotional: 1e7, effectiveDate: "2026-09-07", tenor: "5Y" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(url, { template: "FRA", params: { currency: "EUR", notional: 5e6, payReceive: "Pay", start: "3x9", rate: 0.022, foo: 1 } })).statusCode,
    ).toBe(400);
    expect((await post(url, { template: "FRA", params: { currency: "EUR", notional: 5e6, payReceive: "Pay", start: "soon", rate: 0.022 } })).statusCode).toBe(
      400,
    );
  });

  it("EMIR: clearing fields and uti come from the trade, transactionPrice map → MTMA, timestamp beats asOf, CSV carries the clearing columns", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const created = await app2.inject({
      method: "POST",
      url: "/api/trades",
      payload: { ...t, id: "CLR-1", cleared: true, clearingObligation: true, clearingMember: "Eurex Clearing AG", uti: "UTIABC123" },
    });
    expect(created.statusCode).toBe(201);
    const priceMap = encodeURIComponent(JSON.stringify({ "CLR-1": 0 }));
    const r = await app2.inject({ method: "GET", url: `/api/emir/valuations?transactionPrice=${priceMap}` });
    expect(r.statusCode).toBe(200);
    const recs = r.json() as Record<string, unknown>[];
    // ITS (EU) 2022/1860 value formats (N4-08): cleared Y/N, clearing obligation TRUE/FLSE/UKWN.
    expect(recs.find((x) => x.tradeId === "CLR-1")).toMatchObject({
      cleared: "Y",
      clearingObligation: "TRUE",
      clearingMember: "Eurex Clearing AG",
      uti: "UTIABC123",
      valuationMethod: "MTMA",
    });
    // Without an explicit clearing obligation the field is UKWN – never derived from `cleared` (N3-09).
    const other = recs.find((x) => x.tradeId === "IRS-0002")!;
    expect(other).toMatchObject({ cleared: "N", clearingObligation: "UKWN", valuationMethod: "MTMO" });
    expect(other.clearingMember).toBeUndefined();
    const ts = await app2.inject({ method: "GET", url: "/api/emir/valuations?asOf=2026-09-03T17:00:00Z&timestamp=2026-09-03T18:30:00Z" });
    expect((ts.json() as { valuationTimestamp: string }[]).every((x) => x.valuationTimestamp === "2026-09-03T18:30:00Z")).toBe(true);
    const ccpv = await app2.inject({ method: "GET", url: `/api/emir/valuations?method=CCPV&transactionPrice=${priceMap}` });
    expect((ccpv.json() as { valuationMethod: string }[]).every((x) => x.valuationMethod === "CCPV")).toBe(true);
    expect((await app2.inject({ method: "GET", url: `/api/emir/valuations?transactionPrice=${encodeURIComponent('{"CLR-1":"zero"}')}` })).statusCode).toBe(400);
    expect((await app2.inject({ method: "GET", url: "/api/emir/valuations?timestamp=2026-09-03" })).statusCode).toBe(400);
    const csv = await app2.inject({ method: "GET", url: "/api/emir/valuations?format=csv" });
    expect(csv.body.split("\n")[0]).toContain("Cleared;Clearing obligation;Clearing member");
    expect(csv.body).toContain("Eurex Clearing AG");
    await app2.close();
  });

  it("hedge: IntrinsicValue designation reports cost of hedging; amortisation transfers the notional path; basis scenarios and basis dollar-offset for an index mismatch", async () => {
    const app2 = await buildApp({ logger: false });
    const relCap = {
      id: "HR-CAP",
      name: "Cap auf variablen Kredit",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Variabler Kredit",
        currency: "EUR",
        notional: 8000000,
        kind: "FloatingRateLoan",
        index: "EURIBOR-6M",
        effectiveDate: "2026-09-07",
        maturityDate: "2031-09-07",
      },
      hedgingInstrumentId: "CAP-0001",
      designationDate: "2026-09-03",
      method: "DollarOffset",
      accountingFramework: "IFRS9",
      designation: "IntrinsicValue",
    };
    const cap = await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relCap } });
    expect(cap.statusCode, cap.body).toBe(200);
    expect(cap.json().designation).toBe("IntrinsicValue");
    expect(typeof cap.json().costOfHedging.timeValue).toBe("number");
    expect(typeof cap.json().costOfHedging.intrinsicValue).toBe("number");
    expect(Array.isArray(cap.json().basisScenarioIds)).toBe(true);
    expect(
      (await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: { ...relCap, designation: "TimeValue" } } })).statusCode,
    ).toBe(400);
    const relAm = {
      id: "HR-AM",
      name: "Tilgungsdarlehen 3M",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Linear getilgtes Darlehen",
        currency: "EUR",
        notional: 10000000,
        kind: "FloatingRateLoan",
        index: "EURIBOR-3M",
        effectiveDate: "2024-06-17",
        maturityDate: "2034-06-17",
        amortisation: { type: "Linear", finalNotional: 2000000 },
      },
      hedgingInstrumentId: "IRS-0001",
      designationDate: "2024-06-17",
      method: "Regression",
      accountingFramework: "HGB",
    };
    const hypo = await app2.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: relAm } });
    expect(hypo.statusCode, hypo.body).toBe(200);
    const schedule = hypo.json().legs[0].notionalSchedule as { date: string; notional: number }[];
    expect(schedule.length).toBeGreaterThan(3);
    expect(schedule[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(schedule[schedule.length - 1]!.notional).toBeLessThan(schedule[0]!.notional);
    const eff = await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relAm } });
    expect(eff.statusCode, eff.body).toBe(200);
    expect(eff.json().basisScenarioIds.length).toBeGreaterThan(0);
    expect(eff.json().dollarOffsetBasis).toBeDefined();
    expect(eff.json().costOfHedging).toBeUndefined();
    expect(eff.json().criticalTerms.checks.some((c: { term: string }) => c.term === "notionalSchedule")).toBe(true);
    const custom = {
      ...relAm,
      hedgedItem: {
        ...relAm.hedgedItem,
        amortisation: undefined,
        notionalSchedule: [
          { date: "2024-06-17", notional: 10000000 },
          { date: "2029-06-17", notional: 5000000 },
        ],
      },
    };
    expect((await app2.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: custom } })).statusCode).toBe(200);
    const annuity = { ...relAm, hedgedItem: { ...relAm.hedgedItem, amortisation: { type: "Annuity", loanRate: 0.04, frequency: "6M" } } };
    expect((await app2.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: annuity } })).statusCode).toBe(200);
    const bogusField = { ...relAm, hedgedItem: { ...relAm.hedgedItem, bogus: 1 } };
    expect((await app2.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: bogusField } })).statusCode).toBe(400);
    const bogusType = { ...relAm, hedgedItem: { ...relAm.hedgedItem, amortisation: { type: "Bullet" } } };
    expect((await app2.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: bogusType } })).statusCode).toBe(400);
    await app2.close();
  }, 60000);

  it("curves: monotoneConvex, turnOfYear and globalSweeps; FX swap points build a discount curve; snapshot round-trips forwardJumps", async () => {
    const url = "/api/market/bootstrap";
    const quotes = [
      { type: "Deposit", tenor: "6M", rate: 0.021 },
      { type: "Swap", tenor: "1Y", rate: 0.0216 },
      { type: "Swap", tenor: "2Y", rate: 0.0225 },
      { type: "Swap", tenor: "5Y", rate: 0.0245 },
      { type: "Swap", tenor: "10Y", rate: 0.027 },
    ];
    const spec = { id: "EUR-MC", currency: "EUR", index: "EURIBOR-6M", quotes, discountCurveId: "EUR-ESTR" };
    const mc = await post(url, { spec: { ...spec, interpolation: "monotoneConvex", globalSweeps: 8, turnOfYear: [{ date: "2026-12-31", bp: 15 }] } });
    expect(mc.statusCode, mc.body).toBe(200);
    expect(mc.json().curve.interpolation).toBe("monotoneConvex");
    expect(mc.json().residuals.every((x: { residual: number }) => Math.abs(x.residual) < 1e-6)).toBe(true);
    expect((await post(url, { spec: { ...spec, interpolation: "spline" } })).statusCode).toBe(400);
    expect((await post(url, { spec: { ...spec, turnOfYear: [{ date: "31.12.2026", bp: 15 }] } })).statusCode).toBe(400);
    expect((await post(url, { spec: { ...spec, globalSweeps: -1 } })).statusCode).toBe(400);
    const point = (tenor: string, points: number) => ({ type: "FxSwapPoints", tenor, points, pair: "EURUSD", fxSpot: 1.17, otherDiscountCurveId: "USD-SOFR" });
    const fx = await post(url, {
      spec: { id: "EUR-USDCSA-FX", currency: "EUR", index: "ESTR", quotes: [point("1M", 18), point("3M", 55), point("6M", 110), point("1Y", 215)] },
    });
    expect(fx.statusCode, fx.body).toBe(200);
    const nodes = fx.json().curve.nodes as { df: number; years: number }[];
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    expect(nodes.every((n) => n.df > 0.9 && n.df < 1.01)).toBe(true);
    expect(fx.json().residuals).toHaveLength(4);
    // An FxSwapPoints quote without pair / spot / other curve is a client error (400 invalid input or 422 domain error), never a 500.
    expect([400, 422]).toContain(
      (await post(url, { spec: { id: "x", currency: "EUR", index: "ESTR", quotes: [{ type: "FxSwapPoints", tenor: "1M", points: 18 }] } })).statusCode,
    );
    const snap = (await app.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    snap.curves[0].forwardJumps = [{ date: "2026-12-31", bp: 10, days: 1 }];
    snap.curves[0].interpolation = "monotoneConvex";
    snap.curves[0].extrapolation = "flatForward";
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const put = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(put.statusCode, put.body).toBe(200);
    const back = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    expect(back.curves[0].forwardJumps).toEqual([{ date: "2026-12-31", bp: 10, days: 1 }]);
    expect(back.curves[0].interpolation).toBe("monotoneConvex");
    snap.curves[0].forwardJumps = [{ date: "2026-12-31" }];
    expect((await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(400);
    await app2.close();
  }, 60000);

  it("XVA: bootstraps a hazard curve from CDS spreads and accepts it as term structure in /api/xva", async () => {
    const url = "/api/xva/hazard-curve";
    const quotes = [
      { tenor: "1Y", spread: 0.006 },
      { tenor: "3Y", spread: 0.009 },
      { tenor: "5Y", spread: 0.012 },
    ];
    const hz = await post(url, { quotes, recovery: 0.4 });
    expect(hz.statusCode, hz.body).toBe(200);
    const curve = hz.json();
    expect(curve.times).toHaveLength(3);
    expect(curve.times[0]).toBeLessThan(curve.times[1]);
    expect(curve.hazards[0]).toBeCloseTo(0.006 / 0.6, 3);
    expect(curve.recovery).toBe(0.4);
    expect(curve.valuationDate).toBe("2026-09-03");
    expect(curve.pillars[2].tenor).toBe("5Y");
    expect(curve.pillars[2].survival).toBeLessThan(curve.pillars[0].survival);
    expect(hz.headers["x-market-snapshot-id"]).toMatch(/^[0-9a-f]{16}$/);
    expect((await post(url, { quotes, recovery: 0.4, discountCurveId: "EUR-ESTR" })).statusCode).toBe(200);
    expect((await post(url, { quotes, recovery: 0.4, discountCurveId: "NOPE" })).statusCode).toBe(404);
    expect((await post(url, { quotes, recovery: 1 })).statusCode).toBe(400);
    expect((await post(url, { quotes: [], recovery: 0.4 })).statusCode).toBe(400);
    expect((await post(url, { quotes: [{ tenor: "5 years", spread: 0.01 }], recovery: 0.4 })).statusCode).toBe(400);
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0001" })).json().trade;
    const flat = await post("/api/xva", { trade: t, credit: { cptyHazard: 0.02, cptyRecovery: 0.4 } });
    const termed = await post("/api/xva", {
      trade: t,
      credit: { cptyHazard: 0.02, cptyRecovery: 0.4, cptyHazardCurve: { times: curve.times, hazards: curve.hazards, recovery: curve.recovery } },
    });
    expect(termed.statusCode, termed.body).toBe(200);
    expect(termed.json().cva).toBeGreaterThan(0);
    expect(termed.json().cva).not.toBeCloseTo(flat.json().cva, 2);
    expect(
      (await post("/api/xva", { trade: t, credit: { cptyHazard: 0.02, cptyRecovery: 0.4, cptyHazardCurve: { times: [1], hazards: [] } } })).statusCode,
    ).toBe(400);
  });

  it("documents: DRV confirmation and PRIIPs KID as JSON and Markdown", async () => {
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const body = {
      trade: { ...t, uti: "UTI0002ABC" },
      parties: { bank: { name: "Sparkasse Musterstadt", lei: "5299000J2N45DDNE4Y28" }, client: { name: "Muster GmbH", address: "Musterweg 1, 06108 Halle" } },
      masterAgreement: { type: "DRV", date: "2020-01-15", reference: "RV-2020-001", csaReference: "BA-2020-001" },
      confirmationDate: "2026-09-03",
      reference: "CONF-1",
    };
    const c = await post("/api/documents/confirmation", body);
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json().kind).toBe("Confirmation");
    const md: string = c.json().markdown;
    for (const s of ["Rahmenvertrag für Finanztermingeschäfte", "2020", "UTI0002ABC", "Muster GmbH", "RV-2020-001", "CONF-1"]) expect(md).toContain(s);
    expect(c.json().sections.length).toBeGreaterThanOrEqual(4);
    const cmd = await app.inject({ method: "POST", url: "/api/documents/confirmation?format=md", payload: body });
    expect(cmd.headers["content-type"]).toContain("text/markdown");
    expect(String(cmd.headers["content-disposition"])).toContain("confirmation.md");
    const isda = await post("/api/documents/confirmation", { ...body, masterAgreement: { type: "ISDA" }, includeSchedule: false });
    expect(isda.statusCode, isda.body).toBe(200);
    expect(isda.json().markdown).toContain("ISDA Master Agreement");
    expect((await post("/api/documents/confirmation", { ...body, masterAgreement: { type: "GMRA" } })).statusCode).toBe(400);
    expect((await post("/api/documents/confirmation", { ...body, parties: { bank: { name: "x", lei: "bad" }, client: { name: "y" } } })).statusCode).toBe(400);
    expect((await post("/api/documents/confirmation", { trade: t, parties: body.parties })).statusCode).toBe(400);
    const kid = await post("/api/documents/kid", { trade: t, kid: { manufacturer: "Sparkasse Musterstadt", transactionPrice: 25000, perspective: "Bank" } });
    expect(kid.statusCode, kid.body).toBe(200);
    expect(kid.json().kind).toBe("KID");
    expect(kid.json().title).toBe("Basisinformationsblatt");
    const headings = kid.json().sections.map((s: { heading: string }) => s.heading) as string[];
    expect(headings.some((h) => h.startsWith("Welche Risiken"))).toBe(true);
    expect(headings.some((h) => h.startsWith("Welche Kosten"))).toBe(true);
    const hist = await app.inject({
      method: "POST",
      url: "/api/documents/kid?format=md",
      payload: { trade: t, kid: { manufacturer: "Sparkasse Musterstadt" }, includeHistorical: true },
    });
    expect(hist.headers["content-type"]).toContain("text/markdown");
    expect(hist.body).toContain("Basisinformationsblatt");
    const own = await post("/api/documents/kid", {
      trade: t,
      kid: { manufacturer: "S" },
      scenarios: [
        { id: "up", name: "+100", curveShifts: [{ target: "*", parallelBp: 100 }] },
        { id: "dn", name: "-100", curveShifts: [{ target: "*", parallelBp: -100 }] },
      ],
    });
    expect(own.statusCode, own.body).toBe(200);
    expect((await post("/api/documents/kid", { trade: t, kid: {} })).statusCode).toBe(400);
    expect((await post("/api/documents/kid", { trade: t, kid: { manufacturer: "S", perspective: "Auditor" } })).statusCode).toBe(400);
  }, 60000);

  it("scenarios: historical set listed and appended via includeHistorical; market carries JPY-TONA; report documents the perspective sign rule", async () => {
    const hist = await app.inject({ method: "GET", url: "/api/scenarios/historical" });
    expect(hist.statusCode).toBe(200);
    const list = hist.json() as { id: string; description?: string }[];
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every((s) => s.id.startsWith("hist-") && typeof s.description === "string")).toBe(true);
    const std = (await app.inject({ method: "GET", url: "/api/scenarios/standard" })).json() as unknown[];
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const run = await post("/api/scenarios", { trades: [t], includeHistorical: true });
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json().results.length).toBe(std.length + list.length);
    expect(run.json().results.some((r: { scenario: { id: string } }) => r.scenario.id === "hist-lehman-2008")).toBe(true);
    const own = await post("/api/scenarios", { trades: [t], scenarios: [list[0]], includeHistorical: false });
    expect(own.json().results).toHaveLength(1);
    const market = (await app.inject({ method: "GET", url: "/api/market" })).json();
    expect(market.curves.map((c: { id: string }) => c.id)).toContain("JPY-TONA");
    expect(market.discountCurveId.JPY).toBe("JPY-TONA");
    expect(market.fxSpots.EURJPY).toBeGreaterThan(100);
    const jpy = await app.inject({ method: "GET", url: "/api/market/curves/JPY-TONA" });
    expect(jpy.statusCode).toBe(200);
    expect(jpy.json().currency).toBe("JPY");
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain("always the bank");
    expect(doc).toContain("monotoneConvex");
    expect(doc).toContain("FxSwapPoints");
  });
});

describe("R-04 core surface round 4", () => {
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });
  const trade = async (id: string) => (await app.inject({ method: "GET", url: `/api/trades/${id}` })).json().trade;

  it("portfolio report: store or body trades, aggregates, audit anchors, groupBy trimming, Markdown download, audit entry", async () => {
    const app2 = await buildApp({ logger: false });
    const post2 = (url: string, payload: Record<string, unknown>) => app2.inject({ method: "POST", url, payload });
    const url = "/api/report/portfolio";
    const r = await post2(url, {});
    expect(r.statusCode, r.body).toBe(200);
    const rep = r.json();
    expect(rep.lines).toHaveLength(10);
    expect(rep.totals.trades).toBe(10);
    expect(rep.failed).toBe(0);
    expect(rep.reportingCurrency).toBe("EUR");
    expect(rep.valuationDate).toBe("2026-09-03");
    expect(rep.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rep.byCounterparty.map((a: { key: string }) => a.key).sort()).toEqual(["CPTY-A", "CPTY-B"]);
    expect(rep.byBook).toHaveLength(1);
    expect(rep.byType.length).toBeGreaterThanOrEqual(4);
    expect(rep.byCounterparty.reduce((s: number, a: { pv: number }) => s + a.pv, 0)).toBeCloseTo(rep.totals.pv, 4);
    expect(typeof rep.totals.dv01).toBe("number");
    expect(typeof rep.totals.theta).toBe("number");
    expect(typeof rep.totals.fxDelta.USDEUR).toBe("number");
    expect(rep.totals.fxDelta.EURUSD).toBeUndefined();
    expect(rep.lines.find((l: { tradeId: string }) => l.tradeId === "FXO-0002").fxDelta.CHFEUR).not.toBe(0);
    expect(rep.audit.snapshotId).toBe(r.headers["x-market-snapshot-id"]);
    expect(rep.audit.reportHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(rep.audit.inputsHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(rep.groupBy).toBeUndefined();
    // Deterministic: same trades on the same snapshot → same hashes.
    const again = (await post2(url, {})).json();
    expect(again.audit.reportHash).toBe(rep.audit.reportHash);
    expect(again.audit.inputsHash).toBe(rep.audit.inputsHash);
    // groupBy trims the aggregations but not the hash; options reach the core.
    const grouped = await post2(url, { groupBy: ["type"], reportingCurrency: "USD", theta: false, fxDelta: false, preparedBy: "Marktfolge" });
    expect(grouped.statusCode, grouped.body).toBe(200);
    expect(grouped.json().byCounterparty).toEqual([]);
    expect(grouped.json().byBook).toEqual([]);
    expect(grouped.json().byType.length).toBe(rep.byType.length);
    expect(grouped.json().groupBy).toEqual(["type"]);
    expect(grouped.json().reportingCurrency).toBe("USD");
    expect(grouped.json().totals.fxDelta).toEqual({});
    expect(grouped.json().lines[0].theta).toBeNull();
    expect(grouped.json().audit.preparedBy).toBe("Marktfolge");
    const sameTrim = await post2(url, { groupBy: ["type"] });
    expect(sameTrim.json().audit.reportHash).toBe(rep.audit.reportHash);
    // Body trades: a failed valuation stays as a line with `error`, excluded from the totals.
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const bad = { ...t, id: "BAD", legs: [t.legs[0], { ...t.legs[1], index: "NOPE-6M" }] };
    const own = await post2(url, { trades: [t, bad] });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json().lines).toHaveLength(2);
    expect(own.json().failed).toBe(1);
    // The failed trade is counted but contributes nothing to the measures.
    expect(own.json().totals.trades).toBe(2);
    expect(own.json().totals.pv).toBeCloseTo(own.json().lines[0].pv, 6);
    expect(own.json().totals.dv01).toBeCloseTo(own.json().lines[0].dv01, 6);
    const badLine = own.json().lines.find((l: { tradeId: string }) => l.tradeId === "BAD");
    expect(typeof badLine.error).toBe("string");
    expect(badLine.pv).toBeNull();
    expect(badLine.dv01).toBeNull();
    expect(own.json().lines[0].pv).toBeCloseTo(rep.lines.find((l: { tradeId: string }) => l.tradeId === "IRS-0002").pv, 6);
    // Markdown: German rendering, trimmed to the requested groupings.
    const md = await app2.inject({ method: "POST", url: `${url}?format=md`, payload: { groupBy: ["counterparty"] } });
    expect(md.statusCode, md.body).toBe(200);
    expect(md.headers["content-type"]).toContain("text/markdown");
    expect(String(md.headers["content-disposition"])).toContain(`portfolio-${rep.audit.snapshotId}-report.md`);
    expect(md.headers["x-market-snapshot-id"]).toBe(rep.audit.snapshotId);
    expect(md.body).toContain("# Portfolio-Bewertungsreport");
    expect(md.body).toContain("03.09.2026");
    expect(md.body).toContain("## Nach Kontrahent");
    expect(md.body).not.toContain("## Nach Buch");
    expect(md.body).not.toContain("## Nach Produktart");
    expect(md.body).toContain("## Einzelgeschäfte");
    expect(md.body).toContain(rep.audit.reportHash);
    const fullMd = await app2.inject({ method: "POST", url: `${url}?format=md`, payload: {} });
    for (const h of ["## Nach Kontrahent", "## Nach Buch", "## Nach Produktart", "## Audit"]) expect(fullMd.body).toContain(h);
    // Validation.
    expect((await post2(url, { groupBy: ["desk"] })).statusCode).toBe(400);
    expect((await post2(url, { groupBy: [] })).statusCode).toBe(400);
    expect((await post2(url, { groupBy: ["type", "type"] })).statusCode).toBe(400);
    expect((await post2(url, { reportingCurrency: "eur" })).statusCode).toBe(400);
    expect((await post2(url, { foo: 1 })).statusCode).toBe(400);
    expect((await post2(url, { trades: [{ id: "x", type: "FRA" }] })).statusCode).toBe(400);
    expect((await app2.inject({ method: "POST", url: `${url}?format=pdf`, payload: {} })).statusCode).toBe(400);
    // Audit trail.
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json();
    expect(audit.chainValid).toBe(true);
    const entries = audit.entries.filter((e: { action: string }) => e.action === "report.portfolio");
    expect(entries).toHaveLength(7);
    expect(entries[0]).toMatchObject({
      subject: "portfolio",
      details: { trades: 10, failed: 0, reportHash: rep.audit.reportHash, snapshotId: rep.audit.snapshotId },
    });
    expect(entries[2].details.groupBy).toEqual(["type"]);
    expect(entries[4].details.failed).toBe(1);
    // Empty store → empty but well-formed report.
    const empty = await buildApp({ logger: false, seedPortfolio: false });
    const e = await empty.inject({ method: "POST", url, payload: {} });
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json().lines).toEqual([]);
    expect(e.json().totals.trades).toBe(0);
    await empty.close();
    await app2.close();
  }, 120000);

  it("vega buckets: FX option reports the pair's surface as kind fx; `smile` adds RR25/BF25 buckets outside the total", async () => {
    const fxo = await trade("FXO-0001");
    const atm = await post("/api/risk/vega", { trade: fxo });
    expect(atm.statusCode, atm.body).toBe(200);
    expect(atm.json()).toHaveLength(1);
    const surface = atm.json()[0];
    expect(surface.kind).toBe("fx");
    expect(surface.key).toMatch(/^(EURUSD|USDEUR)$/);
    expect(surface.dimension).toBe("expiry");
    expect(surface.buckets.length).toBeGreaterThan(2);
    expect(surface.buckets.every((b: { component?: string }) => b.component === "atm")).toBe(true);
    expect(surface.buckets.every((b: { tenor?: number }) => b.tenor === undefined)).toBe(true);
    const sum = surface.buckets.reduce((s: number, b: { vega: number }) => s + b.vega, 0);
    expect(sum).toBeCloseTo(surface.total, 6);
    const smile = await app.inject({ method: "POST", url: "/api/risk/vega?smile=true", payload: { trade: fxo } });
    expect(smile.statusCode, smile.body).toBe(200);
    const buckets = smile.json()[0].buckets as { label: string; vega: number; component: string }[];
    expect(new Set(buckets.map((b) => b.component))).toEqual(new Set(["atm", "rr25", "bf25"]));
    expect(buckets.length).toBe(3 * surface.buckets.length);
    expect(buckets.some((b) => / RR25$/.test(b.label))).toBe(true);
    expect(buckets.some((b) => / BF25$/.test(b.label))).toBe(true);
    expect(buckets.filter((b) => b.component === "atm").reduce((s, b) => s + b.vega, 0)).toBeCloseTo(smile.json()[0].total, 6);
    expect(smile.json()[0].total).toBeCloseTo(surface.total, 6);
    expect(buckets.every((b) => Number.isFinite(b.vega))).toBe(true);
    // Body beats query; non-boolean is rejected; IR surfaces ignore the flag.
    const body = await post("/api/risk/vega", { trade: fxo, smile: true });
    expect(body.json()[0].buckets).toHaveLength(buckets.length);
    const bodyWins = await app.inject({ method: "POST", url: "/api/risk/vega?smile=true", payload: { trade: fxo, smile: false } });
    expect(bodyWins.json()[0].buckets).toHaveLength(surface.buckets.length);
    expect((await post("/api/risk/vega", { trade: fxo, smile: "yes" })).statusCode).toBe(400);
    const sw = await post("/api/risk/vega", { trade: await trade("SWPT-0001"), smile: true });
    expect(sw.statusCode).toBe(200);
    expect(sw.json()[0].kind).toBe("swaption");
    expect(sw.json()[0].buckets.every((b: { component?: string }) => b.component === undefined)).toBe(true);
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain('"swaption","caplet","fx"');
    expect(doc).toContain('"atm","rr25","bf25"');
    expect(doc).toContain("FX-Vol-Fläche");
  }, 60000);

  it("hedge: freezeDesignationVol freezes the hypothetical cap's vol at designation and reports frozenVol", async () => {
    const app2 = await buildApp({ logger: false });
    const url = "/api/hedge/effectiveness";
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    const rel = {
      id: "HR-FREEZE",
      name: "Cap auf variablen Kredit (Vol eingefroren)",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Variabler Kredit",
        currency: "EUR",
        notional: 8000000,
        kind: "FloatingRateLoan",
        index: "EURIBOR-6M",
        effectiveDate: "2026-09-07",
        maturityDate: "2031-09-07",
      },
      hedgingInstrumentId: "CAP-0001",
      designationDate: "2026-09-03",
      method: "DollarOffset",
      accountingFramework: "IFRS9",
    };
    const frozen = await app2.inject({ method: "POST", url, payload: { relationship: rel, designationSnapshot: snap, freezeDesignationVol: true } });
    expect(frozen.statusCode, frozen.body).toBe(200);
    const hypo = frozen.json().hypotheticalDerivative;
    expect(typeof hypo.frozenVol).toBe("number");
    expect(hypo.frozenVol).toBeGreaterThan(0);
    expect(hypo.trade.type).toBe("CapFloor");
    expect(hypo.trade.volOverride).toBeCloseTo(hypo.frozenVol, 12);
    expect(typeof hypo.pv).toBe("number");
    expect(frozen.json().dollarOffsetCumulative).toBeDefined();
    const live = await app2.inject({ method: "POST", url, payload: { relationship: rel, designationSnapshot: snap } });
    expect(live.statusCode, live.body).toBe(200);
    expect(live.json().hypotheticalDerivative.frozenVol).toBeUndefined();
    expect(live.json().hypotheticalDerivative.trade.volOverride).toBeUndefined();
    // Without a designation snapshot the flag has nothing to freeze from.
    const noDesignation = await app2.inject({ method: "POST", url, payload: { relationship: rel, freezeDesignationVol: true } });
    expect(noDesignation.statusCode, noDesignation.body).toBe(200);
    expect(noDesignation.json().hypotheticalDerivative.frozenVol).toBeUndefined();
    expect((await app2.inject({ method: "POST", url, payload: { relationship: rel, freezeDesignationVol: "yes" } })).statusCode).toBe(400);
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json();
    const tests = audit.entries.filter((e: { action: string; subject: string }) => e.action === "hedge.test" && e.subject === "HR-FREEZE");
    expect(tests).toHaveLength(3);
    expect(tests[0].details.frozenVol).toBeCloseTo(hypo.frozenVol, 12);
    expect(tests[1].details.frozenVol).toBeUndefined();
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain("frozenVol");
    expect(doc).toContain("freezeDesignationVol");
    await app2.close();
  }, 120000);

  it("trade schema: CapFloor.notionalSchedule prices an amortising cap, rejects malformed entries and round-trips through the store", async () => {
    const cap = await trade("CAP-0001");
    const full = (await price(cap)).json();
    const amortising = {
      ...cap,
      notionalSchedule: [
        { date: cap.effectiveDate, notional: 8000000 },
        { date: "2029-09-07", notional: 4000000 },
      ],
    };
    const am = await price(amortising);
    expect(am.statusCode, am.body).toBe(200);
    expect(Math.abs(am.json().pv)).toBeLessThan(Math.abs(full.pv));
    expect(Math.sign(am.json().pv)).toBe(Math.sign(full.pv));
    expect((await price({ ...cap, notionalSchedule: [{ date: "2029-09-07" }] })).statusCode).toBe(400);
    expect((await price({ ...cap, notionalSchedule: [{ date: "07.09.2029", notional: 4000000 }] })).statusCode).toBe(400);
    expect((await price({ ...cap, notionalSchedule: [{ date: "2029-09-07", notional: -1 }] })).statusCode).toBe(400);
    expect((await price({ ...cap, notionalSchedule: [{ date: "2029-09-07", notional: 4000000, foo: 1 }] })).statusCode).toBe(400);
    const app2 = await buildApp({ logger: false });
    const created = await app2.inject({ method: "POST", url: "/api/trades", payload: { ...amortising, id: "CAP-AM" } });
    expect(created.statusCode, created.body).toBe(201);
    const stored = (await app2.inject({ method: "GET", url: "/api/trades/CAP-AM" })).json().trade;
    expect(stored.notionalSchedule).toEqual(amortising.notionalSchedule);
    await app2.close();
  });

  it("pricing analytics: FX forwards / swaps carry `deltaAmount` only, FX options additionally `deltaPct` as a fraction", async () => {
    const fwd = (await price(await trade("FXF-0001"))).json();
    expect(typeof fwd.analytics.deltaAmount).toBe("number");
    expect(fwd.analytics.deltaPct).toBeUndefined();
    const fxSwap = {
      id: "fxs-d",
      type: "FxSwap",
      nearLeg: { buyCurrency: "USD", buyAmount: 1170000, sellCurrency: "EUR", sellAmount: 1000000, deliveryDate: "2026-09-07" },
      farLeg: { buyCurrency: "EUR", buyAmount: 1000000, sellCurrency: "USD", sellAmount: 1175000, deliveryDate: "2027-03-15" },
    };
    const swp = await price(fxSwap);
    expect(swp.statusCode, swp.body).toBe(200);
    expect(typeof swp.json().analytics.deltaAmount).toBe("number");
    expect(swp.json().analytics.deltaPct).toBeUndefined();
    const opt = (await price(await trade("FXO-0002"))).json();
    expect(typeof opt.analytics.deltaAmount).toBe("number");
    expect(Math.abs(opt.analytics.deltaPct)).toBeLessThanOrEqual(1);
    expect(Math.abs(opt.analytics.deltaPct)).toBeGreaterThan(0);
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain("FX forwards and FX swaps: `deltaAmount`");
    expect(doc).toContain("`deltaPct` = signed spot delta as a fraction of the notional");
  });
});

describe("R-05 core surface round 5 (error codes, vol conversion, hazard floor, CCS collateral, FRA index)", () => {
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });
  const trade = async (id: string) => (await app.inject({ method: "GET", url: `/api/trades/${id}` })).json().trade;

  it("hazard curve: inverted CDS quotes → 422 INVALID_CREDIT_CURVE naming the pillar; floorHazard floors it and reports HAZARD_FLOORED", async () => {
    const url = "/api/xva/hazard-curve";
    // 1Y at 300bp, 3Y at 50bp: s·T falls from 3.0 to 1.5 → the 3Y interval would need a negative hazard; 5Y at 150bp (s·T = 7.5) is solvable again.
    const inverted = [
      { tenor: "1Y", spread: 0.03 },
      { tenor: "3Y", spread: 0.005 },
      { tenor: "5Y", spread: 0.015 },
    ];
    const rejected = await post(url, { quotes: inverted, recovery: 0.4 });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json()).toMatchObject({ statusCode: 422, code: "INVALID_CREDIT_CURVE", details: { pillar: "3Y" } });
    expect(rejected.json().details.hazard).toBeLessThan(0);
    expect(String(rejected.json().error)).toMatch(/inverted CDS quotes/);
    const floored = await post(url, { quotes: inverted, recovery: 0.4, floorHazard: true });
    expect(floored.statusCode, floored.body).toBe(200);
    const curve = floored.json();
    expect(curve.hazards[0]).toBeGreaterThan(0);
    expect(curve.hazards[1]).toBe(0);
    expect(curve.pillars[1]).toMatchObject({ tenor: "3Y", hazard: 0 });
    // Survival stays flat over the floored interval and falls again afterwards.
    expect(curve.pillars[1].survival).toBeCloseTo(curve.pillars[0].survival, 12);
    expect(curve.pillars[2].survival).toBeLessThan(curve.pillars[1].survival);
    expect(Array.isArray(curve.warnings)).toBe(true);
    expect(curve.warnings).toHaveLength(1);
    expect(curve.warnings[0]).toMatch(/^HAZARD_FLOORED: pillar 3Y/);
    // A regular term structure carries no warnings at all, with or without the flag.
    const regular = [
      { tenor: "1Y", spread: 0.006 },
      { tenor: "5Y", spread: 0.012 },
    ];
    expect((await post(url, { quotes: regular, recovery: 0.4, floorHazard: true })).json().warnings).toBeUndefined();
    expect((await post(url, { quotes: regular, recovery: 0.4, floorHazard: "yes" })).statusCode).toBe(400);
    // The bootstrapped curve (core fields incl. `warnings`) is accepted as term structure by /api/xva.
    const t = await trade("IRS-0001");
    const { times, hazards, recovery, warnings } = curve;
    const xva = await post("/api/xva", { trade: t, credit: { cptyHazard: 0.02, cptyRecovery: 0.4, cptyHazardCurve: { times, hazards, recovery, warnings } } });
    expect(xva.statusCode, xva.body).toBe(200);
    expect(xva.json().cva).toBeGreaterThan(0);
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain('"floorHazard":{"type":"boolean"');
    expect(doc).toContain("HAZARD_FLOORED");
  });

  it("from-template: CCS collateral defaults to USD / the quote currency and `null` builds an uncollateralised swap; FRA index follows the period (3x6 → EURIBOR-3M)", async () => {
    const url = "/api/trades/from-template";
    const ccs = (params: Record<string, unknown>) =>
      post(url, { template: "CrossCurrencySwap", params: { domesticNotional: 1e7, spread: -0.002, effectiveDate: "2026-09-07", tenor: "5Y", ...params } });
    const usd = await ccs({ pair: "EURUSD", fxSpot: 1.17 });
    expect(usd.statusCode, usd.body).toBe(200);
    expect(usd.json().trade.collateralCurrency).toBe("USD");
    const gbp = await ccs({ pair: "EURGBP", foreignNotional: 8.5e6 });
    expect(gbp.statusCode, gbp.body).toBe(200);
    expect(gbp.json().trade.collateralCurrency).toBe("GBP");
    const usdJpy = await ccs({ pair: "USDJPY", fxSpot: 150 });
    expect(usdJpy.statusCode, usdJpy.body).toBe(200);
    expect(usdJpy.json().trade.collateralCurrency).toBe("USD");
    const explicit = await ccs({ pair: "EURUSD", fxSpot: 1.17, collateralCurrency: "EUR" });
    expect(explicit.json().trade.collateralCurrency).toBe("EUR");
    const uncollateralised = await ccs({ pair: "EURUSD", fxSpot: 1.17, collateralCurrency: null });
    expect(uncollateralised.statusCode, uncollateralised.body).toBe(200);
    expect(uncollateralised.json().trade.collateralCurrency).toBeUndefined();
    expect("collateralCurrency" in uncollateralised.json().trade).toBe(false);
    // The collateral choice changes the EUR discounting, hence the PV; both price and pass the trade schema.
    const priced = async (collateralCurrency: string | null | undefined) =>
      (await ccs({ pair: "EURUSD", fxSpot: 1.17, ...(collateralCurrency === undefined ? {} : { collateralCurrency }) })).json();
    const [pvCsa, pvNone] = [(await price((await priced(undefined)).trade)).json().pv, (await price((await priced(null)).trade)).json().pv];
    expect(typeof pvCsa).toBe("number");
    expect(typeof pvNone).toBe("number");
    expect(pvCsa).not.toBeCloseTo(pvNone, 0);
    expect((await ccs({ pair: "EURUSD", fxSpot: 1.17, collateralCurrency: "usd" })).statusCode).toBe(400);
    expect((await ccs({ pair: "EURUSD", fxSpot: 1.17, collateralCurrency: 1 })).statusCode).toBe(400);
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain('"collateralCurrency":{"type":["string","null"]');
    expect(doc).toContain("USD when one leg is USD, otherwise the quote (second) currency");

    const fra = (params: Record<string, unknown>) =>
      post(url, { template: "FRA", params: { currency: "EUR", notional: 5e6, payReceive: "Pay", rate: 0.022, ...params } });
    const fra3x6 = await fra({ start: "3x6" });
    expect(fra3x6.statusCode, fra3x6.body).toBe(200);
    expect(fra3x6.json().trade.index).toBe("EURIBOR-3M");
    expect(fra3x6.json().trade.startDate).toMatch(/^2026-12-/);
    expect(fra3x6.json().trade.endDate).toMatch(/^2027-03-/);
    const p3x6 = await price(fra3x6.json().trade);
    expect(p3x6.statusCode, p3x6.body).toBe(200);
    expect(typeof p3x6.json().analytics.forwardRate).toBe("number");
    expect(p3x6.json().details.fixingDate).toMatch(/^2026-12-/);
    expect((await fra({ start: "3x9" })).json().trade.index).toBe("EURIBOR-6M");
    expect((await fra({ start: "6x12" })).json().trade.index).toBe("EURIBOR-6M");
    expect((await fra({ start: "3x6", index: "EURIBOR-6M" })).json().trade.index).toBe("EURIBOR-6M");
    expect((await fra({ start: "2027-03-08", end: "2027-06-08" })).json().trade.index).toBe("EURIBOR-3M");
    expect((await fra({ start: "2027-03-08", end: "2027-09-08" })).json().trade.index).toBe("EURIBOR-6M");
    expect((await fra({ start: "3x6", currency: "USD" })).json().trade.index).toBe("SOFR");
    expect(doc).toContain('(\\"3x6\\" → EURIBOR-3M, \\"6x12\\" → EURIBOR-6M');
  });

  it("pricing: a Black cap on the normal caplet surface prices ≈ Bachelier with VOL_TYPE_CONVERTED; Black on a negative strike → 422 VOL_MODEL_INCOMPATIBLE; FX options report details.standardDelivery", async () => {
    const cap = await trade("CAP-0001");
    const bachelier = (await price(cap)).json();
    expect(bachelier.analytics.model).toBe("Bachelier");
    expect(bachelier.analytics.volConverted).toBe("no");
    expect(bachelier.warnings.some((w: string) => w.startsWith("VOL_TYPE_CONVERTED:"))).toBe(false);
    const black = await price({ ...cap, model: "Black" });
    expect(black.statusCode, black.body).toBe(200);
    expect(black.json().analytics.model).toBe("Black");
    expect(black.json().analytics.volConverted).toBe("yes");
    const converted = black.json().warnings.filter((w: string) => w.startsWith("VOL_TYPE_CONVERTED:"));
    expect(converted).toHaveLength(1);
    expect(converted[0]).toMatch(/caplet/);
    // Price-equivalent conversion per caplet: the Black PV reproduces the Bachelier PV (up to the vol root-finding tolerance).
    expect(Math.abs(black.json().pv - bachelier.pv)).toBeLessThan(Math.abs(bachelier.pv) * 1e-4);
    // Black vega is per vol point, Bachelier per bp – both finite and positive for a long cap.
    expect(black.json().analytics.vega).toBeGreaterThan(0);
    expect(bachelier.analytics.vega).toBeGreaterThan(0);
    // The same conversion on a swaption exposes the unconverted surface vol.
    const sw = await trade("SWPT-0001");
    const swBlack = await price({ ...sw, model: "Black" });
    expect(swBlack.statusCode, swBlack.body).toBe(200);
    expect(swBlack.json().analytics.volConverted).toBe("yes");
    expect(typeof swBlack.json().analytics.surfaceVolatility).toBe("number");
    expect(swBlack.json().analytics.volatility).toBeGreaterThan(swBlack.json().analytics.surfaceVolatility);
    expect(swBlack.json().warnings.some((w: string) => w.startsWith("VOL_TYPE_CONVERTED:"))).toBe(true);
    expect(Math.abs(swBlack.json().pv - (await price(sw)).json().pv)).toBeLessThan(Math.abs(swBlack.json().pv) * 1e-4);
    // Lognormal model on a non-positive strike without shift cannot be fed from the normal surface.
    const incompatible = await price({ ...cap, model: "Black", strike: -0.01 });
    expect(incompatible.statusCode, incompatible.body).toBe(422);
    expect(incompatible.json()).toMatchObject({ statusCode: 422, code: "VOL_MODEL_INCOMPATIBLE" });
    expect(typeof incompatible.json().requestId).toBe("string");
    // ShiftedBlack with a sufficient shift is fine on the same strike.
    expect((await price({ ...cap, model: "ShiftedBlack", shift: 0.03, strike: -0.01 })).statusCode).toBe(200);
    const fxo = (await price(await trade("FXO-0001"))).json();
    expect(fxo.details.standardDelivery).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fxo.details.spotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fxo.details.standardDelivery > fxo.details.spotDate).toBe(true);
  });

  it("OpenAPI: ErrorResponse.code documents every core and API code, the warning prefixes and the analytics keys; README-listed codes are stable", () => {
    const doc = app.swagger() as unknown as {
      components: { schemas: Record<string, { properties?: Record<string, { description?: string; examples?: string[] }> }> };
    };
    const code = doc.components.schemas.ErrorResponse!.properties!.code! as { description?: string; examples?: string[]; example?: unknown };
    // The full list (not a single collapsed `example`) is what SDK generators and Swagger UI show.
    expect(code.example).toBeUndefined();
    expect(code.examples).toEqual([...API_ERROR_CODES.core, ...API_ERROR_CODES.api]);
    for (const c of [...API_ERROR_CODES.core, ...API_ERROR_CODES.api]) expect(code.description, c).toContain(c);
    for (const c of ["INVALID_FREQUENCY", "UNKNOWN_DAYCOUNT", "TOO_MANY_PERIODS", "VOL_MODEL_INCOMPATIBLE", "INVALID_CREDIT_CURVE", "INVALID_TIMESTAMP"]) {
      expect(API_ERROR_CODES.core).toContain(c);
    }
    for (const w of WARNING_PREFIXES) expect(code.description).toContain(`${w}:`);
    // Warning prefixes are not error codes.
    expect(code.examples).not.toContain("VOL_TYPE_CONVERTED");
    expect(code.examples).not.toContain("HAZARD_FLOORED");
    const json = JSON.stringify(doc);
    expect(json).toContain("`volConverted`");
    expect(json).toContain("`surfaceVolatility`");
    expect(json).toContain("`standardDelivery`");
    // The API-level codes the routes emit are all listed (kept in sync by hand – grep the routes when adding one).
    for (const c of [
      "CSV_INVALID",
      "CSV_ROW_INVALID",
      "SNAPSHOT_MALFORMED",
      "SNAPSHOT_INVALID",
      "PERIOD_BUDGET_EXCEEDED",
      "STORE_BUDGET_EXCEEDED",
      "PRECONDITION_FAILED",
      "PRECONDITION_REQUIRED",
      "NOT_FOUND",
      "CONFLICT",
      "ID_MISMATCH",
      "INVALID_QUERY_MAP",
      "INVALID_REQUEST",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ]) {
      expect(API_ERROR_CODES.api).toContain(c);
    }
    for (const c of ["INVALID_DATE", "INVALID_TENOR"]) expect(API_ERROR_CODES.core).toContain(c);
    // N4-05: the catalogue lists INTERNAL_ERROR (batch results / 500) in `examples`, not only in the prose.
    expect(code.examples).toContain("INTERNAL_ERROR");
  });

  it("snapshot id: GET /api/market/snapshot ETag = X-Market-Snapshot-Id = report.audit.snapshotId, on the full market scope (a fixing changes it)", async () => {
    const app2 = await buildApp({ logger: false });
    const snapshotEtag = async () => String((await app2.inject({ method: "GET", url: "/api/market/snapshot" })).headers.etag);
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const report = async () => app2.inject({ method: "POST", url: "/api/report", payload: { trade: t, includeRisk: false } });
    const etag = await snapshotEtag();
    const rep = await report();
    expect(rep.statusCode).toBe(200);
    const id = rep.json().audit.snapshotId as string;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(etag).toBe(`"${id}"`);
    expect(rep.headers["x-market-snapshot-id"]).toBe(id);
    const portfolio = await app2.inject({ method: "POST", url: "/api/report/portfolio", payload: { trades: [t] } });
    expect(portfolio.json().audit.snapshotId).toBe(id);
    expect(portfolio.headers["x-market-snapshot-id"]).toBe(id);
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": `"${id}"` } })).statusCode).toBe(304);
    // Full scope: an added fixing (not a curve node or spot) changes the id everywhere consistently.
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { fixings: [{ index: "EURIBOR-6M", date: "2026-09-01", value: 0.0205 }] } });
    expect(put.statusCode, put.body).toBe(200);
    const id2 = String(put.headers["x-market-snapshot-id"]);
    expect(id2).not.toBe(id);
    expect(put.json().snapshotId).toBe(id2);
    expect(await snapshotEtag()).toBe(`"${id2}"`);
    const rep2 = await report();
    expect(rep2.json().audit.snapshotId).toBe(id2);
    expect(rep2.headers["x-market-snapshot-id"]).toBe(id2);
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag } })).statusCode).toBe(200);
    // Re-importing the exported snapshot reproduces the same id (round trip through `deriva.market/1`).
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    const imported = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().snapshotId).toBe(id2);
    await app3.close();
    await app2.close();
  }, 60000);
});
