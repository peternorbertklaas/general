# Re-Review Runde 3: Marktabdeckung Features & Module (Dimension 1, Gewicht 20 %) – DERIVA 0.2.0

**Reviewer-Rolle:** Senior Product Analyst, Treasury- und Derivateberatungssoftware (LPA Captano/Capmatix, Bloomberg SWPM/OVML/MARS, LSEG Swap Pricer/IPA, Numerix, Quantifi, FINCAD, Reval/ION, Kyriba/Coupa, SAP TRM, Murex/Calypso, ChathamDirect, FI ZWRM, QuantLib/ORE) · **Stand:** 04.09.2026, Branch `claude/derivatives-trading-platform-1arsyu`, Commit `0b292bd` (Core-`dist` frisch gebaut 00:11 UTC) · **Modus:** Review only, keine Quelldatei geändert
**Baseline:** `docs/quality/review-markt-r2.md` (Runde 2, Score 86 / 100) mit den Befunden N1–N19 und der Gap-Liste G1–G26 aus Runde 1
**Geprüft (Laufzeit):** `npx vitest run` → **Core 270/270, API 49/49, Web 163/163 grün**; `vite build` erfolgreich; Web-App unter `vite preview --port 4501` mit Playwright/Chromium durchgeklickt (`e2e-markt-r3.mjs`, Auszug Anhang C, keine `pageerror`); API per `buildApp` + `app.inject` (`probe-api-r3.mts`, `probe-api-r3b.mts`, Anhang B); Core-Proben gegen `packages/pricing-core/dist` (`probe-core-r3.mjs`, `probe-core-r3b.mjs`, Anhang A). Alle Zahlen unten stammen aus diesen Läufen.
**Roadmap-Regel:** In `02-epics-und-user-stories.md` / README als ⏳ dokumentierte Posten (Bermudan/CMS/Range Accrual, TARF/Strukturen, Marktdaten-Adapter & Kurven-Governance, OIDC/Rollen/DB-Persistenz, Excel-Add-in, Monte-Carlo-Netting-XVA/FVA, PDF-Template-Service, Inflations-ZC-Swap US-3.15, PRIIPs Annex-II-Monte-Carlo, SIMM/CRIF, VaR/Attribution, Batch-EoD/Webhooks, Designationsmemo US-10.6, EMIR-Tabelle 3/UPI/XML) werden **nicht** als Lücke gewertet.

---

## 1. Score

### **Marktabdeckung Features & Module: 97 / 100** (rechnerisch 97,4; Runde 1: 60, Runde 2: 86)

**In einem Satz:** Alle 19 Befunde der zweiten Runde sind geschlossen – 18 vollständig, einer (CSV-Import) bis auf einen API-Rest –, und zwar nicht nur im Datenmodell, sondern durchgängig bis in Palette, Hotkeys, Editor, Blotter, Hedge-View, Dokumente und OpenAPI (40 Operationen); DERIVA deckt damit den v1-Scope einer Zins-/FX-Workstation mit Prozessschicht (Hedge Accounting inkl. Tilgungsplan und Optionsdesignation, EMIR-Meldefelder inkl. UTI/Clearing/Delta, Confirmation/KID/Termsheet/Geeignetheitserklärung, Portfolio-Report, historische Stress-Tage, CDS-Termstruktur, Monotone Convex/Turn-of-Year/FX-Punkte) vollständig ab – **übrig bleiben Feinheiten der Voreinstellungen und Beispieldaten: das CCS-Template preist ohne CSA die Cross-Currency-Basis nicht, der FRA-Builder nimmt für ein 3x6 den 6M-Index, die Beispiel-Vol-Flächen gibt es nur für EUR, Vol-Flächen sind in der Marktansicht nicht editierbar, und CSV-Import/Palette haben kleine Randlücken.**

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, UX-Reibung −1…−3, kosmetisch −0,2…−1; Roadmap-dokumentiert = 0; keine Doppelzählung mit Quant/UI/Flows):

| Bereich | R1 | R2 | R3 | Restlücken (Nummern → Abschnitt 3) |
|---|---:|---:|---:|---|
| A Instrumente & Strukturen | −10 | −3,7 | −0,8 | CCS-Template/Sample ohne CSA → Basis nicht gepreist (R3-1 −0,5); `makeFra`-Standardindex passt nicht zur Periode (R3-2 −0,3) |
| B Kurven & Marktdaten | −5 | −0,7 | −0,2 | FX-Swap-Punkte nur per API/Core, keine UI-Eingabe (R3-6 −0,2) |
| C Modelle | −1 | 0 | 0 | – |
| D Sensitivitäten | −2 | −0,8 | 0 | N8 behoben (FX-Buckets + Smile, Expiry × Tenor, eingebettete Optionen) |
| E Szenarien / VaR | −1 | −0,5 | 0 | N10 behoben; VaR = Roadmap |
| F XVA | −2,5 | −0,5 | 0 | N11 behoben; Netting/CRIF = Roadmap |
| G Hedge Accounting | −4 | −3,0 | 0 | N2/N3 behoben |
| H Regulatorik | −4 | −1,5 | 0 | N5/N9 behoben; Tabelle 3/UPI/XML = Roadmap v1.0 |
| I Dokumente | −2,5 | −1,0 | 0 | N13 behoben; PDF/Annex-II-MC = Roadmap |
| J Workflow / Beratung | −2,5 | −0,3 | 0 | N15 behoben; Freigabe = Roadmap |
| K UI | −0,5 | −1,3 | −0,8 | Vol-Flächen in der Marktansicht nur lesbar (R3-4 −0,5); Palette: `fixed` beim CCS ignoriert, JPY-Strikes ohne Dezimalstellen (R3-5 −0,3) |
| L Integration | −2,5 | −0,5 | −0,3 | CSV-Import nur IRS/FXF/CAP, API ohne `text/csv` (N16-Rest −0,3) |
| M Admin | −2,5 | 0 | 0 | Rollen/DB = Roadmap |
| Sonstiges (Beispielmarkt) | – | −0,5 | −0,5 | Vol-Flächen nur EUR: USD/GBP/CHF-Swaptions/Caps und EURJPY-Optionen mit Fallback-Vol und Level 3 (R3-3 −0,5); Inflation jetzt Roadmap (N14 ✓) |
| **Summe** | **−40** | **−14,3** | **−2,6** | → **97,4 ≈ 97 / 100** |

