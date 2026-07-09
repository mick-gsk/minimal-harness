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

  it("accepts a flat tool_call followed by trailing prose", () => {
    const r = v.validate(`ACTION: tool_call\nTOOL: t\nARGS: {"a":1}\nSure, calling it now.`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.kind).toBe("tool_call");
    expect((r.parsed?.toolArguments as { a: number }).a).toBe(1);
  });

  it("accepts nested JSON args followed by trailing prose", () => {
    const r = v.validate(
      `ACTION: tool_call\nTOOL: http.request\nARGS: {"url":"x","opts":{"headers":{"a":"b"}}} thanks!`,
    );
    expect(r.valid).toBe(true);
    const args = r.parsed?.toolArguments as { opts: { headers: { a: string } } };
    expect(args.opts.headers.a).toBe("b");
  });

  it("accepts tool_call whose args contain a closing brace inside a string", () => {
    const r = v.validate(`ACTION: tool_call\nTOOL: text.echo\nARGS: {"text":"a } b"} done`);
    expect(r.valid).toBe(true);
    expect((r.parsed?.toolArguments as { text: string }).text).toBe("a } b");
  });

  it("rejects tool_call with unbalanced JSON args", () => {
    const r = v.validate(`ACTION: tool_call\nTOOL: t\nARGS: {"a": {"b": 1}`);
    expect(r.valid).toBe(false);
  });
});
