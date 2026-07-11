/**
 * Canonical serialisation and hashing.
 *
 * Determinism is proven over LOGICAL content, not container bytes: node:sqlite stamps
 * SQLITE_VERSION into the file header and zlib DEFLATE output is not portable across
 * versions. So we hash canonical JSON and a canonical SQL text dump instead.
 */
import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON with recursively sorted object keys, so the bytes depend only on the content. */
export function canonicalJson(value: Json, indent = 0): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) out[key] = sortKeys(entry);
    }
    return out;
  }
  return value;
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Derives the root seed from a phrase, so the seed's provenance stays readable. */
export function seedFromPhrase(phrase: string): number {
  return parseInt(sha256(phrase).slice(0, 8), 16) >>> 0;
}
