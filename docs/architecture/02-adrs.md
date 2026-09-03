# Architecture Decision Records

## ADR-001 · Ein Bewertungskern in TypeScript, isomorph für Browser und Server

**Kontext.** Wettbewerber trennen Pricing (C++/C#-Library im Backend) und UI; jede Interaktion ist ein Roundtrip. Für Live-What-if und Offline-Demos brauchen wir Bewertung im Browser; für Integration und Batch brauchen wir denselben Kern serverseitig.
**Entscheidung.** `@deriva/pricing-core` als reine TypeScript-ESM-Bibliothek ohne I/O und ohne Node-Abhängigkeiten. Identische Ergebnisse in Web und API.
**Alternativen.** QuantLib (C++/WASM): mächtig, aber 10+ MB WASM, schwer erweiterbar im Team, Lizenz-/Build-Komplexität. Python/QuantLib-Backend: kein Browser-Betrieb, Roundtrips. Rust/WASM-Kern: attraktiv für v2, aber höhere Einstiegshürde.
**Konsequenzen.** + Ein Code-Pfad, sofortiges Feedback, einfache Tests. − Für Monte-Carlo/Kalibrierung (v1.1) ggf. Worker/WASM nötig (US-9.8).

## ADR-002 · Serial-Date als Datumsmodell

**Kontext.** JS `Date` ist zeitzonenbehaftet; Finanzdaten sind reine Kalendertage.
**Entscheidung.** `SerialDate = number` (Tage seit 1970-01-01 UTC). Alle Kalender-/Tageszählungsfunktionen arbeiten auf Ganzzahlen. ISO-Strings nur an den Systemgrenzen (API, UI-Inputs).
**Konsequenzen.** + Schnell, vergleichbar, kein DST-Bug. − Lesbarkeit im Debugger (mit `toISO` behelfen).

## ADR-003 · Multi-Curve mit OIS-Diskontierung und sequentiellem Bootstrapping

**Kontext.** Seit der Benchmark-Reform ist OIS-Diskontierung (€STR/SOFR) Marktstandard; EURIBOR-Tenorkurven sind Projektionskurven.
**Entscheidung.** `MarketContext.discountCurveId` je Währung (optional je Collateral); Indexkurven über `RateIndex.curveId`. Bootstrapping sequentiell mit Brent je Pillar, dual-curve für IBOR-Kurven. Interpolation log-linear in DF als Default.
**Alternativen.** Globaler Solver (alle Pillars simultan): genauer bei nicht-lokalen Interpolationen, aber komplexer; für v1 nicht nötig.
**Konsequenzen.** + Residuen ~1e-12; jede Kurve reproduziert ihre Quotes exakt. − Kubische Interpolation in Kombination mit sequentiellem Bootstrap ist nur näherungsweise exakt (dokumentiert).

## ADR-004 · Bachelier als Standard für Zinsoptionen, Garman-Kohlhagen für FX

**Kontext.** Negative/niedrige Zinsen machten Black-76 unbrauchbar; der Markt quotiert Normal-Vols. FX-Optionen werden in Delta-Konvention quotiert.
**Entscheidung.** Cap/Floor/Swaption default Bachelier; Black und shifted Black wählbar; SABR (Hagan) für Swaption-Smile mit Alpha-Rekalibrierung auf ATM. FX: GK-Vanilla, Digitals analytisch, Single-Barrier nach Reiner-Rubinstein; Smile aus ATM/RR/BF in Delta-Raum mit Fixpunkt-Konvertierung Strike↔Delta.
**Konsequenzen.** + Marktkonform, geschlossene Formeln, Greeks analytisch. − Barrier ohne Vanna-Volga-Korrektur (v1.1), keine Pfadabhängigkeit.

## ADR-005 · Marktdaten als austauschbarer Snapshot; Sample-Markt im Repo

**Kontext.** Live-Marktdaten sind lizenzpflichtig und kundenspezifisch.
**Entscheidung.** `MarketContext` ist ein serialisierbarer Snapshot. v0.1 liefert einen deterministischen Beispielmarkt (indikative Levels Sept. 2026). Adapter (LSEG, Bloomberg, ICE, EZB €STR, EMMI EURIBOR) erzeugen denselben Snapshot-Typ.
**Konsequenzen.** + Tests und Demos sind reproduzierbar; UI klar als „indikativ" gekennzeichnet. − Kein Live-Betrieb ohne Adapter.

## ADR-006 · Zustandslose API mit Store-Interfaces; Persistenz und Auth als Adapter

**Kontext.** v0.1 soll ohne Infrastruktur laufen; v1.0 braucht Mandanten, Rollen, Audit.
**Entscheidung.** Fastify-Routen sprechen `MarketStore`/`TradeStore`-Interfaces (In-Memory). PostgreSQL-Implementierung und OIDC-Middleware werden ergänzt, ohne Routen zu ändern.
**Konsequenzen.** + Schneller Start, testbar via `app.inject`. − Kein Multi-Instanz-Betrieb bis Persistenz vorhanden.

## ADR-007 · ISO-8601 an der API-Grenze

**Entscheidung.** Requests/Responses tragen Datumsfelder als `YYYY-MM-DD`; ein rekursiver Mapper (`datesToSerial`/`datesToIso`) konvertiert bekannte Schlüssel. Interne Typen bleiben Serial-Dates.
**Konsequenzen.** + Lesbare API, Excel-/TMS-freundlich. − Schlüsselliste muss bei neuen Datumsfeldern gepflegt werden (Test deckt Kernfelder ab).

## ADR-008 · Deklaratives Hotkey-System mit Chords

**Kontext.** Berater brauchen Terminal-Geschwindigkeit; Hotkeys dürfen Eingabefelder nicht stören.
**Entscheidung.** Eine `HOTKEYS`-Liste (id, keys, label, group, global) ist Single Source of Truth für Dispatcher, Palette und Cheat-Sheet. Chords (`g p`) mit 900-ms-Fenster und Statusanzeige. Einzeltasten sind in editierbaren Feldern deaktiviert, Modifier-Kürzel global.
**Alternativen.** Bibliotheken (Mousetrap, react-hotkeys-hook): weniger Kontrolle über Chords/Statusanzeige.
**Konsequenzen.** + Konsistenz, testbar (`useHotkeys.test.ts`). − Layout-Abhängigkeit bei Symboltasten (gelöst: Symbolvergleich ohne Shift-Zustand).

## ADR-009 · Zustand über zustand, synchrone Neubewertung

**Entscheidung.** Ein Store; Aktionen bewerten betroffene Trades synchron neu (Bewertung < 5 ms). Risiko wird lazy berechnet und pro Trade gecacht, Cache bei Marktänderung invalidiert.
**Konsequenzen.** + Einfaches mentales Modell, keine Race Conditions. − Bei > 500 Trades Auslagerung in Web Worker (US-9.8).

## ADR-010 · CSS-Design-Tokens statt UI-Framework

**Entscheidung.** Eigene Tokens (Farben, Radien, Typografie) und ~600 Zeilen CSS; Dark/Light über `data-theme`. Charts (ECharts) lesen Tokens aus CSS-Variablen.
**Konsequenzen.** + Vollständige Kontrolle über die Trading-Ästhetik, kleines Bundle. − Kein fertiges Komponenten-Set (bewusst; Tabellen/Formulare sind einfach).

## ADR-011 · Semi-analytisches CVA in v1

**Entscheidung.** CVA für Swaps über Swaption-Replikation (Sorensen-Bollier) mit ATM-Normal-Vol; FX-Forwards über GK; flache Hazard-Rate aus CDS-Spread. Netting/Collateral/Monte-Carlo in v1.1.
**Konsequenzen.** + Millisekunden, prüferverständlich, ausreichend für Einzelgeschäfte. − Kein Netting-Vorteil, keine Wrong-Way-Risk-Modellierung.

## ADR-012 · Deutsch als Produktsprache, Englisch im Code

**Entscheidung.** UI, Reports, Dokumentation deutsch (Zielmarkt DACH); Code, Typen, Kommentare englisch (Wartbarkeit, Open-Source-Fähigkeit). i18n-Schicht in v1.0.
