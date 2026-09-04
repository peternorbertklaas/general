# Re-Review Runde 5: Marktabdeckung Features & Module (Dimension 1, Gewicht 20 %) – DERIVA 0.2.0

**Reviewer-Rolle:** Senior Product Analyst, Treasury- und Derivateberatungssoftware (LPA Captano/Capmatix, Finbridge, d-fine, Bloomberg SWPM/OVML/VCUB/DLIB/MARS, LSEG Swap Pricer/IPA, Murex, FIS Front Arena, Numerix, Quantifi, FINCAD, Reval/ION, Kyriba/Coupa, SAP TRM, ChathamDirect, FI ZWRM, QuantLib/ORE) · **Stand:** 04.09.2026, Branch `claude/derivatives-trading-platform-1arsyu`, Commit `77f2366` (Core-`dist` frisch gebaut 02:49 UTC) · **Modus:** Review only, keine Quelldatei geändert
**Baseline:** `docs/quality/review-markt-r4.md` (Runde 4, Score 98 / 100) mit den Befunden R4-1…R4-6
**Geprüft (Laufzeit):** `npx vitest run` → **Core 321/321, API 85/85, Web 242/242 grün**; `vite build` erfolgreich; Web-App unter `vite preview --port 4921` mit Playwright/Chromium durchgeklickt (`e2e-markt-r5.mjs`, `…r5b.mjs`, `…r5c.mjs`, Auszug Anhang C, keine `pageerror`); offizielle E2E-Suite `apps/web/e2e/smoke.mjs` auf Port 4921 → **E2E OK (286 checks)**; API per `buildApp` + `app.inject` (`probe-api-r5.mts`, Anhang B); Core-Proben gegen `packages/pricing-core/dist` (`probe-core-r5.mjs`, `probe-core-r5c.mjs`, Anhang A). Alle Zahlen unten stammen aus diesen Läufen.
**Roadmap-Regel:** In `02-epics-und-user-stories.md` / README als ⏳ dokumentierte Posten (Bermudan/CMS/Range Accrual, TARF/Strukturen, Marktdaten-Adapter & Kurven-Governance, OIDC/Rollen/DB-Persistenz, Excel-Add-in, Monte-Carlo-Netting-XVA/FVA, PDF-Template-Service, Inflations-ZC-Swap, PRIIPs Annex-II-Monte-Carlo, SIMM/CRIF, VaR/Attribution, Batch-EoD/Webhooks, Designationsmemo, EMIR-Tabelle 3/UPI/XML) werden **nicht** als Lücke gewertet.

---

## 1. Score

### **Marktabdeckung Features & Module: 99 / 100** (rechnerisch 99,3; Runde 1: 60, Runde 2: 86, Runde 3: 97, Runde 4: 98)

**In einem Satz:** Alle sechs Runde-4-Befunde sind geschlossen und in Core, API **und** UI reproduziert – die Caplet-Vol-Karte ist per Maus bedienbar (Input 56 px in 62-px-Zelle, Klick trifft die eigene Zelle), USD/GBP/CHF/JPY-Swaptions entstehen per Palette (`swpt usd …`, unbekannte Währung wird abgewiesen) und im Editor (Select „Währung“ mit fünf Cube-Währungen), CCS ohne Collateral-Kurve tragen die Warnung `COLLATERAL_CURVE_MISSING:` bis in Editor-Hint, Report-Methodik und Termsheet, CHF-SARON- und JPY-TONA-Cubes/Caplet-Flächen liegen im Beispielmarkt (Level 2, Vega-Buckets), Vol-Flächen und FX-Fixings sind per `PUT /api/market` änderbar, der FRA-Index kennt nur noch Indizes mit Kurve, FX-Fixings haben einen Editor in der Marktansicht und wandern in Snapshot und Snapshot-ID, Clearingpflicht ist im Editor (UKWN/TRUE/FLSE) und die EMIR-Ausprägungen folgen ITS 2022/1860 – **übrig bleiben drei Randposten: Vol-Flächen werden strukturell nicht validiert (ein Cube mit falschen Dimensionen wird per API/Snapshot angenommen und lässt anschließend jede Swaption-Bewertung mit „Invalid trade“ scheitern), USDCHF/GBPJPY/CHFJPY haben weiterhin keine FX-Vol-Fläche und die Palette warnt hier nicht, und die Web-CSV-Vorlage für CCS kennt keine CSA-Spalte.**

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, UX-Reibung −1…−3, kosmetisch −0,2…−1; Roadmap-dokumentiert = 0; keine Doppelzählung mit Quant/UI/Flows/API):

