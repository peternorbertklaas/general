import { type InterpolatedCurve } from "../curves/curve.js";
import { getIndex } from "../curves/index-definitions.js";
import { toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { frequencyPerYear } from "../dates/schedule.js";
import { formatPctDe } from "../format.js";
import { embeddedOptionLegs, tradeMaturityDate } from "../instruments/trade-dates.js";
import { type FloatLeg, type PricingResult, type SwapLeg, type Trade } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve } from "../market/market-context.js";
import { fxSpotLag } from "../market/fx-spot.js";
import { splitPair } from "../pricing/fx-pricer.js";
import { type RiskReport, capletSurfaceKeysFor, tradeCurveIds } from "../risk/sensitivities.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { type XvaResult } from "../xva/cva.js";

/**
 * Audit-ready valuation report: everything a reviewer (Wirtschaftsprüfer,
 * Marktfolge, Kunde) needs to reproduce a number – market snapshot,
 * conventions, cashflow table, sensitivities, credit adjustments and the
 * fair-value hierarchy classification.
 */
export interface ValuationReport {
  generatedAt: string;
  valuationDate: string;
  reportingCurrency: string;
  trade: Trade;
  pricing: PricingResult;
  risk?: RiskReport;
  xva?: XvaResult;
  market: {
    label?: string;
    source?: string;
    curves: { id: string; currency: string; interpolation?: string; nodes: { date: string; zero: number; df: number }[] }[];
    fxSpots: Record<string, number>;
  };
  fairValue: {
    riskFree: number;
    cva: number;
    dva: number;
    adjusted: number;
    /** IFRS 13 hierarchy level (Level 2 for observable-input OTC vanillas). */
    ifrs13Level: 1 | 2 | 3;
    rationale: string;
  };
  /** MiFID II ex-ante cost breakdown when a transaction price is provided. */
  costTransparency?: {
    /** Whose point of view `pricing.pv` and `transactionPrice` are expressed in. */
    perspective: ReportPerspective;
    /** Price paid (positive) or received (negative) at inception by the `perspective` party. */
    transactionPrice: number;
    /** Fair value (CVA/DVA-adjusted) from the `perspective` party's point of view. */
    fairValue: number;
    /** Initial (typically negative) market value from the client's perspective – always the client's view, whatever `perspective` is. */
    initialMarketValue: number;
    /** Margin embedded for the bank at inception (= −initialMarketValue). */
    bankMargin: number;
    /** Bank margin in bp of notional. */
    marginBp: number;
    /** Bank margin in % of notional. */
    marginPct: number;
    /** Human-readable sign convention (German) for the reviewer. */
    signRule: string;
  };
  methodology: string[];
  /**
   * Valuation governance (IDW RS HFA 35 / MaRisk AT 4.3.x): status of the
   * market snapshot, data sources and the model version used, plus the
   * validator when the snapshot has been approved.
   */
  governance: ValuationGovernance;
  /** Reproducibility anchors: snapshot id (market inputs), inputs hash (trade + snapshot), report hash (content, excludes timings). */
  audit: { snapshotId: string; inputsHash: string; reportHash: string; engineVersion: string; preparedBy?: string };
  /**
   * Set when the report was produced under a what-if shift of the market
   * (stress numbers). Such a report is explicitly NOT an audit valuation.
   */
  whatIf?: { ratesBp: number; fxPct: number; volBp: number; label: string };
}

/**
 * Point of view of the valuation: "Bank" (default) – the trade is booked as
 * the bank sees it (`pricing.pv` is the bank's asset value, `transactionPrice`
 * what the bank pays); "Kunde" – the trade is the client's position.
 */
export type ReportPerspective = "Bank" | "Kunde";

export interface ValuationGovernance {
  /** "indicative": unapproved / sample market data; "approved": independently validated EoD snapshot. */
  snapshotStatus: "indicative" | "approved";
  /** Market data sources (e.g. "ECB €STR", "EMMI EURIBOR", "Refinitiv"); default: the snapshot's `meta.source`. */
  inputSources: string[];
  /** Model / engine version (defaults to `ENGINE_VERSION`). */
  modelVersion: string;
  /** Person / unit that validated the snapshot and model parameters (independent validation, MaRisk BTO 2.2.1). */
  validatedBy?: string;
}

/** Version of the pricing engine embedded in every report for reproducibility (single source: package.json via src/version.ts). */
export const ENGINE_VERSION = `${PACKAGE_NAME.replace(/^@deriva\//, "deriva-")}/${PACKAGE_VERSION}`;

/** Tolerance (calendar days) before a maturity beyond the last curve pillar counts as extrapolation. */
const EXTRAPOLATION_TOLERANCE_DAYS = 30;
/** Tolerance (years) before an option expiry / tenor beyond the vol surface grid counts as extrapolation. */
const VOL_EXTRAPOLATION_TOLERANCE_YEARS = 30 / 365;

/**
 * Vol-surface horizon checks: option expiry (and swaption tenor) beyond the
 * last grid point of the surface the valuation reads. Returns German reasons.
 */
