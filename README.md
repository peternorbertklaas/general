# DERIVA – Bewertungs-Workstation für Zins- und Währungsderivate

**Keyboard-first. Transparent bis zum Cashflow. Ein Bewertungskern für Browser und Server.**

DERIVA bewertet Zinsswaps (fix/float/OIS/Basis, amortisierend, IMM, mit embedded Caps/Floors und RFR-Lookback),
FRAs, Caps/Floors/Collars, Swaptions (physisch, Cash/CCP), FX-Forwards/-Swaps, FX-Optionen (Vanilla, Digital, Barrier)
und Cross-Currency-Swaps mit Multi-Curve-Framework (OIS-Diskontierung, Collateral-Kurven, Futures/Basis/XCCY-Inputs),
Bachelier/shifted Black + SABR-Smile, Garman-Kohlhagen mit Delta-Smile, und liefert Sensitivitäten (Zero, Par, Vega-Buckets),
Szenarien (inkl. EBA-IRRBB), CVA/DVA für alle Instrumente, Hedge Accounting (IFRS 9 / HGB § 254) und prüfungsfähige
Bewertungsreports mit Hashes (IFRS 13 / IDW RS HFA 47, MiFID-II-Kostentransparenz, EMIR-Refit-Felder, Termsheet, Geeignetheitserklärung).

Entstanden aus einer Markt- und Wettbewerbsanalyse (LPA Captano/Capmatix, Bloomberg SWPM/OVML, Numerix, Quantifi,
Murex, TMS-Anbieter, QuantLib/ORE) – siehe [`docs/research`](docs/research).

## Repository

```
packages/pricing-core   Bewertungsbibliothek (TypeScript, ohne Laufzeitabhängigkeiten)
apps/api                REST-API (Fastify 5, JSON-Schema-Validierung, OpenAPI-Vertrag, ETag, Audit-Trail)
apps/web                Workstation-UI (React 19, Vite, Hotkeys, Command Palette, Kundenmodus, Vergleich, Hedge Accounting)
docs/quality            Bewertungsrubrik, Review-Berichte und Scorecards des Orchestrator-Prozesses
docs/research           Video-Ausgangspunkt, LPA-Analyse, Wettbewerber, Domäne/Methodik/Regulatorik
docs/product            Vision & Module, Epics & User Stories, UI-Konzept & Hotkeys
docs/architecture       Architektur (C4), Architecture Decision Records
docs/compliance         Regulatorik-Mapping: Anforderung → Feature → Evidenz → Status (MiFID II, IFRS 13/IDW RS HFA 47, IFRS 9/HGB § 254/IDW RS HFA 35, EMIR, BGH, MaRisk, DORA)
```

## Quickstart

```bash
pnpm install
pnpm build      # Core → API → Web (API/Web importieren das Core-dist; vor Tests/Abgabe ausführen)
pnpm test       # alle Tests (Core, API, Web); baut den Core vorher
pnpm dev        # Core-Watch + API auf :4000 + Web auf :5173
```

- Web-UI: http://localhost:5173 (läuft auch ohne API – der Pricing-Core rechnet im Browser)
- API-Doku: http://localhost:4000/docs (Swagger UI, nur außerhalb `NODE_ENV=production`); OpenAPI-Vertrag: http://localhost:4000/docs/json
- Produktionsstart: `NODE_ENV=production LOG_LEVEL=info node apps/api/dist/server.js` (nach `pnpm build`)

