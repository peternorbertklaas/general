# DERIVA – Review Runde 5: UI/UX & Hotkeys (Dim. 3) und User Flows (Dim. 4)

**Reviewer-Rolle:** Senior UX-Designer · Accessibility-Auditor · Trading-Desk-Power-User
**Datum:** 2026-09-04 · **Modus:** Re-Review only, keine Quellcode-Änderungen · **Baseline:** `review-ui-r4.md` (Runde 4: UI 95, Flows 98)

## 0. Prüfstand

| | |
|---|---|
| Repo-Stand | Branch `claude/derivatives-trading-platform-1arsyu`, HEAD `77f2366` („Runde 5 – Maßnahmenprogramm Runde 4 umgesetzt“). Web-Diff seit R4 (`a3daa92`): 31 Dateien, +1.943/−197 (u. a. `useTableNav.ts` Roving-Tabindex + Chord-Vorrang, `DateInput.tsx` Vorlagen ohne Commit, `public/sw.js` + `main.tsx` Service Worker, `App.tsx` Toast-Stack/Offline-Chip/h2, `quick-parser.ts` deutsche Daten + Swaption-Währung, `i18n.ts` Validator-/Warnungsübersetzungen, `MarketView.tsx` Caplet-Grid + FX-Fixings-Editor, `HedgeView.tsx` Validator-Gate, `ReportView.tsx` Kopf, `app.css` Druck/Vol-Grid) |
| Bundle | `vite build` frisch: `index-B05veAnH.js` 368 KB (108 KB gz), `core-B10KavL2.js` 232 KB (75 KB gz), `echarts-BUiUtRgo.js` 552 KB (183 KB gz), `react-CwjULe8d.js` 196 KB, CSS 32 KB, `sw.js` 3 KB; `vite preview --port 4931 --strictPort` |
| Unit-/E2E-Tests | `npx vitest run` in `apps/web`: **26 Dateien, 242 Tests grün**; `E2E_PORT=4932 node e2e/smoke.mjs`: **E2E OK (286 checks)** |
| Browser-Audit | Playwright + Chromium (`/opt/pw-browsers/chromium`), Locale `de-DE`, Clipboard-Rechte, Viewports **1440×900** und **1024×768** (zusätzlich 1280×800 für den Inspector), Dark + Light, Print-Emulation + `page.pdf()`, Offline (`context.setOffline`) in **frischen Browserkontexten** (Erst- und Zweitbesuch getrennt). Skripte in `…/scratchpad/r5-ui/`: `run.mjs` (81 Checks, 11 Abschnitte), `flows.mjs` (43 Checks: Offline, 5 Flows, Persistenz, Performance), `verify.mjs` (20 Nachprüfungen), `probe2.mjs` (7), `probe3.mjs` (2); Messwerte `results-a/b/v/p2/p3.json`, 60 Screenshots, 6 PDFs, 20 Downloads. Rot gelaufene Checks wurden einzeln nachgeprüft; Sonden-Artefakte (Fokus-Startpunkt nach `blur()`, Regex auf Klassennamen, Druckbreite gegen Viewport, `w == need` bei Selects) sind aus den Befunden entfernt |
| Konsole | **Keine** JS-Fehler, keine Warnungen, keine fehlgeschlagenen Requests in allen fünf Läufen |
| Tastatur | Chords `o t/g/k/c/p/r`, `x c/b`, `y i`, `y y`, `g …`, `n …`; `Ctrl+Shift+T` inert; Tab-Sequenzen ab Skip-Link (Blotter, Pricing, Szenarien); `Alt+↓`/▾ in Datumsfeldern; `Shift+P`, `Shift+K`, `Shift+T`, `d`, `Shift+D`, `Space`, `r`, `]`/`0` |

