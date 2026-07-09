import type { AgentLoop, AgentLoopInput, AgentLoopResult, AgentTurn } from "../types/agent.js";
import type { Memory } from "../types/memory.js";
import type { ToolBridge, ToolExecutionRecord } from "../types/tool.js";
import type { LLMAdapter } from "../types/llm.js";
import type { OutputValidator } from "../types/guardrails.js";
import type { PromptBuilder } from "./prompt-builder.js";
import { parseAssistantOutput } from "./output-parser.js";
import { AgentStateMachine } from "./state-machine.js";
import { isToolAllowed, defaultPolicy } from "../guardrails/policy.js";
import { defaultRetryStrategy } from "../guardrails/retries.js";
import type { GuardrailPolicy } from "../types/guardrails.js";
import { AgentError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { extractiveSummary } from "../memory/summarizer.js";

export interface AgentLoopDeps {
  llm: LLMAdapter;
  memory: Memory;
  toolBridge: ToolBridge;
  validator: OutputValidator;
  promptBuilder: PromptBuilder;
  policy?: GuardrailPolicy;
  systemInstruction?: string;
  /**
   * Max number of recent messages kept verbatim in the prompt. Older messages
   * are folded into a single summary block so the prompt does not grow without
   * bound. Defaults to 20.
   */
  maxContextMessages?: number;
}

export class DefaultAgentLoop implements AgentLoop {
  private readonly policy: GuardrailPolicy;
  private readonly maxContextMessages: number;

  constructor(private readonly deps: AgentLoopDeps) {
    this.policy = deps.policy ?? defaultPolicy;
    this.maxContextMessages = deps.maxContextMessages ?? 20;
  }

  /**
   * Executes a tool call and converts bridge-level failures (unknown tool,
   * schema validation) into an error record instead of letting them escape.
   * The error record flows back to the model as a tool message, giving it a
   * chance to correct itself — a single hallucinated argument must not kill
   * the whole session. Policy violations still throw (guardrail semantics).
   */
  private async executeToolSafely(
    toolName: string,
    args: unknown,
  ): Promise<ToolExecutionRecord> {
    try {
      return await this.deps.toolBridge.execute({ toolName, arguments: args });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn(`Tool call '${toolName}' rejected: ${error}`);
      return { toolName, arguments: args, error, executedAt: Date.now() };
    }
  }

  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const { sessionId, userMessage, maxTurns = 10 } = input;
    const { llm, memory, toolBridge, validator, promptBuilder } = this.deps;
    const systemInstruction = this.deps.systemInstruction ?? "You are a helpful assistant.";

    const toolTrace: ToolExecutionRecord[] = [];
    const rawTurns: AgentTurn[] = [];
    const sm = new AgentStateMachine();
    sm.transition("START"); // idle -> generating

    await memory.append(sessionId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    // Offer every registered tool to backends that support native function
    // calling. Constant across turns.
    const toolSpecs = toolBridge.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
    }));

    for (let turn = 0; turn < maxTurns; turn++) {
      const state = await memory.get(sessionId);

      // Context management: keep only the last `maxContextMessages` verbatim and
      // fold everything older into a single summary block so the prompt is bounded.
      let recentMessages = state.messages;
      let memorySummary = state.summary;
      if (state.messages.length > this.maxContextMessages) {
        const olderCount = state.messages.length - this.maxContextMessages;
        const older = state.messages.slice(0, olderCount);
        recentMessages = state.messages.slice(olderCount);
        const folded = extractiveSummary(older, older.length);
        memorySummary = state.summary ? `${state.summary}\n${folded}` : folded;
      }

      const messages = promptBuilder.build({
        systemInstruction,
        toolDescriptions: toolBridge.list().map(
          (t) => `- **${t.name}**: ${t.description}`,
        ),
        ...(memorySummary ? { memorySummary } : {}),
        recentMessages,
      });

      logger.debug(`[turn ${turn}] Calling LLM`);
      const llmResponse = await llm.generate(messages, { tools: toolSpecs });
      const rawOutput = llmResponse.content;

      // Native tool-calling path: structured tool calls are already valid JSON,
      // so they bypass the text protocol and its validation/retry loop.
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        const limit = this.policy.maxToolCallsPerTurn;
        const accepted = llmResponse.toolCalls.slice(0, Math.max(0, limit));
        if (llmResponse.toolCalls.length > accepted.length) {
          logger.warn(
            `[turn ${turn}] ${llmResponse.toolCalls.length} tool calls requested, ` +
              `capping to policy limit ${limit}`,
          );
        }

        sm.transition("TOOL_CALL_DETECTED"); // generating -> executing_tool
        const agentTurn: AgentTurn = { turnIndex: turn, rawAssistantOutput: rawOutput, toolCalls: [] };
        await memory.append(sessionId, { role: "assistant", content: rawOutput, timestamp: Date.now() });

        for (const call of accepted) {
          if (!isToolAllowed(call.name, this.policy)) {
            sm.transition("ERROR"); // executing_tool -> failed
            throw new AgentError(`Tool '${call.name}' is not allowed by policy`);
          }
          logger.debug(`[turn ${turn}] Executing tool (native): ${call.name}`);
          const record = await this.executeToolSafely(call.name, call.arguments);
          toolTrace.push(record);
          agentTurn.toolCalls.push(record);
          await memory.append(sessionId, {
            role: "tool",
            content: JSON.stringify({ tool: call.name, result: record.output ?? record.error }),
            timestamp: Date.now(),
          });
        }

        rawTurns.push(agentTurn);
        sm.transition("TOOL_DONE"); // executing_tool -> generating
        continue;
      }

      // Retry loop for validation
      let parsed = parseAssistantOutput(rawOutput, validator);
      let retryCount = 0;
      let lastOutput = rawOutput;

      while (parsed.kind === "invalid" && retryCount < defaultRetryStrategy.maxRetries) {
        retryCount++;
        logger.warn(`[turn ${turn}] Output invalid, retry ${retryCount}`);
        sm.transition("VALIDATION_FAILED"); // generating -> retrying
        const retryPrompt = defaultRetryStrategy.buildRetryPrompt(lastOutput, "Invalid format");
        const retryMessages = [...messages, { role: "assistant" as const, content: lastOutput }, { role: "user" as const, content: retryPrompt }];
        const retryResponse = await llm.generate(retryMessages);
        lastOutput = retryResponse.content;
        sm.transition("LLM_RESPONSE"); // retrying -> generating
        parsed = parseAssistantOutput(lastOutput, validator);
      }

      const agentTurn: AgentTurn = { turnIndex: turn, rawAssistantOutput: lastOutput, toolCalls: [] };

      if (parsed.kind === "final") {
        sm.transition("FINAL_ANSWER"); // generating -> done
        rawTurns.push(agentTurn);
        await memory.append(sessionId, { role: "assistant", content: lastOutput, timestamp: Date.now() });
        return { sessionId, finalAnswer: parsed.finalText ?? "", toolTrace, rawTurns, terminatedReason: "final_answer", finalState: sm.current() };
      }

      if (parsed.kind === "tool_call") {
        const toolName = parsed.toolName!;
        sm.transition("TOOL_CALL_DETECTED"); // generating -> executing_tool
        if (!isToolAllowed(toolName, this.policy)) {
          sm.transition("ERROR"); // executing_tool -> failed
          throw new AgentError(`Tool '${toolName}' is not allowed by policy`);
        }

        logger.debug(`[turn ${turn}] Executing tool: ${toolName}`);
        const record = await this.executeToolSafely(toolName, parsed.toolArguments);
        toolTrace.push(record);
        agentTurn.toolCalls.push(record);
        rawTurns.push(agentTurn);

        await memory.append(sessionId, { role: "assistant", content: lastOutput, timestamp: Date.now() });
        await memory.append(sessionId, {
          role: "tool",
          content: JSON.stringify({ tool: toolName, result: record.output ?? record.error }),
          timestamp: Date.now(),
        });
        sm.transition("TOOL_DONE"); // executing_tool -> generating
        continue;
      }

      // kind === "invalid" after retries exhausted: a permanently malformed
      // response is a failed run.
      sm.transition("ERROR"); // generating -> failed
      rawTurns.push(agentTurn);
      return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "validation_failed", finalState: sm.current() };
    }

    sm.transition("MAX_TURNS"); // generating -> done
    return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "max_turns", finalState: sm.current() };
  }
}
