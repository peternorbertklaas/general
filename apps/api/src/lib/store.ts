import { createHash } from "node:crypto";
import {
  type CurveQuote,
  type Fixing,
  type MarketContext,
  type RateIndex,
  type SampleMarketQuotes,
  type SwapConventions,
  type Trade,
  SAMPLE_CURVE_IDS,
  SAMPLE_QUOTES,
  advance,
  buildSampleMarket,
  getCalendar,
  knownCurrencies,
  knownIndices,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  marketSnapshotId,
  parseISO,
  registerRateIndex,
  registerSwapConventions,
  sampleFixings,
  stableStringify,
} from "@deriva/pricing-core";

/**
 * In-memory repositories behind small interfaces. The API is stateless by
 * design; persistence is an adapter concern (see ADR-006) – a database-backed
 * implementation replaces these classes without touching routes.
 */
export interface MarketRepository {
  get(): MarketContext;
  set(ctx: MarketContext): void;
  /** Rebuild the sample market for a new valuation date, preserving manual overrides (spots, fixings, quotes). */
  rebuild(valuationDate: number): MarketContext;
  /** Current market quotes per sample curve (basis for par-risk re-bootstrapping and rebuilds). */
  getQuotes(): SampleMarketQuotes;
  /** Replace the quotes of one sample curve; returns false when the curve id is not a sample curve. */
  setCurveQuotes(curveId: string, quotes: CurveQuote[]): boolean;
  /** Deterministic id of the active market (same hash as `ValuationReport.audit.snapshotId`). */
  snapshotId(): string;
}

/**
 * The snapshot id is the core's `marketSnapshotId` in its default `full`
 * scope (FNV-1a over the canonical JSON of every market input: valuation
 * date, curves with nodes and conventions, discount / CSA mappings, FX spots
 * and spot dates, fixings, vol surfaces, credit data, label) – the same call
 * that writes `audit.snapshotId` into valuation and portfolio reports, so the
 * `X-Market-Snapshot-Id` header and the snapshot `ETag` can be matched to a
 * report without a replicated hash here. A vol bump or an added fixing
 * therefore changes the id (the legacy `curves` scope would not).
 */
export { marketSnapshotId };

/** Curve id → key in `SampleMarketQuotes`. */
const QUOTE_KEY_BY_CURVE: Record<string, keyof Omit<SampleMarketQuotes, "fxSpots">> = Object.fromEntries(
  (Object.entries(SAMPLE_CURVE_IDS) as [keyof typeof SAMPLE_CURVE_IDS, string][]).map(([k, id]) => [id, k]),
) as Record<string, keyof Omit<SampleMarketQuotes, "fxSpots">>;

export class MarketStore implements MarketRepository {
  private ctx: MarketContext;
  private quotes: SampleMarketQuotes;
  /** Snapshot ids per (immutable) market context object. */
  private ids = new WeakMap<MarketContext, string>();
  constructor(valuationDate = parseISO("2026-09-03"), quotes: SampleMarketQuotes = SAMPLE_QUOTES) {
    this.quotes = quotes;
    this.ctx = buildSampleMarket(valuationDate, quotes);
  }
  get(): MarketContext {
    return this.ctx;
  }
  set(ctx: MarketContext): void {
    this.ctx = ctx;
  }
  snapshotId(): string {
    let id = this.ids.get(this.ctx);
    if (!id) {
      id = marketSnapshotId(this.ctx);
      this.ids.set(this.ctx, id);
    }
    return id;
  }
  getQuotes(): SampleMarketQuotes {
    return this.quotes;
  }
  setCurveQuotes(curveId: string, quotes: CurveQuote[]): boolean {
    const key = QUOTE_KEY_BY_CURVE[curveId];
    if (!key) return false;
    this.quotes = { ...this.quotes, [key]: quotes };
    return true;
  }
  rebuild(valuationDate: number): MarketContext {
    const prev = this.ctx;
    const fresh = buildSampleMarket(valuationDate, { ...this.quotes, fxSpots: { ...this.quotes.fxSpots, ...prev.fxSpots } });
    this.ctx = {
      ...fresh,
      fixings: rebuiltFixings(prev, fresh),
      // FX fixings of past MtM-reset dates are history, not sample-market data – they survive a valuation-date change.
      ...(prev.fxFixings ? { fxFixings: prev.fxFixings } : {}),
      credit: prev.credit ?? fresh.credit,
      ...(prev.fxSpotDates ? { fxSpotDates: prev.fxSpotDates } : {}),
      ...(prev.missingFixingPolicy ? { missingFixingPolicy: prev.missingFixingPolicy } : {}),
    };
    return this.ctx;
  }
}

const fixingKey = (f: Fixing) => `${f.index.toUpperCase()}@${f.date}`;

