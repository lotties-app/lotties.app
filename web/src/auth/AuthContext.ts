import { createContext } from 'react';

export interface AuthUser {
  name?: string;
  email?: string;
  picture?: string;
}

export interface AuthApi {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  /** Starts the OIDC redirect; `returnTo` is restored after the callback. */
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthApi | null>(null);
