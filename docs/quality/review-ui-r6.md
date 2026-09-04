# DERIVA – Review Runde 6: UI/UX & Hotkeys (Dim. 3) und User Flows (Dim. 4)

**Reviewer-Rolle:** Senior UX-Designer · Accessibility-Auditor · Trading-Desk-Power-User
**Datum:** 2026-09-04 · **Modus:** Re-Review only, keine Quellcode-Änderungen · **Baseline:** `review-ui-r5.md` (Runde 5: UI 96, Flows 97)

## 0. Prüfstand

| | |
|---|---|
| Repo-Stand | Branch `claude/derivatives-trading-platform-1arsyu`, HEAD `c031daf` („fix(core,api,web): Maßnahmenprogramm Runde 5 umgesetzt“). Web-Diff seit R5 (`77f2366`): 42 Dateien, +2.690/−253 – u. a. `views/lazy-views.ts` + `lib/lazy.ts` (React.lazy je View, `preload()`), `components/EChart.tsx` → `EChartImpl.tsx` (ECharts lazy), `components/ViewSkeleton.tsx`, `src/sw/sw.js` + `scripts/sw-precache-plugin.ts` (Precache aller Assets), `state/store.ts` (`marketSource`, `importSnapshot`, `leaveImport`, `changeValuationDate`), `lib/snapshot-import.ts`, `lib/trade-ops.ts` (`solveCapFloorStrike`), `lib/portfolio-io.ts` (`dateOf` mit Zeilenfehler), `views/Blotter.tsx` (Header-Roving, Checkbox `tabIndex=-1`), `components/Inspector.tsx`, `app.css` |
| Bundle | `vite build` frisch: `index-l2U-gW4E.js` 206 KB (66,6 KB gz), `core-DK0hCMlV.js` 250 KB (81 KB gz), `react-CwjULe8d.js` 196 KB (62 KB gz), `echarts-BUiUtRgo.js` 552 KB (183 KB gz, lazy), 7 View-Chunks 5–58 KB, `sw.js` 4,6 KB mit 15 Precache-Einträgen; `scripts/size-limit.mjs`: Initial-Load 211,7 KB gz, „Size budget OK“; `vite preview --port 4971 --strictPort` |
| Unit-/E2E-Tests | `npx vitest run` in `apps/web`: **29 Dateien, 273 Tests grün**; `E2E_PORT=4972 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/smoke.mjs`: **E2E OK (350 checks)** |
| Browser-Audit | Playwright + Chromium (`/opt/pw-browsers/chromium`), Locale `de-DE`, Clipboard-Rechte, Viewports **1440×900**, **1280×800**, **1024×768**, Dark + Light, Print-Emulation + `page.pdf()`, Offline (`context.setOffline`) in **frischen Browserkontexten** (nur ein Online-Aufruf), Netzdrosselung per CDP (1,5 Mbit/s, 250 ms) für Skeleton-Beobachtung, `page.route`-Abbruch eines View-Chunks (Deploy-Simulation). Skripte in `…/scratchpad/r6-ui/`: `run.mjs` (81 Checks, R5-Suite A), `flows.mjs` (43: Offline, 5 Flows, Persistenz, 213 Trades), `verify.mjs` (20), `probe2.mjs`/`probe3.mjs` (R5-Sonden), **neu:** `lazy.mjs` (9: Kaltstart, Drosselung, warme Chords, Chunk-Ausfall, Offline-Erstbesuch, Reduced Motion), `import.mjs` (17: Import-Randfälle, Header-Roving, Toast-Tabstopp, `Shift+P`-Varianten, Hedge-Persistenz, 1024/1280), `mini.mjs`/`mini2.mjs` (Nachprüfungen); Messwerte `results-a/b/v/p2/p3/l/i/m/m2.json`, 73 Screenshots, 6 PDFs, 39 JSON-Dateien. Rot gelaufene Checks wurden einzeln nachgeprüft; Sonden-Artefakte (Fokus-Startpunkt nach `blur()`, R5-Sonden ohne `data-testid="snapshot-import"`, Druckbreite gegen Viewport, `w == need` bei Selects, `.first().inputValue()`-Timeouts in der `Shift+P`-Zeitmessung, gelöschter Trade vor `openTrade`) sind aus den Befunden entfernt |
| Konsole | **Keine** JS-Fehler, keine Warnungen, keine fehlgeschlagenen Requests in allen Läufen (Ausnahme: der absichtlich abgebrochene Chunk in `lazy.mjs` §4) |
| Tastatur | Chords `o t/g/k/c/p/r`, `x c/b`, `y i`, `y y`, `g …`, `n …`; `Ctrl+Shift+T` inert; Tab-Sequenzen ab Skip-Link (Blotter, Pricing); Kopfzeile `←/→/Home/End/↵`; `Alt+↓`/▾ in Datumsfeldern; `Shift+P` auf IRS/FXF/SWPT/Cap/Floor/Collar/FXO/FRA; `Shift+K`, `Shift+T`, `d`, `Shift+D`, `Space`, `r`, `]`/`0`, `Alt+2` |

