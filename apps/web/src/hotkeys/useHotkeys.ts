import { useEffect, useRef } from "react";
import { HOTKEYS, type HotkeyDef } from "./keymap.js";

export type HotkeyHandler = (def: HotkeyDef, e: KeyboardEvent) => void;

interface Combo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseCombo(s: string): Combo {
  const parts = s.toLowerCase().split("+");
  return {
    key: parts[parts.length - 1]!,
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

export function eventMatches(e: KeyboardEvent, combo: Combo): boolean {
  const mod = e.ctrlKey || e.metaKey;
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  const wantsShiftedSymbol = ["?", "\\", "[", "]", "/", "{", "}"].includes(combo.key);
  // For symbol keys, don't require shift state to match (e.g. "?" is shift+/ on most layouts).
  if (wantsShiftedSymbol) return key === combo.key && mod === combo.mod && e.altKey === combo.alt;
  return key === combo.key && mod === combo.mod && e.shiftKey === combo.shift && e.altKey === combo.alt;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global hotkey dispatcher with chord support. Returns the pending chord prefix
 * via the `onChord` callback so the UI can show "g …" in the status bar.
 */
export function useHotkeys(handler: HotkeyHandler, opts: { enabled?: boolean; onChord?: (prefix: string | null) => void } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (opts.enabled === false) return;
    const clearPending = () => {
      pending.current = null;
      opts.onChord?.(null);
      if (timer.current) window.clearTimeout(timer.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const editing = isEditable(e.target);
      const single = HOTKEYS.filter((h) => !h.keys.includes(" "));
      const chords = HOTKEYS.filter((h) => h.keys.includes(" "));

      // Chord continuation
      if (pending.current) {
        const prefix = pending.current;
        clearPending();
        for (const h of chords) {
          const [first, second] = h.keys.split(" ");
          if (first === prefix && eventMatches(e, parseCombo(second!))) {
            e.preventDefault();
            handlerRef.current(h, e);
            return;
          }
        }
        return; // unknown chord → swallow silently
      }

      // Single combos
      for (const h of single) {
        if (editing && !h.global) continue;
        if (eventMatches(e, parseCombo(h.keys))) {
          e.preventDefault();
          handlerRef.current(h, e);
          return;
        }
      }
      // Chord starters
      if (!editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const starters = new Set(chords.map((h) => h.keys.split(" ")[0]!));
        const k = e.key.toLowerCase();
        if (starters.has(k)) {
          e.preventDefault();
          pending.current = k;
          opts.onChord?.(k);
          timer.current = window.setTimeout(clearPending, 900);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPending();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);
}