| Bereich | R1 | R2 | R3 | R4 | R5 | Restlücken (Nummern → Abschnitt 3) |
|---|---:|---:|---:|---:|---:|---|
| A Instrumente & Strukturen | −10 | −3,7 | −0,8 | −0,5 | 0 | R4-1/R4-6 behoben |
| B Kurven & Marktdaten | −5 | −0,7 | −0,2 | 0 | −0,3 | Vol-Flächen ohne Strukturvalidierung in `validateMarket`/`PUT /api/market`, Folgefehler „Invalid trade“ (R5-1 −0,3) |
| C Modelle | −1 | 0 | 0 | 0 | 0 | – |
| D Sensitivitäten | −2 | −0,8 | 0 | 0 | 0 | Vega-Buckets auch für CHF/JPY-Cubes |
| E Szenarien / VaR | −1 | −0,5 | 0 | 0 | 0 | VaR = Roadmap |
| F XVA | −2,5 | −0,5 | 0 | 0 | 0 | Netting/CRIF = Roadmap |
| G Hedge Accounting | −4 | −3,0 | 0 | 0 | 0 | – |
| H Regulatorik | −4 | −1,5 | 0 | 0 | 0 | EMIR-Werte nach ITS 2022/1860 in Core, API, UI-CSV |
| I Dokumente | −2,5 | −1,0 | 0 | 0 | 0 | PDF/Annex-II-MC = Roadmap |
| J Workflow / Beratung | −2,5 | −0,3 | 0 | 0 | 0 | Freigabe = Roadmap |
| K UI | −0,5 | −1,3 | −0,8 | −1,5 | 0 | R4-2/R4-3 behoben |
| L Integration | −2,5 | −0,5 | −0,3 | −0,2 | −0,2 | Web-CSV-Vorlage CCS ohne Spalte `collateral` (R5-3 −0,2) |
| M Admin | −2,5 | 0 | 0 | 0 | 0 | Rollen/DB = Roadmap |
| Sonstiges (Beispielmarkt) | – | −0,5 | −0,5 | −0,2 | −0,2 | Keine FX-Flächen USDCHF/GBPJPY/CHFJPY (Fallback 8 %, Level 3) und Palette ohne Hinweis (R5-2 −0,2) |
| **Summe** | **−40** | **−14,3** | **−2,6** | **−2,4** | **−0,7** | → **99,3 ≈ 99 / 100** |

Einordnung (gleiche Skala, v1-Workstation-Scope, Einschätzung): Bloomberg SWPM+OVML+VCUB+MARS ≈ 85 (kein Hedge Accounting, keine deutschen Beratungsdokumente), LPA Capmatix OTC ≈ 75, ORE ≈ 60, Kyriba/Coupa ≈ 55. Mit G5-Zinsvol-Flächen, Vol-/Fixing-Pflege in UI und API und der durchgängigen CSA-Warnung ist die funktionale Abdeckung für Vanilla-Zins/FX vollständig; die Restdifferenz zu 100 ist Datenqualitäts-Absicherung (Strukturvalidierung importierter Flächen) und Beispieldaten für zwei Kreuzpaare.

---

## 2. Status der Runde-4-Befunde R4-1…R4-6

Legende: **behoben** = im Code vorhanden **und** per Probe/UI reproduziert · **teilweise** = Kern vorhanden, benannter Rest · **offen** = unverändert.

