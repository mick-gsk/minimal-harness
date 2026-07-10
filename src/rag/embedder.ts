/** Turns texts into embedding vectors. Interface so tests stay deterministic. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface OllamaEmbedderConfig {
  baseUrl: string;
  /** nomic-embed-text is Ollama's standard local embedding model. */
  model?: string;
}

/** Local embeddings via Ollama's /api/embed — no cloud, no API key. */
export class OllamaEmbedder implements Embedder {
  constructor(private readonly config: OllamaEmbedderConfig) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.config.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.config.model ?? "nomic-embed-text", input: texts }),
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
