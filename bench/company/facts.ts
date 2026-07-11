/**
 * Ground-truth checks for the company probe — deterministic, no judge.
 * Derived from company/truth/facts.jsonl. Shared by probe.ts (live scoring)
 * and rescore.ts (offline re-scoring of results.jsonl), so check calibration
 * never costs GPU hours again.
 */

/** Lowercase, strip NBSP, unify decimal separators, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/(\d)\.(\d{3})\b/g, "$1$2") // 250.000 -> 250000
    .replace(/(\d),(\d)/g, "$1.$2") // 1,17 -> 1.17
    .replace(/\s+/g, " ");
}

/**
 * German refusal phrasings. Calibrated against logged full answers
 * (results.jsonl): models refuse with "nicht abrufbar", "nicht ersichtlich",
 * "keine Dokumente", "nicht direkt zu finden" — all unambiguous refusals that
 * the first version missed (false negatives on every arm equally).
 */
export const REFUSAL =
  /(nicht ableitbar|nicht .{0,45}?(gefunden|zu finden|auffindbar|abrufbar|ersichtlich|enthalten|erfasst|hinterlegt|eingetragen|gepflegt|vorhanden|verfügbar|angegeben|dokumentiert)|keine .{0,30}?(angabe|information|quelle|unterlagen|dokumente|daten|hinweise)|nirgends|unbekannt|liegt nicht vor|kann (ich )?nicht (beantworten|ermitteln)|lässt sich nicht|konnte .{0,40}nicht)/;

export interface CompanyFact {
  id: string;
  typ: "tribal" | "beantwortbar" | "widerspruch" | "unbeantwortbar" | "systemuebergreifend" | "nur-binaer";
  frage: string;
  erwartung: string;
  check: (normalized: string) => boolean;
}

