import type { ChatMessage, LLMAdapter, LLMGenerateOptions, LLMResponse } from "../src/index.js";

interface OllamaEvalCounts {
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Decorator that counts LLM calls and sums Ollama token counts without
 * touching the core (spec §6: no core rebuild for measurement).
 */
export function withTelemetry(
  inner: LLMAdapter,
): LLMAdapter & { stats: { llmCalls: number; tokens: number } } {
  const stats = { llmCalls: 0, tokens: 0 };
  return {
    stats,
    async generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
      stats.llmCalls++;
      const res = await inner.generate(messages, options);
      const raw = (res.raw ?? {}) as OllamaEvalCounts;
      stats.tokens += (raw.prompt_eval_count ?? 0) + (raw.eval_count ?? 0);
      return res;
    },
  };
}
