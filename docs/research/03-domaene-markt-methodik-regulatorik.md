# Domain-Briefing: Bewertung von Zins- und FX-Derivaten

**Zielgruppe:** Software-Team, das eine moderne Bewertungsplattform für Zins- und Währungsderivate (Fokus DACH) baut.
**Stand:** September 2026. Kennzeichnung: **[Q]** = per Webrecherche bestätigt (Quellenliste unten), **[E]** = eigene Fach-/Praxiseinschätzung, nicht einzeln belegt. Zahlen ohne exakte Quelle sind als „ca." markiert.

---

## 1. Markt: Größe, Struktur, Nutzer, Bewertungsbedarf

### 1.1 Marktgröße (BIS)

| Kennzahl | Wert | Stand | Quelle |
|---|---|---|---|
| Nominal OTC-Derivate gesamt | ca. 846 Bio. USD (+16 % yoy) | Ende Juni 2025 | BIS OTC-Statistik [Q] |
| Anteil Zinsderivate (IRD) am Nominal | ca. 79 % | Ende Juni 2025 | BIS [Q] |
| Nominal FX-Derivate | ca. 155 Bio. USD, davon ca. 100 Bio. Forwards/Swaps < 1 Jahr | Ende Juni 2025 | BIS [Q] |
| Brutto-Marktwert OTC gesamt | ca. 21,8 Bio. USD (+29 % yoy) | Ende Juni 2025 | BIS [Q] |
| EUR-IRD: Nominal und Brutto-Marktwert | jeweils +24 % yoy – stärkster Treiber des Wachstums | Ende Juni 2025 | BIS [Q] |
| Tagesumsatz OTC-Zinsderivate | ca. 7,9 Bio. USD/Tag (+59 % vs. 2022) | April 2025 | BIS Triennial 2025 [Q] |
| davon EUR-Kontrakte | ca. 3,0 Bio. USD/Tag = ca. 38 % (USD: 31 %) – **EUR ist erstmals größtes Segment** | April 2025 | BIS Triennial 2025 [Q] |
| FX-Tagesumsatz (alle Instrumente) | ca. 9,6 Bio. USD/Tag (+28 %); USD auf einer Seite von 89 %, EUR 28,9 % | April 2025 | BIS Triennial 2025 [Q] |