Screenshot-Verzeichnis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r6-ui/` (Übersicht Abschnitt 8).

---

## 1. Scores

### 1.1 UI/UX & Hotkeys: **98 / 100** (R1 62 → R2 88 → R3 91 → R4 95 → R5 96)

**Verifiziert behoben (Belege Abschnitt 2):** Inspector 300 px bei 1280 und 1024 px, **0 beschnittene und 0 abgeschnittene Zellen** (`insp1280/insp1024 {w 300, clipped 0, nTrunc 0}`); Vergleichs-Checkboxen `tabIndex=-1` (`cellStops 1` = die Zeile selbst, `checkboxStops 0`), Sortier-Header **ein** Tabstopp mit `←/→/Home/End`, `↵` sortiert und behält den Fokus, markierte Blotter-Zeile nach **34** statt 49 Tabs ab Skip-Link; `Shift+P` auf Cap → „ATM-Strike übernommen (Cap-Wert = Floor-Wert)“ (Strike 3,00 → 2,57 %), Floor ebenso, Collar → „Zero-Cost-Collar: Floor-Strike übernommen (Prämie 0)“ mit PV 48.973 → **2 EUR** (Floor 1,50 → 2,12 %), unlösbarer Collar → „Kein Zero-Cost-Floor-Strike für diesen Cap-Strike – Cap-Strike anheben oder Floor-Strike manuell setzen“, Button-Titel produktspezifisch; KPI „Vega Swaption EUR“, Inspector-/Analytics-/Risiko-Tabellen mit `aria-label` („Kennzahlen“, „Sensitivitäten (Vega, FX-Delta)“, „Preis-Analytics“, „Risiko (Bump)“), **0 unbenannte Tabellen** in allen Views; FX-Vol-Paar-Tabs in eigener umbrechender Zeile (10 Paare, 2 Zeilen, 0 außerhalb der Karte, alle per Maus treffbar, Klick auf „GBP/CHF“ → `aria-pressed`), Kostentransparenz-Karte ohne Überlauf bei 1024 px; Snapshot-Fehlertexte komplett deutsch („Datei ist kein DERIVA-Markt-Snapshot (Schema „fehlt“ unbekannt …)“, „Ungültiges Datum: 2026-13-45“ ohne Doppelpräfix, „Snapshot unvollständig – Feld „discountCurveId“, „curves“, „fxSpots“ fehlt“, „Kurve X: Diskontfaktor 1,5 am 03.09.2027 außerhalb (0, 1]“, „Datei ist kein gültiges JSON (Zeile 1, Spalte 2)“); Kundenmodus-Report ohne „= risikofrei − CVA + DVA“ (jetzt „inkl. Kontrahentenrisiko“), ohne Margenformel und XVA-Methode – das Wort „Marge“ steht nur noch in der BGH-Pflichtaufklärung („… dass der Kunde bei Abschluss eine Marge trägt“); Hedge-Druck: Ratio-Input 14 px breit, „%“ 3 px daneben; Onboarding-Beispiel `fxf eurusd -2m 1.1725 15.03.2027`. **Lazy Views:** warme Chords 17–143 ms ohne Skeleton, Kaltstart-Chord `g s` 413 ms, unter Drosselung Skeleton (2 Karten, `aria-busy`, `aria-live=polite`, „Ansicht wird geladen …“) ohne gleichzeitigen zweiten Platzhalter, `prefers-reduced-motion` respektiert. **Kontrast: alle 812 gemessenen Textpaare ≥ 4,5:1** (Dark + Light, 1440 und 1024). 0 unbenannte Steuerelemente in 8 Views, 11 Editoren, 4 Dokumenten, Palette, Hilfe; 0 Überschriftensprünge; keine Seite scrollt horizontal.

**Abzüge (kumuliert ≈ −2,1):**
- Niedrig −0,8: **Chunk-Ladefehler** (Deploy bei offener App, Netzabriss vor dem ersten Prefetch): Error Boundary zeigt den rohen Engine-Text „Failed to fetch dynamically imported module: http://localhost:4971/assets/ScenariosView-BVVvYVtY.js“, „Erneut versuchen“ und erneutes `g s` bleiben **dauerhaft** im Fehler, bis die Seite neu geladen wird (R6-01).
- Niedrig −0,3: Import-Modus: Quote-Inputs, Interpolations-Select und Turn-of-Year-„Anwenden“ bleiben **aktiv**, die Sperre kommt erst als Toast nach der Eingabe (×3 bei ↑↑↵), während „Quotes ±10 bp“ korrekt deaktiviert sind (R6-04).
- Kosmetisch −0,3: **Amortisationsplan-Tabelle** (`n a`): 10 Zeilen mit `tabIndex=0` + 10 Inputs = 20 Tabstopps, kein Roving (R4-03-Rest, R6-02).
- Kosmetisch −0,3: nach `Esc` aus einem per Chord geöffneten Dokument liegt der Fokus auf `body`, der nächste `Tab` startet am Skip-Link (R6-03).
- Kosmetisch −0,2: Snapshot-Fehlertext „Vol-Typ **undefined** unbekannt“ bei fehlendem `volType` (R6-05).
- Kosmetisch −0,2: CSV-Dialog „1 gültige Zeile importieren“ → Toast „0 Trades aus CSV importiert (1 ungültig)“: die Validierungsstufe (Ende vor Start) fehlt in der Zeilenliste (R6-06).

### 1.2 User Flows: **98 / 100** (R1 57 → R2 82 → R3 94 → R4 98 → R5 97)

- (a) **Indikation im Kundengespräch: sehr gut, vollständig per Tastatur** – `Ctrl+K` → `collar 7y 3,5/1,5 6m @Kunde GmbH` → `↵` in **348 ms** bis PV 48.973; **`Shift+P` → Zero-Cost-Collar, PV 2 EUR** (R5-03 ✓); `y i` „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · … · Prämie % Nominal 0,000 % · PV 2 EUR · DV01 2.050 EUR · Kontrahent Kunde GmbH · Stichtag 03.09.2026“; `g s` 462 ms, Heatmap `→ ↵` → What-if „Zinsen -200 bp / EUR +5 %“, `o t` unter What-if mit Stress-Banner; `o t` **395 ms**, Fokusfalle Markdown → Drucken → Schließen; `o k` (Haltedauer `↑` 7,79 → 8,29 J live), `o g` (Kunde eintragen → Geeignetheitserklärung), `o c`, `o r` (Hashes + Governance MaRisk), Nominal-Änderung → „geändert“; `Shift+K` → Report ohne CVA/DVA-Zerlegung und Margenformel (R5-07 ✓). Reibung: Fokus nach `Esc` aus dem Dokument auf `body` (R6-03, Dim. 3).
- (b) **Treasurer: CSV-Import → Fehler beheben → Portfolio bewerten: sehr gut** – Dialog „CSV-Import: 4 Zeilen übersprungen“ mit **„Ungültiges Datum „31.02.2026“ in Spalte „start“ (Start) – erwartet TT.MM.JJJJ, JJJJ-MM-TT oder Tenor (z. B. 5Y); unmögliche Daten wie 31.02. werden nicht übernommen“** (R5-F1 ✓, auch `2026-02-30`), „Nominal fehlt oder ≤ 0“, „Kauf-/Verkaufswährung fehlt“, „Unbekannter Typ „XYZ“ …“; Fehlerliste als CSV; ID-Kollision → Überspringen/Ersetzen/Umbenennen, „2 Trades aus CSV importiert (1 ersetzt)“; 16 Trades, 0 Fehler-Badges, `o p` → `portfolio-report-2026-09-03.json`; kaputtes/leeres JSON → deutsche Toasts; `Ctrl+Z` ×2 nimmt beide Importe zurück. Kosmetisch: R6-06 (Dim. 3).
- (c) **Prüfer: Marktdaten → What-if → Vergleich → Snapshot-Reproduktion: sehr gut mit einer Lücke** – Quote `↑↑↵` → „modifiziert“, PV −278.344 → −278.332; `]` in **41 ms** → −203.855; Vergleich zweier Trades unter What-if; `Ctrl+Z` „Rückgängig: Quote OIS 1W 2,0150 → 2,0200 %“. **Snapshot:** Export → Quote ändern → Import derselben Datei → **Snapshot-ID `ab8dc0c6c16fc395` identisch**, Report-Hash `4a5aac0f8a0e3c7b` identisch, Chip „Sample EoD · importiert · 03.09.2026“ ohne „modifiziert“, Markt-Karte zeigt die ID, Kurven-View sperrt Quotes mit Hinweis, Stichtagswechsel fragt („Der Markt stammt aus dem importierten Snapshot … Fortfahren?“ – Ablehnen: „Bewertungstag unverändert – Snapshot „Sample EoD“ bleibt geladen“, Bestätigen: „Snapshot „Sample EoD“ verworfen – Sample-Markt aus den Quotes zum 04.09.2026 aufgebaut“), Snapshot mit Bewertungstag 30.10.2026 → Toast „… Bewertungstag auf 30.10.2026 gesetzt“, Statusleiste/Chip/Report-Kopf **30.10.2026**, Import überlebt den Reload (R5-F2 ✓). **Reibung −1,5:** ein **FX-Spot-Edit im Import-Modus** (EUR/USD 1,1625 → 1,25) wird bewertet (FXF-0001 PV 2.769 → −135.902) und **ändert die Snapshot-ID still** (`ab8dc…` → `54aec…`, Report-Label weiter „Sample EoD“ ohne „modifiziert“), ist **nicht rückgängig** („Nichts rückgängig zu machen“), landet im Export (`fxSpots.EURUSD = 1.25`) und ist **nach dem Reload weg** (1,1625, ID `ab8dc…`) – der Prüfer hat einen Report-Hash zu einem Markt, den niemand reproduzieren kann (R6-F1). **Reibung −0,5:** der Import setzt eine vorherige Vol-Änderung (Caplet 62 → 99) und den Undo-Stack ohne Hinweis zurück; weder der Import noch das Verwerfen nach Stichtagswechsel sind rückgängig (R6-F2).
- (d) **Hedge Accounting: sehr gut** – `Effektivität testen` per `↵` → „✗ nicht effektiv“ mit Herleitung (Dollar-Offset, Off-Market-Hinweis IFRS 9 B6.5.5), Regression ✓, Critical Terms 5/5; Hedge Ratio `↓` → Veraltet-Badge, Markdown „ERGEBNIS VERALTET“ ohne ISO-Daten; „Zurücksetzen“ fragt, Toast-Undo per Tastatur; Druck 3 Seiten, Einheit am Wert (R5-08 ✓); CAP mit innerem Wert + eingefrorener Vol → CoH-Karte, „✓ effektiv“. Kosmetisch −0,2: nach Reload bleibt die Dokumentation (Ratio 100), das Testergebnis fehlt bis zum erneuten Test (R5-F3 offen).
- (e) **Offline / Persistenz: sehr gut** – **frischer Browser, ein Online-Aufruf**: Cache `deriva-shell-1436f98381df` mit `/`, `/index.html` und **15 Assets**, Offline-Reload rendert die App mit Chip „⚠ offline – lokaler Bestand“, **alle 7 Lazy-Views inkl. Diagramme** öffnen offline (R5-F4 ✓); Theme, View, Bewertungstag 30.10.2026 und Feldänderung überleben den Reload („Bestand aus lokalem Speicher geladen (14 Trades) · Zurücksetzen“).
- Performance (213 Trades): Import 283 ms, Bewertung 12,9 ms, `j`×10 398 ms, Sortierung 132 ms, Palette 111 ms (68 Treffer), `]` 172 ms, Szenarien 1,07 s, Portfolio-Report 532 ms, Hedge-View 481 ms, Reload 1,01 s (R5 573 ms – Pricing-View persistiert und wird nachgeladen), Heap 20 MB, localStorage 118 KB; Einzeltrade: Feldänderung → PV 82 ms, Kurven 415 ms, Markt 397 ms, Report 381 ms. Kaltstart: Shell 305 ms, `g s` sofort nach dem Laden 413 ms (Skeleton kurz sichtbar), Pricing per `↵` 150 ms; unter Drosselung (1,5 Mbit/s, 250 ms) `g s` 941 ms mit Skeleton, danach Kurven 303 / Markt 219 / Hedge 187 / Report 166 ms ohne Skeleton (Idle-Prefetch).

---

## 2. Status der Runde-5-Befunde

Legende: ✅ behoben · 🔶 teilweise · ❌ offen. Belege = Feld in `results-a.json` (`run.mjs`), `results-b.json` (`flows.mjs`), `results-v.json` (`verify.mjs`), `results-l.json` (`lazy.mjs`), `results-i.json` (`import.mjs`), `results-m/m2.json` (`mini*.mjs`) oder Screenshot.

| # | Titel (R5) | Status | Beleg / Rest |
|---|---|---|---|
| R5-01 | Inspector-Tabelle bei ≤ 1360 px beschnitten | ✅ | `app.css` `--inspector-w: 300px`, `table.grid-table.kv {table-layout: fixed}`, `td.num {width 48 %; text-overflow: ellipsis}`, `title` auf Wertzellen; `insp1280/insp1024 {w 300, clipped 0, nTrunc 0}`, `p2.insp1024 {inspW 300, tableW 279}`; `i-inspector-1024.png` zeigt „Fälligkeit 17.06.2034“, „Par-Satz 2,7638 %“ vollständig |
| R5-02 | Zeilen-Checkboxen als Tabstopps | ✅ | `Blotter.tsx` `tabIndex={-1}` auf `.compare-check`, `headerKeyNav` + Roving in `<thead>`; `blotterStops {rowStops 1, cellStops 1, thStops 1}`, `tabsToRow 34, checkboxStops 0` (R5: 49/8), `hdr {stops ["ID ▲"], sortedBy "TYP ▲", stopsAfterSort ["TYP ▲"], tabAfter TR.selected}`, `Space` markiert (E2E) |
| R5-03 | `Shift+P` für Cap/Floor/Collar | ✅ | `trade-ops.ts` `solveCapFloorStrike` (Bisektion auf `priceTrade`), `parSolveLabel/Title/Unavailable`; `par.cap {3 → 2,57, „ATM-Strike übernommen (Cap-Wert = Floor-Wert)“}`, `par.floor {2 → 2,57}`, `par.collar {PV 48.973 → 2, Floor 1,5 → 2,12, „Zero-Cost-Collar …“}`, `par.collarLow` „Kein Zero-Cost-Floor-Strike …“, `par.fxo` „ATM-Forward-Strike übernommen“, `par.fra` PV → 0, Undo „Rückgängig: Änderung FRA-0002“; Button-Titel je Produkt, deaktiviert ohne Bewertung |
| R5-04 | „Vega swaption EUR“, Tabellen ohne Namen | ✅ | `PricingWorkspace.tsx` `bucketLabel(k)`, `AnalyticsTable label`, `aria-label="Risiko (Bump)"`; `vega {kpi [], tables []}`, `vegaLabels ["Vega Swaption EUR …"]`, `inspectorTables [{label „Sensitivitäten (Vega, FX-Delta)“}, {inspector-analytics, label „Kennzahlen“}]`, `tablesNoHeader []` in allen Views/Editoren |
| R5-05 | 1024 px: FX-Vol-Tabs außerhalb, Kostentransparenz-Überlauf | ✅ | `MarketView.tsx` `.seg.wrap` `data-testid="fx-vol-pairs"` unter dem Titel, `app.css` `.seg.wrap {flex-wrap: wrap}`; `fxTabs {n 10, outside 0, hits 10× true, rows 2, lastPressed "true"}` (`m-fx-vol-1024.png`), `clipReport1024 []`, `clip1024 []`, `overflow1024` alle Views `page/main true` |
| R5-06 | Snapshot-Import-Fehlertexte englisch/roh | ✅ | `lib/snapshot-import.ts` `readSnapshotJson`/`snapshotErrorText`, `i18n.ts` Regeln + Präfix-Dedupe; `bad {noschema „… Schema „fehlt“ unbekannt, erwartet deriva.market/1 …“, baddate „Ungültiges Datum: 2026-13-45“, baddf „Kurve X: Diskontfaktor 1,5 am 03.09.2027 außerhalb (0, 1] (+1 weitere)“, missing „Snapshot unvollständig – Feld „discountCurveId“, „curves“, „fxSpots“ fehlt“, notjson „… kein gültiges JSON (Zeile 1, Spalte 2) …“}`, Markt bleibt unverändert. **Rest → R6-05:** „Vol-Typ undefined unbekannt“ |
| R5-07 | Kundenmodus im Report mit CVA/DVA- und Margenformel | ✅ | `ReportView.tsx` `customer ? "inkl. Kontrahentenrisiko"`, `customerCostRule`, `INTERNAL_ROW`-Filter auf Methodik/Rationale, XVA-Methode/Hazard nur intern; `custReport.lines` = Fair-Value-Karte + BGH-Aufklärung (einziger „Marge“-Treffer: „… dass der Kunde bei Abschluss eine Marge trägt (BGH XI ZR 33/10 …)“), `custPricing []`, `custCompare []`, `p2.cust.costTable` ohne interne Zeilen |
| R5-08 | Hedge-Druck: „50“ und „%“ 50 px auseinander | ✅ | `app.css` Print `.input-unit input {width: auto !important; max-width: 10ch; min-width: 2ch; field-sizing: content}`; `hedgePrint.ratio {w 14}`, `unitGap 3`, `hedge-print.pdf` 3 Seiten (`1440-hedge-print.png`) |
| R5-09 | Onboarding-Beispiel mit ISO-Datum | ✅ | `Blotter.tsx` `ONBOARDING_EXAMPLES` aus `QUICK_ENTRY_EXAMPLES`; `onboarding` „⚡ fxf eurusd -2m 1.1725 15.03.2027“ |
| R5-F1 | CSV: unmögliche Daten still durch Default ersetzt | ✅ | `portfolio-io.ts` `dateOf(s, base, column)` wirft `invalidDateMessage`; `csvDate.rows` Zeile 2 `31.02.2026` und Zeile 3 `2026-02-30` mit Spalte, Label und Formathinweis, `IRS-D1/IRS-D2` „not imported“, E2E 4 Checks. **Rest → R6-06:** Validierungsfehler (Ende vor Start) nicht im Dialog |
| R5-F2 | Snapshot-Import nicht reproduzierbar (ID, Tabelle, Stichtag) | ✅ | `store.ts` `marketSource`, `importSnapshot`, `setValuationDate({discardImport})`, `changeValuationDate`, `leaveImport`, Hydration aus `importedSnapshot`; `ReportView` hasht kein UI-Label mehr; `imp {id = id0, chip „… importiert …“}`, `f5 {a1 = a3, Report-JSON-Hash identisch}`, `dateDecline`/`dateAccept` (Dialog + Toasts), `dateImp {status/chip/reportHead 30.10.2026, audit enthält ID, afterReload identisch}`, `lock {q1 = q0, bumpDisabled true}`. **Rest → R6-F1/R6-F2/R6-04:** Spot-Edit im Import-Modus, verworfene Vol-Änderungen/Undo, aktive Quote-/ToY-Controls |
| R5-F3 | Hedge-Ergebnis nach Reload weg | ❌ | `HedgeView.tsx:380` `setReport` nur im Komponentenstate; `hp.after {verdict 0, ratio 100, btn „Effektivität testen“}`, `f4.persisted {ratio 100, verdict 0}` – nicht im Maßnahmenprogramm, bleibt kosmetisch |
| R5-F4 | Offline erst nach dem zweiten Besuch | ✅ | `scripts/sw-precache-plugin.ts` + `src/sw/sw.js` (`cache.addAll([...SHELL, ...PRECACHE])`, `ignoreVary`); Erstbesuch: `off1 {cacheKeys 17 Einträge, hasApp 1, chip „⚠ offline – lokaler Bestand“}`, `off.views` alle 7 Lazy-Views offline ohne Alert/Skeleton/Chart-Platzhalter (`l-offline-first-scenarios.png`); Doku `03-ui-konzept…:53` und US-8.13 stimmen jetzt |

Zusätzlich verifiziert (kein R5-Befund): FX-Fixings-Editor flaggt „modifiziert“ (`fxf.chip`), Toast-Stack direkt nach dem Skip-Link (`afterSkipTab` = „Rückgängig (Ctrl+Z)“, `↵` stellt IRS-0001 wieder her, `afterUndo 13`), Palette `stichtag heute`, Datums-Vorlagen ohne Commit, Vergleichs-Leerzustand, Export-Menü-Tastatur, Kontextmenü-Fokusrückgabe, Toast-Deduplizierung „×2“.

---

## 3. Neue Befunde (Runde 6)

Schweregrade wie in R1–R5. Reproduktion gegen das Preview-Bundle; Belege in `results-*.json` (Feldname) bzw. Screenshot.

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R6-01 | Niedrig (Robustheit/Fehlertext) | `lib/lazy.ts:19-27` (`lazy(() => loader())` ohne `catch`, React cached die Ablehnung), `components/ErrorBoundary.tsx:30` (`error.message` roh) | Fällt der Chunk-Load aus (Deploy mit neuen Hashes bei offener App, Netzabriss vor dem Prefetch), zeigt die View „FEHLER IN SZENARIEN – **Failed to fetch dynamically imported module: http://…/assets/ScenariosView-BVVvYVtY.js**“ (englisch, URL); „Erneut versuchen“ und erneutes `g s` bleiben **dauerhaft** im Fehler, auch wenn das Netz wieder da ist (`fail {alert …, afterRetry.table 0, secondTry.table 0}`, `l-chunk-failure.png`); andere Views laufen weiter. Im Produktivbetrieb löscht der neue Service Worker beim `activate` den alten Cache – genau dann fehlen der offenen Seite die alten Chunks. | `lazyComponent`: Loader-Fehler fangen, Lazy-Instanz bei Retry neu erzeugen (`lazy(() => loader().catch(retryOnce))`) und im Fallback deutsch erklären: „Ansicht konnte nicht geladen werden – vermutlich liegt eine neue Version vor. Seite neu laden“ mit Button `location.reload()`; ErrorBoundary: `TypeError` mit „dynamically imported module“ auf denselben Text mappen; SW: `activate` alte Caches erst nach `clients.claim` + Nachricht „Neue Version – neu laden“ löschen. |
| R6-02 | Kosmetisch (Tastatur) | `components/TradeEditor.tsx:582` `<tr … tabIndex={0}>` im Amortisationsplan | Editor `n a`: 10 Perioden-Zeilen mit `tabIndex=0` **und** 10 Nominal-Inputs = 20 Tabstopps in einem Formular (`amort {rows 10, rowStops 10, inputStops 10, roleRows 0}`); der Rest der App folgt seit R4-03 dem Roving-Muster (ein Stopp je Tabelle). | `useTableNav` + `rowProps(i, n)` wie in Blotter/Cashflows; Inputs `tabIndex=-1`, `↵`/`F2` auf der Zeile fokussiert den Input. |
| R6-03 | Kosmetisch (Fokus) | `components/Modal.tsx` `useFocusTrap` (`prev = document.activeElement`), `App.tsx:371` `setDoc` nach View-Wechsel | `o t` aus einer fokussierten Blotter-Zeile wechselt zur Report-View und öffnet das Termsheet; nach `Esc` liegt der Fokus auf **`body`**, der nächste `Tab` landet am Skip-Link (`ot {before TR.selected, after BODY, tabAfter A.skip}`, auch aus dem Pricing `focusAfterOt BODY`). Der Power-User verliert die Position im Workspace. | Wenn `prev` nicht mehr im DOM ist oder `body`: Fokus auf `main#main` (hat bereits `tabIndex=-1`) oder auf den „Termsheet“-Button der Report-View setzen. |
| R6-04 | Niedrig (Affordance) | `views/CurvesView.tsx` (Quote-`NumInput`s, `select[aria-label="Interpolationsmethode"]`, `toy-apply` nicht `disabled`), `store.ts setTurnOfYear/setInterpolation` liefern nur `false` | Im Import-Modus sind „Quotes ±10 bp“ korrekt deaktiviert, aber Quote-Zellen (`disabled false`), Interpolations-Select (`disabled false`) und „Turn-of-Year anwenden“ (`applyDisabled false`, Titel „… (Bootstrap)“) bleiben bedienbar; erst nach der Eingabe kommt der Toast „Kurven stammen aus dem importierten Snapshot …“ – bei `↑↑↵` dreimal (`lock.toast „…×3“`, `interp`, `toy`). | Controls im Import-Modus `disabled` + `title={IMPORT_LOCK}` (wie die Bump-Buttons), Quote-Tabelle read-only mit Hinweiszeile; Toast nur einmal je Fokus-Sitzung. |
| R6-05 | Kosmetisch (Fehlertext) | `lib/i18n.ts` Regel `volType: unknown vol type (.+)` / `translateVolProblem` | Snapshot mit Swaption-Cube ohne `volType`: „Vol-Fläche strukturell ungültig – … Swaption-Cube EUR: **Vol-Typ undefined unbekannt** (erlaubt Normal, Lognormal, ShiftedLognormal) …“ (`bad.badvol`) – ein rohes `undefined` im Nutzertext. | `m[2] === "undefined" ? "fehlt" : m[2]` (analog zur Schema-Regel), Test in `i18n.test.ts`. |
| R6-06 | Kosmetisch (Konsistenz) | `views/Blotter.tsx` CSV-Fehlerdialog zählt nur Parser-Fehler; `validateTrade` läuft erst beim Import | Dialog „3 Zeilen übersprungen“ + Button „**1 gültige Zeile** importieren“, danach Toast „**0 Trades** aus CSV importiert (1 ungültig)“ ohne Rückgängig (`csvDate {btn, toasts}`): die Zeile „Ende vor Start“ (`IRS-D4`) ist weder im Dialog gelistet noch benannt. | Im Vorlauf `validateTrade` auf jede geparste Zeile anwenden und Validierungsfehler („Enddatum muss nach dem Startdatum liegen“) als Zeilenfehler in denselben Dialog aufnehmen; Button zeigt dann die tatsächlich importierbare Zahl. |

