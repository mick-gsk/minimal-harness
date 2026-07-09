import type { ToolDefinition } from "../src/index.js";

/** Mutable per-run world the scorer can inspect (spec §4.1 WorldState). */
export class WorldState {
  readonly kv = new Map<string, string>();
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
