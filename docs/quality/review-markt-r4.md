# Re-Review Runde 4: Marktabdeckung Features & Module (Dimension 1, Gewicht 20 %) – DERIVA 0.2.0

**Reviewer-Rolle:** Senior Product Analyst, Treasury- und Derivateberatungssoftware (LPA Captano/Capmatix, Bloomberg SWPM/OVML/VCUB/MARS, LSEG Swap Pricer/IPA, Numerix, Quantifi, FINCAD, Reval/ION, Kyriba/Coupa, SAP TRM, Murex/Calypso, ChathamDirect, FI ZWRM, QuantLib/ORE) · **Stand:** 04.09.2026, Branch `claude/derivatives-trading-platform-1arsyu`, Commit `a3daa92` (Core-`dist` frisch gebaut 01:41 UTC) · **Modus:** Review only, keine Quelldatei geändert
**Baseline:** `docs/quality/review-markt-r3.md` (Runde 3, Score 97 / 100) mit den Befunden R3-1…R3-6 und dem N16-Rest (CSV-Import)
**Geprüft (Laufzeit):** `npx vitest run` → **Core 298/298, API 68/68, Web 212/212 grün**; `vite build` erfolgreich; Web-App unter `vite preview --port 4701` mit Playwright/Chromium durchgeklickt (`e2e-markt-r4.mjs`, `…r4b/c/d.mjs`, `e2e-caplet.mjs`, Auszug Anhang C, keine `pageerror`); API per `buildApp` + `app.inject` (`probe-api-r4.mts`, Anhang B, inkl. CSV-Import mit den ausgelieferten Vorlagen); Core-Proben gegen `packages/pricing-core/dist` (`probe-core-r4.mjs`, `probe-vega-r4.mjs`, Anhang A). Alle Zahlen unten stammen aus diesen Läufen.
**Roadmap-Regel:** In `02-epics-und-user-stories.md` / README als ⏳ dokumentierte Posten (Bermudan/CMS/Range Accrual, TARF/Strukturen, Marktdaten-Adapter & Kurven-Governance, OIDC/Rollen/DB-Persistenz, Excel-Add-in, Monte-Carlo-Netting-XVA/FVA, PDF-Template-Service, Inflations-ZC-Swap US-3.15, PRIIPs Annex-II-Monte-Carlo, SIMM/CRIF, VaR/Attribution, Batch-EoD/Webhooks, Designationsmemo US-10.6, EMIR-Tabelle 3/UPI/XML) werden **nicht** als Lücke gewertet.

---

## 1. Score

### **Marktabdeckung Features & Module: 98 / 100** (rechnerisch 97,6; Runde 1: 60, Runde 2: 86, Runde 3: 97)

**In einem Satz:** Alle sechs Runde-3-Befunde und der N16-Rest sind geschlossen und durchgängig reproduziert – der Template-/Palette-/CSV-/API-CCS preist jetzt die Xccy-Basis (−22 bp), `makeFra` wählt den Index aus der Periode, USD/GBP-Swaption- und Caplet-Flächen sowie GBPUSD/USDJPY/EURJPY-FX-Flächen liegen im Beispielmarkt (Level 2 statt Fallback), alle drei Vol-Flächen sind in der Marktansicht zellweise editierbar mit Undo/Reset/Snapshot-ID, die Palette kennt `fixed`-CCS und JPY-Strikes mit Spot-Plausibilität, FX-Swap-Punkte sind in der Kurvenansicht anlegbar, und der CSV-Import hat sieben Vorlagen in UI **und** API (`text/csv` → 200 mit Zeilenstatus) – **übrig bleiben Randfälle der neuen Features: die Caplet-Vol-Karte ist wegen überlappender Eingabefelder mit der Maus praktisch nicht bedienbar, USD/GBP-Swaptions lassen sich in der UI nicht anlegen (Palette ignoriert die Währung, Editor ohne Währungsfeld), der CCS-CSA-Default wählt für Nicht-USD-Paare eine Besicherungswährung ohne Collateral-Kurve, und CHF/JPY haben weiterhin keine Zinsvol-Flächen.**

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, UX-Reibung −1…−3, kosmetisch −0,2…−1; Roadmap-dokumentiert = 0; keine Doppelzählung mit Quant/UI/Flows):

| Bereich | R1 | R2 | R3 | R4 | Restlücken (Nummern → Abschnitt 3) |
|---|---:|---:|---:|---:|---|
| A Instrumente & Strukturen | −10 | −3,7 | −0,8 | −0,5 | CCS-CSA-Default für Nicht-USD-Paare ohne Collateral-Kurve, ohne Warnung (R4-1 −0,3); FRA-Index 1M/12M ohne Kurve (R4-6 −0,2) |
| B Kurven & Marktdaten | −5 | −0,7 | −0,2 | 0 | R3-6 behoben |
| C Modelle | −1 | 0 | 0 | 0 | – |
| D Sensitivitäten | −2 | −0,8 | 0 | 0 | Vega-Buckets auch für USD/GBP-Cubes und JPY-FX-Flächen |
| E Szenarien / VaR | −1 | −0,5 | 0 | 0 | VaR = Roadmap |
| F XVA | −2,5 | −0,5 | 0 | 0 | Netting/CRIF = Roadmap |
| G Hedge Accounting | −4 | −3,0 | 0 | 0 | – |
| H Regulatorik | −4 | −1,5 | 0 | 0 | Tabelle 3/UPI/XML = Roadmap v1.0 |
| I Dokumente | −2,5 | −1,0 | 0 | 0 | PDF/Annex-II-MC = Roadmap |
| J Workflow / Beratung | −2,5 | −0,3 | 0 | 0 | Freigabe = Roadmap |
| K UI | −0,5 | −1,3 | −0,8 | −1,5 | Caplet-Vol-Zellen überlappen, Werte unlesbar, Mausklick trifft die Nachbarzelle (R4-3 −1,0); Palette `swpt usd …` legt stillschweigend EUR an, Swaption-Editor ohne Währung (R4-2 −0,5) |
| L Integration | −2,5 | −0,5 | −0,3 | −0,2 | `PUT /api/market` ohne Vol-Felder – Vol-Änderungen per API nur über kompletten Snapshot (R4-5 −0,2) |
| M Admin | −2,5 | 0 | 0 | 0 | Rollen/DB = Roadmap |
| Sonstiges (Beispielmarkt) | – | −0,5 | −0,5 | −0,2 | CHF-SARON-/JPY-TONA-Swaption- und Caplet-Flächen fehlen weiterhin (Fallback 70/60 bp, Level 3) (R4-4 −0,2) |
| **Summe** | **−40** | **−14,3** | **−2,6** | **−2,4** | → **97,6 ≈ 98 / 100** |

