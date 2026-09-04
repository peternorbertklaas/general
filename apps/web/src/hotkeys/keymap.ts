/**
 * Central hotkey registry – the single source of truth for every key binding
 * (palette items, help sheet, status bar and documentation are derived from it).
 * Keys use a compact notation:
 *  - single keys:        "n", "?", "/"
 *  - modifiers:          "mod+k" (Ctrl on Win/Linux, ⌘ on macOS), "shift+r", "alt+1"
 *  - chords (sequence):  "g b" (press g, then b within 900ms) – Vim/GitHub-style
 *  - aliases:            keys may be an array – every entry triggers the same action
 *                        (layout-neutral alternatives such as "]" and "+").
 *
 * Rule (R3-01): no combination from the browser reservation list below. Chromium
 * executes reserved commands (Ctrl+T/N/W, Ctrl+Shift+T/N/W, Ctrl+Tab) before the
 * page sees `keydown`, and the DevTools shortcuts (Ctrl+Shift+I/J/C, Firefox
 * Ctrl+Shift+K/E/S) cannot be prevented either. Documents, report and exports
 * therefore live on chords: `o …` (öffnen), `x …` (Export), `y …` (yank/kopieren).
 */
export type ViewId = "blotter" | "pricing" | "curves" | "scenarios" | "market" | "report" | "compare" | "hedge";

export type HotkeyGroup = "Navigation" | "Aktionen" | "Dokumente & Export" | "Bewertung" | "Ansicht" | "Blotter";

export interface HotkeyDef {
  id: string;
  /** One key notation or a list of equivalent notations (first = primary). */
  keys: string | string[];
  label: string;
  group: HotkeyGroup;
  /** Whether the hotkey should fire while focus is in an input field. */
  global?: boolean;
  /** Hidden from palette / help (internal aliases such as Alt+n or Escape). */
  hidden?: boolean;
}

/**
 * Key combinations that browsers reserve or that open developer tools – never
 * bind them (Chromium reserved commands, Chrome/Edge/Firefox/Safari DevTools and
 * window shortcuts). Checked by `useHotkeys.test.ts` against every definition.
 */
export const BROWSER_RESERVED_COMBOS: ReadonlySet<string> = new Set([
  "mod+t",
  "mod+n",
  "mod+w",
  "mod+q",
  "mod+tab",
  "mod+shift+tab",
  "mod+shift+t", // restore closed tab (all browsers)
  "mod+shift+n", // incognito / private window
  "mod+shift+w", // close window
  "mod+shift+q", // quit (Linux)
  "mod+shift+i", // DevTools
  "mod+shift+j", // DevTools console (Chrome)
  "mod+shift+c", // DevTools inspect (Chrome), Firefox inspector
  "mod+shift+k", // Firefox web console
  "mod+shift+e", // Firefox network monitor
  "mod+shift+s", // Firefox screenshot / debugger
  "mod+shift+m", // Firefox responsive design mode, Chrome profile menu
  "mod+shift+b", // bookmarks bar / library
  "mod+shift+o", // bookmark manager
  "mod+shift+d", // bookmark all tabs / Firefox bookmarks sidebar
  "mod+shift+a", // Firefox add-ons, Chrome tab search
  "mod+shift+p", // Firefox private window, Chrome system print dialog
  "mod+shift+r", // hard reload
  "mod+shift+h", // Firefox history
  "mod+shift+y", // Firefox downloads
  "mod+shift+l", // Safari sidebar
  "mod+shift+delete", // clear browsing data
  "mod+shift+g", // find previous
  "mod+shift+f", // Firefox: search all files (DevTools)
]);

/** Labels of the "new trade" templates – referenced by the keymap and the palette (single label source). */
export const TEMPLATE_LABELS = {
  irs: "Neuer Zinsswap",
  cap: "Neuer Cap / Floor / Collar",
  swpt: "Neue Swaption",
  fxf: "Neuer FX-Forward",
  fxo: "Neue FX-Option",
  basis: "Neuer Basis-Swap (3M/6M)",
  amort: "Neuer amortisierender Swap",
  imm: "Neuer IMM-Swap",
  fxs: "Neuer FX-Swap",
  ccs: "Neuer Cross-Currency-Swap",
  fra: "Neues FRA",
} as const;

