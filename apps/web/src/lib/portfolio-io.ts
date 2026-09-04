import {
  type Trade,
  addTenor,
  annuityAmortisationSchedule,
  makeAmortisingSwap,
  makeBasisSwap,
  makeCapFloor,
  makeCrossCurrencySwap,
  makeFra,
  makeFxForward,
  makeFxOption,
  makeFxSwap,
  makeImmSwap,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
  toISO,
} from "@deriva/pricing-core";
import { parseDateInput } from "./date-parse.js";
import { parseNumberInput } from "./num-parse.js";
import { ccsCollateralCurrency } from "./templates.js";
import { hasErrors, validateTrade } from "./validate-trade.js";

/**
 * Portfolio export/import helpers. Trades carry serial dates internally; the
 * JSON interchange format uses ISO strings on every key ending in "Date"/"date"
 * (effectiveDate, terminationDate, notionalSchedule[].date, upfront.date, ...).
 */
const DATE_KEY = /[Dd]ate$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function walk(v: unknown, convert: (key: string, value: unknown) => unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => walk(x, convert));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const converted = DATE_KEY.test(k) ? convert(k, val) : val;
      out[k] = converted === val ? walk(val, convert) : converted;
    }
    return out;
  }
  return v;
}

/** Serial dates → ISO strings on all `*Date`/`date` keys (deep). */
export function datesToIso<T>(v: T): unknown {
  return walk(v, (_k, val) => (typeof val === "number" && Number.isFinite(val) ? toISO(val) : val));
}

/** ISO strings → serial dates on all `*Date`/`date` keys (deep). */
export function datesFromIso(v: unknown): unknown {
  return walk(v, (_k, val) => (typeof val === "string" && ISO_DATE.test(val) ? parseISO(val) : val));
}

export function tradesToJson(trades: Trade[]): string {
  return JSON.stringify(datesToIso(trades), null, 2);
}

/**
 * German message for a failed JSON import (R4-F1): a `SyntaxError` of `JSON.parse`
 * becomes "Datei ist kein gültiges DERIVA-JSON (Zeile x, Spalte y) …" instead of
 * the raw engine text; other errors keep their (translated) message.
 */
export function jsonImportError(e: unknown): string {
  if (e instanceof SyntaxError) {
    const m = /line (\d+) column (\d+)/i.exec(e.message);
    const where = m ? ` (Zeile ${m[1]}, Spalte ${m[2]})` : "";
    return `Datei ist kein gültiges DERIVA-JSON${where} – erwartet wird ein Export aus „Portfolio als JSON“ oder „Portfolio-Report (JSON)“`;
  }
  return e instanceof Error ? e.message : String(e);
}

export function tradesFromJson(text: string): Trade[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { trades?: unknown }).trades)
      ? (parsed as { trades: unknown[] }).trades
      : null;
  if (!list) throw new Error("Datei enthält keine Trade-Liste – erwartet wird ein Array von Trades oder ein Objekt mit „trades“ (Export „Portfolio als JSON“)");
  return datesFromIso(list) as Trade[];
}

export interface PortfolioCsvRow {
  id: string;
  type: string;
  name?: string;
  counterparty?: string;
  notional: number;
  currency: string;
  /** Serial date. */
  maturity: number;
  pv?: number;
  dv01?: number;
}

