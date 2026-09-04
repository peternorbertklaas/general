import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composite, contrastRatio, parseColor, relativeLuminance, type Rgb } from "./contrast.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const dark = block(":root");
const light = { ...dark, ...block('\n[data-theme="light"] {') };

function rgb(tokens: Record<string, string>, name: string): Rgb {
  const c = parseColor(tokens[name] ?? "");
  if (!c) throw new Error(`token --${name} is not a plain colour: ${tokens[name]}`);
  return c;
}

const AA = 4.5;

describe("WCAG contrast of design tokens (F-10, section 5)", () => {
  it("luminance / ratio helpers behave", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 3);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgba(15, 23, 42, 0.5)")).toEqual([15, 23, 42]);
  });

  for (const [themeName, tk] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    describe(themeName, () => {
      const bgs = ["bg-0", "bg-1", "bg-2"] as const;
      it.each(["fg-0", "fg-1", "fg-2"])("text %s on bg-0..bg-3 ≥ 4.5", (fg) => {
        for (const bg of [...bgs, "bg-3"]) {
          const r = contrastRatio(rgb(tk, fg), rgb(tk, bg));
          expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
        }
      });
      it.each(["pos", "neg", "warn", "info", "accent", "accent-2"])("semantic colour %s as text on bg-0..bg-2 ≥ 4.5", (fg) => {
        for (const bg of bgs) {
          const r = contrastRatio(rgb(tk, fg), rgb(tk, bg));
          expect(r, `${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
        }
      });
      it("badges: foreground on the tinted background (18 % hue over bg-1) ≥ 4.5", () => {
        const bg1 = rgb(tk, "bg-1");
        const pairs: [string, string, number][] = [
          ["badge-irs-fg", "accent", 0.18],
          ["badge-opt-fg", "accent-2", 0.18],
          ["badge-fx-fg", "info", 0.18],
          ["badge-warn-fg", "warn", 0.15],
          ["badge-ok-fg", "pos", 0.15],
          ["badge-neg-fg", "neg", 0.15],
        ];
        for (const [fg, hue, a] of pairs) {
          const r = contrastRatio(rgb(tk, fg), composite(rgb(tk, hue), a, bg1));
          expect(r, `${fg} on ${hue}-tint = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
        }
      });
      it("buttons, chips and kbd", () => {
        expect(contrastRatio(rgb(tk, "btn-primary-fg"), rgb(tk, "accent"))).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(rgb(tk, "chip-customer-fg"), rgb(tk, "warn"))).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(rgb(tk, "fg-1"), rgb(tk, "bg-3"))).toBeGreaterThanOrEqual(AA);
        // selected row / warning box: body text over the soft tints
        const bg1 = rgb(tk, "bg-1");
        expect(contrastRatio(rgb(tk, "fg-0"), composite(rgb(tk, "accent"), 0.16, bg1))).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(rgb(tk, "fg-1"), composite(rgb(tk, "warn"), 0.15, bg1))).toBeGreaterThanOrEqual(AA);
      });
      it("active segment buttons ≥ 4.5 on bg-0 / bg-1 and on the accent tint (N-08)", () => {
        for (const bg of ["bg-0", "bg-1"] as const) {
          const r = contrastRatio(rgb(tk, "seg-active-fg"), composite(rgb(tk, "accent"), 0.16, rgb(tk, bg)));
          expect(r, `seg-active-fg on accent-soft over ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
          expect(contrastRatio(rgb(tk, "seg-active-fg"), rgb(tk, bg))).toBeGreaterThanOrEqual(AA);
        }
      });
      it("badges inside a selected row (tint over tint) ≥ 4.5 (N-08)", () => {
        const selectedRow = composite(rgb(tk, "accent"), 0.16, rgb(tk, "bg-1"));
        const pairs: [string, string, number][] = [
          ["badge-irs-fg", "accent", 0.18],
          ["badge-opt-fg", "accent-2", 0.18],
          ["badge-fx-fg", "info", 0.18],
          ["badge-warn-fg", "warn", 0.15],
          ["badge-ok-fg", "pos", 0.15],
        ];
        for (const [fg, hue, a] of pairs) {
          // badge background is mixed over bg-1 (not transparent), so the row tint does not stack
          const r = contrastRatio(rgb(tk, fg), composite(rgb(tk, hue), a, rgb(tk, "bg-1")));
          expect(r, `${fg} in selected row = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
          expect(contrastRatio(rgb(tk, fg), selectedRow)).toBeGreaterThan(3);
        }
      });
      it("strongest heatmap cells (alpha capped at 0.1 + 0.4) keep fg-0 ≥ 4.5 (N-08)", () => {
        for (const hue of ["pos", "neg", "accent"] as const) {
          const cell = composite(rgb(tk, hue), 0.5, rgb(tk, "bg-1"));
          const r = contrastRatio(rgb(tk, "fg-0"), cell);
          expect(r, `fg-0 on 50 % ${hue} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
        }
      });
      it("signed numbers in a selected or hovered row use the strong tokens ≥ 4.5 (R3-07)", () => {
        const selectedRow = composite(rgb(tk, "accent"), 0.16, rgb(tk, "bg-1"));
        for (const fg of ["pos-strong", "neg-strong"] as const) {
          const r = contrastRatio(rgb(tk, fg), selectedRow);
          expect(r, `${fg} in selected row = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
          const h = contrastRatio(rgb(tk, fg), rgb(tk, "bg-hover"));
          expect(h, `${fg} in hovered row = ${h.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
          // the plain tokens stay readable on the card surface
          expect(contrastRatio(rgb(tk, fg), rgb(tk, "bg-1"))).toBeGreaterThanOrEqual(AA);
        }
      });
      it("active filter chips (seg-active-fg on the accent tint over bg-1 / bg-2) ≥ 4.5 (R3-07)", () => {
        for (const bg of ["bg-1", "bg-2"] as const) {
          const chip = composite(rgb(tk, "accent"), 0.16, rgb(tk, bg));
          const r = contrastRatio(rgb(tk, "seg-active-fg"), chip);
          expect(r, `chip active over ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
        }
      });
      it("uses color-mix instead of hard-coded rgba for tints", () => {
        expect(tk["accent-soft"]).toMatch(/color-mix/);
        expect(tk["pos-soft"]).toMatch(/color-mix/);
        expect(tk["accent-line"]).toMatch(/color-mix/);
      });
    });
  }
});
