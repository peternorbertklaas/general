import { describe, expect, it } from "vitest";
import { eventMatches, parseCombo } from "./useHotkeys.js";
import { HOTKEYS, keyTokens } from "./keymap.js";

function ev(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent;
}

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
  it("keymap has unique ids and keys", () => {
    const ids = new Set(HOTKEYS.map((h) => h.id));
    expect(ids.size).toBe(HOTKEYS.length);
    const keys = HOTKEYS.map((h) => h.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("renders key tokens", () => {
    expect(keyTokens("g p")).toEqual([["G"], ["P"]]);
    expect(keyTokens("shift+d")[0]).toEqual(["⇧", "D"]);
  });
});
