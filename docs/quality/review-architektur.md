# DERIVA – Architektur-, API- und Code-Review (Dimensionen 5 und 6)

**Rolle:** Principal Software Architect / Staff Engineer · **Modus:** Review only, keine Quelländerungen
**Stand:** Commit `2cb1571` **plus** ungetrackte/ungestagte Arbeitskopie vom 2026-09-03 (siehe Abschnitt 0)
**Methode:** Code-Lektüre aller Workspaces, `pnpm test` in allen drei Paketen (74 + 7 + 15 Tests grün), API-Probing gegen `node dist/server.js` (Port 4020/4021, `curl`), Abruf von `/docs/json`, Mikro-Benchmark gegen `@deriva/pricing-core` (dist), Produktions-Build von `apps/web`.

---

## 0. Hinweis zum Review-Stand

Während des Reviews wurde die Arbeitskopie parallel verändert (Dateien tauchten nach der ersten Verzeichnisaufnahme auf, `dist` wurde um 20:15 neu gebaut). Der Report bewertet den Stand **inklusive** dieser ungetrackten Dateien, kennzeichnet sie aber, weil sie weder committet noch in der Doku erwähnt sind:

| Datei | Status | Inhalt |
|---|---|---|
| `packages/pricing-core/src/market/snapshot.ts` | untracked | `serializeMarket` / `deserializeMarket` / `validateMarket` (Schema `deriva.market/1`) |
| `packages/pricing-core/src/market/snapshot.test.ts` | untracked | 7 Tests (Snapshot-Round-Trip, EMIR, neue Builder) |
| `packages/pricing-core/src/reporting/emir.ts` | untracked | `emirValuationRecord`, `emirCsv` |
| `apps/api/src/routes/snapshot.ts` | untracked | `GET/PUT /api/market/snapshot`, `GET /api/emir/valuations` |
| `packages/pricing-core/src/instruments/builders.ts` | modified | `makeBasisSwap`, `makeAmortisingSwap`, `makeImmSwap`, `makeFxSwap`, `linearAmortisation` |
| `packages/pricing-core/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts` | modified | Exporte / Registrierung / 1 API-Test |
| `LICENSE` | untracked | MIT-Text |

**Review-Cut-off:** 2026-09-03 ≈ 20:20 UTC. Danach entstandene Änderungen (u. a. `apps/api/src/schemas.ts`, `apps/web/src/components/ErrorBoundary.tsx`, weitere Modifikationen in Routen, Views, Core und Produkt-Doku) sind **nicht** bewertet; Findings, die dadurch bereits adressiert sind, bitte im nächsten Scorecard-Durchlauf gegenprüfen.

