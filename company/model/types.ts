/**
 * The fact model. This is the ONLY source of truth about the company.
 *
 * Every document in company/out/ is a PROJECTION of these facts, with noise injected.
 * Never the other way round. That is what makes each evaluation question answerable by
 * computation instead of by hand-written prose.
 *
 * IDs are stable and namespaced (`emp:0042`, `auf:2024-0871`) so truth/*.jsonl can key
 * against them without depending on array order.
 */

export type DepartmentKey =
  | "gf"
  | "vertrieb"
  | "konstruktion"
  | "arbeitsvorbereitung"
  | "fertigung"
  | "werkzeugbau"
  | "qs"
  | "einkauf"
  | "lager"
  | "buchhaltung"
  | "personal"
  | "it";

export interface Department {
  readonly key: DepartmentKey;
  readonly name: string;
  /** AD security group backing this department. */
  readonly adGroup: string;
}

export interface Employee {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly department: DepartmentKey;
  readonly role: string;
  readonly email: string;
  readonly samAccountName: string;
  readonly hiredIso: string;
  /** Left the company, but their files and mails remain on the fileserver. */
  readonly leftIso: string | null;
  readonly isBetriebsrat: boolean;
  /** Retires in 2026 and is the only person who understands the costing sheet. */
  readonly isKeyPerson: boolean;
}

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly town: string;
  readonly plz: string;
  readonly segment: "automotive" | "elektro" | "beschlaege" | "sonstige";
  /** Share of annual revenue, as a fraction. The Tier-2 cluster risk lives here. */
  readonly revenueShare: number;
}

export interface Supplier {
  readonly id: string;
  readonly name: string;
  readonly town: string;
  readonly plz: string;
  readonly supplies: string;
}

export interface Article {
  readonly id: string;
  readonly articleNo: string;
  readonly name: string;
  readonly kind: string;
  readonly material: string;
  readonly surface: string;
  /** The list price the ERP carries. May diverge from what was actually agreed. */
  readonly listPriceEur: number;
  readonly customerId: string;
}

export interface Order {
  readonly id: string;
  readonly orderNo: string;
  readonly customerId: string;
  readonly articleId: string;
  readonly quantity: number;
  /** What the ERP believes the unit price is. */
  readonly erpUnitPriceEur: number;
  readonly orderedIso: string;
  readonly dueIso: string;
}

/** A stamping/bending tool. Lives in the Werkzeugbau, has a master card, wears out. */
export interface ToolAsset {
  readonly id: string;
  readonly toolNo: string;
  readonly articleId: string;
  readonly builtIso: string;
  /** Expected service life per the master card. Reality often disagrees. */
  readonly expectedStrokes: number;
}

/** Rows in the ERP, not files on the fileserver — exactly as in a real plant. */
export interface Invoice {
  readonly id: string;
  readonly invoiceNo: string;
  readonly orderId: string;
  readonly issuedIso: string;
  readonly netEur: number;
  readonly disputed: boolean;
}

export interface Delivery {
  readonly id: string;
  readonly deliveryNo: string;
  readonly orderId: string;
  readonly shippedIso: string;
  readonly quantity: number;
}

export interface Machine {
  readonly id: string;
  readonly inventoryNo: string;
  readonly type: string;
  readonly hall: string;
  readonly installedIso: string;
  /** Deliberately absent for one machine: an unanswerable question hangs off this. */
  readonly serialNo: string | null;
}

export interface MaintenanceEvent {
  readonly id: string;
  readonly machineId: string;
  readonly dateIso: string;
  readonly technician: string;
  readonly note: string;
}

export interface MailMessage {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly sentIso: string;
  readonly body: string;
}

export interface MailThread {
  readonly id: string;
  readonly subject: string;
  readonly path: string;
  readonly messages: readonly MailMessage[];
  /** True when this thread is the ONLY record of a fact. */
  readonly carriesTribalKnowledge: boolean;
}

export type Sensitivity = "public" | "internal" | "personal-data" | "special-category";

export interface DocumentFact {
  readonly id: string;
  /** Path relative to company/out/. */
  readonly path: string;
  readonly kind: string;
  readonly format: string;
  readonly ownerId: string | null;
  readonly createdIso: string;
  readonly sensitivity: Sensitivity;
  /** False for scans without a text layer. Declared, never faked. */
  readonly hasTextLayer: boolean;
  /** Fact IDs this document is a projection of. */
  readonly derivedFrom: readonly string[];
  /** Set when a newer revision supersedes this one. */
  readonly supersededBy: string | null;
  /** Referenced by no ground-truth question. Retrieval noise. */
  readonly isDistractor: boolean;
  readonly body?: string;
}

export interface AdGroup {
  readonly name: string;
  readonly description: string;
  readonly memberIds: readonly string[];
}

export interface Share {
  readonly unc: string;
  readonly driveLetter: string;
  readonly localPath: string;
}

export type AclRight = "read" | "modify" | "full";

export interface AclEntry {
  /** Path relative to company/out/fileserver. */
  readonly path: string;
  readonly group: string;
  readonly right: AclRight;
  /** What the folder SHOULD be restricted to, per the data-protection concept. */
  readonly intendedSensitivity: Sensitivity;
}

export type InconsistencyKind =
  | "tribal-only"
  | "stale-version"
  | "acl-violation"
  | "no-authority"
  /** A system's index still points at files the filesystem no longer has. */
  | "index-rot"
  /** Personal data is processed without the legal basis the company itself documented. */
  | "unauthorized-processing";

export interface Inconsistency {
  readonly id: string;
  readonly kind: InconsistencyKind;
  readonly summary: string;
  /** Document or thread IDs that disagree. */
  readonly sources: readonly string[];
  /** The document ID that wins, or null when nothing is authoritative. */
  readonly authoritative: string | null;
}

export interface World {
  readonly generatedFrom: { readonly seedPhrase: string; readonly baseDate: string };
  readonly company: Record<string, string | number>;
  readonly distractorFirm: Record<string, string>;
  readonly departments: readonly Department[];
  readonly employees: readonly Employee[];
  readonly customers: readonly Customer[];
  readonly suppliers: readonly Supplier[];
  readonly articles: readonly Article[];
  readonly orders: readonly Order[];
  readonly invoices: readonly Invoice[];
  readonly deliveries: readonly Delivery[];
  readonly tools: readonly ToolAsset[];
  readonly machines: readonly Machine[];
  readonly maintenance: readonly MaintenanceEvent[];
  readonly mailThreads: readonly MailThread[];
  readonly documents: readonly DocumentFact[];
  readonly adGroups: readonly AdGroup[];
  readonly shares: readonly Share[];
  readonly acls: readonly AclEntry[];
  readonly inconsistencies: readonly Inconsistency[];
}
