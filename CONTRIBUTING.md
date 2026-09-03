# Mitwirken an DERIVA

## Entwicklungsumgebung

```bash
pnpm install
pnpm build          # Core → API → Web in dieser Reihenfolge (API/Web importieren das Core-dist)
pnpm test           # baut vorher den Core (pretest) und führt alle Tests aus (Core, API, Web)
pnpm dev            # Core im tsc-Watch + API auf :4000 + Web auf :5173 (parallel, gestreamt)
pnpm typecheck && pnpm lint && pnpm format:check
```

Node ≥ 20, pnpm 10 (Version aus `package.json#packageManager`). Einzelne Pakete: `pnpm dev:core`, `pnpm dev:api`, `pnpm dev:web`, `pnpm --filter @deriva/api test`.

**Warum `pnpm build` vor allem anderen?** `apps/api` und `apps/web` importieren `@deriva/pricing-core` aus `packages/pricing-core/dist` (`exports` zeigt auf `dist`). Ein veraltetes `dist` liefert alte Ergebnisse, ohne dass ein Test fehlschlägt – deshalb bauen `pnpm test`/`pnpm typecheck` den Core vorher (`pretest`/`pretypecheck`), die CI baut ihn explizit, und `pnpm dev` hält ihn per `tsc --watch` aktuell. Vor einer Abgabe immer `pnpm build` ausführen, damit `apps/api/dist` und `apps/web/dist` dem Quellstand entsprechen (`node apps/api/dist/server.js` meldet die Version unter `GET /api/health`).

## Struktur und Regeln

- **Pricing-Core** ist nebenwirkungsfrei: keine I/O, keine Node-APIs, keine Mutation von `MarketContext`/`Curve`. Domänenfehler werfen `PricingError` mit `code` (ADR-022). Neue Instrumente = Typ in `instruments/types.ts` + Pricer in `pricing/` + Case im Dispatcher `pricing/price.ts` + Builder + Editor-Case (`apps/web/src/components/TradeEditor.tsx`) + Badge (`lib/trade-ops.ts`) + JSON-Schema-Variante (`apps/api/src/schemas.ts`, `oneOf` je `type`) + Datums-Schlüssel (`apps/api/src/lib/dates.ts`).
- **Datumsangaben** intern als Serial-Dates, an der API als ISO-8601 (`apps/api/src/lib/dates.ts`).
- **API-Vertrag:** jede Route hat `operationId`, `schema.body`/`querystring`/`params` und `response` (2xx + Fehler über `responses(...)` in `schemas.ts`); der Vertragstest `apps/api/src/contract.test.ts` friert die Operationsliste ein und prüft, dass jeder Sample-Trade der Builder das Schema passiert. Fehler laufen ausschließlich über `lib/errors.ts` (ADR-025). Bewertungsbezogene Routen setzen `config: { marketHeader: true }` (Header `X-Market-Snapshot-Id`).
- **Tests sind Pflicht**: Referenzwerte (Haug/Hull/QuantLib), Paritäten, Round-Trips. `vitest run` muss in allen Paketen grün sein; Coverage-Schwellen in den `vitest.config.ts`.
- **Formatierung:** Prettier (`.prettierrc.json`, `.editorconfig`); `pnpm format` vor dem Commit, `pnpm format:check` ist CI-Gate. Prosa-Dokumentation unter `docs/` ist bewusst ausgenommen (`.prettierignore`).
- **Sprache:** Code, Typen, Kommentare Englisch; UI, Reports, Dokumentation Deutsch.
- **Hotkeys** werden ausschließlich in `apps/web/src/hotkeys/keymap.ts` deklariert (Single Source of Truth für Dispatcher, Palette, Cheat-Sheet, Doku).
- **Architekturentscheidungen** als ADR in `docs/architecture/02-adrs.md` dokumentieren; regulatorisch relevante Features zusätzlich im Mapping `docs/compliance/01-regulatorik-mapping.md` (Anforderung → Feature → Evidenz → Status) nachziehen.

## Commits und Pull Requests

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), Betreff ≤ 72 Zeichen, Body erklärt das Warum.
- Jede PR folgt `.github/pull_request_template.md`: Beschreibung, betroffene Epics/User Stories (`docs/product/02-epics-und-user-stories.md`), CHANGELOG-Eintrag, grüne CI (Typecheck, Lint, Prettier, Tests mit Coverage, `pnpm audit`, Builds, E2E). Reviews werden über `CODEOWNERS` angefordert.
- Abhängigkeits-Updates kommen über Dependabot (`.github/dependabot.yml`); manuelle Upgrades bitte mit `pnpm audit --prod --audit-level=high` prüfen.
- Keine Marktdaten mit Lizenzbeschränkung committen; der Beispielmarkt ist indikativ.

## Modellvalidierung

Änderungen an Modellen oder Konventionen erfordern einen Nachweis gegen eine unabhängige Referenz (QuantLib/ORE, Lehrbuchwert) im Test, einen Eintrag im Methodikabschnitt (`reporting/valuation-report.ts`, `methodologyFor`) und – bei geänderten Bewertungsergebnissen für unveränderte Inputs – eine Anpassung des Golden Masters (ADR-021) mit Begründung im CHANGELOG („Geändert“). Der Core folgt SemVer (ADR-024).
