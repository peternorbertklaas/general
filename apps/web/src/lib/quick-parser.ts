import {
  type Trade,
  addTenor,
  advance,
  getCalendar,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  parseISO,
} from "@deriva/pricing-core";

/**
 * Bloomberg-style quick entry, e.g.
 *   "irs 10y pay 3.1% 10m"           → payer swap EUR 10Y 3.10% notional 10m
 *   "irs eur 5y rec 2.45 5000000"    → receiver swap
 *   "ois 2y pay 2.18 25m"            → €STR OIS
 *   "cap 5y 3% 8m" | "floor 7y 1.5% 6m" | "collar 7y 3.5/1.5 6m"
 *   "swpt 1y5y payer 3% 10m" | "swaption 2y10y rec 2.8 5m"
 *   "fxf eurusd 2m 1.1725 2027-03-15"  (positive = buy EUR, "-2m" = sell)
 *   "fxo eurusd put 1.15 3m 2027-06-15" | "fxo eurchf call 0.95 2m 6m"
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

export function parseQuickEntry(input: string, valuationDate: number): ParseResult {
  const toks = input.trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return { ok: false };
  const cmd = toks[0]!.toLowerCase();
  const rest = toks.slice(1);
  const cal = getCalendar("TARGET");
  const spot = advance(valuationDate, "2D", cal);
  try {
    if (["irs", "swap", "ois"].includes(cmd)) {
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
        else if (/%$/.test(t) || (rate === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t) && rest.indexOf(t) !== rest.length - 1)) rate = parseRate(t);
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
      const trade = makeVanillaSwap({ currency: ccy, notional, payReceiveFixed: pr, fixedRate: rate, effectiveDate: spot, maturity: tenor, index });
      return { ok: true, trade, description: `${pr === "Pay" ? "Payer" : "Receiver"}-Swap ${ccy} ${tenor} @ ${(rate * 100).toFixed(3)}% · Nominal ${notional.toLocaleString("de-DE")}${index ? ` · ${index}` : ""}` };
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
        } else if (/%$/.test(t) || (strike === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t))) strike = parseRate(t);
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!tenor || strike === undefined) return { ok: false, error: "Laufzeit und Strike erforderlich (z.B. cap 5y 3% 8m)" };
      const capFloor = cmd === "cap" ? "Cap" : cmd === "floor" ? "Floor" : "Collar";
      const trade = makeCapFloor({ currency: ccy, notional, capFloor, strike, floorStrike, effectiveDate: spot, maturity: tenor });
      return { ok: true, trade, description: `${capFloor} ${ccy} ${tenor} @ ${(strike * 100).toFixed(2)}%${floorStrike !== undefined ? ` / ${(floorStrike * 100).toFixed(2)}%` : ""} · Nominal ${notional.toLocaleString("de-DE")}` };
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
        else if (/%$/.test(t) || (strike === undefined && /^\d+(?:[.,]\d+)?$/.test(t) && Number(t.replace(",", ".")) < 20 && !/[km]$/i.test(t))) strike = parseRate(t);
        else {
          const amt = parseAmount(t);
          if (amt !== undefined) notional = amt;
        }
      }
      if (!expiry || !tenor) return { ok: false, error: "Format: swpt 1y5y payer 3% 10m" };
      const trade = makeSwaption({ currency: "EUR", notional, payerReceiver: pr, strike: strike ?? 0.03, expiry, tenor, valuationDate });
      return { ok: true, trade, description: `${pr}-Swaption ${expiry}x${tenor} @ ${((strike ?? 0.03) * 100).toFixed(3)}% · Nominal ${notional.toLocaleString("de-DE")}` };
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
      const trade = makeFxForward({ pair, baseAmount: parseAmount(amtTok)!, rate: rate ?? 1, deliveryDate: delivery });
      return { ok: true, trade, description: `FX-Forward ${pair} ${amtTok} @ ${rate ?? "fair"} · Lieferung ${dateTok}` };
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
      const trade = makeFxOption({
        pair,
        optionType: /^c/i.test(typeTok) ? "Call" : "Put",
        notional: amtTok ? Math.abs(parseAmount(amtTok)!) : 1_000_000,
        strike: Number(strikeTok.replace(",", ".")),
        expiryDate: expiry,
        deliveryDate: addTenor(expiry, "2D"),
      });
      return { ok: true, trade, description: `FX-Option ${pair} ${/^c/i.test(typeTok) ? "Call" : "Put"} @ ${strikeTok} · ${amtTok ?? "1m"} · Verfall ${dateTok}` };
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
];
