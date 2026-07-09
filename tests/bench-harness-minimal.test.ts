import { describe, it, expect } from "@jest/globals";
import { minimalHarness } from "../bench/harnesses/minimal.js";
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

describe("minimalHarness", () => {
  it("runs the text protocol: tool_call then final_answer", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
      { content: "ACTION: final_answer\nANSWER: Stored blue under color." },
    ]);
    const result = await minimalHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toContain("Stored");
    expect(result.toolCallCount).toBe(1);
    expect(world.kv.get("color")).toBe("blue");
    expect(result.turns).toBe(2);
  });

  it("maps a run that never answers to terminatedReason max_turns", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: 'ACTION: tool_call\nTOOL: kv.get\nARGS: {"key":"color"}' },
    ]);
    const result = await minimalHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("max_turns");
    expect(result.finalAnswer).toBeNull();
  });

  it("captures adapter-level errors instead of throwing", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = {
      async generate(): Promise<never> {
        throw new Error("connection refused");
      },
    };
    const result = await minimalHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("error");
    expect(result.error).toContain("connection refused");
  });
});
