# DERIVA – Bewertungsrubrik (Orchestrator)

Ziel: Gesamtscore ≥ 99,8 / 100. Jede Dimension wird von einem unabhängigen Review-Agenten bewertet;
der Orchestrator konsolidiert, priorisiert die Lücken, lässt sie schließen und bewertet erneut.

| # | Dimension | Gewicht | Kriterien (Auszug) |
|---|---|---|---|
| 1 | Marktabdeckung Features & Module | 20 % | Instrumente, Kurven, Marktdaten, Risiko, XVA, Reporting, Compliance-Bausteine im Vergleich zu Bloomberg SWPM/OVML, Numerix, Quantifi, LPA Capmatix, TMS, QuantLib/ORE |
| 2 | Pricing-Korrektheit & Methodik | 20 % | Konventionen, Multi-Curve, Modelle, Greeks, Grenzfälle, Referenzwerte, Testabdeckung, numerische Stabilität |
| 3 | UI/UX & Hotkeys | 20 % | Visuelle Qualität, Konsistenz, Lesbarkeit, Tastaturbedienung, Fehlermeldungen, Responsivität, Barrierefreiheit |
| 4 | User Flows | 15 % | Indikation im Kundengespräch, Stichtagsbewertung, IPV, Prüferreport, Onboarding/Erlernbarkeit, Fehlerpfade |
| 5 | API, Architektur, Code-Qualität | 15 % | OpenAPI-Vollständigkeit, Validierung, Fehlerbehandlung, Erweiterbarkeit, Tests, CI, Sicherheit |
| 6 | Dokumentation & Compliance | 10 % | Epics/Stories, ADRs, Methodik-Doku, regulatorische Abdeckung (MiFID II, IFRS 13, EMIR, BGH), Nachvollziehbarkeit |

Skala: 0–100 je Dimension. 100 = keine bekannte Lücke gegenüber dem Stand der Technik für den v1-Scope,
alle Flows ohne Reibung, alle Tests grün, Dokumentation vollständig und konsistent.
Abzüge: kritischer Fehler −10 bis −25, fehlendes Kernfeature −3 bis −8, UX-Reibung −1 bis −3, kosmetisch −0,2 bis −1.

Die Runden werden in `01-scorecard-runde-N.md` dokumentiert.
