import {
  type BarrierType,
  type Trade,
  SWAP_CONVENTIONS,
  addTenor,
  advance,
  getCalendar,
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
import { fmtDate, fmtNum } from "./format.js";
import { ccsCollateralCurrency } from "./templates.js";

/**
 * Bloomberg-style quick entry, e.g.
 *   "irs 10y pay 3.1% 10m"           → payer swap EUR 10Y 3.10% notional 10m
 *   "irs eur 5y rec 2.45 5000000"    → receiver swap
 *   "ois 2y pay 2.18 25m"            → €STR OIS
 *   "imm 2y pay 3% 10m"              → IMM-dated swap (next IMM date, IMM rolls)
 *   "cap 5y 3% 8m" | "floor 7y 1.5% 6m" | "collar 7y 3.5/1.5 6m"
 *   "swpt 1y5y payer 3% 10m [cash]"  | "swaption 2y10y rec 2.8 5m"
 *   "fxf eurusd 2m 1.1725 2027-03-15 [ndf]"  (positive = buy EUR, "-2m" = sell)
 *   "fxo eurusd put 1.15 3m 2027-06-15 [barrier do 1.05]" | "fxo eurchf call 0.95 2m 6m"
 *   "ccs eurusd 5y -20bp 10m [mtm]"    → cross-currency basis swap (€STR −20bp vs SOFR), optional MtM reset
 *   "fra 3x6 pay 2.2% 10m"             → forward rate agreement (period from the spot date)
 *   "irs 5y pay 2.5% 10m step 2.5/3.0/3.5" → step-up coupon: one rate per year from the start
 *   "@Landesbank" anywhere sets the counterparty ("irs 10y pay 3.1% 10m @Landesbank")
 *
 * Grammar hardening (Markt R6-1): every token must be understood. An unknown
 * word (a currency without conventions, a typo, an unsupported modifier) is an
 * error naming the token and what the branch accepts – it is never dropped
 * silently, so "irs sek …" cannot become a EUR swap. A second amount or rate is
 * an error too ("Betrag doppelt angegeben") instead of overriding the first.
 */
export interface ParseResult {
  ok: boolean;
  trade?: Trade;
  description?: string;
  error?: string;
}

function parseAmount(s: string): number | undefined {
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(k|m|mio|mrd|bn|b)?$/i.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]!.replace(",", "."));
  const unit = (m[2] ?? "").toLowerCase();
  const mult = unit === "k" ? 1e3 : unit === "m" || unit === "mio" ? 1e6 : unit === "mrd" || unit === "bn" || unit === "b" ? 1e9 : 1;
  return n * mult;
}

function parseRate(s: string): number | undefined {
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(%|bp)?$/i.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]!.replace(",", "."));
  if ((m[2] ?? "").toLowerCase() === "bp") return n / 1e4;
  // Rates below 0.5 without % are assumed already decimal (0.031) unless clearly a percent (2.45)
  if (!m[2] && Math.abs(n) < 0.5) return n;
  return n / 100;
}

const TENOR = /^\d+(?:d|w|m|y)$/i;
/** ISO date "2027-03-15" or German date "15.03.2027" / "15.03.27" (R4-06). */
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATE_DE = /^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})$/;
const DATE = { test: (t: string) => DATE_ISO.test(t) || DATE_DE.test(t) };
/** FRA period "3x6" (months from the spot date). */
const FRA_PERIOD = /^(\d{1,2})x(\d{1,2})$/i;
/** Step-up coupon list "2.5/3.0/3.5" (percent, one rate per year). */
const STEP_LIST = /^-?\d+(?:[.,]\d+)?(?:\/-?\d+(?:[.,]\d+)?)+$/;

/** Serial date of an ISO / German date token (undefined for impossible dates such as 31.02.). */
function parseDateToken(tok: string): number | undefined {
  if (DATE_ISO.test(tok)) {
    try {
      const d = parseISO(tok);
      return toISO(d) === tok ? d : undefined;
    } catch {
      return undefined;
    }
  }
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(tok);
  if (!m) return undefined;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  try {
    const d = parseISO(iso);
    return toISO(d) === iso ? d : undefined;
  } catch {
    return undefined;
  }
}

function parseDateOrTenor(tok: string, from: number): number | undefined {
  if (DATE.test(tok)) return parseDateToken(tok);
  if (TENOR.test(tok)) return advance(from, tok.toUpperCase(), getCalendar("TARGET"));
  return undefined;
}

/** Trade-name fragment of a date / tenor token: ISO and German dates become TT.MM.JJJJ (R3-11 / R4-06), tenors stay ("9M"). */
export function dateLabel(tok: string): string {
  if (DATE.test(tok)) {
    const d = parseDateToken(tok);
    return d !== undefined ? fmtDate(d) : tok;
  }
  return tok.toUpperCase();
}

const DATE_HINT = "Datum als 15.03.2027 oder 2027-03-15";

/** Plain price token (strike / forward rate): "1.15", "1,1725" or – for JPY-style pairs – "175" (R3-5b). */
const PRICE = /^\d+(?:[.,]\d+)?$/;

/** Market spot of a pair from the options, direct or via the inverse quotation. */
function spotOf(pair: string, opts: QuickEntryOptions): number | undefined {
  const spots = opts.fxSpots ?? {};
  const direct = spots[pair];
  if (direct !== undefined) return direct;
  const inverse = spots[`${pair.slice(3)}${pair.slice(0, 3)}`];
  return inverse ? 1 / inverse : undefined;
}

/** A price is plausible when it lies within 0.3× … 3× of the market spot (or when no spot is known). */
function priceImplausible(price: number, pair: string, opts: QuickEntryOptions): string | undefined {
  const spot = spotOf(pair, opts);
  if (spot === undefined || (price >= spot * 0.3 && price <= spot * 3)) return undefined;
  return `Kurs ${fmtNum(price, price >= 20 ? 2 : 4)} passt nicht zum Spot ${pair.slice(0, 3)}/${pair.slice(3)} ${fmtNum(spot, spot >= 20 ? 2 : 4)}`;
}

