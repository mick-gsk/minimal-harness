/**
 * Agent loop with all 3 demo tools.
 * Run: npx tsx examples/tool-agent.ts
 */
import { OllamaClient } from "../src/llm/ollama-client.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { clockTool } from "../src/tools/builtins/clock.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { textUtilsTool } from "../src/tools/builtins/text-utils.js";

const llm = new OllamaClient({ baseUrl: "http://localhost:11434", model: "llama3" });
const memory = new InMemoryMemory();
const toolBridge = new DefaultToolBridge();
toolBridge.register(clockTool);
toolBridge.register(calculatorTool);
toolBridge.register(textUtilsTool);

const agentLoop = new DefaultAgentLoop({
  llm,
  memory,
  toolBridge,
  validator: new StructuredOutputValidator(),
  promptBuilder: new DefaultPromptBuilder(),
  systemInstruction: "You are a helpful assistant with access to tools. Use them when needed.",
});

const result = await agentLoop.run({
  sessionId: "demo",
  userMessage: "What is 12 * (3 + 4), and what time is it in Europe/Berlin?",
  maxTurns: 8,
});

console.log("Final Answer:", result.finalAnswer);
console.log("Terminated:", result.terminatedReason);
console.log("Tool calls:", result.toolTrace);
