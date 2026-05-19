/**
 * Shows how to plug in a custom LLM backend via adapterFromFn.
 * Run: npx tsx examples/custom-backend.ts
 */
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";

// Stub: replace with your actual backend call
const myCustomAdapter = adapterFromFn(async (messages) => {
  console.log("[custom backend] received", messages.length, "messages");
  return {
    content: "ACTION: final_answer\nANSWER: This is a stub response from the custom backend.",
  };
});

const agentLoop = new DefaultAgentLoop({
  llm: myCustomAdapter,
  memory: new InMemoryMemory(),
  toolBridge: new DefaultToolBridge(),
  validator: new StructuredOutputValidator(),
  promptBuilder: new DefaultPromptBuilder(),
});

const result = await agentLoop.run({ sessionId: "custom", userMessage: "Test" });
console.log("Result:", result);