/**
 * Currencies the quick entry accepts for swaps, caps, swaptions and FRAs: every
 * currency with swap conventions in the core (`SWAP_CONVENTIONS`, incl. the
 * round-6 additions NOK / SEK / PLN / DKK) – read on each call so registrations
 * at runtime count.
 */
export function knownCurrencies(): string[] {
  return Object.keys(SWAP_CONVENTIONS).map((c) => c.toUpperCase());
}
function isCcy(tok: string): boolean {
  return /^[a-z]{3}$/i.test(tok) && knownCurrencies().includes(tok.toUpperCase());
}
/** Currency pair of two known currencies ("eurusd"); FX pairs may also name a currency without swap conventions (EURNOK before round 6). */
function isPair(tok: string): boolean {
  return /^[a-z]{6}$/i.test(tok) && (isCcy(tok.slice(0, 3)) || isCcy(tok.slice(3)));
}
const ccyList = () => knownCurrencies().join(", ");

const DIRECTION = new Set(["pay", "payer", "p", "rec", "receive", "receiver", "r", "call", "put", "c"]);
/** Modifier words of the grammar ("mtm" = MtM reset, "step" introduces the coupon list, "fixed" the CCS fixed rate, "cash" the swaption settlement, "ndf", "barrier"). */
const MODIFIERS = new Set(["mtm", "step", "staffel", "fixed", "fest", "fix", "cash", "physical", "physisch", "bar", "ndf", "barrier", "barriere"]);
/** Barrier type words after "barrier" ("do" = down-and-out …). */
const BARRIER_WORDS: Record<string, BarrierType> = {
  uo: "UpOut",
  ui: "UpIn",
  do: "DownOut",
  di: "DownIn",
  upout: "UpOut",
  upin: "UpIn",
  downout: "DownOut",
  downin: "DownIn",
  "up-out": "UpOut",
  "up-in": "UpIn",
  "down-out": "DownOut",
  "down-in": "DownIn",
  "up-and-out": "UpOut",
  "up-and-in": "UpIn",
  "down-and-out": "DownOut",
  "down-and-in": "DownIn",
};
const INDEX_RE = /^(euribor|estr|sofr|sonia|saron|tona|nowa|stibor|wibor|cibor|nibor|polonia|wiron|swestr|destr)/i;
const COMMANDS = new Set([
  "irs",
  "swap",
  "ois",
  "imm",
  "amort",
  "amortising",
  "cap",
  "floor",
  "collar",
  "swpt",
  "swaption",
  "fxf",
  "fxfwd",
  "forward",
  "fxo",
  "fxopt",
  "option",
  "basis",
  "tenorbasis",
  "fxs",
  "fxswap",
  "ccs",
  "xccy",
  "fra",
  "stichtag",
]);

/**
 * Whether a token is a *known* grammar token (currency, pair, direction, tenor,
 * number, rate, index, command). Only such tokens end an `@Kontrahent` phrase –
 * "GmbH", "Bank", "AG" or "Hessen" belong to the name (N-15).
 */
export function isGrammarToken(t: string): boolean {
  const tl = t.toLowerCase();
  if (/^[-+\d.,]/.test(t)) return true; // numbers, rates, amounts, dates, "1y5y"
  if (TENOR.test(t) || DATE.test(t)) return true;
  if (isCcy(t) || DIRECTION.has(tl) || COMMANDS.has(tl) || MODIFIERS.has(tl) || tl in BARRIER_WORDS) return true;
  if (FRA_PERIOD.test(t) || STEP_LIST.test(t)) return true;
  if (/^[a-z]{6}$/i.test(t) && isPair(t)) return true; // currency pair
  if (INDEX_RE.test(t)) return true;
  if (/^\d+m\/\d+m$/i.test(t) || /%$/.test(t) || /bp$/i.test(t)) return true;
  return false;
}

/**
 * Extract "@Kontrahent" phrases: the name runs from `@` until the next known
 * grammar token (or the end); `@"Deutsche Bank AG"` with quotes is also accepted.
 */
export function extractCounterparty(toks: string[]): { toks: string[]; counterparty?: string } {
  const out: string[] = [];
  const cp: string[] = [];
  let inCp = false;
  let quoted = false;
  for (const t of toks) {
    if (!quoted && t.startsWith("@")) {
      inCp = true;
      let name = t.slice(1);
      if (name.startsWith('"') || name.startsWith("„")) {
        quoted = true;
        name = name.slice(1);
      }
      if (name.endsWith('"') || name.endsWith("“")) {
        quoted = false;
        name = name.slice(0, -1);
      }
      if (name) cp.push(name);
    } else if (quoted) {
      let name = t;
      if (name.endsWith('"') || name.endsWith("“")) {
        quoted = false;
        name = name.slice(0, -1);
      }
      if (name) cp.push(name);
    } else if (inCp && !isGrammarToken(t)) cp.push(t);
    else {
      inCp = false;
      out.push(t);
    }
  }
  return { toks: out, counterparty: cp.length ? cp.join(" ") : undefined };
}

export interface QuickEntryOptions {
  /** Market FX spots ("EURUSD" → 1.17) – fix the foreign notional of a cross-currency swap when no rate is typed. */
  fxSpots?: Record<string, number>;
  /** Currencies with a swaption vol cube in the market – a swaption in another currency is flagged in the preview (Markt R4-2). */
  swaptionVolCurrencies?: string[];
  /** Currency pairs with an FX vol surface in the market – an option on another pair is flagged in the preview (Markt R5-2). */
  fxVolPairs?: string[];
  /**
   * Currencies with a discount curve in the current market (`Object.keys(discountCurveId)`). A swap, cap, swaption or
   * FRA in a known currency without a curve is an error naming the remedy ("+ Kurve" in the curves view) instead of a
   * trade that cannot be priced (Markt R6-1 / R6-5).
   */
  curveCurrencies?: string[];
}