/**
 * Fixings after a valuation-date rebuild (Markt R7-4): the sample fixings follow the new date
 * (`sampleFixings(valuationDate)` – one per TARGET business day up to the day before, exactly what
 * `buildSampleMarket` generates and what the workstation shows), while fixings the user loaded via
 * `PUT /api/market { fixings }` or a snapshot import are history and survive. A user fixing is every
 * previous fixing that was not part of the previous date's sample set (same index, date and value);
 * it wins over a regenerated sample fixing of the same index and date. Before round 7 the rebuild
 * kept the old sample fixings, so the API reported `MISSING_FIXING` for periods the UI valued cleanly.
 */
export function rebuiltFixings(prev: MarketContext, fresh: MarketContext): Fixing[] {
  const prevSample = new Set(sampleFixings(prev.valuationDate).map((f) => `${fixingKey(f)}=${f.value}`));
  const user = (prev.fixings ?? []).filter((f) => !prevSample.has(`${fixingKey(f)}=${f.value}`));
  const userKeys = new Set(user.map(fixingKey));
  return [...(fresh.fixings ?? []).filter((f) => !userKeys.has(fixingKey(f))), ...user];
}

/**
 * Runtime register of floating-rate indices and swap conventions (Markt R6-5 rest, ADR-027). The core
 * register is process-wide (`registerRateIndex` / `registerSwapConventions` mutate `RATE_INDICES` /
 * `SWAP_CONVENTIONS`); this store remembers what was registered through the API so the snapshot
 * export can carry it (`indices` / `conventions` of the API envelope) and an import re-registers it.
 * Built-in indices cannot be replaced (the core throws `INVALID_CURVE_SPEC`, N7-7); conventions of a
 * built-in currency may be overridden and are exported like any other registration.
 */
