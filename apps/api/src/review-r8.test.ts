/**
 * Round-8 review findings (docs/quality/review-architektur-r8.md, review-markt-r8.md):
 * N8-01 `PUT /api/market { valuationDate }` keeps runtime curves, mappings, vol overrides; import mode rolls or discards with a warning,
 * N8-02 currency check of `collateralDiscountCurveId` (route and snapshot import),
 * N8-03 the snapshot export ETag covers the register envelope, `X-Market-Snapshot-Id` does not,
 * N8-04 atomic envelope import (an invalid second entry registers nothing),
 * R8-2  `POST /api/market/calendars` and the `calendars` envelope,
 * R8-3  par risk bumps every curve with known quotes and names the ones without (`PAR_RISK_INCOMPLETE:`),
 * R8-4  the eleven workstation CSV templates import through the API (aliases, spread unit heuristic),
 * N6-03a / N4-03 rest: commitlint and typed lint are configured; the warning-prefix catalogue is complete in code and docs.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { getCalendar, parseISO } from "@deriva/pricing-core";
import { buildApp } from "./app.js";
import { type CsvTradeType, csvToTrades, parseCsvSpread } from "./lib/csv-import.js";
import { WARNING_PREFIXES } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;
type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, Json> };
};
type MarketView = Json & { discountCurveId: Record<string, string>; collateralDiscountCurveId?: Record<string, string> };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VALUATION_DATE = 20699; // 2026-09-03
const csv = (url: string, text: string, a: FastifyInstance = app) => a.inject({ method: "POST", url, headers: { "content-type": "text/csv" }, payload: text });
const market = async (a: FastifyInstance) => (await a.inject({ method: "GET", url: "/api/market" })).json() as MarketView;
const audit = async (a: FastifyInstance) => {
  const body = (await a.inject({ method: "GET", url: "/api/audit" })).json() as
    { entries?: { action: string; details?: Json }[] } | { action: string; details?: Json }[];
  return Array.isArray(body) ? body : (body.entries ?? []);
};

const oisSpec = (currency: string, index: string, level: number, id = `${currency}-${index}`) => ({
  id,
  currency,
  index,
  quotes: [
    { type: "Deposit", tenor: "1W", rate: level + 0.001 },
    { type: "OIS", tenor: "6M", rate: level + 0.0005 },
    { type: "OIS", tenor: "1Y", rate: level },
    { type: "OIS", tenor: "2Y", rate: level - 0.001 },
    { type: "OIS", tenor: "5Y", rate: level - 0.002 },
    { type: "OIS", tenor: "10Y", rate: level - 0.0015 },
  ],
});
const swapCsv = (ccy: string, index: string, id: string) =>
  `currency;notional;payReceive;fixedRate;effectiveDate;maturity;index;id\n${ccy};10.000.000;Pay;4,20 %;2026-09-07;5Y;${index};${id}\n`;
const oisSwap = (id: string, ccy: string, index: string) => ({
  type: "InterestRateSwap",
  id,
  legs: [
    {
      type: "Fixed",
      payReceive: "Pay",
      notional: 1e7,
      currency: ccy,
      effectiveDate: "2026-09-07",
      terminationDate: "2031-09-07",
      frequency: "1Y",
      dayCount: "ACT/360",
      calendar: "TARGET",
      rate: 0.04,
    },
    {
      type: "Float",
      payReceive: "Receive",
      notional: 1e7,
      currency: ccy,
      effectiveDate: "2026-09-07",
      terminationDate: "2031-09-07",
      frequency: "1Y",
      dayCount: "ACT/360",
      calendar: "TARGET",
      index,
    },
  ],
});
const czeonia = (name: string, calendar = "TARGET") => ({
  name,
  currency: "CZK",
  type: "OIS",
  tenor: "1D",
  dayCount: "ACT/360",
  fixingCalendar: calendar,
  fixingLag: 0,
  businessDayConvention: "ModifiedFollowing",
  endOfMonth: false,
  curveId: `CZK-${name}`,
});

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("N8-01 a valuation-date change keeps the user's market state", () => {
  it("DKK runtime curve, discount + collateral mapping and a swaption-cube override survive PUT { valuationDate }; the DKK swap still prices; warnings are empty", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const curve = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("DKK", "DESTR", 0.025) } });
    expect(curve.statusCode, curve.body).toBe(200);
    expect(curve.json()).toMatchObject({ discountCurveSet: true, parRiskTracked: true });
    const csa = await app2.inject({ method: "PUT", url: "/api/market", payload: { collateralDiscountCurveId: { "DKK|EUR": "DKK-DESTR" } } });
    expect(csa.statusCode, csa.body).toBe(200);
    // Vol override: the EUR cube with every ATM vol scaled by 1.5.
    type Vols = { swaption: Record<string, Json & { atm: number[][] }> };
    const vols = (await app2.inject({ method: "GET", url: "/api/market/vols" })).json() as Vols;
    const bumped = { ...vols.swaption.EUR!, atm: vols.swaption.EUR!.atm.map((row) => row.map((v) => v * 1.5)) };
    const putVols = await app2.inject({ method: "PUT", url: "/api/market", payload: { swaptionVols: { EUR: bumped } } });
    expect(putVols.statusCode, putVols.body).toBe(200);
    const swap = await csv("/api/trades/import?type=InterestRateSwap&reportingCurrency=DKK", swapCsv("DKK", "DESTR", "IRS-DKK-R8"), app2);
    expect(swap.json(), swap.body).toMatchObject({ imported: 1 });
    const pvBefore = swap.json().results[0].pv as number;
    expect(typeof pvBefore).toBe("number");

    const moved = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ valuationDate: "2026-10-01", source: "sample", warnings: [] });
    expect(moved.json().discountCurveId.DKK).toBe("DKK-DESTR");
    expect(moved.json().collateralDiscountCurveId["DKK|EUR"]).toBe("DKK-DESTR");
    const dkk = await app2.inject({ method: "GET", url: "/api/market/curves/DKK-DESTR" });
    expect(dkk.statusCode, dkk.body).toBe(200);
    expect(dkk.json().referenceDate).toBe("2026-10-01");
    const volsAfter = (await app2.inject({ method: "GET", url: "/api/market/vols" })).json() as Vols;
    expect(volsAfter.swaption.EUR!.atm[0]![0]).toBeCloseTo(bumped.atm[0]![0]!, 12);
    const priced = await app2.inject({ method: "GET", url: "/api/trades?price=1&reportingCurrency=DKK" });
    expect(priced.statusCode, priced.body).toBe(200);
    const rows = priced.json() as { trade: { id: string }; pricing: { pv: number | null; error?: string; code?: string } }[];
    const row = rows.find((t) => t.trade.id === "IRS-DKK-R8")!;
    expect(row.pricing.code, JSON.stringify(row.pricing)).toBeUndefined();
    expect(typeof row.pricing.pv).toBe("number");
    expect(row.pricing.pv).not.toBe(pvBefore);
    const stored = (await app2.inject({ method: "GET", url: "/api/trades/IRS-DKK-R8" })).json().trade as Json;
    const price = await app2.inject({ method: "POST", url: "/api/price", payload: { trade: stored, reportingCurrency: "DKK" } });
    expect(price.statusCode, price.body).toBe(200);
    // Par risk after the rebuild still bumps the DKK curve (quotes remembered, Markt R8-3).
    const par = await app2.inject({ method: "POST", url: "/api/risk/par", payload: { trade: stored, reportingCurrency: "DKK" } });
    expect(par.statusCode, par.body).toBe(200);
    expect((par.json().curves as { curveId: string }[]).map((c) => c.curveId)).toContain("DKK-DESTR");
    // Moving back works too (a second rebuild re-bootstraps the same remembered spec).
    const back = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-09-03" } });
    expect(back.json(), back.body).toMatchObject({ warnings: [] });
    expect((await app2.inject({ method: "GET", url: "/api/market/curves/DKK-DESTR" })).statusCode).toBe(200);
    const entries = await audit(app2);
    expect(entries.filter((e) => e.action === "market.update").map((e) => e.details?.dropped)).toContain(0);
    await app2.close();
  });

  it("a runtime curve whose reference curve vanishes with the rebuild is dropped with a MARKET_STATE_DROPPED warning (and so is its mapping)", async () => {
    // NOK-NOWA lives only in an imported snapshot; a runtime basis curve built on it cannot be re-bootstrapped once the import is discarded.
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("NOK", "NOWA", 0.045) } })).statusCode).toBe(200);
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json;
    // Round-8 snapshot format: without the `quotes` envelope (R9-1) NOK-NOWA cannot be re-bootstrapped by `discardImport` – the
    // case this test is about. With `quotes` the curve and everything built on it survive the rebuild (review-r9.test.ts).
    delete snap.quotes;
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(200);
    const basis = {
      id: "NOK-NIBOR-6M-R8",
      currency: "NOK",
      index: "NIBOR-6M",
      discountCurveId: "NOK-NOWA",
      quotes: ["1Y", "2Y", "5Y"].map((tenor) => ({ type: "BasisSwap", tenor, spread: 0.001, otherIndex: "NOWA", otherCurveId: "NOK-NOWA" })),
    };
    const curve = await app3.inject({ method: "POST", url: "/api/market/curves", payload: { spec: basis } });
    expect(curve.statusCode, curve.body).toBe(200);
    expect(curve.json().discountCurveSet).toBe(false);
    const mapped = await app3.inject({ method: "PUT", url: "/api/market", payload: { discountCurveId: { NOK: "NOK-NIBOR-6M-R8" } } });
    expect(mapped.statusCode, mapped.body).toBe(200);
    // Rolling the import keeps everything (nothing is re-bootstrapped) …
    const rolled = await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } });
    expect(rolled.json(), rolled.body).toMatchObject({ source: "import", warnings: [] });
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/NOK-NIBOR-6M-R8" })).statusCode).toBe(200);
    // … discarding the import rebuilds the sample market: the basis curve loses its reference and is named, so is the mapping.
    const discarded = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(discarded.statusCode, discarded.body).toBe(200);
    const warnings = discarded.json().warnings as string[];
    expect(warnings.every((w) => w.startsWith("MARKET_STATE_DROPPED:"))).toBe(true);
    expect(warnings.some((w) => w.includes("imported snapshot"))).toBe(true);
    expect(warnings.some((w) => w.includes("curve NOK-NIBOR-6M-R8") && w.includes("NOK-NOWA"))).toBe(true);
    expect(warnings.some((w) => w.includes("discountCurveId.NOK = NOK-NIBOR-6M-R8"))).toBe(true);
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/NOK-NIBOR-6M-R8" })).statusCode).toBe(404);
    expect((await market(app3)).discountCurveId.NOK).toBeUndefined();
    expect((await market(app3)).source).toBe("sample");
    const entries = await audit(app3);
    expect(entries.filter((e) => e.action === "market.update").map((e) => e.details?.dropped)).toContain(3);
    await app2.close();
    await app3.close();
  });

  it("import mode: PUT { valuationDate } rolls the imported market (curves, spot, label kept, source stays import); discardImport returns to the sample market with a warning", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("NOK", "NOWA", 0.045) } });
    await app2.inject({ method: "PUT", url: "/api/market", payload: { fxSpots: { EURUSD: 1.2345 } } });
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json & { curves: unknown[]; meta?: Json };
    snap.meta = { ...(snap.meta ?? {}), label: "IMPORTED-R8" };
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    const imported = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(imported.statusCode, imported.body).toBe(200);
    expect((await market(app3)).source).toBe("import");
    const rolled = await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } });
    expect(rolled.statusCode, rolled.body).toBe(200);
    expect(rolled.json()).toMatchObject({ valuationDate: "2026-10-01", source: "import", warnings: [] });
    const m = await market(app3);
    expect((m.curves as unknown[]).length).toBe(snap.curves.length);
    expect((m.fxSpots as Record<string, number>).EURUSD).toBe(1.2345);
    // Since R9 (N9-02) the roll marks the label; the imported name stays its stem.
    expect((m.meta as Json).label).toBe("IMPORTED-R8 (rolled to 2026-10-01)");
    expect(m.discountCurveId.NOK).toBe("NOK-NOWA");
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/NOK-NOWA" })).json().referenceDate).toBe("2026-10-01");
    // A swap in the rolled import still prices.
    const swap = await app3.inject({ method: "POST", url: "/api/price", payload: { trade: oisSwap("IRS-NOK-ROLL", "NOK", "NOWA"), reportingCurrency: "NOK" } });
    expect(swap.statusCode, swap.body).toBe(200);
    // Discarding the import names it and rebuilds the sample market for the current date.
    const discarded = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(discarded.json().source).toBe("sample");
    expect((discarded.json().warnings as string[]).some((w) => w.startsWith("MARKET_STATE_DROPPED:") && w.includes("IMPORTED-R8"))).toBe(true);
    expect((await market(app3)).source).toBe("sample");
    expect((await market(app3)).valuationDate).toBe("2026-10-01");
    // `discardImport` in sample mode is a no-op without a warning.
    const noop = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(noop.json()).toMatchObject({ source: "sample", warnings: [] });
    // The prefix is catalogued.
    expect(WARNING_PREFIXES).toContain("MARKET_STATE_DROPPED");
    const doc = app.swagger() as unknown as Doc;
    const description = (doc.components.schemas.ErrorResponse as { properties: { code: { description: string } } }).properties.code.description;
    expect(description).toContain("`MARKET_STATE_DROPPED:`");
    expect(JSON.stringify(doc.paths["/api/market"]!.put)).toContain("discardImport");
    await app2.close();
    await app3.close();
  });
});

describe("N8-02 collateralDiscountCurveId is checked for currency", () => {
  it("a collateral curve in another currency than the key's first currency → 400 INVALID_REQUEST (route) / 422 SNAPSHOT_INVALID (import); market unchanged", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    // A PLN curve at 8 % (built-in PLN conventions, no sample curve) – the review's CZK case with the same mechanics.
    const curve = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("PLN", "POLONIA", 0.08) } });
    expect(curve.statusCode, curve.body).toBe(200);
    const idBefore = (await market(app2)).snapshotId;
    const wrong = await app2.inject({ method: "PUT", url: "/api/market", payload: { collateralDiscountCurveId: { "EUR|PLN": "PLN-POLONIA" } } });
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect(wrong.json()).toMatchObject({ code: "INVALID_REQUEST", details: { key: "EUR|PLN", curveId: "PLN-POLONIA", currency: "EUR", curveCurrency: "PLN" } });
    expect((await market(app2)).snapshotId).toBe(idBefore);
    // The right way round (PLN cash flows under EUR CSA on a PLN curve) is accepted.
    const ok = await app2.inject({ method: "PUT", url: "/api/market", payload: { collateralDiscountCurveId: { "PLN|EUR": "PLN-POLONIA" } } });
    expect(ok.statusCode, ok.body).toBe(200);
    // The same check guards the snapshot import.
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json & { collateralDiscountCurveId?: Record<string, string> };
    const bad = { ...snap, collateralDiscountCurveId: { ...(snap.collateralDiscountCurveId ?? {}), "EUR|PLN": "PLN-POLONIA" } };
    const rejected = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: bad });
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json().code).toBe("SNAPSHOT_INVALID");
    expect((rejected.json().problems as string[]).some((p) => p.includes("EUR|PLN") && p.includes("PLN, not EUR"))).toBe(true);
    expect((await market(app2)).source).toBe("sample");
    const doc = app.swagger() as unknown as Doc;
    expect(JSON.stringify(doc.paths["/api/market"]!.put)).toContain("first currency of `ccy|csa`");
    await app2.close();
  });
});

describe("N8-03 the snapshot export ETag covers the register envelope", () => {
  it("a registration changes the ETag (old If-None-Match → 200 with the envelope), not X-Market-Snapshot-Id; the new ETag revalidates to 304", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const before = await app2.inject({ method: "GET", url: "/api/market/snapshot" });
    const etag = String(before.headers.etag);
    const marketId = String(before.headers["x-market-snapshot-id"]);
    // Since R10-1 the sample export carries the sample specs as `quotes`, so the envelope hash is present from the start.
    expect(etag).toMatch(new RegExp(`^"${marketId}-[0-9a-f]{16}"$`));
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag } })).statusCode).toBe(304);
    expect((await app2.inject({ method: "POST", url: "/api/market/indices", payload: czeonia("CZEONIA-N803") })).statusCode).toBe(201);
    const after = await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag } });
    expect(after.statusCode).toBe(200);
    expect((after.json().indices as { name: string }[]).map((i) => i.name)).toEqual(["CZEONIA-N803"]);
    const etag2 = String(after.headers.etag);
    expect(etag2).not.toBe(etag);
    expect(etag2).toMatch(new RegExp(`^"${marketId}-[0-9a-f]{16}"$`));
    expect(after.headers["x-market-snapshot-id"]).toBe(marketId);
    expect((await market(app2)).snapshotId).toBe(marketId);
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag2 } })).statusCode).toBe(304);
    // Another registration moves the ETag again; the market id still does not.
    expect((await app2.inject({ method: "POST", url: "/api/market/calendars", payload: { id: "N803-CAL", holidays: ["2027-07-06"] } })).statusCode).toBe(201);
    const third = await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag2 } });
    expect(third.statusCode).toBe(200);
    expect(third.headers["x-market-snapshot-id"]).toBe(marketId);
    await app2.close();
  });
});

describe("N8-04 atomic envelope import", () => {
  it("an invalid second entry registers nothing (indices, conventions, calendars); a consistent envelope registers in dependency order", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json;
    const bad = await app2.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: { ...snap, indices: [czeonia("PARTIAL-OK-R8"), czeonia("PARTIAL-BAD-R8", "NOPE-CAL")] },
    });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(bad.json()).toMatchObject({ code: "INVALID_CURVE_SPEC", details: { entry: "PARTIAL-BAD-R8", section: "indices" } });
    expect(bad.json().error).toContain("POST /api/market/calendars");
    expect(bad.json().error).toContain("nothing registered");
    expect((bad.json().details.problems as unknown[]).length).toBe(1);
    const m = await market(app2);
    expect((m.indices as { name: string }[]).map((i) => i.name)).not.toContain("PARTIAL-OK-R8");
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json().indices).toBeUndefined();
    // Conventions whose index is only defined in the same envelope are fine (validated against the envelope, registered after the indices);
    // a calendar defined in the envelope may be referenced by its indices.
    const conv = {
      currency: "CZK",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      floatIndex: "PRIBOR-6M-N804",
      floatFrequency: "6M",
      calendar: "CZ-N804",
      spotLag: 2,
      oisIndex: "CZEONIA-N804",
      oisFixedFrequency: "1Y",
      oisFixedDayCount: "ACT/360",
      oisPaymentLag: 2,
    };
    const good = await app2.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: {
        ...snap,
        calendars: [{ id: "CZ-N804", holidays: ["2027-07-05", "2027-07-06"] }],
        indices: [czeonia("CZEONIA-N804", "CZ-N804"), { ...czeonia("PRIBOR-6M-N804", "CZ-N804"), type: "IBOR", tenor: "6M", fixingLag: 2 }],
        conventions: [conv],
      },
    });
    expect(good.statusCode, good.body).toBe(200);
    expect(good.json()).toMatchObject({ calendars: ["CZ-N804"], indices: ["CZEONIA-N804", "PRIBOR-6M-N804"], conventions: ["CZK"] });
    // A bad convention next to good indices registers none of them either (HUF: the core register is process-wide, CZK is taken above).
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    const hufonia = { ...czeonia("HUFONIA-N804B"), currency: "HUF", curveId: "HUF-HUFONIA-N804B" };
    const mixed = await app3.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: {
        ...snap,
        indices: [hufonia],
        conventions: [{ ...conv, currency: "HUF", calendar: "TARGET", floatIndex: "NOPE-N804", oisIndex: "HUFONIA-N804B" }],
      },
    });
    expect(mixed.statusCode, mixed.body).toBe(400);
    expect(mixed.json().details.section).toBe("conventions");
    expect(((await market(app3)).indices as { name: string }[]).map((i) => i.name)).not.toContain("HUFONIA-N804B");
    expect((await market(app3)).currencies).not.toContain("HUF");
    // Built-in names are reported with `builtIn: true` as before.
    const builtIn = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, calendars: [{ id: "TARGET", holidays: [] }] } });
    expect(builtIn.statusCode).toBe(400);
    expect(builtIn.json()).toMatchObject({ code: "INVALID_CURVE_SPEC", details: { entry: "TARGET", builtIn: true } });
    await app2.close();
    await app3.close();
  });
});

describe("Markt R8-2 calendar register", () => {
  it("POST /api/market/calendars registers a custom calendar (201/200/400), indices may reference it, GET /api/market lists it, the snapshot envelope carries it", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    // Without the calendar the core's hint now names the endpoint.
    const early = await app2.inject({ method: "POST", url: "/api/market/indices", payload: czeonia("CZEONIA-R82", "CZ-R82") });
    expect(early.statusCode, early.body).toBe(400);
    expect(early.json().code).toBe("INVALID_CURVE_SPEC");
    expect(early.json().error).toContain("POST /api/market/calendars");
    const holidays = ["2027-01-01", "2027-07-05", "2027-07-06", "2027-09-28", "2027-10-28", "2027-11-17", "2027-12-24"];
    const cal = await app2.inject({
      method: "POST",
      url: "/api/market/calendars",
      payload: { id: "cz-r82", name: "Prague", holidays: [...holidays, "2027-07-06"] },
    });
    expect(cal.statusCode, cal.body).toBe(201);
    expect(cal.json()).toMatchObject({ registered: true, replaced: false, calendar: { id: "CZ-R82", name: "Prague", holidays, weekendsAreHolidays: true } });
    expect(getCalendar("CZ-R82").isHoliday(parseISO("2027-07-06"))).toBe(true);
    expect(getCalendar("CZ-R82").isHoliday(parseISO("2027-07-07"))).toBe(false);
    expect(getCalendar("CZ-R82").isHoliday(parseISO("2027-07-10"))).toBe(true); // Saturday
    const ix = await app2.inject({ method: "POST", url: "/api/market/indices", payload: czeonia("CZEONIA-R82", "CZ-R82") });
    expect(ix.statusCode, ix.body).toBe(201);
    // Composite ids work as for built-in calendars.
    expect((await app2.inject({ method: "POST", url: "/api/market/indices", payload: czeonia("CZEONIA-R82-J", "CZ-R82+TARGET") })).statusCode).toBe(201);
    // Re-registering replaces (200); built-ins and aliases never (400 builtIn); a bad date is 400 INVALID_DATE.
    const again = await app2.inject({
      method: "POST",
      url: "/api/market/calendars",
      payload: { id: "CZ-R82", name: "Prague", holidays: ["2027-07-06"], weekendsAreHolidays: false },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ replaced: true, calendar: { holidays: ["2027-07-06"], weekendsAreHolidays: false } });
    expect(getCalendar("CZ-R82").isHoliday(parseISO("2027-07-10"))).toBe(false);
    for (const id of ["TARGET", "eur", "USNY", "NO", "WEEKEND"]) {
      const r = await app2.inject({ method: "POST", url: "/api/market/calendars", payload: { id, holidays: [] } });
      expect(r.statusCode, id).toBe(400);
      expect(r.json(), id).toMatchObject({ code: "INVALID_CURVE_SPEC", details: { calendar: id.toUpperCase(), builtIn: true } });
    }
    const badDate = await app2.inject({ method: "POST", url: "/api/market/calendars", payload: { id: "BAD-R82", holidays: ["2027-02-30"] } });
    expect(badDate.statusCode, badDate.body).toBe(400);
    expect(badDate.json().code).toBe("INVALID_CALENDAR");
    expect(JSON.stringify(badDate.json().details.problems)).toContain("2027-02-30");
    expect((await app2.inject({ method: "POST", url: "/api/market/calendars", payload: { id: "BAD SPACE", holidays: [] } })).json().code).toBe(
      "VALIDATION_ERROR",
    );
    // GET /api/market lists built-in and custom calendars.
    const m = await market(app2);
    const calendars = m.calendars as { id: string; builtIn: boolean; holidays?: number }[];
    expect(calendars.find((c) => c.id === "TARGET")).toMatchObject({ builtIn: true });
    expect(calendars.find((c) => c.id === "NO")).toMatchObject({ builtIn: true });
    expect(calendars.find((c) => c.id === "CZ-R82")).toMatchObject({ builtIn: false, holidays: 1, weekendsAreHolidays: false });
    expect(calendars.find((c) => c.id === "BAD-R82")).toBeUndefined();
    // Snapshot envelope: exported, re-registered in a fresh instance (before the indices that need it).
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json & { calendars: Json[]; indices: Json[] };
    expect(snap.calendars).toEqual([{ id: "CZ-R82", name: "Prague", holidays: ["2027-07-06"], weekendsAreHolidays: false }]);
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    const imported = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({ calendars: ["CZ-R82"], indices: ["CZEONIA-R82", "CZEONIA-R82-J"] });
    expect((await app3.inject({ method: "GET", url: "/api/market/snapshot" })).json().calendars).toEqual(snap.calendars);
    const entries = await audit(app2);
    expect(entries.filter((e) => e.action === "register.calendar")).toHaveLength(2);
    // Contract: component, envelope schema, operation.
    const doc = app.swagger() as unknown as Doc;
    expect(Object.keys(doc.components.schemas)).toContain("CustomCalendar");
    const snapshotSchema = doc.components.schemas.MarketSnapshot as { properties: Record<string, { items?: { $ref?: string } }> };
    expect(snapshotSchema.properties.calendars?.items?.$ref).toContain("CustomCalendar");
    expect(doc.paths["/api/market/calendars"]!.post).toBeDefined();
    await app2.close();
    await app3.close();
  });
});

describe("Markt R8-3 par risk for every curve with known quotes", () => {
  it("a NOK swap has par buckets on NOK-NOWA after POST /api/market/curves; imported curves without quotes are named (PAR_RISK_INCOMPLETE:) instead of a silent zero", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const spec = oisSpec("NOK", "NOWA", 0.045);
    const curve = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec } });
    expect(curve.statusCode, curve.body).toBe(200);
    expect(curve.json().parRiskTracked).toBe(true);
    const trade = oisSwap("IRS-NOK-R83", "NOK", "NOWA");
    const par = await app2.inject({ method: "POST", url: "/api/risk/par", payload: { trade, reportingCurrency: "NOK" } });
    expect(par.statusCode, par.body).toBe(200);
    const curves = par.json().curves as { curveId: string; buckets: unknown[]; total: number }[];
    expect(curves.map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    expect(curves[0]!.buckets).toHaveLength(spec.quotes.length);
    expect(Math.abs(curves[0]!.total)).toBeGreaterThan(100);
    expect(par.json()).toMatchObject({ curvesWithoutQuotes: [], warnings: [] });
    // Portfolio variant reports per trade.
    const portfolio = await app2.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { trades: [trade], reportingCurrency: "NOK" } });
    expect(portfolio.statusCode, portfolio.body).toBe(200);
    expect(portfolio.json()[0]).toMatchObject({ curvesWithoutQuotes: [], warnings: [] });
    expect((portfolio.json()[0].curves as { curveId: string }[]).map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    // Imported into a fresh instance without the `quotes` envelope (round-8 format – since R9-1 the export carries the
    // quotes and the import keeps par risk complete, see review-r9.test.ts) the curve has no quotes: reported, not zeroed silently.
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json;
    // Since R10-1 the block carries the sample specs as well; the runtime curve is in it.
    expect((snap.quotes as unknown[]).map((q) => (q as { curveId: string }).curveId)).toContain("NOK-NOWA");
    delete snap.quotes;
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(200);
    const missing = await app3.inject({ method: "POST", url: "/api/risk/par", payload: { trade, reportingCurrency: "NOK" } });
    expect(missing.statusCode, missing.body).toBe(200);
    expect(missing.json().curves).toEqual([]);
    expect(missing.json().curvesWithoutQuotes).toEqual(["NOK-NOWA"]);
    expect((missing.json().warnings as string[])[0]).toMatch(/^PAR_RISK_INCOMPLETE: curve NOK-NOWA .*POST \/api\/market\/curves/);
    // Loading the curve's quotes into the imported market makes it complete again.
    expect((await app3.inject({ method: "POST", url: "/api/market/curves", payload: { spec } })).statusCode).toBe(200);
    const complete = await app3.inject({ method: "POST", url: "/api/risk/par", payload: { trade, reportingCurrency: "NOK" } });
    expect(complete.json()).toMatchObject({ curvesWithoutQuotes: [], warnings: [] });
    expect((complete.json().curves as { curveId: string }[]).map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    // Sample-market trades are unchanged (all four EUR curves bumped, nothing missing).
    const eur = (await app.inject({ method: "GET", url: "/api/trades/IRS-0001" })).json().trade as Json;
    const eurPar = await app.inject({ method: "POST", url: "/api/risk/par", payload: { trade: eur } });
    expect(eurPar.statusCode).toBe(200);
    expect(eurPar.json().curvesWithoutQuotes).toEqual([]);
    expect((eurPar.json().curves as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(WARNING_PREFIXES).toContain("PAR_RISK_INCOMPLETE");
    await app2.close();
    await app3.close();
  });
});

/** The eleven workstation templates (`CSV_IMPORT_TEMPLATES` in apps/web/src/lib/portfolio-io.ts, round-8 state) → API `?type=`. */
const WEB_TO_API: Record<string, CsvTradeType> = {
  IRS: "InterestRateSwap",
  FXF: "FxForward",
  CAP: "CapFloor",
  SWPT: "Swaption",
  FXO: "FxOption",
  CCS: "CrossCurrencySwap",
  FRA: "FRA",
  FXS: "FxSwap",
  BASIS: "BasisSwap",
  AMORT: "AmortisingSwap",
  IMM: "ImmSwap",
};
const WEB_TEMPLATES_R8: Record<string, { header: string; row: string }> = {
  IRS: {
    header: "type;id;name;counterparty;book;currency;notional;direction;rate;start;maturity;index;frequency;stepUp;status",
    row: "IRS;IRS-1001;Payer-Swap Kredit A;Landesbank A;Treasury;EUR;10000000;Pay;3,10 %;2026-09-07;10Y;EURIBOR-6M;1Y;2027-09-07:3,30 %|2028-09-07:3,50 %;Live",
  },
  FXF: {
    header: "type;id;name;counterparty;book;buyCurrency;buyAmount;sellCurrency;sellAmount;deliveryDate;status",
    row: "FXF;FXF-1001;Kauf USD Wareneinkauf;Commerzbank;Einkauf;USD;2345000;EUR;2000000;2027-03-15;Live",
  },
  CAP: {
    header: "type;id;name;counterparty;book;currency;notional;capFloor;strike;floorStrike;start;maturity;index;status",
    row: "CAP;CAP-1001;Cap Betriebsmittelkredit;DZ BANK;Treasury;EUR;8000000;Cap;3,00 %;;2026-09-07;5Y;EURIBOR-6M;Live",
  },
  SWPT: {
    header: "type;id;name;counterparty;book;currency;notional;direction;strike;expiry;tenor;status",
    row: "SWPT;SWPT-1001;Payer-Swaption 1Y×5Y;Landesbank A;Treasury;EUR;10000000;Payer;3,00 %;1Y;5Y;Live",
  },
  FXO: {
    header: "type;id;name;counterparty;book;pair;optionType;notional;strike;expiry;barrierType;barrierLevel;barrierRebate;barrierHit;status",
    row: "FXO;FXO-1001;EUR-Put/USD-Call Wareneinkauf;Commerzbank;Einkauf;EURUSD;Put;3000000;1,1500;2027-06-15;;;;;Live",
  },
  CCS: {
    header: "type;id;name;counterparty;book;pair;domesticNotional;spread;fixedRate;fxSpot;domesticPayReceive;effectiveDate;maturity;collateralCurrency;status",
    row: "CCS;CCS-1001;CCS EUR/USD 5Y;Commerzbank;USD-Finanzierung;EURUSD;10000000;-20;;1,17;Receive;2026-09-07;5Y;USD;Live",
  },
  FRA: {
    header: "type;id;name;counterparty;book;currency;notional;direction;rate;period;start;maturity;index;status",
    row: "FRA;FRA-1001;FRA EUR 3x6;DZ BANK;Liquidität;EUR;10000000;Pay;2,20 %;3x6;;;EURIBOR-3M;Live",
  },
  FXS: {
    header: "type;id;name;counterparty;book;pair;baseAmount;nearRate;farRate;nearDate;farDate;status",
    row: "FXS;FXS-1001;FX-Swap EUR/USD Prolongation;Commerzbank;Liquidität;EURUSD;1000000;1,1625;1,1800;2026-09-07;2027-09-07;Live",
  },
  BASIS: {
    header: "type;id;name;counterparty;book;currency;notional;receiveIndex;payIndex;spread;start;maturity;status",
    row: "BASIS;BASIS-1001;Basis-Swap 3M/6M;Landesbank A;Treasury;EUR;10000000;EURIBOR-3M;EURIBOR-6M;5;2026-09-07;5Y;Live",
  },
  AMORT: {
    header: "type;id;name;counterparty;book;currency;notional;finalNotional;amortisation;direction;rate;start;maturity;index;frequency;status",
    row: "AMORT;AMORT-1001;Tilgungsswap Kredit B;Landesbank A;Treasury;EUR;10000000;0;Linear;Pay;3,10 %;2026-09-07;10Y;EURIBOR-6M;1Y;Live",
  },
  IMM: {
    header: "type;id;name;counterparty;book;currency;notional;direction;rate;from;tenor;index;status",
    row: "IMM;IMM-1001;IMM-Swap EUR 2Y;DZ BANK;Treasury;EUR;10000000;Pay;3,00 %;2026-09-07;2Y;EURIBOR-6M;Live",
  },
};

