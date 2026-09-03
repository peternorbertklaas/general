# Wettbewerbslandschaft: Software zur Bewertung von Zins- und FX-Derivaten (Fokus DACH / LPA-Umfeld)

*Stand: September 2026. Rechercheansatz: ca. 65 Web-Suchen, Auswertung von Vendor-Seiten, Pressemitteilungen,
GitHub-Repositories und Review-Portalen. Viele Vendor-Domains waren über den Netzwerk-Proxy nicht direkt
abrufbar; dort stützt sich der Bericht auf Suchergebnis-Snippets. Aussagen sind in **belegt** (Quelle
vorhanden) und **Einschätzung** (Schlussfolgerung) getrennt.*

## 1. Marktübersicht & Segmente

Der Markt zerfällt in fünf strukturell verschiedene Segmente:

**A. Spezialisierte Pricing-Bibliotheken und Bewertungsplattformen** (Numerix, FINCAD, Quantifi, Price-it,
Bloomberg-Funktionen, LSEG Adfin/Swap Pricer). Zielgruppe: Trading, Treasury, Risk, Quants. Typisch: Excel-Add-in
plus SDK, zunehmend Cloud-Backend. Konsolidierung weit fortgeschritten: FINCAD 2022 von Zafin übernommen, heute
„Fincad Analytics Suite from Numerix" (belegt).

**B. Front-to-Back-/Trading-Systeme** (Murex MX.3, Nasdaq Calypso, Finastra Summit/Kondor, FIS Front Arena,
SimCorp Dimension). Bewertung als eingebettetes Modul; Landesbanken, Großbanken, große Asset Manager. Helaba und
NORD/LB sind belegte Murex-Anwender.

**C. Treasury-Management-Systeme mit Bewertungsfunktion** (Kyriba, Coupa Treasury/ex-BELLIN, ION Treasury mit
Reval/IT2/Wallstreet Suite, Nomentia/ex-TIPCO, Trinity, Salmon, SAP TRM). Zielgruppe Corporates; Bewertung
primär für Hedge Accounting (IFRS 9/ASC 815), nicht für Pricing im Vertrieb.

**D. Unabhängige Bewertungsdienstleister / Managed Services** (Chatham Financial, Zanders Valuation Desk,
Derivative Path, Hedge Trackers/GTreasury, S&P Global, ICE, Infront Quant, Derivative Partners). Fair Values
„as a service" für Corporates, Wirtschaftsprüfer, Asset Manager.

**E. Open Source und „Prosumer"-Tools** (QuantLib, ORE, Strata, finmath-lib, rateslib, Deriscope, BlueGamma).
Technisch oft auf Augenhöhe, aber ohne Marktdaten, Support und regulatorische Dokumentation.

**Spezifisch deutscher Markt:** Für Sparkassen existiert seit 2025 ein „Digitaler Beratungsworkflow für
OTC-Derivate bei Zins-, Währungs- und Rohstoffprodukten" (ZWRM-Beratung) der Finanz Informatik; Dokumente werden
erzeugt und automatisch in OSPlus archiviert; Berater berichten von ca. 50 % Aufwandsreduktion (belegt:
FI-Magazin 1/2025). Die Pricing-Engine dahinter ist nicht ermittelbar. LPA positioniert die **Capmatix OTC
Suite** in genau diesem Feld. Im Genossenschaftssektor (DZ BANK) waren keine öffentlich dokumentierten
Firmenkunden-Bewertungstools auffindbar; DZ BANK nennt FXclick II für Online-FX-Handel.

**Einschätzung zur Marktdynamik:** (1) Konsolidierung bei Analytics-Anbietern (Numerix/FINCAD, Nasdaq/Adenza,
LPA/Derivative Partners/DDS/payoff/Zertifikatefabrik). (2) Bloomberg bleibt De-facto-Referenz im Dealing, aber
mit Seat-Preisen von ca. 24.000–27.600 USD/Jahr. (3) TMS-Anbieter treiben Bewertung in Corporates, ohne
Vertriebs-/Beratungsfokus. (4) Zwischen „Bloomberg-Terminal" und „Excel + QuantLib" fehlt eine bezahlbare,
moderne, deutschsprachige Bewertungs-Oberfläche für Firmenkundenberater und Mittelstand.