Screenshot-Verzeichnis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r5-ui/` (Übersicht Abschnitt 8).

---

## 1. Scores

### 1.1 UI/UX & Hotkeys: **96 / 100** (R1 62 → R2 88 → R3 91 → R4 95)

**Verifiziert behoben (Belege Abschnitt 2):** Caplet-Vol-Zellen an die Zelle gebunden (Input 56 px in 62-px-Spalte, 0 Überlappungen, Eingabe „99“ → „99“, Klick trifft die eigene Zelle); `y i` auf der fokussierten Blotter-Zeile kopiert die **Indikation** und lässt den Inspector unangetastet, `y y` kopiert die Zeile („Zeile kopiert“) und beendet den Chord; Roving-Tabindex: **genau eine Zeile je Tabelle** (Blotter, Cashflows, Pillars, Szenarien, P&L je Trade), ↑/↓ verschieben den Tabstopp, `Shift+Tab` kehrt zur gemerkten Zeile zurück, Pricing nach dem Termsheet-Button 54 statt 93 Tabstopps (2 statt 42 Zeilenstopps); Datums-Vorlagen öffnen **ohne Commit** (PV unverändert), `Esc` schließt und behält den Entwurf, zweites `Esc` verwirft, `↵` übernimmt, Vorlage `+1M` übernimmt; Hedge-View mit ungültigem Trade komplett deutsch („Sicherungsinstrument nicht bewertbar – Enddatum muss nach dem Startdatum liegen …“) und Buttons deaktiviert; Schnelleingabe akzeptiert `15.03.2027` und meldet `31.02.2027` deutsch mit beiden Formaten; Report-Kopf nennt „What-if“ genau einmal, Druckkopf „WHAT-IF Zinsen +10 bp – NICHT PRÜFUNGSFÄHIG“; Hedge-Druck-Selects unbeschnitten („Variabel verzinster Kredit“ 188/188 px, „endfällig (kein Tilgungsplan)“ 210/210 px); gespeicherter Turn-of-Year nach Stichtagswechsel als Badge „inaktiv (vor dem Bewertungstag)“ + Toast, Label einzeilig; Cashflow-Badges deutsch, Kundentermsheet ohne CVA/DVA/bilateral-Zeile, h1 → h2 (View-Titel) → h3, Dokument-Titel h2/Sektionen h3, Report-/Hedge-/Markt-Tabellen benannt; Toast-Stack direkt hinter dem Skip-Link („Rückgängig (Ctrl+Z)“ = erster Tabstopp nach „Zum Inhalt“, `↵` stellt den gelöschten Trade wieder her); Swaption-Editor mit Währungsauswahl „EUR/USD/GBP/CHF/JPY (Vol-Cube)“ (USD → SOFR-Underlying, CHF → SARON, bewertet), Palette `swpt usd …`; FX-Fixings-Editor (aus Spot anlegen, Dublette abgelehnt, Undo mit Label). **Kontrast: alle 812 gemessenen Textpaare ≥ 4,5:1** (Dark + Light, 1440 und 1024, inkl. Toast-Hinweis „(Ctrl+Z)“, Offline-Chip, Palette-Warnung, Vergleichstabelle). 0 unbenannte Steuerelemente in 8 Views, 11 Editoren, 4 Dokumenten, Palette, Hilfe.

**Abzüge (kumuliert ≈ −3,7):**
- Niedrig −0,8: **Inspector-Tabelle bei ≤ 1360 px beschnitten** – Sidebar 280 px, Tabelle 300 px: „Fälligkeit 17.06.2“, „Par-Satz 2,763“, „Festsatz 3,150“ (1280 und 1024, R5-01).
- Niedrig −0,5: **Roving-Tabindex unvollständig** – die „vergleichen“-Checkbox jeder Blotter-Zeile bleibt ein Tabstopp (13 zusätzliche Stopps, markierte Zeile nach 49 Tabs) (R5-02, R4-03-Rest).
- Niedrig −0,5: `Shift+P` „Par-Satz / fairen Preis übernehmen“ für **Cap/Floor/Collar nicht verfügbar** („Kein Par-Wert für diesen Trade verfügbar“), obwohl Statusleiste und Button es anbieten (R5-03).
- Niedrig −0,4: Sprach-/Struktur-Reste: KPI „Vega swaption EUR“, `Preis-Analytics`-/`Risiko`-/Inspector-Tabellen ohne Namen (R5-04, R4-10-Rest).
- Niedrig −0,4: **1024 px:** FX-Vol-Paar-Tabs laufen aus der Karte, „USD/JPY“ und „EUR/JPY“ per Maus nicht erreichbar; Kostentransparenz-Karte 14 px Überlauf (R5-05).
- Niedrig −0,4: Snapshot-Import-Fehlertexte: „Unsupported market snapshot schema: undefined“, „Cannot convert undefined or null to object“, „Ungültiges Datum: Ungültiges Datum: 2026-13-45“ (R5-06).
- Niedrig −0,3: **Kundenmodus im Report** zeigt „= risikofrei − CVA + DVA“ und zweimal „Marge der Bank = Transaktionspreis − Fair Value …“ – das Kundentermsheet blendet genau das aus (R5-07).
- Kosmetisch −0,2: Hedge-Druck: Hedge Ratio „50“ und „%“ ≈ 50 px auseinander (Input fest 10ch, `field-sizing` durch `width !important` überschrieben) (R5-08, R4-08-Rest).
- Kosmetisch −0,2: Onboarding-Beispiel „fxf eurusd -2m 1.1725 2027-03-15“ (ISO) neben der deutschen Schnelleingabe (R5-09, R4-06-Rest).

### 1.2 User Flows: **97 / 100** (R1 57 → R2 82 → R3 94 → R4 98)

- (a) **Indikation im Kundengespräch: sehr gut, vollständig per Tastatur** – `Ctrl+K` → `collar 7y 3,5/1,5 6m @Kunde GmbH` → `↵` in **330 ms** bis PV (Kontrahent „Kunde GmbH“); `y i` liefert „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · Nominal 6.000.000 EUR · bis 07.09.2033 · Prämie % Nominal 0,816 % · PV 48.973 EUR · DV01 1.427 EUR · Kontrahent Kunde GmbH · Stichtag 03.09.2026“; `g s` → Szenarien in 473 ms, Heatmap `→ ↵` setzt What-if, `o t` unter What-if mit Banner „⚠ Stress-Markt: WHAT-IF Zinsen -200 bp / EUR +5 % …“; `o t` in **395 ms**, Tab-Reihenfolge Markdown → Drucken → Schließen (Fokusfalle ✓); `o k`, `o g` (Kunde eintragen → Erklärung), `o c`, `o r` (Hashes + Governance „MaRisk“), Nominal-Änderung → Report „geändert“. Reibung: `Shift+P` auf dem Collar → „Kein Par-Wert für diesen Trade verfügbar“ (R5-03, Dim. 3); Kundenmodus-Report mit Margenformel (R5-07, Dim. 3).
- (b) **Treasurer: CSV-Import → Fehler beheben → Portfolio bewerten: gut** – Dialog „CSV-Import: 3 Zeilen übersprungen“ (Zeile · Meldung: „Nominal fehlt oder ≤ 0“, „Kauf-/Verkaufswährung fehlt“, „Unbekannter Typ „XYZ“ …“), Fehlerliste als CSV, „2 gültige Zeilen importieren“ → Toast mit „Rückgängig (Ctrl+Z)“; korrigierte Datei mit ID-Kollision → Dialog **Überspringen / Ersetzen / Umbenennen**, „Ersetzen“ → „2 Trades aus CSV importiert (1 ersetzt)“; 17 Trades ohne Fehler-Badge bewertet, `o p` → `portfolio-report-2026-09-03.json`; kaputtes JSON → „Datei ist kein gültiges DERIVA-JSON (Zeile 1, Spalte 2) – erwartet wird ein Export aus „Portfolio als JSON“ …“ (R4-F1 ✓), JSON ohne Trades → „Datei enthält keine Trade-Liste …“; `Ctrl+Z` ×2 nimmt beide Importe zurück. **Reibung −1,0:** unmögliche Daten `31.02.2026` und `2026-02-30` in der Spalte `start` werden **stillschweigend durch den Standardstart (Spot 05.09.2026) ersetzt** – der Trade erscheint als gültig, keine Zeilenmeldung (R5-F1).
- (c) **Prüfer: Marktdaten → What-if → Vergleich → Snapshot-Reproduktion: gut mit einer Lücke** – Quote `↑↵` → „modifiziert“, PV −278.344 → −278.332; `]` in 46 ms → PV −203.855, Chip „What-if Zinsen +10 bp“; Vergleich zweier Trades zeigt Barwerte unter What-if inkl. P&L-Szenarien; `Ctrl+Z` „Rückgängig: Quote OIS 1W 2,0150 → 2,0200 %“; leerer Vergleich mit Handlungshinweis. Snapshot-Export → sofortiger Re-Import reproduziert Snapshot-ID `6aaf77f93760321b` und Report-Hash `a383156a53a16e80…`, Re-Export ist byteidentisch, Report-JSON trägt den angezeigten Hash. **Reibung −1,5:** sobald vorher eine Quote geändert wurde, bekommt der importierte (identische) Snapshot die ID `95397b210fcc1c0b` (Report-Label „· Quotes modifiziert“ fließt in die ID), die Quotes-Tabelle zeigt weiter den geänderten Wert, der nächste Stichtagswechsel **verwirft den Import still** (ID `61f035592b3d0ac5` = Quotes-Markt), und ein Snapshot mit Bewertungstag 30.10.2026 wird bewertet (PV −242.555, „6M-Forward ab 30.10.2026“), während Statusleiste, Chip und Report „Bewertungstag 03.09.2026“ zeigen (R5-F2).
- (d) **Hedge Accounting: sehr gut** – `Effektivität testen` per `↵` → Verdict mit Erklärung (Sample IRS-0001: „✗ nicht effektiv“, Dollar-Offset kumuliert 51,3 %, Hinweis „Sicherungsinstrument war bei Designation nicht marktgerecht (Barwert −235.581,07 EUR) – Quelle von Ineffektivität (IFRS 9 B6.5.5)“ – das R4-Ergebnis „effektiv“ entstand auf einem durch die R4-Sonde veränderten Trade mit Fälligkeit 2041, kein Regress); Hedge Ratio `↓` → Veraltet-Badge, Markdown mit „ERGEBNIS VERALTET“, deutschen Überschriften und ohne ISO-Daten; „Zurücksetzen“ fragt, Toast-„Rückgängig“ per `Tab ↵` erreichbar und stellt 50 % wieder her (R4-F2 ✓); CAP mit innerem Wert + eingefrorener Vol → Cost-of-Hedging-Karte, „✓ effektiv“; Druck 3 Seiten mit Werten. Kosmetisch −0,2: nach Reload bleibt die Dokumentation (Ratio), das Testergebnis muss neu erzeugt werden (R5-F3).
- (e) **Offline / Persistenz:** Theme, View, Bewertungstag 30.10.2026 und Feldänderung überleben den Reload („Bestand aus lokalem Speicher geladen (14 Trades) · Zurücksetzen“); Service Worker registriert und aktiv nach dem ersten Aufruf. **Reibung −0,5:** nach dem **ersten** Online-Besuch enthält der Cache nur `/` und `/index.html` – Offline-Reload liefert eine leere Seite; erst nach dem zweiten Online-Aufruf liegen die vier Chunks + CSS im Cache, dann funktionieren Offline-Reload, Chip „⚠ offline – lokaler Bestand“, Termsheet und Report offline. Doku (`03-ui-konzept…:53`, US-8.13) verspricht „nach dem ersten Online-Aufruf“ (R5-F4, R4-F3-Rest).
- Performance (213 Trades): Import 277 ms, Bewertung 13,7 ms, `j`×10 365 ms, Sortierung 135 ms, Palette 121 ms (68 Treffer), `]` 154 ms, Szenarien 1,07 s, Portfolio-Report 503 ms, Hedge-View 485 ms, Reload 573 ms, Heap 22 MB, localStorage 118 KB; Einzeltrade: Feldänderung → PV 68 ms, Kurven 396 ms, Markt 396 ms, Report 381 ms.

---

## 2. Status der Runde-4-Befunde

Legende: ✅ behoben · 🔶 teilweise · ❌ offen. Belege = Check-Name/Feld in `results-a.json` (`run.mjs`), `results-b.json` (`flows.mjs`), `results-v.json` (`verify.mjs`), `results-p2/p3.json` oder Screenshot.

| # | Titel (R4) | Status | Beleg / Rest |
|---|---|---|---|
| R4-01 | Caplet-Vol-Fläche ohne sichtbare Werte | ✅ | `MarketView.tsx` `table.vol-grid` + `<colgroup>`, `NumInput width="100%"`, `app.css` `td.vol-cell .num-input.inline{width:100%}`; `caplet {inputW 56, tdW 62, within true, overlapping 0}`, `capletEdit {c0 62 → 99, badge 1}`, `capletHit {hitIsOwn true, INPUT}`; `1440-caplet-card.png` zeigt alle Werte |
| R4-02 | `y i` auf Blotter-Zeile kopiert Zeile / Inspector aus | ✅ | `useTableNav.ts` `CHORD_STARTERS`, `y` nur bei `chordPrefix === "y"` verbraucht; `useHotkeys.ts` beendet den Chord bei `defaultPrevented`; `yiRow {clip „…PV…“ ohne Tab, inspBefore 1 = inspAfter 1}`, `yyRow {clip mit Tabs, „Zeile kopiert“, chordPending 0}`; Hilfe/Hinweise „y y“ |
| R4-03 | Alle Zeilen `tabIndex=0` | 🔶 | `rowProps(i, n, {active})`: `rowStops {blotter 1, cashflows 1, pillars 1, scenarios 1, pnl 1}`, `scenArrow {idx 2, stops 1, stopIdx 2}`, `Shift+Tab` → Zeile 2; Pricing 54 Stopps/2 Zeilen (R4: 93/42). **Rest → R5-02:** Checkbox „vergleichen“ je Zeile (`cellStops 14`), Blotter-Zeile nach 49 Tabs |
| R4-04 | `⌥↓`/▾ committet den Entwurf | ✅ | `DateInput.tsx` `presets`-Ref, `resuming`, `onMouseDown preventDefault`; `presets {open 1, pvAfterOpen = pv0, afterEsc1 {text 31.12.2041, pv unverändert, focus Enddatum}, afterEsc2 {text 17.06.2034}}`, `presetsBtn {open 1, pv unverändert, afterEnter {31.12.2041, PV −332.579}}`, Undo → 17.06.2034, `presetPick 17.07.2034`; Doku und Hilfetext angepasst |
| R4-05 | Hedge: englische Kernmeldung | ✅ | `HedgeView.tsx` `validateTrade` vor dem Core, `translateTradeIssues`; `hedgeInvalid {msg „Sicherungsinstrument nicht bewertbar – Enddatum muss nach dem Startdatum liegen; …“, testDisabled true, hypoDisabled true}`, kein `terminationDate`/`Invalid trade` in Report/Pricing/Szenarien (`1440-dark-hedge-invalid.png`). Kosmetisch: Meldung je Leg ohne Leg-Nummer doppelt |
| R4-06 | Schnelleingabe nur ISO-Daten | ✅ | `quick-parser.ts` `DATE_DE`, `parseDateToken`; `qeDe {name „Verkauf EUR/USD 15.03.2027“, Lieferdatum 15.03.2027}`, `qeBad „⚠ Ungültiges Datum „31.02.2027“ – Datum als 15.03.2027 oder 2027-03-15“`, Hilfe nennt beide Formate. **Rest → R5-09:** `Blotter.tsx:46` `ONBOARDING_EXAMPLES` mit `2027-03-15` |
| R4-07 | Report-Kopf „What-if What-if“ | ✅ | `ReportView.tsx:276` Zusatz entfernt; `reportHeader` „… Snapshot Sample EoD · What-if +10bp · FX +0% · Vol +0bp – keine prüfungsfähige Bewertung · erstellt …“ (1 Treffer), Druckkopf „WHAT-IF Zinsen +10 bp – NICHT PRÜFUNGSFÄHIG“ |
| R4-08 | Hedge-Druck: Selects beschnitten, Einheit getrennt | ✅ | `app.css` Print `.field select{width:auto; field-sizing:content}`; `hedgePrint.selects` alle `w == need` (108/43/94/188/22/72/210 px). **Rest → R5-08:** „50“ linksbündig im 72-px-Input, „%“ ≈ 50 px entfernt (`1440-hedge-print.png`) |
| R4-09 | ToY nach Stichtagswechsel als Fehler | ✅ | `CurvesView.tsx` `toyPast = toyDirty && …`, `storedToyInactive = !toyDirty && …`; `store.ts setValuationDate` Toast; `toyInactive {badge „inaktiv (vor dem Bewertungstag)“, past 0, chip „… 1 Turn-of-Year (1 inaktiv)“, toast „Turn-of-Year EUR-ESTR (31.12.2026) liegt jetzt vor dem Bewertungstag – inaktiv“, applyEnabled false}`, geänderter Entwurf → Validierung (`toyDraft {past 1}`), Label 14 px einzeilig (`1440-dark-curves-toy-inactive.png`) |
| R4-10 | „Float EURIBOR-6M“, „Vega swaption“, Kunden-CVA-Zeile, h1→h3, Tabellen ohne Namen | 🔶 | `legTypeLabel` („Variabel EURIBOR-6M“, `cfBadges` ohne Float/Fixed), `INTERNAL_ROW` (`custTs {cva [], marge [], initial true}`), `App.tsx` `<h2 className="crumb">` (`h1 1`, `h2 ["/ Blotter"]`, `headingSkips 0` in allen Views), Dokumente h2/h3, `aria-label` auf Kostentransparenz/Sensitivitäten/Dollar-Offset/IFRS 9/CoH/FX-Spots. **Rest → R5-04:** `PricingWorkspace.tsx:355` „Vega swaption EUR“ (`vega.kpi`), `Inspector.tsx:19` `AnalyticsTable` ohne `aria-label` (`analytics-table`, `risk-table`, Inspector in allen Views) |
| R4-F1 | JSON-Import mit Engine-Text | ✅ | `portfolio-io.ts jsonImportError`; `jsonBadToast „Import fehlgeschlagen: Datei ist kein gültiges DERIVA-JSON (Zeile 1, Spalte 2) – erwartet wird ein Export aus „Portfolio als JSON“ oder „Portfolio-Report (JSON)““`, `jsonWrongToast „… keine Trade-Liste …“` |
| R4-F2 | Toast-„Rückgängig“ als 70. Tabstopp | ✅ | `App.tsx` Toast-Stack nach dem Skip-Link (`stackAfterSkip true, stackBeforeApp true, role status`); Skip-Link → `Tab` → „Rückgängig (Ctrl+Z)“ → `↵` stellt IRS-0001 wieder her (`afterUndo 13`); Hedge-Reset-Undo per Tastatur → Ratio 50; Button-`title` „Rückgängig (Ctrl+Z)“ |
| R4-F3 | Kein Offline-Reload | 🔶 | `public/sw.js` (Assets cache-first, Shell network-first), `main.tsx` Registrierung; **Erstbesuch:** `off1 {swReady true, controller true, cacheKeys {deriva-shell-v1: ["/", "/index.html"]}, reloadOk true, hasApp 0, body ""}` (`offline-after-first-visit.png` leer); **Zweitbesuch:** Cache mit 4 Chunks + CSS, `off2 {hasApp 1, chip „⚠ offline – lokaler Bestand“, status „offline“, 14 Trades, termsheet 1, report 1, chipAfterOnline 0}`. **Rest → R5-F4:** Assets werden bei `install` nicht vorgeladen |
| Markt R4-1 | FX-Fixings in der UI | ✅ | `FxFixingsEditor`: `fxFix {rows 1, dupToast „FX-Fixing EUR/USD 03.09.2026 ist bereits hinterlegt“, undoToast „Rückgängig: FX-Fixing EUR/USD 03.09.2026 = 1,1625 (Spot)“, afterUndo 0}`, Snapshot-Karte „FX-Fixings: n“, Reset räumt ab |
| Markt R4-2 | `swpt usd` legt EUR an, Editor ohne Währung | ✅ | `qeSwptUsd` „Payer-Swaption USD 1Y×5Y“, `qeSwptUsdCcy USD`, Optionen „EUR/USD/GBP/CHF/JPY (Vol-Cube)“, CHF → SARON-Underlying, PV 130; `swpt chf 2y10y rec 1% 5m` ohne Warnung (CHF-Cube vorhanden) |
| Markt R4-3 | Caplet-Zellen überlappen | ✅ | = R4-01 |

---

## 3. Neue Befunde (Runde 5)

Schweregrade wie in R1–R4. Reproduktion gegen das Preview-Bundle; Belege in `results-*.json` (Feldname) bzw. Screenshot.

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R5-01 | Niedrig (Lesbarkeit) | `app.css:1381` `@media (max-width:1360px){:root{--inspector-w:280px}}`, `Inspector.tsx:19` `AnalyticsTable` (`table.grid-table` ohne `table-layout`) | Bei 1280 und 1024 px ist die Inspector-Tabelle 300 px breit in einer 280-px-Sidebar: 10 Zellen ragen über den rechten Rand, sichtbar bleibt „Fälligkeit 17.06.2“, „Restlaufzeit 7,7“, „Par-Satz 2,763“, „Festsatz 3,150“ (`insp1280/insp1024 {inspW 280, tableW 300, nClipped 10}`, `1024-inspector.png`, `1024-dark-blotter.png`). Kein Ellipsis, kein sichtbarer Scrollbalken – der Berater liest falsche Zahlen. | `.inspector table{table-layout:fixed;width:100%}` mit `td.muted{overflow:hidden;text-overflow:ellipsis}` **oder** `--inspector-w: 300px` unter 1360 px und Zellen-Padding 4 px; E2E-Check `td.getBoundingClientRect().right ≤ inspector.right` bei 1280. |
| R5-02 | Niedrig (Tastatur) | `Blotter.tsx` Zeilen-Checkbox „<ID> vergleichen“ (`input type=checkbox`, `tabIndex` default) | Roving-Tabindex gilt für `<tr>`, nicht für die Zelleninhalte: 13 Checkboxen bleiben Tabstopps (`blotterStops {rowStops 1, cellStops 14}`), die markierte Zeile IRS-0001 kommt erst nach **49** Tabs (8 Checkbox-Stopps davor, `tabsToRow`). `Space` auf der Zeile erledigt dieselbe Funktion. | Checkbox `tabIndex={-1}` (Fokus per Zeile + `Space`, Maus weiterhin), `aria-hidden` nicht nötig; alternativ Grid-Muster mit `←/→` zwischen Zellen. E2E: `tabsToRow ≤ 30`. |
| R5-03 | Niedrig (Hotkey-Versprechen) | `trade-ops.ts:160-165` `applyParSolve` CapFloor liest `forwardRate`/`atmRate`/`forward`, der Core liefert nur `premiumPct` (`capfloor-pricer.ts:229`); `App.tsx:300`, `PricingWorkspace.tsx:215-221` | Statusleiste im Pricing wirbt mit „⇧P Par-Satz / fairen Preis übernehmen“, Button-Titel ebenso; auf Cap, Collar (Quick-Entry) und CAP-0001: Toast „Kein Par-Wert für diesen Trade verfügbar“, PV unverändert (`par.cap/collar/capNew`). IRS/FXF/SWPT funktionieren (PV → 0 bzw. ATM). | Core: `analytics.atmStrike` (Forward-Swapsatz der Cap-Laufzeit) für CapFloor liefern; Web: Strike auf `atmStrike` setzen, bei Collar Floor-Strike so lösen, dass die Prämie 0 wird (Sekante über `premiumPct`); bis dahin Button deaktivieren mit Titel „für Cap/Floor nicht verfügbar“. |
| R5-04 | Kosmetisch (Sprache/A11y) | `PricingWorkspace.tsx:355` `Vega {k.replace(/:/g, " ")}` (`k` = `swaption:EUR`), `Inspector.tsx:19` `<table className="grid-table" data-testid={testId}>` | KPI-Label „Vega swaption EUR ⓘ (+1 bp / +1 Pkt)“ im Pricing (`vega.kpi`), obwohl `bucketLabel` in R5 für den Inspector „Swaption EUR“ liefert; Tabellen `analytics-table`, `risk-table` (Preis-Analytics) und die Inspector-Analytics haben weder `th` noch `aria-label` (`vega.tables`, `inspectorTables`, in jeder View `tablesNoHeader ["grid-table|"]`). | `bucketLabel(k)` statt `k.replace`; `AnalyticsTable` `aria-label={label ?? "Analytics"}` (Pricing: „Preis-Analytics“/„Risiko“, Inspector: „Kennzahlen“). |
| R5-05 | Niedrig (1024 px) | `MarketView.tsx` FX-Vol-Karte `h3 > .right .seg` (Paar-Tabs), `.card{overflow:visible}`; `ReportView` Kostentransparenz-Karte | Bei 1024×768: `h3` der FX-Vol-Fläche 432 px in 287 px Karte, die Tabs „USD/JPY“ und „EUR/JPY“ liegen außerhalb und **treffen per Maus nichts** (`fxVolHead1024 {over ["…", "USD/JPY", "EUR/JPY"]}`, `fxVolHit hit false`, `1024-fx-vol-card.png`); Kostentransparenz-Karte 333/319 px (`clipReport1024`). 1440 px sauber. | `h3 .right{flex-wrap:wrap}` bzw. Paar-Tabs unterhalb des Titels rendern, wenn `card < 360 px`; `.card{min-width:0; overflow-x:auto}` als Sicherheitsnetz. |
| R5-06 | Niedrig (Fehlertexte) | `MarketView.tsx:900` `translatePricingError(err)` für `deserializeMarket`/`validateMarket`; `snapshot.ts:95` engl. Text; `i18n.ts` `INVALID_DATE`-Regel verdoppelt den Präfix (`i18n.test.ts:1262` schreibt das sogar fest) | Snapshot ohne `schema` → „Import fehlgeschlagen: **Unsupported market snapshot schema: undefined**“; Snapshot mit `valuationDate 2026-13-45` → „Import fehlgeschlagen: **Ungültiges Datum: Ungültiges Datum:** 2026-13-45“; Snapshot ohne Vol-/Credit-Felder → „Import fehlgeschlagen: **Cannot convert undefined or null to object**“ (`badSnapToast`, `snap.badToast/badToast3`). | Regel `Unsupported market snapshot schema: (.*)` → „Datei ist kein DERIVA-Markt-Snapshot (Schema „$1“ unbekannt, erwartet deriva.market/1)“; `translatePricingError`: Präfix nicht anhängen, wenn die Nachricht bereits mit dem Code-Text beginnt; `deserializeMarket`/`validateMarket` optionale Felder mit `?? {}` absichern und `TypeError` als „Snapshot unvollständig (Feld …)“ melden. |
| R5-07 | Niedrig (Kundenmodus) | `ReportView.tsx` Fair-Value-Karte Untertitel „= risikofrei − CVA + DVA“, Kostentransparenz-Erläuterung und Methodik-Zeile „Kostentransparenz (MiFID II …)“ ohne `customerMode`-Filter | Im Kundenmodus (Chip „◉ KUNDENANSICHT“) sind CVA-/DVA-Karten ausgeblendet, aber der Report zeigt weiter „= risikofrei − CVA + DVA“ und **zweimal** „Marge der Bank = Transaktionspreis − Fair Value; anfänglicher Marktwert aus Kundensicht = −Marge der Bank …“ sowie „Kontrahentenrisiko: … CVA = LGD · Σ EPE · ΔPD“ (`cust.report`, `p2-customer-report.png`). Das Kundentermsheet (R3-F8) unterdrückt genau diese Formel – am Bildschirm sieht der Kunde sie trotzdem. | Untertitel im Kundenmodus „inkl. Kontrahentenrisiko“; Erläuterung/Methodik über `customerCostRule` (wie im Termsheet) rendern; `INTERNAL_ROW`-Filter auch auf Methodik-Zeilen der Report-View anwenden. |
| R5-08 | Kosmetisch (Druck) | `app.css:1477-1483` Print `.input-unit input{width:10ch !important; field-sizing:content}` – die feste Breite überschreibt `field-sizing` | Hedge-Druck „Hedge Ratio 50      %“: Wert linksbündig im 72-px-Feld, Einheit dahinter (DOM-Abstand 3 px, optisch ≈ 50 px, `1440-hedge-print.png`). | `width:auto !important; min-width:2ch` oder `print-only`-Span mit `value + unit`. |
| R5-09 | Kosmetisch | `Blotter.tsx:46` `ONBOARDING_EXAMPLES = ["irs 10y pay 3.1% 10m", "cap 5y 3% 8m", "fxf eurusd -2m 1.1725 2027-03-15"]` | Willkommenskarte zeigt das FX-Beispiel mit ISO-Datum, `QUICK_ENTRY_EXAMPLES` und Hilfe zeigen `15.03.2027` (`onboarding`, `scan_blotter.iso`). | Beispiel aus `QUICK_ENTRY_EXAMPLES` ziehen (eine Quelle). |

### Flow-Befunde

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R5-F1 | **Mittel** (Datenqualität) | `portfolio-io.ts:407-410` `dateOf` liefert für ungültigen Text `undefined`, `:479` `start = dateOf(rec.start) ?? addTenor(valuationDate, "2D")`, analog `:509/:527/:550/:630` | CSV-Zeilen mit `start = 31.02.2026` bzw. `2026-02-30` werden **ohne Meldung** importiert; beide Trades starten am 05.09.2026 (Spot) und enden 05.09.2033, PV −50.858, Status OK (`csvDate {rows ["4 Festsatz fehlt"], btn „3 gültige Zeilen importieren“, IRS-D1/IRS-D2 {start 05.09.2026}}`). Der Tippfehler des Treasurers wird zu einem plausibel aussehenden, falschen Trade – der Fehlerdialog (R3-F7) greift nicht. | `dateOf` unterscheidet „leer“ (Default) von „ungültig“ (Fehler): `if (s && parse === undefined) throw new Error(\`Ungültiges Datum „${s}“ in Spalte start – TT.MM.JJJJ, ISO oder Tenor\`)` für `start`, `maturity`, `deliveryDate`, `expiry`; Test `tradesFromCsv` mit `31.02.2026` → `errors[0].row`. |
| R5-F2 | **Mittel** (Reproduzierbarkeit) | `MarketView.tsx:886-903` Import → `setMarket(imported)` ohne Abgleich von `quotes`/`valuationDate`; `ReportView.tsx:85-89` `reportMarket.meta.label += " · Quotes modifiziert"` aus `quotesModified(s.quotes)`; `valuation-report.ts:305` `label` in der Snapshot-ID; `store.ts:1076` `setValuationDate` → `rebuildMarket(d, get().quotes)` | (1) Export → Quote ändern → denselben Snapshot importieren: PV wieder −278.344, aber Snapshot-ID `95397b210fcc1c0b` statt `6aaf77f93760321b`, Chip „Sample EoD · modifiziert“, Quotes-Tabelle zeigt weiter 2,015 (`sq`, `results-p2.json`); Re-Export ist byteidentisch mit der Importdatei (`diffOrigReimp []`) – die Abweichung kommt allein aus dem UI-Label. (2) Stichtag 04.09. → 03.09.: ID `61f035592b3d0ac5` = Quotes-Markt – **der Import ist still weg** (`afterDate.curve0node1.df = modNode1.df`). (3) Snapshot mit `valuationDate 2026-10-30`: Toast „Snapshot 2026-10-30 importiert“, PV −242.555 mit „6M-Forward ab 30.10.2026“, aber Statusleiste/Chip/Report-Kopf „Bewertungstag 03.09.2026“ (`mismatch`, `results-p3.json`). Der Prüfer-Flow „Snapshot laden → Report-Hash reproduzieren“ funktioniert nur im unveränderten Zustand. | Import setzt `valuationDate` aus dem Snapshot (oder fragt „Bewertungstag auf 30.10.2026 setzen?“), markiert den Markt als `source: "import"` und **friert die Quotes-Rebuild-Pfade ein** (Quotes-Tabelle read-only mit Hinweis „Kurven aus Snapshot – Quotes nicht verfügbar“ oder Quotes aus den Kurven zurückrechnen); `marketModified` aus dem Markt (`meta.source !== sample`) statt aus `quotes`; das Label „Quotes modifiziert“ nicht in die ID einfließen lassen (Core: `label` aus `marketSnapshotId` entfernen oder nur `meta.label` des Snapshots hashen); Stichtagswechsel bei importiertem Markt: Roll des Snapshots oder Warnung „Import wird durch Sample-Quotes ersetzt“. E2E: Export → Quote ändern → Import → ID gleich; Stichtag hin/zurück → ID gleich. |
| R5-F3 | Kosmetisch | `HedgeView.tsx` Testergebnis nur im Komponentenstate | Nach Reload bleibt die Dokumentation (Hedge Ratio 100, Grundgeschäft), aber Verdict/Karten fehlen bis zum erneuten „Effektivität testen“ (`f4.persisted {ratio 100, verdict 0}`). | Ergebnis mit `stale`-Flag im Store persistieren oder beim Mount automatisch neu testen, wenn eine Dokumentation vorliegt. |
| R5-F4 | Niedrig (Robustheit) | `public/sw.js:22-37` `install` cached nur `SHELL = ["/", "/index.html"]`; Assets nur im `fetch`-Handler (cache-first), der beim ersten Besuch noch nicht kontrolliert; `03-ui-konzept-und-hotkeys.md:53`, `02-epics…` US-8.13 „nach dem ersten Online-Aufruf“ | Frischer Browser, ein Online-Aufruf, `setOffline(true)` + Reload → `index.html` kommt aus dem Cache, die vier Chunks nicht → leere Seite (`off1 {cacheKeys ["/", "/index.html"], hasApp 0}`); der Repo-E2E-Test lädt deshalb vor dem Offline-Test einmal neu (`smoke.mjs:1159` „controlled by the worker from now on → assets enter the cache“). Im Kundentermin nach dem ersten Start ohne WLAN ist die App weg. | Beim `install` die Asset-URLs aus `index.html` parsen (`<script src>`, `<link href>` mit `/assets/`) und `cache.addAll` (oder Vite-Manifest in `sw.js` injizieren); zusätzlich nach `navigator.serviceWorker.ready` aus der Seite `caches.open(...).addAll(performance.getEntriesByType("resource")…)`; Doku-Satz erst dann wieder „nach dem ersten Aufruf“. |

---

## 4. User Journeys (Schritt für Schritt, tastaturgeführt)

### (a) Berater bewertet Collar → Termsheet/KID/Erklärung → Report
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `Ctrl+K` · `collar 7y 3,5/1,5 6m @Kunde GmbH` · `↵` | **330 ms** bis PV 48.973; Kontrahent „Kunde GmbH“; Par-Risk, Vega-Buckets, Key-Rate, Analytics sichtbar | – |
| `Shift+P` | Toast „Kein Par-Wert für diesen Trade verfügbar“, PV unverändert | R5-03 |
| `y i` (auch mit Fokus auf der Blotter-Zeile) | Indikation „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · … · Kontrahent Kunde GmbH · Stichtag 03.09.2026“ | – (R4-02 ✓) |
| `g s` · Heatmap `→ ↵` · `o t` | Szenarien 473 ms; What-if „Zinsen -200 bp / EUR +5 %“; Termsheet mit Stress-Banner | – |
| `0` · `o t` · `Tab`×3 | Termsheet **395 ms**, Tab: Markdown → Drucken → Schließen, `Esc` schließt | – |
| `o k` · `↑` Haltedauer · `o g` · Kunde · Erzeugen · `o c` | KID live (7,79 → 8,29 J), Erklärung „Geeignetheitserklärung …“, Confirmation-Formular | – |
| `o r` · Nominal ändern · `g r` | Snapshot/Report-Hash, Governance MaRisk; „geändert“-Badge | – |
| `Shift+K` | Chip „◉ KUNDENANSICHT“, Blotter ohne DV01/Kontrahent-Spalten, Pricing ohne XVA | Report zeigt „= risikofrei − CVA + DVA“ und „Marge der Bank = …“ (R5-07) |

### (b) Treasurer: CSV-Import → Fehler beheben → Portfolio bewerten
| Schritt | Beobachtung | Reibung |
|---|---|---|
| Export ▾ → CSV importieren (5 Zeilen, 3 defekt) | Dialog „3 Zeilen übersprungen“ (Zeile · Meldung), CSV-Fehlerliste, „2 gültige Zeilen importieren“, Toast mit „Rückgängig (Ctrl+Z)“, Fokus auf „Schließen“ | Fokus nach Import auf Body |
| korrigierte Datei (eine ID existiert) | Dialog „Import: vorhandene Trade-IDs“ – Überspringen / Ersetzen / Umbenennen; „2 Trades aus CSV importiert (1 ersetzt)“ | – |
| Datei mit `31.02.2026` / `2026-02-30` | **importiert ohne Meldung**, Start 05.09.2026 | **R5-F1** |
| Blotter · `o p` | 17 Trades, 0 Fehler-Badges, PV −124.027; `portfolio-report-2026-09-03.json` | – |
| kaputtes JSON / JSON ohne Trades | deutsche Toasts mit Handlungshinweis | – (R4-F1 ✓) |
| `Ctrl+Z` ×2 | beide Importe zurück (13 Trades) | – |

### (c) Prüfer: Marktdaten → What-if → Vergleich → Snapshot
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g c` · Quote `↑↵` | „modifiziert“, IRS-0001 PV −278.344 → −278.332 | – |
| `]` | 46 ms, PV −203.855, Chip „What-if Zinsen +10 bp“ | – |
| `g b` · `Space` · `j` · `Space` · `g v` | Vergleichstabelle 2 Trades mit P&L-Szenarien, Kennzahl „Par-Satz“ | – |
| `0` · `Ctrl+Z` | „Rückgängig: Quote OIS 1W 2,0150 → 2,0200 %“ | – |
| `g m` · Snapshot exportieren · sofort importieren · `o r` | Snapshot-ID/Hash identisch, Re-Export byteidentisch, Report-JSON mit demselben Hash | – |
| Quote ändern → Import → `o r` → Stichtag hin/zurück | ID `95397b…` (Label „Quotes modifiziert“), Quotes-Tabelle 2,015, nach Stichtag ID `61f035…` (Import verworfen) | **R5-F2** |
| Snapshot mit Bewertungstag 30.10.2026 | Toast „importiert“, PV nach 30.10., UI „Bewertungstag 03.09.2026“ | **R5-F2** |
| ungültige Snapshots | englische/rohe Fehlertexte | R5-06 |

### (d) Hedge Accounting
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g h` · `Effektivität testen` `↵` | „✗ nicht effektiv“ mit Herleitung (Dollar-Offset kumuliert 51,3 %, Off-Market-Hinweis), Regression ✓, Critical Terms 5/5 | – (R4-Baseline „effektiv“ war ein durch die R4-Sonde verlängerter Trade) |
| Hedge Ratio `↓` `Tab` · Dokumentation | Veraltet-Badge, Markdown „ERGEBNIS VERALTET“, deutsche Überschriften | – |
| „Zurücksetzen“ `↵` · Skip-Link `Tab` `↵` | Rückfrage, Toast; Undo per Tastatur → 50 % | – (R4-F2 ✓) |
| Reload | Dokumentation da, Ergebnis muss neu erzeugt werden | R5-F3 |
| ⎙ Drucken | 3 Seiten, Selects vollständig, Kopf „ERGEBNIS VERALTET“ | „50   %“ (R5-08) |
| CAP · Innerer Wert · Vol einfrieren | Cost-of-Hedging-Karte, „✓ effektiv“ | – |

