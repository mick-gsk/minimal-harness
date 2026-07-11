import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { DefaultAgentLoop } from "../core/agent-loop.js";
import { DefaultPromptBuilder } from "../core/prompt-builder.js";
import { StructuredOutputValidator } from "../guardrails/validator.js";
import { DefaultToolBridge } from "../tools/tool-bridge.js";
import type { LLMAdapter } from "../types/llm.js";
import type { Memory } from "../types/memory.js";
import type { ToolDefinition, ToolInputSchema } from "../types/tool.js";
import type { ToolBridge } from "../types/tool.js";
import { logger } from "../utils/logger.js";
import { ApiKeyAuth } from "./auth.js";
import { AuditLog } from "../audit/audit-log.js";
import { withAudit, type AuditContext } from "../audit/with-audit.js";

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
  /**
   * Tool names that need human approval before execution. Streaming clients
   * receive an approval_request SSE event and answer via
   * POST /v1/agent/approvals/{id}; non-streaming requests deny fail-closed.
   */
  requireApproval?: string[];
  /** How long an approval may stay unanswered before it is denied. Default 120s. */
  approvalTimeoutMs?: number;
  /**
   * Path to a SQLite file for the revision-safe, hash-chained audit log
   * (AI Act Art. 12/19/26(6), NIS2). When set, every run is audited
   * (run_start/tool_call/tool_result/approval/final_answer/run_end) and
   * GET /v1/audit/verify becomes available.
   */
  auditDb?: string;
  /**
   * AI transparency labelling (AI Act Art. 50, mandatory from 08/2026).
   * Adds `aiGenerated: true` + `X-AI-Generated` header to answer responses and,
   * on a session's first turn, a human-readable `disclosure` field. Default: on
   * (opt-out via `aiDisclosure: false`). Never written into the model's answer
   * text — response metadata only, so benchmarks stay unaffected.
   */
  aiDisclosure?: boolean;
}

