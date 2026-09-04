# DERIVA – Review Runde 7: UI/UX & Hotkeys (Dim. 3) und User Flows (Dim. 4)

**Reviewer-Rolle:** Senior UX-Designer · Accessibility-Auditor · Trading-Desk-Power-User
**Datum:** 2026-09-04 · **Modus:** Re-Review only, keine Quellcode-Änderungen · **Baseline:** `review-ui-r6.md` (Runde 6: UI 98, Flows 98)

## 0. Prüfstand

| | |
|---|---|
| Repo-Stand | Branch `claude/derivatives-trading-platform-1arsyu`, HEAD `f93e099` („feat(core,api,web): Maßnahmenprogramm Runde 6 umgesetzt“). Web-Diff seit R6 (`c031daf`): 32 Dateien, +3.792/−479 – u. a. `lib/lazy.ts` (Retry + `ChunkError`), `components/ErrorBoundary.tsx`, `components/Modal.tsx` (`focusFallback`/`restoreFocus`), `components/TradeEditor.tsx` (Amortisationsplan mit `useTableNav`), `views/CurvesView.tsx` (`IMPORT_LOCK`-Sperren, `AddCurveForm` „+ Kurve“), `views/MarketView.tsx` (Spot-Overrides, Fixings-Editor mit Filter/Paginierung), `state/store.ts` (`fxSpotOverrides`, `extraCurves`, Undo `kind: "marketSource"`/`"curves"`, `hedgeResults`), `lib/quick-parser.ts` (Token-Fehler, `imm`, `ndf`, `barrier`, `cash`), `lib/portfolio-io.ts` (11 CSV-Vorlagen), `lib/i18n.ts`; `lib/core-compat.ts` entfernt |
| Bundle | `vite build` (vite 8.2.2/Rolldown) frisch: `index-BpUGl9Mr.js` 108 KB (35,1 KB gz), `store-Dkj3Wowy.js` 77,6 KB (23,5 KB gz), `core-BZmIBBkD.js` 254 KB (81,9 KB gz), `react-DLh8G0Wt.js` 193 KB (61 KB gz), `echarts-DfTdNZQj.js` 548 KB (180,6 KB gz, lazy), 7 View-Chunks 5–61 KB, `sw.js` 4,9 KB; `scripts/size-limit.mjs`: Initial-Load 219,3 kB gz (9 Dateien), „Service worker precache: 20 assets“, „Size budget OK“; `vite preview --port 5011 --strictPort` |
| Unit-/E2E-Tests | `npx vitest run` in `apps/web`: **34 Dateien, 307 Tests grün** (ein erster Lauf parallel zur E2E-Suite hatte 2 Timeouts in `App.r6.test.tsx` – isoliert und unkontendiert grün, reine Lastfrage bei 34 Workern, kein Abzug); `E2E_PORT=5012 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/smoke.mjs`: **E2E OK (395 checks)** |
| Browser-Audit | Playwright + Chromium (`/opt/pw-browsers/chromium`), Locale `de-DE`, Clipboard-Rechte, Viewports **1440×900** und **1024×768**, Dark + Light, Print-Emulation + `page.pdf()`, Offline (`context.setOffline`) in **frischen Browserkontexten** (ein Online-Aufruf), CDP-Drosselung (1,5 Mbit/s, 250 ms), `page.route`-Abbruch von View- und Bibliotheks-Chunks. Skripte in `…/scratchpad/r7-ui/`: `verify.mjs` (23 Checks, alle R6-Befunde), `flows.mjs` (39: 6 Journeys, 11 Vorlagen, Persistenz), `sweep.mjs` (**96 Zustände**: 12 Views × 2 Viewports × 2 Themes, 11 Editoren, 4 Dokumente + Kundenmodus, Export-Menü, CSV-Dialog, Import-Modus Markt/Kurven, Toast, Stichtag-Popover, Kontextmenü, Onboarding; a11y + Kontrast + Überlauf + Textscan + Screenshot je Zustand; Druck), `lazy.mjs` (6: Kaltstart, Drosselung, warme Chords, Offline-Erstbesuch, Reduced Motion), `probe2…7.mjs` (Nachprüfungen: Import-Modus verlassen mit Zusatzkurven, DKK-Schnelleingabe, ECharts-Retry, Hedge-Reset-Undo, Fixings-Tabstopps, Fokus nach Trade-Anlage, Key-Rate-Karte, 213 Trades). Messwerte `results-{v,f,s,l,p2,p3,p4,p5,p7}.json`, 110 Screenshots, 9 PDFs. Rot gelaufene Checks wurden einzeln nachgeprüft; Sonden-Artefakte (Undo-Stack nach Reload – nicht persistiert, wie in R6; `active()` ohne Button-Text; Blotter-Zeile nach persistiertem View-Wechsel; `curves` als Array im Snapshot; Palette bei Tab-Zählung offen; Logo mit Gradient-Hintergrund) sind aus den Befunden entfernt |
| Konsole | **Keine** JS-Fehler, keine Warnungen, keine fehlgeschlagenen Requests in allen Läufen (Ausnahme: die absichtlich abgebrochenen Chunks) |
| Tastatur | Chords `o t/g/k/c/p/r`, `x c/b`, `y i`, `y y`, `g …`, `n s/c/w/f/o/b/a/i/x/z/r`; Tab-Sequenzen ab Skip-Link (Blotter, Pricing, Kurven, Markt); Amortisationsplan `↓/End/↵/Esc`; `Shift+P` Collar/DKK-Swap; `Shift+K`, `Shift+T`, `t`, `d`, `Shift+D`, `Space`, `r`, `]`/`0`, `Alt+2`, `?`; `Ctrl+Z` auf Spot-Override, Import, Verwerfen, Verlassen, Kurve anlegen/entfernen, Hedge-Reset |

