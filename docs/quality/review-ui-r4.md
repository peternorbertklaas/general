# DERIVA – Review Runde 4: UI/UX & Hotkeys (Dim. 3) und User Flows (Dim. 4)

**Reviewer-Rolle:** Senior UX-Designer · Accessibility-Auditor · Trading-Desk-Power-User
**Datum:** 2026-09-04 · **Modus:** Re-Review only, keine Quellcode-Änderungen · **Baseline:** `review-ui-r3.md` (Runde 3: UI 91, Flows 94)

## 0. Prüfstand

| | |
|---|---|
| Repo-Stand | Branch `claude/derivatives-trading-platform-1arsyu`, HEAD `a3daa92` („Runde 4 – Quant-/Architektur-/UI-Befunde der dritten Bewertung behoben“); `apps/web` unverändert (Working Tree zum Zeitpunkt der Prüfung sauber, spätere Änderungen anderer Reviewer betreffen nur `apps/api`/`packages/pricing-core`). Web-Diff seit R3: 42 Dateien, +3.033/−547 (u. a. `keymap.ts` Chords + Sperrliste, `Popover.ts`, `FieldLabel.ts`, `DocumentsModal` What-if/Langtext, `MarketView` Vol-Flächen, `CurvesView` FX-Punkte/ToY-Validierung, `Blotter` Filter-Popover/CSV-Fehlerdialog, `store.ts` Markt-/Vol-/Hedge-Undo) |
| Bundle | `vite build` frisch (`index-CUrPQUno.js`, Chunks `react`/`core`/`echarts`), `vite preview --port 4702 --strictPort` |
| Unit-Tests | `npx vitest run` in `apps/web`: **20 Dateien, 212 Tests grün** (u. a. neue R3-Regressionstests für Popover-Layer, Kontextmenü-Fokus, Palette-ID-Exaktheit, What-if-Dokumente, ToY-Validierung, Vol-Flächen) |
| Browser-Audit | Playwright + Chromium (`/opt/pw-browsers/chromium`), Locale `de-DE`, Clipboard-Rechte, Viewports 1600×1000 / 1280×800 / 1920×1080, Dark + Light, Print-Emulation + `page.pdf()`, Offline-Modus (`context.setOffline`). Skripte `…/scratchpad/r4-ui/run.mjs` (**165 Checks**, 15 Abschnitte), `verify.mjs` (33), `verify2.mjs` (10), `probe-caplet.mjs`, `probe-misc.mjs`, `probe-final.mjs`; Messwerte `results.json`/`results2.json`/`results3.json`, 70 Screenshots, 6 PDFs, 24 Downloads. 12 zunächst rote Checks waren Sonden-Artefakte (Fokus-Startpunkt nach `blur()`, Selektoren mit Button-Text, „Modified Following“ in der Englisch-Liste, Print-Breite gegen Viewport statt PDF) und wurden gezielt widerlegt; nur die verbliebenen Befunde stehen unten |
| Konsole | **Keine** JS-Fehler, keine Warnungen, keine fehlgeschlagenen Requests (außer dem absichtlichen Offline-Reload) |
| Tastatur | Chords `o t/g/k/c/p/r`, `x c/b`, `y i`, `g …`, `n …`; alte `Ctrl+Shift+T/K` (dürfen nichts mehr tun); synthetische DE-Layout-Events (Win AltGr `]`=Digit9, `\`=Minus; Mac Option `]`=Digit6, `[`=Digit5, `¡`=Digit1, `{`=Digit8; `?`=Shift+Minus); `Ctrl+E`, `Alt+1…8`, Tab-Sequenzen ab Skip-Link je View |

Screenshot-Verzeichnis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r4-ui/` (Übersicht Abschnitt 8).

---

## 1. Scores

### 1.1 UI/UX & Hotkeys: **95 / 100** (R1 62 → R2 88 → R3 91)

**Verifiziert behoben (alle 13 Befunde aus R3, Belege in Abschnitt 2):** Dokument-/Report-/Export-Hotkeys als Chords `o t` (Termsheet in 445 ms aus dem Pricing), `o g`, `o k`, `o c`, `o p`, `o r`, `x c`/`x b`, `y i`; `Ctrl+Shift+T/K` ohne Wirkung; Sperrliste `BROWSER_RESERVED_COMBOS` mit Unit-Test; Hilfe/Palette/Statusleiste zeigen „O dann T“ ohne `Ctrl+⇧`-Kombinationen. Popover (Export ▾, Spalten, Filter ▾, Datums-Vorlagen, Bewertungshinweise) als Dialogebenen: `Esc` schließt aus jedem Fokus, `t` wechselt kein Theme, Klick außerhalb schließt, Fokus wandert in das Panel (Roving-Fokus ↑/↓/Home/End im Export-Menü) und kehrt zum Auslöser zurück. **0 unbenannte Steuerelemente in allen 11 Vorlagen-Editoren, allen 8 Views, 4 Dokument-Modalen, Palette und Hilfe** (Audit: Inputs, Checkboxen, Buttons, Bilder, Dialoge, Composite-Rollen, doppelte IDs, positive Tabindizes). Hedge-Druck mit Werten (Hedge Ratio „50“, Nominal, Designationsdatum als Text ohne Rahmen, Kopf „ERGEBNIS VERALTET“, 3 Seiten). KID-Langtext (Zielmarkt, SRI-Herleitung, Ausstiegskosten) umbrechend als `td.text` (Bildschirm 918 px in 958 px, PDF 3 Seiten). Methodik ohne Bezeichner (`fairValue`/`marginBp`/`deltaAmount`/`MISSING_FIXING`/`logLinear` in Report, Termsheet, KID, Confirmation, Erklärung und deren Markdown nicht mehr vorhanden; Marktdaten-Tabelle „log-linear (DF)“). **Alle 160 gemessenen Textpaare ≥ 4,5:1** in Dark und Light – inkl. Zahlen in markierter Zeile, historischen Szenario-Zeilen, aktiven Chips, Filter-Popover, What-if-Banner, CSV-Fehlerdialog. Kontextmenü gibt den Fokus an die Zeile zurück, Live-Region vor dem ersten Toast. `Esc` stellt in Zahlen- und Datumsfeld den Wert bei Fokusnahme wieder her (PV zurück), Kuponverlauf „Basis + 2 Stufen“, hängendes `step` als Fehler, `stichtag 31.02.2026` nicht angeboten, `r` bewertet neu („Portfolio neu bewertet“). Quick-Entry-Namen „Verkauf EUR/USD 15.03.2027“, UTI-Prüfung mit Großschreibung, Chip „ohne/ungültige UTI“, EMIR-Toast „1 mit ungültiger UTI“. Quotes-Karte bei 1600 px mit Inspector 566/566 px, Blotter-Toolbar 1280 einzeilig (28 px) mit „Filter ▾ 1“, Report 1280 ohne Überlauf, Druck ohne Hover-Zeile.

**Abzüge (kumuliert ≈ −5,2):**
- Mittel −1,5: **Caplet-Vol-Fläche zeigt keine Werte** – jedes Zahlenfeld ist 167 px breit in einer 62-px-Spalte, der rechtsbündige Wert liegt hinter der Nachbarzelle; die Tabelle wirkt leer, Bearbeiten erfolgt blind (R4-01).
- Mittel −1: **`y i` auf einer fokussierten Blotter-Zeile kopiert die Zeile und schaltet den Inspector aus** – die Tabellen-Navigation verbraucht `y`, `i` feuert als Einzeltaste (R4-02).
- Niedrig −0,5: alle Tabellenzeilen `tabIndex=0` – im Pricing 42 Zeilen-Tabstopps nach dem Termsheet-Button, Blotter 41 Tabs bis zur ersten Zeile; kein Roving-Tabindex (R4-03).
- Niedrig −0,4: `⌥↓`/▾ öffnet die Datums-Vorlagen und **übernimmt dabei den getippten Text** (Blur-Commit) – „zweites Esc verwirft“ aus der Doku stimmt nicht (R4-04).
- Niedrig −0,3: Hedge-View bei ungültigem Trade mit englischer Kernmeldung „Invalid trade HYPO-…: terminationDate must be after effectiveDate“ (R4-05).
- Niedrig −0,3: Schnelleingabe akzeptiert nur ISO-Daten (`15.03.2027` → „Format: … 2027-03-15“), obwohl Namen, Datumsfelder und Palette-Befehl `stichtag` deutsch sind (R4-06).
- Kosmetisch −0,3: Report-Kopf „What-if +10bp … · **What-if What-if** +10bp …“ doppelt (R4-07).
- Kosmetisch −0,3: Hedge-Druck: Selects auf 163 px beschnitten („Variabel verzinster Kre“, „endfällig (kein Tilgung“), Einheit „%“ vom Wert getrennt (R4-08, R3-04-Rest).
- Kosmetisch −0,2: gespeicherter Turn-of-Year nach Stichtagswechsel als roter Validierungsfehler statt „inaktiv“-Badge (toter Code-Pfad), Label „Turn-of-Year“ dreizeilig (R4-09, R3-F2-Rest).
- Kosmetisch −0,4: Sprach-/Struktur-Reste: „Float EURIBOR-6M“ in der Cashflow-Tabelle, „Vega swaption EUR“, Kundentermsheet-Zeile „Fair Value bilateral (inkl. CVA/DVA)“ (Report blendet CVA/DVA im Kundenmodus aus), Überschriften h1→h3 ohne h2, Key-Value-Tabellen ohne `th`/`aria-label` (Report 2, Hedge 3, Markt 1) (R4-10).

### 1.2 User Flows: **98 / 100** (R1 57 → R2 82 → R3 94)

- (a) **Indikation im Kundengespräch: sehr gut, vollständig per Tastatur** – `Ctrl+K` → `collar 7y 3,5/1,5 6m @Kunde GmbH` → `↵` in **171 ms** bis PV; `Shift+P` → PV 48.973 → 0; `y i` liefert „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · … · Kontrahent Kunde GmbH · Stichtag 03.09.2026“; `o t` → Termsheet in **413 ms** mit „Anfänglicher Marktwert (Kundensicht)“, Tab-Reihenfolge im Modal Markdown → Drucken → Schließen (Fokusfalle ✓); `o k` → KID, Haltedauer per `↑` live (7,0 → 7,51); unter `]` tragen **alle vier Dokumente** Banner „⚠ Stress-Markt: WHAT-IF Zinsen +10 bp – kein Kundendokument, nicht prüfungsfähig“, Untertitel-Marker, Rückfrage vor Markdown **und** Druck, Dateiname `-whatif`, Markdown-Marker, Banner druckt rot auf hellrot (R3-F1 ✓); Kundentermsheet ohne Margenformel („Anfänglicher Marktwert aus Kundensicht = …“, R3-F8 ✓). Reibung: `y i` mit Fokus auf der Blotter-Zeile (R4-02, Dim. 3); Kundentermsheet nennt „inkl. CVA/DVA“ (R4-10, Dim. 3).
- (b) **Treasurer: Import → Szenarien → Portfolio-Report: sehr gut** – CSV mit 4 Datenzeilen: Dialog „CSV-Import: 3 Zeilen übersprungen“ listet **Zeile · Meldung** (3 „Nominal fehlt oder ≤ 0“, 4 „Kauf-/Verkaufswährung fehlt“, 5 „Unbekannter Typ „XYZ“ (erlaubt: IRS, FXF, CAP, SWPT, FXO, CCS, FRA)“), „⤓ Fehlerliste als CSV“ (`Zeile;Meldung`), „1 gültige Zeile importieren“ → Toast mit Rückgängig (R3-F7 ✓); CSV ohne Typ-Spalte und kaputtes JSON → Toast, kein Absturz; Export-Menü komplett per Tastatur (Enter → Roving → Markdown-Download); Gruppierung mit `j/k`; historische Stress-Tage per `Space`; Heatmap `↵` setzt What-if; `o p` unter What-if fragt nach („… nicht prüfungsfähig. Trotzdem exportieren?“) und suffixt `-whatif`, bei leerem Bestand „Kein Trade im Bestand – kein Portfolio-Report“ (R3-F6 ✓); Portfolio-Markdown ohne ISO-Daten (R3-11 ✓). **200 importierte Trades (213 gesamt): Import 288 ms, Neubewertung 21 ms, `]`-Bump 175 ms, Sortierung 108 ms, Gruppierung 74 ms, Palette 127 ms (68 Treffer), Szenarien-View 1,3 s, Portfolio-Report 532 ms, Reload 593 ms, localStorage 118 KB, Heap 37 MB**, Blotter in eigenem Scroll-Container (740 px), `Ctrl+Z` „Import (200)“. Reibung: Fehlermeldung des JSON-Imports mit roher Engine-Meldung „Expected property name or '}' in JSON at position 1“ (−0,3, R4-F1).
- (c) **Prüfer: Kurven → Residuen → Report-Hash: sehr gut** – Quote-Edit per `↑↑↵` → „Quotes modifiziert“, `Ctrl+Z` stellt zurück; **Interpolation und Turn-of-Year im Undo** („Rückgängig: Interpolation EUR-ESTR log-linear (DF) → monoton-konvex (Hagan–West)“, „Rückgängig: Turn-of-Year EUR-ESTR 31.12.2026 +20 bp“, R3-F3 ✓); ToY vor dem Stichtag: „Anwenden“ deaktiviert, `aria-invalid`, Meldung „Turn-of-Year muss nach dem Bewertungstag (03.09.2026) liegen“ (R3-F2 ✓); „+ FX-Punkte EUR/USD“ legt „FX-Pkt 1M EURUSD“ an Pillar-Position 3 an, ✕ entfernt, Undo „Quote FX-Pkt 1M EURUSD entfernt“; Palette „FRA-0002“ (nicht vorhanden) → „Kein Trade FRA-0002 im Bestand – Trade anlegen mit n s … oder per Schnelleingabe“, `↵` öffnet nichts anderes (R3-F5 ✓); Governance „MaRisk AT 4.3.5, IFRS 13 / IDW RS HFA 47“, Perspektive per Tastatur, Report-Hash ändert sich mit dem Transaktionspreis; Vol-Zelle 1Y×5Y 62 → 120 bp ändert SWPT-0001-PV und setzt den Report auf „geändert“; inverse CDS-Quotes → deutsche Warnung „Hazard-Rate am Pillar 1Y … auf 0 begrenzt“. Reibung: Report-Kopf doppelt (R4-07, Dim. 3).
- (d) **Hedge Accounting: sehr gut** – `Effektivität testen` per `↵`, Hedge Ratio per `↓` → Veraltet-Badge; Markdown-Export **mit** Vermerk „ERGEBNIS VERALTET“ + Toast „… mit Vermerk »Ergebnis veraltet«“ (R3-F4 ✓); „Zurücksetzen“ fragt („Gespeicherte Sicherungsdokumentation für IRS-0001 verwerfen? …“), Abbrechen behält 50 %, Bestätigen → Toast „Sicherungsdokumentation IRS-0001 verworfen · Rückgängig“, Undo stellt 50 % wieder her (R3-F4 ✓); CAP Innerer Wert + eingefrorene Vol ✓; Druck mit Zahlen (R3-04 ✓). Reibung: englische Kernmeldung bei ungültigem Trade (R4-05, Dim. 3); Toast-Button „Rückgängig“ ist der 70. von 72 Tabstopps – nur per `Ctrl+Z` praktikabel (−0,2, R4-F2).
- Fehlerpfade / Robustheit: korrupter `localStorage` → Beispielportfolio ohne Fehler; **Trade mit Ende < Start** (per Storage eingeschleust) → Blotter „Fehler“, KPI „1 nicht bewertet“, Editor „Enddatum muss nach dem Startdatum liegen“, PV „–“, `o t` → „Dokument nicht möglich – der Trade ist nicht bewertbar“, Report/Hedge/Szenarien/Vergleich ohne Error-Boundary, Korrektur des Datums bewertet sofort neu. **Offline-Reload** (`setOffline`) endet auf der Browser-Fehlerseite – kein Service Worker/App-Shell-Cache, obwohl US-8.13 „App offline (ohne API) nutzen ✅“ verspricht; der Bestand überlebt die Offline-Episode (26 Trades, Interpolation) (−0,5, R4-F3).
- Übergreifend ✓: Hotkeys ohne Trade (`o t`, `Shift+P`, `y i`, `o p`) melden „Kein Trade ausgewählt“/„Kein Trade im Bestand“; Leerzustände aller Views; Persistenz von Vol-Flächen (Reload: „geändert“-Badge, Wert 120,0), Markt-Reset setzt Quotes, Interpolation, ToY **und** Vols zurück.

---

## 2. Status der Runde-3-Befunde

Legende: ✅ behoben · 🔶 teilweise · ❌ offen. Belege = Check-Name in `results.json` (`run.mjs`) / `results2.json` (`verify.mjs`) / `results3.json` (`verify2.mjs`) oder Screenshot.

| # | Titel (R3) | Status | Beleg / Rest |
|---|---|---|---|
| R3-01 | `Ctrl+Shift+T/K/C` browserreserviert | ✅ | `keymap.ts:38-68` `BROWSER_RESERVED_COMBOS` (26 Kombinationen, Unit-Test), `:119-127` Chords `o r/t/g/k/c/p`, `x c/b`, `y i`; `Ctrl+Shift+T no longer opens termsheet`, `Ctrl+Shift+K no longer opens KID`, `o t opens Termsheet :: 445 ms`, `o k/o c/o g`, `o r generates report`, `o p downloads portfolio report`, `x b`/`x c`/`Ctrl+E` Downloads; Hilfe-Zeilen mit `kbd` „O“ „T“ (`helpRows`), keine `Ctrl+⇧+Buchstabe`; Palette-Einträge mit Chord; Chord-Indikator „o … (zweite Taste)“; `typing 'ot' in a text field does not open a document`; Doku `03-ui-konzept-und-hotkeys.md:58` Browser-Regel |
| R3-02 | Popover ohne Dialog-Mechanismus | ✅ | `Popover.ts` `usePopover` (`popoverDepth`, Capture-`Esc`, Klick außerhalb, Fokus in Panel/zurück), `menuKeyNav`; Checks `export menu: 't' suspended`, `Esc with focus on toggle closes`, `focus returns to toggle`, `click outside closes`, Roving `⤓ Blotter als CSV → Portfolio als JSON → EMIR … → End → Home` (`exportSeq`), `cols popover`, `valuation popover: layer semantics`, `date presets: hotkeys suspended, Esc closes, focus returns to input`, `filter popover: layer semantics + active count badge` (1280) |
| R3-03 | `<select>` ohne zugänglichen Namen | ✅ | `FieldLabel.ts` Context + `useFieldLabel` in `Select`/`NumInput`/`OptNumInput`/`DateInput`; `all 11 editors: 0 unnamed inputs/buttons` (IRS, CAP, SWPT, FXF, FXO, BASIS, AMORT, IMM, FXS, CCS, FRA), `IRS editor (amort+cleared+coupon steps) a11y clean`, `all views: a11y clean`, Dokumente/Palette/Hilfe clean; `TradeEditor.a11y.test.tsx` |
| R3-04 | Hedge-Druck ohne Zahlenfelder | ✅ | `app.css:1441-1466` Inputs als Text (`border:none`, `#111`, `appearance:none`); `hedgePrint.ratio {visible, value 50, border none, color #111}`, `desig 17.06.2024`, Nominal 10.000.000 sichtbar (`1600-hedge-print.png`), Kopf „ERGEBNIS VERALTET“, 3 Seiten. **Rest → R4-08:** Selects 163 px beschnitten, Einheit getrennt |
| R3-05 | KID-Langtext nicht umbrechend | ✅ | `DocumentsModal.tsx` `isLongText` → `td.text`, `app.css` `.doc-rows{table-layout:fixed}`; KID 5 Textzellen, Termsheet 1, Confirmation 2, Erklärung 5; Bildschirm `docW 918 ≤ modalW 958`, 0 beschnittene Zellen (auch 1280); PDFs 3/3/4/3 Seiten (`1600-print-doc-kid.png`: Zielmarkt/Herleitung/Ausstiegskosten mehrzeilig) |
| R3-06 | Methodik mit Rohschlüsseln/Englisch | ✅ | `i18n.ts` `IDENTIFIERS`, `INTERPOLATION_DE`, `CONVENTION_DE`, camelCase-Fallback; `report methodology: no identifiers / English`, `market table shows German interpolation label`, alle vier Dokumente + Markdown ohne `fairValue|marginBp|deltaAmount|MISSING_FIXING|logLinear`; `signRule` deutsch. „Modified Following“ als Fachbegriff akzeptiert. **Rest → R4-10:** „Float EURIBOR-6M“ in Cashflow-Tabelle, „Vega swaption EUR“ |
| R3-07 | Kontraste markierte Zeile / hist / Chip | ✅ | `tokens.css` `--pos-strong/--neg-strong`, `.chip.active{color:var(--seg-active-fg)}`; `all sampled text pairs ≥ 4.5:1 (R3-07)` über 28 Sweeps Dark+Light (`allLow = []`), Heatmaps min. 8,11 (Light Szenarien), 14,4/16,19 (Vol-Cube) |
| R3-08 | Kontextmenü-Fokus → body, Live-Region spät | ✅ | `ContextMenu.tsx` Opener per `data-id`; `context menu returns focus to the row :: after=TR.@row`; `App.tsx` Toast-Stack immer gemountet: `live region mounted before first toast :: role status, toasts 0` |
| R3-09 | Quotes-Karte 1600 beschnitten, Report 1280, Toolbar 1280 | ✅ | `quotes1600insp {tableW 566, containerW 566, inspector true}` (`v3-curves-inspector.png`), 1280 `878/878`; `1280: report no horizontal overflow :: scroll 0`; `toolbar1280 {h 28, compact, filterBtn}` einzeilig mit „⚲ Filter ▾ 1“ (`1280-dark-blotter-filter.png`); 16 Layout-Checks 1280/1920 ohne Überlauf |
| R3-10 | `Esc` übernimmt, Kuponverlauf Stufe 1, `step` stumm | ✅ | `Esc in number field restores value + PV`, `Esc in date field restores value`; Kuponverlauf „2,500 % (Basis) bis 07.09.2027“ + 2 Stufen (`1600-dark-editor-step.png`); `dangling 'step' → error :: step ohne Stufen – Format: step 2,5/3,0/3,5`. **Rest → R4-04:** `⌥↓` committet |
| R3-11 | Schnelleingabe-Namen mit ISO-Datum | ✅ | `dateLabel()`; „Verkauf EUR/USD 15.03.2027“, „EUR-Put/USD-Call 15.06.2027“, Portfolio-Markdown ohne ISO. **Rest → R4-06:** Eingabe akzeptiert kein `15.03.2027` |
| R3-12 | UTI ohne Formatprüfung | ✅ | `validate-trade.ts` `UTI_RE`; „abc!“ → „UTI: 1–52 Zeichen A–Z / 0–9 ohne Leer- und Sonderzeichen (ISO 23897, i. d. R. LEI-Präfix)“, Wert „ABC!“, Chip „ohne/ungültige UTI (11)“, EMIR-Toast „1 mit ungültiger UTI“ |
| R3-13 | Druck-Hover, `stichtag 31.02.`, `r`/`t`/`s` | ✅ | `hoverBg rgba(0,0,0,0)` im Druck; `stichtag 31.02.2026 not offered as command`; `r` → „Portfolio neu bewertet“. `s` weiter unbelegt, `t` Einzeltaste (kein Abzug) |
| R3-F1 | Dokumente unter What-if ohne Kennzeichnung | ✅ | `DocumentsModal.tsx` `whatIfDocMarker`, `doc-whatif-banner` (`role=alert`), `confirmWhatIf` vor Markdown/Druck; alle vier Dokumente: Banner, Untertitel „WHAT-IF Zinsen +10 bp – Stress-Markt, kein Kundendokument, nicht prüfungsfähig“, Rückfrage bei Markdown **und** Drucken, Datei `IRS-0001-termsheet-whatif.md` mit Marker, Druck-Banner `#7f1d1d` auf `#fff5f5` |
| R3-F2 | Turn-of-Year in der Vergangenheit stiller No-op | ✅ | `store.ts setTurnOfYear` verweigert `date ≤ valuationDate`; `ToY in the past: Anwenden disabled + validation :: {applyEnabled false, msg „Turn-of-Year muss nach dem Bewertungstag (03.09.2026) liegen“, aria-invalid true}`; Chip „1 Turn-of-Year (1 inaktiv)“ nach Stichtagswechsel. **Rest → R4-09:** Badge „inaktiv“ nie sichtbar, kein Toast |
| R3-F3 | Interpolation/ToY nicht im Undo | ✅ | `UndoEntry kind:"market"`; `Ctrl+Z undoes interpolation with typed label`, `Ctrl+Z undoes Turn-of-Year`; zusätzlich `kind:"vols"` (Swaption-Vol EUR 4W×1Y 72,0 → 99,0 bp) und `kind:"hedge"` |
| R3-F4 | Hedge „Zurücksetzen“ ohne Rückfrage/Undo, Markdown ohne Veraltet | ✅ | `HedgeView.tsx resetDoc` mit `confirm` + Toast „Rückgängig“; `hedge reset asks; cancel keeps ratio 50`, `hedge reset → toast with Rückgängig, ratio 100`, `undo restores hedge documentation (ratio 50)`; `hedge-doc.ts` `{stale}` → „ERGEBNIS VERALTET“ im Markdown + Toast |
| R3-F5 | Palette-Teilfolgen-Suche öffnet falschen Trade | ✅ | `CommandPalette.tsx` `ID_LIKE`, exakte ID-Treffer 1000; `FRA-0002 (absent): no fuzzy jump, hint shown`, `IRS-0001 exact match first` |
| R3-F6 | Portfolio-Report What-if ohne Rückfrage, leer „0 Trades“ | ✅ | `portfolio-export.ts` `whatIfExportQuestion` + Guard; `portfolio report under what-if asks confirmation`, Datei `-whatif`, leer → „Kein Trade im Bestand – kein Portfolio-Report“ |
| R3-F7 | CSV-Fehler nur als erste Zeile im Toast | ✅ | `Blotter.tsx CsvErrorsDialog`; `CSV import: error dialog lists all 3 rejected rows with reason`, `error list downloadable as CSV`, `continue imports the 1 valid row` (`1600-dark-csv-errors.png`) |
| R3-F8 | Kundentermsheet erklärt Bankmarge | ✅ | `customerCostRule`, Methodik auf Snapshot/Bewertungsrahmen/Kostenregel gekürzt; `customer termsheet: no bank-margin formula` (Marge der Bank 0 Treffer, „Kundensicht“ ✓). **Rest → R4-10:** Zeile „Fair Value bilateral (inkl. CVA/DVA)“ |
| Leftovers R3 (`r` ohne Wirkung, `t`, `s`, Skip-Link nur per ⇧Tab bei initial fokussierter Zeile) | | 🔶 | `r` ✅ („Portfolio neu bewertet“); `s` unbelegt, `t` Einzeltaste, initiale Zeilenfokussierung unverändert – kosmetisch, kein Abzug |

---

## 3. Neue Befunde (Runde 4)

Schweregrade wie in R1–R3. Reproduktion gegen das Preview-Bundle; Belege in `results*.json` (Check-Name) bzw. Screenshot.

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R4-01 | **Mittel** (Lesbarkeit) | `MarketView.tsx:262` `CapletVolCard` (`<span style={{width: 62}}>` + `NumInput inline` ohne `unit`), `app.css:1239` `.num-input.inline{width:auto}` (nur `.heat .cell .num-input.inline{width:100%}` in `:1919`) | Jede Caplet-Zelle rendert ein 167 px breites, rechtsbündiges Eingabefeld in einer 62/74 px breiten Spalte; der Wert steht hinter der nächsten Zelle (opaker Hintergrund) – **die gesamte Caplet-Fläche wirkt leer** (`probe-caplet-1600.png`, `1920-dark-market.png`; `inputs[0] {value 62, w 167, clientW 165}` vs `spanW 62, tdW 74`). Klick trifft zwar die eigene Zelle (`capletOverlap hitIsOwn`), die Eingabe „99“ erzeugt aber „9.960“, weil der Cursor hinter dem unsichtbaren Wert landet. FX-Karte ist korrekt (84 px, `.input-unit`-Wrapper). Neu in R4 eingeführtes Feature ist damit nicht bedienbar. | `td.vol-cell .num-input.inline{width:100%}` (analog `.heat .cell`), `span` entfernen oder `width` an das Input durchreichen (`NumInput width={62}`); E2E-Check in `smoke.mjs`: `input.clientWidth ≤ td.clientWidth`. |
| R4-02 | **Mittel** (Hotkeys) | `useTableNav.ts:77-79` (`y` kopiert Zeile, `preventDefault`), `keymap.ts:127` `copy.indication: "y i"`, `:142` `inspector: "i"`; `03-ui-konzept-und-hotkeys.md` „`y` auf einer Tabellenzeile kopiert die Zeile und startet keinen Chord“ | Im Blotter liegt der Fokus standardmäßig auf der markierten Zeile (`TR.selected`). `y i` kopiert dort die **Zeile** („Zeile kopiert“) und `i` schaltet anschließend den **Inspector aus** („Inspector ausgeblendet“, `yiRow {clip: "\tIRS-0001\tIRS…", inspBefore 1, inspAfter 0}`) – die Indikation landet nie in der Zwischenablage, obwohl Hilfe und Palette `y i` bewerben. `o t`/`x c` funktionieren von der Zeile aus (`otRow`, `xcRow`), nur der `y`-Chord kollidiert. | Zeilen-Kopie auf `Ctrl/⌘+C` (oder `y y`) legen und `y` als reinen Chord-Präfix behandeln; alternativ in `useTableNav` `y` nicht konsumieren, wenn eine Chord-Definition mit Präfix `y` existiert, und im Hotkey-Dispatcher `i` nach `y` verwerfen. E2E: `y i` mit Fokus auf `tr.selected` → Clipboard enthält „PV“. |
| R4-03 | Niedrig (A11y/Tastatur) | `useTableNav.ts:105` `navRowProps` → `tabIndex: 0` für **jede** Zeile (Blotter, Cashflows, Pillars, Szenarien, Key-Rate, P&L) | Tab-Sequenz ab Skip-Link: Blotter erste Zeile nach **41** Tabs, Pricing-Termsheet-Button 22 Tabs, danach **93 weitere Tabstopps im Pricing, davon 42 Tabellenzeilen** (`pricingTabStopsAfterTermsheet`); Szenarien 16 + 13 Zeilen-Stopps. WAI-ARIA-Grid-Muster erwartet einen Tabstopp je Tabelle mit Roving-Tabindex (Pfeiltasten existieren bereits). Toast-Stack am DOM-Ende (Button „Rückgängig“ = Tabstopp 70/72). | Roving: nur aktive Zeile `tabIndex=0`, übrige `-1` (Fokus per ↑/↓ wandert bereits); `useTableNav` merkt den letzten Index je Tabelle. Toast-Stack nach dem `<main>`-Anfang oder `F8`-Hotkey „zum letzten Toast“. |
| R4-04 | Niedrig (Eingabe) | `DateInput.tsx:49` `usePopover(open, …, {anchor, panel, restoreTo: ref})` (autoFocus → erste Chip erhält Fokus), `:108` `onBlur` → `commit(text)`; Doku `03-ui-konzept-und-hotkeys.md:103` „`Esc` schließt es, ein zweites `Esc` verwirft die Eingabe“ | `31.12.2041` tippen, `⌥↓` (oder ▾): das Popover öffnet, der Fokus wandert auf „Heute“, der **Blur committet den getippten Wert sofort** (`storeBefore 23543 → storeAfterOpen 26297`); nach `Esc`/`Esc` bleibt 31.12.2041 (`afterEsc2.text 31.12.2041`). Der dokumentierte Abbruchpfad existiert nicht; auch Undo-Eintrag entsteht unbemerkt. | Beim Öffnen der Vorlagen `cancelling`-artiges Flag setzen, das den Blur-Commit unterdrückt (Text bleibt Entwurf), oder `autoFocus:false` mit `aria-activedescendant`-Navigation im Feld; Doku anpassen. |
| R4-05 | Niedrig (Sprache) | `HedgeView.tsx:708` `warning error` mit `translatePricingError(e)`; `i18n.ts:223` übersetzt nur den Code `INVALID_TRADE` | Ungültiger Trade (Ende < Start) in der Hedge-View: „Ungültige Trade-Daten: **Invalid trade HYPO-HR-IRS-0001-PROBE: trade.legs[0]: terminationDate must be after effectiveDate; trade.legs[1]: …**“ neben der korrekten deutschen Zeile „Fehler: Ungültige Eingaben: Enddatum muss nach dem Startdatum liegen“ (`hedgeInvalidMsgs`, `v2-hedge-invalid.png`). Alle anderen Views (Blotter, Pricing, Report, Dokumente) sind deutsch. | `CORE_MESSAGES`-Regel für `Invalid trade <id>: trade.legs[n]: terminationDate must be after effectiveDate` → „Leg n: Enddatum muss nach dem Startdatum liegen“; Hedge-View bei `hasErrors(validateTrade(trade))` gar nicht erst testen, sondern nur die Validator-Meldungen zeigen. |
| R4-06 | Niedrig (Konsistenz) | `quick-parser.ts:63` `DATE = /^\d{4}-\d{2}-\d{2}$/` | `fxf eurusd -2m 1.1725 15.03.2027` → „⚠ Format: fxf eurusd 2m 1.1725 2027-03-15“, ebenso `fxo … 15.06.2027`, obwohl `stichtag 31.12.2026`, alle Datumsfelder und die (seit R4 deutschen) Trade-Namen `TT.MM.JJJJ` verwenden. Der deutsche Berater tippt das Lieferdatum so, wie es das Termsheet anzeigt, und bekommt eine Formatfehlermeldung. | `parseDateOrTenor` auf `parseDateInput` aus `date-parse.ts` stützen (akzeptiert `31.12.2027`, ISO, Tenor, `me`/`je`); Fehlertext „Datum als 15.03.2027 oder 2027-03-15“. |
| R4-07 | Kosmetisch | `ReportView.tsx:274` `{report.whatIf && ` · What-if ${report.whatIf.label}`}` – `report.market.label` (Kern) enthält den What-if-Zusatz bereits und `whatIf.label` beginnt selbst mit „What-if“ | Report-Kopf unter `]`: „Snapshot Sample EoD · What-if +10bp · FX +0% · Vol +0bp – keine prüfungsfähige Bewertung · **What-if What-if +10bp · FX +0% · Vol +0bp – keine prüfungsfähige Bewertung** · erstellt …“ (`reportHeader`, `v-report-whatif-header.png`). | Zusatz entfernen oder `whatIfLabel(s.whatIf)` („Zinsen +10 bp“) statt `report.whatIf.label` verwenden; Test „What-if“ genau einmal im Kopf. |
| R4-08 | Kosmetisch (Druck) | `app.css:1441-1456` (`@media print .field select` ohne `width:auto`), `HedgeView` Felder mit `.input-unit` | Hedge-Druck: Select „Art des Grundgeschäfts“ 163 px bei 188 px Textbedarf → „Variabel verzinster Kre“, „Tilgungsplan Grundgeschäft“ → „endfällig (kein Tilgung“ (`hedgePrintSel clipped true`, `1600-hedge-print.png`); Hedge Ratio „50“ links, Einheit „%“ 200 px rechts. | `.field select{width:auto!important; max-width:none}` im Druck oder `print-only`-Span mit Optionstext; `.input-unit input{width:auto}` bereits vorhanden → `flex:0 0 auto` für die Einheit direkt neben dem Wert. |
| R4-09 | Kosmetisch | `CurvesView.tsx:182,400` (`toyPast` deckt den gespeicherten Fall ab, `!toyPast && storedToyInactive` nie wahr bei `bp ≠ 0`), Toolbar-Label | Nach `stichtag 15.01.2027` mit gespeichertem ToY 31.12.2026: roter Fehler „Turn-of-Year muss nach dem Bewertungstag (15.01.2027) liegen“ (`role=alert`) statt Badge „inaktiv (vor dem Bewertungstag)“ (Badge-Count 0, `toyAfterDate`), kein Hinweis-Toast beim Stichtagswechsel; Label „Turn-of-Year“ bricht in drei Zeilen, Toolbar 75 px (`1600-dark-curves-toy-past.png`). | Badge zeigen, wenn Entwurf = gespeicherter Wert (`!toyDirty && storedToyInactive`), Fehler nur bei geändertem Entwurf; `setValuationDate` → Toast „Turn-of-Year EUR-ESTR liegt jetzt in der Vergangenheit (inaktiv)“; Label `white-space:nowrap`. |
| R4-10 | Kosmetisch | `PricingWorkspace` Cashflow-Tabelle (Leg-Spalte „Float EURIBOR-6M“), `metrics.ts` Vega-Label („Vega swaption EUR“), `DocumentsModal` Kundenfilter (`INTERNAL_ROW` ohne CVA/DVA), Überschriften h1→h3, Key-Value-Tabellen ohne `th`/`aria-label` (Report 2, Hedge 3, Markt 1) | `1600_words: "Float EURIBOR-6M\t15.06.2026…"` (6 Treffer), `1600_swpt: "Vega swaption EUR"`; Kundentermsheet zeigt „Fair Value bilateral (inkl. CVA/DVA) −280.538 EUR“, während der Kundenreport CVA/DVA ausblendet (`custTsBank`); `headingSkips 1` in jeder View (h1 „DERIVA“ → h3 Karten); Screenreader lesen Kostentabelle/Sensitivitäten/IFRS-9-Buchung als namenlose Tabellen. | Leg-Typ über `germanizeDocValue`/`i18n.ts:265` („Variabel“), „Vega Swaption EUR“; `INTERNAL_ROW` um `CVA|DVA|bilateral` ergänzen (Kundenmodus zeigt nur risikofreien Marktwert + anfänglichen Marktwert); View-Titel als `h2` (visuell wie heute), Karten `h3`; Key-Value-Tabellen `aria-label={h3-Text}`. |

### Flow-Befunde

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R4-F1 | Niedrig (Fehlerpfad) | `Blotter.tsx importJson` → `translatePricingError(e)` für `JSON.parse`-Fehler | Kaputte JSON-Datei: Toast „Import fehlgeschlagen: **Expected property name or '}' in JSON at position 1 (line 1 column 2)**“ – Engine-Text auf Englisch, für den Treasurer ohne Handlungshinweis (`jsonBadToast`). | `SyntaxError` abfangen → „Datei ist kein gültiges JSON (Zeile 1, Spalte 2) – erwartet wird ein Export aus ‚Portfolio als JSON‘“. |
| R4-F2 | Kosmetisch (Tastatur) | `App.tsx` Toast-Stack am Ende von `<body>` | „Rückgängig“ im Toast (Löschen, Hedge-Reset, Import) ist Tabstopp 70 von 72 (`toastKbd.stackPos`); ohne Maus nur über `Ctrl+Z` erreichbar – funktioniert, ist aber nicht dokumentiert am Toast. | Toast-Text „… · Rückgängig (Ctrl+Z)“ oder Hotkey `F8` → Fokus auf jüngsten Toast; Stack im DOM vor `<main>` mit `aria-live` beibehalten. |
| R4-F3 | Niedrig (Robustheit) | kein Service Worker / `manifest`; `02-epics-und-user-stories.md:144` US-8.13 „App offline (ohne API) nutzen ✅“ | `context.setOffline(true)` + Reload → `net::ERR_INTERNET_DISCONNECTED`, Browser-Fehlerseite (`offline.hasApp 0`); der lokale Bestand überlebt (26 Trades, Interpolation nach Wiederverbinden). „Offline“ gilt also nur für die laufende Session – im Kundentermin ohne WLAN nach einem Tab-Neustart ist die App weg. | App-Shell-Cache per Service Worker (Vite PWA-Plugin, `precache` der 4 Chunks + `index.html`), `manifest.webmanifest`; `navigator.onLine`-Chip „offline – lokaler Bestand“; oder Story auf „ohne API-Server“ präzisieren. |

---

## 4. User Journeys (Schritt für Schritt, tastaturgeführt)

### (a) Berater bewertet Collar für Kunden → Termsheet/KID
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `Ctrl+K` · `collar 7y 3,5/1,5 6m @Kunde GmbH` · `↵` | **171 ms** bis PV; Kontrahent „Kunde GmbH“ | – |
| `Shift+P` · `y i` (Fokus Body) | PV 0; Indikation „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · Nominal 6.000.000 EUR · bis 07.09.2033 · Prämie % Nominal 0,816 % · PV 48.973 EUR · DV01 1.427 EUR · Kontrahent Kunde GmbH · Stichtag 03.09.2026“ | `y i` mit Fokus auf Blotter-Zeile kopiert Zeile + schaltet Inspector aus (R4-02) |
| `o t` | Termsheet in **413 ms** mit „Anfänglicher Marktwert (Kundensicht)“; Tab: Markdown → Drucken → Schließen (Falle ✓), `Esc` zurück | Kundenmodus: Zeile „inkl. CVA/DVA“ (R4-10) |
| `o k` · `↑` auf Haltedauer | KID live regeneriert (7,0 → 7,51 J), Langtexte umbrechend, PDF 3 Seiten | – |
| `]` → `o t`/`o k`/`o c`/`o g` | Banner „⚠ Stress-Markt: WHAT-IF Zinsen +10 bp – … nicht prüfungsfähig“, Rückfrage vor Markdown/Druck, Datei `-whatif.md` mit Marker | Report-Kopf „What-if What-if“ (R4-07) |

### (b) Treasurer: CSV-Import → Szenarien → Portfolio-Report (213 Trades)
| Schritt | Beobachtung | Reibung |
|---|---|---|
| Export ▾ (Enter) → ↓… → „CSV importieren“ · 4 Zeilen | Dialog „3 Zeilen übersprungen“ mit Zeile/Meldung, Fehlerliste als CSV, „1 gültige Zeile importieren“ → Toast mit Rückgängig | Fokus nach Import auf Body |
| JSON mit 200 Trades | Import 288 ms, Bewertung 21 ms, 213 Zeilen im Scroll-Container, `j`×10 429 ms, Sortierung 108 ms, Gruppierung 74 ms, Palette 127 ms, `]` 175 ms, Szenarien 1,3 s, `o p` 532 ms, Reload 593 ms, `Ctrl+Z` „Import (200)“ | Szenarien-View > 1 s bei 213 Trades (akzeptabel) |
| `g s` · `Space` auf „historische Stress-Tage“ · Heatmap `→` `↵` | 6 historische Zeilen, What-if gesetzt; ein Tabstopp je Heatmap | Szenario-Tabellen 29 Zeilen-Tabstopps (R4-03) |
| `o p` unter What-if / leer | Rückfrage, `-whatif`-Datei; leer → „Kein Trade im Bestand – kein Portfolio-Report“ | – |
| kaputtes JSON / CSV ohne Typ | Toasts, kein Absturz | englische JSON-Engine-Meldung (R4-F1) |

### (c) Prüfer: Kurven → Residuen → Report-Hash/Governance
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g c` · Quote `↑↑↵` · `Ctrl+Z` | „Quotes modifiziert“ → Rückgängig mit Typ-Label | – |
| Interpolation monoton-konvex · `Ctrl+Z` | „Rückgängig: Interpolation EUR-ESTR log-linear (DF) → monoton-konvex (Hagan–West)“ | – |
| Turn-of-Year 01.01.2020 | „Anwenden“ deaktiviert, `aria-invalid`, Meldung mit Stichtag | Label dreizeilig; gespeicherter ToY nach Stichtagswechsel als Fehler statt „inaktiv“ (R4-09) |
| „+ FX-Punkte EUR/USD“ | Zeile „FX-Pkt 1M EURUSD“ in Pillar-Reihenfolge, ✕, Undo | – |
| `g m` · Vol-Zelle 1Y×5Y 62 → 120 bp | SWPT-0001-PV ändert sich, Report „geändert“, Badge + Zurücksetzen, Reload behält Wert; inverse CDS → „Hazard-Rate am Pillar 1Y … auf 0 begrenzt“ | **Caplet-Fläche ohne sichtbare Werte (R4-01)** |
| `g r` · `o r` · Perspektive Bank (`↵`) · Transaktionspreis | Governance „MaRisk AT 4.3.5, IFRS 13 / IDW RS HFA 47“, Report-Hash ändert sich, Marktdaten „log-linear (DF)“ | – |
| Drucken | Kopf, Eingaben als Text, 3 Seiten | – |

### (d) Hedge Accounting: Designation → Effektivität → Dokumentation
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g h` · Tab ×4 → „Effektivität testen“ `↵` | Verdict „effektiv“, Critical Terms 5/5, kumulativ beurteilbar | – |
| Hedge Ratio `↓` `Tab` | Veraltet-Badge, „Erneut testen“, Markdown mit „ERGEBNIS VERALTET“ + Toast | – |
| „Zurücksetzen“ `↵` | Rückfrage; Bestätigen → Toast „… verworfen · Rückgängig“; `Ctrl+Z` stellt 50 % wieder her | Toast-Button 70. Tabstopp (R4-F2) |
| ⎙ Drucken | Werte sichtbar, Kopf „ERGEBNIS VERALTET“, 3 Seiten | Selects beschnitten, Einheit getrennt (R4-08) |
| ungültiger Trade | deutsche Fehlerzeile + Kernmeldung | englischer Kerntext (R4-05) |

---

## 5. Hotkey-Matrix (verifiziert)

| Aktion | Tasten | Ergebnis |
|---|---|---|
| Termsheet / Erklärung / KID / Confirmation / Portfolio-Report / Report erzeugen | `o t` / `o g` / `o k` / `o c` / `o p` / `o r` | ✅ (Termsheet 445 ms; Hilfe „O dann T“, Palette, Statusleiste); `Ctrl+Shift+T/K` ohne Wirkung ✅ |
| Cashflows CSV / Blotter CSV | `Ctrl+E` oder `x c` / `x b` | ✅ (auch aus Textfeld und von Blotter-Zeile) |
| Indikation kopieren | `y i` | ✅ Body/Pricing · **❌ Fokus auf Blotter-Zeile → Zeile kopiert + Inspector aus (R4-02)** |
| Chord-Präfix im Textfeld (`ot`) | – | ✅ inert; Chord-Indikator „o … (zweite Taste)“ |
| What-if ±10 bp / Reset | AltGr+9 / AltGr+8 / AltGr+ß · ⌥6 / ⌥5 · `+` `-` `0` | ✅ (kein View-Sprung) |
| Hilfe / Palette / Ansicht 1…8 | ⇧ß / `Ctrl+K` / `Alt+1…8` (⌥1 `¡`, ⌥8 `{`) | ✅ |
| `Esc` in Popovern (Export ▾, Spalten, Filter ▾, Datums-Vorlagen, Bewertungshinweise) | – | ✅ aus jedem Fokus, Hotkeys ausgesetzt, Fokus-Rückgabe |
| `Esc` in Zahlen-/Datumsfeld | – | ✅ Wert bei Fokusnahme · ❌ nach `⌥↓` bereits committet (R4-04) |
| Kontextmenü | Rechtsklick, ↑/↓, `Esc`/`↵` | ✅ Fokus zurück zur Zeile, `↵` öffnet Pricing |
| `r` / `t` / `s` | – | ✅ „Portfolio neu bewertet“ / Theme / unbelegt |

---

## 6. Barrierefreiheits-Sweep (alle Views)

| Prüfung | Ergebnis |
|---|---|
| Unbenannte Inputs/Checkboxen/Buttons/Bilder/Dialoge/Composite-Rollen, doppelte IDs, positive Tabindizes | **0** in Blotter, 11 Editoren (inkl. Amortisation/Clearing/Kuponverlauf), Kurven (+FX-Punkte), Markt (+Vols), Szenarien (+historisch), Report, Vergleich, Hedge (IRS + CAP), 4 Dokumente, Palette, Hilfe, Filter-Popover, CSV-Fehlerdialog |
| Landmarks | `nav[aria-label=Hauptnavigation]` mit 8 benannten View-Buttons, `main#main`, Skip-Link erster Tabstopp, `lang=de`, Live-Region `role=status` von Anfang an |
| Rollen | Blotter `role=grid`, Zeilen `role=row` + `aria-current`, Heatmaps `grid/table` mit `row/gridcell/columnheader/rowheader`, Palette `listbox` + `aria-activedescendant`, Kontextmenü `menu` + `aria-activedescendant`, Export-Menü `menu/menuitem` mit Roving, Popover `group/listbox` benannt, Fokusfalle in Modalen ✓ |
| Kontrast | 160 Paare Dark+Light ≥ 4,5:1 (`allLow = []`), Heatmap-Minimum 8,11 |
| Reste | Zeilen `tabIndex=0` statt Roving (R4-03); Überschriften h1→h3; Key-Value-Tabellen ohne Namen (R4-10); Toast-Aktion tastaturfern (R4-F2) |

---

## 7. Was für 100 noch fehlt

1. **R4-01** Caplet-Vol-Zellen `width:100%` (wie Heat-Cells) – ~10 min, plus E2E-Check.
2. **R4-02** `y`-Konflikt: Zeilen-Kopie auf `Ctrl+C`/`y y`, Dispatcher verwirft `i` nach `y` – ~30 min.
3. **R4-03** Roving-Tabindex in `useTableNav` – ~45 min.
4. **R4-04** Datums-Vorlagen ohne Blur-Commit (Entwurf bleibt Entwurf, `Esc` verwirft) + Doku – ~30 min.
5. **R4-05 / R4-F1** Kernmeldung „Invalid trade … terminationDate must be after effectiveDate“ und `JSON.parse`-Fehler deutsch – ~20 min.
6. **R4-06** `parseDateOrTenor` auf `parseDateInput` (deutsche Daten in der Schnelleingabe) – ~20 min.
7. **R4-07 / R4-08 / R4-09 / R4-10** Report-Kopf, Druck-Selects/Einheit, ToY-„inaktiv“-Badge + Label, „Float“/„Vega swaption“/CVA-Zeile im Kundentermsheet, h2-Struktur, Tabellen-Namen – ~1,5 h.
8. **R4-F3** Service Worker / App-Shell-Cache + Offline-Chip (oder US-8.13 präzisieren) – ~1 h.
9. **R4-F2** Toast-Hinweis „(Ctrl+Z)“ bzw. Hotkey zum jüngsten Toast – ~15 min.

Erwartete Wirkung bei Umsetzung 1–9: UI/UX & Hotkeys ≈ 99–100, User Flows ≈ 99–100.

---

## 8. Artefakte

Basis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r4-ui/`

- Skripte/Messwerte: `run.mjs` (165 Checks: Landmarks, Hotkeys/Chords/Layouts, Popover, A11y aller Editoren/Views/Dokumente, Eingaben, Kurven, Markt/Vols, Report+Dokumente+What-if, Hedge, Portfolio/CSV/1280-Toolbar, Resilienz/Offline, 200-Trades-Performance, Light-Kontraste, Layouts 1280/1920, Journeys), `verify.mjs` (33 Nachprüfungen), `verify2.mjs` (10), `probe-caplet.mjs`, `probe-misc.mjs`, `probe-final.mjs`; `results.json` (u. a. `a11y_*`, `contrast_*`, `allLow`, `perf`, `whatIfDocs`, `docs`, `hedgePrint`, `overflow1280/1920`, `toolbar1280`, `filterPop`, `offline`, `poison`), `results2.json`, `results3.json`, `run.log`, `verify.log`
- Downloads: `portfolio-report.json`, `portfolio-report-whatif.json`, `portfolio-report.md`, `portfolio-report-kbd.md`, `portfolio-report-215.json`, `portfolio.json`, `portfolio-200.json`, `emir.csv`, `blotter.csv`, `cashflows.csv`, `hedge-doc.md`, `doc-{termsheet,kid,confirmation,suitability}.md`, `doc-*-whatif.md`, `import.csv`, `import-fehler.csv`, `bad.csv`, `bad.json`
- PDFs (Print-Emulation): `report-print.pdf` (3 S.), `doc-termsheet-print.pdf` (3), `doc-kid-print.pdf` (3), `doc-confirmation-print.pdf` (4), `doc-suitability-print.pdf` (3), `hedge-print.pdf` (3)
- Dark 1600: `1600-dark-blotter.png`, `-help.png`, `-editor-step.png`, `-editor-ccs-fixed.png`, `-curves.png`, `-curves-toy-past.png`, `-curves-fxpoints.png`, `-market-vols.png`, `-report.png`, `-doc-{termsheet,kid,confirmation,suitability}.png`, `-customer-termsheet.png`, `-termsheet-whatif.png`, `-hedge.png`, `-csv-errors.png`, `-poisoned-trade.png`, `-blotter-215.png`, `-termsheet-collar.png`, `-kid-collar.png`
- Print: `1600-report-print.png`, `1600-print-doc-{termsheet,kid,confirmation,suitability}.png`, `1600-print-doc-termsheet-whatif.png`, `1600-hedge-print.png`
- Light 1600: `1600-light-{blotter,palette,pricing,curves,scenarios,market,report,kid,hedge,compare,help}.png`
- Responsiv: `1280-dark-*.png` (8 Views, `blotter-filter`, `kid`, `palette`, `help`), `1920-dark-*.png` (8 Views, `pricing-irs`, `market`)
- Nachprüfungen: `probe-caplet-1600.png`, `probe-caplet-1920.png`, `v2-caplet-card.png`, `v-toy-inactive.png`, `v-report-whatif-header.png`, `v-poisoned-trade.png`, `v2-hedge-invalid.png`, `v2-hazard-warning.png`, `v2-ccs-fixed.png`, `v3-curves-inspector.png`
