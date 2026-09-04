/**
 * Vite plugin (US-8.13 / R4-F3 / R5-F4): emits the app-shell service worker
 * `sw.js` from the template `src/sw/sw.js` with the list of built assets
 * injected, so the worker precaches every chunk and stylesheet on `install`.
 * Offline reload therefore works after the *first* online visit – not only
 * after the second one, when the fetch handler had filled the cache lazily.
 *
 * The cache name carries a hash of the asset list: a new deploy installs a new
 * cache and `activate` deletes the old one.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export const PRECACHE_PLACEHOLDER = "__DERIVA_PRECACHE__";
export const VERSION_PLACEHOLDER = "__DERIVA_SW_VERSION__";

/** Asset file names worth precaching: JS chunks and stylesheets, never source maps. */
export function precacheList(fileNames: Iterable<string>): string[] {
  return [...fileNames]
    .filter((f) => /^assets\/.*\.(js|css)$/.test(f) && !f.endsWith(".map"))
    .map((f) => `/${f}`)
    .sort();
}

/** Render the worker source: placeholders → JSON asset list and a version derived from it. */
export function renderServiceWorker(template: string, assets: string[], versionPrefix = "deriva-shell-"): string {
  if (!template.includes(PRECACHE_PLACEHOLDER) || !template.includes(VERSION_PLACEHOLDER))
    throw new Error(`service-worker template lacks ${PRECACHE_PLACEHOLDER} / ${VERSION_PLACEHOLDER}`);
  const version = `${versionPrefix}${createHash("sha1").update(assets.join("\n")).digest("hex").slice(0, 12)}`;
  // every occurrence (the template names the placeholder in its lint directive as well)
  return template.split(PRECACHE_PLACEHOLDER).join(JSON.stringify(assets)).split(VERSION_PLACEHOLDER).join(version);
}

export function swPrecachePlugin(opts: { templatePath: string }): Plugin {
  return {
    name: "deriva-sw-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      const template = readFileSync(opts.templatePath, "utf8");
      const assets = precacheList(Object.keys(bundle));
      this.emitFile({ type: "asset", fileName: "sw.js", source: renderServiceWorker(template, assets) });
    },
  };
}