### Flow-Befunde

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R6-F1 | **Mittel** (Reproduzierbarkeit/Persistenz) | `views/MarketView.tsx:858-861` `setSpot` → `setQuotes` liefert im Import-Modus `false` → Fallback `act().setMarket({...m, fxSpots})`; `store.ts marketModified` zählt im Import-Modus nur `volSurfaces`; `rebuildMarket`/Hydration starten von `importedBase` | Snapshot importieren → FX-Spot EUR/USD 1,1625 → **1,25** `↵`: Wert wird übernommen und bewertet (FXF-0001 PV 2.769 → −135.902), **Snapshot-ID wechselt still** `ab8dc0c6c16fc395` → `54aec43ab0c7e2a0`, Chip bleibt „Sample EoD · importiert“ **ohne „modifiziert“**, kein Reset-Button, **kein Undo** („Nichts rückgängig zu machen“), der Report trägt Label „Sample EoD“ mit der neuen ID; der Export enthält `fxSpots.EURUSD = 1.25`; nach **Reload ist der Spot weg** (1,1625, ID `ab8dc…`, FXF-PV 2.769) (`spotEdit`, `spot {id0, id1, chip, exportedSpot, afterReload}`). Der Prüfer-Flow „Report-Hash reproduzieren“ bricht genau an der Stelle, die R5-F2 schließen sollte. | Entweder Spots im Import-Modus sperren (wie Quotes, R6-04) **oder** sauber als Override modellieren: `importedOverrides.fxSpots` im Store (persistiert, Undo-Eintrag `kind: "market"`), `marketModified` im Import-Modus = Vol- **oder** Spot-Override, Chip/Report-Label „· modifiziert“, „Zurücksetzen“ auf den Snapshot; E2E: Import → Spot ändern → Reload → Spot erhalten und ID unverändert gegenüber vor dem Reload. |
| R6-F2 | Niedrig (Undo/Transparenz) | `store.ts importSnapshot` (`volSurfaces: {}`, `undoStack: undoWithoutMarketEntries()`), `setValuationDate({discardImport})`, `leaveImport` – kein Undo-Eintrag | Caplet-Vol 62 → 99 („modifiziert“), dann Snapshot importieren: Vol steht auf 62, Toast nennt nur „Snapshot „Sample EoD“ importiert · ID …“, `Ctrl+Z` → „Nichts rückgängig zu machen“ (`volImp`); ebenso nach „Snapshot verworfen“ per Stichtagswechsel (`dateAccept.undoToast`) und „Zum Sample-Markt“ (`volImp.afterLeave` verliert die unter Import gemachte Vol-Änderung 77). Das Hotkey-Label verspricht „Rückgängig (Trades, Quotes, **Markt**, Hedge)“. | Undo-Eintrag `kind: "marketSource"` mit vorherigem `{marketSource, importedSnapshot, quotes, interpolation, turnOfYear, volSurfaces, fxFixings, valuationDate}` für Import/Verwerfen/Verlassen; Import-Toast mit Zusatz „(1 Vol-Änderung verworfen)“ bzw. Rückfrage, wenn `marketModified` vor dem Import wahr ist. |

