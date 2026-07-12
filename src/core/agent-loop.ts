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

/**
 * Persistence-scaffold config (arXiv 2605.12129). The paper reports the effect
 * is NON-MONOTONE — a partial wrapper scored WORSE than none — so the four
 * stages (plan / gate / recover / first-thought) always run together, never
 * piecemeal.
 */
interface ScaffoldConfig {
  rePlanEvery: number;
}

/**
 * Re-plan cadence. Default 4: keeps the plan current without doubling every
 * action step with an extra planning call. bench/company observes a research
 * depth of 6–9 tool calls per hard fact, so a re-plan every 4th action turn
 * lands roughly one mid-course correction per run — the point where a small
 * model tends to drift off its original plan — without turning half the turn
 * budget into planning overhead. (CLAUDE.md rule 4: every constant has a why.)
 */
const DEFAULT_RE_PLAN_EVERY = 4;

function normalizeScaffold(flag: boolean | { rePlanEvery?: number } | undefined): ScaffoldConfig | undefined {
  if (!flag) return undefined;
  const rePlanEvery = typeof flag === "object" ? (flag.rePlanEvery ?? DEFAULT_RE_PLAN_EVERY) : DEFAULT_RE_PLAN_EVERY;
  return { rePlanEvery: Math.max(1, rePlanEvery) };
}

/**
 * Resolved context-compaction config (arXiv 2510.00615 ACON). `thresholdChars`
 * is the single budget both stages are gated on; `keepRecentTurns` is the lower
 * bound of tool-result turns stage 1 will never touch.
 */
interface CompactionConfig {
  keepRecentTurns: number;
  thresholdChars: number;
}

/**
 * Lower bound of recent tool-result turns kept verbatim NO MATTER WHAT — stage 1
 * never truncates the last 3 turns even under budget pressure. Why 3: the model
 * almost always needs the immediately preceding observation (to act on it) and
 * one or two before it (to cross-check / avoid re-issuing a call). Older results
 * beyond this floor are only truncated when the prompt actually overflows the
 * budget, oldest-first and just enough — never pre-emptively. (Empirical: an
 * always-on stage 1 measured HARMFUL — 21 % vs 44–48 % — because it evicted
 * evidence that would have fit; the ACON uplift only holds for overflowing
 * contexts.)
 */
const DEFAULT_KEEP_RECENT_TURNS = 3;
/** Backend context window assumed when the caller does not pass one — the bench/company Ollama config. */
const DEFAULT_NUM_CTX = 16384;
/**
 * Lines of each truncated tool result kept before the marker. 5 is enough to
 * carry the identifying head of an observation (a filename, a table header, the
 * first data rows) without the bulk that overflows the window.
 */
const COMPACTION_HEAD_LINES = 5;
/**
 * Deterministic char→token proxy (zero-dep: no tokenizer). ~4 chars/token is a
 * conservative English/German BPE estimate; it only has to be stable, not exact,
 * because it gates a threshold, not a hard limit.
 */
const CHARS_PER_TOKEN = 4;
/**
 * Compaction fires only once the estimated prompt would fill more than 70 % of
 * numCtx — i.e. once less than ~30 % of the window is left for the model's
 * thinking + answer (qwen3 think mode is token-heavy). This single fraction
 * gates BOTH stages: below it, the history is passed through untouched (never
 * truncate what fits); above it, stage 1 truncates oldest-first just enough to
 * drop back under, and stage 2 escalates only if stage 1 cannot free enough.
 */
const PROMPT_BUDGET_FRACTION = 0.7;

function normalizeCompaction(
  flag: { keepRecentTurns?: number; numCtx?: number } | undefined,
): CompactionConfig | undefined {
  if (!flag) return undefined;
  const keepRecentTurns = Math.max(1, flag.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS);
  const numCtx = flag.numCtx ?? DEFAULT_NUM_CTX;
  const thresholdChars = Math.floor(numCtx * CHARS_PER_TOKEN * PROMPT_BUDGET_FRACTION);
  return { keepRecentTurns, thresholdChars };
}

