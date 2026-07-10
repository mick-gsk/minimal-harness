# OpenAI-kompatibler Adapter (LM Studio / llama.cpp) — Design

**Teilprojekt 2 von 5 der Mittelstands-Roadmap.** Ziel: die beiden Stub-Adapter durch
eine funktionierende Implementierung ersetzen — gemessen und validiert.

## Warum

LM Studio und der llama.cpp-Server sprechen beide die **OpenAI Chat-Completions-API**
(`/v1/chat/completions`). Ein gemeinsamer Adapter bedient beide (und jedes andere
OpenAI-kompatible Backend, inkl. Ollamas `/v1`-Endpoint — was die Validierung auf dem
GPU-PC ohne Zusatzinstallation erlaubt).

## Komponente

`src/llm/openai-compat.ts`:

```ts
interface OpenAiCompatConfig {
  baseUrl: string;   // z. B. "http://localhost:1234/v1"
  model: string;
  apiKey?: string;   // Bearer-Header, lokal meist unnötig
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  defaultSeed?: number;
}
class OpenAiCompatAdapter implements LLMAdapter
```

Die bisherigen Stubs werden dünne Subklassen mit Default-Ports:
`LMStudioAdapter` (`http://localhost:1234/v1`), `LlamaCppAdapter`
(`http://localhost:8080/v1`; llama.cpp ignoriert den model-Namen).

## Mapping

- Request: `model, messages, temperature, max_tokens?, stop?, seed?, tools?`
  (OpenAI-Function-Format), `stream` je nach `onToken`.
- Non-Streaming-Antwort: `choices[0].message.content` + `tool_calls`
  (`function.arguments` kommt als JSON-String → parsen, bei Parse-Fehler String
  durchreichen — gleiches Verhalten wie OllamaClient).
- Streaming: SSE (`data: {...}`, Ende `data: [DONE]`), `delta.content` → `onToken`;
  `delta.tool_calls` werden per Index akkumuliert (Name + Argument-Fragmente).
- Rolle `tool` wird durchgereicht (llama.cpp, LM Studio und Ollama /v1 akzeptieren
  sie); kein `tool_call_id`-Tracking — bewusste Vereinfachung, dokumentiert.
- Fehler: non-2xx → Exception mit Status + Body-Auszug (fail fast).

## Validierung

1. **Jest** (fetch gemockt, Muster wie ollama-client.test.ts): Request-Shape
   (URL, Auth-Header, tools-Format), Antwort-Parsing, tool_calls-Parsing
   (String-Argumente), SSE-Streaming inkl. `[DONE]` und Chunk-Reihenfolge,
   Fehlerpfad non-2xx.
2. **GPU-PC (Probe):** dev-Suite über `OpenAiCompatAdapter` gegen Ollamas
   `/v1`-Endpoint, gleiche Seeds wie der Ollama-Adapter-Lauf. Erwartung:
   vergleichbare Erfolgsraten — belegt, dass der Adapter das Protokoll korrekt
   spricht. LM Studio/llama.cpp selbst sind damit protokollseitig abgedeckt
   (gleiche API), ohne sie installieren zu müssen.
