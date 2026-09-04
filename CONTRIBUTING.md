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
- **API-Vertrag:** jede Route hat `operationId`, `schema.body`/`querystring`/`params` und `response` (2xx + Fehler über `responses(...)` in `schemas.ts`; Health-Routen über `responsesUnlimited(...)`, weil sie vom Rate-Limit ausgenommen sind); der Vertragstest `apps/api/src/contract.test.ts` friert die Operationsliste ein (41 Operationen) und prüft, dass jeder Sample-Trade der Builder das Schema passiert; `review-r3.test.ts` prüft OpenAPI 3.1, benannte Komponenten, `discriminator.mapping` und die Auflösung aller `$ref`; `review-r4.test.ts` prüft Budget-Abdeckung, Fehlercodes, ITS-Formate und die Core-Import-Allowlist; `review-r5.test.ts` erzwingt auf jeder Operation mit Request-Body einen Schema-Verstoß und prüft den Katalog-Code (`VALIDATION_ERROR`), Parse-/Medientyp-Fehler (`INVALID_JSON`, 415), das Rate-Limit unbekannter Routen, starke ETags nach RFC 9110, das Hedged-Item-Budget, die Vol-Flächen-Strukturprüfung (`VOL_SURFACE_INVALID`) und die Betragsobergrenze `MAX_AMOUNT`. Geteilte Schemas tragen ein `$id` (wird zum Komponentennamen) und werden in `app.ts` per `addSchema` registriert; neue Trade-Varianten kommen in `tradeVariantSchemas`. Fehler laufen ausschließlich über `lib/errors.ts` (ADR-025): Inline-Fehler (404/409/400) über `sendError(reply, req, status, code, message)` mit einem Code aus `API_ERROR_CODES.api` – ein neuer Code wird dort eingetragen und in der `ErrorResponse.code`-Beschreibung erklärt (der Vertragstest prüft beides). Bewertungsbezogene Routen setzen `config: { marketHeader: true }` (Header `X-Market-Snapshot-Id`); Routen, die viele Bewertungen je Trade auslösen, deklarieren `computeWeight`, Routen, die den Trade-Store bewerten, `storeFallback` (`true` oder ein Prädikat auf dem Request, z. B. `?price=1`), Routen, die Trades speichern, `storeWrite` (Store-Budget `MAX_STORE_PERIODS`) – alles `lib/limits.ts`.
- **Core-Importe der API:** `apps/api` importiert nur die in ADR-024 als öffentlich benannte Oberfläche von `@deriva/pricing-core`; `review-r4.test.ts` („N3-04“) grept alle Importe gegen die Allowlist. Braucht eine Route eine weitere Core-Funktion, wird sie erst in ADR-024 als öffentlich aufgenommen (und in v0.3 in der kuratierten `index.ts` exportiert), dann in der Allowlist des Tests.
- **CSV-Import:** Spaltenvorlagen je Produkttyp liegen in `apps/api/src/lib/csv-import.ts` (`CSV_TEMPLATES`, `csvTemplateText`); die OpenAPI-Beschreibung von `POST /api/trades/import` wird daraus generiert. Eine neue Spalte = Template + `buildTrade`-Mapping + Test in `review-r3.test.ts`.
- **Tests sind Pflicht**: Referenzwerte (Haug/Hull/QuantLib), Paritäten, Round-Trips. `vitest run` muss in allen Paketen grün sein; Coverage-Schwellen in den `vitest.config.ts`.
- **Formatierung:** Prettier (`.prettierrc.json`, `.editorconfig`); `pnpm format` vor dem Commit, `pnpm format:check` ist CI-Gate. Prosa-Dokumentation unter `docs/` ist bewusst ausgenommen (`.prettierignore`).
- **Lint:** ESLint flat config (`eslint.config.js`, `--max-warnings 0`). Offen: `eslint-plugin-react-hooks` ist noch nicht installiert – beim nächsten Dependency-Update als `devDependency` aufnehmen (`eslint-plugin-react-hooks`) und in `eslint.config.js` für `apps/web/**/*.tsx` die Regeln `react-hooks/rules-of-hooks` (error) und `react-hooks/exhaustive-deps` (warn) aktivieren; ebenso `tseslint.configs.recommendedTypeChecked` (`no-floating-promises`, `no-misused-promises`) prüfen.
- **Sprache:** Code, Typen, Kommentare Englisch; UI, Reports, Dokumentation Deutsch.
- **Hotkeys** werden ausschließlich in `apps/web/src/hotkeys/keymap.ts` deklariert (Single Source of Truth für Dispatcher, Palette, Cheat-Sheet, Doku).
- **Architekturentscheidungen** als ADR in `docs/architecture/02-adrs.md` dokumentieren; regulatorisch relevante Features zusätzlich im Mapping `docs/compliance/01-regulatorik-mapping.md` (Anforderung → Feature → Evidenz → Status) nachziehen.

