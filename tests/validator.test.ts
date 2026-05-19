import { describe, it, expect } from "@jest/globals";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";

const v = new StructuredOutputValidator();

describe("StructuredOutputValidator", () => {
  it("accepts well-formed tool_call", () => {
    const r = v.validate(`ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"1+1"}`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.kind).toBe("tool_call");
  });

  it("accepts well-formed final_answer", () => {
    const r = v.validate(`ACTION: final_answer\nANSWER: Done.`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.kind).toBe("final");
  });

  it("rejects malformed output", () => {
    const r = v.validate("Sure, here is the answer: 42");
    expect(r.valid).toBe(false);
  });
});
