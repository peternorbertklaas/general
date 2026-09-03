# Review: Marktabdeckung Features & Module (Dimension 1) – DERIVA v0.1

**Reviewer-Rolle:** Senior Product Analyst, Derivatebewertungssoftware · **Stand:** 03.09.2026 · **Modus:** Review only (kein Code geändert)
**Geprüft:** `docs/research/*`, `docs/product/01–03`, `docs/architecture/02-adrs.md`, `packages/pricing-core/src/**` (index, instruments, pricing, curves, models, risk, xva, reporting, market), `apps/web/src/views/*`, `components/TradeEditor.tsx`, `components/CommandPalette.tsx`, `lib/quick-parser.ts`, `lib/templates.ts`, `hotkeys/keymap.ts`, `state/store.ts`, `apps/api/src/routes/*`, `app.ts`.
**Wettbewerber-Verifikation:** 15 Websuchen (Bloomberg SWPM/OVML/OVSW/MARS/DLIB, LSEG Workspace Swap Pricer/IPA, Numerix Oneview, Quantifi, LPA Capmatix OTC, Finanz Informatik ZWRM-Beratung, ChathamDirect, Kyriba, Coupa Treasury, ORE, QuantLib). Kennzeichnung im Text: **[belegt]** = aus Quelle, **[Einschätzung]** = Schlussfolgerung/Branchenwissen, **[unbekannt]** = keine Quelle.

---

## 1. Score

### **Marktabdeckung Features & Module: 60 / 100**

**Begründung in einem Satz:** Der Bewertungskern (Vanilla-Zins/FX, Multi-Curve, Bachelier/SABR/GK, Bump-Sensitivitäten, Szenarien, semi-analytisches CVA, prüferorientierter Report, MiFID-Marge) ist für einen v0.1 ungewöhnlich vollständig und liegt für Plain-Vanilla auf Augenhöhe mit Bloomberg SWPM/OVML und LSEG Swap Pricer; **die Zielsegmente Mittelstand-Treasurer und Marktfolge/IPV kaufen aber Prozess- und Regulatorik-Bausteine mit** (Hedge Accounting, EMIR-Bewertungsmeldung, Amortisationsstrukturen in der UI, Dokumente, Audit-Trail, Excel), und genau dort ist v0.1 noch weitgehend leer.

**Abzugsherleitung** (Rubrik: fehlendes Kernfeature −3…−8, Roadmap-dokumentierte Exoten max. −1, UX-Reibung −1…−3, kosmetisch ≤ −1):

| Bereich | Abzug | Wesentliche Lücken |
|---|---:|---|
| A Instrumente & Strukturen | −10 | Amortisation/Step-up ohne UI/Builder (−3); IMM/Stub/Roll nicht editierbar (−1); CCS/Basis/OIS/FX-Swap nicht per UI/Palette anlegbar (−1); Embedded Cap/Floor nur intrinsisch (−1); dokumentiert zurückgestellt: Bermudan (−1), CMS (−1), TARF/Accumulator (−1), Participating Forward/Baukasten (−0,5), Inflation (−0,5) |
| B Kurven & Marktdaten | −5 | Bootstrap ohne Futures/Tenor-Basis/XCCY-Basis (−2,5); kein Monotone Convex (−0,5); Fixings nicht pflegbar in UI (−0,5); Adapter Roadmap (−1); Kurven-Governance FO vs. IPV (−0,5) |
| C Modelle | −1 | Vanna-Volga fehlt; Cash-Settlement EUR noch IRR-Formel statt „collateralised cash price"; OIS-Lookback/Observation-Shift fehlen |
| D Sensitivitäten | −2 | Key-Rate nur auf Zero-Pillars, kein Par-/Quote-Jacobian (−1,5); Vega nur parallel (−0,5) |
| E Szenarien / VaR | −1 | EBA-IRRBB-Set unvollständig, kein Szenario-Editor in UI (−0,5); VaR/ES Roadmap (−0,5) |
| F XVA | −2,5 | CVA nur IRS/FX-Forward (−1,5); Netting/Collateral Roadmap (−0,5); CRIF Roadmap (−0,5) |
| G Hedge Accounting (IFRS 9 / HGB § 254) | −4 | Komplett fehlend – für Persona „Treasurer" Kernfunktion |
| H Regulatorik | −4 | EMIR-Refit-Bewertungsfelder fehlen (−2,5); IFRS-13-Level hart codiert (−0,5); PRIIPs/Zielmarkt/Ex-post (−0,5); EMIR-3-Kennzeichnung/AVA (−0,5) |
| I Dokumente | −2,5 | Kein PDF-Template (−1); kein Termsheet/Geeignetheitserklärung/Confirmation (−1,5) |
| J Workflow / Beratung | −2,5 | Kein Alternativenvergleich (−1,5); kein Kundenmodus (−0,5); kein Trade-Status/Freigabe (−0,5) |
| K UI | −0,5 | Kein Portfolio-Export; Layout-Presets Roadmap |
| L Integration | −2,5 | Excel-Add-in (−1,5); Batch-EoD/Import (−1) |
| M Admin | −2,5 | Rollen/Rechte (−1); Audit-Trail/Report-Hash (−1,5) |
| **Summe** | **−40** | → **60 / 100** |

Zum Vergleich (Einschätzung, gleiche Skala, gleicher v1-Workstation-Scope): Bloomberg SWPM+OVML+MARS ≈ 85 (keine Beratungs-/HGB-Bausteine), LPA Capmatix OTC ≈ 75 (Pricing-Kern nicht öffentlich), Kyriba/Coupa ≈ 55 (kein Pricing-Frontend), ORE ≈ 60 (kein UI/Prozess). DERIVA ist damit heute ein sehr guter Pricer mit dünner Prozessschicht.

---

## 2. Wettbewerber – bestätigte Fakten vs. Einschätzung

