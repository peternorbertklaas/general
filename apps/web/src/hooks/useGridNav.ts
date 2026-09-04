import { useCallback, useState } from "react";

/**
 * Roving tabindex for editable grids (R7-01): the vol grids of the market
 * view (swaption cube, caplet surface, FX smile) are one tab stop each. The
 * active cell (`role="gridcell"`, `tabIndex=0`) moves with `←/→/↑/↓`,
 * `Home`/`End`, `PageUp`/`PageDown`; `↵` or `F2` focus the input inside the
 * cell, `Esc` in the input returns to the cell. Inputs carry `tabIndex=-1`, so
 * `Tab` leaves the grid after a single stop – the pattern of the blotter, the
 * cashflow table and the amortisation plan (`useTableNav`).
 *
 * Usage: spread `gridProps` on the element with `role="grid"` (a `<table>` or
 * a CSS grid `<div>`), `cellProps(r, c)` on every editable cell; rows carry
 * `role="row"`. Header rows without gridcells are skipped automatically.
 */
export interface GridCellProps {
  role: "gridcell";
  tabIndex: number;
  "data-r": number;
  "data-c": number;
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
}

const CELL = '[role="gridcell"]';

/** Rows of a grid as arrays of gridcells (rows without cells – headers – dropped). */
function cellsOf(grid: HTMLElement): HTMLElement[][] {
  return Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'))
    .map((r) => Array.from(r.querySelectorAll<HTMLElement>(CELL)))
    .filter((r) => r.length > 0);
}

/** First focusable control inside a cell (input, select, button). */
export function cellControl(cell: HTMLElement): HTMLElement | null {
  return cell.querySelector<HTMLElement>("input, select, textarea, button");
}

export function useGridNav(opts: { pageSize?: number } = {}) {
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const grid = e.currentTarget;
      const target = e.target as HTMLElement;
      const cell = target.closest<HTMLElement>(CELL);
      if (!cell || !grid.contains(cell)) return;
      if (target !== cell) return; // inside a control: its own keys (Esc is handled in the capture phase below)
      const rows = cellsOf(grid);
      let ri = -1;
      let ci = -1;
      rows.forEach((r, i) => {
        const j = r.indexOf(cell);
        if (j >= 0) {
          ri = i;
          ci = j;
        }
      });
      if (ri < 0) return;
      const page = opts.pageSize ?? 5;
      let nr = ri;
      let nc = ci;
      switch (e.key) {
        case "Enter":
        case "F2": {
          e.preventDefault();
          e.stopPropagation();
          const ctl = cellControl(cell);
          ctl?.focus();
          if (ctl instanceof HTMLInputElement) ctl.select();
          return;
        }
        case "ArrowRight":
          nc = Math.min(rows[ri]!.length - 1, ci + 1);
          break;
        case "ArrowLeft":
          nc = Math.max(0, ci - 1);
          break;
        case "ArrowDown":
          nr = Math.min(rows.length - 1, ri + 1);
          break;
        case "ArrowUp":
          nr = Math.max(0, ri - 1);
          break;
        case "PageDown":
          nr = Math.min(rows.length - 1, ri + page);
          break;
        case "PageUp":
          nr = Math.max(0, ri - page);
          break;
        case "Home":
          nc = 0;
          if (e.ctrlKey) nr = 0;
          break;
        case "End":
          nc = rows[ri]!.length - 1;
          if (e.ctrlKey) nr = rows.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const next = rows[nr]?.[Math.min(nc, (rows[nr]?.length ?? 1) - 1)];
      if (next) {
        next.focus();
        next.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    },
    [opts.pageSize],
  );

  /**
   * Esc inside a control returns the focus to its cell. Capture phase: `NumInput` / `DateInput` stop the propagation of
   * their own Esc (they restore the value and blur), so the bubbling handler would never see it.
   */
  const onKeyDownCapture = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(CELL);
    if (!cell || target === cell) return;
    window.setTimeout(() => cell.focus(), 0);
  }, []);

  const onCellFocus = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const cell = e.currentTarget;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (Number.isFinite(r) && Number.isFinite(c)) setActive((cur) => (cur.r === r && cur.c === c ? cur : { r, c }));
  }, []);

  const cellProps = useCallback(
    (r: number, c: number): GridCellProps => ({
      role: "gridcell",
      tabIndex: r === active.r && c === active.c ? 0 : -1,
      "data-r": r,
      "data-c": c,
      onFocus: onCellFocus,
    }),
    [active, onCellFocus],
  );

  /** Props of the grid element: key handling for the roving cell. */
  const gridProps = { onKeyDown, onKeyDownCapture, role: "grid" as const };

  return { gridProps, cellProps, active, setActive };
}
