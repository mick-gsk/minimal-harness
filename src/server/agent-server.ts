import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { DefaultAgentLoop } from "../core/agent-loop.js";
import { DefaultPromptBuilder } from "../core/prompt-builder.js";
import { StructuredOutputValidator } from "../guardrails/validator.js";
import { DefaultToolBridge } from "../tools/tool-bridge.js";
import type { LLMAdapter } from "../types/llm.js";
import type { Memory } from "../types/memory.js";
import type { ToolDefinition } from "../types/tool.js";
import { logger } from "../utils/logger.js";
import { ApiKeyAuth } from "./auth.js";

export interface AgentServerOptions {
  llm: LLMAdapter;
  tools: ToolDefinition[];
  /** Use SqliteMemory for durable multi-user operation. */
  memory: Memory;
  /** apiKey -> userId. The userId scopes every session key. */
  apiKeys: Record<string, string>;
  systemInstruction?: string;
  nativeToolCalling?: boolean;
  parallelToolCalls?: boolean;
  /** Server-side ceiling for per-request maxTurns. Defaults to 10 (loop default). */
  maxTurns?: number;
}

interface RunRequest {
  sessionId: string;
  message: string;
  maxTurns?: number;
  stream?: boolean;
}

/** Requests above this size are rejected — protects against memory abuse. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Deployable HTTP layer over the harness: API-key auth, per-user session
 * isolation, optional SSE streaming. TLS and rate limiting belong in the
 * reverse proxy in front of this server.
 */
export function createAgentServer(options: AgentServerOptions): Server {
  const auth = new ApiKeyAuth(options.apiKeys);
  const maxTurnsCeiling = options.maxTurns ?? 10;

  const toolBridge = new DefaultToolBridge();
  for (const tool of options.tools) toolBridge.register(tool);

  // One stateless loop for all requests; per-session state lives in memory.
  const loop = new DefaultAgentLoop({
    llm: options.llm,
    memory: options.memory,
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
    ...(options.systemInstruction !== undefined ? { systemInstruction: options.systemInstruction } : {}),
    ...(options.nativeToolCalling !== undefined ? { nativeToolCalling: options.nativeToolCalling } : {}),
    ...(options.parallelToolCalls !== undefined ? { parallelToolCalls: options.parallelToolCalls } : {}),
  });

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.warn(`Unhandled server error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal server error" });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url === "/healthz") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      return sendJson(res, 200, { status: "ok" });
    }

    if (req.url === "/v1/agent/run") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });

      const userId = auth.resolveUser(req.headers.authorization);
      if (!userId) return sendJson(res, 401, { error: "invalid or missing API key" });

      let body: RunRequest;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid body" });
      }
      if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
        return sendJson(res, 400, { error: "sessionId (string) is required" });
      }
      if (typeof body.message !== "string" || body.message.length === 0) {
        return sendJson(res, 400, { error: "message (string) is required" });
      }

      // The user id comes from the API key only — never from the request —
      // so one user can neither read nor write another user's sessions.
      const sessionId = `${userId}:${body.sessionId}`;
      const maxTurns = Math.min(body.maxTurns ?? maxTurnsCeiling, maxTurnsCeiling);

      if (body.stream === true) return runStreaming(res, sessionId, body.message, maxTurns);

      try {
        const result = await loop.run({ sessionId, userMessage: body.message, maxTurns });
        return sendJson(res, 200, {
          finalAnswer: result.finalAnswer,
          terminatedReason: result.terminatedReason,
          turns: result.rawTurns.length,
          toolCallCount: result.toolTrace.length,
        });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    sendJson(res, 404, { error: "not found" });
  }

  async function runStreaming(
    res: ServerResponse,
    sessionId: string,
    userMessage: string,
    maxTurns: number,
  ): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await loop.run({
        sessionId,
        userMessage,
        maxTurns,
        onToken: (chunk) => send("token", { chunk }),
      });
      send("result", {
        finalAnswer: result.finalAnswer,
        terminatedReason: result.terminatedReason,
        turns: result.rawTurns.length,
        toolCallCount: result.toolTrace.length,
      });
    } catch (err) {
      send("error", { error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: IncomingMessage): Promise<RunRequest> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RunRequest);
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}