/** Whether the market has an FX vol surface for `pair` (direct or inverse quotation). */
export function hasFxVolSurface(pair: string, pairs: string[] | undefined): boolean {
  if (!pairs) return true;
  const inv = `${pair.slice(3)}${pair.slice(0, 3)}`;
  return pairs.includes(pair) || pairs.includes(inv);
}

/** Preview warning for an FX option on a pair without a vol surface (core fallback 8 %, IFRS-13 Level 3) – Markt R5-2. */
export function fxVolWarning(pair: string, pairs: string[] | undefined): string {
  return hasFxVolSurface(pair, pairs) ? "" : ` · ⚠ keine FX-Vol-Fläche für ${pair.slice(0, 3)}/${pair.slice(3)} (Fallback 8 %, Level 3)`;
}

/* ---------- token-level errors (R6-1) ---------- */

/** German error for a token the branch cannot interpret – names the token, the currencies and the branch grammar. */
export function unknownTokenError(tok: string, grammar: string): string {
  // "Unbekannte Währung" only where the grammar takes a currency token ([ccy]); pair-based branches report a plain token.
  const ccyLike = /\[ccy\]/.test(grammar) && /^[a-z]{3}$/i.test(tok) && !isCcy(tok) && !MODIFIERS.has(tok.toLowerCase()) && !DIRECTION.has(tok.toLowerCase());
  const head = ccyLike ? `Unbekannte Währung „${tok.toUpperCase()}“` : `Unbekanntes Token „${tok}“`;
  return `${head} – Währungen: ${ccyList()}; erwartet: ${grammar}`;
}
const fail = (error: string): ParseResult => ({ ok: false, error });
/** A rate product in a currency the market has no curve for (R6-5). */
function noCurveError(ccy: string, opts: QuickEntryOptions): ParseResult | undefined {
  if (!opts.curveCurrencies || opts.curveCurrencies.includes(ccy)) return undefined;
  return fail(
    `Keine Kurve für ${ccy} im Markt – in der Kurvenansicht mit „+ Kurve“ aus Quotes anlegen (Währungen mit Kurve: ${opts.curveCurrencies.join(", ")})`,
  );
}
const duplicate = (what: "Betrag" | "Satz" | "Laufzeit" | "Kurs" | "Datum" | "Betrag oder Laufzeit", first: string, second: string): ParseResult =>
  fail(
    `${what} doppelt angegeben („${first}“ und „${second}“) – bitte nur einmal nennen${what === "Betrag oder Laufzeit" ? " (Betrag vor der Laufzeit: 3m = 3 Mio., 9m = 9 Monate)" : ""}`,
  );
/** "6m" is an amount (6 Mio.) and a tenor (6 Monate) – a third such token cannot be placed. */
const AMOUNT_RE = /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i;
const ambiguousDuplicate = (leftover: string, amtTok: string | undefined, dateTok: string | undefined): ParseResult | undefined => {
  if (!AMOUNT_RE.test(leftover)) return undefined;
  if (TENOR.test(leftover) && dateTok) return duplicate("Betrag oder Laufzeit", amtTok ?? dateTok, leftover);
  return duplicate("Betrag", amtTok!, leftover);
};

/** Tracks the notional token so a second amount is reported instead of silently overriding the first. */
class AmountSlot {
  tok: string | undefined;
  value: number;
  constructor(defaultValue: number) {
    this.value = defaultValue;
  }
  /** Returns an error result when the token is a second amount, `true` when consumed, `false` when it is no amount. */
  take(t: string): boolean | ParseResult {
    const amt = parseAmount(t);
    if (amt === undefined) return false;
    if (this.tok !== undefined) return duplicate("Betrag", this.tok, t);
    this.tok = t;
    this.value = amt;
    return true;
  }
}

const GRAMMAR = {
  irs: "irs|swap|ois|imm|amort [ccy] <tenor> pay|rec <rate%> [notional] [index] [step r1/r2/…] [@Kontrahent]",
  capfloor: "cap|floor|collar [ccy] <tenor> <strike%>[/<floorStrike%>] [notional] [@Kontrahent]",
  swpt: "swpt [ccy] <expiry>x<tenor> payer|receiver <strike%> [notional] [cash|physical] [@Kontrahent]",
  fxf: "fxf <pair> <±betrag> [kurs] <datum|tenor> [ndf] [@Kontrahent]",
  fxo: "fxo <pair> call|put <strike> [notional] <datum|tenor> [barrier uo|ui|do|di <level>] [@Kontrahent]",
  fxs: "fxs <pair> <±betrag> <nearKurs> <farKurs> <farDatum|tenor> [@Kontrahent]",
  ccs: "ccs <pair> <tenor> [spreadbp] [notional] [mtm] [pay|rec] [fxSpot] [fixed <rate%>] [@Kontrahent]",
  basis: "basis [ccy] <tenor> <recTenor>/<payTenor> [spreadbp] [notional] [@Kontrahent]",
  fra: "fra [ccy] <NxM> pay|rec <rate%> [notional] [index] [@Kontrahent]",
};

export function parseQuickEntry(input: string, valuationDate: number, opts: QuickEntryOptions = {}): ParseResult {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0) return { ok: false };
  const { toks, counterparty } = extractCounterparty(raw);
  if (toks.length === 0) return { ok: false };
  const r = parseCore(toks, valuationDate, opts);
  if (r.ok && r.trade && counterparty) {
    r.trade = { ...r.trade, counterparty };
    r.description = `${r.description} · @${counterparty}`;
  }
  return r;
}

