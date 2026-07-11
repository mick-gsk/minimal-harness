/**
 * A deliberately hard task: multi-hop tool chaining with a deterministic answer.
 *
 * The model must discover the orders of a customer, expand each order into its
 * line items, look up a price per SKU, sum everything, and convert the total
 * into EUR. No single tool holds the answer, and none of it can be guessed from
 * pretraining -- the fixtures below are invented. A weather tool is registered
 * purely as a distractor (irrelevance test).
 *
 * Because defaultPolicy caps tool calls at 1 per turn, the model has to
 * sequence ~7 dependent calls across turns on its own.
 *
 * Run: OLLAMA_BASE_URL=http://127.0.0.1:21434 npx tsx examples/hard-task.ts
 */
import { OllamaClient } from "../src/llm/ollama-client.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { DefaultToolBridge } from "../src/tools/tool-bridge.js";
import { DefaultAgentLoop } from "../src/core/agent-loop.js";
import { DefaultPromptBuilder } from "../src/core/prompt-builder.js";
import { StructuredOutputValidator } from "../src/guardrails/validator.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import type { ToolDefinition, ToolInputSchema } from "../src/types/tool.js";

// --- Fixtures: the only place the truth lives -------------------------------

const ORDERS_BY_CUSTOMER: Record<string, string[]> = {
  "C-42": ["ORD-1001", "ORD-1002"],
};

const ORDERS: Record<string, { items: Array<{ sku: string; qty: number }>; currency: string }> = {
  "ORD-1001": { items: [{ sku: "SKU-A", qty: 3 }, { sku: "SKU-B", qty: 1 }], currency: "USD" },
  "ORD-1002": { items: [{ sku: "SKU-C", qty: 2 }], currency: "USD" },
};

const PRICES_CENTS: Record<string, number> = { "SKU-A": 1299, "SKU-B": 4500, "SKU-C": 999 };

const FX: Record<string, number> = { "USD->EUR": 0.92 };

/** Ground truth, computed from the fixtures -- never from the model's output. */
const EXPECTED_TOTAL_EUR =
  (Object.values(ORDERS_BY_CUSTOMER["C-42"]!)
    .map((id) => ORDERS[id]!)
    .flatMap((o) => o.items)
    .reduce((sum, it) => sum + it.qty * PRICES_CENTS[it.sku]!, 0) /
    100) *
  FX["USD->EUR"]!;

// --- Tools ------------------------------------------------------------------

const listOrdersTool: ToolDefinition<{ customerId: string }, { orderIds: string[] }> = {
  name: "orders.list",
  description: "Lists all order IDs for a customer ID.",
  inputSchema: {
    type: "object",
    properties: { customerId: { type: "string", description: "e.g. 'C-42'" } },
    required: ["customerId"],
    additionalProperties: false,
  },
  async execute({ customerId }) {
    const orderIds = ORDERS_BY_CUSTOMER[customerId];
    if (!orderIds) throw new Error(`Unknown customer: ${customerId}`);
    return { orderIds };
  },
};

const getOrderTool: ToolDefinition<
  { orderId: string },
  { orderId: string; items: Array<{ sku: string; qty: number }>; currency: string }
> = {
  name: "orders.get",
  description: "Returns the line items (SKU + quantity) and currency of one order.",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", description: "e.g. 'ORD-1001'" } },
    required: ["orderId"],
    additionalProperties: false,
  },
  async execute({ orderId }) {
    const order = ORDERS[orderId];
    if (!order) throw new Error(`Unknown order: ${orderId}`);
    return { orderId, ...order };
  },
};

const priceTool: ToolDefinition<{ sku: string }, { sku: string; priceCents: number }> = {
  name: "catalog.price",
  description: "Returns the unit price of a SKU, in cents of the order currency.",
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string", description: "e.g. 'SKU-A'" } },
    required: ["sku"],
    additionalProperties: false,
  },
  async execute({ sku }) {
    const priceCents = PRICES_CENTS[sku];
    if (priceCents === undefined) throw new Error(`Unknown SKU: ${sku}`);
    return { sku, priceCents };
  },
};

