export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Returns a number in [0, 1); injectable for tests. */
  random: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 1_000,
  maxMs: 5 * 60_000,
  random: Math.random,
};

/**
 * Exponential backoff with "equal jitter": for the n-th failed attempt (n >= 1) the ceiling is
 * min(max, base * 2^(n-1)) and the delay is uniformly in [ceiling/2, ceiling).
 */
export function backoffDelay(attempts: number, options: BackoffOptions = DEFAULT_BACKOFF): number {
  const exponent = Math.max(0, attempts - 1);
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** exponent);
  const half = ceiling / 2;
  return Math.floor(half + options.random() * half);
}
