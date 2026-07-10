import { describe, it, expect } from "@jest/globals";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { validateToolInput } from "../src/tools/schema.js";
import type { ChatMessage } from "../src/types/llm.js";
import type { ToolInputSchema } from "../src/types/tool.js";

const invoiceSchema: ToolInputSchema = {
  type: "object",
  properties: {
    invoiceNumber: { type: "string" },
    total: { type: "number" },
  },
  required: ["invoiceNumber", "total"],
  additionalProperties: false,
};

function makeLoop(responses: string[], seen?: ChatMessage[][]) {
  let i = 0;
  const llm = adapterFromFn(async (messages) => {
    seen?.push(messages);
    return { content: responses[i++] ?? "ACTION: final_answer\nANSWER: {}" };
  });
  return new DefaultAgentLoop({
    llm,
    memory: new InMemoryMemory(),
    toolBridge: new DefaultToolBridge(),
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
  });
}

describe("structured extraction (responseSchema)", () => {
  it("injects the schema contract into the system prompt", async () => {
    const seen: ChatMessage[][] = [];
    const loop = makeLoop(['ACTION: final_answer\nANSWER: {"invoiceNumber":"R-1","total":100}'], seen);
    await loop.run({ sessionId: "s", userMessage: "extract", responseSchema: invoiceSchema });
    const system = seen[0]!.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(system).toContain("invoiceNumber");
    expect(system).toContain("JSON");
  });

  it("returns the parsed object as structuredAnswer on success", async () => {
    const loop = makeLoop(['ACTION: final_answer\nANSWER: {"invoiceNumber":"R-42","total":119.5}']);
    const result = await loop.run({ sessionId: "s", userMessage: "extract", responseSchema: invoiceSchema });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.structuredAnswer).toEqual({ invoiceNumber: "R-42", total: 119.5 });
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const loop = makeLoop([
      'ACTION: final_answer\nANSWER: ```json\n{"invoiceNumber":"R-7","total":5}\n```',
    ]);
    const result = await loop.run({ sessionId: "s", userMessage: "extract", responseSchema: invoiceSchema });
    expect(result.structuredAnswer).toEqual({ invoiceNumber: "R-7", total: 5 });
  });

  it("retries with the concrete error and succeeds on the corrected answer", async () => {
    const seen: ChatMessage[][] = [];
    const loop = makeLoop(
      [
        "ACTION: final_answer\nANSWER: not json at all",
        'ACTION: final_answer\nANSWER: {"invoiceNumber":"R-1","total":10}',
      ],
      seen,
    );
    const result = await loop.run({ sessionId: "s", userMessage: "extract", responseSchema: invoiceSchema });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.structuredAnswer).toEqual({ invoiceNumber: "R-1", total: 10 });
    const retryPrompt = seen[1]!.at(-1)!.content;
    expect(retryPrompt).toMatch(/JSON|schema/i);
  });

  it("rejects wrong field types via the schema", async () => {
    const loop = makeLoop(
      [
        'ACTION: final_answer\nANSWER: {"invoiceNumber":"R-1","total":"viel"}',
        'ACTION: final_answer\nANSWER: {"invoiceNumber":"R-1","total":10}',
      ],
    );
    const result = await loop.run({ sessionId: "s", userMessage: "extract", responseSchema: invoiceSchema });
    expect(result.structuredAnswer).toEqual({ invoiceNumber: "R-1", total: 10 });
  });

  it("terminates with validation_failed when the model never conforms", async () => {
    const loop = makeLoop(Array(6).fill("ACTION: final_answer\nANSWER: still not json"));
    const result = await loop.run({ sessionId: "s", userMessage: "extract", responseSchema: invoiceSchema });
    expect(result.terminatedReason).toBe("validation_failed");
    expect(result.structuredAnswer).toBeUndefined();
  });

  it("leaves behavior unchanged without responseSchema", async () => {
    const loop = makeLoop(["ACTION: final_answer\nANSWER: plain text answer"]);
    const result = await loop.run({ sessionId: "s", userMessage: "hi" });
    expect(result.finalAnswer).toBe("plain text answer");
    expect(result.structuredAnswer).toBeUndefined();
  });
});

describe("validateToolInput type checks", () => {
  const schema: ToolInputSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      count: { type: "number" },
      active: { type: "boolean" },
      tags: { type: "array" },
      meta: { type: "object" },
    },
    required: ["name"],
    additionalProperties: false,
  };

  it("accepts matching types", () => {
    expect(validateToolInput({ name: "a", count: 1, active: true, tags: [], meta: {} }, schema)).toBeNull();
  });

  it.each([
    [{ name: 1 }, /name/],
    [{ name: "a", count: "x" }, /count/],
    [{ name: "a", active: "yes" }, /active/],
    [{ name: "a", tags: {} }, /tags/],
    [{ name: "a", meta: [] }, /meta/],
  ])("rejects mismatched types (%j)", (input, pattern) => {
    expect(validateToolInput(input, schema)).toMatch(pattern);
  });
});