### (e) Offline
| Schritt | Beobachtung | Reibung |
|---|---|---|
| frischer Browser, 1 Aufruf, offline, Reload | leere Seite (Cache: nur `/`, `/index.html`) | **R5-F4** |
| 2. Aufruf online, offline, Reload | App mit 14 Trades, Chip „⚠ offline – lokaler Bestand“, Statusleiste „offline“, `o t`/`o r` funktionieren, Chip verschwindet online | – |

---

## 5. Hotkey-Matrix (verifiziert)

| Aktion | Tasten | Ergebnis |
|---|---|---|
| Termsheet / Erklärung / KID / Confirmation / Portfolio-Report / Report erzeugen | `o t` / `o g` / `o k` / `o c` / `o p` / `o r` | ✅ (Termsheet 395–403 ms); `Ctrl+Shift+T` inert |
| Indikation kopieren / Zeile kopieren | `y i` / `y y` | ✅ auch mit Fokus auf der Blotter-Zeile (R4-02 ✓); `y j` verbraucht `j` (Chord-Abbruch, kein Sprung – akzeptabel) |
| Cashflows CSV / Blotter CSV | `Ctrl+E` oder `x c` / `x b` | ✅ (Smoke) |
| What-if ±10 bp / Reset | `]` `[` `\` · `+` `-` `0` | ✅ (46–154 ms) |
| Par-Satz / fairen Preis | `Shift+P` | ✅ IRS (PV → 0), FXF (PV → 0), SWPT (ATM) · ❌ Cap/Floor/Collar „Kein Par-Wert“ (R5-03) |
| Kundenmodus / Stichtag / Theme / Inspector | `Shift+K` / `Shift+T` / `t` / `i` | ✅ (Stichtag-Popover: Fokus im Feld, `Esc` zurück zum Chip) |
| Duplizieren / Löschen / Vergleich / Neu bewerten | `d` / `Shift+D` / `Space` / `r` | ✅ (Toasts mit Rückgängig; „Portfolio neu bewertet ×2“ dedupliziert) |
| `Esc` in Popovern (Export ▾, Spalten, Filter ▾, Datums-Vorlagen, Stichtag) | – | ✅ aus jedem Fokus, Fokus-Rückgabe; Datums-Vorlagen: `Esc` schließt, zweites `Esc` verwirft (R4-04 ✓) |
| Tabellen | `↑/↓` `Home/End` `PgUp/PgDn` `Tab` | ✅ ein Zeilen-Tabstopp je Tabelle (R4-03); Rest: Zeilen-Checkboxen (R5-02) |
| Toast-Aktion | `Tab` ab Skip-Link · `↵` | ✅ (R4-F2) |
| Palette | `Ctrl+K` · `↑/↓` · `↵` · `Esc` | ✅ deutsche Daten, `stichtag heute`, Formatfehler mit Beispiel, „swpt usd …“ |

---

## 6. Barrierefreiheits-Sweep (alle Views, 1440 + 1024, Dark + Light)

| Prüfung | Ergebnis |
|---|---|
| Unbenannte Inputs/Checkboxen/Buttons/Bilder/Dialoge/Composite-Rollen, doppelte IDs, positive Tabindizes | **0** in Blotter, 11 Editoren, Kurven, Markt (+FX-Fixings), Szenarien (+historisch), Report, Vergleich, Hedge (IRS + CAP, ungültiger Trade), 4 Dokumente (auch Kundenmodus), Palette, Hilfe, CSV-Fehlerdialog, Import-Kollisionsdialog |
| Überschriften | `h1` „DERIVA“ einmal, `h2` = View-Titel, `h3` Karten; Dokumente `h2`/`h3`; **0 Sprünge** in allen Views und Dialogen (R4-10 ✓) |
| Landmarks / Live-Region | `nav[aria-label=Hauptnavigation]`, `main#main`, Skip-Link erster Tabstopp, Toast-Stack `role=status` direkt danach (R4-F2 ✓), Offline-Chip mit `title` |
| Rollen / Roving | Blotter `grid`, Zeilen `row` + `aria-selected` + Roving-Tabindex; Heatmaps `grid/table`; Palette `listbox`; Kontextmenü `menu`, Fokus zurück zur Zeile; Export-Menü `menu/menuitem` |
| Kontrast | **812 Paare ≥ 4,5:1** (`allLow []`), inkl. neuer Elemente: Toast-Hinweis „(Ctrl+Z)“, Offline-Chip/-Status, Palette-Fehlervorschau, Vergleichstabelle, Inspector, `.btn:disabled` |
| Reste | Inspector-Zellen beschnitten ≤ 1360 px (R5-01); Zeilen-Checkboxen als Tabstopps (R5-02); `analytics-table`/`risk-table`/Inspector-Tabelle ohne Namen, „Vega swaption EUR“ (R5-04); FX-Vol-Tabs bei 1024 px unerreichbar (R5-05) |

