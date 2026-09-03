/**
 * Central hotkey registry. Keys use a compact notation:
 *  - single keys:        "n", "?", "/"
 *  - modifiers:          "mod+k" (Ctrl on Win/Linux, ⌘ on macOS), "shift+r", "alt+1"
 *  - chords (sequence):  "g b" (press g, then b within 800ms) – Vim/GitHub-style
 */
export type ViewId = "blotter" | "pricing" | "curves" | "scenarios" | "market" | "report";

export interface HotkeyDef {
  id: string;
  keys: string;
  label: string;
  group: "Navigation" | "Aktionen" | "Bewertung" | "Ansicht" | "Blotter";
  /** Whether the hotkey should fire while focus is in an input field. */
  global?: boolean;
}

export const HOTKEYS: HotkeyDef[] = [
  { id: "palette", keys: "mod+k", label: "Command Palette öffnen", group: "Navigation", global: true },
  { id: "palette2", keys: "/", label: "Command Palette (Schnelleingabe)", group: "Navigation" },
  { id: "help", keys: "?", label: "Tastenkürzel anzeigen", group: "Navigation" },
  { id: "go.blotter", keys: "g b", label: "Blotter / Portfolio", group: "Navigation" },
  { id: "go.pricing", keys: "g p", label: "Pricing-Workspace", group: "Navigation" },
  { id: "go.curves", keys: "g c", label: "Kurven", group: "Navigation" },
  { id: "go.scenarios", keys: "g s", label: "Szenarien", group: "Navigation" },
  { id: "go.market", keys: "g m", label: "Marktdaten", group: "Navigation" },
  { id: "go.report", keys: "g r", label: "Bewertungsreport", group: "Navigation" },
  { id: "view.1", keys: "alt+1", label: "Blotter", group: "Navigation", global: true },
  { id: "view.2", keys: "alt+2", label: "Pricing", group: "Navigation", global: true },
  { id: "view.3", keys: "alt+3", label: "Kurven", group: "Navigation", global: true },
  { id: "view.4", keys: "alt+4", label: "Szenarien", group: "Navigation", global: true },
  { id: "view.5", keys: "alt+5", label: "Markt", group: "Navigation", global: true },
  { id: "view.6", keys: "alt+6", label: "Report", group: "Navigation", global: true },
  { id: "new.irs", keys: "n s", label: "Neuer Zinsswap", group: "Aktionen" },
  { id: "new.cap", keys: "n c", label: "Neuer Cap/Floor", group: "Aktionen" },
  { id: "new.swpt", keys: "n w", label: "Neue Swaption", group: "Aktionen" },
  { id: "new.fxf", keys: "n f", label: "Neuer FX-Forward", group: "Aktionen" },
  { id: "new.fxo", keys: "n o", label: "Neue FX-Option", group: "Aktionen" },
  { id: "duplicate", keys: "d", label: "Trade duplizieren", group: "Blotter" },
  { id: "delete", keys: "shift+d", label: "Trade löschen", group: "Blotter" },
  { id: "down", keys: "j", label: "Nächster Trade", group: "Blotter" },
  { id: "up", keys: "k", label: "Vorheriger Trade", group: "Blotter" },
  { id: "open", keys: "enter", label: "Trade öffnen", group: "Blotter" },
  { id: "reprice", keys: "r", label: "Neu bewerten", group: "Bewertung" },
  { id: "solve.par", keys: "shift+p", label: "Par-Satz / fairen Preis übernehmen", group: "Bewertung" },
  { id: "bump.up", keys: "]", label: "What-if: Zinsen +10bp", group: "Bewertung" },
  { id: "bump.down", keys: "[", label: "What-if: Zinsen -10bp", group: "Bewertung" },
  { id: "bump.reset", keys: "\\", label: "What-if zurücksetzen", group: "Bewertung" },
  { id: "flip", keys: "f", label: "Pay/Receive tauschen", group: "Bewertung" },
  { id: "ccy", keys: "c", label: "Reporting-Währung wechseln", group: "Ansicht" },
  { id: "theme", keys: "t", label: "Dark/Light umschalten", group: "Ansicht" },
  { id: "inspector", keys: "i", label: "Inspector ein/aus", group: "Ansicht" },
  { id: "export.csv", keys: "mod+e", label: "Cashflows als CSV exportieren", group: "Aktionen", global: true },
  { id: "escape", keys: "escape", label: "Schließen / Abbrechen", group: "Navigation", global: true },
];

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Render a key notation into display tokens, e.g. "mod+k" → ["⌘", "K"]. */
export function keyTokens(keys: string): string[][] {
  return keys.split(" ").map((combo) =>
    combo.split("+").map((k) => {
      switch (k) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "shift":
          return "⇧";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "enter":
          return "↵";
        case "escape":
          return "Esc";
        default:
          return k.length === 1 ? k.toUpperCase() : k;
      }
    }),
  );
}
