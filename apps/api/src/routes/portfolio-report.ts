import { type FastifyInstance } from "fastify";
import { type PortfolioReport, type Trade, buildPortfolioReport, portfolioReportToMarkdown } from "@deriva/pricing-core";
import { type AppContext } from "../app.js";
import { datesToIso, datesToSerial } from "../lib/dates.js";
import { safeFilename } from "../lib/store.js";
import {
  type PortfolioGrouping,
  PORTFOLIO_GROUPINGS,
  jsonOrText,
  markdownResponse,
  portfolioReportBodySchema,
  portfolioReportSchema,
  responses,
} from "../schemas.js";

interface PortfolioReportBody {
  /** Trades to report on; default: the trade store. */
  trades?: Trade[];
  reportingCurrency?: string;
  /** Aggregations to include; default: all three. */
  groupBy?: PortfolioGrouping[];
  theta?: boolean;
  fxDelta?: boolean;
  preparedBy?: string;
}

/** Aggregate field and Markdown heading (rendered by the core) per grouping. */
const GROUPINGS: Record<PortfolioGrouping, { field: "byCounterparty" | "byBook" | "byType"; heading: string }> = {
  counterparty: { field: "byCounterparty", heading: "## Nach Kontrahent" },
  book: { field: "byBook", heading: "## Nach Buch" },
  type: { field: "byType", heading: "## Nach Produktart" },
};

/** Groupings that were not requested (empty when `groupBy` is omitted = everything). */
function omittedGroupings(groupBy: PortfolioGrouping[] | undefined): PortfolioGrouping[] {
  if (!groupBy) return [];
  return PORTFOLIO_GROUPINGS.filter((g) => !groupBy.includes(g));
}

/**
 * Drop the Markdown sections (a `## ` heading up to the next `## ` heading) of
 * the aggregations that were not requested. The core renders all three tables;
 * trimming here keeps the report hash (computed over the full report) intact.
 */
function dropSections(md: string, headings: string[]): string {
  if (headings.length === 0) return md;
  const out: string[] = [];
  let skipping = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) skipping = headings.includes(line);
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

/**
 * Book-level valuation report (`buildPortfolioReport`): PV, DV01, theta and FX
 * delta per trade with aggregates by counterparty, book and trade type. Trades
 * whose valuation fails stay in `lines` with `error` (excluded from the
 * aggregates), so one bad trade does not hide the rest of the book. The report
 * is deterministic per market snapshot (`audit.inputsHash` / `reportHash`) and
 * available as German Markdown (`?format=md`).
 */
export async function registerPortfolioReportRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: PortfolioReportBody; Querystring: { format?: string } }>(
    "/api/report/portfolio",
    {
      config: { marketHeader: true },
      schema: {
        operationId: "portfolioReport",
        tags: ["pricing"],
        summary:
          "Portfolio-Bewertungsreport (Buchebene): PV, DV01, Theta, FX-Delta je Trade und aggregiert nach Kontrahent / Buch / Produktart (JSON oder ?format=md)",
        description:
          "Body trades default to the trade store. Failed valuations are kept as lines with `error` (NaN measures serialised as null) and excluded from the totals. `groupBy` restricts the aggregations in the response (JSON: the others are empty arrays; Markdown: their sections are omitted); `audit.reportHash` covers the full report and does not depend on `groupBy`.",
        body: portfolioReportBodySchema,
        querystring: { type: "object", properties: { format: { type: "string", enum: ["json", "md"] } } },
        response: responses(
          { 200: jsonOrText(portfolioReportSchema, "text/markdown", markdownResponse, "Portfolio report (JSON) or Markdown download") },
          400,
          413,
          422,
        ),
      },
    },
    async (req, reply) => {
      const m = ctx.market.get();
      const trades = req.body.trades ? datesToSerial(req.body.trades) : ctx.trades.list().map((t) => t.trade);
      const reporting = req.body.reportingCurrency ?? "EUR";
      const report = buildPortfolioReport(m, trades, reporting, { theta: req.body.theta, fxDelta: req.body.fxDelta, preparedBy: req.body.preparedBy });
      const omitted = omittedGroupings(req.body.groupBy);
      ctx.audit.append({
        actor: "api",
        action: "report.portfolio",
        subject: "portfolio",
        details: {
          trades: trades.length,
          failed: report.failed,
          reportingCurrency: reporting,
          reportHash: report.audit.reportHash,
          snapshotId: report.audit.snapshotId,
          ...(req.body.groupBy ? { groupBy: req.body.groupBy } : {}),
        },
      });
      if (req.query.format === "md") {
        reply.header("content-type", "text/markdown; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="portfolio-${safeFilename(report.audit.snapshotId)}-report.md"`);
        return dropSections(
          portfolioReportToMarkdown(report),
          omitted.map((g) => GROUPINGS[g].heading),
        );
      }
      const trimmed: PortfolioReport & { groupBy?: PortfolioGrouping[] } = { ...report };
      for (const g of omitted) trimmed[GROUPINGS[g].field] = [];
      if (req.body.groupBy) trimmed.groupBy = req.body.groupBy;
      return datesToIso(trimmed);
    },
  );
}
