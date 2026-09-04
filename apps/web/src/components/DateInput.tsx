import { useEffect, useId, useRef, useState } from "react";
import { DATE_PRESETS, formatDateInput, parseDateInput } from "../lib/date-parse.js";
import { useStore } from "../state/store.js";
import { useFieldLabel } from "./FieldLabel.js";
import { usePopover } from "./Popover.js";

export interface DateInputProps {
  value: number;
  onChange: (v: number) => void;
  invalid?: boolean;
  /** Accessible name; defaults to the label of the enclosing form field (R3-03). */
  ariaLabel?: string;
  /** Compact variant for table cells. */
  inline?: boolean;
  /** Reference date for absolute tenors ("10y"); defaults to the valuation date. */
  base?: number;
  testId?: string;
  disabled?: boolean;
}

/**
 * Tenor-aware date field (F-39): a text input that accepts `10y`, `+6m`,
 * `31.12.2027`, `2027-12-31`, `heute`, `spot`, `me`, `je`, with ↑/↓ stepping by
 * one day (⇧ one month, ⌥ one year) and a calendar-free popover of presets
 * (▾ button or Alt+↓). Invalid text is flagged and never committed; `Esc`
 * restores the value the field had when it received focus (R3-10). The presets
 * popover is a registered popover layer (Esc / click outside / focus return,
 * R3-02) that keeps the edit session open: opening it never commits the typed
 * draft, `Esc` closes it and a second `Esc` discards the draft (R4-04).
 */
export function DateInput({ value, onChange, invalid, ariaLabel, inline, base, testId, disabled }: DateInputProps) {
  const valuationDate = useStore((s) => s.valuationDate);
  const label = useFieldLabel(ariaLabel);
  const ref = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(formatDateInput(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const initial = useRef(value);
  const cancelling = useRef(false);
  /** Set while the presets popover owns the focus: the blur must not commit and the returning focus must keep the draft. */
  const presets = useRef(false);
  /** True between closing the popover and the focus returning to the input – the draft is still shown meanwhile. */
  const [resuming, setResuming] = useState(false);
  const listId = useId();
  const formatted = formatDateInput(value);
  const refDate = base ?? valuationDate;
  const editing = focused || open || resuming;

  useEffect(() => {
    if (!editing) setText(formatted);
  }, [formatted, editing]);

  const closePresets = () => {
    presets.current = true; // focus returns to the input → keep the draft
    setResuming(true);
    setOpen(false);
  };
  usePopover(open, closePresets, { anchor: wrap, panel, restoreTo: ref });

  const commit = (raw: string): boolean => {
    const d = parseDateInput(raw, { base: refDate, current: value });
    if (d === undefined) {
      setBad(raw.trim() !== "");
      return false;
    }
    setBad(false);
    if (d !== value) onChange(d);
    setText(formatDateInput(d));
    return true;
  };
  const step = (dir: 1 | -1, unit: "d" | "m" | "y") => {
    const d = parseDateInput(`${dir > 0 ? "+" : "-"}1${unit}`, { base: refDate, current: value });
    if (d !== undefined) {
      onChange(d);
      setText(formatDateInput(d));
      setBad(false);
    }
  };
  const pick = (input: string) => {
    commit(input);
    closePresets();
  };
  const cancel = () => {
    cancelling.current = true;
    const v = initial.current;
    if (v !== value) onChange(v);
    setText(formatDateInput(v));
    setBad(false);
    ref.current?.blur();
  };
  const togglePresets = () => {
    if (open) closePresets();
    else {
      if (!focused) {
        // opened via ▾ without focus: start an edit session so Esc can restore this value
        initial.current = value;
        setText(formatted);
      }
      presets.current = true;
      setOpen(true);
    }
  };

  return (
    <span ref={wrap} className={`date-input ${inline ? "inline" : ""}`}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        className={`mono ${inline ? "inline" : ""}`}
        value={editing ? text : formatted}
        aria-label={label}
        aria-invalid={invalid || bad || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-testid={testId}
        disabled={disabled}
        placeholder="tt.mm.jjjj · 10y · +6m"
        title="Datum (tt.mm.jjjj, ISO), Tenor ab Bewertungstag (10y, 6m) oder relativ (+6m, -1y); ↑/↓ Tag, ⇧ Monat, ⌥ Jahr; Alt+↓ Vorlagen (Esc schließt, zweites Esc verwirft)"
        onFocus={() => {
          if (presets.current) {
            // focus comes back from the presets popover – the draft stays a draft
            presets.current = false;
            setResuming(false);
            setFocused(true);
            return;
          }
          setResuming(false);
          initial.current = value;
          cancelling.current = false;
          setText(formatted);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          if (cancelling.current) {
            cancelling.current = false;
            return;
          }
          // The presets popover took the focus: no commit, the typed text remains a draft (R4-04).
          if (presets.current || open) return;
          if (!commit(text)) setText(formatted);
          setBad(false);
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (bad) setBad(parseDateInput(e.target.value, { base: refDate, current: value }) === undefined && e.target.value.trim() !== "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (commit(text)) ref.current?.blur();
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.altKey) {
            e.preventDefault();
            togglePresets();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            step(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? "m" : e.altKey ? "y" : "d");
          } else if (e.key === "Escape" && !open) {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
      />
      {!disabled && (
        <button
          type="button"
          className="date-presets-btn"
          aria-label="Datums-Vorlagen"
          aria-expanded={open}
          title="Vorlagen (Tenor ab Bewertungstag, relativ, Monats-/Jahresende) – die Eingabe bleibt Entwurf"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()} // keep the focus in the input – no blur commit (R4-04)
          onClick={togglePresets}
        >
          ▾
        </button>
      )}
      {open && (
        <div ref={panel} className="popover date-presets" role="listbox" id={listId} aria-label="Datums-Vorlagen">
          {DATE_PRESETS.map((p) => {
            const d = parseDateInput(p.input, { base: refDate, current: value });
            return (
              <button
                key={p.label}
                type="button"
                role="option"
                aria-selected={false}
                className="chip mono"
                title={d !== undefined ? formatDateInput(d) : ""}
                onClick={() => pick(p.input)}
              >
                {p.label}
              </button>
            );
          })}
          <span className="muted xs" style={{ flexBasis: "100%" }}>
            Tenor ab Bewertungstag · <kbd>+6m</kbd> relativ zum Feld · <kbd>me</kbd>/<kbd>je</kbd> Monats-/Jahresende · <kbd>Esc</kbd> schließt, zweites{" "}
            <kbd>Esc</kbd> verwirft die Eingabe
          </span>
        </div>
      )}
      {bad && (
        <span className="field-msg error" role="alert">
          Datum nicht lesbar (tt.mm.jjjj, 2027-12-31, 10y, +6m)
        </span>
      )}
    </span>
  );
}
