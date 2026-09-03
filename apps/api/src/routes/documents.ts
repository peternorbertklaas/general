import { type FastifyInstance } from "fastify";
import {
  HISTORICAL_SCENARIOS,
  STANDARD_SCENARIOS,
  type ConfirmationParties,
  type CreditInputs,
  type KidOptions,
  type MasterAgreementRef,
  type ScenarioDefinition,
  type SuitabilityInputs,
  type Trade,
  buildValuationReport,
  computeRisk,
  computeXva,
  generateConfirmation,
  generateKid,
  generateSuitabilityStatement,
  generateTermsheet,
  priceTrade,
  runScenarios,
} from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { safeFilename } from "../lib/store.js";
import { arrayResponse, creditSchema, jsonOrText, markdownResponse, objectResponse, responses, scenarioSchema, tradeRef } from "../schemas.js";

const isoDate = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO-8601 date" } as const;
const currency = { type: "string", pattern: "^[A-Z]{3}$" } as const;

const partySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    lei: { type: "string", pattern: "^[A-Z0-9]{18}[0-9]{2}$", description: "Legal Entity Identifier (ISO 17442)" },
    address: { type: "string", maxLength: 500 },
    contact: { type: "string", maxLength: 500 },
  },
  additionalProperties: false,
} as const;

/** `ConfirmationParties` + `MasterAgreementRef` of the core. */
const confirmationBodySchema = {
  type: "object",
  required: ["trade", "parties", "masterAgreement"],
  properties: {
    trade: tradeRef,
    reportingCurrency: currency,
    parties: { type: "object", required: ["bank", "client"], properties: { bank: partySchema, client: partySchema }, additionalProperties: false },
    masterAgreement: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", enum: ["DRV", "ISDA"], description: "Deutscher Rahmenvertrag für Finanztermingeschäfte or ISDA Master Agreement" },
        date: isoDate,
        reference: { type: "string", maxLength: 200 },
        csaReference: { type: "string", maxLength: 200, description: "Besicherungsanhang / Credit Support Annex" },
      },
      additionalProperties: false,
    },
    tradeDate: { ...isoDate, description: "Default: the trade's `tradeDate`, else the valuation date" },
    confirmationDate: isoDate,
    reference: { type: "string", maxLength: 200, description: "Confirmation reference number" },
    includeSchedule: { type: "boolean", description: "Price the trade for the indicative payment schedule (default true; false = leg schedules only)" },
  },
  additionalProperties: false,
} as const;

/** `KidOptions` of the core without the server-side inputs (`report`, `scenarioSet`). */
const kidOptionsSchema = {
  type: "object",
  required: ["manufacturer"],
  properties: {
    manufacturer: { type: "string", minLength: 1, maxLength: 200, description: "PRIIP manufacturer (Hersteller)" },
    competentAuthority: { type: "string", maxLength: 200, description: "Default BaFin" },
    productName: { type: "string", maxLength: 200 },
    holdingPeriodYears: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Recommended holding period (default: time to maturity)" },
    targetMarket: { type: "string", maxLength: 2000 },
    transactionPrice: { type: "number", description: "Price paid by the `perspective` party at inception (cost section)" },
    perspective: { type: "string", enum: ["Bank", "Kunde"], description: 'Perspective of pricing.pv / transactionPrice (default "Bank")' },
    notional: { type: "number", exclusiveMinimum: 0, description: "Notional for percentage figures (default inferred from the trade)" },
    contact: { type: "string", maxLength: 500, description: "Website / contact for complaints" },
  },
  additionalProperties: false,
} as const;

const kidBodySchema = {
  type: "object",
  required: ["trade", "kid"],
  properties: {
    trade: tradeRef,
    reportingCurrency: currency,
    credit: creditSchema,
    kid: kidOptionsSchema,
    scenarios: { type: "array", items: scenarioSchema, maxItems: 200, description: "Scenario set for the performance scenarios (default: standard scenarios)" },
    includeHistorical: {
      type: "boolean",
      description: "Append the historical stress episodes to the default scenario set (ignored when `scenarios` is given)",
    },
  },
  additionalProperties: false,
} as const;