Einordnung (gleiche Skala, v1-Workstation-Scope, Einschätzung): Bloomberg SWPM+OVML+MARS ≈ 85 (kein Hedge Accounting, keine deutschen Beratungsdokumente), LPA Capmatix OTC ≈ 75, ORE ≈ 60, Kyriba/Coupa ≈ 55. DERIVA liegt in der Feature-Breite für Vanilla-Zins/FX jetzt klar vor dem Bloomberg-Bündel, weil es den Beratungs- und Rechnungslegungsprozess (§ 64 WpHG, IFRS 9/HGB, EMIR, DRV-Confirmation, PRIIPs) aus demselben Bewertungskern bedient; die Restdifferenz zu 100 sind Voreinstellungen und Beispieldaten, keine fehlenden Module.

---

## 2. Status der Runde-2-Befunde N1–N19

Legende: **behoben** = im Code vorhanden **und** per Probe/UI reproduziert · **teilweise** = Kern vorhanden, benannter Rest · **offen** = unverändert.

| # | Befund R2 | Status | Nachweis (Datei / Probe / UI) | Rest |
|---|---|---|---|---|
| **N1** | CCS nicht per UI anlegbar | **behoben** | `builders.ts:462` `makeCrossCurrencySwap` (Pair, Fix/Float-Variante, `mtmReset`, `notionalExchange`, Spread-Leg zuerst für `fairSpread`); Template `ccs` + Hotkey `n z` (`keymap.ts:72`, `templates.ts:108`); Palette `ccs eurusd 5y -20bp 10m mtm` → Vorschau „Cross-Currency-Swap EUR/USD 5Y · Erhalte EUR −20,0 bp · … · MtM-Reset“, auch `ccs eurjpy … @ 171,4000` (Spot aus Markt); Editor: Checkboxen „Nominalaustausch Start/Ende/Interim“, Select „MtM-Reset: kein Reset / Leg 1 (ESTR) / Leg 2 (SOFR)“ (Screenshot `02-ccs.png`); Sample-Trade `CCS-0001`; API `POST /api/trades/from-template` (CCS mit `mtmReset`, USD-CSA → PV 9.553, fairer Spread −21,99 bp). Core: PV −95.031 (ohne CSA), MtM-Variante `mtmReset: "yes"`, Fix/Float-Variante Par 2,269 % | Template ohne CSA → R3-1 |
| **N2** | Tilgungsdarlehen nicht als Grundgeschäft | **behoben** | `hedge.ts:79–121` `HedgedItem.notionalSchedule` / `amortisation {Linear\|Annuity\|Custom, finalNotional, loanRate, frequency}`; `hypotheticalDerivative` überträgt den Plan auf beide Legs (`:785–792`); Critical-Terms-Check `notionalSchedule` periodenweise (`:899–906`). Probe 10Y-Amortisationsswap (10 → 1 Mio.): gegen Bullet-Kredit DO **0,588**/„nicht effektiv“, Critical Terms melden jetzt korrekt „Abweichung in 9 Periode(n), erste 08.09.2027“; mit `amortisation: Linear` DO **1,0108**, Steigung 1,0107, CT 5/5 → effektiv; Annuität 4 % → DO 0,9588 effektiv, CT-Nominalverlauf korrekt als Abweichung erkannt. UI `g h`: Select „Tilgung: endfällig / Linear / Annuität / Custom“, Restschuld, Kreditzins, Button „Tilgungsplan vom Sicherungsinstrument übernehmen“; AMORT-Trade mit Linear → „✓ effektiv“. API-Schema `hedgedItem.notionalSchedule`/`amortisation` (`routes/hedge.ts:17–44`) | – |
| **N3** | Optionen gegen lineares hypothetisches Derivat | **behoben** | `hedge.ts:77` `HedgeDesignation = FullFairValue \| IntrinsicValue`, `CostOfHedging` (`:242–252`), hypothetischer **Cap** mit Grundgeschäfts-Terms und Instrument-Strike (Probe: `hypo type CapFloor strike 0.03`, DO 1,0000), hypothetische **FX-Option** (Probe: `hypo type FxOption`, DO 0,983 effektiv); IntrinsicValue → `costOfHedging {timeValue 120.013, intrinsicValue 0}`; `freezeDesignationVol` (Vol am Designationstag eingefroren, `frozenVol` 0,713 %, kumulativer DO 1,0027, IFRS-9-Split assessable). UI: Select „Designation der Option (IFRS 9 6.5.15): Voller Fair Value / Innerer Wert (Zeitwert → OCI, Cost of Hedging)“, Checkbox „Vol bei Designation einfrieren“, Karte „Δ Zeitwert → OCI (Cost-of-Hedging-Rücklage)“; Cap-Hedge „✓ effektiv“. API: `designation`, `freezeDesignationVol`, Antwort `costOfHedging`, `hypotheticalDerivative.frozenVol` | – |
| **N4** | Kupon-Staffeln nicht abbildbar | **behoben** | `types.ts:67/78` `FixedLeg.rateSchedule`, `FloatLeg.spreadSchedule`; `leg-pricer.ts:58–65` Satz/Spread je Periode; Par-Solver hält Stufen konstant (`swap-pricer.ts:19–26`, `parRateFlat`); Builder `stepUp`; Palette `irs 5y pay 2.5% 10m step 2.5/3.0/3.5` (Vorschau „→ 2,50 / 3,00 / 3,50 % Staffel“); Editor-Karte „Kuponverlauf (Zinsstaffel / Spread-Staffel)“ mit „+ Stufe“ und „vom Amortisationsplan übernehmen“; API-Schema `rateSchedule`/`spreadSchedule` (Probe 200, Sätze 2,5/2,5/3,0/3,5 %, `parRateFlat` 2,83 %). Core: Kupons 2,5/3,0/3,5/3,5/3,5 %, PV −264.331 vs. −55.915 flach; UI IRS-0003 PV −264.541, Par-Satz 1,9326 %; Termsheet zeigt „Staffel: … ab …“ (`documents.ts:85–88`) | – |
| **N5** | EMIR ohne UTI/Cleared/Delta, fester Zeitstempel | **behoben** | `types.ts:31–35` `uti`, `cleared`, `clearingMember`; `emir.ts:66–132` `emirDelta` (Option: Bachelier/GK-Delta je Nominal, linear ±1), Zeitstempel `timestamp → meta.snapshotTime → asOf → EoD`, Felder 31–33 Cleared/Clearing obligation/Clearing member, CSV 15 Spalten. Probe Swaption: `delta 0,387, cleared TRUE, clearingObligation Y, clearingMember Eurex`; Cap 0,290, FX-Option 0,509, Receiver-Swap −1; `asOf=…T18:30Z` übernommen. API-CSV: Delta-Spalte gefüllt (1,000000 / 0,290174 / 0,386806 / −0,360528), Clearing-Spalten vorhanden. Editor-Abschnitt „Regulatorik (EMIR Refit)“ (UTI, zentral gecleart, Clearing-Member), Blotter-Filter „ohne UTI (11)“, Kundenmodus blendet den Abschnitt aus; Sample-Trades CCS-0001/FRA-0001 mit UTI | Tabelle 3/UPI/XML = Roadmap v1.0 (US-6.5) |
| **N6** | FRA nicht per UI anlegbar | **behoben** | `builders.ts:548` `makeFra` („3x6“ ab Spot oder explizite Daten); Template `fra` + Hotkey `n r`; Palette `fra 3x6 pay 2.2% 10m` (setzt EURIBOR-3M); Sample `FRA-0001`; `n r` → FRA-0002, KPI „Forward-Satz 2,2039 %“, Editor „Start (Fixing-Periode) / Ende / Festsatz / Index“; API `from-template FRA` (200, 2026-12-07 → 2027-03-08) | Builder-Standardindex → R3-2 |
| **N7** | Datenmodell-Features ohne Editor | **behoben** | `TradeEditor.tsx:689–725` Collateral (CSA) und Upfront/Prämie (Betrag, Währung, Datum) im `common`-Block aller Typen; Swaption „Cash-Konvention: Collateralised Cash Price (ICE Swap Rate, Standard) / IRR“ (`:1057`, UI reproduziert nach Settlement=Cash); FX-Forward Checkbox „Non-Deliverable Forward“ mit NDF-Fixing und Settlement-Währung (UI: Analytics „NDF ja“, PV 506); FX-Option Select „Auszahlung: Vanilla / Digital …“ mit Auszahlungsbetrag (UI: PV 487.152 digital) und Barriere-Level/Rebate (`:1310–1335`, UI „Barriere-Level, Rebate (USD)“) | – |
| **N8** | Vega nur Swaption/Cap je Expiry, FX leer | **behoben** | `sensitivities.ts:500–582`: FX-Fläche je Expiry (ATM) + Smile-Buckets RR25/BF25 (`smile`), Swaption `dimension: "expiry-tenor"`, eingebettete Optionen über `capletSurfaceKeysFor`. Probe FX-Option: 24 Buckets (8 ATM + 8 RR + 8 BF), Σ ATM 2.781 vs. Parallel-Vega 2.779; Swaption 2-D 99 Zellen (Σ 1.758, Maximum 1Y×5Y); Swap mit Floor 2 %: 9 Caplet-Buckets Σ 2.158 vs. `computeRisk.vega` 2.160. API `/api/risk/vega` `smile`/`dimension`, Summary korrigiert; UI: Karte „Vega-Buckets · FX-Fläche EURUSD“ mit Checkbox „Smile (RR/BF)“ (8 Zeilen), Swaption-Segment „je Verfall / Verfall × Tenor“ mit Heatmap | – |
| **N9** | IFRS-13-Skopierung über alle Kurven | **behoben** | `valuation-report.ts:157–187` prüft nur `tradeCurveIds` (Diskontkurve unter CSA, Projektionskurven). Probe: 12Y-EUR-Swap → **Level 2**; 12Y unter USD-CSA → Level 3 (USDCSA-Kurve 10Y, korrekt); 40Y → Level 3; API `/api/report` 12Y → Level 2 | – |
| **N10** | Keine historischen Stress-Tage | **behoben** | `scenarios.ts:263–447` `HISTORICAL_SCENARIOS`: Lehman 2008, Euro-Krise 2011, Covid 2020, Zinswende 2022, SNB 2015, Brexit 2016 (Tenor-Vektoren, FX %, Vol, Quellen im Text, als Näherung gekennzeichnet). Probe 10Y-Payer: −571.476 / −469.951 / −266.520 / +1.039.151 / 0 / −130.781. API `GET /api/scenarios/historical`, `includeHistorical` (22 Ergebnisse); UI-Chip „historische Stress-Tage (6)“: 16 → 22 Zeilen mit Badge „historisch“ und Beschreibung | Echte Historie = US-2.10 |
| **N11** | Kein CDS-Termstruktur-Bootstrap | **behoben** | `cva.ts:76–176` `HazardCurve`, `bootstrapHazardCurve` (Prämienleg-Näherung, Brent je Pillar), `survivalProbability`, `marginalPd`; `CreditInputs.cptyHazardCurve/ownHazardCurve`. Probe 50/80/120/150 bp → λ 83/159/306/307 bp; CVA 10Y-Swap flach 2 %: 24.655 vs. Termstruktur 31.266, Methode „hazard term structure (CDS bootstrap)“. API `POST /api/xva/hazard-curve` (Pillars mit Q(T)), `/api/xva` mit Kurve; UI Marktansicht „Kreditdaten (CVA)“: Kontrahent-Select, „+ CDS-Quote“, Tabelle Tenor/Spread/Hazard/Q(T), Zeile „Hazard-Kurve: 0,5 J → 167 bp …“; Report-CVA-Untertitel | – |
| **N12** | Monotone Convex, Turn-of-Year, FX-Punkte fehlen | **behoben** | `interpolation.ts:8,40–131` `monotoneConvex` (Hagan/West); `bootstrap.ts:131,425` `turnOfYear` → `forwardJumps` mit Re-Solve; `bootstrap.ts:77–95,261–273,499` Quote-Typ `FxSwapPoints`. Probe €STR: Residuum 3,4·10⁻¹³, Zero 5Y 2,4699 % (log-linear 2,4700 %); ToY 31.12.2026 +15 bp: Tagesforward 2,083 → 2,232 %, Residuen 3,7·10⁻¹⁶; FX-Punkte-Kurve 5 Knoten, Residuen 0. API `/api/market/bootstrap` (`spec.interpolation`, `turnOfYear`, `FxSwapPoints`) 200; UI Kurvenansicht: Select „monoton-konvex (Hagan–West)“, Turn-of-Year-Datum/bp/„Anwenden“, Badge „Turn-of-Year 31.12.2026 +15,0 bp“, Chip „Markt modifiziert · 1 Interpolation · 1 Turn-of-Year“ | FX-Punkte ohne UI-Eingabe → R3-6 |
| **N13** | Confirmation / PRIIPs-KID fehlen | **behoben** | `documents.ts:522` `generateConfirmation` (Parteien mit LEI, DRV/ISDA-Bezug, CSA, wirtschaftliche Bedingungen, Zahlungsplan mit „indikativ“-Kennzeichnung), `:692` `generateKid` (9 Abschnitte nach DelVO 2017/653-Gliederung, SRI-Heuristik mit ausgeschriebener Herleitung und Roadmap-Hinweis auf Annex-II-Monte-Carlo, Performance-Szenarien aus dem Szenarioset, Kosten aus der Kostentransparenz). API `POST /api/documents/confirmation|kid?format=md` (200, Markdown); UI Report-Buttons „Confirmation“ / „Basisinformationsblatt (KID)“, Hotkeys `Ctrl+Shift+F/K`, Modale mit Formular (Parteien/LEI/Rahmenvertrag bzw. Hersteller/Haltedauer), Druck; Regulatorik-Mapping Zeilen 94–95 | Annex-II-MC/PDF = Roadmap |
| **N14** | Inflation weder umgesetzt noch Roadmap | **behoben** (Roadmap) | `02-epics:67–68` US-3.15 ⏳ v1.1 mit fachlicher Skizze (HICPxT, `ZcInflation`-Quotes, IE01) und Abgrenzung | kein Abzug |
| **N15** | Keine Angebotsgültigkeit | **behoben** | `types.ts:27–29` Status `Quoted` + `quoteValidUntil`; Editor: Status „Angebot“ → Feld „Angebot gültig bis“ (Default +1W, Warnung „abgelaufen“), Blotter-Badge „Angebot“/„abgelaufen“ (`Blotter.tsx:34–42`) und Zähler; API-Roundtrip `quoteValidUntil 2026-09-10` | Freigabe/4-Augen = „Workflow/Signatur ⏳“ |
| **N16** | Trade-Import nur JSON | **teilweise** (UI ✓) | `portfolio-io.ts:90–460` `tradesFromCsv` (BOM, `;`/`,`/Tab, Dezimalkomma, deutsche/englische Header-Aliase, Mapping), Vorlagen IRS/FXF/CAP; Blotter-Export-Menü „⤒ CSV importieren“, „⤓ Vorlage Zinsswap / FX-Forward / Cap“, Duplikat-Dialog (skip/replace/rename) | API `POST /api/trades/import` mit `text/csv` → **415**; keine Vorlagen für Swaption/FX-Option/Basis/CCS/FRA (−0,3) |
| **N17** | Amortisation nur linear/manuell | **behoben** | `builders.ts:350–386` `annuityAmortisation(Schedule)`; Editor-Buttons „Linear / Annuität / Custom / Konstant“, Felder „Restschuld“, „Kreditzins“, Paste-Handler `parseSchedulePaste`. UI: Annuität → 10.000.000 / 9.167.091 / 8.300.865 / 7.399.990 …; Core 10 Mio., 4 %, 5 Perioden → 10.000.000 / 8.153.729 / 6.233.607 / 4.236.680 / 2.159.876 | – |
| **N18** | JPY ohne Kurve | **behoben** | `sample-market.ts:25,143,320` JPY-TONA-OIS; Palette `irs jpy 5y pay 1% 1000m` / `ois jpy …` / `ccs eurjpy …`; Core JPY-Swap PV 50.914 EUR, Par 1,180 %, keine Warnung; API JPY-Swap 200; UI Kurven-Tab „TONA“ mit 13 Pillars | Vol-Flächen JPY fehlen → R3-3 |
| **N19** | Kein Buch, keine Gruppierung | **behoben** | Editor-Feld „Buch“ (Datalist), Blotter-Spalte/Sortierung „Buch“, Suche inkl. Buch, Select „Gruppieren: – / Kontrahent / Buch / Typ“ (13 → 16 Zeilen mit Gruppenköpfen), `portfolio-report.ts` `buildPortfolioReport` (Kontrahent/Buch/Typ, Audit-Hashes) + Markdown; API `POST /api/report/portfolio` (`groupBy`, `?format=md`); Blotter „⤓ Portfolio-Report (JSON/Markdown)“, Hotkey `Ctrl+Shift+L` | – |

