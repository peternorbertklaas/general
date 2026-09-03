import {
  type Trade,
  addTenor,
  advance,
  getCalendar,
  makeAmortisingSwap,
  makeBasisSwap,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeFxSwap,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
} from "@deriva/pricing-core";
import { fmtNum } from "./format.js";

/**
 * Bloomberg-style quick entry, e.g.
 *   "irs 10y pay 3.1% 10m"           → payer swap EUR 10Y 3.10% notional 10m
 *   "irs eur 5y rec 2.45 5000000"    → receiver swap
 *   "ois 2y pay 2.18 25m"            → €STR OIS
 *   "cap 5y 3% 8m" | "floor 7y 1.5% 6m" | "collar 7y 3.5/1.5 6m"
 *   "swpt 1y5y payer 3% 10m" | "swaption 2y10y rec 2.8 5m"
 *   "fxf eurusd 2m 1.1725 2027-03-15"  (positive = buy EUR, "-2m" = sell)
 *   "fxo eurusd put 1.15 3m 2027-06-15" | "fxo eurchf call 0.95 2m 6m"
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

function parseDateOrTenor(tok: string, from: number): number | undefined {
  if (DATE.test(tok)) return parseISO(tok);
  if (TENOR.test(tok)) return advance(from, tok.toUpperCase(), getCalendar("TARGET"));
  return undefined;
}

const CCYS = new Set(["eur", "usd", "gbp", "chf", "jpy"]);
const DIRECTION = new Set(["pay", "payer", "p", "rec", "receive", "receiver", "r", "call", "put", "c"]);
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
  if (CCYS.has(tl) || DIRECTION.has(tl) || COMMANDS.has(tl)) return true;
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

export function parseQuickEntry(input: string, valuationDate: number): ParseResult {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0) return { ok: false };
  const { toks, counterparty } = extractCounterparty(raw);
  if (toks.length === 0) return { ok: false };
  const r = parseCore(toks, valuationDate);
  if (r.ok && r.trade && counterparty) {
    r.trade = { ...r.trade, counterparty };
    r.description = `${r.description} · @${counterparty}`;
  }
  return r;
}

function parseCore(toks: string[], valuationDate: number): ParseResult {
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
        name: `FX-Swap ${pair.slice(0, 3)}/${pair.slice(3)} ${dateTok.toUpperCase()}`,
      };
      return { ok: true, trade, description: `FX-Swap ${pair} ${amtTok} @ ${fmtNum(nearRate, 4)}/${fmtNum(farRate, 4)} · Far ${dateTok}` };
    }
    if (["irs", "swap", "ois", "amort", "amortising"].includes(cmd)) {
      let ccy = "EUR";
      let tenor: string | undefined;
      let pr: "Pay" | "Receive" = "Pay";
      let rate: number | undefined;
      let notional = 10_000_000;
      let index: string | undefined;
      for (const t of rest) {
        const tl = t.toLowerCase();
        if (/^[a-z]{3}$/i.test(t) && ["eur", "usd", "gbp", "chf", "jpy"].includes(tl)) ccy = t.toUpperCase();
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
      if (rate === undefined) {
        // Take last plain number as rate if no notional-unit
        rate = 0.03;
      }
      if (cmd === "ois" && !index) index = ccy === "EUR" ? "ESTR" : ccy === "USD" ? "SOFR" : ccy === "GBP" ? "SONIA" : ccy === "CHF" ? "SARON" : "TONA";
      const isAmort = cmd.startsWith("amort");
      const name = `${isAmort ? "Amortisierender " : ""}${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor}${cmd === "ois" ? " OIS" : ""}`;
      const params = { name, currency: ccy, notional, payReceiveFixed: pr, fixedRate: rate, effectiveDate: spot, maturity: tenor, index };
      const trade = isAmort ? makeAmortisingSwap(params) : makeVanillaSwap(params);
      return {
        ok: true,
        trade,
        description: `${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor} @ ${fmtNum(rate * 100, 3)} % · Nominal ${fmtNum(notional, 0)}${index ? ` · ${index}` : ""}${isAmort ? " · linear amortisierend" : ""}`,
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
      const rateTok = rest.find((t) => t !== amtTok && /^\d+[.,]\d{2,}$/.test(t));
      if (!pair || !amtTok || !dateTok) return { ok: false, error: "Format: fxf eurusd 2m 1.1725 2027-03-15" };
      const delivery = parseDateOrTenor(dateTok, spot)!;
      const rate = rateTok ? Number(rateTok.replace(",", ".")) : undefined;
      const base = parseAmount(amtTok)!;
      const trade = {
        ...makeFxForward({ pair, baseAmount: base, rate: rate ?? 1, deliveryDate: delivery }),
        name: `${base < 0 ? "Verkauf" : "Kauf"} ${pair.slice(0, 3)}/${pair.slice(3)} ${dateTok.toUpperCase()}`,
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
      const strikeTok = rest.find((t) => t !== amtTok && /^\d+[.,]\d{2,}$/.test(t));
      if (!pair || !typeTok || !strikeTok || !dateTok) return { ok: false, error: "Format: fxo eurusd put 1.15 3m 2027-06-15" };
      const expiry = parseDateOrTenor(dateTok, valuationDate)!;
      const isCall = /^c/i.test(typeTok);
      const trade = {
        ...makeFxOption({
          pair,
          optionType: isCall ? "Call" : "Put",
          notional: amtTok ? Math.abs(parseAmount(amtTok)!) : 1_000_000,
          strike: Number(strikeTok.replace(",", ".")),
          expiryDate: expiry,
          deliveryDate: addTenor(expiry, "2D"),
        }),
        name: `${pair.slice(0, 3)}-${isCall ? "Call" : "Put"}/${pair.slice(3)}-${isCall ? "Put" : "Call"} ${dateTok.toUpperCase()}`,
      };
      return {
        ok: true,
        trade,
        description: `FX-Option ${pair} ${isCall ? "Call" : "Put"} @ ${fmtNum(Number(strikeTok.replace(",", ".")), 4)} · ${amtTok ?? "1m"} · Verfall ${dateTok}`,
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
  "irs 5y rec 2.4% 5m @Landesbank",
];

/** Palette command "stichtag 2026-12-31" / "stichtag heute". */
export function parseValuationDateCommand(input: string): string | undefined {
  const m = /^(?:stichtag|bewertungstag|valdate)\s+(\S+)$/i.exec(input.trim());
  if (!m) return undefined;
  const tok = m[1]!.toLowerCase();
  if (tok === "heute" || tok === "today") return new Date().toISOString().slice(0, 10);
  if (DATE.test(tok)) return tok;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(tok);
  if (de) return `${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`;
  return undefined;
}
