import { create } from "zustand";
import {
  type MarketContext,
  type PricingResult,
  type RiskReport,
  type Trade,
  buildSampleMarket,
  computeRisk,
  parseISO,
  priceTrade,
  shiftCurvesParallel,
  shiftFxSpots,
} from "@deriva/pricing-core";
import { type ViewId } from "../hotkeys/keymap.js";
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

interface AppState {
  valuationDate: number;
  baseMarket: MarketContext;
  market: MarketContext;
  whatIf: WhatIf;
  trades: Trade[];
  selectedId: string | null;
  view: ViewId;
  reportingCurrency: string;
  theme: "dark" | "light";
  inspectorOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  toast: string | null;
  chordPrefix: string | null;
  results: Record<string, PricedTrade>;
  riskCache: Record<string, RiskReport>;
  lastPricingMs: number;

  // actions
  setView(v: ViewId): void;
  select(id: string | null): void;
  selectNext(delta: number): void;
  addTrade(t: Trade, opts?: { select?: boolean; goToPricing?: boolean }): void;
  updateTrade(t: Trade): void;
  removeTrade(id: string): void;
  duplicateSelected(): void;
  setWhatIf(w: Partial<WhatIf>): void;
  resetWhatIf(): void;
  setReportingCurrency(c: string): void;
  cycleReportingCurrency(): void;
  toggleTheme(): void;
  toggleInspector(): void;
  setPalette(open: boolean): void;
  setHelp(open: boolean): void;
  showToast(msg: string): void;
  setChord(p: string | null): void;
  setMarket(m: MarketContext): void;
  repriceAll(): void;
  risk(id: string): RiskReport | undefined;
  setValuationDate(iso: string): void;
}

function applyWhatIf(base: MarketContext, w: WhatIf): MarketContext {
  let m = base;
  if (w.ratesBp !== 0) m = shiftCurvesParallel(m, Object.keys(m.curves), w.ratesBp * 1e-4);
  if (w.fxPct !== 0) m = shiftFxSpots(m, "EUR", w.fxPct / 100);
  if (w.volBp !== 0 && m.swaptionVols) {
    m = {
      ...m,
      swaptionVols: Object.fromEntries(Object.entries(m.swaptionVols).map(([k, s]) => [k, { ...s, atm: s.atm.map((r) => r.map((v) => Math.max(1e-5, v + w.volBp * 1e-4))) }])),
      capletVols: m.capletVols
        ? Object.fromEntries(Object.entries(m.capletVols).map(([k, s]) => [k, { ...s, vols: s.vols.map((r) => r.map((v) => Math.max(1e-5, v + w.volBp * 1e-4))) }]))
        : undefined,
    };
  }
  return m;
}

function priceAll(market: MarketContext, trades: Trade[], ccy: string): { results: Record<string, PricedTrade>; ms: number } {
  const t0 = performance.now();
  const results: Record<string, PricedTrade> = {};
  for (const t of trades) {
    try {
      results[t.id] = { trade: t, result: priceTrade(market, t, ccy) };
    } catch (e) {
      results[t.id] = { trade: t, error: (e as Error).message };
    }
  }
  return { results, ms: performance.now() - t0 };
}

const initialDate = parseISO("2026-09-03");
const initialMarket = buildSampleMarket(initialDate);
const initialTrades = samplePortfolio(initialDate);
const initialPricing = priceAll(initialMarket, initialTrades, "EUR");

function readTheme(): "dark" | "light" {
  try {
    const t = localStorage.getItem("deriva.theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "dark";
}

export const useStore = create<AppState>((set, get) => ({
  valuationDate: initialDate,
  baseMarket: initialMarket,
  market: initialMarket,
  whatIf: { ratesBp: 0, fxPct: 0, volBp: 0 },
  trades: initialTrades,
  selectedId: initialTrades[0]?.id ?? null,
  view: "blotter",
  reportingCurrency: "EUR",
  theme: readTheme(),
  inspectorOpen: true,
  paletteOpen: false,
  helpOpen: false,
  toast: null,
  chordPrefix: null,
  results: initialPricing.results,
  riskCache: {},
  lastPricingMs: initialPricing.ms,

  setView: (view) => set({ view }),
  select: (selectedId) => set({ selectedId }),
  selectNext: (delta) => {
    const { trades, selectedId } = get();
    if (trades.length === 0) return;
    const idx = Math.max(0, trades.findIndex((t) => t.id === selectedId));
    const next = Math.min(trades.length - 1, Math.max(0, idx + delta));
    set({ selectedId: trades[next]!.id });
  },
  addTrade: (t, opts) => {
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
  },
  updateTrade: (t) => {
    const trades = get().trades.map((x) => (x.id === t.id ? t : x));
    const { results, ms } = priceAll(get().market, [t], get().reportingCurrency);
    const riskCache = { ...get().riskCache };
    delete riskCache[t.id];
    set({ trades, results: { ...get().results, ...results }, lastPricingMs: ms, riskCache });
  },
  removeTrade: (id) => {
    const trades = get().trades.filter((x) => x.id !== id);
    const results = { ...get().results };
    delete results[id];
    const selectedId = get().selectedId === id ? trades[0]?.id ?? null : get().selectedId;
    set({ trades, results, selectedId });
  },
  duplicateSelected: () => {
    const { selectedId, trades } = get();
    const t = trades.find((x) => x.id === selectedId);
    if (!t) return;
    const copy = JSON.parse(JSON.stringify(t)) as Trade;
    copy.id = `${t.id}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    copy.name = `${t.name ?? t.id} (Kopie)`;
    get().addTrade(copy);
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
    try {
      localStorage.setItem("deriva.theme", theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  toggleInspector: () => set({ inspectorOpen: !get().inspectorOpen }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setHelp: (helpOpen) => set({ helpOpen }),
  showToast: (toast) => {
    set({ toast });
    window.setTimeout(() => {
      if (get().toast === toast) set({ toast: null });
    }, 2200);
  },
  setChord: (chordPrefix) => set({ chordPrefix }),
  setMarket: (baseMarket) => {
    const market = applyWhatIf(baseMarket, get().whatIf);
    const { results, ms } = priceAll(market, get().trades, get().reportingCurrency);
    set({ baseMarket, market, results, lastPricingMs: ms, riskCache: {} });
  },
  repriceAll: () => {
    const { results, ms } = priceAll(get().market, get().trades, get().reportingCurrency);
    set({ results, lastPricingMs: ms, riskCache: {} });
  },
  risk: (id) => {
    const cached = get().riskCache[id];
    if (cached) return cached;
    const t = get().trades.find((x) => x.id === id);
    if (!t) return undefined;
    try {
      const r = computeRisk(get().market, t, get().reportingCurrency, { bucketed: true, vega: true, theta: true });
      set({ riskCache: { ...get().riskCache, [id]: r } });
      return r;
    } catch {
      return undefined;
    }
  },
  setValuationDate: (iso) => {
    const d = parseISO(iso);
    const baseMarket = buildSampleMarket(d);
    set({ valuationDate: d });
    get().setMarket(baseMarket);
  },
}));

export function selectedTrade(s: AppState): Trade | undefined {
  return s.trades.find((t) => t.id === s.selectedId);
}
