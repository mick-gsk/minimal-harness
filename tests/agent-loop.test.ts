import { describe, it, expect } from "@jest/globals";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";

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
});