| # | Befund R4 | Status | Nachweis (Datei / Probe / UI) | Rest |
|---|---|---|---|---|
| **R4-1** | CCS-CSA-Default für Nicht-USD-Paare ohne Collateral-Kurve, ohne Warnung; Report schrieb „CSA-Kurve (Besicherung in GBP)“ | **behoben** | `market-context.ts:160–183` `hasCollateralCurve`/`collateralCurveWarnings` → `COLLATERAL_CURVE_MISSING: no EUR discount curve for collateral in GBP (collateralDiscountCurveId "EUR\|GBP"); discounted on EUR-ESTR – cross-currency basis not priced`; `valuation-report.ts:206, 543` Methodiktext „Standard-Diskontkurve – Besicherung in GBP vereinbart, aber für EUR keine Collateral-Kurve …“, IFRS-13-Hinweis; `TradeEditor.tsx:743` Editor-Hint; Test `review-r4.test.ts:324–356`. Core: EURGBP/EURJPY/EURCHF/GBPUSD/USDJPY → je eine Warnung, EURUSD (USD-CSA) und `collateralCurrency: null` → keine (Anhang A). API `from-template` EURGBP → 200 mit Warnung, `/api/report` Level 2 mit Methodikzeile. UI: Palette `ccs eurgbp 5y -20bp 10m` → CSA-Select „GBP“, Hint „Keine EUR-Diskontkurve für Besicherung in GBP (Collateral-Kurve „EUR\|GBP“ fehlt) – Diskontierung auf EUR-ESTR, Cross-Currency-Basis nicht gepreist“; Report (`o r`): „FAIR VALUE (BILATERAL, IFRS 13 LEVEL 2)“, Methodik mit `COLLATERAL_CURVE_MISSING`, „Hinweis: Besicherung in GBP ohne Collateral-Kurve …“; Termsheet trägt dieselbe Zeile (Anhang C). Der Default bleibt bewusst die Quote-Währung (statt `undefined`), die Warnung macht den Zustand prüferfest | – |
| **R4-2** | Palette `swpt usd …` legte stillschweigend EUR an; Swaption-Editor ohne Währung | **behoben** | `quick-parser.ts:499–538` (`ccy`-Token, Fehler „Unbekannte Währung“, Vorschau-Warnung ohne Cube), `:610` Beispiel `swpt usd 1y5y payer 3.5% 10m`; `TradeEditor.tsx:1075–1097` `setCurrency` baut das Underlying mit `makeVanillaSwap` (Marktkonventionen) neu, Select „Währung“ aus den Cube-Währungen; `CommandPalette.tsx:80` reicht `swaptionVolCurrencies`; `03-ui-konzept:119` Grammatik `swpt [ccy]`; E2E `smoke.mjs:448, 470`. UI: Vorschau „Payer-Swaption USD 1Yx5Y @ 3,500 %“, angelegt: Forward-Swapsatz **3,3875 %**, PV **127.774** (identisch mit der R4-CSV-Variante), Select „Währung“ = USD mit Optionen „EUR/USD/GBP/CHF/JPY (Vol-Cube)“; Umschalten auf CHF bewertet neu; `swpt chf 1y5y payer 1% 10m` ✓; `swpt nok …` → „⚠ Unbekannte Währung „NOK“ – verfügbar: EUR, USD, GBP, CHF, JPY“; `swpt usd payer 3% 10m` → „Format: swpt [usd] 1y5y payer 3% 10m“; `@Landesbank Hessen` anhängbar | – |
| **R4-3** | Caplet-Vol-Zellen überlappen (Input 167 px in 62-px-Zelle), Maus trifft Nachbarzelle | **behoben** | `MarketView.tsx:244–251, 272` `table-layout`-Colgroup, `NumInput width="100%"`; E2E `smoke.mjs:960–988` Regressionscheck „Input ≤ Zelle“ + „Klick fokussiert eigene Zelle“. Playwright 1600 px: Inputs **56 px** in **62-px**-Zellen, `fits: true`, `overflow: false`, Werte lesbar (62/60/58 bp); Klick auf Zelle 2 → `activeElement` „Caplet-Vol 6M Strike 1,00 %“ (die eigene Zelle); Screenshot `01-caplet-card.png` | – |
| **R4-4** | CHF/JPY ohne Zins-Vol-Flächen (Fallback 70/60 bp, Level 3) | **behoben** | `sample-market.ts:384–440` `SAMPLE_CHF_SWAPTION_VOLS` (GBP-Form × 0,7, SABR mit 2 %-Shift), `SAMPLE_JPY_SWAPTION_VOLS` (× 0,52), `SAMPLE_CHF_CAPLET_VOLS`/`SAMPLE_JPY_CAPLET_VOLS` (Strikes 0–4 %), Registrierung `:582–595`; CHANGELOG präzisiert („CHF-SARON- und JPY-TONA-Swaption-Cubes und Caplet-Flächen“). Core: CHF-Swaption 1Yx5Y `vol 73,6 bp · Level 2 · warnings []`, JPY `50,6 bp · Level 2`; CHF-/JPY-Cap Level 2; Vega-Buckets Expiry × Tenor für CHF (99 Zellen). API `GET /api/market/vols` → swaption EUR/USD/GBP/CHF/JPY, caplet 5; CHF/JPY-Swaption `/api/price` Level 2 ohne Warnung, CSV-Import `SWPT-CHF-1`/`SWPT-JPY-1` ohne Warnung. UI: Segmente „EUR/USD/GBP/CHF/JPY“ und „…/CHF-SARON/JPY-TONA“, CHF-Zelle 4W×1Y 61,6 bp editierbar (Badge, Undo-Toast „Rückgängig: Swaption-Vol CHF 4W×1Y 61,6 → 99,0 bp“); `swpt chf …` → Vega-Karte „Swaption-Cube CHF · Σ 1.983 EUR“, Report Stufe 2 | FX-Flächen USDCHF/GBPJPY/CHFJPY weiterhin Fallback → R5-2 |
| **R4-5** | `PUT /api/market` ohne Vol-Felder | **behoben** | `routes/market.ts:285–291, 312–317, 347–357` `swaptionVols`/`capletVols`/`fxVols` (Ersatz je Key, Audit `market.vols`) und `fxFixings` (Ersatz gleiches Paar+Datum, Pattern `^[A-Z]{6}$`, ISO-Datum); OpenAPI listet die neun Body-Felder. Probe: USD-Cube +10 bp → 200, USD-Swaption PV **156.484 → 173.971**, `X-Market-Snapshot-Id` wechselt; `capletVols` CHF-SARON, `fxVols` EURJPY → 200; `fxFixings` anlegen/ersetzen → 200, `EUR/USD` bzw. `2026-13-03` → 400; Stichtagswechsel behält Fixings; Snapshot-Roundtrip trägt `fxFixings` | keine Strukturvalidierung der Flächen → R5-1 |
| **R4-6** | `fraIndexForPeriod` lieferte EURIBOR-1M/-12M ohne Kurve (`1x2`, `12x24` → `CURVE_NOT_FOUND`) | **behoben** | `builders.ts:567` `DEFAULT_AVAILABLE_INDICES`, `:589–610` `fraIndexForPeriod(ccy, months, availableIndices)` (nächster verfügbarer Tenor, Ties zum längeren), `routes/trades.ts:53–68` `availableIndices(m)` aus dem geladenen Markt; Test `review-r4.test.ts:364–377`. Core: `1x2`/`2x3` → EURIBOR-**3M** (PV −763/−649), `12x24`/`1x13` → EURIBOR-**6M**, `3x6` → 3M, `3x9`/`6x12` → 6M, USD/GBP/CHF/JPY → RFR; mit `EURIBOR-12M` in der Liste → 12M. API `from-template` `1x2` → 200 EURIBOR-3M (07.10.–09.11.2026), `12x24` → 6M; CSV `FRA 1x2` → `imported 1/1` (R4: abgelehnt). UI: Palette `fra 1x2 pay 2.1% 10m` → Vorschau „… · EURIBOR-3M“, `fra 12x24 rec …` → „EURIBOR-6M“ | – |

