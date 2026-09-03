# DERIVA – Review UI/UX, Hotkeys und User Flows

**Reviewer-Rolle:** Senior Product Designer / Front-end-Architekt (Trading-/Treasury-Workstations)
**Datum:** 2026-09-03 · **Modus:** Review only, keine Quellcode-Änderungen

## 0. Prüfstand und Geltungsbereich

| | |
|---|---|
| Repo-Stand | HEAD `2cb1571` **plus** ungeprüfte Working-Tree-Änderungen (siehe `git status`; 12 Web-Dateien geändert, `ErrorBoundary.tsx` neu). Während des Reviews wurde parallel weiterentwickelt und `dist` einmal neu gebaut. |
| Geprüftes Bundle | `apps/web/dist/assets/index-BR-1pki5.js` (gebaut 20:20:53 UTC). **Hinweis:** `TradeEditor.tsx` (20:21:52) und `lib/format.ts` (20:22:11) sind neuer als das Bundle – zwei Befunde (F-31 „-0", F-33 ungerundeter FX-Kurs) sind im Quelltext bereits behoben, aber noch nicht im Build. Erster Durchlauf lief gegen das Vorgänger-Bundle `index-DMp1cNMr.js` (Screenshots unter `…/ui-review/r1/`). |
| Werkzeug | Playwright + Chromium (`/opt/pw-browsers/chromium`), `vite preview --port 4174`, Locale `de-DE`, Viewports 1600×1000, 1280×800, 1920×1080, Dark + Light. Skripte: `…/ui-review/run.mjs`, `run2.mjs`, `run3.mjs`; Messwerte in `results.json`, `results2.json`. |
| Quellen gelesen | `apps/web/src/**/*.tsx|ts`, `styles/*.css`, `docs/product/03-ui-konzept-und-hotkeys.md`, Working-Tree-Diff. |
| Konsole | Keine JS-Fehler/Page-Errors in allen Durchläufen. Nur: Google-Fonts-Request blockiert (`ERR_CONNECTION_RESET` → Fallback-Font, s. F-46) und ein 404 (`/favicon.ico`, kein Favicon definiert). |

Screenshot-Verzeichnis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/ui-review/` (Übersicht in Abschnitt 7).

---

## 1. Scores

### 1.1 UI/UX & Hotkeys: **62 / 100**

Begründung (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, UX-Reibung −1…−3, kosmetisch −0,2…−1):

**Stärken (was Best-in-Class-Niveau erreicht):**
- Klare Informationsarchitektur: Rail · Topbar mit Palette · Inspector · Statusbar mit Chord-Indikator. Visuell ruhig, dichte Monospace-Zahlen mit Tabellenziffern, konsistente Vorzeichenfarben.
- Command Palette mit Live-Interpretation der Schnelleingabe (Screenshot `1600-dark-palette-quickentry.png`) ist ein echtes Differenzierungsmerkmal; Fehlermeldung bei unvollständiger Eingabe erscheint inline.
- Chord-Hotkeys mit Statusanzeige, Hilfe-Sheet mit allen Gruppen, Alt+1…6 funktioniert auch in Eingabefeldern (verifiziert).
- Live-What-if in Millisekunden mit farbig markiertem Chip in der Topbar.
- Theme-Umschaltung inkl. Persistenz; Charts lesen CSS-Tokens zur Laufzeit und wechseln sauber mit (Light-Screenshots).
- Neue `ErrorBoundary` je View (Working Tree) – ein Panel-Fehler legt nicht mehr die Workstation lahm.

**Abzüge (kumuliert ≈ −38):**
- Kritisch −10: `]` `[` `\` auf deutschen Tastaturen nicht erreichbar (AltGr/Option wird abgelehnt) – das Kernfeature „Live-What-if" ist für die Zielgruppe per Tastatur tot (F-01).
- Hoch −6: `Enter` als globaler Hotkey feuert zusätzlich auf jedem fokussierten Button → Filter/Rail-Klick per Tastatur springt ungewollt in den Pricing-Workspace (F-02).
- Hoch −6: Zahlenfelder lassen sich nicht leeren (springen auf 0, „02.5", „05000000"); keine Plausibilitätsgrenzen (325 % Festsatz, negative Nominale, Kauf = Verkaufswährung werden stumm akzeptiert) (F-03, F-04).
- Hoch −4: `Esc` verlässt Eingabefelder nicht → nach jeder Bearbeitung sind alle Einzeltasten-Hotkeys ohne sichtbaren Grund tot, bis man mit der Maus klickt (F-05).
- Hoch −3: Kein `:focus-visible`-Styling, Fokusring im Dark-Theme praktisch unsichtbar; sortierbare Spaltenköpfe, Tabellenzeilen, Segment-Buttons, Toast ohne ARIA-Semantik (F-06, F-07).
- Mittel −3: Gemischte Dezimaltrennzeichen („10.3 bp" neben „-10.261") → in einem deutschen Report mehrdeutig (F-08).
- Mittel −2: `j`/`k` scrollen die Auswahl nicht in den sichtbaren Bereich und ignorieren Sortierung/Filter (F-09).
- Mittel −2: Light-Theme: `--pos`, `--warn`, `--info`, `--fg-3` und FX-Badge verfehlen WCAG AA (F-10).
- Restliche UX-Reibungen/Kosmetik (Analytics-Label-Dubletten, IDs wie `CAP-mtlyu5c4-9`, englische Fehlermeldungen, 1280-Overflow, fehlender Undo, Delete ohne Bestätigung, tote Fläche in KPI-Karten) ≈ −2.

### 1.2 User Flows: **57 / 100**

- (a) Indikation im Kundengespräch: **gut** – `Ctrl+K` → `collar 7y 3.5/1.5 6m` → `↵` liefert in ~3 s Preis + Editor. Abzüge: Kontrahent leer, kryptische ID, Prämie ohne Währung/Einheit im Toast, Par-Satz-Übernahme nur nach Maus-Blur erreichbar (−6).
- (b) Stichtagsbewertung + Export: **schwach** – Bewertungstag nur in der Markt-Ansicht (3 Schritte, kein Hotkey), **kein Portfolio-Export** außer dem neuen EMIR-CSV (ohne PV-Spalten-Wahl), **kein Persistieren des Bestands** (Reload verwirft alle angelegten Trades – verifiziert), What-if-Zustand nicht im Export markiert (−16).
- (c) Marktfolge prüft Kurve/Sensitivitäten: **mittel** – Kurven-Quotes-Zustand desynchronisiert beim View-Wechsel, Bewertungstag-Wechsel verwirft Quote-Änderungen stumm, kein „modifiziert"-Flag am Snapshot-Chip, Key-Rate-Tabelle fehlt (nur Chart) (−10).
- (d) Prüfer liest Report: **mittel** – Report übernimmt aktiven What-if-Shift ohne Kennzeichnung (auch im JSON), `erstellt`-Zeitstempel ändert sich bei jedem Render, Druck zeigt schwarze Eingabefelder/Tabellenkopf, englische Kernmeldungen, kein Versions-/Nutzer-/Snapshot-Hash (−11).

---

## 2. Findings-Tabelle

Schweregrade: **Kritisch** (blockiert Kernnutzen/Zielgruppe), **Hoch** (falsche Zahl/Zustand oder massive Reibung), **Mittel** (spürbare Reibung, Inkonsistenz), **Niedrig** (kosmetisch).

| # | Schwere | Wo (Datei / Komponente / View) | Was ist falsch (Beleg) | Konkreter Fix |
|---|---|---|---|---|
| F-01 | **Kritisch** | `hotkeys/useHotkeys.ts` `eventMatches()`; Keymap `bump.up/down/reset` | `]`, `[`, `\` liegen auf DE-Layout unter AltGr+9/8/ß (Windows: `ctrlKey+altKey`), auf macOS unter Option+6/5/7 (`altKey`). `eventMatches` verlangt `e.altKey === combo.alt` (false) → Hotkey feuert nie. Verifiziert per synthetischem Event (`altgr.bracket.windows.chip` unverändert, `plain.bracket.chip` +10bp). Ebenso `Alt+1…6` auf macOS: Option+1 liefert `e.key="¡"` → kein Match (`mac.option1.crumb` unverändert). | In `eventMatches`: für `wantsShiftedSymbol`-Keys **auch** `altKey`/`ctrlKey` ignorieren, wenn `e.key` exakt passt (AltGr-Erzeugnis); für `alt+<digit>` zusätzlich `e.code === "Digit"+n` prüfen. Zusätzlich layoutneutrale Aliase registrieren: `bump.up: "]" \| "shift+ArrowUp" \| "+"`, `bump.down: "[" \| "shift+ArrowDown" \| "-"`, `bump.reset: "\\" \| "0"`; Keymap-Typ `keys: string[]` zulassen und im Help-Sheet beide anzeigen. |
| F-02 | **Hoch** | `useHotkeys.ts` `isEditable()`; Keymap `open: "enter"` | `isEditable` schließt nur INPUT/TEXTAREA/SELECT aus. `Enter` auf fokussiertem `<button>` (Filter „Zins", Rail „Kurven", Topbar-Cmd-Button) löst Klick **und** `open` → View springt nach Pricing (`enter.on.segbutton.crumb = "/ Pricing"`, `enter.on.cmdbutton.palette = 0`). Tastaturnutzer können Filter/Rail nicht bedienen. | `isEditable` um `BUTTON`, `A[href]`, `[role=button]`, `SUMMARY`, `[contenteditable]` erweitern **oder** `open` nur feuern, wenn `document.activeElement === document.body \|\| activeElement.closest("tr")`. Zusätzlich `e.target.closest(".rail, .seg, .btn")` → return. |
| F-03 | **Hoch** | `components/TradeEditor.tsx` `NumInput` | Controlled `type=number` mit `Number(e.target.value)`: Leeren des Felds → `Number("")=0` → sofort `onChange(0)` → Feld zeigt „0", Nominal 0, PV 0. Weitertippen ergibt „02.5", „05000000" (verifiziert `rate.typed.2.5 = "02.5"`). Kein Dezimalkomma; keine Tausendertrennung im Feld („10000000"). | `NumInput` auf lokalen String-State umbauen: `const [txt,setTxt]=useState(fmt(value))`; `onChange` nur parsen wenn `/^-?\d+([.,]\d*)?$/` und Wert endlich; commit bei `blur`/`Enter`; Komma→Punkt normalisieren; bei Blur mit `Intl.NumberFormat("de-DE")` formatieren; `inputMode="decimal"`, `type="text"`; Einheit als Suffix-Span (`%`, `bp`, `EUR`) statt im Label. |
| F-04 | **Hoch** | `TradeEditor.tsx` alle Felder; `state/store.ts updateTrade` | Keine Plausibilitätsprüfung: Festsatz 325 % akzeptiert (PV −232 Mio, kein Hinweis; `rate.comma.pv`), Nominal −5 Mio → PV 0 ohne Warnung, FX-Forward Kauf=Verkauf USD/USD → PV −756 k ohne Warnung, FXO Lieferung vor Verfall akzeptiert, Ende<Start liefert rohen englischen Core-Fehler `terminationDate must be after effectiveDate` als Text unter den KPIs (Screenshot `1600-dark-editor-invalid-dates.png`). | Validierungsschicht `lib/validate-trade.ts` → `{field, level, msg}`; im Editor `aria-invalid` + roter Rahmen (`.field.invalid input{border-color:var(--neg)}`) + Meldung unter dem Feld; Grenzen: Rate ∈ [−5 %, 25 %] Warnung, Nominal > 0, Start<Ende, Verfall≤Lieferung, buyCcy≠sellCcy. Core-Fehler auf Deutsch mappen (`ERROR_DE: Record<string,string>`). |
| F-05 | **Hoch** | `useHotkeys.ts`, `App.tsx` `case "escape"` | `Esc` in Eingabefeld tut nichts (`edit.escape.blur = INPUT`, `blotter.escape.blurs.input = INPUT`). Danach sind alle Einzeltasten tot; kein visueller Hinweis. Keyboard-first-Versprechen bricht nach jedem Edit. | `case "escape"`: `if (isEditable(document.activeElement)) { (document.activeElement as HTMLElement).blur(); break; }`. Statusbar-Hinweis „Eingabemodus – Esc beendet" anzeigen, solange `document.activeElement` editierbar (kleiner `focusin/focusout`-Listener). |
| F-06 | **Hoch** | `styles/app.css` (kein `:focus-visible`) | Fokusring = UA-Default `outline: auto 1px rgb(16,16,16)` → auf `--bg-1` unsichtbar (`focus.visible`, Screenshot `1600-dark-focus-ring.png`). Tab-Navigation ist blind. | `:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--radius-s)}` global; `.rail button:focus-visible{box-shadow:0 0 0 3px var(--accent-soft)}`; `.grid-table tr:focus-visible{outline-offset:-2px}`. |
| F-07 | **Hoch** | `views/Blotter.tsx` `<th onClick>`, `<tr onClick>`; `.seg button`; `.toast`; `HotkeyOverlay` | Sortier-`th` sind keine Buttons, kein `aria-sort`, nicht tabbar (`thSortable 9, thAriaSort 0, thTabbable 0`); Zeilen nicht fokussierbar, kein `aria-selected`; Segment-Buttons ohne `aria-pressed` (`segPressed 0`); Toast ohne `aria-live` (`live 0`); Overlay ohne Fokusfalle/Autofokus/Schließen-Button (`help.focus.after.tab = DIV.sheet`); kein `<h1>`. Palette gibt Fokus nach Schließen an `body` statt an das vorherige Element zurück. | `th` → `<th aria-sort=…><button class="th-btn">…</button></th>`; `tr tabIndex={0} role="row" aria-selected`; `.seg button aria-pressed`; `.toast role="status" aria-live="polite"`; Overlay: `role="dialog" aria-modal`, Autofokus auf Sheet, Schließen-Button, Fokusfalle (`inert` auf `.app` während offen); Palette: `prevFocus=useRef(document.activeElement)` und im Unmount `prevFocus.current?.focus()`. `.topbar .title` → `<h1>`. |
| F-08 | **Hoch** | `views/ReportView.tsx` (`marginBp.toFixed(1)`, `marginPct.toFixed(3)`), `PricingWorkspace.tsx keyMetric()`, `Inspector.tsx analyticsRows()`, `CurvesView.tsx`, `MarketView.tsx` | Dezimalpunkt und Tausenderpunkt koexistieren: Report „10.3 bp", „0.103 %" neben „-10.261" (Screenshot `1600-dark-report.png`); Pricing „0.85390", „1.201 %", „145.6", „7.79 J", DF „0.983738", Tagefaktor „1.005556" neben „2,6975 %", „-5,37". Für einen Prüfer ist „10.261" vs. „10.3" nicht eindeutig. | Ein Formatter-Satz in `lib/format.ts`: `fmtNum(v, digits)` immer `Intl.NumberFormat("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d})`; alle `toFixed(` in Views durch `fmtNum/fmtPct/fmtBp` ersetzen (grep: 31 Treffer). Für DF/Tagefaktor `fmtNum(v,6)`; Jahre `fmtNum(v,2)+" J"`. Toast/Quick-Description ebenfalls (`3.500%` → `3,500 %`). |
| F-09 | **Hoch** | `store.ts selectNext()`, `Blotter.tsx` | `j/k` navigieren in Store-Reihenfolge, nicht in der sichtbaren (sortiert/gefiltert) Reihenfolge → springt in ausgeblendete Zeilen; kein `scrollIntoView` (mit 36 Zeilen Auswahl außerhalb des Viewports, `blotter.many.selected.visible=false`, Screenshot `1600-dark-blotter-many-rows.png`). | Blotter registriert die sichtbare ID-Liste im Store (`setVisibleIds(filtered.map(r=>r.t.id))`), `selectNext` iteriert darüber; in Blotter `useEffect(()=>document.querySelector("tr.selected")?.scrollIntoView({block:"nearest"}),[selectedId])`. |
| F-10 | **Hoch** | `styles/tokens.css [data-theme=light]`; `.badge.fx`, `.badge.opt` | Light-Kontraste gemessen: `--pos/--bg-1` 3,30:1, `--warn` 3,19, `--info` 2,43, `--fg-3` 2,56, `--fg-2/--bg-3` 3,98 (alle < 4,5 für 11–12 px Text). FX-Badge `#06b6d4` auf Tint ≈ 2,2:1. PV-Spalten in Grün sind im Light-Theme schwer lesbar (`1600-light-blotter.png`). Dark: `--fg-3` 2,96 (Rail-Ziffern, Palette-Gruppen), Weiß auf `--accent` 3,22 (Primary-Button). | Light-Tokens: `--pos:#15803d` (4,6:1), `--warn:#b45309` (4,6:1), `--info:#0e7490` (5,0:1), `--fg-3:#64748b`→ für Text `--fg-2` nutzen, `--fg-3` nur dekorativ; Badges mit eigenen Text-Tokens `--badge-fx-fg:#0e7490` etc. Dark: `--accent` für Buttontext auf `#3b7de8` oder Text `--fg-0` auf `accent-soft`. Kontrast-Test in Vitest (`wcag-contrast`) für alle `fg×bg`-Paare. |
| F-11 | **Hoch** | `ReportView.tsx`, `pricing-core buildValuationReport` | Bei aktivem What-if (z. B. +20 bp) rechnet der Report mit `s.market` (geshiftet), Kopfzeile sagt aber „Snapshot Sample EoD" ohne Shift-Hinweis; JSON-Export enthält keinen What-if-Marker (`report.mentions.whatif=false`, `report.json.whatif=false`). Prüfer erhält unmarkierte Stress-Zahlen. | Report-Header: `{whatIfActive && <span className="badge warn">What-if +20bp / FX 0% – nicht prüfungsfähig</span>}`; `report.market.label = base.label + " · What-if …"`; `whatIf` in `buildValuationReport(..., {whatIf})` ins JSON schreiben; Export-Buttons bei aktivem Shift mit Bestätigung. |
| F-12 | **Hoch** | `views/CurvesView.tsx` (`useState(quotes)`), `store.ts setValuationDate` | Quotes werden lokal im View gehalten: Bump +10 bp → Input 2,15; View wechseln und zurück → Input zeigt wieder 2,05, Zero-Spalte aber 2,1532 % (verifiziert `curves.desync`). Bewertungstag-Wechsel in „Markt" baut `buildSampleMarket(d)` ohne Quotes → alle Quote-Änderungen stumm verworfen (`curves.after.datechange.zero=2,0523`). Topbar-Chip bleibt „Sample EoD". | `quotes: SampleMarketQuotes` in den Store heben (`setQuotes`, `resetQuotes`), `setValuationDate` → `buildSampleMarket(d, get().quotes)`; Chip erhält `meta.modified=true` → Label „Sample EoD · modifiziert" + Punkt in `--warn`; geänderte Quote-Zellen mit `.edited{border-color:var(--warn)}` und Tooltip „Original 2,05 %". |
| F-13 | **Hoch** | `store.ts` (kein Persist), `App.tsx` | Trades/Marktänderungen gehen bei Reload verloren (`reload.status = 11 Trades` nach Anlage von 3 Trades), Theme dagegen persistiert → inkonsistente Erwartung; Treasurer verliert Stichtagsarbeit. | `zustand/middleware persist` mit `partialize: s=>({trades, valuationDateIso, reportingCurrency, inspectorOpen, view})`, Key `deriva.v1`; Hinweis-Toast „Bestand aus lokalem Speicher geladen (n Trades) · Zurücksetzen" mit Aktion. |
| F-14 | **Hoch** | `Inspector.tsx analyticsRows()` | FX-Option: `strike` und `premiumQuotePerUnit` fallen in den `fmtMoney(…,0)`-Zweig → „Strike **1**" statt 1,1500 und „Prämie / Einheit **0**" (verifiziert `fxo.analytics.values`; Screenshot `1600-dark-editor-FXO-0001.png`). Cap/Floor: `Delta 14.598.787`, `Gamma -60.871.617` als Geldbetrag ohne Einheit. | Formatter-Map je Key statt Heuristik: `FORMAT: Record<string,(v)=>string>` (`strike:fmtNum(v,4)` für FX, `premiumQuotePerUnit:fmtNum(v,5)`, `delta:fmtMoney+" /1%"` …); unbekannte Keys `fmtNum(v,4)` statt `fmtMoney`. Label + Einheit aus einer Tabelle (`LABELS`, `UNITS`). |
| F-15 | **Mittel** | `PricingWorkspace.tsx` Analytics-Tabelle | Dubletten: „Vega fx (+1bp/+1pt)" dreimal (Key `k.split(":")[0]` verwirft Bucket), „Gamma" + „Gamma (1bp²)", „Vega" + „Vega caplet", „Delta (Basis-Ccy)" + „FX-Delta 1% USDEUR"; Basis-Swap KPI „Par-Satz –" (kein Festzins) statt „Fairer Spread 8,1 bp" (Screenshot `1600-dark-editor-new-basis.png`). | Vega-Label mit vollem Key (`Vega EURUSD 1Y`), Analytics-Sektion und Risiko-Sektion mit Zwischenüberschriften („Preis-Analytics" / „Risiko (Bump)") trennen; `keyMetric` für Legs ohne Fixed → `fairSpread` in bp. |
| F-16 | **Mittel** | `quick-parser.ts`, `templates.ts`, `store.ts duplicateSelected`, `pricing-core make*` | IDs: `CAP-mtlyu5c4-9`, `BASIS-MTLZBI0R-1`, IMM-Swap erhält Präfix `IRS-`, Duplikat `IRS-0002-COPY-5LB8`, Kette `…-COPY-…-COPY-…` und Name „(Kopie) (Kopie) (Kopie)…" (Screenshot `1600-dark-blotter-many-rows.png`). Unlesbar in Palette, Blotter, Inspector-Titel (umbricht 6 Zeilen). | Store-Sequenz je Typ: `nextId(prefix)` → `CAP-0002`; Duplikat: Basis-ID + ` (Kopie n)`, Name mit `/ \(Kopie( \d+)?\)$/` bereinigen; Inspector/Blotter ID-Zelle `max-width:160px; text-overflow:ellipsis; title`. |
| F-17 | **Mittel** | `templates.ts`, Quick-Entry, `Blotter.tsx byCpty` | Neue Trades ohne Kontrahent → Blotter „–", KPI-Karte „PV je Kontrahent" erhält Bucket „–" (`1600-light-blotter.png`), EMIR-CSV mit leerem Counterparty. | Kontrahent-Pflichtfeld-Hinweis (`.field.warn`), Default „(offen)" und Filter-Chip „ohne Kontrahent"; Quick-Entry-Token `@Landesbank` → counterparty. |
| F-18 | **Mittel** | `App.tsx` `case "delete"`, `PricingWorkspace` ✕-Button, `store.ts` | `Shift+D` und ✕ löschen sofort, kein Bestätigen, kein Undo (`Ctrl+Z` no-op, `undo.status` unverändert); ✕ und ⧉ haben keinen `title`/`aria-label` (`pricing.header.buttons`). `d` und `Shift+D` liegen auf derselben Taste. | Toast mit Aktion „Rückgängig" (5 s), `store.undoStack` (letzte 20 Trade-Snapshots), `mod+z`; Delete-Hotkey auf `shift+backspace`/`del` legen, `Shift+D` behalten mit Bestätigung bei ≥ 1 Trade; Buttons `title="Duplizieren (d)"`, `title="Löschen (⇧D)"`. |
| F-19 | **Mittel** | `PricingWorkspace.tsx WhatIfSlider` | Negative Werte werden grün (`className={value===0?"muted":"pos"}`) – „-10 bp" in `--pos` (Screenshot `1600-dark-pricing-whatif-neg.png`). | `signClass(value)` verwenden oder neutral `--accent`; zusätzlich numerisches Eingabefeld neben dem Slider (Schritt 1 bp). |
| F-20 | **Mittel** | `CommandPalette.tsx` | Palette-Score durchsucht `label desc id` – Kontrahent nicht enthalten (`palette.search.counterparty = []`); Aktionen ohne Parität zu Hotkeys (kein „CSV exportieren", „Par übernehmen", „Richtung tauschen", „Duplizieren", „Löschen", „Bewertungstag setzen", „Trade nach ID/Name suchen"); `Tab` füllt ein **zufälliges** Beispiel (nicht vorhersehbar); Footer „40 Tastenkürzel" zählt `escape` und Aliase mit. | Items aus `HOTKEYS` generieren (jede Def = Palette-Item mit `run` aus `onHotkey`), Trade-Items mit `counterparty` im Suchtext; `Tab` = aktives Item als Text übernehmen/vervollständigen, Beispiele per `↑` rotieren; Zähler = `HOTKEYS.filter(h=>h.group!=="Navigation"||!h.id.startsWith("view.")).length`. |
| F-21 | **Mittel** | `HotkeyOverlay.tsx`, `useHotkeys.ts` | Während Overlay offen: `g p`, `t`, `c`, `]` wirken im Hintergrund; während Palette offen wirken `Alt+n`; Sheet scrollt bereits bei 1000 px Höhe (852 > 848). | `useHotkeys(..., {enabled: !helpOpen && !paletteOpen})` bis auf `escape`/`help`; Sheet `max-height:85vh` + 4-Spalten-Layout ab 1400 px, `.overlay .cols{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}`. |
| F-22 | **Mittel** | `Blotter.tsx` Tabelle | Keine Leerzustands-Zeile bei Filter/Suche ohne Treffer – nur Kopf + „Summe (0)" (`1600-dark-blotter-empty-filter.png`); leeres Portfolio zeigt vier leere KPI-Karten ohne Call-to-Action (`1600-dark-blotter-empty.png`). | `{filtered.length===0 && <tr><td colSpan={9} className="empty">Keine Treffer für „{q}" · <button class="btn ghost" onClick=reset>Filter zurücksetzen</button></td></tr>}`; Empty-State-Karte „Noch keine Trades – `n s` Swap, `Ctrl+K` Schnelleingabe, Beispielportfolio laden". |
| F-23 | **Mittel** | `Blotter.tsx` `.grid.cols-4` | KPI-Karten werden durch die Chart-Karte (280 px) auf ~290 px gestreckt → 60 % tote Fläche (alle Blotter-Screenshots). Chart-Karte hat keinen Titel; X-Achse „1,00 Mio2,00 Mio" überlappt (`1600-dark-blotter-many-rows.png`). | `.grid.cols-4{align-items:start}` oder `.chart.mini{height:150px}`; `<h3>PV je Typ</h3>`; `axisLabel:{formatter:fmtCompact, hideOverlap:true}` und `splitNumber:2`. |
| F-24 | **Mittel** | `Blotter.tsx` Kopfzeile, `CurvesView.tsx .seg`, `MarketView.tsx .grid.cols-3` (1280 px) | Bei 1280×800 mit Inspector: Blotter-Kopf umbricht („⤓ / EMIR", „n+… / neu"), Spalten PV/DV01/Status abgeschnitten ohne Scroll-Affordance (`1280-dark-blotter-current.png`); Kurven-Segment „EUR €STR OIS" bricht auf 2 Zeilen, Segmentleiste überläuft (`1280.curves.overflow: DIV.seg`); Markt: `.main` horizontal scrollbar (929 > 884 px, `1280-dark-market.png`). | `.card h3 .right{flex-wrap:wrap;row-gap:6px}`; Segment-Labels kurz („€STR", „EUR 6M", „SOFR") + `white-space:nowrap`; `.grid.cols-3{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}`; Tabellen-Container mit Schatten-Indikator (`mask-image` rechts) und Spaltenauswahl (siehe 4.). Inspector unter 1360 px automatisch einklappen (`@media (max-width:1360px) .app.with-inspector{grid-template-columns:var(--rail-w) 1fr}` + Inspector als Overlay). |
| F-25 | **Mittel** | UI-Texte gesamt (Core-Meldungen, Badges) | Sprachmix: „Missing fixing for EURIBOR-6M on 2026-06-15; used curve forward", „XVA not implemented for CapFloor (v1 supports IRS and FX forwards)", `terminationDate must be after…`, Trade-Namen „Payer swaption 1Yx5Y", „Sell EURUSD", Badges „Fixed/Float/FX Buy/FX Sell", Cashflow-Art „Interest/OptionPayoff/Notional", Optionen „Cash/Physical", „None/UpOut". | `lib/i18n.ts` mit `t(key)`; Core-Warnungen strukturiert (`{code:"MISSING_FIXING", index, date}`) → deutsche Templates; Badge-Labels über Map (`Fixed→Fest`, `Float→Variabel`, `FX Buy→Kauf`); Select-Optionen mit `{v,l}`. |
| F-26 | **Mittel** | `ReportView.tsx` | `generatedAt` ändert sich bei jedem Render (Tastendruck im Spread-Feld) → „erstellt 20:16:59" ist kein Beleg; kein App-Version-/Snapshot-Hash/Bearbeiter; Transaktionspreis-Feld ist Freitext: „abc" lässt die Kostentabelle stumm verschwinden (`report.offer.abc.table=undefined`). | `useMemo`-Report nur bei explizitem „Report erzeugen" (Button + `mod+shift+r`), Header mit `Version`, `market.hash` (SHA-1 des Snapshot-JSON), Bearbeiter (aus Login/Env); Freitext → `NumInput` mit Währungssuffix und Fehlerhinweis. |
| F-27 | **Mittel** | `styles/app.css @media print`, `ReportView.tsx` | Druck (Working-Tree-CSS): Eingabefelder bleiben dunkle Kästen mit weißer Schrift, Tabellenkopf der Kurventabelle ist ein schwarzer Balken mit unsichtbarem Text (`1600-report-printmedia-current.png`); keine Seitenkopf-/Fußzeile, Chart ohne Rahmen, KPI-Karten 4-spaltig zu breit für A4 hoch. | `@media print{.field input,.field select{background:#fff;color:#111;border:1px solid #ccc} table.grid-table th{background:#fff;color:#444;position:static} .grid.cols-4{grid-template-columns:1fr 1fr} @page{size:A4;margin:14mm} .report-print-header{display:block}}`; Eingaben im Druck als statischer Text rendern (`<span className="print-only">`). |
| F-28 | **Mittel** | `MarketView.tsx` Bewertungstag | Stichtag ist nur in „Markt" setzbar (Date-Input + „Übernehmen"), kein Hotkey, keine Palette-Aktion; Topbar-Chip zeigt Datum, ist aber nicht klickbar. | Chip → Button öffnet Popover mit Date-Input + Presets („Heute", „Monatsende", „Quartalsende", „−1 Tag"); Palette-Kommando `stichtag 2026-12-31`; Hotkey `shift+t`. |
| F-29 | **Mittel** | `Blotter.tsx` (Export) | Kein Export des Bestands (Blotter-CSV mit PV/DV01/Warnungen), nur `Ctrl+E` = Cashflows **eines** Trades und (neu) EMIR-CSV mit festen Feldern; Report nur je Trade. | `exportBlotterCsv(filtered, columns)` mit sichtbaren Spalten; Palette „Blotter als CSV/XLSX"; Portfolio-Report (Summen, je Kontrahent, Warnungen) als JSON/CSV. |
| F-30 | **Mittel** | `PricingWorkspace.tsx` Key-Rate-Chart | X-Achsen-Labels 45° rotiert, 16 Buckets auf ~350 px → Labels überlagern („4D 11D 1M 3M…"); keine Tabellenform für Prüfung (`1600-dark-pricing.png`). | Chart breiter (2fr) oder Buckets zusammenfassen (<1Y, 1–5Y, …) mit Toggle „Alle"; Tabelle unter dem Chart (Bucket · Δ · kumuliert) mit `Ctrl+E`-Export. |
| F-31 | **Mittel** | `lib/format.ts fmtMoney` (im geprüften Bundle) | Blotter/KPI zeigen „-0" für DV01 von FX-Trades (`blotter.dv01.col`, `1600-dark-blotter.png`). Im Working Tree bereits mit Schwellwert 0,5 gefixt, Bundle stale. | Rebuild (`pnpm --filter @deriva/web build`); zusätzlich `Object.is(v,-0)` → 0 und `signClass` mit Schwelle `< 0.5` synchronisieren (sonst grau „0" neben grün „0"). |
| F-32 | **Mittel** | `useHotkeys.ts`, `App.tsx` `showToast` | Toast ist ein Single-Slot (letzter gewinnt, 2,2 s), keine Queue, keine Aktion, nicht `aria-live`; Aktionen ohne Feedback: `c` (Währungswechsel), `i`, Slider-Änderung. | `toasts: {id,msg,action?}[]`, gestapelt unten rechts, `role=status`, Dauer 3 s / mit Aktion 6 s; `c` → Toast „Reporting-Währung USD". |
| F-33 | **Niedrig** | `TradeEditor.tsx` FxSwap Far-Leg (Bundle) | „Kurs (verk./kauf)" = `0.847457627118644` ungerundet, Richtung nicht marktkonform (USD/EUR) (`1600-dark-editor-new-fxs.png`). Working Tree hat `marketRate()` + Rundung 1e-6 – Bundle stale. | Rebuild; zusätzlich `fmtNum(rate, 4)` im Feld, Label „Kurs EUR/USD". |
| F-34 | **Niedrig** | `App.tsx` Topbar `.cmd-button` | Anführungszeichen gemischt: „irs 10y pay 3.1% 10m") – öffnendes „ deutsch, schließendes " gerade. | `„irs 10y pay 3.1% 10m“` oder Beispiel ohne Anführungszeichen. |
| F-35 | **Niedrig** | `.rail button .hint` (`tokens --fg-3`, 9 px) | Ziffern 1–6 in 9 px `--fg-3` (Kontrast 2,96 dark / 2,56 light) – dekorativ, aber als Lernhilfe unlesbar. | 10 px, `--fg-2`, oder erst bei `.rail:hover`/`Alt` gedrückt einblenden. |
| F-36 | **Niedrig** | `CommandPalette.tsx` Ergebnisliste | Bei 57 Items keine Gruppen-Sticky-Header, kein Zähler, Trade-Items ohne PV/Kontrahent in `desc` – Auswahl gleichnamiger Kopien unmöglich. | `desc = \`${cpty} · ${fmtMoney(pv)} ${ccy}\``; `.palette .group{position:sticky;top:0;background:var(--bg-1)}`. |
| F-37 | **Niedrig** | `Inspector.tsx` | Nur erster Vega-/FX-Delta-Eintrag (`slice(0,1)`), Titel bricht bei langen IDs; Hinweiszeile enthält Hotkeys, die im Pricing gelten, Inspector ist dort aber ausgeblendet. | Alle Buckets als Mini-Tabelle; ID mit `ellipsis`; Hinweise kontextabhängig. |
| F-38 | **Niedrig** | `ScenariosView.tsx`, `MarketView.tsx` Heatmaps | Zellfarben hart codiert (`rgba(34,197,94,…)`, `rgba(239,68,68,…)`, `rgba(79,140,255,…)`) – Dark-Palette-Werte auch im Light-Theme; keine Tastaturnavigation, kein Klick → What-if setzen. | `color-mix(in srgb, var(--pos) calc(a*100%), transparent)`; Zelle als `<button>` → `setWhatIf({ratesBp:r, fxPct:f})`; Fokusreihenfolge Zeile/Spalte. |
| F-39 | **Niedrig** | `TradeEditor.tsx DateInput` | Native `type=date` (Locale-abhängig, im Test „06/17/2024"); keine Tenor-Eingabe („5Y"), keine Kalender-Prüfung (Wochenende). | Text-Input mit Tenor-Parser (`5Y`, `+3M`, ISO, `dd.mm.yyyy`) + Kalender-Popover; Warnung „kein Geschäftstag (TARGET)". |
| F-40 | **Niedrig** | `Blotter.tsx` Status-Badge | Warnungen nur als `title` (Hover), Anzahl „⚠ 1"; Fehler-Badge ohne Text. | Klick öffnet Popover mit Liste; Spalte „Warnung" mit gekürztem Text. |
| F-41 | **Niedrig** | `CurvesView.tsx` Vergleich | Beim Wechsel auf USD SOFR bleibt Vergleich „EUR-EURIBOR-6M" (`curves.usd.compare`) – sinnfrei; Vergleichsselect ungestylt (Inline-Style). | Vergleich auf gleiche Währung filtern / auf `null` setzen; `.field select`-Klasse verwenden. |
| F-42 | **Niedrig** | `ReportView.tsx` CVA-Karte | `\`-${fmtMoney(cva)}\`` erzeugt bei CVA ≤ 0 „--0"/„-0"; Vorzeichen manuell statt aus Wert. | `fmtMoney(-cva)` mit `signClass`. |
| F-43 | **Niedrig** | `App.tsx` Statusbar | Zeigt 5 feste Hotkeys, aber nicht den Eingabemodus, nicht „modifiziert", nicht Undo-Verfügbarkeit; „Bewertung 3.0 ms" mit Punkt. | Kontextabhängige Hints (View-spezifisch), `fmtNum(ms,1)`. |
| F-44 | **Niedrig** | `HotkeyOverlay.tsx` | „Neuer Cap/Floor" (Keymap) vs. „Neuer Cap / Floor / Collar" (Palette) – zwei Label-Quellen. | Labels aus `TEMPLATE_LABELS` in Keymap referenzieren. |
| F-45 | **Niedrig** | `Blotter.tsx` Doppelklick | Doppelklick öffnet Pricing, nirgends kommuniziert; Rechtsklick ohne Kontextmenü. | Hint „↵/Doppelklick öffnen"; Kontextmenü (Öffnen, Duplizieren, Löschen, Report). |
| F-46 | **Niedrig** | `index.html` | Google-Fonts extern (`fonts.googleapis.com`) – in abgeschotteten Banknetzen blockiert → Fallback-Font (im Test DejaVu), Layout/Metrik weicht ab; kein Favicon (404). | Inter + JetBrains Mono selbst hosten (`/public/fonts`, `font-display:swap`), `<link rel="icon">` mit Δ-SVG. |
| F-47 | **Niedrig** | `CommandPalette.tsx` Hinweiszeile | Beispielzeile bricht bei 720 px Breite in zwei Zeilen und ist im Monospace schwer lesbar; „(Tab füllt ein Beispiel ein)" ohne visuelles `kbd`. | Chips je Beispiel (`<button class="chip">irs 10y pay 3.1% 10m</button>`), klickbar. |

---

## 3. User-Flow-Bewertung (Schritt für Schritt)

### (a) Berater erstellt Indikation im Kundengespräch (< 10 s)
Gemessen: `Ctrl+K` → Tippen → `↵` → Pricing-Workspace mit Preis: **≈ 3 s**, Ziel erreicht.

| Schritt | Beobachtung | Reibung |
|---|---|---|
| 1. `Ctrl+K` | Palette öffnet, Fokus im Feld, Beispiele sichtbar | – |
| 2. `collar 7y 3.5/1.5 6m` | Live-Interpretation „Collar EUR 7Y @ 3.50 % / 1.50 % · Nominal 6.000.000" | Dezimalpunkt statt Komma (F-08); kein Kontrahent, kein Hinweis darauf (F-17) |
| 3. `↵` | Trade `CAP-mtlyu5c4-9` angelegt, Pricing offen, Toast „Angelegt: CAP-mtlyu5c4-9" | ID nicht kommunizierbar (F-16); Toast ohne Preis – der Berater will „Prämie 0,816 % = 48.974 EUR" sofort vorlesen |
| 4. Kunde fragt „und bei 3,25 %?" | Klick ins Cap-Strike-Feld, Wert tippen | Leeren des Felds setzt Strike 0 → PV springt (F-03); nach dem Tippen sind Hotkeys tot bis Maus-Blur (F-05) |
| 5. `Shift+P` (Par) | Funktioniert nur außerhalb des Felds | Nach Edit unerreichbar ohne Maus (F-05); für Cap/Floor gar nicht implementiert (`applyParSolve` default → undefined, kein Feedback) |
| 6. `]` für „+10 bp-Szenario" | Auf DE-Tastatur ohne Wirkung | **Blocker** (F-01) |
| 7. Indikation weitergeben | Kein „Indikation kopieren"/Ticket-Text; Report ist prüferorientiert | Fehlende „Termsheet/Indikation als Text"-Aktion (siehe 4.) |

### (b) Treasurer bewertet Bestand zum Stichtag und exportiert
| Schritt | Beobachtung | Reibung |
|---|---|---|
| 1. Stichtag setzen | `g m` → Date-Input → „Übernehmen" | 3 Schritte, kein Hotkey/Palette (F-28); Toast bestätigt, Chip aktualisiert – gut |
| 2. Marktdaten laden | Neu: Snapshot-Import (JSON) in Markt-Ansicht | Import validiert, gut; aber Quote-Edits der Kurvenansicht gehen beim Datumswechsel verloren (F-12); Chip zeigt nie „modifiziert" |
| 3. Bestand prüfen | Blotter: Summen, Warnungen als „⚠ 1" | Warnungen englisch, nur Hover (F-25, F-40); nach Datumswechsel 8 von 12 Trades mit Fixing-Warnung ohne Sammelhinweis |
| 4. Bewertung je Kontrahent | KPI-Karte zeigt Top 4 | Kein Drill-down, keine Gruppierung/Filter nach Kontrahent im Blotter |
| 5. Export | `Ctrl+E` exportiert Cashflows **eines** Trades; „⤓ EMIR" exportiert 12 feste Felder | **Kein Bestands-CSV mit PV/DV01** (F-29); Dateiname ohne Stichtag bei `Ctrl+E`; Erfolgstoast ok |
| 6. Nächster Tag | Reload | **Bestand weg** (F-13) |

### (c) Marktfolge prüft Kurve und Sensitivitäten
| Schritt | Beobachtung | Reibung |
|---|---|---|
| 1. `g c` | Kurve, Quotes, Pillars sichtbar, Live-Bootstrap | Sehr gut; Legende und Tooltip lesbar |
| 2. Quote ändern | Zero/DF aktualisieren live | Kein Diff zur Ausgangsquote, keine Markierung, Punkt-Dezimal im Input (F-12, F-08) |
| 3. View wechseln, zurück | Input-Werte springen zurück, Kurve bleibt geändert | **Inkonsistenz** (F-12) |
| 4. Sensitivität prüfen | Pricing → Key-Rate-Chart | Nur Chart, keine Tabelle/Export; Labels überlappen (F-30); Portfolio-Key-Rate fehlt (Blotter zeigt nur DV01 gesamt) |
| 5. Szenarien | `g s` – Standardszenarien + Matrix | Matrix nicht klickbar → kein Sprung in What-if (F-38); „Ausgewählter Trade" mit einzeiliger Tabelle ok |
| 6. Nachvollzug | Methodik-Text im Report | Kein Bootstrap-Log/Quote-Herkunft (Zeitstempel/Quelle je Quote) |

### (d) Prüfer liest Report
| Schritt | Beobachtung | Reibung |
|---|---|---|
| 1. `g r` | Report mit FV, CVA/DVA, Kostentransparenz, Exposure, Sensitivitäten, Methodik | Struktur gut; KPI-Karten klar |
| 2. Marktzustand verifizieren | Kopf „Snapshot Sample EoD" | **What-if-Shift unsichtbar** (F-11); kein Snapshot-Hash, keine Version, kein Bearbeiter (F-26) |
| 3. Zahlen lesen | „10.3 bp", „0.103 %", „-10.261" | Dezimal-/Tausenderpunkt mehrdeutig (F-08) |
| 4. Kostentransparenz | Freitext-Eingabe Transaktionspreis | Ungültige Eingabe blendet Tabelle stumm aus (F-26); Eingabefelder im prüfungsfähigen Dokument irritieren |
| 5. Drucken | Print-CSS vorhanden (Working Tree) | Dunkle Eingabekästen, schwarzer Tabellenkopf, keine Kopf-/Fußzeile (F-27) |
| 6. Exposure für Cap/Swaption/FXO | „XVA not implemented for CapFloor (v1 …)" | Englische Systemmeldung im Prüferreport (F-25); CVA/DVA „n/a" ohne Begründung im Text |
| 7. Reproduzierbarkeit | `erstellt 20:16:59` bei jedem Render neu | Kein stabiler Beleg (F-26) |

---

## 4. Fehlende UI-Fähigkeiten (Best-in-Class, jeweils in wenigen Stunden umsetzbar)

1. **Spaltenauswahl & -reihenfolge im Blotter** (`localStorage deriva.blotter.columns`), Ellipsis + Tooltip für lange IDs/Namen, optional Spaltenbreiten per Drag.
2. **Tastatur-Zeilenauswahl in allen Tabellen** (Cashflows, Pillars, Szenario-Tabelle): `↑/↓`, `Home/End`, `PageUp/Down`, `scrollIntoView`, `Enter` = Detail, `y` = Zeile als Text kopieren.
3. **Inline-Validierung** mit Feld-Markierung, deutscher Meldung und Blockade des Pricings statt PV „–".
4. **Undo/Redo** (`mod+z` / `mod+shift+z`) für Trade-Änderungen, Löschen, Quote-Edits – Toast mit „Rückgängig".
5. **Trade-Compare / Split-View**: zwei Trades nebeneinander (Pricing), Diff der Analytics; „Vorher/Nachher" bei Par-Übernahme.
6. **Gespeicherte Layouts** (Inspector an/aus, Blotter-Filter/Sortierung, letzte View, Palette-Historie) via `zustand persist`.
7. **Print-Stylesheet vervollständigen** + „Als PDF" (Browser-Druck mit Seitenkopf: Trade, Stichtag, Snapshot-Hash, Seite x/y).
8. **i18n-Toggle DE/EN** (`lib/i18n.ts`, Palette „Sprache wechseln"), inkl. Core-Meldungen, Badges, Zahlenformat (`de-DE`/`en-GB`).
9. **Zahlenfeld-UX**: Einheit als Suffix, Tausendergruppierung, Komma/Punkt, `↑/↓` ±Step, `Shift+↑` ×10, `Alt+↑` ×0,1, Kurzformen `10m`, `250k`, `25bp` direkt im Feld.
10. **Tooltips mit Definitionen** für Kennzahlen (DV01, Theta 1D, Gamma 1bp², EPE/ENE, IFRS-13-Level) per `title`/Popover – aktuell nur Labels.
11. **Fokus-Management der Palette**: Fokus-Rückgabe, `Tab` = Vervollständigen, `↑` = Historie, Enter auf Trade-Item mit `Shift` = Report öffnen.
12. **Toast-Queue** mit Aktionen, `aria-live`, Pausieren bei Hover.
13. **Empty States** mit Handlungsaufforderung (Blotter leer, Filter ohne Treffer, kein Trade in Pricing/Report/Szenarien – Szenarien zeigt heute Nulltabellen).
14. **Onboarding-Hinweis beim ersten Start** (localStorage-Flag): 3-Schritte-Karte „Ctrl+K · g p · ?" + Beispielportfolio laden/entfernen.
15. **Stichtag-Popover in der Topbar** (Presets, Hotkey), **„modifiziert"-Indikator** für Marktdaten.
16. **Blotter-Export (CSV/XLSX)**, **Indikations-Text kopieren** (`mod+shift+c`: „Payer-Swap EUR 10Y @ 2,6975 % · PV 0 · DV01 7.260 EUR · Stichtag 03.09.2026").
17. **Kontextmenü** (Rechtsklick) auf Blotter-Zeilen: Öffnen, Duplizieren, Löschen, Report, Szenario „nur dieser Trade".
18. **Klickbare Szenario-Heatmap** → setzt What-if; **Key-Rate-Tabelle** unter dem Chart mit Export.
19. **Kurzhinweis „Eingabemodus"** in der Statusbar + `Esc` beendet Eingabe.
20. **Layout-neutrale Alternativtasten** (`+`/`-`/`0` für What-if) und Anzeige beider Varianten im Hilfe-Sheet.

---

## 5. Light-Theme – spezifische Befunde

| # | Befund | Beleg | Fix |
|---|---|---|---|
| L-1 | `--pos #16a34a` auf `--bg-1 #fff` = 3,30:1; auf `--bg-2` 2,99 – alle positiven PV/DV01-Werte (12 px) unter AA | `contrast.light`, `1600-light-blotter.png` | `--pos:#15803d` (4,6:1) oder Werte in `--fg-0` mit farbigem Vorzeichen-Indikator |
| L-2 | `--warn #d97706` 3,19:1 – Warn-Badge „⚠ 1", Warnbox-Rand, What-if-Chip-Text | `1600-light-blotter.png`, `1600-light-pricing-whatif.png` | `--warn:#b45309`; Badge-Text `#7c2d12` |
| L-3 | `--info #06b6d4` 2,43:1 – FX-Badges (FXF/FXO/FXS) kaum lesbar | `light.badges` | `--info:#0e7490`; `.badge.fx{color:var(--info)}` mit eigenem `--badge-fx-fg` |
| L-4 | `--fg-3 #94a3b8` 2,56:1 – Palette-Gruppentitel, Rail-Ziffern | `1600-light-palette.png` | Text nie mit `--fg-3`; `--fg-3` nur für Trennlinien/Deko |
| L-5 | `--fg-2` auf `--bg-3` 3,98:1 – `kbd`-Beschriftung ist `--fg-1` (ok), aber Placeholder/„muted" auf Chips/Badges (`--bg-3`) fällt unter AA | Statusbar-Hints, Chips | Für Text auf `--bg-3` `--fg-1` verwenden |
| L-6 | Hartcodierte Dark-Farben im Light-Theme: `tr.selected outline rgba(79,140,255,.45)`, `.rail button.active border rgba(79,140,255,.35)`, `.badge.irs/.opt/.fx` Hintergründe, Heatmaps (`rgba(79,140,255)`, `rgba(34,197,94)`, `rgba(239,68,68)`) | `light.selected.row.outline`, `light.rail.active.border`, `light.heat.cell.bg`, `1600-light-market.png`, `1600-light-scenarios.png` | Tokens `--accent-line: color-mix(in srgb, var(--accent) 45%, transparent)` etc.; Heatmap-Alpha für Light auf `0.10 + 0.45a` reduzieren (Text bleibt `--fg-0`) |
| L-7 | Palette-Backdrop `rgba(0,0,0,.45)` + `blur(2px)` – im Light-Theme wirkt die Seite „ausgeschaltet", Kontrast zwischen Palette und Backdrop zu hoch | `1600-light-palette.png` | `[data-theme=light] .palette-backdrop{background:rgba(15,23,42,.28)}`; Overlay `.overlay{background:rgba(15,23,42,.35)}` |
| L-8 | Chip-Punkt Glow `--pos-soft` (Alpha 0,12) auf Weiß unsichtbar; Status „Markt aktiv" geht verloren | `light.chip.dot` | `[data-theme=light] .chip .dot{box-shadow:0 0 0 2px #fff,0 0 0 3px var(--pos)}` |
| L-9 | KPI-Karten und Cards ohne Kontrast zur Fläche (`--bg-1 #fff` auf `--bg-0 #f4f6fa`, `--shadow-1` 0,08) – Karten wirken flach, Hierarchie schwächer als im Dark-Theme | alle Light-Screenshots | `--shadow-1: 0 1px 2px rgba(15,23,42,.08), 0 0 0 1px rgba(15,23,42,.04)`; `--border:#cbd5e1` |
| L-10 | Primärbutton „Übernehmen" (`--accent #2563eb`, weißer Text 5,17:1) ok; **im Dark-Theme** dagegen 3,22:1 (Fail) – Themen invers behandeln | `contrast.dark white/--accent` | Dark: `.btn.primary{color:#0b0f17;background:#7fb0ff}` oder `--accent:#3b7de8` |
| L-11 | ECharts-Tooltip nutzt `--bg-3` (`#e6ebf3`) mit `--fg-0` – ok; Legendentext `--fg-2` 4,76 knapp ok; Achsenlinien `--border #d7deea` sehr blass | `1600-light-curves.png` | `xAxis.axisLine.lineStyle.color: var(--border-strong)` |
| L-12 | Warnbox: `--warn-soft` (Alpha 0,14) + `--fg-1` gut lesbar; aber Rand `--warn` 3,19:1 als einziges Signal-Farbelement | `1600-light-pricing.png` | siehe L-2 |
| L-13 | `color-scheme: light` gesetzt → native Date-Inputs/Scrollbars korrekt; Slider `accent-color` korrekt | – | – (positiv) |
| L-14 | Theme-Wechsel per `t` re-rendert Charts korrekt (Option-Objekt wird neu erzeugt) – positiv; aber `baseTheme()` liest Tokens zur Renderzeit: Charts in nicht sichtbaren Views behalten alten Zustand bis zum nächsten Render (nur bei Wechsel Dark→Light während Palette offen sichtbar) | Code `EChart.tsx` | `useEffect` auf `theme` im `EChart` → `setOption(baseTheme())` |

---

## 6. Hotkey-Konflikte und -Lücken (Zusammenfassung)

| Taste(n) | Problem | Empfehlung |
|---|---|---|
| `]` `[` `\` | DE-Layout (AltGr) und macOS (Option) → nie erkannt (F-01) | Modifier für Symbol-Keys ignorieren; Aliase `+` `-` `0` |
| `Alt+1…6` | macOS Option+Ziffer erzeugt Sonderzeichen (F-01) | `e.code`-Vergleich |
| `Enter` | Doppelauslösung auf Buttons (F-02) | Nur bei `body`/Tabellenzeile |
| `d` / `Shift+D` | Duplizieren/Löschen ohne Bestätigung/Undo auf einer Taste (F-18) | Undo-Toast; Delete auf `Del`/`⌫` |
| `f` | Einzeltaste tauscht die Ökonomie (Pay/Receive) still | Toast mit Undo; ggf. `Shift+F` |
| `c` | Wechselt Reporting-Währung ohne Toast; zyklisch statt wählbar | Toast; Palette-Auswahl |
| `r` | „Neu bewerten" ist bei Live-Pricing wirkungslos | Umwidmen zu „Report öffnen" oder entfernen |
| `t` | Theme-Toggle als Einzeltaste – versehentlich beim Tippen ohne Fokus | `Shift+T` oder nur Palette |
| `Tab` (Palette) | Zufälliges Beispiel (F-20) | Vervollständigen |
| Overlay offen | Hintergrund-Hotkeys aktiv (F-21) | Dispatcher deaktivieren |
| `Esc` | Kein Blur (F-05) | Blur + Chord-Abbruch |
| `Ctrl+E` | Nur ein Trade; Dateiname ohne Datum | `Ctrl+Shift+E` Blotter-Export |
| Fehlend | Stichtag, Undo, Blotter-Export, Report öffnen für aktuellen Trade, Filter-Chips (`1–4`), Suche fokussieren (`s`) | siehe Abschnitt 4 |

---

## 7. Screenshots (aktuelles Bundle `index-BR-1pki5.js`)

Basis: `/tmp/claude-0/-home-user-general/ba34afa7-bb32-5710-8abf-0fcec9f55ee0/scratchpad/ui-review/`

**Views Dark / Light 1600×1000:** `1600-dark-blotter.png`, `1600-dark-pricing.png`, `1600-dark-curves.png`, `1600-dark-scenarios.png`, `1600-dark-market.png`, `1600-dark-report.png`, `1600-light-blotter.png`, `1600-light-pricing.png`, `1600-light-curves.png`, `1600-light-scenarios.png`, `1600-light-market.png`, `1600-light-report.png`, `1600-light-blotter-inspector.png`, `1600-light-toast.png`, `1600-light-pricing-chart.png`, `1600-light-pricing-whatif.png`, `1600-light-market-heat.png`, `1600-light-curves-chart.png`, `1600-light-scenarios-heat.png`

**Palette / Hilfe / Chord:** `1600-dark-palette-empty.png`, `1600-dark-palette-quickentry.png`, `1600-dark-palette-error.png`, `1600-dark-palette-nohit.png`, `1600-light-palette.png`, `1600-dark-hotkeys.png`, `1600-light-hotkeys.png`, `1600-dark-chord-indicator.png`, `1600-dark-focus-ring.png`

**Editoren je Trade-Typ:** `1600-dark-editor-IRS-0001.png`, `…-OIS-0001.png`, `…-IRS-USD-01.png`, `…-CAP-0001.png`, `…-COL-0001.png`, `…-SWPT-0001.png`, `…-FXF-0001.png`, `…-FXF-0002.png`, `…-FXO-0001.png`, `…-FXO-0002.png`, `1600-dark-editor-FXO-analytics.png`, `1600-dark-editor-FXF-sameccy.png`, neue Typen: `1600-dark-editor-new-basis.png`, `…-new-amort.png`, `…-new-imm.png`, `…-new-fxs.png`

**Flows:** `1600-dark-pricing-collar-new.png` (Quick Entry), `1600-dark-editor-rate-changed.png`, `1600-dark-editor-after-par.png` (Shift+P), `1600-dark-editor-invalid-dates.png`, `1600-dark-pricing-whatif.png`, `1600-dark-pricing-whatif-neg.png`, `1600-dark-blotter-duplicated.png`, `1600-dark-blotter-sorted-pv.png`, `1600-dark-blotter-filter-opt.png`, `1600-dark-blotter-empty-filter.png`, `1600-dark-blotter-no-inspector.png`, `1600-dark-blotter-many-rows.png`, `1600-dark-blotter-current.png` (EMIR-Export), `1600-dark-curves-edited.png`, `1600-dark-curves-usd.png`, `1600-dark-scenarios-selected.png`, `1600-dark-market-date-changed.png`, `1600-dark-blotter-after-date-change.png`

**Report:** `1600-dark-report.png`, `1600-dark-report-offer.png`, `1600-dark-report-CAP-0001.png`, `…-FXO-0001.png`, `…-FXF-0001.png`, `…-SWPT-0001.png`, `1600-dark-report-under-whatif.png`, `1600-report-printmedia-current.png`, `report-print.pdf`

**Empty States:** `1600-dark-blotter-empty.png`, `1600-dark-pricing-empty.png`, `1600-dark-report-empty.png`, `1600-dark-scenarios-empty.png`, `1600-dark-pricing-new-irs.png`

**Responsiv:** `1280-dark-blotter.png`, `1280-dark-blotter-current.png`, `1280-dark-pricing.png`, `1280-dark-curves.png`, `1280-dark-scenarios.png`, `1280-dark-market.png`, `1280-dark-report.png`, `1280-dark-palette.png`, `1280-dark-hotkeys.png`, `1280-light-blotter.png`, `1280-light-pricing.png`, `1920-dark-*.png` (6 Views), `1920-light-blotter.png`, `1920-light-pricing.png`

**Erster Durchlauf (Vorgänger-Bundle `index-DMp1cNMr.js`):** `r1/*.png`, `r1/results.json`, `r1/results2.json`

---

## 8. Priorisierte Maßnahmenliste (Reihenfolge nach Score-Wirkung)

1. F-01 Layout-sichere Hotkeys (What-if, Alt+n) – ~1 h
2. F-02 + F-05 Fokus-/Blur-Semantik im Dispatcher – ~1 h
3. F-03 + F-04 `NumInput` mit String-State, Einheiten, Validierung – ~3 h
4. F-06 + F-07 `:focus-visible`, ARIA für Tabellen/Segmente/Toast/Overlay, Fokus-Rückgabe – ~2 h
5. F-08 + F-14 + F-15 Ein Formatter, Label-/Einheiten-Map, Dubletten – ~2 h
6. F-11 + F-26 + F-27 Report: What-if-Kennzeichnung, stabiler Zeitstempel/Hash, Druck-CSS – ~2 h
7. F-09 + F-22 + F-23 + F-24 Blotter: sichtbare Reihenfolge, scrollIntoView, Empty-Row, Layout 1280 – ~2 h
8. F-12 + F-28 + F-13 Quotes in Store, Stichtag-Popover, Persistenz – ~3 h
9. F-10 + Abschnitt 5 Light-Tokens und Hardcodes – ~1,5 h
10. F-16 + F-17 + F-18 IDs, Kontrahent, Undo/Bestätigung – ~2 h
11. Rebuild `dist` (F-31, F-33 bereits im Quelltext)

Erwartete Wirkung bei Umsetzung 1–11: UI/UX & Hotkeys ≈ 88–92, User Flows ≈ 85–88.
