import { type FastifyInstance, type FastifyReply } from "fastify";
import {
  type EmirRecordOptions,
  type EmirValuationRecord,
  type MarketSnapshotJson,
  type RateIndex,
  type SwapConventions,
  deserializeMarket,
  isBuiltInIndex,
  emirCsv,
  emirValuationRecord,
  isPricingError,
  priceTrade,
  serializeMarket,
  validateMarket,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { apiErrorCode, sendError } from "../lib/errors.js";
import { ifNoneMatchSatisfied } from "../lib/etag.js";
import { volSurfacePlausibilityWarnings, volSurfaceProblems } from "../lib/vol-surfaces.js";
import {
  type EMIR_BOOLEAN,
  type EMIR_CLEARED,
  type EMIR_CLEARING_OBLIGATION,
  csvResponse,
  emirRecordSchema,
  emirValuationsBodySchema,
  isoDateTime,
  jsonOrText,
  marketSnapshotRef,
  responses,
  responsesWithoutBody,
} from "../schemas.js";

/** Options shared by `GET` (query) and `POST` (body) `/api/emir/valuations`. */
type EmirOptions = {
  format?: "json" | "csv";
  reportingCurrency?: string;
  /** Reporting entity's valuation time (field 23) used when the snapshot carries no `meta.snapshotTime`; default EoD 17:00 UTC of the valuation date. */
  asOf?: string;
  /** Explicit valuation timestamp (field 23), highest priority – overrides snapshot time and `asOf`. */
  timestamp?: string;
  /** Valuation method (field 24): MTMA (market), MTMO (model, default), CCPV (CCP). */
  method?: EmirValuationRecord["valuationMethod"];
  /** Reporter default for field 30 (clearing obligation) when a trade does not carry `clearingObligation`; omitted → UKWN. */
  clearingObligation?: boolean;
  /** Field 31 `I` for trades that are not (yet) cleared but will be submitted for clearing. */
  intentToClear?: boolean;
};
/** GET: the maps travel as URL-encoded JSON strings (small books only). */
type EmirQuery = EmirOptions & { uti?: string; transactionPrice?: string };
/** POST: the maps are JSON objects. */
type EmirBody = EmirOptions & { uti?: Record<string, string>; transactionPrice?: Record<string, number> };

/**
 * API snapshot envelope (ADR-027): the core's `deriva.market/1` document plus the runtime register –
 * indices and swap conventions registered through `POST /api/market/indices|conventions`. The core
 * neither serialises nor hashes the register (`serializeMarket`, `marketSnapshotId`), so the two arrays
 * live in the API layer only: exported when non-empty, re-registered on import before the market is replaced.
 */
export type ApiMarketSnapshot = MarketSnapshotJson & { indices?: RateIndex[]; conventions?: SwapConventions[] };

/**
 * Upper bound of one query map (N4-06). Node rejects request lines above 16 kB with 431 before any
 * route runs, so the previously documented 20 000 characters were unreachable; maps of more than
 * ~4 kB (≈ 60–80 UTIs) belong in the `POST` body, which also keeps them out of request logs.
 */
export const QUERY_MAP_MAX_CHARS = 4000;

/** Parse a `{ "<tradeId>": value }` query parameter; `null` when it is not an object or a value fails `isValid`. */
function parseJsonMap<T>(raw: string | undefined, isValid: (v: unknown) => v is T): Record<string, T> | null {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isValid(v)) return null;
    out[k] = v;
  }
  return out;
}
const isUti = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{1,52}$/.test(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The core's `emirValuationRecord` emits the ITS (EU) 2022/1860 value formats itself (N4-08):
 * field 26 `TRUE`/`FLSE`, field 31 `Y`/`N`/`I`, field 30 `TRUE`/`FLSE`/`UKWN`. The response schema
 * pins the same literal sets (`EMIR_BOOLEAN`, `EMIR_CLEARED`, `EMIR_CLEARING_OBLIGATION`); this
 * compile-time check fails the build should the two drift apart.
 */
type AssertItsFormats = [
  EmirValuationRecord["collateralPortfolioIndicator"] extends (typeof EMIR_BOOLEAN)[number] ? true : never,
  EmirValuationRecord["cleared"] extends (typeof EMIR_CLEARED)[number] ? true : never,
  EmirValuationRecord["clearingObligation"] extends (typeof EMIR_CLEARING_OBLIGATION)[number] ? true : never,
];
const itsFormatsMatch: AssertItsFormats = [true, true, true];
void itsFormatsMatch;

export async function registerSnapshotRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Headers: { "if-none-match"?: string } }>(
    "/api/market/snapshot",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getMarketSnapshot",
        tags: ["market"],
        summary: "Vollständigen Markt-Snapshot exportieren (JSON, ISO-Daten, versioniert; starker ETag = Snapshot-ID, If-None-Match → 304)",
        description:
          "The core's `deriva.market/1` document (`serializeMarket`). When indices or swap conventions were registered at runtime (`POST /api/market/indices|conventions`), the API adds the envelope arrays `indices` / `conventions` (ADR-027) so a re-import restores them; they are not part of the snapshot id / ETag, which covers the market data only.",
        headers: {
          type: "object",
          properties: {
            "if-none-match": {
              type: "string",
              description: 'Snapshot ETag(s) the client holds (`"snapshotId"`), or "*"; weak comparison (`W/` ignored). Match → 304.',
            },
          },
        },
        response: responsesWithoutBody({
          200: marketSnapshotRef,
          304: { type: "null", description: "Not modified (snapshot id matches If-None-Match, weak comparison)" },
        }),
      },
    },
    async (req, reply) => {
      const etag = `"${ctx.market.snapshotId()}"`;
      reply.header("etag", etag);
      if (ifNoneMatchSatisfied(req.headers["if-none-match"], etag)) return reply.status(304).send();
      const indices = ctx.registry.listIndices();
      const conventions = ctx.registry.listConventions();
      const out: ApiMarketSnapshot = serializeMarket(ctx.market.get());
      if (indices.length) out.indices = indices;
      if (conventions.length) out.conventions = conventions;
      return out;
    },
  );

  app.put<{ Body: ApiMarketSnapshot }>(
    "/api/market/snapshot",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "importMarketSnapshot",
        tags: ["market"],
        summary:
          "Markt-Snapshot importieren (ersetzt den aktiven Snapshot nach Schema-, Vol-Flächen- und Konsistenzprüfung; registriert `indices`/`conventions` des API-Envelopes)",
        description:
          "Order of checks: JSON schema (400 `VALIDATION_ERROR`) → structural vol-surface check (400 `VOL_SURFACE_INVALID` with `problems[]`: grid dimensions, axis ordering, key ↔ currency/pair) → structural deserialisation (400 `SNAPSHOT_MALFORMED` / `INVALID_TIMESTAMP` / `INVALID_DATE`) → market consistency (`validateMarket`, 422 `SNAPSHOT_INVALID` with `problems[]`) → register (`indices`, then `conventions` of the API envelope, ADR-027: each entry is validated by the core – an invalid definition or a built-in index name answers 400 `INVALID_CURVE_SPEC` with `details.entry`). The active snapshot is replaced only when every step passes; a register failure leaves the market unchanged (entries registered before the failing one stay registered – the register is process-wide and additive). Implausible but structurally sound vol surfaces (numbers not fitting the `volType`, degenerate grids – Markt R6-4) are imported and reported in `warnings[]` (`VOL_IMPLAUSIBLE:`).",
        body: marketSnapshotRef,
        response: responses(
          {
            200: {
              type: "object",
              required: ["imported", "valuationDate", "curves", "snapshotId"],
              properties: {
                imported: { type: "boolean" },
                valuationDate: { type: "string" },
                curves: { type: "array", items: { type: "string" } },
                snapshotId: { type: "string" },
                indices: { type: "array", items: { type: "string" }, description: "Names of the indices registered from the envelope's `indices`" },
                conventions: {
                  type: "array",
                  items: { type: "string" },
                  description: "Currencies whose conventions were registered from the envelope's `conventions`",
                },
                warnings: {
                  type: "array",
                  items: { type: "string" },
                  description: "`VOL_IMPLAUSIBLE:` warnings of the imported surfaces (empty when plausible)",
                },
              },
            },
          },
          400,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      // The envelope arrays are an API extension (ADR-027) – the core sees the `deriva.market/1` document only.
      const { indices = [], conventions = [], ...core } = req.body;
      const surfaceProblems = volSurfaceProblems(core);
      if (surfaceProblems.length) {
        return sendError(reply, req, 400, "VOL_SURFACE_INVALID", `Vol surface(s) of the snapshot structurally invalid (${surfaceProblems.length} problem(s))`, {
          problems: surfaceProblems,
        });
      }
      let m;
      try {
        m = deserializeMarket(core);
      } catch (e) {
        // Structural problems the schema cannot express (e.g. an unparsable timestamp) – a client error with the core's code when it has one.
        const code = apiErrorCode(isPricingError(e) ? e.code : undefined, "SNAPSHOT_MALFORMED");
        return sendError(reply, req, 400, code, (e as Error).message);
      }
      const problems = validateMarket(m);
      if (problems.length) return sendError(reply, req, 422, "SNAPSHOT_INVALID", "Snapshot validation failed", { problems });
      // Register the envelope's indices and conventions (Markt R6-5 rest) – validated by the core, built-ins never replaced.
      const registered = { indices: [] as string[], conventions: [] as string[] };
      try {
        for (const ix of indices) {
          if (isBuiltInIndex(ix.name)) {
            return sendError(
              reply,
              req,
              400,
              "INVALID_CURVE_SPEC",
              `indices: ${ix.name.toUpperCase()} is a built-in index and cannot be replaced – drop it from the snapshot or rename the variant`,
              {
                details: { entry: ix.name.toUpperCase(), builtIn: true },
              },
            );
          }
          registered.indices.push(ctx.registry.registerIndex(ix).index.name);
        }
        for (const conv of conventions) registered.conventions.push(ctx.registry.registerConventions(conv).conventions.currency);
      } catch (e) {
        if (!isPricingError(e)) throw e;
        return sendError(reply, req, 400, apiErrorCode(e.code, "INVALID_CURVE_SPEC"), e.message, { details: { ...(e.details ?? {}), registered } });
      }
      // Implausible (but structurally sound) surfaces are imported with a warning (Markt R6-4).
      const warnings = volSurfacePlausibilityWarnings(core);
      ctx.market.set(m);
      const snapshotId = ctx.market.snapshotId();
      ctx.audit.append({
        actor: "api",
        action: "snapshot.import",
        subject: req.body.valuationDate,
        details: { curves: Object.keys(m.curves).length, warnings: warnings.length, ...registered, snapshotId },
      });
      return { imported: true, valuationDate: req.body.valuationDate, curves: Object.keys(m.curves), snapshotId, ...registered, warnings };
    },
  );

  const emirSummary =
    "EMIR-Refit-Bewertungsfelder (ITS 2022/1860 Tabelle 2: 21–24 Bewertung, 25 Delta, 26 Collateral-Indikator, 30 Clearingpflicht, 31 Cleared) für alle Trades (JSON oder format=csv)";
  const emirDescription =
    "Clearing fields come from the trade: `cleared` (field 31, `Y`/`N`; `I` = intent to clear via the `intentToClear` option for not-yet-cleared trades), `clearingObligation` (field 30, `TRUE`/`FLSE` – explicit flag or the `clearingObligation` reporter default, `UKWN` when neither is set; never derived from `cleared`), `clearingMember` (Table 1). " +
    "Valuation timestamp (field 23, ISO-8601 date-time): `timestamp` → snapshot `meta.snapshotTime` → `asOf` → 17:00 UTC of the valuation date. Method (field 24): `method` → MTMA for trades with a `transactionPrice` → MTMO. " +
    "Value formats follow ITS Table 2 (booleans `TRUE`/`FLSE`, cleared `Y`/`N`/`I`, clearing obligation `TRUE`/`FLSE`/`UKWN`). The whole trade store is priced: the request budget applies (413 `PERIOD_BUDGET_EXCEEDED`).";
  const emirSuccess = { 200: jsonOrText({ type: "array", items: emirRecordSchema }, "text/csv", csvResponse, "EMIR valuation records (JSON) or CSV download") };
  // GET has no body (no 415), POST has one.
  const emirResponseGet = responsesWithoutBody(emirSuccess, 400, 413, 422);
  const emirResponsePost = responses(emirSuccess, 400, 413, 422);

  /** Price the store, build the ITS-formatted records and answer as JSON or CSV. */
  const emirRecords = (reply: FastifyReply, opts: EmirOptions, utiMap: Record<string, string>, priceMap: Record<string, number>) => {
    const m = ctx.market.get();
    const reporting = opts.reportingCurrency ?? "EUR";
    const records = ctx.trades.list().map((s) => {
      const o: EmirRecordOptions = {};
      if (opts.method) o.method = opts.method;
      if (opts.asOf) o.asOf = opts.asOf;
      if (opts.timestamp) o.timestamp = opts.timestamp;
      if (opts.clearingObligation !== undefined) o.clearingObligation = opts.clearingObligation;
      if (opts.intentToClear !== undefined) o.intentToClear = opts.intentToClear;
      const uti = utiMap[s.trade.id];
      if (uti) o.uti = uti;
      const transactionPrice = priceMap[s.trade.id];
      if (transactionPrice !== undefined) o.transactionPrice = transactionPrice;
      return emirValuationRecord(m, s.trade, priceTrade(m, s.trade, reporting), o);
    });
    if (opts.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="emir-valuations-${new Date().toISOString().slice(0, 10)}.csv"`);
      return emirCsv(records, ";", { decimalComma: true, bom: true });
    }
    return records;
  };

  app.get<{ Querystring: EmirQuery }>(
    "/api/emir/valuations",
    {
      config: { marketHeader: true, storeFallback: true },
      schema: {
        operationId: "emirValuations",
        tags: ["pricing"],
        summary: `${emirSummary} – Query-Variante für kleine Bücher`,
        description:
          emirDescription +
          ` The \`uti\`/\`transactionPrice\` maps are URL-encoded JSON of at most ${QUERY_MAP_MAX_CHARS} characters each (400 \`INVALID_QUERY_MAP\` above that; Node answers 431 for request lines above 16 kB); larger maps and any reporting data that must not appear in URLs go through \`POST /api/emir/valuations\`.`,
        querystring: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["json", "csv"] },
            reportingCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
            asOf: { ...isoDateTime, description: "Reporter's valuation time (field 23) when the snapshot has no `meta.snapshotTime`; default EoD 17:00 UTC" },
            timestamp: { ...isoDateTime, description: "Explicit valuation timestamp (field 23), overrides snapshot time and `asOf`" },
            method: {
              type: "string",
              enum: ["MTMA", "MTMO", "CCPV"],
              description: "Valuation method (field 24) for all records, default MTMO (MTMA with `transactionPrice`)",
            },
            uti: {
              type: "string",
              maxLength: QUERY_MAP_MAX_CHARS,
              description: `JSON object { "<tradeId>": "<UTI>" } (overrides the trade's own \`uti\`); ≤ ${QUERY_MAP_MAX_CHARS} characters, larger maps via POST`,
            },
            transactionPrice: {
              type: "string",
              maxLength: QUERY_MAP_MAX_CHARS,
              description: `JSON object { "<tradeId>": <price> } – observable transaction prices; those trades report MTMA unless \`method\` is given; ≤ ${QUERY_MAP_MAX_CHARS} characters, larger maps via POST`,
            },
            clearingObligation: {
              type: "boolean",
              description: "Reporter default for field 30 (Art. 4 EMIR) applied to trades without their own `clearingObligation`; omitted → UKWN",
            },
            intentToClear: {
              type: "boolean",
              description: "Field 31 `I` (intent to clear) for trades that are not (yet) cleared but will be submitted for clearing; cleared trades stay `Y`",
            },
          },
          additionalProperties: false,
        },
        response: emirResponseGet,
      },
      // A clear message before Ajv's generic `maxLength` error.
      preValidation: async (req, reply) => {
        const q = req.query as Record<string, unknown>;
        for (const key of ["uti", "transactionPrice"] as const) {
          const v = q[key];
          if (typeof v === "string" && v.length > QUERY_MAP_MAX_CHARS) {
            return sendError(
              reply,
              req,
              400,
              "INVALID_QUERY_MAP",
              `Query map "${key}" has ${v.length} characters; the query variant accepts at most ${QUERY_MAP_MAX_CHARS} – send the map in the body of POST /api/emir/valuations`,
              { details: { key, length: v.length, max: QUERY_MAP_MAX_CHARS } },
            );
          }
        }
      },
    },
    async (req, reply) => {
      const utiMap = parseJsonMap(req.query.uti, isUti);
      if (!utiMap) {
        return sendError(reply, req, 400, "INVALID_QUERY_MAP", 'Query "uti" must be a JSON object mapping trade id to an alphanumeric UTI (max. 52 chars)');
      }
      const priceMap = parseJsonMap(req.query.transactionPrice, isFiniteNumber);
      if (!priceMap) {
        return sendError(reply, req, 400, "INVALID_QUERY_MAP", 'Query "transactionPrice" must be a JSON object mapping trade id to a finite number');
      }
      return emirRecords(reply, req.query, utiMap, priceMap);
    },
  );

  app.post<{ Body: EmirBody }>(
    "/api/emir/valuations",
    {
      config: { marketHeader: true, storeFallback: true },
      schema: {
        operationId: "emirValuationsPost",
        tags: ["pricing"],
        summary: `${emirSummary} – Body-Variante mit UTI-/Preis-Maps als JSON-Objekte`,
        description:
          emirDescription +
          " Same options as the GET variant; `uti` and `transactionPrice` are JSON objects keyed by trade id (up to 5000 entries each). Prefer this variant for books of more than a few dozen trades and whenever UTIs or prices must not appear in URLs or access logs.",
        body: emirValuationsBodySchema,
        response: emirResponsePost,
      },
    },
    async (req, reply) => emirRecords(reply, req.body, req.body.uti ?? {}, req.body.transactionPrice ?? {}),
  );
}