**Weitere Runde-4-Maßnahmen aus dem Programm (geprüft, ohne eigene Befundnummer):** FX-Fixings-Editor in der Marktansicht (`MarketView.tsx:304–450`: Karte „FX-Fixings (MtM-Reset, editierbar)“, Paar-Select EUR/USD…USD/JPY, „+ heute aus Spot“ → Zeile `1,1625`, Duplikat-Toast „ist bereits hinterlegt“, Snapshot-Zeile „FX-Fixings: 1“, Chip „modifiziert“, „Markt zurücksetzen“ löscht sie, `CurvesView.tsx:159, 443` zählt sie mit); `fxFixings` im Snapshot (`serializeMarket` → Feld `fxFixings` mit ISO-Daten, Roundtrip erhält Snapshot-ID, ID unterscheidet sich vom Basis-Markt, `validateMarket` meldet Duplikate „given twice“, inverse Abfrage `JPYUSD` → 1/158,2); saisonierter MtM-CCS ohne Fixing → `MISSING_FX_FIXING:` (PV −40.441), mit Fixing 1,12 → PV 326.238 ohne die Warnung; Clearingpflicht im Editor (`TradeEditor.tsx:660–669`: Select „nicht bestimmt (UKWN) / ja – clearingpflichtig (TRUE) / nein (FLSE)“, Hint „EMIR-Feld 30 … unabhängig vom tatsächlichen Clearing (Feld 31: Y / N)“); EMIR-ITS-Werte (`emir.ts:73–77, 149–150`: `cleared` Y/N/I mit `intentToClear`, `clearingObligation` TRUE/FLSE/UKWN, `collateralPortfolioIndicator` TRUE/FLSE – Core, `GET/POST /api/emir/valuations`, UI-Export „⤓ EMIR-Bewertungen (CSV)“ → `…;FLSE;N;UKWN;`).

**Runde-1…3-Posten:** unverändert geschlossen; G14/G24/G26 bleiben dokumentierte Roadmap (kein Abzug).

---

## 3. Neue Befunde (Runde 5)

Severity: **Niedrig** = Lücke zweiter Ordnung für eine v1-Persona · **Kosmetisch** = Voreinstellung/Konsistenz/Beispieldaten.

| # | Sev. (Abzug) | Ort | Befund (reproduziert) | Fix |
|---|---|---|---|---|
| **R5-1** | Niedrig (−0,3) | `snapshot.ts:150–185` (`validateMarket` prüft Kurven, FX-Spots, `fxFixings`, `meta` – **keine** Vol-Flächen), `routes/market.ts:353–355` (Merge je Key ohne Validierung), `models/vol-surfaces.ts` (Gitterzugriff ohne Dimensionsprüfung) | **Importierte Vol-Flächen werden strukturell nicht validiert; ein defekter Cube vergiftet den Markt und tarnt sich als Trade-Fehler.** Probe: `PUT /api/market {swaptionVols:{USD:{…, atm:[[0.01]]}}}` (1×1 statt 11×9) → **200**, Snapshot-ID wechselt, Readiness „ready“; anschließend `POST /api/price` USD-Swaption → **400 `INVALID_TRADE` „Invalid trade“** (Core-`TypeError: Cannot read properties of undefined (reading '3')`), obwohl der Trade korrekt ist; `PUT` mit FX-Fläche `atm:[0.5]` (1 statt 7 Verfälle) → 200, EURUSD-Option → 422 `NON_FINITE_PV`. `validateMarket` liefert für beide Fälle `[]`, d. h. auch `PUT /api/market/snapshot` und der UI-Snapshot-Import (`deriva.market/1`) nehmen die Fläche an. Ebenso wird `volType: "Lognormal"` mit Normal-Zahlen (0,0097) angenommen (PV 156.484 → 180, keine Warnung). In einem IPV-Prozess, der Broker-Flächen per API nachzieht (der Zweck von R4-5), ist das genau der Fehlerpfad; Bloomberg VCUB/ORE lehnen ein Gitter mit falscher Zeilenlänge beim Laden ab. | `validateVolSurfaces(ctx)` in `validateMarket`: Swaption `atm.length === expiries.length` und jede Zeile `=== tenors.length`, Caplet `vols` = Expiries × Strikes, FX `atm/rr25/bf25/rr10/bf10` = Verfälle, streng steigende Expiries, Vols endlich und > 0, `volType` im Enum, `currency`/`index` konsistent zum Key; in `PUT /api/market` und `/snapshot` → 400 `VOL_SURFACE_INVALID` mit Pfad; im Core beim Gitterzugriff `PricingError("VOL_SURFACE_MALFORMED")` statt `TypeError` (dann 422 mit Marktbezug, nicht „Invalid trade“); Plausibilität `volType`: Normal-Vols > 5 % oder Lognormal-Vols < 1 % → Warnung `VOL_TYPE_SUSPICIOUS:`; Vertragstest. |
| **R5-2** | Kosmetisch (−0,2) | `sample-market.ts:596–603` (`fxVols` EURUSD/EURGBP/EURCHF/GBPUSD/USDJPY/EURJPY), `quick-parser.ts:565–598` (`fxo`-Zweig ohne Flächen-Hinweis; der `swpt`-Zweig `:530–537` warnt bei fehlendem Cube) | **USDCHF, GBPJPY und CHFJPY haben keine FX-Vol-Fläche, und die Palette weist nicht darauf hin.** Core: `USDCHF`/`GBPJPY`/`CHFJPY` ATM-Call → `vol 8,00 % · Level 3 · "No FX vol surface – using 8% vol"` (Spot-Triangulation funktioniert). UI: `fxo usdchf call 0.80 1m 6m` → Vorschau „FX-Option USDCHF Call @ 0,8000 · 1m · Verfall 6M“ **ohne** Warnung und wird als Level-3-Trade angelegt – inkonsistent zu `swpt` („⚠ kein Swaption-Vol-Cube …“). USD/CHF ist für die Schweizer/DACH-Persona ein Kernpaar (USD-Exporteure mit CHF-Buch). R4-4 hatte die Kreuzpaare als „optional“ genannt; der Rest ist mit den neuen Zinsvols der einzige Fallback im Beispielmarkt. | `SAMPLE_USDCHF_VOLS`/`SAMPLE_GBPJPY_VOLS` (indikativ, Spot-Delta) analog `SAMPLE_GBPUSD_VOLS`; alternativ Kreuz-Vol aus den EUR-Flächen mit Korrelation (σ²ₓ = σ₁² + σ₂² − 2ρσ₁σ₂) als dokumentierter Fallback statt 8 %; Palette: `fxVolPairs` in `QuickEntryOptions`, Vorschau „⚠ keine FX-Vol-Fläche für USDCHF (Fallback 8 %, Level 3)“ wie beim Swaption-Zweig; Test: keine `No FX vol surface`-Warnung für alle Paare, deren Spot im Markt liegt oder triangulierbar ist. |
| **R5-3** | Kosmetisch (−0,2) | `portfolio-io.ts:240–258` (Web-CSV-Vorlage CCS: `type,id,name,counterparty,book,pair,notional,spread,rate,fxSpot,direction,start,maturity,status`), `:606` (`collateralCurrency: ccsCollateralCurrency(pair)` fest) vs. `apps/api/src/lib/csv-import.ts:101` (`collateralCurrency` optional) | **Die Web-CSV-Vorlage „Cross-Currency-Swap“ hat keine CSA-Spalte** – ein Bestand mit unbesicherten oder USD-besicherten Nicht-USD-CCS (EURGBP unter USD-CSA, EURCHF unbesichert) lässt sich in der Workstation nur per JSON oder nachträglich im Editor korrekt einlesen; die API-Vorlage kann es. Nach R4-1 ist der Default (Quote-Währung) für Nicht-USD-Paare zwar warnend, aber nicht per Datei überschreibbar. In R4 „ohne Abzug“ geführt, weil der Root Cause R4-1 offen war; jetzt eigenständige Integrationslücke. | Spalte `collateral` (Alias `csa`, `collateralCurrency`; leer = Default, `none`/`unbesichert` = `null`) in Vorlage, Beispielzeile und Parser; Export-Menü-Vorlage aktualisieren; Unit-Test `portfolio-io.test.ts` mit EURGBP + `USD`/`none`. |

