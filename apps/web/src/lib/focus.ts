/**
 * Deferred focus helpers (R7-03). A view that was just switched to may still be
 * rendering (lazy chunk, Suspense) and a closing dialog restores its opener's
 * focus a frame later (`restoreFocus`), so a synchronous `focus()` would be
 * lost. `focusWhenPresent` polls the selector for a few frames and focuses the
 * first match once it exists – idempotent, never throws, no-op in SSR.
 */

const FRAMES = 30;

/** Focus the first element matching `selector` as soon as it is in the DOM (≤ `frames` animation frames). Resolves with the element or null. */
export function focusWhenPresent(selector: string, frames = FRAMES): Promise<HTMLElement | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const schedule = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : window.setTimeout(fn, 16));
  return new Promise((resolve) => {
    let left = frames;
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && document.contains(el)) {
        el.focus({ preventScroll: false });
        if (document.activeElement === el) {
          resolve(el);
          return;
        }
      }
      if (--left <= 0) {
        resolve(null);
        return;
      }
      schedule(attempt);
    };
    // Let the closing dialog's deferred `restoreFocus` (next frame + one macrotask) run first, then take over.
    window.setTimeout(() => schedule(attempt), 0);
  });
}

/** Selector of the first field of the trade editor ("Bezeichnung"). */
export const EDITOR_FIRST_FIELD = 'input[aria-label="Bezeichnung"]';

/** After a trade was created (chord `n …`, palette quick entry): focus the editor's first field (R7-03). */
export function focusEditorField(): Promise<HTMLElement | null> {
  return focusWhenPresent(EDITOR_FIRST_FIELD);
}
