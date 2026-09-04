import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseISO } from "@deriva/pricing-core";
import { useStore } from "../state/store.js";
import { DateInput } from "./DateInput.js";

function Harness({ onSpy }: { onSpy: (v: number) => void }) {
  const [v, setV] = useState(parseISO("2027-06-30"));
  return (
    <DateInput
      value={v}
      ariaLabel="datum"
      onChange={(x) => {
        onSpy(x);
        setV(x);
      }}
    />
  );
}

const tick = () => act(async () => new Promise<void>((r) => setTimeout(r, 10)));

describe("DateInput – presets popover keeps the edit session (R4-04)", () => {
  afterEach(() => {
    useStore.setState({ popoverDepth: 0 });
  });

  it("Alt+↓ opens the presets without committing the typed draft; Esc closes, a second Esc discards", async () => {
    const spy = vi.fn();
    render(<Harness onSpy={spy} />);
    const input = screen.getByLabelText("datum") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "31.12.2041" } });
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    expect(screen.getByRole("listbox", { name: "Datums-Vorlagen" })).toBeInTheDocument();
    // the popover takes the focus (autoFocus on the first chip) – the blur must not commit
    await tick();
    const first = screen.getByRole("option", { name: "Heute" });
    act(() => first.focus());
    fireEvent.blur(input, { relatedTarget: first });
    expect(spy).not.toHaveBeenCalled();
    expect(input.value).toBe("31.12.2041");
    expect(useStore.getState().popoverDepth).toBe(1);
    // Esc closes the popover, the draft survives, focus returns to the field
    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe("31.12.2041");
    expect(spy).not.toHaveBeenCalled();
    // second Esc discards the draft (value at focus time)
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(input.value).toBe("30.06.2027");
    expect(spy).not.toHaveBeenCalled();
    expect(useStore.getState().popoverDepth).toBe(0);
  });

  it("Enter after the popover closed commits the draft; a preset commits its own date", async () => {
    const spy = vi.fn();
    render(<Harness onSpy={spy} />);
    const input = screen.getByLabelText("datum") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "15.03.2030" } });
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    await tick();
    fireEvent.keyDown(document.activeElement ?? input, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith(parseISO("2030-03-15"));
    // preset: "+1M" relative to the current value
    act(() => input.focus());
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    await tick();
    fireEvent.click(screen.getByRole("option", { name: "+1M" }));
    expect(spy).toHaveBeenLastCalledWith(parseISO("2030-04-15"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("the ▾ button opens the presets without stealing the focus or committing", async () => {
    const spy = vi.fn();
    render(<Harness onSpy={spy} />);
    const input = screen.getByLabelText("datum") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "01.02.2033" } });
    const btn = screen.getByRole("button", { name: "Datums-Vorlagen" });
    const md = fireEvent.mouseDown(btn);
    expect(md).toBe(false); // preventDefault keeps the focus in the input
    fireEvent.click(btn);
    expect(screen.getByRole("listbox", { name: "Datums-Vorlagen" })).toBeInTheDocument();
    await tick();
    expect(spy).not.toHaveBeenCalled();
    expect(input.value).toBe("01.02.2033");
    fireEvent.keyDown(document.activeElement ?? input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
});
