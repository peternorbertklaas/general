# Re-Review Runde 2: Pricing-Korrektheit & Methodik (Dimension 2, Gewicht 20 %) – DERIVA `@deriva/pricing-core` 0.2.0

**Reviewer-Rolle:** Senior Quant (Multi-Curve, ISDA-Konventionen, Black/Bachelier/SABR, Garman-Kohlhagen, XVA, Hedge Accounting IFRS 9 / HGB § 254) · **Stand:** 03.09.2026, Working Tree (dist-Build 21:21 UTC) · **Modus:** Review only, keine Quell- oder Testdatei geändert
**Baseline:** `docs/quality/review-quant.md` (Runde 1, Score 59 / 100 für den Stand 20:36 UTC)
**Geprüft:** alle 45 Dateien unter `packages/pricing-core/src/**` (zeilenweise: `leg-pricer`, `curve`, `bootstrap`, `fx-pricer`, `fx-spot`, `garman-kohlhagen`, `capfloor-`/`swaption-`/`swap-`/`fra-pricer`, `schedule`, `daycount`, `date`, `sabr`, `black`, `fx-vol-surface`, `vol-surfaces`, `normal`, `sensitivities`, `scenarios`, `cva`, `hedge`, `builders`, `types`, `market-context`, `sample-market`, `index-definitions`, `valuation-report`; Diff zu HEAD `2cb1571` für `calendar`, `interpolation`, `rootfind`, `emir`, `documents`, `snapshot`: unverändert bzw. ohne Bewertungslogik), die Methodiktexte in `reporting/valuation-report.ts`, `docs/architecture/02-adrs.md` (ADR-003/004/011/015/016/019), `docs/research/03-domaene-markt-methodik-regulatorik.md` und `docs/product/02-epics-und-user-stories.md`.
**Methode:** `npx vitest run` → **176 / 176 grün** (9 Dateien, 3,4 s). Vier Probe-Skripte (`probe-r2a…d.mjs`, ESM gegen `dist/index.js`, Auszug in Anhang A) mit Par-Swap-Repricing, Bootstrap-Residuen auf der finalen Kurve, Put-Call-Paritäten (Cap−Floor, Payer−Receiver, FX Call−Put, In+Out, Asset−K·Cash), FX-Zinsparität mit Spot-Date, ACT/ACT ICMA (ISDA-Beispiele), Theta-Zerlegung, SABR- und GK-Roundtrips, Haug-Tabelle 4-13, Φ₂, CVA-Plausibilisierung, Hedge-Effektivitätsfälle. QuantLib ist in der Umgebung nicht installiert; Referenzwerte sind analytisch bzw. aus Literatur (Haug, Hagan, Genz, ISDA-2006-Beispiele, QuantLib-`SabrSmileSection`-Fixture).

---

## 1. Score

### **Pricing-Korrektheit & Methodik: 90 / 100** (rechnerisch 89,8; Runde 1: 59)

**In einem Satz:** Das Remediation-Programm hat den kritischen und alle sechs hohen Befunde der ersten Runde sowie 18 von 19 mittleren Befunden nachweislich behoben – inklusive Regressionstests mit Literatur-Referenzwerten – und die Klebeschicht (Fixings, Spot-Date, Theta, Szenarien, Extrapolation) ist jetzt QuantLib-/Bloomberg-nah; **übrig bleiben vier mittlere neue Befunde in Randbereichen (Barrier-Settlement-Lag, fehlendes Vega für eingebettete Optionen, IFRS-13-Heuristik, Hedge-Regression ohne Basis-Szenarien)** und ein Rest an Konventions-/Doku-Feinheiten.

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, Reibung −1…−3, kosmetisch −0,2…−1):

| Klasse | Abzug | Befunde |
|---|---:|---|
| Kritisch | 0 | – |
| Hoch | 0 | – |
| Mittel (neu) | −6,0 | R2-1 Barrier ignoriert Delivery-Lag (−2,0) · R2-2 kein Vega für eingebettete Caps/Floors (−1,5) · R2-3 IFRS-13-Heuristik falsch skopiert (−1,5) · R2-4 Hedge-Regression ohne Basis-Szenarien (−1,0) |
| Niedrig (neu) | −1,1 | R2-5 ICMA-Notional-Perioden ohne EOM (−0,3) · R2-6 Methodik-/ADR-Texte inkonsistent zur Implementierung (−0,5) · R2-7 Vega-Buckets nur nach Expiry (−0,3) |
| Offen aus Runde 1 | −2,1 | M11 Rest (−0,5) · N8 Rest (−0,5) · N14 (−0,3) · N-C (−0,3) · N-D (−0,5) |
| Referenzwerte | −1,0 | Kein QuantLib-Golden-Master (Cashflow-Tabellen Swap/OIS/Swaption/FX-Forward) |
| **Summe** | **−10,2** | → **89,8 ≈ 90 / 100** |

Zur Einordnung: Ein reines Formel-Review (Modelle, Bootstrap, XVA, Hedge-Arithmetik) läge jetzt bei ≈ 97; die Abzüge kommen aus Randfällen der Verdrahtung und aus Reporting-Heuristiken. Alle vier mittleren Befunde sind zusammen in < 1 Arbeitstag inkl. Tests behebbar.

---

## 2. Status der Runde-1-Befunde

Legende: **behoben** = reproduziert und mit Zahl belegt · **teilweise** = Kern behoben, Restpunkt benannt · **offen** = unverändert.

### 2.1 Kritisch / Hoch

