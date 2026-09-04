import { type InterpolatedCurve, curveSource } from "../curves/curve.js";
import { getIndex } from "../curves/index-definitions.js";
import { QUANTLIB_CROSS_CHECKED_CALENDARS } from "../dates/calendar.js";
import { parseISO, toISO } from "../dates/date.js";
import { yearFraction } from "../dates/daycount.js";
import { frequencyPerYear } from "../dates/schedule.js";
import { formatDateDe, formatDe, formatPctDe } from "../format.js";
import {
  barrierTypeLabelDe,
  bdcLabelDe,
  cashSettlementLabelDe,
  fxAtmConventionLabelDe,
  fxDeltaConventionLabelDe,
  irModelLabelDe,
  stubLabelDe,
  volTypeLabelDe,
  xvaMethodLabelDe,
} from "../instruments/labels.js";
import { embeddedOptionLegs, tradeMaturityDate } from "../instruments/trade-dates.js";
import { type FloatLeg, type PricingResult, type SwapLeg, type Trade } from "../instruments/types.js";
import { type MarketContext, getDiscountCurve, hasCollateralCurve, normalizeFxPair } from "../market/market-context.js";
import { fxSpotLag } from "../market/fx-spot.js";
import { serializeCurve } from "../market/snapshot.js";
import { isNonLocalInterpolation } from "../math/interpolation.js";
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
   * Valuation governance (IDW RS HFA 47 for the fair-value measurement,
   * MaRisk AT 4.3.5 for the use of models): status of the market snapshot,
   * data sources and the model version used, plus the validator when the
   * snapshot has been approved.
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
      reasons.push(
        `${what} ${formatDe(value, 2)}Y über letztem Gitterpunkt (${formatDe(last, last % 1 === 0 ? 0 : 2)}Y) der Volatilitätsfläche ${surfaceId} hinaus (Extrapolation)`,
      );
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
 * Model-dependent but observable-input situations (barrier without smile
 * correction, a surface vol converted into the requested model's quotation,
 * R3-1) stay Level 2 and are listed as hints in the rationale.
 */
