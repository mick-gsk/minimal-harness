/**
 * Verifies the generated company.
 *
 *   npx tsx company/verify.ts
 *
 * Three classes of check:
 *
 *   INTEGRITÄT      — the world rebuilds identically; the manifest covers every file; every
 *                     ground-truth source resolves; the truth tree never leaks into the corpus.
 *   ANTI-POTEMKIN   — the corpus has the properties a too-clean generated corpus lacks:
 *                     unanswerable questions, contradictions without an authority, documents
 *                     no question references, a confusable firm, decay, high length variance.
 *   DSGVO           — the access-control findings are derived from the exported ACLs.
 *
 * Exit code 1 on any failure, so this is usable as a gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { canonicalJson, sha256 } from "./lib/canon.js";
import { decodeCp1252 } from "./lib/cp1252.js";
import { FIXTURES, VENDORED } from "./fixtures/index.js";
import { TRIBAL_PRICE_TOKEN, WINDOW_DAYS } from "./model/catalog.js";
import { buildWorld, stripBodies } from "./model/index.js";
import { BDE_PERSONAL_FROM } from "./model/systems.js";
import { DISTRACTOR_FIRM, REVENUE_EUR } from "./seed.config.js";
import { computeFindings, groupFindings } from "./acl-report.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const CORPUS = join(OUT, "corpus");
const TRUTH = join(OUT, "truth");

interface TruthFact {
  readonly id: string;
  readonly typ: "beantwortbar" | "widerspruch" | "tribal" | "unbeantwortbar";
  readonly quellen: readonly string[];
  readonly irrefuehrend?: readonly string[];
  readonly autoritativ?: string | null;
}

interface ManifestEntry {
  readonly path: string;
  readonly kind: string;
  readonly encoding: string;
  readonly sizeBytes: number;
  readonly sha256: string | null;
  readonly isDistractor: boolean;
  readonly hasTextLayer: boolean;
}

interface SystemFact {
  readonly id: string;
  readonly typ: string;
  readonly wert: unknown;
  readonly quellen: readonly string[];
  readonly irrefuehrend?: readonly string[];
}

/**
 * Counts text-drawing operators in a PDF's content streams.
 *
 * The decisive question for "does this file have a text layer" is whether any glyph is ever
 * DRAWN, i.e. whether a `Tj` or `TJ` operator runs. It is NOT whether a /Font resource is
 * present: LibreOffice Draw embeds one even into a PDF that contains nothing but a bitmap,
 * so the naive check reports a text layer on a scan. Operators only ever follow a string
 * `(...)`, a hex string `<...>` or an array `[...]`, which is what the regex anchors on.
 */
function pdfTextOperators(pdf: Buffer): number {
  const latin1 = pdf.toString("latin1");
  let operators = 0;
  let cursor = 0;
  for (;;) {
    const start = latin1.indexOf("stream", cursor);
    if (start === -1) break;
    let body = start + "stream".length;
    if (latin1[body] === "\r") body++;
    if (latin1[body] === "\n") body++;
    const end = latin1.indexOf("endstream", body);
    if (end === -1) break;

    const raw = Buffer.from(latin1.slice(body, end), "latin1");
    let data: Buffer;
    try {
      data = inflateSync(raw);
    } catch {
      data = raw; // Uncompressed stream, or an image filter we cannot and need not decode.
    }
    operators += (data.toString("latin1").match(/[)\]>]\s*T[jJ]/g) ?? []).length;
    cursor = end + "endstream".length;
  }
  return operators;
}

