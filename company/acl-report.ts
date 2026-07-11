/**
 * ACL delta report.
 *
 *   npx tsx company/acl-report.ts
 *
 * Reads the EXPORTED acls.csv from the corpus — not the fact model — and joins it against
 * the sensitivity classes in the manifest and the access rules from the Verzeichnis von
 * Verarbeitungstätigkeiten. Every finding below is therefore DERIVED from the corpus.
 * A finding that were merely asserted in the fact model would prove nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { decodeCp1252 } from "./lib/cp1252.js";
import { ALLOWED_GROUPS } from "./model/narrative.js";
import type { Sensitivity } from "./model/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "out", "corpus");
const TRUTH = join(HERE, "out", "truth");

interface ManifestEntry {
  readonly path: string;
  readonly sensitivity: string;
}

interface AclRow {
  /** Share-relative path, POSIX separators: "Personal/Gehaelter". */
  readonly path: string;
  readonly group: string;
  readonly rights: string;
}

export interface Finding {
  readonly file: string;
  readonly sensitivity: Sensitivity;
  readonly grantedTo: string;
  readonly onFolder: string;
  readonly rights: string;
}

function parseAcls(): AclRow[] {
  const text = decodeCp1252(readFileSync(join(CORPUS, "ad", "acls.csv")));
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [rawPath, identity, rights] = line.split(";");
      if (!rawPath || !identity || !rights) throw new Error(`bad ACL row: ${line}`);
      return {
        path: rawPath.replace(/^[A-Z]:\\/, "").replace(/\\/g, "/"),
        group: identity.slice(identity.indexOf("\\") + 1),
        rights,
      };
    });
}

/** NTFS inheritance: a grant on a parent folder applies to everything beneath it. */
function grantsFor(acls: readonly AclRow[], shareRelativePath: string): AclRow[] {
  return acls.filter(
    (acl) => shareRelativePath === acl.path || shareRelativePath.startsWith(`${acl.path}/`),
  );
}

export function computeFindings(): Finding[] {
  const acls = parseAcls();
  const manifest = JSON.parse(readFileSync(join(TRUTH, "manifest.json"), "utf8")) as ManifestEntry[];
  const findings: Finding[] = [];

  for (const entry of manifest) {
    if (!entry.path.startsWith("fileserver/")) continue;
    const sensitivity = entry.sensitivity as Sensitivity;
    if (sensitivity !== "personal-data" && sensitivity !== "special-category") continue;

    const shareRelative = entry.path.slice("fileserver/".length);
    const allowed = new Set(ALLOWED_GROUPS[sensitivity]);
    for (const grant of grantsFor(acls, shareRelative)) {
      if (!allowed.has(grant.group)) {
        findings.push({
          file: entry.path,
          sensitivity,
          grantedTo: grant.group,
          onFolder: grant.path,
          rights: grant.rights,
        });
      }
    }
  }
  return findings;
}

export interface GroupedFinding {
  readonly onFolder: string;
  readonly grantedTo: string;
  readonly rights: string;
  readonly sensitivity: Sensitivity;
  readonly fileCount: number;
  readonly examples: readonly string[];
}

/**
 * One row per (folder, group, protection class). Listing 31 works-council minutes
 * individually is noise — but a folder that leaks personnel files AND health data leaks two
 * different things, and collapsing them into one row would hide the worse of the two.
 */
export function groupFindings(findings: readonly Finding[]): GroupedFinding[] {
  const buckets = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.onFolder}|${finding.grantedTo}|${finding.sensitivity}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(finding);
    else buckets.set(key, [finding]);
  }
  return [...buckets.values()]
    .map((bucket) => {
      const first = bucket[0];
      if (!first) throw new Error("empty bucket");
      return {
        onFolder: first.onFolder,
        grantedTo: first.grantedTo,
        rights: first.rights,
        sensitivity: first.sensitivity,
        fileCount: bucket.length,
        examples: bucket.slice(0, 2).map((f) => f.file),
      };
    })
    .sort((a, b) => b.fileCount - a.fileCount);
}

function main(): void {
  const findings = computeFindings();
  console.log("ACL-Delta — Soll (Verzeichnis von Verarbeitungstätigkeiten) gegen Ist (NTFS)\n");
  if (findings.length === 0) {
    console.log("Keine Abweichung gefunden.");
    return;
  }
  const grouped = groupFindings(findings);
  for (const finding of grouped) {
    console.log(`  BEFUND  K:\\${finding.onFolder.replace(/\//g, "\\")}`);
    console.log(`          Schutzklasse : ${finding.sensitivity}`);
    console.log(`          Gewährt an   : ${finding.grantedTo} (${finding.rights})`);
    console.log(`          Zulässig     : ${ALLOWED_GROUPS[finding.sensitivity].join(", ")}`);
    console.log(`          Betroffen    : ${finding.fileCount} Datei(en), z.B. ${finding.examples.join(", ")}\n`);
  }
  console.log(
    `${grouped.length} Abweichung(en) über ${findings.length} Datei(en). ` +
    "Quelle: corpus/ad/acls.csv + truth/manifest.json.",
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && fileURLToPath(import.meta.url) === resolve(entryPoint)) {
  main();
}
