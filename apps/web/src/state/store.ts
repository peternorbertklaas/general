import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type CapletVolSurface,
  type CurveBuildSpec,
  type CurveQuote,
  type Fixing,
  type FxFixing,
  type FxVolSurface,
  type HedgeEffectivenessReport,
  type HedgeRelationship,
  type InterpolationMethod,
  type MarketContext,
  type MarketSnapshotJson,
  type SwaptionVolSurface,
  type PricingResult,
  type ReportPerspective,
  type RiskReport,
  type SampleMarketQuotes,
  type ScenarioDefinition,
  type Trade,
  SAMPLE_QUOTES,
  bootstrapCurves,
  buildSampleMarket,
  computeRisk,
  deserializeMarket,
  getIndex,
  hashString,
  knownCurrencies,
  knownIndices,
  marketSnapshotId,
  parseISO,
  priceTrade,
  sampleBootstrapSpecs,
  shiftCurvesParallel,
  shiftFxSpots,
  stableStringify,
  toISO,
  validateMarket,
  validateVolSurfaces,
  volSurfaceWarnings,
} from "@deriva/pricing-core";
import { type ViewId } from "../hotkeys/keymap.js";
import { type MessageContext, INTERPOLATION_DE, germanTradeName, translateCoreMessage, translatePricingError } from "../lib/i18n.js";
import { copyName, idPrefix, nextId } from "../lib/ids.js";
import {
  type RegisterEnvelope,
  type WorkstationSnapshotJson,
  envelopeEmpty,
  envelopeOf,
  envelopeSummary,
  envelopeWithout,
  mergeEnvelopes,
  plausibleEnvelope,
  registerEnvelope,
  unregisterEnvelope,
} from "../lib/register-envelope.js";
import { snapshotErrorText } from "../lib/snapshot-import.js";
import { hasErrors, validateTrade } from "../lib/validate-trade.js";
import { samplePortfolio } from "./sample-portfolio.js";

export interface WhatIf {
  ratesBp: number;
  fxPct: number;
  volBp: number;
}

export interface PricedTrade {
  trade: Trade;
  result?: PricingResult;
  error?: string;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  msg: string;
  action?: ToastAction;
  /** Auto-dismiss delay (ms). */
  ms: number;
  /** Times the same message arrived within `TOAST_COALESCE_MS` (N-09). */
  count: number;
  at: number;
}

export type TradeStatus = NonNullable<Trade["status"]>;
export const TRADE_STATUSES: TradeStatus[] = ["Indication", "Quoted", "Live", "Matured", "Cancelled"];
export const STATUS_LABELS: Record<TradeStatus, string> = {
  Indication: "Indikation",
  Quoted: "Angebot",
  Live: "Live",
  Matured: "Fällig",
  Cancelled: "Storniert",
};

/** Maximum number of trades shown side by side in the compare view. */
export const COMPARE_MAX = 4;
/** Auto-dismiss delay for toasts (ms); toasts with an action stay longer. */
export const TOAST_MS = 3000;
export const TOAST_ACTION_MS = 6000;
/** Visible toasts at once; the oldest toast without an action is dropped first (N-09). */
export const TOAST_MAX = 4;
/** Identical messages within this window are coalesced into one toast ("×2"). */
export const TOAST_COALESCE_MS = 1000;
/** Depth of the undo stack. */
export const UNDO_DEPTH = 20;
/** Storage key of the persisted workstation state. */
export const PERSIST_KEY = "deriva.v1";

const VIEW_IDS: ViewId[] = ["blotter", "pricing", "curves", "scenarios", "market", "report", "compare", "hedge"];

export type DuplicateStrategy = "rename" | "skip" | "replace";

export interface ImportSummary {
  added: number;
  invalid: number;
  renamed: number;
  skipped: number;
  replaced: number;
}

/** Edited volatility surfaces (only the overridden ones, keyed like the market context). */
export interface VolSurfaces {
  swaptionVols?: Record<string, SwaptionVolSurface>;
  capletVols?: Record<string, CapletVolSurface>;
  fxVols?: Record<string, FxVolSurface>;
}
export type VolKind = keyof VolSurfaces;

/**
 * Undo entries are typed: trade snapshots, quote snapshots (N-14), market
 * parameters (interpolation / turn-of-year, R3-F3), vol surfaces (R3-4) and
 * hedge documentations (R3-F4).
 */
export type UndoEntry =
  | { kind: "trades"; trades: Trade[]; label: string; at: number; tradeId?: string }
  | { kind: "quotes"; quotes: SampleMarketQuotes; label: string; at: number }
  | { kind: "market"; interpolation: Record<string, InterpolationMethod>; turnOfYear: Record<string, TurnOfYear>; label: string; at: number }
  | { kind: "vols"; volSurfaces: VolSurfaces; label: string; at: number }
  | { kind: "fxFixings"; fxFixings: FxFixing[]; label: string; at: number }
  /** FX-spot overrides on an imported snapshot (R6-F1). */
  | { kind: "spots"; fxSpotOverrides: Record<string, number>; label: string; at: number }
  /** Historical fixings override (`null` = the base market's own fixings) – R6-F1. */
  | { kind: "fixings"; fixings: Fixing[] | null; label: string; at: number }
  /** Snapshot import / discard / leave: the whole market source before the switch (R6-F2). */
  | { kind: "marketSource"; before: MarketSourceState; label: string; at: number }
  /** User-added curves (Markt R6-5); `quotes` when the action also set an FX spot for the new currency. */
  | { kind: "curves"; extraCurves: Record<string, ExtraCurve>; quotes?: SampleMarketQuotes; label: string; at: number }
  /** Hedge documentation discarded; `result` = the persisted test result that went with it (restored on undo, R7-06). */
  | { kind: "hedge"; tradeId: string; relationship: HedgeRelationship | undefined; result?: HedgeResult; label: string; at: number }
  /** Structural extras of the sample market – "+ Paar" spots and "+ Fläche" surfaces (R8-F2). */
  | { kind: "extras"; extraSpots: Record<string, number>; extraVolSurfaces: VolSurfaces; label: string; at: number }
  /** "+ Währung" register entries (indices, conventions, calendars – Markt R8-1). */
  | { kind: "register"; extraRegister: RegisterEnvelope; label: string; at: number };

/**
 * Everything that determines the base market besides the trades – captured by
 * the `marketSource` undo entry so a snapshot import, its discard on a
 * valuation-date change and "Zum Sample-Markt" are one undoable action each
 * (R6-F2): vols, quotes, market source, valuation date and overrides come back
 * exactly as they were.
 */
export interface MarketSourceState {
  marketSource: MarketSource;
  importedSnapshot: WorkstationSnapshotJson | null;
  quotes: SampleMarketQuotes;
  interpolation: Record<string, InterpolationMethod>;
  turnOfYear: Record<string, TurnOfYear>;
  volSurfaces: VolSurfaces;
  fxFixings: FxFixing[];
  fxSpotOverrides: Record<string, number>;
  fixings: Fixing[] | null;
  extraCurves: Record<string, ExtraCurve>;
  valuationDate: number;
}

/**
 * A curve the user added in the curves view from quotes (Markt R6-5) – for a
 * currency / index the sample market does not carry (NOK-NOWA, SEK-STIBOR-3M,
 * …). Bootstrapped after the sample curves with the core conventions of the
 * index (`knownIndices`); the first curve of a new currency becomes its
 * discount curve. Sample mode only, persisted, undoable, counts as
 * "modifiziert".
 */
export interface ExtraCurve {
  /** Curve id = the index's curve id ("NOK-NOWA"). */
  id: string;
  currency: string;
  /** Registered rate index ("NOWA", "STIBOR-3M"). */
  index: string;
  quotes: CurveQuote[];
  /**
   * EUR spot of a new currency entered with the curve ("EURDKK" 7.46, R7-F1). Stored *with* the curve – not in the
   * quote set – so it survives a snapshot import / "Zum Sample-Markt" / reload together with the curve; a spot the
   * user edits later in the FX-spot table (quote set / override) wins.
   */
  fxSpot?: { pair: string; rate: number };
}

/** Persisted effectiveness test result of a hedge relationship (R5-F3): survives the reload, flagged stale when `key` no longer matches. */
export interface HedgeResult {
  /** Inputs key at test time (relationship, trade, market id, valuation date, options). */
  key: string;
  report: HedgeEffectivenessReport;
  /** ISO timestamp of the test. */
  at: string;
}

export interface RestoreInfo {
  trades: number;
  quotesModified: boolean;
}

/** Cost-transparency / XVA inputs of the report view, persisted per trade (N-17). */
export interface ReportInputs {
  offerPv: number;
  cptySpreadBp: number;
  ownSpreadBp: number;
  recovery: number;
  perspective: ReportPerspective;
}
export const DEFAULT_REPORT_INPUTS: ReportInputs = { offerPv: 0, cptySpreadBp: 120, ownSpreadBp: 60, recovery: 40, perspective: "Kunde" };

export type DocKind = "Termsheet" | "Geeignetheitserklaerung" | "Confirmation" | "KID";

/** Turn-of-year forward jump on a bootstrapped curve (see core `BootstrapSpec.turnOfYear`). */
export interface TurnOfYear {
  date: number;
  bp: number;
}

/** CDS par-spread term structure of a counterparty (tenor like "5Y", spread decimal). */
export interface CdsQuote {
  tenor: string;
  spread: number;
}

/**
 * Where the base market comes from (R5-F2): `"sample"` = bootstrapped from the
 * editable quote set at the valuation date; `"import"` = a `deriva.market/1`
 * snapshot whose curves are taken as they are – quotes, interpolation and
 * turn-of-year do not apply, the valuation date is the snapshot's.
 */
export type MarketSource = "sample" | "import";

export type ImportSnapshotResult =
  | {
      ok: true;
      id: string;
      label: string;
      valuationDate: number;
      dateChanged: boolean;
      /** Market edits (quotes, vols, overrides) that were active before the import – restored by `undo()` (R6-F2). */
      discardedEdits: boolean;
      /** What exactly the import discarded ("Quote-Änderungen", "Vol-Änderungen Swaption EUR", …) – for the toast (R8-F2). */
      discarded: string[];
      /** Structural extras kept but not applied while the snapshot is the base market ("Kurve DKK-DESTR", "Spot EUR/SEK", …). */
      kept: string[];
      /** Register entries taken from the snapshot envelope (Markt R8-1) – German summary, empty without envelope. */
      registered: string;
      /** German plausibility hints of the imported vol surfaces (core `volSurfaceWarnings`, Markt R6-4) – the import succeeds anyway. */
      warnings: string[];
    }
  | { ok: false; error: string };

/** Structural additions to the sample market besides `extraCurves`: "+ Paar" spots and "+ Fläche" surfaces (R8-F2). */
export interface MarketExtras {
  spots?: Record<string, number>;
  volSurfaces?: VolSurfaces;
}

interface AppState {
  valuationDate: number;
  /** Origin of the base market (see `MarketSource`). */
  marketSource: MarketSource;
  /** The imported snapshot file incl. its register envelope (persisted, rebuilt and re-registered on hydration) – null in sample mode. */
  importedSnapshot: WorkstationSnapshotJson | null;
  /** Deserialized imported snapshot (not persisted; the base every rebuild in import mode starts from). */
  importedBase: MarketContext | null;
  /** Market quotes the sample market is bootstrapped from (editable in the curves view). */
  quotes: SampleMarketQuotes;
  /** Interpolation overrides per curve id (persisted, survive valuation-date changes – N-23). */
  interpolation: Record<string, InterpolationMethod>;
  /** Turn-of-year jumps per curve id (persisted, applied to the curve's bootstrap spec). */
  turnOfYear: Record<string, TurnOfYear>;
  /** CDS term structures per counterparty (persisted) – bootstrapped to hazard curves for the XVA panel. */
  cdsCurves: Record<string, CdsQuote[]>;
  /** Edited vol surfaces (swaption cubes, caplet surfaces, FX smiles) overriding the sample market (persisted, R3-4). */
  volSurfaces: VolSurfaces;
  /** Historical FX fixings for MtM-reset notionals (pair, date, rate) – part of the market, persisted, undoable (core R4-1). */
  fxFixings: FxFixing[];
  /**
   * FX-spot edits on an imported snapshot (pair → spot), persisted and undoable; the sample market keeps its spots
   * in the quote set instead. Counts as "modifiziert" relative to the snapshot (R6-F1).
   */
  fxSpotOverrides: Record<string, number>;
  /**
   * Historical rate fixings edited in the market view – `null` = the base market's own fixings (sample market or
   * snapshot), a list = override. Persisted, undoable, counts as "modifiziert" (R6-F1).
   */
  fixings: Fixing[] | null;
  /** Curves added from quotes in the curves view (Markt R6-5) – sample mode, persisted, undoable. */
  extraCurves: Record<string, ExtraCurve>;
  /**
   * FX spots added with "+ Paar" in sample mode (pair → rate, R8-F2): structural like `extraCurves` – mixed into every
   * sample rebuild, untouched by a snapshot import, persisted, undoable. Quote-set spots and curve spots win.
   */
  extraSpots: Record<string, number>;
  /** Vol surfaces added with "+ Fläche" in sample mode (R8-F2) – structural like `extraCurves`; vol *edits* stay in `volSurfaces`. */
  extraVolSurfaces: VolSurfaces;
  /** Register entries added with "+ Währung" (indices, conventions, calendars – Markt R8-1): persisted, re-registered on load, undoable. */
  extraRegister: RegisterEnvelope;
  baseMarket: MarketContext;
  market: MarketContext;
  whatIf: WhatIf;
  trades: Trade[];
  selectedId: string | null;
  /** Ids in the currently visible (filtered / sorted) blotter order – drives j/k navigation. */
  visibleIds: string[];
  view: ViewId;
  reportingCurrency: string;
  theme: "dark" | "light";
  inspectorOpen: boolean;
  paletteOpen: boolean;
  /** Text the palette input is prefilled with when opened (onboarding chips). */
  paletteInitialQuery: string | null;
  helpOpen: boolean;
  /** Valuation-date popover (topbar chip / shift+t). */
  valDateOpen: boolean;
  toasts: Toast[];
  chordPrefix: string | null;
  results: Record<string, PricedTrade>;
  riskCache: Record<string, RiskReport>;
  lastPricingMs: number;
  /** Customer view: hides internal information (counterparty, DV01, margins, XVA, warnings). */
  customerMode: boolean;
  /** Trades selected for the side-by-side compare view. */
  compareIds: string[];
  /** User-defined stress scenarios (persisted in localStorage). */
  customScenarios: ScenarioDefinition[];
  /** Snapshots for undo (newest last). */
  undoStack: UndoEntry[];
  /** Hedge relationships keyed by hedging-instrument trade id (persisted). */
  hedgeRelationships: Record<string, HedgeRelationship>;
  /** Last effectiveness test result per hedging-instrument trade id (persisted, R5-F3). */
  hedgeResults: Record<string, HedgeResult>;
  /** Report inputs keyed by trade id (persisted). */
  reportInputs: Record<string, ReportInputs>;
  /** Timestamp fixed by "Report erzeugen"; null → report not generated yet. */
  reportStamp: string | null;
  /** Inputs key captured by the report view when the stamp was fixed – survives view switches (N-18). */
  reportKey: string | null;
  /** Document dialog requested (Termsheet / Geeignetheitserklärung) – opened by the report view. */
  docKind: DocKind | null;
  /** Set once after hydration when a persisted book was restored (consumed by the App toast). */
  restored: RestoreInfo | null;
  /** Number of open modal dialogs (documents, context menus …) – background hotkeys are suspended while > 0. */
  modalDepth: number;
  /** Number of open popovers (Export ▾, Spalten, Datums-Vorlagen) – hotkeys are suspended, the shell stays interactive (R3-02). */
  popoverDepth: number;

