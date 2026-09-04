# DERIVA – Architektur

## 1. Kontext (C4 Level 1)

```
   Berater / Treasurer / Risk / Prüfer            Kernbank · TMS · Excel · Batch
              │  Browser (Keyboard-first UI)                   │  REST / OpenAPI
              ▼                                                ▼
   ┌─────────────────────┐                        ┌───────────────────────┐
   │  apps/web (React)   │  optional /api-Proxy   │  apps/api (Fastify)   │
   │  Pricing-Core läuft │ ─────────────────────► │  Pricing-Core, Stores │
   │  im Browser         │                        │  OpenAPI /docs        │
   └─────────┬───────────┘                        └───────────┬───────────┘
             │                                                │
             └──────────────► packages/pricing-core ◄─────────┘
                              (reine TypeScript-Bibliothek, keine I/O)
                                            ▲
                     Marktdaten-Adapter (Roadmap: LSEG, Bloomberg, ICE, EZB, EMMI)
```

**Kernentscheidung:** Der Bewertungskern ist eine **isomorphe, nebenwirkungsfreie TypeScript-Bibliothek**. Sie läuft identisch im Browser (Offline-Demo, Live-What-if ohne Roundtrip) und auf dem Server (API, Batch). Eine Zahl, die der Berater im Browser sieht, ist bitidentisch mit der aus der API.

## 2. Container (C4 Level 2)

| Container | Technologie | Verantwortung |
|---|---|---|
| `packages/pricing-core` | TypeScript 5.9, ESM, keine Runtime-Abhängigkeiten | Datum/Kalender, Kurven, Modelle, Instrumente, Pricer, Risiko, Szenarien, XVA, Reporting |
| `apps/api` | Node 22, Fastify 5, @fastify/swagger | REST-Fassade, ISO-Datums-Mapping, In-Memory-Stores (austauschbar), OpenAPI |
| `apps/web` | React 19, Vite 7, zustand, ECharts, CSS-Tokens | Workstation-UI, Hotkey-System, Command Palette, Views |
| CI | GitHub Actions (Node 20/22) | Install (frozen lockfile) → Core-Build → Typecheck → ESLint → Prettier-Check → Tests mit Coverage-Schwellen (Core/API/Web) → `pnpm audit --prod` → Builds (ohne Source-Maps im Artefakt) → Playwright-E2E (ADR-020); Dependabot, CODEOWNERS |

## 3. Komponenten des Pricing-Core (C4 Level 3)

```
math/        normal (West CDF, Acklam inverse, bivariate), rootfind (Brent, Newton, Bracketing), interpolation
dates/       date (SerialDate, Tenor, IMM), calendar (TARGET/US/UK/CH/JP/DE/Joint/Custom, BDC, advance),
             daycount (9 Konventionen, ACT/ACT ICMA mit Referenzperiode), schedule (Stubs, EOM, Lags, IMM-Roll)
curves/      Curve-Interface, InterpolatedCurve (5 Interpolationen, Flat-Forward-/Flat-Zero-Extrapolation, Shifts, Roll),
             index-definitions (RateIndex, SwapConventions), bootstrap (sequentiell, dual-curve, Brent je Pillar,
             Pillar am letzten Zahlungstag, Residuen auf finaler Kurve)
models/      black (Black-76, Bachelier, shifted, implied vols, Konvertierung), garman-kohlhagen
             (Vanilla + Greeks, Digital, Reiner-Rubinstein-Barrier), sabr (Hagan LN/N, Alpha-Kalibrierung),
             vol-surfaces (Swaption-Cube + SABR-Smile, Caplet), fx-vol-surface (ATM/RR/BF, Delta-Raum)
market/      MarketContext (Kurven, Discount-Mapping, Collateral, Spots, Spot-Daten, Fixing-Policy, Fixings, Vols, Credit),
             fx-spot (Spot-Lag/Paar-Kalender/Heute-Kurs/Pip-Faktor), sample-market
instruments/ Trade-Typen (diskriminierte Union), Builder mit Marktkonventionen
pricing/     leg-pricer (fix/float/OIS-Compounding/Fixings/Nominalaustausch), swap, fra, capfloor,
             swaption, fx (forward/swap/option), price (Dispatcher, Portfolio)
risk/        sensitivities (DV01, Buckets, FX-Delta, Vega, Theta mit Detail Carry/Roll-down/Cashflows, Gamma), scenarios (Definitionen, akkumulierende Shifts, Grid)
xva/         cva (Swaption-Replikation für Swaps, GK-Forward, Delta-Normal-Exposure für alle übrigen Instrumente, Hazard aus Spread)
hedge/       IFRS 9 / HGB § 254: hypothetisches Derivat, Critical Terms, Dollar-Offset, OLS-Regression, OCI/GuV-Split, Einfrierung/Durchbuchung
reporting/   valuation-report (Snapshot-/Inputs-/Report-Hash, IFRS-13-Heuristik, Kostentransparenz, What-if-Marker, Methodik), emir (Refit-Bewertungsfelder),
             documents (Termsheet, Geeignetheitserklärung § 64 WpHG), CSV im deutschen Excel-Format
market/      + snapshot (versioniertes JSON `deriva.market/1`, Validierung), sample-market mit `sampleBootstrapSpecs`
risk/        + parRisk (Quote-Bumps mit Re-Bootstrapping), vegaBuckets, IRRBB-Standardschocks, rollMarket
```