**Ohne Abzug, aber dokumentierenswert:**
- Hilfe-Overlay (`?`) nennt die Vol-Bearbeitung und `swpt usd …`, aber nicht die neue Karte „FX-Fixings (MtM-Reset)“ (Suche „Fixing“ trifft nur Vol-Zeilen); ein Satz im Abschnitt „Markt · Vol-Flächen“ genügt.
- `POST /api/risk/vega` liefert für CHF/JPY-Swaptions 200 (Antwortobjekt `reports[]`, nicht `buckets` auf oberster Ebene – Vertrag unverändert, nur Hinweis für Klienten).
- `fra usd 3x6 …` erzeugt weiterhin ein FRA auf SOFR (wie R3/R4; kein Kernfall der DACH-Persona).
- Palette: `swpt` warnt für Währungen ohne Cube nur, wenn der Markt keine hat – mit den fünf G5-Cubes ist der Pfad im Beispielmarkt nicht mehr erreichbar (korrekt), bleibt aber für importierte Snapshots ohne Cube relevant.

---

## 4. Feature-Matrix – Statusänderungen gegenüber Runde 4 (nur DERIVA-Spalte)

| Feature | R4 | R5 | Beleg |
|---|---|---|---|
| CCS mit CSA ohne Collateral-Kurve → Warnung in Core/API/Editor/Report/Termsheet, Methodik nennt Standard-Diskontkurve | ❌ | ✅ | R4-1 |
| Swaption-Währung in Palette (`swpt usd/gbp/chf/jpy`) und Editor (Select „Währung“, Underlying nach Marktkonvention) | ❌ | ✅ | R4-2 |
| Caplet-Vol-Karte per Maus bedienbar, Werte lesbar, E2E-Regressionscheck | 🔶 | ✅ | R4-3 |
| Zins-Vol-Flächen für alle fünf Währungen mit Diskontkurve (EUR/USD/GBP/CHF/JPY), Level 2 | 🔶 | ✅ | R4-4 |
| FX-Vol-Flächen für Kreuzpaare USDCHF/GBPJPY/CHFJPY | ❌ | ❌ (Fallback 8 %) | R5-2 |
| Vol-Flächen per `PUT /api/market` (je Key, Audit `market.vols`) | 🔶 Snapshot | ✅ | R4-5 |
| Strukturvalidierung importierter Vol-Flächen (API/Snapshot/UI) | – | ❌ | R5-1 |
| FRA-Index nur aus Indizes mit Kurve (Core-Default, API aus Markt, CSV, Palette) | 🔶 | ✅ | R4-6 |
| FX-Fixings: Marktkontext, Snapshot (`fxFixings`), Snapshot-ID, `PUT /api/market`, UI-Editor, Undo, „Markt zurücksetzen“ | – | ✅ | Abschnitt 2 |
| Clearingpflicht (EMIR Feld 30) im Editor; ITS-2022/1860-Werte in Core/API/UI-CSV | 🔶 | ✅ | Abschnitt 2 |
| Web-CSV-Vorlage CCS mit CSA-Spalte | ❌ | ❌ | R5-3 |
| Excel / Live-Marktdaten / Rollen / Netting-CVA / VaR / CRIF / Bermudan / TARF / PDF / Inflation | ⏳ | ⏳ Roadmap | kein Abzug |

