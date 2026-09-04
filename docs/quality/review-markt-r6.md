# Re-Review Runde 6: Marktabdeckung Features & Module (Dimension 1, Gewicht 20 %) – DERIVA 0.2.0

**Reviewer-Rolle:** Senior Product Analyst, Treasury- und Derivateberatungssoftware (LPA Capmatix/Captano, Finbridge, d-fine, Bloomberg SWPM/OVML/VCUB/DLIB/MARS, LSEG Swap Pricer, Murex, FIS Front Arena, Numerix, Quantifi, FINCAD, ORE/QuantLib) · **Stand:** 04.09.2026, Branch `claude/derivatives-trading-platform-1arsyu`, Commit `c031daf` (Core-`dist` frisch gebaut 04:25 UTC) · **Modus:** Review only, keine Quelldatei geändert
**Baseline:** `docs/quality/review-markt-r5.md` (Runde 5, Score 99 / 100) mit den Befunden R5-1…R5-3 und dem Hinweis „Hilfe-Overlay ohne FX-Fixings“
**Geprüft (Laufzeit):** `pnpm -r run test` / `npx vitest run` → **Core 352/352, API 99/99, Web 273/273** (ein Test `App.test.tsx › curves: JPY-TONA …` lief im parallelen Vollauf in den 5-s-Timeout und ist isoliert grün – Last-Flake, kein Defekt); `vite build` erfolgreich; Web-App unter `vite preview --port 4961` mit Playwright/Chromium 1194 durchgeklickt (`e2e-markt-r6.mjs`, `e2e-markt-r6b.mjs`, Anhang C, keine `pageerror`); offizielle E2E-Suite `apps/web/e2e/smoke.mjs` auf Port 4961 → **E2E OK (350 checks)**; API per `buildApp` + `app.inject` (`probe-api-r6.mts`, `probe-api2-r6.mts`, `probe-api3-r6.mts`, Anhang B); Core-Proben gegen `packages/pricing-core/dist` (`probe-core-r6.mjs`, Anhang A). Alle Zahlen unten stammen aus diesen Läufen.
**Roadmap-Regel:** In `02-epics-und-user-stories.md` / README als ⏳ dokumentierte Posten (Bermudan/CMS/Range Accrual, TARF/Participating Forward, Marktdaten-Adapter & Kurven-Governance, OIDC/Rollen/DB, Excel-Add-in, Monte-Carlo-Netting-XVA/FVA, PDF-Template-Service, Inflations-ZC-Swap, PRIIPs Annex-II-MC, SIMM/CRIF, VaR/Attribution, Batch-EoD/Webhooks, Designationsmemo, EMIR Tabelle 3/UPI/XML) werden **nicht** als Lücke gewertet.

---

## 1. Score

### **Marktabdeckung Features & Module: 98 / 100** (rechnerisch 98,1; Runde 1: 60, Runde 2: 86, Runde 3: 97, Runde 4: 98, Runde 5: 99)

**In einem Satz:** Alle drei Runde-5-Befunde sind geschlossen und in Core, API **und** UI reproduziert – Vol-Flächen werden strukturell validiert (`validateVolSurfaces`, `INVALID_VOL_SURFACE` statt `TypeError`, `PUT /api/market` → 400 `VOL_SURFACE_INVALID` bei unverändertem Markt, UI-Snapshot-Import mit deutscher Problemliste), der Beispielmarkt trägt FX-Flächen für alle zehn Paare der fünf Währungen (USDCHF/GBPJPY/CHFJPY/GBPCHF Level 2, Palette warnt für Paare ohne Fläche), die Web-CSV-Vorlage CCS hat die Spalte `collateral` (`none`/`USD` landen als „unbesichert“/„USD-CSA“ im Editor) und die Hilfe nennt die FX-Fixings-Karte. **Die schärfere Prüfung der Integrations- und Eingabepfade findet jedoch sechs neue Restposten, die ein anspruchsvoller Bankkunde bemerkt:** die Schnelleingabe verschluckt unbekannte Tokens stillschweigend (`irs sek …` wird ein EUR-Swap, `… cash`/`mtm`/`barrier 1.05`/`ndf` werden ignoriert, ein zweiter Betrag überschreibt das Nominal), vier der elf Produkttypen (FX-Swap, Basis-Swap, amortisierender Swap, IMM-Swap) haben in UI und API keine CSV-Vorlage, der API-CSV-Import kennt kein `none` für die CSA-Spalte und lässt bei einem schemaseitig ungültigen Datensatz den **ganzen** Upload mit 400 scheitern statt die Zeile abzulehnen, `volType`-Plausibilität und Null-Cubes bleiben ungeprüft, das Index-/Währungsregister ist geschlossen (keine NOK/SEK/PLN-Kurve per Bootstrap, kein Swap in diesen Währungen), und der Beispielmarkt hat keine historischen Fixings, sodass der Demo-Trade `IRS-0001` mit einer ⚠-Warnung startet. Der Score sinkt gegenüber Runde 5 nicht wegen Regressionen, sondern weil die Restlücken jetzt an den Stellen liegen, die Runde 5 als Positivbefund („sieben Vorlagen“) geführt hatte.

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, UX-Reibung −1…−3, kosmetisch −0,2…−1; Roadmap-dokumentiert = 0; keine Doppelzählung mit Quant/UI/Flows/API):

