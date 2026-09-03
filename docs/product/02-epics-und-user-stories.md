# DERIVA – Epics und User Stories

Format: **US-x.y** *Als* ‹Rolle› *möchte ich* ‹Ziel›, *um* ‹Nutzen›. – Akzeptanzkriterien (AK) in Given/When/Then-Kurzform.
Status: ✅ umgesetzt in v0.1 · 🔶 teilweise · ⏳ Roadmap. Umsetzungsnachweis verweist auf Code/Tests.

Rollen: **Berater** (Firmenkunden-Sales), **Treasurer** (Kunde), **Risk** (Marktfolge/IPV), **Prüfer**, **Quant**, **Admin**, **Entwickler**.

---

## Epic 1 – Fundament: Datum, Kalender, Konventionen (M1)

**Ziel:** Bewertungen scheitern in der Praxis an Datumsfehlern, nicht an Modellen. Das Fundament ist ISDA-konform und vollständig getestet.

- **US-1.1** ✅ Als Quant möchte ich Datumsarithmetik ohne Zeitzonen-/DST-Fehler, um reproduzierbare Schedules zu erhalten.
  AK: Serial-Date-Repräsentation; `addMonths` mit End-of-Month-Regel; Tests `dates.test.ts`.
- **US-1.2** ✅ Als Quant möchte ich Feiertagskalender TARGET2, US (SIFMA), UK, CH, JP, DE und Joint-Kalender, um Zahlungstage korrekt zu rollen.
  AK: Ostern nach Meeus; beobachtete Feiertage (Sat→Fri, Sun→Mon US; Substitute Days UK); `getCalendar("TARGET+US")`.
- **US-1.3** ✅ Als Quant möchte ich Business-Day-Konventionen Following, Modified Following, Preceding, Modified Preceding, Unadjusted.
  AK: MF am 31.05.2026 → 29.05.2026 (Test).