## 2. Vendor-Tabelle

| Vendor | Produkt | Segment | Abdeckung (IR/FX) | UI | Deployment | Besonderheiten |
|---|---|---|---|---|---|---|
| **LPA (Frankfurt)** | Capmatix OTC Suite | Banken (Sales/Trading Zinsderivate) | Plain-vanilla + strukturierte Derivate, XVA | Web-Workflows, Online-Banking-Integration | Cloud | 180+ Kunden; 2025 Consulting ausgegliedert; Zukäufe DDS, Zertifikatefabrik, payoff, Derivative Partners |
| **Numerix** | Oneview, CrossAsset XL | Banken, AM, Versicherer | Swaps, Swaptions, FX Fwd/Opt, Exoten | Web, Excel, Python-SDK | Cloud-native, Azure | Preis nur Enterprise |
| **FINCAD (→ Numerix)** | Fincad Analytics Suite | AM, Banken, Treasury | 2.000+ Funktionen | Excel-Add-in, Python-SDK | Desktop/SDK | Historisch Excel-Standard bei Treasurern |
| **Quantifi** | Quantifi Risk / Toolkit / Excel | Banken, HF, AM | IRS, XCCY, Basis, CMS, Swaptions, Caps/Floors, FX Fwd/Opt/Barrier | Web + Excel + APIs | Cloud/On-prem | XVA-Stärke; Engine des Zanders Valuation Desk |
| **Pricing Partners** | Price-it | Banken, Strukturierer | Cross-Asset | Excel-Add-in | Desktop/API | „3 Schritte: Marktdaten, Modell, Preis" |
| **Bloomberg** | SWPM, OVML, OVSW, DLIB, MARS | Dealing, Treasury, Risk | Vanilla-Swaps, FX-Optionen, Swaptions, Strukturen | Terminal-Kommandozeile + Tabs, Excel, MARS API | Terminal/SAPI | Referenzpreis-Status; SWDF-Defaults erzeugen Bewertungsdifferenzen |
| **LSEG** | Workspace Swap Pricer, Adfin | Banken, AM | IRS, Swaption-Cubes, FX | Workspace-App, Excel/COM | Desktop/SaaS | Eikon abgeschaltet 2025 |
| **ICE Data Services** | Portfolio Analytics – Derivatives | Institutionelle | FX, IR, EQ, CR | Feed/Datei | Service | MtM-Reports EoD/Intraday |
| **S&P Global MI** | OTC Derivatives Data, Derivatives Studio | Institutionelle | Kurven/Vol-Daten, OTC | CSV/FTP, Web | Service | Daten von 30+ Market Makern |
| **Chatham Financial** | ChathamDirect | Corporates, PE, Banken | IRS, XCCY, FX | Web-SaaS | SaaS | >100.000 Trades/Tag; IFRS 13; Amsterdam-Hub 2024 |
| **Zanders** | Valuation Desk | Corporates, Banken | Derivate, CVA/DVA | Service (Quantifi) | Managed Service | IFRS-13-Beratung inklusive |
| **Derivative Path** | DerivativeEDGE | US-Regionalbanken, Corporates | IRS, XCCY, FX | Web | SaaS | Bewertung ohne Execution-Lock-in |
| **Hedge Trackers / GTreasury** | CapellaFX | Corporates | FX-Hedging, IR | Web | SaaS | Hedge-Accounting-Workflow |
| **Derivative Partners (CH)** | Independent Valuation, CONNEXOR | Emittenten, Privatbanken | Strukturierte Produkte | API/Reports | Service | seit 01/2026 Teil von LPA |
| **Infront (ex vwd)** | Infront Quant | Banken, Vermögensverwalter | Neubewertung strukturierter Produkte | Plattform/Feeds | SaaS | 1 Mio. regulatorische Berechnungen/Tag |
| **Murex** | MX.3 | Landesbanken, Großbanken | Cross-Asset F2B | Rich Client | On-prem/Cloud | Helaba, NORD/LB; Gartner: „schwer zu implementieren" |
| **Nasdaq (Adenza)** | Calypso | Banken, AM | Cross-Asset F2B | Java-Client | On-prem/Cloud | 60.000 Nutzer |
| **Finastra** | Summit, Kondor | Banken | OTC-Derivate, FX, FI | Desktop | On-prem/Hosted | 160+ Banken auf Summit |
| **FIS** | Front Arena | Banken, AM | Cross-Asset | Desktop | On-prem/Hosted | |
| **SimCorp** | Dimension | AM, Versicherer | OTC IR/EQ-Derivate; SABR-Modul | Desktop/Web | On-prem/SaaS | FINCAD-Integration |
| **Beacon / OpenGamma / ActiveViam** | Beacon, OpenGamma SaaS, Atoti | Banken, HF | Risk/Margin-Analytics | Web/Notebook | Cloud | |
| **Kyriba** | Risk Management / Hedge Accounting | Corporates | FX, IR, Commodities | Web-SaaS | SaaS | modulbasiert, Preise nicht publiziert |
| **Coupa Treasury (ex BELLIN tm5)** | Risk & Financial Instruments | Mid-Market DACH | FX, IR | Web-SaaS | SaaS | |
| **ION Treasury** | Reval, IT2, Wallstreet Suite | Große Corporates | Komplexe Portfolios, HA | Web/Desktop | SaaS/On-prem | Reval Center = Bewertungs-Outsourcing |
| **Nomentia (ex TIPCO)** | Treasury Management | Mid-Market | FX-Derivate, MtM | Web-SaaS | SaaS | |
| **Trinity TMS** | Trinity | Mid-Market (DE) | IRS, XCCY, IFRS 9 | Desktop/Web | On-prem/Hosted | Deutscher Anbieter |
| **SAP** | TRM, Market Risk Analyzer | SAP-Kunden | FX, Derivate | SAP GUI/Fiori | On-prem/Cloud | |
| **QuantLib** | C++/Python | Quants | Kurven, Swaps, Swaptions, Caps, FX | Code | Open Source (BSD) | 1.40 (10/2025) |
| **ORE (Acadia/LSEG)** | Open Source Risk Engine | Banken, Quants | IR/FX/EQ/CR, XVA, SABR | XML/API, Excel/Python | Open Source | Version 12 (05/2024) |
| **OpenGamma Strata** | Java-Bibliothek | Entwickler | Multi-Curve, PV01 | Code | Apache 2.0 | |
| **finmath-lib** | Java + Spreadsheets | Quants | Multi-Curve, SABR, LMM, Hull-White, AAD | Code | Apache 2.0 | Deutscher Ursprung |
| **rateslib** | Python/Rust | Quants | IRS, XCS, FX-Swaps, AD | Code | Source-available | |
| **Deriscope** | Excel-Add-in (QuantLib) | Einzelnutzer | Swaps, Swaptions (SABR), Caps | Excel-Wizard | Desktop | 9–199 USD/Monat |
| **BlueGamma (UK)** | Kurven-API, Swap Pricer | Projektfinanzierer, Treasury | IRS, Forward-Kurven | REST, Excel | SaaS | gegr. 2021 |

