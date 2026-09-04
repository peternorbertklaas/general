import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { decimalsOf, formatNumberInput, isNumberPrefix, parseNumberInput } from "../lib/num-parse.js";
import { useFieldLabel } from "./FieldLabel.js";

export interface NumInputProps {
  value: number;
  onChange: (v: number) => void;
  /** Step of ↑/↓ in display units (Shift ×10, Alt ×0.1). */
  step?: number;
  /** Display scale: 100 for percent, 1e4 for basis points. Stored value = shown / scale. */
  scale?: number;
  /** Unit adornment rendered inside the input (%, bp, EUR, Tage). */
  unit?: string;
  /** Maximum display decimals (default: derived from step, at least 2 for scaled fields). */
  digits?: number;
  min?: number;
  max?: number;
  /** Compact variant for table cells. */
  inline?: boolean;
  /** Validation message from the trade validator; sets aria-invalid + red border. */
  error?: string;
  level?: "error" | "warn";
  /** Accessible name; defaults to the label of the enclosing form field (R3-03). */
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: CSSProperties;
  width?: number | string;
  /** Test id for e2e. */
  testId?: string;
  /** `-1` for inputs inside a roving-tabindex table row (the row is the tab stop, Enter/F2 focus the input – R6-02). */
  tabIndex?: number;
  onCommit?: (v: number) => void;
}

/**
 * Numeric text input (type=text, inputMode=decimal) with local string state:
 * German decimal comma, thousands grouping on blur, trader shorthand
 * ("10m", "250k", "25bp", "3,1%"), ↑/↓ stepping and a unit suffix. The model
 * is updated on every parsable keystroke; the field never snaps to "0" while
 * the user is typing or clearing it. `Enter` commits and leaves the field,
 * `Esc` restores the value the field had when it received focus (R3-10).
 * In print the input is rendered as static text (CSS, R3-04).
 */
export function NumInput(props: NumInputProps) {
  const {
    value,
    onChange,
    step,
    scale = 1,
    unit,
    digits,
    min,
    max,
    inline,
    error,
    level = "error",
    ariaLabel,
    placeholder,
    disabled,
    style,
    width,
    testId,
    tabIndex,
    onCommit,
  } = props;
  const label = useFieldLabel(ariaLabel);
  const maxDigits = digits ?? Math.max(scale === 1 ? 0 : 2, decimalsOf((step ?? 1) * 1));
  const formatted = formatNumberInput(value, scale, 0, Math.max(maxDigits, 2));
  const [text, setText] = useState(formatted);
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  /** Value at focus time – restored by Esc. */
  const initial = useRef(value);
  /** Set while Esc cancels an edit so the following blur does not commit the typed text. */
  const cancelling = useRef(false);
  const errId = useId();

  // Keep the shown text in sync while not focused.
  useEffect(() => {
    if (!focused) setText(formatted);
  }, [formatted, focused]);

  const clamp = (v: number) => {
    let out = v;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
  };

  const commitText = (raw: string): number | undefined => {
    if (raw.trim() === "") return undefined;
    const p = parseNumberInput(raw, scale);
    if (!p) return undefined;
    const v = clamp(p.value);
    if (v !== value) onChange(v);
    return v;
  };

  const stepBy = (dir: 1 | -1, mult: number) => {
    const s = (step ?? (scale === 100 ? 0.01 : 1)) * mult;
    const shown = value * scale;
    const decimals = Math.max(decimalsOf(s), maxDigits);
    const next = Number((shown + dir * s).toFixed(decimals));
    const v = clamp(next / scale);
    onChange(v);
    setText(formatNumberInput(v, scale, 0, Math.max(maxDigits, decimals)));
    setLocalError(null);
  };

  const cancel = () => {
    cancelling.current = true;
    const v = initial.current;
    if (v !== value) onChange(v);
    setText(formatNumberInput(v, scale, 0, Math.max(maxDigits, 2)));
    setLocalError(null);
    ref.current?.blur();
  };

  const msg = error ?? localError ?? undefined;
  const invalid = !!(error && level === "error") || !!localError;
  const input = (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={`num-input ${inline ? "inline" : ""}`}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={msg ? errId : undefined}
      data-testid={testId}
      placeholder={placeholder}
      disabled={disabled}
      tabIndex={tabIndex}
      style={{ ...(width !== undefined ? { width } : {}), ...style, textAlign: "right" }}
      value={focused ? text : formatted}
      onFocus={() => {
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
        const v = commitText(text);
        setLocalError(null);
        if (v !== undefined) {
          onCommit?.(v);
          setText(formatNumberInput(v, scale, 0, Math.max(maxDigits, 2)));
        } else setText(formatted);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          stepBy(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const v = commitText(text);
          if (v !== undefined) onCommit?.(v);
          ref.current?.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") {
          setLocalError(null);
          return;
        }
        const p = parseNumberInput(raw, scale);
        if (p) {
          setLocalError(null);
          const v = clamp(p.value);
          if (v !== value) onChange(v);
        } else setLocalError(isNumberPrefix(raw) ? null : "Ungültige Zahl (z. B. 3,25 · 10m · 25bp)");
      }}
    />
  );
  const body = unit ? (
    <span className={`input-unit ${inline ? "inline" : ""}`}>
      {input}
      <span className="unit">{unit}</span>
    </span>
  ) : (
    input
  );
  if (!msg) return body;
  return (
    <>
      {body}
      <span
        id={errId}
        className={`field-msg ${level === "warn" && !localError ? "warn" : "error"}`}
        role={level === "error" || localError ? "alert" : undefined}
      >
        {msg}
      </span>
    </>
  );
}