**Runde-1-Gap-Liste G1–G26:** Alle in R2 als „teilweise“ geführten Posten (G1 Step-up, G10 CCS, G13 IFRS-13-Skopierung, G15 Import, G16 Vega, G23 Monotone Convex) sind mit N1/N4/N9/N12/N16 geschlossen; G14/G24/G26 bleiben dokumentierte Roadmap (kein Abzug).

---

## 3. Neue Befunde (Runde 3)

Severity: **Niedrig** = Reibung/Lücke zweiter Ordnung für eine v1-Persona · **Kosmetisch** = Voreinstellung/Konsistenz.

| # | Sev. (Abzug) | Ort | Befund (reproduziert) | Fix |
|---|---|---|---|---|
| **R3-1** | Niedrig (−0,5) | `templates.ts:108–117` (kein `collateralCurrency`), `sample-portfolio.ts:169–184` (`collateralCurrency: "EUR"`), `quick-parser.ts:270–280` | **Das CCS-Template preist die Cross-Currency-Basis nicht.** `n z` → „CCS EUR/USD 5Y €STR −20 bp vs SOFR“ zeigt **Fairer Basis-Spread −0,1 bp** und PV −95.014 EUR, weil ohne CSA beide Legs auf den eigenen OIS-Kurven diskontiert werden; erst `collateralCurrency: "USD"` aktiviert `EUR-ESTR-USDCSA` (API-Probe: fairer Spread **−21,99 bp**, PV +9.553 EUR). Auch `CCS-0001` (CSA EUR) und die Palette (`ccs … 10m` ohne CSA) nutzen die Basis-Kurve nicht. Für den Treasurer sieht ein marktkonformer −20-bp-Swap damit wie ein Off-Market-Geschäft aus; Bloomberg SWPM/LSEG IPA preisen CCS standardmäßig unter USD-CSA mit der Xccy-Basis. | Template, Sample-Trade und Palette-Default `collateralCurrency: "USD"` (bzw. die Währung, für die eine Collateral-Kurve existiert); Editor-Hinweis unter „Collateral (CSA)“ bei CCS: „ohne CSA keine Xccy-Basis“; Test: Template-CCS fairSpread ≈ Markt-Basis −20 bp. |
| **R3-2** | Niedrig (−0,3) | `builders.ts:563–575` (`idx = getIndex(p.index ?? conv.floatIndex)`), `templates.ts:119–127`, `routes/trades.ts:23–30` | **`makeFra` wählt den Index unabhängig von der Periode:** Ein „3x6“ ohne `index` erhält EURIBOR-**6M** (Core-Probe: `FRA EUR 3x6 … EURIBOR-6M`, Periode 08.12.2026–08.03.2027 = 3 Monate). Damit projizieren Template `n r` und `POST /api/trades/from-template` einen 6M-Forward über eine 3M-Periode; nur die Palette setzt explizit EURIBOR-3M (`quick-parser.ts:313`). | Standardindex aus der Periodenlänge ableiten (`EURIBOR-${end−start}M`, Fallback Währungsindex); Warnung, wenn Indextenor ≠ Periodenlänge; Test 3x6 → EURIBOR-3M, 6x12 → EURIBOR-6M. |
| **R3-3** | Niedrig (−0,5) | `sample-market.ts` (`swaptionVols` nur `EUR`, `capletVols` nur `EUR-EURIBOR-6M`, `fxVols` EURUSD/EURGBP/EURCHF) | **Beispielmarkt ohne Nicht-EUR-Vol-Flächen:** USD-Swaption → „No swaption vol surface – using 70bp normal vol“, USD-Cap → 60 bp Fallback, beide **IFRS-13 Level 3**; EURJPY-Option → „No FX vol surface – using 8% vol“. US-2.9 verspricht „EUR/USD/GBP/CHF-Kurven, Vols“; die Workstation ist offline-first, der Beispielmarkt also für v1 der einzige Markt. Für die USD-Finanzierungs-Persona (CCS/USD-Cap) fehlt damit die Optionsseite. | Indikative Normal-Vol-Cubes für USD (SOFR) und GBP (SONIA), Caplet-Flächen USD/GBP, FX-Flächen USDJPY/EURJPY/GBPUSD in `SAMPLE_*`-Konstanten; `discountCurveId`-analoge Registrierung; Test: USD-Swaption ohne Warnung, Level 2. |
| **R3-4** | Niedrig (−0,5) | `MarketView.tsx:361–540` (Swaption-Heatmap, FX-Fläche, Caplet-Vols nur lesend), `store.ts` (kein Vol-Setter), API nur `GET /api/market/vols` | **Vol-Flächen sind in der Workstation nicht pflegbar.** Spots, Fixings, Quotes, CDS und Turn-of-Year sind editierbar, die drei Vol-Flächen nur über Snapshot-Import (`PUT /api/market/snapshot`) oder per Trade-`volOverride` (Level 3). Ein Risk-/IPV-Nutzer kann damit keine Broker-Vol nachziehen, ohne den kompletten Snapshot zu ersetzen (Bloomberg VCUB/OVDV, Numerix, ORE-Marktdaten: Zell-Edit Standard). | Editierbare Zellen in Swaption-Heatmap, FX-Vol-Tabelle (ATM/RR/BF je Expiry) und Caplet-Tabelle mit Undo und „Markt modifiziert“-Chip (Mechanik wie Quotes); `PATCH`-fähiges `PUT /api/market {swaptionVols, fxVols, capletVols}`; Vol-Änderungen in `marketSnapshotId`. |
| **R3-5** | Kosmetisch (−0,3) | `quick-parser.ts:29,239–261` (Kommentar „[fixed <rate%>]“, kein Parsing), `:465` (Strike-Regex `^\d+[.,]\d{2,}$`) | (a) `ccs eurusd 5y fixed 3.00% 10m` legt **stillschweigend** einen Float/Float-CCS mit 0 bp an – der dokumentierte Fix/Float-Baukasten der Palette fehlt, obwohl der Builder `fixedRate` kann; (b) `fxo eurjpy call 175 1m 6m` → „Format: fxo eurusd put …“, weil JPY-Strikes ohne Dezimalstellen nicht als Strike erkannt werden (EURJPY-Spot liegt im Markt). | (a) Token `fixed <rate>` → `fixedRate`, Vorschau „Fest 3,00 % EUR vs SOFR“; (b) Strike-Regex `^\d+(?:[.,]\d+)?$` mit Plausibilität gegen den Spot des Paars. |
| **R3-6** | Kosmetisch (−0,2) | `CurvesView.tsx:54–92` (`FxSwapPoints` nur bei vorhandenen Quotes editierbar), keine „Quote hinzufügen“-Funktion | FX-Swap-Punkte als Kurveninput sind im Kern/API vorhanden (N12), in der Kurvenansicht aber nicht anlegbar – der Beispielmarkt enthält keine `FxSwapPoints`-Quotes, die Collateral-Kurve `EUR-ESTR-USDCSA` startet erst bei 1Y Xccy-Basis. | Kurzes Ende der Collateral-Kurve im Sample aus FX-Punkten (1M/3M/6M) belegen; „+ Quote“ in der Quote-Tabelle mit Typ-Select. |

