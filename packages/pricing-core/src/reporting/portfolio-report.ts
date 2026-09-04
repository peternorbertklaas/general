import { parseISO, toISO } from "../dates/date.js";
import { formatDateDe, formatDe } from "../format.js";
import { tradeTypeLabelDe } from "../instruments/labels.js";
import { type Trade, type TradeType } from "../instruments/types.js";
import { type MarketContext } from "../market/market-context.js";
import { priceTrade } from "../pricing/price.js";
import { computeRisk } from "../risk/sensitivities.js";
import { ENGINE_VERSION, hashString, marketSnapshotId, stableStringify } from "./valuation-report.js";

/**
 * Portfolio (book-level) report: PV, parallel DV01, 1-day theta and FX delta
 * per trade, aggregated by counterparty, book and trade type, with totals,
 * warning counts and the same audit anchors as the single-trade valuation
 * report (snapshot id, inputs hash, report hash, engine version). Used by the
 * API's portfolio endpoint and the UI's book overview; `portfolioReportToMarkdown`
 * renders it as a German Markdown document (no ISO dates, decimal comma).
 */
export interface PortfolioReportLine {
  tradeId: string;
  name?: string;
  type: TradeType;
  counterparty?: string;
  book?: string;
  /** PV in reporting currency (NaN when the valuation failed – see `error`). */
  pv: number;
  /** Parallel DV01 (+1bp all rate curves), reporting currency. */
  dv01: number;
  /** 1-day carry-consistent theta, reporting currency (NaN when not computable). */
  theta: number;
  /** PV change per +1 % appreciation of the key's first currency vs the reporting currency. */
  fxDelta: Record<string, number>;
  /** Pricing warnings of the trade (English pricer messages, e.g. MISSING_FIXING). */
  warnings: string[];
  /** Set when the valuation threw; the line then carries NaN measures and is excluded from the totals. */
  error?: string;
}

export interface PortfolioAggregate {
  /** Group key ("–" for trades without counterparty / book). */
  key: string;
  trades: number;
  pv: number;
  dv01: number;
  theta: number;
  fxDelta: Record<string, number>;
  warnings: number;
}

export interface PortfolioReport {
  generatedAt: string;
  /** ISO valuation date (data field; the Markdown rendering uses TT.MM.JJJJ). */
  valuationDate: string;
  reportingCurrency: string;
  /** Market snapshot label / source. */
  market: { label?: string; source?: string };
  lines: PortfolioReportLine[];
  totals: PortfolioAggregate;
  byCounterparty: PortfolioAggregate[];
  byBook: PortfolioAggregate[];
  byType: PortfolioAggregate[];
  /** Number of trades whose valuation failed. */
  failed: number;
  /** Total number of pricing warnings across all trades. */
  warningsCount: number;
  /**
   * Reproducibility anchors: `snapshotId` = `marketSnapshotId(ctx)`;
   * `inputsHash` over the reporting currency, the snapshot id and the trades'
   * ids + versions (a trade's `version` field when present, else a content
   * hash of the trade); `reportHash` over the report content without
   * timestamps.
   */
  audit: { snapshotId: string; inputsHash: string; reportHash: string; engineVersion: string; preparedBy?: string };
}

export interface PortfolioReportOptions {
  /** Compute theta (default true; costs two extra valuations per trade). */
  theta?: boolean;
  /** Compute FX delta per foreign currency (default true). */
  fxDelta?: boolean;
  /** Fixed timestamp for deterministic output (defaults to now). */
  generatedAt?: string;
  preparedBy?: string;
}

function emptyAggregate(key: string): PortfolioAggregate {
  return { key, trades: 0, pv: 0, dv01: 0, theta: 0, fxDelta: {}, warnings: 0 };
}

function addLine(agg: PortfolioAggregate, line: PortfolioReportLine): void {
  agg.trades += 1;
  agg.warnings += line.warnings.length;
  if (line.error) return;
  agg.pv += line.pv;
  agg.dv01 += line.dv01;
  if (Number.isFinite(line.theta)) agg.theta += line.theta;
  for (const [k, v] of Object.entries(line.fxDelta)) agg.fxDelta[k] = (agg.fxDelta[k] ?? 0) + v;
}

