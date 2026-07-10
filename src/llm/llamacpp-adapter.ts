import { OpenAiCompatAdapter } from "./openai-compat.js";

/**
 * llama.cpp's server speaks the OpenAI chat-completions API on port 8080 by
 * default; it serves a single loaded model, so the model name is nominal.
 */
export class LlamaCppAdapter extends OpenAiCompatAdapter {
  constructor(baseUrl = "http://localhost:8080/v1", model = "default") {
    super({ baseUrl, model });
  }
}