const fxTool: ToolDefinition<{ from: string; to: string }, { rate: number }> = {
  name: "fx.rate",
  description: "Returns today's exchange rate between two currency codes.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "e.g. 'USD'" },
      to: { type: "string", description: "e.g. 'EUR'" },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async execute({ from, to }) {
    const rate = FX[`${from}->${to}`];
    if (rate === undefined) throw new Error(`No rate for ${from}->${to}`);
    return { rate };
  },
};

/** Distractor: relevant to nothing in the task. A call to it is a failure signal. */
const weatherTool: ToolDefinition<{ city: string }, { city: string; celsius: number }> = {
  name: "weather.get",
  description: "Returns the current temperature in a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
  async execute({ city }) {
    return { city, celsius: 18 };
  },
};

// --- Wiring -----------------------------------------------------------------

const llm = new OllamaClient({
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:21434",
  model: process.env.MODEL ?? "qwen3:14b",
  defaultTemperature: 0,
  defaultSeed: 42, // reproducible runs -- rerun means rerun, not reroll
});

const toolBridge = new DefaultToolBridge();
for (const tool of [listOrdersTool, getOrderTool, priceTool, fxTool, calculatorTool, weatherTool]) {
  toolBridge.register(tool);
}

const agentLoop = new DefaultAgentLoop({
  llm,
  memory: new InMemoryMemory(),
  toolBridge,
  validator: new StructuredOutputValidator(),
  promptBuilder: new DefaultPromptBuilder(),
  nativeToolCalling: true,
  verifyFinalAnswer: true,
  systemInstruction:
    "You are a data analyst with access to tools. Never guess a number you have not " +
    "retrieved from a tool. Call exactly one tool per response, then wait for its " +
    "result before continuing.",
});

const responseSchema: ToolInputSchema = {
  type: "object",
  properties: {
    total_eur: { type: "number", description: "Total order value in EUR, rounded to 2 decimals" },
    orders_checked: { type: "number", description: "How many orders were summed" },
  },
  required: ["total_eur", "orders_checked"],
  additionalProperties: false,
};

const startedAt = Date.now();
const result = await agentLoop.run({
  sessionId: "hard-task",
  userMessage:
    "What is the total value of all orders placed by customer C-42, converted to EUR? " +
    "Prices are stored per SKU in cents.",
  maxTurns: 20,
  responseSchema,
});
const elapsedMs = Date.now() - startedAt;

// --- Deterministic scoring --------------------------------------------------

const answer = result.structuredAnswer as { total_eur?: number; orders_checked?: number } | undefined;
const calledWeather = result.toolTrace.some((r) => r.toolName === "weather.get");
const toolErrors = result.toolTrace.filter((r) => r.error !== undefined);

const checks = [
  ["terminated with a final answer", result.terminatedReason === "final_answer"],
  ["answer matches the schema", answer !== undefined],
  [
    `total_eur == ${EXPECTED_TOTAL_EUR.toFixed(2)}`,
    answer?.total_eur !== undefined && Math.abs(answer.total_eur - EXPECTED_TOTAL_EUR) < 0.02,
  ],
  ["orders_checked == 2", answer?.orders_checked === 2],
  ["ignored the distractor tool", !calledWeather],
] as const;

console.log("\n--- Result ---");
console.log("Final answer:", result.finalAnswer);
console.log("Terminated:", result.terminatedReason, `after ${result.rawTurns.length} turn(s), ${(elapsedMs / 1000).toFixed(1)}s`);
console.log("\n--- Tool trace ---");
for (const [i, r] of result.toolTrace.entries()) {
  const outcome = r.error ? `ERROR: ${r.error}` : JSON.stringify(r.output);
  console.log(`${i + 1}. ${r.toolName}(${JSON.stringify(r.arguments)}) -> ${outcome}`);
}
console.log(`\nTool calls: ${result.toolTrace.length} (${toolErrors.length} failed)`);

console.log("\n--- Score ---");
for (const [label, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
const passedCount = checks.filter(([, ok]) => ok).length;
console.log(`\n${passedCount}/${checks.length} checks passed`);
process.exit(passedCount === checks.length ? 0 : 1);