| # | Befund R1 | Status | Nachweis (Probe gegen `dist`, Anhang A) |
|---|---|---|---|
| **K1** | Cap/Floor-Modellauswahl (Operator-Präzedenz) | **behoben** | `capfloor-pricer.ts:46–47` korrekte Klammerung inkl. `ShiftedLognormal → ShiftedBlack`; Test `review-fixes.test.ts:25–51` prüft explizite Modelle; Cap `model:"Bachelier"` = Default-PV 205.335,73 EUR |
| **H1** | Fehlendes Fixing → Kupon ≈ 0 % | **behoben** | `estimateMissingIborRate` (Periode auf heute geschoben, `leg-pricer.ts:50–59`), `Curve.forwardRate` extrapoliert am kurzen Ende mit dem ersten Forward (`curve.ts:187–212`), `missingFixingPolicy: "curve" \| "throw"`, strukturierte `MISSING_FIXING:`-Warnung. Probe: laufender 10Y-Swap ohne Fixing → **2,2060 % statt 0,1401 %** (6M-Forward 2,2100 %), Kupon −112.751 EUR |
| **N-A** | Lookback läuft in H1-Fallback | **behoben** | Spot-Start 2Y-€STR mit Lookback 5: erster Kupon 2,0973 % vs. 2,1000 % plain, **0 Warnungen**; Lookback 1/2 vs. Observation-Shift 1/2 liefern unterschiedliche Gewichte (2,18296/2,18657 vs. 2,19539/2,18321 %) – Varianten korrekt getrennt |
| **H2** | Digital mit Basis-Auszahlung | **behoben** | `fxDigital(i, payoutInForeign)` = S·e^{−r_f T}·N(d₁); Probe: Asset-or-nothing 571.504,60 − 1,18 × Cash 537.932,14 = **33.572,47 = Vanilla 33.572,47** |
| **H3** | Eingebetteter Cap/Floor intrinsisch | **behoben** | Floored-Swap − Swap = **77.559,02 = Standalone-Floor 77.559,02**; fixierte Periode (Fixing 1,5 % < Floor 2 %) intrinsisch 2,0000 %; keine Warnung |
| **H4** | ACT/ACT ICMA ohne Frequenz | **behoben** | `yearFractionContext` übergibt Frequenz und Referenzperiode (`leg-pricer.ts:239–254`); Stubs nach ISMA-Notional-Regel. Probe: 07.09.26→08.03.27 = **0,5**; ISDA-Beispiele Short-Front 0,414365 ✓, Long-Front 0,915761 ✓ (Rest: R2-5) |
| **H5** | FX ohne Spot-Date | **behoben** | `market/fx-spot.ts`: Spot-Date T+2/T+1 auf Paar-Kalender (+USD für Crosses), `fxRateAtValuationDate` = S·DF_Q(t_s)/DF_B(t_s). Probe: EURUSD-Spot-Date 2026-09-08 (Labor Day), Forward @Spot am Spot-Date **PV 0,000000** (USD und EUR), 1Y fair 1,177003; PV_EUR × Today-Rate = PV_USD exakt |
| **H6** | Theta enthält herausfallenden Kupon | **behoben** | `computeTheta` mit `ThetaDetail {total, carry, rollDown, cashflows}`; Receiver mit Kupon morgen: **total +325,59** (Cashflows +192.667 zurückaddiert), Carry 17,90 / Roll-Down 307,68; `forwardRolledTo` reproduziert Forward-DFs (Test) |

### 2.2 Mittel