| Bereich | R1 | R2 | R3 | R4 | R5 | R6 | Restlücken (Nummern → Abschnitt 3) |
|---|---:|---:|---:|---:|---:|---:|---|
| A Instrumente & Strukturen | −10 | −3,7 | −0,8 | −0,5 | 0 | 0 | alle acht Trade-Typen inkl. Barrier/Digital/NDF/MtM-CCS/Fest-Fest-CCS/ZC/Lookback bewertet (Anhang A) |
| B Kurven & Marktdaten | −5 | −0,7 | −0,2 | 0 | −0,3 | −0,5 | `volType`-Plausibilität/Null-Cube ohne Warnung (R6-4 −0,2); geschlossenes Index-/Währungsregister – NOK/SEK/PLN/CZK/HUF nicht bootstrapbar, kein Swap darin (R6-5 −0,3) |
| C Modelle | −1 | 0 | 0 | 0 | 0 | 0 | – |
| D Sensitivitäten | −2 | −0,8 | 0 | 0 | 0 | 0 | Vega-Buckets Swaption/Caplet/FX (auch Barrier), Par-Risiko, Theta-Detail |
| E Szenarien / VaR | −1 | −0,5 | 0 | 0 | 0 | 0 | 16 Standard + 6 historische; VaR = Roadmap |
| F XVA | −2,5 | −0,5 | 0 | 0 | 0 | 0 | Netting/CRIF = Roadmap |
| G Hedge Accounting | −4 | −3,0 | 0 | 0 | 0 | 0 | CFH/FVH, IFRS 9/HGB, vier Grundgeschäftsarten, Cost of Hedging |
| H Regulatorik | −4 | −1,5 | 0 | 0 | 0 | 0 | EMIR-Delta jetzt für alle 13 Datensätze befüllt |
| I Dokumente | −2,5 | −1,0 | 0 | 0 | 0 | 0 | Termsheet/KID/Geeignetheit/Confirmation für alle 13 Probe-Trades |
| J Workflow / Beratung | −2,5 | −0,3 | 0 | 0 | 0 | 0 | Freigabe = Roadmap |
| K UI | −0,5 | −1,3 | −0,8 | −1,5 | 0 | −0,5 | Schnelleingabe verschluckt unbekannte Währungen/Modifier stillschweigend, zweiter Betrag überschreibt Nominal, `imm` nicht in der Grammatik (R6-1 −0,5) |
| L Integration | −2,5 | −0,5 | −0,3 | −0,2 | −0,2 | −0,7 | keine CSV-Vorlage für FX-Swap/Basis/Amort/IMM in UI und API (R6-2 −0,4); API-CSV ohne `none` für CSA, Schema-Fehler einer Zeile → 400 für den ganzen Upload (R6-3 −0,3) |
| M Admin | −2,5 | 0 | 0 | 0 | 0 | 0 | Rollen/DB = Roadmap |
| Sonstiges (Beispielmarkt) | – | −0,5 | −0,5 | −0,2 | −0,2 | −0,2 | keine historischen Fixings im Beispielmarkt → Demo-Trade `IRS-0001` mit ⚠ `MISSING_FIXING` (R6-6 −0,2) |
| **Summe** | **−40** | **−14,3** | **−2,6** | **−2,4** | **−0,7** | **−1,9** | → **98,1 ≈ 98 / 100** |

Einordnung (gleiche Skala, v1-Workstation-Scope, Einschätzung): Bloomberg SWPM+OVML+VCUB+MARS ≈ 85 (kein Hedge Accounting, keine deutschen Beratungsdokumente), LPA Capmatix OTC ≈ 75, ORE ≈ 60, Kyriba/Coupa ≈ 55. Die funktionale Abdeckung für Vanilla-Zins/FX in G5 ist vollständig; die Restdifferenz zu 100 liegt in der Eingabe-Robustheit der Palette, in der Datei-Integration (Vorlagen, API-CSV) und in der Erweiterbarkeit auf Nicht-G5-Währungen.

---

## 2. Status der Runde-5-Befunde R5-1…R5-3

Legende: **behoben** = im Code vorhanden **und** per Probe/UI reproduziert · **teilweise** = Kern vorhanden, benannter Rest · **offen** = unverändert.

| # | Befund R5 | Status | Nachweis (Datei / Probe / UI) | Rest |
|---|---|---|---|---|
| **R5-1** | Importierte Vol-Flächen strukturell nicht validiert; defekter Cube vergiftete den Markt und tarnte sich als „Invalid trade“ | **behoben** | `packages/pricing-core/src/market/vol-validation.ts` (246 Zeilen): `swaptionSurfaceProblems`/`capletSurfaceProblems`/`fxSurfaceProblems` (Gitterzeilen = Expiries, Zeilenlänge = Tenors/Strikes, FX-Vektoren = Verfälle, Achsen streng steigend, Vols endlich ≥ 0, `volType`/`shift`, Key ↔ `currency`/`pair`, SABR-Parameter, `rr10`/`bf10` nur gemeinsam), `validateVolSurfaces` in `validateMarket`/`deserializeMarket`, `assertSwaptionSurface`/`assertCapletSurface`/`assertFxSurface` als Gitter-Guards mit `WeakSet`-Cache; `apps/api/src/lib/vol-surfaces.ts` + `routes/market.ts:331–337` (Prüfung **vor** jeder Änderung), `routes/snapshot.ts`, Hedge-`designationSnapshot`; `apps/web/src/lib/snapshot-import.ts` (deutsche Texte). Core: `validateVolSurfaces` 1×1-USD-Cube → `["swaptionVols.USD.atm has 1 rows, expected 11 (one per expiry)","…atm[0] has 1 entries, expected 9 (one per tenor)"]`, FX `atm.length 1` → „expected 8“, Caplet 1×1 → zwei Meldungen, `validateMarket` meldet dieselben Pfade, `priceTrade` auf dem defekten Markt → **`INVALID_VOL_SURFACE`** „Swaption vol surface USD-SWAPTION-NORMAL is malformed …“ (kein `TypeError`), `deserializeMarket` → `INVALID_VOL_SURFACE`, unsortierte Expiries und negative ATM-FX-Vols werden benannt. API: `PUT /api/market` 1×1-Cube → **400 `VOL_SURFACE_INVALID`** mit `details.problems[]`, Snapshot-ID unverändert, USD-Swaption danach 200 (PV 148.506); FX- und Caplet-Fehlfläche → 400; `PUT /api/market/snapshot` → 400 „Vol surface(s) of the snapshot structurally invalid (2 problem(s))“; Key/`currency`-Mismatch → 400. UI: Snapshot-Import mit 1×1-Cube → Toast „Import fehlgeschlagen: Vol-Fläche strukturell ungültig – Swaption-Cube USD, atm: 1 Zeilen, erwartet 11 (eine je Verfall); … atm[0]: 1 Einträge, erwartet 9 (einer je Tenor)“, Markt bleibt (Anhang C) | Plausibilität fehlt: `volType: "Lognormal"` mit Normal-Zahlen (0,0097) → Core PV 1, API PV 2, UI-Import ohne Hinweis; Cube mit lauter Nullen → PV 0 ohne Warnung → **R6-4** |
| **R5-2** | USDCHF/GBPJPY/CHFJPY ohne FX-Vol-Fläche (Fallback 8 %, Level 3), Palette ohne Hinweis | **behoben** | `sample-market.ts:538–580` `SAMPLE_USDCHF_VOLS`/`SAMPLE_GBPJPY_VOLS`/`SAMPLE_CHFJPY_VOLS`/`SAMPLE_GBPCHF_VOLS` (indikativ), Registrierung `:654–665` (zehn Paare); `quick-parser.ts:221–235` `fxVolPairs`/`hasFxVolSurface`/`fxVolWarning`, `CommandPalette.tsx:85`. Core: ATM-Calls 6M auf USDCHF 7,54 %, GBPJPY 10,77 %, CHFJPY 9,50 %, GBPCHF 7,15 % – **alle `warnings []`**, inverse Notierungen (USDGBP, CHFEUR, JPYUSD, USDEUR) finden die Fläche über `fxSurfaceKeysFor`. API: `/api/price` USDCHF/GBPJPY/CHFJPY/GBPCHF → Vol 7,56/10,72/9,21/7,19 %, `/api/report` **Level 2**. UI: `fxo usdchf call 0.80 1m 6m` → Vorschau **ohne** Warnung, angelegt `FXO-0003` PV 13.464, Vega-Karte „Vega FX USDCHF 2.351“, Report „FAIR VALUE (BILATERAL, IFRS 13 LEVEL 2)“, „Stufe 2 der Bewertungshierarchie (beobachtbare Kurven, Volatilitäten, FX-Spots)“; `fxo eurnok call 11.5 1m 6m` → „⚠ keine FX-Vol-Fläche für EUR/NOK (Fallback 8 %, Level 3)“; Marktansicht: **10 Paar-Tabs** EUR/USD … GBP/CHF | – |
| **R5-3** | Web-CSV-Vorlage CCS ohne CSA-Spalte | **behoben** | `portfolio-io.ts:244–259` Spalte `collateral` (Aliase `csa`, `collateralCurrency`, `collateral-währung`, `besicherung`, `:372–376`), `collateralOf(raw, pair)` `:463–469` (leer = Default, `none` = `null`, sonst Währung, Fehlertext bei Unlesbarem), `:667` im Builder-Aufruf; Beispielzeile mit `USD`. UI: Vorlagen-Menü „⤓ Vorlage Cross-Currency-Swap“; CSV-Import zweier EURGBP-Zeilen mit `none`/`USD` → „2 Trades aus CSV importiert“, Editor `CCS-R6A` Select Collateral = **„unbesichert“**, `CCS-R6B` = **„USD-CSA“** mit Hint „Keine GBP-Diskontkurve für Besicherung in USD (Collateral-Kurve „GBP\|USD“ fehlt) – Diskontierung auf der eigenen OIS-Kurve, Cross-Currency-Basis nicht gepreist“ (korrekt: nur `EUR\|USD` liegt im Markt) | API-Vorlage kennt kein `none` → **R6-3** |
| Hinweis R5 | Hilfe-Overlay ohne FX-Fixings-Karte | **behoben** | `HotkeyOverlay.tsx:44–45` Zeilen „FX-Fixings (MtM-Reset) – Karte „FX-Fixings““ und „Snapshot exportieren / importieren (ersetzt Markt und Bewertungstag)“; UI `?` → enthält „FX-Fixings“ und „Snapshot“ | – |

