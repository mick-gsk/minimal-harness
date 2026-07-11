/**
 * Zero-dependency CSV parser + tiny declarative query engine.
 *
 * Motivation: small local models (8B) cannot answer cross-system data questions
 * ("how many DocuWare entries point at non-existent orders?") by reading a
 * 500-row CSV and doing the join/aggregation in their head. They need a data
 * tool. This is that tool — deliberately NOT SQL (parsing SQL reliably from an
 * 8B model is fragile); instead a small JSON query shape that maps 1:1 onto the
 * things such questions need: filter, group, aggregate, and — crucially — the
 * `anti` join for "missing in" / "orphaned" questions.
 *
 * The engine is filesystem-agnostic: it takes a `resolve(file)` callback that
 * returns a parsed table. The bench deployment wires that to a sandboxed,
 * corpus-confined CSV loader; tests pass in-memory tables.
 */

export type Row = Record<string, string>;

export interface Table {
  columns: string[];
  rows: Row[];
}

export type CompareOp = "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "in";

export interface WhereClause {
  col: string;
  op: CompareOp;
  value: unknown;
}

export type AggFn = "count" | "sum" | "avg" | "min" | "max";

export interface AggregateSpec {
  fn: AggFn;
  col?: string;
}

export interface JoinSpec {
  file: string;
  leftCol: string;
  rightCol: string;
  type: "inner" | "anti";
}

export interface TableQuery {
  file: string;
  select?: string[];
  where?: WhereClause[];
  groupBy?: string[];
  aggregate?: AggregateSpec[];
  join?: JoinSpec;
  limit?: number;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number)[][];
  /** Total rows the query produced, before the display cap. */
  totalRows: number;
  truncated: boolean;
}

/** Hard cap on rendered rows: one broad query must not flood an 8B context. */
export const OUTPUT_ROW_CAP = 50;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * German exports are usually semicolon-delimited (comma is the decimal sep);
 * pick whichever of ';' or ',' occurs more often in the header line.
 */
export function detectDelimiter(headerLine: string): ";" | "," {
  const semis = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semis >= commas ? ";" : ",";
}

/** Splits one CSV line, honouring "double-quoted" fields and "" escapes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/**
 * Parses CSV text into a Table. First non-empty line is the header. Handles
 * quoted fields spanning delimiters and quoted newlines. Delimiter is
 * auto-detected from the header unless given.
 */
export function parseCsv(text: string, delimiter?: ";" | ","): Table {
  // Normalise line endings, then split on newlines that are NOT inside quotes.
  const clean = text.replace(/\r\n?/g, "\n");
  const records: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "\n" && !inQuotes) {
      records.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) records.push(cur);

  const nonEmpty = records.filter((r) => r.trim().length > 0);
  if (nonEmpty.length === 0) return { columns: [], rows: [] };

  const delim = delimiter ?? detectDelimiter(nonEmpty[0]!);
  const columns = splitLine(nonEmpty[0]!, delim).map((c) => c.trim());
  const rows: Row[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = splitLine(nonEmpty[i]!, delim);
    const row: Row = {};
    for (let c = 0; c < columns.length; c++) {
      row[columns[c]!] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }
  return { columns, rows };
}

/**
 * Parses a number tolerating German formatting: "1,08" -> 1.08,
 * "1.234,56" -> 1234.56, "1234" -> 1234. Returns null if not numeric.
 */
export function parseGermanNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let t = s;
  if (dots > 0 && commas > 0) {
    // The separator that appears last is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      t = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      t = s.replace(/,/g, "");
    }
  } else if (commas === 1) {
    t = s.replace(",", ".");
  } else if (commas > 1) {
    t = s.replace(/,/g, ""); // grouping separators
  } else if (dots > 1) {
    t = s.replace(/\./g, ""); // grouping separators
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
}

// ---------------------------------------------------------------------------
// Query engine
// ---------------------------------------------------------------------------

function assertColumn(table: Table, col: string, fileLabel: string): void {
  if (!table.columns.includes(col)) {
    throw new Error(
      `unknown column "${col}" in ${fileLabel} — available columns: ${table.columns.join(", ")}`,
    );
  }
}

/** Applies one where clause to a row; numeric where possible, else string. */
function matches(row: Row, clause: WhereClause): boolean {
  const cell = row[clause.col] ?? "";
  const { op, value } = clause;

  if (op === "contains") {
    return cell.toLowerCase().includes(String(value).toLowerCase());
  }
  if (op === "in") {
    const list = Array.isArray(value) ? value : [value];
    return list.some((v) => String(v).trim() === cell.trim());
  }

  const cellNum = parseGermanNumber(cell);
  const valNum = typeof value === "number" ? value : parseGermanNumber(String(value));
  const bothNum = cellNum !== null && valNum !== null;

  switch (op) {
    case "==":
      return bothNum ? cellNum === valNum : cell.trim() === String(value).trim();
    case "!=":
      return bothNum ? cellNum !== valNum : cell.trim() !== String(value).trim();
    // Ordered comparisons are numeric-only; non-numeric cells never match.
    case ">":
      return bothNum && cellNum! > valNum!;
    case "<":
      return bothNum && cellNum! < valNum!;
    case ">=":
      return bothNum && cellNum! >= valNum!;
    case "<=":
      return bothNum && cellNum! <= valNum!;
    default:
      throw new Error(`unknown operator "${op}" — use one of ==, !=, >, <, >=, <=, contains, in`);
  }
}