Screenshot-Verzeichnis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r7-ui/` (Übersicht Abschnitt 8).

---

## 1. Scores

### 1.1 UI/UX & Hotkeys: **98 / 100** (R1 62 → R2 88 → R3 91 → R4 95 → R5 96 → R6 98)

**Verifiziert behoben (Belege Abschnitt 2):** alle sechs R6-Befunde. Chunk-Ausfall zeigt die deutsche Karte „ANSICHT NICHT VERFÜGBAR – … vermutlich liegt eine neue Version von DERIVA vor … Bitte die Seite neu laden“ mit **„Neu laden“ + „Erneut versuchen“**, automatischer zweiter Versuch (3 Requests), Retry bei anhaltendem Ausfall stabil (Karte bleibt, kein Skeleton), Retry nach Netzrückkehr lädt die Szenarien, erneutes `g s` lädt ohne gecachte Ablehnung (R6-01); Amortisationsplan **1 Zeilen-Tabstopp, 0 Input-Stopps**, `↵` → „Nominal Periode 10“, `Esc` → Zeile, Editor gesamt 66 Stopps (R6-02); nach `Esc` aus `o t`/`o k` liegt der Fokus auf `main#main`, der nächste `Tab` auf dem ersten Button der View, per Button geöffnete Dokumente geben den Fokus an `open-termsheet` zurück (R6-03); Import-Modus: Quote-Zellen, Interpolations-Select, Turn-of-Year (bp + Anwenden), Quotes ±10 bp und „+ Kurve“ **`disabled` mit `IMPORT_LOCK`-Titel**, `↑↵` erzeugt **0 Toasts** (R6-04); „Swaption-Cube EUR: **Vol-Typ fehlt** (erlaubt Normal, Lognormal, ShiftedLognormal)“ (R6-05); CSV-Dialog listet 4/4 defekte Zeilen inkl. „**Enddatum muss nach dem Startdatum liegen**“, Button „Keine gültige Zeile“ (deaktiviert) bzw. „1 gültige Zeile importieren“ → „1 Trades aus CSV importiert“ (R6-06). **Sweep über 96 Zustände: 0 unbenannte Steuerelemente/Composites/Dialoge, 0 doppelte IDs, 0 positive Tabindizes, 0 Überschriftensprünge, 0 Tabellen ohne Namen, keine Seite scrollt horizontal; 5.450 gemessene Textpaare, alle Textfarben ≥ 4,5:1** (einzige Werte < 4,5: die 18-px-Rail-Icon-Glyphen im aktiven Light-Tab mit 4,13:1 – Nicht-Text-Kontrast ≥ 3:1 erfüllt, Label daneben ≥ 4,5:1). Druck: Report 1 Seite, KID/Geeignetheit/Confirmation 3, Termsheet 1, Hedge 1 („50“ und „%“ 3 px), Kurven 2, Blotter 1, Rail/Status/Topbar ausgeblendet. Lazy: Kaltstart Shell 332 ms, `g s` 394 ms, unter Drosselung Skeleton (`aria-busy`, `aria-live=polite`, „Ansicht wird geladen …“) ohne Doppel-Platzhalter, warme Chords 15–121 ms, `Alt+2` 45 ms, Reduced Motion respektiert. Offline nach dem **ersten** Besuch: 22 Cache-Einträge, alle 7 Lazy-Views mit Diagrammen, Amortisations-Editor und „+ Kurve“-Formular.

**Abzüge (kumuliert ≈ −2,1):**
- Niedrig −0,7: **Trade-Editor kennt die neuen Währungen nicht** – `TradeEditor.tsx:147` `CCYS = ["EUR","USD","GBP","CHF","JPY"]`, Index-Liste EURIBOR/€STR/SOFR/SONIA/SARON/TONA fest verdrahtet: ein per Schnelleingabe angelegter **DKK/DESTR-Swap zeigt im Editor „Währung EUR“ und „Index EURIBOR-3M“**, „Collateral-Währung“ leer; DKK/NOK-Trades sind im Editor nicht anlegbar, obwohl „+ Kurve“ die Währung eingeführt hat (R7-02).
- Niedrig −0,5: **Markt-View mit 489–510 Tabstopps**: der neue Fixings-Editor hat 245 (60 Zeilen × 4 Controls, 1.323 Fixings paginiert), die Vol-Grids 99/50/72 – kein Roving, **241 Tabs**, um den Fixings-Editor zu verlassen (R7-01).
- Kosmetisch −0,3: **Fokus nach Trade-Anlage**: `n s` → `body`, Palette-`↵` → `main`, **13 Tabs** (6 What-if-Felder, Richtung, Par, Termsheet, Indikation, Duplizieren, Löschen) bis „Bezeichnung“; „Kurve anlegen“/„Abbrechen“ im „+ Kurve“-Formular per Tastatur → `body` (R7-03).
- Kosmetisch −0,2: **Key-Rate-Delta-Kurvenselektor läuft 12 px über die Karte** (FX-Produkte, 1440 px, zweispaltig, `.seg` `nowrap`, Karte `overflow: visible`) (R7-04).
- Kosmetisch −0,2: **„Erneut versuchen“ bei Ausfall des ECharts-Chunks wirkungslos** – der Fehler sitzt im statisch importierten `echarts-*.js`, dessen URL das Cache-Busting nicht erreicht; nur „Neu laden“ hilft (R7-05).
- Kosmetisch −0,2: **Hedge-Reset-Undo stellt das Testergebnis nicht wieder her** (Ratio 99 zurück, Verdict-Badge weg, Button „Effektivität testen“) (R7-06).

### 1.2 User Flows: **97,5 / 100** (R1 57 → R2 82 → R3 94 → R4 98 → R5 97 → R6 98)

