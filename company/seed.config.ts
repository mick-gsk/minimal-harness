/**
 * Every constant in this file carries a documented "why" (CLAUDE.md principle 4).
 * Anonymous constants are deletion candidates.
 */

/**
 * Single seed for the whole world. Derived from a fixed string rather than a magic
 * integer so the provenance is readable. Without a fixed seed the output drifts and
 * the ground truth in truth/*.jsonl becomes unstable.
 */
export const SEED_PHRASE = "selkinghaus-federn-und-stanztechnik-2026";

/**
 * The world's frozen "today". Equals the repo's currentDate at authoring time.
 * Replaces Date.now() entirely — every timestamp in the world is an offset from this.
 */
export const BASE_DATE = "2026-07-10";

/**
 * ~140 employees: yields a 7-member Betriebsrat (BetrVG §9, bracket 101-200 employees)
 * and stays below the 200-employee threshold for a mandatory full-time BR release (§38).
 * Large enough that Werkzeugbau, Lager/Versand and Instandhaltung are real departments
 * with real document owners, rather than roles pinned on one person.
 */
export const EMPLOYEE_COUNT = 142;

/**
 * ~24 Mio EUR at ~170 TEUR/employee. A material-intensive spring/stamping supplier sits
 * below the general Maschinenbau average; 200+ TEUR/employee was rejected as unrealistic
 * for this trade.
 */
export const REVENUE_EUR = 24_180_000;

/**
 * BetrVG §9: 101-200 employees -> 7 members. §38 (mandatory release from work) only
 * applies from 200 employees up. Getting this wrong is exactly the kind of detail a real
 * Betriebsrat would notice, and the BDE scenario builds on Mitbestimmung.
 */
export const BETRIEBSRAT_SIZE = 7;

/* -------------------------------------------------------------------------- */
/* Scale. Every number below is DERIVED, not chosen. See company/README.md.     */
/* -------------------------------------------------------------------------- */

/** The snapshot window. All orders, protocols and mails fall inside it. */
export const WINDOW_START = "2024-01-01";

/**
 * Rahmenaufträge over 5.000-50.000 pieces at 0,28-9,40 EUR. The midpoint of that range
 * times the mean call-off quantity lands here. It is the divisor that turns revenue into
 * an order count, so it must be stated rather than implied.
 */
export const AVG_ORDER_VALUE_EUR = 64_800;

/** 24,18 Mio EUR / 64.800 EUR = 373 orders per year. Over the 2,52-year window: 941. */
export const ORDERS_PER_YEAR = Math.round(REVENUE_EUR / AVG_ORDER_VALUE_EUR);

/**
 * A spring and stamping supplier maintains a few hundred article masters, each with its
 * own drawing and, for stamped parts, its own tool. 380 across 52 customers is ~7 parts
 * per customer — the low end, because the eight key accounts hold most of them.
 */
export const ARTICLE_COUNT = 380;

/**
 * 8 named key accounts carry 84 % of revenue (the cluster risk). The remaining 16 % sits
 * in a long tail of 44 small customers — the Pareto shape every Zulieferer has.
 */
export const SMALL_CUSTOMER_COUNT = 44;
export const SUPPLIER_COUNT = 28;

/** One follow-on composite tool per stamped/bent part; ~47 % of the catalogue. */
export const TOOL_COUNT = 180;

/** Machines across three halls. Six maintenance events each over the window. */
export const MACHINE_COUNT = 34;
export const MAINTENANCE_PER_MACHINE = 6;

/**
 * Document yields per business object. These ratios, not a target file count, decide how
 * big the corpus gets.
 *
 * NOTE: Rechnungen and Lieferscheine are deliberately NOT files. They are rows in the ERP,
 * exactly as in a real plant — which is also what stops the file count exploding.
 */
export const OFFER_RATE = 0.6;        // the other 40 % are call-offs against a frame contract
export const INSPECTION_RATE = 0.4;   // share of orders for automotive customers
export const COMPLAINT_RATE = 0.02;   // 8D reports; a 2 % complaint rate is unremarkable
export const WEEKLY_MEETINGS = 130;   // Produktionsbesprechung, weekly across the window
export const MONTHLY_DOCS = 30;       // Betriebsrat minutes and shift plans, monthly
export const TICKET_MAILS = 250;      // the shared mailbox that stands in for a ticket system

/** Share of bulk files that get a chaotic name, a duplicate, or mojibake. */
export const MESS_RATES = {
  /** "Angebot_..._final_final_v3_NEU.txt", "Kopie von ...", "(2)" */
  chaoticName: 0.14,
  /** Same content, second path. Grown drives are full of these. */
  duplicate: 0.03,
  /** Double-encoded UTF-8 ("Ã¤"). One bad conversion in 2016 and it never got fixed. */
  mojibake: 0.01,
} as const;

/**
 * One distractor firm sharing the surname but differing in Rechtsform, town and product
 * line. Makes entity resolution non-trivial and injects retrieval noise a too-clean
 * corpus would never have.
 */
export const DISTRACTOR_FIRM = {
  name: "Selkinghaus Draht- und Umformtechnik GmbH",
  town: "Hemer",
  note: "Kein Konzernverbund, keine Beteiligung. Nur Namensgleichheit.",
} as const;

/**
 * The three signature contradictions. Each maps to exactly one demo/eval question.
 * These are the money shots; everything else is cheap volume.
 */
export const SIGNATURE_CONTRADICTIONS = 3;

/**
 * Documents that no ground-truth question references. Retrieval noise: a corpus in which
 * every document is relevant is the classic generator tell.
 */
export const DISTRACTOR_DOC_COUNT = 12;

/** Company identity. "Selkinghaus" was collision-checked against the Federn/Stanz/Draht trade. */
export const COMPANY = {
  legalName: "Selkinghaus Federn- und Stanztechnik GmbH & Co. KG",
  shortName: "Selkinghaus",
  town: "Iserlohn-Sümmern",
  district: "Märkischer Kreis",
  founded: 1958,
  employees: EMPLOYEE_COUNT,
  revenueEur: REVENUE_EUR,
  domain: "selkinghaus.de",
  netbiosDomain: "SELKINGHAUS",
  fileServer: "FS01",
  /**
   * ISO 9001 only. A full IATF 16949 claim would force PPAP, EMPB, Control Plan, FMEA and
   * 3.1 certificates into the corpus — a large documentation burden for little eval signal.
   * The abandoned 2019 run is regionally real and supplies genuine tension.
   */
  certification: "ISO 9001:2015",
  abandonedCertification: "IATF 16949 (Anlauf 2019 aus Kostengründen abgebrochen)",
} as const;
