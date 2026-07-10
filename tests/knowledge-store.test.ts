import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteKnowledgeStore } from "../src/rag/knowledge-store.js";
import { makeKnowledgeSearchTool } from "../src/tools/builtins/knowledge.js";
import type { Embedder } from "../src/rag/embedder.js";

/**
 * Deterministic embedder: maps known keywords onto orthogonal axes so cosine
 * ranking is fully predictable in tests.
 */
const AXES = ["urlaub", "rechnung", "server"];
const mockEmbedder: Embedder = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      const v = AXES.map((axis) => (lower.includes(axis) ? 1 : 0.01));
      return v;
    });
  },
};

describe("SqliteKnowledgeStore", () => {
  const dirs: string[] = [];
  const open: SqliteKnowledgeStore[] = [];

  function tempPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "knowledge-"));
    dirs.push(dir);
    return join(dir, "knowledge.db");
  }

  function openStore(path = ":memory:"): SqliteKnowledgeStore {
    const store = new SqliteKnowledgeStore(path, mockEmbedder);
    open.push(store);
    return store;
  }

  afterEach(() => {
    for (const store of open.splice(0)) store.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("ranks results by cosine similarity to the query", async () => {
    const store = openStore();
    await store.add("hr-handbuch", ["Urlaub muss 2 Wochen vorher beantragt werden."]);
    await store.add("finanzen", ["Rechnungen sind binnen 14 Tagen zu zahlen."]);
    await store.add("it-betrieb", ["Der Server wird sonntags neu gestartet."]);

    const hits = await store.search("Wie beantrage ich Urlaub?", 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.source).toBe("hr-handbuch");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("persists chunks across close and reopen", async () => {
    const path = tempPath();
    const first = openStore(path);
    await first.add("doc", ["Rechnung Nummer eins."]);
    first.close();

    const second = openStore(path);
    const hits = await second.search("rechnung", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toContain("Rechnung");
  });

  it("returns empty results on an empty store", async () => {
    const store = openStore();
    expect(await store.search("anything", 3)).toEqual([]);
  });

  it("counts stored chunks", async () => {
    const store = openStore();
    await store.add("a", ["eins", "zwei", "drei"]);
    expect(store.count()).toBe(3);
  });
});

describe("knowledge.search tool", () => {
  it("exposes the store to the agent as a ranked search tool", async () => {
    const store = new SqliteKnowledgeStore(":memory:", mockEmbedder);
    await store.add("hr-handbuch", ["Urlaub muss 2 Wochen vorher beantragt werden."]);
    await store.add("it-betrieb", ["Der Server wird sonntags neu gestartet."]);

    const tool = makeKnowledgeSearchTool(store, { topK: 1 });
    expect(tool.name).toBe("knowledge.search");
    const output = (await tool.execute({ query: "server neustart" })) as {
      results: Array<{ source: string; content: string; score: number }>;
    };
    expect(output.results).toHaveLength(1);
    expect(output.results[0]!.source).toBe("it-betrieb");
    store.close();
  });
});
