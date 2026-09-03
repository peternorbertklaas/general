import { addTenor, advance, getCalendar, parseISO, toISO } from "@deriva/pricing-core";

/**
 * Flexible date entry for trade fields (F-39): accepts
 *  - ISO ("2027-12-31") and German ("31.12.2027", "31.12.27", "31.12." = current year),
 *  - tenors relative to `base` ("10y", "6m", "2w", "30d", "1y6m"),
 *  - signed tenors relative to the field's current value ("+6m", "-1y"),
 *  - keywords: "heute"/"today" (= base), "spot" (T+2 TARGET), "me"/"monatsende", "je"/"jahresende".
 * Tenor arithmetic uses calendar days on top of `addTenor` (unadjusted);
 * "spot" and business-day variants ("10y!") roll on the TARGET calendar.
 */
export interface DateParseOptions {
  /** Reference date for absolute tenors / keywords (valuation date). */
  base: number;
  /** Current value of the field – reference for "+6m" / "-1y". */
  current?: number;
}

const TENOR_PART = /(\d+)\s*([dwmy])/gi;

function applyTenors(from: number, text: string, sign: 1 | -1, businessDays: boolean): number | undefined {
  let d = from;
  let any = false;
  for (const m of text.matchAll(TENOR_PART)) {
    any = true;
    const n = Number(m[1]) * sign;
    const unit = m[2]!.toUpperCase();
    if (unit === "W") d = d + n * 7;
    else if (unit === "D") d = d + n;
    else if (n < 0) d = addTenor(d, `-${Math.abs(n)}${unit}`);
    else d = addTenor(d, `${n}${unit}`);
  }
  if (!any) return undefined;
  if (businessDays) d = advance(d, "0D", getCalendar("TARGET"));
  return d;
}

function endOfMonth(serial: number): number {
  const [y, m] = toISO(serial).split("-").map(Number) as [number, number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return parseISO(next) - 1;
}

export function parseDateInput(raw: string, opts: DateParseOptions): number | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return undefined;
  const base = opts.base;
  try {
    if (s === "heute" || s === "today" || s === "t" || s === "0") return base;
    if (s === "spot" || s === "t+2") return advance(base, "2D", getCalendar("TARGET"));
    if (s === "me" || s === "monatsende" || s === "ultimo") return endOfMonth(base);
    if (s === "je" || s === "jahresende") return parseISO(`${toISO(base).slice(0, 4)}-12-31`);
    // ISO
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) return parseISO(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
    // German dd.mm.yyyy / dd.mm.yy / dd.mm. / dd.mm
    m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/.exec(s);
    if (m) {
      const yRaw = m[3];
      const y = yRaw === undefined ? Number(toISO(base).slice(0, 4)) : yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
      const iso = `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
      const d = parseISO(iso);
      return toISO(d) === iso ? d : undefined; // reject 31.02.
    }
    // signed tenor relative to the current value
    m = /^([+-])((?:\d+[dwmy])+)(!?)$/.exec(s);
    if (m) return applyTenors(opts.current ?? base, m[2]!, m[1] === "-" ? -1 : 1, m[3] === "!");
    // absolute tenor from base
    m = /^((?:\d+[dwmy])+)(!?)$/.exec(s);
    if (m) return applyTenors(base, m[1]!, 1, m[2] === "!");
    // "10j" (Jahre) → years
    m = /^(\d+)j$/.exec(s);
    if (m) return addTenor(base, `${m[1]}Y`);
  } catch {
    return undefined;
  }
  return undefined;
}

export interface DatePreset {
  label: string;
  input: string;
}

/** Calendar-free presets shown in the date popover. */
export const DATE_PRESETS: DatePreset[] = [
  { label: "Heute", input: "heute" },
  { label: "Spot", input: "spot" },
  { label: "+1M", input: "+1m" },
  { label: "+3M", input: "+3m" },
  { label: "+6M", input: "+6m" },
  { label: "+1Y", input: "+1y" },
  { label: "1Y", input: "1y" },
  { label: "2Y", input: "2y" },
  { label: "3Y", input: "3y" },
  { label: "5Y", input: "5y" },
  { label: "7Y", input: "7y" },
  { label: "10Y", input: "10y" },
  { label: "Monatsende", input: "me" },
  { label: "Jahresende", input: "je" },
];

/** dd.mm.yyyy for the text field. */
export function formatDateInput(serial: number | undefined): string {
  if (serial === undefined || !Number.isFinite(serial)) return "";
  const [y, m, d] = toISO(serial).split("-");
  return `${d}.${m}.${y}`;
}