Einordnung (gleiche Skala, v1-Workstation-Scope, Einschätzung): Bloomberg SWPM+OVML+VCUB+MARS ≈ 85 (kein Hedge Accounting, keine deutschen Beratungsdokumente), LPA Capmatix OTC ≈ 75, ORE ≈ 60, Kyriba/Coupa ≈ 55. Mit editierbaren Vol-Flächen, Nicht-EUR-Vol-Cubes und dem typisierten CSV-Import in beiden Kanälen hat DERIVA die letzten funktionalen Lücken zum Bloomberg-Bündel für Vanilla-Zins/FX geschlossen; die Restdifferenz zu 100 sind Bedienbarkeit einer neuen Karte, Voreinstellungen und Beispieldaten.

---

## 2. Status der Runde-3-Befunde R3-1…R3-6 und N16-Rest

Legende: **behoben** = im Code vorhanden **und** per Probe/UI reproduziert · **teilweise** = Kern vorhanden, benannter Rest · **offen** = unverändert.

| # | Befund R3 | Status | Nachweis (Datei / Probe / UI) | Rest |
|---|---|---|---|---|
| **R3-1** | CCS-Template/Sample/Palette ohne CSA → Xccy-Basis nicht gepreist | **behoben** | `builders.ts:468` `defaultCcsCollateralCurrency` (USD, wenn ein Leg USD; sonst Quote-Währung; `null` = unbesichert), `:549` Default im Builder; `templates.ts:34–36` `CCS_CSA_CURRENCY`/`ccsCollateralCurrency`, `:128` Template mit USD-CSA; `quick-parser.ts:321`; `sample-portfolio.ts` CCS-0001 mit USD-CSA; `csv-import.ts:100` Spalte `collateralCurrency`. Core: EURUSD ohne Angabe → `collateral USD · PV 9.587 · fairSpread −22,00 bp · curves EUR-ESTR-USDCSA,USD-SOFR,EUR-ESTR`; `collateralCurrency: null` → −0,08 bp (unbesichert, wie früher). API `from-template` ohne CSA: `collateral USD · fairSpread −22 bp`, mit `null`: −0,08 bp; CSV-Vorlage CCS → `collateral USD`. UI `n z` → **Fairer Basis-Spread −22,0 bp**, Select „Collateral (CSA) = USD-CSA“; auf „unbesichert“ → −0,1 bp mit Hinweis „ohne CSA keine Xccy-Basis – jedes Leg wird auf seiner eigenen OIS-Kurve diskontiert“ (Screenshot `05-ccs-no-csa.png`); Palette-CCS und CSV-Import (`CCS-UI-1`: −22,0 bp) ebenso. README dokumentiert den Default | Default für Nicht-USD-Paare → R4-1 |
| **R3-2** | `makeFra` nimmt für 3x6 EURIBOR-6M | **behoben** | `builders.ts:567` `fraIndexForPeriod(currency, months)` (IBOR-Index mit Tenor = Periodenlänge, Fallback Standardindex), `:597–603` Periode aus „3x6“ oder aus expliziten Daten, expliziter `index` gewinnt. Core: 1x4/3x6/2x5/9x12 → EURIBOR-**3M**, 3x9/6x12/1x7/12x18 → EURIBOR-**6M**, explizite Daten 3M→6M → 3M; USD/GBP/CHF/JPY → RFR-Fallback. API `from-template` FRA 3x6 → EURIBOR-3M (2026-12-07 → 2027-03-08), 3x9 → 6M; CSV FRA `3x6` → 3M, Datumsform 08.12.2026–08.06.2027 → 6M. UI `n r` → „Index EURIBOR-3M · Forward-Satz 2,1551 %“ (R3: 2,2039 % vom 6M-Forward); Palette `fra 6x12 rec …`, `fra 3x9 …` | 1M-/12M-Perioden → Index ohne Kurve → R4-6 |
| **R3-3** | Beispielmarkt ohne Nicht-EUR-Vol-Flächen | **behoben** | `sample-market.ts:273–371` `SAMPLE_USD_SWAPTION_VOLS` (11 × 9 Normal-Cube, SABR 1x5/5x5/10x10), `SAMPLE_GBP_SWAPTION_VOLS`, `SAMPLE_USD_CAPLET_VOLS` (`USD-SOFR`), `SAMPLE_GBP_CAPLET_VOLS` (`GBP-SONIA`); `:424–457` `SAMPLE_GBPUSD_VOLS`, `SAMPLE_USDJPY_VOLS`, `SAMPLE_EURJPY_VOLS` (mit `deltaConvention`/`atmConvention`); Registrierung `:512–521`. Core: USD-Swaption 1Yx5Y `vol 96,6 bp · Level 2 · keine Warnung · Vega-Buckets 11`, GBP `91,8 bp · Level 2`; USD-Cap (SOFR) PV 256.475 Level 2, GBP-Cap Level 2; EURJPY-Call `vol 9,02 % · Level 2`, USDJPY 9,63 %, GBPUSD 8,00 % (R3: alle Fallback/Level 3). Snapshot-Roundtrip trägt alle neun Flächen, Snapshot-ID reagiert auf USD-Vol-Änderung. API `GET /api/market/vols` → swaption EUR/USD/GBP, caplet 3, fx 6; `/api/risk/vega` USD-Swaption `expiry-tenor n=99`, EURJPY-Option `smile n=18`; `/api/report` USD-Swaption Level 2. UI: Swaption-Cube-Segment „EUR / USD / GBP“, FX-Paare „EUR/USD … USD/JPY, EUR/JPY“, Caplet-Segment „EUR-EURIBOR-6M / USD-SOFR / GBP-SONIA“; importierte `SWPT-UI-1` (USD) Report „Level 2“, `FXO-UI-1` (EURJPY) ohne Vol-Warnung | CHF/JPY-Zinsvols fehlen → R4-4 |
| **R3-4** | Vol-Flächen in der Workstation nicht pflegbar | **behoben** (UI) | `store.ts:100–105,158,247–249,953–975` `VolSurfaces`, `setVolSurface`/`resetVolSurfaces`, Undo-Eintrag `kind: "vols"` mit 1-s-Koaleszenz, `withVolSurfaces`, persistiert, `marketModified` berücksichtigt Vols; `MarketView.tsx:33–112` `SwaptionVolCard` (Heatmap-Zellen als `NumInput`, Badge „geändert“, „Zurücksetzen“), `:115–207` `FxVolCard` (ATM/25Δ RR/BF/10Δ je Verfall), `:210–…` `CapletVolCard`; „Markt zurücksetzen“ setzt auch Vols zurück (`:749`). UI: USD-Cube Zelle 4W×1Y `92 → 120` bp → Badge „geändert“, Snapshot-Badge „modifiziert“, Karten-„Zurücksetzen“; `Ctrl+Z` → 92 mit Toast „Rückgängig: Swaption-Vol USD 4W×1Y 92,0 → 120,0 bp“; EUR/JPY-ATM `8,8 → 9,5 %` → „geändert“; Caplet USD-SOFR `78 → 90` bp (per Tastatur) → „geändert“; „Markt zurücksetzen“ → 0 Badges. Core: bearbeitete USD-Fläche ändert PV der USD-Swaption 148.506 → 166.208 und die Snapshot-ID; API `PUT /api/market/snapshot` mit +10 bp USD-Vols → 200, PV 148.506 → 166.208, `X-Market-Snapshot-Id` wechselt | Caplet-Karte per Maus nicht bedienbar → R4-3; `PUT /api/market` ohne Vol-Felder → R4-5 |
| **R3-5** | Palette: `fixed` beim CCS ignoriert, JPY-Strikes ohne Dezimalstellen | **behoben** | `quick-parser.ts:81` `PRICE = /^\d+(?:[.,]\d+)?$/`, `:92–97` `priceImplausible` (0,3×…3× Spot, auch invertiert), `:102` Modifier `fixed|fest|fix`, `:272–292` `fixedRate`-Parsing, Vorschau „Fest 3,00 % EUR vs USD-RFR“. UI: `ccs eurusd 5y fixed 3.00% 10m` und `ccs eurusd 5y fest 3% 10m mtm` → „Cross-Currency-Swap EUR/USD 5Y · Fest 3,00 %“, angelegt: KPI „Par-Satz 2,2693 %“, Feld „Festsatz Leg …“, CSA USD, PV 342.374 (Core Fix/Float 342.374 ✓); `fxo eurjpy call 175 1m 6m` → „FX-Option EURJPY Call @ 175,00“; `fxo usdjpy put 145,00 1m 6m` ✓; `fxo eurusd put 5 1m 6m` → „⚠ Strike 5,0000 passt nicht zum Spot EUR/USD 1,1625“ | – |
| **R3-6** | FX-Swap-Punkte in der Kurvenansicht nicht anlegbar | **behoben** | `CurvesView.tsx:62–84` `newFxPointsQuote` (nächster freier Tenor 1M/3M/6M/9M, Paar mit Diskontkurve der Gegenwährung, `pipFactor` 100 für JPY), `:242–254` `addFxPoints` fügt in Pillar-Reihenfolge ein, `:486` Button `add-fx-points`, `:520` Badge für hinzugefügte Quotes, entfernbar (`removeQuote`), Undo über Quote-Mechanik. UI: Tab „EUR/USD CSA“ → „+ FX-Punkte EUR/USD“ (Tooltip „… 1M als Quote anlegen (kurzes Ende aus Devisentermingeschäften, Diskontkurve USD-SOFR)“) → 5 → 6 Zeilen, Zeile „FX-Pkt 1M EURUSD ✕ 08.10.2026 … Zero 2,0276 % · DF 0,999778 · Residuum 0“, Chip „Markt modifiziert“; zweiter Klick → „FX-Pkt 3M“; Button auch auf €STR und TONA vorhanden | – |
| **N16-Rest** | CSV-Import nur IRS/FXF/CAP, API ohne `text/csv` | **behoben** | API: `lib/csv-import.ts` (501 Zeilen) `CSV_TEMPLATES` für **InterestRateSwap, FxForward, CapFloor, Swaption, FxOption, CrossCurrencySwap, FRA** (Pflicht-/Optionalspalten, Beispielzeile, deutsche Aliase, `;`/`,`/Tab, BOM, `10.000.000,50`, `3,10 %`, `-20 bp`, `TT.MM.JJJJ`), `routes/trades.ts:229–331` `text/csv` + `?type=` + `?mode=upsert`, Fehler je Zeile, Audit `trade.import {format: csv}`. Probe: alle **7 Vorlagen → 200, `imported 1/1`** (CCS mit `collateral USD`, FRA `3x9` → EURIBOR-6M); deutsche Header (`Währung;Nominal;Richtung;Festsatz;Startdatum;Laufzeit;Kontrahent;Buch`) → Zeile 1/3 importiert, Zeile 2 `rejected: not a number: "abc"`; ohne `?type` → 400; fehlende Pflichtspalten → 400 `CSV_INVALID` mit Spaltenliste; `mode=upsert` → `version 2`; Duplikat → `skipped: exists`; USD/GBP/CHF-Swaptions, EURJPY/USDJPY-Optionen, Fix/Float-CCS per CSV bewertet. Web: `portfolio-io.ts:150–253` sieben Vorlagen (IRS/FXF/CAP/SWPT/FXO/CCS/FRA), Blotter-Export-Menü „CSV-Vorlagen: Zinsswap · FX-Forward · Cap/Floor/Collar · Swaption · FX-Option · Cross-Currency-Swap · FRA“; Import einer gemischten Datei (IRS-USD, SWPT-USD, FXO-EURJPY, CCS, FRA, 1 Fehlzeile) → Fehlerdialog „Zeile 7: Nominal fehlt oder ≤ 0“, Button „5 gültige Zeilen importieren“ → 13 → 18 Trades, Toast „5 Trades aus CSV importiert · Rückgängig“ | OpenAPI-`requestBody` nennt nur `application/json` (ohne Abzug, API-Dimension) |

