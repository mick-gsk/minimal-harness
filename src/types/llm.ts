export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/** Backend-neutral description of a tool the model may call natively. */
export interface LLMToolSpec {
  name: string;
  description: string;
  /** JSON-Schema object describing the tool's parameters. */
  parameters: Record<string, unknown>;
}

/** A single tool call returned natively by the model. */
export interface LLMToolCall {
  name: string;
  arguments: unknown;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  /** Tool specs offered to backends that support native function calling. */
  tools?: LLMToolSpec[];
  /** Called with each incremental content chunk when the backend streams. */
  onToken?: (chunk: string) => void;
}

export interface LLMResponse {
  content: string;
  raw?: unknown;
  model?: string;
  /** Present when the backend returned native tool calls for this turn. */
  toolCalls?: LLMToolCall[];
}

export interface LLMAdapter {
  generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse>;
}
