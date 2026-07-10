# Server / Auth / Multi-User — Design

**Teilprojekt 5 von 5 der Mittelstands-Roadmap.** Ziel: das Harness als deploybarer
Dienst — API-Key-Auth, strikte Session-Isolation pro User, persistente Sessions —
gemessen und validiert. Entscheidung aus dem Brainstorming: **Server-Layer im Repo**,
Kern bleibt Library.

## Architektur

Zwei neue Dateien unter `src/server/`, null neue Dependencies (`node:http`,
`node:crypto`):

- **`auth.ts`** — API-Key-Auth. Konfiguration `Record<apiKey, userId>`;
  `resolveUser(authorizationHeader)` → `userId | null`. Vergleich über
  SHA-256-Digests mit `timingSafeEqual` (konstante Zeit, keine Längen-Leaks).
- **`agent-server.ts`** — `createAgentServer(options)` → `node:http`-Server.

```ts
interface AgentServerOptions {
  llm: LLMAdapter;
  tools: ToolDefinition[];
  memory: Memory;                 // SqliteMemory für persistenten Betrieb (SP1)
  apiKeys: Record<string, string>; // apiKey -> userId
  systemInstruction?: string;
  nativeToolCalling?: boolean;
  parallelToolCalls?: boolean;
  maxTurns?: number;              // Server-Obergrenze, Default 10 (Loop-Default)
}
```

Ein `DefaultAgentLoop` + eine `DefaultToolBridge`, geteilt über alle Requests —
die Loop ist zustandslos, Zustand liegt ausschließlich in der Memory pro Session.

## Routen

| Route | Auth | Verhalten |
|---|---|---|
| `GET /healthz` | nein | `200 {"status":"ok"}` — Liveness für Load-Balancer/Monitoring |
| `POST /v1/agent/run` | Bearer | Body `{sessionId, message, maxTurns?, stream?}` |

- Ohne/mit falschem Key → `401 {"error": …}`; unbekannte Route → 404; falsche
  Methode → 405; ungültiges JSON oder fehlende Felder → 400; Loop-Exception →
  `500 {"error": …}`. Request-Body-Limit 1 MB (Schutz vor Speicher-Abuse).
- `stream: true` → SSE: `event: token` pro Chunk (SP3-Streaming), abschließend
  `event: result` mit dem vollen Ergebnis-JSON.
- Antwort (non-stream): `{finalAnswer, terminatedReason, turns, toolCallCount}`.

## Multi-User-Isolation

Der interne Memory-Key ist **`${userId}:${sessionId}`** — der userId-Anteil kommt
ausschließlich aus dem API-Key, nie aus dem Request. Zwei User mit gleichem
`sessionId` teilen nichts; ein User kann fremde Sessions weder lesen noch
beschreiben. `maxTurns` aus dem Request wird auf die Server-Obergrenze gekappt
(Client darf sich nicht mehr Budget geben als konfiguriert).

## Bewusst nicht drin (dokumentiert)

Rate-Limiting, TLS (gehört in den Reverse-Proxy), Key-Rotation zur Laufzeit,
Persistenz der Key-Liste — alles nachrüstbar, nichts davon für den ersten
validierten Betrieb nötig.

## Validierung

**Jest-Integrationstests** (Server auf Port 0, echter `fetch`, Mock-LLM — kein
Ollama nötig):
1. `/healthz` ohne Auth → 200.
2. Fehlender Key, falscher Key → 401; gültiger Key → 200 mit finalAnswer.
3. **Isolation:** User A und B nutzen denselben `sessionId` → Memory enthält
   getrennte Historien (`alice:chat` vs. `bob:chat`); Inhalte kreuzen nicht.
4. **SSE:** `stream: true` liefert `event: token`-Chunks und ein `result`-Event
   mit demselben finalAnswer wie der non-stream-Pfad.
5. Fehlerpfade: kaputtes JSON → 400, fehlende Felder → 400, Loop-Wurf → 500.
6. **Concurrency-Smoke (gemessen):** 20 parallele Requests von 2 Usern über
   `SqliteMemory` (Datei) → alle 200, Isolation hält, Wall-Time im Testoutput.

**Live-Smoke (GPU-PC, Probe):** `examples/server.ts` gegen Ollama, ein echter
Request pro User — belegt das Zusammenspiel Server + OllamaClient + SqliteMemory.
