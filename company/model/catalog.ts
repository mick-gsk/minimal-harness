import {
  ARTICLE_COUNT, AVG_ORDER_VALUE_EUR, BASE_DATE, MACHINE_COUNT, MAINTENANCE_PER_MACHINE,
  ORDERS_PER_YEAR, TOOL_COUNT, WINDOW_START,
} from "../seed.config.js";
import { addDays, isoDate, parseIsoDate } from "../lib/fmt.js";
import { MACHINE_TYPES, PRODUCT_KINDS, SHEET_MATERIALS, SURFACE_TREATMENTS, WIRE_GRADES } from "../lexicons/materials.js";
import type { Rng } from "../lib/rand.js";
import { MAIN_CUSTOMER_ID } from "./partners.js";
import type { Article, Customer, Delivery, Invoice, Machine, MaintenanceEvent, Order, ToolAsset } from "./types.js";

export const WINDOW_START_MS = parseIsoDate(WINDOW_START);
export const WINDOW_END_MS = parseIsoDate(BASE_DATE);
export const WINDOW_DAYS = Math.round((WINDOW_END_MS - WINDOW_START_MS) / 86_400_000);
const WINDOW_YEARS = WINDOW_DAYS / 365.25;

/** 373 orders/year x 2,52 years = 941. Both factors are derived in seed.config.ts. */
export const ORDER_COUNT = Math.round(ORDERS_PER_YEAR * WINDOW_YEARS);

/** Wire products are wound; the rest are stamped or bent and therefore need a tool. */
const WIRE_KINDS = new Set(["Druckfeder", "Zugfeder", "Schenkelfeder", "Drahtbiegeteil", "Klemmfeder"]);

/**
 * The article and order the price contradiction hangs off. Hand-authored, because the
 * exact numbers appear verbatim in a mail thread and in truth/facts.jsonl.
 *
 * The ERP carries the LIST price of 1,29 EUR. The price actually agreed on the phone was
 * 1,17 EUR/Stück, and it was never entered. That is why the customer disputes the invoice,
 * and the only record of the agreement is one .eml.
 */
export const HERO_ARTICLE: Article = {
  id: "art:30114",
  articleNo: "DF-12040-DH",
  name: "Druckfeder 12x40, Federstahldraht DH, verzinkt-blau",
  kind: "Druckfeder",
  material: "DH (DIN EN 10270-1)",
  surface: "verzinkt-blau",
  listPriceEur: 1.29,
  customerId: MAIN_CUSTOMER_ID,
};

export const HERO_ORDER: Order = {
  id: "auf:2024-0871",
  orderNo: "2024-0871",
  customerId: MAIN_CUSTOMER_ID,
  articleId: HERO_ARTICLE.id,
  quantity: 250_000,
  erpUnitPriceEur: 1.29,
  orderedIso: "2024-03-18",
  dueIso: "2024-06-28",
};

export const TRIBAL_UNIT_PRICE_EUR = 1.17;
/** The exact token verify.ts greps for. It must occur exactly once in the whole corpus. */
export const TRIBAL_PRICE_TOKEN = "1,17 EUR/Stück";

/** The machine whose serial number was never recorded. Backs an unanswerable question. */
export const SERIAL_LESS_MACHINE_ID = "masch:M-014";

/** The tool whose service life two documents disagree about, with neither authoritative. */
export const DISPUTED_TOOL_NO = "W-4471";
export const DISPUTED_TOOL_LIFE_MAINTENANCE = 180_000;
export const DISPUTED_TOOL_LIFE_MASTERCARD = 250_000;

export function buildArticles(rng: Rng, customers: readonly Customer[]): Article[] {
  const articles: Article[] = [HERO_ARTICLE];
  // Key accounts hold most of the catalogue; the long tail holds a part or two each.
  const weighted = customers.flatMap((c) => Array<Customer>(c.revenueShare > 0.03 ? 8 : 1).fill(c));

  for (let i = 0; i < ARTICLE_COUNT - 1; i++) {
    const kind = rng.pick(PRODUCT_KINDS);
    const isWire = WIRE_KINDS.has(kind);
    // Whole cents; 117 is skipped so TRIBAL_PRICE_TOKEN stays unique in the corpus.
    let cents = rng.int(28, 940);
    if (cents === 117) cents = 118;
    const material = isWire ? rng.pick(WIRE_GRADES) : rng.pick(SHEET_MATERIALS);
    articles.push({
      id: `art:${30115 + i}`,
      articleNo: `${isWire ? "DF" : "SB"}-${rng.int(10, 99)}${rng.int(100, 999)}-${rng.pick(["DH", "SH", "SM", "VD"])}`,
      name: `${kind} ${rng.int(4, 40)}x${rng.int(8, 120)}, ${material}`,
      kind,
      material,
      surface: rng.pick(SURFACE_TREATMENTS),
      listPriceEur: cents / 100,
      customerId: rng.pick(weighted).id,
    });
  }
  return articles;
}

export function buildTools(rng: Rng, articles: readonly Article[]): ToolAsset[] {
  const stamped = articles.filter((a) => !WIRE_KINDS.has(a.kind));
  const tools: ToolAsset[] = [{
    id: `wkz:${DISPUTED_TOOL_NO}`,
    toolNo: DISPUTED_TOOL_NO,
    articleId: stamped[0]?.id ?? HERO_ARTICLE.id,
    builtIso: "2019-04-11",
    expectedStrokes: DISPUTED_TOOL_LIFE_MASTERCARD,
  }];
  for (let i = 0; i < TOOL_COUNT - 1; i++) {
    const article = stamped[i % Math.max(1, stamped.length)];
    tools.push({
      id: `wkz:W-${4472 + i}`,
      toolNo: `W-${4472 + i}`,
      articleId: article?.id ?? HERO_ARTICLE.id,
      builtIso: isoDate(addDays(parseIsoDate("2006-01-01"), rng.int(0, 7_100))),
      expectedStrokes: rng.int(6, 50) * 10_000,
    });
  }
  return tools;
}