export class RegisterStore {
  private indices = new Map<string, RateIndex>();
  private conventions = new Map<string, SwapConventions>();
  /** Register (validated by the core – throws `PricingError("INVALID_CURVE_SPEC")`); `replaced` = the name was already registered at runtime. */
  registerIndex(def: RateIndex): { index: RateIndex; replaced: boolean } {
    const replaced = knownIndices().some((ix) => ix.name === def.name.toUpperCase());
    const index = registerRateIndex(def);
    this.indices.set(index.name, index);
    return { index, replaced };
  }
  /** Register conventions (validated by the core); `replaced` = the currency already had conventions (runtime or built-in). */
  registerConventions(conv: SwapConventions): { conventions: SwapConventions; replaced: boolean } {
    const replaced = knownCurrencies().includes(conv.currency.toUpperCase());
    const conventions = registerSwapConventions(conv);
    this.conventions.set(conventions.currency, conventions);
    return { conventions, replaced };
  }
  /** Indices registered through this API instance (sorted by name). */
  listIndices(): RateIndex[] {
    return [...this.indices.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Conventions registered through this API instance (sorted by currency). */
  listConventions(): SwapConventions[] {
    return [...this.conventions.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }
}

export interface StoredTrade {
  trade: Trade;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Strong ETag `"version-hash"` derived from version + content hash (see `tradeEtag`). */
  etag: string;
}

export interface TradeRepository {
  list(): StoredTrade[];
  get(id: string): StoredTrade | undefined;
  create(trade: Trade): StoredTrade;
  update(trade: Trade): StoredTrade;
  upsert(trade: Trade): StoredTrade;
  delete(id: string): boolean;
  clear(): void;
}

/**
 * Strong ETag of a stored trade: `"version-hash"` over the canonical JSON (`stableStringify`)
 * of the trade. The representation `GET /api/trades/:id` returns is a deterministic function of
 * version and content, so a strong validator is correct – and only a strong ETag may satisfy
 * `If-Match` under RFC 9110 §13.1.1 (N5-03; the earlier `W/"…"` form could never legally match).
 */
export function tradeEtag(version: number, trade: Trade): string {
  const h = createHash("sha256").update(stableStringify(trade)).digest("hex").slice(0, 16);
  return `"${version}-${h}"`;
}

export class TradeStore implements TradeRepository {
  private trades = new Map<string, StoredTrade>();

  list(): StoredTrade[] {
    return [...this.trades.values()];
  }
  get(id: string): StoredTrade | undefined {
    return this.trades.get(id);
  }
  create(trade: Trade): StoredTrade {
    if (this.trades.has(trade.id)) throw Object.assign(new Error(`Trade ${trade.id} already exists`), { statusCode: 409 });
    return this.upsert(trade);
  }
  update(trade: Trade): StoredTrade {
    if (!this.trades.has(trade.id)) throw Object.assign(new Error(`Trade ${trade.id} not found`), { statusCode: 404 });
    return this.upsert(trade);
  }
  upsert(trade: Trade): StoredTrade {
    const now = new Date().toISOString();
    const prev = this.trades.get(trade.id);
    const version = (prev?.version ?? 0) + 1;
    const stored: StoredTrade = {
      trade,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      version,
      etag: tradeEtag(version, trade),
    };
    this.trades.set(trade.id, stored);
    return stored;
  }
  delete(id: string): boolean {
    return this.trades.delete(id);
  }
  clear(): void {
    this.trades.clear();
  }
}

/** Append-only audit log with a hash chain (each entry hashes the previous entry). */
export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  details?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  append(e: Omit<AuditEntry, "seq" | "at" | "prevHash" | "hash">): AuditEntry {
    const prev = this.entries[this.entries.length - 1];
    const seq = (prev?.seq ?? 0) + 1;
    const at = new Date().toISOString();
    const prevHash = prev?.hash ?? "0".repeat(64);
    const hash = createHash("sha256")
      .update(stableStringify({ seq, at, prevHash, ...e }))
      .digest("hex");
    const entry: AuditEntry = { seq, at, prevHash, hash, ...e };
    this.entries.push(entry);
    return entry;
  }
  list(limit = 200): AuditEntry[] {
    return this.entries.slice(-limit);
  }
  /** Verify the chain; returns the first broken sequence number or null. */
  verify(): number | null {
    let prevHash = "0".repeat(64);
    for (const e of this.entries) {
      const { hash, prevHash: ph, ...rest } = e;
      if (ph !== prevHash) return e.seq;
      const expected = createHash("sha256")
        .update(stableStringify({ ...rest, prevHash: ph }))
        .digest("hex");
      if (expected !== hash) return e.seq;
      prevHash = hash;
    }
    return null;
  }
}

/** Demo portfolio representative of a Mittelstand treasury / Sparkasse customer book. */
export function samplePortfolio(valuationDate: number): Trade[] {
  const cal = getCalendar("TARGET");
  const spot = advance(valuationDate, "2D", cal);
  return [
    makeVanillaSwap({
      id: "IRS-0001",
      name: "Payer-Swap Kredit Halle A",
      currency: "EUR",
      notional: 10_000_000,
      payReceiveFixed: "Pay",
      fixedRate: 0.0315,
      effectiveDate: parseISO("2024-06-17"),
      maturity: "10Y",
      counterparty: "CPTY-A",
    }),
    makeVanillaSwap({
      id: "IRS-0002",
      name: "Receiver-Swap Anleihe",
      currency: "EUR",
      notional: 5_000_000,
      payReceiveFixed: "Receive",
      fixedRate: 0.0245,
      effectiveDate: spot,
      maturity: "5Y",
      counterparty: "CPTY-B",
    }),
    makeVanillaSwap({
      id: "OIS-0001",
      name: "€STR OIS 2Y",
      currency: "EUR",
      notional: 25_000_000,
      payReceiveFixed: "Pay",
      fixedRate: 0.0218,
      effectiveDate: spot,
      maturity: "2Y",
      index: "ESTR",
      counterparty: "CPTY-A",
    }),
    makeCapFloor({
      id: "CAP-0001",
      currency: "EUR",
      notional: 8_000_000,
      capFloor: "Cap",
      strike: 0.03,
      effectiveDate: spot,
      maturity: "5Y",
      counterparty: "CPTY-A",
    }),
    makeCapFloor({
      id: "COL-0001",
      currency: "EUR",
      notional: 6_000_000,
      capFloor: "Collar",
      strike: 0.035,
      floorStrike: 0.015,
      effectiveDate: spot,
      maturity: "7Y",
      counterparty: "CPTY-B",
    }),
    makeSwaption({
      id: "SWPT-0001",
      currency: "EUR",
      notional: 10_000_000,
      payerReceiver: "Payer",
      strike: 0.03,
      expiry: "1Y",
      tenor: "5Y",
      valuationDate,
      counterparty: "CPTY-A",
    }),
    makeFxForward({ id: "FXF-0001", pair: "EURUSD", baseAmount: -2_000_000, rate: 1.1725, deliveryDate: parseISO("2027-03-15"), counterparty: "CPTY-B" }),
    makeFxForward({ id: "FXF-0002", pair: "EURGBP", baseAmount: 1_500_000, rate: 0.859, deliveryDate: parseISO("2026-12-15"), counterparty: "CPTY-B" }),
    makeFxOption({
      id: "FXO-0001",
      pair: "EURUSD",
      optionType: "Put",
      notional: 3_000_000,
      strike: 1.15,
      expiryDate: parseISO("2027-06-15"),
      counterparty: "CPTY-A",
    }),
    makeFxOption({
      id: "FXO-0002",
      pair: "EURCHF",
      optionType: "Call",
      notional: 2_000_000,
      strike: 0.95,
      expiryDate: parseISO("2027-03-15"),
      counterparty: "CPTY-B",
    }),
  ];
}

/** Safe filename fragment for Content-Disposition (prevents header injection). */
export function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "export";
}
