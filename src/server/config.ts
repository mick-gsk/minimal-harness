import { existsSync, readFileSync } from "node:fs";
import { assertToolPolicy, type ToolPolicy } from "./tool-policy.js";

/**
 * Parses the API_KEYS env format "key1:user1,key2:user2" — fail fast on
 * anything malformed; a misconfigured auth table must never boot silently.
 */
export function parseApiKeys(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim() === "") {
    throw new Error('API_KEYS is required, e.g. API_KEYS="sk-secret:alice,sk-other:bob"');
  }
  const keys: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    const key = pair.slice(0, idx).trim();
    const user = pair.slice(idx + 1).trim();
    if (idx === -1 || !key || !user) {
      throw new Error(`API_KEYS entry '${pair.trim()}' is not in key:userId format`);
    }
    if (keys[key]) throw new Error("API_KEYS contains a duplicate key");
    keys[key] = user;
  }
  return keys;
}

/** Parses a comma-separated list env ("a,b , c" → ["a","b","c"]). */
export function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Loads the tool-RBAC policy from the TOOL_POLICY env var.
 *
 * Robuste Variante (dokumentiert): TOOL_POLICY wird als **Pfad zu einer
 * JSON-Datei** interpretiert, wenn diese Datei existiert — sonst als **inline
 * JSON**. Der Dateipfad ist die empfohlene, robustere Form: keine Shell-Escaping-
 * Fallen, keine Zeilenlängen-Limits, die Matrix lässt sich versionieren und als
 * Secret/Volume mounten. Inline-JSON bleibt für kleine Setups/Tests erlaubt.
 * Undefined, wenn nicht gesetzt → keine RBAC (alle Tools erlaubt, kein Breaking Change).
 */
export function parseToolPolicy(raw: string | undefined): ToolPolicy | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const value = raw.trim();
  let json: string;
  if (existsSync(value)) {
    json = readFileSync(value, "utf8");
  } else {
    json = value;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("TOOL_POLICY is neither an existing JSON file path nor valid inline JSON");
  }
  assertToolPolicy(parsed);
  return parsed;
}
