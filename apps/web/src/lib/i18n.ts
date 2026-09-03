/**
 * German UI texts for values that come from the pricing core in English:
 * core warnings/errors (regex templates), `PricingError` codes, leg / cashflow /
 * option labels, builder trade names, hedge summaries and select options.
 */
import { isPricingError } from "@deriva/pricing-core";

type Rule = { re: RegExp; to: (m: RegExpMatchArray) => string };

const CORE_MESSAGES: Rule[] = [
  // structured fixing warnings (prefix MISSING_FIXING:)
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); used (\S+) forward from (\d{4}-\d{2}-\d{2}) \(same-length period starting today\)$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – ${m[3]}-Forward ab ${isoToDe(m[4]!)} verwendet (gleich lange Periode ab heute)`,
  },
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); accrual period starting (\d{4}-\d{2}-\d{2}) projected with the curve's first forward$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – Periode ab ${isoToDe(m[3]!)} mit dem ersten Kurven-Forward projiziert`,
  },
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); caplet valued on the (\S+) forward from (\d{4}-\d{2}-\d{2})$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – Caplet auf dem ${m[3]}-Forward ab ${isoToDe(m[4]!)} bewertet`,
  },
  {
    re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); FRA settled on the curve forward$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – FRA mit dem Kurven-Forward abgerechnet`,
  },
  { re: /^MISSING_FIXING: Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); (.+)$/, to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – ${m[3]}` },
  {
    re: /^NEGATIVE_RATE_LOGNORMAL: (\w+) model with non-positive shifted forward\/strike(.*?) – intrinsic value used, no time value$/,
    to: (m) => `${m[1]}-Modell: verschobener Forward/Strike nicht positiv${m[2]} – innerer Wert ohne Zeitwert`,
  },
  { re: /^FRA already settled$/, to: () => "FRA bereits abgerechnet" },
  {
    re: /^Missing fixing for (\S+) on (\d{4}-\d{2}-\d{2}); used curve forward$/,
    to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt – Kurven-Forward verwendet`,
  },
  { re: /^Missing fixing (\S+) (\d{4}-\d{2}-\d{2})$/, to: (m) => `Fixing ${m[1]} vom ${isoToDe(m[2]!)} fehlt` },
  {
    re: /^No swaption vol surface – (\d+)bp normal vol assumed for exposure$/,
    to: (m) => `Keine Swaption-Vol-Fläche – ${m[1]} bp Normal-Vol für das Exposure angenommen`,
  },
  { re: /^No swaption vol surface – using (\d+)bp normal vol$/, to: (m) => `Keine Swaption-Vol-Fläche – ${m[1]} bp Normal-Vol verwendet` },
  { re: /^No caplet vol surface – using (\d+)bp normal vol$/, to: (m) => `Keine Caplet-Vol-Fläche – ${m[1]} bp Normal-Vol verwendet` },
  {
    re: /^No caplet vol surface for (\S+) – embedded cap\/floor valued intrinsically$/,
    to: (m) => `Keine Caplet-Vol-Fläche für ${m[1]} – eingebetteter Cap/Floor intrinsisch bewertet`,
  },
  { re: /^No FX vol surface – (\d+)% vol assumed$/, to: (m) => `Keine FX-Vol-Fläche – ${m[1]} % Vol angenommen` },
  { re: /^No FX vol surface – using (\d+)% vol$/, to: (m) => `Keine FX-Vol-Fläche – ${m[1]} % Vol verwendet` },
  { re: /^No (\S+) vol surface(.*)$/, to: (m) => `Keine ${m[1]}-Vol-Fläche${m[2]}` },
  { re: /^Swaption expired – intrinsic value shown$/, to: () => "Swaption verfallen – innerer Wert ausgewiesen" },
  { re: /^XVA not implemented for (\w+).*$/, to: (m) => `XVA für ${TRADE_TYPE_DE[m[1]!] ?? m[1]} nicht verfügbar (v1: Zinsswaps und FX-Forwards)` },
  { re: /^terminationDate must be after effectiveDate$/, to: () => "Enddatum muss nach dem Startdatum liegen" },
  { re: /^Schedule with stub=None does not divide evenly.*$/, to: () => "Laufzeit ist ohne Stub nicht durch die Frequenz teilbar" },
  { re: /^Curve not found in market context: (.+)$/, to: (m) => `Kurve ${m[1]} nicht im Markt-Snapshot` },
  { re: /^No discount curve configured for (\w+)$/, to: (m) => `Keine Diskontkurve für ${m[1]} konfiguriert` },
  { re: /^FX spot not available for (\w+)$/, to: (m) => `Kein FX-Spot für ${m[1]} verfügbar` },
  { re: /^Invalid FX pair: (.+)$/, to: (m) => `Ungültiges Währungspaar: ${m[1]}` },
  { re: /^Invalid tenor: (.+)$/, to: (m) => `Ungültiger Tenor: ${m[1]}` },
  { re: /^Invalid frequency: (.+)$/, to: (m) => `Ungültige Frequenz: ${m[1]}` },
  { re: /^Invalid (?:ISO )?date: (.+)$/, to: (m) => `Ungültiges Datum: ${m[1]}` },
  { re: /^Unknown rate index: (.+)$/, to: (m) => `Unbekannter Zinsindex: ${m[1]}` },
  { re: /^Unknown calendar: (.+)$/, to: (m) => `Unbekannter Kalender: ${m[1]}` },
  { re: /^Unknown day count convention: (.+)$/, to: (m) => `Unbekannte Tageszählung: ${m[1]}` },
  { re: /^Swaption underlying must have a fixed leg$/, to: () => "Swaption-Underlying benötigt ein Festzins-Leg" },
  { re: /^Cannot derive forward swap rate$/, to: () => "Forward-Swapsatz nicht ableitbar" },
  { re: /^Curve needs at least one node$/, to: () => "Kurve benötigt mindestens einen Stützpunkt" },
  { re: /^CVA \(swaption approach\) needs a fixed\/float swap$/, to: () => "CVA (Swaption-Replikation) benötigt einen Fest/Variabel-Swap" },
  { re: /^PV not finite$/, to: () => "Barwert nicht berechenbar" },
  { re: /^brent: .*$/, to: () => "Numerische Lösung nicht konvergiert" },
  { re: /^solveBracketed: .*$/, to: () => "Numerische Lösung: Nullstelle nicht eingrenzbar" },
  { re: /^Unsupported trade type: (.+)$/, to: (m) => `Nicht unterstützter Trade-Typ: ${m[1]}` },
  // XVA / exposure method strings (long and short forms, N-07)
  { re: /^Delta-normal \(expired\)$/, to: () => "Delta-Normal (verfallen)" },
  { re: /^Delta-normal exposure\s*\((.*)\)$/, to: (m) => `Delta-Normal-Exposure (${translateFragment(m[1]!)})` },
  { re: /^Delta-normal exposure.*$/, to: () => "Delta-Normal-Exposure (gerollte Sensitivitäten, ATM-Vols)" },
  { re: /^Swaption-replication \(Sorensen–Bollier\), flat hazard$/, to: () => "Swaption-Replikation (Sorensen–Bollier), konstante Hazard-Rate" },
  {
    re: /^Swaption-replication \(Sorensen–Bollier\),\s*(.*),\s*flat hazard$/,
    to: (m) => `Swaption-Replikation (Sorensen–Bollier), ${translateFragment(m[1]!)}, konstante Hazard-Rate`,
  },
  { re: /^Swaption-replication.*flat hazard$/, to: () => "Swaption-Replikation (Sorensen–Bollier), konstante Hazard-Rate" },
];