export const HOTKEYS: HotkeyDef[] = [
  { id: "palette", keys: "mod+k", label: "Command Palette öffnen", group: "Navigation", global: true },
  { id: "palette2", keys: "/", label: "Command Palette (Schnelleingabe)", group: "Navigation", hidden: true },
  { id: "help", keys: "?", label: "Tastenkürzel anzeigen", group: "Navigation" },
  { id: "go.blotter", keys: "g b", label: "Blotter / Portfolio", group: "Navigation" },
  { id: "go.pricing", keys: "g p", label: "Pricing-Workspace", group: "Navigation" },
  { id: "go.curves", keys: "g c", label: "Kurven", group: "Navigation" },
  { id: "go.scenarios", keys: "g s", label: "Szenarien", group: "Navigation" },
  { id: "go.market", keys: "g m", label: "Marktdaten", group: "Navigation" },
  { id: "go.report", keys: "g r", label: "Bewertungsreport", group: "Navigation" },
  { id: "go.compare", keys: "g v", label: "Vergleich", group: "Navigation" },
  { id: "go.hedge", keys: "g h", label: "Hedge Accounting", group: "Navigation" },
  { id: "view.1", keys: "alt+1", label: "Blotter", group: "Navigation", global: true, hidden: true },
  { id: "view.2", keys: "alt+2", label: "Pricing", group: "Navigation", global: true, hidden: true },
  { id: "view.3", keys: "alt+3", label: "Kurven", group: "Navigation", global: true, hidden: true },
  { id: "view.4", keys: "alt+4", label: "Szenarien", group: "Navigation", global: true, hidden: true },
  { id: "view.5", keys: "alt+5", label: "Markt", group: "Navigation", global: true, hidden: true },
  { id: "view.6", keys: "alt+6", label: "Report", group: "Navigation", global: true, hidden: true },
  { id: "view.7", keys: "alt+7", label: "Vergleich", group: "Navigation", global: true, hidden: true },
  { id: "view.8", keys: "alt+8", label: "Hedge Accounting", group: "Navigation", global: true, hidden: true },
  { id: "valdate", keys: "shift+t", label: "Bewertungstag setzen", group: "Navigation" },
  { id: "new.irs", keys: "n s", label: TEMPLATE_LABELS.irs, group: "Aktionen" },
  { id: "new.cap", keys: "n c", label: TEMPLATE_LABELS.cap, group: "Aktionen" },
  { id: "new.swpt", keys: "n w", label: TEMPLATE_LABELS.swpt, group: "Aktionen" },
  { id: "new.fxf", keys: "n f", label: TEMPLATE_LABELS.fxf, group: "Aktionen" },
  { id: "new.fxo", keys: "n o", label: TEMPLATE_LABELS.fxo, group: "Aktionen" },
  { id: "new.basis", keys: "n b", label: TEMPLATE_LABELS.basis, group: "Aktionen" },
  { id: "new.amort", keys: "n a", label: TEMPLATE_LABELS.amort, group: "Aktionen" },
  { id: "new.imm", keys: "n i", label: TEMPLATE_LABELS.imm, group: "Aktionen" },
  { id: "new.fxs", keys: "n x", label: TEMPLATE_LABELS.fxs, group: "Aktionen" },
  { id: "new.ccs", keys: "n z", label: TEMPLATE_LABELS.ccs, group: "Aktionen" },
  { id: "new.fra", keys: "n r", label: TEMPLATE_LABELS.fra, group: "Aktionen" },
  { id: "undo", keys: "mod+z", label: "Rückgängig (Trades, Quotes, Markt, Hedge)", group: "Aktionen", global: true },
  // Documents, report and exports: chords only (browser-safe, R3-01). "o" = öffnen, "x" = Export, "y" = kopieren.
  { id: "report.generate", keys: "o r", label: "Report erzeugen (Zeitstempel fixieren)", group: "Dokumente & Export" },
  { id: "doc.termsheet", keys: "o t", label: "Termsheet öffnen", group: "Dokumente & Export" },
  { id: "doc.suitability", keys: "o g", label: "Geeignetheitserklärung öffnen", group: "Dokumente & Export" },
  { id: "doc.kid", keys: "o k", label: "Basisinformationsblatt (KID) öffnen", group: "Dokumente & Export" },
  { id: "doc.confirmation", keys: "o c", label: "Confirmation (Geschäftsbestätigung) öffnen", group: "Dokumente & Export" },
  { id: "export.portfolio", keys: "o p", label: "Portfolio-Report exportieren (JSON + Markdown)", group: "Dokumente & Export" },
  { id: "export.csv", keys: ["mod+e", "x c"], label: "Cashflows als CSV exportieren", group: "Dokumente & Export", global: true },
  { id: "export.blotter", keys: "x b", label: "Blotter als CSV exportieren", group: "Dokumente & Export" },
  { id: "copy.indication", keys: "y i", label: "Indikation als Text kopieren", group: "Dokumente & Export" },
  { id: "duplicate", keys: "d", label: "Trade duplizieren", group: "Blotter" },
  { id: "delete", keys: ["shift+d", "delete"], label: "Trade löschen (mit Rückgängig)", group: "Blotter" },
  { id: "down", keys: "j", label: "Nächster Trade", group: "Blotter" },
  { id: "up", keys: "k", label: "Vorheriger Trade", group: "Blotter" },
  { id: "open", keys: "enter", label: "Trade öffnen", group: "Blotter" },
  { id: "compare.toggle", keys: "space", label: "Trade für Vergleich markieren", group: "Blotter" },
  { id: "reprice", keys: "r", label: "Neu bewerten", group: "Bewertung" },
  { id: "solve.par", keys: "shift+p", label: "Par-Satz / fairen Preis übernehmen", group: "Bewertung" },
  { id: "bump.up", keys: ["]", "+"], label: "What-if: Zinsen +10bp", group: "Bewertung" },
  { id: "bump.down", keys: ["[", "-"], label: "What-if: Zinsen -10bp", group: "Bewertung" },
  { id: "bump.reset", keys: ["\\", "0"], label: "What-if zurücksetzen", group: "Bewertung" },
  { id: "flip", keys: "f", label: "Pay/Receive tauschen", group: "Bewertung" },
  { id: "ccy", keys: "c", label: "Reporting-Währung wechseln", group: "Ansicht" },
  { id: "theme", keys: "t", label: "Dark/Light umschalten", group: "Ansicht" },
  { id: "inspector", keys: "i", label: "Inspector ein/aus", group: "Ansicht" },
  { id: "customer", keys: "shift+k", label: "Kundenmodus ein/aus", group: "Ansicht" },
  { id: "escape", keys: "escape", label: "Schließen / Abbrechen / Eingabe beenden", group: "Navigation", global: true, hidden: true },
];