| # | Befund R1 | Status | Nachweis |
|---|---|---|---|
| M1 | Long-Stub bei glatter Teilung | **behoben** | 5Y/1Y LongFront → 5 Perioden; 27M/1Y → 2 Perioden (15M* + 12M) |
| M2 | IMM-Swap Ende/Roll | **behoben** | „1Y" ab 17.03.2027 → 15.03.2028; `roll:"IMM"` in `buildSchedule` (dritte Mittwoche, Test) |
| M3 | Extrapolation konstante Zero | **behoben** | `extrapolation: "flatForward"` Default für DF-Interpolationen; €STR 1Y-Forward vor/nach 30Y **2,1192 % / 2,1192 %** |
| M4 | Szenario-Overwrite | **behoben** | `[*:+100, EUR-ESTR:+50]` → **150,00 bp** |
| M5 | FX-Delta-Vorzeichen | **behoben** | `buyIsForeign`/`sellIsForeign`, `fxDeltaCurrency`, `fxDeltaSellCurrency`; Test gegen Bump-and-Reprice |
| M6 | Greeks Barrier/Digital aus Vanilla | **behoben** | `fxExoticGreeks` (zentrale Differenzen, Spot-Schritt ≤ ½ Barrierabstand); Digital-Vega ITM −31.273 / OTM +24.218 (Vorzeichenwechsel korrekt) |
| M7 | Φ₂ Faktor 2π | **behoben** | Genz-Halbgewichte (Σ = 1) + `asr/(4π)`: Φ₂(0,0,0,5) = **0,333333**, Φ₂(0,5,0,5,0,5) = 0,546244, Φ₂(1,1,0,95) = 0,8108195, Φ₂(0,0,0,8) = 0,397584 = ¼+asin ρ/2π |
| M8 | FRA ignoriert Fixing | **behoben** | Fixing-Datum = Start − Lag auf Index-Kalender, Fixing ersetzt Forward, Warnung bei fehlendem publizierten Fixing (Test) |
| M9 | CVA-Letztperiode / ATM-Vol | **behoben** | `appendMaturityPoint`; ΣPD = **0,181583 = 1−e^{−0,02·T}**; `swaptionVol(…, strike)` (Smile am Strike), `method` benennt es |
| M10 | Delivery = Expiry + 2 Kalendertage | **behoben** | `fxSpotDateFrom(expiry)` auf Paar-Kalender; Fr 03.09.2027 → Mi 08.09.2027 (Labor Day) |
| M11 | FX-Delta-Konventionen | **teilweise** | `deltaConvention: Spot \| Forward \| PremiumAdjustedSpot`, `atmConvention` genutzt (DNS-Strike je Konvention, K=F·e^{−σ²T/2} für PA), Newton-freie Bisektion auf dem rechten Ast für PA-Calls, flache Extrapolation ab 10Δ. Probe: 25ΔC-Strike 1,24765 / 1,24596 / 1,24198 (Fwd / Spot / PA), Round-Trip Δ = 0,2500 in allen drei. **Offen:** Interpolation weiterhin linear in Δ (Knick an Pillars, sichtbar im Smile 8,12/8,12/7,77/7,70/8,08/8,66/8,88 % bei K/F 0,85…1,15), keine Broker-Strangle-Behandlung (`strangleType`), keine Forward-Premium-Adjusted-Konvention (JPY-Crosses > 1Y) |
| M12 | OIS-Pillar vor letzter Zahlung | **behoben** | Pillar = letzte Zahlung (`bootstrap.ts:157–166`), Residuen auf finaler Kurve: **max 1,7·10⁻¹⁵**, alle Par-Swaps (100 Mio.) PV 0,0000 |
| M13 | Cash-Annuität auf Expiry diskontiert | **behoben** | IRR-Zweig diskontiert auf Settlement (Swap-Start): Annuität 74.354.238 (R1: 74.365.485); CCP-Default = physisch 591.289,99; keine Dauerwarnung (N-E ✓) |
| M14 | OIS-Accrued | **behoben** | `accruedRateTau` = realisiertes Compounding bis heute (Test M14; Probe laufender OIS 2 %-Fixings: Accrued −44.541 EUR) |
| M15 | SABR immer Normal | **behoben** | `swaptionVol` respektiert `volType` (LN-Fläche: 29,620/25,000/22,453 % bei K 2/3/4,5 %), Parameter-Blend statt `nearest` (Stetigkeitstest) |
| M16 | Vol-Shift-Semantik | **behoben** | `irVolShiftFor` mit expliziten Einheiten (`normalBp`/`lognormalPts`/`referenceRate`) |
| M17 | Rebate bei durchbrochener Barriere | **behoben** | H=S Knock-out: **3,0000** (at hit), 2,8824 nur mit `rebateAtExpiry` |
| M18 | SABR β=1 NaN / negative Rates | **behoben** | β=1, f≠K → 14,52 bp endlich; negative geshiftete Rates werfen |
| M19 | Zero-Buckets statt Par | **behoben** | `parRisk`: 10Y-Payer → EUR-EURIBOR-6M „Swap 10Y" 8.704, €STR ≈ 0 (Par-Swap), Summe 8.704 vs. Zero-DV01 8.878 (Rest: N-D) |

### 2.3 Niedrig / Nachtrag R1

| # | Befund R1 | Status | Nachweis |
|---|---|---|---|
| N1 | 30E/360 ISDA `dayCount` ≠ `yearFraction` | **behoben** | `dayCount` mit `isMaturity` (31.01→28.02: 30, Maturity 28); Leg-Pricer setzt `isMaturity` für die letzte Periode |
| N2 | 30U/360 ohne Feb-Regel | **behoben** | 28.02.26→31.03.26 = 30 |
| N3 | `isStub` falsch | **behoben** | Positionslogik; 31.03./6M → keine Stubs |
| N4 | TN/SN = ON | **behoben** | TN 2D, SN 3D |
| N5 | `getFixing` linear | **behoben** | `WeakMap`-Index je Fixing-Array |
| N6 | `require_normInv`-Hack | **behoben** | direkter Import |
| N7 | `smileVols`/eigener `erf` | **behoben** | `erf` entfernt, `normCdf` durchgängig; `smileVols` bleibt als Chart-Helfer (dokumentiert) |
| N8 | IFRS-13-No-op / Perspektive | **teilweise** | Level-Heuristik vorhanden (aber fehlerhaft skopiert → R2-3); **Perspektive Bank/Kunde weiterhin nicht benannt**: `costTransparency.initialMarketValue = −(transactionPrice − fairValue)` „aus Kundensicht" nur im Kommentar; Probe FX-Call (Bank long, zahlt 20.000 für FV 33.572): `initialMarketValue +13.572`, `marginBp −135,7` – Vorzeichen ohne Perspektivangabe nicht interpretierbar |
| N9 | Pips fest 10.000 | **behoben** | `pipFactor` (JPY/HUF/KRW… = 100) |
| N10 | FX-Vega Substring-Match | **behoben** | exakter Paarvergleich inkl. Inversion (Test) |
| N11 | Negativer Forward im Black stiller Fallback | **behoben** | `NEGATIVE_RATE_LOGNORMAL`-Warnung in Cap/Floor und Swaption |
| N12 | Greeks-Einheiten | **behoben** | `deltaPerBp`, `gammaPerBp2`, dokumentierte Einheiten |
| N13 | Initial-Exchange am Bewertungstag | **behoben** | einheitlich `> val` |
| N14 | JP/US-Kalender-Vereinfachungen | **offen** | `calendar.ts` unverändert seit `2cb1571` (kein Diff) |
| N15 | Index-Arithmetik / No-op-`replace` | **behoben** | `nodes()` lesbar, `.replace` entfernt |
| N-B | Generisches CVA +83 % | **behoben** | rollende Sensitivitäten + Vol bei (t, Restlaufzeit): generic 25.391 vs. Sørensen-Bollier 27.403 (**Ratio 0,927**); Profil glatt (358k/382k/306k/171k/7k) |
| N-C | Futures- und FRA-Pillars 8–10 Tage auseinander | **offen** | `sample-market.ts:84–88` weiterhin beide; Pillars 2027-03-08 / 2027-03-16 / 2027-06-07 / 2027-06-17; Sample konsistent (3M-Forwards monoton 2,120 → 2,327 %) |
| N-D | `parRisk` 792 ms je Trade | **offen** | **700 ms** für 10Y-Swap (Re-Bootstrap je Quote); kein Cache der gebumpten Kurvensätze |
| N-E | Dauerwarnung Cash-Swaption | **behoben** | `warnings: []` |

