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

  for (const [key, value] of Object.entries(obj)) {
    const declared = (schema.properties[key] as { type?: string } | undefined)?.type;
    if (declared && declared in TYPE_CHECKS && !TYPE_CHECKS[declared]!(value)) {
      return `Field '${key}' must be of type ${declared}`;
    }
  }

  return null;
}

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
};
