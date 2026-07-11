/**
 * The four systems next to the fileserver, the mail and the ERP.
 *
 * A Mittelständler does not have one system. It has a half-finished DocuWare, a machine-data
 * export nobody wrote a works agreement for, a DATEV handover to the tax adviser, and a CAD
 * vault on a drive that is not in the backup scope. Each of them contradicts the others in
 * a way that is COMPUTABLE, which is the only reason they are here.
 *
 * They are ordinary DocumentFacts with a body. That is deliberate: writeDocuments() already
 * knows how to write a body, the manifest already knows how to describe one, and world.json
 * already strips them. No new emitter, no new World field, no new code path.
 *
 * They are appended AFTER injectMess() runs, so their paths stay stable — with one exception
 * that is the entire point: the DocuWare index records the paths of the BULK documents as
 * they were at capture time. The mess injector then renames some of them. Nobody updates the
 * index. The dangling entries are not authored; they are what is left over.
 */
import { BASE_DATE } from "../seed.config.js";
import { addDays, isoDate, parseIsoDate } from "../lib/fmt.js";
import { asciiFold } from "../lib/de.js";
import type { Rng } from "../lib/rand.js";
import type {
  Article, Customer, DocumentFact, Employee, Invoice, Machine, Order, ToolAsset,
} from "./types.js";

export interface SystemsCtx {
  readonly rng: Rng;
  readonly employees: readonly Employee[];
  readonly customers: readonly Customer[];
  readonly articles: readonly Article[];
  readonly orders: readonly Order[];
  readonly invoices: readonly Invoice[];
  readonly machines: readonly Machine[];
  readonly tools: readonly ToolAsset[];
  /** The bulk documents BEFORE injectMess() renamed any of them. */
  readonly capturedDocuments: readonly DocumentFact[];
}

/* -------------------------------------------------------------------------- */
/* DocuWare — the half-finished DMS                                            */
/* -------------------------------------------------------------------------- */

/**
 * Phase 1 reached Vertrieb and QM. Phase 2 was never commissioned. That is the shape of
 * every DMS rollout in a 140-person company: it stops when the budget year ends.
 */
const DMS_SCOPE = ["fileserver/Vertrieb/", "fileserver/QM/"] as const;

/** Nothing has been captured since. The coverage gap is therefore derivable from a date. */
export const DMS_ROLLOUT_STOPPED = "2025-07-01";

/**
 * Phase 1 went live here. A DMS capture date is a SYSTEM field ("gespeichert am") and cannot
 * predate the go-live, however old the document itself is. So a 2019 work instruction gets a
 * 2025 capture date, not a 2019 one — the backlog was scanned in a campaign after go-live.
 */
const DMS_GO_LIVE = "2025-05-05";

/** The backlog scan ran for about eight weeks after go-live. */
const DMS_BACKLOG_DAYS = 55;

/** For documents created after go-live, capture lagged filing by up to two weeks. */
const DMS_CAPTURE_LAG_DAYS = 14;

