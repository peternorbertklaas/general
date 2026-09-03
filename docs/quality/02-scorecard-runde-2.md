# Scorecard Runde 2 (nach dem ersten Maßnahmenprogramm)

Bewertet wurde der Arbeitsstand vom 03.09.2026, ca. 22:00 UTC (Core 176 Tests, API 18, Web 104) durch vier
unabhängige Review-Agenten (Berichte: `review-markt-r2.md`, `review-quant-r2.md`, `review-ui-r2.md`,
`review-architektur-r2.md`). Jeder Bericht enthält den Status aller Runde-1-Befunde, neue Befunde mit
reproduzierbarem Nachweis und Fix sowie die Liste „Was für 100 noch fehlt“.

| # | Dimension | Gewicht | R1 | R2 | Wesentliche verbleibende Abzüge |
|---|---|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | CCS/FRA nicht per UI anlegbar, Tilgungsplan im Grundgeschäft, hypothetischer Cap, Kupon-Staffeln, EMIR-Vollständigkeit, Editor-Lücken, Vega FX/2-D, Confirmation/KID, historische Szenarien, CDS-Termstruktur |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | Barrier mit Delivery-Lag, Vega eingebetteter Optionen, IFRS-13-Skopierung, Basis-Szenarien im Hedge-Test, Golden Master, Smile-Interpolation/Broker-Strangle, ICMA-EOM, Methodiktext datengetrieben |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | FX-Option-Analytics falsch beschriftet, Enter auf Pillar-Zeilen, Fokus-Rückgabe nach Modal, Palette-ARIA, Light-Segmente, Toast-Stack, Übersetzungen |
| 4 | User Flows | 15 % | 57 | 82 | Report-Hash ohne Kostentransparenz, Quote-Bump nicht „stale“, Kontrahent-Tokenizer, Termsheet-Druck, Kostentransparenz-Eingaben flüchtig, Hedge-Designationsdatum, Fehler-Validierung blockiert nicht |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | Trade-Schema ohne Diskriminator, Snapshot-PUT ohne Schema, Audit-Finding (swagger-ui), Fehlerklassen, OpenAPI ohne operationId/Responses, ETag-Lücken, Web-Render-Seiteneffekt, Bundle, Prettier/CI |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | Report-Hash nicht deterministisch, IFRS-13-Level falsch (Collateral-Kurve), EMIR-Felder, Doku-Zahlen, IDW RS HFA 35/MaRisk/DORA, Stand nicht committet |

**Gewichteter Gesamtscore R2:** 86·0,20 + 90·0,20 + 88·0,20 + 82·0,15 + 72·0,15 + 76·0,10 = **83,50** (R1: 59,65).

## Maßnahmenprogramm Runde 2 → 3 (in Umsetzung)

| Bereich | Maßnahmen (Quelle) |
|---|---|
| Core (Quant) | R2-1…R2-7, Golden Master, M11-Rest, N8, N-D, N-C, N14 (Quant-Review) · N-01 deterministischer Hash, PricingError, csvCell, ENGINE_VERSION, F-14/F-15/F-26, Governance-Felder, strukturierte Kosten (Architektur-Review) |
| Core (Markt) | CCS-/FRA-Builder, Tilgungsplan im Grundgeschäft, hypothetischer Cap/intrinsische Designation, Kupon-Staffeln, EMIR-Felder (UTI/Cleared/Delta/Zeitstempel), historische Szenarien, CDS-Termstruktur, Monotone Convex/FX-Punkte/Turn-of-Year, Confirmation/KID, JPY-Kurve, Hash mit Kostentransparenz, FX-Option-Analytics |
| API/CI/Doku | diskriminierte Schemas, Snapshot-Schema, Audit + Dependabot, Fehlerklassen, ETag-Vollständigkeit, OpenAPI operationId/Responses, Logging, CI-Schritte (Format/Audit/Coverage), CODEOWNERS/Templates, ADR-021…024, Doku-Konsistenz, Regulatorik-Mapping |
| Web | alle UI-Befunde N-01…N-26 und 🔶-Reste, Editor-Vervollständigung, CSV-Import, Annuität, Buch/Gruppierung, Risiko außerhalb des Renders, Selektoren, ECharts-Tree-Shaking/Chunks, Perspektive Bank/Kunde, Vega 2-D, Governance im Report |

Die Ergebnisse der dritten Bewertung stehen in `03-scorecard-runde-3.md`.