### Datenfluss einer Bewertung

1. `Trade` (typisiert) + `MarketContext` → `priceTrade()` dispatcht auf den Pricer.
2. Pricer baut Schedules, holt Diskont-/Projektionskurve (`getDiscountCurve` berücksichtigt Collateral), projiziert Raten (Fixings → Kurve), bewertet Optionen mit Modell + Vol-Fläche.
3. `PricingResult` enthält PV in Reporting-Währung, PV je Leg, jede Zahlung mit DF, Analytics, Warnungen, Laufzeit in ms.
4. Risiko = Bump-and-Reprice über `Curve.shifted*` und Kontext-Kopien (immutabel).
5. Report = Pricing + Risiko + XVA + Marktsnapshot + Methodik.

### Immutabilität

`MarketContext` und `Curve` werden nie mutiert; Szenarien/Bumps erzeugen Kopien. Das macht paralleles Rechnen (Worker) und Caching trivial und verhindert „vergiftete" Marktdaten nach einem What-if.

## 4. API-Design

- Ressourcen (40 Operationen, jede mit `operationId`): `/api/market` (Übersicht inkl. JPY-TONA, Kurven, Vols, Bootstrap mit Futures/Basis/XCCY/FX-Swap-Points, Pillar-Merge, `turnOfYear`, `globalSweeps`, Interpolation inkl. `monotoneConvex`), `/api/market/snapshot` (Export/Import mit `forwardJumps`, ETag), `/api/price`, `/api/price/portfolio`, `/api/risk`, `/api/risk/par`, `/api/risk/par/portfolio`, `/api/risk/vega` (`dimension` expiry | expiry-tenor, `smile` für RR25/BF25-Buckets der FX-Vol-Fläche; `kind` swaption | caplet | fx), `/api/scenarios` (`includeHistorical`), `/api/scenarios/standard|historical`, `/api/scenarios/grid`, `/api/xva` (Hazard-Termstruktur), `/api/xva/hazard-curve`, `/api/hedge/effectiveness` (`designationSnapshot`, `freezeDesignationVol`), `/api/hedge/hypothetical` (`designation`, Tilgungspläne), `/api/report` (JSON | `?format=csv`; `perspective` mit dokumentierter Vorzeichenregel, `governance`), `/api/report/portfolio` (Buchebene: PV/DV01/Theta/FX-Delta je Trade, Aggregate nach Kontrahent/Buch/Produktart, `groupBy`; JSON | `?format=md`), `/api/documents/termsheet|suitability|confirmation|kid` (JSON | `?format=md`), `/api/emir/valuations` (`?asOf=&timestamp=&method=&uti=&transactionPrice=`, Clearing-Felder), `/api/trades` (CRUD, `/import`, `/from-template` – diskriminiert über `template` für die Core-Builder `makeCrossCurrencySwap`/`makeFra`), `/api/audit`, `/api/health`, `/api/health/ready`, `/docs/json` (OpenAPI immer; Swagger UI `/docs` nur außerhalb `production`).
- Snapshot-ID: `X-Market-Snapshot-Id`/`ETag` verwenden `marketSnapshotId` aus dem Core (`reporting/valuation-report.ts`), dieselbe Funktion, die `audit.snapshotId` im Report schreibt – kein replizierter Hash in der API.
- Datumsformat: ISO-8601-Strings an der API-Grenze, intern Serial-Dates (ADR-007, Test `lib/dates.test.ts`).
- Validierung: JSON-Schema je Body/Query/Params (ADR-013) – **alle** Bodies inkl. Snapshot-Import; Trades als diskriminierte Union (`oneOf` je `type`, typisierte Enum-Felder, `additionalProperties: false`); semantische Prüfung durch den Core (`PricingError` → 422 mit `code`); Fehlerformat `{ error, code?, statusCode, validation?, requestId }` auf allen Routen (ADR-025).
- OpenAPI-Vertrag: `servers`, `operationId` je Route, Response-Schemas (2xx + 400/404/409/412/413/422/429/500), `components.schemas` (`Trade`, `MarketSnapshot`, `ErrorResponse`); Vertragstest `apps/api/src/contract.test.ts` (ADR-023).
- Semantik: `POST /api/trades` 201/409 (`?upsert=1`), `PUT` mit `If-Match`/ETag → 412 und Body-`id` ≠ Pfad-`id` → 400, `GET` mit `If-None-Match` → 304, `DELETE` 204 (optional `If-Match` → 412); Trade-IDs `^[A-Za-z0-9._-]{1,64}$`; Probe-Bewertung in der Reporting-Währung aus `?reportingCurrency=` (Default EUR).
- Header: `X-Request-Id` (eingehende `x-request-id` wird übernommen), `X-Market-Snapshot-Id` auf jeder bewertungsbezogenen Antwort (= `audit.snapshotId` des Reports, F-05), `ETag` auf Trades und Snapshot.
- Sicherheit: helmet, Rate-Limit, CORS-Allowlist, Body-Limit, sichere Dateinamen, Request-ID (ADR-018); Audit-Trail mit Hash-Kette (ADR-014); Logger mit `LOG_LEVEL`/Redaction (ADR-025); Abhängigkeits-Audit und Dependabot (ADR-020).
- Marktquotes: `MarketRepository` hält die aktuellen Quotes je Sample-Kurve; `POST /api/market/curves` ersetzt Kurve **und** Quotes, sodass `/api/risk/par` und der Stichtagswechsel (`PUT /api/market`) auf den tatsächlichen Marktinputs arbeiten.
- Zustand: `MarketRepository`, `TradeRepository`, `AuditLog` als Interfaces/Klassen mit In-Memory-Implementierung; DB-Adapter ersetzt Modul ohne Routenänderung (ADR-006).

