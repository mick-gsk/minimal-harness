import type {
  LLMAdapter,
  ChatMessage,
  LLMGenerateOptions,
  LLMResponse,
  LLMToolCall,
} from "../types/llm.js";
import type { OllamaClientConfig } from "../types/config.js";
import { safeParseJson } from "../utils/json.js";

interface OllamaFunctionSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OllamaChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  options: { temperature: number; num_predict?: number; stop?: string[] };
  tools?: OllamaFunctionSpec[];
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: unknown };
}

interface OllamaChatResponse {
  message: { role: string; content: string; tool_calls?: OllamaToolCall[] };
  model: string;
}

export class OllamaClient implements LLMAdapter {
  constructor(private readonly config: OllamaClientConfig) {}

  async generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    const numPredict = options?.maxTokens ?? this.config.defaultMaxTokens;
    const streaming = typeof options?.onToken === "function";
    const body: OllamaChatRequest = {
      model: this.config.model,
      messages,
      stream: streaming,
      options: {
        temperature: options?.temperature ?? this.config.defaultTemperature ?? 0.7,
        ...(numPredict !== undefined ? { num_predict: numPredict } : {}),
        ...(options?.stop !== undefined ? { stop: options.stop } : {}),
      },
      ...(options?.tools && options.tools.length > 0
        ? {
            tools: options.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };

    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }

    if (streaming) {
      return readStream(res, options!.onToken!);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const toolCalls = extractToolCalls(data.message.tool_calls);

    return {
      content: data.message.content,
      raw: data,
      model: data.model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

interface OllamaStreamChunk {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  model?: string;
}

/** Reads Ollama's newline-delimited JSON stream, emitting each content chunk. */
async function readStream(res: Response, onToken: (chunk: string) => void): Promise<LLMResponse> {
  if (!res.body) throw new Error("Ollama streaming response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let content = "";
  let model: string | undefined;
  let lastRaw: unknown;
  const toolCalls: LLMToolCall[] = [];

  const ingest = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = safeParseJson<OllamaStreamChunk>(trimmed);
    if (!parsed.ok) return;
    const chunk = parsed.value.message?.content ?? "";
    if (chunk) {
      content += chunk;
      onToken(chunk);
    }
    if (parsed.value.model) model = parsed.value.model;
    toolCalls.push(...extractToolCalls(parsed.value.message?.tool_calls));
    lastRaw = parsed.value;
  };

  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      ingest(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  ingest(buffer); // flush any trailing partial line

  return {
    content,
    raw: lastRaw,
    ...(model !== undefined ? { model } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

/** Normalises Ollama's native tool_calls; arguments may arrive as object or JSON string. */
function extractToolCalls(raw: OllamaToolCall[] | undefined): LLMToolCall[] {
  if (!raw) return [];
  const calls: LLMToolCall[] = [];
  for (const call of raw) {
    const name = call.function?.name;
    if (!name) continue;
    let args = call.function?.arguments;
    if (typeof args === "string") {
      const parsed = safeParseJson(args);
      args = parsed.ok ? parsed.value : args;
    }
    calls.push({ name, arguments: args });
  }
  return calls;
}
