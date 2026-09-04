/**
 * Code-splitting helper (ADR-026 / N4-07). `lazyComponent(loader)` behaves like
 * `React.lazy`, with two additions the workstation needs:
 *  - `preload()` fetches the chunk ahead of time (the `g` chord announces a
 *    view switch ~200 ms before the second key arrives; tests preload every
 *    view once so rendering stays synchronous);
 *  - once the module has arrived the component renders synchronously – no
 *    Suspense round-trip on later mounts, so a hotkey view switch never shows
 *    a skeleton for a chunk that is already in memory.
 */
import { type ComponentType, Suspense, lazy, createElement } from "react";

export interface LazyComponent<P> {
  (props: P): React.JSX.Element;
  /** Start loading the chunk; resolves when the component is available. */
  preload(): Promise<void>;
  /** Whether the chunk has been loaded (informational, for tests). */
  readonly loaded: boolean;
}

export function lazyComponent<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  opts: { fallback?: ComponentType<P> | ((props: P) => React.JSX.Element) } = {},
): LazyComponent<P> {
  let resolved: ComponentType<P> | undefined;
  let pending: Promise<void> | undefined;
  const load = (): Promise<void> => {
    if (resolved) return Promise.resolve();
    if (!pending)
      pending = loader().then((m) => {
        resolved = m.default;
      });
    return pending;
  };
  const Lazy = lazy(() => loader());
  const Comp = ((props: P) => {
    if (resolved) return createElement(resolved, props);
    const fallback = opts.fallback ? createElement(opts.fallback as ComponentType<P>, props) : null;
    return createElement(Suspense, { fallback }, createElement(Lazy, props));
  }) as LazyComponent<P>;
  Comp.preload = load;
  Object.defineProperty(Comp, "loaded", { get: () => resolved !== undefined });
  return Comp;
}