### 2.4 Testabdeckung (R1: −3)

Von 74 auf **176 Tests**; neu u. a. Haug-Tabelle 4-13 (6 Werte + Rebate-Fälle), GK-Greeks vs. zentrale Differenzen (1e-6), Digital-Zerlegung, Φ₂-Referenzen inkl. aller GL-Zweige, SABR-QuantLib-Fixture (27,816/23,365/21,032 %), LN→N-Konsistenz, ISDA-Day-Count-Beispiele, EOM-/LongFront-/IMM-Schedules, Fixing über Ostern, Spot-Date/Labor-Day, Theta-Zerlegung, Szenario-Akkumulation, CVA-Maturity-Punkt, generic-vs-S-B ±25 %, 25 Hedge-Tests, Futures/Basis/XCCY-Bootstrap. **Verbleibend (−1):** kein Golden-Master gegen QuantLib (`ql.VanillaSwap`/`OvernightIndexedSwap`/`Swaption(Cash, CollateralizedCashPrice)`/FX-Forward als eingecheckte JSON-Fixture mit Cashflow-Tabellen) – der Prüfer hat damit weiterhin nur interne Invarianten und Literaturwerte, keine unabhängige Vollbewertung.

---

## 3. Neue Befunde (Runde 2)

Severity wie R1: **Mittel** = Methodik-/Konventionsabweichung mit begrenzter, aber realer Wirkung · **Niedrig** = Inkonsistenz/Doku.

