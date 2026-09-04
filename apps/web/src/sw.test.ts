/**
 * App-shell service worker (US-8.13 / R4-F3): the worker script in `public/sw.js`
 * is evaluated against a minimal ServiceWorkerGlobalScope stub – cache-first for
 * hashed assets, network-first with cached fallback for the shell.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

type Req = { url: string; method: string; mode?: string };
type Res = { ok: boolean; body: string; clone(): Res };
const res = (body: string, ok = true): Res => ({ ok, body, clone: () => res(body, ok) });
const key = (r: Req | string) => (typeof r === "string" ? r : r.url.replace(/^https?:\/\/[^/]+/, ""));

function makeScope() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Res>();
  const cache = {
    match: async (r: Req | string) => store.get(key(r)),
    put: async (r: Req | string, v: Res) => void store.set(key(r), v),
    addAll: async (list: string[]) => {
      for (const l of list) store.set(l, res("shell"));
    },
  };
  const caches = {
    open: async () => cache,
    keys: async () => ["deriva-shell-v0", "deriva-shell-v1"],
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
  return { handlers, store, caches, self };
}

function load(scope: ReturnType<typeof makeScope>, fetchImpl: (r: Req) => Promise<Res>) {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sw.js"), "utf8");
  new Function("self", "caches", "fetch", src)(scope.self, scope.caches, fetchImpl);
  return scope.handlers;
}

const dispatchFetch = (handlers: Record<string, (e: unknown) => void>, request: Req): Promise<Res> | undefined => {
  let out: Promise<Res> | undefined;
  handlers.fetch!({ request, respondWith: (p: Promise<Res>) => (out = p) });
  return out;
};

describe("service worker (public/sw.js)", () => {
  it("registers install/activate/fetch and precaches the shell", async () => {
    const scope = makeScope();
    const handlers = load(scope, async () => res("net"));
    expect(Object.keys(handlers).sort()).toEqual(["activate", "fetch", "install"]);
    let done: Promise<unknown> | undefined;
    handlers.install!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(scope.store.get("/index.html")?.body).toBe("shell");
    expect(scope.self.skipWaiting).toHaveBeenCalled();
    handlers.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(scope.caches.delete).toHaveBeenCalledWith("deriva-shell-v0");
    expect(scope.caches.delete).not.toHaveBeenCalledWith("deriva-shell-v1");
    expect(scope.self.clients.claim).toHaveBeenCalled();
  });

  it("serves hashed assets cache-first and fills the cache on a miss", async () => {
    const scope = makeScope();
    const fetchImpl = vi.fn(async () => res("fresh-asset"));
    const handlers = load(scope, fetchImpl);
    const asset = { url: "http://localhost:4810/assets/index-abc123.js", method: "GET" };
    expect((await dispatchFetch(handlers, asset))!.body).toBe("fresh-asset");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(scope.store.get("/assets/index-abc123.js")?.body).toBe("fresh-asset");
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
