/**
 * Register envelope of a workstation / API snapshot (Markt R8-1 / R8-2): the
 * `indices`, `conventions` and `calendars` a snapshot carries beside the
 * `deriva.market/1` document. The web app validates the envelope (German
 * messages, every entry before the first registration – Architektur N8-04),
 * registers it in the core register *before* the market is deserialised, keeps
 * it in the persisted snapshot so a reload re-registers, and exports the same
 * envelope from the workstation (runtime-registered indices / conventions /
 * custom calendars) – so a CZK registered via the API prices in the
 * workstation and a currency added with "+ Währung" travels with the file.
 *
 * Validation and registration are the core's (`validateRateIndex`,
 * `validateSwapConventions`, `validateCustomCalendar`, `registerCalendar(json)`,
 * `isBuiltInCalendar`, `listCustomCalendars`); this module adds the envelope
 * semantics (cross references inside the envelope, German texts, export).
 */
import {
  type CustomCalendarJson,
  type MarketSnapshotJson,
  type RateIndex,
  type SwapConventions,
  RATE_INDICES,
  SWAP_CONVENTIONS,
  getCalendar,
  isBuiltInCalendar,
  isBuiltInIndex,
  knownIndices,
  listCustomCalendars,
  registerCalendar,
  registerRateIndex,
  registerSwapConventions,
  validateCustomCalendar,
  validateRateIndex,
  validateSwapConventions,
} from "@deriva/pricing-core";
import { translatePricingError, translateRegisterDetail } from "./i18n.js";

export { type CustomCalendarJson, isBuiltInCalendar, listCustomCalendars };

export interface RegisterEnvelope {
  indices?: RateIndex[];
  conventions?: SwapConventions[];
  calendars?: CustomCalendarJson[];
}

/** A `deriva.market/1` document plus the register envelope (API `ApiMarketSnapshot`, workstation export). */
export type WorkstationSnapshotJson = MarketSnapshotJson & RegisterEnvelope;

/** Currencies whose conventions ship with the engine (frozen at module load – registrations happen later). */
const BUILT_IN_CURRENCIES: ReadonlySet<string> = new Set(Object.keys(SWAP_CONVENTIONS));
/** Conventions registered through this module (currency codes) – exported even when they override a built-in currency. */
const registeredConventions = new Set<string>();

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const up = (s: unknown) => (isStr(s) ? s.trim().toUpperCase() : "");

/** German label of an envelope entry ("Index „CZEONIA“", "Index Nr. 2"). */
const entryLabel = (what: string, name: unknown, i: number) => (isStr(name) ? `${what} „${name}“` : `${what} Nr. ${i + 1}`);

/** True when `id` resolves in the calendar registry (built in, custom or joint). */
function calendarKnown(id: string): boolean {
  try {
    getCalendar(id);
    return true;
  } catch {
    return false;
  }
}

/** Core problems (English list) → one German line. */
const problems = (list: string[]): string | undefined => (list.length ? list.map(translateRegisterDetail).join("; ") : undefined);

function calendarProblem(c: unknown, i: number): string | undefined {
  const label = entryLabel("Kalender", isObj(c) ? c.id : undefined, i);
  if (!isObj(c)) return `${label} ist kein Objekt`;
  if (isStr(c.id) && isBuiltInCalendar(c.id))
    return `${label} ist im Kern eingebaut und kann nicht ersetzt werden – Eintrag aus „calendars“ entfernen oder unter neuer ID registrieren`;
  const p = problems(validateCustomCalendar(c));
  return p ? `${label}: ${p}` : undefined;
}

/**
 * Index problems: built-in name, structure and – via the core – day count, calendar, lags. A calendar that is part of
 * the same envelope is not registered yet, so the core check runs against a placeholder for it.
 */
function indexProblem(ix: unknown, i: number, pendingCalendars: Set<string>): string | undefined {
  const label = entryLabel("Index", isObj(ix) ? ix.name : undefined, i);
  if (!isObj(ix)) return `${label} ist kein Objekt`;
  if (isStr(ix.name) && isBuiltInIndex(ix.name))
    return `${label} ist im Kern eingebaut und kann nicht ersetzt werden – Eintrag aus „indices“ entfernen oder die Variante unter neuem Namen registrieren`;
  const cal = up(ix.fixingCalendar);
  if (cal && !pendingCalendars.has(cal) && !calendarKnown(cal))
    return `${label}: Kalender „${ix.fixingCalendar as string}“ ist nicht registriert – im Envelope unter „calendars“ mitliefern oder in der Kurvenansicht mit „+ Kalender“ anlegen`;
  const probe = pendingCalendars.has(cal) ? { ...ix, fixingCalendar: "TARGET" } : ix;
  const p = problems(validateRateIndex(probe));
  return p ? `${label}: ${p}` : undefined;
}

