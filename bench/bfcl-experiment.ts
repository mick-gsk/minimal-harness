/**
 * BFCL-/τ-bench-*artige* Aufgaben: realistische Werkzeuge (Wetter-Datenbank,
 * Währungsumrechnung, Flugsuche + Buchung) statt Spielzeug — genau die Kategorien
 * der öffentlichen Benchmarks (BFCL: single / multiple / dependent / irrelevance;
 * τ-bench: Datenbank-Operationen mit Zustand & Policy), aber deterministisch
 * ausführbar geprüft (feste Mock-Daten + World-State), kein LLM-Judge.
 *
 * WICHTIG: Das sind an unseren Runner angepasste Aufgaben im Stil dieser
 * Benchmarks — nicht die Original-Datensätze (BFCL prüft per AST-Match auf den
 * Funktionsaufruf, nicht per Ausführung).
 *
 * Lauf:
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b npx tsx bench/bfcl-experiment.ts
 */
import type { ToolDefinition } from "../src/types/tool.js";
import { runExperiment, onlyDigits, stripThink, type Task } from "./lib.js";

// ── Mock-„Datenbanken" (wie τ-bench: lokale Daten hinter Tool-APIs) ───────────
const WEATHER_C: Record<string, number> = { berlin: 18, tokyo: 27, london: 14, "new york": 22, paris: 16 };
const RATES: Record<string, number> = { "USD:EUR": 0.92, "EUR:USD": 1.087, "GBP:EUR": 1.17 };
const FLIGHTS: Record<string, string[]> = {
  "berlin->london": ["FL100"],
  "berlin->paris": ["FL200"],
  "tokyo->london": ["FL300"],
};
const KNOWN_FLIGHTS = new Set(["FL100", "FL200", "FL300"]);

// World-State: getätigte Buchungen (prüfbare Nebenwirkung).
const bookings: Array<{ flightId: string; passenger: string }> = [];

// ── Werkzeuge im BFCL-Stil ────────────────────────────────────────────────────
const weatherTool: ToolDefinition<{ city: string }, { city: string; temperatureC: number }> = {
  name: "weather.get",
  description: "Liefert die aktuelle Temperatur (°C) für eine Stadt aus dem Wetterdienst.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", description: "Stadtname, z. B. 'Tokyo'" } },
    required: ["city"],
    additionalProperties: false,
  },
  async execute({ city }) {
    const key = city.trim().toLowerCase();
    const t = WEATHER_C[key];
    if (t === undefined) throw new Error(`Unbekannte Stadt: ${city}`);
    return { city, temperatureC: t };
  },
};

const currencyTool: ToolDefinition<{ amount: number; from: string; to: string }, { result: number }> = {
  name: "currency.convert",
  description: "Rechnet einen Betrag mit dem aktuellen Kurs von einer Währung in eine andere um.",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "Betrag" },
      from: { type: "string", description: "Ausgangswährung, z. B. 'USD'" },
      to: { type: "string", description: "Zielwährung, z. B. 'EUR'" },
    },
    required: ["amount", "from", "to"],
    additionalProperties: false,
  },
  async execute({ amount, from, to }) {
    const rate = RATES[`${from.toUpperCase()}:${to.toUpperCase()}`];
    if (rate === undefined) throw new Error(`Kein Kurs für ${from}->${to}`);
    return { result: Math.round(Number(amount) * rate * 100) / 100 };
  },
};

const flightSearchTool: ToolDefinition<{ from: string; to: string }, { flights: string[] }> = {
  name: "flight.search",
  description: "Sucht verfügbare Flüge zwischen zwei Städten und liefert deren Flugnummern.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Abflugstadt" },
      to: { type: "string", description: "Zielstadt" },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async execute({ from, to }) {
    return { flights: FLIGHTS[`${from.trim().toLowerCase()}->${to.trim().toLowerCase()}`] ?? [] };
  },
};

const flightBookTool: ToolDefinition<{ flightId: string; passenger: string }, { booked: boolean; confirmation?: string }> = {
  name: "flight.book",
  description: "Bucht einen Flug per Flugnummer für einen Passagier. Nur existierende Flüge sind buchbar.",
  inputSchema: {
    type: "object",
    properties: {
      flightId: { type: "string", description: "Flugnummer, z. B. 'FL100'" },
      passenger: { type: "string", description: "Name des Passagiers" },
    },
    required: ["flightId", "passenger"],
    additionalProperties: false,
  },
  async execute({ flightId, passenger }) {
    if (!KNOWN_FLIGHTS.has(flightId)) return { booked: false }; // Policy: nur echte Flüge
    bookings.push({ flightId, passenger });
    return { booked: true, confirmation: `CONF-${flightId}` };
  },
};

// ── Aufgaben (kanonische Benchmark-Kategorien) ────────────────────────────────
const tasks: Task[] = [
  {
    id: "db-lookup",
    category: "DB-Lookup (BFCL single)",
    title: "Aktuelle Temperatur in Tokio (nur über den Wetterdienst wissbar)",
    prompt: "Wie warm ist es GERADE JETZT in Tokyo? Nutze den Wetterdienst und nenne die Temperatur.",
    tools: [weatherTool],
    check: (a) => onlyDigits(stripThink(a)).includes("27"),
  },
  {
    id: "arg-extract",
    category: "Argument-Extraktion (BFCL)",
    title: "250 USD in EUR zum aktuellen Kurs (250 × 0,92 = 230)",
    prompt: "Rechne 250 US-Dollar in Euro um, zum aktuellen Kurs. Nenne den Euro-Betrag.",
    tools: [currencyTool, weatherTool], // Distraktor vorhanden → Werkzeugauswahl nötig
    check: (a) => onlyDigits(stripThink(a)).includes("230"),
  },
  {
    id: "select",
    category: "Werkzeugauswahl (BFCL multiple)",
    title: "Gibt es einen Flug Berlin → London? (Antwort nur in der Flug-DB)",
    prompt: "Gibt es einen Flug von Berlin nach London? Nenne die Flugnummer.",
    tools: [weatherTool, currencyTool, flightSearchTool],
    check: (a) => /FL100/i.test(stripThink(a)),
  },
  {
    id: "chain-book",
    category: "Abhängige Kette + Buchung (τ-bench)",
    title: "Flug suchen UND buchen (Ergebnis der Suche speist die Buchung)",
    prompt:
      "Suche einen Flug von Berlin nach London und buche ihn anschließend für den Passagier Mick.",
    tools: [flightSearchTool, flightBookTool],
    reset: () => {
      bookings.length = 0;
    },
    check: () => bookings.some((b) => b.flightId === "FL100" && /mick/i.test(b.passenger)),
  },
  {
    id: "irrelevance",
    category: "Kein Tool nötig (BFCL irrelevance)",
    title: "Wissensfrage — kein Werkzeug soll benutzt werden",
    prompt: "Was ist die Hauptstadt von Japan? Antworte in einem Wort.",
    tools: [weatherTool, flightSearchTool],
    check: (a) => /tok[iy]o/i.test(stripThink(a)),
  },
];

void runExperiment("BFCL-/τ-bench-artige Aufgaben", tasks);
