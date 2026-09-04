import { toISO } from "@deriva/pricing-core";
import { useStore, whatIfActive, whatIfLabel } from "../state/store.js";
import { downloadText } from "./portfolio-io.js";
import { buildPortfolioReport, portfolioReportMarkdown, type PortfolioReport } from "./portfolio-report.js";

export type PortfolioReportFormat = "json" | "md";

/** Portfolio report over the visible blotter order (or all trades) from the current store state. */
export function currentPortfolioReport(): PortfolioReport {
  const st = useStore.getState();
  const order = st.visibleIds.length ? st.visibleIds : st.trades.map((t) => t.id);
  const trades = order.map((id) => st.trades.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => t !== undefined);
  const wi = whatIfActive(st.whatIf) ? { ...st.whatIf, label: whatIfLabel(st.whatIf) } : undefined;
  return buildPortfolioReport(st.market, trades, st.reportingCurrency, { whatIf: wi, customer: st.customerMode });
}

/** Download the portfolio report as JSON or Markdown and confirm with a toast. */
export function downloadPortfolioReport(format: PortfolioReportFormat): void {
  const st = useStore.getState();
  const report = currentPortfolioReport();
  const base = `portfolio-report-${toISO(st.valuationDate)}${report.whatIf ? "-whatif" : ""}`;
  if (format === "json") downloadText(`${base}.json`, JSON.stringify(report, null, 2), "application/json");
  else downloadText(`${base}.md`, portfolioReportMarkdown(report), "text/markdown;charset=utf-8");
  st.showToast(
    `Portfolio-Report als ${format === "json" ? "JSON" : "Markdown"} exportiert (${report.totals.trades} Trades${report.failed ? `, ${report.failed} ohne Bewertung` : ""})`,
  );
}
