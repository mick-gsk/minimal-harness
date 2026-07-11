// Core
export { DefaultAgentLoop } from "./core/agent-loop.js";
export { DefaultPromptBuilder } from "./core/prompt-builder.js";
export { parseAssistantOutput } from "./core/output-parser.js";
export { AgentStateMachine } from "./core/state-machine.js";

// LLM
export { OllamaClient } from "./llm/ollama-client.js";
export { adapterFromFn } from "./llm/llm-adapter.js";
export { OpenAiCompatAdapter } from "./llm/openai-compat.js";
export type { OpenAiCompatConfig } from "./llm/openai-compat.js";
export { LMStudioAdapter } from "./llm/lmstudio-adapter.js";
export { LlamaCppAdapter } from "./llm/llamacpp-adapter.js";

// Memory
export { InMemoryMemory } from "./memory/in-memory.js";
export { SqliteMemory } from "./memory/sqlite-memory.js";
export { extractiveSummary } from "./memory/summarizer.js";

// Tools
export { DefaultToolBridge } from "./tools/tool-bridge.js";
export { validateToolInput } from "./tools/schema.js";
export { clockTool } from "./tools/builtins/clock.js";
export { calculatorTool } from "./tools/builtins/calculator.js";
export { textUtilsTool } from "./tools/builtins/text-utils.js";

// Guardrails
export { StructuredOutputValidator } from "./guardrails/validator.js";
export { defaultPolicy, isToolAllowed } from "./guardrails/policy.js";
export { defaultRetryStrategy } from "./guardrails/retries.js";

// Utils
export { AgentError, ToolNotFoundError, ToolValidationError } from "./utils/errors.js";
export { safeParseJson } from "./utils/json.js";
export { logger } from "./utils/logger.js";

// RAG / knowledge base
export { OllamaEmbedder } from "./rag/embedder.js";
export type { Embedder, OllamaEmbedderConfig } from "./rag/embedder.js";
export { SqliteKnowledgeStore } from "./rag/knowledge-store.js";
export type { KnowledgeHit } from "./rag/knowledge-store.js";
export { makeKnowledgeSearchTool } from "./tools/builtins/knowledge.js";

// Server
export { createAgentServer } from "./server/agent-server.js";
export type { AgentServerOptions } from "./server/agent-server.js";
export { ApiKeyAuth } from "./server/auth.js";

// Compliance — audit log (AI Act Art. 12/19/26(6), NIS2) + AI disclosure (Art. 50)
export { AuditLog, DEFAULT_RETENTION_DAYS } from "./audit/audit-log.js";
export type {
  AuditEventType,
  AuditEventInput,
  AuditRow,
  VerifyResult,
  AuditExportFilter,
  AuditLogOptions,
} from "./audit/audit-log.js";
export { withAudit } from "./audit/with-audit.js";
export type { AuditContext } from "./audit/with-audit.js";

// Types
export type { AgentLoop, AgentLoopInput, AgentLoopResult, AgentTurn } from "./types/agent.js";
export type { Memory, MemoryRecord, MemoryState } from "./types/memory.js";
export type { ToolDefinition, ToolBridge, ToolCallRequest, ToolExecutionRecord, ToolInputSchema } from "./types/tool.js";
export type { LLMAdapter, ChatMessage, LLMGenerateOptions, LLMResponse } from "./types/llm.js";
export type { OutputValidator, ValidationResult, ParsedAssistantOutput, GuardrailPolicy } from "./types/guardrails.js";
export type { AgentConfig, OllamaClientConfig } from "./types/config.js";
export type { PromptBuilder, PromptContext } from "./core/prompt-builder.js";
