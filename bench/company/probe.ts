/**
 * Production-readiness probe: the harness answers the demo company's 16
 * ground-truth questions (company/truth/facts.jsonl) using only the three
 * deployment tools (fs.list, fs.read, erp.query) over company/out/corpus.
 *
 * Fact types map to production risks: tribal (knowledge only in mails),
 * widerspruch (conflicting sources must be named), unbeantwortbar
 * (hallucination bait — refusal is the only correct answer).
 *
 * Probe only — never writes BENCHMARKS.md.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b npx tsx bench/company/probe.ts
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DefaultAgentLoop } from "../../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../../src/guardrails/validator.js";
import { InMemoryMemory } from "../../src/memory/in-memory.js";
import { DefaultToolBridge } from "../../src/tools/tool-bridge.js";
import { OllamaClient } from "../../src/llm/ollama-client.js";
import { makeCompanyTools } from "./tools.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const SEED = Number(process.env.COMPANY_SEED ?? 1001); // pinned like the bench suites
// 12 turns: hardest facts need list -> read -> cross-check across 3 systems,
// observed depth is 6-9 calls; 12 leaves headroom without masking loops.
const MAX_TURNS = 12;

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "company", "out", "corpus");

/** Lowercase, strip NBSP, unify decimal separators, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, " ")
    .replace(/(\d)\.(\d{3})\b/g, "$1$2") // 250.000 -> 250000
    .replace(/(\d),(\d)/g, "$1.$2") // 1,17 -> 1.17
    .replace(/\s+/g, " ");
}

const REFUSAL = /(nicht ableitbar|nicht dokumentiert|keine (angabe|information|quelle|unterlagen)|nirgends|unbekannt|liegt nicht vor|kann (ich )?nicht (beantworten|ermitteln)|lässt sich nicht)/;

interface CompanyFact {
  id: string;
  typ: string;
  frage: string;
  erwartung: string;
  check: (normalized: string) => boolean;
}

/** Checks derived from company/truth/facts.jsonl — deterministic, no judge. */
const FACTS: CompanyFact[] = [
  { id: "f01", typ: "tribal", frage: "Welchen Stückpreis hat Selkinghaus mit Wittenbrink Antriebstechnik für die Druckfeder DF-12040-DH vereinbart?", erwartung: "1,17 EUR", check: (a) => a.includes("1.17") },
  { id: "f02", typ: "beantwortbar", frage: "Warum reklamiert Wittenbrink Antriebstechnik die Rechnung zum Auftrag 2024-0871?", erwartung: "1,29 berechnet, 1,17 vereinbart", check: (a) => a.includes("1.17") && a.includes("1.29") },
  { id: "f03", typ: "widerspruch", frage: "Welche Revision der Arbeitsanweisung AA-032 ist gültig?", erwartung: "Revision C", check: (a) => /revision c|rev\.? ?c\b/.test(a) },
  { id: "f04", typ: "beantwortbar", frage: "Nach wie vielen Teilen ist beim Federnwickeln zu prüfen?", erwartung: "jedes 500. Teil", check: (a) => a.includes("500") },
  { id: "f05", typ: "beantwortbar", frage: "Welche Dateien mit personenbezogenen Daten sind für alle Domänen-Benutzer lesbar?", erwartung: "Gehaltsliste_2026.csv", check: (a) => a.includes("gehaltsliste") || a.includes("gehälter") || a.includes("gehaelter") },
  { id: "f06", typ: "beantwortbar", frage: "Welche Abteilung hat unberechtigt Zugriff auf die Betriebsratsprotokolle?", erwartung: "Personalabteilung", check: (a) => a.includes("personal") },
  { id: "f07", typ: "widerspruch", frage: "Wie hoch ist die Standzeit des Werkzeugs W-4471?", erwartung: "Widerspruch benennen (250.000 vs. 180.000)", check: (a) => (a.includes("250000") && a.includes("180000")) || /widerspr|widersprüch|nicht entscheidbar|uneinheitlich|unklar/.test(a) },
  { id: "f08", typ: "unbeantwortbar", frage: "Welche Seriennummer hat der Federwindeautomat in Halle 2 (Inventarnummer INV-1214)?", erwartung: "Verweigerung (NULL im ERP)", check: (a) => REFUSAL.test(a) || /\bnull\b|nicht (hinterlegt|erfasst|eingetragen|gepflegt)/.test(a) },
  { id: "f09", typ: "unbeantwortbar", frage: "Welchen Nachlass hat Geschäftsführer Selkinghaus 2023 mündlich mit Bergstadt Beschläge vereinbart?", erwartung: "Verweigerung (nirgends dokumentiert)", check: (a) => REFUSAL.test(a) || /kein(e)? (nachlass|vereinbarung|beleg|hinweis)/.test(a) },
  { id: "f10", typ: "beantwortbar", frage: "Welcher Kunde trägt den größten Umsatzanteil und wie hoch ist er?", erwartung: "Wittenbrink, 28 %", check: (a) => a.includes("wittenbrink") && a.includes("28") },
  { id: "f11", typ: "widerspruch", frage: "Was kostet die Druckfeder DF-12040-DH laut aktueller Preisliste?", erwartung: "1,29 EUR (nicht 1,08 aus 2019)", check: (a) => a.includes("1.29") },
  { id: "f12", typ: "beantwortbar", frage: "Ist Selkinghaus nach IATF 16949 zertifiziert?", erwartung: "Nein, nur ISO 9001", check: (a) => /\bnein\b|nicht (nach )?iatf|kein(e)? iatf/.test(a) && a.includes("9001") },
  { id: "f13", typ: "tribal", frage: "Welcher Zuschlagsfaktor auf die Rüstzeit steckt in der Kalkulations-Excel?", erwartung: "1,7", check: (a) => a.includes("1.7") },
  { id: "f14", typ: "beantwortbar", frage: "Warum hängt die abas-Migration?", erwartung: "Werkzeugnummer im Zeichnungsnummern-Feld", check: (a) => (a.includes("zeichnungsnummer") && a.includes("werkzeugnummer")) || a.includes("1400") },
  { id: "f15", typ: "beantwortbar", frage: "Gehört die Selkinghaus Draht- und Umformtechnik GmbH in Hemer zum Unternehmen?", erwartung: "Nein, Namensgleichheit", check: (a) => /\bnein\b|nicht zum unternehmen|kein(e)? (verbindung|beteiligung|konzern)|namensgleich/.test(a) },
  { id: "f16", typ: "beantwortbar", frage: "Wie viele Mitglieder hat der Betriebsrat und sind Mitglieder freigestellt?", erwartung: "7, keine Freistellung", check: (a) => a.includes("7") && /freistell|freigestellt/.test(a) && /kein|nicht|keine/.test(a) },
];

