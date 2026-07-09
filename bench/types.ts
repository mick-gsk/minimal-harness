import type { ToolDefinition, LLMAdapter } from "../src/index.js";
import type { WorldState } from "./world.js";

export type TaskCategory =
  | "single-tool"
  | "multi-step"
  | "world-state"
  | "no-tool"
  | "error-recovery"
  | "multi-tool";

/** One deterministically scorable benchmark task (spec §4.1). */
export interface BenchTask {
  id: string;
  category: TaskCategory;
  prompt: string;
  maxTurns: number;
  /** Fresh tools per run; may pre-seed the world (e.g. kv fixtures). */
  makeTools(world: WorldState): ToolDefinition[];
  /** Deterministic success check on final answer and/or world state. */
  check(result: BenchRunResult, world: WorldState): boolean;
}

/**
 * Telemetry of a single run. MVP deviation from spec §4.1: instead of
 * parseFailures/recoveries (would need core instrumentation) we record
 * llmCalls — llmCalls minus turns approximates retry effort.
 */
export interface BenchRunResult {
  finalAnswer: string | null;
  terminatedReason: string;
  turns: number;
  llmCalls: number;
  /** prompt+completion tokens summed from Ollama's eval counts; 0 if unknown. */
  tokens: number;
  latencyMs: number;
  toolCallCount: number;
  error?: string;
}

/** One contestant in the ablation matrix (spec §4). */
export interface HarnessAdapter {
  name: "minimal" | "ollama-native" | "naive";
  run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult>;
}

export interface ModelConfig {
  name: string;
  baseUrl: string;
  temperature: number;
}
