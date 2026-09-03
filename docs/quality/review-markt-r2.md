# Re-Review Runde 2: Marktabdeckung Features & Module (Dimension 1, Gewicht 20 %) – DERIVA 0.2.0

**Reviewer-Rolle:** Senior Product Analyst, Treasury- und Derivateberatungssoftware (LPA Captano/Capmatix, Bloomberg SWPM/OVML/MARS, LSEG Swap Pricer/IPA, Numerix, Quantifi, FINCAD, Reval/ION, Kyriba/Coupa, SAP TRM, Murex/Calypso, ChathamDirect, FI ZWRM, QuantLib/ORE) · **Stand:** 03.09.2026, Working Tree (Core-`dist` 21:21 UTC) · **Modus:** Review only, keine Quelldatei geändert
**Baseline:** `docs/quality/review-markt.md` (Runde 1, Score 60 / 100 für Commit `2cb1571`) und `docs/quality/01-scorecard-runde-1.md`
**Geprüft (Code):** `packages/pricing-core/src/**` (index, instruments/types+builders, curves/bootstrap, market/sample-market+snapshot, risk/sensitivities+scenarios, xva/cva, hedge/hedge, reporting/valuation-report+emir+documents), `apps/api/src/**` (app, schemas, routes/pricing, risk-extended, trades, market, snapshot, audit, hedge, documents, lib/store), `apps/web/src/**` (keymap, templates, quick-parser, store, TradeEditor, Blotter, PricingWorkspace, CompareView, HedgeView, CurvesView, MarketView, ScenariosView, ReportView, DocumentsModal, CommandPalette, blotter-export, portfolio-io, scenarios), `docs/product/01–03`, `docs/architecture/02-adrs.md`, `README.md`.
**Geprüft (Laufzeit):** `npx vitest run` in allen drei Paketen → **Core 176/176, API 18/18, Web 104/104 grün**; `vite build` erfolgreich; Web-App unter `vite preview :4173` mit Playwright/Chromium durchgeklickt (Skript `e2e-markt.mjs`, Auszug Anhang B); API per `app.inject` gegen `src/app.ts` (Skript `probe-api.mjs`, Anhang A); Core-Proben gegen `dist` (`probe-core.mjs`, `probe-core2.mjs`). Alle Zahlen und Statusangaben unten stammen aus diesen Läufen, nicht aus der Dokumentation.
**Roadmap-Regel:** In `02-epics-und-user-stories.md` / README als ⏳ dokumentierte Posten (Bermudan/CMS/Range Accrual, Multi-Leg-FX-Strukturen/TARF, Marktdaten-Adapter & Kurven-Governance, OIDC/Rollen/Persistenz, Excel-Add-in, Monte-Carlo-Netting-XVA/FVA, SIMM/CRIF, VaR/Attribution, PDF-Template-Service, Batch-EoD/Webhooks, Hedge-Dokumentationsmemo, Vanna-Volga [ADR-004], Validierungs-Suite) werden **nicht** als Lücke gewertet.

---

## 1. Score

### **Marktabdeckung Features & Module: 86 / 100** (rechnerisch 85,7; Runde 1: 60)

**In einem Satz:** Von den 26 priorisierten Lücken der ersten Runde sind 17 vollständig und 7 teilweise geschlossen (2 sind dokumentierte Roadmap); DERIVA deckt damit heute den Vanilla-Zins/FX-Workstation-Scope inklusive Prozessschicht (Hedge Accounting IFRS 9/HGB, EMIR-Felder, Termsheet/Geeignetheitserklärung, Audit-Hashes, Vergleich, Kundenmodus, Par-Risk, Futures/Basis/XCCY-Bootstrapping) auf einem Niveau ab, das im Mittelstands-/Sparkassen-Segment nur LPA Capmatix plus ein externer Pricer zusammen erreichen – **übrig bleiben Lücken zweiter Ordnung: Cross-Currency-Swaps und FRAs sind nur per API/JSON anlegbar, das Hedge-Accounting-Modul kennt weder Tilgungspläne im Grundgeschäft noch Optionen als Sicherungsinstrument (beides Kern-Use-Cases der Zielpersona), Kupon-Staffeln (Step-up) fehlen im Datenmodell, der EMIR-Export trägt weder UTI noch Delta, und einige Editor-/Dokument-Bausteine (Upfront, Digital, Confirmation, PRIIPs-KID) sind noch nicht in der UI.**

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, UX-Reibung −1…−3, kosmetisch −0,2…−1; Roadmap-dokumentiert = 0):

| Bereich | R1 | R2 | Wesentliche Restlücken (Nummern → Abschnitt 3) |
|---|---:|---:|---|
| A Instrumente & Strukturen | −10 | −3,7 | CCS ohne UI-Anlage (N1 −1,5); Step-up/Kuponstaffel (N4 −1,0); FRA ohne UI-Anlage (N6 −0,5); Amortisation nur linear/manuell (N17 −0,5); JPY ohne Sample-Kurve (N18 −0,2) |
| B Kurven & Marktdaten | −5 | −0,7 | Monotone Convex, Turn-of-Year, FX-Forward-Punkte als Kurveninput (N12) |
| C Modelle | −1 | 0 | Vanna-Volga = ADR-004 v1.1; CCP-Cash-Settlement ✓; RFR-Konventionen ✓ |
| D Sensitivitäten | −2 | −0,8 | Vega-Buckets nur Swaption/Cap je Expiry, FX-Option leer trotz API-Beschreibung, eingebettete Optionen ohne Vega (N8) |
| E Szenarien / VaR | −1 | −0,5 | keine historischen Stress-Tage (N10); VaR = Roadmap |
| F XVA | −2,5 | −0,5 | CDS-Termstruktur/Survival-Bootstrap fehlt (N11); Netting/CRIF = Roadmap |
| G Hedge Accounting | −4 | −3,0 | Grundgeschäft ohne Tilgungsplan (N2 −1,5); Optionen als Sicherungsinstrument ohne hypothetischen Cap / intrinsische Designation (N3 −1,5) |
| H Regulatorik | −4 | −1,5 | EMIR: UTI/Cleared/Delta/Zeitstempel (N5 −1,0); IFRS-13-Skopierung (N9 −0,5) |
| I Dokumente | −2,5 | −1,0 | Confirmation, PRIIPs-KID nicht vorhanden und nicht als Roadmap dokumentiert (N13) |
| J Workflow / Beratung | −2,5 | −0,3 | Angebotsgültigkeit/Freigabe (N15); Vergleich ✓, Kundenmodus ✓ |
| K UI | −0,5 | −1,3 | Editor-Lücken Upfront/Digital/Rebate/NDF/Cash-Konvention/CSA (N7 −1,0); Blotter-Gruppierung/Buch (N19 −0,3) |
| L Integration | −2,5 | −0,5 | Trade-Import nur JSON (N16); Excel/Batch/Webhooks = Roadmap |
| M Admin | −2,5 | 0 | Audit-Trail ✓, Hashes ✓, Web-Persistenz ✓; Rollen/DB-Persistenz = Roadmap v1.0 |
| Sonstiges | – | −0,5 | Inflations-ZC-Swap weiterhin weder umgesetzt noch auf der Roadmap (N14) |
| **Summe** | **−40** | **−14,3** | → **85,7 ≈ 86 / 100** |

