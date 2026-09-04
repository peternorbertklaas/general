/**
 * Deferred focus helpers (R7-03). A view that was just switched to may still be
 * rendering (lazy chunk, Suspense) and a closing dialog restores its opener's
 * focus a frame later (`restoreFocus`), so a synchronous `focus()` would be
 * lost. `focusWhenPresent` polls the selector for a few frames and focuses the
 * first match once it exists – idempotent, never throws, no-op in SSR.
 */

const FRAMES = 30;

/**
 * Focus the first *enabled* element matching `selector` as soon as it is in the DOM (≤ `frames` animation frames).
 * A disabled control never takes the focus (R9-03: „+ Kurve“ is locked under an imported snapshot – the caller names an
 * enabled fallback instead). Resolves with the element or null.
 */
export function focusWhenPresent(selector: string, frames = FRAMES): Promise<HTMLElement | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const schedule = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : window.setTimeout(fn, 16));
  return new Promise((resolve) => {
    let left = frames;
    const attempt = () => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((c) => !c.hasAttribute("disabled") && !c.matches(":disabled"));
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

/**
 * Focus the first of several candidate selectors that is present and enabled (R9-03): e.g. „+ Kurve“, otherwise
 * „Zum Sample-Markt“, otherwise „+ Währung“. Candidates are tried in order, each for a few frames.
 */
export async function focusFirstEnabled(selectors: string[], frames = 6): Promise<HTMLElement | null> {
  for (const sel of selectors) {
    const el = await focusWhenPresent(sel, frames);
    if (el) return el;
  }
  return null;
}

/**
 * After a table row was removed by keyboard (R9-04): focus the row that now sits at the removed row's position (or
 * the last one), or – when the table is empty – the control matching `fallback` (the „+ Zeile“ button). Call it
 * *before* the removal with the row that is about to go; the focus moves in the next macrotask, after React re-rendered.
 * The neighbour is chosen by DOM *position*, never by node identity (R10-02): with positional keys (`key={i}`) React
 * reuses the removed row's `<tr>` node for the row that moves up, so filtering that node out would skip the neighbour.
 */
export function focusNeighbourAfterRemoval(tr: HTMLTableRowElement | null | undefined, fallback: string): void {
  if (!tr) return;
  const tbody = tr.parentElement;
  const index = tbody ? Array.from(tbody.children).indexOf(tr) : -1;
  window.setTimeout(() => {
    const rows = tbody && document.contains(tbody) ? Array.from(tbody.querySelectorAll<HTMLElement>(":scope > tr")) : [];
    const target = rows[Math.min(Math.max(index, 0), rows.length - 1)];
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
    const control = Array.from(document.querySelectorAll<HTMLElement>(fallback)).find((c) => !c.hasAttribute("disabled"));
    if (control) control.focus({ preventScroll: true });
    else void focusWhenPresent(fallback);
  }, 0);
}

/**
 * `Esc` inside an inline form (`+ Kurve`, `+ Währung`) closes it and returns the focus to its button (R9-02) – like
 * „Abbrechen“. Number and date fields consume their own `Esc` (restore the value) first, so this fires on the second
 * press there. Attach as `onKeyDown` of the form card.
 */
export function escapeCloses(close: () => void): (e: { key: string; defaultPrevented: boolean; preventDefault(): void; stopPropagation(): void }) => void {
  return (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
}

/** Selector of the first field of the trade editor ("Bezeichnung"). */
export const EDITOR_FIRST_FIELD = 'input[aria-label="Bezeichnung"]';

/** After a trade was created (chord `n …`, palette quick entry): focus the editor's first field (R7-03). */
export function focusEditorField(): Promise<HTMLElement | null> {
  return focusWhenPresent(EDITOR_FIRST_FIELD);
}