| # | Sev. | Datei:Zeile | Befund | Fix |
|---|---|---|---|---|
| **R2-1** | Mittel (−2,0) | `models/garman-kohlhagen.ts:176–249` (Zeile 177 destrukturiert nur `timeToExpiry: T`), Aufruf `pricing/fx-pricer.ts:184–190` | `fxBarrier` ignoriert `timeToDelivery`: Diskontierung `e^{−rT}`, Drift `b=r−q` und Rebate werden über die Expiry-Zeit gerechnet, während Vanilla (`garmanKohlhagen`) und Digital (`fxDigital`) korrekt bis zum Delivery-Datum diskontieren. Folge: **In + Out ≠ Vanilla im Pricer** – 1Y-EURUSD-Call (Delivery T+5 Kalendertage): UpIn+UpOut = DownIn+DownOut = **33.491,96 vs. Vanilla 33.572,47 USD (−0,24 %)**, exakt gleich GK mit `tDel = tExp`. Bei kurzen Laufzeiten und großem Zinsdifferenzial gravierend: 1W-USDJPY-ATM (r_d 0,1 %, r_f 4,5 %, Delivery +5 Tage): In+Out **0,6703 vs. Vanilla 0,6290 (+6,6 %)**. Barrier-Optionen sind damit die einzige Produktklasse, die die Spot-Date-/Delivery-Logik (H5) nicht erbt. | In `fxBarrier` `tDel = i.timeToDelivery ?? T` einführen und die Raten auf Delivery umskalieren: `const dfd = exp(−rd·tDel), dff = exp(−rf·tDel); r = −ln(dfd)/T; q = −ln(dff)/T;` (damit `e^{−rT} = DF_Q(T_del)` und `S·e^{(r−q)T} = F(T_del)`, Barrier-Diffusion bleibt über T); Rebate-at-hit unverändert. Test: `In + Out = garmanKohlhagen(inputs)` mit `timeToDelivery ≠ timeToExpiry` auf 1e-10; Pricer-Test UpIn+UpOut = Vanilla für `makeFxOption` (Default-Delivery T+2). |
| **R2-2** | Mittel (−1,5) | `risk/sensitivities.ts:150–178` (`vega` nur für `Swaption`/`CapFloor`/`FxOption`), `:382–384` (`vegaBuckets` return für andere Typen), `xva/cva.ts` unberührt | Ein Zinsswap mit eingebettetem Floor (H3-Fix, Kreditabsicherungs-Standard) hat Optionswert, aber **kein Vega im Risikoreport**: Floored-Payer-Swap 5Y (Floor 2 %) PV −99.595 EUR; Szenario `irVolShiftBp: 20` → PV −54.810 (**Δ +44.786 EUR**), `computeRisk().vega = {}`, `vegaBuckets() = []`; Standalone-Floor zeigt 2.161 EUR/bp. IPV-/P&L-Explain ordnet die Vol-Bewegung damit dem „Unerklärt" zu; Limitüberwachung auf Vega sieht die Position nicht. Gleiches gilt für CCS-Legs mit Cap/Floor. | In `computeRisk`/`vegaBuckets` Trade-Typ-Prüfung durch Feature-Erkennung ersetzen: `const hasEmbedded = (t.type==="InterestRateSwap"\|\|t.type==="CrossCurrencySwap") && t.legs.some(l => l.type==="Float" && (l.capRate!==undefined \|\| l.floorRate!==undefined))`; Caplet-Fläche per `${ccy}-${idx.name}` wie im Leg-Pricer wählen und bumpen; Test: Vega(Floored Swap) = Vega(Standalone Floor) ± 1 %. |
| **R2-3** | Mittel (−1,5) | `reporting/valuation-report.ts:64–77` (Schleife über **alle** `ctx.curves`, `analytics.maturity` nur aus `swap-pricer.ts:62–63`) | IFRS-13-Level-Heuristik falsch skopiert: (a) sie prüft die Extrapolation gegen jede Kurve im Kontext, auch irrelevante – **12Y- und 25Y-EUR-Swap (EUR-besichert) werden Level 3**, weil die USD-CSA-Kurve `EUR-ESTR-USDCSA` nur bis 10Y gebaut ist („Laufzeit über letzten Pillar der Kurve EUR-ESTR-USDCSA hinaus"); ohne diese Kurve im Kontext korrekt Level 2. (b) `analytics.maturity` setzen nur die Swap-Pricer, daher greift die Extrapolationsregel für Caps, Swaptions, FX nie: **35Y-Cap und 10y30y-Swaption → Level 2**, obwohl beide über den 30Y-Pillar hinaus extrapolieren. Für den Wirtschaftsprüfer sind beide Richtungen problematisch (falsch-Level-3 stört die Hierarchie-Statistik, falsch-Level-2 ist ein Offenlegungsfehler). | Nur die vom Trade genutzten Kurven prüfen: Diskontkurve(n) je `tradeCurrencies` unter `trade.collateralCurrency` plus Projektionskurven der referenzierten Indizes (Helfer `relevantCurveIds` existiert in `sensitivities.ts:71`, um Collateral erweitern); Fälligkeit über einen typübergreifenden `tradeMaturityDate(trade)` (bereits in `cva.ts:366–384`, exportieren). Für Optionen zusätzlich: letzte Vol-Expiry der Fläche < Optionsexpiry → Level-3-Hinweis. Tests: 12Y-EUR-Swap = Level 2 trotz 10Y-XCCY-Kurve; 35Y-Cap = Level 3. |
| **R2-4** | Mittel (−1,0) | `hedge/hedge.ts:564–584` (`regressionScenarios`), `:789–793` (prospektiver Schock) | Regressions- und prospektiver Dollar-Offset-Test schocken **alle** Kurven parallel (±25…200 bp, Steepener/Flattener). Für Sicherungsbeziehungen mit Index-Mismatch (Kredit 3M-EURIBOR vs. Swap 6M-EURIBOR; €STR-Kredit vs. EURIBOR-Swap) wird die Basis-Ineffektivität konstruktionsbedingt nicht sichtbar: Probe 3M-Darlehen vs. 6M-Payer-Swap → **Dollar-Offset 1,0004, Regression Steigung 1,0004, R² 1,0000** – „effektiv", obwohl IFRS 9 B6.4.14 / IDW RS HFA 35 Tz. 51 gerade die Quelle Ineffektivität (Tenor-Basis) zu würdigen verlangen. Critical-Terms-Match meldet den Index-Mismatch zwar korrekt („nicht erfüllt"), die quantitativen Tests widersprechen ihm aber. | Szenario-Set um Basis-Schocks ergänzen, wenn Index des Grundgeschäfts ≠ Index des Sicherungsinstruments: `curveShifts: [{ target: projCurveOf(hedgedItem.index), parallelBp: ±10/±25 }]` und `{ target: discountCurve, parallelBp: ±25 }` (OIS-Basis); für FX-Hedges zusätzlich Zinsschocks je Währung (Forward-Punkte). Warnung „Regression ohne Basis-Szenarien" ausgeben, wenn Indizes abweichen und nur Parallel-Szenarien vorliegen. Test: 3M-vs-6M-Hedge liefert R² < 1 und Steigung ≠ 1 im Basis-Szenario. |
| **R2-5** | Niedrig (−0,3) | `dates/daycount.ts:159, 171–172` (`addMonths` ohne EOM) | ACT/ACT ICMA Long-Back-Stub: Notional-Perioden werden ohne EOM-Regel gerollt. ISDA-2006-Beispiel (30.11.1999→30.04.2000 quartalsweise, Notional-Perioden 30.11.99–29.02.00 und 29.02.00–**31.05.00**): Soll **0,415761**, Ist **0,419444** (Notional-Periode endet am 29.05.). Wirkung nur bei Monatsend-Referenzperioden (Bond-Hedges mit EOM-Roll). | `addMonths(refEnd, months·(i+1), isEndOfMonth(refStart) \|\| isEndOfMonth(refEnd))` bzw. EOM-Flag aus dem Leg (`leg.endOfMonth`) in `YearFractionContext` durchreichen; ISDA-Beispiel als Test. |
| **R2-6** | Niedrig (−0,5) | `docs/architecture/02-adrs.md:26–27, 65`; `reporting/valuation-report.ts:192–215` | Methodik-Texte hinken der Implementierung hinterher: ADR-011 „Sørensen-Bollier **mit ATM-Normal-Vol**" (Code: Smile-Vol am Strike, `cva.ts:104`); ADR-004 „Greeks analytisch" (Barrier/Digital jetzt Finite Differenzen, `greeksMethod`); `methodologyFor` im Bewertungsreport nennt weder Fixing-Policy/Fallback, RFR-Compounding (Lookback/Observation-Shift), eingebettete Optionen, Flat-Forward-Extrapolation, Theta-Konvention (Constant-Curve-Roll, sticky expiry), CVA-Methode (steht nur in `xva.method`) noch die IFRS-13-Heuristik; „Spot-Date-Anker (T+2)" ignoriert T+1-Paare (USDCAD/USDTRY, `fx-spot.ts:9`). Für einen prüfungsfähigen Report sollte der Methodiktext aus denselben Schaltern generiert werden, die die Bewertung steuert. | `methodologyFor(trade, ctx, pricing)` datengetrieben: Zeilen für `missingFixingPolicy`, RFR-Leg-Konventionen (`lookbackDays`, `observationShift`, `compounding`), `capRate/floorRate`, `extrapolation` der genutzten Kurven, Spot-Lag des Paars, `xva.method`, Theta-Konvention; ADR-004/-011 aktualisieren (Smile-Vol, FD-Greeks). |
| **R2-7** | Niedrig (−0,3) | `risk/sensitivities.ts:375–411` | `vegaBuckets` bucketet Swaptions nur nach **Expiry** (Zeilen des Cubes); Bloomberg/ORE liefern Expiry × Tenor. Für ein Buch aus 5y10y- und 5y2y-Swaptions ist das Tenor-Hedge (10Y- vs. 2Y-Swaps) daraus nicht ablesbar. Cap-Buckets fehlt die Strike-Dimension (weniger kritisch). | Zweite Schleife über `s.tenors` (Spalten) bzw. Zellen-Bump (Expiry × Tenor) mit Option `granularity: "expiry" \| "expiryTenor"`; Summe = Parallel-Vega prüfen (heute 6.516 = 6.516 ✓). |

