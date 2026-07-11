import { BASE_DATE, COMPANY, DISTRACTOR_FIRM, SEED_PHRASE } from "../seed.config.js";
import { seedFromPhrase } from "../lib/canon.js";
import { streamFor } from "../lib/rand.js";
import { fixtureDocuments, vendoredDocuments } from "../fixtures/index.js";
import { buildBulkDocuments, buildTicketMails } from "./bulk.js";
import {
  buildArticles, buildDeliveries, buildInvoices, buildMachines, buildMaintenance,
  buildOrders, buildTools,
} from "./catalog.js";
import { injectMess } from "./mess.js";
import type { MessStats } from "./mess.js";
import { buildSystemDocuments } from "./systems.js";
import {
  ACLS, INCONSISTENCIES, SHARES, buildAdGroups, buildDocuments, buildMailThreads,
} from "./narrative.js";
import { buildCustomers, buildSuppliers } from "./partners.js";
import { DEPARTMENTS, buildEmployees } from "./roster.js";
import type { World } from "./types.js";

export interface BuiltWorld {
  readonly world: World;
  readonly mess: MessStats;
}

/**
 * Assembles the world from the seed. Each entity kind draws from its own named sub-stream,
 * so adding a supplier does not shift the roster's surnames.
 *
 * Order matters only for the fact model, never for the streams.
 */
export function buildWorldWithStats(): BuiltWorld {
  const root = seedFromPhrase(SEED_PHRASE);

  const employees = buildEmployees(streamFor(root, "roster"));
  const customers = buildCustomers(streamFor(root, "customers"));
  const suppliers = buildSuppliers(streamFor(root, "suppliers"));
  const articles = buildArticles(streamFor(root, "articles"), customers);
  const tools = buildTools(streamFor(root, "tools"), articles);
  const orders = buildOrders(streamFor(root, "orders"), articles);
  const invoices = buildInvoices(streamFor(root, "invoices"), orders);
  const deliveries = buildDeliveries(streamFor(root, "deliveries"), orders);
  const machines = buildMachines(streamFor(root, "machines"));

  const technicians = employees
    .filter((e) => e.department === "werkzeugbau" && !e.leftIso)
    .map((e) => `${e.firstName.charAt(0)}. ${e.lastName}`);
  const maintenance = buildMaintenance(streamFor(root, "maintenance"), machines, technicians);

  const handAuthored = buildDocuments(employees);
  const bulkContext = {
    rng: streamFor(root, "bulk"),
    employees, customers, articles, orders, machines, maintenance, tools,
  };

  /**
   * `captured` is the bulk BEFORE the mess injector renames anything. The DocuWare index is
   * built from it, the corpus is built from `bulk`. Nobody reconciles the two — which is
   * precisely how a stalled DMS rots, and why the dangling entries are emergent rather than
   * authored. Do not "fix" this by passing `bulk.documents` in.
   */
  const captured = buildBulkDocuments(bulkContext);
  const bulk = injectMess(streamFor(root, "mess"), captured);

  const systems = buildSystemDocuments({
    rng: streamFor(root, "systems"),
    employees, customers, articles, orders, invoices, machines, tools,
    capturedDocuments: captured,
  });

  const mailThreads = [
    ...buildMailThreads(employees),
    ...buildTicketMails({ ...bulkContext, rng: streamFor(root, "tickets") }),
  ];

  const departmentGroups = new Map(DEPARTMENTS.map((d) => [d.key, d.adGroup]));

  return {
    world: {
      generatedFrom: { seedPhrase: SEED_PHRASE, baseDate: BASE_DATE },
      company: { ...COMPANY },
      distractorFirm: { ...DISTRACTOR_FIRM },
      departments: DEPARTMENTS,
      employees,
      customers,
      suppliers,
      articles,
      orders,
      invoices,
      deliveries,
      tools,
      machines,
      maintenance,
      mailThreads,
      // Fixtures and the vendored statute are body-less: writeDocuments() skips them,
      // generate.ts copies the committed bytes instead. They still belong in the fact model,
      // so world.json and the manifest know their sensitivity, owner and provenance.
      // Systems come last and never pass through injectMess — their paths must stay stable.
      documents: [
        ...handAuthored, ...fixtureDocuments(), ...vendoredDocuments(),
        ...bulk.documents, ...systems,
      ],
      adGroups: buildAdGroups(employees, departmentGroups),
      shares: SHARES,
      acls: ACLS,
      inconsistencies: INCONSISTENCIES,
    },
    mess: bulk.stats,
  };
}

export function buildWorld(): World {
  return buildWorldWithStats().world;
}

/**
 * world.json is the FACT store, not a document archive. Rendered bodies would bloat it and,
 * worse, restate every document's text in a file that must never be indexed. The bodies live
 * on disk as corpus files; the manifest carries their sha256.
 */
export function stripBodies(world: World): World {
  return { ...world, documents: world.documents.map(({ body: _body, ...rest }) => rest) };
}
