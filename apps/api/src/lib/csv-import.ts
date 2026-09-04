/**
 * CSV trade import for `POST /api/trades/import` (`content-type: text/csv`,
 * market review N16). One column template per trade type (`?type=`); every
 * row is mapped onto the corresponding core builder so the imported trades
 * carry the market-standard conventions of their currency. Rows that cannot
 * be mapped are reported per row (`rejected`, with the 1-based data row
 * number) instead of failing the whole upload.
 *
 * Format: header row, `;` / `,` / tab separated (auto-detected on the header),
 * double-quote escaping, optional UTF-8 BOM. Numbers accept the German form
 * (`10.000.000,50`, `3,15 %`) and the plain form (`10000000.5`, `0.0315`);
 * dates accept ISO (`2026-09-07`) and German (`07.09.2026`); tenor columns
 * accept a tenor (`5Y`) or a date. Column names are matched case-insensitively
 * with a few German aliases (Kontrahent, Nominal, Währung, Satz, Laufzeit …).
 */
import {
  type CrossCurrencySwapParams,
  type Trade,
  makeCapFloor,
  makeCrossCurrencySwap,
  makeFra,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
} from "@deriva/pricing-core";

export const CSV_TRADE_TYPES = ["InterestRateSwap", "FxForward", "CapFloor", "Swaption", "FxOption", "CrossCurrencySwap", "FRA"] as const;
export type CsvTradeType = (typeof CSV_TRADE_TYPES)[number];

/** Columns every template accepts (applied to the built trade). */
const COMMON_COLUMNS = ["id", "name", "counterparty", "book", "uti"] as const;

export interface CsvTemplate {
  type: CsvTradeType;
  required: readonly string[];
  optional: readonly string[];
  /** One example row in `[...required, ...optional]` order (German number format). */
  example: readonly string[];
  notes: string;
}

export const CSV_TEMPLATES: Record<CsvTradeType, CsvTemplate> = {
  InterestRateSwap: {
    type: "InterestRateSwap",
    required: ["currency", "notional", "payReceive", "fixedRate", "effectiveDate", "maturity"],
    optional: [...COMMON_COLUMNS, "index", "spread", "fixedFrequency", "floatFrequency", "collateralCurrency"],
    example: [
      "EUR",
      "10.000.000",
      "Pay",
      "3,10 %",
      "2026-09-07",
      "10Y",
      "IRS-CSV-1",
      "Payer-Swap Kredit A",
      "CPTY-A",
      "Treasury",
      "",
      "EURIBOR-6M",
      "",
      "1Y",
      "6M",
      "",
    ],
    notes: "`payReceive` = direction of the fixed leg (Pay = payer swap); `maturity` tenor or date; `index` defaults to the currency's IBOR/RFR.",
  },
  FxForward: {
    type: "FxForward",
    required: ["pair", "baseAmount", "rate", "deliveryDate"],
    optional: [...COMMON_COLUMNS],
    example: ["EURUSD", "-2.000.000", "1,1725", "2027-03-15", "FXF-CSV-1", "", "CPTY-B", "", ""],
    notes: "`baseAmount` signed: positive = buy base / sell quote currency.",
  },
  CapFloor: {
    type: "CapFloor",
    required: ["currency", "notional", "capFloor", "strike", "effectiveDate", "maturity"],
    optional: [...COMMON_COLUMNS, "floorStrike", "index", "longShort"],
    example: ["EUR", "8.000.000", "Cap", "3,00 %", "2026-09-07", "5Y", "CAP-CSV-1", "", "CPTY-A", "", "", "", "EURIBOR-6M", "Long"],
    notes: "`capFloor` Cap | Floor | Collar (`floorStrike` for collars); `longShort` default Long.",
  },
  Swaption: {
    type: "Swaption",
    required: ["currency", "notional", "payerReceiver", "strike", "expiry", "tenor"],
    optional: [...COMMON_COLUMNS, "settlement", "longShort"],
    example: ["EUR", "10.000.000", "Payer", "3,00 %", "1Y", "5Y", "SWPT-CSV-1", "", "CPTY-A", "", "", "Physical", "Long"],
    notes: "`expiry` tenor from the market valuation date or a date; `tenor` of the underlying swap; `settlement` Physical | Cash.",
  },
  FxOption: {
    type: "FxOption",
    required: ["pair", "optionType", "notional", "strike", "expiryDate"],
    optional: [...COMMON_COLUMNS, "deliveryDate", "longShort"],
    example: ["EURUSD", "Put", "3.000.000", "1,15", "2027-06-15", "FXO-CSV-1", "", "CPTY-A", "", "", "", "Long"],
    notes: "`notional` in the base currency; `deliveryDate` defaults to the spot date of the expiry.",
  },
  CrossCurrencySwap: {
    type: "CrossCurrencySwap",
    required: ["pair", "domesticNotional", "effectiveDate", "tenor"],
    optional: [...COMMON_COLUMNS, "fxSpot", "foreignNotional", "spread", "fixedRate", "domesticPayReceive", "frequency", "collateralCurrency"],
    example: ["EURUSD", "10.000.000", "2026-09-07", "5Y", "CCS-CSV-1", "", "CPTY-A", "", "", "1,17", "", "-20 bp", "", "Receive", "3M", ""],
    notes:
      "exactly one of `fxSpot` / `foreignNotional` is required and fixes the foreign leg; `spread` decimal, `%` or `bp` (default 0); `fixedRate` makes the domestic leg fixed.",
  },
  FRA: {
    type: "FRA",
    required: ["currency", "notional", "payReceive", "start", "rate"],
    optional: [...COMMON_COLUMNS, "index", "end", "collateralCurrency"],
    example: ["EUR", "5.000.000", "Pay", "3x9", "2,20 %", "FRA-CSV-1", "", "CPTY-B", "", "", "EURIBOR-6M", "", ""],
    notes: "`start` as period `3x9` (months from spot) or accrual start date (then `end` defaults to start + index tenor); `payReceive` Pay = pay fixed.",
  },
};

