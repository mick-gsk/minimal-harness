import type { ParsedAssistantOutput } from "../types/guardrails.js";
import type { OutputValidator } from "../types/guardrails.js";

/**
 * Thin wrapper: delegates to the injected OutputValidator and
 * returns a typed ParsedAssistantOutput (never throws).
 */
export function parseAssistantOutput(
  rawText: string,
  validator: OutputValidator,
): ParsedAssistantOutput {
  const result = validator.validate(rawText);
  return result.parsed ?? { kind: "invalid" };
}
