import { ApiError } from '../api/ApiError';

/**
 * - `network`: no response (offline, DNS, CORS, abort/timeout) -> stop, resume when online.
 * - `unauthorized`: 401 -> pause sync until re-authentication.
 * - `transient`: 408, 429, 5xx, other non-4xx and unexpected errors -> retry with backoff.
 * - `permanent`: any other 4xx -> dead-letter the mutation, continue with the next one.
 */
export type FailureKind = 'network' | 'unauthorized' | 'transient' | 'permanent';

const RETRYABLE_4XX = new Set([408, 429]);
const NETWORK_ERROR_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'NetworkError']);

/** Matches by `name` because `DOMException` is not an `Error` subclass in every runtime. */
function isNetworkError(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && NETWORK_ERROR_NAMES.has(name);
}

export function classifyFailure(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) return isNetworkError(error) ? 'network' : 'transient';
  if (error.status === 401) return 'unauthorized';
  if (RETRYABLE_4XX.has(error.status)) return 'transient';
  if (error.status >= 400 && error.status < 500) return 'permanent';
  return 'transient';
}

export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return `HTTP ${error.status}: ${error.message}`;
  const { message, name } = (error ?? {}) as { message?: unknown; name?: unknown };
  if (typeof message === 'string' && message) return message;
  if (typeof name === 'string' && name) return name;
  return String(error);
}