/** Conventions problems via the core, with the envelope's own indices as `pendingIndices` and its calendars as placeholders. */
function conventionsProblem(conv: unknown, i: number, pendingIndices: RateIndex[], pendingCalendars: Set<string>): string | undefined {
  const label = entryLabel("Konventionen", isObj(conv) ? conv.currency : undefined, i);
  if (!isObj(conv)) return `${label} sind kein Objekt`;
  const cal = up(conv.calendar);
  if (cal && !pendingCalendars.has(cal) && !calendarKnown(cal))
    return `${label}: Kalender „${conv.calendar as string}“ ist nicht registriert – im Envelope unter „calendars“ mitliefern oder in der Kurvenansicht mit „+ Kalender“ anlegen`;
  const probe = pendingCalendars.has(cal) ? { ...conv, calendar: "TARGET" } : conv;
  const p = problems(validateSwapConventions(probe, { pendingIndices }));
  return p ? `${label}: ${p}` : undefined;
}

/** The envelope part of a snapshot (arrays only when present). */
export function envelopeOf(json: unknown): RegisterEnvelope {
  if (!isObj(json)) return {};
  const out: RegisterEnvelope = {};
  if (Array.isArray(json.indices) && json.indices.length) out.indices = json.indices as RateIndex[];
  if (Array.isArray(json.conventions) && json.conventions.length) out.conventions = json.conventions as SwapConventions[];
  if (Array.isArray(json.calendars) && json.calendars.length) out.calendars = json.calendars as CustomCalendarJson[];
  return out;
}

export function envelopeEmpty(env: RegisterEnvelope | undefined): boolean {
  return !env || (!env.indices?.length && !env.conventions?.length && !env.calendars?.length);
}

/**
 * Validate an envelope without registering anything: shape, built-in names
 * (indices / calendars – conventions of a built-in currency may be overridden),
 * cross references (index → calendar, conventions → indices, both possibly
 * inside the envelope). Returns the German problem or `undefined`.
 */
export function validateEnvelope(env: RegisterEnvelope): string | undefined {
  for (const key of ["indices", "conventions", "calendars"] as const)
    if (env[key] !== undefined && !Array.isArray(env[key])) return `Snapshot-Envelope: Feld „${key}“ muss eine Liste sein`;
  const pendingCalendars = new Set<string>();
  for (const [i, c] of (env.calendars ?? []).entries()) {
    const p = calendarProblem(c, i);
    if (p) return `Snapshot-Envelope: ${p}`;
    pendingCalendars.add(up((c as CustomCalendarJson).id));
  }
  const pendingIndices: RateIndex[] = [];
  for (const [i, ix] of (env.indices ?? []).entries()) {
    const p = indexProblem(ix, i, pendingCalendars);
    if (p) return `Snapshot-Envelope: ${p}`;
    const d = ix as RateIndex;
    pendingIndices.push({ ...d, name: up(d.name), currency: up(d.currency) });
  }
  for (const [i, conv] of (env.conventions ?? []).entries()) {
    const p = conventionsProblem(conv, i, pendingIndices, pendingCalendars);
    if (p) return `Snapshot-Envelope: ${p}`;
  }
  return undefined;
}

export interface RegisteredEnvelope {
  indices: string[];
  conventions: string[];
  calendars: string[];
}

/**
 * Validate every entry, then register calendars → indices → conventions.
 * Returns what was registered or the German problem; nothing is registered
 * when the validation fails (atomic import as far as the register allows).
 */
export function registerEnvelope(env: RegisterEnvelope): { ok: true; registered: RegisteredEnvelope } | { ok: false; error: string } {
  const problem = validateEnvelope(env);
  if (problem) return { ok: false, error: problem };
  const registered: RegisteredEnvelope = { indices: [], conventions: [], calendars: [] };
  try {
    for (const c of env.calendars ?? []) registered.calendars.push(registerCalendar({ ...c, id: up(c.id) }).name);
    for (const ix of env.indices ?? []) registered.indices.push(registerRateIndex(ix).name);
    for (const conv of env.conventions ?? []) {
      registered.conventions.push(registerSwapConventions(conv).currency);
      registeredConventions.add(up(conv.currency));
    }
  } catch (e) {
    return { ok: false, error: `Snapshot-Envelope: ${translatePricingError(e)}` };
  }
  return { ok: true, registered };
}

/**
 * Remove runtime registrations again (undo of "+ Währung"): non-built-in indices
 * and conventions of the envelope are dropped from the core register; custom
 * calendars stay (the registry has no removal and a registered calendar is harmless).
 */
export function unregisterEnvelope(env: RegisterEnvelope): void {
  for (const conv of env.conventions ?? []) {
    const ccy = up(conv.currency);
    if (!BUILT_IN_CURRENCIES.has(ccy)) delete SWAP_CONVENTIONS[ccy];
    registeredConventions.delete(ccy);
  }
  for (const ix of env.indices ?? []) {
    const name = up(ix.name);
    if (!isBuiltInIndex(name)) delete RATE_INDICES[name];
  }
}