**Ohne Abzug, aber dokumentierenswert:**
- `fra usd 3x6 …` erzeugt ein FRA auf SOFR (Overnight-Index); USD-FRAs existieren seit LIBOR-Ende nur auf Term-SOFR – Parser könnte USD/GBP/CHF/JPY für `fra` ablehnen oder auf Term-Raten warten (kein Kernfall der DACH-Persona).
- RFR-Lockout weiterhin nicht im Datenmodell (wie R2: kosmetisch, nicht gewertet).
- KID-Risikoindikator ist explizit als Heuristik ausgewiesen (Herleitung im Dokument, Regulatorik-Mapping Nr. 10); Annex-II-Monte-Carlo laut Roadmap-Regel kein Abzug.
- `POST /api/trades/from-template` liefert den Trade **ungespeichert** (Design, dokumentiert) – ein `?store=true` würde den API-Anlage-Flow auf einen Aufruf verkürzen.
- Hedge-Test: Bei Grundgeschäft mit `amortisation` und leicht anderem Tilgungsprofil als das Instrument (Probe Annuität vs. linear) bleibt der DO-Test bei 0,96 effektiv, die Critical-Terms melden den Unterschied korrekt – fachlich richtig.

---

## 4. Feature-Matrix – Statusänderungen gegenüber Runde 2 (nur DERIVA-Spalte)

