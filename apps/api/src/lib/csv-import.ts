/**
 * CSV trade import for `POST /api/trades/import` (`content-type: text/csv`,
 * market review N16, R6-2/R6-3). One column template per product (`?type=`,
 * `CSV_TRADE_TYPES` – eleven templates over the eight trade types; basis,
 * amortising and IMM swaps build `InterestRateSwap`s); every row is mapped
 * onto the corresponding core builder so the imported trades carry the
 * market-standard conventions of their currency. Rows that cannot be mapped
 * are reported per row (`rejected`, with the 1-based data row number) instead
 * of failing the whole upload; the route additionally checks every built trade
 * against the `Trade` JSON schema and rejects schema violations per row too.
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
  type FxOption,
  type Trade,
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
} from "@deriva/pricing-core";
import { describeRowError } from "./errors.js";

/**
 * `?type=` values of the CSV import – one column template per product the core
 * builders support (Markt R6-2). `BasisSwap`, `AmortisingSwap` and `ImmSwap`
 * build `InterestRateSwap` trades (see `CsvTemplate.tradeType`).
 */
export const CSV_TRADE_TYPES = [
  "InterestRateSwap",
  "FxForward",
  "CapFloor",
  "Swaption",
  "FxOption",
  "CrossCurrencySwap",
  "FRA",
  "FxSwap",
  "BasisSwap",
  "AmortisingSwap",
  "ImmSwap",
] as const;
export type CsvTradeType = (typeof CSV_TRADE_TYPES)[number];

/**
 * Type token of the workstation's CSV templates per API template (Markt R9-4): the leading `type` column every
 * API template file carries (`csvTemplateText`) so the same file imports in the Blotter, which reads the type from
 * the row. The API reader accepts the column when its token matches `?type=` (or the `?type=` value itself) and
 * rejects a mismatching row – the file's own type never overrides the query parameter silently.
 */
export const CSV_TYPE_TOKENS: Record<CsvTradeType, string> = {
  InterestRateSwap: "IRS",
  FxForward: "FXF",
  CapFloor: "CAP",
  Swaption: "SWPT",
  FxOption: "FXO",
  CrossCurrencySwap: "CCS",
  FRA: "FRA",
  FxSwap: "FXS",
  BasisSwap: "BASIS",
  AmortisingSwap: "AMORT",
  ImmSwap: "IMM",
};
/** Pseudo column of every template: the workstation's type token (header `type`, `typ` or `produkt`). */
export const TYPE_COLUMN = "type";
const normalizeTypeToken = (s: string): string => s.toUpperCase().replace(/[^A-Z]/g, "");

/**
 * Why a row's `type` cell does not fit the template (`undefined` = fits or empty): accepted are the workstation's
 * token (`IRS` for `?type=InterestRateSwap`) and the `?type=` value itself, case-insensitively. The message names the
 * `?type=` the row belongs to when its token is one of the eleven templates.
 */
export function csvTypeMismatch(cell: string, template: CsvTemplate): string | undefined {
  const token = normalizeTypeToken(cell);
  if (!token || token === CSV_TYPE_TOKENS[template.type] || token === normalizeTypeToken(template.type)) return undefined;
  const other = CSV_TRADE_TYPES.find((t) => CSV_TYPE_TOKENS[t] === token || normalizeTypeToken(t) === token);
  return (
    `type: "${cell.trim()}" does not match ?type=${template.type} (accepted: ${CSV_TYPE_TOKENS[template.type]}, ${template.type})` +
    (other ? ` – import this row with ?type=${other}` : "")
  );
}

/** Columns every template accepts (applied to the built trade). */
const COMMON_COLUMNS = ["id", "name", "counterparty", "book", "uti"] as const;
/** Optional columns shared by the fixed/float swap templates (vanilla, amortising, IMM). */
const SWAP_OPTIONS = ["index", "spread", "fixedFrequency", "floatFrequency", "collateralCurrency", "stepUp"] as const;