## 5. UI-Architektur

- **State:** ein zustand-Store (`state/store.ts`) hält Basismarkt, What-if-Markt, Trades, Ergebnisse, Auswahl, View, Theme. Jede Änderung bewertet betroffene Trades sofort neu (synchron, < 5 ms je Trade).
- **Hotkeys:** deklarative `HOTKEYS`-Liste (`hotkeys/keymap.ts`) → ein Dispatcher-Hook (`useHotkeys`) mit Chord-Unterstützung → ein `switch` in `App.tsx`. Cheat-Sheet und Palette rendern aus derselben Liste (Single Source of Truth).
- **Views** sind reine Funktionskomponenten über dem Store; Charts über einen dünnen ECharts-Wrapper mit Theme-Tokens aus CSS-Variablen.
- **Styling:** CSS-Design-Tokens (`styles/tokens.css`) für Dark/Light; keine CSS-Framework-Abhängigkeit.

## 6. Qualitätsattribute

| Attribut | Maßnahme |
|---|---|
| Korrektheit | > 170 Core-Tests (Referenzwerte Haug/Hull/Genz, Paritäten, Bootstrap-Round-Trips, Hedge-Accounting, Par-Risk), API-Integrations- und Vertragstests (Schema-Sync mit den Buildern, ETag-Semantik, Fehlerobjekt, OpenAPI, Audit, Dokumente), UI-Unit-Tests und Playwright-E2E |
| Performance | Analytische Modelle, O(n) Schedules, Kurven-Cache in Klassen; Beispielportfolio (10 Trades in der API, 11 im Web) inkl. DV01 in wenigen ms; Budget und Worker-Grenze in ADR-026 |
| Nachvollziehbarkeit | Cashflow-Tabelle, Pillar-Tabelle, Methodik im Report, Warnungen statt stiller Fallbacks |
| Erweiterbarkeit | Diskriminierte Union `Trade` + Dispatcher; neue Instrumente = Typ + Pricer + Builder |
| Portabilität | Keine Node-APIs im Core; läuft in Browser, Node, Deno, Worker |
| Sicherheit | Keine Secrets im Repo; helmet/Rate-Limit/CORS/Validierung (ADR-018); `pnpm audit` in CI, Dependabot, Swagger UI nur außerhalb `production`; Auth/OIDC als Gateway-Adapter v1.0; SECURITY.md |
| Compliance | Regulatorik-Mapping Anforderung → Feature → Evidenz → Status für MiFID II, IFRS 13/IDW RS HFA 35, IFRS 9/HGB § 254, EMIR Refit, BGH, MaRisk, DORA mit expliziter „nicht abgedeckt"-Liste: [`docs/compliance/01-regulatorik-mapping.md`](../compliance/01-regulatorik-mapping.md); Bewertungs-Governance (`governance`) und deterministische Hashes im Report |

## 7. Deployment (Ziel v1.0)

```
[Browser] ──HTTPS──► [Ingress] ──► [web (static, CDN)]
                              └──► [api (Node, 2+ Replikas)] ──► [PostgreSQL: Trades, Snapshots, Audit]
                                        │
                                        └──► [market-adapter Jobs: EoD-Snapshots (LSEG/Bloomberg/ICE/EZB)]
```
Container-Images je App, Health `/api/health`, strukturierte Logs (pino), Metriken (Bewertungen/s, p95-Latenz).

## 8. Erweiterungspunkte

- **Neues Instrument:** Typ in `instruments/types.ts`, Pricer in `pricing/`, Case im Dispatcher, Builder, Editor-Case in `TradeEditor.tsx`, Badge in `trade-ops.ts`.
- **Neues Modell:** `models/` + Auswahl über `model`-Feld des Trades.
- **Marktdaten-Quelle:** Adapter liefert `CurveQuote[]`, Vol-Flächen und Spots → `bootstrapCurve` → `MarketContext`.
- **Persistenz:** `MarketStore`/`TradeStore` implementieren.
