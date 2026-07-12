import { describe, it, expect } from "@jest/globals";
import type { Server } from "node:http";
import { createAgentServer, resolvePreset } from "../src/server/agent-server.js";
import { parsePreset } from "../src/server/config.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import type { ChatMessage, LLMResponse } from "../src/types/llm.js";
import type { ToolDefinition } from "../src/types/tool.js";

const API_KEYS = { "sk-alice": "alice" };

/** Minimal stand-in for makeKnowledgeSearchTool — no embeddings/DB needed. */
const knowledgeTool: ToolDefinition = {
  name: "knowledge.search",
  description: "Searches the internal knowledge base and returns passages.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  async execute() {
    return { results: [{ source: "doc-1", content: "hit", score: 0.9 }] };
  },
};

/**
 * Scripted, stateful LLM that records every prompt so a test can assert which
 * of the loop's calls happened. It dispatches on the last user message:
 *  - verify call  → returns `verifyText` (plain, so the loop adopts it)
 *  - scaffold plan call → returns a plan
 *  - action call  → one tool_call to `toolName` (if set), then final_answer
 */
function makeScriptedLlm(config: {
  toolName?: string;
  finalText: string;
  verifyText?: string;
}) {
  const calls: ChatMessage[][] = [];
  let toolCalled = false;
  const adapter = adapterFromFn(async (messages): Promise<LLMResponse> => {
    calls.push(messages);
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (lastUser.includes("re-check your answer")) {
      return { content: config.verifyText ?? config.finalText };
    }
    if (lastUser.includes("nummerierten Plan")) {
      return { content: "1. Quelle prüfen\n2. Antworten" };
    }
    if (config.toolName && !toolCalled) {
      toolCalled = true;
      return { content: `ACTION: tool_call\nTOOL: ${config.toolName}\nARGS: {"query":"x"}` };
    }
    return { content: `ACTION: final_answer\nANSWER: ${config.finalText}` };
  });
  return { adapter, calls };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  return `http://127.0.0.1:${addr.port}`;
}

function run(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/v1/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
    body: JSON.stringify(body),
  });
}

/** True if any recorded prompt mentions the tool name. */
function anyPromptMentions(calls: ChatMessage[][], needle: string): boolean {
  return calls.some((msgs) => msgs.some((m) => m.content.includes(needle)));
}

const baseOpts = {
  llm: adapterFromFn(async () => ({ content: "" })),
  tools: [],
  memory: new InMemoryMemory(),
  apiKeys: API_KEYS,
};

describe("resolvePreset (pure)", () => {
  it("recherche: verify on, RAG kept", () => {
    expect(resolvePreset({ ...baseOpts, preset: "recherche" })).toEqual({
      verifyFinalAnswer: true,
      scaffold: undefined,
      dropKnowledgeSearch: false,
    });
  });

  it("daten: scaffold + verify on, RAG dropped", () => {
    expect(resolvePreset({ ...baseOpts, preset: "daten" })).toEqual({
      verifyFinalAnswer: true,
      scaffold: true,
      dropKnowledgeSearch: true,
    });
  });

  it("no preset: everything off (unchanged behavior)", () => {
    expect(resolvePreset(baseOpts)).toEqual({
      verifyFinalAnswer: false,
      scaffold: undefined,
      dropKnowledgeSearch: false,
    });
  });

  it("explicit options override the preset bundle", () => {
    const resolved = resolvePreset({ ...baseOpts, preset: "daten", scaffold: false, verifyFinalAnswer: false });
    expect(resolved.scaffold).toBe(false);
    expect(resolved.verifyFinalAnswer).toBe(false);
    // dropKnowledgeSearch stays preset-driven (no per-tool override requested).
    expect(resolved.dropKnowledgeSearch).toBe(true);
  });
});

describe("parsePreset (env)", () => {
  it("accepts the two valid values and empty", () => {
    expect(parsePreset("recherche")).toBe("recherche");
    expect(parsePreset(" daten ")).toBe("daten");
    expect(parsePreset(undefined)).toBeUndefined();
    expect(parsePreset("")).toBeUndefined();
  });

  it("fails fast on an unknown value", () => {
    expect(() => parsePreset("extraktion")).toThrow(/AGENT_PRESET/);
    expect(() => parsePreset("rechreche")).toThrow(/AGENT_PRESET/);
  });
});

