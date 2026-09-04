import { type FastifyInstance } from "fastify";
import {
  type CrossCurrencySwapParams,
  type MarketContext,
  type Trade,
  RATE_INDICES,
  fraIndexForPeriod,
  makeCrossCurrencySwap,
  makeFra,
  parseISO,
  priceTrade,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { CSV_TRADE_TYPES, type CsvImportResult, type CsvTradeType, csvTemplatesMarkdown, csvToTrades } from "../lib/csv-import.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { describeError, sendError } from "../lib/errors.js";
import { assertTradeWithinLimits } from "../lib/limits.js";
import { arrayResponse, errorRef, fromTemplateBodySchema, pricingResultSchema, responses, storedTradeSchema, tradeId, tradeRef } from "../schemas.js";

const currencyQuery = { type: "string", pattern: "^[A-Z]{3}$", description: "Reporting currency for the probe valuation (default EUR)" } as const;
const idParams = { type: "object", required: ["id"], properties: { id: tradeId } } as const;
const ifMatchHeaders = {
  type: "object",
  properties: {
    "if-match": {
      type: "string",
      description:
        'ETag of the version being modified, or "*". Optional unless the server runs with REQUIRE_IF_MATCH=1 (then 428 without it); a mismatch is always 412.',
    },
  },
} as const;

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the CSV `preValidation` of `POST /api/trades/import`: row numbers of the built trades and the rejected rows. */
    csvImport?: Pick<CsvImportResult, "rows" | "rejected">;
  }
}

type FraParams = Parameters<typeof makeFra>[0];
/** `POST /api/trades/from-template` body: builder parameters with ISO dates (validated by `fromTemplateBodySchema`). */
type TemplateBody = { price?: boolean; reportingCurrency?: string } & (
  | { template: "CrossCurrencySwap"; params: Omit<CrossCurrencySwapParams, "effectiveDate" | "tenor"> & { effectiveDate: string; tenor: string } }
  | { template: "FRA"; params: Omit<FraParams, "start" | "end" | "valuationDate"> & { start: string; end?: string; valuationDate?: string } }
);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRA_PERIOD_RE = /^(\d{1,3})x(\d{1,3})$/i;
/** Builders accept a tenor ("5Y", "3x6") or an explicit date for the same parameter. */
const dateOrTenor = (s: string): string | number => (ISO_RE.test(s) ? parseISO(s) : s);

/** Indices whose projection curve is loaded in the market (the builder's default list only knows the sample market). */
function availableIndices(m: MarketContext): string[] {
  return Object.values(RATE_INDICES)
    .filter((ix) => m.curves[ix.curveId] !== undefined)
    .map((ix) => ix.name);
}

