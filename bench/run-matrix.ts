import type { LLMAdapter } from "../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter, ModelConfig, TaskCategory } from "./types.js";
import { WorldState } from "./world.js";
import { withTelemetry } from "./telemetry.js";

export interface RunRecord {
  model: string;
  harness: string;
  taskId: string;
  category: TaskCategory;
  seed: number;
  success: boolean;
  result: BenchRunResult;
}

export type LlmFactory = (model: ModelConfig, seed: number) => LLMAdapter;

export interface RunMatrixOptions {
  tasks: BenchTask[];
  harnesses: HarnessAdapter[];
  models: ModelConfig[];
  seeds: number[];
  llmFactory: LlmFactory;
  onProgress?: (done: number, total: number, label: string) => void;
}

/** Runs the full ablation matrix sequentially (one local model at a time). */
export async function runMatrix(opts: RunMatrixOptions): Promise<RunRecord[]> {
  const { tasks, harnesses, models, seeds, llmFactory, onProgress } = opts;
  const records: RunRecord[] = [];
  const total = tasks.length * harnesses.length * models.length * seeds.length;
  let done = 0;

  for (const model of models) {
    for (const harness of harnesses) {
      for (const task of tasks) {
        for (const seed of seeds) {
          const world = new WorldState();
          const tools = task.makeTools(world);
          const llm = withTelemetry(llmFactory(model, seed));

          const t0 = Date.now();
          const result = await harness.run(task, llm, tools, { model, seed });
          result.latencyMs = Date.now() - t0;
          // Fallback semantics: out-of-process contestants (smolagents) don't use
          // the in-process llm, so they report their own counts. Only fill from the
          // telemetry decorator when the adapter left them at 0 (in-process harnesses do).
          if (!result.llmCalls) result.llmCalls = llm.stats.llmCalls;
          if (!result.tokens) result.tokens = llm.stats.tokens;

          let success = false;
          try {
            success = task.check(result, world);
          } catch {
            success = false;
          }

          records.push({
            model: model.name,
            harness: harness.name,
            taskId: task.id,
            category: task.category,
            seed,
            success,
            result,
          });
          done++;
          onProgress?.(done, total, `${model.name} / ${harness.name} / ${task.id} / seed=${seed}`);
        }
      }
    }
  }
  return records;
}