function buildDocuwareIndex(ctx: SystemsCtx): DocumentFact {
  const capturers = ctx.employees
    .filter((e) => (e.department === "vertrieb" || e.department === "qs") && !e.leftIso)
    .map((e) => e.samAccountName);

  const rows = [
    "Dokument-ID;Erfassungsdatum;Dokumenttyp;Aktenzeichen;Dateiname;Ablagepfad;Erfasst durch;Status",
  ];
  let n = 0;
  for (const doc of ctx.capturedDocuments) {
    if (!DMS_SCOPE.some((prefix) => doc.path.startsWith(prefix))) continue;
    if (doc.createdIso >= DMS_ROLLOUT_STOPPED) continue;

    // Documents older than the go-live were scanned in the backlog campaign; newer ones were
    // captured shortly after filing. Either way the capture date is at or after go-live.
    const captured = doc.createdIso < DMS_GO_LIVE
      ? isoDate(addDays(parseIsoDate(DMS_GO_LIVE), ctx.rng.int(0, DMS_BACKLOG_DAYS)))
      : isoDate(addDays(parseIsoDate(doc.createdIso), ctx.rng.int(0, DMS_CAPTURE_LAG_DAYS)));
    const fileName = doc.path.slice(doc.path.lastIndexOf("/") + 1);
    const shareRelative = doc.path.slice("fileserver/".length);
    rows.push([
      `DW-${String(++n).padStart(6, "0")}`,
      captured,
      doc.kind,
      /(\d{4}-\d{4})/.exec(doc.path)?.[1] ?? "",
      fileName,
      `K:\\${shareRelative.replace(/\//g, "\\")}`,
      ctx.rng.pick(capturers),
      ctx.rng.pick(["Erfasst", "Erfasst", "Geprüft"]),
    ].join(";"));
  }

  return {
    id: "dok:dms-index",
    path: "dms/docuware-index.csv",
    kind: "DocuWare-Index",
    format: "csv",
    ownerId: "emp:0007",
    createdIso: "2025-08-14",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["sys:docuware"],
    supersededBy: null,
    isDistractor: false,
    body: rows.join("\r\n"),
  };
}

const DOCUWARE_NOTE: string = [
  "DocuWare — Sachstand",
  "====================",
  "",
  "Phase 1 (Vertrieb, QM) abgeschlossen 06/2025. Die letzten Nachzügler wurden Anfang",
  "Juli nachgescannt. Phase 2 (Einkauf, Buchhaltung, Personal) wurde nicht beauftragt.",
  "",
  "Seither wird nichts mehr erfasst. Der Index bildet den Stand von damals ab.",
  "Dateien, die seitdem umbenannt oder verschoben wurden, laufen im Index ins Leere.",
  "Wie viele es sind, weiß ich nicht.",
  "",
  "D. Nettelbeck, 14.08.2025",
  "",
].join("\r\n");

/* -------------------------------------------------------------------------- */
/* BDE — machine data, and the works agreement that was never signed           */
/* -------------------------------------------------------------------------- */

/**
 * Only twelve of the 34 machines are wired to the BDE. The 2019 pilot connected Halle 1 and
 * Halle 2; the rest still get a paper Schichtzettel. Half-rolled-out is the normal state.
 */
const BDE_CONNECTED_MACHINES = 12;

/** The months in the export folder. They bracket the change the Betriebsrat complains about. */
const BDE_LAST_MONTH = "2026-06";
const BDE_MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", BDE_LAST_MONTH] as const;

/**
 * From this month on, the export carries Personalnummer and Mitarbeiter. mail:0003 and the
 * Betriebsratsprotokoll say the QS started evaluating personal data "seit April" — this is
 * the data that proves it, and the June file proves nobody stopped after the BR demanded it.
 */
export const BDE_PERSONAL_FROM = "2026-04";

/** Planned busy time per shift: 8 h minus breaks. Laufzeit is this minus Stillstand. */
const BDE_BELEGUNGSZEIT_MIN = 450;

/** Feiertage in NRW 2026 (Ostersonntag 05.04.). A plant does not book on these days. */
const HOLIDAYS_NRW_2026: ReadonlySet<string> = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
  "2026-05-14", "2026-05-25", "2026-06-04", "2026-10-03",
]);

const STILLSTAND_REASONS = [
  "Werkzeugwechsel", "Materialmangel", "Störung Vorschub", "Rüsten",
  "Wartung geplant", "Drahtbruch", "Qualitätsprüfung",
] as const;