function parseCore(toks: string[], valuationDate: number, opts: QuickEntryOptions): ParseResult {
  const cmd = toks[0]!.toLowerCase();
  const rest = toks.slice(1);
  const cal = getCalendar("TARGET");
  const spot = advance(valuationDate, "2D", cal);
  try {
    if (["basis", "tenorbasis"].includes(cmd)) {
      // basis [ccy] <tenor> <recIdx>/<payIdx> [spreadbp] [notional]   e.g. "basis 5y 3m/6m 5bp 10m"
      let ccy = "EUR";
      let tenor: string | undefined;
      let rec = "EURIBOR-3M";
      let pay = "EURIBOR-6M";
      let spread = 0;
      const notional = new AmountSlot(10_000_000);
      for (const t of rest) {
        if (isCcy(t)) ccy = t.toUpperCase();
        else if (/^\d+m\/\d+m$/i.test(t)) {
          const [a, b] = t.toUpperCase().split("/");
          rec = `EURIBOR-${a}`;
          pay = `EURIBOR-${b}`;
        } else if (/bp$/i.test(t)) spread = parseRate(t) ?? 0;
        else if (TENOR.test(t) && !tenor) tenor = t.toUpperCase();
        else {
          const taken = notional.take(t);
          if (taken === false) return fail(unknownTokenError(t, GRAMMAR.basis));
          if (taken !== true) return taken;
        }
      }
      if (!tenor) return fail("Laufzeit fehlt (z.B. basis 5y 3m/6m 5bp 10m)");
      const noCurve = noCurveError(ccy, opts);
      if (noCurve) return noCurve;
      const trade = makeBasisSwap({
        name: `Basis-Swap ${rec.replace("EURIBOR-", "")}/${pay.replace("EURIBOR-", "")} ${tenor}`,
        currency: ccy,
        notional: notional.value,
        effectiveDate: spot,
        maturity: tenor,
        receiveIndex: rec,
        payIndex: pay,
        spread,
      });
      return {
        ok: true,
        trade,
        description: `Basis-Swap ${rec} ${spread >= 0 ? "+" : ""}${fmtNum(spread * 1e4, 1)} bp vs ${pay} ${tenor} · Nominal ${fmtNum(notional.value, 0)}`,
      };
    }
    if (["fxs", "fxswap"].includes(cmd)) {
      // fxs <pair> <±baseAmount> <nearRate> <farRate> <farDate|tenor>
      const pair = rest.find((t) => isPair(t))?.toUpperCase();
      const amtIdx = rest.findIndex((t) => /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i.exec(t) !== null);
      const amtTok = amtIdx >= 0 ? rest[amtIdx] : undefined;
      const rates = rest.filter((t, i) => i !== amtIdx && /^\d+[.,]\d{2,}$/.test(t));
      const dateTok = rest.find((t, i) => i !== amtIdx && (DATE.test(t) || TENOR.test(t)));
      const used = new Set<string>([pair?.toLowerCase() ?? "", amtTok ?? "", dateTok ?? "", ...rates.slice(0, 2)]);
      const leftover = rest.find((t) => !used.has(t) && !used.has(t.toLowerCase()));
      if (leftover !== undefined) {
        if (rates.length > 2 && rates.includes(leftover)) return duplicate("Kurs", rates[1]!, leftover);
        const dup = ambiguousDuplicate(leftover, amtTok, dateTok);
        if (dup) return dup;
        if (DATE.test(leftover) || TENOR.test(leftover)) return duplicate("Datum", dateTok!, leftover);
        return fail(unknownTokenError(leftover, GRAMMAR.fxs));
      }
      if (!pair || !amtTok || !dateTok) return fail(`Format: fxs eurusd 1m 1.1625 1.18 1y (${GRAMMAR.fxs})`);
      const nearRate = rates[0] ? Number(rates[0].replace(",", ".")) : 1;
      const farRate = rates[1] ? Number(rates[1].replace(",", ".")) : nearRate;
      const farDate = parseDateOrTenor(dateTok, spot);
      if (farDate === undefined) return fail(`Ungültiges Datum „${dateTok}“ – ${DATE_HINT}`);
      const trade = {
        ...makeFxSwap({ pair, baseAmount: parseAmount(amtTok)!, nearRate, farRate, nearDate: spot, farDate }),
        name: `FX-Swap ${pair.slice(0, 3)}/${pair.slice(3)} ${dateLabel(dateTok)}`,
      };
      return { ok: true, trade, description: `FX-Swap ${pair} ${amtTok} @ ${fmtNum(nearRate, 4)}/${fmtNum(farRate, 4)} · Far ${dateTok}` };
    }
    if (["ccs", "xccy"].includes(cmd)) {
      // ccs <pair> <tenor> [spreadbp] [notional] [mtm] [fixed <rate%>]   e.g. "ccs eurusd 5y -20bp 10m mtm", "ccs eurusd 5y fixed 3% 10m"
      let pair: string | undefined;
      let tenor: string | undefined;
      let spread = 0;
      const notional = new AmountSlot(10_000_000);
      let mtm = false;
      let fxSpot: number | undefined;
      let fixedRate: number | undefined;
      let expectFixed = false;
      let pr: "Pay" | "Receive" = "Receive";
      for (const t of rest) {
        const tl = t.toLowerCase();
        if (expectFixed) {
          // "fixed 3%" / "fixed 3.00" → fixed-vs-float CCS (R3-5a); a missing rate falls through to the normal tokens.
          expectFixed = false;
          const r = /^-?\d+(?:[.,]\d+)?%?$/.test(t) ? parseRate(t.endsWith("%") ? t : `${t}%`) : undefined;
          if (r !== undefined) {
            fixedRate = r;
            continue;
          }
        }
        if (/^[a-z]{6}$/i.test(t) && isPair(t)) pair = t.toUpperCase();
        else if (TENOR.test(t) && !tenor) tenor = t.toUpperCase();
        else if (/bp$/i.test(t)) spread = parseRate(t) ?? 0;
        else if (tl === "mtm") mtm = true;
        else if (tl === "fixed" || tl === "fest" || tl === "fix") expectFixed = true;
        else if (/%$/.test(t)) fixedRate = parseRate(t);
        else if (["pay", "payer", "p"].includes(tl)) pr = "Pay";
        else if (["rec", "receive", "receiver", "r"].includes(tl)) pr = "Receive";
        else if (/^\d+[.,]\d{2,}$/.test(t)) fxSpot = Number(t.replace(",", "."));
        else {
          const taken = notional.take(t);
          if (taken === false) return fail(unknownTokenError(t, GRAMMAR.ccs));
          if (taken !== true) return taken;
        }
      }
      if (!pair || !tenor) return fail(`Format: ccs eurusd 5y -20bp 10m [mtm] [fixed 3%]`);
      const dom = pair.slice(0, 3);
      const forCcy = pair.slice(3);
      // Foreign notional = domestic × spot: typed rate first, then the market spot (direct or inverse quotation).
      const spots = opts.fxSpots ?? {};
      const inverse = spots[`${forCcy}${dom}`];
      const rate = fxSpot ?? spots[pair] ?? (inverse ? 1 / inverse : undefined);
      if (rate === undefined) return fail(`FX-Spot für ${dom}/${forCcy} fehlt – Kurs angeben (z.B. ccs ${pair.toLowerCase()} 5y -20bp 10m 1.17)`);
      const trade = makeCrossCurrencySwap({
        name: `Cross-Currency-Swap ${dom}/${forCcy} ${tenor} ${fixedRate !== undefined ? `fest ${fmtNum(fixedRate * 100, 2)} %` : `${fmtNum(spread * 1e4, 1)} bp`}${mtm ? " MtM" : ""}`,
        pair,
        domesticNotional: notional.value,
        fxSpot: rate,
        spread,
        fixedRate,
        effectiveDate: spot,
        tenor,
        mtmReset: mtm,
        domesticPayReceive: pr,
        // CSA in the foreign currency activates the Xccy-basis discount curve of the sample market (Markt R3-1).
        collateralCurrency: ccsCollateralCurrency(pair),
      });
      const legDesc =
        fixedRate !== undefined
          ? `Fest ${fmtNum(fixedRate * 100, 2)} % ${dom} vs ${forCcy}-RFR`
          : `${pr === "Receive" ? "Erhalte" : "Zahle"} ${dom} ${spread >= 0 ? "+" : ""}${fmtNum(spread * 1e4, 1)} bp`;
      return {
        ok: true,
        trade,
        description: `Cross-Currency-Swap ${dom}/${forCcy} ${tenor} · ${legDesc} · Nominal ${fmtNum(notional.value, 0)} ${dom} @ ${fmtNum(rate, 4)}${mtm ? " · MtM-Reset" : ""}`,
      };
    }
    if (cmd === "fra") {
      // fra [ccy] <NxM> pay|rec <rate%> [notional] [index]   e.g. "fra 3x6 pay 2.2% 10m"
      let ccy = "EUR";
      let period: string | undefined;
      let pr: "Pay" | "Receive" = "Pay";
      let rate: number | undefined;
      let rateTok: string | undefined;
      const notional = new AmountSlot(10_000_000);
      let index: string | undefined;
      for (const t of rest) {
        const tl = t.toLowerCase();
        if (isCcy(t)) ccy = t.toUpperCase();
        else if (FRA_PERIOD.test(t) && !period) period = t.toLowerCase();
        else if (["pay", "payer", "p"].includes(tl)) pr = "Pay";
        else if (["rec", "receive", "receiver", "r"].includes(tl)) pr = "Receive";
        else if (
          /%$/.test(t) ||
          /bp$/i.test(t) ||
          (rate === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t))
        ) {
          if (rateTok !== undefined) return duplicate("Satz", rateTok, t);
          rate = parseRate(t);
          rateTok = t;
        } else if (INDEX_RE.test(t)) index = t.toUpperCase().replace("EURIBOR", "EURIBOR-").replace("--", "-");
        else {
          const taken = notional.take(t);
          if (taken === false) return fail(unknownTokenError(t, GRAMMAR.fra));
          if (taken !== true) return taken;
        }
      }
      if (!period) return fail("Periode fehlt (z.B. fra 3x6 pay 2.2% 10m)");
      const m = FRA_PERIOD.exec(period)!;
      if (Number(m[2]) <= Number(m[1])) return fail("FRA-Periode: Ende muss nach dem Start liegen (z.B. 3x6)");
      if (rate === undefined) return fail("Festsatz fehlt (z.B. 2.2%)");
      const noCurve = noCurveError(ccy, opts);
      if (noCurve) return noCurve;
      // The index follows the period length inside the core builder (3x6 → EURIBOR-3M) unless typed explicitly.
      const trade = makeFra({
        name: `FRA ${ccy} ${period} ${pr === "Pay" ? "Zahler" : "Empfänger"}`,
        currency: ccy,
        notional: notional.value,
        payReceive: pr,
        start: period,
        rate,
        index,
        valuationDate,
      });
      return {
        ok: true,
        trade,
        description: `FRA ${ccy} ${period} · Fest ${pr === "Pay" ? "zahlen" : "erhalten"} @ ${fmtNum(rate * 100, 3)} % · Nominal ${fmtNum(notional.value, 0)} · ${trade.index}`,
      };
    }
    if (["irs", "swap", "ois", "imm", "amort", "amortising"].includes(cmd)) {
      let ccy = "EUR";
      let tenor: string | undefined;
      let pr: "Pay" | "Receive" = "Pay";
      let rate: number | undefined;
      let rateTok: string | undefined;
      const notional = new AmountSlot(10_000_000);
      let index: string | undefined;
      let steps: number[] | undefined;
      let expectSteps = false;
      for (const t of rest) {
        const tl = t.toLowerCase();
        if (expectSteps) {
          expectSteps = false;
          if (STEP_LIST.test(t) || /^-?\d+(?:[.,]\d+)?%?$/.test(t)) {
            steps = t.split("/").map((x) => parseRate(x.endsWith("%") ? x : `${x}%`)!);
            continue;
          }
        }
        if (tl === "step" || tl === "staffel") expectSteps = true;
        else if (isCcy(t)) ccy = t.toUpperCase();
        else if (TENOR.test(t) && tenor === undefined) tenor = t.toUpperCase();
        else if (["pay", "payer", "p"].includes(tl)) pr = "Pay";
        else if (["rec", "receive", "receiver", "r"].includes(tl)) pr = "Receive";
        else if (
          /%$/.test(t) ||
          /bp$/i.test(t) ||
          (rate === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t) && rest.indexOf(t) !== rest.length - 1)
        ) {
          if (rateTok !== undefined) return duplicate("Satz", rateTok, t);
          rate = parseRate(t);
          rateTok = t;
        } else if (INDEX_RE.test(t)) index = t.toUpperCase().replace("EURIBOR", "EURIBOR-").replace("--", "-");
        else {
          const taken = notional.take(t);
          if (taken === false) return fail(unknownTokenError(t, GRAMMAR.irs));
          if (taken !== true) return taken;
        }
      }
      if (!tenor) return fail("Laufzeit fehlt (z.B. 10Y)");
      const noCurve = noCurveError(ccy, opts);
      if (noCurve) return noCurve;
      // "step" without a coupon list is a typo, not a plain swap (R3-10).
      if (expectSteps || (rest.some((t) => t.toLowerCase() === "step" || t.toLowerCase() === "staffel") && !steps))
        return fail("step ohne Stufen – Format: step 2,5/3,0/3,5 (eine Stufe je Jahr)");
      if (rate === undefined) {
        // Take last plain number as rate if no notional-unit
        rate = 0.03;
      }
      if (cmd === "ois" && !index) index = SWAP_CONVENTIONS[ccy]?.oisIndex ?? "ESTR";
      const isAmort = cmd.startsWith("amort");
      const isImm = cmd === "imm";
      // Step-up coupon: the first list entry is the initial coupon, every further entry starts one year later.
      if (steps && steps.length > 0) rate = steps[0]!;
      const stepUp = steps && steps.length > 1 ? steps.slice(1).map((r, i) => ({ date: addTenor(spot, `${i + 1}Y`), rate: r })) : undefined;
      const name = `${isAmort ? "Amortisierender " : isImm ? "IMM-" : ""}${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor}${cmd === "ois" ? " OIS" : ""}${stepUp ? " Staffel" : ""}`;
      const params = {
        name,
        currency: ccy,
        notional: notional.value,
        payReceiveFixed: pr,
        fixedRate: rate,
        effectiveDate: spot,
        maturity: tenor,
        index,
        stepUp,
      };
      const trade = isAmort ? makeAmortisingSwap(params) : isImm ? makeImmSwap({ ...params, from: valuationDate, tenor }) : makeVanillaSwap(params);
      const immNote = isImm && trade.type === "InterestRateSwap" ? ` · IMM ab ${fmtDate(trade.legs[0]!.effectiveDate)}` : "";
      return {
        ok: true,
        trade,
        description: `${isImm ? "IMM-" : ""}${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor} @ ${fmtNum(rate * 100, 3)} %${stepUp ? ` → ${steps!.map((r) => fmtNum(r * 100, 2)).join(" / ")} % Staffel` : ""} · Nominal ${fmtNum(notional.value, 0)}${index ? ` · ${index}` : ""}${isAmort ? " · linear amortisierend" : ""}${immNote}`,
      };
    }
    if (["cap", "floor", "collar"].includes(cmd)) {
      let tenor: string | undefined;
      let strike: number | undefined;
      let strikeTok: string | undefined;
      let floorStrike: number | undefined;
      const notional = new AmountSlot(10_000_000);
      let ccy = "EUR";
      for (const t of rest) {
        if (isCcy(t)) ccy = t.toUpperCase();
        else if (TENOR.test(t) && !tenor) tenor = t.toUpperCase();
        else if (/^-?\d+(?:[.,]\d+)?%?\/-?\d+(?:[.,]\d+)?%?$/.test(t)) {
          if (strikeTok !== undefined) return duplicate("Satz", strikeTok, t);
          const [a, b] = t.split("/");
          strike = parseRate(a!);
          floorStrike = parseRate(b!);
          strikeTok = t;
        } else if (
          /%$/.test(t) ||
          /bp$/i.test(t) ||
          (strike === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t))
        ) {
          if (strikeTok !== undefined) return duplicate("Satz", strikeTok, t);
          strike = parseRate(t);
          strikeTok = t;
        } else {
          const taken = notional.take(t);
          if (taken === false) return fail(unknownTokenError(t, GRAMMAR.capfloor));
          if (taken !== true) return taken;
        }
      }
      if (!tenor || strike === undefined) return fail("Laufzeit und Strike erforderlich (z.B. cap 5y 3% 8m)");
      const noCurve = noCurveError(ccy, opts);
      if (noCurve) return noCurve;
      const capFloor = cmd === "cap" ? "Cap" : cmd === "floor" ? "Floor" : "Collar";
      const trade = {
        ...makeCapFloor({ currency: ccy, notional: notional.value, capFloor, strike, floorStrike, effectiveDate: spot, maturity: tenor }),
        name: `${capFloor} ${ccy} ${tenor} ${fmtNum(strike * 100, 2)} %${floorStrike !== undefined ? ` / ${fmtNum(floorStrike * 100, 2)} %` : ""}`,
      };
      return {
        ok: true,
        trade,
        description: `${capFloor} ${ccy} ${tenor} @ ${fmtNum(strike * 100, 2)} %${floorStrike !== undefined ? ` / ${fmtNum(floorStrike * 100, 2)} %` : ""} · Nominal ${fmtNum(notional.value, 0)}`,
      };
    }
    if (["swpt", "swaption"].includes(cmd)) {
      // swpt [ccy] <expiry>x<tenor> payer|receiver <strike%> [notional] [cash|physical]   e.g. "swpt usd 1y5y payer 3.5% 10m cash" (Markt R4-2 / R6-1)
      let expiry: string | undefined;
      let tenor: string | undefined;
      let pr: "Payer" | "Receiver" = "Payer";
      let strike: number | undefined;
      let strikeTok: string | undefined;
      const notional = new AmountSlot(10_000_000);
      let ccy = "EUR";
      let settlement: "Physical" | "Cash" | undefined;
      for (const t of rest) {
        const tl = t.toLowerCase();
        const m = /^(\d+[ymd])x?(\d+[ymd])$/i.exec(t);
        if (m) {
          expiry = m[1]!.toUpperCase();
          tenor = m[2]!.toUpperCase();
        } else if (isCcy(t)) ccy = t.toUpperCase();
        else if (["payer", "pay", "p"].includes(tl)) pr = "Payer";
        else if (["receiver", "rec", "r"].includes(tl)) pr = "Receiver";
        else if (tl === "cash" || tl === "bar") settlement = "Cash";
        else if (tl === "physical" || tl === "physisch") settlement = "Physical";
        else if (
          /%$/.test(t) ||
          /bp$/i.test(t) ||
          (strike === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t))
        ) {
          if (strikeTok !== undefined) return duplicate("Satz", strikeTok, t);
          strike = parseRate(t);
          strikeTok = t;
        } else {
          const taken = notional.take(t);
          if (taken === false) return fail(unknownTokenError(t, GRAMMAR.swpt));
          if (taken !== true) return taken;
        }
      }
      if (!expiry || !tenor) return fail("Format: swpt [usd] 1y5y payer 3% 10m [cash]");
      const noCurve = noCurveError(ccy, opts);
      if (noCurve) return noCurve;
      const trade = {
        ...makeSwaption({ currency: ccy, notional: notional.value, payerReceiver: pr, strike: strike ?? 0.03, expiry, tenor, valuationDate, settlement }),
        name: `${pr}-Swaption ${ccy} ${expiry}×${tenor}${settlement === "Cash" ? " (Cash)" : ""}`,
      };
      // A currency without a vol cube in the market prices on the core's fallback vol (Level 3) – say so in the preview.
      const noCube = opts.swaptionVolCurrencies && !opts.swaptionVolCurrencies.includes(ccy);
      return {
        ok: true,
        trade,
        description: `${pr}-Swaption ${ccy} ${expiry}x${tenor} @ ${fmtNum((strike ?? 0.03) * 100, 3)} % · Nominal ${fmtNum(notional.value, 0)}${
          settlement === "Cash" ? " · Barausgleich" : settlement === "Physical" ? " · physisch" : ""
        }${noCube ? ` · ⚠ kein Swaption-Vol-Cube für ${ccy} (Fallback-Vol, Level 3)` : ""}`,
      };
    }
    if (["fxf", "fxfwd", "forward"].includes(cmd)) {
      const pair = rest.find((t) => isPair(t))?.toUpperCase();
      const amtIdx = rest.findIndex((t) => /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i.test(t));
      const amtTok = amtIdx >= 0 ? rest[amtIdx] : undefined;
      const dateTok = rest.find((t, i) => i !== amtIdx && (DATE.test(t) || TENOR.test(t)));
      const rateTok = rest.find((t) => t !== amtTok && t !== dateTok && PRICE.test(t));
      const ndf = rest.some((t) => t.toLowerCase() === "ndf");
      const used = new Set<string>([pair?.toLowerCase() ?? "", amtTok ?? "", dateTok ?? "", rateTok ?? "", "ndf"]);
      const leftover = rest.find((t) => !used.has(t) && !used.has(t.toLowerCase()));
      if (leftover !== undefined) {
        const dup = ambiguousDuplicate(leftover, amtTok, dateTok);
        if (dup) return dup;
        if (PRICE.test(leftover) && rateTok) return duplicate("Kurs", rateTok, leftover);
        if (DATE.test(leftover) || TENOR.test(leftover)) return duplicate("Datum", dateTok!, leftover);
        return fail(unknownTokenError(leftover, GRAMMAR.fxf));
      }
      if (!pair || !amtTok || !dateTok) return fail(`Format: fxf eurusd 2m 1.1725 15.03.2027 (${DATE_HINT} oder Tenor)`);
      const delivery = parseDateOrTenor(dateTok, spot);
      if (delivery === undefined) return fail(`Ungültiges Datum „${dateTok}“ – ${DATE_HINT}`);
      const rate = rateTok ? Number(rateTok.replace(",", ".")) : undefined;
      if (rate !== undefined) {
        const bad = priceImplausible(rate, pair, opts);
        if (bad) return fail(bad);
      }
      const base = parseAmount(amtTok)!;
      const fwd = makeFxForward({ pair, baseAmount: base, rate: rate ?? 1, deliveryDate: delivery });
      const trade = {
        ...fwd,
        name: `${base < 0 ? "Verkauf" : "Kauf"} ${pair.slice(0, 3)}/${pair.slice(3)} ${dateLabel(dateTok)}${ndf ? " NDF" : ""}`,
        // NDF: cash-settled in the quote currency at the fixing two business days before delivery.
        ...(ndf ? { ndf: { fixingDate: advance(delivery, "-2D", cal), settlementCurrency: pair.slice(3) } } : {}),
      };
      return {
        ok: true,
        trade,
        description: `FX-Forward ${pair} ${amtTok} @ ${rate === undefined ? "fair" : fmtNum(rate, 4)} · Lieferung ${dateLabel(dateTok)}${ndf ? ` · NDF (Ausgleich in ${pair.slice(3)})` : ""}`,
      };
    }
    if (["fxo", "fxopt", "option"].includes(cmd)) {
      const pair = rest.find((t) => isPair(t))?.toUpperCase();
      const typeTok = rest.find((t) => /^(call|put|c|p)$/i.test(t));
      // Convention: amount ("3m" = 3 Mio.) comes before the expiry tenor ("9m" = 9 months).
      const amtIdx = rest.findIndex((t) => /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i.test(t));
      const amtTok = amtIdx >= 0 ? rest[amtIdx] : undefined;
      // "barrier do 1.05": type word + level are consumed before the strike / date search.
      const barrierIdx = rest.findIndex((t) => t.toLowerCase() === "barrier" || t.toLowerCase() === "barriere");
      let barrier: { type: BarrierType; level: number } | undefined;
      const barrierToks = new Set<string>();
      if (barrierIdx >= 0) {
        const typeWord = rest[barrierIdx + 1]?.toLowerCase();
        const levelTok = rest[barrierIdx + 2];
        const type = typeWord ? BARRIER_WORDS[typeWord] : undefined;
        if (!type || !levelTok || !PRICE.test(levelTok))
          return fail(`Barriere unvollständig – Format: barrier uo|ui|do|di <level> (z.B. fxo eurusd put 1.15 3m 9m barrier do 1.05)`);
        barrier = { type, level: Number(levelTok.replace(",", ".")) };
        barrierToks
          .add(rest[barrierIdx]!)
          .add(rest[barrierIdx + 1]!)
          .add(levelTok);
      }
      const dateTok = rest.find((t, i) => i !== amtIdx && !barrierToks.has(t) && (DATE.test(t) || TENOR.test(t)));
      // Strikes may lack decimals for JPY-style pairs ("fxo eurjpy call 175 1m 6m", R3-5b); plausibility against the spot.
      const strikeTok = rest.find(
        (t, i) => i !== amtIdx && t !== dateTok && t !== typeTok && !(barrierIdx >= 0 && i >= barrierIdx && i <= barrierIdx + 2) && PRICE.test(t),
      );
      const used = new Set<string>([pair?.toLowerCase() ?? "", typeTok?.toLowerCase() ?? "", amtTok ?? "", dateTok ?? "", strikeTok ?? "", ...barrierToks]);
      const leftover = rest.find((t, i) => !(barrierIdx >= 0 && i >= barrierIdx && i <= barrierIdx + 2) && !used.has(t) && !used.has(t.toLowerCase()));
      if (leftover !== undefined) {
        const dup = ambiguousDuplicate(leftover, amtTok, dateTok);
        if (dup) return dup;
        if (PRICE.test(leftover) && strikeTok) return duplicate("Kurs", strikeTok, leftover);
        if (DATE.test(leftover) || TENOR.test(leftover)) return duplicate("Datum", dateTok!, leftover);
        return fail(unknownTokenError(leftover, GRAMMAR.fxo));
      }
      if (!pair || !typeTok || !strikeTok || !dateTok) return fail(`Format: fxo eurusd put 1.15 3m 15.06.2027 (${DATE_HINT} oder Tenor)`);
      const strike = Number(strikeTok.replace(",", "."));
      const badStrike = priceImplausible(strike, pair, opts);
      if (badStrike) return fail(badStrike.replace(/^Kurs/, "Strike"));
      if (barrier) {
        const badBarrier = priceImplausible(barrier.level, pair, opts);
        if (badBarrier) return fail(badBarrier.replace(/^Kurs/, "Barriere"));
      }
      const expiry = parseDateOrTenor(dateTok, valuationDate);
      if (expiry === undefined) return fail(`Ungültiges Datum „${dateTok}“ – ${DATE_HINT}`);
      const isCall = /^c/i.test(typeTok);
      const trade = {
        ...makeFxOption({
          pair,
          optionType: isCall ? "Call" : "Put",
          notional: amtTok ? Math.abs(parseAmount(amtTok)!) : 1_000_000,
          strike,
          expiryDate: expiry,
          deliveryDate: addTenor(expiry, "2D"),
        }),
        name: `${pair.slice(0, 3)}-${isCall ? "Call" : "Put"}/${pair.slice(3)}-${isCall ? "Put" : "Call"} ${dateLabel(dateTok)}${barrier ? ` ${barrierLabel(barrier.type)} ${fmtNum(barrier.level, barrier.level >= 20 ? 2 : 4)}` : ""}`,
        ...(barrier ? { barrier } : {}),
      };
      return {
        ok: true,
        trade,
        description: `FX-Option ${pair} ${isCall ? "Call" : "Put"} @ ${fmtNum(strike, strike >= 20 ? 2 : 4)} · ${amtTok ?? "1m"} · Verfall ${dateLabel(dateTok)}${
          barrier ? ` · Barriere ${barrierLabel(barrier.type)} ${fmtNum(barrier.level, barrier.level >= 20 ? 2 : 4)}` : ""
        }${fxVolWarning(pair, opts.fxVolPairs)}`,
      };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: false };
}

