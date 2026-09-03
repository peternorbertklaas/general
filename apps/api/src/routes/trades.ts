import { type FastifyInstance } from "fastify";
import { type CrossCurrencySwapParams, type Trade, makeCrossCurrencySwap, makeFra, parseISO, priceTrade } from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { describeError } from "../lib/errors.js";
import { arrayResponse, errorRef, fromTemplateBodySchema, pricingResultSchema, responses, storedTradeSchema, tradeId, tradeRef } from "../schemas.js";

const currencyQuery = { type: "string", pattern: "^[A-Z]{3}$", description: "Reporting currency for the probe valuation (default EUR)" } as const;
const idParams = { type: "object", required: ["id"], properties: { id: tradeId } } as const;
const ifMatchHeaders = { type: "object", properties: { "if-match": { type: "string", description: 'ETag of the version being modified, or "*"' } } } as const;

type FraParams = Parameters<typeof makeFra>[0];
/** `POST /api/trades/from-template` body: builder parameters with ISO dates (validated by `fromTemplateBodySchema`). */
type TemplateBody = { price?: boolean; reportingCurrency?: string } & (
  | { template: "CrossCurrencySwap"; params: Omit<CrossCurrencySwapParams, "effectiveDate" | "tenor"> & { effectiveDate: string; tenor: string } }
  | { template: "FRA"; params: Omit<FraParams, "start" | "end" | "valuationDate"> & { start: string; end?: string; valuationDate?: string } }
);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Builders accept a tenor ("5Y", "3x6") or an explicit date for the same parameter. */
const dateOrTenor = (s: string): string | number => (ISO_RE.test(s) ? parseISO(s) : s);

function buildFromTemplate(body: TemplateBody, marketValuationDate: number): Trade {
  if (body.template === "CrossCurrencySwap") {
    const { effectiveDate, tenor, ...rest } = body.params;
    return makeCrossCurrencySwap({ ...rest, effectiveDate: parseISO(effectiveDate), tenor: dateOrTenor(tenor) });
  }
  const { start, end, valuationDate, ...rest } = body.params;
  return makeFra({
    ...rest,
    start: dateOrTenor(start),
    ...(end ? { end: parseISO(end) } : {}),
    valuationDate: valuationDate ? parseISO(valuationDate) : marketValuationDate,
  });
}

/** Match a conditional header (`If-Match` / `If-None-Match`) against an ETag; `*` matches any. */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((v) => {
    const t = v.trim();
    return t === "*" || t === etag;
  });
}

