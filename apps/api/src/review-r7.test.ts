/**
 * Round-7 review findings (docs/quality/review-architektur-r7.md, review-markt-r7.md):
 * N7-01 Node ≥ 22.22 toolchain (CI matrix 22/24, `engines`, `engine-strict`),
 * N7-02 `StoredTrade.etag` documented as the strong ETag it is,
 * R7-3  `POST /api/market/curves` sets the discount-curve mapping of a new currency; `PUT /api/market { discountCurveId }`,
 * R7-4  a valuation-date change regenerates the sample fixings (user fixings survive),
 * R7-5  the CCS CSV import accepts the workstation's older column names,
 * R6-5  register endpoints `POST /api/market/indices|conventions`, snapshot envelope `indices`/`conventions` (ADR-027),
 * dryRun `?dryRun=1` on the import validates and prices without storing; unknown query parameters → 400,
 * UNKNOWN_INDEX stays 422 and the contract points to the register.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { parseISO, sampleFixings } from "@deriva/pricing-core";
import { buildApp } from "./app.js";
import { csvToTrades } from "./lib/csv-import.js";
import { TRADE_ETAG_PATTERN, storedTradeSchema } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;
type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, Json> };
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VALUATION_DATE = 20699; // 2026-09-03
const csv = (url: string, text: string, a: FastifyInstance = app) => a.inject({ method: "POST", url, headers: { "content-type": "text/csv" }, payload: text });

const oisSpec = (currency: string, index: string, level: number) => ({
  id: `${currency}-${index}`,
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

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("N7-01 toolchain: Node ≥ 22.22 everywhere the requirement is stated", () => {
  it("engines, .nvmrc/.node-version, engine-strict and the CI matrix agree (no Node 20 leg)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { engines?: { node?: string } };
    const api = JSON.parse(readFileSync(join(root, "apps", "api", "package.json"), "utf8")) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe(">=22.22");
    expect(api.engines?.node).toBe(">=22.22");
    expect(readFileSync(join(root, ".nvmrc"), "utf8").trim()).toBe("22");
    expect(readFileSync(join(root, ".node-version"), "utf8").trim()).toBe("22");
    expect(readFileSync(join(root, ".npmrc"), "utf8")).toMatch(/^engine-strict=true$/m);
    const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toMatch(/node:\s*\[22,\s*24\]/);
    expect(ci).not.toMatch(/node:\s*\[[^\]]*\b20\b/);
  });
});

describe("N7-02 StoredTrade.etag is the strong ETag of the header", () => {
  it('the schema documents a strong `"version-hash"` ETag with a pattern the emitted value matches; no response schema claims a weak ETag', async () => {
    expect(storedTradeSchema.properties.etag.pattern).toBe(TRADE_ETAG_PATTERN);
    expect(storedTradeSchema.description).not.toMatch(/weak/i);
    const r = await app.inject({ method: "GET", url: "/api/trades/IRS-0001" });
    expect(r.statusCode).toBe(200);
    const etag = r.json().etag as string;
    expect(etag).toBe(r.headers.etag);
    expect(etag).toMatch(new RegExp(TRADE_ETAG_PATTERN));
    expect(etag.startsWith("W/")).toBe(false);
    // A client following the schema (sending the body's etag unchanged) passes the strong If-Match comparison.
    const put = await app.inject({ method: "PUT", url: "/api/trades/IRS-0001", headers: { "if-match": etag }, payload: r.json().trade });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().etag).toMatch(new RegExp(TRADE_ETAG_PATTERN));
    const doc = app.swagger() as unknown as Doc;
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(JSON.stringify(op.responses), `${method.toUpperCase()} ${path}`).not.toMatch(/[Ww]eak ETag/);
      }
    }
  });
});

describe("Markt R7-3 discount-curve mapping without a snapshot round trip", () => {
  it("POST /api/market/curves: the first curve of a currency becomes its discount curve; a DKK swap then prices without NO_DISCOUNT_CURVE", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const before = (await app2.inject({ method: "GET", url: "/api/market" })).json() as { discountCurveId: Record<string, string> };
    expect(before.discountCurveId.DKK).toBeUndefined();
    // Without the mapping the swap cannot be priced.
    const rejected = await csv("/api/trades/import?type=InterestRateSwap&reportingCurrency=DKK", swapCsv("DKK", "DESTR", "IRS-DKK-0"), app2);
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().results[0]).toMatchObject({ status: "rejected", code: expect.stringMatching(/NO_DISCOUNT_CURVE|CURVE_NOT_FOUND/) });
    const curve = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("DKK", "DESTR", 0.025) } });
    expect(curve.statusCode, curve.body).toBe(200);
    expect(curve.json()).toMatchObject({ id: "DKK-DESTR", currency: "DKK", discountCurveSet: true, discountCurveId: "DKK-DESTR" });
    const market = (await app2.inject({ method: "GET", url: "/api/market" })).json() as { discountCurveId: Record<string, string> };
    expect(market.discountCurveId.DKK).toBe("DKK-DESTR");
    const swap = await csv("/api/trades/import?type=InterestRateSwap&reportingCurrency=DKK", swapCsv("DKK", "DESTR", "IRS-DKK-1"), app2);
    expect(swap.statusCode, swap.body).toBe(200);
    expect(swap.json()).toMatchObject({ imported: 1, rejected: 0 });
    expect(typeof swap.json().results[0].pv).toBe("number");
    const posted = await app2.inject({
      method: "POST",
      url: "/api/trades/from-template",
      payload: {
        template: "FRA",
        params: { currency: "DKK", notional: 1e7, payReceive: "Pay", start: "3x9", rate: 0.025, index: "DESTR" },
        price: true,
        reportingCurrency: "DKK",
      },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    // A second curve of the currency does not steal the mapping …
    const second = await app2.inject({
      method: "POST",
      url: "/api/market/curves",
      payload: { spec: { ...oisSpec("DKK", "DESTR", 0.026), id: "DKK-DESTR-ALT" } },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ discountCurveSet: false, discountCurveId: "DKK-DESTR" });
    // … unless asked to (`isDiscountCurve: true`); `false` never sets it, even for a new currency.
    const forced = await app2.inject({
      method: "POST",
      url: "/api/market/curves",
      payload: { isDiscountCurve: true, spec: { ...oisSpec("DKK", "DESTR", 0.026), id: "DKK-DESTR-ALT" } },
    });
    expect(forced.json()).toMatchObject({ discountCurveSet: true, discountCurveId: "DKK-DESTR-ALT" });
    const suppressed = await app2.inject({
      method: "POST",
      url: "/api/market/curves",
      payload: { isDiscountCurve: false, spec: oisSpec("SEK", "SWESTR", 0.02) },
    });
    expect(suppressed.statusCode, suppressed.body).toBe(200);
    expect(suppressed.json()).toMatchObject({ discountCurveSet: false });
    expect(suppressed.json().discountCurveId).toBeUndefined();
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json() as
      { entries?: { action: string; details?: Json }[] } | { action: string; details?: Json }[];
    const entries = Array.isArray(audit) ? audit : (audit.entries ?? []);
    expect(entries.filter((e) => e.action === "curve.replace").map((e) => e.details?.discountCurveSet)).toEqual([true, false, true, false]);
    await app2.close();
  });

  it("PUT /api/market { discountCurveId, collateralDiscountCurveId } maps existing curves; unknown curve → 422 CURVE_NOT_FOUND, wrong currency → 400 INVALID_REQUEST, market unchanged", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    await app2.inject({ method: "POST", url: "/api/market/curves", payload: { isDiscountCurve: false, spec: oisSpec("SEK", "SWESTR", 0.02) } });
    const idBefore = (await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId as string;
    const missing = await app2.inject({ method: "PUT", url: "/api/market", payload: { discountCurveId: { SEK: "SEK-NOPE" } } });
    expect(missing.statusCode, missing.body).toBe(422);
    expect(missing.json()).toMatchObject({ code: "CURVE_NOT_FOUND", details: { currency: "SEK", curveId: "SEK-NOPE" } });
    const wrongCcy = await app2.inject({ method: "PUT", url: "/api/market", payload: { discountCurveId: { SEK: "EUR-ESTR" } } });
    expect(wrongCcy.statusCode, wrongCcy.body).toBe(400);
    expect(wrongCcy.json()).toMatchObject({ code: "INVALID_REQUEST", details: { curveCurrency: "EUR" } });
    const badKey = await app2.inject({ method: "PUT", url: "/api/market", payload: { discountCurveId: { sek: "SEK-SWESTR" } } });
    expect(badKey.statusCode).toBe(400);
    expect(badKey.json().code).toBe("VALIDATION_ERROR");
    const missingCsa = await app2.inject({ method: "PUT", url: "/api/market", payload: { collateralDiscountCurveId: { "EUR|SEK": "SEK-NOPE" } } });
    expect(missingCsa.statusCode).toBe(422);
    expect(missingCsa.json().code).toBe("CURVE_NOT_FOUND");
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId).toBe(idBefore);
    const ok = await app2.inject({
      method: "PUT",
      url: "/api/market",
      payload: { discountCurveId: { SEK: "SEK-SWESTR" }, collateralDiscountCurveId: { "SEK|EUR": "SEK-SWESTR" } },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().discountCurveId).toMatchObject({ SEK: "SEK-SWESTR", EUR: "EUR-ESTR" });
    expect(ok.json().collateralDiscountCurveId).toMatchObject({ "SEK|EUR": "SEK-SWESTR" });
    expect(ok.json().snapshotId).not.toBe(idBefore);
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    expect(snap.discountCurveId.SEK).toBe("SEK-SWESTR");
    expect(snap.collateralDiscountCurveId["SEK|EUR"]).toBe("SEK-SWESTR");
    const swap = await csv("/api/trades/import?type=InterestRateSwap&reportingCurrency=SEK", swapCsv("SEK", "SWESTR", "IRS-SEK-1"), app2);
    expect(swap.json(), swap.body).toMatchObject({ imported: 1 });
    await app2.close();
  });
});

describe("Markt R7-4 sample fixings follow the valuation date; user fixings survive", () => {
  it("PUT /api/market { valuationDate } regenerates sampleFixings(newDate), keeps loaded fixings (they win per index/date) and removes MISSING_FIXING for periods the UI values cleanly", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const initial = (await app2.inject({ method: "GET", url: "/api/market" })).json() as { fixings: number };
    expect(initial.fixings).toBe(sampleFixings(parseISO("2026-09-03")).length);
    // A user fixing of an index without sample history and an override of a sample fixing.
    const user = await app2.inject({
      method: "PUT",
      url: "/api/market",
      payload: {
        fixings: [
          { index: "SOFR", date: "2026-09-01", value: 0.0431 },
          { index: "EURIBOR-6M", date: "2026-09-01", value: 0.05 },
        ],
      },
    });
    expect(user.statusCode, user.body).toBe(200);
    // Before the rebuild a swap fixing on 2026-09-11 (after the last sample fixing) needs an estimate.
    const swap = {
      trades: [
        {
          type: "InterestRateSwap",
          id: "IRS-3M-SEP",
          legs: [
            {
              type: "Fixed",
              payReceive: "Pay",
              notional: 1e7,
              currency: "EUR",
              effectiveDate: "2026-09-15",
              terminationDate: "2028-09-15",
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
              effectiveDate: "2026-09-15",
              terminationDate: "2028-09-15",
              frequency: "3M",
              dayCount: "ACT/360",
              calendar: "TARGET",
              index: "EURIBOR-3M",
            },
          ],
        },
      ],
    };
    const moved = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-11-03" } });
    expect(moved.statusCode, moved.body).toBe(200);
    const expected = sampleFixings(parseISO("2026-11-03"));
    const fixings = moved.json().fixings as { index: string; date: string; value: number }[];
    expect(fixings.length).toBe(expected.length + 1); // + SOFR; the EURIBOR-6M override replaces the regenerated sample fixing
    expect(fixings.find((f) => f.index === "SOFR")).toMatchObject({ date: "2026-09-01", value: 0.0431 });
    const sixM = fixings.filter((f) => f.index === "EURIBOR-6M" && f.date === "2026-09-01");
    expect(sixM).toEqual([{ index: "EURIBOR-6M", date: "2026-09-01", value: 0.05 }]);
    expect(
      fixings
        .filter((f) => f.index === "EURIBOR-3M")
        .map((f) => f.date)
        .sort()
        .at(-1),
    ).toBe("2026-11-02");
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().fixings).toBe(expected.length + 1);
    const priced = await app2.inject({ method: "POST", url: "/api/trades/import?dryRun=1", payload: swap });
    expect(priced.statusCode, priced.body).toBe(200);
    expect(priced.json().results[0]).toMatchObject({ status: "imported" });
    expect((priced.json().results[0].warnings as string[]).filter((w) => w.startsWith("MISSING_FIXING"))).toEqual([]);
    // Moving back drops the now-future sample fixings but keeps the user ones.
    const back = await app2.inject({ method: "PUT", url: "/api/market", payload: { valuationDate: "2026-09-03" } });
    expect((back.json().fixings as unknown[]).length).toBe(sampleFixings(parseISO("2026-09-03")).length + 1);
    await app2.close();
  });
});

describe("Markt R7-5 CCS CSV: the workstation's older column names are aliases", () => {
  it("`notional`, `start`, `maturity`, `rate`/`fixed rate`, `direction`/`payReceive`, `collateral` map onto the API template; the web template carries the API names", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const webStyle =
      "type;id;pair;notional;fxSpot;start;maturity;spread;collateral;direction;rate\n" +
      "CCS;CCS-WEB-1;EURUSD;10.000.000;1,17;2026-09-07;5Y;-20 bp;none;Receive;\n" +
      "CCS;CCS-WEB-2;EURUSD;10.000.000;1,17;2026-09-07;5Y;;USD;Pay;3,10 %\n";
    const built = csvToTrades(webStyle, "CrossCurrencySwap", VALUATION_DATE);
    expect(built.rejected).toEqual([]);
    expect(built.trades).toHaveLength(2);
    const r = await csv("/api/trades/import?type=CrossCurrencySwap", webStyle, app2);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ total: 2, imported: 2, rejected: 0 });
    type CcsTrade = Json & { legs: (Json & { currency: string; rate?: number })[] };
    const eurLeg = (t: CcsTrade) => t.legs.find((l) => l.currency === "EUR")!;
    const t1 = (await app2.inject({ method: "GET", url: "/api/trades/CCS-WEB-1" })).json().trade as CcsTrade;
    expect(t1.type).toBe("CrossCurrencySwap");
    expect(t1.collateralCurrency).toBeUndefined();
    expect(eurLeg(t1)).toMatchObject({ type: "Float", notional: 10_000_000, payReceive: "Receive", spread: -0.002 });
    const t2 = (await app2.inject({ method: "GET", url: "/api/trades/CCS-WEB-2" })).json().trade as CcsTrade;
    expect(t2.collateralCurrency).toBe("USD");
    expect(eurLeg(t2)).toMatchObject({ type: "Fixed", payReceive: "Pay" });
    expect(eurLeg(t2).rate).toBeCloseTo(0.031, 12);
    // "fixed rate" (with a space) and the API names keep working.
    const mixed =
      "pair;domesticNotional;effectiveDate;tenor;fixed rate;domesticPayReceive;fxSpot;id\nEURUSD;5.000.000;2026-09-07;3Y;2,5 %;Pay;1,17;CCS-MIX-1\n";
    expect(csvToTrades(mixed, "CrossCurrencySwap", VALUATION_DATE).rejected).toEqual([]);
    // The documentation names the aliases.
    const doc = JSON.stringify((app.swagger() as unknown as Doc).paths["/api/trades/import"]!.post);
    expect(doc).toContain("`notional` → `domesticNotional`");
    // The workstation's CCS template writes the API column names (web owner, R7-5) – checked when the web sources are present.
    const web = join(root, "apps", "web", "src", "lib", "portfolio-io.ts");
    if (existsSync(web)) {
      const src = readFileSync(web, "utf8");
      for (const col of ["domesticNotional", "effectiveDate", "collateralCurrency", "domesticPayReceive", "fixedRate"]) expect(src, col).toContain(`"${col}"`);
    }
    await app2.close();
  });
});

describe("R6-5 rest: index / convention register via the API and the snapshot envelope (ADR-027)", () => {
  const czeonia = {
    name: "CZEONIA-R7",
    currency: "CZK",
    type: "OIS",
    tenor: "1D",
    dayCount: "ACT/360",
    fixingCalendar: "TARGET",
    fixingLag: 0,
    businessDayConvention: "ModifiedFollowing",
    endOfMonth: false,
    curveId: "CZK-CZEONIA-R7",
  };
  const pribor = { ...czeonia, name: "PRIBOR-6M-R7", type: "IBOR", tenor: "6M", fixingLag: 2, curveId: "CZK-PRIBOR-6M-R7" };
  const czk = {
    currency: "CZK",
    fixedFrequency: "1Y",
    fixedDayCount: "ACT/360",
    floatIndex: "PRIBOR-6M-R7",
    floatFrequency: "6M",
    calendar: "TARGET",
    spotLag: 2,
    oisIndex: "CZEONIA-R7",
    oisFixedFrequency: "1Y",
    oisFixedDayCount: "ACT/360",
    oisPaymentLag: 2,
  };

  it("POST /api/market/indices|conventions register CZK; GET /api/market lists them; a CZK curve becomes the discount curve and a CZK swap prices", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    // Conventions before their indices exist → 400 INVALID_CURVE_SPEC, nothing registered.
    const early = await app2.inject({ method: "POST", url: "/api/market/conventions", payload: czk });
    expect(early.statusCode, early.body).toBe(400);
    expect(early.json().code).toBe("INVALID_CURVE_SPEC");
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().currencies).not.toContain("CZK");
    const ix1 = await app2.inject({ method: "POST", url: "/api/market/indices", payload: czeonia });
    expect(ix1.statusCode, ix1.body).toBe(201);
    expect(ix1.json()).toMatchObject({ registered: true, replaced: false, index: { name: "CZEONIA-R7", currency: "CZK", type: "OIS" } });
    const ix2 = await app2.inject({ method: "POST", url: "/api/market/indices", payload: pribor });
    expect(ix2.statusCode, ix2.body).toBe(201);
    // Re-registering a runtime index replaces it (200); a built-in one never (400 INVALID_CURVE_SPEC, details.builtIn).
    const again = await app2.inject({ method: "POST", url: "/api/market/indices", payload: { ...pribor, dayCount: "ACT/365F" } });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ replaced: true, index: { dayCount: "ACT/365F" } });
    const builtIn = await app2.inject({
      method: "POST",
      url: "/api/market/indices",
      payload: { ...pribor, name: "NIBOR-3M", currency: "NOK", curveId: "NOK-NIBOR-3M" },
    });
    expect(builtIn.statusCode, builtIn.body).toBe(400);
    expect(builtIn.json()).toMatchObject({ code: "INVALID_CURVE_SPEC", details: { index: "NIBOR-3M", builtIn: true } });
    const lower = await app2.inject({ method: "POST", url: "/api/market/indices", payload: { ...pribor, name: "euribor-6m", currency: "EUR" } });
    expect(lower.statusCode).toBe(400);
    // Core validation: an OIS index with a term tenor, an unknown calendar, a schema violation.
    const badTenor = await app2.inject({ method: "POST", url: "/api/market/indices", payload: { ...czeonia, name: "BAD-OIS-R7", tenor: "6M" } });
    expect(badTenor.statusCode, badTenor.body).toBe(400);
    expect(badTenor.json().code).toBe("INVALID_CURVE_SPEC");
    const badCal = await app2.inject({ method: "POST", url: "/api/market/indices", payload: { ...czeonia, name: "BAD-CAL-R7", fixingCalendar: "MARS" } });
    expect(badCal.statusCode, badCal.body).toBe(400);
    expect(badCal.json().code).toBe("INVALID_CURVE_SPEC");
    const schema = await app2.inject({ method: "POST", url: "/api/market/indices", payload: { ...czeonia, name: "BAD SPACE", type: "TERM" } });
    expect(schema.statusCode).toBe(400);
    expect(schema.json().code).toBe("VALIDATION_ERROR");
    const conv = await app2.inject({ method: "POST", url: "/api/market/conventions", payload: czk });
    expect(conv.statusCode, conv.body).toBe(201);
    expect(conv.json()).toMatchObject({ registered: true, replaced: false, conventions: { currency: "CZK", floatIndex: "PRIBOR-6M-R7" } });
    expect(conv.json().currencies).toContain("CZK");
    const convAgain = await app2.inject({ method: "POST", url: "/api/market/conventions", payload: { ...czk, spotLag: 1 } });
    expect(convAgain.statusCode).toBe(200);
    expect(convAgain.json()).toMatchObject({ replaced: true, conventions: { spotLag: 1 } });
    const market = (await app2.inject({ method: "GET", url: "/api/market" })).json() as {
      currencies: string[];
      indices: { name: string; currency: string }[];
      conventions: Record<string, { floatIndex: string; oisIndex: string }>;
    };
    expect(market.currencies).toContain("CZK");
    expect(
      market.indices
        .filter((i) => i.currency === "CZK")
        .map((i) => i.name)
        .sort(),
    ).toEqual(["CZEONIA-R7", "PRIBOR-6M-R7"]);
    expect(market.conventions.CZK).toMatchObject({ floatIndex: "PRIBOR-6M-R7", oisIndex: "CZEONIA-R7" });
    expect(market.conventions.EUR).toMatchObject({ floatIndex: "EURIBOR-6M", oisIndex: "ESTR" });
    // Bootstrap in the new currency: discount mapping set, swap prices.
    const curve = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("CZK", "CZEONIA-R7", 0.04) } });
    expect(curve.statusCode, curve.body).toBe(200);
    expect(curve.json()).toMatchObject({ id: "CZK-CZEONIA-R7", discountCurveSet: true });
    const swap = await csv("/api/trades/import?type=InterestRateSwap&reportingCurrency=CZK", swapCsv("CZK", "CZEONIA-R7", "IRS-CZK-1"), app2);
    expect(swap.statusCode, swap.body).toBe(200);
    expect(swap.json(), swap.body).toMatchObject({ imported: 1 });
    // Audit trail carries the registrations.
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json() as { entries?: { action: string }[] } | { action: string }[];
    const actions = (Array.isArray(audit) ? audit : (audit.entries ?? [])).map((e) => e.action);
    expect(actions.filter((a) => a === "register.index")).toHaveLength(3);
    expect(actions.filter((a) => a === "register.conventions")).toHaveLength(2);
    await app2.close();
  });

  it("the snapshot envelope exports `indices`/`conventions` only when registered and re-registers them on import; the snapshot id ignores the register", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const plain = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json;
    expect(plain.indices).toBeUndefined();
    expect(plain.conventions).toBeUndefined();
    const idBefore = plain.schema && ((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId as string);
    const huf = { ...czeonia, name: "HUFONIA-R7", currency: "HUF", curveId: "HUF-HUFONIA-R7" };
    const bubor = { ...czeonia, name: "BUBOR-6M-R7", currency: "HUF", type: "IBOR", tenor: "6M", fixingLag: 2, curveId: "HUF-BUBOR-6M-R7" };
    for (const ix of [huf, bubor]) expect((await app2.inject({ method: "POST", url: "/api/market/indices", payload: ix })).statusCode).toBe(201);
    const conv = { ...czk, currency: "HUF", floatIndex: "BUBOR-6M-R7", oisIndex: "HUFONIA-R7" };
    expect((await app2.inject({ method: "POST", url: "/api/market/conventions", payload: conv })).statusCode).toBe(201);
    expect((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId).toBe(idBefore);
    const curve = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec: oisSpec("HUF", "HUFONIA-R7", 0.065) } });
    expect(curve.statusCode, curve.body).toBe(200);
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json & {
      indices: { name: string }[];
      conventions: { currency: string }[];
      discountCurveId: Record<string, string>;
    };
    expect(snap.indices.map((i) => i.name)).toEqual(["BUBOR-6M-R7", "HUFONIA-R7"]);
    expect(snap.conventions.map((c) => c.currency)).toEqual(["HUF"]);
    expect(snap.discountCurveId.HUF).toBe("HUF-HUFONIA-R7");
    // Import into a fresh instance: the envelope arrays are registered (reported by name), the market replaced.
    const app3 = await buildApp({ logger: false, seedPortfolio: false });
    const imported = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({ imported: true, indices: ["BUBOR-6M-R7", "HUFONIA-R7"], conventions: ["HUF"] });
    expect(imported.json().snapshotId).toBe((await app2.inject({ method: "GET", url: "/api/market" })).json().snapshotId);
    const reexport = (await app3.inject({ method: "GET", url: "/api/market/snapshot" })).json() as typeof snap;
    expect(reexport.indices.map((i) => i.name)).toEqual(snap.indices.map((i) => i.name));
    expect(reexport.conventions).toEqual(snap.conventions);
    const swap = await csv("/api/trades/import?type=InterestRateSwap&reportingCurrency=HUF", swapCsv("HUF", "HUFONIA-R7", "IRS-HUF-1"), app3);
    expect(swap.json(), swap.body).toMatchObject({ imported: 1 });
    // A built-in name in the envelope → 400 INVALID_CURVE_SPEC, market unchanged; the schema rejects malformed entries.
    const idBeforeBad = (await app3.inject({ method: "GET", url: "/api/market" })).json().snapshotId as string;
    const bad = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, indices: [{ ...huf, name: "SOFR", currency: "USD" }] } });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(bad.json()).toMatchObject({ code: "INVALID_CURVE_SPEC", details: { entry: "SOFR", builtIn: true } });
    const invalid = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, conventions: [{ ...conv, floatIndex: "NOPE-R7" }] } });
    expect(invalid.statusCode, invalid.body).toBe(400);
    expect(invalid.json().code).toBe("INVALID_CURVE_SPEC");
    const malformed = await app3.inject({ method: "PUT", url: "/api/market/snapshot", payload: { ...snap, indices: [{ name: "X" }] } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe("VALIDATION_ERROR");
    expect((await app3.inject({ method: "GET", url: "/api/market" })).json().snapshotId).toBe(idBeforeBad);
    // Contract: components and the snapshot schema know the envelope.
    const doc = app2.swagger() as unknown as Doc;
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(["RateIndex", "SwapConventions", "MarketSnapshot"]));
    const snapshotSchema = doc.components.schemas.MarketSnapshot as { properties: Record<string, { items?: { $ref?: string } }> };
    expect(snapshotSchema.properties.indices?.items?.$ref).toContain("RateIndex");
    expect(snapshotSchema.properties.conventions?.items?.$ref).toContain("SwapConventions");
    await app2.close();
    await app3.close();
  });
});

describe("UNKNOWN_INDEX and the register in the contract", () => {
  it("bootstrapping an unregistered index answers 422 UNKNOWN_INDEX; the code description points to GET /api/market and POST /api/market/indices", async () => {
    const r = await app.inject({ method: "POST", url: "/api/market/bootstrap", payload: { spec: oisSpec("HUF", "BUBOR-3M-NOPE", 0.06) } });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json().code).toBe("UNKNOWN_INDEX");
    const doc = app.swagger() as unknown as Doc;
    const description = (doc.components.schemas.ErrorResponse as { properties: { code: { description: string } } }).properties.code.description;
    expect(description).toMatch(/UNKNOWN_INDEX \([^)]*`GET \/api\/market`[^)]*`POST \/api\/market\/indices`/);
    const specIndex = JSON.stringify(doc.paths["/api/market/bootstrap"]!.post);
    expect(specIndex).toContain("POST /api/market/indices");
    expect(specIndex).toContain("UNKNOWN_INDEX");
  });
});

describe("dryRun on POST /api/trades/import", () => {
  const trade = (id: string) => ({
    type: "FxForward",
    id,
    buyCurrency: "EUR",
    buyAmount: 1_000_000,
    sellCurrency: "USD",
    sellAmount: 1_170_000,
    deliveryDate: "2027-03-15",
  });

  it("?dryRun=1 validates and prices (JSON and CSV) but stores nothing; ?dryRun=0 and the default store; unknown query parameters → 400 VALIDATION_ERROR", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const dry = await app2.inject({
      method: "POST",
      url: "/api/trades/import?dryRun=1",
      payload: { trades: [trade("FXF-DRY-1"), { ...trade("FXF-DRY-BAD"), sellAmount: -1 }] },
    });
    expect(dry.statusCode, dry.body).toBe(400); // the schema violation fails the JSON batch as before
    const dryOk = await app2.inject({ method: "POST", url: "/api/trades/import?dryRun=true", payload: { trades: [trade("FXF-DRY-1")] } });
    expect(dryOk.statusCode, dryOk.body).toBe(200);
    expect(dryOk.json()).toMatchObject({ total: 1, imported: 1, dryRun: true });
    expect(dryOk.json().results[0]).toMatchObject({ id: "FXF-DRY-1", status: "imported" });
    expect(dryOk.json().results[0].version).toBeUndefined();
    expect(typeof dryOk.json().results[0].pv).toBe("number");
    expect((await app2.inject({ method: "GET", url: "/api/trades/FXF-DRY-1" })).statusCode).toBe(404);
    // Repeating the dry run does not report "exists"; the real import afterwards stores it.
    expect(
      (await app2.inject({ method: "POST", url: "/api/trades/import?dryRun=1", payload: { trades: [trade("FXF-DRY-1")] } })).json().results[0].status,
    ).toBe("imported");
    const real = await app2.inject({ method: "POST", url: "/api/trades/import?dryRun=0", payload: { trades: [trade("FXF-DRY-1")] } });
    expect(real.json()).toMatchObject({ imported: 1, dryRun: false });
    expect(real.json().results[0].version).toBe(1);
    expect((await app2.inject({ method: "GET", url: "/api/trades/FXF-DRY-1" })).statusCode).toBe(200);
    // A dry run in create mode reports what would happen: the id now exists → skipped.
    const dryAgain = await app2.inject({ method: "POST", url: "/api/trades/import?dryRun=1", payload: { trades: [trade("FXF-DRY-1")] } });
    expect(dryAgain.json().results[0]).toMatchObject({ status: "skipped", reason: "exists" });
    // CSV dry run: rows validated, priced, rejected rows reported, nothing stored.
    const rows =
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;id\nEUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS-DRY-1\nEUR;abc;Pay;3,10 %;2026-09-07;10Y;IRS-DRY-2\n";
    const csvDry = await csv("/api/trades/import?type=InterestRateSwap&dryRun=1", rows, app2);
    expect(csvDry.statusCode, csvDry.body).toBe(200);
    expect(csvDry.json()).toMatchObject({ total: 2, imported: 1, rejected: 1, dryRun: true });
    expect((await app2.inject({ method: "GET", url: "/api/trades/IRS-DRY-1" })).statusCode).toBe(404);
    const allBad = await csv(
      "/api/trades/import?type=InterestRateSwap&dryRun=1",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity\nEUR;abc;Pay;3 %;2026-09-07;10Y\n",
      app2,
    );
    expect(allBad.json()).toMatchObject({ imported: 0, rejected: 1, dryRun: true });
    // Unknown / mistyped query parameters are rejected instead of silently running a real import.
    for (const url of ["/api/trades/import?dryrun=1", "/api/trades/import?dryRun=yes", "/api/trades/import?validate=1"]) {
      const r = await app2.inject({ method: "POST", url, payload: { trades: [trade("FXF-DRY-9")] } });
      expect(r.statusCode, url).toBe(400);
      expect(r.json().code, url).toBe("VALIDATION_ERROR");
    }
    expect((await app2.inject({ method: "GET", url: "/api/trades/FXF-DRY-9" })).statusCode).toBe(404);
    const audit = (await app2.inject({ method: "GET", url: "/api/audit" })).json() as { entries?: { action: string }[] } | { action: string }[];
    const actions = (Array.isArray(audit) ? audit : (audit.entries ?? [])).map((e) => e.action);
    expect(actions).toContain("trade.import.dryRun");
    expect(actions).toContain("trade.import");
    await app2.close();
  });
});
