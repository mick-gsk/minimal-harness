/** 95% Wilson score interval for a binomial proportion (spec §4.4a). */
export function wilson(
  successes: number,
  n: number,
): { rate: number; low: number; high: number } {
  if (n === 0) return { rate: 0, low: 0, high: 0 };
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/**
 * Strict pass^k (spec §2): share of tasks that succeed in ALL of their runs.
 * Input: one boolean array of run outcomes per task.
 */
export function passK(perTaskSuccesses: boolean[][]): number {
  if (perTaskSuccesses.length === 0) return 0;
  const allPass = perTaskSuccesses.filter((runs) => runs.length > 0 && runs.every(Boolean));
  return allPass.length / perTaskSuccesses.length;
}
