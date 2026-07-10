import type { ToolExecutionRecord } from "./tool.js";
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
}

export interface AgentTurn {
  turnIndex: number;
  rawAssistantOutput: string;
  toolCalls: ToolExecutionRecord[];
}

export interface AgentLoopResult {
  sessionId: string;
  finalAnswer: string;
  toolTrace: ToolExecutionRecord[];
  rawTurns: AgentTurn[];
  terminatedReason: "final_answer" | "max_turns" | "validation_failed" | "error";
  /** Terminal state of the driving state machine: "done" or "failed". */
  finalState: AgentState;
}

export interface AgentLoop {
  run(input: AgentLoopInput): Promise<AgentLoopResult>;
}
