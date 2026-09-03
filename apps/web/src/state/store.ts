import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type HedgeRelationship,
  type InterpolationMethod,
  type MarketContext,
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
  hashString,
  parseISO,
  priceTrade,
  sampleBootstrapSpecs,
  shiftCurvesParallel,
  shiftFxSpots,
  stableStringify,
} from "@deriva/pricing-core";
import { type ViewId } from "../hotkeys/keymap.js";
import { germanTradeName, translatePricingError } from "../lib/i18n.js";
import { copyName, idPrefix, nextId } from "../lib/ids.js";
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

/** Undo entries are typed: trade snapshots and quote snapshots (N-14). */
export type UndoEntry =
  { kind: "trades"; trades: Trade[]; label: string; at: number; tradeId?: string } | { kind: "quotes"; quotes: SampleMarketQuotes; label: string; at: number };

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

export type DocKind = "Termsheet" | "Geeignetheitserklaerung";

interface AppState {
  valuationDate: number;
  /** Market quotes the sample market is bootstrapped from (editable in the curves view). */
  quotes: SampleMarketQuotes;
  /** Interpolation overrides per curve id (persisted, survive valuation-date changes – N-23). */
  interpolation: Record<string, InterpolationMethod>;
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

  // actions
  openModal(): void;
  closeModal(): void;
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
  repriceAll(): void;
  /**
   * Risk report from the cache, computed on demand *without* writing to the
   * store – safe to call during render. Use `ensureRisk` (effect) to fill the
   * cache so subsequent renders are cheap (N-26 / arch N-09).
   */
  risk(id: string): RiskReport | undefined;
  /** Compute and cache the risk report of a trade (call from effects / handlers, never during render). */
  ensureRisk(id: string): RiskReport | undefined;
  setValuationDate(iso: string): boolean;
  setHedgeRelationship(rel: HedgeRelationship): void;
  removeHedgeRelationship(tradeId: string): void;
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
export function priceAll(market: MarketContext, trades: Trade[], ccy: string): { results: Record<string, PricedTrade>; ms: number } {
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
      results[t.id] = { trade: t, error: translatePricingError(e) };
    }
  }
  return { results, ms: performance.now() - t0 };
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

