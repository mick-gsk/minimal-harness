/**
 * The three tools a real deployment at a company like this would get:
 * file listing, file reading (with legacy windows-1252 tolerance — German
 * fileservers are full of it) and read-only SQL against the ERP.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractOfficeText } from "../../src/extractors/office.js";
import {
  formatQueryResult,
  parseCsv,
  runQuery,
  type Row,
  type Table,
  type TableQuery,
} from "../../src/tools/table-query.js";
import type { Embedder } from "../../src/rag/embedder.js";
import { SqliteKnowledgeStore } from "../../src/rag/knowledge-store.js";
import type { ToolDefinition } from "../../src/types/tool.js";

/**
 * ~1.5k tokens per read: local models run on small context windows (8-16k);
 * one 20k-char read would evict the system prompt and earlier findings.
 */
const MAX_READ_CHARS = 6_000;
const MAX_SQL_ROWS = 50;

/**
 * The ERP tables the read-only tools may touch. Single source of truth for both
 * erp.query (raw SQL) and data.query's `erp:` table source, so the two tools can
 * never drift on what "the ERP" exposes.
 */
export const ERP_TABLES = [
  "kunden",
  "lieferanten",
  "artikel",
  "auftraege",
  "rechnungen",
  "lieferscheine",
  "werkzeuge",
  "maschinen",
  "wartung",
  "mitarbeiter",
] as const;

