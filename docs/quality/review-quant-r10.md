# Re-Review Runde 10: Pricing-Korrektheit & Methodik (Dimension 2, Gewicht 20 %) – DERIVA `@deriva/pricing-core`

**Reviewer-Rolle:** Senior Quant (Multi-Curve, ISDA-Konventionen, Black/Bachelier/SABR, Garman-Kohlhagen/Reiner-Rubinstein, XVA, Hedge Accounting IFRS 9 / HGB § 254) · **Stand:** 04.09.2026, Branch `claude/derivatives-trading-platform-1arsyu`, Commit `8fbf579` (Version 0.3.0; dist-Build 04.09. 14:37 UTC, kein Quellfile neuer als dist) · **Modus:** Review only, keine Quell-, Test- oder Golden-Datei geändert
**Baseline:** `docs/quality/review-quant-r9.md` (Runde 9, Score 99 / 100), Befunde N9-1…N9-3, Rest N7-5 und die R9-Liste „Was für 100 noch fehlt"; Maßnahmenprogramm Runde 9 → 10 (`09-scorecard-runde-9.md`, CHANGELOG 0.3.0 „Core (Review Runde 9 – Quant N9-1…N9-3, N7-5-Rest …)", Commit `f71cb26`).
**Geprüft:** der komplette Core-Diff `9d52a89..8fbf579` (22 Dateien, +1 060/−129 Zeilen, zeilenweise gelesen: `pricing/leg-pricer.ts` (`lockoutDate`/`frozenFixing`, Realisiert- und Projektionszweig), `xva/cva.ts` (`openPremium`, `exposureGridWithPremium`, `rateOption`, Strike-Shift `K′ = K + s·c/A` in `cvaSwap`/`cvaBasisSwap`, Prämientermin im Monatsgitter von `cvaFxForward`), `pricing/fx-pricer.ts` (`DEFAULT_REBATE_AT`, `rebateConvention`, `deltaPremiumAdjusted` bei `settled-payoff`, `analytics.rebateAt`), `instruments/builders.ts` (`makeFxOption({ barrier })`), `instruments/types.ts`, `market/snapshot.ts` (`validateMarket` Collateral-Prüfung), `risk/sensitivities.ts` (`rollMarket`/`rolledMeta`), `reporting/emir.ts` (`emirValuationTimestamp`), `reporting/valuation-report.ts` (Par-Satz-/Lockout-/Rebate-Texte), `testing/golden.test.ts` + `test-data/golden/rfr-lockout-quantlib.json`, `tools/quantlib-golden.py` (`golden_lockout`), `pricing/review-r9.test.ts` (488 Zeilen) und die angepassten R5–R8-Tests).
**Methode:** `npx vitest run` → **435 / 435 grün** (30 Dateien, 14,9 s). Die Runde-9-Probeskripte `probe-r9a.mjs`, `probe-r9c.mjs`, `probe-r9-lockout.mjs` wurden gegen das frische `dist` erneut ausgeführt und gegen ihre R9-Ausgaben gediff't (nur die erwarteten Änderungen der Fixes, Anhang A). `probe-r7-dump.mjs` + `ql-compare-r5b.py` gegen **QuantLib 1.43** liefern eine **byteidentische** Ausgabe zu Runde 9, 8 und 7. `ql-lockout-r9b.py` (Lockout gegen `ql.OvernightIndexedCoupon(lockoutDays)`) bestätigt den N9-1-Fix. Neu: `probe-r10a.mjs` (Lockout am Karfreitag, CVA-Prämiengitter aller Produkttypen, Fremdwährungs-Fee, Fee am/nach Laufzeitende, Shifted-Lognormal-Fläche, CVA/DVA-Spiegelung, Default-Rebate auf sechs Barrier-Konstellationen, Parität, `validateMarket` auf vier importierten Snapshots, `rollMarket`/`rollMarketForward`, EMIR-Zeitstempel, Portfolio-Report, **Gitterprüfung der Swap-CVA** gegen ein manuelles Sorensen–Bollier auf 7-/30-Tage-Gitter), `probe-r10c.mjs` (Bewertungstag innerhalb des Lockout-Fensters), `probe-r10d/e.mjs` (Bisektion eines Hängers), `probe-r10f.mjs` + `ql-lookback-r10.py` (Lookback/Observation Shift auf Perioden mit Feiertagsbeginn), `probe-r10g.mjs` + `ql-obsshift-r10.py` (**Observation Shift gegen ISDA-2021-Formel und QuantLib**), `ql-lockout-r10.py` (Lockout/Lookback für Perioden, die am Karfreitag enden oder beginnen), `probe-r8-book.mts` (Web-Beispielbuch, 13 Trades, via `tsx`).

---

## 1. Score

### **Pricing-Korrektheit & Methodik: 97,8 / 100** (rechnerisch 97,8; Runde 9: 99, Runde 8: 96, Runde 7: 98, Runde 6: 98, Runde 5: 97, Runde 4: 97, Runde 3: 95, Runde 2: 90, Runde 1: 59)

**In einem Satz:** Alle vier Runde-9-Punkte sind nachweislich behoben (Lockout-Zählung bitgenau zu QuantLib für k = 0…3 inklusive Perioden, die am Karfreitag enden oder beginnen, und mit korrektem Übergang realisiert/projiziert innerhalb des Fensters; Prämiengitter in `cvaSwap`/`cvaBasisSwap` mit Fee am Spot → CVA −0,01 … −0,28 % statt −8,9 %/−9,2 %/+5,6 %, exakt spiegelsymmetrisch in CVA/DVA und währungsunabhängig; `deltaPremiumAdjusted` = 0 nach Knock-out; Default-Rebate `hit` = QuantLib auf allen sechs Barrier-Konstellationen mit exakter KO/KI-Parität), die Vendor-Cross-Checks bleiben byteidentisch und das Beispielbuch bewertet unverändert 13/13 –; **neu, und deshalb unter Runde 9: das Compounding mit Observation Shift teilt den über die Beobachtungsperiode aufgezinsten Faktor durch die Tage der Zinsperiode statt der Beobachtungsperiode (ISDA 2021 / QuantLib: −39 bp auf einem Monatskupon, ±3,5 bp auf drei von acht Quartalskupons eines 2Y-SOFR-Swaps), die Swap-CVA auf dem jährlichen Kupongitter liegt 2–4 % unter dem feinen Gitter, ein Lookback auf einer am Fixing-Feiertag beginnenden Periode greift ein Fixing zu spät, und `addBusinessDays`/`adjust`/`advance` laufen bei `NaN`-Daten endlos.**

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, Reibung −1…−3, kosmetisch −0,2…−1):

