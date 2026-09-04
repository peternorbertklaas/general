/**
 * Round-4 review findings (docs/quality/review-architektur-r4.md, review-markt-r4.md):
 * N4-01 budget on hedge routes, store-pricing GET routes and the store cap,
 * N4-02 trustProxy / rate-limit key, N4-03 date errors as 400 INVALID_DATE,
 * N4-05 catalogued codes on every envelope, N4-06 EMIR POST body + query cap +
 * query-free logs, N4-08 ITS value formats, N3-04 documented core surface only,
 * R4-5 vol surfaces via PUT /api/market, text/csv in the import request body.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { PricingError, parseISO, parseTenor } from "@deriva/pricing-core";
import { buildApp, parseTrustProxy, stripQuery } from "./app.js";
import { classifyError, describeError, describeRowError } from "./lib/errors.js";
import { assertStoreBudget, defaultLimits, storePeriods, tradePeriods } from "./lib/limits.js";
import { API_ERROR_CODES, EMIR_BOOLEAN, EMIR_CLEARED, EMIR_CLEARING_OBLIGATION } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;

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
const swap = (frequency: string, years: number, id = "r4") => ({
  id,
  type: "InterestRateSwap",
  legs: [leg("Fixed", frequency, years, { rate: 0.026 }), leg("Float", frequency, years, { index: "EURIBOR-6M" })],
});
const relationship = (hedgingInstrumentId: string) => ({
  id: "HR-R4",
  name: "Kredit Halle A",
  type: "CashFlowHedge",
  hedgedItem: {
    description: "Variabler Kredit",
    currency: "EUR",
    notional: 1e7,
    kind: "FloatingRateLoan",
    index: "EURIBOR-6M",
    effectiveDate: "2026-09-07",
    maturityDate: "2036-09-07",
  },
  hedgingInstrumentId,
  designationDate: "2026-09-03",
  method: "DollarOffset",
  accountingFramework: "IFRS9",
});

describe("N4-01 compute budget covers hedge routes, store-pricing GETs and the store size", () => {
  it("rejects a 1D × 100Y hedging instrument with 400 TOO_MANY_PERIODS on both hedge routes (API guard, not the core backstop)", async () => {
    for (const url of ["/api/hedge/effectiveness", "/api/hedge/hypothetical"]) {
      const r = await app.inject({ method: "POST", url, payload: { relationship: relationship("big"), hedgingInstrument: swap("1D", 100, "big") } });
      expect(r.statusCode, url).toBe(400);
      expect(r.json(), url).toMatchObject({ code: "TOO_MANY_PERIODS", details: { tradeId: "big" } });
    }
    // A stored instrument counts with the hedge weight (regression set ≈ 40 valuations per trade).
    const tiny = await buildApp({ logger: false, limits: { maxWeightedPeriodsPerRequest: 100 } });
    const r = await tiny.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relationship("IRS-0001") } });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ code: "PERIOD_BUDGET_EXCEEDED", details: { weight: 40, source: "store", trades: 1 } });
    // Unknown stored instrument: the route answers its 404 with a code (on the default budget – since R5 the hedged item's
    // own schedule counts too, so the tiny budget above would trip 413 before the lookup, N5-04).
    const missing = await app.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relationship("NOPE") } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("NOT_FOUND");
    expect((await tiny.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relationship("NOPE") } })).statusCode).toBe(413);
    await tiny.close();
    // The sample relationship on the default budget still works.
    const ok = await app.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relationship("IRS-0001") } });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("applies the request budget to GET /api/trades?price=1, /api/emir/valuations (GET and POST) and the store-backed portfolio report", async () => {
    const tiny = await buildApp({ logger: false, limits: { maxPeriodsPerRequest: 10 } });
    for (const [method, url, payload] of [
      ["GET", "/api/trades?price=1", undefined],
      ["GET", "/api/emir/valuations", undefined],
      ["POST", "/api/emir/valuations", {}],
      ["POST", "/api/report/portfolio", {}],
    ] as const) {
      const r = await tiny.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(r.statusCode, `${method} ${url}`).toBe(413);
      expect(r.json(), `${method} ${url}`).toMatchObject({ code: "PERIOD_BUDGET_EXCEEDED", details: { source: "store", maxPeriodsPerRequest: 10 } });
      expect(String(r.json().error)).toMatch(/trade store/);
    }
    // Listing without pricing and other reads stay unbounded.
    expect((await tiny.inject({ method: "GET", url: "/api/trades" })).statusCode).toBe(200);
    expect((await tiny.inject({ method: "GET", url: "/api/trades/IRS-0001" })).statusCode).toBe(200);
    await tiny.close();
    // The contract documents 413 on the store-pricing routes.
    const doc = app.swagger() as unknown as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    expect(Object.keys(doc.paths["/api/trades"]!.get!.responses)).toContain("413");
    expect(Object.keys(doc.paths["/api/emir/valuations"]!.get!.responses)).toContain("413");
    expect(Object.keys(doc.paths["/api/emir/valuations"]!.post!.responses)).toContain("413");
  });

  it("caps the cumulative store (MAX_STORE_PERIODS → 413 STORE_BUDGET_EXCEEDED) on create, import and replace, netting replaced trades", async () => {
    expect(defaultLimits().maxStorePeriods).toBe(200_000);
    process.env.MAX_STORE_PERIODS = "777";
    expect(defaultLimits().maxStorePeriods).toBe(777);
    delete process.env.MAX_STORE_PERIODS;
    const small = await buildApp({ logger: false, seedPortfolio: false, limits: { maxStorePeriods: 50 } });
    const ten = (id: string) => swap("1Y", 10, id); // 10 + 10 = 20 estimated periods
    expect(tradePeriods(ten("a"))).toBe(20);
    expect((await small.inject({ method: "POST", url: "/api/trades", payload: ten("A") })).statusCode).toBe(201);
    expect((await small.inject({ method: "POST", url: "/api/trades", payload: ten("B") })).statusCode).toBe(201);
    const third = await small.inject({ method: "POST", url: "/api/trades", payload: ten("C") });
    expect(third.statusCode).toBe(413);
    expect(third.json()).toMatchObject({
      statusCode: 413,
      code: "STORE_BUDGET_EXCEEDED",
      details: { trades: 1, storePeriods: 40, storePeriodsAfter: 60, maxStorePeriods: 50 },
    });
    expect(String(third.json().error)).toMatch(/MAX_STORE_PERIODS/);
    expect((await small.inject({ method: "GET", url: "/api/trades/C" })).statusCode).toBe(404);
    // Replacing a stored trade nets its old size: same size passes, a larger one trips.
    expect((await small.inject({ method: "PUT", url: "/api/trades/A", payload: ten("A") })).statusCode).toBe(200);
    expect((await small.inject({ method: "PUT", url: "/api/trades/A", payload: swap("1Y", 20, "A") })).statusCode).toBe(413);
    expect((await small.inject({ method: "POST", url: "/api/trades?upsert=1", payload: swap("6M", 5, "A") })).statusCode).toBe(200); // 10 + 10 = 20
    // Import: the whole batch is bounded before anything is written.
    const imp = await small.inject({ method: "POST", url: "/api/trades/import", payload: { trades: [ten("D"), ten("E")], mode: "upsert" } });
    expect(imp.statusCode).toBe(413);
    expect(imp.json().code).toBe("STORE_BUDGET_EXCEEDED");
    expect((await small.inject({ method: "GET", url: "/api/trades" })).json()).toHaveLength(2);
    // A small import that replaces existing ids fits.
    const ok = await small.inject({ method: "POST", url: "/api/trades/import", payload: { trades: [ten("A"), ten("B")], mode: "upsert" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().imported).toBe(2);
    // Non-store routes are not affected by the store cap.
    expect((await small.inject({ method: "POST", url: "/api/price", payload: { trade: swap("1M", 50, "huge") } })).statusCode).toBe(200);
    await small.close();
    // Unit: the helper nets by id and counts every incoming trade.
    const ctx = { trades: { list: () => [{ trade: ten("X") }, { trade: ten("Y") }], get: () => undefined } } as never;
    expect(storePeriods(ctx)).toBe(40);
    expect(() => assertStoreBudget(ctx, [ten("X")], { ...defaultLimits(), maxStorePeriods: 40 })).not.toThrow();
    expect(() => assertStoreBudget(ctx, [ten("Z")], { ...defaultLimits(), maxStorePeriods: 40 })).toThrow(/store budget/);
    // The contract advertises the store budget.
    expect((app.swagger() as { info: { description: string } }).info.description).toContain("STORE_BUDGET_EXCEEDED");
  });
});

describe("N4-02 trustProxy and the rate-limit key", () => {
  it("parses TRUST_PROXY (off | on | CIDR list)", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("1")).toBe(true);
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.1")).toEqual(["10.0.0.0/8", "172.16.0.1"]);
    expect(stripQuery("/api/x?uti=1")).toBe("/api/x");
    expect(stripQuery(undefined)).toBe("");
  });

  it("keys the limit per client IP: X-Forwarded-For separates buckets only with trustProxy; health probes are exempt", async () => {
    const xff = (ip: string) => ({ "x-forwarded-for": ip });
    // Default (no proxy trusted): every request from the socket shares one bucket regardless of the header.
    const shared = await buildApp({ logger: false, seedPortfolio: false, rateLimitMax: 2 });
    expect((await shared.inject({ method: "GET", url: "/api/market", headers: xff("1.1.1.1") })).statusCode).toBe(200);
    expect((await shared.inject({ method: "GET", url: "/api/market", headers: xff("2.2.2.2") })).statusCode).toBe(200);
    const limited = await shared.inject({ method: "GET", url: "/api/market", headers: xff("3.3.3.3") });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
    expect(typeof limited.json().requestId).toBe("string");
    // Health stays reachable for probes while a client is throttled.
    expect((await shared.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await shared.inject({ method: "GET", url: "/api/health/ready?x=1" })).statusCode).toBe(200);
    expect((await shared.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    await shared.close();
    // Behind a trusted proxy the forwarded client address is the key: three clients, three buckets.
    const proxied = await buildApp({ logger: false, seedPortfolio: false, rateLimitMax: 2, trustProxy: true });
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"])
      expect((await proxied.inject({ method: "GET", url: "/api/market", headers: xff(ip) })).statusCode).toBe(200);
    expect((await proxied.inject({ method: "GET", url: "/api/market", headers: xff("1.1.1.1") })).statusCode).toBe(200);
    expect((await proxied.inject({ method: "GET", url: "/api/market", headers: xff("1.1.1.1") })).statusCode).toBe(429);
    expect((await proxied.inject({ method: "GET", url: "/api/market", headers: xff("2.2.2.2") })).statusCode).toBe(200);
    await proxied.close();
    // The env switch feeds the default.
    process.env.TRUST_PROXY = "true";
    const env = await buildApp({ logger: false, seedPortfolio: false, rateLimitMax: 1 });
    expect((await env.inject({ method: "GET", url: "/api/market", headers: xff("1.1.1.1") })).statusCode).toBe(200);
    expect((await env.inject({ method: "GET", url: "/api/market", headers: xff("2.2.2.2") })).statusCode).toBe(200);
    expect((await env.inject({ method: "GET", url: "/api/market", headers: xff("2.2.2.2") })).statusCode).toBe(429);
    await env.close();
    delete process.env.TRUST_PROXY;
    // Documented: the 429 description names the key and TRUST_PROXY; health routes carry no 429.
    const doc = app.swagger() as unknown as { paths: Record<string, Record<string, { responses: Record<string, { description?: string }> }>> };
    expect(doc.paths["/api/market"]!.get!.responses["429"]!.description).toMatch(/TRUST_PROXY/);
    expect(doc.paths["/api/health"]!.get!.responses["429"]).toBeUndefined();
  });
});

describe("N4-03 invalid calendar dates are client errors (400 INVALID_DATE), not domain errors", () => {
  it("classifies the core's plain date / tenor errors and answers 400 with a code on the routes", async () => {
    expect(classifyError(new Error("Invalid date: 2027-02-30"))).toMatchObject({ status: 400, code: "INVALID_DATE", message: "Invalid date: 2027-02-30" });
    expect(classifyError(new Error("Invalid ISO date: 2027-2-3"))).toMatchObject({ status: 400, code: "INVALID_DATE" });
    expect(classifyError(new Error("Invalid tenor: 5Q"))).toMatchObject({ status: 400, code: "INVALID_TENOR" });
    // Other plain errors and PricingErrors keep their 422 semantics.
    expect(classifyError(new Error("Invalid dates are not what this is about"))).toMatchObject({ status: 422, code: "DOMAIN_ERROR" });
    expect(classifyError(Object.assign(new Error("Invalid date: x"), { name: "PricingError", code: "INVALID_TRADE" }))).toMatchObject({ status: 422 });
    expect(describeError(new Error("Invalid date: 2027-02-30"))).toEqual({ message: "Invalid date: 2027-02-30", code: "INVALID_DATE" });
    const bad = swap("1Y", 5, "feb30");
    (bad.legs[0] as Json).terminationDate = "2027-02-30";
    const r = await app.inject({ method: "POST", url: "/api/price", payload: { trade: bad } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ statusCode: 400, code: "INVALID_DATE", error: "Invalid date: 2027-02-30" });
    const market = await buildApp({ logger: false, seedPortfolio: false });
    const put = await market.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2027-02-30" } });
    expect(put.statusCode).toBe(400);
    expect(put.json().code).toBe("INVALID_DATE");
    await market.close();
    // The codes are raised by the core itself (`parseISO` / `parseTenor` throw `PricingError`) and are the only PricingErrors answered with 400.
    expect(API_ERROR_CODES.core).toContain("INVALID_DATE");
    expect(API_ERROR_CODES.core).toContain("INVALID_TENOR");
    expect(classifyError(new PricingError("INVALID_DATE", "Invalid date: 2027-02-30", { input: "2027-02-30" }))).toMatchObject({
      status: 400,
      code: "INVALID_DATE",
    });
    expect(classifyError(new PricingError("INVALID_TENOR", "Invalid tenor: 5Q"))).toMatchObject({ status: 400, code: "INVALID_TENOR" });
    expect(() => parseISO("2027-02-30")).toThrow(PricingError);
    expect(() => parseTenor("5Q")).toThrow(PricingError);
  });
});

describe("N4-05 every inline error envelope carries a catalogued code", () => {
  it("404 NOT_FOUND (trade, curve, route, hedging instrument), 409 CONFLICT, 400 ID_MISMATCH / INVALID_REQUEST / CSV_INVALID, 500 INTERNAL_ERROR", async () => {
    const app2 = await buildApp({ logger: false });
    expect((await app2.inject({ method: "GET", url: "/api/trades/NOPE" })).json()).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect((await app2.inject({ method: "GET", url: "/api/market/curves/NOPE" })).json()).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    const route = await app2.inject({ method: "GET", url: "/api/nope?secret=UTISECRET" });
    expect(route.json()).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect(String(route.json().error)).not.toContain("UTISECRET");
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0001" })).json().trade;
    expect((await app2.inject({ method: "POST", url: "/api/trades", payload: t })).json()).toMatchObject({ statusCode: 409, code: "CONFLICT" });
    expect((await app2.inject({ method: "PUT", url: "/api/trades/IRS-0001", payload: { ...t, id: "OTHER" } })).json()).toMatchObject({
      statusCode: 400,
      code: "ID_MISMATCH",
    });
    expect((await app2.inject({ method: "PUT", url: "/api/trades/NOPE", payload: { ...t, id: "NOPE" } })).json()).toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect((await app2.inject({ method: "DELETE", url: "/api/trades/NOPE" })).json()).toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    const empty = await buildApp({ logger: false, seedPortfolio: false });
    expect((await empty.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { useStore: true } })).json()).toMatchObject({
      statusCode: 400,
      code: "INVALID_REQUEST",
    });
    await empty.close();
    expect(
      (
        await app2.inject({
          method: "POST",
          url: "/api/xva/hazard-curve",
          payload: { quotes: [{ tenor: "1Y", spread: 0.01 }], recovery: 0.4, discountCurveId: "NOPE" },
        })
      ).json(),
    ).toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(
      (await app2.inject({ method: "POST", url: "/api/trades/import", headers: { "content-type": "text/csv" }, payload: "a;b\n1;2\n" })).json(),
    ).toMatchObject({
      statusCode: 400,
      code: "CSV_INVALID",
    });
    expect(classifyError(Object.assign(new Error("socket"), { code: "ECONNRESET", errno: -104, syscall: "read" }))).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(describeRowError(new TypeError("Cannot read properties of undefined"))).toBe("Invalid row");
    expect(describeRowError(new Error('not a number: "abc"'))).toBe('not a number: "abc"');
    expect(describeRowError("x")).toBe("Invalid row");
    await app2.close();
  });

  it("OpenAPI: INTERNAL_ERROR and the inline codes are in `examples`; no deprecated schema-level `example` remains", () => {
    const doc = app.swagger() as unknown as {
      components: { schemas: Record<string, { properties?: Record<string, { examples?: string[] }>; examples?: unknown[] }> };
    };
    const examples = doc.components.schemas.ErrorResponse!.properties!.code!.examples!;
    for (const c of [
      "INTERNAL_ERROR",
      "NOT_FOUND",
      "CONFLICT",
      "ID_MISMATCH",
      "INVALID_QUERY_MAP",
      "INVALID_REQUEST",
      "INVALID_DATE",
      "STORE_BUDGET_EXCEEDED",
      "RATE_LIMITED",
    ]) {
      expect(examples, c).toContain(c);
    }
    expect(JSON.stringify(doc.components)).not.toMatch(/"example":/);
    expect(Array.isArray(doc.components.schemas.Trade!.examples)).toBe(true);
    expect((doc.components.schemas.Trade!.examples![0] as { type: string }).type).toBe("InterestRateSwap");
  });
});

describe("N4-06 EMIR maps via POST body, query maps capped, queries kept out of logs", () => {
  it("POST /api/emir/valuations accepts uti / transactionPrice as JSON objects (JSON and CSV), validates them and shares the GET options", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/emir/valuations",
      payload: { uti: { "IRS-0002": "UTI0002ABC" }, transactionPrice: { "IRS-0001": 0 }, asOf: "2026-09-03T17:00:00Z", clearingObligation: true },
    });
    expect(r.statusCode, r.body).toBe(200);
    const recs = r.json() as Record<string, unknown>[];
    expect(recs.find((x) => x.tradeId === "IRS-0002")).toMatchObject({ uti: "UTI0002ABC", valuationMethod: "MTMO", clearingObligation: "TRUE" });
    expect(recs.find((x) => x.tradeId === "IRS-0001")).toMatchObject({ valuationMethod: "MTMA", valuationTimestamp: "2026-09-03T17:00:00Z" });
    expect(r.headers["x-market-snapshot-id"]).toMatch(/^[0-9a-f]{16}$/);
    const csv = await app.inject({ method: "POST", url: "/api/emir/valuations", payload: { format: "csv", uti: { "IRS-0002": "UTI0002ABC" } } });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("UTI0002ABC");
    expect((await app.inject({ method: "POST", url: "/api/emir/valuations", payload: { uti: { "IRS-0002": "not a uti!" } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/emir/valuations", payload: { uti: ["x"] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/emir/valuations", payload: { transactionPrice: { "IRS-0001": "zero" } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/emir/valuations", payload: { method: "XYZ" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/emir/valuations", payload: { "../x": 1 } })).statusCode).toBe(400);
    // Empty body = GET defaults.
    const dflt = await app.inject({ method: "POST", url: "/api/emir/valuations", payload: {} });
    expect(dflt.statusCode).toBe(200);
    expect((dflt.json() as unknown[]).length).toBeGreaterThan(5);
  });

  it("GET caps each query map at 4 kB with a clear INVALID_QUERY_MAP message pointing at POST; malformed maps carry the code too", async () => {
    const big = encodeURIComponent(JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`T${i}`, `UTI${"X".repeat(20)}${i}`]))));
    expect(big.length).toBeGreaterThan(4000);
    const r = await app.inject({ method: "GET", url: `/api/emir/valuations?uti=${big}` });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ statusCode: 400, code: "INVALID_QUERY_MAP" });
    expect(String(r.json().error)).toMatch(/POST \/api\/emir\/valuations/);
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?uti=not-json" })).json()).toMatchObject({ code: "INVALID_QUERY_MAP" });
    expect((await app.inject({ method: "GET", url: `/api/emir/valuations?transactionPrice=${encodeURIComponent('{"a":"x"}')}` })).json()).toMatchObject({
      code: "INVALID_QUERY_MAP",
    });
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain('"maxLength":4000');
    expect(doc).not.toContain('"maxLength":20000');
  });

  it("request and error logs carry the path but never the query string", async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const logged = await buildApp({ logger: { level: "info", stream } as never, seedPortfolio: true, disableRequestLogging: false });
    const uti = encodeURIComponent(JSON.stringify({ "IRS-0002": "UTISECRET123" }));
    const price = encodeURIComponent(JSON.stringify({ "IRS-0002": -12345 }));
    expect((await logged.inject({ method: "GET", url: `/api/emir/valuations?uti=${uti}&transactionPrice=${price}` })).statusCode).toBe(200);
    // 404 path (not-found handler) and a 400 from the classifier with a query attached.
    expect((await logged.inject({ method: "GET", url: "/api/nope?uti=UTISECRET123" })).statusCode).toBe(404);
    const bad = swap("1Y", 5, "feb30");
    (bad.legs[0] as Json).terminationDate = "2027-02-30";
    expect((await logged.inject({ method: "POST", url: "/api/price?tag=UTISECRET123", payload: { trade: bad } })).statusCode).toBe(400);
    await logged.close();
    const all = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(all).toContain("/api/emir/valuations");
    expect(all).toContain('"remoteAddress"');
    expect(all).not.toContain("UTISECRET123");
    expect(all).not.toContain("-12345");
    expect(all).not.toContain("transactionPrice");
    expect(all).not.toContain("?");
  });
});

describe("N4-08 EMIR value formats follow ITS (EU) 2022/1860 Table 2", () => {
  it("emits Y/N/I, TRUE/FLSE/UKWN and TRUE/FLSE (core record = contract enums), `intentToClear` selects I, never FALSE / N/A in JSON or CSV", async () => {
    expect([...EMIR_CLEARED]).toEqual(["Y", "N", "I"]);
    expect([...EMIR_CLEARING_OBLIGATION]).toEqual(["TRUE", "FLSE", "UKWN"]);
    expect([...EMIR_BOOLEAN]).toEqual(["TRUE", "FLSE"]);
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    expect(
      (await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "CLR-Y", cleared: true, clearingObligation: true } })).statusCode,
    ).toBe(201);
    expect(
      (await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "CLR-N", cleared: true, clearingObligation: false } })).statusCode,
    ).toBe(201);
    // A collateralised trade (CSA currency) reports the collateral portfolio indicator TRUE.
    const ccs = await app2.inject({
      method: "POST",
      url: "/api/trades/from-template",
      payload: {
        template: "CrossCurrencySwap",
        params: {
          id: "CCS-COL",
          pair: "EURUSD",
          domesticNotional: 1e7,
          fxSpot: 1.17,
          spread: 0,
          effectiveDate: "2026-09-07",
          tenor: "5Y",
          collateralCurrency: "USD",
        },
      },
    });
    expect(ccs.statusCode, ccs.body).toBe(200);
    expect((await app2.inject({ method: "POST", url: "/api/trades", payload: ccs.json().trade })).statusCode).toBe(201);
    const recs = (await app2.inject({ method: "GET", url: "/api/emir/valuations" })).json() as Record<string, string>[];
    const by = (id: string) => recs.find((r) => r.tradeId === id)!;
    expect(by("CLR-Y")).toMatchObject({ cleared: "Y", clearingObligation: "TRUE", collateralPortfolioIndicator: "FLSE" });
    expect(by("CLR-N")).toMatchObject({ cleared: "Y", clearingObligation: "FLSE" });
    expect(by("IRS-0002")).toMatchObject({ cleared: "N", clearingObligation: "UKWN" });
    expect(by("CCS-COL").collateralPortfolioIndicator).toBe("TRUE");
    for (const r of recs) {
      expect(["Y", "N", "I"]).toContain(r.cleared);
      expect(["TRUE", "FLSE", "UKWN"]).toContain(r.clearingObligation);
      expect(["TRUE", "FLSE"]).toContain(r.collateralPortfolioIndicator);
    }
    const json = JSON.stringify(recs);
    expect(json).not.toContain('"FALSE"');
    expect(json).not.toContain('"N/A"');
    const csv = (await app2.inject({ method: "GET", url: "/api/emir/valuations?format=csv" })).body;
    expect(csv.split("\n")[0]).toContain("Collateral portfolio indicator;Cleared;Clearing obligation");
    expect(csv.split("\n").some((l) => l.includes("CLR-Y") && l.includes(";FLSE;Y;TRUE;"))).toBe(true);
    expect(csv).not.toMatch(/;FALSE;|;N\/A;/);
    // Intent to clear (field 31 `I`) for not-yet-cleared trades – query and body variant; cleared trades stay `Y`.
    const intentQ = (await app2.inject({ method: "GET", url: "/api/emir/valuations?intentToClear=true" })).json() as Record<string, string>[];
    expect(intentQ.find((r) => r.tradeId === "IRS-0002")!.cleared).toBe("I");
    expect(intentQ.find((r) => r.tradeId === "CLR-Y")!.cleared).toBe("Y");
    const intentB = (await app2.inject({ method: "POST", url: "/api/emir/valuations", payload: { intentToClear: true } })).json() as Record<string, string>[];
    expect(intentB.find((r) => r.tradeId === "IRS-0002")!.cleared).toBe("I");
    expect((await app2.inject({ method: "GET", url: "/api/emir/valuations?intentToClear=maybe" })).statusCode).toBe(400);
    // The contract documents the ITS literals.
    const doc = JSON.stringify(app2.swagger());
    expect(doc).toContain('"enum":["Y","N","I"]');
    expect(doc).toContain('"enum":["TRUE","FLSE","UKWN"]');
    expect(doc).toContain('"enum":["TRUE","FLSE"]');
    await app2.close();
  });
});

describe("N3-04 the API imports only the documented public surface of the core (ADR-024)", () => {
  /** Public surface per ADR-024 (types and values); anything else is internal and must not be imported by the API. */
  const PUBLIC_CORE_API = new Set([
    // Types
    "BootstrapSpec",
    "ConfirmationParties",
    "CreditInputs",
    "CrossCurrencySwapParams",
    "Curve",
    "CurveQuote",
    "EmirRecordOptions",
    "EmirValuationRecord",
    "Fixing",
    "FxOption",
    "HedgeRelationship",
    "InterpolatedCurve",
    "KidOptions",
    "MarketContext",
    "MarketSnapshotJson",
    "FxFixing",
    "MasterAgreementRef",
    "ParRiskSpecs",
    "PortfolioReport",
    "RateIndex",
    "ReportPerspective",
    "SampleMarketQuotes",
    "ScenarioDefinition",
    "SwapConventions",
    "SuitabilityInputs",
    "Trade",
    "ValuationGovernance",
    "VegaBucketOptions",
    // Constants
    "HISTORICAL_SCENARIOS",
    "STANDARD_SCENARIOS",
    "MAX_PERIODS",
    "SAMPLE_CURVE_IDS",
    "SAMPLE_QUOTES",
    "RATE_INDICES",
    // Dates / calendars / conventions
    "parseISO",
    "toISO",
    "advance",
    "addTenor",
    "getCalendar",
    "yearFraction",
    "frequencyPerYear",
    "fraIndexForPeriod",
    // Market
    "buildSampleMarket",
    "sampleBootstrapSpecs",
    "bootstrapCurve",
    "serializeMarket",
    "deserializeMarket",
    "validateMarket",
    "validateVolSurfaces",
    "volSurfaceWarnings",
    "VolSurfacesInput",
    "marketSnapshotId",
    "knownCurrencies",
    "knownIndices",
    // Register (Markt R6-5 rest, ADR-027): runtime indices / conventions, sample fixings for the valuation-date rebuild (R7-4)
    "registerRateIndex",
    "registerSwapConventions",
    "isBuiltInIndex",
    "getSwapConventions",
    "sampleFixings",
    // Round 8 (Markt R8-2 calendars, R8-3 par risk for runtime curves, Architektur N8-01 valuation-date rebuild / import roll,
    // N8-04 atomic envelope import with the core's validators)
    "CustomCalendarJson",
    "customCalendarFromJson",
    "registerCalendar",
    "isBuiltInCalendar",
    "validateCustomCalendar",
    "validateRateIndex",
    "validateSwapConventions",
    "rollMarket",
    "tradeCurveIds",
    // R10: spec ↔ curve consistency of the par-risk specs (Markt R10-1; ADR-024 R10)
    "checkParRiskSpecs",
    "ParRiskSpecCheck",
    // Builders
    "makeVanillaSwap",
    "makeCapFloor",
    "makeSwaption",
    "makeFxForward",
    "makeFxOption",
    "makeCrossCurrencySwap",
    "makeFra",
    "makeFxSwap",
    "makeBasisSwap",
    "makeAmortisingSwap",
    "makeImmSwap",
    // Pricing / risk / scenarios / XVA
    "priceTrade",
    "pricePortfolio",
    "computeRisk",
    "parRisk",
    "parRiskPortfolio",
    "vegaBuckets",
    "runScenarios",
    "scenarioGrid",
    "computeXva",
    "bootstrapHazardCurve",
    "survivalProbability",
    // Reporting / documents / EMIR / hedge
    "buildValuationReport",
    "cashflowTable",
    "toCsv",
    "buildPortfolioReport",
    "portfolioReportToMarkdown",
    "emirValuationRecord",
    "emirCsv",
    "generateTermsheet",
    "generateSuitabilityStatement",
    "generateConfirmation",
    "generateKid",
    "hedgeEffectivenessReport",
    "hypotheticalDerivative",
    // Errors / hashing
    "PricingError",
    "isPricingError",
    "stableStringify",
    "hashString",
  ]);

  it("every name imported from @deriva/pricing-core in apps/api/src (non-test) is on the ADR-024 allowlist; module counters stay internal", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const imported = new Map<string, string[]>();
    const re = /import\s*\{([^}]*)\}\s*from\s*"@deriva\/pricing-core"/g;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(re)) {
        for (const raw of m[1]!.split(",")) {
          const name = raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]!
            .trim();
          if (name) imported.set(name, [...(imported.get(name) ?? []), f.slice(root.length + 1)]);
        }
      }
    }
    expect(imported.size).toBeGreaterThan(40);
    const offenders = [...imported.entries()].filter(([name]) => !PUBLIC_CORE_API.has(name)).map(([name, where]) => `${name} (${where.join(", ")})`);
    expect(offenders, "imports outside the ADR-024 public surface").toEqual([]);
    for (const internal of ["nextTradeId", "resetTradeIds", "interpolate", "brent", "normCdf"]) expect(imported.has(internal), internal).toBe(false);
  });
});