| Feature | R2 | R3 | Beleg |
|---|---|---|---|
| CCS per UI anlegbar (Template/Hotkey/Palette/Editor mit Nominalaustausch, MtM-Reset) | ❌ | ✅ | N1 |
| FRA per UI anlegbar | ❌ | ✅ | N6 |
| Step-up-/Spread-Staffel (Modell, Par-Solver, Palette, Editor) | ❌ | ✅ | N4 |
| Annuitätentilgung, Restschuld, Paste | ❌ | ✅ | N17 |
| Tilgungsplan im Grundgeschäft (Hedge Accounting) | ❌ | ✅ | N2 |
| Hypothetischer Cap / FX-Option, intrinsische Designation, Cost of Hedging, Vol-Freeze | ❌ | ✅ | N3 |
| EMIR: UTI/Cleared/Clearing-Member im Trade, Delta aus Analytics, Zeitstempel-Kaskade | ❌ | ✅ | N5 |
| Editor: Upfront, Digital, Rebate, NDF, Cash-Konvention, CSA überall | ❌ | ✅ | N7 |
| Vega-Buckets FX (ATM + RR/BF), Expiry × Tenor, eingebettete Optionen | 🔶 | ✅ | N8 |
| IFRS-13-Level auf genutzten Kurven | 🔶 | ✅ | N9 |
| Historische Stress-Tage (6 Episoden, UI/API) | ❌ | ✅ | N10 |
| CDS-Termstruktur / Hazard-Kurve (Core, API, UI) | ❌ | ✅ | N11 |
| Monotone Convex / Turn-of-Year / FX-Swap-Punkte | ❌ | ✅ (FX-Punkte ohne UI) | N12, R3-6 |
| Confirmation (DRV/ISDA) / PRIIPs-KID | ❌ | ✅ (KID-SRI heuristisch, dokumentiert) | N13 |
| Inflations-ZC-Swap | ❌ (nicht dokumentiert) | ⏳ Roadmap v1.1 | N14 |
| Angebotsstatus mit Gültigkeit | ❌ | ✅ | N15 |
| CSV-Import mit Spaltenmapping | ❌ | ✅ UI (IRS/FXF/CAP) / ❌ API | N16 |
| JPY-Kurve (TONA), JPY-Trades | ❌ | ✅ | N18 |
| Buch, Blotter-Gruppierung, Portfolio-Report (JSON/MD, API) | ❌ | ✅ | N19 |
| Vol-Flächen in UI editierbar | ❌ (nicht bewertet) | ❌ | R3-4 |
| Nicht-EUR-Vol-Flächen im Beispielmarkt | ❌ (nicht bewertet) | ❌ | R3-3 |
| Excel / Live-Marktdaten / Rollen / Netting-CVA / VaR / CRIF / Bermudan / TARF / PDF | ⏳ | ⏳ Roadmap | kein Abzug |

