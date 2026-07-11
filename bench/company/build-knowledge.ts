/**
 * Indexes the demo-company corpus into a SqliteKnowledgeStore so the probe
 * can measure a RAG-assisted deployment (knowledge.search next to fs.*).
 *
 * Only company/out/corpus is indexed — company/out/truth (the answer key)
 * must never enter the agent's world. Binary files are skipped; legacy
 * windows-1252 files are decoded like the fs tools do.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 npx tsx bench/company/build-knowledge.ts
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { OllamaEmbedder } from "../../src/rag/embedder.js";
import { SqliteKnowledgeStore } from "../../src/rag/knowledge-store.js";
import { decodeSmart } from "./tools.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, "..", "..", "company", "out", "corpus");
export const KNOWLEDGE_DB = join(here, "knowledge.db");

// ~1000 chars ≈ 250 tokens per chunk: small enough that 3 hits fit any
// context, large enough that a price row or mail paragraph stays intact.
const CHUNK_CHARS = 1000;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
}

/** Paragraph-aware chunking: split on blank lines, pack up to CHUNK_CHARS. */
export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\r?\n\r?\n/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length > CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    // Oversized single paragraphs (CSV bodies) are split hard.
    if (p.length > CHUNK_CHARS) {
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS).trim());
    } else {
      current += (current ? "\n\n" : "") + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

async function main(): Promise<void> {
  rmSync(KNOWLEDGE_DB, { force: true });
  rmSync(`${KNOWLEDGE_DB}-wal`, { force: true });
  rmSync(`${KNOWLEDGE_DB}-shm`, { force: true });
  const store = new SqliteKnowledgeStore(KNOWLEDGE_DB, new OllamaEmbedder({ baseUrl: BASE_URL }));

  const files: string[] = [];
  walk(CORPUS, files);
  let indexed = 0;
  let skipped = 0;
  for (const abs of files) {
    const rel = abs.slice(CORPUS.length + 1);
    const buf = readFileSync(abs);
    if (buf.subarray(0, 1024).includes(0)) {
      skipped++;
      continue; // binary (erp.sqlite, xlsx, pdf)
    }
    const chunks = chunkText(decodeSmart(buf));
    await store.add(rel, chunks);
    indexed++;
  }
  console.log(`indexed ${indexed} files (${store.count()} chunks), skipped ${skipped} binary files -> ${KNOWLEDGE_DB}`);
  store.close();
}

// Only run when executed directly (probe imports KNOWLEDGE_DB/chunkText).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
