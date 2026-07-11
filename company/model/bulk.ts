/**
 * The generated bulk.
 *
 * These documents carry no unique evaluation signal — the hand-authored ones in
 * narrative.ts do that. What the bulk buys is the thing a 41-file corpus cannot have:
 * retrieval that is actually hard, an ERP query that does not return five rows, and a
 * fileserver that looks like it has been in use since 1958.
 *
 * Every document is a PROJECTION of a business object in the fact model. An Angebot and a
 * Prüfprotokoll for the same order quote the same numbers, because both read the same
 * Order. Nothing here is invented at render time.
 *
 * Counts are derived in seed.config.ts from revenue, order value and yield ratios — never
 * chosen to hit a file count.
 */
import {
  COMPLAINT_RATE, INSPECTION_RATE, MONTHLY_DOCS, OFFER_RATE, TICKET_MAILS, WEEKLY_MEETINGS,
} from "../seed.config.js";
import { addDays, deEuro, deNumber, deDate, isoDate, parseIsoDate } from "../lib/fmt.js";
import { asciiFold } from "../lib/de.js";
import { CITED_NORMS } from "../lexicons/materials.js";
import type { Rng } from "../lib/rand.js";
import { DISPUTED_TOOL_NO, MAINTENANCE_NOTES, WINDOW_DAYS, WINDOW_START_MS } from "./catalog.js";
import { KEY_EMPLOYEES } from "./roster.js";
import type {
  Article, Customer, DocumentFact, Employee, Machine, MaintenanceEvent, MailMessage,
  MailThread, Order, ToolAsset,
} from "./types.js";

interface Ctx {
  readonly rng: Rng;
  readonly employees: readonly Employee[];
  readonly customers: readonly Customer[];
  readonly articles: readonly Article[];
  readonly orders: readonly Order[];
  readonly machines: readonly Machine[];
  readonly maintenance: readonly MaintenanceEvent[];
  readonly tools: readonly ToolAsset[];
}

function lookup<T extends { id: string }>(items: readonly T[], id: string, what: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`unknown ${what}: ${id}`);
  return found;
}

/** "Wittenbrink Antriebstechnik GmbH" -> "Wittenbrink" — how a filename would carry it. */
function shortName(name: string): string {
  return asciiFold(name.split(" ")[0] ?? name).replace(/[^A-Za-z0-9]/g, "");
}

function year(iso: string): string {
  return iso.slice(0, 4);
}

/**
 * Documents of the same kind must not all be the same length. Uniform lengths are the
 * classic generator tell, and verify.ts measures the coefficient of variation over exactly
 * these files to catch it.
 *
 * The variance has to come from CONTENT, not from padding: one offer quotes five price
 * tiers, the next quotes none; one inspection report measures six characteristics, the next
 * measures one. That is how the real documents differ, so that is how these do.
 */
function times<T>(rng: Rng, min: number, max: number, make: (index: number) => T): T[] {
  return Array.from({ length: rng.int(min, max) }, (_, index) => make(index));
}

/** Order quantities a Federnhersteller quotes tiers for. */
const TIER_QUANTITIES = [1_000, 5_000, 10_000, 25_000, 50_000] as const;

const OFFER_CLAUSES: readonly string[] = [
  "Mehr- oder Minderlieferung bis 10 % vorbehalten.",
  "Verpackung in Kleinladungsträgern nach Kundenvorgabe, Pfand berechnen wir gesondert.",
  "Materialteuerungszuschlag bleibt bei Drahtpreisänderung über 5 % vorbehalten.",
  "Erstmusterprüfbericht nach VDA Band 2 auf Anforderung.",
  "Abruffrist 12 Monate ab Auftragsbestätigung.",
  "Lieferung frei Haus ab einem Nettowert von 1.500,00 EUR.",
];

