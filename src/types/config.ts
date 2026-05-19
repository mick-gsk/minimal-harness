import type { GuardrailPolicy } from "./guardrails.js";

export interface OllamaClientConfig {
  baseUrl: string;
  model: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export interface AgentConfig {
  maxTurns: number;
  systemInstruction: string;
  guardrails: GuardrailPolicy;
}