| Klasse | Abzug | Befunde |
|---|---:|---|
| Kritisch | 0 | – |
| Hoch | 0 | – |
| Mittel (neu) | −1,5 | **N10-1** `observationShift: true`: Rate = (Π(1 + r_i·τ_i^obs) − 1) / **τ_Zinsperiode** statt / τ_Beobachtungsperiode – SOFR-Periode 01.05.–01.06.2026 mit Lookback 5: **3,664747 % statt 4,057399 % (−39,27 bp = Faktor 28/31)**, QuantLib = ISDA-Handrechnung auf 0,0000 bp; 2Y-SOFR-Swap 100 Mio. quartalsweise: drei von acht Kupons ±3,5–3,9 bp, Kupon-Δ bis 9.678 USD, PV-Δ 1.299 USD |
| Niedrig (neu) | −0,3 | **N10-2** Swap-/Basis-Swap-CVA integriert auf dem Kupongitter (jährlich bei EUR-Fixleg) mit linearer Interpolation der konkaven EPE: 10Y-Receiver 21.362,70 vs 7-Tage-Gitter 21.797,96 (**−2,00 %**), Payer −1,77 %, ATM-Receiver **−3,66 %**; sichtbare Nebenwirkung: eine **gezahlte** Fee in 100 d **erhöht** die CVA (+0,19 %), weil der Prämientermin das Gitter verfeinert; FX-Swap (`cvaGeneric`, 4 Punkte) +5,95 % durch denselben Effekt |
| Kosmetisch (neu) | −0,4 | **N10-3** Lookback auf einer Periode, die am Fixing-Feiertag beginnt (SOFR ab Karfreitag 03.04.2026): `inEffect(obs(d))` statt `obs(inEffect(d))` → Fixing 02.04. statt 01.04., **+0,1942 bp** gegen QuantLib (Lookback 1 und 2), Lockout auf derselben Periode bitgenau (−0,2) · **N10-4** `addBusinessDays(NaN)`, `adjust(NaN)`, `advance(NaN, "6M")` und `makeFra({ start: undefined })` laufen endlos (Hänger > 10 s statt `INVALID_DATE`/`INVALID_TRADE`); `validateTrade` fängt `NaN`-Legdaten, die Kalenderfunktionen selbst nicht (−0,2) |
| Offen aus Runde 9 | 0 | N9-1, N9-2, N9-3, N7-5-Rest behoben |
| **Summe** | **−2,2** | → **97,8 / 100** |

