import { fmtBp, fmtDate, fmtMoney, fmtNum, fmtPct, fmtYears } from "./format.js";

/**
 * Explicit label / unit / formatter per analytics key. Every key the pricing
 * core emits is whitelisted here with a German label and unit; keys that are
 * not listed are never shown with their raw camelCase name – they end up in
 * the collapsed "Weitere (technisch)" group (N-01, F-14).
 */
export interface MetricDef {
  label: string;
  unit?: string;
  fmt: (v: number, ctx: MetricCtx) => string;
  /** Section in the analytics table. */
  section?: "price" | "risk";
}

export interface MetricCtx {
  tradeType: string;
  reportingCurrency: string;
}

const money: MetricDef["fmt"] = (v) => fmtMoney(v, undefined, 0);
const money2: MetricDef["fmt"] = (v) => fmtMoney(v, undefined, 2);
const pct4: MetricDef["fmt"] = (v) => fmtPct(v, 4);
const num4: MetricDef["fmt"] = (v) => fmtNum(v, 4);
const date: MetricDef["fmt"] = (v) => fmtDate(v);
const isFx = (c: MetricCtx) => c.tradeType.startsWith("Fx");
/** Rate-style vol (Bachelier, decimal < 5 %) in bp, lognormal / FX vol in %. */
const vol: MetricDef["fmt"] = (v, c) => (isFx(c) || Math.abs(v) >= 0.05 ? fmtPct(v, 2) : fmtBp(v, 1));

