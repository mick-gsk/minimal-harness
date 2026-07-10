import type { AgentLoop, AgentLoopInput, AgentLoopResult, AgentTurn } from "../types/agent.js";
import type { Memory } from "../types/memory.js";
import type { ToolBridge, ToolExecutionRecord } from "../types/tool.js";
import type { ChatMessage, LLMAdapter } from "../types/llm.js";
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
import { validateToolInput } from "../tools/schema.js";
import { safeParseJson } from "../utils/json.js";
import type { ToolInputSchema } from "../types/tool.js";

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
  /**
   * Set to true when the backend supports native function calling: the text
   * protocol block (ACTION/TOOL/ARGS) is omitted from the prompt — tool specs
   * already travel via the API — and plain content without tool calls is the
   * final answer. Defaults to false (text protocol).
   */
  nativeToolCalling?: boolean;
  /**
   * When true and the run used at least one tool, a single extra LLM call
   * asks the model to re-check its final answer against the tool results
   * before it is returned. Catches mental-math slips at the cost of one
   * additional call. Defaults to false.
   */
  verifyFinalAnswer?: boolean;
  /**
   * When true, the native path executes all accepted tool calls of a turn
   * concurrently (k independent calls of latency t: ~t instead of k*t).
   * Results are written in call order regardless of completion order, so
   * transcripts stay reproducible. Defaults to false (sequential).
   */
  parallelToolCalls?: boolean;
  /**
   * Human-in-the-loop gate: asked before every tool execution (in parallel
   * mode sequentially, before the batch starts). Returning false skips the
   * call and feeds "denied by approval policy" back to the model — no
   * phantom success. Unset = every call is approved (previous behavior).
   */
  onToolApproval?: (call: { name: string; arguments: unknown }) => Promise<boolean>;
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

  /** Asks the approval hook (when present); a denial becomes an error record. */
  private async approveToolCall(toolName: string, args: unknown): Promise<ToolExecutionRecord | null> {
    if (!this.deps.onToolApproval) return null;
    const approved = await this.deps.onToolApproval({ name: toolName, arguments: args });
    if (approved) return null;
    logger.warn(`Tool call '${toolName}' denied by approval policy`);
    return {
      toolName,
      arguments: args,
      error: "not executed: denied by approval policy. Explain to the user that the action was not approved.",
      executedAt: Date.now(),
    };
  }

  /**
   * One extra LLM call asking the model to re-check its answer against the
   * tool results already in the conversation. Returns the (possibly
   * corrected) answer; on an unusable reply the original answer stands.
   */
  private async verifyAnswer(
    messages: ChatMessage[],
    assistantOutput: string,
    candidate: string,
  ): Promise<string> {
    const prompt =
      "Before finalizing: re-check your answer against the tool results in this conversation. " +
      "If it is correct, repeat it; if not, reply with the corrected answer.";
    const response = await this.deps.llm.generate([
      ...messages,
      { role: "assistant", content: assistantOutput },
      { role: "user", content: prompt },
    ]);
    const parsed = parseAssistantOutput(response.content, this.deps.validator);
    if (parsed.kind === "final") return parsed.finalText ?? candidate;
    const plain = response.content.trim();
    return plain.length > 0 && !plain.startsWith("ACTION:") ? plain : candidate;
  }

  /**
   * Parses a final-answer candidate against the response schema. Tolerates a
   * ```json fence around the object; anything else must be plain JSON.
   */
  private static parseStructured(
    candidate: string,
    schema: ToolInputSchema,
  ): { ok: true; value: unknown } | { ok: false; error: string } {
    const unfenced = candidate.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
    let parsed = safeParseJson(unfenced);
    if (!parsed.ok) {
      // Models often wrap the object in stray text; the first {...} block is
      // the answer if it validates.
      const embedded = unfenced.match(/\{[\s\S]*\}/);
      if (embedded) parsed = safeParseJson(embedded[0]);
    }
    if (!parsed.ok) return { ok: false, error: "the answer is not valid JSON" };
    const violation = validateToolInput(parsed.value, schema);
    return violation ? { ok: false, error: violation } : { ok: true, value: parsed.value };
  }

  /**
   * Corrective retry loop for responseSchema violations. Returns the parsed
   * object plus the (possibly corrected) answer text, or null when the model
   * never conforms — the caller then terminates with validation_failed.
   */
  private async enforceResponseSchema(
    messages: ChatMessage[],
    lastOutput: string,
    candidate: string,
    schema: ToolInputSchema,
  ): Promise<{ answer: string; structured: unknown } | null> {
    let answer = candidate;
    let assistantOutput = lastOutput;
    for (let attempt = 0; ; attempt++) {
      const result = DefaultAgentLoop.parseStructured(answer, schema);
      if (result.ok) return { answer, structured: result.value };
      if (attempt >= defaultRetryStrategy.maxRetries) return null;

      logger.warn(`Response schema violated (${result.error}), retry ${attempt + 1}`);
      const response = await this.deps.llm.generate([
        ...messages,
        { role: "assistant", content: assistantOutput },
        {
          role: "user",
          content:
            `Your final answer violates the required JSON schema: ${result.error}. ` +
            `Reply with ONLY the corrected JSON object matching the schema.`,
        },
      ]);
      assistantOutput = response.content;
      // The correction may arrive as protocol format or as bare JSON.
      const parsed = parseAssistantOutput(response.content, this.deps.validator);
      answer = parsed.kind === "final" ? (parsed.finalText ?? response.content) : response.content;
    }
  }

  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const { sessionId, userMessage, maxTurns = 10, onToken, responseSchema } = input;
    const { llm, memory, toolBridge, validator, promptBuilder } = this.deps;
    const baseInstruction = this.deps.systemInstruction ?? "You are a helpful assistant.";
    // The schema contract goes into the system prompt so the model knows the
    // target format from turn one instead of learning it through retries.
    const systemInstruction = responseSchema
      ? `${baseInstruction}\n\nYour final answer must be a single valid JSON object matching this JSON schema:\n${JSON.stringify(responseSchema)}\nOutput only the JSON object as the answer — no prose around it.`
      : baseInstruction;

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
        // In native mode the tool specs travel via the API; the text protocol
        // block would only burn tokens the model never uses.
        toolDescriptions: this.deps.nativeToolCalling
          ? []
          : toolBridge.list().map((t) => `- **${t.name}**: ${t.description}`),
        ...(memorySummary ? { memorySummary } : {}),
        recentMessages,
      });

      logger.debug(`[turn ${turn}] Calling LLM`);
      const llmResponse = await llm.generate(messages, {
        tools: toolSpecs,
        ...(onToken ? { onToken } : {}),
      });
      const rawOutput = llmResponse.content;

      // Native tool-calling path: structured tool calls are already valid JSON,
      // so they bypass the text protocol and its validation/retry loop.
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        const limit = this.policy.maxToolCallsPerTurn;
        const accepted = llmResponse.toolCalls.slice(0, Math.max(0, limit));
        const dropped = llmResponse.toolCalls.slice(accepted.length);
        if (dropped.length > 0) {
          logger.warn(
            `[turn ${turn}] ${llmResponse.toolCalls.length} tool calls requested, ` +
              `capping to policy limit ${limit}`,
          );
        }

        sm.transition("TOOL_CALL_DETECTED"); // generating -> executing_tool
        const agentTurn: AgentTurn = { turnIndex: turn, rawAssistantOutput: rawOutput, toolCalls: [] };
        await memory.append(sessionId, { role: "assistant", content: rawOutput, timestamp: Date.now() });

        // Policy check for the whole batch before anything starts: a violation
        // must not leave a half-executed turn behind.
        for (const call of accepted) {
          if (!isToolAllowed(call.name, this.policy)) {
            sm.transition("ERROR"); // executing_tool -> failed
            throw new AgentError(`Tool '${call.name}' is not allowed by policy`);
          }
        }

        // Approval gate: asked sequentially before anything starts, so a human
        // sees each proposed call before the batch fires.
        const denials = new Map<number, ToolExecutionRecord>();
        for (const [i, call] of accepted.entries()) {
          const denial = await this.approveToolCall(call.name, call.arguments);
          if (denial) denials.set(i, denial);
        }

        // executeToolSafely never rejects (failures become error records), so
        // Promise.all cannot abort the batch. Results arrive in call order.
        let records: ToolExecutionRecord[];
        if (this.deps.parallelToolCalls) {
          logger.debug(`[turn ${turn}] Executing ${accepted.length} tool call(s) in parallel`);
          records = await Promise.all(
            accepted.map((call, i) => denials.get(i) ?? this.executeToolSafely(call.name, call.arguments)),
          );
        } else {
          records = [];
          for (const [i, call] of accepted.entries()) {
            logger.debug(`[turn ${turn}] Executing tool (native): ${call.name}`);
            records.push(denials.get(i) ?? (await this.executeToolSafely(call.name, call.arguments)));
          }
        }

        for (const [i, record] of records.entries()) {
          toolTrace.push(record);
          agentTurn.toolCalls.push(record);
          await memory.append(sessionId, {
            role: "tool",
            content: JSON.stringify({ tool: accepted[i]!.name, result: record.output ?? record.error }),
            timestamp: Date.now(),
          });
        }

        // A dropped call was never executed; staying silent makes the model
        // believe it ran (phantom success). Report each one back so it can
        // re-issue the call once it has seen the previous result.
        for (const call of dropped) {
          const error =
            `not executed: only ${limit} tool call(s) per turn are allowed. ` +
            `Issue this call again in your next turn, after you have seen the previous result.`;
          const record: ToolExecutionRecord = {
            toolName: call.name,
            arguments: call.arguments,
            error,
            executedAt: Date.now(),
          };
          toolTrace.push(record);
          agentTurn.toolCalls.push(record);
          await memory.append(sessionId, {
            role: "tool",
            content: JSON.stringify({ tool: call.name, result: error }),
            timestamp: Date.now(),
          });
        }

        rawTurns.push(agentTurn);
        sm.transition("TOOL_DONE"); // executing_tool -> generating
        continue;
      }

      // Native mode: no tool calls means the model is answering directly —
      // there is no text protocol to parse or retry.
      if (this.deps.nativeToolCalling) {
        let finalAnswer = rawOutput;
        if (this.deps.verifyFinalAnswer && toolTrace.length > 0) {
          finalAnswer = await this.verifyAnswer(messages, rawOutput, rawOutput);
        }
        let structured: unknown;
        if (responseSchema) {
          const enforced = await this.enforceResponseSchema(messages, rawOutput, finalAnswer, responseSchema);
          if (!enforced) {
            sm.transition("ERROR");
            rawTurns.push({ turnIndex: turn, rawAssistantOutput: rawOutput, toolCalls: [] });
            return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "validation_failed", finalState: sm.current() };
          }
          finalAnswer = enforced.answer;
          structured = enforced.structured;
        }
        sm.transition("FINAL_ANSWER"); // generating -> done
        rawTurns.push({ turnIndex: turn, rawAssistantOutput: rawOutput, toolCalls: [] });
        await memory.append(sessionId, { role: "assistant", content: rawOutput, timestamp: Date.now() });
        return {
          sessionId,
          finalAnswer,
          ...(structured !== undefined ? { structuredAnswer: structured } : {}),
          toolTrace,
          rawTurns,
          terminatedReason: "final_answer",
          finalState: sm.current(),
        };
      }

      // Retry loop for validation
      let parsed = parseAssistantOutput(rawOutput, validator);
      let retryCount = 0;
      let lastOutput = rawOutput;

      // Schema mode: a protocol-invalid reply that already contains
      // schema-valid JSON IS the deliverable — models regularly fuse the two
      // prompt contracts (e.g. "ACTION/ANSWER\n{...}"). Rescue it instead of
      // burning retries on protocol dressing.
      if (parsed.kind === "invalid" && responseSchema && DefaultAgentLoop.parseStructured(rawOutput, responseSchema).ok) {
        parsed = { kind: "final", finalText: rawOutput };
      }

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

      // Same rescue for the retry output (see above).
      if (parsed.kind === "invalid" && responseSchema && DefaultAgentLoop.parseStructured(lastOutput, responseSchema).ok) {
        parsed = { kind: "final", finalText: lastOutput };
      }

      const agentTurn: AgentTurn = { turnIndex: turn, rawAssistantOutput: lastOutput, toolCalls: [] };

      if (parsed.kind === "final") {
        let finalAnswer = parsed.finalText ?? "";
        if (this.deps.verifyFinalAnswer && toolTrace.length > 0) {
          finalAnswer = await this.verifyAnswer(messages, lastOutput, finalAnswer);
        }
        let structured: unknown;
        if (responseSchema) {
          const enforced = await this.enforceResponseSchema(messages, lastOutput, finalAnswer, responseSchema);
          if (!enforced) {
            sm.transition("ERROR");
            rawTurns.push(agentTurn);
            return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "validation_failed", finalState: sm.current() };
          }
          finalAnswer = enforced.answer;
          structured = enforced.structured;
        }
        sm.transition("FINAL_ANSWER"); // generating -> done
        rawTurns.push(agentTurn);
        await memory.append(sessionId, { role: "assistant", content: lastOutput, timestamp: Date.now() });
        return {
          sessionId,
          finalAnswer,
          ...(structured !== undefined ? { structuredAnswer: structured } : {}),
          toolTrace,
          rawTurns,
          terminatedReason: "final_answer",
          finalState: sm.current(),
        };
      }

      if (parsed.kind === "tool_call") {
        const toolName = parsed.toolName!;
        sm.transition("TOOL_CALL_DETECTED"); // generating -> executing_tool
        if (!isToolAllowed(toolName, this.policy)) {
          sm.transition("ERROR"); // executing_tool -> failed
          throw new AgentError(`Tool '${toolName}' is not allowed by policy`);
        }

        logger.debug(`[turn ${turn}] Executing tool: ${toolName}`);
        const record =
          (await this.approveToolCall(toolName, parsed.toolArguments)) ??
          (await this.executeToolSafely(toolName, parsed.toolArguments));
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
