import { describe, it, expect } from "@jest/globals";
import { suiteV1, SUITE_VERSION } from "../bench/tasks/frozen/suite-v1.js";
import { devTasks } from "../bench/tasks/dev.js";
import { WorldState } from "../bench/world.js";
import type { BenchRunResult } from "../bench/types.js";

const emptyResult: BenchRunResult = {
  finalAnswer: null,
  terminatedReason: "error",
  turns: 0,
  llmCalls: 0,
  tokens: 0,
  latencyMs: 0,
  toolCallCount: 0,
};

describe("task suites", () => {
  it("suite-v1 has 10 tasks, dev has 4", () => {
    expect(suiteV1).toHaveLength(10);
    expect(devTasks).toHaveLength(4);
    expect(SUITE_VERSION).toBe("suite-v1");
  });

  it("all task ids are unique across both suites", () => {
    const ids = [...suiteV1, ...devTasks].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const task of [...suiteV1, ...devTasks]) {
    it(`task '${task.id}' is well-formed`, () => {
      expect(task.prompt.length).toBeGreaterThan(0);
      expect(task.maxTurns).toBeGreaterThan(0);
      const world = new WorldState();
      const tools = task.makeTools(world);
      expect(Array.isArray(tools)).toBe(true);
      // check() must be callable on a failed run without throwing, and must not pass it
      expect(task.check(emptyResult, world)).toBe(false);
    });
  }
});