/** `data.query` file prefix that resolves to an ERP table instead of a CSV. */
const ERP_TABLE_PREFIX = "erp:";

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
      "Lists a directory of the company data. Top-level folders: fileserver/ (K: drive), mail/ (e-mail archive), ad/ (Active Directory exports), dms/ (DocuWare index), bde/ (machine data exports), datev/ (accounting batches), pdm/ (CAD index). Directories end with '/'.",
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
    description:
      "Reads a file from the company data (fileserver/, mail/, ad/, dms/, bde/, datev/, pdm/). Office files (.xlsx, .docx, .pdf) are returned as extracted text. Not for .sqlite files — use erp.query.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path, e.g. 'mail/2024-03-14_wittenbrink_preisabsprache.eml'" } },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input) {
      const abs = resolveInside(root, input.path);
      const buf = readFileSync(abs);
      let text: string;
      const office = extractOfficeText(input.path, buf);
      if (office !== null) {
        if (office.trim().length === 0) {
          throw new Error(`no text layer in ${input.path} — likely a scan; OCR is not available`);
        }
        text = office;
      } else if (buf.subarray(0, 1024).includes(0)) {
        throw new Error(`binary file — not readable as text: ${input.path}`);
      } else {
        text = decodeSmart(buf);
      }
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
      "Full-text search across ALL company files (fileserver/, mail/, ad/, dms/, bde/, datev/, pdm/), including the text inside .xlsx/.docx/.pdf — like the search box on the fileserver. Case-insensitive; multiple terms are AND-combined per file; returns 'path:line: excerpt'. Use this to locate documents before reading them.",
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
        // Office files are searched by their extracted text — like the real
        // Windows search does. Other binaries: filename only.
        let text: string;
        try {
          text = extractOfficeText(rel, buf) ?? (buf.subarray(0, 1024).includes(0) ? "" : decodeSmart(buf));
        } catch {
          text = "";
        }
        const haystack = relLower + "\n" + text.toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) continue;
        if (terms.some((t) => relLower.includes(t)) || text === "") {
          matches.push(`${rel} (Dateiname)`);
        }
        const lines = text.split(/\r?\n/);
        let perFile = 0;
        for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_MATCHES && perFile < 3; i++) {
          const line = lines[i];
          if (line === undefined) continue;
          if (terms.some((t) => line.toLowerCase().includes(t))) {
            matches.push(`${rel}:${i + 1}: ${line.trim().slice(0, MAX_EXCERPT_CHARS)}`);
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
      `Runs a read-only SQL SELECT against the live ERP database (SQLite). Tables: ${ERP_TABLES.join(", ")}. Discover columns via: SELECT name FROM pragma_table_info('artikel').`,
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

/**
 * Structured querying over the CSV exports scattered across the corpus
 * (dms/, erp/, ad/, bde/, ...). Small models cannot join/aggregate 500-row
 * tables in their head; this gives them a deterministic data tool. Not SQL —
 * a small JSON shape that 8B models emit reliably. The `anti` join is the point:
 * it answers "missing in" / "orphaned" questions.
 */
export function makeDataQueryTool(
  root: string,
): ToolDefinition<TableQuery & { query?: TableQuery }, { result: string }> {
  // Same wiring makeCompanyTools uses for erp.query — the erp: source is just
  // the other view onto that one database.
  const erpDbPath = join(root, "erp", "erp.sqlite");

  /**
   * Reads a whitelisted ERP table into the SAME string-cell Table shape parseCsv
   * produces, so the engine (join/where/aggregate) treats sqlite and CSV sources
   * identically. Cell values become strings via String(): the engine parses them
   * on demand with parseGermanNumber, which reads both "1.29" (sqlite REAL) and
   * "1,29" (German CSV), so a numeric compare behaves the same on either source.
   */
  const loadErpTable = (ref: string): Table => {
    const name = ref.slice(ERP_TABLE_PREFIX.length).trim();
    if (!(ERP_TABLES as readonly string[]).includes(name)) {
      throw new Error(`unknown ERP table "${name}" — available tables: ${ERP_TABLES.join(", ")}`);
    }
    const db = new DatabaseSync(erpDbPath, { readOnly: true });
    try {
      // pragma_table_info gives the columns even for an empty table.
      const columns = db
        .prepare("SELECT name FROM pragma_table_info(?)")
        .all(name)
        .map((r) => String((r as { name: unknown }).name));
      const rows = (db.prepare(`SELECT * FROM ${name}`).all() as Record<string, unknown>[]).map((r) => {
        const out: Row = {};
        for (const c of columns) out[c] = r[c] == null ? "" : String(r[c]);
        return out;
      });
      return { columns, rows };
    } finally {
      db.close();
    }
  };

  // Parse each source at most once per tool call; join queries touch two.
  const cache = new Map<string, Table>();
  const load = (file: string): Table => {
    if (typeof file !== "string" || file.length === 0) {
      throw new Error('query.file must be a corpus-relative .csv path or an "erp:<table>" reference');
    }
    // `erp:<table>` pulls a live ERP table; anything else is a corpus CSV.
    if (file.startsWith(ERP_TABLE_PREFIX)) {
      let table = cache.get(file);
      if (!table) {
        table = loadErpTable(file);
        cache.set(file, table);
      }
      return table;
    }
    const abs = resolveInside(root, file); // refuses paths escaping the corpus (truth/ is outside it)
    if (!/\.csv$/i.test(abs)) throw new Error(`only .csv files can be queried: ${file}`);
    let table = cache.get(abs);
    if (!table) {
      table = parseCsv(decodeSmart(readFileSync(abs)));
      cache.set(abs, table);
    }
    return table;
  };
  return {
    name: "data.query",
    description:
      "Runs a structured query over a CSV export in the corpus (dms/, erp/, ad/, bde/, datev/, pdm/). " +
      "Use this instead of fs.read for counting, filtering, grouping and JOINING rows across CSVs — small models cannot do this by reading. " +
      "Besides CSV paths, both `file` and `join.file` also accept a live ERP table via the prefix 'erp:' + table name " +
      `(${ERP_TABLES.map((t) => `erp:${t}`).join(", ")}) — so you can join a CSV against an ERP table for cross-system questions. ` +
      "Discover an ERP table's columns with erp.query: SELECT name FROM pragma_table_info('auftraege'). " +
      "Query shape (JSON): {file, select?, where?:[{col,op,value}], groupBy?, aggregate?:[{fn,col?}], join?:{file,leftCol,rightCol,type}, limit?}. " +
      "op ∈ ==,!=,>,<,>=,<=,contains,in (numbers understand German decimal commas). fn ∈ count,sum,avg,min,max. join.type ∈ inner,anti. " +
      "The 'anti' join returns left rows with NO match on the right — use it for 'orphaned' / 'points at something that does not exist' questions. " +
      "Result is a compact text table with a row count. Unknown columns return the list of available columns. Examples: " +
      '(1) count articles per material: {"file":"erp/export_2019.csv","groupBy":["Werkstoff"]}. ' +
      '(2) articles above 5 EUR: {"file":"erp/export_2019.csv","where":[{"col":"Listenpreis EUR","op":">","value":5}],"select":["Artikelnr","Listenpreis EUR"]}. ' +
      '(3) DocuWare entries whose creator no longer exists in Active Directory (anti-join): ' +
      '{"file":"dms/docuware-index.csv","join":{"file":"ad/users.csv","leftCol":"Erfasst durch","rightCol":"SamAccountName","type":"anti"},"aggregate":[{"fn":"count"}]}. ' +
      '(4) DocuWare entries pointing at an order that no longer exists in the ERP (CSV↔ERP anti-join): ' +
      '{"file":"dms/docuware-index.csv","join":{"file":"erp:auftraege","leftCol":"Aktenzeichen","rightCol":"auftragsnr","type":"anti"},"aggregate":[{"fn":"count"}]}. ' +
      '(5) how many ERP invoices are dated in 2025 (year filter on an ERP table): ' +
      '{"file":"erp:rechnungen","where":[{"col":"rechnungsdatum","op":"contains","value":"2025"}],"aggregate":[{"fn":"count"}]}.',
    // Flattened: the tool's arguments ARE the query object. Earlier the schema
    // required a {query:{…}} wrapper while every description example showed the
    // bare object — 8B models copy the examples verbatim, so the wrapper form
    // got rejected en masse. The handler still tolerates a {query} wrapper for
    // back-compat, but the schema now accepts (and the examples show) the bare
    // shape the models actually emit.
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            'The source: a corpus-relative .csv path, an "erp:<table>" reference (e.g. "erp:auftraege"), or an "fs:<folder>" file listing (e.g. "fs:fileserver").',
        },
        select: { type: "array", description: "Column names to project, e.g. [\"Artikelnr\",\"Listenpreis EUR\"]." },
        where: { type: "array", description: "Filters, e.g. [{\"col\":\"Status\",\"op\":\"==\",\"value\":\"Offen\"}]." },
        groupBy: { type: "array", description: "Columns to group by, e.g. [\"Werkstoff\"]." },
        aggregate: { type: "array", description: "Aggregations, e.g. [{\"fn\":\"count\"}] or [{\"fn\":\"sum\",\"col\":\"Menge\"}]." },
        join: { type: "object", description: "{file,leftCol,rightCol,type} — type ∈ inner,anti." },
        limit: { type: "number", description: "Maximum rows to return." },
      },
      required: ["file"],
      additionalProperties: false,
    },
    async execute(input) {
      // Accept both the flat form ({file,…}) and the legacy wrapper ({query:{…}}).
      const wrapped = input.query;
      const q: TableQuery =
        wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
          ? wrapped
          : (input as TableQuery);
      if (!q || typeof q.file !== "string") {
        throw new Error('query needs a "file" (corpus-relative .csv path or "erp:<table>")');
      }
      return { result: formatQueryResult(runQuery(q, load)) };
    },
  };
}

