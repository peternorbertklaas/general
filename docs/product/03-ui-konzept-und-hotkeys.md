# DERIVA – UI-Konzept und Hotkeys

## Leitidee

Ein Terminal, das aussieht wie eine moderne App: **eine Kommandozeile (Command Palette) als Zentrum**, um die herum acht fokussierte Ansichten liegen. Alles ist per Tastatur erreichbar; die Maus ist optional. Zahlen stehen in Monospace mit Tabellenziffern und **durchgängig im deutschen Format** (`2,6975 %`, `10.000.000`, `10,3 bp`), Vorzeichen sind farbcodiert (grün/rot), Dark Mode ist Standard.

```
┌──────┬──────────────────────────────────────────────────────────┬───────────────┐
│ Rail │ DERIVA / Blotter   [ Befehl oder Schnelleingabe … ⌘K ]   │ ● Sample EoD  │
│  ▤   ├──────────────────────────────────────────────────────────┼───────────────┤
│  ƒ   │  KPI  Portfolio-PV │ DV01 │ PV je Kontrahent │ PV je Typ  │  Inspector    │
│  ∿   │                                                          │  IRS-0001     │
│  ⊞   │  Blotter (sortier-/filterbar, Spaltenwahl, j/k, ↵)       │  PV  -185.421 │
│  ◔   │  ID  Typ  Name  Kontrahent  Nominal  Fälligk.  PV  DV01  │  DV01  8.412  │
│  ▣   │  …                                                       │  Par 2,88 %   │
│  ⇆   ├──────────────────────────────────────────────────────────┴───────────────┤
│  ⛨   │ 11 Trades · 3,2 ms  Bewertungstag 03.09.2026  ⌘Z ↶ …  Eingabemodus – Esc │
└──────┴──────────────────────────────────────────────────────────────────────────┘
```

## Ansichten

