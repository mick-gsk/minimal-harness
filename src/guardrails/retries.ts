export interface RetryStrategy {
  maxRetries: number;
  buildRetryPrompt(lastOutput: string, reason: string): string;
}

export const defaultRetryStrategy: RetryStrategy = {
  maxRetries: 2,
  buildRetryPrompt(lastOutput, reason) {
    return (
      `Your previous response was not in the required format.\n` +
      `Reason: ${reason}\n` +
      `Previous output:\n${lastOutput}\n\n` +
      `Respond in exactly one of these two formats:\n` +
      `ACTION: tool_call\nTOOL: <tool_name>\nARGS: <json>\n\n` +
      `or:\n` +
      `ACTION: final_answer\nANSWER: <your answer>`
    );
  },
};