/** Quotes, spots or interpolation overrides differ from the sample market (N-23). */
export function marketModified(s: Pick<AppState, "quotes" | "interpolation">): boolean {
  return quotesModified(s.quotes) || Object.keys(s.interpolation).length > 0;
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
export function buildMarket(date: number, quotes: SampleMarketQuotes, interpolation: Record<string, InterpolationMethod>): MarketContext {
  const built = buildSampleMarket(date, quotes);
  const overrides = Object.entries(interpolation).filter(([id]) => id in built.curves);
  if (overrides.length === 0) return built;
  const specs = sampleBootstrapSpecs(date, quotes);
  const list = Object.values(specs).map((sp) => (interpolation[sp.id] ? { ...sp, interpolation: interpolation[sp.id] } : sp));
  const { curves } = bootstrapCurves(date, list);
  return { ...built, curves: { ...built.curves, ...curves } };
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

/** Slice of the state written to localStorage. */
export interface PersistedSlice {
  trades: Trade[];
  quotes: SampleMarketQuotes;
  interpolation: Record<string, InterpolationMethod>;
  valuationDate: number;
  reportingCurrency: string;
  view: ViewId;
  inspectorOpen: boolean;
  customerMode: boolean;
  hedgeRelationships: Record<string, HedgeRelationship>;
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
      const rebuildMarket = (date: number, quotes: SampleMarketQuotes, interpolation = get().interpolation): MarketContext => {
        const built = buildMarket(date, quotes, interpolation);
        const fixings = get().baseMarket.fixings;
        return fixings && fixings.length > 0 ? { ...built, fixings } : built;
      };
      return {
        valuationDate: initialDate,
        quotes: initialQuotes,
        interpolation: {},
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
        reportInputs: {},
        reportStamp: null,
        reportKey: null,
        docKind: null,
        restored: null,
        modalDepth: 0,

        openModal: () => set({ modalDepth: get().modalDepth + 1 }),
        closeModal: () => set({ modalDepth: Math.max(0, get().modalDepth - 1) }),
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
          const { results, ms } = priceAll(get().market, [t], get().reportingCurrency);
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
            const { results, ms } = priceAll(market, accepted, reportingCurrency);
            const kept = get().trades.filter((t) => !replacedIds.has(t.id));
            set({ trades: [...kept, ...accepted], results: { ...get().results, ...results }, lastPricingMs: ms, riskCache: {}, selectedId: accepted[0]!.id });
          }
          return summary;
        },
        updateTrade: (t) => {
          pushUndo(`Änderung ${t.id}`, t.id);
          const trades = get().trades.map((x) => (x.id === t.id ? t : x));
          const { results, ms } = priceAll(get().market, [t], get().reportingCurrency);
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
          const { results, ms } = priceAll(market, entry.trades, reportingCurrency);
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
          const { results, ms } = priceAll(market, get().trades, get().reportingCurrency);
          set({ whatIf, market, results, lastPricingMs: ms, riskCache: {} });
        },
        resetWhatIf: () => get().setWhatIf({ ratesBp: 0, fxPct: 0, volBp: 0 }),
        setReportingCurrency: (c) => {
          const { results, ms } = priceAll(get().market, get().trades, c);
          set({ reportingCurrency: c, results, lastPricingMs: ms, riskCache: {} });
        },
        cycleReportingCurrency: () => {
          const order = ["EUR", "USD", "GBP", "CHF"];
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
          const { results, ms } = priceAll(market, get().trades, get().reportingCurrency);
          set({ baseMarket, market, results, lastPricingMs: ms, riskCache: {} });
        },
        setQuotes: (quotes, label) => {
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
          const interpolation = { ...get().interpolation };
          if (method === undefined) delete interpolation[curveId];
          else interpolation[curveId] = method;
          try {
            const base = rebuildMarket(get().valuationDate, get().quotes, interpolation);
            set({ interpolation });
            get().setMarket(base);
            return true;
          } catch {
            return false;
          }
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
        setValuationDate: (iso) => {
          try {
            const d = parseISO(iso);
            if (!Number.isFinite(d)) return false;
            const baseMarket = rebuildMarket(d, get().quotes);
            set({ valuationDate: d, reportStamp: null, reportKey: null });
            get().setMarket(baseMarket);
            return true;
          } catch {
            return false;
          }
        },
        setHedgeRelationship: (rel) => set({ hedgeRelationships: { ...get().hedgeRelationships, [rel.hedgingInstrumentId]: rel } }),
        removeHedgeRelationship: (tradeId) => {
          const next = { ...get().hedgeRelationships };
          delete next[tradeId];
          set({ hedgeRelationships: next });
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
          set({
            valuationDate,
            quotes,
            interpolation: {},
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
        quotes: s.quotes,
        interpolation: s.interpolation,
        valuationDate: s.valuationDate,
        reportingCurrency: s.reportingCurrency,
        view: s.view,
        inspectorOpen: s.inspectorOpen,
        customerMode: s.customerMode,
        hedgeRelationships: s.hedgeRelationships,
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
          const valuationDate = typeof p.valuationDate === "number" && Number.isFinite(p.valuationDate) ? p.valuationDate : current.valuationDate;
          const reportingCurrency =
            typeof p.reportingCurrency === "string" && ["EUR", "USD", "GBP", "CHF"].includes(p.reportingCurrency)
              ? p.reportingCurrency
              : current.reportingCurrency;
          const view = VIEW_IDS.includes(p.view as ViewId) ? (p.view as ViewId) : current.view;
          const baseMarket = buildMarket(valuationDate, quotes, interpolation);
          const { results, ms } = priceAll(baseMarket, trades, reportingCurrency);
          const selectedId = trades.some((t) => t.id === p.selectedId) ? p.selectedId! : (trades[0]?.id ?? null);
          const reportInputs: Record<string, ReportInputs> = {};
          if (p.reportInputs && typeof p.reportInputs === "object") {
            for (const [k, v] of Object.entries(p.reportInputs)) if (isPlausibleReportInputs(v)) reportInputs[k] = v;
          }
          return {
            ...current,
            trades,
            quotes,
            interpolation,
            valuationDate,
            reportingCurrency,
            view,
            inspectorOpen: typeof p.inspectorOpen === "boolean" ? p.inspectorOpen : current.inspectorOpen,
            customerMode: typeof p.customerMode === "boolean" ? p.customerMode : current.customerMode,
            hedgeRelationships: p.hedgeRelationships && typeof p.hedgeRelationships === "object" ? p.hedgeRelationships : {},
            reportInputs,
            baseMarket,
            market: baseMarket,
            results,
            lastPricingMs: ms,
            selectedId,
            restored: { trades: trades.length, quotesModified: quotesModified(quotes) || Object.keys(interpolation).length > 0 },
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
