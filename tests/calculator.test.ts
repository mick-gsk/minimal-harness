import { describe, it, expect } from "@jest/globals";
import { calculatorTool } from "../src/tools/builtins/calculator.js";

describe("calculatorTool", () => {
  it("respects operator precedence and parentheses", async () => {
    const out = await calculatorTool.execute({ expression: "12 * (3 + 4)" });
    expect(out).toEqual({ expression: "12 * (3 + 4)", result: 84 });
  });

  it("handles decimals and subtraction", async () => {
    const out = await calculatorTool.execute({ expression: "1.5 - 0.25" });
    expect(out.result).toBeCloseTo(1.25);
  });

  it("throws on division by zero", async () => {
    await expect(calculatorTool.execute({ expression: "1 / 0" })).rejects.toThrow("Division by zero");
  });

  it("throws on an unparseable expression", async () => {
    await expect(calculatorTool.execute({ expression: "???" })).rejects.toThrow();
  });
});