/** German Merkzettel prompt (model-facing content; primary target runs in German). */
const COMPACTION_SUMMARY_PROMPT =
  "Fasse den bisherigen Rechercheverlauf als kompakten Merkzettel zusammen, damit die " +
  "Recherche ohne den vollen Verlauf fortgesetzt werden kann. Struktur exakt:\n" +
  "Bisher geprüft: <welche Quellen/Tools mit welchen Argumenten>\n" +
  "Ergebnisse: <konkrete gefundene Fakten/Zahlen>\n" +
  "Offen: <was noch fehlt>\n" +
  "Nur der Merkzettel, keine weitere Aktion.";

/** A short, single-line hint of the tool arguments, recovered from the assistant turn that issued the call. */
function extractArgsHint(precedingAssistant: string | undefined): string {
  if (!precedingAssistant) return "";
  const m = precedingAssistant.match(/ARGS:\s*(.+)/);
  const raw = (m?.[1] ?? "").trim();
  if (raw.length === 0) return "";
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
}

/**
 * Deterministic stage-1 replacement for a single tool-result message: keep the
 * first COMPACTION_HEAD_LINES lines of the result, then a marker naming the
 * original size, the tool and (best effort) its args. No LLM call; the WHAT
 * survives, only the DETAIL is dropped. Tool messages are
 * `JSON.stringify({ tool, result })`, so the tool name and a readable result
 * are recovered by parsing; a non-JSON message falls back to raw text.
 */
function summarizeToolResult(content: string, precedingAssistant: string | undefined, headLines: number): string {
  const originalLen = content.length;
  let toolName = "?";
  let resultText = content;
  const parsed = safeParseJson(content);
  if (parsed.ok && parsed.value !== null && typeof parsed.value === "object") {
    const obj = parsed.value as Record<string, unknown>;
    if (typeof obj.tool === "string") toolName = obj.tool;
    if ("result" in obj) resultText = typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result);
  }
  const head = resultText.split("\n").slice(0, headLines).join("\n");
  const argsHint = extractArgsHint(precedingAssistant);
  const marker = `[gekürzt: war ${originalLen} Zeichen, Tool ${toolName}${argsHint ? `, Args ${argsHint}` : ""}]`;
  return `${head}\n${marker}`;
}

/** Deterministic prompt-size proxy: total content chars across all messages. */
function estimatePromptChars(prompt: { content: string }[]): number {
  let n = 0;
  for (const m of prompt) n += m.content.length;
  return n;
}

/**
 * Stage 1 (deterministic, budget-gated & incremental): truncate the OLDEST
 * tool-result groups first, one group at a time, and stop the instant
 * `isUnderBudget` reports the rebuilt prompt fits — so only as many old
 * observations are compacted as the overflow actually requires. Consecutive
 * tool messages form one turn's observations (parallel tool calls land
 * back-to-back); the last `keepRecentTurns` such groups are the untouchable
 * floor. When the prompt already fits, nothing is truncated at all (the caller
 * short-circuits before ever calling this). When even truncating everything
 * above the floor is not enough, the fully-truncated history is returned for
 * stage 2 to escalate.
 */
function truncateOldObservations<T extends { role: string; content: string }>(
  messages: T[],
  keepRecentTurns: number,
  headLines: number,
  isUnderBudget: (msgs: T[]) => boolean,
): T[] {
  // Group indices of tool messages by turn (a run of adjacent tool messages).
  const groups: number[][] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== "tool") continue;
    if (i > 0 && messages[i - 1]!.role === "tool" && groups.length > 0) {
      groups[groups.length - 1]!.push(i);
    } else {
      groups.push([i]);
    }
  }
  const cutoff = groups.length - keepRecentTurns;
  if (cutoff <= 0) return messages;
  // Add one older group per iteration (oldest-first), re-truncate from scratch,
  // and stop as soon as the budget is met — the minimal compaction that fits.
  const oldIndices = new Set<number>();
  let result = messages;
  for (let g = 0; g < cutoff; g++) {
    for (const idx of groups[g]!) oldIndices.add(idx);
    result = messages.map((m, i) =>
      oldIndices.has(i)
        ? ({ ...m, content: summarizeToolResult(m.content, messages[i - 1]?.content, headLines) } as T)
        : m,
    );
    if (isUnderBudget(result)) break;
  }
  return result;
}

