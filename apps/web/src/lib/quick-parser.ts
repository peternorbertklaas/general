import {
  type Trade,
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
 *   "cap 5y 3% 8m" | "floor 7y 1.5% 6m" | "collar 7y 3.5/1.5 6m"
 *   "swpt 1y5y payer 3% 10m" | "swaption 2y10y rec 2.8 5m"
 *   "fxf eurusd 2m 1.1725 2027-03-15"  (positive = buy EUR, "-2m" = sell)
 *   "fxo eurusd put 1.15 3m 2027-06-15" | "fxo eurchf call 0.95 2m 6m"
 *   "ccs eurusd 5y -20bp 10m [mtm]"    → cross-currency basis swap (€STR −20bp vs SOFR), optional MtM reset
 *   "fra 3x6 pay 2.2% 10m"             → forward rate agreement (period from the spot date)
 *   "irs 5y pay 2.5% 10m step 2.5/3.0/3.5" → step-up coupon: one rate per year from the start
 *   "@Landesbank" anywhere sets the counterparty ("irs 10y pay 3.1% 10m @Landesbank")
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
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** FRA period "3x6" (months from the spot date). */
const FRA_PERIOD = /^(\d{1,2})x(\d{1,2})$/i;
/** Step-up coupon list "2.5/3.0/3.5" (percent, one rate per year). */
const STEP_LIST = /^-?\d+(?:[.,]\d+)?(?:\/-?\d+(?:[.,]\d+)?)+$/;

function parseDateOrTenor(tok: string, from: number): number | undefined {
  if (DATE.test(tok)) return parseISO(tok);
  if (TENOR.test(tok)) return advance(from, tok.toUpperCase(), getCalendar("TARGET"));
  return undefined;
}

/** Trade-name fragment of a date / tenor token: ISO dates become TT.MM.JJJJ (R3-11), tenors stay ("9M"). */
export function dateLabel(tok: string): string {
  return DATE.test(tok) ? fmtDate(parseISO(tok)) : tok.toUpperCase();
}

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

const CCYS = new Set(["eur", "usd", "gbp", "chf", "jpy"]);
const DIRECTION = new Set(["pay", "payer", "p", "rec", "receive", "receiver", "r", "call", "put", "c"]);
/** Modifier words of the grammar ("mtm" = MtM reset, "step" introduces the coupon list, "fixed" the CCS fixed rate). */
const MODIFIERS = new Set(["mtm", "step", "fixed", "fest", "fix"]);
const COMMANDS = new Set([
  "irs",
  "swap",
  "ois",
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
  if (CCYS.has(tl) || DIRECTION.has(tl) || COMMANDS.has(tl) || MODIFIERS.has(tl)) return true;
  if (FRA_PERIOD.test(t) || STEP_LIST.test(t)) return true;
  if (/^[a-z]{6}$/i.test(t) && CCYS.has(tl.slice(0, 3)) && CCYS.has(tl.slice(3))) return true; // currency pair
  if (/^(euribor|estr|sofr|sonia|saron|tona)/i.test(t)) return true;
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
}

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
      let notional = 10_000_000;
      for (const t of rest) {
        const tl = t.toLowerCase();
        if (["eur", "usd", "gbp", "chf"].includes(tl)) ccy = t.toUpperCase();
        else if (/^\d+m\/\d+m$/i.test(t)) {
          const [a, b] = t.toUpperCase().split("/");
          rec = `EURIBOR-${a}`;
          pay = `EURIBOR-${b}`;
        } else if (/bp$/i.test(t)) spread = parseRate(t) ?? 0;
        else if (TENOR.test(t) && !tenor) tenor = t.toUpperCase();
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!tenor) return { ok: false, error: "Laufzeit fehlt (z.B. basis 5y 3m/6m 5bp 10m)" };
      const trade = makeBasisSwap({
        name: `Basis-Swap ${rec.replace("EURIBOR-", "")}/${pay.replace("EURIBOR-", "")} ${tenor}`,
        currency: ccy,
        notional,
        effectiveDate: spot,
        maturity: tenor,
        receiveIndex: rec,
        payIndex: pay,
        spread,
      });
      return {
        ok: true,
        trade,
        description: `Basis-Swap ${rec} ${spread >= 0 ? "+" : ""}${fmtNum(spread * 1e4, 1)} bp vs ${pay} ${tenor} · Nominal ${fmtNum(notional, 0)}`,
      };
    }
    if (["fxs", "fxswap"].includes(cmd)) {
      // fxs <pair> <±baseAmount> <nearRate> <farRate> <farDate|tenor>
      const pair = rest.find((t) => /^[a-z]{6}$/i.test(t))?.toUpperCase();
      const amtIdx = rest.findIndex((t) => /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i.test(t));
      const amtTok = amtIdx >= 0 ? rest[amtIdx] : undefined;
      const rates = rest.filter((t, i) => i !== amtIdx && /^\d+[.,]\d{2,}$/.test(t));
      const dateTok = rest.find((t, i) => i !== amtIdx && (DATE.test(t) || TENOR.test(t)));
      if (!pair || !amtTok || !dateTok) return { ok: false, error: "Format: fxs eurusd 1m 1.1625 1.18 1y" };
      const nearRate = rates[0] ? Number(rates[0].replace(",", ".")) : 1;
      const farRate = rates[1] ? Number(rates[1].replace(",", ".")) : nearRate;
      const trade = {
        ...makeFxSwap({ pair, baseAmount: parseAmount(amtTok)!, nearRate, farRate, nearDate: spot, farDate: parseDateOrTenor(dateTok, spot)! }),
        name: `FX-Swap ${pair.slice(0, 3)}/${pair.slice(3)} ${dateLabel(dateTok)}`,
      };
      return { ok: true, trade, description: `FX-Swap ${pair} ${amtTok} @ ${fmtNum(nearRate, 4)}/${fmtNum(farRate, 4)} · Far ${dateTok}` };
    }
    if (["ccs", "xccy"].includes(cmd)) {
      // ccs <pair> <tenor> [spreadbp] [notional] [mtm] [fixed <rate%>]   e.g. "ccs eurusd 5y -20bp 10m mtm", "ccs eurusd 5y fixed 3% 10m"
      let pair: string | undefined;
      let tenor: string | undefined;
      let spread = 0;
      let notional = 10_000_000;
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
        if (/^[a-z]{6}$/i.test(t) && CCYS.has(tl.slice(0, 3)) && CCYS.has(tl.slice(3))) pair = t.toUpperCase();
        else if (TENOR.test(t) && !tenor) tenor = t.toUpperCase();
        else if (/bp$/i.test(t)) spread = parseRate(t) ?? 0;
        else if (tl === "mtm") mtm = true;
        else if (tl === "fixed" || tl === "fest" || tl === "fix") expectFixed = true;
        else if (/%$/.test(t)) fixedRate = parseRate(t);
        else if (["pay", "payer", "p"].includes(tl)) pr = "Pay";
        else if (["rec", "receive", "receiver", "r"].includes(tl)) pr = "Receive";
        else if (/^\d+[.,]\d{2,}$/.test(t)) fxSpot = Number(t.replace(",", "."));
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!pair || !tenor) return { ok: false, error: "Format: ccs eurusd 5y -20bp 10m [mtm] [fixed 3%]" };
      const dom = pair.slice(0, 3);
      const forCcy = pair.slice(3);
      // Foreign notional = domestic × spot: typed rate first, then the market spot (direct or inverse quotation).
      const spots = opts.fxSpots ?? {};
      const inverse = spots[`${forCcy}${dom}`];
      const rate = fxSpot ?? spots[pair] ?? (inverse ? 1 / inverse : undefined);
      if (rate === undefined)
        return { ok: false, error: `FX-Spot für ${dom}/${forCcy} fehlt – Kurs angeben (z.B. ccs ${pair.toLowerCase()} 5y -20bp 10m 1.17)` };
      const trade = makeCrossCurrencySwap({
        name: `Cross-Currency-Swap ${dom}/${forCcy} ${tenor} ${fixedRate !== undefined ? `fest ${fmtNum(fixedRate * 100, 2)} %` : `${fmtNum(spread * 1e4, 1)} bp`}${mtm ? " MtM" : ""}`,
        pair,
        domesticNotional: notional,
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
        description: `Cross-Currency-Swap ${dom}/${forCcy} ${tenor} · ${legDesc} · Nominal ${fmtNum(notional, 0)} ${dom} @ ${fmtNum(rate, 4)}${mtm ? " · MtM-Reset" : ""}`,
      };
    }
    if (cmd === "fra") {
      // fra [ccy] <NxM> pay|rec <rate%> [notional] [index]   e.g. "fra 3x6 pay 2.2% 10m"
      let ccy = "EUR";
      let period: string | undefined;
      let pr: "Pay" | "Receive" = "Pay";
      let rate: number | undefined;
      let notional = 10_000_000;
      let index: string | undefined;
      for (const t of rest) {
        const tl = t.toLowerCase();
        if (/^[a-z]{3}$/i.test(t) && CCYS.has(tl)) ccy = t.toUpperCase();
        else if (FRA_PERIOD.test(t) && !period) period = t.toLowerCase();
        else if (["pay", "payer", "p"].includes(tl)) pr = "Pay";
        else if (["rec", "receive", "receiver", "r"].includes(tl)) pr = "Receive";
        else if (/%$/.test(t) || /bp$/i.test(t) || (rate === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t)))
          rate = parseRate(t);
        else if (/^(euribor|estr|sofr|sonia|saron|tona)/i.test(t)) index = t.toUpperCase().replace("EURIBOR", "EURIBOR-").replace("--", "-");
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!period) return { ok: false, error: "Periode fehlt (z.B. fra 3x6 pay 2.2% 10m)" };
      const m = FRA_PERIOD.exec(period)!;
      if (Number(m[2]) <= Number(m[1])) return { ok: false, error: "FRA-Periode: Ende muss nach dem Start liegen (z.B. 3x6)" };
      if (rate === undefined) return { ok: false, error: "Festsatz fehlt (z.B. 2.2%)" };
      // The index follows the period length inside the core builder (3x6 → EURIBOR-3M) unless typed explicitly.
      const trade = makeFra({
        name: `FRA ${ccy} ${period} ${pr === "Pay" ? "Zahler" : "Empfänger"}`,
        currency: ccy,
        notional,
        payReceive: pr,
        start: period,
        rate,
        index,
        valuationDate,
      });
      return {
        ok: true,
        trade,
        description: `FRA ${ccy} ${period} · Fest ${pr === "Pay" ? "zahlen" : "erhalten"} @ ${fmtNum(rate * 100, 3)} % · Nominal ${fmtNum(notional, 0)} · ${trade.index}`,
      };
    }
    if (["irs", "swap", "ois", "amort", "amortising"].includes(cmd)) {
      let ccy = "EUR";
      let tenor: string | undefined;
      let pr: "Pay" | "Receive" = "Pay";
      let rate: number | undefined;
      let notional = 10_000_000;
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
        else if (/^[a-z]{3}$/i.test(t) && ["eur", "usd", "gbp", "chf", "jpy"].includes(tl)) ccy = t.toUpperCase();
        else if (TENOR.test(t) && tenor === undefined) tenor = t.toUpperCase();
        else if (["pay", "payer", "p"].includes(tl)) pr = "Pay";
        else if (["rec", "receive", "receiver", "r"].includes(tl)) pr = "Receive";
        else if (
          /%$/.test(t) ||
          (rate === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t) && rest.indexOf(t) !== rest.length - 1)
        )
          rate = parseRate(t);
        else if (/^(euribor|estr|sofr|sonia|saron)/i.test(t)) index = t.toUpperCase().replace("EURIBOR", "EURIBOR-").replace("--", "-");
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!tenor) return { ok: false, error: "Laufzeit fehlt (z.B. 10Y)" };
      // "step" without a coupon list is a typo, not a plain swap (R3-10).
      if (expectSteps || (rest.some((t) => t.toLowerCase() === "step" || t.toLowerCase() === "staffel") && !steps))
        return { ok: false, error: "step ohne Stufen – Format: step 2,5/3,0/3,5 (eine Stufe je Jahr)" };
      if (rate === undefined) {
        // Take last plain number as rate if no notional-unit
        rate = 0.03;
      }
      if (cmd === "ois" && !index) index = ccy === "EUR" ? "ESTR" : ccy === "USD" ? "SOFR" : ccy === "GBP" ? "SONIA" : ccy === "CHF" ? "SARON" : "TONA";
      const isAmort = cmd.startsWith("amort");
      // Step-up coupon: the first list entry is the initial coupon, every further entry starts one year later.
      if (steps && steps.length > 0) rate = steps[0]!;
      const stepUp = steps && steps.length > 1 ? steps.slice(1).map((r, i) => ({ date: addTenor(spot, `${i + 1}Y`), rate: r })) : undefined;
      const name = `${isAmort ? "Amortisierender " : ""}${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor}${cmd === "ois" ? " OIS" : ""}${stepUp ? " Staffel" : ""}`;
      const params = { name, currency: ccy, notional, payReceiveFixed: pr, fixedRate: rate, effectiveDate: spot, maturity: tenor, index, stepUp };
      const trade = isAmort ? makeAmortisingSwap(params) : makeVanillaSwap(params);
      return {
        ok: true,
        trade,
        description: `${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor} @ ${fmtNum(rate * 100, 3)} %${stepUp ? ` → ${steps!.map((r) => fmtNum(r * 100, 2)).join(" / ")} % Staffel` : ""} · Nominal ${fmtNum(notional, 0)}${index ? ` · ${index}` : ""}${isAmort ? " · linear amortisierend" : ""}`,
      };
    }
    if (["cap", "floor", "collar"].includes(cmd)) {
      let tenor: string | undefined;
      let strike: number | undefined;
      let floorStrike: number | undefined;
      let notional = 10_000_000;
      let ccy = "EUR";
      for (const t of rest) {
        if (/^[a-z]{3}$/i.test(t) && ["eur", "usd", "gbp", "chf"].includes(t.toLowerCase())) ccy = t.toUpperCase();
        else if (TENOR.test(t) && !tenor) tenor = t.toUpperCase();
        else if (/\//.test(t)) {
          const [a, b] = t.split("/");
          strike = parseRate(a!);
          floorStrike = parseRate(b!);
        } else if (/%$/.test(t) || (strike === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t)))
          strike = parseRate(t);
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!tenor || strike === undefined) return { ok: false, error: "Laufzeit und Strike erforderlich (z.B. cap 5y 3% 8m)" };
      const capFloor = cmd === "cap" ? "Cap" : cmd === "floor" ? "Floor" : "Collar";
      const trade = {
        ...makeCapFloor({ currency: ccy, notional, capFloor, strike, floorStrike, effectiveDate: spot, maturity: tenor }),
        name: `${capFloor} ${ccy} ${tenor} ${fmtNum(strike * 100, 2)} %${floorStrike !== undefined ? ` / ${fmtNum(floorStrike * 100, 2)} %` : ""}`,
      };
      return {
        ok: true,
        trade,
        description: `${capFloor} ${ccy} ${tenor} @ ${fmtNum(strike * 100, 2)} %${floorStrike !== undefined ? ` / ${fmtNum(floorStrike * 100, 2)} %` : ""} · Nominal ${fmtNum(notional, 0)}`,
      };
    }
    if (["swpt", "swaption"].includes(cmd)) {
      let expiry: string | undefined;
      let tenor: string | undefined;
      let pr: "Payer" | "Receiver" = "Payer";
      let strike: number | undefined;
      let notional = 10_000_000;
      for (const t of rest) {
        const m = /^(\d+[ymd])x?(\d+[ymd])$/i.exec(t);
        if (m) {
          expiry = m[1]!.toUpperCase();
          tenor = m[2]!.toUpperCase();
        } else if (["payer", "pay", "p"].includes(t.toLowerCase())) pr = "Payer";
        else if (["receiver", "rec", "r"].includes(t.toLowerCase())) pr = "Receiver";
        else if (/%$/.test(t) || (strike === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t)))
          strike = parseRate(t);
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!expiry || !tenor) return { ok: false, error: "Format: swpt 1y5y payer 3% 10m" };
      const trade = {
        ...makeSwaption({ currency: "EUR", notional, payerReceiver: pr, strike: strike ?? 0.03, expiry, tenor, valuationDate }),
        name: `${pr}-Swaption ${expiry}×${tenor}`,
      };
      return { ok: true, trade, description: `${pr}-Swaption ${expiry}x${tenor} @ ${fmtNum((strike ?? 0.03) * 100, 3)} % · Nominal ${fmtNum(notional, 0)}` };
    }
    if (["fxf", "fxfwd", "forward"].includes(cmd)) {
      const pair = rest.find((t) => /^[a-z]{6}$/i.test(t))?.toUpperCase();
      const amtIdx = rest.findIndex((t) => /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i.test(t));
      const amtTok = amtIdx >= 0 ? rest[amtIdx] : undefined;
      const dateTok = rest.find((t, i) => i !== amtIdx && (DATE.test(t) || TENOR.test(t)));
      const rateTok = rest.find((t) => t !== amtTok && t !== dateTok && PRICE.test(t));
      if (!pair || !amtTok || !dateTok) return { ok: false, error: "Format: fxf eurusd 2m 1.1725 2027-03-15" };
      const delivery = parseDateOrTenor(dateTok, spot)!;
      const rate = rateTok ? Number(rateTok.replace(",", ".")) : undefined;
      if (rate !== undefined) {
        const bad = priceImplausible(rate, pair, opts);
        if (bad) return { ok: false, error: bad };
      }
      const base = parseAmount(amtTok)!;
      const trade = {
        ...makeFxForward({ pair, baseAmount: base, rate: rate ?? 1, deliveryDate: delivery }),
        name: `${base < 0 ? "Verkauf" : "Kauf"} ${pair.slice(0, 3)}/${pair.slice(3)} ${dateLabel(dateTok)}`,
      };
      return { ok: true, trade, description: `FX-Forward ${pair} ${amtTok} @ ${rate === undefined ? "fair" : fmtNum(rate, 4)} · Lieferung ${dateTok}` };
    }
    if (["fxo", "fxopt", "option"].includes(cmd)) {
      const pair = rest.find((t) => /^[a-z]{6}$/i.test(t))?.toUpperCase();
      const typeTok = rest.find((t) => /^(call|put|c|p)$/i.test(t));
      // Convention: amount ("3m" = 3 Mio.) comes before the expiry tenor ("9m" = 9 months).
      const amtIdx = rest.findIndex((t) => /^-?\d+(?:[.,]\d+)?(k|m|mio)$/i.test(t));
      const amtTok = amtIdx >= 0 ? rest[amtIdx] : undefined;
      const dateTok = rest.find((t, i) => i !== amtIdx && (DATE.test(t) || TENOR.test(t)));
      // Strikes may lack decimals for JPY-style pairs ("fxo eurjpy call 175 1m 6m", R3-5b); plausibility against the spot.
      const strikeTok = rest.find((t) => t !== amtTok && t !== dateTok && t !== typeTok && PRICE.test(t));
      if (!pair || !typeTok || !strikeTok || !dateTok) return { ok: false, error: "Format: fxo eurusd put 1.15 3m 2027-06-15" };
      const strike = Number(strikeTok.replace(",", "."));
      const badStrike = priceImplausible(strike, pair, opts);
      if (badStrike) return { ok: false, error: badStrike.replace(/^Kurs/, "Strike") };
      const expiry = parseDateOrTenor(dateTok, valuationDate)!;
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
        name: `${pair.slice(0, 3)}-${isCall ? "Call" : "Put"}/${pair.slice(3)}-${isCall ? "Put" : "Call"} ${dateLabel(dateTok)}`,
      };
      return {
        ok: true,
        trade,
        description: `FX-Option ${pair} ${isCall ? "Call" : "Put"} @ ${fmtNum(strike, strike >= 20 ? 2 : 4)} · ${amtTok ?? "1m"} · Verfall ${dateLabel(dateTok)}`,
      };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: false };
}

export const QUICK_ENTRY_EXAMPLES = [
  "irs 10y pay 3.1% 10m",
  "ois 2y rec 2.18% 25m",
  "cap 5y 3% 8m",
  "collar 7y 3.5/1.5 6m",
  "swpt 1y5y payer 3% 10m",
  "fxf eurusd -2m 1.1725 2027-03-15",
  "fxo eurusd put 1.15 3m 9m",
  "basis 5y 3m/6m 5bp 10m",
  "amort 10y pay 3.1% 10m",
  "fxs eurusd 1m 1.1625 1.18 1y",
  "ccs eurusd 5y -20bp 10m mtm",
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
  let iso: string | undefined;
  if (DATE.test(tok)) iso = tok;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(tok);
  if (de) iso = `${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`;
  if (!iso) return undefined;
  try {
    return toISO(parseISO(iso)) === iso ? iso : undefined;
  } catch {
    return undefined;
  }
}
