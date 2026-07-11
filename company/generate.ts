/**
 * Generates the company into company/out/.
 *
 *   npx tsx company/generate.ts
 *
 * Deterministic by construction: no Math.random, no Date.now, no Intl. Running it twice
 * produces the same logical content; `npx tsx company/verify.ts` proves it.
 *
 * company/out/ is gitignored (bench/bfcl/data precedent): bulk is generated, not vendored.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalJson, sha256 } from "./lib/canon.js";
import { encodeCp1252 } from "./lib/cp1252.js";
import { buildAclsCsv, buildGroupsCsv, buildUsersCsv } from "./emit/ad.js";
import { renderThread } from "./emit/eml.js";
import { buildStaleExport2019, writeErpDatabase } from "./emit/erp.js";
import { CP1252_KINDS, writeDocuments, writeRelative, writeWindowsDebris } from "./emit/fileserver.js";
import type { WrittenFile } from "./emit/fileserver.js";
import { FIXTURES, VENDORED } from "./fixtures/index.js";
import { buildWorldWithStats, stripBodies } from "./model/index.js";
import type { DocumentFact, World } from "./model/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

/**
 * The corpus and the truth live in separate trees, and that separation is load-bearing.
 *
 * world.json restates every fact in plain text, including the price that is supposed to
 * exist in exactly one mail. Anyone pointing an ingestion pipeline at company/out/ would
 * hand the agent the answer key and measure nothing. So: ingest out/corpus/, grade against
 * out/truth/. Never index the latter.
 */
const CORPUS = join(OUT, "corpus");
const TRUTH = join(OUT, "truth");

export interface ManifestEntry {
  readonly path: string;
  readonly system: string;
  readonly kind: string;
  readonly format: string;
  readonly encoding: "utf-8" | "windows-1252" | "binary";
  readonly sizeBytes: number;
  readonly sha256: string | null;
  readonly ownerId: string | null;
  readonly sensitivity: string;
  readonly hasTextLayer: boolean;
  readonly derivedFrom: readonly string[];
  readonly supersededBy: string | null;
  readonly isDistractor: boolean;
}

function main(): void {
  rmSync(OUT, { recursive: true, force: true });

  const { world, mess } = buildWorldWithStats();
  const written: WrittenFile[] = [];
  const docByPath = new Map<string, DocumentFact>(world.documents.map((d) => [d.path, d]));

  // 1. The fileserver: hand-authored documents plus the Windows debris around them.
  written.push(...writeDocuments(CORPUS, world.documents));
  written.push(...writeWindowsDebris(CORPUS));

  // 2. Mail. UTF-8; the encoding trap lives on the ERP/DATEV exports where it is authentic.
  for (const thread of world.mailThreads) {
    const bytes = Buffer.from(renderThread(thread), "utf8");
    writeRelative(CORPUS, thread.path, bytes);
    written.push({ path: thread.path, bytes });
  }

  // 3. The hero fixtures. Committed binaries, copied byte-for-byte — never reconverted, so
  //    the generator needs no LibreOffice and stays deterministic.
  for (const fixture of FIXTURES) {
    const source = join(HERE, "fixtures", "bin", `${fixture.source}.${fixture.target}`);
    if (!existsSync(source)) {
      throw new Error(`Fixture fehlt: ${source} — erst \`bash company/fixtures/build.sh\` laufen lassen`);
    }
    const bytes = readFileSync(source);
    writeRelative(CORPUS, fixture.corpusPath, bytes);
    written.push({ path: fixture.corpusPath, bytes });
  }

  // 3b. The vendored statute. Not authored here, and the only file in the corpus that is not.
  for (const entry of VENDORED) {
    const source = join(HERE, "fixtures", "vendored", entry.source);
    if (!existsSync(source)) {
      throw new Error(`Vendored fehlt: ${source} — erst \`npx tsx company/fixtures/vendor.ts\` laufen lassen`);
    }
    const bytes = readFileSync(source);
    writeRelative(CORPUS, entry.corpusPath, bytes);
    written.push({ path: entry.corpusPath, bytes });
  }

  // 4. The ERP, plus the stale 2019 export that contradicts it.
  const sqlitePath = join(CORPUS, "erp", "erp.sqlite");
  const erp = writeErpDatabase(world, sqlitePath);
  written.push({ path: "erp/erp.sqlite", bytes: readFileSync(sqlitePath) });
  const staleExport = encodeCp1252(buildStaleExport2019(world));
  writeRelative(CORPUS, "erp/export_2019.csv", staleExport);
  written.push({ path: "erp/export_2019.csv", bytes: staleExport });

  // 4. Active Directory and NTFS. CP1252, as PowerShell's Export-Csv writes it by default.
  for (const [path, text] of [
    ["ad/users.csv", buildUsersCsv(world.employees)],
    ["ad/groups.csv", buildGroupsCsv(world.adGroups)],
    ["ad/acls.csv", buildAclsCsv(world.acls, world.shares)],
  ] as const) {
    const bytes = encodeCp1252(text);
    writeRelative(CORPUS, path, bytes);
    written.push({ path, bytes });
  }

  // 5. The canonical truth. Never inside corpus/ — it restates every fact in plain text.
  const worldJson = canonicalJson(stripBodies(world) as unknown as never, 2);
  writeRelative(TRUTH, "world.json", Buffer.from(worldJson, "utf8"));
  writeRelative(TRUTH, "erp.sql", Buffer.from(erp.sqlDump, "utf8"));

  // 6. The manifest: one descriptor per corpus file. Paths are relative to corpus/.
  const manifest: ManifestEntry[] = written
    .map((file) => describe(file, docByPath, world))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeRelative(TRUTH, "manifest.json", Buffer.from(canonicalJson(manifest as unknown as never, 2), "utf8"));

  const logicalHash = sha256(`${worldJson}\n${erp.sqlDump}`);
  writeRelative(TRUTH, "LOGICAL-HASH.txt", Buffer.from(`${logicalHash}\n`, "utf8"));

  const bytes = manifest.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  console.log(`company/out/corpus  ${manifest.length} Dateien, ${(bytes / 1e6).toFixed(1)} MB\n`);
  console.log(`  Mitarbeiter        ${world.employees.length} (Betriebsrat: ${world.employees.filter((e) => e.isBetriebsrat).length})`);
  console.log(`  Kunden/Lieferanten ${world.customers.length}/${world.suppliers.length}`);
  console.log(`  Artikel/Werkzeuge  ${world.articles.length}/${world.tools.length}`);
  console.log(`  Aufträge           ${world.orders.length} (ERP-Rechnungen ${world.invoices.length}, Lieferscheine ${world.deliveries.length})`);
  console.log(`  Maschinen/Wartung  ${world.machines.length}/${world.maintenance.length}`);
  console.log(`  Dokumente          ${world.documents.length} (Distraktoren ${world.documents.filter((d) => d.isDistractor).length})`);
  console.log(`  Mails              ${world.mailThreads.length}`);
  console.log(`  Unordnung          ${mess.renamed} umbenannt, ${mess.duplicated} Dubletten, ${mess.mojibaked} Mojibake`);
  console.log(`  Inkonsistenzen     ${world.inconsistencies.length}`);
  console.log(`\n  Logischer Hash     ${logicalHash}`);
}