| Ansicht | Kürzel | Zweck | Besonderheiten |
|---|---|---|---|
| **Blotter** | `g b` / `Alt+1` | Portfolio-Überblick | KPI-Kacheln, sortierbare Spaltenköpfe (Buttons mit `aria-sort`), Spaltenauswahl inkl. **Buch** (lokal gespeichert), Filter-Chips (Typ, „Indikationen ausblenden“, „ohne Kontrahent“), **Gruppieren nach** Kontrahent / Buch / Typ mit Zwischensummen PV und DV01, Suche (ID, Name, Kontrahent, Buch), Sortierung/Filter/Gruppierung persistiert, Leerzustände mit Handlungsaufforderung, Kontextmenü (Rechtsklick, Roving-Fokus), Hinweis-Popover je Trade, Menü **„⤓ Export ▾“**: CSV (sichtbare Spalten) / JSON / EMIR, **Import JSON und CSV** (Spaltenvorlagen IRS / FXF / CAP zum Download, deutsche oder englische Kopfzeilen, Dezimalkomma, Datum ISO/DE/Tenor), bei ID-Kollision Dialog **überspringen / ersetzen / umbenennen**; Trades mit Fehler-Validierung zeigen „Fehler“ und werden nicht bewertet, nicht summiert und nicht exportiert; Onboarding-Hinweis |
| **Pricing** | `g p` / `Alt+2` | Ein Trade im Detail | Editor mit Validierung (rote Rahmen, deutsche Meldungen), Zahlenfelder mit Einheit und Kurzformen, **Datumsfelder mit Tenor** (`10y`, `+6m`, `31.12.2027`, ISO, Vorlagen-Popover), gemeinsamer Block mit Kontrahent, **Buch**, Status, **Collateral (CSA)** und **Upfront/Prämie** (Betrag, Währung, Datum) für alle Typen; FX-Option: Auszahlung Vanilla / Digital (Cash / Asset), Barriere mit **Rebate**; FX-Forward: **NDF** (Fixing, Settlement-Währung); Swaption: **Cash-Settlement-Konvention** (Collateralised Cash Price / IRR); CCS: Nominalaustausch, MtM-Reset; Amortisation **Linear / Annuität / Custom** mit Restschuld, Kreditzins und Paste-Handler (Datum;Nominal); What-if-Slider mit Eingabefeld, Preis-Analytics mit Whitelist (unbekannte Schlüssel unter „Weitere (technisch)“) / Risiko (Bump) getrennt, Key-Rate-Chart **und** -Tabelle mit Kurvenwahl (dominante Kurve vorausgewählt) und Export, **Par-Sensitivitäten** (Quote-Bumps, auf Abruf), **Vega-Buckets** für Zinsoptionen (Swaption: je Verfall oder **Verfall × Tenor** als Heatmap; FX-Optionen liefert der Kern derzeit nicht), Cashflow-Tabelle mit Tastaturnavigation, Termsheet-Button, Indikation kopieren |
| **Kurven** | `g c` / `Alt+3` | Kurvenaufbau | Zero + 6M-Forward, Vergleich (gleiche Währung), **Interpolation je Kurve wählbar** (log-linear, linear Zero, kubischer Spline, flat forward, Monotone Convex) – Overrides liegen im Store, überleben den Stichtagswechsel, bootstrappen abhängige Kurven neu und zählen als „Markt modifiziert“; Quotes im Store (bleiben beim Ansichts- und Stichtagswechsel), geänderte Quotes orange mit Original im Tooltip, `Ctrl+Z` macht Quote-Änderungen rückgängig, Pillar-Datum und Residuum je Quote, `EUR-ESTR-USDCSA` (Xccy-Basis) |
| **Szenarien** | `g s` / `Alt+4` | Stress & What-if | Balken, Tabelle, **klickbare Heatmap** (`role=grid` mit Zeilen/Zellen, Pfeiltasten, setzt das What-if), P&L je Trade, Editor „Eigenes Szenario“ |
| **Markt** | `g m` / `Alt+5` | Snapshot | Bewertungstag-Popover, Spots (Teil des Quote-Sets), Fixings-Editor (Tenor-Datumsfeld), Swaption-Heatmap (ARIA-Tabelle), FX-Smile, Caplet-Vols, Kredit, Snapshot-Export/-Import, „Markt zurücksetzen“ (Quotes + Interpolation) |
| **Report** | `g r` / `Alt+6` | Prüfungsfähig | Expliztes „Report erzeugen“ (fester Zeitstempel), Engine-Version, Snapshot-ID (mit „Quotes modifiziert“ im Label, JSON und Druckkopf), Report-Hash, **Governance-Zeile** (Snapshot-Status indikativ/freigegeben, Datenquellen, Modellversion, Validierer), **Perspektive Bank / Kunde** (Standard Kunde; Kundenmodus erzwingt Kunde) mit Vorzeichenregel, **What-if-Kennzeichnung** („nicht prüfungsfähig“, auch im JSON), Kostentransparenz – Eingaben je Trade im Store persistiert, „Standardwerte“-Button, „Eingaben geändert“ auch nach Quote-Änderung (stabiler Quote-Hash) –, Exposure, Methodik (deutsch), Druck-Layout (A4, Kopfzeile), **Termsheet** (mit anfänglichem Marktwert, Dezimalkomma) und **Geeignetheitserklärung** als Dokumente – druckbar ohne Leerseite, Titel dunkel auf hell |
| **Vergleich** | `g v` / `Alt+7` | 2–4 Trades nebeneinander | PV, Kennzahl, DV01, Theta, Vega, FX-Delta, Fälligkeit, Nominal, Kontrahent, Buch, P&L je Standard-Szenario; Auswahl im Blotter per `Space` |
| **Hedge Accounting** | `g h` / `Alt+8` | IFRS 9 / HGB § 254 | Sicherungsbeziehung dokumentieren (Grundgeschäft, Designation – Standard: Startdatum des Instruments bzw. Bewertungstag − 3 M –, Hedge Ratio, Methode), hypothetisches Derivat erzeugen, Effektivität testen: Critical Terms (✓/✗), Dollar-Offset prospektiv/kumulativ mit Korridor-Anzeige, Regression (Scatter + Fit, Steigung/R²/n), IFRS-9-Split (OCI/GuV), HGB-Beträge (Einfrierung/Durchbuchung, Drohverlustrückstellung); Ergebnis trägt nach Eingabeänderung den Badge „Eingaben geändert – erneut testen“; **Dokumentation** als Markdown exportieren oder drucken (A4-Kopfzeile); Zusammenfassung mit deutschen Daten/Typen; je Trade lokal gespeichert |

## Innovative UI-Elemente

