/**
 * Round-10 review findings (docs/quality/review-markt-r10.md §3, review-architektur-r10.md §3) – hardening round:
 * R10-1  the sample curves' bootstrap specs are explicit: exported in `quotes`, never assumed on import; par risk checks
 *        spec ↔ curve (`PAR_RISK_INCONSISTENT:`); `POST /api/market/curves` rebuilds the dependants of a replaced curve,
 * N10-02 a `quotes` entry for a sample curve id is dropped by `discardImport` (named when it differs), never applied silently,
 * N10-03 API vitest `testTimeout` / `hookTimeout` 30 s,
 * "ohne Abzug": order-independent register hash (ETag), `quotes: boolean` per curve in `GET /api/market` and `/curves/:id`,
 * N10-04 / N10-01 documentation: tag status wording, version labels, 0.3.1, 13 warning prefixes, commit-lint rule.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { type CurveQuote, PricingError, SAMPLE_QUOTES } from "@deriva/pricing-core";
import { buildApp } from "./app.js";
import { type BootstrapBody, affectedBodies, fromCurveBuildSpec, orderBodies, specDependencies } from "./lib/curve-specs.js";
import { quotesProblems } from "./lib/register-validation.js";
import { MarketStore, RegisterStore } from "./lib/store.js";
import { WARNING_PREFIXES } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;
type Doc = { paths: Record<string, Record<string, { description?: string }>>; components: { schemas: Record<string, Json> } };
type ParReport = {
  total: number;
  curves: { curveId: string; buckets: unknown[]; total: number }[];
  curvesWithoutQuotes: string[];
  curvesInconsistent: string[];
  warnings: string[];
};
type MarketView = { snapshotId: string; source: string; curves: { id: string; quotes: boolean }[] };
type Snapshot = Json & {
  valuationDate: string;
  curves: { id: string; currency: string; nodes: { date: string; df: number }[] }[];
  quotes?: { curveId: string; spec: Json }[];
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const fresh = () => buildApp({ logger: false, seedPortfolio: false });
const market = async (a: FastifyInstance) => (await a.inject({ method: "GET", url: "/api/market" })).json() as MarketView;
const snapshot = async (a: FastifyInstance) => a.inject({ method: "GET", url: "/api/market/snapshot" });
const importSnapshot = async (a: FastifyInstance, snap: Json) => a.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
const par = async (a: FastifyInstance, trade: Json) => {
  const r = await a.inject({ method: "POST", url: "/api/risk/par", payload: { trade } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as ParReport;
};
const dv01 = async (a: FastifyInstance, trade: Json) =>
  ((await a.inject({ method: "POST", url: "/api/risk", payload: { trade } })).json() as { dv01: number }).dv01;
const curveDfs = async (a: FastifyInstance, id: string) =>
  ((await a.inject({ method: "GET", url: `/api/market/curves/${id}` })).json() as { nodes: { df: number }[] }).nodes.map((n) => n.df);
const maxAbsDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));

/** The reviewer's EUR payer swap (10Y, EURIBOR-6M vs fixed) – depends on EUR-ESTR (discount) and EUR-EURIBOR-6M. */
const eurPayer = {
  type: "InterestRateSwap",
  id: "IRS-EUR-R10",
  legs: [
    {
      type: "Fixed",
      payReceive: "Pay",
      notional: 1e7,
      currency: "EUR",
      effectiveDate: "2026-09-07",
      terminationDate: "2036-09-07",
      frequency: "1Y",
      dayCount: "30E/360",
      calendar: "TARGET",
      rate: 0.03,
    },
    {
      type: "Float",
      payReceive: "Receive",
      notional: 1e7,
      currency: "EUR",
      effectiveDate: "2026-09-07",
      terminationDate: "2036-09-07",
      frequency: "6M",
      dayCount: "ACT/360",
      calendar: "TARGET",
      index: "EURIBOR-6M",
    },
  ],
};
/** `POST /api/market/curves EUR-ESTR` body: the sample OIS quotes shifted by +50 bp (the reviewer's EoD update). */
const estrPlus50 = {
  id: "EUR-ESTR",
  currency: "EUR",
  index: "ESTR",
  quotes: SAMPLE_QUOTES.eurOis.map((q) => ({ ...q, rate: (q as { rate: number }).rate + 0.005 })),
};
const oisSpec = (currency: string, index: string, level: number, id = `${currency}-${index}`) => ({
  id,
  currency,
  index,
  quotes: ["1W", "6M", "1Y", "2Y", "5Y", "10Y"].map((tenor, i): CurveQuote => {
    const rate = level + [0.001, 0.0005, 0, -0.001, -0.002, -0.0015][i]!;
    return i ? { type: "OIS", tenor, rate } : { type: "Deposit", tenor, rate };
  }),
});
/** The reviewer's "Fremd-EoD": every EUR discount factor shifted by ≈ +50 bp, nothing else changed. */
const foreignEod = (snap: Snapshot): Snapshot => {
  const val = Date.parse(snap.valuationDate);
  const curves = snap.curves.map((c) =>
    c.currency === "EUR" ? { ...c, nodes: c.nodes.map((n) => ({ ...n, df: n.df * Math.exp((-0.005 * (Date.parse(n.date) - val)) / 86_400_000 / 365) })) } : c,
  );
  const { quotes: _quotes, ...rest } = snap;
  return { ...rest, curves, meta: { ...((snap.meta as Json | undefined) ?? {}), label: "Fremd-EoD (EUR +50bp)" } };
};
const SAMPLE_IDS = ["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "USD-SOFR", "GBP-SONIA", "CHF-SARON", "JPY-TONA", "EUR-ESTR-USDCSA"];

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("Markt R10-1 (a)/(b) explicit sample specs: export, dependants after POST /curves, par ≈ DV01 in the origin process", () => {
  it("the plain export carries quotes for every sample curve; GET /api/market and /curves/:id say quotes: true; the exported specs re-import into a fresh instance", async () => {
    const app2 = await fresh();
    const exported = (await snapshot(app2)).json() as Snapshot;
    expect(exported.quotes!.map((q) => q.curveId)).toEqual(SAMPLE_IDS);
    for (const q of exported.quotes!) expect(q.spec.id).toBe(q.curveId);
    const m = await market(app2);
    expect(m.curves.map((c) => [c.id, c.quotes])).toEqual(SAMPLE_IDS.map((id) => [id, true]));
    expect((await app2.inject({ method: "GET", url: "/api/market/curves/EUR-ESTR" })).json().quotes).toBe(true);
    // The block passes the import checks (schema, `quotesProblems`) unchanged and lands as the importer's only specs.
    const app3 = await fresh();
    const imported = await importSnapshot(app3, exported);
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().quotes).toEqual(SAMPLE_IDS);
    expect((await market(app3)).curves.every((c) => c.quotes)).toBe(true);
    // Sample-market par risk is unchanged: consistent specs, nothing missing or excluded.
    const report = await par(app2, eurPayer);
    expect(report).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    expect(report.curves.map((c) => c.curveId)).toEqual(["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "EUR-ESTR-USDCSA"]);
    expect(Math.abs(report.total - (await dv01(app2, eurPayer))) / Math.abs(report.total)).toBeLessThan(0.05);
    await app2.close();
    await app3.close();
  });

  it("origin process: POST /curves EUR-ESTR (+50 bp) re-bootstraps EUR-EURIBOR-6M/-3M and the CSA curve (`rebuilt[]`), EURIBOR-6M changes, par ≈ DV01 (reviewer: 1 787 vs 6 828 before)", async () => {
    const app2 = await fresh();
    const before6m = await curveDfs(app2, "EUR-EURIBOR-6M");
    const post = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: estrPlus50 } });
    expect(post.statusCode, post.body).toBe(200);
    expect(post.json()).toMatchObject({ parRiskTracked: true, quotes: true, rebuilt: ["EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "EUR-ESTR-USDCSA"] });
    const after6m = await curveDfs(app2, "EUR-EURIBOR-6M");
    expect(maxAbsDiff(before6m, after6m)).toBeGreaterThan(1e-4); // the reviewer measured 0 (unchanged) before round 10
    const report = await par(app2, eurPayer);
    expect(report).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    const zero = await dv01(app2, eurPayer);
    expect(Math.abs(report.total - zero) / Math.abs(zero)).toBeLessThan(0.05);
    // The export carries the new ESTR spec (the body, not the default sample quotes) and still every other sample spec.
    const exported = (await snapshot(app2)).json() as Snapshot;
    const estr = exported.quotes!.find((q) => q.curveId === "EUR-ESTR")!;
    expect((estr.spec.quotes as { rate: number }[])[0]!.rate).toBeCloseTo((SAMPLE_QUOTES.eurOis[0] as { rate: number }).rate + 0.005, 12);
    expect(exported.quotes!.map((q) => q.curveId).sort()).toEqual([...SAMPLE_IDS].sort());
    // Audit names the rebuilt dependants.
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json() as { entries: { action: string; details?: { rebuilt?: string[] } }[] };
    expect(audit.entries.find((e) => e.action === "curve.replace")?.details?.rebuilt).toEqual(["EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "EUR-ESTR-USDCSA"]);
    // A valuation-date change keeps the override (body re-bootstrapped, dependants rebuilt on it): still consistent.
    const moved = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } });
    expect(moved.json(), moved.body).toMatchObject({ source: "sample", warnings: [] });
    const rolled = await par(app2, eurPayer);
    expect(rolled).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    expect(rolled.curves).toHaveLength(4);
    // Contract texts.
    const doc = app.swagger() as unknown as Doc;
    expect(doc.paths["/api/market/curves"]!.post!.description).toContain("`rebuilt[]`");
    expect(JSON.stringify(doc.paths["/api/market/curves"]!.post)).toContain("rebuilt");
    expect(JSON.stringify(doc.paths["/api/market"]!.get)).toContain("quotes: true");
    await app2.close();
  });

  it("a dependant that no longer bootstraps on the new curve answers 422 and leaves the market unchanged (atomic)", async () => {
    const app2 = await fresh();
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("NOK", "NOWA", 0.045) } })).statusCode).toBe(200);
    const basis: BootstrapBody["spec"] = {
      id: "NOK-NIBOR-6M-R10",
      currency: "NOK",
      index: "NIBOR-6M",
      discountCurveId: "NOK-NOWA",
      quotes: ["1Y", "2Y", "5Y"].map((tenor): CurveQuote => ({ type: "BasisSwap", tenor, spread: 0.001, otherIndex: "NOWA", otherCurveId: "NOK-NOWA" })),
    };
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: basis } })).json().rebuilt).toEqual([]);
    const idBefore = (await market(app2)).snapshotId;
    // Re-loading NOK-NOWA rebuilds the basis curve on it …
    const ok = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("NOK", "NOWA", 0.05) } });
    expect(ok.json(), ok.body).toMatchObject({ rebuilt: ["NOK-NIBOR-6M-R10"] });
    expect((await market(app2)).snapshotId).not.toBe(idBefore);
    // … an absurd NOWA curve (the 10Y quote at 90 %) fails → 422 with the core's code, nothing stored (market id unchanged).
    const idMid = (await market(app2)).snapshotId;
    const absurd = {
      ...oisSpec("NOK", "NOWA", 0.05),
      quotes: oisSpec("NOK", "NOWA", 0.05).quotes.map((q, i, all) => (i === all.length - 1 ? { ...q, rate: 0.9 } : q)),
    };
    const bad = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: absurd } });
    expect(bad.statusCode).toBe(422);
    expect((await market(app2)).snapshotId).toBe(idMid);
    expect((await app2.inject({ method: "GET", url: "/api/market/curves/NOK-NIBOR-6M-R10" })).statusCode).toBe(200);
    // Unit: a dependant that cannot be re-bootstrapped on the new curve is reported as a PricingError naming both curves.
    const store = new MarketStore();
    store.rememberCurve({ spec: oisSpec("NOK", "NOWA", 0.045) });
    store.rememberCurve({ spec: basis });
    const withoutNowa = { ...store.get(), curves: Object.fromEntries(Object.entries(store.get().curves).filter(([id]) => id !== "NOK-NOWA")) };
    let thrown: unknown;
    try {
      store.withDependentsRebuilt(withoutNowa, { spec: oisSpec("NOK", "NOWA", 0.05) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PricingError);
    expect((thrown as PricingError).message).toContain("curve NOK-NIBOR-6M-R10 is built on NOK-NOWA");
    expect((thrown as PricingError).details).toMatchObject({ curveId: "NOK-NIBOR-6M-R10", dependsOn: "NOK-NOWA" });
    await app2.close();
  });
});

