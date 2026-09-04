# Re-Review Runde 9: Pricing-Korrektheit & Methodik (Dimension 2, Gewicht 20 %) – DERIVA `@deriva/pricing-core`

**Reviewer-Rolle:** Senior Quant (Multi-Curve, ISDA-Konventionen, Black/Bachelier/SABR, Garman-Kohlhagen/Reiner-Rubinstein, XVA, Hedge Accounting IFRS 9 / HGB § 254) · **Stand:** 04.09.2026, Branch `claude/derivatives-trading-platform-1arsyu`, Commit `d470e6a` (dist-Build 04.09. 10:47 UTC, kein Quellfile neuer als dist) · **Modus:** Review only, keine Quell-, Test- oder Golden-Datei geändert
**Baseline:** `docs/quality/review-quant-r8.md` (Runde 8, Score 96 / 100), Befunde N8-1…N8-7, Rest N7-5 und die R8-Liste „Was für 100 noch fehlt"; Maßnahmenprogramm Runde 8 → 9 (`08-scorecard-runde-8.md`, CHANGELOG „Core (Review Runde 8 – Quant N8-1…N8-9 …)", Commit `da5695c`).
**Geprüft:** der komplette Core-Diff `60cc4bc..d470e6a` (20 Dateien, +1 988/−201 Zeilen, zeilenweise gelesen: `pricing/swap-pricer.ts` (`pvEconomic`, `parRateAllIn`/`fairSpreadAllIn`), `xva/cva.ts` (`remaining` ohne `upfront`, `cvaFxForward`-Strike-Shift), `pricing/price.ts` (`discountedCurrencies`, `checkIndexCurrency`, `lockoutDays`-/`rebateAt`-Validierung), `pricing/leg-pricer.ts` (`inEffect`, Lockout-Schleife und -Projektion), `pricing/fx-pricer.ts` (`rebateAt` auf allen Pfaden, `deltaPremiumAdjusted`, `analytics.rebateAt`), `dates/calendar.ts` (`UnitedStatesSifmaCalendar`, `JapanCalendar` mit Ersatz-/Bürgerfeiertagen und `equinoxDay`, `CustomCalendarJson`, `BUILT_IN_CALENDAR_IDS`, `QUANTLIB_CROSS_CHECKED_CALENDARS`), `curves/index-definitions.ts` (`paymentCalendar`, `indexScheduleCalendar`, `validateRateIndex`/`validateSwapConventions`), `curves/bootstrap.ts` und `instruments/builders.ts` (Schedule-Kalender über `indexScheduleCalendar`), `market/vol-validation.ts` (`fxSmilePlausibility`), `models/fx-vol-surface.ts` (`assertPillarVol`), `reporting/valuation-report.ts` (`checkedCalendarClause`, Rebate-/Lockout-Text), `instruments/types.ts`, `errors.ts`, `index.ts`, `testing/golden.test.ts` + `test-data/golden/calendars-quantlib.json` (+429 Zeilen), `tools/quantlib-golden.py`, `pricing/review-r8.test.ts` (725 Zeilen)).
**Methode:** `npx vitest run` → **421 / 421 grün** (29 Dateien, 18,8 s). Die Runde-8-Probeskripte `probe-r8a.mjs`/`probe-r8b.mjs` wurden gegen das frische `dist` erneut ausgeführt und gegen ihre R8-Ausgaben gediff't (nur die erwarteten Änderungen der Fixes, Anhang A). `probe-r7-dump.mjs` + `ql-compare-r5b.py` gegen **QuantLib 1.43** liefern eine **byteidentische** Ausgabe zu Runde 8 und 7 (Tageszählungen, Schedules, SABR, 72 Barriers, Digitals, GK-Greeks, CDS, OLS). Neu: `probe-r9-cal-dump.mjs` + `ql-calendars-r9.py` (alle elf Engine-Kalender inkl. `US-SIFMA` 2024–2032 gegen QuantLib), `probe-r9-lockout.mjs` + `ql-lockout-r9.py`/`ql-lockout-r9b.py` (Lockout-/Lookback-Compounding gegen `ql.OvernightIndexedCoupon`), `probe-r9a.mjs` (Par-Größen und Par-Check aller neun Swap-Typen mit Prämie, CVA aller Produkttypen mit Prämie, FX-Forward-CVA-Zweige, Portfolio-Report, SOFR-/JP-Kalendereffekte auf Schedules, Spot-Daten und Fixing-Perioden, `rebateAt`-Konventionen, Leg-Währungs-Validierung, Vol-Plausibilität, PA-Delta, Lockout auf Swap-Ebene), `probe-r9b.mjs`/`probe-r9c.mjs` (CVA-Grid-Details, Bericht), `probe-r8-book.mts` (Web-Beispielbuch, 13 Trades, via `tsx`).

---

## 1. Score

### **Pricing-Korrektheit & Methodik: 99 / 100** (rechnerisch 99,0; Runde 8: 96, Runde 7: 98, Runde 6: 98, Runde 5: 97, Runde 4: 97, Runde 3: 95, Runde 2: 90, Runde 1: 59)

**In einem Satz:** Alle sieben Runde-8-Befunde sind nachweislich behoben oder umgesetzt (Par-Satz/fairer Spread invariant gegen die Prämie auf allen neun Swap-Typen mit exaktem Par- und All-in-Check, Sorensen–Bollier-CVA ohne Fee-Verzerrung, FX-Forward-CVA nettet die Prämie bis zum Prämientermin, `COLLATERAL_CURVE_MISSING` nur bei Diskontbedarf, SOFR fixt auf dem SIFMA-Kalender und alle **zehn** Referenzkalender sind mengengleich mit QuantLib 1.43, Smile-Pillar-Plausibilität ohne Fehlalarm auf den Beispielflächen, `rebateAt` bis ins Modell mit stetiger Barrier und exakter KO/KI-Parität), die Vendor-Cross-Checks bleiben bitgenau, das Beispielbuch bewertet unverändert 13/13 –; **neu bleiben vier kleine Punkte: das Lockout-Compounding ist gegenüber QuantLib/ISDA um einen Tag verschoben (`lockoutDays: 1` ist wirkungslos, Engine-k = QuantLib-(k − 1)), das Prämien-Netting am t = 0-Punkt der Swap-/Basis-Swap-CVA wirkt per Trapez über das gesamte erste Grid-Intervall (Fee in 2 Tagen → CVA −8,9 %), `deltaPremiumAdjusted` ist für ausgeknockte Barrieren mit Rebate ≠ 0 entgegen der Doku, und die Default-Rebate-Konvention bleibt die R7-Mischung mit Sprung an der Barrier.**

