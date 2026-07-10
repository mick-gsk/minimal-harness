/**
 * Converts real BFCL v4 dataset entries (Berkeley Function Calling
 * Leaderboard, Apache-2.0) into BenchTasks for the ablation matrix, and
 * scores tool calls against BFCL's ground truth.
 *
 * Why real BFCL: the in-house suite is home-field by construction (same
 * author as the harness). BFCL tasks and ground truths come from a third
 * party — they carry a neutrality the in-house suite cannot.
 *
 * Documented deviations from the official BFCL AST checker (kept deliberately
 * simple and applied identically to every arm):
 *  - strings compare after trim/lowercase/whitespace-collapse (official
 *    standardization is more elaborate)
 *  - the FIRST successfully executed call is scored; official BFCL scores the
 *    raw single call of a one-shot response
 *  - types are strict (string "10" does not match integer 10), matching the
 *    official checker's intent
 */
import type { ToolDefinition } from "../../src/index.js";
import type { BenchTask, BenchRunResult } from "../types.js";
import type { WorldState } from "../world.js";

export interface BfclFunctionSpec {
  name: string;
  description: string;
  parameters: BfclSchemaNode;
}

export interface BfclSchemaNode {
  type?: string;
  properties?: Record<string, BfclSchemaNode>;
  items?: BfclSchemaNode;
  required?: string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export interface BfclEntry {
  id: string;
  question: Array<Array<{ role: string; content: string }>>;
  function: BfclFunctionSpec[];
}

/** [{ funcName: { param: [allowed values, "" = optional] } }] */
export type BfclGroundTruth = Array<Record<string, Record<string, unknown[]>>>;

const TYPE_MAP: Record<string, string> = {
  dict: "object",
  float: "number",
  tuple: "array",
  integer: "integer",
  string: "string",
  boolean: "boolean",
  array: "array",
  object: "object",
  number: "number",
};

/** Recursively maps BFCL's Python-flavoured types (dict/float/tuple) to JSON Schema. */
export function normalizeBfclParameters(node: BfclSchemaNode): BfclSchemaNode {
  const out: BfclSchemaNode = { ...node };
  if (typeof node.type === "string") {
    const mapped = TYPE_MAP[node.type];
    // Unknown types (e.g. "any") lose the type constraint rather than breaking validation.
    if (mapped) out.type = mapped;
    else delete out.type;
  }
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties).map(([k, v]) => [k, normalizeBfclParameters(v)]),
    );
  }
  if (node.items) out.items = normalizeBfclParameters(node.items);
  return out;
}

const normStr = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

function valueMatches(provided: unknown, allowed: unknown): boolean {
  if (typeof allowed === "number" && typeof provided === "number") {
    return Math.abs(allowed - provided) < 1e-6;
  }
  if (typeof allowed === "string" && typeof provided === "string") {
    return normStr(allowed) === normStr(provided);
  }
  if (Array.isArray(allowed) && Array.isArray(provided)) {
    return allowed.length === provided.length && allowed.every((a, i) => valueMatches(provided[i], a));
  }
  if (allowed !== null && provided !== null && typeof allowed === "object" && typeof provided === "object") {
    const a = allowed as Record<string, unknown>;
    const p = provided as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(p).length && keys.every((k) => valueMatches(p[k], a[k]));
  }
  return allowed === provided;
}

export interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

/** BFCL AST-style check: name + every param against the allowed-value lists. */
export function matchesGroundTruth(call: RecordedCall, groundTruth: BfclGroundTruth): boolean {
  // simple/irrelevance ground truths contain exactly one acceptable function.
  for (const candidate of groundTruth) {
    const params = candidate[call.name];
    if (!params) continue;

    const allowedNames = new Set(Object.keys(params));
    if (![...Object.keys(call.args)].every((k) => allowedNames.has(k))) continue;

    let ok = true;
    for (const [param, allowedValues] of Object.entries(params)) {
      const provided = call.args[param];
      if (provided === undefined) {
        // "" in the allowed list marks the param optional
        if (!allowedValues.includes("")) ok = false;
      } else if (!allowedValues.some((a) => a !== "" && valueMatches(provided, a))) {
        ok = false;
      }
      if (!ok) break;
    }
    if (ok) return true;
  }
  return false;
}

const CALLS_KEY = "__bfcl_calls";

function recordedCalls(world: WorldState): RecordedCall[] {
  return JSON.parse(world.kv.get(CALLS_KEY) ?? "[]") as RecordedCall[];
}

function specToTool(spec: BfclFunctionSpec, world: WorldState): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: normalizeBfclParameters(spec.parameters) as ToolDefinition["inputSchema"],
    async execute(args: unknown) {
      const calls = recordedCalls(world);
      calls.push({ name: spec.name, args: (args ?? {}) as Record<string, unknown> });
      world.kv.set(CALLS_KEY, JSON.stringify(calls));
      // BFCL scores the call itself, not an execution result — acknowledge so
      // the agent can terminate with a final answer.
      return { status: "ok", note: "call recorded" };
    },
  } as ToolDefinition;
}

function promptOf(entry: BfclEntry): string {
  return entry.question[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
}

export interface BfclTaskInputs {
  simple: Array<{ entry: BfclEntry; groundTruth: BfclGroundTruth }>;
  irrelevance: Array<{ entry: BfclEntry }>;
}

/**
 * simple: success = the first executed call matches ground truth.
 * irrelevance: success = zero tool-call attempts and a real final answer.
 * maxTurns 3: one call turn + one answer turn + one slack turn for a retry.
 */
export function buildBfclTasks(inputs: BfclTaskInputs): BenchTask[] {
  const tasks: BenchTask[] = [];

  for (const { entry, groundTruth } of inputs.simple) {
    tasks.push({
      id: `bfcl-${entry.id}`,
      category: "single-tool",
      prompt: promptOf(entry),
      maxTurns: 3,
      makeTools: (world) => entry.function.map((f) => specToTool(f, world)),
      check: (_result: BenchRunResult, world: WorldState) => {
        const calls = recordedCalls(world);
        return calls.length > 0 && matchesGroundTruth(calls[0]!, groundTruth);
      },
    });
  }

  for (const { entry } of inputs.irrelevance) {
    tasks.push({
      id: `bfcl-${entry.id}`,
      category: "no-tool",
      prompt: promptOf(entry),
      maxTurns: 3,
      makeTools: (world) => entry.function.map((f) => specToTool(f, world)),
      check: (result: BenchRunResult) =>
        result.toolCallCount === 0 &&
        result.finalAnswer !== null &&
        result.finalAnswer.trim().length > 0,
    });
  }

  return tasks;
}
