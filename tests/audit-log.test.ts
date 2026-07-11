import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog, type AuditRow } from "../src/audit/audit-log.js";
import { withAudit } from "../src/audit/with-audit.js";
import type { ToolDefinition } from "../src/types/tool.js";

const DAY_MS = 86_400_000;

describe("AuditLog", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "audit-"));
    dbPath = join(dir, "audit.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds a valid, verifiable hash chain across appends", () => {
    const log = new AuditLog(dbPath);
    const r1 = log.append({ userId: "alice", sessionId: "s1", event: "run_start", payload: { maxTurns: 5 } });
    const r2 = log.append({ userId: "alice", sessionId: "s1", event: "tool_call", payload: { tool: "calc" } });
    const r3 = log.append({ userId: "alice", sessionId: "s1", event: "run_end", payload: { terminatedReason: "final_answer" } });

    expect(r1.seq).toBe(1);
    expect(r3.seq).toBe(3);
    // Each row links to its predecessor's hash.
    expect(r2.prevHash).toBe(r1.hash);
    expect(r3.prevHash).toBe(r2.hash);

    expect(log.verifyChain()).toEqual({ ok: true });
    expect(log.countEvents()).toBe(3);
    log.close();
  });

  it("detects tampering of a row and reports brokenAtSeq", () => {
    const log = new AuditLog(dbPath);
    log.append({ userId: "u", sessionId: "s", event: "run_start", payload: { a: 1 } });
    log.append({ userId: "u", sessionId: "s", event: "tool_result", payload: { output: "secret" } });
    log.append({ userId: "u", sessionId: "s", event: "run_end", payload: { ok: true } });
    log.close();

    // Manipulate row seq=2 directly on disk (payload changed, hash untouched).
    const raw = new DatabaseSync(dbPath);
    raw.prepare("UPDATE audit_events SET payload = ? WHERE seq = 2").run('{"output":"tampered"}');
    raw.close();

    const reopened = new AuditLog(dbPath);
    const result = reopened.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
    reopened.close();
  });

  it("detects deletion of the last row (chain truncation at the end)", () => {
    const log = new AuditLog(dbPath);
    log.append({ userId: "u", sessionId: "s", event: "run_start" });
    log.append({ userId: "u", sessionId: "s", event: "run_end" });
    log.close();

    const raw = new DatabaseSync(dbPath);
    raw.prepare("DELETE FROM audit_events WHERE seq = 2").run();
    raw.close();

    const reopened = new AuditLog(dbPath);
    const result = reopened.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
    reopened.close();
  });

  it("truncates oversized tool_result payloads with a truncation marker", () => {
    const log = new AuditLog(dbPath, { maxPayloadBytes: 64 });
    const big = "x".repeat(5000);
    log.append({ userId: "u", sessionId: "s", event: "tool_result", payload: { output: big } });
    // A non-tool_result payload of the same size is kept in full.
    log.append({ userId: "u", sessionId: "s", event: "final_answer", payload: { finalAnswer: big } });

    const rows = log.export().split("\n").map((l) => JSON.parse(l) as AuditRow);
    const toolResult = rows.find((r) => r.event === "tool_result")!;
    const marker = toolResult.payload as { truncated?: boolean; originalBytes?: number };
    expect(marker.truncated).toBe(true);
    expect(marker.originalBytes).toBeGreaterThan(64);

    const finalAnswer = rows.find((r) => r.event === "final_answer")!;
    expect((finalAnswer.payload as { finalAnswer: string }).finalAnswer.length).toBe(5000);

    // Truncation does not break the chain.
    expect(log.verifyChain()).toEqual({ ok: true });
    log.close();
  });

  it("prunes old events and keeps the chain verifiable from the checkpoint", () => {
    let clock = 1_000_000_000_000;
    const log = new AuditLog(dbPath, { now: () => clock });

    // Three old events.
    for (let i = 0; i < 3; i++) log.append({ userId: "u", sessionId: "s", event: "tool_call", payload: { i } });
    // Two recent events, 200 days later.
    clock += 200 * DAY_MS;
    log.append({ userId: "u", sessionId: "s", event: "run_start" });
    log.append({ userId: "u", sessionId: "s", event: "run_end" });

    const removed = log.pruneOlderThan(186);
    expect(removed).toBe(3);
    expect(log.countEvents()).toBe(2);

    // The chain still verifies: first remaining row links to the checkpoint hash.
    expect(log.verifyChain()).toEqual({ ok: true });

    // Appending after a prune continues the chain unbroken.
    log.append({ userId: "u", sessionId: "s", event: "final_answer" });
    expect(log.verifyChain()).toEqual({ ok: true });
    log.close();
  });

  it("export filters by session and event and yields one JSON object per line", () => {
    const log = new AuditLog(dbPath);
    log.append({ userId: "u", sessionId: "s1", event: "run_start" });
    log.append({ userId: "u", sessionId: "s2", event: "run_start" });
    log.append({ userId: "u", sessionId: "s1", event: "run_end" });

    const s1 = log.export({ sessionId: "s1" }).split("\n").map((l) => JSON.parse(l) as AuditRow);
    expect(s1.map((r) => r.seq)).toEqual([1, 3]);

    const starts = log.export({ event: "run_start" }).split("\n").map((l) => JSON.parse(l) as AuditRow);
    expect(starts).toHaveLength(2);
    expect(starts.every((r) => r.event === "run_start")).toBe(true);
    log.close();
  });
});

describe("withAudit decorator", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "audit-dec-"));
    dbPath = join(dir, "audit.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const echoTool: ToolDefinition = {
    name: "echo",
    description: "returns its input",
    inputSchema: { type: "object", properties: {} },
    execute: async (input) => ({ echoed: input }),
  };

  const boomTool: ToolDefinition = {
    name: "boom",
    description: "always throws",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      throw new Error("kaboom");
    },
  };

  it("logs call+result and passes the tool output through unchanged", async () => {
    const log = new AuditLog(dbPath);
    const [wrapped] = withAudit([echoTool], log, { userId: "alice", sessionId: "s1" });

    const out = await wrapped!.execute({ n: 42 });
    expect(out).toEqual({ echoed: { n: 42 } });

    const rows = log.export().split("\n").map((l) => JSON.parse(l) as AuditRow);
    expect(rows.map((r) => r.event)).toEqual(["tool_call", "tool_result"]);
    expect((rows[0]!.payload as { tool: string }).tool).toBe("echo");
    expect((rows[1]!.payload as { output: unknown }).output).toEqual({ echoed: { n: 42 } });
    expect(log.verifyChain()).toEqual({ ok: true });
    log.close();
  });

  it("logs the error on a throwing tool and re-throws it", async () => {
    const log = new AuditLog(dbPath);
    const [wrapped] = withAudit([boomTool], log, { userId: "u", sessionId: "s" });

    await expect(wrapped!.execute({})).rejects.toThrow("kaboom");

    const rows = log.export().split("\n").map((l) => JSON.parse(l) as AuditRow);
    expect(rows.map((r) => r.event)).toEqual(["tool_call", "tool_result"]);
    expect((rows[1]!.payload as { error: string }).error).toBe("kaboom");
    log.close();
  });
});
