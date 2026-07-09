/**
 * Connectivity & capability probe for a (possibly remote) Ollama instance.
 *
 * Run against your GPU PC:
 *   OLLAMA_BASE_URL=http://<gpu-pc-ip>:11434 OLLAMA_MODEL=qwen3:8b npx tsx bench/probe.ts
 *
 * It answers four questions, in order:
 *   1. Is the Ollama server reachable over the network?
 *   2. Which models are installed on it?
 *   3. Does the target model support NATIVE tool calling (chat `tools`)?
 *   4. Does a full agent run end-to-end through minimal-harness?
 *
 * Nothing here mutates the harness; it only consumes the public API.
 */
import { OllamaClient } from "../src/llm/ollama-client.js";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { clockTool } from "../src/tools/builtins/clock.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const WANTED_MODEL = process.env.OLLAMA_MODEL; // optional; else first installed

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  · ${m}`);

async function main(): Promise<void> {
  console.log(`\n=== minimal-harness probe → ${BASE_URL} ===\n`);

  // 1) Reachability + installed models via /api/tags
  console.log("[1] Reachability & installed models");
  let models: string[] = [];
  try {
    const res = await fetch(`${BASE_URL}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    models = (data.models ?? []).map((m) => m.name);
    ok(`server reachable — ${models.length} model(s) installed`);
    for (const m of models) info(m);
  } catch (err) {
    bad(`cannot reach ${BASE_URL}: ${(err as Error).message}`);
    console.log(
      "\nFix: on the GPU PC start Ollama bound to the network, e.g.\n" +
        "  OLLAMA_HOST=0.0.0.0:11434 ollama serve\n" +
        "and make sure the firewall allows port 11434, then re-run with\n" +
        "  OLLAMA_BASE_URL=http://<gpu-pc-ip>:11434 npx tsx bench/probe.ts\n",
    );
    process.exitCode = 1;
    return;
  }

  const model = WANTED_MODEL ?? models[0];
  if (!model) {
    bad("no model installed — run e.g. `ollama pull qwen3:8b` on the GPU PC");
    process.exitCode = 1;
    return;
  }
  if (WANTED_MODEL && !models.includes(WANTED_MODEL)) {
    bad(`requested model '${WANTED_MODEL}' is not installed on the server`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  → probing model: \x1b[1m${model}\x1b[0m\n`);

  const llm = new OllamaClient({ baseUrl: BASE_URL, model });

  // 2) Basic chat round-trip
  console.log("[2] Basic chat");
  try {
    const t0 = Date.now();
    const res = await llm.generate([{ role: "user", content: "Reply with exactly the word: pong" }]);
    ok(`responded in ${Date.now() - t0} ms — "${res.content.trim().slice(0, 40)}"`);
  } catch (err) {
    bad(`generate failed: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // 3) Native tool-calling support
  console.log("[3] Native tool calling (chat `tools`)");
  let nativeToolCalling = false;
  try {
    const res = await llm.generate(
      [{ role: "user", content: "What time is it in Asia/Tokyo? Use the available tool." }],
      {
        tools: [
          {
            name: clockTool.name,
            description: clockTool.description,
            parameters: clockTool.inputSchema as unknown as Record<string, unknown>,
          },
        ],
      },
    );
    if (res.toolCalls && res.toolCalls.length > 0) {
      nativeToolCalling = true;
      ok(`native tool_calls returned → ${res.toolCalls.map((c) => c.name).join(", ")}`);
    } else {
      info("no native tool_calls — harness will fall back to the text protocol (this is fine)");
    }
  } catch (err) {
    info(`native tool probe errored (${(err as Error).message}) — text protocol will be used`);
  }

  // 4) Full end-to-end agent run through the harness (multi-step, two tools)
  console.log("[4] End-to-end agent run through minimal-harness");
  try {
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(clockTool);
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      systemInstruction:
        "You are a helpful assistant with access to tools. Use them when needed, " +
        "one at a time, and wait for each result before continuing.",
      policy: {
        maxToolCallsPerTurn: nativeToolCalling ? 2 : 1,
        allowedTools: [],
        requireStructuredOutput: true,
      },
    });

    const t0 = Date.now();
    const result = await loop.run({
      sessionId: "probe",
      userMessage: "What is 15 * 8, and what time is it in Asia/Tokyo?",
      maxTurns: 8,
    });
    const dt = Date.now() - t0;

    if (result.terminatedReason === "final_answer") {
      ok(`agent finished in ${dt} ms — state=${result.finalState}, tools used=${result.toolTrace.length}`);
      info(`final answer: ${result.finalAnswer.slice(0, 200)}`);
      for (const rec of result.toolTrace) {
        info(`tool ${rec.toolName} → ${JSON.stringify(rec.output ?? rec.error)}`);
      }
    } else {
      bad(`agent did not reach a final answer — reason=${result.terminatedReason}, state=${result.finalState}`);
      info("this is exactly the kind of case the harness-uplift benchmark will quantify");
    }
  } catch (err) {
    bad(`agent run threw: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n=== summary ===\n` +
      `  server:            ${BASE_URL}\n` +
      `  model:             ${model}\n` +
      `  native tool-calls: ${nativeToolCalling ? "YES" : "no (text-protocol fallback)"}\n`,
  );
}

void main();
