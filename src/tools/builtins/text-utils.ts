import type { ToolDefinition } from "../../types/tool.js";

interface TextUtilsInput {
  text: string;
  maxSentences?: number;
}

interface TextUtilsOutput {
  summary: string;
  sentenceCount: number;
}

/** Rule-based extractive summarizer – no external model required. */
export const textUtilsTool: ToolDefinition<TextUtilsInput, TextUtilsOutput> = {
  name: "text_utils.summarize_local",
  description: "Extracts the first N sentences from a text as a local summary. No external model.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      maxSentences: { type: "number", description: "Max sentences to keep (default 3)" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input) {
    const sentences = input.text.match(/[^.!?]+[.!?]+/g) ?? [input.text];
    const kept = sentences.slice(0, input.maxSentences ?? 3);
    return { summary: kept.join(" ").trim(), sentenceCount: kept.length };
  },
};