function describe(file: WrittenFile, docByPath: Map<string, DocumentFact>, world: World): ManifestEntry {
  const doc = docByPath.get(file.path);
  const thread = world.mailThreads.find((t) => t.path === file.path);
  const system = file.path.startsWith("fileserver/") ? "Fileserver FS01"
    : file.path.startsWith("mail/") ? "Exchange"
    : file.path.startsWith("erp/") ? "ERP (Altsystem/abas)"
    : file.path.startsWith("ad/") ? "Active Directory"
    : file.path.startsWith("dms/") ? "DocuWare"
    : file.path.startsWith("bde/") ? "BDE (Maschinendatenerfassung)"
    : file.path.startsWith("datev/") ? "DATEV (Steuerberater)"
    : file.path.startsWith("pdm/") ? "SolidWorks PDM"
    : "sonstige";

  const isSqlite = file.path.endsWith(".sqlite");
  const isOffice = /\.(docx|xlsx|pdf)$/.test(file.path);
  const isBinary = isSqlite || isOffice || file.path.includes("~$") || file.path.endsWith("Thumbs.db");
  const isCp1252 = file.path.startsWith("ad/") || file.path === "erp/export_2019.csv"
    || (doc !== undefined && CP1252_KINDS.has(doc.kind));

  /**
   * SQLite embeds SQLITE_VERSION in its header, so the same logical database yields
   * different bytes on a different Node build. Hashing it would make the manifest lie
   * about reproducibility. Its logical content is hashed via truth/erp.sql instead.
   */
  const digest = isSqlite ? null : sha256(file.bytes);

  if (doc) {
    return {
      path: file.path, system, kind: doc.kind, format: doc.format,
      encoding: isBinary ? "binary" : isCp1252 ? "windows-1252" : "utf-8",
      sizeBytes: file.bytes.length, sha256: digest,
      ownerId: doc.ownerId, sensitivity: doc.sensitivity, hasTextLayer: doc.hasTextLayer,
      derivedFrom: doc.derivedFrom, supersededBy: doc.supersededBy, isDistractor: doc.isDistractor,
    };
  }
  if (thread) {
    return {
      path: file.path, system, kind: "Mailthread", format: "eml", encoding: "utf-8",
      sizeBytes: file.bytes.length, sha256: digest,
      ownerId: null, sensitivity: "internal", hasTextLayer: true,
      derivedFrom: [thread.id], supersededBy: null, isDistractor: false,
    };
  }
  return {
    path: file.path, system,
    kind: isSqlite ? "Datenbank" : isBinary ? "Systemdatei" : "Export",
    format: file.path.slice(file.path.lastIndexOf(".") + 1),
    encoding: isBinary ? "binary" : isCp1252 ? "windows-1252" : "utf-8",
    sizeBytes: file.bytes.length,
    sha256: digest,
    ownerId: null, sensitivity: "internal", hasTextLayer: !isBinary,
    derivedFrom: [], supersededBy: null, isDistractor: false,
  };
}

main();