| Anbieter | Bestätigt [belegt] | Einschätzung / unbekannt |
|---|---|---|
| **Bloomberg SWPM** | Vanilla & exotische IRS, IR-Optionen, Swaptions, Hybrid-Notes; OIS-Diskontierung; **Amortisationsmethoden je Leg und Import eines Amortisationsplans aus Excel**; Tabs Details/Curves/Cashflow/Resets/Scenario/Risk; Reset-Tabelle aus Forward-Kurve | Solver (Par, Spread, Upfront), IMM-Rolls, Custom-Kurven (SWDF) – aus Handbuch-Snippets abgeleitet, Standard |
| **Bloomberg OVML** | Multi-Leg-FX-Optionsstrukturen, Barrier + Vanilla kombinierbar, gespeicherte Strukturen, Szenarioanalyse | Digitals, TARF/Accumulator via DLIB/BLAN (nicht direkt belegt) |
| **Bloomberg OVSW** | Swaption-Pricer; SABR-Cube/Bermudan-Methodik nur über QuantLib/Deriscope-Quellen belegt | Bermudan (Hull-White/LGM), Cube-Interpolation in SABR-Parametern – Marktstandard |
| **Bloomberg MARS/DLIB** | MARS Valuations: OTC-Portfolios, API (SAPI, B-PIPE, BQL/BQNT, VPC); DLIB Skriptsprache BLAN, Szenarien, Stress | EMIR-Bewertungsexport als Teil von MARS-Reporting (nicht explizit belegt) |
| **LSEG Workspace Swap Pricer (04/2025)** | App SWPR, **integriert mit Curve Builder** (eigene Kurven aus internen Daten), volle Kontrolle Zahlungsstruktur; IPA-API: IRS, OIS, CMS, XCCY, Caps/Floors, Swaptions, **Bullet und Amortisation**, Par-Rate/Spread/Fair Value/Duration/Implied Vol; Export nach MARVAL | UI-Hotkeys: unbekannt |
| **Numerix Oneview** | Volle XVA-Palette (CVA/DVA/FVA/MVA/KVA), PFE/EE/EPE/ENE, XVA-Greeks via AAD, CSA-Hierarchie & CSA-Scripting, „breiteste Instrumentenabdeckung", modular | Hedge Accounting: **nicht belegt** (kein Modul auffindbar) |
| **Quantifi** | IR: IRS, XCCY, CMT/CMS, Basis, STIR/OIS-Futures, Swaptions, CMS-Spread, Caps/Floors, Digitals, Callable Swaps, FRAs; FX: Spot, Fwd, NDF, Swap, Vanilla/Barrier/Touch; Excel-Add-in mit Plattform-Konsistenz; API; XVA inkl. KVA/MVA | Hedge Accounting nicht belegt |
| **LPA Capmatix OTC Suite** | MiFID-Onboarding/Fragebögen, Geeignetheitsberichte, Beratungsprotokolle, PRIIP-KIDs/PIBs, Produktpräsentationen, Termsheets, Verträge, Confirmations, Settlement-Instruktionen; Fragment-basierte Templates; Archivierung, Versionierung, rollenbasierte Rechte; MiFID-konformer Beratungsprozess FX/Rates/Rohstoffe für Retail & Professionals | Eigene Pricing-Engine, Kurvenkonstruktion, Sensitivitäten: **unbekannt** (Pricing wirkt als Integrationsschicht) |
| **Finanz Informatik ZWRM-Beratung (2025, mit LBBW)** | Digitaler Beratungsworkflow OTC-Derivate Zins/Währung/Rohstoff unter OSPlus; alle regulatorischen und Vertriebsdokumente werden im Prozess erzeugt und automatisch in OSPlus archiviert; zentrale Regulatorik-Pflege; ~50 % weniger Vor-/Nachbereitung | Pricing-Engine (vermutlich LBBW) nicht ermittelbar |
| **ChathamDirect** | Bewertung aller OTC-Derivate mit integrierten Marktdaten, **CVA**, Shock-Reports, >250.000 Bewertungen/Tag; Dashboards (nach Kontrahent/Index), Ein-Klick-Reports; Hedge Accounting ASC 815/IFRS 9 mit Designation, Dokumentation, Journalbuchungen, Effektivitätstests, Periodenabschluss-„Review Mode"; Konnektoren ERP/TMS/Trading | Regressionstests konkret: Einschätzung (Standard bei Chatham) |
| **Kyriba Hedge Accounting** | Hedge-Definition, Risikodesignation, Dokumenten-Upload, **hypothetisches Derivat**, Effektivitätstests, MtM, automatische Buchungen, De-Designation, OCI-Reklassifizierung; FAS133/IAS39/ASC815/IFRS 9 | – |
| **Coupa Treasury (ex BELLIN tm5)** | Keine produktspezifische Quelle erreichbar | Einschätzung: FX/IR-Bewertung + IFRS-9-Hedge-Accounting im Mid-Market DACH (siehe `02-wettbewerber.md`) |
| **ORE (Acadia/LSEG)** | Par-Sensitivitäten, historische VaR, Backtesting, P&L-Explain, Stress im Par-Raum, ISDA SIMM, AMC-Exposure mit AAD, MVA, Hull-White (IR), Black-Scholes (FX/EQ), Scripted Payoffs; alle Risikoklassen | UI: keines (XML/Excel/Python) |
| **QuantLib** | Bermudan Swaptions (HW, BK, G2, Markov-Functional), Zero-Coupon-Inflation-Swaps, akkretierende/amortisierende Swaptions, CMS mit Konvexität | – |

---

## 3. Feature-Matrix

Legende Status DERIVA: ✅ implementiert · 🔶 teilweise/nur Core ohne UI · ❌ fehlt · (R) = Roadmap in `01-vision-und-module.md` / `02-epics` dokumentiert.
Wettbewerber: ● belegt · ○ Einschätzung (Standard/wahrscheinlich) · – nicht vorhanden/nicht belegt · ? unbekannt.
Spalten: **BBG** = SWPM/OVML/OVSW/MARS · **LSEG** = Swap Pricer/IPA · **NX** = Numerix Oneview · **QF** = Quantifi · **LPA/FI** = Capmatix OTC / ZWRM · **CHAT** = ChathamDirect · **TMS** = Kyriba/Coupa · **QL/ORE**