export interface CsvTemplate {
  type: CsvTradeType;
  /** `type` of the built trade (the `?type=` value names the template, not always the trade type). */
  tradeType: Trade["type"];
  required: readonly string[];
  optional: readonly string[];
  /**
   * Alternative vocabulary (Markt R8-4): when the header carries all of `columns`, the `replaces` required columns
   * need not be present – the workstation's FX-forward template writes `buyCurrency`/`buyAmount`/`sellCurrency`/
   * `sellAmount` instead of `pair`/`baseAmount`/`rate`.
   */
  alternative?: { readonly columns: readonly string[]; readonly replaces: readonly string[] };
  /** One example row in `[...required, ...optional]` order (German number format). */
  example: readonly string[];
  notes: string;
}

const COLLATERAL_NOTE =
  "`collateralCurrency`: ISO code of the CSA currency, empty = builder default, `none` (also `unbesichert`, `ohne`) = explicitly uncollateralised.";
const STEP_UP_NOTE = "`stepUp` = coupon steps `<date>:<rate>|<date>:<rate>` on the fixed leg (`2027-09-07:3,50 %|2028-09-07:4,00 %`).";
/** Unit rule of every `spread` column (Markt R8-4 – the same heuristic the workstation applies). */
export const SPREAD_UNIT_NOTE =
  "`spread` unit: `%` or `bp` suffix as written (`-20 bp`, `0,12 %`); a plain number with |x| ≥ 1 is read as basis points (`-20` = −20 bp), |x| < 1 as a decimal (`-0,002`) – the workstation reads and writes the same rule.";

