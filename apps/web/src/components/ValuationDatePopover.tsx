import { useEffect, useRef, useState } from "react";
import { toISO } from "@deriva/pricing-core";
import { formatDateInput, parseDateInput } from "../lib/date-parse.js";
import { useStore } from "../state/store.js";
import { useFocusTrap } from "./Modal.js";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Preset dates relative to the current valuation date / today. */
export function datePresets(currentIso: string): { label: string; iso: string }[] {
  const cur = new Date(`${currentIso}T00:00:00`);
  const today = new Date();
  const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
  const q = Math.floor(cur.getMonth() / 3);
  const quarterEnd = new Date(cur.getFullYear(), q * 3 + 3, 0);
  const minus1 = new Date(cur);
  minus1.setDate(minus1.getDate() - 1);
  return [
    { label: "Heute", iso: isoOf(today) },
    { label: "Monatsende", iso: isoOf(monthEnd) },
    { label: "Quartalsende", iso: isoOf(quarterEnd) },
    { label: "−1 Tag", iso: isoOf(minus1) },
  ];
}

/**
 * Popover under the topbar chip: tenor-aware date input (dd.mm.yyyy, ISO,
 * "+1m", "me") + presets; Enter/Übernehmen sets the valuation date.
 */
export function ValuationDatePopover() {
  const valuationDate = useStore((s) => s.valuationDate);
  const current = toISO(valuationDate);
  const [text, setText] = useState(formatDateInput(valuationDate));
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Not a modal (the app stays interactive); background hotkeys are filtered via `valDateOpen`.
  useFocusTrap(ref, { initial: input });
  const close = () => useStore.getState().setValDateOpen(false);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const apply = (iso: string) => {
    const st = useStore.getState();
    if (st.setValuationDate(iso)) {
      st.showToast(`Bewertungstag ${iso.split("-").reverse().join(".")}`);
      close();
    } else st.showToast("Ungültiges Datum");
  };
  const applyText = () => {
    const d = parseDateInput(text, { base: valuationDate, current: valuationDate });
    if (d === undefined) {
      setBad(true);
      return;
    }
    apply(toISO(d));
  };
  return (
    <div
      ref={ref}
      className="popover valdate"
      role="dialog"
      aria-modal="true"
      aria-label="Bewertungstag"
      data-testid="valdate-popover"
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
    >
      <div className="field">
        <label htmlFor="valdate-input">Bewertungstag</label>
        <div className="row">
          <input
            id="valdate-input"
            ref={input}
            type="text"
            inputMode="numeric"
            className="mono"
            value={text}
            aria-invalid={bad || undefined}
            placeholder="tt.mm.jjjj · +1m · me"
            onChange={(e) => {
              setText(e.target.value);
              setBad(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyText())}
          />
          <button className="btn primary" onClick={applyText}>
            Übernehmen
          </button>
        </div>
        {bad && (
          <span className="field-msg error" role="alert">
            Datum nicht lesbar (tt.mm.jjjj, 2026-12-31, +1m, me)
          </span>
        )}
      </div>
      <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
        {datePresets(current).map((p) => (
          <button key={p.label} className="chip" onClick={() => apply(p.iso)} title={p.iso}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="muted xs" style={{ marginTop: 8 }}>
        Palette: <code className="mono">stichtag 2026-12-31</code> · Hotkey <kbd>⇧</kbd>
        <kbd>T</kbd> · Quotes und Interpolation bleiben erhalten
      </div>
    </div>
  );
}
