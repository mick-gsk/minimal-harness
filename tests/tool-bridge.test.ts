import { describe, it, expect } from "@jest/globals";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { ToolNotFoundError, ToolValidationError } from "../src/utils/errors.js";

describe("tool-bridge", () => {
  it("registers and lists tools", () => {
    const bridge = new DefaultToolBridge();
    bridge.register(calculatorTool);
    expect(bridge.list()).toHaveLength(1);
  });

  it("executes a registered tool", async () => {
    const bridge = new DefaultToolBridge();
    bridge.register(calculatorTool);
    const record = await bridge.execute({ toolName: "calculator.evaluate", arguments: { expression: "2 + 2" } });
    expect(record.output).toEqual({ expression: "2 + 2", result: 4 });
  });

  it("throws ToolNotFoundError for unknown tool", async () => {
    const bridge = new DefaultToolBridge();
    await expect(bridge.execute({ toolName: "unknown", arguments: {} })).rejects.toThrow(ToolNotFoundError);
  });

  it("throws ToolValidationError when required field is missing", async () => {
    const bridge = new DefaultToolBridge();
    bridge.register(calculatorTool);
    await expect(bridge.execute({ toolName: "calculator.evaluate", arguments: {} })).rejects.toThrow(ToolValidationError);
  });
});
