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
    const header = text.match(/ACTION:\s*tool_call[\s\S]*?TOOL:\s*([\w.]+)[\s\S]*?ARGS:\s*/i);
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

    const finalMatch = text.match(/ACTION:\s*final_answer[\s\S]*?ANSWER:\s*([\s\S]+)/i);
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
