import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keyTokens } from "../hotkeys/keymap.js";
import { restoreFocus, useModalRegistration } from "./Modal.js";

export interface MenuItem {
  label: string;
  run: () => void;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * Right-click menu (role=menu) with roving focus: the active `menuitem` owns
 * the focus and the menu carries `aria-activedescendant` (N-06). ↑/↓/Home/End,
 * Enter/Space activate, Esc closes; outside click closes; focus returns to the opener.
 */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [idx, setIdx] = useState(0);
  const baseId = useId();
  useModalRegistration();
  const enabled = menu.items.filter((i) => !i.disabled);
  useEffect(() => {
    opener.current = document.activeElement;
    const el = ref.current;
    if (!el) return;
    // keep inside the viewport
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`;
    const onDown = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      restoreFocus(opener.current);
    };
  }, [onClose]);
  // Roving tabindex: focus follows the active item.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[id="${baseId}-${idx}"]`)?.focus();
  }, [idx, baseId]);
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (i + 1) % enabled.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (i - 1 + enabled.length) % enabled.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const it = enabled[idx];
      if (it) {
        it.run();
        onClose();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      setIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIdx(enabled.length - 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };
  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Kontextmenü"
      aria-activedescendant={`${baseId}-${idx}`}
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it) => {
        const i = enabled.indexOf(it);
        return (
          <button
            key={it.label}
            id={i >= 0 ? `${baseId}-${i}` : undefined}
            role="menuitem"
            tabIndex={i === idx ? 0 : -1}
            className={`item ${it.danger ? "danger" : ""} ${i === idx ? "active" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => i >= 0 && setIdx(i)}
            onClick={() => {
              it.run();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.keys && <span className="keys">{keyTokens(it.keys).map((combo, ci) => combo.map((k) => <kbd key={`${ci}-${k}`}>{k}</kbd>))}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
