export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export class ToolNotFoundError extends AgentError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolValidationError extends AgentError {
  constructor(toolName: string, reason: string) {
    super(`Tool input validation failed for '${toolName}': ${reason}`);
    this.name = "ToolValidationError";
  }
}