export function buildOrders(rng: Rng, articles: readonly Article[]): Order[] {
  const orders: Order[] = [HERO_ORDER];
  const pool = articles.filter((a) => a.id !== HERO_ARTICLE.id);

  for (let i = 0; i < ORDER_COUNT - 1; i++) {
    const article = rng.pick(pool);
    const ordered = addDays(WINDOW_START_MS, rng.int(0, WINDOW_DAYS - 30));
    // Quantity is drawn so the MEAN order value lands on AVG_ORDER_VALUE_EUR: the spread
    // [0,25 .. 1,75] has mean 1,0. Get this wrong and the ERP's own revenue contradicts
    // seed.config.ts — verify.ts cross-checks the two against each other.
    const target = AVG_ORDER_VALUE_EUR * (0.25 + rng.next() * 1.5);
    const quantity = Math.max(500, Math.round(target / article.listPriceEur / 500) * 500);
    const year = isoDate(ordered).slice(0, 4);
    orders.push({
      id: `auf:${year}-${String(1000 + i).padStart(4, "0")}`,
      orderNo: `${year}-${String(1000 + i).padStart(4, "0")}`,
      customerId: article.customerId,
      articleId: article.id,
      quantity,
      erpUnitPriceEur: article.listPriceEur,
      orderedIso: isoDate(ordered),
      dueIso: isoDate(addDays(ordered, rng.int(28, 140))),
    });
  }
  return orders;
}

/** Invoices and deliveries live in the ERP only. No files, exactly as in a real plant. */
export function buildInvoices(rng: Rng, orders: readonly Order[]): Invoice[] {
  return orders.map((order, index) => ({
    id: `re:${order.orderNo}`,
    invoiceNo: `RE-${order.orderNo}`,
    orderId: order.id,
    issuedIso: isoDate(addDays(parseIsoDate(order.dueIso), rng.int(1, 9))),
    netEur: Math.round(order.quantity * order.erpUnitPriceEur * 100) / 100,
    // The hero order's invoice is the one Wittenbrink disputes.
    disputed: order.id === HERO_ORDER.id || (index % 97 === 0 && index > 0),
  }));
}

export function buildDeliveries(rng: Rng, orders: readonly Order[]): Delivery[] {
  const deliveries: Delivery[] = [];
  let n = 1;
  for (const order of orders) {
    const parts = rng.int(1, 4);
    for (let i = 0; i < parts; i++) {
      deliveries.push({
        id: `ls:${String(n).padStart(5, "0")}`,
        deliveryNo: `LS-${40000 + n}`,
        orderId: order.id,
        shippedIso: isoDate(addDays(parseIsoDate(order.dueIso), rng.int(-14, 6))),
        quantity: Math.round(order.quantity / parts),
      });
      n++;
    }
  }
  return deliveries;
}

export function buildMachines(rng: Rng): Machine[] {
  const machines: Machine[] = [];
  const start = parseIsoDate("1996-01-01");
  for (let i = 1; i <= MACHINE_COUNT; i++) {
    const id = `masch:M-${String(i).padStart(3, "0")}`;
    const isSerialLess = id === SERIAL_LESS_MACHINE_ID;
    machines.push({
      id,
      inventoryNo: `INV-${1200 + i}`,
      // The serial-less machine is the Federwindeautomat in Halle 2 the question asks about.
      type: isSerialLess ? "Federwindeautomat" : rng.pick(MACHINE_TYPES),
      hall: isSerialLess ? "Halle 2" : rng.pick(["Halle 1", "Halle 2", "Halle 3"]),
      installedIso: isoDate(addDays(start, rng.int(0, 10_500))),
      serialNo: isSerialLess ? null : `SN-${rng.int(100000, 999999)}`,
    });
  }
  if (!machines.some((m) => m.id === SERIAL_LESS_MACHINE_ID)) {
    throw new Error(`${SERIAL_LESS_MACHINE_ID} missing — MACHINE_COUNT too small`);
  }
  return machines;
}

export const MAINTENANCE_NOTES: readonly string[] = [
  "Schmierstellen abgeschmiert, Riemenspannung geprüft.",
  "Führungsbuchsen getauscht, Probelauf i.O.",
  "Werkzeugwechsel, Nachschliff veranlasst.",
  "Ölwechsel Hydraulikaggregat.",
  "Sicherheitsprüfung nach BetrSichV durchgeführt.",
  "Störung Vorschub behoben, Sensor getauscht.",
  "Kupplung nachgestellt, Bremsweg im Sollbereich.",
  "Filtermatten erneuert, Absaugung gereinigt.",
];

export function buildMaintenance(
  rng: Rng,
  machines: readonly Machine[],
  technicians: readonly string[],
): MaintenanceEvent[] {
  const events: MaintenanceEvent[] = [];
  let n = 1;
  for (const machine of machines) {
    for (let i = 0; i < MAINTENANCE_PER_MACHINE; i++) {
      events.push({
        id: `wtg:${String(n++).padStart(4, "0")}`,
        machineId: machine.id,
        dateIso: isoDate(addDays(WINDOW_START_MS, rng.int(0, WINDOW_DAYS))),
        technician: rng.pick(technicians),
        note: rng.pick(MAINTENANCE_NOTES),
      });
    }
  }
  return events;
}