export const FACTS: CompanyFact[] = [
  { id: "f01", typ: "tribal", frage: "Welchen Stückpreis hat Selkinghaus mit Wittenbrink Antriebstechnik für die Druckfeder DF-12040-DH vereinbart?", erwartung: "1,17 EUR", check: (a) => a.includes("1.17") },
  { id: "f02", typ: "beantwortbar", frage: "Warum reklamiert Wittenbrink Antriebstechnik die Rechnung zum Auftrag 2024-0871?", erwartung: "1,29 berechnet, 1,17 vereinbart", check: (a) => a.includes("1.17") && a.includes("1.29") },
  { id: "f03", typ: "widerspruch", frage: "Welche Revision der Arbeitsanweisung AA-032 ist gültig?", erwartung: "Revision C", check: (a) => /revision c|rev\.? ?c\b/.test(a) },
  { id: "f04", typ: "beantwortbar", frage: "Nach wie vielen Teilen ist beim Federnwickeln zu prüfen?", erwartung: "jedes 500. Teil", check: (a) => a.includes("500") },
  { id: "f05", typ: "beantwortbar", frage: "Welche Dateien mit personenbezogenen Daten sind für alle Domänen-Benutzer lesbar?", erwartung: "Gehaltsliste_2026.csv", check: (a) => a.includes("gehaltsliste") || a.includes("gehälter") || a.includes("gehaelter") },
  { id: "f06", typ: "beantwortbar", frage: "Welche Abteilung hat unberechtigt Zugriff auf die Betriebsratsprotokolle?", erwartung: "Personalabteilung", check: (a) => a.includes("personal") },
  { id: "f07", typ: "widerspruch", frage: "Wie hoch ist die Standzeit des Werkzeugs W-4471?", erwartung: "Widerspruch benennen (250.000 vs. 180.000)", check: (a) => (a.includes("250000") && a.includes("180000")) || /widerspr|widersprüch|nicht entscheidbar|uneinheitlich|unklar/.test(a) },
  { id: "f08", typ: "unbeantwortbar", frage: "Welche Seriennummer hat der Federwindeautomat in Halle 2 (Inventarnummer INV-1214)?", erwartung: "Verweigerung (NULL im ERP)", check: (a) => REFUSAL.test(a) || /\bnull\b/.test(a) },
  { id: "f09", typ: "unbeantwortbar", frage: "Welchen Nachlass hat Geschäftsführer Selkinghaus 2023 mündlich mit Bergstadt Beschläge vereinbart?", erwartung: "Verweigerung (nirgends dokumentiert)", check: (a) => REFUSAL.test(a) || /kein(e)? (nachlass|vereinbarung|beleg|hinweis)/.test(a) },
  { id: "f10", typ: "beantwortbar", frage: "Welcher Kunde trägt den größten Umsatzanteil und wie hoch ist er?", erwartung: "Wittenbrink, 28 %", check: (a) => a.includes("wittenbrink") && a.includes("28") },
  { id: "f11", typ: "widerspruch", frage: "Was kostet die Druckfeder DF-12040-DH laut aktueller Preisliste?", erwartung: "1,29 EUR (nicht 1,08 aus 2019)", check: (a) => a.includes("1.29") },
  { id: "f12", typ: "beantwortbar", frage: "Ist Selkinghaus nach IATF 16949 zertifiziert?", erwartung: "Nein (nur ISO 9001)", check: (a) => /\bnein\b|nicht (nach iatf|zertifiziert)|kein(e)? iatf/.test(a) },
  { id: "f13", typ: "tribal", frage: "Welcher Zuschlagsfaktor auf die Rüstzeit steckt in der Kalkulations-Excel?", erwartung: "1,7", check: (a) => a.includes("1.7") },
  { id: "f14", typ: "beantwortbar", frage: "Warum hängt die abas-Migration?", erwartung: "Werkzeugnummer im Zeichnungsnummern-Feld", check: (a) => (a.includes("zeichnungsnummer") && a.includes("werkzeugnummer")) || a.includes("1400") },
  { id: "f15", typ: "beantwortbar", frage: "Gehört die Selkinghaus Draht- und Umformtechnik GmbH in Hemer zum Unternehmen?", erwartung: "Nein, Namensgleichheit", check: (a) => /\bnein\b|gehört nicht|nicht (direkt )?zum unternehmen|kein(e)? (verbindung|beteiligung|konzern)|namensgleich/.test(a) },
  { id: "f16", typ: "beantwortbar", frage: "Wie viele Mitglieder hat der Betriebsrat und sind Mitglieder freigestellt?", erwartung: "7, keine Freistellung", check: (a) => a.includes("7") && /freistell|freigestellt/.test(a) && /kein|nicht|keine/.test(a) },
];

/**
 * Cross-system questions (company/truth/system-facts.jsonl): joins and
 * aggregations across DMS index, BDE exports, DATEV batch and ERP — the
 * work a Sachbearbeiter does with two windows open.
 */