Empfehlung: diese Arbeit in einem eigenen Commit („feat(core,api): market snapshot import/export, EMIR valuation export, additional builders") abschließen und `README.md`, `docs/product/02-epics-und-user-stories.md` (US-6.5 → ✅/🔶) sowie `docs/architecture/01-architektur.md` §4 nachziehen.

---

## 1. Scores

### 1.1 API, Architektur, Code-Qualität: **58 / 100**

**Was trägt (Positiv):**
- Saubere Monorepo-Struktur (pnpm-Workspaces, `tsconfig.base.json` mit `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`), klare Paketgrenzen, `@deriva/pricing-core` ohne Runtime-Abhängigkeiten und ohne Node-APIs (isomorph nachgewiesen: läuft in Vitest/jsdom, Node und Vite-Bundle).
- Immutabler `MarketContext` mit Kopien statt Mutation; Bump-and-Reprice und Szenarien sind dadurch trivial parallelisierbar.
- Performance deutlich besser als die Doku behauptet: 0,05 ms/Trade Pricing (100 Trades in 5,3 ms), volles Bucket-Risiko für 100 Trades in 366 ms, What-if-Bump + Repricing der 11 Sample-Trades in 0,3 ms.
- API-Tests über `app.inject` ohne Netzwerk, UI-Tests mit Testing Library, Hotkey-Matching und Quick-Parser unit-getestet.
- Fehlerbehandlung im Core ist an vielen Stellen defensiv (Warnungen statt stiller Fallbacks, z. B. „Missing fixing … used curve forward"; `pricePortfolio` isoliert Fehler je Trade).

**Was den Score drückt (Abzüge, gewichtet nach Rubrik):**
- **Keine Request-Validierung** an der API-Grenze (−15): 0 von 24 Operationen besitzen ein Body-Schema. Fehlende/typfalsche Felder führen zu `200 OK` mit `pv: null` (NaN → JSON `null`) **ohne Warnung** – für eine Bewertungs-API ein kritischer Fehler (nachgewiesen für fehlendes `notional` und `rate: "3%"`). Interne `TypeError`-Meldungen werden als 400 nach außen gereicht („Cannot read properties of undefined (reading 'type')", „Invalid array length").
- **OpenAPI ohne Vertragswert** (−8): keine Request-/Response-Schemas, keine `operationId`s, keine Beispiele, keine Fehlerantworten, kein `servers`-Block. SDK-Generierung ist damit nicht möglich; `/docs` ist eine Endpunktliste, kein Vertrag.
- **Sicherheit / Betrieb** (−8): keine Security-Header, kein Rate-Limit, CORS reflektiert jede Origin, kein Auth (v0.1 dokumentiert, aber auch kein Feature-Flag/Platzhalter), Header-Injection in `content-disposition` über `trade.id` nachgewiesen, unbegrenzte Rechen-Endpunkte (`/api/scenarios/grid` ohne Größenlimit).
- **REST-Semantik und Konsistenz** (−5): drei verschiedene Fehlerformate, `POST /api/trades` ist ein Upsert mit 200 statt 201/409, `PUT` ohne `If-Match`/ETag trotz vorhandener `version`, globaler mutierbarer Markt-Singleton für alle Clients; `PUT /api/market {valuationDate}` verwirft zuvor gesetzte Spots/Kurven (nachgewiesen: EURUSD 1.5 → 1.1625).
- **Code-Qualität-Tooling** (−4): kein ESLint/Prettier (die `lint`-Skripte rufen nur `tsc`), keine Coverage-Schwellen, kein Coverage-Provider installiert, `void disc; void splitPair;`-Hacks statt `noUnusedLocals`.
- **CI** (−2): `pnpm/action-setup@v4` mit `version: 10` **und** `packageManager: pnpm@10.33.0` im Root – die Action lehnt widersprüchliche Doppelangaben ab („Multiple versions of pnpm specified"); Workflow läuft doppelt (push auf alle Branches + pull_request), kein `concurrency`, kein Lint-, Coverage- oder E2E-Schritt, Artefakt enthält 7,3 MB Source-Maps.

### 1.2 Dokumentation & Compliance: **62 / 100**

**Was trägt:** umfangreiche, gut strukturierte Dokumentation (Research → Vision → Epics mit Status und AK → UI-Konzept → C4-Architektur → 12 ADRs), README mit Quickstart, Hotkeys und API-Beispiel, Methodik-Kurzfassung. Regulatorische Bausteine (IFRS 13, MiFID II, BGH XI ZR 33/10, EMIR) sind benannt und im Report-Objekt verankert.

**Abzüge:**
- **Unwahre oder veraltete Aussagen** (−12): „63 Tests" (README, Architektur) – tatsächlich 67 committet / 74 in Arbeitskopie; „`MarketStore`/`TradeStore` als Interfaces" – es sind konkrete Klassen, Routen hängen an den Klassen; „Test deckt Kernfelder ab" (ADR-007) – es gibt keinen Unit-Test für `lib/dates.ts`; „CSV (Semikolon, **deutsches Format**)" (US-6.3) – Dezimaltrenner ist der Punkt (`10000000.00`), in deutschem Excel werden Beträge damit als Text importiert; „EMIR-Bewertungsfelder sind eingebaut" (Vision §2.5) vs. US-6.5 „⏳ Roadmap"; „12 Trades" (Architektur §6, UI-Konzept) vs. 11 (Web) / 10 (API) Sample-Trades; Chord-Fenster 800 ms (keymap.ts) vs. 900 ms (ADR-008, UI-Konzept, Code).
- **Fehlende ADRs** (−8): Validierungs- und Fehlerstrategie an der API-Grenze, API-Versionierung, Sicherheitsmodell (CORS/Auth/Rate-Limit), Test- und Coverage-Strategie, Tooling (pnpm/Vitest/Vite), CSV-/Export-Formate (Locale), Schema-/Versionierung von Snapshots (`deriva.market/1` existiert im Code, aber nirgends dokumentiert), Audit-Trail/Report-Integrität.
- **Repo-Hygiene** (−6): `LICENSE` erst jetzt (untracked) vorhanden, obwohl `"license": "MIT"` in drei `package.json` steht; kein `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, keine Issue-/PR-Templates; Version „0.1.0" an drei Stellen hart kodiert (`app.ts` health + swagger, `package.json`).
- **Compliance-Substanz des Reports** (−8): `ifrs13Level` ist hart auf 2 gesetzt (`trade.barrier ? 2 : 2` – toter Code); Barrier-/Digital-Optionen und Trades mit `volOverride` erhalten dieselbe „Level 2"-Begründung. Der „prüfungsfähige" Report enthält weder Engine-Version, noch Snapshot-Kennung/Hash, Report-ID, Ersteller oder Input-Hash – ohne diese Felder ist Reproduzierbarkeit nur behauptet. EMIR-Export (untracked) setzt `valuationTimestamp` hart auf `17:00:00Z` und kennt keine UTI-Quelle.
- **Ungetrackte Arbeit nicht dokumentiert** (−4): Snapshot-Import/Export und EMIR-Export existieren im Code, fehlen aber in README, Epics-Status und Architektur §4.

---

## 2. Findings

Schwere: **Kritisch** (falsches Ergebnis / Sicherheitslücke), **Hoch** (Architektur- oder Vertragsbruch mit Folgekosten), **Mittel** (Qualität, Wartbarkeit, Doku-Inkonsistenz mit Außenwirkung), **Niedrig** (kosmetisch / lokal).

| # | Schwere | Ort | Problem | Konkreter Fix |
|---|---|---|---|---|
| F-01 | **Kritisch** | `apps/api/src/routes/pricing.ts` (alle POST-Routen), `routes/trades.ts` | Kein Body-Schema. Fehlende/typfalsche Felder liefern `200` mit `pv: null` und leerem `warnings` (nachgewiesen: `delete legs[0].notional` → `pv:null`; `rate:"3%"` → alle PVs `null`). Ein Integrator (TMS, Excel) erhält stille Falschwerte. | TypeBox-Schemas + `@fastify/type-provider-typebox` für jeden Body (Snippet §3.1). Zusätzlich im Core `assertFinite(pv)` in `priceTrade` und Warnung/Fehler bei `Number.isNaN`. Kurzfristig als Guard in `priceTrade`: `if (!Number.isFinite(res.pv)) throw new Error(\`Non-finite PV for ${trade.id}\`)`. |
| F-02 | **Kritisch** | `apps/api/src/routes/pricing.ts:107`, `routes/snapshot.ts:43` | Header-Injection: `content-disposition: attachment; filename="${trade.id}-cashflows.csv"` mit `trade.id = 'x"; evil=1'` erzeugt `filename="x"; evil=1-cashflows.csv"` (nachgewiesen). | `const safe = trade.id.replace(/[^A-Za-z0-9._-]/g, "_"); reply.header("content-disposition", \`attachment; filename="${safe}-cashflows.csv"; filename*=UTF-8''${encodeURIComponent(trade.id)}-cashflows.csv\`)`. Zusätzlich `id`-Pattern im Schema: `^[A-Za-z0-9._-]{1,64}$`. |
| F-03 | **Hoch** | `apps/api/src/app.ts:56-60` | Globaler Error-Handler mappt **jeden** Fehler (auch `TypeError`, `RangeError`) auf `400` und gibt die interne Meldung ungefiltert aus („Cannot read properties of undefined (reading 'type')", „Invalid array length"). 5xx-Fehler werden als Client-Fehler verschleiert; kein Logging des Fehlers. | Fehlerklassen im Core (`PricingError extends Error { code }`), im Handler: `if (err.validation) 400; else if (err instanceof PricingError) 422; else { req.log.error(err); 500 mit generischer Meldung }`. Einheitliches Fehlerobjekt `{ statusCode, error, message, code?, requestId }` (RFC 9457 `application/problem+json` erwägen). |
| F-04 | **Hoch** | `/docs/json` (Probing: 24 Operationen, 0 `requestBody`, 0 typisierte Responses, 0 `operationId`) | OpenAPI ist nur eine Pfadliste („Default Response"). Kein SDK generierbar, kein Vertragstest möglich, `GET /api/health` trägt Tag `market`. | Schemas aus F-01 wiederverwenden; `operationId` je Route; `response: { 200: PricingResultSchema, 400: ErrorSchema, 422: ErrorSchema }`; `examples` aus `app.test.ts` ableiten; `servers: [{ url: "/api" }]`; Swagger-`transform` für `hideUntagged`. Vertragstest: `expect(app.swagger()).toMatchSnapshot()`. |
| F-05 | **Hoch** | `apps/api/src/lib/store.ts:20-35`, `routes/market.ts:109-123` | Ein prozessweiter, mutierbarer Markt-Snapshot für alle Clients. `PUT /api/market {valuationDate}` ruft `rebuild()` und verwirft zuvor gesetzte Spots/Kurven/Fixings (nachgewiesen: EURUSD 1.5 → 1.1625). Kein Snapshot-Identifier in Pricing-Antworten → Ergebnisse sind nicht auf einen Marktstand rückführbar. | `MarketStore` versionieren: `{ id: uuid, ctx, createdAt }`; `PUT /api/market` rollt Overrides auf den neuen Basismarkt statt zu verwerfen; jede Pricing-Antwort liefert `marketSnapshotId`; optional `X-Market-Snapshot` Request-Header für Pricing gegen einen bestimmten Snapshot. Die ungetrackten Snapshot-Routen (`snapshot.ts`) sind der richtige Baustein – darauf aufsetzen. |
| F-06 | **Hoch** | `apps/api/src/routes/trades.ts:35-48` | `POST /api/trades` ist ein stiller Upsert (`version` 1 → 2, `200` statt `201`), `PUT` prüft keine Vorversion (Lost Update), kein `ETag`/`If-Match`, kein `Location`-Header. | `POST` → `201` + `Location` bei neu, `409 Conflict` bei existierender ID; `PUT` erfordert `If-Match: "<version>"`, antwortet `412` bei Abweichung; `GET` setzt `ETag: "<version>"` (Snippet §3.5). |
| F-07 | **Hoch** | `.github/workflows/ci.yml:12-14`, `package.json:7` | `pnpm/action-setup@v4` mit `version: 10` bei gleichzeitigem `packageManager: pnpm@10.33.0` – die Action bricht bei widersprüchlicher Doppelangabe ab. Zusätzlich: doppelte Läufe (push `**` + pull_request), kein `concurrency`, kein Lint/Coverage/E2E, Source-Maps (7,3 MB) im Artefakt. | `version:` aus dem Workflow entfernen (Action liest `packageManager`); `on: { push: { branches: [main] }, pull_request: {} }`; `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`; Schritte `pnpm lint`, `pnpm test -- --coverage`, Playwright (Snippet §3.12). |
| F-08 | **Hoch** | `apps/api/src/app.ts:27` (CORS), keine Security-Header, kein Rate-Limit | `origin: true` reflektiert jede Origin (nachgewiesen `access-control-allow-origin: https://evil.example`); Preflight erlaubt nur `GET,HEAD,POST` – `PUT/DELETE` cross-origin schlagen fehl, sobald der Vite-Proxy entfällt. Keine `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`. | `@fastify/helmet`, `@fastify/rate-limit`, CORS aus `process.env.CORS_ORIGINS` (Snippet §3.7). |
| F-09 | **Hoch** | `apps/api/src/routes/pricing.ts:72-86`, `routes/market.ts:79-107`, `app.ts` | Unbegrenzte Rechenlast: `/api/scenarios/grid` akzeptiert beliebig große `ratesBp × fxPct` (40×40 gegen 10 Trades = 0,45 s; 200×200 gegen 100 Trades wären ~5 Minuten Event-Loop-Blockade), Portfolios beliebiger Größe, Body-Limit nur Fastify-Default (1 MiB). | Schema-Limits: `ratesBp: Type.Array(Type.Number(), { maxItems: 25 })`, `trades: maxItems 500`, `quotes: maxItems 60`; `bodyLimit: 512 * 1024`; CPU-schwere Routen in `worker_threads`/Piscina auslagern oder `429` bei Sättigung. |
| F-10 | **Hoch** | `packages/pricing-core/src/reporting/valuation-report.ts:64,80-83` | IFRS-13-Level hart kodiert (`trade.barrier ? 2 : 2`), Rationale generisch. Ein Report für eine Barrier-Option mit `volOverride` behauptet „beobachtbare Inputs → Level 2". Kein `engineVersion`, `reportId`, `marketSnapshotId`, `inputHash`. | Level-Logik: `volOverride`/fehlende Fläche → Level 3 mit Begründung; Barrier/Digital → Level 2 nur mit Smile aus Fläche, sonst 3. Report um `{ reportId: uuid, engineVersion: pkg.version, marketSnapshotId, inputHash: sha256(canonicalJson(trade, snapshot)) }` erweitern (Snippet §3.4). |
| F-11 | **Mittel** | `apps/api/src/lib/dates.ts` | Heuristisches Datums-Mapping: Konvertierung anhand Schlüsselnamen **und** Wertebereich (`10_000 < v < 100_000`). Nicht-ISO-Strings (`"07.09.2026"`) rutschen durch und enden als `RangeError` im Core; ein Feld `date` mit Integer 20 000 wird ungewollt zu ISO. `analytics.maturity` (Serial) wird stillschweigend zu ISO, obwohl `analytics` als `Record<string, number|string>` typisiert ist. Kein Unit-Test (ADR-007 behauptet einen). | Mit Schemas (F-01) entfällt der Ratebedarf: `Type.String({ format: "date" })` + `ajv-formats`; Konvertierung explizit im Schema-Hook. Bis dahin: ISO-Regex-Fail bei String auf Datumsschlüssel → `400 { code: "INVALID_DATE", path }`; `dates.test.ts` für Round-Trip, verschachtelte Arrays, Nicht-ISO-Strings. |
| F-12 | **Mittel** | `packages/pricing-core/src/reporting/valuation-report.ts:168-170`, `reporting/emir.ts:91-121` | CSV: Semikolon-Trenner, aber Punkt-Dezimal → in DE-Excel Text/Datumsfehler („deutsches Format" laut US-6.3 ist falsch). Kein UTF-8-BOM (Umlaute in Excel kaputt), keine Formel-Injection-Absicherung (`=`, `+`, `-`, `@` am Zellanfang), `emirCsv` quotet Felder gar nicht (Counterparty mit `;` zerreißt die Zeile). | `toCsv(rows, { sep: ";", decimal: ",", bom: true })`; Zellen mit `/^[=+\-@]/` mit `'` prefixen; `emirCsv` über `toCsv` implementieren. Format-Entscheidung als ADR („CSV-Export: Locale, Trenner, BOM"). |
| F-13 | **Mittel** | `packages/pricing-core/src/index.ts` (`export *` aus 27 Modulen, 434 Exporte) | Keine kuratierte Public API: interne Helfer (`spotDate`, `tenorLabel`, `withCurves`, `bilinear`, `nextTradeId` mit modulglobalem Zähler, `SAMPLE_*`) sind gleichrangig mit `priceTrade`. Semver-Verträge damit praktisch nicht haltbar. | `index.ts` als explizite Export-Liste; interne Module unter `./internal/*`; `nextTradeId` aus dem Core entfernen (ID-Vergabe ist Aufgabe des Aufrufers) oder mit injizierbarem Generator; `package.json` `exports` um `"./sample"` für Demo-Daten ergänzen. API-Extractor/`@microsoft/api-extractor` oder `typedoc` als Doku-Gate. |
| F-14 | **Mittel** | `packages/pricing-core/src/instruments/types.ts`, `curves/curve.ts:33-37`, `xva/cva.ts:35`, `market/market-context.ts:39` | Namens-/Semantik-Inkonsistenzen: `payReceive` bedeutet je Instrument Pay/Receive-Fixed (Swap), Long/Short (Option) oder Fest-Zahlen (FRA) – nur per Kommentar erklärt; `Curve.shiftedNode(i, bpShift)` erwartet Dezimal (1e-4), nicht bp; `CreditInputs.cptyHazard` vs. `MarketContext.credit[].hazardRate`; FX-Paar einmal als `pair: "EURUSD"` (Option), einmal als `buyCurrency/sellCurrency` (Forward); `ForwardRateAgreement` vs. Literal `"FRA"`. | Optionen: eigenes Feld `position: "Long" | "Short"`; `shiftedNode(i, shift)` mit JSDoc „decimal, 1e-4 = 1bp" oder Typ-Alias `Decimal`; einheitlich `hazardRate`/`recovery`; `FxForward` optional um `pair` ergänzen und `buy/sell` daraus ableiten. Breaking Changes vor 1.0 sammeln, CHANGELOG. |
| F-15 | **Mittel** | `packages/pricing-core/src/curves/curve.ts:234-244`, `market/snapshot.ts` (untracked) | `InterpolatedCurve.toJSON()` serialisiert `referenceDate`/`nodes[].date` als Serial-Integer (nicht ISO) und kennt kein `fromJSON` – die Snapshot-Serialisierung (untracked) baut daneben ein zweites Format. `MarketContext.curves` hält Klasseninstanzen → `structuredClone`, Web Worker `postMessage` und Redux-DevTools verlieren die Methoden. | `Curve` als reine Datenstruktur (`CurveData`) + Funktionen (`df(curve, d)`) **oder** `InterpolatedCurve.fromJSON(json)` mit demselben Format wie `serializeCurve`. `toJSON` auf ISO umstellen, damit ein einziges Wire-Format existiert. |
| F-16 | **Mittel** | `apps/web/src/state/store.ts`, `views/Blotter.tsx:16-28` | Repricing läuft synchron im `keydown`-Handler und auf jedem Slider-`onChange` (kein rAF/Debounce); für 11 Trades irrelevant (0,3 ms), bei >500 Trades blockiert die UI (ADR-009 nennt das). `Blotter` rechnet DV01 (`computeRisk`, 5 Pricings/Trade) im `useMemo` je Render **neben** dem `riskCache` des Stores (doppelte Rechnung, inkonsistente Quelle). `addTrade` leert den gesamten `riskCache`, `updateTrade` nur den Eintrag; `removeTrade` lässt den Cache-Eintrag stehen. `risk()` schreibt per `set()` während des Renders (kein React-Warning gemessen, aber Seiteneffekt im Render). | Pricing/Risk in einen Web Worker (Snippet §3.9); Blotter liest `riskCache` und stößt fehlende Risiken per Effekt an; Cache-Invalidierung zentral in einer Funktion `invalidateRisk(ids?)`; Slider mit `requestAnimationFrame`-Throttle. |
| F-17 | **Mittel** | `apps/web/src/App.tsx:29`, alle Views (`useStore()` ohne Selektor) | Jede Komponente abonniert den gesamten Store → jede Toast-/Chord-Änderung rendert App, Blotter, PricingWorkspace neu (mit ECharts-`setOption`). `onHotkey` (`useCallback` mit `[s, …]`) wird bei jeder Store-Änderung neu erzeugt. | Selektoren (`useStore(s => s.view)`), `useShallow` für Objekt-Slices, Aktionen über `useStore.getState()` statt aus dem gerenderten Snapshot. |
| F-18 | **Mittel** | `apps/web/vite.config.ts`, `components/EChart.tsx:2` | Ein Chunk mit 1,39 MB (451 kB gzip), `import * as echarts from "echarts"` ohne Tree-Shaking, Source-Maps (7,3 MB) im Produktions-Build und CI-Artefakt. Kein Error Boundary → ein Pricer-Throw im Render (z. B. `TradeEditor` bei `legs[0]!`) weißt die ganze App. | `echarts/core` + benötigte Charts/Komponenten registrieren; `build.rollupOptions.output.manualChunks` (`echarts`, `pricing-core`); `sourcemap: "hidden"` oder nur im Dev; `<ErrorBoundary>` je View (Snippet §3.10). |
| F-19 | **Mittel** | `apps/api/src/server.ts`, `app.ts:21` | Logging: pino-JSON vorhanden, aber `reqId` ist `req-1…` – eingehende `x-request-id` wird ignoriert, kein Response-Header, keine Redaction, jeder Request loggt „incoming request" auf `info` (Lärm in Produktion). Kein `/ready` getrennt von `/health`; Version dreifach hart kodiert. | `genReqId: req => req.headers["x-request-id"] ?? randomUUID()`, `onSend`-Hook setzt `x-request-id`; `logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] }`; `/api/health/live` + `/api/health/ready` (prüft Snapshot geladen); Version aus `package.json` via `createRequire` (Snippet §3.6). |
| F-20 | **Mittel** | `docs/architecture/01-architektur.md:69,82,83`, `02-adrs.md:44`, `README.md:16`, `docs/product/01-vision-und-module.md:30`, `02-epics…:88`, `03-ui-konzept…:17,64`, `apps/web/src/hotkeys/keymap.ts:5` | Dokumentierte Aussagen stimmen nicht mit dem Code überein (siehe 1.2): Testanzahl, Store-Interfaces, `dates.ts`-Test, deutsches CSV-Format, EMIR „eingebaut", 12 Trades, 800/900 ms. | Zahlen aus dem Code generieren (Vitest-Reporter → Badge) oder weglassen; Aussagen korrigieren; ADR-006 auf „Klassen, Interface-Extraktion geplant" ändern **oder** Interfaces einführen (`interface TradeRepository`). Doku-Check als CI-Job (`markdown-link-check`, Grep auf bekannte Zahlen). |
| F-21 | **Mittel** | `docs/architecture/02-adrs.md` | Fehlende Entscheidungen: Validierungs-/Fehlerstrategie, API-Versionierung (`/api/v1`), Sicherheitsmodell, Test-/Coverage-Strategie, Tooling (pnpm, Vitest, Vite, kein ESLint – warum?), Snapshot-Schema-Versionierung (`deriva.market/1`), Export-Formate/Locale, Audit-Trail/Report-Integrität, Web-Worker-Grenze. | ADR-013 bis ADR-020 anlegen (Vorlage: Kontext/Entscheidung/Alternativen/Konsequenzen, wie bisher). |
| F-22 | **Mittel** | Repo-Root | `LICENSE` nur untracked; kein `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, `.editorconfig`, keine Issue-/PR-Vorlagen; `docs/quality/00-bewertungsrubrik.md` referenziert `01-scorecard-runde-N.md`, die nicht existieren. | Dateien anlegen (Snippets §3.14–3.16); Changesets für CHANGELOG; Dependabot/Renovate-Konfiguration. |
| F-23 | **Mittel** | `apps/api/package.json`, `apps/web/package.json`, `packages/pricing-core/package.json` (`exports` → `dist`) | Apps und deren Tests importieren den **gebauten** Core. Ohne `pnpm --filter @deriva/pricing-core run build` schlagen `pnpm test`/`pnpm dev` fehl bzw. testen gegen veraltetes `dist`; `pnpm dev` hat keinen Core-Watch. | `exports` um Condition `"development": "./src/index.ts"` ergänzen und Vite/Vitest `resolve.conditions: ["development"]` setzen, oder `tsconfig.paths` + Vite-Alias auf `src`; Root-Script `dev` um `pnpm --filter @deriva/pricing-core run build -- --watch` erweitern; `pretest` im Root baut den Core. |
| F-24 | **Niedrig** | `apps/api/src/routes/trades.ts:37`, `pricing.ts:36-44` | `POST /api/trades` „validiert durch Probe-Bewertung" ohne `reportingCurrency` → Standard ist Leg-Währung, d. h. ein Trade kann angelegt werden, obwohl die spätere Bewertung in EUR (FX-Spot fehlt) scheitert. `/api/price/portfolio` mit `trades: []` bewertet den Store statt eines leeren Portfolios (`!req.body.trades` ist false, aber `useStore` undefined → korrekt; jedoch `trades: null` → Store). | Probe-Bewertung mit Ziel-Reporting-Währung; Schema `trades: Type.Optional(Type.Array(…))` und explizites `source: "body" | "store"`. |
| F-25 | **Niedrig** | `apps/web/src/hotkeys/useHotkeys.ts:60-61,89` | `HOTKEYS.filter`/`new Set` bei jedem `keydown`; `Shift+D` löscht ohne Bestätigung/Undo; `Escape` sowohl global als auch in der Palette behandelt (doppelt). | Filter einmalig außerhalb des Handlers berechnen (`useMemo`); Undo-Stack für `removeTrade` (Toast „Rückgängig"); Escape nur an einer Stelle. |
| F-26 | **Niedrig** | `packages/pricing-core/src/instruments/builders.ts:156,181` | `toLocaleString("de-DE")` in Trade-Namen macht die Bibliothek ICU-/Runtime-abhängig (Node ohne full-icu liefert andere Ausgaben; verletzt „identische Ergebnisse in Web und API" für `name`). | Formatierung in die UI verlagern; Core liefert `name` ohne Locale-Formatierung oder mit fester Funktion. |
| F-27 | **Niedrig** | `tsconfig.base.json` | `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `verbatimModuleSyntax` fehlen; `exactOptionalPropertyTypes: false` explizit. `apps/web/vite.config.ts` nutzt `test:` ohne Vitest-Typreferenz (nicht typgeprüft, da außerhalb `include`). | Optionen aktivieren (die `void x;`-Hacks in `cva.ts` verschwinden dann sauber); `/// <reference types="vitest/config" />` oder `defineConfig` aus `vitest/config`. |

---

## 3. Schnell umsetzbare Verbesserungen (mit Snippets)

Reihenfolge nach Nutzen/Aufwand. Alles ist ohne Architekturbruch in Tagen umsetzbar.

### 3.1 JSON-Schema-Validierung für API-Bodies (TypeBox, Fastify-nativ)

```bash
pnpm --filter @deriva/api add @sinclair/typebox @fastify/type-provider-typebox ajv-formats
```

`apps/api/src/schemas/trade.ts` (Auszug – Union über `type`, Fastify/Ajv validiert diskriminiert):

```ts
import { Type, type Static } from "@sinclair/typebox";

export const IsoDate = Type.String({ format: "date", examples: ["2026-09-07"] });
export const Ccy = Type.String({ pattern: "^[A-Z]{3}$", examples: ["EUR"] });
export const TradeId = Type.String({ pattern: "^[A-Za-z0-9._-]{1,64}$" });

const LegBase = {
  payReceive: Type.Union([Type.Literal("Pay"), Type.Literal("Receive")]),
  notional: Type.Number({ exclusiveMinimum: 0 }),
  currency: Ccy,
  effectiveDate: IsoDate,
  terminationDate: IsoDate,
  frequency: Type.String({ pattern: "^(\\d+[DWMY]|ZC)$" }),
  dayCount: Type.String(),
  calendar: Type.String(),
  businessDayConvention: Type.Optional(Type.String()),
  stub: Type.Optional(Type.String()),
  paymentLag: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
};
export const FixedLeg = Type.Object({ type: Type.Literal("Fixed"), rate: Type.Number(), ...LegBase });
export const FloatLeg = Type.Object({ type: Type.Literal("Float"), index: Type.String(), spread: Type.Optional(Type.Number()), ...LegBase });
export const InterestRateSwap = Type.Object({
  id: TradeId, type: Type.Literal("InterestRateSwap"), name: Type.Optional(Type.String()),
  counterparty: Type.Optional(Type.String()), collateralCurrency: Type.Optional(Ccy),
  legs: Type.Array(Type.Union([FixedLeg, FloatLeg]), { minItems: 2, maxItems: 2 }),
}, { $id: "InterestRateSwap" });
// … FRA, CapFloor, Swaption, FxForward, FxSwap, FxOption, CrossCurrencySwap analog
export const Trade = Type.Union([InterestRateSwap /* , … */], { $id: "Trade" });
export const PriceBody = Type.Object({ trade: Trade, reportingCurrency: Type.Optional(Ccy) }, { $id: "PriceBody" });
export type PriceBodyT = Static<typeof PriceBody>;
```

`apps/api/src/app.ts`:

```ts
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import addFormats from "ajv-formats";
const app = Fastify({
  logger, ajv: { plugins: [addFormats], customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true } },
}).withTypeProvider<TypeBoxTypeProvider>();
for (const s of [IsoDate, Trade, PriceBody, ErrorResponse]) app.addSchema(s);
```

`apps/api/src/routes/pricing.ts`:

```ts
app.post("/api/price", {
  schema: {
    operationId: "priceTrade", tags: ["pricing"], summary: "Einzelnen Trade bewerten",
    body: Type.Ref(PriceBody), response: { 200: Type.Ref(PricingResult), 400: Type.Ref(ErrorResponse), 422: Type.Ref(ErrorResponse) },
  },
}, async (req) => datesToIso(priceTrade(ctx.market.get(), datesToSerial(req.body.trade), req.body.reportingCurrency)));
```

Damit ist F-01, F-04 (Schemas) und F-11 (Datumsformat) zu ~80 % erledigt. Test: `POST /api/price` mit `{}` muss `400` mit `validation`-Details liefern, nicht `TypeError`.

### 3.2 Markt-Snapshot Import/Export (liegt untracked vor – committen und härten)

`apps/api/src/routes/snapshot.ts` existiert bereits (`GET/PUT /api/market/snapshot`, 200/400/422). Ergänzen:

```ts
app.put("/api/market/snapshot", {
  schema: { operationId: "importMarketSnapshot", body: Type.Ref(MarketSnapshotJsonSchema), response: { 200: …, 400: …, 422: … } },
  bodyLimit: 4 * 1024 * 1024,
}, async (req, reply) => { /* wie vorhanden */ });
```

Zusätzlich `ETag`/`X-Market-Snapshot-Id` (sha256 des kanonischen JSON) auf `GET`, und `InterpolatedCurve.toJSON()` auf dasselbe Format (`serializeCurve`) umstellen (F-15). In der Web-UI: Buttons „Snapshot exportieren/importieren" in `MarketView` über `serializeMarket`/`deserializeMarket` (kein API nötig).

### 3.3 EMIR-Bewertungsexport (liegt untracked vor – fachlich nachschärfen)

`packages/pricing-core/src/reporting/emir.ts`: `valuationTimestamp` sollte aus `ctx.meta.snapshotTime` stammen (Fallback heutiges Datum + Snapshot-Zeit), nicht hart `17:00:00Z`; `uti`, `valuationMethod` (`MTMA` wenn `transactionPrice`/Marktpreis vorliegt, `CCPV` bei `clearing`), `delta` aus `computeRisk().fxDelta`/`dv01` für collateralisierte Trades; `emirCsv` über `toCsv` mit Quoting (F-12). Route `GET /api/emir/valuations` um `?valuationDate=` und `X-Market-Snapshot-Id` ergänzen; in `docs/product/02-epics…` US-6.5 auf 🔶 setzen.

### 3.4 Audit-Log und Report-Integrität

`apps/api/src/lib/audit.ts`:

```ts
export interface AuditEvent { ts: string; requestId: string; actor: string; action: string; target: string; before?: unknown; after?: unknown; hash: string }
export interface AuditSink { append(e: AuditEvent): Promise<void>; list(filter?: { target?: string }): Promise<AuditEvent[]> }
export class MemoryAuditSink implements AuditSink { private events: AuditEvent[] = []; async append(e) { this.events.push(e); } async list(f) { return this.events.filter(e => !f?.target || e.target === f.target); } }
export function withHash(e: Omit<AuditEvent, "hash">, prev?: string): AuditEvent {
  return { ...e, hash: createHash("sha256").update((prev ?? "") + JSON.stringify(e)).digest("hex") }; // Hash-Kette
}
```

In `TradeStore.upsert/delete` und `MarketStore.set` je ein `audit.append(...)`; Route `GET /api/audit?target=IRS-0001`. Im `ValuationReport`: `reportId`, `engineVersion`, `marketSnapshotId`, `inputHash` (siehe F-10). Das erfüllt US-6.6 in einem ersten Schnitt.

### 3.5 ETag / Version auf Trades

```ts
app.get("/api/trades/:id", …, async (req, reply) => {
  const t = ctx.trades.get(req.params.id); if (!t) return reply.code(404).send(notFound("Trade", req.params.id));
  return reply.header("ETag", `"${t.version}"`).send(datesToIso(t));
});
app.put("/api/trades/:id", …, async (req, reply) => {
  const cur = ctx.trades.get(req.params.id); if (!cur) return reply.code(404).send(…);
  const ifMatch = req.headers["if-match"]; if (ifMatch && ifMatch !== `"${cur.version}"`) return reply.code(412).send(problem(412, "Version mismatch", { current: cur.version }));
  …
});
app.post("/api/trades", …, async (req, reply) => {
  if (ctx.trades.get(req.body.id)) return reply.code(409).send(problem(409, "Trade exists", { id: req.body.id }));
  const stored = ctx.trades.upsert(trade);
  return reply.code(201).header("Location", `/api/trades/${stored.trade.id}`).header("ETag", `"1"`).send(datesToIso(stored));
});
```

### 3.6 Request-ID-Logging, Versionsquelle, Readiness

```ts
import { randomUUID, createRequire } from "node:crypto"; // createRequire aus "node:module"
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
const app = Fastify({
  genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
  logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie"] },
  disableRequestLogging: process.env.NODE_ENV === "production",
});
app.addHook("onSend", async (req, reply) => { reply.header("x-request-id", req.id); });
app.get("/api/health/live", async () => ({ status: "ok", version: pkg.version }));
app.get("/api/health/ready", async (_r, reply) => ctx.market.isLoaded() ? { status: "ready" } : reply.code(503).send({ status: "loading" }));
```

### 3.7 Helmet, Rate-Limit, CORS-Allowlist

```bash
pnpm --filter @deriva/api add @fastify/helmet @fastify/rate-limit
```

```ts
await app.register(helmet, { contentSecurityPolicy: false /* Swagger-UI */ });
await app.register(rateLimit, { max: Number(process.env.RATE_LIMIT ?? 300), timeWindow: "1 minute", keyGenerator: (r) => r.headers["x-api-key"] as string ?? r.ip });
await app.register(cors, {
  origin: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["content-type", "if-match", "x-request-id"], exposedHeaders: ["etag", "x-request-id"],
});
```

Für `/api/scenarios/grid` zusätzlich `config: { rateLimit: { max: 20, timeWindow: "1 minute" } }`.

### 3.8 OpenAPI-Beispiele und SDK-Generierung

Beispiele direkt im Schema (`examples: [...]`, TypeBox reicht sie durch) oder per `swagger`-Option `transform`. Generierung:

```bash
pnpm --filter @deriva/api add -D openapi-typescript
# apps/api/package.json
"openapi:emit": "node -e \"import('./dist/app.js').then(async m=>{const a=await m.buildApp({seedPortfolio:false});await a.ready();console.log(JSON.stringify(a.swagger(),null,2));await a.close()})\" > openapi.json",
"sdk": "openapi-typescript openapi.json -o ../../packages/api-client/src/schema.d.ts"
```

Neues Paket `packages/api-client` mit `openapi-fetch` (typsicher, 2 kB): `const api = createClient<paths>({ baseUrl }); await api.POST("/api/price", { body })`. `apps/web` kann später denselben Client nutzen. CI-Schritt: `openapi.json` committen und Diff prüfen (Vertragsänderung sichtbar im PR).

### 3.9 Web Worker für Pricing (Comlink)

`apps/web/src/worker/pricing.worker.ts`:

```ts
import * as Comlink from "comlink";
import { type MarketSnapshotJson, deserializeMarket, priceTrade, computeRisk, type Trade } from "@deriva/pricing-core";
let ctx = deserializeMarket(/* initial */);
const api = {
  setMarket(snap: MarketSnapshotJson) { ctx = deserializeMarket(snap); },
  priceAll(trades: Trade[], ccy: string) { return trades.map((t) => { try { return { id: t.id, result: priceTrade(ctx, t, ccy) }; } catch (e) { return { id: t.id, error: (e as Error).message }; } }); },
  risk(t: Trade, ccy: string) { return computeRisk(ctx, t, ccy, { bucketed: true, vega: true, theta: true }); },
};
Comlink.expose(api);
export type PricingWorker = typeof api;
```

Im Store: `const worker = Comlink.wrap<PricingWorker>(new Worker(new URL("../worker/pricing.worker.ts", import.meta.url), { type: "module" }))`; `setWhatIf` wird `async`, setzt `pricing: "pending"` und schreibt Ergebnisse mit laufender `epoch`, um veraltete Antworten zu verwerfen. Voraussetzung: Snapshot-Serialisierung (3.2) – genau deshalb lohnt F-15.

### 3.10 Error Boundaries in React

```tsx
// apps/web/src/components/ErrorBoundary.tsx
export class ErrorBoundary extends React.Component<{ name: string; children: React.ReactNode }, { error?: Error }> {
  state = { error: undefined as Error | undefined };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error(`[${this.props.name}]`, error, info.componentStack); }
  render() { return this.state.error ? <div className="card warning">Ansicht „{this.props.name}" konnte nicht gerendert werden: {this.state.error.message} <button onClick={() => this.setState({ error: undefined })}>Erneut versuchen</button></div> : this.props.children; }
}
// App.tsx
{s.view === "pricing" && <ErrorBoundary name="Pricing"><PricingWorkspace /></ErrorBoundary>}
```

### 3.11 Bundle: ECharts tree-shaken, Chunks, Source-Maps

```ts
// apps/web/src/components/echarts.ts
import * as echarts from "echarts/core";
import { BarChart, LineChart, HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
export { echarts };
// vite.config.ts
build: { sourcemap: "hidden", rollupOptions: { output: { manualChunks: { echarts: ["echarts/core", "echarts/charts", "echarts/components", "echarts/renderers"], core: ["@deriva/pricing-core"] } } } }
```

Erwartung: Hauptchunk < 400 kB, ECharts-Chunk ~500 kB gzip ~170 kB, cachebar.

### 3.12 Playwright-E2E in CI

```bash
pnpm --filter @deriva/web add -D @playwright/test
```

`apps/web/e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
test("quick entry creates and prices a swap", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+K");
  await page.getByRole("dialog", { name: "Command Palette" }).getByRole("textbox").fill("irs 10y pay 3.1% 10m");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Par-Satz/)).toBeVisible();
  await page.keyboard.press("]");
  await expect(page.getByText(/What-if \+10bp/)).toBeVisible();
});
```

`playwright.config.ts` mit `webServer: { command: "pnpm preview --port 4173", url: "http://localhost:4173" }`. CI-Job:

```yaml
  e2e:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4          # ohne version: – liest packageManager
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @deriva/pricing-core run build && pnpm --filter @deriva/web run build
      - run: pnpm --filter @deriva/web exec playwright install --with-deps chromium
      - run: pnpm --filter @deriva/web exec playwright test
```

### 3.13 Coverage-Schwellen

```bash
pnpm -r add -D @vitest/coverage-v8
```

`packages/pricing-core/vitest.config.ts` (analog api/web mit niedrigeren Startwerten):

```ts
coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts", "src/market/sample-market.ts"],
  thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 } },
```

CI: `pnpm -r run test -- --coverage` und `actions/upload-artifact` für `coverage/lcov.info` (später Codecov/SonarQube).

### 3.14 ESLint + Prettier

```bash
pnpm add -D -w eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier prettier
```

`eslint.config.js` (Root, Flat Config):

```js
import js from "@eslint/js"; import ts from "typescript-eslint"; import reactHooks from "eslint-plugin-react-hooks"; import prettier from "eslint-config-prettier";
export default ts.config(
  { ignores: ["**/dist/**", "**/coverage/**"] },
  js.configs.recommended, ...ts.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { "@typescript-eslint/no-non-null-assertion": "warn", "@typescript-eslint/consistent-type-imports": "error", "@typescript-eslint/no-floating-promises": "error" } },
  { files: ["apps/web/**/*.tsx"], plugins: { "react-hooks": reactHooks }, rules: reactHooks.configs.recommended.rules },
  prettier,
);
```

`.prettierrc`: `{ "printWidth": 140, "singleQuote": false, "trailingComma": "all" }` (entspricht dem vorhandenen Stil). Skripte: `"lint": "eslint ."`, `"format": "prettier --check ."`. Die bestehenden `lint`-Skripte in den Paketen auf `eslint .` umstellen.

### 3.15 CHANGELOG, LICENSE, CONTRIBUTING, SECURITY

- `LICENSE`: liegt untracked vor → committen; `"files"` in `packages/pricing-core/package.json` um `"LICENSE", "README.md"` ergänzen; Paket-README anlegen (aktuell keine).
- `CHANGELOG.md` per Changesets: `pnpm add -D -w @changesets/cli && pnpm changeset init`; erster Eintrag `0.1.0` mit den Inhalten aus Commit `2cb1571` und den ungetrackten Features.
- `CONTRIBUTING.md`: Setup (`pnpm install && pnpm --filter @deriva/pricing-core run build`), Branch-/Commit-Konvention (Conventional Commits, passend zu Changesets), Definition of Done (Tests, Lint, Doku-Update, ADR bei Architekturentscheidung), Hinweis „Code Englisch, Produkt Deutsch" (ADR-012).
- `SECURITY.md`: Meldeweg, Supported Versions, Hinweis „v0.x ohne Auth – nicht öffentlich exponieren".
- `.github/CODEOWNERS`, `.github/dependabot.yml` (npm + github-actions, weekly), `.editorconfig`.

### 3.16 Dokumentation nachziehen (konkrete Edits)

- `README.md:16`: „63 Tests" → „Tests: Core 74 · API 7 · Web 15" oder Badge.
- `docs/architecture/01-architektur.md:69`: „als Interfaces" → „als Klassen mit In-Memory-Implementierung (Interface-Extraktion mit Persistenz-Adapter geplant)" – oder Interfaces einführen.
- `docs/architecture/01-architektur.md:82-83`: Testanzahl, „11 Sample-Trades", gemessene Zahlen (0,05 ms/Trade, 3,7 ms/Trade volles Risiko).
- `docs/architecture/02-adrs.md:44`: „Test deckt Kernfelder ab" streichen oder `dates.test.ts` schreiben.
- `docs/product/02-epics-und-user-stories.md:88`: „deutsches Format" erst nach F-12; US-6.5 → 🔶 mit Verweis auf `emir.ts`.
- `docs/product/01-vision-und-module.md:30`: „EMIR-Bewertungsfelder sind eingebaut" → „vorbereitet (Export v0.2)".
- `apps/web/src/hotkeys/keymap.ts:5`: 800 ms → 900 ms.
- Neue ADRs 013–020 (F-21).

---

## 4. Bewertung der Architektur im Überblick (Kurzfazit)

Der Kern der Architektur ist richtig gewählt und sauber umgesetzt: eine isomorphe, nebenwirkungsfreie Pricing-Bibliothek mit immutablem Marktkontext, dünne Fassaden für API und UI, deklaratives Hotkey-System. Die Performance-Reserven sind groß (Faktor 100 gegenüber den Zielen). Die Schwächen liegen fast ausschließlich **an den Systemgrenzen**: Die API vertraut ihren Eingaben, dokumentiert keinen Vertrag, schützt sich nicht und gibt im Fehlerfall entweder zu viel (interne Meldungen) oder zu wenig (`pv: null` ohne Warnung) preis. Genau dort entstehen bei einer Bewertungsplattform Haftungs- und Integrationsrisiken. Die Dokumentation ist überdurchschnittlich umfangreich, aber an mehreren Stellen dem Code vorausgeeilt oder hinterhergeblieben – für ein Produkt, das „Nachvollziehbarkeit" als Kernversprechen führt, wiegt jede unwahre Aussage doppelt.

Mit den Punkten 3.1 (Schemas), 3.5–3.7 (Semantik, Logging, Schutz), 3.4/3.3 (Audit, EMIR) und 3.16 (Doku-Korrekturen) sind beide Dimensionen realistisch auf > 85 zu heben; Worker (3.9), SDK (3.8) und E2E (3.12) bringen den Rest.
