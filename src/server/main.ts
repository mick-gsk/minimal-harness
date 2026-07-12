/**
 * Production entry point — configured entirely via environment:
 *
 *   API_KEYS          required, "sk-secret:alice,sk-other:bob"
 *   PORT              default 8790
 *   OLLAMA_BASE_URL   default http://localhost:11434
 *   OLLAMA_MODEL      default qwen3:8b
 *   MEMORY_DB         default ./agent-memory.db (mount a volume in Docker)
 *   KNOWLEDGE_DB      optional — enables the knowledge.search tool
 *   EMBED_MODEL       default snowflake-arctic-embed2 (multilingual, stable)
 *   REQUIRE_APPROVAL  optional, comma-separated tool names needing approval
 *   SYSTEM_INSTRUCTION optional system prompt override
 *   AUDIT_DB          optional — enables the hash-chained audit log (Art. 12/19)
 *   AI_DISCLOSURE     default on — AI labelling per Art. 50; "false" opts out
 *   TOOL_POLICY       optional — tool-level RBAC (NIS2/Art. 32); path to a JSON
 *                     file (recommended) or inline JSON: {roles, userRoles}
 *   AGENT_PRESET      optional — workload preset "recherche" | "daten"; sets the
 *                     measured-best config bundle per task class (see deployment.md)
 *
 * Built to dist/server-main.js — the Docker image runs plain node, no tsx.
 */
import { createAgentServer } from "./agent-server.js";
import { parseApiKeys, parseList, parsePreset, parseToolPolicy } from "./config.js";
import { OllamaClient } from "../llm/ollama-client.js";
import { SqliteMemory } from "../memory/sqlite-memory.js";
import { OllamaEmbedder } from "../rag/embedder.js";
import { SqliteKnowledgeStore } from "../rag/knowledge-store.js";
import { makeKnowledgeSearchTool } from "../tools/builtins/knowledge.js";
import { calculatorTool } from "../tools/builtins/calculator.js";
import { clockTool } from "../tools/builtins/clock.js";
import type { ToolDefinition } from "../types/tool.js";

const port = Number(process.env.PORT ?? 8790);
const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const apiKeys = parseApiKeys(process.env.API_KEYS);
const requireApproval = parseList(process.env.REQUIRE_APPROVAL);
const toolPolicy = parseToolPolicy(process.env.TOOL_POLICY);
const preset = parsePreset(process.env.AGENT_PRESET);

const tools: ToolDefinition[] = [calculatorTool, clockTool];
if (process.env.KNOWLEDGE_DB) {
  const embedder = new OllamaEmbedder({
    baseUrl,
    ...(process.env.EMBED_MODEL ? { model: process.env.EMBED_MODEL } : {}),
  });
  const store = new SqliteKnowledgeStore(process.env.KNOWLEDGE_DB, embedder);
  tools.push(makeKnowledgeSearchTool(store) as ToolDefinition);
}

const server = createAgentServer({
  llm: new OllamaClient({
    baseUrl,
    model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
  }),
  tools,
  memory: new SqliteMemory(process.env.MEMORY_DB ?? "./agent-memory.db"),
  apiKeys,
  ...(requireApproval.length > 0 ? { requireApproval } : {}),
  ...(process.env.SYSTEM_INSTRUCTION ? { systemInstruction: process.env.SYSTEM_INSTRUCTION } : {}),
  ...(process.env.AUDIT_DB ? { auditDb: process.env.AUDIT_DB } : {}),
  ...(toolPolicy ? { toolPolicy } : {}),
  ...(preset ? { preset } : {}),
  // Art. 50 disclosure defaults on; opt out explicitly with AI_DISCLOSURE=false.
  ...(process.env.AI_DISCLOSURE !== undefined ? { aiDisclosure: process.env.AI_DISCLOSURE !== "false" } : {}),
});

server.listen(port, () => {
  console.log(`minimal-harness agent server listening on :${port}`);
  console.log(`  model=${process.env.OLLAMA_MODEL ?? "qwen3:8b"} ollama=${baseUrl}`);
  console.log(`  users=${Object.values(apiKeys).join(",")} approval-gated=[${requireApproval.join(",")}]`);
  console.log(`  tool-rbac=${toolPolicy ? `on (${Object.keys(toolPolicy.roles).length} roles)` : "off (all tools)"}`);
  console.log(`  preset=${preset ?? "none"}`);
});
