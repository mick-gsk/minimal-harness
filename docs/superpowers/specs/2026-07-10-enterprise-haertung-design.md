# Enterprise-Härtung: Session-API (DSGVO) + Observability — Design

**Teilprojekt 6a/6b der Mittelstands-Roadmap** (abgeleitet aus der Marktrecherche
2026-07-10: größte Adoptionsbremse in EU-KMU ist Datenschutz/Rechtsunsicherheit —
das Harness muss DSGVO-Pflichten *bedienen*, nicht nur „lokal laufen").

## 6a — Session-Management-API

DSGVO-Bezug: Art. 15 (Auskunft) und Art. 17 (Löschung) verlangen, dass ein
Betreiber gespeicherte personenbezogene Daten auflisten, herausgeben und löschen
kann. Heute geht das nur per SQL von Hand.

### Memory-Erweiterung

`Memory.listSessions?(prefix?: string): Promise<string[]>` — **optional**, kein
Breaking Change. Implementiert in `SqliteMemory` (`SELECT DISTINCT session_id`)
und `InMemoryMemory` (Map-Keys). Prefix-Filter, damit der Server nur den
eigenen User-Scope sieht.

### Server-Routen (alle mit Bearer-Auth, alle nur im eigenen User-Scope)

| Route | Verhalten |
|---|---|
| `GET /v1/sessions` | Liste der eigenen Session-IDs (ohne `userId:`-Präfix) |
| `GET /v1/sessions/{id}` | volle Historie der eigenen Session (Art.-15-Auskunft) |
| `DELETE /v1/sessions/{id}` | löscht die eigene Session unwiderruflich (Art. 17) |

Fremde Sessions sind nicht adressierbar (der Scope kommt aus dem API-Key);
eine nicht existente eigene Session liefert bei GET 404, bei DELETE 204
(idempotent). Memory ohne `listSessions` → 501 mit klarer Meldung.

## 6b — Observability

Betriebsvoraussetzung im Unternehmenseinsatz: „läuft es, wie schnell, wie oft
schlägt es fehl" — ohne Code-Änderung ablesbar.

- **`GET /metrics`** (ohne Auth, wie /healthz): Prometheus-Textformat,
  handgeschrieben (~30 Zeilen, null Dependencies):
  `harness_requests_total{route,status}`, `harness_run_duration_ms`
  (Summe + Count → Ø extern berechenbar), `harness_runs_total{terminated_reason}`,
  `harness_tool_calls_total`.
- **Strukturierte Request-Logs:** eine JSON-Zeile pro Run auf stdout
  (`{ts, userId, sessionId, status, durationMs, turns, toolCalls, terminatedReason}`)
  — maschinenlesbar für jedes Log-System, keine Inhalte (Privacy by Design:
  Message-Text wird nie geloggt).

## Validierung

Jest-Integrationstests: Session-Liste zeigt nur eigene Sessions; Auskunft
liefert Historie; Cross-User-GET auf fremde Session ist unmöglich (Scope) und
liefert 404; DELETE entfernt nur die eigene Session (Nachbar-Session bleibt);
/metrics zählt Requests und Runs nachweisbar hoch; Log-Zeile enthält keine
Message-Inhalte.