const suitabilitySchema = {
  type: "object",
  required: [
    "clientName",
    "clientClassification",
    "hedgingPurpose",
    "knowledgeExperience",
    "financialSituation",
    "riskTolerance",
    "investmentHorizonYears",
    "advisorName",
    "transactionPrice",
  ],
  properties: {
    clientName: { type: "string", minLength: 1, maxLength: 200 },
    clientClassification: { type: "string", enum: ["Privatkunde", "Professioneller Kunde", "Geeignete Gegenpartei"] },
    hedgingPurpose: { type: "string", maxLength: 2000 },
    knowledgeExperience: { type: "string", maxLength: 2000 },
    financialSituation: { type: "string", maxLength: 2000 },
    riskTolerance: { type: "string", enum: ["niedrig", "mittel", "hoch"] },
    investmentHorizonYears: { type: "number", minimum: 0, maximum: 100 },
    advisorName: { type: "string", maxLength: 200 },
    transactionPrice: { type: "number" },
    alternativesConsidered: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
  },
  additionalProperties: false,
} as const;

const documentSchema = {
  type: "object",
  description: "Structured document with sections and a Markdown rendering.",
  properties: {
    kind: { type: "string", enum: ["Termsheet", "Geeignetheitserklaerung", "Confirmation", "KID"] },
    title: { type: "string" },
    subtitle: { type: "string" },
    generatedAt: { type: "string" },
    sections: arrayResponse("{ heading, rows?: [key, value][], paragraphs?: string[], table?: { header, rows } }[]"),
    disclaimer: { type: "string" },
    markdown: { type: "string" },
    reportHash: { type: "string" },
    audit: objectResponse("Reproducibility anchors of the underlying valuation report"),
  },
  additionalProperties: true,
} as const;

const formatQuery = { type: "object", properties: { format: { type: "string", enum: ["json", "md"] } } } as const;

