export type { LLMAdapter, ChatMessage, LLMGenerateOptions, LLMResponse } from "../types/llm.js";

/**
 * Helper: wraps a plain generate function into an LLMAdapter.
 * Useful for testing and lightweight custom backends.
 */
import type { LLMAdapter, ChatMessage, LLMGenerateOptions, LLMResponse } from "../types/llm.js";

export function adapterFromFn(
  fn: (messages: ChatMessage[], options?: LLMGenerateOptions) => Promise<LLMResponse>,
): LLMAdapter {
  return { generate: fn };
}
