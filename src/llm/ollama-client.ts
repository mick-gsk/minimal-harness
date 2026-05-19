import type { LLMAdapter, ChatMessage, LLMGenerateOptions, LLMResponse } from "../types/llm.js";
import type { OllamaClientConfig } from "../types/config.js";

interface OllamaChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  options?: { temperature?: number; num_predict?: number; stop?: string[] };
}

interface OllamaChatResponse {
  message: { role: string; content: string };
  model: string;
}

export class OllamaClient implements LLMAdapter {
  constructor(private readonly config: OllamaClientConfig) {}

  async generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    const body: OllamaChatRequest = {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? this.config.defaultTemperature ?? 0.7,
        num_predict: options?.maxTokens ?? this.config.defaultMaxTokens,
        stop: options?.stop,
      },
    };

    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return { content: data.message.content, raw: data, model: data.model };
  }
}
