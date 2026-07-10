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