function aggregate(lines: PortfolioReportLine[], keyOf: (l: PortfolioReportLine) => string | undefined): PortfolioAggregate[] {
  const map = new Map<string, PortfolioAggregate>();
  for (const l of lines) {
    const key = keyOf(l) ?? "–";
    let agg = map.get(key);
    if (!agg) {
      agg = emptyAggregate(key);
      map.set(key, agg);
    }
    addLine(agg, l);
  }
  // Alphabetical, the unassigned group ("–") last.
  return [...map.values()].sort((a, b) => (a.key === "–" ? 1 : b.key === "–" ? -1 : a.key.localeCompare(b.key)));
}

/** Version identity of a trade for the inputs hash: explicit `version` field when present, else a content hash. */
function tradeVersion(trade: Trade): string | number {
  const v = (trade as { version?: string | number }).version;
  if (typeof v === "string" || typeof v === "number") return v;
  return hashString(stableStringify(trade));
}

/**
 * Value a book and aggregate PV, parallel DV01, theta and FX delta by
 * counterparty, book and trade type. Trades whose valuation throws are kept
 * as lines with `error` and NaN measures (excluded from the aggregates), so
 * one bad trade does not hide the rest of the book. Hashes are deterministic:
 * the same trades on the same snapshot give the same `inputsHash` and
 * `reportHash` (timestamps and timings are excluded).
 */
export function buildPortfolioReport(ctx: MarketContext, trades: Trade[], reportingCurrency: string, opts: PortfolioReportOptions = {}): PortfolioReport {
  const lines: PortfolioReportLine[] = trades.map((t): PortfolioReportLine => {
    const base = { tradeId: t.id, name: t.name, type: t.type, counterparty: t.counterparty, book: t.book };
    try {
      const risk = computeRisk(ctx, t, reportingCurrency, { bucketed: false, vega: false, theta: opts.theta ?? true });
      const pricing = priceTrade(ctx, t, reportingCurrency);
      return {
        ...base,
        pv: risk.pv,
        dv01: risk.dv01,
        theta: (opts.theta ?? true) ? risk.theta : Number.NaN,
        fxDelta: (opts.fxDelta ?? true) ? risk.fxDelta : {},
        warnings: pricing.warnings,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ...base, pv: Number.NaN, dv01: Number.NaN, theta: Number.NaN, fxDelta: {}, warnings: [`Pricing failed: ${message}`], error: message };
    }
  });
  const totals = emptyAggregate("Gesamt");
  for (const l of lines) addLine(totals, l);
  const snapshotId = marketSnapshotId(ctx);
  const inputsHash = hashString(
    stableStringify({
      snapshotId,
      reportingCurrency,
      trades: trades.map((t) => ({ id: t.id, version: tradeVersion(t) })),
    }),
  );
  const report: PortfolioReport = {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    valuationDate: toISO(ctx.valuationDate),
    reportingCurrency,
    market: { label: ctx.meta?.label, source: ctx.meta?.source },
    lines,
    totals,
    byCounterparty: aggregate(lines, (l) => l.counterparty),
    byBook: aggregate(lines, (l) => l.book),
    byType: aggregate(lines, (l) => l.type),
    failed: lines.filter((l) => l.error !== undefined).length,
    warningsCount: lines.reduce((s, l) => s + l.warnings.length, 0),
    audit: { snapshotId, inputsHash, reportHash: "", engineVersion: ENGINE_VERSION, preparedBy: opts.preparedBy },
  };
  report.audit.reportHash = hashString(stableStringify({ ...report, generatedAt: undefined, audit: undefined }));
  return report;
}

const money = (v: number, ccy: string) => (Number.isFinite(v) ? `${formatDe(v, 0)} ${ccy}` : "n/a");

