/**
 * BFCL suite loader: real third-party tasks for the ablation matrix.
 *
 * Subset per category: the FIRST N entries in file order — a deterministic
 * slice with no cherry-picking. 50 for simple/irrelevance (CI widths
 * comparable to suite-v2), 25 for multiple/parallel (multi-call tasks cost
 * several turns each; 25 keeps a two-model probe in the same wall-clock
 * budget as before the expansion).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchTask } from "../types.js";
import {
  buildBfclTasks,
  type BfclEntry,
  type BfclGroundTruth,
} from "./convert.js";
import { BFCL_DATA_DIR, BFCL_FILES, BFCL_PIN } from "./fetch.js";

const SIMPLE_COUNT = 50;
const IRRELEVANCE_COUNT = 50;
const MULTIPLE_COUNT = 25;
const PARALLEL_COUNT = 25;

export const BFCL_SUITE_VERSION =
  `bfcl-v4@${BFCL_PIN.slice(0, 7)} (simple_python ${SIMPLE_COUNT} + irrelevance ${IRRELEVANCE_COUNT} ` +
  `+ multiple ${MULTIPLE_COUNT} + parallel ${PARALLEL_COUNT}, erste N in Dateireihenfolge)`;

/** BFCL files are JSON Lines: one object per line. */
function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function bfclDataPresent(): boolean {
  return BFCL_FILES.every((f) => existsSync(join(BFCL_DATA_DIR, f)));
}

/** Joins question entries with their ground truths, first `count` in file order. */
function loadCategory(
  file: string,
  count: number,
): Array<{ entry: BfclEntry; groundTruth: BfclGroundTruth }> {
  const entries = readJsonl<BfclEntry>(join(BFCL_DATA_DIR, file));
  const answers = readJsonl<{ id: string; ground_truth: BfclGroundTruth }>(
    join(BFCL_DATA_DIR, "possible_answer", file),
  );
  const answerById = new Map(answers.map((a) => [a.id, a.ground_truth]));
  return entries.slice(0, count).map((entry) => {
    const groundTruth = answerById.get(entry.id);
    if (!groundTruth) throw new Error(`Keine ground_truth für ${entry.id}`);
    return { entry, groundTruth };
  });
}

export function loadBfclSuite(): BenchTask[] {
  if (!bfclDataPresent()) {
    throw new Error(
      "BFCL-Daten fehlen — einmalig herunterladen mit: npx tsx bench/bfcl/fetch.ts",
    );
  }

  const irrelevance = readJsonl<BfclEntry>(join(BFCL_DATA_DIR, "BFCL_v4_irrelevance.json"));

  return buildBfclTasks({
    simple: loadCategory("BFCL_v4_simple_python.json", SIMPLE_COUNT),
    irrelevance: irrelevance.slice(0, IRRELEVANCE_COUNT).map((entry) => ({ entry })),
    multiple: loadCategory("BFCL_v4_multiple.json", MULTIPLE_COUNT),
    parallel: loadCategory("BFCL_v4_parallel.json", PARALLEL_COUNT),
  });
}