**Weitere Runde-5-Maßnahmen aus dem Programm (geprüft, ohne eigene Befundnummer):** Snapshot-Import ersetzt Markt und Bewertungstag, Chip „importiert“, „Zum Sample-Markt“ baut den Sample-Markt neu auf (Toast „Sample-Markt aus den Quotes zum 03.09.2026 aufgebaut“); EMIR-Delta ist jetzt für **alle** Datensätze aus dem Pricing befüllt (`GET /api/emir/valuations`: 13/13 mit `delta`; Core `emirValuationRecord` Cap 0,29, Swaption 0,39, FX-Put −0,36, Barrier −0,10, Digital −0,16, lineare Produkte 1) – US-6.5 nennt das noch als „offen“ (Doku-Dimension); Lebenszyklus-Analytics `lifecycle`/`greeksMethod` (Vanilla „analytic“, Barrier „finite-difference“) erscheinen im Inspector als „Lebenszyklus laufend“/„Greeks analytisch“; `POST /api/report/portfolio` mit `{}` liefert Markdown-Report des Stores (`useStore` wird als zusätzliches Feld mit 400 abgewiesen – Vertrag ist strikt, kein Mangel).

**Runde-1…4-Posten:** unverändert geschlossen; G14/G24/G26 bleiben dokumentierte Roadmap (kein Abzug).

---

## 3. Neue Befunde (Runde 6)

Severity: **Niedrig** = Lücke zweiter Ordnung für eine v1-Persona · **Kosmetisch** = Voreinstellung/Konsistenz/Beispieldaten.

