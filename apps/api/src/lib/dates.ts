import { parseISO, toISO } from "@deriva/pricing-core";

const DATE_KEYS = new Set([
  "date",
  "valuationDate",
  "effectiveDate",
  "terminationDate",
  "expiryDate",
  "deliveryDate",
  "startDate",
  "endDate",
  "tradeDate",
  "fixingDate",
  "paymentDate",
  "accrualStart",
  "accrualEnd",
  "maturity",
  "spotDate",
  "referenceDate",
]);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Recursively convert ISO date strings on known date keys into serial dates. */
export function datesToSerial<T>(value: T): T {
  return walk(value, (k, v) => (typeof v === "string" && DATE_KEYS.has(k) && ISO_RE.test(v) ? parseISO(v) : v)) as T;
}

/** Recursively convert serial dates on known date keys to ISO strings for API responses. */
export function datesToIso<T>(value: T): T {
  return walk(value, (k, v) => (typeof v === "number" && DATE_KEYS.has(k) && Number.isInteger(v) && v > 10_000 && v < 100_000 ? toISO(v) : v)) as T;
}

function walk(value: unknown, fn: (key: string, v: unknown) => unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, fn, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, fn, k);
    }
    return out;
  }
  return fn(key, value);
}