/** German Excel flavour: BOM, semicolon separator, decimal comma. */
export function portfolioCsv(rows: PortfolioCsvRow[], opts: { includeInternal?: boolean } = {}): string {
  const internal = opts.includeInternal ?? true;
  const num = (v: number | undefined, digits: number) => (v === undefined || !Number.isFinite(v) ? "" : v.toFixed(digits).replace(".", ","));
  const cell = (v: string | undefined) => {
    const s = v ?? "";
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["id", "type", "name", ...(internal ? ["counterparty"] : []), "notional", "currency", "maturity", "pv", ...(internal ? ["dv01"] : [])];
  const lines = rows.map((r) =>
    [
      cell(r.id),
      cell(r.type),
      cell(r.name),
      ...(internal ? [cell(r.counterparty)] : []),
      num(r.notional, 2),
      cell(r.currency),
      toISO(r.maturity),
      num(r.pv, 2),
      ...(internal ? [num(r.dv01, 2)] : []),
    ].join(";"),
  );
  return `\uFEFF${[header.join(";"), ...lines].join("\r\n")}\r\n`;
}

/* ---------------------------------------------------------------------- */
/*  CSV trade import with column mapping (Markt N16)                        */
/* ---------------------------------------------------------------------- */

/** Canonical column names of the import CSV; `mapping` renames header cells to these. */
export type CsvColumn =
  | "type"
  | "id"
  | "name"
  | "counterparty"
  | "book"
  | "currency"
  | "notional"
  | "direction"
  | "rate"
  | "start"
  | "maturity"
  | "index"
  | "frequency"
  | "pair"
  | "buyCurrency"
  | "buyAmount"
  | "sellCurrency"
  | "sellAmount"
  | "deliveryDate"
  | "capFloor"
  | "strike"
  | "floorStrike"
  | "expiry"
  | "tenor"
  | "optionType"
  | "spread"
  | "fxSpot"
  | "period"
  | "collateral"
  | "status"
  // Markt R6-2: FX swap, tenor-basis swap, amortising swap, IMM swap, step-up coupons
  | "baseAmount"
  | "nearRate"
  | "farRate"
  | "nearDate"
  | "farDate"
  | "receiveIndex"
  | "payIndex"
  | "finalNotional"
  | "amortisation"
  | "stepUp"
  | "from"
  // FX option barrier (API column names): type, level, rebate, knock state
  | "barrierType"
  | "barrierLevel"
  | "barrierRebate"
  | "barrierHit";

export type CsvTradeType = "IRS" | "FXF" | "CAP" | "SWPT" | "FXO" | "CCS" | "FRA" | "FXS" | "BASIS" | "AMORT" | "IMM";
export const CSV_TRADE_TYPES: CsvTradeType[] = ["IRS", "FXF", "CAP", "SWPT", "FXO", "CCS", "FRA", "FXS", "BASIS", "AMORT", "IMM"];

export interface CsvTemplate {
  type: CsvTradeType;
  label: string;
  columns: CsvColumn[];
  /** One example row in the column order. */
  example: string[];
}

/** Column templates per trade type – downloadable from the blotter as a starting point. */
export const CSV_IMPORT_TEMPLATES: Record<CsvTradeType, CsvTemplate> = {
  IRS: {
    type: "IRS",
    label: "Zinsswap",
    // `stepUp` (Markt R6-2): coupon steps "Datum:Satz|Datum:Satz" – the fixed leg pays `rate` until the first step date.
    columns: [
      "type",
      "id",
      "name",
      "counterparty",
      "book",
      "currency",
      "notional",
      "direction",
      "rate",
      "start",
      "maturity",
      "index",
      "frequency",
      "stepUp",
      "status",
    ],
    example: [
      "IRS",
      "IRS-1001",
      "Payer-Swap Kredit A",
      "Landesbank A",
      "Treasury",
      "EUR",
      "10000000",
      "Pay",
      "3,10 %",
      "2026-09-07",
      "10Y",
      "EURIBOR-6M",
      "1Y",
      "2027-09-07:3,30 %|2028-09-07:3,50 %",
      "Live",
    ],
  },
  FXF: {
    type: "FXF",
    label: "FX-Forward",
    columns: ["type", "id", "name", "counterparty", "book", "buyCurrency", "buyAmount", "sellCurrency", "sellAmount", "deliveryDate", "status"],
    example: ["FXF", "FXF-1001", "Kauf USD Wareneinkauf", "Commerzbank", "Einkauf", "USD", "2345000", "EUR", "2000000", "2027-03-15", "Live"],
  },
  CAP: {
    type: "CAP",
    label: "Cap / Floor / Collar",
    columns: [
      "type",
      "id",
      "name",
      "counterparty",
      "book",
      "currency",
      "notional",
      "capFloor",
      "strike",
      "floorStrike",
      "start",
      "maturity",
      "index",
      "status",
    ],
    example: [
      "CAP",
      "CAP-1001",
      "Cap Betriebsmittelkredit",
      "DZ BANK",
      "Treasury",
      "EUR",
      "8000000",
      "Cap",
      "3,00 %",
      "",
      "2026-09-07",
      "5Y",
      "EURIBOR-6M",
      "Live",
    ],
  },
  SWPT: {
    type: "SWPT",
    label: "Swaption",
    columns: ["type", "id", "name", "counterparty", "book", "currency", "notional", "direction", "strike", "expiry", "tenor", "status"],
    example: ["SWPT", "SWPT-1001", "Payer-Swaption 1Y×5Y", "Landesbank A", "Treasury", "EUR", "10000000", "Payer", "3,00 %", "1Y", "5Y", "Live"],
  },
  FXO: {
    type: "FXO",
    label: "FX-Option",
    // Barrier columns (API names, core R6): `barrierType` UpOut/UpIn/DownOut/DownIn, `barrierLevel`, optional `barrierRebate`, `barrierHit` ja/nein (empty = unknown).
    columns: [
      "type",
      "id",
      "name",
      "counterparty",
      "book",
      "pair",
      "optionType",
      "notional",
      "strike",
      "expiry",
      "barrierType",
      "barrierLevel",
      "barrierRebate",
      "barrierHit",
      "status",
    ],
    example: [
      "FXO",
      "FXO-1001",
      "EUR-Put/USD-Call Wareneinkauf",
      "Commerzbank",
      "Einkauf",
      "EURUSD",
      "Put",
      "3000000",
      "1,1500",
      "2027-06-15",
      "",
      "",
      "",
      "",
      "Live",
    ],
  },
  CCS: {
    type: "CCS",
    label: "Cross-Currency-Swap",
    // `collateral`: CSA currency (empty = market default – quote currency; `none` = unsecured), Markt R5-3.
    columns: [
      "type",
      "id",
      "name",
      "counterparty",
      "book",
      "pair",
      "notional",
      "spread",
      "rate",
      "fxSpot",
      "direction",
      "start",
      "maturity",
      "collateral",
      "status",
    ],
    example: [
      "CCS",
      "CCS-1001",
      "CCS EUR/USD 5Y",
      "Commerzbank",
      "USD-Finanzierung",
      "EURUSD",
      "10000000",
      "-20",
      "",
      "1,17",
      "Receive",
      "2026-09-07",
      "5Y",
      "USD",
      "Live",
    ],
  },
  FRA: {
    type: "FRA",
    label: "FRA",
    columns: ["type", "id", "name", "counterparty", "book", "currency", "notional", "direction", "rate", "period", "start", "maturity", "index", "status"],
    example: ["FRA", "FRA-1001", "FRA EUR 3x6", "DZ BANK", "Liquidität", "EUR", "10000000", "Pay", "2,20 %", "3x6", "", "", "EURIBOR-3M", "Live"],
  },
  // Markt R6-2: the four product types that had no template
  FXS: {
    type: "FXS",
    label: "FX-Swap",
    // `baseAmount` positive = buy the base currency near / sell it far; `nearDate` empty = spot.
    columns: ["type", "id", "name", "counterparty", "book", "pair", "baseAmount", "nearRate", "farRate", "nearDate", "farDate", "status"],
    example: [
      "FXS",
      "FXS-1001",
      "FX-Swap EUR/USD Prolongation",
      "Commerzbank",
      "Liquidität",
      "EURUSD",
      "1000000",
      "1,1625",
      "1,1800",
      "2026-09-07",
      "2027-09-07",
      "Live",
    ],
  },
  BASIS: {
    type: "BASIS",
    label: "Tenor-Basis-Swap",
    // `spread` in bp on the receive leg (values ≥ 1 are bp, smaller ones decimals).
    columns: ["type", "id", "name", "counterparty", "book", "currency", "notional", "receiveIndex", "payIndex", "spread", "start", "maturity", "status"],
    example: [
      "BASIS",
      "BASIS-1001",
      "Basis-Swap 3M/6M",
      "Landesbank A",
      "Treasury",
      "EUR",
      "10000000",
      "EURIBOR-3M",
      "EURIBOR-6M",
      "5",
      "2026-09-07",
      "5Y",
      "Live",
    ],
  },
  AMORT: {
    type: "AMORT",
    label: "Amortisierender Swap",
    // `amortisation`: Linear (default) or Annuität (instalment from `rate`); `finalNotional` = residual at maturity.
    columns: [
      "type",
      "id",
      "name",
      "counterparty",
      "book",
      "currency",
      "notional",
      "finalNotional",
      "amortisation",
      "direction",
      "rate",
      "start",
      "maturity",
      "index",
      "frequency",
      "status",
    ],
    example: [
      "AMORT",
      "AMORT-1001",
      "Tilgungsswap Kredit B",
      "Landesbank A",
      "Treasury",
      "EUR",
      "10000000",
      "0",
      "Linear",
      "Pay",
      "3,10 %",
      "2026-09-07",
      "10Y",
      "EURIBOR-6M",
      "1Y",
      "Live",
    ],
  },
  IMM: {
    type: "IMM",
    label: "IMM-Swap",
    // `from`: the swap starts on the next IMM date after this date (empty = valuation date); `tenor` in whole months/years.
    columns: ["type", "id", "name", "counterparty", "book", "currency", "notional", "direction", "rate", "from", "tenor", "index", "status"],
    example: ["IMM", "IMM-1001", "IMM-Swap EUR 2Y", "DZ BANK", "Treasury", "EUR", "10000000", "Pay", "3,00 %", "2026-09-07", "2Y", "EURIBOR-6M", "Live"],
  },
};

/** Header aliases accepted without an explicit mapping (German / English / Bloomberg-ish). */
const HEADER_ALIASES: Record<string, CsvColumn> = {
  typ: "type",
  type: "type",
  produkt: "type",
  id: "id",
  "trade id": "id",
  tradeid: "id",
  referenz: "id",
  name: "name",
  bezeichnung: "name",
  kontrahent: "counterparty",
  counterparty: "counterparty",
  gegenpartei: "counterparty",
  buch: "book",
  book: "book",
  portfolio: "book",
  währung: "currency",
  waehrung: "currency",
  currency: "currency",
  ccy: "currency",
  nominal: "notional",
  notional: "notional",
  betrag: "notional",
  richtung: "direction",
  direction: "direction",
  payrec: "direction",
  "pay/rec": "direction",
  satz: "rate",
  festsatz: "rate",
  rate: "rate",
  kupon: "rate",
  coupon: "rate",
  start: "start",
  startdatum: "start",
  effectivedate: "start",
  "effective date": "start",
  beginn: "start",
  laufzeit: "maturity",
  maturity: "maturity",
  ende: "maturity",
  enddatum: "maturity",
  fälligkeit: "maturity",
  faelligkeit: "maturity",
  terminationdate: "maturity",
  index: "index",
  referenzzins: "index",
  frequenz: "frequency",
  frequency: "frequency",
  paar: "pair",
  pair: "pair",
  kaufwährung: "buyCurrency",
  buycurrency: "buyCurrency",
  kaufbetrag: "buyAmount",
  buyamount: "buyAmount",
  verkaufswährung: "sellCurrency",
  sellcurrency: "sellCurrency",
  verkaufsbetrag: "sellAmount",
  sellamount: "sellAmount",
  lieferung: "deliveryDate",
  valuta: "deliveryDate",
  deliverydate: "deliveryDate",
  art: "capFloor",
  capfloor: "capFloor",
  strike: "strike",
  "cap-strike": "strike",
  capstrike: "strike",
  floorstrike: "floorStrike",
  "floor-strike": "floorStrike",
  expiry: "expiry",
  verfall: "expiry",
  expirydate: "expiry",
  tenor: "tenor",
  swaplaufzeit: "tenor",
  optiontype: "optionType",
  optionstyp: "optionType",
  "call/put": "optionType",
  spread: "spread",
  basisspread: "spread",
  fxspot: "fxSpot",
  spot: "fxSpot",
  kassakurs: "fxSpot",
  period: "period",
  periode: "period",
  collateral: "collateral",
  csa: "collateral",
  collateralcurrency: "collateral",
  "collateral-währung": "collateral",
  besicherung: "collateral",
  status: "status",
  // Markt R6-2
  baseamount: "baseAmount",
  basisbetrag: "baseAmount",
  "betrag basis": "baseAmount",
  nearrate: "nearRate",
  nearkurs: "nearRate",
  "kurs near": "nearRate",
  kassakurs_near: "nearRate",
  farrate: "farRate",
  farkurs: "farRate",
  "kurs far": "farRate",
  neardate: "nearDate",
  "valuta near": "nearDate",
  startvaluta: "nearDate",
  fardate: "farDate",
  "valuta far": "farDate",
  endvaluta: "farDate",
  receiveindex: "receiveIndex",
  "index erhalten": "receiveIndex",
  empfangsindex: "receiveIndex",
  payindex: "payIndex",
  "index zahlen": "payIndex",
  zahlindex: "payIndex",
  finalnotional: "finalNotional",
  restschuld: "finalNotional",
  endnominal: "finalNotional",
  amortisation: "amortisation",
  tilgung: "amortisation",
  tilgungsprofil: "amortisation",
  stepup: "stepUp",
  staffel: "stepUp",
  zinsstaffel: "stepUp",
  kuponstaffel: "stepUp",
  from: "from",
  ab: "from",
  "imm-start": "from",
  immstart: "from",
  // API column names of the swap templates
  payreceive: "direction",
  "pay/receive": "direction",
  fixedrate: "rate",
  barriertype: "barrierType",
  barriere: "barrierType",
  barrierlevel: "barrierLevel",
  "barriere-level": "barrierLevel",
  barrierrebate: "barrierRebate",
  rebate: "barrierRebate",
  barrierhit: "barrierHit",
  "barriere berührt": "barrierHit",
  barrierestatus: "barrierHit",
};

export interface CsvImportResult {
  trades: Trade[];
  /** Row number (1-based, excluding header) and German reason for every rejected row. */
  errors: { row: number; msg: string }[];
  columns: CsvColumn[];
}

/** Split a CSV line honouring double quotes; separator is auto-detected (";" preferred, "," or tab). */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function detectSeparator(header: string): string {
  const counts: [string, number][] = [";", ",", "\t"].map((s) => [s, header.split(s).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ";";
}

function num(s: string | undefined, scale = 1): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const p = parseNumberInput(s, scale);
  return p ? p.value : undefined;
}

/** Rate cell → decimal: "3,10 %" / "310bp" via suffix; plain numbers ≥ 0.5 are percent, smaller ones decimals. */
export function rateOf(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  // "3,10 %" / "310bp" → decimal via suffix; plain numbers: ≥ 0.5 → percent, else decimal
  const p = parseNumberInput(s, 1);
  if (!p) return undefined;
  if (p.unit === "%" || p.unit === "bp") return p.value;
  return Math.abs(p.value) >= 0.5 ? p.value / 100 : p.value;
}

/** German column labels for row errors ("Spalte „start“ (Start)"). */
const COLUMN_DE: Partial<Record<CsvColumn, string>> = {
  start: "Start",
  maturity: "Laufzeit/Enddatum",
  deliveryDate: "Lieferdatum",
  expiry: "Verfall",
  nearDate: "Valuta Near",
  farDate: "Valuta Far",
  from: "IMM-Start",
  stepUp: "Zinsstaffel",
};

/**
 * Date cell of a CSV row. An empty cell yields `undefined` (the caller applies
 * its default); text that is not a date, an impossible date (`31.02.2026`,
 * `2026-02-30`) or an unknown tenor raises a German row error instead of being
 * replaced silently by the default (R5-F1).
 */
function dateOf(s: string | undefined, base: number, column: CsvColumn): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const d = parseDateInput(s, { base });
  if (d === undefined) throw new Error(invalidDateMessage(s, column));
  return d;
}

/** Row error for an unreadable / impossible date cell (exported for tests and the API-style error list). */
export function invalidDateMessage(value: string, column: CsvColumn): string {
  const label = COLUMN_DE[column] ?? column;
  return `Ungültiges Datum „${value.trim()}“ in Spalte „${column}“ (${label}) – erwartet TT.MM.JJJJ, JJJJ-MM-TT oder Tenor (z. B. 5Y); unmögliche Daten wie 31.02. werden nicht übernommen`;
}

/**
 * CSA column of a cross-currency swap (Markt R5-3): empty → the market default
 * (`ccsCollateralCurrency`), `none` / `unbesichert` / `keine` / `-` → unsecured
 * (`null`), otherwise a 3-letter currency.
 */
export function collateralOf(raw: string | undefined, pair: string): string | null | undefined {
  const s = (raw ?? "").trim();
  if (s === "") return ccsCollateralCurrency(pair);
  if (/^(none|null|nein|no|keine?|unbesichert|ohne|-|–)$/i.test(s)) return null;
  const ccy = s.toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy))
    throw new Error(`Collateral-Währung „${s}“ nicht lesbar (Spalte „collateral“: Währung wie USD, leer = Standard, „none“ = unbesichert)`);
  return ccy;
}