---

## 7. Was für 100 noch fehlt

1. **R5-F2** Snapshot-Import: Bewertungstag übernehmen, Quotes-Rebuild-Pfade für importierte Märkte einfrieren, „modifiziert“ aus dem Markt statt aus den Quotes ableiten, Label aus der Snapshot-ID nehmen – ~2 h inkl. E2E.
2. **R5-F1** CSV: ungültige Daten als Zeilenfehler statt Default – ~20 min.
3. **R5-01** Inspector-Tabelle `table-layout:fixed`/Ellipsis oder 300 px Sidebar – ~15 min.
4. **R5-F4** Service Worker: Assets beim `install` vorladen (oder Doku präzisieren) – ~30 min.
5. **R5-02** Zeilen-Checkbox `tabIndex=-1` – ~10 min.
6. **R5-03** `atmStrike` für Cap/Floor im Core + Par-Solve, sonst Button deaktivieren – ~45 min.
7. **R5-04 / R5-05 / R5-06 / R5-07** Vega-Label + Tabellen-Namen, FX-Vol-Tabs umbrechen, Snapshot-Fehlertexte, Kundenmodus-Methodik im Report – ~1 h.
8. **R5-08 / R5-09 / R5-F3** Druck-Einheit, Onboarding-Beispiel, Hedge-Ergebnis persistieren – ~30 min.

