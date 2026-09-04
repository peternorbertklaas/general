# Scorecard Runde 5 (nach dem vierten Maßnahmenprogramm)

Bewertet wurde Commit `77f2366` (Core 321 Tests, API 85, Web 242, E2E 286 Checks, 41 OpenAPI-Operationen) durch
vier unabhängige Review-Agenten (Berichte: `review-markt-r5.md`, `review-quant-r5.md`, `review-ui-r5.md`,
`review-architektur-r5.md`). Alle Runde-4-Befunde wurden einzeln nachgeprüft: Markt 6/6 behoben, Quant 4/4 behoben,
UI/Flows 12/16 behoben und 3 teilweise (Roving-Tabindex-Checkboxen, Tabellen-Namen, Service-Worker-Precache),
Architektur 7/10 behoben, N4-03 teilweise, N4-07 (Bundle/Lazy-Views) und N4-10 (Tag) offen. Der Quant-Reviewer hat
Tageszählungen, Schedules (EOM/IMM/Pay-Lag), SABR, 72 Barrier-Fälle mit Rebate, Digitals und Garman-Kohlhagen-Greeks
gegen QuantLib 1.43 auf ≤ 5·10⁻¹⁵ bestätigt.

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | R5 | Verbleibende Abzüge (R5) |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | 99 | Vol-Flächen ohne Strukturvalidierung (`PUT /api/market` → Folgefehler „Invalid trade“), FX-Flächen für USDCHF/GBPJPY/CHFJPY fehlen (Fallback 8 %), Web-CSV-Vorlage CCS ohne CSA-Spalte |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | 97 | Theta-Doppelzählung am Tag vor FX-Lieferung (Regression aus R4-2), verfallene/gelieferte FX-Optionen behalten Payoff ohne Warnung, `resettingLegIndex` unvalidiert, Rest-Validierung (Digital-Payout, Barrier-Typ, FX-Swap-Daten, `CreditInputs`), CDS-Prämien-Accrual ACT/365F statt ACT/360 |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | 96 | Inspector-Tabelle bei ≤ 1360 px beschnitten, Vergleichs-Checkboxen als Tabstopps, `Shift+P` für Cap/Floor/Collar, „Vega swaption EUR“, FX-Vol-Tabs bei 1024 px, Snapshot-Import-Fehlertexte, Kundenmodus-Formeln, Hedge-Druck-Einheit, ISO-Beispiel |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | 97 | Snapshot-Import nach Quote-Änderung nicht reproduzierbar (ID, Tabelle, Stichtag), CSV-Import ersetzt unmögliche Daten stillschweigend, Offline-Reload erst nach dem zweiten Besuch |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | 96 | Validierungs-/JSON-Fehler ohne `code`, Bundle/Lazy-Views (N4-07), `export *`/react-hooks-Lint/Web-tsconfig, Toolchain-Majors, 404 ohne Rate-Limit, schwache ETags in `If-Match`, Hedge-Frequenz-Pattern, Commit-Hygiene |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | 99 | Mapping-Stand „Runde 3“, ADR-023 ohne 428/500, Tag |

**Gewichteter Gesamtscore R5:** 99·0,20 + 97·0,20 + 96·0,20 + 97·0,15 + 96·0,15 + 99·0,10 = **97,25** (R4 96,60 · R3 93,60 · R2 83,50 · R1 59,65).

## Maßnahmenprogramm Runde 5 → 6 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | Theta-Einfachzählung für Legs mit Lieferung am Roll-Datum, Lebenszyklus verfallener/gelieferter FX-Optionen (`EXPIRED:`), Validierung (`resettingLegIndex`, Digital-Payout, Barrier-Typ, FX-Swap-Daten, `CreditInputs`), CDS-Prämien-Accrual ACT/360 mit QuantLib-Abgleich, `validateVolSurfaces` + `INVALID_VOL_SURFACE`, FX-Flächen für alle Spot-Paare, kuratierte `index.ts` ohne `export *`, keine plain `Error` mehr |
| API/CI/Doku | `VALIDATION_ERROR`/`INVALID_JSON` im Katalog, `details` auf 400-Pfaden, Rate-Limit auf unbekannten Routen, starke ETags, Hedge-Frequenz-Pattern und Hedged Item im Budget-Hook, `VOL_SURFACE_INVALID` auf `PUT /api/market`, Nominal-Obergrenze, Mapping-Stand, ADR-023, CHANGELOG, Conventional Commits |
| Web | Snapshot-Import vollständig und reproduzierbar (ID, Tabelle, Stichtag), CSV-Datumsfehler als Zeilenfehler, Inspector-Breite, `Shift+P` für Cap/Floor/Collar, Service-Worker-Precache ab dem ersten Besuch, FX-Vol-Tabs/Kostentransparenz bei 1024 px, deutsche Import-Fehlertexte, Kundenmodus ohne interne Formeln, Roving-Checkboxen, Tabellen-Namen, Palette-Warnung für FX-Paare ohne Fläche, CCS-CSV-Spalte, Lazy-Views + Größenbudget, react-hooks-Lint, strengere Web-tsconfig |

Die Ergebnisse der sechsten Bewertung stehen in `06-scorecard-runde-6.md`.
