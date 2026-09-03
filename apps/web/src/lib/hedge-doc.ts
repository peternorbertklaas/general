import { type HedgeEffectivenessReport, type HedgeRelationship, type Trade } from "@deriva/pricing-core";
import { fmtDate, fmtMoney, fmtNum, fmtPct } from "./format.js";
import { TRADE_TYPE_DE, germanizeText } from "./i18n.js";

const TYPE_DE: Record<string, string> = { CashFlowHedge: "Cash Flow Hedge", FairValueHedge: "Fair Value Hedge" };
const METHOD_DE: Record<string, string> = { DollarOffset: "Dollar-Offset", Regression: "Regression", CriticalTerms: "Critical-Terms-Match" };
const FRAMEWORK_DE: Record<string, string> = { IFRS9: "IFRS 9", HGB: "HGB § 254" };
const KIND_DE: Record<string, string> = {
  FloatingRateLoan: "Variabel verzinster Kredit",
  FixedRateLoan: "Festzinskredit",
  ForecastFxCashflow: "Erwarteter FX-Cashflow",
  FxReceivable: "FX-Forderung / -Verbindlichkeit",
};

const row = (k: string, v: string) => `| ${k} | ${v} |`;
const verdict = (r: { assessable: boolean; effective: boolean } | undefined) =>
  !r ? "–" : !r.assessable ? "nicht beurteilbar" : r.effective ? "effektiv" : "nicht effektiv";

/**
 * Hedge documentation (IFRS 9 6.4.1 / IDW RS HFA 35) as Markdown: relationship,
 * hedged item, hedging instrument, method, test results and accounting split.
 * Numbers in German format; the core summary lines are germanised (N-20).
 */