/**
 * Scaffold-mode injected prompts. German on purpose: the primary target
 * (bench/company, qwen3:8b) operates in German and these strings are
 * model-facing content, not code. The four stages, per the paper:
 *  - PLAN     forces an explicit numbered plan before the first action.
 *  - RECOVERY turns an empty/failed tool result into forced reflection.
 *  - GATE     rejects free text — the loop may only end via final_answer.
 *  - FORCE    the last resort when MAX_TURNS is hit.
 *  - FIRST_THOUGHT (arXiv 2505.17612) primes the agentic mode each turn.
 */
const SCAFFOLD_PLAN_PROMPT =
  "Bevor du handelst: Schreibe einen kurzen, nummerierten Plan (1., 2., 3. …) — " +
  "welche Quellen/Tools du in welcher Reihenfolge nutzt, um die Frage zu beantworten. " +
  "Nur der Plan, noch keine Aktion.";
const SCAFFOLD_FIRST_THOUGHT =
  'Beginne deine Antwort mit "Ich prüfe meinen Plan und wähle die nächste Aktion:" ' +
  "und antworte dann mit genau einer ACTION (tool_call oder final_answer).";
const SCAFFOLD_RECOVERY_PROMPT =
  "Das hat nicht funktioniert (Fehler oder kein Treffer). Was sagt dir das? " +
  "Welche alternative Quelle oder welchen anderen Suchbegriff probierst du als Nächstes laut deinem Plan? " +
  "Wenn die Information wirklich nirgends steht, sage das per final_answer.";
const SCAFFOLD_GATE_PROMPT =
  "Antworte mit einer Aktion im vorgegebenen Format. Wenn du fertig bist, nutze ACTION: final_answer " +
  '(auch eine Verweigerung wie "nicht gefunden" gibst du per final_answer aus).';
