import {
  DefaultAgentLoop,
  DefaultPromptBuilder,
  DefaultToolBridge,
  InMemoryMemory,
  StructuredOutputValidator,
} from "../../src/index.js";
import type { LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

const SYSTEM_INSTRUCTION =
  "You are a helpful assistant with access to tools. Use them when needed. " +
  "Call exactly one tool per response, then wait for its result before continuing.";

/** Contestant: the full minimal-harness DefaultAgentLoop via its public API. */
export const minimalHarness: HarnessAdapter = {
  name: "minimal",
  async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
    const toolBridge = new DefaultToolBridge();
    for (const tool of tools) toolBridge.register(tool);

    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      systemInstruction: SYSTEM_INSTRUCTION,
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
    }
  },
};
