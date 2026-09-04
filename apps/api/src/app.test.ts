import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("API", () => {
  it("health", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("ok");
  });
  it("market snapshot and curve", async () => {
    const r = await app.inject({ method: "GET", url: "/api/market" });
    expect(r.statusCode).toBe(200);
    expect(r.json().valuationDate).toBe("2026-09-03");
    const c = await app.inject({ method: "GET", url: "/api/market/curves/EUR-ESTR" });
    expect(c.statusCode).toBe(200);
    expect(c.json().nodes.length).toBeGreaterThan(10);
    expect(c.json().nodes[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("prices a swap posted with ISO dates", async () => {
    const trade = {
      id: "api-swap",
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
    };
    const r = await app.inject({ method: "POST", url: "/api/price", payload: { trade, reportingCurrency: "EUR" } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(typeof body.pv).toBe("number");
    expect(body.analytics.parRate).toBeCloseTo(0.0262, 3);
    expect(body.legs[0].cashflows[0].paymentDate).toMatch(/^\d{4}-/);
  });
  it("lists seeded trades with pricing and runs scenarios", async () => {
    const r = await app.inject({ method: "GET", url: "/api/trades?price=1&reportingCurrency=EUR" });
    expect(r.statusCode).toBe(200);
    const list = r.json();
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list.every((t: { pricing: { pv: number | null } }) => typeof t.pricing.pv === "number")).toBe(true);
    const s = await app.inject({ method: "POST", url: "/api/scenarios", payload: { reportingCurrency: "EUR" } });
    expect(s.statusCode).toBe(200);
    expect(s.json().results.length).toBeGreaterThan(5);
  });
  it("risk, xva and report", async () => {
    const t = (await app.inject({ method: "GET", url: "/api/trades/IRS-0001" })).json().trade;
    const risk = await app.inject({ method: "POST", url: "/api/risk", payload: { trade: t, reportingCurrency: "EUR" } });
    expect(risk.statusCode).toBe(200);
    expect(risk.json().dv01).toBeGreaterThan(0);
    const xva = await app.inject({
      method: "POST",
      url: "/api/xva",
      payload: { trade: t, reportingCurrency: "EUR", credit: { cptyHazard: 0.02, cptyRecovery: 0.4 } },
    });
    expect(xva.statusCode).toBe(200);
    expect(xva.json().cva).toBeGreaterThan(0);
    const rep = await app.inject({ method: "POST", url: "/api/report", payload: { trade: t, reportingCurrency: "EUR", transactionPrice: 0 } });
    expect(rep.statusCode).toBe(200);
    expect(rep.json().fairValue.ifrs13Level).toBe(2);
    const csv = await app.inject({ method: "POST", url: "/api/report?format=csv", payload: { trade: t } });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n").length).toBeGreaterThan(10);
  });
  it("trade CRUD validates", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/trades", payload: { id: "x" } });
    expect(bad.statusCode).toBe(400);
    const del = await app.inject({ method: "DELETE", url: "/api/trades/FXF-0002" });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: "/api/trades/FXF-0002" });
    expect(gone.statusCode).toBe(404);
  });
});

describe("snapshot & EMIR", () => {
  it("exports, validates and re-imports the market snapshot", async () => {
    const app2 = await buildApp({ logger: false });
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    expect(snap.schema).toBe("deriva.market/1");
    const put = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(put.statusCode).toBe(200);
    const bad = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, schema: "x" } });
    expect(bad.statusCode).toBe(400);
    const emir = await app2.inject({ method: "GET", url: "/api/emir/valuations?format=csv" });
    expect(emir.headers["content-type"]).toContain("text/csv");
    expect(emir.body.split("\n").length).toBeGreaterThan(5);
    await app2.close();
  });
});

