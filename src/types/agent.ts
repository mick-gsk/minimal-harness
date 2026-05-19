import type { ToolExecutionRecord } from "./tool.js";

export interface AgentLoopInput {
  sessionId: string;
  userMessage: string;
  maxTurns?: number;
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
}

export interface AgentLoop {
  run(input: AgentLoopInput): Promise<AgentLoopResult>;
}