function fxDeltaCell(fx: Record<string, number>): string {
  const entries = Object.entries(fx).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k.slice(0, 3)} ${formatDe(v, 0)}`).join(", ") : "–";
}

function aggregateTable(title: string, rows: PortfolioAggregate[], ccy: string, keyHeader: string): string[] {
  const out = [
    `## ${title}`,
    "",
    `| ${keyHeader} | Geschäfte | Barwert | DV01 | Theta (1 Tag) | FX-Delta (+1 %) | Warnungen |`,
    "|---|---:|---:|---:|---:|---|---:|",
  ];
  for (const r of rows) {
    out.push(`| ${r.key} | ${r.trades} | ${money(r.pv, ccy)} | ${money(r.dv01, ccy)} | ${money(r.theta, ccy)} | ${fxDeltaCell(r.fxDelta)} | ${r.warnings} |`);
  }
  out.push("");
  return out;
}

/** German Markdown rendering of a portfolio report (TT.MM.JJJJ dates, decimal comma, German trade-type labels). */
export function portfolioReportToMarkdown(report: PortfolioReport): string {
  const ccy = report.reportingCurrency;
  const valuationDate = formatDateDe(parseISO(report.valuationDate));
  const out: string[] = [
    "# Portfolio-Bewertungsreport",
    `_Bewertungstag ${valuationDate} · Reporting-Währung ${ccy} · Marktdaten ${report.market.label ?? "–"} (${report.market.source ?? "–"})_`,
    "",
    "## Zusammenfassung",
    "",
    "| | |",
    "|---|---|",
    `| **Geschäfte** | ${report.totals.trades}${report.failed ? ` (davon ${report.failed} nicht bewertbar)` : ""} |`,
    `| **Barwert** | ${money(report.totals.pv, ccy)} |`,
    `| **DV01 (parallel +1 bp)** | ${money(report.totals.dv01, ccy)} |`,
    `| **Theta (1 Tag)** | ${money(report.totals.theta, ccy)} |`,
    `| **FX-Delta (+1 % Fremdwährung)** | ${fxDeltaCell(report.totals.fxDelta)} |`,
    `| **Warnungen** | ${report.warningsCount} |`,
    "",
    ...aggregateTable("Nach Kontrahent", report.byCounterparty, ccy, "Kontrahent"),
    ...aggregateTable("Nach Buch", report.byBook, ccy, "Buch"),
    ...aggregateTable(
      "Nach Produktart",
      report.byType.map((r) => ({ ...r, key: tradeTypeLabelDe(r.key) })),
      ccy,
      "Produktart",
    ),
    "## Einzelgeschäfte",
    "",
    "| Referenz | Bezeichnung | Produktart | Kontrahent | Buch | Barwert | DV01 | Theta | FX-Delta | Warnungen |",
    "|---|---|---|---|---|---:|---:|---:|---|---:|",
  ];
  for (const l of report.lines) {
    out.push(
      `| ${l.tradeId} | ${l.name ?? ""} | ${tradeTypeLabelDe(l.type)} | ${l.counterparty ?? "–"} | ${l.book ?? "–"} | ${money(l.pv, ccy)} | ${money(l.dv01, ccy)} | ${money(l.theta, ccy)} | ${fxDeltaCell(l.fxDelta)} | ${l.error ? "Bewertung fehlgeschlagen" : l.warnings.length} |`,
    );
  }
  out.push(
    "",
    "## Audit",
    "",
    "| | |",
    "|---|---|",
    `| **Snapshot-ID** | ${report.audit.snapshotId} |`,
    `| **Inputs-Hash** | ${report.audit.inputsHash} |`,
    `| **Report-Hash** | ${report.audit.reportHash} |`,
    `| **Engine** | ${report.audit.engineVersion} |`,
    ...(report.audit.preparedBy ? [`| **Erstellt von** | ${report.audit.preparedBy} |`] : []),
    "",
    "---",
    "_Sensitivitäten per Bump-and-Reprice (DV01 zentrale Differenz ±1 bp aller Zinskurven, FX-Delta ±1 % Spot, Theta 1-Tages-Constant-Curve-Roll inkl. Cashflows im Intervall). Nicht bewertbare Geschäfte sind in den Summen nicht enthalten._",
  );
  return out.join("\n");
}