Erwartete Wirkung bei Umsetzung 1–8: UI/UX & Hotkeys ≈ 99–100, User Flows ≈ 99–100.

---

## 8. Artefakte

Basis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r5-ui/`

- Skripte/Messwerte: `lib.mjs` (Helfer, Kontrast-/A11y-Audit), `run.mjs` (81 Checks: Landmarks, R4-02/03, Eingaben/Datums-Vorlagen/Quick-Entry, Kurven/ToY, Markt/Caplet/FX-Fixings, Report/Dokumente/Druck, Hedge/Druck/ungültiger Trade, Szenarien/Vergleich/11 Editoren, Light-Kontraste, Layouts 1440/1024, Hotkeys), `flows.mjs` (43 Checks: Offline Erst-/Zweitbesuch, Flows a–e, Persistenz, 213 Trades, Latenz), `verify.mjs` (20: Toast-Tabstopp, Tabstopps, Par-Solve, Kundenmodus, CSV-Daten, Snapshot-Roundtrip, Hedge frisch, Zahlenfelder, 1024-Clipping, Sonstiges), `probe2.mjs` (Inspector-Clipping 1024/1280, FX-Vol-Header, Snapshot vs. Quotes, Kundenmodus, Hedge-Defaults), `probe3.mjs` (Snapshot-Diff, Bewertungstag-Mismatch); `results-a/b/v/p2/p3.json`, `run.log`, `flows.log`, `verify.log`, `probe2.log`, `e2e.log`
- Downloads: `portfolio-report.json`, `portfolio-report-213.json`, `portfolio.json`, `portfolio-200.json`, `import.csv`, `import2.csv`, `import-fehler.csv`, `csv-date.csv`, `bad.json`, `wrong.json`, `snapshot.json`, `snap-a/b/c/d.json`, `s-orig/mod/reimp/after-date/date.json`, `badsnap*.json`, `report.json`, `hedge-doc.md`
- PDFs (Print-Emulation, je 3 Seiten): `report-print.pdf`, `doc-termsheet-print.pdf`, `doc-suitability-print.pdf`, `doc-confirmation-print.pdf`, `doc-kid-print.pdf`, `hedge-print.pdf`
- Dark 1440: `1440-dark-{blotter,pricing,curves,curves-toy-inactive,market,report,scenarios,compare,compare-whatif,hedge,hedge-invalid,palette,help,csv-errors,blotter-imported,blotter-213,customer-termsheet}.png`, `1440-dark-doc-{termsheet,suitability,confirmation,kid}.png`, `1440-caplet-card.png`
- Print: `1440-report-print.png`, `1440-print-doc-{termsheet,suitability,confirmation,kid}.png`, `1440-hedge-print.png`
- Light 1440: `1440-light-{blotter,pricing,curves,scenarios,market,report,kid,hedge,compare,help}.png`
- 1024×768: `1024-dark-{blotter,pricing,curves,scenarios,market,report,compare,hedge,palette,help,kid}.png`, `1024-light-{blotter,pricing,market}.png`, `1024-inspector.png`, `1024-fx-vol-card.png`, `1024-fx-fixings-card.png`, `1024-kpis.png`, `1024-curves-toolbar.png`
- Nachprüfungen: `offline-after-first-visit.png`, `offline-after-second-visit.png`, `v-collar-after-par.png`, `v-customer-report.png`, `v-hedge-fresh.png`, `p2-customer-report.png`
