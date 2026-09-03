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
        { type: "Fixed", payReceive: "Pay", notional: 1e7, currency: "EUR", effectiveDate: "2026-09-07", terminationDate: "2031-09-07", frequency: "1Y", dayCount: "30E/360", calendar: "TARGET", rate: 0.026 },
        { type: "Float", payReceive: "Receive", notional: 1e7, currency: "EUR", effectiveDate: "2026-09-07", terminationDate: "2031-09-07", frequency: "6M", dayCount: "ACT/360", calendar: "TARGET", index: "EURIBOR-6M" },
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
    const xva = await app.inject({ method: "POST", url: "/api/xva", payload: { trade: t, reportingCurrency: "EUR", credit: { cptyHazard: 0.02, cptyRecovery: 0.4 } } });
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
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/api/trades/FXF-0002" });
    expect(gone.statusCode).toBe(404);
  });
});