**Runde-1/2-Posten:** unverändert geschlossen (siehe R3-Bericht); G14/G24/G26 bleiben dokumentierte Roadmap (kein Abzug).

---

## 3. Neue Befunde (Runde 4)

Severity: **UX-Reibung** = Feature vorhanden, aber im Normalgebrauch behindert · **Niedrig** = Lücke zweiter Ordnung für eine v1-Persona · **Kosmetisch** = Voreinstellung/Konsistenz.

| # | Sev. (Abzug) | Ort | Befund (reproduziert) | Fix |
|---|---|---|---|---|
| **R4-1** | Niedrig (−0,3) | `builders.ts:468–470` (`defaultCcsCollateralCurrency` → Quote-Währung), `templates.ts:35–36` (`ccsCollateralCurrency`), `market-context.ts:63–72` (`getDiscountCurve` fällt ohne Meldung auf `discountCurveId` zurück), `valuation-report.ts` Methodiktext | **Der neue CCS-CSA-Default wählt für Nicht-USD-Paare eine Besicherungswährung, für die keine Collateral-Kurve existiert – ohne Warnung.** Core: `EURGBP` → `collateral GBP · curves EUR-ESTR,GBP-SONIA · fairSpread −0,07 bp · warnings []`; `EURJPY` → `collateral JPY`, `GBPUSD`/`USDJPY` → USD ohne `GBP|USD`/`JPY|USD`-Kurve. Der Bewertungsreport schreibt trotzdem „CSA-Kurve (Besicherung in GBP) – EUR: EUR-ESTR, GBP: GBP-SONIA“ und Level 2, obwohl faktisch unbesichert ohne Basis diskontiert wird (API `from-template` EURGBP: `collateral GBP`, `warnings []`; CSV `CCS-GBP-1` ebenso). Für den Prüfer ist die CSA-Angabe damit falsch; Bloomberg/LSEG zeigen bei fehlender Xccy-Kurve eine explizite Warnung. | `getDiscountCurve`: bei gesetztem `collateralCcy` ohne passende `collateralDiscountCurveId` Warnung `NO_COLLATERAL_CURVE:` in `warnings[]` (analog `MISSING_FIXING:`) und IFRS-13-Hinweis; `defaultCcsCollateralCurrency(ctx?)` nur dann eine Währung liefern, wenn `${dom}\|${csa}` oder `${frn}\|${csa}` als Collateral-Kurve existiert, sonst `undefined`; Editor-Hint bei CCS „CSA ohne Collateral-Kurve – Diskontierung auf eigener OIS-Kurve“; Test EURGBP → Warnung. |
| **R4-2** | Niedrig (−0,5) | `quick-parser.ts:464–490` (`makeSwaption({ currency: "EUR", … })`, kein Währungstoken), `TradeEditor.tsx:1033–1107` (Swaption: Typ/Position/Verfall/Settlement/Strike/Nominal/Swap-Start/-Ende/Modell/Vol-Override – **kein Feld „Währung“**), `templates.ts` `swpt` nur EUR | **USD-/GBP-Swaptions sind in der Workstation nicht anlegbar, obwohl die Cubes jetzt existieren.** Palette `swpt usd 1y5y payer 3.5% 10m` legt **stillschweigend** eine EUR-Swaption an (UI: „Forward-Swapsatz 2,7667 %“, PV 38.054 = EUR; die USD-Variante per CSV zeigt 3,3875 %/127.774); der Swaption-Editor bietet keine Währungswahl (Nominal-Einheit fest aus dem Leg). Einziger UI-Weg: CSV-/JSON-Import. Für `irs`, `ois`, `cap`, `fra` akzeptiert die Palette das Währungstoken (`cap usd 5y 4% 10m` ✓, `irs chf …` ✓) – der Swaption-Zweig ist der einzige inkonsistente. | Palette: `CCYS`-Token im `swpt`-Zweig auswerten (`currency`, Vorschau „Payer-Swaption USD 1Y×5Y“), Fehler bei unbekannter Währung; Editor: Select „Währung“ für Swaption (setzt beide Underlying-Legs, Index aus `getSwapConventions`); Grammatik in `03-ui-konzept:118` und `QUICK_ENTRY_EXAMPLES` ergänzen; Test `swpt usd …` → `currency USD`. |
| **R4-3** | UX-Reibung (−1,0) | `MarketView.tsx:262–275` (`CapletVolCard`: `NumInput inline` ohne `width` in `<span style={{ width: 62 }}>`), `app.css:1239` (`.num-input.inline` ohne Breitenbegrenzung), Vergleich `FxVolCard :184–195` (Wrapper 84 px, Input 84 px – korrekt) | **Die Caplet-Vol-Karte ist mit der Maus nicht bedienbar und die Werte sind unlesbar.** Playwright: Inputs der ersten Zeile messen **167 px** bei **62-px-Wrapper/74-px-Zelle** (`input[748..915] td[742..816]`, `overlap: true`), d. h. jede Zelle wird zu ~⅔ vom rechten Nachbarn überdeckt; ein Klick in die Zellmitte der Spalte „2,00 %“ fokussiert die Spalte „1,00 %“ (1920 px: `click td#2 center → active: Caplet-Vol 6M Strike 1,00 %`), Playwrights eigener Klick auf Zelle 1 scheiterte 30 s an „subtree intercepts pointer events“. Screenshot `07c-caplet-card.png`: nur leere überlappende Rahmen, keine Zahl sichtbar (die rechtsbündigen Werte liegen unter dem Nachbarfeld). Swaption-Heatmap (`overlap: false`) und FX-Karte (`overlap: false`) sind sauber; nur die dritte Fläche ist betroffen – die Tastaturbedienung (Tab/Enter) funktioniert, daher „behoben“ mit Reibung statt „offen“. | `NumInput inline` im Caplet-Grid mit `width={62}` (wie `FxVolCard` 84) oder `.vol-cell .num-input.inline { width: 100%; min-width: 0 }`; Spaltenbreite an `strikes.length` ausrichten (`table-layout: fixed`); E2E-Check „kein Input breiter als seine Zelle“ für alle drei Karten (das 07b-Screenshot-Muster als Regressionstest). Kein Doppelabzug in Dimension 3 beabsichtigt – dort ggf. nur als Verweis führen. |
| **R4-4** | Kosmetisch (−0,2) | `sample-market.ts:512–513` (`swaptionVols` EUR/USD/GBP, `capletVols` EUR-6M/USD-SOFR/GBP-SONIA), CHANGELOG „Vol-Flächen USD/GBP/JPY/CHF“ | **CHF und JPY haben weiterhin keine Zins-Vol-Flächen**, obwohl SARON-/TONA-Kurven, Palette (`irs chf …`, `irs jpy …`) und CSV-Import CHF/JPY-Trades erzeugen: CHF-Swaption 1Yx5Y → `"No swaption vol surface – using 70bp normal vol" · Level 3`, JPY ebenso; CHF-/JPY-Cap → 60-bp-Fallback, Level 3 (CSV `SWPT-CHF-1` importiert **mit** Warnung). Die CHANGELOG-Formulierung „USD/GBP/JPY/CHF“ trifft nur die FX-Seite (EURCHF/EURJPY/USDJPY). Außerdem keine FX-Flächen für USDCHF/GBPJPY (Triangulation der Spots funktioniert, Vol fällt auf 8 %). | Indikative CHF-SARON-/JPY-TONA-Cubes und Caplet-Flächen (niedrigere Normal-Vols, 40–70 bp) analog USD/GBP; optional USDCHF/GBPJPY-Smiles; CHANGELOG-Text präzisieren; Test: keine `No … vol surface`-Warnung für alle Währungen mit Diskontkurve. |
| **R4-5** | Kosmetisch (−0,2) | `routes/market.ts:270–337` (`PUT /api/market` Body: `fxSpots`, `fixings`, `valuationDate`, `fxSpotDates`, `missingFixingPolicy`; `additionalProperties: false`) | Vol-Flächen sind per API nur über `PUT /api/market/snapshot` (kompletter Markt) änderbar; `PUT /api/market {swaptionVols:…}` → **400 „body must NOT have additional properties“**. Ein IPV-Prozess, der eine Broker-Vol nachzieht, muss den Snapshot lesen, patchen und komplett zurückschreiben (funktioniert: PV 148.506 → 166.208, Snapshot-ID wechselt) – die UI kann es zellweise, die API nicht. | `PUT /api/market` um optionale `swaptionVols`/`capletVols`/`fxVols` (Merge je Key, Schema aus `schemas.ts:1024–1090` wiederverwenden) erweitern; Audit `market.update` mit `vols: [...]`; Vertragstest. |
| **R4-6** | Kosmetisch (−0,2) | `builders.ts:567–571` (`fraIndexForPeriod` sucht nur in `RATE_INDICES`, nicht im Markt), `sample-market.ts` (keine EUR-1M-/12M-Kurve) | `fraIndexForPeriod` liefert für 1-Monats- bzw. 12-Monats-Perioden EURIBOR-1M/-12M, für die der Beispielmarkt keine Kurve hat: `1x2`, `2x3` → `CURVE_NOT_FOUND EUR-EURIBOR-1M`, `12x24`, `1x13` → `EUR-EURIBOR-12M`; CSV-Zeile `FRA 1x2` wird abgelehnt („Curve not found in market context“). In R3 (Standardindex 6M) wären diese FRAs bewertbar gewesen – die Verbesserung hat hier einen Randfall verschlechtert. 1M-/12M-FRAs sind selten, aber Teil der EUR-FRA-Matrix. | Fallback-Kaskade: passender Tenor → nächster registrierter Tenor mit Kurve (3M/6M) mit Warnung `INDEX_TENOR_MISMATCH:`; alternativ Builder-Parameter `ctx` zur Kurvenprüfung; Test `1x2` → EURIBOR-3M + Warnung. |