/**
 * The workstation's live templates, read from its source when present: the `CSV_IMPORT_TEMPLATES` literal is
 * evaluated (it holds string arrays and plain objects only). `null` when the file is absent or the literal no
 * longer evaluates – the round-8 copy above is tested in any case.
 */
function liveWebTemplates(): Record<string, { header: string; row: string }> | null {
  const file = join(root, "apps", "web", "src", "lib", "portfolio-io.ts");
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");
  const m = /export const CSV_IMPORT_TEMPLATES[^=]*=\s*(\{[\s\S]*?\n\});/.exec(src);
  if (!m) return null;
  try {
    // Deliberate: the literal is the workstation's own source (string arrays and plain objects), evaluated in-process by this test only.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const templates = new Function(`return (${m[1]!});`)() as Record<string, { columns: string[]; example: string[]; headers?: Record<string, string> }>;
    const out: Record<string, { header: string; row: string }> = {};
    for (const [type, t] of Object.entries(templates)) {
      if (!Array.isArray(t.columns) || !Array.isArray(t.example) || t.columns.length !== t.example.length) return null;
      out[type] = { header: t.columns.map((c) => t.headers?.[c] ?? c).join(";"), row: t.example.join(";") };
    }
    return out;
  } catch {
    return null;
  }
}

