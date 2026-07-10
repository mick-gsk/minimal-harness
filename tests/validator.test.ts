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

  // Regression: company probe 2026-07-10 — qwen3:8b writes the tool name into
  // the ACTION field after the first tool result. TOOL + ARGS make the intent
  // unambiguous; rejecting it cost entire research runs.
  it("accepts a tool call whose ACTION field holds the tool name", () => {
    const r = v.validate(`ACTION: fs.list\nTOOL: fs.list\nARGS: {"path": "QM/"}`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.kind).toBe("tool_call");
    expect(r.parsed?.toolName).toBe("fs.list");
  });

  // Regression: company probe 2026-07-10 (results.jsonl, f07/f09/f10) —
  // qwen3:8b fuses ACTION and TOOL into one line and drops TOOL entirely:
  // "ACTION: erp.query\nARGS: {...}". The tool name in the ACTION field plus
  // ARGS make the intent unambiguous; rejecting it killed whole runs.
  it("accepts a tool call where ACTION holds the tool name and TOOL is missing", () => {
    const r = v.validate(`ACTION: erp.query\nARGS: {"sql": "SELECT * FROM maschinen WHERE name = 'W-4471';"}`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.kind).toBe("tool_call");
    expect(r.parsed?.toolName).toBe("erp.query");
  });

  it("rejects ACTION: tool_call with ARGS but no TOOL (tool unknowable)", () => {
    expect(v.validate(`ACTION: tool_call\nARGS: {"sql": "SELECT 1"}`).valid).toBe(false);
  });

  it("accepts a tool call with a missing ACTION line entirely", () => {
    const r = v.validate(`TOOL: erp.query\nARGS: {"sql": "SELECT 1"}`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.toolName).toBe("erp.query");
  });

  it("accepts a final answer whose ACTION line is malformed", () => {
    const r = v.validate(`ACTION: answer\nANSWER: Revision C ist gültig.`);
    expect(r.valid).toBe(true);
    expect(r.parsed?.kind).toBe("final");
    expect(r.parsed?.finalText).toContain("Revision C");
  });

  it("still rejects output with neither tool intent nor answer", () => {
    expect(v.validate("Ich schaue mal nach.").valid).toBe(false);
  });

  it("prefers the tool call when both TOOL/ARGS and ANSWER appear", () => {
    const r = v.validate(`TOOL: fs.read\nARGS: {"path":"a.txt"}\nANSWER: noch nicht fertig`);
    expect(r.parsed?.kind).toBe("tool_call");
  });
});