**Ohne Abzug, aber dokumentierenswert:**
- OpenAPI `POST /api/trades/import` deklariert im `requestBody` nur `application/json`; `text/csv` steht nur in der Beschreibung (Vertragslücke → Dimension 5).
- Web-CSV-Vorlage „Cross-Currency-Swap“ hat keine Spalte `collateral`/CSA (API-Vorlage hat `collateralCurrency`) – der Default über `ccsCollateralCurrency(pair)` ist für EURUSD richtig, für Nicht-USD-Paare gilt R4-1.
- `QUICK_ENTRY_EXAMPLES` und Hilfe-Overlay nennen den neuen `fixed`-Baukasten und die Vol-Editierbarkeit nicht (Hilfe: „Vol“ kommt nicht vor); `?`-Sheet listet die `o`-Chords (KID/Confirmation/Portfolio-Report per `o k`/`o c`/`o p` reproduziert).
- `fra usd 3x6 …` erzeugt weiterhin ein FRA auf SOFR (wie R3, kein Kernfall der DACH-Persona).
- FX-Punkte-Zeile zeigt in der Wert-Spalte „Pkt“ ohne Zahl bei `points: 0` (Darstellung, nicht Funktion).

---

## 4. Feature-Matrix – Statusänderungen gegenüber Runde 3 (nur DERIVA-Spalte)

