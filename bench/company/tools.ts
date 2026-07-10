/**
 * The three tools a real deployment at a company like this would get:
 * file listing, file reading (with legacy windows-1252 tolerance — German
 * fileservers are full of it) and read-only SQL against the ERP.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ToolDefinition } from "../../src/types/tool.js";

/** Reading more than this per file call mostly burns context. */
const MAX_READ_CHARS = 20_000;
const MAX_SQL_ROWS = 50;

/** Resolves a corpus-relative path and refuses anything escaping the root. */
function resolveInside(root: string, relPath: string): string {
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes the corpus root: ${relPath}`);
  }
  return abs;
}

/** utf-8 first; replacement chars signal a legacy windows-1252 file. */
export function decodeSmart(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1252").decode(buf);
}

export function makeFsListTool(root: string): ToolDefinition<{ path?: string }, { entries: string[] }> {
  return {
    name: "fs.list",
    description:
      "Lists a directory of the company data. Top-level folders: fileserver/ (K: drive), mail/ (e-mail archive), ad/ (Active Directory exports). Directories end with '/'.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path, e.g. 'fileserver/QM'. Omit for the top level." } },
      required: [],
      additionalProperties: false,
    },
    async execute(input) {
      const abs = resolveInside(root, input.path ?? ".");
      const entries = readdirSync(abs)
        .sort()
        .map((name) => (statSync(join(abs, name)).isDirectory() ? `${name}/` : name));
      return { entries };
    },
  };
}

export function makeFsReadTool(root: string): ToolDefinition<{ path: string }, { content: string }> {
  return {
    name: "fs.read",
    description: "Reads a text file from the company data (fileserver/, mail/, ad/). Not for .sqlite files — use erp.query.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path, e.g. 'mail/2024-03-14_wittenbrink_preisabsprache.eml'" } },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input) {
      const abs = resolveInside(root, input.path);
      const buf = readFileSync(abs);
      if (buf.subarray(0, 1024).includes(0)) {
        throw new Error(`binary file — not readable as text: ${input.path}`);
      }
      const text = decodeSmart(buf);
      return {
        content: text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n[... truncated]` : text,
      };
    },
  };
}

export function makeErpQueryTool(dbPath: string): ToolDefinition<{ sql: string }, { rows: unknown[] }> {
  return {
    name: "erp.query",
    description:
      "Runs a read-only SQL SELECT against the live ERP database (SQLite). Tables: kunden, lieferanten, artikel, auftraege, maschinen, wartung, mitarbeiter. Discover columns via: SELECT name FROM pragma_table_info('artikel').",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "A single SELECT statement." } },
      required: ["sql"],
      additionalProperties: false,
    },
    async execute(input) {
      const sql = input.sql.trim();
      if (!/^(select|with)\b/i.test(sql)) {
        throw new Error("only SELECT queries are allowed");
      }
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const rows = db.prepare(sql).all();
        return { rows: rows.slice(0, MAX_SQL_ROWS) };
      } finally {
        db.close();
      }
    },
  };
}

export function makeCompanyTools(corpusRoot: string): ToolDefinition[] {
  const root = resolve(corpusRoot);
  return [
    makeFsListTool(root),
    makeFsReadTool(root),
    makeErpQueryTool(join(root, "erp", "erp.sqlite")),
  ] as ToolDefinition[];
}
