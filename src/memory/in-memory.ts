import type { Memory, MemoryRecord, MemoryState } from "../types/memory.js";

export class InMemoryMemory implements Memory {
  private readonly store = new Map<string, MemoryRecord[]>();

  async get(sessionId: string): Promise<MemoryState> {
    return { messages: this.store.get(sessionId) ?? [] };
  }

  async append(sessionId: string, record: MemoryRecord): Promise<void> {
    if (!this.store.has(sessionId)) this.store.set(sessionId, []);
    this.store.get(sessionId)!.push(record);
  }

  async clear(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }
}
