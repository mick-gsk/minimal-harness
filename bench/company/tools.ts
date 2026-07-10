/**
 * The three tools a real deployment at a company like this would get:
 * file listing, file reading (with legacy windows-1252 tolerance — German
 * fileservers are full of it) and read-only SQL against the ERP.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ToolDefinition } from "../../src/types/tool.js";

/**
 * ~1.5k tokens per read: local models run on small context windows (8-16k);
 * one 20k-char read would evict the system prompt and earlier findings.
 */
const MAX_READ_CHARS = 6_000;
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

/**
 * Search caps: enough hits to locate a document, small enough that one broad
 * query ("Feder") cannot flood the context window.
 */
const MAX_SEARCH_MATCHES = 20;
const MAX_EXCERPT_CHARS = 160;

function walkFiles(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      walkFiles(root, abs, out);
    } else {
      out.push(abs.slice(root.length + 1));
    }
  }
}

export function makeFsSearchTool(root: string): ToolDefinition<{ query: string; path?: string }, { matches: string[]; note?: string }> {
  return {
    name: "fs.search",
    description:
      "Full-text search across the company files (fileserver/, mail/, ad/) — like the search box on the fileserver. Case-insensitive substring match against file names and file contents; returns 'path:line: excerpt'. Use this to locate documents before reading them.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. 'DF-12040 Wittenbrink'. Multiple terms are AND-combined per file." },
        path: { type: "string", description: "Optional: limit to a subtree, e.g. 'mail'." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input) {
      // Models issue multi-word queries; every real enterprise search
      // (Outlook, Windows search) ANDs terms at file level — so do we.
      const terms = input.query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
      if (terms.length === 0) throw new Error("query too short — use at least 2 characters");
      const base = resolveInside(root, input.path ?? ".");
      const files: string[] = [];
      walkFiles(root, base, files);
      const matches: string[] = [];
      for (const rel of files) {
        if (matches.length >= MAX_SEARCH_MATCHES) break;
        const relLower = rel.toLowerCase();
        const buf = readFileSync(join(root, rel));
        const text = buf.subarray(0, 1024).includes(0) ? "" : decodeSmart(buf); // binary: filename only
        const haystack = relLower + "\n" + text.toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) continue;
        if (terms.some((t) => relLower.includes(t)) || text === "") {
          matches.push(`${rel} (Dateiname)`);
        }
        const lines = text.split(/\r?\n/);
        let perFile = 0;
        for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_MATCHES && perFile < 3; i++) {
          const lineLower = lines[i].toLowerCase();
          if (terms.some((t) => lineLower.includes(t))) {
            matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, MAX_EXCERPT_CHARS)}`);
            perFile++;
          }
        }
      }
      const note =
        matches.length >= MAX_SEARCH_MATCHES
          ? "more matches exist — refine the query"
          : matches.length === 0
            ? "no matches — try fewer or different keywords"
            : undefined;
      return { matches, ...(note ? { note } : {}) };
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
    makeFsSearchTool(root),
    makeErpQueryTool(join(root, "erp", "erp.sqlite")),
  ] as ToolDefinition[];
}
