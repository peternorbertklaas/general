import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NumInput } from "./NumInput.js";

function Harness({ initial, scale, step, unit, onSpy }: { initial: number; scale?: number; step?: number; unit?: string; onSpy: (v: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <NumInput
      value={v}
      scale={scale}
      step={step}
      unit={unit}
      ariaLabel="feld"
      onChange={(x) => {
        onSpy(x);
        setV(x);
      }}
    />
  );
}

describe("NumInput (F-03)", () => {
  it("shows the scaled value with decimal comma and parses a comma input live", () => {
    const spy = vi.fn();
    render(<Harness initial={0.0315} scale={100} step={0.005} unit="%" onSpy={spy} />);
    const input = screen.getByLabelText("feld") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("decimal");
    expect(input.value).toBe("3,15");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "3,25" } });
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.0325, 10));
  });
  it("clearing the field does not snap to 0 and typing continues cleanly", () => {
    const spy = vi.fn();
    render(<Harness initial={0.025} scale={100} unit="%" onSpy={spy} />);
    const input = screen.getByLabelText("feld") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(spy).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "2," } });
    fireEvent.change(input, { target: { value: "2,5" } });
    expect(input.value).toBe("2,5");
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.025, 10));
  });
  it("accepts shorthand (10m, 250k, 25bp) and formats thousands on blur", () => {
    const spy = vi.fn();
    render(<Harness initial={1_000_000} step={100000} unit="EUR" onSpy={spy} />);
    const input = screen.getByLabelText("feld") as HTMLInputElement;
    expect(input.value).toBe("1.000.000");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12,5m" } });
    expect(spy).toHaveBeenLastCalledWith(12_500_000);
    fireEvent.blur(input);
    expect(input.value).toBe("12.500.000");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250k" } });
    expect(spy).toHaveBeenLastCalledWith(250_000);
    fireEvent.blur(input);
    expect(input.value).toBe("250.000");
  });
  it("25bp in a percent field yields 0,25 %", () => {
    const spy = vi.fn();
    render(<Harness initial={0.03} scale={100} unit="%" onSpy={spy} />);
    const input = screen.getByLabelText("feld") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "25bp" } });
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.0025, 10));
    fireEvent.blur(input);
    expect(input.value).toBe("0,25");
  });
  it("Esc restores the value the field had on focus and leaves the field; Enter commits (R3-10)", () => {
    const spy = vi.fn();
    render(<Harness initial={0.025} scale={100} step={0.005} unit="%" onSpy={spy} />);
    const input = screen.getByLabelText("feld") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "3,15" } });
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.0315, 10));
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.025, 10));
    expect(input.value).toBe("2,5");
    expect(document.activeElement).not.toBe(input);
    // Enter keeps the typed value
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "3,15" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.0315, 10));
    expect(input.value).toBe("3,15");
  });
  it("arrow keys step (Shift ×10) and invalid text sets aria-invalid", () => {
    const spy = vi.fn();
    render(<Harness initial={0.03} scale={100} step={0.005} unit="%" onSpy={spy} />);
    const input = screen.getByLabelText("feld") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.03005, 10));
    fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(expect.closeTo(0.03005 - 0.0005, 10));
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert")).toHaveTextContent(/Ungültige Zahl/);
  });
});