## 3. Detailprofile der 10 relevantesten Anbieter

### 3.1 LPA – Capmatix OTC Suite (Referenzpunkt)
**Belegt:** Lebenszyklus strukturierter Produkte, OTC-Derivate und Fonds pre- bis post-trade; OTC Suite mit
MiFID-Onboarding, Strukturierung, „advanced pricing", Risiko/XVA, Dokumentenerzeugung; Web-Beratungsworkflows
im Online-Banking. >800.000 PRIIP-Berechnungen/Tag, 180+ Kunden. Referenzen: Commerzbank, LBBW, DekaBank.
**Einschätzung:** Einziger Anbieter, der Pricing, MiFID-Compliance und Dokumentation für den
Firmenkunden-Derivatevertrieb deutscher Banken bündelt. Schwäche: Pricing-Engine nicht öffentlich
dokumentiert; Fokus Prozess/RegTech statt transparentes Bewertungs-Frontend.

### 3.2 Bloomberg – SWPM / OVML / OVSW / DLIB / MARS
**Belegt:** SWPM = Vanilla-Pricer mit Tabs für Deal-Struktur, Kurvenwahl und Solver; OVML für FX-Optionen;
OVSW für Swaptions; DLIB mit Skriptsprache BLAN; MARS Valuations mit API. Kurven-Defaults (SWDF) sind
nutzerabhängig. Terminal ca. 24.000–27.600 USD/Jahr.
**UI:** Kommandozeile mit Funktionscodes, Tastaturzentrik, Tabs – für Händler effizient, für
Firmenkundenberater weder erschwinglich noch erlernbar (Einschätzung).
**Stärken:** Marktdaten, Prüferakzeptanz. **Schwächen:** Preis pro Seat, keine Beratungsprozesse,
Black-Box-Kurvenannahmen.

