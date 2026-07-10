import { describe, it, expect } from "@jest/globals";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import type { ToolDefinition } from "../src/types/tool.js";
import type { LLMToolCall } from "../src/types/llm.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tracks how many executions overlap — deterministic concurrency evidence. */
function makeTracker() {
  const state = { active: 0, maxConcurrent: 0, completions: [] as string[] };
  function tool(name: string, delayMs: number): ToolDefinition {
    return {
      name,
      description: `test tool ${name}`,
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      async execute() {
        state.active++;
        state.maxConcurrent = Math.max(state.maxConcurrent, state.active);
        await sleep(delayMs);
        state.active--;
        state.completions.push(name);
        return { ok: name };
      },
    };
  }
  return { state, tool };
}

/** First turn: the given native tool calls; second turn: plain final answer. */
function makeLoop(calls: LLMToolCall[], tools: ToolDefinition[], parallelToolCalls: boolean) {
  let turn = 0;
  const llm = adapterFromFn(async () =>
    turn++ === 0 ? { content: "", toolCalls: calls } : { content: "done" },
  );
  const toolBridge = new DefaultToolBridge();
  for (const t of tools) toolBridge.register(t);
  return new DefaultAgentLoop({
    llm,
    memory: new InMemoryMemory(),
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
    nativeToolCalling: true,
    parallelToolCalls,
    policy: { allowedTools: [], maxToolCallsPerTurn: 4, requireStructuredOutput: true },
  });
}

describe("parallel tool calls (native path)", () => {
  it("runs accepted calls concurrently when parallelToolCalls is true", async () => {
    const { state, tool } = makeTracker();
    const loop = makeLoop(
      [{ name: "a", arguments: {} }, { name: "b", arguments: {} }, { name: "c", arguments: {} }],
      [tool("a", 30), tool("b", 30), tool("c", 30)],
      true,
    );
    const result = await loop.run({ sessionId: "p1", userMessage: "go" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(state.maxConcurrent).toBe(3);
  });

  it("stays sequential by default", async () => {
    const { state, tool } = makeTracker();
    const loop = makeLoop(
      [{ name: "a", arguments: {} }, { name: "b", arguments: {} }],
      [tool("a", 20), tool("b", 20)],
      false,
    );
    await loop.run({ sessionId: "p2", userMessage: "go" });
    expect(state.maxConcurrent).toBe(1);
  });

  it("keeps toolTrace and memory in call order even when completion order differs", async () => {
    const { state, tool } = makeTracker();
    const loop = makeLoop(
      [{ name: "slow", arguments: {} }, { name: "fast", arguments: {} }],
      [tool("slow", 60), tool("fast", 5)],
      true,
    );
    const result = await loop.run({ sessionId: "p3", userMessage: "go" });
    expect(state.completions).toEqual(["fast", "slow"]); // fast finished first...
    expect(result.toolTrace.map((r) => r.toolName)).toEqual(["slow", "fast"]); // ...trace keeps call order
  });

  it("isolates a failing call — the others still deliver", async () => {
    const { tool } = makeTracker();
    const failing: ToolDefinition = {
      name: "boom",
      description: "always fails",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      async execute() {
        throw new Error("boom failed");
      },
    };
    const loop = makeLoop(
      [{ name: "a", arguments: {} }, { name: "boom", arguments: {} }],
      [tool("a", 5), failing],
      true,
    );
    const result = await loop.run({ sessionId: "p4", userMessage: "go" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolTrace[0]!.output).toEqual({ ok: "a" });
    expect(result.toolTrace[1]!.error).toContain("boom failed");
  });

  it("rejects the whole batch before starting anything when a call violates policy", async () => {
    const { state, tool } = makeTracker();
    let turn = 0;
    const llm = adapterFromFn(async () =>
      turn++ === 0
        ? { content: "", toolCalls: [{ name: "a", arguments: {} }, { name: "forbidden", arguments: {} }] }
        : { content: "done" },
    );
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(tool("a", 5));
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      nativeToolCalling: true,
      parallelToolCalls: true,
      policy: { allowedTools: ["a"], maxToolCallsPerTurn: 4, requireStructuredOutput: true },
    });
    await expect(loop.run({ sessionId: "p5", userMessage: "go" })).rejects.toThrow(/forbidden/);
    expect(state.completions).toEqual([]); // nothing was started
  });

  it("perf smoke: parallel wall time beats sequential for two 100ms tools", async () => {
    const { tool } = makeTracker();
    const calls: LLMToolCall[] = [{ name: "a", arguments: {} }, { name: "b", arguments: {} }];

    const t0 = performance.now();
    await makeLoop(calls, [tool("a", 100), tool("b", 100)], false).run({ sessionId: "s", userMessage: "go" });
    const sequentialMs = performance.now() - t0;

    const t1 = performance.now();
    await makeLoop(calls, [tool("a", 100), tool("b", 100)], true).run({ sessionId: "p", userMessage: "go" });
    const parallelMs = performance.now() - t1;

    // No timing gate beyond a generous sanity bound; numbers are documentation.
    expect(parallelMs).toBeLessThan(sequentialMs);
    console.info(`[perf-smoke] 2x100ms tools — sequential: ${sequentialMs.toFixed(0)} ms, parallel: ${parallelMs.toFixed(0)} ms`);
  });
});
