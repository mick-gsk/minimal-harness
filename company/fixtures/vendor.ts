/**
 * Fetches the vendored statute and converts it to plain text.
 *
 *   npx tsx company/fixtures/vendor.ts
 *
 * Authoring tooling, run once. company/generate.ts never invokes it; it copies the
 * committed snapshot under fixtures/vendored/, which is why the generator needs no network
 * and stays deterministic.
 *
 * WHY a vendored statute at all — anti-Potemkin. Every other byte in the corpus was written
 * by the same author who also wrote the questions. Real legal German is entropy no generator
 * produces: nested subsection numbering, "im Sinne des Absatzes 2 Satz 3", a table of
 * bracketed headcounts. Without it, a retriever that has learned this author's cadence would
 * be measuring itself.
 *
 * WHY the BetrVG and not the DSGVO, as originally planned: EUR-Lex answers CELEX requests
 * with HTTP 202 and an empty body (a bot wall), for HTML, ELI and PDF alike. And the BetrVG
 * is the better fit anyway — it is the statute the works council dispute in this company
 * actually turns on (§ 87 Abs. 1 Nr. 6, BDE), and § 9 is where BETRIEBSRAT_SIZE comes from.
 *
 * LICENCE: Gesetze sind amtliche Werke und nach § 5 Abs. 1 UrhG gemeinfrei. Quelle ist das
 * XML-Angebot des Bundesministeriums der Justiz / juris GmbH.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "vendored");

const SOURCE_URL = "https://www.gesetze-im-internet.de/betrvg/xml.zip";
const RETRIEVED_ON = "2026-07-10";

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "vendor-"));
  try {
    const zip = join(work, "xml.zip");
    execFileSync("curl", ["-sL", "--fail", "--max-time", "60", "-o", zip, SOURCE_URL]);
    execFileSync("unzip", ["-o", "-q", zip, "-d", work]);
    const xmlName = execFileSync("ls", [work]).toString().split("\n").find((n) => n.endsWith(".xml"));
    if (!xmlName) throw new Error("kein XML im Archiv");

    const xml = readFileSync(join(work, xmlName), "utf8");
    const text = render(xml);

    mkdirSync(OUT_DIR, { recursive: true });
    const target = join(OUT_DIR, "BetrVG.txt");
    writeFileSync(target, text, "utf8");
    console.log(`${target}\n  ${Buffer.byteLength(text, "utf8")} Bytes, ${text.split("\n").length} Zeilen`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Every <norm> becomes a section: its enbez ("§ 9"), its titel, then its paragraphs. */
function render(xml: string): string {
  const meta = {
    jurabk: first(xml, /<jurabk>([^<]*)<\/jurabk>/) ?? "BetrVG",
    langue: first(xml, /<langue>([^<]*)<\/langue>/) ?? "",
    stand: [...xml.matchAll(/<standkommentar>([\s\S]*?)<\/standkommentar>/g)]
      .map((m) => plain(m[1] ?? "")).join("; "),
    builddate: first(xml, /builddate="(\d{8})/) ?? "",
  };

  const lines: string[] = [
    "HERKUNFT UND LIZENZ DIESER DATEI",
    "================================",
    `Werk    : ${meta.langue} (${meta.jurabk})`,
    `Stand   : ${meta.stand}`,
    `Quelle  : ${SOURCE_URL}`,
    `Abgerufen: ${RETRIEVED_ON} (Build-Datum der Quelle: ${meta.builddate})`,
    "Lizenz  : Amtliches Werk, gemeinfrei nach § 5 Abs. 1 UrhG.",
    "",
    "Dies ist die einzige Datei dieses Korpus, die NICHT erfunden ist. Alle anderen",
    "Dokumente, Personen und Zahlen sind synthetisch — siehe HINWEIS_SYNTHETISCHE_DATEN.txt.",
    "Der Text wurde aus dem XML-Angebot maschinell in Klartext überführt; maßgeblich ist",
    "allein die amtliche Verkündung im Bundesgesetzblatt.",
    "",
    "",
    meta.langue,
    "=".repeat(meta.langue.length),
    "",
  ];

  for (const norm of xml.split("<norm ").slice(1)) {
    const enbez = first(norm, /<enbez>([\s\S]*?)<\/enbez>/);
    const titel = first(norm, /<titel[^>]*>([\s\S]*?)<\/titel>/);
    const gliederung = first(norm, /<gliederungsbez>([\s\S]*?)<\/gliederungsbez>/);
    const gliederungTitel = first(norm, /<gliederungstitel>([\s\S]*?)<\/gliederungstitel>/);
    const content = first(norm, /<text format="XML"><Content>([\s\S]*?)<\/Content>/);

    if (gliederung || gliederungTitel) {
      lines.push("", `--- ${[gliederung, gliederungTitel].filter((part): part is string => part !== undefined).map(plain).join(" ")} ---`, "");
    }
    if (!enbez && !content) continue;

    const heading = [enbez, titel].filter((part): part is string => part !== undefined).map(plain).join(" ");
    if (heading) lines.push("", heading, "");
    if (content) lines.push(...paragraphs(content));
  }

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}

const ITEM = "";

/**
 * A <P> may nest a <DL> (the numbered subsections) or a <table>. Stripping tags naively
 * would run "§ 87 Abs. 1 Nr. 6" together with Nr. 5 and Nr. 7 into one wall of text, and
 * Nr. 6 is exactly the provision this company's works council dispute cites. So list items
 * and table rows are turned into their own indented lines before the tags come off.
 */
function paragraphs(content: string): string[] {
  const blocks = content.match(/<P\b[\s\S]*?<\/P>/g) ?? [];
  return blocks.flatMap((block) =>
    block
      .replace(/<DT>/g, `\n${ITEM}`)
      .replace(/<\/DT>/g, " ")
      .replace(/<\/DD>/g, "\n")
      .replace(/<row[^>]*>/g, `\n${ITEM}| `)
      .replace(/<\/entry>\s*<entry[^>]*>/g, " | ")
      .split("\n")
      .map((line) => {
        const text = plain(line);
        return text.length === 0 ? "" : line.startsWith(ITEM) ? `  ${text}` : text;
      })
      .filter((line) => line.length > 0),
  );
}

function first(haystack: string, pattern: RegExp): string | undefined {
  return pattern.exec(haystack)?.[1];
}

/** Strips inline markup and resolves the handful of entities this DTD emits. */
function plain(fragment: string): string {
  return fragment
    .replace(/<BR\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(new RegExp(ITEM, "g"), "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

main();
