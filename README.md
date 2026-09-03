# DERIVA – Bewertungs-Workstation für Zins- und Währungsderivate

**Keyboard-first. Transparent bis zum Cashflow. Ein Bewertungskern für Browser und Server.**

DERIVA bewertet Zinsswaps (fix/float/OIS/Basis), FRAs, Caps/Floors/Collars, Swaptions, FX-Forwards/-Swaps,
FX-Optionen (Vanilla, Digital, Barrier) und Cross-Currency-Swaps mit Multi-Curve-Framework (OIS-Diskontierung),
Bachelier/shifted Black + SABR-Smile, Garman-Kohlhagen mit Delta-Smile, und liefert Sensitivitäten, Szenarien,
CVA/DVA und prüfungsfähige Bewertungsreports (IFRS 13, MiFID-II-Kostentransparenz).

Entstanden aus einer Markt- und Wettbewerbsanalyse (LPA Captano/Capmatix, Bloomberg SWPM/OVML, Numerix, Quantifi,
Murex, TMS-Anbieter, QuantLib/ORE) – siehe [`docs/research`](docs/research).

## Repository

```
packages/pricing-core   Bewertungsbibliothek (TypeScript, ohne Abhängigkeiten, 63 Tests)
apps/api                REST-API (Fastify 5, OpenAPI unter /docs)
apps/web                Workstation-UI (React 19, Vite, Hotkeys, Command Palette)
docs/research           Video-Ausgangspunkt, LPA-Analyse, Wettbewerber, Domäne/Methodik/Regulatorik
docs/product            Vision & Module, Epics & User Stories, UI-Konzept & Hotkeys
docs/architecture       Architektur (C4), Architecture Decision Records
```

## Quickstart

```bash
pnpm install
pnpm --filter @deriva/pricing-core run build   # Core bauen (API/Web importieren dist)
pnpm test                                       # alle Tests (Core, API, Web)
pnpm dev                                        # API auf :4000, Web auf :5173
```

- Web-UI: http://localhost:5173 (läuft auch ohne API – der Pricing-Core rechnet im Browser)
- API-Doku: http://localhost:4000/docs

## Die wichtigsten Hotkeys

| Tasten | Aktion |
|---|---|
| `Ctrl/⌘+K` oder `/` | Command Palette mit Schnelleingabe, z.B. `irs 10y pay 3.1% 10m`, `collar 7y 3.5/1.5 6m`, `swpt 1y5y payer 3% 10m`, `fxf eurusd -2m 1.1725 2027-03-15`, `fxo eurusd put 1.15 3m 9m` |
| `g b` `g p` `g c` `g s` `g m` `g r` | Blotter, Pricing, Kurven, Szenarien, Markt, Report |
| `n s` `n c` `n w` `n f` `n o` | Neu: Swap, Cap/Floor, Swaption, FX-Forward, FX-Option |
| `j` / `k` / `Enter` | Trade wählen / öffnen |
| `]` / `[` / `\` | What-if Zinsen +10bp / −10bp / Reset (Portfolio live neu bewertet) |
| `Shift+P` / `f` / `d` / `Shift+D` | Par übernehmen / Richtung tauschen / duplizieren / löschen |
| `c` / `t` / `i` / `?` | Reporting-Währung / Theme / Inspector / Hilfe |

Vollständige Liste: [`docs/product/03-ui-konzept-und-hotkeys.md`](docs/product/03-ui-konzept-und-hotkeys.md).

## API-Beispiel

```bash
curl -s localhost:4000/api/price -H 'content-type: application/json' -d '{
  "reportingCurrency": "EUR",
  "trade": {
    "id": "demo", "type": "InterestRateSwap",
    "legs": [
      {"type":"Fixed","payReceive":"Pay","notional":10000000,"currency":"EUR","effectiveDate":"2026-09-07",
       "terminationDate":"2036-09-07","frequency":"1Y","dayCount":"30E/360","calendar":"TARGET","rate":0.031},
      {"type":"Float","payReceive":"Receive","notional":10000000,"currency":"EUR","effectiveDate":"2026-09-07",
       "terminationDate":"2036-09-07","frequency":"6M","dayCount":"ACT/360","calendar":"TARGET","index":"EURIBOR-6M"}
    ]
  }
}' | jq '{pv, par: .analytics.parRate, cashflows: (.legs[1].cashflows|length)}'
```

Weitere Endpunkte: `POST /api/risk`, `POST /api/scenarios`, `POST /api/scenarios/grid`, `POST /api/xva`,
`POST /api/report` (`?format=csv` für Cashflows), `GET/POST/PUT/DELETE /api/trades`, `GET /api/market/curves/:id`,
`POST /api/market/bootstrap`.

## Bibliothek direkt nutzen

```ts
import { buildSampleMarket, makeVanillaSwap, priceTrade, computeRisk, parseISO, advance, getCalendar } from "@deriva/pricing-core";

const ctx = buildSampleMarket(parseISO("2026-09-03"));
const spot = advance(ctx.valuationDate, "2D", getCalendar("TARGET"));
const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.031, effectiveDate: spot, maturity: "10Y" });
const res = priceTrade(ctx, swap, "EUR");      // res.pv, res.analytics.parRate, res.legs[].cashflows
const risk = computeRisk(ctx, swap, "EUR");    // risk.dv01, risk.bucketed, risk.theta
```

## Methodik (Kurzfassung)

- **Kurven:** sequentielles Bootstrapping (Depo/FRA/Swap/OIS), dual-curve für EURIBOR gegen €STR; log-lineare DF-Interpolation; Kalender TARGET/US/UK/CH/JP/DE; ISDA-Tageszählungen und Stubs.
- **Zinsoptionen:** Bachelier (Normal-Vol) als Standard, Black-76 / shifted Black wählbar; Swaption-Cube mit SABR-Smile; Cash- und Physical-Settlement.
- **FX:** Zinsparität für Forwards; Garman-Kohlhagen mit Smile aus ATM/RR/BF (Delta-Raum); Digitals analytisch; Barrieren nach Reiner-Rubinstein.
- **Risiko:** zentrales Bump-and-Reprice (DV01, Key-Rate je Pillar, FX-Delta, Vega, Theta, Gamma), Standard-Szenarien inkl. BaFin ±200bp, Zinsen×FX-Matrix.
- **XVA:** CVA/DVA semi-analytisch (Swaption-Replikation für Swaps, GK für FX-Forwards), Hazard aus CDS-Spread.
- **Report:** Marktsnapshot, Cashflow-Tabelle, Sensitivitäten, IFRS-13-Level, anfänglicher Marktwert/Marge (BGH XI ZR 33/10, XI ZR 378/13), Methodik.

Die Marktdaten im Repository sind **indikative Beispieldaten** (September 2026); produktive Nutzung erfordert
Marktdaten-Adapter (siehe ADR-005) und Modellvalidierung nach MaRisk.

## Roadmap

Siehe [`docs/product/02-epics-und-user-stories.md`](docs/product/02-epics-und-user-stories.md) – v1.0: Marktdaten-Adapter,
Persistenz/Auth, PDF-Reports, EMIR-Felder, Audit-Trail; v1.1: strukturierte Produkte (Hull-White), Netting-CVA,
Beratungsdokumente, Excel-Add-in; v1.2: SIMM/CRIF, VaR, Validierungs-Suite gegen QuantLib/ORE.

## Lizenz

MIT