---

## 4. User Journeys (Schritt für Schritt, tastaturgeführt)

### (a) Berater bewertet Collar → Termsheet/KID/Erklärung → Report
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `Ctrl+K` · `collar 7y 3,5/1,5 6m @Kunde GmbH` · `↵` | **348 ms** bis PV 48.973; Kontrahent „Kunde GmbH“; Par-Risk, Vega-Buckets, Key-Rate, Analytics | – |
| `Shift+P` | „Zero-Cost-Collar: Floor-Strike übernommen (Prämie 0)“, Floor 1,50 → 2,12 %, **PV 2 EUR**, Rückgängig im Toast | – (R5-03 ✓) |
| `y i` | „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · … · Prämie % Nominal 0,000 % · PV 2 EUR · … · Stichtag 03.09.2026“ | – |
| `g s` · Heatmap `→ ↵` · `o t` | Szenarien 462 ms; What-if „Zinsen -200 bp / EUR +5 %“; Termsheet mit Stress-Banner | – |
| `0` · `o t` · `Tab`×3 · `Esc` | Termsheet **395 ms**, Markdown → Drucken → Schließen, `Esc` schließt | Fokus danach auf `body` (R6-03) |
| `o k` · `↑` · `o g` · Kunde · Erzeugen · `o c` | KID live 7,79 → 8,29 J; Geeignetheitserklärung § 64 Abs. 4 WpHG; Confirmation-Formular | – |
| `o r` · Nominal ändern · `g r` | Snapshot `ab8dc0c6c16fc395`, Report-Hash, Governance MaRisk; „geändert“-Badge | – |
| `Shift+K` | „◉ KUNDENANSICHT“: Blotter ohne DV01/Kontrahent, Pricing ohne XVA, Report „inkl. Kontrahentenrisiko“, keine Margenformel/XVA-Methode | – (R5-07 ✓) |

