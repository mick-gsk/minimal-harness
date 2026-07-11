/**
 * The hand-authored core of the corpus.
 *
 * Everything here is written by a human, not drawn from the PRNG. The critics were right:
 * only hand-written documents carry entropy a generator cannot fake, and only ~20-30 of
 * them carry any evaluation signal at all. The generated bulk elsewhere is cheap volume.
 *
 * Three signature contradictions live here. Each maps to exactly one demo/eval question:
 *   1. tribal-only   — the agreed price exists in one mail and nowhere else
 *   2. stale-version — three revisions of one work instruction, only the Lenkungsliste knows
 *   3. acl-violation — the salary export is readable by every domain user
 * Plus one no-authority contradiction (tool service life) where neither source wins.
 */
import { COMPANY, DISTRACTOR_FIRM } from "../seed.config.js";
import { deEuro, deNumber } from "../lib/fmt.js";
import {
  DISPUTED_TOOL_LIFE_MAINTENANCE,
  DISPUTED_TOOL_LIFE_MASTERCARD,
  DISPUTED_TOOL_NO,
  HERO_ARTICLE,
  HERO_ORDER,
  TRIBAL_PRICE_TOKEN,
} from "./catalog.js";
import { KEY_CUSTOMERS, MAIN_CUSTOMER_ID } from "./partners.js";
import { KEY_EMPLOYEES } from "./roster.js";
import { BDE_PERSONAL_FROM, DMS_ROLLOUT_STOPPED } from "./systems.js";
import type {
  AclEntry, AdGroup, DocumentFact, Employee, Inconsistency, MailThread, Sensitivity, Share,
} from "./types.js";

function mailOf(employees: readonly Employee[], id: string): string {
  const person = employees.find((e) => e.id === id);
  if (!person) throw new Error(`unknown employee ${id}`);
  return `"${person.firstName} ${person.lastName}" <${person.email}>`;
}

function customerName(id: string): string {
  const customer = KEY_CUSTOMERS.find((c) => c.id === id);
  if (!customer) throw new Error(`unknown customer ${id}`);
  return customer.name;
}