Einordnung (gleiche Skala wie R1, v1-Workstation-Scope, Einschätzung): Bloomberg SWPM+OVML+MARS ≈ 85 (kein Hedge Accounting, keine deutschen Beratungsdokumente), LPA Capmatix OTC ≈ 75 (Pricing-Kern nicht öffentlich), ORE ≈ 60 (keine UI/Prozess), Kyriba/Coupa ≈ 55. DERIVA liegt damit in der Feature-Breite erstmals auf Augenhöhe mit dem Bloomberg-Bündel und deutlich vor jedem einzelnen DACH-Wettbewerber; die Differenz zu 100 ist ein Nachmittag Datenmodell-Arbeit (CCS-Builder, Step-up, UTI, Tilgungsplan im Grundgeschäft) plus zwei größere Posten (hypothetischer Cap, Confirmation/KID).

---

## 2. Status der Runde-1-Befunde

Legende: **behoben** = im Code vorhanden **und** per Probe/UI reproduziert · **teilweise** = Kern vorhanden, benannter Rest · **offen** = unverändert · **Roadmap** = dokumentiert zurückgestellt (kein Abzug).

### 2.1 Priorisierte Gap-Liste G1–G26

| # | Befund R1 | Status | Nachweis (Datei / Probe) | Rest |
|---|---|---|---|---|
| **G1** | Amortisierende/Step-up-Nominale nicht anlegbar | **behoben** (Amortisation) | `builders.ts:241–270` `linearAmortisation`/`makeAmortisingSwap`; Editor „Amortisation“ mit Linear/Konstant/Tabelle je Periode, „auf alle Legs“ (`TradeEditor.tsx:194–295`); Hotkey `n a`, Palette `amort 10y pay 3.1% 10m`. UI: `n a` → AMORT-0001, Checkbox „Amortisierend“ aktiv, 10 editierbare Perioden; Core: Schedule 10/8/6/4/2 Mio., Float-Leg folgt (10 10 8 8 6 6 4 4 2 2) | **Step-up-Kupon** weiterhin nicht abbildbar (N4); Annuität/Tilgungsplan-Import fehlen (N17) |
| **G2** | Hedge Accounting fehlt | **behoben** | `hedge/hedge.ts` (1.019 Zeilen): `hypotheticalDerivative`, `criticalTermsMatch`, `dollarOffset`, `regressionTest`, `ifrs9Split`, `hgbSplit`, `hedgeEffectivenessReport` mit deutscher Zusammenfassung; API `POST /api/hedge/effectiveness|hypothetical`; View `g h` mit Regression-Scatter, Korridor-Balken, IFRS-9/HGB-Tabelle; 25 Tests. API-Probe IRS-0001 vs. 6M-Kredit: DO 1,016, Regression 1,016 → effektiv | Tilgungsplan im Grundgeschäft (N2); Optionen als Sicherungsinstrument (N3); Designationsmemo = Roadmap US-10.6 |
| **G3** | EMIR-Refit-Bewertungsfelder | **behoben** | `reporting/emir.ts`: Valuation amount/currency/timestamp/method MTMO, CFI-Klassifikation, Collateral-Indikator; Blotter-Button „⤓ EMIR“; `GET /api/emir/valuations?format=csv` (BOM, `;`, Dezimalkomma) – Probe 200, 10 Zeilen | UTI/Cleared/Delta (N5) |
| **G4** | Kurven-Inputs ohne Futures/Tenor-Basis/XCCY-Basis | **behoben** | `bootstrap.ts:32–77` Quote-Typen `Future` (IMM-Start, Konvexität), `BasisSwap`, `XccyBasis`; `bootstrapCurves` topologisch; Sample-Markt baut `EUR-ESTR-USDCSA` und registriert `collateralDiscountCurveId["EUR\|USD"]`; API-Bootstrap-Probe Depo/Future/Basis/Swap Residuen ≤ 4,5·10⁻¹⁶; CCS unter USD-CSA PV −596 EUR vs. −104.960 EUR ohne CSA; UI-Kurvenansicht zeigt „EUR/USD CSA“ und `Future 3M/6M` | – |
| **G5** | Par-/Quote-Sensitivität | **behoben** | `sensitivities.ts:291–339` `parRisk` (Bump je Quote, Re-Bootstrap der abhängigen Kurven); `POST /api/risk/par` (827 ms, 10Y-Swap: Swap-Kurve 7.197, €STR 123); UI-Karte „Par-Sensitivitäten (Quote-Bumps)“ auf Abruf mit Par-DV01 vs. Zero-DV01 | Laufzeit ~1 s (Quant N-D), akzeptabel als On-Demand |
| **G6** | CVA nur IRS/FX-Forward | **behoben** | `cva.ts:293–352` `cvaGeneric` (Delta-Normal mit gerollten Sensitivitäten), `cvaBasisSwap` (Basis-Swaption); Dispatch `computeXva`; Proben: Cap CVA 4.028, Swaption 1.324, FX-Swap 214/94, Basis 813/662, CCS 33.602/9.488, alle mit Methode/Warnung | Netting/Wrong-Way = ADR-016 v1.1 |
| **G7** | Termsheet / Geeignetheitserklärung / PDF-Template | **behoben** (Dokumente) | `reporting/documents.ts`: `generateTermsheet`, `generateSuitabilityStatement` (§ 64 Abs. 4 WpHG, Ex-ante-Kosten Art. 50 DelVO, BGH-Hinweis, Szenariotabelle, Snapshot-ID/Report-Hash); API `POST /api/documents/termsheet\|suitability?format=md`; UI Report → Modal mit Formular, Markdown-Download, Druck; Kundenmodus filtert Margenzeilen, behält anfänglichen Marktwert (`DocumentsModal.tsx:26–37`) | PDF = Roadmap; Confirmation/PRIIPs-KID (N13) |
| **G8** | Alternativenvergleich | **behoben** | `CompareView.tsx`: 2–4 Trades (Space im Blotter, Checkbox-Spalte, `g v`/`Alt+7`), 24 Zeilen (PV, Kennzahl, DV01, Theta, Vega, FX-Delta, Fälligkeit, Nominal, Kontrahent, P&L je Standardszenario) + Balkenchart; UI-Probe 3 Trades ✓ | Kein Cashflow-Overlay (kosmetisch, kein Abzug) |
| **G9** | Audit-Trail / Report-Hash / Snapshot-ID | **behoben** | `valuation-report.ts:86–105` `stableStringify`/FNV-1a-64 → `audit.snapshotId/inputsHash/reportHash/engineVersion`; `store.ts:153–180` `AuditLog` SHA-256-Hash-Kette mit `verify()`; `GET /api/audit` (6 Einträge nach Probe, `chainValid: true`); UI zeigt Engine/Snapshot/Hash im Report und Druckkopf | In-Memory bis Persistenz (Roadmap) |
| **G10** | CCS / Basis / OIS / FX-Swap nicht per UI anlegbar | **teilweise** | Basis ✓ (`makeBasisSwap`, `n b`, `basis 5y 3m/6m 5bp 10m`, Kennzahl „Fairer Spread 7,8 bp“); FX-Swap ✓ (`makeFxSwap`, `n x`, `fxs …`, Near/Far-Editor, Swap-Punkte 145,5); OIS ✓ (`ois 2y rec …`) | **CCS ✗**: kein `makeCrossCurrencySwap`, kein Template, Palette `ccs eurusd 5y …` liefert keinen Treffer (UI-Probe) → N1 |
| **G11** | Stub/Roll/EOM/IMM nicht editierbar | **behoben** | Editor-Abschnitt „Konventionen“ je Leg: Stub (4 Typen), BDC (4), EOM, Payment-Lag, Fixing-Lag, bei OIS Lookback/Observation-Shift, Cap/Floor eingebettet (UI-Probe); `immDate`/`nextImmDate`, `roll: "IMM"` in `buildSchedule`, `makeImmSwap` (`n i` → 16.09.2026–20.09.2028, Zahltage 17.03./15.09./15.03./20.09.) | – |
| **G12** | Embedded Cap/Floor nur intrinsisch | **behoben** | `leg-pricer.ts:211–227` Caplet/Floorlet mit Bachelier/Black aus Caplet-Fläche; Quant-R2 bestätigt Floored-Swap − Swap = Standalone-Floor | Vega dafür fehlt (N8) |
| **G13** | IFRS-13-Level hart codiert | **teilweise** | `ifrs13Level()` mit Gründen (Vol-Override, fehlende Fläche, Extrapolation, Barrier-Hinweis) | Skopierung über **alle** Kurven: 12Y-EUR-Swap → Level 3 wegen 10Y-USDCSA-Kurve (Probe) → N9 |
| **G14** | Excel-Add-in | **Roadmap** (US-7.7 v1.1, M12) | – | kein Abzug |
| **G15** | Batch/Import | **teilweise** | `POST /api/trades/import` (Validierung + Probe-Bewertung je Trade, Probe: 1 imported/1 rejected mit Grund); Blotter JSON-Export/-Import mit Umbenennung & Undo; Blotter-CSV mit Spaltenwahl (`Ctrl+Shift+E`); `GET /api/emir/valuations` als EoD-Bewertungsdatei | CSV/FpML-Import fehlt (N16); Batch-EoD/Webhooks = Roadmap US-7.8 |
| **G16** | Vega nur parallel | **teilweise** | `vegaBuckets` je Expiry für Swaption-Cube und Caplet-Fläche; `POST /api/risk/vega`; UI-Karte „Vega-Buckets“ (Swaption: 1Y 1.753 = Parallel-Vega) | FX-Option → `[]`, keine Tenor-Dimension, eingebettete Optionen ohne Vega (N8) |
| **G17** | Fixings nicht in UI pflegbar | **behoben** | `MarketView.tsx:12–91` Fixings-Editor (Index-Select, Datum, Wert, Löschen, „+ EURIBOR-6M heute“); API `PUT /api/market {fixings}`; UI-Probe 1 Zeile angelegt | – |
| **G18** | Cash-Settlement EUR IRR statt CCP | **behoben** (Core) | `types.ts:126` `cashSettlementConvention`, Default `CollateralisedCashPrice` (`swaption-pricer.ts:47`), ADR-019 | Editor ohne Auswahl (N7) |
| **G19** | RFR-Konventionen Lookback/Observation-Shift | **behoben** | `types.ts:66–69`, `leg-pricer.ts:132–145`; Editor zeigt Felder nach Index-Wechsel auf ESTR (UI-Probe) | Lockout fehlt (kosmetisch, kein Abzug) |
| **G20** | IRRBB-Set unvollständig, kein Szenario-Editor | **behoben** | `scenarios.ts:165–185` Short-Up/-Down, IRRBB-Steepener/-Flattener nach EBA-Formel (6 Schocks); `ScenariosView.tsx:15–85` Editor (Parallel, 0y/30y, EUR-FX, IR-Vol, Tage), persistiert in `localStorage`, Badge „eigen“ (UI-Probe) | – |
| **G21** | Kundenmodus | **behoben** | `Shift+K`: Chip KUNDENANSICHT, DV01-KPI/Kontrahent-Spalte/EMIR-Button ausgeblendet (UI-Probe); Dokumente filtern Margen | – |
| **G22** | Bootstrap-Residuen nicht sichtbar | **behoben** | Spalte „Residuum“ in der Quote-Tabelle (bp bzw. ×10⁻⁶), Pillar-Datum je Quote (UI-Probe) | – |
| **G23** | Interpolation nicht wählbar, Monotone Convex fehlt | **teilweise** | Select mit 4 Methoden je Kurve, Re-Bootstrap live (UI-Probe „kubischer Spline (Zero)“) | Monotone Convex (Hagan/West) fehlt (N12) |
| **G24** | Rollen/Rechte/Persistenz | **teilweise / Roadmap** | Web: `zustand/persist` (`deriva.v1`: Trades, Quotes, Stichtag, Ansicht, Kundenmodus, Hedge-Beziehungen); API: Store-Interfaces, In-Memory (ADR-006/018) | Auth/DB = US-7.6 v1.0, kein Abzug |
| **G25** | Trade-Status/Lifecycle | **behoben** | `TradeBase.status` Indication/Live/Matured/Cancelled, Editor-Select, Blotter-Badge, Filter „Indikationen ausblenden“, KPI je Status im Kundenmodus | „Quoted/gültig bis“, Freigabe (N15) |
| **G26** | Bermudan/CMS/TARF/Vanna-Volga/Netting/VaR/CRIF/Inflation | **Roadmap** (bis auf Inflation) | `02-epics` US-3.11/3.12/4.4/4.5/5.6, ADR-004/016 | Inflation weiterhin nicht auf der Roadmap (N14) |