- **US-1.4** ✅ Als Quant möchte ich Tageszählungen ACT/360, ACT/365F, ACT/ACT ISDA, ACT/ACT ICMA, 30/360, 30E/360, 30E/360 ISDA, 1/1, BUS/252.
  AK: Referenzwerte in `dates.test.ts`; Aliase („Actual/360") werden normalisiert.
- **US-1.5** ✅ Als Quant möchte ich Schedules mit Frequenz, Short/Long Front/Back Stub, EOM-Regel, Fixing-Lag und Payment-Lag, um jede Standard-Swapstruktur abzubilden.
  AK: Regulärer 5Y-6M-Schedule = 10 Perioden; Stub-Kennzeichnung; ZC-Schedule; Lags in Geschäftstagen.
- **US-1.6** ✅ Als Quant möchte ich präzise Normalverteilung (West, ~1e-14) und robuste Nullstellensuche (Brent, Newton mit Bracketing), um Implied-Vol und Bootstrapping stabil zu lösen.

## Epic 2 – Marktdaten & Kurven (M2)

- **US-2.1** ✅ Als Risk möchte ich OIS-Kurven (€STR, SOFR, SONIA, SARON) aus OIS-Quotes bootstrappen, um OIS-Diskontierung zu nutzen.
  AK: Alle Quotes repricen mit |Residuum| < 1e-9; DF monoton fallend (Test).
- **US-2.2** ✅ Als Risk möchte ich EURIBOR-3M/6M-Projektionskurven dual-curve (Diskontierung über OIS) aus Depo, FRAs und Swaps stripen.
  AK: Par-Swaps aller Laufzeiten haben |PV| < 1 EUR auf 10 Mio.; Depo-/FRA-Forwards werden exakt reproduziert.
- **US-2.3** ✅ Als Quant möchte ich Interpolation wählen (log-linear DF, linear DF, linear Zero, kubischer Spline Zero, flat forward), um Kurvenglätte und Forward-Verhalten zu steuern.
- **US-2.4** ✅ Als Quant möchte ich Kurven parallel, per Pillar oder mit Shift-Vektor verschieben, um Sensitivitäten und Szenarien zu berechnen.
- **US-2.5** ✅ Als Risk möchte ich einen Swaption-Vol-Cube (Expiry × Tenor, Normal-Vols) mit optionalem SABR-Smile je Gitterpunkt.
  AK: Bilineare Interpolation; Alpha-Rekalibrierung auf ATM; Smile-Vol für beliebigen Strike.
- **US-2.6** ✅ Als Risk möchte ich Caplet-Vol-Flächen (Expiry × Strike) und FX-Vol-Flächen (ATM/25Δ/10Δ RR & BF) mit Delta-Raum-Interpolation und Strike-Konvertierung.
  AK: 25Δ-RR wird aus Smile exakt zurückgewonnen (Test); Strike-Vol-Fixpunktiteration konvergiert.
- **US-2.7** ✅ Als Berater möchte ich FX-Spots inkl. Inversion und Triangulation über USD/EUR, um jede Kreuzrate zu bewerten.
- **US-2.8** ✅ Als Risk möchte ich historische Fixings (EURIBOR, €STR-Compounding) hinterlegen, damit laufende Perioden korrekt bewertet werden und fehlende Fixings als Warnung erscheinen.
- **US-2.9** ✅ Als Berater möchte ich einen deterministischen Beispielmarkt (EUR/USD/GBP/CHF-Kurven, Vols, Spots, Kreditdaten), um offline zu arbeiten und zu demonstrieren.
- **US-2.10** ⏳ Als Admin möchte ich Marktdaten-Adapter (Refinitiv/LSEG, Bloomberg, ICE, EZB €STR, EMMI EURIBOR) mit Snapshot-Versionierung (EoD, Intraday) und Lizenz-Tagging.
- **US-2.11** ⏳ Als Risk möchte ich Kurven-Governance: Freigabe-Workflow für offizielle EoD-Kurven, Vergleich Front-Office- vs. IPV-Kurve, Abweichungsreport.

## Epic 3 – Instrumente & Bewertung (M3)

- **US-3.1** ✅ Als Berater möchte ich Zinsswaps (fix/float, OIS compounded/averaged, Basis, Spread, Gearing, embedded Cap/Floor intrinsisch, Amortisation, Nominalaustausch) bewerten.
  AK: Pay/Receive spiegelsymmetrisch; Par-Satz, fairer Spread, Annuität, PV je Leg, Stückzinsen; Cashflow-Tabelle mit Fixing, Accrual, Zahlung, Satz, DF, PV.
- **US-3.2** ✅ Als Berater möchte ich FRAs (ISDA-Settlement am Startdatum) bewerten.
- **US-3.3** ✅ Als Berater möchte ich Caps, Floors und Collars mit Bachelier (Standard), Black oder shifted Black bewerten, mit Vol aus Fläche oder Override.
  AK: Cap − Floor = Swap (Parität, Test); Collar = Cap − Floor; Delta/Gamma/Vega ausgewiesen.
- **US-3.4** ✅ Als Berater möchte ich europäische Payer-/Receiver-Swaptions physisch oder cash-settled bewerten.
  AK: Payer − Receiver = Forward-Swap-PV; ATM-Straddle-Näherung stimmt; Cash-Annuität nach Yield-Formel.
- **US-3.5** ✅ Als Treasurer möchte ich FX-Forwards und NDFs bewerten und den fairen Forward sowie Forward-Punkte sehen.
  AK: Zinsparität; Fair-Forward-Trade hat PV ≈ 0; Reporting-Währung frei wählbar.
- **US-3.6** ✅ Als Treasurer möchte ich FX-Swaps (Near/Far) mit Swap-Punkten bewerten.
- **US-3.7** ✅ Als Treasurer möchte ich FX-Vanilla-Optionen (Garman-Kohlhagen, Smile aus Fläche), Digitals und Single-Barrier-Optionen (Reiner-Rubinstein) bewerten, inkl. Greeks (Spot-/Forward-Delta, premium-adjusted, Gamma, Vega, Theta, Rho).
  AK: Put-Call-Parität; In + Out = Vanilla (Test); Haug-Referenzwert 0,0291.
- **US-3.8** ✅ Als Treasurer möchte ich Cross-Currency-Swaps mit Nominalaustausch, optional MtM-Reset, bewerten.
- **US-3.9** ✅ Als Berater möchte ich Instrumente über Builder mit Marktkonventionen (EUR 1Y 30E/360 vs 6M ACT/360, USD SOFR OIS, GBP SONIA, CHF SARON) erzeugen, um nicht jede Konvention eingeben zu müssen.
- **US-3.10** ✅ Als Berater möchte ich Upfront-Zahlungen/Prämien im Trade erfassen, damit der PV die Prämie berücksichtigt.
- **US-3.11** ⏳ Als Berater möchte ich strukturierte Swaps (Callable/Bermudan, CMS, Range Accrual) über ein kalibriertes Kurzzinsmodell (Hull-White 1F) bewerten.
- **US-3.12** ⏳ Als Treasurer möchte ich strukturierte FX-Produkte (Participating Forward, Risk Reversal, TARF/Accumulator) als Baukasten aus Vanilla-/Barrier-Bausteinen bewerten.

## Epic 4 – XVA (M4)

- **US-4.1** ✅ Als Risk möchte ich CVA und DVA für Zinsswaps semi-analytisch (Swaption-Replikation, Sorensen-Bollier) mit flacher Hazard-Rate berechnen.
  AK: CVA > 0, < 2 % Nominal im Test; Exposure-Profil (EPE/ENE) je Kupontermin.
- **US-4.2** ✅ Als Risk möchte ich CVA für FX-Forwards über GK-Optionen auf den Forward berechnen.
- **US-4.3** ✅ Als Berater möchte ich Hazard-Rates aus CDS-Spreads ableiten (λ ≈ s/(1−R)).
- **US-4.4** ⏳ Als Risk möchte ich Netting-Set-CVA mit Monte-Carlo (Hull-White + GK), Collateral (CSA-Schwellen, MTA) und FVA.
- **US-4.5** ⏳ Als Risk möchte ich ISDA-SIMM-Sensitivitäten im CRIF-Format exportieren.

## Epic 5 – Risiko & Szenarien (M5)

- **US-5.1** ✅ Als Risk möchte ich DV01 (parallel, zentral), DV01 je Kurve, Key-Rate-Deltas je Pillar, FX-Delta (1 %), Vega (+1bp normal / +1 Vol-Punkt), Theta (1 Tag) und Gamma.
  AK: Payer-Swap DV01 > 0; Summe Buckets ≈ parallel; alle Werte in Reporting-Währung.
- **US-5.2** ✅ Als Risk möchte ich Standard-Szenarien (±100/±200bp BaFin, Steepener, Flattener, EUR ±10 %, IR-Vol +20bp, FX-Vol +5, Roll +1M) auf Portfolio oder Trade anwenden.
- **US-5.3** ✅ Als Berater möchte ich eine What-if-Matrix Zinsen × FX als Heatmap, um dem Kunden Risikoprofile zu zeigen.
- **US-5.4** ✅ Als Quant möchte ich eigene Szenarien definieren (Kurven-Ziel, Parallel, Tenor-Vektor, FX %, Vol, Zeit).
- **US-5.5** ✅ Als Berater möchte ich Live-What-if per Slider und Hotkey (`[`/`]` ±10bp, `\` Reset) mit sofortiger Neubewertung des gesamten Portfolios.
- **US-5.6** ⏳ Als Risk möchte ich historisches VaR/ES aus Kurvenhistorie und P&L-Attribution (Carry, Kurve, Vol, FX).

## Epic 6 – Reporting & Compliance (M6)

- **US-6.1** ✅ Als Prüfer möchte ich einen Bewertungsreport mit Marktdaten-Snapshot (alle Kurven-Pillars, Spots), Cashflow-Tabelle, Sensitivitäten, XVA, IFRS-13-Level und Methodikbeschreibung.
- **US-6.2** ✅ Als Berater möchte ich den MiFID-II-Kostenausweis: Transaktionspreis vs. Fair Value → anfänglicher Marktwert (Kundensicht), Marge in bp und % des Nominals.
  AK: Zahlt der Kunde 3,10 % bei Par 2,88 %, ist der anfängliche Marktwert negativ (Test).
- **US-6.3** ✅ Als Treasurer möchte ich Cashflows als CSV (Semikolon, deutsches Format) und den Report als JSON exportieren.
- **US-6.4** 🔶 Als Berater möchte ich den Report drucken (Browser-Print) – PDF-Template mit Logo/Disclaimer in v1.1.
- **US-6.5** ⏳ Als Risk möchte ich EMIR-Refit-Bewertungsfelder (Valuation amount/currency/timestamp/type MTMA) je Trade exportieren.
- **US-6.6** ⏳ Als Prüfer möchte ich einen Audit-Trail: wer hat wann welchen Trade/Marktdaten/Parameter geändert; Report-Hash.
- **US-6.7** ⏳ Als Berater möchte ich Beratungsprotokoll/Geeignetheitserklärung (WpHG) und Termsheet aus dem Trade generieren (Docx/PDF).

## Epic 7 – API & Integration (M7)

- **US-7.1** ✅ Als Entwickler möchte ich eine REST-API mit OpenAPI-Dokumentation (`/docs`) für Pricing, Risiko, Szenarien, XVA, Report, Marktdaten und Trades.
- **US-7.2** ✅ Als Entwickler möchte ich Datumsangaben als ISO-8601 senden und empfangen, ohne Serial-Dates kennen zu müssen.
- **US-7.3** ✅ Als Entwickler möchte ich Kurven per API aus eigenen Quotes bootstrappen (Preview oder in Snapshot ersetzen), Spots/Fixings setzen und den Bewertungstag wechseln.
- **US-7.4** ✅ Als Entwickler möchte ich Cashflows als CSV über `POST /api/report?format=csv` erhalten.
- **US-7.5** ✅ Als Entwickler möchte ich Trade-CRUD mit Validierung durch Probe-Bewertung.
- **US-7.6** ⏳ Als Admin möchte ich Persistenz (PostgreSQL), Mandanten, Rollen (Berater/Risk/Prüfer/Admin) und OIDC-Login.
- **US-7.7** ⏳ Als Treasurer möchte ich ein Excel-Add-in (`=DERIVA.PV(...)`, `=DERIVA.PAR(...)`), das gegen die API rechnet.
- **US-7.8** ⏳ Als Entwickler möchte ich Batch-EoD-Bewertung (Portfolio-Datei rein, Bewertungsdatei + Report raus) und Webhooks.

## Epic 8 – Workstation UI mit Hotkeys (M8)

- **US-8.1** ✅ Als Berater möchte ich eine Command Palette (`Ctrl/⌘+K`, `/`) mit Fuzzy-Suche über Befehle, Ansichten und Trades.
- **US-8.2** ✅ Als Berater möchte ich Bloomberg-artige Schnelleingabe in natürlicher Kurzform (`irs 10y pay 3.1% 10m`, `collar 7y 3.5/1.5 6m`, `swpt 1y5y payer 3% 10m`, `fxf eurusd -2m 1.1725 2027-03-15`, `fxo eurusd put 1.15 3m 9m`) mit Live-Vorschau und Enter-Anlage.
  AK: Parser-Tests `quick-parser.test.ts`; Fehler werden als Hinweis angezeigt.
- **US-8.3** ✅ Als Berater möchte ich Chord-Hotkeys für Navigation (`g b/p/c/s/m/r`), Neuanlage (`n s/c/w/f/o`) und Einzeltasten für Aktionen (`j/k`, `Enter`, `d`, `Shift+D`, `f`, `r`, `Shift+P`, `[`, `]`, `\`, `c`, `t`, `i`, `?`, `Esc`, `Alt+1..6`, `Ctrl+E`).
  AK: Chord-Prefix wird in der Statusleiste angezeigt; in Eingabefeldern gelten nur globale Kürzel; Cheat-Sheet über `?`.
- **US-8.4** ✅ Als Berater möchte ich einen Blotter mit Sortierung, Filter (Zins/FX/Optionen), Suche, PV, DV01, Fälligkeit, Status-Badges und Summenzeile sowie KPI-Kacheln (Portfolio-PV, DV01, PV je Kontrahent, PV je Typ).
- **US-8.5** ✅ Als Berater möchte ich einen Pricing-Workspace: Trade-Editor je Instrument, PV-KPI, Kennzahl (Par/Forward/Prämie), DV01/Theta, Analytics-Tabelle, Key-Rate-Chart, Cashflow-Tabelle, What-if-Slider.
- **US-8.6** ✅ Als Berater möchte ich „Par übernehmen" (`Shift+P`) und „Richtung tauschen" (`f`) per Tastendruck.
- **US-8.7** ✅ Als Risk möchte ich eine Kurvenansicht mit Zero-/Forward-Chart, Vergleichskurve, editierbaren Quotes (Live-Re-Bootstrapping), Pillar-Tabelle und ±10bp-Buttons.
- **US-8.8** ✅ Als Risk möchte ich eine Szenarioansicht (Balkenchart, Tabelle, Heatmap Zinsen × FX, P&L je Trade) für Portfolio oder Einzeltrade.
- **US-8.9** ✅ Als Risk möchte ich eine Marktansicht: Bewertungstag, FX-Spots (editierbar), Swaption-ATM-Heatmap, FX-Vol-Fläche, Caplet-Vols, Kreditdaten.
- **US-8.10** ✅ Als Prüfer möchte ich eine Report-Ansicht mit Fair Value (risikofrei/CVA/DVA/bilateral), Kostentransparenz-Eingaben, Exposure-Chart, Sensitivitäten, Methodik, Download JSON/CSV, Druck.
- **US-8.11** ✅ Als Berater möchte ich einen Inspector (rechte Seitenleiste) mit Kurzprofil des ausgewählten Trades (PV, DV01, Theta, Vega, FX-Delta, Analytics) und Hotkey-Hinweisen.
- **US-8.12** ✅ Als Nutzer möchte ich Dark/Light-Theme (`t`), Reporting-Währung (`c`), Toasts für Aktionen und eine Statusleiste mit Bewertungszeit und Hotkey-Hinweisen.
- **US-8.13** ✅ Als Berater möchte ich die App offline (ohne API) nutzen, weil der Bewertungskern im Browser läuft.
- **US-8.14** ⏳ Als Berater möchte ich Layout-Presets (Split-View Trade vs. Alternative), gespeicherte Arbeitsbereiche und Multi-Monitor-Fenster.
- **US-8.15** ⏳ Als Berater möchte ich einen Kundenmodus (Präsentationsansicht ohne interne Margen) mit Umschalt-Hotkey.

## Epic 9 – Architektur, Qualität, Betrieb

- **US-9.1** ✅ Als Entwickler möchte ich ein pnpm-Monorepo mit `packages/pricing-core`, `apps/api`, `apps/web`, strikter TypeScript-Konfiguration und gemeinsamer Basis.
- **US-9.2** ✅ Als Entwickler möchte ich Unit-/Integrationstests (Vitest) für Daten, Modelle, Pricer, API und UI mit Referenzwerten (Haug, Hull, Paritäten, Round-Trips).
- **US-9.3** ✅ Als Entwickler möchte ich CI (GitHub Actions): Install, Typecheck, Tests, Build auf jedem Push/PR.
- **US-9.4** ✅ Als Architekt möchte ich Architecture Decision Records für Stack, Kernbibliothek, Datumsmodell, Modelle, Marktdaten, Persistenz, API-Datumsformat, UI-Hotkeys.
- **US-9.5** ✅ Als Entwickler möchte ich eine README mit Quickstart, Hotkey-Übersicht und API-Beispielen.
- **US-9.6** ⏳ Als Admin möchte ich Container-Images, Helm-Chart, Health/Readiness, strukturierte Logs, Metriken (Bewertungen/s, Latenz) und DORA-konforme Betriebsdokumentation.
- **US-9.7** ⏳ Als Quant möchte ich Modellvalidierungs-Suite gegen QuantLib/ORE-Referenzwerte (MaRisk-Validierung) als CI-Job.
- **US-9.8** ⏳ Als Entwickler möchte ich Web Worker / WASM-Build des Pricing-Cores für Portfolios > 1.000 Trades.

---

## Priorisierung / Release-Plan

| Release | Inhalt |
|---|---|
| **v0.1 (dieses Repository)** | Epics 1–8 ✅-Stories, Epic 9.1–9.5 |
| **v1.0** | US-2.10/2.11 Marktdaten-Adapter & Governance, US-6.4/6.5/6.6 PDF/EMIR/Audit, US-7.6 Persistenz & Auth, US-9.6 Betrieb |
| **v1.1** | US-3.11/3.12 Strukturen, US-4.4 Netting-CVA, US-6.7 Dokumente, US-7.7 Excel-Add-in, US-8.14/8.15 |
| **v1.2** | US-4.5 SIMM/CRIF, US-5.6 VaR & Attribution, US-9.7 Validierungs-Suite, US-9.8 Worker/WASM |
