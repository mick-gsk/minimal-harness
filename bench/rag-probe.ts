/**
 * RAG probe: retrieval quality of the local knowledge base with real
 * nomic-embed-text embeddings — hit@1 and hit@3 over queries whose target
 * document is known.
 *
 * Probe only — never writes BENCHMARKS.md.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 npx tsx bench/rag-probe.ts
 */
import { OllamaEmbedder } from "../src/rag/embedder.js";
import { SqliteKnowledgeStore } from "../src/rag/knowledge-store.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

/** A small fictional company knowledge base, one chunk per policy. */
const DOCS: Array<{ source: string; text: string }> = [
  { source: "hr/urlaub", text: "Urlaubsanträge müssen mindestens zwei Wochen im Voraus über das Personalportal eingereicht und vom Teamleiter genehmigt werden." },
  { source: "hr/krankmeldung", text: "Im Krankheitsfall ist bis 9 Uhr telefonisch zu informieren; ab dem dritten Tag ist eine Arbeitsunfähigkeitsbescheinigung vorzulegen." },
  { source: "finanzen/rechnungen", text: "Eingangsrechnungen werden binnen 14 Tagen netto beglichen. Skonto von 2 Prozent wird bei Zahlung innerhalb von 7 Tagen gezogen." },
  { source: "finanzen/spesen", text: "Reisekosten werden gegen Beleg erstattet; die Kilometerpauschale beträgt 0,30 Euro, Übernachtungen bis 120 Euro pro Nacht." },
  { source: "it/passwoerter", text: "Passwörter müssen mindestens 14 Zeichen lang sein und werden über den zentralen Passwortmanager verwaltet, niemals per E-Mail geteilt." },
  { source: "it/backup", text: "Server-Backups laufen täglich um 2 Uhr nachts; die Wiederherstellung eines Backups beantragt man per Ticket an die IT." },
  { source: "vertrieb/angebote", text: "Angebote sind 30 Tage gültig und benötigen ab einem Volumen von 25.000 Euro die Freigabe der Vertriebsleitung." },
  { source: "produktion/wartung", text: "Die CNC-Fräsen werden quartalsweise gewartet; Störungen werden über das Instandhaltungsboard gemeldet." },
];

const QUERIES: Array<{ query: string; expected: string }> = [
  { query: "Wie lange vorher muss ich Urlaub einreichen?", expected: "hr/urlaub" },
  { query: "Ab wann brauche ich eine Krankschreibung vom Arzt?", expected: "hr/krankmeldung" },
  { query: "Wie viel Skonto ziehen wir bei schneller Zahlung?", expected: "finanzen/rechnungen" },
  { query: "Was kostet ein Hotel maximal auf Dienstreise?", expected: "finanzen/spesen" },
  { query: "Wie stelle ich ein Backup wieder her?", expected: "it/backup" },
];

async function main(): Promise<void> {
  console.log(`\n=== RAG probe → ${BASE_URL} embed=${EMBED_MODEL} docs=${DOCS.length} queries=${QUERIES.length} ===\n`);
  const store = new SqliteKnowledgeStore(":memory:", new OllamaEmbedder({ baseUrl: BASE_URL, model: EMBED_MODEL }));
  for (const doc of DOCS) await store.add(doc.source, [doc.text]);

  let hit1 = 0;
  let hit3 = 0;
  for (const { query, expected } of QUERIES) {
    const hits = await store.search(query, 3);
    const rank = hits.findIndex((h) => h.source === expected);
    if (rank === 0) hit1++;
    if (rank >= 0) hit3++;
    console.log(`${rank === 0 ? "✓" : rank >= 0 ? "~" : "✗"} [top: ${hits[0]?.source} @ ${hits[0]?.score.toFixed(3)}] ${query}`);
  }
  store.close();

  console.log(`\nhit@1: ${hit1}/${QUERIES.length} · hit@3: ${hit3}/${QUERIES.length}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