| # | Sev. (Abzug) | Ort | Befund (reproduziert) | Fix |
|---|---|---|---|---|
| **R6-1** | Niedrig (−0,5) | `apps/web/src/lib/quick-parser.ts` – Token-Schleifen der Zweige `irs/ois` (`:335–346`), `cap/floor/collar`, `ccs`, `fxf`, `fxo`, `fra` (`:390–403`): jedes nicht erkannte Token fällt in den `else`-Zweig `parseAmount(t)` und wird sonst **ohne Fehler verworfen**; nur `swpt` (`:527–533`) meldet „Unbekannte Währung“; `COMMANDS` (`:134–159`) ohne `imm` | **Die Schnelleingabe verschluckt unbekannte Tokens stillschweigend und legt dabei falsche Trades an.** UI (Palette): `irs sek 5y pay 3% 10m` → „Payer-Swap **EUR** 5Y“, `cap nok 5y 3% 10m` → „Cap **EUR** 5Y“ (Währung unbemerkt ersetzt), `swpt usd 1y5y payer 3.5% 10m cash` → physisch (Modifier ignoriert), `irs 10y pay 3.1% 10m mtm`, `fxo eurusd put 1.15 3m 9m barrier 1.05` (Vanilla statt Barrier), `fxf eurusd 2m 1.1725 6m ndf`, `ccs eurusd 5y -20bp 10m foo` → alle ohne Hinweis angelegt; `irs 10y pay 3.1% 10m 6m` → **Nominal 6.000.000** (zweiter Betrag überschreibt den ersten); `imm 2y pay 3% 10m` → „Keine Treffer“ obwohl `n i`/Editor IMM-Swaps kennen. Für eine Bloomberg-artige Kommandozeile ist das die gefährlichste Fehlerklasse: der Berater tippt SEK, bekommt eine EUR-Indikation mit plausiblem PV und merkt es erst im Termsheet. R4-2 hatte genau diesen Pfad für `swpt` geschlossen; die übrigen Zweige blieben unverändert. | Gemeinsame Token-Prüfung am Ende jedes Zweigs: jedes Token, das weder Grammatik-Token (`isGrammarToken`) noch verbrauchtes Argument ist, → `{ ok:false, error: "Unbekanntes Token „sek“ – Währungen: EUR, USD, GBP, CHF, JPY; Modifier: mtm, step, fixed, cash, @Kontrahent" }`; zweiter Betrag/zweite Rate → „Betrag doppelt angegeben“; `cash`/`physical` als Swaption-Modifier, `imm` als Kommando (`imm [ccy] <tenor> pay|rec <rate%> [notional]`), optional `ndf` und `barrier <typ> <level>` als dokumentierte Erweiterungen; Grammatik in `03-ui-konzept-und-hotkeys.md` und Hilfe nachziehen; Unit-Tests je Zweig für ein unbekanntes Token. |
| **R6-2** | Niedrig (−0,4) | `apps/web/src/lib/portfolio-io.ts:152–153` `CSV_TRADE_TYPES = ["IRS","FXF","CAP","SWPT","FXO","CCS","FRA"]`, Vorlagen `:165–290` (IRS-Vorlage ohne Amortisations-/Staffel-Spalten), Fehlertext `:699`; `apps/api/src/lib/csv-import.ts:30` `CSV_TRADE_TYPES` (dieselben sieben), OpenAPI `?type`-Enum | **Vier der elf Produkttypen haben weder in der Workstation noch in der API eine CSV-Vorlage: FX-Swap, Tenor-Basis-Swap, amortisierender Swap, IMM-Swap; auch Zinsstaffeln (`step`) und OIS-Compounding-Parameter sind per CSV nicht abbildbar.** UI: Export-Menü „CSV-Vorlagen“ listet 7 Einträge; Import einer Datei mit `FXS`/`BASIS`-Zeilen → Dialog „Unbekannter Typ „FXS“ (erlaubt: IRS, FXF, CAP, SWPT, FXO, CCS, FRA)“ (Screenshot `03-csv-import.png`). API: `?type=FxSwap`/`BasisSwap` nicht im Enum; OpenAPI-Beschreibung nennt weder FxSwap noch Basis noch Amortisation. Nur JSON funktioniert (`POST /api/trades/import` mit FX-Swap-Objekt → `imported 1`). FX-Swaps sind für Sparkassen-Firmenkunden (Liquiditätssteuerung, Prolongation von Termingeschäften) das häufigste FX-Produkt nach dem Forward; ein Bestandsimport aus dem Kernbank-/TMS-Export läuft über CSV, nicht über das DERIVA-JSON-Schema. R3-N16 hatte „Basis“ ausdrücklich in der Vorlagenlücke genannt; R4 schloss sieben Vorlagen ohne Basis. | Vorlagen `FXS` (`pair, baseAmount, nearRate, farRate, nearDate, farDate`), `BASIS` (`currency, notional, receiveIndex, payIndex, spread, start, maturity`), `AMORT` (IRS-Spalten + `finalNotional` oder `amortisation` Linear/Annuität) und `IMM` (`from, tenor`) in `portfolio-io.ts` und `csv-import.ts` (gleiche Spaltennamen, deutsche Aliase), Export-Menü und OpenAPI-Enum/-Beschreibung; IRS-Vorlage um `stepUp` („2027-09-07:3,0 %\|2028-09-07:3,5 %“) ergänzen; Unit-Tests mit Beispielzeile je Typ; `Unbekannter Typ`-Text listet die neuen Typen. |
| **R6-3** | Niedrig (−0,3) | `apps/api/src/lib/csv-import.ts:353, 414, 431` (`collateralCurrency: row.opt(…)?.toUpperCase()` – kein `none`), `apps/api/src/routes/trades.ts:332–347` (`preValidation` baut Trades, danach greift das JSON-Schema auf `body.trades[]`), `schemas.ts:110/989` (`collateralCurrency` Pattern `^[A-Z]{3}$`) | **Der API-CSV-Import kann keinen unbesicherten CCS ausdrücken und lässt bei einem schemaseitig ungültigen Datensatz den ganzen Upload scheitern.** Probe (`?type=CrossCurrencySwap&dryRun=1`): `collateralCurrency=USD` → 200 `imported 1`; leer → 200 (Default Quote-Währung); `none` → **400 `VALIDATION_ERROR` „body/trades/0/collateralCurrency must match pattern“**; zwei Zeilen `USD` + `none` → **400 für beide** (statt `imported 1, rejected 1`); IRS-Datei mit gültiger Zeile, Zeile mit `2026-13-08` und Zeile mit `id "IRS CSV SPACE"` → **400** wegen der ID (die Datumszeile allein würde korrekt als `rejected` gemeldet). Der Vertrag (`trades.ts:294` „a row that cannot be mapped is reported as rejected with its row number“) gilt damit nur für Builder-Fehler, nicht für Schema-Verstöße des gebauten Trades; R5-3 ist nur webseitig geschlossen. | In `csv-import.ts` `collateralCurrency`: `none`/`unbesichert`/`ohne` → `null` (Builder liefert dann Trade ohne `collateralCurrency`), leer = Default; in der `preValidation` jeden gebauten Trade gegen das Trade-Schema (Ajv-Compile von `tradeSchema`) prüfen und Verstöße als `rejected` mit `code: "CSV_ROW_INVALID"` und `describeRowError` melden, bevor die Route validiert; Vertragstest „valid + schema-invalid row → 200 mit `rejected: 1`“; OpenAPI-Beschreibung der CCS-Vorlage um `none` ergänzen. |
| **R6-4** | Kosmetisch (−0,2) | `vol-validation.ts:83–87` (`checkVolType` prüft nur Enum/`shift`), `:64–81` (Vols ≥ 0 erlaubt Null-Gitter) | **Vol-Flächen werden strukturell, nicht plausibel geprüft** (Rest von R5-1, dort als Fix-Bestandteil genannt). Core: USD-Cube mit `volType: "Lognormal"` und Normal-Zahlen (0,0097) → `validateVolSurfaces []`, USD-Swaption PV **1** statt 148.506, `warnings []`; EUR-Cube mit lauter Nullen → `[]`, Swaption PV **0** ohne Warnung. API: `PUT /api/market` mit dem Lognormal-Cube → 200, `/api/price` → 200 PV 2, `warnings []`. UI: Snapshot-Import mit demselben Cube → „Snapshot „Sample EoD“ importiert“, Chip „importiert“, kein Hinweis. Ein IPV-Prozess, der Broker-Flächen mit falscher Quotierungsart einspielt, bekommt Fair Values nahe null ohne Signal. | `VOL_TYPE_SUSPICIOUS:`-Warnung (Normal-Vols mit Median > 5 % oder Lognormal-Vols mit Median < 1 %) und `VOL_SURFACE_DEGENERATE:` (alle Vols 0 oder identisch) aus `validateVolSurfaces` als `warnings` (nicht `problems`) → `PUT /api/market` 200 mit `warnings[]`, UI-Toast „Snapshot importiert – Hinweis: …“, Pricing-Warnung auf dem Trade; Test. |
| **R6-5** | Niedrig (−0,3) | `packages/pricing-core/src/curves/index-definitions.ts:24–72, 134–136, 157–226` (`RATE_INDICES` und `SWAP_CONVENTIONS` als geschlossene Konstanten, `getIndex`/`getSwapConventions` werfen `UNKNOWN_INDEX`/`INVALID_TRADE`), `apps/api/src/schemas.ts:191, 255, 290, 794` (`index: rateIndex`), Kurven-Tabs `CurvesView.tsx` fest | **Kein Weg, eine weitere Währung oder einen weiteren Index ohne Codeänderung anzulegen.** API: `POST /api/market/bootstrap` NOK-OIS mit `index: "NOWA"` → **422 `UNKNOWN_INDEX`**, mit `index: "ESTR"` → 422 „No swap conventions for currency NOK“, PLN-Swaps `WIBOR-6M` → 422; ein per Hand serialisierter NOK-Knotenvektor lässt sich per `PUT /api/market/snapshot` (mit `discountCurveId.NOK`) einspielen – danach bewertet ein EURNOK-Forward (PV 28.304), ein NOK-Swap scheitert weiter (`UNKNOWN_INDEX: NOWA`), eine EURNOK-Option fällt auf 8 % / Level 3. UI: keine „Kurve hinzufügen“-Funktion, Währungs-Selects EUR/USD/GBP/CHF/JPY. Für DACH-Firmenkundenberater sind PLN/CZK/HUF/SEK/NOK/DKK-Termingeschäfte Alltagsgeschäft (Exporteure); US-2.9 definiert den Beispielmarkt als G5, aber die **Erweiterbarkeit** ist keine Roadmap-Position und wird von Bloomberg/LSEG/ORE selbstverständlich geboten (Index-Definition per Konfiguration). | `registerRateIndex(def)`/`registerSwapConventions(ccy, conv)` im Core (analog `registerCalendar`), Snapshot-Schema-Block `indices[]`/`conventions{}` (serialisiert, in der Snapshot-ID), `PUT /api/market` Feld `indices`, Bootstrap ohne `index`-Enum (Pattern + Existenzprüfung im Handler), UI: Kurven-Ansicht „+ Kurve“ (Währung, Index, Tageszählung, Kalender, Quotes) mit Persistenz; Beispielmarkt optional um EURPLN/EURSEK/EURNOK-Spots und -Flächen ergänzen. |
| **R6-6** | Kosmetisch (−0,2) | `sample-market.ts:635` (`fixings: []`), Beispielbuch `apps/api/src/lib/store.ts:231` / `apps/web/src/state/sample-portfolio.ts` (`IRS-0001` mit `effectiveDate 2024-06-17`, EURIBOR-6M) | **Der Beispielmarkt trägt keine historischen Fixings, obwohl das Beispielbuch laufende Perioden enthält.** API `GET /api/trades?price=1`: `IRS-0001` → `["MISSING_FIXING: Missing fixing for EURIBOR-6M on 2026-06-15; used 6M forward from 2026-09-03 …"]`. UI-Blotter: Zeile `IRS-0001` mit Badge **„⚠ 1“**, Hint „Fixing EURIBOR-6M vom 15.06.2026 fehlt – 6M-Forward ab 03.09.2026 verwendet“. Der Demo-Flaggschiff-Trade startet mit einer Datenwarnung – in einer Kundenpräsentation die erste Frage. Die Fixings-Karte der Marktansicht ist vorhanden, aber leer. | `SAMPLE_FIXINGS` (EURIBOR-6M 15.06.2026, €STR-Historie ab Start der OIS-Periode, SOFR für `IRS-USD-01`) im `buildSampleMarket` (in Snapshot-ID und Reset enthalten), Beispielbuch ohne Warnung; Unit-Test „Beispielbuch bewertet ohne `MISSING_FIXING`“. |

