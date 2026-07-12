/**
 * Deployable multi-user agent server backed by Ollama and a durable SQLite
 * memory — the smallest production-shaped setup.
 *
 *   OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen3:8b npx tsx examples/server.ts
 *
 * Then:
 *   curl -N -X POST http://localhost:8790/v1/agent/run \
 *     -H "Authorization: Bearer sk-demo-alice" -H "Content-Type: application/json" \
 *     -d '{"sessionId":"chat-1","message":"What is 17*23? Use the calculator."}'
 *
 * Tool-RBAC (NIS2/Art. 32): `analyst` may use every tool, `viewer` only clock.*.
 * The VVT report (GDPR Art. 30) is built from each tool's `manifest`:
 *   curl http://localhost:8790/v1/compliance/vvt -H "Authorization: Bearer sk-demo-alice"
 * calculator.evaluate carries a manifest; clock.now does not, so it shows up as
 * purpose "(nicht deklariert)" — the report surfaces the documentation gap.
 */
import { createAgentServer } from "../src/server/agent-server.js";
import { OllamaClient } from "../src/llm/ollama-client.js";
import { SqliteMemory } from "../src/memory/sqlite-memory.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { clockTool } from "../src/tools/builtins/clock.js";

const PORT = Number(process.env.PORT ?? 8790);

const server = createAgentServer({
  llm: new OllamaClient({
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
  }),
  tools: [calculatorTool, clockTool],
  memory: new SqliteMemory(process.env.MEMORY_DB ?? "./agent-memory.db"),
  // Demo keys — in production, inject real secrets via environment/vault.
  apiKeys: {
    "sk-demo-alice": "alice",
    "sk-demo-bob": "bob",
  },
  // Tool-level RBAC: alice (analyst) gets everything, bob (viewer) only clock.*.
  // In production load this from TOOL_POLICY (a JSON file path is recommended).
  toolPolicy: {
    roles: {
      analyst: ["*"],
      viewer: ["clock.*"],
    },
    userRoles: {
      alice: "analyst",
      bob: "viewer",
    },
  },
});

server.listen(PORT, () => {
  console.log(`agent server listening on http://localhost:${PORT}`);
  console.log(`  GET  /healthz`);
  console.log(`  POST /v1/agent/run  (Bearer sk-demo-alice | sk-demo-bob)`);
});
