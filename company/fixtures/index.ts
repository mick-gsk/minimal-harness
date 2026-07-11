/**
 * The fixture registry: where each hero document lives in the company, and what it is.
 *
 * The binaries under company/fixtures/bin/ are COMMITTED. They are produced once by
 * `company/fixtures/build.sh` (needs LibreOffice) and then never regenerated, which is
 * why `npx tsx company/generate.ts` stays deterministic and dependency-free: it copies
 * bytes, it does not convert documents.
 *
 * IMPORTANT: nothing in src/ can read a .docx, .xlsx or .pdf today. These fixtures are
 * therefore unreadable by the harness on purpose. They make the gap concrete — the manifest
 * marks them `binary`, and truth/binary-facts.jsonl states what a parser would unlock.
 */
import type { DocumentFact, Sensitivity } from "../model/types.js";
import { KEY_EMPLOYEES } from "../model/roster.js";
import { HERO_ARTICLE, HERO_ORDER, DISPUTED_TOOL_NO, SERIAL_LESS_MACHINE_ID } from "../model/catalog.js";

export type FixtureTarget = "docx" | "xlsx" | "pdf";

export interface Fixture {
  /** Basename under fixtures/src (without extension) and under fixtures/bin. */
  readonly source: string;
  readonly target: FixtureTarget;
  /** Where it lands in the corpus. Umlauts and spaces are deliberate. */
  readonly corpusPath: string;
  readonly kind: string;
  readonly ownerId: string | null;
  readonly createdIso: string;
  readonly sensitivity: Sensitivity;
  readonly derivedFrom: readonly string[];
  /**
   * Rasterised before it becomes a PDF: build.sh renders the page to PNG and wraps that in a
   * PDF, so the file carries pixels and not a single text-drawing operator. That is what a
   * scan is. `hasTextLayer` becomes false and verify.ts proves it by counting Tj/TJ operators
   * in the decompressed content streams — the presence of a /Font resource proves nothing,
   * because LibreOffice Draw embeds one either way.
   */
  readonly scan?: true;
}

