import type { ChatMessage, LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

/**
 * SECONDARY baseline (spec §5, illustrative only): same text protocol as
 * minimal-harness but raw regex parsing, no retry, no recovery — "what
 * anyone writes in 50 lines". Isolates what retry/recovery contribute.
 */
export const naiveHarness: HarnessAdapter = {
  name: "naive",
  async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
    const system =
      `You are a helpful assistant with access to tools.\n\n## Available Tools\n${toolList}\n\n` +
      `## Output Format\nTo call a tool respond EXACTLY:\nACTION: tool_call\nTOOL: <tool_name>\nARGS: <json>\n\n` +
      `To give a final answer respond EXACTLY:\nACTION: final_answer\nANSWER: <your answer>`;

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: task.prompt },
    ];

    let toolCallCount = 0;
    try {
      for (let turn = 0; turn < task.maxTurns; turn++) {
        const res = await llm.generate(messages);
        const text = res.content;

        const finalMatch = /ACTION:\s*final_answer[\s\S]*?ANSWER:\s*([\s\S]*)/.exec(text);
        if (finalMatch) {
          const answer = finalMatch[1] ?? "";
          return {
            finalAnswer: answer.trim(),
            terminatedReason: "final_answer",
            turns: turn + 1,
            llmCalls: 0,
            tokens: 0,
            latencyMs: 0,
            toolCallCount,
          };
        }

        const toolMatch = /ACTION:\s*tool_call[\s\S]*?TOOL:\s*(\S+)[\s\S]*?ARGS:\s*(\{[\s\S]*\})/.exec(text);
        if (!toolMatch) {
          // Malformed output: a naive loop has no recovery — the run fails.
          return {
            finalAnswer: null,
            terminatedReason: "parse_error",
            turns: turn + 1,
            llmCalls: 0,
            tokens: 0,
            latencyMs: 0,
            toolCallCount,
          };
        }

        const toolName = toolMatch[1] ?? "";
        const argsRaw = toolMatch[2] ?? "";
        let args: unknown;
        try {
          args = JSON.parse(argsRaw);
        } catch {
          return {
            finalAnswer: null,
            terminatedReason: "parse_error",
            turns: turn + 1,
            llmCalls: 0,
            tokens: 0,
            latencyMs: 0,
            toolCallCount,
          };
        }

        const tool = byName.get(toolName);
        let payload: string;
        if (!tool) {
          payload = JSON.stringify({ tool: toolName, error: "unknown tool" });
        } else {
          try {
            const output = await tool.execute(args);
            toolCallCount++;
            payload = JSON.stringify({ tool: toolName, result: output });
          } catch (err) {
            payload = JSON.stringify({
              tool: toolName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "tool", content: payload });
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
