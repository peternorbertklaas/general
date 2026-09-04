/**
 * Round-9 review findings (docs/quality/review-architektur-r9.md, review-markt-r9.md, review-quant-r9.md §3):
 * N9-01 the envelope pre-check substitutes pending calendars per component of a composite id (the fresh-process
 *       round trip lives in `envelope-fresh-process.test.ts` – this file only covers the unit rule),
 * N9-02 an import roll drops `meta.snapshotTime` and marks the label; EMIR field 23 = new valuation date,
 * N9-03 the rebuild applies the discount-curve rule to re-bootstrapped runtime curves,
 * R9-1  snapshot envelope `quotes` (bootstrap specs of runtime curves) → par risk after a re-import,
 * R9-4  every API CSV template leads with the workstation's `type` column; the reader checks it against `?type=`,
 * N9-04 three stale sentences, CHANGELOG 0.3.0, schema texts of `lockoutDays` / `rebateAt`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { CSV_TEMPLATES, CSV_TRADE_TYPES, CSV_TYPE_TOKENS, TYPE_COLUMN_NOTE, csvTemplateText, csvToTrades, csvTypeMismatch } from "./lib/csv-import.js";
import { type RuntimeCurveQuotes } from "./lib/curve-specs.js";
import { envelopeProblems, quotesProblems, substitutePendingCalendar } from "./lib/register-validation.js";
import { RegisterStore, rolledMeta } from "./lib/store.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;
type Doc = {
  paths: Record<string, Record<string, { description?: string; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, Json> };
};
type MarketView = Json & { discountCurveId: Record<string, string>; meta?: Json; snapshotId: string };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VALUATION_DATE = 20699; // 2026-09-03
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const csv = (url: string, text: string, a: FastifyInstance) => a.inject({ method: "POST", url, headers: { "content-type": "text/csv" }, payload: text });
const market = async (a: FastifyInstance) => (await a.inject({ method: "GET", url: "/api/market" })).json() as MarketView;
const snapshot = async (a: FastifyInstance) => a.inject({ method: "GET", url: "/api/market/snapshot" });

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
const czeonia = (name: string, calendar: string) => ({
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

describe("N9-01 envelope pre-check with composite calendar ids", () => {
  it("substitutePendingCalendar drops pending components and keeps known ones; ids without pending parts are untouched", () => {
    const pending = new Set(["CZ-X9", "HU-X9"]);
    expect(substitutePendingCalendar("CZ-X9+TARGET", pending)).toBe("TARGET");
    expect(substitutePendingCalendar("TARGET+CZ-X9", pending)).toBe("TARGET");
    expect(substitutePendingCalendar("cz-x9+US", pending)).toBe("US");
    expect(substitutePendingCalendar("CZ-X9", pending)).toBe("TARGET");
    expect(substitutePendingCalendar("CZ-X9+HU-X9", pending)).toBe("TARGET");
    expect(substitutePendingCalendar("CZ-X9+TARGET+HU-X9", pending)).toBe("TARGET");
    expect(substitutePendingCalendar("TARGET+US", pending)).toBe("TARGET+US");
    expect(substitutePendingCalendar("NOPE+TARGET", pending)).toBe("NOPE+TARGET");
  });

  it("envelopeProblems accepts indices and conventions on `<pending>+TARGET` and still reports an unknown component", () => {
    const calendars = [{ id: "CZ-N901", holidays: ["2027-07-05"] }];
    const conv = {
      currency: "CZK",
      fixedFrequency: "1Y",
      fixedDayCount: "ACT/360",
      floatIndex: "PRIBOR-6M-N901",
      floatFrequency: "6M",
      calendar: "CZ-N901+TARGET",
      spotLag: 2,
      oisIndex: "CZEONIA-N901",
      oisFixedFrequency: "1Y",
      oisFixedDayCount: "ACT/360",
      oisPaymentLag: 2,
    };
    const indices = [czeonia("CZEONIA-N901", "CZ-N901+TARGET"), { ...czeonia("PRIBOR-6M-N901", "TARGET+CZ-N901"), type: "IBOR", tenor: "6M", fixingLag: 2 }];
    // Types: the API's envelope input mirrors the core's register types; the literals above are the JSON bodies clients send.
    expect(envelopeProblems({ calendars, indices, conventions: [conv] } as Parameters<typeof envelopeProblems>[0])).toEqual([]);
    const bad = envelopeProblems({ calendars, indices: [czeonia("CZEONIA-N901B", "CZ-N901+NOPE-N901")] } as Parameters<typeof envelopeProblems>[0]);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.problem).toContain("NOPE-N901");
    expect(bad[0]!.problem).toContain("POST /api/market/calendars");
    // The contract says so.
    const doc = app.swagger() as unknown as Doc;
    expect(doc.paths["/api/market/calendars"]!.post!.description).toContain("per component (N9-01)");
    expect(JSON.stringify(doc.components.schemas.MarketSnapshot)).toContain("composite id (`CZ+TARGET`, N9-01)");
  });
});

describe("N9-02 import roll drops meta.snapshotTime and marks the label", () => {
  it("rolledMeta: snapshotTime removed, label marked once (idempotent, second roll replaces the mark), source kept", () => {
    expect(rolledMeta({ source: "eod", snapshotTime: "2026-09-03T17:00:00Z", label: "EOD-0903" }, 20788)).toEqual({
      source: "eod",
      label: "EOD-0903 (rolled to 2026-12-01)",
    });
    expect(rolledMeta({ label: "EOD-0903 (rolled to 2026-12-01)" }, 20788)).toEqual({ label: "EOD-0903 (rolled to 2026-12-01)" });
    expect(rolledMeta({ label: "EOD-0903 (rolled to 2026-10-01)" }, 20788)).toEqual({ label: "EOD-0903 (rolled to 2026-12-01)" });
    // A snapshot time that already dates the new valuation date is not stale; a snapshot without a label gets none.
    expect(rolledMeta({ snapshotTime: "2026-12-01T16:00:00Z" }, 20788)).toEqual({ snapshotTime: "2026-12-01T16:00:00Z" });
    expect(rolledMeta(undefined, 20788)).toEqual({});
  });

  it("PUT { valuationDate } on an imported snapshot: meta.snapshotTime gone, label `(rolled to …)`, EMIR field 23 = 17:00 UTC of the new date; the report names the rolled label", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const snap = (await snapshot(app2)).json() as Json & { meta?: Json };
    snap.meta = { ...(snap.meta ?? {}), label: "EOD-0903", snapshotTime: "2026-09-03T17:00:00Z" };
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(200);
    expect((await app3.inject({ method: "POST", url: "/api/trades", payload: oisSwap("IRS-ROLL-N902", "EUR", "ESTR") })).statusCode).toBe(201);
    // Before the roll the snapshot time is field 23.
    const before = (await app3.inject({ method: "GET", url: "/api/emir/valuations" })).json() as { valuationTimestamp: string }[];
    expect(before[0]!.valuationTimestamp).toBe("2026-09-03T17:00:00Z");
    const rolled = await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-12-01" } });
    expect(rolled.statusCode, rolled.body).toBe(200);
    expect(rolled.json()).toMatchObject({ valuationDate: "2026-12-01", source: "import", warnings: [] });
    const m = await market(app3);
    expect(m.meta!.snapshotTime).toBeUndefined();
    expect(m.meta!.label).toBe("EOD-0903 (rolled to 2026-12-01)");
    const after = (await app3.inject({ method: "GET", url: "/api/emir/valuations" })).json() as { valuationTimestamp: string }[];
    expect(after[0]!.valuationTimestamp).toBe("2026-12-01T17:00:00Z");
    // `asOf` / `timestamp` still win as documented.
    const asOf = (await app3.inject({ method: "GET", url: "/api/emir/valuations?asOf=2026-12-01T16:30:00Z" })).json() as { valuationTimestamp: string }[];
    expect(asOf[0]!.valuationTimestamp).toBe("2026-12-01T16:30:00Z");
    // The valuation report shows the new date and the marked label.
    const stored = (await app3.inject({ method: "GET", url: "/api/trades/IRS-ROLL-N902" })).json().trade as Json;
    const report = await app3.inject({ method: "POST", url: "/api/report", payload: { trade: stored } });
    expect(report.statusCode, report.body).toBe(200);
    expect(JSON.stringify(report.json())).toContain("2026-12-01");
    expect(JSON.stringify(report.json())).toContain("EOD-0903 (rolled to 2026-12-01)");
    // A second roll keeps a single mark; the snapshot export of the rolled market carries no snapshotTime either.
    expect((await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2027-01-04" } })).statusCode).toBe(200);
    expect((await market(app3)).meta!.label).toBe("EOD-0903 (rolled to 2027-01-04)");
    const exported = (await snapshot(app3)).json() as Json & { meta?: Json };
    expect(exported.meta?.snapshotTime).toBeUndefined();
    // Contract texts.
    const doc = app.swagger() as unknown as Doc;
    expect(doc.paths["/api/market"]!.put!.description).toContain("drops `meta.snapshotTime`");
    expect(doc.paths["/api/market"]!.put!.description).not.toContain("everything else as imported");
    expect(doc.paths["/api/emir/valuations"]!.get!.description).toContain("N9-02");
    await app2.close();
    await app3.close();
  });
});

describe("N9-03 the rebuild applies the discount-curve rule to re-bootstrapped runtime curves", () => {
  const importWithDkkDiscount = async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("DKK", "DESTR", 0.025) } })).statusCode).toBe(200);
    const snap = (await snapshot(app2)).json() as Json;
    await app2.close();
    // The reviewer's snapshot carried no `quotes` (round-8 format): without them DKK-DESTR cannot be re-bootstrapped by
    // `discardImport` and the mapping is lost – exactly the case the rule must repair. (With `quotes`, R9-1, the curve
    // itself survives the rebuild and keeps the mapping.)
    delete snap.quotes;
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    expect((await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).statusCode).toBe(200);
    expect((await market(app3)).discountCurveId.DKK).toBe("DKK-DESTR");
    return app3;
  };

  it("reviewer's DKK scenario: import with DKK-DESTR → DKK-ALT in import mode → discardImport → DKK-ALT is the discount curve, the DKK swap prices", async () => {
    const app3 = await importWithDkkDiscount();
    const alt = await app3.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("DKK", "DESTR", 0.03, "DKK-ALT") } });
    expect(alt.statusCode, alt.body).toBe(200);
    expect(alt.json()).toMatchObject({ discountCurveSet: false, discountCurveId: "DKK-DESTR" });
    const discarded = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(discarded.json().source).toBe("sample");
    expect(discarded.json().discountCurveId.DKK).toBe("DKK-ALT");
    const warnings = discarded.json().warnings as string[];
    expect(warnings.every((w) => w.startsWith("MARKET_STATE_DROPPED:"))).toBe(true);
    const lost = warnings.find((w) => w.includes("discountCurveId.DKK = DKK-DESTR"));
    expect(lost).toBeDefined();
    expect(lost).toContain("DKK-ALT is now the discount curve of DKK");
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/DKK-ALT" })).statusCode).toBe(200);
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/DKK-DESTR" })).statusCode).toBe(404);
    // DKK discounting works again: an EUR/DKK forward prices on DKK-ALT (the reviewer's swap failed with NO_DISCOUNT_CURVE).
    expect((await app3.inject({ method: "PUT", url: "/api/market", payload: { fxSpots: { EURDKK: 7.46 } } })).statusCode).toBe(200);
    const fxf = {
      type: "FxForward",
      id: "FXF-DKK-N903",
      buyCurrency: "EUR",
      buyAmount: 1e6,
      sellCurrency: "DKK",
      sellAmount: 7.5e6,
      deliveryDate: "2027-09-07",
    };
    const price = await app3.inject({ method: "POST", url: "/api/price", payload: { trade: fxf, reportingCurrency: "DKK" } });
    expect(price.statusCode, price.body).toBe(200);
    // Par risk bumps the surviving runtime curve.
    const par = await app3.inject({ method: "POST", url: "/api/risk/par", payload: { trade: fxf, reportingCurrency: "DKK" } });
    expect(par.statusCode, par.body).toBe(200);
    expect((par.json().curves as { curveId: string }[]).map((c) => c.curveId)).toContain("DKK-ALT");
    // The DESTR swap itself still needs the index's projection curve `DKK-DESTR` (registry `curveId`) – the discount curve is no longer the problem.
    const swap = await app3.inject({
      method: "POST",
      url: "/api/price",
      payload: { trade: oisSwap("IRS-DKK-N903", "DKK", "DESTR"), reportingCurrency: "DKK" },
    });
    expect(swap.statusCode).toBe(422);
    expect(swap.json()).toMatchObject({ code: "CURVE_NOT_FOUND", details: { curveId: "DKK-DESTR" } });
    await app3.close();
  });

  it("`isDiscountCurve: false` is respected by the rebuild (no promotion → NO_DISCOUNT_CURVE remains, mapping loss named without replacement)", async () => {
    const app3 = await importWithDkkDiscount();
    expect(
      (await app3.inject({ method: "POST", url: "/api/market/curves", payload: { isDiscountCurve: false, spec: oisSpec("DKK", "DESTR", 0.03, "DKK-ALT-N") } }))
        .statusCode,
    ).toBe(200);
    const discarded = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(discarded.json().discountCurveId.DKK).toBeUndefined();
    const lost = (discarded.json().warnings as string[]).find((w) => w.includes("discountCurveId.DKK = DKK-DESTR"))!;
    expect(lost).toBeDefined();
    expect(lost).not.toContain("is now the discount curve");
    const price = await app3.inject({
      method: "POST",
      url: "/api/price",
      payload: { trade: oisSwap("IRS-DKK-N903B", "DKK", "DESTR"), reportingCurrency: "DKK" },
    });
    expect(price.statusCode).toBe(422);
    expect(price.json().code).toBe("NO_DISCOUNT_CURVE");
    // A later `PUT { discountCurveId }` survives a plain date change untouched (the rule fills gaps only).
    expect((await app3.inject({ method: "PUT", url: "/api/market", payload: { discountCurveId: { DKK: "DKK-ALT-N" } } })).statusCode).toBe(200);
    const moved = await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } });
    expect(moved.json(), moved.body).toMatchObject({ warnings: [] });
    expect(moved.json().discountCurveId.DKK).toBe("DKK-ALT-N");
    const doc = app.swagger() as unknown as Doc;
    expect(doc.paths["/api/market"]!.put!.description).toContain("N9-03");
    await app3.close();
  });
});

describe("Markt R9-1 snapshot envelope `quotes`", () => {
  it("POST /curves → export carries { curveId, spec } → fresh instance import stores the quotes → par risk has buckets; snapshot id unchanged, ETag covers the quotes", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const plain = await snapshot(app2);
    const idBefore = String(plain.headers["x-market-snapshot-id"]);
    expect(plain.headers.etag).toBe(`"${idBefore}"`);
    expect(plain.json().quotes).toBeUndefined();
    const spec = oisSpec("NOK", "NOWA", 0.045);
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec } })).statusCode).toBe(200);
    const exported = await snapshot(app2);
    const exporterId = String(exported.headers["x-market-snapshot-id"]);
    expect(exporterId).toBe((await market(app2)).snapshotId);
    // The curve changed the market id; the quotes block is API metadata and hashed into the ETag only.
    expect(exported.headers.etag).toMatch(new RegExp(`^"${exporterId}-[0-9a-f]{16}"$`));
    const snap = exported.json() as Json & { quotes: RuntimeCurveQuotes[]; curves: { id: string }[] };
    expect(snap.quotes).toEqual([{ curveId: "NOK-NOWA", spec }]);
    expect(snap.curves.map((c) => c.id)).toContain("NOK-NOWA");
    expect(snap.indices).toBeUndefined();
    // A revalidation with the ETag → 304; the register hash alone (as if no quotes were known) → 200.
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": String(exported.headers.etag) } })).statusCode).toBe(
      304,
    );
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": `"${exporterId}"` } })).statusCode).toBe(200);
    expect(new RegisterStore().hash()).toBe("");
    expect(new RegisterStore().hash(snap.quotes)).toMatch(/^[0-9a-f]{16}$/);

    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    const imported = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({ quotes: ["NOK-NOWA"], snapshotId: exporterId });
    expect((await market(app3)).snapshotId).toBe(exporterId);
    const trade = oisSwap("IRS-NOK-R91", "NOK", "NOWA");
    const par = await app3.inject({ method: "POST", url: "/api/risk/par", payload: { trade, reportingCurrency: "NOK" } });
    expect(par.statusCode, par.body).toBe(200);
    const curves = par.json().curves as { curveId: string; buckets: unknown[]; total: number }[];
    expect(curves.map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    expect(curves[0]!.buckets).toHaveLength(spec.quotes.length);
    expect(Math.abs(curves[0]!.total)).toBeGreaterThan(100);
    expect(par.json()).toMatchObject({ curvesWithoutQuotes: [], warnings: [] });
    const portfolio = await app3.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { trades: [trade], reportingCurrency: "NOK" } });
    expect(portfolio.json()[0]).toMatchObject({ curvesWithoutQuotes: [], warnings: [] });
    // The imported curve is the snapshot's (identical nodes), not a re-bootstrap.
    const curve = (await app3.inject({ method: "GET", url: "/api/market/curves/NOK-NOWA" })).json() as { nodes: { df: number }[]; meta?: Json };
    const original = (await app2.inject({ method: "GET", url: "/api/market/curves/NOK-NOWA" })).json() as { nodes: { df: number }[] };
    expect(curve.nodes.map((n) => n.df)).toEqual(original.nodes.map((n) => n.df));
    // Round trip: the re-export carries the same block and the same ETag as the exporter.
    const reexport = await snapshot(app3);
    expect(reexport.json().quotes).toEqual(snap.quotes);
    expect(reexport.headers.etag).toBe(exported.headers.etag);
    // Import mode: a roll keeps the quotes (par risk still complete on the rolled curve); discardImport re-bootstraps the curve from them.
    expect((await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } })).json()).toMatchObject({
      source: "import",
      warnings: [],
    });
    const rolledPar = await app3.inject({ method: "POST", url: "/api/risk/par", payload: { trade, reportingCurrency: "NOK" } });
    expect((rolledPar.json().curves as { curveId: string }[]).map((c) => c.curveId)).toEqual(["NOK-NOWA"]);
    const discarded = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(discarded.json().source).toBe("sample");
    expect((discarded.json().warnings as string[]).filter((w) => w.includes("NOK-NOWA"))).toEqual([]);
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/NOK-NOWA" })).json().referenceDate).toBe("2026-10-01");
    expect((await market(app3)).discountCurveId.NOK).toBe("NOK-NOWA");
    await app2.close();
    await app3.close();
  });

  it("invalid quotes entries answer 422 SNAPSHOT_INVALID (unknown curve, currency mismatch, spec.id mismatch, unregistered index, duplicate); schema violations 400", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const spec = oisSpec("NOK", "NOWA", 0.045);
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec } })).statusCode).toBe(200);
    const snap = (await snapshot(app2)).json() as Json & { quotes: { curveId: string; spec: Json }[] };
    const idBefore = (await market(app2)).snapshotId;
    const attempt = async (quotes: unknown) => app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, quotes } });
    const unknownCurve = await attempt([{ curveId: "NOK-NOPE", spec: { ...spec, id: "NOK-NOPE" } }]);
    expect(unknownCurve.statusCode, unknownCurve.body).toBe(422);
    expect(unknownCurve.json().code).toBe("SNAPSHOT_INVALID");
    expect(unknownCurve.json().problems).toEqual(["quotes: curve NOK-NOPE is not in the snapshot's curves"]);
    const wrongCcy = await attempt([{ curveId: "NOK-NOWA", spec: { ...spec, currency: "SEK" } }]);
    expect(wrongCcy.statusCode).toBe(422);
    expect((wrongCcy.json().problems as string[])[0]).toContain("denominated in NOK, its spec in SEK");
    const wrongId = await attempt([{ curveId: "NOK-NOWA", spec: { ...spec, id: "OTHER" } }]);
    expect((wrongId.json().problems as string[])[0]).toContain("spec.id OTHER does not match curveId");
    const unknownIndex = await attempt([{ curveId: "NOK-NOWA", spec: { ...spec, index: "NOPE-R91" } }]);
    expect((unknownIndex.json().problems as string[])[0]).toContain("index NOPE-R91 is not registered");
    const duplicate = await attempt([snap.quotes[0], snap.quotes[0]]);
    expect((duplicate.json().problems as string[])[0]).toContain("more than one spec");
    // Schema: a spec without quotes / an unknown property → 400 VALIDATION_ERROR.
    const noQuotes = await attempt([{ curveId: "NOK-NOWA", spec: { id: "NOK-NOWA", currency: "NOK", index: "NOWA" } }]);
    expect(noQuotes.statusCode).toBe(400);
    expect(noQuotes.json().code).toBe("VALIDATION_ERROR");
    expect((await attempt([{ curveId: "NOK-NOWA", spec, extra: 1 }])).statusCode).toBe(400);
    // Nothing changed.
    expect((await market(app2)).snapshotId).toBe(idBefore);
    expect((await market(app2)).source).toBe("sample");
    // Unit: a pending envelope index counts as registered.
    const m = { curves: { "CZK-X": { currency: "CZK" } } } as unknown as Parameters<typeof quotesProblems>[0];
    const czk = { curveId: "CZK-X", spec: { id: "CZK-X", currency: "CZK", index: "CZEONIA-R91", quotes: [] } };
    expect(quotesProblems(m, [czk])).toEqual([
      "quotes: curve CZK-X: index CZEONIA-R91 is not registered (add it to the envelope's indices or POST /api/market/indices first)",
    ]);
    expect(quotesProblems(m, [czk], [{ name: "czeonia-r91" }])).toEqual([]);
    // Contract: component `CurveBuildSpec`, `quotes` in `MarketSnapshot`, documented on export, import, par risk and the prefix catalogue.
    const doc = app.swagger() as unknown as Doc;
    expect(Object.keys(doc.components.schemas)).toContain("CurveBuildSpec");
    const ms = doc.components.schemas.MarketSnapshot as { properties: Record<string, { items?: { properties?: Record<string, { $ref?: string }> } }> };
    expect(ms.properties.quotes?.items?.properties?.spec?.$ref).toContain("CurveBuildSpec");
    expect(JSON.stringify(doc.paths["/api/market/bootstrap"]!.post)).toContain("CurveBuildSpec");
    expect(doc.paths["/api/market/snapshot"]!.get!.description).toContain("`quotes[]`");
    expect(doc.paths["/api/market/snapshot"]!.put!.description).toContain("`quotes` check");
    expect(JSON.stringify(doc.paths["/api/risk/par"]!.post)).toContain("`quotes` entry (R9-1)");
    const description = (doc.components.schemas.ErrorResponse as { properties: { code: { description: string } } }).properties.code.description;
    expect(description).toContain("carried no `quotes` entry for it (R9-1)");
    await app2.close();
  });
});

/** The workstation's type tokens, read from its source when present (`CSV_TRADE_TYPES` literal); `null` when unavailable. */
function liveWebTypeTokens(): string[] | null {
  const file = join(root, "apps", "web", "src", "lib", "portfolio-io.ts");
  if (!existsSync(file)) return null;
  const m = /export const CSV_TRADE_TYPES[^=]*=\s*\[([^\]]*)\]/.exec(readFileSync(file, "utf8"));
  if (!m) return null;
  return [...m[1]!.matchAll(/"([A-Z]+)"/g)].map((x) => x[1]!);
}

