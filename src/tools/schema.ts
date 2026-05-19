import type { ToolInputSchema } from "../types/tool.js";

/**
 * Minimal structural validator – checks required fields and property types.
 * No external dependency; replace with ajv if richer JSON Schema support is needed.
 */
export function validateToolInput(
  input: unknown,
  schema: ToolInputSchema,
): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Input must be a plain object";
  }

  const obj = input as Record<string, unknown>;

  for (const key of schema.required ?? []) {
    if (!(key in obj)) return `Missing required field: ${key}`;
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) return `Unexpected field: ${key}`;
    }
  }

  return null;
}
