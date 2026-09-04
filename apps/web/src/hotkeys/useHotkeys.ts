import { useEffect, useRef } from "react";
import { HOTKEYS, keyList, type HotkeyDef } from "./keymap.js";

export type HotkeyHandler = (def: HotkeyDef, e: KeyboardEvent) => void;

interface Combo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Symbol keys whose physical position depends on the keyboard layout. On a
 * German layout `]`, `[`, `\`, `{`, `}` need AltGr (Windows: ctrlKey+altKey) or
 * Option (macOS: altKey); `?` needs Shift. For these keys the modifier state is
 * ignored as long as `e.key` produced the symbol itself.
 */
export const SYMBOL_KEYS = new Set(["?", "\\", "[", "]", "/", "{", "}", "+", "-", "*", "#", "~", "0"]);

export function parseCombo(s: string): Combo {
  const parts = s.toLowerCase().split("+");
  // "mod++" (a literal plus) is not used; the last token is the key.
  const key = s.endsWith("+") ? "+" : parts[parts.length - 1]!;
  return {
    key,
    mod: parts.includes("mod") && key !== "mod",
    shift: parts.includes("shift") && key !== "shift",
    alt: parts.includes("alt") && key !== "alt",
  };
}

/** Key event → combo match. Layout-safe: see `SYMBOL_KEYS` and `alt+<digit>` via `e.code`. */
export function eventMatches(e: KeyboardEvent, combo: Combo): boolean {
  const mod = e.ctrlKey || e.metaKey;
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  if (key === "esc") key = "escape";
  if (key === "del") key = "delete";

  // Layout-neutral symbol keys: `e.key` is authoritative; Shift/Alt/AltGr may be needed to type them.
  if (SYMBOL_KEYS.has(combo.key) && !combo.mod && !combo.alt && !combo.shift) {
    if (key !== combo.key) return false;
    // Plain, Option (mac), AltGr (Windows = ctrl+alt) are fine; a pure Ctrl/⌘ chord is not the same key.
    return !mod || e.altKey;
  }

  // alt+<digit>: macOS Option+digit yields a special character ("¡", "“", …) → compare the physical key.
  if (combo.alt && !combo.mod && /^[0-9]$/.test(combo.key)) {
    if (!e.altKey || mod) return false;
    if (key === combo.key) return true;
    // A symbol hotkey produced with Option (e.g. Option+5 = "[" on a German Mac) wins over Alt+digit.
    if (SYMBOL_KEYS.has(e.key) && HOTKEYS.some((h) => keyList(h).includes(e.key))) return false;
    return e.code === `Digit${combo.key}` || e.code === `Numpad${combo.key}`;
  }

  return key === combo.key && mod === combo.mod && e.shiftKey === combo.shift && e.altKey === combo.alt;
}

/** Elements that accept text input – all single-key hotkeys are suspended while one has focus. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(type);
  }
  return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Editable / interactive elements: text entry plus buttons, links, `role=button`
 * and `<summary>` – activation keys (Enter, Space) must never double-fire there.
 */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (isTextEntry(el)) return true;
  const tag = el.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A" && (el as HTMLAnchorElement).hasAttribute("href")) return true;
  if (tag === "INPUT") return true; // checkbox / radio / range: Space & Enter belong to the control
  const role = el.getAttribute?.("role");
  return role === "button" || role === "menuitem" || role === "option" || role === "tab";
}

/**
 * Enter as "open" is only meaningful on the page body or a blotter trade row
 * (`tr[data-nav="trade"]`). Rows of other tables (pillars, scenarios, cashflows)
 * keep Enter for themselves (N-02).
 */
export function enterAllowed(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  // No element target (window/document) behaves like the body.
  if (!el || typeof el.tagName !== "string" || el === document.body || el === document.documentElement) return true;
  if (typeof el.closest !== "function") return false;
  return el.closest('tr[data-nav="trade"]') !== null && !isEditable(el);
}

const ACTIVATION_KEYS = new Set(["enter", "space"]);

export interface HotkeyOptions {
  enabled?: boolean;
  onChord?: (prefix: string | null) => void;
  /** Return false to suppress a definition (e.g. while a modal dialog is open). */
  filter?: (def: HotkeyDef) => boolean;
}

/**
 * Global hotkey dispatcher with chord support. Returns the pending chord prefix
 * via the `onChord` callback so the UI can show "g …" in the status bar.
 */
export function useHotkeys(handler: HotkeyHandler, opts: HotkeyOptions = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (opts.enabled === false) return;
    const clearPending = () => {
      pending.current = null;
      optsRef.current.onChord?.(null);
      if (timer.current) window.clearTimeout(timer.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const filter = optsRef.current.filter ?? (() => true);
      const editing = isTextEntry(e.target);
      const interactive = !editing && isEditable(e.target);
      // A definition may mix a single combo with a chord alias ("mod+e" / "x c"): match each notation by its own kind.
      const isChord = (k: string) => k.includes(" ");
      const single = HOTKEYS.filter((h) => keyList(h).some((k) => !isChord(k)));
      const chords = HOTKEYS.filter((h) => keyList(h).some(isChord));

      // Escape always cancels a pending chord.
      if (e.key === "Escape" && pending.current) {
        clearPending();
      }

      // Chord continuation
      if (pending.current) {
        const prefix = pending.current;
        clearPending();
        for (const h of chords) {
          if (!filter(h)) continue;
          for (const k of keyList(h).filter(isChord)) {
            const [first, second] = k.split(" ");
            if (first === prefix && second && eventMatches(e, parseCombo(second))) {
              e.preventDefault();
              handlerRef.current(h, e);
              return;
            }
          }
        }
        return; // unknown chord → swallow silently
      }

      // Single combos
      for (const h of single) {
        if (editing && !h.global) continue;
        if (!filter(h)) continue;
        for (const k of keyList(h).filter((x) => !isChord(x))) {
          const combo = parseCombo(k);
          // Enter/Space on a button, link or checkbox belong to that control (no double activation).
          if (interactive && ACTIVATION_KEYS.has(combo.key) && !combo.mod && !combo.alt) continue;
          if (combo.key === "enter" && !combo.mod && !combo.alt && !enterAllowed(e.target)) continue;
          if (eventMatches(e, combo)) {
            e.preventDefault();
            handlerRef.current(h, e);
            return;
          }
        }
      }
      // Chord starters
      if (!editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const starters = new Set(
          chords.filter(filter).flatMap((h) =>
            keyList(h)
              .filter(isChord)
              .map((k) => k.split(" ")[0]!),
          ),
        );
        const k = e.key.toLowerCase();
        if (starters.has(k)) {
          e.preventDefault();
          pending.current = k;
          optsRef.current.onChord?.(k);
          timer.current = window.setTimeout(clearPending, 900);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPending();
    };
  }, [opts.enabled]);
}