### 2.2 Quick-Win-Liste R1 (16 Positionen)

Alle 16 Quick Wins sind umgesetzt (EMIR-Export, IFRS-13-Heuristik, IRRBB-Set, Portfolio-CSV, Templates `n b/n a/n i/n x`, Palette `basis/amort/fxs`, Konventionen-Felder, Report-Hash/Snapshot-ID, Fixings-Editor, Kundenmodus, Vega je Expiry, CCP-Cash-Settlement, Interpolations-Select, Residuen-Spalte, Status-Feld, lineare Amortisation). Von den „größeren Posten“ fehlen nur Excel-Add-in (Roadmap) und Monotone Convex.

---

## 3. Neue Befunde (Runde 2)

Severity: **Mittel** = Kernfeature für eine v1-Persona fehlt bzw. nur über API/JSON erreichbar · **Niedrig** = Reibung/Lücke zweiter Ordnung · **Kosmetisch** = Doku/Konsistenz.

| # | Sev. (Abzug) | Ort | Befund (reproduziert) | Fix |
|---|---|---|---|---|
| **N1** | Mittel (−1,5) | `builders.ts` (kein `makeCrossCurrencySwap`), `templates.ts:19` (9 Templates, kein CCS), `quick-parser.ts:95–264` (Befehle `basis/fxs/irs/ois/amort/cap/floor/collar/swpt/fxf/fxo`), `keymap.ts:61–69`, `TradeEditor.tsx:319–401` | **Cross-Currency-Swap (US-3.8 ✅) ist in der Workstation nicht anlegbar.** Palette `ccs eurusd 5y pay 3.2% 10m` → „Keine Treffer“, kein Hotkey, kein Template, kein Sample-Trade. Der Editor kann einen importierten CCS bearbeiten, bietet aber weder Nominalaustausch (`notionalExchange`) noch MtM-Reset (`mtmReset`) an – die zwei Merkmale, die einen CCS ausmachen. Für einen Treasurer mit USD-Finanzierung (Kernfall bei Bloomberg SWPM, LSEG IPA, Chatham) ist das Produkt damit nur per API nutzbar. | `makeCrossCurrencySwap({pair, domesticNotional, fxSpot, domesticIndex, foreignIndex, spread, maturity, mtmReset?, collateralCurrency})` analog `makeBasisSwap`; Template `ccs` + Hotkey `n z`; Palette `ccs eurusd 5y -20bp 10m [mtm]`; Editor: Checkboxen „Nominalaustausch Start/Ende“, „MtM-Reset auf Leg n“; Sample-Trade `CCS-0001`; Kennzahl „Fairer Basis-Spread“ ist bereits vorhanden (`analytics.fairSpread`). |
| **N2** | Mittel (−1,5) | `hedge/hedge.ts:57–76` (`HedgedItem` ohne Nominalverlauf), `:398–429` (`hypotheticalDerivative` → `makeVanillaSwap` konstant) | **Tilgungsdarlehen können nicht als Grundgeschäft dokumentiert werden.** Probe: 10Y-Amortisationsswap (10 → 0 Mio. linear) gegen `FloatingRateLoan` 10 Mio. → hypothetisches Derivat bullet, prospektiver Dollar-Offset **0,58**, Regressionssteigung 0,57 → „nicht effektiv“, obwohl Critical Terms 5/5 „erfüllt“ melden (Nominal-Check vergleicht nur Startnominal). UI reproduziert (`n a`, dann `g h` → „✗ nicht effektiv“). Der Kern-Use-Case des Mittelstands (Tilgungskredit + amortisierender Swap, Kyriba/Chatham Standard) scheitert damit im HA-Modul. | `HedgedItem.notionalSchedule?: {date, notional}[]` (oder `amortisation: {type: "Linear"\|"Annuity"\|"Custom", finalNotional?, schedule?}`); `hypotheticalDerivative` überträgt den Plan auf beide Legs (`linearAmortisation` existiert); Critical-Terms-Check vergleicht den Nominalverlauf periodenweise (Toleranz 1 %); HedgeView: Button „Tilgungsplan vom Sicherungsinstrument übernehmen“ + editierbare Tabelle wie im Trade-Editor. Test: Amortisationsswap vs. amortisierendes Darlehen → Ratio 1,00. |
| **N3** | Mittel (−1,5) | `hedge/hedge.ts:417–428` (hypothetisches Derivat immer Swap/Forward), `:294–336` (`instrumentTerms` für CapFloor/FxOption ohne Optionalität) | **Optionen als Sicherungsinstrument werden gegen ein lineares hypothetisches Derivat gemessen.** Probe: 5Y-Cap 3 % gegen 6M-Kredit → hypothetischer Payer-Swap, Dollar-Offset **0,47**, Steigung 0,35 → „nicht effektiv“; gleiches Muster für FX-Optionen (hypothetischer Forward). IFRS 9 6.5.15/B6.5.29 und IDW RS HFA 35 Tz. 60 verlangen bei Optionen die Designation des inneren Werts bzw. ein hypothetisches **Cap/Option** mit denselben kritischen Ausstattungsmerkmalen (Strike = Cap-Strike, einseitiges Risiko); Zeitwert als „cost of hedging“ in OCI. Caps sind das zweithäufigste Absicherungsinstrument im Segment (Sparkassen-Beratung, Captano „Cap vs. Swap“). | `hypotheticalDerivative`: bei `CapFloor`-Instrument → `makeCapFloor` mit Grundgeschäfts-Terms, Strike des Instruments, `volOverride` = Marktvol bei Designation; bei `FxOption` → hypothetische Option gleicher Strike; Option `designation: "IntrinsicValue" \| "FullFairValue"` in `HedgeRelationship`, bei intrinsisch ΔPV über `analytics.intrinsic` (oder Δ(max(F−K,0)·Annuität)); Zeitwert-Änderung separat als `costOfHedging` (OCI-Rücklage 6.5.15). Test: Cap vs. identischer hypothetischer Cap → Ratio 1,00; Cap vs. Kredit intrinsisch → Regression über Szenarien ±200bp. |
| **N4** | Mittel (−1,0) | `types.ts:48–51` (`FixedLeg.rate: number`), `:53–70` (`FloatLeg.spread: number`), `leg-pricer.ts` | **Kupon-Staffeln (Step-up/Step-down, Spread-Staffel) sind nicht abbildbar** – das Datenmodell kennt nur einen Festsatz bzw. Spread je Leg; `grep rateSchedule|stepUp` liefert keinen Treffer. Step-up-Swaps (Forward-Start mit steigendem Kupon, „Zinstreppe“) sind Standardangebot der Sparkassen-/Landesbank-Beratung und in SWPM/IPA/Quantifi als „Custom coupon schedule“ Standard; Runde 1 hatte „Amortisation/Step-up“ als ein Kernfeature gefasst, nur die Amortisation wurde umgesetzt. | `FixedLeg.rateSchedule?: {date, rate}[]` und `FloatLeg.spreadSchedule?: {date, spread}[]` mit derselben „letzter Eintrag ≤ Periodenstart“-Regel wie `notionalSchedule`; `leg-pricer` liest Satz/Spread je Periode; Editor: Tabelle „Kuponverlauf“ neben der Amortisationstabelle, Palette-Token `step 2.5/3.0/3.5`; Par-Solver hält die Differenzen konstant und löst den Basissatz. |
| **N5** | Mittel (−1,0) | `emir.ts:13–49`, `types.ts:10–25` (`TradeBase` ohne `uti`/`cleared`), `Blotter.tsx:371–380` | **EMIR-Export ist ohne Nacharbeit nicht meldefähig:** (a) `uti` ist nur ein Aufruf-Parameter, nicht Teil des Trades → Spalte UTI im CSV **immer leer** (Probe); (b) `delta` bleibt `undefined`, obwohl `analytics.delta` für Swaption/Cap/FX-Option vorliegt (Probe Swaption, Cap) – Feld 2.26 ist für Optionen Pflicht; (c) kein `cleared`/`clearingObligation`-Kennzeichen (EMIR 3 Art. 4a, Schwellenmonitoring) → Collateral-Indikator ist die einzige Ableitung; (d) Zeitstempel fix `T17:00:00Z` statt Snapshot-Zeit/EoD-Konvention des Meldenden. | `TradeBase.uti?: string; cleared?: boolean; clearingMember?: string`; Editor-Felder unter „Regulatorik“; `emirValuationRecord` setzt `delta` aus `analytics.delta` (Option) bzw. 1/−1 (linear) und `valuationTimestamp` aus `ctx.meta.asOf ?? EoD`; Spalten „Cleared“, „Clearing obligation“; Blotter-Filter „ohne UTI“. |
| **N6** | Niedrig (−0,5) | `quick-parser.ts`, `templates.ts`, `keymap.ts` | **FRA (US-3.2 ✅) ist in der UI nicht anlegbar** – kein Template, kein Hotkey, kein Palette-Befehl (`fra 3x6 pay 2.2% 10m`); Editor und Blotter-Filter „Zins“ unterstützen FRAs, sie kommen aber nur per JSON-Import hinein. | `makeFra({currency, notional, payReceive, start, end, rate, index})`; Palette `fra 3x6 pay 2.2 10m`; Template `n r` (oder `n f` mit Untermenü). |
| **N7** | Niedrig (−1,0) | `TradeEditor.tsx` (kein `upfront`, `digital`, `barrier.rebate`, `ndf`, `cashSettlementConvention`; `collateralCurrency` nur für Swaps, Zeile 345) | **Datenmodell-Features ohne Editor:** Upfront/Prämie (US-3.10 ✅, `TradeBase.upfront`), digitale FX-Option (`FxOption.digital`), Barrier-Rebate, NDF-Fixing/Settlement-Währung (`FxForward.ndf`), Cash-Settlement-Konvention der Swaption (`CollateralisedCashPrice`/`IRR`), Collateral-Währung für FX/Optionen/FRA. Alles ist per API bewertbar (Probe NDF PV 727, `ndf: "yes"`), in der Workstation aber nicht eingebbar – Bloomberg OVML/SWPM haben jedes dieser Felder. | Abschnitt „Prämie/Upfront“ (Betrag, Währung, Datum) im `common`-Block; FX-Option: Select „Auszahlung: Vanilla/Digital (Cash/Asset)“, Feld „Rebate“; FX-Forward: Checkbox „NDF“ mit Fixing-Datum und Settlement-Währung; Swaption: Select „Cash-Konvention“; CSA-Select in allen Editoren. |
| **N8** | Niedrig (−0,8) | `sensitivities.ts:382–411` (`vegaBuckets` nur Swaption/CapFloor, Zeilen = Expiry), `:150–178` (`computeRisk.vega` nur drei Typen), `risk-extended.ts:45` (Summary verspricht „FX-Fläche“) | (a) `vegaBuckets(FxOption)` → `[]` in Core und API, obwohl die OpenAPI-Summary „Vega-Buckets je Expiry (Swaption-Cube, Caplet-Fläche, **FX-Fläche**)“ zusagt; (b) Buckets nur je Expiry, nicht Expiry × Tenor (Bloomberg/ORE-Standard); (c) Swap mit eingebettetem Floor: PV −99.595, aber `vega = {}`, `vegaBuckets = []` (Quant R2-2, hier als Feature-Lücke gezählt). | FX: je Expiry ATM-Zeile der `FxVolSurface` bumpen (Vanna/Volga-Proxy über RR/BF-Bumps); Swaption: zweite Dimension Tenor (Option `granularity`); Feature-Erkennung `hasEmbeddedOption(trade)` statt Trade-Typ; Summary korrigieren. |
| **N9** | Niedrig (−0,5) | `valuation-report.ts:64–84` | IFRS-13-Level prüft Extrapolation gegen **alle** Kurven im Kontext: 12Y-EUR-Swap → **Level 3** „Laufzeit über letzten Pillar der Kurve EUR-ESTR-USDCSA“ (Probe), obwohl die USD-CSA-Kurve für einen unbesicherten EUR-Swap irrelevant ist. Für die Hierarchie-Offenlegung (IFRS 13.93) wandern dadurch alle EUR-Swaps > 10Y fälschlich in Level 3 (Querverweis Quant R2-3). | Nur `relevantCurveIds` + Collateral-Kurve des Trades prüfen; `tradeMaturityDate` typübergreifend (existiert in `cva.ts:366`). |
| **N10** | Niedrig (−0,5) | `scenarios.ts:149–191`, `ScenariosView.tsx` | Keine historischen Stress-Tage (z. B. 2008-10, 2020-03, 2022-Zinswende) – in `docs/research/03-domaene…md:115` als Bestandteil der Szenarioanalyse genannt, nicht auf der Roadmap; Bloomberg MARS, Numerix, Quantifi, ORE liefern sie standardmäßig. | Statische Szenario-Definitionen (Tenor-Vektoren Zins, FX %, Vol) für 4–6 Referenztage als `HISTORICAL_SCENARIOS` mit Quelle/Datum im Namen; Schalter „historisch“ in der Szenarioansicht; später aus Marktdaten-Historie (US-2.10). |
| **N11** | Niedrig (−0,5) | `cva.ts:38–50` (`CreditInputs` flache Hazard), `MarketView.tsx` Kreditdaten-Karte | Kein CDS-Term-Structure-Bootstrap (Survival-Kurve aus 1Y/3Y/5Y/10Y-Spreads); Hazard ist flach je Kontrahent. Für IFRS-13-CVA von 10Y+-Swaps gegenüber Kontrahenten mit steiler CDS-Kurve systematische Abweichung; Bloomberg/Numerix/Quantifi/ORE Standard. | `bootstrapHazard(spreads: {tenor, spread}[], recovery)` (stückweise konstante Hazard, Standard-CDS-Prämienleg-Näherung); `marginalPd` aus Survival-Kurve; Kreditdaten-Karte editierbar mit Termstruktur. |
| **N12** | Niedrig (−0,7) | `interpolation.ts:1–6` (5 Methoden), `bootstrap.ts` (kein Turn-of-Year, keine FX-Punkte) | (a) Monotone Convex (Hagan/West) fehlt weiterhin – Standard für glatte Forwards bei Bloomberg/QuantLib; (b) kein Turn-of-Year-Jump; (c) FX-Forward-Punkte als Kurveninput (Short-End der Collateral-Kurve aus FX-Swaps, bei LSEG/BBG/ORE Standard) fehlen – nur XCCY-Basis-Swaps. | `monotoneConvex` als sechste `InterpolationMethod`; `CurveQuote {type:"FxSwapPoints", tenor, points, pair}` für das kurze Ende der Collateral-Kurve; `turnOfYear?: {date, bp}` im `BootstrapSpec`. |
| **N13** | Niedrig (−1,0) | `documents.ts` (2 Dokumenttypen), `01-vision:79` („Workflow/Signatur ⏳“ – Dokumente selbst nicht genannt) | **Confirmation (Geschäftsbestätigung unter DRV/ISDA) und PRIIPs-KID fehlen** und sind nicht als Roadmap dokumentiert; LPA Capmatix (Confirmations, KIDs >800.000/Tag laut `02-wettbewerber.md:89`) und FI ZWRM erzeugen sie im Prozess; für Privatkunden ist das KID Pflicht (`03-domaene…md:46`). Das Datenmodell (`termsRows`, `describe`, Szenarien) reicht für beide aus. | `generateConfirmation(trade, parties, masterAgreement)` aus `termsRows` + Rahmenvertragsverweis + Zahlungsplan; `generateKid(trade, scenarios)` mit Performance-Szenarien (ungünstig/moderat/günstig/Stress aus `runScenarios`), Kosten aus `costTransparency`, Risikoindikator (SRI-Klasse aus Vol) – oder explizit als Roadmap v1.1 in `02-epics` aufnehmen. |
| **N14** | Niedrig (−0,5) | Roadmap (`02-epics`, `01-vision` Abschnitt 4) | Inflations-ZC-Swap weiterhin weder umgesetzt noch aufgenommen; `03-domaene…md:35` nennt Inflationsswaps für Versicherer/Pensionskassen als Zielsegment. Bloomberg/LSEG/Numerix/QuantLib decken ihn ab. | Roadmap-Eintrag US-3.15 (HICPxT-Kurve, ZC-Inflationsswap, Saisonalität optional) oder explizite Abgrenzung in `01-vision` Abschnitt 4. |
| **N15** | Niedrig (−0,3) | `types.ts:24` (`status` 4 Werte), `Blotter.tsx` | Indikationen tragen keine Gültigkeit (`quoteValidUntil`) und keinen Zustand „Angebot/Quoted“ oder „freigegeben“; Vier-Augen-Freigabe ist als „Workflow/Signatur ⏳“ dokumentiert, die Angebotsgültigkeit nicht. | `status: … \| "Quoted"`, `quoteValidUntil?: SerialDate`; Blotter-Badge „abgelaufen“, Palette `gültig 2h`. |
| **N16** | Niedrig (−0,5) | `portfolio-io.ts`, `trades.ts:88–114` | Trade-Import nur als DERIVA-JSON (UI und API); kein CSV mit Spaltenmapping (Bestandsmigration aus TMS/Excel), kein FpML. Batch-EoD/Webhooks sind Roadmap (US-7.8), CSV-Import nicht. | `tradesFromCsv(text, mapping)` mit Vorlage pro Typ (IRS/FXF/CAP); Blotter „Import CSV“; API `POST /api/trades/import` mit `content-type: text/csv`. |
| **N17** | Niedrig (−0,5) | `TradeEditor.tsx:194–295`, `builders.ts:241` | Amortisation nur linear (auf 0) oder manuell je Periode; keine Annuität (konstante Rate → Tilgungsplan aus Kreditzins), keine Ziel-Restschuld im Editor (`finalNotional` nur im Builder), kein Tilgungsplan-Import/Paste (Bloomberg: Excel-Import). | Select „Linear / Annuität / Custom“, Felder „Restschuld“, „Kreditzins“; Paste-Handler für zweispaltige Tabellen (Datum;Nominal) in die Amortisationstabelle. |
| **N18** | Niedrig (−0,2) | `index-definitions.ts:55–57,100` (TONA/JPY definiert), `sample-market.ts` (keine JPY-Kurve), `quick-parser.ts:149` (`jpy` akzeptiert) | Palette akzeptiert `irs jpy 5y pay 1% 1000m`, Bewertung scheitert „No discount curve configured for JPY“ (Probe); EURJPY/USDJPY-Spots liegen vor, JPY-Trades sind aber nicht bewertbar. | JPY-TONA-OIS-Quotes in `SAMPLE_QUOTES` + `discountCurveId.JPY`, oder `jpy` aus dem Parser nehmen. |
| **N19** | Niedrig (−0,3) | `Blotter.tsx`, `TradeEditor.tsx` (`common`) | Keine Gruppierung/Zwischensummen nach Kontrahent oder Buch; `TradeBase.book` existiert, ist aber in Editor, Blotter und Export nicht sichtbar (Bloomberg/TMS: Buch-/Portfolio-Hierarchie). | Feld „Buch“ im `common`-Block, Blotter-Spalte + „Gruppieren nach“ (Kontrahent/Buch/Typ) mit Zwischensummen PV/DV01. |

