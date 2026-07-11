/**
 * The ERP stand-in.
 *
 * A real abas/Sage installation is a relational database; node:sqlite is already a
 * production dependency of this repo (src/memory/sqlite-memory.ts), so it costs nothing.
 *
 * The binary file is NOT byte-hashed: node:sqlite stamps SQLITE_VERSION into the header.
 * Determinism is proven over a canonical SQL text dump instead, which this module returns.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { deNumber } from "../lib/fmt.js";
import type { World } from "../model/types.js";

const SCHEMA = `
CREATE TABLE kunden (id TEXT PRIMARY KEY, name TEXT NOT NULL, ort TEXT NOT NULL, plz TEXT NOT NULL, segment TEXT NOT NULL, umsatzanteil REAL NOT NULL);
CREATE TABLE lieferanten (id TEXT PRIMARY KEY, name TEXT NOT NULL, ort TEXT NOT NULL, plz TEXT NOT NULL, liefert TEXT NOT NULL);
CREATE TABLE artikel (id TEXT PRIMARY KEY, artikelnr TEXT NOT NULL, bezeichnung TEXT NOT NULL, art TEXT NOT NULL, werkstoff TEXT NOT NULL, oberflaeche TEXT NOT NULL, listenpreis REAL NOT NULL, kunde_id TEXT NOT NULL);
CREATE TABLE auftraege (id TEXT PRIMARY KEY, auftragsnr TEXT NOT NULL, kunde_id TEXT NOT NULL, artikel_id TEXT NOT NULL, menge INTEGER NOT NULL, stueckpreis REAL NOT NULL, bestelldatum TEXT NOT NULL, liefertermin TEXT NOT NULL);
CREATE TABLE rechnungen (id TEXT PRIMARY KEY, rechnungsnr TEXT NOT NULL, auftrag_id TEXT NOT NULL, rechnungsdatum TEXT NOT NULL, nettobetrag REAL NOT NULL, reklamiert INTEGER NOT NULL);
CREATE TABLE lieferscheine (id TEXT PRIMARY KEY, lieferscheinnr TEXT NOT NULL, auftrag_id TEXT NOT NULL, versanddatum TEXT NOT NULL, menge INTEGER NOT NULL);
CREATE TABLE werkzeuge (id TEXT PRIMARY KEY, werkzeugnr TEXT NOT NULL, artikel_id TEXT NOT NULL, gebaut TEXT NOT NULL, standzeit_soll INTEGER NOT NULL);
CREATE TABLE maschinen (id TEXT PRIMARY KEY, inventarnr TEXT NOT NULL, typ TEXT NOT NULL, halle TEXT NOT NULL, aufgestellt TEXT NOT NULL, seriennr TEXT);
CREATE TABLE wartung (id TEXT PRIMARY KEY, maschine_id TEXT NOT NULL, datum TEXT NOT NULL, techniker TEXT NOT NULL, notiz TEXT NOT NULL);
CREATE TABLE mitarbeiter (id TEXT PRIMARY KEY, nachname TEXT NOT NULL, vorname TEXT NOT NULL, abteilung TEXT NOT NULL, rolle TEXT NOT NULL, email TEXT NOT NULL, eintritt TEXT NOT NULL, austritt TEXT);
`;

type Row = ReadonlyArray<string | number | null>;

export interface ErpResult {
  /** Canonical SQL text. This, not the .sqlite file, is what determinism is proven over. */
  readonly sqlDump: string;
}

