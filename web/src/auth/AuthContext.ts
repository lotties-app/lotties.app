import { createContext } from 'react';

export interface AuthUser {
  name?: string;
  email?: string;
  picture?: string;
}

export interface AuthApi {
  user: AuthUser | null;
  /**
   * Stable id of the signed-in account (`issuer|sub`, see session/accountDatabase.ts); `null` while
   * signed out. Local data is kept per account.
   */
  accountId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  /** Starts the OIDC redirect; `returnTo` is restored after the callback. */
  login: (returnTo?: string) => Promise<void>;
  /** Ends the OIDC session (removes the stored OIDC user). Local data is cleared by `useSignOut`. */
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

/** Builds the stable account id from the OIDC `iss` and `sub` claims. */
export function accountIdOf(issuer: string, subject: string): string {
  return `${issuer}|${subject}`;
}

export const AuthContext = createContext<AuthApi | null>(null);