/**
 * Semantic search over the pre-built company knowledge index (knowledge.db).
 * A complement to fs.search's keyword match: it ranks chunks by embedding
 * similarity, so it finds the right document even when the caller does not
 * know the exact wording. The index is built ONLY over company/out/corpus
 * (build-knowledge.ts) — truth/ (the answer key) is never indexed, so no
 * ground truth can leak through this tool.
 *
 * topK default 3: three ~1000-char chunks (~750 tokens) still fit the 16k
 * research window next to the running context — the same budget logic that
 * caps fs.read at MAX_READ_CHARS. Capped at MAX_TOP_K so one call can never
 * flood the window.
 */
const KNOWLEDGE_DEFAULT_TOP_K = 3;
const KNOWLEDGE_MAX_TOP_K = 8;

export function makeCompanyKnowledgeTool(
  dbPath: string,
  embedder: Embedder,
): ToolDefinition<{ query: string; topK?: number }, { result: string }> {
  return {
    name: "knowledge.search",
    description:
      "Semantic (meaning-based) search over the entire company knowledge base — a complement to fs.search's keyword match. " +
      "Best for 'where is something documented about X' questions when you do not know the exact wording or which file to open. " +
      `Takes {query, topK?} (topK default ${KNOWLEDGE_DEFAULT_TOP_K}) and returns the most relevant text chunks, each with its source path. ` +
      "Open the full source with fs.read to confirm a finding before you cite it.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A natural-language question or topic, e.g. 'Wer darf Preisnachlässe freigeben?'" },
        topK: { type: "number", description: `How many chunks to return (default ${KNOWLEDGE_DEFAULT_TOP_K}, max ${KNOWLEDGE_MAX_TOP_K}).` },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input) {
      if (typeof input.query !== "string" || input.query.trim().length === 0) {
        throw new Error("knowledge.search needs a non-empty query");
      }
      if (!existsSync(dbPath)) {
        throw new Error(`knowledge index missing at ${dbPath} — build it first: npx tsx bench/company/build-knowledge.ts`);
      }
      const k = Math.max(1, Math.min(KNOWLEDGE_MAX_TOP_K, Math.floor(input.topK ?? KNOWLEDGE_DEFAULT_TOP_K)));
      const store = new SqliteKnowledgeStore(dbPath, embedder);
      try {
        const hits = await store.search(input.query, k);
        if (hits.length === 0) return { result: "no matches in the knowledge base" };
        const blocks = hits.map((h, i) => `[${i + 1}] ${h.source} (score ${h.score.toFixed(2)})\n${h.content.trim()}`);
        return { result: blocks.join("\n\n") };
      } catch (err) {
        throw new Error(`knowledge.search failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        store.close();
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
    makeDataQueryTool(root),
  ] as ToolDefinition[];
}