const OFFER_PREAMBLES: readonly string[] = [
  "vielen Dank für Ihre Anfrage. Gern unterbreiten wir Ihnen folgendes Angebot.",
  "wie besprochen senden wir Ihnen unser Angebot. Für Rückfragen stehen wir zur Verfügung.",
  "auf Basis Ihrer Zeichnung und der übermittelten Stückzahlen kalkulieren wir wie folgt.",
];

/** The characteristics an inspection report actually measures on a spring. */
const INSPECTION_FEATURES: readonly string[] = [
  "Drahtdurchmesser", "Außendurchmesser", "Länge L0", "Windungszahl",
  "Federrate R", "Rechtwinkligkeit", "Grathöhe", "Schichtdicke",
];

const SPARE_PARTS: readonly string[] = [
  "Führungsbuchse 20x28", "Keilriemen SPZ 1180", "Näherungsschalter M12",
  "Hydraulikfilter HF-204", "Schneidplatte HSS", "Vorschubrolle 60 mm",
];

export function buildBulkDocuments(ctx: Ctx): DocumentFact[] {
  return [
    ...buildOffers(ctx),
    ...buildInspectionReports(ctx),
    ...buildComplaints(ctx),
    ...buildMaintenanceReports(ctx),
    ...buildToolCards(ctx),
    ...buildMeetingMinutes(ctx),
    ...buildWorksCouncilMinutes(ctx),
    ...buildShiftPlans(ctx),
    ...buildPersonnelFiles(ctx),
    ...buildLeaveRequests(ctx),
  ];
}

/* -------------------------------------------------------------------------- */

/** 60 % of orders. The other 40 % are call-offs against an existing frame contract. */
function buildOffers({ rng, orders, articles, customers }: Ctx): DocumentFact[] {
  const chosen = orders.filter(() => rng.chance(OFFER_RATE));
  return chosen.map((order) => {
    const article = lookup(articles, order.articleId, "article");
    const customer = lookup(customers, order.customerId, "customer");
    const offered = addDays(parseIsoDate(order.orderedIso), -rng.int(7, 40));
    const net = order.quantity * order.erpUnitPriceEur;
    const validUntil = addDays(offered, 30);

    // Tiers, preamble and side clauses are what make one offer four times the length of the
    // next. deEuro() renders "1,17 EUR" without the "/Stück" suffix, so a tier can never
    // collide with TRIBAL_PRICE_TOKEN — the agreed price stays unique to one mail.
    const tiers = rng.chance(0.55)
      ? times(rng, 2, TIER_QUANTITIES.length, (index) => {
          const quantity = TIER_QUANTITIES[index] ?? 100_000;
          const price = Math.round(order.erpUnitPriceEur * (1.18 - index * 0.045) * 100) / 100;
          return `  ${deNumber(quantity, 0).padStart(8)} Stück   ${deEuro(price)}`;
        })
      : [];
    const clauses = times(rng, 0, 3, () => `- ${rng.pick(OFFER_CLAUSES)}`);

    const body = [
      "Selkinghaus Federn- und Stanztechnik GmbH & Co. KG",
      "",
      `ANGEBOT ${order.orderNo}`,
      `Datum: ${deDate(offered)}`,
      "",
      `An: ${customer.name}, ${customer.plz} ${customer.town}`,
      "",
      ...(rng.chance(0.35) ? ["Sehr geehrte Damen und Herren,", "", rng.pick(OFFER_PREAMBLES), ""] : []),
      `Artikel   : ${article.articleNo} — ${article.name}`,
      `Werkstoff : ${article.material}`,
      `Oberfläche: ${article.surface}`,
      `Menge     : ${deNumber(order.quantity, 0)} Stück`,
      `Stückpreis: ${deEuro(order.erpUnitPriceEur)}`,
      `Nettowert : ${deEuro(net)}`,
      "",
      ...(tiers.length > 0 ? ["Staffelpreise:", ...tiers, ""] : []),
      `Liefertermin: ${deDate(parseIsoDate(order.dueIso))}`,
      `Zahlungsziel: ${rng.pick(["30 Tage netto", "14 Tage 2 % Skonto, 30 Tage netto", "sofort netto"])}`,
      `Angebot gültig bis: ${deDate(validUntil)}`,
      "",
      rng.chance(0.3)
        ? "Werkzeugkosten werden anteilig auf die ersten 3 Abrufe umgelegt."
        : "Werkzeug ist vorhanden, keine Einmalkosten.",
      ...(clauses.length > 0 ? ["", "Nebenabreden:", ...clauses] : []),
      "",
      "Es gelten unsere Allgemeinen Geschäftsbedingungen.",
      "",
      "i.A. Vertrieb",
    ].join("\r\n");

    return {
      id: `dok:angebot-${order.orderNo}`,
      path: `fileserver/Vertrieb/Angebote/${year(order.orderedIso)}/Angebot_${order.orderNo}_${shortName(customer.name)}.txt`,
      kind: "Angebot",
      format: "txt",
      ownerId: KEY_EMPLOYEES.vertriebsleiter,
      createdIso: isoDate(offered),
      sensitivity: "internal",
      hasTextLayer: true,
      derivedFrom: [order.id, article.id, customer.id],
      supersededBy: null,
      isDistractor: false,
      body,
    };
  });
}

