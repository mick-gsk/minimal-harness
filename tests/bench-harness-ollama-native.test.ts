import { describe, it, expect } from "@jest/globals";
import { ollamaNativeHarness } from "../bench/harnesses/ollama-native.js";
import { scriptedLlm } from "../bench/testing.js";
import { WorldState, makeKvTools } from "../bench/world.js";
import type { BenchTask } from "../bench/types.js";

const kvTask: BenchTask = {
  id: "t-kv",
  category: "world-state",
  prompt: "Store 'blue' under 'color'.",
  maxTurns: 5,
  makeTools: (w) => makeKvTools(w),
  check: (r, w) => w.kv.get("color") === "blue",
};

describe("ollamaNativeHarness", () => {
  it("executes native tool calls and finishes on plain content", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "", toolCalls: [{ name: "kv.set", arguments: { key: "color", value: "blue" } }] },
      { content: "Done, stored blue under color." },
    ]);
    const result = await ollamaNativeHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toContain("Done");
    expect(result.toolCallCount).toBe(1);
    expect(world.kv.get("color")).toBe("blue");
  });

  it("feeds tool errors back as tool messages instead of crashing", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "", toolCalls: [{ name: "does.not.exist", arguments: {} }] },
      { content: "I could not find that tool." },
    ]);
    const result = await ollamaNativeHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolCallCount).toBe(0); // unknown tool executes nothing
  });

  it("stops at maxTurns when the model keeps calling tools", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "", toolCalls: [{ name: "kv.get", arguments: { key: "color" } }] },
    ]);
    const result = await ollamaNativeHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("max_turns");
    expect(result.finalAnswer).toBeNull();
  });
});