function aggregateLabel(spec: AggregateSpec): string {
  return spec.fn === "count" && !spec.col ? "count" : `${spec.fn}(${spec.col ?? "*"})`;
}

function computeAggregate(spec: AggregateSpec, groupRows: Row[]): number {
  if (spec.fn === "count") return groupRows.length;
  if (!spec.col) throw new Error(`aggregate "${spec.fn}" requires a "col"`);
  const nums = groupRows
    .map((r) => parseGermanNumber(r[spec.col!] ?? ""))
    .filter((n): n is number => n !== null);
  if (nums.length === 0) return 0;
  switch (spec.fn) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    default:
      throw new Error(`unknown aggregate function "${spec.fn}"`);
  }
}

/**
 * Runs a declarative query. `resolve` maps a file reference to a parsed Table
 * (kept out of the engine so it stays pure and testable).
 */
export function runQuery(query: TableQuery, resolve: (file: string) => Table): QueryResult {
  const table = resolve(query.file);

  // 1) Join (inner keeps matches, anti keeps rows with NO match).
  let working: Table = table;
  if (query.join) {
    const right = resolve(query.join.file);
    assertColumn(table, query.join.leftCol, query.file);
    assertColumn(right, query.join.rightCol, query.join.file);
    const rightKeys = new Set(right.rows.map((r) => (r[query.join!.rightCol] ?? "").trim()));
    const rightByKey = new Map<string, Row>();
    for (const r of right.rows) {
      const k = (r[query.join.rightCol] ?? "").trim();
      if (!rightByKey.has(k)) rightByKey.set(k, r);
    }
    const extraCols = right.columns.filter((c) => !table.columns.includes(c));
    const joinedRows: Row[] = [];
    for (const l of table.rows) {
      const key = (l[query.join.leftCol] ?? "").trim();
      const hit = rightKeys.has(key);
      if (query.join.type === "anti") {
        if (!hit) joinedRows.push(l);
      } else if (hit) {
        const rr = rightByKey.get(key)!;
        const merged: Row = { ...l };
        for (const c of extraCols) merged[c] = rr[c] ?? "";
        joinedRows.push(merged);
      }
    }
    const cols = query.join.type === "anti" ? table.columns : [...table.columns, ...extraCols];
    working = { columns: cols, rows: joinedRows };
  }

  // 2) Where filters (AND).
  if (query.where) {
    for (const clause of query.where) assertColumn(working, clause.col, query.file);
    working = {
      columns: working.columns,
      rows: working.rows.filter((r) => query.where!.every((c) => matches(r, c))),
    };
  }

  // 3) Group + aggregate. groupBy without aggregate implies a count per group;
  //    aggregate without groupBy folds the whole table into one row.
  if (query.groupBy || query.aggregate) {
    const groupCols = query.groupBy ?? [];
    for (const c of groupCols) assertColumn(working, c, query.file);
    const aggs = query.aggregate ?? [{ fn: "count" as const }];
    for (const a of aggs) if (a.col) assertColumn(working, a.col, query.file);

    const groups = new Map<string, { key: string[]; rows: Row[] }>();
    // Whole-table aggregate (no groupBy) always yields exactly one row, even
    // over zero input rows — so "count" of an empty anti-join reads 0, not "".
    if (groupCols.length === 0) groups.set("[]", { key: [], rows: [] });
    for (const r of working.rows) {
      const key = groupCols.map((c) => r[c] ?? "");
      const gk = JSON.stringify(key);
      if (!groups.has(gk)) groups.set(gk, { key, rows: [] });
      groups.get(gk)!.rows.push(r);
    }
    const columns = [...groupCols, ...aggs.map(aggregateLabel)];
    const rows: (string | number)[][] = [];
    for (const g of groups.values()) {
      rows.push([...g.key, ...aggs.map((a) => computeAggregate(a, g.rows))]);
    }
    return cap(columns, rows, query.limit);
  }

  // 4) Plain projection.
  const cols = query.select ?? working.columns;
  if (query.select) for (const c of query.select) assertColumn(working, c, query.file);
  const rows = working.rows.map((r) => cols.map((c) => r[c] ?? ""));
  return cap(cols, rows, query.limit);
}

function cap(
  columns: string[],
  rows: (string | number)[][],
  limit?: number,
): QueryResult {
  const max = Math.min(limit ?? OUTPUT_ROW_CAP, OUTPUT_ROW_CAP);
  return {
    columns,
    rows: rows.slice(0, max),
    totalRows: rows.length,
    truncated: rows.length > max,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Renders a QueryResult as a compact pipe-separated text table with a footer. */
export function formatQueryResult(result: QueryResult): string {
  const fmt = (v: string | number): string =>
    typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
  const lines: string[] = [];
  lines.push(result.columns.join(" | "));
  lines.push(result.columns.map(() => "---").join(" | "));
  for (const row of result.rows) lines.push(row.map(fmt).join(" | "));
  const footer = result.truncated
    ? `${result.totalRows} rows (showing first ${result.rows.length})`
    : `${result.totalRows} rows`;
  lines.push(footer);
  return lines.join("\n");
}