/** Automotive customers demand an inspection record with every delivery. */
function buildInspectionReports({ rng, orders, articles, customers }: Ctx): DocumentFact[] {
  const automotive = orders.filter((order) => {
    const customer = lookup(customers, order.customerId, "customer");
    return customer.segment === "automotive" || rng.chance(INSPECTION_RATE / 2);
  });
  return automotive.map((order) => {
    const article = lookup(articles, order.articleId, "article");
    // A drawing prescribes between one and six characteristics. The report measures what the
    // drawing prescribes, so its length follows the part, not the template.
    const features = times(rng, 1, 6, () => {
      const nominal = rng.int(200, 4_000) / 100;
      const deviation = rng.int(-6, 6) / 100;
      return `  ${rng.pick(INSPECTION_FEATURES).padEnd(18)}${deNumber(nominal).padStart(8)} mm` +
        `${deNumber(nominal + deviation).padStart(10)} mm   ${rng.pick(CITED_NORMS)}`;
    });
    const passed = rng.chance(0.94);
    const body = [
      `PRÜFPROTOKOLL zu Auftrag ${order.orderNo}`,
      `Formblatt FB-014, Rev. B`,
      "",
      `Artikel     : ${article.articleNo}`,
      `Prüfdatum   : ${deDate(addDays(parseIsoDate(order.dueIso), -rng.int(1, 10)))}`,
      `Prüfer      : ${initials(rng)}`,
      `Prüfmittel  : ${rng.pick(["Messschieber 0-150", "Bügelmessschraube", "Messmaschine MM-02", "Federprüfmaschine FP-1"])}`,
      "",
      `Stichprobe  : ${rng.int(5, 40)} von ${deNumber(order.quantity, 0)} Stück`,
      "",
      `  Merkmal           Nennmaß      Istmaß   Toleranz`,
      ...features,
      "",
      `Ergebnis    : ${passed ? "i.O." : "n.i.O. — Nacharbeit veranlasst"}`,
      ...(passed ? [] : times(rng, 1, 3, () => `  - ${rng.pick([
        "100 % Nachsortierung durch Fertigung.",
        "Sperrlager, Freigabe durch QMB erforderlich.",
        "Werkzeug zum Nachschliff in den Werkzeugbau.",
        "Kunde über Terminverschiebung informiert.",
      ])}`)),
      ...(rng.chance(0.2) ? ["", "Bemerkung: Grat an Trennstelle, innerhalb Toleranz."] : []),
    ].join("\r\n");

    return {
      id: `dok:pp-${order.orderNo}`,
      path: `fileserver/QM/Pruefprotokolle/${year(order.dueIso)}/PP_${order.orderNo}.txt`,
      kind: "Prüfprotokoll",
      format: "txt",
      ownerId: KEY_EMPLOYEES.qmb,
      createdIso: order.dueIso,
      sensitivity: "internal",
      hasTextLayer: true,
      derivedFrom: [order.id, article.id],
      supersededBy: null,
      isDistractor: false,
      body,
    };
  });
}

