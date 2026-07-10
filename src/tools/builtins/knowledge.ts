import type { ToolDefinition } from "../../types/tool.js";
import type { SqliteKnowledgeStore } from "../../rag/knowledge-store.js";

export interface KnowledgeToolOptions {
  /** How many chunks a search returns. 3 balances context size vs. recall. */
  topK?: number;
}

/**
 * Factory (the tool needs a store instance): exposes the local knowledge base
 * to the agent as a ranked search tool.
 */
export function makeKnowledgeSearchTool(
  store: SqliteKnowledgeStore,
  options: KnowledgeToolOptions = {},
): ToolDefinition<{ query: string }, { results: Array<{ source: string; content: string; score: number }> }> {
  const topK = options.topK ?? 3;
  return {
    name: "knowledge.search",
    description:
      "Searches the internal knowledge base and returns the most relevant text passages with their source.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up" } },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input) {
      const hits = await store.search(input.query, topK);
      return { results: hits.map((h) => ({ ...h, score: Number(h.score.toFixed(4)) })) };
    },
  };
}
