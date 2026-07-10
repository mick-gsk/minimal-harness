# Persistente Memory (SqliteMemory) — Design

**Teilprojekt 1 von 5 der Mittelstands-Roadmap** (persistente Memory, OpenAI-kompatible
Adapter, Streaming, parallele Tool-Calls, Server/Auth/Multi-User). Ziel dieses
Teilprojekts: Sessions überleben Prozess-Neustarts — gemessen und validiert.

## Warum

Das Harness soll für den Einsatz in kleinen/mittleren Unternehmen taugen. Die heutige
`InMemoryMemory` verliert alle Sessions beim Neustart — für jeden realen Betrieb
disqualifizierend. Persistenz ist zugleich die Vorleistung für Teilprojekt 5
(Multi-User-Server): parallele Leser und Crash-Robustheit.

## Entscheidungen

- **Backend: `node:sqlite`** (eingebaut ab Node ≥ 22.5, flag-frei ab 23.4; auf dem
  Projekt-Node v24 verifiziert). Keine neue Dependency — `dependencies: {}` bleibt.
- **Zuschnitt: minimaler Drop-in.** `SqliteMemory implements Memory`, exakt dasselbe
  Interface wie `InMemoryMemory`. Null Änderungen an AgentLoop.
- **Kein Vorgriff:** keine Summary-Persistenz (Summarizer ist nicht im Default-Loop),
  keine User-Verwaltung (Teilprojekt 5), keine Kompaktierung/TTL (kein Bedarf belegt).

## Komponente

`src/memory/sqlite-memory.ts`, Export über `src/index.ts`.

```ts
class SqliteMemory implements Memory {
  constructor(path: string) // Dateipfad oder ":memory:"
  get(sessionId): Promise<MemoryState>
  append(sessionId, record): Promise<void>
  clear(sessionId): Promise<void>
  close(): void // gibt das File-Handle frei (Tests, sauberer Shutdown)
}
```

## Schema

```sql
PRAGMA journal_mode = WAL;   -- Crash-Robustheit, parallele Leser (Vorleistung SP5)
PRAGMA user_version = 1;     -- Migrations-Anker ohne Migrations-Framework

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  timestamp  INTEGER NOT NULL,
  metadata   TEXT              -- JSON oder NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
```

Lesereihenfolge über `ORDER BY id`, nicht über `timestamp` — zwei Appends in derselben
Millisekunde müssen stabil geordnet bleiben.

## Fehlerbehandlung

- Konstruktor wirft sofort und verständlich, wenn `node:sqlite` fehlt (alte
  Node-Version) oder der Pfad nicht beschreibbar ist — fail fast.
- Nicht-parsebare `metadata` beim Lesen → Record kommt **ohne** metadata zurück statt
  Exception: ein kaputter Datensatz darf keine Session unlesbar machen.

## Validierung („gemessen und validiert")

1. **Jest, deterministisch** (ohne Ollama, wie alle bestehenden Tests):
   Neustart-Persistenz (Instanz schließen, neue Instanz auf derselben Datei →
   identische Messages), Session-Isolation, `clear` löscht nur die eigene Session,
   Metadata-Roundtrip, Reihenfolge-Stabilität bei gleichem Timestamp.
2. **Perf-Smoke:** 10 000 Appends + `get` über 1 000 Messages; gemessene Zahlen im
   Testoutput. Kein Gate — Dokumentation der Größenordnung.
3. **Äquivalenz-Bench (GPU-PC, dev-Suite, Probe):** identische Seeds, einmal
   `InMemoryMemory`, einmal `SqliteMemory`. Erwartung: identische Erfolgsraten
   (Memory ist funktional transparent); Latenz-Overhead wird ausgewiesen.
   Schreibt **nicht** BENCHMARKS.md (Probe-Regel).

## Doku

README: `SqliteMemory` unter Extension Points → erledigt markieren; Node-Version-Floor
(≥ 22.5, flag-frei ab 23.4) nur für diese Klasse dokumentieren; v1-Limitation
„Memory is in-process only" streichen.