describe("trade lifecycle semantics", () => {
  it("201 on create, 409 on duplicate, ETag/If-Match on update, audit chain valid", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const created = await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "NEW-1" } });
    expect(created.statusCode).toBe(201);
    // Strong ETag `"version-hash"` (N5-03) – a weak `W/` validator could never satisfy If-Match under RFC 9110.
    expect(created.headers.etag).toMatch(/^"1-[0-9a-f]{16}"$/);
    const dup = await app2.inject({ method: "POST", url: "/api/trades", payload: { ...t, id: "NEW-1" } });
    expect(dup.statusCode).toBe(409);
    const stale = await app2.inject({ method: "PUT", url: "/api/trades/NEW-1", headers: { "if-match": 'W/"999-deadbeef"' }, payload: { ...t, id: "NEW-1" } });
    expect(stale.statusCode).toBe(412);
    const ok = await app2.inject({
      method: "PUT",
      url: "/api/trades/NEW-1",
      headers: { "if-match": String(created.headers.etag) },
      payload: { ...t, id: "NEW-1", name: "renamed" },
    });
    expect(ok.statusCode).toBe(200);
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json();
    expect(audit.chainValid).toBe(true);
    expect(audit.entries.length).toBeGreaterThanOrEqual(2);
    // Header injection via the id is impossible twice over: the id pattern rejects it (400) and safeFilename() sanitises.
    const injected = await app2.inject({ method: "POST", url: "/api/report?format=csv", payload: { trade: { ...t, id: 'x"; evil=1' } } });
    expect(injected.statusCode).toBe(400);
    const csv = await app2.inject({ method: "POST", url: "/api/report?format=csv", payload: { trade: { ...t, id: "x.evil-1" } } });
    expect(String(csv.headers["content-disposition"])).toContain('filename="x.evil-1-cashflows.csv"');
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    const notFound = await app2.inject({ method: "GET", url: "/api/nope" });
    expect(notFound.statusCode).toBe(404);
    expect(String(created.headers["x-request-id"])).toMatch(/^req_/);
    await app2.close();
  });
});

describe("request validation", () => {
  it("rejects malformed bodies with 400 and a validation message", async () => {
    const app2 = await buildApp({ logger: false });
    const r = await app2.inject({ method: "POST", url: "/api/price", payload: { trade: { id: "x", type: "Nope" } } });
    expect(r.statusCode).toBe(400);
    expect(String(r.json().error)).toMatch(/type|enum/i);
    const r2 = await app2.inject({ method: "POST", url: "/api/xva", payload: { trade: { id: "x", type: "FRA" } } });
    expect(r2.statusCode).toBe(400);
    const r3 = await app2.inject({ method: "PUT", url: "/api/market", payload: { fxSpots: { EURUSD: -1 } } });
    expect(r3.statusCode).toBe(400);
    await app2.close();
  });
});

describe("hedge accounting", () => {
  it("runs an effectiveness test for a payer swap hedging a floating-rate loan", async () => {
    const app2 = await buildApp({ logger: false });
    const rel = {
      id: "HR-1",
      name: "Kredit Halle A",
      type: "CashFlowHedge",
      hedgedItem: {
        description: "Variabler Kredit",
        currency: "EUR",
        notional: 10000000,
        kind: "FloatingRateLoan",
        index: "EURIBOR-6M",
        effectiveDate: "2024-06-17",
        maturityDate: "2034-06-17",
      },
      hedgingInstrumentId: "IRS-0001",
      designationDate: "2024-06-17",
      method: "Regression",
      accountingFramework: "IFRS9",
    };
    const r = await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: rel } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.regression.slope).toBeGreaterThan(0.8);
    expect(body.regression.slope).toBeLessThan(1.25);
    expect(Array.isArray(body.summary)).toBe(true);
    const hypo = await app2.inject({ method: "POST", url: "/api/hedge/hypothetical", payload: { relationship: rel } });
    expect(hypo.statusCode).toBe(200);
    expect(hypo.json().type).toBe("InterestRateSwap");
    const missing = await app2.inject({ method: "POST", url: "/api/hedge/effectiveness", payload: { relationship: { ...rel, hedgingInstrumentId: "NOPE" } } });
    expect(missing.statusCode).toBe(404);
    await app2.close();
  });
});

