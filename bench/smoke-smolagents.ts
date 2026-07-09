/**
 * Model smoke: run the smolagents ToolCallingAgent contestant end-to-end over a
 * representative subset of suite-v1 against a real local model, one seed.
 * Proves the full pipeline (bridge → sidecar → Ollama → check) before the matrix.
 *
 * Run: OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b \
 *      npx tsx bench/smoke-smolagents.ts
 */
import { WorldState } from "./world.js";
import { suiteV1 } from "./tasks/frozen/suite-v1.js";
import { smolagentsToolHarness } from "./harnesses/smolagents.js";
import type { LLMAdapter } from "../src/index.js";
import type { ModelConfig } from "./types.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:21434";
const modelName = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const model: ModelConfig = { name: modelName, baseUrl, temperature: 0.7 };
const seed = 1001;

// smolagents reaches Ollama itself; the in-process llm is unused here.
const dummyLlm = {
  async generate() {
    throw new Error("smolagents does not use the in-process llm");
  },
} as unknown as LLMAdapter;

const pick = new Set(
  (process.env.SMOKE_TASKS ?? "calc-simple,kv-set-get,kv-transfer,no-tool-capital").split(","),
);
const tasks = suiteV1.filter((t) => pick.has(t.id));

console.log(`Smoke: ${modelName} @ ${baseUrl} · seed=${seed} · tasks=${[...pick].join(",")}\n`);

for (const task of tasks) {
  const world = new WorldState();
  const tools = task.makeTools(world);
  const t0 = Date.now();
  const res = await smolagentsToolHarness.run(task, dummyLlm, tools, { model, seed });
  const wallMs = Date.now() - t0;
  let success = false;
  try {
    success = task.check(res, world);
  } catch {
    success = false;
  }
  console.log(`=== ${task.id} [${task.category}] ===`);
  console.log(
    `  success=${success} reason=${res.terminatedReason} steps=${res.turns} ` +
      `tools=${res.toolCallCount} tokens=${res.tokens} ` +
      `agentMs=${Math.round(res.agentMs ?? 0)} wallMs=${wallMs}`,
  );
  console.log(`  finalAnswer=${JSON.stringify(res.finalAnswer)?.slice(0, 200)}`);
  if (res.error) console.log(`  ERROR=${res.error}`);
  console.log();
}
