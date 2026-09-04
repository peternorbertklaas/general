/**
 * Code-splitting helper (ADR-026 / N4-07). `lazyComponent(loader)` behaves like
 * `React.lazy`, with the additions the workstation needs:
 *  - `preload()` fetches the chunk ahead of time (the `g` chord announces a
 *    view switch ~200 ms before the second key arrives; tests preload every
 *    view once so rendering stays synchronous);
 *  - once the module has arrived the component renders synchronously – no
 *    Suspense round-trip on later mounts, so a hotkey view switch never shows
 *    a skeleton for a chunk that is already in memory;
 *  - a failed chunk load is **not** cached (R6-01): the loader is retried once
 *    with a cache-busting query on the chunk URL (a deploy with new hashes or a
 *    network drop before the prefetch), and when that fails too the component
 *    renders a German error card with "Erneut versuchen" (re-imports) and
 *    "Neu laden" (`location.reload()`) instead of the raw engine text. Unlike
 *    `React.lazy`, a later render attempt really imports again.
 */
import { type ComponentType, Suspense, createContext, createElement, lazy, useContext, useEffect, useRef, useState } from "react";

export interface LazyComponent<P> {
  (props: P): React.JSX.Element;
  /** Start loading the chunk; resolves when the component is available (rejects when both attempts failed). */
  preload(): Promise<void>;
  /** Whether the chunk has been loaded (informational, for tests). */
  readonly loaded: boolean;
  /** Error of the last failed load attempt (undefined after success / reset) – informational, for tests. */
  readonly lastError: unknown;
}

export type LazyModule<P> = { default: ComponentType<P> };

export interface LazyOptions<P> {
  /** Placeholder while the chunk loads (skeleton, chart placeholder). */
  fallback?: ComponentType<P> | ((props: P) => React.JSX.Element);
  /**
   * Second attempt after a failed load. Default: `retryImport` – re-import the
   * chunk URL named in the error with a cache-busting query. Return `undefined`
   * when no retry is possible.
   */
  retry?: (error: unknown, loader: () => Promise<LazyModule<P>>) => Promise<LazyModule<P>> | undefined;
  /** Label of the loaded thing in the error card ("Ansicht", "Diagramm"). */
  label?: string;
}

/** Whether an error is a failed dynamic `import()` (chunk missing after a deploy, network drop). */
export function isChunkLoadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(
    e.message,
  );
}

