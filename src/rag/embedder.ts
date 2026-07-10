/** Turns texts into embedding vectors. Interface so tests stay deterministic. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface OllamaEmbedderConfig {
  baseUrl: string;
  /**
   * Default snowflake-arctic-embed2: multilingual and numerically stable —
   * measured hit@1 5/5 on German queries (bench/rag-probe.ts) where
   * nomic-embed-text scored 2/5 and bge-m3 (also 5/5) produced NaN
   * embeddings for specific token sequences on Ollama 0.17 (500 errors).
   */
  model?: string;
}

/** Local embeddings via Ollama's /api/embed — no cloud, no API key. */
export class OllamaEmbedder implements Embedder {
  constructor(private readonly config: OllamaEmbedderConfig) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.config.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.config.model ?? "snowflake-arctic-embed2", input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new Error("Ollama embed response is missing embeddings");
    }
    return data.embeddings;
  }
}
