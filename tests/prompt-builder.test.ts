import { describe, it, expect } from "@jest/globals";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";

describe("DefaultPromptBuilder", () => {
  const builder = new DefaultPromptBuilder();

  it("injects the tool protocol block when tools are present", () => {
    const messages = builder.build({
      systemInstruction: "sys",
      toolDescriptions: ["- **kv.get**: read"],
      recentMessages: [],
    });
    expect(messages[0]!.content).toContain("ACTION: tool_call");
    expect(messages[0]!.content).toContain("ACTION: final_answer");
  });

  it("tells the model that answering directly is allowed (anti over-calling)", () => {
    // Regression: BFCL irrelevance 2026-07-10 — llama3.1 called a tool on
    // 37/39 failed no-tool tasks (avg 1.16-2.12 calls where 0 is correct).
    // The protocol block alone primes weak models to always pick tool_call;
    // it must state explicitly that no-tool is a valid path.
    const messages = builder.build({
      systemInstruction: "sys",
      toolDescriptions: ["- **kv.get**: read"],
      recentMessages: [],
    });
    expect(messages[0]!.content).toMatch(/not every request needs a tool/i);
  });

  it("omits the block entirely without tools", () => {
    const messages = builder.build({
      systemInstruction: "sys",
      toolDescriptions: [],
      recentMessages: [],
    });
    expect(messages[0]!.content).not.toContain("ACTION:");
  });
});