describe("Markt R8-4 the workstation's CSV templates import through the API", () => {
  const importAll = async (templates: Record<string, { header: string; row: string }>, label: string) => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    for (const [web, apiType] of Object.entries(WEB_TO_API)) {
      const t = templates[web];
      expect(t, `${label}: template ${web}`).toBeDefined();
      const text = `${t!.header}\n${t!.row}\n`;
      const built = csvToTrades(text, apiType, VALUATION_DATE);
      expect(built.rejected, `${label}: ${web}`).toEqual([]);
      const r = await csv(`/api/trades/import?type=${apiType}`, text, app2);
      expect(r.statusCode, `${label}: ${web}: ${r.body}`).toBe(200);
      expect(r.json(), `${label}: ${web}: ${r.body}`).toMatchObject({ total: 1, imported: 1, rejected: 0 });
      expect(typeof r.json().results[0].pv, `${label}: ${web}`).toBe("number");
    }
    return app2;
  };

  it("all eleven round-8 template rows (header + example) import and price; vocabularies map as documented", async () => {
    const app2 = await importAll(WEB_TEMPLATES_R8, "r8 copy");
    const trade = async (id: string) => (await app2.inject({ method: "GET", url: `/api/trades/${id}` })).json().trade as Json & { legs?: Json[] };
    // FX forward: buy/sell quartet → exact amounts, no `pair` needed.
    expect(await trade("FXF-1001")).toMatchObject({
      type: "FxForward",
      buyCurrency: "USD",
      buyAmount: 2_345_000,
      sellCurrency: "EUR",
      sellAmount: 2_000_000,
      deliveryDate: "2027-03-15",
    });
    // FX option: `expiry` → `expiryDate`.
    expect(await trade("FXO-1001")).toMatchObject({ type: "FxOption", expiryDate: "2027-06-15", strike: 1.15, optionType: "Put" });
    // CCS: `maturity` → `tenor`, plain `-20` = −20 bp, `Receive` on the domestic leg.
    const ccs = await trade("CCS-1001");
    const eurLeg = ccs.legs!.find((l) => l.currency === "EUR")!;
    expect(eurLeg).toMatchObject({ type: "Float", payReceive: "Receive" });
    expect(eurLeg.spread as number).toBeCloseTo(-0.002, 12);
    expect(ccs.collateralCurrency).toBe("USD");
    // Basis swap: plain `5` = 5 bp.
    const basis = await trade("BASIS-1001");
    expect(basis.legs![0]!.spread as number).toBeCloseTo(0.0005, 12);
    // FRA: `period` column carries `3x6`, EURIBOR-3M.
    const fra = await trade("FRA-1001");
    expect(fra.type).toBe("FRA");
    expect(fra.index).toBe("EURIBOR-3M");
    // Swaption: `direction` → `payerReceiver`; IRS/AMORT/IMM step-up and amortisation as before.
    expect(await trade("SWPT-1001")).toMatchObject({ type: "Swaption", payerReceiver: "Payer" });
    expect(((await trade("IRS-1001")).legs![0] as Json).rateSchedule).toBeDefined();
    await app2.close();
  });

  it("the live workstation templates (apps/web/src/lib/portfolio-io.ts) import as well when their literal evaluates", async () => {
    const live = liveWebTemplates();
    const app2 = await importAll(live ?? WEB_TEMPLATES_R8, live ? "live web templates" : "r8 copy (live literal not evaluable)");
    await app2.close();
  });

  it("spread unit heuristic (`parseCsvSpread`): suffix wins, |x| ≥ 1 is bp, |x| < 1 a decimal; other vocabulary aliases are symmetric", () => {
    expect(parseCsvSpread("-20")).toBeCloseTo(-0.002, 15);
    expect(parseCsvSpread("5")).toBeCloseTo(0.0005, 15);
    expect(parseCsvSpread("-20 bp")).toBeCloseTo(-0.002, 15);
    expect(parseCsvSpread("0,12 %")).toBeCloseTo(0.0012, 15);
    expect(parseCsvSpread("-0,002")).toBeCloseTo(-0.002, 15);
    expect(parseCsvSpread("0.0005")).toBeCloseTo(0.0005, 15);
    expect(parseCsvSpread("1")).toBeCloseTo(0.0001, 15);
    expect(() => parseCsvSpread("abc")).toThrow(/not a number/);
    // `tenor` for `maturity` (IRS), `expiryDate` for `expiry` (swaption), `maturity` for `end` (FRA), API FXF vocabulary still first.
    const irs = csvToTrades(
      "currency;notional;payReceive;fixedRate;effectiveDate;tenor\nEUR;10.000.000;Pay;3 %;2026-09-07;5Y\n",
      "InterestRateSwap",
      VALUATION_DATE,
    );
    expect(irs.rejected).toEqual([]);
    const swpt = csvToTrades("currency;notional;payerReceiver;strike;expiryDate;tenor\nEUR;10.000.000;Payer;3 %;1Y;5Y\n", "Swaption", VALUATION_DATE);
    expect(swpt.rejected).toEqual([]);
    const fra = csvToTrades("currency;notional;payReceive;rate;start;maturity\nEUR;10.000.000;Pay;2 %;2026-12-07;2027-06-07\n", "FRA", VALUATION_DATE);
    expect(fra.rejected).toEqual([]);
    const both = csvToTrades(
      "pair;baseAmount;rate;deliveryDate;buyCurrency;buyAmount;sellCurrency;sellAmount\nEURUSD;-2.000.000;1,1725;2027-03-15;USD;9;EUR;9\n",
      "FxForward",
      VALUATION_DATE,
    );
    expect(both.rejected).toEqual([]);
    expect(both.trades[0]).toMatchObject({ buyCurrency: "USD", sellCurrency: "EUR", sellAmount: 2_000_000 });
    expect(() => csvToTrades("buyCurrency;buyAmount;deliveryDate\nUSD;1;2027-03-15\n", "FxForward", VALUATION_DATE)).toThrow(
      /pair, baseAmount, rate.*or `buyCurrency`/,
    );
    // The documentation names the aliases and the unit rule.
    const doc = JSON.stringify((app.swagger() as unknown as Doc).paths["/api/trades/import"]!.post);
    expect(doc).toContain("|x| ≥ 1 is read as basis points");
    expect(doc).toContain("`buyCurrency`/`buyAmount`/`sellCurrency`/`sellAmount`");
    expect(doc).toContain("`expiry` ↔ `expiryDate`");
  });
});