---

## 5. Verifizierte Positivbefunde (Auszug, alle reproduziert)

- **Beispielmarkt G5-komplett:** 8 Kurven (€STR, EURIBOR 3M/6M, SOFR, SONIA, SARON, TONA, EUR-ESTR-USDCSA), 5 Swaption-Cubes mit SABR-Punkten, 5 Caplet-Flächen, 6 FX-Flächen mit Delta-/ATM-Konvention, 5 Spots (Triangulation für alle Kreuze), 3 Kreditkurven; 16 Standard- und 6 historische Szenarien (Lehman, Eurokrise, Covid, Zinswende, SNB, Brexit); jede Währung mit Diskontkurve bewertet Swaptions/Caps auf Level 2 mit Vega-Buckets Expiry × Tenor.
- **Vol- und Fixing-Pflege in beiden Kanälen:** UI zellweise mit typisiertem Undo („Rückgängig: Swaption-Vol CHF 4W×1Y 61,6 → 99,0 bp“), Badges, Karten-Reset; API je Key mit Audit `market.vols`; FX-Fixings mit Ersetzungslogik (Paar+Datum), Duplikat-Validierung im Snapshot, Persistenz über Stichtagswechsel; Snapshot-ID reagiert auf jede Änderung.
- **CSA-Transparenz:** dieselbe `COLLATERAL_CURVE_MISSING`-Aussage in Core-Warnung, API-Antwort, Editor-Hint, Report-Methodik (Level-2-Hinweis) und Termsheet – prüferfest; EURUSD unter USD-CSA weiterhin −22,0 bp Xccy-Basis.
- **UI-Erreichbarkeit aller Kernfunktionen:** 8 Views (`g b/p/c/s/m/r/v/h`), 11 Neuanlage-Chords (`n s/c/w/f/o/b/a/i/x/z/r`), Dokumente `o r/t/g/k/c/p`, Export `x b/x c`, `y i`; Palette mit 61 Kommandos bei leerer Eingabe; Schnelleingabe-Grammatik deckt alle acht Trade-Typen, Währungstoken für `irs/ois/cap/collar/swpt/basis/amort/fra`, `@Kontrahent`, `stichtag`; Fehlertexte für unbekannte Währung und unvollständige Form; Export-Menü mit Blotter-CSV, Portfolio-JSON, EMIR-CSV, Portfolio-Report (JSON/Markdown) und sieben CSV-Vorlagen.
- **Regulatorik:** EMIR-Refit-Werte nach ITS 2022/1860 (Y/N/I, TRUE/FLSE/UKWN, TRUE/FLSE) konsistent in Core, `GET/POST /api/emir/valuations` (JSON/CSV) und UI-CSV; UTI-Filter „ohne UTI“ und Toast „15, 13 ohne UTI“.
- **API-Vertrag:** OpenAPI 3.1.0, 41 Operationen, `text/csv` im `requestBody` von `importTrades`, `PUT /api/market` mit neun Body-Feldern, 34 dokumentierte Fehlercodes; Tests Core 321 / API 85 / Web 242 grün.

---

## 6. Was für 100 noch fehlt

1. **R5-1 Strukturvalidierung der Vol-Flächen** in `validateMarket` (+ 400 in `PUT /api/market`/`/snapshot`, `PricingError` statt `TypeError` im Gitterzugriff) – der einzige Posten mit Auswirkung auf den IPV-Pfad, geschätzt zwei Stunden inkl. Vertragstest.
2. **R5-2 FX-Flächen USDCHF/GBPJPY** (indikativ oder Kreuz-Vol mit Korrelation) und Palette-Hinweis im `fxo`-Zweig.
3. **R5-3 CSA-Spalte** in der Web-CSV-Vorlage „Cross-Currency-Swap“.

Mit 1 läge die Dimension bei ≈ 99,6; 2–3 schließen die Lücke zu 100 für den v1-Scope.

---

## Anhang A – Core-Probe (`node probe-core-r5.mjs` / `probe-core-r5c.mjs` gegen `dist`, Auszug)

