/**
 * Writes the flat-ODF sources for the hero documents.
 *
 *   npx tsx company/fixtures/author.ts
 *
 * Then run company/fixtures/build.sh to convert them into the committed binaries.
 * This script is authoring tooling — company/generate.ts never calls it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SPREADSHEETS, TEXT_DOCUMENTS } from "./content.js";
import { FIXTURES } from "./index.js";
import { toFods, toFodt } from "./odf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "src");

function main(): void {
  mkdirSync(SRC, { recursive: true });
  let written = 0;

  for (const fixture of FIXTURES) {
    if (fixture.target === "xlsx") {
      const sheets = SPREADSHEETS[fixture.source];
      if (!sheets) throw new Error(`no spreadsheet content for ${fixture.source}`);
      writeFileSync(join(SRC, `${fixture.source}.fods`), toFods(sheets), "utf8");
    } else {
      const blocks = TEXT_DOCUMENTS[fixture.source];
      if (!blocks) throw new Error(`no text content for ${fixture.source}`);
      writeFileSync(join(SRC, `${fixture.source}.fodt`), toFodt(blocks), "utf8");
    }
    written++;
  }

  const byTarget = FIXTURES.reduce<Record<string, number>>((acc, f) => {
    acc[f.target] = (acc[f.target] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`${written} ODF-Quellen nach company/fixtures/src/ geschrieben`);
  console.log(`  Ziele: ${Object.entries(byTarget).map(([t, n]) => `${n}x ${t}`).join(", ")}`);
  console.log(`\nWeiter mit: bash company/fixtures/build.sh`);
}

main();