describe("documents", () => {
  it("generates termsheet and suitability statement", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const ts = await app2.inject({ method: "POST", url: "/api/documents/termsheet", payload: { trade: t } });
    expect(ts.statusCode).toBe(200);
    expect(ts.json().kind).toBe("Termsheet");
    expect(ts.json().markdown).toContain("# Indikatives Termsheet");
    const md = await app2.inject({ method: "POST", url: "/api/documents/termsheet?format=md", payload: { trade: t } });
    expect(md.headers["content-type"]).toContain("text/markdown");
    const su = await app2.inject({
      method: "POST",
      url: "/api/documents/suitability",
      payload: {
        trade: t,
        suitability: {
          clientName: "Muster GmbH",
          clientClassification: "Professioneller Kunde",
          hedgingPurpose: "Absicherung Anleihe",
          knowledgeExperience: "gut",
          financialSituation: "solide",
          riskTolerance: "mittel",
          investmentHorizonYears: 5,
          advisorName: "M. Berater",
          transactionPrice: 0,
        },
      },
    });
    expect(su.statusCode).toBe(200);
    const body = su.json();
    expect(body.kind).toBe("Geeignetheitserklaerung");
    expect(body.sections.some((s: { heading: string }) => s.heading.startsWith("Kostenausweis"))).toBe(true);
    expect(body.sections.some((s: { heading: string }) => s.heading.startsWith("Szenariobetrachtung"))).toBe(true);
    await app2.close();
  });
});

