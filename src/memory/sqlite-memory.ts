import { DatabaseSync } from "node:sqlite";
import type { Memory, MemoryRecord, MemoryState } from "../types/memory.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  timestamp  INTEGER NOT NULL,
  metadata   TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
`;

interface MessageRow {
  role: string;
  content: string;
  timestamp: number;
  metadata: string | null;
}

/**
 * Durable Memory backed by the built-in node:sqlite (Node >= 22.5).
 * Drop-in replacement for InMemoryMemory: sessions survive process restarts.
 */
export class SqliteMemory implements Memory {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // WAL: crash-safe writes and concurrent readers; no effect on ":memory:".
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA user_version = 1");
    this.db.exec(SCHEMA);
  }

  async get(sessionId: string): Promise<MemoryState> {
    const rows = this.db
      .prepare("SELECT role, content, timestamp, metadata FROM messages WHERE session_id = ? ORDER BY id")
      .all(sessionId) as unknown as MessageRow[];
    return { messages: rows.map((row) => toRecord(row)) };
  }

  async append(sessionId: string, record: MemoryRecord): Promise<void> {
    this.db
      .prepare("INSERT INTO messages (session_id, role, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, record.role, record.content, record.timestamp, record.metadata ? JSON.stringify(record.metadata) : null);
  }

  async clear(sessionId: string): Promise<void> {
    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  }

  /** Escape hatch for tests and migrations; not part of the Memory interface. */
  raw(): DatabaseSync {
    return this.db;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

function toRecord(row: MessageRow): MemoryRecord {
  const record: MemoryRecord = {
    role: row.role as MemoryRecord["role"],
    content: row.content,
    timestamp: row.timestamp,
  };
  if (row.metadata !== null) {
    // A single corrupt row must not make the whole session unreadable.
    try {
      record.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      /* metadata omitted */
    }
  }
  return record;
}
