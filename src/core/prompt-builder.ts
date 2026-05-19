import type { ChatMessage } from "../types/llm.js";
import type { MemoryRecord } from "../types/memory.js";

export interface PromptContext {
  systemInstruction: string;
  toolDescriptions: string[];
  memorySummary?: string;
  recentMessages: MemoryRecord[];
}

export interface PromptBuilder {
  build(ctx: PromptContext): ChatMessage[];
}

export class DefaultPromptBuilder implements PromptBuilder {
  build(ctx: PromptContext): ChatMessage[] {
    const toolBlock =
      ctx.toolDescriptions.length > 0
        ? `\n\n## Available Tools\n${ctx.toolDescriptions.join("\n")}\n\n` +
          `## Output Format\n` +
          `To call a tool respond EXACTLY:\n` +
          `ACTION: tool_call\nTOOL: <tool_name>\nARGS: <json>\n\n` +
          `To give a final answer respond EXACTLY:\n` +
          `ACTION: final_answer\nANSWER: <your answer>`
        : "";

    const systemContent = ctx.systemInstruction + toolBlock;

    const messages: ChatMessage[] = [{ role: "system", content: systemContent }];

    if (ctx.memorySummary) {
      messages.push({ role: "system", content: `## Context Summary\n${ctx.memorySummary}` });
    }

    for (const record of ctx.recentMessages) {
      messages.push({ role: record.role, content: record.content });
    }

    return messages;
  }
}
