## Zusammenfassung

<!-- Was ändert sich und warum? Ein bis drei Sätze. -->

## Bezug

- Epics / User Stories: <!-- z. B. US-7.9 (docs/product/02-epics-und-user-stories.md) -->
- Review-Findings: <!-- z. B. N-03, F-24 (docs/quality/review-*.md) -->
- ADRs: <!-- neue oder geänderte ADRs in docs/architecture/02-adrs.md -->

## Art der Änderung

- [ ] Fehlerbehebung
- [ ] Neues Feature / Instrument / Endpunkt
- [ ] Modell- oder Konventionsänderung (Referenznachweis erforderlich, siehe CONTRIBUTING.md „Modellvalidierung")
- [ ] Dokumentation / ADR
- [ ] Build / CI / Abhängigkeiten

## Checkliste

- [ ] `pnpm build && pnpm test` grün (Core, API, Web); Coverage-Schwellen eingehalten
- [ ] `pnpm lint` und `pnpm format:check` grün
- [ ] JSON-Schema (`apps/api/src/schemas.ts`) und OpenAPI (`operationId`, Responses) bei API-Änderungen nachgezogen
- [ ] Neue Trade-Felder: Core-Typ, Schema, Editor, Badge, Datums-Mapper (`lib/dates.ts`) synchron
- [ ] CHANGELOG.md-Eintrag unter „Unreleased" / aktueller Version
- [ ] Regulatorik-Mapping (`docs/compliance/01-regulatorik-mapping.md`) aktualisiert, falls Compliance-Features betroffen
- [ ] Keine lizenzpflichtigen Marktdaten, keine Secrets

## Nachweis

<!-- Testausgabe, Referenzwerte (QuantLib/Haug/Hull), Screenshots, curl-Beispiele -->