### 3.3 Numerix (inkl. Fincad Analytics Suite)
**Belegt:** Oneview bewertet „virtually any financial instrument"; IR, FX, EQ, CR, Commodities, Hybride;
Monte Carlo; cloud-native, APIs, Python. CrossAsset XL als Excel-Frontend; Fincad: 2.000+ Funktionen.
**Schwächen (Einschätzung):** Enterprise-Preisniveau; für Sparkassen-Größenordnung überdimensioniert.

### 3.4 Quantifi
**Belegt:** IR: IRS, XCCY, CMT/CMS, Basis, STIR/OIS-Futures, Swaptions, CMS-Spread, Caps/Floors, Digitals,
Callable Swaps, FRAs; FX: Spot, Forwards, NDF, Swaps, Vanilla-/Barrier-/Touch-Optionen. Real-time XVA.
**Einschätzung:** Technisch tief; keine deutschsprachige Mittelstandsausrichtung.

### 3.5 LSEG – Workspace Swap Pricer & Adfin
**Belegt:** April 2025 neuer Swap Pricer in Workspace, integriert mit Curve Builder; Adfin Analytics als
Rechenbibliotheken; AdfinX COM-API für Excel. Workspace ca. 1.800 USD/Monat.

### 3.6 Chatham Financial – ChathamDirect
**Belegt:** SaaS für Hedge Accounting und Bewertung mit integrierten Marktdaten, CVA/DVA; >100.000 Trades/Tag;
IFRS 13/ASC 820; Europa-Hub Amsterdam. **Einschätzung:** Stärkster Managed-Service-Wettbewerber für Corporates.

### 3.7 Zanders Valuation Desk (auf Quantifi)
**Belegt:** Unabhängige Bewertungen; IFRS-13 inkl. CVA/DVA; Hedge-Effektivitätstests; Margin-Call-Berechnung.

### 3.8 Murex MX.3 (Landesbanken-Standard)
**Belegt:** >300 Kunden; Helaba, NORD/LB. Gartner-Kritik: Implementierung schwer, teils instabil.
**Einschätzung:** Als Firmenkunden-Frontend ungeeignet; relevant als Kurven-/Bewertungsquelle zum Andocken.

### 3.9 ION Treasury (Reval / Reval Center)
**Belegt:** Reval >650 Unternehmen; Reval Center = Outsourcing von Bewertung und Hedge Accounting.

### 3.10 Open Source: QuantLib / ORE / finmath / rateslib / Deriscope
**Belegt:** ORE erweitert QuantLib um Simulationsmodelle, XVA, SABR-Kalibrierung; finmath-lib mit
Multi-Curve, SABR, LMM, AAD; rateslib mit AD-Sensitivitäten; Deriscope 9–199 USD/Monat. Ein Medium-Artikel
repliziert Bloomberg SWPM mit QuantLib – Vanilla-Pricing ist technisch kommoditisiert.
**Einschätzung:** Differenzierung entsteht durch Marktdaten, Kurven-Governance, UI und regulatorische Dokumentation.

