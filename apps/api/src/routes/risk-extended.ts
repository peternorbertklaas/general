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

const dimension = {
  type: "string",
  enum: ["expiry", "expiry-tenor"],
  description: "Bucket layout: expiry rows (default) or expiry × tenor cells (swaption cubes only; caplet and FX surfaces always report expiry rows)",
} as const;
const smile = {
  type: "boolean",
  description:
    "FX surfaces: also report the 25Δ risk-reversal and butterfly buckets of every expiry row (`component` rr25 / bf25; not part of `total`). Default false (ATM rows only).",
} as const;

const vegaBucketReportSchema = {
  type: "object",
  description:
    "VegaBucketReport – one entry per vol surface the trade depends on (swaption cube, caplet surface or FX vol surface of the pair). `total` sums the buckets; for FX surfaces only the ATM buckets (≈ parallel vega), smile buckets are reported separately.",
  properties: {
    key: { type: "string", description: 'Surface key in the market: currency / index ("EUR", "EUR-EURIBOR-6M") or FX pair ("EURUSD")' },
    surfaceId: { type: "string" },
    kind: { type: "string", enum: ["swaption", "caplet", "fx"] },
    dimension,
    buckets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          expiry: { description: "Expiry in years (surface grid point)" },
          tenor: { description: "Underlying swap tenor in years (expiry × tenor cells only)" },
          label: { type: "string", description: '"2Y" (expiry row), "2Yx5Y" (expiry × tenor cell) or "1Y RR25" / "1Y BF25" (FX smile bucket)' },
          vega: {
            description: "PV change for +1bp normal vol (+1 vol point for lognormal and FX surfaces) on this row / cell; FX: on the row's ATM, RR25 or BF25",
          },
          component: { type: "string", enum: ["atm", "rr25", "bf25"], description: "FX surfaces only: the bumped quote of the row" },
        },
        additionalProperties: true,
      },
    },
    total: { description: "Sum of the buckets (FX: ATM buckets only) ≈ parallel vega of `POST /api/risk`" },
  },
  additionalProperties: true,
} as const;
const vegaResponse = { type: "array", items: vegaBucketReportSchema, description: "VegaBucketReport[] – empty for trades without optionality" } as const;

/**
 * Market-quote (par) sensitivities and vega buckets. Par risk re-bootstraps
 * every curve per bumped quote, so it is an on-demand endpoint (≈ 1 s per
 * trade on the sample market) rather than a per-keystroke one; the portfolio
 * variant shares the re-bootstrapping across all trades. The quotes are the
 * store's current ones, so curves replaced via `POST /api/market/curves` are
 * bumped at their actual market inputs. Vega buckets cover swaption cubes,
 * caplet surfaces and – for FX options – the pair's FX vol surface (`kind:
 * "fx"`, ATM per expiry, optionally the RR25 / BF25 smile buckets).
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
    Body: { trade: Trade; reportingCurrency?: string; dimension?: VegaBucketOptions["dimension"]; smile?: boolean };
    Querystring: { dimension?: VegaBucketOptions["dimension"]; smile?: boolean };
  }>(
    "/api/risk/vega",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "vegaBuckets",
        tags: ["pricing"],
        summary:
          "Vega-Buckets je Expiry oder Expiry × Tenor: Swaption-Cube, Caplet-Fläche, FX-Vol-Fläche des Paars (`kind` swaption | caplet | fx; FX: ATM je Expiry, mit `smile` zusätzlich RR25/BF25)",
        description:
          'Every expiry row (or expiry × tenor cell) of the surfaces the trade depends on is bumped by +1bp normal vol (+1 vol point for lognormal surfaces) and the trade repriced. FX options bump the ATM vol of every expiry row of the pair\'s FX vol surface (`kind: "fx"`, keyed by pair); with `smile` the 25Δ risk reversal and butterfly of each row are bumped as separate buckets (`component` rr25 / bf25) that are reported but not part of `total`. Body fields take precedence over the query parameters.',
        body: {
          type: "object",
          required: ["trade"],
          properties: { trade: tradeRef, reportingCurrency: currency, dimension, smile },
          additionalProperties: false,
        },
        querystring: { type: "object", properties: { dimension, smile } },
        response: responses({ 200: vegaResponse }, 400, 413, 422),
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const opts: VegaBucketOptions = {};
      const dim = req.body.dimension ?? req.query.dimension;
      if (dim) opts.dimension = dim;
      const withSmile = req.body.smile ?? req.query.smile;
      if (withSmile !== undefined) opts.smile = withSmile;
      return datesToIso(vegaBuckets(m, trade, req.body.reportingCurrency ?? "EUR", opts));
    },
  );
}
