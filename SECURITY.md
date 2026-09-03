# Sicherheitsrichtlinie

## Meldung von Schwachstellen

Bitte Schwachstellen nicht als öffentliches Issue melden, sondern vertraulich an die Repository-Maintainer (GitHub Security Advisory „Report a vulnerability“). Wir bestätigen den Eingang innerhalb von 3 Werktagen und streben eine Behebung kritischer Lücken innerhalb von 14 Tagen an.

## Sicherheitsmaßnahmen der API (v0.2)

- JSON-Schema-Validierung **aller** Request-Bodies, Query-Parameter und Pfad-Parameter (inkl. Markt-Snapshot-Import); Trades als diskriminierte Union mit `additionalProperties: false` – unbekannte Felder werden abgelehnt, nicht stillschweigend entfernt; Trade-IDs `^[A-Za-z0-9._-]{1,64}$`; Body-Limit 5 MB.
- Security-Header über `@fastify/helmet`; CORS-Allowlist (`CORS_ORIGINS`); Rate-Limit 600 Anfragen/Minute je Client.
- Fehlerantworten ohne Stacktraces oder Interna: Schema-Verstöße 400 mit Validierungsdetails, Domänenfehler 422 mit maschinenlesbarem `code`, Programmierfehler in der Bewertung 400 „Invalid trade“ (serverseitig als `warn` geloggt), alles andere generische 500 mit `error`-Log; jede Antwort trägt `X-Request-Id` (eine eingehende `x-request-id` wird nur als reines Token übernommen).
- Logging über pino mit `LOG_LEVEL`, Redaction von `authorization`/`cookie`, Per-Request-Logging unter `NODE_ENV=production` deaktiviert.
- Swagger UI (`/docs`) wird nur außerhalb `NODE_ENV=production` registriert; der maschinenlesbare Vertrag `/docs/json` bleibt verfügbar.
- Dateinamen in `Content-Disposition` werden bereinigt (kein Header-Injection); CSV-Zellen mit führendem `=`/`+`/`-`/`@` werden neutralisiert (Formel-Injection).
- Optimistisches Locking (ETag mit `If-Match` auf PUT und DELETE, `If-None-Match` auf GET) verhindert verlorene Updates und Lost-Deletes.
- Audit-Trail mit SHA-256-Hash-Kette für Trade-, Markt-, Kurven-, Snapshot-, Report- und Dokumentereignisse; jede bewertungsbezogene Antwort trägt `X-Market-Snapshot-Id` (identisch mit `audit.snapshotId` des Reports).

## Bekannte Grenzen (Roadmap v1.0)

- Keine Authentifizierung/Autorisierung (OIDC, Rollen) – die API ist für den Betrieb hinter einem Gateway oder lokal gedacht. Daraus folgt: `actor` im Audit-Trail ist immer `"api"`; eine Zuordnung zu Personen erfordert das Gateway (z. B. `x-user`-Header) oder OIDC.
- In-Memory-Persistenz; Audit-Trail überlebt keinen Neustart (Report-JSON und Snapshot-Export sind zu archivieren).
- Kein Secrets-Management erforderlich (keine externen Marktdaten-Konnektoren in v0.2).
- Beispielmarkt ist indikativ; produktive Nutzung setzt freigegebene Marktdaten und institutsseitige Modellvalidierung voraus (siehe `docs/compliance/01-regulatorik-mapping.md`).

## Abhängigkeiten

- Versionen sind als Caret-Ranges deklariert und über `pnpm-lock.yaml` fixiert; CI installiert mit `--frozen-lockfile`.
- `pnpm audit --prod --audit-level=high` läuft als Gate in der CI (`.github/workflows/ci.yml`); ein High-Advisory ohne Fix blockiert den Merge bis zu einem Override oder einer dokumentierten Ausnahme.
- Dependabot (`.github/dependabot.yml`) erstellt wöchentlich gruppierte Update-PRs für npm-Pakete und GitHub Actions.
- Der Pricing-Core hat keine Laufzeitabhängigkeiten. Stand v0.2: `@fastify/swagger-ui` ≥ 6.1 (`@fastify/static` ≥ 10.1.2, schließt GHSA-83w8-p2f5-377r).