```
Engine deriva-pricing-core/0.2.0 valDate 2026-09-03
curves: EUR-ESTR,EUR-EURIBOR-6M,EUR-EURIBOR-3M,USD-SOFR,GBP-SONIA,CHF-SARON,JPY-TONA,EUR-ESTR-USDCSA
swaptionVols: EUR,USD,GBP,CHF,JPY · capletVols: EUR-EURIBOR-6M,USD-SOFR,GBP-SONIA,CHF-SARON,JPY-TONA · fxVols: EURUSD,EURGBP,EURCHF,GBPUSD,USDJPY,EURJPY
DEFAULT_AVAILABLE_INDICES: EURIBOR-3M,EURIBOR-6M,ESTR,SOFR,SONIA,SARON,TONA
== R4-1 ==
EURUSD {} → collateral USD · PV 9.587 · fairSpread -22,00 bp · Level 2 · warnings []
EURUSD {"collateralCurrency":null} → collateral none · PV -95.026 · fairSpread -0,08 bp · Level 2 · warnings []
EURGBP {} → collateral GBP · PV -95.144 · fairSpread -0,07 bp · Level 2 · warnings ["COLLATERAL_CURVE_MISSING: no EUR discount curve for collateral in GBP (collateralDiscountCurveId "EUR|GBP"); discounted on EUR-ESTR – cross-currency basis not priced"]
EURJPY/EURCHF → collateral JPY/CHF · je eine COLLATERAL_CURVE_MISSING-Warnung ; GBPUSD/USDJPY → collateral USD · Warnung für GBP bzw. JPY
== R4-6 ==
1x2 → EURIBOR-3M PV -763 · 2x3 → 3M · 1x4 → 3M · 3x6 → 3M (fwd 2,16 %) · 3x9 → 6M · 6x12 → 6M · 12x24 → 6M · 1x13 → 6M · 9x12 → 3M · 2x5 → 3M · 4x8 → 3M ; USD/GBP/CHF/JPY 3x6 → SOFR/SONIA/SARON/TONA ; EUR 12 mit 12M-Kurve → EURIBOR-12M
== R4-4 ==
EUR swaption 1Yx5Y: vol 82,21 bp L2 · USD 97,24 bp L2 · GBP 93,52 bp L2 · CHF PV 6.465 vol 73,60 bp L2 · JPY vol 50,63 bp L2 – alle warnings []
EUR/USD/GBP/CHF/JPY cap 5Y @2 %: Level 2, warnings []  (CHF: SARON PV 21.205 · JPY: TONA PV 179)
EURUSD 7,56 % L2 · EURGBP 5,93 % · EURCHF 5,38 % · GBPUSD 8,00 % L2 · USDJPY 9,79 % · EURJPY 9,16 %
USDCHF / GBPJPY / CHFJPY: vol 8,00 % · Level 3 · "No FX vol surface – using 8% vol"                         (← R5-2)
CHF swaption vega expiry-tenor: 99 buckets (CHF-SWAPTION-NORMAL)
== fxFixings ==
snapshot keys: schema,valuationDate,meta,discountCurveId,collateralDiscountCurveId,curves,fxSpots,fixings,fxFixings,swaptionVols,capletVols,fxVols,credit
roundtrip fxFixings ok · snapshotId equal after roundtrip: true · differs from base: true · getFxFixing JPYUSD (inverse) = 0.006321 · validateMarket []
duplicate fxFixings → ["FX fixing EURUSD on 2026-03-03 given twice"]
seasoned MtM CCS: PV no fixing -40.441 warnings [MISSING_FIXING ESTR, MISSING_FIXING SOFR, "MISSING_FX_FIXING: Missing FX fixing for EURUSD on 2026-06-05; MtM reset of leg 1 valued with today's rate as proxy"] · with fixing 1,12 → PV 326.238, keine MISSING_FX_FIXING-Warnung
== EMIR ITS ==
plain: cleared=N clearingObligation=UKWN collateralPortfolioIndicator=FLSE method=MTMO · cleared: Y/TRUE/FLSE · intentToClear: I/TRUE · CSA EUR + Pflicht nein: N/FLSE/TRUE
CSV row: ;IRS-…;;SRCCSP;10000000.00;EUR;-177154.33;EUR;2026-09-03T17:00:00Z;MTMO;1.000000;FLSE;Y;TRUE;
== R5-1 ==
validateMarket malformed USD cube (atm 1x1): []  → priceTrade USD swaption: TypeError "Cannot read properties of undefined (reading '3')"
validateMarket malformed fx (atm length 1): []   → priceTrade EURUSD option: NON_FINITE_PV
deserializeMarket(malformed) ok, validate: []
```

## Anhang B – API-Probe (`npx tsx probe-api-r5.mts`, `app.inject`, Auszug)

```
openapi 3.1.0 ops: 41 · import requestBody content types: [application/json, text/csv]
PUT /api/market body props: valuationDate, fxSpots, fxFixings, swaptionVols, capletVols, fxVols, fixings, fxSpotDates, missingFixingPolicy
GET /api/market/vols: swaption EUR,USD,GBP,CHF,JPY · caplet EUR-EURIBOR-6M,USD-SOFR,GBP-SONIA,CHF-SARON,JPY-TONA · fx 6 Paare
== R4-5 ==
price USD swaption 1Yx5Y: 200 PV 156.484 vol 0,00971 · PUT {swaptionVols USD +10bp}: 200 · price after: PV 173.971 · X-Market-Snapshot-Id wechselt
PUT capletVols CHF-SARON: 200 · PUT fxVols EURJPY: 200
PUT fxFixings [2]: 200 · replace gleiches Paar+Datum: 200 (1,08 → 1,09) · "EUR/USD"/2026-13-03: 400 (pattern) · Stichtagswechsel behält fxFixings · PUT /api/market/snapshot mit fxFixings: 200
PUT malformed cube (atm 1x1): 200 · price USD swaption danach: 400 INVALID_TRADE "Invalid trade" · readiness "ready"        (← R5-1)
PUT cube volType Lognormal mit Normal-Zahlen: 200 · price: PV 180 warnings []                                             (← R5-1)
PUT fx surface atm length mismatch: 200                                                                                   (← R5-1)
== R4-1 from-template ==
EURUSD → collateral USD fairSpread -22,00 bp warnings [] · EURGBP → GBP -0,07 bp + COLLATERAL_CURVE_MISSING · EURJPY → JPY + Warnung · GBPUSD → USD + Warnung (GBP) · EURGBP collateralCurrency null → warnings []
/api/report EURGBP: Level 2, Methodik „Standard-Diskontkurve – Besicherung in GBP vereinbart, aber für EUR keine Collateral-Kurve …“
== R4-6 from-template / CSV ==
1x2 → EURIBOR-3M (2026-10-07 → 2026-11-09) · 2x3 → 3M · 3x6 → 3M · 3x9 → 6M · 12x24 → 6M · 1x13 → 6M ; CSV FRA 1x2 → 200 imported 1/1 PV 149,67
== R4-4 ==
CHF swaption /api/price: 200 PV 72.846 vol 65,7 bp warnings [] Level 2 · JPY: PV 221.190 vol 48,0 bp Level 2 · /api/risk/vega 200
CSV Swaption CHF/JPY: 200 imported 2/2, warnings []
== EMIR ==
GET /api/emir/valuations: 11 records · cleared [N] · clearingObligation [UKWN] · collateralPortfolioIndicator [FLSE] · method [MTMO] ; CSV-Header mit Cleared/Clearing obligation/Clearing member ; POST mit uti-Map + intentToClear: 200
audit entries 28 · chainValid true
```

