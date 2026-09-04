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
import { classifyError, sendError } from "./lib/errors.js";
import { type ComputeLimits, defaultLimits, registerComputeLimits } from "./lib/limits.js";
import { AuditLog, MarketStore, RegisterStore, TradeStore, samplePortfolio } from "./lib/store.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerHedgeRoutes } from "./routes/hedge.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerExtendedRiskRoutes } from "./routes/risk-extended.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerPortfolioReportRoutes } from "./routes/portfolio-report.js";
import { registerPricingRoutes } from "./routes/pricing.js";
import { registerSnapshotRoutes } from "./routes/snapshot.js";
import { registerTradeRoutes } from "./routes/trades.js";
import {
  API_ERROR_CODES,
  csvRequestBody,
  errorResponseSchema,
  fromTemplateBranchSchemas,
  marketSnapshotSchema,
  rateIndexSchema,
  responsesUnlimited,
  swapConventionsSchema,
  tradeSchema,
  tradeVariantSchemas,
} from "./schemas.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Emit `X-Market-Snapshot-Id` (id of the market the response was computed on). */
    marketHeader?: boolean;
    /** Route accepts a `text/csv` body (`POST /api/trades/import`); every other route answers 415 to CSV (N6-03). */
    acceptsCsv?: boolean;
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
  /** Compute bounds per request (default from env / `defaultLimits()`, see lib/limits.ts). */
  limits?: Partial<ComputeLimits>;
  /** `PUT`/`DELETE /api/trades/:id` without `If-Match` → 428 Precondition Required (default: env REQUIRE_IF_MATCH=1). */
  requireIfMatch?: boolean;
  /**
   * Trust `X-Forwarded-For` (and `X-Forwarded-Proto`/`-Host`) from a reverse proxy so `request.ip`
   * – the rate-limit key – is the client's address, not the proxy's. `true` trusts every hop,
   * a CIDR/IP list trusts those proxies only. Default: env `TRUST_PROXY` (`false` | `true` | CIDR list), off.
   */
  trustProxy?: boolean | string | string[];
}

export interface AppContext {
  market: MarketStore;
  trades: TradeStore;
  /** Indices / swap conventions registered at runtime through the API (snapshot `indices`/`conventions`, ADR-027). */
  registry: RegisterStore;
  audit: AuditLog;
  version: string;
  limits: ComputeLimits;
  requireIfMatch: boolean;
}

const BODY_LIMIT = 5 * 1024 * 1024;

/**
 * Post-processing of the generated OpenAPI 3.1 document: every discriminated
 * union whose branches are `$ref`s gets an explicit `discriminator.mapping`
 * (tag value → component). Ajv rejects `mapping` in the validation schema, so
 * it is derived here from the referenced components' tag `enum`. Likewise
 * `ErrorResponse.code` gets the complete code list as JSON-Schema `examples`
 * (3.1 keyword; @fastify/swagger collapses a schema-level `examples` array into
 * one `example`, deprecated in 3.1 – every remaining schema-level `example` is
 * therefore widened back to `examples`). `POST /api/trades/import` additionally
 * declares its `text/csv` request body (validation runs on the JSON shape the
 * CSV `preValidation` produces, see routes/trades.ts).
 */
