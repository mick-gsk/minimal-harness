import { describe, it, expect } from "@jest/globals";
import { OllamaClient } from "../src/llm/ollama-client.js";

describe("OllamaClient", () => {
  it("throws on non-200 response", async () => {
    // Mock fetch to simulate a server error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 500, statusText: "Internal Server Error" });

    const client = new OllamaClient({ baseUrl: "http://localhost:11434", model: "llama3" });
    await expect(client.generate([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Ollama request failed: 500",
    );

    globalThis.fetch = originalFetch;
  });
});
