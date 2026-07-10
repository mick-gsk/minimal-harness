import { describe, it, expect } from "@jest/globals";
import type { Server } from "node:http";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { createAgentServer } from "../src/server/agent-server.js";
import type { ToolDefinition } from "../src/types/tool.js";

function makeSpyTool(executions: string[]): ToolDefinition {
  return {
    name: "erp.book",
    description: "books an invoice into the ERP",
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
    async execute(input) {
      executions.push(JSON.stringify(input));
      return { booked: true };
    },
  };
}

function makeLoop(
  executions: string[],
  onToolApproval: (call: { name: string; arguments: unknown }) => Promise<boolean>,
) {
  const responses = [
    'ACTION: tool_call\nTOOL: erp.book\nARGS: {"invoice":"R-1"}',
    "ACTION: final_answer\nANSWER: done",
  ];
  let i = 0;
  const llm = adapterFromFn(async () => ({ content: responses[i++] ?? "ACTION: final_answer\nANSWER: done" }));
  const toolBridge = new DefaultToolBridge();
  toolBridge.register(makeSpyTool(executions));
  return new DefaultAgentLoop({
    llm,
    memory: new InMemoryMemory(),
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
    onToolApproval,
  });
}

describe("approval gate (loop)", () => {
  it("executes the tool when the hook approves", async () => {
    const executions: string[] = [];
    const loop = makeLoop(executions, async () => true);
    const result = await loop.run({ sessionId: "a", userMessage: "book it" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(executions).toHaveLength(1);
    expect(result.toolTrace[0]!.output).toEqual({ booked: true });
  });

  it("denies execution and feeds the denial back to the model", async () => {
    const executions: string[] = [];
    const loop = makeLoop(executions, async () => false);
    const result = await loop.run({ sessionId: "d", userMessage: "book it" });
    expect(result.terminatedReason).toBe("final_answer"); // model still answers
    expect(executions).toHaveLength(0); // tool never ran
    expect(result.toolTrace[0]!.error).toContain("denied by approval policy");
  });

  it("asks before the batch starts in parallel mode", async () => {
    const order: string[] = [];
    const executions: string[] = [];
    let turn = 0;
    const llm = adapterFromFn(async () =>
      turn++ === 0
        ? { content: "", toolCalls: [{ name: "erp.book", arguments: { i: 1 } }, { name: "erp.book", arguments: { i: 2 } }] }
        : { content: "done" },
    );
    const toolBridge = new DefaultToolBridge();
    const tool = makeSpyTool(executions);
    toolBridge.register({
      ...tool,
      async execute(input) {
        order.push("execute");
        return tool.execute(input);
      },
    });
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      nativeToolCalling: true,
      parallelToolCalls: true,
      policy: { allowedTools: [], maxToolCallsPerTurn: 4, requireStructuredOutput: true },
      onToolApproval: async () => {
        order.push("approve");
        return true;
      },
    });
    await loop.run({ sessionId: "p", userMessage: "book both" });
    expect(order.filter((o) => o === "approve")).toHaveLength(2);
    expect(order.indexOf("execute")).toBeGreaterThan(order.lastIndexOf("approve")); // all approvals first
  });
});

describe("approval gate (server, SSE)", () => {
  async function startServer(executions: string[], approvalTimeoutMs?: number) {
    const responses = [
      'ACTION: tool_call\nTOOL: erp.book\nARGS: {"invoice":"R-9"}',
      "ACTION: final_answer\nANSWER: booked",
    ];
    let i = 0;
    const server = createAgentServer({
      llm: adapterFromFn(async () => ({ content: responses[i++] ?? "ACTION: final_answer\nANSWER: booked" })),
      tools: [makeSpyTool(executions)],
      memory: new InMemoryMemory(),
      apiKeys: { "sk-alice": "alice", "sk-bob": "bob" },
      requireApproval: ["erp.book"],
      ...(approvalTimeoutMs !== undefined ? { approvalTimeoutMs } : {}),
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, base: `http://127.0.0.1:${port}` };
  }

  function stop(server: Server): Promise<void> {
    return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }

  /** Reads the SSE stream, answering the first approval_request via callback. */
  async function streamRun(
    base: string,
    key: string,
    onApproval: (approvalId: string) => Promise<void>,
  ): Promise<string> {
    const res = await fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ sessionId: "s", message: "book invoice R-9", stream: true }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const match = text.match(/event: approval_request\ndata: (.*)\n/);
      if (match && !text.includes("event: result")) {
        const { approvalId } = JSON.parse(match[1]!) as { approvalId: string };
        await onApproval(approvalId);
      }
    }
    return text;
  }

  it("approve → tool executes and the run completes", async () => {
    const executions: string[] = [];
    const { server, base } = await startServer(executions);
    const text = await streamRun(base, "sk-alice", async (approvalId) => {
      const res = await fetch(`${base}/v1/agent/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
        body: JSON.stringify({ approve: true }),
      });
      expect(res.status).toBe(200);
    });
    expect(executions).toHaveLength(1);
    expect(text).toContain("event: result");
    await stop(server);
  });

  it("deny → tool never runs, run still completes", async () => {
    const executions: string[] = [];
    const { server, base } = await startServer(executions);
    const text = await streamRun(base, "sk-alice", async (approvalId) => {
      await fetch(`${base}/v1/agent/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
        body: JSON.stringify({ approve: false }),
      });
    });
    expect(executions).toHaveLength(0);
    expect(text).toContain("event: result");
    await stop(server);
  });

  it("a different user cannot answer the approval (404), timeout denies fail-closed", async () => {
    const executions: string[] = [];
    const { server, base } = await startServer(executions, 300);
    const text = await streamRun(base, "sk-alice", async (approvalId) => {
      const res = await fetch(`${base}/v1/agent/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-bob" },
        body: JSON.stringify({ approve: true }),
      });
      expect(res.status).toBe(404); // bob cannot see alice's approval
      // no valid answer arrives -> timeout must deny
    });
    expect(executions).toHaveLength(0);
    expect(text).toContain("event: result");
    await stop(server);
  });

  it("non-streaming requests deny gated tools fail-closed", async () => {
    const executions: string[] = [];
    const { server, base } = await startServer(executions);
    const res = await fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-alice" },
      body: JSON.stringify({ sessionId: "ns", message: "book invoice R-9" }),
    });
    expect(res.status).toBe(200);
    expect(executions).toHaveLength(0);
    await stop(server);
  });
});