/** Header aliases → canonical column (lower-cased, spaces/underscores removed). */
const ALIASES: Record<string, string> = {
  tradeid: "id",
  referenz: "id",
  bezeichnung: "name",
  kontrahent: "counterparty",
  gegenpartei: "counterparty",
  buch: "book",
  portfolio: "book",
  währung: "currency",
  waehrung: "currency",
  ccy: "currency",
  nominal: "notional",
  betrag: "notional",
  richtung: "payReceive",
  direction: "payReceive",
  payrec: "payReceive",
  satz: "fixedRate",
  festsatz: "fixedRate",
  kupon: "fixedRate",
  coupon: "fixedRate",
  startdatum: "effectiveDate",
  beginn: "effectiveDate",
  start: "start",
  laufzeit: "maturity",
  fälligkeit: "maturity",
  faelligkeit: "maturity",
  ende: "end",
  enddatum: "end",
  terminationdate: "maturity",
  referenzzins: "index",
  frequenz: "frequency",
  paar: "pair",
  kurs: "rate",
  lieferung: "deliveryDate",
  valuta: "deliveryDate",
  art: "capFloor",
  verfall: "expiry",
  optionstyp: "optionType",
  spot: "fxSpot",
  cptyname: "counterparty",
};

const normalizeHeader = (h: string): string =>
  h
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

/** Map a header cell to a canonical column of the template (or undefined when unknown). */
function canonicalColumn(header: string, template: CsvTemplate): string | undefined {
  const key = normalizeHeader(header);
  const known = [...template.required, ...template.optional];
  const direct = known.find((c) => c.toLowerCase() === key);
  if (direct) return direct;
  const alias = ALIASES[key];
  if (alias && known.includes(alias)) return alias;
  // "start"/"maturity" aliases for the swaption/CCS/FRA vocabularies.
  if (alias === "effectiveDate" && known.includes("start")) return "start";
  if (alias === "maturity" && known.includes("tenor")) return "tenor";
  if (alias === "fixedRate" && known.includes("rate")) return "rate";
  if (alias === "fixedRate" && known.includes("strike")) return "strike";
  if (alias === "expiry" && known.includes("expiryDate")) return "expiryDate";
  if (alias === "notional" && known.includes("domesticNotional")) return "domesticNotional";
  if (alias === "notional" && known.includes("baseAmount")) return "baseAmount";
  if (alias === "payReceive" && known.includes("payerReceiver")) return "payerReceiver";
  if (alias === "payReceive" && known.includes("domesticPayReceive")) return "domesticPayReceive";
  return undefined;
}

