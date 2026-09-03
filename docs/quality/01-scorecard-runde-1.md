# Scorecard Runde 1 (Ausgangslage vor der Perfektionierung)

Bewertet wurde der Stand von Commit `2cb1571` (v0.1) durch vier unabhängige Review-Agenten
(Berichte: `review-markt.md`, `review-quant.md`, `review-ui.md`, `review-architektur.md`).

| # | Dimension | Gewicht | Score R1 | Wesentliche Abzüge |
|---|---|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | Hedge Accounting fehlt, Amortisation ohne UI, keine Futures/Basis/XCCY-Inputs, kein Par-Jacobian, CVA nur IRS/FX-Fwd, EMIR-Felder, Dokumente, Alternativenvergleich, Audit-Trail, Excel/Batch, Rollen |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | Operator-Präzedenz beim Cap-Modell, Fixing-Fallback mit df=1, ACT/ACT ICMA, FX-Spot-Date, Theta mit herausfallendem Kupon, Digital-Auszahlung, Stub/IMM/Extrapolation, Szenario-Overwrite, Barrier-Greeks, Φ₂-Normierung, FRA-Fixing, CVA-Letztperiode |
| 3 | UI/UX & Hotkeys | 20 % | 62 | Hotkeys auf DE/macOS-Layouts tot (AltGr/Option), Enter-Doppelauslösung, NumInput-UX, kein Focus-Ring/ARIA, Light-Kontraste, Zahlenformat gemischt |
| 4 | User Flows | 15 % | 57 | Keine Persistenz, kein Undo/Bestätigung, Quotes desynchron, Report ohne What-if-Kennzeichnung, Stichtag nur in Markt-View, Druck unvollständig |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | Keine Body-Validierung, Header-Injection, Fehlerformat, Upsert-Semantik, Security-Header, CI-Doppelangabe, kein Lint/Coverage/E2E |
| 6 | Dokumentation & Compliance | 10 % | 62 | Doku-Aussagen inkonsistent (Testzahlen, Store-Interfaces), IFRS-13 hart codiert, kein Report-Hash, fehlende ADRs, kein CHANGELOG/CONTRIBUTING/SECURITY |

**Gewichteter Gesamtscore R1:** 60·0,20 + 59·0,20 + 62·0,20 + 57·0,15 + 58·0,15 + 62·0,10 = **59,65**.

## Maßnahmenprogramm (abgeleitet, Umsetzung in Runde 1 → 2)

| Bereich | Maßnahmen |
|---|---|
| Core | Hedge Accounting (IFRS 9/HGB), Futures/Basis/XCCY-Bootstrapping + Collateral-Kurve, Par-Risk & Vega-Buckets, generisches CVA, embedded Caplets, RFR-Lookback, CCP-Cash-Settlement, IRRBB-Szenarien, IFRS-13-Heuristik, Report-Hashes, EMIR-Felder, Termsheet/Geeignetheitserklärung, Snapshot-Format, Basis-/Amort-/IMM-/FX-Swap-Builder, quant-review-Findings |
| API | JSON-Schema-Validierung, 201/409/412 + ETag, Audit-Trail, helmet/rate-limit/CORS, Request-ID, Readiness, sichere Dateinamen, Batch-Import, Hedge-/Dokumente-/EMIR-/Snapshot-Endpunkte, deutsches CSV |
| Web | Amortisations-Editor, Konventionen, Fixings, Portfolio-Export/-Import, Status, Kundenmodus, Szenario-Editor, Vergleichs-View, Onboarding, Toast-Queue, Zahlenfelder, layoutsichere Hotkeys, Fokus/ARIA, Formatter-Vereinheitlichung, Persistenz, Undo, Light-Tokens, Druck |
| Qualität | ESLint/Prettier, Coverage-Schwellen, Playwright-E2E in CI, CHANGELOG/CONTRIBUTING/SECURITY/LICENSE, ADR-013…020 |

Die Ergebnisse der zweiten Bewertung stehen in `02-scorecard-runde-2.md`.