describe("Markt R10-1 (a)/(c) import mode: only the snapshot's specs are bumped, spec ↔ curve is checked", () => {
  it("reviewer scenario: POST /curves EUR-ESTR (+50 bp) → export → fresh API import → par ≈ DV01 (not −97 521), no warnings; roll keeps consistency; discardImport drops identical sample specs silently", async () => {
    const app2 = await fresh();
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: estrPlus50 } })).statusCode).toBe(200);
    const exported = (await snapshot(app2)).json() as Snapshot;
    const app3 = await fresh();
    const imported = await importSnapshot(app3, exported);
    expect(imported.statusCode, imported.body).toBe(200);
    expect((await market(app3)).source).toBe("import");
    const report = await par(app3, eurPayer);
    const zero = await dv01(app3, eurPayer);
    expect(report).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    expect(report.curves.map((c) => c.curveId)).toEqual(["EUR-ESTR", "EUR-EURIBOR-6M", "EUR-EURIBOR-3M", "EUR-ESTR-USDCSA"]);
    expect(Math.abs(report.total - zero) / Math.abs(zero)).toBeLessThan(0.05);
    expect(report.total).toBeGreaterThan(0); // the reviewer saw −97 521 at a DV01 of +6 828
    // Identical to the origin's numbers (same curves, same specs).
    const origin = await par(app2, eurPayer);
    expect(report.total).toBeCloseTo(origin.total, 6);
    // Portfolio variant reports the same.
    const portfolio = await app3.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { trades: [eurPayer] } });
    expect(portfolio.json()[0]).toMatchObject({ total: report.total, curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    // Import roll: curves with quotes are re-bootstrapped at the new date – spec and curve stay consistent, par risk complete.
    const rolled = await app3.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-10-01" } });
    expect(rolled.json(), rolled.body).toMatchObject({ source: "import", warnings: [] });
    expect((await app3.inject({ method: "GET", url: "/api/market/curves/EUR-ESTR" })).json().referenceDate).toBe("2026-10-01");
    const afterRoll = await par(app3, eurPayer);
    expect(afterRoll).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    expect(afterRoll.curves).toHaveLength(4);
    // Re-export from import mode carries exactly the imported block (no default sample specs sneak in).
    const reexport = (await snapshot(app3)).json() as Snapshot;
    expect(reexport.quotes!.map((q) => q.curveId)).toEqual(exported.quotes!.map((q) => q.curveId));
    // discardImport: the sample market is rebuilt from the importer's own quotes; the imported sample specs are dropped – the
    // seven unchanged ones silently, the +50 bp ESTR spec named (N10-02) – and EUR-ESTR is the importer's sample curve again
    // (back on the sample date, so the curves compare with a fresh instance).
    const discarded = await app3.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true, valuationDate: "2026-09-03" } });
    expect(discarded.json().source).toBe("sample");
    const warnings = discarded.json().warnings as string[];
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.startsWith("MARKET_STATE_DROPPED:"))).toBe(true);
    expect(warnings.find((w) => w.includes("quotes of sample curve EUR-ESTR"))).toContain("POST /api/market/curves");
    const app4 = await fresh();
    expect(await curveDfs(app3, "EUR-ESTR")).toEqual(await curveDfs(app4, "EUR-ESTR"));
    expect(((await snapshot(app3)).json() as Snapshot).quotes!.map((q) => q.curveId)).toEqual(SAMPLE_IDS);
    await app2.close();
    await app3.close();
    await app4.close();
  });

  it("foreign EoD without quotes → curvesWithoutQuotes for the EUR curves and total 0 (PAR_RISK_INCOMPLETE:), no fake number; quotes: false per curve", async () => {
    const app2 = await fresh();
    const foreign = foreignEod((await snapshot(app2)).json() as Snapshot);
    expect(foreign.quotes).toBeUndefined();
    const imported = await importSnapshot(app2, foreign);
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().quotes).toEqual([]);
    const m = await market(app2);
    expect(m.source).toBe("import");
    expect(m.curves.every((c) => c.quotes === false)).toBe(true);
    expect((await app2.inject({ method: "GET", url: "/api/market/curves/EUR-ESTR" })).json().quotes).toBe(false);
    const report = await par(app2, eurPayer);
    expect(report.curves).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.curvesWithoutQuotes).toEqual(["EUR-ESTR", "EUR-EURIBOR-6M"]);
    expect(report.curvesInconsistent).toEqual([]);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings.every((w) => w.startsWith("PAR_RISK_INCOMPLETE:"))).toBe(true);
    // The export of the imported market carries no quotes block (nothing is invented).
    expect(((await snapshot(app2)).json() as Snapshot).quotes).toBeUndefined();
    // Loading the curve's quotes into the imported market makes it consistent and complete again; the dependant has none.
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: estrPlus50 } })).json()).toMatchObject({
      rebuilt: [],
      quotes: true,
    });
    const partial = await par(app2, eurPayer);
    expect(partial.curves.map((c) => c.curveId)).toEqual(["EUR-ESTR"]);
    expect(partial.curvesWithoutQuotes).toEqual(["EUR-EURIBOR-6M"]);
    expect(partial.curvesInconsistent).toEqual([]);
    await app2.close();
  });

  it("foreign EoD with stale quotes (the exporter's block, curves shifted) → PAR_RISK_INCONSISTENT: with max |Δdf|, curvesInconsistent[], total 0 – never the level difference", async () => {
    const app2 = await fresh();
    const original = (await snapshot(app2)).json() as Snapshot;
    const foreign = { ...foreignEod(original), quotes: original.quotes };
    expect((await importSnapshot(app2, foreign)).statusCode).toBe(200);
    expect((await market(app2)).curves.every((c) => c.quotes)).toBe(true);
    const report = await par(app2, eurPayer);
    expect(report.curves).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.curvesWithoutQuotes).toEqual([]);
    expect(report.curvesInconsistent).toEqual(["EUR-ESTR", "EUR-EURIBOR-6M"]);
    expect(report.warnings).toHaveLength(2);
    for (const w of report.warnings) {
      expect(w).toMatch(
        /^PAR_RISK_INCONSISTENT: curve EUR-(ESTR|EURIBOR-6M): the stored bootstrap spec does not reproduce the curve \(max \|Δdf\| \d\.\d{2}e[-+]\d+ at the pillars\)/,
      );
      expect(w).toContain("POST /api/market/curves");
    }
    // `curveIds` restricts the report like before; the portfolio variant agrees.
    const only = await app2.inject({ method: "POST", url: "/api/risk/par", payload: { trade: eurPayer, curveIds: ["EUR-ESTR"] } });
    expect(only.json()).toMatchObject({ curvesInconsistent: ["EUR-ESTR"], curvesWithoutQuotes: [] });
    const portfolio = await app2.inject({ method: "POST", url: "/api/risk/par/portfolio", payload: { trades: [eurPayer] } });
    expect(portfolio.json()[0]).toMatchObject({ total: 0, curvesInconsistent: ["EUR-ESTR", "EUR-EURIBOR-6M"] });
    // Re-loading EUR-ESTR from the stale spec makes that curve consistent (curve = bootstrap(spec)); the dependant keeps its stale spec.
    const estrSpec = original.quotes!.find((q) => q.curveId === "EUR-ESTR")!.spec;
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: estrSpec } })).json().rebuilt).toEqual([
      "EUR-EURIBOR-6M",
      "EUR-EURIBOR-3M",
      "EUR-ESTR-USDCSA",
    ]);
    const fixed = await par(app2, eurPayer);
    expect(fixed).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    // Contract: the new prefix is catalogued and described, the report schema names `curvesInconsistent`.
    expect(WARNING_PREFIXES).toContain("PAR_RISK_INCONSISTENT");
    const doc = app.swagger() as unknown as Doc;
    const description = (doc.components.schemas.ErrorResponse as { properties: { code: { description: string } } }).properties.code.description;
    expect(description).toContain("`PAR_RISK_INCONSISTENT:`");
    expect(JSON.stringify(doc.paths["/api/risk/par"]!.post)).toContain("curvesInconsistent");
    expect(JSON.stringify(doc.paths["/api/risk/par/portfolio"]!.post)).toContain("PAR_RISK_INCONSISTENT");
    await app2.close();
  });

  it("R10-1 (5): a quotes entry whose index is denominated in another currency than the curve is rejected (422 SNAPSHOT_INVALID)", async () => {
    const app2 = await fresh();
    const snap = (await snapshot(app2)).json() as Snapshot;
    const wrong = { ...snap, quotes: [{ curveId: "EUR-ESTR", spec: { id: "EUR-ESTR", currency: "EUR", index: "SOFR", quotes: SAMPLE_QUOTES.eurOis } }] };
    const r = await importSnapshot(app2, wrong);
    expect(r.statusCode).toBe(422);
    expect(r.json().problems).toEqual(["quotes: curve EUR-ESTR: index SOFR is denominated in USD, the curve in EUR"]);
    expect((await market(app2)).source).toBe("sample");
    // Unit: a pending envelope index with a currency is checked too; without one it is taken as given (R9 behaviour).
    const m = { curves: { "CZK-X": { currency: "CZK" } } } as unknown as Parameters<typeof quotesProblems>[0];
    const czk = { curveId: "CZK-X", spec: { id: "CZK-X", currency: "CZK", index: "CZEONIA-R10", quotes: [] } };
    expect(quotesProblems(m, [czk], [{ name: "czeonia-r10", currency: "HUF" }])).toEqual([
      "quotes: curve CZK-X: index CZEONIA-R10 is denominated in HUF, the curve in CZK",
    ]);
    expect(quotesProblems(m, [czk], [{ name: "czeonia-r10", currency: "czk" }])).toEqual([]);
    expect(quotesProblems(m, [czk], [{ name: "czeonia-r10" }])).toEqual([]);
    await app2.close();
  });
});

