import { describe, it, expect } from "@jest/globals";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { defaultPolicy } from "../src/guardrails/policy.js";
import type { ChatMessage } from "../src/types/llm.js";

function makeDeps(responses: string[]) {
  let i = 0;
  const llm = adapterFromFn(async () => ({ content: responses[i++] ?? "ACTION: final_answer\nANSWER: done" }));
  const memory = new InMemoryMemory();
  const toolBridge = new DefaultToolBridge();
  toolBridge.register(calculatorTool);
  return new DefaultAgentLoop({
    llm,
    memory,
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
  });
}

describe("DefaultAgentLoop", () => {
  it("resolves a direct final_answer", async () => {
    const loop = makeDeps(["ACTION: final_answer\nANSWER: Hello!"]);
    const result = await loop.run({ sessionId: "s1", userMessage: "hi" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("Hello!");
    expect(result.finalState).toBe("done");
  });

  it("ends in a failed state when output never validates", async () => {
    const loop = makeDeps(Array(5).fill("this is not the required format at all"));
    const result = await loop.run({ sessionId: "s4", userMessage: "hi", maxTurns: 3 });
    expect(result.terminatedReason).toBe("validation_failed");
    expect(result.finalState).toBe("failed");
  });

  it("executes a tool and then returns final_answer", async () => {
    const loop = makeDeps([
      `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"3*3"}`,
      "ACTION: final_answer\nANSWER: 9",
    ]);
    const result = await loop.run({ sessionId: "s2", userMessage: "What is 3*3?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolTrace).toHaveLength(1);
  });

  it("terminates with max_turns when loop runs out", async () => {
    const loop = makeDeps(Array(5).fill(`ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"1+1"}`));
    const result = await loop.run({ sessionId: "s3", userMessage: "loop", maxTurns: 3 });
    expect(result.terminatedReason).toBe("max_turns");
  });

  it("feeds tool validation errors back to the model instead of crashing (native path)", async () => {
    // Regression: bench run 2026-07-09 — llama3.1 hallucinated an argument for a
    // no-parameter tool; ToolValidationError killed the whole session while the
    // primitive baselines recovered. The loop must return the error as a tool
    // message so the model gets a chance to correct itself.
    let call = 0;
    const llm = adapterFromFn(async (messages: ChatMessage[]) => {
      call++;
      if (call === 1) {
        // invalid: calculator.evaluate requires "expression", model hallucinates "expr"
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expr: "6*7" } }] };
      }
      if (call === 2) {
        // the error must have been fed back as a tool message
        const lastTool = [...messages].reverse().find((m) => m.role === "tool");
        expect(lastTool?.content ?? "").toMatch(/validation|failed|error/i);
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "6*7" } }] };
      }
      return { content: "ACTION: final_answer\nANSWER: 42" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
    });

    const result = await loop.run({ sessionId: "val-err", userMessage: "6*7?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("42");
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.error).toMatch(/validation/i);
    expect(result.toolTrace[1]!.output).toEqual({ expression: "6*7", result: 42 });
  });

  it("feeds unknown-tool errors back to the model instead of crashing (text path)", async () => {
    const loop = makeDeps([
      `ACTION: tool_call\nTOOL: does.not.exist\nARGS: {}`,
      `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"2+2"}`,
      "ACTION: final_answer\nANSWER: 4",
    ]);
    const result = await loop.run({ sessionId: "unknown-tool", userMessage: "2+2?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("4");
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.error).toMatch(/not.*(found|registered)|unknown/i);
  });

  it("uses native tool_calls from the adapter instead of text parsing", async () => {
    let call = 0;
    const llm = adapterFromFn(async () => {
      call++;
      if (call === 1) {
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "6*7" } }] };
      }
      return { content: "ACTION: final_answer\nANSWER: 42" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
    });

    const result = await loop.run({ sessionId: "nat", userMessage: "6*7?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]!.output).toEqual({ expression: "6*7", result: 42 });
  });

  it("executes multiple native tool calls in one turn when policy allows", async () => {
    let call = 0;
    const llm = adapterFromFn(async () => {
      call++;
      if (call === 1) {
        return {
          content: "",
          toolCalls: [
            { name: "calculator.evaluate", arguments: { expression: "1+1" } },
            { name: "calculator.evaluate", arguments: { expression: "2+2" } },
          ],
        };
      }
      return { content: "ACTION: final_answer\nANSWER: done" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      policy: { ...defaultPolicy, maxToolCallsPerTurn: 2 },
    });

    const result = await loop.run({ sessionId: "multi", userMessage: "1+1 and 2+2?" });
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.output).toEqual({ expression: "1+1", result: 2 });
    expect(result.toolTrace[1]!.output).toEqual({ expression: "2+2", result: 4 });
  });

  it("caps native tool calls to the per-turn policy limit and records the drop", async () => {
    let call = 0;
    const llm = adapterFromFn(async () => {
      call++;
      if (call === 1) {
        return {
          content: "",
          toolCalls: [
            { name: "calculator.evaluate", arguments: { expression: "1+1" } },
            { name: "calculator.evaluate", arguments: { expression: "2+2" } },
          ],
        };
      }
      return { content: "ACTION: final_answer\nANSWER: done" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      policy: { ...defaultPolicy, maxToolCallsPerTurn: 1 },
    });

    const result = await loop.run({ sessionId: "cap", userMessage: "1+1 and 2+2?" });
    // one executed, one dropped-with-error — never silently discarded
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.output).toEqual({ expression: "1+1", result: 2 });
    expect(result.toolTrace[1]!.error).toMatch(/not executed/i);
  });

  it("reports dropped tool calls back to the model so it can re-issue them", async () => {
    // Regression: bench probe 2026-07-09 (v2-m6/w6/w9/m9) — excess native tool
    // calls were silently discarded; the model believed both writes executed
    // and reported phantom success.
    let call = 0;
    const llm = adapterFromFn(async (messages: ChatMessage[]) => {
      call++;
      if (call === 1) {
        return {
          content: "",
          toolCalls: [
            { name: "calculator.evaluate", arguments: { expression: "1+1" } },
            { name: "calculator.evaluate", arguments: { expression: "2+2" } },
          ],
        };
      }
      if (call === 2) {
        const toolMsgs = messages.filter((m) => m.role === "tool");
        expect(toolMsgs.some((m) => /not executed/i.test(m.content))).toBe(true);
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "2+2" } }] };
      }
      return { content: "ACTION: final_answer\nANSWER: 2 and 4" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      policy: { ...defaultPolicy, maxToolCallsPerTurn: 1 },
    });

    const result = await loop.run({ sessionId: "cap-report", userMessage: "1+1 and 2+2?" });
    expect(result.terminatedReason).toBe("final_answer");
    // executed 1+1, dropped 2+2, re-issued 2+2
    expect(result.toolTrace).toHaveLength(3);
    expect(result.toolTrace[1]!.error).toMatch(/not executed/i);
    expect(result.toolTrace[2]!.output).toEqual({ expression: "2+2", result: 4 });
  });

  it("caps recent context and folds older turns into a summary", async () => {
    const seen: ChatMessage[][] = [];
    const llm = adapterFromFn(async (messages) => {
      seen.push(messages);
      return { content: "ACTION: final_answer\nANSWER: ok" };
    });
    const memory = new InMemoryMemory();
    for (let i = 0; i < 30; i++) {
      await memory.append("ctx", { role: i % 2 ? "assistant" : "user", content: `msg ${i}`, timestamp: 0 });
    }
    const loop = new DefaultAgentLoop({
      llm,
      memory,
      toolBridge: new DefaultToolBridge(),
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      maxContextMessages: 10,
    });

    await loop.run({ sessionId: "ctx", userMessage: "hi" });

    const prompt = seen[0]!;
    const nonSystem = prompt.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeLessThanOrEqual(10);
    expect(prompt.some((m) => m.role === "system" && m.content.includes("Context Summary"))).toBe(true);
  });
});