describe("Core R4 surface: FX fixings for MtM-reset CCS and market-aware FRA template index", () => {
  it("PUT /api/market { fxFixings } feeds a seasoned MtM-reset CCS (different PV, no MISSING_FX_FIXING), survives a valuation-date rebuild and round-trips through the snapshot", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    // EUR/USD 3Y traded 2025-09-08 at 1.08 with quarterly MtM resets; current period starts 2026-06-08 (core test R4-1).
    const built = await app2.inject({
      method: "POST",
      url: "/api/trades/from-template",
      payload: {
        template: "CrossCurrencySwap",
        params: { id: "CCS-MTM", pair: "EURUSD", domesticNotional: 1e7, fxSpot: 1.08, spread: 0, effectiveDate: "2025-09-08", tenor: "3Y", mtmReset: true },
      },
    });
    expect(built.statusCode, built.body).toBe(200);
    const ccs = built.json().trade;
    const price = async () => (await app2.inject({ method: "POST", url: "/api/price", payload: { trade: ccs } })).json() as { pv: number; warnings: string[] };
    const without = await price();
    const missing = without.warnings.filter((w) => w.startsWith("MISSING_FX_FIXING:"));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("EURUSD");
    expect(missing[0]).toContain("2026-06-08");
    const idBefore = String((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId);
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { fxFixings: [{ pair: "EURUSD", date: "2026-06-08", rate: 1.1 }] } });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().fxFixings).toEqual([{ pair: "EURUSD", date: "2026-06-08", rate: 1.1 }]);
    expect(put.json().snapshotId).not.toBe(idBefore); // fixings are part of the snapshot id
    const withFixing = await price();
    expect(withFixing.warnings.some((w) => w.startsWith("MISSING_FX_FIXING"))).toBe(false);
    expect(withFixing.pv - without.pv).toBeGreaterThan(400_000); // ≈ 5 % of the notional (core test R4-1)
    // Same pair + date replaces, a new date is appended; the audit entry counts them.
    const put2 = await app2.inject({
      method: "PUT",
      url: "/api/market",
      payload: {
        fxFixings: [
          { pair: "EURUSD", date: "2026-06-08", rate: 1.12 },
          { pair: "EURUSD", date: "2026-03-09", rate: 1.09 },
        ],
      },
    });
    expect(put2.json().fxFixings).toHaveLength(2);
    expect((put2.json().fxFixings as { rate: number }[]).find((f) => f.rate === 1.1)).toBeUndefined();
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json().entries as { action: string; details: Record<string, unknown> }[];
    expect(audit.filter((e) => e.action === "market.update").map((e) => e.details.fxFixings)).toEqual([1, 2]);
    // A valuation-date change rebuilds the sample market but keeps the fixings (history is not sample data).
    const roll = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-09-04" } });
    expect(roll.statusCode).toBe(200);
    expect(roll.json().fxFixings).toHaveLength(2);
    // Snapshot export carries `fxFixings`; the schema accepts it on import and rejects malformed entries.
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    expect(snap.fxFixings).toHaveLength(2);
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(200);
    expect((await app3.inject({ method: "GET", url: "/api/market/snapshot" })).json().fxFixings).toHaveLength(2);
    for (const bad of [
      { fxFixings: [{ pair: "EUR", date: "2026-06-08", rate: 1.1 }] },
      { fxFixings: [{ pair: "EURUSD", date: "08.06.2026", rate: 1.1 }] },
      { fxFixings: [{ pair: "EURUSD", date: "2026-06-08", rate: 0 }] },
      { fxFixings: [{ pair: "EURUSD", date: "2026-06-08" }] },
    ]) {
      expect((await app3.inject({ method: "PUT", url: "/api/market", payload: bad })).statusCode, JSON.stringify(bad)).toBe(400);
      expect((await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, ...bad } })).statusCode, JSON.stringify(bad)).toBe(400);
    }
    await app3.close();
    await app2.close();
  });

  it("from-template FRA picks the period index among the indices that have a curve in the loaded market (1x2 → EURIBOR-3M, 3x9 → EURIBOR-6M, explicit index wins)", async () => {
    const fra = async (start: string, extra: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url: "/api/trades/from-template",
        payload: { template: "FRA", params: { currency: "EUR", notional: 5e6, payReceive: "Pay", start, rate: 0.022, ...extra }, price: true },
      });
    const short = await fra("1x2");
    expect(short.statusCode, short.body).toBe(200);
    expect(short.json().trade.index).toBe("EURIBOR-3M");
    expect(typeof short.json().pricing.pv).toBe("number");
    const long = await fra("12x24");
    expect(long.statusCode, long.body).toBe(200);
    expect(long.json().trade.index).toBe("EURIBOR-6M");
    expect((await fra("3x9")).json().trade.index).toBe("EURIBOR-6M");
    expect((await fra("3x6")).json().trade.index).toBe("EURIBOR-3M");
    expect((await fra("3x6", { index: "EURIBOR-6M" })).json().trade.index).toBe("EURIBOR-6M");
  });
});