1. **Schnelleingabe in der Command Palette.** `irs 10y pay 3.1% 10m @Landesbank ↵` legt einen Payer-Swap mit Kontrahent an und springt in den Pricing-Workspace. Die Palette zeigt die Interpretation live an („Payer-Swap EUR 10Y @ 3,100 % · Nominal 10.000.000 · @Landesbank“). `Tab` vervollständigt (leer → Beispiel), `↑` blättert durch die Beispiele, Beispiel-Chips sind klickbar. `stichtag 2026-12-31` setzt den Bewertungstag.
2. **Palette = Keymap.** Jeder Hotkey ist automatisch ein Palette-Befehl (gleiche Beschriftung, gleiche Aktion). Trade-Einträge zeigen Kontrahent und PV und sind nach Kontrahent durchsuchbar; `⇧↵` öffnet den Trade im Report.
3. **Live-What-if ohne Kontextwechsel.** `]` / `[` schieben alle Kurven um ±10 bp – layoutsicher auch über AltGr/Option – oder layoutneutral `+` / `-`; `\` bzw. `0` setzt zurück. Die Topbar zeigt den aktiven Shift orange, der Report kennzeichnet ihn.
4. **Chord-Hotkeys mit Statusanzeige.** Nach `g` erscheint „g … (zweite Taste)“ in der Statusleiste; `Esc` bricht ab.
5. **Inspector** mit allen Vega-/FX-Delta-Buckets, kontextabhängigen Hinweisen; unter 1360 px als schmalere Spalte (280 px), damit kein Inhalt verdeckt wird.
6. **Rechnung sichtbar.** Cashflow-, Pillar-, Key-Rate- und Szenario-Tabellen mit Tastaturnavigation (`↑/↓`, `Home/End`, `PgUp/PgDn`, `y` kopiert die Zeile).
7. **Heatmaps aus CSS-Grid** in Theme-Farben (`color-mix`), klickbar.
8. **Theme in einem Tastendruck (`t`)**, Reporting-Währung (`c`) rotiert EUR→USD→GBP→CHF mit Toast.
9. **Kundenmodus (`Shift+K`).** Blendet interne Informationen aus – Kontrahent, DV01, Margen, CVA/DVA, Hinweise – und zeigt den Chip **KUNDENANSICHT**. In Dokumenten bleibt der gesetzlich geforderte anfängliche Marktwert sichtbar.
10. **Undo.** `Ctrl/⌘+Z` macht die letzten 20 Änderungen rückgängig – Trades (Anlage, Änderung, Löschen, Import, Par-Übernahme, Richtungstausch) **und Quotes** (Einzelquote, Bump, Reset, Spot); der Eintrag ist typisiert („Quote OIS 1M 2,02 → 2,12 %“); Löschen bietet „Rückgängig“ im Toast.
11. **Persistenz.** Trades, Quotes, Interpolations-Overrides, Bewertungstag, Reporting-Währung, Ansicht, Inspector, Kundenmodus, Report-Eingaben je Trade, Hedge-Dokumentationen sowie Blotter-Sortierung/-Filter/-Gruppierung werden im Browser gespeichert (`deriva.v1`, `deriva.blotter.*`); nach dem Laden erscheint ein Toast mit „Zurücksetzen“ (Beispielportfolio).
12. **Zahlenfelder.** Textfelder mit Dezimalkomma, Tausenderpunkt beim Verlassen, Einheit als Suffix, `↑/↓` ±Schritt (`⇧` ×10, `⌥` ×0,1), Kurzformen `10m`, `250k`, `25bp`, `3,1%`; Leeren setzt nie auf 0. Validierung: Nominal > 0, Start < Ende, Verfall ≤ Lieferung, Kauf ≠ Verkaufswährung, Sätze außerhalb −5 … 25 % als Warnung. **Fehler-Level blockiert die Bewertung**: der Trade zeigt „Fehler“ statt „OK“, PV „–“, fällt aus Summen, CSV und EMIR-Export heraus.
13. **Datumsfelder.** Textfelder statt nativer Kalender: `31.12.2027`, `2027-12-31`, Tenor ab Bewertungstag (`10y`, `6m`, `2w`), relativ zum Feld (`+6m`, `-1y`), `heute`, `spot`, `me`/`je` (Monats-/Jahresende); `↑/↓` ±1 Tag (`⇧` Monat, `⌥` Jahr), `⌥↓` oder ▾ öffnet ein kalenderfreies Vorlagen-Popover; ungültiger Text wird nie übernommen.
14. **Lesbare IDs.** `CAP-0002`, `FXF-0003`; Duplikate heißen „Name (Kopie 2)“ ohne Ketten.
15. **Analytics-Whitelist.** Jeder Analytics-Schlüssel des Kerns hat ein deutsches Label mit Einheit (`lib/metrics.ts`) – FX-Delta als Geldbetrag je +1 % Spot, Spot-Datum als Datum, Greeks je bp; unbekannte Schlüssel erscheinen nie roh, sondern unter „Weitere (technisch)“ (Unit-Test prüft alle Beispieltrades und Vorlagen).
16. **Toasts.** Maximal vier sichtbar (älteste ohne Aktion fällt zuerst), identische Meldungen innerhalb einer Sekunde werden zu „×2“ zusammengefasst.

## Vollständige Hotkey-Referenz

Die Tabelle ist aus `apps/web/src/hotkeys/keymap.ts` abgeleitet – dort liegt die einzige Definition; Hilfe-Sheet (`?`), Palette und Statusleiste lesen daraus.

| Gruppe | Tasten | Aktion |
|---|---|---|
| Navigation | `Ctrl/⌘+K`, `/` | Command Palette |
| | `?` | Tastenkürzel-Übersicht |
| | `g b` `g p` `g c` `g s` `g m` `g r` `g v` `g h` | Blotter, Pricing, Kurven, Szenarien, Markt, Report, Vergleich, Hedge Accounting |
| | `Alt+1` … `Alt+8` | dito (auch in Eingabefeldern; macOS per physischer Taste, auch wenn Option ein Sonderzeichen erzeugt) |
| | `Shift+T` | Bewertungstag-Popover (Heute, Monatsende, Quartalsende, −1 Tag) |
| | `Esc` | Eingabefeld verlassen · Chord abbrechen · Dialog schließen |
| Aktionen | `n s` `n c` `n w` `n f` `n o` | Neu: Swap, Cap/Floor/Collar, Swaption, FX-Forward, FX-Option |
| | `n b` `n a` `n i` `n x` | Neu: Basis-Swap, amortisierender Swap, IMM-Swap, FX-Swap |
| | `Ctrl/⌘+Z` | Rückgängig (Trades, Quotes) |
| | `Ctrl/⌘+E` | Cashflows des Trades als CSV |
| | `Ctrl/⌘+Shift+E` | Blotter (sichtbare Spalten, sichtbare Reihenfolge) als CSV |
| | `Ctrl/⌘+Shift+C` | Indikation als Text kopieren („Payer-Swap … · PV … · DV01 … · Stichtag …“) |
| | `Ctrl/⌘+Shift+R` | Report erzeugen (Zeitstempel/Hash fixieren) |
| | `Ctrl/⌘+Shift+T` | Termsheet öffnen (Report wird bei Bedarf erzeugt) |
| | `Ctrl/⌘+Shift+G` | Geeignetheitserklärung öffnen |
| Blotter | `j` / `k` | Nächster / vorheriger Trade **in sichtbarer Reihenfolge** (Filter/Sortierung), scrollt nach |
| | `Enter` | Trade öffnen (nur auf Seite oder **Blotter-Zeile** `tr[data-nav="trade"]` – Pillar-, Szenario- und Cashflow-Zeilen behalten Enter für sich, nie doppelt auf Buttons) |
| | `Space` | Trade für den Vergleich markieren / entfernen |
| | `d` | Duplizieren |
| | `Shift+D` oder `Entf` | Löschen (Toast mit „Rückgängig“) |
| Bewertung | `r` | Neu bewerten |
| | `Shift+P` | Par-Satz / fairen Preis / fairen Spread übernehmen |
| | `f` | Pay/Receive bzw. Kauf/Verkauf tauschen (Toast mit Rückgängig) |
| | `]` oder `+` | What-if +10 bp |
| | `[` oder `-` | What-if −10 bp |
| | `\` oder `0` | What-if zurücksetzen |
| Ansicht | `c` | Reporting-Währung wechseln |
| | `t` | Dark/Light |
| | `i` | Inspector ein/aus |
| | `Shift+K` | Kundenmodus ein/aus |
| Tabellen | `↑/↓` `Home/End` `PgUp/PgDn` | Zeile wählen (Cashflows, Pillars, Szenarien, Key-Rate, Blotter) |
| | `y` | Zeile als Text kopieren |
| | `Enter` | Trade öffnen (Blotter, „P&L je Trade“) |
| | `←/→/↑/↓` `Home/End` | Heatmap-Zelle wählen (What-if-Matrix), `↵` setzt das What-if |
| Zahlenfelder | `↑/↓`, `⇧↑`, `⌥↑` | ±Schritt, ×10, ×0,1 |
| | `Enter` / `Esc` | Übernehmen und verlassen / verlassen |
| Datumsfelder | `↑/↓`, `⇧↑`, `⌥↑` | ±1 Tag, ±1 Monat, ±1 Jahr |
| | `⌥↓` | Vorlagen-Popover (Heute, Spot, +1M … 10Y, Monats-/Jahresende) |
| | `10y` `6m` `+6m` `-1y` `31.12.2027` `2027-12-31` `me` `je` | Eingabeformen |
| Palette | `↑/↓` `↵` `⇧↵` `Tab` `Esc` | navigieren, ausführen, Trade im Report, vervollständigen, schließen (`↑` blättert bei leerem Feld/Beispiel wiederholt durch die Beispiele) |
| Kontextmenü | `↑/↓` `Home/End` `↵`/`Space` `Esc` | Roving-Fokus auf dem aktiven Eintrag (`aria-activedescendant`) |
| Amortisationstabelle | `Ctrl/⌘+V` | zweispaltige Tabelle „Datum;Nominal“ (Excel) als Tilgungsplan übernehmen |

**Layout-Regeln.** Symboltasten (`]` `[` `\` `?` `/` `+` `-` `0`) werden über `e.key` erkannt – Shift, Option (macOS) und AltGr (Windows: Ctrl+Alt) dürfen gedrückt sein. `Alt+Ziffer` vergleicht zusätzlich `e.code` (`Digit1` …); erzeugt Option+Ziffer auf einem deutschen Mac eine Klammer, gewinnt die Klammer. Einzeltasten ohne Modifier sind in Textfeldern deaktiviert; `Enter`/`Space` feuern nie auf fokussierten Buttons, Links oder Checkboxen. Während Palette, Hilfe, Dialoge oder das Stichtag-Popover offen sind, sind Hintergrund-Hotkeys (außer `Esc`) ausgesetzt. Chords müssen innerhalb von 900 ms abgeschlossen werden.

## Schnelleingabe-Grammatik

```
irs|swap|ois  [ccy] <tenor> pay|rec <rate%> [notional] [index]
cap|floor     [ccy] <tenor> <strike%> [notional]
collar        [ccy] <tenor> <capStrike>/<floorStrike> [notional]
swpt|swaption <expiry>x<tenor> payer|receiver <strike%> [notional]
fxf|forward   <pair> <±baseAmount> <rate> <date|tenor>
fxo|option    <pair> call|put <strike> <notional> <date|tenor>
basis         [ccy] <tenor> <recTenor>/<payTenor> [spreadbp] [notional]
amort         [ccy] <tenor> pay|rec <rate%> [notional]      (linear amortisierend)
fxs|fxswap    <pair> <±baseAmount> <nearRate> <farRate> <farDate|tenor>
… @<Kontrahent> [weitere Wörter]                             (überall anhängbar; Name läuft bis zum nächsten Grammatik-Token: „@Kunde GmbH“, „@Landesbank Hessen“, oder @"Bank für Handel")
stichtag <YYYY-MM-DD|dd.mm.yyyy|heute>                        (Bewertungstag)
```
Beträge: `10m` = 10 Mio., `500k`, `2.5m`; Sätze: `3.1%`, `310bp`, `3.1` (→ 3,1 %); Datum ISO oder Tenor ab Spot.

## Barrierefreiheit & Ergonomie

- **Fokus sichtbar:** globaler `:focus-visible`-Ring in Akzentfarbe (auch im Dark-Theme), Tabellenzeilen mit `tabIndex`, `role="row"`, `aria-selected`.
- **Semantik:** Skip-Link „Zum Inhalt“ als erstes Tab-Ziel, `<h1>` für den Produktnamen, Blotter als `role="grid"` (Zeilen mit `aria-selected`/`aria-current`), Heatmaps als `grid`/`table` mit `row`-, `columnheader`-, `rowheader`- und `gridcell`/`cell`-Kindern, sortierbare Spaltenköpfe als `<button>` mit `aria-sort`, Segment-Buttons mit `aria-pressed`, Icon-Buttons mit `title`/`aria-label`, Kennzahlen mit Definitions-Tooltips (ⓘ, per Tastatur fokussierbar) für DV01, Theta, Gamma, Vega, EPE/ENE, CVA/DVA, IFRS-13-Level, Dollar-Offset, Regression, Perspektive, Governance.
- **Dialoge:** Palette (Combobox mit `aria-activedescendant`, Gruppen `role="presentation"`), Hilfe-Sheet, Dokumente, Stichtag-Popover und Kontextmenü (Roving-Fokus, `aria-activedescendant`) sind `role="dialog"`/`menu` mit `aria-modal`, Fokusfalle, Autofokus, Schließen-Button und Fokus-Rückgabe; der Hintergrund ist `inert` – die Fokus-Rückgabe erfolgt deshalb erst im nächsten Frame, nachdem `inert` gefallen ist (E2E-geprüft in Chromium).
- **Toasts:** gestapelt unten rechts (max. 4, Duplikate „×n“), `role="status"`/`aria-live="polite"`, mit Aktion („Rückgängig“, „Zurücksetzen“), pausieren bei Hover.
- **Eingabemodus:** Statusleiste zeigt „Eingabemodus – Esc beendet“, solange ein Textfeld den Fokus hat.
- **Kontraste ≥ 4,5:1** für alle Text/Hintergrund-Paare in beiden Themes – abgesichert durch `src/lib/contrast.test.ts` (WCAG-Relativluminanz ohne Zusatzabhängigkeit): Light-Tokens `--pos #15803d`, `--warn #b45309`, `--info #0e7490`, `--neg #b91c1c`, eigene Badge-Textfarben, `--seg-active-fg` für aktive Segment-Buttons, dunkler Primärbutton mit dunklem Text; `--fg-3` ist rein dekorativ. Badge-Tints werden über `--bg-1` gemischt (kein Tint-über-Tint in markierten Zeilen), Heatmap-Alpha ist auf 0,1 + 0,4·a begrenzt; der Test prüft auch diese zusammengesetzten Paare.
- **Sprache:** Core-Meldungen (fehlende Fixings, Vol-Fallbacks, XVA-Methoden in Lang- und Kurzform, `PricingError`-Codes, Datumsfehler) werden über `lib/i18n.ts` ins Deutsche übersetzt; Leg-Badges („Put EUR/USD“, „Payer-Swaption“), Builder-Namen („Verkauf EUR/USD 2.000.000 @ 1,1725“), Hedge-Zusammenfassungen (Daten, Typen) und Dokumentzahlen (Dezimalkomma) werden in der UI-Schicht germanisiert; Auswahloptionen sind deutsch.
- **Layout:** unter 1360 px wird der Inspector schmaler, Kopfzeilen brechen um, Segmente tragen Kurzlabels, Tooltips öffnen nach innen; kein horizontaler Überlauf bei 1280 px (E2E-geprüft). Schriften aus dem Systembestand (Inter/JetBrains Mono, wenn installiert) – keine externen Font-Requests; SVG-Favicon eingebettet.
- **Druck:** A4-Seiten mit Kopfzeile (Trade, Stichtag, Snapshot-ID, Hash, Perspektive, ggf. What-if-Warnung), Eingaben als statischer Text, helle Tabellenköpfe, 2-spaltige KPIs; Dokumente drucken nur den Dokumentinhalt – ohne Leerseite, Titel dunkel auf weißem Grund; die Hedge-Dokumentation druckt mit eigener Kopfzeile.
- **Architektur:** Alle Komponenten lesen den Store über Selektoren (`useStore(s => …)` / `useShallow`), Aktionen laufen über `useStore.getState()`; Risiko wird nie im Render geschrieben, sondern per `useRisk`-Effekt in den `riskCache` gefüllt; ECharts wird aus `echarts/core` mit nur den benötigten Charts/Komponenten/Renderer gebaut, Vendor-Chunks `echarts` / `core` / `react` sind getrennt, Source-Maps im Produktions-Build sind `hidden`. Die Testumgebung schlägt bei jeder React-Warnung fehl.