| Feature | R3 | R4 | Beleg |
|---|---|---|---|
| CCS-Template/Palette/CSV/API mit Markt-CSA (Xccy-Basis gepreist) | ❌ | ✅ (Nicht-USD-Paare ohne Warnung) | R3-1, R4-1 |
| FRA-Index aus Periodenlänge (Core, Template, API, CSV) | ❌ | ✅ (1M/12M ohne Kurve) | R3-2, R4-6 |
| Nicht-EUR-Vol-Flächen im Beispielmarkt (USD/GBP-Cube, USD/GBP-Caplet, GBPUSD/USDJPY/EURJPY) | ❌ | ✅ (CHF/JPY-Zinsvols fehlen) | R3-3, R4-4 |
| Vol-Flächen in der UI editierbar (Zelle, Undo, Reset, Persistenz, Snapshot-ID) | ❌ | ✅ (Caplet-Karte Maus-Reibung) | R3-4, R4-3 |
| Vol-Flächen per API änderbar | 🔶 Snapshot | 🔶 Snapshot (kein `PUT /api/market`) | R4-5 |
| Palette `ccs … fixed`, JPY-Strikes mit Spot-Plausibilität | ❌ | ✅ | R3-5 |
| FX-Swap-Punkte in der Kurvenansicht anlegbar/entfernbar | ❌ | ✅ | R3-6 |
| CSV-Import: 7 Vorlagen UI + API (`text/csv`, Fehler je Zeile, upsert) | 🔶 | ✅ | N16 |
| USD/GBP-Swaption per Palette/Editor | – | ❌ (nur Import/API) | R4-2 |
| Vega-Buckets für USD/GBP-Cubes und JPY-FX-Smiles | – | ✅ | Anhang A/B |
| Excel / Live-Marktdaten / Rollen / Netting-CVA / VaR / CRIF / Bermudan / TARF / PDF / Inflation | ⏳ | ⏳ Roadmap | kein Abzug |

