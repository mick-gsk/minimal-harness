/**
 * Minimal chat loop without tools.
 * Run: npx tsx examples/basic-chat.ts
 */
import { OllamaClient } from "../src/llm/ollama-client.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";

const llm = new OllamaClient({ baseUrl: "http://localhost:11434", model: "llama3" });
const memory = new InMemoryMemory();
const promptBuilder = new DefaultPromptBuilder();
const SESSION = "demo";

const messages = [
  "Hello! What can you do?",
  "Tell me a fun fact about TypeScript.",
];

for (const msg of messages) {
  await memory.append(SESSION, { role: "user", content: msg, timestamp: Date.now() });
  const state = await memory.get(SESSION);
  const builtMessages = promptBuilder.build({
    systemInstruction: "You are a helpful assistant.",
    toolDescriptions: [],
    recentMessages: state.messages,
  });
  const response = await llm.generate(builtMessages);
  console.log("User:", msg);
  console.log("Assistant:", response.content, "\n");
  await memory.append(SESSION, { role: "assistant", content: response.content, timestamp: Date.now() });
}
