# Sicherheitsrichtlinie

## Meldung von Schwachstellen

Bitte Schwachstellen nicht als öffentliches Issue melden, sondern vertraulich an die Repository-Maintainer (GitHub Security Advisory „Report a vulnerability“). Wir bestätigen den Eingang innerhalb von 3 Werktagen und streben eine Behebung kritischer Lücken innerhalb von 14 Tagen an.

## Sicherheitsmaßnahmen der API (v0.2)

- JSON-Schema-Validierung **aller** Request-Bodies, Query-Parameter und Pfad-Parameter (inkl. Markt-Snapshot-Import); Trades als diskriminierte Union mit `additionalProperties: false` – unbekannte Felder werden abgelehnt, nicht stillschweigend entfernt; Trade-IDs `^[A-Za-z0-9._-]{1,64}$`; Kuponfrequenzen `^([1-9]\d{0,2}[DWMY]|ZC)$`; Zeitstempel (`meta.snapshotTime`, EMIR `asOf`/`timestamp`) als ISO-8601-`date-time`; Body-Limit 5 MB (JSON und CSV).
- **Rechenbudget je Request** (`apps/api/src/lib/limits.ts`): Alle Bewertungen laufen synchron im Event-Loop und lassen sich nicht abbrechen; deshalb wird die Arbeit vor dem Rechnen an der Eingabe begrenzt statt über einen Timeout. Geschätzte Kuponperioden je Leg ≤ 1200 (400 `TOO_MANY_PERIODS`, ein 1D-×-100Y-Swap wird in < 50 ms abgelehnt), je Request ≤ 20 000 Perioden über alle Trades und ≤ 500 000 Perioden × Bewertungen (Szenarien, Grid-Zellen, Bucket-Risiko, Portfolio-Report; der Trade-Store zählt bei Store-Fallbacks mit) → 413 `PERIOD_BUDGET_EXCEEDED`; `trades` ≤ 5000, Szenarien ≤ 200, Grid ≤ 41 × 41, Par-Risk-Portfolio ≤ 200 Trades. Grenzen per `MAX_PERIODS_PER_LEG`, `MAX_PERIODS_PER_REQUEST`, `MAX_WEIGHTED_PERIODS_PER_REQUEST`.
- Security-Header über `@fastify/helmet`; CORS-Allowlist (`CORS_ORIGINS`); Rate-Limit 600 Anfragen/Minute je Client.
- Fehlerantworten ohne Stacktraces oder Interna: Schema-Verstöße 400 mit Validierungsdetails, Domänenfehler 422 mit maschinenlesbarem `code`, Programmierfehler in der Bewertung 400 „Invalid trade“ (serverseitig als `warn` geloggt), alles andere generische 500 mit `error`-Log; jede Antwort trägt `X-Request-Id` (eine eingehende `x-request-id` wird nur als reines Token übernommen).
- Logging über pino mit `LOG_LEVEL`, Redaction von `authorization`/`cookie`, Per-Request-Logging unter `NODE_ENV=production` deaktiviert.
- Swagger UI (`/docs`) wird nur außerhalb `NODE_ENV=production` registriert; der maschinenlesbare Vertrag `/docs/json` (OpenAPI 3.1.0) bleibt verfügbar.
- Dateinamen in `Content-Disposition` werden bereinigt (kein Header-Injection); CSV-Zellen mit führendem `=`/`+`/`-`/`@` werden neutralisiert (Formel-Injection). CSV-Uploads (`POST /api/trades/import`, `text/csv`) werden zeilenweise über die Core-Builder in typisierte Trades überführt und wie JSON-Trades validiert und probeweise bewertet.
- Optimistisches Locking über ETags: `If-None-Match` auf GET → 304; `If-Match` auf PUT und DELETE → 412 bei Abweichung. **Der Schutz vor verlorenen Updates greift nur, wenn Clients `If-Match` senden.** Mit `REQUIRE_IF_MATCH=1` verlangt der Server den Header (RFC 6585, 428 `PRECONDITION_REQUIRED` mit `currentEtag`); ohne den Schalter bleibt er optional, damit einfache Skripte (curl, Excel) weiter funktionieren.
- Audit-Trail mit SHA-256-Hash-Kette für Trade-, Markt-, Kurven-, Snapshot-, Report- und Dokumentereignisse; jede bewertungsbezogene Antwort trägt `X-Market-Snapshot-Id` (identisch mit `audit.snapshotId` des Reports).

## Bekannte Grenzen (Roadmap v1.0)

- Keine Authentifizierung/Autorisierung (OIDC, Rollen) – die API ist für den Betrieb hinter einem Gateway oder lokal gedacht. Daraus folgt: `actor` im Audit-Trail ist immer `"api"`; eine Zuordnung zu Personen erfordert das Gateway (z. B. `x-user`-Header) oder OIDC.
- In-Memory-Persistenz; Audit-Trail überlebt keinen Neustart (Report-JSON und Snapshot-Export sind zu archivieren).
- Kein Wall-Clock-Timeout je Bewertung: Der Pricing-Core rechnet synchron und ist nicht unterbrechbar; das Rechenbudget begrenzt die Eingabe, nicht die Zeit. Ein Gateway-Timeout (z. B. 30 s) und Node-`requestTimeout` bleiben empfohlene Ergänzungen; Worker-Auslagerung ist in ADR-026 beschrieben.
- Kein Secrets-Management erforderlich (keine externen Marktdaten-Konnektoren in v0.2).
- Beispielmarkt ist indikativ; produktive Nutzung setzt freigegebene Marktdaten und institutsseitige Modellvalidierung voraus (siehe `docs/compliance/01-regulatorik-mapping.md`).

## Abhängigkeiten

- Versionen sind als Caret-Ranges deklariert und über `pnpm-lock.yaml` fixiert; CI installiert mit `--frozen-lockfile` und prüft, dass die generierte `packages/pricing-core/src/version.ts` zur `package.json` passt.
- `pnpm audit --prod --audit-level=high` läuft als Gate in der CI (`.github/workflows/ci.yml`, ein Retry bei Registry-Timeouts); ein High-Advisory ohne Fix blockiert den Merge bis zu einem Override oder einer dokumentierten Ausnahme.
- Dependabot (`.github/dependabot.yml`) erstellt wöchentlich gruppierte Update-PRs für npm-Pakete und GitHub Actions.
- Der Pricing-Core hat keine Laufzeitabhängigkeiten. Stand v0.2: `@fastify/swagger-ui` ≥ 6.1 (`@fastify/static` ≥ 10.1.2, schließt GHSA-83w8-p2f5-377r).

### Akzeptierte Advisories (unterhalb des Gates)

| Advisory            | Paket                            | Schwere  | Begründung                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Ablauf                                                           |
| ------------------- | -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GHSA-fgmj-fm8m-jvvx | `echarts@5.6.0` (nur `apps/web`) | Moderate | Betrifft die Verarbeitung nicht vertrauenswürdiger Inhalte in ECharts-Optionen (HTML in Tooltips/Labels). DERIVA übergibt ausschließlich intern erzeugte numerische Serien und selbst formatierte Beschriftungen (`format.ts`), keine Nutzer- oder Fremd-HTML-Inhalte; die Charts laufen im Browser des Beraters ohne serverseitige Verarbeitung. Ein Upgrade auf echarts ≥ 6 ist mit dem tree-shaken `echarts/core`-Import vorbereitet und wird über Dependabot eingespielt. | Neubewertung spätestens 2026-12-31 oder mit dem echarts-6-Update |