/** Human-readable disclosure per Art. 50(1) — surfaced once per session. */
const DISCLOSURE_TEXT = "Diese Antwort wurde von einem KI-System erstellt und kann Fehler enthalten.";

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

  const requireApproval = new Set(options.requireApproval ?? []);
  const approvalTimeoutMs = options.approvalTimeoutMs ?? 120_000;
  const pendingApprovals = new Map<string, { userId: string; resolve: (ok: boolean) => void }>();

  const auditLog = options.auditDb ? new AuditLog(options.auditDb) : undefined;
  const aiDisclosure = options.aiDisclosure ?? true;

  // Per-request tool bridge whose tools log every call+result into the audit
  // chain (the shared bridge stays untouched, so non-audited runs are unchanged).
  function auditedBridge(ctx: AuditContext): ToolBridge {
    const bridge = new DefaultToolBridge();
    for (const tool of withAudit(options.tools, auditLog!, ctx)) bridge.register(tool);
    return bridge;
  }

  // Wraps a base approval callback so approve/deny decisions are also audited.
  type ApprovalFn = (call: { name: string; arguments: unknown }) => Promise<boolean>;
  function auditApproval(base: ApprovalFn | undefined, ctx: AuditContext): ApprovalFn | undefined {
    if (!auditLog || !base) return base;
    return async (call) => {
      const approved = await base(call);
      auditLog.append({ ...ctx, event: "approval", payload: { tool: call.name, approved } });
      return approved;
    };
  }

  // The loop is stateless (per-session state lives in memory), but the
  // approval hook is per-request in streaming mode — so we build loops on
  // demand and share everything else.
  function buildLoop(onToolApproval?: ApprovalFn, bridge: ToolBridge = toolBridge): DefaultAgentLoop {
    return new DefaultAgentLoop({
      llm: options.llm,
      memory: options.memory,
      toolBridge: bridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      ...(options.systemInstruction !== undefined ? { systemInstruction: options.systemInstruction } : {}),
      ...(options.nativeToolCalling !== undefined ? { nativeToolCalling: options.nativeToolCalling } : {}),
      ...(options.parallelToolCalls !== undefined ? { parallelToolCalls: options.parallelToolCalls } : {}),
      ...(onToolApproval ? { onToolApproval } : {}),
    });
  }

  // Non-streaming requests have no channel to ask a human — gated tools are
  // denied fail-closed rather than executed silently.
  const loop = buildLoop(
    requireApproval.size > 0 ? async (call) => !requireApproval.has(call.name) : undefined,
  );

  return createServer((req, res) => {
    // Normalized route label (ids collapsed) keeps metrics cardinality bounded.
    const url = req.url ?? "";
    const route = url.startsWith("/v1/sessions/")
      ? "/v1/sessions/{id}"
      : url.startsWith("/v1/agent/approvals/")
        ? "/v1/agent/approvals/{id}"
        : url;
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

    // Audit-chain integrity check (AI Act Art. 12/19). Authenticated users only.
    if (req.url === "/v1/audit/verify") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
      const userId = auth.resolveUser(req.headers.authorization);
      if (!userId) return sendJson(res, 401, { error: "invalid or missing API key" });
      if (!auditLog) return sendJson(res, 501, { error: "audit log is not enabled (set auditDb / AUDIT_DB)" });
      const result = auditLog.verifyChain();
      return sendJson(res, 200, { ...result, events: auditLog.countEvents() });
    }

    if (req.url?.startsWith("/v1/agent/approvals/")) {
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const userId = auth.resolveUser(req.headers.authorization);
      if (!userId) return sendJson(res, 401, { error: "invalid or missing API key" });
      const approvalId = decodeURIComponent(req.url.slice("/v1/agent/approvals/".length));
      const entry = pendingApprovals.get(approvalId);
      // Unknown id and foreign user look identical — no probing.
      if (!entry || entry.userId !== userId) return sendJson(res, 404, { error: "approval not found" });
      let body: { approve?: boolean };
      try {
        body = (await readJsonBody(req)) as { approve?: boolean };
      } catch (err) {
        return sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid body" });
      }
      if (typeof body.approve !== "boolean") return sendJson(res, 400, { error: "approve (boolean) is required" });
      entry.resolve(body.approve);
      return sendJson(res, 200, { status: "recorded" });
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

      const ctx: AuditContext = { userId, sessionId };
      // First turn (before this run writes to memory) → disclosure per Art. 50.
      const firstTurn = aiDisclosure ? (await options.memory.get(sessionId)).messages.length === 0 : false;

      let runLoop = loop;
      if (auditLog) {
        auditLog.append({ ...ctx, event: "run_start", payload: { maxTurns } });
        const base = requireApproval.size > 0 ? async (call: { name: string }) => !requireApproval.has(call.name) : undefined;
        runLoop = buildLoop(auditApproval(base, ctx), auditedBridge(ctx));
      }

      const startedAt = Date.now();
      try {
        const result = await runLoop.run({
          sessionId,
          userMessage: body.message,
          maxTurns,
          ...(body.responseSchema ? { responseSchema: body.responseSchema } : {}),
        });
        if (auditLog) {
          auditLog.append({ ...ctx, event: "final_answer", payload: { finalAnswer: result.finalAnswer } });
          auditLog.append({
            ...ctx,
            event: "run_end",
            payload: { terminatedReason: result.terminatedReason, turns: result.rawTurns.length, toolCalls: result.toolTrace.length },
          });
        }
        recordRun(userId, sessionId, result.terminatedReason, startedAt, result.rawTurns.length, result.toolTrace.length);
        return sendJson(
          res,
          200,
          {
            finalAnswer: result.finalAnswer,
            ...(result.structuredAnswer !== undefined ? { structuredAnswer: result.structuredAnswer } : {}),
            terminatedReason: result.terminatedReason,
            turns: result.rawTurns.length,
            toolCallCount: result.toolTrace.length,
            ...(aiDisclosure ? { aiGenerated: true, ...(firstTurn ? { disclosure: DISCLOSURE_TEXT } : {}) } : {}),
          },
          aiDisclosure ? { "X-AI-Generated": "true" } : undefined,
        );
      } catch (err) {
        if (auditLog) {
          auditLog.append({ ...ctx, event: "run_end", payload: { terminatedReason: "error", error: err instanceof Error ? err.message : String(err) } });
        }
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
    const ctx: AuditContext = { userId, sessionId };
    const firstTurn = aiDisclosure ? (await options.memory.get(sessionId)).messages.length === 0 : false;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(aiDisclosure ? { "X-AI-Generated": "true" } : {}),
    });
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Streaming has a live channel to the human: gated tools emit an
    // approval_request event and wait for POST /v1/agent/approvals/{id}.
    // No answer within approvalTimeoutMs denies fail-closed.
    const streamApproval: ApprovalFn | undefined =
      requireApproval.size > 0
        ? async (call) => {
            if (!requireApproval.has(call.name)) return true;
            const approvalId = randomUUID();
            return new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                pendingApprovals.delete(approvalId);
                resolve(false);
              }, approvalTimeoutMs);
              pendingApprovals.set(approvalId, {
                userId,
                resolve: (ok) => {
                  clearTimeout(timer);
                  pendingApprovals.delete(approvalId);
                  resolve(ok);
                },
              });
              send("approval_request", { approvalId, tool: call.name, arguments: call.arguments });
            });
          }
        : undefined;

    if (auditLog) auditLog.append({ ...ctx, event: "run_start", payload: { maxTurns } });
    const requestLoop =
      auditLog !== undefined
        ? buildLoop(auditApproval(streamApproval, ctx), auditedBridge(ctx))
        : streamApproval
          ? buildLoop(streamApproval)
          : loop;

    try {
      const result = await requestLoop.run({
        sessionId,
        userMessage,
        maxTurns,
        onToken: (chunk) => send("token", { chunk }),
      });
      if (auditLog) {
        auditLog.append({ ...ctx, event: "final_answer", payload: { finalAnswer: result.finalAnswer } });
        auditLog.append({
          ...ctx,
          event: "run_end",
          payload: { terminatedReason: result.terminatedReason, turns: result.rawTurns.length, toolCalls: result.toolTrace.length },
        });
      }
      recordRun(userId, sessionId, result.terminatedReason, startedAt, result.rawTurns.length, result.toolTrace.length);
      send("result", {
        finalAnswer: result.finalAnswer,
        terminatedReason: result.terminatedReason,
        turns: result.rawTurns.length,
        toolCallCount: result.toolTrace.length,
        ...(aiDisclosure ? { aiGenerated: true, ...(firstTurn ? { disclosure: DISCLOSURE_TEXT } : {}) } : {}),
      });
    } catch (err) {
      if (auditLog) {
        auditLog.append({ ...ctx, event: "run_end", payload: { terminatedReason: "error", error: err instanceof Error ? err.message : String(err) } });
      }
      recordRun(userId, sessionId, "error", startedAt, 0, 0);
      send("error", { error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown, headers?: Record<string, string>): void {
  res.writeHead(status, { "Content-Type": "application/json", ...(headers ?? {}) });
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
