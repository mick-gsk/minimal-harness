import { describe, it, expect } from "@jest/globals";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { defaultPolicy } from "../src/guardrails/policy.js";
import type { ChatMessage } from "../src/types/llm.js";

function makeDeps(responses: string[]) {
  let i = 0;
  const llm = adapterFromFn(async () => ({ content: responses[i++] ?? "ACTION: final_answer\nANSWER: done" }));
  const memory = new InMemoryMemory();
  const toolBridge = new DefaultToolBridge();
  toolBridge.register(calculatorTool);
  return new DefaultAgentLoop({
    llm,
    memory,
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
  });
}

describe("DefaultAgentLoop", () => {
  it("resolves a direct final_answer", async () => {
    const loop = makeDeps(["ACTION: final_answer\nANSWER: Hello!"]);
    const result = await loop.run({ sessionId: "s1", userMessage: "hi" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("Hello!");
    expect(result.finalState).toBe("done");
  });

  it("ends in a failed state when output never validates", async () => {
    const loop = makeDeps(Array(5).fill("this is not the required format at all"));
    const result = await loop.run({ sessionId: "s4", userMessage: "hi", maxTurns: 3 });
    expect(result.terminatedReason).toBe("validation_failed");
    expect(result.finalState).toBe("failed");
  });

  it("executes a tool and then returns final_answer", async () => {
    const loop = makeDeps([
      `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"3*3"}`,
      "ACTION: final_answer\nANSWER: 9",
    ]);
    const result = await loop.run({ sessionId: "s2", userMessage: "What is 3*3?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolTrace).toHaveLength(1);
  });

  it("terminates with max_turns when loop runs out", async () => {
    const loop = makeDeps(Array(5).fill(`ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"1+1"}`));
    const result = await loop.run({ sessionId: "s3", userMessage: "loop", maxTurns: 3 });
    expect(result.terminatedReason).toBe("max_turns");
  });

  it("feeds tool validation errors back to the model instead of crashing (native path)", async () => {
    // Regression: bench run 2026-07-09 — llama3.1 hallucinated an argument for a
    // no-parameter tool; ToolValidationError killed the whole session while the
    // primitive baselines recovered. The loop must return the error as a tool
    // message so the model gets a chance to correct itself.
    let call = 0;
    const llm = adapterFromFn(async (messages: ChatMessage[]) => {
      call++;
      if (call === 1) {
        // invalid: calculator.evaluate requires "expression", model hallucinates "expr"
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expr: "6*7" } }] };
      }
      if (call === 2) {
        // the error must have been fed back as a tool message
        const lastTool = [...messages].reverse().find((m) => m.role === "tool");
        expect(lastTool?.content ?? "").toMatch(/validation|failed|error/i);
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "6*7" } }] };
      }
      return { content: "ACTION: final_answer\nANSWER: 42" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
    });

    const result = await loop.run({ sessionId: "val-err", userMessage: "6*7?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("42");
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.error).toMatch(/validation/i);
    expect(result.toolTrace[1]!.output).toEqual({ expression: "6*7", result: 42 });
  });

  it("feeds unknown-tool errors back to the model instead of crashing (text path)", async () => {
    const loop = makeDeps([
      `ACTION: tool_call\nTOOL: does.not.exist\nARGS: {}`,
      `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"2+2"}`,
      "ACTION: final_answer\nANSWER: 4",
    ]);
    const result = await loop.run({ sessionId: "unknown-tool", userMessage: "2+2?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("4");
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.error).toMatch(/not.*(found|registered)|unknown/i);
  });

  it("uses native tool_calls from the adapter instead of text parsing", async () => {
    let call = 0;
    const llm = adapterFromFn(async () => {
      call++;
      if (call === 1) {
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "6*7" } }] };
      }
      return { content: "ACTION: final_answer\nANSWER: 42" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
    });

    const result = await loop.run({ sessionId: "nat", userMessage: "6*7?" });
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]!.output).toEqual({ expression: "6*7", result: 42 });
  });

  it("executes multiple native tool calls in one turn when policy allows", async () => {
    let call = 0;
    const llm = adapterFromFn(async () => {
      call++;
      if (call === 1) {
        return {
          content: "",
          toolCalls: [
            { name: "calculator.evaluate", arguments: { expression: "1+1" } },
            { name: "calculator.evaluate", arguments: { expression: "2+2" } },
          ],
        };
      }
      return { content: "ACTION: final_answer\nANSWER: done" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      policy: { ...defaultPolicy, maxToolCallsPerTurn: 2 },
    });

    const result = await loop.run({ sessionId: "multi", userMessage: "1+1 and 2+2?" });
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.output).toEqual({ expression: "1+1", result: 2 });
    expect(result.toolTrace[1]!.output).toEqual({ expression: "2+2", result: 4 });
  });

  it("caps native tool calls to the per-turn policy limit and records the drop", async () => {
    let call = 0;
    const llm = adapterFromFn(async () => {
      call++;
      if (call === 1) {
        return {
          content: "",
          toolCalls: [
            { name: "calculator.evaluate", arguments: { expression: "1+1" } },
            { name: "calculator.evaluate", arguments: { expression: "2+2" } },
          ],
        };
      }
      return { content: "ACTION: final_answer\nANSWER: done" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      policy: { ...defaultPolicy, maxToolCallsPerTurn: 1 },
    });

    const result = await loop.run({ sessionId: "cap", userMessage: "1+1 and 2+2?" });
    // one executed, one dropped-with-error — never silently discarded
    expect(result.toolTrace).toHaveLength(2);
    expect(result.toolTrace[0]!.output).toEqual({ expression: "1+1", result: 2 });
    expect(result.toolTrace[1]!.error).toMatch(/not executed/i);
  });

  it("reports dropped tool calls back to the model so it can re-issue them", async () => {
    // Regression: bench probe 2026-07-09 (v2-m6/w6/w9/m9) — excess native tool
    // calls were silently discarded; the model believed both writes executed
    // and reported phantom success.
    let call = 0;
    const llm = adapterFromFn(async (messages: ChatMessage[]) => {
      call++;
      if (call === 1) {
        return {
          content: "",
          toolCalls: [
            { name: "calculator.evaluate", arguments: { expression: "1+1" } },
            { name: "calculator.evaluate", arguments: { expression: "2+2" } },
          ],
        };
      }
      if (call === 2) {
        const toolMsgs = messages.filter((m) => m.role === "tool");
        expect(toolMsgs.some((m) => /not executed/i.test(m.content))).toBe(true);
        return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "2+2" } }] };
      }
      return { content: "ACTION: final_answer\nANSWER: 2 and 4" };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      policy: { ...defaultPolicy, maxToolCallsPerTurn: 1 },
    });

    const result = await loop.run({ sessionId: "cap-report", userMessage: "1+1 and 2+2?" });
    expect(result.terminatedReason).toBe("final_answer");
    // executed 1+1, dropped 2+2, re-issued 2+2
    expect(result.toolTrace).toHaveLength(3);
    expect(result.toolTrace[1]!.error).toMatch(/not executed/i);
    expect(result.toolTrace[2]!.output).toEqual({ expression: "2+2", result: 4 });
  });

  describe("nativeToolCalling mode", () => {
    // Rationale: bench probe 2026-07-09 — models with native function calling
    // pay +40-100% tokens for a text protocol block they never use. In native
    // mode the tool specs travel via the API and plain content is the answer.
    function makeNativeLoop(llm: ReturnType<typeof adapterFromFn>) {
      const toolBridge = new DefaultToolBridge();
      toolBridge.register(calculatorTool);
      return new DefaultAgentLoop({
        llm,
        memory: new InMemoryMemory(),
        toolBridge,
        validator: new StructuredOutputValidator(),
        promptBuilder: new DefaultPromptBuilder(),
        nativeToolCalling: true,
      });
    }

    it("omits the text protocol block from the prompt", async () => {
      const seen: ChatMessage[][] = [];
      const llm = adapterFromFn(async (messages: ChatMessage[]) => {
        seen.push(messages);
        return { content: "hi there" };
      });
      await makeNativeLoop(llm).run({ sessionId: "n1", userMessage: "hi" });
      const system = seen[0]!.find((m) => m.role === "system")!;
      expect(system.content).not.toContain("ACTION:");
      expect(system.content).not.toContain("Available Tools");
    });

    it("treats plain content without tool calls as the final answer", async () => {
      let call = 0;
      const llm = adapterFromFn(async () => {
        call++;
        if (call === 1) {
          return { content: "", toolCalls: [{ name: "calculator.evaluate", arguments: { expression: "6*7" } }] };
        }
        return { content: "The answer is 42." };
      });
      const result = await makeNativeLoop(llm).run({ sessionId: "n2", userMessage: "6*7?" });
      expect(result.terminatedReason).toBe("final_answer");
      expect(result.finalAnswer).toBe("The answer is 42.");
      expect(result.toolTrace).toHaveLength(1);
    });
  });

  describe("verifyFinalAnswer", () => {
    // Rationale: bench probe 2026-07-09 — llama3.1 reads correct values via
    // tools, then does the arithmetic mentally and answers "32" instead of 53.
    // One extra check-against-tool-results call catches that class of error.
    it("issues one verification call after tool use and adopts the correction", async () => {
      let call = 0;
      const llm = adapterFromFn(async (messages: ChatMessage[]) => {
        call++;
        if (call === 1) {
          return { content: `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"21+32"}` };
        }
        if (call === 2) {
          return { content: "ACTION: final_answer\nANSWER: 32" }; // mental-math slip
        }
        // verification call: must reference checking against tool results
        expect(messages[messages.length - 1]!.content).toMatch(/re-check|verify|tool results/i);
        return { content: "ACTION: final_answer\nANSWER: 53" };
      });
      const toolBridge = new DefaultToolBridge();
      toolBridge.register(calculatorTool);
      const loop = new DefaultAgentLoop({
        llm,
        memory: new InMemoryMemory(),
        toolBridge,
        validator: new StructuredOutputValidator(),
        promptBuilder: new DefaultPromptBuilder(),
        verifyFinalAnswer: true,
      });

      const result = await loop.run({ sessionId: "v1", userMessage: "21+32?" });
      expect(call).toBe(3);
      expect(result.terminatedReason).toBe("final_answer");
      expect(result.finalAnswer).toBe("53");
    });

    it("skips verification when no tools were used", async () => {
      let call = 0;
      const llm = adapterFromFn(async () => {
        call++;
        return { content: "ACTION: final_answer\nANSWER: Hello!" };
      });
      const loop = new DefaultAgentLoop({
        llm,
        memory: new InMemoryMemory(),
        toolBridge: new DefaultToolBridge(),
        validator: new StructuredOutputValidator(),
        promptBuilder: new DefaultPromptBuilder(),
        verifyFinalAnswer: true,
      });

      const result = await loop.run({ sessionId: "v2", userMessage: "hi" });
      expect(call).toBe(1);
      expect(result.finalAnswer).toBe("Hello!");
    });
  });

  it("caps recent context and folds older turns into a summary", async () => {
    const seen: ChatMessage[][] = [];
    const llm = adapterFromFn(async (messages) => {
      seen.push(messages);
      return { content: "ACTION: final_answer\nANSWER: ok" };
    });
    const memory = new InMemoryMemory();
    for (let i = 0; i < 30; i++) {
      await memory.append("ctx", { role: i % 2 ? "assistant" : "user", content: `msg ${i}`, timestamp: 0 });
    }
    const loop = new DefaultAgentLoop({
      llm,
      memory,
      toolBridge: new DefaultToolBridge(),
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      maxContextMessages: 10,
    });

    await loop.run({ sessionId: "ctx", userMessage: "hi" });

    const prompt = seen[0]!;
    const nonSystem = prompt.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeLessThanOrEqual(10);
    expect(prompt.some((m) => m.role === "system" && m.content.includes("Context Summary"))).toBe(true);
  });

  describe("scaffold mode (opt-in persistence)", () => {
    // Rationale: arXiv 2605.12129 — a closed plan->execute->verify->recover loop
    // lifts small-model task success (0.429 -> 0.952). Effect is non-monotone:
    // the four stages only ship together, gated on input.scaffold. Text-protocol
    // only; combining with nativeToolCalling must throw.
    function makeScaffoldLoop(
      llm: ReturnType<typeof adapterFromFn>,
      extra: Record<string, unknown> = {},
    ) {
      const toolBridge = new DefaultToolBridge();
      toolBridge.register(calculatorTool);
      return new DefaultAgentLoop({
        llm,
        memory: new InMemoryMemory(),
        toolBridge,
        validator: new StructuredOutputValidator(),
        promptBuilder: new DefaultPromptBuilder(),
        ...extra,
      });
    }
    const lastUser = (messages: ChatMessage[]) => [...messages].reverse().find((m) => m.role === "user")!.content;

    it("does not accept free text as the answer — re-prompts via the final_answer gate", async () => {
      let call = 0;
      const llm = adapterFromFn(async (messages: ChatMessage[]) => {
        call++;
        if (/nummerierten Plan/.test(lastUser(messages))) return { content: "1. Direkt antworten." };
        if (call === 2) return { content: "Ich glaube die Antwort ist 42." }; // free text, no ACTION
        // the gate reminder must now be in context
        expect(messages.some((m) => m.role === "user" && /Wenn du fertig bist, nutze ACTION: final_answer/.test(m.content))).toBe(true);
        return { content: "ACTION: final_answer\nANSWER: 42" };
      });
      const result = await makeScaffoldLoop(llm).run({ sessionId: "sc-a", userMessage: "6*7?", scaffold: true });
      expect(call).toBe(3);
      expect(result.terminatedReason).toBe("final_answer");
      expect(result.finalAnswer).toBe("42"); // not the free text
    });

    it("forces an explicit plan before the first tool call", async () => {
      let call = 0;
      const llm = adapterFromFn(async (messages: ChatMessage[]) => {
        call++;
        if (call === 1) {
          // the very first LLM call is the plan step
          expect(lastUser(messages)).toMatch(/nummerierten Plan/);
          return { content: "1. calculator nutzen.\n2. Antworten." };
        }
        if (call === 2) {
          // the plan is now in context before any tool executes
          expect(messages.some((m) => m.role === "assistant" && m.content.startsWith("PLAN:"))).toBe(true);
          return { content: `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"6*7"}` };
        }
        return { content: "ACTION: final_answer\nANSWER: 42" };
      });
      const result = await makeScaffoldLoop(llm).run({ sessionId: "sc-b", userMessage: "6*7?", scaffold: true });
      expect(result.terminatedReason).toBe("final_answer");
      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0]!.output).toEqual({ expression: "6*7", result: 42 });
    });

    it("injects a recovery reflection after a failed/empty tool result", async () => {
      let call = 0;
      const llm = adapterFromFn(async (messages: ChatMessage[]) => {
        call++;
        if (/nummerierten Plan/.test(lastUser(messages))) return { content: "1. Quelle suchen." };
        if (call === 2) return { content: `ACTION: tool_call\nTOOL: does.not.exist\nARGS: {}` };
        // next action turn: the recovery prompt must have been injected
        expect(messages.some((m) => m.role === "user" && /hat nicht funktioniert/.test(m.content))).toBe(true);
        return { content: "ACTION: final_answer\nANSWER: nicht gefunden" };
      });
      const result = await makeScaffoldLoop(llm).run({ sessionId: "sc-c", userMessage: "?", scaffold: true });
      expect(result.terminatedReason).toBe("final_answer");
      expect(result.toolTrace[0]!.error).toBeDefined();
    });

    it("forces a final_answer call when MAX_TURNS is reached", async () => {
      let call = 0;
      const llm = adapterFromFn(async (messages: ChatMessage[]) => {
        call++;
        if (/nummerierten Plan/.test(lastUser(messages))) return { content: "1. rechnen." };
        if (/Turn-Limit/.test(lastUser(messages))) {
          return { content: "ACTION: final_answer\nANSWER: Zwangsantwort" };
        }
        return { content: `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"1+1"}` };
      });
      const result = await makeScaffoldLoop(llm).run({ sessionId: "sc-d", userMessage: "loop", maxTurns: 1, scaffold: true });
      expect(call).toBe(3); // plan, one tool turn, forced final
      expect(result.terminatedReason).toBe("final_answer");
      expect(result.finalAnswer).toBe("Zwangsantwort");
    });

    it("throws when combined with nativeToolCalling (non-monotone half scaffold)", async () => {
      const llm = adapterFromFn(async () => ({ content: "hi" }));
      const loop = makeScaffoldLoop(llm, { nativeToolCalling: true });
      await expect(loop.run({ sessionId: "sc-e", userMessage: "hi", scaffold: true })).rejects.toThrow(/scaffold/i);
    });

    it("makes zero extra calls without the flag (regression: default off)", async () => {
      let call = 0;
      const llm = adapterFromFn(async () => {
        call++;
        return { content: "ACTION: final_answer\nANSWER: hi" };
      });
      const result = await makeScaffoldLoop(llm).run({ sessionId: "sc-off", userMessage: "hi" });
      expect(call).toBe(1); // no plan preamble, no gate — identical to before
      expect(result.finalAnswer).toBe("hi");
    });
  });

  describe("contextCompaction (opt-in, arXiv 2510.00615)", () => {
    // Rationale: on long research runs (16k ctx, 6k-char tool results, 12 turns)
    // early observations either fall out of the window (silent eviction) or clog
    // it. Compacting old observations cuts peak tokens and clarifies dependencies
    // so a small model stops repeating a failed call. FULLY budget-gated: an
    // always-on stage 1 measured HARMFUL (21% vs 44-48%) by evicting evidence
    // that fit. Under budget → history untouched; over budget → deterministic
    // truncation oldest-first, just enough, then LLM Merkzettel if still over.
    const longResult = (tag: string) =>
      JSON.stringify({ tool: "fs.read", result: [...Array(20)].map((_, i) => `line ${i}`).join("\n") + `\nTAIL_${tag}` });

    // Seeds a session with `turns` assistant(tool_call)+tool pairs, each tool
    // result carrying a unique tail tag so truncation can be observed.
    async function seedToolHistory(memory: InMemoryMemory, session: string, tags: string[]) {
      for (const tag of tags) {
        await memory.append(session, { role: "assistant", content: `ACTION: tool_call\nTOOL: fs.read\nARGS: {"path":"${tag}.txt"}`, timestamp: 0 });
        await memory.append(session, { role: "tool", content: longResult(tag), timestamp: 0 });
      }
    }

    function makeLoop(memory: InMemoryMemory, llm: ReturnType<typeof adapterFromFn>) {
      return new DefaultAgentLoop({
        llm,
        memory,
        toolBridge: new DefaultToolBridge(),
        validator: new StructuredOutputValidator(),
        promptBuilder: new DefaultPromptBuilder(),
      });
    }

    it("WITH the flag but under budget leaves tool results byte-identical (core regression)", async () => {
      // The always-on stage 1 was measured HARMFUL (10/48 = 21% vs 44-48% with
      // verify alone): it evicted evidence that would have fit. Under budget the
      // history MUST pass through untouched — identical to no flag, no summary call.
      const seen: ChatMessage[][] = [];
      let calls = 0;
      const llm = adapterFromFn(async (messages) => {
        calls++;
        seen.push(messages);
        return { content: "ACTION: final_answer\nANSWER: ok" };
      });
      const memory = new InMemoryMemory();
      await seedToolHistory(memory, "cmp-fit", ["A", "B", "C", "D"]);
      // Default numCtx 16384 → budget ~45k chars; the seeded prompt is ~1k chars.
      await makeLoop(memory, llm).run({ sessionId: "cmp-fit", userMessage: "go", contextCompaction: { keepRecentTurns: 2 } });

      const tools = seen[0]!.filter((m) => m.role === "tool");
      expect(calls).toBe(1); // no extra summary call
      expect(tools).toHaveLength(4);
      expect(tools.every((m) => !m.content.includes("[gekürzt:"))).toBe(true); // nothing truncated
      expect(tools[0]!.content).toBe(longResult("A")); // byte-identical
      expect(tools[3]!.content).toBe(longResult("D"));
    });

    it("over budget truncates the OLDEST first, only as many as needed (incremental)", async () => {
      // Seeded prompt ~1070 chars; each truncation frees ~108. numCtx 363 →
      // budget 1016: truncating just the oldest (A) drops to ~962 ≤ 1016, so the
      // loop stops — B, C, D stay full even though keepRecentTurns=1 would allow
      // truncating B and C. Proves oldest-first AND minimal.
      const seen: ChatMessage[][] = [];
      const llm = adapterFromFn(async (messages) => {
        seen.push(messages);
        return { content: "ACTION: final_answer\nANSWER: ok" };
      });
      const memory = new InMemoryMemory();
      await seedToolHistory(memory, "cmp-inc", ["A", "B", "C", "D"]);
      await makeLoop(memory, llm).run({ sessionId: "cmp-inc", userMessage: "go", contextCompaction: { keepRecentTurns: 1, numCtx: 363 } });

      const tools = seen[0]!.filter((m) => m.role === "tool");
      expect(tools).toHaveLength(4);
      // Only the oldest (A) truncated.
      expect(tools[0]!.content).toMatch(/\[gekürzt: war \d+ Zeichen, Tool fs\.read, Args \{"path":"A\.txt"\}\]/);
      expect(tools[0]!.content).not.toContain("TAIL_A");
      // B, C, D untouched — truncating A already met the budget.
      expect(tools[1]!.content).toContain("TAIL_B");
      expect(tools[1]!.content).not.toContain("[gekürzt:");
      expect(tools[2]!.content).toContain("TAIL_C");
      expect(tools[3]!.content).toContain("TAIL_D");
    });

    it("over budget protects the recent keepRecentTurns floor, truncates the rest", async () => {
      // numCtx 320 → budget 896: truncating A (→962) is not enough, B (→854)
      // clears it. keepRecentTurns=2 keeps C, D verbatim regardless.
      const seen: ChatMessage[][] = [];
      const llm = adapterFromFn(async (messages) => {
        seen.push(messages);
        return { content: "ACTION: final_answer\nANSWER: ok" };
      });
      const memory = new InMemoryMemory();
      await seedToolHistory(memory, "cmp", ["A", "B", "C", "D"]);
      await makeLoop(memory, llm).run({ sessionId: "cmp", userMessage: "go", contextCompaction: { keepRecentTurns: 2, numCtx: 320 } });

      const tools = seen[0]!.filter((m) => m.role === "tool");
      expect(tools).toHaveLength(4);
      // Old turns A,B: truncated — marker present, original tail gone.
      expect(tools[0]!.content).toMatch(/\[gekürzt: war \d+ Zeichen, Tool fs\.read, Args \{"path":"A\.txt"\}\]/);
      expect(tools[0]!.content).not.toContain("TAIL_A"); // dropped body (only first lines kept)
      expect(tools[1]!.content).toContain("[gekürzt:");
      // Recent turns C,D: full — tail tag preserved, no marker (the protected floor).
      expect(tools[2]!.content).toContain("TAIL_C");
      expect(tools[2]!.content).not.toContain("[gekürzt:");
      expect(tools[3]!.content).toContain("TAIL_D");
    });

    it("without the flag leaves tool results byte-identical (regression: default off)", async () => {
      const seen: ChatMessage[][] = [];
      let calls = 0;
      const llm = adapterFromFn(async (messages) => {
        calls++;
        seen.push(messages);
        return { content: "ACTION: final_answer\nANSWER: ok" };
      });
      const memory = new InMemoryMemory();
      await seedToolHistory(memory, "cmp-off", ["A", "B", "C", "D"]);
      await makeLoop(memory, llm).run({ sessionId: "cmp-off", userMessage: "go" });

      const tools = seen[0]!.filter((m) => m.role === "tool");
      expect(calls).toBe(1); // no extra summary call
      expect(tools.every((m) => !m.content.includes("[gekürzt:"))).toBe(true);
      expect(tools[0]!.content).toBe(longResult("A")); // untouched
    });

    it("fires the LLM Merkzettel stage only over the numCtx-derived threshold", async () => {
      let summaryCalls = 0;
      const isSummary = (messages: ChatMessage[]) => /Merkzettel/.test(messages[messages.length - 1]!.content);
      const llm = adapterFromFn(async (messages) => {
        if (isSummary(messages)) {
          summaryCalls++;
          return { content: "Bisher geprüft: X\nErgebnisse: Y\nOffen: Z" };
        }
        return { content: "ACTION: final_answer\nANSWER: ok" };
      });

      // Large window: stage 1 keeps the prompt under budget → no summary call.
      const m1 = new InMemoryMemory();
      await seedToolHistory(m1, "cmp-hi", ["A", "B", "C", "D"]);
      await makeLoop(m1, llm).run({ sessionId: "cmp-hi", userMessage: "go", contextCompaction: { numCtx: 16384 } });
      expect(summaryCalls).toBe(0);

      // Tiny window: prompt exceeds the budget even after stage 1 → one summary call.
      const m2 = new InMemoryMemory();
      await seedToolHistory(m2, "cmp-lo", ["A", "B", "C", "D"]);
      await makeLoop(m2, llm).run({ sessionId: "cmp-lo", userMessage: "go", contextCompaction: { numCtx: 50 } });
      expect(summaryCalls).toBe(1);
    });

    it("keeps stage 1 and does not crash when the Merkzettel call fails", async () => {
      const seen: ChatMessage[][] = [];
      const llm = adapterFromFn(async (messages) => {
        if (/Merkzettel/.test(messages[messages.length - 1]!.content)) throw new Error("summarizer down");
        seen.push(messages);
        return { content: "ACTION: final_answer\nANSWER: ok" };
      });
      const memory = new InMemoryMemory();
      await seedToolHistory(memory, "cmp-err", ["A", "B", "C", "D"]);
      const result = await makeLoop(memory, llm).run({
        sessionId: "cmp-err",
        userMessage: "go",
        contextCompaction: { keepRecentTurns: 2, numCtx: 50 },
      });

      expect(result.terminatedReason).toBe("final_answer"); // graceful — no crash
      // The main turn still ran on the stage-1-truncated prompt.
      const tools = seen[0]!.filter((m) => m.role === "tool");
      expect(tools.some((m) => m.content.includes("[gekürzt:"))).toBe(true);
    });
  });

  it("streams main-turn tokens to the caller via input.onToken", async () => {
    const responses = [
      `ACTION: tool_call\nTOOL: calculator.evaluate\nARGS: {"expression":"3*3"}`,
      "ACTION: final_answer\nANSWER: 9",
    ];
    let i = 0;
    // Emits the response in two chunks when the caller asked for streaming —
    // mirrors how OllamaClient/OpenAiCompatAdapter behave with onToken set.
    const llm = adapterFromFn(async (_messages, options) => {
      const content = responses[i++] ?? "ACTION: final_answer\nANSWER: done";
      if (options?.onToken) {
        const mid = Math.ceil(content.length / 2);
        options.onToken(content.slice(0, mid));
        options.onToken(content.slice(mid));
      }
      return { content };
    });
    const toolBridge = new DefaultToolBridge();
    toolBridge.register(calculatorTool);
    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
    });

    const chunks: string[] = [];
    const result = await loop.run({
      sessionId: "s-stream",
      userMessage: "What is 3*3?",
      onToken: (c) => chunks.push(c),
    });

    expect(result.terminatedReason).toBe("final_answer");
    expect(chunks.join("")).toBe(responses.join(""));
  });
});
