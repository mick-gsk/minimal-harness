import { describe, it, expect } from "@jest/globals";
import { naiveHarness } from "../bench/harnesses/naive.js";
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

describe("naiveHarness", () => {
  it("handles a clean tool_call then final_answer", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
      { content: "ACTION: final_answer\nANSWER: Stored." },
    ]);
    const result = await naiveHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("Stored.");
    expect(world.kv.get("color")).toBe("blue");
  });

  it("fails immediately on malformed output (no retry, no recovery)", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "Sure! I will store blue under color for you." }, // no ACTION block
    ]);
    const result = await naiveHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("parse_error");
    expect(result.finalAnswer).toBeNull();
  });

  it("fails on invalid ARGS json (no retry)", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "ACTION: tool_call\nTOOL: kv.set\nARGS: {key: color}" }, // not valid JSON
    ]);
    const result = await naiveHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("parse_error");
  });
});
