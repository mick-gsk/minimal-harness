import { DatabaseSync } from "node:sqlite";
import type { Embedder } from "./embedder.js";

export interface KnowledgeHit {
  source: string;
  content: string;
  score: number;
}

/**
 * Local knowledge base: chunks + embeddings in SQLite, ranked by brute-force
 * cosine similarity. Deliberately index-free — SME-scale knowledge bases
 * (thousands of chunks) rank in milliseconds, and an ANN index would be
 * premature complexity. Requires node:sqlite (Node >= 22.5), like SqliteMemory.
 */
export class SqliteKnowledgeStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(
    path: string,
    private readonly embedder: Embedder,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS chunks (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        source    TEXT NOT NULL,
        content   TEXT NOT NULL,
        embedding BLOB NOT NULL
      )`,
    );
  }

  /** Embeds and stores text chunks under a source label (file name, URL, ...). */
  async add(source: string, texts: string[]): Promise<void> {
    if (texts.length === 0) return;
    const vectors = await this.embedder.embed(texts);
    const insert = this.db.prepare("INSERT INTO chunks (source, content, embedding) VALUES (?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const [i, text] of texts.entries()) {
        insert.run(source, text, Buffer.from(new Float32Array(vectors[i]!).buffer));
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Top-k chunks by cosine similarity to the query. */
  async search(query: string, k: number): Promise<KnowledgeHit[]> {
    const rows = this.db.prepare("SELECT source, content, embedding FROM chunks").all() as unknown as Array<{
      source: string;
      content: string;
      embedding: Uint8Array;
    }>;
    if (rows.length === 0) return [];

    const [queryVector] = await this.embedder.embed([query]);
    const hits = rows.map((row) => {
      const vector = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      return { source: row.source, content: row.content, score: cosine(queryVector!, vector) };
    });
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  count(): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM chunks").get() as unknown as { n: number };
    return row.n;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