export async function registerDocumentRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: { trade: Trade; reportingCurrency?: string; credit?: CreditInputs }; Querystring: { format?: string } }>(
    "/api/documents/termsheet",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "termsheet",
        tags: ["pricing"],
        summary: "Indikatives Termsheet (JSON mit Abschnitten oder ?format=md als Markdown)",
        body: {
          type: "object",
          required: ["trade"],
          properties: { trade: tradeRef, reportingCurrency: { type: "string", pattern: "^[A-Z]{3}$" }, credit: creditSchema },
          additionalProperties: false,
        },
        querystring: formatQuery,
        response: responses({ 200: jsonOrText(documentSchema, "text/markdown", markdownResponse, "Termsheet (JSON) or Markdown download") }, 400, 413, 422),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const reporting = req.body.reportingCurrency ?? "EUR";
      const pricing = priceTrade(m, trade, reporting);
      const xva = req.body.credit ? computeXva(m, trade, req.body.credit, reporting) : undefined;
      const report = buildValuationReport(m, trade, pricing, { xva });
      const doc = generateTermsheet(m, trade, pricing, report);
      ctx.audit.append({ actor: "api", action: "document.termsheet", subject: trade.id, details: { reportHash: report.audit.reportHash } });
      if (req.query.format === "md") {
        reply.header("content-type", "text/markdown; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${safeFilename(trade.id)}-termsheet.md"`);
        return doc.markdown;
      }
      return datesToIso(doc);
    },
  );

  app.post<{
    Body: { trade: Trade; reportingCurrency?: string; credit?: CreditInputs; suitability: SuitabilityInputs; includeScenarios?: boolean };
    Querystring: { format?: string };
  }>(
    "/api/documents/suitability",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "suitabilityStatement",
        tags: ["pricing"],
        summary: "Geeignetheitserklärung § 64 Abs. 4 WpHG mit Ex-ante-Kostenausweis und Szenarien (JSON oder ?format=md)",
        body: {
          type: "object",
          required: ["trade", "suitability"],
          properties: {
            trade: tradeRef,
            reportingCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
            credit: creditSchema,
            suitability: suitabilitySchema,
            includeScenarios: { type: "boolean" },
          },
          additionalProperties: false,
        },
        querystring: formatQuery,
        response: responses(
          { 200: jsonOrText(documentSchema, "text/markdown", markdownResponse, "Suitability statement (JSON) or Markdown download") },
          400,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const reporting = req.body.reportingCurrency ?? "EUR";
      const pricing = priceTrade(m, trade, reporting);
      const risk = computeRisk(m, trade, reporting, { bucketed: false });
      const xva = req.body.credit ? computeXva(m, trade, req.body.credit, reporting) : undefined;
      const report = buildValuationReport(m, trade, pricing, { risk, xva, transactionPrice: req.body.suitability.transactionPrice });
      const scenarios =
        req.body.includeScenarios === false
          ? undefined
          : runScenarios(
              m,
              [trade],
              STANDARD_SCENARIOS.filter((s) => s.id !== "base"),
              reporting,
            ).results;
      const doc = generateSuitabilityStatement(m, trade, pricing, report, req.body.suitability, scenarios);
      ctx.audit.append({
        actor: "api",
        action: "document.suitability",
        subject: trade.id,
        details: { client: req.body.suitability.clientName, reportHash: report.audit.reportHash },
      });
      if (req.query.format === "md") {
        reply.header("content-type", "text/markdown; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${safeFilename(trade.id)}-geeignetheit.md"`);
        return doc.markdown;
      }
      return datesToIso(doc);
    },
  );

  app.post<{
    Body: {
      trade: Trade;
      reportingCurrency?: string;
      parties: ConfirmationParties;
      masterAgreement: MasterAgreementRef;
      tradeDate?: number;
      confirmationDate?: number;
      reference?: string;
      includeSchedule?: boolean;
    };
    Querystring: { format?: string };
  }>(
    "/api/documents/confirmation",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "confirmation",
        tags: ["pricing"],
        summary:
          "Geschäftsbestätigung (Einzelabschluss unter DRV / ISDA Master Agreement) mit Parteien, Rahmenvertrag, Konditionen und Zahlungsplan (JSON oder ?format=md)",
        body: confirmationBodySchema,
        querystring: formatQuery,
        response: responses({ 200: jsonOrText(documentSchema, "text/markdown", markdownResponse, "Confirmation (JSON) or Markdown download") }, 400, 413, 422),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      // ISO → serial on the trade, `masterAgreement.date`, `tradeDate` and `confirmationDate` (known date keys).
      const body = datesToSerial(req.body);
      const pricing = body.includeSchedule === false ? undefined : priceTrade(m, body.trade, body.reportingCurrency ?? "EUR");
      const doc = generateConfirmation(body.trade, body.parties, body.masterAgreement, m, pricing, {
        tradeDate: body.tradeDate,
        confirmationDate: body.confirmationDate,
        reference: body.reference,
      });
      ctx.audit.append({
        actor: "api",
        action: "document.confirmation",
        subject: body.trade.id,
        details: { masterAgreement: body.masterAgreement.type, client: body.parties.client.name, reference: body.reference },
      });
      if (req.query.format === "md") {
        reply.header("content-type", "text/markdown; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${safeFilename(body.trade.id)}-confirmation.md"`);
        return doc.markdown;
      }
      return datesToIso(doc);
    },
  );

  app.post<{
    Body: {
      trade: Trade;
      reportingCurrency?: string;
      credit?: CreditInputs;
      kid: Omit<KidOptions, "report" | "scenarioSet">;
      scenarios?: ScenarioDefinition[];
      includeHistorical?: boolean;
    };
    Querystring: { format?: string };
  }>(
    "/api/documents/kid",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "keyInformationDocument",
        tags: ["pricing"],
        summary: "Basisinformationsblatt (PRIIPs-KID, VO (EU) 1286/2014): Risikoindikator, Performance-Szenarien, Kosten, Haltedauer (JSON oder ?format=md)",
        description:
          "Summary risk indicator and performance scenarios are heuristics from the deterministic scenario P&L (`scenarios`, default standard set, optionally plus historical episodes); costs come from the valuation report when `kid.transactionPrice` is given.",
        body: kidBodySchema,
        querystring: formatQuery,
        response: responses({ 200: jsonOrText(documentSchema, "text/markdown", markdownResponse, "KID (JSON) or Markdown download") }, 400, 413, 422),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const trade = datesToSerial(req.body.trade);
      const reporting = req.body.reportingCurrency ?? "EUR";
      const pricing = priceTrade(m, trade, reporting);
      const xva = req.body.credit ? computeXva(m, trade, req.body.credit, reporting) : undefined;
      const report = buildValuationReport(m, trade, pricing, { xva, transactionPrice: req.body.kid.transactionPrice, perspective: req.body.kid.perspective });
      const set = req.body.scenarios ?? (req.body.includeHistorical ? [...STANDARD_SCENARIOS, ...HISTORICAL_SCENARIOS] : undefined);
      const scenarios = set
        ? runScenarios(
            m,
            [trade],
            set.filter((s) => s.id !== "base"),
            reporting,
          ).results
        : undefined;
      const doc = generateKid(m, trade, pricing, scenarios, { ...req.body.kid, report });
      ctx.audit.append({
        actor: "api",
        action: "document.kid",
        subject: trade.id,
        details: { manufacturer: req.body.kid.manufacturer, scenarios: scenarios?.length ?? "standard", reportHash: report.audit.reportHash },
      });
      if (req.query.format === "md") {
        reply.header("content-type", "text/markdown; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${safeFilename(trade.id)}-kid.md"`);
        return doc.markdown;
      }
      return datesToIso(doc);
    },
  );
}
