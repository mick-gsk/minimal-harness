/**
 * Offline re-scorer: replays the current facts.ts checks over the full
 * answers persisted in results.jsonl. Deduplicates by (model, harness,
 * think, seed, factId), keeping the LAST entry — smoke runs and re-runs are
 * superseded by later full runs.
 *
 *   npx tsx bench/company/rescore.ts [path/to/results.jsonl]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BINARY_FACTS, FACTS, SYSTEM_FACTS, normalize } from "./facts.js";

const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "results.jsonl");

interface Row {
  model: string;
  harness: string;
  think: boolean;
  /** Deployment-instruction version; absent in early rows = 1. */
  prompt?: number;
  seed: number;
  factId: string;
  typ: string;
  ok: boolean;
  note?: string;
  answer?: string;
}

const byId = new Map([...FACTS, ...SYSTEM_FACTS, ...BINARY_FACTS].map((f) => [f.id, f]));
const latest = new Map<string, Row>();
for (const line of readFileSync(file, "utf8").trim().split("\n")) {
  const row = JSON.parse(line) as Row;
  latest.set(`${row.model}|${row.harness}|${row.think}|${row.prompt ?? 1}|${row.seed}|${row.factId}`, row);
}

const cells = new Map<string, Row[]>();
for (const row of latest.values()) {
  const key = `${row.model} ${row.harness} p${row.prompt ?? 1}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key)!.push(row);
}

for (const [cell, rows] of [...cells.entries()].sort()) {
  const seeds = [...new Set(rows.map((r) => r.seed))].sort();
  const facts = [...new Set(rows.map((r) => r.factId))].sort();
  let passed = 0;
  const byType = new Map<string, { ok: number; total: number }>();
  const flips: string[] = [];
  for (const row of rows) {
    const fact = byId.get(row.factId);
    if (!fact) continue;
    const ok = row.answer !== undefined ? fact.check(normalize(row.answer)) : false;
    if (ok !== row.ok) flips.push(`${row.factId} seed=${row.seed}: ${row.ok} -> ${ok}`);
    if (ok) passed++;
    const bucket = byType.get(fact.typ) ?? { ok: 0, total: 0 };
    bucket.total++;
    if (ok) bucket.ok++;
    byType.set(fact.typ, bucket);
  }
  const total = rows.length;
  console.log(`\n=== ${cell} (${facts.length} Fakten × ${seeds.length} Seeds) ===`);
  console.log(`gesamt: ${passed}/${total} (${((100 * passed) / total).toFixed(0)}%)`);
  for (const [typ, { ok, total: t }] of [...byType.entries()].sort()) console.log(`  ${typ}: ${ok}/${t}`);
  if (flips.length > 0) console.log(`  rekalibriert: ${flips.join("; ")}`);
}
