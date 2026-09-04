import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../state/store.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Restore focus to the element that was focused before a dialog opened. The
 * app shell is still `inert` while the dialog's cleanup runs (the attribute is
 * removed in the same commit), so focusing synchronously is a no-op in real
 * browsers (N-03). Defer to the next frame / macrotask and retry once.
 */
export function restoreFocus(el: Element | null): void {
  const p = el as HTMLElement | null;
  if (!p || typeof p.focus !== "function") return;
  const attempt = () => {
    if (!document.contains(p)) return false;
    p.focus();
    return document.activeElement === p;
  };
  const schedule = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : window.setTimeout(fn, 0));
  schedule(() => {
    if (!attempt()) window.setTimeout(attempt, 0);
  });
}

/**
 * Focus trap for dialogs: Tab cycles inside `ref`, focus is moved into the
 * dialog on mount and restored to the previously focused element on unmount.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, opts: { autoFocus?: boolean; initial?: React.RefObject<HTMLElement | null> } = {}) {
  const prev = useRef<Element | null>(null);
  // The trap is installed once per mount; the options are read at that moment (a fresh object per render must not re-run it).
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const o = optsRef.current;
    prev.current = document.activeElement;
    const root = ref.current;
    if (root && o.autoFocus !== false) {
      const target = o.initial?.current ?? focusables(root)[0] ?? root;
      window.setTimeout(() => target.focus(), 0);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const els = focusables(ref.current);
      if (els.length === 0) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      restoreFocus(prev.current);
    };
  }, [ref]);
}

/** Registers an open modal in the store so background hotkeys are suspended. */
export function useModalRegistration() {
  const open = useStore((s) => s.openModal);
  const close = useStore((s) => s.closeModal);
  useEffect(() => {
    open();
    return () => close();
  }, [open, close]);
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  /** Extra class on the sheet (e.g. "doc" for printable documents). */
  className?: string;
  testId?: string;
}

/**
 * Accessible modal dialog rendered into `document.body`: role=dialog,
 * aria-modal, focus trap, autofocus, close button, Esc closes, focus restore.
 */
export function Modal({ title, onClose, children, footer, width, className, testId }: ModalProps) {
  const sheet = useRef<HTMLDivElement>(null);
  useFocusTrap(sheet);
  useModalRegistration();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={sheet}
        className={`modal ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={width !== undefined ? { width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
