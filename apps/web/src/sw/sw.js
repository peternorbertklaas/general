/*
 * DERIVA app-shell service worker (US-8.13, review R4-F3 / R5-F4).
 *
 * The valuation core runs in the browser and the portfolio lives in
 * localStorage – the only thing that needs the network is the app shell
 * itself. This worker caches it so a reload works offline:
 *  - on `install` the shell (`/`, `/index.html`) AND every built asset listed
 *    in PRECACHE (injected at build time by `scripts/sw-precache-plugin.ts`
 *    from the Vite bundle) are stored – offline reload therefore works after
 *    the FIRST online visit (R5-F4);
 *  - built assets (`/assets/*`, hashed file names): cache-first – a hashed
 *    file never changes, so the cached copy is always right; a miss is fetched
 *    and stored;
 *  - the shell (`index.html`, navigations): network-first with the cached
 *    shell as fallback, so a deploy is picked up on the next online reload
 *    and an offline reload still renders the app;
 *  - everything else (API calls, other origins) passes through untouched.
 * The cache name carries a hash of the asset list: a new deploy installs a
 * new cache, `activate` deletes the old one. No external dependencies.
 */
/* global __DERIVA_PRECACHE__ -- injected by scripts/sw-precache-plugin.ts at build time */
const VERSION = "__DERIVA_SW_VERSION__";
const SHELL = ["/", "/index.html"];
const PRECACHE = __DERIVA_PRECACHE__;

const isAsset = (url) => url.origin === self.location.origin && url.pathname.startsWith("/assets/");
const isShell = (request, url) =>
  url.origin === self.location.origin && (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([...SHELL, ...PRECACHE]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Cache-first for hashed build assets. `ignoreVary`: the precached entries were
 * fetched by the worker itself (no `Origin` header), while the page requests
 * module scripts in CORS mode – with a `Vary: Origin` response header the two
 * would never match and the first-visit precache would be useless (R5-F4).
 * Hashed files are immutable, so ignoring `Vary` is safe.
 */
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

/** Network-first for the shell; the cached index.html is the offline fallback. */
async function networkFirstShell(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put("/index.html", res.clone());
      cache.put("/", res.clone());
    }
    return res;
  } catch (err) {
    const opts = { ignoreVary: true, ignoreSearch: true };
    const hit = (await cache.match(request, opts)) || (await cache.match("/index.html", opts)) || (await cache.match("/", opts));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (isAsset(url)) event.respondWith(cacheFirst(request));
  else if (isShell(request, url)) event.respondWith(networkFirstShell(request));
});
