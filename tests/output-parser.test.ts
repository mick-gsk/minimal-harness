import { describe, it, expect } from "@jest/globals";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { parseAssistantOutput } from "../src/core/output-parser.js";

const validator = new StructuredOutputValidator();

describe("output-parser", () => {
  it("parses a valid tool_call", () => {
    const raw = `ACTION: tool_call\nTOOL: clock.now\nARGS: {"timezone": "UTC"}`;
    const result = parseAssistantOutput(raw, validator);
    expect(result.kind).toBe("tool_call");
    expect(result.toolName).toBe("clock.now");
  });

  it("parses a valid final_answer", () => {
    const raw = `ACTION: final_answer\nANSWER: The result is 42.`;
    const result = parseAssistantOutput(raw, validator);
    expect(result.kind).toBe("final");
    expect(result.finalText).toBe("The result is 42.");
  });

  it("returns invalid for garbage input", () => {
    const result = parseAssistantOutput("I don't know what to do.", validator);
    expect(result.kind).toBe("invalid");
  });

  it("returns invalid when ARGS is not JSON", () => {
    const raw = `ACTION: tool_call\nTOOL: calc\nARGS: not-json`;
    const result = parseAssistantOutput(raw, validator);
    expect(result.kind).toBe("invalid");
  });
});