Zur Einordnung: Keiner der vier Punkte ist ein Regress aus dem Runde-9-Programm – N10-1 und N10-3 sind Altfehler im Lookback-Zweig, der bislang nur ohne Observation Shift und nur auf Perioden mit Geschäftstagsbeginn gegen QuantLib geprüft war (R9 „Lookback 1/2 bitgenau"); N10-2 ist die Gitterauflösung der seit Runde 2 unveränderten Sorensen–Bollier-Integration, die durch das neue Prämiengitter erstmals sichtbar wird; N10-4 ist Robustheit der Kalenderprimitive. Die Runde-9-Fixes selbst wirken auf allen geprüften Pfaden ohne Nebenwirkung (Schedules, Spot-Daten, Beispielbuch, QuantLib-Cross-Checks unverändert).

---

## 2. Status der Runde-9-Befunde

Legende: **behoben** = reproduziert und mit Zahl belegt · **teilweise** = Kern behoben, Restpunkt benannt · **offen** = unverändert.

| # | Befund R9 | Status | Nachweis (Probe gegen `dist`, Anhang A/B) |
|---|---|---|---|
| **N9-1** | Lockout um einen Geschäftstag verschoben (`lockoutDays: 1` wirkungslos) | **behoben** | `leg-pricer.ts:180–185` (`lockoutDate = end − k`, `frozenFixing = lockoutDate − 1 bd` bzw. `inEffect(start)`, `fixingDayOf` friert ab `lockoutDate` auf `frozenFixing`), `:219–237` (Projektion: Teleskop-Forward bis `lockoutDate`, dann Overnight-Forward des `frozenFixing`-Tages). Probe (Periode 01.06.–03.08.2026, Fixings 4 % + 2 bp·((d − start) mod 7)): **Engine k = 0/1/2/3 = 4,06343422 / 4,06247539 / 4,06119688 / 4,05959870 % = QuantLib `OvernightIndexedCoupon(lockoutDays = k)` bitgenau** (R9: Engine k = QL k − 1); Golden `rfr-lockout-quantlib.json` (`quantlib.status: "done"`, Fixingdaten k = 2: 28.07., 29.07., **29.07., 29.07.**), `golden.test.ts:642–714`. Swap-Ebene 2Y SOFR 100 Mio.: k = 0 −1.159.642,15, **k = 1 −1.159.646,91 (R9: = k = 0)**, k = 2 −1.159.644,67, k = 3 −1.159.651,37. **Neue Grenzfälle** (Anhang B): Periode **endet am Karfreitag** 03.04.2026 (US-Settlement-Tag, SIFMA-Feiertag) k = 0…3 und Lookback 1/2 **= QL auf 0,0000 bp**; Periode **beginnt am Karfreitag** k = 0…3 = QL; Bewertungstag **innerhalb des Fensters**: die Periode wird genau dann `isFixed`, wenn das eingefrorene Fixing veröffentlicht ist (val 29.07. k = 3 → 4,05959870 % = Referenz, k = 2 noch projiziert), davor Δ zur Vollreferenz −5,7 … −2,5 bp aus der Kurve. Berichtstext „die letzten k Geschäftstage tragen das Fixing des Geschäftstags vor dem Lockout-Fenster", API-Schema `schemas.ts:205–211` gleichlautend. |
| **N9-2** | Prämien-Netting am t = 0-Punkt über das ganze erste Grid-Intervall | **behoben** | `cva.ts:293–295, 319–320` (`openPremium`, `exposureGridWithPremium`, `kEff = K + s·c/A` vor dem Prämientermin), `:414–416, 431` (Basis-Swap analog), `:487–496` (`cvaFxForward`: Prämientermin im Monatsgitter), `:367–371` (`rateOption`: Shifted-Black mit Intrinsic-Fallback). Probe (Fee 100 k am Spot): **vanilla 24.666,14 → 24.662,65 (−0,01 %), Zinstreppe −0,04 %, amortisierend 6.748,38 → 6.741,86 (−0,10 %; R9 −8,90 %), IMM −0,28 %, OIS −0,12 %, Basis 2.808,61 → 2.803,50 (−0,18 %; R9 −9,19 %), 10Y-Receiver mit erhaltener Fee −200 k 21.362,70 → 21.377,00 (+0,07 %; R9 +5,62 %)**; Fee morgen 6.750,70, Fee in 360 d 6.173,26 (−8,52 % ≈ ½·Fee·PD(1Y)·LGD – jetzt korrekt vom Zahltermin abhängig); **USD-Fee 120 k in 100 d auf EUR-Receiver = EUR-Fee gleichen PVs (Diff 0,00)**; **Spiegelung** Receiver + gezahlte Fee ↔ Payer + erhaltene Fee mit getauschten Hazards: CVA_a = DVA_b = 12.984,45, DVA_a = CVA_b = 21.236,18 exakt; Fee am Laufzeitende/danach/am letzten Kupon wird über die ganze Laufzeit genettet (17.658,83 / 17.667,95 / 17.831,39 – ökonomisch korrekt, Forderung bleibt bis zur Zahlung Teil des Exposures); Shifted-Lognormal-Fläche (25 %, Shift 3 %) inkl. Strike außerhalb des Definitionsbereichs (Fee −50 Mio.) ohne Fehler; FX-Forward Fee am Spot: EPE(30 d) 141.897,99 (R9 171.097,16 – Prämientermin jetzt im Gitter), CVA 542,21; `cvaGeneric` nimmt den Prämientermin weiterhin als Cashflow-Datum (CCS 33.757,29 → 33.745,12, Swaption −5,6 %, Cap −2,8 %, FXO −1,5 %). Test `review-r9.test.ts:131–286` (12 Swap-Varianten, Payer und Receiver, Fee ±100 k). Rest → **N10-2** (Gitterauflösung selbst). |
| **N9-3** | `deltaPremiumAdjusted` ≠ 0 nach Knock-out | **behoben** | `fx-pricer.ts:646–647` (`greeksMethod === "settled-payoff"` → 0). Probe: UpOut 1,15 Rebate 0,01 bei Spot 1,15: `deltaPct` 0, **`deltaPremiumAdjusted` 0,000000** unter Default/`hit`/`expiry` (R9: −0,008546 / −0,008696); lebend weiterhin Δ − P/S. Test `:291–325`. |
| **N7-5 Rest** | Default-Rebate-Konvention = R7-Mischung mit Sprung an der Barrier | **behoben** | `fx-pricer.ts:293–300` (`DEFAULT_REBATE_AT = "hit"`, `rebateConvention`), `:319, 528, 558` (alle Pfade über `rebateConvention`), `:656–657` (`analytics.rebateAt` effektiv, kein `"default"`), `builders.ts:252–262` (`makeFxOption({ barrier })` setzt `rebateAt: "hit"`), `valuation-report.ts:736` (Berichtstext „Default-Konvention „hit“ = QuantLib"). Probe (UpOut 1,15 Rebate 0,01, 10 Mio.): **ohne `rebateAt`: lebend @1,149999 99.999,45 → Spot 1,15 100.000,00 (Sprung 0,55; R9: 98.283,05, Sprung −1.716,40), Spot 1,17 100.000,00, `hit: true` 0,00, verfallen mit Fixing jenseits 0,00, `analytics.rebateAt "hit"`**; DownOut-Put 1,12 Rebate 0,02: 199.999,18 → 200.000,00 (R9 → 196.566,10). **Sechs Konstellationen** (UpOut-Call, DownOut-Put, UpIn-Call, DownIn-Put, UpIn-Put, DownIn-Call, Anhang A): Default = explizit `hit` auf 10⁻⁶, Knock-in-Rebates unverändert am Lieferdatum (verfallen unberührt 99.990,14 = R·N·DF(TOM), Default = `expiry`), Knock-in `hit: true` = Vanilla. **Parität @Spot: KO(`expiry`) 170.836,77 + KI 660.332,55 = Vanilla 732.886,28 + R·N·DF 98.283,05 (Diff 0,00)**. Test `review-r9.test.ts:330–402`. Prozessrisiko „Spot jenseits der Barrier ohne Flag zahlt heute und morgen erneut" (Theta 0,00, `BARRIER_STATE_UNKNOWN:`) bleibt Dimension 4. |

### 2.2 R9-Liste „Was für 100 noch fehlt" (Abschnitt 5)

| Pkt. | Thema | Status |
|---|---|---|
| 1–3 | N9-1…N9-3 | **behoben** (s. o.) |
| 4 | N7-5 Rest Default-Konvention | **behoben** (Default `hit`, Builder setzt explizit) |
| 5 | Berichtssatz „Par-Satz ohne Prämie, All-in separat" | **behoben** (`valuation-report.ts:654–657, 826–830`: „… Annuität der ökonomischen Legs – eine Upfront-Prämie ist ausgenommen, die All-in-Sicht … als „Par-Satz all-in“ … (hier 2,7651 %)"; Test `:466–488`) |
| 5 | CHANGELOG-Text Smile-Grenze, FX-Forward-CVA-Gitter um den Prämientermin | FX-Forward: **umgesetzt** (Prämientermin im Gitter); CHANGELOG → Dimension 6 |
| 5 | PA-Delta-Hedge-Hinweis, FX-Reset-`fixingLag`, Normal-/Lognormal-SABR-Hinweis, Collar-`floorStrike`, `vegaUnit`, SABR-Fallback-Hinweis, Mutations-Erkennung der Vol-Caches, €STR-Historie vor 2026 | **unverändert** – weiterhin ohne Abzug |

### 2.3 Weitere Runde-9-Änderungen (Regressionsprüfung, alle ohne Befund)

| Änderung | Prüfung |
|---|---|
| `validateMarket` Collateral-Prüfung (`snapshot.ts:177–183`) | Sample-Markt `[]` (Mapping `EUR|USD → EUR-ESTR-USDCSA`, Kurvenwährung EUR); vier importierte Snapshots aus früheren Runden (`snapshot-czk-r8.json` mit `NOK|EUR → NOK-NOWA`, `snap-x9.json`, `snapshot-lognormal.json`, `susp-snapshot.json`) `[]`; `EUR|USD → EUR-Kurve` und `USD|EUR → USD-Kurve` `[]`; `EUR|CZK → USD-Kurve` erkannt (Test). Nit: ein kleingeschriebener Schlüssel `eur|usd` wird mit „denominated in EUR, not eur" gemeldet – inhaltlich richtig (der Pricer sucht `EUR|USD`), Text unglücklich. |
| `rollMarket`/`rolledMeta` (`sensitivities.ts:350–372`) | Roll +90 d: `meta {source, label "EOD (rolled to 2026-12-02)"}` ohne `snapshotTime`; Theta (−310,94) und `cvaGeneric` (33.757,29) auf Markt mit/ohne `meta` identisch; EMIR-Feld 23 nach Roll 17:00 UTC des neuen Stichtags, `snapshotTime` nach dem Stichtag (04.09. 01:00) wird verwendet. Nit: `rollMarketForward` (`:380–385`, öffentlich exportiert, Carry-Theta) behält `snapshotTime` – ohne praktische Wirkung. |
| `emirValuationTimestamp` (`emir.ts:127–133`) | s. o.; Test `review-r9.test.ts:450–460`. |
| Portfolio-Report | Fünf Fee-/Barrier-Trades: `failed 0`, PV 191.388,10, Warnungen 0; Report führt keine XVA-Summe (Netting/Portfolio-XVA = Roadmap, XVA je Trade im Bewertungsbericht). |
| Web-Beispielbuch (13 Trades) | **PV 13.936,16, DV01 18.382,34, Theta −1.031,22 – identisch zu R9/R8/R7**, 0 `MISSING_FIXING`, `failed 0`. |
| QuantLib-Cross-Checks | `ql-compare-r5b.py`-Ausgabe **byteidentisch zu R9/R8/R7** (Tageszählungen, Schedules, SABR, 72 Barriers, Digitals, GK-Greeks, CDS, OLS). |

---

## 3. Neue Befunde (Runde 10)

Severity wie R1–R9: **Mittel** = falsche Zahl in einer dokumentierten, nicht-Default-Konvention mit spürbarer Wirkung · **Niedrig** = systematische Näherung mit kleiner, aber realer Wirkung · **Kosmetisch** = Grenzfall/Robustheit ohne praktische Wirkung im v1-Scope.

| # | Sev. | Datei:Zeile | Befund | Fix |
|---|---|---|---|---|
| **N10-1** | Mittel (−1,5) | `pricing/leg-pricer.ts:163` (`tauTotal = yearFraction(start, end)`), `:195` (`tau = obsShift ? yearFraction(od, oStop) : …`), `:239–241` (Projektion: `tauFwd = obsShift ? yearFraction(oFrom, oTo)`), `:247` (`rate = (compounded − 1) / tauTotal`) | **Observation Shift teilt durch die falsche Periode.** Mit `observationShift: true` werden die Tagesgewichte korrekt aus der Beobachtungsperiode [obs(start), obs(end)) genommen (Zähler = Aufzinsungsfaktor der Beobachtungsperiode), die Rate aber durch die Tage der **Zinsperiode** geteilt. ISDA 2021 „Compounded with Observation Period Shift" (und QuantLib `OvernightIndexedCoupon(applyObservationShift = true)`): Rate = (Π(1 + r_i·n_i/360) − 1) · 360/**d_obs**, angewendet auf die Zinsperiode. Die Engine-Rate ist damit um den Faktor τ_obs/τ_acc falsch – 1 bei gleich langen Perioden (deshalb bisher unauffällig), aber immer dann ≠ 1, wenn Start und Ende der Periode unterschiedlich weit über Wochenenden/Feiertage zurückgeschoben werden. Probe (SOFR, Lookback 5, synthetische Fixings, Anhang B): **Periode 01.05.–01.06.2026 (31 d, Beobachtung 24.04.–22.05. = 28 d): Engine 3,664747 % vs ISDA-Handrechnung = QuantLib 4,057399 % (−39,27 bp = Faktor 28/31 exakt)**; drei Quartalsperioden mit gleich langer Beobachtungsperiode bitgenau. Projiziert, **2Y-SOFR-Swap 100 Mio. quartalsweise, Lookback 5 + Observation Shift: drei von acht Kupons um +3,87 / −3,48 / +3,48 / −3,43 bp falsch (Verhältnis exakt τ_obs/τ_acc = 92/91 bzw. 91/92), Kupon-Δ bis 9.677,92 USD, PV-Δ 1.299,31 USD** (Vorzeichen wechseln, netto klein – auf Einzelkupon-/Accrued-Ebene aber bis ~10 % eines Monatskupons). Die bestehenden Tests (`extensions.test.ts:52–60`, `review-r2.test.ts:223`) prüfen nur Endlichkeit/Größenordnung und den Berichtstext. | In beiden Zweigen (realisiert und projiziert) bei `obsShift` durch τ_obs = `yearFraction(obs(inEffect(start)), obs(inEffect(end)), idx.dayCount)` teilen (Accrued analog: realisierter Faktor der Beobachtungsperiode bis obs(val), skaliert auf die Zinstage); Golden gegen `ql.OvernightIndexedCoupon(…, lookbackDays, 0, applyObservationShift = true)` für eine Periode mit τ_obs ≠ τ_acc (z. B. 01.05.–01.06.2026) in `rfr-lockout-quantlib.json` ergänzen; Test: Engine = ISDA-Handrechnung auf 10⁻¹². |
| **N10-2** | Niedrig (−0,3) | `xva/cva.ts:283` (`dates = scheduleDates(fixed)` – Kupondaten des Fixlegs), `:295` (Gitter = Kupondaten + Prämientermin), `:400, 416` (Basis-Swap analog), `:517–530` (`aggregate`: Trapez × marginale PD), `:532–552` (`exposureGrid` für `cvaGeneric`: Zahlungsdaten, Quartalsauffüllung nur bei < 4 Punkten) | **Die Swap-CVA integriert auf dem Kupongitter und unterschätzt das feine Gitter systematisch um 2–4 %.** Das EPE-Profil eines Swaps ist konkav (∝ √t), das Trapez zwischen zwei Jahreskupons interpoliert linear. Probe (manuelles Sorensen–Bollier mit denselben Bausteinen `priceInterestRateSwap`/`swaptionVol`/`bachelier`, flache Hazard 2 %, LGD 60 %): **10Y-Receiver 3 %: Engine 21.362,70 (11 Punkte) = manuell auf 365-Tage-Gitter 21.370,05; 30-Tage-Gitter 21.787,17; 7-Tage-Gitter 21.797,96 → Engine −2,00 %**; 10Y-Payer −1,77 %; **10Y-Receiver ATM (2,88 %) −3,66 %**; 2Y-Receiver −0,11 % (kurze Laufzeit, kleiner Effekt). Sichtbare Inkonsistenz seit dem N9-2-Fix: der Prämientermin verfeinert das Gitter nur für Trades **mit** Fee – eine **gezahlte** Fee 120 k USD in 100 d **erhöht** die CVA des 10Y-Receivers von 21.362,70 auf 21.404,11 (+0,19 %), obwohl sie das Exposure senkt; im `cvaGeneric`-Pfad ein FX-Swap (Gitter: 2 Zahlungstermine + Fälligkeit) mit gezahlter Fee in 45 d **+5,95 %** (725,24 → 768,40). Kein Regress (Gitter seit R2 unverändert), aber ein Bias in Ausweisrichtung „zu niedrig" auf dem Flaggschiff-XVA. | Exposure-Gitter in `cvaSwap`/`cvaBasisSwap` zwischen den Kupondaten auf höchstens 1 M (mindestens 3 M) verdichten (Sorensen–Bollier-Swaption auf den Rest-Swap ab dem Zwischenpunkt – die Rest-Swap-Bewertung ab beliebigem Datum ist bereits implementiert), `exposureGrid` in `cvaGeneric` auf maximal 1-M-Abstand auffüllen statt nur bei < 4 Punkten; alternativ Simpson statt Trapez; Test: Engine-CVA auf dem Standardgitter vs 7-Tage-Referenz ≤ 0,3 % für 2Y/5Y/10Y Payer/Receiver; Methodikzeile im Bericht nennt die Gitterauflösung. |
| **N10-3** | Kosmetisch (−0,2) | `pricing/leg-pricer.ts:185` (`fixingDayOf = … inEffect(obs(d))`), `:239` (`oFrom = inEffect(obs(realisedTo))`) | **Lookback auf einer Periode, die an einem Fixing-Feiertag beginnt, greift ein Fixing zu spät.** Für den Starttag d = Feiertag ist zuerst der Geschäftstag zu bestimmen, dessen Satz an d gilt (`inEffect(d)` = Vortag), und **von diesem** n Geschäftstage zurückzugehen; die Engine geht erst n Tage vom Feiertag zurück (landet damit nur n − 1 Geschäftstage vor dem wirksamen Tag) und wendet `inEffect` dann wirkungslos an. Probe (SOFR-Periode **ab Karfreitag 03.04.–04.05.2026**, Lookback 1: Engine 4,09966194 % vs QuantLib 4,09772029 %, Lookback 2: 4,09189580 % vs 4,08995416 %, je **+0,1942 bp**; Engine-Fixing für den 03.04. = 02.04. statt 01.04. (Lookback 1); Lockout 0…3 derselben Periode = QL bitgenau; Perioden mit Geschäftstagsbeginn bitgenau. Wirkt nur auf Perioden mit Feiertagsbeginn (Karfreitag-Starts in USD sind real, JPY-Golden-Week-Starts analog) und nur auf den ersten Tag – Wirkung im PV vernachlässigbar, aber ein Konventionsfehler in einem gegen QuantLib „bitgenau" ausgewiesenen Zweig. | `fixingDayOf = obs(inEffect(d))` und `oFrom = obs(inEffect(realisedTo))` (Reihenfolge tauschen); QL-Golden für eine Periode mit Feiertagsbeginn (Lookback 1/2, mit und ohne Observation Shift – letzterer nach N10-1). |
| **N10-4** | Kosmetisch (−0,2) | `dates/calendar.ts:685–705` (`adjust`: `while (cal.isHoliday(x)) x++`), `:707–716` (`addBusinessDays`: `while (remaining > 0) { x += step; if (isBusinessDay(x)) remaining−− }`), `:723–736` (`advance`), `instruments/builders.ts:661–666` (`makeFra` ohne `start`: `endDate <= startDate` mit `NaN` ist `false`, kein Fehler) | **Kalenderprimitive laufen mit `NaN`/`undefined` endlos.** `isBusinessDay(NaN)` ist stets `false` → `addBusinessDays(NaN, 2, cal)`, `adjust(NaN, "ModifiedFollowing", cal)`, `advance(NaN, "6M", cal)` und `makeFra({ …, start: undefined })` terminieren nicht (Probe: je Timeout nach 10 s statt Fehler). `validateTrade`/`priceTrade` fangen `NaN`-Legdaten (`INVALID_TRADE` „effectiveDate / terminationDate must be serial dates"), die öffentlich exportierten Kalender- und Builder-Funktionen selbst nicht; API (`parseISO` → 400 `INVALID_DATE`), Web-CSV-Import (`portfolio-io.ts:1217–1220` prüft `startDate`/`endDate`) und Schnelleingabe validieren vorab, ein programmatischer Nutzer des Cores (Excel-Add-in-Roadmap, Skripte) bekommt einen hängenden Prozess statt einer Fehlermeldung. | `if (!Number.isFinite(d)) throw new PricingError("INVALID_DATE", …)` am Eingang von `adjust`/`addBusinessDays`/`advance` (und `n`-Prüfung in `addBusinessDays`); `makeFra`: `start` typ- und endlichkeitsgeprüft (`INVALID_TRADE`); Test: `advance(NaN, …)` wirft. |

**Ohne Abzug, aber dokumentierenswert (bewusste Näherungen, korrekt gekennzeichnet oder ohne praktische Wirkung):**
- **Fee am/nach Laufzeitende:** wird über die ganze Restlaufzeit als Forderung/Verbindlichkeit genettet (10Y-Receiver + 100 k Fee am Laufzeitende: CVA 21.362,70 → 17.658,83) – ökonomisch korrekt (Netting-Set), Grid-Punkt entfällt, da der Fälligkeitspunkt Exposure 0 trägt.
- **FX-Forward-CVA, Trapez über einen Cash-Sprung** (R9-Notiz): mit dem Prämientermin im Gitter halbiert das Trapez weiterhin das Gewicht der Forderung im Intervall vor dem Termin (erhaltene 2 Mio. USD in 30 d); Effekt nur bei Fee ≫ Forward-Exposure.
- **`rollMarketForward`** behält `meta.snapshotTime` (nur intern für Carry-Theta genutzt); **`validateMarket`**-Meldungstext bei kleingeschriebenem Collateral-Schlüssel („denominated in EUR, not eur").
- **`rebateAt: "hit"` ohne Flag** (jetzt Default): Spot jenseits der Barrier zahlt „heute" (DF 1) und morgen erneut, bis `hit: true` gesetzt ist; `BARRIER_STATE_UNKNOWN:` fordert das Flag an, Theta 0,00 – Prozessrisiko Dimension 4.
- **Portfolio-Report ohne XVA-Summe**, XVA je Trade im Bewertungsbericht; Netting/Portfolio-XVA = Roadmap.
- **Unverändert aus R4–R9 (ohne Abzug):** Cash-Settlement-IRR mit `n = round(T·m)`, Futures-Konvexität als Input, CDS-Quartalsmittelpunkt (QL-Abstand 2,5·10⁻⁴ in Q), Basis-Swap-CVA 20-%-Spread-Vol-Proxy, `ene = 0` für Long-Optionen mit offener Prämie, Collar ohne `floorStrike`, FX-Reset-`fixingLag`, Normal-/Lognormal-SABR-Hinweis, `vegaUnit`, SABR-Fallback-Hinweis, Identitäts-Cache der Vol-Guards, €STR-Historie ab 02.01.2026, Hazard flach vs. Kurve (+0,3 %), CHANGELOG-Text zur Smile-Grenze (Dimension 6).

---

## 4. Verifizierte Positivbefunde Runde 10 (QuantLib-Cross-Checks und Invarianten)

| Bereich | Nachweis (Anhang A/B) |
|---|---|
| Tageszählungen, Schedules, SABR, Barriers, Digitals, GK-Greeks, CDS, OLS vs. QuantLib 1.43 | `probe-r7-dump.mjs` + `ql-compare-r5b.py`: Ausgabe **byteidentisch zu Runde 9, 8 und 7** (`diff` leer) |
| RFR-Lockout vs. QuantLib `OvernightIndexedCoupon(lockoutDays)` | k = 0…3 **bitgenau** (Standardperiode, Periode endet am Karfreitag, Periode beginnt am Karfreitag); Golden `rfr-lockout-quantlib.json` mit QL-Fixingdaten; Bewertungstag im Fenster → `isFixed` genau ab Veröffentlichung des eingefrorenen Fixings |
| RFR-Lookback ohne Observation Shift | Lookback 1/2 auf Perioden mit Geschäftstagsbeginn **bitgenau** (drei Perioden, inkl. Periode, die am Karfreitag endet); Lookback 5 auf drei Quartalsperioden bitgenau; Feiertagsbeginn → N10-3 |
| RFR-Observation Shift | drei Quartalsperioden mit τ_obs = τ_acc **bitgenau = ISDA = QL**; τ_obs ≠ τ_acc → N10-1 |
| CVA mit Prämie | 6 Swap-Typen × Payer/Receiver × ±100 k: Fee am Spot ±0,1 % (Test), Probe −0,01 … −0,28 %; Zahltermin-Abhängigkeit korrekt (2 d ≈ 0, 360 d ≈ ½·Fee·PD·LGD); Fremdwährungs-Fee = EUR-Fee gleichen PVs; CVA/DVA-Spiegelung exakt; Shifted-Lognormal inkl. Intrinsic-Fallback; FX-Forward und `cvaGeneric` mit Prämientermin im Gitter |
| Barrier-Zustandsmaschine | Default `hit` = explizit `hit` auf sechs Konstellationen, stetig an der Barrier (Sprung 0,55 = 1-Tages-Effekt), KO(`expiry`) + KI = Vanilla + R·N·DF exakt, Knock-in-Rebates am Lieferdatum, `makeFxOption` setzt `rebateAt`, Enum-Validierung unverändert |
| PA-Delta | 0 auf allen `settled-payoff`-Pfaden, lebend Δ − P/S |
| Validierung | `validateMarket []` auf Sample-Markt und vier importierten Snapshots (`EUR|USD`, `NOK|EUR`-Mappings), Fehlzuordnung erkannt; `validateTrade` fängt `NaN`-Legdaten |
| Roll/EMIR | `rollMarket` ohne veralteten `snapshotTime`, Theta/CVA unverändert, Feld 23 nach Roll = 17:00 UTC des Stichtags |
| Web-Beispielbuch (13 Trades) | 13/13 bewertet, **PV 13.936,16, DV01 18.382,34, Theta −1.031,22 – identisch zu R9/R8/R7**, 0 `MISSING_FIXING`, Portfolio-Report `failed 0` |
| Tests | 435 / 435 grün (30 Dateien, 14,9 s); `review-r9.test.ts` deckt N9-1…N9-3, N7-5-Rest, `validateMarket`, `rollMarket`/EMIR und den Berichtssatz mit den R9-Reviewer-Zahlen ab; `golden.test.ts` Lockout/Lookback gegen QuantLib |

---

## 5. Was für 100 noch fehlt

1. **N10-1** Observation Shift: Divisor = Beobachtungsperiode (realisiert, projiziert, Accrued); QL-Golden `applyObservationShift = true` für eine Periode mit τ_obs ≠ τ_acc; Test gegen die ISDA-Handrechnung.
2. **N10-2** Exposure-Gitter der Swap-/Basis-Swap-CVA (und `cvaGeneric`) auf ≤ 1 M verdichten oder Simpson; Test: Standardgitter vs 7-Tage-Referenz ≤ 0,3 %; Fee darf die CVA eines Payers nie erhöhen.
3. **N10-3** `obs(inEffect(d))` statt `inEffect(obs(d))`; QL-Golden mit Feiertagsbeginn.
4. **N10-4** Endlichkeitsprüfung in `adjust`/`addBusinessDays`/`advance`, `makeFra`-Eingangsprüfung.
5. Ohne Abzug: `rollMarketForward`-Meta, Meldungstext kleingeschriebener Collateral-Schlüssel, FX-Forward-CVA-Trapez um den Prämientermin, PA-Delta-Hedge-Hinweis, FX-Reset-`fixingLag`, Normal-/Lognormal-SABR-Hinweis, Collar-`floorStrike`, `vegaUnit`, SABR-Fallback-Hinweis, Mutations-Erkennung der Vol-Caches, €STR-Historie vor 2026.

---

## Anhang A – Probe-Ergebnisse (Auszug, Bewertungstag 03.09.2026, Sample-Markt, `dist` 04.09. 14:37 UTC)

```
tests: 30 files, 435/435 passed, 14.88 s
probe-r9a rerun vs R9 output – only expected changes:
  B CVA fee at spot: vanilla 24,666.14 → 24,662.65 (−0.01 %) ; stepUp 5,980.80 → 5,978.33 (−0.04 %) ; amortising 6,748.38 → 6,741.86 (−0.10 %) [R9 −8.90 %]
    imm 507.41 → 505.99 (−0.28 %) ; ois 2,500.78 → 2,497.73 (−0.12 %) ; basis 2,808.61 → 2,803.50 (−0.18 %) [R9 −9.19 %] ; fee paid −30 d = no fee (all)
    FxForward +50k EUR fee at spot: EPE1 141,897.99 (R9 171,097.16) CVA 542.21 (no fee 547.09)
  E rebateAt undefined: live@1.149999 99,999.45 | spot 1.15 100,000.00 (jump 0.55) [R9 98,283.05, −1,716.40] | 1.17 100,000.00 | hit:true 0.00 | expired beyond 0.00 | analytics.rebateAt hit
    deltaPremiumAdjusted knocked-out: 0.000000 (default / hit / expiry) [R9 −0.008546 / −0.008696]
    DownOut put 1.12 reb .02 default: 199,999.18 → 200,000.00 [R9 → 196,566.10]
  I 2Y SOFR swap 100 Mio.: lockoutDays 0 −1,159,642.15 ; 1 −1,159,646.91 [R9 = k 0] ; 2 −1,159,644.67 ; 3 −1,159,651.37
probe-r9c rerun: amortising receiver fee at spot 6,741.86 (−0.10 %) | fee tomorrow 6,750.70 | fee in 360 d 6,173.26 (−8.52 %)
  basis 2,808.61 → 2,803.50 ; receiver 10Y fee −200k received: 21,362.70 → 21,377.00 (+0.07 %) [R9 +5.62 %]
  report: "… Annuität der ökonomischen Legs – eine Upfront-Prämie ist ausgenommen, die All-in-Sicht … „Par-Satz all-in“ … (hier 2,7651 %)"
probe-r9-lockout rerun: engine k 0/1/2/3/4 = 4.06343422 / 4.06247539 / 4.06119688 / 4.05959870 / 4.05768083 % = manual "last k ← fixing before window" = QuantLib (ql-lockout-r9b.py)
probe-r10c (val inside lockout window, period 01.06.–03.08.2026, reference k=1/2/3 = 4.06247539 / 4.06119688 / 4.05959870 %):
  val 29.07 (last fixing 28.07): k=3 fixed=true = reference ; k=2 projected 4.02202804 % ; val 30.07: k=2,3 fixed ; val 31.07: k=1,2,3 fixed ; val 03.08: all fixed
probe-r10a C: USD fee 120k in 100 d on 10Y EUR receiver: CVA 21,362.70 → 21,404.11 (+0.19 %, grid point at +100 d; EPE(100 d) 181,148.18) ; same-PV EUR fee 21,404.11 (diff 0.00)   ← N10-2 side effect
  fee 100k on maturity / after / on last coupon: 17,658.83 / 17,667.95 / 17,831.39 (netted over the whole life, 11 points)
  shifted-lognormal (25 %, shift 3 %): base 43,048.22 ; fee −5M 200 d 59,716.82 ; +5M 43,211.07 ; −50M 205,194.74 (intrinsic branch, no error)
  mirror: receiver + paid fee CVA 21,236.18 DVA 12,984.45 | payer + received fee (hazards swapped) CVA 12,984.45 DVA 21,236.18 → exact
  grid check (manual Sorensen–Bollier, flat 2 % hazard, LGD 60 %):
    10Y receiver 3 %: engine 21,362.70 (11 pts) | manual 365 d 21,370.05 | 30 d 21,787.17 | 7 d 21,797.96 → −2.00 %   ← N10-2
    10Y payer 3 %:    engine 24,666.14 | 7 d 25,111.10 → −1.77 % ; 10Y receiver ATM 2.88 %: 18,479.67 | 7 d 19,181.58 → −3.66 % ; 2Y receiver 1,446.41 | 7 d 1,448.08 → −0.11 %
  other types, fee 100k in 45 d (cvaGeneric): ccs 33,757.29 → 33,745.12 (−0.04 %) ; swpn 1,323.70 → 1,249.44 ; cap 925.62 → 899.69 ; fxo 5,076.89 → 5,002.60 ; fxs 725.24 → 768.40 (+5.95 %, 4 → 5 grid points)   ← N10-2
probe-r10a D (default rebateAt, spot 1.1625, R 0.01, 10 Mio.):
  UpOut  Call K1.1 H1.2 : live default 171,495.44 = hit | expiry 170,836.77 | at barrier 100,000.00 | hit:true 0.00 | expired touched 0.00 | expired untouched 622,950.37
  DownOut Put K1.2 H1.12: live 120,153.83 = hit | expiry 119,679.52 | at barrier 100,000.00 | hit:true 0.00 | expired touched 0.00
  UpIn   Call K1.1 H1.2 : live 660,332.55 = hit = expiry | at barrier 1,075,365.34 (vanilla) | hit:true 732,886.28 (vanilla) | expired untouched 99,990.14 = R·N·DF(TOM)
  DownIn Put K1.2 H1.12 : live 404,706.58 = hit = expiry | hit:true 426,103.05 (vanilla) | expired untouched 99,990.14 ; UpIn Put / DownIn Call analog
  parity @spot: KO(expiry) 170,836.77 + KI 660,332.55 = 831,169.33 = vanilla 732,886.28 + R·N·DF 98,283.05 (diff 0.00) ; KI(default) = KI(expiry)
probe-r10a E: validateMarket sample [] ({"EUR|USD":"EUR-ESTR-USDCSA"}, curve ccy EUR) ; snapshot-czk-r8 ({"EUR|USD",…,"NOK|EUR":"NOK-NOWA"}) [] ; snap-x9 [] ; snapshot-lognormal [] ; susp-snapshot []
  {"EUR|USD": EUR curve, "USD|EUR": USD curve} [] ; "eur|usd" → "Collateral discount curve EUR-ESTR for eur|usd is denominated in EUR, not eur"
probe-r10a F: rollMarket(+90).meta {"source":"import","label":"EOD (rolled to 2026-12-02)"} ; rollMarketForward(+1) keeps snapshotTime ; theta −310.94 = −310.94 ; CVA CCS 33,757.29 = 33,757.29
  emir: imported 2026-09-03T17:00:00Z ; rolled +90 → 2026-12-02T17:00:00Z ; snapshotTime 2026-09-05T10:00:00Z on val 09-03 → used
probe-r10a G: portfolio report 5 trades failed 0 pv 191,388.10 warnings 0 ; totals without cva/dva (by design) ; makeFxOption barrier → rebateAt "hit"
probe-r10f (NaN robustness, 10 s timeout each): advance(NaN,"6M") TIMEOUT ; addBusinessDays(NaN,2) TIMEOUT ; addBusinessDays(undefined,2) TIMEOUT ; makeFra start undefined TIMEOUT   ← N10-4
  validateTrade terminationDate NaN → ["…effectiveDate / terminationDate must be serial dates"] ; priceTrade → INVALID_TRADE
probe-r8-book (web sample book, 13 trades): missing-fixing 0 ; failed 0 pv 13,936.16 dv01 18,382.34 theta −1,031.22 fxDelta {USDEUR 30,946.95, GBPEUR −14,801.69, CHFEUR −4,956.71} warnings 0 (= R9/R8/R7)
```

## Anhang B – QuantLib-Cross-Checks (QuantLib 1.43, `PYTHONPATH=…/pyql`)

```
ql-compare-r5b.py (probe-r7-dump.mjs): output identical to round 9, 8 and 7 (diff empty)
  A day counts 5.55e-17 ; B schedules 9/9 ; C SABR 4.44e-15 ; D barriers 72 cases 3.89e-16 ; E digitals 1.11e-15 ; F GK greeks 4.9e-15 ; G CDS ΔQ ≤ 2.47e-4 ; H OLS = numpy
ql-lockout-r9b.py (period 01.06.–03.08.2026, ql.Sofr() with the engine's fixings, OvernightIndexedCoupon ACT/360):
  lockout 0: QL 4.06343422 % = engine k 0 ; lockout 1: QL 4.06247539 % = engine k 1 [R9: engine k 2] ; lockout 2: 4.06119688 % = engine k 2 ; lockout 3: 4.05959870 % = engine k 3
ql-lockout-r10.py (edge periods):
  03.03.→03.04.2026 (ends Good Friday, QL value dates …02.04, 06.04): lockout 0/1/2/3 QL 4.05504563 / 4.05439829 / 4.05310361 / 4.06475579 % = engine +0.0000 bp ; lookback 1/2 4.05245802 / 4.04857572 % = engine
  03.04.→04.05.2026 (starts Good Friday): lockout 0/1/2/3 QL 4.06471521 / 4.07636488 / 4.07377592 / 4.07053961 % = engine +0.0000 bp
    lookback 1: QL 4.09772029 % engine 4.09966194 % (+0.1942 bp) ; lookback 2: QL 4.08995416 % engine 4.09189580 % (+0.1942 bp)   ← N10-3
  19.03.→20.04.2026: lockout 0…3 and lookback 1/2 = engine +0.0000 bp
ql-lookback-r10.py (observation shift, applyObservationShift = True):
  03.04.→04.05. lookback 1 obsShift: QL 4.07377523 % engine 3.80967119 % (−26.41 bp) ; 03.03.→03.04. lookback 2 obsShift: QL 4.05982674 % engine 4.32175104 % (+26.19 bp)
  19.03.→20.04. lookback 1 obsShift: QL 4.05638923 % engine 3.80286491 % (−25.35 bp) ; lookback 1 without shift = engine   ← N10-1
ql-obsshift-r10.py (lookback 5, obsShift, engine vs QL vs ISDA manual (Π(1+r·τ_obs) − 1)/τ_obs):
  02.03.→02.06.2026 (92 d / obs 92 d): QL 4.071671 % = engine = ISDA ; 05.01.→06.04. (91/91): 4.073333 % = engine = ISDA ; 15.12.→16.03. (91/91): 4.073106 % = engine = ISDA
  01.05.→01.06.2026 (31 d / obs 28 d): QL 4.057399 % = ISDA manual (+0.0000 bp) ; engine 3.664747 % (−39.265 bp = 4.057399·28/31)   ← N10-1
  projected 2Y SOFR swap 100 Mio. quarterly, lookback 5 + obs shift (probe-r10g): periods 91/92 d → engine/ISDA ratio 1.01099 (+3.87 bp), 92/91 d → 0.98913 (−3.48 bp), equal lengths 0.00 bp ; Σ coupon Δ 1,299.31 USD
```

Probe-Skripte: `probe-r10a.mjs`, `probe-r10c.mjs`, `probe-r10d.mjs`/`probe-r10e.mjs`, `probe-r10f.mjs` + `ql-lookback-r10.py`, `probe-r10g.mjs` + `ql-obsshift-r10.py`, `ql-lockout-r10.py` (neu), `probe-r9a.mjs`/`probe-r9c.mjs`/`probe-r9-lockout.mjs` + `ql-lockout-r9b.py` (Rerun, Diff gegen R9-Ausgabe), `probe-r7-dump.mjs` + `ql-compare-r5b.py` (Rerun, Diff gegen R9-Ausgabe), `probe-r8-book.mts` (Rerun) im Review-Scratchpad; alle Zahlen des Hauptteils daraus reproduziert.
