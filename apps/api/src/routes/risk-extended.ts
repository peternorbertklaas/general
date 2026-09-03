import { type FastifyInstance } from "fastify";
import { type Trade, type VegaBucketOptions, parRisk, parRiskPortfolio, sampleBootstrapSpecs, vegaBuckets } from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { arrayResponse, parRiskPortfolioBodySchema, responses, tradeRef } from "../schemas.js";

const currency = { type: "string", pattern: "^[A-Z]{3}$" } as const;

const parRiskReportSchema = {
  type: "object",
  description: "Par risk per curve and quote; `total` is the sum over all buckets in reporting currency.",
  properties: {
    tradeId: { type: "string" },
    currency: { type: "string" },
    bumpBp: { description: "Bump size (bp)" },
    curves: arrayResponse("{ curveId, buckets: { quote, tenor, delta }[] }[]"),
    total: { description: "Sum of bucket deltas" },
  },
  additionalProperties: true,
} as const;

const vegaResponse = arrayResponse(
  'VegaBucketReport[]: { key, surfaceId, kind, dimension, buckets: { expiry, tenor?, label ("2Y" | "2Yx5Y"), vega }[], total } – one entry per vol surface the trade depends on',
);
const dimension = {
  type: "string",
  enum: ["expiry", "expiry-tenor"],
  description: "Bucket layout: expiry rows (default) or expiry × tenor cells (swaption cubes)",
} as const;

/**
 * Market-quote (par) sensitivities and vega buckets. Par risk re-bootstraps
 * every curve per bumped quote, so it is an on-demand endpoint (≈ 1 s per
 * trade on the sample market) rather than a per-keystroke one; the portfolio
 * variant shares the re-bootstrapping across all trades. The quotes are the
 * store's current ones, so curves replaced via `POST /api/market/curves` are
 * bumped at their actual market inputs.
 */
export async function registerExtendedRiskRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: { trade: Trade; reportingCurrency?: string; curveIds?: string[]; bumpBp?: number } }>(
    "/api/risk/par",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "parRisk",
        tags: ["pricing"],
        summary: "Par-/Quote-Sensitivitäten: Bump je Marktquote (Depo/FRA/Future/Swap/OIS/Basis) mit Re-Bootstrapping",
        body: {
          type: "object",
          required: ["trade"],
          properties: {
            trade: tradeRef,
            reportingCurrency: currency,
            curveIds: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 10 },
            bumpBp: { type: "number", minimum: 0.01, maximum: 100 },
          },
          additionalProperties: false,
        },
        response: responses({ 200: parRiskReportSchema }, 400, 413, 422),
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const specs = sampleBootstrapSpecs(m.valuationDate, ctx.market.getQuotes());
      const res = parRisk(m, trade, req.body.reportingCurrency ?? "EUR", specs, { curveIds: req.body.curveIds, bumpBp: req.body.bumpBp });
      return datesToIso(res);
    },
  );

  app.post<{ Body: { trades?: Trade[]; useStore?: boolean; reportingCurrency?: string; curveIds?: string[]; bumpBp?: number } }>(
    "/api/risk/par/portfolio",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "parRiskPortfolio",
        tags: ["pricing"],
        summary: "Par-/Quote-Sensitivitäten für ein Portfolio (Re-Bootstrapping je Quote einmal für alle Trades; max. 200 Trades)",
        body: parRiskPortfolioBodySchema,
        response: responses({ 200: { type: "array", items: parRiskReportSchema, description: "One ParRiskReport per trade, in input order" } }, 400, 413, 422),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const trades = req.body.useStore || !req.body.trades ? ctx.trades.list().map((t) => t.trade) : datesToSerial(req.body.trades);
      if (trades.length === 0)
        return reply.status(400).send({ error: "No trades given (body.trades or useStore=true with a non-empty store)", statusCode: 400, requestId: req.id });
      if (trades.length > 200)
        return reply.status(400).send({ error: "At most 200 trades per par-risk portfolio request", statusCode: 400, requestId: req.id });
      const specs = sampleBootstrapSpecs(m.valuationDate, ctx.market.getQuotes());
      const res = parRiskPortfolio(m, trades, req.body.reportingCurrency ?? "EUR", specs, { curveIds: req.body.curveIds, bumpBp: req.body.bumpBp });
      return datesToIso(res);
    },
  );

  app.post<{
    Body: { trade: Trade; reportingCurrency?: string; dimension?: VegaBucketOptions["dimension"] };
    Querystring: { dimension?: VegaBucketOptions["dimension"] };
  }>(
    "/api/risk/vega",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "vegaBuckets",
        tags: ["pricing"],
        summary: "Vega-Buckets je Expiry oder Expiry × Tenor (Swaption-Cube, Caplet-Fläche, FX-Fläche)",
        body: { type: "object", required: ["trade"], properties: { trade: tradeRef, reportingCurrency: currency, dimension }, additionalProperties: false },
        querystring: { type: "object", properties: { dimension } },
        response: responses({ 200: vegaResponse }, 400, 413, 422),
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const dim = req.body.dimension ?? req.query.dimension;
      return datesToIso(vegaBuckets(m, trade, req.body.reportingCurrency ?? "EUR", dim ? { dimension: dim } : undefined));
    },
  );
}
