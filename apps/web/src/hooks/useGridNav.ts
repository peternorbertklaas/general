import { useCallback, useState } from "react";

/**
 * Roving tabindex for editable grids (R7-01): the vol grids of the market
 * view (swaption cube, caplet surface, FX smile) are one tab stop each. The
 * active cell (`role="gridcell"`, `tabIndex=0`) moves with `←/→/↑/↓`,
 * `Home`/`End`, `PageUp`/`PageDown`; `↵` or `F2` focus the input inside the
 * cell, `Esc` in the input returns to the cell, and `↵` in the input commits
 * the value and returns to the cell as well (R8-03). Inputs carry
 * `tabIndex=-1`, so `Tab` leaves the grid after a single stop – the pattern of
 * the blotter, the cashflow table and the amortisation plan (`useTableNav`).
 *
 * Usage: spread `gridProps` on the element with `role="grid"` (a `<table>` or
 * a CSS grid `<div>`), `cellProps(r, c)` on every editable cell; rows carry
 * `role="row"`. Header rows without gridcells are skipped automatically. Pass
 * the current `rows` / `cols` so the active cell is clamped when the grid
 * shrinks (switching from an 8×5 to a 6×3 FX smile keeps one tab stop, R8-02).
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

export interface GridNavOptions {
  pageSize?: number;
  /** Current number of data rows – the active row is clamped to `rows - 1` (R8-02). */
  rows?: number;
  /** Current number of editable columns – the active column is clamped to `cols - 1` (R8-02). */
  cols?: number;
}

export function useGridNav(opts: GridNavOptions = {}) {
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  // Clamp to the grid's current dimensions: a smaller surface must still carry exactly one tab stop (R8-02).
  const clamp = (n: number, max: number | undefined) => (max !== undefined && Number.isFinite(max) ? Math.max(0, Math.min(n, max - 1)) : n);
  const activeR = clamp(active.r, opts.rows);
  const activeC = clamp(active.c, opts.cols);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const grid = e.currentTarget;
      const target = e.target as HTMLElement;
      const cell = target.closest<HTMLElement>(CELL);
      if (!cell || !grid.contains(cell)) return;
      if (target !== cell) return; // inside a control: its own keys (Esc / Enter are handled in the capture phase below)
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
   * Esc and Enter inside a control return the focus to its cell (R7-01 / R8-03): Esc restores the value, Enter commits
   * it (`NumInput` blurs and commits on Enter, then the cell takes the focus back). Capture phase: `NumInput` /
   * `DateInput` stop the propagation of their own Esc, so the bubbling handler would never see it.
   */
  const onKeyDownCapture = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" && e.key !== "Enter") return;
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
      tabIndex: r === activeR && c === activeC ? 0 : -1,
      "data-r": r,
      "data-c": c,
      onFocus: onCellFocus,
    }),
    [activeR, activeC, onCellFocus],
  );

  /** Props of the grid element: key handling for the roving cell. */
  const gridProps = { onKeyDown, onKeyDownCapture, role: "grid" as const };

  return { gridProps, cellProps, active: { r: activeR, c: activeC }, setActive };
}
