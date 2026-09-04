import {
  type MarketContext,
  type PortfolioReport as CorePortfolioReport,
  type Trade,
  buildPortfolioReport as coreBuildPortfolioReport,
  portfolioReportToMarkdown,
} from "@deriva/pricing-core";

/**
 * Portfolio report (round-1 F-29): the core's book-level report (PV, DV01,
 * theta, FX delta by counterparty / book / type with snapshot id and hashes),
 * plus the UI concerns – the active what-if shift and the customer view, which
 * drops counterparties, books and DV01 like the blotter does.
 */
export interface PortfolioWhatIf {
  ratesBp: number;
  fxPct: number;
  volBp: number;
  label: string;
}

export interface PortfolioReport extends CorePortfolioReport {
  /** What-if shift the numbers were produced under; absent for an unshifted market (then the report is an audit valuation). */
  whatIf?: PortfolioWhatIf;
  /** True when the customer view stripped counterparties, books and DV01. */
  customerView?: boolean;
}

export interface PortfolioReportOptions {
  generatedAt?: string;
  whatIf?: PortfolioWhatIf;
  /** Customer mode: counterparty / book aggregates and DV01 are omitted. */
  customer?: boolean;
  preparedBy?: string;
}

/** Aggregate without the internal DV01 (customer view). */
function stripDv01<T extends { dv01: number }>(a: T): T {
  return { ...a, dv01: Number.NaN };
}

export function buildPortfolioReport(ctx: MarketContext, trades: Trade[], reportingCurrency: string, opts: PortfolioReportOptions = {}): PortfolioReport {
  const base = coreBuildPortfolioReport(ctx, trades, reportingCurrency, { generatedAt: opts.generatedAt, preparedBy: opts.preparedBy });
  const rep: PortfolioReport = { ...base, ...(opts.whatIf ? { whatIf: opts.whatIf } : {}) };
  if (!opts.customer) return rep;
  return {
    ...rep,
    customerView: true,
    lines: rep.lines.map((l) => stripDv01({ ...l, counterparty: undefined, book: undefined })),
    totals: stripDv01(rep.totals),
    byCounterparty: [],
    byBook: [],
    byType: rep.byType.map(stripDv01),
  };
}

const INTERNAL_COLUMN = /DV01|Kontrahent|Buch/;

/**
 * Drop Markdown table columns whose header cell matches `INTERNAL_COLUMN`
 * (header, separator and body rows of the same table) and the summary rows of
 * internal measures.
 */
function stripInternalColumns(md: string): string {
  const out: string[] = [];
  let drop: number[] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) {
      drop = [];
      out.push(line);
      continue;
    }
    if (/^\|\s*\*\*DV01/.test(line)) continue;
    const cells = line.split("|");
    if (drop.length === 0 && cells.some((c) => INTERNAL_COLUMN.test(c)) && !/---/.test(line)) {
      drop = cells.map((c, i) => (INTERNAL_COLUMN.test(c) ? i : -1)).filter((i) => i >= 0);
    }
    out.push(drop.length ? cells.filter((_, i) => !drop.includes(i)).join("|") : line);
  }
  return out.join("\n");
}

/**
 * German Markdown of the report (core rendering) with the what-if warning on
 * top and, for the customer view, without the counterparty / book sections and
 * the DV01 figures – a customer never sees internal risk numbers.
 */
export function portfolioReportMarkdown(rep: PortfolioReport): string {
  let md = portfolioReportToMarkdown(rep);
  if (rep.customerView) {
    md = md
      .split(/\n(?=## )/)
      .filter((sec) => !/^## Nach (Kontrahent|Buch)/.test(sec))
      .join("\n");
    md = stripInternalColumns(md).replace(/DV01 zentrale Differenz [^,)]*,\s*/g, "");
  }
  if (rep.whatIf) md = md.replace(/\n/, `\n\n**WHAT-IF ${rep.whatIf.label} – Stress-Zahlen, nicht prüfungsfähig.**\n`);
  return md;
}
