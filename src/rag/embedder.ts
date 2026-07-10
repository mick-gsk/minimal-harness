/** Turns texts into embedding vectors. Interface so tests stay deterministic. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface OllamaEmbedderConfig {
  baseUrl: string;
  /**
   * Default bge-m3: multilingual — measured hit@1 5/5 on German queries where
   * nomic-embed-text scored 2/5 (bench/rag-probe.ts). For English-only
   * corpora nomic-embed-text is a lighter alternative (set the store's
   * task prefixes for it).
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
      body: JSON.stringify({ model: this.config.model ?? "bge-m3", input: texts }),
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
