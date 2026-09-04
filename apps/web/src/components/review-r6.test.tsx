/** Round-6 component findings: focus fallback after a document closes (R6-03), amortisation roving tabindex (R6-02), barrier state checkbox (core R6). */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Trade, parseISO } from "@deriva/pricing-core";
import { newTradeTemplate } from "../lib/templates.js";
import { useStore } from "../state/store.js";
import { Modal } from "./Modal.js";
import { TradeEditor } from "./TradeEditor.js";

const VAL = parseISO("2026-09-03");
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("R6-03 – focus after closing a dialog whose opener is gone", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useStore.setState({ modalDepth: 0 });
  });

  it("falls back to main#main (or [data-focus-fallback]) instead of leaving the focus on body", async () => {
    const main = document.createElement("main");
    main.id = "main";
    main.tabIndex = -1;
    document.body.appendChild(main);
    (document.activeElement as HTMLElement | null)?.blur();
    const { unmount } = render(
      <Modal title="Termsheet" onClose={() => undefined}>
        x
      </Modal>,
      { container: document.body.appendChild(document.createElement("div")) },
    );
    await tick();
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(main));
    // an explicit fallback wins over main
    const toolbar = document.createElement("button");
    toolbar.dataset.focusFallback = "";
    toolbar.textContent = "Termsheet";
    document.body.appendChild(toolbar);
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const r2 = render(
      <Modal title="KID" onClose={() => undefined}>
        y
      </Modal>,
      { container: document.body.appendChild(document.createElement("div")) },
    );
    await tick();
    opener.remove(); // the opener disappears while the dialog is open (view switch)
    r2.unmount();
    await waitFor(() => expect(document.activeElement).toBe(toolbar));
    // an opener that is still there gets the focus back as before
    const opener2 = document.createElement("button");
    document.body.appendChild(opener2);
    opener2.focus();
    const r3 = render(
      <Modal title="Doc" onClose={() => undefined}>
        z
      </Modal>,
      { container: document.body.appendChild(document.createElement("div")) },
    );
    await tick();
    r3.unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener2));
  });
});

describe("R6-02 – amortisation table uses the roving tabindex pattern", () => {
  it("one row tab stop, inputs at tabIndex -1, Enter / F2 focus the row's input, Esc returns to the row", async () => {
    let trade: Trade = newTradeTemplate("amort", VAL);
    const onChange = (t: Trade) => {
      trade = t;
    };
    const { container } = render(<TradeEditor trade={trade} onChange={onChange} />);
    const table = screen.getByTestId("amortisation-table");
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(rows.filter((r) => r.tabIndex === -1)).toHaveLength(rows.length - 1);
    expect(rows.every((r) => r.getAttribute("role") === "row")).toBe(true);
    const inputs = Array.from(table.querySelectorAll<HTMLInputElement>("tbody input"));
    expect(inputs).toHaveLength(rows.length);
    expect(inputs.every((i) => i.tabIndex === -1)).toBe(true);
    // keyboard: ↓ moves the stop, Enter focuses the input of the focused row, Esc goes back to the row
    act(() => rows[0]!.focus());
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: "Enter" });
    expect(document.activeElement).toBe(inputs[1]);
    fireEvent.keyDown(inputs[1]!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(rows[1]));
    fireEvent.keyDown(rows[1]!, { key: "F2" });
    expect(document.activeElement).toBe(inputs[1]);
    expect(container.querySelector('[data-testid="amortisation-table"] tbody')).toBeTruthy();
  });
});

describe("core R6 – barrier knock state in the FX option editor", () => {
  it("the checkbox 'Barriere bereits berührt' writes barrier.hit and 'Status unbekannt' clears it; a knocked-out option warns", () => {
    const base = newTradeTemplate("fxo", VAL);
    let trade: Trade = { ...base, barrier: { type: "DownOut", level: 1.05 } } as Trade;
    const onChange = (t: Trade) => {
      trade = t;
    };
    const { rerender } = render(<TradeEditor trade={trade} onChange={onChange} />);
    const box = screen.getByLabelText("Barriere bereits berührt") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect((trade as { barrier?: { hit?: boolean } }).barrier?.hit).toBe(true);
    rerender(<TradeEditor trade={trade} onChange={onChange} />);
    expect((screen.getByLabelText("Barriere bereits berührt") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/ausgeknockt \(Wert = Rebate 0\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Status unbekannt"));
    expect((trade as { barrier?: { hit?: boolean } }).barrier?.hit).toBeUndefined();
    rerender(<TradeEditor trade={trade} onChange={onChange} />);
    expect(screen.queryByText("Status unbekannt")).toBeNull();
    fireEvent.click(screen.getByLabelText("Barriere bereits berührt"));
    rerender(<TradeEditor trade={trade} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Barriere bereits berührt"));
    rerender(<TradeEditor trade={trade} onChange={onChange} />);
    expect((trade as { barrier?: { hit?: boolean } }).barrier?.hit).toBe(false);
    expect(screen.getByText("Status unbekannt")).toBeInTheDocument();
  });
});
