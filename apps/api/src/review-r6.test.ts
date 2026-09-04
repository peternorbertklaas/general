/**
 * Round-6 review findings (docs/quality/review-markt-r6.md, review-architektur-r6.md):
 * R6-2  CSV templates for every product the core builders support (FxSwap, BasisSwap, AmortisingSwap, ImmSwap;
 *       `stepUp` column on the fixed/float swap templates),
 * R6-3  `collateralCurrency` accepts `none` (uncollateralised); a schema-invalid row is rejected per row
 *       (`CSV_ROW_INVALID`) instead of failing the whole upload with 400,
 * N6-03 `text/plain` (and `text/csv` outside the import route) → 415; 415 documented only on operations with a
 *       request body; every inline error goes through `sendError`; `SYSTEM_CODE` no longer swallows `E…` domain codes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { CSV_TEMPLATES, CSV_TRADE_TYPES, csvTemplateText, csvToTrades, parseStepUp } from "./lib/csv-import.js";
import { apiErrorCode, classifyError, isApiErrorCode, isDomainError, isNodeSystemError } from "./lib/errors.js";
import { WARNING_PREFIXES } from "./schemas.js";

let app: FastifyInstance;
type Json = Record<string, unknown>;
type Leg = Json & { type: string; roll?: string; spread?: number; rateSchedule?: unknown[]; notionalSchedule?: { notional: number }[] };
type Doc = { paths: Record<string, Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>> };

const VALUATION_DATE = 20699; // 2026-09-03, the sample market's valuation date
const csv = (url: string, text: string, a: FastifyInstance = app) => a.inject({ method: "POST", url, headers: { "content-type": "text/csv" }, payload: text });
const stored = async (a: FastifyInstance, id: string) => (await a.inject({ method: "GET", url: `/api/trades/${id}` })).json().trade as Json & { legs?: Leg[] };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("R6-2 CSV templates for FxSwap, BasisSwap, AmortisingSwap and ImmSwap", () => {
  it("every template round-trips: template text → csvToTrades → import → priced; the built trade type follows `tradeType`", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    expect([...CSV_TRADE_TYPES]).toEqual(expect.arrayContaining(["FxSwap", "BasisSwap", "AmortisingSwap", "ImmSwap"]));
    for (const type of CSV_TRADE_TYPES) {
      const text = csvTemplateText(type);
      const built = csvToTrades(text, type, VALUATION_DATE);
      expect(built.rejected, type).toEqual([]);
      expect(built.trades[0]!.type, type).toBe(CSV_TEMPLATES[type].tradeType);
      const r = await csv(`/api/trades/import?type=${type}`, text, app2);
      expect(r.statusCode, `${type}: ${r.body}`).toBe(200);
      expect(r.json(), type).toMatchObject({ total: 1, imported: 1, rejected: 0 });
      expect(typeof r.json().results[0].pv, type).toBe("number");
    }
    // FX swap: two FX legs, far after near.
    const fxs = (await stored(app2, "FXS-CSV-1")) as Json & { nearLeg: Json; farLeg: Json };
    expect(fxs.type).toBe("FxSwap");
    expect(fxs.nearLeg).toMatchObject({ deliveryDate: "2026-09-07", buyCurrency: "EUR", buyAmount: 5_000_000, sellCurrency: "USD" });
    expect(fxs.nearLeg.sellAmount as number).toBeCloseTo(5_000_000 * 1.1625, 6);
    expect(fxs.farLeg).toMatchObject({ deliveryDate: "2027-03-08", buyCurrency: "USD", sellCurrency: "EUR", sellAmount: 5_000_000 });
    expect(fxs.farLeg.buyAmount as number).toBeCloseTo(5_000_000 * 1.169, 6);
    // Tenor basis swap: two float legs, the spread on leg 0.
    const basis = await stored(app2, "BASIS-CSV-1");
    expect(basis.type).toBe("InterestRateSwap");
    expect(basis.legs!.map((l) => l.type)).toEqual(["Float", "Float"]);
    expect(basis.legs![0]!.spread).toBeCloseTo(0.0012, 12);
    expect(basis.legs!.map((l) => l.index)).toEqual(["EURIBOR-6M", "EURIBOR-3M"]);
    // Amortising swap: linear schedule on both legs from 10 m down towards the final notional 2 m.
    const amort = await stored(app2, "AMORT-CSV-1");
    for (const leg of amort.legs!) {
      const schedule = leg.notionalSchedule!;
      expect(schedule.length).toBeGreaterThan(5);
      expect(schedule[0]!.notional).toBe(10_000_000);
      expect(schedule.at(-1)!.notional).toBeGreaterThanOrEqual(2_000_000);
      expect(schedule.at(-1)!.notional).toBeLessThan(10_000_000);
    }
    // IMM swap: effective on the next IMM date after the valuation date (third Wednesday of Mar/Jun/Sep/Dec), IMM roll.
    const imm = await stored(app2, "IMM-CSV-1");
    const eff = new Date(`${String(imm.legs![0]!.effectiveDate)}T00:00:00Z`);
    expect(eff.getUTCDay()).toBe(3);
    expect(eff.getUTCDate()).toBeGreaterThanOrEqual(15);
    expect(eff.getUTCDate()).toBeLessThanOrEqual(21);
    expect([2, 5, 8, 11]).toContain(eff.getUTCMonth());
    expect(imm.legs!.every((l) => l.roll === "IMM")).toBe(true);
    await app2.close();
  });

  it("explicit IMM `from`, `stepUp` coupon steps and the `none` collateral shortcut on the swap templates", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const imm = await csv(
      "/api/trades/import?type=ImmSwap",
      "currency;notional;payReceive;fixedRate;tenor;from;id\nEUR;10.000.000;Pay;3,00 %;2Y;2026-09-03;IMM-2\n",
      app2,
    );
    expect(imm.json()).toMatchObject({ imported: 1 });
    const t = await stored(app2, "IMM-2");
    // 2026-09-03 → next IMM date 2026-09-16; two years later the IMM date of September 2028 is the 20th.
    expect(t.legs![0]!.effectiveDate).toBe("2026-09-16");
    expect(t.legs![0]!.terminationDate).toBe("2028-09-20");
    expect(parseStepUp("2027-09-07:3,50 %|08.09.2028:4 %")).toEqual([
      { date: 21068, rate: 0.035 },
      { date: 21435, rate: 0.04 },
    ]);
    expect(() => parseStepUp("2027-09-07 3,5 %")).toThrow(/<date>:<rate>/);
    const step = await csv(
      "/api/trades/import?type=InterestRateSwap",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;stepUp;collateralCurrency;id\n" +
        "EUR;10.000.000;Pay;3,00 %;2026-09-07;5Y;2027-09-07:3,50 %|2028-09-07:4,00 %;none;STEP-1\n" +
        "EUR;10.000.000;Pay;3,00 %;2026-09-07;5Y;2027-09-07 3,50 %;;STEP-2\n",
      app2,
    );
    expect(step.json()).toMatchObject({ total: 2, imported: 1, rejected: 1 });
    expect(step.json().results[1]).toMatchObject({ row: 2, status: "rejected", code: "CSV_ROW_INVALID" });
    expect(step.json().results[1].reason).toMatch(/stepUp/);
    const s = await stored(app2, "STEP-1");
    expect(s.collateralCurrency).toBeUndefined();
    // The builder stores the initial coupon plus the two steps.
    expect(s.legs![0]!.rateSchedule).toHaveLength(3);
    await app2.close();
  });

  it("OpenAPI: `?type=` enum lists all templates, the description documents each (with the built trade type) and the `none` semantics", () => {
    const doc = app.swagger() as unknown as Doc & {
      paths: Record<string, { post?: { parameters?: { name: string; schema: { enum?: string[] } }[]; description?: string } }>;
    };
    const op = doc.paths["/api/trades/import"]!.post!;
    const typeParam = op.parameters!.find((p) => p.name === "type")!;
    expect(typeParam.schema.enum).toEqual([...CSV_TRADE_TYPES]);
    for (const type of CSV_TRADE_TYPES) expect(op.description, type).toContain(`**${type}**`);
    expect(op.description).toContain("**BasisSwap** (builds `InterestRateSwap`)");
    expect(op.description).toContain("**AmortisingSwap** (builds `InterestRateSwap`)");
    expect(op.description).toContain("**ImmSwap** (builds `InterestRateSwap`)");
    expect(op.description).toContain("`none`");
    expect(op.description).toContain("CSV_ROW_INVALID");
    expect(op.description).toMatch(/nearRate.*farRate/);
    expect(op.description).toMatch(/receiveIndex.*payIndex/);
    expect(op.description).toContain("`finalNotional`");
    expect(op.description).toContain("`stepUp`");
  });
});

describe("R6-3 `collateralCurrency: none` and per-row schema validation of CSV rows", () => {
  const ccsHeader = "pair;domesticNotional;effectiveDate;tenor;fxSpot;spread;collateralCurrency;id\n";

  it("CCS rows: `USD` → USD-CSA, empty → market default, `none`/`unbesichert`/`ohne` → uncollateralised; a mixed file imports every row", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const r = await csv(
      "/api/trades/import?type=CrossCurrencySwap",
      ccsHeader +
        "EURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;USD;CCS-USD\n" +
        "EURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;;CCS-DEFAULT\n" +
        "EURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;none;CCS-NONE\n" +
        "EURGBP;10.000.000;2026-09-07;5Y;0,86;-10 bp;unbesichert;CCS-UNBES\n" +
        "EURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;ohne;CCS-OHNE\n",
      app2,
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ total: 5, imported: 5, rejected: 0 });
    expect((await stored(app2, "CCS-USD")).collateralCurrency).toBe("USD");
    expect((await stored(app2, "CCS-DEFAULT")).collateralCurrency).toBe("USD");
    for (const id of ["CCS-NONE", "CCS-UNBES", "CCS-OHNE"]) expect((await stored(app2, id)).collateralCurrency, id).toBeUndefined();
    // The unsecured swap prices on the OIS curves (no cross-currency basis) – a different PV than the USD-CSA twin.
    const results = r.json().results as { id: string; pv: number }[];
    expect(results.find((x) => x.id === "CCS-NONE")!.pv).not.toBeCloseTo(results.find((x) => x.id === "CCS-USD")!.pv, 0);
    // Unit: the unit mapper yields `null` / `undefined` / code and rejects garbage per row.
    const built = csvToTrades(ccsHeader + "EURUSD;1.000.000;2026-09-07;2Y;1,17;0;US;BAD\n", "CrossCurrencySwap", VALUATION_DATE);
    expect(built.trades).toEqual([]);
    expect(built.rejected[0]!.reason).toMatch(/collateralCurrency: "US" is not an ISO-4217 code or "none"/);
    await app2.close();
  });

  it("a row whose built trade violates the Trade schema is rejected with CSV_ROW_INVALID; the valid rows import (no 400 for the upload)", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const r = await csv(
      "/api/trades/import?type=InterestRateSwap",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;id\n" +
        "EUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS-OK\n" +
        "EUR;10.000.000;Pay;3,10 %;2026-13-08;10Y;IRS-BADDATE\n" +
        "EUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS CSV SPACE\n" +
        "EUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;IRS-OK-2\n",
      app2,
    );
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ total: 4, imported: 2, skipped: 0, rejected: 2 });
    expect(body.results.map((x: { row: number }) => x.row)).toEqual([1, 2, 3, 4]);
    expect(body.results[1]).toMatchObject({ row: 2, status: "rejected", code: "CSV_ROW_INVALID" });
    expect(body.results[1].reason).toMatch(/2026-13-08/);
    expect(body.results[2]).toMatchObject({ row: 3, status: "rejected", code: "CSV_ROW_INVALID" });
    expect(body.results[2].reason).toMatch(/trade violates the schema: id must match pattern/);
    expect(body.results[3]).toMatchObject({ row: 4, id: "IRS-OK-2", status: "imported" });
    expect((await app2.inject({ method: "GET", url: "/api/trades" })).json()).toHaveLength(2);
    // Every row schema-invalid → 200 with all rows rejected (not a batch 400).
    const allBad = await csv(
      "/api/trades/import?type=InterestRateSwap",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;id\nEUR;10.000.000;Pay;3,10 %;2026-09-07;10Y;bad id\nEUR;1;Pay;1 %;2026-09-07;1Y;also bad\n",
      app2,
    );
    expect(allBad.statusCode).toBe(200);
    expect(allBad.json()).toMatchObject({ total: 2, imported: 0, rejected: 2 });
    expect(allBad.json().results.every((x: { code: string }) => x.code === "CSV_ROW_INVALID")).toBe(true);
    // A CCS row with `none` in a file that also has a USD row: both import (the R6 probe answered 400 for both).
    const mixed = await csv(
      "/api/trades/import?type=CrossCurrencySwap",
      ccsHeader + "EURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;USD;M-1\nEURUSD;10.000.000;2026-09-07;5Y;1,17;-20 bp;none;M-2\n",
      app2,
    );
    expect(mixed.json()).toMatchObject({ total: 2, imported: 2, rejected: 0 });
    // JSON bodies keep the batch semantics: a schema violation anywhere is a 400.
    const json = await app2.inject({ method: "POST", url: "/api/trades/import", payload: { trades: [{ id: "bad id", type: "FxForward" }] } });
    expect(json.statusCode).toBe(400);
    expect(json.json().code).toBe("VALIDATION_ERROR");
    await app2.close();
  });
});

describe("Core R6 surface: premium cashflows, barrier state, vol plausibility, new currencies, sample fixings", () => {
  it("an upfront premium is priced as its own leg (`Upfront premium`) with a `Premium` cashflow; the OpenAPI schema documents both", async () => {
    // Take a swaption from the sample book so the underlying is market-standard, then attach a premium.
    const list = (await app.inject({ method: "GET", url: "/api/trades" })).json() as { trade: Json & { type: string } }[];
    const base = list.find((s) => s.trade.type === "Swaption")!.trade;
    expect(base).toBeDefined();
    const withPremium = { ...base, id: "swpt-premium", upfront: { amount: 100_000, currency: "EUR", date: "2026-09-07" } };
    const r = await app.inject({ method: "POST", url: "/api/price", payload: { trade: withPremium } });
    expect(r.statusCode, r.body).toBe(200);
    const legs = r.json().legs as { legType: string; cashflows: { kind: string; amount: number; paymentDate: string; discountFactor?: number }[] }[];
    const premiumLeg = legs.at(-1)!;
    expect(premiumLeg.legType).toBe("Upfront premium");
    expect(premiumLeg.cashflows).toHaveLength(1);
    expect(premiumLeg.cashflows[0]).toMatchObject({ kind: "Premium", paymentDate: "2026-09-07" });
    expect(premiumLeg.cashflows[0]!.amount).toBeCloseTo(-100_000, 6);
    const plain = await app.inject({ method: "POST", url: "/api/price", payload: { trade: { ...base, id: "swpt-plain" } } });
    expect(r.json().pv).toBeLessThan(plain.json().pv);
    expect(r.json().pv).toBeCloseTo(plain.json().pv - 100_000 * Number(premiumLeg.cashflows[0]!.discountFactor ?? 1), -1);
    const doc = JSON.stringify(app.swagger());
    expect(doc).toContain("Upfront premium");
    expect(doc).toContain("Premium | OptionPayoff");
  });

  it("barrier.hit is part of the trade schema, reaches analytics.barrierState and the CSV template; BARRIER_STATE_UNKNOWN / VOL_IMPLAUSIBLE are catalogued prefixes", async () => {
    const barrierOption = (barrier: Record<string, unknown>) => ({
      id: "fxo-barrier",
      type: "FxOption",
      payReceive: "Receive",
      optionType: "Call",
      pair: "EURUSD",
      strike: 1.1,
      notional: 1e6,
      expiryDate: "2027-03-15",
      deliveryDate: "2027-03-17",
      barrier,
    });
    const hit = await app.inject({ method: "POST", url: "/api/price", payload: { trade: barrierOption({ type: "UpOut", level: 1.3, hit: true }) } });
    expect(hit.statusCode, hit.body).toBe(200);
    expect(hit.json().analytics.barrierState).toBe("knocked-out");
    expect(hit.json().pv).toBeCloseTo(0, 6);
    const alive = await app.inject({ method: "POST", url: "/api/price", payload: { trade: barrierOption({ type: "UpOut", level: 1.3, hit: false }) } });
    expect(alive.json().analytics.barrierState).toBe("alive");
    expect(alive.json().pv).toBeGreaterThan(0);
    // A live option already beyond its barrier without the flag: the state is derived and flagged.
    const derived = await app.inject({ method: "POST", url: "/api/price", payload: { trade: barrierOption({ type: "UpOut", level: 1.15 }) } });
    expect(derived.statusCode).toBe(200);
    expect(derived.json().analytics.barrierState).toBe("knocked-out");
    expect((derived.json().warnings as string[]).some((w) => w.startsWith("BARRIER_STATE_UNKNOWN:"))).toBe(true);
    expect(
      (await app.inject({ method: "POST", url: "/api/price", payload: { trade: barrierOption({ type: "UpOut", level: 1.3, hit: "yes" }) } })).statusCode,
    ).toBe(400);
    expect(WARNING_PREFIXES).toContain("BARRIER_STATE_UNKNOWN");
    expect(WARNING_PREFIXES).toContain("VOL_IMPLAUSIBLE");
    const code = (app.swagger() as unknown as { components: { schemas: Record<string, { properties: Record<string, { description: string }> }> } }).components
      .schemas.ErrorResponse!.properties.code!;
    for (const p of WARNING_PREFIXES) expect(code.description, p).toContain(`\`${p}:\``);
    // CSV: barrier columns on the FxOption template.
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const r = await csv(
      "/api/trades/import?type=FxOption",
      "pair;optionType;notional;strike;expiryDate;barrierType;barrierLevel;barrierHit;id\nEURUSD;Call;1.000.000;1,10;2027-03-15;UpOut;1,30;true;FXO-B1\nEURUSD;Call;1.000.000;1,10;2027-03-15;Sideways;1,30;;FXO-B2\n",
      app2,
    );
    expect(r.json()).toMatchObject({ total: 2, imported: 1, rejected: 1 });
    expect(r.json().results[1].reason).toMatch(/barrierType/);
    const t = (await stored(app2, "FXO-B1")) as Json & { barrier: Json };
    expect(t.barrier).toEqual({ type: "UpOut", level: 1.3, hit: true });
    await app2.close();
  });

  it("PUT /api/market stores an implausible surface with a VOL_IMPLAUSIBLE warning (200); the snapshot import reports it too; valuations repeat it", async () => {
    const app2 = await buildApp({ logger: false });
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json() as Json & {
      swaptionVols: Record<string, Json & { volType: string }>;
    };
    const usd = snap.swaptionVols.USD!;
    expect(usd.volType).toBe("Normal");
    // The reviewer's probe: a "Lognormal" cube carrying normal-sized numbers (≈ 0.0097).
    const put = await app2.inject({ method: "PUT", url: "/api/market", payload: { swaptionVols: { USD: { ...usd, volType: "Lognormal" } } } });
    expect(put.statusCode, put.body).toBe(200);
    const warnings = put.json().warnings as string[];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.startsWith("VOL_IMPLAUSIBLE:"))).toBe(true);
    expect(warnings.join(" ")).toMatch(/USD/);
    // Every valuation that reads the implausible cube repeats the warning.
    const usdSwaption = {
      id: "swpt-usd-r6",
      type: "Swaption",
      payReceive: "Receive",
      payerReceiver: "Payer",
      settlement: "Physical",
      expiryDate: "2027-09-07",
      underlying: {
        id: "swpt-usd-r6-underlying",
        type: "InterestRateSwap",
        legs: [
          {
            type: "Fixed",
            payReceive: "Pay",
            notional: 1e7,
            currency: "USD",
            effectiveDate: "2027-09-09",
            terminationDate: "2032-09-09",
            frequency: "1Y",
            dayCount: "ACT/360",
            calendar: "US",
            rate: 0.04,
          },
          {
            type: "Float",
            payReceive: "Receive",
            notional: 1e7,
            currency: "USD",
            effectiveDate: "2027-09-09",
            terminationDate: "2032-09-09",
            frequency: "1Y",
            dayCount: "ACT/360",
            calendar: "US",
            index: "SOFR",
          },
        ],
      },
    };
    const valued = await app2.inject({ method: "POST", url: "/api/price", payload: { trade: usdSwaption } });
    expect(valued.statusCode, valued.body).toBe(200);
    expect((valued.json().warnings as string[]).some((w) => w.startsWith("VOL_IMPLAUSIBLE:"))).toBe(true);
    // A plausible surface yields no warning; the snapshot import carries `warnings` as well.
    const ok = await app2.inject({ method: "PUT", url: "/api/market", payload: { swaptionVols: { USD: usd } } });
    expect(ok.json().warnings).toEqual([]);
    const imp = await app2.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: { ...snap, swaptionVols: { ...snap.swaptionVols, USD: { ...usd, volType: "Lognormal" } } },
    });
    expect(imp.statusCode, imp.body).toBe(200);
    expect((imp.json().warnings as string[]).some((w) => w.startsWith("VOL_IMPLAUSIBLE:"))).toBe(true);
    expect((await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap })).json().warnings).toEqual([]);
    await app2.close();
  });

  it("NOK/SEK/DKK/PLN are registered currencies: GET /api/market lists them, a NOK OIS curve bootstraps via the API and a NOK swap prices once the curve is in the market", async () => {
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const market = (await app2.inject({ method: "GET", url: "/api/market" })).json();
    expect(market.currencies).toEqual(expect.arrayContaining(["EUR", "USD", "GBP", "CHF", "JPY", "NOK", "SEK", "DKK", "PLN"]));
    expect((market.indices as { name: string; currency: string }[]).find((i) => i.name === "NOWA")).toMatchObject({ currency: "NOK", type: "OIS" });
    const spec = {
      id: "NOK-NOWA",
      currency: "NOK",
      index: "NOWA",
      quotes: [
        { type: "Deposit", tenor: "1W", rate: 0.044 },
        { type: "OIS", tenor: "6M", rate: 0.0435 },
        { type: "OIS", tenor: "1Y", rate: 0.043 },
        { type: "OIS", tenor: "2Y", rate: 0.042 },
        { type: "OIS", tenor: "5Y", rate: 0.041 },
        { type: "OIS", tenor: "10Y", rate: 0.0415 },
      ],
    };
    const boot = await app2.inject({ method: "POST", url: "/api/market/bootstrap", payload: { spec } });
    expect(boot.statusCode, boot.body).toBe(200);
    expect(boot.json().curve).toMatchObject({ id: "NOK-NOWA", currency: "NOK" });
    expect(boot.json().curve.nodes.length).toBeGreaterThanOrEqual(6);
    const replaced = await app2.inject({ method: "POST", url: "/api/market/curves", payload: { spec } });
    expect(replaced.statusCode, replaced.body).toBe(200);
    // The curve is in the market; a NOK swap needs the discount mapping, which the snapshot format carries.
    const snap = (await app2.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    expect((snap.curves as { id: string }[]).map((c) => c.id)).toContain("NOK-NOWA");
    const withNok = await app2.inject({
      method: "PUT",
      url: "/api/market/snapshot",
      payload: { ...snap, discountCurveId: { ...snap.discountCurveId, NOK: "NOK-NOWA" }, fxSpots: { ...snap.fxSpots, EURNOK: 11.6 } },
    });
    expect(withNok.statusCode, withNok.body).toBe(200);
    const nokSwap = await app2.inject({
      method: "POST",
      url: "/api/trades/from-template",
      payload: {
        template: "FRA",
        params: { currency: "NOK", notional: 1e7, payReceive: "Pay", start: "3x9", rate: 0.043, index: "NOWA" },
        price: true,
        reportingCurrency: "NOK",
      },
    });
    expect(nokSwap.statusCode, nokSwap.body).toBe(200);
    expect(typeof nokSwap.json().pricing.pv).toBe("number");
    const csvNok = await csv(
      "/api/trades/import?type=InterestRateSwap&reportingCurrency=NOK",
      "currency;notional;payReceive;fixedRate;effectiveDate;maturity;index;id\nNOK;10.000.000;Pay;4,20 %;2026-09-07;5Y;NOWA;IRS-NOK-1\n",
      app2,
    );
    expect(csvNok.statusCode, csvNok.body).toBe(200);
    expect(csvNok.json(), csvNok.body).toMatchObject({ imported: 1 });
    await app2.close();
  });

  it("the sample market carries historical fixings: the sample book prices without MISSING_FIXING and the snapshot round-trips", async () => {
    const priced = (await app.inject({ method: "GET", url: "/api/trades?price=1" })).json() as {
      trade: { id: string };
      pricing: { warnings?: string[]; pv: number | null };
    }[];
    expect(priced.length).toBeGreaterThan(5);
    for (const s of priced) {
      expect(s.pricing.pv, s.trade.id).not.toBeNull();
      expect(
        (s.pricing.warnings ?? []).filter((w) => w.startsWith("MISSING_FIXING:")),
        s.trade.id,
      ).toEqual([]);
    }
    const market = (await app.inject({ method: "GET", url: "/api/market" })).json();
    expect(market.fixings).toBeGreaterThan(1000);
    const snap = (await app.inject({ method: "GET", url: "/api/market/snapshot" })).json();
    expect(snap.fixings.length).toBe(market.fixings);
    const app2 = await buildApp({ logger: false, seedPortfolio: false });
    const imp = await app2.inject({ method: "PUT", url: "/api/market/snapshot", payload: snap });
    expect(imp.statusCode, imp.body).toBe(200);
    expect(imp.json().snapshotId).toBe(market.snapshotId);
    await app2.close();
  });
});

describe("N6-03 media types, 415 documentation, sendError everywhere, SYSTEM_CODE", () => {
  it("text/plain → 415 UNSUPPORTED_MEDIA_TYPE on JSON routes; text/csv → 415 outside the import route, 404 on unknown routes", async () => {
    for (const [method, url] of [
      ["POST", "/api/price"],
      ["PUT", "/api/market"],
      ["POST", "/api/trades"],
    ] as const) {
      const r = await app.inject({ method, url, headers: { "content-type": "text/plain" }, payload: "hello" });
      expect(r.statusCode, `${method} ${url}`).toBe(415);
      expect(r.json(), `${method} ${url}`).toMatchObject({ statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
      expect(typeof r.json().requestId).toBe("string");
    }
    const csvOnPrice = await app.inject({ method: "POST", url: "/api/price", headers: { "content-type": "text/csv" }, payload: "a;b\n1;2\n" });
    expect(csvOnPrice.statusCode).toBe(415);
    expect(csvOnPrice.json()).toMatchObject({ statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(csvOnPrice.json().error).toMatch(/POST \/api\/trades\/import/);
    const csvOnUnknown = await app.inject({ method: "POST", url: "/api/nope", headers: { "content-type": "text/csv" }, payload: "a;b\n1;2\n" });
    expect(csvOnUnknown.statusCode).toBe(404);
    expect(csvOnUnknown.json().code).toBe("NOT_FOUND");
    // The import route still takes CSV (and reports a missing `?type=` as CSV_INVALID, not as a media-type problem).
    const noType = await app.inject({ method: "POST", url: "/api/trades/import", headers: { "content-type": "text/csv" }, payload: "a;b\n1;2\n" });
    expect(noType.statusCode).toBe(400);
    expect(noType.json().code).toBe("CSV_INVALID");
    // JSON keeps working, XML stays 415.
    expect((await app.inject({ method: "POST", url: "/api/price", headers: { "content-type": "application/xml" }, payload: "<x/>" })).statusCode).toBe(415);
  });

  it("OpenAPI: 415 appears on every operation with a request body and on no GET/DELETE operation", () => {
    const doc = app.swagger() as unknown as Doc;
    const bodyless: string[] = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const has415 = "415" in op.responses;
        if (op.requestBody) expect(has415, `${method} ${path}`).toBe(true);
        else {
          expect(has415, `${method} ${path}`).toBe(false);
          bodyless.push(`${method} ${path}`);
        }
      }
    }
    expect(bodyless).toEqual(
      expect.arrayContaining(["get /api/market", "get /api/scenarios/standard", "get /api/trades/{id}", "delete /api/trades/{id}", "get /api/emir/valuations"]),
    );
    expect(bodyless.length).toBeGreaterThanOrEqual(14);
  });

  it("412/428 preconditions and snapshot-import errors travel through sendError (envelope with code, currentEtag, requestId)", async () => {
    const got = await app.inject({ method: "GET", url: "/api/trades/IRS-0001" });
    const etag = String(got.headers.etag);
    const trade = got.json().trade;
    const stale = await app.inject({ method: "PUT", url: "/api/trades/IRS-0001", headers: { "if-match": '"0-deadbeefdeadbeef"' }, payload: trade });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toEqual({
      error: "ETag mismatch – trade was modified",
      statusCode: 412,
      code: "PRECONDITION_FAILED",
      currentEtag: etag,
      requestId: stale.json().requestId,
    });
    const weak = await app.inject({ method: "DELETE", url: "/api/trades/IRS-0001", headers: { "if-match": `W/${etag}` } });
    expect(weak.statusCode).toBe(412);
    expect(weak.json()).toMatchObject({ code: "PRECONDITION_FAILED", currentEtag: etag });
    expect(weak.json().error).toMatch(/weak validator/);
    const strict = await buildApp({ logger: false, requireIfMatch: true });
    const required = await strict.inject({ method: "PUT", url: "/api/trades/IRS-0001", payload: trade });
    expect(required.statusCode).toBe(428);
    expect(required.json()).toMatchObject({ statusCode: 428, code: "PRECONDITION_REQUIRED", currentEtag: etag });
    expect(typeof required.json().requestId).toBe("string");
    await strict.close();
    // Catalogue guard for codes that arrive as plain strings (core codes on the snapshot / designationSnapshot paths).
    expect(apiErrorCode("INVALID_SNAPSHOT", "SNAPSHOT_MALFORMED")).toBe("INVALID_SNAPSHOT");
    expect(apiErrorCode("INVALID_TIMESTAMP", "SNAPSHOT_MALFORMED")).toBe("INVALID_TIMESTAMP");
    expect(apiErrorCode("SOMETHING_NEW", "SNAPSHOT_MALFORMED")).toBe("SNAPSHOT_MALFORMED");
    expect(apiErrorCode(undefined, "SNAPSHOT_MALFORMED")).toBe("SNAPSHOT_MALFORMED");
    expect(isApiErrorCode("NOT_FOUND")).toBe(true);
    expect(isApiErrorCode("FST_ERR_CTP_INVALID_MEDIA_TYPE")).toBe(false);
  });

  it("no route builds an error envelope by hand – every `{ error, statusCode, code }` body is sent through sendError", () => {
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
    // `reply.send({ error: … })` outside `sendError` (lib/errors.ts) and the global error handler (app.ts) is an envelope built by hand;
    // status-coded throws (`{ statusCode: 409 }` in the store) are classified centrally and are fine.
    const offenders = files
      .filter((f) => !f.endsWith(`lib${"/"}errors.ts`) && !f.endsWith("app.ts"))
      .filter((f) => /\.send\(\s*\{[^}]*\berror:/s.test(readFileSync(f, "utf8")) || /\bstatusCode:\s*4\d\d\s*,\s*code:/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it("SYSTEM_CODE: a future domain code starting with `E` (EXPIRED) survives; Node system errors are recognised by errno/syscall", () => {
    expect(classifyError(Object.assign(new Error("option expired"), { statusCode: 400, code: "EXPIRED" }))).toMatchObject({ status: 400, code: "EXPIRED" });
    expect(isDomainError(Object.assign(new Error("expired"), { code: "EXPIRED" }))).toBe(true);
    expect(classifyError(Object.assign(new Error("expired"), { code: "EXPIRED" }))).toMatchObject({ status: 422, code: "EXPIRED" });
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", errno: -104, syscall: "read" });
    expect(isNodeSystemError(reset)).toBe(true);
    expect(isDomainError(reset)).toBe(false);
    expect(classifyError(reset)).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(classifyError(Object.assign(reset, { statusCode: 400 }))).toMatchObject({ status: 400, code: "INVALID_REQUEST" });
    expect(isDomainError(Object.assign(new Error("destroyed"), { code: "ERR_STREAM_DESTROYED" }))).toBe(false);
    expect(classifyError(Object.assign(new Error("x"), { statusCode: 415, code: "FST_ERR_CTP_INVALID_MEDIA_TYPE" })).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(isNodeSystemError(new Error("plain"))).toBe(false);
    expect(isNodeSystemError(null)).toBe(false);
  });
});