Weitere Skripte: `pnpm typecheck`, `pnpm lint`, `pnpm format` / `pnpm format:check`, `pnpm audit` (Details in [`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Die wichtigsten Hotkeys

| Tasten                                                  | Aktion                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ctrl/⌘+K` oder `/`                                     | Command Palette mit Schnelleingabe, z.B. `irs 10y pay 3.1% 10m`, `collar 7y 3.5/1.5 6m`, `swpt 1y5y payer 3% 10m`, `fxf eurusd -2m 1.1725 2027-03-15`, `fxo eurusd put 1.15 3m 9m` |
| `g b` `g p` `g c` `g s` `g m` `g r` `g v` `g h`         | Blotter, Pricing, Kurven, Szenarien, Markt, Report, Vergleich, Hedge Accounting (auch `Alt+1` … `Alt+8`)                                                                           |
| `n s` `n c` `n w` `n f` `n o` / `n b` `n a` `n i` `n x` | Neu: Swap, Cap/Floor, Swaption, FX-Forward, FX-Option / Basis-Swap, amortisierender Swap, IMM-Swap, FX-Swap                                                                        |
| `j` / `k` / `Enter`                                     | Trade wählen / öffnen                                                                                                                                                              |
| `]` / `[` / `\`                                         | What-if Zinsen +10bp / −10bp / Reset (Portfolio live neu bewertet)                                                                                                                 |
| `Shift+P` / `f` / `d` / `Shift+D`                       | Par übernehmen / Richtung tauschen / duplizieren / löschen (mit Undo `⌘Z`)                                                                                                         |
| `c` / `t` / `i` / `Shift+K` / `?`                       | Reporting-Währung / Theme / Inspector / Kundenmodus / Hilfe                                                                                                                        |

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

Weitere Endpunkte: `POST /api/risk`, `/api/risk/par`, `/api/risk/par/portfolio`, `/api/risk/vega` (`dimension`, `smile`; Swaption-Cube, Caplet- und FX-Vol-Fläche), `POST /api/scenarios` (`includeHistorical`), `GET /api/scenarios/standard|historical`,
`POST /api/scenarios/grid`, `POST /api/xva` (`credit.cptyHazardCurve`), `POST /api/xva/hazard-curve` (CDS-Spreads → Hazard-Kurve; invertierte Quotes → 422 `INVALID_CREDIT_CURVE` oder mit `floorHazard: true` Hazard 0 plus `warnings` `HAZARD_FLOORED:`),
`POST /api/hedge/effectiveness` (`designationSnapshot`, `freezeDesignationVol`), `/api/hedge/hypothetical` (`designation`, Tilgungspläne), `POST /api/report` (`?format=csv`; `perspective`, `governance`),
`POST /api/report/portfolio` (Buchebene: PV/DV01/Theta/FX-Delta je Trade und nach Kontrahent/Buch/Produktart; `groupBy`, `?format=md`),
`POST /api/documents/termsheet|suitability|confirmation|kid` (`?format=md`), `GET/POST/PUT/DELETE /api/trades` (+ `/import` als JSON-Array oder CSV mit `content-type: text/csv` und `?type=` – eine Spaltenvorlage je Produkttyp, Zeilen laufen durch die Core-Builder, Fehler je Zeile –, `/from-template` für CrossCurrencySwap/FRA-Builder – CCS `collateralCurrency` default USD, sonst Quote-Währung des Paars, `null` = unbesichert; FRA-Index folgt der Periode, `3x6` → EURIBOR-3M),
`GET /api/market/curves/:id`, `POST /api/market/bootstrap` (Quotes inkl. `FxSwapPoints`, `turnOfYear`, `globalSweeps`, `monotoneConvex`), `GET/PUT /api/market/snapshot` (`forwardJumps`),
`GET /api/emir/valuations?format=csv&asOf=&timestamp=&method=&uti=&transactionPrice=` (inkl. Clearing-Felder), `GET /api/audit`, `GET /api/health/ready`.

**Vertrag (40 Operationen, OpenAPI 3.1.0):** Alle Bodies (inkl. Snapshot-Import) sind JSON-Schema-validiert; Trades sind eine diskriminierte Union über `type` mit typisierten Enum-Feldern – ein
`Fixed`-Leg ohne `rate` oder `status: "Bogus"` ergibt 400 statt `pv: null`. Jede Route hat eine `operationId` und dokumentierte Antworten (2xx, 400/404/409/412/413/422/428/429);
`components.schemas` sind benannt (`Trade`, `InterestRateSwap`, …, `SwapLeg`, `MarketSnapshot`, `ErrorResponse`) und tragen `discriminator.mapping`.
Fehler kommen einheitlich als `{ error, code?, details?, statusCode, validation?, requestId }` (Domänenfehler 422 mit `code`, z. B. `MISSING_FIXING`). Die Codes sind stabil und in `ErrorResponse.code` (`examples` + Beschreibung) dokumentiert:
Core-Codes `INVALID_TRADE`, `NON_FINITE_PV`, `MISSING_RATE`, `MISSING_FIXING`, `NO_DISCOUNT_CURVE`, `CURVE_NOT_FOUND`, `NO_FX_SPOT`, `UNKNOWN_INDEX`, `UNKNOWN_CALENDAR`, `UNSUPPORTED_TRADE_TYPE`, `INVALID_FREQUENCY` (z. B. `7Q`), `UNKNOWN_DAYCOUNT`, `VOL_MODEL_INCOMPATIBLE` (Black auf nicht-positivem Forward/Strike ohne Shift), `INVALID_CREDIT_CURVE` (invertierte CDS-Quotes, `details.pillar`), `INVALID_TIMESTAMP` (400 beim Snapshot-Import, 422 im EMIR-Export);
API-Codes `TOO_MANY_PERIODS` (400), `PERIOD_BUDGET_EXCEEDED` (413), `CSV_INVALID`/`CSV_ROW_INVALID`, `SNAPSHOT_MALFORMED` (400), `SNAPSHOT_INVALID` (422), `PRECONDITION_FAILED` (412), `PRECONDITION_REQUIRED` (428), `DOMAIN_ERROR`.
Keine Fehler, sondern Präfixe in `warnings[]` einer 200-Antwort: `MISSING_FIXING:`, `VOL_TYPE_CONVERTED:` (z. B. `model: "Black"` auf der Normal-Caplet-Fläche – PV ≈ Bachelier, `analytics.volConverted: "yes"`), `HAZARD_FLOORED:`.
Trades tragen ETags (`If-Match` auf PUT/DELETE → 412 bei Abweichung, mit `REQUIRE_IF_MATCH=1` Pflicht → 428 ohne Header; `If-None-Match` auf GET → 304); jede bewertungsbezogene Antwort trägt `X-Market-Snapshot-Id`
(identisch mit `audit.snapshotId` im Report) und `X-Request-Id` (eine eingehende `x-request-id` wird übernommen).

**Rechenbudget:** Alle Bewertungen laufen synchron. Die API schätzt vor dem Rechnen die Kuponperioden: je Leg ≤ 1200 (`frequency: "1D"` über 100 Jahre → 400 `TOO_MANY_PERIODS` in < 50 ms),
je Request ≤ 20 000 Perioden über alle Trades und ≤ 500 000 Perioden × Bewertungen (Szenarien, Grid-Zellen, Bucket-Risiko) → sonst 413 `PERIOD_BUDGET_EXCEEDED`; Body ≤ 5 MB, `trades` ≤ 5000.
Grenzen per `MAX_PERIODS_PER_LEG`, `MAX_PERIODS_PER_REQUEST`, `MAX_WEIGHTED_PERIODS_PER_REQUEST` einstellbar.

### CSV-Import (`POST /api/trades/import`, `content-type: text/csv`)

`?type=` wählt die Spaltenvorlage; Trennzeichen `;`, `,` oder Tab (automatisch erkannt), deutsche oder englische Zahlen (`10.000.000,50`, `3,10 %`, `-20 bp`, `0.031`),
Daten ISO oder `TT.MM.JJJJ`, Tenors (`5Y`), Spaltennamen case-insensitiv mit deutschen Aliassen (Kontrahent, Nominal, Währung, Festsatz, Startdatum, Laufzeit …).
Zeilen laufen durch die Core-Builder (Marktkonventionen der Währung); jede Zeile erscheint im Ergebnis (`imported` | `skipped` | `rejected` mit `row` und `reason`), `?mode=upsert` ersetzt vorhandene IDs.
Gemeinsame optionale Spalten: `id`, `name`, `counterparty`, `book`, `uti`. Die vollständigen Vorlagen (Pflicht-/Optionalspalten, Beispielzeile) stehen in der OpenAPI-Beschreibung der Route und in `apps/api/src/lib/csv-import.ts`.

| `type`              | Pflichtspalten                                                                      | Wichtige optionale Spalten                                         |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `InterestRateSwap`  | `currency notional payReceive fixedRate effectiveDate maturity`                     | `index spread fixedFrequency floatFrequency collateralCurrency`    |
| `FxForward`         | `pair baseAmount rate deliveryDate`                                                 | – (`baseAmount` mit Vorzeichen: + kauft die Basiswährung)          |
| `CapFloor`          | `currency notional capFloor strike effectiveDate maturity`                          | `floorStrike index longShort`                                      |
| `Swaption`          | `currency notional payerReceiver strike expiry tenor`                               | `settlement longShort`                                             |
| `FxOption`          | `pair optionType notional strike expiryDate`                                        | `deliveryDate longShort`                                           |
| `CrossCurrencySwap` | `pair domesticNotional effectiveDate tenor` (+ `fxSpot` **oder** `foreignNotional`) | `spread fixedRate domesticPayReceive frequency collateralCurrency` |
| `FRA`               | `currency notional payReceive start rate`                                           | `index end collateralCurrency` (`start` als `3x9` oder Datum)      |

```bash
printf 'currency;notional;payReceive;fixedRate;effectiveDate;maturity;id\nEUR;10.000.000;Pay;3,10 %%;2026-09-07;10Y;IRS-CSV-1\n' \
  | curl -s 'localhost:4000/api/trades/import?type=InterestRateSwap' -H 'content-type: text/csv' --data-binary @-
```

## Bibliothek direkt nutzen

```ts
import { buildSampleMarket, makeVanillaSwap, priceTrade, computeRisk, parseISO, advance, getCalendar } from "@deriva/pricing-core";

const ctx = buildSampleMarket(parseISO("2026-09-03"));
const spot = advance(ctx.valuationDate, "2D", getCalendar("TARGET"));
const swap = makeVanillaSwap({ currency: "EUR", notional: 1e7, payReceiveFixed: "Pay", fixedRate: 0.031, effectiveDate: spot, maturity: "10Y" });
const res = priceTrade(ctx, swap, "EUR"); // res.pv, res.analytics.parRate, res.legs[].cashflows
const risk = computeRisk(ctx, swap, "EUR"); // risk.dv01, risk.bucketed, risk.theta
```

## Methodik (Kurzfassung)

- **Kurven:** sequentielles Bootstrapping (Depo/FRA/Future/Swap/OIS/Tenor-Basis/XCCY-Basis), dual-curve für EURIBOR gegen €STR, kollateralabhängige Diskontierung; Pillar am letzten Zahlungstag, Residuen auf der finalen Kurve, optionales Pillar-Merging; log-lineare DF-Interpolation mit Flat-Forward-Extrapolation; Kalender TARGET/US/UK/CH/JP/DE; ISDA-Tageszählungen (inkl. ACT/ACT ICMA mit Referenzperiode), Stubs, IMM-Roll, RFR-Lookback/Observation-Shift.
- **Zinsoptionen:** Bachelier (Normal-Vol) als Standard, Black-76 / shifted Black wählbar; Swaption-Cube mit SABR-Smile; Cash-Settlement (Collateralised Cash Price, IRR) und Physical-Settlement.
- **FX:** Spot-Datum T+2/T+1 auf dem Paar-Kalender, Forwards spot-verankert über Zinsparität, PV-Umrechnung zum Heute-Kurs; Garman-Kohlhagen mit Smile aus ATM/RR/BF (Delta-Konvention Spot/Forward/Premium-adjusted, Smile-/Broker-Strangle); Digitals (Cash-/Asset-or-Nothing); Barrieren nach Reiner-Rubinstein mit FD-Greeks.
- **Risiko:** zentrales Bump-and-Reprice (DV01, Key-Rate je Pillar, Par-Risk je Marktquote mit Re-Bootstrapping – auch als Portfolio-Lauf –, FX-Delta, Vega-Buckets je Expiry oder Expiry × Tenor, Theta = Roll + Cashflows im Intervall, Gamma), Standard-Szenarien inkl. BaFin/EBA-IRRBB, Zinsen×FX-Matrix, eigene Szenarien.
- **XVA:** CVA/DVA semi-analytisch (Swaption-Replikation für Swaps, Basis-Swaption für Tenor-Basis-Swaps, GK für FX-Forwards, Delta-Normal-Exposure mit gerollten Sensitivitäten für Optionen/CCS), Hazard aus CDS-Spread.
- **Hedge Accounting:** hypothetisches Derivat, Critical Terms, Dollar-Offset, Regression, OCI/GuV-Split (IFRS 9), Einfrierungs-/Durchbuchungsmethode (HGB).
- **Report & Compliance:** Marktsnapshot mit deterministischen Hashes (Snapshot, Inputs, Report), Cashflow-Tabelle, Sensitivitäten, IFRS-13-Level-Heuristik auf den tatsächlich genutzten Kurven, Bewertungs-Governance (Freigabestatus, Quellen, Modellversion), anfänglicher Marktwert/Marge (BGH XI ZR 33/10, XI ZR 378/13), EMIR-Refit-Felder, Termsheet, Geeignetheitserklärung (§ 64 WpHG), Methodik. Mapping auf die Anforderungen mit Evidenz und offener Liste: [`docs/compliance/01-regulatorik-mapping.md`](docs/compliance/01-regulatorik-mapping.md).

Die Marktdaten im Repository sind **indikative Beispieldaten** (September 2026); produktive Nutzung erfordert
Marktdaten-Adapter (siehe ADR-005) und Modellvalidierung nach MaRisk.

## Roadmap

Siehe [`docs/product/02-epics-und-user-stories.md`](docs/product/02-epics-und-user-stories.md) – v1.0: Marktdaten-Adapter & Kurven-Governance,
Persistenz/Auth, PDF-Template-Service, EMIR-Vervollständigung; v1.1: strukturierte Produkte (Hull-White), Netting-CVA (Monte-Carlo), Excel-Add-in;
v1.2: SIMM/CRIF, VaR, Validierungs-Suite gegen QuantLib/ORE. Qualitätsprozess: [`docs/quality`](docs/quality). Sicherheit: [`SECURITY.md`](SECURITY.md).

## Lizenz

MIT
