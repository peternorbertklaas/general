# DERIVA – Review Runde 2: UI/UX & Hotkeys (Dim. 3) und User Flows (Dim. 4)

**Reviewer-Rolle:** Senior UX-Designer · Accessibility-Auditor · Trading-Desk-Power-User
**Datum:** 2026-09-03 · **Modus:** Re-Review only, keine Quellcode-Änderungen · **Baseline:** `review-ui.md` (Runde 1: UI 62, Flows 57)

## 0. Prüfstand

| | |
|---|---|
| Repo-Stand | HEAD `2cb1571` + Working Tree (Remediation-Programm; 38 Web-Dateien geändert, neue Komponenten `NumInput`, `Modal`, `DocumentsModal`, `ValuationDatePopover`, `ContextMenu`, `InfoTip`, Views `CompareView`, `HedgeView`) |
| Bundle | `apps/web/dist/assets/index-BBcRFh0H.js` / `index-B_O70GPy.css`, frisch gebaut (`vite build` 21:52 UTC), `vite preview --port 4174` |
| Unit-Tests | `npx vitest run` in `apps/web`: 13 Dateien, **104 Tests grün** (inkl. `contrast.test.ts`, `useHotkeys.test.ts`, `NumInput.test.tsx`, `App.test.tsx`). Zwei React-Warnungen in der Konsole: `Cannot update a component (App) while rendering a different component (CompareView)` (→ `s.risk()` schreibt während des Renders in den Store) und `Encountered two children with the same key, 0-` (→ `keyTokens("+")`, siehe N-04). |
| Browser-Audit | Playwright 1.62 + Chromium (`/opt/pw-browsers/chromium`), Locale `de-DE`, Clipboard-Rechte, Viewports 1600×1000 / 1280×800 / 1920×1080, Dark + Light, Print-Emulation + `page.pdf()`. Skript `…/scratchpad/r2-ui/run.mjs`, **172 automatisierte Checks**, Messwerte in `results.json`, 84 Screenshots, ARIA-Snapshots `aria-blotter.yml`, `aria-pricing.yml`. |
| Konsole | **Keine** JS-Fehler, keine Page-Errors, keine externen Requests (Fonts/Favicon lokal – F-46 behoben). |
| Tastatur-Layouts | Synthetische `KeyboardEvent`s mit korrektem `key`/`code`/Modifiern: Windows-DE (AltGr = Ctrl+Alt: `]`=Digit9, `[`=Digit8, `\`=Minus), macOS-DE (Option: `]`=Digit6, `[`=Digit5, `\`=Shift+Digit7, `¡`=Digit1, `{`=Digit8), `?`=Shift+Minus, `/`=Shift+Digit7; zusätzlich echte Tastendrücke `+` `-` `0`. |

Screenshot-Verzeichnis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r2-ui/` (Übersicht in Abschnitt 7).

---

## 1. Scores

### 1.1 UI/UX & Hotkeys: **88 / 100** (Runde 1: 62)

**Was jetzt Best-in-Class ist (verifiziert):**
- Layout-sichere Hotkeys: `]` `[` `\` funktionieren über AltGr (Windows-DE) **und** Option (macOS-DE), `Alt+1…8` per `e.code` auch wenn Option ein Sonderzeichen liefert (`¡`, `{`), `?` über Shift+ß, `/` über Shift+7; Aliase `+` `-` `0`; `Ctrl+]` und `+` in Textfeldern feuern korrekt **nicht**. Alle 22 Layout-Checks grün.
- `Enter`/`Space` feuern nicht mehr doppelt auf Buttons/Filtern/Spaltenköpfen; `Esc` verlässt Eingabefelder, Statusleiste zeigt „Eingabemodus – Esc beendet“; Chord-Indikator, 900-ms-Timeout, `Alt+n` in Eingabefeldern.
- Fokus: globaler `:focus-visible`-Ring (2 px Akzent, gemessen `solid 2px rgb(79,140,255)`), Rail zusätzlich Glow; Spaltenköpfe sind Buttons mit `aria-sort`, Zeilen `tabIndex`/`role=row`/`aria-selected`, `↑/↓/Home/End/PgUp/PgDn/y` in Blotter, Cashflows, Pillars, Key-Rate, Szenarien.
- Dialoge (Palette, Hilfe, Dokumente): `role=dialog`, `aria-modal`, Autofokus, Fokusfalle (verifiziert: 8× Tab bleibt im Dialog), `inert` auf `.app`, Hintergrund-Hotkeys ausgesetzt; Stichtag-Popover mit Fokus-Rückgabe an den Chip.
- Zahlenfelder: Text-Inputs mit Dezimalkomma, Tausenderpunkt, Einheiten-Suffix, `↑/↓` (Shift ×10), Kurzformen `10m`/`250k`/`25bp`/`3,1%`, Leeren springt nicht auf 0, deutsche Fehlermeldungen (`aria-invalid` + `role=alert`), Plausibilitätswarnung 325 %, Nominal > 0, Ende > Start, Floor < Cap, Kauf ≠ Verkauf.
- Kontraste (gemessen an 60 realen Elementen je Theme): Dark alle Text-Paare ≥ 4,5:1; Light alle Fließtext-Paare ≥ 4,5:1 (`--fg-2` 5,9, `--pos` 5,0, `--neg` 6,5, Badges 4,7–6,6); `color-mix`-Tints statt Hardcodes (`tr.selected`, Rail-Border in Light jetzt Akzent-basiert).
- Ein Formatter-Satz (`fmtNum/fmtMoney/fmtPct/fmtBp`): in Report, Kurven, Szenarien, Markt, Compare **keine** Dezimalpunkte mehr gefunden (Regex-Scan aller Views).
- Toast-Queue mit Aktion („Rückgängig“, „Zurücksetzen“), `role=status`/`aria-live`, Hover-Pause; Undo-Stack (20) mit Statusleisten-Hinweis; Leerzustände mit Call-to-Action in allen 6 datengetriebenen Views; Onboarding-Karte; Kontextmenü (`role=menu`); Spaltenauswahl (persistiert); 1280 px ohne horizontalen Überlauf in allen 8 Views.

**Abzüge (kumuliert ≈ −12):**
- Hoch −3: **Falsche Zahlen/Rohschlüssel in FX-Options-Analytics** – „Delta (% Nominal) −1.079.785,95 %“ (Core liefert Geldbetrag je +1 % Spot, UI multipliziert ×100 und hängt „%“ an), Strike in der Cashflow-Tabelle als „Satz 115,0000 %“, `spotDate` als Zahl „20.728,0000“, `spotAtValuationDate`, `greeksMethod analytic`, `fxDeltaSellCurrency`, `deltaPerBp`/`gammaPerBp2` (Cap/Swaption) ungemappt (N-01, F-14 teilweise).
- Hoch −2: `Enter` auf fokussierter Tabellenzeile in **Kurven** (Pillars) und **Szenarien** springt in den Pricing-Workspace – der globale `open`-Hotkey erlaubt jedes `tr` (N-02).
- Mittel −1,5: Fokus-Rückgabe nach Palette/Dokument-Modal landet im echten Browser auf `body` (`inert` ist beim Cleanup noch gesetzt) – im jsdom-Test grün, in Chromium rot (N-03, F-07 teilweise).
- Mittel −1: `+`-Alias wird als zwei leere `<kbd>`-Kästchen gerendert (Hilfe, Palette), `↑` blättert Beispiele nur einmal, Palette ohne `aria-activedescendant` (N-04…N-06).
- Mittel −1: Sprach-/Formatreste: englische XVA-Methodenstrings im Prüferreport, Leg-Badges „Vanilla Put EURUSD“/„Payer swaption“, Beispielportfolio-Namen „Sell EURUSD 2.000.000 @ 1.1725“, Hedge-Zusammenfassung mit ISO-Daten und „InterestRateSwap“, Termsheet „Prämie in % 1.216 %“ (N-07).
- Niedrig −0,7: Light-Theme: aktive Segment-Buttons 3,84–4,13:1, IRS-Badge in markierter Zeile 4,26:1; Dark: kräftigste Heatmap-Zellen 3,84:1 (N-08).
- Niedrig −0,7: Toast-Stapel unbegrenzt – zehn Toasts füllen die halbe Bildschirmhöhe (N-09).
- Niedrig −0,8: Quotes-Karte bei 1600 px mit Inspector auf drei Spalten beschnitten, Key-Rate-Chart zeigt die Diskontkurve statt der dominanten Kurve, „Annuität (je 1)“ mit 72 Mio., Blotter-Toolbar bei 1280 zweizeilig (N-10…N-12).
- Niedrig −0,5: Kein Skip-Link, Heatmaps `role=table/grid` ohne `row`/`cell`-Kinder, Kontextmenü ohne `aria-activedescendant` (N-13).
- Niedrig −0,5: Undo umfasst nur Trades – `Ctrl+Z` nach Quote-Änderung macht eine **unbezogene** Trade-Änderung rückgängig (N-14).
- Niedrig −0,3: Datumsfelder weiter nativ `type=date` (F-39 offen).

### 1.2 User Flows: **82 / 100** (Runde 1: 57)

- (a) **Indikation im Kundengespräch: sehr gut** – `Ctrl+K` → `collar 7y 3,5/1,5 6m @Kunde GmbH` → `↵` in **0,2 s** mit PV im Toast, lesbarer ID `COL-0002`, Kontrahent gesetzt, `Shift+P` → PV 0, `Ctrl+Shift+C` liefert vorlesbaren Indikationstext, Kundenmodus blendet DV01/Kontrahent/Margen aus. Abzüge: `@`-Token verwirft Wörter mit 3–6 Buchstaben („Kunde **GmbH**“ → „Kunde“, „Landesbank **Hessen**“ → „Landesbank“, „Deutsche **Bank**“ → „Deutsche“) (−1,5); Termsheet nur über Report → „Report erzeugen“ erreichbar, nicht in Palette/Pricing (−1); Termsheet-Druck: leere erste Seite, Titel weiß auf dunklem Balken (−2); Termsheet ohne anfänglichen Marktwert (nur in der Geeignetheitserklärung) und mit Dezimalpunkt „1.216 %“ (−0,5). **≈ −5**
- (b) **Stichtagsbewertung + Export: gut** – Stichtag per `Shift+T`-Popover/Presets/Palette `stichtag 30.09.2026`, Bestand persistiert (Reload: 15 Trades, Stichtag, View, Restore-Toast mit „Zurücksetzen“), Blotter-CSV mit sichtbaren Spalten (`Ctrl+Shift+E`, Dateiname mit Stichtag), JSON-Export/-Import mit Validierung/Undo, EMIR-CSV, Szenario-Editor, klickbare Heatmap. Abzüge: Kostentransparenz-Eingaben (Transaktionspreis, Spreads, Recovery) sind View-lokal und fallen bei jedem View-Wechsel auf 0 zurück (−1,5); Interpolations-Override geht bei Stichtagswechsel stumm verloren, wird nicht persistiert und nicht als „modifiziert“ markiert (−1); Re-Import des eigenen Exports benennt alle 15 Trades um statt Überspringen anzubieten (−0,5); Blotter-Sortierung/Filter nicht persistiert (−0,3); kein Portfolio-Report (nur je Trade) (−1). **≈ −4,5**
- (c) **Prüfer: Kurven → Residuen → Report-Hash: mittel-gut** – Quotes im Store (View-Wechsel und Stichtagswechsel erhalten Edits, orange Markierung, Original im Tooltip, Chip „modifiziert“), Residuum-Spalte, expliziter „Report erzeugen“ mit stabilem Zeitstempel, Engine-Version, Snapshot-ID, Report-Hash, Inputs-Hash, What-if-Kennzeichnung inkl. JSON und Export-Bestätigung. Abzüge: **Report-Hash ignoriert die Kostentransparenz** – Transaktionspreis 0 und 25.000 liefern denselben Hash (Core-Probe `aa2cf24799ef137b` = `aa2cf24799ef137b`), obwohl Marge und anfänglicher Marktwert im Report stehen (−2,5); Quote-Änderung setzt den Report **nicht** auf „Eingaben geändert“ (`inputsKey` nutzt `JSON.stringify(quotes).length`, ein +10-bp-Bump ändert die Länge nicht) und der Report-Kopf sagt weiter „Snapshot Sample EoD“ ohne „modifiziert“ (−2); Methodenstrings englisch (−0,5). **≈ −5**
- (d) **Hedge-Designation → Effektivität: gut** – Defaults aus dem Instrument, hypothetisches Derivat, Critical-Terms, Dollar-Offset prospektiv/kumulativ mit Korridorband, Regression (Scatter + Fit), IFRS-9/HGB-Buchung, Persistenz je Trade (verifiziert nach Trade-Wechsel). Abzüge: Default-Designationsdatum = Bewertungstag → kumulativer Test trivial „nicht beurteilbar“ und Warnung „Off-Market-Derivat“ statt Designation am Handelstag (−1); nach Änderung (Hedge Ratio 50 %) bleibt das alte Urteil „✓ effektiv“ ohne Veraltet-Hinweis stehen (−1); keine Export-/Druckfunktion der Sicherungsdokumentation (−1); Zusammenfassung mit ISO-Daten (−0,2). **≈ −3,2**
- Übergreifend: Fehlerpfad „Kauf = Verkaufswährung“ zeigt die Meldung, bewertet aber weiter (Inspector PV 292.141 bei Spot 1,0000, Blotter „OK“) (−1); Hotkeys auf leerem Portfolio (`Shift+P`, `Ctrl+Shift+C`) ohne Feedback (−0,3).

---

## 2. Status der Runde-1-Befunde

Legende: ✅ behoben · 🔶 teilweise · ❌ offen. Belege = Check-Name in `results.json` / Screenshot.

| # | Titel (R1) | Status | Beleg / Rest |
|---|---|---|---|
| F-01 | `]` `[` `\` auf DE/macOS tot | ✅ | 22 synthetische Layout-Checks grün (`DE Win AltGr+9 ']' bumps`, `DE Mac Option+Shift+7 '\' resets`, `Mac Option+1 '¡' → Blotter`, `Mac Option+8 '{' → Hedge`); Aliase `+` `-` `0`; `SYMBOL_KEYS` + `e.code` in `useHotkeys.ts` |
| F-02 | `Enter` doppelt auf Buttons | 🔶 | Buttons/Filter/`th` ok (`Enter on th button did not navigate`); **neu:** `Enter` auf fokussierten Zeilen in Kurven/Szenarien springt nach Pricing (N-02) |
| F-03 | `NumInput` springt auf 0, „02.5“ | ✅ | `cleared stays empty`, `clearing does not change PV`, `typing 3,25 kept`, Kurzformen `250k`/`25bp`/`3,1%`, `ArrowUp steps 0,005`, `Shift+ArrowUp ×10` |
| F-04 | Keine Plausibilitätsprüfung | 🔶 | Nominal ≤ 0, Ende < Start, Floor ≥ Cap, 325 % (Warnung), Kauf = Verkauf – alle mit deutscher Meldung + `aria-invalid` (`1600-dark-editor-dateerr.png`). **Rest:** Bei Fehler-Level „Kauf = Verkaufswährung“ wird weiter bewertet und im Blotter „OK“ gezeigt (Inspector PV 292.141, `1600-dark-curves-usd.png`) |
| F-05 | `Esc` verlässt Feld nicht | ✅ | `Esc blurs input`, `statusbar shows Eingabemodus`; Hilfe-Text dokumentiert |
| F-06 | Kein `:focus-visible` | ✅ | Rail `solid 2px rgb(79,140,255)` + Glow, `th-btn` Ring, Inputs Border+Shadow (`1600-dark-focus-rail.png`) |
| F-07 | ARIA für th/tr/seg/Toast/Overlay, Fokus-Rückgabe | 🔶 | `th[aria-sort]` 8, `.th-btn` 8, Zeilen `tabindex`/`aria-selected` 11, `aria-pressed` 4, Toast `role=status aria-live=polite`, `h1`, Dialoge `aria-modal` + Fokusfalle. **Rest:** Fokus-Rückgabe nach Palette/Modal → `body` (N-03); Palette ohne `aria-activedescendant` (N-06) |
| F-08 | Gemischte Dezimaltrennzeichen | 🔶 | Views ohne Dezimalpunkte (Scan `decpoint_*` leer für Kurven/Szenarien/Markt/Report/Pricing). **Rest:** Termsheet „1.216 %“, Beispielnamen „@ 3.00%“, „1.1725“ (Core-Builder), Hedge-Summary ISO-Daten (N-07) |
| F-09 | `j/k` ignorieren Sortierung, kein Scroll | ✅ | `j/k within filtered set` (FXO), `j scrolls selected into view` |
| F-10 | Light-Kontraste < AA | 🔶 | Tokens neu (`--pos #15803d` 5,0, `--warn #b45309`, `--info #0e7490`, Badge-Text-Tokens, `--btn-primary-fg`), Vitest-Kontrasttest. **Rest:** aktive Segment-Buttons 3,84–4,13, Badge in markierter Zeile 4,26 (N-08) |
| F-11 | Report ohne What-if-Kennzeichnung | ✅ | Badge „⚠ What-if … – nicht prüfungsfähig“, `market.label` und `whatIf` im JSON, Export-Bestätigung (`what-if export asks confirmation`) |
| F-12 | Quotes desynchron / Datumswechsel verwirft | ✅ | `quote edit survives view switch`, `date change keeps quote edits`, Chip „modifiziert“, `tr.edited`, Tooltip „Original 2,0100 %“ |
| F-13 | Keine Persistenz | ✅ | `trades persisted`, `valuation date persisted`, `view persisted`, Restore-Toast mit „Zurücksetzen“ (`1600-dark-after-reload.png`) |
| F-14 | Analytics-Heuristik (Strike „1“, Prämie „0“) | 🔶 | `METRICS`-Map: Strike 1,1500, Prämie/Einheit 0,01976, Pips 197,6. **Rest:** ungemappte Schlüssel und falsch skaliertes `deltaPct` (N-01) |
| F-15 | Vega-Dubletten, Basis-KPI „–“ | ✅ | `no duplicate analytics labels`; Basis-Swap-KPI „Fairer Spread 7,8 bp“; Preis-Analytics / Risiko (Bump) getrennt |
| F-16 | Kryptische IDs, Kopie-Ketten | ✅ | `COL-0002`, `IRS-0004`; Duplikat „… (Kopie 2)“ |
| F-17 | Kontrahent leer ohne Hinweis | ✅ | Feldwarnung „Kontrahent fehlt (offen)“, Chip „ohne Kontrahent (n)“, KPI-Bucket klickbar, `@Token` |
| F-18 | Delete ohne Bestätigung/Undo | ✅ | Toast „Gelöscht … Rückgängig“, `Entf` zusätzlich, `Ctrl+Z`, Button-`title`s |
| F-19 | Negativer What-if grün | ✅ | `negative what-if not green` (`num neg`), Zahlenfeld neben Slider |
| F-20 | Palette ohne Parität/Kontrahentensuche, zufälliges Tab | ✅ | Items aus `HOTKEYS`, Kontrahentensuche (`palette finds trades by counterparty`), `Tab` vervollständigt, Zähler 41 = `VISIBLE_HOTKEYS` |
| F-21 | Hotkeys hinter Overlay aktiv | ✅ | `help open: 't' suspended`, `hotkeys suspended while popover open`; Sheet 4-spaltig |
| F-22 | Kein Leerzustand | ✅ | `tr.empty-row` + „Filter zurücksetzen“, Empty-States in Blotter/Pricing/Report/Szenarien/Vergleich/Hedge |
| F-23 | KPI-Karten gestreckt, Chart ohne Titel | ✅ | `align-items:start` (1920: Kartenhöhen 93/93/110/192), „PV je Typ“, `hideOverlap` |
| F-24 | 1280-Overflow | ✅ | `1280 no overflow` in 8 Views; Inspector 280 px; Kurzlabels „€STR/EUR 6M/SOFR“. Kosmetik: Toolbar zweizeilig (N-12) |
| F-25 | Sprachmix | 🔶 | `lib/i18n.ts` übersetzt Fixing-/Vol-/XVA-Meldungen, Badges, Cashflow-Arten, Optionen. **Rest:** N-07 |
| F-26 | `generatedAt` je Render, Freitext-Transaktionspreis | ✅ | `generatedAt stable`, „Eingaben geändert“-Badge, Version/Snapshot/Hash-Zeile, `NumInput` mit Fehlermeldung |
| F-27 | Druck: dunkle Inputs, schwarzer Tabellenkopf | ✅ (Report) / 🔶 (Dokumente) | Report-Druck: weißer Body, `th` weiß, Inputs als Text, Kopfzeile mit Trade/Stichtag/Snapshot/Hash (`1600-report-print.png`). **Rest:** Termsheet-Druck N-16 |
| F-28 | Stichtag nur in Markt-View | ✅ | Chip → Popover, `Shift+T`, Presets, Palette `stichtag …` (ISO/DE/heute) |
| F-29 | Kein Bestands-Export | 🔶 | Blotter-CSV (sichtbare Spalten, Reihenfolge), JSON-Export/-Import, Key-Rate-CSV. **Rest:** kein Portfolio-Report |
| F-30 | Key-Rate nur Chart, Labels überlappen | 🔶 | Tabelle Bucket/Datum/Δ/kumuliert + CSV, `hideOverlap`. **Rest:** Kurvenwahl (N-11) |
| F-31 | „-0“ | ✅ | `clean()` mit Schwelle + `Object.is(-0)`; keine „-0“ mehr gefunden |
| F-32 | Toast Single-Slot | ✅ / 🔶 | Queue, Aktionen, `aria-live`, Hover-Pause (`toasts stack` 5). **Rest:** unbegrenzt (N-09) |
| F-33 | FX-Swap-Kurs ungerundet/falsche Richtung | ✅ | „Kurs EUR/USD“, 4 Dezimalen (`1600-dark-editor-fxs.png`) |
| F-34 | Anführungszeichen gemischt | ✅ | „irs 10y pay 3.1% 10m“ |
| F-35 | Rail-Ziffern 9 px `--fg-3` | ✅ | 10 px `--fg-2`, gemessen 5,24 (dark) / 4,73 (light) |
| F-36 | Palette ohne Gruppen-Sticky/PV | ✅ | `.group` sticky, Trade-Items mit Typ · Kontrahent · PV |
| F-37 | Inspector nur erster Vega-Eintrag | ✅ | Alle Vega-/FX-Delta-Buckets als Tabelle, `ellipsis`, kontextabhängige Hinweise. Kosmetik: Rohschlüssel bei FX-Forward (N-01) |
| F-38 | Heatmap hartcodiert, nicht klickbar | ✅ | `heatBg()` mit `color-mix`, Zellen als Buttons (`heat click sets what-if`), aktive Zelle markiert |
| F-39 | Native `type=date`, kein Tenor | ❌ | Unverändert (`DateInput`, `DateField`) |
| F-40 | Warnungen nur Hover | ✅ | Badge-Button öffnet Popover mit Liste (`1600-dark-blotter-warnpopover.png`) |
| F-41 | Vergleich falsche Währung | ✅ | `compare list filtered to same ccy (USD)` → nur „–“ |
| F-42 | CVA „--0“ | ✅ | `fmtMoney(-cva)` + `signClass` |
| F-43 | Statusbar ohne Kontext | ✅ | View-spezifische Hints, Eingabemodus, Undo-Label, „Quotes modifiziert“, Chord |
| F-44 | Doppelte Label-Quellen | ✅ | `TEMPLATE_LABELS` |
| F-45 | Doppelklick undokumentiert | ✅ | Hint-Zeile, Kontextmenü (7 Einträge) |
| F-46 | Google Fonts, kein Favicon | ✅ | Keine externen Hosts im Bundle, SVG-Favicon als Data-URI |
| F-47 | Beispielzeile unlesbar | ✅ | Klickbare Beispiel-Chips, `kbd Tab` |

### Light-Theme-Befunde L-1…L-14

| # | Status | Beleg |
|---|---|---|
| L-1 `--pos` | ✅ | 5,02:1 (`td.num.pos`) |
| L-2 `--warn` | ✅ | Badge warn 4,68, Chip warn ≥ 4,5 |
| L-3 `--info`/FX-Badge | ✅ | 5,64 |
| L-4 `--fg-3` als Text | ✅ | nicht mehr als Textfarbe verwendet |
| L-5 `--fg-2` auf `--bg-3` | ✅ | `kbd` 8,65, Chips 9,39 |
| L-6 Hardcodes | ✅ | `tr.selected`/Rail-Border = `color(srgb 0.145 0.388 0.922 / 0.45)` (Light-Akzent) |
| L-7 Backdrop | ✅ | `--backdrop rgba(15,23,42,.32)` |
| L-8 Chip-Punkt | ✅ | Ring `0 0 0 2px bg-1, 0 0 0 3px pos` |
| L-9 Karten flach | ✅ | `--shadow-1` mit 1-px-Ring, `--border #cbd5e1` |
| L-10 Primärbutton dark 3,22 | ✅ | `--btn-primary-fg #0b0f17` |
| L-11 Achsenlinien | ✅ | `borderStrong` |
| L-12 Warnbox | ✅ | 8,42 |
| L-13 | ✅ | – |
| L-14 Charts bei Theme-Wechsel | ✅ | `useEffect([option, theme])` |

### Abschnitt 4 (R1) – fehlende UI-Fähigkeiten

Umgesetzt: 1 Spaltenauswahl · 2 Tastatur-Zeilenauswahl · 3 Inline-Validierung · 4 Undo (Trades) · 5 Trade-Compare · 6 Layout-Persistenz (Inspector/View/Spalten) · 7 Print + Kopfzeile · 9 Zahlenfeld-UX · 10 Tooltips (ⓘ) · 11 Palette-Fokus (teilweise, N-03) · 12 Toast-Queue · 13 Empty States · 14 Onboarding · 15 Stichtag-Popover + „modifiziert“ · 16 Blotter-Export + Indikation kopieren · 17 Kontextmenü · 18 klickbare Heatmap + Key-Rate-Tabelle · 19 Eingabemodus · 20 layoutneutrale Tasten. **Offen:** 8 i18n-Toggle DE/EN (nicht im v1-Scope dokumentiert, kein Abzug), 4 Undo für Quotes/What-if (N-14), Portfolio-Report (F-29).

### Abschnitt 6 (R1) – Hotkey-Konflikte

`]`/`[`/`\` ✅ · `Alt+1…8` ✅ · `Enter` ✅ (außer N-02) · `d`/`Shift+D` ✅ (Undo, `Entf`) · `f` ✅ (Toast + Undo) · `c` ✅ (Toast) · `r` ❌ „Neu bewerten“ weiterhin ohne Wirkung bei Live-Pricing · `t` ❌ weiter Einzeltaste (Fehlauslösung möglich, kosmetisch) · `Tab` Palette ✅ · Overlay ✅ · `Esc` ✅ · `Ctrl+Shift+E` ✅ · Stichtag/Undo/Blotter-Export/Report-öffnen (`⇧↵`) ✅ · Suche fokussieren (`s`) ❌ (nicht umgesetzt, kosmetisch).

---

## 3. Neue Befunde

Schweregrade wie in R1. Reproduktion jeweils gegen das Preview-Bundle; Belege in `results.json` (Check-Name) bzw. Screenshot.

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| N-01 | **Hoch** | `lib/metrics.ts` `METRICS.deltaPct`, `analyticsRows()`, `PricingWorkspace.tsx` Cashflow-Tabelle | FX-Option: „Delta (% Nominal) **−1.079.785,95 %**“ – Core `deltaPct` = Barwertänderung je +1 % Spot in Reporting-Ccy (`fx-pricer.ts:252`), UI formatiert `v*100 %`. Rohschlüssel sichtbar: `spotDate 20.728,0000` (Serial-Datum als Zahl!), `spotAtValuationDate`, `greeksMethod analytic`, `fxDeltaCurrency USD`, `fxDeltaSellCurrency −16.935,7229` (Inspector FX-Forward), `deltaPerBp 1.453,7856`, `gammaPerBp2 0,7295` (Cap/Swaption). Cashflow-Zeile „Vanilla Put EURUSD“ zeigt Strike als „Satz **115,0000 %**“ (`fmtPct(1.15)`). Screenshots `1600-dark-editor-fxo.png`, `1600-dark-pricing-collar.png`, `1600-dark-editor-swpt.png`, `1600-dark-curves-usd.png` (Inspector). | `deltaPct: {label:"FX-Delta", unit:"je +1 % Spot", fmt: money, section:"risk"}`; `spotDate: {label:"Spot-Datum", fmt: v=>fmtDate(v)}`; `spotAtValuationDate: fmtNum(v,4)`; `fxDeltaCurrency`/`greeksMethod` in `SKIP` bzw. als Text-Zeile „Greeks: analytisch“; `deltaPerBp`/`gammaPerBp2` → „Delta (je 1 bp)“/„Gamma (je 1 bp²)“ money; Cashflow-Satz für `kind==="OptionPayoff"` bei FX als `fmtNum(rate,4)` ohne „%“. Unit-Test: `analyticsRows` darf keinen Roh-Key (camelCase) als Label liefern. |
| N-02 | **Hoch** | `useHotkeys.ts` `enterAllowed()`, `useTableNav.ts` | `Enter` auf fokussierter Pillar-Zeile (Kurven) und Szenario-Zeile → View wechselt nach Pricing (`Enter on focused pillar row … :: / Pricing`, `Enter on focused scenario table row … :: / Pricing`). `enterAllowed` erlaubt jedes `tr`; nur Blotter-Zeilen sollen „öffnen“. Im Blotter feuern zudem `useTableNav.onEnter` **und** der globale `open` doppelt (idempotent, aber zwei Dispatches). | `enterAllowed`: `el.closest("tr[data-open]")` bzw. `table.blotter tr`; Blotter-Zeilen `data-open`; `useTableNav` ruft `e.stopPropagation()` nach `onEnter`. Test: Enter auf Pillar-Zeile → `view === "curves"`. |
| N-03 | Mittel | `CommandPalette.tsx` (Cleanup-Effekt), `Modal.tsx` `useFocusTrap`, `App.tsx` `inert={dialogOpen}` | Fokus-Rückgabe schlägt im echten Browser fehl: nach `Esc` ist `document.activeElement === body` (`palette returns focus … :: BODY`, `modal returns focus to opener :: Δ ▤ 1 …`). Ursache: `p.focus()` läuft im Effekt-Cleanup, während `.app` noch `inert` ist (Attribut fällt erst im selben Commit). jsdom kennt `inert` nicht → `App.test.tsx` grün, Chromium rot. | Fokus-Rückgabe verzögern: `window.setTimeout(() => p.focus(), 0)` oder `requestAnimationFrame`, bzw. in `App` einen `useEffect` auf `dialogOpen === false` legen, der `lastDialogOpener.current?.focus()` ruft. E2E-Check in `smoke.mjs`. |
| N-04 | Mittel | `hotkeys/keymap.ts` `keyTokens()` | `"+".split("+")` → `["",""]` → zwei leere `<kbd>` (Hilfe „] oder ▢▢“, Palette; React-Warnung `same key 0-`). `help sheet: no empty kbd boxes :: 2`, `1600-dark-help.png`. | `if (combo === "+") return ["+"];` bzw. `combo.split(/\+(?=.)/)`; Test `keyTokens("+")` → `[["+"]]`. |
| N-05 | Mittel | `CommandPalette.tsx` `onKey` ArrowUp | „↑ weitere“ funktioniert nur einmal: nach dem ersten ↑ ist `q` gefüllt, `!q && active===0` false → kein weiteres Rotieren (`↑ rotates … :: ois 2y rec 2.18% 25m → ois 2y rec 2.18% 25m`). | Zustand `browsingExamples` setzen, solange `q === QUICK_ENTRY_EXAMPLES[exampleIdx]`; ↑/↓ rotieren dann weiter, jede andere Eingabe beendet den Modus. |
| N-06 | Mittel (A11y) | `CommandPalette.tsx`, `ContextMenu.tsx` | `role=combobox` ohne `aria-activedescendant` (`activedesc: null`), Gruppen-`div` ohne `role=presentation` im `listbox`; Kontextmenü hält Fokus auf dem Container ohne `aria-activedescendant`. Screenreader lesen die aktive Option nicht. | `aria-activedescendant={`pal-${active}`}`, Options mit `id`; Gruppen `role="presentation"`; Kontextmenü: Fokus auf aktives `menuitem` bewegen (Roving Tabindex). |
| N-07 | Mittel | `lib/i18n.ts`, `packages/pricing-core/src/instruments/builders.ts`, `documents.ts`, Hedge-Summary, Cashflow-Leg-Badges | Englische/inkonsistente Texte im Prüfer- und Kundenmaterial: Report „Methode: Swaption-replication (Sorensen–Bollier), **smile vol at strike**, flat hazard“ und „Delta-normal exposure (rolled sensitivities, ATM vols at (t, remaining tenor))“ (Regex trifft nur die Kurzform), Leg-Badges „Vanilla Put EURUSD“/„Payer swaption“, Beispielportfolio „Sell EURUSD 2.000.000 @ 1.1725“, „Payer swaption 1Yx5Y @ 3.000%“, Termsheet „Prämie in % **1.216 %**“, Hedge-Zusammenfassung „designiert am 2026-09-30“, „(InterestRateSwap)“, „10.000.000,00 EUR“. | Regeln in `CORE_MESSAGES` erweitern (`/^Swaption-replication.*flat hazard$/`, `/^Delta-normal exposure.*$/`); `LEG_TYPE_DE` um `Vanilla Put/Call`, `Payer swaption`; Builder-Namen deutsch mit `formatDe` (`Verkauf EUR/USD 2 Mio @ 1,1725`); `documents.ts` Prämie mit `formatPctDe`; Hedge-Summary `fmtDate`/`TRADE_TYPE_DE`. |
| N-08 | Niedrig | `styles/app.css` `.seg button[aria-pressed=true]`, `.badge.irs` in `tr.selected`, `heatBg()` | Light: aktive Segment-Buttons 3,84:1 (auf `--bg-0`) / 4,13:1 (auf `--bg-1`), IRS-Badge in markierter Zeile 4,26:1 (Tint über Tint). Dark: kräftigste Heat-Zellen (65 % `--pos`) 3,84:1 mit `--fg-0`. Messwerte `contrast_light_*`, `heat_dark_scen`. | `[data-theme=light] .seg button[aria-pressed=true]{color:#1d4ed8}`; Badge-Hintergründe mit `--bg-1` statt `transparent` mischen; Heat-Alpha im Dark-Theme auf `0.1+0.4a` begrenzen oder Text `#fff`/`#0b0f17` je Luminanz. Kontrast-Test um zusammengesetzte Paare erweitern. |
| N-09 | Niedrig | `store.ts showToast`, `.toast-stack` | Kein Limit: 10 Toasts stapeln sich bis zur Bildschirmmitte (`1600-dark-blotter-final.png`); Erfolgsmeldungen (Export) und Undo-Toasts konkurrieren. | Max. 4 sichtbar (älteste ohne Aktion zuerst verwerfen), gleiche Nachricht innerhalb 1 s zusammenfassen („×2“), `.toast-stack{max-height:40vh}`. |
| N-10 | Niedrig | `CurvesView.tsx` `.curves-grid`, `.quotes` | Bei 1600 px mit Inspector ist die Marktquotes-Karte ~380 px breit: Spalten Zero/DF/Residuum abgeschnitten („3,“) ohne sichtbare Scroll-Affordance (`1600-dark-curves-usd.png`). | `.curves-grid{grid-template-columns:minmax(0,1.4fr) minmax(460px,1fr)}`; unter 1500 px einspaltig; Quote-Input 100 px; Residuum in Tooltip/Spaltenauswahl. |
| N-11 | Niedrig | `PricingWorkspace.tsx` `bucket` | Key-Rate-Chart wählt die erste Kurve mit |Δ| > 1e-6 – beim Collar EUR-ESTR (Σ −27) statt EUR-EURIBOR-6M (Σ 1.455), bei der FX-Option EUR-ESTR statt USD-SOFR (−84) (`1600-dark-pricing-collar.png`, `1600-dark-editor-fxo.png`). Kein Kurven-Umschalter. | Kurve mit max |total| vorauswählen; Chips je Kurve als Segment-Buttons (`aria-pressed`) über dem Chart. |
| N-12 | Niedrig | `Blotter.tsx` Toolbar (1280), `metrics.ts annuity`, `EChart` x-Achse | Toolbar bei 1280 zweizeilig (JSON/Import/EMIR in Zeile 2); „Annuität (je 1) 72.065.806,5332“ ist die Gesamt-Annuität, nicht „je 1“; „PV je Typ“-Achse „200,0 T“ abgeschnitten (`1280-dark-blotter.png`, `1600-dark-blotter.png`). | Export-Buttons in ein „⤓ Export ▾“-Menü; Annuität `fmtMoney(v)` ohne „je 1“ oder durch Nominal teilen; `grid.right: 24`. |
| N-13 | Niedrig (A11y) | `App.tsx`, `MarketView.tsx` `.heat[role=table]`, `ScenariosView.tsx` `.heat[role=grid]`, `navRowProps` | Kein Skip-Link (13 Tab-Stopps bis `main`); Heatmap-`role=table/grid` mit direkten `div`/`button`-Kindern statt `row`/`cell`/`gridcell` (ARIA-Struktur ungültig, `scenA11y.childRoles: ["DIV"]`); `aria-selected` auf `role=row` in einer `table` ist nur in `grid` zulässig. | `<a class="skip" href="#main">Zum Inhalt</a>`; Heatmaps mit `role=row`-Wrappern und `role=gridcell`, Pfeiltasten-Navigation; Blotter `table role="grid"` oder `aria-selected` entfernen und `aria-current="true"` nutzen. |
| N-14 | Niedrig | `store.ts undo` | Undo umfasst nur Trades: `Ctrl+Z` nach Quote-Reset macht „Änderung FXF-0003“ rückgängig (`undoQuotesToast`). What-if, Quotes, Interpolation, Hedge-Dokumentation sind nicht rückgängig. Beschriftung „Rückgängig (Trades)“ ist ehrlich, das Verhalten für Nutzer trotzdem überraschend. | Undo-Einträge typisieren (`kind: "trades" | "quotes" | "hedge"`), Quote-Änderungen in den Stack (Snapshot `quotes`), Toast „Rückgängig: Quote OIS 1M 2,02 → 2,01 %“. |
| N-15 | Mittel (Flow) | `lib/quick-parser.ts` `extractCounterparty()` | Nach `@` werden Folgewörter mit 3–6 Buchstaben (`/^[a-z]{3,6}$/i`) als mögliche Ccy/Typ-Token verworfen: „@Kunde GmbH“ → „Kunde“ (`advisorIndication`), „@Landesbank Hessen“ → „Landesbank“ (`grammar[0]`), „@Deutsche Bank“ → „Deutsche“. Die Vorschau zeigt den verkürzten Namen – leicht zu übersehen. | Nach `@` nur abbrechen, wenn das Token ein **bekanntes** Ccy-/Richtungs-/Tenor-/Zahl-Token ist (`CCYS`, `pay|rec|…`, `TENOR`, `/^[\d.,]/`); alternativ Anführungszeichen `@"Deutsche Bank"` unterstützen. Test mit „GmbH“, „Bank“, „AG“, „Hessen“. |
| N-16 | Mittel (Flow) | `styles/app.css @media print body.print-doc`, `DocumentsModal.tsx` | Termsheet-/Erklärungsdruck: erste Seite leer (Modal-Backdrop bleibt `display:grid; place-items:center` → Inhalt beginnt bei ~1000 px), Titel „Indikatives Termsheet – …“ und Disclaimer stehen weiß auf dunklem `.modal`-Hintergrund → unleserlich (`1600-termsheet-print.png`, `termsheet-print.pdf`). | `body.print-doc .modal-backdrop{display:block;position:static;padding:0}`, `.modal,.doc,.doc-head{background:#fff;color:#111}`, `.doc-head h1{color:#111}`, `.doc-disclaimer{color:#333}`; Kopfzeile wie im Report (`report-print-header`). E2E: Print-Emulation mit `print-doc` prüft Textfarbe des `h1`. |
| N-17 | Mittel (Flow) | `ReportView.tsx` lokale States `offerPv/cptySpreadBp/ownSpreadBp/recovery` | Kostentransparenz-Eingaben fallen bei jedem View-Wechsel auf Defaults zurück (Druck zeigt „Transaktionspreis 0“, obwohl 25.000 eingegeben waren; `1600-report-print.png`). Berater verliert Angebotspreis beim Blick ins Pricing. | Eingaben je Trade im Store (`reportInputs[tradeId]`, persistiert), Reset-Button „Standardwerte“. |
| N-18 | Mittel (Flow) | `ReportView.tsx` `inputsKey`, Report-Kopf | Quote-Änderung (Bump +10 bp) setzt keinen „Eingaben geändert“-Badge (`quote change flags report stale` ❌, `inputsKey` nutzt `JSON.stringify(s.quotes).length`); Report-Kopf „Snapshot Sample EoD“ ohne „modifiziert“, obwohl Chip und Statusleiste es zeigen (`reportHeaderModified`). Snapshot-ID ändert sich korrekt. | `inputsKey` mit `report.audit.snapshotId`/`quotesModified(s.quotes)` statt String-Länge; `report.market.label` um „ · Quotes modifiziert“ ergänzen (auch im JSON/Druckkopf). |
| N-19 | Mittel (Flow) | `packages/pricing-core/src/reporting/valuation-report.ts:160` | Report-Hash deckt die Kostentransparenz nicht ab: `transactionPrice` 0 vs. 25.000 → identischer `reportHash` (Core-Probe `aa2cf24799ef137b`), UI `audit1 === audit2`. Prüfer kann Marge/anfänglichen Marktwert nicht per Hash belegen. | `costTransparency` vor dem Hashing in das Report-Objekt aufnehmen (bzw. Hash über `{...report, costTransparency}`); Test `reportHash(tp=0) !== reportHash(tp=25000)`. |
| N-20 | Mittel (Flow) | `views/HedgeView.tsx` `defaultRelationship`, Ergebnis-Karte | Default-Designationsdatum = Bewertungstag → kumulativer Dollar-Offset „nicht beurteilbar“, Warnung „Off-Market-Derivat“ (`1600-dark-hedge.png`); nach Änderung (Hedge Ratio 50 %) bleibt „✓ effektiv“ ohne Veraltet-Hinweis (`hedge result flagged stale` ❌); keine Export-/Druckfunktion der Sicherungsdokumentation. | `designationDate` = Handels-/Startdatum des Instruments (`legs[0].effectiveDate`); `stale`-Key wie im Par-Risk-Panel (`JSON.stringify(rel)`+Markt) → Badge „Eingaben geändert – erneut testen“; Button „Dokumentation drucken/Markdown“ analog `DocumentsModal`. |
| N-21 | Mittel (Flow) | `store.ts priceAll`, `Blotter.tsx` Bewertung-Spalte, `validate-trade.ts hasErrors` | Trades mit Fehler-Level-Validierung werden weiter bewertet und als „OK“ geführt: FX-Forward USD/USD → PV 292.141 bei Spot 1,0000 (Inspector, `1600-dark-curves-usd.png`), erscheint in Blotter-Summe, CSV und EMIR-Export. | In `priceAll` `hasErrors(validateTrade(t))` → `results[t.id] = {error: "Ungültige Eingaben"}`; Blotter-Badge „Fehler“, Export markiert; KPI-Summe ohne fehlerhafte Trades. |
| N-22 | Niedrig (Flow) | `ReportView.tsx`, `CommandPalette.tsx` | Termsheet/Geeignetheitserklärung nur nach „Report erzeugen“ und nur in der Report-View; keine Palette-Aktion, kein Hotkey (`termsheet reachable before report generation` ❌, `palette offers Termsheet action` ❌). Termsheet ohne Zeile „Anfänglicher Marktwert“ (nur die Geeignetheitserklärung trägt sie, `documents.ts:229`). | Hotkeys `mod+shift+t` (Termsheet) / `mod+shift+g` (Erklärung) mit implizitem `generateReport()`; Button auch im Pricing-Header; Termsheet-Sektion „Indikative Bewertung“ um „Anfänglicher Marktwert (Kundensicht)“ ergänzen. |
| N-23 | Niedrig (Flow) | `CurvesView.tsx` `interp` (lokaler State), `store.ts setValuationDate/partialize` | Interpolations-Override verschwindet stumm bei Stichtagswechsel (`interp override survives date change` ❌: zurück auf log-linear), wird nicht persistiert und nicht als „modifiziert“ markiert; abhängige Kurven werden beim Override nicht neu gebootstrappt. | `interpolation: Record<curveId, InterpolationMethod>` in den Store + `partialize`; `rebuildMarket` berücksichtigt Overrides; `quotesModified` → `marketModified` (Quotes ∨ Overrides ∨ Spots). |
| N-24 | Niedrig (Flow) | `store.ts importTrades`, `Blotter.tsx` | Re-Import des eigenen Exports benennt alle Trades um („15 Trades importiert (15 umbenannt)“) – kein „überspringen/ersetzen“. Sortierung/Filter nicht persistiert (`blotter sort persisted` ❌). Hotkeys auf leerem Portfolio (`Shift+P`, `Ctrl+Shift+C`) ohne Feedback. | Import-Dialog mit Strategie (überspringen / ersetzen / umbenennen); `sort/filter` in `LS_KEYS`; Toast „Kein Trade ausgewählt“. |
| N-25 | Niedrig | `views/PricingWorkspace.tsx` Vega-Buckets, Doku `03-ui-konzept` | „Vega-Buckets für Optionen“ – FX-Optionen erhalten keine Bucket-Karte (`vegaBuckets` kennt nur `swaption`/`caplet`; `vega buckets card (FXO)` ❌). Doku-Aussage zu weit. | Entweder FX-Vol-Buckets je Expiry aus `ctx.fxVols` ergänzen oder Doku präzisieren („Zinsoptionen“). |
| N-26 | Niedrig (Code) | `CompareView.tsx`, `PricingWorkspace.tsx`, `Inspector.tsx` (`s.risk()` im Render), `DocumentsModal.tsx` (`setError` in `useMemo`) | React-Warnung „Cannot update a component (App) while rendering CompareView“: `risk()` schreibt `riskCache` während des Renders. Noch kein sichtbarer Fehler, aber Concurrent-Mode-Risiko (verworfene Renders). | Risiko in `useEffect`/`useMemo` ohne Store-Write berechnen oder Cache außerhalb des Zustand-Stores (Modul-`Map`) halten. |

---

## 4. User Journeys (Schritt für Schritt)

### (a) Berater bewertet IRS/Collar für Kunden → Termsheet
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `Ctrl+K` · `collar 7y 3,5/1,5 6m @Kunde GmbH` · `↵` | 0,2 s bis PV; Toast „Angelegt: COL-0002 · PV 48.973 EUR“; Editor mit Kontrahent | Kontrahent „Kunde“ statt „Kunde GmbH“ (N-15) |
| Strike 3,25 tippen, `↵` | Live-PV, Warnungen deutsch, `Esc`/`↵` verlassen das Feld | Bezeichnung bleibt „Collar … 3,50 %“ (statisch) – akzeptabel |
| `]`/`+` What-if | Chip orange, PV live, `0` zurück | – |
| `Shift+P` | Par/ATM übernommen, Toast mit „Rückgängig“ | – |
| `Ctrl+Shift+C` | „Collar EUR 7Y … · PV 72.977 EUR · DV01 1.618 EUR · Kontrahent Kunde · Stichtag 03.09.2026“ | – |
| `Shift+K` Kundenmodus | Chip KUNDENANSICHT, DV01/Kontrahent/Margen/CVA-Werte ausgeblendet, Indikationstext ohne DV01 | Label „= risikofrei − CVA + DVA“ und „(inkl. CVA/DVA)“ bleiben sichtbar (kosmetisch) |
| Termsheet | `g r` → `Ctrl+Shift+R` → „Termsheet“ → Modal (Dialog, Fokusfalle) → Markdown/Drucken | Drei Schritte, kein Hotkey/Palette (N-22); Druck: leere Seite + dunkler Titel (N-16); „1.216 %“ (N-07); kein anfänglicher Marktwert (N-22) |

### (b) Treasurer: Portfolio-Import → Szenarien → Report
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `⤒ Import` JSON | Validierung + Bewertung, Toast mit Zusammenfassung und „Rückgängig“ | Alle 15 als `-IMP` umbenannt (N-24) |
| Stichtag | `Shift+T` → „Monatsende“ oder Palette `stichtag 30.09.2026` | – |
| Kurven prüfen | Quotes bleiben über Stichtagswechsel erhalten, Chip „modifiziert“ | Interpolation verloren (N-23) |
| `g s` | Standard-/IRRBB-/eigene Szenarien, Tabelle, klickbare Heatmap, P&L je Trade | – |
| Export | `Ctrl+Shift+E` Blotter-CSV (BOM, Semikolon, Komma), EMIR-CSV, Report-JSON je Trade | Kein Portfolio-Report (F-29) |
| Reload | Bestand, Stichtag, View, Quotes wiederhergestellt; Restore-Toast | Sortierung weg (N-24) |

### (c) Prüfer: Kurven → Residuen → Report-Hash
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g c` | Pillar-Datum, Residuum je Quote (bp bzw. ·10⁻⁶), Interpolationswahl, Vergleich gleiche Ccy | Quotes-Karte bei 1600 px + Inspector beschnitten (N-10) |
| Quote ändern | Orange, Tooltip „Original 2,0100 %“, Chip + Statusleiste „modifiziert“ | – |
| `g r` → `Ctrl+Shift+R` | Engine, Snapshot-ID (ändert sich mit Quotes), Report-/Inputs-Hash, stabiler Zeitstempel | Kein „Eingaben geändert“ nach Quote-Bump, Kopf ohne „modifiziert“ (N-18) |
| Transaktionspreis eintragen, neu erzeugen | Marge/anfänglicher Marktwert aktualisiert, „Eingaben geändert“-Badge | **Hash unverändert** (N-19) |
| What-if aktiv | Badge, JSON-Label, Export-Bestätigung | – |
| Drucken | A4, Kopfzeile mit Hash/Snapshot, Inputs als Text, helle Tabellen | Methodenstrings englisch (N-07) |

### (d) Hedge Accounting: Designation → Effektivität
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g h` auf IRS-0001 | Defaults (Cash Flow Hedge, EURIBOR-6M-Kredit, Laufzeiten) | Designationsdatum = heute (N-20) |
| „Effektivität testen“ | ✓ effektiv, Critical Terms 5/5, Dollar-Offset 101,6 %, Regression Steigung 1,0157 / R² 1,0, IFRS-9/HGB-Tabellen | Kumulativ „nicht beurteilbar“ wegen Default-Datum |
| Methode/Rechnungslegung wechseln | HGB § 254-Texte, Regression | Ergebnis nach Eingabeänderung ohne Veraltet-Flag (N-20) |
| Swaption als Instrument | „✗ nicht effektiv“ mit Begründung | – |
| Trade wechseln und zurück / Reload | Dokumentation erhalten | Kein Druck/Export (N-20) |

---

## 5. Hotkey-Matrix DE-Layout (verifiziert)

| Aktion | Physisch (Win-DE) | Physisch (Mac-DE) | Alias | Ergebnis |
|---|---|---|---|---|
| What-if +10 bp | AltGr+9 (`]`) | ⌥6 (`]`) | `+` | ✅ ✅ ✅ |
| What-if −10 bp | AltGr+8 (`[`) | ⌥5 (`[`) | `-` | ✅ ✅ ✅ (kein Sprung in View 8/5) |
| Reset | AltGr+ß (`\`) | ⌥⇧7 (`\`) | `0` | ✅ ✅ ✅ (kein Sprung in View 7) |
| Hilfe | ⇧ß (`?`) | ⇧ß | – | ✅ |
| Palette | ⇧7 (`/`), Ctrl+K | ⇧7, ⌘K | – | ✅ |
| Ansicht 1…8 | Alt+1…8 | ⌥1 (`¡`), ⌥8 (`{`) | `g b`… | ✅ per `e.code` |
| In Textfeld: `+` | – | – | – | ✅ kein Bump |
| Ctrl+`]` | – | – | – | ✅ kein Bump |

---

## 6. Was für 100 noch fehlt

1. **N-01** FX-Options-/Forward-Analytics vollständig mappen (Delta je +1 % Spot als Geldbetrag, Spot-Datum als Datum, Rohschlüssel eliminieren, Strike in Cashflow-Tabelle ohne „%“) – ~1 h.
2. **N-02** `Enter`-„öffnen“ nur auf Blotter-Zeilen – ~15 min.
3. **N-03** Fokus-Rückgabe nach `inert`-Dialogen im echten Browser (Timeout/RAF) + E2E-Check – ~30 min.
4. **N-19 + N-18** Report-Hash über Kostentransparenz; Quote-Änderung → „Eingaben geändert“ + „modifiziert“ im Kopf/JSON – ~1 h.
5. **N-16** Druck-CSS für Dokumente (weißer Kopf, keine Leerseite) – ~30 min.
6. **N-15** `@Kontrahent`-Tokenizer für mehrteilige Namen („GmbH“, „Bank“, „Hessen“) – ~30 min.
7. **N-17** Kostentransparenz-Eingaben je Trade im Store persistieren – ~30 min.
8. **N-20** Hedge: Designationsdatum = Startdatum, Veraltet-Flag, Dokumentation drucken/exportieren – ~1,5 h.
9. **N-21** Fehler-Level-Validierung blockiert Bewertung/Export – ~45 min.
10. **N-04…N-06, N-13** `keyTokens("+")`, ↑-Rotation, `aria-activedescendant`, Skip-Link, Heatmap-ARIA – ~1,5 h.
11. **N-07** Restliche englische Strings/Dezimalpunkte (Methoden, Leg-Badges, Builder-Namen, Termsheet-Prämie, Hedge-Summary) – ~1 h.
12. **N-08, N-09, N-10, N-11, N-12** Light-Kontraste der aktiven Segmente, Toast-Limit, Kurven-Grid, Key-Rate-Kurvenwahl, Annuität-Label – ~1,5 h.
13. **N-14, N-22, N-23, N-24, F-39** Undo für Quotes, Termsheet-Hotkey/Palette + anfänglicher Marktwert, Interpolation im Store, Import-Strategie/Sortier-Persistenz, Tenor-fähiges Datumsfeld – ~4 h.
14. Portfolio-Report (Summen, je Kontrahent, Warnungen, Hash) als JSON/Druck – ~3 h.

Erwartete Wirkung bei Umsetzung 1–14: UI/UX & Hotkeys ≈ 97–99, User Flows ≈ 96–98.

---

## 7. Artefakte

Basis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r2-ui/`

- Skript/Messwerte: `run.mjs`, `results.json` (172 Checks, Kontrastmessungen `contrast_*`, Heatmap `heat_*`, Grammatik-Proben `grammar`), `run.log`, `aria-blotter.yml`, `aria-pricing.yml`, `blotter.csv`, `portfolio.json`, `report.json`, `report-print.pdf`, `termsheet-print.pdf`
- Dark 1600: `1600-dark-blotter.png`, `-help.png`, `-chord.png`, `-toasts.png`, `-focus-rail.png`, `-focus-row.png`, `-palette-empty.png`, `-palette-quick.png`, `-palette-nohit.png`, `-pricing-collar.png`, `-editor-warn.png`, `-editor-dateerr.png`, `-editor-fxf-sameccy.png`, `-editor-fxo.png`, `-editor-basis.png`, `-editor-swpt.png`, `-editor-fxs.png`, `-pricing-parrisk.png`, `-pricing-whatif-neg.png`, `-curves.png`, `-curves-usd.png`, `-valdate.png`, `-blotter-emptyfilter.png`, `-contextmenu.png`, `-blotter-warnpopover.png`, `-blotter-imported.png`, `-blotter-deletetoast.png`, `-blotter-final.png`, `-after-reload.png`, `-scenarios.png`, `-scenarios-active.png`, `-market.png`, `-market-edited.png`, `-compare.png`, `-compare-empty.png`, `-hedge.png`, `-hedge-hgb.png`, `-hedge-swpt.png`, `-report-pregen.png`, `-report.png`, `-report-whatif.png`, `-report-cap.png`, `-termsheet.png`, `-termsheet-collar.png`, `-suitability.png`, `-customer-blotter.png`, `-customer-pricing.png`, `-customer-report.png`, `-empty-*.png` (blotter, pricing, report, scenarios, compare, hedge, curves, market)
- Print: `1600-report-print.png`, `1600-termsheet-print.png`
- Light 1600: `1600-light-blotter.png`, `-palette.png`, `-pricing.png`, `-curves.png`, `-scenarios.png`, `-market.png`, `-report.png`, `-compare.png`, `-hedge.png`, `-help.png`, `-customer.png`
- Responsiv: `1280-dark-*.png` (8 Views, Palette, Hilfe), `1920-dark-blotter/pricing/report/curves/hedge.png`