**Ohne Abzug, aber dokumentierenswert:**
- `US-6.5` beschreibt das EMIR-Delta als „nur durchgereicht“; tatsächlich ist es aus dem Pricing befüllt (Dimension 6 / Doku-Stand).
- `missingFixingPolicy` (`curve`/`throw`) und `fxSpotDates` sind nur per API setzbar, nicht in der Marktansicht (Fachanwender-Option; Default `curve` ist sinnvoll).
- `POST /api/trades/from-template` kennt nur `CrossCurrencySwap` und `FRA` (Zweck: Builder-Konventionen serverseitig); alle anderen Typen laufen über vollständige Trade-Objekte oder CSV – konsistent zu R3/R4, kein Mangel.
- Der `useStore`-Parameter von `POST /api/price/portfolio` gilt nicht für `POST /api/report/portfolio` (dort `{}` = Store) – Vertrag dokumentiert, nur Hinweis für Klienten.
- Ein API-Cube unter fremdem Key (`swaptionVols.NOK` mit `currency: "NOK"`) wird angenommen (strukturell konsistent), ist aber ohne NOK-Diskontkurve unbenutzbar – harmlos, hängt mit R6-5 zusammen.

---

## 4. Feature-Matrix – Statusänderungen gegenüber Runde 5 (nur DERIVA-Spalte)

| Feature | R5 | R6 | Beleg |
|---|---|---|---|
| Strukturvalidierung importierter Vol-Flächen (Core `validateVolSurfaces`, API 400 `VOL_SURFACE_INVALID`, UI deutsche Problemliste, Gitter-Guards) | ❌ | ✅ | R5-1 |
| Plausibilitätsprüfung `volType`/degenerierte Flächen | – | ❌ | R6-4 |
| FX-Vol-Flächen für alle zehn G5-Paare, Palette-Warnung für Paare ohne Fläche | ❌ (3 Paare Fallback) | ✅ | R5-2 |
| Web-CSV-Vorlage CCS mit CSA-Spalte (`none`/Währung) | ❌ | ✅ | R5-3 |
| API-CSV: unbesicherter CCS, Schema-Fehler je Zeile statt 400 gesamt | – | ❌ | R6-3 |
| CSV-Vorlagen FX-Swap / Basis / Amort / IMM (UI + API) | ❌ (unbewertet) | ❌ | R6-2 |
| Schnelleingabe: Fehler bei unbekannten Tokens in allen Zweigen, `imm`-Kommando | 🔶 (nur `swpt`) | 🔶 | R6-1 |
| EMIR-Delta aus dem Pricing für alle Produkttypen | 🔶 | ✅ | Abschnitt 2 |
| Lebenszyklus verfallener/gelieferter FX-Optionen (`EXPIRED:`, `lifecycle`, `greeksMethod`) | – | ✅ | Inspector „Lebenszyklus laufend“, „Greeks analytisch“ |
| Registrierung weiterer Währungen/Indizes (NOK/SEK/PLN …) per API/UI | – | ❌ | R6-5 |
| Historische Fixings im Beispielmarkt | – | ❌ | R6-6 |
| Hilfe-Overlay nennt FX-Fixings und Snapshot-Semantik | ❌ | ✅ | Abschnitt 2 |
| Excel / Live-Marktdaten / Rollen / Netting-CVA / VaR / CRIF / Bermudan / TARF / PDF / Inflation | ⏳ | ⏳ Roadmap | kein Abzug |