/** All key notations of a definition (primary first). */
export function keyList(def: Pick<HotkeyDef, "keys">): string[] {
  return Array.isArray(def.keys) ? def.keys : [def.keys];
}

/** Primary key notation of a definition. */
export function primaryKeys(def: Pick<HotkeyDef, "keys">): string {
  return keyList(def)[0]!;
}

/** Key notation of a registered hotkey id (primary), or undefined. */
export function keysOf(id: string): string | undefined {
  const h = HOTKEYS.find((x) => x.id === id);
  return h ? primaryKeys(h) : undefined;
}

/** Hotkeys that appear in the palette / help / counters (no hidden aliases). */
export const VISIBLE_HOTKEYS: HotkeyDef[] = HOTKEYS.filter((h) => !h.hidden);

/** Navigation hotkeys ("go.<view>") as the single source for view menus and palette entries. */
export const VIEW_HOTKEYS: { view: ViewId; def: HotkeyDef }[] = HOTKEYS.filter((h) => h.id.startsWith("go.")).map((def) => ({
  view: def.id.slice(3) as ViewId,
  def,
}));

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Split one combo into its parts; a literal "+" key ("+" or "mod++") is kept as a token (N-04). */
export function comboParts(combo: string): string[] {
  if (combo === "+") return ["+"];
  if (combo.endsWith("++")) return [...combo.slice(0, -2).split("+"), "+"];
  return combo.split("+");
}

/** Render a key notation into display tokens, e.g. "mod+k" → [["⌘", "K"]]; chords yield one entry per step. */
export function keyTokens(keys: string): string[][] {
  return keys.split(" ").map((combo) =>
    comboParts(combo).map((k) => {
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
        case "space":
          return "Space";
        case "delete":
          return "Entf";
        case "backspace":
          return "⌫";
        default:
          return k.length === 1 ? k.toUpperCase() : k;
      }
    }),
  );
}

/** Plain-text rendering of all variants, e.g. "] oder +". */
export function keysText(def: Pick<HotkeyDef, "keys">): string {
  return keyList(def)
    .map((k) =>
      keyTokens(k)
        .map((combo) => combo.join("+"))
        .join(" "),
    )
    .join(" oder ");
}
