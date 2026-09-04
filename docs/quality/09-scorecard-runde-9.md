# Scorecard Runde 9 (nach dem achten Maßnahmenprogramm)

Bewertet wurde Commit `d470e6a` (Core 421 Tests, API 137, Web 362, E2E 493 Checks, 44 OpenAPI-Operationen, 45
Fehlercodes, 12 Warnungs-Präfixe) durch vier unabhängige Review-Agenten (Berichte: `review-markt-r9.md`,
`review-quant-r9.md`, `review-ui-r9.md`, `review-architektur-r9.md`). Runde-8-Befunde: Markt R8-1…R8-5 behoben
(CZK/HUF end-to-end in API **und** Workstation, 11/11 Vorlagen in beide Richtungen); Quant N8-1…N8-7 behoben
(parRate/fairSpread auf 9 Swap-Typen prämieninvariant, US-SIFMA 106/106 und JP 154/154 mengengleich mit QuantLib,
Smile-Validierung ohne Fehlalarme), N7-5 mit `rebateAt` stetig; UI/Flows R8-01…R8-06, R8-F1, R8-F2 behoben (128
Zustände ohne A11y-Verstoß, 7 406 Kontrastpaare ≥ 4,5:1, Envelope-Roundtrip in frischem Browser); Architektur
N8-01…N8-05 behoben, commitlint 0 Probleme auf der Runde-8-Range, Tags lokal gesetzt (Push aus der Umgebung
nicht erlaubt).

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | Verbleibende Abzüge (R9) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | 99 | 98 | 98 | 98 | 99 | Snapshot ohne Bootstrap-Quotes → Par-Risiko im Import-Modus leer (API und Web), Schnelleingabe `basis [ccy]` baut EURIBOR-Legs, „+ Währung“ im Import-Modus verweist auf gesperrtes „+ Kurve“, API-Vorlagendatei ohne `type` im Blotter abgelehnt, Palette erkennt registrierte Index-Token nicht |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | 97 | 98 | 98 | 96 | 99 | Lockout um einen Geschäftstag gegenüber QuantLib/ISDA verschoben (`lockoutDays: 1` wirkungslos), Prämien-Netting der Swap-CVA über das ganze erste Grid-Intervall, `deltaPremiumAdjusted` ≠ 0 für ausgeknockte Barrier, Default-Rebate-Konvention weiterhin R7-Mischung |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | 96 | 98 | 98 | 98 | 98,8 | „+ Währung“-Formular läuft bei 1024 px über die Karte, „+ Kurve“/„+ Währung“ per ↵ ohne Fokusübergabe ins Formular, „+ Währung“ unter Import (Toast/Fokus), Fokus `body` nach Zeile entfernen, literale Backticks |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | 97 | 98 | 97,5 | 98,3 | 98,1 | Restore-Toast „Zurücksetzen“ ersetzt den Bestand ohne Rückfrage und ohne Undo (erster Tabstopp nach Reload), Index-Token registrierter Indizes in der Schnelleingabe unbekannt, „+ Kurve“ nach „+ Währung“ belegt falsche Währung vor, Snapshot-Kurve nicht registrierter Währung ohne „+ Währung“-Hinweis in der Palette |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | 96 | 98 | 98 | 97,8 | 98,7 | Envelope-Import in frischem Prozess scheitert an zusammengesetzten Kalender-Ids, gerollter Import behält `meta.snapshotTime` (EMIR-Feld 23), Diskontkurven-Regel beim Rebuild nicht angewandt, `validateMarket` ohne Collateral-Währungsprüfung, typbewusstes Lint für Web |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | 99 | 99 | 99 | 99,5 | 99,7 | Drei veraltete Sätze (43 Operationen, Snapshot-ETag, „Tags werden gesetzt“), Tags nicht veröffentlicht |

**Gewichteter Gesamtscore R9:** 99·0,20 + 99·0,20 + 98,8·0,20 + 98,1·0,15 + 98,7·0,15 + 99,7·0,10 = **98,85** (R8 97,77 · R7 98,03 · R6 98,10 · R5 97,25 · R4 96,60 · R3 93,60 · R2 83,50 · R1 59,65).

Einordnung: Alle 25 Runde-8-Befunde sind reproduziert behoben; die neuen Befunde sind durchweg niedrig oder
kosmetisch (ein einziger mittlerer: Envelope-Vorprüfung an der Prozessgrenze). Der größte Einzelposten ist der
Restore-Toast ohne Rückfrage (−1,0 in den Flows).

## Maßnahmenprogramm Runde 9 → 10 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | Lockout-Zählung wie QuantLib/ISDA mit Golden gegen `OvernightIndexedCoupon(lockoutDays)`, Grid-Punkt am Prämientermin in `cvaSwap`/`cvaBasisSwap`, `deltaPremiumAdjusted = 0` bei `settled-payoff`, Default `rebateAt: "hit"` (QuantLib) in Modell und Buildern, Collateral-Währungsprüfung in `validateMarket`, `rollMarket` ohne veralteten `meta.snapshotTime`, Berichtssatz „Par-Satz ohne Prämie, All-in separat“ |
| API/CI/Doku | Envelope-Vorprüfung zerlegt zusammengesetzte Kalender-Ids (Test in eigener Datei/frischem Register), Import-Roll ohne alten Zeitstempel/Label, Diskontkurven-Regel im Rebuild, Envelope-Block `quotes` (Bootstrap-Specs je Laufzeitkurve) für Par-Risiko nach Import, API-Vorlagen mit optionaler Spalte `type`, drei veraltete Sätze, ADR-027/OpenAPI-Präzisierung, CHANGELOG 0.3.0 |
| Web | Restore-Toast mit Rückfrage und Undo-Eintrag, Index-Token aus dem Register (`INDEX_RE` dynamisch), `basis [ccy]` über das Register, Typ-Herkunft beim CSV-Import (Dateiname/Spaltensignatur/Dialog), Envelope `quotes` für `extraCurves` (Export und Par-Risiko nach Import), „+ Kurve“ mit zuletzt registrierter Währung, Palette-Hinweis „+ Währung“ für nicht registrierte Kurvenwährungen, „+ Währung“ unter Import (Toast/Fokus/Sperre), Fokusübergabe in „+ Kurve“/„+ Währung“, Fokus nach Zeile entfernen, 1024-px-Layout, Backticks, typbewusstes Lint für `apps/web` |

Die Ergebnisse der zehnten Bewertung stehen in `10-scorecard-runde-10.md`.