/** A 2 % complaint rate is unremarkable for a Tier-2 supplier. */
function buildComplaints({ rng, orders, articles, customers }: Ctx): DocumentFact[] {
  const affected = orders.filter(() => rng.chance(COMPLAINT_RATE));
  return affected.map((order) => {
    const article = lookup(articles, order.articleId, "article");
    const customer = lookup(customers, order.customerId, "customer");
    const raised = addDays(parseIsoDate(order.dueIso), rng.int(3, 45));
    const fault = rng.pick([
      "Maßabweichung Drahtdurchmesser",
      "Oberflächenfehler nach Verzinkung",
      "Federkraft außerhalb Toleranz",
      "Grat an der Schnittkante",
      "Vermischung zweier Chargen",
      "Korrosion nach Lagerung",
    ]);
    const body = [
      `8D-REPORT`,
      `Reklamation ${customer.name}`,
      `Auftrag: ${order.orderNo}   Artikel: ${article.articleNo}`,
      `Eingang: ${deDate(raised)}`,
      "",
      `D1 Team          : ${initials(rng)}, ${initials(rng)} (QS), ${initials(rng)} (Fertigung)`,
      `D2 Problem       : ${fault}. Beanstandete Menge: ${deNumber(rng.int(20, 4000), 0)} Stück.`,
      `D3 Sofortmaßnahme: Restbestand gesperrt, Ersatzlieferung avisiert.`,
      `D4 Ursache       : ${rng.pick([
        "Werkzeugverschleiß nicht rechtzeitig erkannt",
        "Prüfintervall nicht eingehalten",
        "Materialcharge des Lieferanten außerhalb Spezifikation",
        "Rüstfehler nach Schichtwechsel",
      ])}`,
      `D5 Abstellmaßnahme: ${rng.pick([
        "Prüfintervall verschärft",
        "Werkzeug nachgeschliffen und Standzeit neu bewertet",
        "Wareneingangsprüfung erweitert",
        "Rüstanweisung ergänzt",
      ])}`,
      `D6 Wirksamkeit   : über 3 Folgelose bestätigt.`,
      `D7 Vorbeugung    : FMEA aktualisiert.`,
      `D8 Abschluss     : ${deDate(addDays(raised, rng.int(14, 60)))}, ${initials(rng)}`,
    ].join("\n");

    return {
      id: `dok:8d-${order.orderNo}`,
      path: `fileserver/QM/Reklamationen/8D_${order.orderNo}_${shortName(customer.name)}.md`,
      kind: "8D-Report",
      format: "md",
      ownerId: KEY_EMPLOYEES.qmb,
      createdIso: isoDate(raised),
      sensitivity: "internal",
      hasTextLayer: true,
      derivedFrom: [order.id, customer.id],
      supersededBy: null,
      isDistractor: false,
      body,
    };
  });
}

function buildMaintenanceReports({ rng, maintenance, machines }: Ctx): DocumentFact[] {
  return maintenance.map((event) => {
    const machine = lookup(machines, event.machineId, "machine");
    const body = [
      `# Wartungsprotokoll ${machine.inventoryNo}`,
      "",
      `Maschine    : ${machine.type} (${machine.hall})`,
      `Datum       : ${deDate(parseIsoDate(event.dateIso))}`,
      `Durchgeführt: ${event.technician}`,
      `Betriebsstunden: ${deNumber(rng.int(4_000, 92_000), 0)} h`,
      "",
      `## Durchgeführte Arbeiten`,
      "",
      `- ${event.note}`,
      // A routine lubrication run and a gearbox overhaul do not produce the same report.
      ...times(rng, 0, 4, () => `- ${rng.pick(MAINTENANCE_NOTES)}`),
      ...(rng.chance(0.34)
        ? ["", "## Verbaute Ersatzteile", "", ...times(rng, 1, 3, () => `- ${rng.pick(SPARE_PARTS)}`)]
        : []),
      "",
      `Nächste Wartung: ${deDate(addDays(parseIsoDate(event.dateIso), rng.int(120, 220)))}`,
      ...(rng.chance(0.12) ? ["", "Hinweis: Ersatzteil bestellt, Liefertermin offen."] : []),
    ].join("\n");

    return {
      id: `dok:${event.id}`,
      path: `fileserver/Instandhaltung/Wartung/${event.dateIso}_${machine.inventoryNo}.md`,
      kind: "Wartungsprotokoll",
      format: "md",
      ownerId: KEY_EMPLOYEES.instandhaltung,
      createdIso: event.dateIso,
      sensitivity: "internal",
      hasTextLayer: true,
      derivedFrom: [event.id, machine.id],
      supersededBy: null,
      isDistractor: false,
      body,
    };
  });
}