**Abzugsherleitung** (Rubrik: kritisch −10…−25, fehlendes Kernfeature −3…−8, Reibung −1…−3, kosmetisch −0,2…−1):

| Klasse | Abzug | Befunde |
|---|---:|---|
| Kritisch | 0 | – |
| Hoch | 0 | – |
| Mittel | 0 | – |
| Niedrig (neu) | −0,6 | N9-1 Lockout um einen Tag verschoben: Engine `lockoutDays k` = QuantLib `lockoutDays k − 1`, `lockoutDays: 1` = kein Lockout (−0,3) · N9-2 t = 0-Prämien-Netting in `cvaSwap`/`cvaBasisSwap` mit Trapezgewicht über das ganze erste Intervall: amortisierender Receiver 6.748 → 6.148 (−8,9 %) für eine in 2 Tagen gezahlte Fee, Basis-Swap −9,2 %, 10Y-Receiver mit erhaltener Fee +5,6 %; `cvaGeneric`/`cvaFxForward` netten bis zum Prämientermin (CCS −0,01 %) (−0,3) |
| Kosmetisch (neu) | −0,2 | N9-3 `deltaPremiumAdjusted` = −Rebate·DF/S (−0,85 %) für ausgeknockte Barrier mit Rebate, Doku „0 without optionality" |
| Offen aus Runde 7/8 | −0,2 | N7-5 Rest: `rebateAt` fehlt → Default bleibt die R7-Mischung (Sprung 1.716 = Rebate·(1 − DF) an der Barrier); Builder/Schnelleingabe setzen keine Konvention |
| **Summe** | **−1,0** | → **99,0 / 100** |

Zur Einordnung: Keiner der vier Punkte ist ein Regress – die R8-Fixes wirken auf allen geprüften Pfaden ohne Nebenwirkung auf Schedules, Spot-Daten, Bootstrap oder das Beispielbuch (PVs identisch zu R8). N9-1 und N9-2 sind Präzisierungen zweier in Runde 8 neu gebauter Mechanismen; ein reines Modell-/Formel-Review (Black/Bachelier/SABR/GK/RR/CDS/Kalender gegen QuantLib) läge bei 100.

---

## 2. Status der Runde-8-Befunde

Legende: **behoben** = reproduziert und mit Zahl belegt · **teilweise** = Kern behoben, Restpunkt benannt · **offen** = unverändert.

