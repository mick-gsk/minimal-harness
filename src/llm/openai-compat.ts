import type {
  LLMAdapter,
  ChatMessage,
  LLMGenerateOptions,
  LLMResponse,
  LLMToolCall,
} from "../types/llm.js";
import { safeParseJson } from "../utils/json.js";

export interface OpenAiCompatConfig {
  /** Base URL including the /v1 prefix, e.g. "http://localhost:1234/v1". */
  baseUrl: string;
  model: string;
  /** Sent as Bearer token; local servers usually need none. */
  apiKey?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  defaultSeed?: number;
}

interface CompatToolCall {
  index?: number;
  function?: { name?: string; arguments?: unknown };
}

interface CompatChoiceMessage {
  content?: string | null;
  tool_calls?: CompatToolCall[];
}

interface CompatResponse {
  model?: string;
  choices?: Array<{ message?: CompatChoiceMessage }>;
}

interface CompatStreamChunk {
  model?: string;
  choices?: Array<{ delta?: CompatChoiceMessage }>;
}

/**
 * Adapter for any OpenAI-compatible chat-completions server
 * (LM Studio, llama.cpp server, Ollama's /v1 endpoint, vLLM, ...).
 * Role "tool" messages are passed through without tool_call_id tracking —
 * accepted by all listed local servers.
 */
export class OpenAiCompatAdapter implements LLMAdapter {
  constructor(private readonly config: OpenAiCompatConfig) {}

  async generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
    const streaming = typeof options?.onToken === "function";
    const maxTokens = options?.maxTokens ?? this.config.defaultMaxTokens;
    const seed = options?.seed ?? this.config.defaultSeed;
    const body = {
      model: this.config.model,
      messages,
      stream: streaming,
      temperature: options?.temperature ?? this.config.defaultTemperature ?? 0.7,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(options?.stop !== undefined ? { stop: options.stop } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(options?.tools && options.tools.length > 0
        ? {
            tools: options.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const excerpt = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`OpenAI-compat request failed: ${res.status} ${res.statusText} ${excerpt}`);
    }

    if (streaming) {
      return readSse(res, options!.onToken!);
    }

    const data = (await res.json()) as CompatResponse;
    const message = data.choices?.[0]?.message;
    const toolCalls = finalizeToolCalls(collectToolCalls(message?.tool_calls));

    return {
      content: message?.content ?? "",
      raw: data,
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

interface PendingToolCall {
  name: string;
  argumentText: string;
  argumentValue?: unknown;
}

/** Collects complete (non-delta) tool calls from a response message. */
function collectToolCalls(raw: CompatToolCall[] | undefined): Map<number, PendingToolCall> {
  const pending = new Map<number, PendingToolCall>();
  if (raw) for (const [i, call] of raw.entries()) mergeToolCallDelta(pending, call, i);
  return pending;
}

/** Merges one (possibly partial) tool-call fragment into the accumulator. */
function mergeToolCallDelta(pending: Map<number, PendingToolCall>, call: CompatToolCall, fallbackIndex: number): void {
  const index = call.index ?? fallbackIndex;
  const entry = pending.get(index) ?? { name: "", argumentText: "" };
  if (call.function?.name) entry.name = call.function.name;
  const args = call.function?.arguments;
  if (typeof args === "string") entry.argumentText += args;
  else if (args !== undefined) entry.argumentValue = args;
  pending.set(index, entry);
}

function finalizeToolCalls(pending: Map<number, PendingToolCall>): LLMToolCall[] {
  const calls: LLMToolCall[] = [];
  for (const [, entry] of [...pending.entries()].sort(([a], [b]) => a - b)) {
    if (!entry.name) continue;
    let args: unknown = entry.argumentValue;
    if (args === undefined) {
      const parsed = safeParseJson(entry.argumentText);
      args = parsed.ok ? parsed.value : entry.argumentText;
    }
    calls.push({ name: entry.name, arguments: args });
  }
  return calls;
}

/** Reads an SSE stream ("data: {...}" lines, terminated by "data: [DONE]"). */
async function readSse(res: Response, onToken: (chunk: string) => void): Promise<LLMResponse> {
  if (!res.body) throw new Error("OpenAI-compat streaming response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let content = "";
  let model: string | undefined;
  let lastRaw: unknown;
  const pending = new Map<number, PendingToolCall>();

  const ingest = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return;
    const parsed = safeParseJson<CompatStreamChunk>(payload);
    if (!parsed.ok) return;
    const delta = parsed.value.choices?.[0]?.delta;
    if (delta?.content) {
      content += delta.content;
      onToken(delta.content);
    }
    if (delta?.tool_calls) {
      for (const [i, call] of delta.tool_calls.entries()) mergeToolCallDelta(pending, call, i);
    }
    if (parsed.value.model) model = parsed.value.model;
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

  const toolCalls = finalizeToolCalls(pending);
  return {
    content,
    raw: lastRaw,
    ...(model !== undefined ? { model } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}