export const FIXTURES: readonly Fixture[] = [
  // ---- Word documents ------------------------------------------------------
  {
    source: "angebot-2024-0871", target: "docx",
    corpusPath: "fileserver/Vertrieb/Angebote/2024/Angebot_2024-0871_Wittenbrink.docx",
    kind: "Angebot", ownerId: KEY_EMPLOYEES.vertriebsleiter, createdIso: "2024-03-18",
    sensitivity: "internal", derivedFrom: [HERO_ORDER.id, HERO_ARTICLE.id],
  },
  {
    source: "lastenheft-kontaktfeder", target: "docx",
    corpusPath: "fileserver/Konstruktion/Lastenhefte/Lastenheft_Wittenbrink_Kontaktfeder_Rev2.docx",
    kind: "Lastenheft", ownerId: "emp:0010", createdIso: "2025-09-04",
    sensitivity: "internal", derivedFrom: ["kun:10001"],
  },
  {
    source: "betriebsvereinbarung-bde", target: "docx",
    corpusPath: "fileserver/Personal/Betriebsvereinbarungen/Betriebsvereinbarung_BDE_ENTWURF_nicht_unterschrieben.docx",
    kind: "Betriebsvereinbarung (Entwurf)", ownerId: KEY_EMPLOYEES.personalleiterin, createdIso: "2026-02-12",
    sensitivity: "internal", derivedFrom: ["mail:0003"],
  },
  {
    source: "aa-018-stanzen", target: "docx",
    corpusPath: "fileserver/QM/freigegeben/AA-018_Stanzen_RevE.docx",
    kind: "Arbeitsanweisung", ownerId: KEY_EMPLOYEES.qmb, createdIso: "2024-11-04",
    sensitivity: "internal", derivedFrom: ["dok:lenkungsliste"],
  },
  {
    source: "managementreview-2025", target: "docx",
    corpusPath: "fileserver/QM/Managementbewertung_2025.docx",
    kind: "Managementbewertung", ownerId: KEY_EMPLOYEES.qmb, createdIso: "2025-12-12",
    sensitivity: "internal", derivedFrom: ["cert:iso9001"],
  },
  {
    source: "arbeitszeugnis-grothe", target: "docx",
    corpusPath: "fileserver/Personal/Personalakten/Arbeitszeugnis_Grothe_Manfred_0014.docx",
    kind: "Arbeitszeugnis", ownerId: KEY_EMPLOYEES.personalleiterin, createdIso: "2021-09-30",
    sensitivity: "personal-data", derivedFrom: [KEY_EMPLOYEES.ausgeschieden],
  },

  // ---- Spreadsheets --------------------------------------------------------
  {
    source: "kalkulation", target: "xlsx",
    corpusPath: "fileserver/Vertrieb/Kalkulation/Kalkulation_Angebote.xlsx",
    kind: "Kalkulation", ownerId: KEY_EMPLOYEES.kalkulationsMeister, createdIso: "2006-04-03",
    sensitivity: "internal", derivedFrom: ["mail:0005"],
  },
  {
    source: "preisliste-2026", target: "xlsx",
    corpusPath: "fileserver/Vertrieb/Preisliste_2026.xlsx",
    kind: "Preisliste", ownerId: KEY_EMPLOYEES.vertriebsleiter, createdIso: "2026-01-01",
    sensitivity: "internal", derivedFrom: [HERO_ARTICLE.id],
  },
  {
    source: "werkzeugliste", target: "xlsx",
    corpusPath: "fileserver/Werkzeugbau/Werkzeugliste.xlsx",
    kind: "Werkzeugliste", ownerId: KEY_EMPLOYEES.kalkulationsMeister, createdIso: "2025-06-02",
    sensitivity: "internal", derivedFrom: [`wkz:${DISPUTED_TOOL_NO}`],
  },
  {
    source: "maschinenliste", target: "xlsx",
    corpusPath: "fileserver/Instandhaltung/Maschinenliste.xlsx",
    kind: "Maschinenliste", ownerId: KEY_EMPLOYEES.instandhaltung, createdIso: "2025-04-18",
    sensitivity: "internal", derivedFrom: [SERIAL_LESS_MACHINE_ID],
  },
  {
    source: "pruefmittel", target: "xlsx",
    corpusPath: "fileserver/QM/Prüfmittelüberwachung.xlsx",
    kind: "Prüfmittelüberwachung", ownerId: KEY_EMPLOYEES.qmb, createdIso: "2026-02-03",
    sensitivity: "internal", derivedFrom: [],
  },
  {
    source: "urlaubsplanung-2026", target: "xlsx",
    corpusPath: "fileserver/Personal/Urlaubsplanung_2026.xlsx",
    kind: "Urlaubsplanung", ownerId: KEY_EMPLOYEES.personalleiterin, createdIso: "2026-01-15",
    sensitivity: "personal-data", derivedFrom: [],
  },

  // ---- PDFs ----------------------------------------------------------------
  {
    source: "qm-handbuch", target: "pdf",
    corpusPath: "fileserver/QM/freigegeben/QM-Handbuch_Rev7.pdf",
    kind: "QM-Handbuch", ownerId: KEY_EMPLOYEES.qmb, createdIso: "2025-08-28",
    sensitivity: "internal", derivedFrom: ["cert:iso9001"],
  },
  {
    source: "zeichnung-df12040", target: "pdf",
    corpusPath: `fileserver/Konstruktion/Zeichnungen/${HERO_ARTICLE.articleNo}_Rev3.pdf`,
    kind: "Technische Zeichnung", ownerId: "emp:0010", createdIso: "2023-01-11",
    sensitivity: "internal", derivedFrom: [HERO_ARTICLE.id],
  },
  {
    source: "rahmenvertrag-rehwinkel", target: "pdf",
    corpusPath: "fileserver/Einkauf/Vertraege/Rahmenvertrag_Rehwinkel_2024.pdf",
    kind: "Rahmenvertrag", ownerId: "emp:0013", createdIso: "2024-01-01",
    sensitivity: "internal", derivedFrom: [],
  },
  {
    source: "avv-datev", target: "pdf",
    corpusPath: "fileserver/Datenschutz/AVV_Steuerberater_DATEV.pdf",
    kind: "Auftragsverarbeitungsvertrag", ownerId: KEY_EMPLOYEES.gfKaufmaennisch, createdIso: "2023-03-14",
    sensitivity: "internal", derivedFrom: ["dok:vvt"],
  },
  {
    source: "zertifikat-iso9001", target: "pdf",
    corpusPath: "fileserver/QM/Zertifikat_ISO9001_2025.pdf",
    kind: "Zertifikat", ownerId: KEY_EMPLOYEES.qmb, createdIso: "2025-09-01",
    sensitivity: "public", derivedFrom: ["cert:iso9001"],
  },
  {
    source: "bestellung-44120", target: "pdf",
    corpusPath: "fileserver/Einkauf/Bestellungen/Bestellung_44120_Rehwinkel.pdf",
    kind: "Bestellung", ownerId: "emp:0013", createdIso: "2025-03-24",
    sensitivity: "internal", derivedFrom: [],
  },
  {
    source: "jahresabschluss-2024", target: "pdf",
    corpusPath: "fileserver/Buchhaltung/Jahresabschluss_2024_Auszug.pdf",
    kind: "Jahresabschluss", ownerId: "emp:0012", createdIso: "2025-05-30",
    sensitivity: "internal", derivedFrom: [],
  },
  {
    source: "betriebsanweisung-kugelstrahl", target: "pdf",
    corpusPath: "fileserver/Fertigung/Betriebsanweisungen/BA-07_Kugelstrahlanlage.pdf",
    kind: "Betriebsanweisung", ownerId: null, createdIso: "2024-03-06",
    sensitivity: "internal", derivedFrom: [],
  },

  // ---- Scans: pixels, no text layer ----------------------------------------
  // The multifunction printer in the corridor writes here. It names files by counter, so
  // nothing about a filename tells you what is inside — see mail:0007.
  {
    source: "scan-rahmenvertrag", target: "pdf", scan: true,
    corpusPath: "fileserver/Scans/2024-01-08_Scan_0117.pdf",
    kind: "Rahmenvertrag (Scan)", ownerId: "emp:0013", createdIso: "2024-01-08",
    sensitivity: "internal", derivedFrom: ["dok:fixture-rahmenvertrag-rehwinkel"],
  },
  {
    source: "scan-lieferschein", target: "pdf", scan: true,
    corpusPath: "fileserver/Scans/2025-04-02_Scan_0834.pdf",
    kind: "Wareneingangsbeleg (Scan)", ownerId: null, createdIso: "2025-04-02",
    sensitivity: "internal", derivedFrom: [],
  },
  /**
   * Health data. A German AU-Bescheinigung carries no diagnosis — the employer's copy never
   * does — but incapacity and its duration are Art. 9 DSGVO data all the same.
   *
   * It sits in a folder every domain user may write to, under a filename that reveals
   * nothing, in a format nothing in this repo can read. acl-report.ts finds it because the
   * manifest classifies it; an agent restricted to the corpus cannot, and that gap is the
   * honest finding. Faking OCR text on it would fabricate the very entropy we refuse to fake.
   */
  {
    source: "scan-au-bescheinigung", target: "pdf", scan: true,
    corpusPath: "fileserver/Scans/2026-03-11_Scan_0003.pdf",
    kind: "Arbeitsunfähigkeitsbescheinigung (Scan)", ownerId: KEY_EMPLOYEES.personalleiterin,
    createdIso: "2026-03-11", sensitivity: "special-category", derivedFrom: ["emp:0008"],
  },
];