export function buildMailThreads(employees: readonly Employee[]): MailThread[] {
  const gf = mailOf(employees, KEY_EMPLOYEES.gfTechnisch);
  const kfm = mailOf(employees, KEY_EMPLOYEES.gfKaufmaennisch);
  const vl = mailOf(employees, KEY_EMPLOYEES.vertriebsleiter);
  const meister = mailOf(employees, KEY_EMPLOYEES.kalkulationsMeister);
  const qmb = mailOf(employees, KEY_EMPLOYEES.qmb);
  const hr = mailOf(employees, KEY_EMPLOYEES.personalleiterin);
  const it = mailOf(employees, KEY_EMPLOYEES.itLeiter);
  const br = mailOf(employees, KEY_EMPLOYEES.betriebsratsvorsitzender);
  const buha = mailOf(employees, "emp:0012");

  return [
    {
      // CONTRADICTION 1 — the agreed price lives here and nowhere else.
      id: "mail:0001",
      subject: `AW: Rahmenauftrag ${HERO_ORDER.orderNo} – Preis ${HERO_ARTICLE.articleNo}`,
      path: "mail/2024-03-14_wittenbrink_preisabsprache.eml",
      carriesTribalKnowledge: true,
      messages: [
        {
          from: vl,
          to: [gf],
          cc: [buha],
          sentIso: "2024-03-14T15:42:00Z",
          body: [
            "Hallo Friedrich,",
            "",
            `wie telefonisch besprochen haben wir uns mit Herrn Wittenbrink auf ${TRIBAL_PRICE_TOKEN}`,
            `für die ${HERO_ARTICLE.articleNo} geeinigt, gültig für die volle Abnahme von`,
            `${deNumber(HERO_ORDER.quantity, 0)} Stück. Er nimmt dafür die komplette Menge in vier`,
            "Abrufen bis Ende Juni ab.",
            "",
            `Listenpreis wäre ${deEuro(HERO_ARTICLE.listPriceEur)} gewesen. Ich habe ihm zugesagt, dass wir`,
            "das so in die Auftragsbestätigung schreiben.",
            "",
            "Gruß",
            "Marco",
          ].join("\r\n"),
        },
        {
          from: gf,
          to: [vl],
          sentIso: "2024-03-14T17:08:00Z",
          body: [
            "Moin Marco,",
            "",
            "ok von mir. Bitte gib das an die AV weiter, damit die Kalkulation stimmt.",
            "",
            "F. Selkinghaus",
          ].join("\r\n"),
        },
      ],
    },
    {
      // The consequence. Never names the agreed number — you must retrieve mail:0001.
      id: "mail:0002",
      subject: `Reklamation Rechnung zu Auftrag ${HERO_ORDER.orderNo}`,
      path: "mail/2024-07-02_wittenbrink_rechnungsreklamation.eml",
      carriesTribalKnowledge: false,
      messages: [
        {
          from: `"Einkauf" <einkauf@wittenbrink-antriebstechnik.de>`,
          to: [vl],
          sentIso: "2024-07-02T08:19:00Z",
          body: [
            "Sehr geehrter Herr Hüttemann,",
            "",
            `Ihre Rechnung zum Auftrag ${HERO_ORDER.orderNo} weist einen Stückpreis von`,
            `${deEuro(HERO_ORDER.erpUnitPriceEur)} aus. Das entspricht nicht dem Preis, den Herr`,
            "Wittenbrink im März mit Ihrem Herrn Selkinghaus telefonisch vereinbart hat.",
            "",
            "Wir bitten um korrigierte Rechnung.",
            "",
            "Mit freundlichen Grüßen",
            "i.A. Einkauf",
          ].join("\r\n"),
        },
        {
          from: vl,
          to: [buha],
          sentIso: "2024-07-02T09:33:00Z",
          body: [
            "Petra,",
            "",
            "kannst du bitte schauen, was im abas hinterlegt ist? Da steht offenbar noch der",
            "Listenpreis drin. Die Absprache lief damals über Friedrich und mich.",
            "",
            "Marco",
          ].join("\r\n"),
        },
      ],
    },
    {
      id: "mail:0003",
      subject: "BDE-Auswertung QS – Betriebsvereinbarung noch nicht unterschrieben",
      path: "mail/2026-05-11_bde_betriebsvereinbarung.eml",
      carriesTribalKnowledge: false,
      messages: [
        {
          from: br,
          to: [hr, kfm],
          cc: [qmb],
          sentIso: "2026-05-11T07:52:00Z",
          body: [
            "Guten Morgen,",
            "",
            "mir ist zugetragen worden, dass die QS seit April die Maschinendaten aus der BDE",
            "personenbezogen auswertet. Die entsprechende Betriebsvereinbarung liegt uns seit",
            "Februar als Entwurf vor, unterschrieben ist sie nicht.",
            "",
            "Nach § 87 Abs. 1 Nr. 6 BetrVG ist das mitbestimmungspflichtig. Ich bitte darum, die",
            "Auswertung bis zur Unterzeichnung auszusetzen.",
            "",
            "N. Stracke",
            "Betriebsratsvorsitzender",
          ].join("\r\n"),
        },
      ],
    },
    {
      id: "mail:0004",
      subject: "abas-Migration – Sachstand",
      path: "mail/2025-11-20_erp_migration_stillstand.eml",
      carriesTribalKnowledge: false,
      messages: [
        {
          from: it,
          to: [gf, kfm],
          sentIso: "2025-11-20T16:04:00Z",
          body: [
            "Hallo zusammen,",
            "",
            "Stand Migration: Die Stammdatenübernahme aus dem Altsystem hängt weiterhin an den",
            "Artikelnummern. Wir haben rund 1.400 Artikel, bei denen die alte Werkzeugnummer im",
            "Feld für die Zeichnungsnummer steht. Herr Plaßmann sagt, das sei damals \"so gewachsen\".",
            "",
            "Ohne eine Mappingliste kommen wir nicht weiter. Die Liste existiert nach meinem",
            "Kenntnisstand nur in seinem Kopf und in der Kalkulations-Excel.",
            "",
            "Gruß",
            "Dirk Nettelbeck",
          ].join("\r\n"),
        },
      ],
    },
    {
      id: "mail:0005",
      subject: "Nachfolge Kalkulation",
      path: "mail/2026-06-30_plassmann_rente.eml",
      carriesTribalKnowledge: false,
      messages: [
        {
          from: meister,
          to: [gf],
          sentIso: "2026-06-30T13:21:00Z",
          body: [
            "Friedrich,",
            "",
            "ich gehe zum 31.12. Ich habe die Kalkulation vor 20 Jahren aufgesetzt, das Blatt",
            "\"Zuschlag\" ist ausgeblendet. Der Faktor 1,7 auf die Rüstzeit steht da drin, den",
            "kennt sonst keiner.",
            "",
            "Wir sollten das mal jemandem zeigen.",
            "",
            "K.-H. Plaßmann",
          ].join("\r\n"),
        },
      ],
    },
    {
      /**
       * The paper trail for the scan nobody can read. Without it the health data in
       * K:\Scans would be a finding only acl-report.ts could reach — asserted through the
       * manifest, invisible in the corpus. This mail is the trace a real audit would follow:
       * it names the problem class without naming the file.
       */
      id: "mail:0007",
      subject: "Scanner im Flur legt alles auf S: ab",
      path: "mail/2026-03-16_scanordner_krankmeldungen.eml",
      carriesTribalKnowledge: false,
      messages: [
        {
          from: hr,
          to: [it],
          cc: [kfm],
          sentIso: "2026-03-16T11:24:00Z",
          body: [
            "Hallo Dirk,",
            "",
            "der Multifunktionsdrucker im Flur scannt alles nach S:\\, und S:\\ ist derselbe",
            "Ordner wie K:\\Scans. Da liegen inzwischen auch eingescannte Krankmeldungen",
            "zwischen Lieferscheinen. Die Dateien heißen nur \"Scan_0001\", \"Scan_0002\" usw.,",
            "man sieht von außen nicht, was drin ist.",
            "",
            "Auf K:\\Scans hat jeder Schreibrechte. Können wir für die Personalabteilung ein",
            "eigenes Scanziel einrichten?",
            "",
            "Viele Grüße",
            "Andrea Kersting",
          ].join("\r\n"),
        },
        {
          from: it,
          to: [hr],
          sentIso: "2026-03-16T15:02:00Z",
          body: [
            "Hallo Andrea,",
            "",
            "grundsätzlich ja. Der Drucker kann nur ein Scanziel, für ein zweites bräuchten wir",
            "die Lizenz für das Bedienfeld. Ich setze es auf die Liste.",
            "",
            "Die alten Scans müsste jemand von Hand durchsehen. Das sind ein paar hundert.",
            "",
            "Dirk",
          ].join("\r\n"),
        },
      ],
    },
    {
      // Distractor: mail about the confusingly similar firm in Hemer. No question needs it.
      id: "mail:0006",
      subject: `Falsch zugestellt: Rechnung ${DISTRACTOR_FIRM.name}`,
      path: "mail/2025-09-03_falschzustellung_hemer.eml",
      carriesTribalKnowledge: false,
      messages: [
        {
          from: buha,
          to: [kfm],
          sentIso: "2025-09-03T10:47:00Z",
          body: [
            "Bernd,",
            "",
            `schon wieder eine Rechnung für die ${DISTRACTOR_FIRM.name} in`,
            `${DISTRACTOR_FIRM.town} bei uns im Briefkasten. Die Spedition verwechselt uns`,
            "regelmäßig. Ich habe sie zurückgeschickt.",
            "",
            `Zur Klarstellung: ${DISTRACTOR_FIRM.note}`,
            "",
            "Petra",
          ].join("\r\n"),
        },
      ],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const AA032_HEADER = "# AA-032 Arbeitsanweisung Federnwickeln\n";

export function buildDocuments(employees: readonly Employee[]): DocumentFact[] {
  const docs: DocumentFact[] = [];

  // Sits at the corpus root so nobody can browse this tree and mistake it for real data.
  docs.push({
    id: "dok:disclaimer",
    path: "HINWEIS_SYNTHETISCHE_DATEN.txt",
    kind: "Disclaimer",
    format: "txt",
    ownerId: null,
    createdIso: "2026-07-10",
    sensitivity: "public",
    hasTextLayer: true,
    derivedFrom: [],
    supersededBy: null,
    isDistractor: false,
    body:
      "SYNTHETISCHE DATEN — KEINE ECHTE FIRMA\r\n" +
      "=======================================\r\n\r\n" +
      `Die ${COMPANY.legalName} ist frei erfunden.\r\n` +
      `Ebenso die ${DISTRACTOR_FIRM.name}.\r\n\r\n` +
      "Alle Personen, Kunden, Lieferanten, Aufträge, Preise, Gehälter, Maschinen und\r\n" +
      "Dokumente in diesem Verzeichnis sind maschinell erzeugt. Ähnlichkeiten mit\r\n" +
      "existierenden Unternehmen oder lebenden Personen sind nicht beabsichtigt.\r\n\r\n" +
      "Die Ortsnamen des Märkischen Kreises sind real, die dort angesiedelten Firmen\r\n" +
      "nicht. Es wurden keine Daten realer Unternehmen verwendet.\r\n\r\n" +
      "Erzeugt von: minimal-harness/company/generate.ts\r\n",
  });

  // CONTRADICTION 2 — three revisions in three folders. Only the Lenkungsliste knows.
  docs.push({
    id: "dok:aa032-revc",
    path: "fileserver/QM/freigegeben/AA-032_Federnwickeln_RevC.md",
    kind: "Arbeitsanweisung",
    format: "md",
    ownerId: KEY_EMPLOYEES.qmb,
    createdIso: "2025-02-17",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["proc:federnwickeln"],
    supersededBy: null,
    isDistractor: false,
    body:
      `${AA032_HEADER}\nRevision: C\nFreigegeben: 17.02.2025 durch S. Wiethoff (QMB)\n\n` +
      "## 3 Vorgabewerte\n\n" +
      "- Wickelverhältnis: 4 bis 12\n" +
      "- Anlassen: 240 °C, 30 min\n" +
      "- **Prüfintervall: jedes 500. Teil**\n" +
      "- Kugelstrahlen: nur bei dynamischer Belastung\n\n" +
      "## 4 Dokumentation\n\nPrüfergebnisse in QS-Formblatt FB-014 eintragen.\n",
  });
  docs.push({
    id: "dok:aa032-revb",
    path: "fileserver/Fertigung/Anweisungen/AA-032_Federnwickeln_RevB.md",
    kind: "Arbeitsanweisung",
    format: "md",
    ownerId: KEY_EMPLOYEES.qmb,
    createdIso: "2021-06-03",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["proc:federnwickeln"],
    supersededBy: "dok:aa032-revc",
    isDistractor: false,
    body:
      `${AA032_HEADER}\nRevision: B\nFreigegeben: 03.06.2021 durch S. Wiethoff (QMB)\n\n` +
      "## 3 Vorgabewerte\n\n" +
      "- Wickelverhältnis: 4 bis 12\n" +
      "- Anlassen: 220 °C, 20 min\n" +
      "- **Prüfintervall: jedes 200. Teil**\n\n" +
      "## 4 Dokumentation\n\nPrüfergebnisse in QS-Formblatt FB-014 eintragen.\n",
  });
  docs.push({
    id: "dok:aa032-entwurf",
    path: "fileserver/Austausch/AA-032_Federnwickeln_final_final_v3_NEU.md",
    kind: "Arbeitsanweisung (Entwurf)",
    format: "md",
    ownerId: "emp:0009",
    createdIso: "2026-01-22",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["proc:federnwickeln"],
    supersededBy: null,
    isDistractor: false,
    body:
      `${AA032_HEADER}\nRevision: D (ENTWURF – nicht freigegeben)\n\n` +
      "## 3 Vorgabewerte\n\n" +
      "- Wickelverhältnis: 4 bis 14\n" +
      "- Anlassen: 240 °C, 30 min\n" +
      "- **Prüfintervall: jedes 1000. Teil** <- so machen wir das doch längst?\n\n" +
      "Anm. N.S.: bitte mit Sabine abstimmen, ich habe das nur mal aufgeschrieben.\n",
  });
  docs.push({
    id: "dok:lenkungsliste",
    path: "fileserver/QM/Dokumentenlenkung.csv",
    kind: "Dokumentenlenkungsliste",
    format: "csv",
    ownerId: KEY_EMPLOYEES.qmb,
    createdIso: "2026-03-02",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["dok:aa032-revc", "dok:aa032-revb", "dok:aa032-entwurf"],
    supersededBy: null,
    isDistractor: false,
    body: [
      "Dokument;Titel;Gueltige Revision;Freigabedatum;Freigegeben durch;Ablageort",
      "AA-032;Arbeitsanweisung Federnwickeln;C;17.02.2025;S. Wiethoff;QM\\freigegeben",
      "AA-018;Arbeitsanweisung Stanzen;E;04.11.2024;S. Wiethoff;QM\\freigegeben",
      "FB-014;Formblatt Pruefprotokoll;B;12.01.2023;S. Wiethoff;QM\\freigegeben",
      "QMH;Qualitaetsmanagementhandbuch;7;28.08.2025;F. Selkinghaus;QM\\freigegeben",
    ].join("\n"),
  });

  // CONTRADICTION 3 — the salary export. Its folder ACL is the finding, not the file.
  docs.push({
    id: "dok:gehaltsliste",
    path: "fileserver/Personal/Gehaelter/Gehaltsliste_2026.csv",
    kind: "Gehaltsliste",
    format: "csv",
    ownerId: KEY_EMPLOYEES.personalleiterin,
    createdIso: "2026-01-31",
    sensitivity: "personal-data",
    hasTextLayer: true,
    derivedFrom: ["emp:*"],
    supersededBy: null,
    isDistractor: false,
    body: buildSalaryCsv(employees),
  });

  // CONTRADICTION 4 (no authority) — two sources, neither wins.
  docs.push({
    id: "dok:stammkarte-w4471",
    path: `fileserver/Werkzeugbau/Stammkarten/${DISPUTED_TOOL_NO}_Werkzeugstammkarte.md`,
    kind: "Werkzeugstammkarte",
    format: "md",
    ownerId: KEY_EMPLOYEES.kalkulationsMeister,
    createdIso: "2019-04-11",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: [`wkz:${DISPUTED_TOOL_NO}`],
    supersededBy: null,
    isDistractor: false,
    body:
      `# Werkzeugstammkarte ${DISPUTED_TOOL_NO}\n\n` +
      "Folgeverbundwerkzeug, 4-fach\n" +
      `Erwartete Standzeit: ${deNumber(DISPUTED_TOOL_LIFE_MASTERCARD, 0)} Hub\n` +
      "Nachschliff: alle 40.000 Hub\n\n" +
      "Angelegt: K.-H. Plaßmann, 11.04.2019. Seither nicht aktualisiert.\n",
  });
  docs.push({
    id: "dok:wartung-w4471",
    path: `fileserver/Instandhaltung/Wartung/2025-08-14_${DISPUTED_TOOL_NO}_Wartungsprotokoll.md`,
    kind: "Wartungsprotokoll",
    format: "md",
    ownerId: KEY_EMPLOYEES.instandhaltung,
    createdIso: "2025-08-14",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: [`wkz:${DISPUTED_TOOL_NO}`],
    supersededBy: null,
    isDistractor: false,
    body:
      `# Wartungsprotokoll ${DISPUTED_TOOL_NO}\n\nDatum: 14.08.2025\nDurchgeführt: U. Kalthoff\n\n` +
      `Werkzeug nach ${deNumber(DISPUTED_TOOL_LIFE_MAINTENANCE, 0)} Hub ausgefallen (Schneidplatte gebrochen).\n` +
      "Die auf der Stammkarte angegebene Standzeit wird in der Praxis nicht erreicht.\n" +
      "Ursache vermutlich Materialwechsel beim Bandstahl 2023.\n\n" +
      "Stammkarte wurde NICHT korrigiert.\n",
  });

  docs.push({
    id: "dok:qmh",
    path: "fileserver/QM/freigegeben/QM-Handbuch_Rev7.md",
    kind: "QM-Handbuch",
    format: "md",
    ownerId: KEY_EMPLOYEES.qmb,
    createdIso: "2025-08-28",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: ["cert:iso9001"],
    supersededBy: null,
    isDistractor: false,
    body:
      "# Qualitätsmanagementhandbuch\n\nRevision 7 – 28.08.2025\n\n" +
      `Der Geltungsbereich umfasst Entwicklung und Fertigung von Federn, Stanz- und\n` +
      `Drahtbiegeteilen am Standort ${COMPANY.town}.\n\n` +
      `Zertifizierung: ${COMPANY.certification}.\n` +
      `Hinweis: ${COMPANY.abandonedCertification}. Kundenspezifische Forderungen der\n` +
      "Automobilkunden werden im Rahmen von Kundenaudits abgedeckt.\n",
  });

  // Special-category folder. HR can read it — the second ACL finding hangs off this file.
  docs.push({
    id: "dok:br-protokoll",
    path: "fileserver/Betriebsrat/Protokolle/2026-05-19_Sitzungsprotokoll.md",
    kind: "Betriebsratsprotokoll",
    format: "md",
    ownerId: KEY_EMPLOYEES.betriebsratsvorsitzender,
    createdIso: "2026-05-19",
    sensitivity: "special-category",
    hasTextLayer: true,
    derivedFrom: ["mail:0003"],
    supersededBy: null,
    isDistractor: false,
    body:
      "# Protokoll der Betriebsratssitzung\n\nDatum: 19.05.2026, 14:00 Uhr, Besprechungsraum 2\n" +
      "Anwesend: 7 von 7 Mitgliedern\n\n" +
      "## TOP 2 BDE-Auswertung\n\n" +
      "Der Vorsitzende berichtet, dass die QS seit April personenbezogene Auswertungen aus der\n" +
      "BDE vornimmt, obwohl die Betriebsvereinbarung nicht unterzeichnet ist. Der Betriebsrat\n" +
      "sieht darin einen Verstoß gegen § 87 Abs. 1 Nr. 6 BetrVG.\n\n" +
      "Beschluss: Der Betriebsrat fordert die sofortige Aussetzung. Einstimmig angenommen.\n\n" +
      "## TOP 4 Personelle Einzelmaßnahme\n\n" +
      "Zustimmung zur Versetzung eines Mitarbeiters aus der Fertigung in den Werkzeugbau\n" +
      "wurde erteilt. Name und Details siehe Anlage 1 (nicht öffentlich).\n",
  });

  // The data-protection concept that ALLOWED_GROUPS encodes. Without it the ACL delta
  // would be an assertion rather than a derivation.
  docs.push({
    id: "dok:vvt",
    path: "fileserver/Datenschutz/Verzeichnis_von_Verarbeitungstaetigkeiten.md",
    kind: "Verzeichnis von Verarbeitungstätigkeiten",
    format: "md",
    ownerId: KEY_EMPLOYEES.personalleiterin,
    createdIso: "2025-10-06",
    sensitivity: "public",
    hasTextLayer: true,
    derivedFrom: [],
    supersededBy: null,
    isDistractor: false,
    body:
      "# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)\n\n" +
      "## VT-03 Entgeltabrechnung\n\n" +
      "- Kategorien betroffener Personen: Beschäftigte\n" +
      "- Datenkategorien: Stammdaten, Entgeltdaten, Bankverbindung\n" +
      "- **Zugriffsberechtigt: ausschließlich Personalabteilung (GG_Personal) und\n" +
      "  Geschäftsführung (GG_GF).**\n" +
      "- Löschfrist: 10 Jahre (§ 147 AO, § 257 HGB)\n\n" +
      "## VT-07 Betriebsratsarbeit\n\n" +
      "- Datenkategorien: personenbezogene Daten aus Mitbestimmungsverfahren,\n" +
      "  ggf. besondere Kategorien nach Art. 9 DSGVO\n" +
      "- **Zugriffsberechtigt: ausschließlich Betriebsratsmitglieder (GG_Betriebsrat).**\n\n" +
      "## Technische und organisatorische Maßnahmen\n\n" +
      "Der Zugriffsschutz auf dem Fileserver erfolgt über NTFS-Berechtigungen. Die\n" +
      "Berechtigungen sind jährlich zu überprüfen. Letzte Überprüfung: 2021.\n",
  });

  docs.push({
    id: "dok:leaver-ordner",
    path: "fileserver/Grothe/Angebote_2019/README_WICHTIG.txt",
    kind: "Notiz",
    format: "txt",
    ownerId: KEY_EMPLOYEES.ausgeschieden,
    createdIso: "2019-11-08",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: [],
    supersededBy: null,
    isDistractor: false,
    body:
      "BITTE NICHT LOESCHEN!\r\n\r\n" +
      "Hier liegen die Angebotskalkulationen 2019. Die Preise sind mit dem alten\r\n" +
      "Zuschlagsatz gerechnet. Fragen an mich oder an Kalle.\r\n\r\nM. Grothe\r\n",
  });

  // Signal, not noise: ground-truth question f15 (entity resolution) resolves against this.
  docs.push({
    id: "dok:namensverwechslung",
    path: "fileserver/Vertrieb/Namensverwechslung_Hinweis.txt",
    kind: "Hinweis",
    format: "txt",
    ownerId: KEY_EMPLOYEES.vertriebsleiter,
    createdIso: "2025-09-04",
    sensitivity: "internal",
    hasTextLayer: true,
    derivedFrom: [],
    supersededBy: null,
    isDistractor: false,
    body:
      `Es gibt in ${DISTRACTOR_FIRM.town} die ${DISTRACTOR_FIRM.name}.\r\n` +
      `${DISTRACTOR_FIRM.note}\r\n\r\n` +
      "Bei Rückfragen von Kunden bitte klarstellen. Post und Rechnungen werden\r\n" +
      "regelmäßig verwechselt.\r\n",
  });

  docs.push(...buildDistractorDocuments());
  return docs;
}

/**
 * Salary rows. Personal data by construction — that is the point of the file.
 * Values are derived from tenure and department, so they are stable without a PRNG.
 */
function buildSalaryCsv(employees: readonly Employee[]): string {
  const base: Record<string, number> = {
    gf: 11_500, vertrieb: 4_200, konstruktion: 4_600, arbeitsvorbereitung: 4_100,
    fertigung: 3_150, werkzeugbau: 3_900, qs: 3_700, einkauf: 4_000,
    lager: 3_050, buchhaltung: 3_800, personal: 4_100, it: 4_500,
  };
  const rows = ["Personalnummer;Nachname;Vorname;Abteilung;Eintritt;Monatsgehalt EUR"];
  for (const e of employees) {
    if (e.leftIso) continue;
    const years = 2026 - Number(e.hiredIso.slice(0, 4));
    const salary = (base[e.department] ?? 3_000) + years * 32;
    rows.push(
      [e.id.replace("emp:", ""), e.lastName, e.firstName, e.department, e.hiredIso, deNumber(salary)].join(";"),
    );
  }
  return rows.join("\r\n");
}

/**
 * Documents no ground-truth question references. A corpus in which every document is
 * relevant is the classic generator tell; these exist purely as retrieval noise.
 * Several mention the distractor firm, so entity resolution is non-trivial.
 */
function buildDistractorDocuments(): DocumentFact[] {
  const noise: ReadonlyArray<readonly [string, string, string]> = [
    ["fileserver/Austausch/Kantinenplan_KW28.txt", "Aushang", "Montag: Grünkohl mit Mettwurst\nDienstag: Nudelauflauf\nMittwoch: Schnitzel\nDonnerstag: Linseneintopf\nFreitag: Backfisch\n"],
    ["fileserver/Austausch/Neuer Ordner (2)/unbenannt.txt", "Leerdatei", "\n"],
    ["fileserver/_ALT/Telefonliste_2014.txt", "Telefonliste", "Zentrale 0\nPforte 11\nWerkstatt 42\nEDV 17\n(Stand 2014, veraltet)\n"],
    ["fileserver/Austausch/Weihnachtsfeier_2025_Zusagen.txt", "Liste", "Bitte bis 01.12. eintragen.\n"],
    // Incoming, from a supplier — a scan, and it belongs on the fileserver. Our OWN
    // Lieferscheine and Rechnungen are ERP rows and never files; verify.ts asserts that.
    ["fileserver/Scans/2025-04-02_Lieferschein_Rehwinkel.txt", "Wareneingangsbeleg", "Lieferschein 44120 - Federstahldraht SH 2,5 mm - 1.200 kg\n"],
    ["fileserver/Buchhaltung/Ablage/Kontoauszug_Sparkasse_2025-08.txt", "Kontoauszug", "Auszug 08/2025. Keine Auffälligkeiten.\n"],
    ["fileserver/Einkauf/Angebote/Buerobedarf_2026.txt", "Angebot", "Kopierpapier A4, 500 Blatt: 4,19 EUR/Paket\n"],
    ["fileserver/_ALT/Serverumzug_2016_Notizen.txt", "Notiz", "Alter Fileserver FS00 abgeschaltet 11/2016. Daten auf FS01 übernommen.\n"],
    ["fileserver/Vertrieb/Messen/Hannover_2025_Standplan.txt", "Standplan", "Halle 4, Stand C18, 12 qm.\n"],
    // These three name the distractor firm. No question references them.
    ["fileserver/Buchhaltung/Ablage/Fehlbuchung_Hemer_2025-09.txt", "Notiz",
      `Rechnung war an ${DISTRACTOR_FIRM.name}, ${DISTRACTOR_FIRM.town} adressiert.\nZurückgeschickt am 03.09.2025. ${DISTRACTOR_FIRM.note}\n`],
    ["fileserver/Lager/Versandliste_KW22.txt", "Versandliste",
      "KW 22: 14 Sendungen, 2 Teillieferungen, keine Reklamation.\n"],
    ["fileserver/_ALT/Handelsregister_Auszug_Kopie.txt", "Kopie",
      `Auszug (Kopie, unbeglaubigt): ${COMPANY.legalName}, Sitz ${COMPANY.town}.\nGegründet ${COMPANY.founded}.\n`],
  ];
  return noise.map(([path, kind, body], index) => ({
    id: `dok:noise-${String(index + 1).padStart(2, "0")}`,
    path,
    kind,
    format: path.slice(path.lastIndexOf(".") + 1),
    ownerId: null,
    createdIso: "2025-06-01",
    sensitivity: "internal" as Sensitivity,
    hasTextLayer: true,
    derivedFrom: [],
    supersededBy: null,
    isDistractor: true,
    body,
  }));
}

/* -------------------------------------------------------------------------- */
/* Active Directory, shares, ACLs                                              */
/* -------------------------------------------------------------------------- */

export const SHARES: readonly Share[] = [
  { unc: `\\\\${COMPANY.fileServer}\\daten`, driveLetter: "K:", localPath: "D:\\Freigaben\\daten" },
  { unc: `\\\\${COMPANY.fileServer}\\scans`, driveLetter: "S:", localPath: "D:\\Freigaben\\scans" },
];

/**
 * Which groups may see which sensitivity class, per the Datenschutzkonzept.
 * The ACL report computes the delta between this intent and the actual ACL entries.
 */
export const ALLOWED_GROUPS: Readonly<Record<Sensitivity, readonly string[]>> = {
  public: ["Domänen-Benutzer", "GG_GF"],
  internal: ["Domänen-Benutzer", "GG_GF"],
  "personal-data": ["GG_Personal", "GG_GF"],
  "special-category": ["GG_Betriebsrat"],
};

export function buildAdGroups(employees: readonly Employee[], departmentGroups: ReadonlyMap<string, string>): AdGroup[] {
  const groups: AdGroup[] = [
    {
      name: "Domänen-Benutzer",
      description: "Alle Benutzerkonten der Domäne. Wird von Windows automatisch gepflegt.",
      memberIds: employees.filter((e) => !e.leftIso).map((e) => e.id),
    },
    {
      name: "GG_Betriebsrat",
      description: "Betriebsratsmitglieder. Zugriff auf Betriebsratsablage.",
      memberIds: employees.filter((e) => e.isBetriebsrat).map((e) => e.id),
    },
  ];
  for (const [department, groupName] of departmentGroups) {
    groups.push({
      name: groupName,
      description: `Mitarbeiter der Abteilung ${department}.`,
      memberIds: employees.filter((e) => e.department === department && !e.leftIso).map((e) => e.id),
    });
  }
  return groups;
}

/**
 * The ACL table as it actually stands on FS01 — grown, not designed.
 *
 * Two entries violate the Datenschutzkonzept. Neither is annotated as a violation here:
 * the ACL report DERIVES that by comparing `group` against ALLOWED_GROUPS. A finding that
 * is asserted rather than computed would prove nothing.
 */
export const ACLS: readonly AclEntry[] = [
  { path: "QM", group: "Domänen-Benutzer", right: "read", intendedSensitivity: "internal" },
  { path: "QM/freigegeben", group: "GG_QS", right: "modify", intendedSensitivity: "internal" },
  { path: "Fertigung", group: "GG_Fertigung", right: "modify", intendedSensitivity: "internal" },
  { path: "Fertigung/Anweisungen", group: "Domänen-Benutzer", right: "read", intendedSensitivity: "internal" },
  { path: "Austausch", group: "Domänen-Benutzer", right: "modify", intendedSensitivity: "internal" },
  { path: "Vertrieb", group: "GG_Vertrieb", right: "modify", intendedSensitivity: "internal" },
  { path: "Konstruktion", group: "GG_Konstruktion", right: "modify", intendedSensitivity: "internal" },
  { path: "Einkauf", group: "GG_Einkauf", right: "modify", intendedSensitivity: "internal" },
  { path: "Werkzeugbau", group: "GG_Werkzeugbau", right: "modify", intendedSensitivity: "internal" },
  { path: "Instandhaltung", group: "GG_Werkzeugbau", right: "modify", intendedSensitivity: "internal" },
  { path: "Lager", group: "GG_Lager", right: "modify", intendedSensitivity: "internal" },
  { path: "Buchhaltung", group: "GG_Buchhaltung", right: "modify", intendedSensitivity: "internal" },
  { path: "Personal", group: "GG_Personal", right: "full", intendedSensitivity: "personal-data" },
  // Grown over years: someone needed "just one file" out of there and it was never revoked.
  { path: "Personal/Gehaelter", group: "Domänen-Benutzer", right: "read", intendedSensitivity: "personal-data" },
  { path: "Personal/Gehaelter", group: "GG_Personal", right: "full", intendedSensitivity: "personal-data" },
  { path: "Betriebsrat", group: "GG_Betriebsrat", right: "full", intendedSensitivity: "special-category" },
  // Mitbestimmung problem: HR can read the works council's minutes.
  { path: "Betriebsrat/Protokolle", group: "GG_Personal", right: "read", intendedSensitivity: "special-category" },
  { path: "Grothe", group: "Domänen-Benutzer", right: "read", intendedSensitivity: "internal" },
  { path: "_ALT", group: "Domänen-Benutzer", right: "read", intendedSensitivity: "internal" },
  { path: "Datenschutz", group: "Domänen-Benutzer", right: "read", intendedSensitivity: "public" },
  { path: "Scans", group: "Domänen-Benutzer", right: "modify", intendedSensitivity: "internal" },
];

/* -------------------------------------------------------------------------- */
/* Inconsistencies                                                             */
/* -------------------------------------------------------------------------- */

export const INCONSISTENCIES: readonly Inconsistency[] = [
  {
    id: "inc:preis-nur-in-mail",
    kind: "tribal-only",
    summary:
      `Der mit ${customerName(MAIN_CUSTOMER_ID)} vereinbarte Stückpreis von ${TRIBAL_PRICE_TOKEN} ` +
      `für ${HERO_ARTICLE.articleNo} existiert ausschließlich in einem Mailthread. ` +
      `Das ERP führt den Listenpreis ${deEuro(HERO_ARTICLE.listPriceEur)}.`,
    sources: ["mail:0001", "auf:2024-0871"],
    authoritative: "mail:0001",
  },
  {
    id: "inc:aa032-revisionen",
    kind: "stale-version",
    summary:
      "Drei Fassungen der Arbeitsanweisung AA-032 liegen in drei Ordnern. Welche gilt, steht " +
      "ausschließlich in der Dokumentenlenkungsliste: Revision C.",
    sources: ["dok:aa032-revc", "dok:aa032-revb", "dok:aa032-entwurf", "dok:lenkungsliste"],
    authoritative: "dok:aa032-revc",
  },
  {
    id: "inc:gehaltsliste-weltlesbar",
    kind: "acl-violation",
    summary:
      "Die Gehaltsliste liegt in einem Ordner, auf den die Gruppe \"Domänen-Benutzer\" Leserechte " +
      "hat. Laut Datenschutzkonzept dürfen nur GG_Personal und GG_GF zugreifen.",
    sources: ["dok:gehaltsliste"],
    authoritative: null,
  },
  {
    id: "inc:export2019-veraltet",
    kind: "stale-version",
    summary:
      "Der CSV-Export von 2019 führt für DF-12040-DH einen Listenpreis von 1,08 EUR und zwei " +
      "Artikel, die es nicht mehr gibt. Autoritativ ist die laufende erp.sqlite.",
    sources: ["erp:export_2019", "erp:sqlite"],
    authoritative: "erp:sqlite",
  },
  {
    id: "inc:betriebsrat-protokolle-lesbar",
    kind: "acl-violation",
    summary:
      "Die Personalabteilung (GG_Personal) hat Leserechte auf die Betriebsratsprotokolle. " +
      "Laut Verzeichnis von Verarbeitungstätigkeiten (VT-07) dürfen ausschließlich " +
      "Betriebsratsmitglieder zugreifen.",
    sources: ["dok:br-protokoll", "dok:vvt"],
    authoritative: "dok:vvt",
  },
  {
    id: "inc:standzeit-w4471",
    kind: "no-authority",
    summary:
      `Werkzeugstammkarte und Wartungsprotokoll nennen unterschiedliche Standzeiten für ` +
      `${DISPUTED_TOOL_NO} (${deNumber(DISPUTED_TOOL_LIFE_MASTERCARD, 0)} vs. ` +
      `${deNumber(DISPUTED_TOOL_LIFE_MAINTENANCE, 0)} Hub). Keines der beiden Dokumente ist ` +
      "autoritativ; die Stammkarte unterliegt keiner Dokumentenlenkung.",
    sources: ["dok:stammkarte-w4471", "dok:wartung-w4471"],
    authoritative: null,
  },
  {
    /**
     * Nobody wrote these dangling rows. The mess injector renames files; the DocuWare index
     * still names them as they were captured. Counting them requires joining the exported
     * index against the actual filesystem — which is the whole exercise.
     */
    id: "inc:dms-index-verwaist",
    kind: "index-rot",
    summary:
      `Der DocuWare-Index verweist auf Dateien, die es unter diesem Pfad nicht mehr gibt. ` +
      `Seit dem Abbruch des Rollouts am ${DMS_ROLLOUT_STOPPED} wird nicht mehr nachgeführt. ` +
      "Wie viele Einträge ins Leere laufen, steht nirgends — es muss ausgezählt werden. " +
      "Autoritativ ist das Dateisystem, und das ist kein Dokument.",
    sources: ["dok:dms-index", "dok:dms-notiz"],
    authoritative: null,
  },
  {
    /**
     * Not an ACL problem: the folder permissions are fine. The company processes personal
     * data without the legal basis it documented for itself. Only the statute settles it.
     */
    id: "inc:bde-personenbezogen",
    kind: "unauthorized-processing",
    summary:
      `Ab ${BDE_PERSONAL_FROM} führt der BDE-Export die Spalten Personalnummer und ` +
      "Mitarbeiter. Die zugehörige Betriebsvereinbarung liegt seit Februar 2026 als Entwurf " +
      "vor, unterschrieben ist sie nicht. Der Betriebsrat hat am 19.05.2026 die Aussetzung " +
      "beschlossen; der Export des Folgemonats trägt die Spalten weiterhin. " +
      "Maßgeblich ist § 87 Abs. 1 Nr. 6 BetrVG.",
    sources: [
      "dok:bde-2026-04", "dok:bde-2026-06", "mail:0003", "dok:br-protokoll",
      "dok:fixture-betriebsvereinbarung-bde",
    ],
    authoritative: "dok:vendored-betrvg",
  },
  {
    /**
     * The IT-Leiter's "rund 1.400" is a row count from the retired Sage export, most of
     * whose articles have since been discontinued. It is stated in the mail without caveat,
     * because that is how people write. The PDM index is the only place the true number can
     * be obtained, and only by counting.
     */
    id: "inc:pdm-zeichnungsfeld",
    kind: "stale-version",
    summary:
      "mail:0004 beziffert die Artikel, bei denen eine Werkzeugnummer im Feld " +
      "Zeichnungsnummer steht, auf rund 1.400. Diese Zahl stammt aus dem abgelösten " +
      "Altsystem. Der aktuelle PDM-Index nennt eine deutlich kleinere Menge; er ist " +
      "autoritativ, und die Menge ergibt sich nur durch Auszählen.",
    sources: ["mail:0004", "dok:pdm-index"],
    authoritative: "dok:pdm-index",
  },
  {
    /**
     * The scanner writes into a folder every domain user may write to. One of the files it
     * wrote is a sick note. Its filename says "Scan_0003" and it has no text layer, so no
     * reader in this repo can see what it is — only the ACL report, via the manifest.
     */
    id: "inc:krankmeldung-im-scanordner",
    kind: "acl-violation",
    summary:
      "Im Ordner K:\\Scans, auf den \"Domänen-Benutzer\" Schreibrechte haben, liegt eine " +
      "eingescannte Arbeitsunfähigkeitsbescheinigung — Gesundheitsdaten nach Art. 9 DSGVO. " +
      "Laut Verzeichnis von Verarbeitungstätigkeiten ist dafür kein Zugriff dieser Gruppe " +
      "vorgesehen. Der Dateiname nennt den Inhalt nicht, und das PDF hat keine Textebene.",
    sources: ["dok:fixture-scan-au-bescheinigung", "dok:vvt", "mail:0007"],
    authoritative: "dok:vvt",
  },
];
