import { VISIBLE_HOTKEYS, keyList, keyTokens, type HotkeyDef } from "../hotkeys/keymap.js";
import { useStore } from "../state/store.js";
import { Modal } from "./Modal.js";

/** Render all key variants of a definition: "] oder +", chords as "G dann P". */
export function KeyCombo({ def }: { def: Pick<HotkeyDef, "keys"> }) {
  const variants = keyList(def);
  return (
    <span className="keys">
      {variants.map((k, vi) => {
        const steps = keyTokens(k);
        return (
          <span key={k} className="row" style={{ gap: 3 }}>
            {vi > 0 && <span className="muted xs">oder</span>}
            {steps.map((combo, i) => (
              <span key={i} className="row" style={{ gap: 2 }}>
                {combo.map((t) => (
                  <kbd key={t}>{t}</kbd>
                ))}
                {i < steps.length - 1 && <span className="muted xs">dann</span>}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

const TABLE_KEYS: [string, string][] = [
  ["Zeile auf/ab", "↑ / ↓"],
  ["Erste / letzte Zeile", "Home / End"],
  ["Seite", "PgUp / PgDn"],
  ["Zeile als Text kopieren", "y y"],
  ["Tabelle verlassen (ein Tabstopp je Tabelle)", "Tab"],
  ["Trade öffnen (nur Blotter)", "↵"],
  ["Kontextmenü (Blotter)", "Rechtsklick"],
  ["Heatmap-Zelle wählen", "← / → / ↑ / ↓"],
];
const MARKET_KEYS: [string, string][] = [
  ["Vol-Gitter: Zelle wählen · Wert bearbeiten · ↵ übernimmt und kehrt zur Zelle zurück", "← / → / ↑ / ↓ · ↵ / F2 · Esc"],
  ["Fixings / FX-Fixings / CDS: Zeile · Feld öffnen · Felder der Zeile wechseln · zurück zur Zeile", "↑ / ↓ · ↵ / F2 · Tab / ⇧Tab · Esc"],
  ["Vol-Änderung rückgängig", "Ctrl+Z"],
  ["Fläche auf Sample zurücksetzen / angelegte Fläche entfernen", "Zurücksetzen / Entfernen"],
  ["FX-Fixings (MtM-Reset) – Karte „FX-Fixings“", "+ heute aus Spot / + Zeile"],
  ["Snapshot exportieren / importieren (ersetzt Markt und Bewertungstag, rückgängig; Register-Envelope indices/conventions/calendars)", "Karte „Snapshot“"],
  ["Spots, Fixings, FX-Fixings, Vols im Import-Modus = Änderung am Snapshot", "„modifiziert“ · Ctrl+Z"],
  ["Kurve für weitere Währung / Index aus Quotes (Kurvenansicht)", "+ Kurve"],
  ["Währung registrieren: Konventionen, OIS-/IBOR-Index, Kalender (Kurvenansicht)", "+ Währung / + Kalender"],
  ["Spot für neues Währungspaar (FX-Spots) – bleibt über Import und Reload", "+ Paar"],
  ["Vol-Fläche für Währung / Index / Paar ohne Fläche (statt Fallback-Vol, Level 3)", "+ Fläche"],
];
const NUM_KEYS: [string, string][] = [
  ["Schritt ±", "↑ / ↓"],
  ["×10 / ×0,1", "⇧↑ / ⌥↑"],
  ["Kurzformen", "10m · 250k · 25bp · 3,1%"],
  ["Übernehmen / verlassen", "↵ / Esc"],
];
const DATE_KEYS: [string, string][] = [
  ["Tag / Monat / Jahr ±", "↑ / ⇧↑ / ⌥↑"],
  ["Tenor ab Bewertungstag", "10y · 6m · 2w"],
  ["Relativ zum Feld", "+6m · -1y"],
  ["Datum", "31.12.2027 · 2027-12-31"],
  ["Vorlagen", "⌥↓"],
];

export function HotkeyOverlay() {
  const setHelp = useStore((s) => s.setHelp);
  const groups = Array.from(new Set(VISIBLE_HOTKEYS.map((h) => h.group)));
  const plain = (rows: [string, string][]) =>
    rows.map(([l, k]) => (
      <div key={l} className="keyrow">
        <span>{l}</span>
        <span className="keys">
          {k.split(" / ").map((t) => (
            <kbd key={t}>{t}</kbd>
          ))}
        </span>
      </div>
    ));
  return (
    <Modal title="Tastenkürzel" onClose={() => setHelp(false)} className="sheet-hotkeys" width="min(1180px, 94vw)" testId="hotkey-overlay">
      <p className="muted small" style={{ margin: "0 0 10px" }}>
        Zwei-Tasten-Folgen (z.B. <kbd>g</kbd> <kbd>p</kbd>) nacheinander drücken. In Eingabefeldern gelten nur Kürzel mit Modifier; <kbd>Esc</kbd> beendet die
        Eingabe. Symboltasten (<kbd>]</kbd> <kbd>[</kbd> <kbd>\</kbd>) funktionieren auch über AltGr/Option – oder Sie nutzen die layoutneutralen Alternativen{" "}
        <kbd>+</kbd> <kbd>-</kbd> <kbd>0</kbd>. <kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>8</kbd> wechseln die Ansicht auch in Eingabefeldern.
      </p>
      <div className="cols">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="group-title">{g}</h3>
            {VISIBLE_HOTKEYS.filter((h) => h.group === g).map((h) => (
              <div key={h.id} className="keyrow">
                <span>{h.label}</span>
                <KeyCombo def={h} />
              </div>
            ))}
          </div>
        ))}
        <div>
          <h3 className="group-title">Tabellen</h3>
          {plain(TABLE_KEYS)}
          <h3 className="group-title">Zahlenfelder</h3>
          {plain(NUM_KEYS)}
          <h3 className="group-title">Datumsfelder</h3>
          {plain(DATE_KEYS)}
          <h3 className="group-title">Markt · Vol-Flächen</h3>
          {plain(MARKET_KEYS)}
          <p className="muted xs" style={{ margin: "6px 0 0" }}>
            Schnelleingabe: <code className="mono">swpt usd 1y5y payer 3.5% 10m cash</code> (Währung mit Vol-Cube, Barausgleich),{" "}
            <code className="mono">cap 2y 3% 10m euribor3m</code> / <code className="mono">swpt 1y5y payer 3% 10m estr</code> (Caplet- bzw. Underlying-Index wie
            bei <code className="mono">irs</code>/<code className="mono">fra</code>), <code className="mono">ccs eurusd 5y fixed 3% 10m</code> (Fest gegen
            Variabel), <code className="mono">imm 2y pay 3% 10m</code>, <code className="mono">fxf eurusd 2m 1.1725 6m ndf</code>,{" "}
            <code className="mono">fxo eurusd put 1.15 3m 9m barrier do 1.05</code>, Daten als <code className="mono">15.03.2027</code> oder{" "}
            <code className="mono">2027-03-15</code>. Unbekannte Wörter, Währungen ohne Kurve und doppelte Beträge werden als Fehler gemeldet – nichts wird
            still verworfen. Neue Währungen: „+ Währung“ (Register), „+ Kurve“ (Kurven), „+ Paar“ (Spot), „+ Fläche“ (Vols) –{" "}
            <code className="mono">irs czk 5y pay 4% 100m</code> bewertet, sobald Register und Kurve vorliegen (auch aus einem API-Snapshot).
          </p>
        </div>
      </div>
    </Modal>
  );
}
