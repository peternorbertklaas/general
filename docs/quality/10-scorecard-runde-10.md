# Scorecard Runde 10 (nach dem neunten Maßnahmenprogramm)

Bewertet wurde Commit `8fbf579` (Version 0.3.0; Core 435 Tests, API 151, Web 391, E2E 529 Checks, 44
OpenAPI-Operationen, 45 Fehlercodes, 12 Warnungs-Präfixe) durch vier unabhängige Review-Agenten (Berichte:
`review-markt-r10.md`, `review-quant-r10.md`, `review-ui-r10.md`, `review-architektur-r10.md`). Runde-9-Befunde:
Markt R9-1…R9-5 behoben (`quotes`-Block API ↔ Workstation, `basis nok/czk`, registrierte Index-Token, 11/11
API-Vorlagendateien im Blotter); Quant N9-1…N9-3 und N7-5-Rest behoben (Lockout k = 0…3 bitgenau zu QuantLib,
Fee am Spot → CVA ±0,3 %, PA-Delta 0, Default-Rebate „hit“ mit exakter KO/KI-Parität); UI/Flows 7 von 9 behoben,
R9-02/R9-04 teilweise (Sweep 128 Zustände ohne Überlauf/Backticks, Restore-Toast ohne Aktion, Reset mit Rückfrage
und vollständigem Undo); Architektur N9-01…N9-04, N8-02-Rest, N4-03-Rest behoben (Kindprozess-Import mit
`CZ-X9+TARGET`, EMIR-Feld 23, Diskontregel, typbewusstes Lint für Web), Tags lokal (v0.3.0 → `e68cb34`).

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | Verbleibende Abzüge (R10) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | 99 | 98 | 98 | 98 | 99 | 97 | Sample-Kurven haben implizite Bootstrap-Specs: `quotes`-Export lässt sie aus, Import-Modus unterstellt sie, Par-Risiko prüft Spec ↔ Kurve nicht (falsche Par-Zahl ohne Warnung nach API-Import, abhängige Kurven nach `POST /curves` nicht neu gebaut, Workstation „0 von 4“ nach API-Import); Snapshot-Tab „ohne Bootstrap-Quotes“ trotz `quotes`-Block; Palette ohne `[index]` für cap/floor/collar/swpt |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | 97 | 98 | 98 | 96 | 99 | 97,8 | `observationShift` teilt durch die Tage der Zinsperiode statt der Beobachtungsperiode (−39 bp auf einer 28/31-Periode), Swap-CVA auf jährlichem Kupongitter 2–4 % zu niedrig (Prämientermin verfeinert das Gitter einseitig), Lookback über Fixing-Feiertag am Periodenbeginn (+0,19 bp), `NaN`-Daten in Datumsfunktionen laufen endlos |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | 96 | 98 | 98 | 98 | 98,8 | 99,0 | `Esc` im Inline-Zahlenfeld wirft den Fokus auf `body`, ✕ per Tastatur in FX-Fixings/CDS trifft bei wiederverwendetem Knoten die falsche Zeile, Toast-Aktion/✕ per Tastatur → `body`, leerer Blotter „Bestand (0 Trades) ersetzen?“, „+ Währung“-Toast unter Import trotz vorhandener Kurve |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | 97 | 98 | 97,5 | 98,3 | 98,1 | 99,3 | Workstation-Export ohne `quotes` der Sample-Kurven → nach Re-Import kein Par-Risiko für EUR-Trades, API-Alias `tenor` für IRS/AMORT/BASIS/CAP im Web, Dateinamen-Token schlägt Spaltensatz |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | 96 | 98 | 98 | 97,8 | 98,7 | 99,2 | Betreff des `docs(release)`-Commits 74 Zeichen (commitlint rot auf der R9-Range), `fix(core)` trotz neuer Exporte, `quotes`-Eintrag für Sample-Kurven-Id ersetzt beim `discardImport` still die Sample-Kurve, Timeouts unter Last (API ohne `hookTimeout`, Web 10 s) |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | 99 | 99 | 99 | 99,5 | 99,7 | 99,7 | „v0.3.0 wird gesetzt“ (ist gesetzt), „0.2.1/0.3.0“ in CONTRIBUTING, Versionslabel „v0.2“ neben „Stand v0.3“, Tags nicht veröffentlicht |

**Gewichteter Gesamtscore R10:** 97·0,20 + 97,8·0,20 + 99·0,20 + 99,3·0,15 + 99,2·0,15 + 99,7·0,10 = **98,51** (R9 98,85 · R8 97,77 · R7 98,03 · R6 98,10 · R5 97,25 · R4 96,60 · R3 93,60 · R2 83,50 · R1 59,65).

Einordnung: Alle 20 Runde-9-Befunde sind behoben (zwei teilweise). Der Rückgang stammt aus zwei mittleren
Befunden: dem neuen `quotes`-Block, der die impliziten Specs der Sample-Kurven auslässt und dadurch im
Import-Pfad eine falsche Par-Zahl ohne Warnung liefert (R10-1), und einem seit Runde 1 latenten
Observation-Shift-Fehler (N10-1). Runde 10 → 11 ist ein **Härtungsprogramm ohne neue Funktionsoberfläche**:
Konsistenzprüfungen, Invarianten-Tests und Fehlerpfade statt neuer Features.

## Maßnahmenprogramm Runde 10 → 11 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | Observation-Shift mit Tagen der Beobachtungsperiode (Golden gegen QuantLib), Lookback-Reihenfolge `obs(inEffect(d))`, Swap-CVA-Gitter verfeinert (monatlich/wöchentlich wie Optionen, Prämientermin symmetrisch), `INVALID_DATE` für `NaN`/`undefined` in allen Datumsfunktionen, `checkParRiskSpecs(ctx, specs)` (Spec ↔ Kurve, Re-Bootstrap-Vergleich) als öffentliche Prüfung, `sampleBootstrapSpecs` vollständig exportierbar |
| API/CI/Doku | `quotes`-Export für alle Kurven mit Spec (auch Sample-Ids), Import-Modus bumpt nur Snapshot-Specs, `PAR_RISK_INCONSISTENT:` bei Spec ≠ Kurve, abhängige Kurven nach `POST /curves` neu bauen, `quotes` für Sample-Id beim `discardImport` mit Warnung statt stiller Ersetzung, `hookTimeout`/`testTimeout` lasttolerant, Register-Hash ordnungsunabhängig, `GET /api/market` mit `quotes: boolean` je Kurve, Doku-Sätze (Tag-Status, Versionslabel), commitlint-Range im CI unverändert, Betreff-Regel eingehalten |
| Web | Export mit Sample-Specs, Import-Modus nur Snapshot-Specs + Konsistenzprüfung, Snapshot-Tab zeigt Quotes schreibgeschützt, `[index]` für cap/floor/collar/swpt, `Esc` in Inline-Zahlenfeldern, ✕-Fokus mit stabilen Zeilen-Keys, Toast-Aktion/✕-Fokus, leerer Blotter ohne Rückfrage, „+ Währung“-Toast bei vorhandener Kurve, API-Alias `tenor` für alle Typen, Spaltensatz vor Dateinamen-Token, `testTimeout` 20 s |

Die Ergebnisse der elften Bewertung stehen in `11-scorecard-runde-11.md`.