### (b) Treasurer: CSV-Import → Fehler beheben → Portfolio bewerten
| Schritt | Beobachtung | Reibung |
|---|---|---|
| Export ▾ → CSV importieren (5 Zeilen, 4 defekt) | Dialog „4 Zeilen übersprungen“ inkl. **„Ungültiges Datum „31.02.2026“ in Spalte „start“ …“**, Fehler-CSV, „1 gültige Zeile importieren“, Toast mit Rückgängig | – (R5-F1 ✓) |
| Datei mit `31.02.2026`, `2026-02-30`, Festsatz „abc“, Ende vor Start | 3 Zeilenfehler gelistet, „1 gültige Zeile importieren“ → „0 Trades importiert (1 ungültig)“ | R6-06 |
| korrigierte Datei (eine ID existiert) | Überspringen / Ersetzen / Umbenennen; „2 Trades aus CSV importiert (1 ersetzt)“ | – |
| Blotter · `o p` | 16 Trades, 0 Fehler-Badges, PV −122.140; `portfolio-report-2026-09-03.json` | – |
| kaputtes JSON / JSON ohne Trades · `Ctrl+Z` ×2 | deutsche Toasts mit Handlungshinweis; beide Importe zurück | – |

### (c) Prüfer: Marktdaten → What-if → Vergleich → Snapshot
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g c` · Quote `↑↑↵` · `]` | „modifiziert“, PV −278.344 → −278.332; `]` 41 ms → −203.855 | – |
| `g b` · `Space` · `j` · `Space` · `g v` · `0` · `Ctrl+Z` | Vergleich unter What-if; „Rückgängig: Quote OIS 1W 2,0150 → 2,0200 %“ | – |
| `g m` · Export · Quote ändern · Import derselben Datei · `o r` | **ID `ab8dc0c6c16fc395` identisch**, Hash identisch, Chip „importiert“, Kurven-View gesperrt mit Hinweis | – (R5-F2 ✓) |
| `Shift+T` · `04.09.2026` `↵` · Abbrechen / Palette `stichtag 04.09.2026` · OK | „Bewertungstag unverändert – Snapshot bleibt geladen“ / „Snapshot verworfen – Sample-Markt … 04.09.2026“ | Verwerfen nicht rückgängig (R6-F2) |
| Snapshot mit Bewertungstag 30.10.2026 · Reload | Statusleiste/Chip/Report **30.10.2026**, ID im Report = Markt-Karte, Import überlebt Reload | – |
| Import · FX-Spot EUR/USD → 1,25 · `o r` · Reload | PV bewertet, ID wechselt still, kein „modifiziert“, kein Undo, nach Reload 1,1625 | **R6-F1** |
| Quote-Zelle / Interpolation / ToY im Import-Modus | bedienbar, Toast „Kurven stammen aus dem importierten Snapshot …“ (×3) | R6-04 |
| ungültige Snapshots (6 Dateien) | alle deutsch mit Ursache; Markt unverändert | „Vol-Typ undefined“ (R6-05) |

### (d) Hedge Accounting
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g h` · `Effektivität testen` `↵` | „✗ nicht effektiv“, Dollar-Offset/Regression/Critical Terms, Off-Market-Hinweis | – |
| Hedge Ratio `↓` `Tab` · Markdown | Veraltet-Badge, „ERGEBNIS VERALTET“, deutsche Überschriften | – |
| „Zurücksetzen“ `↵` · Skip-Link `Tab` `↵` | Rückfrage; Undo per Tastatur (bei einem Toast erster Stopp, bei mehreren Toasts hinter deren ✕) | – |
| Reload | Dokumentation da, Ergebnis fehlt | R5-F3 |
| ⎙ Drucken | 3 Seiten, Selects vollständig, „50 %“ zusammen | – (R5-08 ✓) |
| CAP · Innerer Wert · Vol einfrieren | CoH-Karte, „✓ effektiv“ | – |