/** Short English fragments inside method strings (also applied to document paragraphs, N-07). */
const FRAGMENTS: [RegExp, string][] = [
  [/Swaption-replication/g, "Swaption-Replikation"],
  [/Delta-normal exposure/g, "Delta-Normal-Exposure"],
  [/smile vol at strike/gi, "Smile-Vol am Strike"],
  [/ATM vol(s)?/gi, "ATM-Vols"],
  [/rolled sensitivities/gi, "gerollte Sensitivitäten"],
  [/remaining tenor/gi, "Restlaufzeit"],
  [/flat hazard/gi, "konstante Hazard-Rate"],
  [/\bat \(t, /g, "bei (t, "],
];
function translateFragment(s: string): string {
  let out = s;
  for (const [re, to] of FRAGMENTS) out = out.replace(re, to);
  return out;
}

/** Free text from the core (document paragraphs): English method fragments → German, ISO dates → dd.mm.yyyy. */
export function germanizeParagraph(s: string): string {
  return germanizeText(translateFragment(s));
}

function isoToDe(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Translate a core (English) warning/error into German; unknown messages are passed through. */
export function translateCoreMessage(msg: string | undefined | null): string {
  if (!msg) return "";
  const s = msg.trim();
  for (const r of CORE_MESSAGES) {
    const m = s.match(r.re);
    if (m) return r.to(m);
  }
  // Unknown structured message: drop the machine-readable code prefix.
  return s.replace(/^[A-Z][A-Z_]+:\s+/, "");
}

/** German headline per `PricingError.code` (the detail message is translated separately). */
export const PRICING_ERROR_CODES_DE: Record<string, string> = {
  INVALID_TRADE: "Ungültige Trade-Daten",
  NON_FINITE_PV: "Barwert nicht berechenbar",
  MISSING_RATE: "Marktsatz fehlt",
  MISSING_FIXING: "Fixing fehlt",
  NO_DISCOUNT_CURVE: "Keine Diskontkurve konfiguriert",
  CURVE_NOT_FOUND: "Kurve nicht im Markt-Snapshot",
  NO_FX_SPOT: "FX-Spot fehlt",
  UNKNOWN_INDEX: "Unbekannter Zinsindex",
  UNKNOWN_CALENDAR: "Unbekannter Kalender",
  UNSUPPORTED_TRADE_TYPE: "Nicht unterstützter Trade-Typ",
};

/**
 * German text for any error thrown by the core: `PricingError`s get their
 * code headline plus the translated detail, plain errors are translated by
 * message.
 */
export function translatePricingError(e: unknown): string {
  if (isPricingError(e)) {
    const head = PRICING_ERROR_CODES_DE[e.code] ?? e.code;
    const detail = translateCoreMessage(e.message);
    return detail && detail !== head ? `${head}: ${detail}` : head;
  }
  if (e instanceof Error) return translateCoreMessage(e.message);
  return translateCoreMessage(String(e));
}

export const TRADE_TYPE_DE: Record<string, string> = {
  InterestRateSwap: "Zinsswap",
  CrossCurrencySwap: "Cross-Currency-Swap",
  FRA: "FRA",
  CapFloor: "Cap/Floor",
  Swaption: "Swaption",
  FxForward: "FX-Forward",
  FxSwap: "FX-Swap",
  FxOption: "FX-Option",
};

/** Leg type badges in cashflow tables ("Fixed" → "Fest"). */
export const LEG_TYPE_DE: Record<string, string> = {
  Fixed: "Fest",
  Float: "Variabel",
  "FX Buy": "Kauf",
  "FX Sell": "Verkauf",
  Premium: "Prämie",
  Option: "Option",
  Payoff: "Auszahlung",
  Near: "Near",
  Far: "Far",
  "Payer swaption": "Payer-Swaption",
  "Receiver swaption": "Receiver-Swaption",
  Cap: "Cap",
  Floor: "Floor",
  Collar: "Collar",
  Caplet: "Caplet",
  Floorlet: "Floorlet",
  FRA: "FRA",
};

const pairDe = (p: string) => (/^[A-Z]{6}$/.test(p) ? `${p.slice(0, 3)}/${p.slice(3)}` : p);

/**
 * German leg label including patterned core labels such as "Vanilla Put EURUSD",
 * "Digital Call EURUSD" or "Payer swaption" (N-07).
 */
export function legTypeLabel(legType: string | undefined | null): string {
  if (!legType) return "";
  const known = LEG_TYPE_DE[legType];
  if (known) return known;
  const opt = /^(Vanilla|Digital|Barrier|Knock-?in|Knock-?out)?\s*(Put|Call)\s+([A-Z]{6})$/i.exec(legType);
  if (opt) {
    const style = (opt[1] ?? "").toLowerCase();
    const styleDe = style === "" || style === "vanilla" ? "" : style === "digital" ? "Digital-" : style === "barrier" ? "Barriere-" : `${opt[1]}-`;
    return `${styleDe}${opt[2]!.charAt(0).toUpperCase()}${opt[2]!.slice(1).toLowerCase()} ${pairDe(opt[3]!.toUpperCase())}`;
  }
  const sw = /^(Payer|Receiver)\s+swaption$/i.exec(legType);
  if (sw) return `${sw[1]}-Swaption`;
  return legType;
}

export const CASHFLOW_KIND_DE: Record<string, string> = {
  Interest: "Zins",
  Notional: "Nominal",
  Premium: "Prämie",
  OptionPayoff: "Optionsauszahlung",
  Settlement: "Ausgleich",
};

export const SETTLEMENT_DE: Record<string, string> = { Physical: "Physisch", Cash: "Barausgleich" };
export const CASH_CONVENTION_DE: Record<string, string> = {
  CollateralisedCashPrice: "Collateralised Cash Price (ICE Swap Rate, Standard)",
  IRR: "IRR (Yield-basiert, Altbestand)",
};
export const BARRIER_DE: Record<string, string> = { None: "Keine", UpOut: "Up-and-Out", UpIn: "Up-and-In", DownOut: "Down-and-Out", DownIn: "Down-and-In" };
export const OPTION_TYPE_DE: Record<string, string> = { Call: "Call (Kauf Basis)", Put: "Put (Verkauf Basis)" };
export const CAPFLOOR_DE: Record<string, string> = { Cap: "Cap", Floor: "Floor", Collar: "Collar" };
export const PAYER_RECEIVER_DE: Record<string, string> = { Payer: "Payer (Fest zahlen)", Receiver: "Receiver (Fest erhalten)" };
export const MODEL_DE: Record<string, string> = { Bachelier: "Bachelier (Normal)", Black: "Black (Lognormal)", ShiftedBlack: "Shifted Black" };
export const PERSPECTIVE_DE: Record<string, string> = { Bank: "Bank", Kunde: "Kunde" };
export const SNAPSHOT_STATUS_DE: Record<string, string> = { indicative: "indikativ", approved: "freigegeben" };

/** Generic label lookup with pass-through. */
export function t(map: Record<string, string>, key: string | undefined | null): string {
  if (key === undefined || key === null) return "";
  return map[key] ?? key;
}

/** Options for `<Select>` from a value → label map. */
export function optionsFrom<T extends string>(values: readonly T[], map: Record<string, string>): { v: T; l: string }[] {
  return values.map((v) => ({ v, l: map[v] ?? v }));
}

/* ---------- Number / date germanisation of core-generated strings ---------- */

/** "3.100" → "3,100"; "1.1725" → "1,1725" (the caller knows the token is a decimal, not a grouped integer). */
function deDecimal(num: string): string {
  return num.replace(/\.(\d+)$/, ",$1");
}

/** ISO dates → dd.mm.yyyy and English trade-type identifiers → German inside free text (hedge summaries, N-07). */
export function germanizeText(s: string): string {
  let out = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y: string, mo: string, d: string) => `${d}.${mo}.${y}`);
  for (const [k, v] of Object.entries(TRADE_TYPE_DE)) out = out.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  return out;
}

