import { type FastifyInstance } from "fastify";
import {
  type EmirRecordOptions,
  type EmirValuationRecord,
  type MarketSnapshotJson,
  deserializeMarket,
  emirCsv,
  emirValuationRecord,
  priceTrade,
  serializeMarket,
  validateMarket,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { csvResponse, emirRecordSchema, isoDateTime, jsonOrText, marketSnapshotRef, responses } from "../schemas.js";

type EmirQuery = {
  format?: "json" | "csv";
  reportingCurrency?: string;
  /** Reporting entity's valuation time (field 23) used when the snapshot carries no `meta.snapshotTime`; default EoD 17:00 UTC of the valuation date. */
  asOf?: string;
  /** Explicit valuation timestamp (field 23), highest priority – overrides snapshot time and `asOf`. */
  timestamp?: string;
  /** Valuation method (field 24): MTMA (market), MTMO (model, default), CCPV (CCP). */
  method?: EmirValuationRecord["valuationMethod"];
  /** JSON object mapping trade id → UTI (field "Unique transaction identifier"). */
  uti?: string;
  /** JSON object mapping trade id → observable transaction price; such trades report MTMA unless `method` is given. */
  transactionPrice?: string;
};

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

export async function registerSnapshotRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Headers: { "if-none-match"?: string } }>(
    "/api/market/snapshot",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getMarketSnapshot",
        tags: ["market"],
        summary: "Vollständigen Markt-Snapshot exportieren (JSON, ISO-Daten, versioniert; ETag = Snapshot-ID, If-None-Match → 304)",
        headers: { type: "object", properties: { "if-none-match": { type: "string" } } },
        response: responses({ 200: marketSnapshotRef, 304: { type: "null", description: "Not modified (snapshot id matches If-None-Match)" } }),
      },
    },
    async (req, reply) => {
      const etag = `"${ctx.market.snapshotId()}"`;
      reply.header("etag", etag);
      const inm = req.headers["if-none-match"];
      if (inm && inm.split(",").some((v) => v.trim() === etag || v.trim() === "*")) return reply.status(304).send();
      return serializeMarket(ctx.market.get());
    },
  );

  app.put<{ Body: MarketSnapshotJson }>(
    "/api/market/snapshot",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "importMarketSnapshot",
        tags: ["market"],
        summary: "Markt-Snapshot importieren (ersetzt den aktiven Snapshot nach Schema- und Konsistenzprüfung)",
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
      let m;
      try {
        m = deserializeMarket(req.body);
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message, statusCode: 400, requestId: req.id });
      }
      const problems = validateMarket(m);
      if (problems.length)
        return reply.status(422).send({ error: "Snapshot validation failed", code: "SNAPSHOT_INVALID", problems, statusCode: 422, requestId: req.id });
      ctx.market.set(m);
      const snapshotId = ctx.market.snapshotId();
      ctx.audit.append({
        actor: "api",
        action: "snapshot.import",
        subject: req.body.valuationDate,
        details: { curves: Object.keys(m.curves).length, snapshotId },
      });
      return { imported: true, valuationDate: req.body.valuationDate, curves: Object.keys(m.curves), snapshotId };
    },
  );

  app.get<{ Querystring: EmirQuery }>(
    "/api/emir/valuations",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "emirValuations",
        tags: ["pricing"],
        summary: "EMIR-Refit-Bewertungsfelder (Tabelle 2, Felder 21–26 Bewertung, 31–33 Clearing) für alle Trades (JSON oder ?format=csv)",
        description:
          "Clearing fields come from the trade (`cleared`, `clearingMember`; `clearingObligation` derived). Valuation timestamp (field 23): `timestamp` → snapshot `meta.snapshotTime` → `asOf` → 17:00 UTC of the valuation date. Method (field 24): `method` → MTMA for trades with a `transactionPrice` → MTMO.",
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
            uti: { type: "string", maxLength: 20000, description: 'JSON object { "<tradeId>": "<UTI>" } (overrides the trade\'s own `uti`)' },
            transactionPrice: {
              type: "string",
              maxLength: 20000,
              description: 'JSON object { "<tradeId>": <price> } – observable transaction prices; those trades report MTMA unless `method` is given',
            },
          },
          additionalProperties: false,
        },
        response: responses(
          { 200: jsonOrText({ type: "array", items: emirRecordSchema }, "text/csv", csvResponse, "EMIR valuation records (JSON) or CSV download") },
          400,
          422,
        ),
      },
    },
    async (req, reply) => {
      const utiMap = parseJsonMap(req.query.uti, isUti);
      if (!utiMap) {
        return reply
          .status(400)
          .send({ error: 'Query "uti" must be a JSON object mapping trade id to an alphanumeric UTI (max. 52 chars)', statusCode: 400, requestId: req.id });
      }
      const priceMap = parseJsonMap(req.query.transactionPrice, isFiniteNumber);
      if (!priceMap) {
        return reply
          .status(400)
          .send({ error: 'Query "transactionPrice" must be a JSON object mapping trade id to a finite number', statusCode: 400, requestId: req.id });
      }
      const m = ctx.market.get();
      const reporting = req.query.reportingCurrency ?? "EUR";
      const records = ctx.trades.list().map((s) => {
        const opts: EmirRecordOptions = {};
        if (req.query.method) opts.method = req.query.method;
        if (req.query.asOf) opts.asOf = req.query.asOf;
        if (req.query.timestamp) opts.timestamp = req.query.timestamp;
        const uti = utiMap[s.trade.id];
        if (uti) opts.uti = uti;
        const transactionPrice = priceMap[s.trade.id];
        if (transactionPrice !== undefined) opts.transactionPrice = transactionPrice;
        return emirValuationRecord(m, s.trade, priceTrade(m, s.trade, reporting), opts);
      });
      if (req.query.format === "csv") {
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="emir-valuations-${new Date().toISOString().slice(0, 10)}.csv"`);
        return emirCsv(records, ";", { decimalComma: true, bom: true });
      }
      return records;
    },
  );
}