export function ifrs13Level(ctx: MarketContext, trade: Trade, pricing: PricingResult): { level: 1 | 2 | 3; rationale: string } {
  const reasons: string[] = [];
  const hints: string[] = [];
  const maturity = tradeMaturityDate(trade);
  for (const id of tradeCurveIds(ctx, trade)) {
    const c = ctx.curves[id]!;
    const last = c.nodeDates[c.nodeDates.length - 1];
    if (last !== undefined && maturity > last + EXTRAPOLATION_TOLERANCE_DAYS) {
      reasons.push(`Fälligkeit ${formatDateDe(maturity)} über letzten Pillar (${formatDateDe(last)}) der genutzten Kurve ${c.id} hinaus (Extrapolation)`);
    }
  }
  reasons.push(...volSurfaceExtrapolation(ctx, trade, pricing));
  const hasOverride = "volOverride" in trade && (trade as { volOverride?: number }).volOverride !== undefined;
  if (hasOverride) reasons.push("manuelle Volatilitätsvorgabe statt beobachtbarer Fläche");
  if (pricing.warnings.some((w) => /No .*vol surface/i.test(w))) reasons.push("keine Volatilitätsfläche vorhanden, Rückfall-Volatilität verwendet");
  if (trade.type === "FxOption" && trade.barrier)
    hints.push("Barriere-Option: Modellabhängigkeit (Reiner-Rubinstein ohne Smile-Korrektur) – als Level 2 mit Hinweis eingestuft");
  if (pricing.warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED"))) {
    const model = irModelLabelDe(String(pricing.analytics.model ?? "Bachelier"));
    hints.push(
      `Volatilitätstyp der beobachtbaren Fläche weicht vom gewählten Modell ${model} ab – Volatilitäten per Preisäquivalenz je Forward/Strike/Laufzeit konvertiert (beobachtbare Inputs, Level 2 mit Hinweis)`,
    );
  }
  if (pricing.warnings.some((w) => w.startsWith("COLLATERAL_CURVE_MISSING"))) {
    hints.push(
      `Besicherung in ${trade.collateralCurrency ?? "?"} ohne Collateral-Kurve im Marktkontext – Diskontierung auf der Standard-OIS-Kurve der Währung (Cross-Currency-Basis nicht gepreist; beobachtbare Inputs, Level 2 mit Hinweis)`,
    );
  }
  if (pricing.warnings.some((w) => w.startsWith("MISSING_FX_FIXING"))) {
    // N6-3: the same warning prefix is raised by the MtM-reset CCS (R4-1) and by expired FX options (N5-2) – say which.
    hints.push(
      trade.type === "FxOption"
        ? `Verfallene FX-Option ohne FX-Fixing des Verfalltags ${formatDateDe(trade.expiryDate)} – Ausübungs-${trade.barrier ? " und Barrier-" : ""}Entscheid auf dem heutigen Spot als Näherung (Fixing nachladen)`
        : "MtM-Reset ohne FX-Fixing für einen vergangenen Reset-Termin – heutiger Kurs als Näherung (Fixing nachladen)",
    );
  }
  if (pricing.warnings.some((w) => w.startsWith("BARRIER_STATE_UNKNOWN"))) {
    hints.push(
      "Knock-Zustand der Barrier nicht bestätigt (aus heutigem Spot bzw. Verfall-Fixing abgeleitet, Warnung BARRIER_STATE_UNKNOWN) – barrier.hit am Geschäft setzen",
    );
  }
  if (reasons.length) {
    return {
      level: 3,
      rationale: `Wesentliche nicht beobachtbare Inputs: ${reasons.join("; ")} → Level 3.${hints.length ? ` Hinweis: ${hints.join("; ")}.` : ""}`,
    };
  }
  return {
    level: 2,
    rationale:
      "Bewertung mit beobachtbaren Marktdaten (OIS-/Swapkurven, Volatilitäten, FX-Spots) und marktüblichen Modellen; keine wesentlichen nicht beobachtbaren Inputs → Level 2." +
      (hints.length ? ` Hinweis: ${hints.join("; ")}.` : ""),
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

export interface MarketSnapshotIdOptions {
  /**
   * "full" (default): every market input – valuation date, curves (sorted by
   * id; base nodes, forward jumps, interpolation, extrapolation, day count),
   * discount / collateral curve mappings, FX spots and explicit spot dates,
   * fixings (sorted), swaption / caplet / FX vol surfaces including their
   * conventions, credit data and the snapshot label. "curves": the legacy
   * curve-only hash (valuation date, curve node discount factors, FX spots)
   * for consumers that want to label a curve set independently of vols.
   */
  scope?: "full" | "curves";
}

/**
 * Deterministic id of a market snapshot (FNV-1a over the canonical, key-sorted
 * JSON of all market inputs, R3-2). Order-independent: the same snapshot with
 * curves inserted in a different order, fixings in a different order or FX
 * spots in a different key order yields the same id; a +1 bp vol bump, an
 * added fixing, a changed hazard rate, a different CSA mapping or an explicit
 * spot date changes it. Identical to `report.audit.snapshotId`, so API and
 * UI can label results without building a report (`X-Market-Snapshot-Id`).
 */
export function marketSnapshotId(ctx: MarketContext, opts: MarketSnapshotIdOptions = {}): string {
  if (opts.scope === "curves") {
    return hashString(
      stableStringify({
        valuationDate: ctx.valuationDate,
        curves: Object.values(ctx.curves)
          .map((c) => ({ id: c.id, nodes: c.nodeDates.map((d) => [d, c.df(d)]) }))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        fx: ctx.fxSpots,
      }),
    );
  }
  const curves = Object.values(ctx.curves)
    .map((c) => {
      // Provenance (`meta.source`, `meta.index`) is not a market input; the numbers and conventions are.
      const { meta: _meta, ...rest } = serializeCurve(c);
      return rest;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fixings = (ctx.fixings ?? [])
    .map((f) => ({ index: f.index.toUpperCase(), date: f.date, value: f.value }))
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.date - b.date));
  // FX fixings (R4-1) enter the id only when present, so snapshots without them keep their ids.
  const fxFixings = ctx.fxFixings?.length
    ? ctx.fxFixings
        .map((f) => ({ pair: normalizeFxPair(f.pair), date: f.date, rate: f.rate }))
        .sort((a, b) => (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : a.date - b.date))
    : undefined;
  return hashString(
    stableStringify({
      schema: "deriva.market/1",
      valuationDate: ctx.valuationDate,
      label: ctx.meta?.label,
      discountCurveId: ctx.discountCurveId,
      collateralDiscountCurveId: ctx.collateralDiscountCurveId,
      curves,
      fxSpots: ctx.fxSpots,
      fxSpotDates: ctx.fxSpotDates,
      fixings,
      fxFixings,
      swaptionVols: ctx.swaptionVols,
      capletVols: ctx.capletVols,
      fxVols: ctx.fxVols,
      credit: ctx.credit,
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
    `Perspektive ${perspective}: Fair Value (Barwert) und Transaktionspreis sind aus Sicht ${who} angegeben (Transaktionspreis > 0 = ${who === "der Bank" ? "die Bank zahlt" : "der Kunde zahlt"} bei Abschluss). ` +
    `Marge der Bank = ${perspective === "Bank" ? "Fair Value − Transaktionspreis" : "Transaktionspreis − Fair Value"}; anfänglicher Marktwert aus Kundensicht = −Marge der Bank (negativ, wenn der Kunde eine Marge trägt). Die Marge wird zusätzlich in Basispunkten und in Prozent des Nominals ausgewiesen.`
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
  // reporting currency, the fixing policy and the cost-transparency inputs (transaction price,
  // perspective, notional, what-if). The market itself is covered by the snapshot id (R3-2).
  const inputsHash = hashString(
    stableStringify({
      trade,
      snapshotId,
      reportingCurrency: pricing.currency,
      missingFixingPolicy: ctx.missingFixingPolicy ?? "curve",
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

/** ISO spot date of `pricing.details` → TT.MM.JJJJ for the methodology text. */
function spotDateDe(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDateDe(parseISO(iso)) : iso;
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
  // Markt R4-1: a CSA is only a CSA curve when the market has one for the currency; otherwise say so.
  const csa = trade.collateralCurrency;
  const withoutCsaCurve = csa ? [...ccys].filter((c) => !hasCollateralCurve(ctx, c, csa)) : [];
  const csaText = !csa
    ? "OIS-Kurve (unbesichert / Standard-Diskontkurve)"
    : withoutCsaCurve.length === 0
      ? `CSA-Kurve (Besicherung in ${csa})`
      : `Standard-Diskontkurve – Besicherung in ${csa} vereinbart, aber für ${withoutCsaCurve.join(", ")} keine Collateral-Kurve im Marktkontext (COLLATERAL_CURVE_MISSING: Diskontierung auf der eigenen OIS-Kurve, Cross-Currency-Basis nicht gepreist)`;
  lines.push(
    `Multi-Curve-Framework: Diskontierung je Währung mit der ${csaText} – ${discount.join(", ")}` +
      (projection.length ? `; Projektion der Forwards mit indexspezifischen Kurven – ${projection.join(", ")}.` : "."),
  );
  for (const id of tradeCurveIds(ctx, trade)) {
    const curve = ctx.curves[id]!;
    const c = curve as Partial<InterpolatedCurve>;
    const last = c.nodeDates?.[c.nodeDates.length - 1];
    const interp = c.interpolation ? (INTERPOLATION_LABELS[c.interpolation] ?? "n/a") : "n/a";
    const extra = c.extrapolation ? (EXTRAPOLATION_LABELS[c.extrapolation] ?? "n/a") : "n/a";
    // Construction text from the curve's provenance (R3-7): only bootstrapped curves were bootstrapped.
    const source = curveSource(curve);
    const construction =
      source === "bootstrap"
        ? "sequentielles Bootstrapping (Brent je Pillar) aus Marktquotes"
        : source === "flat"
          ? "flache Kurve (konstanter Zero-Satz, Test-/What-if-Kurve)"
          : "importierte Kurve (Pillars aus Snapshot, kein Bootstrapping im Bewertungskern)";
    const nonLocal = c.interpolation && isNonLocalInterpolation(c.interpolation);
    lines.push(
      `Kurve ${id}: ${construction}, Interpolation ${interp}, Extrapolation jenseits des letzten Pillars${last !== undefined ? ` (${formatDateDe(last)})` : ""}: ${extra}; am kurzen Ende erster Forward.` +
        (nonLocal
          ? " Hinweis: Unter nicht-lokaler Interpolation sind die Zero-Buckets je Pillar nicht exakt additiv zum parallelen DV01 (Positivitätsschranken, nicht-lokale Sensitivität); für Hedge-Zwecke das Par-Risiko je Marktquote verwenden."
          : ""),
    );
  }
  return lines;
}

/**
 * Calendar clause of the convention sentence (N8-5): names exactly the
 * calendars whose holidays are cross-checked against QuantLib in the golden
 * test (`QUANTLIB_CROSS_CHECKED_CALENDARS`) – "TARGET2/US/UK/CH/JP/NO/SE/DK/PL"
 * plus the SOFR fixing calendar; `DE` is not listed because it is not checked.
 */
function checkedCalendarClause(): string {
  const label = (id: string) => (id === "TARGET" ? "TARGET2" : id);
  const main = QUANTLIB_CROSS_CHECKED_CALENDARS.filter((id) => id !== "US-SIFMA").map(label);
  const sofr = QUANTLIB_CROSS_CHECKED_CALENDARS.includes("US-SIFMA") ? " sowie SOFR-Fixingkalender US-SIFMA" : "";
  return `regelbasierte Kalender ${main.join("/")}${sofr}, gegen QuantLib abgeglichen (Werktagsfeiertage 2024–2032, Golden-Test), in Produktion durch Feiertagsfeeds überschreibbar`;
}

function conventionLines(trade: Trade): string[] {
  const legs = legsOf(trade);
  if (legs.length === 0) return [`Tageszählung, Geschäftstagekonvention und Kalender gemäß ISDA-Definitionen (${checkedCalendarClause()}).`];
  const parts = legs.map((l, i) => {
    const kind =
      l.type === "Fixed" ? `Fix ${pct(l.rate)}` : `Float ${l.index}${l.spread ? ` ${l.spread >= 0 ? "+" : ""}${formatDe(l.spread * 1e4, 1)} bp` : ""}`;
    return `Leg ${i + 1} (${l.payReceive === "Receive" ? "Empfang" : "Zahlung"}, ${kind}): ${l.frequency}, ${l.dayCount}, ${bdcLabelDe(l.businessDayConvention)}, Kalender ${l.calendar}, ${stubLabelDe(l.stub)}${l.endOfMonth ? ", EOM-Roll" : ""}${l.roll === "IMM" ? ", IMM-Roll" : ""}${l.paymentLag ? `, Zahlungsverzug ${l.paymentLag} GT` : ""}`;
  });
  return [`Konventionen gemäß ISDA-Definitionen (${checkedCalendarClause()}): ${parts.join("; ")}.`];
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
  if (trade.type === "CrossCurrencySwap" && trade.mtmReset) {
    const missingFx = pricing.warnings.filter((w) => w.startsWith("MISSING_FX_FIXING:")).length;
    lines.push(
      `FX-Fixings (MtM-Reset): ${ctx.fxFixings?.length ?? 0} historische FX-Fixings geladen; für Reset-Termine bis zum Bewertungstag wird das FX-Fixing des Reset-Termins verwendet, für die erste Periode ohne Fixing das kontraktuelle Nominal; fehlende Fixings ${policy === "throw" ? "führen zum Abbruch der Bewertung (Policy „throw“)" : "werden mit dem heutigen Kurs genähert und als MISSING_FX_FIXING gemeldet (Policy „curve“)"}; in dieser Bewertung ${missingFx === 0 ? "kein fehlendes FX-Fixing" : `${missingFx} fehlende(s) FX-Fixing(s)`}.`,
    );
  }
  for (const l of floats) {
    let idxType: "IBOR" | "OIS" | undefined;
    try {
      idxType = getIndex(l.index).type;
    } catch {
      idxType = undefined;
    }
    if (idxType === "OIS") {
      lines.push(
        `RFR-Leg ${l.index}: ${(l.compounding ?? "Compound") === "Compound" ? "Compounding" : "arithmetisches Averaging"} in arrears der täglichen Fixings${l.lockoutDays ? ` (Fixingkalender ${getIndex(l.index).fixingCalendar}), Lockout ${l.lockoutDays} Geschäftstage (die letzten ${l.lockoutDays} Geschäftstage tragen das Fixing des Geschäftstags vor dem Lockout-Fenster, ISDA 2021 / QuantLib-Zählung)` : `, Lookback ${l.lookbackDays ?? 0} Geschäftstage${l.lookbackDays ? (l.observationShift ? " mit Observation Shift (Gewichte aus der Beobachtungsperiode)" : " ohne Observation Shift (Gewichte aus der Zinsperiode)") : ""}`}, realisierter Teil bis zum Bewertungstag aus Fixings, Rest aus der Kurve; Accrued = realisiertes Compounding.`,
      );
    }
    if (l.capRate !== undefined || l.floorRate !== undefined) {
      const parts: string[] = [];
      if (l.capRate !== undefined) parts.push(`Cap ${pct(l.capRate, 2)}`);
      if (l.floorRate !== undefined) parts.push(`Floor ${pct(l.floorRate, 2)}`);
      const key = capletSurfaceKeysFor(ctx, trade).find((k) => k.startsWith(l.currency));
      const s = key ? ctx.capletVols?.[key] : undefined;
      lines.push(
        `Eingebettete Option auf Leg ${l.index} (${parts.join(", ")}): erwarteter Kupon E[min(max(L, Floor), Cap)] = L + Floorlet − Caplet, bewertet ${s ? `mit ${s.volType === "Normal" ? "Bachelier" : "Black-76" + (s.shift ? ` (Shift ${pct(s.shift, 2)})` : "")} auf der Caplet-Fläche ${s.id} (Vol je Laufzeit/Strike)` : "intrinsisch (keine Caplet-Fläche im Marktkontext)"}; fixierte Perioden intrinsisch. Vega und Vega-Buckets werden über die Caplet-Fläche ausgewiesen.`,
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
        `Barwert = Summe diskontierter fixer und projizierter variabler Cashflows; Par-Satz und fairer Spread analytisch aus der Annuität der ökonomischen Legs – eine Upfront-Prämie ist ausgenommen, die All-in-Sicht inkl. Prämie steht als „Par-Satz all-in“ bzw. „fairer Spread all-in“ in den Kennzahlen${typeof a.parRateAllIn === "number" ? ` (hier ${pct(a.parRateAllIn, 4)})` : typeof a.fairSpreadAllIn === "number" ? ` (hier ${pct(a.fairSpreadAllIn, 4)})` : ""}; Umrechnung in die Reporting-Währung zum auf den Bewertungstag angepassten Spot.`,
      ];
    case "CrossCurrencySwap":
      return [
        `Cross-Currency-Swap mit Nominalaustausch${a.mtmReset === "yes" ? " und MtM-Reset: Nominal des resettenden Legs je Periode = Gegen-Nominal × FX-Kurs am Reset-Termin (adjustierter Periodenbeginn) – historisches FX-Fixing für Reset-Termine bis zum Bewertungstag, Spot-Date-verankerter Forward-FX-Kurs für zukünftige Termine; Nominaldifferenzen werden am Periodenende ausgetauscht" : ""}; jede Seite auf ihrer Diskontkurve; Umrechnung in die Reporting-Währung zum auf den Bewertungstag angepassten Spot.`,
      ];
    case "FRA":
      return [
        `FRA mit Settlement am Startdatum und Abdiskontierung über die FRA-Periode (ISDA); Fixing ${a.isFixed === "yes" ? "aus Marktkontext" : "aus Kurven-Forward"}.`,
      ];
    case "CapFloor": {
      const model = String(a.model ?? "Bachelier");
      const key = capletSurfaceKeysFor(ctx, trade)[0];
      const s = key ? ctx.capletVols?.[key] : undefined;
      const converted = pricing.warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED"));
      const volUnit = model === "Bachelier" ? "bp Normal-Vol" : "Vol-Punkt (lognormal)";
      const volSrc =
        trade.volOverride !== undefined
          ? `flache Volatilitätsvorgabe ${model === "Bachelier" ? `${formatDe(trade.volOverride * 1e4, 2)} bp` : pct(trade.volOverride, 2)}`
          : s
            ? `Caplet-Fläche ${s.id} (${volTypeLabelDe(s.volType)}, bilinear in Laufzeit/Strike)${converted ? `; Volatilitätstyp der Fläche ≠ Modell – Vols je Caplet per Preisäquivalenz in ${model === "Bachelier" ? "Normal-Vol" : "Lognormal-Vol"} konvertiert` : ""}`
            : `Rückfall-Volatilität 60 bp Normal-Vol (keine Fläche)${converted ? ", per Preisäquivalenz in die Modell-Quotierung konvertiert" : ""}`;
      return [
        `Caplets/Floorlets als Strip auf den Index-Forward, Modell ${irModelLabelDe(model)}${model === "ShiftedBlack" ? ` (Shift ${pct(trade.shift ?? s?.shift ?? 0, 2)})` : ""}; Volatilität: ${volSrc}; Caplet-Laufzeit bis zum Fixingtermin, Zahlung nachschüssig; fixierte Caplets intrinsisch. Greeks analytisch (Delta/Gamma je bp, Vega je ${volUnit}).`,
      ];
    }
    case "Swaption": {
      const model = String(a.model ?? "Bachelier");
      const ccy = trade.underlying.legs[0]?.currency ?? "";
      const s = ctx.swaptionVols?.[ccy];
      const converted = pricing.warnings.some((w) => w.startsWith("VOL_TYPE_CONVERTED"));
      const fmtVol = (v: number) => (model === "Bachelier" ? `${formatDe(v * 1e4, 2)} bp` : pct(v, 2));
      const volSrc =
        trade.volOverride !== undefined
          ? `flache Volatilitätsvorgabe ${fmtVol(trade.volOverride)}`
          : s
            ? `ATM-Cube ${s.id} (${volTypeLabelDe(s.volType)}, bilinear in Laufzeit/Tenor)${s.sabr ? `, Smile am Strike per SABR (Hagan) mit Alpha-Rekalibrierung auf ATM, Parameter zwischen Gitterpunkten geblendet` : ", ohne Smile (ATM-Vol am Strike)"}${converted ? `; Volatilitätstyp der Fläche ≠ Modell – Smile-Vol per Preisäquivalenz in ${model === "Bachelier" ? "Normal-Vol" : "Lognormal-Vol"} konvertiert` : ""}`
            : `Rückfall-Volatilität 70 bp Normal-Vol (keine Fläche)${converted ? ", per Preisäquivalenz in die Modell-Quotierung konvertiert" : ""}`;
      const vol = typeof a.volatility === "number" ? ` – verwendete Vol ${fmtVol(a.volatility)}` : "";
      const settlement =
        trade.settlement === "Cash"
          ? `Cash-Settlement nach ${cashSettlementLabelDe(trade.cashSettlementConvention)} (${(trade.cashSettlementConvention ?? "CollateralisedCashPrice") === "IRR" ? "Cash-Annuität aus der Yield-Formel, auf das Settlement-Datum diskontiert" : "Diskont-Annuität"})`
          : "physische Lieferung (Diskont-Annuität)";
      return [
        `Europäische Swaption, Modell ${irModelLabelDe(model)}${model === "ShiftedBlack" ? ` (Shift ${pct(trade.shift ?? s?.shift ?? 0, 2)})` : ""} auf den Forward-Swapsatz; ${settlement}; Volatilität: ${volSrc}${vol}. Greeks analytisch (Annuitäts-gewichtet).`,
      ];
    }
    case "FxForward":
    case "FxSwap": {
      const b = trade.type === "FxForward" ? trade.buyCurrency : trade.nearLeg.buyCurrency;
      const q = trade.type === "FxForward" ? trade.sellCurrency : trade.nearLeg.sellCurrency;
      const lag = fxSpotLag(b, q);
      return [
        `FX-Forward über Zinsparität mit Spot-Date-Anker (${b}${q}: T+${lag} auf dem Paar-Kalender${b !== "USD" && q !== "USD" ? " inkl. USD" : ""}${pricing.details?.spotDate ? `, Spot-Date ${spotDateDe(pricing.details.spotDate)}` : ""}): F = S · [DF_Basis(T)/DF_Basis(t_s)] / [DF_Quote(T)/DF_Quote(t_s)]; Barwert = diskontierte Zahlungsströme beider Währungen, umgerechnet zum auf den Bewertungstag angepassten Spot S·DF_Quote(t_s)/DF_Basis(t_s). Settlement-Konvention: ein Leg mit Lieferung am Bewertungstag (Value Today) geht undiskontiert zum Heute-Kurs in den Barwert ein (fairer Kurs = Heute-Kurs, Warnung SETTLES_TODAY); vor dem Bewertungstag gelieferte Legs sind ausgeschlossen.`,
        `FX-Delta-Betrag: Barwertänderung in der Reporting-Währung bei +1 % Spot der Kaufwährung ${b} gegen ${q} (linear: ±Barwert des Legs in der bewegten Währung × 1 %); eine Delta-Quote wird für lineare FX-Geschäfte nicht ausgewiesen (Delta ±1).`,
      ];
    }
    case "FxOption": {
      const { base, quote } = splitPair(trade.pair);
      const s = ctx.fxVols?.[`${base}${quote}`] ?? ctx.fxVols?.[`${quote}${base}`];
      const lag = fxSpotLag(base, quote);
      const kind = trade.barrier
        ? `Barriere-Option ${barrierTypeLabelDe(trade.barrier.type)}`
        : trade.digital
          ? `Digital-Option (${/asset/i.test(String(a.kind)) ? "Asset-or-Nothing, Auszahlung in der Basiswährung" : "Cash-or-Nothing"})`
          : "Vanilla-Option";
      const greeks =
        a.greeksMethod === "finite-difference"
          ? "Greeks per zentralen finiten Differenzen der geschlossenen Formel (Spot-Schritt ≤ ½ Barrierabstand)"
          : "Greeks analytisch (Garman-Kohlhagen)";
      const smile =
        trade.volOverride !== undefined
          ? `flache Volatilitätsvorgabe ${pct(trade.volOverride, 2)}`
          : s
            ? `Smile aus ATM/RR/BF-Quotes der Fläche ${s.id} (ATM ${fxAtmConventionLabelDe(s.atmConvention)}, Delta-Konvention ${fxDeltaConventionLabelDe(s.deltaConvention)}, Butterfly als ${(s.strangleType ?? "Smile") === "Broker" ? "Broker-Strangle (Reiswich-Wystup-Iteration)" : "Smile-Strangle"}, Interpolation ${(s.smileInterpolation ?? "linear") === "cubic" ? "monoton-kubisch" : "linear"} im Delta-Raum, flache Extrapolation jenseits der äußeren Pillars, Fixpunkt Strike↔Delta)`
            : "Rückfall-Volatilität 8 % (keine Fläche)";
      const vol = typeof a.volatility === "number" ? `, verwendete Vol ${pct(a.volatility, 3)}` : "";
      const rebateNote = trade.barrier?.rebate
        ? trade.barrier.rebateAt === "expiry"
          ? "; Knock-out-Rebate am Verfall (Konvention „expiry“: lebend Rebate·DF·P(Berührung), entschieden Rebate·DF(Lieferung) – eine Konvention, stetig an der Barrier)"
          : trade.barrier.rebateAt === "hit"
            ? "; Knock-out-Rebate bei Berührung (Konvention „hit“: lebend Reiner-Rubinstein-Term F, Spot jenseits der Barrier = Berührung heute value-today, bestätigte Berührung = bereits gezahlt)"
            : "; Knock-out-Rebate bei Berührung (Default-Konvention „hit“ = QuantLib, am Geschäft nicht festgelegt: lebend Reiner-Rubinstein-Term F, Spot jenseits der Barrier = Berührung heute value-today, bestätigte Berührung = bereits gezahlt; für eine Zahlung am Verfall die Rebate-Konvention „expiry“ am Geschäft festlegen)"
        : "";
      const barrierNote = trade.barrier
        ? ` / Reiner-Rubinstein (Single-Barrier: Auszahlung auf das Lieferdatum diskontiert und gegen den Lieferdatums-Forward gestellt, Diffusion und Barrier-Drift auf dem Horizont bis zur Ausübung${a.deliveryConvention === "non-standard" ? "; Lieferdatum weicht vom Spot-Datum der Ausübung ab – Drift und Rebate-Diskontierung aus den Kurven bis zum Standard-Lieferdatum, nur Auszahlungsdiskont und Forward auf das tatsächliche Lieferdatum" : ""}${rebateNote})`
        : trade.digital
          ? " (Digital analytisch, Cash- bzw. Asset-or-Nothing)"
          : "";
      const lifecycle = String(a.lifecycle ?? "alive");
      const lifecycleLine =
        lifecycle === "delivered"
          ? `Lebenszyklus: Option bereits abgewickelt (Lieferung ${formatDateDe(trade.deliveryDate)} vor dem Bewertungstag) – Barwert 0, keine Sensitivitäten, im EMIR-Bewertungsexport mit Wert 0 und Delta 0.`
          : lifecycle === "alive"
            ? undefined
            : `Lebenszyklus: ${lifecycle === "expires-today" ? "Ausübungstag = Bewertungstag" : `Option am ${formatDateDe(trade.expiryDate)} verfallen, Abwicklung am ${formatDateDe(trade.deliveryDate)} noch offen`} – Ausübungs- bzw. Barrier-Entscheid am FX-Fixing des Verfalltags (${pricing.warnings.some((w) => w.startsWith("MISSING_FX_FIXING")) ? "kein Fixing geladen: heutiger Spot als Näherung, Warnung MISSING_FX_FIXING" : "geladenes Fixing bzw. heutiger Kurs"})${trade.barrier ? (trade.barrier.hit !== undefined ? `; Knock-Zustand laut Geschäft (barrier.hit = ${trade.barrier.hit ? "berührt" : "nicht berührt"})` : "; Knock-Zustand nur aus dem Verfall-Fixing abgeleitet, Touch-Ereignisse vor dem Verfall nicht beobachtet (Warnung BARRIER_STATE_UNKNOWN)") : ""}; ausgeübte Option = Terminposition zum Strike mit Lieferung am Abwicklungstag (physische Lieferung), Digital = fester Auszahlungsbetrag, ausgeknockte Knock-out- bzw. nie berührte Knock-in-Barrier = Rebate (auf das Lieferdatum diskontiert); keine Vega-, Gamma- oder Theta-Sensitivität mehr, Delta der Terminposition${lifecycle === "settles-today" ? "; Abwicklung am Bewertungstag als Value-Today-Austausch undiskontiert (SETTLES_TODAY)" : ""}.`;
      return [
        `${kind}: Garman-Kohlhagen${barrierNote}; Forward am Spot-Datum verankert (${base}${quote}: T+${lag} auf dem Paar-Kalender${base !== "USD" && quote !== "USD" ? " inkl. USD" : ""}${pricing.details?.spotDate ? `, Spot-Datum ${spotDateDe(pricing.details.spotDate)}` : ""}), Diskontierung bis Lieferdatum ${formatDateDe(trade.deliveryDate)}, Vol-Zeit bis Ausübung ${formatDateDe(trade.expiryDate)}; ${smile}${vol}; ${greeks}.`,
        ...(lifecycleLine ? [lifecycleLine] : []),
        `FX-Delta-Betrag: Barwertänderung in der Reporting-Währung bei +1 % Spot der Basiswährung ${base} gegen ${quote} (Geldbetrag); Delta-Quote = vorzeichenbehaftetes Spot-Delta als Anteil des Nominals (= Delta-Betrag / (1 % des Nominals in Reporting-Währung), Long Call ≈ +0,5 am Geld, Long Put ≈ −0,5; für Vanillas in [−1, 1]). Vega-Buckets je Laufzeitzeile der FX-Fläche (ATM +1 Vol-Punkt, optional RR/BF als Smile-Buckets; Summe ≈ paralleles Vega bis auf die Varianz-Interpolation zwischen den Laufzeiten).`,
      ];
    }
  }
}

function riskLines(risk: RiskReport | undefined, xva: XvaResult | undefined): string[] {
  const lines: string[] = [];
  if (risk) {
    lines.push(
      "Sensitivitäten per Bump-and-Reprice: DV01 und Zero-Buckets als zentrale Differenz ±1 bp der Zero-Sätze (parallel bzw. je Pillar; unter lokaler Interpolation summieren sich die Buckets zum DV01, unter monoton-konvexer oder Spline-Interpolation nur näherungsweise – für Hedge-Zwecke Par-Risiko je Marktquote), Vega +1 bp Normal-Vol (bzw. +1 Vol-Punkt lognormal/FX), FX-Delta ±1 % Spot (Barwertänderung in Reporting-Währung je +1 % Aufwertung der Fremdwährung – Geldbetrag, nicht die Delta-Quote); Theta = 1-Tages-Constant-Curve-Roll (Zero-Sätze je Laufzeit konstant, Turn-of-Year-Sprünge bleiben auf ihrem Kalenderdatum, Vol-Flächen mit fester Restlaufzeit) plus in (t, t+1] gezahlte Cashflows, zerlegt in Carry (Forward-Roll) und Roll-Down; jeder Cashflow zählt genau einmal – FX-Legs mit Lieferung am Roll-Datum gelten im gerollten Barwert als heute geliefert (Value Today) und werden nicht zusätzlich als Cashflow gezählt.",
    );
  }
  if (xva)
    lines.push(
      `Kontrahentenrisiko: ${xvaMethodLabelDe(xva.method)}; CVA = LGD · Σ EPE · ΔPD, DVA analog auf dem negativen Exposure; Fair Value = risikofreier Barwert − CVA + DVA.`,
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
/**
 * Valuation framework citation (N3-08): fair-value measurement per IFRS 13 and
 * IDW RS HFA 47 („Einzelfragen zur Ermittlung des Fair Value nach IFRS 13“);
 * IDW RS HFA 35 governs hedge accounting (Bewertungseinheiten, § 254 HGB) and
 * is cited only by the hedge module. MaRisk requirements on the use of
 * valuation models are AT 4.3.5; BTO 2.2.1 covers the independent valuation.
 */
const VALUATION_FRAMEWORK_LINE =
  "Bewertungsrahmen: IFRS 13 / IDW RS HFA 47 (Fair-Value-Ermittlung) – Bewertungstechnik „Income Approach“ (Barwertmethode: diskontierte erwartete Zahlungsströme bzw. Optionspreismodelle), Inputs der Stufe 2 der Bewertungshierarchie (beobachtbare Kurven, Volatilitäten, FX-Spots); für Bewertungseinheiten gilt § 254 HGB i. V. m. IDW RS HFA 35 (Hedge-Accounting-Modul). Modellannahmen, Marktdatenquellen und Freigabestatus sind im Abschnitt zur Bewertungs-Governance dokumentiert (Verwendung und Validierung von Bewertungsmodellen nach MaRisk AT 4.3.5, handelsunabhängige Bewertung nach BTO 2.2.1).";

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
    "IFRS-13-Einstufung (Heuristik): Level 2 bei beobachtbaren Kurven/Volatilitäten; Level 3, wenn die Fälligkeit mehr als 30 Tage über den letzten Pillar einer tatsächlich genutzten Kurve (Diskontkurve unter dem CSA des Geschäfts, Projektionskurven der referenzierten Indizes) hinausgeht, eine Optionslaufzeit/ein Tenor jenseits des Gitters der genutzten Volatilitätsfläche liegt, eine Volatilitätsfläche fehlt oder eine manuelle Volatilitätsvorgabe verwendet wird. Modellabhängige Ergänzungen auf beobachtbaren Inputs (Barriere ohne Smile-Korrektur, Konvertierung des Volatilitätstyps in die Modell-Quotierung) bleiben Level 2 und werden als Hinweis ausgewiesen.",
  );
  if (opts.perspective) lines.push(`Kostentransparenz (MiFID II ex-ante, BGH XI ZR 33/10): ${costSignRule(opts.perspective)}`);
  return lines;
}

function staticMethodology(trade: Trade): string[] {
  const common = [
    "Multi-Curve-Framework: Diskontierung mit OIS-Kurve (€STR/SOFR/SONIA/SARON), Projektion der Forwards mit indexspezifischer Kurve (EURIBOR-3M/-6M).",
    "Kurven per sequentiellem Bootstrapping aus Depos/FRAs/Futures/Swaps bzw. OIS-Swaps (importierte Kurven: Pillars aus dem Snapshot); Interpolation log-linear in Diskontfaktoren, Extrapolation mit konstantem letztem Forward.",
    "Tageszählung, Geschäftstagekonvention und Kalender gemäß ISDA-Definitionen (TARGET2, US, UK, CH, JP).",
  ];
  switch (trade.type) {
    case "InterestRateSwap":
      return [
        ...common,
        "Barwert = Summe diskontierter fixer und projizierter variabler Cashflows; Par-Satz und fairer Spread analytisch aus der Annuität der ökonomischen Legs (Upfront-Prämie ausgenommen, All-in-Sicht als „Par-Satz all-in“ bzw. „fairer Spread all-in“ in den Kennzahlen).",
      ];
    case "CrossCurrencySwap":
      return [
        ...common,
        "Cross-Currency-Swap mit Nominalaustausch; MtM-Reset: Nominal je Periode = Gegen-Nominal × FX-Fixing am Reset-Termin (zukünftige Termine: Forward-FX aus Diskontkurven); Umrechnung in Reporting-Währung zum Spot.",
      ];
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
        "FX-Forward über Zinsparität mit Spot-Date-Anker (T+2, T+1 für z. B. USDCAD): F = S · [DF_Basis(T)/DF_Basis(t_s)] / [DF_Quote(T)/DF_Quote(t_s)]; Barwert = diskontierte Zahlungsströme beider Währungen, umgerechnet zum auf den Bewertungstag angepassten Spot; Legs mit Lieferung am Bewertungstag als Value-Today-Austausch zum Heute-Kurs (SETTLES_TODAY), davor gelieferte Legs ausgeschlossen.",
      ];
    case "FxOption":
      return [
        ...common,
        "Garman-Kohlhagen für europäische FX-Optionen; Smile aus ATM/RR/BF-Quotes im Delta-Raum; Barrieren nach Reiner-Rubinstein, Digitals analytisch; Greeks der Exoten per finiten Differenzen. Lebenszyklus: verfallene, noch nicht abgewickelte Optionen als abgewickelter Payoff (Ausübungsentscheid am Verfall-Fixing, ausgeübt = Terminposition zum Strike; Warnung EXPIRED), Lieferung am Bewertungstag als Value-Today-Austausch (SETTLES_TODAY), bereits gelieferte Optionen mit Barwert 0 ausgeschlossen.",
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
