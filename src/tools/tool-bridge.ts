import type { ToolDefinition, ToolCallRequest, ToolExecutionRecord, ToolBridge } from "../types/tool.js";
import { validateToolInput } from "./schema.js";
import { ToolNotFoundError, ToolValidationError } from "../utils/errors.js";

export class DefaultToolBridge implements ToolBridge {
  private readonly registry = new Map<string, ToolDefinition>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.registry.set(tool.name, tool as ToolDefinition);
  }

  list(): ToolDefinition[] {
    return Array.from(this.registry.values());
  }

  async execute(request: ToolCallRequest): Promise<ToolExecutionRecord> {
    const tool = this.registry.get(request.toolName);
    const executedAt = Date.now();

    if (!tool) {
      throw new ToolNotFoundError(request.toolName);
    }

    const validationError = validateToolInput(request.arguments, tool.inputSchema);
    if (validationError) {
      throw new ToolValidationError(request.toolName, validationError);
    }

    try {
      const output = await tool.execute(request.arguments);
      return { toolName: request.toolName, arguments: request.arguments, output, executedAt };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { toolName: request.toolName, arguments: request.arguments, error, executedAt };
    }
  }
}