describe("Markt R9-4 the `type` column of the API CSV templates", () => {
  it("every template file leads with `type` and the workstation's token; the tokens are the workstation's CSV_TRADE_TYPES; each file imports", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const live = liveWebTypeTokens();
    if (live) expect([...live].sort()).toEqual(Object.values(CSV_TYPE_TOKENS).sort());
    expect(Object.values(CSV_TYPE_TOKENS).sort()).toEqual(["AMORT", "BASIS", "CAP", "CCS", "FRA", "FXF", "FXO", "FXS", "IMM", "IRS", "SWPT"]);
    for (const type of CSV_TRADE_TYPES) {
      const text = csvTemplateText(type);
      const [header, example] = text.trimEnd().split("\n") as [string, string];
      expect(header.split(";")).toEqual(["type", ...CSV_TEMPLATES[type].required, ...CSV_TEMPLATES[type].optional]);
      expect(example.split(";")[0]).toBe(CSV_TYPE_TOKENS[type]);
      expect(example.split(";")).toHaveLength(header.split(";").length);
      const built = csvToTrades(text, type, VALUATION_DATE);
      expect(built.rejected, type).toEqual([]);
      expect(built.trades[0]!.type).toBe(CSV_TEMPLATES[type].tradeType); // the column never lands on the trade – `type` stays the trade type
      const r = await csv(`/api/trades/import?type=${type}`, text, app2);
      expect(r.statusCode, `${type}: ${r.body}`).toBe(200);
      expect(r.json(), type).toMatchObject({ total: 1, imported: 1, rejected: 0 });
    }
    await app2.close();
  });

  it("a `type` cell matching `?type=` (token or template name, any case, header `typ`/`produkt`) is ignored; a mismatch rejects the row with a clear reason", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const fxf = CSV_TEMPLATES.FxForward;
    const header = ["type", ...fxf.required, ...fxf.optional].join(";");
    const row = (token: string, id: string) => [token, ...fxf.example.map((c, i) => (i === fxf.required.length ? id : c))].join(";");
    const text = [header, row("FXF", "FXF-A"), row("fxforward", "FXF-B"), row("", "FXF-C"), row("IRS", "FXF-D"), row("weird", "FXF-E")].join("\n") + "\n";
    const unit = csvToTrades(text, "FxForward", VALUATION_DATE);
    expect(unit.trades.map((t) => t.id)).toEqual(["FXF-A", "FXF-B", "FXF-C"]);
    expect(unit.rejected).toEqual([
      { row: 4, reason: 'type: "IRS" does not match ?type=FxForward (accepted: FXF, FxForward) – import this row with ?type=InterestRateSwap' },
      { row: 5, reason: 'type: "weird" does not match ?type=FxForward (accepted: FXF, FxForward)' },
    ]);
    const r = await csv("/api/trades/import?type=FxForward", text, app2);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ total: 5, imported: 3, rejected: 2 });
    const rejected = (r.json().results as { status: string; row?: number; reason?: string }[]).filter((x) => x.status === "rejected");
    expect(rejected.map((x) => x.row)).toEqual([4, 5]);
    expect(rejected[0]!.reason).toContain("?type=InterestRateSwap");
    // German header alias, and the workstation's own file for a basis swap (token BASIS ≠ IRS although it builds an InterestRateSwap).
    const typ = csvToTrades(`Typ;${fxf.required.join(";")}\nFXF;${fxf.example.slice(0, fxf.required.length).join(";")}\n`, "FxForward", VALUATION_DATE);
    expect(typ.rejected).toEqual([]);
    const basisText = csvTemplateText("BasisSwap");
    expect(csvToTrades(basisText, "BasisSwap", VALUATION_DATE).rejected).toEqual([]);
    expect(csvToTrades(basisText.replace(/^type;/, "type;").replace("\nBASIS;", "\nIRS;"), "BasisSwap", VALUATION_DATE).rejected[0]!.reason).toContain(
      "?type=InterestRateSwap",
    );
    expect(csvTypeMismatch("  amort ", CSV_TEMPLATES.AmortisingSwap)).toBeUndefined();
    expect(csvTypeMismatch("AmortisingSwap", CSV_TEMPLATES.AmortisingSwap)).toBeUndefined();
    expect(csvTypeMismatch("IRS", CSV_TEMPLATES.AmortisingSwap)).toContain("?type=InterestRateSwap");
    // Documented: the note, every template's token and the template files in the operation description; the request-body schema names the rule.
    const doc = app.swagger() as unknown as Doc;
    const description = doc.paths["/api/trades/import"]!.post!.description!;
    expect(description).toContain(TYPE_COLUMN_NOTE);
    for (const type of CSV_TRADE_TYPES) {
      expect(description).toContain(`**${type}**`);
      expect(description).toContain(`(\`type\` token \`${CSV_TYPE_TOKENS[type]}\`)`);
      expect(description).toContain(csvTemplateText(type).trimEnd());
    }
    expect(JSON.stringify(doc.paths["/api/trades/import"]!.post)).toContain("optional leading `type` column");
    await app2.close();
  });
});