export function writeErpDatabase(world: World, filePath: string): ErpResult {
  mkdirSync(dirname(filePath), { recursive: true });
  rmSync(filePath, { force: true });
  rmSync(`${filePath}-journal`, { force: true });
  const db = new DatabaseSync(filePath);
  try {
    db.exec(SCHEMA);
    const inserts: string[] = [];

    const insert = (table: string, columns: readonly string[], rows: readonly Row[]): void => {
      const placeholders = columns.map(() => "?").join(", ");
      const statement = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
      for (const row of rows) {
        statement.run(...row);
        inserts.push(`INSERT INTO ${table} VALUES (${row.map(sqlLiteral).join(",")});`);
      }
    };

    insert("kunden", ["id", "name", "ort", "plz", "segment", "umsatzanteil"],
      world.customers.map((c) => [c.id, c.name, c.town, c.plz, c.segment, c.revenueShare]));
    insert("lieferanten", ["id", "name", "ort", "plz", "liefert"],
      world.suppliers.map((s) => [s.id, s.name, s.town, s.plz, s.supplies]));
    insert("artikel", ["id", "artikelnr", "bezeichnung", "art", "werkstoff", "oberflaeche", "listenpreis", "kunde_id"],
      world.articles.map((a) => [a.id, a.articleNo, a.name, a.kind, a.material, a.surface, a.listPriceEur, a.customerId]));
    insert("auftraege", ["id", "auftragsnr", "kunde_id", "artikel_id", "menge", "stueckpreis", "bestelldatum", "liefertermin"],
      world.orders.map((o) => [o.id, o.orderNo, o.customerId, o.articleId, o.quantity, o.erpUnitPriceEur, o.orderedIso, o.dueIso]));
    // Invoices and delivery notes exist ONLY here — never as files on the fileserver.
    insert("rechnungen", ["id", "rechnungsnr", "auftrag_id", "rechnungsdatum", "nettobetrag", "reklamiert"],
      world.invoices.map((r) => [r.id, r.invoiceNo, r.orderId, r.issuedIso, r.netEur, r.disputed ? 1 : 0]));
    insert("lieferscheine", ["id", "lieferscheinnr", "auftrag_id", "versanddatum", "menge"],
      world.deliveries.map((l) => [l.id, l.deliveryNo, l.orderId, l.shippedIso, l.quantity]));
    insert("werkzeuge", ["id", "werkzeugnr", "artikel_id", "gebaut", "standzeit_soll"],
      world.tools.map((w) => [w.id, w.toolNo, w.articleId, w.builtIso, w.expectedStrokes]));
    insert("maschinen", ["id", "inventarnr", "typ", "halle", "aufgestellt", "seriennr"],
      world.machines.map((m) => [m.id, m.inventoryNo, m.type, m.hall, m.installedIso, m.serialNo]));
    insert("wartung", ["id", "maschine_id", "datum", "techniker", "notiz"],
      world.maintenance.map((w) => [w.id, w.machineId, w.dateIso, w.technician, w.note]));
    insert("mitarbeiter", ["id", "nachname", "vorname", "abteilung", "rolle", "email", "eintritt", "austritt"],
      world.employees.map((e) => [e.id, e.lastName, e.firstName, e.department, e.role, e.email, e.hiredIso, e.leftIso]));

    return { sqlDump: `${SCHEMA.trim()}\n${inserts.join("\n")}\n` };
  } finally {
    db.close();
  }
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The stale export nobody has looked at since 2019. It contradicts the live erp.sqlite:
 * the hero article carries the old price, and three articles no longer exist.
 * CP1252 + semicolon + decimal comma, exactly as the old system wrote it.
 */
export function buildStaleExport2019(world: World): string {
  const rows = ["Artikelnr;Bezeichnung;Werkstoff;Listenpreis EUR;Stand"];
  const hero = world.articles[0];
  if (!hero) throw new Error("no articles");
  rows.push(`${hero.articleNo};${hero.name};${hero.material};${deNumber(1.08)};31.12.2019`);
  for (const article of world.articles.slice(1, 18)) {
    rows.push(
      `${article.articleNo};${article.name};${article.material};` +
      `${deNumber(article.listPriceEur * 0.86)};31.12.2019`,
    );
  }
  rows.push("DF-99001-SH;Druckfeder 8x25, SH (ausgelaufen);SH (DIN EN 10270-1);0,74;31.12.2019");
  rows.push("SB-44210-DH;Stanzbiegeteil 20x60 (ausgelaufen);DC01 (1.0330);2,31;31.12.2019");
  return rows.join("\r\n");
}
