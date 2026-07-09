/**
 * llama.cpp server exposes a /completion endpoint.
 * Stub – implement when needed.
 */
import type { LLMAdapter, ChatMessage, LLMGenerateOptions, LLMResponse } from "../types/llm.js";

export class LlamaCppAdapter implements LLMAdapter {
  constructor(private readonly baseUrl: string) {}

  async generate(_messages: ChatMessage[], _options?: LLMGenerateOptions): Promise<LLMResponse> {
    throw new Error("LlamaCppAdapter: not yet implemented");
  }
}
