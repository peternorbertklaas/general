# Scorecard Runde 8 (nach dem siebten Maßnahmenprogramm)

Bewertet wurde Commit `1cd266e` (Core 396 Tests, API 124, Web 335, E2E 437 Checks, 43 OpenAPI-Operationen) durch
vier unabhängige Review-Agenten (Berichte: `review-markt-r8.md`, `review-quant-r8.md`, `review-ui-r8.md`,
`review-architektur-r8.md`). Runde-7-Befunde: Markt R7-1…R7-4 behoben, R7-5 und R6-5-Rest teilweise (Header-Aliasse
und API-Register ja, Einheiten/Beispielzeilen und Workstation-Pfad nein); Quant N7-1…N7-4, N7-6…N7-9 behoben
(QuantLib-Cross-Checks byteidentisch, Kalender NO/SE/DK/TARGET mengengleich mit QuantLib), N7-5 teilweise (lebendes
Barrier-Modell zahlt das Rebate am Hit); UI/Flows R7-01…R7-06 behoben (Markt-View 44 statt ≈ 500 Tabstopps, 112
Zustände ohne A11y-Verstoß, 6 525 Kontrastpaare ≥ 4,5:1), R7-F1/R7-F2 teilweise (Swaption-Zweig, „+ Paar“/„+ Fläche“
überleben den Import nicht); Architektur N7-01…N7-06 behoben (Node 20 wird durch `engine-strict` real gesperrt, alle
Zahlen stimmen mit der Messung), Commit-Granularität weitgehend, Tag offen.

| # | Dimension | Gewicht | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | Verbleibende Abzüge (R8) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Marktabdeckung Features & Module | 20 % | 60 | 86 | 97 | 98 | 99 | 98 | 98 | 98 | API-Register erreicht die Workstation nicht (CZK-Snapshot → „Unbekannte Währung“, Editor baut CZK-Swap mit EURIBOR-6M), Par-Risiko ignoriert Zusatz-/Importkurven und zeigt still 0, nur 6 von 11 Web-Vorlagen API-importierbar (Spread-Einheit, `tenor`/`expiry`/`period`, FXF-Vokabular), kein Kalender-Register außerhalb des Cores, Snapshot-Kurven außerhalb des Sample-Sets in der Kurvenansicht unsichtbar |
| 2 | Pricing-Korrektheit & Methodik | 20 % | 59 | 90 | 95 | 97 | 97 | 98 | 98 | 96 | Upfront-Prämie geht in `parRate`/`fairSpread` und damit in die Sorensen–Bollier-CVA ein (−20 %/−66 %/+57 %), `cvaFxForward` ignoriert die Prämie, `COLLATERAL_CURVE_MISSING` für gezahlte Prämienwährung, SOFR-Fixingkalender zählt Karfreitag, JP-Kalender 11 Abweichungen zu QuantLib, negative Smile-Pillar-Vols ohne Warnung, kein Lockout-Compounding, Barrier-Rebate-Konvention lebend ≠ entschieden |
| 3 | UI/UX & Hotkeys | 20 % | 62 | 88 | 91 | 95 | 96 | 98 | 98 | 98 | Zeilentabellen des Marktes: nur erstes Control je Zeile per Tastatur erreichbar (`→` im Select ändert den Index, Zeile remountet), FX-Vol-Gitter verliert den Tabstopp nach Wechsel auf kleinere Fläche, `↵`-Commit setzt Fokus auf `body`, `↵` im Kurs-Feld von „+ Paar“ legt nicht an, Fokus nach `d`/Hedge-Reset, Reparaturhinweis unter Import nennt gesperrtes „+ Kurve“ |
| 4 | User Flows | 15 % | 57 | 82 | 94 | 98 | 97 | 98 | 97,5 | 98,3 | Swaption in neuer Währung ohne kuratierten Underlying-Index unbewertbar (kein Index-Feld im Editor), „+ Paar“-Spots und „+ Fläche“-Flächen überleben Import → Verlassen nicht |
| 5 | API, Architektur, Code-Qualität | 15 % | 58 | 72 | 90 | 94 | 96 | 98 | 98 | 97,8 | Stichtagswechsel der API verwirft Laufzeitkurven, Diskontzuordnung, Vol-Overrides und importierte Snapshots still, `collateralDiscountCurveId` ohne Währungsprüfung, Snapshot-ETag ohne Register-Anteil, Envelope-Import nicht atomar, Commit-Betreff > 72 Zeichen / kein commitlint, typbewusstes Lint |
| 6 | Dokumentation & Compliance | 10 % | 62 | 76 | 94 | 98 | 99 | 99 | 99 | 99,5 | Veraltete Sätze („Vite 7“, Kalenderliste ohne NO/SE/DK/PL, Komponentenliste, Research „FX-Vol-Flächen fehlen“), Tag |

