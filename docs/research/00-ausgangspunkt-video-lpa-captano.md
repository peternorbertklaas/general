# Ausgangspunkt: Video „LPA Captano – Softwarelösung für mehr Prozess- und Rechtssicherheit"

**Quelle:** https://www.youtube.com/watch?v=nMiqsbpsXZA (LPA, veröffentlicht 27.06.2017)

> Hinweis: YouTube ist aus der Build-Umgebung nicht abrufbar (Egress-Sperre). Titel, Datum und
> Beschreibung wurden über Suchmaschinen-Snippets verifiziert; der Videoinhalt selbst wurde aus den
> öffentlichen Produktbeschreibungen von LPA Captano rekonstruiert.

## Was das Video zeigt (rekonstruiert)

LPA Captano war das zentrale Vertriebs- und Pricing-Tool von Lucht Probst Associates (LPA) für das
**Zins- und Währungsmanagement im Firmenkundengeschäft von Banken**. Kernbotschaft des Videos:
*„ein System, das komfortables Pricing ermöglicht"* und den Beratungsprozess **prozess- und rechtssicher**
macht (MiFID II / WpHG).

Funktionsbausteine laut LPA-Produktkommunikation 2017–2019:

| Baustein | Inhalt |
|---|---|
| Strukturierung & Pricing | Plain-Vanilla- und strukturierte Zins-/FX-Derivate, Cross-Asset-Strukturen, Anbindung an die interne Pricing-Library der Bank |
| Simulation & Risiko | Szenarien, Risikokennzahlen, Vergleich von Absicherungsalternativen |
| Beratungsprozess (MiFID II) | Geeignetheitsprüfung, Geeignetheitserklärung, Beratungsprotokoll, Zielmarkt, Ex-ante-Kostenausweis, KID |
| Dokumentenerzeugung | Termsheets, Confirmations, Pitchbooks, Szenariorechnungen – „on the fly" aus dem Pricing (LPADoc) |
| Post-Trade | Buchung in Front-Office-Systeme, Zahlungs-/Settlement-Prozesse, revisionssichere Prozesskette |
| Digitaler Kundenkanal | Digital Client Interaction/Advisory: Web/App-Beratung mit oder ohne Berater, Online-Banking-Integration |

Seit 2020 sind Captano, LPADoc und Digital Advisory in der Plattform **Capmatix** (OTC Suite) gebündelt.

## Was wir daraus für DERIVA ableiten

1. **Der Markt kauft Prozess + Pricing, nicht Pricing allein.** Captano verkauft Rechtssicherheit; der
   Bewertungskern war eine Integrationsschicht zur Bank-Library. DERIVA dreht das um: ein transparenter,
   eigener Bewertungskern (Multi-Curve, Bachelier/SABR, Garman-Kohlhagen) *plus* die Prozessbausteine.
2. **Bewertungstransparenz ist die Lücke.** Weder Captano noch Wettbewerber zeigen dem Nutzer den
   Kurvenaufbau, jeden Cashflow und die Herleitung des Fair Values. Das ist prüferrelevant (IFRS 13, IDW RS
   HFA 35, BGH-Urteile zum anfänglichen negativen Marktwert).
3. **Berater arbeiten unter Zeitdruck im Kundengespräch.** Eine tastaturzentrierte Oberfläche
   (Command Palette, Hotkeys wie in Bloomberg, aber modern) ist im Segment nicht vorhanden.
4. **Zielgruppen:** Firmenkundenberater/Sales in Sparkassen, Volks- und Raiffeisenbanken, Landesbanken;
   Treasurer im Mittelstand; Kommunen; Marktfolge/Risikocontrolling (IPV); Wirtschaftsprüfer.

Weiterführend: [01-lpa-analyse.md](01-lpa-analyse.md), [02-wettbewerber.md](02-wettbewerber.md),
[03-domaene-markt-methodik-regulatorik.md](03-domaene-markt-methodik-regulatorik.md).
