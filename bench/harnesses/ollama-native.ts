import type { ChatMessage, LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

/**
 * PRIMARY fair baseline (spec §5): what a developer writes out of the box
 * against Ollama's native tool calling. Straight loop, no retries, no
 * format recovery — any uplift over this is the harness's merit.
 */
export const ollamaNativeHarness: HarnessAdapter = {
  name: "ollama-native",
  async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
    const toolSpecs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
    }));
    const byName = new Map(tools.map((t) => [t.name, t]));

    const messages: ChatMessage[] = [
      {
        role: "system",
        // Completion instruction added for fairness: the text-protocol
        // contestants receive equivalent guidance via their protocol block
        // ("To give a final answer respond EXACTLY: ..."). Without it, some
        // models (observed: qwen3:4b) keep calling tools on pure side-effect
        // tasks and never emit a final content-only message.
        content:
          "You are a helpful assistant. Use the provided tools when needed. " +
          "When you are done, reply with your final answer.",
      },
      { role: "user", content: task.prompt },
    ];

    let toolCallCount = 0;
    try {
      for (let turn = 0; turn < task.maxTurns; turn++) {
        const res = await llm.generate(messages, { tools: toolSpecs });

        if (res.toolCalls && res.toolCalls.length > 0) {
          messages.push({ role: "assistant", content: res.content });
          for (const call of res.toolCalls) {
            const tool = byName.get(call.name);
            let payload: string;
            if (!tool) {
              payload = JSON.stringify({ tool: call.name, error: "unknown tool" });
            } else {
              try {
                const output = await tool.execute(call.arguments);
                toolCallCount++;
                payload = JSON.stringify({ tool: call.name, result: output });
              } catch (err) {
                payload = JSON.stringify({
                  tool: call.name,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
            messages.push({ role: "tool", content: payload });
          }
          continue;
        }

        // Plain content without tool calls = the final answer.
        return {
          finalAnswer: res.content,
          terminatedReason: "final_answer",
          turns: turn + 1,
          llmCalls: 0,
          tokens: 0,
          latencyMs: 0,
          toolCallCount,
        };
      }
      return {
        finalAnswer: null,
        terminatedReason: "max_turns",
        turns: task.maxTurns,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount,
      };
    } catch (err) {
      return {
        finalAnswer: null,
        terminatedReason: "error",
        turns: 0,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