describe("N10-02 a quotes entry for a sample curve id never replaces the sample curve silently", () => {
  it("the entry is kept for the import mode (par risk checks it), discardImport drops it with MARKET_STATE_DROPPED naming EUR-ESTR, the sample curve is the sample curve, the export no longer carries it", async () => {
    const app2 = await fresh();
    const plain = (await snapshot(app2)).json() as Snapshot;
    const oneSpec = { id: "EUR-ESTR", currency: "EUR", index: "ESTR", quotes: SAMPLE_QUOTES.eurOis.map((q) => ({ ...q, rate: 0.01 })) };
    const imported = await importSnapshot(app2, { ...plain, quotes: [{ curveId: "EUR-ESTR", spec: oneSpec }] });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().quotes).toEqual(["EUR-ESTR"]);
    // Import mode: the 1 % spec does not describe the snapshot's curve → excluded, not bumped; EURIBOR-6M has no spec at all.
    const report = await par(app2, eurPayer);
    expect(report).toMatchObject({ total: 0, curves: [], curvesWithoutQuotes: ["EUR-EURIBOR-6M"], curvesInconsistent: ["EUR-ESTR"] });
    const discarded = await app2.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(discarded.json().source).toBe("sample");
    const warnings = discarded.json().warnings as string[];
    expect(warnings.every((w) => w.startsWith("MARKET_STATE_DROPPED:"))).toBe(true);
    const dropped = warnings.find((w) => w.includes("quotes of sample curve EUR-ESTR"));
    expect(dropped).toBeDefined();
    expect(dropped).toContain("from the imported snapshot");
    expect(dropped).toContain("sample market rebuilt EUR-ESTR from its own quotes");
    // The sample curve is intact (the reviewer found DF[5] 0.9175 instead of 0.9843) and the export is the plain sample block.
    const app3 = await fresh();
    expect(await curveDfs(app2, "EUR-ESTR")).toEqual(await curveDfs(app3, "EUR-ESTR"));
    const exported = (await snapshot(app2)).json() as Snapshot;
    expect(exported.quotes!.find((q) => q.curveId === "EUR-ESTR")!.spec).toEqual(plain.quotes!.find((q) => q.curveId === "EUR-ESTR")!.spec);
    const clean = await par(app2, eurPayer);
    expect(clean).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    // An entry identical to the sample spec is dropped without a word (nothing is lost).
    expect((await importSnapshot(app2, plain)).statusCode).toBe(200);
    const quiet = await app2.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect((quiet.json().warnings as string[]).filter((w) => w.includes("quotes of sample curve"))).toEqual([]);
    // A curve loaded through POST /curves in import mode survives discardImport (the user's own definition) …
    expect((await importSnapshot(app2, plain)).statusCode).toBe(200);
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: estrPlus50 } })).statusCode).toBe(200);
    const kept = await app2.inject({ method: "PUT", url: "/api/market", payload: { discardImport: true } });
    expect((kept.json().warnings as string[]).filter((w) => w.includes("EUR-ESTR"))).toEqual([]);
    expect(maxAbsDiff(await curveDfs(app2, "EUR-ESTR"), await curveDfs(app3, "EUR-ESTR"))).toBeGreaterThan(1e-4);
    expect(await par(app2, eurPayer)).toMatchObject({ curvesWithoutQuotes: [], curvesInconsistent: [], warnings: [] });
    // Documented in the contract and ADR-027.
    const doc = app.swagger() as unknown as Doc;
    expect(JSON.stringify(doc.components.schemas.MarketSnapshot)).toContain("N10-02");
    expect(doc.paths["/api/market"]!.put!.description).toContain("N10-02");
    expect(read("docs", "architecture", "02-adrs.md")).toContain("N10-02");
    await app2.close();
    await app3.close();
  });
});

