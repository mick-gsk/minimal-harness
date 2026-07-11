/**
 * Trade vocabulary for a spring / stamping / wire-forming supplier.
 * Norm designations are factual references (DIN EN standards), used as terminology only.
 */

/** Spring steel wire grades per DIN EN 10270. */
export const WIRE_GRADES: readonly string[] = [
  "SH (DIN EN 10270-1)",
  "DH (DIN EN 10270-1)",
  "SM (DIN EN 10270-1)",
  "FDC (DIN EN 10270-2)",
  "VDSiCr (DIN EN 10270-2)",
  "1.4310 (DIN EN 10270-3)",
];

/** Sheet materials for the stamping side. */
export const SHEET_MATERIALS: readonly string[] = [
  "DC01 (1.0330)",
  "DC04 (1.0338)",
  "CuSn6 (2.1020)",
  "CuZn37 (2.0321)",
  "1.4301",
  "S235JR (1.0038)",
];

export const PRODUCT_KINDS: readonly string[] = [
  "Druckfeder",
  "Zugfeder",
  "Schenkelfeder",
  "Blattfeder",
  "Stanzbiegeteil",
  "Kontaktfeder",
  "Klemmfeder",
  "Drahtbiegeteil",
  "Spannbügel",
  "Sicherungsclip",
];

export const SURFACE_TREATMENTS: readonly string[] = [
  "blank",
  "brüniert",
  "verzinkt-blau",
  "verzinkt-dickschicht",
  "phosphatiert",
  "elektrolytisch verzinnt",
];

/** Norms cited across the QM documents. DIN EN 13906 is the design standard for springs. */
export const CITED_NORMS: readonly string[] = [
  "DIN EN 13906-1",
  "DIN EN 13906-2",
  "DIN EN 15800",
  "DIN EN ISO 9001:2015",
  "DIN EN ISO 2768-m",
];

export const MACHINE_TYPES: readonly string[] = [
  "Federwindeautomat",
  "Exzenterpresse",
  "Stanzautomat",
  "Drahtbiegeautomat",
  "Vergüteofen",
  "Kugelstrahlanlage",
  "Messmaschine",
];
