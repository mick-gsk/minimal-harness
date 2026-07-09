import { describe, it, expect } from "@jest/globals";
import { buildReport } from "../bench/reporter.js";
import type { RunRecord } from "../bench/run-matrix.js";
import type { BenchRunResult } from "../bench/types.js";

const okResult: BenchRunResult = {
  finalAnswer: "x",
  terminatedReason: "final_answer",
  turns: 2,
  llmCalls: 2,
  tokens: 100,
  latencyMs: 50,
  toolCallCount: 1,
};

function rec(harness: string, taskId: string, seed: number, success: boolean): RunRecord {
  return { model: "m1", harness, taskId, category: "single-tool", seed, success, result: okResult };
}

const meta = { date: "2026-07-09", suiteVersion: "suite-v1", seeds: [1, 2], temperature: 0.7, k: 2 };

describe("buildReport", () => {
  it("renders one row per model×harness with rate, CI and pass^k", () => {
    const records: RunRecord[] = [
      // minimal: task A 2/2, task B 2/2 → rate 1.0, pass^2 = 1.0
      rec("minimal", "a", 1, true), rec("minimal", "a", 2, true),
      rec("minimal", "b", 1, true), rec("minimal", "b", 2, true),
      // ollama-native: task A 1/2, task B 0/2 → rate 0.25, pass^2 = 0
      rec("ollama-native", "a", 1, true), rec("ollama-native", "a", 2, false),
      rec("ollama-native", "b", 1, false), rec("ollama-native", "b", 2, false),
    ];
    const md = buildReport(records, meta);
    expect(md).toContain("suite-v1");
    expect(md).toContain("m1");
    expect(md).toContain("minimal");
    expect(md).toContain("ollama-native");
    expect(md).toContain("100.0%"); // minimal rate
    expect(md).toContain("25.0%"); // baseline rate
    expect(md).toMatch(/\+75\.0 pp/); // uplift minimal vs ollama-native
  });

  it("labels non-significant uplift honestly when CIs overlap", () => {
    const records: RunRecord[] = [
      // 2 runs each, 1/2 vs 2/2 → tiny n, CIs overlap massively
      rec("minimal", "a", 1, true), rec("minimal", "a", 2, true),
      rec("ollama-native", "a", 1, true), rec("ollama-native", "a", 2, false),
    ];
    const md = buildReport(records, meta);
    expect(md).toContain("kein signifikanter Unterschied");
  });

  it("marks the naive baseline as illustrative", () => {
    const records: RunRecord[] = [
      rec("minimal", "a", 1, true),
      rec("ollama-native", "a", 1, true),
      rec("naive", "a", 1, false),
    ];
    const md = buildReport(records, meta);
    expect(md).toContain("illustrativ");
  });
});