describe("Register hash and export ETag are order-independent; dependency helpers", () => {
  it("RegisterStore.hash(quotes) ignores the order of the entries; re-loading an identical spec keeps the ETag; two load orders give one ETag", async () => {
    const a = { curveId: "A", spec: oisSpec("NOK", "NOWA", 0.04, "A") };
    const b = { curveId: "B", spec: oisSpec("SEK", "SWESTR", 0.03, "B") };
    const store = new RegisterStore();
    expect(store.hash([a, b])).toBe(store.hash([b, a]));
    expect(store.hash([a, b])).not.toBe(store.hash([a]));
    // API: the reviewer's probe – POST /curves with an identical spec moved the entry to the end and changed the ETag.
    const app2 = await fresh();
    const nok = oisSpec("NOK", "NOWA", 0.045);
    const sek = oisSpec("SEK", "SWESTR", 0.02);
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: nok } })).statusCode).toBe(200);
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: sek } })).statusCode).toBe(200);
    const etag1 = String((await snapshot(app2)).headers.etag);
    expect((await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: nok } })).statusCode).toBe(200);
    expect(String((await snapshot(app2)).headers.etag)).toBe(etag1);
    expect((await app2.inject({ method: "GET", url: "/api/market/snapshot", headers: { "if-none-match": etag1 } })).statusCode).toBe(304);
    const app3 = await fresh();
    expect((await app3.inject({ method: "POST", url: "/api/market/curves", payload: { spec: sek } })).statusCode).toBe(200);
    expect((await app3.inject({ method: "POST", url: "/api/market/curves", payload: { spec: nok } })).statusCode).toBe(200);
    expect(String((await snapshot(app3)).headers.etag)).toBe(etag1);
    await app2.close();
    await app3.close();
  });

  it("specDependencies / orderBodies / affectedBodies follow the core's dependency rule (discount curve, references, quote curve ids)", () => {
    const ois: BootstrapBody = { spec: oisSpec("EUR", "ESTR", 0.02, "O") };
    const dual: BootstrapBody = { spec: { ...oisSpec("EUR", "EURIBOR-6M", 0.02, "D"), discountCurveId: "O" } };
    const basis: BootstrapBody = {
      spec: {
        id: "B",
        currency: "EUR",
        index: "EURIBOR-3M",
        quotes: [{ type: "BasisSwap", tenor: "1Y", spread: 0.001, otherIndex: "EURIBOR-6M", otherCurveId: "D" }],
      },
    };
    const xccy: BootstrapBody = {
      spec: {
        id: "X",
        currency: "EUR",
        index: "ESTR",
        quotes: [
          {
            type: "XccyBasis",
            tenor: "1Y",
            spread: -0.001,
            foreignCurrency: "USD",
            foreignDiscountCurveId: "F",
            foreignProjectionCurveId: "F",
            domesticProjectionCurveId: "O",
            fxSpot: 1.1,
          },
        ],
      },
    };
    expect(specDependencies(ois.spec)).toEqual([]);
    expect(specDependencies(dual.spec)).toEqual(["O"]);
    expect(specDependencies(basis.spec)).toEqual(["D"]);
    expect(specDependencies(xccy.spec).sort()).toEqual(["F", "O"]);
    expect(orderBodies([basis, xccy, dual, ois]).map((b) => b.spec.id)).toEqual(
      ["D", "O", "B", "X"].sort((p, q) => ["O", "D", "B", "X"].indexOf(p) - ["O", "D", "B", "X"].indexOf(q)),
    );
    const bodies = new Map([ois, dual, basis, xccy].map((b) => [b.spec.id, b]));
    expect(affectedBodies(["O"], bodies).map((b) => b.spec.id)).toEqual(["D", "B", "X"]);
    expect(affectedBodies(["D"], bodies).map((b) => b.spec.id)).toEqual(["B"]);
    expect(affectedBodies(["F"], bodies).map((b) => b.spec.id)).toEqual(["X"]); // a dependency outside the known specs still selects its dependants
    expect(affectedBodies(["D"], bodies, true).map((b) => b.spec.id)).toEqual(["D", "B"]);
    // Round trip of the sample specs through the body shape (ISO turn-of-year dates).
    const withJump = fromCurveBuildSpec({ ...oisSpec("EUR", "ESTR", 0.02, "J"), turnOfYear: [{ date: 20819, bp: 5 }] });
    expect(withJump.turnOfYear).toEqual([{ date: "2027-01-01", bp: 5 }]);
  });
});