export const METRICS: Record<string, MetricDef> = {
  // swaps / FRAs
  parRate: { label: "Par-Satz", fmt: pct4 },
  parRateBase: { label: "Par-Satz (Basis, Staffel konstant)", fmt: pct4 },
  parRateFlat: { label: "Par-Satz (flach)", fmt: pct4 },
  fairSpread: { label: "Fairer Spread", fmt: (v) => fmtBp(v, 1) },
  fixedRate: { label: "Festsatz", fmt: pct4 },
  annuity: { label: "Annuität", unit: "Σ DF·τ·Nominal", fmt: money },
  pvFixed: { label: "PV Festzins", fmt: money },
  pvFloat: { label: "PV Variabel", fmt: money },
  pvLeg1: { label: "PV Leg 1", fmt: money },
  pvLeg2: { label: "PV Leg 2", fmt: money },
  remainingYears: { label: "Restlaufzeit", fmt: (v) => fmtYears(v) },
  maturity: { label: "Fälligkeit", fmt: date },
  forwardRate: { label: "Forward-Satz", fmt: pct4 },
  fixingDate: { label: "Fixing-Datum", fmt: date },
  accrualFactor: { label: "Tagefaktor", fmt: (v) => fmtNum(v, 6) },
  discountFactor: { label: "Diskontfaktor", fmt: (v) => fmtNum(v, 6) },
  df: { label: "Diskontfaktor", fmt: (v) => fmtNum(v, 6) },
  // options (rates)
  forwardSwapRate: { label: "Forward-Swapsatz", fmt: pct4 },
  strike: { label: "Strike", fmt: (v, c) => (isFx(c) ? fmtNum(v, 4) : fmtPct(v, 4)) },
  floorStrike: { label: "Floor-Strike", fmt: pct4 },
  volatility: { label: "Volatilität", fmt: vol },
  /** Core R3: vol as quoted on the surface before a normal ↔ lognormal conversion for the requested model. */
  surfaceVolatility: { label: "Volatilität (Fläche, Original-Quotierung)", fmt: vol },
  impliedVol: { label: "Implizite Vol", fmt: vol },
  expiryYears: { label: "Zeit bis Verfall", fmt: (v) => fmtYears(v) },
  tenorYears: { label: "Swap-Laufzeit", fmt: (v) => fmtYears(v) },
  premiumBp: { label: "Prämie", unit: "bp Nominal", fmt: (v) => fmtNum(v, 1) },
  premiumPct: { label: "Prämie", unit: "% Nominal", fmt: (v) => `${fmtNum(v, 3)} %` },
  premiumPctBase: { label: "Prämie", unit: "% Basis-Nominal", fmt: (v) => `${fmtNum(v, 3)} %` },
  premiumQuotePerUnit: { label: "Prämie je Einheit", unit: "Quote-Ccy", fmt: (v) => fmtNum(v, 5) },
  premiumPipsQuote: { label: "Prämie", unit: "Pips", fmt: (v) => fmtNum(v, 1) },
  underlyingPv: { label: "PV Underlying", fmt: money },
  intrinsic: { label: "Innerer Wert", fmt: money },
  timeValue: { label: "Zeitwert", fmt: money },
  breakEven: { label: "Break-even", fmt: pct4 },
  // model greeks (rates: per 1.00 forward change; FX: money per move)
  delta: { label: "Delta", unit: "je 1,00 Forward", fmt: money, section: "risk" },
  deltaPerBp: { label: "Delta", unit: "je 1 bp", fmt: money2, section: "risk" },
  gamma: { label: "Gamma", unit: "je 1,00²", fmt: money2, section: "risk" },
  gammaPerBp2: { label: "Gamma", unit: "je 1 bp²", fmt: (v) => fmtNum(v, 4), section: "risk" },
  vega: { label: "Vega", unit: "je 1 bp / 1 Vol-Pkt", fmt: money, section: "risk" },
  vegaCaplet: { label: "Vega Caplet", unit: "je 1 bp", fmt: money, section: "risk" },
  thetaPerDay: { label: "Theta", unit: "je Tag", fmt: money, section: "risk" },
  rhoDomestic: { label: "Rho Quote-Ccy", unit: "je 1 bp", fmt: money, section: "risk" },
  rhoForeign: { label: "Rho Basis-Ccy", unit: "je 1 bp", fmt: money, section: "risk" },
  // FX
  deltaBase: { label: "Spot-Delta", unit: "Basis-Ccy", fmt: money, section: "risk" },
  /** Core: signed spot delta as a fraction of the base notional (−1 … +1), shown in % (N-01). */
  deltaPct: { label: "Delta (Spot)", unit: "Anteil Basis-Nominal", fmt: (v) => fmtPct(v, 2), section: "risk" },
  /** Core: PV change (reporting ccy) for +1 % spot – a money amount. */
  deltaAmount: { label: "Delta-Betrag je +1 % Spot", fmt: money, section: "risk" },
  fxDelta: { label: "FX-Delta", unit: "je +1 % Spot", fmt: money, section: "risk" },
  fxDeltaSellCurrency: { label: "FX-Delta Verkaufswährung", unit: "je +1 % Spot", fmt: money, section: "risk" },
  contractRate: { label: "Kontraktkurs", fmt: num4 },
  fairForward: { label: "Fairer Forward", fmt: (v) => fmtNum(v, 5) },
  forward: { label: "Forward", fmt: (v, c) => (isFx(c) ? fmtNum(v, 5) : fmtPct(v, 4)) },
  forwardPoints: { label: "Forward-Punkte", unit: "Pips", fmt: (v) => fmtNum(v, 1) },
  swapPoints: { label: "Swap-Punkte", unit: "Pips", fmt: (v) => fmtNum(v, 1) },
  spot: { label: "Spot", fmt: num4 },
  spotDate: { label: "Spot-Datum", fmt: date },
  spotAtValuationDate: { label: "Spot (Bewertungstag)", unit: "DF-adjustiert", fmt: num4 },
  rd: { label: "Zins Quote-Ccy", fmt: pct4 },
  rf: { label: "Zins Basis-Ccy", fmt: pct4 },
  nearFairForward: { label: "Fairer Near-Kurs", fmt: (v) => fmtNum(v, 5) },
  farFairForward: { label: "Fairer Far-Kurs", fmt: (v) => fmtNum(v, 5) },
  nearPv: { label: "PV Near", fmt: money },
  farPv: { label: "PV Far", fmt: money },
  marginPct: { label: "Marge", unit: "% Nominal", fmt: (v) => `${fmtNum(v, 3)} %` },
  hazardRate: { label: "Hazard-Rate", fmt: pct4 },
};

/** Text-valued analytics: label + German value mapping (null value map = pass through). */
const TEXT_METRICS: Record<string, { label: string; values?: Record<string, string>; hidden?: boolean }> = {
  greeksMethod: {
    label: "Greeks",
    values: { analytic: "analytisch", "finite-difference": "Finite Differenzen", fd: "Finite Differenzen", numeric: "numerisch" },
  },
  fxDeltaCurrency: { label: "FX-Delta-Währung" },
  kind: {
    label: "Auszahlungsprofil",
    values: { Vanilla: "Vanilla", Digital: "Digital", Barrier: "Barriere", DigitalCash: "Digital (Cash)", DigitalAsset: "Digital (Asset)" },
  },
  model: {
    label: "Modell",
    values: { Bachelier: "Bachelier (Normal)", Black: "Black (Lognormal)", ShiftedBlack: "Shifted Black", GarmanKohlhagen: "Garman–Kohlhagen" },
  },
  settlement: {
    label: "Settlement",
    values: {
      Physical: "Physisch",
      Cash: "Barausgleich",
      "Cash (CollateralisedCashPrice)": "Barausgleich (Collateralised Cash Price)",
      "Cash (IRR)": "Barausgleich (IRR)",
    },
  },
  isFixed: { label: "Fixing erfolgt", values: { yes: "ja", no: "nein" } },
  ndf: { label: "NDF", values: { yes: "ja", no: "nein" } },
  mtmReset: { label: "MtM-Reset", values: { yes: "ja", no: "nein" } },
  volConverted: { label: "Vol-Quotierung umgerechnet (Normal ↔ Lognormal)", values: { yes: "ja", no: "nein" } },
  deliveryConvention: { label: "Lieferkonvention", values: { standard: "Standard (Spot-Lag)", "non-standard": "abweichend" } },
  // core R5 (N5-2): FX option lifecycle – alive, expired (settlement pending), delivered
  lifecycle: {
    label: "Lebenszyklus",
    values: {
      alive: "laufend",
      expired: "verfallen (Lieferung ausstehend)",
      delivered: "geliefert",
      "expires-today": "verfällt heute",
      "settles-today": "wird heute geliefert",
    },
  },
};

