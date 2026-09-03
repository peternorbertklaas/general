import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from "fastify";
import { toISO } from "@deriva/pricing-core";
import { classifyError } from "./lib/errors.js";
import { AuditLog, MarketStore, TradeStore, samplePortfolio } from "./lib/store.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerHedgeRoutes } from "./routes/hedge.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerExtendedRiskRoutes } from "./routes/risk-extended.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerPricingRoutes } from "./routes/pricing.js";
import { registerSnapshotRoutes } from "./routes/snapshot.js";
import { registerTradeRoutes } from "./routes/trades.js";
import { errorResponseSchema, marketSnapshotSchema, responses, tradeSchema } from "./schemas.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Emit `X-Market-Snapshot-Id` (id of the market the response was computed on). */
    marketHeader?: boolean;
  }
}

export interface AppOptions {
  /** `true` = production logger (LOG_LEVEL, redaction); an object is passed through to pino. */
  logger?: boolean | Exclude<FastifyServerOptions["logger"], boolean>;
  seedPortfolio?: boolean;
  /** Allowed CORS origins; defaults to env CORS_ORIGINS (comma separated) or localhost dev servers. */
  corsOrigins?: string[];
  rateLimitMax?: number;
  /** Serve Swagger UI under /docs (default: only outside NODE_ENV=production; `/docs/json` is always available). */
  swaggerUi?: boolean;
  /** Suppress per-request "incoming request"/"request completed" logs (default: NODE_ENV=production). */
  disableRequestLogging?: boolean;
}

export interface AppContext {
  market: MarketStore;
  trades: TradeStore;
  audit: AuditLog;
  version: string;
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Incoming `x-request-id` is reused when it is a plain token (gateway correlation), otherwise a fresh id is generated. */
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export function requestIdFrom(header: string | string[] | undefined): string {
  const v = Array.isArray(header) ? header[0] : header;
  if (v && REQUEST_ID_RE.test(v)) return v;
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const isProduction = () => process.env.NODE_ENV === "production";

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const logger: FastifyServerOptions["logger"] =
    opts.logger === true ? { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie"] } : (opts.logger ?? false);
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: opts.disableRequestLogging ?? isProduction() }),
    requestIdHeader: false,
    genReqId: (raw) => requestIdFrom(raw.headers["x-request-id"]),
    bodyLimit: 5 * 1024 * 1024,
    ajv: {
      // `discriminator` enables the tagged `oneOf` trade schema; unknown properties are rejected (400) instead of silently stripped.
      customOptions: { discriminator: true, removeAdditional: false },
    },
  });
  const ctx: AppContext = { market: new MarketStore(), trades: new TradeStore(), audit: new AuditLog(), version: readVersion() };
  if (opts.seedPortfolio ?? true) {
    for (const t of samplePortfolio(ctx.market.get().valuationDate)) ctx.trades.upsert(t);
  }

  const origins =
    opts.corsOrigins ??
    (process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
      : ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]);
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "if-match", "if-none-match", "authorization", "x-request-id"],
    exposedHeaders: ["etag", "x-request-id", "x-market-snapshot-id", "location"],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: opts.rateLimitMax ?? 600, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "DERIVA Pricing API",
        description:
          "Bewertung von Zins- und Währungsderivaten: Kurven, Pricing, Sensitivitäten, Szenarien, XVA, Bewertungsreports, EMIR-Export, Markt-Snapshots. Datumsangaben als ISO-8601 (YYYY-MM-DD). Alle Request-Bodies werden per JSON-Schema validiert (400 mit `validation`-Details); Trades sind eine diskriminierte Union über `type`. Jede Antwort trägt `X-Request-Id`; bewertungsbezogene Antworten zusätzlich `X-Market-Snapshot-Id` (identisch mit `audit.snapshotId` im Report).",
        version: ctx.version,
        license: { name: "MIT" },
      },
      servers: [{ url: "/" }],
      tags: [
        { name: "market", description: "Marktdaten, Kurven, Snapshots" },
        { name: "pricing", description: "Bewertung, Risiko, Szenarien, XVA, Reports, EMIR" },
        { name: "trades", description: "Trade-Repository (ETag/If-Match/If-None-Match)" },
        { name: "audit", description: "Audit-Trail" },
        { name: "system", description: "Health & Version" },
      ],
    },
  });
  if (opts.swaggerUi ?? !isProduction()) {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  } else {
    // Swagger UI (and its static-file server) stays out of production; the machine-readable contract remains.
    app.get("/docs/json", { schema: { hide: true } }, async () => app.swagger());
  }

  // Shared schemas → OpenAPI components.
  app.addSchema(tradeSchema);
  app.addSchema(marketSnapshotSchema);
  app.addSchema(errorResponseSchema);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    if (req.routeOptions?.config?.marketHeader) reply.header("x-market-snapshot-id", ctx.market.snapshotId());
  });

  app.get(
    "/api/health",
    {
      schema: {
        operationId: "getHealth",
        tags: ["system"],
        summary: "Liveness",
        response: responses({
          200: {
            type: "object",
            required: ["status", "service", "version", "time"],
            properties: { status: { type: "string", enum: ["ok"] }, service: { type: "string" }, version: { type: "string" }, time: { type: "string" } },
          },
        }),
      },
    },
    async () => ({ status: "ok", service: "deriva-api", version: ctx.version, time: new Date().toISOString() }),
  );
  app.get(
    "/api/health/ready",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "getReadiness",
        tags: ["system"],
        summary: "Readiness (Marktdaten geladen, Portfolio bewertbar)",
        response: responses({
          200: {
            type: "object",
            required: ["status", "curves", "trades", "valuationDate", "snapshotId"],
            properties: {
              status: { type: "string", enum: ["ready", "not-ready"] },
              curves: { type: "integer" },
              trades: { type: "integer" },
              valuationDate: { type: "string", description: "ISO-8601" },
              snapshotId: { type: "string" },
            },
          },
        }),
      },
    },
    async () => {
      const m = ctx.market.get();
      return {
        status: Object.keys(m.curves).length > 0 ? "ready" : "not-ready",
        curves: Object.keys(m.curves).length,
        trades: ctx.trades.list().length,
        valuationDate: toISO(m.valuationDate),
        snapshotId: ctx.market.snapshotId(),
      };
    },
  );

  await registerMarketRoutes(app, ctx);
  await registerPricingRoutes(app, ctx);
  await registerTradeRoutes(app, ctx);
  await registerSnapshotRoutes(app, ctx);
  await registerAuditRoutes(app, ctx);
  await registerHedgeRoutes(app, ctx);
  await registerDocumentRoutes(app, ctx);
  await registerExtendedRiskRoutes(app, ctx);

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: `Route ${req.method} ${req.url} not found`, statusCode: 404, requestId: req.id });
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const c = classifyError(err);
    if (c.level === "error") req.log.error({ err, reqId: req.id }, "unhandled error");
    else if (c.level === "warn") {
      const e = err as Error;
      req.log.warn({ reqId: req.id, errName: e?.name, errMessage: e?.message, url: req.url }, "programming error while pricing – reported as invalid trade");
    }
    reply.status(c.status).send({
      error: c.message,
      statusCode: c.status,
      ...(c.code ? { code: c.code } : {}),
      ...(c.details ? { details: c.details } : {}),
      ...(c.validation ? { validation: c.validation } : {}),
      requestId: req.id,
    });
  });

  return app;
}