describe("N10-03 test timeouts", () => {
  it("apps/api/vitest.config.ts sets testTimeout and hookTimeout to 30 s; CONTRIBUTING documents it", () => {
    const config = read("apps", "api", "vitest.config.ts");
    expect(config).toMatch(/testTimeout:\s*30000/);
    expect(config).toMatch(/hookTimeout:\s*30000/);
    expect(config).toContain("N10-03");
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toContain("`hookTimeout`");
    expect(contributing).toContain("N10-03");
  });
});

describe("N10-04 / N10-01 / round-10 documentation and version", () => {
  it("tag status sentences say the tag is set (not 'will be set'), version labels read v0.3, CONTRIBUTING names the next version and the commit-lint rule", () => {
    const stale = /(wird|werden) am Ende dieser Qualitätsrunde[^.\n]*gesetzt|folgt am Ende dieser Qualitätsrunde/;
    const changelog = read("CHANGELOG.md");
    const mapping = read("docs", "compliance", "01-regulatorik-mapping.md");
    const contributing = read("CONTRIBUTING.md");
    const security = read("SECURITY.md");
    expect(changelog).not.toMatch(stale);
    expect(mapping).not.toMatch(stale);
    expect(changelog).toContain("`v0.3.0` ist lokal");
    expect(mapping).toContain("`v0.3.0` → `e68cb34` lokal gesetzt");
    // CONTRIBUTING: 0.3.0 is current – the sentence names the version of this round and the next ones.
    expect(contributing).not.toContain("(`0.2.1`/`0.3.0`)");
    expect(contributing).toContain("0.3.1");
    expect(contributing).toContain("`0.4.0`");
    // Version labels: SECURITY and the mapping's §8 are on the v0.3 line (the epics file belongs to the web owner).
    expect(security).toContain("## Sicherheitsmaßnahmen der API (v0.3)");
    expect(security).not.toMatch(/\(v0\.2\)|in v0\.2\b|Stand v0\.2/);
    expect(mapping).toContain("(Stand v0.3)");
    expect(mapping).not.toContain("(Stand v0.2)");
    // N10-01: commit-lint before every commit.
    expect(contributing).toContain("N10-01");
    expect(contributing).toMatch(/vor jedem Commit[^.\n]*`pnpm lint:commits`|`pnpm lint:commits`[^.\n]*vor jedem Commit/);
  });

  it("CHANGELOG has the 0.3.1 section with its compare link; every package.json and version.ts carry 0.3.1", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("## [0.3.1] – 2026-09-04");
    expect(changelog).toContain("[0.3.1]: https://github.com/peternorbertklaas/general/compare/v0.3.0...v0.3.1");
    expect(changelog.indexOf("## [0.3.1]")).toBeLessThan(changelog.indexOf("## [0.3.0]"));
    for (const claim of ["PAR_RISK_INCONSISTENT:", "checkParRiskSpecs", "N10-02", "hookTimeout", "Observation", "INVALID_DATE", "13 Warnungs-Präfixe"]) {
      expect(changelog, claim).toContain(claim);
    }
    for (const file of [
      "package.json",
      join("apps", "api", "package.json"),
      join("apps", "web", "package.json"),
      join("packages", "pricing-core", "package.json"),
    ]) {
      expect((JSON.parse(read(file)) as { version: string }).version, file).toBe("0.3.1");
    }
    expect(read("packages", "pricing-core", "src", "version.ts")).toContain('PACKAGE_VERSION = "0.3.1"');
  });

  it("README and Architektur list all 13 prefixes and name the par-risk consistency check and quotes for all curves; ADR-023/027 carry the R10 addenda", () => {
    expect(WARNING_PREFIXES).toHaveLength(13);
    const readme = read("README.md");
    const architektur = read("docs", "architecture", "01-architektur.md");
    for (const text of [readme, architektur]) {
      for (const w of WARNING_PREFIXES) expect(text).toContain(`\`${w}:\``);
      expect(text).toContain("dreizehn");
      expect(text).not.toContain("zwölf Warnungs-Präfixe");
      expect(text).toContain("curvesInconsistent");
    }
    expect(readme).not.toContain("alle zwölf");
    expect(readme).toContain("Sample-Kurven");
    const adrs = read("docs", "architecture", "02-adrs.md");
    expect(adrs.match(/\*\*Ergänzung \(Review R10/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(adrs).toContain("`PAR_RISK_INCONSISTENT:`");
    expect(adrs).toContain("13 Präfixe");
  });
});
