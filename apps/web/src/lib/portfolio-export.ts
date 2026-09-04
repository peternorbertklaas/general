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

/** Confirmation text shown before a what-if (stress) report leaves the workstation (R3-F1 / R3-F6). */
export function whatIfExportQuestion(label: string, what = "Der Report"): string {
  return `${what} enthält What-if-Zahlen (${label}) und ist nicht prüfungsfähig. Trotzdem exportieren?`;
}

/**
 * Download the portfolio report as JSON or Markdown and confirm with a toast.
 * An empty book yields a hint instead of a "0 Trades" file; under an active
 * what-if the user has to confirm (same rule as the valuation report, R3-F6).
 */
export function downloadPortfolioReport(format: PortfolioReportFormat): boolean {
  const st = useStore.getState();
  if (st.trades.length === 0) {
    st.showToast("Kein Trade im Bestand – kein Portfolio-Report");
    return false;
  }
  if (whatIfActive(st.whatIf) && !window.confirm(whatIfExportQuestion(whatIfLabel(st.whatIf), "Der Portfolio-Report"))) return false;
  const report = currentPortfolioReport();
  const base = `portfolio-report-${toISO(st.valuationDate)}${report.whatIf ? "-whatif" : ""}`;
  if (format === "json") downloadText(`${base}.json`, JSON.stringify(report, null, 2), "application/json");
  else downloadText(`${base}.md`, portfolioReportMarkdown(report), "text/markdown;charset=utf-8");
  st.showToast(
    `Portfolio-Report als ${format === "json" ? "JSON" : "Markdown"} exportiert (${report.totals.trades} Trades${report.failed ? `, ${report.failed} ohne Bewertung` : ""}${report.whatIf ? " · What-if" : ""})`,
  );
  return true;
}
