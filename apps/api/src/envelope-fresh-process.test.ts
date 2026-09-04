/**
 * Architektur N9-01 (docs/quality/review-architektur-r9.md): the snapshot envelope of an API instance that registered a
 * custom calendar and referenced it in a **composite** id (`CZ-X9+TARGET`) must import into a fresh process – the
 * documented purpose "EoD archive → restart → re-import". Round 8's R8-2 test imported the same case with 200 only
 * because exporter and importer shared the process-wide core register.
 *
 * This file therefore lives on its own: vitest gives it a fresh worker (empty runtime register – asserted below) and
 * the import additionally runs in a **child process** (`node --import tsx`), so the importer has never seen `CZ-X9`.
 * The exporting instance is built here, the child imports the file it wrote, prices the CZK swap and reports back.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { getCalendar, isBuiltInCalendar, knownCurrencies, knownIndices } from "@deriva/pricing-core";
import { buildApp } from "./app.js";

type Json = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..");
const tmp = mkdtempSync(join(tmpdir(), "deriva-envelope-r9-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const CAL = "CZ-X9";
const JOINT = `${CAL}+TARGET`;
const index = (name: string, type: "OIS" | "IBOR") => ({
  name,
  currency: "CZK",
  type,
  tenor: type === "OIS" ? "1D" : "6M",
  dayCount: "ACT/360",
  fixingCalendar: JOINT,
  fixingLag: type === "OIS" ? 0 : 2,
  businessDayConvention: "ModifiedFollowing",
  endOfMonth: false,
  curveId: `CZK-${name}`,
});
const conventions = {
  currency: "CZK",
  fixedFrequency: "1Y",
  fixedDayCount: "ACT/360",
  floatIndex: "PRIBOR-6M-X9",
  floatFrequency: "6M",
  calendar: JOINT,
  spotLag: 2,
  oisIndex: "CZEONIA-X9",
  oisFixedFrequency: "1Y",
  oisFixedDayCount: "ACT/360",
  oisPaymentLag: 2,
};
const curveSpec = {
  id: "CZK-CZEONIA-X9",
  currency: "CZK",
  index: "CZEONIA-X9",
  quotes: [
    { type: "Deposit", tenor: "1W", rate: 0.036 },
    { type: "OIS", tenor: "6M", rate: 0.0355 },
    { type: "OIS", tenor: "1Y", rate: 0.035 },
    { type: "OIS", tenor: "2Y", rate: 0.034 },
    { type: "OIS", tenor: "5Y", rate: 0.033 },
    { type: "OIS", tenor: "10Y", rate: 0.0335 },
  ],
};
const leg = (type: "Fixed" | "Float", payReceive: "Pay" | "Receive") => ({
  type,
  payReceive,
  notional: 1e8,
  currency: "CZK",
  effectiveDate: "2026-09-07",
  terminationDate: "2031-09-07",
  frequency: "1Y",
  dayCount: "ACT/360",
  calendar: JOINT,
  ...(type === "Fixed" ? { rate: 0.04 } : { index: "CZEONIA-X9" }),
});
const czkSwap = { type: "InterestRateSwap", id: "IRS-CZK-X9", legs: [leg("Fixed", "Pay"), leg("Float", "Receive")] };

/** Runs in the child: import the exported file into a brand-new instance, price and par-risk the CZK swap, report as JSON on stdout. */
const childScript = `
import { readFileSync } from "node:fs";
import { getCalendar, isBuiltInCalendar, knownCurrencies, knownIndices } from "@deriva/pricing-core";
import { buildApp } from ${JSON.stringify(join(apiDir, "src", "app.ts"))};
const { snapshot, trade } = JSON.parse(readFileSync(process.env.DERIVA_R9_FILE, "utf8"));
let calendarKnown = true;
try { getCalendar(${JSON.stringify(CAL)}); } catch { calendarKnown = false; }
const fresh = { calendarKnown, builtIn: isBuiltInCalendar(${JSON.stringify(CAL)}), czk: knownCurrencies().includes("CZK"), indices: knownIndices().filter((ix) => ix.currency === "CZK").map((ix) => ix.name) };
const app = await buildApp({ logger: false, seedPortfolio: false });
await app.ready();
const imported = await app.inject({ method: "PUT", url: "/api/market/snapshot", payload: snapshot });
const market = (await app.inject({ method: "GET", url: "/api/market" })).json();
const price = await app.inject({ method: "POST", url: "/api/price", payload: { trade, reportingCurrency: "CZK" } });
const par = await app.inject({ method: "POST", url: "/api/risk/par", payload: { trade, reportingCurrency: "CZK" } });
const exported = await app.inject({ method: "GET", url: "/api/market/snapshot" });
await app.close();
process.stdout.write(JSON.stringify({
  fresh,
  imported: { status: imported.statusCode, body: imported.json() },
  market: { source: market.source, snapshotId: market.snapshotId, currencies: market.currencies, discountCurveId: market.discountCurveId, calendars: market.calendars.filter((c) => !c.builtIn) },
  price: { status: price.statusCode, body: price.json() },
  par: { status: par.statusCode, body: par.json() },
  reexport: { etag: exported.headers.etag, quotes: exported.json().quotes, calendars: exported.json().calendars },
}));
`;