describe("R4-5 vol surfaces via PUT /api/market and the CSV request body in the contract", () => {
  it("replaces swaption / caplet / FX vol surfaces per key without a full snapshot, changes the snapshot id and audits market.vols", async () => {
    const app2 = await buildApp({ logger: false });
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as {
      swaptionVols: Record<string, { atm: number[][] }>;
      capletVols: Record<string, { vols: number[][] }>;
      fxVols: Record<string, { atm: number[] }>;
    };
    const idBefore = String((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId);
    const sw = (await app2.inject({ method: "GET", url: "/api/trades/SWPT-0001" })).json().trade;
    const pvBefore = (await app2.inject({ method: "POST", url: "/api/price", payload: { trade: sw } })).json().pv as number;
    const eur = structuredClone(snap.swaptionVols.EUR!);
    eur.atm = eur.atm.map((row) => row.map((v) => v * 1.5));
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { swaptionVols: { EUR: eur } } });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().swaptionVols).toContain("EUR");
    expect(put.json().snapshotId).not.toBe(idBefore);
    expect(put.headers["x-market-snapshot-id"]).toBe(put.json().snapshotId);
    const pvAfter = (await app2.inject({ method: "POST", url: "/api/price", payload: { trade: sw } })).json().pv as number;
    expect(pvAfter).not.toBeCloseTo(pvBefore, 0);
    expect(pvAfter).toBeGreaterThan(pvBefore); // higher vol, long swaption
    // Other keys survive a per-key replace; the exported snapshot carries the new cube.
    const after = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as typeof snap;
    expect(Object.keys(after.swaptionVols).sort()).toEqual(Object.keys(snap.swaptionVols).sort());
    expect(after.swaptionVols.EUR!.atm[0]![0]).toBeCloseTo(snap.swaptionVols.EUR!.atm[0]![0]! * 1.5, 12);
    // Caplet and FX surfaces, all three in one call.
    const capKey = Object.keys(snap.capletVols)[0]!;
    const fxKey = Object.keys(snap.fxVols)[0]!;
    const cap = structuredClone(snap.capletVols[capKey]!);
    cap.vols = cap.vols.map((row) => row.map((v) => v * 1.1));
    const fx = structuredClone(snap.fxVols[fxKey]!);
    fx.atm = fx.atm.map((v) => v * 1.1);
    const both = await app2.inject({ method: "PUT", url: "/api/market", payload: { capletVols: { [capKey]: cap }, fxVols: { [fxKey]: fx } } });
    expect(both.statusCode, both.body).toBe(200);
    expect(both.json().capletVols).toContain(capKey);
    expect(both.json().fxVols).toContain(fxKey);
    // Audit: `market.vols` names the replaced keys.
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json().entries as { action: string; details: Record<string, unknown> }[];
    const vols = audit.filter((e) => e.action === "market.vols");
    expect(vols).toHaveLength(2);
    expect(vols[0]!.details).toMatchObject({ swaption: ["EUR"], caplet: [], fx: [] });
    expect(vols[1]!.details).toMatchObject({ swaption: [], caplet: [capKey], fx: [fxKey] });
    expect(audit.filter((e) => e.action === "market.update")).toHaveLength(2);
    // Schema: the snapshot's surface schemas apply (bad shapes and unknown fields → 400); a spot-only update audits no vols.
    expect((await app2.inject({ method: "PUT", url: "/api/market", payload: { swaptionVols: { EUR: { ...eur, volType: "Weird" } } } })).statusCode).toBe(400);
    expect((await app2.inject({ method: "PUT", url: "/api/market", payload: { fxVols: { EURUSD: { id: "x" } } } })).statusCode).toBe(400);
    expect((await app2.inject({ method: "PUT", url: "/api/market", payload: { capletVols: { K: { ...cap, bogus: 1 } } } })).statusCode).toBe(400);
    expect((await app2.inject({ method: "PUT", url: "/api/market", payload: { fxSpots: { EURUSD: 1.2 } } })).statusCode).toBe(200);
    expect(
      ((await app2.inject({ method: "GET", url: "/api/audit" })).json().entries as { action: string }[]).filter((e) => e.action === "market.vols"),
    ).toHaveLength(2);
    await app2.close();
  });

  it("OpenAPI: POST /api/trades/import declares application/json and text/csv request bodies; 44 operations", () => {
    const doc = app.swagger() as unknown as {
      paths: Record<
        string,
        Record<string, { operationId?: string; requestBody?: { content: Record<string, { schema: { type?: string; description?: string } }> } }>
      >;
    };
    const content = doc.paths["/api/trades/import"]!.post!.requestBody!.content;
    expect(Object.keys(content).sort()).toEqual(["application/json", "text/csv"]);
    expect(content["text/csv"]!.schema.type).toBe("string");
    expect(content["text/csv"]!.schema.description).toMatch(/\?type=/);
    const ops = Object.values(doc.paths).flatMap((methods) => Object.values(methods).map((op) => op.operationId));
    expect(ops).toHaveLength(44);
    expect(ops).toContain("emirValuationsPost");
    expect(ops).toContain("registerCalendar");
    // `PUT /api/market` documents the three vol-surface fields.
    const put = doc.paths["/api/market"]!.put!.requestBody!.content["application/json"]!.schema as { properties: Record<string, unknown> };
    expect(Object.keys(put.properties)).toEqual(expect.arrayContaining(["swaptionVols", "capletVols", "fxVols"]));
  });
});