describe("preset behavior over HTTP", () => {
  it("recherche activates verify AND keeps the RAG tool", async () => {
    const llm = makeScriptedLlm({ toolName: "knowledge.search", finalText: "unverified", verifyText: "verified" });
    const server = createAgentServer({
      llm: llm.adapter,
      tools: [calculatorTool, knowledgeTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
      preset: "recherche",
    });
    const base = await listen(server);
    try {
      const res = await run(base, { sessionId: "r", message: "Wer ist zuständig?" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { finalAnswer: string; toolCallCount: number };
      // The RAG tool was reachable (called + executed).
      expect(data.toolCallCount).toBe(1);
      expect(anyPromptMentions(llm.calls, "knowledge.search")).toBe(true);
      // Verify ran (its prompt appeared) and its corrected answer was adopted.
      expect(anyPromptMentions(llm.calls, "re-check your answer")).toBe(true);
      expect(data.finalAnswer).toBe("verified");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("daten activates the scaffold and withholds the RAG tool", async () => {
    const llm = makeScriptedLlm({ finalText: "daten fertig" });
    const server = createAgentServer({
      llm: llm.adapter,
      tools: [calculatorTool, knowledgeTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
      preset: "daten",
    });
    const base = await listen(server);
    try {
      const res = await run(base, { sessionId: "d", message: "Wie viele verwaiste Einträge?" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { finalAnswer: string };
      expect(data.finalAnswer).toBe("daten fertig");
      // Scaffold on: the plan step fired.
      expect(anyPromptMentions(llm.calls, "nummerierten Plan")).toBe(true);
      // RAG tool withheld: it never appears in any prompt, and the VVT report
      // (model-independent) does not list it either.
      expect(anyPromptMentions(llm.calls, "knowledge.search")).toBe(false);
      const vvt = await fetch(`${base}/v1/compliance/vvt`, { headers: { Authorization: "Bearer sk-alice" } });
      const names = ((await vvt.json()) as { records: Array<{ name: string }> }).records.map((r) => r.name);
      expect(names).toContain(calculatorTool.name);
      expect(names).not.toContain("knowledge.search");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("an explicit scaffold:false overrides the daten preset", async () => {
    const llm = makeScriptedLlm({ finalText: "ohne scaffold" });
    const server = createAgentServer({
      llm: llm.adapter,
      tools: [calculatorTool, knowledgeTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
      preset: "daten",
      scaffold: false,
    });
    const base = await listen(server);
    try {
      const res = await run(base, { sessionId: "o", message: "frage" });
      expect(res.status).toBe(200);
      // No plan step — scaffold was explicitly disabled despite the preset.
      expect(anyPromptMentions(llm.calls, "nummerierten Plan")).toBe(false);
      // The RAG withholding is still in force (preset-driven, not overridden).
      expect(anyPromptMentions(llm.calls, "knowledge.search")).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("without a preset behavior is unchanged: no verify, no scaffold", async () => {
    const llm = makeScriptedLlm({ toolName: "knowledge.search", finalText: "plain" });
    const server = createAgentServer({
      llm: llm.adapter,
      tools: [calculatorTool, knowledgeTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
    });
    const base = await listen(server);
    try {
      const res = await run(base, { sessionId: "n", message: "rechne" });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { finalAnswer: string; toolCallCount: number };
      expect(data.finalAnswer).toBe("plain");
      expect(data.toolCallCount).toBe(1);
      expect(anyPromptMentions(llm.calls, "re-check your answer")).toBe(false);
      expect(anyPromptMentions(llm.calls, "nummerierten Plan")).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects scaffold + nativeToolCalling at construction", () => {
    expect(() =>
      createAgentServer({
        llm: makeScriptedLlm({ finalText: "x" }).adapter,
        tools: [calculatorTool],
        memory: new InMemoryMemory(),
        apiKeys: API_KEYS,
        preset: "daten",
        nativeToolCalling: true,
      }),
    ).toThrow(/text-protocol only/);
  });
});
