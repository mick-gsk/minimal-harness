import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { DefaultAgentLoop } from "../core/agent-loop.js";
import { DefaultPromptBuilder } from "../core/prompt-builder.js";
import { StructuredOutputValidator } from "../guardrails/validator.js";
import { DefaultToolBridge } from "../tools/tool-bridge.js";
import type { LLMAdapter } from "../types/llm.js";
import type { Memory } from "../types/memory.js";
import type { ToolDefinition, ToolInputSchema } from "../types/tool.js";
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
  /** Optional JSON schema the final answer must satisfy (structured extraction). */
  responseSchema?: ToolInputSchema;
}

/** Requests above this size are rejected — protects against memory abuse. */
const MAX_BODY_BYTES = 1024 * 1024;

/** In-process counters, exposed at GET /metrics in Prometheus text format. */
class Metrics {
  readonly requests = new Map<string, number>();
  readonly runsByReason = new Map<string, number>();
  toolCallsTotal = 0;
  runDurationMsSum = 0;
  runDurationMsCount = 0;

  countRequest(route: string, status: number): void {
    const key = `route="${route}",status="${status}"`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
  }

  countRun(reason: string, durationMs: number, toolCalls: number): void {
    this.runsByReason.set(reason, (this.runsByReason.get(reason) ?? 0) + 1);
    this.toolCallsTotal += toolCalls;
    this.runDurationMsSum += durationMs;
    this.runDurationMsCount += 1;
  }

  render(): string {
    const lines = [
      "# TYPE harness_requests_total counter",
      ...[...this.requests].map(([labels, n]) => `harness_requests_total{${labels}} ${n}`),
      "# TYPE harness_runs_total counter",
      ...[...this.runsByReason].map(([reason, n]) => `harness_runs_total{terminated_reason="${reason}"} ${n}`),
      "# TYPE harness_tool_calls_total counter",
      `harness_tool_calls_total ${this.toolCallsTotal}`,
      "# TYPE harness_run_duration_ms summary",
      `harness_run_duration_ms_sum ${this.runDurationMsSum}`,
      `harness_run_duration_ms_count ${this.runDurationMsCount}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

/**
 * Deployable HTTP layer over the harness: API-key auth, per-user session
 * isolation, optional SSE streaming. TLS and rate limiting belong in the
 * reverse proxy in front of this server.
 */
export function createAgentServer(options: AgentServerOptions): Server {
  const auth = new ApiKeyAuth(options.apiKeys);
  const maxTurnsCeiling = options.maxTurns ?? 10;
  const metrics = new Metrics();

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
    // Normalized route label (session ids collapsed) keeps metrics cardinality bounded.
    const route = (req.url ?? "").startsWith("/v1/sessions/") ? "/v1/sessions/{id}" : (req.url ?? "");
    res.on("finish", () => metrics.countRequest(route, res.statusCode));
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

    if (req.url === "/metrics") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(metrics.render());
      return;
    }

    if (req.url === "/v1/sessions" || req.url?.startsWith("/v1/sessions/")) {
      return handleSessions(req, res);
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

      if (body.stream === true) return runStreaming(res, userId, sessionId, body.message, maxTurns);

      const startedAt = Date.now();
      try {
        const result = await loop.run({
          sessionId,
          userMessage: body.message,
          maxTurns,
          ...(body.responseSchema ? { responseSchema: body.responseSchema } : {}),
        });
        recordRun(userId, sessionId, result.terminatedReason, startedAt, result.rawTurns.length, result.toolTrace.length);
        return sendJson(res, 200, {
          finalAnswer: result.finalAnswer,
          ...(result.structuredAnswer !== undefined ? { structuredAnswer: result.structuredAnswer } : {}),
          terminatedReason: result.terminatedReason,
          turns: result.rawTurns.length,
          toolCallCount: result.toolTrace.length,
        });
      } catch (err) {
        recordRun(userId, sessionId, "error", startedAt, 0, 0);
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    sendJson(res, 404, { error: "not found" });
  }

  /**
   * Session-management routes (GDPR Art. 15 access / Art. 17 erasure). Every
   * lookup is scoped to the caller's user id, so foreign sessions are not
   * addressable at all.
   */
  async function handleSessions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const userId = auth.resolveUser(req.headers.authorization);
    if (!userId) return sendJson(res, 401, { error: "invalid or missing API key" });

    const memory = options.memory;
    if (req.url === "/v1/sessions") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      if (!memory.listSessions) {
        return sendJson(res, 501, { error: "the configured Memory does not implement listSessions" });
      }
      const prefix = `${userId}:`;
      const ids = await memory.listSessions(prefix);
      return sendJson(res, 200, { sessions: ids.map((id) => id.slice(prefix.length)) });
    }

    const ownId = decodeURIComponent((req.url ?? "").slice("/v1/sessions/".length));
    if (!ownId) return sendJson(res, 404, { error: "not found" });
    const scopedId = `${userId}:${ownId}`;

    if (req.method === "GET") {
      const state = await memory.get(scopedId);
      if (state.messages.length === 0) return sendJson(res, 404, { error: "session not found" });
      return sendJson(res, 200, { sessionId: ownId, messages: state.messages });
    }
    if (req.method === "DELETE") {
      await memory.clear(scopedId);
      res.writeHead(204);
      res.end();
      return;
    }
    sendJson(res, 405, { error: "method not allowed" });
  }

  /** One structured JSON log line per run — metadata only, never message content. */
  function recordRun(
    userId: string,
    sessionId: string,
    reason: string,
    startedAt: number,
    turns: number,
    toolCalls: number,
  ): void {
    const durationMs = Date.now() - startedAt;
    metrics.countRun(reason, durationMs, toolCalls);
    logger.info(
      JSON.stringify({ ts: new Date().toISOString(), userId, sessionId, terminatedReason: reason, durationMs, turns, toolCalls }),
    );
  }

  async function runStreaming(
    res: ServerResponse,
    userId: string,
    sessionId: string,
    userMessage: string,
    maxTurns: number,
  ): Promise<void> {
    const startedAt = Date.now();
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
      recordRun(userId, sessionId, result.terminatedReason, startedAt, result.rawTurns.length, result.toolTrace.length);
      send("result", {
        finalAnswer: result.finalAnswer,
        terminatedReason: result.terminatedReason,
        turns: result.rawTurns.length,
        toolCallCount: result.toolTrace.length,
      });
    } catch (err) {
      recordRun(userId, sessionId, "error", startedAt, 0, 0);
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
