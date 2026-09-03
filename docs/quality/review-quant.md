# Review: Pricing-Korrektheit & Methodik (Dimension 2) – DERIVA `@deriva/pricing-core` v0.1

**Reviewer-Rolle:** Senior Quantitative Developer (Front-Office-Pricing-Bibliotheken, QuantLib/ORE-Hintergrund) · **Stand:** 03.09.2026 · **Modus:** Review only (kein Quellcode geändert)
**Geprüft:** 40 Dateien unter `packages/pricing-core/src/**` (math, dates, curves, models, market, instruments, pricing, risk, xva, reporting, hedge sowie fünf `*.test.ts`). Während des Reviews arbeitete ein zweiter Agent parallel am Paket (HEAD `2cb1571` 20:10 UTC → Working Tree 20:36 UTC, `dist` 20:36:51): neue Builder (Basis/IMM/Amortisation/FX-Swap), Multi-Curve-Bootstrap (Futures, Tenor-Basis, XCCY-Basis, `bootstrapCurves`), `parRisk`/`vegaBuckets`, Lookback/Observation-Shift für RFR-Legs, Bewertung eingebetteter Caps/Floors, generisches Delta-Normal-CVA, Cash-Settlement-Konvention, IRRBB-Szenarien, IFRS-13-Level-Logik, Snapshot/EMIR/Termsheet/Hedge-Accounting-Module. Der Hauptteil (Abschnitte 2–7) bezieht sich auf den Stand 20:15 UTC; **Abschnitt 1a (Nachtrag) verifiziert alle Befunde erneut gegen den Stand 20:36 UTC und bewertet den neuen Code.** `hedge/hedge.ts` wurde partiell (hypothetisches Derivat, Dollar-Offset, Regression), `reporting/documents.ts` nicht (keine Bewertungslogik) geprüft.
**Methode:** Zeilenweises Lesen mit Term-für-Term-Abgleich der Formeln gegen Haug (*Complete Guide to Option Pricing Formulas*, Tab. 4-13), Hagan et al. 2002 (Gl. 2.17a / App. B.69), Genz 2004, ISDA-2006-Definitionen und QuantLib-Konventionen; `npx vitest run` (74/74 grün); drei numerische Probe-Skripte gegen `dist/` (Zahlen im Text und in Anhang A). QuantLib ist in der Umgebung nicht installiert – Referenzwerte sind daher analytisch bzw. aus Literaturtabellen.

---

## 1. Score

### **Pricing-Korrektheit & Methodik: 59 / 100** (Working Tree 20:36 UTC; 55 / 100 für den Stand 20:15 UTC)

**Begründung in einem Satz:** Der analytische Kern ist überdurchschnittlich sauber – Reiner-Rubinstein-Barrieren stimmen in allen 29 nicht-degenerierten Haug-Tabellenfällen auf < 5·10⁻⁴, Garman-Kohlhagen-Greeks (inkl. Theta, Rho) stimmen mit Finite Differenzen auf 6 Nachkommastellen, SABR-Lognormal- und -Normal-Entwicklung sind term-für-term korrekt und untereinander auf 0,1 bp konsistent, Bootstrap repriziert alle Quotes (max. Par-Abweichung 0,0002 bp), die Sørensen-Bollier-Exposure hat exakt die Einheiten des Swaption-Preisers (Ratio 1,000) – **aber in der „Klebeschicht" liegen ein kritischer und sechs hohe Fehler, die bei alltäglichen Geschäften (laufende Swaps ohne geladene Fixings, explizit konfigurierte Caps, Swaps mit Floor, FX-Forwards) falsche Zahlen ohne harten Fehler liefern**, und einige Konventionen (Spot-Date, IMM-Roll, Long-Stub, Extrapolation) sind noch nicht QuantLib-/Bloomberg-konform.

**Abzugsherleitung** (Rubrik: kritischer Fehler −10…−25, fehlendes Kernfeature −3…−8, Reibung −1…−3, kosmetisch −0,2…−1):