**Gewichteter Gesamtscore R8:** 98·0,20 + 96·0,20 + 98·0,20 + 98,3·0,15 + 97,8·0,15 + 99,5·0,10 = **97,77** (R7 98,03 · R6 98,10 · R5 97,25 · R4 96,60 · R3 93,60 · R2 83,50 · R1 59,65).

Einordnung: Der Rückgang gegenüber Runde 7 stammt aus einem einzigen, erst durch die vollständige Prämien-Leg-Abdeckung
systematisch prüfbaren Methodikfehler (N8-1, seit Runde 6 latent). Alle sechs Dimensionen liegen bei 96–99,5; die
Runde-7-Maßnahmen sind zu 32 von 36 Punkten vollständig verifiziert.

## Maßnahmenprogramm Runde 8 → 9 (in Umsetzung)

| Bereich | Maßnahmen |
|---|---|
| Core | `parRate`/`fairSpread` aus den ökonomischen Legs, `parRateAllIn` als eigenes Analytic, `cvaSwap`/`cvaBasisSwap` ohne `upfront` im Rest-Swap, `cvaFxForward` nettet die offene Prämie, `collateralCurveWarnings` nur für Währungen mit Diskontbedarf, SOFR-Fixingkalender `US-SIFMA` (Karfreitag), JP-Kalender mit Ersatz-/Bürgerfeiertagen und Äquinoktien-Formel, Golden `calendars-quantlib.json` um US/UK/CH/JP/SOFR, Berichtstext nur für abgeglichene Kalender, Pillar-Vol-Plausibilität (`atm + bf ± rr/2 > 0`), `barrier.rebateAt` bis ins Modell, `lockoutDays` auf RFR-Legs, Validierung Leg-Währung = Index-Währung, PA-Delta in `analytics`, `validateRateIndex`/`validateSwapConventions`, Kalender-Registrierung serialisierbar |
| API/CI/Doku | Stichtagswechsel bewahrt Laufzeitkurven (Quotes je Kurve), Zuordnungen, Vol-Overrides und importierte Snapshots (Roll oder `discardImport`), Währungsprüfung `collateralDiscountCurveId` (Route + `validateMarket`), Export-ETag mit Register-Anteil, atomarer Envelope-Import, `POST /api/market/calendars` + Envelope `calendars`, Par-Risiko für alle Kurven mit Quotes (`PAR_RISK_INCOMPLETE:`), CSV-Aliasse `tenor`/`expiry`/`period`/FXF-Vokabular und Spread-Einheit wie im Web, commitlint (Betreff ≤ 72), `recommendedTypeChecked`, veraltete Doku-Sätze, CHANGELOG, Tags `v0.1.0`/`v0.2.0` |
| Web | Snapshot-Envelope `indices`/`conventions`/`calendars` beim Import registrieren und exportieren, „+ Währung“ in der Kurvenansicht, `currencyOptions` nur mit Konventionen, Par-Risiko mit Zusatzkurven-Specs und Hinweis statt 0, Snapshot-Kurven als schreibgeschützte Tabs, CSV-Vorlagen mit `bp`-Suffix und API-Aliassen (`tenor`, `pair/baseAmount/rate`, `expiryDate`), Zeilen-Roving über alle Controls mit stabilem `key`, Gitter-`active` klemmen, `↵`-Commit kehrt zur Zelle zurück, `↵` im Kurs-Feld legt an, Fokus nach `d`/Hedge-Reset, kontextabhängiger Reparaturhinweis, Swaption-Zweig mit `chooseIndex` und Underlying-Index-Feld, „+ Paar“/„+ Fläche“ als strukturelle Zusätze (`extraSpots`/`extraVolSurfaces`), Hilfe-Overlay |

Die Ergebnisse der neunten Bewertung stehen in `09-scorecard-runde-9.md`.
