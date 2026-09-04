# Scorecard Runde 6 (nach dem fünften Maßnahmenprogramm)

Bewertet wurde Commit `c031daf` (Core 352 Tests, API 99, Web 273, E2E 350 Checks, 41 OpenAPI-Operationen) durch
vier unabhängige Review-Agenten (Berichte: `review-markt-r6.md`, `review-quant-r6.md`, `review-ui-r6.md`,
`review-architektur-r6.md`). Runde-5-Befunde: Markt 4/4 behoben, Quant 5/5 behoben (Theta −484,86 statt +122.030,
gelieferte Option Barwert 0, CDS-Überlebenswahrscheinlichkeiten binnen 6,2·10⁻⁵ an QuantLib), UI/Flows 12/13
behoben (offen: Hedge-Ergebnis nach Reload), Architektur N5-01…N5-06 behoben, N4-07 (Lazy Views, Startchunk
108,7 → 65,0 kB gzip) behoben; offen bleiben Toolchain-Majors und der Release-Tag.

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | R5 | R6 | Verbleibende Abzüge (R6) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | 99 | 98 | Schnelleingabe verschluckt unbekannte Tokens (`irs sek` → EUR), CSV-Vorlagen nur für 7 von 11 Typen, API-CSV ohne `none`/Zeilenfehler bei Schemaverstoß, geschlossenes Währungsregister (NOK/SEK/PLN), Vol-Plausibilität, Beispielmarkt ohne historische Fixings |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | 97 | 98 | Upfront-Prämie nicht als Cashflow (Theta am Vortag ≈ +Prämie), `hazardFromSpread` ohne 365/360, IFRS-13-Hinweis für verfallene Optionen, `valueTodayOnRollDate` bei Platzhaltern, Barrier-Knock-Zustand ohne Flag |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | 96 | 98 | Chunk-Ladefehler ohne Retry, Import-Modus sperrt Zellen nur per Toast, Amortisationsplan ohne Roving, Fokus nach `Esc` aus Chord-Dokument, „Vol-Typ undefined“, CSV-Dialog-Zählung |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | 97 | 98 | FX-Spot-Edit im Import-Modus ändert Snapshot-ID still (kein Undo/Persistenz), Snapshot-Import setzt Vol-Änderungen und Undo-Stack ohne Hinweis zurück, Hedge-Ergebnis nach Reload |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | 96 | 98 | `index.ts` re-exportiert 474/475 Namen (kein `internal`-Einstieg), toter Fallback-Validator im Web, Commit-Granularität, 415 auf body-losen GETs, `text/plain` → 400, Toolchain-Majors |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | 99 | 99 | CHANGELOG-Satz zu entfernten Helfern falsch, Budgetzahl 80 vs. 90 kB, veraltete Sätze (CONTRIBUTING, UI-Konzept `public/sw.js`, US-6.5, US-7.10), Tag |

**Gewichteter Gesamtscore R6:** 98·0,20 + 98·0,20 + 98·0,20 + 98·0,15 + 98·0,15 + 99·0,10 = **98,10** (R5 97,25 · R4 96,60 · R3 93,60 · R2 83,50 · R1 59,65).

## Maßnahmenprogramm Runde 6 → 7 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | Prämien als Cashflow (`kind: "Premium"`) für Theta-Einfachzählung, `hazardFromSpread` in Bootstrap-Konvention, IFRS-13-Hinweis je Lebenszyklus, `valueTodayOnRollDate` nur für tatsächliche Value-Today-Beträge, `barrier.hit`-Flag und `BARRIER_STATE_UNKNOWN:`, `@deriva/pricing-core/internal`-Einstieg, Konventionen für NOK/SEK/PLN/DKK, Vol-Plausibilität (`VOL_IMPLAUSIBLE:`), historische Fixings im Beispielmarkt |
| API/CI/Doku | CSV-Vorlagen für alle Trade-Typen, `collateralCurrency: none`, Zeilenfehler statt 400 bei Schemaverstoß, 415 für `text/plain`, korrekte Response-Listen, `sendError` überall, CHANGELOG-/ADR-/CONTRIBUTING-Korrekturen, Toolchain-Majors (vitest 5, vite 8, jsdom 30) |
| Web | Markt-Edits im Import-Modus über den regulären Pfad (Undo/Export/Persistenz), Chunk-Retry mit „Neu laden“, Snapshot-Import als rückgängig machbare Aktion, echte Sperren im Import-Modus, Roving im Amortisationsplan, Fokusrückgabe nach `Esc`, Fehlertexte, CSV-Dialog-Zählung, Hedge-Ergebnis nach Reload, Schnelleingabe mit Fehlern bei unbekannten Tokens und `imm`, CSV-Vorlagen für FX-Swap/Basis/Amortisation/IMM, „+ Kurve“ für neue Währungen, Übersetzung neuer Warnungen, Entfernung des toten Fallback-Validators, Doku-Sätze |

Die Ergebnisse der siebten Bewertung stehen in `07-scorecard-runde-7.md`.