**Ohne Abzug, aber dokumentierenswert:**
- `/api/risk/par` und die UI-Karte laufen ~0,8–1,0 s je Trade (Re-Bootstrap je Quote); als On-Demand korrekt gekapselt, für Portfolio-Par-Risk (Blotter) wäre ein Jacobian nötig (Quant N-D).
- Hedge-View: „Designationsmarkt simulieren“ baut den Sample-Markt am Designationsdatum – korrekt gekennzeichnet; echte Historie folgt mit US-2.10.
- `01-vision:75` nennt „PDF-Template v1.0“, `02-epics US-6.4` „v1.1“ – Inkonsistenz (Dimension 6).
- E2E-Smoke-Test (`apps/web/e2e/smoke.mjs`) ist in der CI verdrahtet (`ci.yml:35–45`).

---

## 4. Feature-Matrix – Statusänderungen gegenüber Runde 1 (nur DERIVA-Spalte)

| Feature (R1-Zeile) | R1 | R2 | Beleg |
|---|---|---|---|
| Basis-Swap per UI anlegen | ❌ UI | ✅ | `n b`, Palette `basis`, Kennzahl „Fairer Spread“ |
| Amortisierende Swaps (Builder + Editor) | 🔶 | ✅ (linear/custom) | `makeAmortisingSwap`, Amortisations-Editor |
| IMM / Stub / Roll / EOM in UI | 🔶 | ✅ | Konventionen-Abschnitt, `n i` |
| Embedded Cap/Floor mit Optionswert | 🔶 | ✅ | `leg-pricer.ts:211–227` |
| FX-Swap-Editor | ❌ | ✅ | Near/Far-Leg-Editor, `n x` |
| CCS per UI anlegbar | ❌ | ❌ | N1 |
| FRA per UI anlegbar | (nicht bewertet) | ❌ | N6 |
| Step-up-Kupon | ❌ | ❌ | N4 |
| STIR-Futures / Tenor-Basis / XCCY-Basis als Kurveninput | ❌ | ✅ | `CurveQuote` Future/BasisSwap/XccyBasis; Kurve `EUR-ESTR-USDCSA` |
| Interpolation wählbar (UI) | ❌ | ✅ | Select in Kurvenansicht |
| Monotone Convex / Turn-of-Year / FX-Punkte | ❌ | ❌ | N12 |
| Bootstrap-Residuen sichtbar | 🔶 | ✅ | Spalte „Residuum“ |
| Fixings in UI pflegbar | ❌ | ✅ | Fixings-Editor |
| RFR Lookback / Observation Shift | ❌ | ✅ | Typen + Editor |
| Cash-Settlement Collateralised Cash Price | ❌ | ✅ Core / ❌ Editor | ADR-019; N7 |
| Par-/Quote-Sensitivität | ❌ | ✅ | `parRisk`, `/api/risk/par`, UI-Karte |
| Vega-Buckets | ❌ | 🔶 (Expiry, IR nur) | N8 |
| EBA-IRRBB 6 Schocks | 🔶 | ✅ | `STANDARD_SCENARIOS` 16 Einträge |
| Eigene Szenarien (UI) | ❌ | ✅ | Szenario-Editor, persistiert |
| Historische Stress-Tage | ❌ | ❌ | N10 |
| CVA/DVA alle Instrumente | ❌ | ✅ (Delta-Normal gekennzeichnet) | `cvaGeneric`, `cvaBasisSwap` |
| CDS-Termstruktur | ❌ | ❌ | N11 |
| Hedge-Beziehung / hypothetisches Derivat / Effektivitätstests / HGB § 254 | ❌ | ✅ (Bullet-Swap, Forward) | `hedge.ts`, HedgeView, API; N2/N3 |
| EMIR-Refit-Bewertungsfelder | ❌ | ✅ (ohne UTI/Delta) | `emir.ts`; N5 |
| IFRS-13-Level mit Begründung | 🔶 | 🔶 (Skopierung) | N9 |
| Termsheet / Geeignetheitserklärung | ❌ | ✅ (JSON/MD/Druck) | `documents.ts`, Modal, API |
| Confirmation / PRIIPs-KID | ❌ | ❌ | N13 |
| Alternativenvergleich | ❌ | ✅ | CompareView |
| Kundenmodus | ❌ | ✅ | `Shift+K` |
| Trade-Status | ❌ | ✅ | Status-Badge/Filter |
| Portfolio-Export CSV / JSON-Import | ❌ | ✅ | Blotter-Toolbar |
| Blotter Multi-Select / Spaltenkonfiguration | ❌ | ✅ | Checkbox-Spalte, „▦ Spalten“ |
| Blotter Gruppierung | ❌ | ❌ | N19 |
| Audit-Trail / Report-Hash / Snapshot-ID | ❌ | ✅ | `AuditLog`, `report.audit` |
| Markt-Snapshot Export/Import (versioniert) | (neu) | ✅ | `deriva.market/1`, UI + API |
| Batch-Import (API) | 🔶 | ✅ JSON | `/api/trades/import` |
| Persistenz Web | ❌ | ✅ | `zustand/persist` |
| Excel / Live-Marktdaten / Rollen / Netting-CVA / VaR / CRIF / Bermudan / TARF | ❌ (R) | ⏳ Roadmap | kein Abzug |