function isBookingDay(iso: string): boolean {
  if (HOLIDAYS_NRW_2026.has(iso)) return false;
  const weekday = new Date(parseIsoDate(iso)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function daysOfMonth(month: string): string[] {
  const first = parseIsoDate(`${month}-01`);
  const days: string[] = [];
  for (let i = 0; i < 31; i++) {
    const iso = isoDate(addDays(first, i));
    if (!iso.startsWith(month)) break;
    if (isBookingDay(iso)) days.push(iso);
  }
  return days;
}

function buildBdeExports(ctx: SystemsCtx): DocumentFact[] {
  const machines = ctx.machines
    .filter((m) => m.hall === "Halle 1" || m.hall === "Halle 2")
    .slice(0, BDE_CONNECTED_MACHINES);
  if (machines.length < BDE_CONNECTED_MACHINES) {
    throw new Error(`nur ${machines.length} Maschinen in Halle 1/2 — BDE_CONNECTED_MACHINES zu hoch`);
  }
  const operators = ctx.employees.filter((e) => e.department === "fertigung" && !e.leftIso);
  const activeByDay = new Map<string, Order[]>();
  const activeOn = (iso: string): readonly Order[] => {
    let active = activeByDay.get(iso);
    if (!active) {
      active = ctx.orders.filter((o) => o.orderedIso <= iso && iso <= o.dueIso);
      if (active.length === 0) active = ctx.orders.slice(0, 1);
      activeByDay.set(iso, active);
    }
    return active;
  };

  return BDE_MONTHS.map((month) => {
    const personal = month >= BDE_PERSONAL_FROM;
    const header = [
      "Datum", "Schicht", "Maschine", "Inventarnr", "Auftrag",
      ...(personal ? ["Personalnummer", "Mitarbeiter"] : []),
      "Gutstueck", "Ausschuss", "Belegungszeit min", "Laufzeit min", "Stillstand min", "Stillstandsgrund",
    ];
    const rows = [header.join(";")];

    for (const day of daysOfMonth(month)) {
      for (const shift of ["F", "S"] as const) {
        for (const machine of machines) {
          const operator = ctx.rng.pick(operators);
          const order = ctx.rng.pick(activeOn(day));
          const good = ctx.rng.int(800, 24_000);
          const downtime = ctx.rng.chance(0.22) ? ctx.rng.int(5, 180) : 0;
          // 450 min planned busy time per shift (8 h minus breaks). Laufzeit = Belegungszeit
          // minus Stillstand, so an agent can compute availability (OEE's first factor).
          rows.push([
            day, shift, machine.id.replace("masch:", ""), machine.inventoryNo, order.orderNo,
            ...(personal ? [operator.id.replace("emp:", ""), `${operator.lastName}, ${operator.firstName}`] : []),
            String(good),
            String(ctx.rng.int(0, Math.max(1, Math.round(good * 0.02)))),
            String(BDE_BELEGUNGSZEIT_MIN),
            String(BDE_BELEGUNGSZEIT_MIN - downtime),
            String(downtime),
            downtime > 0 ? ctx.rng.pick(STILLSTAND_REASONS) : "",
          ].join(";"));
        }
      }
    }

    return {
      id: `dok:bde-${month}`,
      path: `bde/BDE_Export_${month}.csv`,
      kind: "BDE-Export",
      format: "csv",
      ownerId: "emp:0005",
      createdIso: isoDate(addDays(parseIsoDate(`${month}-01`), 32)),
      // The whole finding in one field: from April the export is personal data, and nobody
      // reclassified the folder, because nobody reclassifies a folder.
      sensitivity: personal ? "personal-data" : "internal",
      hasTextLayer: true,
      derivedFrom: ["sys:bde", ...(personal ? ["mail:0003"] : [])],
      supersededBy: null,
      isDistractor: false,
      body: rows.join("\r\n"),
    } satisfies DocumentFact;
  });
}

/* -------------------------------------------------------------------------- */
/* DATEV — the handover to the tax adviser                                     */
/* -------------------------------------------------------------------------- */

/** The financial year handed over. The AVV with DATEV (a hero PDF) covers exactly this. */
const DATEV_YEAR = "2025";

/**
 * DATEV stamps the export moment into the header. Fixed, because Date.now() is forbidden
 * here: the Buchungsstapel went to the Steuerberater on 14.01.2026, 09:30.
 */
const DATEV_EXPORTED_AT = "20260114093000000";

/** Standard-Kontenrahmen SKR 03: 8400 = Erlöse 19 % USt, Debitoren ab 10000. */
const SKR03_ERLOESE_19 = "8400";
const SKR03_DEBITOR_BASE = 10_000;

/**
 * 8400 is an Automatikkonto: DATEV computes the 19 % VAT itself and expects the GROSS amount,
 * not the net. Booking net here would understate both revenue and VAT — the exact mistake a
 * bookkeeper spots in one glance. So the net from the ERP is grossed up by the standard rate.
 */
const UST_REGELSATZ = 1.19;

/** DATEV writes amounts without a thousands separator. deNumber() would insert one. */
function datevAmount(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function buildDatevStapel(ctx: SystemsCtx): DocumentFact {
  const debitor = new Map(ctx.customers.map((c, index) => [c.id, SKR03_DEBITOR_BASE + index]));
  const orderById = new Map(ctx.orders.map((o) => [o.id, o]));
  const customerById = new Map(ctx.customers.map((c) => [c.id, c]));

  // DATEV-Format 700, Buchungsstapel Version 13. The empty fields are real: the spec has
  // them, and an export fills only what it has.
  const preamble = [
    `"EXTF";700;21;"Buchungsstapel";13;${DATEV_EXPORTED_AT};;"RE";"Selkinghaus";"";29098;54321`,
    `${DATEV_YEAR}0101;4;${DATEV_YEAR}0101;${DATEV_YEAR}1231;"Buchungen ${DATEV_YEAR}";"";1;0;0;"EUR"`,
  ].join(";");
  const header = [
    "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs",
    "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)",
    "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
  ].join(";");

  const rows = [preamble, header];
  for (const invoice of ctx.invoices) {
    if (!invoice.issuedIso.startsWith(DATEV_YEAR)) continue;
    const order = orderById.get(invoice.orderId);
    if (!order) throw new Error(`Rechnung ${invoice.id} ohne Auftrag`);
    const customer = customerById.get(order.customerId);
    if (!customer) throw new Error(`Auftrag ${order.id} ohne Kunde`);

    // An Ausgangsrechnung debits the customer's receivable and credits revenue: Konto is the
    // Debitor, Gegenkonto the Erlöskonto 8400, Soll/Haben = S. The BU-Schlüssel stays empty
    // because 8400 already carries the tax rate as an Automatikkonto.
    const gross = Math.round(invoice.netEur * UST_REGELSATZ * 100) / 100;
    rows.push([
      datevAmount(gross), "S", "", "", "", "",
      String(debitor.get(customer.id) ?? SKR03_DEBITOR_BASE),
      SKR03_ERLOESE_19,
      "",
      `${invoice.issuedIso.slice(8, 10)}${invoice.issuedIso.slice(5, 7)}`,
      invoice.invoiceNo, order.orderNo, "",
      `Rechnung ${asciiFold(customer.name).slice(0, 30)}`,
    ].join(";"));
  }

  return {
    id: "dok:datev-stapel",
    path: `datev/EXTF_Buchungsstapel_${DATEV_YEAR}.csv`,
    kind: "DATEV-Buchungsstapel",
    format: "csv",
    ownerId: "emp:0012",
    createdIso: "2026-01-14",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["erp:sqlite", "dok:fixture-avv-datev"],
    supersededBy: null,
    isDistractor: false,
    body: rows.join("\r\n"),
  };
}

/* -------------------------------------------------------------------------- */
/* PDM — the CAD index, and the field somebody misused twenty years ago        */
/* -------------------------------------------------------------------------- */

/**
 * The migration mail (mail:0004) says the old tool number sits in the drawing-number field
 * for "rund 1.400 Artikel". That number is the IT-Leiter's estimate, taken from a row count
 * in the retired Sage export, and it is wrong: most of those articles have been discontinued.
 * The PDM index is the only place the true count can be obtained — by counting.
 *
 * The rule is not random. A stamped part WAS its tool: whoever keyed the master data typed
 * the tool number into the drawing-number field, because for a stamped part that was the
 * identity. Wire products, which have no tool, got a proper Z-drawing number.
 *
 * Every row is a .SLDPRT model, not a drawing. In SolidWorks the part is the primary
 * document; a .SLDDRW cannot exist without a model to reference. The file format therefore
 * does not depend on whether a tool exists — only the misused Zeichnungsnummer field does.
 */
const PDM_VAULT_DRIVE = "M:\\CAD";

function buildPdmIndex(ctx: SystemsCtx): DocumentFact {
  const toolByArticle = new Map<string, ToolAsset>();
  for (const tool of ctx.tools) {
    if (!toolByArticle.has(tool.articleId)) toolByArticle.set(tool.articleId, tool);
  }
  const designers = ctx.employees
    .filter((e) => e.department === "konstruktion" && !e.leftIso)
    .map((e) => e.samAccountName);

  const rows = [
    "Dokumentnummer;Benennung;Werkstoff;Zeichnungsnummer;Revision;Status;Ersteller;" +
    "Aenderungsdatum;Dateiname;Format;Groesse Bytes;Ablage",
  ];
  ctx.articles.forEach((article, index) => {
    const tool = toolByArticle.get(article.id);
    const changed = isoDate(addDays(parseIsoDate("2016-01-01"), ctx.rng.int(0, 3_800)));
    rows.push([
      `DOK-${String(20_000 + index).padStart(6, "0")}`,
      article.name,
      article.material,
      // The migration blocker, as data: a tool number where a drawing number belongs.
      tool ? tool.toolNo : `Z-${article.articleNo}`,
      String(ctx.rng.int(1, 5)),
      ctx.rng.pick(["freigegeben", "freigegeben", "in Arbeit", "gesperrt"]),
      ctx.rng.pick(designers),
      changed,
      `${article.articleNo}.SLDPRT`,
      "SLDPRT",
      String(ctx.rng.int(180_000, 4_200_000)),
      `${PDM_VAULT_DRIVE}\\${article.kind}`,
    ].join(";"));
  });

  return {
    id: "dok:pdm-index",
    path: "pdm/cad-index.csv",
    kind: "PDM-Index",
    format: "csv",
    ownerId: "emp:0010",
    createdIso: "2026-05-04",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["sys:pdm", "mail:0004"],
    supersededBy: null,
    isDistractor: false,
    body: rows.join("\r\n"),
  };
}

const PDM_NOTE: string = [
  "SolidWorks-PDM — Ablage",
  "=======================",
  "",
  `Die CAD-Dateien liegen im Tresor auf ${PDM_VAULT_DRIVE} und sind nicht Teil dieses`,
  "Exports. Hier liegt ausschließlich der Index.",
  "",
  "Die Metadaten stehen im Index, nicht als Sidecar neben der Datei. Wer eine .SLDDRW",
  "kopiert, kopiert keine Metadaten mit — das ist der Grund, warum die Zeichnungen im",
  "Austausch-Ordner nichts über ihre Revision aussagen.",
  "",
  "J. Eickhoff, Konstruktion",
  "",
].join("\r\n");

/* -------------------------------------------------------------------------- */

function note(id: string, path: string, ownerId: string, createdIso: string, body: string): DocumentFact {
  return {
    id, path, kind: "Notiz", format: "txt", ownerId, createdIso,
    sensitivity: "internal", hasTextLayer: true, derivedFrom: [],
    supersededBy: null, isDistractor: false, body,
  };
}

export function buildSystemDocuments(ctx: SystemsCtx): DocumentFact[] {
  if (BASE_DATE < `${BDE_LAST_MONTH}-30`) {
    throw new Error("BDE-Monate liegen hinter BASE_DATE — die Firma exportiert in die Zukunft");
  }
  return [
    buildDocuwareIndex(ctx),
    note("dok:dms-notiz", "dms/README_Migration.txt", "emp:0007", "2025-08-14", DOCUWARE_NOTE),
    ...buildBdeExports(ctx),
    buildDatevStapel(ctx),
    buildPdmIndex(ctx),
    note("dok:pdm-notiz", "pdm/README_CAD-Ablage.txt", "emp:0010", "2026-05-04", PDM_NOTE),
  ];
}