export const CSV_TEMPLATES: Record<CsvTradeType, CsvTemplate> = {
  InterestRateSwap: {
    type: "InterestRateSwap",
    tradeType: "InterestRateSwap",
    required: ["currency", "notional", "payReceive", "fixedRate", "effectiveDate", "maturity"],
    optional: [...COMMON_COLUMNS, ...SWAP_OPTIONS],
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
      "",
    ],
    notes: `\`payReceive\` = direction of the fixed leg (Pay = payer swap); \`maturity\` tenor or date (alias \`tenor\`); \`index\` defaults to the currency's IBOR/RFR. ${STEP_UP_NOTE} ${SPREAD_UNIT_NOTE} ${COLLATERAL_NOTE}`,
  },
  FxForward: {
    type: "FxForward",
    tradeType: "FxForward",
    required: ["pair", "baseAmount", "rate", "deliveryDate"],
    optional: [...COMMON_COLUMNS, "buyCurrency", "buyAmount", "sellCurrency", "sellAmount"],
    alternative: { columns: ["buyCurrency", "buyAmount", "sellCurrency", "sellAmount"], replaces: ["pair", "baseAmount", "rate"] },
    example: ["EURUSD", "-2.000.000", "1,1725", "2027-03-15", "FXF-CSV-1", "", "CPTY-B", "", "", "", "", "", ""],
    notes:
      "`baseAmount` signed: positive = buy base / sell quote currency. Alternative vocabulary of the workstation's template (Markt R8-4): `buyCurrency`, `buyAmount`, `sellCurrency`, `sellAmount` instead of `pair`/`baseAmount`/`rate` (the trade buys `buyAmount` of `buyCurrency` against `sellAmount` of `sellCurrency`; `pair` = buy + sell currency, `rate` = `sellAmount` / `buyAmount`); when both vocabularies are filled, `pair`/`baseAmount`/`rate` win.",
  },
  CapFloor: {
    type: "CapFloor",
    tradeType: "CapFloor",
    required: ["currency", "notional", "capFloor", "strike", "effectiveDate", "maturity"],
    optional: [...COMMON_COLUMNS, "floorStrike", "index", "longShort"],
    example: ["EUR", "8.000.000", "Cap", "3,00 %", "2026-09-07", "5Y", "CAP-CSV-1", "", "CPTY-A", "", "", "", "EURIBOR-6M", "Long"],
    notes: "`capFloor` Cap | Floor | Collar (`floorStrike` for collars); `longShort` default Long.",
  },
  Swaption: {
    type: "Swaption",
    tradeType: "Swaption",
    required: ["currency", "notional", "payerReceiver", "strike", "expiry", "tenor"],
    optional: [...COMMON_COLUMNS, "settlement", "longShort"],
    example: ["EUR", "10.000.000", "Payer", "3,00 %", "1Y", "5Y", "SWPT-CSV-1", "", "CPTY-A", "", "", "Physical", "Long"],
    notes: "`expiry` (alias `expiryDate`) tenor from the market valuation date or a date; `tenor` of the underlying swap; `settlement` Physical | Cash.",
  },
  FxOption: {
    type: "FxOption",
    tradeType: "FxOption",
    required: ["pair", "optionType", "notional", "strike", "expiryDate"],
    optional: [...COMMON_COLUMNS, "deliveryDate", "longShort", "barrierType", "barrierLevel", "barrierRebate", "barrierHit"],
    example: ["EURUSD", "Put", "3.000.000", "1,15", "2027-06-15", "FXO-CSV-1", "", "CPTY-A", "", "", "", "Long", "", "", "", ""],
    notes:
      "`notional` in the base currency; `expiryDate` (alias `expiry` – the workstation's column) a date; `deliveryDate` defaults to the spot date of the expiry. Barrier options: `barrierType` UpIn | UpOut | DownIn | DownOut with `barrierLevel` (and optional `barrierRebate`); `barrierHit` true | false records an observed knock (N6-5) – without it the knock state is derived from spot / fixing with a `BARRIER_STATE_UNKNOWN:` warning.",
  },
  CrossCurrencySwap: {
    type: "CrossCurrencySwap",
    tradeType: "CrossCurrencySwap",
    required: ["pair", "domesticNotional", "effectiveDate", "tenor"],
    optional: [...COMMON_COLUMNS, "fxSpot", "foreignNotional", "spread", "fixedRate", "domesticPayReceive", "frequency", "collateralCurrency"],
    example: ["EURUSD", "10.000.000", "2026-09-07", "5Y", "CCS-CSV-1", "", "CPTY-A", "", "", "1,17", "", "-20 bp", "", "Receive", "3M", ""],
    notes:
      `exactly one of \`fxSpot\` / \`foreignNotional\` is required and fixes the foreign leg; \`spread\` on the domestic float leg (default 0) – ${SPREAD_UNIT_NOTE} \`fixedRate\` makes the domestic leg fixed. ` +
      "`collateralCurrency`: ISO code of the CSA currency, empty = market default (USD when one leg is USD, else the quote currency of the pair), `none` (also `unbesichert`, `ohne`) = explicitly uncollateralised – both legs on their own OIS curves, the built trade carries no `collateralCurrency` (same semantics as the web template's `collateral` column). " +
      "Column aliases (Markt R7-5 / R8-4 – the workstation's CCS template): `notional` → `domesticNotional`, `start` → `effectiveDate`, `maturity` → `tenor`, `rate` / `fixed rate` → `fixedRate`, `direction` / `payReceive` → `domesticPayReceive`, `collateral` / `csa` → `collateralCurrency`; a file exported by the workstation imports unchanged, and the workstation's template carries the API names.",
  },
  FRA: {
    type: "FRA",
    tradeType: "FRA",
    required: ["currency", "notional", "payReceive", "start", "rate"],
    optional: [...COMMON_COLUMNS, "index", "end", "period", "collateralCurrency"],
    alternative: { columns: ["period"], replaces: ["start"] },
    example: ["EUR", "5.000.000", "Pay", "3x9", "2,20 %", "FRA-CSV-1", "", "CPTY-B", "", "", "EURIBOR-6M", "", "", ""],
    notes: `\`start\` as period \`3x9\` (months from spot) or accrual start date (then \`end\` defaults to start + index tenor; alias \`maturity\`); the workstation's template writes the period in its own column \`period\` (Markt R8-4) – a filled \`period\` wins over \`start\`, an empty one leaves \`start\` in charge; \`payReceive\` Pay = pay fixed. ${COLLATERAL_NOTE}`,
  },
  FxSwap: {
    type: "FxSwap",
    tradeType: "FxSwap",
    required: ["pair", "baseAmount", "nearRate", "farRate", "nearDate", "farDate"],
    optional: [...COMMON_COLUMNS],
    example: ["EURUSD", "5.000.000", "1,1625", "1,1690", "2026-09-07", "2027-03-08", "FXS-CSV-1", "", "CPTY-B", "", ""],
    notes:
      "`baseAmount` signed: positive = buy base / sell quote at the near leg and the reverse at the far leg; `nearRate`/`farRate` all-in rates of the two legs; `farDate` must be after `nearDate`.",
  },
  BasisSwap: {
    type: "BasisSwap",
    tradeType: "InterestRateSwap",
    required: ["currency", "notional", "receiveIndex", "payIndex", "spread", "effectiveDate", "maturity"],
    optional: [...COMMON_COLUMNS],
    example: ["EUR", "10.000.000", "EURIBOR-6M", "EURIBOR-3M", "12 bp", "2026-09-07", "5Y", "BASIS-CSV-1", "", "CPTY-A", "", ""],
    notes: `tenor basis swap in one currency: receive \`receiveIndex\` + \`spread\` vs pay \`payIndex\`, both floating; the built trade is an \`InterestRateSwap\` with two float legs (leg 0 carries the spread). ${SPREAD_UNIT_NOTE}`,
  },
  AmortisingSwap: {
    type: "AmortisingSwap",
    tradeType: "InterestRateSwap",
    required: ["currency", "notional", "payReceive", "fixedRate", "effectiveDate", "maturity"],
    optional: [...COMMON_COLUMNS, "finalNotional", ...SWAP_OPTIONS],
    example: [
      "EUR",
      "10.000.000",
      "Pay",
      "3,00 %",
      "2026-09-07",
      "10Y",
      "AMORT-CSV-1",
      "",
      "CPTY-A",
      "",
      "",
      "2.000.000",
      "EURIBOR-6M",
      "",
      "1Y",
      "6M",
      "",
      "",
    ],
    notes:
      "linearly amortising fixed/float swap: the notional steps down evenly at each fixed-leg period start from `notional` to `finalNotional` (default 0 = full amortisation); the built trade is an `InterestRateSwap` with `notionalSchedule` on both legs. " +
      `${STEP_UP_NOTE} ${COLLATERAL_NOTE}`,
  },
  ImmSwap: {
    type: "ImmSwap",
    tradeType: "InterestRateSwap",
    required: ["currency", "notional", "payReceive", "fixedRate", "tenor"],
    optional: [...COMMON_COLUMNS, "from", ...SWAP_OPTIONS],
    example: ["EUR", "10.000.000", "Pay", "3,00 %", "2Y", "IMM-CSV-1", "", "CPTY-A", "", "", "", "EURIBOR-6M", "", "", "", "", ""],
    notes:
      'IMM-dated swap: effective on the next IMM date (third Wednesday of Mar/Jun/Sep/Dec) after `from` (a date; default = the market valuation date), maturity on the IMM date `tenor` later, coupons rolling on IMM dates (`roll: "IMM"`); the built trade is an `InterestRateSwap`. ' +
      `${STEP_UP_NOTE} ${COLLATERAL_NOTE}`,
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
  // Identity aliases: let the generic column names reach the vocabulary rules below (`notional` → `domesticNotional`
  // / `baseAmount`, `payReceive` → `domesticPayReceive` / `payerReceiver`, `rate` → `fixedRate`) – the workstation's
  // older CCS template used them (Markt R7-5).
  notional: "notional",
  payreceive: "payReceive",
  rate: "rate",
  maturity: "maturity",
  // Markt R8-4: the workstation's vocabulary for the swaption / FX-option / FRA / FX-forward templates.
  tenor: "tenor",
  expiry: "expiry",
  expirydate: "expiryDate",
  period: "period",
  periode: "period",
  buycurrency: "buyCurrency",
  kaufwährung: "buyCurrency",
  kaufwaehrung: "buyCurrency",
  buyamount: "buyAmount",
  kaufbetrag: "buyAmount",
  sellcurrency: "sellCurrency",
  verkaufswährung: "sellCurrency",
  verkaufswaehrung: "sellCurrency",
  sellamount: "sellAmount",
  verkaufsbetrag: "sellAmount",
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
  // R6-2 templates
  collateral: "collateralCurrency",
  csa: "collateralCurrency",
  besicherung: "collateralCurrency",
  collateralwährung: "collateralCurrency",
  collateralwaehrung: "collateralCurrency",
  aufschlag: "spread",
  basis: "spread",
  nahkurs: "nearRate",
  kursnah: "nearRate",
  fernkurs: "farRate",
  kursfern: "farRate",
  nahvaluta: "nearDate",
  valutanah: "nearDate",
  fernvaluta: "farDate",
  valutafern: "farDate",
  empfangsindex: "receiveIndex",
  zahlindex: "payIndex",
  restnominal: "finalNotional",
  endnominal: "finalNotional",
  zinstreppe: "stepUp",
  staffel: "stepUp",
  von: "from",
  ab: "from",
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
  // The workstation's type column (R9-4) is a pseudo column of every template – checked against `?type=`, never mapped onto the trade.
  if (key === "type" || key === "typ" || key === "produkt") return TYPE_COLUMN;
  const known = [...template.required, ...template.optional];
  const direct = known.find((c) => c.toLowerCase() === key);
  if (direct) return direct;
  const alias = ALIASES[key];
  if (alias && known.includes(alias)) return alias;
  // "start"/"maturity"/"tenor"/"expiry" aliases for the swaption/CCS/FRA/FX-option vocabularies (Markt R7-5, R8-4).
  if (alias === "effectiveDate" && known.includes("start")) return "start";
  if (alias === "start" && known.includes("effectiveDate")) return "effectiveDate";
  if (alias === "maturity" && known.includes("tenor")) return "tenor";
  if (alias === "maturity" && known.includes("end")) return "end";
  if (alias === "tenor" && known.includes("maturity")) return "maturity";
  if (alias === "fixedRate" && known.includes("rate")) return "rate";
  if (alias === "rate" && known.includes("fixedRate")) return "fixedRate";
  if (alias === "fixedRate" && known.includes("strike")) return "strike";
  if (alias === "expiry" && known.includes("expiryDate")) return "expiryDate";
  if (alias === "expiryDate" && known.includes("expiry")) return "expiry";
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

/**
 * Spread cell → decimal (Markt R8-4, the workstation's rule): a `%` / `bp` suffix is authoritative
 * (`-20 bp` → −0,002, `0,12 %` → 0,0012); a plain number with |x| ≥ 1 is basis points (`-20` → −0,002,
 * `5` → 0,0005), |x| < 1 a decimal (`-0,002`). A spread of a whole percentage point or more must
 * therefore carry its unit – which is what both templates write.
 */
export function parseCsvSpread(raw: string): number {
  const s = raw.trim();
  if (/(%|bp)$/i.test(s)) return parseCsvNumber(s);
  const v = parseCsvNumber(s);
  return Math.abs(v) >= 1 ? v / 10_000 : v;
}

/** Serial date from ISO (`2026-09-07`) or German (`07.09.2026`) input. */
export function parseCsvDate(raw: string): number {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseISO(s);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (de) return parseISO(`${de[3]!}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`);
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
const BOOL: Record<string, boolean> = { true: true, ja: true, yes: true, "1": true, false: false, nein: false, no: false, "0": false };
const bool = (raw: string, column: string): boolean => {
  const b = BOOL[raw.trim().toLowerCase()];
  if (b === undefined) throw new Error(`${column}: "${raw}" is not true | false`);
  return b;
};
const direction = (raw: string, column: string): "Pay" | "Receive" => {
  const d = DIRECTION[raw.trim().toLowerCase()];
  if (!d) throw new Error(`${column}: "${raw}" is not Pay | Receive`);
  return d;
};

/** Cell values meaning "explicitly uncollateralised" in the `collateralCurrency` column (R6-3; the web template's `collateral` column uses the same words). */
const UNCOLLATERALISED = new Set(["none", "unbesichert", "ohne", "-", "null", "uncollateralised", "uncollateralized", "keine"]);

/** `stepUp` column: `<date>:<rate>|<date>:<rate>` → fixed-leg coupon steps (dates ISO or German, rates decimal / `%` / `bp`). */
export function parseStepUp(raw: string): { date: number; rate: number }[] {
  const steps = raw
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const sep = entry.lastIndexOf(":");
      if (sep < 0) throw new Error(`stepUp: "${entry}" must be <date>:<rate> (e.g. 2027-09-07:3,50 %)`);
      return { date: parseCsvDate(entry.slice(0, sep)), rate: parseCsvNumber(entry.slice(sep + 1)) };
    });
  if (steps.length === 0) throw new Error(`stepUp: "${raw}" contains no <date>:<rate> entry`);
  return steps;
}

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
  /** Spread column with the unit heuristic (`parseCsvSpread`). */
  spread(col = "spread"): number {
    return parseCsvSpread(this.str(col));
  }
  optSpread(col = "spread"): number | undefined {
    return this.has(col) ? parseCsvSpread(this.cells[col]!) : undefined;
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
  /**
   * `collateralCurrency` cell: empty → `undefined` (builder default), `none`/`unbesichert`/… → `null`
   * (explicitly uncollateralised), otherwise an ISO-4217 code (R6-3).
   */
  collateral(col = "collateralCurrency"): string | null | undefined {
    const v = this.opt(col);
    if (v === undefined) return undefined;
    if (UNCOLLATERALISED.has(v.trim().toLowerCase())) return null;
    const u = v.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(u)) throw new Error(`${col}: "${v}" is not an ISO-4217 code or "none"`);
    return u;
  }
  /** Optional `stepUp` column. */
  stepUp(): { date: number; rate: number }[] | undefined {
    return this.has("stepUp") ? parseStepUp(this.cells.stepUp!) : undefined;
  }
}