| # | Befund R8 | Status | Nachweis (Probe gegen `dist`, Anhang A) |
|---|---|---|---|
| **N8-1** | Upfront-Prämie in `parRate`/`fairSpread` und Sorensen–Bollier-CVA | **behoben** | `swap-pricer.ts:86–88` (`pvEconomic` vs `pv`), `:107–113, 127–130, 139–142` (`parRate`/`parRateFlat`/`fairSpread` aus `pvEconomic`, `parRateAllIn`/`fairSpreadAllIn` nur mit `upfront`), `cva.ts:289–293, 372` (`remaining` mit `upfront: undefined`). Probe (r8a-Rerun): 10Y-Payer + 100 k Fee am Spot **`parRate` 2,8800 % (Δ 0,00 bp; R8: 2,7651 %), `parRateAllIn` 2,7651 %, CVA 24.666,14 = ohne Fee (R8: 19.840,02)**; Fee 500 k in 1Y: 2,8800 %, CVA 24.666,14 (R8: 2,3176 %, 8.486,93); Basis-Swap `fairSpread` −0,0784 % invariant, `fairSpreadAllIn` 0,1317 %; Rest-Swap ab +3Y `parRate` 3,0806 % mit und ohne Fee. **Alle neun Swap-Typen** (Vanilla, Zinstreppe, amortisierend, IMM/USD, SOFR-OIS, Basis, CCS fix/float, CCS float/float, MtM-CCS): `parRate`/`fairSpread` Δ 0,000 bp gegen die Fee; **Par-Check** (Kupon = `parRate` bzw. Spread = `fairSpread` → PV der ökonomischen Legs) **0,00 in allen neun Fällen**, Zinstreppe zusätzlich `parRateFlat` → 0,00; **All-in-Check** (Kupon = `parRateAllIn` → Gesamt-PV inkl. Fee) **0,00 in allen neun Fällen**. CVA-Profile ab t > 0 mit Fee am Spot / gezahlt −30 d identisch zum Fee-losen Profil (Vanilla, Zinstreppe, amortisierend, IMM, OIS, Basis). API-Schema und Web-Metrikblock (`parRateAllIn` „Par-Satz all-in (inkl. Prämie)") kennen die neue Größe. Rest zur t = 0-Gewichtung → N9-2. |
| **N8-2** | `cvaFxForward` ignoriert die Prämie | **behoben** | `cva.ts:427–447` (Prämien-PV in Quote-Währung, `kEff = K − c/(N·DF_q)` bis zum Prämientermin, `kEff ≤ 0`-Zweig, `profile[0]` aus `priceTrade`). Probe: FX-Forward EURUSD 10 Mio. + 50 k USD Fee in 30 d: **`profile[0].epe` 98.238,77 = PV (R8: 141.131,80), CVA 525,96 (ohne Fee 547,09)**, Methode „GK forward-exposure (open premium netted)"; 2Y-Forward + 500 k USD Fee in 200 d: Grid-Punkte bis 02.03.2027 verschoben (0 / 32.480 / 62.908 … statt 171.097 …), ab 01.04.2027 identisch zum Fee-losen Profil, CVA 8.858,62 vs 10.463,51; **erhaltene Fee −2 Mio. USD (`kEff ≤ 0`)**: EPE(0) 1.856.853,06 = PV, kein negativer Strike; gezahlte 20 Mio.: ENE(0) 17.016.080,82 = −PV; Sell-Seite (Verkauf EUR) numerisch identisch. Test `review-r8.test.ts:164–198`. |
| **N8-3** | `COLLATERAL_CURVE_MISSING` für gezahlte Prämienwährung | **behoben** | `price.ts:455–457, 466–473` (`discountedCurrencies`: ökonomische Legs + Prämienwährung nur bei `upfront.date > valuationDate`), öffentlich exportiert. Probe (r8a-Rerun, EUR-IRS unter EUR-CSA): **USD-/GBP-/NOK-Fee vor 30 d → `warnings []`** (R8: je eine `COLLATERAL_CURVE_MISSING`), unbezahlte USD-Fee in 1Y weiterhin Warnung (korrekt), USD-CSA mit vorhandener Kurve `[]`. Test `:200–221`. |
| **N8-4** | SOFR-Compounding zählt den Karfreitag als Fixingtag | **behoben** | `calendar.ts:150–178` (`UnitedStatesSifmaCalendar`: Settlement + Karfreitag, ohne Freitags-Beobachtung von Neujahr/Veterans Day am Samstag), `index-definitions.ts:15–34, 105` (`paymentCalendar: "US"`, `indexScheduleCalendar`), `leg-pricer.ts:158, 178–181, 232` (Compounding-Grid auf `fixingCalendar`, `inEffect` für Periodenstart am Fixing-Feiertag), `bootstrap.ts`/`builders.ts` (Schedules über `indexScheduleCalendar`). Eigener QL-Abgleich: **`US-SIFMA` = `UnitedStates(SOFR)` 106/106 Werktagsfeiertage 2024–2032, `US` = `UnitedStates(Settlement)` 100/100** (Anhang B). Probe: USD-OIS 2Y ab 15.01.2026 mit realer SOFR-Historie ohne 03.04.2026 → **keine Warnung, PV −66.221,36** (R8: `MISSING_FIXING`, −66.863,17); ein fiktives Karfreitags-Fixing wird jetzt ignoriert (Donnerstagsfixing über 4 Tage, PV −66.221,36 statt −66.220,92). SOFR-Periode **ab Karfreitag 03.04.→04.05.2026** mit Fixings nur an SIFMA-Tagen: Engine 4,3308 % = manuelles Compounding (Diff 0,00 bp), `missingFixingPolicy: "throw"` ohne Fehler. **Keine Nebenwirkung auf Zahlungstermine**: USD-OIS-Legs Kalender `US`/`US`, Periodenenden 06.04./06.07./05.10.2026/05.01.2027 (Karfreitag bleibt US-Settlement-Tag), EURUSD-Spot vom 01.04.2026 → 07.04. (TARGET), USDJPY → 03.04. (Karfreitag ist USD-Settlement-Tag), Beispielmarkt `validateMarket []`. Lookback 1/2 auf dem SIFMA-Kalender = QuantLib `OvernightIndexedCoupon(lookbackDays)` **bitgenau** (4,05480526 % / 4,04617640 %). Golden + Test `golden.test.ts:709–732`, `review-r8.test.ts:223–286`. |
| **N8-5** | JP-Kalender 11 Abweichungen, Berichtstext behauptet Abgleich | **behoben** | `calendar.ts:233–283` (Ersatzfeiertag Sonntag → nächster Nicht-Feiertag, Bürgerfeiertag zwischen zwei Feiertagen, Äquinoktien nach NAOJ-Formel, BoJ-Bankfeiertage 2./3.1., 31.12.), `:660` (`QUANTLIB_CROSS_CHECKED_CALENDARS`), `valuation-report.ts:584–595` (`checkedCalendarClause` aus dieser Liste, `DE` nicht genannt). Eigener QL-Abgleich: **JP 154/154 identisch** (R8: 143 gemeinsam, 11 nur QL, 2 nur Engine); Probe: USDJPY-Spot vom 01.05.2026 → **08.05.** (R8 07.05.), vom 18.09.2026 → **25.09.** (R8 24.09.), JPY-6M-Schedule ab 06.11.2025 endet **07.05.2026**; TONA-Periode 20.04.→20.05.2026 mit Fixings nur an JPX-Tagen (ohne 04.–06.05.) bewertet ohne `MISSING_FIXING`. Golden `calendars-quantlib.json` deckt jetzt TARGET/US/US-SIFMA/UK/CH/JP/NO/SE/DK/PL ab (`golden.test.ts:691–701`: Schlüsselmenge = `QUANTLIB_CROSS_CHECKED_CALENDARS`). |
| **N8-6** | Negative Smile-Pillar-Vols bewerten still | **behoben** | `vol-validation.ts:255–257, 327–361` (`fxSmilePlausibility`: `atm + bf ∓ rr/2 > 0`, `|RR|`/`|BF| ≤ 50 Vol-Punkte, je Expiry mit Label), `:386, 409` (in `volSurfaceWarnings` und im Pricer-Cache), `fx-vol-surface.ts:233–257` (`assertPillarVol` → `INVALID_VOL_SURFACE`). Probe (r8b-Rerun): **`rr25 = 0,30` → 8 `VOL_IMPLAUSIBLE:`-Warnungen („25Δ put pillar vol at 1Y is −7,05 % …"), Put K 1,20 → `INVALID_VOL_SURFACE`** (R8: still 10,81 %); `bf25 = 500 %` → 8 Warnungen („butterfly 500,00 % exceeds 50,00 %"); `rr25 = −50 %` → Warnung + Fehler. **Keine Fehlalarme:** alle zehn Beispiel-FX-Flächen + Swaption-/Caplet-Flächen `[]`, `validateMarket []`; EM-Smile (ATM 20 %, RR25 12 %, RR10 25 %, BF10 6 %) `[]`; JPY-artig (ATM 10 %, RR −3/−6 %) `[]`; leicht negativer BF (−0,2 %) `[]`; Grenze RR = 2·(ATM + BF) → Warnung (Pillar 0,00 %), RR 0,16 (Pillar 0,5 %) `[]`. Test `:318–359`. Doku-Nit: CHANGELOG schreibt „|RR|/|BF| > 50 % des ATM", der Code prüft absolute 50 Vol-Punkte (`fxSmileMax: 0.5`) – Dimension 6. |
| **N8-7** | Kein Lockout-Compounding | **teilweise** → N9-1 | `types.ts:104–113` (`lockoutDays`), `leg-pricer.ts:170–232` (Realisiert: Fixing von `end − k` ab `end − k` eingefroren; Projektion: Teleskop-Forward bis `lockoutDate`, dann dessen Overnight-Forward Tag für Tag), `price.ts:160–165` (nicht mit Lookback/Observation Shift kombinierbar), Bericht („Lockout k Geschäftstage … ISDA 2021"), Web-Editor und API-Schema. Mechanik korrekt (Test `:432–545`, eigener Nachvollzug: Engine k = 2 → 4,06247539 % = manuell „letztes Fixing ersetzt"), **aber Zählung um einen Tag verschoben** gegenüber QuantLib (N9-1). |
| **N7-5** | Rebate-Konvention lebend ≠ entschieden | **behoben** (Rest −0,2) | `types.ts:221–238` (`barrier.rebateAt: "hit" \| "expiry"`), `fx-pricer.ts:312, 517–530, 547–549` (`hit`: Berührung heute value-today DF 1, `hit: true`/Verfallsfixing = bereits gezahlt; `expiry`: `fxBarrier({ rebateAtExpiry: true })` + Rebate·DF(Lieferung) auf allen entschiedenen Pfaden), `:645` (`analytics.rebateAt`), `price.ts:362–365` (Enum-Validierung), Berichtstext je Konvention. Probe (UpOut 1,15 Rebate 0,01, 10 Mio.): **`expiry`: lebend @1,149999 98.282,54 → Spot 1,15 98.283,05 (Sprung 0,51), Spot 1,17 / `hit: true` 98.283,05; `hit`: 99.999,45 → 100.000,00 (Sprung 0,55), `hit: true` 0, verfallen mit Fixing jenseits 0**; Default unverändert 99.999,45 → 98.283,05 (Sprung −1.716,40, `analytics.rebateAt "default"`). **Parität @1,10: KO(`expiry`) 68.633,02 + KI 298.115,97 = Vanilla 268.465,94 + R·N·DF 98.283,05 (Diff 0,0000)**; KO(`hit`) 69.031,08 = KO(default) (Term F, QuantLib-Konvention), KO(`hit`) − KO(`expiry`) = +398,06 (> 0, plausibel). DownOut-Put 1,12 Rebate 0,02: `expiry` 196.565,36 → 196.566,10, `hit` 199.999,18 → 200.000,00, Default 199.999,18 → 196.566,10. `rebateAt: "touch"` → `INVALID_TRADE`. **Rest:** ohne `rebateAt` bleibt die R7-Mischung mit Sprung Rebate·(1 − DF); `makeFxOption`, Web-Schnelleingabe und CSV-Import setzen keine Konvention (der Editor bietet sie an, der Bericht empfiehlt sie). |

### 2.2 R8-Liste „Was für 100 noch fehlt" (Abschnitt 5)

| Pkt. | Thema | Status |
|---|---|---|
| 1–6 | N8-1…N8-6 | **behoben** (s. o.) |
| 7 | N7-5 `rebateAt` bis ins Modell, Stetigkeitstest | **behoben**, Default-Konvention offen (−0,2) |
| 8 | N8-7 `lockoutDays` | **umgesetzt**, Zählung → N9-1 |
| 9 | Ohne Abzug: PA-Delta in `analytics` | **behoben** (`deltaPremiumAdjusted`; Vanilla-Call K 1,15 1Y: 0,619032 → 0,576682 = Δ − PV/(N·S), Verkauf symmetrisch) – Rest → N9-3 |
| 9 | Ohne Abzug: FX-Reset-`fixingLag`, Normal-/Lognormal-SABR-Hinweis, Collar-`floorStrike`, `vegaUnit`, SABR-Fallback-Hinweis, Mutations-Erkennung der Vol-Caches, €STR-Historie vor 2026 | **unverändert** – weiterhin ohne Abzug |

---

## 3. Neue Befunde (Runde 9)

Severity wie R1–R8: **Niedrig** = Inkonsistenz/Konventionsabweichung mit kleiner, aber realer Wirkung · **Kosmetisch** = Grenzfall ohne praktische Wirkung im v1-Scope.

| # | Sev. | Datei:Zeile | Befund | Fix |
|---|---|---|---|---|
| **N9-1** | Niedrig (−0,3) | `pricing/leg-pricer.ts:173` (`lockoutDate = max(start, addBusinessDays(end, −lockout, cal))`), `:181` (`fixingDayOf`: `d ≥ lockoutDate → lockoutDate`), `:224` (Projektion `rLock` ab `lockoutDate`), `instruments/types.ts:104–113`, `apps/api/src/schemas.ts:205–211` | **Das Lockout-Compounding ist gegenüber QuantLib/ISDA um einen Geschäftstag verschoben.** Die Engine friert das Fixing des Tages `end − k` **ab diesem Tag** ein – der Tag `end − k` erhält damit sein eigenes Fixing, ersetzt werden nur die Fixings der letzten `k − 1` Geschäftstage. ISDA 2021 „Compounded with Lockout"/QuantLib 1.43 `OvernightIndexedCoupon(lockoutDays = k)`: die **letzten k Fixings** werden durch das Fixing des Geschäftstags **vor** dem Lockout-Fenster ersetzt. Probe (SOFR-Periode 01.06.–03.08.2026, Fixings 4,00 % + 0,02 %·((d − start) mod 7), QuantLib `ql.Sofr()` mit identischen Fixings): **Engine `lockoutDays 1` → 4,06343422 % = ohne Lockout (wirkungslos); Engine k = 2 → 4,06247539 % = QuantLib k = 1; Engine k = 3 → 4,06119688 % = QuantLib k = 2; Engine k = 4 → 4,05959870 % = QuantLib k = 3** (QuantLib-Fixingdaten k = 2: 28.07., 29.07., **29.07., 29.07.**; Engine: 28.07., 29.07., **30.07., 30.07.**). Lookback 1/2 dagegen bitgenau. Wirkung im PV klein (2Y-SOFR-Swap 100 Mio.: k = 2 vs k = 3 Δ 2,24), aber ein 1-Tages-Lockout (nicht ungewöhnlich in Kreditdokumentationen) hat keine Wirkung und jede Lockout-Angabe ist um einen Tag falsch parametrisiert. | `lockoutDate = addBusinessDays(end, −(k + 1), cal)` als eingefrorenes Fixing, eingefroren ab `addBusinessDays(end, −k, cal)` (Realisiert und Projektion); Doku/API-Text „die letzten k Geschäftstage tragen das Fixing des Geschäftstags vor dem Lockout"; Golden gegen `ql.OvernightIndexedCoupon(lockoutDays)` (k = 1…3) analog zu den Kalender-Goldens; Test: `lockoutDays: 1` ändert den Satz. |
| **N9-2** | Niedrig (−0,3) | `xva/cva.ts:284–285, 366–367` (`profile[0]` = max(PV inkl. Fee, 0), nächster Punkt erst am ersten Kupontermin), `:459–464` (`aggregate`: Trapez × marginale PD) | **Das Prämien-Netting am t = 0-Punkt der Swap-/Basis-Swap-CVA wirkt über das gesamte erste Grid-Intervall.** Die Fee wird nur im t = 0-Exposure genettet, das Trapez interpoliert dann linear bis zum ersten Kupontermin (typisch 1Y): eine in **2 Tagen** gezahlte Fee gewichtet mit 0,5·ΔEPE(0)·PD(t₁)·LGD. Probe: **amortisierender Receiver 7Y, Fee 100 k am Spot: CVA 6.748,38 → 6.148,03 (−8,9 %; 0,5·99.978·0,0200·0,6 = 600,35 = exakt die Differenz), Fee morgen 6.147,93, Fee in 360 d 6.160,23 – der Zahltermin der Fee ist irrelevant**; Basis-Swap 5Y: 2.808,61 → 2.550,39 (−9,2 %; EPE(0) 84.885 → 0); 10Y-Receiver mit erhaltener Fee −200 k: 21.362,70 → 22.563,40 (+5,6 %). Dagegen `cvaGeneric` (CCS/FRA/Optionen) nimmt den Prämientermin ins Grid und nettet nur bis dahin (CCS fix/float + 100 k Fee: 44.056,39 → 44.049,82, −0,01 %; zusätzlicher Grid-Punkt 07.09.2026), `cvaFxForward` shiftet den Strike nur bis zum Prämientermin (2Y-Forward, Fee 200 d: Punkte ab 01.04.2027 identisch). Wirkung: XVA-Ausweis von Swaps mit Fee je nach Richtung um hohe einstellige Prozente zu niedrig/hoch; inkonsistent zwischen Produkttypen. Kein Regress – R8 lag bei −20 %/+57 %. | In `cvaSwap`/`cvaBasisSwap` einen Grid-Punkt am Prämientermin einfügen: Exposure vor dem Termin = Rest-Swap-Exposure ± Prämien-PV (Bachelier-Optionen mit um c/A verschobenem Strike, wie der μ-Shift in `cvaGeneric`), ab dem Termin ohne Fee; Test: Fee am Spot → CVA = ohne Fee ± 0,1 % (alle Swap-Typen, Payer und Receiver), Fee in 1Y → Differenz ≈ Fee·PD(1Y)·LGD·½. |
| **N9-3** | Kosmetisch (−0,2) | `pricing/fx-pricer.ts:626–633` (`deltaPremiumAdjusted: longShort·(spotDelta − premiumPerUnit/spot)`, Kommentar „0 without optionality (settled / delivered)") | **`deltaPremiumAdjusted` ist für eine ausgeknockte Barrier mit Rebate nicht 0.** Nach dem Knock ist `premiumPerUnit` = Rebate·DF (bzw. Rebate bei `hit`) und `spotDelta` 0 → PA-Delta = −Rebate·DF/S. Probe: UpOut 1,15 Rebate 0,01 bei Spot 1,15: `deltaPct` 0, **`deltaPremiumAdjusted` −0,008546** (Default/`expiry`) bzw. −0,008696 (`hit`) – die Doku im Code und im API-Schema verspricht 0. Für einen Cash-Anspruch in Quote-Währung ist −C/S formal das PA-Delta, aber keine Hedge-Kennzahl der (nicht mehr existierenden) Option; ein Anwender, der nach PA-Delta hedgt, sähe eine Position von −85 k EUR auf einem abgewickelten Rebate. | Bei `greeksMethod: "settled-payoff"` (und Vanilla ohne Optionalität) `deltaPremiumAdjusted = 0` setzen oder die Doku auf „= −Rebate·DF/S für Rebate-Ansprüche" ändern; Test: knocked-out → 0. |

**Ohne Abzug, aber dokumentierenswert (bewusste Näherungen, korrekt gekennzeichnet oder ohne praktische Wirkung):**
- **FX-Forward-CVA, Trapez über einen Cash-Sprung:** bei einer am Grid-Termin (30 d) fälligen Prämie halbiert das Trapez das Gewicht der Forderung (erhaltene 2 Mio. USD: CVA 1.392,51; exakt ≈ 547 + 2 Mio.·PD(30 d)·LGD ≈ 2.500) – Grid ist monatlich, Effekt nur bei Fee ≫ Forward-Exposure.
- **`rebateAt: "hit"` ohne Flag:** Spot jenseits der Barrier zahlt „heute" (DF 1) und morgen erneut, bis `hit: true` gesetzt ist; die `BARRIER_STATE_UNKNOWN:`-Warnung fordert das Flag an, Theta 0,00. Korrekt unter der Konvention, aber ein Prozessrisiko (Flag-Pflege) – Dimension 4.
- **Berichtstext Par-Satz:** Methodikzeile „Par-Satz und fairer Spread analytisch aus der Annuität" nennt nicht, dass die Prämie ausgenommen ist und `parRateAllIn` die All-in-Sicht liefert (im Web-Metrikblock beschriftet).
- **CHANGELOG N8-6:** „|RR|/|BF| > 50 % des ATM" vs Code absolute 50 Vol-Punkte – Dimension 6.
- **US-Kalender = QL `Settlement`** (100/100), `DE` enthält den 31.12. (kein Währungskalender, nicht im Golden, im Bericht nicht genannt – korrekt), PL 24.12. ab 2025 als dokumentierter `knownEngineOnly`.
- **Unverändert aus R4–R8 (ohne Abzug):** Cash-Settlement-IRR mit `n = round(T·m)`, Futures-Konvexität als Input, CDS-Quartalsmittelpunkt (QL-Abstand 2,5·10⁻⁴ in Q), Basis-Swap-CVA 20-%-Spread-Vol-Proxy, `ene = 0` für Long-Optionen mit offener Prämie, Collar ohne `floorStrike`, FX-Reset-`fixingLag`, Normal-/Lognormal-SABR-Hinweis, `vegaUnit`, SABR-Fallback-Hinweis, Identitäts-Cache der Vol-Guards, €STR-Historie ab 02.01.2026, Hazard flach vs. Kurve (+0,3 %).

---

## 4. Verifizierte Positivbefunde Runde 9 (QuantLib-Cross-Checks und Invarianten)

| Bereich | Nachweis (Anhang A/B) |
|---|---|
| Tageszählungen, Schedules, SABR, Barriers, Digitals, GK-Greeks, CDS, OLS vs. QuantLib 1.43 | `probe-r7-dump.mjs` + `ql-compare-r5b.py`: Ausgabe **byteidentisch zu Runde 8 und 7** (`diff` leer) – 7 × 10 Tageszählungen ≤ 5,6·10⁻¹⁷, 9 Schedules identisch, SABR ≤ 4,4·10⁻¹⁵, 72 Barriers ≤ 3,9·10⁻¹⁶, Digitals ≤ 1,1·10⁻¹⁵, GK-Greeks ≤ 4,9·10⁻¹⁵, CDS ΔQ ≤ 2,5·10⁻⁴, OLS = numpy – keine Regression durch den Runde-8-Diff |
| Kalender vs. QuantLib 2024–2032 (Werktagsfeiertage) | **TARGET 46/46, US 100/100 (`Settlement`), US-SIFMA 106/106 (`SOFR`), UK 72/72, CH 77/77, JP 154/154, NO 85/85, SE 92/92, DK 97/97 identisch; PL 77 gemeinsam + 7 Engine-eigene 24.12.** – alle zehn im Golden `calendars-quantlib.json`, Berichtstext aus derselben Liste |
| RFR-Compounding vs. QuantLib `OvernightIndexedCoupon` | Lookback 1/2 auf `US-SIFMA` **bitgenau** (Diff +0,0000 bp); Lockout-Mechanik korrekt, Zählung → N9-1 |
| Par-Größen mit Prämie | 9 Swap-Typen: `parRate`/`fairSpread` Δ 0,000 bp, Par-Check 0,00, All-in-Check 0,00 (Anhang A) |
| CVA mit Prämie | Vanilla/Zinstreppe/IMM/OIS: CVA mit Fee am Spot = ohne Fee (0,00 %), Profile t > 0 identisch; FX-Forward alle Zweige (Fee vor/am/nach Grid, `kEff ≤ 0`, Buy/Sell); CCS/MtM-CCS über `cvaGeneric` −0,01 %/−0,31 %; Rest → N9-2 |
| Prämien-Leg / Warnungen | `COLLATERAL_CURVE_MISSING` nur bei Diskontbedarf; Portfolio-Report mit sechs Fee-Trades (IRS, amortisierend USD-Fee, CCS, MtM-CCS erhaltene USD-Fee, Basis gezahlt, FX-Forward) `failed 0`, PV 5.980,01, Warnungen 0, `fxDelta {USDEUR −98.921,25}` |
| SOFR-/JP-Kalendereffekte | USD-Zahlungstermine unverändert (US), Spot-Daten EURUSD/USDJPY/USDCHF über Karfreitag korrekt, SOFR-Periode ab Karfreitag = manuell, TONA über Golden Week ohne `MISSING_FIXING`, JPY-Schedules/Spot = QL |
| Barrier-Zustandsmaschine | `expiry` und `hit` stetig an der Barrier (Sprung ≤ 0,55 = 1-Tages-Effekt), KO(`expiry`) + KI = Vanilla + R·N·DF exakt, DownOut-Put analog, `analytics.rebateAt`, Enum-Validierung |
| Validierung | Leg-Währung = Index-Währung: keine Fehlalarme auf 9 Swap-Typen, Swaption, GBP-Cap (SONIA), CZK-Leg mit registriertem `PRIBOR-6M` (`[]`, danach erwartetes `NO_DISCOUNT_CURVE`); USD-Leg auf `ESTR` wird genannt |
| Vol-Plausibilität | zehn Beispiel-FX-Flächen + IR-Flächen `[]`, EM-/JPY-Smiles `[]`, negativer BF `[]`, Grenzfall RR = 2·(ATM + BF) erkannt, Skalierungsfehler (`bf25` 500 %, `rr25` ±30/50 %) erkannt und im Pricer abgewiesen |
| Web-Beispielbuch (13 Trades) | 13/13 bewertet, **0 `MISSING_FIXING`**, 0 Warnungen, Portfolio-Report `failed 0`, **PV 13.936,16, DV01 18.382,34, Theta −1.031,22 – identisch zu R8/R7** (SOFR-/JP-Kalenderwechsel ohne Wirkung auf das Buch, `IRS-USD-01` −12.886,09) |
| Tests | 421 / 421 grün (29 Dateien, 18,8 s); `review-r8.test.ts` deckt N8-1…N8-7, N7-5, Markt R8-1, Register-Validatoren und PA-Delta mit den R8-Reviewer-Zahlen ab, `golden.test.ts` alle zehn Kalender |

---

## 5. Was für 100 noch fehlt

1. **N9-1** Lockout-Zählung wie QuantLib/ISDA (letzte k Fixings ← Fixing des Tages vor dem Fenster); Golden gegen `ql.OvernightIndexedCoupon(lockoutDays)`; `lockoutDays: 1` muss wirken.
2. **N9-2** Grid-Punkt am Prämientermin in `cvaSwap`/`cvaBasisSwap` (Strike-Shift bis dahin wie `cvaGeneric`); Test: Fee am Spot → CVA = ohne Fee ± 0,1 % auf allen Swap-Typen, Payer und Receiver.
3. **N9-3** `deltaPremiumAdjusted = 0` bei `settled-payoff` (oder Doku anpassen).
4. **N7-5 Rest** Default-Konvention: `rebateAt` in `makeFxOption`/Schnelleingabe/CSV vorbelegen (Vorschlag `"hit"` = QuantLib) oder die Mischung als Deprecation mit Warnung kennzeichnen.
5. Ohne Abzug: Berichtssatz „Par-Satz … ohne Prämie, All-in separat", CHANGELOG-Text zur Smile-Grenze, FX-Forward-CVA-Grid um den Prämientermin, PA-Delta-Hedge-Hinweis, FX-Reset-`fixingLag`, Normal-/Lognormal-SABR-Hinweis, Collar-`floorStrike`, `vegaUnit`, SABR-Fallback-Hinweis, Mutations-Erkennung der Vol-Caches, €STR-Historie vor 2026.

---

## Anhang A – Probe-Ergebnisse (Auszug, Bewertungstag 03.09.2026, Sample-Markt, `dist` 04.09. 10:47 UTC)

```
tests: 29 files, 421/421 passed, 18.83 s
r8a/r8b rerun vs R8 output – only expected changes:
  N8-1: IRS 10Y payer fee 100k at spot: parRate 2.8800 % (Δ 0.00 bp) fairSpread 0.1175 % CVA 24,666.14 (Δ 0.00)  (R8: 2.7651 %, 19,840.02)
        fee 500k in 1Y: 2.8800 % CVA 24,666.14 (R8: 2.3176 %, 8,486.93) ; receiver fee −200k: parRate 2.8800 → 2.8800 % ; CVA 21,362.70 → 22,563.40 (R8: 33,451.98)
        basis 5Y + 100k fee: fairSpread −0.0784 → −0.0784 % ; CVA 2,808.61 → 2,550.39 (R8: 293.64) ; remaining swap +3Y parRate 3.0806 % = without fee
  N8-2: FxForward + 50k USD fee 30 d: PV 98,238.77 CVA 525.96 (no fee 547.09) profile[0].epe 98,238.77 (R8: 141,131.80) method "GK forward-exposure (open premium netted)"
  N8-3: EUR IRS EUR CSA + USD/GBP/NOK fee paid 30 d ago → warnings [] (R8: COLLATERAL_CURVE_MISSING ×3) ; unpaid USD fee 1Y still warns
  N8-4: SOFR OIS 2Y from 15.01.2026, real history without 03.04.2026: PV −66,221.36 warnings [] (R8: MISSING_FIXING, −66,863.17) ; fictitious GF fixing ignored (−66,221.36 vs R8 −66,220.92)
  N8-5: JP 2026-05-06 / 2026-09-22 / 2027-03-22 / 2028-09-22 / 2031-03-21 / 2032-09-22 / 2024-05-06 / 2025-05-06 holiday ; 2031-03-20 / 2032-09-23 business day
        USDJPY spot 01.05.2026 → 08.05. ; 18.09.2026 → 25.09. ; JPY 6M schedule 06.11.2025 → ends 07.05.2026 (all = QL/JPX)
  N8-6: rr25 = 30 %: volSurfaceWarnings 8× VOL_IMPLAUSIBLE "25Δ put pillar vol at 1W is −7.75 % (ATM 7.10 % + BF 0.15 % − RR 30.00 %/2) …" ; put K 1.20 → INVALID_VOL_SURFACE (R8: vol 10.81 % silently)
        bf25 = 500 %: 8× "butterfly 500.00 % exceeds 50.00 %" ; rr25 = −50 %: 8 warnings + INVALID_VOL_SURFACE
probe-r9a A (parRate invariance / par check, fee 100k at spot, 9 swap types):
  vanilla    PV −104,453.86 parRate 2.8800 % | +fee Δ 0.000 bp parRateAllIn 2.7651 % | par check 0.00 | all-in check 0.00
  stepUp     PV  −71,723.68 parRate 1.8462 % | Δ 0.000 bp allIn 1.6317 % | par check 0.00 flat 0.00 | all-in 0.00
  amortising PV  150,927.71 parRate 2.6451 % | Δ 0.000 bp allIn 2.8802 % | par check −0.00 | all-in −0.00
  imm (USD)  PV −179,731.05 parRate 3.2684 % | Δ 0.000 bp allIn 2.9183 % | par check 0.00 | all-in −0.00
  ois SOFR   PV −264,923.19 parRate 3.3300 % | Δ 0.000 bp allIn 3.1125 % | par check 0.00 | all-in 0.00
  basis      PV   84,884.72 fairSpread −0.0784 % | Δ 0.000 bp allIn 0.1317 % | par check −0.00 | all-in 0.00
  ccsFixed   PV  342,373.53 parRate 2.2693 % | Δ 0.000 bp allIn 2.4827 % | par check −0.00 | all-in 0.00
  ccsFloat   PV    9,586.80 fairSpread −0.2200 % | Δ 0.000 bp allIn −0.0114 % | par check −0.00 | all-in 0.00
  ccsMtm     PV    9,559.62 fairSpread −0.2199 % | Δ 0.000 bp allIn −0.0114 % | par check −0.00 | all-in 0.00
probe-r9a B (CVA with fee at spot): vanilla 24,666.14 = 24,666.14 ; stepUp 5,980.80 = ; imm 507.41 = ; ois 2,500.78 = ; points t>0 identical true
  amortising 6,748.38 → 6,148.03 (−8.90 %) EPE0 50,950.04 = max(PV,0) ; basis 2,808.61 → 2,550.39 (−9.19 %) ; ccsFixed 44,056.39 → 44,049.82 (−0.01 %) ; ccsMtm 799.52 → 797.02   ← N9-2
  FxForward −2M USD received 30 d (kEff ≤ 0): PV 1,856,853.06 EPE0 1,856,853.06 CVA 1,392.51 ; +20M paid: ENE0 17,016,080.82 ; sell-EUR side identical
  FxForward 2Y + 500k USD fee 200 d: profile shifted until 2027-03-02, identical from 2027-04-01 ; CVA 8,858.62 vs 10,463.51
probe-r9c: amortising receiver fee at spot 6,148.03 | fee tomorrow 6,147.93 | fee in 360 d 6,160.23 ; 0.5·ΔEPE0·PD1·LGD = 600.35 = CVA difference 600.35 ; first grid 2027-09-07
  CCS fixed cvaGeneric + fee: grid point 2026-09-07 added, only t=0 differs (Δ −99,977.67)
probe-r9a C: portfolio report 6 fee trades: failed 0 pv 5,980.01 dv01 4,507.73 theta −664.43 fxDelta {USDEUR −98,921.25} warnings 0
probe-r9a D: USD OIS legs calendar US/US ; accrual ends 2026-04-06, 2026-07-06, 2026-10-05, 2027-01-05 ; EURUSD spot 01.04.2026 → 07.04. ; USDJPY → 03.04. ; USDCHF → 07.04.
  getIndex(SOFR) fixingCalendar US-SIFMA paymentCalendar US ; SOFR period 03.04.→04.05.2026 (starts Good Friday), SIFMA-only fixings, policy throw: engine 4.3308 % = manual 4.3308 % (0.00e+0 bp)
  TONA period 20.04.→20.05.2026 with JPX-only fixings: OK
probe-r9a E: rebate·N 100,000.00 ; rebate·N·DF(delivery) 98,283.05
  rebateAt undefined: live@1.149999 99,999.45 | spot 1.15 98,283.05 (jump −1,716.40) | hit:true 98,283.05 | expired beyond 99,990.14 | analytics.rebateAt default
  rebateAt hit      : 99,999.45 | 100,000.00 (jump 0.55) | 1.17 100,000.00 | hit:true 0.00 | expired beyond 0.00 | theta knocked 0.00
  rebateAt expiry   : 98,282.54 | 98,283.05 (jump 0.51) | hit:true 98,283.05 | expired beyond 99,990.14 | live theta/day 9.35
  parity @1.10: KO(expiry) 68,633.02 + KI 298,115.97 = 366,748.99 = vanilla 268,465.94 + R·N·DF 98,283.05 (diff 0.0000) ; KO(hit) 69,031.08 = KO(default) ; KO(hit) − KO(expiry) 398.06
  DownOut put 1.12 reb .02: expiry 196,565.36 → 196,566.10 | hit 199,999.18 → 200,000.00 | default 199,999.18 → 196,566.10 ; rebateAt "touch" → INVALID_TRADE
  deltaPremiumAdjusted knocked-out: −0.008546 (default/expiry) −0.008696 (hit), deltaPct 0   ← N9-3
probe-r9a F: validateTrade [] for all 9 swap types, swaption, GBP cap (SONIA) ; CZK swap with registered PRIBOR-6M [] → NO_DISCOUNT_CURVE CZK (expected) ; CCS USD leg on ESTR → "currency USD does not match the currency EUR of index ESTR"
probe-r9a G: sample surfaces volSurfaceWarnings [] validateMarket [] ; EM steep [] ; JPY-like [] ; boundary RR = 2·(ATM+BF) → "25Δ put pillar vol at 1Y is 0.00 %" ; RR 0.16 [] ; BF −0.2 % []
probe-r9a H: call K 1.15 1Y deltaPct 0.619032 deltaPremiumAdjusted 0.576682 = deltaPct − PV/(N·S) ; sold −0.576682
probe-r9a I: 2Y SOFR swap 100 Mio.: lockoutDays 0 PV −1,159,642.15 = lockoutDays 1 −1,159,642.15 ; k=2 −1,159,646.91 ; k=3 −1,159,644.67   ← N9-1
probe-r8-book (web sample book, 13 trades): missing-fixing 0 ; failed 0 pv 13,936.16 dv01 18,382.34 theta −1,031.22 fxDelta {USDEUR 30,946.95, GBPEUR −14,801.69, CHFEUR −4,956.71} warnings 0 (= R8)
```

## Anhang B – QuantLib-Cross-Checks (QuantLib 1.43, `PYTHONPATH=…/pyql`)

```
ql-compare-r5b.py (probe-r7-dump.mjs): output identical to round 8 and 7 (diff empty)
  A day counts max |diff| 5.55e-17 ; B schedules 9/9 IDENTICAL ; C SABR 4.44e-15 ; D barriers 72 cases 3.89e-16 ; E digitals 1.11e-15 ; F GK greeks 4.9e-15 ; G CDS ΔQ ≤ 2.47e-4 ; H OLS = numpy
ql-calendars-r9.py (weekday holidays 2024–2032, engine vs QL):
  TARGET 46/46 ; US = UnitedStates(Settlement) 100/100 ; US-SIFMA = UnitedStates(SOFR) 106/106 ; UK 72/72 ; CH 77/77 ; JP = Japan 154/154 (R8: 143 common, 11 QL-only, 2 engine-only) ; NO 85/85 ; SE 92/92 ; DK 97/97 ; PL 77 common + engine-only 24.12. 2025–2032 (documented)
ql-lockout-r9.py / ql-lockout-r9b.py (SOFR period 01.06.–03.08.2026, fixings 4.00 % + 0.02 %·((d−start) mod 7), ql.Sofr() with identical fixings, OvernightIndexedCoupon ACT/360):
  lookbackDays 1: QL 4.05480526 % engine 4.05480526 % (+0.0000 bp) ; lookbackDays 2: QL 4.04617640 % engine 4.04617640 % (+0.0000 bp)
  lockoutDays 0: QL 4.06343422 % = engine k=0 = engine k=1 (4.06343422 %)                         ← engine k=1 has no effect
  lockoutDays 1: QL 4.06247539 % (fixing dates … 29.07, 30.07, 30.07) = engine k=2
  lockoutDays 2: QL 4.06119688 % (fixing dates … 28.07, 29.07, 29.07, 29.07) = engine k=3
  lockoutDays 3: QL 4.05959870 % (… 28.07 ×4) = engine k=4 (engine k=5 4.05768083 %, QL k=4 not run with explicit lookback 0)
  manual "last k fixing days ← fixing of the day before the window": k=1 4.06247539 %, k=2 4.06119688 %, k=3 4.05959870 % = QuantLib
```

Probe-Skripte: `probe-r9a.mjs`, `probe-r9b.mjs`, `probe-r9c.mjs`, `probe-r9-lockout.mjs` + `ql-lockout-r9.py`/`ql-lockout-r9b.py`, `probe-r9-cal-dump.mjs` + `ql-calendars-r9.py` (neu), `probe-r8a.mjs`/`probe-r8b.mjs` (Rerun, Diff gegen R8-Ausgabe), `probe-r7-dump.mjs` + `ql-compare-r5b.py` (Rerun, Diff gegen R8-Ausgabe), `probe-r8-book.mts` (Rerun) im Review-Scratchpad; alle Zahlen des Hauptteils daraus reproduziert.
