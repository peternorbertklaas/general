/**
 * Conditional-request helpers per RFC 9110 §8.8.3 / §13.1 (review finding N5-03).
 *
 * `If-Match` uses the *strong* comparison: both validators must be strong and
 * byte-identical – a weak tag (`W/"…"`) never matches, whatever the server
 * holds. `If-None-Match` uses the *weak* comparison: the `W/` prefix is ignored
 * on either side, so a cache that stored a weak tag still gets its 304. Trades
 * and the snapshot carry strong ETags (`"version-hash"`, `"snapshotId"`); both
 * headers accept a comma-separated list and `*`.
 */

interface ParsedTag {
  weak: boolean;
  opaque: string;
}

function parseTag(raw: string): ParsedTag | undefined {
  const s = raw.trim();
  const weak = s.startsWith("W/");
  const body = weak ? s.slice(2) : s;
  if (body.length < 2 || !body.startsWith('"') || !body.endsWith('"')) return undefined;
  return { weak, opaque: body };
}

/** Header values may be repeated (`string[]`) or comma-separated. */
function tags(header: string | string[] | undefined): string[] {
  if (header === undefined) return [];
  return (Array.isArray(header) ? header : [header]).flatMap((h) => h.split(",")).map((s) => s.trim());
}

/** `If-Match` (strong comparison): `*`, or a strong tag byte-identical to the current strong ETag. */
export function ifMatchSatisfied(header: string | string[] | undefined, currentEtag: string): boolean {
  const current = parseTag(currentEtag);
  if (!current || current.weak) return false;
  return tags(header).some((raw) => {
    if (raw === "*") return true;
    const t = parseTag(raw);
    return t !== undefined && !t.weak && t.opaque === current.opaque;
  });
}

/** `If-None-Match` (weak comparison): `*`, or a tag whose opaque part equals the current ETag's, `W/` ignored. */
export function ifNoneMatchSatisfied(header: string | string[] | undefined, currentEtag: string): boolean {
  const current = parseTag(currentEtag);
  if (!current) return false;
  return tags(header).some((raw) => {
    if (raw === "*") return true;
    const t = parseTag(raw);
    return t !== undefined && t.opaque === current.opaque;
  });
}