---

## 5. Verifizierte Positivbefunde (Auszug, alle reproduziert)

- **CCS-Bewertung marktkonform:** Template, Palette, CSV (UI/API) und `from-template` liefern für EURUSD −22,0 bp fairen Basis-Spread auf `EUR-ESTR-USDCSA`; der Editor erklärt den Effekt beim Abschalten der CSA; `collateralCurrency: null` bleibt als bewusst unbesicherte Variante verfügbar.
- **Vol-Pflege wie in VCUB/OVDV:** drei Flächen zellweise editierbar, jede Änderung als typisierter Undo-Eintrag („Swaption-Vol USD 4W×1Y 92,0 → 120,0 bp“), Badges „geändert“/„modifiziert“, Karten-Reset und „Markt zurücksetzen“, Persistenz; Snapshot-ID und Reports reagieren (PV-Änderung 148.506 → 166.208 bei +10 bp).
- **Beispielmarkt für die USD-/GBP-Persona komplett:** Swaption-Cubes mit SABR-Punkten, Caplet-Flächen, FX-Smiles mit Delta-/ATM-Konvention; Swaptions/Caps in USD/GBP und Optionen auf EURJPY/USDJPY/GBPUSD ohne Fallback (Level 2), Vega-Buckets Expiry × Tenor (99 Zellen) bzw. Smile (18 Buckets).
- **Integration:** CSV-Import in beiden Kanälen mit denselben Core-Buildern (Marktkonventionen je Währung), deutsche Header/Zahlen/Daten, Fehler je Zeile, Fehlerdialog in der UI mit „n gültige Zeilen importieren“, Undo-Toast, Audit-Kette (`chainValid true`, 14 Import-Einträge).
- **Kurven:** FX-Swap-Punkte als kurzes Ende der Collateral-Kurve direkt in der UI (1M/3M/…), Pillar-Reihenfolge, Residuum 0, Chip „Markt modifiziert“, Undo.
- **API-Vertrag:** 40 Operationen unverändert, OpenAPI 3.1.0, `from-template` dokumentiert CSA-Default und FRA-Indexregel; Tests Core 298 / API 68 / Web 212 grün.

---

## 6. Was für 100 noch fehlt

1. **R4-3 Caplet-Vol-Karte:** `NumInput`-Breite an die Zelle binden (eine `width`-Prop bzw. eine CSS-Regel) plus E2E-Regressionstest „Input ≤ Zelle“ – der größte Einzelposten, eine Stunde.
2. **R4-2 Swaption-Währung** in Palette (`swpt usd …`) und Editor (Select „Währung“).
3. **R4-1 CSA-Default nur mit Collateral-Kurve** und Warnung `NO_COLLATERAL_CURVE:` im Core (Report-Text „CSA-Kurve (Besicherung in GBP)“ darf ohne Kurve nicht erscheinen).
4. **R4-4 CHF-/JPY-Zinsvol-Flächen** (indikative Konstanten) und CHANGELOG-Text.
5. **R4-5 `PUT /api/market` mit Vol-Feldern**, **R4-6 FRA-Index-Fallback** auf einen Tenor mit Kurve.

