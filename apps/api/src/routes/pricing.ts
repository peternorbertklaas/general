import { type FastifyInstance } from "fastify";
import {
  HISTORICAL_SCENARIOS,
  STANDARD_SCENARIOS,
  type CreditInputs,
  type ReportPerspective,
  type ScenarioDefinition,
  type Trade,
  type ValuationGovernance,
  addTenor,
  bootstrapHazardCurve,
  buildValuationReport,
  cashflowTable,
  computeRisk,
  computeXva,
  parseISO,
  pricePortfolio,
  priceTrade,
  runScenarios,
  scenarioGrid,
  survivalProbability,
  toCsv,
  toISO,
  yearFraction,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { sendError } from "../lib/errors.js";
import { safeFilename } from "../lib/store.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import {
  arrayResponse,
  csvResponse,
  gridBodySchema,
  hazardCurveBodySchema,
  hazardCurveSchema,
  jsonOrText,
  objectResponse,
  portfolioBodySchema,
  priceBodySchema,
  pricingResultSchema,
  reportBodySchema,
  responses,
  riskBodySchema,
  riskReportSchema,
  scenariosBodySchema,
  valuationReportSchema,
  xvaBodySchema,
} from "../schemas.js";

interface PriceBody {
  trade: Trade;
  reportingCurrency?: string;
}