---

## 5. Verifizierte Positivbefunde (Auszug, alle reproduziert)

- **Multi-Curve-Bootstrap mit sieben Kurven** inkl. Futures (IMM-Start, Konvexität), Tenor-Basis und XCCY-Basis, topologisch geordnet; Residuen auf der finalen Kurve ≤ 1,7·10⁻¹⁵; USD-CSA-Diskontierung wirkt auf CCS (PV −596 vs. −104.960 EUR). Das ist LSEG-Curve-Builder-/ORE-Niveau und im DACH-Mittelstandssegment ohne Gegenstück.
- **Par-Risk je Marktquote** (`Swap 10Y` 7.197 von 7.321 total) mit Re-Bootstrap der Abhängigkeiten – Händler-/IPV-Sicht, die Kyriba/Coupa/LPA nicht bieten.
- **Hedge Accounting IFRS 9 + HGB § 254** in einem Modul mit deutscher Zusammenfassung, Korridor-Visualisierung, Regression-Scatter, OCI/GuV-Split, Einfrierungs-/Durchbuchungsmethode und Drohverlustrückstellung; Warnungen zu Off-Market-Derivaten und Hedge-Ratio-Konsistenz (B6.4.9–B6.4.11). Nur Chatham/Kyriba haben Vergleichbares, keiner davon HGB.
- **Beratungsdokumente** (Termsheet, Geeignetheitserklärung mit Ex-ante-Kosten, BGH-Hinweis, Szenariotabelle, Snapshot-ID/Report-Hash) aus demselben Bewertungskern, Kundenmodus-Filter mit Pflichtangabe „anfänglicher Marktwert“ – LPA-Kernnutzen, hier mit eigenem Pricing.
- **Prüfungsfähigkeit:** Report-Erzeugung mit festem Zeitstempel, Engine-Version, Snapshot-/Inputs-/Report-Hash, What-if-Kennzeichnung „nicht prüfungsfähig“, SHA-256-Hash-Kette im API-Audit, versionierter Markt-Snapshot (`deriva.market/1`) mit Validierung – MaRisk/IDW-RS-HFA-35-tauglich.
- **Workstation-Vollständigkeit:** 9 Templates, 11 Palette-Grammatiken inkl. `@Kontrahent` und `stichtag`, Vergleich, Kundenmodus, Szenario-Editor, Fixings-Editor, Interpolations-Wahl, Spaltenkonfiguration, Undo, Persistenz; keine `pageerror` im E2E-Lauf; alle 8 Ansichten per Chord erreichbar.
- **API-Abdeckung:** 27 Routen im OpenAPI (Price/Portfolio/Risk/Par/Vega/Scenarios/Grid/XVA/Report/Documents/Hedge/EMIR/Audit/Snapshot/Trades inkl. Import/Market/Bootstrap/Health), JSON-Schema-validiert, ETags, deutsches CSV mit BOM.