const STATUS_MAP: Record<string, Trade["status"]> = {
  live: "Live",
  indikation: "Indication",
  indication: "Indication",
  fällig: "Matured",
  matured: "Matured",
  storniert: "Cancelled",
  cancelled: "Cancelled",
};

/**
 * Parse an import CSV (BOM tolerated, ";" / "," / tab, decimal comma or point,
 * dates ISO / German / tenor). The `type` column selects the template (IRS /
 * FXF / CAP); `mapping` maps canonical column names to the file's header names
 * when they differ from the aliases.
 */
export function tradesFromCsv(
  text: string,
  opts: { mapping?: Partial<Record<CsvColumn, string>>; valuationDate: number; fxSpots?: Record<string, number> },
): CsvImportResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("CSV benötigt eine Kopfzeile und mindestens eine Datenzeile");
  const sep = detectSeparator(lines[0]!);
  const header = splitCsvLine(lines[0]!, sep);
  const reverse = new Map<string, CsvColumn>();
  for (const [canon, name] of Object.entries(opts.mapping ?? {})) if (name) reverse.set(name.trim().toLowerCase(), canon as CsvColumn);
  const columns: (CsvColumn | undefined)[] = header.map((h) => {
    const key = h.trim().toLowerCase();
    return reverse.get(key) ?? HEADER_ALIASES[key] ?? (Object.values(HEADER_ALIASES).includes(key as CsvColumn) ? (key as CsvColumn) : undefined);
  });
  if (!columns.includes("type")) throw new Error(`Spalte „Typ“ fehlt (${CSV_TRADE_TYPES.join(" / ")})`);
  const trades: Trade[] = [];
  const errors: { row: number; msg: string }[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]!, sep);
    const rec: Partial<Record<CsvColumn, string>> = {};
    columns.forEach((c, i) => {
      if (c && cells[i] !== undefined && cells[i] !== "") rec[c] = cells[i];
    });
    try {
      const t = tradeFromRecord(rec, opts.valuationDate, r, { fxSpots: opts.fxSpots });
      // A built row that fails trade validation (end before start, notional ≤ 0 …) is a row error like any other –
      // the dialog and the "n gültige Zeilen importieren" count agree with what the import will accept (R6-06).
      const issues = validateTrade(t);
      if (hasErrors(issues)) {
        errors.push({ row: r, msg: [...new Set(issues.filter((i) => i.level === "error").map((i) => i.msg))].join("; ") });
        continue;
      }
      trades.push(t);
    } catch (e) {
      errors.push({ row: r, msg: (e as Error).message });
    }
  }
  return { trades, errors, columns: columns.filter((c): c is CsvColumn => c !== undefined) };
}