/** W-4471's card is hand-authored in narrative.ts — it carries the no-authority contradiction. */
function buildToolCards({ rng, tools, articles }: Ctx): DocumentFact[] {
  return tools
    .filter((tool) => tool.toolNo !== DISPUTED_TOOL_NO)
    .map((tool) => {
      const article = lookup(articles, tool.articleId, "article");
      const body = [
        `# Werkzeugstammkarte ${tool.toolNo}`,
        "",
        `Artikel        : ${article.articleNo} — ${article.name}`,
        `Bauart         : ${rng.pick(["Folgeverbundwerkzeug", "Einzelwerkzeug", "Biegevorrichtung", "Stanzwerkzeug"])}, ${rng.int(1, 8)}-fach`,
        `Gebaut         : ${deDate(parseIsoDate(tool.builtIso))}`,
        `Standzeit (Soll): ${deNumber(tool.expectedStrokes, 0)} Hub`,
        `Nachschliff    : alle ${deNumber(rng.int(2, 8) * 10_000, 0)} Hub`,
        `Lagerplatz     : Regal ${rng.pick(["A", "B", "C", "D"])}${rng.int(1, 24)}`,
        "",
        rng.chance(0.25) ? "Seit dem Bau nicht aktualisiert." : `Letzte Prüfung: ${deDate(addDays(WINDOW_START_MS, rng.int(0, WINDOW_DAYS)))}`,
        // A tool built in 2006 has been reworked; one built last year has not.
        ...times(rng, 0, 4, () => {
          const when = deDate(addDays(parseIsoDate(tool.builtIso), rng.int(90, 6_000)));
          return `\n## Änderung ${when}\n\n${rng.pick([
            "Schneidplatte erneuert, Schnittspalt neu eingestellt.",
            "Auswerferbolzen getauscht.",
            "Führungssäulen nachgearbeitet, Spiel reduziert.",
            "Umbau auf neue Bandbreite nach Zeichnungsänderung.",
            "Nachschliff 0,2 mm, Standzeit seither geringer.",
          ])}`;
        }),
      ].join("\n");

      return {
        id: `dok:stammkarte-${tool.toolNo}`,
        path: `fileserver/Werkzeugbau/Stammkarten/${tool.toolNo}_Werkzeugstammkarte.md`,
        kind: "Werkzeugstammkarte",
        format: "md",
        ownerId: KEY_EMPLOYEES.kalkulationsMeister,
        createdIso: tool.builtIso,
        sensitivity: "internal",
        hasTextLayer: true,
        derivedFrom: [tool.id, article.id],
        supersededBy: null,
        isDistractor: false,
        body,
      };
    });
}

