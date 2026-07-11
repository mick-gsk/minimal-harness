import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteKnowledgeStore } from "../src/rag/knowledge-store.js";
import { makeCompanyKnowledgeTool } from "../bench/company/tools.js";
import type { Embedder } from "../src/rag/embedder.js";

/**
 * Deterministic embedder: keyword-on-orthogonal-axis, so cosine ranking is
 * fully predictable and no network (Ollama) is touched. Same trick as
 * knowledge-store.test.ts.
 */
const AXES = ["urlaub", "rechnung", "server"];
const mockEmbedder: Embedder = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return AXES.map((axis) => (lower.includes(axis) ? 1 : 0.01));
    });
  },
};

describe("makeCompanyKnowledgeTool", () => {
  const dirs: string[] = [];

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "company-knowledge-"));
    dirs.push(dir);
    return join(dir, "knowledge.db");
  }

  /** Build a temp knowledge.db with three labelled chunks, then close it. */
  async function seed(): Promise<string> {
    const path = tempDbPath();
    const store = new SqliteKnowledgeStore(path, mockEmbedder);
    await store.add("hr/handbuch.txt", ["Urlaub muss zwei Wochen vorher beantragt werden."]);
    await store.add("finanzen/policy.txt", ["Rechnungen sind binnen 14 Tagen zu zahlen."]);
    await store.add("it/betrieb.txt", ["Der Server wird sonntags neu gestartet."]);
    store.close();
    return path;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns the top chunk with its source path as compact text", async () => {
    const tool = makeCompanyKnowledgeTool(await seed(), mockEmbedder);
    const out = (await tool.execute({ query: "Wie beantrage ich Urlaub?", topK: 1 })) as { result: string };
    expect(out.result).toContain("[1] hr/handbuch.txt");
    expect(out.result).toContain("(score ");
    expect(out.result).toContain("Urlaub muss zwei Wochen vorher beantragt werden.");
    // topK: 1 means exactly one block — no second-source noise.
    expect(out.result).not.toContain("finanzen/policy.txt");
    expect(out.result).not.toContain("it/betrieb.txt");
  });

  it("defaults to three chunks and ranks the query's topic first", async () => {
    const tool = makeCompanyKnowledgeTool(await seed(), mockEmbedder);
    const out = (await tool.execute({ query: "server neustart" })) as { result: string };
    const firstLine = out.result.split("\n")[0]!;
    expect(firstLine).toContain("it/betrieb.txt");
    // three sources indexed → default topK 3 returns all three blocks.
    expect(out.result).toContain("[1]");
    expect(out.result).toContain("[2]");
    expect(out.result).toContain("[3]");
  });

  it("caps topK so one call cannot flood the context window", async () => {
    const tool = makeCompanyKnowledgeTool(await seed(), mockEmbedder);
    const out = (await tool.execute({ query: "rechnung", topK: 999 })) as { result: string };
    // only three chunks exist, and the cap would clamp anyway — never a crash.
    expect(out.result).toContain("[3]");
    expect(out.result).not.toContain("[4]");
  });

  it("returns a helpful error string when the knowledge db is missing", async () => {
    const missing = join(tempDbPath(), "..", "does-not-exist.db");
    const tool = makeCompanyKnowledgeTool(missing, mockEmbedder);
    await expect(tool.execute({ query: "irgendwas" })).rejects.toThrow(/missing.*build-knowledge\.ts/);
  });

  it("rejects an empty query", async () => {
    const tool = makeCompanyKnowledgeTool(await seed(), mockEmbedder);
    await expect(tool.execute({ query: "   " })).rejects.toThrow(/non-empty query/);
  });
});