- (a) **Indikation im Kundengespräch: sehr gut, vollständig per Tastatur** – `Ctrl+K` → `collar 7y 3,5/1,5 6m @Kunde GmbH` → `↵` in **276 ms** bis PV 48.973; `Shift+P` → „Zero-Cost-Collar: Floor-Strike übernommen (Prämie 0)“, PV **2 EUR**; `y i` „Collar EUR 7Y 3,50 % / 1,50 % (COL-0002) · Nominal 6.000.000 EUR · bis 07.09.2033 · Prämie % Nominal 0,000 % · PV 2 EUR · DV01 2.050 EUR · Kontrahent Kunde GmbH · Stichtag 03.09.2026“; `g s` 446 ms, Heatmap `→ ↵` → „What-if Zinsen -200 bp / EUR +5 %“, `o t` mit Stress-Banner; `o t` **388 ms**, Fokusfalle Markdown → Drucken → Schließen, **`Esc` → Fokus `main#main`** (R6-03 ✓); `o k` KID, `o g` Geeignetheitserklärung § 64 Abs. 4 WpHG, `o c`, `o r` Hashes + MaRisk; `Shift+K` Report ohne CVA/DVA/Margenformel (nur BGH-Satz). Kein Abzug.
- (b) **Treasurer: CSV-Import mit allen 11 Vorlagen → Fehler beheben → Portfolio bewerten: sehr gut** – Export ▾ listet **11 Vorlagen** (Zinsswap, FX-Forward, Cap/Floor/Collar, Swaption, FX-Option, Cross-Currency-Swap, FRA, FX-Swap, Tenor-Basis-Swap, Amortisierender Swap, IMM-Swap); jede Vorlage importiert ihre Beispielzeile **ohne Fehlerdialog, 11 neue Trades, 0 Fehler-Badges** (AMORT-1001, BASIS-1001, IMM-1001, FXS-1001, …); defekte Datei → Dialog „4 Zeilen übersprungen“ mit deutschen Ursachen, „1 gültige Zeile importieren“, Fehler-CSV; ID-Kollision → Überspringen/Ersetzen/Umbenennen („2 Trades aus CSV importiert (1 umbenannt)“); `o p` → Portfolio-Report; JSON-Roundtrip; `Ctrl+Z` je Import. Kein Abzug.
- (c) **Prüfer: Marktdaten → What-if → Vergleich → Snapshot: sehr gut** – 5Y-Quote `↑↑↵` → „modifiziert“, PV −279.451 → −279.427 (die OIS-1W-Quote bewegt IRS-0001 seit den historischen Fixings nur noch unter 1 EUR – kein Fehler); `]` in **39 ms**; Vergleich zweier Trades unter What-if; `Ctrl+Z` „Rückgängig: Quote OIS 1W 2,0150 → 2,0200 %“. **Snapshot:** Export → Quote ändern → Import → **ID `3803d0191a972626` identisch, Report-Hash `0a531862…` identisch**; Import-Toast „… vorherige Marktänderungen verworfen (Rückgängig stellt sie wieder her)“; **Spot-Override** EUR/USD 1,25 → Chip „Sample EoD · importiert · modifiziert“, Marker „Snapshot 1,1625“, Report „Snapshot Sample EoD · modifiziert“, andere ID, im Export (`fxSpots.EURUSD = 1.25`), **überlebt den Reload**, `Ctrl+Z` „Rückgängig: Spot EUR/USD 1,2500“ → Hash wieder `0a531862…` (R6-F1 ✓); `Ctrl+Z` auf den Import → modifizierter Sample-Markt zurück; Verwerfen per Stichtag und „Zum Sample-Markt“ rückgängig inkl. Vol-Override 77 (R6-F2 ✓); Snapshot mit 30.10.2026 setzt den Stichtag, überlebt den Reload. Kein Abzug.
- (d) **Hedge Accounting: sehr gut** – `↵` auf „Effektivität testen“ → „✓ effektiv“; Ratio `↓` → Veraltet-Badge, Button „Erneut testen“, Markdown „ERGEBNIS VERALTET“ ohne ISO/camelCase; **nach Reload Ergebnis + Ratio 99 + Veraltet-Badge vorhanden**, Quote-Änderung flaggt auch nach Reload (R5-F3 ✓); Reset fragt, Toast-Undo erster Tabstopp ab Skip-Link → Ratio 99 zurück (Ergebnis nicht – R7-06, Dim. 3); CAP Innerer Wert + Vol einfrieren → CoH-Karte, „✓ effektiv“. Kein Abzug.
- (e) **„+ Kurve“ für DKK/NOK und Swap per Schnelleingabe: gut mit zwei Lücken** – `+ Kurve` (Tastatur `↵`) → Formular mit Währungen „DKK (ohne Kurve)“, Index-Default **DESTR** (OIS), Konventionen „(OIS, ACT/360, DK)“, Spot-Feld EUR/DKK, Quote-Parser mit Fehler „Zeile „abc“ nicht lesbar – erwartet Tenor;Satz, z. B. 5Y;3,20“ → „Kurve DKK-DESTR aus 6 Quotes angelegt · Spot EUR/DKK 7,4600“, eigener Tab, Chip „modifiziert“, `Ctrl+Z`; NOK: NOWA, dann NIBOR-6M „Dual-Curve gegen NOK-NOWA“, Spot nur einmal gefragt; **Zusatzkurven überleben den Reload**, Snapshot-Export enthält 11 Kurven (DKK-DESTR, NOK-NOWA, NOK-NIBOR-6M) + Spots, Re-Import → identische ID, DKK-Trades im Import-Modus bewertet; „✕ Kurve entfernen“ fragt „Trades in DKK verlieren ihre Diskont-/Projektionskurve (rückgängig mit Ctrl+Z)“, `Ctrl+Z` stellt die Bewertung wieder her. `ois dkk 5y pay 3% 10m` / `irs dkk … destr` → **PV 12.391 EUR, Par 3,2000 %, DV01 626**, Report mit „DKK-DESTR“, Termsheet, `y i` „Payer-Swap DKK 5Y OIS … Nominal 12.000.000 DKK … PV 14.869 EUR“; `irs nok 5y pay 4% 10m` → PV −31.199 (NIBOR-6M). **Reibung −1,0 (R7-F2):** die Standardform **`irs dkk 5y pay 3% 10m`** wählt **CIBOR-6M** (Swap-Konvention) statt der einzigen vorhandenen Kurve – Vorschau ohne Warnung, Pricing „nicht bewertet – Eingaben prüfen · Kurve DKK-CIBOR-6M nicht im Markt-Snapshot“ ohne Handlungshinweis, `Shift+P` „Kein Par-Wert … (Bewertung fehlgeschlagen)“, `y i` „PV –“. **Reibung −1,5 (R7-F1):** **Snapshot-Import setzt den „+ Kurve“-Spot zurück und „Zum Sample-Markt“ baut ohne Zusatzkurven** – nach Import → Verlassen: DKK-Tab deaktiviert, Blotter „Keine Diskontkurve für DKK konfiguriert“; nach Reload Kurve da, aber „**FX-Spot fehlt: Kein FX-Spot für DKKEUR verfügbar**“, dauerhaft (auch `r`, auch nach Stichtags-Verwerfen); die FX-Spot-Tabelle hat kein „Paar hinzufügen“, „+ Kurve“ für DKK bietet nur noch CIBOR – der Treasurer verliert seine DKK-Bewertungen bis zum Anlegen einer zweiten Kurve mit Spot.
- (f) **Offline / Lazy / Persistenz: sehr gut** – frischer Browser, ein Aufruf: Cache `deriva-shell-148ff4e12db8` mit 22 Einträgen, Offline-Reload mit Chip „⚠ offline – lokaler Bestand“, alle Views + Charts + Editor + „+ Kurve“-Formular; Theme, View, Stichtag 30.10.2026, Feldänderung überleben den Reload („Bestand aus lokalem Speicher geladen (13 Trades) · Zurücksetzen“); Onboarding-Beispiele deutsch datiert. Chunk-Ausfall: View-Chunk mit Retry/Reload-Karte, Bibliotheks-Chunk nur „Neu laden“ (R7-05, Dim. 3).
- Performance (213 Trades): Import 221 ms, Bewertung 12,1 ms, `j`×10 318 ms, Sortierung 118 ms, Palette 102 ms (68 Treffer), `]` 222 ms, Szenarien 971 ms, Portfolio-Report 523 ms, Hedge-View 489 ms, Reload 964 ms, Heap 23 MB, localStorage 118 KB; Einzeltrade: Feldänderung → PV 81 ms, Kurven 409 ms, Markt 420 ms, Report 390 ms; „+ Kurve“ inkl. Formular 7,1 s Bedienzeit (Rechenzeit < 1 s), DKK-Swap per Schnelleingabe 640 ms.

---

## 2. Status der Runde-6-Befunde

Legende: ✅ behoben · 🔶 teilweise · ❌ offen. Belege = Feld in `results-v.json` (`verify.mjs`), `results-f.json` (`flows.mjs`), `results-p2/p4/p5/p7.json` oder Screenshot.

