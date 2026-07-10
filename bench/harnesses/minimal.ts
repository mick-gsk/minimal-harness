import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultAgentLoop,
  DefaultPromptBuilder,
  DefaultToolBridge,
  InMemoryMemory,
  SqliteMemory,
  StructuredOutputValidator,
} from "../../src/index.js";
import type { LLMAdapter, Memory, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

/**
 * BENCH_MEMORY=sqlite swaps the loop's memory for a real on-disk SqliteMemory
 * (fresh temp file per run, so repeated seeds never share a session). Used by
 * the equivalence probe: success rates must match InMemoryMemory.
 */
function makeBenchMemory(): { memory: Memory; cleanup: () => void } {
  if (process.env.BENCH_MEMORY === "sqlite") {
    const dir = mkdtempSync(join(tmpdir(), "bench-mem-"));
    const memory = new SqliteMemory(join(dir, "memory.db"));
    return {
      memory,
      cleanup: () => {
        memory.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  return { memory: new InMemoryMemory(), cleanup: () => {} };
}

export const SYSTEM_INSTRUCTION =
  "You are a helpful assistant with access to tools. Use them when needed. " +
  "Call exactly one tool per response, then wait for its result before continuing.";

/**
 * Factory so the prompt-ablation probe can run minimal under alternative
 * system instructions — everything else identical. The official contestant
 * stays `minimalHarness` below.
 */
export function makeMinimalHarness(
  name: HarnessAdapter["name"],
  systemInstruction: string = SYSTEM_INSTRUCTION,
): HarnessAdapter {
  return {
    name,
    async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
      const toolBridge = new DefaultToolBridge();
      for (const tool of tools) toolBridge.register(tool);

      const { memory, cleanup } = makeBenchMemory();
      const loop = new DefaultAgentLoop({
        llm,
        memory,
        toolBridge,
        validator: new StructuredOutputValidator(),
        promptBuilder: new DefaultPromptBuilder(),
        systemInstruction,
      });

      try {
        const res = await loop.run({
          sessionId: `bench-${task.id}`,
          userMessage: task.prompt,
          maxTurns: task.maxTurns,
        });
        return {
          finalAnswer: res.terminatedReason === "final_answer" ? res.finalAnswer : null,
          terminatedReason: res.terminatedReason,
          turns: res.rawTurns.length,
          llmCalls: 0, // filled by the runner from telemetry
          tokens: 0, // filled by the runner from telemetry
          latencyMs: 0, // filled by the runner
          toolCallCount: res.toolTrace.length,
        };
      } catch (err) {
        return {
          finalAnswer: null,
          terminatedReason: "error",
          turns: 0,
          llmCalls: 0,
          tokens: 0,
          latencyMs: 0,
          toolCallCount: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        cleanup();
      }
    },
  };
}

/** Contestant: the full minimal-harness DefaultAgentLoop via its public API. */
export const minimalHarness: HarnessAdapter = makeMinimalHarness("minimal");
