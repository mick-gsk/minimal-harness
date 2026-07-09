import { describe, it, expect } from "@jest/globals";
import { suiteV1, SUITE_VERSION } from "../bench/tasks/frozen/suite-v1.js";
import { suiteV2, SUITE_V2_VERSION } from "../bench/tasks/frozen/suite-v2.js";
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

  it("suite-v2 has 50 tasks with the expected category mix", () => {
    expect(suiteV2).toHaveLength(50);
    expect(SUITE_V2_VERSION).toBe("suite-v2");
    const byCat = new Map<string, number>();
    for (const t of suiteV2) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
    expect(byCat.get("single-tool")).toBe(10);
    expect(byCat.get("multi-step")).toBe(10);
    expect(byCat.get("world-state")).toBe(10);
    expect(byCat.get("no-tool")).toBe(5);
    expect(byCat.get("error-recovery")).toBe(7);
    expect(byCat.get("multi-tool")).toBe(8);
  });

  it("all task ids are unique across all suites", () => {
    const ids = [...suiteV1, ...suiteV2, ...devTasks].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const task of [...suiteV1, ...suiteV2, ...devTasks]) {
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
