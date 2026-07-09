import type { LLMAdapter, LLMResponse } from "../src/index.js";

/**
 * Returns each canned response in order; repeats the last one when the
 * script is exhausted. Lets adapter tests simulate multi-turn dialogs.
 */
export function scriptedLlm(responses: LLMResponse[]): LLMAdapter & { calls: number } {
  let i = 0;
  const adapter = {
    calls: 0,
    async generate(): Promise<LLMResponse> {
      adapter.calls++;
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
  return adapter;
}
