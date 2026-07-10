# Mittelstands-Roadmap — Validierungsergebnisse

Fünf Teilprojekte machen das Harness betriebstauglich für kleine/mittlere
Unternehmen: persistente Memory, OpenAI-kompatible Adapter, Streaming, parallele
Tool-Calls, Multi-User-Server. Jede Fähigkeit ist **gemessen und validiert** —
deterministische Tests lokal, Modell-Läufe auf dem GPU-PC (Ollama, 100 % GPU,
ctx 8192). Bench-Läufe mit Experiment-Schaltern sind per Runner-Guard immer
**Proben** (schreiben nie BENCHMARKS.md).

Specs: `docs/superpowers/specs/2026-07-10-*.md` · Stand: 2026-07-10

## SP1 — Persistente Memory (`SqliteMemory`)

Drop-in für `InMemoryMemory` über eingebautes `node:sqlite` (keine Dependency,
Node ≥ 22.5). WAL, stabile Ordnung über `ORDER BY id`, tolerant gegen korrupte
Metadata, idempotentes `close()`.

| Prüfung | Ergebnis |
|---|---|
| Jest (Neustart-Persistenz, Session-Isolation, Metadata-Roundtrip, Ordnung) | 10/10 grün |
| Perf-Smoke | 10 000 Appends ≈ 0,5 s · `get` über 1 000 Messages < 1 ms |
| Äquivalenz-Probe (dev-Suite, llama3.1, Seeds 1001–1005, GPU-PC) | InMemory **20/20** (Ø 574 Tokens, 931 ms) vs. SQLite **20/20** (Ø 574 Tokens, 891 ms) — identische Erfolgsrate & Tokens, kein messbarer Overhead |

## SP2 — OpenAI-kompatibler Adapter (LM Studio / llama.cpp)

Ein Adapter (`OpenAiCompatAdapter`) für alle Chat-Completions-Backends; die
früheren Stubs `LMStudioAdapter`/`LlamaCppAdapter` sind dünne Subklassen.

| Prüfung | Ergebnis |
|---|---|
| Jest (Request-Shape, tool_calls-Parsing, SSE inkl. [DONE], Fehlerpfad) | 6/6 grün |
| Protokoll-Probe gegen Ollama `/v1` (dev-Suite, llama3.1, gleiche Seeds) | minimal **20/20** (identisch zur Ollama-API), ollama-native 15/20 vs. 16/20 (Rauschen bei temp 0.7) — Text-Protokoll **und** native Tools laufen korrekt über die OpenAI-API |

Bekannte Lücke: Über `/v1` zählt die Token-Telemetrie nicht (sie liest Ollamas
`eval_count`-Felder) — betrifft nur Bench-Reporting, nicht die Funktion.

## SP3 — Token-Streaming Ende-zu-Ende

`onToken` in `AgentLoopInput`, durchgereicht an die Haupt-Turn-Calls; Adapter
streamen NDJSON (Ollama) bzw. SSE (OpenAI-kompatibel).

| Prüfung | Ergebnis |
|---|---|
| Jest (Chunks erreichen den Loop-Aufrufer über mehrere Turns) | grün |
| TTFT-Probe (GPU-PC, llama3.1, 5 Läufe, Seeds 1001–1005) | Median TTFT **125 ms** vs. blockierend **2130 ms** — erstes Feedback **17×** früher; Gesamtlatenz Streaming 2072 ms ≈ blockierend 2130 ms (Streaming kostet nichts) |

## SP4 — Parallele Tool-Calls

`parallelToolCalls: true` (Opt-in, nativer Pfad): Batch-Policy-Check vor Start,
`Promise.all`, Ergebnisse in Aufruf-Reihenfolge (reproduzierbare Transcripts).

| Prüfung | Ergebnis |
|---|---|
| Jest (Nebenläufigkeits-Zähler, Ordnung, Fehler-Isolation, Policy-Batch) | 6/6 grün |
| Wall-Time (2 Tools à 100 ms) | sequenziell 203 ms → parallel **102 ms** |

Kein GPU-Lauf nötig: der Gewinn liegt im Tool-Executor, nicht im Modell
(Begründung in der Spec).

## SP5 — Multi-User-Server (Auth, Isolation, SSE)

`createAgentServer` (`node:http` + `node:crypto`, weiterhin null Dependencies):
Bearer-API-Keys mit Konstantzeit-Digest-Vergleich, Session-Scope
`userId:sessionId` (userId ausschließlich aus dem Key), SSE-Streaming,
1-MB-Body-Limit. TLS/Rate-Limiting bewusst im Reverse-Proxy.

| Prüfung | Ergebnis |
|---|---|
| Jest-Integration (401-Pfade, Isolation auf echter SQLite-Datei, SSE, 400/404/405/500) | 10/10 grün |
| Concurrency-Smoke | 20 parallele Requests, 2 User, SQLite-Datei: alle 200, Isolation hält, **21 ms** |
| Live-Smoke gegen GPU-Ollama (examples/server.ts, llama3.1) | `/healthz` 200 · ohne Key 401 · Alice: Calculator-Tool korrekt (17·23 = 391, 852 ms) · Bob: eigene Session · Alices Follow-up in gleichnamiger Session kennt Bobs Namen **nicht** („unknown") — Isolation hält auch live |
