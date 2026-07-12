export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Optional GDPR Art. 30 metadata for a tool (Verzeichnis von
 * Verarbeitungstätigkeiten). Purely declarative: it never affects execution,
 * so every existing tool stays valid without it. Feeds GET /v1/compliance/vvt.
 */
export interface ToolManifest {
  /** Purpose of the processing this tool performs (Art. 30(1)(b)). */
  purpose: string;
  /** Categories of personal data touched, e.g. "Kundenstammdaten" (Art. 30(1)(c)). */
  dataCategories: string[];
  /** Recipients the data may flow to, e.g. an ERP system (Art. 30(1)(d)). */
  recipients?: string[];
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: TInput): Promise<TOutput>;
  /** Optional VVT/Art. 30 metadata; undeclared tools surface as a gap in the report. */
  manifest?: ToolManifest;
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
