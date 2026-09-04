# DERIVA – Produktvision und Modulübersicht

## 1. Vision

**DERIVA ist die tastaturzentrierte Bewertungs-Workstation für Zins- und Währungsderivate – transparent bis auf den einzelnen Cashflow, so schnell wie ein Terminal, so zugänglich wie eine moderne Web-App.**

Die Recherche (siehe `docs/research`) zeigt drei Lücken, die kein Anbieter zwischen Bloomberg-Terminal, LPA
Capmatix, den Treasury-Management-Systemen und Excel + QuantLib schließt:

| Lücke | Heute | DERIVA |
|---|---|---|
| **Geschwindigkeit im Kundengespräch** | Bloomberg ist tastaturschnell, aber 24–28 TUSD/Seat und Terminal-Ästhetik; Web-Tools sind maus- und formularlastig | Command Palette + Schnelleingabe (`irs 10y pay 3.1% 10m`), Vim-/GitHub-artige Chord-Hotkeys, Live-What-if per Tastendruck |
| **Bewertungstransparenz** | Kurven-Defaults sind Black-Box (SWDF), TMS liefern „MtM intern" | Jede Zahl herleitbar: Kurvenaufbau, Pillars, Cashflow-Tabelle mit DF, Modellangabe, Methodikbeschreibung – prüferfest (IFRS 13, IDW RS HFA 47) |
| **Kunden- und Prozesssicht** | Bank-Tools bewerten aus Institutssicht; Prozess-Tools (Captano/Capmatix) ohne eigenen Bewertungskern | Fair Value vs. Angebotspreis (anfänglicher Marktwert, Marge in bp), CVA/DVA, MiFID-II-Kostenausweis – für Bank *und* Kunde |

**Zielgruppen (Personas):**

1. **Firmenkundenberater / Sales** (Sparkasse, Volksbank, Landesbank): Indikationen im Gespräch, Alternativen vergleichen, Beratungsdokumentation.
2. **Treasurer im Mittelstand / Kommune**: Zweitpreis vor Abschluss, Stichtagsbewertung, Hedge-Accounting-Nachweis, Nachweis des anfänglichen negativen Marktwerts.
3. **Marktfolge / Risikocontrolling (IPV)**: Unabhängige Preisverifizierung, Sensitivitäten, Szenarien, MaRisk-Modellvalidierung.
4. **Wirtschaftsprüfer / Revision**: Nachvollziehbarer Bewertungsreport, Methodik, Marktdaten-Snapshot, Audit-Trail.
5. **Quant / Entwickler**: Offene, getestete Pricing-Bibliothek und REST-API zur Integration in Kernbank-/Treasury-Systeme.

## 2. Produktprinzipien

1. **Keyboard first, mouse optional.** Jede Funktion ist per Tastatur erreichbar; die Command Palette ist das Zentrum.
2. **Zeige die Rechnung, nicht nur das Ergebnis.** Cashflows, Diskontfaktoren, Forwards, Vols, Modell – immer sichtbar.
3. **Sofortiges Feedback.** Bewertung im Browser in Millisekunden; What-if-Slider und Hotkeys bewerten live neu.
4. **Ein Bewertungskern für alles.** Dieselbe Bibliothek läuft im Browser (Offline-Modus), im API-Server und in Batch-Jobs.
5. **Regulatorik als Feature.** MiFID-II-Kostentransparenz, IFRS-13-Level, BGH-Offenlegung, EMIR-Bewertungsfelder sind eingebaut, nicht angeflanscht.
6. **Marktstandard-Modelle, keine Exoten in v1.** Multi-Curve/OIS, Bachelier & shifted Black, SABR-Smile, Garman-Kohlhagen mit Delta-Smile, Reiner-Rubinstein-Barrieren.

## 3. Modulübersicht

```
┌────────────────────────────────────────────────────────────────────────────┐
│  M8 Workstation (Web-UI)                                                    │
│  Blotter · Pricing-Workspace · Kurven · Szenarien · Markt · Report          │
│  Command Palette · Hotkeys · Inspector · What-if · Dark/Light               │
├────────────────────────────────────────────────────────────────────────────┤
│  M7 API & Integration (Fastify, OpenAPI)   │  M6 Reporting & Compliance     │
│  /price /risk /scenarios /xva /report      │  Bewertungsreport + Hashes,    │
│  /hedge /documents /emir /audit /snapshot  │  EMIR, Termsheet, Geeignetheit │
├────────────────────────────────────────────┴───────────────────────────────┤
│  M5 Risiko & Szenarien        │  M4 XVA · M11 Hedge Accounting              │
│  DV01, Key-Rate, Par-Risk,    │  CVA/DVA (Swaption-Replikation, GK,         │
│  FX-Delta, Vega-Buckets,      │  Delta-Normal), Exposure-Profile;           │
│  IRRBB-Szenarien, Grid        │  hypothetisches Derivat, Dollar-Offset, OLS │
├───────────────────────────────┴────────────────────────────────────────────┤
│  M3 Instrumente & Pricer                                                    │
│  IRS (fix/float/OIS/Basis, amortisierend), FRA, Cap/Floor/Collar, Swaption  │
│  (physisch/cash), FX-Forward/NDF, FX-Swap, FX-Option (Vanilla/Digital/      │
│  Barrier), Cross-Currency-Swap (const/MtM-Reset)                            │
├────────────────────────────────────────────────────────────────────────────┤
│  M2 Marktdaten & Kurven                                                     │
│  Bootstrapping (Depo/FRA/Swap/OIS, Dual-Curve), Interpolation, Vol-Flächen  │
│  (Swaption-Cube + SABR, Caplet, FX ATM/RR/BF), FX-Spots, Fixings, Credit    │
├────────────────────────────────────────────────────────────────────────────┤
│  M1 Fundament                                                               │
│  Datumsarithmetik, Kalender (TARGET, US, UK, CH, JP, DE, Joint), Business-  │
│  Day-Konventionen, Tageszählung, Schedules mit Stubs/Lags, Normalverteilung,│
│  Brent/Newton, Interpolation                                                │
└────────────────────────────────────────────────────────────────────────────┘
```