---

## 6. Was für 100 noch fehlt

1. **N1 CCS-Builder + Template + Palette + Editor-Schalter (Nominalaustausch/MtM-Reset)** – der letzte v1-Instrumententyp ohne UI-Anlage.
2. **N2 Tilgungsplan im Grundgeschäft** (`HedgedItem.notionalSchedule`) und periodenweiser Critical-Terms-Check – sonst scheitert der Kern-Use-Case „Tilgungsdarlehen + Amortisationsswap“ im HA-Modul.
3. **N3 Hypothetischer Cap / intrinsische Designation** für Optionen als Sicherungsinstrument (IFRS 9 6.5.15, IDW RS HFA 35 Tz. 60) inkl. Cost-of-Hedging.
4. **N4 Kupon-/Spread-Staffeln** (`rateSchedule`, `spreadSchedule`) für Step-up-Swaps.
5. **N5 EMIR-Vollständigkeit:** UTI und Cleared-Flag im Trade, Delta aus `analytics`, Zeitstempel aus Snapshot.
6. **N7/N6 Editor-Vervollständigung:** Upfront/Prämie, Digital, Rebate, NDF, Cash-Konvention, CSA überall; FRA-Template/Palette.
7. **N8 Vega:** FX-Buckets (Summary korrigieren), Expiry × Tenor, eingebettete Optionen.
8. **N13 Confirmation und PRIIPs-KID** als dritter/vierter Dokumenttyp – oder explizite Roadmap-Aufnahme.
9. **N9–N12, N14–N19:** IFRS-13-Skopierung, historische Stress-Tage, CDS-Termstruktur, Monotone Convex/Turn-of-Year/FX-Punkte, Inflations-Roadmap, Angebotsgültigkeit, CSV-Import, Annuitäts-Amortisation, JPY-Kurve, Buch/Gruppierung.