  // actions
  openModal(): void;
  closeModal(): void;
  openPopover(): void;
  closePopover(): void;
  setView(v: ViewId): void;
  select(id: string | null): void;
  setVisibleIds(ids: string[]): void;
  selectNext(delta: number): void;
  addTrade(t: Trade, opts?: { select?: boolean; goToPricing?: boolean; autoId?: boolean }): Trade;
  importTrades(trades: Trade[], opts?: { onDuplicate?: DuplicateStrategy }): ImportSummary;
  updateTrade(t: Trade): void;
  removeTrade(id: string): void;
  duplicateSelected(): Trade | undefined;
  undo(): string | null;
  setWhatIf(w: Partial<WhatIf>): void;
  resetWhatIf(): void;
  setReportingCurrency(c: string): void;
  cycleReportingCurrency(): void;
  toggleTheme(): void;
  toggleInspector(): void;
  toggleCustomerMode(): void;
  toggleCompare(id: string): void;
  clearCompare(): void;
  addScenario(sc: ScenarioDefinition): void;
  removeScenario(id: string): void;
  setPalette(open: boolean, initialQuery?: string): void;
  setHelp(open: boolean): void;
  setValDateOpen(open: boolean): void;
  setDoc(kind: DocKind | null): void;
  showToast(msg: string, opts?: { action?: ToastAction; ms?: number }): number;
  dismissToast(id: number): void;
  setChord(p: string | null): void;
  setMarket(m: MarketContext): void;
  setQuotes(q: SampleMarketQuotes, label?: string): boolean;
  resetQuotes(): void;
  setInterpolation(curveId: string, method: InterpolationMethod | undefined): boolean;
  /** Set / remove a turn-of-year jump; refuses dates on or before the valuation date (R3-F2). */
  setTurnOfYear(curveId: string, toy: TurnOfYear | undefined): boolean;
  setCdsCurve(counterparty: string, quotes: CdsQuote[] | undefined): void;
  /** Override one vol surface (undoable, marks the market as modified); `undefined` restores the sample surface. */
  setVolSurface(kind: VolKind, id: string, surface: SwaptionVolSurface | CapletVolSurface | FxVolSurface | undefined, label: string): boolean;
  resetVolSurfaces(): void;
  /** Replace the FX fixings (undoable, marks the market as modified); an empty list removes them all. */
  setFxFixings(next: FxFixing[], label: string): boolean;
  /**
   * Set an FX spot. Sample market: the spot lives in the quote set (undo entry "quotes"). Imported snapshot: stored
   * as an override on top of the snapshot – undoable, persisted, exported, flagged "modifiziert" (R6-F1).
   */
  setFxSpot(pair: string, spot: number, label?: string): boolean;
  /** Replace the historical rate fixings (`null` = back to the base market's fixings) – undoable, persisted (R6-F1). */
  setFixings(next: Fixing[] | null, label: string): boolean;
  /**
   * Back to the unmodified base market: sample mode resets quotes, interpolation, turn-of-year, vol surfaces, FX fixings
   * and fixings; import mode drops the overrides made on top of the snapshot (vols, FX fixings, spots, fixings).
   */
  resetMarketOverrides(): void;
  /**
   * Add a curve for a currency / index from quotes (Markt R6-5); `fxSpot` also
   * stores the EUR spot of a new currency in the quote set. One undo entry.
   */
  addExtraCurve(curve: ExtraCurve, opts?: { fxSpot?: { pair: string; rate: number } }): { ok: true } | { ok: false; error: string };
  /** Replace the quotes of an added curve (re-bootstrap, undoable). */
  setExtraCurveQuotes(id: string, quotes: CurveQuote[], label: string): boolean;
  /** Remove an added curve (undoable). */
  removeExtraCurve(id: string): boolean;
  /**
   * "+ Paar" in sample mode (R8-F2): a structural spot for a pair the market does not quote – survives snapshot import →
   * "Zum Sample-Markt" → reload. Import mode uses `setFxSpot` (override) instead; returns false there.
   */
  addExtraSpot(pair: string, rate: number, label?: string): boolean;
  /** Remove a "+ Paar" spot again (undoable). */
  removeExtraSpot(pair: string): boolean;
  /**
   * "+ Fläche" in sample mode (R8-F2): add / replace (`surface`) or remove (`undefined`) a structural vol surface for a
   * currency, index or pair the sample market has none for. Undoable, persisted, untouched by a snapshot import.
   */
  setExtraVolSurface(kind: VolKind, id: string, surface: SwaptionVolSurface | CapletVolSurface | FxVolSurface | undefined, label: string): boolean;
  /**
   * "+ Währung" (Markt R8-1): validate and register indices / conventions / calendars in the core register, remember them
   * (persisted, re-registered on load) and export them with the snapshot. One undo entry.
   */
  addCurrencyRegistration(env: RegisterEnvelope): { ok: true; summary: string } | { ok: false; error: string };
  /** Remove a "+ Währung" registration again (refused while an added curve of the currency exists). */
  removeCurrencyRegistration(currency: string): { ok: true } | { ok: false; error: string };
  repriceAll(): void;
  /**
   * Risk report from the cache, computed on demand *without* writing to the
   * store – safe to call during render. Use `ensureRisk` (effect) to fill the
   * cache so subsequent renders are cheap (N-26 / arch N-09).
   */
  risk(id: string): RiskReport | undefined;
  /** Compute and cache the risk report of a trade (call from effects / handlers, never during render). */
  ensureRisk(id: string): RiskReport | undefined;
  /**
   * Set the valuation date and rebuild the sample market from the quotes. With
   * an imported snapshot the call is refused (returns false) unless
   * `discardImport` is set – the import is never dropped silently (R5-F2); use
   * `changeValuationDate()` from the UI, it asks first.
   */
  setValuationDate(iso: string, opts?: { discardImport?: boolean }): boolean;
  /**
   * Replace the whole market by a `deriva.market/1` snapshot (R5-F2): curves,
   * spots, fixings, FX fixings, vol surfaces, credit data and the valuation
   * date come from the file; quote edits, interpolation / turn-of-year
   * overrides and vol overrides are reset, so the "modifiziert" flag is off and
   * the snapshot id equals the core `marketSnapshotId` of the file.
   */
  importSnapshot(json: WorkstationSnapshotJson): ImportSnapshotResult;
  /** Back to the sample market bootstrapped from the quotes at the current valuation date (undoable, R6-F2). */
  leaveImport(): void;
  setHedgeRelationship(rel: HedgeRelationship): void;
  /** Discard the stored hedge documentation of a trade – undoable (R3-F4); its test result is dropped with it. */
  removeHedgeRelationship(tradeId: string): void;
  /** Store the effectiveness test result of a trade's hedge relationship (persisted, R5-F3). */
  setHedgeResult(tradeId: string, result: HedgeResult | undefined): void;
  setReportInputs(tradeId: string, patch: Partial<ReportInputs>): void;
  resetReportInputs(tradeId: string): void;
  generateReport(): string;
  setReportKey(key: string | null): void;
  resetPortfolio(): void;
  clearRestored(): void;
}

function applyWhatIf(base: MarketContext, w: WhatIf): MarketContext {
  let m = base;
  if (w.ratesBp !== 0) m = shiftCurvesParallel(m, Object.keys(m.curves), w.ratesBp * 1e-4);
  if (w.fxPct !== 0) m = shiftFxSpots(m, "EUR", w.fxPct / 100);
  if (w.volBp !== 0 && m.swaptionVols) {
    m = {
      ...m,
      swaptionVols: Object.fromEntries(
        Object.entries(m.swaptionVols).map(([k, s]) => [k, { ...s, atm: s.atm.map((r) => r.map((v) => Math.max(1e-5, v + w.volBp * 1e-4))) }]),
      ),
      capletVols: m.capletVols
        ? Object.fromEntries(
            Object.entries(m.capletVols).map(([k, s]) => [k, { ...s, vols: s.vols.map((r) => r.map((v) => Math.max(1e-5, v + w.volBp * 1e-4))) }]),
          )
        : undefined,
    };
  }
  return m;
}

/**
 * Price a list of trades. Trades with error-level validation issues are not
 * priced at all (N-21) – they carry a German error and no result, so they
 * neither show "OK" nor enter sums and exports.
 */
export function priceAll(market: MarketContext, trades: Trade[], ccy: string, ctx: MessageContext = {}): { results: Record<string, PricedTrade>; ms: number } {
  const t0 = performance.now();
  const results: Record<string, PricedTrade> = {};
  for (const t of trades) {
    const issues = validateTrade(t);
    if (hasErrors(issues)) {
      results[t.id] = {
        trade: t,
        error: `Ungültige Eingaben: ${issues
          .filter((i) => i.level === "error")
          .map((i) => i.msg)
          .join("; ")}`,
      };
      continue;
    }
    try {
      results[t.id] = { trade: t, result: priceTrade(market, t, ccy) };
    } catch (e) {
      // The repair hint depends on the market source and the product (R8-06 / R8-F1).
      results[t.id] = { trade: t, error: translatePricingError(e, { ...ctx, tradeType: t.type }) };
    }
  }
  return { results, ms: performance.now() - t0 };
}

/** German label of an interpolation method for undo entries ("log-linear (DF)"). */
function interpolationLabel(m: string | undefined): string {
  return m ? (INTERPOLATION_DE[m] ?? m) : "log-linear (DF)";
}
/** Serial date → TT.MM.JJJJ (undo labels). */
function isoDe(d: number): string {
  const [y, m, day] = toISO(d).split("-");
  return `${day}.${m}.${y}`;
}

export const INITIAL_DATE_ISO = "2026-09-03";
const initialDate = parseISO(INITIAL_DATE_ISO);
const cloneQuotes = (q: SampleMarketQuotes): SampleMarketQuotes => JSON.parse(JSON.stringify(q)) as SampleMarketQuotes;
const initialQuotes = cloneQuotes(SAMPLE_QUOTES);
const initialMarket = buildSampleMarket(initialDate, initialQuotes);
const initialTrades = samplePortfolio(initialDate);
const initialPricing = priceAll(initialMarket, initialTrades, "EUR");

/** Whether the quote set differs from the shipped sample quotes. */
export function quotesModified(q: SampleMarketQuotes): boolean {
  return JSON.stringify(q) !== JSON.stringify(SAMPLE_QUOTES);
}

/** Number of overridden vol surfaces. */
export function volSurfaceCount(v: VolSurfaces | undefined): number {
  if (!v) return 0;
  return Object.keys(v.swaptionVols ?? {}).length + Object.keys(v.capletVols ?? {}).length + Object.keys(v.fxVols ?? {}).length;
}

/** Normalised FX fixings for comparisons (order-independent). */
function fxFixingsKey(list: FxFixing[] | undefined): string {
  return JSON.stringify(
    (list ?? [])
      .filter(isPlausibleFxFixing)
      .map((f) => [f.pair.toUpperCase(), f.date, f.rate] as const)
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]),
  );
}

/**
 * Quotes, spots, interpolation overrides, turn-of-year jumps, vol surfaces, FX
 * fixings or fixings differ from the sample market (N-23, R3-4). For an imported
 * snapshot every edit made *after* the import counts – vol surfaces, FX-spot
 * overrides, fixings and FX-fixing changes – the snapshot itself is the
 * reference, not the sample (R5-F2, R6-F1).
 */
