import { useCallback, useState } from "react";
import { HOTKEYS, keyList } from "../hotkeys/keymap.js";
import { copyText } from "../lib/indication.js";
import { useStore } from "../state/store.js";

export interface TableNavOptions {
  /** Called when Enter is pressed on a row (index within tbody). */
  onEnter?: (rowIndex: number, tr: HTMLTableRowElement) => void;
  /** Called after a row was copied with `y y`. */
  onCopied?: (text: string) => void;
  /** Custom text for `y y`; default: cell texts joined by tabs. */
  rowText?: (rowIndex: number, tr: HTMLTableRowElement) => string;
  /** Called when a row receives focus via keyboard navigation. */
  onFocusRow?: (rowIndex: number) => void;
  /** Page size for PageUp/PageDown (default 10). */
  pageSize?: number;
}

export interface RowPropsOptions {
  /**
   * Explicit "active" row (e.g. the selected blotter trade). When given, this row
   * is the table's single tab stop; otherwise the last focused row (default: first).
   */
  active?: boolean;
  /** `aria-selected` – only valid on rows of a `role="grid"` table (N-13). */
  selected?: boolean;
  /** Marks a row that the global Enter hotkey may "open" (N-02). */
  trade?: boolean;
}

export interface NavRowProps {
  tabIndex: number;
  role: "row";
  "aria-selected"?: boolean;
  "data-nav"?: "trade";
}

/** First keys of all registered chords ("g", "n", "o", "x", "y") – the table never consumes them (R4-02). */
export const CHORD_STARTERS: ReadonlySet<string> = new Set(
  HOTKEYS.flatMap((h) =>
    keyList(h)
      .filter((k) => k.includes(" "))
      .map((k) => k.split(" ")[0]!),
  ),
);

function rowsOf(tbody: HTMLElement): HTMLTableRowElement[] {
  return Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
}

/**
 * Keyboard navigation for data tables: attach `onKeyDown` and `onFocus` to
 * `<tbody>` and spread `rowProps(i, count, …)` on every row. ↑/↓ move,
 * Home/End jump, PageUp/PageDown page, Enter opens (`onEnter`), `y y` copies
 * the row as text (`y` alone is the chord prefix of `y i`, R4-02).
 *
 * Roving tabindex (R4-03): only one row per table is a tab stop (`tabIndex=0`,
 * the active/selected or last focused row), all others carry `-1`, so `Tab`
 * leaves the table after a single stop and the arrow keys move within it.
 */
export function useTableNav(opts: TableNavOptions = {}) {
  const [activeIndex, setActiveIndex] = useState(0);

  const focusRow = useCallback(
    (tr: HTMLTableRowElement | undefined, rows: HTMLTableRowElement[]) => {
      if (!tr) return;
      tr.focus({ preventScroll: true });
      tr.scrollIntoView?.({ block: "nearest" });
      const i = rows.indexOf(tr);
      setActiveIndex(i);
      opts.onFocusRow?.(i);
    },
    [opts],
  );

  const onFocus = useCallback((e: React.FocusEvent<HTMLTableSectionElement>) => {
    const tr = (e.target as HTMLElement).closest("tr");
    if (!tr || tr.parentElement !== e.currentTarget) return;
    const i = rowsOf(e.currentTarget).indexOf(tr as HTMLTableRowElement);
    if (i >= 0) setActiveIndex(i);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
      const target = e.target as HTMLElement;
      const tr = target.closest("tr") as HTMLTableRowElement | null;
      if (!tr || target !== tr) return; // inputs inside cells keep their own keys
      const tbody = e.currentTarget;
      const rows = rowsOf(tbody);
      const i = rows.indexOf(tr);
      if (i < 0) return;
      const page = opts.pageSize ?? 10;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          focusRow(rows[Math.min(rows.length - 1, i + 1)], rows);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusRow(rows[Math.max(0, i - 1)], rows);
          break;
        case "Home":
          e.preventDefault();
          focusRow(rows[0], rows);
          break;
        case "End":
          e.preventDefault();
          focusRow(rows[rows.length - 1], rows);
          break;
        case "PageDown":
          e.preventDefault();
          focusRow(rows[Math.min(rows.length - 1, i + page)], rows);
          break;
        case "PageUp":
          e.preventDefault();
          focusRow(rows[Math.max(0, i - page)], rows);
          break;
        case "Enter":
          if (opts.onEnter) {
            e.preventDefault();
            // The global "open" hotkey must not fire a second time for the same key press (N-02).
            e.stopPropagation();
            opts.onEnter(i, tr);
          }
          break;
        case "y":
        case "Y": {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          // Chords take precedence (R4-02): the first `y` starts the chord in the
          // global dispatcher ("y i" = Indikation); the table copies on the second `y`.
          const prefix = useStore.getState().chordPrefix;
          if (prefix !== "y" && CHORD_STARTERS.has("y")) return;
          e.preventDefault();
          const text =
            opts.rowText?.(i, tr) ??
            Array.from(tr.cells)
              .map((c) => (c.innerText ?? c.textContent ?? "").trim())
              .join("\t");
          void copyText(text).then((ok) => ok && opts.onCopied?.(text));
          break;
        }
      }
    },
    [opts, focusRow],
  );

  const rowProps = useCallback(
    (index: number, count: number, o: RowPropsOptions = {}): NavRowProps => {
      const fallback = Math.min(activeIndex, Math.max(0, count - 1));
      const isActive = o.active !== undefined ? o.active : index === fallback;
      const base: NavRowProps = { tabIndex: isActive ? 0 : -1, role: "row" };
      if (o.selected !== undefined) base["aria-selected"] = o.selected;
      if (o.trade) base["data-nav"] = "trade";
      return base;
    },
    [activeIndex],
  );

  return { onKeyDown, onFocus, rowProps };
}