| # | Titel (R6) | Status | Beleg / Rest |
|---|---|---|---|
| R6-01 | Chunk-Ladefehler: englischer Rohtext, kein Recovery | ✅ | `lib/lazy.ts` `lazyComponent` (Attempt + `retryImport` mit `?retry=`, `reset()` bei Retry/Neu-Mount), `ChunkError`, `ErrorBoundary.errorMessageDe`; `fail {attempts 3, card 1, alert „ANSICHT NICHT VERFÜGBAR … neue Version … neu laden“, btns [„Neu laden“, „Erneut versuchen“]}`, `retryBlocked {card 1, skeleton 0}`, `afterRetry {table 1, card 0}`, `second {card 1 → other „/ Kurven“ → back.table 1}` (`v-chunk-failure.png`); Chart-Karte „DIAGRAMM NICHT VERFÜGBAR“, Pillar-Tabelle bleibt nutzbar. **Rest → R7-05:** Retry bei Bibliotheks-Chunk wirkungslos |
| R6-02 | Amortisationsplan 20 Tabstopps | ✅ | `TradeEditor.tsx:423` `useTableNav({ onEnter: … input.focus() })`, `rowProps`, Inputs `tabIndex={-1}`; `amort {rows 10, rowStops 1, inputStops 0, roleRows 10, fEnter „INPUT|Nominal Periode 10“, fEsc TR, editorStops 66}` (`v-editor-amort.png`) |
| R6-03 | Fokus nach `Esc` aus Chord-Dokument auf `body` | ✅ | `Modal.tsx` `focusFallback()` (`[data-focus-fallback]` ∨ `main#main`), `restoreFocus`; `ot {before TR.selected, after MAIN.main#main, tabAfter BUTTON.btn}`, `pricing {after MAIN.main#main}`, `reportBtn open-termsheet = reportAfter`; `f1.focusAfterEsc MAIN.main#main` |
| R6-04 | Import-Modus sperrt nur per Toast | ✅ | `CurvesView.tsx:439` `IMPORT_LOCK`, `disabled={imported}` an Quote-Zellen (`:877`), Interpolation (`:618`), ToY (`:647/:667/:682`), Bump (`:718`), „+ Kurve“ (`:589`), Quote-Entfernen (`:860`); `lock {qDisabled true, interpDisabled true, toyApply true, toyBp true, bumpDisabled true, addCurve.disabled true + IMPORT_LOCK-Titel, toastsAfter 0}` (`v-curves-import-locked.png`); Hinweiszeile `curves-import-note` |
| R6-05 | „Vol-Typ undefined unbekannt“ | ✅ | `i18n.ts:396` `volTypeDe` („fehlt“ für `undefined`/`null`/leer); `voltype.toast` „… Swaption-Cube EUR: Vol-Typ fehlt (erlaubt Normal, Lognormal, ShiftedLognormal)“, Markt unverändert (`id = id0`, `badge 0`); weitere Fehlertexte deutsch (`badSnaps`) |
| R6-06 | CSV-Dialog zählt Validierungsfehler nicht | ✅ | `validate-trade.ts` im Vorlauf, `Blotter.tsx:240/:259`; `csv.rows` 4 Einträge inkl. „5 · Enddatum muss nach dem Startdatum liegen“, Button „Keine gültige Zeile“ (`disabled true`), `mixed {rows [„3 · Enddatum …“], btn „1 gültige Zeile importieren“, after {count 1, toast „1 Trades aus CSV importiert“}}` (`v-csv-errors.png`) |
| R6-F1 | FX-Spot-Edit im Import-Modus ändert ID still, kein Undo/Persistenz | ✅ | `store.ts` `fxSpotOverrides` (persistiert, Undo-Eintrag), `MarketView.tsx:937-939` `setFxSpot`, Marker `spot-edited`, „Auf Snapshot zurücksetzen“; `spot {chip „… importiert · modifiziert …“, edited 1, editedTitle „Snapshot 1,1625“, resetLabel, reportHead „… Snapshot Sample EoD · modifiziert …“, audit ID f9336265575ade13, exportedSpot 1.25, afterReload {v 1,25, id f9336…}}`, `p2.su.undo {toast „Rückgängig: Spot EUR/USD 1,2500“, v 1,1625, id 3803…, chip ohne modifiziert}`, `reset {v 1,1625, id 3803…, badge 1}`, `f5 {audit4 andere ID + „modifiziert“, audit5 = audit1}`; Kurven-View „Zurücksetzen“ mit Titel „Vol-, Spot-, Fixing- und FX-Fixing-Änderungen verwerfen – zurück zum importierten Snapshot“ |
| R6-F2 | Snapshot-Import/-Verwerfen/-Verlassen ohne Undo, Vol-Änderungen still verworfen | ✅ | `store.ts:138` `kind: "marketSource"`, `marketSourceState()`, `pushMarketSourceUndo` in `importSnapshot`/`setValuationDate({discardImport})`/`leaveImport`; Import-Toast „… vorherige Marktänderungen verworfen (Rückgängig stellt sie wieder her)“, `volImp.undo {c 99, chip modifiziert, badge 0}`, `leave.undo {toast „Rückgängig: Zum Sample-Markt (Snapshot „Sample EoD“ verlassen)“, badge 1}`, `afterLeaveUndo.c 77`, Stichtag-Dialog „… (rückgängig mit Ctrl+Z). Fortfahren?“, `dateAccept.undo {status 03.09.2026, badge 1, c 77}`, `f5.undoImport` |
| R5-F3 | Hedge-Ergebnis nach Reload weg | ✅ | `store.ts:306` `hedgeResults` (persistiert), `HedgeView.tsx:308/:386/:394` Key-basierte Veraltet-Logik; `hp {verdict „✓ effektiv“, after {verdict „✓ effektiv“, stale 0}, staleAfterQuote 1, staleAfterReload 1}`, `f6.afterReload {verdict, stale 1, ratio 99}`, E2E-Checks R5-F3 |

Zusätzlich verifiziert (kein R6-Befund): Fixings-Editor flaggt „modifiziert“ und ist rückgängig, FX-Fixing im Import-Modus = Override mit Undo, Stichtag-Popover, Export-Menü-Fokusrückgabe, Kontextmenü, Toast-Dedupe, Undo-Stack bewusst nicht persistiert (wie in R6).

---

## 3. Neue Befunde (Runde 7)

