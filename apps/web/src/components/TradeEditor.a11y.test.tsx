import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { parseISO } from "@deriva/pricing-core";
import { TEMPLATE_IDS, newTradeTemplate } from "../lib/templates.js";
import { samplePortfolio } from "../state/sample-portfolio.js";
import { TradeEditor } from "./TradeEditor.js";

const VAL = parseISO("2026-09-03");
const ROLES = ["combobox", "textbox", "checkbox", "spinbutton", "listbox"] as const;

/**
 * R3-03: every control of the trade editor – selects, inputs, checkboxes – must
 * have an accessible name (aria-label, wrapping label or field label context).
 * Walks the editor for each sample trade and each template.
 */
describe("trade editor accessibility (R3-03)", () => {
  const trades = [...samplePortfolio(VAL), ...TEMPLATE_IDS.map((k) => ({ ...newTradeTemplate(k, VAL), id: `T-${k}` }))];
  for (const trade of trades) {
    it(`every select / input has an accessible name – ${trade.id} (${trade.type})`, () => {
      const { container, unmount } = render(<TradeEditor trade={trade} onChange={() => undefined} />);
      const named = new Set<HTMLElement>();
      for (const role of ROLES) for (const el of within(container).queryAllByRole(role, { name: /\S/ })) named.add(el);
      const controls = Array.from(container.querySelectorAll<HTMLElement>("select, input, textarea")).filter(
        (el) => (el as HTMLInputElement).type !== "hidden",
      );
      expect(controls.length).toBeGreaterThan(5);
      const unnamed = controls
        .filter((el) => !named.has(el))
        .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("class") ?? ""}] value=${(el as HTMLInputElement).value}`);
      expect(unnamed, `unnamed controls in ${trade.id}`).toEqual([]);
      // selects in particular: R2 found 6–8 unnamed comboboxes per editor
      const selects = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
      for (const sel of selects) expect(sel.getAttribute("aria-label") ?? "", `select ${sel.value}`).toMatch(/\S/);
      unmount();
    });
  }
  it("a field label becomes the accessible name of its select and stays overridable", () => {
    const trade = samplePortfolio(VAL).find((t) => t.type === "FRA")!;
    const { getByRole } = render(<TradeEditor trade={trade} onChange={() => undefined} />);
    expect(getByRole("combobox", { name: "Richtung" })).toBeInTheDocument();
    expect(getByRole("combobox", { name: "Tageszählung" })).toBeInTheDocument();
    expect(getByRole("combobox", { name: "Collateral-Währung" })).toBeInTheDocument(); // explicit ariaLabel wins over the field label
  });
});
