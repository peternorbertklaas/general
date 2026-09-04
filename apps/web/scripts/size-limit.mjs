#!/usr/bin/env node
/**
 * Bundle-size gate for the web build (ADR-026, arch N3-06 / N4-07).
 *
 * Runs after `vite build` (`pnpm --filter @deriva/web run build` / `run size`)
 * and fails when a budget is exceeded, so a new import in the start chunk or a
 * growing vendor chunk shows up in CI instead of in the field.
 *
 * Budgets (gzip, bytes) – documented in docs/product/03-ui-konzept-und-hotkeys.md
 * (§ Barrierefreiheit & Ergonomie → Architektur) and ADR-026:
 *  - index   (start chunk: shell, blotter, palette, hotkeys, store) ≤ 90 kB   (R5: 64 kB)
 *  - initial (everything index.html loads before the first paint:
 *              index + core + react + CSS)                         ≤ 260 kB  (R5: 210 kB)
 *  - echarts (lazy vendor chunk)                                    ≤ 190 kB  (R5: 179 kB)
 *  - core    (pricing engine)                                       ≤ 100 kB  (R5: 79 kB)
 *  - react   (react, react-dom, scheduler, zustand)                 ≤ 65 kB   (R5: 60 kB)
 *  - the initial load must not contain ECharts (`echarts` chunk not among
 *    the modulepreload / script tags of index.html and not statically
 *    imported by the start chunk).
 * Reference (R5, after route splitting): see the numbers printed by this script.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = process.argv[2] ? process.argv[2] : join(here, "..", "dist");
const KB = 1024;

export const BUDGETS_GZIP = {
  index: 90 * KB,
  initial: 260 * KB,
  echarts: 190 * KB,
  core: 100 * KB,
  react: 65 * KB,
};

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const fmt = (b) => `${(b / KB).toFixed(1)} kB`;

/** Chunk name of an emitted asset file ("index-B05veAnH.js" → "index"). */
const chunkName = (f) => f.replace(/-[A-Za-z0-9_-]{8,}\.(js|css)$/, "");

/** Static imports of a built ES module chunk (`import{…}from"./x.js"` / `import"./x.js"`). */
export function staticImports(source) {
  const out = new Set();
  for (const m of source.matchAll(/(?:^|[;\s}])import(?:[^"'`;]*?from)?\s*["']\.\/([^"']+)["']/g)) out.add(m[1]);
  return [...out];
}

/** Files referenced from index.html before the first paint: module scripts, modulepreloads and stylesheets. */
export function initialFiles(html) {
  const out = new Set();
  for (const m of html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\bhref)="\/?(assets\/[^"]+)"/g)) out.add(m[1]);
  return [...out];
}

export function analyse(distDir) {
  const assetsDir = join(distDir, "assets");
  if (!existsSync(assetsDir)) throw new Error(`no build found in ${distDir} – run vite build first`);
  const files = readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f));
  const sizes = Object.fromEntries(files.map((f) => [f, { raw: statSync(join(assetsDir, f)).size, gzip: gz(join(assetsDir, f)) }]));
  const byChunk = {};
  for (const f of files) {
    const name = chunkName(f);
    byChunk[name] = (byChunk[name] ?? 0) + sizes[f].gzip;
  }
  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const initial = initialFiles(html).map((p) => p.replace(/^assets\//, ""));
  // follow the static import graph of the entry chunks (a statically imported chunk is part of the initial load)
  const queue = [...initial.filter((f) => f.endsWith(".js"))];
  const seen = new Set(initial);
  while (queue.length) {
    const f = queue.pop();
    const src = readFileSync(join(assetsDir, f), "utf8");
    for (const imp of staticImports(src)) {
      if (!seen.has(imp)) {
        seen.add(imp);
        if (imp.endsWith(".js")) queue.push(imp);
      }
    }
  }
  const initialList = [...seen].filter((f) => sizes[f]);
  const initialGzip = initialList.reduce((x, f) => x + sizes[f].gzip, 0);
  const indexFile = files.find((f) => chunkName(f) === "index" && f.endsWith(".js"));
  const indexSrc = indexFile ? readFileSync(join(assetsDir, indexFile), "utf8") : "";
  const echartsInInitial = initialList.some((f) => chunkName(f) === "echarts");
  // A *static* import of the echarts chunk would pull it into the initial load; the preload lists of dynamic imports may name it.
  const echartsInIndex = staticImports(indexSrc).some((f) => chunkName(f) === "echarts") || /from"\.\/echarts-|echarts\/core/.test(indexSrc);
  const swFile = join(distDir, "sw.js");
  const sw = existsSync(swFile) ? readFileSync(swFile, "utf8") : "";
  const precache = sw ? (sw.match(/const PRECACHE = (\[.*?\]);/s)?.[1] ?? "[]") : "[]";
  const precacheCount = JSON.parse(precache).length;
  return { files, sizes, byChunk, initialList, initialGzip, echartsInInitial, echartsInIndex, precacheCount, swPresent: !!sw };
}

export function check(result, budgets = BUDGETS_GZIP) {
  const failures = [];
  for (const [name, limit] of Object.entries(budgets)) {
    if (name === "initial") continue;
    const actual = result.byChunk[name];
    if (actual === undefined) {
      if (name !== "echarts") failures.push(`chunk "${name}" missing from the build`);
      continue;
    }
    if (actual > limit) failures.push(`chunk "${name}": ${fmt(actual)} gzip > budget ${fmt(limit)}`);
  }
  if (result.initialGzip > budgets.initial) failures.push(`initial load: ${fmt(result.initialGzip)} gzip > budget ${fmt(budgets.initial)}`);
  if (result.echartsInInitial) failures.push("initial load contains the echarts chunk (route splitting broken)");
  if (result.echartsInIndex) failures.push("start chunk references ECharts (must only be imported by lazy views)");
  if (!result.swPresent) failures.push("dist/sw.js missing (service-worker plugin did not run)");
  else if (result.precacheCount < 3) failures.push(`service worker precaches only ${result.precacheCount} assets`);
  return failures;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const r = analyse(dist);
  console.log("Bundle (gzip / raw):");
  for (const f of r.files.sort()) console.log(`  ${f.padEnd(28)} ${fmt(r.sizes[f].gzip).padStart(10)} / ${fmt(r.sizes[f].raw)}`);
  console.log(`Initial load (${r.initialList.length} files): ${fmt(r.initialGzip)} gzip – ${r.initialList.join(", ")}`);
  console.log(`Service worker precache: ${r.precacheCount} assets`);
  const failures = check(r);
  if (failures.length) {
    console.error(`SIZE BUDGET FAILED:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Size budget OK");
}
