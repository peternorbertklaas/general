import { createHash } from "node:crypto";
import {
  type Curve,
  type CustomCalendarJson,
  type Fixing,
  type MarketContext,
  type ParRiskSpecs,
  type RateIndex,
  type SampleMarketQuotes,
  type SwapConventions,
  type Trade,
  SAMPLE_CURVE_IDS,
  SAMPLE_QUOTES,
  advance,
  bootstrapCurve,
  buildSampleMarket,
  customCalendarFromJson,
  getCalendar,
  hashString,
  isBuiltInCalendar,
  knownCurrencies,
  knownIndices,
  makeCapFloor,
  makeFxForward,
  makeFxOption,
  makeSwaption,
  makeVanillaSwap,
  marketSnapshotId,
  parseISO,
  registerCalendar,
  registerRateIndex,
  registerSwapConventions,
  rollMarket,
  sampleBootstrapSpecs,
  sampleFixings,
  stableStringify,
  toISO,
} from "@deriva/pricing-core";

export type { CustomCalendarJson };
import { type BootstrapBody, type RuntimeCurveQuotes, resolveBootstrap, toCurveBuildSpec } from "./curve-specs.js";

/** Vol surfaces set through `PUT /api/market` (per key) – re-applied after a sample-market rebuild (N8-01). */
export type VolOverrides = Pick<MarketContext, "swaptionVols" | "capletVols" | "fxVols">;

/** Where the active market comes from: the built-in sample market or an imported snapshot (`PUT /api/market/snapshot`). */
export type MarketSource = "sample" | "import";

export interface RebuildOptions {
  /** Import mode only: drop the imported snapshot and rebuild the sample market for the new date instead of rolling the import. */
  discardImport?: boolean;
}

export interface RebuildResult {
  market: MarketContext;
  /** `MARKET_STATE_DROPPED:` entries – everything of the previous market state the rebuild could not carry over. */
  warnings: string[];
}

/** Prefix of the `warnings[]` entries naming state a valuation-date change had to drop (Architektur N8-01). */
export const MARKET_STATE_DROPPED_PREFIX = "MARKET_STATE_DROPPED";

/**
 * In-memory repositories behind small interfaces. The API is stateless by
 * design; persistence is an adapter concern (see ADR-006) – a database-backed
 * implementation replaces these classes without touching routes.
 */
export interface MarketRepository {
  get(): MarketContext;
  set(ctx: MarketContext): void;
  /** Replace the market with an imported snapshot (import mode: a valuation-date change rolls it instead of rebuilding the sample market). */
  setImported(ctx: MarketContext): void;
  /** Origin of the active market. */
  source(): MarketSource;
  /**
   * Move the market to a new valuation date (N8-01). Sample mode: rebuild the sample market and carry over user
   * state – runtime curves are re-bootstrapped from their remembered quotes, discount / collateral mappings and vol
   * overrides re-applied, user fixings, FX fixings, spots, spot dates, credit and the fixing policy kept; a
   * re-bootstrapped runtime curve gets the discount-curve rule of `POST /api/market/curves` again (N9-03). Import
   * mode: roll the imported market (`rollMarket`, constant zero curves; `meta.snapshotTime` dropped and the label
   * marked `(rolled to <date>)`, N9-02) unless `discardImport` asks for the sample market. Whatever cannot be
   * carried over is named in `warnings` (`MARKET_STATE_DROPPED:`).
   */
  rebuild(valuationDate: number, opts?: RebuildOptions): RebuildResult;
  /** Current market quotes per sample curve (basis for par-risk re-bootstrapping and rebuilds). */
  getQuotes(): SampleMarketQuotes;
  /**
   * Remember the bootstrap body of a curve stored via `POST /api/market/curves`: a sample curve id updates its quote
   * set, any other id is kept as a runtime curve (re-bootstrapped on rebuild, bumped by par risk). Always tracked.
   */
  rememberCurve(body: BootstrapBody): void;
  /**
   * Remember the bootstrap spec of a curve the imported snapshot carries in its `quotes` envelope (Markt R9-1): the
   * curve stays the snapshot's, the spec serves par risk (`parRiskSpecs`) and a later sample rebuild.
   */
  rememberQuotes(entry: RuntimeCurveQuotes): void;
  /** Runtime curves with remembered quotes in load order – the snapshot envelope's `quotes` (R9-1). */
  listQuotes(): RuntimeCurveQuotes[];
  /** Remember vol surfaces set per key through `PUT /api/market` so a sample-market rebuild re-applies them. */
  rememberVols(vols: VolOverrides): void;
  /** Bootstrap specs of every curve with known quotes (sample curves + runtime curves) for `parRisk`. */
  parRiskSpecs(): ParRiskSpecs;
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
);

