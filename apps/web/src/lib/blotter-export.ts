import { type MarketContext, type Trade, computeRisk, toISO } from "@deriva/pricing-core";
import { type PricedTrade, LS_KEYS, readLocal, writeLocal } from "../state/store.js";
import { translateCoreMessage } from "./i18n.js";
import { tradeMaturity, tradeNotional, tradeTypeBadge } from "./trade-ops.js";

export type BlotterColKey = "id" | "type" | "name" | "cpty" | "book" | "notional" | "maturity" | "pv" | "dv01" | "status" | "valuation";

export interface BlotterColumn {
  key: BlotterColKey;
  label: string;
  /** Hidden in customer mode. */
  internal?: boolean;
  num?: boolean;
  sortable?: boolean;
  /** Not shown unless the user enables it in the column chooser. */
  optional?: boolean;
}

export const BLOTTER_COLUMNS: BlotterColumn[] = [
  { key: "id", label: "ID", sortable: true },
  { key: "type", label: "Typ", sortable: true },
  { key: "name", label: "Bezeichnung" },
  { key: "cpty", label: "Kontrahent", internal: true, sortable: true },
  { key: "book", label: "Buch", internal: true, sortable: true, optional: true },
  { key: "notional", label: "Nominal", num: true, sortable: true },
  { key: "maturity", label: "Fälligkeit", sortable: true },
  { key: "pv", label: "PV", num: true, sortable: true },
  { key: "dv01", label: "DV01", num: true, internal: true, sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "valuation", label: "Bewertung" },
];

export const DEFAULT_BLOTTER_COLUMNS: BlotterColKey[] = BLOTTER_COLUMNS.filter((c) => !c.optional).map((c) => c.key);

export function readBlotterColumns(): BlotterColKey[] {
  try {
    const raw = readLocal(LS_KEYS.blotterColumns);
    if (!raw) return DEFAULT_BLOTTER_COLUMNS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_BLOTTER_COLUMNS;
    const valid = parsed.filter((k): k is BlotterColKey => BLOTTER_COLUMNS.some((c) => c.key === k));
    return valid.includes("id") ? valid : ["id", ...valid];
  } catch {
    return DEFAULT_BLOTTER_COLUMNS;
  }
}

export function writeBlotterColumns(cols: BlotterColKey[]): void {
  writeLocal(LS_KEYS.blotterColumns, JSON.stringify(cols));
}

export interface BlotterRow {
  t: Trade;
  pv?: number;
  dv01?: number;
  notional: number;
  ccy: string;
  maturity: number;
  error?: string;
  warnings: string[];
}

export function buildBlotterRows(trades: Trade[], results: Record<string, PricedTrade>, market: MarketContext, reportingCurrency: string): BlotterRow[] {
  return trades.map((t) => {
    const r = results[t.id];
    let dv01: number | undefined;
    // Invalid trades (error-level validation, N-21) are not priced and carry no risk.
    if (r?.result && !r.error) {
      try {
        dv01 = computeRisk(market, t, reportingCurrency, { bucketed: false, vega: false, theta: false }).dv01;
      } catch {
        dv01 = undefined;
      }
    }
    const n = tradeNotional(t);
    return {
      t,
      pv: r?.result?.pv,
      dv01,
      notional: n.amount,
      ccy: n.currency,
      maturity: tradeMaturity(t),
      error: r?.error,
      warnings: r?.result?.warnings ?? [],
    };
  });
}

export type GroupKey = "none" | "cpty" | "book" | "type";
export const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "–" },
  { key: "cpty", label: "Kontrahent" },
  { key: "book", label: "Buch" },
  { key: "type", label: "Typ" },
];

export interface BlotterGroup {
  key: string;
  label: string;
  rows: BlotterRow[];
  pv: number;
  dv01: number;
}

/** Group rows (in their current order) with PV/DV01 subtotals (Markt N19). */
export function groupBlotterRows(rows: BlotterRow[], by: GroupKey): BlotterGroup[] {
  if (by === "none") return [{ key: "all", label: "", rows, pv: sum(rows, "pv"), dv01: sum(rows, "dv01") }];
  const labelOf = (r: BlotterRow): string => {
    if (by === "cpty") return r.t.counterparty?.trim() || "ohne Kontrahent";
    if (by === "book") return r.t.book?.trim() || "ohne Buch";
    return tradeTypeBadge(r.t.type).label;
  };
  const map = new Map<string, BlotterRow[]>();
  for (const r of rows) {
    const k = labelOf(r);
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return [...map.entries()].map(([k, list]) => ({ key: k, label: k, rows: list, pv: sum(list, "pv"), dv01: sum(list, "dv01") }));
}

function sum(rows: BlotterRow[], k: "pv" | "dv01"): number {
  return rows.reduce((x, r) => x + (r[k] ?? 0), 0);
}

const num = (v: number | undefined, digits: number) => (v === undefined || !Number.isFinite(v) ? "" : v.toFixed(digits).replace(".", ","));
const cell = (v: string | undefined) => {
  const s = v ?? "";
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Blotter CSV with the visible columns (German Excel flavour: BOM, semicolon, decimal comma). */
export function blotterCsv(rows: BlotterRow[], cols: BlotterColKey[], reportingCurrency: string, opts: { customer?: boolean } = {}): string {
  const visible = BLOTTER_COLUMNS.filter((c) => cols.includes(c.key) && !(opts.customer && c.internal));
  const header = visible.map((c) => (c.key === "pv" ? `PV ${reportingCurrency}` : c.key === "dv01" ? `DV01 ${reportingCurrency}` : c.label));
  const line = (r: BlotterRow) =>
    visible
      .map((c) => {
        switch (c.key) {
          case "id":
            return cell(r.t.id);
          case "type":
            return cell(tradeTypeBadge(r.t.type).label);
          case "name":
            return cell(r.t.name);
          case "cpty":
            return cell(r.t.counterparty);
          case "book":
            return cell(r.t.book);
          case "notional":
            return `${num(r.notional, 2)};${r.ccy}`;
          case "maturity":
            return toISO(r.maturity);
          case "pv":
            return num(r.pv, 2);
          case "dv01":
            return num(r.dv01, 2);
          case "status":
            return cell(r.t.status ?? "Indication");
          case "valuation":
            return cell(r.error ? `Fehler: ${translateCoreMessage(r.error)}` : r.warnings.map(translateCoreMessage).join(" | ") || "OK");
        }
      })
      .join(";");
  const head = header.flatMap((h, i) => (visible[i]!.key === "notional" ? [h, "Währung"] : [h])).join(";");
  return `\uFEFF${[head, ...rows.map(line)].join("\r\n")}\r\n`;
}