## Anhang C – UI-Probe (Playwright/Chromium gegen `vite preview :4921`, Auszug)

```
Blotter: 13 Trades · Markt: Swaption-Cube EUR|USD|GBP|CHF|JPY · Währungspaar EUR/USD|EUR/GBP|EUR/CHF|GBP/USD|USD/JPY|EUR/JPY · Caplet EUR-EURIBOR-6M|USD-SOFR|GBP-SONIA|CHF-SARON|JPY-TONA
Caplet-Inputs Zeile 1: w 56 px in td 62 px, fits: true, overflow: false, Werte 62/60/58 · Klick Zelle 2 → aktiv "Caplet-Vol 6M Strike 1,00 %"     (R4-3 ✓)
CHF-Cube Zelle 4W×1Y 61,6 → 99: Badge "geändert" · Ctrl+Z → 61,6, Toast "Rückgängig: Swaption-Vol CHF 4W×1Y 61,6 → 99,0 bp" · JPY-Cube 45,8
FX-Fixings-Editor: Paare EUR/USD,EUR/GBP,EUR/CHF,EUR/JPY,USD/JPY · "+ heute aus Spot" → 1 Zeile, Kurs 1,1625 · erneut → Toast "FX-Fixing EUR/USD 03.09.2026 ist bereits hinterlegt" · Snapshot "FX-Fixings: 1", Chip "modifiziert"
Palette: "swpt usd 1y5y payer 3.5% 10m" → "Payer-Swaption USD 1Yx5Y @ 3,500 %" → angelegt: Forward-Swapsatz 3,3875 %, PV 127.774, Select Währung = USD (Optionen EUR/USD/GBP/CHF/JPY (Vol-Cube)) → CHF: PV 130
  "swpt chf 1y5y payer 1% 10m" ✓ (PV 77.293, Vega "Swaption-Cube CHF · Σ 1.983 EUR") · "swpt nok …" → "⚠ Unbekannte Währung „NOK“ – verfügbar: EUR, USD, GBP, CHF, JPY" · "swpt usd payer 3% 10m" → "Format: swpt [usd] 1y5y payer 3% 10m"
  "ccs eurgbp 5y -20bp 10m" → CSA "GBP" · Hint "Keine EUR-Diskontkurve für Besicherung in GBP (Collateral-Kurve „EUR|GBP“ fehlt) – Diskontierung auf EUR-ESTR, Cross-Currency-Basis nicht gepreist" · Fairer Basis-Spread −0,1 bp
  Report (o r): "FAIR VALUE (BILATERAL, IFRS 13 LEVEL 2)" · Methodik "… COLLATERAL_CURVE_MISSING …" · "Hinweis: Besicherung in GBP ohne Collateral-Kurve im Marktkontext" · Termsheet trägt dieselbe Zeile
  "fra 1x2 pay 2.1% 10m" → "… EURIBOR-3M" · "fra 12x24 rec 2.4% 10m" → "… EURIBOR-6M" · "cap chf 5y 1% 10m" ✓ · "irs jpy 5y pay 1% 1000m" ✓
  "fxo usdchf call 0.80 1m 6m" → Vorschau ohne Warnung (Level-3-Fallback 8 %)                                             (← R5-2)
Editor: Clearingpflicht-Select "nicht bestimmt (UKWN) | ja – clearingpflichtig (TRUE) | nein (FLSE)" · Felder … UTI · Clearing · Zentral gecleart (Art. 4 EMIR) · Clearingpflicht …
Export-Menü: Blotter CSV | Portfolio JSON | EMIR-Bewertungen (CSV) | Portfolio-Report JSON/Markdown | 7 Vorlagen · EMIR-CSV Zeile: ;IRS-0001;Landesbank A;SRCCSP;…;MTMO;1.000000;FLSE;N;UKWN;
Hilfe (?): "swpt usd" ✓, Vol-Zelle bearbeiten ✓, FX-Fixings ✗ · Palette leer: 61 Kommandos · Kurven-Tabs €STR|EUR 6M|EUR 3M|SOFR|SONIA|SARON|TONA|EUR/USD CSA, "+ FX-Punkte EUR/USD"
page errors: []
```

Probe-Skripte, Ausgaben und Screenshots (`shots-r5/01-caplet-card.png`, `02-market.png`, `03-swaption-editor.png`, `04-ccs-eurgbp.png`, `06-report-eurgbp.png`) im Scratchpad der Review-Session.
