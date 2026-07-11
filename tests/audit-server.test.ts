import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentServer } from "../src/server/agent-server.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";

const API_KEYS = { "sk-alice": "alice" };

/** Calls the calculator once, then returns a final answer — exercises the audit path. */
function makeToolThenAnswerLlm() {
  return adapterFromFn(async (messages, options) => {
    const usedTool = messages.some((m) => m.role === "tool");
    const content = usedTool
      ? "ACTION: final_answer\nANSWER: done"
      : 'ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression": "2 + 3"}';
    if (options?.onToken) options.onToken(content);
    return { content };
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("agent-server compliance (audit + AI disclosure)", () => {
  let dir: string;
  let server: Server;
  let base: string;
  const memory = new InMemoryMemory();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "audit-srv-"));
    server = createAgentServer({
      llm: makeToolThenAnswerLlm(),
      tools: [calculatorTool],
      memory,
      apiKeys: API_KEYS,
      maxTurns: 5,
      auditDb: join(dir, "audit.db"),
      // aiDisclosure defaults to true.
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    rmSync(dir, { recursive: true, force: true });
  });

  function run(body: unknown): Promise<Response> {
    return fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
      body: JSON.stringify(body),
    });
  }

  it("marks answers as AI-generated (field + header) and discloses on the first turn only", async () => {
    const res1 = await run({ sessionId: "disc", message: "first" });
    expect(res1.status).toBe(200);
    expect(res1.headers.get("x-ai-generated")).toBe("true");
    const body1 = (await res1.json()) as { aiGenerated?: boolean; disclosure?: string };
    expect(body1.aiGenerated).toBe(true);
    expect(body1.disclosure).toContain("KI-System");

    // Second turn of the same session: still flagged, but no repeated disclosure.
    const res2 = await run({ sessionId: "disc", message: "second" });
    const body2 = (await res2.json()) as { aiGenerated?: boolean; disclosure?: string };
    expect(body2.aiGenerated).toBe(true);
    expect(body2.disclosure).toBeUndefined();
  });

  it("audits the full run and GET /v1/audit/verify confirms an intact chain", async () => {
    await run({ sessionId: "audited", message: "compute" });

    const res = await fetch(`${base}/v1/audit/verify`, { headers: { Authorization: "Bearer sk-alice" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; events: number; brokenAtSeq?: number };
    expect(body.ok).toBe(true);
    // Across all runs so far we logged run_start/tool_call/tool_result/final_answer/run_end.
    expect(body.events).toBeGreaterThanOrEqual(5);
  });

  it("requires auth on the verify endpoint", async () => {
    expect((await fetch(`${base}/v1/audit/verify`)).status).toBe(401);
  });
});

describe("agent-server with AI disclosure disabled", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createAgentServer({
      llm: makeToolThenAnswerLlm(),
      tools: [calculatorTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
      aiDisclosure: false,
      // No auditDb: /v1/audit/verify must report "not enabled".
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it("omits the AI-generated field and header when disabled", async () => {
    const res = await fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
      body: JSON.stringify({ sessionId: "s", message: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ai-generated")).toBeNull();
    const body = (await res.json()) as { aiGenerated?: boolean };
    expect(body.aiGenerated).toBeUndefined();
  });

  it("returns 501 from /v1/audit/verify when the audit log is not configured", async () => {
    const res = await fetch(`${base}/v1/audit/verify`, { headers: { Authorization: "Bearer sk-alice" } });
    expect(res.status).toBe(501);
  });
});