## Commits und Pull Requests

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), Betreff ≤ 72 Zeichen, Body erklärt das Warum.
- **Präfix mit Scope und kleine, zusammenhängende Commits** (Review R5, N5-05): Betreff als `type(scope): summary` mit dem Paket bzw. Bereich als Scope (`feat(core): …`, `fix(api): …`, `feat(web): …`, `docs(compliance): …`, `chore(ci): …`, `test(api): …`); ein Commit je Änderungsprogramm oder Befund – Core-Bewertung, API-Vertrag, Web und Dokumentation kommen als getrennte Commits (bzw. PRs), damit jeder Commit für sich reviewbar und bisect-fähig bleibt. Ein Maßnahmenprogramm mit 85 Dateien in einem Commit ist die Ausnahme, die es nicht mehr geben soll.
- Jede PR folgt `.github/pull_request_template.md`: Beschreibung, betroffene Epics/User Stories (`docs/product/02-epics-und-user-stories.md`), CHANGELOG-Eintrag, grüne CI (Typecheck, Lint, Prettier, Tests mit Coverage, `pnpm audit`, Builds, E2E). Reviews werden über `CODEOWNERS` angefordert.
- Abhängigkeits-Updates kommen über Dependabot (`.github/dependabot.yml`): Gruppen `fastify`, `react`, `tooling` (Minor/Patch) und `tooling-major` (Major-Releases der Toolchain als eigener wöchentlicher PR). Manuelle Upgrades bitte mit `pnpm audit --prod --audit-level=high` prüfen. **Geplante Majors:** vitest 5 / `@vitest/coverage-v8` 5 (Migration über vitest 4: `coverage.thresholds`-Schema, Browser-Mode, `workspace` → `projects`), vite 8 mit `@vitejs/plugin-react` 6, jsdom 30 – zusammen in einem PR testen (Web-Coverage-Schwellen in `apps/web/vite.config.ts` beim Wechsel an die Ist-Werte heranführen); echarts 6 vor dem 2026-12-31 (Ablauf der Advisory-Ausnahme in `SECURITY.md`). **TypeScript bleibt auf 5.x gepinnt** (`ignore` in `dependabot.yml`): `typescript-eslint` deklariert seinen unterstützten TS-Bereich je Release, und die Modul-Einstellungen `NodeNext` (API) / `Bundler` (Core, Web) sind gegen 5.x geprüft; ein TS-Major wird bewusst zusammen mit einem `typescript-eslint`-Release eingespielt, das ihn unterstützt.
- Keine Marktdaten mit Lizenzbeschränkung committen; der Beispielmarkt ist indikativ.

## Generierte Dateien und Referenzdaten

- **`packages/pricing-core/src/version.ts`** (Quelle von `ENGINE_VERSION`) wird aus `package.json#version` erzeugt: `pnpm --filter @deriva/pricing-core run version:gen` (läuft automatisch als `prebuild`/`pretest`). Nach einer Versionsänderung die regenerierte Datei **committen** – die CI führt `version:gen` aus und bricht mit `git diff --exit-code` ab, wenn sie von der eingecheckten abweicht.
- **Golden Master** (`packages/pricing-core/test-data/golden/*.json`, ADR-021): `python3 packages/pricing-core/tools/quantlib-golden.py` erzeugt die Referenzwerte aus geschlossenen Formeln und ergänzt bei installiertem QuantLib einen Cross-Check-Block; `src/testing/golden.test.ts` prüft sie mit 1e-6 relativer Toleranz. Nur regenerieren, wenn eine Konventions- oder Modelländerung die Referenz selbst betrifft – mit Begründung im CHANGELOG („Geändert“) und Verweis auf die Herleitung in `test-data/golden/README.md`.

## Release

- Version in allen `package.json` (Root, Core, API, Web) anheben, `version:gen` ausführen, CHANGELOG-Abschnitt mit Datum abschließen, Vergleichs-Links ergänzen.
- `pnpm build && pnpm test`, danach den freigegebenen Commit taggen: `git tag -a v0.2.0 -m "DERIVA 0.2.0"` und `git push --tags`. Der Tag `v0.2.0` wird **beim Release** gesetzt, nicht auf Zwischenstände der Review-Runden.

## Modellvalidierung

Änderungen an Modellen oder Konventionen erfordern einen Nachweis gegen eine unabhängige Referenz (QuantLib/ORE, Lehrbuchwert) im Test, einen Eintrag im Methodikabschnitt (`reporting/valuation-report.ts`, `methodologyFor`) und – bei geänderten Bewertungsergebnissen für unveränderte Inputs – eine Anpassung des Golden Masters (ADR-021) mit Begründung im CHANGELOG („Geändert“). Der Core folgt SemVer (ADR-024).
