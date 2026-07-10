/**
 * TTFT probe: measures time-to-first-token (streaming) against total latency
 * (non-streaming) for the same prompt and seed — the measurable UX win of
 * streaming, and evidence that enabling it costs no total latency.
 *
 * Probe only — never writes BENCHMARKS.md.
 *
 * Run against the GPU PC:
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b npx tsx bench/ttft-probe.ts
 */
import { OllamaClient } from "../src/llm/ollama-client.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const RUNS = Number(process.env.TTFT_RUNS ?? 5); // 5: enough for a stable median, cheap on GPU time
const PROMPT = "Explain in about 150 words why local LLMs matter for data privacy.";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

async function main(): Promise<void> {
  const client = new OllamaClient({ baseUrl: BASE_URL, model: MODEL });
  console.log(`\n=== TTFT probe → ${BASE_URL} model=${MODEL} runs=${RUNS} ===\n`);

  const ttfts: number[] = [];
  const streamTotals: number[] = [];
  const blockTotals: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const seed = 1001 + i; // pinned like the bench suites, one seed per run

    const t0 = performance.now();
    let firstToken: number | null = null;
    await client.generate([{ role: "user", content: PROMPT }], {
      seed,
      onToken: () => {
        if (firstToken === null) firstToken = performance.now() - t0;
      },
    });
    const streamTotal = performance.now() - t0;

    const t1 = performance.now();
    await client.generate([{ role: "user", content: PROMPT }], { seed });
    const blockTotal = performance.now() - t1;

    ttfts.push(firstToken ?? streamTotal);
    streamTotals.push(streamTotal);
    blockTotals.push(blockTotal);
    console.log(
      `run ${i + 1}: TTFT ${ttfts[i]!.toFixed(0)} ms · stream total ${streamTotal.toFixed(0)} ms · non-stream total ${blockTotal.toFixed(0)} ms`,
    );
  }

  console.log(`\nmedian TTFT:             ${median(ttfts).toFixed(0)} ms`);
  console.log(`median total (stream):   ${median(streamTotals).toFixed(0)} ms`);
  console.log(`median total (blocking): ${median(blockTotals).toFixed(0)} ms`);
  console.log(
    `\nfirst feedback arrives ${(median(blockTotals) / median(ttfts)).toFixed(1)}x sooner than a blocking response\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