export const SYSTEM_FACTS: CompanyFact[] = [
  { id: "s01", typ: "systemuebergreifend", frage: "Wie viele Einträge des DocuWare-Index verweisen auf eine Datei, die es unter diesem Pfad nicht mehr gibt?", erwartung: "88", check: (a) => /\b88\b/.test(a) },
  { id: "s02", typ: "systemuebergreifend", frage: "Welchen Anteil des Fileservers hat DocuWare überhaupt erfasst, und warum hört die Erfassung auf?", erwartung: "558 von 1896 (29,4 %), nur Vertrieb/QM, Phase 2 nie beauftragt", check: (a) => /\b558\b/.test(a) && (/\b1896\b/.test(a) || /29[.]4/.test(a) || /phase 2|nie beauftragt|vertrieb und qm/.test(a)) },
  { id: "s03", typ: "systemuebergreifend", frage: "Ab welchem Monat enthält der BDE-Export personenbezogene Spalten, und wurde die Auswertung nach dem Betriebsrats-Einspruch gestoppt?", erwartung: "Ab 2026-04; nein, läuft weiter", check: (a) => /2026-04|april 2026/.test(a) && /nein|weiterhin|nicht gestoppt|trotz|unverändert/.test(a) },
  { id: "s04", typ: "systemuebergreifend", frage: "Bei wie vielen Artikeln steht im PDM eine Werkzeugnummer im Feld Zeichnungsnummer?", erwartung: "172 (nicht die ~1.400 aus der Mail)", check: (a) => /\b172\b/.test(a) },
  { id: "s05", typ: "systemuebergreifend", frage: "Stimmt die Zahl der Buchungen im DATEV-Stapel 2025 mit den Rechnungen im ERP überein?", erwartung: "Ja, 387 = 387", check: (a) => /\b387\b/.test(a) && /\bja\b|stimmt|überein|gleich|identisch|deckungs/.test(a) },
  { id: "s06", typ: "unbeantwortbar", frage: "Welche Datei im Ordner K:\\Scans enthält Gesundheitsdaten?", erwartung: "Verweigerung (Scans sind Binär-Platzhalter, kein OCR)", check: (a) => REFUSAL.test(a) },
];

/**
 * Binary-only questions (company/truth/binary-facts.jsonl): the answer exists
 * exclusively inside xlsx/docx/pdf files — unreachable without office
 * extraction, which is where German SME knowledge actually lives.
 */
export const BINARY_FACTS: CompanyFact[] = [
  { id: "b01", typ: "nur-binaer", frage: "Auf welchem Blatt der Kalkulations-Excel steht der Zuschlagsfaktor auf die Rüstzeit, und ist dieses Blatt sichtbar?", erwartung: "Blatt 'Zuschlag', ausgeblendet", check: (a) => /zuschlag/.test(a) && /ausgeblendet|versteckt|verborgen|hidden|nicht sichtbar/.test(a) },
  { id: "b02", typ: "nur-binaer", frage: "Welche Prüfmittel sind überfällig kalibriert?", erwartung: "PM-004 und PM-011", check: (a) => a.includes("pm-004") && a.includes("pm-011") },
  { id: "b03", typ: "nur-binaer", frage: "Welche Kontaktkraft fordert das Lastenheft der Wittenbrink Antriebstechnik bei Nennhub?", erwartung: "2,4 N ± 0,3 N", check: (a) => a.includes("2.4") && a.includes("0.3") },
  { id: "b04", typ: "nur-binaer", frage: "Wie lautet die Zertifikatsregister-Nummer der ISO-9001-Zertifizierung und bis wann gilt sie?", erwartung: "20-QMS-4417, bis 31.08.2028", check: (a) => a.includes("20-qms-4417") && a.includes("2028") },
  { id: "b05", typ: "nur-binaer", frage: "Welche Toleranz hat der Drahtdurchmesser der Druckfeder DF-12040-DH laut Zeichnung?", erwartung: "1,25 mm ± 0,02 mm", check: (a) => a.includes("1.25") && a.includes("0.02") },
  { id: "b06", typ: "nur-binaer", frage: "Ist die Betriebsvereinbarung zur BDE unterschrieben?", erwartung: "Nein, Entwurf ohne Unterschriften", check: (a) => /\bnein\b|nicht unterschrieben|entwurf|unterschriftsfelder (sind )?leer|keine unterschrift/.test(a) },
  { id: "b07", typ: "nur-binaer", frage: "Warum fehlt die Seriennummer der Maschine INV-1214?", erwartung: "Typenschild überstrichen, nie ermittelt", check: (a) => /typenschild/.test(a) && /überstrichen|übermalt|überlackiert|nicht (mehr )?lesbar/.test(a) },
  { id: "b08", typ: "nur-binaer", frage: "Welchen Basispreis je Tonne nennt der Rahmenliefervertrag mit der Rehwinkel GmbH?", erwartung: "1.480,00 EUR/t", check: (a) => /\b1480\b/.test(a) },
];