function volSurfaceExtrapolation(ctx: MarketContext, trade: Trade, pricing: PricingResult): string[] {
  const reasons: string[] = [];
  const val = ctx.valuationDate;
  const tol = VOL_EXTRAPOLATION_TOLERANCE_YEARS;
  const beyond = (what: string, value: number, grid: number[] | undefined, surfaceId: string) => {
    const last = grid?.[grid.length - 1];
    if (last !== undefined && value > last + tol)
      reasons.push(`${what} ${value.toFixed(2)}Y über letztem Gitterpunkt (${last}Y) der Volatilitätsfläche ${surfaceId} hinaus (Extrapolation)`);
  };
  if (trade.type === "Swaption") {
    const ccy = trade.underlying.legs[0]?.currency ?? "";
    const s = ctx.swaptionVols?.[ccy];
    if (s && trade.volOverride === undefined) {
      const tExp = (pricing.analytics.expiryYears as number | undefined) ?? Math.max(0, yearFraction(val, trade.expiryDate, "ACT/365F"));
      const tenor = (pricing.analytics.tenorYears as number | undefined) ?? yearFraction(trade.expiryDate, tradeMaturityDate(trade), "ACT/365F");
      beyond("Optionslaufzeit", tExp, s.expiries, s.id);
      beyond("Swap-Tenor", tenor, s.tenors, s.id);
    }
  }
  if (trade.type === "CapFloor" && trade.volOverride === undefined) {
    for (const key of capletSurfaceKeysFor(ctx, trade)) {
      const s = ctx.capletVols![key]!;
      // last caplet expiry ≈ maturity − one period
      const tLast = Math.max(0, yearFraction(val, trade.terminationDate, "ACT/365F") - 1 / frequencyPerYear(trade.frequency));
      beyond("Letzte Caplet-Expiry", tLast, s.expiries, s.id);
    }
  }
  for (const leg of embeddedOptionLegs(trade)) {
    const key = capletSurfaceKeysFor(ctx, trade).find((k) => k.startsWith(leg.currency));
    const s = key ? ctx.capletVols?.[key] : undefined;
    if (!s) continue;
    const tLast = Math.max(0, yearFraction(val, leg.terminationDate, "ACT/365F") - 1 / frequencyPerYear(leg.frequency));
    beyond(`Letzte Fixing-Expiry des eingebetteten ${leg.capRate !== undefined ? "Caps" : "Floors"}`, tLast, s.expiries, s.id);
  }
  if (trade.type === "FxOption" && trade.volOverride === undefined) {
    const { base, quote } = splitPair(trade.pair);
    const s = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
    if (s) {
      const tExp = (pricing.analytics.expiryYears as number | undefined) ?? Math.max(0, yearFraction(val, trade.expiryDate, "ACT/365F"));
      beyond("Optionslaufzeit", tExp, s.expiries, s.id);
    }
  }
  return reasons;
}

/**
 * IFRS 13 fair-value hierarchy classification. Level 2 for OTC vanillas priced
 * off observable curves/vols; Level 3 when a manual vol override replaces an
 * observable surface, when the trade's maturity extrapolates beyond the last
 * pillar of a curve the valuation actually uses (discount curve under the
 * trade's CSA, projection curves of its indices – not every curve in the
 * market context), when an option expiry / tenor lies beyond the vol surface
 * grid, or when a required vol surface is missing (fallback vol used).
 */
export function ifrs13Level(ctx: MarketContext, trade: Trade, pricing: PricingResult): { level: 1 | 2 | 3; rationale: string } {
  const reasons: string[] = [];
  const maturity = tradeMaturityDate(trade);
  for (const id of tradeCurveIds(ctx, trade)) {
    const c = ctx.curves[id]!;
    const last = c.nodeDates[c.nodeDates.length - 1];
    if (last !== undefined && maturity > last + EXTRAPOLATION_TOLERANCE_DAYS) {
      reasons.push(`Fälligkeit ${toISO(maturity)} über letzten Pillar (${toISO(last)}) der genutzten Kurve ${c.id} hinaus (Extrapolation)`);
    }
  }
  reasons.push(...volSurfaceExtrapolation(ctx, trade, pricing));
  const hasOverride = "volOverride" in trade && (trade as { volOverride?: number }).volOverride !== undefined;
  if (hasOverride) reasons.push("manueller Volatilitäts-Override statt beobachtbarer Fläche");
  if (pricing.warnings.some((w) => /No .*vol surface/i.test(w))) reasons.push("keine Volatilitätsfläche vorhanden, Fallback-Vol verwendet");
  if (trade.type === "FxOption" && trade.barrier)
    reasons.push("Barriere-Option: Modellabhängigkeit (Reiner-Rubinstein ohne Smile-Korrektur) – als Level 2 mit Hinweis eingestuft");
  if (reasons.some((r) => !r.startsWith("Barriere"))) {
    return { level: 3, rationale: `Wesentliche nicht beobachtbare Inputs: ${reasons.join("; ")} → Level 3.` };
  }
  return {
    level: 2,
    rationale:
      "Bewertung mit beobachtbaren Marktdaten (OIS-/Swapkurven, Volatilitäten, FX-Spots) und marktüblichen Modellen; keine wesentlichen nicht beobachtbaren Inputs → Level 2." +
      (reasons.length ? ` Hinweis: ${reasons.join("; ")}.` : ""),
  };
}