/** Like NumInput, but an empty field means "not set" (undefined). */
export function OptNumInput({
  value,
  onChange,
  placeholder,
  ...rest
}: Omit<NumInputProps, "value" | "onChange" | "min" | "max"> & { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  const { scale = 1, step, digits, unit, inline, error, level = "error", ariaLabel, disabled, style, width, testId, tabIndex } = rest;
  const label = useFieldLabel(ariaLabel);
  const maxDigits = digits ?? Math.max(scale === 1 ? 0 : 2, decimalsOf(step ?? 1));
  const formatted = value === undefined ? "" : formatNumberInput(value, scale, 0, Math.max(maxDigits, 2));
  const [text, setText] = useState(formatted);
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const initial = useRef(value);
  const errId = useId();
  useEffect(() => {
    if (!focused) setText(formatted);
  }, [formatted, focused]);
  const msg = error ?? localError ?? undefined;
  const input = (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={`num-input ${inline ? "inline" : ""}`}
      aria-label={label}
      aria-invalid={!!localError || (!!error && level === "error") || undefined}
      aria-describedby={msg ? errId : undefined}
      data-testid={testId}
      placeholder={placeholder}
      disabled={disabled}
      tabIndex={tabIndex}
      style={{ ...(width !== undefined ? { width } : {}), ...style, textAlign: "right" }}
      value={focused ? text : formatted}
      onFocus={() => {
        initial.current = value;
        setText(formatted);
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
        setLocalError(null);
      }}
      onKeyDown={(e) => {
        if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== undefined) {
          e.preventDefault();
          const s = (step ?? 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
          const decimals = Math.max(decimalsOf(s), maxDigits);
          const next = Number((value * scale + (e.key === "ArrowUp" ? s : -s)).toFixed(decimals)) / scale;
          onChange(next);
          setText(formatNumberInput(next, scale, 0, Math.max(maxDigits, decimals)));
        } else if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          // Esc restores the value the field had on focus (R3-10).
          e.preventDefault();
          e.stopPropagation();
          const v = initial.current;
          if (v !== value) onChange(v);
          setText(v === undefined ? "" : formatNumberInput(v, scale, 0, Math.max(maxDigits, 2)));
          setLocalError(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") {
          setLocalError(null);
          onChange(undefined);
          return;
        }
        const p = parseNumberInput(raw, scale);
        if (p) {
          setLocalError(null);
          onChange(p.value);
        } else setLocalError(isNumberPrefix(raw) ? null : "Ungültige Zahl");
      }}
    />
  );
  const body = unit ? (
    <span className={`input-unit ${inline ? "inline" : ""}`}>
      {input}
      <span className="unit">{unit}</span>
    </span>
  ) : (
    input
  );
  if (!msg) return body;
  return (
    <>
      {body}
      <span id={errId} className={`field-msg ${level === "warn" && !localError ? "warn" : "error"}`}>
        {msg}
      </span>
    </>
  );
}
