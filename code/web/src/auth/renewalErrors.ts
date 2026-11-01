/**
 * The stored access token has expired and could not be renewed yet (offline, the identity provider
 * is unreachable or answered with a transient error). Renewal is retried with backoff; the user
 * stays signed in with their local data.
 */
export class TokenRenewalPendingError extends Error {
  constructor() {
    super('The access token is being renewed.');
    this.name = 'TokenRenewalPendingError';
  }
}

/** The refresh token was rejected for good (e.g. `invalid_grant`): the user must sign in again. */
export class SessionEndedError extends Error {
  constructor() {
    super('The session has ended; sign in again.');
    this.name = 'SessionEndedError';
  }
}

/** Token endpoint errors that a later retry can fix (RFC 6749 section 5.2 has no others). */
const TRANSIENT_OAUTH_ERRORS = new Set(['temporarily_unavailable', 'server_error', 'slow_down']);

/** `oidc-client-ts` reports non-JSON token endpoint failures as `Error("<status text> (<status>): ...")`. */
const REJECTED_STATUS = /\((400|401)\)/;

/**
 * Whether a failed refresh means the session is over: the token endpoint answered with an OAuth
 * error (`ErrorResponse`, e.g. `invalid_grant` for an expired or revoked refresh token) or an HTTP
 * 400/401. Network errors, timeouts, 5xx answers and anything else are transient: the user is never
 * signed out because the device is offline or the identity provider is down.
 */
export function isDefinitiveRenewalFailure(error: unknown): boolean {
  const {
    name,
    error: code,
    message,
  } = (error ?? {}) as {
    name?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (name === 'ErrorResponse') {
    return typeof code === 'string' && !TRANSIENT_OAUTH_ERRORS.has(code);
  }
  return name === 'Error' && typeof message === 'string' && REJECTED_STATUS.test(message);
}
