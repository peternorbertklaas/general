import { describe, expect, it } from "vitest";
import { enterAllowed, eventMatches, isEditable, isTextEntry, parseCombo } from "./useHotkeys.js";
import { HOTKEYS, VIEW_HOTKEYS, VISIBLE_HOTKEYS, isMac, keyList, keyTokens, keysText } from "./keymap.js";

function ev(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent;
}

const def = (id: string) => HOTKEYS.find((h) => h.id === id)!;
/** Whether any variant of a hotkey definition matches the event. */
const fires = (id: string, e: KeyboardEvent) => keyList(def(id)).some((k) => eventMatches(e, parseCombo(k)));

describe("hotkey matching", () => {
  it("matches mod+k with ctrl or meta", () => {
    const c = parseCombo("mod+k");
    expect(eventMatches(ev("k", { ctrlKey: true }), c)).toBe(true);
    expect(eventMatches(ev("k", { metaKey: true }), c)).toBe(true);
    expect(eventMatches(ev("k"), c)).toBe(false);
  });
  it("matches symbols regardless of shift", () => {
    expect(eventMatches(ev("?", { shiftKey: true }), parseCombo("?"))).toBe(true);
    expect(eventMatches(ev("]"), parseCombo("]"))).toBe(true);
  });
  it("shift+d does not match plain d", () => {
    expect(eventMatches(ev("D", { shiftKey: true }), parseCombo("shift+d"))).toBe(true);
    expect(eventMatches(ev("d"), parseCombo("shift+d"))).toBe(false);
  });
  it("shift+k (Kundenmodus) is distinct from k (vorheriger Trade)", () => {
    expect(eventMatches(ev("K", { shiftKey: true }), parseCombo("shift+k"))).toBe(true);
    expect(eventMatches(ev("K", { shiftKey: true }), parseCombo("k"))).toBe(false);
    expect(eventMatches(ev("k"), parseCombo("shift+k"))).toBe(false);
    expect(eventMatches(ev(" "), parseCombo("space"))).toBe(true);
  });
  it("mod+shift+e (Blotter-Export) is distinct from mod+e (Cashflows)", () => {
    expect(eventMatches(ev("E", { ctrlKey: true, shiftKey: true }), parseCombo("mod+shift+e"))).toBe(true);
    expect(eventMatches(ev("E", { ctrlKey: true, shiftKey: true }), parseCombo("mod+e"))).toBe(false);
    expect(eventMatches(ev("e", { ctrlKey: true }), parseCombo("mod+shift+e"))).toBe(false);
  });
  it("keymap has unique ids and unique key notations across all aliases", () => {
    const ids = new Set(HOTKEYS.map((h) => h.id));
    expect(ids.size).toBe(HOTKEYS.length);
    const keys = HOTKEYS.flatMap(keyList);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("registers customer mode, compare view and hedge view exactly once", () => {
    expect(HOTKEYS.filter((h) => keyList(h).includes("shift+k")).map((h) => h.id)).toEqual(["customer"]);
    expect(HOTKEYS.filter((h) => keyList(h).includes("g v")).map((h) => h.id)).toEqual(["go.compare"]);
    expect(HOTKEYS.filter((h) => keyList(h).includes("g h")).map((h) => h.id)).toEqual(["go.hedge"]);
    expect(HOTKEYS.filter((h) => keyList(h).includes("alt+8")).map((h) => h.id)).toEqual(["view.8"]);
    expect(HOTKEYS.filter((h) => keyList(h).includes("space")).map((h) => h.id)).toEqual(["compare.toggle"]);
    expect(VIEW_HOTKEYS.map((v) => v.view)).toContain("compare");
    expect(VIEW_HOTKEYS.map((v) => v.view)).toContain("hedge");
    expect(VISIBLE_HOTKEYS.some((h) => h.id === "escape")).toBe(false);
    expect(VISIBLE_HOTKEYS.some((h) => h.id.startsWith("view."))).toBe(false);
  });
  it("renders key tokens and alias text", () => {
    expect(keyTokens("g p")).toEqual([["G"], ["P"]]);
    expect(keyTokens("shift+d")[0]).toEqual(["⇧", "D"]);
    expect(keyTokens("space")[0]).toEqual(["Space"]);
    expect(keysText(def("bump.up"))).toBe("] oder +");
    expect(keysText(def("delete"))).toContain("Entf");
  });
});

describe("layout-safe hotkeys (F-01)", () => {
  it("German Windows: AltGr+9 → ']' (ctrl+alt) bumps rates", () => {
    const e = ev("]", { ctrlKey: true, altKey: true, code: "Digit9" });
    expect(fires("bump.up", e)).toBe(true);
    expect(fires("bump.down", e)).toBe(false);
  });
  it("German Windows: AltGr+8 → '[' and AltGr+ß → '\\'", () => {
    expect(fires("bump.down", ev("[", { ctrlKey: true, altKey: true, code: "Digit8" }))).toBe(true);
    expect(fires("bump.reset", ev("\\", { ctrlKey: true, altKey: true, code: "Minus" }))).toBe(true);
  });
  it("macOS German: Option+5 → '[' bumps down and does NOT switch to view 5", () => {
    const e = ev("[", { altKey: true, code: "Digit5" });
    expect(fires("bump.down", e)).toBe(true);
    expect(fires("view.5", e)).toBe(false);
  });
  it("macOS: Option+1 yields '¡' but Alt+1 still switches the view via e.code", () => {
    expect(fires("view.1", ev("¡", { altKey: true, code: "Digit1" }))).toBe(true);
    expect(fires("view.1", ev("1", { altKey: true, code: "Digit1" }))).toBe(true);
    expect(fires("view.1", ev("1", { code: "Digit1" }))).toBe(false);
    expect(fires("view.1", ev("1", { altKey: true, ctrlKey: true, code: "Digit1" }))).toBe(false);
  });
  it("layout-neutral aliases + / - / 0 drive the what-if", () => {
    expect(fires("bump.up", ev("+"))).toBe(true);
    expect(fires("bump.up", ev("+", { shiftKey: true }))).toBe(true); // US layout: shift+=
    expect(fires("bump.down", ev("-"))).toBe(true);
    expect(fires("bump.reset", ev("0"))).toBe(true);
    expect(fires("bump.reset", ev("0", { ctrlKey: true }))).toBe(false); // ctrl+0 = browser zoom reset
  });
  it("a plain Ctrl+] (no Alt) is not treated as the bracket key", () => {
    expect(fires("bump.up", ev("]", { ctrlKey: true }))).toBe(false);
  });
});

describe("focus semantics (F-02 / F-05)", () => {
  it("isEditable covers buttons, links, role=button, summary and contenteditable; isTextEntry only text fields", () => {
    const btn = document.createElement("button");
    const a = document.createElement("a");
    a.setAttribute("href", "#");
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    const sum = document.createElement("summary");
    const ce = document.createElement("div");
    Object.defineProperty(ce, "isContentEditable", { value: true });
    const input = document.createElement("input");
    const check = document.createElement("input");
    check.type = "checkbox";
    const plain = document.createElement("div");
    for (const el of [btn, a, div, sum, ce, input, check]) expect(isEditable(el)).toBe(true);
    expect(isEditable(plain)).toBe(false);
    expect(isTextEntry(input)).toBe(true);
    expect(isTextEntry(ce)).toBe(true);
    expect(isTextEntry(check)).toBe(false);
    expect(isTextEntry(btn)).toBe(false);
  });
  it("Enter as 'open' is allowed on body / blotter trade rows only (N-02)", () => {
    expect(enterAllowed(document.body)).toBe(true);
    expect(enterAllowed(window)).toBe(true);
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    expect(enterAllowed(btn)).toBe(false);
    const table = document.createElement("table");
    const pillar = document.createElement("tr"); // pillar / scenario / cashflow row: no data-nav
    table.appendChild(pillar);
    document.body.appendChild(table);
    expect(enterAllowed(pillar)).toBe(false);
    const tradeRow = document.createElement("tr");
    tradeRow.setAttribute("data-nav", "trade");
    table.appendChild(tradeRow);
    expect(enterAllowed(tradeRow)).toBe(true);
    const inRow = document.createElement("button");
    tradeRow.appendChild(inRow);
    expect(enterAllowed(inRow)).toBe(false);
  });
  it("renders the '+' alias as one token, not two empty boxes (N-04)", () => {
    expect(keyTokens("+")).toEqual([["+"]]);
    expect(keyTokens("-")).toEqual([["-"]]);
    expect(keyTokens("mod++")).toEqual([[isMac ? "⌘" : "Ctrl", "+"]]);
    expect(keysText(def("bump.up"))).toBe("] oder +");
    expect(keysText(def("doc.termsheet"))).toMatch(/T$/);
    for (const h of HOTKEYS) for (const k of keyList(h)) for (const combo of keyTokens(k)) for (const tok of combo) expect(tok, `${h.id} ${k}`).not.toBe("");
  });
});
