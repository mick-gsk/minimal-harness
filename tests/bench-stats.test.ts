import { describe, it, expect } from "@jest/globals";
import { wilson, passK } from "../bench/stats.js";

describe("wilson", () => {
  it("returns rate 0 with interval [0, <1] for 0/10", () => {
    const w = wilson(0, 10);
    expect(w.rate).toBe(0);
    expect(w.low).toBe(0);
    expect(w.high).toBeGreaterThan(0);
    expect(w.high).toBeLessThan(0.35);
  });

  it("returns rate 1 with interval [>0.6, 1] for 10/10", () => {
    const w = wilson(10, 10);
    expect(w.rate).toBe(1);
    expect(w.high).toBeCloseTo(1, 5);
    expect(w.low).toBeGreaterThan(0.6);
  });

  it("matches the known Wilson interval for 50/100", () => {
    // Reference value: Wilson 95% for p̂=0.5, n=100 → [0.404, 0.596]
    const w = wilson(50, 100);
    expect(w.rate).toBeCloseTo(0.5, 5);
    expect(w.low).toBeCloseTo(0.404, 2);
    expect(w.high).toBeCloseTo(0.596, 2);
  });

  it("handles n=0 without NaN", () => {
    const w = wilson(0, 0);
    expect(w.rate).toBe(0);
    expect(w.low).toBe(0);
    expect(w.high).toBe(0);
  });
});

describe("passK", () => {
  it("counts only tasks that succeed in every run", () => {
    const perTask = [
      [true, true, true],   // pass
      [true, false, true],  // fail
      [false, false, false] // fail
    ];
    expect(passK(perTask)).toBeCloseTo(1 / 3, 5);
  });

  it("returns 0 for an empty task list", () => {
    expect(passK([])).toBe(0);
  });
});