| Klasse | Abzug | Befunde (Nr. → Tabelle Abschnitt 3) |
|---|---:|---|
| Kritisch | −10 | K1 Cap/Floor-Modellauswahl durch Operator-Präzedenz falsch (explizit „Bachelier" → Black; PV 66.517 statt 205.336 EUR) |
| Hoch | −19 | H1 Fehlendes Fixing → Kupon nahe 0 % statt Kurven-Forward (−6); H2 Digital mit Auszahlung in Basiswährung falsch bewertet, −7,9 % (−3); H3 eingebetteter Cap/Floor nur intrinsisch (−3); H4 ACT/ACT ICMA liefert τ = 1 je Periode (−2); H5 FX-Forward/-Option ohne Spot-Date-Anker, 2,5 Pips auf 1Y EURUSD (−3); H6 Theta enthält herausfallenden Kupon, −299.257 statt +184 EUR (−2) |
| Mittel | −11 | M1–M19 (Stub-Logik, IMM-Builder, Extrapolation, Szenario-Overwrite, FX-Delta-Vorzeichen, Greeks Barrier/Digital, `bivariateNormCdf` Faktor 2π, FRA-Fixing, CVA-Letztperiode, FX-Delivery am Sonntag, Delta-Konvention Smile, OIS-Pillar, Cash-Annuität, OIS-Accrued, SABR-Sonderfälle, Vol-Shift-Semantik, Rebate, Bucketing ohne Par-Jacobian) |
| Niedrig | −2 | N1–N15 (Daycount-Inkonsistenzen, Aliase, Dead Code, Einheiten-Doku, Kalender-Vereinfachungen) |
| Testabdeckung / Referenzwerte | −3 | Keine Literatur-/QuantLib-Referenzwerte für Barrier, SABR, Schedules, Daycounts; Positivtests, die den Fehlerpfad nicht abdecken (siehe Abschnitt 5) |
| **Summe (Stand 20:15 UTC)** | **−45** | → **55 / 100** |
| Nachtrag Working Tree 20:36 UTC (Abschnitt 1a) | **+4** | behoben: H3 (+3), M13 (+0,5), M19 (+2), N8 teilweise (+0,3); neu: N-A Lookback läuft in den H1-Fallback (−1), N-B generisches CVA +83 % gegenüber Sørensen-Bollier (−1) → **59 / 100** |

Zur Einordnung: Ein reines Formel-Review (Abschnitte Modelle/Bootstrap/XVA) läge bei ≈ 90; der Score wird von Fixing-Handling, Konventionen und Konfigurations-Bugs gedrückt. Die meisten Hoch-Befunde sind mit wenigen Zeilen behebbar (Aufwand für K1 + H1 + H4 + H6 + M4 + M5: < 1 Arbeitstag inkl. Tests).

---

## 1a. Nachtrag – Re-Verifikation gegen Working Tree 20:36 UTC (`dist` 20:36:51)

Alle drei Probe-Skripte wurden gegen den neu gebauten `dist` wiederholt; **K1, H1, H2, H4, H5, H6, M1–M12, M14–M18 und N1–N7, N9–N15 reproduzieren mit identischen Zahlen** (Cap `model:"Bachelier"` → Black 66.517 EUR; Fixing-Fallback 0,1401 %; Digital 530.834 vs. 572.479; Φ₂ 0,26326; Szenario +50 statt +150 bp; FX-Spot-PV 2.484,50 USD; LongFront 4 Perioden; IMM „1Y" → 15 Monate; Theta −299.257). Die 92 Tests (5 Dateien) sind grün.

**Im Working Tree behoben / adressiert**

| Befund | Status | Nachweis |
|---|---|---|
| H3 eingebetteter Cap/Floor | **behoben** | `expectedCollaredRate` (`pricing/leg-pricer.ts:121–157`): E[min(max(L,floor),cap)] = L + Floorlet − Caplet mit Bachelier/Black aus der Caplet-Fläche, intrinsisch nur für fixierte Perioden; Probe: Floored-Swap (Floor 2 %) − Swap = **77.559 EUR = Standalone-Floor 77.559 EUR** |
| M13 Cash-Settlement | **behoben** | `cashSettlementConvention` (`instruments/types.ts:117–122`), Default „CollateralisedCashPrice" = Diskont-Annuität, IRR als Legacy (`swaption-pricer.ts:44–51`); Test angepasst. Offen: IRR-Zweig diskontiert weiterhin auf Expiry statt Settlement |
| M19 Par-Sensitivitäten | **adressiert** | `parRisk` (`risk/sensitivities.ts:217–265`): Quote-Bump + Re-Bootstrap in Abhängigkeitsreihenfolge. Probe 10Y-Payer: EUR-EURIBOR-6M **Swap 10Y: 8.704**, €STR-OIS 1Y–10Y je 1–20, Summe 8.759 vs. Zero-DV01 8.933 (plausible Par/Zero-Differenz) – genau das Profil, das Händler erwarten. Restpunkt: Laufzeit (N-D) |
| Vega-Buckets | **neu, korrekt** | `vegaBuckets` (`sensitivities.ts:308–337`): 5y10y-Swaption 5Y-Zeile 6.590 + 7Y-Zeile 9 = 6.599 = Parallel-Vega; 5Y-Cap Zeilen 118/308/532/988/543 = 2.490 = Parallel-Vega |
| N8 IFRS-13-Level | **teilweise** | `ifrs13Level` (`valuation-report.ts:53–75`): Level 3 bei Vol-Override, fehlender Fläche, Extrapolation über letzten Pillar; Perspektive Bank/Kunde weiterhin nicht benannt |
| Fehlende Features (Abschnitt 6) | **teilweise** | Futures (mit Konvexitäts-Input), Tenor-Basis- und XCCY-Basis-Bootstrap, `bootstrapCurves` (topologisch), Lookback/Observation-Shift, IRRBB-Standardschocks (EBA-Formel e^{−t/4} korrekt), EMIR-Bewertungsfelder, Hedge-Accounting (hypothetisches Derivat, Dollar-Offset, Regression, IFRS 9/HGB-Split), CVA für alle Trade-Typen (Näherung) |

**Bewertung des neuen Codes**

- `curves/bootstrap.ts` (Working Tree): `bootstrapCurves` baut in Abhängigkeitsreihenfolge (Probe: EUR-ESTR → EUR-EURIBOR-6M → EUR-EURIBOR-3M → USD-SOFR → EUR-ESTR-USDCSA), alle Residuen ≤ 1,5·10⁻¹⁵. Futures: Start = erster IMM-Termin ≥ Spot + Tenor (Following), Ende = Start + Index-Tenor (MF), Konvexität als Input – Standard. Tenor-Basis: OIS-Leg zahlt im IBOR-Tenor – konform. XCCY-Basis: konstantes Nominal, quartalsweise, Joint-Kalender, Zahlungs-Lag = max(beide OIS-Lags), Spot-Anker aus der Projektionskurve – konform (Marktstandard ist MtM-Reset, als Näherung dokumentiert). CSA-Kurve EUR-ESTR-USDCSA liegt **−14,3 / −16,5 / −22,2 / −25,5 bp** (1/2/5/10Y) unter €STR – Vorzeichen für negative EUR/USD-Basis korrekt; 5Y-Basis-Swap zu −22 bp unter USD-CSA repriziert mit −1,22 EUR je 1 Mio. (Pillar-Effekt M12).
- `pricing/leg-pricer.ts:76–113` Lookback/Observation-Shift: Gewichtung (Accrual- vs. Beobachtungsperiode) korrekt umgesetzt; Forward-Start-Probe: Lookback 5 GT senkt den ersten Kupon von 2,1172 % auf 2,1130 % (echter Lookback-Effekt auf steigender Kurve). **Aber:** Spot-Start läuft in den H1-Fallback (N-A).
- `xva/cva.ts:186–232` `cvaGeneric`: Delta-Normal-Exposure (σ = √((DV01·10⁴·σ_N)² + Σ(Δ_FX·100·σ_FX)²)·t), EPE = σφ(μ/σ) + μΦ(μ/σ) – Formel korrekt, Optionsvorzeichen korrekt (Long-Swaption ENE = 0, Short EPE = 0, Basis-Swap CVA 1 / DVA 510 plausibel). Kalibrierung aber grob (N-B).
- `hedge/hedge.ts:398–430` hypothetisches Derivat: Par-Swap zum Designationsmarkt bzw. FX-Forward zum Terminkurs – konzeptionell korrekt; erbt H5 (FX-Spot-Date) und H1 (laufende Legs).

**Neue Befunde (Working Tree)**

| # | Sev. | Datei:Zeile | Befund | Fix |
|---|---|---|---|---|
| **N-A** | Hoch (Erweiterung H1) | `pricing/leg-pricer.ts:85–101` | `while (d < end && obs(d) < val)`: bei Spot-/nah startenden Perioden liegen die Beobachtungstage der ersten `lookback` Tage vor dem Bewertungstag → als „realisiert" behandelt, Fixing fehlt, Fallback `forwardRate(od, oStop)` mit od < Referenzdatum ≈ 0 %. Probe 2Y-€STR-OIS Spot-Start, Lookback 5: **erster Kupon 2,0804 % statt 2,1000 %, PV −2.332 EUR/10 Mio.**, dazu die falsche Warnung „Missing ESTR fixings" für ein noch nicht gestartetes Geschäft. Damit betrifft H1 nicht mehr nur Altbestand, sondern **jeden neuen SOFR/€STR-Swap mit Lookback** (Kreditstandard). | `ts const r = fixing ?? projCurve.forwardRate(Math.max(od, val), Math.max(oStop, addBusinessDays(val, 1, cal)), idx.dayCount);` mit Warnung nur, wenn `od < val` **und** ein Fixing erwartet werden musste (Index-Publikationskalender); Ursache in `Curve.forwardRate` (Fehler bei start < Referenz) beheben; Test: Spot-Start mit Lookback ohne Fixings darf keine Warnung und ≤ 0,5 bp Abweichung zum Forward-Start-Äquivalent liefern. |
| **N-B** | Mittel | `xva/cva.ts:186–232` | `cvaGeneric` hält DV01/FX-Delta von heute über die gesamte Laufzeit konstant (keine Amortisation des Risikos), nimmt die Normal-Vol fest bei (T/2, 5Y) und gewinnt μ über `rollMarket` – erbt damit H6 (Kupon-Drop-outs: EPE springt zwischen t = 1,0 und 1,25 Y von 139.879 auf 249.968). Für denselben 10Y-Payer-Swap: **49.307 vs. 26.896 (Sørensen-Bollier) = +83 %**. Da die Methode für CCS, Basis-Swaps, Swaptions, Caps und FX-Optionen die einzige ist, wird CVA dort systematisch überschätzt (Kundenpreis zu hoch). | DV01(t) aus dem gerollten Trade (`computeRisk(rollMarket(ctx,days),…).dv01`) bzw. aus der Restannuität; μ um gezahlte Cashflows korrigieren (H6-Fix); Vol bei (t, Restlaufzeit); für Swaptions/Caps EPE über Forward-Optionspreis statt Normalnäherung; Regressionstest: generic vs. Sørensen-Bollier innerhalb ±25 % für Vanilla-Swaps. |
| **N-C** | Niedrig | `market/sample-market.ts:81–83`, `curves/bootstrap.ts:156–160` | Futures- und FRA-Pillars liegen 8–10 Tage auseinander (2027-03-08 FRA 3x6 / 2027-03-16 Future Dez-IMM+3M; 2027-06-07 / 2027-06-17) und werden unabhängig gelöst → bei realen, nicht exakt konsistenten Quotes trägt ein 8-Tage-Segment die gesamte Inkonsistenz (Sägezahn in den Forwards). Im Sample konsistent (3M-Forwards monoton 2,12 → 2,33 %). | Pro Laufzeitsegment entweder FRAs oder Futures (QuantLib-Praxis), oder Pillar-Merge-Toleranz (`minPillarGapDays`, Least-Squares statt exaktem Repricing). |
| **N-D** | Niedrig | `risk/sensitivities.ts:243–256` | `parRisk` rechnet je Trade und je Quote einen vollständigen Re-Bootstrap aller abhängigen Kurven: **792 ms für einen 10Y-Swap** (≈ 45 Quotes × 3 Kurven); 500 Trades ≈ 7 Minuten, obwohl die gebumpten Kurvensätze trade-unabhängig sind. | Gebumpte Kurvensätze einmal pro Quote erzeugen und über das Portfolio cachen (`parRiskPortfolio`), alternativ Jacobian ∂Zero/∂Quote einmal berechnen und auf Zero-Buckets anwenden. |
| **N-E** | Niedrig | `pricing/swaption-pricer.ts:67–69` | Bei jeder Cash-Swaption-Bewertung wird eine Konventions-„Warnung" ausgegeben (kein Anomalie-Hinweis) – `warnings` verliert seine Signalwirkung, Report/UI zeigen Dauerwarnungen. | Nur in `analytics.settlement` ausweisen (bereits vorhanden), Warnung entfernen. |

---

## 2. Verifizierte Positivbefunde (keine Lücke)

| Bereich | Nachweis (Probe) |
|---|---|
| **Reiner-Rubinstein-Barrieren** (`models/garman-kohlhagen.ts:150–217`) | Alle 8 Fälle (Up/Down × In/Out × Call/Put) mit beiden Strike/Barrier-Zweigen term-für-term gegen Haug A–F verifiziert; numerisch 29/29 Werte aus Haug Tab. 4-13 (S=100, K=3, T=0,5, r=8 %, b=4 %, σ=25 %) auf max. 4,7·10⁻⁴ reproduziert, z. B. Down-Out-Call X=90/H=95: 9,0246; Up-In-Put X=110/H=105: 7,0846 |
| **Garman-Kohlhagen-Greeks** (`garman-kohlhagen.ts:44–98`) | Δ 0,500203 / Γ 4,362091 / Vega 0,453912 / ρ_d 0,550003 / ρ_f −0,584672 / Θ −0,024410 – identisch mit zentralen Differenzen; auch bei `timeToDelivery ≠ timeToExpiry` |
| **SABR** (`models/sabr.ts`) | Hagan 2002 Gl. 2.17a (Lognormal, inkl. ATM-Grenzfall) und Normal-Vol-Entwicklung (γ₁ = β/f_mid, γ₂ = β(β−1)/f_mid², exaktes ∫dx/C(x)) korrekt. Konsistenz LN→Preis→implizite Normal-Vol vs. `sabrNormalVol`: 68,16 vs. 68,25 bp (K=2 %), 69,78 vs. 69,79 bp (ATM), 77,52 vs. 77,54 bp (K=4,5 %) |
| **Bootstrap** (`curves/bootstrap.ts`) | Alle 18 €STR-Quotes und alle EURIBOR-6M-Quotes (Depo, FRA, Swaps) repriziert; max. Par-Abweichung 0,0002 bp; Dual-Curve-Stripping mit OIS-Diskontierung korrekt; Pseudo-DF-Anker am Spot konsistent |
| **OIS-Compounding in Arrears** (`pricing/leg-pricer.ts:64–103`) | Tägliches Compounding mit Geschäftstagekalender, realisiert bis Bewertungstag exklusive (€STR-Publikation T+1 korrekt abgebildet), Rest über DF-Quotient (exakt für log-linear); Averaging-Variante vorhanden |
| **Schedule-Grundlogik** (`dates/schedule.ts`) | Backward-Roll vom unadjustierten Ende ohne Drift (jeweils `addTenor(end, −n·i)`), Fixing vom adjustierten Accrual-Start, Zahlungs-Lag in Geschäftstagen, getrennte Kalender für Fixing/Zahlung, EOM-Regel |
| **Kalender** | TARGET2 vollständig; US (SIFMA-Stil) inkl. Observed-Regeln und 31.12.; UK Substitute Days inkl. Sonderjahre 2011/2012/2020/2022/2023; Oster-Algorithmus (Meeus) verifiziert |
| **Swaption** | Payer − Receiver = Forward-Swap (Test); ATM-Straddle-Näherung; Cash-Annuität IRR-Formel korrekt (5y10y: 74,37 Mio. vs. physisch 74,97 Mio.); Expiry vs. Swap-Start (+2 GT) korrekt |
| **CVA (Sørensen-Bollier)** (`xva/cva.ts:54–112`) | EPE(t₁) = 271.233 EUR = exakt der Preis der Payer-Swaption mit Expiry t₁ auf den Rest-Swap (Ratio 1,000); Annuität bereits auf heute diskontiert → **keine Doppeldiskontierung**; Marginal-PDs summieren zu 1−e^{−λT} (0,1650); DVA-Vorzeichen (BCVA = −CVA + DVA) korrekt |
| **CCS mit MtM-Reset** | SOFR-flat-Leg mit Initial/Interim/Final-Exchange hat PV 0,00 USD sowohl konstant als auch resettend (Par-Floater-Eigenschaft); Reset-Notionale = N_EUR·F(t_i); Vorzeichen der Interim-Exchanges korrekt |
| **Normalverteilung** | West 2005 (`normCdf`) inkl. Kettenbruch-Ast, Acklam + Halley (`normInv`) – Standard, Tests grün |
| **Performance** | IRS 10Y: 0,12 ms; `computeRisk` (parallel, je Kurve, bucketed über 3 EUR-Kurven, FX): 13 ms; Sample-Markt (6 Kurven) 60 ms; laufender OIS mit 3.640 Fixings 44 ms |

---

## 3. Befunde

Severity: **Kritisch** = falsche PV ohne Fehlermeldung bei Standardnutzung · **Hoch** = falsche PV/Risiko bei häufigen Konstellationen oder klarer Konventionsbruch · **Mittel** = Methodik-/Konventionsabweichung, begrenzte Wirkung · **Niedrig** = Inkonsistenz, Dead Code, Doku.

### 3.1 Kritisch

| # | Datei:Zeile | Befund | Fix |
|---|---|---|---|
| **K1** | `pricing/capfloor-pricer.ts:31` | `const model = trade.model ?? surface?.volType === "Lognormal" ? "Black" : trade.model ?? "Bachelier";` – `===` bindet stärker als `??`, der Ausdruck wird als `(trade.model ?? (volType === "Lognormal")) ? "Black" : …` geparst. **Jede explizite Modellangabe ist truthy → „Black"**. Probe: `model: "Bachelier"` → `analytics.model = "Black"`, PV 66.517 EUR statt 205.336 EUR (5Y-Cap 2,5 %, 10 Mio.); `"ShiftedBlack"` → Black ohne Shift. `"ShiftedLognormal"`-Flächen werden nie auf ShiftedBlack gemappt. Der Default-Pfad (kein `model`, Normal-Fläche) ist korrekt, daher nicht von Tests erkannt. | `ts const model: "Bachelier"\|"Black"\|"ShiftedBlack" = trade.model ?? (surface?.volType === "Lognormal" ? "Black" : surface?.volType === "ShiftedLognormal" ? "ShiftedBlack" : "Bachelier");` – plus Test: `model` explizit setzen und `analytics.model` prüfen; Lint-Regel `no-mixed-operators` / `@typescript-eslint/no-unnecessary-condition`. |

### 3.2 Hoch

| # | Datei:Zeile | Befund | Fix |
|---|---|---|---|
| **H1** | `pricing/leg-pricer.ts:52–60` (IBOR), `:83–86` (OIS); Ursache `curves/curve.ts:148–162` | Fehlt ein historisches Fixing, wird `projCurve.forwardRate(accrualStart, accrualEnd)` mit `accrualStart < referenceDate` gerufen. `df(d) = 1` für d ≤ Referenz ⇒ der „Forward" ist der Zins über [heute, Ende] geteilt durch τ der **ganzen** Periode. Probe: laufender 5Y-Swap, Periode 16.03.–15.09.2026: **Rate 0,1401 % statt ≈ 2,14 %**; Kupon, der morgen zahlt: **−558 EUR statt ≈ −105.000 EUR** (10 Mio.). OIS: 1,088 % statt 2,05 %; realisierte Tage mit fehlendem Fixing bekommen **0 %**. Die Warnung „used curve forward" ist damit inhaltlich falsch. Folgewirkung: Theta laufender OIS (+70,84 vs. +20,76 für frisch startenden) verzerrt, weil beim 1-Tages-Roll der gestrige Tag mit 0 % realisiert wird. | (a) `InterpolatedCurve.forwardRate`: `if (start < this.referenceDate) throw new Error("forward requested before curve reference date")`. (b) Leg-Pricer: IBOR ohne Fixing → `rate = projCurve.forwardRate(max(start, val), end)` als Näherung **und** `isFixed:false, warning`; besser: konfigurierbar `missingFixingPolicy: "throw" \| "lastAvailable" \| "curve"`. (c) OIS: fehlende Tagesfixings mit letztem verfügbaren Fixing oder O/N-Forward `projCurve.forwardRate(val, addBusinessDays(val,1,cal))` füllen, nie mit 0. (d) Test: seasoned swap ohne Fixings → Kupon innerhalb ±10 bp des 6M-Forwards. |
| **H2** | `pricing/fx-pricer.ts:134–139`, `models/garman-kohlhagen.ts:132–142` | Digital mit `payoutCurrency = base` wird als Cash-or-Nothing in Quote (`dfd·N(d₂)`) berechnet und mit dem **Spot** umgerechnet. Korrekt ist die Auszahlung 1 Einheit Basiswährung = `S·e^{−r_f T}·N(±d₁)` in Quote. Probe (EURUSD 1Y, K 1,18, 1 Mio. EUR Payout): **530.834 USD statt 572.479 USD (−7,3 %)**. | `ts export function fxDigital(i, payoutInForeign = false) { …; if (payoutInForeign) { const d1 = d2 + sd; return dff * spot * normCdf(sign * d1); } return dfd * normCdf(sign * d2); }` und im Pricer `payoutInForeign = trade.digital.payoutCurrency === base`. |
| **H3** | `pricing/leg-pricer.ts:166–169` | Eingebetteter Cap/Floor auf Float-Kupons wird nur intrinsisch (`min/max` auf den Forward) berücksichtigt – der Zeitwert fehlt vollständig (Kommentar bestätigt). Ein Floored-Floater / Zinsswap mit 0 %-Floor (Standard bei Kreditabsicherungen deutscher Mittelständler) ist damit systematisch falsch bewertet und hat kein Vega. **Nachtrag 20:36 UTC: behoben** (`expectedCollaredRate`, leg-pricer.ts:121–157; verifiziert 77.559 = 77.559 EUR, siehe 1a). | Je unfixierter Periode Caplet/Floorlet mit Caplet-Fläche bewerten: `rate_eff = F − Bachelier("Call",F,cap,σ,t_fix) + Bachelier("Put",F,floor,σ,t_fix)` (Vol aus `ctx.capletVols[ccy-index]`, Modell wie `priceCapFloor`); für fixierte Perioden intrinsisch. Alternativ Leg intern als Swap + CapFloor-Instrument zerlegen und `analytics.embeddedOptionPv` ausweisen. |
| **H4** | `dates/daycount.ts:142–148`, Aufruf `pricing/leg-pricer.ts:152–155` | ACT/ACT ICMA: `(end−start)/(freq·refLen)` mit `ctx.frequency ?? 1`; der Leg-Pricer übergibt nur `refStart/refEnd` (= Periode) und **keine Frequenz** ⇒ τ = 1 für jede Periode. Probe: 07.09.2026–08.03.2027 → **1,0 statt 0,5**. Jedes Leg mit ACT/ACT ICMA (z. B. Bond-Hedges, Asset-Swaps) verdoppelt seine Kupons. | `yearFraction(p.accrualStart, p.accrualEnd, leg.dayCount, { refStart: p.unadjustedStart, refEnd: p.unadjustedEnd, frequency: frequencyPerYear(leg.frequency) })`; für Stubs ISDA-ICMA-Regel (notional periods) implementieren oder Fehler werfen. |
| **H5** | `pricing/fx-pricer.ts:14–19` (Forward), `:29–41` (PV), `:107–114` (Option) | FX-Spot wird als Kurs für Lieferung **heute** behandelt: F = S·DF_B(T)/DF_Q(T) und PV-Umrechnung zum Spot ohne Spot-Date-Anpassung. `FxSpot.spotDate` (market-context.ts:11) existiert, wird aber nirgends genutzt. Probe: Forward Lieferung am Spot-Tag zum Spot-Kurs → **PV 2.484,50 USD statt 0** (10 Mio. EUR); 1Y-Forward **1,177254 statt 1,177003 (2,5 Pips)**. Ein Wirtschaftsprüfer, der gegen Bloomberg FXFA abstimmt, sieht die Differenz. | `ts function fxSpotDate(ctx, base, quote) { const cal = getCalendar(\`${base}+${quote}${base!=="USD"&&quote!=="USD" ? "+USD" : ""}\`); return addBusinessDays(ctx.valuationDate, 2 /* 1 für USDCAD, USDTRY … */, cal); } export function fxForwardRate(ctx, base, quote, date, coll) { const ts = fxSpotDate(ctx, base, quote); const dB = getDiscountCurve(ctx, base, coll), dQ = getDiscountCurve(ctx, quote, coll); return getFxSpot(ctx, base, quote) * (dB.df(date)/dB.df(ts)) / (dQ.df(date)/dQ.df(ts)); }` – PV-Umrechnung analog mit „heutigem" Kurs S₀ = S·DF_Q(t_s)/DF_B(t_s); GK-Inputs `rd, rf` aus DF-Verhältnissen ab Spot-Date. |
| **H6** | `risk/sensitivities.ts:122–129` (`rollMarket`, `leg-pricer.ts:150`) | Theta = PV(t+1) − PV(t); Cashflows mit `paymentDate ≤ val+1` fallen im gerollten Kontext heraus, Theta enthält also den vollen Kupon. Probe: Receiver-Swap mit Fix-Kupon 300.000 EUR am 04.09.2026 → **Theta −299.257 EUR**; nach Rückaddition der gezahlten Cashflows **+184 EUR** (ökonomisches Theta). Zusätzlich wird der herausfallende Float-Kupon durch H1 falsch (−558) bewertet. | `ts const paid = base.legs.flatMap(l => l.cashflows).filter(c => c.paymentDate > ctx.valuationDate && c.paymentDate <= ctx.valuationDate + days).reduce((s, c) => s + c.amount * fx(c.currency), 0); theta = pvRolled + paid − base.pv;` – und Theta als `{ total, carry, rollDown, cashflows }` ausweisen. |

### 3.3 Mittel

| # | Datei:Zeile | Befund | Fix |
|---|---|---|---|
| **M1** | `dates/schedule.ts:112–115` (LongFront), `:129–131` (LongBack) | Long-Stub wird **immer** durch Verschmelzen der ersten/letzten zwei Perioden erzeugt, auch wenn das Schedule glatt aufgeht. Probe: 5Y/1Y mit `LongFront` → **4 Perioden, erste Periode 2 Jahre**. QuantLib/ISDA: Long-Stub nur, wenn ein Stub existiert. | Vor `splice`: `const firstIsRegular = addTenor(dates[1], {n:-tenor.n, unit:tenor.unit}, useEom) === start; if (stub==="LongFront" && !firstIsRegular && dates.length > 2) dates.splice(1,1);` analog LongBack mit `addTenor(dates[len-2], tenor) === end`. |
| **M2** | `instruments/builders.ts:266–270` (`makeImmSwap`), `dates/schedule.ts` | (a) `end = nextImmDate(addTenor(start,tenor) − 1)`: liegt der IMM-Tag des Zielmonats **vor** `start+tenor−1`, springt das Ende ein Quartal weiter. Probe: IMM-Start 17.03.2027, „1Y" → **Ende 21.06.2028 (15 Monate)**; 16.06.2027 „1Y" → 21.06.2028. (b) Kuponperioden rollen monatsgenau vom Ende (2027-03-22, 2027-09-20 …) statt auf IMM-Daten (2027-03-17, 2027-09-15) – kein echter IMM-Swap. | (a) `const {year,month} = toYMD(addTenor(start,p.tenor)); const end = immDate(year, month);` (b) `buildSchedule` um `roll: "IMM"` erweitern: unadjustierte Daten = IMM-Daten der Quartale zwischen Start und Ende (`immDate` je 3 Monate). |
| **M3** | `curves/curve.ts:114–118, 122, 125, 131, 138` | Extrapolation jenseits des letzten Pillars: `exp(−z_last·t)` = **konstante Zero-Rate**, nicht „flat forward" wie kommentiert. Der Momentan-Forward springt am letzten Pillar auf die Zero-Rate. Probe €STR: 1Y-Forward vor 30Y **2,1488 %**, nach 30Y **2,7357 %** (Zero 2,699 %). Betrifft alle Cashflows > 30Y (Zahlungs-Lag hinter dem letzten Pillar, lange Swaps, Roll-Szenarien) und macht Bucketed-Deltas am letzten Pillar unplausibel. | Für logLinear/flatForward: `const f = -(logDfs[n-1]-logDfs[n-2])/(times[n-1]-times[n-2]); return dfs[n-1]*Math.exp(-f*(t-times[n-1]));` (QuantLib-Default). Für Zero-Interpolationen konstante Zero beibehalten, aber dokumentieren; Extrapolationsart als Option. |
| **M4** | `risk/scenarios.ts:34–48` | Bei mehreren `curveShifts` auf dieselbe Kurve wird jeweils von `ctx.curves[id]` (Original) ausgegangen ⇒ **der letzte Shift überschreibt alle vorherigen**. Probe: `[{"*",+100bp},{"EUR-ESTR",+50bp}]` → EUR-ESTR **+50 bp statt +150 bp**. | `for (const [id] of Object.entries(out.curves)) { let shifted = out.curves[id]!; … out.curves[id] = shifted; }` – d. h. iterativ auf dem bereits geshifteten Zustand arbeiten; Test mit zwei Shifts. |
| **M5** | `pricing/fx-pricer.ts:72` | `fxDelta = legs[0].pvReporting·1 %` nimmt immer das **Kauf-Leg**; ist die Kaufwährung die Reporting-Währung, ist das Delta der Verkaufs-Leg-PV mit umgekehrtem Vorzeichen. Probe (Sell EUR, Report USD): **+113.100 statt −113.801 USD**. | `const foreignLeg = trade.buyCurrency !== reporting ? r.legs[0] : r.legs[1]; fxDelta: foreignLeg.pvReporting * 0.01` (bei zwei Fremdwährungen beide ausweisen). |
| **M6** | `pricing/fx-pricer.ts:128–140, 184–193` | Für Barrier und Digital werden `deltaBase`, `deltaPct`, `gamma`, `vega`, `theta`, `rho` aus dem **Vanilla**-GK entnommen. Probe Digital: `vega = 4.540` (Vanilla-Vega), `deltaBase = 492.455` – für ein Digital falsch (Vega kann negativ sein). | Greeks für Barrier/Digital per Bump-and-Reprice der geschlossenen Formel (zentrale Differenzen in S, σ, t, r_d, r_f) oder analytische RR-Greeks; für Barrier-Deltas nahe der Barriere Schrittweite relativ zu |S−H| wählen. |
| **M7** | `math/normal.ts:101–104, 119` | Genz-Quadratur: die Gewichte `w` sind bereits durch 2π geteilt (0,018854 = 0,118463/2π), anschließend wird noch mit `asr/(4π)` multipliziert ⇒ Integralanteil um Faktor 2π zu klein. Probe: **Φ₂(0,0,0,5) = 0,26326 statt ⅓** (exakt ¼ + asin ρ/2π). Der Simpson-Zweig für |ρ| ≥ 0,925 ist korrekt (Φ₂(1,1,0,95) = 0,8108195 vs. unabhängige Integration 0,810820). Derzeit nirgends aufgerufen, aber exportierte API (für Touch-/Window-Barriers, Compound-Optionen nötig). | Rohgewichte des 5-Punkt-GL auf [0,1] verwenden (`0.1184634425, 0.2393143352, 0.2844444444, …`) oder Genz' 6/12/20-Punkt-Sätze (|ρ|<0,3 / <0,75 / sonst) übernehmen; Unit-Test gegen `¼ + asin(ρ)/(2π)` und Drezner-Tabellen. |
| **M8** | `pricing/fra-pricer.ts:16–21` | FRA nutzt immer den Kurven-Forward; ein bereits publiziertes Fixing (Fixing-Datum = Start − 2 GT, Start noch in der Zukunft) wird ignoriert. Probe: Fixing 5 % geladen → `forwardRate 0,02207` (Kurve). Außerdem kein `endOfMonth`/Kalender-Handling der FRA-Daten und `payReceive`-Semantik nur im Kommentar. | `const fixDate = addBusinessDays(trade.startDate, -idx.fixingLag, getCalendar(idx.fixingCalendar)); const fixing = getFixing(ctx, idx.name, fixDate); const fwd = fixing ?? proj.forwardRate(...)`; `isFixed` im Cashflow setzen. |
| **M9** | `xva/cva.ts:70` | Schleife `i < dates.length − 1` endet einen Kupontermin vor Fälligkeit; das letzte Intervall (t_{n−1}, T] trägt keine PD bei. Probe 10Y-Swap: Profil endet 07.09.2035, Σ PD = 0,1650 = 1−e^{−0,02·9} statt 0,1813 für 10Y. CVA um ≈ LGD·ΔPD·½·EPE_{n−1} unterschätzt (hier ≈ 1–2 %). Zudem ATM-Vol statt Smile-Vol am Strike K (OTM-Swaptions systematisch unter-/überbewertet bei negativem ρ). | Profilpunkt bei T mit EPE = ENE = 0 anhängen (`marginalPd(h, prevT, T_mat)`); Vol über `swaptionVol(surface, T, tenorLeft, fwd, fixed.rate)` statt `swaptionAtmVol`. |
| **M10** | `instruments/builders.ts:190` | `deliveryDate = expiryDate + 2` **Kalendertage**. Probe: Expiry Fr. 03.09.2027 → Delivery **So. 05.09.2027**. Marktkonvention: Spot-Lag in Geschäftstagen des Paar-Kalenders (+USD für Crosses). | `deliveryDate: p.deliveryDate ?? addBusinessDays(p.expiryDate, 2, getCalendar(\`${base}+${quote}\`))` mit Sonderfall T+1-Paare. |
| **M11** | `models/fx-vol-surface.ts:52–55, 97–110, 131–137`; `atmConvention` (Z. 22) ungenutzt | Smile ausschließlich in **Forward-Delta, prämienunadjustiert**, ATM als 50Δ-Forward (= DNS nur für diese Konvention). Marktstandard: EURUSD/GBPUSD ≤ 1Y Spot-Delta, > 1Y Forward-Delta; USDJPY, EURJPY, EM-Paare **prämienadjustiert**; BF-Quotes sind i. d. R. Broker-Strangles (Reiswich-Wystup-Iteration nötig), nicht Smile-Strangles. Probe: 25Δ-Call-Strike 1Y EURUSD Fwd-Δ 1,24765 vs. Spot-Δ 1,24596; Vol-Differenz hier nur 0,009 Pkt. (bei EURJPY/USDTRY mit prämienadjustiertem Δ mehrere Zehntel). Smile-Interpolation linear in Δ (Knick an den Stützstellen), Extrapolation linear bis Δ 0,01 (K=1,60: 9,31 % vs. 10ΔC 8,875 %). | `FxVolSurface` um `deltaConvention: "SpotUnadjusted"\|"ForwardUnadjusted"\|"SpotPremiumAdjusted"\|"ForwardPremiumAdjusted"`, `atmConvention`, `strangleType: "Smile"\|"Broker"` erweitern; Strike-aus-Delta für prämienadjustiert per Newton auf `Δ_pa = e^{−r_f T}(N(d₁) − (K/F)·N(d₂)) − δ`; Interpolation kubisch/Vanna-Volga in Δ mit flacher Extrapolation ab 10Δ. |
| **M12** | `curves/bootstrap.ts:57–58, 97–99, 133` | OIS-Pillar liegt auf der adjustierten Fälligkeit, letzte Zahlung (Lag 1 GT) 1–3 Tage dahinter ⇒ wird beim Lösen extrapoliert; nach Hinzufügen des nächsten Pillars ändert sich die Bewertung minimal. `residuals` werden **zum Lösezeitpunkt** berechnet (1,5·10⁻¹⁵) und verdecken das; auf der finalen Kurve: PV bis 5,26 EUR/100 Mio., Par-Abweichung 0,0002 bp. Praktisch irrelevant, methodisch unsauber (QuantLib: Pillar = `latestRelevantDate` = letzte Zahlung). | Pillar auf `lastPaymentDate` des Par-Swaps setzen (Schedule einmal bauen, `periods.at(-1).paymentDate`); Residuen nach Abschluss auf der finalen Kurve neu berechnen. |
| **M13** | `pricing/swaption-pricer.ts:44–51` | Cash-Annuität wird mit `df(expiryDate)` diskontiert; ISDA: Diskontierung auf das **Settlement-Datum** (Expiry + Spot-Lag). Für EUR gilt seit 2018/2021 die „Collateralised Cash Price"-Methode (Annuität aus OIS-DF wie physisch, aber Zahlung am Settlement), die IRR-Formel ist nur noch für GBP-Altbestand Standard. **Nachtrag 20:36 UTC: behoben** – Default `CollateralisedCashPrice`, IRR als Option; Settlement-Datum im IRR-Zweig weiterhin offen. | `settle = addBusinessDays(trade.expiryDate, conv.spotLag, cal); annuity = cashAnnuity * disc.df(settle)`; Option `settlementMethod: "PhysicalCleared"\|"CashIRR"\|"CashCollateralisedPrice"`. |
| **M14** | `pricing/leg-pricer.ts:229–238` | Accrued für OIS-Legs = Perioden-Compounding-Rate × τ_bisher; korrekt ist das bis heute **realisierte** Compounding (Π(1+r_iτ_i) − 1)·N. Bei steiler Kurve oder Fixing-Sprüngen weicht das ab; Clean/Dirty-Split im Report dadurch ungenau. | In `projectFloatingRate` `compoundedToDate` zurückgeben und in `legAccrued` verwenden. |
| **M15** | `models/vol-surfaces.ts:83–101` | SABR-Smile wird **immer** mit `sabrNormalVol` kalibriert/ausgewertet, auch wenn `volType` „Lognormal"/„ShiftedLognormal" ist; Default-Shift 3 % greift auch für Normal-Flächen (harmlos, aber verwirrend). Nur 3 Grid-Punkte tragen Parameter; `nearest` schaltet hart um (Sprung im Smile zwischen Expiries). | `volType` respektieren (`sabrLognormalVol` für Black); SABR-Parameter über (Expiry, Tenor) bilinear interpolieren statt `nearest`. |
| **M16** | `risk/scenarios.ts:56, 60` vs. `risk/sensitivities.ts:100, 108` | `irVolShiftBp` wird für lognormale Flächen mit 1e-2 skaliert (20 „bp" → +20 Vol-Punkte), in `computeRisk` gilt 1 bp normal ≙ 1 Vol-Punkt lognormal. Inkonsistente Semantik. | Einheit im Szenario explizit: `irVolShift: { normalBp?: number; lognormalPts?: number }` oder Umrechnung über `lognormalToNormalVol` am ATM-Forward. |
| **M17** | `models/garman-kohlhagen.ts:191–194` | Bereits durchbrochene Barriere: Knock-out liefert `K·e^{−rT}` (Rebate am Verfall); Marktstandard (Haug Tab. 4-13, Fälle H = S) ist Rebate **bei Berührung**, hier also sofort: **2,8824 statt 3,0000**. | `return barrierType.endsWith("In") ? vanilla : K;` (Rebate at hit) bzw. Flag `rebateAtExpiry`. |
| **M18** | `models/sabr.ts:68–81, 17–21, 54–58` | `sabrNormalVol` mit β = 1 und f ≠ K: Prefactor 0/0 → **NaN**; negatives geshiftetes f oder K → `Math.pow` NaN ohne Fehler (`sabrLognormalVol` wirft korrekt). | β = 1: `prefactor = alpha*(f−k)/Math.log(f/k)`; Guard `if (f<=0\|\|k<=0) throw`. |
| **M19** | `risk/sensitivities.ts:73–84` | Bucketed-Deltas sind Zero-Rate-Shifts auf Pseudo-Diskont-Pillars der Projektionskurve: 10Y-Payer-Swap zeigt EUR-EURIBOR-6M **7.797 EUR im 10Y-Bucket, 5–221 EUR in 6M–9Y** (Teleskop-Effekt der Float-Seite), €STR-Buckets ±20. Methodisch korrekt, aber für Händler/Marktfolge (Par-/Quote-Sensitivitäten wie Bloomberg SWPM, ORE) unbrauchbar; Hedge-Ratios lassen sich nicht ablesen. **Nachtrag 20:36 UTC: adressiert** – `parRisk` (sensitivities.ts:217–265) liefert Quote-Sensitivitäten (10Y-Bucket 8.704, Summe 8.759); Restpunkt Laufzeit (N-D). | Jacobian-Ansatz: Quotes um 1 bp bumpen, Kurve neu bootstrappen (`bootstrapCurve` ist mit 60 ms schnell genug) → Par-Delta je Instrument; alternativ analytischer Jacobian ∂Zero/∂Quote und Kettenregel auf die Zero-Deltas. |

### 3.4 Niedrig

| # | Datei:Zeile | Befund | Fix |
|---|---|---|---|
| N1 | `dates/daycount.ts:95–100` vs. `:123–129` | `dayCount("30E/360 ISDA")` setzt D₂ für Februar-Ende **nie** auf 30, `yearFraction` (korrekt) nur bei `isMaturity`. Probe 31.01.→28.02.2026: `dayCount` 28, `yearFraction·360` 30. Der Leg-Pricer übergibt `isMaturity` nie. | `dayCount` an `yearFraction` angleichen; in `priceLeg` `isMaturity: p.index === last` setzen. |
| N2 | `dates/daycount.ts:50–54, 79–87` | Alias „30U/360" → 30/360 ohne Februar-Regel (28.02.→31.03.2026: 33 Tage; 30U/360 mit EOM-Feb-Regel: 30). „30/360 ISDA" ist korrekt implementiert, das Alias ist irreführend. | Eigener Zweig `30U/360` mit Feb-Regel (ISDA 2006 §4.16(f)) oder Alias entfernen. |
| N3 | `dates/schedule.ts:158–161` | `isStub` wird für Roll vom 31. ohne EOM falsch gesetzt (31.03.2026/6M: „2027-03-31*" markiert). Wird nicht bepreist, aber im UI/Report angezeigt. | Stub-Erkennung über Position (erste/letzte Periode ≠ Tenor) statt Vorwärtsrechnung. |
| N4 | `dates/date.ts:88–96` | `TN`, `SN` werden wie `ON` auf 1D gemappt. | `TN → {n:2}`, `SN → spot+1` (nur in Kombination mit Spot-Lag sinnvoll; sonst Fehler werfen). |
| N5 | `market/market-context.ts:77–79` | `getFixing` linear (`Array.find`), pro Tag im OIS-Loop ⇒ O(n·m). 30Y-OIS mit 3.640 Fixings 44 ms – akzeptabel, skaliert aber quadratisch bei Portfolios. | `Map<index, Map<date, value>>` einmalig im Kontext aufbauen. |
| N6 | `models/garman-kohlhagen.ts:119–129` | `require_normInv`-Hack für einen angeblichen Zirkelimport (existiert nicht), Dead Code `-sign * 0`. | Direkt `import { normInv } from "../math/normal.js"`. |
| N7 | `models/fx-vol-surface.ts:31–50, 112–128` | `smileVols` ungenutzt; eigener `erf` (Abramowitz-Stegun 1,5·10⁻⁷) statt `normCdf` – Inkonsistenz zwischen Smile-Delta und Pricing-Delta. | Entfernen bzw. `normCdf` verwenden. |
| N8 | `reporting/valuation-report.ts:64, 86–95` | IFRS-13-Level-Ternary ist ein No-op (immer 2); `costTransparency` invertiert die Perspektive (Trade „aus Kundensicht"), ohne dass die Perspektive im Report benannt wird. **Nachtrag 20:36 UTC:** Level-Logik implementiert (`ifrs13Level`, valuation-report.ts:53–75); Perspektive weiterhin offen. | `perspective: "Bank"\|"Kunde"` als Pflichtfeld; Level-Logik (Level 3 bei `volOverride`, fehlender Fläche, Barrier ohne Marktquote). |
| N9 | `pricing/fx-pricer.ts:51, 95`; `builders.ts:288` | Pips-Faktor fest 10.000 – für JPY-, HUF-, KRW-Quotes 100. | Pip-Größe je Paar (`pipFactor(pair)`). |
| N10 | `risk/sensitivities.ts:115` | FX-Vega-Zuordnung über `pair.includes(key.slice(0,3))` – Substring-Matching liefert Spurious-Keys (EURGBP-Trade → `fx:EURUSD`), Vega dort 0. | Exakter Paar-Vergleich inkl. invertierter Fläche. |
| N11 | `models/black.ts:26–30, 46–48` | Negativer Forward/Strike im Black-Modell → stiller Intrinsic-Fallback, keine Warnung. Bei EUR-Caps mit K ≤ 0 und `model:"Black"` wird der Zeitwert 0. | Fehler werfen oder Warnung in `PricingResult.warnings`; für Normal-Fläche irrelevant. |
| N12 | `pricing/swaption-pricer.ts:102–105`, `capfloor-pricer.ts:111–114` | `analytics.delta` ist ∂PV/∂F pro 1,00 (Swaption 5y10y: 42,1 Mio.), `gamma` ∂²PV/∂F²; Einheiten undokumentiert und anders als `computeRisk.dv01` (3.740 EUR/bp inkl. Diskontierung). | Einheiten in Feldnamen (`deltaPerBp`, `gammaPerBp2`) und Doku. |
| N13 | `pricing/leg-pricer.ts:137, 150` | Initial-Exchange am Bewertungstag wird einbezogen (`>= val`), Kupons am Bewertungstag ausgeschlossen (`<= val`). Netto 0 bei CCS, aber inkonsistent (T+0-Geschäfte, Settlement-Sicht). | Einheitliche Regel `paymentDate > val` bzw. Option `includeTodayCashflows`. |
| N14 | `dates/calendar.ts:219–246, 125–144, 147–167` | JP ohne Substitute-Holiday-Ketten (Golden Week) und mit fixen Äquinoktien; DE mit Fronleichnam (Hessen) und 24./31.12. – als „Frankfurt"-Kalender ok, für TARGET-basierte Produkte unerheblich; US ohne SIFMA-Karfreitag-Schließung. Für JPY-Produkte Datenquelle nötig. | `CustomCalendar` aus Datenfeed für JP/US-SIFMA; Doku, welcher Kalender wofür gilt. |
| N15 | `curves/curve.ts:170`, `risk/sensitivities.ts:163` | Index-Arithmetik in `nodes()` unleserlich; `.replace(".5Y",".5Y")` No-op. | Aufräumen. |

---

## 4. Detailbewertung nach Prüfpunkten

### 4.1 Konventionen (Day Counts, BDC, Schedules, IMM, Fixings, Lags, Spot)
- **Day Counts:** ACT/360, ACT/365F, ACT/ACT ISDA (Schaltjahr-Test grün), 30/360, 30E/360 korrekt. 30E/360 ISDA in `yearFraction` korrekt, in `dayCount` nicht (N1); ACT/ACT ICMA ohne Frequenz (H4); 30U/360-Alias ohne Feb-Regel (N2); BUS/252 nur mit externem Zähler.
- **Business-Day-Conventions:** Following/Preceding/Modified beides korrekt (Monatswechsel-Prüfung). `advance` nutzt Geschäftstage für D-Tenore (Spot-Lag korrekt: Do 03.09. + 2 GT = Mo 07.09.), EOM-Regel nur wenn Startdatum Monatsende ist (QuantLib-konform).
- **Schedules:** Backward-Roll, Stubs Short korrekt; **Long-Stubs falsch bei glatter Teilung (M1)**; `firstRegularDate/lastRegularDate` vorhanden; `stub:"None"` prüft Teilbarkeit; Fixing vom adjustierten Accrual-Start mit eigenem Kalender; Payment-Lag 1 GT €STR, 2 GT SOFR/SARON/TONA, 0 SONIA – konform. **Kein IMM-Roll (M2), kein `rollDay`/Roll-Convention (z. B. 20./EOM-Roll bei Bonds).** Builder setzen `endOfMonth` nie (Standard-EUR-Swaps mit Start am Monatsende rollen daher nicht auf Monatsenden).
- **IMM:** `immDate`/`nextImmDate` korrekt (dritter Mittwoch); `makeImmSwap` fehlerhaft (M2).
- **Fixings:** IBOR-Fixing-Lag 2 GT TARGET, RFR 0 – korrekt. **Fallback bei fehlendem Fixing ist der gravierendste Methodikfehler (H1).** FRA nutzt Fixings nicht (M8). Cap/Floor nutzt Fixings korrekt (Intrinsic für fixierte Caplets), erster Caplet eines Spot-Caps wird nicht ausgeschlossen (Konventionsentscheidung, dokumentieren).
- **OIS-Compounding:** korrekt inkl. T+1-Lag; fehlen: Lookback/Observation-Shift, Lockout, Spread-Compounding-Varianten (ISDA „Compounding with/without spread"), Zins-Cap auf Tagesbasis.
- **Spot-Dates:** IR-Spot per Währungskonvention korrekt; **FX-Spot-Date nicht modelliert (H5)**; FX-Optionen Delivery = Expiry + 2 Kalendertage (M10); `FxSpot.spotDate` toter Typ.

### 4.2 Kurvenkonstruktion
- Sequentieller Bootstrap mit Brent (Toleranz 1e-14), Dual-Curve über `discountCurve`, Anker am Spot (Single-Curve: 1/(1+r·τ) mit kürzestem Quote; Dual: OIS-DF) – sauber und schnell. Duplikat-Pillars werden übersprungen (Depo 6M / FRA-Start 6M).
- **Interpolation:** logLinear (Default), linear DF, linear Zero, natürlicher Spline auf Zeros, flatForward – korrekt implementiert; Spline ohne Monotonie-Schutz (kein Monotone Convex/Hyman). **Extrapolation konstante Zero statt flat forward (M3).**
- **Shifts:** `shiftedNode/shiftedParallel/shiftedNodes` arbeiten auf Zero-Rates bei festem t = 0-Anker (DF = 1) – konsistent; Parallel-Shift der Zeros = Parallel-Shift der Forwards; Summe Bucket = Parallel (Test grün, Probe 8.933 vs. Σ). Die Node am Spot (t = 4 Tage) hat praktisch kein Delta – erwartbar.
- **`rolledTo`:** Node-Daten + Δ Tage bei gleichen DFs ⇒ konstante Zero-Kurve in Tenor-Zeit (klassischer Constant-Curve-Roll). Korrekt; Alternative „Forward-Roll" (Kurve entlang der Forwards) fehlt als Option – für Theta-Attribution (Carry vs. Roll-Down) wünschenswert.
- **Fehlend:** Tenor-Basis-Swaps und FX-/XCCY-Basis als Bootstrap-Instrumente, Futures (mit Konvexität), Turn-of-Year, gleichzeitiges (globales) Lösen, Kurven-Pillar auf letzter Zahlung (M12), Multi-CSA-Diskontkurven (Typ vorhanden, kein Builder).

### 4.3 Modelle
- **Black-76/Bachelier/Shifted Black:** Preise und Greeks korrekt (Put-Call-Parität exakt, ATM-Bachelier σ√T/√2π exakt). Theta-Konvention: reine Zeitableitung ohne Diskont-Drift (dokumentieren). Implied-Vol-Solver robust (Bracketing mit Expansion). `lognormalToNormalVol` exakt über Preis-Matching (ATM 3 %/25 % → 74,8 bp) – gut.
- **SABR:** korrekt (Abschnitt 2); Sonderfälle β = 1 und negative geshiftete Rates (M18); Alpha-Kalibrierung per Bisektion mit sinnvollem Bracket. Kein Arbitrage-Check (Hagan-Formel wird bei niedrigen Strikes negativ dicht) – für 3 %-Shift in EUR akzeptabel.
- **Garman-Kohlhagen:** Preis (Haug 0,0291 ✓), alle Greeks ✓, prämienadjustiertes Delta korrekt (Δ − P/S), Forward-Delta ✓. Digital korrekt für Quote-Auszahlung, **falsch für Basis-Auszahlung (H2)**. Barrieren: Formeln ✓, Rebate-Timing (M17), **keine Greeks (M6), keine Diskretisierungs-Korrektur (Broadie-Glasserman-Kou), keine Touch/No-Touch/Window/Double-Barrier**.
- **FX-Smile:** Konstruktion ATM ± BF ± RR/2 in Delta-Koordinaten, ATM total-varianz-interpoliert ✓, Strike-Delta-Fixpunkt konvergiert ✓ (Round-Trip exakt). **Konventionsvielfalt fehlt (M11).**
- **Vol-Interpolation Swaption/Caplet:** bilinear mit flacher Extrapolation – Standard; Caplet-Fläche direkt (keine Cap-Stripping-Funktion), kein Arbitrage-Check in Strike-Richtung.

### 4.4 Pricer
- **Swap:** PV, Par-Rate, Fair Spread (Basis-Swap: auf Leg 0), Annuität, Accrued, Amortisation via `notionalSchedule` (Notional zum Accrual-Start), Notional-Exchange (initial/final/interim) korrekt; Par-Rate/Fair-Spread invariant gegenüber Reporting-Währung (Probe identisch). **Embedded Cap/Floor intrinsisch (H3); Missing-Fixing (H1); OIS-Accrued (M14).** Kein Upfront-Handling in `analytics.parRate` (Upfront verändert Fair Rate nicht – ok), Gearing ✓.
- **FRA:** ISDA-Settlement mit Diskontierung über die FRA-Periode korrekt; Vorzeichen ✓; Fixing ignoriert (M8).
- **Cap/Floor:** Caplet-Expiry = Fixing-Datum, Zahlung in Arrears, Vol je (Expiry, Strike), Collar = long Cap / short Floor ✓ (Test grün), Vega je 1 bp ✓. **Modellauswahl K1.** Bei Frequenz-Default für RFR-Indizes („3M") wird ein compounded-RFR-Caplet mit Bachelier auf den 3M-Forward bewertet – marktüblich als Näherung, nicht dokumentiert.
- **Swaption:** Payer = Call ✓, physische Annuität aus Fixed-Leg ✓, Cash-Annuität IRR (M13), Vol-Lookup mit Smile am Strike ✓, Greeks (Einheiten N12), Expiry-Handling ✓. Kein Straddle-/Strip-Support.
- **FX Forward/Swap/Option:** Zinsparität ✓, Reporting-Umrechnung konsistent (Test), Swap-Points ✓ (Pip-Faktor N9); **Spot-Date (H5), FX-Delta-Leg (M5)**; Option: tExp/tDel getrennt ✓, `premiumCurrency` nur Display, `ndf`-Feld wird **nicht bewertet** (NDF = Forward ohne Fixing-Logik).
- **CCS:** konstant und MtM-Reset korrekt (Abschnitt 2); Reset am Zahlungsdatum statt Accrual-Start des Folgeperiode (bei Lag ≠ 0 minimal abweichend); `parRate`/`fairSpread`-Analytics für CCS enthalten Notional-PVs (irreführend – ausblenden oder XCCY-Basis-Spread berechnen).

### 4.5 Risiko
- DV01 = (PV(+1bp) − PV(−1bp))/2, Vorzeichen Payer positiv ✓ (10Y/10 Mio.: 8.933 EUR – plausibel ≈ 8,9·10⁻⁴·N). Je-Kurve-DV01 ✓. Bucketed = Zero-Deltas (M19). Gamma = PV₊ + PV₋ − 2PV (pro bp²) ✓.
- **FX-Delta:** Shift „Währung wertet 1 % gegen alles auf" konsistent auch für triangulierte Kreuze (EURUSD/EURJPY → USDJPY) ✓; Reporting-Währung ausgeschlossen ✓.
- **Vega:** Swaption: Parallel-Shift der ATM-Matrix mit SABR-Rekalibrierung ✓ (Smile bewegt sich mit); Caplet ✓; FX: nur ATM (RR/BF fest) ✓ – kein Vega nach Expiry/Tenor-Bucket, kein Vanna/Volga.
- **Theta (H6)**, Roll ohne Fixings (H1-Folge). Vol-Flächen werden beim Roll nicht angepasst (Expiry in Jahren ⇒ konstante Fläche – korrektes „Sticky-Expiry"-Verhalten, dokumentieren).
- Szenarien: Steepener/Flattener über Node-Interpolation ✓, Reihenfolgeproblem (M4), Vol-Einheiten (M16). `STANDARD_SCENARIOS` enthält BaFin ±200 bp; EBA-IRRBB-Sechs-Szenarien fehlen (Short-Up/Down, Steepener/Flattener mit währungsspezifischen Shocks).

### 4.6 XVA
- Sørensen-Bollier korrekt in Einheiten und Diskontierung (Abschnitt 2); flache Hazard-Rate; Trapez über EPE × marginaler PD ✓; DVA ✓. Lücken: letztes Intervall (M9), ATM-Vol statt Strike-Vol (M9), kein Netting, kein Kollateral (CSA-Threshold/MTA/MPoR), kein Wrong-Way-Risk, keine Hazard-Termstruktur aus CDS-Kurve, FX-Forward-Exposure mit ATM-Vol ✓ (Diskontierung `dfQ(T)` korrekt: DF(0,t)·DF(t,T) = DF(0,T)), Zeitgitter kalendarisch (`t·365,25`) statt auf Zahlungsterminen.

### 4.7 Numerische Robustheit
- Brent (NR-Implementierung) ✓, Bracket-Expansion ✓, Newton mit Fallback ✓. Bootstrap-Bracket `[0,2·DF_prev, min(1,5; 1,2·DF_prev)]` deckt negative Zinsen ab (CHF-Kurve mit 0,02 % läuft).
- Grenzfälle: T = 0 → Intrinsic ✓ (Black, Bachelier, GK, Barrier); vergangene Cashflows ausgeschlossen ✓; `volOverride` ✓; Kurve vor Referenzdatum → DF = 1 (**Ursache von H1**); negative Forwards im Black-Modell stiller Fallback (N11); SABR NaN-Fälle (M18); `fxVolAtStrike` ohne Dämpfung (bei steilen Smiles keine Konvergenz-Garantie, aber 50 Iterationen und Rückgabe des letzten Werts).
- Performance ausreichend für Workstation-Nutzung (Abschnitt 2); `computeRisk` repriziert für Bucketed-Deltas 2·Σ Nodes Trades – bei Portfolios von 500 Trades × 3 Kurven × 19 Nodes ≈ 60.000 Bewertungen ≈ 10 s; Jacobian-Ansatz (M19) wäre zugleich schneller.

---

## 5. Testabdeckung: Lücken und aufzunehmende Referenzwerte

**Bestand:** 74 Tests, alle grün; gute Invarianten-Tests (Put-Call-Parität, Cap−Floor = Swap, Payer−Receiver = Forward, In+Out = Vanilla, Bootstrap-Repricing, Pay/Receive-Spiegelung). **Schwächen:** (1) fast keine externen Referenzwerte (nur Haug-GK 0,0291 auf 4 Nachkommastellen, Hull-Caplet auf 3), (2) In+Out = Vanilla ist per Konstruktion erfüllt (A ≡ Vanilla) und prüft C/D/E/F nicht, (3) Fehlerpfade (fehlendes Fixing, Modell-Override, mehrere Shifts, Long-Stub bei glatter Teilung) werden nur auf „Warnung vorhanden" oder gar nicht geprüft, (4) keine Golden-Master-Fixtures gegen QuantLib.

**Konkret aufzunehmen (Werte in dieser Review verifiziert bzw. Literatur):**

| Test | Referenz |
|---|---|
| Barrier vs. Haug Tab. 4-13 (35 Werte, σ = 25 %; ergänzend σ = 30 %) | z. B. DO-Call X90/H95 9,0246 · DI-Call X100/H95 4,0109 · UO-Call X110/H105 2,3453 · UI-Put X90/H105 1,4653 · UO-Put X100/H105 5,4932 · DI-Put X110/H95 11,9752; H = S = 100 Knock-out = 3,0000 (Rebate at hit) |
| `bivariateNormCdf` | Φ₂(0,0,ρ) = ¼ + asin(ρ)/(2π): ρ = 0,5 → 0,333333; Φ₂(0,5, 0,5, 0,5) = 0,546244 und Φ₂(1, 1, 0,95) = 0,810820 (unabhängige Simpson-Integration der bedingten Darstellung, in dieser Review berechnet) |
| GK-Greeks vs. zentrale Differenzen | Δ/Γ/Vega/ρ_d/ρ_f/Θ auf 1e-6 (Probe-Setup: S 1,1625, K 1,18, σ 7,7 %, T 1, r_d 3,5 %, r_f 2,1 %) |
| Digital Basis-Auszahlung | `S·e^{−r_f T}·N(d₁)`·Payout; Parität Cash-Digital(quote) + Cash-Digital(base) ↔ Vanilla-Zerlegung: Call = S·e^{−r_f T}N(d₁) − K·e^{−r_d T}N(d₂) |
| SABR Hagan-Konsistenz | LN→Preis→implizite Normal-Vol vs. `sabrNormalVol` innerhalb 0,2 bp (α 0,04, β 0,5, ρ −0,2, ν 0,3, f 3 %, T 2: 68,16/69,78/77,52 bp); QuantLib `SabrSmileSection`-Fixture für Lognormal (27,816 % / 23,365 % / 21,032 % bei K 2 %/3 %/4,5 %) |
| Day Counts | 30E/360 ISDA: 31.01.→28.02. (nicht Maturity) = 30/360; 28.02.2026→28.02.2027 (Maturity) = 358/360; ACT/ACT ICMA semi-annual 07.09.26→08.03.27 = 0,5 (mit Frequenz 2); ACT/ACT ISDA 2023-11-01→2024-05-01 ✓ vorhanden |
| Schedules | EOM: Effective 30.04.2026, 5Y, 6M, EOM → Enden 31.10./30.04.; LongFront 5Y/1Y = 5 Perioden; LongFront 27M/1Y = 2 Perioden (15M + 12M); IMM 2Y ab 03.09.2026 → Kupons 16.12.26, 17.03.27, 16.06.27 …; Fixing über Feiertag (TARGET Ostermontag) |
| Swap vs. QuantLib | Fixture: flache Kurve 2 % stetig ACT/365F, EUR 5Y Payer 2,5 % annual 30E/360 vs. EURIBOR-6M ACT/360 ab 07.09.2026 – NPV, Par-Rate, Fixed-Leg-BPS, Cashflow-Tabelle aus `ql.VanillaSwap`/`ql.MakeVanillaSwap` als JSON einchecken (Toleranz 1e-6 relativ); analog OIS (€STR, Lag 1, `ql.OvernightIndexedSwap`), Cash-Settled-Swaption (`ql.Settlement.Cash, CollateralizedCashPrice`), FX-Forward mit Spot-Date |
| Fixing-Fallback | Seasoned Swap ohne Fixings: aktueller Float-Kupon innerhalb ±10 bp des 6M-Forwards ab heute (heute: 0,14 % – muss fehlschlagen) |
| Cap-Modell | `model:"Bachelier"` ⇒ `analytics.model === "Bachelier"`; `ShiftedBlack` mit Shift 3 % ≠ Black |
| Theta | Swap mit Kupon am Folgetag: |Theta| < 1 % des Kupons |
| Szenario | Zwei Shifts auf dieselbe Kurve addieren sich (150 bp) |
| FX Spot-Date | Forward mit Lieferung am Spot-Tag zum Spot: PV = 0 ± 1e-6 |
| Bootstrap-Pillar | Alle OIS-Quotes auf der **finalen** Kurve: |Par-Abweichung| < 1e-6 bp |
| Rundreise Smile | `fxStrikeFromDelta` → `fxVolAtStrike` = `fxVolAtDelta` (heute ✓, als Regression sichern) |

---

## 6. Fehlende Features für eine v1 (deutsche Banken / Corporates)

> **Stand Working Tree 20:36 UTC (siehe 1a):** inzwischen vorhanden sind Par-/Quote-Sensitivitäten (`parRisk`), Vega-Buckets je Expiry, Futures-/Tenor-Basis-/XCCY-Basis-Bootstrap mit USD-CSA-Diskontkurve, Lookback/Observation-Shift, bewertete eingebettete Caps/Floors, IRRBB-Standardschocks, Cash-Settlement-Konvention, IFRS-13-Level-Logik, EMIR-Bewertungsfelder, Hedge-Accounting-Baukasten und CVA-Näherung für alle Trade-Typen. Die entsprechenden Punkte unten gelten damit als erledigt bzw. auf die in 1a genannten Restpunkte reduziert.

Nach Priorität (P1 = ohne das keine Abnahme durch Marktfolge/IPV; P2 = Standard-Erwartung; P3 = nice-to-have im v1-Scope).

**P1 – Kurven & Konventionen**
- Par-/Quote-Sensitivitäten (Jacobian) statt Zero-Deltas; Key-Rate auf Marktinstrumenten (M19).
- Tenor-Basis-Bootstrap (3M vs. 6M, 1M vs. 3M) und XCCY-Basis-Kurven (EUR-Diskontierung unter USD-CSA, „EUR-USD-CSA"), inkl. `collateralDiscountCurveId`-Builder.
- FX-Spot-Date, Forward-Punkte als Marktinput (Forward-Kurve aus Punkten statt reiner CIP), NDF-Fixing/Settlement-Logik, Pip-Konventionen (H5, M10, N9).
- IMM-Roll und Roll-Day-Konventionen im Schedule; Long-Stub-Korrektur (M1, M2); `endOfMonth` in Buildern.
- Fixing-Store mit Policy (throw / last / curve), Fixing-Import (€STR/EURIBOR/SOFR), Erst-Fixing-Prüfung (H1).
- Zinsswaps mit Floor/Cap auf dem variablen Leg (H3) – Standardprodukt der Kreditabsicherung.
- Amortisationstypen: annuitätisch (konstante Rate → Tilgungsplan aus Kreditvertrag), Step-up/-down, Custom-Schedule-Import, accreting; Amortisationsplan auf Floating-Leg mit eigener Frequenz (heute vom Fixed-Leg abgeleitet – korrekt, aber nur linear).

**P1 – Risiko/Reporting**
- Theta-Zerlegung (Carry, Roll-Down, Cashflows) und P&L-Explain (Zins/FX/Vol/Zeit) für IPV.
- Vega-Buckets (Expiry × Tenor / Expiry × Delta), Vanna/Volga für FX.
- EBA-IRRBB-Standardschocks (6 Szenarien, währungsspezifisch) neben BaFin ±200 bp.
- Perspektive (Bank/Kunde) und IFRS-13-Level-Logik im Report (N8).

**P2 – Instrumente**
- Callable/Cancellable Swaps (Bermudan, HW1F/LGM) – im Sparkassen-/Corporate-Geschäft verbreitet; Swaption-Straddles/Strips.
- Zero-Coupon-Swaps, Compounding-Fixed-Legs, Step-up-Kupons, In-Arrears-Fixings mit Konvexität, Average-Rate/OIS-Lookback-Varianten.
- FX: Touch/No-Touch, Double-Barrier, Window-Barrier, Diskretisierungs-Korrektur; Strukturen als Baukasten (Participating Forward, KO-Forward/„Forward Plus", Zinscollar-Baukasten aus Cap/Floor ✓ vorhanden), Asset-or-Nothing.
- Cap/Floor: Cap-Vol-Stripping (Flat → Caplet-Vols), Ausschluss des ersten Caplets, Straddles; Swaption-Cube-Interpolation in SABR-Parametern.
- Cross-Currency: Fixed-Fixed/Fixed-Float-Builder, XCCY-Basis-Spread als Analytics, Reset-Notional aus Fixing-Historie.

**P2 – XVA**
- Hazard-Termstruktur aus CDS-Kurve (Bootstrapping), Netting-Sets (Portfolio-Exposure per Monte Carlo oder Sørensen-Bollier-Aggregation), CSA-Kollateral (Threshold, MTA, MPoR), FVA; CVA für Swaptions/Caps/CCS/FX-Optionen (derzeit „not supported").

**P3**
- Monotone-Convex-/Hyman-Interpolation, Turn-of-Year, Futures im Bootstrap; globale Kalibrierung.
- Vol-Fläche aus Rohquotes (Broker-Strangle, prämienadjustierte Deltas) (M11).
- Kalender-Datenfeed (JP/US-SIFMA/Halbtage) statt Regelwerk.
- **Nicht** im v1-Scope (bestätigt): Inflation, CMS/CMS-Spread, TARF/Accumulator, Multi-Callable-Exoten.

---

## 7. Quick Wins (< 1 Tag, ≈ +23 Punkte)

1. K1 Operator-Präzedenz (5 Min. + Test) → +10
2. H4 Frequenz an ACT/ACT ICMA übergeben (10 Min.) → +2
3. M4 Szenario-Iteration auf `out.curves` (5 Min.) → +1
4. M5 FX-Delta-Leg-Auswahl (5 Min.) → +0,5
5. H6 Theta um gezahlte Cashflows korrigieren (30 Min.) → +2
6. H1 `forwardRate` vor Referenzdatum werfen + sinnvoller Fallback + Test (2–3 h) → +6 (Voraussetzung für korrektes Theta laufender Swaps)
7. M7 Genz-Gewichte (10 Min. + Test) → +0,5; M17 Rebate at hit (2 Min.) → +0,2; M18 SABR-Guards (15 Min.) → +0,3; M10 Delivery-Date in Geschäftstagen (15 Min.) → +0,5

Größere Posten: H5 FX-Spot-Date (½ Tag, durchgängig in Forward/Swap/Option/CVA), H2 Digital (1 h), H3 Embedded Cap/Floor (½ Tag), M1/M2 Schedule (½ Tag), M3 Extrapolation (1 h + Regressions-Check aller Tests), M19 Par-Jacobian (1–2 Tage), M11 Delta-Konventionen (1–2 Tage), QuantLib-Fixtures (1 Tag inkl. Python-Skript im Repo).

---

## Anhang A – Probe-Ergebnisse (Auszug, Bewertungstag 03.09.2026, Sample-Markt)

```
OIS par swaps on final EUR-ESTR curve (payLag=1):  max |PV| 5.26 EUR / 100m, max |par-quote| 0.0002 bp; pillar vs last payment: 1–3 days
CapFloor 5Y K=2.5% 10m: model undefined→Bachelier 205,336.11 | "Bachelier"→Black 66,517.21 | "ShiftedBlack"→Black 66,517.21
Seasoned IRS, period 2026-03-16→09-15, no fixing: rate used 0.1401 % | curve fwd(val→end) 2.1358 % | 6M fwd 2.2100 %
Seasoned OIS, period 2026-03-16→2027-03-15, no fixings: rate used 1.0878 % | curve fwd 2.0516 %
Coupon paying 2026-09-04 on 10m: Fixed +300,000 | Float −558 (should be ≈ −105,000); theta −299,257 → +184 after adding paid CFs
ACT/ACT ICMA 2026-09-07→2027-03-08 (leg-pricer context): 1.0 (expected 0.5)
EUR-ESTR beyond 30Y: 1y fwd before 2.1488 % | after 2.7357 % | zero(30Y) 2.6989 %
bivariateNormCdf(0,0,0.5) = 0.263263 (exact 0.333333)
applyScenario [*:+100, EUR-ESTR:+50] → EUR-ESTR +50 bp (expected +150)
FX fwd delivery=spot @spot, 10m EUR: PV 2,484.50 USD; 1Y fair fwd 1.177254 vs spot-anchored 1.177003 (2.52 pips)
Sell-EUR fwd reported in USD: fxDelta +113,099.77 (expected ≈ −113,801.03)
LongFront 5Y/1Y: 4 periods, first 2026-09-07→2028-09-07
IMM 1Y from 2027-03-16: 2027-03-17→2028-06-21
Barrier vs Haug Tab. 4-13: 29/29 non-degenerate within 4.7e-4; H=S knock-out 2.8824 vs 3.0000
GK greeks vs FD: all equal to 6 dp (delta 0.500203, gamma 4.362091, vega 0.453912, rhoD 0.550003, rhoF −0.584672, theta −0.024410)
Digital EURUSD 1Y K1.18, payout 1m EUR: 530,833.61 USD (code) vs 572,479.37 USD (S·e^{−r_f T}·N(d1))
SABR LN→N consistency (bp): 68.16/68.25, 69.78/69.79, 77.52/77.54; beta=1 f≠K → NaN
Swaption 5y10y cash annuity 74,365,485 vs physical 74,973,765; PV 584,078 vs 588,856
CVA 10Y payer 10m (λ 2 %, R 40 %): 26,896; DVA 9,438; EPE(t1) 271,233 = payer swaption PV (ratio 1.000); Σ PD 0.1650 (profile ends 1 coupon early)
CCS EUR3M−15bp vs SOFR: USD leg PV 0.00 (const & MtM); EUR leg −50,871
Perf: IRS 0.12 ms | computeRisk 13 ms | sample market 60 ms | OIS 30Y with 3,640 fixings 44 ms
Bucketed EUR-EURIBOR-6M (10Y payer): 10Y 7,797 | 9Y 221 | … | 6M 5 ; EUR-ESTR ±20 ; DV01 8,933
```

```
Nachtrag (dist 20:36:51 UTC):
bootstrapCurves order: EUR-ESTR → EUR-EURIBOR-6M → EUR-EURIBOR-3M → USD-SOFR → EUR-ESTR-USDCSA; max|res| ≤ 1.5e-15
EUR-EURIBOR-3M pillars: 2026-12-07, 2027-03-08 (FRA), 2027-03-16 (Future), 2027-06-07 (FRA), 2027-06-17 (Future) …; 3M fwds 0M..12M: 2.120 … 2.327 (monotone)
EUR-ESTR-USDCSA − EUR-ESTR zero (bp): 1Y −14.29 | 2Y −16.51 | 5Y −22.15 | 10Y −25.52; 5Y xccy basis swap @ −22bp repriced: −1.22 EUR / 1m
parRisk 10Y payer (792 ms): EUR-EURIBOR-6M Swap 10Y 8,704 | EUR-ESTR OIS 1Y..10Y 1,2,3,4,7,17,20 | total 8,759 vs zero-DV01 8,933
vegaBuckets: swaption 5y10y 5Y 6,590 + 7Y 9 = 6,599 (= parallel); cap 5Y 118/308/532/988/543 = 2,490 (= parallel)
computeXva generic: swaption long cva 60,107 dva 0 | short cva 0 dva 32,199 | basis 3v6 cva 1 dva 510 | IRS: S-B 26,896 vs generic 49,307 (+83 %)
embedded floor 2 %: floored − plain 77,559 = standalone floor 77,559
OIS 2Y lookback 5d: spot-start first coupon 2.0804 % vs 2.1000 % (+ spurious missing-fixing warning), pv −2,331.81 / 10m; fwd-start(1M): 2.1130 vs 2.1172 %, no warning
```

Probe-Skripte: `probe1.mjs` (Konventionen/Bootstrap/Fixings/Szenarien/FX), `probe2.mjs` (Haug-Tabelle, GK-FD, Digital, Smile, SABR, Swaption, CVA), `probe3.mjs` (Builder, CCS, Theta, Konventionen, Performance), `probe4.mjs` (Multi-Curve-Bootstrap, XCCY, parRisk, vegaBuckets, cvaGeneric, Embedded Floor, Lookback) – ausgeführt gegen `packages/pricing-core/dist` (Builds 20:15:53 und 20:36:51 UTC); alle Zahlen des Hauptteils gegen den Build 20:36:51 reproduziert.
