/**
 * Downloads the real BFCL v4 dataset files (Berkeley Function Calling
 * Leaderboard, Apache-2.0) pinned to a fixed upstream commit, so every run
 * scores against byte-identical third-party data.
 *
 *   npx tsx bench/bfcl/fetch.ts
 *
 * Data stays out of git (bench/bfcl/data/ is ignored) — the pin makes it
 * reproducible without vendoring someone else's dataset.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Upstream commit of ShishirPatil/gorilla the suite is pinned to (2026-07). */
export const BFCL_PIN = "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8";

const BASE = `https://raw.githubusercontent.com/ShishirPatil/gorilla/${BFCL_PIN}/berkeley-function-call-leaderboard/bfcl_eval/data`;

export const BFCL_FILES = [
  "BFCL_v4_simple_python.json",
  "possible_answer/BFCL_v4_simple_python.json",
  "BFCL_v4_irrelevance.json",
] as const;

const here = dirname(fileURLToPath(import.meta.url));
export const BFCL_DATA_DIR = join(here, "data");

async function main(): Promise<void> {
  for (const file of BFCL_FILES) {
    const url = `${BASE}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const target = join(BFCL_DATA_DIR, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await res.text());
    console.log(`✓ ${file}`);
  }
  console.log(`Pinned to gorilla@${BFCL_PIN.slice(0, 7)} → ${BFCL_DATA_DIR}`);
}

// Only fetch when executed directly (the suite loader imports the constants).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
