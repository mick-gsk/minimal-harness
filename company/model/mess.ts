/**
 * Mess injectors.
 *
 * A generated corpus is a film set unless it decays like a real one. Applied only to the
 * generated bulk — never to the hand-authored documents in narrative.ts, whose exact paths
 * and contents are referenced by truth/facts.jsonl.
 *
 * Deterministic: the decision for each document is drawn from a seeded stream keyed by the
 * document's position, so the same seed decays the same files.
 */
import { MESS_RATES } from "../seed.config.js";
import type { Rng } from "../lib/rand.js";
import type { DocumentFact } from "./types.js";

/** How a human renames a file when the process does not tell them how to. */
const NAME_MUTATIONS: ReadonlyArray<(base: string) => string> = [
  (base) => `${base}_final`,
  (base) => `${base}_final_final_v3_NEU`,
  (base) => `Kopie von ${base}`,
  (base) => `${base} (2)`,
  (base) => `${base}_ALT`,
  (base) => `${base} - Kopie`,
  (base) => `${base}_Änderung`,
  (base) => `${base}_bitte prüfen`,
  (base) => `${base}_v2 (korrigiert)`,
];

/** Where a copied file ends up: the dumping grounds, never a structured folder. */
const DUPLICATE_HOMES: readonly string[] = [
  "fileserver/Austausch",
  "fileserver/_ALT",
  "fileserver/Grothe/Angebote_2019",
  "fileserver/Scans",
];

/**
 * Double-encoded UTF-8: bytes were read as Latin-1 and re-encoded. "Prüfung" becomes
 * "PrÃ¼fung". One bad conversion during the 2016 server migration and nobody fixed it.
 */
export function mojibake(text: string): string {
  return Buffer.from(text, "utf8").toString("latin1");
}

function splitPath(path: string): { dir: string; base: string; ext: string } {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return {
    dir,
    base: dot === -1 ? file : file.slice(0, dot),
    ext: dot === -1 ? "" : file.slice(dot),
  };
}

export interface MessStats {
  readonly renamed: number;
  readonly duplicated: number;
  readonly mojibaked: number;
}

export function injectMess(rng: Rng, docs: readonly DocumentFact[]): {
  documents: DocumentFact[];
  stats: MessStats;
} {
  const taken = new Set(docs.map((doc) => doc.path));
  const out: DocumentFact[] = [];
  const duplicates: DocumentFact[] = [];
  let renamed = 0;
  let mojibaked = 0;

  for (const doc of docs) {
    let next = doc;

    if (rng.chance(MESS_RATES.chaoticName)) {
      const { dir, base, ext } = splitPath(doc.path);
      const candidate = `${dir}/${rng.pick(NAME_MUTATIONS)(base)}${ext}`;
      if (!taken.has(candidate)) {
        taken.delete(doc.path);
        taken.add(candidate);
        next = { ...next, path: candidate };
        renamed++;
      }
    }

    if (next.body !== undefined && rng.chance(MESS_RATES.mojibake)) {
      next = { ...next, body: mojibake(next.body) };
      mojibaked++;
    }

    out.push(next);

    // A duplicate is byte-identical and lives somewhere it does not belong.
    if (rng.chance(MESS_RATES.duplicate)) {
      const { base, ext } = splitPath(next.path);
      const home = rng.pick(DUPLICATE_HOMES);
      const candidate = `${home}/${rng.chance(0.5) ? "Kopie von " : ""}${base}${ext}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        duplicates.push({
          ...next,
          id: `${next.id}-kopie`,
          path: candidate,
          // A stray copy answers no question and belongs to nobody.
          isDistractor: true,
          ownerId: null,
        });
      }
    }
  }

  return {
    documents: [...out, ...duplicates],
    stats: { renamed, duplicated: duplicates.length, mojibaked },
  };
}
