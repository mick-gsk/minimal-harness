export interface ParsedAssistantOutput {
  kind: "final" | "tool_call" | "invalid";
  finalText?: string;
  toolName?: string;
  toolArguments?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  parsed?: ParsedAssistantOutput;
}

export interface OutputValidator {
  validate(rawText: string): ValidationResult;
}

export interface GuardrailPolicy {
  maxToolCallsPerTurn: number;
  allowedTools: string[];
  requireStructuredOutput: boolean;
}
