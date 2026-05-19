import type { AgentLoop, AgentLoopInput, AgentLoopResult, AgentTurn } from "../types/agent.js";
import type { Memory } from "../types/memory.js";
import type { ToolBridge, ToolExecutionRecord } from "../types/tool.js";
import type { LLMAdapter } from "../types/llm.js";
import type { OutputValidator } from "../types/guardrails.js";
import type { PromptBuilder } from "./prompt-builder.js";
import { parseAssistantOutput } from "./output-parser.js";
import { isToolAllowed, defaultPolicy } from "../guardrails/policy.js";
import { defaultRetryStrategy } from "../guardrails/retries.js";
import type { GuardrailPolicy } from "../types/guardrails.js";
import { AgentError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface AgentLoopDeps {
  llm: LLMAdapter;
  memory: Memory;
  toolBridge: ToolBridge;
  validator: OutputValidator;
  promptBuilder: PromptBuilder;
  policy?: GuardrailPolicy;
  systemInstruction?: string;
}

export class DefaultAgentLoop implements AgentLoop {
  private readonly policy: GuardrailPolicy;

  constructor(private readonly deps: AgentLoopDeps) {
    this.policy = deps.policy ?? defaultPolicy;
  }

  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const { sessionId, userMessage, maxTurns = 10 } = input;
    const { llm, memory, toolBridge, validator, promptBuilder } = this.deps;
    const systemInstruction = this.deps.systemInstruction ?? "You are a helpful assistant.";

    const toolTrace: ToolExecutionRecord[] = [];
    const rawTurns: AgentTurn[] = [];

    await memory.append(sessionId, {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    for (let turn = 0; turn < maxTurns; turn++) {
      const state = await memory.get(sessionId);
      const messages = promptBuilder.build({
        systemInstruction,
        toolDescriptions: toolBridge.list().map(
          (t) => `- **${t.name}**: ${t.description}`,
        ),
        recentMessages: state.messages,
      });

      logger.debug(`[turn ${turn}] Calling LLM`);
      const llmResponse = await llm.generate(messages);
      const rawOutput = llmResponse.content;

      // Retry loop for validation
      let parsed = parseAssistantOutput(rawOutput, validator);
      let retryCount = 0;
      let lastOutput = rawOutput;

      while (parsed.kind === "invalid" && retryCount < defaultRetryStrategy.maxRetries) {
        retryCount++;
        logger.warn(`[turn ${turn}] Output invalid, retry ${retryCount}`);
        const retryPrompt = defaultRetryStrategy.buildRetryPrompt(lastOutput, "Invalid format");
        const retryMessages = [...messages, { role: "assistant" as const, content: lastOutput }, { role: "user" as const, content: retryPrompt }];
        const retryResponse = await llm.generate(retryMessages);
        lastOutput = retryResponse.content;
        parsed = parseAssistantOutput(lastOutput, validator);
      }

      const agentTurn: AgentTurn = { turnIndex: turn, rawAssistantOutput: lastOutput, toolCalls: [] };

      if (parsed.kind === "final") {
        rawTurns.push(agentTurn);
        await memory.append(sessionId, { role: "assistant", content: lastOutput, timestamp: Date.now() });
        return { sessionId, finalAnswer: parsed.finalText ?? "", toolTrace, rawTurns, terminatedReason: "final_answer" };
      }

      if (parsed.kind === "tool_call") {
        const toolName = parsed.toolName!;
        if (!isToolAllowed(toolName, this.policy)) {
          throw new AgentError(`Tool '${toolName}' is not allowed by policy`);
        }

        logger.debug(`[turn ${turn}] Executing tool: ${toolName}`);
        const record = await toolBridge.execute({ toolName, arguments: parsed.toolArguments });
        toolTrace.push(record);
        agentTurn.toolCalls.push(record);
        rawTurns.push(agentTurn);

        await memory.append(sessionId, { role: "assistant", content: lastOutput, timestamp: Date.now() });
        await memory.append(sessionId, {
          role: "tool",
          content: JSON.stringify({ tool: toolName, result: record.output ?? record.error }),
          timestamp: Date.now(),
        });
        continue;
      }

      // kind === "invalid" after retries
      rawTurns.push(agentTurn);
      return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "validation_failed" };
    }

    return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "max_turns" };
  }
}