describe("N9-04 / round-9 documentation and contract texts", () => {
  it("CONTRIBUTING says 44 operations, SECURITY names both snapshot ETag forms, compliance mapping and CHANGELOG say the tags are set (publication pending)", () => {
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toContain("44 Operationen");
    expect(contributing).not.toContain("43 Operationen");
    const security = read("SECURITY.md");
    expect(security).toContain('`"snapshotId"` bzw. `"snapshotId-registerHash"`');
    const pending = "Tags sind lokal gesetzt, Veröffentlichung durch Maintainer ausstehend";
    expect(read("docs", "compliance", "01-regulatorik-mapping.md")).toContain(pending);
    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain(pending);
    expect(changelog).not.toContain("die Tags werden am Ende dieser Qualitätsrunde gesetzt");
    // Quant reviewer: the smile bound is 50 absolute vol points, not 50 % of the ATM.
    expect(changelog).not.toContain("|RR|/|BF| > 50 % des ATM");
    expect(changelog).toContain("50 Vol-Punkte");
    // Round 9 release section with its compare link; version files agree.
    expect(changelog).toContain("## [0.3.0] – 2026-09-04");
    expect(changelog).toContain("[0.3.0]: https://github.com/peternorbertklaas/general/compare/v0.2.0...v0.3.0");
    const version = (JSON.parse(read("package.json")) as { version: string }).version;
    expect(version).toBe("0.3.0");
    for (const file of [join("apps", "api", "package.json"), join("apps", "web", "package.json"), join("packages", "pricing-core", "package.json")]) {
      expect((JSON.parse(read(file)) as { version: string }).version, file).toBe(version);
    }
    expect(read("packages", "pricing-core", "src", "version.ts")).toContain(`PACKAGE_VERSION = "${version}"`);
  });

  it("schema texts follow the core's round-9 changes: lockout counting (ISDA/QuantLib), default rebateAt hit; the contract still has 44 operations", () => {
    const doc = app.swagger() as unknown as Doc;
    const floatLeg = JSON.stringify(doc.components.schemas.FloatLeg);
    expect(floatLeg).toContain("`lockoutDays: 1` the last day repeats the previous day's fixing");
    expect(floatLeg).toContain("QuantLib `OvernightIndexedCoupon(lockoutDays)`");
    const fxo = JSON.stringify(doc.components.schemas.FxOption);
    expect(fxo).toContain("Default since R9 (Quant N7-5 rest): `hit`");
    const ops = Object.values(doc.paths).flatMap((methods) => Object.values(methods).map((op) => (op as { operationId?: string }).operationId));
    expect(ops.filter(Boolean)).toHaveLength(44);
    // README and Architektur name the quotes envelope and the template `type` column.
    for (const file of ["README.md", join("docs", "architecture", "01-architektur.md")]) {
      const text = read(file);
      expect(text, file).toContain("`quotes`");
      expect(text, file).toContain("`type`");
    }
    expect(read("docs", "architecture", "02-adrs.md")).toContain("Ergänzung (Review R9");
  });
});
