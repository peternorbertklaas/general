import { HOTKEYS, keyTokens } from "../hotkeys/keymap.js";
import { useStore } from "../state/store.js";

export function HotkeyOverlay() {
  const setHelp = useStore((s) => s.setHelp);
  const groups = Array.from(new Set(HOTKEYS.map((h) => h.group)));
  return (
    <div className="overlay" onClick={() => setHelp(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tastenkürzel">
        <h2>
          Tastenkürzel <span className="muted small">– Esc zum Schließen</span>
        </h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Zwei-Tasten-Folgen (z.B. <kbd>g</kbd> <kbd>p</kbd>) nacheinander drücken. In Eingabefeldern gelten nur Kürzel mit Modifier.
        </p>
        <div className="cols">
          {groups.map((g) => (
            <div key={g}>
              <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--fg-2)", margin: "10px 0 6px" }}>{g}</h3>
              {HOTKEYS.filter((h) => h.group === g).map((h) => (
                <div key={h.id} className="keyrow">
                  <span>{h.label}</span>
                  <span className="keys">
                    {keyTokens(h.keys).map((combo, i) => (
                      <span key={i} className="row" style={{ gap: 2 }}>
                        {combo.map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                        {i < keyTokens(h.keys).length - 1 && <span className="muted xs">dann</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
