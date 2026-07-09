import type { ToolDefinition } from "../src/index.js";

/** Mutable per-run world the scorer can inspect (spec §4.1 WorldState). */
export class WorldState {
  readonly kv = new Map<string, string>();
  /** Per-tool attempt counters, used by flaky tools and their checks. */
  readonly counters = new Map<string, number>();
}

/** Increments and returns the attempt count for a tool name. */
function bumpCounter(world: WorldState, name: string): number {
  const n = (world.counters.get(name) ?? 0) + 1;
  world.counters.set(name, n);
  return n;
}

/** Test tools with checkable side effects: kv.set / kv.get. */
export function makeKvTools(world: WorldState): ToolDefinition[] {
  const kvSet: ToolDefinition<{ key: string; value: string }, { ok: true }> = {
    name: "kv.set",
    description: "Store a string value under a key in the key-value store.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
      additionalProperties: false,
    },
    async execute(input) {
      world.kv.set(input.key, String(input.value));
      return { ok: true };
    },
  };

  const kvGet: ToolDefinition<{ key: string }, { value: string | null }> = {
    name: "kv.get",
    description: "Read the string value stored under a key. Returns null if the key does not exist.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
    async execute(input) {
      return { value: world.kv.get(input.key) ?? null };
    },
  };

  return [kvSet as ToolDefinition, kvGet as ToolDefinition];
}

/**
 * Flaky lookup tool for the error-recovery category: throws on the first
 * `failures` calls, then returns the fixed value. Attempts are counted in
 * world.counters under "unstable.lookup" so checks can assert a retry happened.
 */
export function makeUnstableTool(world: WorldState, failures: number, value: string): ToolDefinition {
  const tool: ToolDefinition<Record<string, never>, { value: string }> = {
    name: "unstable.lookup",
    description:
      "Look up the secret value from a flaky remote service. " +
      "May fail transiently — retry the call if it reports an error.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const attempt = bumpCounter(world, "unstable.lookup");
      if (attempt <= failures) {
        throw new Error("service temporarily unavailable — please retry");
      }
      return { value };
    },
  };
  return tool as ToolDefinition;
}

/**
 * kv.set variant that fails its first `failures` calls before storing.
 * Same name/schema as the regular kv.set so prompts stay identical; the
 * description warns about transient failures (fairness: the model is told).
 */
export function makeFlakyKvSet(world: WorldState, failures: number): ToolDefinition {
  const tool: ToolDefinition<{ key: string; value: string }, { ok: true }> = {
    name: "kv.set",
    description:
      "Store a string value under a key in the key-value store. " +
      "May fail transiently — retry the call if it reports an error.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
      additionalProperties: false,
    },
    async execute(input) {
      const attempt = bumpCounter(world, "kv.set");
      if (attempt <= failures) {
        throw new Error("service temporarily unavailable — please retry");
      }
      world.kv.set(input.key, String(input.value));
      return { ok: true };
    },
  };
  return tool as ToolDefinition;
}
