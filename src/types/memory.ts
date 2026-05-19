export interface MemoryRecord {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryState {
  messages: MemoryRecord[];
  summary?: string;
}

export interface Memory {
  get(sessionId: string): Promise<MemoryState>;
  append(sessionId: string, record: MemoryRecord): Promise<void>;
  clear(sessionId: string): Promise<void>;
  summarize?(sessionId: string): Promise<string | undefined>;
}
