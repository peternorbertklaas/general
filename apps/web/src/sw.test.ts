/**
 * App-shell service worker (US-8.13 / R4-F3 / R5-F4): the template in
 * `src/sw/sw.js` is rendered by the build plugin (asset list + version
 * injected) and evaluated against a minimal ServiceWorkerGlobalScope stub –
 * every built asset is precached on install, hashed assets are served
 * cache-first, the shell network-first with the cached fallback.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PRECACHE_PLACEHOLDER, VERSION_PLACEHOLDER, precacheList, renderServiceWorker } from "../scripts/sw-precache-plugin.js";

type Req = { url: string; method: string; mode?: string };
type Res = { ok: boolean; body: string; clone(): Res };
const res = (body: string, ok = true): Res => ({ ok, body, clone: () => res(body, ok) });
const key = (r: Req | string) => (typeof r === "string" ? r : r.url.replace(/^https?:\/\/[^/]+/, ""));

const ASSETS = ["/assets/index-abc123.js", "/assets/core-def456.js", "/assets/react-ghi789.js", "/assets/index-jkl012.css"];
const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sw", "sw.js"), "utf8");

function makeScope() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Res>();
  const cache = {
    match: async (r: Req | string) => store.get(key(r)),
    put: async (r: Req | string, v: Res) => void store.set(key(r), v),
    addAll: async (list: string[]) => {
      for (const l of list) store.set(l, res(`precached:${l}`));
    },
  };
  const opened: string[] = [];
  const caches = {
    open: async (name: string) => {
      opened.push(name);
      return cache;
    },
    keys: async () => ["deriva-shell-v1", "deriva-shell-old"],
    delete: vi.fn(async () => true),
  };
  const self = {
    location: { origin: "http://localhost:4810" },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn;
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  return { handlers, store, caches, self, opened };
}

function load(scope: ReturnType<typeof makeScope>, fetchImpl: (r: Req) => Promise<Res>, assets = ASSETS) {
  const src = renderServiceWorker(template, assets);
  new Function("self", "caches", "fetch", src)(scope.self, scope.caches, fetchImpl);
  return scope.handlers;
}

const dispatchFetch = (handlers: Record<string, (e: unknown) => void>, request: Req): Promise<Res> | undefined => {
  let out: Promise<Res> | undefined;
  handlers.fetch!({ request, respondWith: (p: Promise<Res>) => (out = p) });
  return out;
};

describe("service worker build plugin", () => {
  it("template carries the placeholders and renders with the asset list and a version hash", () => {
    expect(template).toContain(PRECACHE_PLACEHOLDER);
    expect(template).toContain(VERSION_PLACEHOLDER);
    const out = renderServiceWorker(template, ASSETS);
    expect(out).not.toContain(PRECACHE_PLACEHOLDER);
    expect(out).not.toContain(VERSION_PLACEHOLDER);
    expect(out).toContain(JSON.stringify(ASSETS));
    expect(out).toMatch(/const VERSION = "deriva-shell-[0-9a-f]{12}";/);
    // a different asset list → a different cache name (old caches are dropped on activate)
    expect(renderServiceWorker(template, ASSETS.slice(1))).not.toBe(out);
    expect(() => renderServiceWorker("no placeholders", ASSETS)).toThrow(/placeholder|lacks/);
  });
  it("precaches JS and CSS assets, never source maps or the HTML", () => {
    expect(precacheList(["assets/index-a.js", "assets/index-a.js.map", "assets/index-b.css", "index.html", "sw.js", "assets/echarts-c.js"])).toEqual([
      "/assets/echarts-c.js",
      "/assets/index-a.js",
      "/assets/index-b.css",
    ]);
  });
});

describe("service worker (src/sw/sw.js)", () => {
  it("registers install/activate/fetch and precaches the shell plus every built asset on install (R5-F4)", async () => {
    const scope = makeScope();
    const handlers = load(scope, async () => res("net"));
    expect(Object.keys(handlers).sort()).toEqual(["activate", "fetch", "install"]);
    let done: Promise<unknown> | undefined;
    handlers.install!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(scope.store.get("/index.html")?.body).toBe("precached:/index.html");
    for (const a of ASSETS) expect(scope.store.get(a)?.body).toBe(`precached:${a}`);
    expect(scope.opened[0]).toMatch(/^deriva-shell-[0-9a-f]{12}$/);
    expect(scope.self.skipWaiting).toHaveBeenCalled();
    handlers.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(scope.caches.delete).toHaveBeenCalledWith("deriva-shell-v1");
    expect(scope.caches.delete).toHaveBeenCalledWith("deriva-shell-old");
    expect(scope.self.clients.claim).toHaveBeenCalled();
    // after install an asset request is answered from the cache without any network fetch
    const fetchSpy = vi.fn(async () => res("net"));
    const handlers2 = load(makeScopeWith(scope.store), fetchSpy);
    expect((await dispatchFetch(handlers2, { url: `http://localhost:4810${ASSETS[1]}`, method: "GET" }))!.body).toBe(`precached:${ASSETS[1]}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves hashed assets cache-first and fills the cache on a miss", async () => {
    const scope = makeScope();
    const fetchImpl = vi.fn(async () => res("fresh-asset"));
    const handlers = load(scope, fetchImpl);
    const asset = { url: "http://localhost:4810/assets/other-xyz.js", method: "GET" };
    expect((await dispatchFetch(handlers, asset))!.body).toBe("fresh-asset");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(scope.store.get("/assets/other-xyz.js")?.body).toBe("fresh-asset");
    fetchImpl.mockResolvedValue(res("changed"));
    expect((await dispatchFetch(handlers, asset))!.body).toBe("fresh-asset");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves navigations network-first and falls back to the cached shell when offline", async () => {
    const scope = makeScope();
    let offline = false;
    const fetchImpl = vi.fn(async () => {
      if (offline) throw new TypeError("Failed to fetch");
      return res("online-shell");
    });
    const handlers = load(scope, fetchImpl);
    const nav = { url: "http://localhost:4810/", method: "GET", mode: "navigate" };
    expect((await dispatchFetch(handlers, nav))!.body).toBe("online-shell");
    expect(scope.store.get("/index.html")?.body).toBe("online-shell");
    offline = true;
    expect((await dispatchFetch(handlers, nav))!.body).toBe("online-shell");
    // API calls, POSTs and foreign origins pass through untouched
    expect(dispatchFetch(handlers, { url: "http://localhost:4810/api/trades", method: "GET" })).toBeUndefined();
    expect(dispatchFetch(handlers, { url: "http://localhost:4810/assets/x.js", method: "POST" })).toBeUndefined();
    expect(dispatchFetch(handlers, { url: "https://example.org/assets/x.js", method: "GET" })).toBeUndefined();
  });
});

/** A second worker instance sharing the cache store (simulates the browser after install). */
function makeScopeWith(store: Map<string, Res>) {
  const scope = makeScope();
  for (const [k, v] of store) scope.store.set(k, v);
  return scope;
}
