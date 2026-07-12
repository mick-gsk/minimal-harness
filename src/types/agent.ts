import type { ToolExecutionRecord, ToolInputSchema } from "./tool.js";
import type { AgentState } from "../core/state-machine.js";

export interface AgentLoopInput {
  sessionId: string;
  userMessage: string;
  maxTurns?: number;
  /**
   * Receives each raw content chunk of the main turn LLM calls when the
   * backend streams. In text-protocol mode chunks include protocol markup
   * (ACTION: ...); retry and verify calls do not stream.
   */
  onToken?: (chunk: string) => void;
  /**
   * When set, the final answer must be a single JSON object matching this
   * schema. The contract is injected into the system prompt, the answer is
   * parsed and validated, and violations trigger corrective retries. A run
   * that never conforms terminates with "validation_failed" — callers never
   * receive silently broken JSON.
   */
  responseSchema?: ToolInputSchema;
  /**
   * Opt-in persistence scaffold (arXiv 2605.12129): closes the loop into
   * plan → execute → verify → recover so small local models stop giving up
   * early. Default off — no other mode changes without this flag. Pass `true`
   * for defaults or `{ rePlanEvery }` to tune the re-plan cadence.
   *
   * Text-protocol only: combining it with nativeToolCalling throws, because a
   * HALF scaffold measured WORSE than none in the source paper (non-monotone).
   * See docs/research/2026-07-11-sota-small-model-agents.md.
   */
  scaffold?: boolean | { rePlanEvery?: number };
  /**
   * Opt-in context compaction for long research runs (arXiv 2510.00615 ACON):
   * compressing old observations cuts peak tokens 26–54 % and lifts small
   * models +20–46 %, because the compacted history clarifies dependencies (the
   * agent stops repeating the same failed call). Default off — no other mode
   * changes without this flag.
   *
   * Two stages (see agent-loop.ts):
   *  - Deterministic (always when active): tool results older than
   *    `keepRecentTurns` turns are replaced in-history by a compact summary
   *    (first lines + a truncation marker). No LLM call, no loss of the WHAT.
   *  - LLM fallback (only when needed): if the estimated prompt still exceeds a
   *    budget derived from `numCtx`, one LLM call folds the oldest half of the
   *    history into a structured "Merkzettel". Its failure keeps stage 1 — no
   *    crash.
   *
   * Orthogonal to the text protocol, nativeToolCalling and scaffold — it only
   * reshapes the prompt history and combines with all of them.
   */
  contextCompaction?: {
    /** Keep the last N tool-result turns verbatim; older ones are truncated. Default 3. */
    keepRecentTurns?: number;
    /**
     * Backend context window in tokens, used to size the stage-2 trigger.
     * Default 16384 — matches the OllamaClient config in bench/company.
     */
    numCtx?: number;
  };
}

export interface AgentTurn {
  turnIndex: number;
  rawAssistantOutput: string;
  toolCalls: ToolExecutionRecord[];
}

export interface AgentLoopResult {
  sessionId: string;
  finalAnswer: string;
  /** Parsed, schema-validated answer object — present when responseSchema was set and satisfied. */
  structuredAnswer?: unknown;
  toolTrace: ToolExecutionRecord[];
  rawTurns: AgentTurn[];
  terminatedReason: "final_answer" | "max_turns" | "validation_failed" | "error";
  /** Terminal state of the driving state machine: "done" or "failed". */
  finalState: AgentState;
}

export interface AgentLoop {
  run(input: AgentLoopInput): Promise<AgentLoopResult>;
}