export function hedgeDocMarkdown(
  rel: HedgeRelationship,
  trade: Trade,
  rep: HedgeEffectivenessReport | null,
  opts: { valuationDate: number; ccy: string; generatedAt?: string },
): string {
  const item = rel.hedgedItem;
  const lines: string[] = [];
  lines.push(`# Sicherungsdokumentation – ${rel.name}`);
  lines.push("");
  lines.push(
    `Erstellt ${opts.generatedAt ?? new Date().toLocaleString("de-DE")} · Bewertungstag ${fmtDate(opts.valuationDate)} · Reporting-Währung ${opts.ccy}`,
  );
  lines.push("");
  lines.push("## Sicherungsbeziehung");
  lines.push("");
  lines.push("| Merkmal | Wert |");
  lines.push("|---|---|");
  lines.push(row("ID", rel.id));
  lines.push(row("Art", TYPE_DE[rel.type] ?? rel.type));
  lines.push(row("Rechnungslegung", FRAMEWORK_DE[rel.accountingFramework] ?? rel.accountingFramework));
  lines.push(row("Effektivitätsmethode", METHOD_DE[rel.method] ?? rel.method));
  lines.push(row("Designationsdatum", fmtDate(rel.designationDate)));
  lines.push(row("Hedge Ratio", fmtPct(rel.hedgeRatio ?? 1, 2)));
  lines.push("");
  lines.push("## Grundgeschäft");
  lines.push("");
  lines.push("| Merkmal | Wert |");
  lines.push("|---|---|");
  lines.push(row("Beschreibung", item.description || "–"));
  lines.push(row("Art", KIND_DE[item.kind] ?? item.kind));
  lines.push(row("Nominal", fmtMoney(item.notional, item.currency)));
  if (item.amount !== undefined) lines.push(row("Betrag", fmtMoney(item.amount, item.currency)));
  if (item.index) lines.push(row("Index", item.index));
  if (item.fixedRate !== undefined) lines.push(row("Kupon", fmtPct(item.fixedRate, 3)));
  if (item.fxPair) lines.push(row("Währungspaar", `${item.fxPair.slice(0, 3)}/${item.fxPair.slice(3)}`));
  lines.push(row("Laufzeit", `${fmtDate(item.effectiveDate)} – ${fmtDate(item.maturityDate)}`));
  lines.push("");
  lines.push("## Sicherungsinstrument");
  lines.push("");
  lines.push("| Merkmal | Wert |");
  lines.push("|---|---|");
  lines.push(row("Trade", `${trade.id}${trade.name ? ` · ${trade.name}` : ""}`));
  lines.push(row("Typ", TRADE_TYPE_DE[trade.type] ?? trade.type));
  if (trade.counterparty) lines.push(row("Kontrahent", trade.counterparty));
  lines.push("");
  if (rep) {
    lines.push("## Effektivitätstest");
    lines.push("");
    lines.push(`**Ergebnis nach designierter Methode (${METHOD_DE[rep.method] ?? rep.method}): ${verdict(rep)}.**`);
    lines.push("");
    lines.push("| Test | Ergebnis | Kennzahl |");
    lines.push("|---|---|---|");
    lines.push(
      `| Critical Terms | ${rep.criticalTerms.matches ? "übereinstimmend" : "Abweichung"} | ${rep.criticalTerms.checks.filter((c) => c.applicable && c.match).length}/${rep.criticalTerms.checks.filter((c) => c.applicable).length} Merkmale |`,
    );
    if (rep.dollarOffsetProspective)
      lines.push(
        `| Dollar-Offset prospektiv | ${verdict(rep.dollarOffsetProspective)} | ${rep.dollarOffsetProspective.ratio !== undefined ? fmtPct(rep.dollarOffsetProspective.ratio, 1) : "–"} |`,
      );
    if (rep.dollarOffsetCumulative)
      lines.push(
        `| Dollar-Offset kumulativ | ${verdict(rep.dollarOffsetCumulative)} | ${rep.dollarOffsetCumulative.ratio !== undefined ? fmtPct(rep.dollarOffsetCumulative.ratio, 1) : "–"} |`,
      );
    if (rep.regression)
      lines.push(
        `| Regression | ${verdict(rep.regression)} | Steigung ${rep.regression.slope !== undefined ? fmtNum(rep.regression.slope, 3) : "–"} · R² ${rep.regression.r2 !== undefined ? fmtNum(rep.regression.r2, 3) : "–"} · n = ${rep.regression.n} |`,
      );
    lines.push("");
    lines.push("### Barwerte");
    lines.push("");
    lines.push("| Position | Wert |");
    lines.push("|---|---|");
    lines.push(row("PV Sicherungsinstrument", fmtMoney(rep.hedgingInstrument.pv, opts.ccy)));
    lines.push(row("PV hypothetisches Derivat", fmtMoney(rep.hypotheticalDerivative.pv, opts.ccy)));
    lines.push("");
    lines.push(`### ${rep.accountingFramework === "IFRS9" ? "IFRS 9 – Buchung" : "HGB § 254 – Bewertungseinheit"}`);
    lines.push("");
    lines.push("| Position | Betrag |");
    lines.push("|---|---|");
    lines.push(row("Δ Sicherungsinstrument (kumuliert)", fmtMoney(rep.ifrs9.hedgingInstrumentChange, opts.ccy)));
    lines.push(row("Δ Grundgeschäft (gesichertes Risiko)", fmtMoney(rep.ifrs9.hedgedItemChange, opts.ccy)));
    lines.push(row("Effektiver Teil", fmtMoney(rep.ifrs9.effectivePortion, opts.ccy)));
    lines.push(row("IFRS 9 · OCI", fmtMoney(rep.ifrs9.oci, opts.ccy)));
    lines.push(row("IFRS 9 · GuV (Ineffektivität)", fmtMoney(rep.ifrs9.pnl, opts.ccy)));
    lines.push(row("HGB · kompensierter Teil", fmtMoney(rep.hgb.effectiveNetted, opts.ccy)));
    lines.push(row("HGB · ineffektiver Überhang", fmtMoney(rep.hgb.ineffectiveExcess, opts.ccy)));
    lines.push(row("Drohverlustrückstellung (§ 249 HGB)", fmtMoney(rep.hgb.drohverlustrueckstellung, opts.ccy)));
    lines.push("");
    lines.push("## Zusammenfassung");
    lines.push("");
    for (const l of rep.summary) lines.push(`- ${germanizeText(l)}`);
    if (rep.warnings.length) {
      lines.push("");
      lines.push("### Hinweise");
      lines.push("");
      for (const w of rep.warnings) lines.push(`- ${germanizeText(w)}`);
    }
  } else {
    lines.push("## Effektivitätstest");
    lines.push("");
    lines.push("_Noch nicht durchgeführt._");
  }
  lines.push("");
  lines.push(
    "_Diese Dokumentation wurde mit DERIVA erzeugt und ist Bestandteil der Sicherungsdokumentation nach IFRS 9 6.4.1(b) bzw. § 254 HGB i. V. m. IDW RS HFA 35._",
  );
  return lines.join("\n");
}
