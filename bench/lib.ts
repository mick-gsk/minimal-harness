/**
 * Gemeinsamer A/B-Runner für die Experimente.
 *
 * Ein „Task" ist deterministisch prüfbar (World-State oder exakte Antwort) —
 * kein LLM-Judge. Jeder Task wird zweimal gefahren: OHNE Harness (roher
 * Modell-Aufruf, keine Werkzeuge) und MIT minimal-harness (Agent-Loop + Tools).
 */
import type { ToolDefinition } from "../src/types/tool.js";
import { OllamaClient } from "../src/llm/ollama-client.js";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";

export const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
export const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";

export const stripThink = (s: string): string => s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
export const onlyDigits = (s: string): string => s.replace(/[^\d]/g, "");

/** HH:MM in einer Zeitzone, ±2 min Toleranz gegen Laufzeitschwankung. */
export function timesHHMM(tz: string): string[] {
  const out: string[] = [];
  for (let d = -2; d <= 2; d++) {
    const s = new Date(Date.now() + d * 60_000).toLocaleString("sv-SE", { timeZone: tz });
    out.push(s.slice(11, 16));
  }
  return out;
}

export interface Task {
  id: string;
  category: string;
  title: string;
  prompt: string;
  tools: ToolDefinition[];
  check: (answer: string) => boolean;
  /** Optional: World-State vor jedem Lauf zurücksetzen (Tresor, Buchungen …). */
  reset?: () => void;
}

async function runNaive(task: Task): Promise<string> {
  const llm = new OllamaClient({ baseUrl: BASE_URL, model: MODEL });
  const res = await llm.generate([
    { role: "system", content: "Du bist ein hilfreicher Assistent. Antworte direkt und knapp." },
    { role: "user", content: task.prompt },
  ]);
  return res.content;
}

async function runHarness(task: Task): Promise<{ answer: string; toolsUsed: number }> {
  const llm = new OllamaClient({ baseUrl: BASE_URL, model: MODEL });
  const toolBridge = new DefaultToolBridge();
  for (const t of task.tools) toolBridge.register(t);
  const loop = new DefaultAgentLoop({
    llm,
    memory: new InMemoryMemory(),
    toolBridge,
    validator: new StructuredOutputValidator(),
    promptBuilder: new DefaultPromptBuilder(),
    systemInstruction:
      "Du bist ein hilfreicher Assistent mit Werkzeugen. Nutze sie, wenn nötig, " +
      "und antworte erst, wenn du das Ergebnis hast.",
    policy: { maxToolCallsPerTurn: 3, allowedTools: [], requireStructuredOutput: true },
  });
  const result = await loop.run({ sessionId: `t-${task.id}`, userMessage: task.prompt, maxTurns: 6 });
  return { answer: result.finalAnswer, toolsUsed: result.toolTrace.length };
}

// ── Faire Baseline: Ollamas eingebautes Tool-Calling in einem Standard-Loop ────
// Was ein Entwickler out-of-the-box baut: /api/chat mit `tools`, Tool-Ergebnisse
// zurückspielen, bis eine Antwort kommt. KEIN Retry, KEIN Text-Fallback, KEIN
// Validator — das ist der Unterschied zu minimal-harness.
interface NativeMsg {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
  tool_name?: string;
}

async function ollamaChat(messages: NativeMsg[], tools: unknown[]): Promise<NativeMsg> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = (await res.json()) as { message: NativeMsg };
  return data.message;
}

async function runOllamaNative(task: Task): Promise<{ answer: string; toolsUsed: number }> {
  const toolSpecs = task.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const byName = new Map(task.tools.map((t) => [t.name, t]));
  const messages: NativeMsg[] = [
    { role: "system", content: "Du bist ein hilfreicher Assistent mit Werkzeugen. Nutze sie, wenn nötig." },
    { role: "user", content: task.prompt },
  ];

  let toolsUsed = 0;
  for (let i = 0; i < 6; i++) {
    const msg = await ollamaChat(messages, toolSpecs);
    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return { answer: msg.content, toolsUsed };

    for (const call of calls) {
      const tool = byName.get(call.function.name);
      let args = call.function.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          /* Argument bleibt String */
        }
      }
      let result: unknown;
      if (!tool) result = { error: `unknown tool: ${call.function.name}` };
      else {
        try {
          result = await tool.execute(args);
        } catch (e) {
          result = { error: (e as Error).message };
        }
      }
      toolsUsed++;
      messages.push({ role: "tool", content: JSON.stringify(result), tool_name: call.function.name });
    }
  }
  return { answer: messages[messages.length - 1]?.content ?? "", toolsUsed };
}

const g = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const oneLine = (s: string, n = 76): string => stripThink(s).replace(/\s+/g, " ").trim().slice(0, n);

const verdict = (ok: boolean): string => (ok ? g("✓") : red("✗"));
const toolTag = (n: number): string => dim(`(${n} Tool${n === 1 ? "" : "s"})`);

export async function runExperiment(title: string, tasks: Task[]): Promise<void> {
  console.log(`\n╔══ ${title} ═══════════════════════════════╗`);
  console.log(`   Modell: ${MODEL}   Server: ${BASE_URL}`);
  console.log(`   Drei Kontrahenten, gleiches Modell, gleiche Aufgaben. Deterministisch geprüft.`);
  console.log(`   roh = kein Tool · nativ = Ollamas eingebautes Tool-Calling · minimal = unser Harness\n`);

  let rawPass = 0;
  let nativePass = 0;
  let harnessPass = 0;

  for (const task of tasks) {
    console.log(`\n── [${task.category}] ${task.title} ──`);
    console.log(dim(`   Frage: ${task.prompt}`));

    task.reset?.();
    const rawAns = await runNaive(task);
    const rawOk = task.check(rawAns);
    if (rawOk) rawPass++;
    console.log(`   roh:      ${verdict(rawOk)}  ${dim(`„${oneLine(rawAns)}"`)}`);

    task.reset?.();
    const nat = await runOllamaNative(task);
    const natOk = task.check(nat.answer);
    if (natOk) nativePass++;
    console.log(`   nativ:    ${verdict(natOk)}  ${toolTag(nat.toolsUsed)}  ${dim(`„${oneLine(nat.answer)}"`)}`);

    task.reset?.();
    const har = await runHarness(task);
    const harOk = task.check(har.answer);
    if (harOk) harnessPass++;
    console.log(`   minimal:  ${verdict(harOk)}  ${toolTag(har.toolsUsed)}  ${dim(`„${oneLine(har.answer)}"`)}`);
  }

  const n = tasks.length;
  const upVsNative = harnessPass - nativePass;
  const upVsRaw = harnessPass - rawPass;
  console.log(`\n╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`\n  ERGEBNIS auf ${MODEL}:`);
  console.log(`    roh (kein Tool):      ${rawPass}/${n}`);
  console.log(`    Ollama-nativ:         ${nativePass}/${n}`);
  console.log(`    minimal-harness:      ${harnessPass}/${n}`);
  console.log(`    → Uplift vs. Ollama-nativ (fair):   ${upVsNative >= 0 ? "+" : ""}${upVsNative}`);
  console.log(`    → Uplift vs. roh (illustrativ):     ${upVsRaw >= 0 ? "+" : ""}${upVsRaw}\n`);
}
