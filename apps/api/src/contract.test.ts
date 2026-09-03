import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { buildApp, requestIdFrom } from "./app.js";
import { samplePortfolio } from "./lib/store.js";
import { datesToIso } from "./lib/dates.js";
import { classifyError, describeError } from "./lib/errors.js";
import { TRADE_TYPES } from "./schemas.js";

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
    expect(classifyError(Object.assign(new Error("socket"), { code: "ECONNRESET" }))).toMatchObject({
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
        expect(codes, `${method.toUpperCase()} ${path} has no 429`).toContain("429");
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
      payload: { ...t, id: "CLR-1", cleared: true, clearingMember: "Eurex Clearing AG", uti: "UTIABC123" },
    });
    expect(created.statusCode).toBe(201);
    const priceMap = encodeURIComponent(JSON.stringify({ "CLR-1": 0 }));
    const r = await app2.inject({ method: "GET", url: `/api/emir/valuations?transactionPrice=${priceMap}` });
    expect(r.statusCode).toBe(200);
    const recs = r.json() as Record<string, unknown>[];
    expect(recs.find((x) => x.tradeId === "CLR-1")).toMatchObject({
      cleared: "TRUE",
      clearingObligation: "Y",
      clearingMember: "Eurex Clearing AG",
      uti: "UTIABC123",
      valuationMethod: "MTMA",
    });
    const other = recs.find((x) => x.tradeId === "IRS-0002")!;
    expect(other).toMatchObject({ cleared: "FALSE", clearingObligation: "N", valuationMethod: "MTMO" });
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