const dropped = (what: string): string => `${MARKET_STATE_DROPPED_PREFIX}: ${what}`;

export class MarketStore implements MarketRepository {
  private ctx: MarketContext;
  private quotes: SampleMarketQuotes;
  private origin: MarketSource = "sample";
  /**
   * Curves stored via `POST /api/market/curves` that are not sample curves, in insertion order (a later curve may
   * reference an earlier one). The body – not the curve – is remembered: a rebuild re-bootstraps from the quotes.
   */
  private runtimeCurves = new Map<string, BootstrapBody>();
  /** Vol surfaces set per key through `PUT /api/market` (sample mode: re-applied after a rebuild). */
  private volOverrides: VolOverrides = {};
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
  setImported(ctx: MarketContext): void {
    // The snapshot replaces every curve and surface; what was remembered for the previous market is gone with it.
    this.ctx = ctx;
    this.origin = "import";
    this.runtimeCurves.clear();
    this.volOverrides = {};
  }
  source(): MarketSource {
    return this.origin;
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
  rememberCurve(body: BootstrapBody): void {
    const key = QUOTE_KEY_BY_CURVE[body.spec.id];
    if (key) {
      this.quotes = { ...this.quotes, [key]: body.spec.quotes };
      return;
    }
    // Re-insert so the order stays "latest definition last" (dependencies were stored before their dependants).
    this.runtimeCurves.delete(body.spec.id);
    this.runtimeCurves.set(body.spec.id, { spec: body.spec, ...(body.isDiscountCurve !== undefined ? { isDiscountCurve: body.isDiscountCurve } : {}) });
  }
  rememberQuotes(entry: RuntimeCurveQuotes): void {
    // Same slot as a curve loaded through `POST /api/market/curves`; the id is the curve's (validated by `quotesProblems`).
    this.runtimeCurves.delete(entry.curveId);
    this.runtimeCurves.set(entry.curveId, { spec: { ...entry.spec, id: entry.curveId } });
  }
  listQuotes(): RuntimeCurveQuotes[] {
    return [...this.runtimeCurves].map(([curveId, body]) => ({ curveId, spec: body.spec }));
  }
  rememberVols(vols: VolOverrides): void {
    this.volOverrides = {
      ...(vols.swaptionVols || this.volOverrides.swaptionVols
        ? { swaptionVols: { ...(this.volOverrides.swaptionVols ?? {}), ...(vols.swaptionVols ?? {}) } }
        : {}),
      ...(vols.capletVols || this.volOverrides.capletVols ? { capletVols: { ...(this.volOverrides.capletVols ?? {}), ...(vols.capletVols ?? {}) } } : {}),
      ...(vols.fxVols || this.volOverrides.fxVols ? { fxVols: { ...(this.volOverrides.fxVols ?? {}), ...(vols.fxVols ?? {}) } } : {}),
    };
  }
  parRiskSpecs(): ParRiskSpecs {
    const specs: ParRiskSpecs = { ...sampleBootstrapSpecs(this.ctx.valuationDate, this.quotes) };
    for (const [id, body] of this.runtimeCurves) specs[id] = toCurveBuildSpec(body.spec);
    return specs;
  }
  rebuild(valuationDate: number, opts: RebuildOptions = {}): RebuildResult {
    const prev = this.ctx;
    const warnings: string[] = [];
    if (this.origin === "import" && !opts.discardImport) {
      // Import mode: the snapshot is the market – roll its curves to the new date (constant zero curves, the core's
      // theta roll); spots, fixings, vols, mappings and credit stay as imported. Nothing is dropped – except the
      // snapshot's own timestamp (N9-02): `meta.snapshotTime` described the imported state, not the rolled one, and
      // would put EMIR field 23 months before the valuation date; the label says what happened.
      const rolled = rollMarket(prev, valuationDate - prev.valuationDate);
      this.ctx = { ...rolled, meta: rolledMeta(rolled.meta, valuationDate) };
      return { market: this.ctx, warnings };
    }
    if (this.origin === "import") {
      warnings.push(
        dropped(
          `imported snapshot ${prev.meta?.label ? `"${prev.meta.label}" ` : ""}(${this.snapshotId()}) discarded – sample market rebuilt for ${toISO(valuationDate)}`,
        ),
      );
      this.origin = "sample";
    }
    const fresh = buildSampleMarket(valuationDate, { ...this.quotes, fxSpots: { ...this.quotes.fxSpots, ...prev.fxSpots } });
    let m: MarketContext = {
      ...fresh,
      fixings: rebuiltFixings(prev, fresh),
      // FX fixings of past MtM-reset dates are history, not sample-market data – they survive a valuation-date change.
      ...(prev.fxFixings ? { fxFixings: prev.fxFixings } : {}),
      credit: prev.credit ?? fresh.credit,
      ...(prev.fxSpotDates ? { fxSpotDates: prev.fxSpotDates } : {}),
      ...(prev.missingFixingPolicy ? { missingFixingPolicy: prev.missingFixingPolicy } : {}),
    };
    // Runtime curves (`POST /api/market/curves` or the `quotes` envelope, N8-01): re-bootstrap from the remembered quotes, in insertion order.
    const rebuilt: { curve: Curve; body: BootstrapBody }[] = [];
    for (const [id, body] of [...this.runtimeCurves]) {
      try {
        const { spec } = resolveBootstrap(m, body);
        const curve: Curve = bootstrapCurve(valuationDate, spec).curve;
        m = { ...m, curves: { ...m.curves, [curve.id]: curve } };
        rebuilt.push({ curve, body });
      } catch (e) {
        this.runtimeCurves.delete(id);
        warnings.push(dropped(`curve ${id} could not be re-bootstrapped for ${toISO(valuationDate)} (${(e as Error).message})`));
      }
    }
    // Discount / collateral mappings of the previous market survive where their curve still exists.
    const discountCurveId = { ...m.discountCurveId };
    const lostDiscount: [string, string][] = [];
    for (const [ccy, curveId] of Object.entries(prev.discountCurveId)) {
      if (m.curves[curveId]) discountCurveId[ccy] = curveId;
      else if (!fresh.discountCurveId[ccy]) lostDiscount.push([ccy, curveId]);
    }
    // N9-03: a re-bootstrapped runtime curve gets the rule of `POST /api/market/curves` again – `isDiscountCurve: false`
    // never, otherwise "first curve of a currency without a discount curve" (in load order). An explicit `true` set the
    // mapping when the curve was loaded and it was carried over above; a mapping changed later through `PUT /api/market`
    // is not overridden here.
    for (const { curve, body } of rebuilt) {
      if (body.isDiscountCurve !== false && !discountCurveId[curve.currency]) discountCurveId[curve.currency] = curve.id;
    }
    for (const [ccy, curveId] of lostDiscount) {
      const replacement = discountCurveId[ccy];
      warnings.push(
        dropped(
          `discountCurveId.${ccy} = ${curveId} (curve not in the rebuilt market${replacement ? `; ${replacement} is now the discount curve of ${ccy}` : ""})`,
        ),
      );
    }
    const collateralDiscountCurveId = { ...(m.collateralDiscountCurveId ?? {}) };
    for (const [key, curveId] of Object.entries(prev.collateralDiscountCurveId ?? {})) {
      if (m.curves[curveId]) collateralDiscountCurveId[key] = curveId;
      else if (!fresh.collateralDiscountCurveId?.[key])
        warnings.push(dropped(`collateralDiscountCurveId.${key} = ${curveId} (curve not in the rebuilt market)`));
    }
    m = { ...m, discountCurveId, ...(Object.keys(collateralDiscountCurveId).length ? { collateralDiscountCurveId } : {}) };
    // Vol overrides (`PUT /api/market { swaptionVols | capletVols | fxVols }`) are plain data – re-apply per key.
    const o = this.volOverrides;
    if (o.swaptionVols) m = { ...m, swaptionVols: { ...(m.swaptionVols ?? {}), ...o.swaptionVols } };
    if (o.capletVols) m = { ...m, capletVols: { ...(m.capletVols ?? {}), ...o.capletVols } };
    if (o.fxVols) m = { ...m, fxVols: { ...(m.fxVols ?? {}), ...o.fxVols } };
    this.ctx = m;
    return { market: m, warnings };
  }
}

/** Label suffix of a rolled import (`… (rolled to 2026-12-01)`); a second roll replaces the first mark. */
const ROLLED_SUFFIX_RE = / \(rolled to \d{4}-\d{2}-\d{2}\)$/;

/**
 * Snapshot metadata after an import roll (N9-02), the same rule the core's `rollMarket` applies since R9 (kept here
 * so the API's contract holds against any core version): `meta.snapshotTime` is dropped unless it already dates the
 * new valuation date – it timestamps the imported state, not the rolled one, and `emirValuationTimestamp` would
 * prefer it over the new date (field 23) – and an existing label is marked `(rolled to <date>)`. Idempotent: a
 * label the core already marked, or one marked by an earlier roll, carries a single mark for the latest date.
 * `source` and other keys are kept; a snapshot without a label gets none.
 */
export function rolledMeta(meta: MarketContext["meta"], valuationDate: number): NonNullable<MarketContext["meta"]> {
  const iso = toISO(valuationDate);
  const { snapshotTime, label, ...rest } = meta ?? {};
  const out: NonNullable<MarketContext["meta"]> = { ...rest };
  if (snapshotTime !== undefined && snapshotTime.slice(0, 10) === iso) out.snapshotTime = snapshotTime;
  if (label !== undefined) out.label = `${label.replace(ROLLED_SUFFIX_RE, "")} (rolled to ${iso})`;
  return out;
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
/**
 * Canonical ids of the calendars shipped with the engine (rule-based; `getCalendar` also knows their aliases such as
 * `EUR`, `USNY`, `GBLO` – `isBuiltInCalendar` of the core covers ids and aliases). The list is probed against the core,
 * so a calendar the core adds later is listed as soon as it resolves.
 */
const BUILT_IN_CALENDAR_CANDIDATES = ["TARGET", "DE", "US", "US-SIFMA", "UK", "CH", "JP", "NO", "SE", "DK", "PL", "WEEKEND"] as const;

/** Built-in calendar ids the core ships (canonical names, aliases excluded) – `GET /api/market` `calendars`. */
export function builtInCalendarIds(): string[] {
  return BUILT_IN_CALENDAR_CANDIDATES.filter((id) => {
    try {
      return isBuiltInCalendar(id) && getCalendar(id) !== undefined;
    } catch {
      return false;
    }
  });
}

export class RegisterStore {
  private indices = new Map<string, RateIndex>();
  private conventions = new Map<string, SwapConventions>();
  private calendars = new Map<string, CustomCalendarJson>();
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
  /**
   * Register a custom calendar (Markt R8-2) through the core's JSON form (`customCalendarFromJson` validates –
   * `PricingError("INVALID_CALENDAR")` for a built-in id or a malformed list, `INVALID_DATE` for a non-existent date
   * such as `2027-02-30` – and `registerCalendar` stores it under the upper-cased id). `replaced` = a runtime calendar
   * of the same id was registered through this instance before. The stored JSON is the core's `toJSON()` form
   * (holidays sorted, `name` defaulting to the id, `weekendsAreHolidays` explicit).
   */
  registerCalendar(def: CustomCalendarJson): { calendar: CustomCalendarJson; replaced: boolean } {
    const cal = customCalendarFromJson({ ...def, id: def.id.trim().toUpperCase() });
    registerCalendar(cal);
    const calendar = cal.toJSON();
    const replaced = this.calendars.has(calendar.id);
    this.calendars.set(calendar.id, calendar);
    return { calendar, replaced };
  }
  /** True when `id` is a calendar shipped with the engine or one of its aliases (core `isBuiltInCalendar`) – never replaceable. */
  isBuiltInCalendar(id: string): boolean {
    return isBuiltInCalendar(id);
  }
  /** Indices registered through this API instance (sorted by name). */
  listIndices(): RateIndex[] {
    return [...this.indices.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Conventions registered through this API instance (sorted by currency). */
  listConventions(): SwapConventions[] {
    return [...this.conventions.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }
  /** Calendars registered through this API instance (sorted by id). */
  listCalendars(): CustomCalendarJson[] {
    return [...this.calendars.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  /**
   * Hash of the envelope as exported with the snapshot (N8-03): the register plus – since R9-1 – the `quotes` of
   * the market store's runtime curves. Neither is part of the market's snapshot id, but both are part of the
   * `GET /api/market/snapshot` representation – so the export ETag carries them. Empty string when the envelope is
   * empty (an untouched export keeps `ETag = "<snapshotId>"`).
   */
  hash(quotes: RuntimeCurveQuotes[] = []): string {
    const indices = this.listIndices();
    const conventions = this.listConventions();
    const calendars = this.listCalendars();
    if (!indices.length && !conventions.length && !calendars.length && !quotes.length) return "";
    return hashString(stableStringify({ indices, conventions, calendars, quotes })).slice(0, 16);
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