/** "UpOut" → "Up-and-Out" for names and previews. */
function barrierLabel(t: BarrierType): string {
  return t === "UpOut" ? "Up-and-Out" : t === "UpIn" ? "Up-and-In" : t === "DownOut" ? "Down-and-Out" : "Down-and-In";
}

export const QUICK_ENTRY_EXAMPLES = [
  "irs 10y pay 3.1% 10m",
  "ois 2y rec 2.18% 25m",
  "cap 5y 3% 8m",
  "collar 7y 3.5/1.5 6m",
  "swpt 1y5y payer 3% 10m",
  "swpt usd 1y5y payer 3.5% 10m",
  "swpt 2y10y rec 2.8% 5m cash",
  "fxf eurusd -2m 1.1725 15.03.2027",
  "fxo eurusd put 1.15 3m 9m",
  "fxo eurusd put 1.15 3m 9m barrier do 1.05",
  "basis 5y 3m/6m 5bp 10m",
  "amort 10y pay 3.1% 10m",
  "imm 2y pay 3% 10m",
  "fxs eurusd 1m 1.1625 1.18 1y",
  "ccs eurusd 5y -20bp 10m mtm",
  "ccs eurusd 5y fixed 3% 10m",
  "fra 3x6 pay 2.2% 10m",
  "irs 5y pay 2.5% 10m step 2.5/3.0/3.5",
  "irs 5y rec 2.4% 5m @Landesbank",
];

/** Palette command "stichtag 2026-12-31" / "stichtag 31.12.2026" / "stichtag heute"; impossible dates (31.02.) are not offered (R3-13). */
export function parseValuationDateCommand(input: string): string | undefined {
  const m = /^(?:stichtag|bewertungstag|valdate)\s+(\S+)$/i.exec(input.trim());
  if (!m) return undefined;
  const tok = m[1]!.toLowerCase();
  if (tok === "heute" || tok === "today") return new Date().toISOString().slice(0, 10);
  const d = parseDateToken(tok);
  return d === undefined ? undefined : toISO(d);
}