Schweregrade wie in R1–R6. Reproduktion gegen das Preview-Bundle; Belege in `results-*.json` (Feldname) bzw. Screenshot.

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R7-01 | Niedrig (Tastatur) | `views/MarketView.tsx:778` Fixings-Tabelle (Select + DateInput + NumInput + Entfernen je Zeile, `FIXINGS_PAGE` 60), Vol-Grids (`:123`, `:216`, `:301` `NumInput` je Zelle) | Markt-View **489–510 Tabstopps** (`a11y_1440-dark-market.tabStops 510`, `p4.fx {total 489, fixings 245, fixingsRows 60, cards: Fixings 245, Swaption-Vols 99, FX-Vol 50, Caplet 72}`); vom ersten Fixing-Input bis zur nächsten Karte **241 Tabs** (`tabsToLeaveFixings 241 → fx-fixing-pair`). Der Rest der App (Blotter, Cashflows, Amortisationsplan seit R6-02) folgt dem Roving-Muster. | Fixings-Tabelle auf `useTableNav` umstellen (Zeile = Tabstopp, `↵`/`F2` → Zelle, `Esc` → Zeile, Controls `tabIndex=-1`), Standard-Seitengröße 20 mit „mehr“; Vol-Grids: ein Tabstopp je Grid, `←/→/↑/↓` zwischen Zellen (wie Heatmap), `↵` editiert. |
| R7-02 | Niedrig (Konsistenz/Registerlisten) | `components/TradeEditor.tsx:147` `CCYS = ["EUR","USD","GBP","CHF","JPY"]`, Index-`Select` mit fester Liste, `:1111` Swaption-Währungen aus Vol-Cubes | Nach „+ Kurve“ DKK-DESTR und `ois dkk 5y pay 3% 10m`: Editor zeigt **„Währung EUR“ (Optionen EUR/USD/GBP/CHF/JPY) und „Index EURIBOR-3M“**, obwohl Leg-Text „DKK … DESTR“ und Bewertung korrekt sind (`p5.dk.selects`, `p5-dkk-editor.png`); „Collateral-Währung“ leer; ein DKK/NOK-Trade lässt sich im Editor nicht anlegen (nur Schnelleingabe/CSV). Nominal-Edit wechselt **nicht** still nach EUR (PV 14.869, Leg DESTR) – reine Anzeige-/Erreichbarkeitslücke. | Optionen aus `knownCurrencies()` bzw. Währungen mit Diskontkurve (`market.discountCurveId`) und `knownIndices(ccy)` ∩ vorhandene Kurven bilden; aktuellen Wert immer als Option führen; Kollateralwährung „unbesichert“ als sichtbare Option; Test in `review-r7.test.tsx`. |
| R7-03 | Kosmetisch (Fokus) | `App.tsx` Chord `n …` / Palette-`↵` (`selectTrade` + `setView("pricing")` ohne Fokus), `CurvesView.tsx:230-242` `AddCurveForm.submit`/`onDone` | `n s` → Fokus `body`, Palette-`↵` → `main#main`; bis zum ersten Feld „Bezeichnung“ **13 Tabs** (Zinsen/FX/IR-Vol-What-if ×6, ⇄ Richtung, ≈ Par, Termsheet, Indikation, Duplizieren, Löschen) (`p7.nf {afterChord BODY, tabsToField 13, afterPalette MAIN}`); „Kurve anlegen“ und „Abbrechen“ per `↵` → `body` (`p2.af {focusAfterSubmit BODY, focusAfterCancel BODY}`). | Nach Trade-Anlage `input[aria-label="Bezeichnung"]` (bzw. erste Karte `tabIndex=-1`) fokussieren; `onDone(id)` fokussiert den neuen Kurven-Tab, `onDone()` den „+ Kurve“-Button. |
| R7-04 | Kosmetisch (Layout) | `PricingWorkspace` Key-Rate-Delta-Karte, `.seg` Kurvenselektor ohne `wrap`, `app.css` `.card {overflow: visible}` | Bei FX-Produkten (FXO-0001, FX-Editoren fxf/fxo/fxs/ccs) hat der Selektor 5 Tabs (€STR, EUR 6M, EUR 3M, SOFR, €STR-USDCSA); im 2-Spalten-Grid (Karte 358 px) läuft der letzte Button **12 px über den Kartenrand** (`p6 {card right 1424, lastBtn right 1436, overflowPx 12, segFlexWrap nowrap}`, `p6-keyrate-fxo.png`); bei 1024 px (461 px Karte) und IRS-Trades kein Überlauf. | `.seg.wrap` wie bei den FX-Vol-Paaren (R5-05) oder `overflow-x: auto` auf der Toolbar-Zeile. |
| R7-05 | Kosmetisch (Robustheit) | `lib/lazy.ts:73-78` `retryImport` (Cache-Busting nur auf der im Fehler genannten URL), `components/EChartImpl.tsx` importiert `echarts` statisch | Fällt `echarts-*.js` aus (Deploy/Netz): Karte „DIAGRAMM NICHT VERFÜGBAR …“ korrekt, Pillar-Tabelle nutzbar; aber **„Erneut versuchen“ ×2 und Wechsel in eine andere Chart-View bleiben ohne Canvas** (`p4.ec {afterRetry1.canvas 0, afterRetry2.canvas 0, otherView.canvas 0}`), weil die Modul-Map die fehlgeschlagene URL des statischen Imports behält; „Neu laden“ funktioniert (`reload.after {crumb Kurven, canvas 1}`). | In `EChartImpl` die Bibliothek dynamisch laden (`import(/* @vite-ignore */ echartsUrl + retry)`) oder nach dem zweiten Fehlversuch „Erneut versuchen“ ausblenden und den Text auf „Bitte neu laden“ verkürzen. |
| R7-06 | Kosmetisch (Undo) | `store.ts:1820-1829` `removeHedgeRelationship` löscht `hedgeResults[tradeId]`, Undo-Eintrag `kind: "hedge"` (`:1383-1388`) stellt nur `relationship` wieder her | Hedge-Reset → Toast-Undo (erster Tabstopp ab Skip-Link) → Ratio 99 zurück, aber **Verdict-Badge weg, Button „Effektivität testen“** (`p4.hr.afterUndo {ratio 99, verdict 0}`); der Prüfer muss neu testen. | `result: prev` in den Undo-Eintrag aufnehmen und beim Undo `hedgeResults` mit zurückschreiben. |

### Flow-Befunde

| # | Schwere | Wo | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| R7-F1 | **Mittel** (Datenverlust/Reproduzierbarkeit) | `store.ts` `importSnapshot` setzt `quotes: cloneQuotes(SAMPLE_QUOTES)`; `addExtraCurve` (`:1640-1653`) legt den EUR/DKK-Spot als **Quote-Edit** in `quotes.fxSpots` ab; `leaveImport` (`:1816`) `buildMarket(date, quotes, interpolation, turnOfYear, {}, [])` **ohne `extraCurves`**; `setValuationDate({discardImport})` analog | „+ Kurve“ DKK-DESTR mit Spot 7,46 → `ois dkk …` PV 12.391 → Snapshot importieren: **`quotes.fxSpots` verliert EURDKK sofort** (`p7.s1.ls.fx` ohne EURDKK, UI zeigt noch den Snapshot-Spot) → „Zum Sample-Markt“: DKK-Tab **deaktiviert**, Blotter-Badge „**Keine Diskontkurve für DKK konfiguriert**“, Spot-Tabelle ohne EUR/DKK (`p7.s2`, `p2.lv.tabAfterLeave {disabled true}`) → Reload: Kurve wieder da, aber Badge „**FX-Spot fehlt: Kein FX-Spot für DKKEUR verfügbar**“ (`p7.s3`), auch nach `r`, auch nach Stichtags-Verwerfen (`p2.lv.blotterAfterDateDiscard 1`); Reparatur nur über einen Umweg („+ Kurve“ DKK bietet nur noch CIBOR-3M/6M – mit Spot-Feld; FX-Spot-Tabelle hat kein „Paar hinzufügen“, `p7.repair`). `Ctrl+Z` direkt nach dem Import stellt Spot + Kurve wieder her (`p7.u`), Import-Modus selbst bewertet DKK korrekt (`p7.imp.badges []`). Der Treasurer, der einen Prüfer-Snapshot lädt und wieder verlässt, verliert seine DKK/NOK-Bewertungen dauerhaft. | (1) Spots neuer Währungen mit der Zusatzkurve speichern (`ExtraCurve.fxSpot`) oder `importSnapshot` `quotes` unverändert lassen und nur `marketSource` wechseln; (2) `leaveImport`/`setValuationDate` über `rebuildMarket` mit `get().extraCurves`; (3) FX-Spot-Tabelle mit „+ Paar“; E2E: Kurve anlegen → Import → Verlassen → Reload → DKK-Trade bewertet, Spot-Zeile EUR/DKK vorhanden. |
| R7-F2 | Niedrig (Erlernbarkeit/Fehlerpfad) | `lib/quick-parser.ts:559-620` IRS-Zweig: Index aus Swap-Konvention (DKK → CIBOR-6M), `noCurveError` (`:302`) prüft nur `discountCurveId`; Pricing-Warnung `i18n.ts:283` „Kurve … nicht im Markt-Snapshot“ ohne Hinweis | Die in der Hilfe beworbene Journey „+ Kurve → `irs dkk 5y pay 3% 10m`“ scheitert in der Standardform: Vorschau „⚡ Payer-Swap DKK 5Y @ 3,000 % · Nominal 10.000.000“ **ohne Warnung**, danach „nicht bewertet – Eingaben prüfen“ + „Kurve nicht im Markt-Snapshot: Kurve DKK-CIBOR-6M nicht im Markt-Snapshot“ (kein Handlungshinweis), `Shift+P` „Kein Par-Wert für diesen Trade verfügbar (Bewertung fehlgeschlagen)“, `y i` „PV –“ (`f.ac.dkkTrade`, `p2.dk.irsDefault`, `p2-dkk-irs-default.png`); `ois dkk …`, `irs dkk … destr` und nach Anlage der CIBOR-6M-Kurve (PV 12.218) funktionieren. NOK mit NIBOR-6M-Kurve ist unbetroffen. | Im Parser den Index wählen, für den eine Kurve existiert (Konventions-IBOR, sonst OIS) und das in der Vorschau nennen („· DESTR (einzige DKK-Kurve)“); alternativ Fehler „Für DKK-CIBOR-6M fehlt die Kurve – `ois dkk …` oder „+ Kurve“ CIBOR-6M“; Pricing-Warnung `CURVE_NOT_FOUND` um den „+ Kurve“-Hinweis ergänzen. |

