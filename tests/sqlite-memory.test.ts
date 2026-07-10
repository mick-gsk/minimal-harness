import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMemory } from "../src/memory/sqlite-memory.js";
import type { MemoryRecord } from "../src/types/memory.js";

function record(partial: Partial<MemoryRecord> = {}): MemoryRecord {
  return { role: "user", content: "hello", timestamp: 1000, ...partial };
}

describe("sqlite-memory", () => {
  const dirs: string[] = [];
  const open: SqliteMemory[] = [];

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-memory-"));
    dirs.push(dir);
    return join(dir, "memory.db");
  }

  function openMemory(path: string): SqliteMemory {
    const memory = new SqliteMemory(path);
    open.push(memory);
    return memory;
  }

  afterEach(() => {
    for (const memory of open.splice(0)) memory.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("appends and reads back records in order", async () => {
    const memory = openMemory(":memory:");
    await memory.append("s1", record({ content: "first" }));
    await memory.append("s1", record({ role: "assistant", content: "second" }));
    const state = await memory.get("s1");
    expect(state.messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(state.messages[1]!.role).toBe("assistant");
  });

  it("returns empty state for unknown session", async () => {
    const memory = openMemory(":memory:");
    const state = await memory.get("nope");
    expect(state.messages).toEqual([]);
  });

  it("persists records across close and reopen on the same file", async () => {
    const path = tempDbPath();
    const first = openMemory(path);
    await first.append("s1", record({ content: "survives" }));
    first.close();

    const second = openMemory(path);
    const state = await second.get("s1");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.content).toBe("survives");
  });

  it("isolates sessions from each other", async () => {
    const memory = openMemory(":memory:");
    await memory.append("a", record({ content: "for a" }));
    await memory.append("b", record({ content: "for b" }));
    expect((await memory.get("a")).messages.map((m) => m.content)).toEqual(["for a"]);
    expect((await memory.get("b")).messages.map((m) => m.content)).toEqual(["for b"]);
  });

  it("clear removes only the given session", async () => {
    const memory = openMemory(":memory:");
    await memory.append("a", record());
    await memory.append("b", record());
    await memory.clear("a");
    expect((await memory.get("a")).messages).toEqual([]);
    expect((await memory.get("b")).messages).toHaveLength(1);
  });

  it("round-trips metadata", async () => {
    const memory = openMemory(":memory:");
    await memory.append("s1", record({ metadata: { toolName: "clock.now", nested: { k: 1 } } }));
    const state = await memory.get("s1");
    expect(state.messages[0]!.metadata).toEqual({ toolName: "clock.now", nested: { k: 1 } });
  });

  it("omits metadata that is not valid JSON instead of throwing", async () => {
    const path = tempDbPath();
    const memory = openMemory(path);
    await memory.append("s1", record());
    memory.raw().prepare("UPDATE messages SET metadata = ?").run("{broken");
    const state = await memory.get("s1");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.metadata).toBeUndefined();
  });

  it("keeps insertion order stable for identical timestamps", async () => {
    const memory = openMemory(":memory:");
    for (let i = 0; i < 20; i++) {
      await memory.append("s1", record({ content: `msg-${i}`, timestamp: 42 }));
    }
    const state = await memory.get("s1");
    expect(state.messages.map((m) => m.content)).toEqual(
      Array.from({ length: 20 }, (_, i) => `msg-${i}`),
    );
  });

  it("throws a clear error for an unwritable path", () => {
    expect(() => new SqliteMemory("/nonexistent-dir/nope/memory.db")).toThrow(/memory\.db|unable|cannot/i);
  });

  it("lists sessions, optionally filtered by prefix", async () => {
    const memory = openMemory(":memory:");
    await memory.append("alice:chat-1", record());
    await memory.append("alice:chat-2", record());
    await memory.append("bob:chat-1", record());
    expect((await memory.listSessions()).sort()).toEqual(["alice:chat-1", "alice:chat-2", "bob:chat-1"]);
    expect((await memory.listSessions("alice:")).sort()).toEqual(["alice:chat-1", "alice:chat-2"]);
    expect(await memory.listSessions("carol:")).toEqual([]);
  });

  it("perf smoke: 10k appends and a 1k-message get", async () => {
    const memory = openMemory(tempDbPath());
    const appendStart = performance.now();
    for (let i = 0; i < 10_000; i++) {
      await memory.append(`s${i % 10}`, record({ content: `m${i}`, timestamp: i }));
    }
    const appendMs = performance.now() - appendStart;

    const getStart = performance.now();
    const state = await memory.get("s0");
    const getMs = performance.now() - getStart;

    expect(state.messages).toHaveLength(1000);
    // No perf gate — documented magnitude only (spec: Validierung Stufe 2).
    console.info(`[perf-smoke] 10k appends: ${appendMs.toFixed(0)} ms, get(1k msgs): ${getMs.toFixed(1)} ms`);
  });
});