---

## 5. Verifizierte Positivbefunde (Auszug, alle reproduziert)

- **Instrumentenabdeckung geschlossen:** Alle acht v1-Trade-Typen sind über Template, Hotkey, Palette-Grammatik (14 Beispiele in `QUICK_ENTRY_EXAMPLES`), Editor und API anlegbar; CCS mit Fix/Float-Variante, MtM-Reset und Nominalaustausch; Staffeln und Tilgungsprofile (linear/annuitätisch/custom) auf Swaps und Caps (`CapFloor.notionalSchedule`, Probe amortisierender Cap PV 41.017 vs. 120.013 bullet).
- **Hedge Accounting auf Chatham/Kyriba-Niveau plus HGB:** Tilgungsplan im Grundgeschäft mit periodenweisem Critical-Terms-Check, hypothetischer Cap/FX-Option, intrinsische Designation mit Cost-of-Hedging-Rücklage, eingefrorene Designations-Vol (B6.5.5), Basis-Szenarien im Regressionsset, deutsche Zusammenfassung – im DACH-Segment ohne Gegenstück.
- **Regulatorische Prozesskette aus einem Kern:** EMIR-Refit-Felder 21–26 und 31–33 mit Delta aus der Bewertung, Termsheet, Geeignetheitserklärung (§ 64 WpHG), DRV/ISDA-Confirmation, PRIIPs-KID, Portfolio-Report mit Snapshot-/Inputs-/Report-Hash, Audit-Kette (`chainValid: true`).
- **Kurven auf LSEG-/ORE-Niveau:** acht Kurven (inkl. JPY-TONA, EUR unter USD-CSA), Monotone Convex, Turn-of-Year mit Re-Solve, FX-Swap-Punkte, Futures/Tenor-Basis/Xccy-Basis, Interpolation je Kurve live in der UI, Residuen ≤ 10⁻¹².
- **Risiko/Szenarien:** Par-Risk je Quote (auch Portfolio), Vega-Buckets in drei Flächen inkl. FX-Smile und Expiry × Tenor-Heatmap, 16 Standard- + 6 historische Szenarien, eigener Szenario-Editor, CDS-Termstruktur-CVA.
- **API-Vertrag:** 40 Operationen (u. a. `from-template`, `report/portfolio`, `xva/hazard-curve`, `scenarios/historical`, `documents/confirmation|kid`), JSON-Schema-validiert (Step-up, Clearing, `Quoted`, Tilgungspläne, FX-Punkte), deutsches CSV/Markdown.

---

## 6. Was für 100 noch fehlt

1. **R3-1 CCS-Default mit CSA** (Template, Sample, Palette) – fünf Zeilen, danach zeigt der Template-CCS den Markt-Basis-Spread.
2. **R3-2 `makeFra`-Index aus der Periodenlänge** – eine Zeile plus Test.
3. **R3-3 Nicht-EUR-Vol-Flächen im Beispielmarkt** (USD/GBP-Swaption-Cube, Caplet, FX USDJPY/EURJPY/GBPUSD) – indikative Konstanten, keine Modellarbeit.
4. **R3-4 Vol-Flächen editierbar** in der Marktansicht (Zell-Edit wie Quotes, Undo, Snapshot-ID) und per `PUT /api/market`.
5. **R3-5/R3-6 Palette `fixed`-Token und JPY-Strikes; FX-Punkte in der Kurvenansicht anlegbar.**
6. **N16-Rest:** CSV-Vorlagen für Swaption/FX-Option/Basis/CCS/FRA und `POST /api/trades/import` mit `text/csv`.

