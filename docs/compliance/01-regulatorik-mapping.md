# DERIVA – Regulatorik-Mapping (Anforderung → Feature → Evidenz → Status)

**Zweck.** Dieses Dokument ordnet die regulatorischen und rechnungslegungsbezogenen Anforderungen, die ein Bewertungstool für Zins- und Währungsderivate im DACH-Markt berührt, den konkreten DERIVA-Features zu und benennt je Anforderung die **Evidenz im Repository** (Datei, Test, Endpunkt). Es ist die Arbeitsgrundlage für Prüfer (WP, Revision), Marktfolge/IPV und Modellvalidierung – und es benennt am Ende explizit, was **nicht** abgedeckt ist.

**Stand:** v0.2 (Arbeitskopie 2026-09-03). Fachliche Herleitung der Anforderungen: [`docs/research/03-domaene-markt-methodik-regulatorik.md`](../research/03-domaene-markt-methodik-regulatorik.md) §4. Architektur: [`docs/architecture/01-architektur.md`](../architecture/01-architektur.md).

**Statuslegende:** ✅ umgesetzt und getestet · 🔶 teilweise (Lücke in der Zeile benannt) · ⏳ Roadmap · ❌ außerhalb des Produktumfangs (bewusst).

**Hinweis zur Verbindlichkeit.** DERIVA ist ein Bewertungs- und Dokumentationswerkzeug. Die Erfüllung einer regulatorischen Pflicht liegt beim Institut bzw. Berater; das Tool liefert reproduzierbare Zahlen, Nachweise und Dokumentbausteine. Der im Repository enthaltene Markt ist **indikativ** (`governance.snapshotStatus: "indicative"`); produktive Nutzung erfordert freigegebene Marktdaten (ADR-005) und eine institutsseitige Modellvalidierung.

---

## 1. MiFID II / WpHG – Kostentransparenz und Geeignetheit

Rechtsgrundlagen: MiFID II Art. 24 Abs. 4 (Kosteninformation), Art. 25 Abs. 2/6 (Geeignetheit, Geeignetheitserklärung); DelVO (EU) 2017/565 Art. 50 (Ex-ante-/Ex-post-Kostenausweis, Gesamtbetrag **und** Prozentsatz, kumulative Renditewirkung), Art. 54 (Geeignetheitsprüfung); § 63 Abs. 7 WpHG (Kosten), § 64 Abs. 4 WpHG (Geeignetheitserklärung).