---

## 5. Verifizierte Positivbefunde (Auszug, alle reproduziert)

- **Instrumente vollständig für den v1-Scope (Anhang A):** 33 Probe-Trades in fünf Währungen – Vanilla-/Forward-Start-/Step-up-/ZC-/amortisierende/IMM-Swaps, OIS mit Lookback + Observation Shift, Float-Leg mit Cap/Floor, Tenor-Basis, FRA, Cap/Floor/Collar (auch JPY, amortisierend), Swaptions physisch/cash in EUR/GBP/CHF, FX-Forward (auch Kreuz USDCHF), NDF, FX-Swap, FX-Vanilla/Barrier (Reiner-Rubinstein, FD-Greeks)/Digital, CCS mit USD-CSA (Xccy-Basis), MtM-Reset, Fest-gegen-Variabel und Fest-gegen-Fest – alle `validateTrade []`, alle bewertet, `COLLATERAL_CURVE_MISSING` nur wo fachlich richtig (EURGBP).
- **Risiko:** DV01 gesamt/je Kurve, Key-Rate-Buckets je Kurve (19/18/13/13/6 Pillars), FX-Delta, Vega je Fläche, Theta mit `thetaDetail`, Gamma; Vega-Buckets Swaption Expiry × Tenor (99), Caplet je Verfall (9), FX je Verfall mit Smile-Komponenten (24) – auch für Barrier; Par-Risiko mit Re-Bootstrapping (EUR-ESTR 18, EURIBOR-6M 17 Quotes, Σ 8.803 ≈ DV01 8.977).
- **Szenarien/XVA/Hedge:** 16 Standard- (BaFin ±100/200, EBA-IRRBB 6, Steepener/Flattener, FX ±10 %, IR-Vol +20 bp, FX-Vol +5, Roll 1M) + 6 historische Episoden, eigene Szenarien (Tenor-Vektor, FX, Vols, Zeit), Grid Zinsen × FX; CVA/DVA mit Sorensen-Bollier (IRS), GK-Forward (FXF), Basis-Swaption (Basis-Swap), Delta-Normal mit Kennzeichnung (Optionen, CCS, FX-Swap); CDS-Bootstrap ACT/360 (λ 1,35 % … 3,94 %); Hedge: CFH/FVH, IFRS 9/HGB (Einfrierung/Durchbuchung, Drohverlustrückstellung), vier Grundgeschäftsarten, intrinsische Designation mit Cost of Hedging, Regression n = 18, Slope 1,011, R² 1,000.
- **Dokumente/Regulatorik:** Termsheet (5 Abschnitte), KID (9), Geeignetheitserklärung (7), Confirmation (5) für alle 13 Probe-Trades inkl. NDF/Digital/Barrier/FX-Swap („Bestätigung (Confirmation) – Devisenswap“); EMIR-Datensätze mit CFI-Klassifikation (SRCCSP, HRWAVP, HRSAVP, JFTXFP, SFCXXP, HFRAVP, SRDCSP, JRTXFP) und Delta; Portfolio-Report (Kontrahent/Buch/Typ, Audit-Hashes); Audit-Kette `chainValid true`.
- **UI-Erreichbarkeit:** 8 Views, 11 Neuanlage-Chords, Dokumente `o r/t/g/k/c/p`, Export `x b/x c`, `y i`; Palette 48 sichtbare Tastenkürzel + Trades; Editor-Felder FX-Option (Auszahlung Vanilla/Digital Cash/Digital Asset, Barriere Up/Down-In/Out, Vol-Override, Smile RR/BF), FX-Forward (NDF), FX-Swap (zwei Legs), IRS (Amortisierend, Kuponverlauf, Index EURIBOR-3M/6M/€STR/SOFR/SONIA/SARON/TONA, Währung EUR/USD/GBP/CHF/JPY); Marktansicht mit 10 FX-Paar-Tabs, FX-Fixings-Editor, CDS-Termstruktur je Kontrahent; Reporting-Währung EUR→USD→GBP→CHF→JPY.
- **API-Vertrag:** OpenAPI 3.1.0, **41 Operationen**, 44 dokumentierte Fehlercodes, `PUT /api/market` mit neun Body-Feldern; Tests Core 352 / API 99 / Web 273 grün, E2E 350 Checks.

---

## 6. Was für 100 noch fehlt

1. **R6-1 Grammatik-Härtung der Schnelleingabe** (Fehler bei unbekanntem Token in allen Zweigen, kein stilles Überschreiben von Nominal/Rate, `imm`-Kommando, Modifier `cash`) – größter Einzelposten, geschätzt zwei Stunden inkl. Tests.
2. **R6-2 CSV-Vorlagen FX-Swap/Basis/Amort/IMM** in `portfolio-io.ts` und `csv-import.ts` (+ OpenAPI-Enum) und **R6-3** `none` für CSA plus Schema-Prüfung je Zeile im API-Import.
3. **R6-5 Index-/Währungsregistrierung** (Core `registerRateIndex`, Snapshot-Block, Bootstrap ohne Enum, UI „+ Kurve“).
4. **R6-4 Vol-Plausibilität** als Warnung und **R6-6 Beispiel-Fixings** – je eine halbe Stunde.

Mit 1–2 läge die Dimension bei ≈ 99,3; 3–4 schließen die Lücke zu 100 für den v1-Scope.

---

## Anhang A – Core-Probe (`node probe-core-r6.mjs` gegen `dist`, Auszug)