/** Shared fixed/float swap parameters of the vanilla, amortising and IMM templates (`maturity`/`effectiveDate` handled by the caller). */
function swapParams(row: Row) {
  return {
    id: row.opt("id"),
    counterparty: row.opt("counterparty"),
    name: row.opt("name"),
    currency: row.currency("currency"),
    notional: row.num("notional"),
    payReceiveFixed: direction(row.str("payReceive"), "payReceive"),
    fixedRate: row.num("fixedRate"),
    index: row.opt("index"),
    spread: row.optSpread(),
    fixedFrequency: row.opt("fixedFrequency")?.toUpperCase(),
    floatFrequency: row.opt("floatFrequency")?.toUpperCase(),
    // Fixed/float swaps are uncollateralised by default, so `none` and empty coincide here.
    collateralCurrency: row.collateral() ?? undefined,
    stepUp: row.stepUp(),
  };
}

function buildTrade(row: Row, valuationDate: number): Trade {
  const common = { id: row.opt("id"), counterparty: row.opt("counterparty") };
  switch (row.template.type) {
    case "InterestRateSwap":
      return makeVanillaSwap({ ...swapParams(row), effectiveDate: row.date("effectiveDate"), maturity: dateOrTenor(row.str("maturity")) });
    case "AmortisingSwap":
      return makeAmortisingSwap({
        ...swapParams(row),
        effectiveDate: row.date("effectiveDate"),
        maturity: dateOrTenor(row.str("maturity")),
        finalNotional: row.optNum("finalNotional"),
      });
    case "ImmSwap":
      return makeImmSwap({ ...swapParams(row), from: row.has("from") ? row.date("from") : valuationDate, tenor: row.str("tenor").toUpperCase() });
    case "BasisSwap":
      return makeBasisSwap({
        ...common,
        name: row.opt("name"),
        currency: row.currency("currency"),
        notional: row.num("notional"),
        effectiveDate: row.date("effectiveDate"),
        maturity: dateOrTenor(row.str("maturity")),
        receiveIndex: row.str("receiveIndex").toUpperCase(),
        payIndex: row.str("payIndex").toUpperCase(),
        spread: row.spread(),
      });
    case "FxSwap":
      return makeFxSwap({
        ...common,
        pair: row.pair("pair"),
        baseAmount: row.num("baseAmount"),
        nearRate: row.num("nearRate"),
        farRate: row.num("farRate"),
        nearDate: row.date("nearDate"),
        farDate: row.date("farDate"),
      });
    case "FxForward": {
      if (row.has("pair") || !row.has("buyCurrency")) {
        return makeFxForward({
          ...common,
          pair: row.pair("pair"),
          baseAmount: row.num("baseAmount"),
          rate: row.num("rate"),
          deliveryDate: row.date("deliveryDate"),
        });
      }
      // Workstation vocabulary (Markt R8-4): buy `buyAmount` of `buyCurrency`, sell `sellAmount` of `sellCurrency`.
      const buyCurrency = row.currency("buyCurrency");
      const sellCurrency = row.currency("sellCurrency");
      const buyAmount = row.num("buyAmount");
      const sellAmount = row.num("sellAmount");
      if (buyCurrency === sellCurrency) throw new Error(`buyCurrency and sellCurrency must differ (got ${buyCurrency})`);
      if (!(buyAmount > 0) || !(sellAmount > 0)) throw new Error("buyAmount and sellAmount must be positive");
      const built = makeFxForward({
        ...common,
        pair: `${buyCurrency}${sellCurrency}`,
        baseAmount: buyAmount,
        rate: sellAmount / buyAmount,
        deliveryDate: row.date("deliveryDate"),
      });
      // Keep the amounts exactly as written (the builder's `sellAmount = buyAmount × rate` may differ in the last bit).
      return { ...built, buyCurrency, buyAmount, sellCurrency, sellAmount };
    }
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
    case "FxOption": {
      const option = makeFxOption({
        ...common,
        pair: row.pair("pair"),
        optionType: oneOf(row.str("optionType"), ["Call", "Put"] as const, "optionType"),
        notional: row.num("notional"),
        strike: row.num("strike"),
        expiryDate: row.date("expiryDate"),
        deliveryDate: row.has("deliveryDate") ? row.date("deliveryDate") : undefined,
        longShort: row.has("longShort") ? oneOf(row.str("longShort"), ["Long", "Short"] as const, "longShort") : undefined,
      });
      if (!row.has("barrierType") && !row.has("barrierLevel") && !row.has("barrierHit") && !row.has("barrierRebate")) return option;
      // Barrier columns come as a set: type + level, optional rebate and the observed knock flag (N6-5).
      const barrier: NonNullable<FxOption["barrier"]> = {
        type: oneOf(row.str("barrierType"), ["UpIn", "UpOut", "DownIn", "DownOut"] as const, "barrierType"),
        level: row.num("barrierLevel"),
      };
      if (row.has("barrierRebate")) barrier.rebate = row.num("barrierRebate");
      if (row.has("barrierHit")) barrier.hit = bool(row.str("barrierHit"), "barrierHit");
      return { ...option, barrier };
    }
    case "CrossCurrencySwap": {
      const params: CrossCurrencySwapParams = {
        ...common,
        name: row.opt("name"),
        pair: row.pair("pair"),
        domesticNotional: row.num("domesticNotional"),
        fxSpot: row.optNum("fxSpot"),
        foreignNotional: row.optNum("foreignNotional"),
        spread: row.optSpread() ?? 0,
        fixedRate: row.optNum("fixedRate"),
        domesticPayReceive: row.has("domesticPayReceive") ? direction(row.str("domesticPayReceive"), "domesticPayReceive") : undefined,
        effectiveDate: row.date("effectiveDate"),
        tenor: dateOrTenor(row.str("tenor")),
        frequency: row.opt("frequency")?.toUpperCase(),
        // `null` = explicitly uncollateralised (the builder then sets no `collateralCurrency`), `undefined` = market default.
        collateralCurrency: row.collateral(),
      };
      return makeCrossCurrencySwap(params);
    }
    case "FRA": {
      // The workstation writes the period (`3x6`) in its own column; a filled `period` wins, an empty one leaves `start` in charge.
      const start = (row.opt("period") ?? row.str("start")).trim();
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
        collateralCurrency: row.collateral() ?? undefined,
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
  // An alternative vocabulary (FX forward buy/sell quartet, FRA `period`) stands in for the required columns it replaces.
  const alt = template.alternative;
  const altPresent = alt !== undefined && alt.columns.every((c) => columns.includes(c));
  const missing = template.required.filter((c) => !columns.includes(c) && !(altPresent && alt.replaces.includes(c)));
  if (missing.length) {
    const hint =
      alt && !altPresent ? ` (or ${alt.columns.map((c) => `\`${c}\``).join(", ")} instead of ${alt.replaces.map((c) => `\`${c}\``).join(", ")})` : "";
    throw new Error(`CSV header lacks required column(s) for ${type}: ${missing.join(", ")}${hint} (header: ${header.join(", ")})`);
  }
  const out: CsvImportResult = { trades: [], rows: [], rejected: [] };
  rows.forEach((cells, i) => {
    const rowNo = i + 1;
    const record: Record<string, string> = {};
    columns.forEach((col, j) => {
      if (col && cells[j] !== undefined && cells[j] !== "") record[col] = cells[j]!;
    });
    // A `type` cell that names another template is a row error (R9-4) – `?type=` stays authoritative, nothing is imported under the wrong template.
    const mismatch = record[TYPE_COLUMN] !== undefined ? csvTypeMismatch(record[TYPE_COLUMN], template) : undefined;
    if (mismatch) {
      out.rejected.push({ row: rowNo, reason: mismatch });
      return;
    }
    try {
      const built = compact(buildTrade(new Row(record, template), valuationDate));
      const extras: Partial<Trade> = {};
      if (record.name && !("name" in built)) extras.name = record.name;
      if (record.book) extras.book = record.book;
      if (record.uti) extras.uti = record.uti;
      out.trades.push({ ...built, ...extras } as Trade);
      out.rows.push(rowNo);
    } catch (e) {
      // Builder / parser messages are user-facing; a programming error inside a builder is not (N4-05).
      out.rejected.push({ row: rowNo, reason: describeRowError(e) });
    }
  });
  return out;
}

/** The optional `type` column of every template file (R9-4) – documented once in the OpenAPI description and the request-body schema. */
export const TYPE_COLUMN_NOTE =
  "Every template file starts with an optional `type` column carrying the workstation's type token (`IRS`, `FXF`, `CAP`, `SWPT`, `FXO`, `CCS`, `FRA`, `FXS`, `BASIS`, `AMORT`, `IMM` – also accepted: the `?type=` value itself, case-insensitively; header aliases `typ`, `produkt`), so the same file imports in the workstation's Blotter, which reads the type from the row (Markt R9-4). The API ignores a matching or empty cell and rejects a row whose token names another template (`rejected`, reason `type: \"FXF\" does not match ?type=InterestRateSwap …`) – `?type=` stays authoritative, nothing is imported under the wrong template.";

/** Markdown documentation of the templates (OpenAPI description and docs). */
export function csvTemplatesMarkdown(): string {
  const lines = [
    "CSV import (`content-type: text/csv`, `?type=<Template>`): header row, `;`/`,`/tab separated, German or plain numbers (`10.000.000,50`, `3,15 %`, `-20 bp`; a single dot is the decimal point, dots are thousands separators with a decimal comma or from two groups on), dates ISO or `DD.MM.YYYY`, tenors `5Y`. Common optional columns: `id`, `name`, `counterparty`, `book`, `uti`; unknown columns (the workstation's `status`, `frequency`, `amortisation`) are ignored. " +
      `${TYPE_COLUMN_NOTE} ` +
      "Rows are mapped through the core builders and each built trade is checked against the `Trade` schema; a row that cannot be mapped or whose trade violates the schema is listed as `rejected` (`code: CSV_ROW_INVALID`) with its row number – it never fails the other rows. `?type=` names the template; `BasisSwap`, `AmortisingSwap` and `ImmSwap` build `InterestRateSwap` trades. " +
      `The eleven workstation templates (\`apps/web/src/lib/portfolio-io.ts\`, header and example row) import through the matching \`?type=\` unchanged (Markt R8-4): aliases \`tenor\` ↔ \`maturity\`, \`expiry\` ↔ \`expiryDate\`, \`period\` (FRA), \`buyCurrency\`/\`buyAmount\`/\`sellCurrency\`/\`sellAmount\` (FX forward), \`direction\`/\`rate\`/\`start\`/\`collateral\` (swaps, CCS). ${SPREAD_UNIT_NOTE}`,
    "",
  ];
  for (const t of Object.values(CSV_TEMPLATES)) {
    const builds = t.tradeType === t.type ? "" : ` (builds \`${t.tradeType}\`)`;
    lines.push(
      `- **${t.type}**${builds} (\`type\` token \`${CSV_TYPE_TOKENS[t.type]}\`) – required: ${t.required.map((c) => `\`${c}\``).join(", ")}; optional: ${t.optional.map((c) => `\`${c}\``).join(", ")}. ${t.notes}`,
    );
  }
  lines.push("", "Template files (`type` column first, then the required and optional columns; header + example row):", "");
  for (const type of CSV_TRADE_TYPES) lines.push("```", `# ?type=${type}`, csvTemplateText(type).trimEnd(), "```");
  return lines.join("\n");
}

/**
 * Template file (header + example row) for one type, semicolon separated – with the leading `type` column and the
 * workstation's token in the example row (R9-4), so the file also imports in the Blotter.
 */
export function csvTemplateText(type: CsvTradeType): string {
  const t = CSV_TEMPLATES[type];
  return `${[TYPE_COLUMN, ...t.required, ...t.optional].join(";")}\n${[CSV_TYPE_TOKENS[type], ...t.example].join(";")}\n`;
}
