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
  /**
   * Out-of-process contestants (e.g. smolagents) report their own pure agent
   * time here; latencyMs then includes process boot and is not 1:1 comparable
   * to the in-process TS harnesses. Undefined for in-process harnesses.
   */
  agentMs?: number;
  /**
   * Count of integration-seam faults during this run (sidecar spawn/timeout/
   * result parse, bridge HTTP transport). Lets the report separate "harness
   * lost" from "wiring lost". Undefined for in-process harnesses.
   */
  seamErrors?: number;
  error?: string;
}

/**
 * Per-run context passed to a harness alongside the in-process llm. Out-of-process
 * contestants (smolagents) need the model *coordinates* (name/baseUrl/seed/temperature)
 * to reach Ollama themselves; the in-process TS harnesses ignore it.
 */
export interface RunContext {
  model: ModelConfig;
  seed: number;
}

/** One contestant in the ablation matrix (spec §4). */
export interface HarnessAdapter {
  name: "minimal" | "ollama-native" | "naive" | "smolagents-tool" | "smolagents-code";
  run(
    task: BenchTask,
    llm: LLMAdapter,
    tools: ToolDefinition[],
    ctx: RunContext,
  ): Promise<BenchRunResult>;
}

export interface ModelConfig {
  name: string;
  baseUrl: string;
  temperature: number;
}