/** Whether `ccy` has swap conventions in the register (built in or registered at runtime). */
export function hasConventions(ccy: string): boolean {
  return SWAP_CONVENTIONS[up(ccy)] !== undefined;
}

/** True when the currency's conventions ship with the engine. */
export function isBuiltInCurrency(ccy: string): boolean {
  return BUILT_IN_CURRENCIES.has(up(ccy));
}

/**
 * The workstation's export envelope: every runtime-registered index, the
 * conventions of every non-built-in (or explicitly registered) currency and
 * every custom calendar. Empty groups are omitted so a plain sample market
 * exports the bare `deriva.market/1` document as before.
 */
export function exportEnvelope(): RegisterEnvelope {
  const indices = knownIndices().filter((i) => !isBuiltInIndex(i.name));
  const conventions = Object.values(SWAP_CONVENTIONS).filter((c) => !BUILT_IN_CURRENCIES.has(c.currency) || registeredConventions.has(c.currency));
  const calendars = listCustomCalendars();
  const out: RegisterEnvelope = {};
  if (indices.length) out.indices = indices.map((i) => ({ ...i }));
  if (conventions.length) out.conventions = conventions.map((c) => ({ ...c }));
  if (calendars.length) out.calendars = calendars.map((c) => ({ ...c, holidays: [...c.holidays] }));
  return out;
}

/** German one-liner of an envelope ("2 Indizes CZEONIA, PRIBOR-6M · Konventionen CZK · Kalender CZ"). */
export function envelopeSummary(env: RegisterEnvelope): string {
  const parts: string[] = [];
  if (env.indices?.length)
    parts.push(`${env.indices.length === 1 ? "Index" : `${env.indices.length} Indizes`} ${env.indices.map((i) => up(i.name)).join(", ")}`);
  if (env.conventions?.length) parts.push(`Konventionen ${env.conventions.map((c) => up(c.currency)).join(", ")}`);
  if (env.calendars?.length) parts.push(`Kalender ${env.calendars.map((c) => up(c.id)).join(", ")}`);
  return parts.join(" · ");
}

/** Persisted envelope check: keep only entries with the identifying string field; everything else is dropped. */
export function plausibleEnvelope(v: unknown): RegisterEnvelope {
  if (!isObj(v)) return {};
  const out: RegisterEnvelope = {};
  if (Array.isArray(v.indices)) {
    const list = v.indices.filter((x): x is RateIndex => isObj(x) && isStr(x.name) && isStr(x.currency));
    if (list.length) out.indices = list;
  }
  if (Array.isArray(v.conventions)) {
    const list = v.conventions.filter((x): x is SwapConventions => isObj(x) && isStr(x.currency));
    if (list.length) out.conventions = list;
  }
  if (Array.isArray(v.calendars)) {
    const list = v.calendars.filter((x): x is CustomCalendarJson => isObj(x) && isStr(x.id) && Array.isArray(x.holidays));
    if (list.length) out.calendars = list;
  }
  return out;
}

/** Merge two envelopes (later entries replace earlier ones with the same name / currency / id). */
export function mergeEnvelopes(a: RegisterEnvelope, b: RegisterEnvelope): RegisterEnvelope {
  const byKey = <T>(list: T[] | undefined, more: T[] | undefined, key: (x: T) => string): T[] | undefined => {
    const m = new Map<string, T>();
    for (const x of [...(list ?? []), ...(more ?? [])]) m.set(key(x), x);
    return m.size ? [...m.values()] : undefined;
  };
  const out: RegisterEnvelope = {};
  const indices = byKey(a.indices, b.indices, (i) => up(i.name));
  const conventions = byKey(a.conventions, b.conventions, (c) => up(c.currency));
  const calendars = byKey(a.calendars, b.calendars, (c) => up(c.id));
  if (indices) out.indices = indices;
  if (conventions) out.conventions = conventions;
  if (calendars) out.calendars = calendars;
  return out;
}

/** Envelope without the entries of `remove` (by name / currency / id). */
export function envelopeWithout(env: RegisterEnvelope, remove: RegisterEnvelope): RegisterEnvelope {
  const out: RegisterEnvelope = {};
  const ix = (env.indices ?? []).filter((i) => !(remove.indices ?? []).some((r) => up(r.name) === up(i.name)));
  const cv = (env.conventions ?? []).filter((c) => !(remove.conventions ?? []).some((r) => up(r.currency) === up(c.currency)));
  const cal = (env.calendars ?? []).filter((c) => !(remove.calendars ?? []).some((r) => up(r.id) === up(c.id)));
  if (ix.length) out.indices = ix;
  if (cv.length) out.conventions = cv;
  if (cal.length) out.calendars = cal;
  return out;
}
