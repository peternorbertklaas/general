/**
 * WCAG 2.x relative luminance / contrast ratio (no dependency). Used by the
 * vitest contrast test and available for runtime checks.
 */
export type Rgb = [number, number, number];

export function parseColor(s: string): Rgb | undefined {
  const c = s.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [parseInt(m[1]![0]! + m[1]![0]!, 16), parseInt(m[1]![1]! + m[1]![1]!, 16), parseInt(m[1]![2]! + m[1]![2]!, 16)];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16)];
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return undefined;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` with alpha `a` over an opaque `bg` (approximates `color-mix(in srgb, fg a%, transparent)` on `bg`). */
export function composite(fg: Rgb, a: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(fg[i as 0 | 1 | 2] * a + bg[i as 0 | 1 | 2] * (1 - a))) as Rgb;
}

/** Contrast between two CSS colour strings; NaN when either cannot be parsed. */
export function contrast(fg: string, bg: string): number {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return NaN;
  return contrastRatio(a, b);
}
