/**
 * Market-snapshot file import (Markt-Ansicht, R5-06 / R5-F2): parse the file,
 * check the `deriva.market/1` structure and report every problem in German
 * with its cause – never the raw engine text ("Unsupported market snapshot
 * schema: undefined", "Cannot convert undefined or null to object").
 */
import { type MarketSnapshotJson } from "@deriva/pricing-core";

const SCHEMA = "deriva.market/1";
const EXPECT = "erwartet wird ein Export aus „Snapshot exportieren“ der Marktansicht oder GET /api/market/snapshot";

/** Snapshot import errors are plain `Error`s with a German message. */
export class SnapshotImportError extends Error {}

const fail = (msg: string): never => {
  throw new SnapshotImportError(msg);
};

/**
 * Parse the text of a snapshot file. Throws `SnapshotImportError` with a German
 * message for malformed JSON, a missing / unknown schema and missing or
 * mistyped required fields; optional collections default to empty so the core
 * never trips over `undefined`.
 */
export function readSnapshotJson(text: string): MarketSnapshotJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    const m = /line (\d+) column (\d+)/i.exec(e instanceof Error ? e.message : String(e));
    return fail(`Datei ist kein gültiges JSON${m ? ` (Zeile ${m[1]}, Spalte ${m[2]})` : ""} – ${EXPECT}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return fail(`Datei enthält keinen Markt-Snapshot (kein Objekt mit „schema“: „${SCHEMA}“) – ${EXPECT}`);
  const o = parsed as Record<string, unknown>;
  if (o.schema !== SCHEMA) {
    const got = o.schema === undefined ? "fehlt" : typeof o.schema === "string" ? o.schema : JSON.stringify(o.schema);
    return fail(`Datei ist kein DERIVA-Markt-Snapshot (Schema „${got}“ unbekannt, erwartet ${SCHEMA}) – ${EXPECT}`);
  }
  const missing: string[] = [];
  const wrong: string[] = [];
  const need = (key: string, ok: (v: unknown) => boolean, type: string) => {
    if (o[key] === undefined) missing.push(key);
    else if (!ok(o[key])) wrong.push(`„${key}“ (${type} erwartet)`);
  };
  need("valuationDate", (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v), "Datum JJJJ-MM-TT");
  need("discountCurveId", (v) => !!v && typeof v === "object" && !Array.isArray(v), "Objekt Währung → Kurven-ID");
  need("curves", (v) => Array.isArray(v), "Liste der Kurven");
  need("fxSpots", (v) => !!v && typeof v === "object" && !Array.isArray(v), "Objekt Paar → Kurs");
  if (missing.length) return fail(`Snapshot unvollständig – Feld ${missing.map((k) => `„${k}“`).join(", ")} fehlt`);
  if (wrong.length) return fail(`Snapshot fehlerhaft – Feld ${wrong.join(", ")} hat den falschen Typ`);
  for (const key of ["fixings", "fxFixings"])
    if (o[key] !== undefined && !Array.isArray(o[key])) return fail(`Snapshot fehlerhaft – Feld „${key}“ muss eine Liste sein`);
  for (const key of ["swaptionVols", "capletVols", "fxVols", "credit", "collateralDiscountCurveId", "meta"])
    if (o[key] !== undefined && o[key] !== null && (typeof o[key] !== "object" || Array.isArray(o[key])))
      return fail(`Snapshot fehlerhaft – Feld „${key}“ muss ein Objekt sein`);
  (o.curves as unknown[]).forEach((c, i) => {
    const cur = c as Record<string, unknown> | null;
    if (!cur || typeof cur !== "object") return fail(`Snapshot fehlerhaft – Kurve ${i + 1} ist kein Objekt`);
    if (typeof cur.id !== "string" || !cur.id) return fail(`Snapshot fehlerhaft – Kurve ${i + 1} ohne „id“`);
    if (!Array.isArray(cur.nodes) || cur.nodes.length === 0) return fail(`Snapshot fehlerhaft – Kurve „${cur.id}“ ohne Stützpunkte („nodes“)`);
    for (const n of cur.nodes as unknown[]) {
      const node = n as Record<string, unknown> | null;
      if (!node || typeof node.date !== "string" || typeof node.df !== "number")
        return fail(`Snapshot fehlerhaft – Kurve „${cur.id}“: jeder Stützpunkt braucht „date“ (JJJJ-MM-TT) und „df“ (Zahl)`);
    }
  });
  // Optional collections default to empty – the core and the market view iterate over them.
  return {
    ...(o as unknown as MarketSnapshotJson),
    fixings: (o.fixings as MarketSnapshotJson["fixings"] | undefined) ?? [],
    ...(o.credit === null ? { credit: undefined } : {}),
  };
}

/** German cause for an error raised while the core rebuilds / validates the snapshot (`TypeError` → incomplete data). */
export function snapshotErrorText(e: unknown, translate: (err: unknown) => string): string {
  if (e instanceof SnapshotImportError) return e.message;
  if (e instanceof TypeError || e instanceof RangeError)
    return `Snapshot unvollständig oder fehlerhaft – die Kurven- oder Vol-Daten konnten nicht gelesen werden (${e.message})`;
  return translate(e);
}
