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
      `Please respond strictly using the ACTION/TOOL/ARGS or ACTION/ANSWER format.`
    );
  },
};
