import { describe, it, expect, afterAll } from "@jest/globals";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  decodeSmart,
  makeDataQueryTool,
  makeErpQueryTool,
  makeFsListTool,
  makeFsReadTool,
  makeFsSearchTool,
} from "../bench/company/tools.js";
import { validateToolInput } from "../src/tools/schema.js";

const root = mkdtempSync(join(tmpdir(), "company-tools-"));
mkdirSync(join(root, "fileserver"));
writeFileSync(join(root, "fileserver", "utf8.txt"), "Größe in UTF-8", "utf8");
// "Größe" encoded as windows-1252 (ö = 0xF6, ß = 0xDF)
writeFileSync(join(root, "fileserver", "legacy.csv"), Buffer.from([0x47, 0x72, 0xf6, 0xdf, 0x65]));
writeFileSync(join(root, "binary.bin"), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));
const dbPath = join(root, "erp.sqlite");
{
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE artikel (nr TEXT, preis REAL)");
  db.prepare("INSERT INTO artikel VALUES (?, ?)").run("DF-12040-DH", 1.29);
  db.close();
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("company tools", () => {
  it("lists directories with a trailing slash", async () => {
    const out = (await makeFsListTool(root).execute({})) as { entries: string[] };
    expect(out.entries).toContain("fileserver/");
    expect(out.entries).toContain("binary.bin");
  });

  it("reads utf-8 and windows-1252 files correctly", async () => {
    const read = makeFsReadTool(root);
    expect(((await read.execute({ path: "fileserver/utf8.txt" })) as { content: string }).content).toContain("Größe");
    expect(((await read.execute({ path: "fileserver/legacy.csv" })) as { content: string }).content).toBe("Größe");
  });

  it("refuses binary files", async () => {
    await expect(makeFsReadTool(root).execute({ path: "binary.bin" })).rejects.toThrow(/binary/);
  });

  it("blocks path traversal out of the corpus", async () => {
    await expect(makeFsReadTool(root).execute({ path: "../../etc/passwd" })).rejects.toThrow(/escapes/);
    await expect(makeFsListTool(root).execute({ path: ".." })).rejects.toThrow(/escapes/);
  });

  it("erp.query answers SELECTs and rejects writes", async () => {
    const tool = makeErpQueryTool(dbPath);
    const out = (await tool.execute({ sql: "SELECT preis FROM artikel WHERE nr = 'DF-12040-DH'" })) as {
      rows: Array<{ preis: number }>;
    };
    expect(out.rows[0]!.preis).toBeCloseTo(1.29);
    await expect(tool.execute({ sql: "DELETE FROM artikel" })).rejects.toThrow(/SELECT/);
    await expect(tool.execute({ sql: "UPDATE artikel SET preis=0" })).rejects.toThrow(/SELECT/);
  });

  it("fs.search ANDs multi-word queries at file level, matches per line", async () => {
    const search = makeFsSearchTool(root);
    // both terms in the same file (one in line 1, filename carries neither)
    writeFileSync(join(root, "fileserver", "preis.eml"), "Preis DF-12040 vereinbart\nmit Wittenbrink besprochen\n");
    const hit = (await search.execute({ query: "DF-12040 Wittenbrink" })) as { matches: string[] };
    expect(hit.matches.some((m) => m.includes("preis.eml:1"))).toBe(true);
    expect(hit.matches.some((m) => m.includes("preis.eml:2"))).toBe(true);
    // terms spread across different files → no match
    const miss = (await search.execute({ query: "DF-12040 Größe" })) as { matches: string[]; note?: string };
    expect(miss.matches.filter((m) => m.includes("preis.eml"))).toHaveLength(0);
  });

  it("fs.search is case-insensitive, windows-1252 tolerant, and skips binary content", async () => {
    const search = makeFsSearchTool(root);
    const legacy = (await search.execute({ query: "größe" })) as { matches: string[] };
    expect(legacy.matches.some((m) => m.includes("legacy.csv"))).toBe(true);
    // binary file content is never searched; filename still findable
    const bin = (await search.execute({ query: "binary.bin" })) as { matches: string[] };
    expect(bin.matches).toEqual(["binary.bin (Dateiname)"]);
  });

  it("fs.search reports no-match note and blocks traversal", async () => {
    const search = makeFsSearchTool(root);
    const none = (await search.execute({ query: "gibtesnicht" })) as { matches: string[]; note?: string };
    expect(none.matches).toHaveLength(0);
    expect(none.note).toMatch(/no matches/);
    await expect(search.execute({ query: "Nachlass", dir: ".." })).rejects.toThrow(/escapes/);
  });

  it("fs.search scopes results to the given dir subfolder", async () => {
    const search = makeFsSearchTool(root);
    // Same term ("Größe") lives both under fileserver/ (utf8.txt) and at the
    // corpus root would-be elsewhere; a dir-scoped search must only see the subtree.
    mkdirSync(join(root, "mail"), { recursive: true });
    writeFileSync(join(root, "mail", "note.eml"), "Größe der Lieferung\n");
    const scoped = (await search.execute({ query: "Größe", dir: "mail" })) as { matches: string[] };
    expect(scoped.matches.some((m) => m.startsWith("mail/note.eml"))).toBe(true);
    expect(scoped.matches.some((m) => m.includes("fileserver/"))).toBe(false);
    // Regression: without dir, the fileserver hit is still found.
    const all = (await search.execute({ query: "Größe" })) as { matches: string[] };
    expect(all.matches.some((m) => m.includes("fileserver/utf8.txt"))).toBe(true);
  });

  it("fs.search rejects an unknown dir with the list of top-level folders", async () => {
    const search = makeFsSearchTool(root);
    await expect(search.execute({ query: "egal", dir: "gibtesnicht" })).rejects.toThrow(
      /unknown folder "gibtesnicht".*available top-level folders:.*fileserver/s,
    );
  });

  it("decodeSmart falls back to windows-1252 only when utf-8 breaks", () => {
    expect(decodeSmart(Buffer.from("schön utf-8", "utf8"))).toBe("schön utf-8");
    expect(decodeSmart(Buffer.from([0xe4]))).toBe("ä");
  });
});

// ---------------------------------------------------------------------------
// data.query with the `erp:` table source — the CSV↔ERP bridge.
// ---------------------------------------------------------------------------

/** Extracts the single scalar of a whole-table aggregate ("count\n---\n<n>\n…"). */
function aggregateScalar(rendered: string): number {
  const m = rendered.match(/\n---\n([\d.]+)\n/);
  if (!m) throw new Error(`no scalar in result:\n${rendered}`);
  return Number(m[1]);
}

describe("data.query erp: table source", () => {
  const erpRoot = mkdtempSync(join(tmpdir(), "data-query-erp-"));
  // makeDataQueryTool derives the DB from <root>/erp/erp.sqlite — mirror that.
  mkdirSync(join(erpRoot, "erp"));
  mkdirSync(join(erpRoot, "dms"));
  {
    const db = new DatabaseSync(join(erpRoot, "erp", "erp.sqlite"));
    db.exec("CREATE TABLE auftraege (auftragsnr TEXT, kunde TEXT, stueckpreis REAL)");
    const ins = db.prepare("INSERT INTO auftraege VALUES (?, ?, ?)");
    ins.run("2024-1001", "Sundern", 1.29);
    ins.run("2024-1002", "Kirchbaum", 7.73);
    db.exec("CREATE TABLE rechnungen (rechnungsnr TEXT, rechnungsdatum TEXT)");
    const insR = db.prepare("INSERT INTO rechnungen VALUES (?, ?)");
    insR.run("RE-2024-1", "2024-06-30");
    insR.run("RE-2025-1", "2025-07-13");
    insR.run("RE-2025-2", "2025-01-28");
    db.close();
  }
  // A DocuWare-shaped CSV: DW-3 points at an order the ERP does not have.
  writeFileSync(
    join(erpRoot, "dms", "docuware-index.csv"),
    "Dokument-ID;Aktenzeichen\nDW-1;2024-1001\nDW-2;2024-1002\nDW-3;9999-0000\nDW-4;2024-1001\n",
    "utf8",
  );

  afterAll(() => rmSync(erpRoot, { recursive: true, force: true }));

  const run = async (query: unknown): Promise<string> =>
    ((await makeDataQueryTool(erpRoot).execute({ query } as never)) as { result: string }).result;

  it("loads an erp: table as a queryable source", async () => {
    const out = await run({ file: "erp:auftraege", select: ["auftragsnr", "kunde"] });
    expect(out).toContain("2024-1001");
    expect(out).toContain("Sundern");
    expect(out).toContain("2 rows");
  });

  it("treats sqlite REAL cells like CSV decimals for numeric where filters", async () => {
    // 1.29 and 7.73 come out of sqlite as numbers; the engine must still
    // compare them numerically after stringify (parseGermanNumber path).
    const out = await run({ file: "erp:auftraege", where: [{ col: "stueckpreis", op: ">", value: 1.3 }], aggregate: [{ fn: "count" }] });
    expect(aggregateScalar(out)).toBe(1);
  });

  it("anti-joins a CSV against an erp: table (orphaned references)", async () => {
    const out = await run({
      file: "dms/docuware-index.csv",
      join: { file: "erp:auftraege", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "anti" },
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(1); // only DW-3 (9999-0000)
  });

  it("inner-joins a CSV against an erp: table", async () => {
    const out = await run({
      file: "dms/docuware-index.csv",
      join: { file: "erp:auftraege", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "inner" },
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(3); // DW-1, DW-2, DW-4
  });

  it("filters an erp: table by year via contains", async () => {
    const out = await run({ file: "erp:rechnungen", where: [{ col: "rechnungsdatum", op: "contains", value: "2025" }], aggregate: [{ fn: "count" }] });
    expect(aggregateScalar(out)).toBe(2);
  });

  it("rejects an unknown erp: table with the list of allowed tables", async () => {
    await expect(run({ file: "erp:gibtesnicht" })).rejects.toThrow(
      /unknown ERP table "gibtesnicht".*available tables:.*auftraege.*rechnungen/s,
    );
  });

  // Flattened input schema: the tool args ARE the query object. Regression guard
  // for the live-measured bug where an 8B model copies a bare example from the
  // description ({"file":…}) and the old {query:{…}} wrapper schema rejected it.
  it("accepts the bare {file:...} args through the validator and executes", async () => {
    const tool = makeDataQueryTool(erpRoot);
    const args = { file: "erp:auftraege", aggregate: [{ fn: "count" }] };
    expect(validateToolInput(args, tool.inputSchema)).toBeNull();
    const out = ((await tool.execute(args as never)) as { result: string }).result;
    expect(aggregateScalar(out)).toBe(2);
  });

  it("still tolerates the legacy {query:{...}} wrapper at the handler", async () => {
    const tool = makeDataQueryTool(erpRoot);
    const out = ((await tool.execute({ query: { file: "erp:auftraege", aggregate: [{ fn: "count" }] } } as never)) as {
      result: string;
    }).result;
    expect(aggregateScalar(out)).toBe(2);
  });

  it("the validator flags a request that omits file", () => {
    expect(validateToolInput({ aggregate: [{ fn: "count" }] }, makeDataQueryTool(erpRoot).inputSchema)).toMatch(/file/);
  });
});

// ---------------------------------------------------------------------------
// data.query with the `fs:` file-listing source — index↔filesystem joins.
// ---------------------------------------------------------------------------

describe("data.query fs: file-listing source", () => {
  const fsRoot = mkdtempSync(join(tmpdir(), "data-query-fs-"));
  // A nested fileserver tree (the K: drive) + a DMS index whose Ablagepfad
  // column stores K:\ paths with backslashes, like the real DocuWare export.
  mkdirSync(join(fsRoot, "fileserver", "Vertrieb", "Angebote"), { recursive: true });
  mkdirSync(join(fsRoot, "dms"), { recursive: true });
  writeFileSync(join(fsRoot, "fileserver", "liste.txt"), "x");
  writeFileSync(join(fsRoot, "fileserver", "Vertrieb", "a.txt"), "x");
  writeFileSync(join(fsRoot, "fileserver", "Vertrieb", "Angebote", "b.pdf"), "x");
  // DW-3 points at a file that does not exist on disk — the orphan.
  writeFileSync(
    join(fsRoot, "dms", "docuware-index.csv"),
    "Dokument-ID;Ablagepfad\n" +
      "DW-1;K:\\Vertrieb\\a.txt\n" +
      "DW-2;K:\\Vertrieb\\Angebote\\b.pdf\n" +
      "DW-3;K:\\Vertrieb\\weg.txt\n",
    "utf8",
  );

  afterAll(() => rmSync(fsRoot, { recursive: true, force: true }));

  const run = async (query: unknown): Promise<string> =>
    ((await makeDataQueryTool(fsRoot).execute(query as never)) as { result: string }).result;

  it("lists files recursively with normalized (forward-slash) columns", async () => {
    const out = await run({ file: "fs:fileserver", select: ["pfad", "pfad_win", "ordner", "dateiname", "endung"] });
    // deepest file proves recursion; row proves every column's normalization.
    expect(out).toContain(
      "fileserver/Vertrieb/Angebote/b.pdf | K:\\Vertrieb\\Angebote\\b.pdf | fileserver/Vertrieb/Angebote | b.pdf | pdf",
    );
    expect(out).toContain("3 rows");
  });

  it("counts all files with the bare aggregate form", async () => {
    expect(aggregateScalar(await run({ file: "fs:fileserver", aggregate: [{ fn: "count" }] }))).toBe(3);
  });

  it("fs: (no folder) spans the whole corpus, dms CSV included", async () => {
    const out = await run({ file: "fs:", where: [{ col: "ordner", op: "==", value: "dms" }], select: ["dateiname"] });
    expect(out).toContain("docuware-index.csv");
  });

  it("anti-joins a DMS index against the filesystem (orphaned stored paths)", async () => {
    const out = await run({
      file: "dms/docuware-index.csv",
      join: { file: "fs:fileserver", leftCol: "Ablagepfad", rightCol: "pfad_win", type: "anti" },
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(1); // only DW-3 (weg.txt)
  });

  it("rejects an unknown fs folder with the list of available folders", async () => {
    await expect(run({ file: "fs:gibtesnicht" })).rejects.toThrow(
      /unknown fs folder "gibtesnicht".*available folders:.*fileserver/s,
    );
  });
});

// Integration against the generated demo-company corpus — skipped when absent
// (company/ is a local artifact, not in git). The expected numbers are derived
// straight from the source data here (sqlite + CSV), never from truth/, so the
// test checks Engine-vs-direct-count consistency, not the answer key.
const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "company", "out", "corpus");
const maybe = existsSync(join(CORPUS, "erp", "erp.sqlite")) ? describe : describe.skip;

maybe("data.query erp: source on the demo-company corpus", () => {
  const tool = makeDataQueryTool(CORPUS);
  const run = async (query: unknown): Promise<string> =>
    ((await tool.execute({ query } as never)) as { result: string }).result;

  // Direct, tool-independent ground truth from the raw sources.
  const db = new DatabaseSync(join(CORPUS, "erp", "erp.sqlite"), { readOnly: true });
  const auftragsnrs = new Set(
    (db.prepare("SELECT auftragsnr FROM auftraege").all() as { auftragsnr: unknown }[]).map((r) => String(r.auftragsnr)),
  );
  const invoices2025 = (db.prepare("SELECT COUNT(*) c FROM rechnungen WHERE rechnungsdatum LIKE '2025%'").get() as { c: number }).c;
  db.close();

  const docuLines = decodeSmart(readFileSync(join(CORPUS, "dms", "docuware-index.csv")))
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const aktIdx = docuLines[0]!.split(";").indexOf("Aktenzeichen");
  const aktValues = docuLines.slice(1).map((l) => (l.split(";")[aktIdx] ?? "").trim());
  const expectedMatches = aktValues.filter((a) => auftragsnrs.has(a)).length;
  const expectedOrphans = aktValues.filter((a) => !auftragsnrs.has(a)).length;

  it("inner-joins DocuWare Aktenzeichen against erp:auftraege consistently with a direct count", async () => {
    const out = await run({
      file: "dms/docuware-index.csv",
      join: { file: "erp:auftraege", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "inner" },
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(expectedMatches);
  });

  it("anti-joins DocuWare Aktenzeichen against erp:auftraege consistently with a direct count", async () => {
    const out = await run({
      file: "dms/docuware-index.csv",
      join: { file: "erp:auftraege", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "anti" },
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(expectedOrphans);
  });

  it("counts 2025 invoices in erp:rechnungen consistently with a direct SQL count", async () => {
    const out = await run({
      file: "erp:rechnungen",
      where: [{ col: "rechnungsdatum", op: "contains", value: "2025" }],
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(invoices2025);
  });
});

maybe("data.query fs: source on the demo-company corpus", () => {
  const tool = makeDataQueryTool(CORPUS);
  const run = async (query: unknown): Promise<string> =>
    ((await tool.execute(query as never)) as { result: string }).result;

  // Direct, tool-independent inventory via a readdir walk of the real files.
  const fsRoot = join(CORPUS, "fileserver");
  const walk = (dir: string, out: string[]): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, out);
      else out.push(abs);
    }
  };
  const fsFiles: string[] = [];
  walk(fsRoot, fsFiles);
  // Reproduce the tool's K:\ mapping independently to derive the orphan count.
  const winPaths = new Set(
    fsFiles.map((abs) => "K:\\" + abs.slice(fsRoot.length + 1).split(sep).join("\\")),
  );
  const docuLines = decodeSmart(readFileSync(join(CORPUS, "dms", "docuware-index.csv")))
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const pfadIdx = docuLines[0]!.split(";").indexOf("Ablagepfad");
  const ablagePaths = docuLines.slice(1).map((l) => (l.split(";")[pfadIdx] ?? "").trim());
  const expectedOrphans = ablagePaths.filter((p) => !winPaths.has(p)).length;

  it("counts fileserver files consistently with a direct readdir walk", async () => {
    const out = await run({ file: "fs:fileserver", aggregate: [{ fn: "count" }] });
    expect(aggregateScalar(out)).toBe(fsFiles.length);
  });

  it("anti-joins DocuWare Ablagepfad against fs:fileserver consistently with a direct count", async () => {
    const out = await run({
      file: "dms/docuware-index.csv",
      join: { file: "fs:fileserver", leftCol: "Ablagepfad", rightCol: "pfad_win", type: "anti" },
      aggregate: [{ fn: "count" }],
    });
    expect(aggregateScalar(out)).toBe(expectedOrphans);
  });
});
