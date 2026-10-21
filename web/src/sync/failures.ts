import { ApiError } from '../api/ApiError';
import { getOwn } from '../util/ownProperty';

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

/** "Server not reachable right now" answers from gateways and overloaded servers. */
const UNAVAILABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

/**
 * Whether a transient failure counts toward dead-lettering the mutation: errors the server keeps
 * raising for this request (HTTP 500 and other 5xx, unexpected errors) do; offline errors and
 * "unavailable right now" statuses (408, 429, 502-504: proxy up, API down or busy) do not, so an
 * outage never discards the queue.
 */
export function countsTowardGiveUp(error: unknown): boolean {
  if (classifyFailure(error) !== 'transient') return false;
  return !(error instanceof ApiError && UNAVAILABLE_STATUSES.has(error.status));
}

/** Readable explanations for API problem `code`s that dead-letter a mutation. */
const PROBLEM_MESSAGES: Record<string, string> = {
  event_baby_mismatch:
    'This event id already belongs to another baby on the server, so the change was not saved.',
  event_type_not_available:
    'This event type is not available for this baby on the server, so the change was not saved.',
};

function describeApiError(error: ApiError): string {
  const { code } = error;
  if (!code) return `HTTP ${error.status}: ${error.message}`;
  const known = getOwn(PROBLEM_MESSAGES, code);
  if (known) return `${known} (HTTP ${error.status} ${code})`;
  const detail = error.problem?.detail ?? error.problem?.title ?? error.message;
  return `HTTP ${error.status} ${code}: ${detail}`;
}

export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return describeApiError(error);
  const { message, name } = (error ?? {}) as { message?: unknown; name?: unknown };
  if (typeof message === 'string' && message) return message;
  if (typeof name === 'string' && name) return name;
  return String(error);
}