function buildMeetingMinutes({ rng }: Ctx): DocumentFact[] {
  const docs: DocumentFact[] = [];
  for (let week = 0; week < WEEKLY_MEETINGS; week++) {
    const date = addDays(WINDOW_START_MS, week * 7 + 1);
    const body = [
      `# Produktionsbesprechung ${deDate(date)}`,
      "",
      `Teilnehmer: GF, Fertigung, AV, QS, Werkzeugbau, Lager`,
      "",
      "## Kennzahlen der Vorwoche",
      "",
      `- Liefertreue: ${deNumber(88 + rng.next() * 11, 1)} %`,
      `- Ausschuss  : ${deNumber(rng.next() * 3.4, 2)} %`,
      `- Überstunden: ${rng.int(0, 320)} h`,
      "",
      "## Themen",
      "",
      ...rng.shuffle([
        "- Engpass Verzinkung: externer Dienstleister ausgelastet.",
        "- Materialpreis Federstahldraht erneut gestiegen.",
        "- Krankenstand in Halle 1 überdurchschnittlich.",
        "- Rüstzeiten am Stanzautomaten M-007 zu hoch.",
        "- Reklamation offen, 8D läuft.",
        "- Werkzeug im Nachschliff, Ersatzwerkzeug im Einsatz.",
        "- Neue Anfrage aus dem Bereich Möbelbeschläge.",
        "- Urlaubsplanung Sommer abstimmen.",
      ]).slice(0, rng.int(2, 5)),
      "",
      `Protokoll: ${initials(rng)}`,
    ].join("\n");

    docs.push({
      id: `dok:besprechung-${isoDate(date)}`,
      path: `fileserver/Fertigung/Besprechungen/${isoDate(date)}_Produktionsbesprechung.md`,
      kind: "Besprechungsprotokoll",
      format: "md",
      ownerId: null,
      createdIso: isoDate(date),
      sensitivity: "internal",
      hasTextLayer: true,
      derivedFrom: [],
      supersededBy: null,
      isDistractor: false,
      body,
    });
  }
  return docs;
}

/**
 * Monthly, on the 12th. The hand-authored minutes of 2026-05-19 (the BDE dispute) stay
 * unique — that date is deliberately avoided here.
 */
function buildWorksCouncilMinutes({ rng }: Ctx): DocumentFact[] {
  const docs: DocumentFact[] = [];
  for (let month = 0; month < MONTHLY_DOCS; month++) {
    const start = new Date(WINDOW_START_MS);
    const date = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 12);
    const body = [
      `# Protokoll der Betriebsratssitzung`,
      "",
      `Datum: ${deDate(date)}, 14:00 Uhr`,
      `Anwesend: ${rng.int(5, 7)} von 7 Mitgliedern`,
      "",
      ...rng.shuffle([
        "## TOP Personelle Einzelmaßnahmen\n\nZustimmung erteilt. Details in der Anlage (nicht öffentlich).",
        "## TOP Urlaubsgrundsätze\n\nDer Betriebsrat bittet um frühzeitige Abstimmung der Betriebsferien.",
        "## TOP Arbeitssicherheit\n\nBegehung Halle 3 durchgeführt. Zwei Mängel aufgenommen.",
        "## TOP Überstunden\n\nDie Mehrarbeit in der Fertigung wird kritisch gesehen.",
        "## TOP Weiterbildung\n\nAntrag auf Schulung Messtechnik befürwortet.",
      ]).slice(0, rng.int(2, 4)),
      "",
      `Protokollführung: ${initials(rng)}`,
    ].join("\n\n");

    docs.push({
      id: `dok:br-${isoDate(date)}`,
      path: `fileserver/Betriebsrat/Protokolle/${isoDate(date)}_Sitzungsprotokoll.md`,
      kind: "Betriebsratsprotokoll",
      format: "md",
      ownerId: KEY_EMPLOYEES.betriebsratsvorsitzender,
      createdIso: isoDate(date),
      sensitivity: "special-category",
      hasTextLayer: true,
      derivedFrom: [],
      supersededBy: null,
      isDistractor: false,
      body,
    });
  }
  return docs;
}

