type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function safeParseJson<T = unknown>(raw: string): JsonParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
