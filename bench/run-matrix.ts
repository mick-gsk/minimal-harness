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
  /**
   * Parallel workers (default 1 = sequential). With concurrency > 1 the
   * per-run latencyMs includes GPU contention and is not comparable to
   * sequential runs — record order stays deterministic either way.
   */
  concurrency?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

interface Combo {
  index: number;
  model: ModelConfig;
  harness: HarnessAdapter;
  task: BenchTask;
  seed: number;
}

/**
 * Runs the full ablation matrix. Records are returned in deterministic
 * model → harness → task → seed order regardless of concurrency.
 */
export async function runMatrix(opts: RunMatrixOptions): Promise<RunRecord[]> {
  const { tasks, harnesses, models, seeds, llmFactory, onProgress } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  const combos: Combo[] = [];
  for (const model of models) {
    for (const harness of harnesses) {
      for (const task of tasks) {
        for (const seed of seeds) {
          combos.push({ index: combos.length, model, harness, task, seed });
        }
      }
    }
  }

  const records: RunRecord[] = new Array<RunRecord>(combos.length);
  let done = 0;

  const runOne = async (c: Combo): Promise<void> => {
    const world = new WorldState();
    const tools = c.task.makeTools(world);
    const llm = withTelemetry(llmFactory(c.model, c.seed));

    const t0 = Date.now();
    const result = await c.harness.run(c.task, llm, tools, { model: c.model, seed: c.seed });
    result.latencyMs = Date.now() - t0;
    // Fallback semantics: out-of-process contestants (smolagents) don't use
    // the in-process llm, so they report their own counts. Only fill from the
    // telemetry decorator when the adapter left them at 0 (in-process harnesses do).
    if (!result.llmCalls) result.llmCalls = llm.stats.llmCalls;
    if (!result.tokens) result.tokens = llm.stats.tokens;

    let success = false;
    try {
      success = c.task.check(result, world);
    } catch {
      success = false;
    }

    records[c.index] = {
      model: c.model.name,
      harness: c.harness.name,
      taskId: c.task.id,
      category: c.task.category,
      seed: c.seed,
      success,
      result,
    };
    done++;
    onProgress?.(done, combos.length, `${c.model.name} / ${c.harness.name} / ${c.task.id} / seed=${c.seed}`);
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, combos.length) }, async () => {
    for (;;) {
      const next = combos[cursor++];
      if (!next) return;
      await runOne(next);
    }
  });
  await Promise.all(workers);

  return records;
}
