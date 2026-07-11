import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectDelimiter,
  formatQueryResult,
  parseCsv,
  parseGermanNumber,
  runQuery,
  type Table,
  type TableQuery,
} from "../src/tools/table-query.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// A tiny in-memory resolver so the pure engine can be tested without any FS.
function resolverFor(tables: Record<string, string>): (file: string) => Table {
  return (file) => {
    const text = tables[file];
    if (text === undefined) throw new Error(`no such file: ${file}`);
    return parseCsv(text);
  };
}

describe("CSV parsing", () => {
  it("detects the delimiter from the header line", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
  });

  it("parses semicolon-delimited data with a header row", () => {
    const t = parseCsv("Artikelnr;Preis\nDF-1;1,08\nDF-2;4,83");
    expect(t.columns).toEqual(["Artikelnr", "Preis"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual({ Artikelnr: "DF-1", Preis: "1,08" });
  });

  it("parses comma-delimited data", () => {
    const t = parseCsv("a,b\n1,2");
    expect(t.columns).toEqual(["a", "b"]);
    expect(t.rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("honours quoted fields containing the delimiter and escaped quotes", () => {
    const t = parseCsv('name;note\n"Meier; Co";"sagt ""hallo"""');
    expect(t.rows[0]).toEqual({ name: "Meier; Co", note: 'sagt "hallo"' });
  });

  it("handles quoted fields spanning a newline", () => {
    const t = parseCsv('a;b\n"line1\nline2";x');
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.a).toBe("line1\nline2");
  });
});

describe("German number parsing", () => {
  it("reads a decimal comma", () => {
    expect(parseGermanNumber("1,08")).toBeCloseTo(1.08);
  });
  it("reads grouping dot with decimal comma", () => {
    expect(parseGermanNumber("1.234,56")).toBeCloseTo(1234.56);
  });
  it("reads plain integers and English decimals", () => {
    expect(parseGermanNumber("1234")).toBe(1234);
    expect(parseGermanNumber("12.5")).toBeCloseTo(12.5);
  });
  it("returns null for non-numeric text", () => {
    expect(parseGermanNumber("DF-12040")).toBeNull();
    expect(parseGermanNumber("")).toBeNull();
  });
});

describe("query engine — where filters", () => {
  const tables = {
    "erp/export.csv": "Artikelnr;Werkstoff;Listenpreis EUR\nDF-1;DH;1,08\nDF-2;SH;4,83\nDF-3;DH;12,50",
  };
  const run = (q: TableQuery) => runQuery(q, resolverFor(tables));

  it("filters with == on a string column", () => {
    const r = run({ file: "erp/export.csv", where: [{ col: "Werkstoff", op: "==", value: "DH" }] });
    expect(r.totalRows).toBe(2);
  });

  it("filters numerically with >= across the decimal comma", () => {
    const r = run({
      file: "erp/export.csv",
      where: [{ col: "Listenpreis EUR", op: ">=", value: 4.83 }],
      select: ["Artikelnr"],
    });
    expect(r.rows.map((row) => row[0])).toEqual(["DF-2", "DF-3"]);
  });

  it("supports contains and in", () => {
    expect(run({ file: "erp/export.csv", where: [{ col: "Artikelnr", op: "contains", value: "df-1" }] }).totalRows).toBe(1);
    expect(
      run({ file: "erp/export.csv", where: [{ col: "Werkstoff", op: "in", value: ["SH", "XY"] }] }).totalRows,
    ).toBe(1);
  });

  it("raises a helpful error naming available columns for an unknown column", () => {
    expect(() =>
      run({ file: "erp/export.csv", where: [{ col: "Preis", op: "==", value: 1 }] }),
    ).toThrow(/unknown column "Preis".*available columns: Artikelnr, Werkstoff, Listenpreis EUR/);
  });
});

describe("query engine — groupBy + aggregate", () => {
  const tables = {
    "erp/export.csv": "Artikelnr;Werkstoff;Preis\nA;DH;1,00\nB;DH;3,00\nC;SH;10,00",
  };
  const run = (q: TableQuery) => runQuery(q, resolverFor(tables));

  it("groups and counts (implicit count when no aggregate given)", () => {
    const r = run({ file: "erp/export.csv", groupBy: ["Werkstoff"] });
    expect(r.columns).toEqual(["Werkstoff", "count"]);
    const byMat = Object.fromEntries(r.rows.map((row) => [row[0], row[1]]));
    expect(byMat).toEqual({ DH: 2, SH: 1 });
  });

  it("computes sum and avg per group", () => {
    const r = run({
      file: "erp/export.csv",
      groupBy: ["Werkstoff"],
      aggregate: [{ fn: "sum", col: "Preis" }, { fn: "avg", col: "Preis" }],
    });
    expect(r.columns).toEqual(["Werkstoff", "sum(Preis)", "avg(Preis)"]);
    const dh = r.rows.find((row) => row[0] === "DH")!;
    expect(dh[1]).toBeCloseTo(4);
    expect(dh[2]).toBeCloseTo(2);
  });

  it("aggregates the whole table when no groupBy is given", () => {
    const r = run({ file: "erp/export.csv", aggregate: [{ fn: "count" }] });
    expect(r.rows).toEqual([[3]]);
  });
});

describe("query engine — joins", () => {
  const tables = {
    "dms/docuware-index.csv": "Dokument-ID;Aktenzeichen\nDW-1;2024-1001\nDW-2;2024-1002\nDW-3;9999-0000",
    "orders.csv": "auftragsnr;kunde\n2024-1001;Sundern\n2024-1002;Kirchbaum",
  };
  const run = (q: TableQuery) => runQuery(q, resolverFor(tables));

  it("inner join keeps only matching rows and merges columns", () => {
    const r = run({
      file: "dms/docuware-index.csv",
      join: { file: "orders.csv", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "inner" },
    });
    expect(r.totalRows).toBe(2);
    expect(r.columns).toContain("kunde");
  });

  it("anti join keeps rows with NO match (orphans)", () => {
    const r = run({
      file: "dms/docuware-index.csv",
      join: { file: "orders.csv", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "anti" },
    });
    expect(r.totalRows).toBe(1);
    expect(r.rows[0]![0]).toBe("DW-3");
  });

  it("anti join combined with count answers 'how many orphans'", () => {
    const r = run({
      file: "dms/docuware-index.csv",
      join: { file: "orders.csv", leftCol: "Aktenzeichen", rightCol: "auftragsnr", type: "anti" },
      aggregate: [{ fn: "count" }],
    });
    expect(r.rows).toEqual([[1]]);
  });
});

describe("rendering + limit", () => {
  it("renders a compact table with a row-count footer", () => {
    const r = runQuery(
      { file: "t.csv", select: ["a"] },
      resolverFor({ "t.csv": "a;b\n1;x\n2;y" }),
    );
    const text = formatQueryResult(r);
    expect(text).toContain("a\n---\n1\n2");
    expect(text).toContain("2 rows");
  });

  it("caps output and flags truncation", () => {
    const many = "a\n" + Array.from({ length: 60 }, (_, i) => String(i)).join("\n");
    const r = runQuery({ file: "t.csv", limit: 100 }, resolverFor({ "t.csv": many }));
    expect(r.rows).toHaveLength(50);
    expect(r.truncated).toBe(true);
    expect(formatQueryResult(r)).toContain("60 rows (showing first 50)");
  });
});

// Integration against the generated demo-company corpus — skipped when absent
// (company/ is a local artifact, not in git). Mirrors tests/office-extractors.
const CORPUS = join(__dirname, "..", "company", "out", "corpus");
const maybe = existsSync(CORPUS) ? describe : describe.skip;

maybe("table-query on the demo-company corpus", () => {
  const load = (rel: string): Table => parseCsv(readFileSync(join(CORPUS, rel), "utf8"));
  const resolve = (file: string): Table => load(file);

  it("counts DocuWare documents per type", () => {
    const r = runQuery({ file: "dms/docuware-index.csv", groupBy: ["Dokumenttyp"] }, resolve);
    expect(r.columns).toEqual(["Dokumenttyp", "count"]);
    expect(r.totalRows).toBeGreaterThan(0);
  });

  it("anti-joins DocuWare 'Erfasst durch' against AD users (orphaned accounts)", () => {
    const r = runQuery(
      {
        file: "dms/docuware-index.csv",
        join: { file: "ad/users.csv", leftCol: "Erfasst durch", rightCol: "SamAccountName", type: "anti" },
        aggregate: [{ fn: "count" }],
      },
      resolve,
    );
    expect(typeof r.rows[0]![0]).toBe("number");
  });
});