---

## 4. User Journeys (Schritt für Schritt, tastaturgeführt)

### (a) Berater bewertet Collar → Termsheet/KID/Erklärung → Report
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `Ctrl+K` · `collar 7y 3,5/1,5 6m @Kunde GmbH` · `↵` | **276 ms** bis PV 48.973; Kontrahent „Kunde GmbH“; Par-Risk, Vega-Buckets, Analytics | – |
| `Shift+P` | „Zero-Cost-Collar: Floor-Strike übernommen (Prämie 0)“, **PV 2 EUR**, Rückgängig im Toast | – |
| `y i` | Indikationstext mit Prämie 0,000 %, PV, DV01, Kontrahent, Stichtag | – |
| `g s` · Heatmap `→ ↵` · `o t` | Szenarien 446 ms; What-if „Zinsen -200 bp / EUR +5 %“; Termsheet mit Stress-Banner; `Esc` → `main#main` | – (R6-03 ✓) |
| `0` · `o t` · `Tab`×3 · `Esc` | Termsheet **388 ms**, Markdown → Drucken → Schließen | – |
| `o k` · `o g` · Kunde · Erzeugen · `o c` · `o r` | KID, Geeignetheitserklärung § 64 Abs. 4 WpHG, Confirmation, Report mit Hashes/MaRisk | – |
| `Shift+K` | Kundenansicht ohne CVA/DVA/Margenformel (einziger Treffer „Marge“ = BGH-Satz) | – |

### (b) Treasurer: 11 CSV-Vorlagen → defekte Datei → Kollision → Portfolio
| Schritt | Beobachtung | Reibung |
|---|---|---|
| Export ▾ → 11× „⤓ Vorlage …“ | `deriva-import-vorlage-{irs,fxf,cap,swpt,fxo,ccs,fra,fxs,basis,amort,imm}.csv`, je 2 Zeilen | – |
| 11× „⤒ CSV importieren“ | je „1 Trades aus CSV importiert“, kein Dialog, 0 Fehler-Badges, 25 Trades | – |
| defekte Datei (5 Zeilen, 4 defekt) | Dialog „4 Zeilen übersprungen“, deutsche Ursachen, „1 gültige Zeile importieren“, Fehler-CSV | – |
| `31.02.`, `2026-02-30`, „abc“, Ende vor Start | 4/4 gelistet, „Keine gültige Zeile“ | – (R6-06 ✓) |
| Kollision IRS-0001 | Überspringen/Ersetzen/Umbenennen → „2 Trades aus CSV importiert (1 umbenannt)“ | – |
| `o p` · JSON-Export | Portfolio-Report; Portfolio als JSON (Array) re-importierbar | – |