Mit 1–3 (geschätzt ein halber Arbeitstag) läge die Dimension bei ≈ 99; Punkt 4 (Vol-Edit) ist der einzige Posten mit UI-Aufwand und schließt zusammen mit 5–6 die Lücke zu 100 für den v1-Scope.

---

## Anhang A – Core-Probe (`node probe-core-r3.mjs` / `probe-core-r3b.mjs` gegen `dist`, Auszug)

```
Engine deriva-pricing-core/0.2.0 · curves: EUR-ESTR,EUR-EURIBOR-6M,EUR-EURIBOR-3M,USD-SOFR,GBP-SONIA,CHF-SARON,JPY-TONA,EUR-ESTR-USDCSA
N1 CCS: Float EUR Receive ESTR nx={initial,final} / Float USD Pay SOFR · PV −95.030,91 · fairSpread −0,08 bp · mtmReset no
   MtM: resettingLegIndex 1 · PV −95.058,79 · mtmReset yes ; fixed/float USD-CSA: PV 342.547,58 · parRate 2,269 %
N6 FRA 3x6: 2026-12-08 → 2027-03-08 · EURIBOR-6M (← R3-2) · PV 95,49 · fwd 2,2039 %
N4 step-up: Kupons 0.025,0.03,0.035,0.035,0.035 · PV −264.331 (flach 2,5 %: +55.915) · parRate 1,9327 % · parRateFlat 2,62 %
   spreadSchedule: Float-Sätze 2,310/2,360/2,530/2,728/2,803 % · PV 40.055
N17 annuity 10M 4 % 5p: 10.000.000 / 8.153.729 / 6.233.607 / 4.236.680 / 2.159.876
N2 amort swap vs bullet loan: DO 0,588 · slope 0,573 · effective false · CT false („Abweichung in 9 Periode(n), erste 08.09.2027“)
   amortisation Linear: DO 1,0108 · slope 1,0107 · effective true · CT true · hypo notionalSchedule 10 ; notionalSchedule vom Swap: DO 1,0108
   Annuität 4 %: DO 0,9588 · effective true · CT notionalSchedule match=false (10.000.000 → 1.185.490 vs → 1.000.000)
N3 Cap FullFairValue: hypo CapFloor strike 0.03 · DO 1,0000 · slope 1,0000 ; IntrinsicValue: coh {timeValue 120.013, intrinsic 0}
   freezeDesignationVol: frozenVol 0,00713 · cumulative DO 1,0027 · ifrs9 assessable ; FX-Option-Hedge: hypo FxOption · DO 0,983 · effective
N5 EMIR Swaption: uti 529900XXXX0001 · HRSAVP · delta 0,38709 · cleared TRUE · clearingObligation Y · clearingMember Eurex · ts 2026-09-04T17:00:00Z
   cap delta 0,2902 · fxo delta 0,5087 · irs rec −1 · asOf 18:30Z übernommen · CSV 15 Spalten (… Delta;Collateral;Cleared;Clearing obligation;Clearing member)
N8 vega fxo: EURUSD fx n=24 (atm 8, rr 8, bf 8) total 2.781 (parallel 2.779) ; swaption expiry-tenor n=99 total 1.758 max 1Yx5Y ; embedded floor: caplet n=9 total 2.158 (computeRisk 2.160)
N9 IFRS13: 12Y EUR → Level 2 ; 12Y USD-CSA → Level 3 (EUR-ESTR-USDCSA) ; 40Y → Level 3
N10 historical: 6 Episoden · P&L 10Y payer −571.476 / −469.951 / −266.520 / +1.039.151 / 0 / −130.781
N11 hazard curve 50/80/120/150 bp → λ 83/159/306/307 bp ; CVA flat 24.655 vs curve 31.266 „hazard term structure (CDS bootstrap)“
N12 monotoneConvex ESTR: resid 3,4e-13 · zero 5Y 2,4699 % ; ToY 31.12.2026 +15 bp: fwd 2,083 → 2,232 % · resid 3,7e-16 ; FxSwapPoints-Kurve 5 Knoten · resid 0
N13 Confirmation: Parteien | Rahmenvertrag | Wirtschaftliche Bedingungen | Zahlungsplan | Bestätigung ; KID: 9 Abschnitte · SRI 3/7 (5Y) bzw. 4/7 (10Y) mit Herleitung
N18 JPY swap TONA: PV 50.914 EUR · par 1,180 % · keine Warnung
N19 portfolio report: byBook FX/Treasury · Markdown „# Portfolio-Bewertungsreport“
R3-3: USD swaption „No swaption vol surface – using 70bp normal vol“ Level 3 ; USD cap 60bp Level 3 ; EURJPY option „No FX vol surface – using 8% vol“
```

## Anhang B – API-Probe (`npx tsx probe-api-r3.mts` / `probe-api-r3b.mts`, `app.inject`, Auszug)

