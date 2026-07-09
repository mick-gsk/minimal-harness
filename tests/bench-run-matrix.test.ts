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

describe("runMatrix concurrency", () => {
  /** Fake contestant that tracks how many runs are in flight at once. */
  function makeTrackingHarness() {
    let inFlight = 0;
    let peak = 0;
    const harness = {
      name: "naive" as const,
      peak: () => peak,
      async run() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 25));
        inFlight--;
        return {
          finalAnswer: "ok",
          terminatedReason: "final_answer",
          turns: 1,
          llmCalls: 1,
          tokens: 0,
          latencyMs: 0,
          toolCallCount: 0,
        };
      },
    };
    return harness;
  }

  const mkTask = (id: string): BenchTask => ({
    id,
    category: "no-tool",
    prompt: "x",
    maxTurns: 2,
    makeTools: (w) => makeKvTools(w),
    check: (r) => r.finalAnswer === "ok",
  });

  it("runs sequentially by default (peak in-flight = 1)", async () => {
    const tracking = makeTrackingHarness();
    await runMatrix({
      tasks: [mkTask("c1"), mkTask("c2"), mkTask("c3")],
      harnesses: [tracking],
      models: [model],
      seeds: [1, 2],
      llmFactory: () => scriptedLlm([{ content: "ok" }]),
    });
    expect(tracking.peak()).toBe(1);
  });

  it("overlaps runs with concurrency 3 (peak in-flight >= 2)", async () => {
    const tracking = makeTrackingHarness();
    await runMatrix({
      tasks: [mkTask("c1"), mkTask("c2"), mkTask("c3")],
      harnesses: [tracking],
      models: [model],
      seeds: [1, 2],
      concurrency: 3,
      llmFactory: () => scriptedLlm([{ content: "ok" }]),
    });
    expect(tracking.peak()).toBeGreaterThanOrEqual(2);
    expect(tracking.peak()).toBeLessThanOrEqual(3);
  });

  it("keeps deterministic record order under concurrency", async () => {
    const tracking = makeTrackingHarness();
    const records = await runMatrix({
      tasks: [mkTask("c1"), mkTask("c2")],
      harnesses: [tracking],
      models: [model],
      seeds: [1, 2, 3],
      concurrency: 4,
      llmFactory: () => scriptedLlm([{ content: "ok" }]),
    });
    const keys = records.map((r) => `${r.taskId}/s${r.seed}`);
    expect(keys).toEqual(["c1/s1", "c1/s2", "c1/s3", "c2/s1", "c2/s2", "c2/s3"]);
    expect(records.every((r) => r.success)).toBe(true);
  });
});

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