Mit 1–3 (geschätzt ein halber Arbeitstag) läge die Dimension bei ≈ 99,5; 4–5 schließen die Lücke zu 100 für den v1-Scope.

---

## Anhang A – Core-Probe (`node probe-core-r4.mjs` gegen `dist`, Auszug)

```
Engine deriva-pricing-core/0.2.0 curves: EUR-ESTR,EUR-EURIBOR-6M,EUR-EURIBOR-3M,USD-SOFR,GBP-SONIA,CHF-SARON,JPY-TONA,EUR-ESTR-USDCSA
swaptionVols: EUR,USD,GBP · capletVols: EUR-EURIBOR-6M,USD-SOFR,GBP-SONIA · fxVols: EURUSD,EURGBP,EURCHF,GBPUSD,USDJPY,EURJPY
collateralDiscountCurveId: {"EUR|USD":"EUR-ESTR-USDCSA"}
== R3-1 CCS default collateral ==
EURUSD {} → collateral USD · PV 9.587 · fairSpread -22,00 bp · curves EUR-ESTR-USDCSA,USD-SOFR,EUR-ESTR · warnings []
EURUSD {"collateralCurrency":null} → collateral none · PV -95.026 · fairSpread -0,08 bp · curves EUR-ESTR,USD-SOFR
EURGBP {} → collateral GBP · PV -95.144 · fairSpread -0,07 bp · curves EUR-ESTR,GBP-SONIA · warnings []   (← R4-1)
EURJPY {} → collateral JPY · fairSpread 0,16 bp · curves EUR-ESTR,JPY-TONA · warnings []                  (← R4-1)
fixed/float default: collateral USD legs Float:USD/Fixed:EUR · PV 342.374 · par 2,269 %
== R3-2 FRA index from period ==
EUR 1x4 → EURIBOR-3M · 3x6 → EURIBOR-3M (2026-12-07 → 2027-03-08, fwd 2,1551 %) · 3x9 → EURIBOR-6M · 6x12 → EURIBOR-6M · 2x5 → 3M · 9x12 → 3M · 12x18 → 6M
USD/GBP/CHF/JPY 3x6 → SOFR/SONIA/SARON/TONA · explicit dates 3M→6M → EURIBOR-3M
1x2 → EURIBOR-1M ERROR CURVE_NOT_FOUND · 12x24 → EURIBOR-12M ERROR CURVE_NOT_FOUND                        (← R4-6)
== R3-3 non-EUR vols ==
EUR swaption 1Yx5Y: vol 81,1 bp · Level 2 · vega buckets 11 ; USD: PV 233.211 · vol 96,6 bp · Level 2 ; GBP: vol 91,8 bp · Level 2
CHF swaption: vol 70,0 bp · Level 3 · "No swaption vol surface – using 70bp normal vol" ; JPY ebenso                (← R4-4)
EUR cap Level 2 · USD cap (SOFR) PV 256.475 Level 2 · GBP cap Level 2 · CHF/JPY cap Level 3 "No caplet vol surface – using 60bp"
EURUSD call vol 7,57 % L2 · EURJPY 9,02 % L2 · USDJPY 9,63 % L2 · GBPUSD 8,00 % L2 · EURGBP 5,93 % · EURCHF 5,39 % · USDCHF/GBPJPY Fallback 8 % L3
== snapshot roundtrip ==
snapshot trägt 3 Swaption-, 3 Caplet-, 6 FX-Flächen · snapshotId equal after roundtrip: true · changes with USD vol edit: true
USD swaption PV base 148.506 vs +10bp vol 166.208
== misc == JPY swap TONA PV 50.940 EUR par 1,180 % · CHF swap SARON · USD swaption computeRisk: dv01 1.687 · vega {swaption:USD} · theta −229
EURGBP CCS report: collateral GBP | curves EUR-ESTR,GBP-SONIA | „CSA-Kurve (Besicherung in GBP) – EUR: EUR-ESTR, GBP: GBP-SONIA“ | Level 2 | warnings []
```

## Anhang B – API-Probe (`npx tsx probe-api-r4.mts`, `app.inject`, Auszug)

```
openapi: 3.1.0 ops: 40 · import description mentions CSV templates: true | requestBody content types: [application/json]
== N16 CSV import per template ==
InterestRateSwap: 200 imported 1/1 · IRS-CSV-1 PV -191498.75 ; FxForward: 200 FXF-CSV-1 PV 2769.05 ; CapFloor: 200 CAP-CSV-1 PV 96080.02
Swaption: 200 SWPT-CSV-1 PV 99961.34 ; FxOption: 200 FXO-CSV-1 PV 52359.65
CrossCurrencySwap: 200 CCS-CSV-1 PV 9599.53 → collateral USD legs Float:EUR@-0.002/Float:USD@0
FRA: 200 FRA-CSV-1 PV 869.26 → index EURIBOR-6M 2026-12-07 → 2027-06-07 (3x9)
german IRS csv (Währung;Nominal;Richtung;Festsatz;Startdatum;Laufzeit;Kontrahent;Buch): row1 imported · row2 rejected "not a number: abc" · row3 USD imported
csv without ?type: 400 · missing required columns: 400 CSV_INVALID "lacks required column(s) for Swaption: payerReceiver, strike, expiry, tenor"
upsert existing: version 2 · create duplicate: skipped "exists"
CCS fixed (3,00 %, CSA leer) → collateral USD legs Float:USD/Fixed:EUR PV 342373 ; EURGBP → collateral GBP PV 319 warnings []   (← R4-1)
FRA date-form 08.12.2026–08.06.2027 → EURIBOR-6M ; 3x6 → EURIBOR-3M ; 1x2 → rejected "Curve not found … EUR-EURIBOR-1M"    (← R4-6)
FxOption EURJPY 175 / USDJPY 145,00 → imported, keine Vol-Warnung ; Swaption USD/GBP imported ohne Warnung, CHF mit "No swaption vol surface"
== R3-1/R3-2 from-template ==
CCS default: collateral USD PV 9573 fairSpread -22 bp ; collateralCurrency null: PV -95038 fairSpread -0.08 bp ; EURGBP: collateral GBP fairSpread -0.07 warnings []
FRA 3x6 → EURIBOR-3M · 3x9 → 6M · 6x12 → 6M · 1x4 → 3M
== R3-3/R3-4 vols API ==
GET /api/market/vols: swaption EUR,USD,GBP · caplet EUR-EURIBOR-6M,USD-SOFR,GBP-SONIA · fx EURUSD,EURGBP,EURCHF,GBPUSD,USDJPY,EURJPY
PUT /api/market {swaptionVols}: 400 "body must NOT have additional properties"                                  (← R4-5)
PUT /api/market/snapshot (+10bp USD): 200 · USD swaption PV 148505.56 → 166207.54 · X-Market-Snapshot-Id differs: true
vega USD swaption expiry-tenor: n=99 ; vega EURJPY option smile: n=18 ; report USD swaption: IFRS13 Level 2
audit entries: 17 · chainValid true · trade.import 14
```

