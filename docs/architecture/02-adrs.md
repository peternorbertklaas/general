# Architecture Decision Records

## ADR-001 · Ein Bewertungskern in TypeScript, isomorph für Browser und Server

**Kontext.** Wettbewerber trennen Pricing (C++/C#-Library im Backend) und UI; jede Interaktion ist ein Roundtrip. Für Live-What-if und Offline-Demos brauchen wir Bewertung im Browser; für Integration und Batch brauchen wir denselben Kern serverseitig.
**Entscheidung.** `@deriva/pricing-core` als reine TypeScript-ESM-Bibliothek ohne I/O und ohne Node-Abhängigkeiten. Identische Ergebnisse in Web und API.
**Alternativen.** QuantLib (C++/WASM): mächtig, aber 10+ MB WASM, schwer erweiterbar im Team, Lizenz-/Build-Komplexität. Python/QuantLib-Backend: kein Browser-Betrieb, Roundtrips. Rust/WASM-Kern: attraktiv für v2, aber höhere Einstiegshürde.
**Konsequenzen.** + Ein Code-Pfad, sofortiges Feedback, einfache Tests. − Für Monte-Carlo/Kalibrierung (v1.1) ggf. Worker/WASM nötig (US-9.8).

## ADR-002 · Serial-Date als Datumsmodell

**Kontext.** JS `Date` ist zeitzonenbehaftet; Finanzdaten sind reine Kalendertage.
**Entscheidung.** `SerialDate = number` (Tage seit 1970-01-01 UTC). Alle Kalender-/Tageszählungsfunktionen arbeiten auf Ganzzahlen. ISO-Strings nur an den Systemgrenzen (API, UI-Inputs).
**Konsequenzen.** + Schnell, vergleichbar, kein DST-Bug. − Lesbarkeit im Debugger (mit `toISO` behelfen).

## ADR-003 · Multi-Curve mit OIS-Diskontierung und sequentiellem Bootstrapping

**Kontext.** Seit der Benchmark-Reform ist OIS-Diskontierung (€STR/SOFR) Marktstandard; EURIBOR-Tenorkurven sind Projektionskurven.
**Entscheidung.** `MarketContext.discountCurveId` je Währung (optional je Collateral); Indexkurven über `RateIndex.curveId`. Bootstrapping sequentiell mit Brent je Pillar, dual-curve für IBOR-Kurven. Interpolation log-linear in DF als Default.
**Alternativen.** Globaler Solver (alle Pillars simultan): genauer bei nicht-lokalen Interpolationen, aber komplexer; für v1 nicht nötig.
**Konsequenzen.** + Residuen ~1e-12; jede Kurve reproduziert ihre Quotes exakt. − Kubische Interpolation in Kombination mit sequentiellem Bootstrap ist nur näherungsweise exakt (dokumentiert).
**Ergänzung (Review R2, N-C).** Quotes, deren Pillars innerhalb von `pillarMergeToleranceDays` liegen (Sample: FRA 3x6 / Dez-Future 8 Tage, FRA 6x9 / Mär-Future 10 Tage), werden zu einem Pillar zusammengeführt – Priorität Future > FRA > Depo, Gleichstand → spätere Fälligkeit; die verworfenen Quotes werden mit ihrem Residuum auf der finalen Kurve in `mergedQuotes` ausgewiesen. Default 0 (aus); der Sample-Markt nutzt 10 Tage für EUR-3M.

## ADR-004 · Bachelier als Standard für Zinsoptionen, Garman-Kohlhagen für FX

**Kontext.** Negative/niedrige Zinsen machten Black-76 unbrauchbar; der Markt quotiert Normal-Vols. FX-Optionen werden in Delta-Konvention quotiert.
**Entscheidung.** Cap/Floor/Swaption default Bachelier; Black und shifted Black wählbar; SABR (Hagan) für den Swaption-Smile am Strike mit Alpha-Rekalibrierung auf ATM (Parameter zwischen Gitterpunkten geblendet); eingebettete Caps/Floors in Swap-Legs als Caplet/Floorlet-Erwartungswert auf der Caplet-Fläche (Vega über Feature-Erkennung, nicht über den Trade-Typ). FX: GK-Vanilla mit Spot-Date-verankertem Forward und Diskontierung bis zum Lieferdatum; Digitals analytisch (Cash-/Asset-or-nothing); Single-Barrier nach Reiner-Rubinstein mit denselben Delivery-Konventionen (Raten auf den Expiry-Horizont skaliert, damit In + Out = Vanilla exakt gilt). Smile aus ATM/RR/BF in der (unadjustierten Forward-Put-Delta-)Koordinate mit Fixpunkt-Konvertierung Strike↔Delta; Delta-Konventionen Spot / Forward / Premium-Adjusted Spot / Premium-Adjusted Forward, ATM Delta-neutral oder Forward; Butterflies als Smile-Strangle (Default) oder Broker-Strangle (Reiswich-Wystup-Iteration); Interpolation linear (Default) oder monoton-kubisch (Fritsch-Carlson), flache Extrapolation jenseits der 10Δ-Pillars.
**Konsequenzen.** + Marktkonform, geschlossene Formeln; Greeks der Vanillas analytisch, Greeks von Barrieren/Digitals per zentralen finiten Differenzen der geschlossenen Formel (`analytics.greeksMethod`), Vega-Buckets je Expiry bzw. Expiry × Tenor. − Barrier ohne Vanna-Volga-Korrektur (v1.1), keine Pfadabhängigkeit; 10Δ-Butterflies werden auch bei Broker-Quotierung als Smile-Strangle gelesen.
**Ergänzung (Review R3, R3-1/R3-8/R3-9).** *Modell/Vol-Typ-Konsistenz:* Weicht das im Trade gewählte Modell (`model: "Black" | "ShiftedBlack" | "Bachelier"`) von der Quotierung der vorhandenen Caplet-/Swaption-Fläche ab, wird die Flächen-Vol je Forward/Strike/Expiry per Preisäquivalenz in die Modell-Quotierung konvertiert (`convertIrVol`: Bachelier-Preis → implizite (shifted) Black-Vol bzw. umgekehrt; exakt, Näherung σ_N ≈ σ_LN·(F+Shift) nur als Rückfall bei numerisch verschwindender Zeitprämie) und die Warnung `VOL_TYPE_CONVERTED` gesetzt; ein lognormales Modell auf nicht-positivem verschobenem Forward/Strike wirft `PricingError("VOL_MODEL_INCOMPATIBLE")` statt still ≈ 0 zu liefern. Eine explizite `volOverride` wird immer in der Modell-Quotierung gelesen. Der IFRS-13-Report bleibt bei konvertierter Vol Level 2 mit Hinweis; das ausgewiesene Vega folgt der Modell-Quotierung (bp Normal-Vol bzw. Vol-Punkt). *FX-Beispielflächen:* alle Sample-Flächen deklarieren `deltaConvention: "Spot"` und `atmConvention: "DeltaNeutral"` (Marktkonvention ≤ 1Y; die Fläche trägt eine Konvention je Fläche, > 1Y wäre Forward-Delta – indikative Daten; EUR-Crosses/USDJPY quotieren interbank premium-adjusted, im Sample unadjustiert). *Barrieren mit nicht-standardisiertem Lieferdatum:* Drift und Rebate-at-hit-Diskontierung laufen auf dem Expiry-Horizont (Raten bis zum Standard-Lieferdatum der Expiry, `rdExpiry`/`rfExpiry`), nur Auszahlungsdiskont und Forward auf das tatsächliche Lieferdatum; der Carry zwischen Spot bei Expiry und Lieferdatums-Forward wird über skalierten Spot/Barrier absorbiert – In + Out = Vanilla bleibt für jeden Lag exakt, der Rebate-at-hit-Wert hängt nicht mehr vom Lag ab. Für das Standard-Lieferdatum sind die Ergebnisse bit-identisch zu Runde 2.

## ADR-005 · Marktdaten als austauschbarer Snapshot; Sample-Markt im Repo

**Kontext.** Live-Marktdaten sind lizenzpflichtig und kundenspezifisch.
**Entscheidung.** `MarketContext` ist ein serialisierbarer Snapshot. v0.1 liefert einen deterministischen Beispielmarkt (indikative Levels Sept. 2026). Adapter (LSEG, Bloomberg, ICE, EZB €STR, EMMI EURIBOR) erzeugen denselben Snapshot-Typ.
**Konsequenzen.** + Tests und Demos sind reproduzierbar; UI klar als „indikativ" gekennzeichnet. − Kein Live-Betrieb ohne Adapter.
**Ergänzung (N14).** Die Kalender TARGET/US/UK/CH/JP sind regelbasierte Näherungen der wesentlichen Feiertage. In Produktion überschreibt ein Feiertagsfeed (SIFMA, JPX/BoJ, EZB) sie über `registerCalendarHolidays(id, dates)`: für jedes im Feed enthaltene Kalenderjahr ist der Feed maßgeblich, andere Jahre bleiben regelbasiert; Joint-Kalender („TARGET+US") und Aliasse übernehmen das Override automatisch. Der Bewertungsreport trägt den Freigabestatus des Snapshots und die Datenquellen im Feld `governance` (indikativ / freigegeben, `inputSources`, `validatedBy`, Modellversion).

## ADR-006 · Zustandslose API mit Store-Interfaces; Persistenz und Auth als Adapter

**Kontext.** v0.1 soll ohne Infrastruktur laufen; v1.0 braucht Mandanten, Rollen, Audit.
**Entscheidung.** Fastify-Routen sprechen `MarketStore`/`TradeStore`-Interfaces (In-Memory). PostgreSQL-Implementierung und OIDC-Middleware werden ergänzt, ohne Routen zu ändern.
**Konsequenzen.** + Schneller Start, testbar via `app.inject`. − Kein Multi-Instanz-Betrieb bis Persistenz vorhanden.

## ADR-007 · ISO-8601 an der API-Grenze

**Entscheidung.** Requests/Responses tragen Datumsfelder als `YYYY-MM-DD`; ein rekursiver Mapper (`datesToSerial`/`datesToIso`) konvertiert bekannte Schlüssel. Interne Typen bleiben Serial-Dates.
**Konsequenzen.** + Lesbare API, Excel-/TMS-freundlich. − Schlüsselliste muss bei neuen Datumsfeldern gepflegt werden (Test deckt Kernfelder ab).

## ADR-008 · Deklaratives Hotkey-System mit Chords

**Kontext.** Berater brauchen Terminal-Geschwindigkeit; Hotkeys dürfen Eingabefelder nicht stören.
**Entscheidung.** Eine `HOTKEYS`-Liste (id, keys, label, group, global) ist Single Source of Truth für Dispatcher, Palette und Cheat-Sheet. Chords (`g p`) mit 900-ms-Fenster und Statusanzeige. Einzeltasten sind in editierbaren Feldern deaktiviert, Modifier-Kürzel global.
**Alternativen.** Bibliotheken (Mousetrap, react-hotkeys-hook): weniger Kontrolle über Chords/Statusanzeige.
**Konsequenzen.** + Konsistenz, testbar (`useHotkeys.test.ts`). − Layout-Abhängigkeit bei Symboltasten (gelöst: Symbolvergleich ohne Shift-Zustand).

## ADR-009 · Zustand über zustand, synchrone Neubewertung

**Entscheidung.** Ein Store; Aktionen bewerten betroffene Trades synchron neu (Bewertung < 5 ms). Risiko wird lazy berechnet und pro Trade gecacht, Cache bei Marktänderung invalidiert.
**Konsequenzen.** + Einfaches mentales Modell, keine Race Conditions. − Bei > 500 Trades Auslagerung in Web Worker (US-9.8).

## ADR-010 · CSS-Design-Tokens statt UI-Framework

**Entscheidung.** Eigene Tokens (Farben, Radien, Typografie) und ~600 Zeilen CSS; Dark/Light über `data-theme`. Charts (ECharts) lesen Tokens aus CSS-Variablen.
**Konsequenzen.** + Vollständige Kontrolle über die Trading-Ästhetik, kleines Bundle. − Kein fertiges Komponenten-Set (bewusst; Tabellen/Formulare sind einfach).

## ADR-011 · Semi-analytisches CVA in v1

**Entscheidung.** CVA für fix/variable Swaps über Swaption-Replikation (Sorensen-Bollier): erwartetes positives Exposure an jedem Kupontermin = europäische Swaption auf den Restswap, bewertet mit der **Smile-Vol am Strike (Festsatz)** aus dem SABR-Cube (Fallback 70 bp Normal-Vol) und der Annuität des Restswaps; das Profil endet mit Exposure 0 an der Fälligkeit, damit die letzte Periode ihre Ausfallwahrscheinlichkeit trägt. Tenor-Basis-Swaps über Basis-Swaption-Replikation (Bachelier auf den Spread, konservative Spread-Vol); FX-Forwards über GK auf dem Forward; alle übrigen Instrumente über das generische Delta-Normal-Exposure (ADR-016). Flache Hazard-Rate aus CDS-Spread, CVA = LGD · Σ EPE · ΔPD. Netting/Collateral/Monte-Carlo in v1.1.
**Konsequenzen.** + Millisekunden, prüferverständlich, ausreichend für Einzelgeschäfte; die verwendete Methode steht in `xva.method` und im Methodikabschnitt des Reports. − Kein Netting-Vorteil, keine Wrong-Way-Risk-Modellierung.
**Ergänzung (Review R3, R3-3).** `bootstrapHazardCurve` akzeptiert keine negativen Hazard-Raten mehr: fällt s_i·T_i so steil, dass der Solver für ein Intervall λ < 0 liefert (Überlebenswahrscheinlichkeit würde steigen – Arbitrage bzw. Datenfehler), wirft der Bootstrap `PricingError("INVALID_CREDIT_CURVE")` mit dem betroffenen Pillar (`details.pillar`, `hazard`); mit `opts.floorHazard: true` wird das Intervall auf 0 gefloort, die Kurve trägt `warnings: ["HAZARD_FLOORED: …"]` und die späteren Pillars werden auf der gefloorten Kurve gelöst (die gefloorte Quote repriced dann nicht). Leere Quote-Listen, negative Spreads und Recovery ∉ [0, 1) liefern denselben Code statt plain `Error`.

## ADR-012 · Deutsch als Produktsprache, Englisch im Code

**Entscheidung.** UI, Reports, Dokumentation deutsch (Zielmarkt DACH); Code, Typen, Kommentare englisch (Wartbarkeit, Open-Source-Fähigkeit). i18n-Schicht in v1.0.

## ADR-013 · JSON-Schema-Validierung an der API-Grenze

**Kontext.** Ohne Schema lieferte die API bei fehlerhaften Bodies 200 mit `pv: null` (Review-Finding).
**Entscheidung.** Jede Route deklariert `schema.body`/`querystring`/`params` (Fastify/Ajv, `apps/api/src/schemas.ts`) – seit v0.2 einschließlich `PUT /api/market/snapshot` (`marketSnapshotSchema`: Schema-Literal `deriva.market/1`, `0 < df ≤ 1,0001`, ISO-Daten, Spots > 0). Trades sind eine **diskriminierte Union** (`oneOf` je `type`, Ajv `discriminator`), Legs `oneOf` Fixed (`rate` Pflicht) / Float (`index` Pflicht); jedes Enum-Feld der Core-Typen (`status`, `stub`, `roll`, `businessDayConvention`, `compounding`, `cashSettlementConvention`, `dayCount`, …) ist typisiert, Datumsfelder auch verschachtelt (`tradeDate`, `upfront.date`, `notionalSchedule[].date`, `ndf.fixingDate`) als ISO-Pattern. `additionalProperties: false` je Variante mit Ajv `removeAdditional: false`: unbekannte Felder werden mit 400 abgelehnt statt stillschweigend entfernt. Die tiefe Semantik (Kurven, Fixings, endliche Barwerte) prüft der Pricing-Core (`PricingError` → 422 mit `code`, ADR-022/-025). Fehlerformat einheitlich `{ error, code?, statusCode, validation?, requestId }`.
**Konsequenzen.** + Frühe, verständliche Fehler; kein `pv: null` mehr für unvollständige Trades; OpenAPI zeigt die Varianten als `components.schemas` mit `discriminator`. − Neue Felder müssen im Schema nachgezogen werden – ein Test bewertet jeden Sample-Trade der Builder über die API (`contract.test.ts`, „schema stays in sync"), Ajv-`coerceTypes` (nötig für Query-Strings) akzeptiert numerische Strings (`"1e7"`) in Bodies.
**Ergänzung (Review R3, N3-01/N3-02/N3-03).** Das Schema begrenzt Anzahl und Größe, nicht die Rechenarbeit; deshalb prüft ein `preHandler` (`apps/api/src/lib/limits.ts`) nach der Schema-Validierung und vor jeder Bewertung die geschätzten Kuponperioden (≤ 1200 je Leg → 400 `TOO_MANY_PERIODS`; ≤ 20 000 je Request und ≤ 500 000 Perioden × Bewertungen → 413 `PERIOD_BUDGET_EXCEEDED`); `frequency` ist auf `^([1-9]\d{0,2}[DWMY]|ZC)$` verengt, `meta.snapshotTime` und die EMIR-Zeitstempel sind ISO-8601-`date-time`. Jede Trade- und Leg-Variante ist ein geteiltes Schema mit `$id`; die Unions referenzieren sie per `$ref` (Ajv löst den Diskriminator über die Referenzen auf), das OpenAPI-Dokument (3.1.0) benennt die Komponenten nach ihrem `$id` und trägt `discriminator.mapping` (in `openApiTransform` ergänzt, weil Ajv `mapping` im Validierungsschema ablehnt). CSV-Uploads (`text/csv`) werden in einer `preValidation` über die Core-Builder in Trades überführt und durchlaufen anschließend dasselbe Schema, dieselben Grenzen und denselben Handler wie JSON.

## ADR-014 · Audit-Trail als Hash-Kette, Reproduzierbarkeit über Snapshot-/Report-Hash

**Entscheidung.** Jeder Bewertungsreport trägt `audit.snapshotId` (Hash aller Kurven-Pillars, Spots, Bewertungstag), `inputsHash` (Trade + Snapshot) und `reportHash` (Inhalt). Die API führt ein append-only Log mit SHA-256-Verkettung (`GET /api/audit` mit `chainValid`). Hashing dependency-frei (FNV-1a im Core, SHA-256 im Node-Adapter).
**Konsequenzen.** + Prüfer können jede Zahl einem Snapshot zuordnen; Manipulationen werden erkannt. − In-Memory-Log bis Persistenz (v1.0).
**Ergänzung (Review R2, N-01/N-19).** Der `reportHash` schließt Zeitstempel und Laufzeitmessungen (`pricing.timingMs`, `generatedAt`) aus, sodass zwei unabhängige Bewertungen derselben Inputs denselben Hash liefern; die Engine-Version stammt aus `package.json` (generierte `src/version.ts`, `prebuild`/`pretest`).

## ADR-015 · Hedge Accounting als eigenständiges Modul mit hypothetischem Derivat

**Entscheidung.** `src/hedge` implementiert IFRS 9 (Cash-Flow-/Fair-Value-Hedge, hypothetisches Derivat, Dollar-Offset, Regression über Szenario-Schocks, Critical-Terms) und HGB § 254 (Einfrierungs-/Durchbuchungsmethode) auf Basis der bestehenden Pricer und Szenario-Engine; keine eigenen Bewertungsmodelle.
**Konsequenzen.** + Konsistenz zwischen Bewertung und Effektivitätstest; deterministisch und testbar. − Historische Regression (echte Zeitreihen) erst mit Marktdaten-Historie (v1.0).
**Ergänzung (Review R2, R2-4).** Weicht der Referenzzins des Grundgeschäfts vom Sicherungsinstrument ab (3M-Kredit vs. 6M-Swap, €STR-Kredit vs. EURIBOR-Swap), enthält das Regressions-Set zusätzlich Basis-Szenarien: die Projektionskurven beider Indizes einzeln ±10/±25 bp (Tenor-Basis) und die Diskontkurve einzeln ±25 bp (OIS-Basis); ein informativer Basis-Dollar-Offset (Projektionskurve des Grundgeschäfts +25 bp) wird ausgewiesen. Ein Regressions-Set aus reinen Parallelschocks löst bei Index-Mismatch die Warnung „Regression ohne Basis-Szenarien" aus (IFRS 9 B6.4.14, IDW RS HFA 35 Tz. 51).

## ADR-016 · Generisches Delta-Normal-Exposure für CVA jenseits von Swaps/FX-Forwards

**Entscheidung.** Für Optionen, CCS, FX-Swaps und Basis-Swaps wird das erwartete Exposure aus dem Constant-Curve-Roll (Erwartungswert) und einer Normalapproximation mit DV01·ATM-Normal-Vol und FX-Delta·FX-Vol abgeleitet; Long-Optionen haben kein negatives Exposure. Swaps behalten die Swaption-Replikation.
**Konsequenzen.** + Vollständige Abdeckung in Millisekunden, klar als Näherung ausgewiesen. − Kein Netting, kein Wrong-Way-Risk (v1.1: Monte-Carlo).

## ADR-017 · CSV im deutschen Excel-Format

**Entscheidung.** Exporte verwenden Semikolon, Dezimalkomma und UTF-8-BOM (`toCsv(rows, { decimalComma, bom })`), Zellen mit Sonderzeichen werden gequotet. JSON-Exporte bleiben maschinenlesbar mit Punkt.
**Konsequenzen.** + Direktes Öffnen in deutschem Excel. − Nicht-deutsche Konsumenten wählen `decimalComma: false`.
**Ergänzung (N-13).** Nicht-numerische Zellen mit führendem `=`, `+`, `-`, `@`, Tab oder CR werden mit einem Apostroph neutralisiert (Formel-Injection).

## ADR-018 · Sicherheitsbasis der API vor Authentifizierung

**Entscheidung.** helmet-Header, Rate-Limit (600/min), CORS-Allowlist über `CORS_ORIGINS`, Body-Limit 5 MB, bereinigte Dateinamen, Request-ID, generische 500er. Authentifizierung/Autorisierung (OIDC, Rollen) bleibt v1.0 und wird als Gateway-/Middleware-Adapter ergänzt.

## ADR-019 · Collateralised-Cash-Price-Konvention für Cash-Settled Swaptions

**Entscheidung.** Cash-Settlement wird standardmäßig mit der Diskont-Annuität bewertet (EUR-Marktkonvention seit 2018); die Yield-Formel bleibt als `IRR` wählbar.

## ADR-020 · Qualitäts-Gates in der CI

**Entscheidung.** CI (`.github/workflows/ci.yml`, Push auf `main`/`claude/**` und Pull Requests gegen `main`, Node 20 und 22) führt in dieser Reihenfolge aus: Install mit eingefrorenem Lockfile → **Drift-Check der generierten `version.ts`** (`version:gen` + `git diff --exit-code`) → Core-Build → Typecheck → ESLint (`--max-warnings 0`) → **Prettier-Check** (`pnpm format:check`, `.prettierignore` für Build-Artefakte und Prosa-Doku) → Tests mit Coverage-Schwellen in allen drei Paketen (Coverage-Artefakte für Core, API, Web) → **`pnpm audit --prod --audit-level=high`** (ein Retry gegen Registry-Timeouts) → API- und Web-Build → Playwright-E2E-Smoke gegen den Produktions-Build (Node 22). Ein PR aus einem `claude/**`-Branch desselben Repositories läuft nicht doppelt: der Push-Lauf zählt, der `pull_request`-Lauf wird per Job-`if` übersprungen (Forks und andere Branches laufen auf dem PR-Event). Das Web-Artefakt enthält keine Source-Maps. Dependabot hält npm- und Actions-Abhängigkeiten wöchentlich aktuell; CODEOWNERS erzwingt Reviews auf Core, API, Compliance-Doku und CI.
**Konsequenzen.** + Formatierung, Abhängigkeitsrisiken, Coverage und die Konsistenz der Engine-Version sind Gates, nicht Empfehlungen. − Ein neues High-Advisory ohne Fix blockiert den Merge, bis ein Override (`pnpm.overrides`) oder eine dokumentierte Ausnahme (SECURITY.md, „Akzeptierte Advisories") vorliegt.

## ADR-021 · Golden Master mit unabhängigen Referenzwerten

**Kontext.** Interne Invarianten (Paritäten, Repricing der Kalibrierinstrumente) und Literaturwerte prüfen Modelle, aber keine unabhängige Vollbewertung mit Schedules, Day Counts, Kurvenzugriff und Settlement-Konventionen.
**Entscheidung.** `packages/pricing-core/test-data/golden/*.json` enthält eingecheckte Referenzwerte, die unabhängig vom TypeScript-Kern hergeleitet sind (geschlossene Formeln auf flachen Kurven mit unadjustierten Schedules: Swap-Annuität/Par-Satz, OIS-Compounding-Teleskopierung, Black-76/Bachelier, Garman-Kohlhagen mit Delivery-Lag, Zinsparität mit Spot-Date, Cash-Swaption CCP/IRR, Caplet-Strip); `tools/quantlib-golden.py` erzeugt die Dateien und ergänzt bei installiertem QuantLib einen Cross-Check-Block, ist aber in CI nicht erforderlich. `src/testing/golden.test.ts` reproduziert jeden Fall mit 1e-6 relativer Toleranz; Herleitungen stehen in `test-data/golden/README.md`.
**Konsequenzen.** + Prüfer erhalten eine nachvollziehbare, vom Kern unabhängige Referenz; Regressionen in Schedules/Day Counts/Konventionen werden erkannt. − Sample-Markt-Fälle bleiben Invarianten-getestet (keine Vendor-Referenz).
**Ergänzung (Review R3, Golden Master).** Achter Fall `sample-market-bootstrap.json`: die €STR-OIS-Kurve des Beispielmarkts (18 Quotes 1W…30Y, TARGET-Kalender, Spot T+2, Modified Following, Zahlungsverzug 1 Geschäftstag, log-lineare Diskontfaktoren) wird in `tools/quantlib-golden.py` unabhängig nachgerechnet – mit eigener Oster-/TARGET-Kalenderlogik und Datumsarithmetik: die Pillars ≤ 1Y sind Einperioden-OIS mit geschlossener Par-Bedingung DF(accEnd) = DF(spot)/(1 + r·τ) (Pillar auf dem Zahltag einen Geschäftstag später auf demselben log-linearen Segment), die Pillars 18M…30Y zahlen jährlich (kurzer Front-Stub) und werden per Bisektion der Par-Gleichung Σ DF(pay_i)[DF(acc_{i−1})/DF(acc_i) − 1 − r·τ_i] = 0 gelöst (€STR-Compounding teleskopiert zu DF-Verhältnissen). `golden.test.ts` verlangt DF-Gleichheit je Pillar (1e-12 geschlossen, 1e-9 Bisektion), Repricing aller Quotes (Residuum < 1e-9), Gleichheit mit der Kurve aus `buildSampleMarket` und Identität der JSON-Quotes mit `SAMPLE_QUOTES.eurOis`. Damit sind Kalender, adjustierte Schedules, Zahlungsverzug und Interpolation golden-getestet. **QuantLib-Cross-Check: ausstehend** – QuantLib war beim Erzeugen der Dateien nicht installiert; `tools/README.md` beschreibt die Regeneration (`pip install QuantLib`, `PiecewiseLogLinearDiscount`/`OISRateHelper` für den Bootstrap-Fall), `sample-market-bootstrap.json` trägt bis dahin `quantlib: { status: "pending" }`.

## ADR-022 · Fehlerklassen und Trade-Validierung im Kern

**Entscheidung.** Domänenfehler werfen `PricingError` mit stabilem `code` (`INVALID_TRADE`, `NON_FINITE_PV`, `MISSING_FIXING`, `NO_DISCOUNT_CURVE`, `CURVE_NOT_FOUND`, `NO_FX_SPOT`, `UNKNOWN_INDEX`, `UNKNOWN_CALENDAR`, `UNSUPPORTED_TRADE_TYPE`). `priceTrade` validiert die Struktur des Trades (`validateTrade`: Pflichtfelder, endliche Zahlen, Datumsreihenfolge – z. B. Fixed-Leg ohne `rate`, Float-Leg ohne `index`) und lehnt nicht-endliche Barwerte ab; ein Barwert `null`/`NaN` entsteht nie stillschweigend. Programmierfehler (`TypeError`, `RangeError`) werden im Kern nicht umhüllt; die API klassifiziert sie, wenn sie aus einem Pricer stammen, als 400 „Invalid trade" (ADR-025 – Trade-Eingaben sind die einzige Quelle solcher Fehler), alles Übrige als generischen 500er.
**Konsequenzen.** + Einheitliche 422-Fehlerobjekte in der API, keine Rohmeldungen mit Interna. − Zusätzliche Validierung je Bewertung (Mikrosekunden).

## ADR-023 · API-Versionierung über `/api` ohne Pfadversion bis v1.0, danach `/api/v2` bei Bruch

**Kontext.** Die REST-API hat externe Konsumenten (TMS, Excel-Add-in, Batch). Der Vertrag ist in OpenAPI (`/docs/json`) mit `operationId`, Request- und Response-Schemas, dokumentierten Fehlerantworten (400/404/409/412/413/422/429) und `servers: [{ url: "/" }]` festgeschrieben; ein Vertragstest (`apps/api/src/contract.test.ts`) friert die Liste der Operationen ein.
**Entscheidung.** Bis v1.0 bleibt der Pfad `/api/...` unversioniert; die API-Version ist die Paketversion (`info.version`, `GET /api/health`). Innerhalb einer Major-Version sind nur **additive** Änderungen erlaubt: neue optionale Felder, neue Endpunkte, neue Enum-Werte nur in Antworten. Entfernen oder Umbenennen von Feldern, Ändern von Statuscodes oder Fehlerformaten, Verschärfen von Request-Schemas für bisher gültige Bodies gelten als Bruch und erfolgen ausschließlich unter neuem Präfix `/api/v2/...`, während `/api/...` (dann Alias auf v1) mindestens eine Minor-Version parallel bedient wird und mit `Deprecation`-/`Sunset`-Header angekündigt wird. Header-Verträge (`X-Request-Id`, `X-Market-Snapshot-Id`, `ETag`/`If-Match`/`If-None-Match`) gehören zum Vertrag.
**Alternativen.** Sofortiges `/api/v1`: kostet nichts, verspricht aber Stabilität, die vor v1.0 (Auth, Persistenz) nicht zugesagt werden kann. Header-Versionierung (`Accept: application/vnd.deriva.v2+json`): schwer in Excel/curl, schlecht cachebar.
**Konsequenzen.** + Konsumenten können Clients aus `/docs/json` generieren (`operationId`-stabil) und Brüche am Pfad erkennen. − Bis v1.0 ist die Verschärfung eines Schemas (z. B. `additionalProperties: false` für Trades in v0.2) formal ein Bruch, der im CHANGELOG als „Geändert" ausgewiesen wird.
**Ergänzung (Review R3, N3-02/N3-07).** Das Dokument deklariert OpenAPI **3.1.0** (die Validierungsschemas nutzen JSON-Schema-2020-12-Keywords wie numerisches `exclusiveMinimum`, `propertyNames`, `examples`) und benennt `components.schemas` nach den `$id`s der geteilten Schemas; generierte SDK-Typen heißen damit `Trade`/`InterestRateSwap`/… statt `Def0`… – im CHANGELOG 0.2.0 als „Geändert" geführt. `If-Match` auf `PUT`/`DELETE /api/trades/:id` bleibt vertraglich optional (412 nur bei Abweichung); Betreiber, die verlorene Updates ausschließen müssen, setzen `REQUIRE_IF_MATCH=1` – dann antwortet die API ohne Header mit 428 `PRECONDITION_REQUIRED` (RFC 6585) und `currentEtag`, was im Dokument (`info.description`, Response 428) sichtbar ist. Ein Umschalten des Defaults auf „Pflicht" wäre ein Bruch und bleibt v2 vorbehalten.

## ADR-024 · Kuratierte Public API des Pricing-Cores und SemVer

**Kontext.** `packages/pricing-core/src/index.ts` exportiert 30+ Module per `export *` (F-13). Damit ist jede interne Hilfsfunktion Teil der öffentlichen Oberfläche und jede Umbenennung ein potenzieller Bruch für API und Web.
**Entscheidung.** Der Core folgt SemVer auf Paketebene (`package.json`, `ENGINE_VERSION` aus derselben Quelle). Als **öffentlich** gelten: Typen in `instruments/types.ts`, `MarketContext` und Snapshot-Format (`deriva.market/1`), Builder (`make*`), `priceTrade`/`pricePortfolio`, `computeRisk`/`parRisk`/`parRiskPortfolio`/`vegaBuckets`, `runScenarios`/`scenarioGrid`/`STANDARD_SCENARIOS`, `computeXva`, `buildValuationReport`/`cashflowTable`/`toCsv`, `emirValuationRecord`/`emirCsv`, `generateTermsheet`/`generateSuitabilityStatement`, Hedge-Accounting (`hedgeEffectivenessReport`, `hypotheticalDerivative`), `PricingError`/`isPricingError`, Datums-/Kalenderfunktionen (`parseISO`, `toISO`, `advance`, `getCalendar`, `addTenor`) sowie `stableStringify`/`hashString`. Alles andere (Interpolations-Internals, Pricer-Hilfsfunktionen, Modulzähler wie `nextTradeId`) ist **intern** und wird in v0.3 aus `index.ts` entfernt bzw. in einen `internal`-Einstiegspunkt verschoben. Änderungen an öffentlichen Signaturen oder an Bewertungsergebnissen für unveränderte Inputs (z. B. Konventionsänderungen) erhöhen mindestens die Minor-Version und werden im CHANGELOG unter „Geändert" mit Referenz auf den Golden-Master-Test (ADR-021) begründet.
**Konsequenzen.** + API und Web hängen an einer benannten Oberfläche; Prüfer können die Engine-Version einem Ergebnis zuordnen. − Einmalige Aufräumarbeit an `index.ts` und den Importen der Apps.

## ADR-025 · Logging, Request-Korrelation und Fehlerklassifikation der API

**Kontext.** Runde-2-Review (N-06, N-12, F-19): Logger ohne Level/Redaction, eingehende `x-request-id` verworfen, `TypeError`-Texte als 422 nach außen, kein `code` im Fehlerobjekt.
**Entscheidung.** Die API loggt strukturiert über pino mit `LOG_LEVEL` (Default `info`), redigiert `authorization` und `cookie`, deaktiviert das Per-Request-Logging unter `NODE_ENV=production` und übernimmt eine eingehende `x-request-id` (Token `^[A-Za-z0-9._:-]{1,128}$`) als Request-ID; jede Antwort trägt `X-Request-Id`, bewertungsbezogene Antworten zusätzlich `X-Market-Snapshot-Id` (identisch mit `audit.snapshotId` des Reports). Fehler werden an einer Stelle klassifiziert (`apps/api/src/lib/errors.ts`): Schema-Verstöße → 400 mit `validation[]`; `PricingError` (Duck-Typing über `name`/`code`, ADR-022) → 422 `{ error, code, details?, statusCode, requestId }`; `TypeError`/`RangeError` aus einem Pricer → 400 „Invalid trade" mit `warn`-Log (kein Stack nach außen); Fehler mit `statusCode` behalten ihn (404/409/412/413/429); alles Übrige → 500 generisch mit `error`-Log. Swagger UI ist nur außerhalb `production` registriert; `/docs/json` bleibt immer erreichbar.
**Alternativen.** OpenTelemetry-Tracing: sinnvoll ab Multi-Instanz-Betrieb (v1.0), heute Overhead ohne Backend.
**Konsequenzen.** + Gateway-Korrelation, keine Interna in Antworten, maschinenlesbare Fehlercodes für Clients. − Ein `TypeError` aus einem echten Programmierfehler wird dem Aufrufer als „Invalid trade" gemeldet; die Ursache steht nur im Log (bewusst: Trade-Eingaben sind die einzige Quelle solcher Fehler in dieser API).

## ADR-026 · Worker-Grenze und Performance-Budget

**Kontext.** Der Core rechnet im Browser synchron im zustand-Store (ADR-009); Par-Risk mit Re-Bootstrapping kostet ≈ 1 s je Trade, Vega-Buckets und Szenario-Grids skalieren mit Trades × Shifts.
**Entscheidung.** Budget: Einzelbewertung < 5 ms, Portfolio (≤ 100 Trades) inkl. DV01 < 1 s, interaktive Aktionen (What-if-Hotkeys) < 50 ms auf dem Hauptthread. Alles, was das Budget überschreitet – Par-Risk, Vega-Buckets, Grids > 21×21, Portfolios > 500 Trades, künftig Monte-Carlo (US-4.4) – läuft **nicht** im Render-Pfad: in der API als eigener Endpunkt mit Limits (`ratesBp`/`fxPct` ≤ 41, `trades` ≤ 5000 bzw. 200 für Par-Risk-Portfolio, Body ≤ 5 MB, Rate-Limit), im Web als asynchrone Aktion, die künftig in einen Web Worker (`comlink`-freie `postMessage`-Schicht über den isomorphen Core) ausgelagert wird; der Store hält nur Ergebnisse und Cache. Risiko wird aus dem Render heraus per Effekt angestoßen (N-09), nicht per `set()` während des Renderns.
**Konsequenzen.** + Klare Grenze, die Performance-Regressionen sichtbar macht; API-Limits schützen den Server (F-09). − Worker-Transfer erfordert serialisierbare Marktkontexte (Snapshot-Format vorhanden) und eine zweite Instanz des Cores im Browser.
