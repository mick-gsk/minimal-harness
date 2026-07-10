import { OpenAiCompatAdapter } from "./openai-compat.js";

/** LM Studio speaks the OpenAI chat-completions API on port 1234 by default. */
export class LMStudioAdapter extends OpenAiCompatAdapter {
  constructor(baseUrl = "http://localhost:1234/v1", model = "local-model") {
    super({ baseUrl, model });
  }
}