### (e) Offline / Lazy Views
| Schritt | Beobachtung | Reibung |
|---|---|---|
| frischer Browser, **ein** Aufruf, offline, Reload | App mit 13 Trades, Chip „⚠ offline – lokaler Bestand“, alle 7 Views + Diagramme | – (R5-F4 ✓) |
| Kaltstart · `g s` sofort | 413 ms, Skeleton kurz (2 Karten), dann Tabelle + Heatmap; Idle-Prefetch lädt alle Chunks in < 1 s | – |
| gedrosselt (1,5 Mbit/s) · `g s` | 941 ms mit Skeleton „Ansicht wird geladen …“, ein Chart-Platzhalter nach Ankunft der View, kein Doppel-Spinner | – |
| warm · `g p/c/s/m/r/v/h/b` · `Alt+2` | 17–143 ms, 0 Skeletons | – |
| View-Chunk 404 (Deploy-Simulation) · `g s` · „Erneut versuchen“ | englischer Rohtext, kein Recovery bis Reload | **R6-01** |

---

## 5. Hotkey-Matrix (verifiziert)

| Aktion | Tasten | Ergebnis |
|---|---|---|
| Termsheet / Erklärung / KID / Confirmation / Portfolio-Report / Report | `o t` / `o g` / `o k` / `o c` / `o p` / `o r` | ✅ (Termsheet 395–415 ms); Fokus nach `Esc` auf `body` (R6-03) |
| Indikation / Zeile kopieren | `y i` / `y y` | ✅ auch auf der fokussierten Zeile; `y j` bricht den Chord ab |
| Cashflows / Blotter CSV | `Ctrl+E` oder `x c` / `x b` | ✅ (Smoke) |
| What-if ±10 bp / Reset | `]` `[` `\` · `+` `-` `0` | ✅ (41–172 ms), auch im Import-Modus |
| Par-Satz / fairer Preis | `Shift+P` | ✅ IRS (PV → 0), FXF (→ 0), SWPT (ATM), **Cap/Floor (ATM-Strike), Collar (Zero-Cost, PV 2 EUR)**, FXO (ATM-Forward), FRA (→ 0); unlösbarer Collar mit Handlungshinweis |
| Kundenmodus / Stichtag / Theme / Inspector | `Shift+K` / `Shift+T` / `t` / `i` | ✅ (Stichtag-Popover: Fokus im Feld, `Esc` → Chip; Import-Modus fragt vor dem Verwerfen) |
| Duplizieren / Löschen / Vergleich / Neu bewerten | `d` / `Shift+D` / `Space` / `r` | ✅ (Toasts mit Rückgängig, „×2“-Dedupe) |
| `Esc` in Popovern/Modalen/Chord | – | ✅ Fokus-Rückgabe bei Export ▾, Filter, Stichtag, Kontextmenü; Chord-Indikator verschwindet |
| Tabellen | `↑/↓` `Home/End` `PgUp/PgDn` `Tab` | ✅ ein Zeilen-Tabstopp je Tabelle inkl. Kopfzeile (`←/→` Spalten) und Checkboxen; Rest: Amortisationsplan (R6-02) |
| Toast-Aktion | `Tab` ab Skip-Link · `↵` | ✅ erster Stopp „Rückgängig (Ctrl+Z)“ |
| Palette | `Ctrl+K` · `↑/↓` · `↵` · `Esc` | ✅ deutsche Daten, `stichtag heute`, Formatfehler mit Beispiel, `fxo`-Warnung nur ohne Fläche |
| Ansichten | `g …` · `Alt+1…8` · Rail | ✅ `g` prefetcht, Rail-Hover/-Fokus prefetcht, `Alt+2` 41 ms |

---

## 6. Barrierefreiheits-Sweep (alle Views, 1440 + 1024, Dark + Light)

| Prüfung | Ergebnis |
|---|---|
| Unbenannte Inputs/Checkboxen/Buttons/Bilder/Dialoge/Composite-Rollen, doppelte IDs, positive Tabindizes | **0** in Blotter, 11 Editoren, Kurven (auch Import-Modus), Markt, Szenarien (+historisch), Report, Vergleich, Hedge (IRS + CAP, ungültiger Trade), 4 Dokumente (auch Kundenmodus), Palette, Hilfe, CSV-Fehlerdialog, Import-Kollisionsdialog |
| Tabellen ohne Namen | **0** (R5-04 ✓ – Inspector „Kennzahlen“/„Sensitivitäten“, Pricing „Preis-Analytics“/„Risiko (Bump)“) |
| Überschriften | `h1` „DERIVA“ einmal, `h2` = View-Titel, `h3` Karten; Dokumente `h2`/`h3`; **0 Sprünge** |
| Landmarks / Live-Region | `nav[aria-label=Hauptnavigation]`, `main#main` (`tabIndex=-1`), Skip-Link erster Tabstopp, Toast-Stack `role=status` direkt danach; Skeleton `aria-busy` + `aria-live=polite` |
| Rollen / Roving | Blotter `grid`, Zeilen `row` + `aria-selected`, Kopfzeile ein Stopp mit `←/→`; Heatmaps `grid/table`; Palette `listbox`; Kontextmenü `menu` |
| Kontrast | **812 Paare ≥ 4,5:1** (`allLow []`), inkl. Skeleton-Text, Import-Badge „importiert“, Import-Hinweise |
| Bewegung | Skeleton-Puls unter `prefers-reduced-motion: reduce` aus (`skelCss.anim none`) |
| Reste | Amortisationsplan 20 Tabstopps (R6-02); Fokus nach Dokument-`Esc` auf `body` (R6-03); aktive, aber gesperrte Controls im Import-Modus (R6-04); Chunk-Fehlertext englisch (R6-01) |

