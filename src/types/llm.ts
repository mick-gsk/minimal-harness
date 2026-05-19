export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export interface LLMResponse {
  content: string;
  raw?: unknown;
  model?: string;
}

export interface LLMAdapter {
  generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse>;
}