Mit 1–7 (geschätzt 1,5–2 Arbeitstage inkl. Tests) läge die Dimension bei ≈ 95; Confirmation/KID und die Restpunkte 9 schließen die Lücke zu 100 für den v1-Scope.

---

## Anhang A – API-Probe (`app.inject` gegen `apps/api/src/app.ts`, Auszug)

```
openapi paths: 27 Routen (health, health/ready, market, market/curves, market/curves/{id}, market/vols, market/bootstrap, price, price/portfolio, risk, risk/par, risk/vega, scenarios, scenarios/standard, scenarios/grid, xva, report, trades, trades/{id}, trades/import, market/snapshot, emir/valuations, audit, hedge/effectiveness, hedge/hypothetical, documents/termsheet, documents/suitability)
emir csv: UTI;Trade ID;Counterparty;Product classification;Notional;…;Delta;Collateral portfolio indicator
          ;IRS-0001;CPTY-A;SRCCSP;10000000,00;EUR;-278343,74;EUR;2026-09-03T17:00:00Z;MTMO;;FALSE   ← UTI und Delta leer (N5)
emir swaption: HRSAVP, valuationAmount 99961.34, delta: undefined
snapshot: 7 Kurven inkl. EUR-ESTR-USDCSA; PUT roundtrip imported:true
par risk IRS-0001 (827 ms): total 7.321 – EUR-ESTR 123 (18 Quotes), EUR-EURIBOR-6M 7.197 (17), EUR-EURIBOR-3M 0 (14), USDCSA 0 (5)
vega swaption: EUR 11 Buckets, total 1.753 ; vega fxo: []   ← N8
xva cap: CVA 4.028 (Delta-normal, Warnung „Näherungsverfahren“) ; xva ccs: CVA 33.602 / DVA 9.488
price ccs (USD-CSA): PV −595,58, fairSpread −21,9 bp, mtmReset "no"
price ndf: PV 727,43, ndf "yes"
hedge IRS-0001 vs 6M-Kredit: effective true, DO 1,0158, Regression 1,0156, 1 Warnung (kein Designationsmarkt)
termsheet md: „# Indikatives Termsheet – Payer-Zinsswap (EUR)“ … Konditionen-Tabelle
suitability: 7 Abschnitte; Kostenausweis: FV −278.344, Transaktionspreis 50.000, anfänglicher Marktwert −328.344, Marge 328,3 bp
report: Level 2, audit {snapshotId aec3c879…, inputsHash c6f1e599…, reportHash 020536c5…, engine deriva-pricing-core/0.2.0}
import: 2 Trades → 1 imported (PV −278.344, MISSING_FIXING-Hinweis), 1 rejected („terminationDate must be after effectiveDate“)
bootstrap Depo/Future/Basis/Swap: Residuen 9,7e-17 / −4,5e-16 / 2,9e-16 / −8,7e-17
audit nach Probe: 6 Einträge, chainValid true
```