### (c) Prüfer: Marktdaten → What-if → Vergleich → Snapshot → Overrides → Undo
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g c` · 5Y-Quote `↑↑↵` · `]` | „modifiziert“, PV −279.451 → −279.427; `]` 39 ms → −210.013 | – |
| `g b` · `Space` · `j` · `Space` · `g v` · `0` · `Ctrl+Z` | Vergleich unter What-if; „Rückgängig: Quote OIS 1W 2,0150 → 2,0200 %“ | – |
| `g m` · Export · Quote ändern · Import · `o r` | ID `3803d0191a972626` und Report-Hash identisch; Toast nennt verworfene Änderungen | – |
| Spot EUR/USD 1,25 · `o r` · Reload · `Ctrl+Z` | „importiert · modifiziert“, Marker „Snapshot 1,1625“, Report „modifiziert“, Export 1,25, Reload behält, Undo stellt Hash wieder her | – (R6-F1 ✓) |
| `Ctrl+Z` auf Import · Stichtag 04.09. · `Ctrl+Z` · „Zum Sample-Markt“ · `Ctrl+Z` | jede Marktquellen-Aktion rückgängig inkl. Vol-Override | – (R6-F2 ✓) |
| Quote/Interpolation/ToY/„+ Kurve“ im Import-Modus | `disabled` mit Hinweis, 0 Toasts | – (R6-04 ✓) |
| ungültige Snapshots (Schema, Datum, JSON, Vol-Typ) | deutsch, „Vol-Typ fehlt“ | – (R6-05 ✓) |

### (d) Hedge Accounting
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `g h` · „Effektivität testen“ `↵` | „✓ effektiv“, Herleitung | – |
| Ratio `↓` `Tab` · Markdown | Veraltet-Badge, „Erneut testen“, Markdown „veraltet“, deutsch | – |
| Reload | Ergebnis, Ratio 99 und Veraltet-Badge vorhanden | – (R5-F3 ✓) |
| Quote ändern · Reload | veraltet auch nach Reload | – |
| „Zurücksetzen“ `↵` · Skip-Link `Tab` `↵` | Rückfrage; Undo → Ratio 99, **Ergebnis fehlt** | R7-06 |
| CAP · Innerer Wert · Vol einfrieren | CoH-Karte, „✓ effektiv“ | – |

### (e) „+ Kurve“ DKK/NOK → Swap per Schnelleingabe → Snapshot → Verlassen
| Schritt | Beobachtung | Reibung |
|---|---|---|
| `irs dkk 5y pay 3% 10m` ohne Kurve · `irs sek …` · `… foo` · `… 10m 20m` | „⚠ Keine Kurve für DKK im Markt – in der Kurvenansicht mit „+ Kurve“ aus Quotes anlegen (Währungen mit Kurve: EUR, USD, GBP, CHF, JPY)“, „Unbekannte Währung „FOO“ – … erwartet: irs|swap|ois|imm|amort …“, „Betrag doppelt angegeben („10m“ und „20m“)“ | – |
| `imm …`, `fxf … ndf`, `fxo … barrier do 1.05`, `swpt … cash`, `ccs … mtm` | Vorschauen „IMM ab 16.09.2026“, „NDF (Ausgleich in USD)“, „Barriere Down-and-Out 1,0500“, „Barausgleich“, „MtM-Reset“ | – |
| `g c` · `+ Kurve` `↵` · DKK · Spot 7,46 · Kurve anlegen | DESTR-Default, Konventionen, Parser-Fehler bei „abc“, Toast mit Undo, Tab „DESTR“, Chip „modifiziert“ | Fokus danach auf `body` (R7-03) |
| `irs dkk 5y pay 3% 10m` · `↵` | Vorschau ohne Warnung → „nicht bewertet – Kurve DKK-CIBOR-6M nicht im Markt-Snapshot“, `Shift+P` ohne Par-Wert | **R7-F2** |
| `ois dkk 5y pay 3% 10m @Nordea` | PV 12.391 EUR, Par 3,2000 %, DV01 626, `y i`, Report mit DKK-DESTR, Termsheet | Editor zeigt „EUR“/„EURIBOR-3M“ (R7-02) |
| NOK: NOWA → NIBOR-6M („Dual-Curve gegen NOK-NOWA“) · `irs nok 5y pay 4% 10m` | zwei Tabs, PV −31.199 | – |
| Reload · Snapshot exportieren · importieren | Kurven bleiben; Snapshot mit 11 Kurven + EURDKK/EURNOK, identische ID, DKK-Trade im Import bewertet | – |
| „Zum Sample-Markt“ · Reload | DKK-Tab deaktiviert, „Keine Diskontkurve für DKK“; nach Reload „Kein FX-Spot für DKKEUR verfügbar“ | **R7-F1** |
| „✕ Kurve entfernen“ · `Ctrl+Z` | Rückfrage nennt betroffene Trades; Undo stellt Bewertung wieder her | – |

### (f) Offline / Lazy Views
| Schritt | Beobachtung | Reibung |
|---|---|---|
| frischer Browser, **ein** Aufruf, offline, Reload | Chip „⚠ offline – lokaler Bestand“, Onboarding, alle 7 Views mit Charts, `n a`-Editor, „+ Kurve“-Formular | – |
| Kaltstart · `g s` sofort | 394 ms, Skeleton kurz | – |
| gedrosselt · `g s` | 957 ms mit Skeleton, danach Kurven 76 / Markt 115 / Hedge 51 / Report 20 ms | – |
| warm · alle Chords · `Alt+2` | 15–121 ms, 0 Skeletons, 45 ms | – |
| View-Chunk 404 · Retry / `g s` nach Netzrückkehr | deutsche Karte, Recovery | – (R6-01 ✓) |
| ECharts-Chunk 404 · Retry | Karte „Diagramm nicht verfügbar“, Retry wirkungslos, „Neu laden“ hilft | R7-05 |

---

## 5. Hotkey-Matrix (verifiziert)

| Aktion | Tasten | Ergebnis |
|---|---|---|
| Termsheet / Erklärung / KID / Confirmation / Portfolio-Report / Report | `o t` / `o g` / `o k` / `o c` / `o p` / `o r` | ✅ Termsheet 388 ms; **Fokus nach `Esc` auf `main#main`, nächster `Tab` in der View** (R6-03 ✓) |
| Indikation / Zeile kopieren | `y i` / `y y` | ✅ auch für DKK-Trade („Nominal 12.000.000 DKK … PV 14.869 EUR“) |
| Neue Trades | `n s/c/w/f/o/b/a/i/x/z/r` | ✅ 11 Editoren öffnen; **Fokus bleibt auf `body`** (R7-03) |
| What-if ±10 bp / Reset | `]` `[` `\` · `+` `-` `0` | ✅ 39–222 ms, auch im Import-Modus |
| Par-Satz / fairer Preis | `Shift+P` | ✅ Collar → PV 2 EUR, DKK-OIS-Swap; unbewertbarer Trade → „Kein Par-Wert … (Bewertung fehlgeschlagen)“ |
| Kundenmodus / Stichtag / Theme / Hilfe | `Shift+K` / `Shift+T` / `t` / `?` | ✅ Stichtag im Import-Modus fragt, rückgängig |
| Duplizieren / Löschen / Vergleich / Neu bewerten | `d` / `Shift+D` / `Space` / `r` | ✅ Toasts mit Rückgängig |
| Rückgängig | `Ctrl+Z` | ✅ Trades, Quotes, Interpolation/ToY, Vols, Fixings, **Spot-Overrides, Import/Verwerfen/Verlassen, Kurve anlegen/entfernen**, Hedge-Doku (Ergebnis nicht – R7-06) |
| Tabellen | `↑/↓` `Home/End` `PgUp/PgDn` `Tab` | ✅ ein Zeilen-Tabstopp: Blotter (Kopfzeile `←/→`), Cashflows, **Amortisationsplan** (R6-02 ✓); Rest: Fixings-Editor und Vol-Grids (R7-01) |
| Toast-Aktion | `Tab` ab Skip-Link · `↵` | ✅ erster Stopp „Rückgängig (Ctrl+Z)“ |
| Palette | `Ctrl+K` · `↑/↓` · `↵` · `Esc` | ✅ Token-Fehler mit Grammatik, Kurven-Hinweis „+ Kurve“, `stichtag …` |
| Ansichten | `g …` · `Alt+1…8` · Rail | ✅ Prefetch, 15–121 ms warm |

---

## 6. Barrierefreiheits-Sweep (96 Zustände: alle Views, 11 Editoren, 4 Dokumente + Kundenmodus, Dialoge/Menüs/Popover, 1440 + 1024, Dark + Light)

| Prüfung | Ergebnis |
|---|---|
| Unbenannte Inputs/Checkboxen/Buttons/Links/Bilder/Dialoge/Composite-Rollen, doppelte IDs, positive Tabindizes, leere `kbd` | **0** in allen 96 Zuständen (`summary.a11yBad []`), inkl. „+ Kurve“-Formular („Währung der neuen Kurve“, „Index der neuen Kurve“, „Spot EUR/DKK“, „Quotes der neuen Kurve“, Fehler mit `role=alert`), Fixings-Filter, Import-Modus, Chunk-Fehlerkarte (`role=alert`) |
| Tabellen ohne Namen | **0** (Amortisationstabelle über `th`, FX-Spots `aria-label`) |
| Überschriften | `h1` „DERIVA“ einmal, `h2` = View-Titel, `h3` Karten (auch „+ Kurve aus Quotes anlegen“); **0 Sprünge** |
| Landmarks / Live-Region | `nav[aria-label=Hauptnavigation]`, `main#main` (`tabIndex=-1`, Fokusziel nach `Esc`), Skip-Link erster Tabstopp, Toast-Stack `role=status`; Skeleton `aria-busy` + `aria-live=polite` |
| Rollen / Roving | Blotter `grid`, Amortisationsplan `row`-Zeilen mit einem Tabstopp; Heatmaps `grid`; Kurven-Tabs `group[aria-label=Kurve]` mit `aria-pressed`, Zusatzkurven-Punkt `aria-label="aus Quotes angelegt"` |
| Kontrast | **5.450 Textpaare gemessen, alle Textfarben ≥ 4,5:1** (Dark + Light, 1440 + 1024); < 4,5 nur die 18-px-Icon-Glyphen der aktiven Rail-Tabs im Light-Theme (4,13:1, Nicht-Text ≥ 3:1, Label ≥ 4,5:1) |
| Texte | keine Engine-Texte, keine ISO-Daten außer Format-Beispielen (Hilfe „31.12.2027 · 2027-12-31“, Stichtag-Popover, Echo der CSV-Eingabe), Domänenbegriffe „Live“ (Status), „Cash Flow Hedge“, „Digital (Cash – Quote-Ccy)“, „MtM-Reset“, „Modified Following“, Grammatik-Beispiel „3.1%“ |
| Layout | keine horizontale Scrollbarkeit; Inspector 300 px ohne Beschnitt; FX-Vol-Tabs und „+ Kurve“-Formular bei 1024 px innerhalb der Karte; **Rest:** Key-Rate-Selektor +12 px bei FX-Produkten/1440 (R7-04) |
| Tabstopps | Blotter-Zeile nach **34** Tabs ab Skip-Link; Pricing 66–87 Stopps je Editor; **Markt 489–510** (R7-01) |
| Bewegung | Skeleton-Puls unter `prefers-reduced-motion: reduce` aus |