describe("Catalogue and toolchain (N6-03a / N4-03 rest, prefix lists)", () => {
  it("WARNING_PREFIXES has thirteen entries (PAR_RISK_INCONSISTENT since R10), all described in the contract and listed in README and Architektur", () => {
    expect(WARNING_PREFIXES).toHaveLength(13);
    const doc = app.swagger() as unknown as Doc;
    const description = (doc.components.schemas.ErrorResponse as { properties: { code: { description: string } } }).properties.code.description;
    for (const w of WARNING_PREFIXES) expect(description, w).toContain(`\`${w}:\``);
    for (const file of ["README.md", join("docs", "architecture", "01-architektur.md")]) {
      const text = readFileSync(join(root, file), "utf8");
      for (const w of WARNING_PREFIXES) expect(text, `${file}: ${w}`).toContain(`\`${w}:\``);
    }
  });

  it("commitlint (conventional, header ≤ 72, scopes) is configured and run in CI on the pushed / PR range; typed lint covers core and api", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { devDependencies: Record<string, string>; scripts: Record<string, string> };
    expect(pkg.devDependencies["@commitlint/cli"]).toBeDefined();
    expect(pkg.devDependencies["@commitlint/config-conventional"]).toBeDefined();
    expect(pkg.scripts["lint:commits"]).toContain("commitlint");
    const config = readFileSync(join(root, "commitlint.config.mjs"), "utf8");
    expect(config).toContain("@commitlint/config-conventional");
    expect(config).toMatch(/"header-max-length":\s*\[2,\s*"always",\s*72\]/);
    for (const scope of ["core", "api", "web", "ci", "docs", "quality", "repo"]) expect(config).toContain(`"${scope}"`);
    const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("commitlint");
    expect(ci).toContain("github.event.pull_request.base.sha");
    expect(ci).toContain("github.event.before");
    const eslint = readFileSync(join(root, "eslint.config.js"), "utf8");
    expect(eslint).toContain("recommendedTypeChecked");
    expect(eslint).toContain("projectService");
    expect(eslint).toMatch(/apps\/api\/src\/\*\*\/\*\.ts/);
    expect(eslint).toMatch(/packages\/pricing-core\/src\/\*\*\/\*\.ts/);
  });
});
