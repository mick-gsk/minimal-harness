/**
 * A/B-Experiment mit den eingebauten Basis-Werkzeugen (Uhr, Rechner) plus einem
 * kleinen Tresor-Tool. Deckt die Grundkategorien ab; für die realistischeren
 * BFCL-/τ-bench-artigen Aufgaben siehe bench/bfcl-experiment.ts.
 *
 * Lauf:
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b npx tsx bench/ab-experiment.ts
 */
import type { ToolDefinition } from "../src/types/tool.js";
import { clockTool } from "../src/tools/builtins/clock.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { runExperiment, onlyDigits, stripThink, timesHHMM, type Task } from "./lib.js";

// Test-Tool mit prüfbarer Nebenwirkung: ein Tresor, den nur das Harness füllen kann.
const vault = new Map<string, string>();
const vaultTool: ToolDefinition<{ key: string; value: string }, { stored: boolean }> = {
  name: "vault.set",
  description: "Speichert einen Wert unter einem Schlüssel in einem sicheren Tresor.",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "Schlüssel" },
      value: { type: "string", description: "zu speichernder Wert" },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  async execute({ key, value }) {
    vault.set(key, String(value));
    return { stored: true };
  },
};
const vaultHasValue = (needle: string): boolean =>
  Array.from(vault.values()).some((v) => onlyDigits(v).includes(needle));
const clearVault = (): void => vault.clear();

const tasks: Task[] = [
  {
    id: "single",
    category: "Einzel-Call",
    title: "Aktuelle Uhrzeit in Tokio",
    prompt: "Wie spät ist es GERADE JETZT in Asia/Tokyo? Nenne die genaue Uhrzeit als HH:MM.",
    tools: [clockTool],
    check: (a) => timesHHMM("Asia/Tokyo").some((t) => stripThink(a).includes(t)),
  },
  {
    id: "accuracy",
    category: "Genauigkeit",
    title: "Exakte Multiplikation (8394 × 7261 = 60.948.834)",
    prompt: "Berechne exakt: 8394 * 7261. Antworte am Ende mit genau der Zahl.",
    tools: [calculatorTool],
    check: (a) => onlyDigits(stripThink(a)).includes("60948834"),
  },
  {
    id: "select",
    category: "Werkzeugauswahl (multiple)",
    title: "Richtiges Tool + Präzedenz (68127 + 9384 × 3 = 96.279)",
    prompt: "Berechne exakt: 68127 + 9384 * 3. Antworte am Ende mit genau der Zahl.",
    tools: [clockTool, calculatorTool, vaultTool],
    check: (a) => onlyDigits(stripThink(a)).includes("96279"),
  },
  {
    id: "parallel",
    category: "Mehrere Tools (parallel)",
    title: "Rechnung UND Uhrzeit in einem Auftrag",
    prompt:
      "Erledige beides: (a) berechne 47 * 11, und (b) nenne die aktuelle Uhrzeit in Europe/Berlin als HH:MM.",
    tools: [clockTool, calculatorTool],
    check: (a) => {
      const c = stripThink(a);
      return onlyDigits(c).includes("517") && timesHHMM("Europe/Berlin").some((t) => c.includes(t));
    },
  },
  {
    id: "chain",
    category: "Abhängige Kette (sequential)",
    title: "Rechnen → Ergebnis speichern (6 × 7, dann in den Tresor)",
    prompt: "Berechne 6 * 7 und speichere das Ergebnis im Tresor unter dem Schlüssel 'answer'.",
    tools: [calculatorTool, vaultTool],
    reset: clearVault,
    check: () => vaultHasValue("42"),
  },
  {
    id: "irrelevance",
    category: "Kein Tool nötig (irrelevance)",
    title: "Wissensfrage — kein Werkzeug soll benutzt werden",
    prompt: "Was ist die Hauptstadt von Frankreich? Antworte in einem Wort.",
    tools: [clockTool, calculatorTool],
    check: (a) => /paris/i.test(stripThink(a)),
  },
  {
    id: "state",
    category: "Zustand schreiben",
    title: "Wert in Tresor ablegen (ohne Werkzeug unmöglich)",
    prompt: "Lege im Tresor unter dem Schlüssel 'pin' den Wert 4821 ab. Bestätige danach kurz.",
    tools: [vaultTool],
    reset: clearVault,
    check: () => (vault.get("pin") ?? "") === "4821",
  },
];

void runExperiment('A/B-Experiment: „Was bringt das Harness?"', tasks);
