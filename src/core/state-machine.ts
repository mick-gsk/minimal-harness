export type AgentState =
  | "idle"
  | "generating"
  | "executing_tool"
  | "retrying"
  | "done"
  | "failed";

export type AgentEvent =
  | "START"
  | "LLM_RESPONSE"
  | "TOOL_CALL_DETECTED"
  | "TOOL_DONE"
  | "FINAL_ANSWER"
  | "VALIDATION_FAILED"
  | "MAX_TURNS"
  | "ERROR";

const transitions: Record<AgentState, Partial<Record<AgentEvent, AgentState>>> = {
  idle: { START: "generating" },
  generating: {
    LLM_RESPONSE: "generating",
    TOOL_CALL_DETECTED: "executing_tool",
    FINAL_ANSWER: "done",
    VALIDATION_FAILED: "retrying",
    MAX_TURNS: "done",
    ERROR: "failed",
  },
  executing_tool: { TOOL_DONE: "generating", ERROR: "failed" },
  retrying: { LLM_RESPONSE: "generating", MAX_TURNS: "done", ERROR: "failed" },
  done: {},
  failed: {},
};

export class AgentStateMachine {
  private state: AgentState = "idle";

  current(): AgentState {
    return this.state;
  }

  transition(event: AgentEvent): AgentState {
    const next = transitions[this.state]?.[event];
    if (!next) {
      throw new Error(`Invalid transition: ${this.state} + ${event}`);
    }
    this.state = next;
    return this.state;
  }

  isTerminal(): boolean {
    return this.state === "done" || this.state === "failed";
  }
}