## 4. Whitespace / Chancen für einen neuen Anbieter

1. **Moderne Web-UI mit Hotkeys für Berater.** Bloomberg bietet Tastatureffizienz, aber Terminal-Ästhetik und
   Seat-Preis; TMS und Managed Services bieten Web-Oberflächen ohne Pricing-Interaktivität.
2. **Transparenz der Bewertung.** Kurvenaufbau (OIS-Diskontierung, Multi-Curve, SABR-Cube) und jeder Cashflow
   nachvollziehbar – prüferfest nach IFRS 13/HGB (IDW RS HFA 35).
3. **Preismodell.** Lücke zwischen Deriscope (9–199 USD/Monat) und Bloomberg (~2.000 USD/Monat) für Teams mit
   5–50 Derivaten.
4. **Deutschsprachige Regulatorik-Integration.** MiFID-Geeignetheit, WpHG-Dokumentation, KIDs: nur LPA und die
   FI-Eigenentwicklung, beide prozess- statt bewertungszentriert.
5. **Kundensicht statt Banksicht.** Self-Service-Tool für die Kundenseite mit Angebotsvergleich („Fair Value vs.
   Angebotspreis") fehlt im DACH-Markt.
6. **Open-Source-Kern + Marktdaten-Abo.** Mathematik ist kommoditisiert; Differenzierung über kuratierte Kurven,
   Audit-Trail und UX.
7. **Excel bleibt Pflicht.** Treasurer erwarten ein Excel-Add-in als Ergänzung zur Web-UI.

**Risiken:** Marktdatenlizenzen (Redistribution), Prüferakzeptanz, LPA wächst nach den Zukäufen in diese Lücke.

## 5. Quellenliste (Auszug)
- LPA: l-p-a.com (/de/capmatix/otc/, /capmatix/otc-suite/, /solution/digital-advisory/, Pressemeldungen 2024–2026), presseportal.de/pm/135027/4786157, motivepartners.com/portfolio/lpa, finastra.com/applications/lpa-capmatix
- Sparkassen: f-i.de FI-Magazin 1/2025 „Digitaler Beratungsworkflow für OTC-Derivate", fi-magazin.de ZWRM-Beratung; firmenkunden.dzbank.de
- Numerix/FINCAD: numerix.com (oneview-valuation, crossasset, fincad-analytics-suite), globenewswire (Zafin/FINCAD 2022), resources.fincad.com brochure-f3-excel.pdf
- Quantifi: quantifisolutions.com (derivatives-valuation, xva, zanders-selects-quantifi), capterra.com/p/140022/Quantifi/
- Bloomberg: professional.bloomberg.com/products/risk/mars/, MARS-Valuations-Brochure.pdf, DLIB_Brochure.pdf, medium.com „SWPM dupe", tradingtoolshub.com (Kosten 2026)
- LSEG: lseg.com Swap Pricer Update, adfinxanalytics-upgrade.pdf, developers.lseg.com
- ICE/S&P: ice.com derivatives, spglobal.com otc-derivatives-data, derivatives-studio
- Chatham/Zanders/Derivative Path/GTreasury: chathamfinancial.com, zandersgroup.com valuation-desk, derivativepath.com, gtreasury.com (Hedge Trackers)
- F2B: gartner.com Murex reviews, murex.com (Helaba, NORD/LB), ir.nasdaq.com (Adenza), finastra.com (Summit, Kondor), a-teaminsight.com (SimCorp/FINCAD)
- TMS: kyriba.com, g2.com/kyriba/pricing, eco.com TMS 2026, iongroup.com (Reval Center), nomentia.com, ctmfile.com (Trinity), help.sap.com
- Open Source: github.com/OpenSourceRisk/Engine, opensourcerisk.org, github.com/finmath/finmath-lib, github.com/OpenGamma/Strata, github.com/attack68/rateslib, zenodo.org QuantLib 1.40, deriscope.com, bluegamma.io
