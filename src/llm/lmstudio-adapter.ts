/**
 * LM Studio exposes an OpenAI-compatible REST API.
 * Stub – implement analogous to OllamaClient when needed.
 */
import type { LLMAdapter, ChatMessage, LLMGenerateOptions, LLMResponse } from "../types/llm.js";

export class LMStudioAdapter implements LLMAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate(_messages: ChatMessage[], _options?: LLMGenerateOptions): Promise<LLMResponse> {
    throw new Error("LMStudioAdapter: not yet implemented");
  }
}