### Modulbeschreibungen

| Modul | Zweck | Paket / Ort | Status v0.3 |
|---|---|---|---|
| **M1 Fundament** | Fehlerfreie Datums- und Konventionslogik als Basis jeder Bewertung | `packages/pricing-core/src/dates`, `src/math` | ✅ implementiert, getestet |
| **M2 Marktdaten & Kurven** | Kurven aus Depos/FRAs/Futures/Swaps/OIS/Tenor-Basis/XCCY-Basis bauen, Vol-Flächen abfragen und plausibilisieren, Snapshots exportieren/importieren, Index-/Konventionsregister (G5 + NOK/SEK/DKK/PLN, `registerRateIndex`), Kurven aus Quotes in der Workstation („+ Kurve“) | `src/curves`, `src/models`, `src/market` | ✅ inkl. Snapshot-Format und Register; Live-Adapter offen |
| **M3 Instrumente & Pricer** | Trade-Modell und analytische Bewertung aller v1-Instrumente | `src/instruments`, `src/pricing` | ✅ |
| **M4 XVA** | Kreditrisikoadjustierung für Fair Value nach IFRS 13 | `src/xva` | ✅ alle Instrumente (Swaption-Replikation, GK, Delta-Normal) |
| **M5 Risiko & Szenarien** | Sensitivitäten und Stress für Steuerung und IPV | `src/risk` | ✅ |
| **M6 Reporting & Compliance** | Prüfungsfähige Reports mit Hashes, IFRS-13-Level, MiFID-Kosten, EMIR-Felder, Termsheet/Geeignetheitserklärung, Exporte | `src/reporting`, UI Report-View | ✅ JSON/CSV/Markdown; PDF-Template v1.0 |
| **M7 API & Integration** | REST/OpenAPI (operationId, Response-Schemas) mit diskriminierter Trade-Validierung, ETag/If-Match/If-None-Match, Snapshot-ID-Header, Audit-Trail, Security-Header | `apps/api` | ✅ In-Memory-Store; Persistenz/Auth-Adapter offen |
| **M8 Workstation** | Keyboard-first UI | `apps/web` | ✅ |
| **M9 Marktdaten-Adapter** | Refinitiv/Bloomberg/ICE/EZB/EMMI-Konnektoren, Snapshot-Store | – | ⏳ Roadmap |
| **M10 Beratungsprozess** | Termsheet, Geeignetheitserklärung (§ 64 WpHG) mit Kostenausweis und Szenarien | `src/reporting/documents.ts`, API `/api/documents/*` | ✅ Dokumente; Workflow/Signatur ⏳ |
| **M11 Hedge Accounting** | IFRS 9 / HGB Effektivitätstests, hypothetisches Derivat, OCI/GuV-Split | `src/hedge`, API `/api/hedge/*` | ✅ |
| **M12 Excel-Add-in** | Funktionen `DERIVA.PV`, `DERIVA.PAR` gegen API | – | ⏳ Roadmap |

## 4. Abgrenzung v1 (bewusst nicht enthalten)

- Bermudan-Swaptions, CMS-Spread-Optionen, Range Accruals, TARF/Accumulator (erfordern Modellkalibrierung / Monte Carlo).
- Inflationsderivate (Zero-Coupon-Inflationsswap auf EUR HICPxT, Inflationskurve mit Index-Lag und Saisonalität) – Roadmap v1.1 als US-3.15; Zielsegment Versicherer/Pensionskassen, setzt die Inflations-Indexhistorie des Marktdaten-Adapters (M9) voraus.
- Vollständiges XVA (FVA, KVA, MVA), ISDA-SIMM-Berechnung (nur CRIF-Export geplant).
- Live-Marktdaten (Lizenzthema), Persistenz, Mandanten/Rollen (v1.0 via Adapter, siehe Release-Plan in `02-epics-und-user-stories.md`).

## 5. Erfolgskriterien

| Kriterium | Ziel |
|---|---|
| Bewertung eines 10Y-Swaps im Browser | < 5 ms |
| Portfolio 100 Trades inkl. DV01 | < 1 s |
| Par-Swap-Repricing nach Bootstrapping | |PV| < 1 EUR auf 10 Mio. Nominal |
| Alle Kernfunktionen ohne Maus | 100 % |
| Neue Indikation im Kundengespräch | < 10 s (Schnelleingabe + Enter) |
| Report-Nachvollziehbarkeit | Prüfer kann jede Zahl aus Report reproduzieren |