/**
 * Coupon steps of a swap CSV row (Markt R6-2): "2027-09-07:3,30 %|2028-09-07:3,50 %" (also ";" between steps when the
 * file separator is ",", "=" instead of ":"). Dates ISO / German / tenor from `start`.
 */
export function stepUpOf(raw: string | undefined, start: number): { date: number; rate: number }[] | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const steps = s
    .split(/[|;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.+?)\s*[:=]\s*(.+)$/.exec(part);
      if (!m) throw new Error(`Zinsstaffel „${part}“ nicht lesbar – erwartet Datum:Satz, z. B. 2027-09-07:3,30 %|2028-09-07:3,50 %`);
      const date = parseDateInput(m[1]!, { base: start });
      const rate = rateOf(m[2]);
      if (date === undefined) throw new Error(invalidDateMessage(m[1]!, "stepUp"));
      if (rate === undefined) throw new Error(`Zinsstaffel: Satz „${m[2]}“ nicht lesbar (z. B. 3,30 %)`);
      return { date, rate };
    })
    .sort((a, b) => a.date - b.date);
  return steps.length ? steps : undefined;
}

/** Error list of an import as CSV (Zeile;Meldung) – downloadable from the error dialog (R3-F7). */
export function csvErrorsText(errors: { row: number; msg: string }[]): string {
  const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `\uFEFFZeile;Meldung\r\n${errors.map((e) => `${e.row + 1};${cell(e.msg)}`).join("\r\n")}\r\n`;
}