function buildShiftPlans({ rng, employees }: Ctx): DocumentFact[] {
  const shopFloor = employees.filter((e) => e.department === "fertigung" && !e.leftIso);
  const docs: DocumentFact[] = [];
  for (let month = 0; month < MONTHLY_DOCS; month++) {
    const start = new Date(WINDOW_START_MS);
    const date = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 1);
    const label = isoDate(date).slice(0, 7);
    const rows = rng.shuffle(shopFloor).slice(0, 24).map((e) =>
      `${e.lastName}, ${e.firstName}${" ".repeat(Math.max(1, 26 - e.lastName.length - e.firstName.length))}${rng.pick(["Früh", "Spät", "Nacht", "Früh/Spät"])}`,
    );
    docs.push({
      id: `dok:schichtplan-${label}`,
      path: `fileserver/Fertigung/Schichtplaene/${label}_Schichtplan.md`,
      kind: "Schichtplan",
      format: "md",
      ownerId: null,
      createdIso: isoDate(date),
      sensitivity: "internal",
      hasTextLayer: true,
      derivedFrom: [],
      supersededBy: null,
      isDistractor: false,
      body: `# Schichtplan ${label}\n\n${rows.join("\n")}\n`,
    });
  }
  return docs;
}

/**
 * One per employee. Personal data — but the Personal/Personalakten folder is correctly
 * restricted to GG_Personal, so these produce NO ACL finding. Only Personal/Gehaelter does.
 * That asymmetry is the point: the report must not fire on everything sensitive.
 */
function buildPersonnelFiles({ rng, employees }: Ctx): DocumentFact[] {
  return employees.map((employee) => {
    const body = [
      `PERSONALAKTE — VERTRAULICH`,
      "",
      `Personalnummer : ${employee.id.replace("emp:", "")}`,
      `Name           : ${employee.lastName}, ${employee.firstName}`,
      `Abteilung      : ${employee.department}`,
      `Funktion       : ${employee.role}`,
      `Eintritt       : ${deDate(parseIsoDate(employee.hiredIso))}`,
      employee.leftIso ? `Austritt       : ${deDate(parseIsoDate(employee.leftIso))}` : `Status         : aktiv`,
      "",
      `Schwerbehinderung: ${rng.chance(0.06) ? "ja (Nachweis liegt vor)" : "nein"}`,
      `Betriebsrat      : ${employee.isBetriebsrat ? "Mitglied" : "nein"}`,
      "",
      `Aufbewahrung nach Austritt: 10 Jahre (§ 147 AO).`,
    ].join("\r\n");

    return {
      id: `dok:personalakte-${employee.id.replace("emp:", "")}`,
      path: `fileserver/Personal/Personalakten/${asciiFold(employee.lastName)}_${asciiFold(employee.firstName)}_${employee.id.replace("emp:", "")}.txt`,
      kind: "Personalakte",
      format: "txt",
      ownerId: KEY_EMPLOYEES.personalleiterin,
      createdIso: employee.hiredIso,
      sensitivity: "personal-data",
      hasTextLayer: true,
      derivedFrom: [employee.id],
      supersededBy: null,
      isDistractor: false,
      body,
    };
  });
}

function buildLeaveRequests({ rng, employees }: Ctx): DocumentFact[] {
  return employees
    .filter((e) => !e.leftIso)
    .map((employee) => {
      const from = addDays(WINDOW_START_MS, rng.int(500, WINDOW_DAYS - 20));
      const days = rng.int(3, 15);
      const body = [
        `URLAUBSANTRAG`,
        "",
        `Name        : ${employee.firstName} ${employee.lastName}`,
        `Personalnr. : ${employee.id.replace("emp:", "")}`,
        `Abteilung   : ${employee.department}`,
        "",
        `Zeitraum    : ${deDate(from)} bis ${deDate(addDays(from, days))}`,
        `Arbeitstage : ${Math.max(1, Math.round(days * 5 / 7))}`,
        `Resturlaub  : ${rng.int(0, 22)} Tage`,
        "",
        `Genehmigt   : ${rng.chance(0.92) ? "ja" : "abgelehnt (betriebliche Gründe)"}`,
      ].join("\r\n");

      return {
        id: `dok:urlaub-${employee.id.replace("emp:", "")}`,
        path: `fileserver/Personal/Urlaub/${isoDate(from).slice(0, 4)}/Urlaubsantrag_${employee.id.replace("emp:", "")}.txt`,
        kind: "Urlaubsantrag",
        format: "txt",
        ownerId: KEY_EMPLOYEES.personalleiterin,
        createdIso: isoDate(from),
        sensitivity: "personal-data",
        hasTextLayer: true,
        derivedFrom: [employee.id],
        supersededBy: null,
        isDistractor: false,
        body,
      };
    });
}

