export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: TInput): Promise<TOutput>;
}

export interface ToolCallRequest {
  toolName: string;
  arguments: unknown;
}

export interface ToolExecutionRecord {
  toolName: string;
  arguments: unknown;
  output?: unknown;
  error?: string;
  executedAt: number;
}

export interface ToolBridge {
  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void;
  list(): ToolDefinition[];
  execute(request: ToolCallRequest): Promise<ToolExecutionRecord>;
}