---

## 7. Was für 100 noch fehlt

1. **R6-F1** Spot-Override im Import-Modus: sperren oder als persistierter, rückgängiger, geflaggter Override modellieren (Chip/Report „modifiziert“, Reset) – ~1 h inkl. E2E.
2. **R6-01** Lazy-Loader mit Retry + deutschem Fallback („Neue Version – Seite neu laden“), ErrorBoundary-Mapping für Chunk-Fehler – ~45 min.
3. **R6-F2** Undo-Eintrag für Snapshot-Import/-Verwerfen/-Verlassen, Hinweis auf verworfene Vol-Änderungen – ~45 min.
4. **R6-04** Quote-Zellen, Interpolation und Turn-of-Year im Import-Modus deaktivieren (`disabled` + `title`) – ~15 min.
5. **R6-02** Amortisationsplan auf `useTableNav`/Roving umstellen – ~20 min.
6. **R6-03** Fokus nach Dokument-`Esc` auf `main#main` bzw. den Termsheet-Button – ~10 min.
7. **R6-05 / R6-06 / R5-F3** „Vol-Typ fehlt“, Validierungsfehler im CSV-Dialog, Hedge-Ergebnis mit `stale`-Flag persistieren – ~45 min.

Erwartete Wirkung bei Umsetzung 1–7: UI/UX & Hotkeys ≈ 100, User Flows ≈ 100.

