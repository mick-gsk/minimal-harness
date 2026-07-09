import type { GuardrailPolicy } from "./guardrails.js";

export interface OllamaClientConfig {
  baseUrl: string;
  model: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  /** Applied to every request unless overridden per call via LLMGenerateOptions.seed. */
  defaultSeed?: number;
}

export interface AgentConfig {
  maxTurns: number;
  systemInstruction: string;
  guardrails: GuardrailPolicy;
}
