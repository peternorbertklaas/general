import { type FastifyInstance } from "fastify";
import { type Trade, priceTrade } from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";

export async function registerTradeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Querystring: { price?: string; reportingCurrency?: string } }>(
    "/api/trades",
    { schema: { tags: ["trades"], summary: "Alle Trades (optional mit Bewertung: ?price=1)" } },
    async (req) => {
      const list = ctx.trades.list();
      if (req.query.price) {
        const m = ctx.market.get();
        return datesToIso(
          list.map((s) => {
            try {
              const p = priceTrade(m, s.trade, req.query.reportingCurrency ?? "EUR");
              return { ...s, pricing: { pv: p.pv, currency: p.currency, analytics: p.analytics, warnings: p.warnings } };
            } catch (e) {
              return { ...s, pricing: { pv: null, error: (e as Error).message } };
            }
          }),
        );
      }
      return datesToIso(list);
    },
  );

  app.get<{ Params: { id: string } }>("/api/trades/:id", { schema: { tags: ["trades"] } }, async (req, reply) => {
    const t = ctx.trades.get(req.params.id);
    if (!t) return reply.status(404).send({ error: "Trade not found" });
    return datesToIso(t);
  });

  app.post<{ Body: Trade }>("/api/trades", { schema: { tags: ["trades"], summary: "Trade anlegen/ersetzen" } }, async (req, reply) => {
    const trade = datesToSerial(req.body);
    if (!trade.id || !trade.type) return reply.status(400).send({ error: "trade.id and trade.type are required" });
    // Validate by pricing once.
    priceTrade(ctx.market.get(), trade);
    return datesToIso(ctx.trades.upsert(trade));
  });

  app.put<{ Params: { id: string }; Body: Trade }>("/api/trades/:id", { schema: { tags: ["trades"] } }, async (req, reply) => {
    const trade = datesToSerial({ ...req.body, id: req.params.id });
    if (!ctx.trades.get(req.params.id)) return reply.status(404).send({ error: "Trade not found" });
    priceTrade(ctx.market.get(), trade);
    return datesToIso(ctx.trades.upsert(trade));
  });

  app.delete<{ Params: { id: string } }>("/api/trades/:id", { schema: { tags: ["trades"] } }, async (req, reply) => {
    if (!ctx.trades.delete(req.params.id)) return reply.status(404).send({ error: "Trade not found" });
    return { deleted: req.params.id };
  });
}