export function marketModified(
  s: Pick<AppState, "quotes" | "interpolation"> & {
    turnOfYear?: Record<string, TurnOfYear>;
    volSurfaces?: VolSurfaces;
    fxFixings?: FxFixing[];
    marketSource?: MarketSource;
    fxSpotOverrides?: Record<string, number>;
    fixings?: Fixing[] | null;
    importedBase?: MarketContext | null;
    extraCurves?: Record<string, ExtraCurve>;
    extraSpots?: Record<string, number>;
    extraVolSurfaces?: VolSurfaces;
  },
): boolean {
  const fixingsOverride = Array.isArray(s.fixings);
  if (s.marketSource === "import") {
    const fxFixingsChanged = s.importedBase ? fxFixingsKey(s.fxFixings) !== fxFixingsKey(s.importedBase.fxFixings) : false;
    return volSurfaceCount(s.volSurfaces) > 0 || Object.keys(s.fxSpotOverrides ?? {}).length > 0 || fixingsOverride || fxFixingsChanged;
  }
  return (
    quotesModified(s.quotes) ||
    Object.keys(s.interpolation).length > 0 ||
    Object.keys(s.turnOfYear ?? {}).length > 0 ||
    volSurfaceCount(s.volSurfaces) > 0 ||
    (s.fxFixings?.length ?? 0) > 0 ||
    fixingsOverride ||
    Object.keys(s.extraCurves ?? {}).length > 0 ||
    Object.keys(s.extraSpots ?? {}).length > 0 ||
    volSurfaceCount(s.extraVolSurfaces) > 0
  );
}

/** German label of a vol surface ("Swaption-Cube EUR", "Caplet-Fläche EUR-EURIBOR-6M", "FX-Fläche EUR/USD"). */
export function volSurfaceLabel(kind: VolKind, id: string): string {
  if (kind === "swaptionVols") return `Swaption-Cube ${id}`;
  if (kind === "capletVols") return `Caplet-Fläche ${id}`;
  return `FX-Fläche ${/^[A-Z]{6}$/.test(id) ? `${id.slice(0, 3)}/${id.slice(3)}` : id}`;
}

/** Labels of every surface in a `VolSurfaces` map. */
function volSurfaceLabels(v: VolSurfaces | undefined): string[] {
  const out: string[] = [];
  for (const kind of ["swaptionVols", "capletVols", "fxVols"] as VolKind[]) for (const id of Object.keys(v?.[kind] ?? {})) out.push(volSurfaceLabel(kind, id));
  return out;
}

/**
 * What a snapshot import discards (R8-F2 – the toast names it): quote edits, interpolation / turn-of-year overrides,
 * vol edits, FX fixings and fixing overrides in sample mode; spot / vol / fixing overrides on a previously imported
 * snapshot. Structural extras (added curves, "+ Paar" spots, "+ Fläche" surfaces) are *kept* – listed separately.
 */
export function importDiscards(
  s: Pick<AppState, "quotes" | "interpolation" | "turnOfYear" | "volSurfaces" | "fxFixings" | "fxSpotOverrides" | "fixings" | "marketSource"> & {
    importedBase?: MarketContext | null;
    extraCurves?: Record<string, ExtraCurve>;
    extraSpots?: Record<string, number>;
    extraVolSurfaces?: VolSurfaces;
  },
): { discarded: string[]; kept: string[] } {
  const discarded: string[] = [];
  const pairLabel = (p: string) => `${p.slice(0, 3)}/${p.slice(3)}`;
  if (s.marketSource === "import") {
    const spots = Object.keys(s.fxSpotOverrides ?? {});
    if (spots.length) discarded.push(`Spot-Overrides ${spots.map(pairLabel).join(", ")}`);
    const vols = volSurfaceLabels(s.volSurfaces);
    if (vols.length) discarded.push(`Vol-Änderungen ${vols.join(", ")}`);
    if (Array.isArray(s.fixings)) discarded.push("Fixings-Override");
    if (s.importedBase && fxFixingsKey(s.fxFixings) !== fxFixingsKey(s.importedBase.fxFixings)) discarded.push("FX-Fixing-Änderungen");
  } else {
    if (quotesModified(s.quotes)) discarded.push("Quote-Änderungen");
    const interp = Object.keys(s.interpolation);
    if (interp.length) discarded.push(`Interpolation ${interp.join(", ")}`);
    const toy = Object.keys(s.turnOfYear ?? {});
    if (toy.length) discarded.push(`Turn-of-Year ${toy.join(", ")}`);
    const vols = volSurfaceLabels(s.volSurfaces);
    if (vols.length) discarded.push(`Vol-Änderungen ${vols.join(", ")}`);
    if (s.fxFixings.length) discarded.push(`${s.fxFixings.length} FX-Fixing${s.fxFixings.length === 1 ? "" : "s"}`);
    if (Array.isArray(s.fixings)) discarded.push("Fixings-Override");
  }
  const kept = [
    ...Object.keys(s.extraCurves ?? {}).map((id) => `Kurve ${id}`),
    ...Object.keys(s.extraSpots ?? {}).map((p) => `Spot ${pairLabel(p)}`),
    ...volSurfaceLabels(s.extraVolSurfaces),
  ];
  return { discarded, kept };
}

/** A plausible spot stored with an added curve: 6-letter pair, positive finite rate. */
function plausibleCurveSpot(v: unknown): ExtraCurve["fxSpot"] {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return typeof o.pair === "string" && /^[A-Z]{6}$/.test(o.pair) && typeof o.rate === "number" && Number.isFinite(o.rate) && o.rate > 0
    ? { pair: o.pair, rate: o.rate }
    : undefined;
}

/** Persisted extra curves: id, 3-letter currency, index name, a quote list and – optionally – the spot entered with the curve. */
function plausibleExtraCurves(v: unknown): Record<string, ExtraCurve> {
  const out: Record<string, ExtraCurve> = {};
  if (!v || typeof v !== "object") return out;
  for (const [id, c] of Object.entries(v as Record<string, unknown>)) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (
      o.id === id &&
      typeof o.currency === "string" &&
      /^[A-Z]{3}$/.test(o.currency) &&
      typeof o.index === "string" &&
      Array.isArray(o.quotes) &&
      o.quotes.length > 0
    ) {
      const fxSpot = plausibleCurveSpot(o.fxSpot);
      out[id] = { id, currency: o.currency, index: o.index, quotes: o.quotes as CurveQuote[], ...(fxSpot ? { fxSpot } : {}) };
    }
  }
  return out;
}

/**
 * FX spots the added curves carry (R7-F1), for pairs the market does not quote
 * yet in either direction – the sample quote set and spot overrides win.
 */
export function extraCurveSpots(extraCurves: Record<string, ExtraCurve>, present: Record<string, number>): Record<string, number> {
  return spotsNotPresent(
    Object.values(extraCurves)
      .filter((c) => c.fxSpot)
      .map((c) => [c.fxSpot!.pair, c.fxSpot!.rate]),
    present,
  );
}

/** Spots of `list` whose pair is quoted in neither direction in `present` (later duplicates dropped). */
function spotsNotPresent(list: [string, number][], present: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [pair, rate] of list) {
    const inverse = `${pair.slice(3)}${pair.slice(0, 3)}`;
    if (present[pair] !== undefined || present[inverse] !== undefined || out[pair] !== undefined || out[inverse] !== undefined) continue;
    out[pair] = rate;
  }
  return out;
}

/**
 * Bootstrap spec of an added curve: the index's conventions come from the core
 * registry; an IBOR curve of a currency with a discount curve is stripped
 * dual-curve against it.
 */
export function extraCurveSpec(c: ExtraCurve, discountCurveId: Record<string, string>): CurveBuildSpec {
  const disc = discountCurveId[c.currency];
  return { id: c.id, currency: c.currency, index: c.index, quotes: c.quotes, ...(disc && disc !== c.id ? { discountCurveId: disc } : {}) };
}

/** Validation of a curve the user wants to add (German messages). */
export function validateExtraCurve(c: ExtraCurve, existingCurveIds: string[]): string | undefined {
  if (!/^[A-Z]{3}$/.test(c.currency) || !knownCurrencies().includes(c.currency))
    return `Währung „${c.currency}“ hat keine Swap-Konventionen im Kern (bekannt: ${knownCurrencies().join(", ")})`;
  const idx = knownIndices(c.currency).find((i) => i.name === c.index.toUpperCase());
  if (!idx)
    return `Index „${c.index}“ ist für ${c.currency} nicht registriert (bekannt: ${
      knownIndices(c.currency)
        .map((i) => i.name)
        .join(", ") || "–"
    })`;
  if (!c.id) return "Kurven-ID fehlt";
  if (existingCurveIds.includes(c.id)) return `Kurve „${c.id}“ existiert bereits`;
  if (c.quotes.length < 2) return "Mindestens zwei Quotes (Tenor und Satz) angeben";
  for (const q of c.quotes) {
    const v = "rate" in q ? q.rate : "price" in q ? q.price : "spread" in q ? q.spread : "points" in q ? q.points : Number.NaN;
    if (!Number.isFinite(v)) return "Jede Quote braucht einen endlichen Satz";
  }
  if (c.fxSpot && !plausibleCurveSpot(c.fxSpot)) return `Spot ${c.fxSpot.pair} muss ein positiver Kurs eines Währungspaars sein`;
  return undefined;
}

/** Persisted / edited rate fixing: index name, serial date, finite value. */
export function isPlausibleFixing(v: unknown): v is Fixing {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.index === "string" &&
    o.index.length > 0 &&
    typeof o.date === "number" &&
    Number.isFinite(o.date) &&
    typeof o.value === "number" &&
    Number.isFinite(o.value)
  );
}

/** Persisted FX-spot overrides: 6-letter pair → positive finite spot. */
function plausibleSpotOverrides(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [pair, spot] of Object.entries(v as Record<string, unknown>))
    if (/^[A-Z]{6}$/.test(pair) && typeof spot === "number" && Number.isFinite(spot) && spot > 0) out[pair] = spot;
  return out;
}

/** Persisted hedge results: key + report object with the relationship id. */
function plausibleHedgeResults(v: unknown): Record<string, HedgeResult> {
  const out: Record<string, HedgeResult> = {};
  if (!v || typeof v !== "object") return out;
  for (const [id, r] of Object.entries(v as Record<string, unknown>)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const rep = o.report as Record<string, unknown> | undefined;
    if (typeof o.key === "string" && typeof o.at === "string" && rep && typeof rep === "object" && typeof rep.relationshipId === "string")
      out[id] = { key: o.key, at: o.at, report: rep as unknown as HedgeEffectivenessReport };
  }
  return out;
}

/** Persisted / imported FX fixings: 6-letter pair, serial date, positive rate. */
export function isPlausibleFxFixing(v: unknown): v is FxFixing {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.pair === "string" &&
    /^[A-Z]{6}$/.test(o.pair) &&
    typeof o.date === "number" &&
    Number.isFinite(o.date) &&
    typeof o.rate === "number" &&
    Number.isFinite(o.rate) &&
    o.rate > 0
  );
}

/** Apply edited vol surfaces on top of a built market. */
export function withVolSurfaces(m: MarketContext, v: VolSurfaces | undefined): MarketContext {
  if (!v || volSurfaceCount(v) === 0) return m;
  return {
    ...m,
    swaptionVols: v.swaptionVols ? { ...m.swaptionVols, ...v.swaptionVols } : m.swaptionVols,
    capletVols: v.capletVols ? { ...m.capletVols, ...v.capletVols } : m.capletVols,
    fxVols: v.fxVols ? { ...m.fxVols, ...v.fxVols } : m.fxVols,
  };
}

/** Stable short hash of the quote set (report staleness key, N-18). */
export function quotesHash(q: SampleMarketQuotes): string {
  return hashString(stableStringify(q));
}

/**
 * Sample market for a valuation date with the given quotes and interpolation
 * overrides; curves are re-bootstrapped in dependency order so dependent
 * curves see the overridden discount curve (N-23).
 */
export function buildMarket(
  date: number,
  quotes: SampleMarketQuotes,
  interpolation: Record<string, InterpolationMethod>,
  turnOfYear: Record<string, TurnOfYear> = {},
  volSurfaces: VolSurfaces = {},
  fxFixings: FxFixing[] = [],
  extraCurves: Record<string, ExtraCurve> = {},
  extras: MarketExtras = {},
): MarketContext {
  const sample = buildSampleMarket(date, quotes);
  // Structural "+ Fläche" surfaces first, vol *edits* on top (R8-F2) – an edited cell of an added surface stays an edit.
  let built = withVolSurfaces(withVolSurfaces(fxFixings.length ? { ...sample, fxFixings } : sample, extras.volSurfaces), volSurfaces);
  const overrides = Object.keys(interpolation).filter((id) => id in built.curves);
  // A turn-of-year jump only makes sense while the date lies ahead of the valuation date.
  const toys = Object.entries(turnOfYear).filter(([id, t]) => id in built.curves && t.date > date && t.bp !== 0);
  if (overrides.length > 0 || toys.length > 0) {
    const specs = sampleBootstrapSpecs(date, quotes);
    const list = Object.values(specs).map((sp) => {
      let out = sp;
      if (interpolation[sp.id]) out = { ...out, interpolation: interpolation[sp.id] };
      const toy = turnOfYear[sp.id];
      if (toy && toy.date > date && toy.bp !== 0) out = { ...out, turnOfYear: [{ date: toy.date, bp: toy.bp }] };
      return out;
    });
    const { curves } = bootstrapCurves(date, list);
    built = { ...built, curves: { ...built.curves, ...curves } };
  }
  // User-added curves (Markt R6-5): OIS curves first so they can discount the IBOR curves of the same currency.
  const added = Object.values(extraCurves).sort((a, b) => Number(getIndex(b.index).type === "OIS") - Number(getIndex(a.index).type === "OIS"));
  if (added.length > 0) {
    const discountCurveId = { ...built.discountCurveId };
    for (const c of added) if (!discountCurveId[c.currency]) discountCurveId[c.currency] = c.id;
    const specs = added.map((c) => {
      const spec = extraCurveSpec(c, discountCurveId);
      return interpolation[c.id] ? { ...spec, interpolation: interpolation[c.id] } : spec;
    });
    const { curves } = bootstrapCurves(date, specs, built.curves);
    built = { ...built, curves: { ...built.curves, ...curves }, discountCurveId };
    // The EUR spot entered with a new currency's curve travels with the curve (R7-F1); quote-set spots win.
    const spots = extraCurveSpots(extraCurves, built.fxSpots);
    if (Object.keys(spots).length) built = { ...built, fxSpots: { ...built.fxSpots, ...spots } };
  }
  // "+ Paar" spots (R8-F2): structural, behind the quote set and the curve spots.
  const addedSpots = spotsNotPresent(Object.entries(extras.spots ?? {}), built.fxSpots);
  if (Object.keys(addedSpots).length) built = { ...built, fxSpots: { ...built.fxSpots, ...addedSpots } };
  return built;
}

