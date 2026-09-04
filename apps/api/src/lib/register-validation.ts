/**
 * Pre-checks the API runs before it touches process-wide state (Architektur N8-02 / N8-04, Markt R8-2).
 *
 * - `envelopeProblems`: the snapshot envelope (`calendars`, `indices`, `conventions`) is validated as a whole
 *   with the core's own validators (`validateCustomCalendar`, `validateRateIndex`, `validateSwapConventions`
 *   with `pendingIndices`) before a single entry is registered, so a bad second entry registers nothing (the
 *   core register is additive and has no rollback). Calendars that are themselves part of the envelope are
 *   not registered yet when the indices and conventions are checked – for those checks the envelope's
 *   calendar ids are substituted by a known calendar, the ids having been validated with their own entry;
 *   composite ids (`CZ-X9+TARGET`) are substituted per component (N9-01), so an export with joint calendars
 *   re-imports into a fresh process.
 * - `quotesProblems`: the `quotes` envelope (bootstrap specs of runtime curves, Markt R9-1) must name curves of
 *   the snapshot and registered (or envelope) indices.
 * - `collateralMappingProblems`: `collateralDiscountCurveId["<ccy>|<csa>"]` must name a curve of `<ccy>` –
 *   discounting EUR cash flows on a CZK curve moved a 10Y payer by +19 % without a warning (N8-02). The
 *   core's `validateMarket` checks only `discountCurveId`, so the API adds the check for `PUT /api/market`
 *   and the snapshot import.
 * - `withCalendarHint`: the core's "register it with registerCalendar first" points at a function the API
 *   client cannot call – the API names its endpoint.
 */
import {
  type CustomCalendarJson,
  type MarketContext,
  type RateIndex,
  type SwapConventions,
  isBuiltInCalendar,
  knownIndices,
  validateCustomCalendar,
  validateRateIndex,
  validateSwapConventions,
} from "@deriva/pricing-core";
import { type RuntimeCurveQuotes } from "./curve-specs.js";

export const CALENDAR_ENDPOINT_HINT = "register it with POST /api/market/calendars";

/** The core's calendar hint rewritten for API clients (message otherwise unchanged). */
export function withCalendarHint(message: string): string {
  return message.replace(/register it with registerCalendar first/g, CALENDAR_ENDPOINT_HINT);
}

export interface EnvelopeInput {
  calendars?: CustomCalendarJson[];
  indices?: RateIndex[];
  conventions?: SwapConventions[];
}

export interface EnvelopeProblem {
  /** `calendars` | `indices` | `conventions` */
  section: keyof EnvelopeInput;
  /** Calendar id, index name or currency of the entry. */
  entry: string;
  problem: string;
  /** Set when the entry names a built-in calendar / index (never replaceable). */
  builtIn?: boolean;
}

/**
 * A calendar id that is pending in the same envelope is replaced by a calendar the core knows (the id itself is
 * checked with its own entry). Composite ids (`CZ-X9+TARGET`, joint calendar – N9-01) are split at `+`: every
 * pending component is dropped, the known components stay (`CZ-X9+TARGET` → `TARGET`, `CZ-X9+US` → `US`); an id
 * made of pending components only (`CZ-X9`, `CZ-X9+HU-X9`) becomes `TARGET`. Unknown components stay and are
 * reported by the core's validator as before.
 */
export function substitutePendingCalendar(id: string, pending: Set<string>): string {
  const parts = id.split("+");
  if (!parts.some((p) => pending.has(p.trim().toUpperCase()))) return id;
  const kept = parts.filter((p) => !pending.has(p.trim().toUpperCase()));
  return kept.length ? kept.join("+") : "TARGET";
}
const substitute = substitutePendingCalendar;

/**
 * Problems of an envelope as a whole (empty = every entry will register). The rules are the core's
 * (`registerCalendar` / `registerRateIndex` / `registerSwapConventions` would raise the same); the API adds the
 * envelope view – pending calendars and indices count as registered for the entries that follow them.
 */
