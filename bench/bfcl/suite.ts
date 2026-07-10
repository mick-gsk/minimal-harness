/**
 * BFCL suite loader: real third-party tasks for the ablation matrix.
 *
 * Subset: the FIRST 50 entries of simple_python and the FIRST 50 of
 * irrelevance, in file order — a deterministic slice with no cherry-picking
 * (50 each keeps a k=1 probe in the ~30-minute range on qwen3:8b while giving
 * CI widths comparable to suite-v2).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchTask } from "../types.js";
import {
  buildBfclTasks,
  type BfclEntry,
  type BfclGroundTruth,
} from "./convert.js";
import { BFCL_DATA_DIR, BFCL_PIN } from "./fetch.js";

const SIMPLE_COUNT = 50;
const IRRELEVANCE_COUNT = 50;

export const BFCL_SUITE_VERSION = `bfcl-v4@${BFCL_PIN.slice(0, 7)} (simple_python ${SIMPLE_COUNT} + irrelevance ${IRRELEVANCE_COUNT}, erste N in Dateireihenfolge)`;

/** BFCL files are JSON Lines: one object per line. */
function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function bfclDataPresent(): boolean {
  return (
    existsSync(join(BFCL_DATA_DIR, "BFCL_v4_simple_python.json")) &&
    existsSync(join(BFCL_DATA_DIR, "possible_answer", "BFCL_v4_simple_python.json")) &&
    existsSync(join(BFCL_DATA_DIR, "BFCL_v4_irrelevance.json"))
  );
}

export function loadBfclSuite(): BenchTask[] {
  if (!bfclDataPresent()) {
    throw new Error(
      "BFCL-Daten fehlen — einmalig herunterladen mit: npx tsx bench/bfcl/fetch.ts",
    );
  }

  const simple = readJsonl<BfclEntry>(join(BFCL_DATA_DIR, "BFCL_v4_simple_python.json"));
  const answers = readJsonl<{ id: string; ground_truth: BfclGroundTruth }>(
    join(BFCL_DATA_DIR, "possible_answer", "BFCL_v4_simple_python.json"),
  );
  const irrelevance = readJsonl<BfclEntry>(join(BFCL_DATA_DIR, "BFCL_v4_irrelevance.json"));

  const answerById = new Map(answers.map((a) => [a.id, a.ground_truth]));

  const simpleInputs = simple.slice(0, SIMPLE_COUNT).map((entry) => {
    const groundTruth = answerById.get(entry.id);
    if (!groundTruth) throw new Error(`Keine ground_truth für ${entry.id}`);
    return { entry, groundTruth };
  });

  return buildBfclTasks({
    simple: simpleInputs,
    irrelevance: irrelevance.slice(0, IRRELEVANCE_COUNT).map((entry) => ({ entry })),
  });
}