function tradeFromRecord(rec: Partial<Record<CsvColumn, string>>, valuationDate: number, row: number, opts?: { fxSpots?: Record<string, number> }): Trade {
  const type = (rec.type ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const id = rec.id?.trim() || `${type || "TRD"}-CSV-${String(row).padStart(4, "0")}`;
  const common: Partial<Trade> & { id: string } = { id };
  if (rec.name) common.name = rec.name;
  if (rec.counterparty) common.counterparty = rec.counterparty;
  if (rec.book) common.book = rec.book;
  const status = STATUS_MAP[(rec.status ?? "").toLowerCase()];
  if (status) common.status = status;
  // FRAs read `start` themselves (period "3x6" or explicit dates) – every other product starts at T+2 unless the row says otherwise.
  const start = type === "FRA" ? valuationDate : (dateOf(rec.start, valuationDate, "start") ?? addTenor(valuationDate, "2D"));
  /** Maturity cell: a tenor ("10Y") is passed to the builder, anything else must be a valid date (R5-F1). */
  const maturityOf = (raw: string): string | number => (/^\d+[dwmy]$/i.test(raw.trim()) ? raw.trim().toUpperCase() : dateOf(raw, start, "maturity")!);
  if (type === "IRS" || type === "SWAP" || type === "ZINSSWAP") {
    const notional = num(rec.notional);
    const rate = rateOf(rec.rate);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (rate === undefined) throw new Error("Festsatz fehlt");
    if (!rec.maturity) throw new Error("Laufzeit/Enddatum fehlt");
    const maturity = maturityOf(rec.maturity);
    const dir = (rec.direction ?? "Pay").toLowerCase();
    const t = makeVanillaSwap({
      id,
      counterparty: common.counterparty,
      name: common.name,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      payReceiveFixed: /^(rec|receive|receiver|r|erhalten|empf)/.test(dir) ? "Receive" : "Pay",
      fixedRate: rate,
      effectiveDate: start,
      maturity,
      index: rec.index?.toUpperCase(),
      ...(rec.frequency ? { fixedFrequency: rec.frequency.toUpperCase() } : {}),
      stepUp: stepUpOf(rec.stepUp, start),
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "AMORT" || type === "AMORTISING" || type === "TILGUNGSSWAP") {
    // Markt R6-2: linear (default) or annuity amortisation to `finalNotional`.
    const notional = num(rec.notional);
    const rate = rateOf(rec.rate);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (rate === undefined) throw new Error("Festsatz fehlt");
    if (!rec.maturity) throw new Error("Laufzeit/Enddatum fehlt");
    const maturity = maturityOf(rec.maturity);
    const finalNotional = num(rec.finalNotional) ?? 0;
    if (finalNotional < 0 || finalNotional >= notional) throw new Error(`Restschuld „${rec.finalNotional ?? ""}“ muss zwischen 0 und dem Nominal liegen`);
    const profile = (rec.amortisation ?? "linear").trim().toLowerCase();
    if (!/^(linear|annuit(ä|ae|a)t|annuity)$/.test(profile)) throw new Error(`Tilgungsprofil „${rec.amortisation ?? ""}“ unbekannt (Linear oder Annuität)`);
    const dir = (rec.direction ?? "Pay").toLowerCase();
    const params = {
      id,
      counterparty: common.counterparty,
      name: common.name,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      payReceiveFixed: /^(rec|receive|receiver|r|erhalten|empf)/.test(dir) ? ("Receive" as const) : ("Pay" as const),
      fixedRate: rate,
      effectiveDate: start,
      maturity,
      index: rec.index?.toUpperCase(),
      ...(rec.frequency ? { fixedFrequency: rec.frequency.toUpperCase() } : {}),
      finalNotional,
    };
    let t = makeAmortisingSwap(params);
    if (profile !== "linear") {
      const schedule = annuityAmortisationSchedule(t.legs[0]!, notional, rate, finalNotional);
      t = { ...t, legs: t.legs.map((l) => ({ ...l, notionalSchedule: schedule })) };
    }
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "IMM" || type === "IMMSWAP") {
    // Markt R6-2: effective on the next IMM date after `from` (default: valuation date), IMM rolls.
    const notional = num(rec.notional);
    const rate = rateOf(rec.rate);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (rate === undefined) throw new Error("Festsatz fehlt");
    const tenor = (rec.tenor ?? rec.maturity ?? "").trim().toUpperCase();
    if (!/^\d+[MY]$/.test(tenor)) throw new Error("Laufzeit fehlt (Tenor in Monaten oder Jahren, z. B. 2Y)");
    const from = dateOf(rec.from ?? rec.start, valuationDate, "from") ?? valuationDate;
    const dir = (rec.direction ?? "Pay").toLowerCase();
    const t = makeImmSwap({
      id,
      counterparty: common.counterparty,
      name: common.name,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      payReceiveFixed: /^(rec|receive|receiver|r|erhalten|empf)/.test(dir) ? "Receive" : "Pay",
      fixedRate: rate,
      from,
      tenor,
      index: rec.index?.toUpperCase(),
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "BASIS" || type === "TENORBASIS" || type === "BASISSWAP") {
    // Markt R6-2: tenor-basis swap, spread on the receive leg.
    const notional = num(rec.notional);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    const receiveIndex = (rec.receiveIndex ?? "").trim().toUpperCase();
    const payIndex = (rec.payIndex ?? "").trim().toUpperCase();
    if (!receiveIndex || !payIndex) throw new Error("Indizes fehlen (Spalten „receiveIndex“ und „payIndex“, z. B. EURIBOR-3M / EURIBOR-6M)");
    if (receiveIndex === payIndex) throw new Error("Empfangs- und Zahlindex müssen sich unterscheiden");
    if (!rec.maturity) throw new Error("Laufzeit/Enddatum fehlt");
    const maturity = maturityOf(rec.maturity);
    const spreadRaw = num(rec.spread);
    const spread = spreadRaw === undefined ? 0 : Math.abs(spreadRaw) >= 1 ? spreadRaw / 1e4 : spreadRaw;
    const t = makeBasisSwap({
      id,
      counterparty: common.counterparty,
      name: common.name,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      effectiveDate: start,
      maturity,
      receiveIndex,
      payIndex,
      spread,
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "FXS" || type === "FXSWAP") {
    // Markt R6-2: FX swap – near leg at `nearDate` (default spot), far leg at `farDate`.
    const pair = (rec.pair ?? `${rec.buyCurrency ?? ""}${rec.sellCurrency ?? ""}`).toUpperCase().replace(/[^A-Z]/g, "");
    if (!/^[A-Z]{6}$/.test(pair)) throw new Error("Währungspaar fehlt (z. B. EURUSD)");
    const baseAmount = num(rec.baseAmount ?? rec.notional);
    if (baseAmount === undefined || baseAmount === 0) throw new Error("Basisbetrag fehlt (Spalte „baseAmount“, positiv = Basiswährung near kaufen)");
    const nearRate = num(rec.nearRate);
    const farRate = num(rec.farRate);
    if (nearRate === undefined || nearRate <= 0) throw new Error("Near-Kurs fehlt (Spalte „nearRate“)");
    if (farRate === undefined || farRate <= 0) throw new Error("Far-Kurs fehlt (Spalte „farRate“)");
    const nearDate = dateOf(rec.nearDate ?? rec.start, valuationDate, "nearDate") ?? addTenor(valuationDate, "2D");
    const farDate = dateOf(rec.farDate ?? rec.maturity, nearDate, "farDate");
    if (farDate === undefined) throw new Error("Far-Valuta fehlt (Spalte „farDate“, Datum oder Tenor ab Near)");
    if (farDate <= nearDate) throw new Error("Far-Valuta muss nach der Near-Valuta liegen");
    const t = makeFxSwap({ id, counterparty: common.counterparty, pair, baseAmount, nearRate, farRate, nearDate, farDate });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "FXF" || type === "FXFORWARD" || type === "FORWARD") {
    const buyCcy = (rec.buyCurrency ?? "").toUpperCase();
    const sellCcy = (rec.sellCurrency ?? "").toUpperCase();
    const buyAmount = num(rec.buyAmount);
    const sellAmount = num(rec.sellAmount);
    const delivery = dateOf(rec.deliveryDate ?? rec.maturity, valuationDate, "deliveryDate");
    if (!/^[A-Z]{3}$/.test(buyCcy) || !/^[A-Z]{3}$/.test(sellCcy)) throw new Error("Kauf-/Verkaufswährung fehlt");
    if (buyCcy === sellCcy) throw new Error("Kauf- und Verkaufswährung müssen sich unterscheiden");
    if (buyAmount === undefined || sellAmount === undefined) throw new Error("Kauf-/Verkaufsbetrag fehlt");
    if (delivery === undefined) throw new Error("Lieferdatum fehlt");
    const pair = `${buyCcy}${sellCcy}`;
    const t = makeFxForward({ id, counterparty: common.counterparty, pair, baseAmount: buyAmount, rate: sellAmount / buyAmount, deliveryDate: delivery });
    return { ...t, ...common, buyCurrency: buyCcy, buyAmount, sellCurrency: sellCcy, sellAmount, name: common.name ?? t.name } as Trade;
  }
  if (type === "CAP" || type === "FLOOR" || type === "COLLAR" || type === "CAPFLOOR") {
    const notional = num(rec.notional);
    const strike = rateOf(rec.strike);
    const floorStrike = rateOf(rec.floorStrike);
    const kindRaw = (rec.capFloor ?? (type === "CAPFLOOR" ? "Cap" : type)).toLowerCase();
    const capFloor = kindRaw.startsWith("collar") ? "Collar" : kindRaw.startsWith("floor") ? "Floor" : "Cap";
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (strike === undefined) throw new Error("Strike fehlt");
    if (!rec.maturity) throw new Error("Laufzeit/Enddatum fehlt");
    const maturity = maturityOf(rec.maturity);
    const t = makeCapFloor({
      id,
      counterparty: common.counterparty,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      capFloor,
      strike,
      floorStrike: capFloor === "Collar" ? floorStrike : undefined,
      effectiveDate: start,
      maturity,
      index: rec.index?.toUpperCase(),
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "SWPT" || type === "SWAPTION") {
    const notional = num(rec.notional);
    const strike = rateOf(rec.strike ?? rec.rate);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (strike === undefined) throw new Error("Strike fehlt");
    const expiryRaw = (rec.expiry ?? "").trim();
    if (!expiryRaw) throw new Error("Verfall fehlt (Tenor „1Y“ oder Datum)");
    const expiry = /^\d+[dwmy]$/i.test(expiryRaw) ? expiryRaw.toUpperCase() : dateOf(expiryRaw, valuationDate, "expiry")!;
    const tenor = (rec.tenor ?? rec.maturity ?? "").trim().toUpperCase();
    if (!/^\d+[DWMY]$/.test(tenor)) throw new Error("Swap-Laufzeit fehlt (z. B. 5Y)");
    const dir = (rec.direction ?? "Payer").toLowerCase();
    const t = makeSwaption({
      id,
      counterparty: common.counterparty,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      payerReceiver: /^(rec|receive|receiver|r|empf)/.test(dir) ? "Receiver" : "Payer",
      strike,
      expiry,
      tenor,
      valuationDate,
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "FXO" || type === "FXOPTION" || type === "OPTION") {
    const pair = (rec.pair ?? `${rec.buyCurrency ?? ""}${rec.sellCurrency ?? ""}`).toUpperCase().replace(/[^A-Z]/g, "");
    if (!/^[A-Z]{6}$/.test(pair)) throw new Error("Währungspaar fehlt (z. B. EURUSD)");
    const notional = num(rec.notional);
    const strike = num(rec.strike);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (strike === undefined || strike <= 0) throw new Error("Strike fehlt");
    const expiry = dateOf(rec.expiry ?? rec.maturity, valuationDate, "expiry");
    if (expiry === undefined) throw new Error("Verfall fehlt");
    const optionType = /^(put|p|verkauf)/i.test((rec.optionType ?? rec.direction ?? "Call").trim()) ? "Put" : "Call";
    const t = makeFxOption({ id, counterparty: common.counterparty, pair, optionType, notional, strike, expiryDate: expiry });
    const barrier = barrierOf(rec);
    return { ...t, ...common, ...(barrier ? { barrier } : {}), name: common.name ?? t.name } as Trade;
  }
  if (type === "CCS" || type === "XCCY" || type === "CROSSCURRENCYSWAP") {
    const pair = (rec.pair ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    if (!/^[A-Z]{6}$/.test(pair)) throw new Error("Währungspaar fehlt (z. B. EURUSD)");
    const notional = num(rec.notional);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    const spreadRaw = num(rec.spread);
    const spread = spreadRaw === undefined ? 0 : Math.abs(spreadRaw) >= 1 ? spreadRaw / 1e4 : spreadRaw;
    const fixedRate = rateOf(rec.rate);
    const fxSpot = num(rec.fxSpot) ?? opts?.fxSpots?.[pair];
    if (fxSpot === undefined || fxSpot <= 0) throw new Error("FX-Spot fehlt (Spalte „fxSpot“, z. B. 1,17)");
    if (!rec.maturity) throw new Error("Laufzeit fehlt (z. B. 5Y)");
    const tenor = rec.maturity.trim().toUpperCase();
    if (!/^\d+[DWMY]$/.test(tenor)) throw new Error(`Laufzeit „${rec.maturity}“ nicht lesbar (Tenor, z. B. 5Y)`);
    const dir = (rec.direction ?? "Receive").toLowerCase();
    const t = makeCrossCurrencySwap({
      id,
      counterparty: common.counterparty,
      pair,
      domesticNotional: notional,
      fxSpot,
      spread,
      fixedRate,
      effectiveDate: start,
      tenor,
      domesticPayReceive: /^(pay|payer|p|zahl)/.test(dir) ? "Pay" : "Receive",
      collateralCurrency: collateralOf(rec.collateral, pair),
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "FRA") {
    const notional = num(rec.notional);
    const rate = rateOf(rec.rate);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (rate === undefined) throw new Error("Festsatz fehlt");
    const period = (rec.period ?? "").trim();
    const dir = (rec.direction ?? "Pay").toLowerCase();
    const payReceive = /^(rec|receive|receiver|r|erhalten|empf)/.test(dir) ? "Receive" : "Pay";
    const base = {
      id,
      counterparty: common.counterparty,
      currency: (rec.currency ?? "EUR").toUpperCase(),
      notional,
      payReceive,
      rate,
      index: rec.index?.toUpperCase(),
    } as const;
    let t: Trade;
    if (/^\d{1,2}\s*[xX×]\s*\d{1,2}$/.test(period)) t = makeFra({ ...base, start: period.replace(/\s+/g, "").toLowerCase(), valuationDate });
    else {
      const startDate = dateOf(rec.start, valuationDate, "start");
      const endDate = dateOf(rec.maturity, startDate ?? valuationDate, "maturity");
      if (startDate === undefined || endDate === undefined) throw new Error("FRA-Periode fehlt (z. B. „3x6“ oder Start- und Enddatum)");
      if (endDate <= startDate) throw new Error("FRA: Ende muss nach dem Start liegen");
      t = makeFra({ ...base, start: startDate, end: endDate, valuationDate });
    }
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  throw new Error(`Unbekannter Typ „${rec.type ?? ""}“ (erlaubt: ${CSV_TRADE_TYPES.join(", ")})`);
}

const BARRIER_TYPES: Record<string, "UpOut" | "UpIn" | "DownOut" | "DownIn"> = {
  upout: "UpOut",
  "up-out": "UpOut",
  "up-and-out": "UpOut",
  uo: "UpOut",
  upin: "UpIn",
  "up-in": "UpIn",
  "up-and-in": "UpIn",
  ui: "UpIn",
  downout: "DownOut",
  "down-out": "DownOut",
  "down-and-out": "DownOut",
  do: "DownOut",
  downin: "DownIn",
  "down-in": "DownIn",
  "down-and-in": "DownIn",
  di: "DownIn",
};

/**
 * Barrier of an FX-option row (API column names `barrierType`, `barrierLevel`, `barrierRebate`, `barrierHit`): empty type
 * or "none" = vanilla; `barrierHit` ja/nein/true/false records the knock state (core R6 `barrier.hit`), empty = unknown.
 */
export function barrierOf(
  rec: Partial<Record<CsvColumn, string>>,
): { type: "UpOut" | "UpIn" | "DownOut" | "DownIn"; level: number; rebate?: number; hit?: boolean } | undefined {
  const raw = (rec.barrierType ?? "").trim().toLowerCase();
  if (!raw || /^(none|keine|-|–|vanilla)$/.test(raw)) {
    if (rec.barrierLevel?.trim()) throw new Error("Barriere-Level ohne Barriere-Typ (Spalte „barrierType“: UpOut, UpIn, DownOut, DownIn)");
    return undefined;
  }
  const type = BARRIER_TYPES[raw.replace(/\s+/g, "")] ?? BARRIER_TYPES[raw];
  if (!type) throw new Error(`Barriere-Typ „${rec.barrierType}“ unbekannt (UpOut, UpIn, DownOut, DownIn)`);
  const level = num(rec.barrierLevel);
  if (level === undefined || level <= 0) throw new Error("Barriere-Level fehlt (Spalte „barrierLevel“, z. B. 1,05)");
  const rebate = num(rec.barrierRebate);
  const hitRaw = (rec.barrierHit ?? "").trim().toLowerCase();
  const hit = hitRaw === "" ? undefined : /^(ja|j|yes|y|true|1|berührt|hit)$/.test(hitRaw) ? true : /^(nein|n|no|false|0)$/.test(hitRaw) ? false : null;
  if (hit === null) throw new Error(`Barriere-Status „${rec.barrierHit}“ nicht lesbar (Spalte „barrierHit“: ja / nein, leer = unbekannt)`);
  return { type, level, ...(rebate !== undefined ? { rebate } : {}), ...(hit !== undefined ? { hit } : {}) };
}

/** CSV template text (header + example row) for one trade type. */
export function csvTemplateText(type: CsvTradeType): string {
  const t = CSV_IMPORT_TEMPLATES[type];
  return `\uFEFF${t.columns.join(";")}\r\n${t.example.join(";")}\r\n`;
}

/** Trigger a browser download of a text blob. */
export function downloadText(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
