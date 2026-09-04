import {
  type Trade,
  addTenor,
  makeCapFloor,
  makeCrossCurrencySwap,
  makeFra,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
  toISO,
} from "@deriva/pricing-core";
import { parseDateInput } from "./date-parse.js";
import { parseNumberInput } from "./num-parse.js";
import { ccsCollateralCurrency } from "./templates.js";

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

export function tradesFromJson(text: string): Trade[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { trades?: unknown }).trades)
      ? (parsed as { trades: unknown[] }).trades
      : null;
  if (!list) throw new Error("JSON muss ein Array von Trades enthalten");
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
  | "status";

export type CsvTradeType = "IRS" | "FXF" | "CAP" | "SWPT" | "FXO" | "CCS" | "FRA";
export const CSV_TRADE_TYPES: CsvTradeType[] = ["IRS", "FXF", "CAP", "SWPT", "FXO", "CCS", "FRA"];

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
    columns: ["type", "id", "name", "counterparty", "book", "currency", "notional", "direction", "rate", "start", "maturity", "index", "frequency", "status"],
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
    columns: ["type", "id", "name", "counterparty", "book", "pair", "optionType", "notional", "strike", "expiry", "status"],
    example: ["FXO", "FXO-1001", "EUR-Put/USD-Call Wareneinkauf", "Commerzbank", "Einkauf", "EURUSD", "Put", "3000000", "1,1500", "2027-06-15", "Live"],
  },
  CCS: {
    type: "CCS",
    label: "Cross-Currency-Swap",
    columns: ["type", "id", "name", "counterparty", "book", "pair", "notional", "spread", "rate", "fxSpot", "direction", "start", "maturity", "status"],
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
      "Live",
    ],
  },
  FRA: {
    type: "FRA",
    label: "FRA",
    columns: ["type", "id", "name", "counterparty", "book", "currency", "notional", "direction", "rate", "period", "start", "maturity", "index", "status"],
    example: ["FRA", "FRA-1001", "FRA EUR 3x6", "DZ BANK", "Liquidität", "EUR", "10000000", "Pay", "2,20 %", "3x6", "", "", "EURIBOR-3M", "Live"],
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
  status: "status",
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

function rateOf(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  // "3,10 %" / "310bp" → decimal via suffix; plain numbers: ≥ 0.5 → percent, else decimal
  const p = parseNumberInput(s, 1);
  if (!p) return undefined;
  if (p.unit === "%" || p.unit === "bp") return p.value;
  return Math.abs(p.value) >= 0.5 ? p.value / 100 : p.value;
}

function dateOf(s: string | undefined, base: number): number | undefined {
  if (!s) return undefined;
  return parseDateInput(s, { base });
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
      trades.push(t);
    } catch (e) {
      errors.push({ row: r, msg: (e as Error).message });
    }
  }
  return { trades, errors, columns: columns.filter((c): c is CsvColumn => c !== undefined) };
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
  const start = dateOf(rec.start, valuationDate) ?? addTenor(valuationDate, "2D");
  if (type === "IRS" || type === "SWAP" || type === "ZINSSWAP") {
    const notional = num(rec.notional);
    const rate = rateOf(rec.rate);
    if (notional === undefined || notional <= 0) throw new Error("Nominal fehlt oder ≤ 0");
    if (rate === undefined) throw new Error("Festsatz fehlt");
    if (!rec.maturity) throw new Error("Laufzeit/Enddatum fehlt");
    const maturity = /^\d+[dwmy]$/i.test(rec.maturity.trim()) ? rec.maturity.trim().toUpperCase() : dateOf(rec.maturity, start);
    if (maturity === undefined) throw new Error(`Laufzeit „${rec.maturity}“ nicht lesbar`);
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
    });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  if (type === "FXF" || type === "FXFORWARD" || type === "FORWARD") {
    const buyCcy = (rec.buyCurrency ?? "").toUpperCase();
    const sellCcy = (rec.sellCurrency ?? "").toUpperCase();
    const buyAmount = num(rec.buyAmount);
    const sellAmount = num(rec.sellAmount);
    const delivery = dateOf(rec.deliveryDate ?? rec.maturity, valuationDate);
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
    const maturity = /^\d+[dwmy]$/i.test(rec.maturity.trim()) ? rec.maturity.trim().toUpperCase() : dateOf(rec.maturity, start);
    if (maturity === undefined) throw new Error(`Laufzeit „${rec.maturity}“ nicht lesbar`);
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
    const expiry = /^\d+[dwmy]$/i.test(expiryRaw) ? expiryRaw.toUpperCase() : dateOf(expiryRaw, valuationDate);
    if (expiry === undefined) throw new Error(`Verfall „${expiryRaw}“ nicht lesbar`);
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
    const expiry = dateOf(rec.expiry ?? rec.maturity, valuationDate);
    if (expiry === undefined) throw new Error("Verfall fehlt");
    const optionType = /^(put|p|verkauf)/i.test((rec.optionType ?? rec.direction ?? "Call").trim()) ? "Put" : "Call";
    const t = makeFxOption({ id, counterparty: common.counterparty, pair, optionType, notional, strike, expiryDate: expiry });
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
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
      collateralCurrency: ccsCollateralCurrency(pair),
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
      const startDate = dateOf(rec.start, valuationDate);
      const endDate = dateOf(rec.maturity, startDate ?? valuationDate);
      if (startDate === undefined || endDate === undefined) throw new Error("FRA-Periode fehlt (z. B. „3x6“ oder Start- und Enddatum)");
      if (endDate <= startDate) throw new Error("FRA: Ende muss nach dem Start liegen");
      t = makeFra({ ...base, start: startDate, end: endDate, valuationDate });
    }
    return { ...t, ...common, name: common.name ?? t.name } as Trade;
  }
  throw new Error(`Unbekannter Typ „${rec.type ?? ""}“ (erlaubt: ${CSV_TRADE_TYPES.join(", ")})`);
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
