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
import { loadBfclSuite, BFCL_SUITE_VERSION } from "./bfcl/suite.js";
import { minimalHarness } from "./harnesses/minimal.js";
import { ollamaNativeHarness } from "./harnesses/ollama-native.js";
import { naiveHarness } from "./harnesses/naive.js";
import { smolagentsToolHarness, smolagentsCodeHarness, smolagentsAvailable } from "./harnesses/smolagents.js";
import { runMatrix } from "./run-matrix.js";
import { buildReport } from "./reporter.js";
import type { ModelConfig } from "./types.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
const modelNames = (process.env.BENCH_MODELS ?? DEFAULT_MODELS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const suiteEnv = process.env.BENCH_SUITE ?? "v2";
if (!["dev", "v1", "v2", "bfcl"].includes(suiteEnv)) {
  console.error(`✗ Unbekannte BENCH_SUITE '${suiteEnv}' — erlaubt: dev, v1, v2, bfcl`);
  process.exit(1);
}
const useDev = suiteEnv === "dev";
const tasks =
  suiteEnv === "dev" ? devTasks
  : suiteEnv === "v1" ? suiteV1
  : suiteEnv === "bfcl" ? loadBfclSuite()
  : suiteV2;

// BENCH_SEEDS overrides the default seeds (e.g. "1001" for a quick probe).
// Non-default seeds make the run a PROBE: report to stdout only, never
// BENCHMARKS.md — official numbers always use the full default seed set.
const seeds = process.env.BENCH_SEEDS
  ? process.env.BENCH_SEEDS.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  : SEEDS;
const isProbe = seeds.join(",") !== SEEDS.join(",");
if (seeds.length === 0) {
  console.error(`✗ BENCH_SEEDS enthält keine gültigen Zahlen`);
  process.exit(1);
}

const concurrency = Math.max(1, Number(process.env.BENCH_CONCURRENCY ?? "3") || 1);

const suiteBase =
  useDev ? "dev (NICHT reportfähig)"
  : suiteEnv === "v1" ? SUITE_VERSION
  : suiteEnv === "bfcl" ? BFCL_SUITE_VERSION
  : SUITE_V2_VERSION;
const suiteLabel = isProbe && !useDev ? `${suiteBase} PROBE (NICHT reportfähig, Seeds abweichend)` : suiteBase;

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

// smolagents is an optional out-of-process contestant: only zugeschaltet via
// BENCH_SMOLAGENTS, so the normal bench stays free of any Python dependency.
// "1" = both variants; "tool" = ToolCallingAgent only; "code" = CodeAgent only
// (HF's recommended default and the library's actual thesis).
const smolagentsMode = process.env.BENCH_SMOLAGENTS;
const harnesses = [ollamaNativeHarness, naiveHarness, minimalHarness];
if (smolagentsMode) {
  if (!["1", "tool", "code"].includes(smolagentsMode)) {
    console.error(`✗ Unbekannter BENCH_SMOLAGENTS-Wert '${smolagentsMode}' — erlaubt: 1, tool, code`);
    process.exit(1);
  }
  if (!smolagentsAvailable()) {
    console.error(
      "✗ BENCH_SMOLAGENTS gesetzt, aber Python-venv/Sidecar fehlt — einrichten:\n" +
        "  python3 -m venv bench/smolagents/.venv && \\\n" +
        "  bench/smolagents/.venv/bin/pip install -r bench/smolagents/requirements.txt",
    );
    process.exit(1);
  }
  if (smolagentsMode !== "code") harnesses.push(smolagentsToolHarness);
  if (smolagentsMode !== "tool") harnesses.push(smolagentsCodeHarness);
}

console.log(
  `Bench: Suite ${suiteLabel} · Modelle: ${modelNames.join(", ")} · ` +
    `Harnesses: ${harnesses.map((h) => h.name).join(", ")} · Seeds: ${seeds.join(",")} · ` +
    `Concurrency: ${concurrency}`,
);

const records = await runMatrix({
  tasks,
  harnesses,
  models,
  seeds,
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
  suiteVersion: suiteLabel,
  seeds,
  temperature: TEMPERATURE,
  k: seeds.length,
};

mkdirSync("bench/results", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`bench/results/results-${stamp}.json`, JSON.stringify({ meta, records }, null, 2));

// BFCL gets its own report file so a v2 run never overwrites BFCL numbers
// (and vice versa) — the two suites carry different claims.
const reportFile = suiteEnv === "bfcl" ? "BENCHMARKS-BFCL.md" : "BENCHMARKS.md";
if (!useDev && !isProbe) {
  writeFileSync(reportFile, buildReport(records, meta));
  console.log(`✓ ${reportFile} geschrieben (${records.length} Läufe)`);
} else {
  console.log(buildReport(records, meta));
  console.log(
    useDev
      ? "⚠ dev-Suite: Report nur auf stdout, BENCHMARKS.md unverändert (spec §4.4b)"
      : "⚠ PROBE (abweichende Seeds): Report nur auf stdout, BENCHMARKS.md unverändert",
  );
}
