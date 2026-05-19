import type { GuardrailPolicy } from "../types/guardrails.js";

export const defaultPolicy: GuardrailPolicy = {
  maxToolCallsPerTurn: 1,
  allowedTools: [],   // empty = allow all registered tools
  requireStructuredOutput: true,
};

export function isToolAllowed(toolName: string, policy: GuardrailPolicy): boolean {
  if (policy.allowedTools.length === 0) return true;
  return policy.allowedTools.includes(toolName);
}