/**
 * Core builder names are English with decimal points ("Sell EURUSD 2.000.000 @ 1.1725",
 * "Payer swaption 1Yx5Y @ 3.000%", "Payer EUR 10Y @ 3.100%", "Cap EUR 5Y @ 3.00%").
 * Returns the German display name for exactly these patterns; anything else is returned as is.
 */
export function germanTradeName(name: string | undefined): string | undefined {
  if (!name) return name;
  let m = /^(Buy|Sell) ([A-Z]{6}) ([\d.]+) @ ([\d.]+)$/.exec(name);
  if (m) return `${m[1] === "Buy" ? "Kauf" : "Verkauf"} ${pairDe(m[2]!)} ${m[3]} @ ${deDecimal(m[4]!)}`;
  m = /^(Put|Call) ([A-Z]{6}) ([\d.]+) @ ([\d.]+)$/.exec(name);
  if (m) return `${m[1]} ${pairDe(m[2]!)} ${m[3]} @ ${deDecimal(m[4]!)}`;
  m = /^(Payer|Receiver) swaption (\S+)x(\S+) @ ([\d.]+)%$/.exec(name);
  if (m) return `${m[1]}-Swaption ${m[2]}×${m[3]} @ ${deDecimal(m[4]!)} %`;
  m = /^(Payer|Receiver) ([A-Z]{3}) (\S+) @ ([\d.]+)%( \(amortisierend\))?$/.exec(name);
  if (m) return `${m[1]}-Swap ${m[2]} ${m[3]} @ ${deDecimal(m[4]!)} %${m[5] ?? ""}`;
  m = /^(Cap|Floor|Collar) ([A-Z]{3}) (\S+) @ ([\d.]+)%$/.exec(name);
  if (m) return `${m[1]} ${m[2]} ${m[3]} @ ${deDecimal(m[4]!)} %`;
  m = /^IMM ([A-Z]{3}) (\S+) @ ([\d.]+)%$/.exec(name);
  if (m) return `IMM-Swap ${m[1]} ${m[2]} @ ${deDecimal(m[3]!)} %`;
  m = /^Basis (\S+) \+([\d.]+)bp vs (\S+) (\S+)$/.exec(name);
  if (m) return `Basis-Swap ${m[1]} +${deDecimal(m[2]!)} bp vs ${m[3]} ${m[4]}`;
  m = /^FX-Swap ([A-Z]{6}) ([\d.]+) ([+-]?[\d.]+) Pkt$/.exec(name);
  if (m) return `FX-Swap ${pairDe(m[1]!)} ${m[2]} ${deDecimal(m[3]!)} Pkt`;
  return name;
}

/**
 * Decimal-point numbers inside document cells ("1.216 %", "Terminkurs 1.1725")
 * → German decimal comma (N-07). Dotted dates and grouped integers
 * ("10.000.000 EUR") stay; a lone "x.yyy" is only converted when followed by
 * " %", when it has ≠ 3 decimals, or when the row label names a rate / price.
 */
export function germanizeDocValue(v: string, label = ""): string {
  const rateLike = /kurs|strike|barriere|preis|satz|prämie|vol/i.test(label);
  return v.replace(/(?<![\d.,])(-?\d+\.\d+)(?![\d.])( %)?/g, (whole, num: string, pct: string | undefined) => {
    const decimals = num.split(".")[1]!.length;
    if (pct || decimals !== 3 || rateLike) return `${deDecimal(num)}${pct ?? ""}`;
    return whole;
  });
}