describe("batch import", () => {
  it("imports valid trades, skips existing, rejects unpriceable", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const r = await app2.inject({
      method: "POST",
      url: "/api/trades/import",
      // IMP-BAD passes the schema (well-formed Float leg) but references an unknown index → rejected by the core, not by Ajv.
      payload: {
        trades: [
          { ...t, id: "IMP-1" },
          { ...t, id: "IRS-0002" },
          { ...t, id: "IMP-BAD", legs: [t.legs[0], { ...t.legs[1], index: "NOPE-6M" }] },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.rejected).toBe(1);
    const rejected = body.results.find((x: { id: string }) => x.id === "IMP-BAD");
    expect(typeof rejected.reason).toBe("string");
    expect(typeof rejected.code).toBe("string");
    // Schema violations inside the batch fail the whole request (400) instead of being silently stripped.
    const malformed = await app2.inject({
      method: "POST",
      url: "/api/trades/import",
      payload: { trades: [{ ...t, id: "IMP-2", legs: [{ ...t.legs[0], index2: 1 }] }] },
    });
    expect(malformed.statusCode).toBe(400);
    await app2.close();
  });
});

describe("par risk & vega buckets", () => {
  it("par risk of a par swap concentrates in its own tenor; vega buckets sum to parallel vega", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const pr = await app2.inject({ method: "POST", url: "/api/risk/par", payload: { trade: t, reportingCurrency: "EUR", curveIds: ["EUR-EURIBOR-6M"] } });
    expect(pr.statusCode).toBe(200);
    const body = pr.json();
    expect(Array.isArray(body.curves)).toBe(true);
    expect(Math.abs(body.total)).toBeGreaterThan(100);
    const sw = (await app2.inject({ method: "GET", url: "/api/trades/SWPT-0001" })).json().trade;
    const vg = await app2.inject({ method: "POST", url: "/api/risk/vega", payload: { trade: sw, reportingCurrency: "EUR" } });
    expect(vg.statusCode).toBe(200);
    expect(vg.json().length).toBeGreaterThan(0);
    expect(vg.json()[0].buckets.length).toBeGreaterThan(3);
    await app2.close();
  }, 30000);

  it("market PUT accepts spot dates and missing-fixing policy and keeps them across a rebuild", async () => {
    const app2 = await buildApp({ logger: false });
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { fxSpotDates: { EURUSD: "2026-09-07" }, missingFixingPolicy: "throw" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().fxSpotDates.EURUSD).toBe("2026-09-07");
    expect(put.json().missingFixingPolicy).toBe("throw");
    const roll = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-09-04" } });
    expect(roll.json().missingFixingPolicy).toBe("throw");
    expect(roll.json().fxSpotDates.EURUSD).toBe("2026-09-07");
    // A seasoned swap whose running period needs fixings the market lacks now fails semantically instead of silently
    // estimating. Since round 6 the sample market carries EURIBOR / €STR history (Markt R6-6: EURIBOR from 2024-06,
    // €STR from 2026-01-02), so the running €STR period must start before that history.
    const trade = {
      id: "seasoned",
      type: "InterestRateSwap",
      legs: [
        {
          type: "Fixed",
          payReceive: "Pay",
          notional: 1e7,
          currency: "EUR",
          effectiveDate: "2025-12-09",
          terminationDate: "2030-12-09",
          frequency: "1Y",
          dayCount: "ACT/360",
          calendar: "TARGET",
          rate: 0.021,
        },
        {
          type: "Float",
          payReceive: "Receive",
          notional: 1e7,
          currency: "EUR",
          effectiveDate: "2025-12-09",
          terminationDate: "2030-12-09",
          frequency: "1Y",
          dayCount: "ACT/360",
          calendar: "TARGET",
          index: "ESTR",
        },
      ],
    };
    const priced = await app2.inject({ method: "POST", url: "/api/price", payload: { trade } });
    expect(priced.statusCode, priced.body).toBe(422);
    expect(priced.json().code).toBe("MISSING_FIXING");
    const bad = await app2.inject({ method: "PUT", url: "/api/market", payload: { missingFixingPolicy: "ignore" } });
    expect(bad.statusCode).toBe(400);
    await app2.close();
  });

  it("replacing a sample curve tracks its quotes for par risk and survives a valuation-date rebuild", async () => {
    const app2 = await buildApp({ logger: false });
    const t = (await app2.inject({ method: "GET", url: "/api/trades/IRS-0002" })).json().trade;
    const before = (await app2.inject({ method: "POST", url: "/api/risk/par", payload: { trade: t, curveIds: ["EUR-EURIBOR-6M"] } })).json();
    const quotes = [
      { type: "Deposit", tenor: "6M", rate: 0.021 },
      { type: "Swap", tenor: "2Y", rate: 0.0225 },
      { type: "Swap", tenor: "5Y", rate: 0.0245 },
      { type: "Swap", tenor: "10Y", rate: 0.027 },
      { type: "Swap", tenor: "30Y", rate: 0.028 },
    ];
    const rep = await app2.inject({
      method: "POST",
      url: "/api/market/curves",
      payload: { spec: { id: "EUR-EURIBOR-6M", currency: "EUR", index: "EURIBOR-6M", quotes, discountCurveId: "EUR-ESTR" } },
    });
    expect(rep.statusCode).toBe(200);
    const after = (await app2.inject({ method: "POST", url: "/api/risk/par", payload: { trade: t, curveIds: ["EUR-EURIBOR-6M"] } })).json();
    const bucketsBefore = before.curves[0].buckets.length;
    const bucketsAfter = after.curves[0].buckets.length;
    expect(bucketsAfter).toBe(quotes.length);
    expect(bucketsAfter).toBeLessThan(bucketsBefore);
    // Rebuild for a new valuation date keeps the replaced quote set.
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-09-04" } });
    expect(put.statusCode).toBe(200);
    const curve = (await app2.inject({ method: "GET", url: "/api/market/curves/EUR-EURIBOR-6M" })).json();
    expect(curve.nodes.length).toBe(quotes.length + 1);
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json();
    const entry = audit.entries.find((e: { action: string }) => e.action === "curve.replace");
    expect(entry?.details?.parRiskTracked).toBe(true);
    await app2.close();
  }, 60000);
});
