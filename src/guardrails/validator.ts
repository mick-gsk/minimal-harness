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

    const toolMatch = text.match(
      /ACTION:\s*tool_call[\s\S]*?TOOL:\s*([\w.]+)[\s\S]*?ARGS:\s*({[\s\S]*})/i,
    );
    if (toolMatch) {
      const toolName = toolMatch[1]!;
      const parsed = safeParseJson(toolMatch[2]!);
      if (!parsed.ok) {
        return { valid: false, reason: `ARGS is not valid JSON: ${parsed.error}` };
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