/** Reporting currencies offered by `c`: the majors, then every further currency with a discount curve (JPY, added NOK/SEK/… curves). */
export function reportingCurrencies(m: Pick<MarketContext, "discountCurveId">): string[] {
  const base = ["EUR", "USD", "GBP", "CHF"];
  const more = Object.keys(m.discountCurveId)
    .filter((c) => !base.includes(c))
    .sort((a, b) => (a === "JPY" ? -1 : b === "JPY" ? 1 : a.localeCompare(b)));
  return [...base, ...more];
}

/** localStorage keys outside the persisted slice (theme etc. are read before hydration). */
export const LS_KEYS = {
  theme: "deriva.theme",
  customerMode: "deriva.customerMode",
  customScenarios: "deriva.customScenarios",
  onboarded: "deriva.onboarded",
  conventionsOpen: "deriva.editor.conventionsOpen",
  blotterColumns: "deriva.blotter.columns",
  blotterSort: "deriva.blotter.sort",
  blotterFilter: "deriva.blotter.filter",
  blotterGroup: "deriva.blotter.group",
  parRiskOpen: "deriva.pricing.parRiskOpen",
  vegaDimension: "deriva.pricing.vegaDimension",
  scenariosHistorical: "deriva.scenarios.historical",
} as const;

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function readTheme(): "dark" | "light" {
  const t = readLocal(LS_KEYS.theme);
  return t === "light" || t === "dark" ? t : "dark";
}

function readScenarios(): ScenarioDefinition[] {
  try {
    const raw = readLocal(LS_KEYS.customScenarios);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? (parsed.filter((x) => x && typeof x === "object" && typeof (x as ScenarioDefinition).id === "string") as ScenarioDefinition[])
      : [];
  } catch {
    return [];
  }
}

let toastSeq = 0;
/** While the pointer rests on the toast stack, auto-dismiss is deferred. */
let toastHover = false;
export function setToastHover(v: boolean): void {
  toastHover = v;
}

const TRADE_TYPES = new Set<string>(["InterestRateSwap", "FRA", "CapFloor", "Swaption", "FxForward", "FxSwap", "FxOption", "CrossCurrencySwap"]);
const INTERPOLATIONS = new Set<string>(["logLinear", "linearZero", "cubicSplineZero", "flatForward", "monotoneConvex"]);

/** Minimal structural check before a trade is priced for import validation. */
export function isPlausibleTrade(raw: unknown): raw is Trade {
  if (!raw || typeof raw !== "object") return false;
  const t = raw as Partial<Trade> & { legs?: unknown; underlying?: { legs?: unknown } };
  if (typeof t.id !== "string" || !t.id || typeof t.type !== "string" || !TRADE_TYPES.has(t.type)) return false;
  if ((t.type === "InterestRateSwap" || t.type === "CrossCurrencySwap") && !(Array.isArray(t.legs) && t.legs.length > 0)) return false;
  if (t.type === "Swaption" && !(Array.isArray(t.underlying?.legs) && t.underlying!.legs.length > 0)) return false;
  return true;
}

function isPlausibleQuotes(q: unknown): q is SampleMarketQuotes {
  if (!q || typeof q !== "object") return false;
  const o = q as Record<string, unknown>;
  return ["eurOis", "eur6m", "eur3m", "usdSofr", "gbpSonia", "chfSaron"].every((k) => Array.isArray(o[k])) && !!o.fxSpots && typeof o.fxSpots === "object";
}

function isPlausibleReportInputs(v: unknown): v is ReportInputs {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    ["offerPv", "cptySpreadBp", "ownSpreadBp", "recovery"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k])) &&
    (o.perspective === "Bank" || o.perspective === "Kunde")
  );
}

function isPlausibleTurnOfYear(v: unknown): v is TurnOfYear {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.date === "number" && Number.isFinite(o.date) && typeof o.bp === "number" && Number.isFinite(o.bp);
}

function isPlausibleCdsCurve(v: unknown): v is CdsQuote[] {
  return Array.isArray(v) && v.every((q) => q && typeof q === "object" && typeof (q as CdsQuote).tenor === "string" && Number.isFinite((q as CdsQuote).spread));
}

/** Persisted vol overrides: every surface must be an object with an `id` and an `expiries` array. */
function plausibleVolSurfaces(v: unknown): VolSurfaces {
  const out: VolSurfaces = {};
  if (!v || typeof v !== "object") return out;
  for (const kind of ["swaptionVols", "capletVols", "fxVols"] as VolKind[]) {
    const group = (v as Record<string, unknown>)[kind];
    if (!group || typeof group !== "object") continue;
    const ok: Record<string, unknown> = {};
    for (const [id, s] of Object.entries(group as Record<string, unknown>))
      if (s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string" && Array.isArray((s as { expiries?: unknown }).expiries)) ok[id] = s;
    if (Object.keys(ok).length) (out as Record<string, unknown>)[kind] = ok;
  }
  return out;
}

/** The shipped sample vol surfaces (reference for "edited" markers and resets). */
export function sampleVolSurfaces(): Required<VolSurfaces> {
  return { swaptionVols: initialMarket.swaptionVols ?? {}, capletVols: initialMarket.capletVols ?? {}, fxVols: initialMarket.fxVols ?? {} };
}

/**
 * Structural check of a persisted snapshot before the core rebuilds it (schema,
 * valuation date, curves, spots); anything else falls back to the sample market.
 */
function isPlausibleSnapshot(v: unknown): v is MarketSnapshotJson {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.schema === "deriva.market/1" &&
    typeof o.valuationDate === "string" &&
    Array.isArray(o.curves) &&
    !!o.discountCurveId &&
    typeof o.discountCurveId === "object" &&
    !!o.fxSpots &&
    typeof o.fxSpots === "object"
  );
}

/**
 * Deserialize + validate a snapshot for import (curves, spots, FX fixings, meta
 * and – R5-1 – the vol surfaces). Returns the market or a German problem text.
 */
export function loadSnapshot(
  json: WorkstationSnapshotJson,
): { ok: true; market: MarketContext; warnings: string[]; registered: string } | { ok: false; error: string } {
  // The register envelope (Markt R8-1) is validated and registered *before* the market is deserialised, so curves of a
  // runtime-registered currency (CZK-CZEONIA) and the conventions the quick entry / editor need are in place.
  const env = envelopeOf(json);
  let registered = "";
  if (!envelopeEmpty(env)) {
    const r = registerEnvelope(env);
    if (!r.ok) return { ok: false, error: r.error };
    registered = envelopeSummary(env);
  }
  let market: MarketContext;
  try {
    const { indices: _i, conventions: _c, calendars: _k, ...doc } = json;
    market = deserializeMarket({ ...doc, fixings: json.fixings ?? [] });
  } catch (e) {
    return { ok: false, error: snapshotErrorText(e, translatePricingError) };
  }
  let problems: string[];
  try {
    problems = [...validateMarket(market), ...validateVolSurfaces(market)];
  } catch (e) {
    return { ok: false, error: snapshotErrorText(e, translatePricingError) };
  }
  if (problems.length) {
    const first = translateCoreMessage(problems[0]);
    return { ok: false, error: `Snapshot ungültig: ${first}${problems.length > 1 ? ` (+${problems.length - 1} weitere)` : ""}` };
  }
  // Structurally fine but implausible surfaces (quotation type vs. numbers, degenerate grids) are warnings, not errors (R6-4).
  let warnings: string[] = [];
  try {
    warnings = volSurfaceWarnings(market).map(translateCoreMessage);
  } catch {
    warnings = [];
  }
  return { ok: true, market, warnings, registered };
}

