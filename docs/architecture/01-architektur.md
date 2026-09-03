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
| CI | GitHub Actions | Install → Typecheck → Tests → Build |

## 3. Komponenten des Pricing-Core (C4 Level 3)

```
math/        normal (West CDF, Acklam inverse, bivariate), rootfind (Brent, Newton, Bracketing), interpolation
dates/       date (SerialDate, Tenor, IMM), calendar (TARGET/US/UK/CH/JP/DE/Joint/Custom, BDC, advance),
             daycount (9 Konventionen), schedule (Stubs, EOM, Lags)
curves/      Curve-Interface, InterpolatedCurve (5 Interpolationen, Shifts), index-definitions
             (RateIndex, SwapConventions), bootstrap (sequentiell, dual-curve, Brent je Pillar)
models/      black (Black-76, Bachelier, shifted, implied vols, Konvertierung), garman-kohlhagen
             (Vanilla + Greeks, Digital, Reiner-Rubinstein-Barrier), sabr (Hagan LN/N, Alpha-Kalibrierung),
             vol-surfaces (Swaption-Cube + SABR-Smile, Caplet), fx-vol-surface (ATM/RR/BF, Delta-Raum)
market/      MarketContext (Kurven, Discount-Mapping, Collateral, Spots, Fixings, Vols, Credit), sample-market
instruments/ Trade-Typen (diskriminierte Union), Builder mit Marktkonventionen
pricing/     leg-pricer (fix/float/OIS-Compounding/Fixings/Nominalaustausch), swap, fra, capfloor,
             swaption, fx (forward/swap/option), price (Dispatcher, Portfolio)
risk/        sensitivities (DV01, Buckets, FX-Delta, Vega, Theta, Gamma), scenarios (Definitionen, Grid)
xva/         cva (Swaption-Replikation, GK-Forward, Hazard aus Spread)
reporting/   valuation-report (Snapshot, Fair-Value-Hierarchie, Kostentransparenz, Methodik), CSV
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

- Ressourcen: `/api/market` (Snapshot, Kurven, Vols, Bootstrap), `/api/price`, `/api/price/portfolio`, `/api/risk`, `/api/scenarios`, `/api/scenarios/grid`, `/api/xva`, `/api/report` (JSON | `?format=csv`), `/api/trades` (CRUD), `/api/health`, `/docs`.
- Datumsformat: ISO-8601-Strings an der API-Grenze, intern Serial-Dates (ADR-007).
- Fehler: `{ error, statusCode }`; Validierung durch Probe-Bewertung beim Anlegen.
- Zustand: `MarketStore`, `TradeStore` als Interfaces mit In-Memory-Implementierung; DB-Adapter ersetzt Modul ohne Routenänderung (ADR-006).

## 5. UI-Architektur

- **State:** ein zustand-Store (`state/store.ts`) hält Basismarkt, What-if-Markt, Trades, Ergebnisse, Auswahl, View, Theme. Jede Änderung bewertet betroffene Trades sofort neu (synchron, < 5 ms je Trade).
- **Hotkeys:** deklarative `HOTKEYS`-Liste (`hotkeys/keymap.ts`) → ein Dispatcher-Hook (`useHotkeys`) mit Chord-Unterstützung → ein `switch` in `App.tsx`. Cheat-Sheet und Palette rendern aus derselben Liste (Single Source of Truth).
- **Views** sind reine Funktionskomponenten über dem Store; Charts über einen dünnen ECharts-Wrapper mit Theme-Tokens aus CSS-Variablen.
- **Styling:** CSS-Design-Tokens (`styles/tokens.css`) für Dark/Light; keine CSS-Framework-Abhängigkeit.

## 6. Qualitätsattribute

| Attribut | Maßnahme |
|---|---|
| Korrektheit | 63 Core-Tests (Referenzwerte Haug/Hull, Paritäten, Bootstrap-Round-Trips), API- und UI-Tests |
| Performance | Analytische Modelle, O(n) Schedules, Kurven-Cache in Klassen; 12 Trades inkl. DV01 in ~ms |
| Nachvollziehbarkeit | Cashflow-Tabelle, Pillar-Tabelle, Methodik im Report, Warnungen statt stiller Fallbacks |
| Erweiterbarkeit | Diskriminierte Union `Trade` + Dispatcher; neue Instrumente = Typ + Pricer + Builder |
| Portabilität | Keine Node-APIs im Core; läuft in Browser, Node, Deno, Worker |
| Sicherheit | Keine Secrets im Repo; API ohne Auth in v0.1 (ADR-006 beschreibt OIDC-Plan); DORA-Betriebsdoku Roadmap |

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