**Ohne Abzug, aber dokumentierenswert (bewusste Näherungen, korrekt gekennzeichnet):**
- `cvaGeneric` für Optionen (Delta-Normal): Long-Cap 5Y CVA 8.167 auf PV 205.336 (4 %), EPE(1Y) 204.872 ≈ PV; Long-FX-Call EPE(0,5Y) 35.002 > PV 33.572 (Forward-Wert) – plausibel-konservativ, Warnung „Näherungsverfahren" vorhanden.
- CCS-CVA (5Y EUR3M−15bp vs. SOFR, 11,6 Mio. USD): EPE(2,5Y) 586k EUR ≈ 0,4·σ mit σ = 8 %·√2,5·Nominal – konsistent.
- €STR-Cap ohne €STR-Caplet-Fläche im Sample-Markt: 60 bp-Fallback mit Warnung, IFRS-13 → Level 3 (korrekt als nicht beobachtbar).
- Amortisation: Notional-Schedule an Fixed-Leg-Periodenstarts, Float-Leg (6M) folgt jährlich (10/10/8 Mio.) – korrekt zur Dokumentation „linear an Fixed-Leg-Perioden", aber Kredittilgungspläne (halbjährlich/annuitätisch) brauchen den Custom-Import über `notionalSchedule` (vorhanden).
- Theta Swaption: computeTheta −111 (Carry −71, Roll −40) vs. analytisches `thetaPerDay` −131 – Differenz = Forward-Drift durch Constant-Curve-Roll, methodisch erwartbar; FX-Call −63,44 vs. −63,99 ✓.

---

## 4. Verifizierte Positivbefunde Runde 2 (Auszug)

| Bereich | Nachweis |
|---|---|
| Bootstrap (7 Kurven, topologisch €STR → 6M → 3M → SOFR → SONIA → SARON → USDCSA) | Residuen **auf der finalen Kurve** ≤ 1,7·10⁻¹⁵; alle EUR-6M-Swaps und SOFR-OIS (100 Mio.) PV 0,0000; XCCY-Basis-Swap unter USD-CSA −596 EUR vs. −104.960 EUR unter €STR (5Y, 10 Mio.) |
| Paritäten | Cap−Floor = Payer-Swap (Diff −0,0000); Payer−Receiver = Forward-Swap (Diff 0,000000); FX Call−Put = Forward @K (Diff 0,000000); Asset − K·Cash = Vanilla (exakt); Cash-CCP = physisch |
| FX-Konventionen | Spot-Date T+2 Joint-Kalender (Labor Day korrekt), USDCAD T+1; Option-Forward = `fxForwardRate` auf 1e-6; implizite Vol Round-Trip 7,7005 %; GK-Greeks = FD auf 6 Nachkommastellen; Haug-Tabelle 6/6 (inkl. 2,6789 für UO-Call X90/H105) |
| Day Counts / Schedules | ISDA-ICMA-Beispiele Short-/Long-Front exakt; 30E/360 ISDA, 30U/360 korrekt; EOM-Roll, LongFront/LongBack nur bei echtem Stub, IMM-Roll, TN/SN |
| SABR | QuantLib-Fixture 27,816/23,365/21,032 % exakt; LN→Preis→implizite Normal-Vol vs. Normal-Entwicklung 68,16/68,25 · 69,78/69,79 · 77,52/77,54 bp; β = 1 endlich; Guards |
| Φ₂ | alle drei Gauß-Legendre-Sätze und der Simpson-Zweig gegen ¼ + asin ρ/2π bzw. Referenzen |
| Fixings/RFR | Missing-Fixing-Fallback = 6M-Forward ab heute; laufender OIS mit Fixings 2 % → Kupon 2,0648 % (Mischung realisiert/projiziert), Accrued = realisiertes Compounding; Lookback vs. Observation-Shift unterschieden; Theta laufender OIS −93 ≈ frischer OIS −93 (H1-Verzerrung beseitigt) |
| Risiko | DV01 8.878 = Σ DV01 je Kurve = Σ Buckets; parRisk 8.704 im 10Y-Swap-Bucket; Vega-Buckets Σ = Parallel-Vega; Theta-Zerlegung total = carry + rollDown |
| CVA | EPE(t₁) 271.350,69 = Payer-Swaption auf Rest-Swap (Ratio 1,0000); ΣPD exakt; generic/S-B 0,927; Optionen ohne negatives Exposure (long) bzw. positives (short) |
| Hedge Accounting | Perfekter Hedge: Dollar-Offset 1,000001, Regression 1,000001 / R² 1; Hedge Ratio 0,5 mit vollem Swap → Ratio 2,0 + Konsistenzwarnung; +50 bp: OCI 235.600 (lower-of), P&L 0,26, HGB-Überhang 0,26; Off-Market-Swap → Warnung B6.5.5; FX-Hedge: hypothetisches Derivat zum fairen Forward 1,177003, Ratio 1,000000, 30 Szenarien inkl. FX-Schocks; FVH: Sicherungsinstrument −238.201 / Buchwertanpassung +238.201, netto 0 |
| Performance | IRS 0,045 ms; `computeRisk` (voll) 7,2 ms; Sample-Markt 40 ms; `parRisk` 700 ms (N-D) |