## Anhang B – UI-Probe (Playwright/Chromium gegen `vite preview :4173`, Auszug)

```
Blotter: 11 Trades; Toolbar: Alle|Zins|FX|Optionen|Indikationen ausblenden|▦ Spalten|⤓ CSV|⤓ JSON|⤒ Import|⤓ EMIR
n b → BASIS-0001, Kennzahl „Fairer Spread“ 7,8 bp
n a → AMORT-0001, Par 2,7167 %, Checkbox „Amortisierend“ aktiv, 10 Perioden editierbar, Buttons Linear/Konstant
n i → IRS-0003 (IMM) 2026-09-16 → 2028-09-20
n x → FXS-0001, Swap-Punkte 145,5, Editor „Near Leg (Kassa)“ / „Far Leg (Termin)“
Konventionen: Stub, BDC, EOM, Payment-Lag, Fixing-Lag, Cap/Floor (eingebettet); nach Index → ESTR: Lookback + Observation-Shift sichtbar
Palette „ccs eurusd 5y pay 3.2% 10m“: kein Treffer (N1) ; „fxs eurusd 1m 1.1625 1.18 1y @Landesbank“: Trade-Vorschau ✓
Vergleich: 3 Trades, 24 Zeilen (PV … P&L Roll +1M)
Hedge (g h) auf AMORT-0001: „✗ nicht effektiv“, Regression-Karte, DO prospektiv/kumulativ, 12 Summary-Zeilen (N2)
Shift+K: Chip KUNDENANSICHT 1, DV01-KPI 0, EMIR-Button 0, Kontrahent-Spalte 0 → zurück: EMIR-Button 1
Kurven: €STR|EUR 6M|EUR 3M|SOFR|SONIA|SARON|EUR/USD CSA; Interpolation 4 Optionen, Wechsel auf kubischer Spline ✓; Spalten Instrument|Pillar|Quote|Zero|DF|Residuum; EUR 3M: Depo, Future 3M, Future 6M, FRA 3x6 … ; Xccy 1Y…10Y vs USD
Markt: Fixings-Editor, „+ EURIBOR-6M heute“ → 1 Zeile; Snapshot exportieren/importieren
Szenarien: 16 Standard (inkl. 4 IRRBB) + Editor → Badge „eigen“
Report: Report erzeugen → Engine deriva-pricing-core/0.2.0 · Snapshot cb30a713… · Report-Hash 6e72cf31… · Inputs 5d17a287…; IFRS 13 Level 2; Kostentabelle
Termsheet-Modal: Konditionen | Indikative Bewertung | Funktionsweise | Wesentliche Risiken | Marktdaten und Methodik
Geeignetheitserklärung: 7 Abschnitte inkl. Kostenausweis und Szenariotabelle
Pricing SWPT-0001: Vega-Buckets-Karte ✓, Par-Sensitivitäten berechnet (Par-DV01 | Zero-DV01 | Differenz)
Spaltenwahl: ID, Typ, Bezeichnung, Kontrahent, Nominal, Fälligkeit, PV, DV01, Status, Bewertung ; Status-Badges Indikation/Live ; JSON-Import-Input ✓
page errors: []
```

Probe-Skripte: `probe-api.mjs`, `probe-core.mjs`, `probe-core2.mjs`, `e2e-markt.mjs` (Scratchpad; Screenshots `shots/*.png`).
