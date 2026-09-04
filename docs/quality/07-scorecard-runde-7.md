# Scorecard Runde 7 (nach dem sechsten Maßnahmenprogramm)

Bewertet wurde Commit `f93e099` (Core 378 Tests, API 114, Web 307, E2E 395 Checks, 41 OpenAPI-Operationen) durch
vier unabhängige Review-Agenten (Berichte: `review-markt-r7.md`, `review-quant-r7.md`, `review-ui-r7.md`,
`review-architektur-r7.md`). Runde-6-Befunde: Markt 5/6 behoben, R6-5 teilweise (weitere Währungen nur per
Core-Laufzeit); Quant 5/5 behoben (Prämie als Cashflow: Swaption-Theta −183,41 statt +99.816,59; CDS 168,98 bp;
QuantLib-Cross-Checks bitgenau, NOK/SEK/DKK/PLN-Par-Swaps re-pricen auf 0); UI/Flows 9/9 behoben (96 UI-Zustände,
0 A11y-Verstöße, 5 450 Kontrastpaare ≥ 4,5:1); Architektur N6-01…N6-05 und Toolchain-Majors behoben, Commit-
Granularität und Tag offen.

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | R5 | R6 | R7 | Verbleibende Abzüge (R7) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | 99 | 98 | 98 | Schnelleingabe wählt nach „+ Kurve“ einen Index ohne Kurve, Editor mit G5-Festverdrahtung, Vol-Flächen neuer Währungen nur per API, `POST /api/market/curves` ohne Diskontzuordnung, API-Fixings beim Stichtagswechsel, CCS-CSV-Spalten Web ≠ API, weitere Währungen nur per Core-Register |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | 97 | 98 | 98 | Bereits gezahlte Fremdwährungsprämie verlangt FX-Spot (Regression), Knock-in-Rebate am Verfall, Prämienwährung nicht in FX-Delta/DV01, DK-/NO-Kalender vs. QuantLib, Knock-out-Rebate undiskontiert, `VOL_IMPLAUSIBLE:` bei Peg-Paaren |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | 96 | 98 | 98 | Marktansicht mit ≈ 500 Tabstopps (Fixings/Vol-Raster ohne Roving), Fokus nach `n s`/„Kurve anlegen“, Key-Rate-Auswahl 12 px über der Karte, „Erneut versuchen“ für ECharts-Chunk, Hedge-Reset-Undo ohne Testergebnis, Editor-Listen fest verdrahtet |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | 97 | 98 | 97,5 | Snapshot-Import verwirft „+ Kurve“-Spot, „Zum Sample-Markt“ ohne Zusatzkurven → DKK/NOK-Trades unbewertbar, `irs dkk …` ohne Warnung mit Index ohne Kurve |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | 96 | 98 | 98 | CI-Matrix Node 20 deterministisch rot (jsdom 30 / vitest 5 verlangen Node ≥ 22), ETag-Schema-Doku schwach, Core-Timing-Tests unter Last, Commit-Granularität |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | 99 | 99 | 99 | CHANGELOG-/CONTRIBUTING-Satz zu unveränderten Coverage-Schwellen falsch, Zählwerte (33 vs. 34 Dateien, Bundle-Zahlen), Warnungs-Präfix-Listen unvollständig, Tag |

**Gewichteter Gesamtscore R7:** 98·0,20 + 98·0,20 + 98·0,20 + 97,5·0,15 + 98·0,15 + 99·0,10 = **98,03** (R6 98,10 · R5 97,25 · R4 96,60 · R3 93,60 · R2 83,50 · R1 59,65).

## Maßnahmenprogramm Runde 7 → 8 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | Gezahlte Prämie ohne FX-Spot, Knock-in-Rebate nach Verfall, Prämienwährung in `tradeCurrencies`/FX-Delta/DV01, DK-Freitag nach Himmelfahrt und NO 24.12. mit QuantLib-Kalender-Golden, Knock-out-Rebate diskontiert, `VOL_PLAUSIBILITY.fxMin`, Built-in-Index nicht ersetzbar (`isBuiltInIndex`), Upfront auch auf FRA/FX-Forward/FX-Swap, `testTimeout` und lasttolerante Timing-Tests |
| API/CI/Doku | CI-Matrix Node 22 mit `engines`/`.nvmrc`, ETag-Schema stark, CHANGELOG-/CONTRIBUTING-Korrekturen, vollständige Präfix-Listen, Diskontzuordnung in `POST /api/market/curves` und `PUT /api/market`, Sample-Fixings beim Stichtagswechsel, CCS-CSV-Aliasse, Register-Endpunkte `POST /api/market/indices|conventions`, `dryRun` im CSV-Import, Commits je Programm |
| Web | Zusatzkurven/-Spots überleben Import/Verlassen/Reload, Index-Default mit Kurve in der Schnelleingabe, Editor-Listen aus dem Register, Vol-Flächen für neue Währungen/Paare in der Marktansicht, Roving für Fixings-Editor und Vol-Raster, Fokus nach `n s`/„Kurve anlegen“, Key-Rate-Auswahl, ECharts-Retry, Hedge-Reset-Undo mit Testergebnis, CCS-CSV-Spalten wie die API |

Die Ergebnisse der achten Bewertung stehen in `08-scorecard-runde-8.md`.