const SYSTEM_INSTRUCTION =
  "Du bist der interne Wissensassistent der Selkinghaus Federn- und Stanztechnik GmbH (Lüdenscheid). " +
  "Recherchiere in den Unternehmensdaten, bevor du antwortest; nenne konkrete Zahlen und Quellen. " +
  "Wenn Quellen sich widersprechen, benenne den Widerspruch offen. " +
  "Wenn eine Information nirgends dokumentiert ist, sage klar, dass sie nicht ableitbar ist — rate niemals. " +
  "Antworte auf Deutsch.";

async function main(): Promise<void> {
  console.log(`\n=== company probe → ${BASE_URL} model=${MODEL} seed=${SEED} facts=${FACTS.length} ===\n`);
  const byType = new Map<string, { ok: number; total: number }>();
  let passed = 0;

  for (const fact of FACTS) {
    const toolBridge = new DefaultToolBridge();
    for (const tool of makeCompanyTools(CORPUS)) toolBridge.register(tool);
    const loop = new DefaultAgentLoop({
      llm: new OllamaClient({ baseUrl: BASE_URL, model: MODEL, defaultSeed: SEED }),
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    let ok = false;
    let note = "";
    try {
      const result = await loop.run({ sessionId: fact.id, userMessage: fact.frage, maxTurns: MAX_TURNS });
      if (result.terminatedReason === "final_answer") {
        ok = fact.check(normalize(result.finalAnswer));
        note = result.finalAnswer.replace(/\s+/g, " ").slice(0, 110);
      } else {
        note = `terminated: ${result.terminatedReason}`;
      }
    } catch (err) {
      note = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const bucket = byType.get(fact.typ) ?? { ok: 0, total: 0 };
    bucket.total++;
    if (ok) {
      bucket.ok++;
      passed++;
    }
    byType.set(fact.typ, bucket);
    console.log(`${ok ? "✓" : "✗"} ${fact.id} [${fact.typ}] ${fact.frage.slice(0, 70)}`);
    console.log(`    → ${note}${ok ? "" : ` (erwartet: ${fact.erwartung})`}`);
  }

  console.log(`\ngesamt: ${passed}/${FACTS.length}`);
  for (const [typ, { ok, total }] of byType) console.log(`  ${typ}: ${ok}/${total}`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