---

## 7. Was für 100 noch fehlt

1. **R7-F1** Zusatzkurven-Spots mit der Kurve speichern (oder `importSnapshot` ohne Quote-Reset), `leaveImport`/Stichtags-Verwerfen über `rebuildMarket` mit `extraCurves`, „+ Paar“ in der FX-Spot-Tabelle, E2E Import → Verlassen → Reload – ~1 h.
2. **R7-F2** Schnelleingabe wählt einen Index mit vorhandener Kurve (OIS-Fallback) und nennt ihn in der Vorschau; `CURVE_NOT_FOUND`-Warnung mit „+ Kurve“-Hinweis – ~30 min.
3. **R7-02** Editor-Listen für Währung/Index/Kollateral aus `knownCurrencies()`/`knownIndices()` und den Marktkurven – ~45 min.
4. **R7-01** Fixings-Editor und Vol-Grids mit Roving (`useTableNav`, Pfeiltasten, ein Tabstopp) – ~1 h.
5. **R7-03** Fokus nach `n …`/Palette auf „Bezeichnung“, nach „Kurve anlegen“/„Abbrechen“ auf Tab/Button – ~15 min.
6. **R7-04 / R7-05 / R7-06** `.seg.wrap` am Key-Rate-Selektor, Retry-Verhalten bei Bibliotheks-Chunk, Hedge-Ergebnis im Undo-Eintrag – ~40 min.

Erwartete Wirkung bei Umsetzung 1–6: UI/UX & Hotkeys ≈ 100, User Flows ≈ 100.

---

## 8. Artefakte

Basis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/r7-ui/`

- Skripte/Messwerte: `lib.mjs` (Helfer, generischer Kontrast-Sweep, a11y-Audit), `verify.mjs` (23 Checks, R6-Befunde), `flows.mjs` (39), `sweep.mjs` (8 Sammel-Checks über 96 Zustände), `lazy.mjs` (6), `probe2.mjs` (12: Import verlassen, DKK-Index, Hedge-Undo, Spot-Undo, 213 Trades), `probe3.mjs` (Überlauf, Textkontexte, 1024), `probe4.mjs` (ECharts-Retry, Hedge-Undo, Fixings-Tabstopps, SW), `probe5.mjs` (DKK-Editor, Badge nach Reload, Kurve entfernen), `probe6.mjs` (Key-Rate-Karte), `probe7.mjs` (Spot-Verlust, Fokus nach Trade-Anlage); `results-{v,f,s,l,p2,p3,p4,p5,p7}.json`, `verify.log`, `flows.log`, `sweep.log`, `lazy.log`, `probe*.log`; `../r7-e2e.log` (E2E OK, 395), `../r7-preview.log`
- Downloads: `v-snap.json`, `v-snap-after-spot.json` (Spot 1,25), `v-badvol.json`, `v-bad-{noschema,baddate,notjson}.json`, `v-csv-date.csv`, `v-csv-mixed.csv`, `tmpl-0…10.csv` (11 Vorlagen), `f-import*.csv`, `f-import-fehler.csv`, `f-portfolio*.json`, `f-snap-extra.json` (11 Kurven), `f-snap-date.json`, `f-hedge-doc.md`, `p2-portfolio-200.json`, `p5-snap.json`, `p7-snap.json`
- PDFs: `report-print.pdf`, `doc-{termsheet,kid,suitability,confirmation}-print.pdf`, `hedge-print.pdf`, `curves-print.pdf`, `blotter-print.pdf`, `pricing-print.pdf`
- Sweep-Screenshots (96): `{1440,1024}-{dark,light}-{blotter,pricing,pricing-fxo,curves,curves-add,market,scenarios,report,compare,hedge,palette,help}.png`, `{1440,1024}-dark-editor-{irs,cap,swpt,fxf,fxo,basis,amort,imm,fxs,ccs,fra}.png`, `{1440,1024}-dark-doc-{termsheet,kid,suitability,confirmation,termsheet-customer}.png`, `{1440,1024}-dark-{export-menu,csv-errors,market-import-override,curves-import,toast,valdate-popover,context-menu,onboarding}.png`, `print-{report,doc-*,hedge}.png`
- Befunde: `v-chunk-failure.png`, `v-echarts-failure.png`, `v-curves-import-locked.png`, `v-editor-amort.png`, `v-csv-errors.png`, `v-market-import-spot.png`, `f-curves-dkk.png`, `f-pricing-dkk.png`, `f-blotter-templates.png`, `f-blotter-after-remove-dkk.png`, `p2-after-leave-dkk.png`, `p2-dkk-irs-default.png`, `p2-editor-dkk.png`, `p2-blotter-213.png`, `p3-add-curve-1024.png`, `p4-echarts-retry.png`, `p4-market-fixings.png`, `p5-dkk-editor.png`, `p6-keyrate-fxo.png`, `p6-keyrate-fxo-1024.png`, `p6-pricing-fxo.png`, `p7-after-leave-reload.png`, `l-skeleton-scenarios.png`, `l-offline-reload.png`, `l-offline-first.png`
