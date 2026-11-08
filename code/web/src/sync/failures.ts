import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import { catalogText } from '../i18n/catalog';
import { t } from '../i18n/i18n';

/**
 * - `network`: no response (offline, DNS, CORS, abort/timeout) -> stop, resume when online.
 * - `waitingForToken`: the expired access token is being renewed (or cannot be yet) -> pause and
 *   retry with backoff; never counts against a mutation.
 * - `unauthorized`: 401, or the session ended -> pause sync until re-authentication.
 * - `transient`: 408, 429, 409 `concurrent_modification`, 5xx, other non-4xx and unexpected
 *   errors -> retry with backoff.
 * - `permanent`: any other 4xx -> dead-letter the mutation, continue with the next one.
 */
export type FailureKind =
  'network' | 'waitingForToken' | 'unauthorized' | 'transient' | 'permanent';

const RETRYABLE_4XX = new Set([408, 429]);
const NETWORK_ERROR_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'NetworkError']);

/** Matches by `name` because `DOMException` is not an `Error` subclass in every runtime. */
function nameOf(error: unknown): string | undefined {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * 409 `concurrent_modification`: another write changed the same rows at the same moment and
 * nothing was saved (e.g. two formulas made current at once); repeating the request is safe.
 */
function isConcurrentModification(error: ApiError) {
  return error.status === 409 && error.code === 'concurrent_modification';
}

export function classifyFailure(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) {
    const name = nameOf(error);
    if (name === 'TokenRenewalPendingError') return 'waitingForToken';
    if (name === 'SessionEndedError') return 'unauthorized';
    return name && NETWORK_ERROR_NAMES.has(name) ? 'network' : 'transient';
  }
  if (error.status === 401) return 'unauthorized';
  if (RETRYABLE_4XX.has(error.status) || isConcurrentModification(error)) return 'transient';
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

/**
 * The data store that holds a baby's records cannot serve now (503 with a `store_*` code; the
 * family's own database is paused, unreachable, full...; docs/SPEC.md "Store failures"). Always
 * retriable: the outbox keeps the change and waits the server's `Retry-After`.
 */
export function isStoreFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 503 && !!error.code?.startsWith('store_');
}

/**
 * When to try again after a transient failure: the server's `Retry-After` when it gave one
 * (capped at `maxMs`), else the exponential backoff delay. Milliseconds from now.
 */
export function retryDelay(error: unknown, backoffMs: number, maxMs: number): number {
  const asked = error instanceof ApiError ? error.retryAfterMs : null;
  return asked === null ? backoffMs : Math.min(Math.max(asked, 0), maxMs);
}

/** Whether the server rejected an event's payload (fields missing, hidden or out of range). */
export function isPayloadRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 400 && error.code === 'validation_failed';
}

/** The server refused a change to an event someone else logged (a Caregiver: 403 `event_not_owned`). */
export function isNotOwnedRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && error.code === 'event_not_owned';
}

/**
 * The proposal was already decided when a queued edit, accept or decline reached the server (409
 * `proposal_decided` for the doctor's edit, `proposal_not_pending` for a parent's decision).
 */
export function isProposalDecidedRejection(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === 'proposal_decided' || error.code === 'proposal_not_pending')
  );
}

/**
 * A 403 without that code: the user's role no longer allows the write (demoted to Viewer or
 * Caregiver, or removed, e.g. while offline).
 */
export function isRoleRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && !isNotOwnedRejection(error);
}

/**
 * A localized, user-facing sentence for a sync failure (shown in Settings > Sync and the header
 * tooltip). Server `detail` text and raw HTTP statuses are never shown.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    const known = error.code !== null && catalogText('errors', error.code) !== undefined;
    const rejected = classifyFailure(error) === 'permanent' && error.status !== 403;
    return rejected && !known ? t('sync.rejected') : describeApiError(error);
  }
  switch (classifyFailure(error)) {
    case 'network':
      return t('sync.networkError');
    case 'waitingForToken':
      return t('sync.waitingForToken');
    case 'unauthorized':
      return t('sync.unauthorized');
    default:
      return t('errors.generic');
  }
}
