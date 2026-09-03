import { useCallback } from "react";
import { copyText } from "../lib/indication.js";

export interface TableNavOptions {
  /** Called when Enter is pressed on a row (index within tbody). */
  onEnter?: (rowIndex: number, tr: HTMLTableRowElement) => void;
  /** Called after a row was copied with `y`. */
  onCopied?: (text: string) => void;
  /** Custom text for `y`; default: cell texts joined by tabs. */
  rowText?: (rowIndex: number, tr: HTMLTableRowElement) => string;
  /** Called when a row receives focus via keyboard navigation. */
  onFocusRow?: (rowIndex: number) => void;
  /** Page size for PageUp/PageDown (default 10). */
  pageSize?: number;
}

function rowsOf(tbody: HTMLElement): HTMLTableRowElement[] {
  return Array.from(tbody.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
}

function focusRow(tr: HTMLTableRowElement | undefined, opts: TableNavOptions, rows: HTMLTableRowElement[]) {
  if (!tr) return;
  tr.focus({ preventScroll: true });
  tr.scrollIntoView?.({ block: "nearest" });
  opts.onFocusRow?.(rows.indexOf(tr));
}

/**
 * Keyboard navigation for data tables: attach `onKeyDown` to `<tbody>` and give
 * rows `tabIndex={0}`. ↑/↓ move, Home/End jump, PageUp/PageDown page,
 * Enter opens (`onEnter`), `y` copies the row as text.
 */
export function useTableNav(opts: TableNavOptions = {}) {
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
          focusRow(rows[Math.min(rows.length - 1, i + 1)], opts, rows);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusRow(rows[Math.max(0, i - 1)], opts, rows);
          break;
        case "Home":
          e.preventDefault();
          focusRow(rows[0], opts, rows);
          break;
        case "End":
          e.preventDefault();
          focusRow(rows[rows.length - 1], opts, rows);
          break;
        case "PageDown":
          e.preventDefault();
          focusRow(rows[Math.min(rows.length - 1, i + page)], opts, rows);
          break;
        case "PageUp":
          e.preventDefault();
          focusRow(rows[Math.max(0, i - page)], opts, rows);
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
          e.preventDefault();
          const text =
            opts.rowText?.(i, tr) ??
            Array.from(tr.cells)
              .map((c) => c.innerText.trim())
              .join("\t");
          void copyText(text).then((ok) => ok && opts.onCopied?.(text));
          break;
        }
      }
    },
    [opts],
  );
  return { onKeyDown };
}

/**
 * Row attributes for a navigable, focusable table row. `aria-selected` is only
 * valid on rows of a `role="grid"` table – pass `selected` only there (N-13).
 * `trade: true` marks a row that the global Enter hotkey may "open" (N-02).
 */
export function navRowProps(
  selected?: boolean,
  opts: { trade?: boolean } = {},
): { tabIndex: number; role: "row"; "aria-selected"?: boolean; "data-nav"?: "trade" } {
  const base: { tabIndex: number; role: "row"; "aria-selected"?: boolean; "data-nav"?: "trade" } = { tabIndex: 0, role: "row" };
  if (selected !== undefined) base["aria-selected"] = selected;
  if (opts.trade) base["data-nav"] = "trade";
  return base;
}