### 3.1 Instrumente & Strukturen

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE | Beleg DERIVA |
|---|---|---|---|---|---|---|---|---|---|---|
| IRS fix/float, OIS (compounded/averaged), Spread, Gearing | ✅ | ● | ● | ● | ● | ○ | ● | ● | ● | `swap-pricer.ts`, `leg-pricer.ts` |
| Basis-Swap (3M/6M, €STR/EURIBOR) bewerten | ✅ Core / ❌ UI-Anlage | ● | ● | ● | ● | ○ | ○ | ○ | ● | Fair-Spread in `swap-pricer.ts:84`; kein Builder/Template |
| Amortisierende / Step-up-Swaps | 🔶 Typ `notionalSchedule`, kein Builder, **kein Editor** | ● (inkl. Excel-Import) | ● | ● | ● | ○ | ● | ● | ● | `types.ts:39`, `TradeEditor.tsx` ohne Feld |
| IMM-Daten / Roll-Konventionen / Stub-Wahl in UI | 🔶 Stubs im Core, kein IMM, UI ohne Auswahl | ● | ● | ● | ● | ? | ○ | – | ● | `schedule.ts` (kein IMM) |
| FRA | ✅ | ● | ● | ● | ● | ? | – | – | ● | `fra-pricer.ts` |
| Cap/Floor/Collar | ✅ | ● | ● | ● | ● | ○ | ● | ● | ● | `capfloor-pricer.ts` |
| Embedded Cap/Floor im Swap-Coupon (Optionalität) | 🔶 nur intrinsisch | ● | ● | ● | ● | ? | ○ | – | ● | `leg-pricer.ts:167` |
| Europ. Swaption physisch/cash | ✅ | ● | ● | ● | ● | ○ | ○ | – | ● | `swaption-pricer.ts` |
| Bermudan/Callable Swap | ❌ (R v1.1) | ● | ○ | ● | ● | ○ | – | – | ● | – |
| CMS / CMS-Spread | ❌ (R v1.1) | ● | ● | ● | ● | ○ | – | – | ● | – |
| Range Accrual / strukturierte Coupons | ❌ (R) | ● (DLIB) | ○ | ● | ● | ○ | – | – | ● (Scripted) | – |
| Inflations-Swap (ZC) | ❌ (nicht auf Roadmap) | ● | ● | ● | ○ | ? | – | – | ● | – |
| FX Forward / NDF | ✅ | ● | ● | ● | ● | ○ | ● | ● | ● | `fx-pricer.ts` |
| FX Swap (Near/Far) | ✅ Core / ❌ Editor („v1") | ● | ● | ● | ● | ○ | ● | ● | ● | `TradeEditor.tsx:324` |
| Cross-Currency-Swap const/MtM-Reset | ✅ Core / ❌ Template & Palette | ● | ● | ● | ● | ○ | ● | ● | ● | `swap-pricer.ts:117`; kein `n`-Hotkey |
| FX Vanilla / Digital / Single-Barrier | ✅ | ● | ● | ● | ● | ○ | ○ | ○ | ● | `garman-kohlhagen.ts` |
| Multi-Leg-FX-Strukturen (Risk Reversal, Participating Fwd) | ❌ (R v1.1) | ● (OVML) | ○ | ● | ● | ● | ○ | – | ● | – |
| TARF / Accumulator / Double Barrier / Touch | ❌ (R v1.1) | ● (DLIB) | ○ | ● | ● (Touch) | ○ | – | – | ● | – |
| Upfront/Prämie im Trade | ✅ | ● | ● | ● | ● | ○ | ○ | ○ | ● | `types.ts:21` |
| Instrumenten-Builder mit Marktkonventionen EUR/USD/GBP/CHF/JPY | ✅ | ● | ● | ● | ● | ? | ○ | ○ | ● | `builders.ts`, `index-definitions.ts` |

### 3.2 Kurven & Marktdaten

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| OIS-Bootstrap (€STR/SOFR/SONIA/SARON) | ✅ | ● | ● | ● | ● | ? | ● | ○ | ● |
| Dual-Curve EURIBOR 3M/6M aus Depo/FRA/Swap | ✅ | ● | ● | ● | ● | ? | ● | ○ | ● |
| STIR-Futures als Kurveninput (Konvexität) | ❌ | ● | ● | ● | ● | ? | ○ | – | ● |
| Tenor-Basis-Swap-Quotes als Input | ❌ | ● | ● | ● | ● | ? | ○ | – | ● |
| Cross-Currency-Basis-Kurve (USD-CSA-Diskontierung) | ❌ (Typ `collateralDiscountCurveId` vorhanden, kein Bootstrap) | ● | ● | ● | ● | ? | ● | ○ | ● |
| FX-Forward-Punkte als Kurveninput | ❌ | ● | ● | ● | ● | ? | ● | ○ | ● |
| Interpolation wählbar (logLin DF, lin, kubisch, flat fwd) | ✅ Core / ❌ UI-Auswahl | ● | ● | ● | ● | ? | ○ | – | ● |
| Monotone Convex (Hagan/West) | ❌ | ● | ○ | ● | ● | ? | ○ | – | ● |
| Turn-of-Year | ❌ | ● | ○ | ● | ● | ? | – | – | ● |
| Eigene Quotes eingeben, Live-Re-Bootstrap | ✅ (UI + API) | ● | ● (Curve Builder) | ● | ● | ? | – | – | ● |
| Bootstrap-Residuen / Repricing-Check (IPV) | 🔶 API liefert `residuals`, UI zeigt sie nicht | ● | ○ | ● | ● | ? | – | – | ● |
| Swaption-Cube (Normal) + SABR-Smile | ✅ | ● | ● | ● | ● | ? | ○ | – | ● |
| Caplet-Vol-Fläche Expiry×Strike | ✅ | ● | ● | ● | ● | ? | ○ | – | ● |
| FX-Vol ATM/RR/BF, Delta-Konvention, Strike-Konvertierung | ✅ | ● | ● | ● | ● | ? | ○ | – | ● |
| Historische Fixings (IBOR, RFR-Compounding) | ✅ Core+API / ❌ UI-Pflege | ● | ● | ● | ● | ? | ● | ● | ● |
| RFR-Konventionen Lookback / Observation Shift / Lockout | ❌ (nur Standard Compounding + Payment Lag) | ● | ● | ● | ● | ? | ○ | ○ | ● |
| Marktdaten-Adapter (LSEG/BBG/ICE/EZB/EMMI), Snapshot-Versionierung | ❌ (R v1.0) | ● (nativ) | ● (nativ) | ● | ● | ● | ● (integriert) | ● | – |
| Kurven-Governance (EoD-Freigabe, FO vs. IPV) | ❌ (R v1.0) | ○ | ○ | ● | ● | ? | – | – | – |
| Deterministischer Beispielmarkt / Offline-Modus | ✅ | – | – | – | – | – | – | – | ● (Beispiele) |

### 3.3 Modelle

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Bachelier / Black-76 / Shifted Black, Implied-Vol, Normal↔Lognormal | ✅ | ● | ● | ● | ● | ? | ○ | ○ | ● |
| SABR (Hagan) normal & lognormal, Alpha-Rekalibrierung | ✅ | ● | ● | ● | ● | ? | – | – | ● |
| Garman-Kohlhagen inkl. Greeks, premium-adjusted Delta | ✅ | ● | ● | ● | ● | ? | ○ | ○ | ● |
| Reiner-Rubinstein-Barrieren | ✅ | ● | ● | ● | ● | ? | – | – | ● |
| Vanna-Volga-Adjustierung | ❌ (ADR-004: v1.1) | ● | ○ | ● | ● | ? | – | – | ● |
| Cash-Settlement EUR „collateralised cash price" (ISDA 2018/19) | ❌ (IRR-Formel) | ● | ● | ● | ● | ? | – | – | ● |
| Hull-White 1F / LGM (Bermudan, CMS, Exposure-MC) | ❌ (R v1.1) | ● | ● | ● | ● | ? | – | – | ● |
| Monte-Carlo-Engine | ❌ (R) | ● | ● | ● | ● | ○ | ○ | – | ● |

### 3.4 Risiko / Sensitivitäten

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| DV01 parallel, je Kurve, Gamma, Theta | ✅ | ● | ● | ● | ● | ○ | ● | ○ | ● |
| Key-Rate-Delta je Pillar (Zero-Bump) | ✅ | ● | ● | ● | ● | ○ | ○ | – | ● |
| **Par-/Quote-Sensitivität (Jacobian, Risiko je Marktinstrument)** | ❌ | ● | ● | ● | ● | ? | ○ | – | ● |
| FX-Delta 1 % | ✅ | ● | ● | ● | ● | ○ | ● | ○ | ● |
| Vega parallel (IR normal, FX) | ✅ | ● | ● | ● | ● | ○ | – | – | ● |
| Vega-Buckets Expiry×Tenor / Smile-Risiko (Vanna/Volga) | ❌ | ● | ● | ● | ● | ? | – | – | ● |
| Cross-Gamma, AAD | ❌ | ● | ○ | ● (AAD) | ● | – | – | – | ● (AAD) |
| Risiko auf Portfolioebene (Blotter DV01, Summen) | ✅ | ● | ● | ● | ● | ○ | ● | ● | ● |

### 3.5 Szenarien / VaR

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Standard-Schocks ±100/200bp, Steepener/Flattener, FX ±10 %, Vol, Roll | ✅ | ● | ● | ● | ● | ● (Simulation) | ● (Shock-Reports) | ● | ● |
| Vollständiges EBA/BCBS-IRRBB-Set (6 Szenarien inkl. Short up/down) | 🔶 (4 von 6) | ● | ○ | ● | ● | ? | – | – | ● |
| Eigene Szenarien definieren | ✅ API / ❌ UI-Editor | ● | ● | ● | ● | ○ | ● | ○ | ● |
| What-if-Matrix Zinsen × FX (Heatmap) | ✅ | ● (OVML Szenario) | ○ | ● | ● | ● | ○ | – | – |
| Live-What-if per Slider/Hotkey (Portfolio) | ✅ **Alleinstellungsmerkmal** | ○ (Tabs) | – | – | – | – | – | – | – |
| Historische Stress-Tage | ❌ | ● | ○ | ● | ● | ○ | – | – | ● |
| Historische VaR / ES, P&L-Attribution | ❌ (R v1.2) | ● (MARS) | ○ | ● | ● | ● (Modelity) | – | ○ | ● |

### 3.6 XVA

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| CVA/DVA IRS (Swaption-Replikation), FX-Forward (GK) | ✅ | ● | ○ | ● | ● | ● („XVA management") | ● | ○ | ● |
| CVA/DVA für Cap/Floor, Swaption, CCS, FX-Option, FX-Swap | ❌ (`computeXva` → „not supported") | ● | ○ | ● | ● | ○ | ● | ○ | ● |
| Exposure-Profil EPE/ENE + Chart | ✅ | ● | ○ | ● | ● | ○ | ○ | – | ● |
| Hazard aus CDS-Spread (flach) | ✅ | ● | ○ | ● | ● | ? | ● | ○ | ● |
| CDS-Termstruktur / Bootstrap Survival | ❌ | ● | ○ | ● | ● | ? | ○ | – | ● |
| Netting-Set, CSA (Threshold/MTA), MC-Exposure | ❌ (R v1.1) | ● | ○ | ● | ● | ○ | ○ | – | ● |
| FVA / KVA / MVA | ❌ (bewusst nicht v1) | ● | – | ● | ● | ? | – | – | ● (MVA) |
| ISDA-SIMM / CRIF-Export | ❌ (R v1.2) | ● | – | ● | ● | – | – | – | ● |

### 3.7 Hedge Accounting

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Hedge-Beziehung designieren, Dokumentation | ❌ (R M11) | – | – | – | – | – | ● | ● | – |
| Hypothetisches Derivat (IFRS 9) | ❌ | – | – | – | – | – | ● | ● | – |
| Effektivitätstests Dollar-Offset / Regression / Critical Terms | ❌ | – | – | – | – | – | ● | ● | – |
| HGB § 254 / IDW RS HFA 35 (Einfrierung/Durchbuchung, Drohverlust) | ❌ | – | – | – | – | – | – | ○ (DACH-TMS) | – |
| Buchungssätze / OCI | ❌ (außer Scope) | – | – | – | – | – | ● | ● | – |

### 3.8 Regulatorik

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| MiFID II Ex-ante-Kosten: Fair Value vs. Transaktionspreis, Marge bp/% | ✅ | – | – | – | – | ● | – | – | – |
| BGH: anfänglicher negativer Marktwert (Kundensicht) ausgewiesen | ✅ **Alleinstellung** | – | – | – | – | ○ | – | – | – |
| MiFID Ex-post-Kosten, Zielmarkt, Geeignetheit | ❌ (R M10) | – | – | – | – | ● | – | – | – |
| PRIIPs-KID für OTC-Derivate | ❌ | – | – | – | – | ● (Kernkompetenz) | – | – | – |
| IFRS-13-Level mit Begründung | 🔶 hart codiert Level 2 (`valuation-report.ts:64`) | ● | ○ | ● | ● | ? | ● | ○ | – |
| IFRS 13 CVA/DVA im Fair Value | ✅ | ● | ○ | ● | ● | ○ | ● | ○ | ● |
| **EMIR-Refit-Bewertungsfelder** (Valuation amount/ccy/timestamp/method MTMO, Delta) | ❌ (R v1.0) | ○ (MARS) | ○ | ● | ● | ● (UnaVista) | ○ | ● | – |
| EMIR 3: Cleared/Uncleared-Kennzeichnung, Schwellenmonitoring | ❌ | ○ | – | ○ | ○ | ○ | – | ○ | – |
| Prudent Valuation (AVA) | ❌ (Landesbank-Scope) | ○ | – | ● | ● | – | – | – | – |
| MaRisk: reproduzierbarer Snapshot (Kurven-Pillars, Spots, Methodik im Report) | ✅ | ● | ● | ● | ● | ○ | ● | ○ | ● |
| Modellvalidierungs-Suite gegen QuantLib/ORE (CI) | ❌ (R v1.2) | – | – | – | – | – | – | – | ● (Testsuite) |

### 3.9 Dokumente

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Bewertungsreport JSON, Cashflow-CSV (de-DE) | ✅ | ● | ● | ● | ● | ● | ● | ● | ● |
| PDF-Report mit Logo/Disclaimer | 🔶 Browser-Print (R v1.1) | ● | ● | ● | ● | ● | ● | ● | – |
| Termsheet / Confirmation | ❌ (R v1.1) | ● (DLIB) | – | ○ | – | ● | – | – | – |
| Geeignetheitserklärung / Beratungsprotokoll (WpHG § 64) | ❌ (R v1.1) | – | – | – | – | ● | – | – | – |
| Pitchbook / Szenariorechnung für Kunden | ❌ | – | – | – | – | ● | – | – | – |
| Archivierung/Versionierung von Dokumenten | ❌ | – | – | – | – | ● (OSPlus/Capmatix) | ● | ● | – |

### 3.10 Workflow / Beratung

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Schnellindikation < 10 s (Palette-Schnelleingabe) | ✅ **Alleinstellung** | ● (Kommandozeile) | – | – | – | – | – | – | – |
| Alternativenvergleich (Swap vs. Cap vs. Collar nebeneinander) | ❌ (R US-8.14) | ● (Multi-Leg/OVML) | ○ | ● | ● | ● (Captano) | ○ | – | – |
| Kundenmodus (ohne Marge/interne Daten) | ❌ (R US-8.15) | – | – | – | – | ● (Digital Advisory) | – | – | – |
| Trade-Lifecycle (Indikation → Angebot → Abschluss), Status, Freigabe | ❌ | ○ (TOMS) | – | ● | ● | ● | ● | ● | – |
| Digitaler Kundenkanal / Online-Banking | ❌ (außer Scope) | – | – | – | – | ● | ● | – | – |
| Post-Trade (Confirmation-Matching, Settlement) | ❌ (außer Scope) | ● | – | – | – | ● | ○ | ● | – |

### 3.11 UI-Fähigkeiten

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Command Palette mit Fuzzy-Suche + Schnelleingabe | ✅ | ● (Funktionscodes) | ○ | – | – | – | – | – | – |
| Chord-Hotkeys mit Statusanzeige, Cheat-Sheet | ✅ (35 Kürzel) | ● | – | – | – | – | – | – | – |
| Blotter: Sortierung, Filter, Suche, KPI, Summen | ✅ | ● | ● | ● | ● | ○ | ● | ● | – |
| Blotter: Multi-Select, Spaltenkonfiguration, Gruppierung | ❌ | ● | ● | ● | ● | ? | ● | ● | – |
| Pricing-Workspace: Editor, Analytics, Key-Rate-Chart, Cashflows | ✅ | ● | ● | ● | ● | ○ | ○ | ○ | – |
| Editor für Amortisation, Stubs, Notional-Exchange, FX-Swap, Fixings | ❌ | ● | ● | ● | ● | ? | ○ | ○ | – |
| Kurven-Chart Zero/Forward, Vergleich, editierbare Quotes | ✅ | ● | ● | ● | ● | ? | – | – | – |
| Vol-Heatmaps, FX-Smile-Tabelle | ✅ | ● | ● | ● | ● | ? | – | – | – |
| Exposure-Chart, Szenario-Balken, Heatmap | ✅ | ● | ● | ● | ● | ● | ● | ○ | – |
| Export Portfolio (CSV/XLSX), Report-PDF | ❌ / 🔶 | ● | ● | ● | ● | ● | ● | ● | – |
| Dark/Light, Reporting-Währung, Inspector, Toasts | ✅ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | – |
| Layout-Presets / Split-View / Multi-Monitor | ❌ (R) | ● (Launchpad) | ● | ○ | ○ | – | – | – | – |
| Offline im Browser (Core im Client) | ✅ **Alleinstellung** | – | – | – | – | – | – | – | – |

### 3.12 Integration

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| REST-API mit OpenAPI (Price, Risk, Scenarios, XVA, Report, Market, Trades) | ✅ | ● (SAPI/BQL) | ● (IPA) | ● | ● | ● | ● | ● | – (XML/Python) |
| Kurven per API bootstrappen, Spots/Fixings setzen | ✅ | ● | ● | ● | ● | ? | – | – | ● |
| Excel-Add-in (`=DERIVA.PV`) | ❌ (R v1.1) | ● (BDP/BQL, DLIB) | ● (AdfinX) | ● (CrossAsset XL) | ● | ● (MS-Office) | – | ○ | ● (Deriscope/ORE-XL) |
| Batch-EoD: Portfolio-Datei rein → Bewertungen/Report raus | 🔶 `/api/price/portfolio`, kein Datei-Import/-Export | ● (MARS) | ● | ● | ● | ● | ● | ● | ● (CLI) |
| Trade-Import CSV/FpML | ❌ | ● | ● | ● | ● | ● | ● | ● | ● (XML) |
| Webhooks / Events | ❌ (R) | – | – | ○ | ○ | ○ | ○ | ○ | – |
| Kernbank-/TMS-Konnektoren (OSPlus, Murex, SAP) | ❌ | ○ | ○ | ● | ● | ● (Finastra, Avaloq, OSPlus via FI) | ● (ERP/TMS) | ● | – |

### 3.13 Admin

| Feature | DERIVA | BBG | LSEG | NX | QF | LPA/FI | CHAT | TMS | QL/ORE |
|---|---|---|---|---|---|---|---|---|---|
| Nutzer, Rollen (Berater/Risk/Prüfer/Admin), OIDC | ❌ (R v1.0) | ● | ● | ● | ● | ● | ● | ● | – |
| Mandanten | ❌ (R) | ● | ● | ● | ● | ● | ● | ● | – |
| Audit-Trail (wer/wann/was), Report-Hash, Snapshot-ID | ❌ (R v1.0) | ● | ● | ● | ● | ● (Versionierung) | ● | ● | – |
| Persistenz | ❌ In-Memory (R) | ● | ● | ● | ● | ● | ● | ● | – |
| Lizenz-Tagging Marktdaten, DORA-Betriebsdoku | ❌ (R) | ● | ● | ○ | ○ | ○ | ○ | ○ | – |

---

## 4. Priorisierte Gap-Liste

Schweregrad: **Kritisch** (blockiert Kernpersona), **Hoch** (Kernfeature fehlt, Wettbewerber-Standard), **Mittel**, **Niedrig**. Alle Vorschläge sind in TypeScript im bestehenden Architekturrahmen umsetzbar; Aufwand in Stunden geschätzt.

| # | Gap | Schwere | Was konkret implementieren | Paket / Datei | Aufwand |
|---|---|---|---|---|---|
| G1 | **Amortisierende/Step-up-Nominale nicht anlegbar** – Kern-Use-Case Mittelstand (Tilgungsdarlehen absichern); BBG/LSEG/Chatham/TMS haben es | Kritisch | (a) `makeVanillaSwap` um `amortisation?: { type: "Linear" \| "Annuity" \| "Custom"; finalNotional?: number; schedule?: {date,notional}[] }` erweitern, das `notionalSchedule` je Leg aus dem Schedule ableitet; (b) im Editor Abschnitt „Nominalverlauf" mit Typ-Auswahl + editierbarer Tabelle (Datum, Nominal) + „aus Schedule generieren"; (c) Palette-Token `amort 5m` (linear auf 5 Mio.) | `packages/pricing-core/src/instruments/builders.ts`, `apps/web/src/components/TradeEditor.tsx`, `apps/web/src/lib/quick-parser.ts` | 3–4 h |
| G2 | **Hedge Accounting fehlt** (IFRS 9 / HGB § 254); Kyriba, Coupa, Chatham liefern Designation + Effektivitätstest; Treasurer-Persona ohne HA nicht bedienbar | Kritisch | Neues Modul `hedge/`: `buildHypotheticalDerivative(trade, designationDate, ctx)` (Par-Swap zum Designationstag), `dollarOffset(ΔPV_hedge, ΔPV_item)`, `regressionTest(series)` (OLS Slope, R², t-Stat; Bestehen 0,8–1,25 & R² ≥ 0,8), `criticalTermsMatch(trade, item)`; Result-Typ `HedgeEffectivenessReport` mit Methode HGB Einfrierung/Durchbuchung und ineffektivem Teil (Drohverlust). API `POST /api/hedge/effectiveness`; Report-Abschnitt „Bewertungseinheit". | neu `packages/pricing-core/src/hedge/effectiveness.ts`, `hypothetical.ts`; `apps/api/src/routes/hedge.ts`; `apps/web/src/views/ReportView.tsx` | 6–8 h |
| G3 | **EMIR-Refit-Bewertungsfelder** nicht exportierbar (FC/NFC+ tägliche Pflicht; Marktfolge-Persona) | Hoch | `emirValuationRecord(trade, pricing, ctx)` → `{ uti?, valuationAmount, valuationCurrency, valuationTimestamp (ISO, T+0 EoD), valuationMethod: "MTMO", delta? (nur Optionen: aus analytics), collateralPortfolioIndicator }`; CSV/JSON-Export für Portfolio; Button im Blotter + `POST /api/emir?format=csv`. Feld `uti`, `clearedFlag` optional in `TradeBase`. | neu `packages/pricing-core/src/reporting/emir.ts`; `apps/api/src/routes/pricing.ts`; `apps/web/src/views/Blotter.tsx`; `instruments/types.ts` | 1 h |
| G4 | **Kurven-Inputs unvollständig**: keine STIR-Futures, keine Tenor-Basis-Swaps, keine XCCY-Basis → CCS wird ohne Basis mispriced; Quantifi/LSEG/BBG/ORE Standard | Hoch | `CurveQuote` um `{type:"Future", imm: string, price, convexityBp?}`, `{type:"BasisSwap", tenor, spread, otherIndex}` und `{type:"XccyBasis", tenor, spread, pair}` erweitern; Bootstrap für Basis-Swap = Float/Float-Par-Swap mit gegebener Diskontkurve; XCCY-Basis-Kurve als `collateralDiscountCurveId["EUR\|USD"]` registrieren. Sample-Quotes ergänzen. | `packages/pricing-core/src/curves/bootstrap.ts`, `market/sample-market.ts`, `market/market-context.ts` | 4–6 h |
| G5 | **Par-/Quote-Sensitivität fehlt** – Händler/IPV erwarten Risiko je Marktinstrument (2Y-Swap, 5Y-Swap …), nicht je Zero-Pillar | Hoch | `computeParRisk(ctx, trade, quotesById)`: je Quote +1bp bumpen, Kurve re-bootstrappen (Dual-Curve-Kette beachten), PV-Differenz; Ausgabe `{curveId, quoteLabel, delta}`; Chart im Pricing-Workspace umschaltbar Zero/Par. Alternativ Jacobian `dZero/dQuote` einmal je Kurve berechnen und Zero-Buckets projizieren (schneller). | `packages/pricing-core/src/risk/sensitivities.ts`, `apps/web/src/views/PricingWorkspace.tsx` | 3–4 h |
| G6 | **CVA nur für IRS/FX-Forward** – Cap/Floor, Swaption, CCS, FX-Option, FX-Swap liefern „not supported" | Hoch | Generischer Exposure-Pfad: für gekaufte Optionen EPE = PV(t) via Roll (`rollMarket`) auf Zeitgitter (kein Downside), verkaufte Optionen ENE analog; CCS: GK-Näherung auf Nominalaustausch + Swaption-Teil; FX-Swap = Summe zweier Forwards. `computeXva` Switch vervollständigen. | `packages/pricing-core/src/xva/cva.ts` | 3–4 h |
| G7 | **Dokumente**: kein Termsheet, keine Geeignetheitserklärung/Beratungsprotokoll, kein PDF-Template – LPA/FI-Kernnutzen | Hoch | (a) `termsheet(trade, pricing)` → strukturiertes Objekt + HTML-Rendering (Parteien, Konditionen, Schedule, Fixing-Quelle, Disclaimer); (b) `suitabilityStatement(trade, report, client)` mit Pflichtangaben § 64 WpHG (Kundenziel, Risikoklasse, Kostenausweis aus `costTransparency`, Szenarien ±100/200bp, anfänglicher Marktwert); (c) Print-CSS `@page` + Kopf/Fuß/Logo-Slot als PDF-Ersatz bis v1.1. | neu `packages/pricing-core/src/reporting/termsheet.ts`, `suitability.ts`; `apps/web/src/views/ReportView.tsx`, `apps/web/src/styles/app.css` | 4–6 h |
| G8 | **Alternativenvergleich** fehlt (Captano „Vergleich von Absicherungsalternativen"; OVML Multi-Leg) | Hoch | Blotter Multi-Select (Space) + View „Vergleich" (`g v`): Spalten je Trade, Zeilen PV, Par/Prämie, DV01, Theta, Vega, Marge, Szenario-P&L ±100/200; Cashflow-Overlay-Chart. Nutzt bestehende `computeRisk`/`runScenarios`. | neu `apps/web/src/views/CompareView.tsx`, `hotkeys/keymap.ts`, `state/store.ts` (selectedIds) | 3–4 h |
| G9 | **Audit-Trail / Report-Hash / Snapshot-ID** fehlen (Prüfer, MaRisk, DORA) | Hoch | (a) `canonicalJson()` + FNV-1a-64/SHA-256 (`crypto.subtle` in web/api) über `{trade, market.curves nodes, fxSpots, vols, params}` → `report.inputsHash`, `report.reportHash`; (b) `ctx.meta.snapshotId`; (c) In-Memory `AuditLog` im API-Store (append-only: actor, ts, action, before/after-hash) + `GET /api/audit`. | `packages/pricing-core/src/reporting/valuation-report.ts`, `apps/api/src/lib/store.ts`, `apps/api/src/routes/audit.ts` | 2–3 h |
| G10 | **CCS / Basis-Swap / OIS / FX-Swap nicht per UI anlegbar**; FX-Swap-Editor fehlt | Mittel | Templates `ccs`, `basis`, `fxs`; Hotkeys `n x` (CCS), `n b` (Basis), `n a` (FX-Swap); Palette-Grammatik `ccs eurusd 5y pay 3.2% 10m`, `basis 5y 3m/6m 10m`, `fxs eurusd 5m 1m 6m`; FX-Swap-Editor als zwei Forward-Blöcke. | `apps/web/src/lib/templates.ts`, `hotkeys/keymap.ts`, `lib/quick-parser.ts`, `components/TradeEditor.tsx`, `pricing-core/src/instruments/builders.ts` (`makeCrossCurrencySwap`, `makeBasisSwap`, `makeFxSwap`) | 2–3 h |
| G11 | **Stub/Roll/EOM/IMM nicht editierbar**; kein IMM-Roll | Mittel | Editor-Felder `stub` (5 Typen), `endOfMonth`, `businessDayConvention`, `paymentLag`; `immDate(year, month)` (3. Mittwoch) + `roll: "IMM"` in `ScheduleParams` (Perioden auf IMM-Termine), Builder-Option `imm: true`. | `apps/web/src/components/TradeEditor.tsx`, `pricing-core/src/dates/date.ts`, `dates/schedule.ts`, `instruments/builders.ts` | 2 h |
| G12 | **Embedded Cap/Floor nur intrinsisch** → strukturierte Swaps mit Coupon-Floor systematisch falsch | Mittel | In `priceLeg` bei `capRate/floorRate` je Periode Caplet/Floorlet via `bachelierGreeks` mit `capletVol` aus Fläche bewerten (Coupon = Fwd − Caplet + Floorlet); Warnung falls Fläche fehlt. | `packages/pricing-core/src/pricing/leg-pricer.ts` | 2 h |
| G13 | **IFRS-13-Level hart codiert (2)** | Mittel | Heuristik: `volOverride` gesetzt oder Vol außerhalb Flächen-Gitter → Level 3; Laufzeit > letzter Pillar → Level 3 mit Begründung; Barrier/Digital → Level 2 („modellbasiert, beobachtbare Inputs"); FX-Forward mit Kurven → 2; Rationale dynamisch. | `packages/pricing-core/src/reporting/valuation-report.ts` | 0,5 h |
| G14 | **Excel-Add-in fehlt** (alle Analytics-Anbieter und LPA haben Office-Integration) | Mittel | Office.js Custom Functions `DERIVA.PV`, `DERIVA.PAR`, `DERIVA.DV01`, `DERIVA.CURVE` gegen `/api/*`; Manifest + Vite-Build. | neu `apps/excel/` | 6–8 h |
| G15 | **Batch/Import** – kein Datei-Import (CSV/JSON), kein EoD-Export | Mittel | `POST /api/batch/valuation` (multipart/JSON Trades-Array) → Bewertungs-CSV (id, PV, DV01, EMIR-Felder) + optional ZIP von Reports; `POST /api/trades/import` CSV mit Spaltenmapping; Blotter „Import"/„Export Portfolio CSV". | `apps/api/src/routes/batch.ts`, `apps/web/src/views/Blotter.tsx` | 3 h |
| G16 | **Vega nur parallel**; keine Buckets | Mittel | `vegaBuckets`: Swaption-Surface zeilenweise (Expiry) bzw. Caplet je Expiry +1bp bumpen; FX-Vol je Expiry und je Quote-Typ (ATM/RR/BF → Vanna/Volga-Proxy). | `packages/pricing-core/src/risk/sensitivities.ts` | 1,5 h |
| G17 | **Fixings nicht in UI pflegbar**; laufende Perioden erzeugen Warnungen | Mittel | MarketView-Karte „Fixings" (Index, Datum, Wert; Hinzufügen/Löschen; CSV-Paste); Store `setFixings`. | `apps/web/src/views/MarketView.tsx`, `state/store.ts` | 1 h |
| G18 | **Cash-settled EUR-Swaption** nutzt IRR-Annuität; ISDA 2018/19 „collateralised cash price" | Mittel | Option `cashSettlementMethod: "CollateralisedCashPrice" \| "ParYieldCurveUnadjusted"`; Default EUR = CCP (= physische Annuität), USD/GBP = IRR. | `packages/pricing-core/src/pricing/swaption-pricer.ts`, `instruments/types.ts` | 0,5 h |
| G19 | **RFR-Konventionen** Lookback / Observation Shift / Lockout fehlen (EURIBOR-Fallback = 2-Tage-Lookback) | Mittel | `FloatLeg.rfrConvention?: { lookbackDays?, observationShift?, lockoutDays? }` in `projectFloatingRate` (Beobachtungsfenster verschieben, Gewichte nach Zahlungsperiode). | `packages/pricing-core/src/pricing/leg-pricer.ts`, `instruments/types.ts` | 2 h |
| G20 | **EBA-IRRBB-Szenarioset unvollständig**, kein UI-Editor für eigene Szenarien | Niedrig | Short-up/-down (+250bp kurz, 0 lang), Steepener/Flattener nach EBA-Formel (Parameter EUR 200/250/100); Szenario-Editor (Parallel, Tenor-Vektor, FX, Vol, Tage) in ScenariosView; Speichern in `localStorage`. | `packages/pricing-core/src/risk/scenarios.ts`, `apps/web/src/views/ScenariosView.tsx` | 1,5 h |
| G21 | **Kundenmodus** fehlt | Niedrig | Store-Flag `clientMode`, Hotkey `Shift+K`; blendet Marge/CVA-Inputs/Kontrahenten-Spreads/Warnungen aus, zeigt Fair Value, Szenarien, Cashflows. | `apps/web/src/state/store.ts`, `hotkeys/keymap.ts`, `views/ReportView.tsx`, `views/PricingWorkspace.tsx` | 1 h |
| G22 | **Bootstrap-Residuen nicht sichtbar** (IPV-Nachweis) | Niedrig | Spalte „Residuum" in CurvesView-Quote-Tabelle aus `bootstrapCurve().residuals`; `buildSampleMarket` Residuen mitliefern. | `apps/web/src/views/CurvesView.tsx`, `pricing-core/src/market/sample-market.ts` | 0,5 h |
| G23 | **Interpolation in UI nicht wählbar**; Monotone Convex fehlt | Niedrig | Select in CurvesView (logLinear/linearZero/cubicZero/flatForward) → `buildSampleMarket(..., {interpolation})`; Monotone Convex (Hagan/West) als 6. Methode. | `apps/web/src/views/CurvesView.tsx`, `pricing-core/src/math/interpolation.ts`, `curves/curve.ts` | 0,5 h + 3 h |
| G24 | **Rollen/Rechte/Persistenz** (Roadmap v1.0) | Niedrig (für v0.1) | Fastify-Hook mit Bearer-Token → Rolle; `TradeStore`-Interface mit SQLite/PG-Implementierung; `X-Actor` in Audit-Log. | `apps/api/src/app.ts`, `lib/store.ts` | 4–6 h |
| G25 | **Trade-Status/Lifecycle** (Indikation/Angebot/Abgeschlossen), Gültigkeit einer Indikation | Niedrig | `TradeBase.status?: "Indication" \| "Quoted" \| "Dealt" \| "Matured"`, `quoteValidUntil`; Blotter-Badge & Filter; Palette `status dealt`. | `pricing-core/src/instruments/types.ts`, `apps/web/src/views/Blotter.tsx` | 1 h |
| G26 | **CRIF/SIMM-Export**, **historische VaR**, **Netting-CVA**, **Vanna-Volga**, **Bermudan/CMS/TARF**, **Inflation** | Niedrig (dokumentiert zurückgestellt) | Keine Änderung für v0.1 nötig; Empfehlung: Inflations-ZC-Swap in Roadmap aufnehmen (Versicherer/Kommunen), CRIF-Export vorziehen (nur Formatierung vorhandener Bucket-Deltas). | – | – |

---

## 5. Quick Wins (< 1 h) vs. größere Posten

### Quick Wins (< 1 h je Position, zusammen ≈ 1 Arbeitstag, ≈ +8 Punkte)

1. **EMIR-Bewertungsfelder-Export** (G3) – `reporting/emir.ts` + Route + Blotter-Button.
2. **IFRS-13-Level-Heuristik** mit dynamischer Begründung (G13).
3. **EBA-IRRBB-Set vervollständigen** (Short up/down, EBA-Steepener/Flattener) (G20, Core-Teil).
4. **Portfolio-CSV-Export** aus Blotter (id, Typ, Nominal, Fälligkeit, PV, DV01, Kontrahent) inkl. `Ctrl+Shift+E`.
5. **Templates + Hotkeys** `n x` CCS, `n b` Basis-Swap, `n a` FX-Swap (G10, Template-Teil) – Builder `makeCrossCurrencySwap`/`makeBasisSwap`/`makeFxSwap`.
6. **Palette-Grammatik** `ccs`, `basis`, `fxs` (G10, Parser-Teil).
7. **Stub/EOM/BDC/PaymentLag-Felder** im Leg-Editor (G11, UI-Teil).
8. **Report-Hash + Snapshot-ID** (G9, Core-Teil).
9. **Fixings-Editor** in MarketView (G17).
10. **Kundenmodus-Flag** `Shift+K` (G21).
11. **Vega je Expiry** für Swaption-Surface (G16, Teil).
12. **Cash-Settlement-Konvention** „collateralised cash price" (G18).
13. **Interpolations-Select** in CurvesView (G23, UI-Teil).
14. **Residuen-Spalte** in CurvesView (G22).
15. **Trade-Status-Feld + Badge** (G25).
16. **Lineare Amortisation im Builder** (`finalNotional` → `notionalSchedule`) als erste Stufe von G1 (Editor-Tabelle folgt als größerer Posten).

### Größere Posten (mehrere Stunden bis 1–2 Tage)

| Posten | Aufwand | Punktwirkung |
|---|---:|---:|
| Hedge-Accounting-Modul (G2) | 6–8 h | +4 |
| Amortisations-Editor + Custom-Schedule (G1 Rest) | 2–3 h | +2,5 |
| Kurven-Inputs Futures/Basis/XCCY-Basis (G4) | 4–6 h | +2,5 |
| Par-/Quote-Jacobian (G5) | 3–4 h | +1,5 |
| CVA für alle Instrumente (G6) | 3–4 h | +1,5 |
| Termsheet + Geeignetheitserklärung + Print-Template (G7) | 4–6 h | +2,5 |
| Vergleichs-View (G8) | 3–4 h | +1,5 |
| Audit-Log im API (G9 Rest) | 1–2 h | +1 |
| Embedded Caplet-Bewertung (G12) | 2 h | +1 |
| RFR-Konventionen (G19) | 2 h | +0,5 |
| Batch/Import (G15) | 3 h | +1 |
| Excel-Add-in (G14) | 6–8 h | +1,5 |
| IMM-Roll (G11 Core) | 1 h | +0,5 |
| Monotone Convex (G23) | 3 h | +0,5 |
| Rollen/Persistenz (G24) | 4–6 h | +1 |

Mit allen Quick Wins und den fünf oberen größeren Posten (G1, G2, G4, G5, G6, G7) läge die Marktabdeckung bei geschätzt **≈ 85 / 100**; die verbleibende Differenz zu 100 sind Live-Marktdaten, Excel, VaR/CRIF, Netting-CVA und die bewusst zurückgestellten Strukturen.

---

## 6. Positivbefunde (keine Lücke, teils Alleinstellung)

- Schnelleingabe (`irs 10y pay 3.1% 10m`) mit Live-Vorschau und Chord-Hotkeys – im Segment außer Bloomberg-Kommandozeile ohne Gegenstück. [Einschätzung]
- Live-What-if `[`/`]` mit Portfolio-Neubewertung in Millisekunden im Browser (Offline-Kern) – kein Wettbewerber rechnet im Client. [Einschätzung]
- Bewertungstransparenz: Cashflow-Tabelle mit Fixing/Accrual/Satz/DF/PV, Pillar-Tabelle, Methodikliste, Kurven-Snapshot im Report – deckt IDW RS HFA 35 / IFRS-13-Nachvollziehbarkeit besser ab als TMS-„MtM intern". [Einschätzung]
- MiFID-Kostenausweis und BGH-„anfänglicher negativer Marktwert" direkt aus dem Pricing – nur LPA hat Vergleichbares, dort ohne eigenen Bewertungskern. [belegt für LPA-Dokumente, Einschätzung zur Kerntiefe]
- Dual-Curve-Bootstrapping mit Residuen ~1e-12, SABR-Smile, FX-Delta-Smile mit premium-adjusted Delta – Modellniveau QuantLib-nah für Vanilla. [Code geprüft]
- OpenAPI-REST-API mit ISO-Daten, Kurven-Bootstrap per API – Integrationsniveau LSEG-IPA-ähnlich für den v1-Scope.

---

## 7. Quellen (Websuche, September 2026)

- Bloomberg SWPM: rateslib „Replicating a SOFR Curve & Swap from Bloomberg's SWPM" (rateslib.readthedocs.io/en/latest/z_swpm.html); SWPM-Hilfeseiten (1library.net, pdfcoffee.com, coursehero.com); Medium „SWPM Dupe" (medium.com/@fordmanbell)
- Bloomberg OVML: risk.net „Bloomberg builds FX options presence"; bloomberg.com/professional „Pricing FX Options: Tips & Tricks", „The FX Ecosystem on the Bloomberg Terminal"
- Bloomberg MARS/DLIB: professional.bloomberg.com/products/risk/mars/; data.bloomberglp.com MARS-Valuations-Brochure.pdf, DLIB_Brochure.pdf
- LSEG: lseg.com Workspace Updates April 2025 „Powerful new Swap Pricer app"; lseg.com interest-rate-derivatives-analytics; community.developers.lseg.com (IRS Calculator API vs Workspace)
- Numerix: numerix.com/oneview-valuation, /oneview-xva, /oneview-xva-factsheet, MuniFin-Blog
- Quantifi: quantifisolutions.com/derivatives-valuation, /excel, /toolkit, /xva, /analytics; capterra.com/p/140022/Quantifi
- LPA: l-p-a.com/capmatix/otc-suite/, /capmatix-software/, /solution/digital-advisory/; avaloq.com Capmatix automation framework; fxnewsgroup.com (Interactive Brokers)
- Finanz Informatik: f-i.de FI-Magazin 1/2025 „Digitaler Beratungsworkflow für OTC-Derivate"; fi-magazin.de „Aus der Praxis: ZWRM-Beratung"
- Chatham: chathamfinancial.com/technology/chathamdirect/corporates, /ChathamDirect, /solutions/hedge-accounting/financial-institutions; businesswire.com 01.11.2022 ChathamDirect-Upgrade
- Kyriba: kyriba.com/resources/fact-sheets/derivative-hedge-accounting/; fundcount.com „Top 4 Software Solutions for Hedge Accounting Compliance (2026)"
- Coupa/BELLIN: keine produktspezifische Quelle erreichbar (Einschätzung aus `docs/research/02-wettbewerber.md`)
- ORE: opensourcerisk.org, ORE User Guide (userguide.pdf), lseg.com Insights „ORE and Risk Analytics Lab", wilmott.com, ftfnews.com
- QuantLib: rkapl123.github.io QLAnnotatedSource (ZeroCouponInflationSwap, BermudanSwaption.cpp); quantlib.org/slides (Accreting Swaptions, Irregular Swaptions); RQuantLib SabrSwaption/BermudanSwaption
- Hedge-Accounting-Methodik: PwC „Achieving hedge accounting in practice under IFRS 9"; ifrscommunity.com IFRS 9 Hedge Accounting; Quantifi/Deloitte IFRS 13 CVA/DVA Whitepaper
