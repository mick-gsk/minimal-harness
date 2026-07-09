import { describe, it, expect } from "@jest/globals";
import { runMatrix } from "../bench/run-matrix.js";
import { scriptedLlm } from "../bench/testing.js";
import { makeKvTools } from "../bench/world.js";
import type { BenchTask, ModelConfig } from "../bench/types.js";
import { minimalHarness } from "../bench/harnesses/minimal.js";
import { naiveHarness } from "../bench/harnesses/naive.js";

const model: ModelConfig = { name: "mock", baseUrl: "http://x", temperature: 0.7 };

const kvTask: BenchTask = {
  id: "t-kv",
  category: "world-state",
  prompt: "Store 'blue' under 'color'.",
  maxTurns: 5,
  makeTools: (w) => makeKvTools(w),
  check: (r, w) => w.kv.get("color") === "blue",
};

describe("runMatrix", () => {
  it("produces one record per task × harness × seed with telemetry filled in", async () => {
    const records = await runMatrix({
      tasks: [kvTask],
      harnesses: [minimalHarness, naiveHarness],
      models: [model],
      seeds: [1, 2],
      llmFactory: () =>
        scriptedLlm([
          { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
          { content: "ACTION: final_answer\nANSWER: done" },
        ]),
    });
    expect(records).toHaveLength(4); // 1 task × 2 harnesses × 1 model × 2 seeds
    for (const rec of records) {
      expect(rec.success).toBe(true);
      expect(rec.result.llmCalls).toBe(2); // telemetry wired through
      expect(rec.result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("marks a run as failed when check throws or fails", async () => {
    const failingTask: BenchTask = {
      ...kvTask,
      id: "t-fail",
      check: () => {
        throw new Error("boom");
      },
    };
    const records = await runMatrix({
      tasks: [failingTask],
      harnesses: [naiveHarness],
      models: [model],
      seeds: [1],
      llmFactory: () => scriptedLlm([{ content: "ACTION: final_answer\nANSWER: hi" }]),
    });
    expect(records[0].success).toBe(false);
  });

  it("isolates world state between runs", async () => {
    // If worlds leaked, the second run would already see color=blue and a
    // task checking "key must NOT pre-exist" would fail.
    const freshTask: BenchTask = {
      ...kvTask,
      id: "t-fresh",
      makeTools: (w) => {
        if (w.kv.size !== 0) throw new Error("world not fresh");
        return makeKvTools(w);
      },
    };
    const records = await runMatrix({
      tasks: [freshTask],
      harnesses: [naiveHarness],
      models: [model],
      seeds: [1, 2, 3],
      llmFactory: () =>
        scriptedLlm([
          { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
          { content: "ACTION: final_answer\nANSWER: done" },
        ]),
    });
    expect(records.every((r) => r.success)).toBe(true);
  });
});