/** Keys never shown as rows: duplicated elsewhere or purely internal model terms. */
const SKIP = new Set(["d1", "d2", "pair", "currency", "index", "tradeId"]);

export interface AnalyticsRow {
  k: string;
  label: string;
  unit?: string;
  v: string;
  section: "price" | "risk";
  /** True when the key is not whitelisted – shown only in "Weitere (technisch)". */
  technical?: boolean;
}

export function metricLabel(k: string): string {
  return METRICS[k]?.label ?? TEXT_METRICS[k]?.label ?? k;
}

export function isKnownMetric(k: string): boolean {
  return k in METRICS || k in TEXT_METRICS || SKIP.has(k);
}

export function formatMetric(k: string, v: number, ctx: MetricCtx): string {
  const def = METRICS[k];
  if (def) return def.fmt(v, ctx);
  if (/years$/i.test(k)) return fmtYears(v);
  if (/date$/i.test(k)) return fmtDate(v);
  if (/^pv/i.test(k) || /Pv$/.test(k)) return fmtMoney(v, undefined, 0);
  return fmtNum(v, 4);
}

/** camelCase key → readable German-ish fallback label ("spotAtValuationDate" → "Spot at valuation date"). */
function humanize(k: string): string {
  const words = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Rows of an analytics record with explicit label/unit/format per key,
 * deduplicated by label+unit. Unknown keys are flagged `technical` (never a
 * raw camelCase label).
 */
export function analyticsRows(analytics: Record<string, number | string | undefined>, ctx: MetricCtx): AnalyticsRow[] {
  const rows: AnalyticsRow[] = [];
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(analytics)) {
    if (v === undefined || v === null || SKIP.has(k)) continue;
    if (typeof v === "string") {
      const tm = TEXT_METRICS[k];
      if (tm?.hidden) continue;
      const label = tm?.label ?? humanize(k);
      const dedupe = `${label}|`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rows.push({ k, label, v: tm?.values?.[v] ?? v, section: "price", technical: !tm });
      continue;
    }
    if (typeof v !== "number") continue;
    const def = METRICS[k];
    const label = def?.label ?? humanize(k);
    const unit = def?.unit;
    const dedupe = `${label}|${unit ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    rows.push({ k, label, unit, v: formatMetric(k, v, ctx), section: def?.section ?? "price", technical: !def });
  }
  return rows;
}

/** German labels of `PricingResult.details` (ISO date strings and identifiers). */
const DETAIL_LABELS: Record<string, string> = {
  spotDate: "Spot-Datum",
  fixingDate: "Fixing-Datum",
  settlementDate: "Settlement-Datum",
  maturity: "Fälligkeit",
  expiryDate: "Verfall",
  deliveryDate: "Lieferung",
  paymentDate: "Zahlung",
};

export interface DetailRow {
  k: string;
  label: string;
  v: string;
}

/**
 * Rows for `result.details`: ISO dates are rendered as dd.mm.yyyy, other
 * strings pass through; unknown keys get a humanised label.
 */
export function detailRows(details: Record<string, string | undefined> | undefined): DetailRow[] {
  if (!details) return [];
  const out: DetailRow[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (!v) continue;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    out.push({ k, label: DETAIL_LABELS[k] ?? humanize(k), v: iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : v });
  }
  return out;
}

/** Vega / delta bucket kinds of the core ("swaption:EUR", "caplet:EUR-EURIBOR-6M", "fx:EURUSD") → German nouns (R4-10). */
const BUCKET_KIND_DE: Record<string, string> = { swaption: "Swaption", caplet: "Caplet", fx: "FX", cap: "Cap", floor: "Floor" };

/** Label of a bucketed risk key such as "EUR:1Y", "swaption:EUR" or "EURUSD" → "EUR 1Y", "Swaption EUR". */
export function bucketLabel(key: string): string {
  return key
    .split(":")
    .map((part, i) => (i === 0 && BUCKET_KIND_DE[part.toLowerCase()] ? BUCKET_KIND_DE[part.toLowerCase()]! : part))
    .join(" ");
}

/** Definitions shown as tooltips on KPI labels (Ⓘ). */
export const METRIC_DEFINITIONS: Record<string, string> = {
  pv: "Barwert (Present Value): Summe aller diskontierten Zahlungen in der Reporting-Währung, positiv = Forderung aus unserer Sicht.",
  dv01: "DV01: Barwertänderung bei einer parallelen Verschiebung aller Zinskurven um +1 Basispunkt (0,01 %).",
  theta: "Theta 1D: Barwertänderung durch einen Tag Zeitablauf bei unveränderten Marktdaten (Zeitwertverlust).",
  gamma: "Gamma (1bp²): Änderung des DV01 bei +1 bp – zweite Ableitung PV(+1bp) + PV(−1bp) − 2·PV.",
  vega: "Vega: Barwertänderung bei +1 bp Normal-Volatilität (Zinsoptionen) bzw. +1 Vol-Punkt (FX-Optionen).",
  fxDelta: "FX-Delta 1 %: Barwertänderung bei einer Aufwertung der Basiswährung um 1 % gegenüber der Reporting-Währung.",
  epe: "EPE (Expected Positive Exposure): erwarteter positiver Marktwert je Stützstelle, diskontiert – Basis für den CVA.",
  ene: "ENE (Expected Negative Exposure): erwarteter negativer Marktwert je Stützstelle, diskontiert – Basis für den DVA.",
  cva: "CVA (Credit Valuation Adjustment): erwarteter Verlust aus dem Ausfall des Kontrahenten = Σ EPE · PD · LGD.",
  dva: "DVA (Debit Valuation Adjustment): Bewertungsvorteil aus dem eigenen Ausfallrisiko = Σ ENE · PD(eigen) · LGD.",
  ifrs13:
    "IFRS 13 Fair-Value-Hierarchie: Level 1 = notierte Preise, Level 2 = beobachtbare Inputs (OTC-Vanillas auf Kurven/Vols), Level 3 = wesentliche nicht beobachtbare Inputs (z. B. Vol-Override, Extrapolation).",
  parRate: "Par-Satz: Festsatz, bei dem der Swap einen Barwert von null hat.",
  parRateBase:
    "Par-Satz (Basis): Kupon der ersten offenen Periode, der den Barwert auf null bringt, wobei alle Stufen der Kuponstaffel (r_i − r_0) konstant bleiben.",
  parRateFlat: "Par-Satz (flach): der einheitliche Kupon, der die gesamte Kuponstaffel ersetzt und den Barwert auf null bringt.",
  fairSpread: "Fairer Spread: Aufschlag auf das erste variable Leg, der den Basis-Swap auf Barwert null bringt.",
  fairBasisSpread:
    "Fairer Basis-Spread: Aufschlag auf das Spread-Leg (Leg 1) des Cross-Currency-Swaps, der beide Legs inkl. Nominalaustausch auf Barwert null bringt.",
  keyRate: "Key-Rate-Delta: Barwertänderung bei +1 bp auf einem einzelnen Kurvenpillar (Summe ≈ DV01).",
  parRisk: "Par-Sensitivität: Barwertänderung bei +1 bp auf einer Marktquote (Deposit, FRA, Future, Swap) mit Neu-Bootstrapping aller abhängigen Kurven.",
  hedgeRatio: "Hedge Ratio: Anteil des Grundgeschäfts, der durch das Sicherungsinstrument abgesichert wird (IFRS 9 6.3.7).",
  dollarOffset:
    "Dollar-Offset: Verhältnis der Wertänderung des Sicherungsinstruments zur Wertänderung des hypothetischen Derivats; effektiv innerhalb 80–125 %.",
  regression: "Regressionsmethode: OLS-Steigung der Wertänderungen über Szenarien (Band 0,8–1,25) und Bestimmtheitsmaß R² ≥ 0,8.",
  perspective:
    "Perspektive: Aus wessen Sicht Barwert und Transaktionspreis angegeben sind. „Kunde“ = das Geschäft ist die Position des Kunden (Beispielportfolio), „Bank“ = Buchung aus Sicht der Bank.",
  governance:
    "Bewertungs-Governance (IFRS 13 / IDW RS HFA 47, MaRisk AT 4.3.5): Status des Markt-Snapshots (indikativ / freigegeben), Datenquellen, Modellversion und ggf. Validierer.",
};