/** Slice of the state written to localStorage. */
export interface PersistedSlice {
  trades: Trade[];
  marketSource?: MarketSource;
  importedSnapshot?: WorkstationSnapshotJson | null;
  quotes: SampleMarketQuotes;
  interpolation: Record<string, InterpolationMethod>;
  turnOfYear?: Record<string, TurnOfYear>;
  cdsCurves?: Record<string, CdsQuote[]>;
  volSurfaces?: VolSurfaces;
  fxFixings?: FxFixing[];
  fxSpotOverrides?: Record<string, number>;
  fixings?: Fixing[] | null;
  extraCurves?: Record<string, ExtraCurve>;
  extraSpots?: Record<string, number>;
  extraVolSurfaces?: VolSurfaces;
  extraRegister?: RegisterEnvelope;
  valuationDate: number;
  reportingCurrency: string;
  view: ViewId;
  inspectorOpen: boolean;
  customerMode: boolean;
  hedgeRelationships: Record<string, HedgeRelationship>;
  hedgeResults?: Record<string, HedgeResult>;
  reportInputs: Record<string, ReportInputs>;
  selectedId: string | null;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      /** Push a trade snapshot for undo; consecutive edits of the same trade within 1 s are coalesced. */
      const pushUndo = (label: string, tradeId?: string) => {
        const { undoStack, trades } = get();
        const last = undoStack[undoStack.length - 1];
        const now = Date.now();
        if (last && last.kind === "trades" && tradeId && last.tradeId === tradeId && last.label === label && now - last.at < 1000) {
          set({ undoStack: [...undoStack.slice(0, -1), { ...last, at: now }] });
          return;
        }
        const entry: UndoEntry = { kind: "trades", trades, label, at: now, tradeId };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push a quote snapshot for undo (N-14); consecutive quote edits within 1 s are coalesced. */
      const pushQuoteUndo = (label: string) => {
        const { undoStack, quotes } = get();
        const last = undoStack[undoStack.length - 1];
        const now = Date.now();
        if (last && last.kind === "quotes" && now - last.at < 1000) {
          set({ undoStack: [...undoStack.slice(0, -1), { ...last, label, at: now }] });
          return;
        }
        const entry: UndoEntry = { kind: "quotes", quotes: cloneQuotes(quotes), label, at: now };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push a snapshot of the market parameters (interpolation, turn-of-year) for undo (R3-F3). */
      const pushMarketUndo = (label: string) => {
        const { undoStack, interpolation, turnOfYear } = get();
        const entry: UndoEntry = { kind: "market", interpolation: { ...interpolation }, turnOfYear: { ...turnOfYear }, label, at: Date.now() };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push a vol-surface snapshot for undo (R3-4); consecutive edits within 1 s are coalesced. */
      const pushVolUndo = (label: string) => {
        const { undoStack, volSurfaces } = get();
        const last = undoStack[undoStack.length - 1];
        const now = Date.now();
        if (last && last.kind === "vols" && now - last.at < 1000) {
          set({ undoStack: [...undoStack.slice(0, -1), { ...last, label, at: now }] });
          return;
        }
        const entry: UndoEntry = { kind: "vols", volSurfaces: JSON.parse(JSON.stringify(volSurfaces)) as VolSurfaces, label, at: now };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push an FX-fixings snapshot for undo (core R4-1); consecutive edits within 1 s are coalesced. */
      const pushFxFixingsUndo = (label: string) => {
        const { undoStack, fxFixings } = get();
        const last = undoStack[undoStack.length - 1];
        const now = Date.now();
        if (last && last.kind === "fxFixings" && now - last.at < 1000) {
          set({ undoStack: [...undoStack.slice(0, -1), { ...last, label, at: now }] });
          return;
        }
        const entry: UndoEntry = { kind: "fxFixings", fxFixings: fxFixings.map((f) => ({ ...f })), label, at: now };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push an FX-spot-override snapshot for undo (R6-F1, import mode); consecutive edits within 1 s are coalesced. */
      const pushSpotUndo = (label: string) => {
        const { undoStack, fxSpotOverrides } = get();
        const last = undoStack[undoStack.length - 1];
        const now = Date.now();
        if (last && last.kind === "spots" && now - last.at < 1000) {
          set({ undoStack: [...undoStack.slice(0, -1), { ...last, label, at: now }] });
          return;
        }
        const entry: UndoEntry = { kind: "spots", fxSpotOverrides: { ...fxSpotOverrides }, label, at: now };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push a fixings snapshot for undo (R6-F1); consecutive edits within 1 s are coalesced. */
      const pushFixingsUndo = (label: string) => {
        const { undoStack, fixings } = get();
        const last = undoStack[undoStack.length - 1];
        const now = Date.now();
        if (last && last.kind === "fixings" && now - last.at < 1000) {
          set({ undoStack: [...undoStack.slice(0, -1), { ...last, label, at: now }] });
          return;
        }
        const entry: UndoEntry = { kind: "fixings", fixings: fixings ? fixings.map((f) => ({ ...f })) : null, label, at: now };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Capture the complete market source (R6-F2) – before a snapshot import, its discard or "Zum Sample-Markt". */
      const marketSourceState = (): MarketSourceState => {
        const s = get();
        return {
          marketSource: s.marketSource,
          importedSnapshot: s.importedSnapshot,
          quotes: cloneQuotes(s.quotes),
          interpolation: { ...s.interpolation },
          turnOfYear: { ...s.turnOfYear },
          volSurfaces: JSON.parse(JSON.stringify(s.volSurfaces)) as VolSurfaces,
          fxFixings: s.fxFixings.map((f) => ({ ...f })),
          fxSpotOverrides: { ...s.fxSpotOverrides },
          fixings: s.fixings ? s.fixings.map((f) => ({ ...f })) : null,
          extraCurves: JSON.parse(JSON.stringify(s.extraCurves)) as Record<string, ExtraCurve>,
          valuationDate: s.valuationDate,
        };
      };
      /** Push an extra-curves snapshot for undo (Markt R6-5). */
      const pushCurvesUndo = (label: string, withQuotes: boolean) => {
        const { undoStack, extraCurves, quotes } = get();
        const entry: UndoEntry = {
          kind: "curves",
          extraCurves: JSON.parse(JSON.stringify(extraCurves)) as Record<string, ExtraCurve>,
          ...(withQuotes ? { quotes: cloneQuotes(quotes) } : {}),
          label,
          at: Date.now(),
        };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      const pushMarketSourceUndo = (label: string) => {
        const entry: UndoEntry = { kind: "marketSource", before: marketSourceState(), label, at: Date.now() };
        set({ undoStack: [...get().undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push a snapshot of the structural extras ("+ Paar" spots, "+ Fläche" surfaces) for undo (R8-F2). */
      const pushExtrasUndo = (label: string) => {
        const { undoStack, extraSpots, extraVolSurfaces } = get();
        const entry: UndoEntry = {
          kind: "extras",
          extraSpots: { ...extraSpots },
          extraVolSurfaces: JSON.parse(JSON.stringify(extraVolSurfaces)) as VolSurfaces,
          label,
          at: Date.now(),
        };
        set({ undoStack: [...undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Push a snapshot of the "+ Währung" register entries for undo (Markt R8-1). */
      const pushRegisterUndo = (label: string) => {
        const entry: UndoEntry = {
          kind: "register",
          extraRegister: JSON.parse(JSON.stringify(get().extraRegister)) as RegisterEnvelope,
          label,
          at: Date.now(),
        };
        set({ undoStack: [...get().undoStack, entry].slice(-UNDO_DEPTH) });
      };
      /** Translation context of the current market source (R8-06). */
      const msgCtx = (): MessageContext => ({ marketSource: get().marketSource });
      /** The structural extras of the sample market as `buildMarket` takes them. */
      const extrasOf = (): MarketExtras => ({ spots: get().extraSpots, volSurfaces: get().extraVolSurfaces });
      /**
       * Base market for the given inputs. Sample mode bootstraps the quotes at
       * `date`; import mode starts from the imported snapshot (its own date and
       * curves – quotes, interpolation and turn-of-year do not apply) and layers
       * the vol overrides, FX fixings and FX-spot overrides on top (R5-F2,
       * R6-F1). A fixings override replaces the base market's fixings in both modes.
       */
      const rebuildMarket = (
        date: number,
        quotes: SampleMarketQuotes,
        interpolation = get().interpolation,
        turnOfYear: Record<string, TurnOfYear> = get().turnOfYear,
        volSurfaces: VolSurfaces = get().volSurfaces,
        fxFixings: FxFixing[] = get().fxFixings,
        fxSpotOverrides: Record<string, number> = get().fxSpotOverrides,
        fixings: Fixing[] | null = get().fixings,
        extraCurves: Record<string, ExtraCurve> = get().extraCurves,
        extras: MarketExtras = extrasOf(),
      ): MarketContext => {
        const imported = get().marketSource === "import" ? get().importedBase : null;
        const built = imported
          ? withVolSurfaces(
              {
                ...imported,
                fxFixings: fxFixings.length ? fxFixings : undefined,
                fxSpots: Object.keys(fxSpotOverrides).length ? { ...imported.fxSpots, ...fxSpotOverrides } : imported.fxSpots,
              },
              volSurfaces,
            )
          : buildMarket(date, quotes, interpolation, turnOfYear, volSurfaces, fxFixings, extraCurves, extras);
        return fixings ? { ...built, fixings } : built;
      };
      /** Restore a captured market source (undo of import / discard / leave, R6-F2). */
      const restoreMarketSource = (b: MarketSourceState): boolean => {
        let importedBase: MarketContext | null = null;
        if (b.marketSource === "import") {
          if (!b.importedSnapshot) return false;
          const loaded = loadSnapshot(b.importedSnapshot);
          if (!loaded.ok) return false;
          importedBase = loaded.market;
        }
        set({
          marketSource: b.marketSource,
          importedSnapshot: b.importedSnapshot,
          importedBase,
          quotes: b.quotes,
          interpolation: b.interpolation,
          turnOfYear: b.turnOfYear,
          volSurfaces: b.volSurfaces,
          fxFixings: b.fxFixings,
          fxSpotOverrides: b.fxSpotOverrides,
          fixings: b.fixings,
          extraCurves: b.extraCurves ?? {},
          valuationDate: b.valuationDate,
          reportStamp: null,
          reportKey: null,
        });
        try {
          const base = rebuildMarket(
            b.valuationDate,
            b.quotes,
            b.interpolation,
            b.turnOfYear,
            b.volSurfaces,
            b.fxFixings,
            b.fxSpotOverrides,
            b.fixings,
            b.extraCurves ?? {},
          );
          get().setMarket(base);
          return true;
        } catch {
          return false;
        }
      };
      return {
        valuationDate: initialDate,
        marketSource: "sample",
        importedSnapshot: null,
        importedBase: null,
        quotes: initialQuotes,
        interpolation: {},
        turnOfYear: {},
        cdsCurves: {},
        volSurfaces: {},
        fxFixings: [],
        fxSpotOverrides: {},
        fixings: null,
        extraCurves: {},
        extraSpots: {},
        extraVolSurfaces: {},
        extraRegister: {},
        baseMarket: initialMarket,
        market: initialMarket,
        whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 },
        trades: initialTrades,
        selectedId: initialTrades[0]?.id ?? null,
        visibleIds: [],
        view: "blotter",
        reportingCurrency: "EUR",
        theme: readTheme(),
        inspectorOpen: true,
        paletteOpen: false,
        paletteInitialQuery: null,
        helpOpen: false,
        valDateOpen: false,
        toasts: [],
        chordPrefix: null,
        results: initialPricing.results,
        riskCache: {},
        lastPricingMs: initialPricing.ms,
        customerMode: readLocal(LS_KEYS.customerMode) === "1",
        compareIds: [],
        customScenarios: readScenarios(),
        undoStack: [],
        hedgeRelationships: {},
        hedgeResults: {},
        reportInputs: {},
        reportStamp: null,
        reportKey: null,
        docKind: null,
        restored: null,
        modalDepth: 0,
        popoverDepth: 0,

        openModal: () => set({ modalDepth: get().modalDepth + 1 }),
        closeModal: () => set({ modalDepth: Math.max(0, get().modalDepth - 1) }),
        openPopover: () => set({ popoverDepth: get().popoverDepth + 1 }),
        closePopover: () => set({ popoverDepth: Math.max(0, get().popoverDepth - 1) }),
        setView: (view) => set({ view }),
        select: (selectedId) => set({ selectedId }),
        setVisibleIds: (ids) => {
          const cur = get().visibleIds;
          if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return;
          set({ visibleIds: ids });
        },
        selectNext: (delta) => {
          const { trades, selectedId, visibleIds } = get();
          const order = visibleIds.length > 0 ? visibleIds.filter((id) => trades.some((t) => t.id === id)) : trades.map((t) => t.id);
          if (order.length === 0) return;
          const idx = order.indexOf(selectedId ?? "");
          const next = idx < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, idx + delta));
          set({ selectedId: order[next]! });
        },
        addTrade: (raw, opts) => {
          let t: Trade = raw.status ? raw : { ...raw, status: "Indication" };
          if (opts?.autoId)
            t = {
              ...t,
              id: nextId(
                idPrefix(t),
                get().trades.map((x) => x.id),
              ),
            };
          const name = germanTradeName(t.name);
          if (name !== t.name) t = { ...t, name };
          pushUndo(`Anlage ${t.id}`);
          const trades = [...get().trades.filter((x) => x.id !== t.id), t];
          const { results, ms } = priceAll(get().market, [t], get().reportingCurrency, msgCtx());
          set({
            trades,
            results: { ...get().results, ...results },
            lastPricingMs: ms,
            selectedId: opts?.select === false ? get().selectedId : t.id,
            view: opts?.goToPricing ? "pricing" : get().view,
            riskCache: {},
          });
          return t;
        },
        importTrades: (incoming, opts) => {
          const strategy: DuplicateStrategy = opts?.onDuplicate ?? "rename";
          const { market, reportingCurrency } = get();
          const ids = new Set(get().trades.map((t) => t.id));
          const accepted: Trade[] = [];
          const replacedIds = new Set<string>();
          const summary: ImportSummary = { added: 0, invalid: 0, renamed: 0, skipped: 0, replaced: 0 };
          for (const raw of incoming) {
            if (!isPlausibleTrade(raw)) {
              summary.invalid++;
              continue;
            }
            if (hasErrors(validateTrade(raw))) {
              summary.invalid++;
              continue;
            }
            try {
              const r = priceTrade(market, raw, reportingCurrency);
              if (!Number.isFinite(r.pv)) throw new Error("PV not finite");
            } catch {
              summary.invalid++;
              continue;
            }
            let id = raw.id;
            if (ids.has(id)) {
              if (strategy === "skip") {
                summary.skipped++;
                continue;
              }
              if (strategy === "replace") {
                replacedIds.add(id);
                summary.replaced++;
              } else {
                let n = 1;
                id = `${raw.id}-IMP`;
                while (ids.has(id)) id = `${raw.id}-IMP${++n}`;
                summary.renamed++;
              }
            }
            ids.add(id);
            accepted.push({ ...raw, id, name: germanTradeName(raw.name), status: raw.status ?? "Indication" });
            summary.added++;
          }
          if (accepted.length > 0) {
            pushUndo(`Import (${accepted.length})`);
            const { results, ms } = priceAll(market, accepted, reportingCurrency, msgCtx());
            const kept = get().trades.filter((t) => !replacedIds.has(t.id));
            set({ trades: [...kept, ...accepted], results: { ...get().results, ...results }, lastPricingMs: ms, riskCache: {}, selectedId: accepted[0]!.id });
          }
          return summary;
        },
        updateTrade: (t) => {
          pushUndo(`Änderung ${t.id}`, t.id);
          const trades = get().trades.map((x) => (x.id === t.id ? t : x));
          const { results, ms } = priceAll(get().market, [t], get().reportingCurrency, msgCtx());
          const riskCache = { ...get().riskCache };
          delete riskCache[t.id];
          set({ trades, results: { ...get().results, ...results }, lastPricingMs: ms, riskCache });
        },
        removeTrade: (id) => {
          if (!get().trades.some((x) => x.id === id)) return;
          pushUndo(`Löschen ${id}`);
          const trades = get().trades.filter((x) => x.id !== id);
          const results = { ...get().results };
          delete results[id];
          const selectedId = get().selectedId === id ? (trades[0]?.id ?? null) : get().selectedId;
          set({ trades, results, selectedId, compareIds: get().compareIds.filter((x) => x !== id) });
        },
        duplicateSelected: () => {
          const { selectedId, trades } = get();
          const t = trades.find((x) => x.id === selectedId);
          if (!t) return undefined;
          const copy = JSON.parse(JSON.stringify(t)) as Trade;
          copy.id = nextId(
            idPrefix(t),
            trades.map((x) => x.id),
          );
          copy.name = copyName(
            t.name ?? t.id,
            trades.map((x) => x.name),
          );
          copy.status = "Indication";
          return get().addTrade(copy);
        },
        undo: () => {
          const { undoStack, market, reportingCurrency } = get();
          const entry = undoStack[undoStack.length - 1];
          if (!entry) return null;
          if (entry.kind === "quotes") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const base = rebuildMarket(get().valuationDate, entry.quotes);
              set({ quotes: entry.quotes });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "market") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const base = rebuildMarket(get().valuationDate, get().quotes, entry.interpolation, entry.turnOfYear);
              set({ interpolation: entry.interpolation, turnOfYear: entry.turnOfYear });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "vols") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const base = rebuildMarket(get().valuationDate, get().quotes, get().interpolation, get().turnOfYear, entry.volSurfaces);
              set({ volSurfaces: entry.volSurfaces });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "fxFixings") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const base = rebuildMarket(get().valuationDate, get().quotes, get().interpolation, get().turnOfYear, get().volSurfaces, entry.fxFixings);
              set({ fxFixings: entry.fxFixings });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "spots") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const s = get();
              const base = rebuildMarket(s.valuationDate, s.quotes, s.interpolation, s.turnOfYear, s.volSurfaces, s.fxFixings, entry.fxSpotOverrides);
              set({ fxSpotOverrides: entry.fxSpotOverrides });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "fixings") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const s = get();
              const base = rebuildMarket(
                s.valuationDate,
                s.quotes,
                s.interpolation,
                s.turnOfYear,
                s.volSurfaces,
                s.fxFixings,
                s.fxSpotOverrides,
                entry.fixings,
              );
              set({ fixings: entry.fixings });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "marketSource") {
            set({ undoStack: undoStack.slice(0, -1) });
            return restoreMarketSource(entry.before) ? entry.label : null;
          }
          if (entry.kind === "curves") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const s = get();
              const quotes = entry.quotes ?? s.quotes;
              const base = rebuildMarket(
                s.valuationDate,
                quotes,
                s.interpolation,
                s.turnOfYear,
                s.volSurfaces,
                s.fxFixings,
                s.fxSpotOverrides,
                s.fixings,
                entry.extraCurves,
              );
              set({ extraCurves: entry.extraCurves, quotes });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "hedge") {
            const next = { ...get().hedgeRelationships };
            if (entry.relationship) next[entry.tradeId] = entry.relationship;
            else delete next[entry.tradeId];
            // The persisted test result comes back with the documentation (R7-06) – no re-test after an undone reset.
            const hedgeResults = { ...get().hedgeResults };
            if (entry.result) hedgeResults[entry.tradeId] = entry.result;
            set({ undoStack: undoStack.slice(0, -1), hedgeRelationships: next, hedgeResults });
            return entry.label;
          }
          if (entry.kind === "extras") {
            set({ undoStack: undoStack.slice(0, -1) });
            try {
              const s = get();
              const base = rebuildMarket(
                s.valuationDate,
                s.quotes,
                s.interpolation,
                s.turnOfYear,
                s.volSurfaces,
                s.fxFixings,
                s.fxSpotOverrides,
                s.fixings,
                s.extraCurves,
                {
                  spots: entry.extraSpots,
                  volSurfaces: entry.extraVolSurfaces,
                },
              );
              set({ extraSpots: entry.extraSpots, extraVolSurfaces: entry.extraVolSurfaces });
              get().setMarket(base);
            } catch {
              return null;
            }
            return entry.label;
          }
          if (entry.kind === "register") {
            // Entries that are not in the restored envelope leave the core register again (built-ins never do).
            unregisterEnvelope(envelopeWithout(get().extraRegister, entry.extraRegister));
            const r = envelopeEmpty(entry.extraRegister) ? { ok: true as const } : registerEnvelope(entry.extraRegister);
            set({ undoStack: undoStack.slice(0, -1), extraRegister: entry.extraRegister });
            return r.ok ? entry.label : null;
          }
          const { results, ms } = priceAll(market, entry.trades, reportingCurrency, msgCtx());
          const selectedId = entry.trades.some((t) => t.id === get().selectedId) ? get().selectedId : (entry.trades[0]?.id ?? null);
          set({
            trades: entry.trades,
            results,
            lastPricingMs: ms,
            riskCache: {},
            undoStack: undoStack.slice(0, -1),
            selectedId,
            compareIds: get().compareIds.filter((id) => entry.trades.some((t) => t.id === id)),
          });
          return entry.label;
        },
        setWhatIf: (w) => {
          const whatIf = { ...get().whatIf, ...w };
          const market = applyWhatIf(get().baseMarket, whatIf);
          const { results, ms } = priceAll(market, get().trades, get().reportingCurrency, msgCtx());
          set({ whatIf, market, results, lastPricingMs: ms, riskCache: {} });
        },
        resetWhatIf: () => get().setWhatIf({ ratesBp: 0, fxPct: 0, volBp: 0 }),
        setReportingCurrency: (c) => {
          const { results, ms } = priceAll(get().market, get().trades, c, msgCtx());
          set({ reportingCurrency: c, results, lastPricingMs: ms, riskCache: {} });
        },
        cycleReportingCurrency: () => {
          const order = reportingCurrencies(get().baseMarket);
          const cur = get().reportingCurrency;
          get().setReportingCurrency(order[(order.indexOf(cur) + 1) % order.length]!);
        },
        toggleTheme: () => {
          const theme = get().theme === "dark" ? "light" : "dark";
          writeLocal(LS_KEYS.theme, theme);
          set({ theme });
        },
        toggleInspector: () => set({ inspectorOpen: !get().inspectorOpen }),
        toggleCustomerMode: () => {
          const customerMode = !get().customerMode;
          writeLocal(LS_KEYS.customerMode, customerMode ? "1" : "0");
          set({ customerMode });
        },
        toggleCompare: (id) => {
          const cur = get().compareIds;
          if (cur.includes(id)) set({ compareIds: cur.filter((x) => x !== id) });
          else if (cur.length >= COMPARE_MAX) get().showToast(`Maximal ${COMPARE_MAX} Trades im Vergleich`);
          else set({ compareIds: [...cur, id] });
        },
        clearCompare: () => set({ compareIds: [] }),
        addScenario: (sc) => {
          const customScenarios = [...get().customScenarios.filter((x) => x.id !== sc.id), sc];
          writeLocal(LS_KEYS.customScenarios, JSON.stringify(customScenarios));
          set({ customScenarios });
        },
        removeScenario: (id) => {
          const customScenarios = get().customScenarios.filter((x) => x.id !== id);
          writeLocal(LS_KEYS.customScenarios, JSON.stringify(customScenarios));
          set({ customScenarios });
        },
        setPalette: (paletteOpen, initialQuery) => set({ paletteOpen, paletteInitialQuery: paletteOpen ? (initialQuery ?? null) : null }),
        setHelp: (helpOpen) => set({ helpOpen }),
        setValDateOpen: (valDateOpen) => set({ valDateOpen }),
        setDoc: (docKind) => set({ docKind }),
        showToast: (msg, opts) => {
          const now = Date.now();
          const ms = opts?.ms ?? (opts?.action ? TOAST_ACTION_MS : TOAST_MS);
          // Coalesce an identical message that arrived within the last second (N-09).
          const same = get().toasts.find((t) => t.msg === msg && now - t.at < TOAST_COALESCE_MS && !t.action && !opts?.action);
          if (same) {
            set({ toasts: get().toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1, at: now } : t)) });
            return same.id;
          }
          const id = ++toastSeq;
          let toasts = [...get().toasts, { id, msg, action: opts?.action, ms, count: 1, at: now }];
          // Cap the visible stack: drop the oldest toast without an action first, then the oldest.
          while (toasts.length > TOAST_MAX) {
            const victim = toasts.find((t) => !t.action) ?? toasts[0]!;
            toasts = toasts.filter((t) => t.id !== victim.id);
          }
          set({ toasts });
          const tick = () => {
            if (toastHover && get().toasts.some((t) => t.id === id)) window.setTimeout(tick, 1000);
            else get().dismissToast(id);
          };
          window.setTimeout(tick, ms);
          return id;
        },
        dismissToast: (id) => {
          if (get().toasts.some((t) => t.id === id)) set({ toasts: get().toasts.filter((t) => t.id !== id) });
        },
        setChord: (chordPrefix) => set({ chordPrefix }),
        setMarket: (baseMarket) => {
          const market = applyWhatIf(baseMarket, get().whatIf);
          const { results, ms } = priceAll(market, get().trades, get().reportingCurrency, msgCtx());
          // The FX fixings travel with the market (snapshot import/export) – keep the persisted slice in sync.
          set({ baseMarket, market, results, lastPricingMs: ms, riskCache: {}, fxFixings: (baseMarket.fxFixings ?? []).filter(isPlausibleFxFixing) });
        },
        setQuotes: (quotes, label) => {
          // Imported curves are not bootstrapped from quotes – a quote edit would silently replace the snapshot (R5-F2).
          if (get().marketSource === "import") return false;
          try {
            const base = rebuildMarket(get().valuationDate, quotes);
            pushQuoteUndo(label ?? "Quote-Änderung");
            set({ quotes });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        resetQuotes: () => {
          get().setQuotes(cloneQuotes(SAMPLE_QUOTES), "Quotes zurückgesetzt");
        },
        setInterpolation: (curveId, method) => {
          const prev = get().interpolation[curveId];
          if (prev === method) return true;
          if (get().marketSource === "import") return false;
          const interpolation = { ...get().interpolation };
          if (method === undefined) delete interpolation[curveId];
          else interpolation[curveId] = method;
          try {
            const base = rebuildMarket(get().valuationDate, get().quotes, interpolation);
            const curveDefault = (get().baseMarket.curves[curveId] as { interpolation?: string } | undefined)?.interpolation;
            pushMarketUndo(`Interpolation ${curveId} ${interpolationLabel(prev ?? curveDefault)} → ${interpolationLabel(method ?? curveDefault)}`);
            set({ interpolation });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        setTurnOfYear: (curveId, toy) => {
          // A jump on or before the valuation date can never be applied – refuse instead of storing it silently (R3-F2).
          if (toy && toy.date <= get().valuationDate) return false;
          if (get().marketSource === "import") return false;
          const turnOfYear = { ...get().turnOfYear };
          if (toy === undefined) delete turnOfYear[curveId];
          else turnOfYear[curveId] = toy;
          try {
            const base = rebuildMarket(get().valuationDate, get().quotes, get().interpolation, turnOfYear);
            pushMarketUndo(
              toy
                ? `Turn-of-Year ${curveId} ${isoDe(toy.date)} ${toy.bp > 0 ? "+" : ""}${String(toy.bp).replace(".", ",")} bp`
                : `Turn-of-Year ${curveId} entfernt`,
            );
            set({ turnOfYear });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        setVolSurface: (kind, id, surface, label) => {
          const cur = get().volSurfaces;
          const group: Record<string, unknown> = { ...(cur[kind] ?? {}) };
          if (surface === undefined) delete group[id];
          else group[id] = surface;
          const volSurfaces: VolSurfaces = { ...cur, [kind]: Object.keys(group).length ? group : undefined };
          if (!volSurfaces[kind]) delete volSurfaces[kind];
          try {
            const base = rebuildMarket(get().valuationDate, get().quotes, get().interpolation, get().turnOfYear, volSurfaces);
            pushVolUndo(label);
            set({ volSurfaces });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        resetVolSurfaces: () => {
          if (volSurfaceCount(get().volSurfaces) === 0) return;
          const base = rebuildMarket(get().valuationDate, get().quotes, get().interpolation, get().turnOfYear, {});
          pushVolUndo("Vol-Flächen zurückgesetzt");
          set({ volSurfaces: {} });
          get().setMarket(base);
        },
        setFxFixings: (next, label) => {
          const fxFixings = next.filter(isPlausibleFxFixing).map((f) => ({ pair: f.pair.toUpperCase(), date: f.date, rate: f.rate }));
          try {
            const base = rebuildMarket(get().valuationDate, get().quotes, get().interpolation, get().turnOfYear, get().volSurfaces, fxFixings);
            pushFxFixingsUndo(label);
            set({ fxFixings });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        setFxSpot: (pair, spot, label) => {
          if (!/^[A-Z]{6}$/.test(pair) || !Number.isFinite(spot) || spot <= 0) return false;
          const text = label ?? `Spot ${pair.slice(0, 3)}/${pair.slice(3)} ${String(Math.round(spot * 1e4) / 1e4).replace(".", ",")}`;
          const s = get();
          // Sample market: spots are quotes – they survive valuation-date changes and count as "modifiziert" (quotesModified).
          if (s.marketSource !== "import") return s.setQuotes({ ...s.quotes, fxSpots: { ...s.quotes.fxSpots, [pair]: spot } }, text);
          // Imported snapshot: an override on top of the file – undoable, persisted, part of the export, flagged "modifiziert" (R6-F1).
          const fxSpotOverrides = { ...s.fxSpotOverrides };
          if (s.importedBase && Math.abs((s.importedBase.fxSpots[pair] ?? Number.NaN) - spot) < 1e-12) delete fxSpotOverrides[pair];
          else fxSpotOverrides[pair] = spot;
          try {
            const base = rebuildMarket(s.valuationDate, s.quotes, s.interpolation, s.turnOfYear, s.volSurfaces, s.fxFixings, fxSpotOverrides);
            pushSpotUndo(text);
            set({ fxSpotOverrides });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        setFixings: (next, label) => {
          const fixings = next ? next.filter(isPlausibleFixing).map((f) => ({ index: f.index, date: f.date, value: f.value })) : null;
          const s = get();
          try {
            const base = rebuildMarket(s.valuationDate, s.quotes, s.interpolation, s.turnOfYear, s.volSurfaces, s.fxFixings, s.fxSpotOverrides, fixings);
            pushFixingsUndo(label);
            set({ fixings });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        resetMarketOverrides: () => {
          const s = get();
          if (s.marketSource === "import") {
            s.resetVolSurfaces();
            const baseFx = (s.importedBase?.fxFixings ?? []).filter(isPlausibleFxFixing);
            if (fxFixingsKey(get().fxFixings) !== fxFixingsKey(baseFx)) get().setFxFixings(baseFx, "FX-Fixings auf den Snapshot zurückgesetzt");
            if (Object.keys(get().fxSpotOverrides).length) {
              const st = get();
              const base = rebuildMarket(st.valuationDate, st.quotes, st.interpolation, st.turnOfYear, st.volSurfaces, st.fxFixings, {});
              pushSpotUndo("FX-Spots auf den Snapshot zurückgesetzt");
              set({ fxSpotOverrides: {} });
              get().setMarket(base);
            }
            if (get().fixings) get().setFixings(null, "Fixings auf den Snapshot zurückgesetzt");
            return;
          }
          s.resetQuotes();
          for (const id of Object.keys(get().interpolation)) get().setInterpolation(id, undefined);
          for (const id of Object.keys(get().turnOfYear)) get().setTurnOfYear(id, undefined);
          get().resetVolSurfaces();
          if (get().fxFixings.length) get().setFxFixings([], "FX-Fixings zurückgesetzt");
          if (get().fixings) get().setFixings(null, "Fixings zurückgesetzt");
          // Structural extras go too (R8-F2): "+ Fläche" surfaces, "+ Paar" spots, then the curves (which carry their own spots).
          for (const kind of ["swaptionVols", "capletVols", "fxVols"] as VolKind[])
            for (const id of Object.keys(get().extraVolSurfaces[kind] ?? {}))
              get().setExtraVolSurface(kind, id, undefined, `${volSurfaceLabel(kind, id)} entfernt`);
          for (const pair of Object.keys(get().extraSpots)) get().removeExtraSpot(pair);
          for (const id of Object.keys(get().extraCurves)) get().removeExtraCurve(id);
        },
        addExtraSpot: (pairIn, rate, label) => {
          const pair = pairIn.toUpperCase();
          const s = get();
          if (s.marketSource === "import" || !/^[A-Z]{6}$/.test(pair) || !Number.isFinite(rate) || rate <= 0) return false;
          const text = label ?? `Spot ${pair.slice(0, 3)}/${pair.slice(3)} ${String(Math.round(rate * 1e4) / 1e4).replace(".", ",")} angelegt`;
          const extraSpots = { ...s.extraSpots, [pair]: rate };
          try {
            const base = rebuildMarket(
              s.valuationDate,
              s.quotes,
              s.interpolation,
              s.turnOfYear,
              s.volSurfaces,
              s.fxFixings,
              s.fxSpotOverrides,
              s.fixings,
              s.extraCurves,
              {
                spots: extraSpots,
                volSurfaces: s.extraVolSurfaces,
              },
            );
            pushExtrasUndo(text);
            set({ extraSpots });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        removeExtraSpot: (pairIn) => {
          const pair = pairIn.toUpperCase();
          const s = get();
          if (s.extraSpots[pair] === undefined) return false;
          const extraSpots = { ...s.extraSpots };
          delete extraSpots[pair];
          try {
            const base = rebuildMarket(
              s.valuationDate,
              s.quotes,
              s.interpolation,
              s.turnOfYear,
              s.volSurfaces,
              s.fxFixings,
              s.fxSpotOverrides,
              s.fixings,
              s.extraCurves,
              {
                spots: extraSpots,
                volSurfaces: s.extraVolSurfaces,
              },
            );
            pushExtrasUndo(`Spot ${pair.slice(0, 3)}/${pair.slice(3)} entfernt`);
            set({ extraSpots });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        setExtraVolSurface: (kind, id, surface, label) => {
          const s = get();
          if (s.marketSource === "import") return false;
          const group: Record<string, unknown> = { ...(s.extraVolSurfaces[kind] ?? {}) };
          if (surface === undefined) delete group[id];
          else group[id] = surface;
          const extraVolSurfaces: VolSurfaces = { ...s.extraVolSurfaces, [kind]: Object.keys(group).length ? group : undefined };
          if (!extraVolSurfaces[kind]) delete extraVolSurfaces[kind];
          // A removed structural surface takes its edits along – nothing to overlay any more.
          let volSurfaces = s.volSurfaces;
          if (surface === undefined && s.volSurfaces[kind]?.[id]) {
            const edits: Record<string, unknown> = { ...s.volSurfaces[kind] };
            delete edits[id];
            volSurfaces = { ...s.volSurfaces, [kind]: Object.keys(edits).length ? edits : undefined };
            if (!volSurfaces[kind]) delete volSurfaces[kind];
          }
          try {
            const base = rebuildMarket(
              s.valuationDate,
              s.quotes,
              s.interpolation,
              s.turnOfYear,
              volSurfaces,
              s.fxFixings,
              s.fxSpotOverrides,
              s.fixings,
              s.extraCurves,
              {
                spots: s.extraSpots,
                volSurfaces: extraVolSurfaces,
              },
            );
            pushExtrasUndo(label);
            if (volSurfaces !== s.volSurfaces) pushVolUndo(label);
            set({ extraVolSurfaces, volSurfaces });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        addCurrencyRegistration: (env) => {
          const r = registerEnvelope(env);
          if (!r.ok) return r;
          pushRegisterUndo(`Registriert: ${envelopeSummary(env)}`);
          set({ extraRegister: mergeEnvelopes(get().extraRegister, env) });
          return { ok: true, summary: envelopeSummary(env) };
        },
        removeCurrencyRegistration: (currencyIn) => {
          const ccy = currencyIn.toUpperCase();
          const s = get();
          const usedBy = Object.values(s.extraCurves).filter((c) => c.currency === ccy);
          if (usedBy.length)
            return { ok: false, error: `${ccy} wird von der Kurve ${usedBy.map((c) => c.id).join(", ")} verwendet – zuerst die Kurve entfernen` };
          const remove: RegisterEnvelope = {
            conventions: (s.extraRegister.conventions ?? []).filter((c) => c.currency.toUpperCase() === ccy),
            indices: (s.extraRegister.indices ?? []).filter((i) => i.currency.toUpperCase() === ccy),
          };
          if (!remove.conventions!.length && !remove.indices!.length) return { ok: false, error: `${ccy} wurde nicht mit „+ Währung“ registriert` };
          pushRegisterUndo(`Registrierung ${ccy} entfernt`);
          unregisterEnvelope(remove);
          // a "+ Kalender" calendar that no remaining index / conventions entry references leaves the persisted envelope too
          // (the core registry keeps it – harmless – so an undo can reference it again)
          let rest = envelopeWithout(s.extraRegister, remove);
          const usedCalendars = new Set([
            ...(rest.indices ?? []).map((i) => i.fixingCalendar.toUpperCase()),
            ...(rest.conventions ?? []).map((c) => c.calendar.toUpperCase()),
          ]);
          rest = envelopeWithout(rest, { calendars: (rest.calendars ?? []).filter((c) => !usedCalendars.has(c.id.toUpperCase())) });
          set({ extraRegister: rest });
          return { ok: true };
        },
        addExtraCurve: (curve, o) => {
          const s = get();
          if (s.marketSource === "import") return { ok: false, error: "Kurven stammen aus dem importierten Snapshot – zuerst „Zum Sample-Markt“ wechseln" };
          // The spot of a new currency is stored with the curve (R7-F1): it survives import / leave / reload with it.
          const fxIn = o?.fxSpot ?? curve.fxSpot;
          const fx = fxIn ? plausibleCurveSpot({ pair: fxIn.pair.toUpperCase(), rate: fxIn.rate }) : undefined;
          if (fxIn && !fx) return { ok: false, error: `Spot ${fxIn.pair.toUpperCase()} muss ein positiver Kurs eines Währungspaars sein` };
          const c: ExtraCurve = { ...curve, currency: curve.currency.toUpperCase(), index: curve.index.toUpperCase(), ...(fx ? { fxSpot: fx } : {}) };
          if (!fx) delete c.fxSpot;
          const problem = validateExtraCurve(c, Object.keys(s.baseMarket.curves));
          if (problem) return { ok: false, error: problem };
          const extraCurves = { ...s.extraCurves, [c.id]: c };
          let base: MarketContext;
          try {
            base = buildMarket(s.valuationDate, s.quotes, s.interpolation, s.turnOfYear, s.volSurfaces, s.fxFixings, extraCurves, extrasOf());
            if (s.fixings) base = { ...base, fixings: s.fixings };
          } catch (e) {
            return { ok: false, error: `Bootstrap fehlgeschlagen: ${translatePricingError(e)}` };
          }
          pushCurvesUndo(`Kurve ${c.id} angelegt${fx ? ` · Spot ${fx.pair.slice(0, 3)}/${fx.pair.slice(3)}` : ""}`, false);
          set({ extraCurves });
          get().setMarket(base);
          return { ok: true };
        },
        setExtraCurveQuotes: (id, quotes, label) => {
          const s = get();
          const cur = s.extraCurves[id];
          if (!cur || s.marketSource === "import") return false;
          const extraCurves = { ...s.extraCurves, [id]: { ...cur, quotes } };
          try {
            const base = rebuildMarket(
              s.valuationDate,
              s.quotes,
              s.interpolation,
              s.turnOfYear,
              s.volSurfaces,
              s.fxFixings,
              s.fxSpotOverrides,
              s.fixings,
              extraCurves,
            );
            pushCurvesUndo(label, false);
            set({ extraCurves });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        removeExtraCurve: (id) => {
          const s = get();
          if (!s.extraCurves[id]) return false;
          const extraCurves = { ...s.extraCurves };
          delete extraCurves[id];
          try {
            const base = rebuildMarket(
              s.valuationDate,
              s.quotes,
              s.interpolation,
              s.turnOfYear,
              s.volSurfaces,
              s.fxFixings,
              s.fxSpotOverrides,
              s.fixings,
              extraCurves,
            );
            pushCurvesUndo(`Kurve ${id} entfernt`, false);
            set({ extraCurves });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
        },
        setCdsCurve: (counterparty, quotes) => {
          const cdsCurves = { ...get().cdsCurves };
          if (quotes === undefined || quotes.length === 0) delete cdsCurves[counterparty];
          else cdsCurves[counterparty] = quotes;
          set({ cdsCurves });
        },
        repriceAll: () => {
          const { results, ms } = priceAll(get().market, get().trades, get().reportingCurrency);
          set({ results, lastPricingMs: ms, riskCache: {} });
        },
        risk: (id) => {
          const cached = get().riskCache[id];
          if (cached) return cached;
          const t = get().trades.find((x) => x.id === id);
          if (!t || get().results[id]?.error) return undefined;
          try {
            return computeRisk(get().market, t, get().reportingCurrency, { bucketed: true, vega: true, theta: true });
          } catch {
            return undefined;
          }
        },
        ensureRisk: (id) => {
          const cached = get().riskCache[id];
          if (cached) return cached;
          const r = get().risk(id);
          if (r) set({ riskCache: { ...get().riskCache, [id]: r } });
          return r;
        },
        setValuationDate: (iso, opts) => {
          try {
            const d = parseISO(iso);
            if (!Number.isFinite(d)) return false;
            const before = get().valuationDate;
            if (get().marketSource === "import") {
              if (d === before) return true;
              // Never drop an imported snapshot silently (R5-F2): the caller must confirm the switch back to the quotes market.
              if (!opts?.discardImport) return false;
              // One undoable action (R6-F2): the snapshot, its overrides and the old valuation date come back with Ctrl+Z.
              pushMarketSourceUndo(`Snapshot „${get().importedBase?.meta?.label ?? "Snapshot"}“ verworfen (Bewertungstag ${isoDe(d)})`);
              set({ marketSource: "sample", importedSnapshot: null, importedBase: null, volSurfaces: {}, fxFixings: [], fxSpotOverrides: {}, fixings: null });
            }
            const baseMarket = rebuildMarket(d, get().quotes);
            set({ valuationDate: d, reportStamp: null, reportKey: null });
            get().setMarket(baseMarket);
            // A stored turn-of-year jump that the new valuation date has overtaken no longer acts on the curve (R4-09).
            const overtaken = Object.entries(get().turnOfYear).filter(([, t]) => t.bp !== 0 && t.date <= d && t.date > before);
            for (const [curveId, t] of overtaken) {
              const [y, m, day] = toISO(t.date).split("-");
              get().showToast(`Turn-of-Year ${curveId} (${day}.${m}.${y}) liegt jetzt vor dem Bewertungstag – inaktiv`);
            }
            return true;
          } catch {
            return false;
          }
        },
        importSnapshot: (json) => {
          const loaded = loadSnapshot(json);
          if (!loaded.ok) return loaded;
          const imported = loaded.market;
          const before = get().valuationDate;
          const label = imported.meta?.label ?? toISO(imported.valuationDate);
          // Structural extras (curves, "+ Paar" spots, "+ Fläche" surfaces) are kept, so only real edits count as discarded (R8-F2).
          const { discarded, kept } = importDiscards(get());
          const discardedEdits = discarded.length > 0;
          const fxFixings = (imported.fxFixings ?? []).filter(isPlausibleFxFixing);
          // The import is one undoable action (R6-F2): Ctrl+Z brings back the previous market source, quotes, vols, overrides and date.
          pushMarketSourceUndo(`Snapshot „${label}“ importiert`);
          // Everything that describes the market now comes from the file: quote edits, overrides and vol edits are reset.
          set({
            marketSource: "import",
            importedSnapshot: json,
            importedBase: imported,
            valuationDate: imported.valuationDate,
            quotes: cloneQuotes(SAMPLE_QUOTES),
            interpolation: {},
            turnOfYear: {},
            volSurfaces: {},
            fxFixings,
            fxSpotOverrides: {},
            fixings: null,
            reportStamp: null,
            reportKey: null,
          });
          // Historical fixings come from the snapshot too (not the previous base market).
          const market = applyWhatIf(imported, get().whatIf);
          const { results, ms } = priceAll(market, get().trades, get().reportingCurrency, msgCtx());
          set({ baseMarket: imported, market, results, lastPricingMs: ms, riskCache: {} });
          return {
            ok: true,
            id: marketSnapshotId(imported),
            label,
            valuationDate: imported.valuationDate,
            dateChanged: imported.valuationDate !== before,
            discardedEdits,
            discarded,
            kept,
            registered: loaded.registered,
            warnings: loaded.warnings,
          };
        },
        leaveImport: () => {
          if (get().marketSource !== "import") return;
          pushMarketSourceUndo(`Zum Sample-Markt (Snapshot „${get().importedBase?.meta?.label ?? "Snapshot"}“ verlassen)`);
          set({
            marketSource: "sample",
            importedSnapshot: null,
            importedBase: null,
            volSurfaces: {},
            fxFixings: [],
            fxSpotOverrides: {},
            fixings: null,
            reportStamp: null,
            reportKey: null,
          });
          // Rebuilt WITH the user's added curves, spots and surfaces (R7-F1 / R8-F2) – a DKK trade stays priceable after leaving the import.
          get().setMarket(rebuildMarket(get().valuationDate, get().quotes));
        },
        setHedgeRelationship: (rel) => set({ hedgeRelationships: { ...get().hedgeRelationships, [rel.hedgingInstrumentId]: rel } }),
        removeHedgeRelationship: (tradeId) => {
          const prev = get().hedgeRelationships[tradeId];
          if (!prev) return;
          const next = { ...get().hedgeRelationships };
          delete next[tradeId];
          const results = { ...get().hedgeResults };
          const prevResult = results[tradeId];
          delete results[tradeId];
          const entry: UndoEntry = {
            kind: "hedge",
            tradeId,
            relationship: prev,
            ...(prevResult ? { result: prevResult } : {}),
            label: `Sicherungsdokumentation ${tradeId} verworfen`,
            at: Date.now(),
          };
          set({ hedgeRelationships: next, hedgeResults: results, undoStack: [...get().undoStack, entry].slice(-UNDO_DEPTH) });
        },
        setHedgeResult: (tradeId, result) => {
          const hedgeResults = { ...get().hedgeResults };
          if (result) hedgeResults[tradeId] = result;
          else delete hedgeResults[tradeId];
          set({ hedgeResults });
        },
        setReportInputs: (tradeId, patch) => {
          const cur = get().reportInputs[tradeId] ?? DEFAULT_REPORT_INPUTS;
          set({ reportInputs: { ...get().reportInputs, [tradeId]: { ...cur, ...patch } } });
        },
        resetReportInputs: (tradeId) => {
          const next = { ...get().reportInputs };
          delete next[tradeId];
          set({ reportInputs: next });
        },
        generateReport: () => {
          const reportStamp = new Date().toISOString();
          set({ reportStamp, reportKey: null });
          return reportStamp;
        },
        setReportKey: (reportKey) => set({ reportKey }),
        resetPortfolio: () => {
          const valuationDate = initialDate;
          const quotes = cloneQuotes(SAMPLE_QUOTES);
          const trades = samplePortfolio(valuationDate);
          const baseMarket = buildSampleMarket(valuationDate, quotes);
          const market = applyWhatIf(baseMarket, get().whatIf);
          const { results, ms } = priceAll(market, trades, get().reportingCurrency);
          // "+ Währung" registrations leave the core register with the reset (built-ins stay).
          unregisterEnvelope(get().extraRegister);
          set({
            valuationDate,
            marketSource: "sample",
            importedSnapshot: null,
            importedBase: null,
            quotes,
            interpolation: {},
            turnOfYear: {},
            cdsCurves: {},
            volSurfaces: {},
            fxFixings: [],
            fxSpotOverrides: {},
            fixings: null,
            extraCurves: {},
            extraSpots: {},
            extraVolSurfaces: {},
            extraRegister: {},
            trades,
            baseMarket,
            market,
            results,
            lastPricingMs: ms,
            riskCache: {},
            selectedId: trades[0]?.id ?? null,
            compareIds: [],
            undoStack: [],
            hedgeRelationships: {},
            hedgeResults: {},
            reportInputs: {},
            restored: null,
            reportStamp: null,
            reportKey: null,
          });
        },
        clearRestored: () => set({ restored: null }),
      };
    },
    {
      name: PERSIST_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): PersistedSlice => ({
        trades: s.trades,
        marketSource: s.marketSource,
        importedSnapshot: s.importedSnapshot,
        quotes: s.quotes,
        interpolation: s.interpolation,
        turnOfYear: s.turnOfYear,
        cdsCurves: s.cdsCurves,
        volSurfaces: s.volSurfaces,
        fxFixings: s.fxFixings,
        fxSpotOverrides: s.fxSpotOverrides,
        fixings: s.fixings,
        extraCurves: s.extraCurves,
        extraSpots: s.extraSpots,
        extraVolSurfaces: s.extraVolSurfaces,
        extraRegister: s.extraRegister,
        valuationDate: s.valuationDate,
        reportingCurrency: s.reportingCurrency,
        view: s.view,
        inspectorOpen: s.inspectorOpen,
        customerMode: s.customerMode,
        hedgeRelationships: s.hedgeRelationships,
        hedgeResults: s.hedgeResults,
        reportInputs: s.reportInputs,
        selectedId: s.selectedId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedSlice>;
        if (!p || typeof p !== "object" || !Array.isArray(p.trades)) return current;
        try {
          const trades = p.trades.filter(isPlausibleTrade);
          const quotes = isPlausibleQuotes(p.quotes) ? p.quotes : cloneQuotes(SAMPLE_QUOTES);
          const interpolation: Record<string, InterpolationMethod> = {};
          if (p.interpolation && typeof p.interpolation === "object") {
            for (const [k, v] of Object.entries(p.interpolation))
              if (typeof v === "string" && INTERPOLATIONS.has(v)) interpolation[k] = v as InterpolationMethod;
          }
          const turnOfYear: Record<string, TurnOfYear> = {};
          if (p.turnOfYear && typeof p.turnOfYear === "object") {
            for (const [k, v] of Object.entries(p.turnOfYear)) if (isPlausibleTurnOfYear(v)) turnOfYear[k] = v;
          }
          const cdsCurves: Record<string, CdsQuote[]> = {};
          if (p.cdsCurves && typeof p.cdsCurves === "object") {
            for (const [k, v] of Object.entries(p.cdsCurves)) if (isPlausibleCdsCurve(v) && v.length > 0) cdsCurves[k] = v;
          }
          const volSurfaces = plausibleVolSurfaces(p.volSurfaces);
          const fxFixings = Array.isArray(p.fxFixings) ? p.fxFixings.filter(isPlausibleFxFixing) : [];
          let valuationDate = typeof p.valuationDate === "number" && Number.isFinite(p.valuationDate) ? p.valuationDate : current.valuationDate;
          const view = VIEW_IDS.includes(p.view as ViewId) ? (p.view as ViewId) : current.view;
          // "+ Währung" registrations come back first (Markt R8-1): added curves and the snapshot envelope may build on them.
          let extraRegister = plausibleEnvelope(p.extraRegister);
          if (!envelopeEmpty(extraRegister) && !registerEnvelope(extraRegister).ok) extraRegister = {};
          // An imported snapshot survives the reload as the base market (R5-F2); an unreadable one falls back to the sample market.
          let marketSource: MarketSource = "sample";
          let importedSnapshot: WorkstationSnapshotJson | null = null;
          let importedBase: MarketContext | null = null;
          if (p.marketSource === "import" && isPlausibleSnapshot(p.importedSnapshot)) {
            const loaded = loadSnapshot(p.importedSnapshot as WorkstationSnapshotJson);
            if (loaded.ok) {
              marketSource = "import";
              importedSnapshot = p.importedSnapshot;
              importedBase = loaded.market;
              valuationDate = loaded.market.valuationDate;
            }
          }
          // Overrides on top of the base market survive the reload as well (R6-F1): FX spots (import mode) and fixings.
          const fxSpotOverrides = importedBase ? plausibleSpotOverrides(p.fxSpotOverrides) : {};
          const fixings = Array.isArray(p.fixings) ? p.fixings.filter(isPlausibleFixing) : null;
          // Added curves survive the reload in import mode too (R7-F1): they are not applied while the snapshot is the
          // base market, but "Zum Sample-Markt" / a valuation-date change rebuilds with them.
          let extraCurves = plausibleExtraCurves(p.extraCurves);
          // "+ Paar" spots and "+ Fläche" surfaces are structural extras like the curves (R8-F2) – kept in import mode too.
          let extras: MarketExtras = { spots: plausibleSpotOverrides(p.extraSpots), volSurfaces: plausibleVolSurfaces(p.extraVolSurfaces) };
          if (Object.keys(extraCurves).length || Object.keys(extras.spots ?? {}).length || volSurfaceCount(extras.volSurfaces)) {
            // an added curve / surface that no longer builds (registry change, bad quotes) is dropped rather than breaking the start
            try {
              buildMarket(valuationDate, quotes, interpolation, turnOfYear, volSurfaces, fxFixings, extraCurves, extras);
            } catch {
              try {
                extras = { spots: extras.spots, volSurfaces: {} };
                buildMarket(valuationDate, quotes, interpolation, turnOfYear, volSurfaces, fxFixings, extraCurves, extras);
              } catch {
                extraCurves = {};
                extras = {};
              }
            }
          }
          const built = importedBase
            ? withVolSurfaces(
                {
                  ...importedBase,
                  fxFixings: fxFixings.length ? fxFixings : undefined,
                  fxSpots: Object.keys(fxSpotOverrides).length ? { ...importedBase.fxSpots, ...fxSpotOverrides } : importedBase.fxSpots,
                },
                volSurfaces,
              )
            : buildMarket(valuationDate, quotes, interpolation, turnOfYear, volSurfaces, fxFixings, extraCurves, extras);
          const baseMarket = fixings ? { ...built, fixings } : built;
          const reportingCurrency =
            typeof p.reportingCurrency === "string" && reportingCurrencies(baseMarket).includes(p.reportingCurrency)
              ? p.reportingCurrency
              : current.reportingCurrency;
          const { results, ms } = priceAll(baseMarket, trades, reportingCurrency, { marketSource });
          const selectedId = trades.some((t) => t.id === p.selectedId) ? p.selectedId! : (trades[0]?.id ?? null);
          const reportInputs: Record<string, ReportInputs> = {};
          if (p.reportInputs && typeof p.reportInputs === "object") {
            for (const [k, v] of Object.entries(p.reportInputs)) if (isPlausibleReportInputs(v)) reportInputs[k] = v;
          }
          return {
            ...current,
            trades,
            marketSource,
            importedSnapshot,
            importedBase,
            quotes,
            interpolation,
            turnOfYear,
            cdsCurves,
            volSurfaces,
            fxFixings,
            fxSpotOverrides,
            fixings,
            extraCurves,
            extraSpots: extras.spots ?? {},
            extraVolSurfaces: extras.volSurfaces ?? {},
            extraRegister,
            valuationDate,
            reportingCurrency,
            view,
            inspectorOpen: typeof p.inspectorOpen === "boolean" ? p.inspectorOpen : current.inspectorOpen,
            customerMode: typeof p.customerMode === "boolean" ? p.customerMode : current.customerMode,
            hedgeRelationships: p.hedgeRelationships && typeof p.hedgeRelationships === "object" ? p.hedgeRelationships : {},
            hedgeResults: plausibleHedgeResults(p.hedgeResults),
            reportInputs,
            baseMarket,
            market: baseMarket,
            results,
            lastPricingMs: ms,
            selectedId,
            restored: {
              trades: trades.length,
              quotesModified: marketModified({
                quotes,
                interpolation,
                turnOfYear,
                volSurfaces,
                fxFixings,
                marketSource,
                fxSpotOverrides,
                fixings,
                importedBase,
                extraCurves,
                extraSpots: extras.spots,
                extraVolSurfaces: extras.volSurfaces,
              }),
            },
          };
        } catch {
          return current;
        }
      },
    },
  ),
);

export function selectedTrade(s: AppState): Trade | undefined {
  return s.trades.find((t) => t.id === s.selectedId);
}

/** Trades currently in the compare set, in selection order (capped at COMPARE_MAX). */
export function compareTrades(s: AppState): Trade[] {
  return s.compareIds
    .map((id) => s.trades.find((t) => t.id === id))
    .filter((t): t is Trade => t !== undefined)
    .slice(0, COMPARE_MAX);
}

/** Report inputs of a trade with defaults; customer mode always uses the client perspective. */
export function reportInputsFor(s: Pick<AppState, "reportInputs" | "customerMode">, tradeId: string): ReportInputs {
  const r = s.reportInputs[tradeId] ?? DEFAULT_REPORT_INPUTS;
  return s.customerMode && r.perspective !== "Kunde" ? { ...r, perspective: "Kunde" } : r;
}

/** Delete a trade and offer "Rückgängig" in a toast (F-18). */
export function deleteWithUndo(id: string): void {
  const s = useStore.getState();
  const t = s.trades.find((x) => x.id === id);
  if (!t) return;
  s.removeTrade(id);
  s.showToast(`Gelöscht: ${t.id}${t.name ? ` · ${t.name}` : ""}`, {
    action: {
      label: "Rückgängig",
      run: () => {
        const label = useStore.getState().undo();
        if (label) useStore.getState().showToast(`Wiederhergestellt: ${t.id}`);
      },
    },
  });
}

/** TT.MM.JJJJ of a serial date (UI helpers below). */
function dateDe(d: number): string {
  return isoDe(d);
}

/**
 * Change the valuation date from the UI (popover, palette `stichtag`). In sample
 * mode this is `setValuationDate`; with an imported snapshot the user is asked
 * first, because the snapshot's curves belong to its own date – confirming
 * discards the import and rebuilds the sample market from the quotes, with a
 * toast that says so (R5-F2). Returns whether the date was changed.
 */
export function changeValuationDate(iso: string): boolean {
  const s = useStore.getState();
  if (s.marketSource === "import") {
    if (toISO(s.valuationDate) === iso) return true;
    const label = s.baseMarket.meta?.label ?? "Snapshot";
    const question =
      `Der Markt stammt aus dem importierten Snapshot „${label}“ (Bewertungstag ${dateDe(s.valuationDate)}). ` +
      `Ein anderer Bewertungstag verwirft den Snapshot und baut den Sample-Markt aus den Quotes zum ${iso.split("-").reverse().join(".")} neu auf ` +
      `(rückgängig mit Ctrl+Z). Fortfahren?`;
    const confirmed = typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(question) : false;
    if (!confirmed) {
      s.showToast(`Bewertungstag unverändert – Snapshot „${label}“ bleibt geladen`);
      return false;
    }
    const ok = s.setValuationDate(iso, { discardImport: true });
    if (ok)
      s.showToast(`Snapshot „${label}“ verworfen – Sample-Markt aus den Quotes zum ${iso.split("-").reverse().join(".")} aufgebaut`, {
        action: { label: "Rückgängig", run: () => useStore.getState().undo() },
      });
    else s.showToast("Ungültiges Datum");
    return ok;
  }
  const ok = s.setValuationDate(iso);
  if (!ok) s.showToast("Ungültiges Datum");
  return ok;
}

export function whatIfActive(w: WhatIf): boolean {
  return w.ratesBp !== 0 || w.fxPct !== 0 || w.volBp !== 0;
}

/** Short label of the active what-if ("+20 bp / FX 0 %"). */
export function whatIfLabel(w: WhatIf): string {
  const parts: string[] = [];
  if (w.ratesBp !== 0) parts.push(`Zinsen ${w.ratesBp > 0 ? "+" : ""}${w.ratesBp} bp`);
  if (w.fxPct !== 0) parts.push(`EUR ${w.fxPct > 0 ? "+" : ""}${String(w.fxPct).replace(".", ",")} %`);
  if (w.volBp !== 0) parts.push(`Vol ${w.volBp > 0 ? "+" : ""}${w.volBp} bp`);
  return parts.join(" / ");
}