function buildFromTemplate(body: TemplateBody, m: MarketContext): Trade {
  if (body.template === "CrossCurrencySwap") {
    const { effectiveDate, tenor, ...rest } = body.params;
    return makeCrossCurrencySwap({ ...rest, effectiveDate: parseISO(effectiveDate), tenor: dateOrTenor(tenor) });
  }
  const { start, end, valuationDate, ...rest } = body.params;
  // Period form "AxB" without an explicit index: pick the tenor index that has a curve in *this* market (Markt R4-6),
  // e.g. "1x2" → EURIBOR-3M when no 1M curve is loaded; an explicit `index` always wins.
  const period = typeof start === "string" ? FRA_PERIOD_RE.exec(start) : null;
  const index = rest.index ?? (period ? fraIndexForPeriod(rest.currency, Number(period[2]) - Number(period[1]), availableIndices(m)) : undefined);
  return makeFra({
    ...rest,
    ...(index ? { index } : {}),
    start: dateOrTenor(start),
    ...(end ? { end: parseISO(end) } : {}),
    valuationDate: valuationDate ? parseISO(valuationDate) : m.valuationDate,
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

/** 412 on an `If-Match` that does not match; 428 when the header is missing and the server requires it; `null` = proceed. */
function precondition(ctx: AppContext, ifMatch: string | undefined, currentEtag: string, requestId: string) {
  if (ifMatch && !etagMatches(ifMatch, currentEtag)) {
    return { status: 412, body: { error: "ETag mismatch – trade was modified", statusCode: 412, code: "PRECONDITION_FAILED", currentEtag, requestId } };
  }
  if (!ifMatch && ctx.requireIfMatch) {
    return {
      status: 428,
      body: {
        error: "If-Match header required (send the ETag of the version you read, or `*`)",
        statusCode: 428,
        code: "PRECONDITION_REQUIRED",
        currentEtag,
        requestId,
      },
    };
  }
  return null;
}

export async function registerTradeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Querystring: { price?: string; reportingCurrency?: string } }>(
    "/api/trades",
    {
      // `?price=1` prices the whole store: the request budget applies to it (N4-01).
      config: { marketHeader: true, storeFallback: (req) => Boolean((req.query as { price?: string }).price) },
      schema: {
        operationId: "listTrades",
        tags: ["trades"],
        summary: "Alle Trades (optional mit Bewertung: ?price=1 – bewertet den gesamten Store, Rechenbudget gilt)",
        querystring: {
          type: "object",
          properties: {
            price: {
              type: "string",
              description: "Any value → include probe valuation of every stored trade (413 `PERIOD_BUDGET_EXCEEDED` when the store exceeds the request budget)",
            },
            reportingCurrency: currencyQuery,
          },
        },
        response: responses({ 200: { type: "array", items: storedTradeSchema } }, 400, 413),
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
      if (!t) return sendError(reply, req, 404, "NOT_FOUND", "Trade not found");
      reply.header("etag", t.etag);
      if (etagMatches(req.headers["if-none-match"], t.etag)) return reply.status(304).send();
      return datesToIso(t);
    },
  );

  app.post<{ Body: Trade; Querystring: { upsert?: string; reportingCurrency?: string } }>(
    "/api/trades",
    {
      config: { marketHeader: true, storeWrite: true },
      schema: {
        operationId: "createTrade",
        tags: ["trades"],
        summary: "Trade anlegen (201). Existiert die ID → 409, außer ?upsert=1; Store-Budget (413 STORE_BUDGET_EXCEEDED)",
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
      if (exists && !req.query.upsert) return sendError(reply, req, 409, "CONFLICT", `Trade ${trade.id} already exists (use PUT or ?upsert=1)`);
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
      config: { marketHeader: true, storeWrite: true },
      schema: {
        operationId: "updateTrade",
        tags: ["trades"],
        summary: "Trade aktualisieren (optimistic locking über If-Match: Abweichung → 412; ohne Header → 428 bei REQUIRE_IF_MATCH=1)",
        params: idParams,
        headers: ifMatchHeaders,
        querystring: { type: "object", properties: { reportingCurrency: currencyQuery } },
        body: tradeRef,
        response: responses({ 200: storedTradeSchema }, 400, 404, 412, 413, 422, 428),
      },
    },
    async (req, reply) => {
      if (req.body.id !== req.params.id) {
        return sendError(reply, req, 400, "ID_MISMATCH", `Body id "${req.body.id}" does not match path id "${req.params.id}"`);
      }
      const current = ctx.trades.get(req.params.id);
      if (!current) return sendError(reply, req, 404, "NOT_FOUND", "Trade not found");
      const failed = precondition(ctx, req.headers["if-match"], current.etag, req.id);
      if (failed) return reply.status(failed.status).send(failed.body);
      const trade = datesToSerial(req.body);
      priceTrade(ctx.market.get(), trade, req.query.reportingCurrency ?? "EUR");
      const stored = ctx.trades.update(trade);
      ctx.audit.append({ actor: "api", action: "trade.update", subject: trade.id, details: { version: stored.version } });
      reply.header("etag", stored.etag);
      return datesToIso(stored);
    },
  );

  type ImportResult = {
    id?: string;
    row?: number;
    status: "imported" | "skipped" | "rejected";
    version?: number;
    pv?: number;
    warnings?: string[];
    reason?: string;
    code?: string;
  };
  const isCsv = (req: { headers: { "content-type"?: string } }) => (req.headers["content-type"] ?? "").toLowerCase().startsWith("text/csv");

  app.post<{
    Body: { trades: Trade[]; mode?: "create" | "upsert" };
    Querystring: { reportingCurrency?: string; type?: CsvTradeType; mode?: "create" | "upsert" };
  }>(
    "/api/trades/import",
    {
      config: { marketHeader: true, storeWrite: true },
      schema: {
        operationId: "importTrades",
        tags: ["trades"],
        summary:
          "Batch-Import als JSON-Array oder CSV (`content-type: text/csv` + `?type=`). Jeder Trade wird validiert und probeweise bewertet; Ergebnis je Trade/Zeile",
        description:
          "JSON: `{ trades: Trade[], mode? }` – a schema violation anywhere in the array fails the whole request (400). " +
          "CSV (`content-type: text/csv`, declared as a second request-body media type): one column template per `?type=`; rows are mapped through the core builders (market-standard conventions), a row that cannot be mapped is reported as `rejected` with its `row` number, a header lacking a required column is a 400. `?mode=` selects create (default) or upsert. " +
          "Compute bounds apply per trade, per request and to the store (400 `TOO_MANY_PERIODS`, 413 `PERIOD_BUDGET_EXCEEDED`, 413 `STORE_BUDGET_EXCEEDED` when the book would exceed `MAX_STORE_PERIODS` estimated coupon periods – every row counts, existing ids are netted).\n\n" +
          csvTemplatesMarkdown(),
        body: {
          type: "object",
          required: ["trades"],
          properties: { trades: { type: "array", items: tradeRef, minItems: 1, maxItems: 5000 }, mode: { type: "string", enum: ["create", "upsert"] } },
          additionalProperties: false,
        },
        querystring: {
          type: "object",
          properties: {
            reportingCurrency: currencyQuery,
            type: { type: "string", enum: [...CSV_TRADE_TYPES], description: "CSV only: column template / trade type of every row" },
            mode: { type: "string", enum: ["create", "upsert"], description: "CSV only (JSON bodies carry `mode` in the body): default create" },
          },
        },
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
                results: arrayResponse(
                  "Per trade / CSV row: { id?, row? (CSV, 1-based data row), status: imported|skipped|rejected, version?, pv?, warnings?, reason?, code? }",
                ),
              },
            },
          },
          400,
          413,
        ),
      },
      // CSV → `{ trades, mode }` before schema validation, so the JSON schema, the compute bounds and the handler apply unchanged.
      preValidation: async (req, reply) => {
        if (!isCsv(req)) return;
        if (typeof req.body !== "string") return sendError(reply, req, 400, "CSV_INVALID", "CSV body must be text");
        const type = req.query.type;
        if (!type) return sendError(reply, req, 400, "CSV_INVALID", "CSV import needs ?type=<TradeType> to select the column template");
        let parsed: CsvImportResult;
        try {
          parsed = csvToTrades(req.body, type, ctx.market.get().valuationDate);
        } catch (e) {
          return sendError(reply, req, 400, "CSV_INVALID", (e as Error).message);
        }
        req.csvImport = { rows: parsed.rows, rejected: parsed.rejected };
        if (parsed.trades.length === 0) {
          // Every row failed to map: report them (200 with all rows rejected) instead of tripping `minItems: 1`.
          const results: ImportResult[] = parsed.rejected.map((r) => ({ row: r.row, status: "rejected", reason: r.reason, code: "CSV_ROW_INVALID" }));
          return reply.send({ total: results.length, imported: 0, skipped: 0, rejected: results.length, results });
        }
        req.body = { trades: datesToIso(parsed.trades), mode: req.query.mode };
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const mode = req.body.mode ?? "create";
      const reporting = req.query.reportingCurrency ?? "EUR";
      const rows = req.csvImport?.rows;
      const results: ImportResult[] = datesToSerial(req.body.trades).map((t, i) => {
        const row = rows ? { row: rows[i] } : {};
        try {
          if (mode === "create" && ctx.trades.get(t.id)) return { id: t.id, ...row, status: "skipped", reason: "exists" };
          const p = priceTrade(m, t, reporting);
          const stored = ctx.trades.upsert(t);
          return { id: t.id, ...row, status: "imported", version: stored.version, pv: p.pv, warnings: p.warnings };
        } catch (e) {
          const d = describeError(e);
          return { id: t.id, ...row, status: "rejected", reason: d.message, code: d.code };
        }
      });
      for (const r of req.csvImport?.rejected ?? []) results.push({ row: r.row, status: "rejected", reason: r.reason, code: "CSV_ROW_INVALID" });
      if (rows) results.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
      const imported = results.filter((r) => r.status === "imported").length;
      ctx.audit.append({
        actor: "api",
        action: "trade.import",
        subject: "batch",
        details: { total: results.length, imported, ...(rows ? { format: "csv", type: req.query.type } : {}) },
      });
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
      const trade = buildFromTemplate(req.body, m);
      // The body carries builder parameters, not a trade – bound the built trade before pricing it.
      assertTradeWithinLimits(trade, ctx.limits);
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
        summary: "Trade löschen (If-Match: Abweichung → 412; ohne Header → 428 bei REQUIRE_IF_MATCH=1)",
        params: idParams,
        headers: ifMatchHeaders,
        response: { 204: { type: "null", description: "Deleted" }, 400: errorRef, ...responses({}, 404, 412, 428) },
      },
    },
    async (req, reply) => {
      const current = ctx.trades.get(req.params.id);
      if (!current) return sendError(reply, req, 404, "NOT_FOUND", "Trade not found");
      const failed = precondition(ctx, req.headers["if-match"], current.etag, req.id);
      if (failed) return reply.status(failed.status).send(failed.body);
      ctx.trades.delete(req.params.id);
      ctx.audit.append({ actor: "api", action: "trade.delete", subject: req.params.id, details: { version: current.version } });
      return reply.status(204).send();
    },
  );
}