describe("N9-01 envelope with composite calendar ids imports into a fresh process", () => {
  it("this worker starts with an empty runtime register (fresh file = fresh core module state)", () => {
    expect(knownCurrencies()).not.toContain("CZK");
    expect(knownIndices().map((ix) => ix.name)).not.toContain("CZEONIA-X9");
    expect(isBuiltInCalendar(CAL)).toBe(false);
    expect(() => getCalendar(CAL)).toThrow();
  });

  it("export (calendar CZ-X9, indices and conventions on CZ-X9+TARGET, CZK curve with quotes) → import in a child process → 200; the CZK swap prices and has par buckets", async () => {
    // Exporter: register calendar → indices (joint calendar) → conventions (joint calendar) → curve → export.
    const app = await buildApp({ logger: false, seedPortfolio: false });
    expect(
      (await app.inject({ method: "POST", url: "/api/market/calendars", payload: { id: CAL, name: "Prague X9", holidays: ["2027-07-05", "2027-07-06"] } }))
        .statusCode,
    ).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/market/indices", payload: index("CZEONIA-X9", "OIS") })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/market/indices", payload: index("PRIBOR-6M-X9", "IBOR") })).statusCode).toBe(201);
    const conv = await app.inject({ method: "POST", url: "/api/market/conventions", payload: conventions });
    expect(conv.statusCode, conv.body).toBe(201);
    const curve = await app.inject({ method: "POST", url: "/api/market/curves", payload: { spec: curveSpec } });
    expect(curve.statusCode, curve.body).toBe(200);
    expect(curve.json()).toMatchObject({ discountCurveSet: true, parRiskTracked: true });
    const priced = await app.inject({ method: "POST", url: "/api/price", payload: { trade: czkSwap, reportingCurrency: "CZK" } });
    expect(priced.statusCode, priced.body).toBe(200);
    const pvExporter = priced.json().pv as number;
    const exported = await app.inject({ method: "GET", url: "/api/market/snapshot" });
    expect(exported.statusCode).toBe(200);
    const snapshot = exported.json() as Json & {
      calendars: Json[];
      indices: { fixingCalendar: string }[];
      conventions: { calendar: string }[];
      quotes: Json[];
    };
    const exporterId = String(exported.headers["x-market-snapshot-id"]);
    expect(snapshot.calendars.map((c) => c.id)).toEqual([CAL]);
    expect(snapshot.indices.map((ix) => ix.fixingCalendar)).toEqual([JOINT, JOINT]);
    expect(snapshot.conventions.map((c) => c.calendar)).toEqual([JOINT]);
    expect(snapshot.quotes.map((q) => q.curveId)).toEqual(["CZK-CZEONIA-X9"]);
    await app.close();

    // Importer: a brand-new node process (tsx loader) that has never seen CZ-X9.
    const file = join(tmp, "snapshot-x9.json");
    writeFileSync(file, JSON.stringify({ snapshot, trade: czkSwap }));
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childScript], {
      cwd: apiDir,
      env: { ...process.env, DERIVA_R9_FILE: file, NODE_ENV: "test" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 90_000,
    });
    const result = JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
      fresh: { calendarKnown: boolean; builtIn: boolean; czk: boolean; indices: string[] };
      imported: { status: number; body: Json };
      market: { source: string; snapshotId: string; currencies: string[]; discountCurveId: Record<string, string>; calendars: Json[] };
      price: { status: number; body: Json };
      par: { status: number; body: Json & { curves: { curveId: string; buckets: unknown[] }[] } };
      reexport: { etag: string; quotes: Json[]; calendars: Json[] };
    };
    // The child really was fresh: no CZK, no CZ-X9 before the import.
    expect(result.fresh).toEqual({ calendarKnown: false, builtIn: false, czk: false, indices: [] });
    // The import succeeded although CZ-X9 was only pending in the same envelope and referenced as `CZ-X9+TARGET`.
    expect(result.imported.status, JSON.stringify(result.imported.body)).toBe(200);
    expect(result.imported.body).toMatchObject({ calendars: [CAL], indices: ["CZEONIA-X9", "PRIBOR-6M-X9"], conventions: ["CZK"], quotes: ["CZK-CZEONIA-X9"] });
    expect(result.market.source).toBe("import");
    expect(result.market.snapshotId).toBe(exporterId);
    expect(result.market.currencies).toContain("CZK");
    expect(result.market.discountCurveId.CZK).toBe("CZK-CZEONIA-X9");
    expect(result.market.calendars).toEqual([expect.objectContaining({ id: CAL, builtIn: false, holidays: 2 })]);
    // The CZK swap on the joint calendar prices to the exporter's value …
    expect(result.price.status, JSON.stringify(result.price.body)).toBe(200);
    expect(result.price.body.pv as number).toBeCloseTo(pvExporter, 6);
    // … and has par buckets on its curve thanks to the `quotes` envelope (R9-1).
    expect(result.par.status, JSON.stringify(result.par.body)).toBe(200);
    expect(result.par.body.curves.map((c) => c.curveId)).toEqual(["CZK-CZEONIA-X9"]);
    expect(result.par.body.curves[0]!.buckets).toHaveLength(curveSpec.quotes.length);
    expect(result.par.body).toMatchObject({ curvesWithoutQuotes: [], warnings: [] });
    // The re-export carries the same envelope (round trip), with the ETag naming the envelope hash.
    expect(result.reexport.quotes).toEqual(snapshot.quotes);
    expect(result.reexport.calendars).toEqual(snapshot.calendars);
    expect(result.reexport.etag).toMatch(new RegExp(`^"${exporterId}-[0-9a-f]{16}"$`));
  }, 120_000);
});