Hinweis [Q]: Die April-2025-Umsätze sind durch die Volatilität rund um den 2. April 2025 („Liberation Day"-Zölle) nach oben verzerrt; BIS und Banque de France weisen darauf hin. Ende-2025-Bestandsdaten (Publikation Mitte 2026) konnte ich nicht abrufen – bis.org ist aus dieser Umgebung nicht erreichbar; die obigen Zahlen stammen aus Suchtreffern der BIS-Veröffentlichung vom 8.12.2025.

**Fazit für die Plattform [E]:** EUR-Zinsderivate sind heute das weltweit liquideste Segment; ein Euro-zentrierter Bewertungskern (€STR/EURIBOR) ist kein Nischenprodukt, sondern deckt den Kern des Marktes ab. FX-Volumen ist zu über 60 % kurzlaufend (Forwards/FX-Swaps), d. h. Kurvenqualität im kurzen Ende (bis 1 Jahr) und saubere Spot/Forward-Konventionen sind wichtiger als exotische Modelle.

### 1.2 Typische Nutzer in Deutschland und ihr Bewertungsbedarf

| Nutzergruppe | Typische Instrumente | Primärer Bewertungsbedarf |
|---|---|---|
| **Sparkassen, Genossenschaftsbanken** (Verbund: Landesbanken/Helaba/LBBW/BayernLB bzw. DZ BANK als Kontrahent) [E] | Payer-Swaps zur Zinsbuchsteuerung, Caps/Floors, Swaptions; Kundengeschäft in Zins- und FX-Derivaten mit Durchleitung an die Zentralinstitute | Unabhängige Preisverifizierung (IPV) gegen Zentralinstitut, HGB-Bewertungseinheiten (§ 254 HGB / IDW RS HFA 35), MaRisk-konforme Modellvalidierung, EMIR-Bewertungsmeldung, Marge/Beratungsdokumentation im Kundengeschäft |
| **Landesbanken, Großbanken** | Volles Spektrum inkl. Strukturen, Cross-Currency, Exoten | XVA, Prudent Valuation (AVA), IFRS 13 Level-Einstufung, SIMM, Front-to-Risk-Konsistenz |
| **Mittelstand (Corporates)** | Zinsswaps auf Kredite, Caps, FX-Forwards/Swaps, Optionen, teils Participating Forwards/TARFs | Hedge Accounting (HGB/IFRS 9), unabhängiger Zweitpreis vor Abschluss und zum Bilanzstichtag, CVA-Berücksichtigung im Abschluss, Nachweis „anfänglicher negativer Marktwert" |
| **Kommunen** | Zinsswaps (Payer, teils historische Strukturen wie CMS-Spread-Ladder) | Nach den **BGH-Swap-Urteilen** (XI ZR 33/10 vom 22.03.2011; XI ZR 378/13 vom 28.04.2015) [Q] muss die Bank den **anfänglichen negativen Marktwert** einschließlich seiner **Höhe** offenlegen – bei allen Swaps unabhängig von der Komplexität, Ausnahme nur bei Konnexität zu einem Kreditgeschäft. Kommunen brauchen daher unabhängige Marktwertgutachten und Dokumentation der Einstandsmarge. |
| **Versicherer, Pensionskassen** | Receiver-Swaps, Swaptions (Duration/Konvexität), Inflationsswaps | Solvency II Marktwert, IFRS 17/9, Kollateral-Bewertung, Sensitivitäten für ALM |
| **Asset Manager, KVGen** | IRS, FX-Forwards zur Anteilklassen-Absicherung, Optionen | Tägliche NAV-Bewertung, KARBV/KAGB-Bewertungsrichtlinien, EMIR (auch als FC), PRIIPs/MiFID-Kosten bei Vertrieb |

**Regulatorische/bilanzielle Bewertungsanlässe (Querschnitt):**

- **Independent Price Verification:** Zweitbewertung der Front-Office-Preise durch unabhängige Einheit; in MaRisk (BTO 2, BTR) und für CRR-Institute in der EBA Prudent Valuation verankert [Q/E].
- **Beratungsprotokoll / Geeignetheitserklärung (§ 64 WpHG):** Bei Anlageberatung gegenüber Privatkunden verpflichtend; gegenüber professionellen Kunden erleichtert [Q]. Praktisch fließt der anfängliche Marktwert / die Marge in die Dokumentation ein [E].
- **Hedge Accounting:** HGB § 254 mit IDW RS HFA 35 (Einfrierungs- oder Durchbuchungsmethode, Effektivitätsnachweis) [Q]; IFRS 9 (prospektive Effektivität, hypothetisches Derivat) [E].
- **EMIR-Meldung:** Tägliche Bewertungs- und Sicherheitenmeldung für FC und NFC+ (NFC- ausgenommen) [Q].
- **IFRS 13:** OTC-Derivate sind typischerweise Level 2; signifikante nicht beobachtbare Inputs (z. B. lange Laufzeiten, exotische Vol) führen zu Level 3 [Q]. CVA/DVA sind nach IFRS 13 in den Fair Value einzubeziehen; FVA ist umstritten (entitätsspezifisch vs. Marktpraxis) [Q].
- **MiFID II Kostentransparenz (§ 63 Abs. 7 WpHG):** Ex-ante- und Ex-post-Kostenausweis inkl. Zuwendungen; MiFID Quick Fix (2021) hat Erleichterungen für professionelle Kunden gebracht [Q]. Für OTC-Derivate ist die Marge (Differenz Kundenpreis vs. Mid-Marktwert) der zentrale Kostenbestandteil [E]. **Vorzeichenregel im Bewertungsreport [E]:** Die Kostentransparenz benennt die Perspektive (`perspective: "Bank"` Default oder `"Kunde"`), aus der Barwert und Transaktionspreis angegeben sind (Transaktionspreis > 0 = die genannte Partei zahlt bei Abschluss). Marge der Bank = Barwert − Transaktionspreis aus Banksicht (bzw. Transaktionspreis − Barwert aus Kundensicht); der anfängliche Marktwert aus Kundensicht ist stets −Marge der Bank und wird als Betrag, in bp und in % des Nominals (und des Transaktionspreises) ausgewiesen (Art. 50 Abs. 2 DelVO 2017/565).
- **IFRS 13 / IDW RS HFA 35 – Bewertungsrahmen im Report [E]:** Methodikabschnitt und Feld `governance` (Snapshot-Status indikativ/freigegeben, Marktdatenquellen, Modellversion, Validierer) dokumentieren Bewertungstechnik (Income Approach), Input-Hierarchie und Modellfreigabe (MaRisk AT 4.3.x, BTO 2.2.1). Die Level-Heuristik prüft Extrapolation nur gegen die vom Geschäft tatsächlich genutzten Kurven (Diskontkurve unter dem CSA des Geschäfts, Projektionskurven der referenzierten Indizes) sowie Optionslaufzeit/Tenor gegen das Gitter der genutzten Volatilitätsfläche.
- **PRIIPs KID (Basisinformationsblatt):** OTC-Derivate fallen bei Kleinanlegern in den Anwendungsbereich; Banken stellen KIDs für Zinsswaps, Caps, Devisenoptionen bereit [Q].

---

## 2. Instrumentenabdeckung und Konventionen

### 2.1 Zinsderivate

| Instrument | Bemerkung / Bewertungsansatz [E, Marktstandard] |
|---|---|
| **Plain-Vanilla IRS** fix/float (EURIBOR 3M/6M) | Diskontierung auf €STR-OIS, Forwards aus tenor-spezifischer EURIBOR-Kurve |
| **OIS** (€STR, SOFR, SONIA) | Compounding in Arrears; fixe Seite jährlich (EUR) |
| **Basis-Swaps** (3M vs. 6M, €STR vs. EURIBOR) | Kalibrierinstrument für Tenor-Basis |
| **FRAs** | Am EUR-Markt praktisch tot seit €STR-Umstellung; weiterhin als Kurveninput/Legacy |
| **Caps/Floors/Collars** | Summe von Caplets/Floorlets; Bachelier oder Shifted Black; Put-Call-Parität Cap − Floor = Swap |
| **Swaptions** Payer/Receiver, Cash vs. Physical, Bermudan | Europäisch: Bachelier auf Forward-Swapsatz mit Annuität; EUR-Cash-Settlement seit 2018/2019 „collateralised cash price" statt IRR-Formel [E]; Bermudan: Hull-White 1F / LGM / Markov-Functional, kalibriert an Coterminal-Swaptions |
| **CMS** (Swaps, Caps, Spread-Optionen) | Konvexitätsadjustierung via statischer Replikation über Swaption-Smile (Hagan) |
| **Strukturierte Swaps** (Callable, Range Accrual) | Kurz: Short-Rate-Modell/Baum oder Monte Carlo; im v1 nicht empfohlen |

### 2.2 FX-Derivate

| Instrument | Bemerkung [E] |
|---|---|
| **FX Forward / NDF** | Diskontierte Differenz Forward vs. Kontraktkurs; NDF mit Fixing-Quelle (z. B. WM/Refinitiv) |
| **FX Swap** | Near/Far Leg; Swap-Punkte enthalten Cross-Currency-Basis |
| **Cross-Currency Swap (MtM-Resetting)** | USD-Nominal wird i. d. R. quartalsweise an den Spot angepasst und Differenz cash-gesettelt [Q]; Bewertung: jede Seite auf eigener kollateral-konsistenter Kurve, Basis-Spread auf Nicht-USD-Leg [Q] |
| **FX Vanilla-Option** | Garman-Kohlhagen; Quotierung in Vol |
| **Barrier/Digital** | Analytisch (Reiner-Rubinstein) oder Vanna-Volga-Adjustierung; Digitals als Call-Spread-Replikation |
| **Strukturiertes FX** (Participating Forward, TARF, Accumulator) | Kurz: Zerlegung in Vanillas (Participating Forward) bzw. Pfadabhängigkeit → Monte Carlo (TARF/Accumulator). TARFs gelten in der Fachpresse als hochriskante Produkte mit hohem Verlustpotenzial für Corporates [Q]; hoher Bedarf an unabhängiger Bewertung, aber nicht für v1. |

### 2.3 Konventionen, die ein Bewertungskern korrekt abbilden muss [E, Standard nach ISDA-Definitionen]

- **Day-Count:** ACT/360 (EURIBOR-, €STR-Floating-Legs, USD), 30/360 bzw. 30E/360 (EUR-Fixleg), ACT/ACT ISDA (Anleihen, Swaps in GBP-Kontext), ACT/365F (GBP/SONIA).
- **Business-Day-Conventions:** Following, Modified Following (Standard EUR-Swaps), Preceding; End-of-Month-Regel.
- **Kalender:** TARGET2 (EUR-Zahlungen); für FX Kombinationskalender beider Währungen plus USD-Kalender für Spot-Datum (T+2, außer z. B. USD/CAD T+1).
- **Fixing-Lag:** EURIBOR wird zwei TARGET-Tage vor Periodenbeginn gefixt (T−2); Veröffentlichung um oder kurz nach 11:00 CET für 1W, 1M, 3M, 6M, 12M [Q].
- **€STR:** Veröffentlichung um 08:00 CET am Folgetag (T+1) durch die EZB; volumengewichtetes getrimmtes Mittel (je 25 % oben/unten entfernt); Compounded-Averages und Index um 09:15 CET [Q].
- **RFR-Compounding in Arrears:** ISDA-2021-Definitionen bieten modulare Varianten: Standard-OIS-Compounding, **Lookback** (Beobachtung k Tage früher, Gewichtung nach Zahlungsperiode), **Observation Period Shift** (Beobachtung und Gewichtung verschoben), **Lockout**, **Payment Delay** (Zahlung z. B. 2 Tage nach Periodenende) [Q]. EURIBOR-Fallbacks basieren auf €STR compounded in arrears mit **2-Tage-Lookback** plus Spread-Adjustierung [Q].
- **Stub-Perioden**, **IMM-Daten**, **Roll-Konventionen** und **Zahlungs- vs. Accrual-Datum** müssen getrennt modelliert werden.

---

## 3. Methodik: State of the Art

### 3.1 Multi-Curve-Framework

Seit 2008 sind Diskontierung und Forward-Projektion getrennt: **eine Diskontkurve** (OIS, für EUR: €STR – als bester Proxy für den risikofreien Satz und als Kollateralverzinsung unter CSA) und **je eine Forward-Kurve pro Tenor** (EURIBOR 3M, 6M) [Q]. Der Wechsel EONIA → €STR hat Par-Sätze und implizite Forwards nur vernachlässigbar verändert [Q]. Referenz: Ametrano/Bianchetti (2013, SSRN) – mit Open-Source-Implementierung in QuantLib [Q].

**Bootstrapping [E]:** Diskontkurve aus €STR-OIS (Deposit O/N, OIS 1W…50Y); Forward-Kurven aus Deposit/FRA/Futures (kurzes Ende) und Swaps (langes Ende) unter exogener OIS-Diskontierung; Tenor-Basis aus Basis-Swaps. Globales Solving (simultanes Lösen) ist robuster als sequenzielles Bootstrapping, insbesondere bei Kurven mit Turn-of-Year-Effekten.

**Interpolation [Q/E]:** Marktstandard ist log-linear auf Diskontfaktoren (= stückweise konstante Forward-Rates; stabil, aber „sägezahn"-Forwards) oder **Monotone Convex (Hagan/West 2006)** für glatte, arbitragefreie Forwards. Kubische Splines auf Zinsen erzeugen unerwünschte Oszillationen und nicht-lokale Sensitivitäten.

**Kollateralisierung/CSA [E]:** Kollateralisierte Trades werden mit der Kurve der Kollateralwährung diskontiert (EUR-Cash-CSA → €STR); bei Multi-Currency-CSA „cheapest-to-deliver"-Kurve; unkollateralisierte Trades (typisch Mittelstand/Kommunen) benötigen Funding-Kurve plus CVA/DVA/FVA. Für Cross-Currency-Swaps gilt: USD-Kollateral → USD-SOFR-Diskontierung auf beiden Legs, EUR-Leg über €STR-basierte, basis-adjustierte Kurve [Q].

### 3.2 Optionsmodelle Zinsen

- **Black-76** (lognormal) versagt bei Zinsen ≤ 0. Seit ca. 2012 wurden **Shifted Black** (Verschiebung z. B. +1 %…+3 %) und **Bachelier/Normal** zum Marktstandard; QuantLib implementiert beide, Swaption-Cubes erben die Shift-Struktur ihrer ATM-Matrix [Q]. Normal-Vols (in bp) sind heute die Quotierungskonvention für EUR-Swaptions und Caps [Q/E].
- **SABR** (Hagan et al.) mit Hagan-Approximation ist das verbreitetste Smile-Modell für Caps/Floors/Swaptions; für negative Rates **Shifted SABR** oder **Normal SABR** (β = 0); Shifted SABR mit vorab fixiertem Shift kalibriert am besten, hat aber eine degenerierte Dichte an der unteren Grenze [Q]. Für v1 reicht Interpolation der Normal-Vol im Strike (SABR erst für CMS/Bermudans erforderlich) [E].
- **Bermudan Swaptions:** Hull-White 1F (analytisch kalibrierbar), G2++, Markov-Functional; QuantLib-Beispiel „BermudanSwaption" kalibriert HW und Black-Karasinski an ATM/OTM/ITM-Swaptions [Q].

### 3.3 FX

- **Garman-Kohlhagen** ist die Quotierungsbasis; Preise werden in Vols kommuniziert [Q]. Formel: C = S·e^(−r_f T)·N(d1) − K·e^(−r_d T)·N(d2).
- **Vol-Surface:** Quotiert als ATM (Delta-neutral Straddle oder ATM-Forward), **Risk Reversal** (25Δ/10Δ) und **Butterfly** (Strangle-Margin). Kritisch sind **Delta-Konventionen**: Spot-Delta vs. Forward-Delta, **premium-adjusted** (typisch bei Paaren mit Prämie in Fremdwährung, z. B. USD/JPY) – premium-adjusted Call-Delta ist nicht monoton im Strike, sodass die Strike-Rückrechnung mehrdeutig sein kann [Q]. Standardwerke: Clark (2011), Wystup (2006/2017), Reiswich/Wystup (2010) [Q].
- **Smile-Interpolation:** Vanna-Volga (einfach, marktnah) oder SABR/SVI; arbitragefreie Konstruktion ist Forschungs- und Praxisthema [Q].
- **Umsetzung in `@deriva/pricing-core` [E]:** Smile-Koordinate ist das unadjustierte Forward-Put-Delta des Strikes (monoton im Strike unter jeder Konvention); Delta-Konventionen Spot, Forward, Premium-Adjusted Spot und Premium-Adjusted Forward (JPY-Crosses, Laufzeiten > 1Y) mit Fixpunkt-Iteration Strike↔Delta (PA-Call auf dem rechten Ast); Butterflies wahlweise als Smile-Strangle (Default) oder **Broker-Strangle** (Reiswich/Wystup 2010: die 25Δ-Strikes werden mit der Ein-Vol σ_ATM + BF gesetzt, die smile-konsistente Strangle-Marge wird so iteriert, dass der Smile diesen Strangle repriziert; 10Δ-Quotes werden als Smile-Strangle gelesen); Interpolation linear oder monoton-kubisch (Fritsch–Carlson) mit flacher Extrapolation jenseits der 10Δ-Pillars. Barrieren (Reiner–Rubinstein) diskontieren auf das Lieferdatum und nutzen den Lieferdatums-Forward (Raten auf den Expiry-Horizont skaliert), sodass In + Out = Vanilla auch mit Settlement-Lag exakt gilt; Greeks von Barrieren/Digitals per zentralen finiten Differenzen.

### 3.4 Sensitivitäten, Szenarien, XVA

- **Greeks [E]:** DV01/PV01 (parallel), **Bucketed Key-Rate** (Bump je Marktquote, „Jacobian"-Rückrechnung auf Par-Instrumente), Vega je Expiry/Tenor, Gamma, FX-Delta (Spot/Forward), Theta. Algorithmisches Differenzieren (AAD) ist State of the Art, Bump-and-Revalue reicht für v1.
- **Umsetzung Sensitivitäten [E]:** Zero-Buckets je Pillar und Par-Risiko je Marktquote (Re-Bootstrap aller abhängigen Kurven; portfolioweit über `parRiskPortfolio`, das jeden gebumpten Kurvensatz einmal baut), Vega je Expiry-Zeile oder Expiry × Tenor (Swaption-Cube) sowie für eingebettete Caps/Floors in Swap-Legs (Feature-Erkennung, nicht Trade-Typ), Theta als Constant-Curve-Roll mit Carry/Roll-Down-Zerlegung.
- **FX-Delta-Konvention im Core [E]:** `analytics.deltaAmount` ist ein Geldbetrag – Barwertänderung in der Reporting-Währung bei +1 % Spot der Basiswährung (FX-Option: Basis des Paars; Forward/FX-Swap: Kaufwährung des (Near-)Legs), für lineare Geschäfte ±Barwert des Legs in der bewegten Währung × 1 %. `analytics.deltaPct` gibt es nur für FX-Optionen: das vorzeichenbehaftete Spot-Delta als Anteil des Nominals (= deltaAmount / (1 % des Nominals in Reporting-Währung), Long Call ≈ +0,5 am Geld, Vanillas in [−1, 1]). `RiskReport.fxDelta` folgt derselben Geldbetrags-Konvention (zentrale Differenz ±1 % Spot). FX-Vega-Buckets bumpen je Expiry-Zeile der ATM/RR/BF-Fläche das ATM um +1 Vol-Punkt (Summe ≈ paralleles Vega bis auf Varianz-Interpolation zwischen den Expiries), optional RR25/BF25 als separate Smile-Buckets.
- **Szenarioanalyse:** Parallel ±100/200 bp, Steepener/Flattener, EBA/BCBS-IRRBB-Szenarien, historische Stress-Tage. Für Hedge-Effektivitätstests bei Index-Mismatch (3M-Kredit vs. 6M-Swap, €STR vs. EURIBOR) zusätzlich Basis-Szenarien: einzelne Projektionskurven ±10/±25 bp (Tenor-Basis) und Diskontkurve ±25 bp (OIS-Basis), da Parallelschocks die Basis als Quelle von Ineffektivität konstruktionsbedingt verbergen (IFRS 9 B6.4.14, IDW RS HFA 35 Tz. 51).
- **CVA/DVA/FVA [Q/E]:** CVA = LGD · Σ EE(t_i)·ΔPD(t_i)·DF(t_i) mit erwarteten Exposures aus Monte Carlo (Hull-White für Zinsen, GBM/FX). Für Vanilla-IRS gibt es semi-analytische Näherungen (Swaption-Replikation). IFRS 13 verlangt Einbezug des Kontrahentenrisikos; CVA/DVA beeinflussen Hedge-Effektivität [Q].
- **ISDA SIMM [Q]:** Sensitivitätsbasiertes Initial-Margin-Modell für nicht geclearte Derivate; seit 2025 **halbjährliche Rekalibrierung** – v2.7+2412 (gültig ab 12.07.2025), v2.8+2506 (ab 06.12.2025), v2.8+2512 (ab 11.07.2026). Für die Plattform relevant ist die **CRIF-Sensitivitätsausgabe** (Delta/Vega je Risikoklasse/Bucket), nicht das IM-Modell selbst [E].

### 3.5 Referenzdaten und Benchmark-Reform

| Quelle | Inhalt [Q/E] |
|---|---|
| **EZB** | €STR (08:00 CET, T+1), Compounded Averages/Index (09:15 CET) [Q] |
| **EMMI** | EURIBOR 1W/1M/3M/6M/12M (ca. 11:00 CET), **EFTERM** (forward-looking Term-€STR, Fallback für EURIBOR; Bloomberg SEF ab 15.10.2025 zusätzlicher Datenlieferant) [Q] |
| **LSEG (Refinitiv)** | Swap-Kurven, Vol-Surfaces, **Refinitiv Term €STR** (Tradeweb-Quotes + LCH-Trades) [Q] |
| **Bloomberg** | BVAL-Kurven, Swaption-Cubes, FX-Vols [Q] |
| **ICE** | Swap-Rate-Fixings (ICE Swap Rate, u. a. für CMS/Cash-Settlement), Kurven [E] |
| **SIX** | Referenz-/Stammdaten, FX-Fixings, insbesondere für CH-Markt [E] |
| **CME/LCH/Eurex** | Cleared-Kurven als IPV-Benchmark [E] |

**Benchmark-Reform-Status [Q]:** LIBOR ist vollständig eingestellt (letzte synthetische USD-LIBOR-Sätze endeten 30.09.2024) [E]. **EURIBOR wird nicht eingestellt**, wurde aber auf eine transaktionsbasierte Hybrid-Methodik umgestellt (2019) und 2023/2024 weiterentwickelt (Wegfall des Expert-Judgement-Levels). Robuste Fallbacks (€STR compounded + Spread) werden empfohlen; EFTERM ist der designierte Term-Fallback. Bewertungstools müssen daher weiterhin EURIBOR-Forward-Kurven **und** €STR führen.

---

## 4. Regulatorik/Reporting in DACH, die ein Bewertungstool unterstützen sollte

| Regime | Relevanz für die Plattform | Status [Q] |
|---|---|---|
| **EMIR Refit** (RTS 2022/1855, ITS 2022/1860, ESMA-Leitlinien ESMA74-362-2281) | 203 Felder, ISO-20022-XML. Tägliche Bewertungsmeldung (Action Type „Valuation") für FC/NFC+: **Valuation amount, Valuation currency, Valuation timestamp, Valuation method (MTMA = Mark-to-Market, MTMO = Mark-to-Model, CCPV = CCP-Bewertung), Delta** sowie Collateral-Felder. TR-Rekonziliation mit Toleranz ±2,5 % (MTMA) bzw. ±5 % (MTMO/gemischt); Anzahl rekonzilierter Felder steigt von 87 auf 148 (Phase 2) | EU-Start 29.04.2024 [Q] |
| **EMIR 3** (VO 2024/2987) | Active-Account-Pflicht bei EU-CCP; Clearingschwellen 3 Mrd. EUR (IR und FX), 1 Mrd. (Credit/Equity), 4 Mrd. (Commodity); Bewertungstool sollte Cleared- vs. Uncleared-Kennzeichnung und Schwellenwert-Monitoring unterstützen | In Kraft 24.12.2024, AAR ab 24.06.2025 [Q] |
| **MiFID II / WpHG § 63 Abs. 7** | Ex-ante/Ex-post-Kostenausweis inkl. Marge; Quick Fix erleichtert für professionelle Kunden | [Q] |
| **WpHG § 64 Geeignetheitserklärung** | Ersetzt das Beratungsprotokoll seit 2018; Dokumentation von Marktwert, Szenarien, Marge als Bestandteil der Beratung | [Q/E] |
| **BGH-Swap-Rechtsprechung** | Offenlegung des anfänglichen negativen Marktwerts inkl. Höhe; Tool muss „Day-1-P&L" = Kundenpreis − Mid-Marktwert transparent ausweisen können | [Q] |
| **IDW RS HFA 35** (§ 254 HGB) | Bewertungseinheiten: Einfrierungs-/Durchbuchungsmethode, Effektivitätsnachweis (Dollar-Offset, Regression, Critical Terms Match); Drohverlustrückstellung für ineffektiven Teil | Original 2011, keine Neufassung gefunden [Q] |
| **BaFin MaRisk** (RS 06/2024) | Funktionstrennung Handel/Risikocontrolling/Abwicklung; Bewertung von Handelsgeschäften durch handelsunabhängige Stelle; Validierung von Bewertungsmodellen (AT 4.3.2/BTO 2) | 7. Novelle 2023, Update 2024 [Q] |
| **EBA Prudent Valuation** (Del. VO 2016/101, Änderung 2020/04, Konsultation 2024) | AVAs: Marktpreisunsicherheit, Close-out-Kosten, Modellrisiko etc. bei 90 % Konfidenz; **vereinfachter Ansatz** (0,1 % der Fair-Value-Positionen) unter 15 Mrd. EUR Fair-Value-Volumen | [Q] |
| **IFRS 13 / IFRS 9** | Level-Hierarchie (OTC i. d. R. Level 2), CVA/DVA-Pflicht, Hedge-Effektivität | [Q] |
| **PRIIPs** | KID für OTC-Derivate an Kleinanleger (Performance-Szenarien, Kosten). **Umsetzung im Core [E]:** `generateKid` weist den Gesamtrisikoindikator (SRI) als ausdrücklich gekennzeichnete **Heuristik** aus – Marktrisikomaß = maximaler Verlust der deterministischen Szenarien relativ zum Nominal (bei gekauften Optionen auf die Prämie begrenzt), eingeordnet nach den VEV-Klassengrenzen des Anhangs II DelVO (EU) 2017/653 (< 0,5 % → 1, 0,5–5 % → 2, 5–12 % → 3, 12–20 % → 4, 20–30 % → 5, 30–80 % → 6, > 80 % → 7), Kreditrisikomaß pauschal Bankkontrahent (mind. Klasse 2); Performance-Szenarien als 10/50/90 %-Quantil und Worst Case des Szenario-P&L. Die vorgeschriebene Berechnung für Kategorie-3-PRIIPs (Monte-Carlo-Simulation der Preispfade, Cornish-Fisher-VaR 97,5 % über die empfohlene Haltedauer, CRM aus der Bonitätsbeurteilung des Herstellers, Anhang II Nr. 19 ff. / Anhang IV) ist **Roadmap**. | [Q]/[E] |
| **DORA** (VO 2022/2554) | Gilt seit 17.01.2025: Finanzunternehmen müssen IKT-Drittdienstleister im **Informationsregister** führen und jährlich an BaFin melden; vertragliche Mindestklauseln, Exit-Strategien, Auditrechte. Ein SaaS-Bewertungsanbieter wird damit zum IKT-Drittdienstleister mit entsprechenden Vertrags- und Nachweispflichten | [Q] |

**Konsequenz für die Architektur [E]:** Jede Bewertung muss reproduzierbar sein (Snapshot von Marktdaten, Modellversion, Konventionen, Zeitstempel), die Bewertungsmethode (MTMA/MTMO) und der Hierarchie-Level müssen als Metadaten mitgeführt werden, und ein Audit-Trail (wer/wann/welche Kurve) ist regulatorisch zwingend (MaRisk, DORA, EMIR-Rekonziliation).

---

## 5. Empfehlung für v1 und Testfälle

### 5.1 Modelle, die v1 implementieren muss [E]

1. **Kurvenkern:** €STR-OIS-Diskontkurve, EURIBOR-3M/6M-Forward-Kurven (Multi-Curve, exogene Diskontierung), USD-SOFR, GBP-SONIA, CHF-SARON; Interpolation log-linear DF (Default) und Monotone Convex (Option); Turn-of-Year optional.
2. **Linear:** IRS (fix/float, OIS, Basis), FRA, FX Forward/NDF, FX Swap, Cross-Currency-Swap (fix/float, MtM-Resetting) mit Basis-Kurven.
3. **Zinsoptionen:** Caps/Floors/Collars und europäische Swaptions mit **Bachelier** und **Shifted Black** (Konvertierung Normal ↔ Shifted-Lognormal-Vol); Cash- und Physical-Settlement; Vol-Interpolation in Expiry/Tenor/Strike (Cube).
4. **FX-Optionen:** Garman-Kohlhagen Vanilla, digitale Optionen (analytisch), einfache Barrieren (Reiner-Rubinstein) mit Vanna-Volga-Adjustierung; Vol-Surface aus ATM/RR/BF mit konfigurierbarer Delta-Konvention.
5. **Sensitivitäten:** Bump-and-Revalue Bucketed DV01, Vega, FX-Delta/Gamma; Szenarien; CRIF-Export.
6. **Adjustments:** Vereinfachtes CVA/DVA (Swaption-Replikation bzw. Exposure-Profil via Hull-White-Monte-Carlo) für unkollateralisierte Kundengeschäfte; Day-1-Marge-Ausweis.
7. **Nicht in v1:** Bermudans, CMS-Spread-Optionen, TARF/Accumulator, vollständige XVA-Engine, SIMM-IM-Berechnung.

### 5.2 Standard-Testfälle und Referenzwerte

| # | Testfall | Inputs | Erwartetes Ergebnis | Herkunft |
|---|---|---|---|---|
| T1 | **Caplet Black-76 (Hull-Beispiel)** | Nominal 10 Mio., Cap 8 %, Forward-Rate 7 % (vierteljährlich), Periode 1,00–1,25 J, σ = 20 %, 15M-Zero 6,5 % stetig | d1 = −0,5677, d2 = −0,7677, Preis ≈ **5.190** (eigene Berechnung mit exakter N(·); Hull-Lehrbuch gibt aufgrund Tabellenrundung einen Wert in derselben Größenordnung, ca. 5.16x an – Textstelle konnte ich online nicht verifizieren) | Hull, OFOD, Kapitel Interest Rate Derivatives [Q/E] |
| T2 | **Garman-Kohlhagen EUR/USD** | S = 1,10, K = 1,10, T = 1 J, r_USD = 4 %, r_EUR = 2 % (stetig), σ = 8 % | Forward = 1,122221; Call = **0,045795** USD/EUR; Put = 0,024445; Put-Call-Parität: C − P = e^(−r_d T)(F − K) = 0,021350 | eigene Berechnung, geschlossene Formel [E] |
| T3 | **ATM-Swaption Bachelier vs. Black** | F = K = 2,5 %, T = 1 J, Annuität 4,5, Normal-Vol 80 bp | Bachelier-Payer = A·σ_N·√T/√(2π) = **0,014362** je Nominaleinheit; Black mit σ_LN = σ_N/F = 32 % ergibt 0,014301 (Abweichung durch Konvexität – Test der Vol-Konvertierung) | eigene Berechnung [E] |
| T4 | **Par-Swap-Satz auf flacher Kurve** | Zero 3 % stetig, 5J jährlich | Par-Satz = (1 − DF₅)/ΣDF = **3,0455 %**; Swap-NPV bei diesem Kupon = 0 | analytisch [E] |
| T5 | **Cap-Floor-Parität** | Gleicher Strike, gleiche Kurve | Cap − Floor = Payer-Swap-NPV (bis auf Rundung) | Modellinvariante [E] |
| T6 | **Swaption-Parität** | Payer − Receiver | = Forward-Swap-NPV; Cash-Settled ≠ Physical bei Nicht-Flat-Kurve | Modellinvariante [E] |
| T7 | **QuantLib-Beispiele** | `Examples/Swap`, `Examples/BermudanSwaption` (HW/BK an ATM/OTM/ITM kalibriert), `Examples/FRA`, Python `bermudan-swaption.py` | Reproduktion der ausgegebenen NPVs, z. B. GSR-kalibrierte 10J-Bermudan-Payer-Swaption, Strike 4 %, EONIA 2 %/EURIBOR 6M 2,5 %, Vol 20 % → NPV 0,003808 (QuantLib-Blogbeispiel) | QuantLib-Repository / Beispiele [Q] |
| T8 | **QuantLib-Testsuite** | `test-suite/swaption.cpp`, `capfloor.cpp`, `piecewiseyieldcurve.cpp`, `shortratemodels.cpp` (HW-Kalibrierung gegen gecachte Werte), `fxvolatility`/`blackformula.cpp` | Gecachte Referenzwerte für Kurven-Repricing (Bootstrap muss Inputs auf 1e-9 reproduzieren), Bachelier-Implied-Vol-Inversion, Put-Call-Paritäten | QuantLib [Q] |
| T9 | **Kurven-Roundtrip** | Alle Bootstrap-Instrumente | Repricing der Kalibrierinstrumente auf ~0 (Toleranz 1e-10 in Rate) | Standard-IPV-Test [E] |
| T10 | **€STR-Compounding** | EZB-Compounded-Index/-Averages | Eigene In-Arrears-Berechnung für 1M/3M/6M muss die EZB-Werte reproduzieren (inkl. Lookback-Variante mit 2 Tagen für Fallback) | EZB-Daten [Q] |
| T11 | **Vol-Konvertierung** | Normal ↔ Shifted-Black (Shift 1 %, 2 %, 3 %) | Preisidentität nach Konvertierung; Grenzfall F → 0 | Marktpraxis [Q/E] |
| T12 | **Cross-Check gegen Vendor** | Bloomberg SWPM / LSEG / CCP-Bewertungen | Abweichung Vanilla-IRS < 0,1 bp Par-Äquivalent; EMIR-Toleranz ±2,5 % als Obergrenze | IPV-Praxis [E], EMIR [Q] |
| T13 | **Golden Master (umgesetzt)** | `packages/pricing-core/test-data/golden/*.json`: Swap und Cash-Swaption (CCP/IRR) auf flacher 3 %-Kurve, €STR-OIS-Compounding, Hull-Caplet (T1), Bachelier-ATM (T3), GK EUR/USD (T2) mit Delivery-Lag, FX-Forward mit Spot-Date, Caplet-Strip | Reproduktion durch die Engine auf 1e-6 relativ (`src/testing/golden.test.ts`); Referenzen unabhängig per geschlossener Formel (`tools/quantlib-golden.py`, QuantLib-Cross-Check optional) | eigene Herleitung [E] |
| T14 | **ISDA ACT/ACT ICMA Long-Back-Stub mit EOM** | 30.11.1999 → 30.04.2000, quartalsweise, Referenzperiode 30.11.1999–29.02.2000 | **0,415761** (Notional-Periode 29.02.–31.05.2000 nach EOM-Regel); ohne EOM 0,419444 | ISDA 2006 Definitions, 4.16(c) Beispiel [Q] |

**Validierungsrahmen [E]:** Für MaRisk/AVA-Anforderungen sollten Testfälle T1–T12 automatisiert im CI laufen, mit versionierten Marktdaten-Snapshots, und jede Modelländerung sollte einen Backtest gegen die letzten Vendor-Preise auslösen. Dokumentation der Modellannahmen (Shift, Interpolation, CSA-Kurve, Delta-Konvention) ist Teil des Lieferumfangs, nicht Beiwerk.

---

## Quellenliste

**BIS / Markt**
- BIS, OTC derivatives statistics at end-June 2025 (8.12.2025): https://www.bis.org/publ/otc_hy2512.htm
- BIS, Triennial Survey 2025 – Media Release (30.09.2025): https://www.bis.org/media-releases/20250930-global-fx-trading-hits-96-trillion-day-april-2025-and-otc-interest-rate-derivatives-surge-79
- BIS, OTC interest rate derivatives turnover April 2025: https://bis.org/statistics/rpfx25_ir.htm
- BIS, OTC FX turnover April 2025: https://www.bis.org/statistics/rpfx25_fx.htm
- Banque de France, Triennial Survey 2025 – Kommentar: https://www.banque-france.fr/en/publications-and-statistics/publications/bis-triennial-central-bank-survey-foreign-exchange-and-otc-derivatives-where-does-paris-rank

**Benchmarks / Referenzdaten**
- EZB, €STR – Überblick und Methodik: https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/html/index.en.html
- EZB, €STR methodology and policies: https://www.ecb.europa.eu/stats/euro-short-term-rates/interest_rate_benchmarks/WG_euro_risk-free_rates/shared/pdf/ecb.ESTER_methodology_and_policies.en.pdf
- EMMI, Euribor Reform: https://www.emmi-benchmarks.eu/benchmarks/euribor/reforms/
- EMMI, Euribor Methodology: https://www.emmi-benchmarks.eu/benchmarks/euribor/methodology/
- EMMI, EFTERM: https://www.emmi-benchmarks.eu/benchmarks/efterm/
- ISDA, EURIBOR reform FAQs: https://www.isda.org/a/tVtTE/ISDA-EURIBOR-reform-FAQs-10-Sept.pdf
- EZB WG on euro RFR, EURIBOR fallback trigger events und €STR-basierte Fallbacks (2021): https://www.ecb.europa.eu/pub/pdf/other/ecb.recommendationsEURIBORfallbacktriggereventsandESTR.202105~9e859b5aa7.en.pdf
- ISDA, RFR Conventions and IBOR Fallbacks Product Table (Okt. 2021): https://www.isda.org/a/bdigE/RFR-Conventions-and-IBOR-Fallbacks-Product-Table-October-2021.pdf
- ISDA, Memorandum Compounding RFRs under 2006 Definitions: https://www.isda.org/a/alEgE/A40393158-v18.0-ISDA_Memorandum_Compounding-RFRs-under-2006-Definitions.pdf
- LSEG, Refinitiv Term €STR: https://www.lseg.com/en/ftse-russell/benchmarks/term-estr

**Methodik**
- Ametrano/Bianchetti, Everything You Always Wanted to Know About Multiple Interest Rate Curve Bootstrapping (SSRN 2013): https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2219548
- Bianchetti, Two Curves, One Price (arXiv 2009): https://arxiv.org/pdf/0905.2770
- No Fear of Discounting – EONIA → €STR (arXiv 2025): https://arxiv.org/pdf/2503.06806
- Caspers, Negative rates in QuantLib (QuantLib User Meeting 2015): https://www.quantlib.org/slides/qlum15/caspers1.pdf
- KTH Master Thesis, SABR Model Extensions for Negative Rates: https://www.math.kth.se/matstat/seminarier/reports/M-exjobb17/170616d.pdf
- Bianchetti/Carlicchi, Interest Rates After the Credit Crunch: Multiple-Curve Vanilla Derivatives and SABR (arXiv): https://arxiv.org/pdf/1103.2567
- Reiswich/Wystup, A Guide to FX Options Quoting Conventions: https://www.researchgate.net/publication/275905055_A_Guide_to_FX_Options_Quoting_Conventions
- Arbitrage-free smile construction on FX option markets using Garman-Kohlhagen deltas (Rev. Deriv. Res. 2022): https://link.springer.com/article/10.1007/s11147-022-09189-9
- OpenGamma, Vanilla Forex Options: Garman-Kohlhagen and Risk Reversal/Strangle: https://quant.opengamma.io/Vanilla-Forex-Options-OpenGamma.pdf
- Zanders, How to value a cross-currency swap: https://zandersgroup.com/en/latest-insights/how-to-value-a-cross-currency-swap
- Clarus, Mechanics of Cross Currency Swaps: https://www.clarusft.com/mechanics-of-cross-currency-swaps/
- Quantifi, IFRS 13: CVA, DVA, FVA and hedge accounting: https://www.quantifisolutions.com/ifrs-13-cva-dva-fva-and-the-implications-on-hedge-accounting/
- IFRS Community, Fair Value Hierarchy (IFRS 13): https://ifrscommunity.com/knowledge-base/fair-value-hierarchy/
- ISDA SIMM v2.7+2412: https://www.isda.org/2025/05/22/isda-publishes-isda-simm-methodology-version-2-7-2412/
- ISDA SIMM v2.8+2506: https://www.isda.org/2025/10/31/isda-publishes-isda-simm-methodology-version-2-8-2506/
- ISDA SIMM v2.8+2512: https://www.isda.org/2026/06/12/isda-publishes-isda-simm-methodology-version-2-8-2512/
- IFR, Tarfs – the derivatives „from hell": https://www.ifre.com/people-and-markets/2277122/tarfs-the-derivatives-from-hell-that-keep-burning-banks-and-their-clients

**QuantLib / Testreferenzen**
- QuantLib Example BermudanSwaption.cpp: https://rkapl123.github.io/QLAnnotatedSource/d9/dd4/_bermudan_swaption_8cpp-example.html
- QuantLib-SWIG bermudan-swaption.py: https://github.com/lballabio/QuantLib-SWIG/blob/master/Python/examples/bermudan-swaption.py
- QuantLib Test Suite (annotiert): https://rkapl123.github.io/QLAnnotatedSource/d4/df6/test.html
- QuantLib-Blog, Bermudan Swaption in GSR-Modell: https://quantlib.wordpress.com/tag/bermudan-swaption/
- Kürzinger, Aspects of Pricing Irregular Swaptions with QuantLib (2017): https://www.quantlib.org/slides/qlum17/kuerzinger.pdf
- Hull OFOD 10e, Lösungen Kap. 29 (Cap-Beispiele): https://www.studocu.com/en-us/document/johns-hopkins-university/introduction-to-financial-derivatives/hull-ofod-10e-solutions-ch-29/9159007
- MathWorks capbyblk (Black-Cap-Referenzimplementierung): https://www.mathworks.com/help/fininst/capbyblk.html

**Regulatorik DACH/EU**
- ESMA, EMIR Reporting (RTS/ITS, Leitlinien, Validierungsregeln): https://www.esma.europa.eu/data-reporting/emir-reporting
- ESMA, Guidelines on reporting under EMIR REFIT (ESMA74-362-2281): https://www.esma.europa.eu/sites/default/files/2023-10/ESMA74-362-2281_Guidelines_EMIR_REFIT.pdf
- Point Nine, Guide to Valuation Reporting under EMIR: https://www.p9dt.com/knowledge-base/guide-to-valuation-reporting-under-emir-point-nine/
- Reg-X, EMIR Refit Phase II Reconciliation: https://reg-x.co.uk/blogs/emir-refit-reconciliation-phase-2/
- TRAction, 9 Common XSD Errors in EMIR Refit (Valuation Method Codes): https://tractionfintech.com/emir/9-common-xsd-errors-in-emir-refit/
- Sidley, 2024 EMIR Refit changes: https://www.sidley.com/en/insights/newsupdates/2024/02/2024-european-market-infrastructure-regulation-refit
- FinReg News Blog Germany, EMIR 3 Active Accounts, Clearing Threshold: https://finregnewsblog.com/en/2024/12/06/emir-3-active-accounts-clearing-threshold-and-exemptions/
- PwC, EMIR 3.0 Active Account Requirement: https://blogs.pwc.de/en/regulatory/article/246633/emir-3.0-navigating-the-active-account-requirement/
- BaFin, Rundschreiben 06/2024 (BA) MaRisk: https://www.bafin.de/SharedDocs/Veroeffentlichungen/DE/Rundschreiben/2024/rs_06_2024_MaRisk_BA.html
- EBA, Amending RTS on Prudent Valuation (EBA/RTS/2020/04): https://www.eba.europa.eu/sites/default/files/document_library/Publications/Draft%20Technical%20Standards/2020/RTS/882753/EBA-RTS-2020-04%20Amending%20RTS%20on%20Prudent%20Valuation.pdf
- EBA, Consultation Paper amendments Prudent Valuation (EBA-CP-2024-001): https://www.eba.europa.eu/sites/default/files/2024-01/a44040b4-da19-4beb-ad2d-935d9f2cd1a0/Consultation%20paper%20on%20amendments%20to%20the%20RTS%20on%20Prudent%20Valuation%20%28EBA-CP-2024-001%29.pdf
- EBA Q&A 2015_1715, Simplified approach threshold AVA: https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2015_1715
- IDW RS HFA 35: https://www.idw.de/idw/idw-verlautbarungen/idw-rs-hfa-35.html
- NWB, Bilanzierung von Bewertungseinheiten nach § 254 HGB unter Berücksichtigung IDW RS HFA 35: https://datenbank.nwb.de/Dokument/444837/
- BGH XI ZR 33/10 (22.03.2011) – Zusammenfassung Der Betrieb: https://der-betrieb.de/meldungen/bgh-entscheidet-zur-beratungspflicht-bei-zinssatz-swap-vertraegen/
- BGH XI ZR 378/13 (28.04.2015): https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=28.04.2015&Aktenzeichen=XI+ZR+378/13
- LTO zu XI ZR 378/13: https://www.lto.de/recht/nachrichten/n/bgh-xi-zr-378-13-swap-vertrag-zinsen-haftung-bank
- S+P Compliance, MiFID-II-Wohlverhaltensregeln §§ 63 ff. WpHG: https://schulz-beratung.de/mifid-ii-wohlverhaltensregeln-nach-63-ff-wphg/
- S+P Compliance, Dokumentationspflichten professionelle Kunden: https://compliance-advisor.de/dokumentationspflichten-fuer-professionelle-kunden-gemaess-mifid-ii/
- FMA (AT), PRIIPs und KIDs: https://www.fma.gv.at/wp-content/plugins/dw-fma/download.php?d=3285
- Helaba, Key Information Documents (KIDs für OTC-Derivate): https://www.helaba.com/de/service/key-information-documents.php
- LocateRisk, IKT-Drittparteirisiko unter DORA: https://locaterisk.com/de/wissen/dora-ikt-drittparteirisiko/
- Checkmate, DORA-Informationsregister: https://www.checkmate.expert/dora-informationsregister.html
