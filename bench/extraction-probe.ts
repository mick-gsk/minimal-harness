/**
 * Extraction probe: field accuracy of structured extraction WITH the
 * responseSchema contract (prompt contract + validation + corrective retry)
 * versus a plain "answer as JSON" prompt wish — same documents, same seeds.
 *
 * Probe only — never writes BENCHMARKS.md.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=llama3.1 npx tsx bench/extraction-probe.ts
 */
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { OllamaClient } from "../src/llm/ollama-client.js";
import { safeParseJson } from "../src/utils/json.js";
import type { ToolInputSchema } from "../src/types/tool.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";
const SEEDS = [1001, 1002, 1003, 1004, 1005]; // pinned like the bench suites

const schema: ToolInputSchema = {
  type: "object",
  properties: {
    documentType: { type: "string" }, // "invoice" | "order"
    number: { type: "string" },
    total: { type: "number" }, // gross total in EUR
    dueDate: { type: "string" }, // ISO date or ""
  },
  required: ["documentType", "number", "total", "dueDate"],
  additionalProperties: false,
};

interface Doc {
  text: string;
  truth: { documentType: string; number: string; total: number; dueDate: string };
}

/** Five German back-office documents, deliberately messy like real inboxes. */
const DOCS: Doc[] = [
  {
    text:
      "Rechnung Nr. RE-2026-0142 vom 02.07.2026\nMüller Maschinenbau GmbH\n" +
      "Positionen: Wartung CNC-Fräse 1.250,00 EUR netto, Anfahrt 80,00 EUR netto\n" +
      "Gesamtbetrag brutto: 1.582,70 EUR. Zahlbar bis zum 01.08.2026 ohne Abzug.",
    truth: { documentType: "invoice", number: "RE-2026-0142", total: 1582.7, dueDate: "2026-08-01" },
  },
  {
    text:
      "Bestellung B-77812\nSehr geehrte Damen und Herren, hiermit bestellen wir 40 Stück " +
      "Hydraulikventile Typ HV-3 zum Stückpreis von 89,90 EUR netto. " +
      "Gesamtwert brutto 4.279,64 EUR. Lieferung bitte bis 15.07.2026.",
    truth: { documentType: "order", number: "B-77812", total: 4279.64, dueDate: "2026-07-15" },
  },
  {
    text:
      "RECHNUNG 2026/0987 — Kanzlei Weber & Partner\nBeratungsleistungen Juni: 3 Std. à 220 EUR.\n" +
      "Rechnungsbetrag inkl. 19% USt: 785,40 EUR\nZahlungsziel: 14 Tage netto (bis 24.07.2026).",
    truth: { documentType: "invoice", number: "2026/0987", total: 785.4, dueDate: "2026-07-24" },
  },
  {
    text:
      "Auftragsbestätigung/Bestellung Nr. PO-55103. Wir ordern: 12x Serverschrank-Kühlung SK-2000. " +
      "In der vorherigen Mail stand fälschlich 14.820,16 — korrekt sind 14.280,16 EUR brutto. Wunschtermin 30.09.2026.",
    truth: { documentType: "order", number: "PO-55103", total: 14280.16, dueDate: "2026-09-30" },
  },
  {
    text:
      "Rechnung R-11-2026 (Hosting Q3). Betrag: 238,00 € brutto. " +
      "Bitte überweisen Sie bis spätestens 10.08.2026 auf das bekannte Konto.",
    truth: { documentType: "invoice", number: "R-11-2026", total: 238.0, dueDate: "2026-08-10" },
  },
];

const INSTRUCTION =
  "You are a back-office extraction assistant. Extract the requested fields from the document. " +
  "documentType is 'invoice' or 'order'; total is the gross amount in EUR as a number; " +
  "dueDate is the payment/delivery deadline as ISO date (YYYY-MM-DD).";

function makeLoop(seed: number) {
  return new DefaultAgentLoop({
    llm: new OllamaClient({ baseUrl: BASE_URL, model: MODEL, defaultSeed: seed }),
    memory: new InMemoryMemory(),
    toolBridge: new DefaultToolBridge(),
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
    systemInstruction: INSTRUCTION,
  });
}

function scoreFields(candidate: unknown, truth: Doc["truth"]): number {
  if (typeof candidate !== "object" || candidate === null) return 0;
  const c = candidate as Record<string, unknown>;
  let correct = 0;
  if (typeof c.documentType === "string" && c.documentType.trim().toLowerCase() === truth.documentType) correct++;
  if (typeof c.number === "string" && c.number.trim() === truth.number) correct++;
  if (typeof c.total === "number" && Math.abs(c.total - truth.total) < 0.01) correct++;
  if (typeof c.dueDate === "string" && c.dueDate.trim() === truth.dueDate) correct++;
  return correct;
}

/** Best-effort JSON recovery for the plain arm — fence strip, then first {...} block. */
function parsePlain(answer: string): unknown {
  const unfenced = answer.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
  const direct = safeParseJson(unfenced);
  if (direct.ok) return direct.value;
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (match) {
    const embedded = safeParseJson(match[0]);
    if (embedded.ok) return embedded.value;
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`\n=== extraction probe → ${BASE_URL} model=${MODEL} docs=${DOCS.length} seeds=${SEEDS.length} ===\n`);
  const totals = { contract: 0, plain: 0, contractFails: 0, plainParseFails: 0 };
  const maxFields = DOCS.length * SEEDS.length * 4;

  for (const [d, doc] of DOCS.entries()) {
    for (const seed of SEEDS) {
      const contractRun = await makeLoop(seed).run({
        sessionId: `x-${d}-${seed}`,
        userMessage: doc.text,
        maxTurns: 3,
        responseSchema: schema,
      });
      if (contractRun.terminatedReason === "final_answer") {
        totals.contract += scoreFields(contractRun.structuredAnswer, doc.truth);
      } else {
        totals.contractFails++;
      }

      const plainRun = await makeLoop(seed).run({
        sessionId: `p-${d}-${seed}`,
        userMessage:
          `${doc.text}\n\nRespond ONLY with a JSON object with fields documentType, number, total, dueDate.`,
        maxTurns: 3,
      });
      const parsed = plainRun.terminatedReason === "final_answer" ? parsePlain(plainRun.finalAnswer) : null;
      if (parsed === null) totals.plainParseFails++;
      else totals.plain += scoreFields(parsed, doc.truth);
    }
    console.log(`doc ${d + 1}/${DOCS.length} done`);
  }

  const pct = (n: number) => `${((100 * n) / maxFields).toFixed(1)}%`;
  console.log(`\nfield accuracy — contract (responseSchema): ${totals.contract}/${maxFields} (${pct(totals.contract)})`);
  console.log(`field accuracy — plain JSON prompt:          ${totals.plain}/${maxFields} (${pct(totals.plain)})`);
  console.log(`non-conforming runs — contract: ${totals.contractFails} · plain unparseable: ${totals.plainParseFails}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