/** Deterministic JSON (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** FNV-1a 64-bit hash rendered as 16 hex chars (dependency-free, deterministic across runtimes). */
export function hashString(s: string): string {
  let h = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Deterministic id of a market snapshot: FNV-1a hash over valuation date,
 * curve node discount factors (per curve id) and FX spots. Identical to
 * `report.audit.snapshotId`, so API and UI can label results without building
 * a report (`X-Market-Snapshot-Id`).
 */
export function marketSnapshotId(ctx: MarketContext): string {
  return hashString(
    stableStringify({
      valuationDate: ctx.valuationDate,
      curves: Object.values(ctx.curves).map((c) => ({ id: c.id, nodes: c.nodeDates.map((d) => [d, c.df(d)]) })),
      fx: ctx.fxSpots,
    }),
  );
}

export interface ValuationReportOptions {
  risk?: RiskReport;
  xva?: XvaResult;
  transactionPrice?: number;
  notional?: number;
  /** Active what-if shifts (marks the report as a stress valuation). */
  whatIf?: { ratesBp: number; fxPct: number; volBp: number };
  preparedBy?: string;
  /** Fixed timestamp for deterministic output (defaults to now). */
  generatedAt?: string;
  /**
   * Point of view of `pricing.pv` / `transactionPrice` for the cost
   * transparency block (default "Bank"). See `costTransparency.signRule`.
   */
  perspective?: ReportPerspective;
  /** Valuation governance; defaults: indicative snapshot, sources from `ctx.meta.source`, model version = engine version. */
  governance?: Partial<ValuationGovernance>;
}

/**
 * Cost transparency sign rule (MiFID II ex-ante costs, BGH XI ZR 33/10):
 * `bankMargin` is the bank's day-1 gain, `initialMarketValue` the client's
 * initial (negative) market value = −bankMargin, regardless of the
 * perspective the trade is booked in.
 */
export function costTransparencyFor(
  perspective: ReportPerspective,
  fairValue: number,
  transactionPrice: number,
  notional: number,
): NonNullable<ValuationReport["costTransparency"]> {
  // From the perspective party's view the day-1 gain is fairValue − price paid.
  const gainOfPerspective = fairValue - transactionPrice;
  const bankMargin = perspective === "Bank" ? gainOfPerspective : -gainOfPerspective;
  const initialMarketValue = -bankMargin;
  return {
    perspective,
    transactionPrice,
    fairValue,
    initialMarketValue,
    bankMargin,
    marginBp: notional ? (bankMargin / notional) * 1e4 : 0,
    marginPct: notional ? (bankMargin / notional) * 100 : 0,
    signRule: costSignRule(perspective),
  };
}

function costSignRule(perspective: ReportPerspective): string {
  const who = perspective === "Bank" ? "der Bank" : "des Kunden";
  return (
    `Perspektive ${perspective}: Barwert (fairValue) und Transaktionspreis sind aus Sicht ${who} angegeben (Transaktionspreis > 0 = ${who === "der Bank" ? "die Bank zahlt" : "der Kunde zahlt"} bei Abschluss). ` +
    `Marge der Bank = ${perspective === "Bank" ? "fairValue − Transaktionspreis" : "Transaktionspreis − fairValue"}; anfänglicher Marktwert aus Kundensicht = −Marge der Bank (negativ, wenn der Kunde eine Marge trägt). marginBp/marginPct beziehen die Marge der Bank auf das Nominal.`
  );
}

export function buildValuationReport(ctx: MarketContext, trade: Trade, pricing: PricingResult, opts: ValuationReportOptions = {}): ValuationReport {
  const wi = opts.whatIf && (opts.whatIf.ratesBp !== 0 || opts.whatIf.fxPct !== 0 || opts.whatIf.volBp !== 0) ? opts.whatIf : undefined;
  const whatIfLabel = wi
    ? `What-if ${wi.ratesBp >= 0 ? "+" : ""}${wi.ratesBp}bp · FX ${wi.fxPct >= 0 ? "+" : ""}${wi.fxPct}% · Vol ${wi.volBp >= 0 ? "+" : ""}${wi.volBp}bp – keine prüfungsfähige Bewertung`
    : undefined;
  const cva = opts.xva?.cva ?? 0;
  const dva = opts.xva?.dva ?? 0;
  const adjusted = pricing.pv - (Number.isFinite(cva) ? cva : 0) + (Number.isFinite(dva) ? dva : 0);
  const notional = opts.notional ?? inferNotional(trade);
  const perspective = opts.perspective ?? "Bank";
  const curves = Object.values(ctx.curves).map((c) => ({
    id: c.id,
    currency: c.currency,
    interpolation: (c as { interpolation?: string }).interpolation,
    nodes: c.nodeDates.map((d) => ({ date: toISO(d), zero: c.zeroRate(d), df: c.df(d) })),
  }));
  const { level, rationale } = ifrs13Level(ctx, trade, pricing);
  const governance: ValuationGovernance = {
    snapshotStatus: opts.governance?.snapshotStatus ?? "indicative",
    inputSources: opts.governance?.inputSources ?? (ctx.meta?.source ? [ctx.meta.source] : ["DERIVA sample market (indicative)"]),
    modelVersion: opts.governance?.modelVersion ?? ENGINE_VERSION,
    validatedBy: opts.governance?.validatedBy,
  };
  const methodology = methodologyFor(trade, ctx, pricing, {
    risk: opts.risk,
    xva: opts.xva,
    perspective: opts.transactionPrice !== undefined ? perspective : undefined,
    governance,
  });
  const snapshotId = marketSnapshotId(ctx);
  // Inputs hash covers everything that changes the report content besides the market: the trade, the
  // reporting currency and the cost-transparency inputs (transaction price, perspective, notional, what-if).
  const inputsHash = hashString(
    stableStringify({
      trade,
      snapshotId,
      reportingCurrency: pricing.currency,
      transactionPrice: opts.transactionPrice,
      perspective: opts.transactionPrice !== undefined ? perspective : undefined,
      notional: opts.transactionPrice !== undefined ? notional : undefined,
      whatIf: wi,
    }),
  );
  const report: ValuationReport = {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    valuationDate: toISO(ctx.valuationDate),
    reportingCurrency: pricing.currency,
    trade,
    pricing,
    risk: opts.risk,
    xva: opts.xva,
    market: { label: whatIfLabel ? `${ctx.meta?.label ?? "Markt"} · ${whatIfLabel}` : ctx.meta?.label, source: ctx.meta?.source, curves, fxSpots: ctx.fxSpots },
    whatIf: wi ? { ...wi, label: whatIfLabel! } : undefined,
    fairValue: {
      riskFree: pricing.pv,
      cva: Number.isFinite(cva) ? cva : 0,
      dva: Number.isFinite(dva) ? dva : 0,
      adjusted,
      ifrs13Level: level,
      rationale,
    },
    methodology,
    governance,
    audit: { snapshotId, inputsHash, reportHash: "", engineVersion: ENGINE_VERSION, preparedBy: opts.preparedBy },
  };
  if (opts.transactionPrice !== undefined) {
    report.costTransparency = costTransparencyFor(perspective, adjusted, opts.transactionPrice, notional);
  }
  // Deterministic content hash: timestamps and timings are excluded (N-01) so two
  // independent valuations of the same inputs yield the same hash. Computed after the
  // cost-transparency block so a different transaction price changes the hash.
  report.audit.reportHash = hashString(stableStringify({ ...report, generatedAt: undefined, audit: undefined, pricing: { ...pricing, timingMs: undefined } }));
  return report;
}

function inferNotional(trade: Trade): number {
  switch (trade.type) {
    case "InterestRateSwap":
    case "CrossCurrencySwap":
      return trade.legs[0]?.notional ?? 0;
    case "Swaption":
      return trade.underlying.legs[0]?.notional ?? 0;
    case "FRA":
    case "CapFloor":
    case "FxOption":
      return trade.notional;
    case "FxForward":
      return trade.buyAmount;
    case "FxSwap":
      return trade.nearLeg.buyAmount;
  }
}

// ---------------------------------------------------------------------------
// Methodology text – generated from the switches that drove the valuation
// ---------------------------------------------------------------------------

const INTERPOLATION_LABELS: Record<string, string> = {
  logLinear: "log-linear in Diskontfaktoren",
  linear: "linear in Diskontfaktoren",
  linearZero: "linear in Zero-Sätzen",
  cubicSplineZero: "kubischer Spline in Zero-Sätzen",
  flatForward: "stückweise konstante Forwards",
  monotoneConvex: "monoton-konvex in Forwards (Hagan–West)",
};

const EXTRAPOLATION_LABELS: Record<string, string> = {
  flatForward: "konstanter letzter Forward (flat-forward)",
  flatZero: "konstanter letzter Zero-Satz (flat-zero)",
};

function pct(x: number, digits = 3): string {
  return formatPctDe(x, digits);
}

function legsOf(trade: Trade): SwapLeg[] {
  if (trade.type === "InterestRateSwap" || trade.type === "CrossCurrencySwap") return trade.legs;
  if (trade.type === "Swaption") return trade.underlying.legs;
  return [];
}

function curveLines(ctx: MarketContext, trade: Trade): string[] {
  const lines: string[] = [];
  const discount: string[] = [];
  const projection: string[] = [];
  const ccys = new Set<string>();
  for (const l of legsOf(trade)) ccys.add(l.currency);
  if (trade.type === "FRA" || trade.type === "CapFloor") ccys.add(trade.currency);
  if (trade.type === "FxForward") [trade.buyCurrency, trade.sellCurrency].forEach((c) => ccys.add(c));
  if (trade.type === "FxSwap") [trade.nearLeg.buyCurrency, trade.nearLeg.sellCurrency].forEach((c) => ccys.add(c));
  if (trade.type === "FxOption") {
    const { base, quote } = splitPair(trade.pair);
    ccys.add(base);
    ccys.add(quote);
  }
  for (const ccy of ccys) {
    try {
      discount.push(`${ccy}: ${getDiscountCurve(ctx, ccy, trade.collateralCurrency).id}`);
    } catch {
      discount.push(`${ccy}: keine Diskontkurve konfiguriert`);
    }
  }
  const indexNames = new Set<string>();
  for (const l of legsOf(trade)) if (l.type === "Float") indexNames.add(l.index);
  if (trade.type === "FRA" || trade.type === "CapFloor") indexNames.add(trade.index);
  for (const name of indexNames) {
    try {
      const idx = getIndex(name);
      projection.push(`${idx.name}: ${idx.curveId}${ctx.curves[idx.curveId] ? "" : " (nicht im Marktkontext)"}`);
    } catch {
      projection.push(`${name}: unbekannter Index`);
    }
  }
  lines.push(
    `Multi-Curve-Framework: Diskontierung je Währung mit der ${trade.collateralCurrency ? `CSA-Kurve (Besicherung in ${trade.collateralCurrency})` : "OIS-Kurve (unbesichert / Standard-Diskontkurve)"} – ${discount.join(", ")}` +
      (projection.length ? `; Projektion der Forwards mit indexspezifischen Kurven – ${projection.join(", ")}.` : "."),
  );
  for (const id of tradeCurveIds(ctx, trade)) {
    const c = ctx.curves[id]! as Partial<InterpolatedCurve>;
    const last = c.nodeDates?.[c.nodeDates.length - 1];
    const interp = c.interpolation ? (INTERPOLATION_LABELS[c.interpolation] ?? c.interpolation) : "n/a";
    const extra = c.extrapolation ? (EXTRAPOLATION_LABELS[c.extrapolation] ?? c.extrapolation) : "n/a";
    lines.push(
      `Kurve ${id}: sequentielles Bootstrapping (Brent je Pillar), Interpolation ${interp}, Extrapolation jenseits des letzten Pillars${last !== undefined ? ` (${toISO(last)})` : ""}: ${extra}; am kurzen Ende erster Forward.`,
    );
  }
  return lines;
}

function conventionLines(trade: Trade): string[] {
  const legs = legsOf(trade);
  if (legs.length === 0)
    return [
      "Tageszählung, Geschäftstagekonvention und Kalender gemäß ISDA-Definitionen (TARGET2, US, UK, CH, JP – regelbasiert, in Produktion durch Feiertagsfeeds überschreibbar).",
    ];
  const parts = legs.map((l, i) => {
    const kind =
      l.type === "Fixed" ? `Fix ${pct(l.rate)}` : `Float ${l.index}${l.spread ? ` ${l.spread >= 0 ? "+" : ""}${(l.spread * 1e4).toFixed(1)} bp` : ""}`;
    return `Leg ${i + 1} (${l.payReceive === "Receive" ? "Empfang" : "Zahlung"}, ${kind}): ${l.frequency}, ${l.dayCount}, ${l.businessDayConvention ?? "ModifiedFollowing"}, Kalender ${l.calendar}, Stub ${l.stub ?? "ShortFront"}${l.endOfMonth ? ", EOM-Roll" : ""}${l.roll === "IMM" ? ", IMM-Roll" : ""}${l.paymentLag ? `, Zahlungsverzug ${l.paymentLag} GT` : ""}`;
  });
  return [
    `Konventionen gemäß ISDA-Definitionen (regelbasierte Kalender TARGET2/US/UK/CH/JP, in Produktion durch Feiertagsfeeds überschreibbar): ${parts.join("; ")}.`,
  ];
}

function fixingLines(ctx: MarketContext, trade: Trade, pricing: PricingResult): string[] {
  const lines: string[] = [];
  const floats = legsOf(trade).filter((l): l is FloatLeg => l.type === "Float");
  if (floats.length === 0 && trade.type !== "FRA" && trade.type !== "CapFloor") return lines;
  const policy = ctx.missingFixingPolicy ?? "curve";
  const missing = pricing.warnings.filter((w) => w.startsWith("MISSING_FIXING:")).length;
  lines.push(
    `Fixings: historische Fixings aus dem Marktkontext (${ctx.fixings?.length ?? 0} geladen); fehlende Fixings ${policy === "throw" ? "führen zum Abbruch der Bewertung (Policy „throw“)" : "werden mit dem ersten Kurven-Forward gleicher Länge ab Bewertungstag geschätzt und als MISSING_FIXING gemeldet (Policy „curve“)"}; in dieser Bewertung ${missing === 0 ? "kein fehlendes Fixing" : `${missing} fehlende(s) Fixing(s)`}.`,
  );
  for (const l of floats) {
    let idxType: "IBOR" | "OIS" | undefined;
    try {
      idxType = getIndex(l.index).type;
    } catch {
      idxType = undefined;
    }
    if (idxType === "OIS") {
      lines.push(
        `RFR-Leg ${l.index}: ${(l.compounding ?? "Compound") === "Compound" ? "Compounding" : "arithmetisches Averaging"} in arrears der täglichen Fixings, Lookback ${l.lookbackDays ?? 0} Geschäftstage${l.lookbackDays ? (l.observationShift ? " mit Observation Shift (Gewichte aus der Beobachtungsperiode)" : " ohne Observation Shift (Gewichte aus der Zinsperiode)") : ""}, realisierter Teil bis zum Bewertungstag aus Fixings, Rest aus der Kurve; Accrued = realisiertes Compounding.`,
      );
    }
    if (l.capRate !== undefined || l.floorRate !== undefined) {
      const parts: string[] = [];
      if (l.capRate !== undefined) parts.push(`Cap ${pct(l.capRate, 2)}`);
      if (l.floorRate !== undefined) parts.push(`Floor ${pct(l.floorRate, 2)}`);
      const key = capletSurfaceKeysFor(ctx, trade).find((k) => k.startsWith(l.currency));
      const s = key ? ctx.capletVols?.[key] : undefined;
      lines.push(
        `Eingebettete Option auf Leg ${l.index} (${parts.join(", ")}): erwarteter Kupon E[min(max(L, Floor), Cap)] = L + Floorlet − Caplet, bewertet ${s ? `mit ${s.volType === "Normal" ? "Bachelier" : "Black-76" + (s.shift ? ` (Shift ${pct(s.shift, 2)})` : "")} auf der Caplet-Fläche ${s.id} (Vol je Expiry/Strike)` : "intrinsisch (keine Caplet-Fläche im Marktkontext)"}; fixierte Perioden intrinsisch. Vega/Vega-Buckets werden über die Caplet-Fläche ausgewiesen.`,
      );
    }
  }
  return lines;
}

function instrumentLines(ctx: MarketContext, trade: Trade, pricing: PricingResult): string[] {
  const a = pricing.analytics;
  switch (trade.type) {
    case "InterestRateSwap":
      return [
        "Barwert = Summe diskontierter fixer und projizierter variabler Cashflows; Par-Satz und fairer Spread analytisch aus der Annuität; Umrechnung in die Reporting-Währung zum auf den Bewertungstag angepassten Spot.",
      ];
    case "CrossCurrencySwap":
      return [
        `Cross-Currency-Swap mit Nominalaustausch${a.mtmReset === "yes" ? " und MtM-Reset (Nominal des resettenden Legs aus Spot-Date-verankerten Forward-FX-Kursen)" : ""}; jede Seite auf ihrer Diskontkurve; Umrechnung in die Reporting-Währung zum auf den Bewertungstag angepassten Spot.`,
      ];
    case "FRA":
      return [
        `FRA mit Settlement am Startdatum und Abdiskontierung über die FRA-Periode (ISDA); Fixing ${a.isFixed === "yes" ? "aus Marktkontext" : "aus Kurven-Forward"}.`,
      ];
    case "CapFloor": {
      const model = String(a.model ?? "Bachelier");
      const key = capletSurfaceKeysFor(ctx, trade)[0];
      const s = key ? ctx.capletVols?.[key] : undefined;
      const volSrc =
        trade.volOverride !== undefined
          ? `flache Override-Vol ${trade.volOverride}`
          : s
            ? `Caplet-Fläche ${s.id} (${s.volType}, bilinear in Expiry/Strike)`
            : "Fallback-Vol 60 bp (keine Fläche)";
      return [
        `Caplets/Floorlets als Strip auf den Index-Forward, Modell ${model}${model === "ShiftedBlack" ? ` (Shift ${pct(trade.shift ?? s?.shift ?? 0, 2)})` : ""}; Volatilität: ${volSrc}; Caplet-Expiry = Fixingtermin, Zahlung nachschüssig; fixierte Caplets intrinsisch. Greeks analytisch (Delta/Gamma je bp, Vega je ${model === "Bachelier" ? "bp Normal-Vol" : "Vol-Punkt"}).`,
      ];
    }
    case "Swaption": {
      const model = String(a.model ?? "Bachelier");
      const ccy = trade.underlying.legs[0]?.currency ?? "";
      const s = ctx.swaptionVols?.[ccy];
      const volSrc =
        trade.volOverride !== undefined
          ? `flache Override-Vol ${trade.volOverride}`
          : s
            ? `ATM-Cube ${s.id} (${s.volType}, bilinear in Expiry/Tenor)${s.sabr ? `, Smile am Strike per SABR (Hagan) mit Alpha-Rekalibrierung auf ATM, Parameter zwischen Gitterpunkten geblendet` : ", ohne Smile (ATM-Vol am Strike)"}`
            : "Fallback-Vol 70 bp (keine Fläche)";
      const vol =
        typeof a.volatility === "number"
          ? ` – verwendete Vol ${s?.volType === "Normal" || !s ? `${(a.volatility * 1e4).toFixed(2)} bp` : pct(a.volatility, 2)}`
          : "";
      return [
        `Europäische Swaption, Modell ${model}${model === "ShiftedBlack" ? ` (Shift ${pct(trade.shift ?? s?.shift ?? 0, 2)})` : ""} auf den Forward-Swapsatz; Settlement ${String(a.settlement ?? trade.settlement)} (${trade.settlement === "Cash" && (trade.cashSettlementConvention ?? "CollateralisedCashPrice") === "IRR" ? "IRR-Cash-Annuität, auf das Settlement-Datum diskontiert" : "Diskont-Annuität"}); Volatilität: ${volSrc}${vol}. Greeks analytisch (Annuitäts-gewichtet).`,
      ];
    }
    case "FxForward":
    case "FxSwap": {
      const b = trade.type === "FxForward" ? trade.buyCurrency : trade.nearLeg.buyCurrency;
      const q = trade.type === "FxForward" ? trade.sellCurrency : trade.nearLeg.sellCurrency;
      const lag = fxSpotLag(b, q);
      return [
        `FX-Forward über Zinsparität mit Spot-Date-Anker (${b}${q}: T+${lag} auf dem Paar-Kalender${b !== "USD" && q !== "USD" ? " inkl. USD" : ""}${pricing.details?.spotDate ? `, Spot-Date ${pricing.details.spotDate}` : ""}): F = S · [DF_Basis(T)/DF_Basis(t_s)] / [DF_Quote(T)/DF_Quote(t_s)]; Barwert = diskontierte Zahlungsströme beider Währungen, umgerechnet zum auf den Bewertungstag angepassten Spot S·DF_Quote(t_s)/DF_Basis(t_s).`,
      ];
    }
    case "FxOption": {
      const { base, quote } = splitPair(trade.pair);
      const s = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
      const lag = fxSpotLag(base, quote);
      const kind = String(a.kind ?? "Vanilla");
      const greeks =
        a.greeksMethod === "finite-difference"
          ? "Greeks per zentralen finiten Differenzen der geschlossenen Formel (Spot-Schritt ≤ ½ Barrierabstand)"
          : "Greeks analytisch (Garman-Kohlhagen)";
      const smile =
        trade.volOverride !== undefined
          ? `flache Override-Vol ${trade.volOverride}`
          : s
            ? `Smile aus ATM/RR/BF-Quotes der Fläche ${s.id} (ATM ${s.atmConvention ?? "DeltaNeutral"}, Delta-Konvention ${s.deltaConvention ?? "Forward"}, Butterfly als ${(s.strangleType ?? "Smile") === "Broker" ? "Broker-Strangle (Reiswich-Wystup-Iteration)" : "Smile-Strangle"}, Interpolation ${(s.smileInterpolation ?? "linear") === "cubic" ? "monoton-kubisch" : "linear"} im Delta-Raum, flache Extrapolation jenseits der äußeren Pillars, Fixpunkt Strike↔Delta)`
            : "Fallback-Vol 8 % (keine Fläche)";
      const vol = typeof a.volatility === "number" ? `, verwendete Vol ${pct(a.volatility, 3)}` : "";
      return [
        `${kind}: Garman-Kohlhagen${trade.barrier ? " / Reiner-Rubinstein (Single-Barrier, Diskontierung und Forward auf das Lieferdatum, Diffusion bis Expiry)" : trade.digital ? " (Digital analytisch, Cash- bzw. Asset-or-nothing)" : ""}; Forward Spot-Date-verankert (${base}${quote}: T+${lag} auf dem Paar-Kalender${base !== "USD" && quote !== "USD" ? " inkl. USD" : ""}${pricing.details?.spotDate ? `, Spot-Date ${pricing.details.spotDate}` : ""}), Diskontierung bis Lieferdatum ${toISO(trade.deliveryDate)}, Vol-Zeit bis Expiry ${toISO(trade.expiryDate)}; ${smile}${vol}; ${greeks}.`,
      ];
    }
  }
}

function riskLines(risk: RiskReport | undefined, xva: XvaResult | undefined): string[] {
  const lines: string[] = [];
  if (risk) {
    lines.push(
      "Sensitivitäten per Bump-and-Reprice: DV01 und Buckets als zentrale Differenz ±1 bp der Zero-Sätze (parallel bzw. je Pillar), Vega +1 bp Normal-Vol (bzw. +1 Vol-Punkt lognormal/FX), FX-Delta ±1 % Spot; Theta = 1-Tages-Constant-Curve-Roll (Zero-Sätze je Laufzeit konstant, Vol-Flächen sticky expiry) plus in (t, t+1] gezahlte Cashflows, zerlegt in Carry (Forward-Roll) und Roll-Down.",
    );
  }
  if (xva)
    lines.push(
      `Kontrahentenrisiko: ${xva.method}; CVA = LGD · Σ EPE · ΔPD, DVA analog auf dem negativen Exposure; Fair Value = risikofreier Barwert − CVA + DVA.`,
    );
  return lines;
}

/**
 * Methodology text of the report, generated from the switches that actually
 * drove the valuation (curves and their interpolation/extrapolation, fixing
 * policy, RFR conventions, embedded options, model / vol source / Greeks
 * method per instrument, spot lag, XVA method, IFRS 13 heuristic, cost sign
 * rule). Without `ctx`/`pricing` a static per-type description is returned
 * (backward compatible).
 */
const VALUATION_FRAMEWORK_LINE =
  "Bewertungsrahmen: IFRS 13 / IDW RS HFA 35 – Bewertungstechnik „Income Approach“ (Barwertmethode: diskontierte erwartete Zahlungsströme bzw. Optionspreismodelle), Inputs der Stufe 2 der Bewertungshierarchie (beobachtbare Kurven, Volatilitäten, FX-Spots); Modellannahmen, Marktdatenquellen und Freigabestatus sind im Abschnitt „governance“ dokumentiert (Modellvalidierung/-freigabe nach MaRisk AT 4.3.x, BTO 2.2.1).";

function governanceLine(g: ValuationGovernance): string {
  return `Bewertungs-Governance: Snapshot-Status „${g.snapshotStatus === "approved" ? "freigegeben" : "indikativ"}“${g.validatedBy ? ` (validiert durch ${g.validatedBy})` : ""}, Marktdatenquellen: ${g.inputSources.join(", ") || "n/a"}; Modellversion ${g.modelVersion}.${g.snapshotStatus === "indicative" ? " Indikative Marktdaten sind nicht unabhängig validiert – keine prüfungsfähige Bewertung." : ""}`;
}

export function methodologyFor(
  trade: Trade,
  ctx?: MarketContext,
  pricing?: PricingResult,
  opts: { risk?: RiskReport; xva?: XvaResult; perspective?: ReportPerspective; governance?: ValuationGovernance } = {},
): string[] {
  if (!ctx || !pricing) return [VALUATION_FRAMEWORK_LINE, ...staticMethodology(trade)];
  const lines = [
    VALUATION_FRAMEWORK_LINE,
    ...curveLines(ctx, trade),
    ...conventionLines(trade),
    ...fixingLines(ctx, trade, pricing),
    ...instrumentLines(ctx, trade, pricing),
    ...riskLines(opts.risk, opts.xva),
  ];
  if (opts.governance) lines.push(governanceLine(opts.governance));
  lines.push(
    "IFRS-13-Einstufung (Heuristik): Level 2 bei beobachtbaren Kurven/Volatilitäten; Level 3, wenn die Fälligkeit mehr als 30 Tage über den letzten Pillar einer tatsächlich genutzten Kurve (Diskontkurve unter dem CSA des Geschäfts, Projektionskurven der referenzierten Indizes) hinausgeht, eine Optionslaufzeit/ein Tenor jenseits des Gitters der genutzten Volatilitätsfläche liegt, eine Volatilitätsfläche fehlt oder ein manueller Vol-Override verwendet wird.",
  );
  if (opts.perspective) lines.push(`Kostentransparenz (MiFID II ex-ante, BGH XI ZR 33/10): ${costSignRule(opts.perspective)}`);
  return lines;
}

function staticMethodology(trade: Trade): string[] {
  const common = [
    "Multi-Curve-Framework: Diskontierung mit OIS-Kurve (€STR/SOFR/SONIA/SARON), Projektion der Forwards mit indexspezifischer Kurve (EURIBOR-3M/-6M).",
    "Kurven per sequentiellem Bootstrapping aus Depos/FRAs/Futures/Swaps bzw. OIS-Swaps; Interpolation log-linear in Diskontfaktoren, Extrapolation flat-forward.",
    "Tageszählung, Geschäftstagekonvention und Kalender gemäß ISDA-Definitionen (TARGET2, US, UK, CH, JP).",
  ];
  switch (trade.type) {
    case "InterestRateSwap":
      return [...common, "Barwert = Summe diskontierter fixer und projizierter variabler Cashflows; Par-Satz und fairer Spread analytisch aus Annuität."];
    case "CrossCurrencySwap":
      return [...common, "Cross-Currency-Swap mit Nominalaustausch; MtM-Reset über Forward-FX aus Diskontkurven; Umrechnung in Reporting-Währung zum Spot."];
    case "FRA":
      return [...common, "FRA mit Settlement am Startdatum und Abdiskontierung über die FRA-Periode (ISDA)."];
    case "CapFloor":
      return [
        ...common,
        "Caplets/Floorlets mit Bachelier-Modell (Normal-Vol) bzw. (shifted) Black-76 auf den Forward; Volatilität aus Caplet-Fläche per Expiry/Strike.",
      ];
    case "Swaption":
      return [
        ...common,
        "Europäische Swaption mit Bachelier bzw. (shifted) Black-76 auf den Forward-Swapsatz; ATM-Vol-Cube mit SABR-Smile am Strike; physische Annuität bzw. Cash-Settlement-Annuität.",
      ];
    case "FxForward":
    case "FxSwap":
      return [
        ...common,
        "FX-Forward über Zinsparität mit Spot-Date-Anker (T+2, T+1 für z. B. USDCAD): F = S · [DF_Basis(T)/DF_Basis(t_s)] / [DF_Quote(T)/DF_Quote(t_s)]; Barwert = diskontierte Zahlungsströme beider Währungen, umgerechnet zum auf den Bewertungstag angepassten Spot.",
      ];
    case "FxOption":
      return [
        ...common,
        "Garman-Kohlhagen für europäische FX-Optionen; Smile aus ATM/RR/BF-Quotes im Delta-Raum; Barrieren nach Reiner-Rubinstein, Digitals analytisch; Greeks der Exoten per finiten Differenzen.",
      ];
  }
}

/** Compact cashflow table suitable for CSV/Excel export. */
export function cashflowTable(pricing: PricingResult): string[][] {
  const rows: string[][] = [["Leg", "Typ", "Ccy", "Fixing", "Start", "Ende", "Zahlung", "Nominal", "Satz", "Tagefaktor", "Betrag", "DF", "Barwert", "Art"]];
  for (const leg of pricing.legs) {
    for (const cf of leg.cashflows) {
      rows.push([
        String(cf.legIndex),
        leg.legType,
        cf.currency,
        cf.fixingDate ? toISO(cf.fixingDate) : "",
        cf.accrualStart ? toISO(cf.accrualStart) : "",
        cf.accrualEnd ? toISO(cf.accrualEnd) : "",
        toISO(cf.paymentDate),
        cf.notional.toFixed(2),
        cf.rate !== undefined ? (cf.rate * 100).toFixed(5) + "%" : "",
        cf.accrualFactor !== undefined ? cf.accrualFactor.toFixed(6) : "",
        cf.amount.toFixed(2),
        cf.discountFactor.toFixed(8),
        cf.presentValue.toFixed(2),
        cf.kind,
      ]);
    }
  }
  return rows;
}

export interface CsvOptions {
  /** Field separator (";" is the Excel default in German locales). */
  sep?: string;
  /** Render numeric cells with a decimal comma (German Excel). */
  decimalComma?: boolean;
  /** Prepend a UTF-8 byte-order mark so Excel detects the encoding. */
  bom?: boolean;
}

const NUMERIC = /^-?\d+(\.\d+)?(%)?$/;
/** Leading characters Excel/LibreOffice interpret as a formula (CSV injection). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * One CSV cell: numeric cells optionally get a decimal comma; non-numeric
 * cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with an
 * apostrophe so spreadsheets treat them as text (formula-injection guard,
 * N-13); cells containing the separator, quotes or newlines are quoted.
 */
export function csvCell(c: string, sep: string, decimalComma: boolean): string {
  let v = c;
  const numeric = NUMERIC.test(v.replace(/\s?%$/, ""));
  if (!numeric && FORMULA_PREFIX.test(v)) v = `'${v}`;
  if (decimalComma && numeric) v = v.replace(".", ",");
  return v.includes(sep) || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][], opts: CsvOptions | string = {}): string {
  const o: CsvOptions = typeof opts === "string" ? { sep: opts } : opts;
  const sep = o.sep ?? ";";
  const body = rows.map((r) => r.map((c) => csvCell(c, sep, o.decimalComma ?? false)).join(sep)).join("\n");
  return (o.bom ? "\ufeff" : "") + body;
}
