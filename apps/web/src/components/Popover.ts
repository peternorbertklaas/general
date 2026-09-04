import { useEffect, useRef, type RefObject } from "react";
import { useStore } from "../state/store.js";
import { focusables, restoreFocus } from "./Modal.js";

export interface PopoverOptions {
  /** Element that contains toggle + popover – clicks inside keep the popover open. */
  anchor: RefObject<HTMLElement | null>;
  /** Popover panel; the first focusable child receives focus on open (unless `autoFocus` is false). */
  panel: RefObject<HTMLElement | null>;
  /** Element that gets the focus back when the popover closes (default: the element focused when it opened). */
  restoreTo?: RefObject<HTMLElement | null>;
  autoFocus?: boolean;
}

/**
 * Light-weight dialog semantics for non-modal popovers (Export ▾, Spalten,
 * Datums-Vorlagen, Bewertungshinweise – R3-02): while open, background
 * hotkeys are suspended (`popoverDepth` in the store), `Esc` closes wherever
 * the focus is (capture listener on `document`), a click outside the anchor
 * closes, focus moves into the panel and returns to the opener on close.
 */
export function usePopover(open: boolean, onClose: () => void, opts: PopoverOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!open) return;
    const st = useStore.getState();
    st.openPopover();
    const opener = optsRef.current.restoreTo?.current ?? (document.activeElement as HTMLElement | null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    const onDown = (e: MouseEvent) => {
      const a = optsRef.current.anchor.current;
      if (a && !a.contains(e.target as Node)) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    if (optsRef.current.autoFocus !== false) {
      const panel = optsRef.current.panel.current;
      // `focusables` filters by layout (offsetParent) – fall back to the first focusable element where layout is unavailable (jsdom).
      const first = () =>
        panel
          ? (focusables(panel)[0] ??
            panel.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, [tabindex]:not([tabindex="-1"])') ??
            panel)
          : null;
      if (panel) window.setTimeout(() => first()?.focus(), 0);
    }
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      useStore.getState().closePopover();
      restoreFocus(optsRef.current.restoreTo?.current ?? opener);
    };
  }, [open]);
}

/**
 * Roving focus for `role="menu"` popovers: ↑/↓ move between the enabled
 * `menuitem`s, Home/End jump; Enter/Space activate the focused button natively.
 */
export function menuKeyNav(e: React.KeyboardEvent<HTMLElement>): void {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  switch (e.key) {
    case "ArrowDown":
      next = i < 0 ? 0 : (i + 1) % items.length;
      break;
    case "ArrowUp":
      next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = items.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  items[next]?.focus();
}