// ---------------------------------------------------------------------------
// Parsing primitives
// ---------------------------------------------------------------------------
export function detectSeparator(header: string): string {
  const counts: [string, number][] = [";", ",", "\t"].map((s) => [s, header.split(s).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ";";
}

/** Split one CSV line honouring double quotes (`""` escapes a quote). */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  separator: string;
}

/** Header + data rows (blank lines skipped, BOM stripped, CRLF tolerated). */
export function parseCsvText(text: string): ParsedCsv {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one data row");
  const separator = detectSeparator(lines[0]!);
  const header = splitCsvLine(lines[0]!, separator);
  return { header, rows: lines.slice(1).map((l) => splitCsvLine(l, separator)), separator };
}

/**
 * Number in German (`10.000.000,50`, `3,15 %`) or plain (`10000000.5`, `3.15%`)
 * form; `%` divides by 100, `bp` by 10 000. With a decimal comma every dot is a
 * thousands separator; without one, dots are thousands separators only when
 * there are at least two groups (`1.000.000`) – a single dot is the decimal
 * point (`1.000` = 1, `0.031` = 0.031).
 */
export function parseCsvNumber(raw: string): number {
  let s = raw.trim().replace(/\s+/g, "");
  let scale = 1;
  if (/%$/.test(s)) {
    scale = 1 / 100;
    s = s.slice(0, -1);
  } else if (/bp$/i.test(s)) {
    scale = 1 / 10_000;
    s = s.slice(0, -2);
  }
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) throw new Error(`not a number: "${raw}"`);
  const n = Number(s) * scale;
  if (!Number.isFinite(n)) throw new Error(`not a finite number: "${raw}"`);
  return n;
}

/** Serial date from ISO (`2026-09-07`) or German (`07.09.2026`) input. */
export function parseCsvDate(raw: string): number {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseISO(s);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (de) return parseISO(`${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`);
  throw new Error(`not a date (YYYY-MM-DD or DD.MM.YYYY): "${raw}"`);
}

const TENOR_RE = /^\d{1,3}[DWMYdwmy]$/;
/** Tenor string (`5Y`) as-is, otherwise a date. */
const dateOrTenor = (raw: string): string | number => (TENOR_RE.test(raw.trim()) ? raw.trim().toUpperCase() : parseCsvDate(raw));

const DIRECTION: Record<string, "Pay" | "Receive"> = {
  pay: "Pay",
  payer: "Pay",
  p: "Pay",
  zahler: "Pay",
  receive: "Receive",
  receiver: "Receive",
  rec: "Receive",
  r: "Receive",
  empfänger: "Receive",
};
const oneOf = <T extends string>(raw: string, allowed: readonly T[], column: string): T => {
  const hit = allowed.find((a) => a.toLowerCase() === raw.trim().toLowerCase());
  if (!hit) throw new Error(`${column}: "${raw}" is not one of ${allowed.join(" | ")}`);
  return hit;
};
const direction = (raw: string, column: string): "Pay" | "Receive" => {
  const d = DIRECTION[raw.trim().toLowerCase()];
  if (!d) throw new Error(`${column}: "${raw}" is not Pay | Receive`);
  return d;
};

