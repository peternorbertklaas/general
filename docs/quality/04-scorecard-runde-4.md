# Scorecard Runde 4 (nach dem dritten Maßnahmenprogramm)

Bewertet wurde Commit `a3daa92` (Core 298 Tests, API 68, Web 212, E2E 252 Checks) durch vier unabhängige
Review-Agenten (Berichte: `review-markt-r4.md`, `review-quant-r4.md`, `review-ui-r4.md`,
`review-architektur-r4.md`). Alle Runde-3-Befunde wurden einzeln nachgeprüft und als behoben bestätigt;
der Quant-Reviewer hat zusätzlich den Golden-Master mit QuantLib 1.43 gegengerechnet (18 Pillars,
Abweichung gleichförmig 1,9·10⁻⁸ aus der Stub-Konvention).

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | Verbleibende Abzüge (R4) |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | Caplet-Vol-Zellen zu schmal, Swaption-Währung in Palette/Editor, CCS-CSA ohne Kurve für Nicht-USD-Paare, CHF/JPY ohne Zins-Vol-Flächen, Vols nicht per `PUT /api/market`, FRA-Index für 1M/12M |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | Saisonierter MtM-Reset-CCS ohne FX-Fixing, FX-Swap mit Valuta heute, Validierung (Swaption-Expiry, Rebate, Nominalverlauf, Lags), QuantLib-Block/Toleranzangabe |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | Caplet-Vol-Zellen, Chord `y i` vs. Tabellen-`y`, Roving-Tabindex, Datums-Vorlagen committen, englische Hedge-Fehlermeldung, deutsche Datumseingabe in der Palette, doppeltes „What-if“, Kosmetik |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | Roh-JSON-Fehlermeldung beim Import, Toast-Aktion spät in der Tab-Reihenfolge, Offline-Reload ohne Service Worker |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | Limits ohne Hedge-Route/Store-Pfade, `trustProxy`/Rate-Limit-Schlüssel, Datumsfehler als 422, Dependabot ohne Majors, 404/409 ohne `code`, EMIR-Maps in der Query, Chunk-Budget |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | EMIR-Werteformate nach ITS 2022/1860, eine Research-Zeile HFA 35, CHANGELOG-Zeile, Testzahlen, Tag |

**Gewichteter Gesamtscore R4:** 98·0,20 + 97·0,20 + 95·0,20 + 98·0,15 + 94·0,15 + 98·0,10 = **96,60** (R3 93,60 · R2 83,50 · R1 59,65).

## Maßnahmenprogramm Runde 4 → 5 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | FX-Fixings im Marktkontext (saisonierte MtM-Reset-CCS), FX-Swap Valuta heute, Validierung (Swaption-Expiry, Rebate, Nominalverlauf, Lags), QuantLib-Golden-Blöcke mit dokumentierter Toleranz, EMIR-Werteformate ITS 2022/1860, CSA-Kurven-Warnung, FRA-Index-Tabelle, CHF/JPY-Zins-Vol-Flächen |
| API/CI/Doku | Limits auf Hedge-/Store-Pfaden und kumulativer Store-Cap, `TRUST_PROXY`, Datumsfehler → 400, Dependabot-Majors, `code` auf 404/409, EMIR-Maps per POST + Query-Redaction, Vols per `PUT /api/market`, `text/csv` im OpenAPI, Doku-Zeilen |
| Web | Caplet-Vol-Zellen, Chord-Vorrang, Roving-Tabindex, Datums-Vorlagen ohne Commit, übersetzte Hedge-Fehler, deutsche Palette-Daten, Report-Header, Kunden-Termsheet-Zeilen, Überschriftenhierarchie, Import-Fehlertexte, Toast-Tab-Reihenfolge, Service Worker für Offline-Reload, Swaption-Währung |

Die Ergebnisse der fünften Bewertung stehen in `05-scorecard-runde-5.md`.