export function openApiTransform<T extends { components?: { schemas?: Record<string, unknown> } }>(doc: T): T {
  const schemas = doc.components?.schemas ?? {};
  const errorCode = (schemas.ErrorResponse as { properties?: { code?: Record<string, unknown> } } | undefined)?.properties?.code;
  if (errorCode) {
    delete errorCode.example;
    errorCode.examples = [...API_ERROR_CODES.core, ...API_ERROR_CODES.api];
  }
  const paths = (doc as { paths?: Record<string, Record<string, { requestBody?: { content?: Record<string, unknown> } } | undefined>> }).paths;
  const importBody = paths?.["/api/trades/import"]?.post?.requestBody?.content;
  if (importBody && !importBody["text/csv"]) importBody["text/csv"] = csvRequestBody;
  const tagOf = (ref: string, tag: string): string | undefined => {
    const name = ref.replace(/^#\/components\/schemas\//, "");
    const comp = schemas[name] as { properties?: Record<string, { enum?: unknown[] }> } | undefined;
    const e = comp?.properties?.[tag]?.enum;
    return Array.isArray(e) && e.length === 1 && typeof e[0] === "string" ? e[0] : undefined;
  };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as {
      discriminator?: { propertyName?: string; mapping?: Record<string, string> };
      oneOf?: { $ref?: string }[];
      type?: unknown;
      properties?: unknown;
      example?: unknown;
      examples?: unknown;
    };
    // Schema objects (they carry `type`, `properties` or `oneOf`): singular `example` → `examples: [example]` (3.1 / JSON Schema 2020-12).
    if ((n.type !== undefined || n.properties !== undefined || n.oneOf !== undefined) && n.example !== undefined && n.examples === undefined) {
      n.examples = [n.example];
      delete n.example;
    }
    if (n.discriminator?.propertyName && Array.isArray(n.oneOf) && !n.discriminator.mapping) {
      const mapping: Record<string, string> = {};
      for (const b of n.oneOf) {
        const tag = b.$ref ? tagOf(b.$ref, n.discriminator.propertyName) : undefined;
        if (tag && b.$ref) mapping[tag] = b.$ref;
      }
      if (Object.keys(mapping).length === n.oneOf.length) n.discriminator.mapping = mapping;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(doc);
  return doc;
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

/**
 * `TRUST_PROXY` env → Fastify `trustProxy`: unset / `false` / `0` → off (socket address is the client),
 * `true` / `1` → trust every hop, anything else → comma-separated list of proxy IPs / CIDRs
 * (`10.0.0.0/8, 172.16.0.1`) that are trusted to set `X-Forwarded-For`.
 */
export function parseTrustProxy(env: string | undefined): boolean | string[] {
  const v = (env ?? "").trim();
  if (v === "" || /^(false|0|off|no)$/i.test(v)) return false;
  if (/^(true|1|on|yes)$/i.test(v)) return true;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Request line without the query string (reporting data such as UTIs travels in query maps – never into logs, N4-06). */
export const stripQuery = (url: string | undefined): string => (url ?? "").split("?")[0]!;

/** pino `req` serializer: method, path (query removed), client ip, request id – no headers, no query. */
function serializeRequest(req: { method?: string; url?: string; ip?: string; id?: unknown }) {
  return { method: req.method, url: stripQuery(req.url), remoteAddress: req.ip, requestId: req.id };
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const baseLogger = opts.logger === true ? { level: process.env.LOG_LEVEL ?? "info" } : opts.logger;
  const logger: FastifyServerOptions["logger"] =
    baseLogger && typeof baseLogger === "object"
      ? {
          ...baseLogger,
          redact: (baseLogger as { redact?: string[] }).redact ?? ["req.headers.authorization", "req.headers.cookie"],
          serializers: { req: serializeRequest, ...((baseLogger as { serializers?: Record<string, unknown> }).serializers ?? {}) },
        }
      : false;
  const trustProxy = opts.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY);
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: opts.disableRequestLogging ?? isProduction() }),
    requestIdHeader: false,
    genReqId: (raw) => requestIdFrom(raw.headers["x-request-id"]),
    bodyLimit: BODY_LIMIT,
    // `request.ip` (rate-limit key, log field) follows X-Forwarded-For only for trusted proxies (N4-02).
    trustProxy,
    ajv: {
      // `discriminator` enables the tagged `oneOf` trade schema; unknown properties are rejected (400) instead of silently stripped.
      customOptions: { discriminator: true, removeAdditional: false },
    },
  });
  const ctx: AppContext = {
    market: new MarketStore(),
    trades: new TradeStore(),
    registry: new RegisterStore(),
    audit: new AuditLog(),
    version: readVersion(),
    limits: { ...defaultLimits(), ...opts.limits },
    requireIfMatch: opts.requireIfMatch ?? process.env.REQUIRE_IF_MATCH === "1",
  };
  // Only JSON (and CSV on the import route) is a supported request media type: Fastify's built-in `text/plain`
  // parser would otherwise turn a text body into a 400 "body must be object" instead of 415 (N6-03).
  app.removeContentTypeParser("text/plain");
  // CSV uploads (`POST /api/trades/import`, content-type text/csv) arrive as a string under the same body limit; the route maps
  // them to trades. Any other route answers 415 `UNSUPPORTED_MEDIA_TYPE`, like every media type without a parser.
  app.addContentTypeParser("text/csv", { parseAs: "string", bodyLimit: BODY_LIMIT }, (req, body, done) => {
    // Unknown routes (no `routeOptions.url`) keep their 404; every known route without `acceptsCsv` answers 415.
    if (!req.routeOptions?.url || req.routeOptions.config?.acceptsCsv) return done(null, body);
    done(Object.assign(new Error("Unsupported Media Type: text/csv is accepted by POST /api/trades/import only"), { statusCode: 415 }), undefined);
  });
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
  await app.register(rateLimit, {
    max: opts.rateLimitMax ?? 600,
    timeWindow: "1 minute",
    // One bucket per client IP. `req.ip` is the socket address unless `trustProxy` is set, in which case it is
    // the client named by X-Forwarded-For – behind a gateway the limit is only "per client" with TRUST_PROXY.
    keyGenerator: (req) => req.ip,
    // Liveness/readiness probes (orchestrator, load balancer) must not consume or trip the client bucket.
    allowList: (req) => stripQuery(req.url) === "/api/health" || stripQuery(req.url) === "/api/health/ready",
  });
  await app.register(swagger, {
    // Named components: shared schemas keep their `$id` (Trade, MarketSnapshot, ErrorResponse, InterestRateSwap, …) instead of `def-N`.
    refResolver: {
      buildLocalReference: (json: { $id?: string; title?: string }, _base: unknown, _fragment: unknown, i: number) => {
        if (!json.title && json.$id) json.title = json.$id;
        return json.$id ?? json.title ?? `def-${i}`;
      },
    },
    transformObject: (doc) => ("openapiObject" in doc ? openApiTransform(doc.openapiObject) : doc.swaggerObject),
    openapi: {
      // 3.1: JSON-Schema-2020-12 keywords used by the validation schemas (numeric exclusiveMinimum/Maximum, propertyNames, examples) are valid as-is.
      openapi: "3.1.0",
      info: {
        title: "DERIVA Pricing API",
        description:
          `Bewertung von Zins- und Währungsderivaten: Kurven, Pricing, Sensitivitäten, Szenarien, XVA, Bewertungsreports, EMIR-Export, Markt-Snapshots. Datumsangaben als ISO-8601 (YYYY-MM-DD). Alle Request-Bodies werden per JSON-Schema validiert (400 mit \`validation\`-Details); Trades sind eine diskriminierte Union über \`type\`. Jede Antwort trägt \`X-Request-Id\`; bewertungsbezogene Antworten zusätzlich \`X-Market-Snapshot-Id\` (identisch mit \`audit.snapshotId\` im Report). ` +
          `Rechenbudget: geschätzte Kuponperioden je Leg ≤ ${ctx.limits.maxPeriodsPerLeg} (sonst 400 \`TOO_MANY_PERIODS\`), je Request ≤ ${ctx.limits.maxPeriodsPerRequest} Perioden über alle Trades und ≤ ${ctx.limits.maxWeightedPeriodsPerRequest} Perioden × Bewertungen (Szenarien, Grid-Zellen, Bucket-Risiko, Hedge-Tests; sonst 413 \`PERIOD_BUDGET_EXCEEDED\` – auch für Routen, die den gesamten Trade-Store bewerten: \`GET /api/trades?price=1\`, \`/api/emir/valuations\`); der Trade-Store ist auf ${ctx.limits.maxStorePeriods} Perioden begrenzt (\`POST\`/\`PUT /api/trades\`, \`/import\` → 413 \`STORE_BUDGET_EXCEEDED\`); Body ≤ 5 MB; alle Bewertungen laufen synchron – große Anfragen sind zu stückeln. Rate-Limit je Client-IP (hinter einem Proxy nur mit \`TRUST_PROXY\`; \`/api/health*\` ausgenommen).` +
          (ctx.requireIfMatch
            ? " `PUT`/`DELETE /api/trades/:id` verlangen `If-Match` (428 ohne Header)."
            : " `If-Match` auf `PUT`/`DELETE /api/trades/:id` ist optional (REQUIRE_IF_MATCH=1 erzwingt es mit 428)."),
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

  // Shared schemas → named OpenAPI components (Trade union + every variant, leg union, template branches, snapshot, error envelope).
  for (const s of tradeVariantSchemas) app.addSchema(s);
  for (const s of fromTemplateBranchSchemas) app.addSchema(s);
  app.addSchema(tradeSchema);
  // Register entries (referenced by the snapshot envelope's `indices` / `conventions`, ADR-027) before the snapshot schema.
  app.addSchema(rateIndexSchema);
  app.addSchema(swapConventionsSchema);
  app.addSchema(marketSnapshotSchema);
  app.addSchema(errorResponseSchema);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    if (req.routeOptions?.config?.marketHeader) reply.header("x-market-snapshot-id", ctx.market.snapshotId());
  });
  registerComputeLimits(app, ctx, ctx.limits);

  app.get(
    "/api/health",
    {
      schema: {
        operationId: "getHealth",
        tags: ["system"],
        summary: "Liveness (vom Rate-Limit ausgenommen)",
        response: responsesUnlimited({
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
        summary: "Readiness (Marktdaten geladen, Portfolio bewertbar; vom Rate-Limit ausgenommen)",
        response: responsesUnlimited({
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
  await registerPortfolioReportRoutes(app, ctx);
  await registerTradeRoutes(app, ctx);
  await registerSnapshotRoutes(app, ctx);
  await registerAuditRoutes(app, ctx);
  await registerHedgeRoutes(app, ctx);
  await registerDocumentRoutes(app, ctx);
  await registerExtendedRiskRoutes(app, ctx);

  // Unknown routes share the client's rate-limit bucket (N5-02): `@fastify/rate-limit` only guards registered
  // routes, so the not-found handler gets the plugin's preHandler – route scanning answers 429 like any route.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) => {
    sendError(reply, req, 404, "NOT_FOUND", `Route ${req.method} ${stripQuery(req.url)} not found`);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const c = classifyError(err);
    if (c.level === "error") req.log.error({ err, reqId: req.id, url: stripQuery(req.url) }, "unhandled error");
    else if (c.level === "warn") {
      const e = err as Error;
      req.log.warn(
        { reqId: req.id, errName: e?.name, errMessage: e?.message, url: stripQuery(req.url) },
        "programming error while pricing – reported as invalid trade",
      );
    }
    reply.status(c.status).send({
      error: c.message,
      statusCode: c.status,
      code: c.code,
      ...(c.details ? { details: c.details } : {}),
      ...(c.validation ? { validation: c.validation } : {}),
      requestId: req.id,
    });
  });

  return app;
}