export async function registerTradeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Querystring: { price?: string; reportingCurrency?: string } }>(
    "/api/trades",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "listTrades",
        tags: ["trades"],
        summary: "Alle Trades (optional mit Bewertung: ?price=1)",
        querystring: {
          type: "object",
          properties: { price: { type: "string", description: "Any value → include probe valuation" }, reportingCurrency: currencyQuery },
        },
        response: responses({ 200: { type: "array", items: storedTradeSchema } }, 400),
      },
    },
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
              const d = describeError(e);
              return { ...s, pricing: { pv: null, error: d.message, code: d.code } };
            }
          }),
        );
      }
      return datesToIso(list);
    },
  );

  app.get<{ Params: { id: string }; Headers: { "if-none-match"?: string } }>(
    "/api/trades/:id",
    {
      schema: {
        operationId: "getTrade",
        tags: ["trades"],
        summary: "Trade lesen (liefert ETag; If-None-Match → 304)",
        params: idParams,
        headers: { type: "object", properties: { "if-none-match": { type: "string" } } },
        response: responses({ 200: storedTradeSchema, 304: { type: "null", description: "Not modified (ETag matches If-None-Match)" } }, 400, 404),
      },
    },
    async (req, reply) => {
      const t = ctx.trades.get(req.params.id);
      if (!t) return reply.status(404).send({ error: "Trade not found", statusCode: 404, requestId: req.id });
      reply.header("etag", t.etag);
      if (etagMatches(req.headers["if-none-match"], t.etag)) return reply.status(304).send();
      return datesToIso(t);
    },
  );

  app.post<{ Body: Trade; Querystring: { upsert?: string; reportingCurrency?: string } }>(
    "/api/trades",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "createTrade",
        tags: ["trades"],
        summary: "Trade anlegen (201). Existiert die ID → 409, außer ?upsert=1",
        body: tradeRef,
        querystring: {
          type: "object",
          properties: { upsert: { type: "string", description: "Any value → replace an existing trade (200)" }, reportingCurrency: currencyQuery },
        },
        response: responses(
          {
            201: { ...storedTradeSchema, description: "Created (headers: ETag, Location)" },
            200: { ...storedTradeSchema, description: "Replaced via ?upsert=1" },
          },
          400,
          409,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      const trade = datesToSerial(req.body);
      // Probe valuation in the requested reporting currency (throws → 422 via error handler).
      priceTrade(ctx.market.get(), trade, req.query.reportingCurrency ?? "EUR");
      const exists = ctx.trades.get(trade.id);
      if (exists && !req.query.upsert) {
        return reply.status(409).send({ error: `Trade ${trade.id} already exists (use PUT or ?upsert=1)`, statusCode: 409, requestId: req.id });
      }
      const stored = ctx.trades.upsert(trade);
      ctx.audit.append({
        actor: "api",
        action: exists ? "trade.replace" : "trade.create",
        subject: trade.id,
        details: { version: stored.version, type: trade.type },
      });
      reply.header("etag", stored.etag);
      reply.header("location", `/api/trades/${encodeURIComponent(trade.id)}`);
      return reply.status(exists ? 200 : 201).send(datesToIso(stored));
    },
  );

  app.put<{ Params: { id: string }; Body: Trade; Headers: { "if-match"?: string }; Querystring: { reportingCurrency?: string } }>(
    "/api/trades/:id",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "updateTrade",
        tags: ["trades"],
        summary: "Trade aktualisieren (optimistic locking über If-Match)",
        params: idParams,
        headers: ifMatchHeaders,
        querystring: { type: "object", properties: { reportingCurrency: currencyQuery } },
        body: tradeRef,
        response: responses({ 200: storedTradeSchema }, 400, 404, 412, 413, 422),
      },
    },
    async (req, reply) => {
      if (req.body.id !== req.params.id) {
        return reply.status(400).send({ error: `Body id "${req.body.id}" does not match path id "${req.params.id}"`, statusCode: 400, requestId: req.id });
      }
      const current = ctx.trades.get(req.params.id);
      if (!current) return reply.status(404).send({ error: "Trade not found", statusCode: 404, requestId: req.id });
      const ifMatch = req.headers["if-match"];
      if (ifMatch && !etagMatches(ifMatch, current.etag)) {
        return reply.status(412).send({ error: "ETag mismatch – trade was modified", statusCode: 412, currentEtag: current.etag, requestId: req.id });
      }
      const trade = datesToSerial(req.body);
      priceTrade(ctx.market.get(), trade, req.query.reportingCurrency ?? "EUR");
      const stored = ctx.trades.update(trade);
      ctx.audit.append({ actor: "api", action: "trade.update", subject: trade.id, details: { version: stored.version } });
      reply.header("etag", stored.etag);
      return datesToIso(stored);
    },
  );

  app.post<{ Body: { trades: Trade[]; mode?: "create" | "upsert" }; Querystring: { reportingCurrency?: string } }>(
    "/api/trades/import",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "importTrades",
        tags: ["trades"],
        summary: "Batch-Import (JSON-Array). Jeder Trade wird validiert und probeweise bewertet; Ergebnis je Trade",
        body: {
          type: "object",
          required: ["trades"],
          properties: { trades: { type: "array", items: tradeRef, minItems: 1, maxItems: 5000 }, mode: { type: "string", enum: ["create", "upsert"] } },
          additionalProperties: false,
        },
        querystring: { type: "object", properties: { reportingCurrency: currencyQuery } },
        response: responses(
          {
            200: {
              type: "object",
              required: ["total", "imported", "skipped", "rejected", "results"],
              properties: {
                total: { type: "integer" },
                imported: { type: "integer" },
                skipped: { type: "integer" },
                rejected: { type: "integer" },
                results: arrayResponse("Per trade: { id, status: imported|skipped|rejected, version?, pv?, warnings?, reason?, code? }"),
              },
            },
          },
          400,
          413,
        ),
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const mode = req.body.mode ?? "create";
      const reporting = req.query.reportingCurrency ?? "EUR";
      const results = datesToSerial(req.body.trades).map((t) => {
        try {
          if (mode === "create" && ctx.trades.get(t.id)) return { id: t.id, status: "skipped" as const, reason: "exists" };
          const p = priceTrade(m, t, reporting);
          const stored = ctx.trades.upsert(t);
          return { id: t.id, status: "imported" as const, version: stored.version, pv: p.pv, warnings: p.warnings };
        } catch (e) {
          const d = describeError(e);
          return { id: t.id, status: "rejected" as const, reason: d.message, code: d.code };
        }
      });
      const imported = results.filter((r) => r.status === "imported").length;
      ctx.audit.append({ actor: "api", action: "trade.import", subject: "batch", details: { total: results.length, imported } });
      return {
        total: results.length,
        imported,
        skipped: results.filter((r) => r.status === "skipped").length,
        rejected: results.filter((r) => r.status === "rejected").length,
        results,
      };
    },
  );

  app.post<{ Body: TemplateBody }>(
    "/api/trades/from-template",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "createTradeFromTemplate",
        tags: ["trades"],
        summary:
          "Trade aus Builder-Vorlage erzeugen (CrossCurrencySwap, FRA): liefert den gebauten Trade (nicht gespeichert), optional mit Bewertung (`price: true`)",
        body: fromTemplateBodySchema,
        response: responses(
          {
            200: {
              type: "object",
              description: "Built trade with market-standard conventions of the currencies; `pricing` when `price: true`. Store it via `POST /api/trades`.",
              required: ["trade"],
              properties: { trade: tradeRef, pricing: pricingResultSchema },
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
      const m = ctx.market.get();
      const trade = buildFromTemplate(req.body, m.valuationDate);
      const pricing = req.body.price ? priceTrade(m, trade, req.body.reportingCurrency ?? "EUR") : undefined;
      return datesToIso({ trade, ...(pricing ? { pricing } : {}) });
    },
  );

  app.delete<{ Params: { id: string }; Headers: { "if-match"?: string } }>(
    "/api/trades/:id",
    {
      schema: {
        operationId: "deleteTrade",
        tags: ["trades"],
        summary: "Trade löschen (If-Match optional; Abweichung → 412)",
        params: idParams,
        headers: ifMatchHeaders,
        response: { 204: { type: "null", description: "Deleted" }, 400: errorRef, ...responses({}, 404, 412) },
      },
    },
    async (req, reply) => {
      const current = ctx.trades.get(req.params.id);
      if (!current) return reply.status(404).send({ error: "Trade not found", statusCode: 404, requestId: req.id });
      const ifMatch = req.headers["if-match"];
      if (ifMatch && !etagMatches(ifMatch, current.etag)) {
        return reply.status(412).send({ error: "ETag mismatch – trade was modified", statusCode: 412, currentEtag: current.etag, requestId: req.id });
      }
      ctx.trades.delete(req.params.id);
      ctx.audit.append({ actor: "api", action: "trade.delete", subject: req.params.id, details: { version: current.version } });
      return reply.status(204).send();
    },
  );
}