// ---------------------------------------------------------------------------
// Row → trade
// ---------------------------------------------------------------------------
class Row {
  constructor(
    private readonly cells: Record<string, string>,
    readonly template: CsvTemplate,
  ) {}
  has(col: string): boolean {
    return (this.cells[col] ?? "").length > 0;
  }
  str(col: string): string {
    const v = this.cells[col];
    if (!v) throw new Error(`column "${col}" is required`);
    return v;
  }
  opt(col: string): string | undefined {
    return this.has(col) ? this.cells[col] : undefined;
  }
  num(col: string): number {
    return parseCsvNumber(this.str(col));
  }
  optNum(col: string): number | undefined {
    return this.has(col) ? parseCsvNumber(this.cells[col]!) : undefined;
  }
  date(col: string): number {
    return parseCsvDate(this.str(col));
  }
  currency(col: string): string {
    const v = this.str(col).toUpperCase();
    if (!/^[A-Z]{3}$/.test(v)) throw new Error(`${col}: "${v}" is not an ISO-4217 code`);
    return v;
  }
  pair(col: string): string {
    const v = this.str(col).toUpperCase().replace("/", "");
    if (!/^[A-Z]{6}$/.test(v)) throw new Error(`${col}: "${v}" is not a currency pair like EURUSD`);
    return v;
  }
}

function buildTrade(row: Row, valuationDate: number): Trade {
  const common = { id: row.opt("id"), counterparty: row.opt("counterparty") };
  switch (row.template.type) {
    case "InterestRateSwap":
      return makeVanillaSwap({
        ...common,
        name: row.opt("name"),
        currency: row.currency("currency"),
        notional: row.num("notional"),
        payReceiveFixed: direction(row.str("payReceive"), "payReceive"),
        fixedRate: row.num("fixedRate"),
        effectiveDate: row.date("effectiveDate"),
        maturity: dateOrTenor(row.str("maturity")),
        index: row.opt("index"),
        spread: row.optNum("spread"),
        fixedFrequency: row.opt("fixedFrequency")?.toUpperCase(),
        floatFrequency: row.opt("floatFrequency")?.toUpperCase(),
        collateralCurrency: row.opt("collateralCurrency")?.toUpperCase(),
      });
    case "FxForward":
      return makeFxForward({
        ...common,
        pair: row.pair("pair"),
        baseAmount: row.num("baseAmount"),
        rate: row.num("rate"),
        deliveryDate: row.date("deliveryDate"),
      });
    case "CapFloor":
      return makeCapFloor({
        ...common,
        currency: row.currency("currency"),
        notional: row.num("notional"),
        capFloor: oneOf(row.str("capFloor"), ["Cap", "Floor", "Collar"] as const, "capFloor"),
        strike: row.num("strike"),
        floorStrike: row.optNum("floorStrike"),
        effectiveDate: row.date("effectiveDate"),
        maturity: dateOrTenor(row.str("maturity")),
        index: row.opt("index"),
        longShort: row.has("longShort") ? oneOf(row.str("longShort"), ["Long", "Short"] as const, "longShort") : undefined,
      });
    case "Swaption":
      return makeSwaption({
        ...common,
        currency: row.currency("currency"),
        notional: row.num("notional"),
        payerReceiver: oneOf(row.str("payerReceiver"), ["Payer", "Receiver"] as const, "payerReceiver"),
        strike: row.num("strike"),
        expiry: dateOrTenor(row.str("expiry")),
        tenor: row.str("tenor").toUpperCase(),
        valuationDate,
        settlement: row.has("settlement") ? oneOf(row.str("settlement"), ["Physical", "Cash"] as const, "settlement") : undefined,
        longShort: row.has("longShort") ? oneOf(row.str("longShort"), ["Long", "Short"] as const, "longShort") : undefined,
      });
    case "FxOption":
      return makeFxOption({
        ...common,
        pair: row.pair("pair"),
        optionType: oneOf(row.str("optionType"), ["Call", "Put"] as const, "optionType"),
        notional: row.num("notional"),
        strike: row.num("strike"),
        expiryDate: row.date("expiryDate"),
        deliveryDate: row.has("deliveryDate") ? row.date("deliveryDate") : undefined,
        longShort: row.has("longShort") ? oneOf(row.str("longShort"), ["Long", "Short"] as const, "longShort") : undefined,
      });
    case "CrossCurrencySwap": {
      const params: CrossCurrencySwapParams = {
        ...common,
        name: row.opt("name"),
        pair: row.pair("pair"),
        domesticNotional: row.num("domesticNotional"),
        fxSpot: row.optNum("fxSpot"),
        foreignNotional: row.optNum("foreignNotional"),
        spread: row.optNum("spread") ?? 0,
        fixedRate: row.optNum("fixedRate"),
        domesticPayReceive: row.has("domesticPayReceive") ? direction(row.str("domesticPayReceive"), "domesticPayReceive") : undefined,
        effectiveDate: row.date("effectiveDate"),
        tenor: dateOrTenor(row.str("tenor")),
        frequency: row.opt("frequency")?.toUpperCase(),
        collateralCurrency: row.opt("collateralCurrency")?.toUpperCase(),
      };
      return makeCrossCurrencySwap(params);
    }
    case "FRA": {
      const start = row.str("start").trim();
      return makeFra({
        ...common,
        name: row.opt("name"),
        currency: row.currency("currency"),
        notional: row.num("notional"),
        payReceive: direction(row.str("payReceive"), "payReceive"),
        index: row.opt("index"),
        start: /^\d{1,3}x\d{1,3}$/i.test(start) ? start.toLowerCase() : parseCsvDate(start),
        end: row.has("end") ? row.date("end") : undefined,
        rate: row.num("rate"),
        valuationDate,
        collateralCurrency: row.opt("collateralCurrency")?.toUpperCase(),
      });
    }
  }
}

