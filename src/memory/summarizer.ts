/**
 * Optional: naive extractive summarizer for context compression.
 * Returns the last N messages as a plain-text summary.
 */
import type { MemoryRecord } from "../types/memory.js";

export function extractiveSummary(messages: MemoryRecord[], keepLast = 6): string {
  return messages
    .slice(-keepLast)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
}
