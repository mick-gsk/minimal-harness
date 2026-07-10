import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentServer } from "../src/server/agent-server.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { SqliteMemory } from "../src/memory/sqlite-memory.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";

const API_KEYS = { "sk-alice": "alice", "sk-bob": "bob" };

/** Echoes the latest user message back — lets tests verify session content. */
function makeEchoLlm() {
  return adapterFromFn(async (messages, options) => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const content = `ACTION: final_answer\nANSWER: echo:${lastUser?.content ?? ""}`;
    if (options?.onToken) {
      const mid = Math.ceil(content.length / 2);
      options.onToken(content.slice(0, mid));
      options.onToken(content.slice(mid));
    }
    return { content };
  });
}

describe("agent-server", () => {
  let server: Server;
  let base: string;
  const memory = new InMemoryMemory();

  beforeAll(async () => {
    server = createAgentServer({
      llm: makeEchoLlm(),
      tools: [calculatorTool],
      memory,
      apiKeys: API_KEYS,
      maxTurns: 5,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("no port");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  function run(body: unknown, key?: string): Promise<Response> {
    return fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("GET /healthz responds 200 without auth", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects a missing key with 401", async () => {
    const res = await run({ sessionId: "s", message: "hi" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong key with 401", async () => {
    const res = await run({ sessionId: "s", message: "hi" }, "sk-mallory");
    expect(res.status).toBe(401);
  });

  it("runs the loop for a valid key", async () => {
    const res = await run({ sessionId: "chat", message: "hello world" }, "sk-alice");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { finalAnswer: string; terminatedReason: string };
    expect(data.terminatedReason).toBe("final_answer");
    expect(data.finalAnswer).toBe("echo:hello world");
  });

  it("isolates sessions between users sharing the same sessionId", async () => {
    await run({ sessionId: "shared", message: "alice speaking" }, "sk-alice");
    await run({ sessionId: "shared", message: "bob speaking" }, "sk-bob");

    const alice = await memory.get("alice:shared");
    const bob = await memory.get("bob:shared");
    const aliceText = alice.messages.map((m) => m.content).join("\n");
    const bobText = bob.messages.map((m) => m.content).join("\n");

    expect(aliceText).toContain("alice speaking");
    expect(aliceText).not.toContain("bob speaking");
    expect(bobText).toContain("bob speaking");
    expect(bobText).not.toContain("alice speaking");
  });

  it("returns 400 for invalid JSON and for missing fields", async () => {
    expect((await run("{not json", "sk-alice")).status).toBe(400);
    expect((await run({ message: "no session" }, "sk-alice")).status).toBe(400);
    expect((await run({ sessionId: "s" }, "sk-alice")).status).toBe(400);
  });

  it("returns 404 for unknown routes and 405 for wrong methods", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/v1/agent/run`)).status).toBe(405);
  });

  it("streams SSE token events and a final result event", async () => {
    const res = await run({ sessionId: "sse", message: "stream me", stream: true }, "sk-alice");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();

    const tokenChunks = [...text.matchAll(/event: token\ndata: (.*)\n/g)].map(
      (m) => (JSON.parse(m[1]!) as { chunk: string }).chunk,
    );
    expect(tokenChunks.join("")).toContain("echo:stream me");

    const resultMatch = text.match(/event: result\ndata: (.*)\n/);
    expect(resultMatch).not.toBeNull();
    const result = JSON.parse(resultMatch![1]!) as { finalAnswer: string };
    expect(result.finalAnswer).toBe("echo:stream me");
  });

  it("returns 500 with an error body when the loop throws", async () => {
    const failing = createAgentServer({
      llm: adapterFromFn(async () => {
        throw new Error("backend down");
      }),
      tools: [],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
    });
    await new Promise<void>((resolve) => failing.listen(0, resolve));
    const address = failing.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
      body: JSON.stringify({ sessionId: "s", message: "hi" }),
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("backend down");
    await new Promise<void>((resolve, reject) => failing.close((e) => (e ? reject(e) : resolve())));
  });

  it("concurrency smoke: 20 parallel requests from 2 users over a real SQLite file stay isolated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "server-smoke-"));
    const sqlite = new SqliteMemory(join(dir, "memory.db"));
    const smoke = createAgentServer({
      llm: makeEchoLlm(),
      tools: [calculatorTool],
      memory: sqlite,
      apiKeys: API_KEYS,
    });
    await new Promise<void>((resolve) => smoke.listen(0, resolve));
    const address = smoke.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const t0 = performance.now();
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const user = i % 2 === 0 ? "sk-alice" : "sk-bob";
          return fetch(`http://127.0.0.1:${port}/v1/agent/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${user}` },
            body: JSON.stringify({ sessionId: `s${i}`, message: `msg-${i}` }),
          });
        }),
      );
      const wallMs = performance.now() - t0;

      expect(responses.every((r) => r.status === 200)).toBe(true);
      const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ finalAnswer: string }>));
      bodies.forEach((b, i) => expect(b.finalAnswer).toBe(`echo:msg-${i}`));

      // Isolation on disk: each session belongs to exactly one user scope.
      expect((await sqlite.get("alice:s0")).messages.length).toBeGreaterThan(0);
      expect((await sqlite.get("bob:s0")).messages.length).toBe(0);
      expect((await sqlite.get("bob:s1")).messages.length).toBeGreaterThan(0);

      console.info(`[perf-smoke] 20 parallel requests, 2 users, sqlite file: ${wallMs.toFixed(0)} ms`);
    } finally {
      await new Promise<void>((resolve, reject) => smoke.close((e) => (e ? reject(e) : resolve())));
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
