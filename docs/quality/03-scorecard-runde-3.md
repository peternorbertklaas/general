# Scorecard Runde 3 (nach dem zweiten Maßnahmenprogramm)

Bewertet wurde Commit `0b292bd` (Core 270 Tests, API 49, Web 163, E2E 204 Checks) durch vier unabhängige
Review-Agenten (Berichte: `review-markt-r3.md`, `review-quant-r3.md`, `review-ui-r3.md`,
`review-architektur-r3.md`). Alle Runde-2-Befunde wurden einzeln nachgeprüft; neue Befunde sind mit
Datei:Zeile bzw. UI-Schritt, Probe-Ausgabe und Fix dokumentiert.

| # | Dimension | Gewicht | R1 | R2 | R3 | Verbleibende Abzüge (R3) |
|---|---|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | CCS-Template ohne CSA, FRA-Index aus Periodenlänge, Vol-Flächen nur EUR im Beispielmarkt, Vol-Flächen nicht editierbar, Palette-Randfälle, FX-Punkte nur per API, CSV-Vorlagen-Rest |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | Black-Modell auf Normal-Fläche ohne Konvertierung, Snapshot-ID ohne Vols/Fixings/Credit, negative Hazard, Validierungslücken, Monotone-Convex-Extrapolation, Turn-of-Year-Fenster, Methodiktext importierter Kurven, FX-Delta-Konvention im Sample, Barrier-Rebate bei Lieferverzug |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | Browser-reservierte Dokument-Hotkeys, Popover-Esc/Hotkey-Leck, Selects ohne Namen, Druck von Zahlenfeldern, KID-Umbruch, Roh-Identifier im Methodiktext, Kontrast markierter Zeilen |
| 4 | User Flows | 15 % | 57 | 82 | 94 | Dokumente ohne What-if-Warnung, Hedge-Reset ohne Undo, Palette-Fuzzy-ID, Esc in Zahlenfeldern, CSV-Fehlerliste, Undo für Kurveneinstellungen |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | Kein Rechenlast-Limit (1D-Frequenz über 100 Jahre), OpenAPI 3.0.3 vs. verwendete Konstrukte/Komponentennamen, `snapshotTime` unvalidiert, `If-Match` optional, `export *`, Lint-Regeln, CI-Doppellauf |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | IDW RS HFA 47 statt 35 für Fair Value, MaRisk AT 4.3.5, EMIR `clearingObligation`-Ableitung und Feldnummern, Trade-Zahlen/Operationen in Doku, echarts-Advisory nicht dokumentiert |

**Gewichteter Gesamtscore R3:** 97·0,20 + 95·0,20 + 91·0,20 + 94·0,15 + 90·0,15 + 94·0,10 = **93,60** (R2 83,50 · R1 59,65).

## Maßnahmenprogramm Runde 3 → 4 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | Vol-Typ-Konvertierung (Normal↔Lognormal) mit Warnung, vollständige Snapshot-ID, Hazard-Validierung, Trade-Validierung (volOverride, Collar, Nominal, Payment-Lag, PricingError-Codes), Monotone-Convex-Extrapolation, Turn-of-Year-Fenster/Kalenderbindung, Kurvenquelle im Methodiktext, FX-Delta-Konventionen im Sample, Barrier-Rebate, Golden-Master-Bootstrap-Fall, IDW RS HFA 47, EMIR `clearingObligation`/Feldnummern, `TOO_MANY_PERIODS`, `snapshotTime`-Validierung, FRA-Index aus Periodenlänge, Vol-Flächen für USD/GBP/JPY/CHF, CCS-CSA-Default, deutsche Methodikprosa ohne Identifier |
| API/CI/Doku | Rechenlast-Limits (Perioden je Leg, Portfolio-Summen), OpenAPI 3.1 mit benannten Komponenten und Discriminator-Mapping, `snapshotTime`-Format, `clearingObligation`, `REQUIRE_IF_MATCH`, CI ohne Doppellauf + Versions-Drift-Check, CSV-Import mit Vorlagen je Typ, Doku-Zahlen, SECURITY (echarts-Advisory), IDW RS HFA 47 |
| Web | Dokument-Hotkeys als Chords (`o t/g/k/c/p`), What-if-Warnung in Dokumenten, Popover-Layer (Esc/Hotkey-Sperre), Select-Namen, Druck von Zahlenfeldern, KID-Umbruch, Interpolations-Labels, Turn-of-Year-Validierung, Hedge-Reset mit Undo, Palette-ID-Exaktheit, Kontrast markierter Zeilen, Esc = Abbruch in Feldern, UTI-Validierung, CSV-Fehlerliste, Undo für Kurveneinstellungen, CCS-CSA-Default, editierbare Vol-Flächen, `ccs … fixed`, JPY-Strikes, FX-Punkte-Zeile, CSV-Vorlagen |

Die Ergebnisse der vierten Bewertung stehen in `04-scorecard-runde-4.md`.
