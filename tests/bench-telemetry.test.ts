import { describe, it, expect } from "@jest/globals";
import { withTelemetry } from "../bench/telemetry.js";
import { scriptedLlm } from "../bench/testing.js";

describe("withTelemetry", () => {
  it("counts generate calls and sums Ollama eval token counts", async () => {
    const inner = scriptedLlm([
      { content: "a", raw: { prompt_eval_count: 10, eval_count: 5 } },
      { content: "b", raw: { prompt_eval_count: 20, eval_count: 7 } },
    ]);
    const llm = withTelemetry(inner);
    await llm.generate([{ role: "user", content: "x" }]);
    await llm.generate([{ role: "user", content: "y" }]);
    expect(llm.stats.llmCalls).toBe(2);
    expect(llm.stats.tokens).toBe(42);
  });

  it("treats missing raw counts as 0 tokens", async () => {
    const llm = withTelemetry(scriptedLlm([{ content: "a" }]));
    await llm.generate([{ role: "user", content: "x" }]);
    expect(llm.stats.llmCalls).toBe(1);
    expect(llm.stats.tokens).toBe(0);
  });

  it("passes messages and options through to the inner adapter", async () => {
    const seen: unknown[] = [];
    const inner = {
      async generate(messages: unknown, options?: unknown) {
        seen.push([messages, options]);
        return { content: "ok" };
      },
    };
    const llm = withTelemetry(inner);
    await llm.generate([{ role: "user", content: "hi" }], { temperature: 0.1 });
    expect(seen).toHaveLength(1);
    expect((seen[0] as unknown[])[1]).toEqual({ temperature: 0.1 });
  });
});