/* -------------------------------------------------------------------------- */

/** The shared mailbox that stands in for a ticket system. There is no ticket system. */
export function buildTicketMails(ctx: Ctx): MailThread[] {
  const { rng, employees, customers } = ctx;
  const staff = employees.filter((e) => !e.leftIso);
  const subjects: readonly string[] = [
    "Anfrage Zeichnung", "Liefertermin bestätigen", "Bitte um Rückruf", "Restmenge Auftrag",
    "Rechnung fehlt", "Neuer Ansprechpartner", "Muster angefordert", "Verpackungsvorschrift",
    "Wareneingang avisiert", "Zeugnis 3.1 benötigt", "Preisanfrage", "Reklamation Gutschrift",
    "Werkskalender 2026", "Zugang Kundenportal", "Drucker Halle 2 defekt",
    "Passwort zurücksetzen", "VPN funktioniert nicht", "Kantinenabrechnung",
  ];

  const threads: MailThread[] = [];
  for (let i = 0; i < TICKET_MAILS; i++) {
    const sent = addDays(WINDOW_START_MS, rng.int(0, WINDOW_DAYS));
    const subject = rng.pick(subjects);
    const external = rng.chance(0.55);
    const customer = rng.pick(customers);
    const recipient = rng.pick(staff);
    const from = external
      ? `"${rng.pick(["Einkauf", "Disposition", "Technik", "Buchhaltung"])}" <info@${shortName(customer.name).toLowerCase()}.de>`
      : `"${recipient.firstName} ${recipient.lastName}" <${recipient.email}>`;

    const message: MailMessage = {
      from,
      to: [`"Info" <info@selkinghaus.de>`],
      sentIso: `${isoDate(sent)}T${String(rng.int(6, 18)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:00Z`,
      body: [
        rng.pick(["Guten Tag,", "Hallo zusammen,", "Sehr geehrte Damen und Herren,", "Moin,"]),
        "",
        rng.pick([
          `bitte um Rückmeldung zu ${subject.toLowerCase()}.`,
          `wir benötigen kurzfristig eine Auskunft zu ${subject.toLowerCase()}.`,
          `anbei die Unterlagen. Bitte kurz bestätigen.`,
          `der Vorgang ist seit zwei Wochen offen. Bitte um Sachstand.`,
        ]),
        "",
        rng.chance(0.35) ? "Das Thema eilt, der Kunde wartet." : "Vielen Dank vorab.",
        "",
        rng.pick(["Mit freundlichen Grüßen", "Viele Grüße", "Gruß"]),
        external ? "i.A. " + rng.pick(["Krämer", "Wolter", "Steinhoff", "Menzel"]) : `${recipient.firstName} ${recipient.lastName}`,
      ].join("\r\n"),
    };

    threads.push({
      id: `mail:t${String(i + 100).padStart(4, "0")}`,
      subject,
      path: `mail/postfach-info/${isoDate(sent)}_${String(i).padStart(3, "0")}_${asciiFold(subject).replace(/[^A-Za-z0-9]+/g, "_")}.eml`,
      messages: [message],
      carriesTribalKnowledge: false,
    });
  }
  return threads;
}

function initials(rng: Rng): string {
  return `${rng.pick(["A", "B", "D", "F", "H", "J", "K", "M", "N", "P", "S", "T", "U"])}. ${rng.pick(["Möller", "Schulte", "Kemper", "Hesse", "Lohmann", "Quante", "Stracke", "Vielhaber"])}`;
}
