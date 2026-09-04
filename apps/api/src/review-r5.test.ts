/**
 * Round-5 review findings (docs/quality/review-architektur-r5.md, review-markt-r5.md):
 * N5-01 a catalogued `code` on every 4xx envelope (schema 400s, JSON parse errors, media type,
 *       body limit) and `details` kept on the 400 path (INVALID_DATE `input`),
 * N5-02 unknown routes are rate-limited,
 * N5-03 strong ETags with RFC 9110 comparison (If-Match strong, If-None-Match weak),
 * N5-04 hedge amortisation frequency pattern = trade legs; hedged-item schedule in the budget hook,
 * R5-1  structural validation of vol surfaces (PUT /api/market, snapshot import, designationSnapshot),
 * cosmetic: upper bound on notionals / amounts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { deserializeMarket, isPricingError, validateVolSurfaces } from "@deriva/pricing-core";
import { buildApp } from "./app.js";
import { classifyError, fallbackCodeFor } from "./lib/errors.js";
import { ifMatchSatisfied, ifNoneMatchSatisfied } from "./lib/etag.js";
import { hedgedItemEstimate, tradePeriods } from "./lib/limits.js";
import { volSurfaceProblems } from "./lib/vol-surfaces.js";
import { API_ERROR_CODES, MAX_AMOUNT, WARNING_PREFIXES } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;
type Doc = {
  paths: Record<string, Record<string, { operationId?: string; requestBody?: unknown; responses: Record<string, { description?: string }> }>>;
  components: { schemas: Record<string, { properties?: Record<string, { description?: string; examples?: string[] }> }> };
};

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
const swap = (frequency: string, years: number, id = "r5") => ({
  id,
  type: "InterestRateSwap",
  legs: [leg("Fixed", frequency, years, { rate: 0.026 }), leg("Float", frequency, years, { index: "EURIBOR-6M" })],
});
const relationship = (hedgingInstrumentId: string, hedgedItem: Record<string, unknown> = {}) => ({
  id: "HR-R5",
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
    ...hedgedItem,
  },
  hedgingInstrumentId,
  designationDate: "2026-09-03",
  method: "DollarOffset",
  accountingFramework: "IFRS9",
});
const snapshot = async (a: FastifyInstance = app) =>
  (await a.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json & {
    swaptionVols: Record<string, Json & { atm: number[][]; expiries: number[]; tenors: number[] }>;
    capletVols: Record<string, Json & { vols: number[][]; expiries: number[]; strikes: number[] }>;
    fxVols: Record<string, Json & { atm: number[]; expiries: number[]; rr25: number[]; bf25: number[] }>;
  };

describe("N5-01 every 4xx envelope carries a catalogued code; details survive the 400 path", () => {
  it("schema violations → 400 VALIDATION_ERROR with validation[]; JSON parse errors → 400 INVALID_JSON; media type → 415; body limit → 413", async () => {
    const unknownField = await app.inject({ method: "POST", url: "/api/price", payload: { trade: { ...swap("6M", 5), bogus: 1 } } });
    expect(unknownField.statusCode).toBe(400);
    expect(unknownField.json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(Array.isArray(unknownField.json().validation)).toBe(true);
    const negative = swap("6M", 5);
    (negative.legs[0] as Json).notional = -5;
    expect((await app.inject({ method: "POST", url: "/api/price", payload: { trade: negative } })).json().code).toBe("VALIDATION_ERROR");
    expect((await app.inject({ method: "GET", url: "/api/emir/valuations?asOf=notatime" })).json()).toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
    expect((await app.inject({ method: "GET", url: "/api/trades/..%2F..%2Fetc" })).json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    const snap = await snapshot();
    const badTime = await app.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: { ...snap, meta: { ...(snap.meta as Json), snapshotTime: "gestern" } },
    });
    expect(badTime.json()).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    // Body parse errors of Fastify's content-type parser get the catalogued code, never `FST_ERR_*`.
    const badJson = await app.inject({ method: "POST", url: "/api/price", headers: { "content-type": "application/json" }, payload: "{bad json" });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toMatchObject({ statusCode: 400, code: "INVALID_JSON", error: "Body is not valid JSON" });
    expect(JSON.stringify(badJson.json())).not.toMatch(/FST_/);
    const emptyJson = await app.inject({ method: "POST", url: "/api/price", headers: { "content-type": "application/json" }, payload: "" });
    expect(emptyJson.statusCode).toBe(400);
    expect(emptyJson.json().code).toBe("INVALID_JSON");
    // Fastify's built-in `text/plain` parser is removed (N6-03): a text body is an unsupported media type, not a schema violation.
    const textPlain = await app.inject({ method: "POST", url: "/api/price", headers: { "content-type": "text/plain" }, payload: "hello" });
    expect(textPlain.statusCode).toBe(415);
    expect(textPlain.json()).toMatchObject({ statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    const mediaType = await app.inject({ method: "POST", url: "/api/price", headers: { "content-type": "application/xml" }, payload: "<trade/>" });
    expect(mediaType.statusCode).toBe(415);
    expect(mediaType.json()).toMatchObject({ statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(typeof mediaType.json().requestId).toBe("string");
    // Unit: the classifier's fallbacks by status and Fastify code.
    expect(classifyError(Object.assign(new Error("x"), { validation: [{}] })).code).toBe("VALIDATION_ERROR");
    expect(classifyError(Object.assign(new Error("Unexpected token"), { statusCode: 400, code: "FST_ERR_CTP_INVALID_JSON_BODY" }))).toMatchObject({
      status: 400,
      code: "INVALID_JSON",
    });
    expect(classifyError(Object.assign(new Error("empty"), { statusCode: 400, code: "FST_ERR_CTP_EMPTY_JSON_BODY" })).code).toBe("INVALID_JSON");
    expect(classifyError(Object.assign(new Error("big"), { statusCode: 413, code: "FST_ERR_CTP_BODY_TOO_LARGE" })).code).toBe("PAYLOAD_TOO_LARGE");
    expect(classifyError(Object.assign(new Error("type"), { statusCode: 415, code: "FST_ERR_CTP_INVALID_MEDIA_TYPE" })).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(classifyError(Object.assign(new Error("limit"), { statusCode: 429, code: "FST_ERR_RATE_LIMIT" })).code).toBe("RATE_LIMITED");
    expect(classifyError(Object.assign(new Error("dup"), { statusCode: 409 })).code).toBe("CONFLICT");
    expect(classifyError(Object.assign(new Error("gone"), { statusCode: 404 })).code).toBe("NOT_FOUND");
    expect(fallbackCodeFor(400)).toBe("INVALID_REQUEST");
    expect(fallbackCodeFor(418)).toBe("INVALID_REQUEST");
    expect(fallbackCodeFor(412)).toBe("PRECONDITION_FAILED");
    expect(fallbackCodeFor(428)).toBe("PRECONDITION_REQUIRED");
    // Every fallback and every code the classifier can emit is catalogued.
    const all = new Set<string>([...API_ERROR_CODES.core, ...API_ERROR_CODES.api]);
    for (const s of [400, 404, 409, 412, 413, 415, 428, 429]) expect(all.has(fallbackCodeFor(s)), String(s)).toBe(true);
    expect(all.has(fallbackCodeFor(400, "FST_ERR_CTP_INVALID_JSON_BODY"))).toBe(true);
  });

  it("INVALID_DATE / INVALID_TENOR keep the core's details.input on the 400 path", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2027-02-30" } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: "INVALID_DATE", details: { input: "2027-02-30" } });
    const c = classifyError(Object.assign(new Error("Invalid tenor: 1.5Y"), { name: "PricingError", code: "INVALID_TENOR", details: { input: "1.5Y" } }));
    expect(c).toMatchObject({ status: 400, code: "INVALID_TENOR", details: { input: "1.5Y" } });
  });

  it("contract sweep: every operation with a request body answers a malformed body with 400 VALIDATION_ERROR; every 4xx carries a string code", async () => {
    const doc = app.swagger() as unknown as Doc;
    let swept = 0;
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!op.requestBody) continue;
        const url = path.replace("{id}", "IRS-0001");
        const r = await app.inject({ method: method.toUpperCase() as "POST" | "PUT", url, payload: [] });
        expect(r.statusCode, `${method} ${path}: ${r.body}`).toBe(400);
        expect(r.json(), `${method} ${path}`).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
        expect(Array.isArray(r.json().validation), `${method} ${path}`).toBe(true);
        swept++;
      }
    }
    expect(swept).toBeGreaterThanOrEqual(20);
    // Non-body 4xx paths: unknown route, unknown trade, bad path param.
    for (const [status, url, code] of [
      [404, "/api/nope", "NOT_FOUND"],
      [404, "/api/trades/NOPE", "NOT_FOUND"],
      [400, "/api/trades/bad%20id", "VALIDATION_ERROR"],
    ] as const) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(status);
      expect(r.json(), url).toMatchObject({ statusCode: status, code });
    }
  });

  it("OpenAPI: the new codes are catalogued and described; 415 is documented exactly on the operations with a request body (N6-03); 400/412/413 descriptions name the codes", () => {
    const doc = app.swagger() as unknown as Doc;
    const code = doc.components.schemas.ErrorResponse!.properties!.code!;
    for (const c of ["VALIDATION_ERROR", "INVALID_JSON", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE", "VOL_SURFACE_INVALID"]) {
      expect(API_ERROR_CODES.api, c).toContain(c);
      expect(code.examples, c).toContain(c);
      expect(code.description, c).toContain(c);
    }
    let withBody = 0;
    let withoutBody = 0;
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const codes = Object.keys(op.responses);
        if (path.startsWith("/api/health")) {
          expect(codes, path).not.toContain("415");
          expect(codes, path).not.toContain("429");
          continue;
        }
        // A body-less operation (GET, DELETE) cannot carry an unsupported media type – 415 there would be unreachable.
        if (op.requestBody) {
          expect(codes, `${method} ${path}`).toContain("415");
          withBody++;
        } else {
          expect(codes, `${method} ${path}`).not.toContain("415");
          withoutBody++;
        }
        expect(codes, `${method} ${path}`).toContain("429");
        expect(codes, `${method} ${path}`).toContain("500");
        if (codes.includes("400")) expect(op.responses["400"]!.description, `${method} ${path}`).toMatch(/VALIDATION_ERROR/);
      }
    }
    expect(withBody).toBeGreaterThanOrEqual(20);
    expect(withoutBody).toBeGreaterThanOrEqual(12);
    expect(doc.paths["/api/trades/{id}"]!.put!.responses["412"]!.description).toMatch(/strong/);
    expect(doc.paths["/api/trades"]!.post!.responses["413"]!.description).toMatch(/PAYLOAD_TOO_LARGE/);
  });
});

describe("N5-02 unknown routes are rate-limited", () => {
  it("answers 429 RATE_LIMITED on /api/nope after `max` requests; health probes stay exempt", async () => {
    const limited = await buildApp({ logger: false, seedPortfolio: false, rateLimitMax: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await limited.inject({ method: "GET", url: "/api/nope" })).statusCode);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
    const last = await limited.inject({ method: "GET", url: "/api/still-nope" });
    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
    expect(last.headers["x-ratelimit-limit"]).toBe("3");
    // Registered routes share the same bucket (the unknown-route requests consumed it).
    expect((await limited.inject({ method: "GET", url: "/api/market" })).statusCode).toBe(429);
    for (let i = 0; i < 4; i++) expect((await limited.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    await limited.close();
  });
});

describe("N5-03 strong ETags, RFC 9110 comparison", () => {
  it("unit: If-Match strong (W/ never matches), If-None-Match weak (W/ ignored), lists and *", () => {
    const etag = '"3-0123456789abcdef"';
    expect(ifMatchSatisfied(etag, etag)).toBe(true);
    expect(ifMatchSatisfied("*", etag)).toBe(true);
    expect(ifMatchSatisfied(`"1-nope", ${etag}`, etag)).toBe(true);
    expect(ifMatchSatisfied(`W/${etag}`, etag)).toBe(false);
    expect(ifMatchSatisfied('"3-0123456789abcde"', etag)).toBe(false);
    expect(ifMatchSatisfied(undefined, etag)).toBe(false);
    expect(ifMatchSatisfied("3-0123456789abcdef", etag)).toBe(false); // unquoted is not an entity-tag
    expect(ifMatchSatisfied(etag, `W/${etag}`)).toBe(false); // a weak server tag can never satisfy If-Match
    expect(ifNoneMatchSatisfied(`W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchSatisfied(etag, `W/${etag}`)).toBe(true);
    expect(ifNoneMatchSatisfied(['"x"', etag], etag)).toBe(true);
    expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
    expect(ifNoneMatchSatisfied('"other"', etag)).toBe(false);
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
  });

  it("routes: trades and snapshot carry strong ETags; W/ in If-Match → 412 with a hint, W/ in If-None-Match → 304", async () => {
    const app2 = await buildApp({ logger: false });
    const got = await app2.inject({ method: "GET", url: "/api/trades/IRS-0001" });
    const etag = String(got.headers.etag);
    expect(etag).toMatch(/^"\d+-[0-9a-f]{16}"$/);
    expect(etag.startsWith("W/")).toBe(false);
    // If-None-Match: weak comparison.
    expect((await app2.inject({ method: "GET", url: "/api/trades/IRS-0001", headers: { "if-none-match": `W/${etag}` } })).statusCode).toBe(304);
    expect((await app2.inject({ method: "GET", url: "/api/trades/IRS-0001", headers: { "if-none-match": `"stale", ${etag}` } })).statusCode).toBe(304);
    expect((await app2.inject({ method: "GET", url: "/api/trades/IRS-0001", headers: { "if-none-match": '"stale"' } })).statusCode).toBe(200);
    // If-Match: strong comparison – the weak form of the current tag does not match.
    const weak = await app2.inject({ method: "DELETE", url: "/api/trades/IRS-0001", headers: { "if-match": `W/${etag}` } });
    expect(weak.statusCode).toBe(412);
    expect(weak.json()).toMatchObject({ code: "PRECONDITION_FAILED", currentEtag: etag });
    expect(String(weak.json().error)).toMatch(/weak validator/);
    expect((await app2.inject({ method: "GET", url: "/api/trades/IRS-0001" })).statusCode).toBe(200);
    const stale = await app2.inject({ method: "DELETE", url: "/api/trades/IRS-0001", headers: { "if-match": '"0-0000000000000000"' } });
    expect(stale.statusCode).toBe(412);
    expect(String(stale.json().error)).toMatch(/mismatch/);
    const t = got.json().trade;
    const put = await app2.inject({ method: "PUT", url: "/api/trades/IRS-0001", headers: { "if-match": etag }, payload: { ...t, name: "renamed" } });
    expect(put.statusCode).toBe(200);
    expect(String(put.headers.etag)).toMatch(/^"2-[0-9a-f]{16}"$/);
    expect(put.headers.etag).not.toBe(etag);
    expect((await app2.inject({ method: "DELETE", url: "/api/trades/IRS-0001", headers: { "if-match": "*" } })).statusCode).toBe(204);
    // Snapshot: strong ETag = snapshot id (+ envelope hash since the export carries `quotes`, R9-1/R10-1), weak comparison on If-None-Match.
    const snap = await app2.inject({ method: "GET", url: "/api/market/snapshot" });
    const snapEtag = String(snap.headers.etag);
    expect(snapEtag).toMatch(/^"[0-9a-f]{16}(-[0-9a-f]{16})?"$/);
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": `W/${snapEtag}` } })).statusCode).toBe(304);
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": '"nope"' } })).statusCode).toBe(200);
    // Contract: the header descriptions name the comparison.
    const doc = app2.swagger() as unknown as { paths: Record<string, Record<string, { parameters?: { name: string; description?: string }[] }>> };
    const ifMatch = doc.paths["/api/trades/{id}"]!.put!.parameters!.find((p) => p.name === "if-match")!;
    expect(ifMatch.description).toMatch(/strong comparison/);
    const inm = doc.paths["/api/trades/{id}"]!.get!.parameters!.find((p) => p.name === "if-none-match")!;
    expect(inm.description).toMatch(/weak comparison/);
    await app2.close();
  });
});

describe("N5-04 hedge amortisation frequency pattern and hedged-item schedule in the budget hook", () => {
  it("rejects `0M` and lower-case frequencies with 400 VALIDATION_ERROR (same pattern as trade legs)", async () => {
    for (const bad of ["0M", "1d", "6m", "7Q"]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/hedge/hypothetical",
        payload: { relationship: relationship("IRS-0001", { amortisation: { type: "Linear", frequency: bad } }) },
      });
      expect(r.statusCode, bad).toBe(400);
      expect(r.json(), bad).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(JSON.stringify(r.json().validation), bad).toContain("frequency");
    }
    const ok = await app.inject({
      method: "POST",
      url: "/api/hedge/hypothetical",
      payload: { relationship: relationship("IRS-0001", { amortisation: { type: "Linear", frequency: "6M" } }) },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("a 1D × 100Y hedged item is rejected by the API hook with 400 TOO_MANY_PERIODS on both hedge routes, not 422 from the core", async () => {
    const item = { effectiveDate: "2026-09-07", maturityDate: "2126-09-07", amortisation: { type: "Linear", frequency: "1D" } };
    for (const url of ["/api/hedge/effectiveness", "/api/hedge/hypothetical"]) {
      const r = await app.inject({ method: "POST", url, payload: { relationship: relationship("IRS-0001", item) } });
      expect(r.statusCode, `${url}: ${r.body}`).toBe(400);
      expect(r.json(), url).toMatchObject({ code: "TOO_MANY_PERIODS", details: { relationshipId: "HR-R5", hedgedItem: true, maxPeriodsPerLeg: 1200 } });
      expect(String(r.json().error)).toMatch(/Hedged item of relationship HR-R5/);
      // With the instrument in the body the item is still bounded.
      const withBody = await app.inject({ method: "POST", url, payload: { relationship: relationship("x", item), hedgingInstrument: swap("6M", 10, "x") } });
      expect(withBody.statusCode, url).toBe(400);
      expect(withBody.json().code).toBe("TOO_MANY_PERIODS");
    }
    // The item's periods count against the weighted budget together with the instrument.
    const tiny = await buildApp({ logger: false, limits: { maxWeightedPeriodsPerRequest: 40 * 25 } });
    const r = await tiny.inject({
      method: "POST",
      url: "/api/hedge/effectiveness",
      payload: { relationship: relationship("IRS-0001", { amortisation: { type: "Linear", frequency: "1M" } }) },
    });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ code: "PERIOD_BUDGET_EXCEEDED", details: { weight: 40, source: "store", trades: 1 } });
    await tiny.close();
    // Unit: the estimate follows the amortisation frequency (default 6M).
    expect(hedgedItemEstimate(relationship("i", item))).toMatchObject({ type: "HedgedItem", id: "HR-R5", frequency: "1D" });
    expect(tradePeriods(hedgedItemEstimate(relationship("i", item)))).toBeGreaterThan(36_000);
    expect(tradePeriods(hedgedItemEstimate(relationship("i")))).toBe(20);
    expect(hedgedItemEstimate(undefined)).toBeUndefined();
    // Sanity: the default relationship still runs.
    expect((await app.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: relationship("IRS-0001") } })).statusCode).toBe(200);
  });
});

describe("R5-1 vol surfaces are validated structurally (PUT /api/market, snapshot import, designationSnapshot)", () => {
  it("unit: the sample market's surfaces pass; dimension, ordering, key and sign problems are reported with paths", async () => {
    const snap = await snapshot();
    expect(volSurfaceProblems(snap)).toEqual([]);
    const usd = structuredClone(snap.swaptionVols.USD!);
    const cube = volSurfaceProblems({ swaptionVols: { USD: { ...usd, atm: [[0.01]] } } });
    expect(cube).toHaveLength(2);
    expect(cube[0]).toMatch(new RegExp(`^swaptionVols\\.USD\\.atm has 1 rows, expected ${usd.expiries.length}`));
    expect(cube[1]).toMatch(new RegExp(`^swaptionVols\\.USD\\.atm\\[0\\] has 1 entries, expected ${usd.tenors.length}`));
    expect(volSurfaceProblems({ swaptionVols: { EUR: usd } })[0]).toMatch(/^swaptionVols\.EUR\.currency "USD" does not match the key "EUR"/);
    expect(volSurfaceProblems({ swaptionVols: { USD: { ...usd, expiries: [...usd.expiries].reverse() } } }).join("\n")).toMatch(
      /swaptionVols\.USD\.expiries\[1\].*strictly increasing/,
    );
    expect(volSurfaceProblems({ swaptionVols: { USD: { ...usd, volType: "Weird" } } }).join("\n")).toMatch(/swaptionVols\.USD\.volType must be one of/);
    const badRow = structuredClone(usd);
    badRow.atm[2]![3] = -0.01;
    expect(volSurfaceProblems({ swaptionVols: { USD: badRow } })).toHaveLength(1);
    expect(volSurfaceProblems({ swaptionVols: { USD: badRow } })[0]).toMatch(/^swaptionVols\.USD\.atm\[2\]\[3\] must be a finite, non-negative vol/);
    const capKey = Object.keys(snap.capletVols)[0]!;
    const cap = structuredClone(snap.capletVols[capKey]!);
    const shortCap = volSurfaceProblems({ capletVols: { [capKey]: { ...cap, vols: cap.vols.slice(1) } } });
    expect(shortCap).toHaveLength(1);
    expect(shortCap[0]).toMatch(new RegExp(`^capletVols\\.${capKey}\\.vols has ${cap.vols.length - 1} rows, expected ${cap.expiries.length}`));
    // Key rule of the core: a currency-shaped key must name the surface's currency; `EUR` and `EUR-<index>` both resolve.
    expect(volSurfaceProblems({ capletVols: { "USD-SOFR": cap } })[0]).toMatch(/^capletVols\.USD-SOFR\.currency "EUR" does not match the key/);
    expect(volSurfaceProblems({ capletVols: { EUR: cap } })).toEqual([]);
    expect(volSurfaceProblems({ capletVols: { [capKey]: cap } })).toEqual([]);
    const fx = structuredClone(snap.fxVols.EURUSD!);
    const shortFx = volSurfaceProblems({ fxVols: { EURUSD: { ...fx, atm: [0.5] } } });
    expect(shortFx).toHaveLength(1);
    expect(shortFx[0]).toMatch(new RegExp(`^fxVols\\.EURUSD\\.atm has 1 entries, expected ${fx.expiries.length}`));
    expect(volSurfaceProblems({ fxVols: { USDEUR: fx } })).toEqual([]); // either quotation is looked up by the pricers
    expect(volSurfaceProblems({ fxVols: { GBPJPY: fx } })[0]).toMatch(/^fxVols\.GBPJPY\.pair "EURUSD" does not match the key "GBPJPY"/);
    expect(volSurfaceProblems({ fxVols: { EURUSD: { ...fx, pair: "EURUS" } } })[0]).toMatch(/^fxVols\.EURUSD\.pair "EURUS" must be a 6-letter currency pair/);
    expect(volSurfaceProblems({ fxVols: { EURUSD: { ...fx, rr10: fx.rr25, bf10: undefined } } })).toEqual([
      "fxVols.EURUSD: rr10 and bf10 must be given together",
    ]);
    expect(volSurfaceProblems({ fxVols: { EURUSD: { ...fx, atm: fx.atm.map(() => -0.001) } } }).length).toBe(fx.expiries.length);
    expect(volSurfaceProblems({ swaptionVols: { X: null } })).toEqual(["swaptionVols.X must be a swaption vol surface object"]);
    expect(volSurfaceProblems({})).toEqual([]);
  });

  it("cross-check: the API delegates to the core's `validateVolSurfaces` – identical results on the sample market, a malformed cube and a bad FX row", async () => {
    const snap = await snapshot();
    const malformed = { swaptionVols: { USD: { ...snap.swaptionVols.USD!, atm: [[0.01]] } } };
    const fxBad = { fxVols: { EURUSD: { ...snap.fxVols.EURUSD!, atm: [0.5] } } };
    expect(validateVolSurfaces(snap)).toEqual([]);
    expect(volSurfaceProblems(snap)).toEqual([]);
    expect(validateVolSurfaces(malformed)).toHaveLength(2);
    expect(volSurfaceProblems(malformed)).toEqual(validateVolSurfaces(malformed));
    expect(volSurfaceProblems(fxBad)).toEqual(validateVolSurfaces(fxBad));
    expect(validateVolSurfaces(malformed).join("\n")).toMatch(/swaptionVols\.USD\.atm.*1 rows/);
    // The snapshot import of the core (`deserializeMarket`) raises the core code with the same problems – the API pre-check answers first.
    let thrown: unknown;
    try {
      deserializeMarket({ ...snap, ...malformed } as never);
    } catch (e) {
      thrown = e;
    }
    expect(isPricingError(thrown) && thrown.code).toBe("INVALID_VOL_SURFACE");
    expect((thrown as { details?: { problems?: string[] } }).details?.problems).toEqual(validateVolSurfaces(malformed));
    expect(API_ERROR_CODES.core).toContain("INVALID_VOL_SURFACE");
  });

  it("PUT /api/market: USD cube with atm [[0.01]] → 400 VOL_SURFACE_INVALID with problems, market unchanged, swaptions still price; FX atm length mismatch → 400", async () => {
    const app2 = await buildApp({ logger: false });
    const snap = await snapshot(app2);
    const idBefore = String((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId);
    const sw = (await app2.inject({ method: "GET", url: "/api/trades/SWPT-0001" })).json().trade;
    const pvBefore = (await app2.inject({ method: "POST", url: "/api/price", payload: { trade: sw } })).json().pv as number;
    const usd = structuredClone(snap.swaptionVols.USD!);
    const cube = await app2.inject({ method: "PUT", url: "/api/market", payload: { swaptionVols: { USD: { ...usd, atm: [[0.01]] } } } });
    expect(cube.statusCode).toBe(400);
    expect(cube.json()).toMatchObject({ statusCode: 400, code: "VOL_SURFACE_INVALID" });
    const problems = cube.json().problems as string[];
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems[0]).toMatch(/swaptionVols\.USD\.atm has 1 rows/);
    expect(String(cube.json().error)).toMatch(/market unchanged/);
    // Nothing was applied – same snapshot id, readiness and pricing untouched, no `market.vols` audit entry.
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId).toBe(idBefore);
    const after = await app2.inject({ method: "POST", url: "/api/price", payload: { trade: sw } });
    expect(after.statusCode).toBe(200);
    expect(after.json().pv).toBe(pvBefore);
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json().entries as { action: string }[];
    expect(audit.filter((e) => e.action === "market.vols" || e.action === "market.update")).toHaveLength(0);
    // A bad surface together with a valuation-date change: nothing of the request is applied.
    const mixed = await app2.inject({
      method: "PUT",
      url: "/api/market",
      payload: { valuationDate: "2026-10-01", swaptionVols: { EUR: { ...structuredClone(snap.swaptionVols.EUR!), currency: "USD" } } },
    });
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json().code).toBe("VOL_SURFACE_INVALID");
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().valuationDate).toBe(snap.valuationDate);
    // FX surface with the wrong `atm` length; caplet grid with a short row.
    const fx = structuredClone(snap.fxVols.EURUSD!);
    const fxBad = await app2.inject({ method: "PUT", url: "/api/market", payload: { fxVols: { EURUSD: { ...fx, atm: [0.5] } } } });
    expect(fxBad.statusCode).toBe(400);
    expect(fxBad.json()).toMatchObject({ code: "VOL_SURFACE_INVALID" });
    expect(fxBad.json().problems).toHaveLength(1);
    expect((fxBad.json().problems as string[])[0]).toMatch(new RegExp(`^fxVols\\.EURUSD\\.atm has 1 entries, expected ${fx.expiries.length}`));
    const capKey = Object.keys(snap.capletVols)[0]!;
    const cap = structuredClone(snap.capletVols[capKey]!);
    cap.vols[0] = cap.vols[0]!.slice(0, 2);
    const capBad = await app2.inject({ method: "PUT", url: "/api/market", payload: { capletVols: { [capKey]: cap } } });
    expect(capBad.statusCode).toBe(400);
    expect((capBad.json().problems as string[])[0]).toMatch(new RegExp(`capletVols\\.${capKey}\\.vols\\[0\\] has 2 entries`));
    // What the schema itself can pin: empty axes, negative vols, unknown vol type → 400 VALIDATION_ERROR before the structural check.
    for (const payload of [
      { swaptionVols: { USD: { ...usd, expiries: [] } } },
      { swaptionVols: { USD: { ...usd, atm: usd.atm.map((r) => r.map(() => -1)) } } },
      { fxVols: { EURUSD: { ...fx, expiries: [0, ...fx.expiries.slice(1)] } } },
      { capletVols: { [capKey]: { ...snap.capletVols[capKey]!, volType: "Weird" } } },
    ]) {
      const r = await app2.inject({ method: "PUT", url: "/api/market", payload });
      expect(r.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
      expect(r.json().code).toBe("VALIDATION_ERROR");
    }
    // A sound surface still goes through (R4-5 unchanged) and the snapshot id moves.
    const good = await app2.inject({
      method: "PUT",
      url: "/api/market",
      payload: { swaptionVols: { USD: { ...usd, atm: usd.atm.map((r) => r.map((v) => v * 1.1)) } } },
    });
    expect(good.statusCode, good.body).toBe(200);
    expect(good.json().snapshotId).not.toBe(idBefore);
    await app2.close();
  });

  it("snapshot import and designationSnapshot reject a malformed surface with 400 VOL_SURFACE_INVALID before deserialising; the contract documents it", async () => {
    const app2 = await buildApp({ logger: false });
    const snap = await snapshot(app2);
    const idBefore = String((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId);
    const malformed = { ...snap, swaptionVols: { ...snap.swaptionVols, USD: { ...snap.swaptionVols.USD!, atm: [[0.01]] } } };
    const imp = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: malformed });
    expect(imp.statusCode).toBe(400);
    expect(imp.json()).toMatchObject({ statusCode: 400, code: "VOL_SURFACE_INVALID" });
    expect((imp.json().problems as string[])[0]).toMatch(/swaptionVols\.USD\.atm/);
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId).toBe(idBefore);
    expect((await app2.inject({ method: "GET", url: "/api/health/ready" })).json().status).toBe("ready");
    // The unchanged snapshot still round-trips.
    expect((await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(200);
    // Hedge effectiveness with a designation snapshot carrying the malformed cube.
    const rel = relationship("IRS-0001");
    const hedge = await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: rel, designationSnapshot: malformed } });
    expect(hedge.statusCode).toBe(400);
    expect(hedge.json()).toMatchObject({ code: "VOL_SURFACE_INVALID" });
    expect(String(hedge.json().error)).toMatch(/designationSnapshot/);
    expect((await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: rel, designationSnapshot: snap } })).statusCode).toBe(
      200,
    );
    // Contract: the code is catalogued, the routes describe the check, the new warning prefixes and FX-option analytics keys are documented.
    const doc = app2.swagger() as unknown as Doc & { paths: Record<string, Record<string, { description?: string }>> };
    expect(doc.components.schemas.ErrorResponse!.properties!.code!.examples).toContain("VOL_SURFACE_INVALID");
    for (const w of ["EXPIRED", "EXPIRES_TODAY"]) {
      expect(WARNING_PREFIXES).toContain(w);
      expect(doc.components.schemas.ErrorResponse!.properties!.code!.description).toContain(`${w}:`);
    }
    const docJson = JSON.stringify(doc);
    for (const key of ["`lifecycle`", "`greeksMethod`", "settled-payoff", "`valueTodayOnRollDate`"]) expect(docJson, key).toContain(key);
    expect(doc.paths["/api/market"]!.put!.description).toMatch(/VOL_SURFACE_INVALID/);
    expect(doc.paths["/api/market/snapshot"]!.put!.description).toMatch(/VOL_SURFACE_INVALID/);
    await app2.close();
  });
});

describe("Cosmetic R5: notionals and amounts carry an upper bound", () => {
  it("rejects 1e300 notionals / amounts with 400 VALIDATION_ERROR on trades, templates and hedge items; 1e13 is the documented maximum", async () => {
    expect(MAX_AMOUNT).toBe(1e13);
    const huge = swap("6M", 5);
    (huge.legs[0] as Json).notional = 1e300;
    const r = await app.inject({ method: "POST", url: "/api/price", payload: { trade: huge } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(r.json().validation)).toContain("maximum");
    const fxf = (await app.inject({ method: "GET", url: "/api/trades/FXF-0001" })).json().trade as Json;
    expect((await app.inject({ method: "POST", url: "/api/price", payload: { trade: { ...fxf, buyAmount: 1e300 } } })).json().code).toBe("VALIDATION_ERROR");
    expect((await app.inject({ method: "POST", url: "/api/price", payload: { trade: { ...fxf, sellAmount: 1e14 } } })).json().code).toBe("VALIDATION_ERROR");
    const fxo = (await app.inject({ method: "GET", url: "/api/trades/FXO-0001" })).json().trade as Json;
    expect((await app.inject({ method: "POST", url: "/api/price", payload: { trade: { ...fxo, notional: 1e300 } } })).json().code).toBe("VALIDATION_ERROR");
    const cap = (await app.inject({ method: "GET", url: "/api/trades/CAP-0001" })).json().trade as Json;
    expect((await app.inject({ method: "POST", url: "/api/price", payload: { trade: { ...cap, notional: 1e300 } } })).json().code).toBe("VALIDATION_ERROR");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/trades/from-template",
          payload: { template: "FRA", params: { currency: "EUR", notional: 1e300, payReceive: "Pay", start: "3x6", rate: 0.02 } },
        })
      ).json().code,
    ).toBe("VALIDATION_ERROR");
    expect(
      (await app.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: relationship("IRS-0001", { notional: 1e300 }) } })).json()
        .code,
    ).toBe("VALIDATION_ERROR");
    // The maximum itself is accepted (a 10-trillion swap is large, not malformed).
    const max = swap("6M", 5);
    (max.legs[0] as Json).notional = MAX_AMOUNT;
    (max.legs[1] as Json).notional = MAX_AMOUNT;
    expect((await app.inject({ method: "POST", url: "/api/price", payload: { trade: max } })).statusCode).toBe(200);
    // Contract: the bound is visible in the schema.
    const doc = app.swagger() as unknown as Doc;
    const legNotional = doc.components.schemas.FixedLeg!.properties!.notional as { maximum?: number; exclusiveMinimum?: number };
    expect(legNotional).toMatchObject({ exclusiveMinimum: 0, maximum: MAX_AMOUNT });
    expect((doc.components.schemas.FxForward!.properties!.buyAmount as { maximum?: number }).maximum).toBe(MAX_AMOUNT);
  });
});
