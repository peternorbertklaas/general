import { type Trade } from "@deriva/pricing-core";

/** Readable id prefix per instrument ("CAP", "FXF", …). */
export function idPrefix(t: Trade): string {
  switch (t.type) {
    case "InterestRateSwap": {
      const fixed = t.legs.some((l) => l.type === "Fixed");
      if (!fixed) return "BASIS";
      const idx = t.legs.find((l): l is Extract<typeof l, { type: "Float" }> => l.type === "Float")?.index ?? "";
      if (/^(ESTR|SOFR|SONIA|SARON|TONA)/i.test(idx)) return "OIS";
      if (t.legs.some((l) => (l.notionalSchedule?.length ?? 0) > 0)) return "AMORT";
      return "IRS";
    }
    case "CrossCurrencySwap":
      return "CCS";
    case "FRA":
      return "FRA";
    case "CapFloor":
      return t.capFloor === "Collar" ? "COL" : t.capFloor === "Floor" ? "FLOOR" : "CAP";
    case "Swaption":
      return "SWPT";
    case "FxForward":
      return "FXF";
    case "FxSwap":
      return "FXS";
    case "FxOption":
      return "FXO";
  }
}

/** Next sequential id for a prefix: "CAP-0002" given existing "CAP-0001". */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

const COPY_RE = /\s*\(Kopie(?: \d+)?\)\s*$/;

/** Strip "(Kopie)" / "(Kopie 3)" suffixes. */
export function baseName(name: string): string {
  let n = name;
  while (COPY_RE.test(n)) n = n.replace(COPY_RE, "");
  return n.trim();
}

/** "Name (Kopie n)" where n is the first free number among existing names (no chains). */
export function copyName(name: string, existingNames: Iterable<string | undefined>): string {
  const base = baseName(name);
  const taken = new Set<number>();
  for (const n of existingNames) {
    if (!n) continue;
    if (n === `${base} (Kopie)`) taken.add(1);
    const m = new RegExp(`^${escapeRe(base)} \\(Kopie (\\d+)\\)$`).exec(n);
    if (m) taken.add(Number(m[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return n === 1 ? `${base} (Kopie)` : `${base} (Kopie ${n})`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