export async function registerPricingRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: PriceBody }>(
    "/api/price",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "priceTrade",
        tags: ["pricing"],
        summary: "Einzelnen Trade bewerten (PV, Cashflows, Analytics)",
        body: priceBodySchema,
        response: responses({ 200: pricingResultSchema }, 400, 413, 422),
      },
    },
    async (req) => {
      const trade = datesToSerial(req.body.trade);
      const res = priceTrade(ctx.market.get(), trade, req.body.reportingCurrency);
      return datesToIso(res);
    },
  );

  app.post<{ Body: { trades?: Trade[]; reportingCurrency: string; useStore?: boolean } }>(
    "/api/price/portfolio",
    {
      config: { marketHeader: true, storeFallback: true },
      schema: {
        operationId: "pricePortfolio",
        tags: ["pricing"],
        summary: "Portfolio bewerten (Body-Trades oder Store mit useStore=true)",
        body: portfolioBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              description: "Per-trade results (failed trades carry pv null and a `Pricing failed:` warning) and the portfolio total.",
              properties: {
                results: { type: "array", items: pricingResultSchema },
                total: { description: "Sum of finite PVs in reporting currency" },
                currency: { type: "string" },
              },
              additionalProperties: true,
            },
          },
          400,
          413,
        ),
      },
    },
    async (req) => {
      const trades = req.body.useStore || !req.body.trades ? ctx.trades.list().map((t) => t.trade) : datesToSerial(req.body.trades);
      const res = pricePortfolio(ctx.market.get(), trades, req.body.reportingCurrency ?? "EUR");
      return datesToIso(res);
    },
  );

  app.post<{ Body: PriceBody & { bucketed?: boolean; vega?: boolean; theta?: boolean } }>(
    "/api/risk",
    {
      // Bucketed risk reprices the trade per curve pillar (≈ 2 × pillars valuations); the weight keeps it within the request budget.
      config: { marketHeader: true, computeWeight: (b) => ((b as { bucketed?: boolean }).bucketed ? 40 : 4) },
      schema: {
        operationId: "computeRisk",
        tags: ["pricing"],
        summary: "Sensitivitäten: DV01, Bucket-Deltas, FX-Delta, Vega, Theta",
        body: riskBodySchema,
        response: responses({ 200: riskReportSchema }, 400, 413, 422),
      },
    },
    async (req) => {
      const trade = datesToSerial(req.body.trade);
      const res = computeRisk(ctx.market.get(), trade, req.body.reportingCurrency ?? "EUR", {
        bucketed: req.body.bucketed,
        vega: req.body.vega,
        theta: req.body.theta,
      });
      return datesToIso(res);
    },
  );

  type ScenariosBody = { trades?: Trade[]; scenarios?: ScenarioDefinition[]; includeHistorical?: boolean; reportingCurrency?: string };
  app.post<{ Body: ScenariosBody }>(
    "/api/scenarios",
    {
      config: {
        marketHeader: true,
        storeFallback: true,
        // Base valuation + one per scenario.
        computeWeight: (b) => {
          const body = b as ScenariosBody;
          return 1 + (body.scenarios?.length ?? STANDARD_SCENARIOS.length) + (body.includeHistorical ? HISTORICAL_SCENARIOS.length : 0);
        },
      },
      schema: {
        operationId: "runScenarios",
        tags: ["pricing"],
        summary: "Szenarioanalyse (Standard-Set oder eigene Szenarien; `includeHistorical` hängt die historischen Stressepisoden an)",
        body: scenariosBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              properties: {
                results: arrayResponse("{ scenario, pv, pnl, perTrade[] }[]"),
                base: objectResponse("Base valuation"),
                currency: { type: "string" },
              },
              additionalProperties: true,
            },
          },
          400,
          413,
          422,
        ),
      },
    },
    async (req) => {
      const trades = req.body.trades ? datesToSerial(req.body.trades) : ctx.trades.list().map((t) => t.trade);
      const scenarios = [...(req.body.scenarios ?? STANDARD_SCENARIOS), ...(req.body.includeHistorical ? HISTORICAL_SCENARIOS : [])];
      const res = runScenarios(ctx.market.get(), trades, scenarios, req.body.reportingCurrency ?? "EUR");
      return datesToIso(res);
    },
  );

  app.get(
    "/api/scenarios/standard",
    {
      schema: {
        operationId: "listStandardScenarios",
        tags: ["pricing"],
        summary: "Standard-Szenarien (BaFin ±100/±200bp, EBA-IRRBB, Steepener/Flattener, FX, Vol, Roll)",
        response: responses({ 200: arrayResponse("ScenarioDefinition[]") }),
      },
    },
    async () => STANDARD_SCENARIOS,
  );

  app.get(
    "/api/scenarios/historical",
    {
      schema: {
        operationId: "listHistoricalScenarios",
        tags: ["pricing"],
        summary: "Historische Stressepisoden (Lehman 2008, Euro-Krise 2011, Covid 2020, …) als Szenariodefinitionen",
        description:
          "Indicative reconstructions (tenor-vector rate shifts in bp, FX moves in %, vol shifts) with the episode window and public sources in `description`; usable as `scenarios` of `POST /api/scenarios` or via `includeHistorical`.",
        response: responses({ 200: arrayResponse("ScenarioDefinition[] (ids `hist-*`)") }),
      },
    },
    async () => datesToIso(HISTORICAL_SCENARIOS),
  );

  type GridBody = { trades?: Trade[]; reportingCurrency?: string; ratesBp?: number[]; fxPct?: number[]; fxCurrency?: string };
  app.post<{ Body: GridBody }>(
    "/api/scenarios/grid",
    {
      config: {
        marketHeader: true,
        storeFallback: true,
        // One valuation per grid cell.
        computeWeight: (b) => {
          const body = b as GridBody;
          return (body.ratesBp?.length ?? 7) * (body.fxPct?.length ?? 5);
        },
      },
      schema: {
        operationId: "scenarioGrid",
        tags: ["pricing"],
        summary: "What-if-Matrix Zinsen × FX",
        body: gridBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              properties: {
                ratesBp: { type: "array", items: { type: "number" } },
                fxPct: { type: "array", items: { type: "number" } },
                fxCurrency: { type: "string" },
                pv: arrayResponse("PV matrix [rates][fx]"),
                pnl: arrayResponse("P&L matrix [rates][fx]"),
                currency: { type: "string" },
              },
              additionalProperties: true,
            },
          },
          400,
          413,
          422,
        ),
      },
    },
    async (req) => {
      const trades = req.body.trades ? datesToSerial(req.body.trades) : ctx.trades.list().map((t) => t.trade);
      return scenarioGrid(
        ctx.market.get(),
        trades,
        req.body.reportingCurrency ?? "EUR",
        req.body.ratesBp ?? [-200, -100, -50, 0, 50, 100, 200],
        req.body.fxPct ?? [-10, -5, 0, 5, 10],
        req.body.fxCurrency ?? "USD",
      );
    },
  );

  app.post<{ Body: PriceBody & { credit: CreditInputs } }>(
    "/api/xva",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "computeXva",
        tags: ["pricing"],
        summary: "CVA/DVA (semi-analytisch)",
        body: xvaBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              description: "XvaResult: cva, dva, bilateral adjustment, exposure profile (EPE/ENE per date).",
              properties: {
                tradeId: { type: "string" },
                currency: { type: "string" },
                cva: { description: "CVA (positive = charge)" },
                dva: { description: "DVA" },
                profile: arrayResponse("{ date, epe, ene, pd }[]"),
              },
              additionalProperties: true,
            },
          },
          400,
          413,
          422,
        ),
      },
    },
    async (req) => {
      const trade = datesToSerial(req.body.trade);
      return datesToIso(computeXva(ctx.market.get(), trade, req.body.credit, req.body.reportingCurrency ?? "EUR"));
    },
  );

  type HazardCurveBody = {
    quotes: { tenor: string; spread: number }[];
    recovery: number;
    valuationDate?: string;
    discountCurveId?: string;
    floorHazard?: boolean;
  };
  app.post<{ Body: HazardCurveBody }>(
    "/api/xva/hazard-curve",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "bootstrapHazardCurve",
        tags: ["pricing"],
        summary: "Hazard-Kurve aus Par-CDS-Spreads bootstrappen (stückweise konstant) – als `credit.cptyHazardCurve` / `ownHazardCurve` in /api/xva verwendbar",
        description:
          "Sequential bootstrap with quarterly premium dates. Inverted quotes (spread × maturity decreasing) imply a negative hazard on that pillar: 422 `INVALID_CREDIT_CURVE` with `details.pillar`, or – with `floorHazard: true` – a hazard of 0 on that interval and a `HAZARD_FLOORED: …` entry in `warnings` (200).",
        body: hazardCurveBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              description:
                "HazardCurve (times in years ACT/365F, hazard per interval, recovery, `warnings` when a pillar was floored) plus survival probabilities at the pillars.",
              required: ["times", "hazards", "recovery", "pillars"],
              properties: {
                ...hazardCurveSchema.properties,
                valuationDate: { type: "string", description: "ISO-8601" },
                pillars: arrayResponse("{ tenor, time, hazard, survival }[] – survival Q(t) = exp(−∫λ) at each pillar"),
              },
              additionalProperties: true,
            },
          },
          400,
          404,
          422,
        ),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const valuationDate = req.body.valuationDate ? parseISO(req.body.valuationDate) : m.valuationDate;
      const discount = req.body.discountCurveId ? m.curves[req.body.discountCurveId] : undefined;
      if (req.body.discountCurveId && !discount) return sendError(reply, req, 404, "NOT_FOUND", `Curve ${req.body.discountCurveId} not found`);
      const curve = bootstrapHazardCurve(req.body.quotes, req.body.recovery, valuationDate, discount, { floorHazard: req.body.floorHazard });
      // Label each pillar with the quote whose maturity (same ACT/365F time as the core) produced it.
      const quoteTimes = req.body.quotes.map((q) => ({ tenor: q.tenor, t: yearFraction(valuationDate, addTenor(valuationDate, q.tenor), "ACT/365F") }));
      return {
        ...curve,
        valuationDate: toISO(valuationDate),
        pillars: curve.times.map((t, i) => ({
          tenor: quoteTimes.find((q) => Math.abs(q.t - t) < 1e-9)?.tenor,
          time: t,
          hazard: curve.hazards[i],
          survival: survivalProbability(curve, t),
        })),
      };
    },
  );

  app.post<{
    Body: PriceBody & {
      credit?: CreditInputs;
      transactionPrice?: number;
      includeRisk?: boolean;
      perspective?: ReportPerspective;
      governance?: Partial<ValuationGovernance>;
    };
    Querystring: { format?: string };
  }>(
    "/api/report",
    {
      // Pricing + bucketed risk (unless includeRisk=false) + XVA.
      config: { marketHeader: true, computeWeight: (b) => ((b as { includeRisk?: boolean }).includeRisk === false ? 2 : 40) },
      schema: {
        operationId: "valuationReport",
        tags: ["pricing"],
        summary: "Prüfungsfähiger Bewertungsreport (JSON) oder Cashflow-CSV (?format=csv)",
        body: reportBodySchema,
        querystring: { type: "object", properties: { format: { type: "string", enum: ["json", "csv"] } } },
        response: responses(
          { 200: jsonOrText(valuationReportSchema, "text/csv", csvResponse, "Report (JSON) or cashflow table (CSV download)") },
          400,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const reporting = req.body.reportingCurrency ?? "EUR";
      const pricing = priceTrade(m, trade, reporting);
      if (req.query.format === "csv") {
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${safeFilename(trade.id)}-cashflows.csv"`);
        return toCsv(cashflowTable(pricing), { decimalComma: true, bom: true });
      }
      const risk = req.body.includeRisk === false ? undefined : computeRisk(m, trade, reporting, { bucketed: true });
      const xva = req.body.credit ? computeXva(m, trade, req.body.credit, reporting) : undefined;
      const report = buildValuationReport(m, trade, pricing, {
        risk,
        xva,
        transactionPrice: req.body.transactionPrice,
        perspective: req.body.perspective,
        governance: req.body.governance,
      });
      ctx.audit.append({
        actor: "api",
        action: "report.generate",
        subject: trade.id,
        details: { reportHash: report.audit.reportHash, snapshotId: report.audit.snapshotId, snapshotStatus: report.governance?.snapshotStatus },
      });
      return datesToIso(report);
    },
  );
}
