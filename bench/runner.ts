/**
 * Bench CLI (spec §5): npm run bench
 * Env: BENCH_MODELS="qwen3:8b,llama3.1:8b" OLLAMA_BASE_URL=...
 *      BENCH_SUITE=dev (Tuning, stdout only) | v1 (legacy frozen) | default: suite-v2
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { OllamaClient } from "../src/index.js";
import { DEFAULT_BASE_URL, DEFAULT_MODELS, SEEDS, TEMPERATURE } from "./config.js";
import { suiteV1, SUITE_VERSION } from "./tasks/frozen/suite-v1.js";
import { suiteV2, SUITE_V2_VERSION } from "./tasks/frozen/suite-v2.js";
import { devTasks } from "./tasks/dev.js";
import { minimalHarness } from "./harnesses/minimal.js";
import { ollamaNativeHarness } from "./harnesses/ollama-native.js";
import { naiveHarness } from "./harnesses/naive.js";
import { runMatrix } from "./run-matrix.js";
import { buildReport } from "./reporter.js";
import type { ModelConfig } from "./types.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
const modelNames = (process.env.BENCH_MODELS ?? DEFAULT_MODELS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const suiteEnv = process.env.BENCH_SUITE ?? "v2";
if (!["dev", "v1", "v2"].includes(suiteEnv)) {
  console.error(`✗ Unbekannte BENCH_SUITE '${suiteEnv}' — erlaubt: dev, v1, v2`);
  process.exit(1);
}
const useDev = suiteEnv === "dev";
const tasks = useDev ? devTasks : suiteEnv === "v1" ? suiteV1 : suiteV2;
const suiteLabel = useDev ? "dev (NICHT reportfähig)" : suiteEnv === "v1" ? SUITE_VERSION : SUITE_V2_VERSION;

// Preflight: Ollama reachable? Models present?
const tagsRes = await fetch(`${baseUrl}/api/tags`).catch(() => null);
if (!tagsRes?.ok) {
  console.error(`✗ Ollama nicht erreichbar unter ${baseUrl} — läuft \`ollama serve\`?`);
  process.exit(1);
}
const tags = (await tagsRes.json()) as { models?: { name: string }[] };
const available = new Set((tags.models ?? []).map((m) => m.name));
for (const name of modelNames) {
  if (![...available].some((a) => a === name || a.startsWith(`${name}:`))) {
    console.error(`✗ Modell '${name}' fehlt — installieren mit: ollama pull ${name}`);
    process.exit(1);
  }
}

const models: ModelConfig[] = modelNames.map((name) => ({ name, baseUrl, temperature: TEMPERATURE }));
console.log(`Bench: Suite ${suiteLabel} · Modelle: ${modelNames.join(", ")} · Seeds: ${SEEDS.join(",")}`);

const records = await runMatrix({
  tasks,
  harnesses: [ollamaNativeHarness, naiveHarness, minimalHarness],
  models,
  seeds: SEEDS,
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
  suiteVersion: suiteLabel,
  seeds: SEEDS,
  temperature: TEMPERATURE,
  k: SEEDS.length,
};

mkdirSync("bench/results", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`bench/results/results-${stamp}.json`, JSON.stringify({ meta, records }, null, 2));

if (!useDev) {
  writeFileSync("BENCHMARKS.md", buildReport(records, meta));
  console.log(`✓ BENCHMARKS.md geschrieben (${records.length} Läufe)`);
} else {
  console.log(buildReport(records, meta));
  console.log("⚠ dev-Suite: Report nur auf stdout, BENCHMARKS.md unverändert (spec §4.4b)");
}