---

## 5. Was für 100 noch fehlt

1. **R2-1** `fxBarrier` mit `timeToDelivery` (Raten auf Delivery skalieren) + Paritätstest im Pricer.
2. **R2-2** Vega/Vega-Buckets für eingebettete Caps/Floors (Feature-Erkennung statt Trade-Typ).
3. **R2-3** IFRS-13-Heuristik nur auf genutzte Kurven, Fälligkeit typübergreifend, Vol-Expiry-Check.
4. **R2-4** Basis-Szenarien (Index- und OIS-Basis) im Regressions-/Dollar-Offset-Set bei Index-Mismatch; Warnung, wenn nur Parallel-Schocks.
5. **Referenzwerte:** QuantLib-Golden-Master (Python-Skript + JSON) für Vanilla-Swap, €STR-OIS (Lag 1), Cash-Swaption (CollateralizedCashPrice), FX-Forward mit Spot-Date, Cap; Toleranz 1e-6 relativ.
6. **M11-Rest:** kubische/Vanna-Volga-Interpolation in Δ, `strangleType: "Smile" | "Broker"` (Reiswich-Wystup-Iteration), Forward-Premium-Adjusted-Konvention.
7. **N8-Rest:** `perspective: "Bank" | "Kunde"` als Pflichtfeld der Kostentransparenz; Vorzeichenregel im Report benennen.
8. **N-D:** gebumpte Kurvensätze je Quote einmal erzeugen und portfolioweit cachen (`parRiskPortfolio`) oder Jacobian ∂Zero/∂Quote.
9. **N-C:** je Laufzeitsegment entweder FRAs oder Futures (oder Pillar-Merge-Toleranz).
10. **N14:** JP-/US-SIFMA-Kalender aus Datenfeed; **R2-5** EOM in ICMA-Notional-Perioden; **R2-6** Methodiktext datengetrieben, ADR-004/-011 aktualisieren; **R2-7** Vega-Buckets Expiry × Tenor.

---

## Anhang A – Probe-Ergebnisse (Auszug, Bewertungstag 03.09.2026, Sample-Markt, `dist` 21:21 UTC)

