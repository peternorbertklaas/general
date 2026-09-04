import { type FastifyInstance } from "fastify";
import {
  type MarketContext,
  type ParRiskSpecs,
  type Trade,
  type VegaBucketOptions,
  parRisk,
  parRiskPortfolio,
  tradeCurveIds,
  vegaBuckets,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { sendError } from "../lib/errors.js";
import { type ParRiskSpecsChecked } from "../lib/store.js";
import { arrayResponse, parRiskPortfolioBodySchema, responses, tradeRef } from "../schemas.js";

const currency = { type: "string", pattern: "^[A-Z]{3}$" } as const;

/** Prefix of the `warnings[]` entries naming curves par risk could not bump for lack of quotes (Markt R8-3). */
export const PAR_RISK_INCOMPLETE_PREFIX = "PAR_RISK_INCOMPLETE";
/** Prefix of the `warnings[]` entries naming curves whose stored spec does not reproduce the curve – not bumped (Markt R10-1). */
export const PAR_RISK_INCONSISTENT_PREFIX = "PAR_RISK_INCONSISTENT";

const parRiskReportSchema = {
  type: "object",
  description:
    "Par risk per curve and quote; `total` is the sum over all buckets in reporting currency. Bumped are the curves the trade depends on that have bootstrap quotes in the store **and** whose spec reproduces the curve (R10-1): in sample mode the sample curves at their current quotes and every curve loaded through `POST /api/market/curves` (Markt R8-3), in import mode only the curves whose snapshot carried a `quotes` entry (R9-1) or that were loaded since – never the importer's default sample specs. Curves without quotes are listed in `curvesWithoutQuotes` with a `PAR_RISK_INCOMPLETE:` warning, curves whose spec does not re-bootstrap to the market's curve (max |Δdf| at the pillars > 1e-8, e.g. a foreign EoD snapshot with stale `quotes`) in `curvesInconsistent` with a `PAR_RISK_INCONSISTENT:` warning – both instead of contributing a silent zero or a level difference disguised as a sensitivity.",
  properties: {
    tradeId: { type: "string" },
    currency: { type: "string" },
    bumpBp: { description: "Bump size (bp)" },
    curves: arrayResponse("{ curveId, buckets: { quote, tenor, delta }[] }[]"),
    total: { description: "Sum of bucket deltas (bumped curves only)" },
    curvesWithoutQuotes: {
      type: "array",
      items: { type: "string" },
      description:
        "Curve ids the trade depends on (discount / projection curves in the market) that have no bootstrap quotes in the store and were therefore not bumped",
    },
    curvesInconsistent: {
      type: "array",
      items: { type: "string" },
      description:
        "Curve ids the trade depends on whose stored bootstrap spec does not reproduce the market's curve (re-bootstrap vs. curve: |Δdf| > 1e-8 at a pillar, or the spec no longer bootstraps) and were therefore not bumped (R10-1)",
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description:
        "`PAR_RISK_INCOMPLETE:` per curve in `curvesWithoutQuotes`, `PAR_RISK_INCONSISTENT:` (with the max |Δdf|) per curve in `curvesInconsistent` (empty when every curve was bumped)",
    },
  },
  additionalProperties: true,
} as const;

/** Curves of the trade (discount and projection curves present in the market) that no spec covers – restricted to `curveIds` when given. */
function curvesWithoutQuotes(m: MarketContext, trade: Trade, specs: ParRiskSpecs, curveIds?: string[]): string[] {
  const ids = tradeCurveIds(m, trade).filter((id) => m.curves[id] && !specs[id]);
  return curveIds ? ids.filter((id) => curveIds.includes(id)) : ids;
}
const incompleteWarnings = (missing: string[]): string[] =>
  missing.map(
    (id) =>
      `${PAR_RISK_INCOMPLETE_PREFIX}: curve ${id} has no bootstrap quotes in the store and was not bumped – load it through POST /api/market/curves (or import a snapshot with its quotes entry) to track its quotes`,
  );

/** Curves of the trade whose spec the consistency check excluded (R10-1 (c)) – restricted to `curveIds` when given – with their warnings. */
function inconsistentCurves(m: MarketContext, trade: Trade, checked: ParRiskSpecsChecked, curveIds?: string[]): { curves: string[]; warnings: string[] } {
  const trades = new Set(tradeCurveIds(m, trade));
  const hits = checked.inconsistent.filter((c) => trades.has(c.curveId) && (!curveIds || curveIds.includes(c.curveId)));
  return {
    curves: hits.map((c) => c.curveId),
    warnings: hits.map(
      (c) =>
        `${PAR_RISK_INCONSISTENT_PREFIX}: curve ${c.curveId}: the stored bootstrap spec does not reproduce the curve (${
          c.reason ? `spec does not bootstrap: ${c.reason}` : `max |Δdf| ${c.maxAbsDfDiff.toExponential(2)} at the pillars`
        }) and was not bumped – bumping it would report the level difference between spec and curve, not a sensitivity; re-load the curve through POST /api/market/curves so spec and curve agree`,
    ),
  };
}

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
 * variant shares the re-bootstrapping across all trades. The specs are the
 * store's (`parRiskCheck`: `parRiskSpecs` after the consistency check of R10-1):
 * sample curves at their current quotes plus every runtime curve loaded through
 * `POST /api/market/curves` – in import mode the snapshot's `quotes` only – so a
 * NOK or CZK swap gets par buckets on its own curve (Markt R8-3); curves without
 * quotes and curves whose spec does not reproduce them are reported, not
 * silently skipped or bumped. Vega buckets cover swaption cubes,
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
      // R10-1 (c): only specs that reproduce their curve are bumped; the rest is reported.
      const checked = ctx.market.parRiskCheck();
      const res = parRisk(m, trade, req.body.reportingCurrency ?? "EUR", checked.specs, { curveIds: req.body.curveIds, bumpBp: req.body.bumpBp });
      const missing = curvesWithoutQuotes(m, trade, checked.all, req.body.curveIds);
      const inconsistent = inconsistentCurves(m, trade, checked, req.body.curveIds);
      return {
        ...datesToIso(res),
        curvesWithoutQuotes: missing,
        curvesInconsistent: inconsistent.curves,
        warnings: [...incompleteWarnings(missing), ...inconsistent.warnings],
      };
    },
  );

  app.post<{ Body: { trades?: Trade[]; useStore?: boolean; reportingCurrency?: string; curveIds?: string[]; bumpBp?: number } }>(
    "/api/risk/par/portfolio",
    {
      config: { marketHeader: true, storeFallback: true },
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
      if (trades.length === 0) return sendError(reply, req, 400, "INVALID_REQUEST", "No trades given (body.trades or useStore=true with a non-empty store)");
      if (trades.length > 200) return sendError(reply, req, 400, "INVALID_REQUEST", "At most 200 trades per par-risk portfolio request");
      const checked = ctx.market.parRiskCheck();
      const res = parRiskPortfolio(m, trades, req.body.reportingCurrency ?? "EUR", checked.specs, { curveIds: req.body.curveIds, bumpBp: req.body.bumpBp });
      return datesToIso(res).map((report, i) => {
        const missing = curvesWithoutQuotes(m, trades[i]!, checked.all, req.body.curveIds);
        const inconsistent = inconsistentCurves(m, trades[i]!, checked, req.body.curveIds);
        return {
          ...report,
          curvesWithoutQuotes: missing,
          curvesInconsistent: inconsistent.curves,
          warnings: [...incompleteWarnings(missing), ...inconsistent.warnings],
        };
      });
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
