import { type PricingResult, type RiskReport, type Trade } from "@deriva/pricing-core";
import { fmtDate, fmtMoney } from "./format.js";
import { keyMetric, keyMetricLabel, tradeMaturity, tradeNotional } from "./trade-ops.js";
import { TRADE_TYPE_DE } from "./i18n.js";

/**
 * One-line indication text for chat/e-mail, e.g.
 * "Payer-Swap EUR 10Y @ 2,6975 % · PV 0 EUR · DV01 7.260 EUR · Stichtag 03.09.2026".
 */
export function indicationText(
  t: Trade,
  r: PricingResult | undefined,
  risk: RiskReport | undefined,
  reportingCurrency: string,
  valuationDate: number,
  opts: { customer?: boolean } = {},
): string {
  const n = tradeNotional(t);
  const parts: string[] = [];
  parts.push(`${t.name ?? TRADE_TYPE_DE[t.type] ?? t.type} (${t.id})`);
  parts.push(`Nominal ${fmtMoney(n.amount, n.currency)}`);
  parts.push(`bis ${fmtDate(tradeMaturity(t))}`);
  parts.push(`${keyMetricLabel(t)} ${keyMetric(t, r?.analytics)}`);
  parts.push(`PV ${fmtMoney(r?.pv, reportingCurrency)}`);
  if (!opts.customer && risk) parts.push(`DV01 ${fmtMoney(risk.dv01, reportingCurrency)}`);
  if (!opts.customer && t.counterparty) parts.push(`Kontrahent ${t.counterparty}`);
  parts.push(`Stichtag ${fmtDate(valuationDate)}`);
  return parts.join(" · ");
}

/** Copy to clipboard with a fallback for environments without the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