const SCAFFOLD_FORCE_FINAL_PROMPT =
  "Du hast das Turn-Limit erreicht. Antworte jetzt mit ACTION: final_answer auf Basis der bisherigen Ergebnisse " +
  "(oder sage per final_answer, dass die Information nicht ableitbar ist).";

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

  /**
   * Builds the prompt for one turn: keeps the last `maxContextMessages`
   * verbatim and folds everything older into a single summary block so the
   * prompt stays bounded. Extracted so the scaffold's forced-final step reuses
   * the exact same context contract as the main loop.
   */
  private async buildTurnMessages(
    sessionId: string,
    systemInstruction: string,
    compaction?: CompactionConfig,
  ): Promise<ChatMessage[]> {
    const state = await this.deps.memory.get(sessionId);
    // Assemble a prompt from a given history: fold everything older than
    // maxContextMessages into the extractive summary, then lay it out. Pure in
    // `messages`, so the compaction gate can rebuild-and-measure candidates.
    const buildPrompt = (messages: typeof state.messages): ChatMessage[] => {
      let recentMessages = messages;
      let memorySummary = state.summary;
      if (messages.length > this.maxContextMessages) {
        const olderCount = messages.length - this.maxContextMessages;
        const older = messages.slice(0, olderCount);
        recentMessages = messages.slice(olderCount);
        const folded = extractiveSummary(older, older.length);
        memorySummary = state.summary ? `${state.summary}\n${folded}` : folded;
      }
      return this.deps.promptBuilder.build({
        systemInstruction,
        // In native mode the tool specs travel via the API; the text protocol
        // block would only burn tokens the model never uses.
        toolDescriptions: this.deps.nativeToolCalling
          ? []
          : this.deps.toolBridge.list().map((t) => `- **${t.name}**: ${t.description}`),
        ...(memorySummary ? { memorySummary } : {}),
        recentMessages,
      });
    };

    const prompt = buildPrompt(state.messages);
    // No compaction, or the prompt already fits: pass the history through
    // untouched. WITH the flag under budget this is byte-identical to WITHOUT
    // it — the core guarantee, since an always-on stage 1 measured harmful.
    if (!compaction || estimatePromptChars(prompt) <= compaction.thresholdChars) {
      return prompt;
    }

    // Stage 1 (deterministic, budget-gated): truncate the oldest tool results
    // just enough to drop back under budget; the last keepRecentTurns turns are
    // the untouchable floor. Measured on the fully rebuilt prompt each step.
    const underBudget = (msgs: typeof state.messages): boolean =>
      estimatePromptChars(buildPrompt(msgs)) <= compaction.thresholdChars;
    const truncated = truncateOldObservations(
      state.messages,
      compaction.keepRecentTurns,
      COMPACTION_HEAD_LINES,
      underBudget,
    );
    const stage1Prompt = buildPrompt(truncated);
    if (estimatePromptChars(stage1Prompt) <= compaction.thresholdChars) {
      return stage1Prompt;
    }

    // Stage 2 (LLM fallback): stage 1 could not free enough within its floor —
    // fold the oldest half into a Merkzettel. A failed call keeps stage 1's
    // prompt (no crash).
    return this.compactWithLlm(stage1Prompt);
  }

  /**
   * Stage 2 of context compaction: one LLM call folds the oldest half of the
   * conversation (system messages excluded) into a single structured Merkzettel,
   * marked as an assistant message. On any failure the un-summarized prompt is
   * returned unchanged, so stage 1 still stands and the run never crashes.
   */
  private async compactWithLlm(prompt: ChatMessage[]): Promise<ChatMessage[]> {
    const system = prompt.filter((m) => m.role === "system");
    const convo = prompt.filter((m) => m.role !== "system");
    // Nothing meaningful to fold below a handful of messages.
    if (convo.length < 4) return prompt;
    const half = Math.floor(convo.length / 2);
    const oldHalf = convo.slice(0, half);
    const keep = convo.slice(half);
    try {
      const response = await this.deps.llm.generate([...oldHalf, { role: "user", content: COMPACTION_SUMMARY_PROMPT }]);
      const merkzettel: ChatMessage = {
        role: "assistant",
        content: `MERKZETTEL (verdichteter Verlauf):\n${response.content.trim()}`,
      };
      return [...system, merkzettel, ...keep];
    } catch (err) {
      logger.warn(`Context compaction summary failed, keeping deterministic truncation: ${err instanceof Error ? err.message : String(err)}`);
      return prompt;
    }
  }

  /**
   * Scaffold recovery trigger: a tool result is "unproductive" when it errored
   * or carries no content (null/empty string/[]/{}). First-principles read of
   * "leeres/fehlgeschlagenes Tool-Ergebnis" — exactly the signals that make a
   * small model give up or loop, so they earn a forced reflection.
   */
  private static isUnproductive(record: ToolExecutionRecord): boolean {
    if (record.error !== undefined) return true;
    const out = record.output;
    if (out === undefined || out === null) return true;
    if (typeof out === "string") return out.trim().length === 0;
    if (Array.isArray(out)) return out.length === 0;
    if (typeof out === "object") return Object.keys(out).length === 0;
    return false;
  }

  /**
   * Plan stage: on plan turns (0, then every `rePlanEvery`), one extra LLM
   * call produces an explicit numbered plan before any action. The plan is
   * appended to memory AND to the live message array so this turn's action
   * call already sees it. Not offered any tools — it is a pure thinking step.
   */
  private async scaffoldPlan(
    sessionId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    const planResponse = await this.deps.llm.generate([
      ...messages,
      { role: "user", content: SCAFFOLD_PLAN_PROMPT },
    ]);
    const plan = `PLAN:\n${planResponse.content.trim()}`;
    await this.deps.memory.append(sessionId, { role: "assistant", content: plan, timestamp: Date.now() });
    messages.push({ role: "assistant", content: plan });
  }

  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const { sessionId, userMessage, maxTurns = 10, onToken, responseSchema } = input;
    const { llm, memory, toolBridge, validator } = this.deps;
    const scaffold = normalizeScaffold(input.scaffold);
    // Opt-in context compaction (arXiv 2510.00615). Orthogonal to scaffold and
    // nativeToolCalling — it only reshapes the prompt history, so no exclusivity
    // guard is needed; it composes with every mode.
    const compaction = normalizeCompaction(input.contextCompaction);
    // Non-monotone warning (arXiv 2605.12129): the scaffold gates termination
    // through the text protocol's final_answer action. In native mode the model
    // ends a run with plain content and its tool calls bypass the parser — the
    // gate/recovery would be a HALF wrapper, which the paper measured as worse
    // than none. Refuse the combination loudly instead of shipping it broken.
    if (scaffold && this.deps.nativeToolCalling) {
      throw new AgentError(
        "scaffold mode is text-protocol only and cannot be combined with nativeToolCalling " +
          "(a half scaffold measured worse than none — see arXiv 2605.12129)",
      );
    }
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
      const messages = await this.buildTurnMessages(sessionId, systemInstruction, compaction);

      // Scaffold preamble (text-protocol only; scaffold+native throws above).
      if (scaffold) {
        // Plan stage: force a numbered plan before the first action, then
        // periodically re-plan to keep it current (see DEFAULT_RE_PLAN_EVERY).
        if (turn % scaffold.rePlanEvery === 0) {
          await this.scaffoldPlan(sessionId, messages);
        }
        // First-thought prefix: prime the agentic mode this turn (ephemeral —
        // not persisted, so it does not accumulate across turns).
        messages.push({ role: "user", content: SCAFFOLD_FIRST_THOUGHT });
      }

      logger.debug(`[turn ${turn}] Calling LLM`);
      const llmResponse = await llm.generate(messages, {
        // Scaffold gates termination through the text protocol, so it must not
        // offer native tool specs — otherwise a function-calling backend would
        // answer with native tool calls that skip the parser and the gate.
        ...(scaffold ? {} : { tools: toolSpecs }),
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

      // Scaffold skips the generic reformat-retry: an invalid (free-text) reply
      // is routed through the final_answer gate below instead, which both
      // re-prompts AND names final_answer as the only legitimate exit.
      while (parsed.kind === "invalid" && retryCount < defaultRetryStrategy.maxRetries && !scaffold) {
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
        // Recovery stage: an errored or empty tool result gets a forced
        // reflection instead of letting the model drift or give up.
        if (scaffold && DefaultAgentLoop.isUnproductive(record)) {
          await memory.append(sessionId, { role: "user", content: SCAFFOLD_RECOVERY_PROMPT, timestamp: Date.now() });
        }
        sm.transition("TOOL_DONE"); // executing_tool -> generating
        continue;
      }

      // final_answer gate (scaffold): free text is NOT a valid ending. Record
      // the turn, remind the model that the loop may only end via final_answer,
      // and keep going (bounded by maxTurns). Refusal stays legitimate — it
      // just has to travel through final_answer, too.
      if (scaffold) {
        rawTurns.push(agentTurn);
        await memory.append(sessionId, { role: "assistant", content: lastOutput, timestamp: Date.now() });
        await memory.append(sessionId, { role: "user", content: SCAFFOLD_GATE_PROMPT, timestamp: Date.now() });
        sm.transition("LLM_RESPONSE"); // generating -> generating (stay in the loop)
        continue;
      }

      // kind === "invalid" after retries exhausted: a permanently malformed
      // response is a failed run.
      sm.transition("ERROR"); // generating -> failed
      rawTurns.push(agentTurn);
      return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "validation_failed", finalState: sm.current() };
    }

    // Scaffold MAX_TURNS: one forced final_answer call on the accumulated
    // results rather than returning an empty answer — the model must commit to
    // something (an answer or an explicit "not derivable").
    if (scaffold) {
      const messages = await this.buildTurnMessages(sessionId, systemInstruction, compaction);
      const forced = await llm.generate([...messages, { role: "user", content: SCAFFOLD_FORCE_FINAL_PROMPT }]);
      const parsed = parseAssistantOutput(forced.content, validator);
      let finalAnswer = parsed.kind === "final" ? (parsed.finalText ?? forced.content) : forced.content.trim();
      if (this.deps.verifyFinalAnswer && toolTrace.length > 0) {
        finalAnswer = await this.verifyAnswer(messages, forced.content, finalAnswer);
      }
      await memory.append(sessionId, { role: "assistant", content: forced.content, timestamp: Date.now() });
      rawTurns.push({ turnIndex: maxTurns, rawAssistantOutput: forced.content, toolCalls: [] });
      sm.transition("MAX_TURNS"); // generating -> done
      // A forced answer that finally used the gate is a real final_answer;
      // otherwise it is the best-effort content salvaged at the turn limit.
      return {
        sessionId,
        finalAnswer,
        toolTrace,
        rawTurns,
        terminatedReason: parsed.kind === "final" ? "final_answer" : "max_turns",
        finalState: sm.current(),
      };
    }

    sm.transition("MAX_TURNS"); // generating -> done
    return { sessionId, finalAnswer: "", toolTrace, rawTurns, terminatedReason: "max_turns", finalState: sm.current() };
  }
}
