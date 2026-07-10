/**
 * Prompt ablation probe (NICHT reportfähig — stdout + results json only).
 *
 * Question it answers: does minimal's uplift belong to its mechanisms
 * (1-call cap, error feedback, retry, robust parser) or to a system prompt
 * that happens to fit the in-house suite? Three variants of the system
 * instruction, everything else identical. If the uplift holds across
 * variants, the win is mechanism, not prompt fit.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 BENCH_MODELS="qwen3:8b,llama3.1" \
 *     npx tsx bench/prompt-ablation.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { OllamaClient } from "../src/index.js";
import { DEFAULT_BASE_URL, DEFAULT_MODELS, TEMPERATURE } from "./config.js";
import { suiteV2 } from "./tasks/frozen/suite-v2.js";
import { loadBfclSuite } from "./bfcl/suite.js";
import { makeMinimalHarness, SYSTEM_INSTRUCTION } from "./harnesses/minimal.js";
import { runMatrix } from "./run-matrix.js";
import { buildReport } from "./reporter.js";
import type { ModelConfig } from "./types.js";

// Seed 1001 matches today's suite-v2 probes so the default variant is
// directly comparable against the existing minimal/ollama-native numbers.
const SEED = 1001;

const VARIANTS = [
  { name: "minimal@default", instruction: SYSTEM_INSTRUCTION },
  // No tool guidance at all — the protocol block injected by the prompt
  // builder is the harness's own scaffold and stays.
  { name: "minimal@bare", instruction: "You are a helpful assistant." },
  // Same content as default, deliberately different wording — measures
  // sensitivity to formulation rather than content.
  {
    name: "minimal@paraphrase",
    instruction:
      "Solve the user's task. Tools are available; when you need one, invoke a single tool " +
      "and wait for its output before deciding your next step.",
  },
] as const;

// BENCH_SUITE=v2 (default) | bfcl — prompt fit matters most on neutral
// terrain, so the ablation must be runnable on both.
const suiteEnv = process.env.BENCH_SUITE ?? "v2";
if (!["v2", "bfcl"].includes(suiteEnv)) {
  console.error(`✗ Unbekannte BENCH_SUITE '${suiteEnv}' — erlaubt: v2, bfcl`);
  process.exit(1);
}
const tasks = suiteEnv === "bfcl" ? loadBfclSuite() : suiteV2;

const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
const modelNames = (process.env.BENCH_MODELS ?? DEFAULT_MODELS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const concurrency = Math.max(1, Number(process.env.BENCH_CONCURRENCY ?? "4") || 1);

const models: ModelConfig[] = modelNames.map((name) => ({ name, baseUrl, temperature: TEMPERATURE }));
const harnesses = VARIANTS.map((v) => makeMinimalHarness(v.name, v.instruction));

console.log(
  `Prompt-Ablation (PROBE): suite-v2 · Modelle: ${modelNames.join(", ")} · ` +
    `Varianten: ${VARIANTS.map((v) => v.name).join(", ")} · Seed: ${SEED} · Concurrency: ${concurrency}`,
);

const records = await runMatrix({
  tasks,
  harnesses,
  models,
  seeds: [SEED],
  concurrency,
  llmFactory: (model, seed) =>
    new OllamaClient({
      baseUrl: model.baseUrl,
      model: model.name,
      defaultTemperature: model.temperature,
      defaultSeed: seed,
    }),
  onProgress: (done, total, label) => console.log(`[${done}/${total}] ${label}`),
});

const meta = {
  date: new Date().toISOString().slice(0, 10),
  suiteVersion: `${suiteEnv} PROMPT-ABLATION PROBE (NICHT reportfähig)`,
  seeds: [SEED],
  temperature: TEMPERATURE,
  k: 1,
};

mkdirSync("bench/results", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(
  `bench/results/prompt-ablation-${stamp}.json`,
  JSON.stringify({ meta, records }, null, 2),
);

console.log(buildReport(records, meta));
console.log("⚠ PROBE: Report nur auf stdout, BENCHMARKS.md unverändert");