const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  console.log(`  ${condition ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function main(): void {
  if (!existsSync(CORPUS)) {
    console.error("company/out fehlt. Erst `npx tsx company/generate.ts` laufen lassen.");
    process.exit(1);
  }

  const world = buildWorld();
  const manifest = JSON.parse(readFileSync(join(TRUTH, "manifest.json"), "utf8")) as ManifestEntry[];
  const facts = readFileSync(join(HERE, "truth", "facts.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TruthFact);
  const corpusFiles = walk(CORPUS).map((p) => relative(CORPUS, p).split("\\").join("/"));

  // One pass over the corpus; 2000+ files should not be read three times. Binary files are
  // excluded — reading a .docx as UTF-8 would produce bytes that look like mojibake.
  const BINARY = /\.(sqlite|docx|xlsx|pdf|db)$|~\$/;
  const contents = new Map<string, string>();
  for (const path of corpusFiles) {
    if (BINARY.test(path)) continue;
    contents.set(path, readFileSync(join(CORPUS, path)).toString("utf8"));
  }

  console.log("\nINTEGRITÄT\n");

  const worldJson = canonicalJson(stripBodies(world) as unknown as never, 2);
  check("world rebuilds byte-identically from the seed",
    worldJson === readFileSync(join(TRUTH, "world.json"), "utf8"));

  /**
   * The fact model must agree with itself. Order count is derived from revenue and average
   * order value; if the quantities are drawn with a biased mean, the invoices in the ERP
   * will not add back up to the stated revenue — and an auditor reading world.json against
   * erp.sqlite would catch it immediately. So we catch it first.
   */
  const invoiced = world.invoices.reduce((sum, invoice) => sum + invoice.netEur, 0);
  const perYear = invoiced / (WINDOW_DAYS / 365.25);
  const drift = Math.abs(perYear - REVENUE_EUR) / REVENUE_EUR;
  check("ERP invoices add back up to the stated annual revenue (±5 %)", drift < 0.05,
    `${(perYear / 1e6).toFixed(1)} Mio EUR/Jahr vs. ${(REVENUE_EUR / 1e6).toFixed(1)} — Abweichung ${(drift * 100).toFixed(1)} %`);

  const erpSql = readFileSync(join(TRUTH, "erp.sql"), "utf8");
  const expected = readFileSync(join(TRUTH, "LOGICAL-HASH.txt"), "utf8").trim();
  check("logical hash matches world.json + erp.sql",
    sha256(`${worldJson}\n${erpSql}`) === expected, expected.slice(0, 16));

  check("manifest covers every corpus file", manifest.length === corpusFiles.length,
    `${manifest.length} / ${corpusFiles.length}`);

  const missing = manifest.filter((entry) => !corpusFiles.includes(entry.path));
  check("every manifest entry exists on disk", missing.length === 0,
    missing.slice(0, 3).map((m) => m.path).join(", "));

  const allSources = facts.flatMap((f) => [...f.quellen, ...(f.irrefuehrend ?? [])]);
  const dangling = allSources.filter((source) => !existsSync(join(OUT, source)));
  check("every ground-truth source resolves to a file", dangling.length === 0, dangling.join(", "));

  const leaked = corpusFiles.filter((p) => /world\.json|manifest\.json|LOGICAL-HASH/.test(p));
  check("no truth artifact leaked into the corpus", leaked.length === 0, leaked.join(", "));

  const tribalHits = [...contents].filter(([, text]) => text.includes(TRIBAL_PRICE_TOKEN));
  check(`tribal price "${TRIBAL_PRICE_TOKEN}" occurs in exactly one corpus file`,
    tribalHits.length === 1, tribalHits.map(([p]) => p).join(", "));

  // The design claim: OUR invoices and delivery notes are ERP rows, never files.
  // (An incoming supplier's delivery note sitting in Scans/ is a scan, and belongs there.)
  const ourBelege = manifest.filter((e) => e.kind === "Rechnung" || e.kind === "Lieferschein");
  check("no Rechnungen or Lieferscheine as documents (they are ERP rows)",
    ourBelege.length === 0, ourBelege.slice(0, 3).map((e) => e.path).join(", "));

  console.log("\nHERO-FIXTURES (Formatvielfalt)\n");

  /**
   * Fable 5's bench/company/probe.ts grades against facts.jsonl. Adding facts there would
   * silently move its goalposts mid-measurement, so the binary questions live in a separate
   * file and this invariant pins the original count.
   */
  check("facts.jsonl still holds exactly 16 facts (Fable 5's probe grades against it)",
    facts.length === 16, `${facts.length} Fakten`);

  const missingFixtures = FIXTURES.filter((f) => !corpusFiles.includes(f.corpusPath));
  check(`all ${FIXTURES.length} hero fixtures reached the corpus`, missingFixtures.length === 0,
    missingFixtures.map((f) => f.corpusPath).join(", "));

  // Magic bytes: a .docx/.xlsx is a ZIP ("PK"), a .pdf starts with "%PDF-".
  const badMagic = FIXTURES.filter((fixture) => {
    const head = readFileSync(join(CORPUS, fixture.corpusPath)).subarray(0, 5);
    return fixture.target === "pdf"
      ? head.toString("latin1") !== "%PDF-"
      : head.subarray(0, 2).toString("latin1") !== "PK";
  });
  check("every fixture carries the right magic bytes (PK / %PDF-)", badMagic.length === 0,
    badMagic.map((f) => f.source).join(", "));

  /**
   * LibreOffice output is not byte-stable across versions, so the binaries are committed and
   * never reconverted by generate.ts. CHECKSUMS.txt catches an accidental rebuild or a
   * corrupted file — without it, a silent drift would go unnoticed.
   */
  const checksumFile = join(HERE, "fixtures", "CHECKSUMS.txt");
  if (existsSync(checksumFile)) {
    const drifted = readFileSync(checksumFile, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .filter((line) => {
        const [expectedHash, name] = line.trim().split(/\s+/);
        if (!expectedHash || !name) return false;
        const binary = join(HERE, "fixtures", "bin", name);
        return !existsSync(binary) || sha256(readFileSync(binary)) !== expectedHash;
      });
    check("committed fixture binaries match CHECKSUMS.txt", drifted.length === 0,
      drifted.slice(0, 2).join(" | "));
  } else {
    check("CHECKSUMS.txt exists (run company/fixtures/build.sh)", false);
  }

  // Match against the registry, not the extension: `~$gebot_Wittenbrink.docx` is a Word
  // lock file, not a document, and it also ends in .docx.
  const fixturePaths = new Set(FIXTURES.map((f) => f.corpusPath));
  const binaryEntries = manifest.filter((entry) => fixturePaths.has(entry.path) && entry.encoding === "binary");
  check("the manifest marks every hero fixture as binary", binaryEntries.length === FIXTURES.length,
    `${binaryEntries.length} von ${FIXTURES.length}`);

  const binaryFacts = readFileSync(join(HERE, "truth", "binary-facts.jsonl"), "utf8")
    .split("\n").filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { quellen: readonly string[] });
  const binaryDangling = binaryFacts.flatMap((f) => f.quellen).filter((s) => !existsSync(join(OUT, s)));
  check("every binary-fact source resolves to a file", binaryDangling.length === 0,
    binaryDangling.join(", "));
  check("binary facts only cite binary documents",
    binaryFacts.every((f) => f.quellen.every((s) => /\.(docx|xlsx|pdf)$/.test(s))));

  /**
   * The README claims the born-digital PDFs carry a text layer and the scans do not. Until
   * now that was a claim. Counting Tj/TJ operators turns it into a proof — and it is the only
   * criterion that works, because every one of these PDFs embeds a /Font resource.
   */
  const pdfOps = FIXTURES.filter((f) => f.target === "pdf").map((fixture) => ({
    fixture,
    ops: pdfTextOperators(readFileSync(join(CORPUS, fixture.corpusPath))),
  }));
  const textPdfs = pdfOps.filter((p) => p.fixture.scan !== true);
  const scanPdfs = pdfOps.filter((p) => p.fixture.scan === true);
  check("every born-digital PDF actually draws text (Tj/TJ operators)",
    textPdfs.every((p) => p.ops > 0),
    `${textPdfs.length} PDFs, ${Math.min(...textPdfs.map((p) => p.ops))}-${Math.max(...textPdfs.map((p) => p.ops))} Operatoren`);
  check("every scan draws NONE — it is pixels, not text",
    scanPdfs.length >= 1 && scanPdfs.every((p) => p.ops === 0),
    `${scanPdfs.length} Scans`);
  check("a /Font resource proves nothing — the scans carry one too",
    scanPdfs.every((p) => readFileSync(join(CORPUS, p.fixture.corpusPath)).toString("latin1").includes("/Font")));

  const noTextLayer = manifest.filter((entry) => !entry.hasTextLayer && entry.path.endsWith(".pdf"));
  check("the manifest declares at least one PDF without a text layer", noTextLayer.length >= 1,
    noTextLayer.map((e) => e.path.split("/").pop()).join(", "));

  console.log("\nSYSTEME (DMS, BDE, DATEV, PDM)\n");

  const systemFacts = readFileSync(join(HERE, "truth", "system-facts.jsonl"), "utf8")
    .split("\n").filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SystemFact);
  const systemDangling = systemFacts
    .flatMap((f) => [...f.quellen, ...(f.irrefuehrend ?? [])])
    .filter((source) => !existsSync(join(OUT, source)));
  check("every system-fact source resolves to a file", systemDangling.length === 0,
    systemDangling.join(", "));
  const fact = (id: string): SystemFact => {
    const found = systemFacts.find((f) => f.id === id);
    if (!found) throw new Error(`system fact ${id} fehlt`);
    return found;
  };

  const corpusSet = new Set(corpusFiles);
  const dmsRows = decodeCp1252(readFileSync(join(CORPUS, "dms", "docuware-index.csv")))
    .split("\r\n").slice(1).filter((line) => line.length > 0)
    .map((line) => line.split(";"));
  const dmsTargets = dmsRows.map((row) => (row[5] ?? "").replace(/^K:\\/, "fileserver/").replace(/\\/g, "/"));
  const rotted = dmsTargets.filter((path) => !corpusSet.has(path));

  /**
   * Index rot, and nobody wrote it: DocuWare recorded the bulk documents' paths at capture
   * time, then the mess injector renamed some of them. The count is a JOIN between an
   * exported CSV and the filesystem — it appears in no document, and README_Migration.txt
   * says as much.
   */
  check("the DocuWare index has dangling entries nobody authored", rotted.length >= 20,
    `${rotted.length} von ${dmsRows.length} Einträgen laufen ins Leere`);
  check("system-facts records the dangling count that was actually produced",
    fact("s01").wert === rotted.length, `s01 = ${String(fact("s01").wert)}, gemessen ${rotted.length}`);
  check("DocuWare captured nothing after the rollout stalled",
    dmsRows.every((row) => (row[1] ?? "") < "2025-08-01"),
    `letzte Erfassung ${dmsRows.map((r) => r[1] ?? "").sort().pop() ?? "-"}`);
  check("DocuWare covers only part of the fileserver",
    dmsRows.length / manifest.filter((e) => e.path.startsWith("fileserver/")).length < 0.5,
    `${dmsRows.length} von ${manifest.filter((e) => e.path.startsWith("fileserver/")).length} Dateien`);

  const bdeHeaders = corpusFiles
    .filter((path) => path.startsWith("bde/") && path.endsWith(".csv"))
    .sort()
    .map((path) => ({
      month: path.slice(-11, -4),
      header: decodeCp1252(readFileSync(join(CORPUS, path))).split("\r\n")[0] ?? "",
    }));
  check("the BDE export gains a Personalnummer column exactly when the works council says",
    bdeHeaders.every((f) => f.header.includes("Personalnummer") === (f.month >= BDE_PERSONAL_FROM)),
    bdeHeaders.map((f) => `${f.month}:${f.header.includes("Personalnummer") ? "pb" : "-"}`).join(" "));
  check("and it still carries it after the works council resolved to suspend it",
    bdeHeaders.at(-1)?.header.includes("Personalnummer") === true,
    `letzter Export ${bdeHeaders.at(-1)?.month ?? "-"}`);

  const datevRows = decodeCp1252(readFileSync(join(CORPUS, "datev", "EXTF_Buchungsstapel_2025.csv")))
    .split("\r\n").slice(2).filter((line) => line.length > 0);
  const invoices2025 = world.invoices.filter((invoice) => invoice.issuedIso.startsWith("2025"));
  check("the DATEV Buchungsstapel matches the ERP's 2025 invoices",
    datevRows.length === invoices2025.length,
    `${datevRows.length} Buchungen, ${invoices2025.length} Rechnungen`);

  const pdmRows = decodeCp1252(readFileSync(join(CORPUS, "pdm", "cad-index.csv")))
    .split("\r\n").slice(1).filter((line) => line.length > 0);
  const misfiled = pdmRows.filter((row) => /^W-\d+$/.test(row.split(";")[3] ?? ""));
  const articlesWithTool = new Set(world.tools.map((tool) => tool.articleId)).size;
  check("the PDM index carries a tool number where a drawing number belongs",
    misfiled.length === articlesWithTool && misfiled.length > 0,
    `${misfiled.length} von ${pdmRows.length} Artikeln`);
  check("system-facts records the count the PDM index actually holds",
    fact("s04").wert === misfiled.length);
  // mail:0004's "rund 1.400" is the IT-Leiter's stale estimate from the retired Sage export.
  // If the generated count ever drifted onto it, the contradiction would silently vanish.
  check("the mail's stale estimate of 1.400 still contradicts the index",
    misfiled.length !== 1400, `Index: ${misfiled.length}, Mail: 1.400`);

  console.log("\nANTI-POTEMKIN\n");

  const unanswerable = facts.filter((f) => f.typ === "unbeantwortbar");
  check("at least 2 unanswerable questions (hallucination probe)", unanswerable.length >= 2,
    `${unanswerable.length} Stück`);
  check("unanswerable questions cite no source", unanswerable.every((f) => f.quellen.length === 0));

  const noAuthority = facts.filter((f) => f.typ === "widerspruch" && f.autoritativ === null);
  check("at least 1 contradiction with no authoritative source", noAuthority.length >= 1,
    noAuthority.map((f) => f.id).join(", "));

  const referenced = new Set(allSources.map((s) => s.replace(/^corpus\//, "")));
  const unreferenced = corpusFiles.filter((p) => !referenced.has(p));
  check("at least 1000 documents referenced by no question",
    unreferenced.length >= 1000, `${unreferenced.length} von ${corpusFiles.length}`);

  // Retrieval must be non-trivial: a corpus small enough for brute-force reading proves nothing.
  check("corpus large enough that retrieval is not trivial", corpusFiles.length >= 1500,
    `${corpusFiles.length} Dateien`);

  // The signal-carrying set stays small enough for a human to audit.
  const signalShare = referenced.size / corpusFiles.length;
  check("ground-truth sources are under 1 % of the corpus", signalShare < 0.01,
    `${referenced.size} Quellen = ${(signalShare * 100).toFixed(2)} %`);

  check("the confusable distractor firm appears in the corpus",
    [...contents.values()].some((text) => text.includes(DISTRACTOR_FIRM.name)), DISTRACTOR_FIRM.name);

  /**
   * Non-author entropy. Every other byte here was written by the person who also wrote the
   * questions; real legal German is prose no generator imitates. The two provisions checked
   * are the ones the company's own documents hang off: § 9 gives BETRIEBSRAT_SIZE = 7, and
   * § 87 Abs. 1 Nr. 6 is what the works council cites against the BDE evaluation.
   */
  const statute = contents.get(VENDORED[0]?.corpusPath ?? "") ?? "";
  check("the vendored statute is present and carries its provenance header",
    statute.includes("§ 5 Abs. 1 UrhG") && statute.includes("gesetze-im-internet.de"),
    `${(statute.length / 1024).toFixed(0)} KB Fremdautoren-Text`);
  check("it states the bracket BETRIEBSRAT_SIZE is derived from",
    statute.includes("101 bis 200 Arbeitnehmern aus 7 Mitgliedern"));
  check("it states the provision the works council cites (§ 87 Abs. 1 Nr. 6)",
    /6\. Einführung und Anwendung von technischen Einrichtungen/.test(statute));

  const unanswerableSystem = systemFacts.filter((f) => f.typ === "unbeantwortbar");
  check("the scan folder question stays unanswerable (no OCR is faked)",
    unanswerableSystem.length >= 1 && unanswerableSystem.every((f) => f.quellen.length === 0),
    unanswerableSystem.map((f) => f.id).join(", "));

  // Decay: a drive in use since 1958 has chaotic names, stray copies and one bad conversion.
  const chaotic = corpusFiles.filter((p) => /final_final|Kopie von| \(2\)| - Kopie|_ALT\.|bitte prüfen|korrigiert/.test(p));
  check("at least 100 files carry a chaotic human filename", chaotic.length >= 100, `${chaotic.length} Dateien`);

  const digests = new Map<string, number>();
  for (const entry of manifest) {
    if (entry.sha256 === null) continue;
    digests.set(entry.sha256, (digests.get(entry.sha256) ?? 0) + 1);
  }
  const duplicatePairs = [...digests.values()].filter((n) => n > 1).length;
  check("at least 20 byte-identical duplicate files", duplicatePairs >= 20, `${duplicatePairs} Gruppen`);

  const mojibaked = [...contents.values()].filter((text) => /Ã¤|Ã¶|Ã¼|ÃŸ|Ã„|Ã–|Ãœ/.test(text));
  check("at least 10 files carry mojibake from a bad conversion", mojibaked.length >= 10,
    `${mojibaked.length} Dateien`);

  /**
   * Uniform document lengths are the classic generator tell. Two things must hold, and only
   * the second one is hard.
   *
   * The spread is measured over exactly the documents the GENERATOR wrote — not the binary
   * fixtures, and above all not the 172 KB vendored statute, whose single outlying size
   * would push any coefficient past any threshold on its own and make the check assert
   * nothing. That is not hypothetical: with the statute included the coefficient reads 6.7,
   * and a corpus of byte-identical documents would have sailed through.
   */
  const vendoredPaths = new Set(VENDORED.map((v) => v.corpusPath));
  const generated = manifest.filter((e) =>
    e.path.startsWith("fileserver/") && e.encoding !== "binary" && !vendoredPaths.has(e.path));
  const cv = (values: readonly number[]): number => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / mean;
  };

  // Across kinds: an 8D report is not the length of a leave request. sd above half the mean
  // means document lengths routinely differ by a factor of two.
  check("document lengths vary across the corpus (CV > 0.5)", cv(generated.map((e) => e.sizeBytes)) > 0.5,
    `CV = ${cv(generated.map((e) => e.sizeBytes)).toFixed(2)} über ${generated.length} Textdateien`);

  /**
   * Within a kind: the check that actually bites. The corpus-wide coefficient only measures
   * the MIXTURE of document kinds, which is derived from the business model — it stays above
   * 0.5 even when every Angebot is a byte-for-byte template. A shape that accounts for a
   * tenth of the drive must not be a template, or chunking and retrieval behave nothing like
   * they would on a real fileserver.
   */
  const byKind = new Map<string, number[]>();
  for (const entry of generated) {
    const sizes = byKind.get(entry.kind) ?? [];
    sizes.push(entry.sizeBytes);
    byKind.set(entry.kind, sizes);
  }
  const dominant = [...byKind].filter(([, sizes]) => sizes.length / generated.length >= 0.1);
  const templated = dominant.filter(([, sizes]) => cv(sizes) <= 0.12);
  check("no document kind that dominates the corpus is a template", templated.length === 0,
    dominant.map(([kind, sizes]) => `${kind} ${cv(sizes).toFixed(2)}`).join(", "));

  console.log("\nDSGVO-BEFUNDE (berechnet, nicht behauptet)\n");
  const findings = computeFindings();
  for (const group of groupFindings(findings)) {
    const folder = `K:\\${group.onFolder.replace(/\//g, "\\")}`.padEnd(26);
    console.log(`  ${folder} ${group.grantedTo} (${group.rights})`.padEnd(72) +
      `${group.fileCount} x ${group.sensitivity}`);
  }
  console.log("");
  check("ACL delta finds the world-readable salary export",
    findings.some((f) => f.file.endsWith("Gehaltsliste_2026.csv") && f.grantedTo === "Domänen-Benutzer"));
  check("ACL delta finds HR access to the works council minutes",
    findings.some((f) => f.file.includes("Betriebsrat/Protokolle") && f.grantedTo === "GG_Personal"));
  check("personnel files are NOT flagged (their folder is correctly restricted)",
    !findings.some((f) => f.file.includes("Personal/Personalakten")));

  /**
   * The worst finding in the corpus, and the one no reader in this repo can reach: a scanned
   * sick note in a folder every domain user may write to. Its filename says "Scan_0003", it
   * has no text layer, and mail:0007 explains how it got there. The report finds it through
   * the manifest's classification — an agent restricted to the corpus cannot, and that gap
   * is the point rather than an oversight.
   */
  check("ACL delta finds the health-data scan in the world-writable Scans folder",
    findings.some((f) => f.sensitivity === "special-category" && f.onFolder === "Scans"
      && f.grantedTo === "Domänen-Benutzer"));

  /**
   * Emergent, not scripted: the mess injector copies files into the dumping folders without
   * knowing what they contain. Some of those copies are personnel files and works council
   * minutes, and they land in folders every domain user can write to. Nobody authored this
   * finding — it falls out of "people copy things" meeting "the ACL was never reviewed".
   * It is the single most realistic thing in the corpus, so it gets an invariant.
   */
  const dumpingGrounds = /^fileserver\/(Austausch|Scans|_ALT|Grothe)\//;
  const strayConfidential = findings.filter((f) => dumpingGrounds.test(f.file));
  check("stray copies of confidential files sit in world-accessible folders",
    strayConfidential.length >= 1,
    `${strayConfidential.length} Datei(en), z.B. ${strayConfidential[0]?.file ?? "-"}`);

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} Prüfung(en) fehlgeschlagen:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`Alle Prüfungen bestanden. ${corpusFiles.length} Korpus-Dateien, ${facts.length} Wahrheits-Fakten.`);
}

main();
