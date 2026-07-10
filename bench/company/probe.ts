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
import { appendFileSync } from "node:fs";
import type { ChatMessage } from "../../src/index.js";
import { DefaultAgentLoop } from "../../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../../src/guardrails/validator.js";
import { InMemoryMemory } from "../../src/memory/in-memory.js";
import { DefaultToolBridge } from "../../src/tools/tool-bridge.js";
import { OllamaClient } from "../../src/llm/ollama-client.js";
import { runSidecar, smolagentsAvailable } from "../harnesses/smolagents.js";
import { startWorldBridge } from "../bridge/world-http-bridge.js";
import { makeCompanyTools } from "./tools.js";
import { FACTS, normalize, type CompanyFact } from "./facts.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
// Pinned like the bench suites; 3 seeds because single research runs proved
// noisy (same fact flips between runs at temperature 0.7).
const SEEDS = (process.env.COMPANY_SEEDS ?? "1001,1002,1003").split(",").map(Number);
// Production config under test: near-greedy sampling for factual research,
// extended thinking for multi-step planning (qwen3), 16k context.
const TEMPERATURE = 0.1;
const THINK = process.env.COMPANY_THINK !== "0";
// 12 turns: hardest facts need list -> read -> cross-check across 3 systems,
// observed depth is 6-9 calls; 12 leaves headroom without masking loops.
const MAX_TURNS = 12;
// "minimal" = the harness under test (text protocol); "minimal@nt" = the
// harness in nativeToolCalling mode (same loop/memory/policy, tool specs via
// API — the right config for models trained on function calling, e.g. llama);
// "native" = the fair competitor baseline (straight Ollama function calling,
// no retries/recovery — mirrors bench/harnesses/ollama-native.ts but with the
// same deployment prompt); smolagents-* = Hugging Face's library, off-the-shelf.
const HARNESS = process.env.COMPANY_HARNESS ?? "minimal";

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "company", "out", "corpus");

// A real deployment tells its assistant which systems exist — that is
// configuration, not answer-leaking. Nothing here names a fact or a file
// that answers a question.
const SYSTEM_INSTRUCTION =
  "Du bist der interne Wissensassistent der Selkinghaus Federn- und Stanztechnik GmbH (Lüdenscheid). " +
  "Dir stehen vier Datenquellen zur Verfügung: der Fileserver (Ordner 'fileserver/', per fs.list erkunden und fs.read lesen), " +
  "das E-Mail-Archiv (Ordner 'mail/'), die Active-Directory-Exporte (Ordner 'ad/': users.csv, groups.csv, acls.csv) " +
  "und das ERP (per erp.query, SQL). Mit fs.search durchsuchst du alle Dateien und Mails im Volltext nach Stichwörtern. " +
  "Recherchiere gründlich und systematisch: suche zuerst per fs.search nach den Stichwörtern der Frage, lies relevante Dokumente und Mails vollständig, " +
  "und prüfe bei Zahlen auch das ERP. Nenne konkrete Zahlen und Quellen. " +
  "Wenn Quellen sich widersprechen, benenne den Widerspruch offen. " +
  "Wenn eine Information nirgends dokumentiert ist, sage klar, dass sie nicht ableitbar ist — rate niemals. " +
  "Antworte auf Deutsch.";

/**
 * Competitor baseline: what a developer writes out of the box against
 * Ollama's native tool calling. Same model config, same deployment prompt,
 * same tools, same turn budget — no protocol, no retries, no recovery.
 */