| Anforderung | Feature | Evidenz | Status |
|---|---|---|---|
| Ex-ante-Kostenausweis: Transaktionspreis vs. Fair Value, eingebettete Marge (Art. 50 DelVO, § 63 Abs. 7 WpHG) | `costTransparency` im Bewertungsreport: `transactionPrice`, `fairValue`, `initialMarketValue`, `bankMargin`, `marginBp`, `marginPct`; Perspektive `Bank`/`Kunde` | `packages/pricing-core/src/reporting/valuation-report.ts` (`buildValuationReport`, Vorzeichenregel `costTransparency`); API `POST /api/report` (`transactionPrice`, `perspective`); Tests `packages/pricing-core/src/reporting/*.test.ts`, `apps/api/src/contract.test.ts` („report accepts perspective and governance") | ✅ |
| Kosten in Betrag **und** Prozent (Art. 50 Abs. 2 DelVO) | `marginBp`/`marginPct` (bezogen auf Nominal); Betrag in Reporting-Währung | s. o. | 🔶 Prozent bezogen auf Nominal, nicht auf einen „Anlagebetrag"; laufende Kosten/Auflösungskosten sind Textbausteine (N-20) |
| Geeignetheitserklärung § 64 Abs. 4 WpHG mit Kundenklassifizierung, Kenntnisse/Erfahrungen, finanzielle Verhältnisse, Risikotoleranz, Absicherungszweck, Alternativen | `generateSuitabilityStatement` – strukturierte Abschnitte + Markdown, inkl. Kostenausweis, Szenariotabelle, Referenz-Snapshot und Report-Hash | `packages/pricing-core/src/reporting/documents.ts`; API `POST /api/documents/suitability` (`?format=md`), Schema `suitabilitySchema` in `apps/api/src/routes/documents.ts`; Test `apps/api/src/app.test.ts` („documents") | ✅ Dokument; ⏳ Zielmarkt-/Product-Governance-Hinweis (Art. 16 Abs. 3 MiFID II), PDF-Rendering, Signatur-Workflow |
| Termsheet / Produktinformation mit Risiken und Methodik | `generateTermsheet` | `documents.ts`; API `POST /api/documents/termsheet`; Test s. o. | ✅ |
| Szenariodarstellung für den Kunden (Art. 48/50 DelVO, Performance-Szenarien) | Standard-Szenarien (BaFin ±100/±200 bp, IRRBB, FX, Vol, Roll) in Report und Geeignetheitserklärung; Zinsen×FX-Matrix | `packages/pricing-core/src/risk/scenarios.ts` (`STANDARD_SCENARIOS`, `scenarioGrid`); API `POST /api/scenarios`, `/api/scenarios/grid` | ✅ |
| Kundenmodus (Präsentation ohne interne Margen) | Web `Shift+K` | `apps/web/src/state/store.ts`, `apps/web/src/hotkeys/keymap.ts`; E2E `apps/web/e2e/smoke.mjs` | ✅ |
| Ex-post-Kostenausweis (jährlich, Art. 50 Abs. 9 DelVO) | – | – | ❌ (erfordert Bestands-/Buchungshistorie, v1.0 Persistenz) |

## 2. IFRS 13 (Fair-Value-Bewertung) und IDW RS HFA 35

Rechtsgrundlagen: IFRS 13.9 ff. (Definition, Bewertungstechniken „Income Approach"), IFRS 13.72–90 (Bewertungshierarchie Level 1–3), IFRS 13.42–56 (CVA/DVA, Nichterfüllungsrisiko), IFRS 13.91 ff. (Angaben); **IDW RS HFA 35** – Handelsrechtliche Bilanzierung von Bewertungseinheiten (§ 254 HGB) einschließlich Effektivitätsnachweis und Behandlung des ineffektiven Teils (Drohverlustrückstellung); ergänzend IDW-Prüferpraxis zur Fair-Value-Bewertung von Finanzinstrumenten (Nachvollziehbarkeit von Inputs, Modell, Kalibrierung).

| Anforderung | Feature | Evidenz | Status |
|---|---|---|---|
| Bewertungstechnik nachvollziehbar (Income Approach: Diskontierung erwarteter Cashflows, Multi-Curve/OIS) | Cashflow-Tabelle mit Fixing, Accrual, Zahlung, Satz, DF, PV je Zahlung; Methodikabschnitt im Report | `packages/pricing-core/src/pricing/*`; `valuation-report.ts` (`methodologyFor`, `cashflowTable`); API `POST /api/report` (`?format=csv`) | ✅ |
| Fair-Value-Hierarchie (Level 1/2/3) mit Begründung | `ifrs13Level()` – Level 2 für OTC-Vanillas auf beobachtbaren Kurven/Vols; Level 3 bei Vol-Override, fehlender Fläche oder Extrapolation über den letzten Pillar **der tatsächlich genutzten Kurven** (N-02) | `valuation-report.ts` (`ifrs13Level`, `volSurfaceExtrapolation`); Tests `packages/pricing-core/src/reporting/*.test.ts` (20Y-EUR-Swap → Level 2, 40Y → Level 3 mit EUR-Kurven in der Begründung); API-Test `apps/api/src/app.test.ts` („risk, xva and report", `ifrs13Level === 2`) | ✅ Heuristik; ⏳ institutsspezifische Level-Policy (z. B. Liquiditätsgrenzen je Währung) |
| Nichterfüllungsrisiko: CVA/DVA im Fair Value (IFRS 13.42–56) | `computeXva` (semi-analytisch), `fairValue.riskFree/cva/dva/adjusted` | `packages/pricing-core/src/xva/cva.ts`; API `POST /api/xva`, Report-Feld `fairValue` | ✅ Einzelgeschäft; ⏳ Netting/Collateral (ADR-011/-016) |
| Reproduzierbarkeit jeder Zahl (Prüferforderung, IDW-Praxis): Marktsnapshot, Modellversion, Konventionen, Zeitstempel | Report mit vollständigem Kurven-Snapshot, `audit.snapshotId` (Hash der Marktinputs), `inputsHash`, `reportHash` (deterministisch, ohne `timingMs`, N-01), `engineVersion`; gleiche `snapshotId` als Header `X-Market-Snapshot-Id` auf jeder Bewertungsantwort | `valuation-report.ts` (`stableStringify`, `hashString`, `marketSnapshotId` – von der API wiederverwendet, `apps/api/src/lib/store.ts`), `apps/api/src/app.ts` (`onSend`-Hook); Tests: Core („zwei unabhängige Bewertungen → gleicher Hash"), `apps/api/src/contract.test.ts` („F-05 … matches the report's audit.snapshotId") | ✅ |
| Bewertungs-Governance: Input-Quellen, Freigabestatus des Snapshots, Validierer, Modellversion | `ValuationReport.governance { snapshotStatus, inputSources, modelVersion, validatedBy }` – Default `indicative` | `valuation-report.ts` (`ValuationGovernance`); API `POST /api/report` (`governance`), Schema `governanceSchema` in `apps/api/src/schemas.ts`; Test `contract.test.ts` | ✅ Felder; ⏳ Freigabe-Workflow (US-2.11) |
| Versionierter Marktdaten-Snapshot (Export/Import, Validierung) für EoD-Archiv und Prüferaustausch | `deriva.market/1` (ISO-Daten, DF je Pillar), `validateMarket`, Schema-Validierung beim Import, `ETag` = Snapshot-ID | `packages/pricing-core/src/market/snapshot.ts`; API `GET/PUT /api/market/snapshot` (`marketSnapshotSchema`); Tests `app.test.ts` („snapshot & EMIR"), `contract.test.ts` („N-04") | ✅ |
| Hedge Accounting IFRS 9 (6.4.1: wirtschaftliche Beziehung, Hedge Ratio, Kreditrisiko) – Effektivitätsnachweis und Buchung | `hedgeEffectivenessReport`: hypothetisches Derivat, Critical-Terms-Match (inkl. Tilgungspfad), Dollar-Offset (prospektiv, Basis, kumuliert), Regression (Steigung 0,8–1,25, R² ≥ 0,8) mit Basis-Szenarien bei Index-Mismatch, OCI-Lower-of-Test, Ineffektivität GuV; Optionsdesignation `IntrinsicValue` (IFRS 9 6.5.15) mit `costOfHedging`; Tilgungspläne (`notionalSchedule`, `amortisation` Linear/Annuity/Custom) | `packages/pricing-core/src/hedge/hedge.ts`; API `POST /api/hedge/effectiveness`, `/api/hedge/hypothetical` (`designation`, `hedgedItem.amortisation`); Tests `packages/pricing-core/src/hedge/*.test.ts`, `apps/api/src/app.test.ts` („hedge accounting"), `contract.test.ts` („R-03 … hedge") | ✅ prospektiv/szenariobasiert; ⏳ retrospektive Regression aus echten Zeitreihen (US-10.6) |
| HGB § 254 / IDW RS HFA 35: Bewertungseinheit, Einfrierungs-/Durchbuchungsmethode, Drohverlustrückstellung für den ineffektiven Teil | `accountingFramework: "HGB"` – Einfrierungs-/Durchbuchungsmethode, Rückstellungsbetrag, deutsche Zusammenfassung | `hedge.ts`; ADR-015; Tests s. o. | ✅ Rechenlogik; ⏳ Hedge-Dokumentation/Designationsmemo (US-10.6) |
| Verweis auf IDW RS HFA 35 im Methodikabschnitt des Reports | Methodikzeile „Bewertungsrahmen: IFRS 13 / IDW RS HFA 35 …" | `valuation-report.ts` (`methodologyFor`) | 🔶 wird mit dem Governance-Block ausgeliefert; Text-Konsistenz je Release prüfen |

## 3. EMIR Refit (VO (EU) 648/2012 i. d. F. 2019/834; RTS (EU) 2022/1855, ITS (EU) 2022/1860)

Rechtsgrundlagen: Art. 9 EMIR (Meldepflicht inkl. täglicher Bewertungsmeldung für FC/NFC+), Art. 11 Abs. 2 EMIR (tägliche Bewertung zu Marktpreisen, ersatzweise Modell), ITS Tabelle 2 Felder 21–26 (Valuation amount/currency/timestamp/method, Delta), Tabelle 3 (Collateral).

| Anforderung | Feature | Evidenz | Status |
|---|---|---|---|
| Tägliche Bewertung (Art. 11 Abs. 2): Mark-to-Market, ersatzweise Mark-to-Model mit dokumentiertem Modell | Pricing-Core mit Methodikabschnitt; `valuationMethod` `MTMO` (Default) / `MTMA` / `CCPV` wählbar | `packages/pricing-core/src/reporting/emir.ts`; API `GET /api/emir/valuations?method=` | ✅ |
| Bewertungsfelder Tabelle 2, Felder 21–25: Betrag, Währung, Zeitstempel, Methode | `emirValuationRecord` – `valuationAmount`, `valuationCurrency`, `valuationTimestamp` (Priorität: explizit `timestamp` → Snapshot-Zeit → Reporter-`asOf` → 17:00 UTC), `valuationMethod` (`method` → MTMA bei `transactionPrice` → MTMO) | `emir.ts` (`emirValuationTimestamp`, `EmirRecordOptions`); API `GET /api/emir/valuations` (`?asOf=&timestamp=&method=&uti=&transactionPrice=`), CSV via `emirCsv` (deutsches Format, Formel-Injection-Schutz `csvCell`); Tests `apps/api/src/contract.test.ts` („N-15", „R-03 … EMIR"), `app.test.ts` („snapshot & EMIR") | ✅ |
| Feld 26 Delta (Optionen) | `delta` aus `emirDelta`: Optionsdelta je Notional aus den Pricing-Analytics (FX-Option Spot-Delta, Swaption/Cap annuitätsgewichtet), ±1 für lineare Instrumente; Override `opts.delta` | `emir.ts` (`emirDelta`); Schema `emirRecordSchema.delta` | ✅ Heuristik je Instrument; 🔶 Prüfung gegen die ESMA-Validierungsregeln ausstehend |
| UTI je Geschäft | Trade-Feld `uti` (`TradeBase.uti`, ISO 23897) im Core-Typ und Schema; Query-Map `?uti={"<tradeId>":"<UTI>"}` überschreibt | `packages/pricing-core/src/instruments/types.ts`; `apps/api/src/routes/snapshot.ts` (`parseJsonMap`), Schema `tradeBaseProperties.uti`; Test `contract.test.ts` („R-03 … EMIR") | ✅ |
| Collateral-Felder (Tabelle 3), Produktklassifikation (CFI/UPI), ISO-20022-XML, Einreichung an Transaktionsregister | `productClassification` (heuristisch), `collateralPortfolioIndicator` | `emir.ts` | ⏳ Tabelle 3, UPI, XML-Erzeugung, TR-Anbindung – US-6.5 ist deshalb **🔶** |
| Cleared/uncleared-Kennzeichnung, Clearingfelder Tabelle 2, Felder 31–33 (cleared, Clearingpflicht, Clearingmitglied); EMIR 3 Active-Account, Clearingschwellen | Trade-Felder `cleared`, `clearingMember` (`TradeBase`, Schema) → Record-/CSV-Spalten `cleared`, `clearingObligation` (abgeleitet), `clearingMember` | `emir.ts` (`EMIR_CSV_HEADER`), `apps/api/src/schemas.ts` (`tradeBaseProperties`, `emirRecordSchema`); Test `contract.test.ts` („R-03 … EMIR": TRUE/Y/Eurex in JSON und CSV) | ✅ Felder; 🔶 kein Schwellenwert-/Active-Account-Monitoring |

## 4. BGH-Swap-Rechtsprechung (XI ZR 33/10 vom 22.03.2011; XI ZR 378/13 vom 28.04.2015)

| Anforderung | Feature | Evidenz | Status |
|---|---|---|---|
| Aufklärung über den anfänglichen negativen Marktwert **einschließlich seiner Höhe** bei beratenen Swaps (schwerwiegender Interessenkonflikt) | `costTransparency.initialMarketValue` (immer aus Kundensicht), `bankMargin`, `marginBp`/`marginPct`; BGH-Hinweis in Report-Methodik und Geeignetheitserklärung | `valuation-report.ts`, `documents.ts`; API `POST /api/report` (`transactionPrice`), `POST /api/documents/suitability`; Test Core „Zahlt der Kunde 3,10 % bei Par 2,88 %, ist der anfängliche Marktwert negativ" (US-6.2) | ✅ |
| Ausnahme konnexer Swaps (XI ZR 378/13): Kennzeichnung des Sicherungszwecks | `hedgingPurpose` in der Geeignetheitserklärung; Hedge-Accounting-Modul zur Dokumentation der Konnexität | `documents.ts` (`suitabilitySchema.hedgingPurpose`); `hedge.ts` | 🔶 fachliche Einordnung bleibt Beraterentscheidung; kein automatischer Konnexitäts-Check |

## 5. MaRisk (BaFin-Rundschreiben 05/2023, 7. Novelle; AT 4.3, BTO 2.2.1)

Rechtsgrundlagen: AT 4.3.2 (Risikosteuerungs- und -controllingprozesse), **AT 4.3.4/4.3.5** (Modelle: Validierung, Einsatz, Anpassung), **BTO 2.2.1** (Handelsgeschäfte: Bewertung durch handelsunabhängige Stelle, Bewertungsparameter, Modellvalidierung/Freigabe), AT 7.2 (IT), AT 9 (Auslagerung).

| Anforderung | Feature | Evidenz | Status |
|---|---|---|---|
| Nachvollziehbare Bewertungsmethoden und -parameter (BTO 2.2.1 Tz. 1–3) | Methodikabschnitt, Kurven-Pillars, Vol-Flächen, Konventionen im Report; Marktsnapshot versioniert | `valuation-report.ts`, `snapshot.ts`; API `GET /api/market/*`, `POST /api/report` | ✅ |
| Unabhängige Preisverifizierung (IPV): Vergleich mit Referenzwerten, Sensitivitäten, Szenarien | Zero-/Par-/Vega-Sensitivitäten, Standard-Szenarien, Par-Risk mit Re-Bootstrapping, Portfolio-Par-Risk | `packages/pricing-core/src/risk/sensitivities.ts` (`computeRisk`, `parRisk`, `parRiskPortfolio`, `vegaBuckets`); API `POST /api/risk`, `/api/risk/par`, `/api/risk/par/portfolio`, `/api/risk/vega` | ✅ Werkzeuge; ⏳ Abweichungsreport Front-Office vs. IPV-Kurve (US-2.11) |
| Modellvalidierung (AT 4.3.4): Nachweis gegen unabhängige Referenz, Dokumentation, Änderungsprozess | Referenzwert-Tests (Haug, Hull, Paritäten, Bootstrap-Round-Trips), Modellwahl je Trade (`model`), CONTRIBUTING „Modellvalidierung" (Referenznachweis pflicht bei Modelländerung), CODEOWNERS für den Core | `packages/pricing-core/src/**/*.test.ts` (176+ Tests); `CONTRIBUTING.md`; `CODEOWNERS`; ADR-004/-011/-016 | 🔶 interne Testsuite; ⏳ **Validierungs-Suite gegen QuantLib/ORE als CI-Job (US-9.7)**, institutsseitige Validierung erforderlich |
| Freigabe von Modellen und Bewertungsparametern, Kennzeichnung nicht freigegebener Daten | `governance.snapshotStatus` (`indicative`/`approved`), `validatedBy`, `modelVersion`; UI kennzeichnet Sample-Markt als indikativ | `valuation-report.ts`; API `POST /api/report` (`governance`) | 🔶 Metadaten vorhanden; ⏳ Freigabe-Workflow, Rollen (US-2.11, US-7.6) |
| Änderungshistorie / Audit-Trail (wer, wann, welche Kurve, welcher Report) | Append-only Audit-Log mit SHA-256-Hash-Kette für Trade-, Markt-, Kurven-, Snapshot-, Report- und Dokumentereignisse; `chainValid` | `apps/api/src/lib/store.ts` (`AuditLog`); API `GET /api/audit`; Tests `app.test.ts` („audit chain valid") | ✅ Kette; 🔶 `actor` immer `"api"` (keine Authentifizierung), In-Memory bis Persistenz (v1.0) |
| Funktionstrennung / Rollen (BTO 2.2.1 Tz. 4, AT 4.3.1) | – | – | ⏳ OIDC/Rollen als Gateway-Adapter (US-7.6, ADR-006/-018) |

## 6. DORA (VO (EU) 2022/2554) – IKT-Risikomanagement und Drittparteien

Rechtsgrundlagen: Art. 5–16 (IKT-Risikomanagementrahmen), Art. 17–23 (IKT-Vorfälle), Art. 24–27 (Tests), **Art. 28–30** (IKT-Drittparteienrisiko: Informationsregister, vertragliche Mindestinhalte, Exit-Strategien, Auditrechte). Ein von einem Finanzunternehmen bezogenes Bewertungs-SaaS wäre IKT-Drittdienstleistung; DERIVA im Selbstbetrieb ist Teil des institutsinternen IKT-Rahmens.

| Anforderung | Feature | Evidenz | Status |
|---|---|---|---|
| Nachvollziehbare Software-Lieferkette, Schwachstellenmanagement (Art. 9/10) | Lockfile-fixierte Installation, `pnpm audit --prod --audit-level=high` als CI-Gate, Dependabot (npm + Actions, wöchentlich), Swagger UI nur außerhalb `production` | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `apps/api/src/app.ts`; `SECURITY.md` | ✅ |
| Protokollierung und Vorfallerkennung (Art. 10/17): strukturierte Logs, Request-Korrelation, keine sensiblen Daten im Log | pino-Logger mit `LOG_LEVEL`, Redaction von `authorization`/`cookie`, Request-ID-Propagation (`x-request-id`), generische 500er | `apps/api/src/app.ts` (`buildApp`, `requestIdFrom`); Test `contract.test.ts` („N-12") | ✅ Basis; ⏳ Metriken, Alerting, Betriebsdoku (US-9.6) |
| Verfügbarkeit/Health für Betrieb und Monitoring | `GET /api/health`, `/api/health/ready` (Kurven, Trades, Bewertungstag, Snapshot-ID) | `apps/api/src/app.ts` | ✅ |
| Datenintegrität (Art. 9 Abs. 3): Manipulationserkennung an Bewertungsnachweisen | Hash-Kette im Audit-Log, `reportHash`/`inputsHash`/`snapshotId`, ETag auf Trades und Snapshot | s. Abschnitt 2/5 | ✅ |
| Meldung von Schwachstellen, Reaktionszeiten | SECURITY.md (vertraulicher Meldeweg, 3 Werktage Eingangsbestätigung, 14 Tage für kritische Lücken) | `SECURITY.md` | ✅ |
| Informationsregister, Vertragsklauseln, Exit-Strategie, Auditrechte (Art. 28–30), Resilienztests (Art. 24 ff.), Vorfallmeldung an Behörden (Art. 19) | – | – | ❌ organisatorische Pflichten des Instituts / Vertragsgegenstand; das Repository liefert Nachweise (Audit-Trail, Snapshot-Export, Versionierung), keine Register oder Verträge |

## 7. Weitere Regime (Kurzstatus)

| Regime | Bezug | Status |
|---|---|---|
| EBA Prudent Valuation (DelVO (EU) 2016/101, AVAs) | Sensitivitäten und Szenarien als Input; AVA-Berechnung selbst nicht enthalten | ⏳ |
| PRIIPs (VO (EU) 1286/2014, KID mit Performance-Szenarien) | `generateKid` – Basisinformationsblatt mit Risikoindikator (`summaryRiskIndicator`, MRM-Klassen aus dem Szenario-Verlust), Performance-Szenarien (10/50/90 %-Quantil, Stress) aus dem Szenario-Set (Standard, optional historisch), Kostenblock, Haltedauer; API `POST /api/documents/kid` (`?format=md`), Test `contract.test.ts` („R-03 … documents") | ✅ heuristisches KID; ⏳ Berechnung nach Anhang II–V DelVO 2017/653 (Cornish-Fisher-VaR, Bootstrapping) |
| Geschäftsbestätigung (Einzelabschluss unter DRV / ISDA Master Agreement) | `generateConfirmation` – Parteien (Name, LEI), Rahmenvertragsbezug (DRV/ISDA, Datum, Besicherungsanhang/CSA), Konditionen, UTI, Zahlungsplan (indikative variable Beträge markiert); API `POST /api/documents/confirmation` (`?format=md`), Test `contract.test.ts` („R-03 … documents") | ✅ Dokumentbaustein; 🔶 rechtliche Prüfung des Wortlauts durch das Institut |
| ISDA SIMM / CRIF-Export | Sensitivitäten vorhanden, Formatexport fehlt | ⏳ (US-4.5) |
| Benchmark-Reform (BMR): RFR-Konventionen (Lookback, Observation Shift, Compounding) | OIS-Legs mit `lookbackDays`, `observationShift`, `compounding`; Fixings inkl. `missingFixingPolicy` | ✅ |

---

## 8. Explizit **nicht abgedeckt** (Stand v0.2)

1. **Authentifizierung/Autorisierung, Rollen, Funktionstrennung** (MaRisk BTO 2.2.1 Tz. 4, DORA Art. 9) – die API läuft ohne Auth hinter einem Gateway oder lokal; `audit.actor` ist immer `"api"` (US-7.6, ADR-018).
2. **Persistenz** von Trades, Snapshots und Audit-Trail – In-Memory; der Nachweis überlebt keinen Neustart (US-7.6). Für Prüfzwecke sind Report-JSON und Snapshot-Export zu archivieren.
3. **Freigabe-Workflow für Marktdaten und Modelle** (MaRisk AT 4.3.4/BTO 2.2.1, IDW-Prüfererwartung) – `governance.snapshotStatus` ist ein Metadatum ohne Vier-Augen-Prozess (US-2.11).
4. **Unabhängige Modellvalidierung gegen QuantLib/ORE** als automatisierter Nachweis (US-9.7); die interne Testsuite (Referenzwerte, Paritäten) ersetzt keine institutsseitige Validierung.
5. **EMIR-Meldung**: Collateral-Felder (Tabelle 3), UPI/CFI aus ANNA-DSB, ISO-20022-XML, TR-Anbindung; EMIR-3-Schwellenwert-/Active-Account-Monitoring (Clearingfelder 31–33 und Delta werden befüllt, die Meldelogik selbst fehlt).
6. **MiFID II**: Ex-post-Kostenausweis, Zielmarkt/Product-Governance-Hinweis, strukturierte laufende/Auflösungskosten, PDF-/DOCX-Rendering und Signatur der Geeignetheitserklärung.
7. **Live-Marktdaten** und Lizenz-Tagging (ADR-005, US-2.10) – der Sample-Markt ist indikativ.
8. **Netting-/Collateral-CVA, FVA/KVA/MVA, Wrong-Way-Risk** (IFRS 13.48 Portfolio-Ausnahme) – ADR-011/-016, US-4.4.
9. **DORA-Organisationspflichten**: Informationsregister, Vertragsklauseln, Exit-Strategien, Resilienztests, Vorfallmeldungen, Betriebsdokumentation (US-9.6).
10. **Prudent Valuation (AVAs), PRIIPs-KID nach Anhang II–V (das erzeugte Basisinformationsblatt ist eine Szenario-Heuristik), SIMM/CRIF, VaR/ES** (US-4.5, US-5.6).

## 9. Pflege

- Jede Änderung an `reporting/`, `hedge/`, `xva/`, `emir.ts`, den API-Schemas oder der CI aktualisiert die betroffene Zeile (PR-Template-Checkliste).
- Die Evidenzspalte verweist auf Dateien und Tests im Repository; Zahlen (Testanzahl, Coverage) stehen bewusst nicht hier, sondern in den Scorecards unter `docs/quality/`.
- Rechtsquellen sind in [`docs/research/03-domaene-markt-methodik-regulatorik.md`](../research/03-domaene-markt-methodik-regulatorik.md) belegt; Änderungen der Rechtslage (z. B. EMIR-3-Delegierte Rechtsakte, MaRisk-Novellen) werden dort zuerst nachgezogen.