export function envelopeProblems(env: EnvelopeInput): EnvelopeProblem[] {
  const problems: EnvelopeProblem[] = [];
  const pendingCalendars = new Set<string>();
  (env.calendars ?? []).forEach((cal, i) => {
    const id = String(cal.id ?? "")
      .trim()
      .toUpperCase();
    const builtIn = isBuiltInCalendar(id);
    for (const problem of validateCustomCalendar(cal, `calendars[${i}]`)) {
      problems.push({ section: "calendars", entry: id, problem: withCalendarHint(problem), ...(builtIn ? { builtIn: true } : {}) });
    }
    if (!builtIn) pendingCalendars.add(id);
  });
  const pendingIndices: RateIndex[] = [];
  for (const ix of env.indices ?? []) {
    const name = ix.name.toUpperCase();
    const checked: RateIndex = {
      ...ix,
      fixingCalendar: substitute(ix.fixingCalendar, pendingCalendars),
      ...(ix.paymentCalendar !== undefined ? { paymentCalendar: substitute(ix.paymentCalendar, pendingCalendars) } : {}),
    };
    const found = validateRateIndex(checked).map(withCalendarHint);
    for (const problem of found) problems.push({ section: "indices", entry: name, problem, ...(/built-in index/.test(problem) ? { builtIn: true } : {}) });
    if (!found.length) pendingIndices.push({ ...ix, name, currency: ix.currency.toUpperCase(), tenor: ix.tenor.toUpperCase() });
  }
  for (const conv of env.conventions ?? []) {
    const ccy = conv.currency.toUpperCase();
    const checked: SwapConventions = { ...conv, calendar: substitute(conv.calendar, pendingCalendars) };
    for (const problem of validateSwapConventions(checked, { pendingIndices })) {
      problems.push({
        section: "conventions",
        entry: ccy,
        problem: withCalendarHint(problem).replace(/\(registerRateIndex first\)/, "(add it to the envelope's indices or POST /api/market/indices first)"),
      });
    }
  }
  return problems;
}

/**
 * `problems[]` of the snapshot envelope's `quotes` (Markt R9-1): every entry must name a curve of the snapshot,
 * `spec.id`/`spec.currency` must agree with it, `spec.index` must be a registered index or one of the envelope's
 * `indices` and – R10-1 (5) – denominated in the curve's currency, and no curve may carry two specs. The quotes
 * themselves are taken as given – a spec that does not bootstrap or does not reproduce the curve surfaces at
 * `POST /api/risk/par` (`PAR_RISK_INCONSISTENT:`) or as `MARKET_STATE_DROPPED:` on the next rebuild.
 */
export function quotesProblems(
  m: Pick<MarketContext, "curves">,
  quotes: RuntimeCurveQuotes[],
  pendingIndices: (Pick<RateIndex, "name"> & Partial<Pick<RateIndex, "currency">>)[] = [],
): string[] {
  const problems: string[] = [];
  const known = new Map<string, string | undefined>(knownIndices().map((ix) => [ix.name, ix.currency]));
  for (const ix of pendingIndices) known.set(ix.name.toUpperCase(), ix.currency?.toUpperCase());
  const seen = new Set<string>();
  for (const { curveId, spec } of quotes) {
    const curve = m.curves[curveId];
    if (!curve) problems.push(`quotes: curve ${curveId} is not in the snapshot's curves`);
    else if (spec.currency.toUpperCase() !== curve.currency)
      problems.push(`quotes: curve ${curveId} is denominated in ${curve.currency}, its spec in ${spec.currency}`);
    if (spec.id !== curveId) problems.push(`quotes: curve ${curveId}: spec.id ${spec.id} does not match curveId`);
    const index = spec.index.toUpperCase();
    if (!known.has(index)) {
      problems.push(`quotes: curve ${curveId}: index ${spec.index} is not registered (add it to the envelope's indices or POST /api/market/indices first)`);
    } else {
      const indexCurrency = known.get(index);
      if (curve && indexCurrency !== undefined && indexCurrency !== curve.currency) {
        problems.push(`quotes: curve ${curveId}: index ${index} is denominated in ${indexCurrency}, the curve in ${curve.currency}`);
      }
    }
    if (seen.has(curveId)) problems.push(`quotes: curve ${curveId} has more than one spec`);
    seen.add(curveId);
  }
  return problems;
}

/** `problems[]` of collateral mappings whose curve is missing or denominated in another currency than the key's first currency. */
export function collateralMappingProblems(m: Pick<MarketContext, "curves" | "collateralDiscountCurveId">): string[] {
  const problems: string[] = [];
  for (const [key, curveId] of Object.entries(m.collateralDiscountCurveId ?? {})) {
    const ccy = key.split("|")[0]!;
    const curve = m.curves[curveId];
    if (!curve) problems.push(`Collateral discount curve ${curveId} for ${key} missing`);
    else if (curve.currency !== ccy) problems.push(`Collateral discount curve ${curveId} for ${key} is denominated in ${curve.currency}, not ${ccy}`);
  }
  return problems;
}