/** Drop `undefined` optionals so the built trade passes `additionalProperties: false` schemas cleanly. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export interface CsvImportResult {
  /** Built trades (serial dates) in row order. */
  trades: Trade[];
  /** 1-based data row number (header excluded) of each built trade. */
  rows: number[];
  rejected: { row: number; reason: string }[];
}

/**
 * Map a CSV document onto trades of `type`. Throws (→ 400) when the header
 * lacks a required column; row-level problems land in `rejected`.
 */
export function csvToTrades(text: string, type: CsvTradeType, valuationDate: number): CsvImportResult {
  const template = CSV_TEMPLATES[type];
  const { header, rows } = parseCsvText(text);
  const columns = header.map((h) => canonicalColumn(h, template));
  const missing = template.required.filter((c) => !columns.includes(c));
  if (missing.length) {
    throw new Error(`CSV header lacks required column(s) for ${type}: ${missing.join(", ")} (header: ${header.join(", ")})`);
  }
  const out: CsvImportResult = { trades: [], rows: [], rejected: [] };
  rows.forEach((cells, i) => {
    const rowNo = i + 1;
    const record: Record<string, string> = {};
    columns.forEach((col, j) => {
      if (col && cells[j] !== undefined && cells[j] !== "") record[col] = cells[j]!;
    });
    try {
      const built = compact(buildTrade(new Row(record, template), valuationDate)) as Trade;
      const extras: Partial<Trade> = {};
      if (record.name && !("name" in built)) extras.name = record.name;
      if (record.book) extras.book = record.book;
      if (record.uti) extras.uti = record.uti;
      out.trades.push({ ...built, ...extras } as Trade);
      out.rows.push(rowNo);
    } catch (e) {
      out.rejected.push({ row: rowNo, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  return out;
}

/** Markdown documentation of the templates (OpenAPI description and docs). */
export function csvTemplatesMarkdown(): string {
  const lines = [
    "CSV import (`content-type: text/csv`, `?type=<TradeType>`): header row, `;`/`,`/tab separated, German or plain numbers (`10.000.000,50`, `3,15 %`, `-20 bp`; a single dot is the decimal point, dots are thousands separators with a decimal comma or from two groups on), dates ISO or `DD.MM.YYYY`, tenors `5Y`. Common optional columns: `id`, `name`, `counterparty`, `book`, `uti`. Rows are mapped through the core builders; rejected rows are listed with their row number.",
    "",
  ];
  for (const t of Object.values(CSV_TEMPLATES)) {
    lines.push(
      `- **${t.type}** – required: ${t.required.map((c) => `\`${c}\``).join(", ")}; optional: ${t.optional.map((c) => `\`${c}\``).join(", ")}. ${t.notes}`,
    );
  }
  return lines.join("\n");
}

/** Template file (header + example row) for one type, semicolon separated. */
export function csvTemplateText(type: CsvTradeType): string {
  const t = CSV_TEMPLATES[type];
  return `${[...t.required, ...t.optional].join(";")}\n${t.example.join(";")}\n`;
}
