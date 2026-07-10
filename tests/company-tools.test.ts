import { describe, it, expect, afterAll } from "@jest/globals";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeSmart, makeErpQueryTool, makeFsListTool, makeFsReadTool } from "../bench/company/tools.js";

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

  it("decodeSmart falls back to windows-1252 only when utf-8 breaks", () => {
    expect(decodeSmart(Buffer.from("schön utf-8", "utf8"))).toBe("schön utf-8");
    expect(decodeSmart(Buffer.from([0xe4]))).toBe("ä");
  });
});