async function runFactNative(fact: CompanyFact, seed: number): Promise<FactRunResult> {
  const tools = makeCompanyTools(CORPUS);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const llm = new OllamaClient({
    baseUrl: BASE_URL,
    model: MODEL,
    defaultSeed: seed,
    defaultTemperature: TEMPERATURE,
    think: THINK,
    numCtx: 16384,
  });
  const toolSpecs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as unknown as Record<string, unknown>,
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    { role: "user", content: fact.frage },
  ];
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await llm.generate(messages, { tools: toolSpecs });
      if (res.toolCalls && res.toolCalls.length > 0) {
        messages.push({ role: "assistant", content: res.content });
        for (const call of res.toolCalls) {
          const tool = byName.get(call.name);
          let payload: string;
          if (!tool) {
            payload = JSON.stringify({ tool: call.name, error: "unknown tool" });
          } else {
            try {
              payload = JSON.stringify({ tool: call.name, result: await tool.execute(call.arguments) });
            } catch (err) {
              payload = JSON.stringify({ tool: call.name, error: err instanceof Error ? err.message : String(err) });
            }
          }
          messages.push({ role: "tool", content: payload });
        }
        continue;
      }
      return { ok: fact.check(normalize(res.content)), note: res.content.replace(/\s+/g, " ").slice(0, 110), answer: res.content };
    }
    return { ok: false, note: "terminated: max_turns" };
  } catch (err) {
    return { ok: false, note: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Competitor: Hugging Face smolagents, off-the-shelf. It keeps its own system
 * scaffold (that IS the rival harness), so the deployment context travels in
 * the task prompt — exactly how a smolagents user deploys it. Same tools via
 * the HTTP bridge, same turn budget, same model over Ollama's /v1.
 */
async function runFactSmolagents(fact: CompanyFact, seed: number, agentType: "tool" | "code"): Promise<FactRunResult> {
  const tools = makeCompanyTools(CORPUS);
  const bridge = await startWorldBridge(tools);
  try {
    const job = {
      prompt: `${SYSTEM_INSTRUCTION}\n\nFrage: ${fact.frage}`,
      maxSteps: MAX_TURNS,
      bridgeUrl: bridge.url,
      agentType,
      model: {
        id: MODEL,
        apiBase: `${BASE_URL.replace(/\/$/, "")}/v1`,
        apiKey: "ollama",
        temperature: TEMPERATURE,
        seed,
      },
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    };
    const res = await runSidecar(JSON.stringify(job), MAX_TURNS);
    if (res.error) return { ok: false, note: `error: ${res.error.slice(0, 100)}` };
    if (res.finalAnswer === null) return { ok: false, note: `terminated: ${res.terminatedReason}` };
    return { ok: fact.check(normalize(res.finalAnswer)), note: res.finalAnswer.replace(/\s+/g, " ").slice(0, 110), answer: res.finalAnswer };
  } finally {
    await bridge.close();
  }
}

interface FactRunResult {
  ok: boolean;
  note: string;
  /** Full final answer when one was produced — persisted to results.jsonl. */
  answer?: string;
  /** Last raw assistant output on abnormal termination — the diagnosis evidence. */
  raw?: string;
}

async function runFact(fact: CompanyFact, seed: number): Promise<FactRunResult> {
  if (HARNESS === "native") return runFactNative(fact, seed);
  if (HARNESS === "smolagents-tool") return runFactSmolagents(fact, seed, "tool");
  if (HARNESS === "smolagents-code") return runFactSmolagents(fact, seed, "code");
  const toolBridge = new DefaultToolBridge();
  for (const tool of makeCompanyTools(CORPUS)) toolBridge.register(tool);
  const loop = new DefaultAgentLoop({
    // 16k context: 12 research turns with file reads overflow the 8k server
    // default, which silently evicts the system prompt (observed as protocol
    // drift and "forgotten" findings late in runs).
    llm: new OllamaClient({
      baseUrl: BASE_URL,
      model: MODEL,
      defaultSeed: seed,
      defaultTemperature: TEMPERATURE,
      think: THINK,
      numCtx: 16384,
    }),
    memory: new InMemoryMemory(),
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
    systemInstruction: SYSTEM_INSTRUCTION,
    ...(HARNESS === "minimal@nt" ? { nativeToolCalling: true } : {}),
    // Research config: up to 4 tool calls per turn, executed in parallel.
    // 4 because tool results land in context: 4 reads x ~1.5k tokens ≈ 6k
    // per turn still fits the 16k window with memory folding; smolagents'
    // CodeAgent wins exactly by batching lookups — this is the same lever.
    ...(HARNESS === "minimal@nt4"
      ? {
          nativeToolCalling: true,
          parallelToolCalls: true,
          policy: { maxToolCallsPerTurn: 4, allowedTools: [], requireStructuredOutput: true },
        }
      : {}),
  });

  try {
    const result = await loop.run({ sessionId: `${fact.id}-${seed}`, userMessage: fact.frage, maxTurns: MAX_TURNS });
    if (result.terminatedReason !== "final_answer") {
      return {
        ok: false,
        note: `terminated: ${result.terminatedReason}`,
        raw: result.rawTurns.at(-1)?.rawAssistantOutput?.slice(0, 2000),
      };
    }
    return {
      ok: fact.check(normalize(result.finalAnswer)),
      note: result.finalAnswer.replace(/\s+/g, " ").slice(0, 110),
      answer: result.finalAnswer,
    };
  } catch (err) {
    return { ok: false, note: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main(): Promise<void> {
  if (HARNESS.startsWith("smolagents") && !smolagentsAvailable()) {
    throw new Error("smolagents sidecar missing — see bench/smolagents/README");
  }
  console.log(
    `\n=== company probe → ${BASE_URL} model=${MODEL} harness=${HARNESS} seeds=${SEEDS.join(",")} temp=${TEMPERATURE} think=${THINK} facts=${FACTS.length} ===\n`,
  );
  const byType = new Map<string, { ok: number; total: number }>();
  const perSeed = new Map<number, number>();
  let passed = 0;

  // Smoke filter, e.g. COMPANY_FACTS=f01,f13 — full runs leave it unset.
  const only = process.env.COMPANY_FACTS?.split(",");
  const facts = only ? FACTS.filter((f) => only.includes(f.id)) : FACTS;

  // Full answers as JSONL so failures can be analyzed (and checks recalibrated)
  // offline without re-burning GPU hours. 110-char console notes are not evidence.
  const resultLog = process.env.COMPANY_LOG ?? join(dirname(fileURLToPath(import.meta.url)), "results.jsonl");

  for (const fact of facts) {
    const marks: string[] = [];
    let lastFailNote = "";
    for (const seed of SEEDS) {
      const { ok, note, answer, raw } = await runFact(fact, seed);
      appendFileSync(
        resultLog,
        JSON.stringify({ ts: new Date().toISOString(), model: MODEL, harness: HARNESS, think: THINK, seed, factId: fact.id, typ: fact.typ, ok, note: answer === undefined ? note : undefined, answer, raw }) + "\n",
      );
      marks.push(ok ? "✓" : "✗");
      if (ok) {
        passed++;
        perSeed.set(seed, (perSeed.get(seed) ?? 0) + 1);
      } else {
        lastFailNote = note;
      }
      const bucket = byType.get(fact.typ) ?? { ok: 0, total: 0 };
      bucket.total++;
      if (ok) bucket.ok++;
      byType.set(fact.typ, bucket);
    }
    console.log(`${marks.join("")} ${fact.id} [${fact.typ}] ${fact.frage.slice(0, 70)}`);
    if (lastFailNote) console.log(`    ✗→ ${lastFailNote} (erwartet: ${fact.erwartung})`);
  }

  const total = facts.length * SEEDS.length;
  console.log(`\ngesamt: ${passed}/${total} (${((100 * passed) / total).toFixed(0)}%)`);
  for (const [seed, n] of perSeed) console.log(`  seed ${seed}: ${n}/${facts.length}`);
  for (const [typ, { ok, total: t }] of byType) console.log(`  ${typ}: ${ok}/${t}`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