```
bootstrap: order EUR-ESTR -> EUR-EURIBOR-6M -> EUR-EURIBOR-3M -> USD-SOFR -> GBP-SONIA -> CHF-SARON -> EUR-ESTR-USDCSA
  max|res| on final curve: 3.7e-16 / 3.5e-16 / 7.0e-16 / 3.5e-16 / 7.0e-16 / 1.7e-15 / 2.1e-16
  EUR-EURIBOR-6M par swaps (100m) max|PV| 0.0000 ; USD-SOFR par OIS (100m) max|PV| 0.0000
  EUR-3M pillars: 2026-12-07, 2027-03-08 (FRA), 2027-03-16 (Fut), 2027-06-07 (FRA), 2027-06-17 (Fut) … ; 3M fwds 0..15M: 2.120 … 2.327 (monotone)
parities: Cap 205,335.73 − Floor 173,629.90 = 31,705.83 = payer swap 31,705.83 (diff −0.0000)
  Payer 591,289.99 − Receiver 390,131.07 = fwd swap 201,158.91 (diff 0.000000) ; cash CCP 591,289.99 ; cash IRR 586,403.61 (annuity 74,354,238 vs phys 74,973,816)
  FX call 33,572.47 − put 36,436.69 = forward@1.18 −2,864.23 (diff 0.000000)
  UpIn+UpOut(1.25) = DownIn+DownOut(1.10) = 33,491.96 vs vanilla 33,572.47  → R2-1 (GK with tDel=tExp = 33,491.96)
  1W USDJPY-like (rd 0.1%, rf 4.5%, delivery +5d): vanilla 0.6290 vs In+Out 0.6703 (+6.56 %)
  Asset-or-nothing 571,504.60 − 1.18·cash 537,932.14 = 33,572.47 = vanilla
fx: EURUSD spot date 2026-09-08 ; today-rate 1.162251 (spot 1.1625) ; fwd@spot on spot date PV 0.000000 USD / 0.000000 EUR ; 1Y fair 1.177003 (145.0 pts)
  PV_USD −72,045.34 = PV_EUR × today-rate −72,045.34 (× spot: −72,060.75) ; USDCAD spot T+1 2026-09-04
  option fwd 1.177037 = fxForwardRate ; vol 7.7005 % implied back 7.7005 %
  GK greeks = FD: Δ 0.499871 Γ – vega 0.453976 ρd 0.546658 ρf −0.581100 Θ −0.024408
  Haug 4-13: 9.0246 4.0109 2.3453 1.4653 5.4932 11.9752 ✓ ; H=S knock-out rebate at hit 3.0000 (at expiry 2.8824) ; UO call X90/H105 2.6789 ✓
  digital vega ITM −31,273 / OTM +24,218 (finite-difference)
dates: ICMA 07.09.26→08.03.27 = 0.5 ; ISDA short-front 0.414365 ✓ ; long-front 0.915761 ✓ ; long-back EOM example 0.419444 (ISDA 0.415761) → R2-5
  30E/360 ISDA 31.01→28.02: 30 / maturity 28 ; 30U/360 28.02→31.03 = 30 ; LongFront 5Y/1Y = 5 periods ; 27M/1Y = 15M*+12M ; EOM 31.10/30.04 ; IMM 1Y 2027-03-17→2028-03-15 ; TN 2D SN 3D
fixings: seasoned IRS current 2026-03-16→09-16 rate 2.2060 % (6M fwd 2.2100 %) amount −112,751 ; 1 MISSING_FIXING warning
  OIS 2Y spot-start lookback5 2.0973 % / obsShift 2.0973 % (0 warnings, PV −659) ; running OIS with fixings: lookback2 2.18657 obsShift2 2.18321 lookback1 2.18296 obsShift1 2.19539 %
  running OIS fixings 2 %: rate 2.0648 % accrued −44,541 ; theta running OIS −93.02 (fixings) / −93.67 (none) vs fresh −92.72
theta: recv coupon tomorrow total +325.59 carry 17.90 rollDown 307.68 cashflows 192,666.67 ; 10Y par payer −303.11 (carry −0.00) dv01 8,878.28
  swaption 5y10y total −111.39 (carry −70.88, roll −40.51) vs analytic −130.74 ; FX call −63.44 vs analytic −63.99
misc: €STR 1Y fwd before/after 30Y 2.1192 / 2.1192 % (flatForward) ; scenario *+100 then ESTR+50 → 150.00 bp
  Φ₂(0,0,.5)=0.333333 Φ₂(.5,.5,.5)=0.546244 Φ₂(1,1,.95)=0.8108195 Φ₂(0,0,.8)=0.397584 Φ₂(0,0,−.2)=0.217953
  SABR LN 27.816/23.365/21.032 ✓ ; LN→N 68.16/69.78/77.52 vs 68.25/69.79/77.54 bp ; β=1 14.52 bp ; negative f throws
cva: S-B CVA 27,403.10 DVA 9,627.96 ; generic 25,390.73 / 12,266.79 (ratio 0.927) ; EPE(t1) 271,350.69 = swaption 271,350.69 ; ΣPD 0.181583 = 1−e^{−λT}
  S-B EPE: 271k 348k 374k 369k 341k 296k 236k 166k 85k 0 ; FX fwd CVA 7,282 ; swaption long CVA 34,908 DVA 0 / short CVA 0 DVA 17,917 ; CCS CVA 29,760 DVA 10,055
  long cap CVA 8,167 (PV 205,336) EPE(1y) 204,872 ; long FX call CVA 373 EPE(0.5y) 35,002
hedge: perfect ratio 1.000001 slope 1.000001 r2 1 ; 3M loan vs 6M swap ratio 1.0004 slope 1.0004 r2 1.0000 (critical terms false) → R2-4
  hedge ratio 0.5: ratio 2.0000 + warning ; +50bp cumulative ratio 1.000001 OCI 235,599.82 PnL 0.26 HGB excess 0.26 ; off-market pvHedge0 −410,277 warning ✓
  FX hedge hypo sell 5,000,000 USD / buy 4,248,078.24 EUR (1.177003) ratio 1.000000 slope 1.000000 n 30 ; FVH pnl 0.00 (−238,200.81 / +238,200.81)
ifrs13: EUR IRS 5Y L2 ; 12Y L3 (EUR-ESTR-USDCSA) ; 25Y L3 ; 35Y L3 ; 12Y without xccy curve L2 ; cap 35Y L2 (maturity undefined) ; 10y30y swaption L2 → R2-3
embedded: floored − plain 77,559.02 = floor 77,559.02 ; +20bp vol scenario Δ +44,785.61 but computeRisk.vega {} vegaBuckets [] → R2-2 ; seasoned fixed 1.5% → 2.0000 % isFixed
  basis 3M/6M 5Y fair spread 7.81 bp ; collar 42,541.00 = cap 120,100.02 − floor 77,559.02 ; ESTR cap 60bp fallback + warning
smile: 25ΔC strike Fwd 1.24765 / Spot 1.24596 / PA-Spot 1.24198, vol@K = vol@Δ = 8.1500 %, Δ round-trip 0.2500 ; K=1.60 flat 8.875 % = 10ΔC
risk: parRisk EUR-EURIBOR-6M Swap 10Y 8,704 (700 ms) vs zero DV01 8,878 ; zero buckets 6M 3Y..10Y 72/99/126/148/178/198/221/7,797 ; vega buckets 5Y 6,507 + 7Y 9 = 6,516 = parallel
  IRS 0.045 ms ; computeRisk 7.2 ms ; sample market 40 ms
edges: swap maturing tomorrow PV −187,238 (1/1 cfs) ; maturing today 0 ; expired swaption intrinsic + warning ; FX option expiring today = intrinsic on fwd to delivery ; Black floor K<0 → 0 + NEGATIVE_RATE_LOGNORMAL
  CCS ESTR−22bp vs SOFR MtM 5Y: −104,960 (ESTR disc) vs −596 (USD-CSA) ; USD leg PV 0.00 ; upfront 50k @spot → −49,988.84
```

Probe-Skripte: `probe-r2a.mjs` (Bootstrap, Paritäten, FX, Day Counts, Fixings, CVA), `probe-r2b.mjs` (Hedge, IFRS 13, Risiko, eingebettete Optionen, Smile, Randfälle), `probe-r2c.mjs` (Barrier-Delivery, ICMA-EOM, Embedded-Vega, IFRS-13-Scoping, Theta), `probe-r2d.mjs` (Lookback-Varianten, Theta laufender OIS) – ausgeführt gegen `packages/pricing-core/dist` (Build 21:21 UTC); alle Zahlen des Hauptteils daraus reproduziert.
