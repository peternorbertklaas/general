# DERIVA – UI-Konzept und Hotkeys

## Leitidee

Ein Terminal, das aussieht wie eine moderne App: **eine Kommandozeile (Command Palette) als Zentrum**, um die herum sechs fokussierte Ansichten liegen. Alles ist per Tastatur erreichbar; die Maus ist optional. Zahlen stehen in Monospace mit Tabellenziffern, Vorzeichen sind farbcodiert (grün/rot), Dark Mode ist Standard.

```
┌──────┬──────────────────────────────────────────────────────────┬───────────────┐
│ Rail │ DERIVA / Blotter   [ Befehl oder Schnelleingabe … ⌘K ]   │  ● Sample EoD │
│  ▤   ├──────────────────────────────────────────────────────────┼───────────────┤
│  ƒ   │  KPI  Portfolio-PV │ DV01 │ PV je Kontrahent │ PV je Typ  │  Inspector    │
│  ∿   │                                                          │  IRS-0001     │
│  ⊞   │  Blotter (sortier-/filterbar, j/k, ↵)                    │  PV  -185.421 │
│  ◔   │  ID  Typ  Name  Kontrahent  Nominal  Fälligk.  PV  DV01  │  DV01  8.412  │
│  ▣   │  …                                                       │  Par 2,88 %   │
│  ?   ├──────────────────────────────────────────────────────────┴───────────────┤
│  ☾   │ 12 Trades · 3,2 ms   Bewertungstag 2026-09-03    g …   ⌘K Palette ? Hilfe│
└──────┴──────────────────────────────────────────────────────────────────────────┘
```

## Ansichten

| Ansicht | Kürzel | Zweck | Besonderheiten |
|---|---|---|---|
| **Blotter** | `g b` / `Alt+1` | Portfolio-Überblick | KPI-Kacheln, Sortierung, Filter, Suche, Summenzeile, Status-Badges |
| **Pricing** | `g p` / `Alt+2` | Ein Trade im Detail | Editor links, Ergebnis rechts, What-if-Slider oben, Key-Rate-Chart, Cashflow-Tabelle |
| **Kurven** | `g c` / `Alt+3` | Kurvenaufbau | Zero + 6M-Forward, Vergleichskurve, Quotes editierbar mit Live-Bootstrapping |
| **Szenarien** | `g s` / `Alt+4` | Stress & What-if | Balken, Tabelle, Heatmap Zinsen × FX, P&L je Trade |
| **Markt** | `g m` / `Alt+5` | Snapshot | Bewertungstag, Spots, Swaption-Heatmap, FX-Smile, Caplet-Vols, Kredit |
| **Report** | `g r` / `Alt+6` | Prüfungsfähig | Fair Value, CVA/DVA, Kostentransparenz, Exposure, Methodik, Export |

## Innovative UI-Elemente

1. **Schnelleingabe in der Command Palette.** `irs 10y pay 3.1% 10m ↵` legt einen Payer-Swap an und springt in den Pricing-Workspace. Die Palette zeigt die Interpretation live an („Payer-Swap EUR 10Y @ 3,100 % · Nominal 10.000.000"). Tab füllt ein Beispiel ein.
2. **Live-What-if ohne Kontextwechsel.** `]` / `[` schieben alle Kurven um ±10bp, das komplette Portfolio wird in Millisekunden neu bewertet; die Topbar zeigt den aktiven Shift orange an; `\` setzt zurück. Slider im Pricing-Workspace für Zinsen, FX und Vol.
3. **Chord-Hotkeys mit Statusanzeige.** Nach `g` erscheint „g … (zweite Taste)" in der Statusleiste – kein Rätselraten, wie in Vim/GitHub/Linear.
4. **Inspector.** Rechte Leiste mit dem Kurzprofil des ausgewählten Trades in jeder Ansicht (außer Pricing). `i` blendet sie aus.
5. **Rechnung sichtbar.** Cashflow-Tabelle mit Fixingdatum, Accrual, Zahlung, Satz (fix/projiziert), Tagefaktor, DF, PV; Pillar-Tabelle mit Zero, DF, Forward.
6. **Heatmaps aus CSS-Grid.** Szenario-Matrix und Vol-Flächen als farbcodierte Zellen ohne Chart-Overhead.
7. **Theme in einem Tastendruck (`t`)**, Reporting-Währung (`c`) rotiert EUR→USD→GBP→CHF.

## Vollständige Hotkey-Referenz

| Gruppe | Tasten | Aktion |
|---|---|---|
| Navigation | `Ctrl/⌘+K`, `/` | Command Palette |
| | `?` | Tastenkürzel-Übersicht |
| | `g b` `g p` `g c` `g s` `g m` `g r` | Blotter, Pricing, Kurven, Szenarien, Markt, Report |
| | `Alt+1` … `Alt+6` | dito (auch in Eingabefeldern) |
| | `Esc` | Schließen / Abbrechen |
| Aktionen | `n s` `n c` `n w` `n f` `n o` | Neu: Swap, Cap/Floor, Swaption, FX-Forward, FX-Option |
| | `Ctrl/⌘+E` | Cashflows als CSV |
| Blotter | `j` / `k` | Nächster / vorheriger Trade |
| | `Enter` | Trade öffnen (Pricing) |
| | `d` / `Shift+D` | Duplizieren / Löschen |
| Bewertung | `r` | Neu bewerten |
| | `Shift+P` | Par-Satz / fairen Preis übernehmen |
| | `f` | Pay/Receive bzw. Long/Short tauschen |
| | `]` / `[` / `\` | What-if +10bp / −10bp / Reset |
| Ansicht | `c` | Reporting-Währung wechseln |
| | `t` | Dark/Light |
| | `i` | Inspector ein/aus |

Regeln: Einzeltasten ohne Modifier sind in Eingabefeldern deaktiviert (Tippen bleibt möglich); Kürzel mit `Ctrl/⌘/Alt` gelten überall. Chords müssen innerhalb von 900 ms abgeschlossen werden.

## Schnelleingabe-Grammatik

```
irs|swap|ois  [ccy] <tenor> pay|rec <rate%> [notional] [index]
cap|floor     [ccy] <tenor> <strike%> [notional]
collar        [ccy] <tenor> <capStrike>/<floorStrike> [notional]
swpt|swaption <expiry>x<tenor> payer|receiver <strike%> [notional]
fxf|forward   <pair> <±baseAmount> <rate> <date|tenor>
fxo|option    <pair> call|put <strike> <notional> <date|tenor>
```
Beträge: `10m` = 10 Mio., `500k`, `2.5m`; Sätze: `3.1%`, `310bp`, `3.1` (→ 3,1 %); Datum ISO oder Tenor ab Spot.

## Barrierefreiheit & Ergonomie

- Fokus-Ringe und `aria-label` an Dialogen; Palette und Overlay sind `role="dialog"`.
- Kontraste ≥ 4,5:1 in beiden Themes; Farbcodierung wird stets durch Vorzeichen/Text ergänzt.
- Tabellen mit sticky Headern, Monospace-Zahlen, deutsche Zahlenformate (`de-DE`).