/* -------------------------------------------------------------------------- */
/* Vendored, not authored                                                      */
/* -------------------------------------------------------------------------- */

export interface Vendored {
  /** Filename under fixtures/vendored/. Produced once by fixtures/vendor.ts. */
  readonly source: string;
  readonly corpusPath: string;
  readonly kind: string;
  readonly createdIso: string;
}

/**
 * The one file in this corpus nobody here wrote. Every other byte was authored by the same
 * person who also wrote the questions — real legal German is entropy no generator produces,
 * and without it a retriever that learned this author's cadence would be measuring itself.
 *
 * The BetrVG is not a random statute. § 87 Abs. 1 Nr. 6 is the provision the works council
 * cites in mail:0003, and § 9 is where BETRIEBSRAT_SIZE = 7 comes from. It belongs in the
 * Betriebsrat's folder because that is where a works council keeps it.
 *
 * Amtliches Werk, gemeinfrei nach § 5 Abs. 1 UrhG. Provenance sits in the file's own header.
 */
export const VENDORED: readonly Vendored[] = [
  {
    source: "BetrVG.txt",
    corpusPath: "fileserver/Betriebsrat/Recht/BetrVG.txt",
    kind: "Gesetzestext",
    createdIso: "2024-07-24",
  },
];

export function vendoredDocuments(): DocumentFact[] {
  return VENDORED.map((entry) => ({
    id: `dok:vendored-${entry.source.replace(/\.[^.]+$/, "").toLowerCase()}`,
    path: entry.corpusPath,
    kind: entry.kind,
    format: "txt",
    ownerId: null,
    createdIso: entry.createdIso,
    // Public: it is the law. acl-report.ts therefore ignores it, which is correct — a
    // statute in the works council's folder is not a data-protection finding.
    sensitivity: "public",
    hasTextLayer: true,
    derivedFrom: [],
    supersededBy: null,
    isDistractor: false,
  }));
}

/**
 * Fixtures enter the fact model as body-less DocumentFacts: writeDocuments() skips anything
 * without a body, and generate.ts copies the committed binary instead.
 *
 * Born-digital documents carry a text layer. The three scans do not, and we do not fake one:
 * no OCR noise, no invented handwriting. The page is pixels, `hasTextLayer` says so, and a
 * text extractor gets nothing — which is exactly what it would get from the real thing.
 */
export function fixtureDocuments(): DocumentFact[] {
  return FIXTURES.map((fixture) => ({
    id: `dok:fixture-${fixture.source}`,
    path: fixture.corpusPath,
    kind: fixture.kind,
    format: fixture.target,
    ownerId: fixture.ownerId,
    createdIso: fixture.createdIso,
    sensitivity: fixture.sensitivity,
    hasTextLayer: fixture.scan !== true,
    derivedFrom: fixture.derivedFrom,
    supersededBy: null,
    isDistractor: false,
  }));
}

export function fixtureByCorpusPath(path: string): Fixture | undefined {
  return FIXTURES.find((fixture) => fixture.corpusPath === path);
}
