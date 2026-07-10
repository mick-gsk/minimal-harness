import type { OutputValidator, ValidationResult } from "../types/guardrails.js";
import { safeParseJson } from "../utils/json.js";

/**
 * Expected output format the prompt must enforce:
 *
 * Tool call:
 *   ACTION: tool_call
 *   TOOL: <name>
 *   ARGS: <json>
 *
 * Final answer:
 *   ACTION: final_answer
 *   ANSWER: <text>
 */
export class StructuredOutputValidator implements OutputValidator {
  validate(rawText: string): ValidationResult {
    const text = rawText.trim();

    // Locate the ARGS marker; the JSON object is then extracted by brace
    // matching rather than a lazy regex, so nested objects and trailing
    // prose after the object no longer break parsing.
    //
    // The ACTION line is deliberately NOT required to say "tool_call":
    // models drift into "ACTION: <toolname>" (or drop the line) mid-run, and
    // TOOL + ARGS already make the intent unambiguous. Same forgiveness for
    // final answers below: an ANSWER field counts even when ACTION is off.
    // Line-anchored and case-sensitive: the uppercase field names are the
    // protocol signal; lowercase prose like "the answer: 42" must not match.
    //
    // Second drift form (observed qwen3:8b): TOOL is dropped entirely and the
    // tool name sits in the ACTION field — "ACTION: erp.query\nARGS: {...}".
    // Accepted when the ACTION value is not a protocol keyword (a bare
    // "ACTION: tool_call" without TOOL stays invalid: the tool is unknowable).
    const header =
      text.match(/^[ \t]*TOOL:\s*([\w.]+)[\s\S]*?^[ \t]*ARGS:\s*/m) ??
      text.match(/^[ \t]*ACTION:\s*(?!tool_call\b|final_answer\b)([\w.]+)[ \t]*\r?\n[\s\S]*?^[ \t]*ARGS:\s*/m);
    if (header) {
      const toolName = header[1]!;
      const argsText = extractBalancedObject(text, header.index! + header[0].length);
      if (argsText === null) {
        return {
          valid: false,
          reason: "ARGS does not contain a balanced JSON object",
          parsed: { kind: "invalid" },
        };
      }
      const parsed = safeParseJson(argsText);
      if (!parsed.ok) {
        return {
          valid: false,
          reason: `ARGS is not valid JSON: ${parsed.error}`,
          parsed: { kind: "invalid" },
        };
      }
      return {
        valid: true,
        parsed: { kind: "tool_call", toolName, toolArguments: parsed.value },
      };
    }

    const finalMatch = text.match(/^[ \t]*ANSWER:\s*([\s\S]+)/m);
    if (finalMatch) {
      return {
        valid: true,
        parsed: { kind: "final", finalText: finalMatch[1]!.trim() },
      };
    }

    return {
      valid: false,
      reason: "Output does not match expected ACTION format",
      parsed: { kind: "invalid" },
    };
  }
}

/**
 * Returns the first balanced `{...}` object at or after `from`, or null if
 * none is found or the braces never balance. String contents (including
 * escaped quotes and braces inside strings) are skipped, so a `}` inside a
 * JSON string value does not prematurely close the object.
 */
function extractBalancedObject(text: string, from: number): string | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
