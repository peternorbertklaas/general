import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useStore } from "../state/store.js";
import { CHORD_STARTERS, useTableNav } from "./useTableNav.js";

const ROWS = ["alpha", "beta", "gamma", "delta"];

function Table({ onCopied }: { onCopied?: (t: string) => void }) {
  const nav = useTableNav({ onCopied });
  return (
    <table>
      <tbody onKeyDown={nav.onKeyDown} onFocus={nav.onFocus} data-testid="body">
        {ROWS.map((r, i) => (
          <tr key={r} {...nav.rowProps(i, ROWS.length)} data-row={r}>
            <td>{r}</td>
            <td>{i}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const rows = () => Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
const tabStops = () => rows().filter((r) => r.tabIndex === 0);

describe("useTableNav – roving tabindex (R4-03) and chord precedence (R4-02)", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useStore.getState().setChord(null);
  });
  afterEach(() => useStore.getState().setChord(null));

  it("exactly one row is a tab stop; ↑/↓ move the stop with the focus", () => {
    render(<Table />);
    expect(tabStops().map((r) => r.dataset.row)).toEqual(["alpha"]);
    expect(rows().filter((r) => r.tabIndex === -1).length).toBe(3);
    const first = rows()[0]!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1]);
    expect(tabStops().map((r) => r.dataset.row)).toEqual(["beta"]);
    fireEvent.keyDown(rows()[1]!, { key: "End" });
    expect(document.activeElement).toBe(rows()[3]);
    expect(tabStops().map((r) => r.dataset.row)).toEqual(["delta"]);
    fireEvent.keyDown(rows()[3]!, { key: "PageUp" });
    expect(document.activeElement).toBe(rows()[0]);
    // a mouse focus on another row also moves the tab stop
    act(() => rows()[2]!.focus());
    fireEvent.focus(rows()[2]!);
    expect(tabStops().map((r) => r.dataset.row)).toEqual(["gamma"]);
  });

  it("`y` alone is left to the chord dispatcher; `y y` (chord prefix y) copies the row", async () => {
    const copied = vi.fn();
    render(<Table onCopied={copied} />);
    const row = rows()[1]!;
    act(() => row.focus());
    expect(CHORD_STARTERS.has("y")).toBe(true);
    const notPrevented = fireEvent.keyDown(row, { key: "y" });
    expect(notPrevented).toBe(true); // not consumed → the global dispatcher starts the "y …" chord
    expect(writeText).not.toHaveBeenCalled();
    act(() => useStore.getState().setChord("y"));
    const prevented = fireEvent.keyDown(row, { key: "y" });
    expect(prevented).toBe(false); // consumed
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("beta\t1"));
    await waitFor(() => expect(copied).toHaveBeenCalledWith("beta\t1"));
  });

  it("an explicit `active` row wins over the remembered index (selected blotter row)", () => {
    function Selected() {
      const nav = useTableNav();
      return (
        <table>
          <tbody onKeyDown={nav.onKeyDown} onFocus={nav.onFocus}>
            {ROWS.map((r, i) => (
              <tr key={r} {...nav.rowProps(i, ROWS.length, { active: i === 2, selected: i === 2 })} data-row={r} />
            ))}
          </tbody>
        </table>
      );
    }
    render(<Selected />);
    expect(tabStops().map((r) => r.dataset.row)).toEqual(["gamma"]);
    expect(rows()[2]!.getAttribute("aria-selected")).toBe("true");
  });
});
