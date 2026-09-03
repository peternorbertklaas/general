import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.js";
import { useStore } from "./state/store.js";

describe("App", () => {
  it("renders the blotter with the sample portfolio", () => {
    render(<App />);
    expect(screen.getAllByText(/DERIVA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("IRS-0001").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Portfolio-Barwert/).length).toBeGreaterThan(0);
  });
  it("navigates with chord hotkeys and opens the palette", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "c" });
    expect(useStore.getState().view).toBe("curves");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useStore.getState().paletteOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().paletteOpen).toBe(false);
  });
  it("what-if bump reprices the portfolio", () => {
    render(<App />);
    const before = useStore.getState().results["IRS-0001"]!.result!.pv;
    fireEvent.keyDown(window, { key: "]" });
    const after = useStore.getState().results["IRS-0001"]!.result!.pv;
    expect(useStore.getState().whatIf.ratesBp).toBe(10);
    expect(after).toBeGreaterThan(before); // payer swap gains when rates rise
    fireEvent.keyDown(window, { key: "\\" });
    expect(useStore.getState().whatIf.ratesBp).toBe(0);
  });
});