## Anhang C – UI-Probe (Playwright/Chromium gegen `vite preview :4701`, Auszug)

```
Blotter: 13 Trades · Export-Menü: Blotter CSV | Portfolio JSON | EMIR (CSV) | Portfolio-Report (JSON/Markdown) | JSON importieren | CSV importieren |
  CSV-Vorlagen: Zinsswap · FX-Forward · Cap / Floor / Collar · Swaption · FX-Option · Cross-Currency-Swap · FRA (7)
CSV-Import (6 Zeilen, 1 fehlerhaft): Dialog "Zeile 7 · Nominal fehlt oder ≤ 0" · "5 gültige Zeilen importieren" → 18 Trades · Toast "5 Trades aus CSV importiert · Rückgängig"
  FRA-UI-1: Index EURIBOR-3M · Forward-Satz 2,1551 % ; CCS-UI-1: Collateral USD-CSA · Fairer Basis-Spread −22,0 bp ; SWPT-UI-1 (USD): Forward-Swapsatz 3,3875 % · PV 127.774 · Vega-Buckets "Swaption-Cube USD · Σ 1.522" · Report Level 2 ; FXO-UI-1 (EURJPY): keine Vol-Warnung
n z → CCS-0002 · Fairer Basis-Spread −22,0 bp · Collateral USD-CSA ; auf "unbesichert" → −0,1 bp · Hinweis "ohne CSA keine Xccy-Basis – …"
n r → FRA-0002 · Index EURIBOR-3M · 07.12.2026 → 08.03.2027 · Forward-Satz 2,1551 %
Palette: "ccs eurusd 5y fixed 3.00% 10m" → "Cross-Currency-Swap EUR/USD 5Y · Fest 3,00 %" (angelegt: Par-Satz 2,2693 %, Festsatz-Leg, CSA USD)
  "fxo eurjpy call 175 1m 6m" ✓ · "fxo usdjpy put 145,00 1m 6m" ✓ · "fxo eurusd put 5 1m 6m" → "⚠ Strike 5,0000 passt nicht zum Spot EUR/USD 1,1625"
  "swpt usd 1y5y payer 3.5% 10m" → angelegt als EUR-Swaption (Forward-Swapsatz 2,7667 %, PV 38.054)                 (← R4-2)
  "cap usd 5y 4% 10m" → Cap USD ✓ · "irs chf 5y pay 1% 10m" ✓ · "fra 6x12 rec …" ✓ · "fra 3x9 pay …" ✓
Swaption-Editor-Felder: Bezeichnung, Kontrahent, Buch, Status, Collateral (CSA), Upfront / Prämie, UTI, Clearing, Typ, Position, Verfall, Settlement, Strike, Nominal, Swap-Start, Swap-Ende, Modell, Vol-Override (keine Währung)
Markt: Swaption-Cube EUR|USD|GBP · FX-Paare EUR/USD,EUR/GBP,EUR/CHF,GBP/USD,USD/JPY,EUR/JPY · Caplet EUR-EURIBOR-6M|USD-SOFR|GBP-SONIA
  USD 4W×1Y 92 → 120 bp: Badge "geändert", "modifiziert", Zurücksetzen ; Ctrl+Z → 92, Toast "Rückgängig: Swaption-Vol USD 4W×1Y 92,0 → 120,0 bp"
  EUR/JPY ATM 8,8 → 9,5 %: "geändert" ; Caplet USD-SOFR 78 → 90 bp (Tastatur): "geändert" ; "Markt zurücksetzen" → 0 Badges
  Caplet-Inputs: input[748..915] td[742..816] … overlap: true · Klick auf Zellmitte "2,00 %" fokussiert "1,00 %" · Screenshot ohne lesbare Werte   (← R4-3)
  Swaption-Heatmap overlap: false · FX-Karte overlap: false
Kurven: Tabs €STR|EUR 6M|EUR 3M|SOFR|SONIA|SARON|TONA|EUR/USD CSA · "+ FX-Punkte EUR/USD" auf €STR/CSA/TONA
  CSA: 5 → 6 Quotes "FX-Pkt 1M EURUSD ✕ 08.10.2026 · Zero 2,0276 % · DF 0,999778 · 0,000·10⁻⁶" · Chip "Markt modifiziert" · zweiter Klick → "FX-Pkt 3M"
Hilfe (?): Termsheet, Geeignetheit, KID, Confirmation, Portfolio-Report, Cross-Currency, FRA gelistet ; o k → KID-Modal ✓ · o c → Confirmation ✓ · o p → "Portfolio-Report als JSON exportiert (14 Trades)"
page errors: []
```

Probe-Skripte, Ausgaben und Screenshots (`shots-r4/01–09*.png`, `07c-caplet-card.png`) im Scratchpad der Review-Session.
