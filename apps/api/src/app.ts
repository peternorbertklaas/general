import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { MarketStore, TradeStore, samplePortfolio } from "./lib/store.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerPricingRoutes } from "./routes/pricing.js";
import { registerTradeRoutes } from "./routes/trades.js";

export interface AppOptions {
  logger?: boolean;
  seedPortfolio?: boolean;
}

export interface AppContext {
  market: MarketStore;
  trades: TradeStore;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const ctx: AppContext = { market: new MarketStore(), trades: new TradeStore() };
  if (opts.seedPortfolio ?? true) {
    for (const t of samplePortfolio(ctx.market.get().valuationDate)) ctx.trades.upsert(t);
  }

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "DERIVA Pricing API",
        description:
          "Bewertung von Zins- und Währungsderivaten: Kurven, Pricing, Sensitivitäten, Szenarien, XVA, Bewertungsreports. Datumsangaben als ISO-8601 (YYYY-MM-DD).",
        version: "0.1.0",
      },
      tags: [
        { name: "market", description: "Marktdaten & Kurven" },
        { name: "pricing", description: "Bewertung, Risiko, Szenarien, XVA" },
        { name: "trades", description: "Trade-Repository" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/api/health", { schema: { tags: ["market"] } }, async () => ({
    status: "ok",
    service: "deriva-api",
    version: "0.1.0",
    time: new Date().toISOString(),
  }));

  await registerMarketRoutes(app, ctx);
  await registerPricingRoutes(app, ctx);
  await registerTradeRoutes(app, ctx);

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 400;
    reply.status(status).send({ error: e.message ?? String(err), statusCode: status });
  });

  return app;
}
