import { createContext } from 'react';

export interface AuthUser {
  name?: string;
  email?: string;
  picture?: string;
}

/**
 * Health of the signed-in session (offline-first: an expired access token does not sign the user
 * out while a refresh token is stored):
 * - `active`: the access token is valid, or nothing needed renewing yet;
 * - `renewing`: the expired access token is being renewed in the background;
 * - `waiting`: the access token is stale and could not be renewed yet (offline, identity provider
 *   unreachable); requests wait, renewal is retried.
 */
export type SessionState = 'active' | 'renewing' | 'waiting';

export interface AuthApi {
  user: AuthUser | null;
  /**
   * Stable id of the signed-in account (`issuer|sub`, see session/accountDatabase.ts); `null` while
   * signed out. Local data is kept per account.
   */
  accountId: string | null;
  /** A stored session exists that was not definitively rejected (the token may be stale). */
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  session: SessionState;
  /**
   * The previous session ended because its refresh token was rejected; the local data (and its
   * unsynced changes) was kept and syncs after the next sign-in.
   */
  sessionEnded: boolean;
  /** Starts the OIDC redirect; `returnTo` is restored after the callback. */
  login: (returnTo?: string) => Promise<void>;
  /** Ends the OIDC session (removes the stored OIDC user). Local data is cleared by `useSignOut`. */
  logout: () => Promise<void>;
  /**
   * The token for the next request: waits for a pending renewal; throws `TokenRenewalPendingError`
   * while it cannot complete and `SessionEndedError` when the session is over.
   */
  getAccessToken: () => Promise<string | null>;
  /** Forces a renewal (the API answered 401) and returns the new token, or `null`. */
  renewAccessToken: () => Promise<string | null>;
}

/** Builds the stable account id from the OIDC `iss` and `sub` claims. */
export function accountIdOf(issuer: string, subject: string): string {
  return `${issuer}|${subject}`;
}

export const AuthContext = createContext<AuthApi | null>(null);