---

## 8. Artefakte

Basis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r6-ui/`

- Skripte/Messwerte: `lib.mjs` (Helfer, Kontrast-/A11y-Audit), `run.mjs` (81 Checks), `flows.mjs` (43), `verify.mjs` (20), `probe2.mjs`/`probe3.mjs` (R5-Sonden; Import-Teile Artefakt, da ohne `data-testid`), `lazy.mjs` (9: Kaltstart, Drosselung, warme Chords, Chunk-Ausfall, Offline-Erstbesuch, Reduced Motion), `import.mjs` (17), `mini.mjs` (4), `mini2.mjs` (Snapshot-Fehlertexte, Toast-Stack, `o t`-Fokus); `results-a/b/v/p2/p3/l/i/m/m2.json`, `run.log`, `flows.log`, `verify.log`, `lazy.log`, `import.log`, `mini.log`; `../r6-e2e.log` (E2E OK, 350), `../r6-vitest-web.log` (273 Tests)
- Downloads: `i-snap.json`, `i-snap-date.json`, `m-snap.json`, `m-snap-after-spot.json` (Spot 1,25), `m2-{noschema,baddate,baddf,missing,badvol,notjson}.json`, `snap-a/b.json`, `snapshot.json`, `report.json`, `portfolio*.json`, `import*.csv`, `csv-date.csv`, `hedge-doc.md`
- PDFs: `report-print.pdf`, `doc-{termsheet,suitability,confirmation,kid}-print.pdf`, `hedge-print.pdf` (je 3 Seiten)
- Lazy/Offline: `l-skeleton-scenarios.png`, `l-scenarios-loaded.png`, `l-chunk-failure.png`, `l-offline-first-scenarios.png`
- Import: `i-curves-imported.png`, `i-market-after-leave.png`, `i-inspector-1024.png`, `i-fx-vol-1024.png`, `m-fx-vol-1024.png`
- Dark 1440: `1440-dark-{blotter,pricing,curves,curves-toy-inactive,market,report,scenarios,compare,compare-whatif,hedge,hedge-invalid,palette,help,csv-errors,blotter-imported,blotter-213,customer-termsheet}.png`, `1440-dark-doc-{termsheet,suitability,confirmation,kid}.png`, `1440-caplet-card.png`
- Print: `1440-report-print.png`, `1440-print-doc-{termsheet,suitability,confirmation,kid}.png`, `1440-hedge-print.png`
- Light 1440: `1440-light-{blotter,pricing,curves,scenarios,market,report,kid,hedge,compare,help}.png`
- 1024×768: `1024-dark-{blotter,pricing,curves,scenarios,market,report,compare,hedge,palette,help,kid}.png`, `1024-light-{blotter,pricing,market}.png`, `1024-inspector.png`, `1024-fx-vol-card.png`, `1024-fx-fixings-card.png`, `1024-kpis.png`
- Nachprüfungen: `offline-after-first-visit.png`, `offline-after-second-visit.png`, `v-collar-after-par.png`, `v-customer-report.png`, `v-hedge-fresh.png`, `p2-customer-report.png`
