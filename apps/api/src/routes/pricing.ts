import { type FastifyInstance } from "fastify";
import {
  STANDARD_SCENARIOS,
  type CreditInputs,
  type ScenarioDefinition,
  type Trade,
  buildValuationReport,
  cashflowTable,
  computeRisk,
  computeXva,
  pricePortfolio,
  priceTrade,
  runScenarios,
  scenarioGrid,
  toCsv,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";

interface PriceBody {
  trade: Trade;
  reportingCurrency?: string;
}

export async function registerPricingRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: PriceBody }>(
    "/api/price",
    { schema: { tags: ["pricing"], summary: "Einzelnen Trade bewerten (PV, Cashflows, Analytics)" } },
    async (req) => {
      const trade = datesToSerial(req.body.trade);
      const res = priceTrade(ctx.market.get(), trade, req.body.reportingCurrency);
      return datesToIso(res);
    },
  );

  app.post<{ Body: { trades?: Trade[]; reportingCurrency: string; useStore?: boolean } }>(
    "/api/price/portfolio",
    { schema: { tags: ["pricing"], summary: "Portfolio bewerten" } },
    async (req) => {
      const trades = req.body.useStore || !req.body.trades ? ctx.trades.list().map((t) => t.trade) : datesToSerial(req.body.trades);
      const res = pricePortfolio(ctx.market.get(), trades, req.body.reportingCurrency ?? "EUR");
      return datesToIso(res);
    },
  );

  app.post<{ Body: PriceBody & { bucketed?: boolean; vega?: boolean; theta?: boolean } }>(
    "/api/risk",
    { schema: { tags: ["pricing"], summary: "Sensitivitäten: DV01, Bucket-Deltas, FX-Delta, Vega, Theta" } },
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

  app.post<{ Body: { trades?: Trade[]; scenarios?: ScenarioDefinition[]; reportingCurrency?: string } }>(
    "/api/scenarios",
    { schema: { tags: ["pricing"], summary: "Szenarioanalyse (Standard-Set oder eigene Szenarien)" } },
    async (req) => {
      const trades = req.body.trades ? datesToSerial(req.body.trades) : ctx.trades.list().map((t) => t.trade);
      const res = runScenarios(ctx.market.get(), trades, req.body.scenarios ?? STANDARD_SCENARIOS, req.body.reportingCurrency ?? "EUR");
      return datesToIso(res);
    },
  );

  app.get("/api/scenarios/standard", { schema: { tags: ["pricing"], summary: "Standard-Szenarien" } }, async () => STANDARD_SCENARIOS);

  app.post<{ Body: { trades?: Trade[]; reportingCurrency?: string; ratesBp?: number[]; fxPct?: number[]; fxCurrency?: string } }>(
    "/api/scenarios/grid",
    { schema: { tags: ["pricing"], summary: "What-if-Matrix Zinsen × FX" } },
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
    { schema: { tags: ["pricing"], summary: "CVA/DVA (semi-analytisch)" } },
    async (req) => {
      const trade = datesToSerial(req.body.trade);
      return datesToIso(computeXva(ctx.market.get(), trade, req.body.credit, req.body.reportingCurrency ?? "EUR"));
    },
  );

  app.post<{ Body: PriceBody & { credit?: CreditInputs; transactionPrice?: number; includeRisk?: boolean }; Querystring: { format?: string } }>(
    "/api/report",
    { schema: { tags: ["pricing"], summary: "Prüfungsfähiger Bewertungsreport (JSON) oder Cashflow-CSV (?format=csv)" } },
    async (req, reply) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const reporting = req.body.reportingCurrency ?? "EUR";
      const pricing = priceTrade(m, trade, reporting);
      if (req.query.format === "csv") {
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${trade.id}-cashflows.csv"`);
        return toCsv(cashflowTable(pricing));
      }
      const risk = req.body.includeRisk === false ? undefined : computeRisk(m, trade, reporting, { bucketed: true });
      const xva = req.body.credit ? computeXva(m, trade, req.body.credit, reporting) : undefined;
      return datesToIso(buildValuationReport(m, trade, pricing, { risk, xva, transactionPrice: req.body.transactionPrice }));
    },
  );
}
