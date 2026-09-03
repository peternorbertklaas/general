---
name: Fehlerbericht
about: Falsche Bewertung, API-Fehler oder UI-Problem melden
title: "bug: "
labels: ["bug"]
assignees: []
---

## Beschreibung

<!-- Was passiert, was wurde erwartet? -->

## Reproduktion

1. Version / Commit: <!-- `GET /api/health` → version, oder Tag -->
2. Trade (JSON, wie an `POST /api/price` gesendet) bzw. Schnelleingabe:

```json
{}
```

3. Markt-Snapshot-ID (`X-Market-Snapshot-Id` bzw. `audit.snapshotId`) oder `GET /api/market/snapshot`-Export:
4. Schritte / Hotkeys:

## Erwartetes vs. tatsächliches Ergebnis

<!-- Zahlen mit Referenz (QuantLib/ORE, Bloomberg, Lehrbuch), Fehlermeldung inkl. `requestId` und `code` -->

## Umgebung

- Node-Version / Browser:
- Betriebssystem:

## Sicherheitsrelevant?

Bitte **keine** Sicherheitslücken als Issue melden – siehe SECURITY.md (vertrauliche Meldung).