/** Chunk URL named in a failed-import error ("Failed to fetch dynamically imported module: http://…/assets/X-abc.js"). */
export function chunkUrlOf(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  const m = /(https?:\/\/\S+?\.(?:m?js))(?:[?#]\S*)?(?:\s|$)/.exec(e.message) ?? /(\/\S+?\.(?:m?js))(?:[?#]\S*)?(?:\s|$)/.exec(e.message);
  return m?.[1];
}

/**
 * German text for a failed chunk load – the most likely cause is a deploy while
 * the app was open (the old hashed files are gone), the remedy is a reload.
 */
export const CHUNK_ERROR_TEXT =
  "Ansicht konnte nicht geladen werden – vermutlich liegt eine neue Version von DERIVA vor oder die Verbindung wurde unterbrochen. Bitte die Seite neu laden.";

/**
 * Retry a failed chunk import once with a cache-busting query on the URL the
 * error names. Browsers remember a failed module fetch for the page's lifetime
 * (the module map caches the failure), so the same URL would fail again;
 * `?retry=<ts>` is a new key and the chunk's relative imports still resolve
 * against the same directory. Returns `undefined` when the URL is unknown.
 */
export function retryImport<M>(e: unknown): Promise<M> | undefined {
  const url = chunkUrlOf(e);
  if (!url) return undefined;
  const sep = url.includes("?") ? "&" : "?";
  return import(/* @vite-ignore */ `${url}${sep}retry=${Date.now()}`) as Promise<M>;
}

type Outcome<P> = { ok: LazyModule<P> } | { err: unknown };

/** "Erneut versuchen" of the error card – provided by the lazy wrapper, so the card needs no props from the view. */
const RetryContext = createContext<() => void>(() => undefined);

export function lazyComponent<P extends object>(loader: () => Promise<LazyModule<P>>, opts: LazyOptions<P> = {}): LazyComponent<P> {
  let resolved: ComponentType<P> | undefined;
  /**
   * The current attempt (in flight or settled). A settled failure stays here so
   * the error card renders stably; `reset()` – "Erneut versuchen" or a fresh
   * mount of the component (next `g s`) – clears it and creates a new
   * `React.lazy` instance, so the chunk is really imported again (R6-01).
   * React.lazy alone would cache the rejection for good.
   */
  let pending: Promise<Outcome<P>> | undefined;
  let failed: unknown;
  const retry = opts.retry ?? ((e: unknown) => retryImport<LazyModule<P>>(e));
  /** One load: the loader, and on failure the cache-busting retry once. */
  const attempt = (): Promise<LazyModule<P>> =>
    loader().catch((e: unknown) => {
      const second = retry(e, loader);
      if (!second) throw e;
      return second.catch((e2: unknown) => {
        throw e2 ?? e;
      });
    });
  const load = (): Promise<Outcome<P>> => {
    if (resolved) return Promise.resolve({ ok: { default: resolved } });
    if (!pending)
      pending = attempt().then(
        (m) => {
          resolved = m.default;
          return { ok: m };
        },
        (e: unknown) => {
          failed = e;
          return { err: e };
        },
      );
    return pending;
  };
  /** React.lazy over the shared attempt; a failed attempt resolves to the error card instead of rejecting. */
  const makeLazy = () =>
    lazy(() =>
      load().then((o) =>
        "ok" in o
          ? { default: o.ok.default }
          : { default: (() => createElement(ChunkError, { error: o.err, label: opts.label })) as unknown as ComponentType<P> },
      ),
    );
  let Lazy = makeLazy();
  const reset = () => {
    pending = undefined;
    failed = undefined;
    Lazy = makeLazy();
  };
  /** Mounted instances – "Erneut versuchen" on one error card re-renders them all (several charts of one view share the library chunk, R7-05). */
  const mounted = new Set<() => void>();
  const Comp = ((props: P) => {
    const [, bump] = useState(0);
    useEffect(() => {
      const rerender = () => bump((n) => n + 1);
      mounted.add(rerender);
      return () => {
        mounted.delete(rerender);
      };
    }, []);
    // The render path is fixed per mount: a mount that started through Suspense keeps rendering through it, otherwise the
    // first re-render after the chunk arrived would swap the tree (Suspense → direct) and remount the view – losing focus
    // and local state (e.g. a field edited right after a reload on a lazy view). A mount that finds the chunk in memory
    // renders it directly and synchronously (no Suspense round-trip on hotkey view switches).
    const direct = useRef(resolved !== undefined);
    // A fresh mount after an earlier failure (the user navigates to the view again) imports again instead of showing the cached error.
    useEffect(() => {
      if (failed) {
        reset();
        bump((n) => n + 1);
      }
    }, []);
    if (direct.current && resolved) return createElement(resolved, props);
    const fallback = opts.fallback ? createElement(opts.fallback as ComponentType<P>, props) : null;
    const onRetry = () => {
      reset();
      bump((n) => n + 1);
      mounted.forEach((fn) => fn());
    };
    return createElement(RetryContext.Provider, { value: onRetry }, createElement(Suspense, { fallback }, createElement(Lazy, props)));
  }) as LazyComponent<P>;
  Comp.preload = () => {
    if (failed) reset();
    return load().then((o) => {
      if ("err" in o) throw o.err;
    });
  };
  Object.defineProperty(Comp, "loaded", { get: () => resolved !== undefined });
  Object.defineProperty(Comp, "lastError", { get: () => failed });
  return Comp;
}

/** German error card for a chunk that could not be loaded (R6-01). */
export function ChunkError({ error, label, onRetry }: { error: unknown; label?: string; onRetry?: () => void }) {
  const fromContext = useContext(RetryContext);
  const retry = onRetry ?? fromContext;
  const what = label ?? "Ansicht";
  const text = isChunkLoadError(error)
    ? CHUNK_ERROR_TEXT.replace("Ansicht", what)
    : `${what} konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)}).`;
  return createElement(
    "div",
    { className: "card", role: "alert", style: { borderColor: "var(--neg)" }, "data-testid": "chunk-error" },
    createElement("h3", null, `${what} nicht verfügbar`),
    createElement("div", { className: "warning", style: { borderLeftColor: "var(--neg)", background: "var(--neg-soft)" } }, text),
    createElement(
      "div",
      { className: "row", style: { marginTop: 10, gap: 8 } },
      createElement("button", { className: "btn primary", onClick: () => window.location.reload(), "data-testid": "chunk-reload" }, "Neu laden"),
      createElement("button", { className: "btn", onClick: retry, "data-testid": "chunk-retry" }, "Erneut versuchen"),
      createElement("span", { className: "muted xs" }, "Der Rest der Anwendung läuft weiter."),
    ),
  );
}
