import type { GuardrailPolicy } from "./guardrails.js";

export interface OllamaClientConfig {
  baseUrl: string;
  model: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  /** Applied to every request unless overridden per call via LLMGenerateOptions.seed. */
  defaultSeed?: number;
  /**
   * Toggles extended thinking on models that support it (e.g. qwen3).
   * false trades reasoning depth for a large latency win; omitted = model default.
   */
  think?: boolean;
  /**
   * Context window (num_ctx) requested per call. Research agents that read
   * files overflow the server default silently — Ollama drops the oldest
   * tokens, taking the system prompt with them. Omitted = server default.
   */
  numCtx?: number;
}

export interface AgentConfig {
  maxTurns: number;
  systemInstruction: string;
  guardrails: GuardrailPolicy;
}
