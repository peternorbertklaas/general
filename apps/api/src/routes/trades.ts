import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
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
import { ifMatchSatisfied, ifNoneMatchSatisfied } from "../lib/etag.js";
import { assertTradeWithinLimits } from "../lib/limits.js";
import {
  arrayResponse,
  fromTemplateBodySchema,
  pricingResultSchema,
  responses,
  responsesWithoutBody,
  storedTradeSchema,
  tradeId,
  tradeRef,
} from "../schemas.js";

const currencyQuery = { type: "string", pattern: "^[A-Z]{3}$", description: "Reporting currency for the probe valuation (default EUR)" } as const;
const idParams = { type: "object", required: ["id"], properties: { id: tradeId } } as const;
const ifMatchHeaders = {
  type: "object",
  properties: {
    "if-match": {
      type: "string",
      description:
        'Strong ETag of the version being modified (`"version-hash"` as returned by GET/POST/PUT), or "*". Compared with the strong comparison of RFC 9110 §13.1.1 – a weak tag (`W/"…"`) never matches. Optional unless the server runs with REQUIRE_IF_MATCH=1 (then 428 without it); a mismatch is always 412 with `currentEtag`.',
    },
  },
} as const;
const ifNoneMatchHeaders = {
  type: "object",
  properties: {
    "if-none-match": {
      type: "string",
      description: 'ETag(s) the client holds, or "*"; weak comparison (RFC 9110 §13.1.2 – `W/` is ignored). Match → 304 without body.',
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

/**
 * 412 on an `If-Match` that does not match (strong comparison – a `W/` tag or a stale version); 428 when the
 * header is missing and the server requires it – both through `sendError` with `currentEtag` (N6-03); `null` = proceed.
 */
function precondition(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, ifMatch: string | undefined, currentEtag: string): FastifyReply | null {
  if (ifMatch && !ifMatchSatisfied(ifMatch, currentEtag)) {
    const weak = ifMatch.trim().startsWith("W/");
    const message = weak
      ? "If-Match requires the strong ETag – a weak validator (W/) never matches (RFC 9110 §13.1.1); send the ETag as returned by the server"
      : "ETag mismatch – trade was modified";
    return sendError(reply, req, 412, "PRECONDITION_FAILED", message, { currentEtag });
  }
  if (!ifMatch && ctx.requireIfMatch) {
    return sendError(reply, req, 428, "PRECONDITION_REQUIRED", "If-Match header required (send the ETag of the version you read, or `*`)", { currentEtag });
  }
  return null;
}

type SchemaValidator = ((data: unknown) => unknown) & { errors?: { instancePath?: string; message?: string }[] | null };

/**
 * Problems of one built trade (ISO dates) against the `Trade` JSON schema, formatted like Fastify's
 * validation messages (`id must match pattern "…"`). Uses the app's own Ajv (shared schemas,
 * `discriminator`), so a CSV row is held to exactly the contract the JSON import enforces (R6-3).
 */
function tradeSchemaProblems(app: FastifyInstance, validator: { fn?: SchemaValidator }, trade: unknown): string[] {
  validator.fn ??= app.validatorCompiler!({ schema: tradeRef, method: "POST", url: "/api/trades/import", httpPart: "body" }) as SchemaValidator;
  if (validator.fn(trade) === true) return [];
  const errors = validator.fn.errors ?? [];
  const seen = new Set<string>();
  for (const e of errors) {
    const path = (e.instancePath ?? "").replace(/^\//, "").replace(/\//g, ".");
    seen.add(`${path || "trade"} ${e.message ?? "is invalid"}`);
  }
  return [...seen];
}

export async function registerTradeRoutes(app: FastifyInstance, ctx: AppContext) {
  const tradeValidator: { fn?: SchemaValidator } = {};
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
        response: responsesWithoutBody({ 200: { type: "array", items: storedTradeSchema } }, 400, 413),
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
        summary: "Trade lesen (liefert starken ETag; If-None-Match → 304)",
        params: idParams,
        headers: ifNoneMatchHeaders,
        response: responsesWithoutBody(
          { 200: storedTradeSchema, 304: { type: "null", description: "Not modified (ETag matches If-None-Match, weak comparison)" } },
          400,
          404,
        ),
      },
    },
    async (req, reply) => {
      const t = ctx.trades.get(req.params.id);
      if (!t) return sendError(reply, req, 404, "NOT_FOUND", "Trade not found");
      reply.header("etag", t.etag);
      if (ifNoneMatchSatisfied(req.headers["if-none-match"], t.etag)) return reply.status(304).send();
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
            201: { ...storedTradeSchema, description: 'Created (headers: strong ETag `"version-hash"`, Location)' },
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
        summary:
          "Trade aktualisieren (optimistic locking über If-Match mit starkem ETag: Abweichung oder W/-Tag → 412; ohne Header → 428 bei REQUIRE_IF_MATCH=1)",
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
      const failed = precondition(ctx, req, reply, req.headers["if-match"], current.etag);
      if (failed) return failed;
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

  /** `?dryRun=1|true` → validate and price without storing (Markt R7 note); `0|false` = a real import. */
  const isDryRun = (v: string | undefined) => v === "1" || v === "true";

  app.post<{
    Body: { trades: Trade[]; mode?: "create" | "upsert" };
    Querystring: { reportingCurrency?: string; type?: CsvTradeType; mode?: "create" | "upsert"; dryRun?: string };
  }>(
    "/api/trades/import",
    {
      config: { marketHeader: true, storeWrite: true, acceptsCsv: true },
      schema: {
        operationId: "importTrades",
        tags: ["trades"],
        summary:
          "Batch-Import als JSON-Array oder CSV (`content-type: text/csv` + `?type=`). Jeder Trade wird validiert und probeweise bewertet; Ergebnis je Trade/Zeile; `?dryRun=1` prüft und bewertet, ohne zu speichern",
        description:
          "JSON: `{ trades: Trade[], mode? }` – a schema violation anywhere in the array fails the whole request (400). " +
          "CSV (`content-type: text/csv`, declared as a second request-body media type): one column template per `?type=` (eleven templates: the seven trade types plus `FxSwap`, `BasisSwap`, `AmortisingSwap`, `ImmSwap`); rows are mapped through the core builders (market-standard conventions) and every built trade is checked against the `Trade` schema – a row that cannot be mapped or whose trade violates the schema (e.g. an `id` with spaces) is reported as `rejected` with `code: CSV_ROW_INVALID` and its `row` number while the other rows proceed; only a header lacking a required column (or a missing `?type=`) is a 400 `CSV_INVALID`. `?mode=` selects create (default) or upsert. " +
          "`?dryRun=1` (JSON and CSV) runs the identical validation and probe valuation but stores nothing: the response carries `dryRun: true` and every `results[].status` says what a real import would do (`imported` = would be stored, `skipped` = id exists in create mode, `rejected`), without `version`; the compute and store budgets are checked as for a real import. Unknown query parameters answer 400 `VALIDATION_ERROR` (a mistyped `dryrun` is not silently a real import). " +
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
            type: {
              type: "string",
              enum: [...CSV_TRADE_TYPES],
              description:
                "CSV only: column template of every row (`BasisSwap`, `AmortisingSwap`, `ImmSwap` build `InterestRateSwap` trades; the templates are documented in the operation description)",
            },
            mode: { type: "string", enum: ["create", "upsert"], description: "CSV only (JSON bodies carry `mode` in the body): default create" },
            dryRun: {
              type: "string",
              enum: ["1", "true", "0", "false"],
              description:
                "`1`/`true`: validate and price every trade / row exactly as an import would, but store nothing (response `dryRun: true`, statuses = what a real import would do, no `version`)",
            },
          },
          // A mistyped flag (`dryrun`, `upsert`) must not silently turn a validation run into a real import.
          additionalProperties: false,
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
                dryRun: {
                  type: "boolean",
                  description: "`true` when `?dryRun=1` – nothing was stored, the counters and statuses describe what a real import would do",
                },
                results: arrayResponse(
                  "Per trade / CSV row: { id?, row? (CSV, 1-based data row), status: imported|skipped|rejected, version? (absent on a dry run), pv?, warnings?, reason?, code? }",
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
        // Each built trade is held to the `Trade` schema individually (R6-3): a violation rejects its row with
        // `CSV_ROW_INVALID` instead of letting the route's batch schema fail the whole upload with 400.
        const trades: Trade[] = [];
        const rows: number[] = [];
        const rejected = [...parsed.rejected];
        parsed.trades.forEach((t, i) => {
          const iso = datesToIso(t);
          const problems = tradeSchemaProblems(app, tradeValidator, iso);
          if (problems.length) rejected.push({ row: parsed.rows[i]!, reason: `trade violates the schema: ${problems.join("; ")}` });
          else {
            trades.push(iso);
            rows.push(parsed.rows[i]!);
          }
        });
        req.csvImport = { rows, rejected };
        if (trades.length === 0) {
          // Every row failed to map or validate: report them (200 with all rows rejected) instead of tripping `minItems: 1`.
          const results: ImportResult[] = rejected
            .map((r): ImportResult => ({ row: r.row, status: "rejected", reason: r.reason, code: "CSV_ROW_INVALID" }))
            .sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
          return reply.send({ total: results.length, imported: 0, skipped: 0, rejected: results.length, dryRun: isDryRun(req.query.dryRun), results });
        }
        req.body = { trades, mode: req.query.mode };
      },
    },
    async (req) => {
      const m = ctx.market.get();
      const mode = req.body.mode ?? "create";
      const reporting = req.query.reportingCurrency ?? "EUR";
      const dryRun = isDryRun(req.query.dryRun);
      const rows = req.csvImport?.rows;
      const results: ImportResult[] = datesToSerial(req.body.trades).map((t, i) => {
        const row = rows ? { row: rows[i] } : {};
        try {
          if (mode === "create" && ctx.trades.get(t.id)) return { id: t.id, ...row, status: "skipped", reason: "exists" };
          const p = priceTrade(m, t, reporting);
          // Dry run: same validation and probe valuation, nothing stored (status = what the real import would do).
          if (dryRun) return { id: t.id, ...row, status: "imported", pv: p.pv, warnings: p.warnings };
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
        action: dryRun ? "trade.import.dryRun" : "trade.import",
        subject: "batch",
        details: { total: results.length, imported, dryRun, ...(rows ? { format: "csv", type: req.query.type } : {}) },
      });
      return {
        total: results.length,
        imported,
        skipped: results.filter((r) => r.status === "skipped").length,
        rejected: results.filter((r) => r.status === "rejected").length,
        dryRun,
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
        summary: "Trade löschen (If-Match mit starkem ETag: Abweichung oder W/-Tag → 412; ohne Header → 428 bei REQUIRE_IF_MATCH=1)",
        params: idParams,
        headers: ifMatchHeaders,
        response: responsesWithoutBody({ 204: { type: "null", description: "Deleted" } }, 400, 404, 412, 428),
      },
    },
    async (req, reply) => {
      const current = ctx.trades.get(req.params.id);
      if (!current) return sendError(reply, req, 404, "NOT_FOUND", "Trade not found");
      const failed = precondition(ctx, req, reply, req.headers["if-match"], current.etag);
      if (failed) return failed;
      ctx.trades.delete(req.params.id);
      ctx.audit.append({ actor: "api", action: "trade.delete", subject: req.params.id, details: { version: current.version } });
      return reply.status(204).send();
    },
  );
}