```
Engine @deriva/pricing-core/0.2.0 valDate 2026-09-04
curves: EUR-ESTR,EUR-EURIBOR-6M,EUR-EURIBOR-3M,USD-SOFR,GBP-SONIA,CHF-SARON,JPY-TONA,EUR-ESTR-USDCSA
fxSpots: EURUSD 1.1625, EURGBP 0.8615, EURCHF 0.9345, EURJPY 171.4, USDJPY 147.45
swaptionVols: EUR,USD,GBP,CHF,JPY · capletVols: 5 · fxVols: EURUSD,EURGBP,EURCHF,GBPUSD,USDJPY,EURJPY,USDCHF,GBPJPY,CHFJPY,GBPCHF
RATE_INDICES: EURIBOR-1M,-3M,-6M,-12M,ESTR,SOFR,SONIA,SARON,TONA · SWAP_CONVENTIONS: EUR,USD,GBP,CHF,JPY · fixings: 0 fxFixings: 0      (← R6-5, R6-6)
STANDARD_SCENARIOS 16 · HISTORICAL_SCENARIOS 6 · calendars TARGET US UK CH JP DE TARGET+US ✓ · validateMarket(sample) []
== R5-1 ==
validateVolSurfaces malformed USD cube: ["swaptionVols.USD.atm has 1 rows, expected 11 (one per expiry)","swaptionVols.USD.atm[0] has 1 entries, expected 9 (one per tenor)"]
validateVolSurfaces malformed FX: ["fxVols.EURUSD.atm has 1 entries, expected 8 (one per expiry)"] · malformed caplet: 2 Meldungen · validateMarket(malformed): dieselben Pfade
priceTrade USD swaption on malformed cube → THROW INVALID_VOL_SURFACE "Swaption vol surface USD-SWAPTION-NORMAL is malformed: …"
deserializeMarket(malformed) → THROW INVALID_VOL_SURFACE "Market snapshot: malformed vol surface USD: …"
validateVolSurfaces Lognormal-with-normal-numbers: []  → price USD swaption PV 1 warnings []                       (← R6-4)
validateVolSurfaces zero vols: []  → price EUR swaption on all-zero cube PV 0 warnings []                            (← R6-4)
negative atm FX → ["fxVols.EURUSD.atm[0] must be non-negative (got -0.01)"] · unsorted expiries → "axis strictly increasing, no duplicates"
== R5-2 ==
EURUSD 7.56 % · EURGBP 5.93 % · EURCHF 5.38 % · GBPUSD 8.00 % · USDJPY 9.79 % · EURJPY 9.16 % · USDCHF 7.54 % · GBPJPY 10.77 % · CHFJPY 9.50 % · GBPCHF 7.15 %
USDGBP/CHFEUR/JPYUSD/USDEUR (invers) → Fläche GBPUSD/EURCHF/USDJPY/EURUSD – alle warnings []
== Instruments (33) ==
irsEur PV -191.453 · irsUsd -67.180 · irsGbp -203.974 · irsChf -257.418 · irsJpy 50.914 · irsFwdStart -13.545 · irsStep -150.198 · ois 5.894 · basis -13.420 · amort -191.265 · imm -119.431
fra -1.113 · cap 96.010 · floorUsd 112.544 · collar 65.291 · capJpy 104.610 · capAmort 52.044 · swptEur 100.332 · swptCash 319.449 · swptGbp 112.867 · swptChf 77.661
fxf 3.572 · fxfCross(USDCHF) -9.921 · fxs 3.664 · fxo 51.033 · barrier(DownOut) 25.482 · digital 32.794 · ndf -2.905
ccsUsd 9.588 (fairSpread, USD-CSA) · ccsMtm 9.567 · ccsFixed 342.535 · ccsGbp -47.387 + COLLATERAL_CURVE_MISSING · fixedFixedCcs -221.152 · oisLookback 5.235 · floatCapped -369.203 · zc 151.572
== Risk ==
irsEur dv01 8.977 buckets EUR-ESTR:19|EURIBOR-6M:18|EURIBOR-3M:13|USDCSA:6 theta -318 gamma -9 · swptEur vega swaption:EUR 1.758 · cap vega caplet:EUR-EURIBOR-6M 1.820
fxo fxDelta USDEUR 11.219 vega fx:EURUSD 9.637 · barrier vega -2.385 (finite-difference) · vegaBuckets swpt 99 (expiry-tenor) · cap 9 · fxo 24 (smile) · barrier 24
parRisk irsEur: EUR-ESTR 18 Σ101 | EURIBOR-6M 17 Σ8.702 | total 8.803
== Scenarios/XVA/Hedge ==
runScenarios 22 Szenarien · scenarioGrid 3×3 · applyScenario custom ✓
xva irsEur cva 22.535 dva 12.419 (Sorensen–Bollier) · fxf 172/76 (GK) · basis 812/662 (Basis-Swaption) · swpt/ccs/fxs/cap/fxo Delta-Normal mit Warnung
bootstrapHazardCurve ACT/360: hazards 1.35 % / 2.12 % / 3.22 % / 3.94 %
hedge IRS CFH: effective, slope 1.011 R² 1.000 n 18 DO 1.012 · FXF CFH HGB ✓ · Cap intrinsic costOfHedging timeValue 96.010 · FVH ✓
== Documents (13 Trades) ==
alle: Level 2 · Termsheet 5 · KID 9 · Geeignetheit 7 · Confirmation 5 Abschnitte · EMIR-CFI + Delta (Cap 0,29, Swpt 0,39, FX-Put −0,36, Barrier −0,10, Digital −0,16)
portfolioReport: lines 36, byCounterparty/byBook/byType, audit · snapshot roundtrip id equal true
```

## Anhang B – API-Probe (`npx tsx probe-api*-r6.mts`, `app.inject`, Auszug)

```
openapi 3.1.0 ops: 41 · error codes 44 · PUT /api/market props: valuationDate,fxSpots,fxFixings,swaptionVols,capletVols,fxVols,fixings,fxSpotDates,missingFixingPolicy
from-template branches: CrossCurrencySwap, Fra · import ?type enum: InterestRateSwap,FxForward,CapFloor,Swaption,FxOption,CrossCurrencySwap,FRA      (← R6-2)
== R5-1 ==
PUT malformed cube: 400 VOL_SURFACE_INVALID [2 problems] | snapshot unchanged: true · price USD swaption danach: 200 PV 148.506
PUT malformed FX: 400 · PUT malformed caplet: 400 · PUT /api/market/snapshot malformed: 400 VOL_SURFACE_INVALID · key/currency mismatch: 400
PUT volType Lognormal w/ normal numbers: 200 → price 200 PV 2 warnings []                                                      (← R6-4)
PUT NOK cube (kein NOK-Markt): 200 · price NOK IRS: 422 NO_DISCOUNT_CURVE
== R5-2 ==
USDCHF vol 7.56 % · GBPJPY 10.72 % · CHFJPY 9.21 % · GBPCHF 7.19 % – warnings [] · /api/report Level 2
== CSV ==
CCS collateral=USD: 200 imported 1 · empty: 200 imported 1 · none: 400 VALIDATION_ERROR "collateralCurrency must match pattern ^[A-Z]{3}$"   (← R6-3)
CCS valid+none: 400 (beide Zeilen) · valid+baddate: 200 imported 1 rejected 1 · IRS ok+baddate+id-mit-Leerzeichen: 400 (ganzer Upload)     (← R6-3)
JSON import FxSwap: 200 imported 1 · OpenAPI-Import-Beschreibung nennt FxSwap/Basis/Amortisation: nein                                 (← R6-2)
== Beispielbuch ==
GET /api/trades?price=1: IRS-0001 warnings ["MISSING_FIXING: Missing fixing for EURIBOR-6M on 2026-06-15; used 6M forward …"] – übrige 9 Trades []   (← R6-6)
== Erweiterbarkeit ==
bootstrap NOK/NOWA OIS: 422 UNKNOWN_INDEX · NOK mit index ESTR: 422 "No swap conventions for currency NOK" · PLN/WIBOR-6M: 422 UNKNOWN_INDEX · EUR/EURIBOR-12M: 200   (← R6-5)
snapshot import mit handserialisierter NOK-Kurve + discountCurveId.NOK: 200 → EURNOK-Forward PV 28.304 · NOK-IRS 422 UNKNOWN_INDEX · EURNOK-Option "No FX vol surface – using 8% vol"
== Coverage ==
scenarios standard 16 · historical 6 · vega cap 200 (9 Buckets) · vega fxo smile 200 (atm/rr/bf) · barrier 200 PV 29.050 · digital 200 · NDF 200 · FxSwap 200 · xva FxSwap 200
kid FxSwap 200 "# Basisinformationsblatt" · confirmation FxSwap 200 "Bestätigung (Confirmation) – Devisenswap" · emir 13 Datensätze, delta 13/13 · par risk cap 200 · hedge FX CFH 200 effective
portfolio report {} 200 Markdown · audit chainValid true
```

