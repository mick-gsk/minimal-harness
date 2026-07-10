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

  it("claims significance when confidence intervals are disjoint", () => {
    const records: RunRecord[] = [];
    for (let t = 0; t < 10; t++) {
      for (const seed of [1, 2]) {
        records.push(rec("minimal", `t${t}`, seed, true));
        records.push(rec("ollama-native", `t${t}`, seed, t < 1)); // only task t0 passes → 2/20
      }
    }
    const md = buildReport(records, meta);
    expect(md).toContain("signifikant (Konfidenzintervalle disjunkt)");
    expect(md).toMatch(/\+90\.0 pp/);
    expect(md).not.toContain("kein signifikanter Unterschied");
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

  it("flags seam-attributable fails under the table instead of hiding them", () => {
    const seamFail: RunRecord = {
      model: "m1", harness: "smolagents-tool", taskId: "a", category: "single-tool",
      seed: 1, success: false,
      result: { ...okResult, finalAnswer: null, terminatedReason: "error", seamErrors: 1 },
    };
    const md = buildReport([rec("minimal", "a", 1, true), seamFail], meta);
    expect(md).toMatch(/1 Fail\(s\) mit Naht-Fehlern/);

    const clean = buildReport([rec("minimal", "a", 1, true)], meta);
    expect(clean).not.toContain("Naht-Fehlern");
  });

  describe("scope section (structural confounds)", () => {
    // Rationale: the in-house suite was designed by minimal's author around
    // minimal's abstractions and minimal was debugged against it. It can carry
    // the uplift claim (all arms share tasks/tools/models/seeds) but NOT a
    // "beats rival X" claim — the report must say so itself.
    it("always states what the suite can and cannot claim", () => {
      const records: RunRecord[] = [
        rec("minimal", "a", 1, true),
        rec("ollama-native", "a", 1, true),
      ];
      const md = buildReport(records, meta);
      expect(md).toContain("Geltungsbereich");
      expect(md).toMatch(/Uplift-Claim/);
      expect(md).toMatch(/kein Beleg für .bestes Harness./);
    });

    it("adds the rival caveat only when an external harness competed", () => {
      const without = buildReport(
        [rec("minimal", "a", 1, true), rec("ollama-native", "a", 1, true)],
        meta,
      );
      expect(without).not.toContain("off-the-shelf");

      const withRival = buildReport(
        [
          rec("minimal", "a", 1, true),
          rec("ollama-native", "a", 1, true),
          rec("smolagents-tool", "a", 1, false),
        ],
        meta,
      );
      expect(withRival).toContain("off-the-shelf");
      expect(withRival).toMatch(/Heimspiel/);
      expect(withRival).toMatch(/Sidecar|Naht/);
    });
  });
});
