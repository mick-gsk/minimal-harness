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
  typ: "tribal" | "beantwortbar" | "widerspruch" | "unbeantwortbar";
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