```
openapi: 40 Operationen (… POST /api/trades/from-template, /api/report/portfolio, /api/xva/hazard-curve, GET /api/scenarios/historical, POST /api/documents/confirmation|kid, /api/risk/vega …)
from-template CCS (mtmReset, USD-CSA): 200 · PV 9.553 · fairSpread −21,99 bp ; FRA 3x6: 200 · 2026-12-07 → 2027-03-08 · PV 96,55
price step-up (rateSchedule+spreadSchedule): 200 · PV −239.880 · Sätze 0.025,0.025,0.03,0.035 · parRateFlat 2,83 %
POST /api/trades {uti, cleared, clearingMember, status Quoted, quoteValidUntil}: 201 ; GET → quoteValidUntil 2026-09-10
emir csv (asOf 18:30Z): ;IRS-0001;CPTY-A;SRCCSP;…;2026-09-04T18:30:00Z;MTMO;1,000000;FALSE;FALSE;N;  · CAP-0001 Delta 0,290174 · SWPT-0001 0,386806 · FXO-0001 −0,360528 · EMIR-1 uti …EMIR1 cleared TRUE Y
vega fxo smile: EURUSD fx n=24 ; vega swpt expiry-tenor: n=99
hedge amort Linear (aligniert): DO 0,9129 · slope 0,9104 · effective true ; cap IntrinsicValue: hypo CapFloor strike 0.03 · DO 1,000 · costOfHedging.timeValue 96.080
scenarios/historical: 6 ids ; POST /api/scenarios includeHistorical: 22 Ergebnisse
xva/hazard-curve: 1Y 83bp Q 0,992 · 5Y 231bp Q 0,904 · 10Y 307bp Q 0,775 ; xva mit Kurve: CVA 13.154 „hazard term structure (CDS bootstrap)“
market/bootstrap {spec: monotoneConvex, turnOfYear}: 200 · interp monotoneConvex · maxres 9,7e-13 ; FxSwapPoints: 200 · 4 Knoten · zero 1Y 1,328 %
documents/confirmation?format=md: 200 text/markdown · # Bestätigung (Confirmation) – Payer-Zinsswap (EUR) ; documents/kid?format=md: 200 · SRI 4 von 7
report/portfolio: 200 · 11 Zeilen · audit.reportHash ; ?format=md: Zusammenfassung | Nach Kontrahent | Nach Buch | Nach Produktart | Einzelgeschäfte | Audit
price JPY (TONA): 200 · PV −7.917 · par 1,367 % ; price amortising cap: 200 · PV 56.505 ; report 12Y: IFRS 13 Level 2
POST /api/trades/import text/csv → 415 (N16-Rest) ; audit 8 Einträge · chainValid true
```

## Anhang C – UI-Probe (Playwright/Chromium gegen `vite preview :4501`, `e2e-markt-r3.mjs`, Auszug)

```
Blotter: 13 Trades · Toolbar Alle|Zins|FX|Optionen|Indikationen ausblenden|ohne UTI (11)|Gruppieren –/Kontrahent/Buch/Typ|▦ Spalten|⤓ Export ▾ ; Gruppierung Kontrahent → 16 Zeilen (3 Gruppenköpfe)
Export-Menü: Blotter CSV | Portfolio JSON | EMIR (CSV) | Portfolio-Report (JSON) | Portfolio-Report (Markdown) | JSON importieren | CSV importieren | Vorlage Zinsswap / FX-Forward / Cap
n z → CCS-0002 · Barwert −95.014 · Fairer Basis-Spread −0,1 bp (R3-1) · Editor: Nominalaustausch Start ✓ Ende ✓ Interim ☐ · MtM-Reset-Select · Kuponverlauf (Spread-Staffel)
n r → FRA-0002 · Forward-Satz 2,2039 % · Felder Richtung/Währung/Index/Nominal/Festsatz/Start (Fixing-Periode)/Ende/Tageszählung
Palette: „ccs eurusd 5y -20bp 10m mtm“ ✓ MtM-Reset · „fra 3x6 pay 2.2% 10m“ ✓ EURIBOR-3M · „irs 5y pay 2.5% 10m step 2.5/3.0/3.5“ ✓ Staffel · „irs jpy 5y pay 1% 1000m“ ✓ · „ccs eurjpy 5y 10bp 10m“ ✓ @ 171,4000
Step-up IRS-0003: Kuponverlauf-Karte ✓ · PV −264.541 · Par-Satz 1,9326 %
Editor common: Bezeichnung, Kontrahent, Buch, Status (Indikation/Angebot/Live/Fällig/Storniert), Collateral (CSA), Upfront / Prämie ; Regulatorik (EMIR Refit): UTI, zentral gecleart → Clearing-Member ; Status Angebot → „Angebot gültig bis“ ; Blotter-Badge „Angebot“
Amortisation: Linear / Annuität / Custom / Konstant · Restschuld · Kreditzins → 10.000.000 / 9.167.091 / 8.300.865 / 7.399.990 …
Hedge (AMORT, Tilgung Linear): ✓ effektiv · 12 Summary-Zeilen · Select endfällig/Linear/Annuität/Custom · „Tilgungsplan vom Sicherungsinstrument übernehmen“
Hedge (Cap, Innerer Wert): ✓ effektiv · hypothetisches Derivat „Cap/Floor HYPO-HR-CAP-0002 · PV 120.100 EUR“ · Cost-of-Hedging-Karte · „Vol bei Designation einfrieren“
Swaption (Cash): Cash-Konvention „Collateralised Cash Price (ICE Swap Rate, Standard) / IRR (Yield-basiert, Altbestand)“
FX-Forward: „Non-Deliverable Forward“ → NDF-Fixing + Settlement-Währung · Analytics „NDF ja“ ; FX-Option: Auszahlung Vanilla/Digital (Auszahlungsbetrag USD, PV 487.152) · Barriere-Level · Rebate (USD)
Vega: FX-Fläche EURUSD · Smile (RR/BF) 8 Zeilen ; Swaption „Verfall × Tenor“ → Heatmap
Szenarien: „historische Stress-Tage (6)“ → 16 → 22 Zeilen (Lehman Okt 2008 −1.970.115 · Euro-Krise Nov 2011 · Covid März 2020 · Zinswende 2022 · SNB Jan 2015 · Brexit Jun 2016)
Kurven: Tabs €STR|EUR 6M|EUR 3M|SOFR|SONIA|SARON|TONA|EUR/USD CSA · Interpolation 5 Optionen → „EUR-ESTR monoton-konvex (Hagan–West)“ · Turn-of-Year 15 bp → Badge „Turn-of-Year 31.12.2026 +15,0 bp“ · JPY-TONA 13 Pillars
Markt: Kreditdaten (CVA) · Kontrahent-Select · + CDS-Quote → Tabelle Tenor/Spread/Hazard/Q(T) · „Hazard-Kurve: 0,5 J → 167 bp · 1,0 J → 167 bp · Recovery 40 %“
Report: Buttons Termsheet | Geeignetheitserklärung | Confirmation | Basisinformationsblatt (KID) · Confirmation-Modal (Parteien | Rahmenvertrag | Wirtschaftliche Bedingungen | Zahlungsplan | Bestätigung) · KID-Modal (9 Abschnitte, SRI)
Hilfe (?): Cross-Currency, FRA, KID, Confirmation, Portfolio-Report gelistet ; Kundenmodus: Regulatorik-Abschnitt ausgeblendet
page errors: []
```

Probe-Skripte und Screenshots (`shots-r3/01–12*.png`) im Scratchpad der Review-Session.
