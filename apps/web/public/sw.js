/*
 * DERIVA app-shell service worker (US-8.13, review R4-F3).
 *
 * The valuation core runs in the browser and the portfolio lives in
 * localStorage – the only thing that used to need the network was the app
 * shell itself. This worker caches it so a reload works offline:
 *  - built assets (`/assets/*`, hashed file names): cache-first – a hashed
 *    file never changes, so the cached copy is always right; a miss is fetched
 *    and stored;
 *  - the shell (`index.html`, navigations): network-first with the cached
 *    shell as fallback, so a deploy is picked up on the next online reload
 *    and an offline reload still renders the app;
 *  - everything else (API calls, other origins) passes through untouched.
 * No external dependencies, no runtime beyond the browser.
 */
const VERSION = "deriva-shell-v1";
const SHELL = ["/", "/index.html"];

const isAsset = (url) => url.origin === self.location.origin && url.pathname.startsWith("/assets/");
const isShell = (request, url) =>
  url.origin === self.location.origin && (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
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

/** Cache-first for hashed build assets. */
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
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
    const hit = (await cache.match(request)) || (await cache.match("/index.html")) || (await cache.match("/"));
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