## Anhang C – UI-Probe (Playwright/Chromium gegen `vite preview :4961`, Auszug)

```
Blotter: 14 Trades · Palette leer: 58 Treffer · 48 Tastenkürzel · Gruppen NAVIGATION, AKTIONEN, DOKUMENTE & EXPORT, BLOTTER, BEWERTUNG, ANSICHT, TRADES
"fxo usdchf call 0.80 1m 6m" → "FX-Option USDCHF Call @ 0,8000 · 1m · Verfall 6M" (ohne Warnung) → FXO-0003 PV 13.464 · Vega FX USDCHF 2.351 · Volatilität 7,56 %
  Report: "FAIR VALUE (BILATERAL, IFRS 13 LEVEL 2)" · "Stufe 2 der Bewertungshierarchie (beobachtbare Kurven, Volatilitäten, FX-Spots)"          (R5-2 ✓)
"fxo eurnok call 11.5 1m 6m" → "… · ⚠ keine FX-Vol-Fläche für EUR/NOK (Fallback 8 %, Level 3)"                                                    (R5-2 ✓)
"irs sek 5y pay 3% 10m" → "Payer-Swap EUR 5Y @ 3,000 %" · "cap nok 5y 3% 10m" → "Cap EUR 5Y" · "swpt usd 1y5y payer 3.5% 10m cash" → physisch      (← R6-1)
"fxo eurusd put 1.15 3m 9m barrier 1.05" → Vanilla · "fxf … ndf", "irs … mtm", "ccs … foo" → ohne Hinweis · "irs 10y pay 3.1% 10m 6m" → Nominal 6.000.000 · "imm 2y pay 3% 10m" → Keine Treffer   (← R6-1)
"fxs eurusd 1m 1.1625 1.18 1y" ✓ · "ois usd 2y pay 4% 10m" → SOFR ✓ · "fra usd 3x6 pay 4% 10m" → SOFR ✓ · "irs eur 5y pay 2.5% 10m estr" ✓ · "@Sparkasse Musterstadt" ✓
Markt: FX-Vol-Paar-Tabs 10 (EUR/USD|EUR/GBP|EUR/CHF|GBP/USD|USD/JPY|EUR/JPY|USD/CHF|GBP/JPY|CHF/JPY|GBP/CHF) · FX-Fixings-Paare 5 · CDS-Kontrahenten Commerzbank|DZ BANK|Landesbank A · Snapshot-ID ab8dc0c6c16fc395
Snapshot-Import 1×1-Cube → "Import fehlgeschlagen: Vol-Fläche strukturell ungültig – Swaption-Cube USD, atm: 1 Zeilen, erwartet 11 (eine je Verfall); … atm[0]: 1 Einträge, erwartet 9 (einer je Tenor)"   (R5-1 ✓)
Snapshot-Import volType Lognormal (Normal-Zahlen) → "Snapshot „Sample EoD“ importiert · ID d3b3ea1fc67f984b", Chip "importiert", kein Hinweis          (← R6-4)
Export-Menü: Blotter CSV | Portfolio JSON | EMIR-Bewertungen (CSV) | Portfolio-Report JSON/Markdown | JSON/CSV importieren | 7 Vorlagen (Zinsswap, FX-Forward, Cap/Floor/Collar, Swaption, FX-Option, Cross-Currency-Swap, FRA)   (← R6-2)
CSV-Import (CCS none/USD + FXS + BASIS): Dialog "2 Zeilen übersprungen … Unbekannter Typ „FXS“ (erlaubt: IRS, FXF, CAP, SWPT, FXO, CCS, FRA)" → "2 Trades aus CSV importiert"
  CCS-R6A Collateral-Select "unbesichert" · CCS-R6B "USD-CSA" + Hint "Keine GBP-Diskontkurve für Besicherung in USD (Collateral-Kurve „GBP|USD“ fehlt) …"        (R5-3 ✓)
Blotter IRS-0001: Badge "⚠ 1", Hint "Fixing EURIBOR-6M vom 15.06.2026 fehlt – 6M-Forward ab 03.09.2026 verwendet (gleich lange Periode ab heute)"   (← R6-6)
Editor FXO: Auszahlung Vanilla | Digital (Cash – Quote-Ccy) | Digital (Asset – Basis-Ccy) · Barriere Keine | Up-and-Out | Up-and-In | Down-and-Out | Down-and-In · Vol-Override · Smile (RR/BF)
Editor FXF: NDF · FXS: zwei Legs (Kaufen/Verkaufen/Kurs/Valuta) · IRS: Amortisierend, Index EURIBOR-3M|EURIBOR-6M|ESTR|SOFR|SONIA|SARON|TONA, Währung EUR|USD|GBP|CHF|JPY
Hedge: Grundgeschäft "Variabel verzinster Kredit | Festzinskredit | Erwarteter FX-Cashflow | FX-Forderung / -Verbindlichkeit" · Hilfe (?): FX-Fixings ✓ Snapshot ✓ · Reporting-Währung → USD → GBP → CHF → JPY
Kurven-Tabs: €STR|EUR 6M|EUR 3M|SOFR|SONIA|SARON|TONA|EUR/USD CSA (kein "+ Kurve")                                                                   (← R6-5)
page errors: [] · smoke.mjs: E2E OK (350 checks)
```

Probe-Skripte, Ausgaben und Screenshots (`shots-r6/01-report-usdchf.png`, `02-market.png`, `03-csv-import.png`, `04-irs-editor.png`) im Scratchpad der Review-Session.
